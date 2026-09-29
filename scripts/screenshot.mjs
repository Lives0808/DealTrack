#!/usr/bin/env node
/**
 * Screenshot the running DealTrack console.
 *
 * Uses the Chrome DevTools Protocol directly instead of `--screenshot`, because
 * the console holds an open SSE connection to `/api/stream`. Chrome's simple
 * `--screenshot` flag waits for network idle, and an event stream never goes
 * idle — so the naive approach hangs forever. CDP captures on demand instead.
 *
 *   node scripts/screenshot.mjs                       # 默认截图到 docs/screenshots/
 *   node scripts/screenshot.mjs --url http://localhost:8787 --out /tmp/shots
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = argValue('--url', 'http://localhost:8787');
const OUT = path.resolve(argValue('--out', 'docs/screenshots'));
const PORT = Number(argValue('--port', '9222'));
const WIDTH = Number(argValue('--width', '1560'));
const HEIGHT = Number(argValue('--height', '1150'));

const PAGES = [
  { name: '01-dashboard', path: '/', wait: 6000, title: '老板看板' },
  { name: '02-inbox', path: '/inbox', wait: 3500, title: '询盘箱' },
  { name: '03-quotes', path: '/quotes', wait: 3500, title: '报价单' },
  { name: '04-followups', path: '/followups', wait: 3500, title: '跟进看板' },
  { name: '05-payments', path: '/payments', wait: 3500, title: '回款看板' },
  { name: '06-products', path: '/products', wait: 3500, title: '产品库' },
  { name: '07-playbooks', path: '/playbooks', wait: 3500, title: '话术库' },
  { name: '08-agents', path: '/agents', wait: 4500, title: '智能体' },
  { name: '09-settings', path: '/settings', wait: 3500, title: '设置' },
];

function chromePath() {
  const candidates = [
    process.env.DEALTRACK_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Chrome DevTools 未在 ${timeoutMs}ms 内就绪`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.maxWaitMs = 30_000;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        const handlers = this.listeners.get(message.method);
        if (handlers) handlers.forEach((handler) => handler(message.params));
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}, timeoutMs = this.maxWaitMs) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} 超时`));
      }, timeoutMs);
    });
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  once(event, timeoutMs) {
    return new Promise((resolve) => {
      const off = this.on(event, (params) => {
        off();
        resolve(params);
      });
      setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
    });
  }

  /**
   * Evaluate in the page, tolerating the execution context being replaced.
   *
   * `Page.navigate` resolves before the new document exists, so an immediate
   * `Runtime.evaluate` can land in a context that is mid-teardown and never
   * answer. Waiting for `Page.loadEventFired` first — then retrying once — is
   * what made this reliable instead of failing on whichever page happened to be
   * slow.
   */
  async evaluate(expression, { retries = 2, timeoutMs = 8000 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await this.send(
          'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: false },
          timeoutMs,
        );
        return result?.result?.value;
      } catch (error) {
        if (attempt === retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return undefined;
  }
}

async function main() {
  const chrome = chromePath();
  if (!chrome) {
    console.error('未找到 Chrome / Chromium。设置 DEALTRACK_CHROME_PATH 后重试。');
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      `--remote-debugging-port=${PORT}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  const cleanup = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  await waitForDevtools();
  console.log(`Chrome DevTools 就绪（端口 ${PORT}）`);

  const failures = [];

  /**
   * One tab per screenshot.
   *
   * Reusing a single target works for a few navigations and then wedges —
   * `Page.navigate` stops answering around the sixth page in this app. A fresh
   * target per page costs a few hundred milliseconds and removes the whole class
   * of cross-page interference.
   */
  async function withPage(fn) {
    const target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
    ).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);
    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH,
        height: HEIGHT,
        deviceScaleFactor: 2,
        mobile: false,
      });
      return await fn(cdp);
    } finally {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
    }
  }

  for (const page of PAGES) {
    const url = `${BASE}${page.path}`;
    process.stdout.write(`  ${page.title.padEnd(8)} ${url} … `);

    try {
      const outcome = await withPage(async (cdp) => {
        let navigated = false;
        for (let attempt = 0; attempt < 3 && !navigated; attempt += 1) {
          try {
            await cdp.send('Page.navigate', { url }, 12_000);
            navigated = true;
          } catch (error) {
            if (attempt === 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
        }
        // Give React a beat to fetch and paint after the document loads.
        await new Promise((resolve) => setTimeout(resolve, page.wait));

        const consoleErrors = JSON.parse((await cdp.evaluate('JSON.stringify(window.__dtErrors || [])')) ?? '[]');
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, 25_000);
        writeFileSync(path.join(OUT, `${page.name}.png`), Buffer.from(shot.data, 'base64'));

        const title = await cdp.evaluate('document.title');
        const bodyLength = Number((await cdp.evaluate('document.body.innerText.trim().length')) ?? 0);
        return { title, bodyLength, consoleErrors };
      });

      if (outcome.bodyLength < 40) {
        failures.push(`${page.name} 页面几乎为空`);
        console.log(`✘ 空白（title=${outcome.title}）`);
      } else {
        console.log(
          `✔ ${String(outcome.bodyLength).padStart(5)} 字符${
            outcome.consoleErrors.length ? ` · ${outcome.consoleErrors.length} 个 JS 错误` : ''
          }`,
        );
      }
      if (outcome.consoleErrors.length) failures.push(`${page.name}: ${outcome.consoleErrors.join('; ')}`);
    } catch (error) {
      console.log(`✘ ${error.message}`);
      failures.push(`${page.name}: ${error.message}`);
    }
  }

  cleanup();

  console.log(`\n截图已保存到 ${OUT}`);
  if (failures.length) {
    console.error('\n问题：');
    for (const failure of failures) console.error(`  · ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('截图失败：', error.message);
  process.exit(1);
});
