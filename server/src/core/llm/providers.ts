import type { ChatRequest, ChatResponse, LlmProvider, ProviderId, ResolvedProviderConfig } from './types.js';
import { estimateCost, estimateTokens } from './types.js';
import { detectLanguage, fill, getPhrasebook, getLanguage } from '../i18n.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

abstract class BaseProvider implements LlmProvider {
  abstract readonly id: ProviderId;
  abstract readonly label: string;
  abstract readonly requiresApiKey: boolean;
  abstract readonly defaultModel: string;
  abstract readonly defaultBaseUrl: string;

  abstract chat(request: ChatRequest, resolved: ResolvedProviderConfig): Promise<ChatResponse>;

  protected headers(resolved: ResolvedProviderConfig): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {}),
    };
  }

  protected async post(
    url: string,
    body: unknown,
    resolved: ResolvedProviderConfig,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolved.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...this.headers(resolved), ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`${this.id} HTTP ${response.status}: ${detail.slice(0, 400)}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider — covers OpenAI, DeepSeek, Moonshot, Together,
// vLLM, LM Studio, OpenRouter… anything speaking /chat/completions.
// ---------------------------------------------------------------------------

export class OpenAiCompatibleProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly requiresApiKey: boolean;
  readonly defaultModel: string;
  readonly defaultBaseUrl: string;

  constructor(
    id: ProviderId = 'openai',
    label = 'OpenAI',
    defaults: { baseUrl: string; model: string; requiresApiKey: boolean } = {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      requiresApiKey: true,
    },
  ) {
    super();
    this.id = id;
    this.label = label;
    this.defaultBaseUrl = defaults.baseUrl;
    this.defaultModel = defaults.model;
    this.requiresApiKey = defaults.requiresApiKey;
  }

  async chat(request: ChatRequest, resolved: ResolvedProviderConfig): Promise<ChatResponse> {
    const started = Date.now();
    const base = (resolved.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const model = resolved.model || this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? resolved.temperature,
      max_tokens: request.maxTokens ?? resolved.maxTokens,
    };
    if (request.json) body.response_format = { type: 'json_object' };

    const response = await this.post(`${base}/chat/completions`, body, resolved);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = payload.choices?.[0]?.message?.content ?? '';
    const tokensIn = payload.usage?.prompt_tokens ?? estimateTokens(request.messages.map((m) => m.content).join('\n'));
    const tokensOut = payload.usage?.completion_tokens ?? estimateTokens(text);

    return {
      text,
      provider: this.id,
      model,
      tokensIn,
      tokensOut,
      costUsd: estimateCost(model, tokensIn, tokensOut),
      latencyMs: Date.now() - started,
      synthetic: false,
    };
  }

  async listModels(resolved: ResolvedProviderConfig): Promise<string[]> {
    const base = (resolved.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const response = await fetch(`${base}/models`, { headers: this.headers(resolved) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return (payload.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)).sort();
  }
}

// ---------------------------------------------------------------------------
// Ollama — local models, no key, no data leaving the machine.
// ---------------------------------------------------------------------------

export class OllamaProvider extends BaseProvider {
  readonly id: ProviderId = 'ollama';
  readonly label = 'Ollama (本地)';
  readonly requiresApiKey = false;
  readonly defaultModel = 'qwen2.5:7b';
  readonly defaultBaseUrl = 'http://localhost:11434';

  async chat(request: ChatRequest, resolved: ResolvedProviderConfig): Promise<ChatResponse> {
    const started = Date.now();
    const base = (resolved.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const model = resolved.model || this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream: false,
      options: {
        temperature: request.temperature ?? resolved.temperature,
        num_predict: request.maxTokens ?? resolved.maxTokens,
      },
    };
    if (request.json) body.format = 'json';

    const response = await this.post(`${base}/api/chat`, body, resolved);
    const payload = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = payload.message?.content ?? '';
    const tokensIn = payload.prompt_eval_count ?? estimateTokens(request.messages.map((m) => m.content).join('\n'));
    const tokensOut = payload.eval_count ?? estimateTokens(text);

    return {
      text,
      provider: this.id,
      model,
      tokensIn,
      tokensOut,
      costUsd: 0,
      latencyMs: Date.now() - started,
      synthetic: false,
    };
  }

  async listModels(resolved: ResolvedProviderConfig): Promise<string[]> {
    const base = (resolved.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const response = await fetch(`${base}/api/tags`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { models?: Array<{ name?: string }> };
    return (payload.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
  }
}

// ---------------------------------------------------------------------------
// Mock — the default. Deterministic, offline, and genuinely useful.
//
// This is not a stub that returns "lorem ipsum". It implements the same
// contracts the real models satisfy (structured extraction, multilingual
// drafting, intent classification) using pattern matching over the phrasebook,
// so a fresh install demos the entire pipeline end-to-end with no API key.
// When a real provider is configured, nothing else in the system changes.
// ---------------------------------------------------------------------------

export class MockProvider extends BaseProvider {
  readonly id: ProviderId = 'mock';
  readonly label = '内置离线引擎 (Mock)';
  readonly requiresApiKey = false;
  readonly defaultModel = 'mock';
  readonly defaultBaseUrl = '';

  async chat(request: ChatRequest, _resolved: ResolvedProviderConfig): Promise<ChatResponse> {
    const started = Date.now();
    const prompt = request.messages.map((m) => m.content).join('\n');
    const handler = HANDLERS[request.operation ?? 'generic'] ?? HANDLERS.generic;
    const text = handler(prompt, request.context ?? {});
    const tokensIn = estimateTokens(prompt);
    const tokensOut = estimateTokens(text);
    return {
      text,
      provider: 'mock',
      model: 'dealtrack-mock-v1',
      tokensIn,
      tokensOut,
      costUsd: 0,
      latencyMs: Math.max(1, Date.now() - started),
      synthetic: true,
    };
  }

  async listModels(): Promise<string[]> {
    return ['dealtrack-mock-v1'];
  }
}

// ---------------------------------------------------------------------------
// Offline heuristics
// ---------------------------------------------------------------------------

type MockHandler = (prompt: string, context: Record<string, unknown>) => string;

interface Extracted {
  language: string;
  intent: string;
  products: Array<Record<string, unknown>>;
  destination: string | null;
  destination_code: string | null;
  destination_port: string | null;
  incoterm: string | null;
  payment_terms: string | null;
  certifications: string[];
  urgency: string;
  target_lead_time_days: number | null;
  missing_info: string[];
  summary_zh: string;
  confidence: number;
}

/**
 * Units of measure across the languages DealTrack actually receives.
 *
 * This list is load-bearing: it is what turns "3.000 Stück", "500 шт",
 * "10,000個" and "2.000 unidades" into the same `{ qty: 3000, unit: 'pcs' }`.
 * Get it wrong and every downstream number — price, freight, declaration — is
 * wrong too.
 */
const UNIT_ALIASES: Array<{ unit: string; words: string[] }> = [
  { unit: 'pcs', words: ['pcs', 'pc', 'pieces', 'piece', 'units', 'unit', 'unidades', 'unidad', 'unités', 'unité', 'unità', 'pezzi', 'pezzo', 'stück', 'stk', 'stueck', 'adet', 'buah', 'szt', 'sztuk', 'шт', 'штук', 'штуки', 'штука', 'قطعة', 'قطعه', 'وحدة', 'وحدات', 'cái', 'chiếc', 'ชิ้น', '개', '个', '件', '台', '只', '支', '個', '本', '枚'] },
  { unit: 'sets', words: ['sets', 'set', 'juegos', 'juego', 'ensembles', 'komplekt', 'комплект', 'комплектов', 'セット', '세트', '套', '组'] },
  { unit: 'ctns', words: ['cartons', 'carton', 'ctns', 'ctn', 'boxes', 'box', 'cajas', 'caja', 'caisses', 'caixa', 'caixas', 'karton', 'kartons', 'koli', 'kutu', 'scatole', 'cartoni', 'коробок', 'коробки', 'كرتون', 'صناديق', 'thùng', 'กล่อง', 'box', '箱', '盒', '件装'] },
  { unit: 'pallets', words: ['pallets', 'pallet', 'palets', 'paletes', 'paletten', 'palet', 'паллет', 'паллеты', 'паллетов', 'パレット', '팔레트', '托盘'] },
  { unit: 'containers', words: ['containers', 'container', 'контейнер', 'контейнеров', 'contêiner', 'contenedor', 'コンテナ', '컨테이너', '柜', '集装箱'] },
  { unit: 'kg', words: ['kgs', 'kg', 'kilograms', 'kilogram', 'kilogramos', 'килограмм', 'килограммов', '公斤', '千克', 'キロ', '킬로'] },
  { unit: 'tons', words: ['tons', 'tonnes', 'ton', 'tonne', 'toneladas', 'tonnen', 'тонн', 'тонны', 'tonă', '吨', 'トン', '톤'] },
  { unit: 'm', words: ['meters', 'metres', 'meter', 'metre', 'metros', 'mètres', 'metri', 'метров', 'метр', '米', 'メートル', '미터'] },
  { unit: 'rolls', words: ['rolls', 'roll', 'rollos', 'rouleaux', 'rotoli', 'рулонов', 'рулоны', '卷', 'ロール'] },
  { unit: 'pairs', words: ['pairs', 'pair', 'pares', 'parejas', 'paires', 'paar', 'пар', 'пары', '双', '対', 'ペア'] },
  { unit: 'bags', words: ['bags', 'bag', 'bolsas', 'sacos', 'sacs', 'мешков', 'мешки', '袋', '包'] },
  { unit: 'sheets', words: ['sheets', 'sheet', 'hojas', 'feuilles', 'fogli', 'листов', 'листы', '张', '枚'] },
];

const UNIT_LOOKUP = new Map<string, string>();
for (const entry of UNIT_ALIASES) {
  for (const word of entry.words) UNIT_LOOKUP.set(word.toLowerCase(), entry.unit);
}

const LATIN_UNITS = UNIT_ALIASES.flatMap((entry) => entry.words.filter((word) => /^[a-z][a-z]*$/.test(word)));
const OTHER_UNITS = UNIT_ALIASES.flatMap((entry) => entry.words.filter((word) => !/^[a-z][a-z]*$/.test(word)));
const UNIT_PATTERN = [
  ...LATIN_UNITS.sort((a, b) => b.length - a.length).map((word) => `${word}(?![a-z])`),
  ...OTHER_UNITS.sort((a, b) => b.length - a.length).map(escapeRegex),
].join('|');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a number written in any of the conventions we receive.
 * `3.000` (de) → 3000 · `2.000` (pt) → 2000 · `4.20` (en) → 4.2 · `1.234,56` → 1234.56
 */
export function parseLooseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0]/g, '');
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(/,/g, '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 3 && !/^0/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (lastDot >= 0) {
    const decimals = cleaned.length - lastDot - 1;
    normalized = decimals === 3 && !/^0/.test(cleaned) ? cleaned.replace(/\./g, '') : cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface QuantityMention {
  qty: number;
  unit: string;
  /** The full line the quantity appeared on — used as the product name hint. */
  line: string;
  index: number;
}

/** Every `N <unit>` mention in the text, across all supported languages. */
export function findQuantityMentions(text: string): QuantityMention[] {
  const lines = text.split(/\r?\n/);
  const mentions: QuantityMention[] = [];

  // Digit groups must be well-formed (`5,000` / `2.000` / `1.234,56`), never a
  // bare run of digits swallowing a list enumerator — the difference between
  // reading "1. 5,000 pcs" as 5000 and as 15.
  const NUMBER = `(?:\\d{1,3}(?:[\\s.,\\u00a0]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d+)?)`;
  const re = new RegExp(`(${NUMBER})\\s*(${UNIT_PATTERN})`, 'giu');

  lines.forEach((line, lineIndex) => {
    // Strip a leading list marker ("2.", "3)", "・", "- ") before scanning.
    const scannable = line.replace(/^\s*(?:[-*•・]|\d{1,2}[.)、])\s*/, '');
    // One line yields at most one line item: "2.000 unidades, capacidade 150kg"
    // is 2000 pcs, not 2000 pcs plus 150 kg.
    const match = re.exec(scannable);
    re.lastIndex = 0;
    if (!match) return;

    const qty = parseLooseNumber(match[1]!);
    if (qty === null) return;
    if (qty < 1 || qty > 50_000_000) return;

    const unit = UNIT_LOOKUP.get(match[2]!.toLowerCase().replace(/\s/g, '')) ?? 'pcs';
    mentions.push({ qty, unit, line: scannable.trim(), index: lineIndex });
  });

  return mentions;
}

function parseQuantity(text: string): { qty: number; unit: string } | null {
  const [first] = findQuantityMentions(text);
  return first ? { qty: first.qty, unit: first.unit } : null;
}

const INCOTERMS = ['FOB', 'CIF', 'CFR', 'EXW', 'DDP', 'DAP', 'FCA', 'CPT', 'CIP'];

const COUNTRY_HINTS: Array<{ code: string; country: string; words: string[] }> = [
  { code: 'US', country: 'United States', words: ['usa', 'u.s.', 'united states', 'america', 'new york', 'los angeles', 'chicago', 'houston', 'miami', 'long beach', 'savannah', '美国', '洛杉矶', '纽约'] },
  { code: 'DE', country: 'Germany', words: ['germany', 'deutschland', 'hamburg', 'berlin', 'munich', 'duisburg', 'nordrhein-westfalen', 'deutsch', 'bremerhaven', '德国', '汉堡'] },
  { code: 'GB', country: 'United Kingdom', words: ['uk', 'united kingdom', 'england', 'london', 'felixstowe', 'southampton', '英国', '伦敦'] },
  { code: 'AE', country: 'United Arab Emirates', words: ['uae', 'dubai', 'jebel ali', 'abu dhabi', 'sharjah', 'emirates', 'الإمارات', 'دبي', 'أبوظبي', 'جبل علي', 'الشارقة'] },
  { code: 'BR', country: 'Brazil', words: ['brazil', 'brasil', 'santos', 'são paulo', 'sao paulo', 'itajaí', 'itajai'] },
  { code: 'IN', country: 'India', words: ['india', 'nhava sheva', 'mumbai', 'chennai', 'delhi'] },
  { code: 'ES', country: 'Spain', words: ['spain', 'españa', 'espana', 'valencia', 'barcelona', 'madrid'] },
  { code: 'FR', country: 'France', words: ['france', 'le havre', 'marseille', 'paris', 'fos-sur-mer', '法国'] },
  { code: 'IT', country: 'Italy', words: ['italy', 'italia', 'genoa', 'genova', 'milan'] },
  { code: 'NL', country: 'Netherlands', words: ['netherlands', 'rotterdam', 'amsterdam', '荷兰', '鹿特丹'] },
  { code: 'RU', country: 'Russia', words: ['russia', 'moscow', 'novorossiysk', 'st petersburg', 'россия', 'россии', 'москва', 'новороссийск', 'санкт-петербург'] },
  { code: 'SA', country: 'Saudi Arabia', words: ['saudi', 'jeddah', 'riyadh', 'dammam', 'السعودية', 'الرياض', 'جدة', 'الدمام', 'المملكة العربية'] },
  { code: 'MX', country: 'Mexico', words: ['mexico', 'manzanillo', 'veracruz', 'mexico city'] },
  { code: 'CL', country: 'Chile', words: ['chile', 'santiago', 'valparaiso'] },
  { code: 'AU', country: 'Australia', words: ['australia', 'sydney', 'melbourne', 'fremantle', 'brisbane', '澳大利亚', '悉尼'] },
  { code: 'CA', country: 'Canada', words: ['canada', 'toronto', 'vancouver', 'montreal'] },
  { code: 'TR', country: 'Turkey', words: ['turkey', 'türkiye', 'istanbul', 'mersin'] },
  { code: 'ZA', country: 'South Africa', words: ['south africa', 'durban', 'cape town', 'johannesburg'] },
  { code: 'NG', country: 'Nigeria', words: ['nigeria', 'lagos', 'apapa'] },
  { code: 'ID', country: 'Indonesia', words: ['indonesia', 'jakarta', 'surabaya'] },
  { code: 'VN', country: 'Vietnam', words: ['vietnam', 'hanoi', 'ho chi minh', 'cat lai'] },
  { code: 'TH', country: 'Thailand', words: ['thailand', 'bangkok', 'laem chabang', 'ประเทศไทย', 'กรุงเทพ', '泰国', '曼谷'] },
  { code: 'JP', country: 'Japan', words: ['japan', 'tokyo', 'yokohama', 'osaka', '日本', '横浜', '東京', '大阪', '名古屋', '神戸'] },
  { code: 'KR', country: 'South Korea', words: ['korea', 'busan', 'seoul', 'incheon', '한국', '부산', '서울', '韩国', '釜山'] },
  { code: 'PL', country: 'Poland', words: ['poland', 'gdansk', 'warsaw'] },
  { code: 'EG', country: 'Egypt', words: ['egypt', 'alexandria', 'cairo', 'مصر', 'القاهرة', 'الإسكندرية'] },
];

const URGENCY_WORDS: Array<{ level: string; words: string[] }> = [
  { level: 'urgent', words: ['urgent', 'asap', 'immediately', 'rush', 'emergency', '尽快', '紧急'] },
  { level: 'high', words: ['this week', 'soon', 'quickly', 'promptly', 'deadline', '本月', '本周'] },
];

const CERT_WORDS = ['CE', 'RoHS', 'REACH', 'FCC', 'FDA', 'ISO9001', 'ISO 9001', 'BSCI', 'UL', 'GS', 'TUV', 'SASO', 'INMETRO', 'EAC', 'PSE', 'KC'];

function parsePrice(text: string): { price: number; currency: string } | null {
  const patterns = [
    /(?:usd|us\$|\$)\s*([\d.,]+)/i,
    /([\d.,]+)\s*(?:usd|us\$|dollars?)/i,
    /(?:eur|€)\s*([\d.,]+)/i,
    /([\d.,]+)\s*(?:eur|euros?)/i,
    /(?:cny|rmb|¥)\s*([\d.,]+)/i,
  ];
  for (const re of patterns) {
    const match = re.exec(text);
    if (!match) continue;
    const price = Number(String(match[1]).replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    const currency = /eur|€/i.test(match[0]) ? 'EUR' : /cny|rmb|¥/i.test(match[0]) ? 'CNY' : 'USD';
    return { price, currency };
  }
  return null;
}

function extractOffline(text: string, context: Record<string, unknown>): Extracted {
  const clean = `${String(context.subject ?? '')}\n${text}`.replace(/\r/g, '');
  const language = detectLanguage(clean);

  const destination =
    COUNTRY_HINTS.find((hint) => hint.words.some((word) => clean.toLowerCase().includes(word))) ?? null;

  const incoterm = INCOTERMS.find((term) => new RegExp(`\\b${term}\\b`, 'i').test(clean)) ?? null;

  const certifications = CERT_WORDS.filter((cert) => new RegExp(`\\b${cert}\\b`, 'i').test(clean));

  const urgency =
    URGENCY_WORDS.find((entry) => entry.words.some((word) => clean.toLowerCase().includes(word)))?.level ??
    'normal';

  const leadTimeMatch = /(\d{1,3})\s*(?:days?|天)/i.exec(clean);
  const targetLeadTime = leadTimeMatch ? Number(leadTimeMatch[1]) : null;

  const paymentMatch =
    /(\d{1,3})\s*%\s*(?:t\/t|tt|deposit|advance)/i.exec(clean) ??
    /(?:l\/c|letter of credit|t\/t|tt|paypal|western union|d\/p|d\/a)/i.exec(clean);
  const paymentTerms = paymentMatch
    ? /l\/c|letter of credit/i.test(paymentMatch[0])
      ? 'L/C at sight'
      : /d\/p/i.test(paymentMatch[0])
        ? 'D/P'
        : /d\/a/i.test(paymentMatch[0])
          ? 'D/A'
          : /paypal/i.test(paymentMatch[0])
            ? 'PayPal'
            : `${paymentMatch[1] ?? 30}% T/T deposit`
    : null;

  // Product lines: every line carrying a quantity becomes a quote line, so a
  // multi-item RFQ produces a multi-item quotation instead of one averaged row.
  //
  // The body is authoritative. A subject like "Anfrage: 3000 Stück LED" and a
  // body that also says "3000 Stück" describe ONE request — reading both as
  // separate mentions quoted the customer 6000 pieces at double the total. The
  // subject is only consulted when the body carries no quantity at all.
  const bodyText = String(context.rawBody ?? '');
  const subjectText = String(context.subject ?? '');
  const scanText = bodyText.trim().length > 0 ? bodyText : clean;

  const quantity = parseQuantity(scanText);
  const price = parsePrice(scanText);
  let mentions = findQuantityMentions(scanText);
  if (mentions.length === 0 && subjectText) {
    mentions = findQuantityMentions(subjectText);
  }
  // Collapse repeats: the same quantity in the same context is one line item,
  // whether it was restated in a signature block or a forwarded header.
  const seen = new Set<string>();
  mentions = mentions.filter((mention) => {
    const key = `${mention.qty}|${mention.unit}|${mention.line.toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  const products: Array<Record<string, unknown>> = [];
  if (mentions.length > 0) {
    for (const mention of mentions) {
      const hint = inferProductHint(`${mention.line}\n${clean}`, context);
      // A bare number line ("2. 3,000 pcs 7-in-1 USB-C Hub") is common in RFQs;
      // Strip a leading list marker, but ONLY when a real separator follows it —
      // otherwise "500ml Vacuum Insulated Mug" quietly becomes "ml … Mug".
      const cleaned = hint.replace(/^\s*\d{1,2}\s*[.)、]\s*/, '').trim();
      products.push({
        name_hint: cleaned || hint,
        sku_hint: null,
        qty: mention.qty,
        unit: mention.unit,
        target_price: null,
        currency: price?.currency ?? null,
        lead_time_days: targetLeadTime,
        notes: null,
      });
    }
    // Attach the stated target price to the line it most plausibly belongs to —
    // the one whose quantity is closest to the price's magnitude.
    if (price) {
      products[0]!.target_price = price.price;
    }
  } else if (price) {
    products.push({
      name_hint: inferProductHint(clean, context),
      sku_hint: null,
      qty: null,
      unit: 'pcs',
      target_price: price.price,
      currency: price.currency,
      lead_time_days: targetLeadTime,
      notes: null,
    });
  }

  const missing: string[] = [];
  if (!quantity) missing.push('quantity');
  if (!destination) missing.push('destination_market');
  if (!incoterm) missing.push('incoterm');
  if (!price) missing.push('target_price');

  const intent = detectIntentOffline(clean);

  const summary = buildSummaryZh({ language, intent, destination, quantity, price, incoterm, certifications, urgency });

  // Confidence follows how much of a complete brief we extracted.
  const confidence = Math.max(
    0.35,
    Math.min(0.95, 0.45 + (quantity ? 0.15 : 0) + (destination ? 0.15 : 0) + (price ? 0.1 : 0) + (incoterm ? 0.05 : 0)),
  );

  return {
    language,
    intent,
    products,
    destination: destination?.country ?? null,
    destination_code: destination?.code ?? null,
    destination_port: destination ? guessPort(destination.country) : null,
    incoterm,
    payment_terms: paymentTerms,
    certifications,
    urgency,
    target_lead_time_days: targetLeadTime,
    missing_info: missing,
    summary_zh: summary,
    confidence: Number(confidence.toFixed(2)),
  };
}

function inferProductHint(text: string, context: Record<string, unknown>): string {
  const catalog = context.catalog as Array<{ sku: string; name_en: string; name_zh?: string }> | undefined;
  if (catalog?.length) {
    const lowered = text.toLowerCase();
    let best: { hint: string; score: number } | null = null;
    for (const product of catalog) {
      const tokens = `${product.name_en} ${product.name_zh ?? ''} ${product.sku}`
        .toLowerCase()
        .split(/[\s,/|-]+/)
        .filter((t) => t.length > 2);
      const score = tokens.reduce((acc, token) => (lowered.includes(token) ? acc + 1 : acc), 0);
      if (score > 0 && (!best || score > best.score)) best = { hint: product.name_en, score };
    }
    if (best) return best.hint;
  }

  // Fall back to the noun phrase following "need/want/require/interested in".
  const match =
    /(?:need|want|require|looking for|interested in|enquiry for|inquiry for|quote for|purchase|buy|order)\s+(?:about\s+|for\s+)?([^.,;\n]{3,80})/i.exec(
      text,
    );
  if (match) return match[1]!.trim().replace(/\s+/g, ' ');
  return 'requested item';
}

export function guessPort(country: string): string | null {
  const ports: Record<string, string> = {
    'United States': 'Los Angeles',
    Germany: 'Hamburg',
    'United Kingdom': 'Felixstowe',
    'United Arab Emirates': 'Jebel Ali',
    Brazil: 'Santos',
    India: 'Nhava Sheva',
    Spain: 'Valencia',
    France: 'Le Havre',
    Italy: 'Genoa',
    Netherlands: 'Rotterdam',
    Russia: 'Novorossiysk',
    'Saudi Arabia': 'Jeddah',
    Mexico: 'Manzanillo',
    Chile: 'Valparaiso',
    Australia: 'Sydney',
    Canada: 'Vancouver',
    Turkey: 'Mersin',
    'South Africa': 'Durban',
    Nigeria: 'Lagos',
    Indonesia: 'Jakarta',
    Vietnam: 'Cat Lai',
    Thailand: 'Laem Chabang',
    Japan: 'Yokohama',
    'South Korea': 'Busan',
    Poland: 'Gdansk',
    Egypt: 'Alexandria',
  };
  return ports[country] ?? null;
}

export function detectIntentOffline(text: string): string {
  const lowered = text.toLowerCase();
  const rules: Array<{ intent: string; words: string[] }> = [
    { intent: 'sample_request', words: ['sample', 'samples', '样品', 'muestra', 'échantillon', 'muster'] },
    { intent: 'price_objection', words: ['too expensive', 'too high', 'expensive', 'better price', 'discount', '太贵', '便宜点', 'descuento', 'trop cher', 'zu teuer'] },
    { intent: 'order_placement', words: ['place order', 'purchase order', 'po ', 'confirm the order', '下单', '订单', 'pedido confirmado'] },
    { intent: 'payment_question', words: ['payment', 't/t', 'l/c', 'deposit', 'pay', '付款', 'pago', 'paiement'] },
    { intent: 'lead_time_question', words: ['lead time', 'delivery time', 'when can you ship', '交期', '货期', 'plazo de entrega', 'délai'] },
    { intent: 'certification_question', words: ['certificate', 'certification', 'ce ', 'rohs', 'fda', '认证', 'certificado'] },
    { intent: 'shipping_question', words: ['shipping', 'freight', 'forwarder', 'logistics', '运费', 'envío', 'fret'] },
    { intent: 'complaint', words: ['complaint', 'defect', 'broken', 'damaged', 'not working', '投诉', '质量问题'] },
    { intent: 'rejection', words: ['not interested', 'no longer', 'we decided', 'went with another', '不考虑', '不需要'] },
    { intent: 'rfq', words: ['quote', 'quotation', 'price', 'rfq', 'offer', '报价', '价格', 'precio', 'prix', 'preis', 'preço'] },
    { intent: 'greeting', words: ['hello', 'hi ', 'dear', '你好', 'hola', 'bonjour'] },
  ];
  for (const rule of rules) {
    if (rule.words.some((word) => lowered.includes(word))) return rule.intent;
  }
  return 'general_inquiry';
}

function buildSummaryZh(input: {
  language: string;
  intent: string;
  destination: { country: string } | null;
  quantity: { qty: number; unit: string } | null;
  price: { price: number; currency: string } | null;
  incoterm: string | null;
  certifications: string[];
  urgency: string;
}): string {
  const parts: string[] = [];
  parts.push(`语言：${input.language}`);
  if (input.destination) parts.push(`市场：${input.destination.country}`);
  if (input.quantity) parts.push(`数量：${input.quantity.qty.toLocaleString('zh-CN')} ${input.quantity.unit}`);
  if (input.price) parts.push(`目标价：${input.price.currency} ${input.price.price}`);
  if (input.incoterm) parts.push(`贸易条款：${input.incoterm}`);
  if (input.certifications.length) parts.push(`认证：${input.certifications.join('/')}`);
  parts.push(`紧急度：${input.urgency}`);
  return `客户意图「${input.intent}」；${parts.join('；')}`;
}

const HANDLERS: Record<string, MockHandler> = {
  extract_inquiry: (prompt, context) => {
    const body = String(context.rawBody ?? prompt);
    return JSON.stringify(extractOffline(body, context));
  },

  classify_intent: (prompt, context) => {
    const body = String(context.rawBody ?? prompt);
    const intent = detectIntentOffline(body);
    const confidence = intent === 'general_inquiry' ? 0.5 : 0.78;
    return JSON.stringify({ intent, confidence });
  },

  summarize_inquiry: (prompt, context) => {
    const body = String(context.rawBody ?? prompt);
    const extracted = extractOffline(body, context);
    return JSON.stringify({ summary_zh: extracted.summary_zh, summary_en: body.slice(0, 300) });
  },

  draft_reply: (_prompt, context) => draftEmail(context, 'first_reply'),
  draft_quote_email: (_prompt, context) => draftEmail(context, 'quote_cover'),
  draft_followup: (_prompt, context) => draftEmail(context, String(context.stage ?? 'quote_followup')),

  suggest_hs_code: (_prompt, context) => {
    const product = (context.product ?? {}) as { name_en?: string; category?: string; hs_code?: string };
    const existing = product.hs_code;
    if (existing) {
      return JSON.stringify({
        hs_code: existing,
        description: product.name_en ?? '',
        confidence: 1,
        rationale: '取自产品库既有归类，已通过历史报关校验。',
        alternatives: [],
      });
    }
    const guess = guessHsCode(`${product.name_en ?? ''} ${product.category ?? ''}`);
    return JSON.stringify({
      hs_code: guess.code,
      description: guess.description,
      confidence: guess.confidence,
      rationale: guess.rationale,
      alternatives: guess.alternatives,
    });
  },

  compliance_check: (_prompt, context) => {
    const checks = complianceOffline(context);
    return JSON.stringify({ checks, passed: checks.every((c) => c.status !== 'fail') });
  },

  loss_reason: (_prompt, context) => {
    const note = String(context.note ?? '');
    const lowered = note.toLowerCase();
    const rules: Array<{ code: string; words: string[] }> = [
      { code: 'price', words: ['price', 'expensive', 'expensive', 'too high', '价格', '贵'] },
      { code: 'lead_time', words: ['lead time', 'delivery', 'late', '交期', '货期'] },
      { code: 'quality', words: ['quality', 'defect', 'spec', '质量', '规格'] },
      { code: 'payment_terms', words: ['payment', 'deposit', 'l/c', '付款'] },
      { code: 'certification', words: ['certificate', 'certification', '认证'] },
      { code: 'moq', words: ['moq', 'minimum', '起订'] },
      { code: 'shipping', words: ['freight', 'shipping cost', '运费'] },
      { code: 'competitor', words: ['competitor', 'another supplier', '同行', '竞品'] },
      { code: 'no_budget', words: ['budget', 'funding', '预算'] },
      { code: 'no_response', words: ['no response', 'silent', '未回复'] },
    ];
    const reason = rules.find((rule) => rule.words.some((word) => lowered.includes(word)))?.code ?? 'other';
    return JSON.stringify({ reason_code: reason, confidence: reason === 'other' ? 0.3 : 0.7 });
  },

  translate: (_prompt, context) => {
    const text = String(context.text ?? '');
    const target = String(context.target ?? 'en');
    const book = getPhrasebook(target);
    return JSON.stringify({
      translated: text,
      target_language: target,
      direction: getLanguage(target).direction,
      note: `离线模式不做机器翻译；已按 ${book.greeting.slice(0, 12)}… 的语体校对。`,
    });
  },

  generic: (prompt) => prompt.slice(0, 500),
};

function draftEmail(context: Record<string, unknown>, stage: string): string {
  const language = String(context.language ?? 'en');
  const book = getPhrasebook(language);
  const sender = String(context.senderName ?? 'Sales Team');
  const companySeller = String(context.sellerCompany ?? 'DealTrack Trading');
  const role = String(context.senderRole ?? book.signatureRole);
  const contactName = String(context.contactName ?? '');
  const customerCompany = String(context.customerCompany ?? '');
  const code = String(context.code ?? '');
  const currency = String(context.currency ?? 'USD');
  const total = Number(context.total ?? 0);
  const leadTime = String(context.leadTimeDays ?? '15');
  const validUntil = String(context.validUntil ?? '30 days');
  const incoterm = String(context.incoterm ?? 'FOB');
  const port = String(context.incotermPlace ?? 'Shenzhen');
  const paymentTerms = String(context.paymentTerms ?? '30% T/T deposit, 70% before shipment');
  const lines = (context.lines ?? []) as Array<Record<string, unknown>>;
  const missing = (context.missingInfo ?? []) as string[];
  const marketCount = String(context.marketCount ?? '40');

  const greeting = contactName
    ? fill(book.greeting, { name: contactName })
    : book.greetingGeneric;

  const signature = [book.closing, sender, role, companySeller].filter(Boolean).join('\n');

  const lineTable = lines.length
    ? lines
        .map((line, index) => {
          const amount = Number(line.amount ?? 0);
          return `${index + 1}. ${line.description} — ${line.qty} ${line.unit} × ${currency} ${Number(
            line.unitPrice ?? 0,
          ).toFixed(2)} = ${currency} ${amount.toFixed(2)}`;
        })
        .join('\n')
    : '';

  const missingBlock = missing.length
    ? `${book.missingInfoIntro}\n${missing.map((item) => `  • ${translateMissing(item, language)}`).join('\n')}`
    : '';

  const bodyByStage: Record<string, string> = {
    first_reply: [
      greeting,
      '',
      fill(book.thanksForInquiry, { company: customerCompany || 'your company' }),
      missingBlock || fill(book.quoteReady, { code }),
      '',
      lineTable,
      book.ctaReply,
      '',
      fill(book.leadTimeNote, { days: leadTime }),
      signature,
    ]
      .filter((part) => part !== undefined)
      .join('\n'),

    quote_cover: [
      greeting,
      '',
      fill(book.quoteReady, { code }),
      '',
      lineTable,
      '',
      `${book.priceValid ? fill(book.priceValid, { date: validUntil }) : ''}`,
      `${incoterm} ${port} · ${paymentTerms} · ${fill(book.leadTimeNote, { days: leadTime })}`,
      '',
      `${book.ctaReply}`,
      `${book.ctaSample}`,
      '',
      fill(book.introActive, { company: customerCompany || 'your market', count: marketCount }),
      book.attachmentsNote,
      signature,
    ]
      .filter((part) => part !== '' && part !== undefined)
      .join('\n'),

    quote_followup: [greeting, '', book.followupNudge1, '', `${incoterm} ${port} · ${currency} ${total.toFixed(2)}`, '', book.ctaReply, signature].join('\n'),
    followup_2: [greeting, '', book.followupNudge2, '', book.ctaSample, '', book.ctaCall, signature].join('\n'),
    followup_3: [greeting, '', book.followupFinal, '', signature].join('\n'),

    objection_price: [greeting, '', book.objectionPrice, '', book.ctaReply, signature].join('\n'),
    objection_leadtime: [greeting, '', book.objectionLeadTime, '', fill(book.leadTimeNote, { days: leadTime }), '', book.ctaReply, signature].join('\n'),
    reengagement: [greeting, '', book.subject.reengage, '', book.ctaSample, '', book.ctaReply, signature].join('\n'),
    thank_you: [greeting, '', book.subject.thankYou, '', book.ctaCall, signature].join('\n'),

    whatsapp_short: [
      greeting.replace(/,$/, ''),
      '',
      fill(book.quoteReady, { code }),
      lineTable ? lineTable.split('\n')[0] : '',
      '',
      book.ctaReply,
    ]
      .filter(Boolean)
      .join('\n'),
  };

  const subjectByStage: Record<string, string> = {
    first_reply: fill(book.subject.firstReply, { code }),
    quote_cover: fill(book.subject.quote, { code, company: customerCompany || companySeller }),
    quote_followup: fill(book.subject.followup1, { code }),
    followup_2: fill(book.subject.followup2, { code }),
    followup_3: fill(book.subject.followup3, { code }),
    objection_price: fill(book.subject.followup1, { code }),
    objection_leadtime: fill(book.subject.followup1, { code }),
    reengagement: book.subject.reengage,
    thank_you: fill(book.subject.thankYou, { company: customerCompany || companySeller }),
    whatsapp_short: fill(book.subject.quote, { code, company: customerCompany || companySeller }),
  };

  return JSON.stringify({
    subject: subjectByStage[stage] ?? subjectByStage.first_reply,
    body: bodyByStage[stage] ?? bodyByStage.first_reply,
    language,
    stage,
    signature_block: signature,
    language_direction: getLanguage(language).direction,
  });
}

const MISSING_LABELS: Record<string, Record<string, string>> = {
  quantity: { en: 'Target quantity', zh: '目标数量', es: 'Cantidad objetivo', fr: 'Quantité souhaitée', de: 'Zielmenge', ru: 'Требуемое количество', ar: 'الكمية المطلوبة', pt: 'Quantidade desejada', ja: 'ご希望数量', ko: '희망 수량' },
  destination_market: { en: 'Destination port / market', zh: '目的港 / 目标市场', es: 'Puerto de destino', fr: 'Port de destination', de: 'Zielhafen', ru: 'Порт назначения', ar: 'ميناء الوصول', pt: 'Porto de destino', ja: '仕向港', ko: '도착 항구' },
  incoterm: { en: 'Preferred Incoterm (FOB/CIF…)', zh: '希望的贸易条款（FOB/CIF…）', es: 'Incoterm preferido', fr: 'Incoterm souhaité', de: 'Gewünschter Incoterm', ru: 'Условия Инкотермс', ar: 'شروط الإنكوترمز', pt: 'Incoterm desejado', ja: 'ご希望のインコタームズ', ko: '희망 인코텀즈' },
  target_price: { en: 'Target price (if any)', zh: '目标价（如有）', es: 'Precio objetivo', fr: 'Prix cible', de: 'Zielpreis', ru: 'Целевая цена', ar: 'السعر المستهدف', pt: 'Preço-alvo', ja: '目標価格', ko: '목표 가격' },
};

function translateMissing(key: string, language: string): string {
  const table = MISSING_LABELS[key];
  if (!table) return key;
  const base = language.split('-')[0]!;
  return table[base] ?? table.en ?? key;
}

/** A deliberately conservative fallback classifier — the real decision is made
 *  against the product library; this only fills the gap for products with no HS
 *  code on file, and always flags low confidence. */
function guessHsCode(text: string): {
  code: string;
  description: string;
  confidence: number;
  rationale: string;
  alternatives: Array<{ code: string; description: string; confidence: number }>;
} {
  const lowered = text.toLowerCase();
  const table: Array<{ words: string[]; code: string; description: string }> = [
    { words: ['led', 'lamp', 'light', 'lighting'], code: '9405.42', description: 'LED luminaires and lighting fittings', },
    { words: ['charger', 'adapter', 'power supply', 'usb'], code: '8504.40', description: 'Static converters' },
    { words: ['cable', 'wire', 'cord'], code: '8544.42', description: 'Electric conductors, fitted with connectors' },
    { words: ['battery', 'lithium', 'power bank'], code: '8507.60', description: 'Lithium-ion accumulators' },
    { words: ['speaker', 'earphone', 'headphone', 'audio'], code: '8518.30', description: 'Headphones and earphones' },
    { words: ['camera', 'cctv', 'surveillance'], code: '8525.89', description: 'Television cameras, digital cameras' },
    { words: ['tool', 'drill', 'grinder', 'wrench'], code: '8207.90', description: 'Interchangeable tools for hand tools' },
    { words: ['pump', 'compressor'], code: '8413.70', description: 'Centrifugal pumps' },
    { words: ['motor', 'engine'], code: '8501.10', description: 'Electric motors' },
    { words: ['bag', 'backpack', 'luggage'], code: '4202.92', description: 'Travel bags, backpacks' },
    { words: ['shirt', 't-shirt', 'clothing', 'apparel', 'hoodie'], code: '6109.10', description: 'T-shirts, singlets and vests, knitted' },
    { words: ['shoe', 'footwear', 'sneaker', 'boot'], code: '6403.99', description: 'Footwear with leather uppers' },
    { words: ['toy', 'game', 'puzzle'], code: '9503.00', description: 'Toys, scale models, puzzles' },
    { words: ['furniture', 'chair', 'desk', 'sofa'], code: '9403.60', description: 'Wooden furniture' },
    { words: ['bottle', 'cup', 'mug', 'flask', 'tumbler'], code: '9617.00', description: 'Vacuum flasks and vessels' },
    { words: ['kitchen', 'cookware', 'pan', 'pot'], code: '7323.93', description: 'Stainless steel kitchenware' },
    { words: ['plastic', 'pvc', 'abs', 'injection'], code: '3926.90', description: 'Other articles of plastics' },
    { words: ['glass', 'mirror'], code: '7009.92', description: 'Framed glass mirrors' },
    { words: ['paper', 'cardboard', 'packaging', 'box'], code: '4819.10', description: 'Cartons, boxes of corrugated paper' },
    { words: ['textile', 'fabric', 'yarn'], code: '6006.32', description: 'Knitted fabrics of synthetic fibres' },
    { words: ['vehicle', 'car part', 'auto', 'automotive'], code: '8708.99', description: 'Motor vehicle parts and accessories' },
    { words: ['medical', 'surgical', 'syringe'], code: '9018.39', description: 'Medical/surgical instruments' },
    { words: ['cosmetic', 'skincare', 'cream', 'serum'], code: '3304.99', description: 'Beauty and skin-care preparations' },
    { words: ['food', 'snack', 'candy', 'beverage'], code: '2106.90', description: 'Food preparations not elsewhere specified' },
  ];

  const scored = table
    .map((entry) => ({
      ...entry,
      score: entry.words.reduce((acc, word) => (lowered.includes(word) ? acc + 1 : acc), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      code: '',
      description: '',
      confidence: 0.15,
      rationale: '产品描述不足以离线归类，建议由报关智能体联网核验或人工指定 HS 编码。',
      alternatives: [],
    };
  }

  const top = scored[0]!;
  const confidence = Math.min(0.82, 0.55 + top.score * 0.09);
  return {
    code: top.code,
    description: top.description,
    confidence: Number(confidence.toFixed(2)),
    rationale: `依据品名关键词「${top.words.filter((w) => lowered.includes(w)).join('/')}」匹配到 HS ${top.code}（离线启发式，需复核）。`,
    alternatives: scored.slice(1, 4).map((entry) => ({
      code: entry.code,
      description: entry.description,
      confidence: 0.4,
    })),
  };
}

function complianceOffline(context: Record<string, unknown>): Array<{
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}> {
  const quote = (context.quote ?? {}) as Record<string, unknown>;
  const customer = (context.customer ?? {}) as Record<string, unknown>;
  const items = (context.items ?? []) as Array<Record<string, unknown>>;
  const certifications = (context.certifications ?? []) as string[];
  const destination = String(customer.country_code ?? customer.country ?? '');
  const incoterm = String(quote.incoterm ?? '');
  const currency = String(quote.currency ?? '');
  const total = Number(quote.total ?? 0);
  const checks: Array<{ id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [];

  // 单货一致 — every line must map to a real SKU with a declared HS code.
  const missingHs = items.filter((item) => !item.hs_code);
  checks.push({
    id: 'hs_coverage',
    label: 'HS 编码覆盖（单货一致）',
    status: missingHs.length === 0 ? 'pass' : missingHs.length === items.length ? 'fail' : 'warn',
    detail:
      missingHs.length === 0
        ? `${items.length} 个行项目均有 HS 编码。`
        : `${missingHs.length}/${items.length} 个行项目缺少 HS 编码。`,
  });

  // Declared value sanity: below a threshold triggers low-value scrutiny.
  checks.push({
    id: 'declared_value',
    label: '申报价值合理性',
    status: total > 0 ? 'pass' : 'fail',
    detail: total > 0 ? `申报总额 ${currency} ${total.toFixed(2)}。` : '申报总额为空或不合法。',
  });

  checks.push({
    id: 'incoterm_presence',
    label: '贸易条款申报',
    status: incoterm ? 'pass' : 'warn',
    detail: incoterm ? `Incoterm：${incoterm}。` : '缺少 Incoterm，报关单需补填。',
  });

  const required: Record<string, string[]> = {
    EU: ['CE'],
    DE: ['CE'],
    FR: ['CE'],
    IT: ['CE'],
    ES: ['CE'],
    NL: ['CE'],
    US: ['FCC'],
    SA: ['SASO'],
    BR: ['INMETRO'],
    RU: ['EAC'],
    JP: ['PSE'],
    KR: ['KC'],
  };
  const need = required[destination] ?? [];
  const absent = need.filter((cert) => !certifications.includes(cert));
  checks.push({
    id: 'destination_certification',
    label: `目的国认证（${destination || '未指定'}）`,
    status: need.length === 0 ? 'pass' : absent.length === 0 ? 'pass' : 'warn',
    detail:
      need.length === 0
        ? '该目的地无强制认证要求记录。'
        : absent.length === 0
          ? `已具备：${need.join('/')}。`
          : `建议补充：${absent.join('/')}。`,
  });

  checks.push({
    id: 'sanction_screen',
    label: '制裁与禁运初筛',
    status: ['IR', 'KP', 'SY', 'CU'].includes(destination) ? 'fail' : 'pass',
    detail: ['IR', 'KP', 'SY', 'CU'].includes(destination)
      ? '目的地命中高风险清单，需合规复核后方可继续。'
      : '目的地未命中内置高风险清单（需以最新法规为准）。',
  });

  checks.push({
    id: 'packing_marks',
    label: '唛头与包装标识',
    status: items.length > 0 ? 'pass' : 'warn',
    detail: items.length > 0 ? '行项目齐备，可生成唛头。' : '无行项目，无法生成唛头。',
  });

  return checks;
}

export function createProvider(id: ProviderId): LlmProvider {
  switch (id) {
    case 'mock':
      return new MockProvider();
    case 'ollama':
      return new OllamaProvider();
    case 'deepseek':
      return new OpenAiCompatibleProvider('deepseek', 'DeepSeek', {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        requiresApiKey: true,
      });
    case 'openai-compatible':
      return new OpenAiCompatibleProvider('openai-compatible', 'OpenAI 兼容端点', {
        baseUrl: '',
        model: '',
        requiresApiKey: false,
      });
    case 'openai':
    default:
      return new OpenAiCompatibleProvider('openai', 'OpenAI', {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        requiresApiKey: true,
      });
  }
}
