import { z } from 'zod';
import { nowIso, truncate } from '../core/util.js';
import { EVENTS } from '../core/events.js';
import { createAlert, createThread, findOpenThreadFor } from '../core/repos/engagement.js';
import { getQuote, listQuotes } from '../core/repos/quoting.js';
import { getCustomer } from '../core/repos/sales.js';
import { getProduct, listProducts, upsertProduct } from '../core/repos/catalog.js';
import { generateDeclaration } from '../docgen/declaration.js';
import type { AgentContext, AgentDefinition, AgentResult } from './types.js';

/**
 * Customs Agent (报关智能体)
 *
 * Runs once a deal is won. Two outputs:
 *
 * 1. **A structured declaration pack** — HS codes, declared values, weights,
 *    cubes, certification status — rendered to a 报关要素表 the forwarder can
 *    work from directly.
 *
 * 2. **A compliance screen** — 单货一致, destination certification requirements,
 *    weight data completeness, and a sanctions pre-screen. Anything that fails
 *    opens a thread with the human rather than quietly shipping.
 *
 * It also backfills HS codes into the product library, so the second time you
 * export an item the classification is already there.
 */

const HsSuggestionSchema = z.object({
  hs_code: z.string().default(''),
  description: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.3),
  rationale: z.string().default(''),
  alternatives: z
    .array(z.object({ code: z.string(), description: z.string(), confidence: z.number().default(0.4) }))
    .default([]),
});

export const customsAgent: AgentDefinition = {
  name: 'customs',
  label: '报关智能体',
  description: '生成报关要素表、HS 编码归类、单货一致与合规校验',
  taskTypes: ['draft_declaration', 'classify_hs_codes', 'compliance_check'],

  async handle(task, ctx) {
    switch (task.taskType) {
      case 'draft_declaration':
        return draftDeclaration(task.payload, ctx);
      case 'classify_hs_codes':
        return classifyHsCodes(task.payload, ctx);
      case 'compliance_check':
        return complianceCheck(task.payload, ctx);
      default:
        return { status: 'skipped', summary: `未知任务类型 ${task.taskType}` };
    }
  },
};

async function draftDeclaration(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const quoteId = String(payload.quoteId ?? '');
  const quote = getQuote(quoteId);
  if (!quote) return { status: 'skipped', summary: `报价单 ${quoteId} 不存在` };

  const result = await generateDeclaration(quote.id);
  if (!result) return { status: 'skipped', summary: '报关要素表生成失败' };

  const customer = getCustomer(quote.customerId);

  ctx.emit({
    type: EVENTS.DECLARATION_DRAFTED,
    entityType: 'quote',
    entityId: quote.id,
    subject: `报关要素表 ${result.declarationNo} 已生成（${result.itemCount} 项）`,
    payload: {
      quoteId: quote.id,
      declarationNo: result.declarationNo,
      itemCount: result.itemCount,
      totals: result.totals,
      passed: result.passed,
      pdfPath: result.pdfPath,
      htmlPath: result.htmlPath,
    },
  });

  const problems = result.compliance.filter((check) => check.status !== 'pass');
  if (problems.length > 0) {
    const failed = result.compliance.filter((check) => check.status === 'fail');
    ctx.emit({
      type: EVENTS.COMPLIANCE_ISSUE,
      entityType: 'quote',
      entityId: quote.id,
      subject: `合规校验：${problems.length} 项待处理（${result.declarationNo}）`,
      payload: {
        quoteId: quote.id,
        declarationNo: result.declarationNo,
        issues: problems,
        blocking: failed.map((check) => check.id),
      },
    });

    if (!findOpenThreadFor('quote', quote.id)) {
      const thread = createThread({
        subject: `业务对齐：${customer?.company ?? quote.quoteNo} 报关合规待处理`,
        topic: 'customs_compliance',
        entityType: 'quote',
        entityId: quote.id,
        severity: failed.length > 0 ? 'critical' : 'warning',
        createdBy: 'agent:customs',
        messages: [
          {
            author: 'agent:customs',
            role: 'agent',
            body: [
              `【报关合规】${quote.quoteNo}（${customer?.company ?? '客户'}）生成报关要素表 ${result.declarationNo} 时发现 ${problems.length} 项待处理：`,
              ...problems.map((check) => `· [${check.status === 'fail' ? '阻塞' : '提示'}] ${check.label}：${check.detail}`),
              '',
              failed.length > 0
                ? '存在阻塞项，请补齐后再安排订舱与报关。'
                : '均为提示项，确认后即可继续。',
            ].join('\n'),
          },
        ],
      });

      createAlert({
        type: 'compliance.issue',
        severity: failed.length > 0 ? 'critical' : 'warning',
        title: `报关合规待处理：${quote.quoteNo}`,
        body: problems.map((check) => check.label).join('、'),
        entityType: 'quote',
        entityId: quote.id,
      });

      ctx.emit({
        type: EVENTS.THREAD_OPENED,
        entityType: 'thread',
        entityId: thread.id,
        subject: `已拉群：${thread.subject}`,
        payload: { threadId: thread.id, quoteId: quote.id, topic: 'customs_compliance' },
      });
    }
  }

  return {
    status: result.passed ? 'succeeded' : 'waiting_approval',
    summary: `报关要素表 ${result.declarationNo} 已生成，${result.compliance.filter((c) => c.status === 'pass').length}/${result.compliance.length} 项校验通过`,
    data: {
      declarationNo: result.declarationNo,
      itemCount: result.itemCount,
      totals: result.totals,
      compliance: result.compliance,
      pdfPath: result.pdfPath,
    },
  };
}

async function classifyHsCodes(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const limit = Number(payload.limit ?? 10);
  const targets = payload.productId
    ? ([getProduct(String(payload.productId), false)].filter(Boolean) as ReturnType<typeof getProduct>[])
    : listProducts({ status: 'active', limit: 500 }).filter((product) => !product.hsCode).slice(0, limit);

  if (targets.length === 0) return { status: 'succeeded', summary: '产品库中所有产品均已归类' };

  const updated: Array<{ sku: string; hsCode: string; confidence: number }> = [];
  const lowConfidence: Array<{ sku: string; name: string; suggestion: number }> = [];

  for (const product of targets) {
    if (!product) continue;
    const { data } = await ctx.ask({
      operation: 'suggest_hs_code',
      schema: HsSuggestionSchema,
      system: [
        'You are a Chinese customs classification specialist.',
        'Propose the most likely 6-digit HS code for an export product.',
        'Base it on the product name, category and material.',
        'If the description is too vague, set confidence below 0.5 rather than guessing.',
        'Return JSON: {hs_code, description, confidence, rationale, alternatives[3]}.',
      ].join('\n'),
      user: [
        `SKU: ${product.sku}`,
        `Name (EN): ${product.nameEn}`,
        `Name (ZH): ${product.nameZh ?? '-'}`,
        `Category: ${product.category ?? '-'}`,
        `Description: ${truncate(product.descriptionEn ?? '', 600)}`,
        `Target markets: ${product.targetMarkets.join(', ') || '-'}`,
      ].join('\n'),
      context: {
        product: {
          name_en: product.nameEn,
          name_zh: product.nameZh,
          category: product.category,
          hs_code: product.hsCode,
        },
      },
      fallback: () => ({ hs_code: '', description: '', confidence: 0.1, rationale: '离线模式无法确定，请人工指定。', alternatives: [] }),
    });

    if (data.hs_code && data.confidence >= 0.55) {
      upsertProduct({ id: product.id, sku: product.sku, nameEn: product.nameEn, hsCode: data.hs_code, hsDescription: data.description });
      updated.push({ sku: product.sku, hsCode: data.hs_code, confidence: data.confidence });
    } else {
      lowConfidence.push({ sku: product.sku, name: product.nameEn, suggestion: data.confidence });
    }
  }

  if (updated.length > 0) {
    ctx.emit({
      type: EVENTS.DECLARATION_DRAFTED,
      entityType: 'product',
      entityId: 'batch',
      subject: `已自动补全 ${updated.length} 个产品的 HS 编码`,
      payload: { updated },
    });
  }

  if (lowConfidence.length > 0 && !findOpenThreadFor('product', 'hs_backlog')) {
    const thread = createThread({
      subject: `业务对齐：${lowConfidence.length} 个产品 HS 编码需人工确认`,
      topic: 'hs_backlog',
      entityType: 'product',
      entityId: 'hs_backlog',
      severity: 'info',
      createdBy: 'agent:customs',
      messages: [
        {
          author: 'agent:customs',
          role: 'agent',
          body: [
            '以下产品描述不足以离线确定 HS 编码，自动归类置信度低于 0.55，已跳过以免误报：',
            ...lowConfidence.map((entry) => `· ${entry.sku} ${entry.name}（置信度 ${entry.suggestion.toFixed(2)}）`),
            '',
            '建议补齐产品规格（材质、用途、工作原理）后重新运行归类，或手动指定编码。',
          ].join('\n'),
        },
      ],
    });
    ctx.emit({
      type: EVENTS.THREAD_OPENED,
      entityType: 'thread',
      entityId: thread.id,
      subject: `已拉群：${thread.subject}`,
      payload: { threadId: thread.id, topic: 'hs_backlog', count: lowConfidence.length },
    });
  }

  return {
    status: 'succeeded',
    summary: `HS 归类：自动补全 ${updated.length} 个，待人工确认 ${lowConfidence.length} 个`,
    data: { updated, lowConfidence },
  };
}

async function complianceCheck(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const quoteId = String(payload.quoteId ?? '');
  const quote = quoteId ? getQuote(quoteId) : listQuotes({ status: 'accepted,draft,pending_approval', limit: 1 })[0];
  if (!quote) return { status: 'skipped', summary: '未找到可校验的报价单' };

  const result = await generateDeclaration(quote.id);
  if (!result) return { status: 'skipped', summary: '合规校验失败' };

  const problems = result.compliance.filter((check) => check.status !== 'pass');
  return {
    status: 'succeeded',
    summary: `合规校验完成：${result.compliance.length - problems.length}/${result.compliance.length} 项通过`,
    data: { compliance: result.compliance, declarationNo: result.declarationNo, checkedAt: nowIso() },
  };
}
