import type { FastifyInstance, FastifyReply } from 'fastify';
import { getDb } from '../../core/db.js';
import { config } from '../../core/config.js';
import { getBus, EVENTS } from '../../core/events.js';
import { getQueue, type TaskStatus } from '../../core/queue.js';
import { getLlm } from '../../core/llm/service.js';
import { MODEL_COSTS, PROVIDER_DEFAULTS, type ProviderId } from '../../core/llm/types.js';
import {
  DEFAULT_AUTOMATION,
  DEFAULT_COMPANY,
  DEFAULT_SALES,
  SETTING_KEYS,
  describeIntegrations,
  getAutomation,
  getCompany,
  getLlmApiKey,
  getLlmSettings,
  getSalesIdentity,
  setLlmApiKey,
  setSetting,
} from '../../core/settings.js';
import { DEFAULT_FX, getFxRate, seedFxRates, upsertFxRate } from '../../core/pricing.js';
import { addDays, daysBetween, nowIso, parseJson } from '../../core/util.js';
import { lossAnalytics, listQuotes } from '../../core/repos/quoting.js';
import { followupStats, listAlerts, acknowledgeAlert, listThreads, getThread, appendThreadMessage, listPlaybooks } from '../../core/repos/engagement.js';
import { getCustomer, listInquiries, updateInquiry } from '../../core/repos/sales.js';
import { listUsers, upsertUser } from '../../core/repos/catalog.js';
import { getProduct, listProducts, matchProducts, upsertProduct, upsertTier } from '../../core/repos/catalog.js';
import { verifyEmailConfig } from '../../integrations/messaging.js';
import { z } from 'zod';
import { syncEmailInbox } from '../../integrations/email.js';
import { AGENTS, dispatch, getAgent } from '../../agents/orchestrator.js';
import { actorOf, body, fail, intParam, ok, query, sseClientCount } from '../context.js';
import { ProductInput, TierInput, UserInput, dropNulls, validate } from '../validate.js';

export function registerSystemRoutes(app: FastifyInstance): void {
  // =========================================================================
  // Health & meta
  // =========================================================================

  app.get('/api/health', async (request) => {
    const db = getDb();
    return ok({
      status: 'ok',
      at: nowIso(),
      requestId: (request as { requestId?: string }).requestId ?? null,
      database: {
        file: config.dbFile,
        events: db.count('SELECT COUNT(*) FROM events'),
        tasks: db.count('SELECT COUNT(*) FROM agent_tasks'),
      },
      llm: getLlm().readiness(),
      workers: getQueue().stats(),
      integrations: integrationFlags(),
      sseClients: sseClientCount(),
    });
  });

  app.get('/api/version', async () => ok({ name: 'DealTrack', version: '0.1.0', schema: 1 }));

  // =========================================================================
  // Overview (老板看板)
  // =========================================================================

  app.get('/api/overview', async (request) => {
    const params = query<{ days?: string }>(request);
    const days = intParam(params.days, 30);
    const since = addDays(-days);
    const db = getDb();
    const automation = getAutomation();

    // --- Speed: the headline metric the whole product exists to move ------
    const speed = db.get<Record<string, unknown>>(
      `SELECT COUNT(*) AS responded,
              AVG(first_response_seconds) AS avg_seconds,
              MIN(first_response_seconds) AS best_seconds
         FROM inquiries
        WHERE first_response_at IS NOT NULL AND first_response_at >= ?`,
      since,
    );

    const baselineSeconds = config.baselineMinutesPerReply * 60;
    const targetSeconds = config.targetMinutesPerReply * 60;
    const avgSeconds = Number(speed?.avg_seconds ?? 0);
    const responded = Number(speed?.responded ?? 0);

    // --- Funnel -----------------------------------------------------------
    const funnel = {
      received: db.count('SELECT COUNT(*) FROM inquiries WHERE received_at >= ?', since),
      parsed: db.count("SELECT COUNT(*) FROM inquiries WHERE status != 'new' AND received_at >= ?", since),
      quoted: db.count('SELECT COUNT(*) FROM quotes WHERE created_at >= ?', since),
      sent: db.count('SELECT COUNT(*) FROM quotes WHERE sent_at IS NOT NULL AND sent_at >= ?', since),
      won: db.count("SELECT COUNT(*) FROM quote_outcomes WHERE result = 'won' AND decided_at >= ?", since),
      lost: db.count("SELECT COUNT(*) FROM quote_outcomes WHERE result = 'lost' AND decided_at >= ?", since),
      noResponse: db.count("SELECT COUNT(*) FROM quote_outcomes WHERE result = 'no_response' AND decided_at >= ?", since),
    };

    const pipeline = db.get<Record<string, unknown>>(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('sent','pending_approval') THEN total ELSE 0 END), 0) AS open_value,
              COALESCE(SUM(CASE WHEN status IN ('sent','pending_approval') THEN total * COALESCE(margin_pct, 0) ELSE 0 END), 0) AS open_margin,
              COUNT(*) AS total_quotes
         FROM quotes WHERE created_at >= ?`,
      since,
    );

    const tracked = db.get<Record<string, unknown>>(
      `SELECT SUM(CASE WHEN first_response_at IS NOT NULL THEN 1 ELSE 0 END) AS responded,
              SUM(CASE WHEN first_response_at IS NULL AND received_at >= ? THEN 1 ELSE 0 END) AS pending
         FROM inquiries WHERE received_at >= ?`,
      addHoursAgo(automation.escalateAfterHours),
      since,
    );

    const minutesSaved =
      responded > 0 ? ((baselineSeconds - avgSeconds) / 60) * responded : 0;

    return ok({
      range: { days, since, until: nowIso() },
      kpi: {
        avgFirstResponseMinutes: Number((avgSeconds / 60).toFixed(1)),
        targetMinutes: config.targetMinutesPerReply,
        baselineMinutes: config.baselineMinutesPerReply,
        bestFirstResponseMinutes: Number((Number(speed?.best_seconds ?? 0) / 60).toFixed(1)),
        responded,
        pendingReply: Number(tracked?.pending ?? 0),
        minutesSaved: Math.round(minutesSaved),
        hoursSaved: Number((minutesSaved / 60).toFixed(1)),
        speedupFactor:
          avgSeconds > 0 ? Number((baselineSeconds / avgSeconds).toFixed(1)) : config.baselineMinutesPerReply / config.targetMinutesPerReply,
      },
      funnel: {
        ...funnel,
        quoteRate: funnel.received > 0 ? Number((funnel.quoted / funnel.received).toFixed(3)) : 0,
        winRate: funnel.won + funnel.lost > 0 ? Number((funnel.won / (funnel.won + funnel.lost)).toFixed(3)) : 0,
        conversion: funnel.received > 0 ? Number((funnel.won / funnel.received).toFixed(3)) : 0,
      },
      pipeline: {
        openValue: Number(pipeline?.open_value ?? 0),
        openMargin: Number(pipeline?.open_margin ?? 0),
        totalQuotes: Number(pipeline?.total_quotes ?? 0),
      },
      agents: agentBoard(),
      followups: followupStats(),
      risks: {
        alerts: db.count('SELECT COUNT(*) FROM alerts WHERE acknowledged = 0'),
        openThreads: db.count("SELECT COUNT(*) FROM threads WHERE status = 'open'"),
        pendingApprovals: db.count("SELECT COUNT(*) FROM outbound_messages WHERE status = 'pending_approval'"),
        slaAtRisk: db.count(
          "SELECT COUNT(*) FROM inquiries WHERE first_response_at IS NULL AND status IN ('new','parsed') AND received_at < ?",
          addHoursAgo(automation.escalateAfterHours),
        ),
        expiringQuotes: db.count(
          "SELECT COUNT(*) FROM quotes WHERE status IN ('sent','pending_approval') AND valid_until IS NOT NULL AND valid_until <= ?",
          addDays(3),
        ),
        deadTasks: db.count("SELECT COUNT(*) FROM agent_tasks WHERE status = 'dead'"),
      },
      loss: lossAnalytics(since),
      llm: {
        ...getLlm().usageSummary(since),
        provider: getLlmSettings().provider,
        readiness: getLlm().readiness(),
      },
      tasks: getQueue().stats(),
    });
  });

  /** Time-series for the dashboard charts. */
  app.get('/api/overview/timeseries', async (request) => {
    const params = query<{ days?: string }>(request);
    const days = intParam(params.days, 30);
    const db = getDb();

    const inquiries = db.all<Record<string, unknown>>(
      `SELECT substr(received_at, 1, 10) AS day, COUNT(*) AS n
         FROM inquiries WHERE received_at >= ? GROUP BY day ORDER BY day`,
      addDays(-days),
    );
    const quotes = db.all<Record<string, unknown>>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n, COALESCE(SUM(total), 0) AS value
         FROM quotes WHERE created_at >= ? GROUP BY day ORDER BY day`,
      addDays(-days),
    );
    const wins = db.all<Record<string, unknown>>(
      `SELECT substr(decided_at, 1, 10) AS day, COUNT(*) AS n, COALESCE(SUM(final_price), 0) AS value
         FROM quote_outcomes WHERE result = 'won' AND decided_at >= ? GROUP BY day ORDER BY day`,
      addDays(-days),
    );
    const responses = db.all<Record<string, unknown>>(
      `SELECT substr(first_response_at, 1, 10) AS day, AVG(first_response_seconds) AS avg_seconds, COUNT(*) AS n
         FROM inquiries WHERE first_response_at IS NOT NULL AND first_response_at >= ?
        GROUP BY day ORDER BY day`,
      addDays(-days),
    );

    return ok({ inquiries, quotes, wins, responses });
  });

  // =========================================================================
  // Agents (智能体）
  // =========================================================================

  app.get('/api/agents', async () => ok(agentBoard()));

  app.get('/api/agents/health', async () => {
    const readiness = getLlm().readiness();
    return ok({
      llm: readiness,
      agents: agentBoard().map((agent) => ({
        ...agent,
        ok: agent.status !== 'error',
      })),
      queue: getQueue().stats(),
    });
  });

  app.get('/api/agents/tasks', async (request) => {
    const params = query<{ status?: string; agent?: string; limit?: string }>(request);
    return ok(
      getQueue().list({
        status: (params.status as TaskStatus | 'all' | undefined) ?? 'all',
        agent: params.agent,
        limit: intParam(params.limit, 100),
      }),
    );
  });

  app.get('/api/agents/runs', async (request) => {
    const params = query<{ agent?: string; limit?: string }>(request);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.agent) {
      clauses.push('agent = ?');
      values.push(params.agent);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = getDb().all<Record<string, unknown>>(
      `SELECT * FROM agent_runs ${where} ORDER BY started_at DESC LIMIT ?`,
      ...values,
      intParam(params.limit, 100),
    );
    return ok(
      rows.map((row) => ({
        id: row.id,
        agent: row.agent,
        taskId: row.task_id,
        status: row.status,
        input: parseJson(row.input, null),
        output: parseJson(row.output, null),
        provider: row.provider,
        model: row.model,
        tokensIn: Number(row.tokens_in ?? 0),
        tokensOut: Number(row.tokens_out ?? 0),
        costUsd: Number(row.cost_usd ?? 0),
        latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
        error: row.error,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      })),
    );
  });

  app.post('/api/agents/run', async (request, reply) => {
    const input = body<{ agent?: string; taskType?: string; payload?: Record<string, unknown>; runNow?: boolean }>(request);
    if (!input.agent || !input.taskType) return reply.code(400).send(fail('agent 与 taskType 必填'));
    const definition = getAgent(input.agent);
    if (!definition) return reply.code(404).send(fail(`未知智能体 ${input.agent}`, 404, 'not_found'));
    if (!definition.taskTypes.includes(input.taskType)) {
      return reply.code(400).send(fail(`${input.agent} 不支持任务 ${input.taskType}`));
    }
    const task = dispatch({
      agent: input.agent,
      taskType: input.taskType,
      payload: input.payload,
      runNow: input.runNow !== false,
      actor: actorOf(request),
    });
    return ok({ taskId: task?.id ?? null, deduped: task === null });
  });

  app.post('/api/agents/:agent/toggle', async (request, reply) => {
    const { agent } = request.params as { agent: string };
    const input = body<{ enabled?: boolean }>(request);
    const db = getDb();
    const existing = db.get<Record<string, unknown>>('SELECT enabled FROM agent_state WHERE agent = ?', agent);
    if (!existing) return reply.code(404).send(fail('智能体不存在', 404, 'not_found'));
    const enabled = input.enabled ?? Number(existing.enabled) !== 1;
    db.run('UPDATE agent_state SET enabled = ?, status = ? WHERE agent = ?', enabled ? 1 : 0, enabled ? 'idle' : 'paused', agent);
    return ok({ agent, enabled });
  });

  // =========================================================================
  // Events & activity
  // =========================================================================

  app.get('/api/events', async (request) => {
    const params = query<{ limit?: string; type?: string; entityId?: string }>(request);
    return ok(getBus().recent(intParam(params.limit, 100), { type: params.type, entityId: params.entityId }));
  });

  // =========================================================================
  // Threads (业务对齐群) & alerts
  // =========================================================================

  app.get('/api/threads', async (request) => {
    const params = query<{ status?: string; limit?: string }>(request);
    const threads = listThreads({ status: params.status ?? 'open', limit: intParam(params.limit, 100) });
    return ok(
      threads.map((thread) => ({
        ...thread,
        messageCount: getDb().count('SELECT COUNT(*) FROM thread_messages WHERE thread_id = ?', thread.id),
      })),
    );
  });

  app.get('/api/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = getThread(id);
    if (!thread) return reply.code(404).send(fail('对齐群不存在', 404, 'not_found'));
    return ok(thread);
  });

  app.post('/api/threads/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = getThread(id, false);
    if (!thread) return reply.code(404).send(fail('对齐群不存在', 404, 'not_found'));
    const input = body<{ body?: string; author?: string }>(request);
    if (!input.body) return reply.code(400).send(fail('消息内容必填'));
    appendThreadMessage(thread.id, { author: actorOf(request), role: 'human', body: input.body });
    return ok(getThread(thread.id));
  });

  app.post('/api/threads/:id/resolve', async (request) => {
    const { id } = request.params as { id: string };
    getDb().run("UPDATE threads SET status = 'resolved', updated_at = ? WHERE id = ?", nowIso(), id);
    return ok({ id, status: 'resolved' });
  });

  app.get('/api/alerts', async (request) => {
    const params = query<{ openOnly?: string; limit?: string }>(request);
    return ok(listAlerts({ openOnly: params.openOnly !== 'false', limit: intParam(params.limit, 100) }));
  });

  app.post('/api/alerts/:id/ack', async (request) => {
    const { id } = request.params as { id: string };
    acknowledgeAlert(id, actorOf(request));
    return ok({ id, acknowledged: true });
  });

  // =========================================================================
  // Analytics
  // =========================================================================

  app.get('/api/analytics/loss', async (request) => {
    const params = query<{ since?: string; days?: string }>(request);
    const since = params.since ?? addDays(-intParam(params.days, 90));
    return ok(lossAnalytics(since));
  });

  app.get('/api/analytics/speed', async (request) => {
    const params = query<{ days?: string }>(request);
    const since = addDays(-intParam(params.days, 30));
    const db = getDb();
    const byChannel = db.all<Record<string, unknown>>(
      `SELECT channel, COUNT(*) AS n, AVG(first_response_seconds) AS avg_seconds
         FROM inquiries WHERE first_response_at IS NOT NULL AND first_response_at >= ?
        GROUP BY channel`,
      since,
    );
    const byLanguage = db.all<Record<string, unknown>>(
      `SELECT COALESCE(language,'unknown') AS language, COUNT(*) AS n, AVG(first_response_seconds) AS avg_seconds
         FROM inquiries WHERE first_response_at IS NOT NULL AND first_response_at >= ?
        GROUP BY language ORDER BY n DESC LIMIT 12`,
      since,
    );
    const baseline = config.baselineMinutesPerReply * 60;
    const totalResponded = byChannel.reduce((sum, row) => sum + Number(row.n), 0);
    const totalSeconds = byChannel.reduce((sum, row) => sum + Number(row.avg_seconds ?? 0) * Number(row.n), 0);
    const average = totalResponded > 0 ? totalSeconds / totalResponded : 0;

    return ok({
      since,
      baselineMinutes: config.baselineMinutesPerReply,
      targetMinutes: config.targetMinutesPerReply,
      averageMinutes: Number((average / 60).toFixed(2)),
      responded: totalResponded,
      minutesSaved: Math.round(((baseline - average) / 60) * totalResponded),
      byChannel: byChannel.map((row) => ({
        channel: row.channel,
        count: Number(row.n),
        avgMinutes: Number((Number(row.avg_seconds ?? 0) / 60).toFixed(2)),
      })),
      byLanguage: byLanguage.map((row) => ({
        language: row.language,
        count: Number(row.n),
        avgMinutes: Number((Number(row.avg_seconds ?? 0) / 60).toFixed(2)),
      })),
    });
  });

  app.get('/api/analytics/agents', async (request) => {
    const params = query<{ days?: string }>(request);
    const since = addDays(-intParam(params.days, 30));
    const db = getDb();
    const byAgent = db.all<Record<string, unknown>>(
      `SELECT agent,
              COUNT(*) AS runs,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              AVG(latency_ms) AS avg_ms,
              COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM agent_runs WHERE started_at >= ? GROUP BY agent`,
      since,
    );
    return ok({
      since,
      byAgent: byAgent.map((row) => ({
        agent: row.agent,
        label: AGENTS.find((agent) => agent.name === row.agent)?.label ?? String(row.agent),
        runs: Number(row.runs),
        failed: Number(row.failed),
        avgLatencyMs: Math.round(Number(row.avg_ms ?? 0)),
        tokens: Number(row.tokens),
        costUsd: Number(row.cost ?? 0),
      })),
      llm: getLlm().usageSummary(since),
    });
  });

  // =========================================================================
  // Products
  // =========================================================================

  app.get('/api/products', async (request) => {
    const params = query<{ status?: string; category?: string; search?: string; withTiers?: string; limit?: string }>(request);
    const products = listProducts({
      status: params.status ?? 'all',
      category: params.category,
      search: params.search,
      limit: intParam(params.limit, 500),
    });
    return ok(
      products.map((product) => ({
        ...product,
        tiers: product.tiers,
      })),
    );
  });

  app.get('/api/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = getProduct(id, true);
    if (!product) return reply.code(404).send(fail('产品不存在', 404, 'not_found'));
    return ok({
      ...product,
      quotes: getDb()
        .all<Record<string, unknown>>(
          `SELECT q.id, q.quote_no, q.currency, q.total, q.status, q.created_at, qi.qty, qi.unit_price, c.company
             FROM quote_items qi
             JOIN quotes q ON q.id = qi.quote_id
             LEFT JOIN customers c ON c.id = q.customer_id
            WHERE qi.product_id = ? ORDER BY q.created_at DESC LIMIT 30`,
          product.id,
        )
        .map((row) => ({
          quoteId: row.id,
          quoteNo: row.quote_no,
          currency: row.currency,
          total: Number(row.total),
          status: row.status,
          createdAt: row.created_at,
          qty: Number(row.qty),
          unitPrice: Number(row.unit_price),
          customer: row.company,
        })),
    });
  });

  app.post('/api/products', async (request, reply) => {
    const payload = body<Record<string, unknown>>(request);
    const input = validate(ProductInput, payload, reply);
    if (!input) return reply;
    const tiers = validateTiers(payload.tiers, reply);
    if (tiers === null) return reply;

    const product = upsertProduct(dropNulls(input));
    for (const tier of tiers) upsertTier({ ...tier, productId: product.id });
    return reply.code(201).send(ok(getProduct(product.id, true)));
  });

  app.patch('/api/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getProduct(id, false);
    if (!existing) return reply.code(404).send(fail('产品不存在', 404, 'not_found'));

    const payload = body<Record<string, unknown>>(request);
    const patch = validate(ProductInput.partial(), payload, reply);
    if (!patch) return reply;
    const tiers = validateTiers(payload.tiers, reply);
    if (tiers === null) return reply;

    const product = upsertProduct({
      ...dropNulls(patch),
      id: existing.id,
      sku: patch.sku ?? existing.sku,
      nameEn: patch.nameEn ?? existing.nameEn,
    });
    for (const tier of tiers) upsertTier({ ...tier, productId: product.id });
    return ok(getProduct(product.id, true));
  });

  app.post('/api/products/match', async (request) => {
    const input = body<{ query?: string; destination?: string }>(request);
    if (!input.query) return fail('query 必填', 400);
    return ok(
      matchProducts(input.query, { destination: input.destination, limit: 8 }).map((entry) => ({
        product: entry.product,
        score: entry.score,
        matchedOn: entry.matchedOn,
      })),
    );
  });

  // =========================================================================
  // FX & pricing rules
  // =========================================================================

  app.get('/api/fx', async () => {
    const rows = getDb().all<Record<string, unknown>>('SELECT * FROM fx_rates ORDER BY base, quote');
    return ok({
      rates: rows.length > 0 ? rows : Object.entries(DEFAULT_FX).map(([pair, rate]) => {
        const [base, quote] = pair.split('>');
        return { base, quote, rate, updated_at: null };
      }),
      resolve: (() => {
        const out: Record<string, number> = {};
        for (const currency of ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'BRL', 'INR', 'AED', 'RUB', 'KRW', 'MXN', 'TRY']) {
          out[currency] = getFxRate('CNY', currency);
        }
        return out;
      })(),
    });
  });

  app.put('/api/fx', async (request, reply) => {
    const input = body<{ base?: string; quote?: string; rate?: number }>(request);
    if (!input.base || !input.quote || !input.rate) return reply.code(400).send(fail('base、quote、rate 必填'));
    upsertFxRate(input.base, input.quote, input.rate);
    return ok({ base: input.base, quote: input.quote, rate: input.rate });
  });

  app.post('/api/fx/reseed', async () => {
    seedFxRates();
    return ok({ reseeded: true, count: Object.keys(DEFAULT_FX).length });
  });

  // =========================================================================
  // Settings
  // =========================================================================

  app.get('/api/settings', async () => {
    return ok({
      company: getCompany(),
      sales: getSalesIdentity(),
      automation: getAutomation(),
      llm: getLlmSettings(),
      integrations: describeIntegrations(),
      providers: Object.entries(PROVIDER_DEFAULTS).map(([id, meta]) => ({
        id,
        label: meta.label,
        defaultModel: meta.model,
        defaultBaseUrl: meta.baseUrl,
        requiresApiKey: meta.requiresApiKey,
        hasApiKey: getLlmApiKey(id as ProviderId).length > 0,
      })),
      models: MODEL_COSTS,
      paths: {
        dataDir: config.dataDir,
        dbFile: config.dbFile,
        exportDir: config.exportDir,
        chromePath: config.docs.chromePath,
      },
    });
  });

  app.put('/api/settings', async (request) => {
    const input = body<{
      company?: Record<string, unknown>;
      sales?: Record<string, unknown>;
      automation?: Record<string, unknown>;
      llm?: { provider?: string; model?: string; baseUrl?: string; temperature?: number; apiKey?: string };
    }>(request);

    if (input.company) setSetting(SETTING_KEYS.COMPANY, { ...getCompany(), ...input.company });
    if (input.sales) setSetting(SETTING_KEYS.SALES, { ...getSalesIdentity(), ...input.sales });
    if (input.automation) setSetting(SETTING_KEYS.AUTOMATION, { ...getAutomation(), ...input.automation });
    if (input.llm) {
      const current = getLlmSettings();
      setSetting(SETTING_KEYS.LLM, {
        provider: input.llm.provider ?? current.provider,
        model: input.llm.model ?? current.model,
        baseUrl: input.llm.baseUrl ?? current.baseUrl,
        temperature: input.llm.temperature ?? current.temperature,
      });
      if (input.llm.apiKey !== undefined) {
        setLlmApiKey((input.llm.provider ?? current.provider) as ProviderId, input.llm.apiKey);
      }
    }

    return ok({
      company: getCompany(),
      sales: getSalesIdentity(),
      automation: getAutomation(),
      llm: getLlmSettings(),
      integrations: describeIntegrations(),
    });
  });

  app.post('/api/settings/reset', async (request) => {
    const input = body<{ section?: 'company' | 'sales' | 'automation' | 'all' }>(request);
    const section = input.section ?? 'all';
    if (section === 'company' || section === 'all') setSetting(SETTING_KEYS.COMPANY, DEFAULT_COMPANY);
    if (section === 'sales' || section === 'all') setSetting(SETTING_KEYS.SALES, DEFAULT_SALES);
    if (section === 'automation' || section === 'all') setSetting(SETTING_KEYS.AUTOMATION, DEFAULT_AUTOMATION);
    return ok({ section, reset: true });
  });

  app.put('/api/settings/integrations', async (request) => {
    const input = body<{
      email?: Record<string, unknown> & { password?: string };
      whatsapp?: Record<string, unknown> & { accessToken?: string };
      ocr?: Record<string, unknown> & { apiKey?: string };
    }>(request);

    if (input.email) {
      const { password, ...rest } = input.email;
      setSetting(SETTING_KEYS.EMAIL, { ...(getDb().get<Record<string, unknown>>('SELECT value FROM settings WHERE key = ?', SETTING_KEYS.EMAIL) ? JSON.parse(String(getDb().get<Record<string, unknown>>('SELECT value FROM settings WHERE key = ?', SETTING_KEYS.EMAIL)!.value)) : {}), ...rest });
      if (password !== undefined) setSetting(SETTING_KEYS.EMAIL_PASSWORD, password, { secret: true });
    }
    if (input.whatsapp) {
      const { accessToken, ...rest } = input.whatsapp;
      setSetting(SETTING_KEYS.WHATSAPP, rest);
      if (accessToken !== undefined) setSetting(SETTING_KEYS.WHATSAPP_TOKEN, accessToken, { secret: true });
    }
    if (input.ocr) {
      const { apiKey, ...rest } = input.ocr;
      setSetting(SETTING_KEYS.OCR, rest);
      if (apiKey !== undefined) setSetting(SETTING_KEYS.OCR_KEY, apiKey, { secret: true });
    }

    return ok(describeIntegrations());
  });

  app.post('/api/settings/test/email', async () => ok(await verifyEmailConfig()));

  app.post('/api/settings/test/llm', async () => {
    const llm = getLlm();
    const readiness = llm.readiness();
    if (!readiness.ready) return ok({ ok: false, detail: readiness.reason, provider: readiness.provider });

    const started = Date.now();
    try {
      const response = await llm.chat({
        messages: [
          { role: 'system', content: 'Reply with exactly: OK' },
          { role: 'user', content: 'Connectivity check from DealTrack.' },
        ],
        operation: 'generic',
        maxTokens: 16,
      });
      return ok({
        ok: true,
        provider: response.provider,
        model: response.model,
        latencyMs: Date.now() - started,
        sample: response.text.slice(0, 120),
        synthetic: response.synthetic,
      });
    } catch (error) {
      return ok({ ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/settings/rotate-token', async (request) => {
    const input = body<{ token?: string }>(request);
    const token = input.token?.trim() || randomToken();
    if (token.length < 16) return fail('Token 至少 16 位', 400);
    setSetting(SETTING_KEYS.API_TOKEN, token);
    return ok({ token, detail: '已生效。请在 App 与脚本中更新 Token。' });
  });

  // =========================================================================
  // Email sync (manual trigger) & users
  // =========================================================================

  app.post('/api/integrations/email/sync', async () => {
    const result = await syncEmailInbox({ limit: 25 });
    return ok(result);
  });

  app.get('/api/users', async () => ok(listUsers()));

  app.post('/api/users', async (request, reply) => {
    const input = validate(UserInput, request.body, reply);
    if (!input) return reply;
    return reply.code(201).send(ok(upsertUser({ ...dropNulls(input), email: input.email || undefined })));
  });
}

// ---------------------------------------------------------------------------

/** Tiers arrive nested inside the product payload; validate them separately. */
function validateTiers(raw: unknown, reply: FastifyReply): Array<z.infer<typeof TierInput>> | null {
  if (raw === undefined || raw === null) return [];
  const parsed = z.array(TierInput).max(20).safeParse(raw);
  if (parsed.success) return parsed.data;
  reply.code(400).send({
    ok: false,
    error: 'validation_error',
    message: `价格阶梯校验失败：${parsed.error.issues.map((issue) => `#${issue.path.join('.')} ${issue.message}`).join('；')}`,
  });
  return null;
}

function addHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function integrationFlags(): Record<string, unknown> {
  const integrations = describeIntegrations();
  const email = integrations.email as Record<string, unknown>;
  const whatsapp = integrations.whatsapp as Record<string, unknown>;
  const ocr = integrations.ocr as Record<string, unknown>;
  return {
    email: { enabled: email.enabled, configured: email.hasPassword && Boolean(email.smtpHost) },
    whatsapp: { enabled: whatsapp.enabled, configured: whatsapp.hasAccessToken },
    ocr: { enabled: ocr.enabled, configured: ocr.hasKey ?? ocr.hasApiKey },
  };
}

export function agentBoard(): Array<{
  agent: string;
  label: string;
  description: string;
  status: string;
  enabled: boolean;
  processed: number;
  failed: number;
  totalTokens: number;
  totalCostUsd: number;
  currentTaskId: string | null;
  lastHeartbeat: string | null;
  averageLatencyMs: number;
  queueDepth: number;
  lastRunAt: string | null;
  successRate: number;
  taskTypes: string[];
}> {
  const db = getDb();
  return AGENTS.map((definition) => {
    const state = db.get<Record<string, unknown>>('SELECT * FROM agent_state WHERE agent = ?', definition.name);
    const stats = db.get<Record<string, unknown>>(
      `SELECT COUNT(*) AS runs,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              AVG(latency_ms) AS avg_ms,
              MAX(started_at) AS last_at
         FROM agent_runs WHERE agent = ?`,
      definition.name,
    );
    const runs = Number(stats?.runs ?? 0);
    const failed = Number(stats?.failed ?? 0);
    return {
      agent: definition.name,
      label: definition.label,
      description: definition.description,
      status: String(state?.status ?? 'idle'),
      enabled: Number(state?.enabled ?? 1) === 1,
      processed: Number(state?.processed_count ?? 0),
      failed: Number(state?.failed_count ?? 0),
      totalTokens: Number(state?.total_tokens ?? 0),
      totalCostUsd: Number(state?.total_cost_usd ?? 0),
      currentTaskId: (state?.current_task_id as string | null) ?? null,
      lastHeartbeat: (state?.last_heartbeat as string | null) ?? null,
      averageLatencyMs: Math.round(Number(stats?.avg_ms ?? 0)),
      queueDepth: db.count("SELECT COUNT(*) FROM agent_tasks WHERE agent = ? AND status = 'queued'", definition.name),
      lastRunAt: (stats?.last_at as string | null) ?? null,
      successRate: runs > 0 ? Number(((runs - failed) / runs).toFixed(3)) : 1,
      taskTypes: definition.taskTypes,
    };
  });
}

export { listPlaybooks, getCustomer, listInquiries, updateInquiry, listQuotes, daysBetween, EVENTS };
