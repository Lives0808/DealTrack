import { EventEmitter } from 'node:events';
import { getDb, type Row } from './db.js';
import { nowIso, parseJson, uid } from './util.js';

/**
 * The DealTrack event catalog.
 *
 * Rule of the codebase: **agents never call each other directly.** An agent does
 * its job, writes an event, and returns. The orchestrator decides who acts next.
 * That keeps agents independently testable, replayable, and safe to re-run —
 * which is what makes "不漏跟" (never miss a follow-up) achievable at all.
 */
export const EVENTS = {
  // Inbound
  INQUIRY_RECEIVED: 'inquiry.received',
  INQUIRY_PARSED: 'inquiry.parsed',
  INQUIRY_NEEDS_INFO: 'inquiry.needs_info',
  INQUIRY_STATUS_CHANGED: 'inquiry.status_changed',
  INQUIRY_ASSIGNED: 'inquiry.assigned',

  // Customers
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_SILENT: 'customer.silent',

  // Quoting
  QUOTE_CREATED: 'quote.created',
  QUOTE_UPDATED: 'quote.updated',
  QUOTE_SUBMITTED: 'quote.pending_approval',
  QUOTE_APPROVED: 'quote.approved',
  QUOTE_SENT: 'quote.sent',
  QUOTE_ACCEPTED: 'quote.accepted',
  QUOTE_REJECTED: 'quote.rejected',
  QUOTE_EXPIRED: 'quote.expired',

  // Messaging
  MESSAGE_DRAFTED: 'message.drafted',
  MESSAGE_APPROVED: 'message.approved',
  MESSAGE_SENT: 'message.sent',
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_FAILED: 'message.failed',

  // Follow-up
  FOLLOWUP_SCHEDULED: 'followup.scheduled',
  FOLLOWUP_DUE: 'followup.due',
  FOLLOWUP_DRAFTED: 'followup.drafted',
  FOLLOWUP_SENT: 'followup.sent',
  FOLLOWUP_REPLIED: 'followup.replied',
  FOLLOWUP_SNOOZED: 'followup.snoozed',
  FOLLOWUP_ESCALATED: 'followup.escalated',

  // Risk & collaboration
  RISK_LEAD_TIME: 'risk.lead_time',
  RISK_PAYMENT: 'risk.payment',
  RISK_STALLED: 'risk.stalled',
  THREAD_OPENED: 'thread.opened',
  THREAD_MESSAGE: 'thread.message',
  ALERT_CREATED: 'alert.created',
  SLA_AT_RISK: 'sla.at_risk',
  SLA_BREACHED: 'sla.breached',

  // Closing the deal: quote → PI → money → shipment
  QUOTE_PARTIAL_MATCH: 'quote.partial_match',
  PROFORMA_ISSUED: 'proforma.issued',
  PAYMENT_DUE: 'payment.due',
  PAYMENT_OVERDUE: 'payment.overdue',
  PAYMENT_RECEIVED: 'payment.received',
  PAYMENT_REMINDER_DRAFTED: 'payment.reminder_drafted',

  // Customs
  DECLARATION_DRAFTED: 'customs.declaration_drafted',
  COMPLIANCE_ISSUE: 'customs.compliance_issue',

  // Platform
  AGENT_RUN_STARTED: 'agent.run.started',
  AGENT_RUN_SUCCEEDED: 'agent.run.succeeded',
  AGENT_RUN_FAILED: 'agent.run.failed',
  TASK_ENQUEUED: 'task.enqueued',
  TASK_DEAD: 'task.dead',
} as const;

export type EventType = (typeof EVENTS)[keyof typeof EVENTS] | (string & {});

export interface DomainEvent {
  id: string;
  seq: number;
  type: EventType;
  actor: string;
  entityType?: string | null;
  entityId?: string | null;
  subject?: string | null;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
  createdAt: string;
}

export interface EmitInput {
  type: EventType;
  actor: string;
  entityType?: string;
  entityId?: string;
  subject?: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  /** Skip persistence for high-frequency, non-auditable chatter. */
  persist?: boolean;
}

type Handler = (event: DomainEvent) => void | Promise<void>;

interface Subscription {
  pattern: string;
  matcher: (type: string) => boolean;
  handler: Handler;
  id: number;
}

function makeMatcher(pattern: string): (type: string) => boolean {
  if (pattern === '*') return () => true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);
    return (type) => type.startsWith(prefix);
  }
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return (type) => type.startsWith(prefix);
  }
  return (type) => type === pattern;
}

/**
 * In-process pub/sub with a durable append-only log behind it.
 *
 * The log is what makes the system recoverable: if the process dies mid-flight,
 * `events` + `agent_tasks` are the record of what was supposed to happen, and the
 * worker pool picks the work back up on boot.
 */
export class EventBus extends EventEmitter {
  private subscriptions: Subscription[] = [];
  private nextId = 1;
  private seq = 0;

  emitEvent(input: EmitInput): DomainEvent {
    const db = getDb();
    const event: DomainEvent = {
      id: uid('evt'),
      seq: ++this.seq,
      type: input.type,
      actor: input.actor,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      subject: input.subject ?? null,
      payload: input.payload ?? {},
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
      createdAt: nowIso(),
    };

    if (input.persist !== false) {
      db.run(
        `INSERT INTO events (id, seq, type, actor, entity_type, entity_id, subject, payload, correlation_id, causation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        event.seq,
        event.type,
        event.actor,
        event.entityType,
        event.entityId,
        event.subject,
        JSON.stringify(event.payload),
        event.correlationId,
        event.causationId,
        event.createdAt,
      );
    }

    for (const sub of this.subscriptions) {
      if (!sub.matcher(event.type)) continue;
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          result.catch((error) => {
            this.emit('handler:error', { error, event, pattern: sub.pattern });
          });
        }
      } catch (error) {
        this.emit('handler:error', { error, event, pattern: sub.pattern });
      }
    }
    return event;
  }

  /** Subscribe to `type`, a `prefix.*` pattern, or `*` for everything. */
  subscribe(type: EventType | '*', handler: Handler): () => void {
    const subscription: Subscription = {
      pattern: type,
      matcher: makeMatcher(type),
      handler,
      id: this.nextId++,
    };
    this.subscriptions.push(subscription);
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s.id !== subscription.id);
    };
  }

  /** Recent events, newest first — powers the UI activity timeline. */
  recent(limit = 50, filter?: { type?: string; entityId?: string }): DomainEvent[] {
    const db = getDb();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) {
      clauses.push('type LIKE ?');
      params.push(`${filter.type.replace('*', '')}%`);
    }
    if (filter?.entityId) {
      clauses.push('entity_id = ?');
      params.push(filter.entityId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.all<Row>(
      `SELECT * FROM events ${where} ORDER BY created_at DESC, seq DESC LIMIT ?`,
      ...params,
      limit,
    );
    return rows.map(hydrateEvent);
  }

  forEntity(entityType: string, entityId: string, limit = 100): DomainEvent[] {
    const db = getDb();
    return db
      .all<Row>(
        `SELECT * FROM events WHERE entity_type = ? AND entity_id = ?
         ORDER BY created_at ASC, seq ASC LIMIT ?`,
        entityType,
        entityId,
        limit,
      )
      .map(hydrateEvent);
  }

  countSince(iso: string, typePrefix?: string): number {
    const db = getDb();
    return typePrefix
      ? db.count('SELECT COUNT(*) FROM events WHERE created_at >= ? AND type LIKE ?', iso, `${typePrefix}%`)
      : db.count('SELECT COUNT(*) FROM events WHERE created_at >= ?', iso);
  }
}

export function hydrateEvent(row: Row): DomainEvent {
  return {
    id: String(row.id),
    seq: Number(row.seq ?? 0),
    type: String(row.type),
    actor: String(row.actor),
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    correlationId: (row.correlation_id as string | null) ?? null,
    causationId: (row.causation_id as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

let bus: EventBus | null = null;

export function getBus(): EventBus {
  if (!bus) {
    bus = new EventBus();
    bus.on('handler:error', (info: unknown) => {
      const { error, event } = info as { error: unknown; event: DomainEvent };
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[events] handler failed for ${event.type}: ${message}`);
    });
  }
  return bus;
}

export const emit = (input: EmitInput): DomainEvent => getBus().emitEvent(input);
