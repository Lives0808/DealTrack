/**
 * LLM layer types + cost table.
 *
 * DealTrack is BYOK (bring your own key): the operator configures OpenAI,
 * DeepSeek, Ollama or any OpenAI-compatible endpoint in Settings. Nothing is
 * proxied through a DealTrack server, and the `mock` provider means the whole
 * pipeline is demoable with zero keys and zero network access.
 */

export type ProviderId = 'mock' | 'openai' | 'deepseek' | 'ollama' | 'openai-compatible';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Which high-level agent operation triggered the call. Drives the mock provider
 *  and makes the LLM usage table readable for the boss. */
export type LlmOperation =
  | 'extract_inquiry'
  | 'classify_intent'
  | 'summarize_inquiry'
  | 'draft_reply'
  | 'draft_quote_email'
  | 'draft_followup'
  | 'suggest_hs_code'
  | 'compliance_check'
  | 'loss_reason'
  | 'translate'
  | 'generic';

export interface ChatRequest {
  messages: ChatMessage[];
  operation?: LlmOperation;
  /** Free-form context handed to the mock provider so it can be useful offline. */
  context?: Record<string, unknown>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
  agent?: string;
  taskId?: string;
}

export interface ChatResponse {
  text: string;
  provider: ProviderId;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  /** True when a deterministic fallback produced the answer (no real LLM call). */
  synthetic: boolean;
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly requiresApiKey: boolean;
  readonly defaultModel: string;
  readonly defaultBaseUrl: string;
  chat(request: ChatRequest, resolved: ResolvedProviderConfig): Promise<ChatResponse>;
  listModels?(resolved: ResolvedProviderConfig): Promise<string[]>;
}

export interface ResolvedProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

/** USD per 1M tokens. Update as vendors move; purely informational for the boss. */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'qwen2.5:7b': { input: 0, output: 0 },
  'llama3.1:8b': { input: 0, output: 0 },
  mock: { input: 0, output: 0 },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const key = Object.keys(MODEL_COSTS).find((candidate) => model.startsWith(candidate));
  if (!key) return 0;
  const rate = MODEL_COSTS[key]!;
  return (tokensIn / 1_000_000) * rate.input + (tokensOut / 1_000_000) * rate.output;
}

/** Cheap, dependency-free token estimate: CJK ≈ 1 token/char, Latin ≈ 1/4 char. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

export const PROVIDER_DEFAULTS: Record<ProviderId, { label: string; baseUrl: string; model: string; requiresApiKey: boolean }> = {
  mock: { label: '内置离线引擎 (Mock)', baseUrl: '', model: 'mock', requiresApiKey: false },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', requiresApiKey: true },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', requiresApiKey: true },
  ollama: { label: 'Ollama (本地)', baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b', requiresApiKey: false },
  'openai-compatible': {
    label: 'OpenAI 兼容端点',
    baseUrl: '',
    model: '',
    requiresApiKey: false,
  },
};
