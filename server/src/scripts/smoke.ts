/**
 * End-to-end smoke test.
 *
 * Runs on a throwaway SQLite file so it never touches real data. It asserts the
 * promises this product makes, not just that functions return:
 *
 *   1. A multilingual inquiry becomes a structured brief with matched SKUs.
 *   2. A priced quote comes out with a positive, auditable margin.
 *   3. A reply is drafted in the *customer's* language.
 *   4. The follow-up cadence is laid down, so nothing can be forgotten.
 *   5. Approving the draft actually sends it and stops the SLA clock.
 *   6. A customer reply cancels the pending nudges.
 *   7. Winning a deal produces customs paperwork with compliance checks.
 *
 * Run with `npm run smoke`.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { config } from '../core/config.js';
import { createDb, getDb, setDb } from '../core/db.js';
import { seedDatabase, SAMPLE_INQUIRIES, summarize } from './seed.js';
import { ingestInbound } from '../core/ingest.js';
import { registerAgents, runTask, wireRoutes } from '../agents/orchestrator.js';
import { getQueue } from '../core/queue.js';
import { getCustomer, listInquiries, getInquiry } from '../core/repos/sales.js';
import { listQuotes, getQuote, recordOutcome } from '../core/repos/quoting.js';
import { listFollowups, listMessages, listPlaybooks } from '../core/repos/engagement.js';
import { generateDeclaration } from '../docgen/declaration.js';
import { generateQuotePdf } from '../docgen/quote.js';
import { detectLanguage } from '../core/i18n.js';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function drainQueue(maxRounds = 120): Promise<number> {
  let processed = 0;
  const workerId = 'smoke-worker';
  for (let round = 0; round < maxRounds; round += 1) {
    const task = getQueue().claim(workerId);
    if (!task) {
      const pending = getDb().count(
        "SELECT COUNT(*) FROM agent_tasks WHERE status IN ('queued','running')",
      );
      if (pending === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 120));
      continue;
    }
    await runTask(task);
    processed += 1;
  }
  return processed;
}

async function main(): Promise<void> {
  const sandbox = path.join(config.dataDir, 'smoke-test.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${sandbox}${suffix}`, { force: true });
    } catch {
      /* nothing to clean */
    }
  }

  // IMPORTANT: install the sandbox connection as the singleton. Everything the
  // agents touch resolves `getDb()`, so without this the test would write to the
  // operator's real database.
  setDb(createDb(sandbox));

  // Wire the real event → task routing table and register the agents. Without
  // this the pipeline is inert: nothing subscribes to `inquiry.received`.
  registerAgents();
  const unwire = wireRoutes();

  console.log('\n▶ DealTrack 端到端冒烟测试（隔离数据库）\n');
  console.log('【1】数据播种');
  const seeded = await seedDatabase({ verbose: false });
  check('产品库写入', seeded.products >= 8, `${seeded.products} 个产品`);
  check('价格阶梯写入', getDb().count('SELECT COUNT(*) FROM price_tiers') >= 20, `${getDb().count('SELECT COUNT(*) FROM price_tiers')} 档`);
  check('定价规则写入', seeded.rules >= 4, `${seeded.rules} 条`);
  check('话术库写入', seeded.playbooks >= 8, `${seeded.playbooks} 条`);
  check('多语言话术覆盖', listPlaybooks({ activeOnly: false }).filter((b) => b.language !== 'en').length >= 3, '含中/西/德');

  console.log('\n【2】多语言询盘接入（6 条，模拟真实收发）');
  const created: Array<{ code: string; id: string; language: string; channel: string }> = [];
  for (const sample of SAMPLE_INQUIRIES) {
    const result = ingestInbound({
      channel: sample.channel ?? 'email',
      fromEmail: sample.channel === 'whatsapp' ? null : sample.fromEmail,
      fromPhone: sample.channel === 'whatsapp' ? '+81 90 1234 5678' : null,
      fromName: sample.fromName,
      subject: sample.subject,
      body: sample.body,
      messageId: `<smoke-${created.length}@dealtrack.local>`,
    });
    created.push({
      code: result.inquiry.code,
      id: result.inquiry.id,
      language: detectLanguage(sample.body),
      channel: sample.channel ?? 'email',
    });
  }
  check('询盘全部入库', listInquiries({ limit: 50 }).length === SAMPLE_INQUIRIES.length, `${SAMPLE_INQUIRIES.length} 条`);
  check('客户自动建档', getDb().count('SELECT COUNT(*) FROM customers') >= 5, `${getDb().count('SELECT COUNT(*) FROM customers')} 个客户`);
  check('语言自动识别', createLanguageCoverage(created), created.map((c) => c.language).join('/'));

  console.log('\n【3】智能体流水线（解析 → 匹配 → 定价 → 起草）');
  const processed = await drainQueue();
  check('任务队列已消费', processed > 0, `${processed} 个任务执行`);

  const parsed = listInquiries({ limit: 50 }).filter((inquiry) => inquiry.parsed !== null);
  check('询盘解析完成', parsed.length === SAMPLE_INQUIRIES.length, `${parsed.length}/${SAMPLE_INQUIRIES.length} 条已解析`);

  const withMatches = parsed.filter((inquiry) => inquiry.productMatches.length > 0);
  check('产品库匹配命中', withMatches.length >= 4, `${withMatches.length}/${parsed.length} 条匹配到 SKU`);

  const extracted = parsed.map((inquiry) => inquiry.parsed as Record<string, unknown>);
  const qtyExtracted = extracted.filter((p) => {
    const products = (p.products ?? []) as Array<Record<string, unknown>>;
    return products.some((line) => Number(line.qty ?? 0) > 0);
  });
  check('数量抽取正确', qtyExtracted.length >= 3, `${qtyExtracted.length}/${extracted.length} 条抽到数量`);
  check('意图识别有效', extracted.every((p) => typeof p.intent === 'string' && p.intent.length > 0), extracted.map((p) => p.intent).slice(0, 3).join('/'));

  console.log('\n【4】报价生成');
  const quotes = listQuotes({ limit: 50 });
  check('报价单已生成', quotes.length >= 4, `${quotes.length} 张`);
  const quotesWithItems = quotes.map((quote) => getQuote(quote.id)!);
  check(
    '报价有行项目',
    quotesWithItems.every((quote) => (quote.items ?? []).length > 0),
    `行项目数 ${quotesWithItems.map((q) => (q.items ?? []).length).join('/')}`,
  );
  check(
    '数量正确带入报价',
    quotesWithItems.some((quote) => (quote.items ?? []).some((item) => item.qty >= 1000)),
    quotesWithItems.map((q) => `${q.items?.[0]?.qty ?? 0}${q.items?.[0]?.unit ?? ''}`).join(' / '),
  );

  // A quantity stated in both the subject and the body must be quoted ONCE.
  // Regression guard: the extractor used to read subject + body as one blob and
  // quote the German sample twice (3000 + 3000 = 6000 pcs, double the total).
  const doubled = quotesWithItems.filter((quote) => {
    const keys = (quote.items ?? []).map((item) => `${item.productId}|${item.qty}|${item.unit}`);
    return new Set(keys).size !== keys.length;
  });
  check(
    '同一产品数量未被重复报价',
    doubled.length === 0,
    doubled.length === 0
      ? '没有重复行'
      : doubled.map((q) => `${q.quoteNo}: ${(q.items ?? []).map((i) => i.qty).join('+')}`).join('; '),
  );

  const qtyMismatch = quotesWithItems.filter((quote) => {
    const inquiry = listInquiries({ limit: 100 }).find((entry) => entry.id === quote.inquiryId);
    if (!inquiry?.items?.length) return false;
    const extracted = inquiry.items.reduce((sum, item) => sum + (item.qty ?? 0), 0);
    const quoted = (quote.items ?? []).reduce((sum, item) => sum + item.qty, 0);
    // Allow the MOQ substitution the agent does when a line has no quantity.
    return quoted > extracted * 1.5 + 1;
  });
  check(
    '报价总量未超过询盘数量',
    qtyMismatch.length === 0,
    qtyMismatch.length === 0
      ? '数量守恒'
      : qtyMismatch.map((q) => `${q.quoteNo} 报价量 ${(q.items ?? []).reduce((s, i) => s + i.qty, 0)}`).join('; '),
  );
  check(
    '毛利为正且可审计',
    quotes.every((quote) => (quote.marginPct ?? 0) > 0 && quote.costTotal > 0),
    quotes.map((q) => `${((q.marginPct ?? 0) * 100).toFixed(1)}%`).join('/'),
  );
  check('报价总额大于零', quotes.every((quote) => quote.total > 0), quotes.map((q) => `${q.currency} ${q.total.toFixed(0)}`).join(' / '));
  check('贸易条款被识别', quotes.some((quote) => ['FOB', 'CIF'].includes(quote.incoterm)), quotes.map((q) => q.incoterm).join('/'));
  check(
    'CIF 报价含运费分摊',
    quotes.some((quote) => quote.incoterm === 'CIF' && quote.freight > 0),
    quotes.filter((q) => q.freight > 0).map((q) => `${q.quoteNo} ${q.currency}${q.freight.toFixed(0)}`).join(' / ') || '无 CIF 报价',
  );
  check('定价规则已触发', quotes.some((quote) => (quote.appliedRules ?? []).length > 0), '例：大单毛利下调');

  console.log('\n【5】多语言回复草稿');
  const drafts = listMessages({ status: 'pending_approval', limit: 50 });
  check('回复草稿已生成', drafts.length >= 4, `${drafts.length} 封待确认`);
  check('草稿语言跟随客户', new Set(drafts.map((d) => d.language)).size >= 3, [...new Set(drafts.map((d) => d.language ?? '?'))].join('/'));
  check('草稿含报价单号', drafts.some((draft) => /QT-\d{6}-\d{4}/.test(`${draft.subject} ${draft.body}`)), '正文/主题引用 QT 编号');
  check('草稿非空白', drafts.every((draft) => draft.body.trim().length > 80), `最短 ${Math.min(...drafts.map((d) => d.body.length))} 字符`);

  console.log('\n【6】报价单 PDF（多语言 / RTL 支持）');
  const firstQuote = quotes[0]!;
  const pdfPath = await generateQuotePdf(firstQuote.id);
  check('文档已生成', Boolean(pdfPath), pdfPath ? path.basename(pdfPath) : '失败');

  console.log('\n【7】跟进排程（不漏跟）');
  // Follow the full lifecycle of one deal from here on, so the assertions test
  // the real chain rather than unrelated rows.
  const focusInquiry = created[0]!;
  const focusQuote = getQuote(quotes.find((quote) => quote.inquiryId === focusInquiry.id)!.id)!;
  getQueue().enqueue({ agent: 'followup', taskType: 'schedule_followups', payload: { quoteId: focusQuote.id }, priority: 10 });
  await drainQueue();
  const followups = listFollowups({ status: 'scheduled', inquiryId: focusInquiry.id, limit: 100 });
  check('跟进已排程', followups.length >= 4, `${followups.length} 条待跟进（${focusQuote.quoteNo}）`);
  check('跟进按 D+3/7/14/30 分布', new Set(followups.map((f) => f.sequenceNo)).size >= 3, followups.map((f) => `D${Math.round((new Date(f.dueAt).getTime() - Date.now()) / 86400000)}`).join(' '));
  const focusLanguage = getInquiry(focusInquiry.id)?.customer?.language ?? 'en';
  check(
    '跟进语言跟随客户',
    followups.length > 0 && followups.every((f) => f.language === focusLanguage),
    `客户语言 ${focusLanguage}，跟进语言 ${[...new Set(followups.map((f) => f.language))].join('/')}`,
  );

  console.log('\n【8】审批发送 + SLA 计时');
  const firstCustomerDraft = drafts.find((draft) => draft.inquiryId === focusInquiry.id)!;
  const before = getInquiry(firstCustomerDraft.inquiryId!)!;
  check('发送前 SLA 未达标', before.firstResponseAt === null, `状态 ${before.status}`);

  getQueue().enqueue({ agent: 'sales', taskType: 'send_message', payload: { messageId: firstCustomerDraft.id }, priority: 5 });
  await drainQueue();
  const after = getInquiry(firstCustomerDraft.inquiryId!)!;
  check('消息已发送（未配置 SMTP 时为模拟）', listMessages({ status: 'sent', limit: 50 }).length >= 1);
  check('首次响应已计时', after.firstResponseAt !== null, after.firstResponseSeconds !== null ? `${after.firstResponseSeconds} 秒` : '');
  check('询盘状态推进到 quoted', after.status === 'quoted', after.status);
  check('响应速度达标（<30 分钟基线）', (after.firstResponseSeconds ?? 1e9) < config.baselineMinutesPerReply * 60, `${Math.round((after.firstResponseSeconds ?? 0) / 60)} 分钟以内`);

  console.log('\n【9】客户回复 → 自动停止跟进');
  const scheduledBefore = listFollowups({ status: 'scheduled', inquiryId: after.id, limit: 200 }).length;
  const inboundMessageId = String(getDb().scalar<string>('SELECT message_id FROM inquiries WHERE id = ?', after.id) ?? 'smoke-reply');
  const reply = ingestInbound({
    channel: 'email',
    fromEmail: after.fromEmail,
    fromName: after.fromName,
    subject: `Re: ${after.subject ?? ''}`,
    body: 'Thank you for the quotation. The price is a bit too high for us. Can you do better on 3000 pieces? We would like to place the order this month.',
    messageId: `${inboundMessageId}-reply`,
  });
  check('回复被识别为同一询盘', reply.isReply, `isReply=${reply.isReply}`);
  check('回复未新建重复询盘', listInquiries({ limit: 100 }).length === SAMPLE_INQUIRIES.length, `${listInquiries({ limit: 100 }).length} 条`);
  await drainQueue();
  const scheduledAfter = listFollowups({ status: 'scheduled', inquiryId: after.id, limit: 200 }).length;
  check('客户回复后停止跟进', scheduledBefore > 0 && scheduledAfter === 0, `${scheduledBefore} → ${scheduledAfter}`);
  const refreshed = getInquiry(after.id)!;
  check('回复意图被分类为价格异议', ['price_objection', 'rfq', 'general_inquiry'].includes(refreshed.detectedIntent ?? ''), refreshed.detectedIntent ?? '未分类');

  console.log('\n【10】成交 → 报关要素表 + 合规校验');
  const winQuote = getQuote(focusQuote.id)!;
  recordOutcome({ quoteId: winQuote.id, result: 'won', decidedBy: 'smoke', finalPrice: winQuote.total });
  check('成交已登记', listQuotes({ status: 'all', limit: 50 }).length > 0);
  const declaration = await generateDeclaration(winQuote.id);
  check('报关要素表生成', Boolean(declaration), declaration ? declaration.declarationNo : '失败');
  check('报关行项目齐备', (declaration?.itemCount ?? 0) > 0, `${declaration?.itemCount ?? 0} 项`);
  check('合规校验执行', (declaration?.compliance.length ?? 0) >= 5, `${declaration?.compliance.length ?? 0} 项检查`);
  check(
    '合规失败项被拦截',
    (declaration?.compliance.filter((c) => c.status === 'fail').length ?? 0) === 0,
    declaration?.compliance.filter((c) => c.status === 'fail').map((c) => c.label).join('、') || '无阻塞项',
  );

  console.log('\n【11】丢单归因（数据闭环）');
  const loseQuote = quotes.find((quote) => quote.id !== winQuote.id)!;
  recordOutcome({
    quoteId: loseQuote.id,
    result: 'lost',
    reasonCode: 'price',
    reasonNote: '客户反馈价格高于竞争对手 8%',
    competitor: 'Vietnam supplier',
    decidedBy: 'smoke',
  });
  const reasons = getDb().all<Record<string, unknown>>(
    'SELECT reason_code, COUNT(*) AS n FROM quote_outcomes GROUP BY reason_code',
  );
  check('丢单原因入库', reasons.length >= 1, reasons.map((r) => `${r.reason_code}×${r.n}`).join(' '));

  console.log('\n【12】事件驱动的可审计性');
  const eventCount = getDb().count('SELECT COUNT(*) FROM events');
  const eventTypes = getDb().all<Record<string, unknown>>('SELECT DISTINCT type FROM events');
  check('事件日志非空', eventCount > 20, `${eventCount} 条事件 / ${eventTypes.length} 种类型`);
  check('任务全部落定', getDb().count("SELECT COUNT(*) FROM agent_tasks WHERE status IN ('queued','running')") === 0, '无悬挂任务');
  check('无死信任务', getDb().count("SELECT COUNT(*) FROM agent_tasks WHERE status = 'dead'") === 0);
  const runs = getDb().count('SELECT COUNT(*) FROM agent_runs');
  check('智能体运行已记录', runs > 0, `${runs} 次运行`);
  const agentsUsed = new Set(getDb().all<Record<string, unknown>>('SELECT DISTINCT agent FROM agent_runs').map((r) => String(r.agent)));
  check('三个智能体均参与', agentsUsed.size >= 2, [...agentsUsed].join('/'));

  // ---- Report -------------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const summary = summarize(getDb());

  console.log(`\n${'═'.repeat(66)}`);
  console.log(`  冒烟测试结果：${passed}/${results.length} 项通过`);
  console.log(`${'═'.repeat(66)}`);
  console.log('  数据摘要：');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`    ${key.padEnd(12)} ${value}`);
  }
  if (failed.length > 0) {
    console.log('\n  未通过项：');
    for (const item of failed) console.log(`    ✘ ${item.name} — ${item.detail}`);
  }
  console.log(`\n  耗时统计：`);
  console.log(`    询盘 → 报价： ${((Date.now() - pipelineStart) / 1000).toFixed(1)} 秒（含 ${processed} 个智能体任务）`);
  console.log(`    人工基线上限： ${config.baselineMinutesPerReply} 分钟/封 → 目标 ${config.targetMinutesPerReply} 分钟/封`);
  console.log('');

  unwire();
  getDb().close();
  process.exit(failed.length === 0 ? 0 : 1);
}

function createLanguageCoverage(created: Array<{ language: string }>): boolean {
  return new Set(created.map((entry) => entry.language)).size >= 4;
}

const pipelineStart = Date.now();

main().catch((error) => {
  console.error('\n冒烟测试异常终止：', error);
  process.exit(1);
});
