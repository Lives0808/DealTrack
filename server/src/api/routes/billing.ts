import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getDb } from '../../core/db.js';
import { EVENTS } from '../../core/events.js';
import { addDays, nowIso } from '../../core/util.js';
import { getQuote, listQuotes, recordOutcome, updateQuote } from '../../core/repos/quoting.js';
import {
  createMilestone,
  createProformaInvoice,
  getPi,
  getPiByQuote,
  listMilestones,
  listPis,
  markMilestonePaid,
  paymentSummary,
  quoteRevisionChain,
  reviseQuote,
  updateMilestone,
  updatePi,
} from '../../core/repos/billing.js';
import { getCustomer } from '../../core/repos/sales.js';
import { buildPiHtml, generatePiPdf } from '../../docgen/proforma.js';
import { dispatch } from '../../agents/orchestrator.js';
import { actorOf, body, fail, intParam, ok, query } from '../context.js';

/**
 * Closing the deal: proforma invoices, revisions and money.
 *
 * Everything here is about the gap between "the customer said yes" and "the
 * money is in the bank" — which is where v1 stopped.
 */
export function registerBillingRoutes(app: FastifyInstance): void {
  // =========================================================================
  // Proforma invoices
  // =========================================================================

  app.get('/api/proformas', async (request) => {
    const params = query<{ status?: string; customerId?: string; limit?: string }>(request);
    const invoices = listPis({
      status: params.status ?? 'all',
      customerId: params.customerId,
      limit: intParam(params.limit, 100),
    });
    return ok(
      invoices.map((pi) => ({
        ...pi,
        customer: getCustomer(pi.customerId),
        quote: undefined,
      })),
    );
  });

  app.get('/api/proformas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pi = getPi(id);
    if (!pi) return reply.code(404).send(fail('形式发票不存在', 404, 'not_found'));
    return ok({ ...pi, customer: getCustomer(pi.customerId) });
  });

  /** The PI for a quote, if one has been issued. */
  app.get('/api/quotes/:id/proforma', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));
    const pi = getPiByQuote(quote.id);
    if (!pi) return reply.code(404).send(fail('该报价尚未生成形式发票', 404, 'not_found'));
    return ok({ ...pi, customer: getCustomer(pi.customerId) });
  });

  /** Issue (or re-issue) the PI for a quote. */
  app.post('/api/quotes/:id/proforma', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    const existing = getPiByQuote(quote.id);
    if (existing) return ok({ ...existing, reused: true });

    const input = body<{
      depositPct?: number;
      bankInfo?: string;
      paymentTerms?: string;
      notes?: string;
      shipmentDate?: string;
      language?: string;
    }>(request);

    const pi = createProformaInvoice({
      quoteId: quote.id,
      depositPct: input.depositPct,
      bankInfo: input.bankInfo,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      shipmentDate: input.shipmentDate,
    });
    if (!pi) return reply.code(400).send(fail('形式发票生成失败'));

    try {
      const pdfPath = await generatePiPdf(quote.id);
      if (pdfPath) updatePi(pi.id, { pdf_path: pdfPath });
    } catch {
      /* the HTML fallback is still produced */
    }

    return reply.code(201).send(ok(getPi(pi.id)));
  });

  app.get('/api/quotes/:id/proforma/document', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    const params = query<{ format?: 'pdf' | 'html' }>(request);
    const pi = getPiByQuote(quote.id) ?? createProformaInvoice({ quoteId: quote.id });
    if (!pi) return reply.code(400).send(fail('形式发票生成失败'));

    if (params.format === 'html') {
      const built = buildPiHtml(quote.id);
      if (!built) return reply.code(404).send(fail('无法生成文档', 404, 'not_found'));
      return reply.type('text/html; charset=utf-8').send(built.html);
    }

    const path = await generatePiPdf(quote.id);
    if (!path) return reply.code(404).send(fail('无法生成形式发票', 404, 'not_found'));
    if (path.endsWith('.pdf')) {
      return reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="${basename(path)}"`)
        .send(readFileSync(path));
    }
    const built = buildPiHtml(quote.id);
    return reply.type('text/html; charset=utf-8').send(built?.html ?? readFileSync(path, 'utf8'));
  });

  app.patch('/api/proformas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pi = getPi(id);
    if (!pi) return reply.code(404).send(fail('形式发票不存在', 404, 'not_found'));
    updatePi(pi.id, body(request));
    return ok(getPi(pi.id));
  });

  // =========================================================================
  // Payments (回款)
  // =========================================================================

  app.get('/api/payments', async (request) => {
    const params = query<{ status?: string; customerId?: string; dueBefore?: string; limit?: string }>(request);
    const milestones = listMilestones({
      status: params.status ?? 'all',
      customerId: params.customerId,
      dueBefore: params.dueBefore,
      limit: intParam(params.limit, 200),
    });
    return ok(
      milestones.map((milestone) => ({
        ...milestone,
        customer: getCustomer(milestone.customerId),
        pi: milestone.piId ? getPi(milestone.piId) : null,
      })),
    );
  });

  app.get('/api/payments/summary', async (request) => {
    const params = query<{ days?: string }>(request);
    const since = addDays(-intParam(params.days, 365));
    return ok(paymentSummary(since));
  });

  /** Mark a milestone paid — the one action that closes the loop. */
  app.post('/api/payments/:id/paid', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = body<{ amount?: number; method?: string; note?: string; paidAt?: string }>(request);
    const milestone = markMilestonePaid({
      id,
      amount: input.amount,
      method: input.method ?? actorOf(request),
      note: input.note,
      paidAt: input.paidAt,
    });
    if (!milestone) return reply.code(404).send(fail('回款节点不存在', 404, 'not_found'));

    // A payment landing changes what is overdue, so refresh the sweep.
    dispatch({ agent: 'followup', taskType: 'sweep_payments', payload: {} });

    return ok({
      ...milestone,
      customer: getCustomer(milestone.customerId),
      pi: milestone.piId ? getPi(milestone.piId) : null,
    });
  });

  app.patch('/api/payments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    updateMilestone(id, body(request));
    const updated = listMilestones({ limit: 1000 }).find((entry) => entry.id === id);
    if (!updated) return reply.code(404).send(fail('回款节点不存在', 404, 'not_found'));
    return ok(updated);
  });

  /** Add an ad-hoc milestone (e.g. a negotiated third instalment). */
  app.post('/api/proformas/:id/milestones', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pi = getPi(id);
    if (!pi) return reply.code(404).send(fail('形式发票不存在', 404, 'not_found'));
    const input = body<{ label?: string; amount?: number; dueAt?: string; note?: string }>(request);
    if (!input.amount) return reply.code(400).send(fail('amount 必填'));

    const milestone = createMilestone({
      piId: pi.id,
      quoteId: pi.quoteId,
      customerId: pi.customerId,
      label: input.label ?? 'installment',
      sequenceNo: (pi.milestones?.length ?? 0) + 1,
      amount: input.amount,
      currency: pi.currency,
      dueAt: input.dueAt ?? addDays(30),
      note: input.note ?? null,
    });
    return reply.code(201).send(ok(milestone));
  });

  /** Ask the follow-up agent to draft a reminder right now. */
  app.post('/api/payments/:id/remind', async (request) => {
    const { id } = request.params as { id: string };
    const task = dispatch({
      agent: 'followup',
      taskType: 'draft_payment_reminder',
      payload: { milestoneId: id },
      dedupeKey: `payremind:${id}:manual:${Date.now()}`,
      runNow: true,
      priority: 5,
    });
    return ok({ taskId: task?.id ?? null, drafting: true });
  });

  // =========================================================================
  // Quote revision (改版)
  // =========================================================================

  app.post('/api/quotes/:id/revise', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));

    const input = body<{
      reason?: string;
      discountPct?: number;
      freight?: number;
      incoterm?: string;
      incotermPlace?: string;
      paymentTerms?: string;
      leadTimeDays?: number;
      marginDeltaPct?: number;
    }>(request);

    if (!input.reason || input.reason.trim().length < 2) {
      return reply.code(400).send(fail('必须说明改版原因（用于复盘报价过程）'));
    }

    const revised = reviseQuote({
      quoteId: quote.id,
      reason: input.reason.trim(),
      createdBy: actorOf(request),
      discountPct: input.discountPct,
      freight: input.freight,
      incoterm: input.incoterm,
      incotermPlace: input.incotermPlace,
      paymentTerms: input.paymentTerms,
      leadTimeDays: input.leadTimeDays,
      marginDeltaPct: input.marginDeltaPct,
    });
    if (!revised) return reply.code(400).send(fail('改版失败'));

    return reply.code(201).send(
      ok({
        quote: revised,
        previous: { quoteNo: quote.quoteNo, total: quote.total, marginPct: quote.marginPct },
        delta: {
          total: Number((revised.total - quote.total).toFixed(2)),
          marginPct: Number(((revised.marginPct ?? 0) - (quote.marginPct ?? 0)).toFixed(4)),
        },
      }),
    );
  });

  app.get('/api/quotes/:id/revisions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));
    return ok(
      quoteRevisionChain(quote.id).map((entry) => ({
        id: entry.id,
        quoteNo: entry.quoteNo,
        version: entry.version,
        total: entry.total,
        currency: entry.currency,
        marginPct: entry.marginPct,
        status: entry.status,
        revisionReason: entry.revisionReason,
        createdAt: entry.createdAt,
      })),
    );
  });

  // =========================================================================
  // Rewrite analytics — is the AI's wording actually being used?
  // =========================================================================

  app.get('/api/analytics/rewrites', async (request) => {
    const params = query<{ days?: string }>(request);
    const since = addDays(-intParam(params.days, 30));
    const db = getDb();

    const rows = db.all<Record<string, unknown>>(
      `SELECT COALESCE(f.intent, 'quote_cover') AS stage,
              COUNT(*) AS sent,
              SUM(CASE WHEN m.original_body IS NOT NULL THEN 1 ELSE 0 END) AS rewritten
         FROM outbound_messages m
         LEFT JOIN followups f ON f.id = m.followup_id
        WHERE m.status = 'sent' AND m.created_at >= ?
        GROUP BY stage ORDER BY sent DESC`,
      since,
    );

    const totals = rows.reduce<{ sent: number; rewritten: number }>(
      (acc, row) => ({
        sent: acc.sent + Number(row.sent ?? 0),
        rewritten: acc.rewritten + Number(row.rewritten ?? 0),
      }),
      { sent: 0, rewritten: 0 },
    );

    return ok({
      since,
      sent: totals.sent,
      rewritten: totals.rewritten,
      rewriteRate: totals.sent > 0 ? Number((totals.rewritten / totals.sent).toFixed(3)) : 0,
      byStage: rows.map((row) => {
        const sent = Number(row.sent ?? 0);
        const rewritten = Number(row.rewritten ?? 0);
        return {
          stage: String(row.stage),
          sent,
          rewritten,
          rewriteRate: sent > 0 ? Number((rewritten / sent).toFixed(3)) : 0,
        };
      }),
    });
  });

  /** Side-by-side of what the agent wrote vs what a human sent. */
  app.get('/api/messages/:id/rewrite', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = getDb().get<Record<string, unknown>>('SELECT * FROM outbound_messages WHERE id = ?', id);
    if (!row) return reply.code(404).send(fail('消息不存在', 404, 'not_found'));
    if (!row.original_body) {
      return ok({ rewritten: false, detail: '这封草稿是原样发出的，没有被人工修改。' });
    }
    return ok({
      rewritten: true,
      editor: row.edited_by,
      editedAt: row.edited_at,
      agent: { subject: row.original_subject, body: row.original_body },
      sent: { subject: row.subject, body: row.body },
    });
  });

  // =========================================================================
  // Deal outcome helpers
  // =========================================================================

  /** Open quotes with no outcome yet — the "what do I need to chase" list. */
  app.get('/api/quotes/open', async (request) => {
    const params = query<{ limit?: string }>(request);
    const quotes = listQuotes({ status: 'sent,pending_approval,draft', limit: intParam(params.limit, 100) });
    return ok(
      quotes.map((quote) => ({
        id: quote.id,
        quoteNo: quote.quoteNo,
        customer: getCustomer(quote.customerId),
        total: quote.total,
        currency: quote.currency,
        status: quote.status,
        validUntil: quote.validUntil,
        marginPct: quote.marginPct,
        daysToExpiry: quote.validUntil
          ? Math.floor((new Date(quote.validUntil).getTime() - Date.now()) / 86_400_000)
          : null,
      })),
    );
  });

  app.post('/api/quotes/:id/close', async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = getQuote(id, false);
    if (!quote) return reply.code(404).send(fail('报价单不存在', 404, 'not_found'));
    const input = body<{ result?: string; reasonCode?: string; reasonNote?: string }>(request);
    if (!input.result) return reply.code(400).send(fail('result 必填'));

    const outcome = recordOutcome({
      quoteId: quote.id,
      result: input.result as 'won' | 'lost' | 'no_response' | 'pending',
      reasonCode: input.reasonCode ?? null,
      reasonNote: input.reasonNote ?? null,
      decidedBy: actorOf(request),
    });

    // `recordOutcome` emits `quote.accepted`, and the orchestrator's routing
    // table fans that out to the proforma invoice and the customs declaration.
    return ok(outcome);
  });

  app.get('/api/events/recent', async (request) => {
    const params = query<{ limit?: string }>(request);
    const rows = getDb().all<Record<string, unknown>>(
      'SELECT * FROM events ORDER BY created_at DESC LIMIT ?',
      intParam(params.limit, 50),
    );
    return ok(rows.map((row) => ({ id: row.id, type: row.type, subject: row.subject, createdAt: row.created_at })));
  });
}

export { EVENTS, nowIso };
