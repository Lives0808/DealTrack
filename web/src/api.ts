/**
 * DealTrack API client.
 *
 * One place that knows how to talk to the server: bearer token, JSON envelope
 * unwrapping, and a shared SSE subscription for the live agent feed.
 */

const TOKEN_KEY = 'dealtrack.token';
const ACTOR_KEY = 'dealtrack.actor';

export const DEFAULT_TOKEN = 'dealtrack-dev-token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || DEFAULT_TOKEN;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getActor(): string {
  return localStorage.getItem(ACTOR_KEY) || 'user:ops';
}

export function setActor(actor: string): void {
  localStorage.setItem(ACTOR_KEY, actor);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getToken()}`,
      'x-dealtrack-actor': getActor(),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text.slice(0, 300) };
  }

  const body = payload as { ok?: boolean; data?: T; message?: string; error?: string } | null;
  if (!response.ok || body?.ok === false) {
    throw new ApiError(
      body?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      body?.error ?? 'error',
    );
  }
  return (body?.data ?? (payload as T)) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

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
  status: string;
  tier: string;
  tags: string[];
  preferences: Record<string, unknown>;
  notes: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: CustomerStats;
}

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
  subject: string | null;
  body: string | null;
  fromEmail: string | null;
  fromName: string | null;
  fromPhone: string | null;
  language: string | null;
  detectedIntent: string | null;
  status: string;
  priority: string;
  parsed: Record<string, unknown> | null;
  parseConfidence: number | null;
  productMatches: Array<{ productId: string; sku: string; nameEn: string; score: number }>;
  missingInfo: string[];
  summaryZh: string | null;
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
  quotes?: Quote[];
  messages?: Message[];
  timeline?: TimelineEntry[];
  sla?: SlaState;
  quoteCount?: number;
}

export interface SlaState {
  dueAt: string | null;
  minutesElapsed: number;
  minutesRemaining: number | null;
  state: 'met' | 'within' | 'at_risk' | 'breached' | 'n/a';
  firstResponseMinutes: number | null;
}

export interface QuoteItem {
  id: string;
  lineNo: number;
  productId: string | null;
  sku: string | null;
  description: string;
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
  priceBreakdown: Array<Record<string, number>>;
  appliedRules: Array<{ name: string; effect: string; deltaPct?: number; deltaAmount?: number }>;
  createdBy: string;
  approvedBy: string | null;
  sentAt: string | null;
  notes: string | null;
  internalNotes: string | null;
  pdfPath: string | null;
  createdAt: string;
  updatedAt: string;
  items?: QuoteItem[];
  customer?: Customer | null;
  outcome?: QuoteOutcome | QuoteOutcome[] | null;
  inquiry?: Inquiry | null;
}

export interface QuoteOutcome {
  id: string;
  quoteId: string;
  result: 'won' | 'lost' | 'no_response' | 'pending';
  reasonCode: string | null;
  reasonNote: string | null;
  competitor: string | null;
  finalPrice: number | null;
  decidedAt: string;
}

export interface Message {
  id: string;
  channel: string;
  direction: string;
  inquiryId: string | null;
  quoteId: string | null;
  customerId: string | null;
  followupId: string | null;
  toAddr: string;
  subject: string | null;
  body: string;
  language: string | null;
  status: string;
  provider: string | null;
  error: string | null;
  createdBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

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
  language: string;
  subject: string | null;
  body: string | null;
  attempts: number;
  snoozedUntil: string | null;
  escalatedAt: string | null;
  customer?: Customer | null;
  quote?: Quote | null;
  overdueMinutes?: number;
}

export interface ProductTier {
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

export interface Product {
  id: string;
  sku: string;
  nameEn: string;
  nameZh: string | null;
  category: string | null;
  descriptionEn: string | null;
  unit: string;
  moq: number;
  hsCode: string | null;
  hsDescription: string | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  cbm: number | null;
  certifications: string[];
  targetMarkets: string[];
  status: string;
  tiers?: ProductTier[];
  createdAt: string;
}

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
}

export interface AgentBoardEntry {
  agent: string;
  label: string;
  description: string;
  status: string;
  enabled: boolean;
  processed: number;
  failed: number;
  totalTokens: number;
  totalCostUsd: number;
  averageLatencyMs: number;
  queueDepth: number;
  lastRunAt: string | null;
  successRate: number;
  taskTypes: string[];
}

export interface AgentRun {
  id: string;
  agent: string;
  taskId: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AgentTask {
  id: string;
  agent: string;
  taskType: string;
  payload: Record<string, unknown>;
  priority: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
  runAfter: string | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface TimelineEntry {
  id: string;
  type: string;
  actor: string;
  subject: string | null;
  payload: Record<string, unknown>;
  at: string;
}

export interface DomainEvent {
  id: string;
  seq: number;
  type: string;
  actor: string;
  entityType: string | null;
  entityId: string | null;
  subject: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

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
  messageCount?: number;
  messages?: Array<{ id: string; author: string; role: string | null; body: string; mentions: string[]; createdAt: string }>;
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
  createdAt: string;
}

export interface Overview {
  range: { days: number; since: string; until: string };
  kpi: {
    avgFirstResponseMinutes: number;
    targetMinutes: number;
    baselineMinutes: number;
    bestFirstResponseMinutes: number;
    responded: number;
    pendingReply: number;
    minutesSaved: number;
    hoursSaved: number;
    speedupFactor: number;
  };
  funnel: {
    received: number;
    parsed: number;
    quoted: number;
    sent: number;
    won: number;
    lost: number;
    noResponse: number;
    quoteRate: number;
    winRate: number;
    conversion: number;
  };
  pipeline: { openValue: number; openMargin: number; totalQuotes: number };
  agents: AgentBoardEntry[];
  followups: Record<string, number>;
  risks: {
    alerts: number;
    openThreads: number;
    pendingApprovals: number;
    slaAtRisk: number;
    expiringQuotes: number;
    deadTasks: number;
  };
  loss: LossAnalytics;
  llm: {
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    provider: string;
    readiness: { ready: boolean; provider: string; reason: string };
  };
  tasks: Record<string, number>;
}

export interface LossAnalytics {
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
}

export interface Settings {
  company: Record<string, string | number>;
  sales: Record<string, string>;
  automation: {
    autoSend: boolean;
    followupCadenceDays: number[];
    slaFirstReplyMinutes: number;
    silenceDays: number;
    escalateAfterHours: number;
    draftQuotesAutomatically: boolean;
    languageAutoDetect: boolean;
  };
  llm: { provider: string; model: string; baseUrl: string; temperature: number; hasApiKey: boolean; apiKeyMasked: string };
  integrations: Record<string, Record<string, unknown>>;
  providers: Array<{ id: string; label: string; defaultModel: string; defaultBaseUrl: string; requiresApiKey: boolean; hasApiKey: boolean }>;
  models: Record<string, { input: number; output: number }>;
  paths: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Live event stream (SSE)
// ---------------------------------------------------------------------------

export interface StreamHandlers {
  onEvent: (event: DomainEvent) => void;
  onStatus?: (connected: boolean) => void;
}

export function openStream(handlers: StreamHandlers, types?: string): () => void {
  // EventSource can't set headers, so the token rides as a query parameter and
  // the server accepts it for this endpoint only.
  const params = new URLSearchParams({ token: getToken() });
  if (types) params.set('types', types);
  const source = new EventSource(`/api/stream?${params.toString()}`);

  const handle = (raw: MessageEvent) => {
    try {
      handlers.onEvent(JSON.parse(raw.data) as DomainEvent);
    } catch {
      /* ignore malformed frames */
    }
  };

  source.addEventListener('message', handle);
  for (const type of [
    'inquiry.received', 'inquiry.parsed', 'inquiry.needs_info', 'inquiry.status_changed',
    'quote.created', 'quote.sent', 'quote.accepted', 'quote.rejected', 'quote.pending_approval',
    'message.drafted', 'message.sent', 'message.received', 'message.failed',
    'followup.scheduled', 'followup.drafted', 'followup.sent', 'followup.replied', 'followup.escalated',
    'customer.created', 'customer.silent', 'agent.run.succeeded', 'agent.run.failed',
    'task.enqueued', 'task.dead', 'thread.opened', 'alert.created',
    'sla.at_risk', 'sla.breached', 'risk.lead_time', 'customs.declaration_drafted', 'customs.compliance_issue',
  ]) {
    source.addEventListener(type, handle);
  }

  source.addEventListener('hello', () => handlers.onStatus?.(true));
  source.onopen = () => handlers.onStatus?.(true);
  source.onerror = () => handlers.onStatus?.(false);

  return () => source.close();
}

/** The server's SSE endpoint authenticates via `?token=` for EventSource. */
export const streamTokenParam = true;
