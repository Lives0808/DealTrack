import type { FastifyInstance } from 'fastify';
import { getDb } from '../../core/db.js';
import { EVENTS } from '../../core/events.js';
import { ingestInbound, ingestManual, type Channel } from '../../core/ingest.js';
import { getAutomation } from '../../core/settings.js';
import { generateQuotePdf } from '../../docgen/quote.js';
import { markMessageSent } from '../../core/repos/engagement.js';
import {
  customerHistory,
  customerStats,
  getCustomer,
  getInquiry,
  inquiryTimeline,
  listCustomers,
  listInquiries,
  listInquiryItems,
  updateInquiry,
  upsertCustomer,
} from '../../core/repos/sales.js';
import { listMessages, updateMessage } from '../../core/repos/engagement.js';
import { listQuotes } from '../../core/repos/quoting.js';
import { dispatch } from '../../agents/orchestrator.js';
import { actorOf, body, fail, intParam, ok, query } from '../context.js';
import { nowIso } from '../../core/util.js';

export function registerInboxRoutes(app: FastifyInstance): void {
  // =========================================================================
  // Inquiries (询盘箱)
  // =========================================================================

  app.get('/api/inquiries', async (request) => {
    const params = query<{
      status?: string;
      customerId?: string;
      channel?: string;
      search?: string;
      ownerId?: string;
      limit?: string;
      offset?: string;
      orderBy?: 'recent' | 'sla' | 'value';
    }>(request);

    const items = listInquiries({
      status: params.status ?? 'all',
      customerId: params.customerId,
      channel: params.channel,
      search: params.search,
      ownerId: params.ownerId,
      limit: intParam(params.limit, 100),
      offset: intParam(params.offset, 0),
      orderBy: params.orderBy ?? 'recent',
    });

    return ok(
      items.map((inquiry) => ({
        ...inquiry,
        customer: inquiry.customerId ? getCustomer(inquiry.customerId) : null,
        quoteCount: listQuotes({ inquiryId: inquiry.id, limit: 3 }).length,
      })),
    );
  });

  app.get('/api/inquiries/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const inquiry = getInquiry(id);
    if (!inquiry) return reply.code(404).send(fail('询盘不存在', 404, 'not_found'));

    return ok({
      ...inquiry,
      items: query<Record<string, string>>(request).items === 'false' ? undefined : listInquiryItems(inquiry.id),
      quotes: listQuotes({ inquiryId: inquiry.id, limit: 20 }),
      messages: listMessages({ inquiryId: inquiry.id, limit: 50 }),
      timeline: inquiryTimeline(inquiry.id),
      sla: slaState(inquiry),
    });
  });

  /** Manual ingest — the "粘贴一封询盘" path. Triggers the whole pipeline. */
  app.post('/api/inquiries', async (request, reply) => {
    const input = body<{
      company?: string;
      contactName?: string;
      email?: string;
      phone?: string;
      channel?: Channel;
      subject?: string;
      body?: string;
      autoRun?: boolean;
    }>(request);

    if (!input.body || input.body.trim().length < 3) {
      return reply.code(400).send(fail('询盘正文不能为空'));
    }

    const result = ingestManual({
      company: input.company,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      channel: input.channel ?? 'manual',
      subject: input.subject,
      body: input.body,
    });

    if (input.autoRun !== false) {
      dispatch({
        agent: 'sales',
        taskType: 'parse_inquiry',
        payload: { inquiryId: result.inquiry.id },
        dedupeKey: `parse:${result.inquiry.id}`,
        runNow: true,
      });
    }

    return reply.code(201).send(
      ok({
        inquiry: result.inquiry,
        customer: result.customer,
        isReply: result.isReply,
        created: result.created,
      }),
    );
  });

  /** Re-run parsing (after a human corrected the raw text). */
  app.post('/api/inquiries/:id/parse', async (request) => {
    const { id } = request.params as { id: string };
    const task = dispatch({
      agent: 'sales',
      taskType: 'parse_inquiry',
      payload: { inquiryId: id },
      dedupeKey: `parse:${id}`,
      runNow: true,
    });
    return ok({ taskId: task?.id ?? null, inquiryId: id });
  });

  /** Ask the Sales Agent to price it and draft the reply, right now. */
  app.post('/api/inquiries/:id/quote', async (request) => {
    const { id } = request.params as { id: string };
    const task = dispatch({
      agent: 'sales',
      taskType: 'draft_quote_and_reply',
      payload: { inquiryId: id },
      dedupeKey: `draft_quote:${id}`,
      runNow: true,
    });
    return ok({ taskId: task?.id ?? null, inquiryId: id });
  });

  app.patch('/api/inquiries/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const inquiry = getInquiry(id, false);
    if (!inquiry) return reply.code(404).send(fail('询盘不存在', 404, 'not_found'));
    updateInquiry(inquiry.id, body(request));
    return ok(getInquiry(inquiry.id));
  });

  /** Log a customer message by hand (phone call summary, trade-show chat…). */
  app.post('/api/inquiries/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const inquiry = getInquiry(id, false);
    if (!inquiry) return reply.code(404).send(fail('询盘不存在', 404, 'not_found'));

    const input = body<{ body: string; channel?: Channel; fromEmail?: string; autoClassify?: boolean }>(request);
    if (!input.body) return reply.code(400).send(fail('消息正文不能为空'));

    const result = ingestInbound({
      channel: input.channel ?? inquiry.channel as Channel,
      fromEmail: input.fromEmail ?? inquiry.fromEmail,
      fromName: inquiry.fromName,
      fromPhone: inquiry.fromPhone,
      subject: inquiry.subject,
      body: input.body,
      threadId: inquiry.threadId,
    });

    if (input.autoClassify !== false) {
      dispatch({
        agent: 'sales',
        taskType: 'classify_inbound',
        payload: { inquiryId: result.inquiry.id, body: input.body },
        // Same key shape the `message.received` route uses, so the manual
        // "record reply" button and the inbox poller can't both classify it.
        dedupeKey: `classify:${result.inquiry.id}:${result.messageId}`,
        runNow: true,
      });
    }
    return ok({ inquiryId: result.inquiry.id, messageId: result.messageId });
  });

  // =========================================================================
  // Customers (客户库)
  // =========================================================================

  app.get('/api/customers', async (request) => {
    const params = query<{ status?: string; search?: string; country?: string; limit?: string; withStats?: string }>(request);
    const customers = listCustomers({
      status: params.status ?? 'all',
      search: params.search,
      country: params.country,
      limit: intParam(params.limit, 200),
    });
    return ok(
      params.withStats === 'false'
        ? customers
        : customers.map((customer) => ({ ...customer, stats: customerStats(customer.id) })),
    );
  });

  app.get('/api/customers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = getCustomer(id);
    if (!customer) return reply.code(404).send(fail('客户不存在', 404, 'not_found'));
    return ok({
      ...customer,
      stats: customerStats(customer.id),
      history: customerHistory(customer.id),
      inquiries: listInquiries({ customerId: customer.id, limit: 50 }),
      quotes: listQuotes({ customerId: customer.id, limit: 50 }),
      messages: listMessages({ customerId: customer.id, limit: 50 }),
    });
  });

  app.post('/api/customers', async (request, reply) => {
    const input = body<{ company?: string } & Record<string, unknown>>(request);
    if (!input.company) return reply.code(400).send(fail('公司名称必填'));
    const result = upsertCustomer(input as never);
    return reply.code(result.created ? 201 : 200).send(ok(result));
  });

  app.patch('/api/customers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getCustomer(id);
    if (!existing) return reply.code(404).send(fail('客户不存在', 404, 'not_found'));
    const patch = body<Record<string, unknown>>(request);
    const result = upsertCustomer({ ...patch, id: existing.id, company: existing.company } as never);
    return ok(result.customer);
  });

  // =========================================================================
  // Outbound messages (drafts → approval → send)
  // =========================================================================

  app.get('/api/messages', async (request) => {
    const params = query<{ status?: string; inquiryId?: string; customerId?: string; channel?: string; limit?: string }>(request);
    return ok(
      listMessages({
        status: params.status ?? 'all',
        inquiryId: params.inquiryId,
        customerId: params.customerId,
        channel: params.channel,
        limit: intParam(params.limit, 100),
      }),
    );
  });

  app.patch('/api/messages/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = body<{ subject?: string; body?: string }>(request);
    const patch: Record<string, unknown> = {};
    if (input.subject !== undefined) patch.subject = input.subject;
    if (input.body !== undefined) patch.body = input.body;
    if (Object.keys(patch).length === 0) return reply.code(400).send(fail('没有需要更新的字段'));
    updateMessage(id, patch);
    return ok({ id, updated: true });
  });

  /** Approve and send. This is the 3-minute human step. */
  app.post('/api/messages/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = actorOf(request);
    const db = getDb();
    const message = db.get<Record<string, unknown>>(
      'SELECT * FROM outbound_messages WHERE id = ? OR inquiry_id = ? ORDER BY created_at DESC LIMIT 1',
      id,
      id,
    );
    if (!message) return reply.code(404).send(fail('消息不存在', 404, 'not_found'));
    if (message.status === 'sent') return ok({ id: message.id, alreadySent: true });

    updateMessage(String(message.id), { approved_by: actor, approved_at: nowIso() });
    const task = dispatch({
      agent: 'sales',
      taskType: 'send_message',
      payload: { messageId: String(message.id) },
      dedupeKey: `send:${message.id}`,
      runNow: true,
      priority: 5,
    });

    // Auto-schedule the follow-up cadence the moment the first email leaves.
    if (message.quote_id && getAutomation().autoSend) {
      dispatch({
        agent: 'followup',
        taskType: 'schedule_followups',
        payload: { quoteId: message.quote_id },
        dedupeKey: `schedule:${message.quote_id}`,
      });
    }

    return ok({ id: message.id, taskId: task?.id ?? null, sending: true });
  });

  app.post('/api/messages/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = body<{ reason?: string }>(request);
    updateMessage(id, { status: 'draft', error: input.reason ?? 'rejected by reviewer' });
    return ok({ id, rejected: true });
  });

  app.post('/api/messages/:id/mark-sent', async (request) => {
    const { id } = request.params as { id: string };
    markMessageSent(id, { provider: 'manual' });
    return ok({ id, status: 'sent' });
  });

  // =========================================================================
  // Inbound webhooks — where the integrations hand messages to DealTrack
  // =========================================================================

  app.post('/api/inbound/email', async (request) => {
    const input = body<{
      from: string;
      fromName?: string;
      to?: string;
      subject?: string;
      text?: string;
      html?: string;
      messageId?: string;
      threadId?: string;
      receivedAt?: string;
      attachments?: Array<{ filename: string; mime?: string; size?: number; path?: string }>;
    }>(request);

    const result = ingestInbound({
      channel: 'email',
      fromEmail: input.from,
      fromName: input.fromName,
      toAddr: input.to,
      subject: input.subject,
      body: input.text ?? input.html ?? '',
      messageId: input.messageId,
      threadId: input.threadId,
      receivedAt: input.receivedAt,
      attachments: input.attachments,
    });

    return ok({
      inquiryId: result.inquiry.id,
      code: result.inquiry.code,
      customerId: result.customer.id,
      isReply: result.isReply,
      created: result.created,
    });
  });

  app.post('/api/inbound/whatsapp', async (request) => {
    const payload = body<{
      from?: string;
      name?: string;
      text?: string;
      messageId?: string;
      timestamp?: string;
    }>(request);
    if (!payload.from || !payload.text) return fail('from 与 text 必填', 400);

    const result = ingestInbound({
      channel: 'whatsapp',
      fromPhone: payload.from,
      fromName: payload.name,
      body: payload.text,
      messageId: payload.messageId,
      receivedAt: payload.timestamp ? new Date(Number(payload.timestamp) * 1000).toISOString() : undefined,
    });

    return ok({
      inquiryId: result.inquiry.id,
      code: result.inquiry.code,
      customerId: result.customer.id,
      isReply: result.isReply,
    });
  });

  /** Meta's webhook handshake. */
  app.get('/api/whatsapp/webhook', async (request, reply) => {
    const params = query<{ 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }>(request);
    const { whatsappConfig } = await import('../../integrations/messaging.js');
    const cfg = whatsappConfig();
    if (params['hub.mode'] === 'subscribe' && params['hub.verify_token'] === cfg.verifyToken) {
      return reply.type('text/plain').send(String(params['hub.challenge'] ?? ''));
    }
    return reply.code(403).send(fail('verify token 不匹配', 403, 'forbidden'));
  });

  /** Meta's message format. */
  app.post('/api/whatsapp/webhook', async (request) => {
    const payload = body<{
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              id?: string;
              from?: string;
              timestamp?: string;
              text?: { body?: string };
              contacts?: Array<{ profile?: { name?: string } }>;
            }>;
          };
        }>;
      }>;
    }>(request);

    const ingested: Array<Record<string, unknown>> = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (!message.from || !message.text?.body) continue;
          const result = ingestInbound({
            channel: 'whatsapp',
            fromPhone: message.from,
            fromName: message.contacts?.[0]?.profile?.name,
            body: message.text.body,
            messageId: message.id,
            receivedAt: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : undefined,
          });
          ingested.push({ inquiryId: result.inquiry.id, code: result.inquiry.code, isReply: result.isReply });
        }
      }
    }
    return ok({ processed: ingested.length, ingested });
  });

}

export function slaState(inquiry: {
  receivedAt: string;
  firstResponseAt: string | null;
  slaDueAt: string | null;
  status: string;
}): {
  dueAt: string | null;
  minutesElapsed: number;
  minutesRemaining: number | null;
  state: 'met' | 'within' | 'at_risk' | 'breached' | 'n/a';
  firstResponseMinutes: number | null;
} {
  const automation = getAutomation();
  const now = Date.now();
  const received = new Date(inquiry.receivedAt).getTime();
  const elapsed = (now - received) / 60_000;
  const firstResponseMinutes = inquiry.firstResponseAt
    ? (new Date(inquiry.firstResponseAt).getTime() - received) / 60_000
    : null;

  if (inquiry.firstResponseAt) {
    const met = firstResponseMinutes !== null && firstResponseMinutes <= automation.slaFirstReplyMinutes;
    return {
      dueAt: inquiry.slaDueAt,
      minutesElapsed: Number(elapsed.toFixed(1)),
      minutesRemaining: null,
      state: met ? 'met' : 'breached',
      firstResponseMinutes: firstResponseMinutes === null ? null : Number(firstResponseMinutes.toFixed(1)),
    };
  }

  const remaining = automation.slaFirstReplyMinutes - elapsed;
  return {
    dueAt: inquiry.slaDueAt,
    minutesElapsed: Number(elapsed.toFixed(1)),
    minutesRemaining: Number(remaining.toFixed(1)),
    state: remaining < 0 ? 'breached' : remaining < automation.slaFirstReplyMinutes * 0.3 ? 'at_risk' : 'within',
    firstResponseMinutes: null,
  };
}

export { EVENTS };
