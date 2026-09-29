import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const env = process.env;

/** When run from `server/` (npm workspace) the data dir should sit at the repo root. */
function resolveRepoRoot(): string {
  const cwd = process.cwd();
  const parent = path.resolve(cwd, '..');
  if (existsSync(path.join(parent, 'server')) && existsSync(path.join(parent, 'web'))) return parent;
  if (existsSync(path.join(cwd, 'server')) && existsSync(path.join(cwd, 'web'))) return cwd;
  return cwd;
}

const rootDir = env.DEALTRACK_ROOT ? path.resolve(env.DEALTRACK_ROOT) : resolveRepoRoot();

const dataDir = env.DEALTRACK_DATA_DIR
  ? path.resolve(env.DEALTRACK_DATA_DIR)
  : path.join(rootDir, 'data');

/** Master key for AES-256-GCM secrets. Generated once, chmod 600, git-ignored. */
function loadMasterKey(): string {
  if (env.DEALTRACK_MASTER_KEY) return env.DEALTRACK_MASTER_KEY;
  const keyFile = path.join(dataDir, '.master.key');
  try {
    if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
    const key = randomBytes(32).toString('base64url');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(keyFile, key, { mode: 0o600 });
    return key;
  } catch {
    // Ephemeral key: secrets set this boot simply won't survive a restart.
    return 'dealtrack-ephemeral-master-key';
  }
}

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  rootDir,
  dataDir,
  /** SQLite file. Point DEALTRACK_DATABASE_URL at postgres:// later — see docs/ARCHITECTURE.md */
  dbFile: env.DEALTRACK_DB_FILE ?? path.join(dataDir, 'dealtrack.sqlite'),
  storageDir: path.join(dataDir, 'storage'),
  exportDir: path.join(dataDir, 'exports'),

  host: env.HOST ?? '0.0.0.0',
  port: num(env.PORT, 8787),
  publicUrl: env.DEALTRACK_PUBLIC_URL ?? `http://localhost:${num(env.PORT, 8787)}`,

  /** Bearer token guarding the API. Rotate it in Settings → Security. */
  apiToken: env.DEALTRACK_API_TOKEN ?? 'dealtrack-dev-token',
  masterKey: loadMasterKey(),

  /** The headline KPI this product exists to move. */
  targetMinutesPerReply: num(env.DEALTRACK_TARGET_MINUTES, 3),
  baselineMinutesPerReply: num(env.DEALTRACK_BASELINE_MINUTES, 30),

  workers: {
    enabled: env.DEALTRACK_WORKERS !== '0',
    concurrency: num(env.DEALTRACK_WORKER_CONCURRENCY, 4),
    pollMs: num(env.DEALTRACK_WORKER_POLL_MS, 750),
    maxAttempts: num(env.DEALTRACK_MAX_ATTEMPTS, 3),
  },

  llm: {
    /** mock | openai | deepseek | ollama | openai-compatible */
    provider: env.DEALTRACK_LLM_PROVIDER ?? 'mock',
    model: env.DEALTRACK_LLM_MODEL ?? '',
    apiKey: env.OPENAI_API_KEY ?? env.DEEPSEEK_API_KEY ?? '',
    baseUrl: env.DEALTRACK_LLM_BASE_URL ?? '',
    temperature: Number(env.DEALTRACK_LLM_TEMPERATURE ?? 0.3),
    maxOutputTokens: num(env.DEALTRACK_LLM_MAX_TOKENS, 2048),
    timeoutMs: num(env.DEALTRACK_LLM_TIMEOUT_MS, 90_000),
  },

  integrations: {
    email: {
      enabled: env.DEALTRACK_EMAIL_ENABLED === '1',
      imapHost: env.DEALTRACK_IMAP_HOST ?? '',
      imapPort: num(env.DEALTRACK_IMAP_PORT, 993),
      imapSecure: env.DEALTRACK_IMAP_SECURE !== '0',
      smtpHost: env.DEALTRACK_SMTP_HOST ?? '',
      smtpPort: num(env.DEALTRACK_SMTP_PORT, 465),
      smtpSecure: env.DEALTRACK_SMTP_SECURE !== '0',
      user: env.DEALTRACK_EMAIL_USER ?? '',
      password: env.DEALTRACK_EMAIL_PASSWORD ?? '',
      fromName: env.DEALTRACK_EMAIL_FROM_NAME ?? 'DealTrack Sales',
      pollSeconds: num(env.DEALTRACK_IMAP_POLL_SECONDS, 60),
      mailbox: env.DEALTRACK_IMAP_MAILBOX ?? 'INBOX',
    },
    whatsapp: {
      enabled: env.DEALTRACK_WHATSAPP_ENABLED === '1',
      verifyToken: env.DEALTRACK_WHATSAPP_VERIFY_TOKEN ?? '',
      accessToken: env.DEALTRACK_WHATSAPP_ACCESS_TOKEN ?? '',
      phoneNumberId: env.DEALTRACK_WHATSAPP_PHONE_NUMBER_ID ?? '',
      apiVersion: env.DEALTRACK_WHATSAPP_API_VERSION ?? 'v21.0',
    },
    ocr: {
      enabled: env.DEALTRACK_OCR_ENABLED === '1',
      provider: env.DEALTRACK_OCR_PROVIDER ?? 'textin',
      apiKey: env.DEALTRACK_OCR_API_KEY ?? '',
      endpoint: env.DEALTRACK_OCR_ENDPOINT ?? 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
    },
  },

  docs: {
    /** Any Chrome/Chromium binary; used to render quote PDFs (full CJK + RTL). */
    chromePath: env.DEALTRACK_CHROME_PATH ?? detectChrome(),
    renderTimeoutMs: num(env.DEALTRACK_PDF_TIMEOUT_MS, 30_000),
  },
} as const;

function detectChrome(): string {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    `${os.homedir()}/.cache/ms-playwright/chromium/chrome-linux/chrome`,
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? '';
}

export type Config = typeof config;
