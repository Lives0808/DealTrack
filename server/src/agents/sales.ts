import { z } from 'zod';
import { addDays, nowIso, round, secondsBetween, truncate } from '../core/util.js';
import { EVENTS } from '../core/events.js';
import { getAutomation, getCompany, getSalesIdentity, getSetting, SETTING_KEYS } from '../core/settings.js';
import { detectLanguage, fill, getPhrasebook } from '../core/i18n.js';
import { estimateFreight, priceQuote, type PricedLine } from '../core/pricing.js';
import { guessPort } from '../core/llm/providers.js';
import {
  findByContact,
  getCustomer,
  getInquiry,
  listInquiryItems,
  markFirstResponse,
  replaceInquiryItems,
  updateInquiry,
  upsertCustomer,
  type Customer,
  type Inquiry,
} from '../core/repos/sales.js';
import { listProducts, getProduct, matchProducts, productAliases, type Product } from '../core/repos/catalog.js';
import {
  createQuote,
  getQuote,
  listQuotes,
  recordOutcome,
  updateQuote,
  type Quote,
} from '../core/repos/quoting.js';
import {
  bumpPlaybook,
  createAlert,
  cancelOpenFollowups,
  createMessage,
  getFollowup,
  getMessage,
  markMessageFailed,
  markMessageSent,
  pickPlaybook,
  updateFollowup,
  updateMessage,
} from '../core/repos/engagement.js';
import { deliver } from '../integrations/messaging.js';
import { generateQuotePdf } from '../docgen/quote.js';
import { generatePiPdf } from '../docgen/proforma.js';
import { createProformaInvoice, getPiByQuote, updatePi } from '../core/repos/billing.js';
import type { AgentContext, AgentDefinition, AgentResult } from './types.js';

// ---------------------------------------------------------------------------
// Extraction contract — the shape the Sales Agent needs out of a raw inquiry.
// ---------------------------------------------------------------------------

const ExtractionSchema = z.object({
  language: z.string().default('en'),
  intent: z.string().default('general_inquiry'),
  products: z
    .array(
      z.object({
        name_hint: z.string().default('requested item'),
        sku_hint: z.string().nullable().optional(),
        qty: z.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        target_price: z.number().nullable().optional(),
        currency: z.string().nullable().optional(),
        lead_time_days: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .default([]),
  destination: z.string().nullable().optional(),
  destination_code: z.string().nullable().optional(),
  destination_port: z.string().nullable().optional(),
  incoterm: z.string().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  certifications: z.array(z.string()).default([]),
  urgency: z.string().default('normal'),
  target_lead_time_days: z.number().nullable().optional(),
  missing_info: z.array(z.string()).default([]),
  summary_zh: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const DraftSchema = z.object({
  subject: z.string().default(''),
  body: z.string().default(''),
  language: z.string().default('en'),
});

const SendDecisionSchema = z.object({
  should_send: z.boolean().default(true),
  reason: z.string().default(''),
});

/**
 * Sales Agent (销售智能体)
 *
 * Reads an inquiry, works out what the customer actually wants, prices it from
 * the product library, and drafts the reply in the customer's language.
 *
 * It never sends anything on its own unless `automation.autoSend` is on. Default
 * posture is human-in-the-loop: the agent does the 27 minutes of work, the human
 * spends 3 minutes reviewing and hitting send.
 */
export const salesAgent: AgentDefinition = {
  name: 'sales',
  label: '销售智能体',
  description: '解析询盘、匹配产品库、计算价格、起草多语言报价邮件、建档',
  taskTypes: ['parse_inquiry', 'draft_quote_and_reply', 'send_message', 'classify_inbound', 'analyze_loss', 'reprice_quote', 'create_proforma'],

  async handle(task, ctx) {
    switch (task.taskType) {
      case 'parse_inquiry':
        return parseInquiry(task.payload, ctx);
      case 'draft_quote_and_reply':
        return draftQuoteAndReply(task.payload, ctx);
      case 'send_message':
        return sendMessage(task.payload, ctx);
      case 'classify_inbound':
        return classifyInbound(task.payload, ctx);
      case 'analyze_loss':
        return analyzeLoss(task.payload, ctx);
      case 'reprice_quote':
        return repriceQuote(task.payload, ctx);
      case 'create_proforma':
        return createProforma(task.payload, ctx);
      default:
        return { status: 'skipped', summary: `未知任务类型 ${task.taskType}` };
    }
  },
};

// ---------------------------------------------------------------------------
// 1. parse_inquiry — raw text → structured brief + product matches + customer
// ---------------------------------------------------------------------------

async function parseInquiry(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const inquiryId = String(payload.inquiryId ?? '');
  const inquiry = getInquiry(inquiryId);
  if (!inquiry) return { status: 'skipped', summary: `询盘 ${inquiryId} 不存在` };

  // Keep the subject out of `rawBody`: the extractor treats that as the request
  // itself, and a quantity repeated in both subject and body would be quoted twice.
  const rawBody = inquiry.body ?? '';
  const catalog = listProducts({ status: 'active', limit: 60 }).map((product) => ({
    sku: product.sku,
    name_en: product.nameEn,
    name_zh: product.nameZh ?? '',
    category: product.category ?? '',
    // Localized aliases travel with the catalog so the offline extractor can
    // recognise a Japanese or Spanish product name, not just English/Chinese.
    aliases: productAliases(product),
  }));

  const { data: extracted, usedFallback, response } = await ctx.ask({
    operation: 'extract_inquiry',
    schema: ExtractionSchema,
    system: [
      'You are a senior export sales analyst for a Chinese cross-border trading company.',
      'Read a customer inquiry and extract exactly what is needed to quote it.',
      'Rules:',
      '- Detect the customer language and return its ISO 639-1 code.',
      '- One entry in `products` per distinct item requested. Never invent items.',
      '- If a required detail is absent, leave it null and add a snake_case key to `missing_info`.',
      '- `summary_zh` is a one-line Chinese brief a busy sales manager can read in 3 seconds.',
      '- `confidence` reflects how completely a quote could be prepared from this text alone.',
    ].join('\n'),
    user: [
      `Incoming ${inquiry.channel} inquiry from ${inquiry.fromEmail ?? inquiry.fromPhone ?? 'unknown sender'}.`,
      `Subject: ${inquiry.subject ?? '(none)'}`,
      '',
      'Body:',
      truncate(inquiry.body ?? '', 8000),
      '',
      'Product library sample (match against these where possible):',
      catalog.map((item) => `- ${item.sku} | ${item.name_en}${item.name_zh ? ` / ${item.name_zh}` : ''}${item.category ? ` | ${item.category}` : ''}`).join('\n'),
    ].join('\n'),
    context: { rawBody, subject: inquiry.subject ?? '', catalog },
    fallback: () => fallbackExtraction(inquiry, catalog),
  });

  // ---- Customer resolution / creation (自动建档) ------------------------
  let customer: Customer | null = inquiry.customerId ? getCustomer(inquiry.customerId) : null;
  let customerCreated = false;
  if (!customer) {
    const existing = findByContact({ email: inquiry.fromEmail, whatsapp: inquiry.fromPhone });
    if (existing) {
      customer = existing;
    } else {
      const company = guessCompanyName(inquiry);
      const result = upsertCustomer({
        company,
        contactName: inquiry.fromName ?? null,
        email: inquiry.fromEmail ?? null,
        whatsapp: inquiry.channel === 'whatsapp' ? inquiry.fromPhone ?? null : null,
        country: extracted.destination ?? null,
        countryCode: extracted.destination_code ?? null,
        language: extracted.language,
        source: inquiry.channel === 'whatsapp' ? 'whatsapp' : 'email',
        status: 'lead',
        tags: [inquiry.channel],
      });
      customer = result.customer;
      customerCreated = result.created;
      if (customerCreated) {
        ctx.emit({
          type: EVENTS.CUSTOMER_CREATED,
          entityType: 'customer',
          entityId: customer.id,
          subject: `新客户档案：${customer.company}`,
          payload: { company: customer.company, email: customer.email, language: customer.language, source: customer.source },
        });
      }
    }
    updateInquiry(inquiry.id, { customerId: customer.id });
  } else {
    // Enrich whatever the parse revealed. The inbound layer creates a skeleton
    // customer from the message headers (name, email, phone) and has no idea
    // which market they are in — that only becomes clear once the inquiry is
    // read. `upsertCustomer` never overwrites a field with an empty value, so
    // anything a human already confirmed stays put.
    const patch: Parameters<typeof upsertCustomer>[0] = { id: customer.id, company: customer.company };
    let enriched = false;
    if (extracted.destination && !customer.country) {
      patch.country = extracted.destination;
      patch.countryCode = extracted.destination_code ?? customer.countryCode ?? undefined;
      enriched = true;
    }
    if (extracted.language && customer.language !== extracted.language) {
      // The mail the customer actually wrote is better evidence than the
      // guess we made from a bare email header.
      patch.language = extracted.language;
      enriched = true;
    }
    if (!customer.contactName && inquiry.fromName) {
      patch.contactName = inquiry.fromName;
      enriched = true;
    }
    if (enriched) {
      upsertCustomer(patch);
      customer = getCustomer(customer.id);
    }
  }

  // ---- Product matching (产品库匹配) ------------------------------------
  const matches: Inquiry['productMatches'] = [];
  const matchedItems: Array<Record<string, unknown>> = [];

  for (const line of extracted.products) {
    const query = [line.name_hint, line.sku_hint].filter(Boolean).join(' ');
    const candidates = matchProducts(query, { limit: 3, destination: extracted.destination, minScore: 2 });
    const best = candidates[0];
    if (best) {
      matches.push({
        productId: best.product.id,
        sku: best.product.sku,
        nameEn: best.product.nameEn,
        score: best.score,
      });
    }
    matchedItems.push({
      rawText: line.name_hint,
      productId: best?.product.id ?? null,
      sku: best?.product.sku ?? line.sku_hint ?? null,
      description: best?.product.nameEn ?? line.name_hint,
      qty: line.qty ?? null,
      unit: line.unit ?? best?.product.unit ?? 'pcs',
      targetPrice: line.target_price ?? null,
      currency: line.currency ?? null,
      leadTimeDays: line.lead_time_days ?? null,
      matchConfidence: best ? Math.min(0.98, best.score / 12) : 0.2,
      notes: line.notes ?? null,
    });
  }

  if (matchedItems.length > 0) {
    replaceInquiryItems(inquiry.id, matchedItems);
  }

  const matchedCount = matches.length;
  const totalLines = matchedItems.length;
  const needsHuman =
    extracted.confidence < 0.55 || totalLines === 0 || (totalLines > 0 && matchedCount === 0);

  updateInquiry(inquiry.id, {
    language: extracted.language,
    detectedIntent: extracted.intent,
    parsed: extracted as unknown as Record<string, unknown>,
    parseConfidence: extracted.confidence,
    productMatches: matches,
    missingInfo: extracted.missing_info,
    summaryZh: extracted.summary_zh,
    status: 'parsed',
    priority: extracted.urgency === 'urgent' ? 'urgent' : extracted.urgency === 'high' ? 'high' : inquiry.priority,
  });

  ctx.log('parsed inquiry', {
    language: extracted.language,
    intent: extracted.intent,
    lines: totalLines,
    matched: matchedCount,
    confidence: extracted.confidence,
    provider: response.provider,
    synthetic: usedFallback || response.synthetic,
  });

  const refreshed = getInquiry(inquiry.id)!;
  ctx.emit({
    type: EVENTS.INQUIRY_PARSED,
    entityType: 'inquiry',
    entityId: inquiry.id,
    subject: `已解析 ${inquiry.code}：${matchedCount}/${totalLines} 行匹配到产品库`,
    payload: {
      inquiryId: inquiry.id,
      code: inquiry.code,
      customerId: refreshed.customerId,
      language: extracted.language,
      intent: extracted.intent,
      confidence: extracted.confidence,
      matchedProducts: matches.length,
      totalLines,
      needsHuman,
      missingInfo: extracted.missing_info,
    },
  });

  if (needsHuman) {
    ctx.emit({
      type: EVENTS.INQUIRY_NEEDS_INFO,
      entityType: 'inquiry',
      entityId: inquiry.id,
      subject: `${inquiry.code} 需要人工确认`,
      payload: {
        inquiryId: inquiry.id,
        reason:
          totalLines === 0
            ? '未能从询盘中提取到产品行'
            : matchedCount === 0
              ? '提取到的产品行未能匹配产品库'
              : '解析置信度偏低',
        confidence: extracted.confidence,
        missingInfo: extracted.missing_info,
      },
    });
  }

  return {
    status: 'succeeded',
    summary: `解析完成（语言 ${extracted.language}，${matchedCount}/${totalLines} 行匹配产品库）`,
    data: { inquiryId: inquiry.id, confidence: extracted.confidence, matched: matchedCount, lines: totalLines, needsHuman },
  };
}

function fallbackExtraction(
  inquiry: Inquiry,
  catalog: Array<{ sku: string; name_en: string; name_zh: string; category: string }>,
): Extraction {
  const body = `${inquiry.subject ?? ''}\n${inquiry.body ?? ''}`;
  const language = detectLanguage(body);
  const qtyMatch = /(\d[\d,]*)\s*(pcs|pieces|units?|sets?|cartons?|ctns?|kg|tons?|个|件|套|箱)/i.exec(body);
  const priceMatch = /(?:usd|us\$|\$)\s*([\d.,]+)/i.exec(body);
  const incoterm = /\b(FOB|CIF|CFR|EXW|DDP|DAP|FCA)\b/i.exec(body)?.[1]?.toUpperCase() ?? null;
  const lowered = body.toLowerCase();
  const hit = catalog.find((item) =>
    [item.name_en, item.name_zh, item.category]
      .filter(Boolean)
      .some((value) => value.length > 3 && lowered.includes(value.toLowerCase())),
  );
  const qty = qtyMatch ? Number(qtyMatch[1]!.replace(/,/g, '')) : null;

  const missing: string[] = [];
  if (!qty) missing.push('quantity');
  if (!incoterm) missing.push('incoterm');

  return {
    language,
    intent: 'general_inquiry',
    products: [
      {
        name_hint: hit?.name_en ?? inquiry.subject ?? 'requested item',
        sku_hint: hit?.sku ?? null,
        qty,
        unit: qtyMatch?.[2]?.toLowerCase() ?? 'pcs',
        target_price: priceMatch ? Number(priceMatch[1]!.replace(/,/g, '')) : null,
        currency: priceMatch ? 'USD' : null,
        lead_time_days: null,
        notes: null,
      },
    ],
    destination: null,
    destination_port: null,
    incoterm,
    payment_terms: null,
    certifications: [],
    urgency: 'normal',
    target_lead_time_days: null,
    missing_info: missing,
    summary_zh: `离线解析：语言 ${language}${qty ? `，数量 ${qty}` : ''}${incoterm ? `，条款 ${incoterm}` : ''}`,
    confidence: 0.4,
  };
}

function guessCompanyName(inquiry: Inquiry): string {
  const fromName = inquiry.fromName?.trim();
  if (fromName && fromName.length > 1) return fromName;
  const email = inquiry.fromEmail ?? '';
  const domain = email.split('@')[1]?.split('.')[0];
  if (domain && !['gmail', 'yahoo', 'hotmail', 'outlook', 'qq', '163', '126'].includes(domain)) {
    return domain.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (inquiry.channel === 'whatsapp' && inquiry.fromPhone) return `WhatsApp ${inquiry.fromPhone}`;
  return `潜在客户 ${inquiry.code}`;
}

// ---------------------------------------------------------------------------
// 2. draft_quote_and_reply — price it, then write the reply in their language
// ---------------------------------------------------------------------------

async function draftQuoteAndReply(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const inquiryId = String(payload.inquiryId ?? '');
  const inquiry = getInquiry(inquiryId);
  if (!inquiry) return { status: 'skipped', summary: `询盘 ${inquiryId} 不存在` };
  if (!inquiry.customerId) return { status: 'skipped', summary: '询盘尚未关联客户' };

  const customer = getCustomer(inquiry.customerId)!;
  const company = getCompany();
  const sales = getSalesIdentity();
  const automation = getAutomation();
  const items = listInquiryItems(inquiry.id);

  const candidates = items.map((item) => ({ item, product: item.productId ? getProduct(item.productId) : null }));
  const costable = candidates.filter((entry): entry is { item: typeof items[number]; product: Product } =>
    Boolean(entry.product),
  );
  // Lines the agent could not match to the product library.
  //
  // v1 silently dropped these, so a customer asking for three items could get a
  // quotation for two and nobody would notice until the order came up short.
  // They now become an explicit "to be confirmed" block in the reply, an alert,
  // and a note on the quote.
  const unmatched = candidates
    .filter((entry) => !entry.product)
    .map((entry) => entry.item.rawText ?? entry.item.description ?? '未识别行');

  if (costable.length === 0) {
    // Nothing to price. Draft a clarifying reply instead of guessing at numbers.
    const stage = 'first_reply';
    const { data: draft } = await ctx.ask({
      operation: 'draft_reply',
      schema: DraftSchema,
      system: 'You write short, professional B2B export replies. Never invent prices.',
      user: `Draft a reply asking the customer for the missing details: ${inquiry.missingInfo.join(', ') || 'quantity, destination port, target price'}.`,
      context: {
        stage,
        language: customer.language,
        contactName: customer.contactName,
        customerCompany: customer.company,
        sellerCompany: company.name,
        senderName: sales.senderName,
        senderRole: sales.senderRole,
        code: inquiry.code,
        missingInfo: inquiry.missingInfo.length ? inquiry.missingInfo : ['quantity', 'destination_port', 'target_price'],
        marketCount: company.marketCount,
      },
      fallback: () => ({ subject: fill(getPhrasebook(customer.language).subject.firstReply, { code: inquiry.code }), body: '', language: customer.language }),
    });

    const message = createMessage({
      channel: inquiry.channel === 'whatsapp' ? 'whatsapp' : 'email',
      inquiryId: inquiry.id,
      customerId: customer.id,
      toAddr: (inquiry.channel === 'whatsapp' ? customer.whatsapp : customer.email) ?? customer.email ?? '',
      fromAddr: sales.senderEmail,
      subject: draft.subject || fill(getPhrasebook(customer.language).subject.firstReply, { code: inquiry.code }),
      body: draft.body,
      language: customer.language,
      status: 'pending_approval',
      createdBy: 'agent:sales',
    });

    ctx.emit({
      type: EVENTS.MESSAGE_DRAFTED,
      entityType: 'message',
      entityId: message.id,
      subject: `已起草补充信息邮件（${inquiry.code}）`,
      payload: { messageId: message.id, inquiryId: inquiry.id, kind: 'needs_info' },
    });

    return {
      status: 'waiting_approval',
      summary: '无可报价行，已起草澄清邮件待人工确认',
      data: { messageId: message.id, inquiryId: inquiry.id },
    };
  }

  // ---- Pricing ---------------------------------------------------------
  const incoterm = ((inquiry.parsed?.incoterm as string) || company.defaultIncoterm).toUpperCase();
  const currency = (costable[0]!.item.currency ?? company.defaultCurrency).toUpperCase();

  // Get the named place right: FOB/FCA/EXW name the port of ORIGIN, while
  // CIF/CFR/CIP/CPT/DAP/DDP name the port of DESTINATION. Writing "CIF Shenzhen"
  // to a Brazilian buyer is the kind of detail that costs credibility.
  const destinationPort =
    (inquiry.parsed?.destination_port as string | undefined) ||
    (customer.country ? guessPort(customer.country) : null) ||
    customer.country ||
    company.defaultPort;
  const deliveredTerm = ['CIF', 'CFR', 'CIP', 'CPT', 'DAP', 'DDP'].includes(incoterm);
  const place = deliveredTerm ? destinationPort : company.defaultPort;

  const totalQty = costable.reduce((sum, entry) => sum + (entry.item.qty ?? entry.product.moq), 0);
  const totalCbm = costable.reduce((sum, entry) => sum + (entry.product.cbm ?? 0.02) * (entry.item.qty ?? 1), 0);
  const totalWeight = costable.reduce((sum, entry) => sum + (entry.product.grossWeightKg ?? 0.5) * (entry.item.qty ?? 1), 0);
  const needsFreight = deliveredTerm;
  const freight = needsFreight
    ? estimateFreight({ cbm: totalCbm, weightKg: totalWeight, qty: totalQty, destination: customer.country ?? undefined, incoterm })
    : null;

  const priced = priceQuote(
    costable.map((entry) => ({
      product: {
        id: entry.product.id,
        sku: entry.product.sku,
        nameEn: entry.product.nameEn,
        nameZh: entry.product.nameZh,
        unit: entry.product.unit,
        moq: entry.product.moq,
        hsCode: entry.product.hsCode,
        certifications: entry.product.certifications,
        targetMarkets: entry.product.targetMarkets,
        grossWeightKg: entry.product.grossWeightKg,
        cbm: entry.product.cbm,
      },
      qty: entry.item.qty ?? entry.product.moq,
      unit: entry.item.unit ?? entry.product.unit,
      note: entry.item.rawText ?? undefined,
    })),
    {
      currency,
      incoterm,
      incotermPlace: place,
      freight: freight?.amount ?? 0,
      insurance: needsFreight ? round((freight?.amount ?? 0) * 0.003, 2) : 0,
      otherFees: 0,
      customerTier: customer.tier,
      customerCountry: customer.countryCode ?? customer.country ?? undefined,
    },
  );

  const validUntilDays = 30;
  const partialNote =
    unmatched.length > 0
      ? `以下行项目未能匹配产品库，未包含在本报价中，需人工确认：${unmatched.join('；')}`
      : '';
  const quote = createQuote({
    inquiryId: inquiry.id,
    customerId: customer.id,
    currency: priced.currency,
    incoterm: priced.incoterm,
    incotermPlace: priced.incotermPlace,
    validUntil: addDays(validUntilDays),
    paymentTerms: (inquiry.parsed?.payment_terms as string) || company.paymentTerms,
    leadTimeDays: priced.leadTimeDays,
    moq: priced.moq,
    language: customer.language,
    createdBy: 'agent:sales',
    notes: freight ? `${freight.note}（${freight.mode}）` : null,
    internalNotes: [partialNote, ...priced.warnings].filter(Boolean).join('\n') || null,
    status: 'draft',
    totals: {
      subtotal: priced.subtotal,
      discountPct: priced.discountPct,
      discountAmount: priced.discountAmount,
      freight: priced.freight,
      insurance: priced.insurance,
      otherFees: priced.otherFees,
      total: priced.total,
      costTotal: priced.costTotal,
      marginPct: priced.marginPct,
      marginAmount: priced.marginAmount,
    },
    items: priced.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      unitPrice: line.unitPrice,
      amount: line.amount,
      unitCost: line.unitCost,
      costCurrency: priced.currency,
      hsCode: line.hsCode,
      leadTimeDays: line.leadTimeDays,
      notes: line.note ?? null,
    })),
    priceBreakdown: priced.lines.map((line) => ({ sku: line.sku, ...line.costBreakdown, marginPct: line.marginPct })),
    appliedRules: priced.appliedRules,
  });

  // The PDF is generated now so the human only has to check and click send.
  let pdfPath: string | null = null;
  try {
    pdfPath = await generateQuotePdf(quote.id);
    if (pdfPath) updateQuote(quote.id, { pdf_path: pdfPath });
  } catch (error) {
    ctx.log('quote pdf generation failed', error instanceof Error ? error.message : error);
  }

  ctx.emit({
    type: EVENTS.QUOTE_CREATED,
    entityType: 'quote',
    entityId: quote.id,
    subject: `已生成报价单 ${quote.quoteNo}（${quote.currency} ${quote.total.toFixed(2)}）`,
    payload: {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      inquiryId: inquiry.id,
      customerId: customer.id,
      total: quote.total,
      currency: quote.currency,
      marginPct: quote.marginPct,
      incoterm: quote.incoterm,
      lines: priced.lines.length,
      warnings: priced.warnings,
    },
  });

  if (unmatched.length > 0) {
    ctx.emit({
      type: EVENTS.QUOTE_PARTIAL_MATCH,
      entityType: 'quote',
      entityId: quote.id,
      subject: `${quote.quoteNo} 有 ${unmatched.length} 行未匹配产品库，未计入报价`,
      payload: {
        quoteId: quote.id,
        inquiryId: inquiry.id,
        unmatchedLines: unmatched,
        pricedLines: priced.lines.length,
      },
    });

    createAlert({
      type: 'quote.partial_match',
      severity: 'warning',
      title: `报价不完整：${quote.quoteNo}`,
      body: `客户询盘中有 ${unmatched.length} 行未能匹配产品库，本报价未包含：${unmatched.join('、')}。请补齐产品库或人工补充报价后再发送。`,
      entityType: 'quote',
      entityId: quote.id,
    });

  }

  // ---- Multilingual reply draft (话术库 + LLM) ---------------------------
  const reply = await composeReply({
    ctx,
    inquiry,
    customer,
    quote,
    pricedLines: priced.lines,
    stage: 'quote_cover',
    extra: { freightNote: freight?.note ?? null, validUntilDays },
    unmatchedLines: unmatched,
  });

  ctx.emit({
    type: EVENTS.MESSAGE_DRAFTED,
    entityType: 'message',
    entityId: reply.id,
    subject: `已起草报价邮件（${inquiry.code} → ${customer.company}）`,
    payload: {
      messageId: reply.id,
      inquiryId: inquiry.id,
      quoteId: quote.id,
      language: customer.language,
      channel: reply.channel,
    },
  });

  // A partial quote must never leave without a human looking at it, even in a
  // shop that has turned auto-send on. Losing a line item is worse than losing a
  // minute.
  const autoApproved = automation.autoSend && unmatched.length === 0;
  if (unmatched.length > 0) {
    updateQuote(quote.id, { status: 'pending_approval' });
  }

  return {
    status: autoApproved ? 'succeeded' : 'waiting_approval',
    summary: `已报价 ${quote.quoteNo}（${quote.currency} ${quote.total.toFixed(2)}，毛利 ${((quote.marginPct ?? 0) * 100).toFixed(1)}%），邮件草稿待确认`,
    data: {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      messageId: reply.id,
      total: quote.total,
      currency: quote.currency,
      marginPct: quote.marginPct,
      warnings: priced.warnings,
    },
  };
}

interface ComposeInput {
  ctx: AgentContext;
  inquiry: Inquiry;
  customer: Customer;
  quote: Quote;
  pricedLines: PricedLine[];
  stage: string;
  extra?: Record<string, unknown>;
  /** Inquiry lines with no product-library match, surfaced to the customer. */
  unmatchedLines?: string[];
}

/**
 * Builds the outbound draft.
 *
 * Order of operations matters: the playbook (话术库) supplies the skeleton and
 * house voice, the LLM personalises it, and the phrasebook guarantees the
 * greeting/closing are native. If the model is unavailable the filled playbook
 * is already a sendable email — never a blank page.
 */
export async function composeReply(input: ComposeInput): Promise<{ id: string; channel: string; subject: string; body: string }> {
  const { ctx, inquiry, customer, quote, pricedLines, stage } = input;
  const company = getCompany();
  const sales = getSalesIdentity();
  const book = getPhrasebook(customer.language);
  const channel = inquiry.channel === 'whatsapp' ? 'whatsapp' : 'email';

  const unmatchedLines = input.unmatchedLines ?? [];
  const playbook = pickPlaybook(stage, customer.language, channel === 'whatsapp' ? 'whatsapp' : 'email');
  const vars = {
    code: quote.quoteNo || inquiry.code,
    company: company.name,
    customer_company: customer.company,
    contact_name: customer.contactName ?? '',
    sender_name: sales.senderName,
    sender_role: sales.senderRole,
    currency: quote.currency,
    total: quote.total.toFixed(2),
    incoterm: quote.incoterm,
    port: quote.incotermPlace,
    lead_time: quote.leadTimeDays ?? 15,
    payment_terms: quote.paymentTerms ?? company.paymentTerms,
    valid_until: quote.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 10) : '',
    product_list: pricedLines.map((line) => `${line.description} ${line.qty}${line.unit}`).join('; '),
    company_full: company.name,
  };
  const playbookBody = playbook ? renderTemplate(playbook.bodyTpl, vars) : '';
  const playbookSubject = playbook?.subjectTpl ? renderTemplate(playbook.subjectTpl, vars) : '';

  const { data: draft } = await ctx.ask({
    operation: stage === 'quote_cover' ? 'draft_quote_email' : 'draft_followup',
    schema: DraftSchema,
    system: [
      'You are an experienced export salesperson writing to an overseas buyer.',
      `Write in ${customer.language}. Match the buyer's formality.`,
      'Hard rules:',
      '- Never invent prices, lead times, certifications or stock levels.',
      '- Use only the figures supplied in the data block.',
      '- Keep it under 180 words. Buyers skim.',
      '- End with exactly one clear next step.',
      '- Return JSON: {"subject": string, "body": string, "language": string}.',
    ].join('\n'),
    user: [
      `Stage: ${stage}`,
      `Customer: ${customer.company} (${customer.contactName ?? 'contact'}) in ${customer.country ?? 'unknown market'}`,
      `Language: ${customer.language}`,
      '',
      'Quote data:',
      JSON.stringify(
        {
          quote_no: quote.quoteNo,
          currency: quote.currency,
          incoterm: `${quote.incoterm} ${quote.incotermPlace}`,
          total: quote.total,
          lead_time_days: quote.leadTimeDays,
          payment_terms: quote.paymentTerms,
          valid_until: quote.validUntil,
          lines: pricedLines.map((line) => ({
            item: line.description,
            qty: `${line.qty} ${line.unit}`,
            unit_price: line.unitPrice,
            amount: line.amount,
          })),
        },
        null,
        2,
      ),
      unmatchedLines.length > 0
        ? `\nIMPORTANT: these requested items could NOT be matched to our catalogue and are deliberately NOT priced. Ask the customer to confirm them; do not invent prices for them:\n${unmatchedLines.map((line) => `- ${line}`).join('\n')}`
        : '',
      playbookBody ? `\nHouse style reference (话术库「${playbook?.name}」)：\n${playbookBody}` : '',
    ].join('\n'),
    context: {
      stage,
      language: customer.language,
      contactName: customer.contactName,
      customerCompany: customer.company,
      sellerCompany: company.name,
      senderName: sales.senderName,
      senderRole: sales.senderRole,
      code: quote.quoteNo || inquiry.code,
      currency: quote.currency,
      total: quote.total,
      incoterm: quote.incoterm,
      incotermPlace: quote.incotermPlace,
      leadTimeDays: quote.leadTimeDays ?? 15,
      paymentTerms: quote.paymentTerms,
      validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 10) : '30 days',
      marketCount: company.marketCount,
      missingInfo: inquiry.missingInfo,
      unmatchedLines,
      playbookBody,
      channel,
      lines: pricedLines.map((line) => ({
        description: line.description,
        qty: line.qty,
        unit: line.unit,
        unitPrice: line.unitPrice,
        amount: line.amount,
      })),
    },
    fallback: () => ({
      subject: playbookSubject || fill(book.subject.quote, { code: quote.quoteNo, company: customer.company }),
      body:
        playbookBody ||
        [
          customer.contactName ? fill(book.greeting, { name: customer.contactName }) : book.greetingGeneric,
          '',
          fill(book.quoteReady, { code: quote.quoteNo }),
          '',
          pricedLines
            .map(
              (line) =>
                `• ${line.description} — ${line.qty} ${line.unit} × ${quote.currency} ${line.unitPrice.toFixed(2)} = ${quote.currency} ${line.amount.toFixed(2)}`,
            )
            .join('\n'),
          '',
          `${quote.incoterm} ${quote.incotermPlace} · ${quote.paymentTerms ?? company.paymentTerms} · ${fill(book.leadTimeNote, { days: quote.leadTimeDays ?? 15 })}`,
          unmatchedLines.length > 0
            ? `${book.missingInfoIntro}\n${unmatchedLines.map((line) => `  • ${line}`).join('\n')}`
            : '',
          book.ctaReply,
          '',
          [book.closing, sales.senderName, sales.senderRole, company.name].filter(Boolean).join('\n'),
        ].join('\n'),
      language: customer.language,
    }),
  });

  const subject = draft.subject || playbookSubject || fill(book.subject.quote, { code: quote.quoteNo, company: customer.company });
  const body = draft.body || playbookBody;

  const toAddr = channel === 'whatsapp' ? customer.whatsapp ?? customer.phone ?? '' : customer.email ?? '';
  const message = createMessage({
    channel,
    inquiryId: inquiry.id,
    quoteId: quote.id,
    customerId: customer.id,
    toAddr,
    fromAddr: sales.senderEmail,
    subject,
    body,
    language: customer.language,
    status: 'pending_approval',
    createdBy: 'agent:sales',
  });

  if (playbook) {
    try {
      bumpPlaybook(playbook.id, 'usage_count');
    } catch {
      /* usage tracking is best-effort */
    }
  }
  updateQuote(quote.id, { status: 'pending_approval' });
  return { id: message.id, channel, subject, body };
}

export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{?\s*([a-z_][a-z0-9_]*)\s*\}?\}/gi, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? match : String(value);
  });
}

// ---------------------------------------------------------------------------
// 3. send_message — the only place mail actually leaves the building
// ---------------------------------------------------------------------------

async function sendMessage(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const messageId = String(payload.messageId ?? '');
  const message = getMessage(messageId);
  if (!message) return { status: 'skipped', summary: `消息 ${messageId} 不存在` };
  if (message.status === 'sent') return { status: 'skipped', summary: '消息已发送' };
  if (!message.toAddr) {
    markMessageFailed(message.id, '缺少收件地址');
    return { status: 'skipped', summary: '缺少收件地址，无法发送' };
  }

  const quote = message.quoteId ? getQuote(message.quoteId, false) : null;
  const attachments =
    quote && message.channel === 'email'
      ? await (async () => {
          const { getQuotePdfPath } = await import('../docgen/quote.js');
          const path = (await getQuotePdfPath(quote.id)) ?? (await generateQuotePdf(quote.id));
          return path ? [{ filename: `${quote.quoteNo}.pdf`, path, contentType: 'application/pdf' }] : undefined;
        })()
      : undefined;

  const result = await deliver({
    channel: message.channel,
    toAddr: message.toAddr,
    fromAddr: message.fromAddr,
    subject: message.subject,
    body: message.body,
    attachments,
  });

  if (!result.ok) {
    markMessageFailed(message.id, result.error ?? 'unknown error');
    ctx.emit({
      type: EVENTS.MESSAGE_FAILED,
      entityType: 'message',
      entityId: message.id,
      subject: `发送失败：${result.error ?? '未知错误'}`,
      payload: { messageId: message.id, channel: message.channel, error: result.error },
    });
    throw new Error(`发送失败：${result.error}`);
  }

  markMessageSent(message.id, { provider: result.provider, providerMessageId: result.providerMessageId });
  updateMessage(message.id, { approved_by: 'system', approved_at: nowIso() });

  let firstResponseSeconds: number | null = null;
  if (message.inquiryId) {
    firstResponseSeconds = markFirstResponse(message.inquiryId);
    updateInquiry(message.inquiryId, { status: 'quoted', quotedAt: nowIso() });
  }

  if (message.followupId) {
    updateFollowup(message.followupId, {
      status: 'sent',
      lastAttemptAt: nowIso(),
      attempts: 1,
      subject: message.subject,
      body: message.body,
    });
  }

  ctx.emit({
    type: EVENTS.MESSAGE_SENT,
    entityType: 'message',
    entityId: message.id,
    subject: `${result.simulated ? '[模拟] ' : ''}已发送 → ${message.toAddr}`,
    payload: {
      messageId: message.id,
      channel: message.channel,
      inquiryId: message.inquiryId,
      quoteId: message.quoteId,
      followupId: message.followupId,
      simulated: result.simulated,
      provider: result.provider,
      firstResponseSeconds,
    },
  });

  if (firstResponseSeconds !== null) {
    ctx.emit({
      type: EVENTS.INQUIRY_STATUS_CHANGED,
      entityType: 'inquiry',
      entityId: message.inquiryId!,
      subject: `首次响应用时 ${formatDuration(firstResponseSeconds)}`,
      payload: { inquiryId: message.inquiryId, firstResponseSeconds, status: 'quoted' },
    });
  }

  if (message.followupId) {
    const followup = getFollowup(message.followupId);
    if (followup) {
      ctx.emit({
        type: EVENTS.FOLLOWUP_SENT,
        entityType: 'followup',
        entityId: followup.id,
        subject: `第 ${followup.sequenceNo} 次跟进已发出`,
        payload: { followupId: followup.id, inquiryId: followup.inquiryId, sequenceNo: followup.sequenceNo },
      });
    }
  }

  return {
    status: 'succeeded',
    summary: `${result.simulated ? '[模拟] ' : ''}已发送 ${message.channel} → ${message.toAddr}`,
    data: { messageId: message.id, simulated: result.simulated, firstResponseSeconds },
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

// ---------------------------------------------------------------------------
// 4. classify_inbound — a customer replied. Decide what it means and react.
// ---------------------------------------------------------------------------

const InboundSchema = z.object({
  intent: z.string().default('general_inquiry'),
  confidence: z.number().min(0).max(1).default(0.5),
  language: z.string().default('en'),
  summary_zh: z.string().default(''),
  sentiment: z.string().default('neutral'),
});

async function classifyInbound(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const inquiryId = String(payload.inquiryId ?? '');
  const body = String(payload.body ?? '');
  const inquiry = getInquiry(inquiryId);
  if (!inquiry) return { status: 'skipped', summary: `询盘 ${inquiryId} 不存在` };
  if (!inquiry.customerId) return { status: 'skipped', summary: '询盘未关联客户' };

  const { data: classified } = await ctx.ask({
    operation: 'classify_intent',
    schema: InboundSchema,
    system: [
      'Classify a buyer reply in a B2B export conversation.',
      'Intents: rfq, price_objection, lead_time_question, certification_question, payment_question,',
      'sample_request, order_placement, rejection, complaint, shipping_question, general_inquiry.',
      'Return JSON only.',
    ].join('\n'),
    user: `Reply text:\n${truncate(body, 4000)}`,
    context: { rawBody: body },
    fallback: () => ({
      intent: guessIntent(body),
      confidence: 0.45,
      language: detectLanguage(body),
      summary_zh: `离线分类：${guessIntent(body)}`,
      sentiment: /thank|great|perfect|excellent|满意|好的/i.test(body) ? 'positive' : 'neutral',
    }),
  });

  // A reply always cancels the pending nudges — that is the whole point of a
  // follow-up engine: stop chasing people who already answered.
  const cancelled = cancelOpenFollowups({ inquiryId: inquiry.id }, `客户回复（${classified.intent}）`);
  cancelOpenFollowups({ customerId: inquiry.customerId }, `客户回复（${classified.intent}）`);

  updateInquiry(inquiry.id, {
    detectedIntent: classified.intent,
    language: classified.language || inquiry.language,
    priority: classified.intent === 'rejection' || classified.intent === 'complaint' ? 'high' : inquiry.priority,
  });

  ctx.emit({
    type: EVENTS.FOLLOWUP_REPLIED,
    entityType: 'inquiry',
    entityId: inquiry.id,
    subject: `客户回复：${classified.intent}（已停止 ${cancelled} 条待发跟进）`,
    payload: { inquiryId: inquiry.id, intent: classified.intent, cancelled, confidence: classified.confidence },
  });

  // Route by intent.
  const openQuotes = listQuotes({ inquiryId: inquiry.id, limit: 5 });
  const latestQuote = openQuotes[0] ?? null;

  switch (classified.intent) {
    case 'order_placement': {
      if (latestQuote) {
        recordOutcome({ quoteId: latestQuote.id, result: 'won', decidedBy: 'agent:sales', reasonNote: '客户邮件确认下单' });
        updateInquiry(inquiry.id, { status: 'won', wonAt: nowIso() });
        // `recordOutcome` emits `quote.accepted`; nothing to do here.
      }
      break;
    }

    case 'rejection': {
      if (latestQuote) {
        const { data: loss } = await ctx.ask({
          operation: 'loss_reason',
          schema: z.object({ reason_code: z.string().default('other'), confidence: z.number().default(0.4) }),
          system: 'Classify why a deal was lost. Reason codes: price, lead_time, quality, payment_terms, moq, certification, shipping, competitor, no_budget, no_response, spec_mismatch, other. Return JSON only.',
          user: `Customer said:\n${truncate(body, 2000)}`,
          context: { note: body },
          fallback: () => ({ reason_code: 'other', confidence: 0.3 }),
        });
        recordOutcome({
          quoteId: latestQuote.id,
          result: 'lost',
          reasonCode: loss.reason_code,
          reasonNote: truncate(body, 500),
          decidedBy: 'agent:sales',
        });
        updateInquiry(inquiry.id, { status: 'lost', lostAt: nowIso() });
        ctx.emit({
          type: EVENTS.QUOTE_REJECTED,
          entityType: 'quote',
          entityId: latestQuote.id,
          subject: `丢单：${latestQuote.quoteNo}（${loss.reason_code}）`,
          payload: { quoteId: latestQuote.id, inquiryId: inquiry.id, reasonCode: loss.reason_code },
        });
      }
      break;
    }

    case 'price_objection':
    case 'lead_time_question':
    case 'certification_question':
    case 'payment_question':
    case 'sample_request': {
      const stage = classified.intent === 'price_objection' ? 'objection_price' : 'objection_leadtime';
      const customer = getCustomer(inquiry.customerId)!;
      if (latestQuote) {
        const draft = await composeReply({
          ctx,
          inquiry,
          customer,
          quote: latestQuote,
          pricedLines: [],
          stage,
        });
        ctx.emit({
          type: EVENTS.MESSAGE_DRAFTED,
          entityType: 'message',
          entityId: draft.id,
          subject: `已起草应对「${classified.intent}」的回复`,
          payload: { messageId: draft.id, inquiryId: inquiry.id, quoteId: latestQuote.id, kind: classified.intent },
        });
        return {
          status: 'waiting_approval',
          summary: `客户${intentLabel(classified.intent)}，已起草应答待确认`,
          data: { messageId: draft.id, intent: classified.intent },
        };
      }
      break;
    }

    default:
      break;
  }

  return {
    status: 'succeeded',
    summary: `已分类客户回复：${intentLabel(classified.intent)}`,
    data: { intent: classified.intent, confidence: classified.confidence, cancelledFollowups: cancelled },
  };
}

function intentLabel(intent: string): string {
  const labels: Record<string, string> = {
    rfq: '询价',
    price_objection: '嫌贵',
    lead_time_question: '问交期',
    certification_question: '问认证',
    payment_question: '问付款',
    sample_request: '要样品',
    order_placement: '确认下单',
    rejection: '明确拒绝',
    complaint: '投诉',
    shipping_question: '问物流',
    general_inquiry: '一般咨询',
  };
  return labels[intent] ?? intent;
}

function guessIntent(text: string): string {
  const lowered = text.toLowerCase();
  if (/place order|purchase order|confirm the order|下单|订单确认/.test(lowered)) return 'order_placement';
  if (/too expensive|too high|better price|discount|太贵|贵了|descuento/.test(lowered)) return 'price_objection';
  if (/not interested|we decided|another supplier|不考虑|已经找到/.test(lowered)) return 'rejection';
  if (/lead time|delivery time|交期|货期/.test(lowered)) return 'lead_time_question';
  if (/certificat|认证/.test(lowered)) return 'certification_question';
  if (/payment|付款|deposit/.test(lowered)) return 'payment_question';
  if (/sample|样品/.test(lowered)) return 'sample_request';
  return 'general_inquiry';
}

// ---------------------------------------------------------------------------
// 5. analyze_loss / 6. reprice_quote
// ---------------------------------------------------------------------------

async function analyzeLoss(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const quoteId = String(payload.quoteId ?? '');
  const note = String(payload.note ?? '');
  const { data } = await ctx.ask({
    operation: 'loss_reason',
    schema: z.object({ reason_code: z.string().default('other'), confidence: z.number().default(0.4) }),
    system: 'Classify why a deal was lost. Return JSON only.',
    user: truncate(note, 2000),
    context: { note },
    fallback: () => ({ reason_code: 'other', confidence: 0.3 }),
  });
  return { status: 'succeeded', summary: `丢单原因判定为 ${data.reason_code}`, data: { quoteId, ...data } };
}

/**
 * Turn a won quote into a proforma invoice plus its payment milestones.
 *
 * This is the step v1 was missing: winning a deal only flipped a status, leaving
 * the operator to build the PI by hand in Word — which gave back most of the
 * time the rest of the pipeline had saved.
 */
async function createProforma(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const quoteId = String(payload.quoteId ?? '');
  const quote = getQuote(quoteId);
  if (!quote) return { status: 'skipped', summary: `报价单 ${quoteId} 不存在` };

  const existing = getPiByQuote(quote.id);
  if (existing) return { status: 'skipped', summary: `已有形式发票 ${existing.piNo}` };

  const company = getCompany();
  const pi = createProformaInvoice({
    quoteId: quote.id,
    bankInfo: company.bankInfo,
    paymentTerms: quote.paymentTerms ?? company.paymentTerms,
    notes: payload.notes ? String(payload.notes) : null,
  });
  if (!pi) return { status: 'skipped', summary: '形式发票生成失败' };

  let pdfPath: string | null = null;
  try {
    pdfPath = await generatePiPdf(quote.id);
    if (pdfPath) updatePi(pi.id, { pdf_path: pdfPath });
  } catch (error) {
    ctx.log('PI pdf generation failed', error instanceof Error ? error.message : error);
  }

  ctx.emit({
    type: EVENTS.PROFORMA_ISSUED,
    entityType: 'proforma',
    entityId: pi.id,
    subject: `已生成形式发票 ${pi.piNo}（定金 ${pi.currency} ${pi.depositAmount.toFixed(2)}）`,
    payload: {
      piId: pi.id,
      piNo: pi.piNo,
      quoteId: quote.id,
      customerId: quote.customerId,
      total: pi.total,
      currency: pi.currency,
      depositPct: pi.depositPct,
      depositAmount: pi.depositAmount,
      balanceAmount: pi.balanceAmount,
      milestones: (pi.milestones ?? []).map((milestone) => ({
        id: milestone.id,
        label: milestone.label,
        amount: milestone.amount,
        dueAt: milestone.dueAt,
      })),
    },
  });

  return {
    status: 'succeeded',
    summary: `形式发票 ${pi.piNo} 已生成，含 ${pi.milestones?.length ?? 0} 个回款节点`,
    data: { piId: pi.id, piNo: pi.piNo, depositAmount: pi.depositAmount, balanceAmount: pi.balanceAmount },
  };
}

async function repriceQuote(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const quoteId = String(payload.quoteId ?? '');
  const quote = getQuote(quoteId);
  if (!quote) return { status: 'skipped', summary: `报价单 ${quoteId} 不存在` };
  if (!quote.inquiryId) return { status: 'skipped', summary: '报价单未关联询盘，无法重算' };
  ctx.emit({
    type: EVENTS.QUOTE_UPDATED,
    entityType: 'quote',
    entityId: quote.id,
    subject: `重新计算 ${quote.quoteNo}`,
    payload: { quoteId: quote.id },
  });
  return draftQuoteAndReply({ inquiryId: quote.inquiryId }, ctx);
}
