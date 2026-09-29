import { getDb, type Row } from './db.js';
import { clamp, round, nowIso, uid } from './util.js';

/**
 * The pricing engine.
 *
 * Everything about how a number reaches a customer is explicit and auditable:
 *
 *   unit cost (CNY)  +  packaging  +  inland
 *        ↓  ÷ FX
 *   landed cost (quote currency)
 *        ↓  ÷ (1 − margin)
 *   ex-works / FOB unit price
 *        ↓  + freight + insurance allocation   (CIF / CFR)
 *        ↓  + duty & delivery estimate          (DDP / DAP)
 *   quoted unit price
 *
 * A quote stores the tier, the margin, the FX rate and every rule that fired, so
 * when a customer haggles six weeks later the boss can see exactly which lever
 * moved and by how much.
 */

export type Incoterm = 'EXW' | 'FCA' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DDP';

/** Incoterms that include main-carriage freight in the seller's price. */
const FREIGHT_INCLUDED: Incoterm[] = ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DDP'];
const INSURANCE_INCLUDED: Incoterm[] = ['CIF', 'CIP'];
const DUTY_INCLUDED: Incoterm[] = ['DDP'];

export interface FxTable {
  [pair: string]: number; // "CNY>USD": 0.1408  (1 CNY = 0.1408 USD)
}

export const DEFAULT_FX: FxTable = {
  'CNY>USD': 0.1408,
  'CNY>EUR': 0.1296,
  'CNY>GBP': 0.1104,
  'CNY>JPY': 21.5,
  'CNY>KRW': 191.2,
  'CNY>RUB': 12.8,
  'CNY>AED': 0.5172,
  'CNY>BRL': 0.7712,
  'CNY>INR': 11.86,
  'CNY>CAD': 0.1928,
  'CNY>AUD': 0.2142,
  'CNY>MXN': 2.585,
  'CNY>TRY': 4.82,
  'USD>CNY': 7.1023,
  'EUR>CNY': 7.716,
  'USD>EUR': 0.9205,
  'USD>GBP': 0.7841,
};

export function getFxRate(from: string, to: string): number {
  const base = from.toUpperCase();
  const quote = to.toUpperCase();
  if (base === quote) return 1;

  const direct = getDb().get<Row>('SELECT rate FROM fx_rates WHERE base = ? AND quote = ?', base, quote);
  if (direct) return Number(direct.rate);

  const inverse = getDb().get<Row>('SELECT rate FROM fx_rates WHERE base = ? AND quote = ?', quote, base);
  if (inverse && Number(inverse.rate) > 0) return 1 / Number(inverse.rate);

  const seeded = DEFAULT_FX[`${base}>${quote}`];
  if (seeded) return seeded;
  const seededInverse = DEFAULT_FX[`${quote}>${base}`];
  if (seededInverse) return 1 / seededInverse;

  // Triangular through CNY, then USD.
  const viaCny = DEFAULT_FX[`${quote}>CNY`] ? 1 / DEFAULT_FX[`${quote}>CNY`]! : 0;
  if (viaCny && DEFAULT_FX[`CNY>${base}`]) return 0; // unknown direction; caller sees 1:1
  return 1;
}

export function seedFxRates(): void {
  const db = getDb();
  const at = nowIso();
  for (const [pair, rate] of Object.entries(DEFAULT_FX)) {
    const [base, quote] = pair.split('>') as [string, string];
    db.run(
      `INSERT INTO fx_rates (base, quote, rate, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(base, quote) DO NOTHING`,
      base,
      quote,
      rate,
      at,
    );
  }
}

export interface PriceTier {
  id: string;
  productId: string;
  minQty: number;
  unitCost: number;
  costCurrency: string;
  marginPct: number;
  listPrice: number | null;
  currency: string;
  incoterm: string;
  packagingCost: number;
  inlandCost: number;
  leadTimeDays: number;
}

export interface ProductLite {
  id: string;
  sku: string;
  nameEn: string;
  nameZh: string | null;
  unit: string;
  moq: number;
  hsCode: string | null;
  certifications: string[];
  targetMarkets: string[];
  grossWeightKg: number | null;
  cbm: number | null;
}

export interface QuoteLineRequest {
  product: ProductLite;
  qty: number;
  unit?: string;
  /** Overrides the tier lookup — used when sales negotiates a specific price. */
  overrideUnitPrice?: number;
  note?: string;
}

export interface PricingRule {
  id: string;
  name: string;
  priority: number;
  scope: 'quote' | 'line' | 'customer';
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
}

export interface PricingContext {
  currency: string;
  incoterm: Incoterm | string;
  incotermPlace: string;
  /** Total ocean/air freight quoted by the forwarder, in `currency`. */
  freight: number;
  /** Cargo insurance premium, in `currency`. */
  insurance: number;
  /** Extra fees (documentation, inspection, certificate of origin…). */
  otherFees: number;
  /** Estimated duty rate for DDP quotes. */
  dutyRate?: number;
  discountPct?: number;
  customerTier?: string;
  customerCountry?: string;
  /** Hard floor: never price below cost × (1 + floorMarginPct), whatever the rules say. */
  floorMarginPct?: number;
}

export interface PricedLine {
  lineNo: number;
  productId: string;
  sku: string;
  description: string;
  qty: number;
  unit: string;
  currency: string;
  unitPrice: number;
  amount: number;
  /** Landed cost in the quote currency — the number the boss actually cares about. */
  unitCost: number;
  costCurrency: string;
  /** Realised margin on this line, after every rule fired. */
  marginPct: number;
  tierMinQty: number;
  listPriceUsed: boolean;
  costBreakdown: {
    exWorks: number;
    fxRate: number;
    packaging: number;
    inland: number;
    freightAllocated: number;
    insuranceAllocated: number;
    duty: number;
  };
  hsCode: string | null;
  leadTimeDays: number;
  note: string | null;
}

export interface AppliedRule {
  ruleId: string;
  name: string;
  scope: string;
  effect: string;
  deltaPct?: number;
  deltaAmount?: number;
}

export interface PricingResult {
  lines: PricedLine[];
  currency: string;
  incoterm: string;
  incotermPlace: string;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  freight: number;
  insurance: number;
  otherFees: number;
  total: number;
  /** Total landed cost in the quote currency. */
  costTotal: number;
  marginAmount: number;
  marginPct: number;
  leadTimeDays: number;
  moq: number;
  appliedRules: AppliedRule[];
  warnings: string[];
  floorApplied: boolean;
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

type RuleFields = Record<string, string | number | boolean | undefined>;

function compare(field: unknown, op: string, value: unknown): boolean {
  const left = field;
  switch (op) {
    case '>=':
      return Number(left) >= Number(value);
    case '>':
      return Number(left) > Number(value);
    case '<=':
      return Number(left) <= Number(value);
    case '<':
      return Number(left) < Number(value);
    case '==':
      return left === value || String(left) === String(value);
    case '!=':
      return String(left) !== String(value);
    case 'in':
      return Array.isArray(value) && value.some((entry) => String(entry) === String(left));
    case 'not_in':
      return Array.isArray(value) && !value.some((entry) => String(entry) === String(left));
    case 'contains':
      return String(left ?? '').toLowerCase().includes(String(value).toLowerCase());
    default:
      return false;
  }
}

export function evaluateRule(rule: PricingRule, fields: RuleFields): boolean {
  const condition = rule.condition as {
    all?: Array<{ field: string; op: string; value: unknown }>;
    any?: Array<{ field: string; op: string; value: unknown }>;
    field?: string;
    op?: string;
    value?: unknown;
  };

  if (Array.isArray(condition.all)) {
    return condition.all.every((clause) => compare(fields[clause.field], clause.op, clause.value));
  }
  if (Array.isArray(condition.any)) {
    return condition.any.some((clause) => compare(fields[clause.field], clause.op, clause.value));
  }
  if (condition.field && condition.op) {
    return compare(fields[condition.field], condition.op, condition.value);
  }
  return false;
}

export function loadRules(): PricingRule[] {
  return getDb()
    .all<Row>('SELECT * FROM price_rules WHERE active = 1 ORDER BY priority ASC, created_at ASC')
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      priority: Number(row.priority ?? 100),
      scope: String(row.scope ?? 'quote') as PricingRule['scope'],
      condition: safeParse(row.condition),
      action: safeParse(row.action),
    }));
}

function safeParse(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function pickTier(tiers: PriceTier[], qty: number): PriceTier | null {
  const eligible = tiers
    .filter((tier) => tier.minQty <= qty)
    .sort((a, b) => b.minQty - a.minQty);
  if (eligible.length > 0) return eligible[0]!;
  // Below MOQ: fall back to the smallest tier so we can still produce a number,
  // and let the caller warn.
  return [...tiers].sort((a, b) => a.minQty - b.minQty)[0] ?? null;
}

export function loadTiers(productId: string): PriceTier[] {
  return getDb()
    .all<Row>('SELECT * FROM price_tiers WHERE product_id = ? ORDER BY min_qty ASC', productId)
    .map((row) => ({
      id: String(row.id),
      productId: String(row.product_id),
      minQty: Number(row.min_qty ?? 1),
      unitCost: Number(row.unit_cost ?? 0),
      costCurrency: String(row.cost_currency ?? 'CNY'),
      marginPct: Number(row.margin_pct ?? 0.18),
      listPrice: row.list_price === null || row.list_price === undefined ? null : Number(row.list_price),
      currency: String(row.currency ?? 'USD'),
      incoterm: String(row.incoterm ?? 'FOB'),
      packagingCost: Number(row.packaging_cost ?? 0),
      inlandCost: Number(row.inland_cost ?? 0),
      leadTimeDays: Number(row.lead_time_days ?? 15),
    }));
}

export function priceQuote(
  requests: QuoteLineRequest[],
  context: PricingContext,
  overrides: { tiers?: Map<string, PriceTier[]>; rules?: PricingRule[] } = {},
): PricingResult {
  const tierMap = overrides.tiers ?? new Map<string, PriceTier[]>();
  const rules = overrides.rules ?? loadRules();
  const warnings: string[] = [];
  const appliedRules: AppliedRule[] = [];
  const incoterm = String(context.incoterm ?? 'FOB').toUpperCase();
  const currency = (context.currency ?? 'USD').toUpperCase();
  const freightTotal = Number(context.freight ?? 0);
  const insuranceTotal = Number(context.insurance ?? 0);
  const otherFees = Number(context.otherFees ?? 0);
  const dutyRate = Number(context.dutyRate ?? 0.06);
  const floorMargin = context.floorMarginPct ?? 0.05;

  // ---- Pass 1: build raw lines at FOB-equivalent value -------------------
  interface Raw {
    request: QuoteLineRequest;
    tier: PriceTier | null;
    qty: number;
    unit: string;
    fxRate: number;
    exWorksUnit: number;
    packaging: number;
    inland: number;
    duty: number;
    freight: number;
    insurance: number;
    unitPrice: number;
    unitCost: number;
    amount: number;
    marginPct: number;
    listPriceUsed: boolean;
    leadTimeDays: number;
  }

  const raws: Raw[] = [];
  let totalQty = 0;

  for (const request of requests) {
    const qty = Math.max(0, Number(request.qty ?? 0));
    totalQty += qty;

    const tiers = tierMap.get(request.product.id) ?? loadTiers(request.product.id);
    tierMap.set(request.product.id, tiers);
    const tier = pickTier(tiers, qty);

    if (!tier) {
      warnings.push(`${request.product.sku} 未配置价格阶梯，报价需人工补齐。`);
      raws.push({
        request,
        tier: null,
        qty,
        unit: request.unit ?? request.product.unit,
        fxRate: 1,
        exWorksUnit: 0,
        packaging: 0,
        inland: 0,
        duty: 0,
        freight: 0,
        insurance: 0,
        unitPrice: request.overrideUnitPrice ?? 0,
        unitCost: 0,
        amount: (request.overrideUnitPrice ?? 0) * qty,
        marginPct: 0,
        listPriceUsed: false,
        leadTimeDays: 15,
      });
      continue;
    }

    if (qty < request.product.moq) {
      warnings.push(`${request.product.sku} 数量 ${qty} 低于 MOQ ${request.product.moq}，已按 MOQ 阶梯价试算。`);
    }

    const costCurrency = tier.costCurrency.toUpperCase();
    const fxRate = getFxRate(costCurrency, currency);
    const tierCurrency = tier.currency.toUpperCase();

    // If the tier is already denominated in the quote currency, its list price
    // is authoritative — no FX round-trip, no drift.
    const listPriceUsable =
      tier.listPrice !== null &&
      tier.listPrice > 0 &&
      (tierCurrency === currency || tierCurrency === costCurrency);

    const packaging = tier.packagingCost / (costCurrency === currency ? 1 : fxRate || 1);
    const inland = tier.inlandCost / (costCurrency === currency ? 1 : fxRate || 1);
    const exWorksUnit = tier.unitCost * (costCurrency === currency ? 1 : fxRate);

    let unitPrice: number;
    if (request.overrideUnitPrice && request.overrideUnitPrice > 0) {
      unitPrice = request.overrideUnitPrice;
    } else if (listPriceUsable) {
      unitPrice = tier.listPrice!;
    } else {
      const landedCost = exWorksUnit + packaging + inland;
      unitPrice = landedCost / (1 - clamp(tier.marginPct, 0, 0.95));
    }

    raws.push({
      request,
      tier,
      qty,
      unit: request.unit ?? request.product.unit,
      fxRate,
      exWorksUnit,
      packaging,
      inland,
      duty: 0,
      freight: 0,
      insurance: 0,
      unitPrice,
      unitCost: exWorksUnit + packaging + inland,
      amount: unitPrice * qty,
      marginPct: tier.marginPct,
      listPriceUsed: listPriceUsable,
      leadTimeDays: tier.leadTimeDays,
    });
  }

  // ---- Pass 2: allocate freight / insurance / duty by value share ---------
  const fobValue = raws.reduce((sum, raw) => sum + raw.amount, 0);
  const includesFreight = FREIGHT_INCLUDED.includes(incoterm as Incoterm);
  const includesInsurance = INSURANCE_INCLUDED.includes(incoterm as Incoterm);
  const includesDuty = DUTY_INCLUDED.includes(incoterm as Incoterm);

  for (const raw of raws) {
    const share = fobValue > 0 ? raw.amount / fobValue : 0;
    if (includesFreight) raw.freight = freightTotal * share;
    if (includesInsurance) raw.insurance = insuranceTotal * share;
    if (includesDuty) raw.duty = (raw.amount + raw.freight) * dutyRate;
    if (includesFreight || includesInsurance || includesDuty) {
      const added = raw.freight + raw.insurance + raw.duty;
      raw.unitPrice = raw.qty > 0 ? (raw.amount + added) / raw.qty : raw.unitPrice;
      raw.amount += added;
    }
  }

  // ---- Pass 3: quantity-tier rules (they change unit economics) ----------
  for (const rule of rules.filter((r) => r.scope === 'line')) {
    for (const raw of raws) {
      const fields: RuleFields = {
        qty: raw.qty,
        sku: raw.request.product.sku,
        productId: raw.request.product.id,
        category: undefined,
        marginPct: raw.marginPct,
        incoterm,
        currency,
        destination: context.customerCountry,
        customerTier: context.customerTier,
        lineAmount: raw.amount,
      };
      if (!evaluateRule(rule, fields)) continue;
      const effect = applyAction(rule, raw);
      if (effect) appliedRules.push(effect);
    }
  }

  // ---- Pass 4: quote-level rules -----------------------------------------
  let discountPct = Number(context.discountPct ?? 0);
  let freightOverride: number | null = null;
  let extraSurchargePct = 0;

  const quoteSubtotal = raws.reduce((sum, raw) => sum + raw.amount, 0);
  for (const rule of rules.filter((r) => r.scope === 'quote' || r.scope === 'customer')) {
    const fields: RuleFields = {
      total: quoteSubtotal,
      subtotal: quoteSubtotal,
      totalQty,
      incoterm,
      currency,
      destination: context.customerCountry,
      customerTier: context.customerTier,
      lineCount: raws.length,
      maxQty: Math.max(0, ...raws.map((r) => r.qty)),
    };
    if (!evaluateRule(rule, fields)) continue;
    const action = rule.action as { type?: string; value?: number };
    switch (action.type) {
      case 'discount_pct':
        discountPct += Number(action.value ?? 0);
        appliedRules.push({ ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'discount_pct', deltaPct: Number(action.value ?? 0) });
        break;
      case 'surcharge_pct':
        extraSurchargePct += Number(action.value ?? 0);
        appliedRules.push({ ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'surcharge_pct', deltaPct: Number(action.value ?? 0) });
        break;
      case 'free_freight':
        freightOverride = 0;
        appliedRules.push({ ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'free_freight', deltaAmount: -freightTotal });
        break;
      case 'freight_override':
        freightOverride = Number(action.value ?? 0);
        appliedRules.push({ ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'freight_override', deltaAmount: Number(action.value ?? 0) });
        break;
      case 'margin_delta': {
        const delta = Number(action.value ?? 0);
        for (const raw of raws) {
          const nextMargin = clamp(raw.marginPct + delta, 0, 0.95);
          if (nextMargin === raw.marginPct) continue;
          const ratio = (1 - raw.marginPct) / (1 - nextMargin);
          raw.unitPrice = raw.unitPrice * ratio;
          raw.amount = raw.unitPrice * raw.qty;
          raw.marginPct = nextMargin;
        }
        appliedRules.push({ ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'margin_delta', deltaPct: delta });
        break;
      }
      default:
        break;
    }
  }

  // ---- Pass 5: totals + floor guard --------------------------------------
  let lines: PricedLine[] = raws.map((raw, index) => ({
    lineNo: index + 1,
    productId: raw.request.product.id,
    sku: raw.request.product.sku,
    description: raw.request.product.nameEn,
    qty: raw.qty,
    unit: raw.unit,
    currency,
    unitPrice: round(raw.unitPrice, 4),
    amount: round(raw.unitPrice * raw.qty, 2),
    unitCost: round(raw.unitCost, 4),
    costCurrency: currency,
    marginPct: round(raw.marginPct, 4),
    tierMinQty: raw.tier?.minQty ?? 0,
    listPriceUsed: raw.listPriceUsed,
    costBreakdown: {
      exWorks: round(raw.exWorksUnit, 4),
      fxRate: round(raw.fxRate, 6),
      packaging: round(raw.packaging, 4),
      inland: round(raw.inland, 4),
      freightAllocated: round(raw.freight, 2),
      insuranceAllocated: round(raw.insurance, 2),
      duty: round(raw.duty, 2),
    },
    hsCode: raw.request.product.hsCode,
    leadTimeDays: raw.leadTimeDays,
    note: raw.request.note ?? null,
  }));

  let subtotal = round(lines.reduce((sum, line) => sum + line.amount, 0), 2);
  const effectiveFreight = freightOverride ?? (includesFreight ? round(freightTotal, 2) : 0);
  const effectiveInsurance = includesInsurance ? round(insuranceTotal, 2) : 0;

  subtotal = round(subtotal * (1 + extraSurchargePct), 2);
  const discountAmount = round(subtotal * clamp(discountPct, 0, 0.9), 2);
  let total = round(subtotal - discountAmount + effectiveFreight + effectiveInsurance + otherFees, 2);

  let costTotal = round(lines.reduce((sum, line) => sum + line.unitCost * line.qty, 0), 2);
  let floorApplied = false;

  const minimumTotal = round(costTotal / (1 - floorMargin) + effectiveFreight + effectiveInsurance + otherFees, 2);
  if (total < minimumTotal) {
    const ratio = minimumTotal / (total || 1);
    lines = lines.map((line) => ({
      ...line,
      unitPrice: round(line.unitPrice * ratio, 4),
      amount: round(line.unitPrice * ratio * line.qty, 2),
      marginPct: round(1 - line.unitCost / (line.unitPrice * ratio || 1), 4),
    }));
    subtotal = round(subtotal * ratio, 2);
    total = minimumTotal;
    floorApplied = true;
    warnings.push(
      `已触发底价保护：按最低毛利 ${(floorMargin * 100).toFixed(0)}% 托底，折扣或规则被压缩。`,
    );
  }

  const marginAmount = round(total - costTotal, 2);
  const marginPct = total > 0 ? round(marginAmount / total, 4) : 0;
  const leadTimeDays = Math.max(0, ...lines.map((line) => line.leadTimeDays));
  const moq = Math.max(0, ...requests.map((request) => request.product.moq));

  return {
    lines,
    currency,
    incoterm,
    incotermPlace: context.incotermPlace,
    subtotal,
    discountPct: round(discountPct, 4),
    discountAmount,
    freight: effectiveFreight,
    insurance: effectiveInsurance,
    otherFees,
    total,
    costTotal,
    marginAmount,
    marginPct,
    leadTimeDays,
    moq,
    appliedRules,
    warnings,
    floorApplied,
  };
}

function applyAction(rule: PricingRule, raw: { unitPrice: number; amount: number; qty: number; marginPct: number }): AppliedRule | null {
  const action = rule.action as { type?: string; value?: number };
  const value = Number(action.value ?? 0);
  switch (action.type) {
    case 'unit_price_override':
      raw.unitPrice = value;
      raw.amount = value * raw.qty;
      raw.marginPct = raw.amount > 0 ? 1 - (raw.marginPct >= 0 ? 0 : 0) : 0;
      return { ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'unit_price_override', deltaAmount: value };
    case 'margin_delta': {
      const nextMargin = clamp(raw.marginPct + value, 0, 0.95);
      const ratio = (1 - raw.marginPct) / (1 - nextMargin);
      raw.unitPrice *= ratio;
      raw.amount = raw.unitPrice * raw.qty;
      raw.marginPct = nextMargin;
      return { ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'margin_delta', deltaPct: value };
    }
    case 'line_discount_pct': {
      raw.amount = raw.amount * (1 - clamp(value, 0, 0.9));
      raw.unitPrice = raw.qty > 0 ? raw.amount / raw.qty : raw.unitPrice;
      return { ruleId: rule.id, name: rule.name, scope: rule.scope, effect: 'line_discount_pct', deltaPct: -Math.abs(value) };
    }
    default:
      return null;
  }
}

/** Freight estimator used when a forwarder quote is not on hand yet. */
export function estimateFreight(input: {
  cbm: number;
  weightKg: number;
  qty: number;
  mode?: 'sea_lcl' | 'sea_fcl' | 'air' | 'express';
  destination?: string;
  incoterm?: string;
}): { amount: number; currency: string; mode: string; note: string } {
  const mode = input.mode ?? (input.cbm >= 15 ? 'sea_fcl' : input.cbm >= 1 ? 'sea_lcl' : 'express');
  const remoteFactor = /africa|south america|brazil|nigeria|chile/i.test(input.destination ?? '') ? 1.35 : 1;

  let amount: number;
  let note: string;
  switch (mode) {
    case 'sea_fcl':
      amount = 2400 * remoteFactor;
      note = '20GP 整柜海运费估算（含码头操作费），按整柜计。';
      break;
    case 'sea_lcl':
      amount = 118 * input.cbm * remoteFactor;
      note = '拼箱海运费估算，约 USD 118/CBM，含拼箱操作费。';
      break;
    case 'air':
      amount = 6.2 * Math.max(input.weightKg, input.cbm * 167) * remoteFactor;
      note = '空运估算，按计费重量 USD 6.2/kg。';
      break;
    default:
      amount = 4.5 * Math.max(1, input.weightKg) * remoteFactor;
      note = '快递估算，适合小件样品。';
  }

  return {
    amount: round(amount, 2),
    currency: 'USD',
    mode,
    note: `${note}${remoteFactor > 1 ? '（偏远航线已加权）' : ''}`,
  };
}

export function upsertFxRate(base: string, quote: string, rate: number): void {
  getDb().run(
    `INSERT INTO fx_rates (base, quote, rate, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(base, quote) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
    base.toUpperCase(),
    quote.toUpperCase(),
    rate,
    nowIso(),
  );
}

export function createRule(input: {
  name: string;
  priority?: number;
  scope?: PricingRule['scope'];
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
}): string {
  const id = uid('rule');
  const at = nowIso();
  getDb().run(
    `INSERT INTO price_rules (id, name, priority, scope, condition, action, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id,
    input.name,
    input.priority ?? 100,
    input.scope ?? 'quote',
    JSON.stringify(input.condition),
    JSON.stringify(input.action),
    at,
    at,
  );
  return id;
}
