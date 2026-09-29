import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { getDb } from '../../core/db.js';
import { EVENTS } from '../../core/events.js';
import { getAutomation } from '../../core/settings.js';
import { addDays, nowIso } from '../../core/util.js';
import { generateDeclaration } from '../../docgen/declaration.js';
import { buildQuoteHtml, generateQuotePdf } from '../../docgen/quote.js';
import { buildQuoteHtml as _buildQuoteHtml } from '../../docgen/quote.js';
import {
  LOSS_REASON_LABELS,
  LOSS_REASONS,
  expiringQuotes,
  getQuote,
  listOutcomes,
  listQuotes,
  recordOutcome,
  updateQuote,
} from '../../core/repos/quoting.js';
import {
  bumpPlaybook,
  cancelOpenFollowups,
  createMessage,
  followupStats,
  getFollowup,
  listFollowups,
  listPlaybooks,
  upsertPlaybook,
  updateFollowup,
} from '../../core/repos/engagement.js';
import { getCustomer, getInquiry } from '../../core/repos/sales.js';
import { dispatch } from '../../agents/orchestrator.js';
import { actorOf, body, fail, intParam, ok, query } from '../context.js';

export function registerDealRoutes(app: FastifyInstance): void {
  // =========================================================================
  // Quotes (报价历史)
  // =========================================================================

  app.get('/api/quotes', async (request) => {
    const params = query<{
      status?: string;
      customerId?: string;
      inquiryId?: string;
      search?: string;
      limit?: string;
      offset?: string;
    }>(request);

    const quotes = listQuotes({
      status: params.status ?? 'all',
      customerId: params.customerId,
      inquiryId: params.inquiryId,
      search: params.search,
      limit: intParam(params.limit, 100),
      offset: intParam(params.offset, 0),
    });

    return ok(
      quotes.map((quote) => ({
        ...quote,
        customer: getCustomer(quote.customerId),
        outcome: listOutcomes({ quoteId: quote.id, limit: 1 })[0] ?? null,
      })),
    );
  });

  app.get('/api/quotes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    return ok({
      ...quote,
      inquiry: quote.inquiryId ? getInquiry(quote.inquiryId, false) : null,
      outcome: listOutcomes({ quoteId: quote.id, limit: 5 }),
      declaration: existsSync(quote.pdfPath ?? '')
        ? { pdfPath: quote.pdfPath }
        : null,
    });
  });

  /** Approve a quote for release. */
  app.post('/api/quotes/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    updateQuote(quote.id, {
      status: quote.sentAt ? quote.status : 'sent',
      approved_by: actorOf(request),
      approved_at: nowIso(),
    });

    // Fire the follow-up cadence immediately: the moment a price is on the table,
    // the clock on "不漏跟" starts.
    dispatch({ agent: 'followup', taskType: 'schedule_followups', payload: { quoteId: quote.id }, dedupeKey: `schedule:${quote.id}` });

    return ok(getQuote(quote.id));
  });

  app.patch('/api/quotes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));
    updateQuote(quote.id, body(request));
    return ok(getQuote(quote.id));
  });

  /** Send the quote's cover email right now. */
  app.post('/api/quotes/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    const db = getDb();
    const existing = db.get<Record<string, unknown>>(
      `SELECT id FROM outbound_messages WHERE quote_id = ? AND status IN ('pending_approval', 'draft')
       ORDER BY created_at DESC LIMIT 1`,
      quote.id,
    );

    let messageId: string;
    if (existing) {
      messageId = String(existing.id);
    } else {
      const customer = getCustomer(quote.customerId)!;
      const message = createMessage({
        channel: 'email',
        inquiryId: quote.inquiryId,
        quoteId: quote.id,
        customerId: quote.customerId,
        toAddr: customer.email ?? '',
        subject: `Quotation ${quote.quoteNo}`,
        body: `Please find our quotation ${quote.quoteNo} attached.\n\nTotal: ${quote.currency} ${quote.total.toFixed(2)} ${quote.incoterm} ${quote.incotermPlace}`,
        language: quote.language,
        status: 'pending_approval',
        createdBy: 'user:api',
      });
      messageId = message.id;
    }

    updateQuote(quote.id, { status: 'sent', sent_at: nowIso(), approved_by: actorOf(request), approved_at: nowIso() });
    dispatch({ agent: 'sales', taskType: 'send_message', payload: { messageId }, dedupeKey: `send:${messageId}`, runNow: true, priority: 5 });
    dispatch({ agent: 'followup', taskType: 'schedule_followups', payload: { quoteId: quote.id }, dedupeKey: `schedule:${quote.id}` });

    return ok({ quoteId: quote.id, messageId, sending: true });
  });

  /** Mark won/lost — the feedback loop that trains the playbook. */
  app.post('/api/quotes/:id/outcome', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    const input = body<{
      result?: 'won' | 'lost' | 'no_response' | 'pending';
      reasonCode?: string;
      reasonNote?: string;
      competitor?: string;
      finalPrice?: number;
    }>(request);

    const result = input.result ?? 'lost';
    const outcome = recordOutcome({
      quoteId: quote.id,
      result,
      reasonCode: input.reasonCode ?? null,
      reasonNote: input.reasonNote ?? null,
      competitor: input.competitor ?? null,
      finalPrice: input.finalPrice ?? quote.total,
      decidedBy: actorOf(request),
    });

    if (quote.inquiryId) {
      const { updateInquiry } = await import('../../core/repos/sales.js');
      updateInquiry(quote.inquiryId, {
        status: result === 'won' ? 'won' : result === 'lost' ? 'lost' : 'nurturing',
        wonAt: result === 'won' ? nowIso() : undefined,
        lostAt: result === 'lost' ? nowIso() : undefined,
      });
    }

    cancelOpenFollowups({ inquiryId: quote.inquiryId ?? undefined }, `结果已登记：${result}`);

    if (result === 'won') {
      dispatch({ agent: 'customs', taskType: 'draft_declaration', payload: { quoteId: quote.id }, dedupeKey: `declaration:${quote.id}` });
      app.log.info(`[deals] quote ${quote.quoteNo} won`);
    }

    return ok(outcome);
  });

  app.get('/api/quotes/:id/document', async (request, reply) => {
    const { id } = request.params as { id: string };
    const params = query<{ format?: 'pdf' | 'html' }>(request);
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    if (params.format === 'html') {
      const built = buildQuoteHtml(quote.id);
      if (!built) return reply.code(404).send(fail('无法生成文档', 404, 'not_found'));
      return reply.type('text/html; charset=utf-8').send(built.html);
    }

    const path = await generateQuotePdf(quote.id);
    if (!path) return reply.code(404).send(fail('无法生成报价文档', 404, 'not_found'));

    const { readFileSync } = await import('node:fs');
    if (path.endsWith('.pdf')) {
      return reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="${basename(path)}"`)
        .send(readFileSync(path));
    }
    const built = buildQuoteHtml(quote.id);
    return reply.type('text/html; charset=utf-8').send(built?.html ?? readFileSync(path, 'utf8'));
  });

  app.get('/api/quotes/expiring', async () => {
    return ok(expiringQuotes(72).map((quote) => ({ ...quote, customer: getCustomer(quote.customerId) })));
  });

  app.get('/api/loss-reasons', async () => {
    return ok({ reasons: LOSS_REASONS.map((code) => ({ code, label: LOSS_REASON_LABELS[code] ?? code })) });
  });

  // =========================================================================
  // Follow-ups (跟进看板)
  // =========================================================================

  app.get('/api/followups', async (request) => {
    const params = query<{ status?: string; customerId?: string; inquiryId?: string; dueBefore?: string; limit?: string }>(request);
    const followups = listFollowups({
      status: params.status ?? 'all',
      customerId: params.customerId,
      inquiryId: params.inquiryId,
      dueBefore: params.dueBefore,
      limit: intParam(params.limit, 200),
    });

    return ok(
      followups.map((followup) => ({
        ...followup,
        customer: getCustomer(followup.customerId),
        overdueMinutes: Math.round((Date.now() - new Date(followup.dueAt).getTime()) / 60_000),
        quote: followup.quoteId ? getQuote(followup.quoteId, false) : null,
      })),
    );
  });

  app.get('/api/followups/stats', async () => ok(followupStats()));

  app.post('/api/followups/:id/draft', async (request) => {
    const { id } = request.params as { id: string };
    const task = dispatch({ agent: 'followup', taskType: 'draft_followup', payload: { followupId: id }, dedupeKey: `draft_followup:${id}`, runNow: true });
    return ok({ taskId: task?.id ?? null });
  });

  app.post('/api/followups/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    const followup = getFollowup(id);
    if (!followup) return reply.code(404).send(fail('跟进记录不存在', 404, 'not_found'));

    const db = getDb();
    const message = db.get<Record<string, unknown>>(
      `SELECT id FROM outbound_messages WHERE followup_id = ? AND status IN ('pending_approval', 'draft')
       ORDER BY created_at DESC LIMIT 1`,
      followup.id,
    );

    if (!message) {
      dispatch({ agent: 'followup', taskType: 'draft_followup', payload: { followupId: followup.id }, dedupeKey: `draft_followup:${followup.id}`, runNow: true });
      return ok({ followupId: followup.id, drafting: true });
    }

    dispatch({ agent: 'sales', taskType: 'send_message', payload: { messageId: String(message.id) }, dedupeKey: `send:${message.id}`, runNow: true, priority: 5 });
    return ok({ followupId: followup.id, messageId: String(message.id), sending: true });
  });

  app.post('/api/followups/:id/snooze', async (request, reply) => {
    const { id } = request.params as { id: string };
    const followup = getFollowup(id);
    if (!followup) return reply.code(404).send(fail('跟进记录不存在', 404, 'not_found'));
    const input = body<{ days?: number; hours?: number; until?: string }>(request);
    const until = input.until ?? addDays(input.days ?? 3, new Date());
    updateFollowup(followup.id, { status: 'scheduled', snoozedUntil: until, dueAt: until });
    return ok(getFollowup(followup.id));
  });

  app.post('/api/followups/:id/skip', async (request, reply) => {
    const { id } = request.params as { id: string };
    const followup = getFollowup(id);
    if (!followup) return reply.code(404).send(fail('跟进记录不存在', 404, 'not_found'));
    updateFollowup(followup.id, { status: 'skipped', completedAt: nowIso(), reason: body<{ reason?: string }>(request).reason ?? '人工跳过' });
    return ok(getFollowup(followup.id));
  });

  /** Rebuild the whole cadence for a quote (after changing the automation settings). */
  app.post('/api/followups/resequence', async (request, reply) => {
    const input = body<{ quoteId?: string }>(request);
    if (!input.quoteId) return reply.code(400).send(fail('quoteId 必填'));
    cancelOpenFollowups({ inquiryId: getQuote(input.quoteId, false)?.inquiryId ?? undefined }, '重新排程');
    dispatch({
      agent: 'followup',
      taskType: 'schedule_followups',
      payload: { quoteId: input.quoteId },
      dedupeKey: `schedule:${input.quoteId}`,
      runNow: true,
    });
    return ok({ quoteId: input.quoteId, resequenced: true, cadence: getAutomation().followupCadenceDays });
  });

  // =========================================================================
  // Playbooks (话术库)
  // =========================================================================

  app.get('/api/playbooks', async (request) => {
    const params = query<{ stage?: string; language?: string; channel?: string; activeOnly?: string }>(request);
    return ok(
      listPlaybooks({
        stage: params.stage,
        language: params.language,
        channel: params.channel,
        activeOnly: params.activeOnly !== 'false',
      }),
    );
  });

  app.post('/api/playbooks', async (request, reply) => {
    const input = body<{ name?: string; bodyTpl?: string } & Record<string, unknown>>(request);
    if (!input.name || !input.bodyTpl) return reply.code(400).send(fail('name 与 bodyTpl 必填'));
    return reply.code(201).send(ok(upsertPlaybook(input as never)));
  });

  app.patch('/api/playbooks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = listPlaybooks({ activeOnly: false }).find((book) => book.id === id);
    if (!existing) return reply.code(404).send(fail('话术不存在', 404, 'not_found'));
    const input = body<Record<string, unknown>>(request);
    const saved = upsertPlaybook({
      id: existing.id,
      name: (input.name as string) ?? existing.name,
      bodyTpl: (input.bodyTpl as string) ?? existing.bodyTpl,
      ...input,
    } as never);
    return ok(saved);
  });

  /** Attribute a win to a playbook — this is how the 话术库 gets smarter. */
  app.post('/api/playbooks/:id/win', async (request) => {
    const { id } = request.params as { id: string };
    bumpPlaybook(id, 'win_count');
    return ok({ id, recorded: 'win' });
  });

  app.post('/api/playbooks/:id/reply', async (request) => {
    const { id } = request.params as { id: string };
    bumpPlaybook(id, 'reply_count');
    return ok({ id, recorded: 'reply' });
  });

  // =========================================================================
  // Customs declarations (报关)
  // =========================================================================

  app.post('/api/quotes/:id/declaration', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    const result = await generateDeclaration(quote.id);
    if (!result) return reply.code(400).send(fail('报关要素表生成失败'));

    return ok({
      declarationNo: result.declarationNo,
      itemCount: result.itemCount,
      totals: result.totals,
      compliance: result.compliance,
      passed: result.passed,
      pdfPath: result.pdfPath,
      htmlPath: result.htmlPath,
    });
  });

  app.get('/api/quotes/:id/declaration', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));
    const result = await generateDeclaration(quote.id);
    if (!result) return reply.code(400).send(fail('报关要素表生成失败'));
    const { readFileSync } = await import('node:fs');
    if (result.pdfPath && result.pdfPath.endsWith('.pdf')) {
      return reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="${result.declarationNo}.pdf"`)
        .send(readFileSync(result.pdfPath));
    }
    return reply.type('text/html; charset=utf-8').send(readFileSync(result.htmlPath, 'utf8'));
  });
}

export { _buildQuoteHtml, EVENTS };
