import { getDb } from './db.js';
import { EVENTS } from './events.js';
import { config } from './config.js';
import { getAutomation } from './settings.js';
import { detectLanguage } from './i18n.js';
import { addMinutes, nowIso, uid } from './util.js';
import {
  createInquiry,
  findByContact,
  getInquiry,
  listInquiries,
  updateInquiry,
  upsertCustomer,
  type Customer,
  type Inquiry,
} from './repos/sales.js';
import { emit } from './events.js';

/**
 * Inbound ingestion.
 *
 * One funnel for email, WhatsApp, web forms and manual paste. This is the single
 * place where "something arrived from a customer" becomes a DealTrack inquiry,
 * which is why the SLA clock, the event log and the agent pipeline can never
 * disagree about when a lead came in.
 */

export type Channel = 'email' | 'whatsapp' | 'web' | 'manual';

/** Subjects that a mail client prefixes when the sender hits Reply. */
const REPLY_PREFIX = /^\s*(re|re\[\d+\]|aw|sv|vs|antwort|res|答复|回复|回覆|返信|회신|رد)\s*[:：]/i;

export function isReplySubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  return REPLY_PREFIX.test(subject);
}

/**
 * Same conversation? Compare subjects with reply/forward prefixes stripped, so
 * "Re: Re: Quotation QT-…" still matches "Quotation QT-…", while a genuinely new
 * subject does not.
 */
export function sameConversation(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalize = (value: string | null | undefined): string =>
    String(value ?? '')
      .replace(REPLY_PREFIX, '')
      .replace(/^(fwd?|fw|wg|tr)\s*[:：]/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // Tolerate "Re: <same thread>" where one side carries an extra reference tag.
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length > 12 && longer.includes(shorter);
}

export interface InboundInput {
  channel: Channel;
  fromEmail?: string | null;
  fromName?: string | null;
  fromPhone?: string | null;
  toAddr?: string | null;
  subject?: string | null;
  body?: string | null;
  receivedAt?: string;
  messageId?: string | null;
  threadId?: string | null;
  attachments?: Array<{ filename: string; mime?: string; size?: number; path?: string }>;
}

export interface IngestResult {
  inquiry: Inquiry;
  customer: Customer;
  isReply: boolean;
  messageId: string;
  created: { inquiry: boolean; customer: boolean };
}

export function ingestInbound(input: InboundInput): IngestResult {
  const db = getDb();
  const at = input.receivedAt ?? nowIso();
  const automation = getAutomation();
  const language = detectLanguage(`${input.subject ?? ''}\n${input.body ?? ''}`);

  // ---- De-duplicate: the same Message-ID must never create two inquiries ----
  if (input.messageId) {
    const existing = db.get<Record<string, unknown>>(
      'SELECT inquiry_id, id FROM outbound_messages WHERE provider_message_id = ? AND direction = ?',
      input.messageId,
      'inbound',
    );
    if (existing?.inquiry_id) {
      const inquiry = getInquiry(String(existing.inquiry_id));
      const customer = inquiry?.customerId
        ? (db.get<Record<string, unknown>>('SELECT * FROM customers WHERE id = ?', inquiry.customerId) as Record<string, unknown>)
        : null;
      if (inquiry && customer) {
        return {
          inquiry,
          customer: customer as unknown as Customer,
          isReply: true,
          messageId: String(existing.id),
          created: { inquiry: false, customer: false },
        };
      }
    }
  }

  // ---- Customer resolution -------------------------------------------------
  const found = findByContact({
    email: input.fromEmail,
    whatsapp: input.fromPhone,
    phone: input.fromPhone,
  });

  let customer: Customer;
  let customerCreated = false;
  if (found) {
    customer = found;
    if (input.fromPhone && !found.whatsapp && input.channel === 'whatsapp') {
      upsertCustomer({ id: found.id, company: found.company, whatsapp: input.fromPhone });
      customer = { ...found, whatsapp: input.fromPhone };
    }
  } else {
    const result = upsertCustomer({
      company:
        input.fromName?.trim() ||
        (input.fromEmail ? domainName(input.fromEmail) : null) ||
        (input.fromPhone ? `WhatsApp ${input.fromPhone}` : `潜在客户 ${new Date(at).toISOString().slice(0, 10)}`),
      contactName: input.fromName ?? null,
      email: input.fromEmail ?? null,
      whatsapp: input.channel === 'whatsapp' ? input.fromPhone ?? null : null,
      phone: input.fromPhone ?? null,
      language,
      source: input.channel,
      status: 'lead',
      tags: [input.channel],
    });
    customer = result.customer;
    customerCreated = result.created;
    if (customerCreated) {
      emit({
        type: EVENTS.CUSTOMER_CREATED,
        actor: `integration:${input.channel}`,
        entityType: 'customer',
        entityId: customer.id,
        subject: `新客户档案：${customer.company}`,
        payload: { company: customer.company, email: customer.email, language, source: input.channel },
      });
    }
  }

  // ---- Reply vs new inquiry ------------------------------------------------
  //
  // Getting this wrong cuts both ways, and v1 got it wrong in the expensive
  // direction: any message from a known customer within 45 days was folded into
  // their most recent inquiry. A distributor who bought last month and now wants
  // a price on a different product had their new RFQ appended to the old thread,
  // so the quote went out against the wrong line items.
  //
  // The rule is now: it is a reply only when we can *see* that it is one —
  // an explicit thread, a reply-marked subject, or a conversation young enough
  // that starting a new thread would be absurd.
  let replyTarget: Inquiry | null = null;
  if (found) {
    const open = listInquiries({ customerId: customer.id, limit: 10 }).filter(
      (inquiry) => !['won', 'lost', 'archived'].includes(inquiry.status),
    );

    const byThread = input.threadId
      ? (open.find((inquiry) => inquiry.threadId === input.threadId) ?? null)
      : null;

    // With a subject on the message we can decide properly.
    //
    // A distributor who quoted last month and now sends "Neue Anfrage: 2000
    // Campingstühle" is starting new business, even if their last message was
    // four minutes ago. Recency alone is not evidence of a reply — v1 treated
    // "recent" as "same conversation" and filed new RFQs into old threads, so
    // the quotation went out against the wrong line items.
    const hasSubject = Boolean(input.subject && input.subject.trim().length > 0);
    const matchesExisting = open.find((inquiry) => sameConversation(inquiry.subject, input.subject)) ?? null;

    if (byThread) {
      replyTarget = byThread;
    } else if (hasSubject) {
      // A reply-marked subject, or an identical subject line, is the same thread.
      const replyMarked = isReplySubject(input.subject);
      replyTarget = matchesExisting && (replyMarked || matchesExisting.subject === input.subject) ? matchesExisting : null;
    } else {
      // No subject at all (WhatsApp, web form): fall back to recency, which is
      // the only signal available.
      const newest = open[0] ?? null;
      const ageHours = newest ? (Date.now() - new Date(newest.updatedAt).getTime()) / 3_600_000 : Infinity;
      replyTarget = ageHours < 72 ? newest : null;
    }
  }

  const attachments = input.attachments ?? [];
  const inquiry =
    replyTarget ??
    createInquiry({
      customerId: customer.id,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body ?? null,
      raw: input.body ?? null,
      fromEmail: input.fromEmail ?? null,
      fromName: input.fromName ?? null,
      fromPhone: input.fromPhone ?? null,
      language,
      receivedAt: at,
      messageId: input.messageId ?? null,
      threadId: input.threadId ?? null,
      slaDueAt: addMinutes(automation.slaFirstReplyMinutes, new Date(at)),
      attachments,
    });

  if (replyTarget) {
    updateInquiry(replyTarget.id, {
      status: replyTarget.status === 'new' ? 'parsed' : replyTarget.status,
      body: `${replyTarget.body ?? ''}\n\n--- ${at} ---\n${input.body ?? ''}`,
    });
  }

  // ---- Persist the raw message so the thread view is complete --------------
  const messageId = uid('inb');
  db.run(
    `INSERT INTO outbound_messages (id, channel, direction, inquiry_id, customer_id, to_addr, from_addr, subject,
       body, language, status, provider, provider_message_id, created_at, updated_at)
     VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?)`,
    messageId,
    input.channel,
    inquiry.id,
    customer.id,
    input.toAddr ?? '',
    input.fromEmail ?? input.fromPhone ?? '',
    input.subject ?? null,
    input.body ?? '',
    language,
    input.channel,
    input.messageId ?? null,
    at,
    at,
  );

  if (input.messageId || input.threadId) {
    db.run(
      'UPDATE inquiries SET message_id = COALESCE(message_id, ?), thread_id = COALESCE(thread_id, ?), updated_at = ? WHERE id = ?',
      input.messageId ?? null,
      input.threadId ?? null,
      nowIso(),
      inquiry.id,
    );
  }

  const payload = {
    inquiryId: inquiry.id,
    code: inquiry.code,
    customerId: customer.id,
    channel: input.channel,
    language,
    isReply: Boolean(replyTarget),
    messageId,
    subject: input.subject ?? null,
    body: input.body ?? '',
    fromEmail: input.fromEmail ?? null,
    fromPhone: input.fromPhone ?? null,
    attachmentCount: attachments.length,
  };

  emit({
    type: replyTarget ? EVENTS.MESSAGE_RECEIVED : EVENTS.INQUIRY_RECEIVED,
    actor: `integration:${input.channel}`,
    entityType: 'inquiry',
    entityId: inquiry.id,
    subject: replyTarget
      ? `客户回复：${customer.company}（${inquiry.code}）`
      : `新询盘：${customer.company}（${inquiry.code}）`,
    payload,
  });

  return {
    inquiry: getInquiry(inquiry.id)!,
    customer,
    isReply: Boolean(replyTarget),
    messageId,
    created: { inquiry: !replyTarget, customer: customerCreated },
  };
}

function domainName(email: string): string | null {
  const domain = email.split('@')[1]?.split('.')[0];
  if (!domain) return null;
  const free = ['gmail', 'yahoo', 'hotmail', 'outlook', 'qq', '163', '126', 'icloud', 'protonmail', 'aol', 'gmx', 'mail'];
  if (free.includes(domain.toLowerCase())) return null;
  return domain.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Manually paste a customer message into DealTrack.
 * Used by the UI's "新建询盘" and by the email/WhatsApp integrations.
 */
export function ingestManual(input: {
  company?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  channel?: Channel;
  subject?: string | null;
  body: string;
}): IngestResult {
  return ingestInbound({
    channel: input.channel ?? 'manual',
    fromEmail: input.email ?? null,
    fromName: input.contactName ?? input.company ?? null,
    fromPhone: input.phone ?? null,
    subject: input.subject ?? null,
    body: input.body,
  });
}

export { config };
