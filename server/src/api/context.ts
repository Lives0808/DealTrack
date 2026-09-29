import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../core/db.js';
import { config } from '../core/config.js';
import { getSetting, SETTING_KEYS } from '../core/settings.js';
import { getBus, type DomainEvent } from '../core/events.js';
import { nowIso } from '../core/util.js';

/** Effective API token (Settings → Security can rotate it without a restart). */
export function apiToken(): string {
  return getSetting<string>(SETTING_KEYS.API_TOKEN, config.apiToken);
}

export function isAuthenticated(request: FastifyRequest): boolean {
  const header = String(request.headers.authorization ?? '');
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const viaHeader = bearer || String(request.headers['x-dealtrack-token'] ?? '');
  if (viaHeader.length > 0 && viaHeader === apiToken()) return true;

  // EventSource cannot set request headers, so the live stream accepts the token
  // as a query parameter — and only for that endpoint.
  const path = request.url.split('?')[0]!;
  if (path === '/api/stream' || path.startsWith('/api/stream?')) {
    const params = new URLSearchParams(request.url.split('?')[1] ?? '');
    const viaQuery = params.get('token') ?? '';
    return viaQuery.length > 0 && viaQuery === apiToken();
  }
  return false;
}

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/version',
  '/api/whatsapp/webhook',
  '/',
]);

export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/api/')) return; // static assets / SPA
    if (PUBLIC_PATHS.has(path)) return;
    if (isAuthenticated(request)) return;
    reply.code(401).send({
      ok: false,
      error: 'unauthorized',
      message: '缺少或无效的 API Token。请在请求头携带 Authorization: Bearer <token>。',
    });
  });
}

export function ok<T>(data: T, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: true, data, ...extra };
}

export function fail(message: string, code = 400, error = 'bad_request'): Record<string, unknown> {
  return { ok: false, error, message };
}

export function query<T extends Record<string, unknown>>(request: FastifyRequest): T {
  return (request.query ?? {}) as T;
}

export function body<T extends Record<string, unknown>>(request: FastifyRequest): T {
  return (request.body ?? {}) as T;
}

export function intParam(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function actorOf(request: FastifyRequest): string {
  const header = String(request.headers['x-dealtrack-actor'] ?? '');
  return header || 'user:api';
}

// ---------------------------------------------------------------------------
// Server-sent events — the live dashboard feed.
//
// The boss board needs to show agents going busy/idle in real time; polling every
// second would be wasteful and still feel laggy. One SSE stream, one connection.
// ---------------------------------------------------------------------------

interface SseClient {
  id: string;
  reply: FastifyReply;
  filter: (event: DomainEvent) => boolean;
}

const clients = new Map<string, SseClient>();
let sequence = 0;

export function registerSse(app: FastifyInstance): void {
  const bus = getBus();

  bus.subscribe('*', (event) => {
    if (clients.size === 0) return;
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of [...clients.values()]) {
      try {
        if (!client.filter(event)) continue;
        client.reply.raw.write(payload);
      } catch {
        clients.delete(client.id);
      }
    }
  });

  app.get('/api/stream', (request, reply) => {
    const filterParam = String(query<{ types?: string }>(request).types ?? '');
    const prefixes = filterParam
      ? filterParam.split(',').map((entry) => entry.trim()).filter(Boolean)
      : [];
    const filter = (event: DomainEvent) =>
      prefixes.length === 0 || prefixes.some((prefix) => event.type.startsWith(prefix.replace('*', '')));

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`retry: 3000\n\n`);

    const id = `sse_${++sequence}`;
    clients.set(id, { id, reply, filter });

    reply.raw.write(
      `event: hello\ndata: ${JSON.stringify({ id, at: nowIso(), agents: agentStatuses() })}\n\n`,
    );

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ at: nowIso(), agents: agentStatuses() })}\n\n`);
      } catch {
        clearInterval(heartbeat);
        clients.delete(id);
      }
    }, 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(id);
    });

    return reply;
  });
}

function agentStatuses(): Array<Record<string, unknown>> {
  try {
    return getDb()
      .all<Record<string, unknown>>('SELECT agent, label, status, processed_count, failed_count FROM agent_state')
      .map((row) => ({
        agent: row.agent,
        label: row.label,
        status: row.status,
        processed: Number(row.processed_count ?? 0),
        failed: Number(row.failed_count ?? 0),
      }));
  } catch {
    return [];
  }
}

export function sseClientCount(): number {
  return clients.size;
}
