import { getDb, type Row } from '../db.js';
import { addDays, nowIso, parseJson, uid } from '../util.js';
import { getCustomer, type Customer } from './sales.js';

// ---------------------------------------------------------------------------
// Quotes (报价历史)
// ---------------------------------------------------------------------------

export interface QuoteItem {
  id: string;
  quoteId: string;
  lineNo: number;
  productId: string | null;
  sku: string | null;
  description: string;
  descriptionI18n: Record<string, string>;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
  unitCost: number | null;
  costCurrency: string | null;
  currency: string | null;
  hsCode: string | null;
  leadTimeDays: number | null;
  notes: string | null;
}

export interface Quote {
  id: string;
  quoteNo: string;
  inquiryId: string | null;
  customerId: string;
  version: number;
  parentQuoteId: string | null;
  currency: string;
  incoterm: string;
  incotermPlace: string;
  validUntil: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  moq: number | null;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  freight: number;
  insurance: number;
  otherFees: number;
  total: number;
  costTotal: number;
  marginPct: number | null;
  marginAmount: number | null;
  status: string;
  language: string;
  priceBreakdown: unknown[];
  appliedRules: unknown[];
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  notes: string | null;
  internalNotes: string | null;
  pdfPath: string | null;
  createdAt: string;
  updatedAt: string;
  items?: QuoteItem[];
  customer?: Customer | null;
}

export function mapQuote(row: Row): Quote {
  return {
    id: String(row.id),
    quoteNo: String(row.quote_no),
    inquiryId: (row.inquiry_id as string | null) ?? null,
    customerId: String(row.customer_id),
    version: Number(row.version ?? 1),
    parentQuoteId: (row.parent_quote_id as string | null) ?? null,
    currency: String(row.currency ?? 'USD'),
    incoterm: String(row.incoterm ?? 'FOB'),
    incotermPlace: String(row.incoterm_place ?? 'Shenzhen'),
    validUntil: (row.valid_until as string | null) ?? null,
    paymentTerms: (row.payment_terms as string | null) ?? null,
    leadTimeDays: row.lead_time_days === null || row.lead_time_days === undefined ? null : Number(row.lead_time_days),
    moq: row.moq === null || row.moq === undefined ? null : Number(row.moq),
    subtotal: Number(row.subtotal ?? 0),
    discountPct: Number(row.discount_pct ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    freight: Number(row.freight ?? 0),
    insurance: Number(row.insurance ?? 0),
    otherFees: Number(row.other_fees ?? 0),
    total: Number(row.total ?? 0),
    costTotal: Number(row.cost_total ?? 0),
    marginPct: row.margin_pct === null || row.margin_pct === undefined ? null : Number(row.margin_pct),
    marginAmount: row.margin_amount === null || row.margin_amount === undefined ? null : Number(row.margin_amount),
    status: String(row.status ?? 'draft'),
    language: String(row.language ?? 'en'),
    priceBreakdown: parseJson<unknown[]>(row.price_breakdown, []),
    appliedRules: parseJson<unknown[]>(row.applied_rules, []),
    createdBy: String(row.created_by ?? 'agent:sales'),
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: (row.approved_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    internalNotes: (row.internal_notes as string | null) ?? null,
    pdfPath: (row.pdf_path as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapQuoteItem(row: Row): QuoteItem {
  return {
    id: String(row.id),
    quoteId: String(row.quote_id),
    lineNo: Number(row.line_no ?? 1),
    productId: (row.product_id as string | null) ?? null,
    sku: (row.sku as string | null) ?? null,
    description: String(row.description),
    descriptionI18n: parseJson<Record<string, string>>(row.description_i18n, {}),
    qty: Number(row.qty ?? 0),
    unit: String(row.unit ?? 'pcs'),
    unitPrice: Number(row.unit_price ?? 0),
    amount: Number(row.amount ?? 0),
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
    costCurrency: (row.cost_currency as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    hsCode: (row.hs_code as string | null) ?? null,
    leadTimeDays: row.lead_time_days === null || row.lead_time_days === undefined ? null : Number(row.lead_time_days),
    notes: (row.notes as string | null) ?? null,
  };
}

export function nextQuoteNo(at: Date = new Date()): string {
  const db = getDb();
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `QT-${y}${m}`;
  const count = db.count('SELECT COUNT(*) FROM quotes WHERE quote_no LIKE ?', `${prefix}%`);
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

export interface CreateQuoteInput {
  inquiryId?: string | null;
  customerId: string;
  currency: string;
  incoterm: string;
  incotermPlace: string;
  validUntil?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
  moq?: number | null;
  language?: string;
  createdBy?: string;
  notes?: string | null;
  internalNotes?: string | null;
  parentQuoteId?: string | null;
  version?: number;
  totals: {
    subtotal: number;
    discountPct: number;
    discountAmount: number;
    freight: number;
    insurance: number;
    otherFees: number;
    total: number;
    costTotal: number;
    marginPct: number;
    marginAmount: number;
  };
  items: Array<{
    productId?: string | null;
    sku?: string | null;
    description: string;
    descriptionI18n?: Record<string, string>;
    qty: number;
    unit: string;
    unitPrice: number;
    amount: number;
    unitCost?: number | null;
    costCurrency?: string | null;
    hsCode?: string | null;
    leadTimeDays?: number | null;
    notes?: string | null;
  }>;
  priceBreakdown?: unknown[];
  appliedRules?: unknown[];
  status?: string;
}

export function createQuote(input: CreateQuoteInput): Quote {
  const db = getDb();
  const id = uid('qte');
  const at = nowIso();
  const quoteNo = nextQuoteNo();

  db.transaction(() => {
    db.run(
      `INSERT INTO quotes (id, quote_no, inquiry_id, customer_id, version, parent_quote_id, currency, incoterm,
         incoterm_place, valid_until, payment_terms, lead_time_days, moq, subtotal, discount_pct, discount_amount,
         freight, insurance, other_fees, total, cost_total, margin_pct, margin_amount, status, language,
         price_breakdown, applied_rules, created_by, notes, internal_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      quoteNo,
      input.inquiryId ?? null,
      input.customerId,
      input.version ?? 1,
      input.parentQuoteId ?? null,
      input.currency,
      input.incoterm,
      input.incotermPlace,
      input.validUntil ?? addDays(30),
      input.paymentTerms ?? null,
      input.leadTimeDays ?? null,
      input.moq ?? null,
      input.totals.subtotal,
      input.totals.discountPct,
      input.totals.discountAmount,
      input.totals.freight,
      input.totals.insurance,
      input.totals.otherFees,
      input.totals.total,
      input.totals.costTotal,
      input.totals.marginPct,
      input.totals.marginAmount,
      input.status ?? 'draft',
      input.language ?? 'en',
      JSON.stringify(input.priceBreakdown ?? []),
      JSON.stringify(input.appliedRules ?? []),
      input.createdBy ?? 'agent:sales',
      input.notes ?? null,
      input.internalNotes ?? null,
      at,
      at,
    );

    input.items.forEach((item, index) => {
      db.run(
        `INSERT INTO quote_items (id, quote_id, line_no, product_id, sku, description, description_i18n, qty, unit,
           unit_price, amount, unit_cost, cost_currency, currency, hs_code, lead_time_days, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid('qitem'),
        id,
        index + 1,
        item.productId ?? null,
        item.sku ?? null,
        item.description,
        JSON.stringify(item.descriptionI18n ?? {}),
        item.qty,
        item.unit,
        item.unitPrice,
        item.amount,
        item.unitCost ?? null,
        item.costCurrency ?? null,
        input.currency,
        item.hsCode ?? null,
        item.leadTimeDays ?? null,
        item.notes ?? null,
      );
    });
  });

  return getQuote(id)!;
}

export function getQuote(id: string, withItems = true): Quote | null {
  const row = getDb().get<Row>('SELECT * FROM quotes WHERE id = ? OR quote_no = ?', id, id);
  if (!row) return null;
  const quote = mapQuote(row);
  if (withItems) quote.items = listQuoteItems(quote.id);
  quote.customer = getCustomer(quote.customerId);
  return quote;
}

export function listQuoteItems(quoteId: string): QuoteItem[] {
  return getDb()
    .all<Row>('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY line_no', quoteId)
    .map(mapQuoteItem);
}

export function listQuotes(
  options: {
    status?: string;
    customerId?: string;
    inquiryId?: string;
    search?: string;
    limit?: number;
    offset?: number;
    minMargin?: number;
  } = {},
): Quote[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    if (options.status.includes(',')) {
      const statuses = options.status.split(',').map((s) => s.trim());
      clauses.push(`q.status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    } else {
      clauses.push('q.status = ?');
      params.push(options.status);
    }
  }
  if (options.customerId) {
    clauses.push('q.customer_id = ?');
    params.push(options.customerId);
  }
  if (options.inquiryId) {
    clauses.push('q.inquiry_id = ?');
    params.push(options.inquiryId);
  }
  if (options.minMargin !== undefined) {
    clauses.push('q.margin_pct >= ?');
    params.push(options.minMargin);
  }
  if (options.search) {
    const like = `%${options.search}%`;
    clauses.push('(q.quote_no LIKE ? OR c.company LIKE ?)');
    params.push(like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(
      `SELECT q.* FROM quotes q
        LEFT JOIN customers c ON c.id = q.customer_id
        ${where}
       ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      options.limit ?? 100,
      options.offset ?? 0,
    )
    .map(mapQuote);
}

export function updateQuote(id: string, patch: Record<string, unknown>): boolean {
  const allowed = new Set([
    'status',
    'approved_by',
    'approved_at',
    'sent_at',
    'pdf_path',
    'notes',
    'internal_notes',
    'valid_until',
    'total',
    'subtotal',
    'margin_pct',
    'margin_amount',
    'discount_pct',
    'discount_amount',
    'freight',
    'insurance',
    'other_fees',
    'lead_time_days',
    'language',
    'version',
  ]);
  const dbPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) continue;
    dbPatch[key] = value;
  }
  if (Object.keys(dbPatch).length === 0) return false;
  return getDb().update('quotes', id, dbPatch);
}

// ---------------------------------------------------------------------------
// Outcomes (成交 / 丢单)
// ---------------------------------------------------------------------------

export const LOSS_REASONS = [
  'price',
  'lead_time',
  'quality',
  'payment_terms',
  'moq',
  'certification',
  'shipping',
  'competitor',
  'no_budget',
  'no_response',
  'spec_mismatch',
  'other',
] as const;

export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Record<string, string> = {
  price: '价格偏高',
  lead_time: '交期太长',
  quality: '质量/规格不符',
  payment_terms: '付款条件不接受',
  moq: '起订量过高',
  certification: '认证不满足',
  shipping: '运费过高',
  competitor: '被竞品拿下',
  no_budget: '客户预算取消',
  no_response: '客户失联',
  spec_mismatch: '规格不匹配',
  other: '其他',
};

export interface QuoteOutcome {
  id: string;
  quoteId: string;
  inquiryId: string | null;
  customerId: string | null;
  result: 'won' | 'lost' | 'no_response' | 'pending';
  reasonCode: string | null;
  reasonNote: string | null;
  competitor: string | null;
  finalPrice: number | null;
  decidedBy: string | null;
  decidedAt: string;
}

export function mapOutcome(row: Row): QuoteOutcome {
  return {
    id: String(row.id),
    quoteId: String(row.quote_id),
    inquiryId: (row.inquiry_id as string | null) ?? null,
    customerId: (row.customer_id as string | null) ?? null,
    result: String(row.result) as QuoteOutcome['result'],
    reasonCode: (row.reason_code as string | null) ?? null,
    reasonNote: (row.reason_note as string | null) ?? null,
    competitor: (row.competitor as string | null) ?? null,
    finalPrice: row.final_price === null || row.final_price === undefined ? null : Number(row.final_price),
    decidedBy: (row.decided_by as string | null) ?? null,
    decidedAt: String(row.decided_at),
  };
}

export function recordOutcome(input: {
  quoteId: string;
  result: QuoteOutcome['result'];
  reasonCode?: string | null;
  reasonNote?: string | null;
  competitor?: string | null;
  finalPrice?: number | null;
  decidedBy?: string | null;
}): QuoteOutcome {
  const db = getDb();
  const id = uid('out');
  const at = nowIso();
  const quote = getQuote(input.quoteId, false);
  db.run(
    `INSERT INTO quote_outcomes (id, quote_id, inquiry_id, customer_id, result, reason_code, reason_note,
       competitor, final_price, decided_by, decided_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.quoteId,
    quote?.inquiryId ?? null,
    quote?.customerId ?? null,
    input.result,
    input.reasonCode ?? null,
    input.reasonNote ?? null,
    input.competitor ?? null,
    input.finalPrice ?? quote?.total ?? null,
    input.decidedBy ?? null,
    at,
    at,
  );

  if (quote) {
    updateQuote(quote.id, {
      status: input.result === 'won' ? 'accepted' : input.result === 'lost' ? 'rejected' : quote.status,
    });
  }
  return mapOutcome(db.get<Row>('SELECT * FROM quote_outcomes WHERE id = ?', id)!);
}

export function listOutcomes(options: { quoteId?: string; result?: string; limit?: number } = {}): QuoteOutcome[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.quoteId) {
    clauses.push('quote_id = ?');
    params.push(options.quoteId);
  }
  if (options.result) {
    clauses.push('result = ?');
    params.push(options.result);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(`SELECT * FROM quote_outcomes ${where} ORDER BY decided_at DESC LIMIT ?`, ...params, options.limit ?? 200)
    .map(mapOutcome);
}

/** Loss-reason analytics — the board the boss uses to fix the playbook. */
export function lossAnalytics(sinceIso: string): {
  total: number;
  won: number;
  lost: number;
  noResponse: number;
  winRate: number;
  winRateByValue: number;
  reasons: Array<{ code: string; label: string; count: number; lostValue: number; share: number }>;
  byCountry: Array<{ country: string; won: number; lost: number; winRate: number }>;
  lostValue: number;
  wonValue: number;
} {
  const db = getDb();
  const totals = db.get<Row>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) AS lost,
            SUM(CASE WHEN result = 'no_response' THEN 1 ELSE 0 END) AS no_response,
            COALESCE(SUM(CASE WHEN result = 'won' THEN final_price ELSE 0 END), 0) AS won_value,
            COALESCE(SUM(CASE WHEN result = 'lost' THEN final_price ELSE 0 END), 0) AS lost_value
       FROM quote_outcomes WHERE decided_at >= ?`,
    sinceIso,
  );

  const reasonRows = db.all<Row>(
    `SELECT reason_code, COUNT(*) AS n, COALESCE(SUM(final_price), 0) AS value
       FROM quote_outcomes
      WHERE decided_at >= ? AND result IN ('lost', 'no_response')
      GROUP BY reason_code ORDER BY n DESC`,
    sinceIso,
  );

  const countryRows = db.all<Row>(
    `SELECT COALESCE(c.country, '未知') AS country,
            SUM(CASE WHEN o.result = 'won' THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN o.result = 'lost' THEN 1 ELSE 0 END) AS lost
       FROM quote_outcomes o
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.decided_at >= ?
      GROUP BY country ORDER BY (won + lost) DESC LIMIT 12`,
    sinceIso,
  );

  const lost = Number(totals?.lost ?? 0);
  const noResponse = Number(totals?.no_response ?? 0);
  const won = Number(totals?.won ?? 0);
  const closed = won + lost + noResponse;
  const lostRows = reasonRows.reduce((sum, row) => sum + Number(row.n), 0);

  return {
    total: Number(totals?.n ?? 0),
    won,
    lost,
    noResponse,
    winRate: closed > 0 ? Number((won / closed).toFixed(4)) : 0,
    winRateByValue:
      Number(totals?.won_value ?? 0) + Number(totals?.lost_value ?? 0) > 0
        ? Number(
            (
              Number(totals?.won_value ?? 0) /
              (Number(totals?.won_value ?? 0) + Number(totals?.lost_value ?? 0))
            ).toFixed(4),
          )
        : 0,
    reasons: reasonRows.map((row) => {
      const code = String(row.reason_code ?? 'other');
      return {
        code,
        label: LOSS_REASON_LABELS[code] ?? code,
        count: Number(row.n),
        lostValue: Number(row.value ?? 0),
        share: lostRows > 0 ? Number((Number(row.n) / lostRows).toFixed(4)) : 0,
      };
    }),
    byCountry: countryRows.map((row) => {
      const w = Number(row.won ?? 0);
      const l = Number(row.lost ?? 0);
      return {
        country: String(row.country),
        won: w,
        lost: l,
        winRate: w + l > 0 ? Number((w / (w + l)).toFixed(4)) : 0,
      };
    }),
    lostValue: Number(totals?.lost_value ?? 0),
    wonValue: Number(totals?.won_value ?? 0),
  };
}

/** Quotes that are past `valid_until` and still open — the Follow-up Agent sweeps these. */
export function expiringQuotes(withinHours = 72): Quote[] {
  const now = nowIso();
  const until = new Date(Date.now() + withinHours * 3_600_000).toISOString();
  return getDb()
    .all<Row>(
      `SELECT * FROM quotes
        WHERE status IN ('sent', 'pending_approval')
          AND valid_until IS NOT NULL
          AND valid_until <= ?
        ORDER BY valid_until ASC`,
      until,
    )
    .map(mapQuote);
}
