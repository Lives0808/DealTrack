import type { Database } from '../core/db.js';
import type { DomainEvent, EmitInput, EventBus, EventType } from '../core/events.js';
import type { AgentTask, TaskQueue } from '../core/queue.js';
import type { LlmService } from '../core/llm/service.js';
import type { ChatRequest, ChatResponse } from '../core/llm/types.js';
import type { z } from 'zod';
import { nowIso, uid } from '../core/util.js';

/** Emitted by an agent; the orchestrator durably records each as an `agent_run`. */
export interface AgentResult {
  status: 'succeeded' | 'waiting_approval' | 'skipped';
  summary: string;
  data?: Record<string, unknown>;
}

export interface AgentContext {
  db: Database;
  llm: LlmService;
  bus: EventBus;
  queue: TaskQueue;
  task: AgentTask;
  /** The event that caused this task, when there was one. */
  trigger: DomainEvent | null;
  /** Writes an event with the correlation chain filled in automatically. */
  emit: (input: Omit<EmitInput, 'actor' | 'correlationId' | 'causationId'> & { actor?: string; correlationId?: string }) => DomainEvent;
  /** Enqueues follow-on work in another agent. */
  schedule: (input: {
    agent: string;
    taskType: string;
    payload?: Record<string, unknown>;
    priority?: number;
    runAfter?: string;
    dedupeKey?: string;
    maxAttempts?: number;
  }) => void;
  /** Structured LLM call bound to this agent/task for usage accounting. */
  ask: <T>(options: {
    operation: ChatRequest['operation'];
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    system: string;
    user: string;
    context?: Record<string, unknown>;
    fallback: () => T;
    temperature?: number;
  }) => Promise<{ data: T; usedFallback: boolean; response: ChatResponse }>;
  log: (message: string, detail?: unknown) => void;
}

export interface AgentDefinition {
  /** Stable id used in routing tables, the queue, and the UI. */
  name: string;
  label: string;
  description: string;
  /** Task types this agent accepts. */
  taskTypes: string[];
  handle: (task: AgentTask, ctx: AgentContext) => Promise<AgentResult>;
}

export class AgentLogger {
  constructor(private readonly agent: string, private readonly taskId: string) {}

  log(message: string, detail?: unknown): void {
    const suffix = detail === undefined ? '' : ` ${safeStringify(detail)}`;
    console.log(`[${this.agent}] ${message}${suffix}`);
  }
}

function safeStringify(value: unknown): string {
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    return json.length > 600 ? `${json.slice(0, 600)}…` : json;
  } catch {
    return String(value);
  }
}

/**
 * Records one agent execution. Every run is auditable: what triggered it, what
 * it decided, which model it used, what it cost, and how long it took.
 */
export function startRun(input: {
  agent: string;
  taskId: string;
  triggerEventId?: string | null;
  payload: Record<string, unknown>;
}): string {
  const id = uid('run');
  return id;
}

export interface RunHandle {
  id: string;
  agent: string;
  startedAt: number;
  finish: (result: AgentResult, usage: { tokensIn: number; tokensOut: number; costUsd: number; provider: string; model: string } | null) => void;
  fail: (error: unknown) => void;
}

export function createRunHandle(input: {
  db: Database;
  agent: string;
  taskId: string;
  triggerEventId?: string | null;
}): RunHandle {
  const id = uid('run');
  const startedAt = Date.now();
  const startedIso = nowIso();

  input.db.run(
    `INSERT INTO agent_runs (id, agent, task_id, status, trigger_event_id, input, started_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?)`,
    id,
    input.agent,
    input.taskId,
    input.triggerEventId ?? null,
    null,
    startedIso,
  );

  return {
    id,
    agent: input.agent,
    startedAt,
    finish: (result, usage) => {
      input.db.run(
        `UPDATE agent_runs SET status = ?, output = ?, provider = ?, model = ?, tokens_in = ?, tokens_out = ?,
                cost_usd = ?, latency_ms = ?, finished_at = ? WHERE id = ?`,
        result.status,
        JSON.stringify({ summary: result.summary, ...(result.data ?? {}) }),
        usage?.provider ?? null,
        usage?.model ?? null,
        usage?.tokensIn ?? 0,
        usage?.tokensOut ?? 0,
        usage?.costUsd ?? 0,
        Date.now() - startedAt,
        nowIso(),
        id,
      );
      bumpAgentState(input.db, input.agent, true, usage);
    },
    fail: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      input.db.run(
        `UPDATE agent_runs SET status = 'failed', error = ?, latency_ms = ?, finished_at = ? WHERE id = ?`,
        message.slice(0, 1000),
        Date.now() - startedAt,
        nowIso(),
        id,
      );
      bumpAgentState(input.db, input.agent, false, null);
    },
  };
}

function bumpAgentState(
  db: Database,
  agent: string,
  ok: boolean,
  usage: { tokensIn: number; tokensOut: number; costUsd: number } | null,
): void {
  db.run(
    `UPDATE agent_state
        SET status = 'idle', current_task_id = NULL, last_heartbeat = ?,
            processed_count = processed_count + ?,
            failed_count = failed_count + ?,
            total_tokens = total_tokens + ?,
            total_cost_usd = total_cost_usd + ?
      WHERE agent = ?`,
    nowIso(),
    ok ? 1 : 0,
    ok ? 0 : 1,
    (usage?.tokensIn ?? 0) + (usage?.tokensOut ?? 0),
    usage?.costUsd ?? 0,
    agent,
  );
}

export function ensureAgentState(
  db: Database,
  agent: { name: string; label: string },
): void {
  const existing = db.get('SELECT agent FROM agent_state WHERE agent = ?', agent.name);
  if (existing) return;
  db.run(
    `INSERT INTO agent_state (agent, label, status, processed_count, failed_count, total_tokens, total_cost_usd, enabled)
     VALUES (?, ?, 'idle', 0, 0, 0, 0, 1)`,
    agent.name,
    agent.label,
  );
}

export type { EventType };
