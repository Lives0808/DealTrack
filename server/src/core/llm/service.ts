import { z } from 'zod';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { getLlmSettings, getLlmApiKey } from '../settings.js';
import { nowIso, uid } from '../util.js';
import {
  PROVIDER_DEFAULTS,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type LlmOperation,
  type LlmProvider,
  type ProviderId,
  type ResolvedProviderConfig,
} from './types.js';
import { createProvider } from './providers.js';

export interface JsonCallOptions<T> {
  operation?: LlmOperation;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  system: string;
  user: string;
  context?: Record<string, unknown>;
  /** Deterministic answer used when the model is unreachable or returns junk. */
  fallback: () => T;
  agent?: string;
  taskId?: string;
  temperature?: number;
  maxTokens?: number;
  /** Attempts to repair malformed JSON before falling back. */
  repairAttempts?: number;
}

export interface JsonCallResult<T> {
  data: T;
  response: ChatResponse;
  /** True when the deterministic fallback produced `data`. */
  usedFallback: boolean;
  repaired: boolean;
}

/**
 * Pull the first balanced JSON object/array out of a model response.
 * Models love wrapping JSON in prose or fences; this is the unglamorous code
 * that makes structured agents reliable in production.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // 1. Straight parse.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* keep going */
  }

  // 2. Strip ```json fences.
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* keep going */
    }
  }

  // 3. Scan for a balanced value.
  const start = trimmed.search(/[[{]/);
  if (start === -1) throw new Error('no JSON found in model response');
  const open = trimmed[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const char = trimmed[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  throw new Error('unbalanced JSON in model response');
}

export class LlmService {
  private providers = new Map<ProviderId, LlmProvider>();

  provider(id?: ProviderId): LlmProvider {
    const target = id ?? getLlmSettings().provider;
    let instance = this.providers.get(target);
    if (!instance) {
      instance = createProvider(target);
      this.providers.set(target, instance);
    }
    return instance;
  }

  resolve(overrides: Partial<ResolvedProviderConfig> = {}): ResolvedProviderConfig {
    const settings = getLlmSettings();
    const providerId = (overrides.provider ?? settings.provider) as ProviderId;
    const defaults = PROVIDER_DEFAULTS[providerId];
    return {
      provider: providerId,
      model: overrides.model ?? settings.model ?? defaults?.model ?? '',
      apiKey: overrides.apiKey ?? getLlmApiKey(providerId),
      baseUrl: overrides.baseUrl ?? settings.baseUrl ?? defaults?.baseUrl ?? '',
      temperature: overrides.temperature ?? settings.temperature ?? config.llm.temperature,
      maxTokens: overrides.maxTokens ?? config.llm.maxOutputTokens,
      timeoutMs: overrides.timeoutMs ?? config.llm.timeoutMs,
    };
  }

  /** Is the configured provider ready to actually call out? */
  readiness(): { ready: boolean; provider: ProviderId; reason: string } {
    const resolved = this.resolve();
    const provider = this.provider(resolved.provider);
    if (resolved.provider === 'mock') {
      return { ready: true, provider: 'mock', reason: '离线引擎就绪，无需 API Key。' };
    }
    if (provider.requiresApiKey && !resolved.apiKey) {
      return {
        ready: false,
        provider: resolved.provider,
        reason: `${provider.label} 需要 API Key，请在「设置 → AI 模型」中填入。当前会自动回退到离线引擎。`,
      };
    }
    if (!resolved.baseUrl) {
      return { ready: false, provider: resolved.provider, reason: '缺少 Base URL。' };
    }
    return { ready: true, provider: resolved.provider, reason: '配置完整，将调用真实模型。' };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const resolved = this.resolve({
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    const provider = this.provider(resolved.provider);
    const readiness = this.readiness();

    // A misconfigured provider degrades to the offline engine instead of taking
    // the whole pipeline down. The UI surfaces this via /api/agents/health.
    const effective = readiness.ready ? provider : this.provider('mock');
    const started = Date.now();
    let response: ChatResponse;
    try {
      response = await effective.chat(request, resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordUsage({
        provider: resolved.provider,
        model: resolved.model,
        agent: request.agent ?? null,
        taskId: request.taskId ?? null,
        operation: request.operation ?? 'generic',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
        ok: false,
        error: message,
      });
      if (resolved.provider === 'mock') throw error;
      console.warn(`[llm] ${resolved.provider} failed (${message}); degrading to offline engine`);
      response = await this.provider('mock').chat(request, resolved);
    }

    this.recordUsage({
      provider: response.provider,
      model: response.model,
      agent: request.agent ?? null,
      taskId: request.taskId ?? null,
      operation: request.operation ?? 'generic',
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      costUsd: response.costUsd,
      latencyMs: response.latencyMs,
      ok: true,
      error: null,
    });
    return response;
  }

  /**
   * Structured call: JSON out, schema-validated, with one repair round-trip and a
   * deterministic fallback so an agent can *always* finish its task.
   */
  async json<T>(options: JsonCallOptions<T>): Promise<JsonCallResult<T>> {
    const schemaHint = describeSchema(options.schema);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `${options.system}\n\nRespond with a single JSON value and nothing else. It must validate against this JSON Schema:\n${schemaHint}`,
      },
      { role: 'user', content: options.user },
    ];

    let lastError = '';
    const repairAttempts = options.repairAttempts ?? 1;
    let repaired = false;

    for (let attempt = 0; attempt <= repairAttempts; attempt += 1) {
      const response = await this.chat({
        messages,
        operation: options.operation ?? 'generic',
        context: options.context,
        json: true,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        agent: options.agent,
        taskId: options.taskId,
      });

      try {
        const parsed = extractJson(response.text);
        const validated = options.schema.parse(parsed);
        return { data: validated, response, usedFallback: response.synthetic, repaired };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt >= repairAttempts || response.synthetic) break;
        repaired = true;
        messages.push({ role: 'assistant', content: response.text.slice(0, 4000) });
        messages.push({
          role: 'user',
          content: `That response did not validate: ${lastError}\nReturn corrected JSON only.`,
        });
      }
    }

    console.warn(`[llm] ${options.operation} fell back to deterministic path: ${lastError}`);
    return {
      data: options.fallback(),
      response: {
        text: '',
        provider: 'mock',
        model: 'dealtrack-fallback',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
        synthetic: true,
      },
      usedFallback: true,
      repaired,
    };
  }

  private recordUsage(input: {
    provider: string;
    model: string;
    agent: string | null;
    taskId: string | null;
    operation: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
    ok: boolean;
    error: string | null;
  }): void {
    try {
      getDb().run(
        `INSERT INTO llm_usage (id, provider, model, agent, task_id, operation, tokens_in, tokens_out, cost_usd, latency_ms, ok, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid('llm'),
        input.provider,
        input.model,
        input.agent,
        input.taskId,
        input.operation,
        input.tokensIn,
        input.tokensOut,
        input.costUsd,
        input.latencyMs,
        input.ok ? 1 : 0,
        input.error,
        nowIso(),
      );
    } catch (error) {
      console.warn('[llm] failed to record usage', error);
    }
  }

  usageSummary(sinceIso: string): {
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    byProvider: Array<{ provider: string; calls: number; costUsd: number }>;
  } {
    const db = getDb();
    const totals = db.get<Record<string, unknown>>(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout,
              COALESCE(SUM(cost_usd),0) AS cost
         FROM llm_usage WHERE created_at >= ?`,
      sinceIso,
    );
    const byProvider = db.all<Record<string, unknown>>(
      `SELECT provider, COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost
         FROM llm_usage WHERE created_at >= ? GROUP BY provider ORDER BY calls DESC`,
      sinceIso,
    );
    return {
      calls: Number(totals?.calls ?? 0),
      tokensIn: Number(totals?.tin ?? 0),
      tokensOut: Number(totals?.tout ?? 0),
      costUsd: Number(totals?.cost ?? 0),
      byProvider: byProvider.map((row) => ({
        provider: String(row.provider),
        calls: Number(row.calls),
        costUsd: Number(row.cost),
      })),
    };
  }
}

/** Compact JSON-Schema rendering of a zod schema for the prompt. */
function describeSchema(schema: z.ZodTypeAny, depth = 0): string {
  if (depth > 6) return '{}';
  const def = schema._def as { typeName?: string };
  const typeName = def?.typeName;

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodNull':
      return 'null';
    case 'ZodAny':
    case 'ZodUnknown':
      return 'any';
    case 'ZodLiteral':
      return JSON.stringify((schema as z.ZodLiteral<unknown>).value);
    case 'ZodEnum':
      return JSON.stringify((schema as z.ZodEnum<[string, ...string[]]>).options);
    case 'ZodArray':
      return `[${describeSchema((schema as z.ZodArray<z.ZodTypeAny>).element, depth + 1)}]`;
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
      return describeSchema((schema as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType, depth + 1);
    case 'ZodEffects':
      return describeSchema((schema as unknown as { _def: { schema: z.ZodTypeAny } })._def.schema, depth + 1);
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const entries = Object.entries(shape).map(([key, value]) => {
        const optional = (value as z.ZodTypeAny).isOptional();
        return `${JSON.stringify(key)}${optional ? '?' : ''}: ${describeSchema(value as z.ZodTypeAny, depth + 1)}`;
      });
      return `{${entries.join(', ')}}`;
    }
    case 'ZodUnion': {
      const options = (schema as unknown as { _def: { options: z.ZodTypeAny[] } })._def.options;
      return `(${options.map((option) => describeSchema(option, depth + 1)).join(' | ')})`;
    }
    case 'ZodRecord':
      return '{"<key>": any}';
    default:
      return 'any';
  }
}

let service: LlmService | null = null;

export function getLlm(): LlmService {
  if (!service) service = new LlmService();
  return service;
}

export * from './types.js';
export { createProvider } from './providers.js';
