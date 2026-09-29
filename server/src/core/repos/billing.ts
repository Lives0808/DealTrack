import { getDb, type Row } from '../db.js';
import { addDays, nowIso, uid } from '../util.js';
import { getCustomer, getInquiry, updateInquiry, upsertCustomer } from './sales.js';
import { getQuote, updateQuote, type Quote } from './quoting.js';

// ---------------------------------------------------------------------------
// Proforma invoices (形式发票)
//
// A PI is not a separate document that happens to share numbers with the quote —
// it *is* the quote, formalised. So it references the quote and reuses
// `quote_items` rather than copying lines into its own table. Copying is how you
// end up with a PI that says 500 pcs and a quote that says 5000.
// ---------------------------------------------------------------------------

export interface ProformaInvoice {
  id: string;
  piNo: string;
  quoteId: string;
  inquiryId: string | null;
  customerId: string;
  currency: string;
  incoterm: string;
  incotermPlace: string;
  subtotal: number;
  freight: number;
  insurance: number;
  total: number;
  depositPct: number;
  depositAmount: number;
  balanceAmount: number;
  paymentTerms: string | null;
  bankInfo: string | null;
  shipmentDate: string | null;
  validUntil: string | null;
  language: string;
  status: string;
  notes: string | null;
  pdfPath: string | null;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
  quote?: Quote | null;
  milestones?: PaymentMilestone[];
}

export function mapPi(row: Row): ProformaInvoice {
  return {
    id: String(row.id),
    piNo: String(row.pi_no),
    quoteId: String(row.quote_id),
    inquiryId: (row.inquiry_id as string | null) ?? null,
    customerId: String(row.customer_id),
    currency: String(row.currency ?? 'USD'),
    incoterm: String(row.incoterm ?? 'FOB'),
    incotermPlace: String(row.incoterm_place ?? 'Shenzhen'),
    subtotal: Number(row.subtotal ?? 0),
    freight: Number(row.freight ?? 0),
    insurance: Number(row.insurance ?? 0),
    total: Number(row.total ?? 0),
    depositPct: Number(row.deposit_pct ?? 0.3),
    depositAmount: Number(row.deposit_amount ?? 0),
    balanceAmount: Number(row.balance_amount ?? 0),
    paymentTerms: (row.payment_terms as string | null) ?? null,
    bankInfo: (row.bank_info as string | null) ?? null,
    shipmentDate: (row.shipment_date as string | null) ?? null,
    validUntil: (row.valid_until as string | null) ?? null,
    language: String(row.language ?? 'en'),
    status: String(row.status ?? 'issued'),
    notes: (row.notes as string | null) ?? null,
    pdfPath: (row.pdf_path as string | null) ?? null,
    issuedAt: String(row.issued_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function nextPiNo(at: Date = new Date()): string {
  const db = getDb();
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `PI-${y}${m}`;
  const count = db.count('SELECT COUNT(*) FROM proforma_invoices WHERE pi_no LIKE ?', `${prefix}%`);
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

/** Parse "30% T/T deposit, 70% before shipment" into a deposit ratio. */
export function depositRatioFromTerms(terms: string | null | undefined): number {
  if (!terms) return 0.3;
  const match = /(\d{1,3})\s*%/.exec(terms);
  if (!match) return /100%\s*(t\/t|advance)/i.test(terms) ? 1 : 0.3;
  const pct = Number(match[1]);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 0.3;
  return pct / 100;
}

export function createProformaInvoice(input: {
  quoteId: string;
  bankInfo?: string | null;
  depositPct?: number;
  paymentTerms?: string | null;
  shipmentDate?: string | null;
  notes?: string | null;
  validUntilDays?: number;
}): ProformaInvoice | null {
  const quote = getQuote(input.quoteId);
  if (!quote) return null;

  const db = getDb();
  const id = uid('pi');
  const at = nowIso();
  const depositPct = input.depositPct ?? depositRatioFromTerms(quote.paymentTerms);
  const depositAmount = Number((quote.total * depositPct).toFixed(2));
  const balanceAmount = Number((quote.total - depositAmount).toFixed(2));
  const validUntil = addDays(input.validUntilDays ?? 30);

  db.transaction(() => {
    db.run(
      `INSERT INTO proforma_invoices (id, pi_no, quote_id, inquiry_id, customer_id, currency, incoterm,
         incoterm_place, subtotal, freight, insurance, total, deposit_pct, deposit_amount, balance_amount,
         payment_terms, bank_info, shipment_date, valid_until, language, status, notes, issued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?)`,
      id,
      nextPiNo(),
      quote.id,
      quote.inquiryId,
      quote.customerId,
      quote.currency,
      quote.incoterm,
      quote.incotermPlace,
      quote.subtotal,
      quote.freight,
      quote.insurance,
      quote.total,
      depositPct,
      depositAmount,
      balanceAmount,
      input.paymentTerms ?? quote.paymentTerms,
      input.bankInfo ?? null,
      input.shipmentDate ?? addDays(quote.leadTimeDays ?? 15),
      validUntil,
      quote.language,
      input.notes ?? null,
      at,
      at,
      at,
    );

    // The deposit is due now; the balance falls due before shipment.
    createMilestone({
      piId: id,
      quoteId: quote.id,
      customerId: quote.customerId,
      label: 'deposit',
      sequenceNo: 1,
      amount: depositAmount,
      currency: quote.currency,
      dueAt: addDays(3),
    });
    if (balanceAmount > 0) {
      createMilestone({
        piId: id,
        quoteId: quote.id,
        customerId: quote.customerId,
        label: 'balance',
        sequenceNo: 2,
        amount: balanceAmount,
        currency: quote.currency,
        dueAt: addDays(quote.leadTimeDays ?? 15),
      });
    }
  });

  return getPiByQuote(quote.id);
}

export function mapMilestone(row: Row): PaymentMilestone {
  return {
    id: String(row.id),
    piId: (row.pi_id as string | null) ?? null,
    quoteId: (row.quote_id as string | null) ?? null,
    customerId: String(row.customer_id),
    label: String(row.label),
    sequenceNo: Number(row.sequence_no ?? 1),
    amount: Number(row.amount ?? 0),
    currency: String(row.currency ?? 'USD'),
    dueAt: (row.due_at as string | null) ?? null,
    status: String(row.status ?? 'pending'),
    paidAmount: Number(row.paid_amount ?? 0),
    paidAt: (row.paid_at as string | null) ?? null,
    method: (row.method as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    remindedAt: (row.reminded_at as string | null) ?? null,
    remindCount: Number(row.remind_count ?? 0),
  };
}

export interface PaymentMilestone {
  id: string;
  piId: string | null;
  quoteId: string | null;
  customerId: string;
  label: string;
  sequenceNo: number;
  amount: number;
  currency: string;
  dueAt: string | null;
  status: string;
  paidAmount: number;
  paidAt: string | null;
  method: string | null;
  note: string | null;
  remindedAt: string | null;
  remindCount: number;
}

export function createMilestone(input: {
  piId?: string | null;
  quoteId?: string | null;
  customerId: string;
  label: string;
  sequenceNo?: number;
  amount: number;
  currency: string;
  dueAt: string | null;
  note?: string | null;
}): PaymentMilestone {
  const db = getDb();
  const id = uid('pay');
  const at = nowIso();
  db.run(
    `INSERT INTO payment_milestones (id, pi_id, quote_id, customer_id, label, sequence_no, amount, currency,
       due_at, status, paid_amount, note, remind_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, 0, ?, ?)`,
    id,
    input.piId ?? null,
    input.quoteId ?? null,
    input.customerId,
    input.label,
    input.sequenceNo ?? 1,
    input.amount,
    input.currency,
    input.dueAt,
    input.note ?? null,
    at,
    at,
  );
  return mapMilestone(db.get<Row>('SELECT * FROM payment_milestones WHERE id = ?', id)!);
}

export function getPiByQuote(quoteId: string): ProformaInvoice | null {
  const row = getDb().get<Row>(
    'SELECT * FROM proforma_invoices WHERE quote_id = ? ORDER BY issued_at DESC LIMIT 1',
    quoteId,
  );
  if (!row) return null;
  const pi = mapPi(row);
  pi.milestones = listMilestones({ piId: pi.id });
  pi.quote = getQuote(pi.quoteId);
  return pi;
}

export function getPi(id: string): ProformaInvoice | null {
  const row = getDb().get<Row>('SELECT * FROM proforma_invoices WHERE id = ? OR pi_no = ?', id, id);
  if (!row) return null;
  const pi = mapPi(row);
  pi.milestones = listMilestones({ piId: pi.id });
  pi.quote = getQuote(pi.quoteId);
  return pi;
}

export function listPis(options: { status?: string; customerId?: string; limit?: number } = {}): ProformaInvoice[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.customerId) {
    clauses.push('customer_id = ?');
    params.push(options.customerId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(
      `SELECT * FROM proforma_invoices ${where} ORDER BY issued_at DESC LIMIT ?`,
      ...params,
      options.limit ?? 100,
    )
    .map((row) => {
      const pi = mapPi(row);
      pi.milestones = listMilestones({ piId: pi.id });
      return pi;
    });
}

export function updatePi(id: string, patch: Record<string, unknown>): boolean {
  const allowed = new Set([
    'status',
    'pdf_path',
    'notes',
    'bank_info',
    'payment_terms',
    'shipment_date',
    'valid_until',
    'deposit_pct',
    'deposit_amount',
    'balance_amount',
  ]);
  const dbPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key)) dbPatch[key] = value;
  }
  if (Object.keys(dbPatch).length === 0) return false;
  return getDb().update('proforma_invoices', id, dbPatch);
}

// ---------------------------------------------------------------------------
// Payment milestones (回款)
// ---------------------------------------------------------------------------

export function listMilestones(
  options: { status?: string; piId?: string; quoteId?: string; customerId?: string; dueBefore?: string; limit?: number } = {},
): PaymentMilestone[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    if (options.status.includes(',')) {
      const statuses = options.status.split(',').map((entry) => entry.trim());
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    } else {
      clauses.push('status = ?');
      params.push(options.status);
    }
  }
  if (options.piId) {
    clauses.push('pi_id = ?');
    params.push(options.piId);
  }
  if (options.quoteId) {
    clauses.push('quote_id = ?');
    params.push(options.quoteId);
  }
  if (options.customerId) {
    clauses.push('customer_id = ?');
    params.push(options.customerId);
  }
  if (options.dueBefore) {
    clauses.push('due_at IS NOT NULL AND due_at <= ?');
    params.push(options.dueBefore);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(
      `SELECT * FROM payment_milestones ${where} ORDER BY COALESCE(due_at, created_at) ASC LIMIT ?`,
      ...params,
      options.limit ?? 200,
    )
    .map(mapMilestone);
}

/** Milestones that are due and not settled. Drives the payment sweep. */
export function dueMilestones(at: string = nowIso()): PaymentMilestone[] {
  return getDb()
    .all<Row>(
      `SELECT * FROM payment_milestones
        WHERE status IN ('pending', 'invoiced', 'overdue')
          AND due_at IS NOT NULL AND due_at <= ?
        ORDER BY due_at ASC`,
      at,
    )
    .map(mapMilestone);
}

export function markMilestonePaid(input: {
  id: string;
  amount?: number;
  method?: string | null;
  note?: string | null;
  paidAt?: string;
}): PaymentMilestone | null {
  const db = getDb();
  const row = db.get<Row>('SELECT * FROM payment_milestones WHERE id = ?', input.id);
  if (!row) return null;
  const milestone = mapMilestone(row);
  const paidAmount = input.amount ?? milestone.amount;
  const at = input.paidAt ?? nowIso();
  const settled = paidAmount >= milestone.amount - 0.01;

  db.update('payment_milestones', input.id, {
    status: settled ? 'paid' : 'invoiced',
    paid_amount: paidAmount,
    paid_at: settled ? at : milestone.paidAt,
    method: input.method ?? milestone.method,
    note: input.note ?? milestone.note,
  });

  // Roll the PI status forward once its deposit or full balance lands.
  if (settled && milestone.piId) {
    const siblings = listMilestones({ piId: milestone.piId });
    const allPaid = siblings.every((entry) => entry.id === input.id || entry.status === 'paid');
    const depositPaid = siblings.find((entry) => entry.label === 'deposit');
    const pi = getPi(milestone.piId);
    if (pi) {
      if (allPaid) updatePi(pi.id, { status: 'paid' });
      else if (depositPaid && (depositPaid.id === input.id || depositPaid.status === 'paid')) {
        updatePi(pi.id, { status: 'deposit_paid' });
      }
    }
  }

  return mapMilestone(db.get<Row>('SELECT * FROM payment_milestones WHERE id = ?', input.id)!);
}

export function markMilestoneReminded(id: string): void {
  const db = getDb();
  const row = db.get<Row>('SELECT remind_count FROM payment_milestones WHERE id = ?', id);
  if (!row) return;
  db.run(
    'UPDATE payment_milestones SET reminded_at = ?, remind_count = ?, updated_at = ? WHERE id = ?',
    nowIso(),
    Number(row.remind_count ?? 0) + 1,
    nowIso(),
    id,
  );
}

export function updateMilestone(id: string, patch: Record<string, unknown>): boolean {
  const allowed = new Set(['due_at', 'amount', 'status', 'note', 'label', 'method']);
  const dbPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key)) dbPatch[key] = value;
  }
  if (Object.keys(dbPatch).length === 0) return false;
  return getDb().update('payment_milestones', id, dbPatch);
}

/** Cash-flow summary for the dashboard: what is owed, what is late. */
export function paymentSummary(sinceIso: string): {
  outstanding: number;
  overdue: number;
  collected: number;
  overdueCount: number;
  pendingCount: number;
  byStatus: Record<string, number>;
  topOverdue: Array<{ customer: string; amount: number; currency: string; label: string; dueAt: string | null; daysLate: number }>;
} {
  const db = getDb();
  const totals = db.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('pending','invoiced','overdue') THEN amount ELSE 0 END), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END), 0) AS overdue,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN paid_amount ELSE 0 END), 0) AS collected,
       SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_count,
       SUM(CASE WHEN status IN ('pending','invoiced') THEN 1 ELSE 0 END) AS pending_count
     FROM payment_milestones WHERE created_at >= ?`,
    sinceIso,
  );

  const rows = db.all<Row>('SELECT status, COUNT(*) AS n FROM payment_milestones WHERE created_at >= ? GROUP BY status', sinceIso);
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[String(row.status)] = Number(row.n);

  const overdueRows = db.all<Row>(
    `SELECT m.amount, m.currency, m.label, m.due_at, c.company
       FROM payment_milestones m LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.status IN ('pending','invoiced','overdue') AND m.due_at IS NOT NULL AND m.due_at <= ?
      ORDER BY m.due_at ASC LIMIT 10`,
    nowIso(),
  );

  return {
    outstanding: Number(totals?.outstanding ?? 0),
    overdue: Number(totals?.overdue ?? 0),
    collected: Number(totals?.collected ?? 0),
    overdueCount: Number(totals?.overdue_count ?? 0),
    pendingCount: Number(totals?.pending_count ?? 0),
    byStatus,
    topOverdue: overdueRows.map((row) => ({
      customer: String(row.company ?? '—'),
      amount: Number(row.amount ?? 0),
      currency: String(row.currency ?? 'USD'),
      label: String(row.label ?? ''),
      dueAt: (row.due_at as string | null) ?? null,
      daysLate: row.due_at ? Math.max(0, Math.floor((Date.now() - new Date(String(row.due_at)).getTime()) / 86_400_000)) : 0,
    })),
  };
}

/** Flag anything past due as `overdue` and cancel the quote's follow-ups. */
export function refreshOverdueMilestones(): number {
  const db = getDb();
  const stale = db.all<Row>(
    `SELECT id, quote_id FROM payment_milestones
      WHERE status IN ('pending', 'invoiced') AND due_at IS NOT NULL AND due_at <= ?`,
    nowIso(),
  );
  for (const row of stale) {
    db.run("UPDATE payment_milestones SET status = 'overdue', updated_at = ? WHERE id = ?", nowIso(), row.id);
  }
  return stale.length;
}

// ---------------------------------------------------------------------------
// Quote revision (报价改版)
// ---------------------------------------------------------------------------

/**
 * Create v(n+1) of a quote.
 *
 * Repricing used to just make a brand-new quote with no link to the one the
 * customer already saw — so the negotiation history vanished exactly when you
 * needed it (a month later, when they ask "why is this higher than before?").
 */
export function reviseQuote(input: {
  quoteId: string;
  reason: string;
  createdBy?: string;
  discountPct?: number;
  freight?: number;
  incoterm?: string;
  incotermPlace?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
  marginDeltaPct?: number;
}): Quote | null {
  const original = getQuote(input.quoteId);
  if (!original) return null;

  const db = getDb();
  const quoteNoBase = original.quoteNo.replace(/-R\d+$/, '');
  const existingRevisions = db.count(
    "SELECT COUNT(*) FROM quotes WHERE parent_quote_id = ? OR quote_no LIKE ?",
    original.id,
    `${quoteNoBase}-R%`,
  );
  const version = existingRevisions + 2;

  const marginDelta = input.marginDeltaPct ?? 0;
  const items = (original.items ?? []).map((item) => {
    const ratio = marginDelta === 0 ? 1 : (1 - (original.marginPct ?? 0)) / (1 - ((original.marginPct ?? 0) + marginDelta));
    return { ...item, unitPrice: Number((item.unitPrice * ratio).toFixed(4)) };
  });
  const subtotalRaw = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const discountPct = input.discountPct ?? original.discountPct;
  const discountAmount = Number((subtotalRaw * discountPct).toFixed(2));
  const freight = input.freight ?? original.freight;
  const total = Number((subtotalRaw - discountAmount + freight + original.insurance + original.otherFees).toFixed(2));

  const id = uid('qte');
  const at = nowIso();
  const quoteNo = `${quoteNoBase}-R${version - 1}`;

  db.transaction(() => {
    db.run(
      `INSERT INTO quotes (id, quote_no, inquiry_id, customer_id, version, parent_quote_id, currency, incoterm,
         incoterm_place, valid_until, payment_terms, lead_time_days, moq, subtotal, discount_pct, discount_amount,
         freight, insurance, other_fees, total, cost_total, margin_pct, margin_amount, status, language,
         price_breakdown, applied_rules, created_by, notes, internal_notes, revision_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      quoteNo,
      original.inquiryId,
      original.customerId,
      version,
      original.id,
      original.currency,
      input.incoterm ?? original.incoterm,
      input.incotermPlace ?? original.incotermPlace,
      original.validUntil,
      input.paymentTerms ?? original.paymentTerms,
      input.leadTimeDays ?? original.leadTimeDays,
      original.moq,
      subtotalRaw,
      discountPct,
      discountAmount,
      freight,
      original.insurance,
      original.otherFees,
      total,
      original.costTotal,
      original.costTotal > 0 ? Number(((total - original.costTotal) / (total || 1)).toFixed(4)) : null,
      Number((total - original.costTotal).toFixed(2)),
      original.language,
      JSON.stringify(original.priceBreakdown ?? []),
      JSON.stringify(original.appliedRules ?? []),
      input.createdBy ?? 'user:api',
      original.notes,
      `改版原因：${input.reason}`,
      input.reason,
      at,
      at,
    );

    items.forEach((item, index) => {
      db.run(
        `INSERT INTO quote_items (id, quote_id, line_no, product_id, sku, description, description_i18n, qty, unit,
           unit_price, amount, unit_cost, cost_currency, currency, hs_code, lead_time_days, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid('qitem'),
        id,
        index + 1,
        item.productId,
        item.sku,
        item.description,
        JSON.stringify({}),
        item.qty,
        item.unit,
        item.unitPrice,
        Number((item.unitPrice * item.qty).toFixed(2)),
        item.unitCost,
        item.costCurrency,
        item.currency,
        item.hsCode,
        item.leadTimeDays,
        item.notes,
      );
    });

    db.run('UPDATE quotes SET superseded_by = ?, updated_at = ? WHERE id = ?', id, at, original.id);
  });

  updateQuote(original.id, { status: 'superseded' });
  return getQuote(id);
}

/** Full revision chain, oldest first, for the history panel. */
export function quoteRevisionChain(quoteId: string): Quote[] {
  const db = getDb();
  const quote = getQuote(quoteId, false);
  if (!quote) return [];

  // Walk back to the root, then forward through the revision chain.
  //
  // Two separate guards on purpose: sharing one meant the node we started from
  // was already marked visited by the backward walk, so the forward walk bailed
  // out immediately and the history came back as a single version.
  let root = quote;
  const seenBack = new Set<string>([root.id]);
  while (root.parentQuoteId && !seenBack.has(root.parentQuoteId)) {
    const parent = getQuote(root.parentQuoteId, false);
    if (!parent) break;
    seenBack.add(parent.id);
    root = parent;
  }

  const chain: Quote[] = [root];
  const seenForward = new Set<string>([root.id]);
  let cursor = root;
  while (cursor.supersededBy && !seenForward.has(cursor.supersededBy)) {
    const next = getQuote(cursor.supersededBy, false);
    if (!next) break;
    seenForward.add(next.id);
    chain.push(next);
    cursor = next;
  }
  return chain;
}

export { getCustomer, getInquiry, updateInquiry, upsertCustomer };
