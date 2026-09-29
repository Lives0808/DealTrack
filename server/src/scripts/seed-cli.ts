/**
 * Seed CLI: `npm run seed [-- --with-samples] [--reset]`
 *
 * Writes the demo product library, pricing rules and playbook library, and
 * optionally injects six multilingual sample inquiries and runs them through the
 * real agent pipeline so the dashboard has something to show.
 */
import { getDb } from '../core/db.js';
import { seedDatabase, seedSampleInquiries, summarize } from './seed.js';
import { startOrchestrator } from '../agents/orchestrator.js';
import { config } from '../core/config.js';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const withSamples = args.has('--with-samples') || args.has('--samples');
  const reset = args.has('--reset');

  const db = getDb();

  if (reset) {
    console.log('▶ --reset：清空业务数据（保留设置与密钥）…');
    db.transaction(() => {
      for (const table of [
        'thread_messages', 'threads', 'alerts', 'attachments', 'llm_usage',
        'agent_runs', 'agent_tasks', 'events', 'outbound_messages', 'followups',
        'quote_outcomes', 'quote_items', 'quotes', 'inquiry_items', 'inquiries',
        'customers', 'sync_state',
      ]) {
        db.run(`DELETE FROM ${table}`);
      }
    });
  }

  const result = await seedDatabase();
  console.log(`\n✔ 基础数据完成：${result.products} 产品 / ${result.playbooks} 话术 / ${result.rules} 定价规则 / ${result.users} 成员`);

  if (withSamples) {
    const orchestrator = await startOrchestrator();
    console.log('\n▶ 注入 6 条多语言真实询盘，并交给智能体流水线…\n');
    const created = await seedSampleInquiries();
    for (const item of created) {
      console.log(`  · ${item.code}  ${item.label}`);
    }

    // Let the pipeline drain. The parse → price → draft chain is several hops.
    const deadline = Date.now() + 45_000;
    let last = -1;
    while (Date.now() < deadline) {
      const stats = getDb().count("SELECT COUNT(*) FROM agent_tasks WHERE status IN ('queued','running')");
      const quotes = getDb().count('SELECT COUNT(*) FROM quotes');
      const drafts = getDb().count("SELECT COUNT(*) FROM outbound_messages WHERE status = 'pending_approval'");
      if (stats === 0 && quotes > 0 && drafts > 0 && stats === last) break;
      last = stats;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }

    await orchestrator.stop();
    const summary = summarize(getDb());
    console.log(`\n✔ 流水线跑完：${summary.quotes} 张报价单已生成`);
  }

  console.log(`\n${'─'.repeat(32)}`);
  console.log('数据摘要：');
  for (const [key, value] of Object.entries(summarize(getDb()))) {
    console.log(`  ${key.padEnd(12)} ${value}`);
  }
  console.log(`\n数据库文件：${config.dbFile}`);
  console.log('启动服务：npm start（或 npm run dev）\n');
  getDb().close();
}

main().catch((error) => {
  console.error('seed 失败：', error);
  process.exit(1);
});
