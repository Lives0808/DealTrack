import { getDb, type Row } from '../db.js';
import { code, nowIso, parseJson, uid } from '../util.js';

// ---------------------------------------------------------------------------
// Customers (客户库)
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  company: string;
  country: string | null;
  countryCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  language: string;
  timezone: string | null;
  source: string;
  status: 'lead' | 'prospect' | 'active' | 'dormant' | 'blocked';
  tier: string;
  tags: string[];
  preferences: Record<string, unknown>;
  notes: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived stats, filled by `withStats`. */
  stats?: CustomerStats;
}

export interface CustomerStats {
  inquiries: number;
  quotes: number;
  won: number;
  lost: number;
  quotedValue: number;
  wonValue: number;
  lastContactAt: string | null;
  winRate: number;
}

export function mapCustomer(row: Row): Customer {
  return {
    id: String(row.id),
    company: String(row.company),
    country: (row.country as string | null) ?? null,
    countryCode: (row.country_code as string | null) ?? null,
    contactName: (row.contact_name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    whatsapp: (row.whatsapp as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    language: String(row.language ?? 'en'),
    timezone: (row.timezone as string | null) ?? null,
    source: String(row.source ?? 'inbound'),
    status: String(row.status ?? 'lead') as Customer['status'],
    tier: String(row.tier ?? 'standard'),
    tags: parseJson<string[]>(row.tags, []),
    preferences: parseJson<Record<string, unknown>>(row.preferences, {}),
    notes: (row.notes as string | null) ?? null,
    ownerId: (row.owner_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listCustomers(
  options: { status?: string; search?: string; country?: string; limit?: number; orderBy?: string } = {},
): Customer[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.country) {
    clauses.push('country_code = ?');
    params.push(options.country);
  }
  if (options.search) {
    const like = `%${options.search}%`;
    clauses.push('(company LIKE ? OR contact_name LIKE ? OR email LIKE ? OR whatsapp LIKE ?)');
    params.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = options.orderBy === 'name' ? 'company ASC' : 'updated_at DESC';
  return getDb()
    .all<Row>(`SELECT * FROM customers ${where} ORDER BY ${order} LIMIT ?`, ...params, options.limit ?? 200)
    .map(mapCustomer);
}

export function getCustomer(id: string): Customer | null {
  const row = getDb().get<Row>('SELECT * FROM customers WHERE id = ?', id);
  return row ? mapCustomer(row) : null;
}

export function findByEmail(email: string | null | undefined): Customer | null {
  if (!email) return null;
  const row = getDb().get<Row>('SELECT * FROM customers WHERE lower(email) = lower(?)', email.trim());
  return row ? mapCustomer(row) : null;
}

export function findByContact(input: {
  email?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  company?: string | null;
}): Customer | null {
  if (input.email) {
    const byEmail = findByEmail(input.email);
    if (byEmail) return byEmail;
  }
  const digits = (input.whatsapp ?? input.phone ?? '').replace(/\D/g, '');
  if (digits.length >= 6) {
    const row = getDb().get<Row>(
      `SELECT * FROM customers
        WHERE replace(replace(replace(coalesce(whatsapp,''), '+', ''), ' ', ''), '-', '') LIKE ?
           OR replace(replace(replace(coalesce(phone,''), '+', ''), ' ', ''), '-', '') LIKE ?
        LIMIT 1`,
      `%${digits.slice(-9)}`,
      `%${digits.slice(-9)}`,
    );
    if (row) return mapCustomer(row);
  }
  if (input.company) {
    const row = getDb().get<Row>('SELECT * FROM customers WHERE lower(company) = lower(?)', input.company.trim());
    if (row) return mapCustomer(row);
  }
  return null;
}

export function upsertCustomer(input: Partial<Customer> & { company: string }): { customer: Customer; created: boolean } {
  const db = getDb();
  const existing = input.id ? getCustomer(input.id) : findByContact({ email: input.email, whatsapp: input.whatsapp, company: input.company });

  if (existing) {
    const patch: Record<string, unknown> = { company: input.company };
    const setIf = (key: keyof Customer, column: string) => {
      const value = input[key];
      if (value !== undefined && value !== null && value !== '') patch[column] = value;
    };
    setIf('country', 'country');
    setIf('countryCode', 'country_code');
    setIf('contactName', 'contact_name');
    setIf('email', 'email');
    setIf('phone', 'phone');
    setIf('whatsapp', 'whatsapp');
    setIf('website', 'website');
    setIf('language', 'language');
    setIf('timezone', 'timezone');
    setIf('source', 'source');
    setIf('status', 'status');
    setIf('tier', 'tier');
    setIf('notes', 'notes');
    setIf('ownerId', 'owner_id');
    if (input.tags) patch.tags = JSON.stringify(input.tags);
    if (input.preferences) patch.preferences = JSON.stringify({ ...existing.preferences, ...input.preferences });

    const changed = Object.keys(patch).length > 1;
    if (changed) db.update('customers', existing.id, patch);
    return { customer: getCustomer(existing.id)!, created: false };
  }

  const id = input.id ?? uid('cus');
  const at = nowIso();
  db.run(
    `INSERT INTO customers (id, company, country, country_code, contact_name, email, phone, whatsapp, website,
       language, timezone, source, status, tier, tags, preferences, notes, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.company,
    input.country ?? null,
    input.countryCode ?? null,
    input.contactName ?? null,
    input.email ?? null,
    input.phone ?? null,
    input.whatsapp ?? null,
    input.website ?? null,
    input.language ?? 'en',
    input.timezone ?? null,
    input.source ?? 'inbound',
    input.status ?? 'lead',
    input.tier ?? 'standard',
    JSON.stringify(input.tags ?? []),
    JSON.stringify(input.preferences ?? {}),
    input.notes ?? null,
    input.ownerId ?? null,
    at,
    at,
  );
  return { customer: getCustomer(id)!, created: true };
}

export function customerStats(customerId: string): CustomerStats {
  const db = getDb();
  const inquiries = db.count('SELECT COUNT(*) FROM inquiries WHERE customer_id = ?', customerId);
  const quotes = db.get<Row>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(total), 0) AS value
       FROM quotes WHERE customer_id = ?`,
    customerId,
  );
  const outcomes = db.get<Row>(
    `SELECT
       SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) AS won,
       SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) AS lost,
       COALESCE(SUM(CASE WHEN result = 'won' THEN final_price ELSE 0 END), 0) AS won_value
     FROM quote_outcomes WHERE customer_id = ?`,
    customerId,
  );
  const last = db.get<Row>(
    `SELECT MAX(created_at) AS at FROM (
       SELECT created_at FROM inquiries WHERE customer_id = ?
       UNION ALL SELECT sent_at AS created_at FROM outbound_messages WHERE customer_id = ? AND sent_at IS NOT NULL
     )`,
    customerId,
    customerId,
  );
  const won = Number(outcomes?.won ?? 0);
  const lost = Number(outcomes?.lost ?? 0);
  return {
    inquiries,
    quotes: Number(quotes?.n ?? 0),
    won,
    lost,
    quotedValue: Number(quotes?.value ?? 0),
    wonValue: Number(outcomes?.won_value ?? 0),
    lastContactAt: (last?.at as string | null) ?? null,
    winRate: won + lost > 0 ? Number((won / (won + lost)).toFixed(3)) : 0,
  };
}

export function customerHistory(customerId: string, limit = 50): Array<Record<string, unknown>> {
  const db = getDb();
  return db.all<Row>(
    `SELECT 'inquiry' AS kind, id, code AS ref, subject AS title, status, received_at AS at, NULL AS amount, NULL AS currency
       FROM inquiries WHERE customer_id = ?
     UNION ALL
     SELECT 'quote' AS kind, id, quote_no AS ref, incoterm AS title, status, created_at AS at, total AS amount, currency
       FROM quotes WHERE customer_id = ?
     UNION ALL
     SELECT 'message' AS kind, id, channel AS ref, subject AS title, status, created_at AS at, NULL AS amount, NULL AS currency
       FROM outbound_messages WHERE customer_id = ?
     ORDER BY at DESC LIMIT ?`,
    customerId,
    customerId,
    customerId,
    limit,
  ).map((row) => ({
    kind: row.kind,
    id: row.id,
    ref: row.ref,
    title: row.title,
    status: row.status,
    at: row.at,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
  }));
}

// ---------------------------------------------------------------------------
// Inquiries (询盘)
// ---------------------------------------------------------------------------

export interface InquiryItem {
  id: string;
  lineNo: number;
  rawText: string | null;
  productId: string | null;
  sku: string | null;
  description: string | null;
  qty: number | null;
  unit: string | null;
  targetPrice: number | null;
  currency: string | null;
  leadTimeDays: number | null;
  matchConfidence: number | null;
  notes: string | null;
}

export interface Inquiry {
  id: string;
  code: string;
  customerId: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  body: string | null;
  fromEmail: string | null;
  fromName: string | null;
  fromPhone: string | null;
  language: string | null;
  detectedIntent: string | null;
  status: string;
  priority: string;
  ownerId: string | null;
  parsed: Record<string, unknown> | null;
  parseConfidence: number | null;
  productMatches: Array<{ productId: string; sku: string; nameEn: string; score: number }>;
  missingInfo: string[];
  summaryZh: string | null;
  attachments: unknown[];
  messageId: string | null;
  threadId: string | null;
  receivedAt: string;
  firstResponseAt: string | null;
  firstResponseSeconds: number | null;
  quotedAt: string | null;
  wonAt: string | null;
  lostAt: string | null;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InquiryItem[];
  customer?: Customer | null;
}

export function mapInquiry(row: Row): Inquiry {
  return {
    id: String(row.id),
    code: String(row.code),
    customerId: (row.customer_id as string | null) ?? null,
    channel: String(row.channel ?? 'email'),
    direction: String(row.direction ?? 'inbound'),
    subject: (row.subject as string | null) ?? null,
    body: (row.body as string | null) ?? null,
    fromEmail: (row.from_email as string | null) ?? null,
    fromName: (row.from_name as string | null) ?? null,
    fromPhone: (row.from_phone as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    detectedIntent: (row.detected_intent as string | null) ?? null,
    status: String(row.status ?? 'new'),
    priority: String(row.priority ?? 'normal'),
    ownerId: (row.owner_id as string | null) ?? null,
    parsed: row.parsed ? parseJson<Record<string, unknown>>(row.parsed, {}) : null,
    parseConfidence:
      row.parse_confidence === null || row.parse_confidence === undefined ? null : Number(row.parse_confidence),
    productMatches: parseJson<Inquiry['productMatches']>(row.product_matches, []),
    missingInfo: parseJson<string[]>(row.missing_info, []),
    summaryZh: (row.summary_zh as string | null) ?? null,
    attachments: parseJson<unknown[]>(row.attachments, []),
    messageId: (row.message_id as string | null) ?? null,
    threadId: (row.thread_id as string | null) ?? null,
    receivedAt: String(row.received_at),
    firstResponseAt: (row.first_response_at as string | null) ?? null,
    firstResponseSeconds:
      row.first_response_seconds === null || row.first_response_seconds === undefined
        ? null
        : Number(row.first_response_seconds),
    quotedAt: (row.quoted_at as string | null) ?? null,
    wonAt: (row.won_at as string | null) ?? null,
    lostAt: (row.lost_at as string | null) ?? null,
    slaDueAt: (row.sla_due_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapInquiryItem(row: Row): InquiryItem {
  return {
    id: String(row.id),
    lineNo: Number(row.line_no ?? 1),
    rawText: (row.raw_text as string | null) ?? null,
    productId: (row.product_id as string | null) ?? null,
    sku: (row.sku as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
    unit: (row.unit as string | null) ?? null,
    targetPrice: row.target_price === null || row.target_price === undefined ? null : Number(row.target_price),
    currency: (row.currency as string | null) ?? null,
    leadTimeDays: row.lead_time_days === null || row.lead_time_days === undefined ? null : Number(row.lead_time_days),
    matchConfidence:
      row.match_confidence === null || row.match_confidence === undefined ? null : Number(row.match_confidence),
    notes: (row.notes as string | null) ?? null,
  };
}

export function nextInquiryCode(at: Date = new Date()): string {
  const db = getDb();
  const prefix = `INQ-${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, '0')}${String(at.getUTCDate()).padStart(2, '0')}`;
  const count = db.count('SELECT COUNT(*) FROM inquiries WHERE code LIKE ?', `${prefix}%`);
  return code('INQ', count + 1, at);
}

export function createInquiry(input: {
  customerId?: string | null;
  channel?: string;
  subject?: string | null;
  body?: string | null;
  raw?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  fromPhone?: string | null;
  language?: string | null;
  receivedAt?: string;
  messageId?: string | null;
  threadId?: string | null;
  priority?: string;
  ownerId?: string | null;
  slaDueAt?: string | null;
  attachments?: unknown[];
}): Inquiry {
  const db = getDb();
  const id = uid('inq');
  const at = nowIso();
  const receivedAt = input.receivedAt ?? at;
  db.run(
    `INSERT INTO inquiries (id, code, customer_id, channel, direction, subject, body, raw, from_email, from_name,
       from_phone, language, status, priority, owner_id, attachments, message_id, thread_id, received_at,
       sla_due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    nextInquiryCode(new Date(receivedAt)),
    input.customerId ?? null,
    input.channel ?? 'email',
    input.subject ?? null,
    input.body ?? null,
    input.raw ?? input.body ?? null,
    input.fromEmail ?? null,
    input.fromName ?? null,
    input.fromPhone ?? null,
    input.language ?? null,
    input.priority ?? 'normal',
    input.ownerId ?? null,
    JSON.stringify(input.attachments ?? []),
    input.messageId ?? null,
    input.threadId ?? null,
    receivedAt,
    input.slaDueAt ?? null,
    at,
    at,
  );
  return getInquiry(id)!;
}

export function getInquiry(id: string, withItems = true): Inquiry | null {
  const row = getDb().get<Row>('SELECT * FROM inquiries WHERE id = ? OR code = ?', id, id);
  if (!row) return null;
  const inquiry = mapInquiry(row);
  if (withItems) inquiry.items = listInquiryItems(inquiry.id);
  if (inquiry.customerId) inquiry.customer = getCustomer(inquiry.customerId);
  return inquiry;
}

export function listInquiryItems(inquiryId: string): InquiryItem[] {
  return getDb()
    .all<Row>('SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY line_no', inquiryId)
    .map(mapInquiryItem);
}

export function replaceInquiryItems(
  inquiryId: string,
  items: Array<Partial<InquiryItem> & { description?: string | null }>,
): void {
  const db = getDb();
  db.transaction(() => {
    db.run('DELETE FROM inquiry_items WHERE inquiry_id = ?', inquiryId);
    items.forEach((item, index) => {
      db.run(
        `INSERT INTO inquiry_items (id, inquiry_id, line_no, raw_text, product_id, sku, description, qty, unit,
           target_price, currency, lead_time_days, match_confidence, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        item.id ?? uid('iitem'),
        inquiryId,
        item.lineNo ?? index + 1,
        item.rawText ?? null,
        item.productId ?? null,
        item.sku ?? null,
        item.description ?? null,
        item.qty ?? null,
        item.unit ?? null,
        item.targetPrice ?? null,
        item.currency ?? null,
        item.leadTimeDays ?? null,
        item.matchConfidence ?? null,
        item.notes ?? null,
      );
    });
  });
}

export function updateInquiry(id: string, patch: Partial<Inquiry> & Record<string, unknown>): boolean {
  const columnMap: Record<string, string> = {
    customerId: 'customer_id',
    subject: 'subject',
    body: 'body',
    language: 'language',
    detectedIntent: 'detected_intent',
    status: 'status',
    priority: 'priority',
    ownerId: 'owner_id',
    parsed: 'parsed',
    parseConfidence: 'parse_confidence',
    productMatches: 'product_matches',
    missingInfo: 'missing_info',
    summaryZh: 'summary_zh',
    firstResponseAt: 'first_response_at',
    firstResponseSeconds: 'first_response_seconds',
    quotedAt: 'quoted_at',
    wonAt: 'won_at',
    lostAt: 'lost_at',
    slaDueAt: 'sla_due_at',
    threadId: 'thread_id',
  };
  const dbPatch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columnMap)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    dbPatch[column] = /^(parsed|productMatches|missingInfo)$/.test(key)
      ? JSON.stringify(value)
      : value;
  }
  if (Object.keys(dbPatch).length === 0) return false;
  return getDb().update('inquiries', id, dbPatch);
}

export function listInquiries(
  options: {
    status?: string;
    customerId?: string;
    channel?: string;
    search?: string;
    ownerId?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'recent' | 'sla' | 'value';
  } = {},
): Inquiry[] {
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
  if (options.customerId) {
    clauses.push('customer_id = ?');
    params.push(options.customerId);
  }
  if (options.channel) {
    clauses.push('channel = ?');
    params.push(options.channel);
  }
  if (options.ownerId) {
    clauses.push('owner_id = ?');
    params.push(options.ownerId);
  }
  if (options.search) {
    const like = `%${options.search}%`;
    clauses.push('(subject LIKE ? OR body LIKE ? OR code LIKE ? OR from_email LIKE ?)');
    params.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order =
    options.orderBy === 'sla'
      ? 'sla_due_at ASC NULLS LAST'
      : options.orderBy === 'value'
        ? 'received_at DESC'
        : 'received_at DESC';
  return getDb()
    .all<Row>(
      `SELECT * FROM inquiries ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...params,
      options.limit ?? 100,
      options.offset ?? 0,
    )
    .map(mapInquiry);
}

/** Mark the first human/agent reply — this is the number the whole product moves. */
export function markFirstResponse(inquiryId: string, at: string = nowIso()): number | null {
  const db = getDb();
  const row = db.get<Row>('SELECT received_at, first_response_at FROM inquiries WHERE id = ?', inquiryId);
  if (!row || row.first_response_at) return null;
  const seconds = Math.round((new Date(at).getTime() - new Date(String(row.received_at)).getTime()) / 1000);
  db.run(
    'UPDATE inquiries SET first_response_at = ?, first_response_seconds = ?, updated_at = ? WHERE id = ?',
    at,
    seconds,
    nowIso(),
    inquiryId,
  );
  return seconds;
}

export function inquiriesAwaitingReply(): Inquiry[] {
  return getDb()
    .all<Row>(
      `SELECT * FROM inquiries
        WHERE status IN ('new', 'parsed')
          AND first_response_at IS NULL
        ORDER BY received_at ASC`,
    )
    .map(mapInquiry);
}

export function inquiryTimeline(inquiryId: string, limit = 200): Array<Record<string, unknown>> {
  const db = getDb();
  const inquiry = getInquiry(inquiryId, false);
  if (!inquiry) return [];
  const events = db.all<Row>(
    `SELECT id, type, actor, subject, payload, created_at FROM events
      WHERE (entity_type = 'inquiry' AND entity_id = ?)
         OR (entity_type = 'quote' AND entity_id IN (SELECT id FROM quotes WHERE inquiry_id = ?))
         OR (entity_type = 'followup' AND entity_id IN (SELECT id FROM followups WHERE inquiry_id = ?))
         OR (entity_type = 'message' AND entity_id IN (SELECT id FROM outbound_messages WHERE inquiry_id = ?))
      ORDER BY created_at ASC LIMIT ?`,
    inquiryId,
    inquiryId,
    inquiryId,
    inquiryId,
    limit,
  );
  return events.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    actor: String(row.actor),
    subject: (row.subject as string | null) ?? null,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    at: String(row.created_at),
  }));
}
