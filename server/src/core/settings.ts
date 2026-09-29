import { getDb, type Row } from './db.js';
import { config } from './config.js';
import { decryptSecret, encryptSecret, maskSecret, nowIso, parseJson } from './util.js';
import { PROVIDER_DEFAULTS, type ProviderId } from './llm/types.js';

/**
 * Settings store.
 *
 * Secrets (LLM keys, SMTP passwords, WhatsApp tokens) are encrypted with
 * AES-256-GCM before they touch the database. Reading them back requires the
 * master key on this machine, which is what "本地优先" actually means in
 * practice: a stolen copy of `dealtrack.sqlite` is not a stolen API key.
 */

export interface CompanyProfile {
  name: string;
  nameZh: string;
  address: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  bankInfo: string;
  defaultCurrency: string;
  defaultIncoterm: string;
  defaultPort: string;
  defaultLanguage: string;
  defaultLeadTimeDays: number;
  paymentTerms: string;
  marketCount: number;
}

export interface LlmSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  temperature: number;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export interface AutomationSettings {
  /** When true the agents send autonomously; when false every draft waits for a human. */
  autoSend: boolean;
  /** Days after the quote goes out that each nudge fires. */
  followupCadenceDays: number[];
  /** Minutes the team is allowed to take on a first reply before the SLA burns. */
  slaFirstReplyMinutes: number;
  /** A quote with no reply for this many days counts as "went silent". */
  silenceDays: number;
  /** Escalate to a human thread when an inquiry sits untouched this long. */
  escalateAfterHours: number;
  draftQuotesAutomatically: boolean;
  languageAutoDetect: boolean;
}

export const SETTING_KEYS = {
  COMPANY: 'company.profile',
  SALES: 'sales.identity',
  LLM: 'llm.config',
  LLM_API_KEY: 'llm.apiKey',
  AUTOMATION: 'automation.config',
  EMAIL: 'integration.email',
  EMAIL_PASSWORD: 'integration.email.password',
  WHATSAPP: 'integration.whatsapp',
  WHATSAPP_TOKEN: 'integration.whatsapp.token',
  OCR: 'integration.ocr',
  OCR_KEY: 'integration.ocr.key',
  API_TOKEN: 'security.apiToken',
  SEEDED: 'system.seeded',
} as const;

export function getSetting<T = unknown>(key: string, fallback: T): T {
  const row = getDb().get<Row>('SELECT value, encrypted FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  const raw = String(row.value);
  if (Number(row.encrypted) === 1) {
    try {
      return JSON.parse(decryptSecret(raw, config.masterKey)) as T;
    } catch {
      return fallback;
    }
  }
  return parseJson<T>(raw, fallback);
}

export function setSetting(key: string, value: unknown, options: { secret?: boolean } = {}): void {
  const secret = options.secret === true;
  const payload = secret
    ? encryptSecret(typeof value === 'string' ? value : JSON.stringify(value), config.masterKey)
    : JSON.stringify(value ?? null);
  const db = getDb();
  const exists = db.get<Row>('SELECT key FROM settings WHERE key = ?', key);
  if (exists) {
    db.run('UPDATE settings SET value = ?, encrypted = ?, updated_at = ? WHERE key = ?', payload, secret ? 1 : 0, nowIso(), key);
  } else {
    db.run('INSERT INTO settings (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)', key, payload, secret ? 1 : 0, nowIso());
  }
}

export function deleteSetting(key: string): void {
  getDb().run('DELETE FROM settings WHERE key = ?', key);
}

export function getSecret(key: string): string {
  const row = getDb().get<Row>('SELECT value, encrypted FROM settings WHERE key = ?', key);
  if (!row) return '';
  const raw = String(row.value);
  if (Number(row.encrypted) !== 1) return raw;
  try {
    const decrypted = decryptSecret(raw, config.masterKey);
    try {
      const parsed = JSON.parse(decrypted);
      return typeof parsed === 'string' ? parsed : decrypted;
    } catch {
      return decrypted;
    }
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Typed accessors with defaults that make a fresh install immediately usable.
// ---------------------------------------------------------------------------

export const DEFAULT_COMPANY: CompanyProfile = {
  name: 'Shenzhen Nova Trading Co., Ltd.',
  nameZh: '深圳诺华贸易有限公司',
  address: 'Room 1806, Building A, Bao Yuan Tech Park, Baoan District',
  city: 'Shenzhen',
  country: 'China',
  email: 'sales@nova-trading.example',
  phone: '+86 755 8888 6666',
  website: 'https://nova-trading.example',
  bankInfo: 'Bank: Bank of China, Shenzhen Branch\nSWIFT: BKCHCNBJ\nAccount: 1234 5678 9012 3456',
  defaultCurrency: 'USD',
  defaultIncoterm: 'FOB',
  defaultPort: 'Shenzhen',
  defaultLanguage: 'en',
  defaultLeadTimeDays: 15,
  paymentTerms: '30% T/T deposit, 70% before shipment',
  marketCount: 42,
};

export const DEFAULT_AUTOMATION: AutomationSettings = {
  autoSend: false,
  followupCadenceDays: [3, 7, 14, 30],
  slaFirstReplyMinutes: 30,
  silenceDays: 14,
  escalateAfterHours: 48,
  draftQuotesAutomatically: true,
  languageAutoDetect: true,
};

export const DEFAULT_SALES = {
  senderName: 'Lily Chen',
  senderRole: 'Sales Manager',
  senderEmail: 'lily@nova-trading.example',
  senderWhatsapp: '+86 138 0000 0000',
};

export const getCompany = (): CompanyProfile => ({
  ...DEFAULT_COMPANY,
  ...getSetting<Partial<CompanyProfile>>(SETTING_KEYS.COMPANY, {}),
});

export const getSalesIdentity = (): typeof DEFAULT_SALES => ({
  ...DEFAULT_SALES,
  ...getSetting<Partial<typeof DEFAULT_SALES>>(SETTING_KEYS.SALES, {}),
});

export const getAutomation = (): AutomationSettings => ({
  ...DEFAULT_AUTOMATION,
  ...getSetting<Partial<AutomationSettings>>(SETTING_KEYS.AUTOMATION, {}),
});

export function getLlmSettings(): LlmSettings {
  const stored = getSetting<Partial<LlmSettings>>(SETTING_KEYS.LLM, {});
  const provider = (stored.provider ?? config.llm.provider) as ProviderId;
  const apiKey = getLlmApiKey(provider);
  return {
    provider,
    model: stored.model ?? config.llm.model ?? PROVIDER_DEFAULTS[provider]?.model ?? '',
    baseUrl: stored.baseUrl ?? config.llm.baseUrl ?? PROVIDER_DEFAULTS[provider]?.baseUrl ?? '',
    temperature: stored.temperature ?? config.llm.temperature,
    hasApiKey: apiKey.length > 0,
    apiKeyMasked: maskSecret(apiKey),
  };
}

export function getLlmApiKey(provider: ProviderId): string {
  const stored = getSecret(`${SETTING_KEYS.LLM_API_KEY}.${provider}`);
  if (stored) return stored;
  if (provider === 'openai') return process.env.OPENAI_API_KEY ?? config.llm.apiKey;
  if (provider === 'deepseek') return process.env.DEEPSEEK_API_KEY ?? config.llm.apiKey;
  return '';
}

export function setLlmApiKey(provider: ProviderId, apiKey: string): void {
  if (!apiKey) {
    deleteSetting(`${SETTING_KEYS.LLM_API_KEY}.${provider}`);
    return;
  }
  setSetting(`${SETTING_KEYS.LLM_API_KEY}.${provider}`, apiKey, { secret: true });
}

/** Redacted view for the API — never returns raw secrets. */
export function describeIntegrations(): Record<string, unknown> {
  const email = getSetting<Record<string, unknown>>(SETTING_KEYS.EMAIL, {});
  const whatsapp = getSetting<Record<string, unknown>>(SETTING_KEYS.WHATSAPP, {});
  const ocr = getSetting<Record<string, unknown>>(SETTING_KEYS.OCR, {});
  const emailPassword = getSecret(SETTING_KEYS.EMAIL_PASSWORD) || config.integrations.email.password;
  const whatsappToken = getSecret(SETTING_KEYS.WHATSAPP_TOKEN) || config.integrations.whatsapp.accessToken;
  const ocrKey = getSecret(SETTING_KEYS.OCR_KEY) || config.integrations.ocr.apiKey;

  return {
    email: {
      enabled: (email.enabled as boolean) ?? config.integrations.email.enabled,
      imapHost: (email.imapHost as string) ?? config.integrations.email.imapHost,
      imapPort: (email.imapPort as number) ?? config.integrations.email.imapPort,
      smtpHost: (email.smtpHost as string) ?? config.integrations.email.smtpHost,
      smtpPort: (email.smtpPort as number) ?? config.integrations.email.smtpPort,
      user: (email.user as string) ?? config.integrations.email.user,
      passwordMasked: maskSecret(emailPassword),
      hasPassword: emailPassword.length > 0,
      fromName: (email.fromName as string) ?? config.integrations.email.fromName,
    },
    whatsapp: {
      enabled: (whatsapp.enabled as boolean) ?? config.integrations.whatsapp.enabled,
      phoneNumberId: (whatsapp.phoneNumberId as string) ?? config.integrations.whatsapp.phoneNumberId,
      verifyToken: (whatsapp.verifyToken as string) ?? config.integrations.whatsapp.verifyToken,
      accessTokenMasked: maskSecret(whatsappToken),
      hasAccessToken: whatsappToken.length > 0,
      apiVersion: (whatsapp.apiVersion as string) ?? config.integrations.whatsapp.apiVersion,
    },
    ocr: {
      enabled: (ocr.enabled as boolean) ?? config.integrations.ocr.enabled,
      provider: (ocr.provider as string) ?? config.integrations.ocr.provider,
      endpoint: (ocr.endpoint as string) ?? config.integrations.ocr.endpoint,
      hasApiKey: ocrKey.length > 0,
    },
    llm: getLlmSettings(),
  };
}
