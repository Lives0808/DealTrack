import { z } from 'zod';
import { addDays, addHours, daysBetween, nowIso, truncate } from '../core/util.js';
import { EVENTS } from '../core/events.js';
import { getAutomation, getCompany, getSalesIdentity } from '../core/settings.js';
import { fill, formatDate, formatMoney, getPhrasebook, milestoneLabel } from '../core/i18n.js';
import {
  createMessage,
  createAlert,
  cancelOpenFollowups,
  createFollowup,
  createThread,
  findOpenThreadFor,
  getFollowup,
  listFollowups,
  listMessages,
  openFollowupsForCustomer,
  openFollowupsForInquiry,
  pickPlaybook,
  updateFollowup,
  appendThreadMessage,
} from '../core/repos/engagement.js';
import { getCustomer, getInquiry, updateInquiry, type Customer, type Inquiry } from '../core/repos/sales.js';
import { getQuote, lapsedQuotes, listQuotes, recordOutcome, updateQuote } from '../core/repos/quoting.js';
import {
  dueMilestones,
  getPi,
  markMilestoneReminded,
  paymentSummary,
  refreshOverdueMilestones,
} from '../core/repos/billing.js';
import { composeReply, renderTemplate } from './sales.js';
import type { AgentContext, AgentDefinition, AgentResult } from './types.js';

const STAGE_BY_SEQUENCE: Record<number, string> = {
  1: 'quote_followup',
  2: 'followup_2',
  3: 'followup_3',
  4: 'reengagement',
};

export function stageForSequence(sequence: number): string {
  return STAGE_BY_SEQUENCE[sequence] ?? 'reengagement';
}

/**
 * Which channel to actually use for a follow-up.
 *
 * v1 always sent email. For a WhatsApp-originated inquiry with no email address
 * that meant the nudge went nowhere — the follow-up existed in the database and
 * never reached a human. Channel is now decided per customer, and falls back to
 * whatever contact detail we actually have.
 */
export function preferredChannel(customer: Customer, inquiryChannel?: string | null): 'email' | 'whatsapp' {
  if (customer.email && inquiryChannel !== 'whatsapp') return 'email';
  if (customer.whatsapp || customer.phone) return 'whatsapp';
  return 'email';
}

/**
 * Follow-up Agent (跟单智能体)
 *
 * Two jobs, and the second one is the reason this product exists:
 *
 * 1. **Schedule** — when a quote goes out, lay down the whole nudging cadence at
 *    once (D+3, D+7, D+14, D+30 by default). It's on the calendar the moment the
 *    quote is sent, so nothing depends on someone remembering.
 *
 * 2. **Detect** — every sweep looks for what a busy salesperson misses: quotes
 *    about to expire, customers who have gone quiet, lead-time promises that no
 *    longer hold. Anything that needs a human opens a "业务对齐群" thread and
 *    pulls the owner in.
 *
 * A customer reply cancels the cadence automatically (see `sales.classify_inbound`).
 */
export const followupAgent: AgentDefinition = {
  name: 'followup',
  label: '跟单智能体',
  description: '排程跟进、异常预警、交期风险、超时升级拉群',
  taskTypes: [
    'schedule_followups',
    'sweep_due',
    'draft_followup',
    'detect_silence',
    'detect_risks',
    'expire_quotes',
    'sweep_payments',
    'draft_payment_reminder',
    'escalate',
  ],

  async handle(task, ctx) {
    switch (task.taskType) {
      case 'schedule_followups':
        return scheduleFollowups(task.payload, ctx);
      case 'sweep_due':
        return sweepDue(ctx);
      case 'draft_followup':
        return draftFollowup(task.payload, ctx);
      case 'detect_silence':
        return detectSilence(ctx);
      case 'detect_risks':
        return detectRisks(ctx);
      case 'expire_quotes':
        return expireQuotes(ctx);
      case 'sweep_payments':
        return sweepPayments(ctx);
      case 'draft_payment_reminder':
        return draftPaymentReminder(task.payload, ctx);
      case 'escalate':
        return escalate(task.payload, ctx);
      default:
        return { status: 'skipped', summary: `未知任务类型 ${task.taskType}` };
    }
  },
};

// ---------------------------------------------------------------------------
// 1. schedule_followups
// ---------------------------------------------------------------------------

async function scheduleFollowups(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const quoteId = String(payload.quoteId ?? '');
  const quote = quoteId ? getQuote(quoteId, false) : null;
  if (!quote) return { status: 'skipped', summary: '报价单不存在' };

  const customer = getCustomer(quote.customerId);
  if (!customer) return { status: 'skipped', summary: '客户不存在' };

  const automation = getAutomation();
  const existing = openFollowupsForInquiry(quote.inquiryId ?? '').length;
  if (existing > 0) {
    return { status: 'skipped', summary: `已有 ${existing} 条待跟进，跳过重复排程` };
  }

  const base = quote.sentAt ? new Date(quote.sentAt) : new Date();
  const created: string[] = [];

  automation.followupCadenceDays.forEach((dayOffset, index) => {
    const sequence = index + 1;
    const stage = stageForSequence(sequence);
    const playbook = pickPlaybook(stage, customer.language, 'email');
    const inquiry = quote.inquiryId ? getInquiry(quote.inquiryId, false) : null;
    const followup = createFollowup({
      inquiryId: quote.inquiryId,
      quoteId: quote.id,
      customerId: customer.id,
      sequenceNo: sequence,
      channel: preferredChannel(customer, inquiry?.channel),
      dueAt: addDays(dayOffset, base),
      reason: `报价 ${quote.quoteNo} 第 ${sequence} 次跟进（D+${dayOffset}）`,
      intent: stage,
      templateId: playbook?.id ?? null,
      language: customer.language,
      status: 'scheduled',
    });
    created.push(followup.id);
    ctx.emit({
      type: EVENTS.FOLLOWUP_SCHEDULED,
      entityType: 'followup',
      entityId: followup.id,
      subject: `已排程：D+${dayOffset} 跟进 ${customer.company}`,
      payload: {
        followupId: followup.id,
        inquiryId: quote.inquiryId,
        quoteId: quote.id,
        sequenceNo: sequence,
        dueAt: followup.dueAt,
        dayOffset,
      },
    });
  });

  return {
    status: 'succeeded',
    summary: `已为 ${quote.quoteNo} 排程 ${created.length} 次跟进（D+${automation.followupCadenceDays.join('/D+')}）`,
    data: { quoteId: quote.id, followupIds: created, cadence: automation.followupCadenceDays },
  };
}

// ---------------------------------------------------------------------------
// 2. sweep_due — the heartbeat. Runs on a timer, never misses.
// ---------------------------------------------------------------------------

async function sweepDue(ctx: AgentContext): Promise<AgentResult> {
  const due = listFollowups({
    status: 'scheduled,pending_approval',
    dueBefore: nowIso(),
    limit: 50,
  }).filter((followup) => !followup.snoozedUntil || followup.snoozedUntil <= nowIso());

  let drafted = 0;
  let skipped = 0;

  for (const followup of due) {
    // Payment reminders are owned by `sweep_payments`, which knows the amount and
    // the due date. Re-drafting them here would emit a quotation-style nudge
    // about a debt.
    if (followup.intent === 'payment_reminder') continue;

    // Skip if the customer already replied — a reply marks the followup 'replied'.
    const inquiry = followup.inquiryId ? getInquiry(followup.inquiryId, false) : null;
    if (inquiry && ['won', 'lost', 'archived'].includes(inquiry.status)) {
      updateFollowup(followup.id, { status: 'skipped', completedAt: nowIso(), reason: `询盘状态 ${inquiry.status}，不再跟进` });
      skipped += 1;
      continue;
    }

    ctx.schedule({
      agent: 'followup',
      taskType: 'draft_followup',
      payload: { followupId: followup.id },
      priority: 50,
      dedupeKey: `draft_followup:${followup.id}`,
    });
    drafted += 1;
  }

  // Expiring quotes and silent customers share the sweep so the price of the
  // timer is paid once per minute, not once per concern.
  ctx.schedule({ agent: 'followup', taskType: 'detect_silence', priority: 400, dedupeKey: 'sweep:silence' });
  ctx.schedule({ agent: 'followup', taskType: 'detect_risks', priority: 400, dedupeKey: 'sweep:risks' });
  ctx.schedule({ agent: 'followup', taskType: 'expire_quotes', priority: 400, dedupeKey: 'sweep:expire' });
  ctx.schedule({ agent: 'followup', taskType: 'sweep_payments', priority: 400, dedupeKey: 'sweep:payments' });

  return {
    status: 'succeeded',
    summary: `扫描到 ${due.length} 条到期跟进，排入起草 ${drafted} 条，跳过 ${skipped} 条`,
    data: { due: due.length, drafted, skipped },
  };
}

// ---------------------------------------------------------------------------
// 3. draft_followup — write nudge #N in the customer's language
// ---------------------------------------------------------------------------

async function draftFollowup(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const followup = getFollowup(String(payload.followupId ?? ''));
  if (!followup) return { status: 'skipped', summary: '跟进记录不存在' };
  if (!['scheduled', 'pending_approval'].includes(followup.status)) {
    return { status: 'skipped', summary: `跟进状态为 ${followup.status}，无需起草` };
  }
  // Already drafted — the message exists and is waiting for a human.
  if (followup.intent === 'payment_reminder') {
    return { status: 'skipped', summary: '催款内容由回款扫描生成，此处不重复起草' };
  }
  const existingDraft = ctx.db.get<Record<string, unknown>>(
    "SELECT id FROM outbound_messages WHERE followup_id = ? AND status IN ('draft','pending_approval') LIMIT 1",
    followup.id,
  );
  if (existingDraft) {
    return { status: 'skipped', summary: '该跟进已有待确认草稿' };
  }

  const customer = getCustomer(followup.customerId);
  if (!customer) return { status: 'skipped', summary: '客户不存在' };

  const inquiry = followup.inquiryId ? getInquiry(followup.inquiryId) : null;
  const quote = followup.quoteId ? getQuote(followup.quoteId) : null;
  const automation = getAutomation();
  const company = getCompany();
  const sales = getSalesIdentity();
  const stage = followup.intent ?? stageForSequence(followup.sequenceNo);
  const book = getPhrasebook(customer.language);

  if (!quote) {
    updateFollowup(followup.id, { status: 'skipped', completedAt: nowIso(), reason: '无关联报价单' });
    return { status: 'skipped', summary: '跟进未关联报价单' };
  }

  const playbook = pickPlaybook(stage, customer.language, followup.channel);
  const vars = {
    code: quote.quoteNo,
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
    product_list: (quote.items ?? []).map((item) => `${item.description} ${item.qty}${item.unit}`).join('; '),
  };
  const playbookBody = playbook ? renderTemplate(playbook.bodyTpl, vars) : '';
  const playbookSubject = playbook?.subjectTpl ? renderTemplate(playbook.subjectTpl, vars) : '';

  const sequenceHint =
    followup.sequenceNo === 1
      ? 'Gentle first nudge — assume the last email simply got buried.'
      : followup.sequenceNo === 2
        ? 'Second nudge — offer to adjust specification, packing or payment terms.'
        : 'Final note — close the loop politely, keep the door open, no pressure.';

  const { data: draft } = await ctx.ask({
    operation: 'draft_followup',
    schema: z.object({
      subject: z.string().default(''),
      body: z.string().default(''),
      language: z.string().default('en'),
    }),
    system: [
      'You are an export salesperson writing a follow-up nudge to an overseas buyer who went quiet.',
      `Write in ${customer.language}.`,
      'Rules:',
      '- Never guilt-trip or pressure. Never invent new prices or discounts.',
      '- Shorter than the original email. Under 120 words.',
      '- Give one specific reason to reply (validity date, price hold, stock, sample offer).',
      '- Return JSON: {"subject": string, "body": string, "language": string}.',
    ].join('\n'),
    user: [
      `Follow-up #${followup.sequenceNo} (${sequenceHint})`,
      `Customer: ${customer.company} (${customer.contactName ?? 'contact'}) in ${customer.country ?? 'unknown'}`,
      `Quote ${quote.quoteNo}: ${quote.currency} ${quote.total} ${quote.incoterm} ${quote.incotermPlace}`,
      `Valid until: ${quote.validUntil ?? 'n/a'}`,
      `Days since the quote was sent: ${quote.sentAt ? daysBetween(quote.sentAt, nowIso()) : 'unknown'}`,
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
      code: quote.quoteNo,
      currency: quote.currency,
      total: quote.total,
      incoterm: quote.incoterm,
      incotermPlace: quote.incotermPlace,
      leadTimeDays: quote.leadTimeDays ?? 15,
      paymentTerms: quote.paymentTerms,
      validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 10) : '30 days',
      marketCount: company.marketCount,
      playbookBody,
      sequenceNo: followup.sequenceNo,
    },
    fallback: () => ({
      subject: playbookSubject || fill(book.subject.followup1, { code: quote.quoteNo }),
      body:
        playbookBody ||
        [
          customer.contactName ? fill(book.greeting, { name: customer.contactName }) : book.greetingGeneric,
          '',
          followup.sequenceNo === 1 ? book.followupNudge1 : followup.sequenceNo === 2 ? book.followupNudge2 : book.followupFinal,
          '',
          `${quote.incoterm} ${quote.incotermPlace} · ${quote.currency} ${quote.total.toFixed(2)}`,
          book.ctaReply,
          '',
          [book.closing, sales.senderName, sales.senderRole, company.name].filter(Boolean).join('\n'),
        ].join('\n'),
      language: customer.language,
    }),
  });

  const toAddr = followup.channel === 'whatsapp' ? customer.whatsapp ?? customer.phone ?? '' : customer.email ?? '';
  const message = createMessage({
    channel: followup.channel === 'whatsapp' ? 'whatsapp' : 'email',
    inquiryId: followup.inquiryId,
    quoteId: followup.quoteId,
    customerId: customer.id,
    followupId: followup.id,
    toAddr,
    fromAddr: sales.senderEmail,
    subject: draft.subject || playbookSubject || fill(book.subject.followup1, { code: quote.quoteNo }),
    body: draft.body || playbookBody,
    language: customer.language,
    status: 'pending_approval',
    createdBy: 'agent:followup',
  });

  updateFollowup(followup.id, {
    status: 'pending_approval',
    subject: message.subject,
    body: message.body,
    attempts: followup.attempts + 1,
    lastAttemptAt: nowIso(),
  });

  ctx.emit({
    type: EVENTS.FOLLOWUP_DRAFTED,
    entityType: 'message',
    entityId: message.id,
    subject: `第 ${followup.sequenceNo} 次跟进草稿就绪：${customer.company}`,
    payload: {
      messageId: message.id,
      followupId: followup.id,
      inquiryId: followup.inquiryId,
      quoteId: followup.quoteId,
      sequenceNo: followup.sequenceNo,
      language: customer.language,
    },
  });

  // With auto-send on, the orchestrator ships it immediately.
  if (automation.autoSend) {
    ctx.schedule({
      agent: 'sales',
      taskType: 'send_message',
      payload: { messageId: message.id },
      priority: 40,
      dedupeKey: `send:${message.id}`,
    });
    return { status: 'succeeded', summary: `跟进 #${followup.sequenceNo} 已自动排入发送`, data: { messageId: message.id } };
  }

  return {
    status: 'waiting_approval',
    summary: `跟进 #${followup.sequenceNo} 草稿待确认（${customer.company}）`,
    data: { messageId: message.id, followupId: followup.id, sequenceNo: followup.sequenceNo },
  };
}

// ---------------------------------------------------------------------------
// 3b. expire_quotes — a lapsed quote must stop being "sent"
//
// v1 only raised an alert. The quote stayed in `sent` forever, which meant
// `no_response` never appeared in the loss analytics — exactly the failure mode
// the boss is trying to see.
// ---------------------------------------------------------------------------

async function expireQuotes(ctx: AgentContext): Promise<AgentResult> {
  const lapsed = lapsedQuotes(0);
  let expired = 0;
  let closed = 0;

  for (const quote of lapsed) {
    updateQuote(quote.id, { status: 'expired' });
    expired += 1;

    ctx.emit({
      type: EVENTS.QUOTE_EXPIRED,
      entityType: 'quote',
      entityId: quote.id,
      subject: `报价 ${quote.quoteNo} 已过期`,
      payload: {
        quoteId: quote.id,
        customerId: quote.customerId,
        validUntil: quote.validUntil,
        total: quote.total,
      },
    });

    cancelOpenFollowups({ inquiryId: quote.inquiryId ?? undefined }, '报价已过期');

    // Give the customer a grace period before calling it lost — a quote that
    // lapsed three days ago may still be genuinely alive.
    const graceDays = 7;
    const overdueDays = quote.validUntil
      ? (Date.now() - new Date(quote.validUntil).getTime()) / 86_400_000
      : 0;
    const alreadyClosed = ctx.db.get<Record<string, unknown>>(
      'SELECT id FROM quote_outcomes WHERE quote_id = ? LIMIT 1',
      quote.id,
    );
    if (overdueDays < graceDays || alreadyClosed) continue;

    recordOutcome({
      quoteId: quote.id,
      result: 'no_response',
      reasonCode: 'no_response',
      reasonNote: `报价有效期至 ${quote.validUntil?.slice(0, 10) ?? '—'}，超期 ${Math.floor(overdueDays)} 天无回应，系统自动结单`,
      decidedBy: 'agent:followup',
    });
    if (quote.inquiryId) {
      updateInquiry(quote.inquiryId, { status: 'nurturing', lostAt: nowIso() });
    }
    closed += 1;

    ctx.emit({
      type: EVENTS.QUOTE_REJECTED,
      entityType: 'quote',
      entityId: quote.id,
      subject: `自动结单：${quote.quoteNo} 超期无回应`,
      payload: {
        quoteId: quote.id,
        reasonCode: 'no_response',
        overdueDays: Math.floor(overdueDays),
        auto: true,
      },
    });
  }

  return {
    status: 'succeeded',
    summary: `过期报价 ${expired} 张，自动结单 ${closed} 张`,
    data: { expired, closed },
  };
}

// ---------------------------------------------------------------------------
// 3c. sweep_payments — 货发了，钱到了吗
// ---------------------------------------------------------------------------

async function sweepPayments(ctx: AgentContext): Promise<AgentResult> {
  const flagged = refreshOverdueMilestones();
  const due = dueMilestones();
  let drafted = 0;

  for (const milestone of due) {
    // Don't nag more than once every three days, and never more than five times.
    if (milestone.remindCount >= 5) continue;
    if (milestone.remindedAt) {
      const sinceHours = (Date.now() - new Date(milestone.remindedAt).getTime()) / 3_600_000;
      if (sinceHours < 72) continue;
    }

    ctx.schedule({
      agent: 'followup',
      taskType: 'draft_payment_reminder',
      payload: { milestoneId: milestone.id },
      priority: 60,
      dedupeKey: `payremind:${milestone.id}:${milestone.remindCount}`,
    });
    drafted += 1;
  }

  const summary = paymentSummary(new Date(Date.now() - 365 * 86_400_000).toISOString());
  if (summary.overdueCount > 0) {
    const existing = ctx.db.get<Record<string, unknown>>(
      "SELECT id FROM alerts WHERE type = 'payment.overdue' AND acknowledged = 0 LIMIT 1",
    );
    if (!existing) {
      createAlert({
        type: 'payment.overdue',
        severity: 'critical',
        title: `${summary.overdueCount} 笔回款已逾期`,
        body: `逾期金额合计 ${summary.overdue.toFixed(2)}。逾期最久：${summary.topOverdue
          .slice(0, 3)
          .map((entry) => `${entry.customer} ${entry.currency} ${entry.amount.toFixed(0)}（逾期 ${entry.daysLate} 天）`)
          .join('、')}`,
        entityType: 'payment',
        entityId: 'batch',
      });
    }
  }

  return {
    status: 'succeeded',
    summary: `标记逾期 ${flagged} 笔，排入催款 ${drafted} 笔（未收 ${summary.outstanding.toFixed(2)}）`,
    data: { flagged, drafted, outstanding: summary.outstanding, overdue: summary.overdue },
  };
}

/**
 * Draft a payment reminder in the customer's language.
 *
 * Reuses the `payment` subject line and closing from the phrasebook, so it reads
 * like the rest of the correspondence rather than a system-generated dunning
 * letter — which matters when the buyer is a small distributor you want to keep.
 */
async function draftPaymentReminder(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const milestoneId = String(payload.milestoneId ?? '');
  const milestone = ctx.db.get<Record<string, unknown>>(
    'SELECT * FROM payment_milestones WHERE id = ?',
    milestoneId,
  );
  if (!milestone) return { status: 'skipped', summary: '回款节点不存在' };

  const customer = getCustomer(String(milestone.customer_id));
  if (!customer) return { status: 'skipped', summary: '客户不存在' };

  const pi = milestone.pi_id ? getPi(String(milestone.pi_id)) : null;
  const company = getCompany();

  // One pending reminder per quote at a time.
  //
  // `sweep_payments` deduplicates by remind-count, but the manual "催款" button
  // used a timestamp in its key — so tapping it twice produced two identical
  // drafts in the approval queue. Whoever reviews them would send the customer
  // the same dunning note twice, which is exactly the impression to avoid.
  const alreadyPending = ctx.db.get<Record<string, unknown>>(
    `SELECT id FROM followups
      WHERE quote_id = ? AND intent = 'payment_reminder' AND status = 'pending_approval'
      LIMIT 1`,
    String(milestone.quote_id ?? ''),
  );
  if (alreadyPending) {
    return {
      status: 'skipped',
      summary: '该笔欠款已有待确认的催款草稿，不重复起草',
      data: { followupId: String(alreadyPending.id) },
    };
  }
  const sales = getSalesIdentity();
  const book = getPhrasebook(customer.language);
  const isDeposit = String(milestone.label) === 'deposit';
  const amount = Number(milestone.amount ?? 0);
  const currency = String(milestone.currency ?? 'USD');
  const dueAt = milestone.due_at ? String(milestone.due_at) : null;
  const daysLate = dueAt ? Math.floor((Date.now() - new Date(dueAt).getTime()) / 86_400_000) : 0;

  const { data: draft } = await ctx.ask({
    operation: 'draft_followup',
    schema: z.object({
      subject: z.string().default(''),
      body: z.string().default(''),
      language: z.string().default('en'),
    }),
    system: [
      'You are an export salesperson writing a payment reminder to an overseas buyer.',
      `Write in ${customer.language}.`,
      'Rules:',
      '- Warm and matter-of-fact. Never threatening, never accusatory.',
      '- State the amount, what it is for, and the original due date exactly as given.',
      '- Assume the best: invoices get missed, approvals take time.',
      '- Ask one concrete question (has it been scheduled? do you need a revised PI?).',
      '- Under 110 words. Return JSON {subject, body, language}.',
    ].join('\n'),
    user: [
      `Customer: ${customer.company} (${customer.contactName ?? 'contact'}) in ${customer.country ?? 'unknown'}`,
      `Milestone: ${isDeposit ? 'deposit' : 'balance payment'}`,
      `Amount: ${currency} ${amount.toFixed(2)}`,
      `Original due date: ${dueAt?.slice(0, 10) ?? 'n/a'}${daysLate > 0 ? ` (${daysLate} days ago)` : ''}`,
      pi ? `Proforma invoice: ${pi.piNo} · total ${pi.currency} ${pi.total.toFixed(2)}` : '',
    ].join('\n'),
    context: {
      stage: 'payment_reminder',
      language: customer.language,
      contactName: customer.contactName,
      customerCompany: customer.company,
      sellerCompany: company.name,
      senderName: sales.senderName,
      senderRole: sales.senderRole,
      code: pi?.piNo ?? '',
      // The facts a dunning note must get right. Getting them wrong damages the
      // relationship instead of collecting the money.
      piNo: pi?.piNo ?? '',
      milestoneLabel: isDeposit ? 'deposit' : 'balance',
      currency,
      total: amount,
      dueDate: dueAt ?? '',
      daysLate,
      leadTimeDays: 0,
      paymentTerms: pi?.paymentTerms ?? company.paymentTerms,
      validUntil: dueAt?.slice(0, 10) ?? '',
      marketCount: company.marketCount,
    },
    fallback: () => ({
      subject: fill(book.subject.payment, { code: pi?.piNo ?? '' }),
      body: [
        customer.contactName ? fill(book.greeting, { name: customer.contactName }) : book.greetingGeneric,
        '',
        book.paymentDueIntro,
        '',
        `• ${milestoneLabel(isDeposit ? 'deposit' : 'balance', customer.language)}: ${formatMoney(amount, currency, customer.language)}`,
        dueAt ? `• ${formatDate(dueAt, customer.language)}` : '',
        daysLate > 0 ? fill(book.paymentLateNote, { days: daysLate }) : '',
        pi ? `• ${pi.piNo}` : '',
        '',
        // Deliberately the payment CTA, not the quotation CTA. Asking a buyer to
        // "confirm the quantity and destination port" in a dunning note is how
        // you lose the order while chasing the money.
        book.paymentReminderCta,
        '',
        [book.closing, sales.senderName, sales.senderRole, company.name].filter(Boolean).join('\n'),
      ]
        .filter((line) => line !== '')
        .join('\n'),
      language: customer.language,
    }),
  });

  const channel = preferredChannel(customer);

  // Record the reminder as a follow-up too.
  //
  // It used to produce only a `message`, and the 跟进看板 lists `followups` — so
  // the draft existed, was correct, and was invisible in both the web console and
  // the app. A reminder nobody sees is a reminder nobody sends.
  const reminderRecord = createFollowup({
    inquiryId: pi?.inquiryId ?? null,
    quoteId: String(milestone.quote_id ?? '') || null,
    customerId: customer.id,
    sequenceNo: 90 + Number(milestone.remind_count ?? 0),
    channel,
    dueAt: nowIso(),
    status: 'pending_approval',
    reason: `回款逾期催收：${isDeposit ? '定金' : '尾款'} ${currency} ${amount.toFixed(2)}`,
    intent: 'payment_reminder',
    language: customer.language,
    assignedTo: null,
  });

  const message = createMessage({
    channel,
    inquiryId: pi?.inquiryId ?? null,
    quoteId: String(milestone.quote_id ?? '') || null,
    customerId: customer.id,
    followupId: reminderRecord.id,
    toAddr: channel === 'whatsapp' ? customer.whatsapp ?? customer.phone ?? '' : customer.email ?? '',
    fromAddr: sales.senderEmail,
    subject: draft.subject || fill(book.subject.payment, { code: pi?.piNo ?? '' }),
    body: draft.body,
    language: customer.language,
    status: 'pending_approval',
    createdBy: 'agent:followup',
  });

  updateFollowup(reminderRecord.id, { subject: message.subject, body: message.body });
  markMilestoneReminded(milestoneId);

  ctx.emit({
    type: EVENTS.PAYMENT_REMINDER_DRAFTED,
    entityType: 'message',
    entityId: message.id,
    subject: `已起草催款：${customer.company} ${currency} ${amount.toFixed(2)}`,
    payload: {
      messageId: message.id,
      followupId: reminderRecord.id,
      milestoneId,
      piId: pi?.id ?? null,
      customerId: customer.id,
      amount,
      currency,
      daysLate,
    },
  });

  return {
    status: 'waiting_approval',
    summary: `催款草稿就绪：${customer.company} ${currency} ${amount.toFixed(2)}`,
    data: { messageId: message.id, followupId: reminderRecord.id, milestoneId, daysLate },
  };
}

// ---------------------------------------------------------------------------
// 4. detect_silence — customers who have gone quiet, and quotes about to lapse
// ---------------------------------------------------------------------------

async function detectSilence(ctx: AgentContext): Promise<AgentResult> {
  const automation = getAutomation();
  const db = ctx.db;
  const alerts: string[] = [];

  // --- Quotes nearing expiry ------------------------------------------
  const expiring = db.all<Record<string, unknown>>(
    `SELECT q.id, q.quote_no, q.total, q.currency, q.valid_until, q.customer_id, q.inquiry_id, c.company, c.language
       FROM quotes q JOIN customers c ON c.id = q.customer_id
      WHERE q.status IN ('sent', 'pending_approval')
        AND q.valid_until IS NOT NULL
        AND q.valid_until BETWEEN ? AND ?
      ORDER BY q.valid_until ASC LIMIT 20`,
    nowIso(),
    addDays(3),
  );

  for (const row of expiring) {
    const quoteId = String(row.id);
    const existing = db.get<Record<string, unknown>>(
      "SELECT id FROM alerts WHERE entity_id = ? AND type = 'quote.expiring' AND acknowledged = 0",
      quoteId,
    );
    if (existing) continue;

    const alert = createAlert({
      type: 'quote.expiring',
      severity: 'warning',
      title: `报价 ${row.quote_no} 即将过期`,
      body: `${row.company} 的报价 ${String(row.currency)} ${Number(row.total).toFixed(2)} 将于 ${String(row.valid_until).slice(0, 10)} 过期，建议发送续期或最后确认。`,
      entityType: 'quote',
      entityId: quoteId,
    });
    alerts.push(alert.id);

    ctx.emit({
      type: EVENTS.SLA_AT_RISK,
      entityType: 'quote',
      entityId: quoteId,
      subject: `报价 ${row.quote_no} 即将过期`,
      payload: { quoteId, customerId: row.customer_id, validUntil: row.valid_until, company: row.company },
    });
  }

  // --- Silent customers ------------------------------------------------
  const silentSince = addDays(-automation.silenceDays);
  const silent = db.all<Record<string, unknown>>(
    `SELECT q.id AS quote_id, q.quote_no, q.total, q.currency, q.sent_at, q.inquiry_id, q.customer_id,
            c.company, c.language, c.contact_name, c.country
       FROM quotes q JOIN customers c ON c.id = q.customer_id
      WHERE q.status IN ('sent', 'pending_approval')
        AND q.sent_at IS NOT NULL
        AND q.sent_at <= ?
        AND NOT EXISTS (SELECT 1 FROM quote_outcomes o WHERE o.quote_id = q.id)
        AND NOT EXISTS (
              SELECT 1 FROM followups f
               WHERE f.quote_id = q.id AND f.status IN ('scheduled', 'pending_approval')
        )
      ORDER BY q.sent_at ASC LIMIT 25`,
    silentSince,
  );

  let escalated = 0;
  for (const row of silent) {
    const quoteId = String(row.quote_id);
    const customerId = String(row.customer_id);
    if (findOpenThreadFor('quote', quoteId)) continue;

    ctx.emit({
      type: EVENTS.CUSTOMER_SILENT,
      entityType: 'customer',
      entityId: customerId,
      subject: `${row.company} 已沉默 ${daysBetween(String(row.sent_at), nowIso())} 天`,
      payload: {
        customerId,
        quoteId,
        quoteNo: row.quote_no,
        company: row.company,
        daysSilent: daysBetween(String(row.sent_at), nowIso()),
        total: row.total,
        currency: row.currency,
      },
      correlationId: `silence:${customerId}`,
    });

    const owner = ctx.db.get<Record<string, unknown>>(
      "SELECT id, name FROM users WHERE active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'ops' THEN 1 ELSE 2 END LIMIT 1",
    );
    const thread = createThread({
      subject: `业务对齐：${row.company} 跟丢风险`,
      topic: 'customer_silent',
      entityType: 'quote',
      entityId: quoteId,
      severity: 'warning',
      createdBy: 'agent:followup',
      messages: [
        {
          author: 'agent:followup',
          role: 'agent',
          body: [
            `【自动升级】${row.company} 的报价 ${row.quote_no} 已发出 ${daysBetween(String(row.sent_at), nowIso())} 天，既无回复也无未完成的跟进排程。`,
            `报价金额：${String(row.currency)} ${Number(row.total).toFixed(2)}`,
            `客户语言：${row.language}，地区：${row.country ?? '未知'}`,
            '',
            '建议动作：',
            '1. 换渠道触达（邮件沉默时试 WhatsApp / 电话）；',
            '2. 核对是否有价格或交期异议未被记录；',
            '3. 若确认无望，请在系统中标记丢单并选择丢单原因，用于话术优化。',
          ].join('\n'),
          mentions: owner ? [String(owner.id)] : [],
        },
      ],
    });
    escalated += 1;

    ctx.emit({
      type: EVENTS.THREAD_OPENED,
      entityType: 'thread',
      entityId: thread.id,
      subject: `已拉群：${thread.subject}`,
      payload: { threadId: thread.id, customerId, quoteId, reason: 'customer_silent', severity: 'warning' },
    });

    ctx.emit({
      type: EVENTS.FOLLOWUP_ESCALATED,
      entityType: 'customer',
      entityId: customerId,
      subject: `${row.company} 沉默超阈值，已升级人工`,
      payload: { customerId, quoteId, threadId: thread.id, daysSilent: daysBetween(String(row.sent_at), nowIso()) },
    });
  }

  return {
    status: 'succeeded',
    summary: `过期预警 ${alerts.length} 条，沉默升级 ${escalated} 条`,
    data: { expiringAlerts: alerts.length, silentEscalations: escalated },
  };
}

// ---------------------------------------------------------------------------
// 5. detect_risks — lead time, stalled inquiries, unanswered drafts
// ---------------------------------------------------------------------------

async function detectRisks(ctx: AgentContext): Promise<AgentResult> {
  const automation = getAutomation();
  const db = ctx.db;
  const findings: string[] = [];

  // --- Lead-time risk: promised longer than the customer asked for ------
  const leadRisk = db.all<Record<string, unknown>>(
    `SELECT q.id, q.quote_no, q.lead_time_days, q.customer_id, q.inquiry_id, c.company,
            i.parsed, q.currency, q.total
       FROM quotes q
       JOIN customers c ON c.id = q.customer_id
       LEFT JOIN inquiries i ON i.id = q.inquiry_id
      WHERE q.status IN ('draft', 'pending_approval', 'sent')
        AND q.lead_time_days IS NOT NULL`,
  );

  for (const row of leadRisk) {
    const parsed = safeJson(String(row.parsed ?? '{}'));
    const asked = Number((parsed.target_lead_time_days as number | undefined) ?? (parsed.lead_time_days as number | undefined) ?? 0);
    const promised = Number(row.lead_time_days ?? 0);
    if (!asked || !promised || promised <= asked) continue;

    const quoteId = String(row.id);
    const existing = db.get<Record<string, unknown>>(
      "SELECT id FROM alerts WHERE entity_id = ? AND type = 'risk.lead_time' AND acknowledged = 0",
      quoteId,
    );
    if (existing) continue;

    createAlert({
      type: 'risk.lead_time',
      severity: 'warning',
      title: `交期风险：${row.company}`,
      body: `客户要求在 ${asked} 天内交货，报价 ${row.quote_no} 承诺 ${promised} 天，相差 ${promised - asked} 天。建议提前排产或调整承诺。`,
      entityType: 'quote',
      entityId: quoteId,
    });
    findings.push(quoteId);

    ctx.emit({
      type: EVENTS.RISK_LEAD_TIME,
      entityType: 'quote',
      entityId: quoteId,
      subject: `交期风险：承诺 ${promised} 天 > 客户要求 ${asked} 天`,
      payload: { quoteId, customerId: row.customer_id, promised, asked, gapDays: promised - asked },
    });
  }

  // --- Stalled inquiries: no first response beyond the SLA ---------------
  const stalled = db.all<Record<string, unknown>>(
    `SELECT i.id, i.code, i.received_at, i.sla_due_at, i.channel, i.customer_id, c.company
       FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.first_response_at IS NULL
        AND i.status IN ('new', 'parsed')
        AND i.received_at <= ?
      ORDER BY i.received_at ASC LIMIT 20`,
    addHours(-automation.escalateAfterHours),
  );

  let escalated = 0;
  for (const row of stalled) {
    const inquiryId = String(row.id);
    if (findOpenThreadFor('inquiry', inquiryId)) continue;

    const thread = createThread({
      subject: `业务对齐：${row.company ?? row.code} 询盘超时未响应`,
      topic: 'inquiry_stalled',
      entityType: 'inquiry',
      entityId: inquiryId,
      severity: 'critical',
      createdBy: 'agent:followup',
      messages: [
        {
          author: 'agent:followup',
          role: 'agent',
          body: [
            `【超时升级】询盘 ${row.code} 自 ${String(row.received_at).slice(0, 16).replace('T', ' ')} 起已超过 ${automation.escalateAfterHours} 小时无首次响应。`,
            `渠道：${row.channel}，客户：${row.company ?? '未建档'}`,
            '',
            '这条询盘正在偏离 SLA。请指派负责人，或确认是否直接丢弃。',
          ].join('\n'),
        },
      ],
    });
    escalated += 1;

    ctx.emit({
      type: EVENTS.SLA_BREACHED,
      entityType: 'inquiry',
      entityId: inquiryId,
      subject: `SLA 超时：${row.code}`,
      payload: {
        inquiryId,
        threadId: thread.id,
        hoursSince: Math.round((Date.now() - new Date(String(row.received_at)).getTime()) / 3_600_000),
      },
    });
  }

  // --- Drafts sitting unapproved for too long ---------------------------
  const staleDrafts = db.all<Record<string, unknown>>(
    `SELECT m.id, m.subject, m.customer_id, m.created_at, c.company
       FROM outbound_messages m LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.status = 'pending_approval' AND m.created_at <= ? LIMIT 20`,
    addHours(-6),
  );

  for (const row of staleDrafts) {
    const messageId = String(row.id);
    const existing = db.get<Record<string, unknown>>(
      "SELECT id FROM alerts WHERE entity_id = ? AND type = 'draft.stale' AND acknowledged = 0",
      messageId,
    );
    if (existing) continue;
    createAlert({
      type: 'draft.stale',
      severity: 'info',
      title: `草稿待审超过 6 小时：${row.company ?? ''}`,
      body: `「${row.subject ?? '无主题'}」仍待人工确认。审一下就能发出去。`,
      entityType: 'message',
      entityId: messageId,
    });
  }

  return {
    status: 'succeeded',
    summary: `交期风险 ${findings.length} 条，超时询盘升级 ${escalated} 条，滞留草稿 ${staleDrafts.length} 条`,
    data: { leadTimeRisks: findings.length, stalledEscalations: escalated, staleDrafts: staleDrafts.length },
  };
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 6. escalate — open (or append to) a 业务对齐群
// ---------------------------------------------------------------------------

async function escalate(payload: Record<string, unknown>, ctx: AgentContext): Promise<AgentResult> {
  const entityType = String(payload.entityType ?? 'inquiry');
  const entityId = String(payload.entityId ?? '');
  const reason = String(payload.reason ?? '需要人工介入');
  const severity = String(payload.severity ?? 'warning');

  const existing = findOpenThreadFor(entityType, entityId);
  if (existing) {
    appendThreadMessage(existing.id, {
      author: 'agent:followup',
      role: 'agent',
      body: `再次触发升级：${reason}`,
    });
    return { status: 'skipped', summary: `已有未解决对齐群（${existing.subject}），追加了一条说明` };
  }

  const subject =
    entityType === 'customer'
      ? `业务对齐：客户 ${entityId} 需要关注`
      : `业务对齐：${reason}`;

  const thread = createThread({
    subject,
    topic: String(payload.topic ?? 'manual_escalation'),
    entityType,
    entityId,
    severity,
    createdBy: 'agent:followup',
    messages: [{ author: 'agent:followup', role: 'agent', body: reason }],
  });

  ctx.emit({
    type: EVENTS.THREAD_OPENED,
    entityType: 'thread',
    entityId: thread.id,
    subject: `已拉群：${thread.subject}`,
    payload: { threadId: thread.id, topic: thread.topic, severity },
  });

  return { status: 'succeeded', summary: `已创建对齐群：${thread.subject}`, data: { threadId: thread.id } };
}

export { listFollowups, openFollowupsForCustomer, listMessages };
