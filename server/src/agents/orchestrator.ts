import { getDb } from '../core/db.js';
import { config } from '../core/config.js';
import { EVENTS, getBus, type DomainEvent, type EventType } from '../core/events.js';
import { getQueue, type AgentTask } from '../core/queue.js';
import { getLlm } from '../core/llm/service.js';
import { getAutomation } from '../core/settings.js';
import { nowIso, uid } from '../core/util.js';
import type { AgentContext, AgentDefinition, AgentResult } from './types.js';
import { createRunHandle, ensureAgentState } from './types.js';
import { salesAgent } from './sales.js';
import { followupAgent } from './followup.js';
import { customsAgent } from './customs.js';

/**
 * The orchestrator.
 *
 * Three jobs, deliberately kept in one file so the entire control flow of the
 * product is readable in a single sitting:
 *
 *   1. ROUTES      — event → work. Declarative, so adding a capability means
 *                    adding a row, not editing ten agents.
 *   2. WORKERS     — pull tasks off the durable queue and run the owning agent.
 *   3. SWEEPS      — timer-driven tasks that make the system *proactive*. This is
 *                    the difference between a CRM that waits to be opened and a
 *                    team that never forgets.
 */

export const AGENTS: AgentDefinition[] = [salesAgent, followupAgent, customsAgent];

export function getAgent(name: string): AgentDefinition | null {
  return AGENTS.find((agent) => agent.name === name) ?? null;
}

export function registerAgents(): void {
  const db = getDb();
  for (const agent of AGENTS) ensureAgentState(db, agent);
}

// ---------------------------------------------------------------------------
// 1. ROUTES
// ---------------------------------------------------------------------------

interface Route {
  on: EventType;
  agent: string;
  taskType: string;
  priority?: number;
  delayMinutes?: number;
  dedupe?: (event: DomainEvent) => string | null;
  when?: (event: DomainEvent) => boolean;
  payload?: (event: DomainEvent) => Record<string, unknown> | null;
}

const ROUTES: Route[] = [
  // ---- Inbound arrives: parse it, immediately ---------------------------
  {
    on: EVENTS.INQUIRY_RECEIVED,
    agent: 'sales',
    taskType: 'parse_inquiry',
    priority: 10,
    dedupe: (event) => `parse:${event.entityId}`,
    payload: (event) => ({ inquiryId: event.entityId }),
  },

  // ---- Parse finished: price it and draft the reply ---------------------
  {
    on: EVENTS.INQUIRY_PARSED,
    agent: 'sales',
    taskType: 'draft_quote_and_reply',
    priority: 20,
    when: () => getAutomation().draftQuotesAutomatically,
    dedupe: (event) => `draft_quote:${event.payload.inquiryId}`,
    payload: (event) => ({ inquiryId: event.payload.inquiryId }),
  },

  // ---- A reply or draft got approved: send it ---------------------------
  {
    on: EVENTS.MESSAGE_APPROVED,
    agent: 'sales',
    taskType: 'send_message',
    priority: 10,
    dedupe: (event) => `send:${event.payload.messageId}`,
    payload: (event) => ({ messageId: event.payload.messageId }),
  },

  // ---- Quote exists: lay down the follow-up cadence ---------------------
  {
    on: EVENTS.QUOTE_SENT,
    agent: 'followup',
    taskType: 'schedule_followups',
    priority: 60,
    dedupe: (event) => `schedule:${event.payload.quoteId}`,
    payload: (event) => ({ quoteId: event.payload.quoteId }),
  },
  {
    on: EVENTS.QUOTE_CREATED,
    agent: 'followup',
    taskType: 'schedule_followups',
    priority: 80,
    // The cadence is anchored on the quote going out; scheduling on creation
    // only matters for auto-send shops.
    when: () => getAutomation().autoSend,
    dedupe: (event) => `schedule:${event.payload.quoteId}`,
    payload: (event) => ({ quoteId: event.payload.quoteId }),
  },

  // ---- Customer wrote back: classify and react --------------------------
  {
    on: EVENTS.MESSAGE_RECEIVED,
    agent: 'sales',
    taskType: 'classify_inbound',
    priority: 5,
    dedupe: (event) => `classify:${event.payload.inquiryId}:${event.payload.messageId ?? 'na'}`,
    payload: (event) => ({ inquiryId: event.payload.inquiryId, body: event.payload.body }),
  },

  // ---- Won: issue the proforma invoice, then start customs work ---------
  {
    on: EVENTS.QUOTE_ACCEPTED,
    agent: 'sales',
    taskType: 'create_proforma',
    priority: 40,
    dedupe: (event) => `proforma:${event.payload.quoteId}`,
    payload: (event) => ({ quoteId: event.payload.quoteId }),
  },
  {
    on: EVENTS.QUOTE_ACCEPTED,
    agent: 'customs',
    taskType: 'draft_declaration',
    priority: 70,
    dedupe: (event) => `declaration:${event.payload.quoteId}`,
    payload: (event) => ({ quoteId: event.payload.quoteId }),
  },

  // ---- Lost: learn from it ---------------------------------------------
  {
    on: EVENTS.QUOTE_REJECTED,
    agent: 'sales',
    taskType: 'analyze_loss',
    priority: 120,
    payload: (event) => ({
      quoteId: event.payload.quoteId,
      note: String(event.payload.reasonCode ?? '') + ' ' + String(event.payload.note ?? ''),
    }),
  },

  // ---- Escalation helper ------------------------------------------------
  {
    on: EVENTS.CUSTOMER_SILENT,
    agent: 'followup',
    taskType: 'escalate',
    priority: 90,
    dedupe: (event) => `escalate:${event.entityId}`,
    payload: (event) => ({
      entityType: 'customer',
      entityId: event.entityId,
      topic: 'customer_silent',
      reason: `客户已沉默 ${event.payload.daysSilent ?? '?'} 天`,
      severity: 'warning',
    }),
  },
];

export function wireRoutes(): () => void {
  const bus = getBus();
  const queue = getQueue();
  const unsubscribers = ROUTES.map((route) =>
    bus.subscribe(route.on, (event) => {
      if (route.when && !route.when(event)) return;
      const payload = route.payload ? route.payload(event) : {};
      if (payload === null) return;
      queue.enqueue({
        agent: route.agent,
        taskType: route.taskType,
        payload,
        priority: route.priority,
        dedupeKey: route.dedupe ? (route.dedupe(event) ?? undefined) : undefined,
        eventId: event.id,
        correlationId: event.correlationId ?? event.id,
        runAfter: route.delayMinutes ? new Date(Date.now() + route.delayMinutes * 60_000).toISOString() : undefined,
      });
    }),
  );
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

// ---------------------------------------------------------------------------
// 2. WORKERS
// ---------------------------------------------------------------------------

export interface WorkerPool {
  stop: () => void;
  drain: () => Promise<void>;
  stats: () => { running: number; idle: number; processed: number; failed: number };
}

let pool: WorkerPool | null = null;

export function startWorkers(concurrency = config.workers.concurrency): WorkerPool {
  if (pool) return pool;
  let stopped = false;
  let processed = 0;
  let failed = 0;
  const active = new Set<string>();
  const workerIds = Array.from({ length: concurrency }, (_, index) => `worker-${index + 1}-${uid().slice(-6)}`);

  const loops = workerIds.map(async (workerId) => {
    while (!stopped) {
      const task = getQueue().claim(workerId);
      if (!task) {
        await sleep(config.workers.pollMs);
        continue;
      }
      active.add(task.id);
      try {
        const outcome = await runTask(task);
        if (outcome === 'failed') failed += 1;
        else processed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[orchestrator] unhandled task error ${task.id}`, error);
      } finally {
        active.delete(task.id);
      }
    }
  });

  pool = {
    stop: () => {
      stopped = true;
    },
    drain: async () => {
      for (let i = 0; i < 200 && active.size > 0; i += 1) await sleep(50);
    },
    stats: () => ({ running: active.size, idle: workerIds.length - active.size, processed, failed }),
  };

  void Promise.all(loops).catch(() => undefined);
  return pool;
}

export function stopWorkers(): void {
  pool?.stop();
  pool = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTask(task: AgentTask): Promise<'ok' | 'failed' | 'skipped'> {
  const agent = getAgent(task.agent);
  if (!agent) {
    getQueue().fail(task.id, new Error(`未知智能体 ${task.agent}`), false);
    return 'failed';
  }

  const db = getDb();
  const run = createRunHandle({ db, agent: agent.name, taskId: task.id, triggerEventId: task.eventId });
  db.run("UPDATE agent_state SET status = 'busy', current_task_id = ?, last_heartbeat = ? WHERE agent = ?", task.id, nowIso(), agent.name);

  const usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, provider: '', model: '' };
  const ctx = buildContext(task, usage);

  try {
    const result = await agent.handle(task, ctx);
    if (result.status === 'waiting_approval') {
      getQueue().waitForApproval(task.id, result.data ?? {});
    } else {
      getQueue().complete(task.id, { summary: result.summary, ...(result.data ?? {}) });
    }
    run.finish(result, usage.tokensIn > 0 ? usage : null);
    getBus().emitEvent({
      type: result.status === 'waiting_approval' ? EVENTS.AGENT_RUN_SUCCEEDED : EVENTS.AGENT_RUN_SUCCEEDED,
      actor: `agent:${agent.name}`,
      entityType: 'task',
      entityId: task.id,
      subject: result.summary,
      payload: { taskType: task.taskType, status: result.status, ...(result.data ?? {}) },
      correlationId: task.correlationId ?? undefined,
    });
    return 'ok';
  } catch (error) {
    const retryable = !(error instanceof Error && /^发送失败/.test(error.message));
    const updated = getQueue().fail(task.id, error, retryable);
    run.fail(error);
    return updated?.status === 'dead' ? 'failed' : 'ok';
  }
}

function buildContext(task: AgentTask, usage: { tokensIn: number; tokensOut: number; costUsd: number; provider: string; model: string }): AgentContext {
  const db = getDb();
  const bus = getBus();
  const queue = getQueue();
  const llm = getLlm();
  const trigger = task.eventId
    ? (db.get<Record<string, unknown>>('SELECT * FROM events WHERE id = ?', task.eventId) as Record<string, unknown> | undefined)
    : undefined;

  const triggerEvent: DomainEvent | null = trigger
    ? {
        id: String(trigger.id),
        seq: Number(trigger.seq ?? 0),
        type: String(trigger.type),
        actor: String(trigger.actor),
        entityType: (trigger.entity_type as string | null) ?? null,
        entityId: (trigger.entity_id as string | null) ?? null,
        subject: (trigger.subject as string | null) ?? null,
        payload: safeJson(String(trigger.payload ?? '{}')),
        correlationId: (trigger.correlation_id as string | null) ?? null,
        causationId: (trigger.causation_id as string | null) ?? null,
        createdAt: String(trigger.created_at),
      }
    : null;

  const correlationId = task.correlationId ?? triggerEvent?.correlationId ?? triggerEvent?.id ?? task.id;
  const agentName = task.agent;

  return {
    db,
    llm,
    bus,
    queue,
    task,
    trigger: triggerEvent,

    emit: (input) =>
      bus.emitEvent({
        ...input,
        actor: input.actor ?? `agent:${agentName}`,
        correlationId: input.correlationId ?? correlationId,
        causationId: task.eventId ?? undefined,
      }),

    schedule: (input) => {
      queue.enqueue({
        agent: input.agent,
        taskType: input.taskType,
        payload: input.payload,
        priority: input.priority,
        runAfter: input.runAfter,
        dedupeKey: input.dedupeKey,
        maxAttempts: input.maxAttempts,
        eventId: task.eventId ?? undefined,
        correlationId,
      });
    },

    ask: async (options) => {
      const result = await llm.json({
        operation: options.operation,
        schema: options.schema,
        system: options.system,
        user: options.user,
        context: options.context,
        fallback: options.fallback,
        temperature: options.temperature,
        agent: agentName,
        taskId: task.id,
      });
      usage.tokensIn += result.response.tokensIn;
      usage.tokensOut += result.response.tokensOut;
      usage.costUsd += result.response.costUsd;
      usage.provider = result.response.provider;
      usage.model = result.response.model;
      return { data: result.data, usedFallback: result.usedFallback, response: result.response };
    },

    log: (message, detail) => {
      const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}`;
      console.log(`[${agentName}] ${message}${suffix}`);
    },
  };
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 3. SWEEPS — what makes DealTrack proactive instead of a passive database
// ---------------------------------------------------------------------------

const SWEEPS: Array<{ name: string; everyMs: number; enqueue: () => void }> = [
  {
    name: 'followup.sweep',
    everyMs: 60_000,
    enqueue: () =>
      getQueue().enqueue({
        agent: 'followup',
        taskType: 'sweep_due',
        priority: 300,
        dedupeKey: 'sweep:due',
        announce: false,
      }),
  },
  {
    name: 'hs.backfill',
    everyMs: 30 * 60_000,
    enqueue: () =>
      getQueue().enqueue({
        agent: 'customs',
        taskType: 'classify_hs_codes',
        payload: { limit: 5 },
        priority: 800,
        dedupeKey: 'sweep:hs',
        announce: false,
      }),
  },
];

const timers: NodeJS.Timeout[] = [];

export function startSweeps(): void {
  for (const sweep of SWEEPS) {
    const timer = setInterval(() => {
      try {
        sweep.enqueue();
      } catch (error) {
        console.error(`[orchestrator] sweep ${sweep.name} failed`, error);
      }
    }, sweep.everyMs);
    timer.unref?.();
    timers.push(timer);
  }
  // Kick once on boot so a restart immediately re-checks for missed follow-ups.
  setTimeout(() => {
    try {
      SWEEPS[0]!.enqueue();
    } catch {
      /* ignore */
    }
  }, 1_500).unref?.();
}

export function stopSweeps(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}

// ---------------------------------------------------------------------------
// Boot / shutdown
// ---------------------------------------------------------------------------

export interface OrchestratorHandle {
  stop: () => Promise<void>;
}

export async function startOrchestrator(): Promise<OrchestratorHandle> {
  registerAgents();
  const unwire = wireRoutes();
  const workers = startWorkers();
  if (config.workers.enabled) startSweeps();

  console.log(
    `[orchestrator] ${AGENTS.length} 个智能体就绪：${AGENTS.map((a) => a.label).join(' / ')}（并发 ${config.workers.concurrency}）`,
  );

  return {
    stop: async () => {
      stopSweeps();
      unwire();
      workers.stop();
      await workers.drain();
    },
  };
}

/**
 * Human-triggered task. Used by the API for "do this now" buttons.
 *
 * `runNow` means *claim and run the queued task immediately*, never "enqueue a
 * second one". Without that distinction an API call races the event route it
 * just triggered: the endpoint enqueues `parse_inquiry`, the event bus enqueues
 * `parse_inquiry` for the same inquiry, and the agent runs twice — doubling LLM
 * spend and creating a window where two concurrent runs both decide to create a
 * customer or a quote.
 *
 * Always pass `dedupeKey` so the manual path and the event path collapse into
 * one task.
 */
export function dispatch(input: {
  agent: string;
  taskType: string;
  payload?: Record<string, unknown>;
  priority?: number;
  actor?: string;
  runNow?: boolean;
  dedupeKey?: string;
}): AgentTask | null {
  const queue = getQueue();
  const enqueued = queue.enqueue({
    agent: input.agent,
    taskType: input.taskType,
    payload: input.payload,
    priority: input.priority ?? 5,
    dedupeKey: input.dedupeKey,
  });

  // Either we created it, or the event route already did — both cases should end
  // with exactly one task, and `runNow` wants that one executed promptly.
  const task = enqueued ?? (input.dedupeKey ? queue.findByDedupe(input.dedupeKey) : null);
  if (!task) return null;

  if (input.runNow) {
    // Fire-and-forget: the manual path should feel instant, but the queue stays
    // the source of truth, so an interrupted run is still recoverable.
    const claimed = queue.claimById(task.id, `manual-${uid().slice(-6)}`);
    if (claimed) void runTask(claimed).catch(() => undefined);
  }
  return task;
}

export { EVENTS };
