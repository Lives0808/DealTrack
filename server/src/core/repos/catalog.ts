import { getDb, type Row } from '../db.js';
import { nowIso, parseJson, uid, toBool } from '../util.js';
import { loadTiers, type PriceTier } from '../pricing.js';

// ---------------------------------------------------------------------------
// Products (产品库)
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  sku: string;
  nameEn: string;
  nameZh: string | null;
  category: string | null;
  descriptionEn: string | null;
  descriptionZh: string | null;
  unit: string;
  moq: number;
  hsCode: string | null;
  hsDescription: string | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  cbm: number | null;
  certifications: string[];
  targetMarkets: string[];
  spec: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
  tiers?: PriceTier[];
}

export function mapProduct(row: Row, withTiers = false): Product {
  const product: Product = {
    id: String(row.id),
    sku: String(row.sku),
    nameEn: String(row.name_en),
    nameZh: (row.name_zh as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    descriptionEn: (row.description_en as string | null) ?? null,
    descriptionZh: (row.description_zh as string | null) ?? null,
    unit: String(row.unit ?? 'pcs'),
    moq: Number(row.moq ?? 1),
    hsCode: (row.hs_code as string | null) ?? null,
    hsDescription: (row.hs_description as string | null) ?? null,
    netWeightKg: row.net_weight_kg === null || row.net_weight_kg === undefined ? null : Number(row.net_weight_kg),
    grossWeightKg: row.gross_weight_kg === null || row.gross_weight_kg === undefined ? null : Number(row.gross_weight_kg),
    cbm: row.cbm === null || row.cbm === undefined ? null : Number(row.cbm),
    certifications: parseJson<string[]>(row.certifications, []),
    targetMarkets: parseJson<string[]>(row.target_markets, []),
    spec: parseJson<Record<string, unknown>>(row.spec, {}),
    status: String(row.status ?? 'active'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  if (withTiers) product.tiers = loadTiers(product.id);
  return product;
}

export function listProducts(options: { status?: string; category?: string; search?: string; limit?: number } = {}): Product[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status && options.status !== 'all') {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.category) {
    clauses.push('category = ?');
    params.push(options.category);
  }
  if (options.search) {
    clauses.push('(name_en LIKE ? OR name_zh LIKE ? OR sku LIKE ? OR description_en LIKE ?)');
    const like = `%${options.search}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .all<Row>(`SELECT * FROM products ${where} ORDER BY category, sku LIMIT ?`, ...params, options.limit ?? 500)
    .map((row) => mapProduct(row));
}

export function getProduct(id: string, withTiers = true): Product | null {
  const row = getDb().get<Row>('SELECT * FROM products WHERE id = ? OR sku = ?', id, id);
  return row ? mapProduct(row, withTiers) : null;
}

export function upsertProduct(input: Partial<Product> & { sku: string; nameEn: string }): Product {
  const db = getDb();
  const at = nowIso();
  const existing = input.id
    ? db.get<Row>('SELECT * FROM products WHERE id = ?', input.id)
    : db.get<Row>('SELECT * FROM products WHERE sku = ?', input.sku);

  if (existing) {
    const id = String(existing.id);
    db.update('products', id, {
      sku: input.sku,
      name_en: input.nameEn,
      name_zh: input.nameZh ?? (existing.name_zh as string | null) ?? null,
      category: input.category ?? (existing.category as string | null) ?? null,
      description_en: input.descriptionEn ?? (existing.description_en as string | null) ?? null,
      description_zh: input.descriptionZh ?? (existing.description_zh as string | null) ?? null,
      unit: input.unit ?? String(existing.unit ?? 'pcs'),
      moq: input.moq ?? Number(existing.moq ?? 1),
      hs_code: input.hsCode ?? (existing.hs_code as string | null) ?? null,
      hs_description: input.hsDescription ?? (existing.hs_description as string | null) ?? null,
      net_weight_kg: input.netWeightKg ?? (existing.net_weight_kg as number | null) ?? null,
      gross_weight_kg: input.grossWeightKg ?? (existing.gross_weight_kg as number | null) ?? null,
      cbm: input.cbm ?? (existing.cbm as number | null) ?? null,
      certifications: input.certifications ? JSON.stringify(input.certifications) : existing.certifications,
      target_markets: input.targetMarkets ? JSON.stringify(input.targetMarkets) : existing.target_markets,
      spec: input.spec ? JSON.stringify(input.spec) : existing.spec,
      status: input.status ?? String(existing.status ?? 'active'),
    });
    return getProduct(id)!;
  }

  const id = input.id ?? uid('prd');
  db.run(
    `INSERT INTO products (id, sku, name_en, name_zh, category, description_en, description_zh, unit, moq,
       hs_code, hs_description, net_weight_kg, gross_weight_kg, cbm, certifications, target_markets, spec,
       status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.sku,
    input.nameEn,
    input.nameZh ?? null,
    input.category ?? null,
    input.descriptionEn ?? null,
    input.descriptionZh ?? null,
    input.unit ?? 'pcs',
    input.moq ?? 1,
    input.hsCode ?? null,
    input.hsDescription ?? null,
    input.netWeightKg ?? null,
    input.grossWeightKg ?? null,
    input.cbm ?? null,
    JSON.stringify(input.certifications ?? []),
    JSON.stringify(input.targetMarkets ?? []),
    JSON.stringify(input.spec ?? {}),
    input.status ?? 'active',
    at,
    at,
  );
  return getProduct(id)!;
}

export function upsertTier(input: {
  id?: string;
  productId: string;
  minQty: number;
  unitCost: number;
  costCurrency?: string;
  marginPct?: number;
  listPrice?: number | null;
  currency?: string;
  incoterm?: string;
  packagingCost?: number;
  inlandCost?: number;
  leadTimeDays?: number;
}): string {
  const db = getDb();
  const at = nowIso();
  if (input.id) {
    db.update('price_tiers', input.id, {
      min_qty: input.minQty,
      unit_cost: input.unitCost,
      cost_currency: input.costCurrency ?? 'CNY',
      margin_pct: input.marginPct ?? 0.18,
      list_price: input.listPrice ?? null,
      currency: input.currency ?? 'USD',
      incoterm: input.incoterm ?? 'FOB',
      packaging_cost: input.packagingCost ?? 0,
      inland_cost: input.inlandCost ?? 0,
      lead_time_days: input.leadTimeDays ?? 15,
    });
    return input.id;
  }
  const id = uid('tier');
  db.run(
    `INSERT INTO price_tiers (id, product_id, min_qty, unit_cost, cost_currency, margin_pct, list_price,
       currency, incoterm, packaging_cost, inland_cost, lead_time_days, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.productId,
    input.minQty,
    input.unitCost,
    input.costCurrency ?? 'CNY',
    input.marginPct ?? 0.18,
    input.listPrice ?? null,
    input.currency ?? 'USD',
    input.incoterm ?? 'FOB',
    input.packagingCost ?? 0,
    input.inlandCost ?? 0,
    input.leadTimeDays ?? 15,
    at,
    at,
  );
  return id;
}

/**
 * Fuzzy product matching — used by the Sales Agent to turn free-text inquiry
 * lines into real SKUs. Scored on token overlap plus category and market hints.
 */
export function matchProducts(
  query: string,
  options: { limit?: number; minScore?: number; destination?: string | null } = {},
): Array<{ product: Product; score: number; matchedOn: string[] }> {
  const products = listProducts({ status: 'active', limit: 1000 });
  const lowered = query.toLowerCase();
  const tokens = lowered.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length > 1);

  const scored = products.map((product) => {
    const matchedOn: string[] = [];
    let score = 0;
    const haystacks: Array<[string, string, number]> = [
      ['sku', product.sku, 3],
      ['name_en', product.nameEn, 2.5],
      ['name_zh', product.nameZh ?? '', 2.5],
      ['category', product.category ?? '', 2],
      ['description_en', product.descriptionEn ?? '', 1],
      ['description_zh', product.descriptionZh ?? '', 1],
    ];

    for (const [field, value, weight] of haystacks) {
      if (!value) continue;
      const hay = value.toLowerCase();
      if (hay.length > 3 && lowered.includes(hay)) {
        score += weight * 2;
        matchedOn.push(field);
        continue;
      }
      const hayTokens = hay.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length > 2);
      const overlap = tokens.filter((token) => hayTokens.some((ht) => ht === token || ht.startsWith(token) || token.startsWith(ht)));
      if (overlap.length) {
        score += weight * overlap.length;
        matchedOn.push(`${field}:${overlap.join(',')}`);
      }
    }

    // Market affinity: a product that already ships to the destination is a better guess.
    if (options.destination && product.targetMarkets.includes(options.destination)) {
      score += 1.5;
      matchedOn.push('target_market');
    }

    return { product, score: Number(score.toFixed(2)), matchedOn };
  });

  const minScore = options.minScore ?? 2;
  return scored
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 5);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'ops' | 'sales';
  language: string;
  avatarColor: string | null;
  active: boolean;
  createdAt: string;
}

export function mapUser(row: Row): User {
  return {
    id: String(row.id),
    name: String(row.name),
    email: (row.email as string | null) ?? null,
    role: String(row.role ?? 'sales') as User['role'],
    language: String(row.language ?? 'zh'),
    avatarColor: (row.avatar_color as string | null) ?? null,
    active: toBool(row.active),
    createdAt: String(row.created_at),
  };
}

export function listUsers(): User[] {
  return getDb().all<Row>('SELECT * FROM users ORDER BY role, created_at').map(mapUser);
}

export function getUser(id: string): User | null {
  const row = getDb().get<Row>('SELECT * FROM users WHERE id = ?', id);
  return row ? mapUser(row) : null;
}

export function upsertUser(input: Partial<User> & { name: string }): User {
  const db = getDb();
  const existing = input.id
    ? db.get<Row>('SELECT * FROM users WHERE id = ?', input.id)
    : input.email
      ? db.get<Row>('SELECT * FROM users WHERE email = ?', input.email)
      : undefined;

  if (existing) {
    const id = String(existing.id);
    db.update('users', id, {
      name: input.name,
      email: input.email ?? (existing.email as string | null) ?? null,
      role: input.role ?? String(existing.role ?? 'sales'),
      language: input.language ?? String(existing.language ?? 'zh'),
      avatar_color: input.avatarColor ?? (existing.avatar_color as string | null) ?? null,
      active: input.active ?? toBool(existing.active),
    }, false);
    return getUser(id)!;
  }

  const id = input.id ?? uid('usr');
  db.run(
    `INSERT INTO users (id, name, email, role, language, avatar_color, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.email ?? null,
    input.role ?? 'sales',
    input.language ?? 'zh',
    input.avatarColor ?? null,
    input.active === false ? 0 : 1,
    nowIso(),
  );
  return getUser(id)!;
}

/** Owner by default, then ops — the person an escalation should land on. */
export function defaultAssignee(): User | null {
  const users = listUsers().filter((user) => user.active);
  return users.find((user) => user.role === 'owner') ?? users.find((user) => user.role === 'ops') ?? users[0] ?? null;
}
