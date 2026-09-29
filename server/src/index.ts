import { config } from './core/config.js';
import { getDb } from './core/db.js';
import { getLlm } from './core/llm/service.js';
import { seedFxRates } from './core/pricing.js';
import { buildServer } from './api/server.js';
import { startOrchestrator } from './agents/orchestrator.js';
import { startEmailPoller } from './integrations/email.js';
import { maskSecret } from './core/util.js';

/**
 * DealTrack entrypoint.
 *
 * Boot order matters: database migrations first, then the orchestrator (so the
 * queue is being drained before any HTTP request can enqueue work), then the
 * HTTP server, then the integration pollers.
 */
async function main(): Promise<void> {
  const db = getDb();
  seedFxRates();

  const orchestrator = await startOrchestrator();
  const app = await buildServer();
  const stopEmail = startEmailPoller();

  const llm = getLlm().readiness();

  await app.listen({ host: config.host, port: config.port });

  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  DealTrack · 数字外贸团队已就绪');
  console.log(line);
  console.log(`  服务地址      http://localhost:${config.port}`);
  console.log(`  数据目录      ${config.dataDir}`);
  console.log(`  数据库        ${config.dbFile}`);
  console.log(`  API Token     ${maskToken(config.apiToken)}`);
  console.log(`  AI 模型       ${llm.provider} · ${llm.ready ? '就绪' : '未就绪（将回退离线引擎）'}`);
  if (!llm.ready) console.log(`                ${llm.reason}`);
  console.log(`  文档渲染      ${config.docs.chromePath ? 'Chrome 已就绪' : '未找到 Chrome（仅输出 HTML）'}`);
  console.log(`  邮件集成      ${config.integrations.email.enabled ? '已启用' : '未启用（邮件为模拟发送）'}`);
  console.log(`  WhatsApp     ${config.integrations.whatsapp.enabled ? '已启用' : '未启用（WhatsApp 为模拟发送）'}`);
  console.log(`${line}\n`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[dealtrack] 收到 ${signal}，正在优雅退出…`);
    stopEmail();
    await orchestrator.stop();
    await app.close();
    db.close();
    console.log('[dealtrack] 已安全退出。');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[dealtrack] unhandled rejection:', reason);
  });
}

function maskToken(token: string): string {
  return maskSecret(token);
}

main().catch((error) => {
  console.error('[dealtrack] 启动失败：', error);
  process.exit(1);
});
