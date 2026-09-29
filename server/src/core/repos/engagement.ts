import { getDb, type Row } from '../db.js';
import { addDays, nowIso, parseJson, toBool, uid } from '../util.js';

// ---------------------------------------------------------------------------
// Follow-ups (跟进排程) — where "不漏跟" is enforced
// ---------------------------------------------------------------------------

export interface Followup {
  id: string;
  inquiryId: string | null;
  quoteId: string | null;
  customerId: string;
  sequenceNo: number;
  channel: string;
  dueAt: string;
  status: string;
  reason: string | null;
  intent: string | null;
  templateId: string | null;
  language: string;
  subject: string | null;
  body: string | null;
  assignedTo: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  snoozedUntil: string | null;
  escalatedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapFollowup(row: Row): Followup {
  return {
    id: String(row.id),
    inquiryId: (row.inquiry_id as string | null) ?? null,
    quoteId: (row.quote_id as string | null) ?? null,
    customerId: String(row.customer_id),
    sequenceNo: Number(row.sequence_no ?? 1),
    channel: String(row.channel ?? 'email'),
    dueAt: String(row.due_at),
    status: String(row.status ?? 'scheduled'),
    reason: (row.reason as string | null) ?? null,
    intent: (row.intent as string | null) ?? null,
    templateId: (row.template_id as string | null) ?? null,
    language: String(row.language ?? 'en'),
    subject: (row.subject as string | null) ?? null,
    body: (row.body as string | null) ?? null,
    assignedTo: (row.assigned_to as string | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    snoozedUntil: (row.snoozed_until as string | null) ?? null,
    escalatedAt: (row.escalated_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createFollowup(input: {
  inquiryId?: string | null;
  quoteId?: string | null;
  customerId: string;
  sequenceNo?: number;
  channel?: string;
  dueAt: string;
  reason?: string | null;
  intent?: string | null;
  templateId?: string | null;
  language?: string;
  assignedTo?: string | null;
  status?: string;
}): Followup {
  const db = getDb();
  const id = uid('fup');
  const at = nowIso();
  db.run(
    `INSERT INTO followups (id, inquiry_id, quote_id, customer_id, sequence_no, channel, due_at, status, reason,
       intent, template_id, language, assigned_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.inquiryId ?? null,
    input.quoteId ?? null,
    input.customerId,
    input.sequenceNo ?? 1,
    input.channel ?? 'email',
    input.dueAt,
    input.status ?? 'scheduled',
    input.reason ?? null,
    input.intent ?? null,
    input.templateId ?? null,
    input.language ?? 'en',
    input.assignedTo ?? null,
    at,
    at,
  );
  return getFollowup(id)!;
}

export function getFollowup(id: string): Followup | null {
  const row = getDb().get<Row>('SELECT * FROM followups WHERE id = ?', id);
  return row ? mapFollowup(row) : null;
}

export function updateFollowup(id: string, patch: Partial<Followup>): boolean {
  const columnMap: Record<string, string> = {
    status: 'status',
    subject: 'subject',
    body: 'body',
    attempts: 'attempts',
    lastAttemptAt: 'last_attempt_at',
    snoozedUntil: 'snoozed_until',
    escalatedAt: 'escalated_at',
    completedAt: 'completed_at',
    assignedTo: 'assigned_to',
    dueAt: 'due_at',
    templateId: 'template_id',
    channel: 'channel',
    language: 'language',
    intent: 'intent',
    reason: 'reason',
  };
  const dbPatch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columnMap)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) dbPatch[column] = value;
  }
  if (Object.keys(dbPatch).length === 0) return false;
  return getDb().update('followups', id, dbPatch);
}

export function listFollowups(
  options: { status?: string; customerId?: string; inquiryId?: string; dueBefore?: string; limit?: number } = {},
): Followup[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    if (options.status.includes(',')) {
      const statuses = options.status.split(',').map((s) => s.trim());
      clauses.push(`f.status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    } else {
      clauses.push('f.status = ?');
      params.push(options.status);
    }
  }
  if (options.customerId) {
    clauses.push('f.customer_id = ?');
    params.push(options.customerId);
  }
  if (options.inquiryId) {
    clauses.push('f.inquiry_id = ?');
    params.push(options.inquiryId);
  }
  if (options.dueBefore) {
    clauses.push('f.due_at <= ?');
    params.push(options.dueBefore);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(
      `SELECT f.* FROM followups f ${where} ORDER BY f.due_at ASC LIMIT ?`,
      ...params,
      options.limit ?? 200,
    )
    .map(mapFollowup);
}

/** Rows the sweep should act on: due now, not yet sent, not snoozed into the future. */
export function dueFollowups(at: string = nowIso()): Followup[] {
  return getDb()
    .all<Row>(
      `SELECT * FROM followups
        WHERE status IN ('scheduled', 'pending_approval')
          AND due_at <= ?
          AND (snoozed_until IS NULL OR snoozed_until <= ?)
        ORDER BY due_at ASC`,
      at,
      at,
    )
    .map(mapFollowup);
}

/** Everything still open for a customer — cancelled when they reply. */
export function openFollowupsForCustomer(customerId: string): Followup[] {
  return getDb()
    .all<Row>(
      `SELECT * FROM followups
        WHERE customer_id = ? AND status IN ('scheduled', 'pending_approval')
        ORDER BY due_at ASC`,
      customerId,
    )
    .map(mapFollowup);
}

export function openFollowupsForInquiry(inquiryId: string): Followup[] {
  return getDb()
    .all<Row>(
      `SELECT * FROM followups
        WHERE inquiry_id = ? AND status IN ('scheduled', 'pending_approval')
        ORDER BY due_at ASC`,
      inquiryId,
    )
    .map(mapFollowup);
}

export function cancelOpenFollowups(scope: { inquiryId?: string; customerId?: string }, reason: string): number {
  const db = getDb();
  const at = nowIso();
  if (scope.inquiryId) {
    const result = db.run(
      `UPDATE followups SET status = 'replied', completed_at = ?, reason = ?, updated_at = ?
        WHERE inquiry_id = ? AND status IN ('scheduled', 'pending_approval')`,
      at,
      reason,
      at,
      scope.inquiryId,
    );
    return result.changes;
  }
  if (scope.customerId) {
    const result = db.run(
      `UPDATE followups SET status = 'replied', completed_at = ?, reason = ?, updated_at = ?
        WHERE customer_id = ? AND status IN ('scheduled', 'pending_approval')`,
      at,
      reason,
      at,
      scope.customerId,
    );
    return result.changes;
  }
  return 0;
}

export function followupStats(): Record<string, number> {
  const db = getDb();
  const at = nowIso();
  return {
    scheduled: db.count("SELECT COUNT(*) FROM followups WHERE status = 'scheduled'"),
    pendingApproval: db.count("SELECT COUNT(*) FROM followups WHERE status = 'pending_approval'"),
    sent: db.count("SELECT COUNT(*) FROM followups WHERE status = 'sent'"),
    replied: db.count("SELECT COUNT(*) FROM followups WHERE status = 'replied'"),
    overdue: db.count(
      "SELECT COUNT(*) FROM followups WHERE status IN ('scheduled','pending_approval') AND due_at <= ?",
      at,
    ),
    dueToday: db.count(
      "SELECT COUNT(*) FROM followups WHERE status IN ('scheduled','pending_approval') AND due_at <= ?",
      addDays(1),
    ),
  };
}

// ---------------------------------------------------------------------------
// Outbound messages
// ---------------------------------------------------------------------------

export interface OutboundMessage {
  id: string;
  channel: string;
  direction: string;
  inquiryId: string | null;
  quoteId: string | null;
  customerId: string | null;
  followupId: string | null;
  toAddr: string;
  fromAddr: string | null;
  subject: string | null;
  body: string;
  bodyHtml: string | null;
  language: string | null;
  status: string;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapMessage(row: Row): OutboundMessage {
  return {
    id: String(row.id),
    channel: String(row.channel),
    direction: String(row.direction ?? 'outbound'),
    inquiryId: (row.inquiry_id as string | null) ?? null,
    quoteId: (row.quote_id as string | null) ?? null,
    customerId: (row.customer_id as string | null) ?? null,
    followupId: (row.followup_id as string | null) ?? null,
    toAddr: String(row.to_addr),
    fromAddr: (row.from_addr as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    body: String(row.body ?? ''),
    bodyHtml: (row.body_html as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    status: String(row.status ?? 'draft'),
    provider: (row.provider as string | null) ?? null,
    providerMessageId: (row.provider_message_id as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: (row.approved_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createMessage(input: {
  channel: string;
  inquiryId?: string | null;
  quoteId?: string | null;
  customerId?: string | null;
  followupId?: string | null;
  toAddr: string;
  fromAddr?: string | null;
  subject?: string | null;
  body: string;
  bodyHtml?: string | null;
  language?: string | null;
  status?: string;
  createdBy?: string | null;
}): OutboundMessage {
  const db = getDb();
  const id = uid('msg');
  const at = nowIso();
  db.run(
    `INSERT INTO outbound_messages (id, channel, direction, inquiry_id, quote_id, customer_id, followup_id, to_addr,
       from_addr, subject, body, body_html, language, status, created_by, created_at, updated_at)
     VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.channel,
    input.inquiryId ?? null,
    input.quoteId ?? null,
    input.customerId ?? null,
    input.followupId ?? null,
    input.toAddr,
    input.fromAddr ?? null,
    input.subject ?? null,
    input.body,
    input.bodyHtml ?? null,
    input.language ?? null,
    input.status ?? 'draft',
    input.createdBy ?? null,
    at,
    at,
  );
  return getMessage(id)!;
}

export function getMessage(id: string): OutboundMessage | null {
  const row = getDb().get<Row>('SELECT * FROM outbound_messages WHERE id = ?', id);
  return row ? mapMessage(row) : null;
}

export function listMessages(
  options: { status?: string; inquiryId?: string; customerId?: string; channel?: string; limit?: number } = {},
): OutboundMessage[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    if (options.status.includes(',')) {
      const statuses = options.status.split(',').map((s) => s.trim());
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    } else {
      clauses.push('status = ?');
      params.push(options.status);
    }
  }
  if (options.inquiryId) {
    clauses.push('inquiry_id = ?');
    params.push(options.inquiryId);
  }
  if (options.customerId) {
    clauses.push('customer_id = ?');
    params.push(options.customerId);
  }
  if (options.channel) {
    clauses.push('channel = ?');
    params.push(options.channel);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(`SELECT * FROM outbound_messages ${where} ORDER BY created_at DESC LIMIT ?`, ...params, options.limit ?? 100)
    .map(mapMessage);
}

export function updateMessage(id: string, patch: Record<string, unknown>): boolean {
  return getDb().update('outbound_messages', id, patch);
}

export function markMessageSent(id: string, input: { provider: string; providerMessageId?: string | null }): void {
  const at = nowIso();
  getDb().update('outbound_messages', id, {
    status: 'sent',
    provider: input.provider,
    provider_message_id: input.providerMessageId ?? null,
    sent_at: at,
    error: null,
  });
}

export function markMessageFailed(id: string, error: string): void {
  getDb().update('outbound_messages', id, { status: 'failed', error: error.slice(0, 800) });
}

// ---------------------------------------------------------------------------
// Playbooks (话术库)
// ---------------------------------------------------------------------------

export interface Playbook {
  id: string;
  name: string;
  category: string | null;
  stage: string;
  channel: string;
  language: string;
  subjectTpl: string | null;
  bodyTpl: string;
  variables: string[];
  tags: string[];
  usageCount: number;
  replyCount: number;
  winCount: number;
  builtin: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function mapPlaybook(row: Row): Playbook {
  return {
    id: String(row.id),
    name: String(row.name),
    category: (row.category as string | null) ?? null,
    stage: String(row.stage ?? 'first_reply'),
    channel: String(row.channel ?? 'email'),
    language: String(row.language ?? 'en'),
    subjectTpl: (row.subject_tpl as string | null) ?? null,
    bodyTpl: String(row.body_tpl ?? ''),
    variables: parseJson<string[]>(row.variables, []),
    tags: parseJson<string[]>(row.tags, []),
    usageCount: Number(row.usage_count ?? 0),
    replyCount: Number(row.reply_count ?? 0),
    winCount: Number(row.win_count ?? 0),
    builtin: toBool(row.builtin),
    active: toBool(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listPlaybooks(options: { stage?: string; language?: string; channel?: string; activeOnly?: boolean } = {}): Playbook[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.stage) {
    clauses.push('stage = ?');
    params.push(options.stage);
  }
  if (options.language) {
    clauses.push('language = ?');
    params.push(options.language);
  }
  if (options.channel) {
    clauses.push('channel = ?');
    params.push(options.channel);
  }
  if (options.activeOnly !== false) clauses.push('active = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(`SELECT * FROM playbooks ${where} ORDER BY win_count DESC, usage_count DESC, name`, ...params)
    .map(mapPlaybook);
}

export function getPlaybook(id: string): Playbook | null {
  const row = getDb().get<Row>('SELECT * FROM playbooks WHERE id = ? OR name = ?', id, id);
  return row ? mapPlaybook(row) : null;
}

/**
 * Best playbook for a stage, preferring the language the customer speaks and
 * falling back to English. Ranking favours what has actually won deals.
 */
export function pickPlaybook(stage: string, language: string, channel = 'email'): Playbook | null {
  const base = language.split('-')[0]!;
  const candidates = listPlaybooks({ stage, channel }).filter((book) => book.language === base || book.language === 'en');
  if (candidates.length === 0) return listPlaybooks({ stage, channel: 'email' })[0] ?? null;
  return candidates.sort((a, b) => {
    const langScore = (book: Playbook) => (book.language === base ? 1 : 0);
    const score = (book: Playbook) =>
      langScore(book) * 1000 + book.winCount * 10 + book.replyCount * 2 + book.usageCount * 0.1;
    return score(b) - score(a);
  })[0]!;
}

export function upsertPlaybook(input: Partial<Playbook> & { name: string; bodyTpl: string }): Playbook {
  const db = getDb();
  const at = nowIso();
  const existing = input.id ? getPlaybook(input.id) : getPlaybook(input.name);
  if (existing) {
    db.update('playbooks', existing.id, {
      name: input.name,
      category: input.category ?? existing.category,
      stage: input.stage ?? existing.stage,
      channel: input.channel ?? existing.channel,
      language: input.language ?? existing.language,
      subject_tpl: input.subjectTpl ?? existing.subjectTpl,
      body_tpl: input.bodyTpl,
      variables: JSON.stringify(input.variables ?? existing.variables),
      tags: JSON.stringify(input.tags ?? existing.tags),
      active: input.active === undefined ? (existing.active ? 1 : 0) : input.active ? 1 : 0,
    });
    return getPlaybook(existing.id)!;
  }
  const id = input.id ?? uid('pbk');
  db.run(
    `INSERT INTO playbooks (id, name, category, stage, channel, language, subject_tpl, body_tpl, variables, tags,
       usage_count, reply_count, win_count, builtin, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 1, ?, ?)`,
    id,
    input.name,
    input.category ?? null,
    input.stage ?? 'first_reply',
    input.channel ?? 'email',
    input.language ?? 'en',
    input.subjectTpl ?? null,
    input.bodyTpl,
    JSON.stringify(input.variables ?? []),
    JSON.stringify(input.tags ?? []),
    input.builtin ? 1 : 0,
    at,
    at,
  );
  return getPlaybook(id)!;
}

export function bumpPlaybook(id: string, field: 'usage_count' | 'reply_count' | 'win_count'): void {
  getDb().run(`UPDATE playbooks SET ${field} = ${field} + 1, updated_at = ? WHERE id = ?`, nowIso(), id);
}

// ---------------------------------------------------------------------------
// Internal threads (业务对齐群) & alerts
// ---------------------------------------------------------------------------

export interface Thread {
  id: string;
  subject: string;
  topic: string | null;
  entityType: string | null;
  entityId: string | null;
  status: string;
  severity: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  messages?: Array<{ id: string; author: string; role: string | null; body: string; mentions: string[]; createdAt: string }>;
}

export function mapThread(row: Row): Thread {
  return {
    id: String(row.id),
    subject: String(row.subject),
    topic: (row.topic as string | null) ?? null,
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    status: String(row.status ?? 'open'),
    severity: String(row.severity ?? 'normal'),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createThread(input: {
  subject: string;
  topic?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  severity?: string;
  createdBy: string;
  messages?: Array<{ author: string; role?: string | null; body: string; mentions?: string[] }>;
}): Thread {
  const db = getDb();
  const id = uid('thr');
  const at = nowIso();
  db.transaction(() => {
    db.run(
      `INSERT INTO threads (id, subject, topic, entity_type, entity_id, status, severity, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      id,
      input.subject,
      input.topic ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.severity ?? 'normal',
      input.createdBy,
      at,
      at,
    );
    for (const message of input.messages ?? []) {
      appendThreadMessage(id, message);
    }
  });
  return getThread(id)!;
}

export function appendThreadMessage(
  threadId: string,
  message: { author: string; role?: string | null; body: string; mentions?: string[] },
): void {
  const db = getDb();
  const at = nowIso();
  db.run(
    `INSERT INTO thread_messages (id, thread_id, author, role, body, mentions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    uid('tmsg'),
    threadId,
    message.author,
    message.role ?? null,
    message.body,
    JSON.stringify(message.mentions ?? []),
    at,
  );
  db.run('UPDATE threads SET updated_at = ? WHERE id = ?', at, threadId);
}

export function getThread(id: string, withMessages = true): Thread | null {
  const row = getDb().get<Row>('SELECT * FROM threads WHERE id = ?', id);
  if (!row) return null;
  const thread = mapThread(row);
  if (withMessages) {
    thread.messages = getDb()
      .all<Row>('SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY created_at ASC', id)
      .map((message) => ({
        id: String(message.id),
        author: String(message.author),
        role: (message.role as string | null) ?? null,
        body: String(message.body),
        mentions: parseJson<string[]>(message.mentions, []),
        createdAt: String(message.created_at),
      }));
  }
  return thread;
}

export function listThreads(options: { status?: string; entityId?: string; limit?: number } = {}): Thread[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.entityId) {
    clauses.push('entity_id = ?');
    params.push(options.entityId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(`SELECT * FROM threads ${where} ORDER BY updated_at DESC LIMIT ?`, ...params, options.limit ?? 100)
    .map(mapThread);
}

/** Avoid duplicate escalations for the same entity. */
export function findOpenThreadFor(entityType: string, entityId: string): Thread | null {
  const row = getDb().get<Row>(
    "SELECT * FROM threads WHERE entity_type = ? AND entity_id = ? AND status = 'open' LIMIT 1",
    entityType,
    entityId,
  );
  return row ? mapThread(row) : null;
}

export interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export function mapAlert(row: Row): Alert {
  return {
    id: String(row.id),
    type: String(row.type),
    severity: String(row.severity ?? 'warning'),
    title: String(row.title),
    body: (row.body as string | null) ?? null,
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    acknowledged: toBool(row.acknowledged),
    acknowledgedBy: (row.acknowledged_by as string | null) ?? null,
    acknowledgedAt: (row.acknowledged_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function createAlert(input: {
  type: string;
  severity?: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): Alert {
  const id = uid('alr');
  getDb().run(
    `INSERT INTO alerts (id, type, severity, title, body, entity_type, entity_id, acknowledged, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id,
    input.type,
    input.severity ?? 'warning',
    input.title,
    input.body ?? null,
    input.entityType ?? null,
    input.entityId ?? null,
    nowIso(),
  );
  return mapAlert(getDb().get<Row>('SELECT * FROM alerts WHERE id = ?', id)!);
}

export function listAlerts(options: { openOnly?: boolean; limit?: number } = {}): Alert[] {
  const where = options.openOnly === false ? '' : 'WHERE acknowledged = 0';
  return getDb()
    .all<Row>(`SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT ?`, options.limit ?? 100)
    .map(mapAlert);
}

export function acknowledgeAlert(id: string, by: string): boolean {
  return (
    getDb().run(
      'UPDATE alerts SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = ? WHERE id = ?',
      by,
      nowIso(),
      id,
    ).changes > 0
  );
}
