import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from '../core/config.js';
import { getDb } from '../core/db.js';
import { registerAuth, registerSse, ok } from './context.js';
import { registerInboxRoutes } from './routes/inbox.js';
import { registerDealRoutes } from './routes/deals.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerBillingRoutes } from './routes/billing.js';

/**
 * The HTTP surface.
 *
 * Two deployment shapes are supported by the same binary:
 *
 *   - **API only** — `npm run dev` in `web/` talks to it over CORS.
 *   - **Single process** — `npm run build` then `npm start` serves the built SPA
 *     from `web/dist` at `/`, so the whole product is one `localhost:8787` URL.
 *     That's what the Android app and the desktop workflow both point at.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isProd
      ? { level: 'info' }
      : {
          level: 'warn',
          transport: undefined,
        },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    exposedHeaders: ['content-disposition'],
  });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });

  /**
   * Request correlation.
   *
   * Every response carries `x-request-id` and every log line includes it, so
   * "the quote PDF 500'd at 14:20" can be traced to one request instead of
   * grepping a wall of output. An inbound id is honoured, which means a proxy or
   * the Android client can supply its own and join the two sides up.
   */
  app.addHook('onRequest', async (request, reply) => {
    const inbound = String(request.headers['x-request-id'] ?? '').slice(0, 64);
    const id = /^[\w.:-]{6,64}$/.test(inbound) ? inbound : `req_${randomUUID().slice(0, 12)}`;
    (request as { requestId?: string }).requestId = id;
    reply.header('x-request-id', id);
  });

  /**
   * Structured request log.
   *
   * Logs the outcome and duration of anything slow or failing, plus every write.
   * Reads of the dashboard are deliberately excluded — they poll every few
   * seconds and would drown the signal.
   */
  app.addHook('onResponse', async (request, reply) => {
    const id = (request as { requestId?: string }).requestId ?? '-';
    const durationMs = Math.round(reply.elapsedTime);
    const isWrite = request.method !== 'GET';
    const failed = reply.statusCode >= 400;
    const slow = durationMs > 1000;
    if (!failed && !slow && !isWrite) return;

    const line = {
      level: failed ? (reply.statusCode >= 500 ? 'error' : 'warn') : 'info',
      requestId: id,
      method: request.method,
      url: request.url.split('?')[0],
      status: reply.statusCode,
      durationMs,
      msg: `${request.method} ${request.url.split('?')[0]} → ${reply.statusCode} (${durationMs}ms)`,
    };
    if (failed) app.log.error(line, 'request failed');
    else app.log.info(line);
  });

  registerAuth(app);
  registerSse(app);

  registerInboxRoutes(app);
  registerDealRoutes(app);
  registerSystemRoutes(app);
  registerBillingRoutes(app);

  // Serve the built SPA when it exists. This has to happen BEFORE the fallback
  // `/` route below, otherwise @fastify/static and the explicit handler fight
  // over the same path and Fastify refuses to boot.
  const distDir = webDistDir();
  if (distDir) {
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      decorateReply: true,
      // MUST stay true. With `wildcard: false` the plugin registers one route
      // per file found at boot, so any asset Vite emits with a fresh content
      // hash after a rebuild 404s — and the SPA fallback then answers with
      // index.html, which the browser rejects with a MIME type error. That is
      // a blank page with no obvious cause.
      wildcard: true,
      index: ['index.html'],
      setHeaders: (response, filePath) => {
        if (filePath.endsWith('.html')) {
          response.setHeader('cache-control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Content-hashed filenames — safe to cache forever.
          response.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else {
          response.setHeader('cache-control', 'public, max-age=3600');
        }
      },
    });

    // SPA fallback: anything that isn't an API call renders the app shell.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ ok: false, error: 'not_found', message: `未找到接口 ${request.url}` });
      }
      if (/\.[a-z0-9]+$/i.test(request.url.split('?')[0]!)) {
        // A missing asset must 404 loudly rather than return HTML.
        return reply.code(404).send({ ok: false, error: 'not_found', message: `静态资源不存在：${request.url}` });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (request, reply) => {
      return reply
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>DealTrack API</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;max-width:680px;margin:80px auto;padding:0 24px;line-height:1.7;color:#1c1f23}
code{background:#f2f5f8;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>DealTrack API</h1>
<p>服务已启动。前端构建产物尚未生成。</p>
<p>开发模式：另开终端运行 <code>npm run dev:web</code>，浏览器访问 <code>http://localhost:5173</code>。</p>
<p>生产模式：在项目根目录执行 <code>npm run build</code> 后重启本服务，即可在 <code>http://localhost:${config.port}</code> 直接使用完整界面。</p>
<p>健康检查：<code>GET /api/health</code></p></body></html>`,
        );
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ ok: false, error: 'not_found', message: `未找到接口 ${request.url}` });
      }
      return reply.code(404).send({ ok: false, error: 'not_found', message: '前端未构建，请运行 npm run build' });
    });
  }

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    app.log.error({ err: error, url: request.url }, 'request failed');
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(status).send({
      ok: false,
      error: status === 500 ? 'internal_error' : 'request_error',
      message: error.message || '服务器内部错误',
    });
  });

  return app;
}

function webDistDir(): string | null {
  const candidates = [
    path.join(config.rootDir, 'web', 'dist'),
    path.join(process.cwd(), '..', 'web', 'dist'),
    path.join(process.cwd(), 'web', 'dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export { getDb, ok };
