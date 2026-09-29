import { getDb, type Row } from './db.js';
import { config } from './config.js';
import { EVENTS, emit, type EventType } from './events.js';
import { addMinutes, nowIso, parseJson, uid } from './util.js';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead'
  | 'cancelled'
  | 'waiting_approval';

export interface AgentTask {
  id: string;
  agent: string;
  taskType: string;
  payload: Record<string, unknown>;
  priority: number;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
  runAfter: string | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
  eventId: string | null;
  correlationId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface EnqueueInput {
  agent: string;
  taskType: string;
  payload?: Record<string, unknown>;
  /** Lower number = picked first. 10 = interrupt, 100 = normal, 500 = housekeeping. */
  priority?: number;
  runAfter?: string;
  /** Collapses duplicate work, e.g. `parse:inquiry_123`. Unique while queued/running. */
  dedupeKey?: string;
  eventId?: string;
  correlationId?: string;
  maxAttempts?: number;
  /** Emit `task.enqueued` for the activity timeline. Default true. */
  announce?: boolean;
}

export function hydrateTask(row: Row): AgentTask {
  return {
    id: String(row.id),
    agent: String(row.agent),
    taskType: String(row.task_type),
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    priority: Number(row.priority ?? 100),
    status: String(row.status) as TaskStatus,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    dedupeKey: (row.dedupe_key as string | null) ?? null,
    runAfter: (row.run_after as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    result: row.result ? parseJson<Record<string, unknown>>(row.result, {}) : null,
    eventId: (row.event_id as string | null) ?? null,
    correlationId: (row.correlation_id as string | null) ?? null,
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
  };
}

/**
 * Durable work queue.
 *
 * A task is enqueued, claimed exactly once by a worker, and either succeeds or is
 * retried with exponential backoff until `maxAttempts`, then parked as `dead` and
 * surfaced in the UI. Nothing silently disappears — that is the promise behind
 * "不漏跟".
 */
export class TaskQueue {
  enqueue(input: EnqueueInput): AgentTask | null {
    const db = getDb();
    const id = uid('task');
    const at = nowIso();
    try {
      db.run(
        `INSERT INTO agent_tasks
           (id, agent, task_type, payload, priority, status, attempts, max_attempts,
            dedupe_key, run_after, event_id, correlation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.agent,
        input.taskType,
        JSON.stringify(input.payload ?? {}),
        input.priority ?? 100,
        input.maxAttempts ?? config.workers.maxAttempts,
        input.dedupeKey ?? null,
        input.runAfter ?? at,
        input.eventId ?? null,
        input.correlationId ?? null,
        at,
        at,
      );
    } catch (error) {
      // Unique dedupe index: identical work is already queued or running.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') || message.includes('constraint')) return null;
      throw error;
    }

    if (input.announce !== false) {
      emit({
        type: EVENTS.TASK_ENQUEUED,
        actor: 'system',
        entityType: 'task',
        entityId: id,
        subject: `${input.agent} ← ${input.taskType}`,
        payload: { agent: input.agent, taskType: input.taskType },
        correlationId: input.correlationId,
        causationId: input.eventId,
      });
    }
    return this.byId(id);
  }

  /** The queued/running task for a dedupe key, if one exists. */
  findByDedupe(dedupeKey: string): AgentTask | null {
    const row = getDb().get<Row>(
      `SELECT * FROM agent_tasks
        WHERE dedupe_key = ? AND status IN ('queued', 'running', 'waiting_approval')
        ORDER BY created_at DESC LIMIT 1`,
      dedupeKey,
    );
    return row ? hydrateTask(row) : null;
  }

  byId(id: string): AgentTask | null {
    const row = getDb().get<Row>('SELECT * FROM agent_tasks WHERE id = ?', id);
    return row ? hydrateTask(row) : null;
  }

  /**
   * Atomically claim the next runnable task. Also re-queues tasks whose worker
   * died (locked longer than 5 minutes) so a crash can't strand follow-ups.
   */
  claim(workerId: string): AgentTask | null {
    const db = getDb();
    const at = nowIso();
    return db.transaction(() => {
      db.run(
        `UPDATE agent_tasks SET status = 'queued', locked_at = NULL, locked_by = NULL,
                last_error = COALESCE(last_error, 'worker lost'),
                updated_at = ?
         WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?`,
        at,
        addMinutes(-5),
      );

      const row = db.get<Row>(
        `UPDATE agent_tasks
            SET status = 'running', attempts = attempts + 1, locked_at = ?, locked_by = ?,
                started_at = COALESCE(started_at, ?), updated_at = ?
          WHERE id = (
                SELECT id FROM agent_tasks
                 WHERE status = 'queued' AND (run_after IS NULL OR run_after <= ?)
                   AND agent IN (SELECT agent FROM agent_state WHERE enabled = 1)
                 ORDER BY priority ASC, created_at ASC LIMIT 1)
          RETURNING *`,
        at,
        workerId,
        at,
        at,
        at,
      );
      return row ? hydrateTask(row) : null;
    });
  }

  /** Claims one specific task, bypassing the priority order (manual "run now"). */
  claimById(id: string, workerId: string): AgentTask | null {
    const db = getDb();
    const at = nowIso();
    const row = db.get<Row>(
      `UPDATE agent_tasks
          SET status = 'running', attempts = attempts + 1, locked_at = ?, locked_by = ?,
              started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ? AND status = 'queued'
        RETURNING *`,
      at,
      workerId,
      at,
      at,
      id,
    );
    return row ? hydrateTask(row) : null;
  }

  complete(id: string, result: Record<string, unknown> = {}): void {
    const db = getDb();
    const at = nowIso();
    const task = this.byId(id);
    const durationMs = task?.startedAt ? new Date(at).getTime() - new Date(task.startedAt).getTime() : null;
    db.run(
      `UPDATE agent_tasks SET status = 'succeeded', result = ?, finished_at = ?, duration_ms = ?,
              updated_at = ?, locked_at = NULL, locked_by = NULL
        WHERE id = ?`,
      JSON.stringify(result),
      at,
      durationMs,
      at,
      id,
    );
  }

  /** Mark a task as awaiting a human decision (quote approval, send approval). */
  waitForApproval(id: string, result: Record<string, unknown> = {}): void {
    const db = getDb();
    const at = nowIso();
    db.run(
      `UPDATE agent_tasks SET status = 'waiting_approval', result = ?, finished_at = ?,
              updated_at = ?, locked_at = NULL, locked_by = NULL
        WHERE id = ?`,
      JSON.stringify(result),
      at,
      at,
      id,
    );
  }

  fail(id: string, error: unknown, retryable = true): AgentTask | null {
    const db = getDb();
    const task = this.byId(id);
    if (!task) return null;
    const message = error instanceof Error ? error.message : String(error);
    const at = nowIso();

    const shouldRetry = retryable && task.attempts < task.maxAttempts;
    if (shouldRetry) {
      // Exponential backoff: 30s, 2m, 8m …
      const backoffMinutes = 0.5 * 4 ** (task.attempts - 1);
      db.run(
        `UPDATE agent_tasks SET status = 'queued', last_error = ?, run_after = ?,
                updated_at = ?, locked_at = NULL, locked_by = NULL
          WHERE id = ?`,
        message.slice(0, 1000),
        addMinutes(backoffMinutes),
        at,
        id,
      );
      emit({
        type: EVENTS.AGENT_RUN_FAILED,
        actor: 'system',
        entityType: 'task',
        entityId: id,
        subject: `${task.agent} retry ${task.attempts}/${task.maxAttempts}`,
        payload: { error: message, willRetry: true },
        correlationId: task.correlationId ?? undefined,
      });
      return this.byId(id);
    }

    db.run(
      `UPDATE agent_tasks SET status = 'dead', last_error = ?, finished_at = ?, updated_at = ?,
              locked_at = NULL, locked_by = NULL
        WHERE id = ?`,
      message.slice(0, 1000),
      at,
      at,
      id,
    );
    emit({
      type: EVENTS.TASK_DEAD,
      actor: 'system',
      entityType: 'task',
      entityId: id,
      subject: `${task.agent} failed permanently`,
      payload: { error: message, attempts: task.attempts },
      correlationId: task.correlationId ?? undefined,
    });
    return this.byId(id);
  }

  cancel(id: string, reason = 'cancelled'): void {
    getDb().run(
      `UPDATE agent_tasks SET status = 'cancelled', last_error = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')`,
      reason,
      nowIso(),
      id,
    );
  }

  /** Cancel by dedupe key — used when a customer replies, killing pending nudges. */
  cancelByDedupe(dedupeKey: string, reason = 'cancelled'): number {
    const result = getDb().run(
      `UPDATE agent_tasks SET status = 'cancelled', last_error = ?, updated_at = ?
        WHERE dedupe_key = ? AND status IN ('queued', 'running')`,
      reason,
      nowIso(),
      dedupeKey,
    );
    return result.changes;
  }

  list(options: { status?: TaskStatus | 'all'; agent?: string; limit?: number } = {}): AgentTask[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.status && options.status !== 'all') {
      clauses.push('status = ?');
      params.push(options.status);
    }
    if (options.agent) {
      clauses.push('agent = ?');
      params.push(options.agent);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return getDb()
      .all<Row>(
        `SELECT * FROM agent_tasks ${where} ORDER BY created_at DESC LIMIT ?`,
        ...params,
        options.limit ?? 100,
      )
      .map(hydrateTask);
  }

  stats(): Record<string, number> {
    const db = getDb();
    const rows = db.all<Row>('SELECT status, COUNT(*) AS n FROM agent_tasks GROUP BY status');
    const out: Record<string, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      cancelled: 0,
      waiting_approval: 0,
    };
    for (const row of rows) out[String(row.status)] = Number(row.n);
    return out;
  }
}

let queue: TaskQueue | null = null;

export function getQueue(): TaskQueue {
  if (!queue) queue = new TaskQueue();
  return queue;
}

/** Convenience for agents: enqueue + keep the correlation chain intact. */
export function schedule(
  input: EnqueueInput & { type?: EventType },
): AgentTask | null {
  return getQueue().enqueue(input);
}
