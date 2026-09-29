import nodemailer, { type Transporter } from 'nodemailer';
import { getDb } from '../core/db.js';
import { config } from '../core/config.js';
import { getSetting, getSecret, SETTING_KEYS } from '../core/settings.js';
import { nowIso } from '../core/util.js';

/**
 * Outbound delivery.
 *
 * Design rule: **a missing integration is never an error.** When SMTP or the
 * WhatsApp Cloud API is not configured, delivery is *simulated* — the message is
 * recorded, the pipeline advances, and the UI labels it clearly. That keeps the
 * whole 询盘→报价→跟进 flow demonstrable on a laptop with no credentials, and
 * means a misconfigured mailbox can't silently swallow a customer reply.
 */

export interface SendResult {
  ok: boolean;
  provider: string;
  providerMessageId: string | null;
  error: string | null;
  simulated: boolean;
  detail: string;
}

export interface EmailConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  password: string;
  fromName: string;
}

export interface WhatsappConfig {
  enabled: boolean;
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  verifyToken: string;
}

export function emailConfig(): EmailConfig {
  const stored = getSetting<Record<string, unknown>>(SETTING_KEYS.EMAIL, {});
  const password = getSecret(SETTING_KEYS.EMAIL_PASSWORD) || config.integrations.email.password;
  return {
    enabled: (stored.enabled as boolean) ?? config.integrations.email.enabled,
    smtpHost: (stored.smtpHost as string) || config.integrations.email.smtpHost,
    smtpPort: Number(stored.smtpPort ?? config.integrations.email.smtpPort),
    smtpSecure: (stored.smtpSecure as boolean) ?? config.integrations.email.smtpSecure,
    user: (stored.user as string) || config.integrations.email.user,
    password,
    fromName: (stored.fromName as string) || config.integrations.email.fromName,
  };
}

export function whatsappConfig(): WhatsappConfig {
  const stored = getSetting<Record<string, unknown>>(SETTING_KEYS.WHATSAPP, {});
  return {
    enabled: (stored.enabled as boolean) ?? config.integrations.whatsapp.enabled,
    accessToken: getSecret(SETTING_KEYS.WHATSAPP_TOKEN) || config.integrations.whatsapp.accessToken,
    phoneNumberId: (stored.phoneNumberId as string) || config.integrations.whatsapp.phoneNumberId,
    apiVersion: (stored.apiVersion as string) || config.integrations.whatsapp.apiVersion,
    verifyToken: (stored.verifyToken as string) || config.integrations.whatsapp.verifyToken,
  };
}

let transporter: Transporter | null = null;
let transporterKey = '';

function getTransporter(cfg: EmailConfig): Transporter {
  const key = `${cfg.smtpHost}:${cfg.smtpPort}:${cfg.smtpSecure}:${cfg.user}`;
  if (transporter && transporterKey === key) return transporter;
  transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  transporterKey = key;
  return transporter;
}

export interface OutboundPayload {
  channel: string;
  toAddr: string;
  fromAddr?: string | null;
  subject?: string | null;
  body: string;
  bodyHtml?: string | null;
  attachments?: Array<{ filename: string; path: string; contentType?: string }>;
}

export async function sendEmail(payload: OutboundPayload): Promise<SendResult> {
  const cfg = emailConfig();
  if (!cfg.enabled || !cfg.smtpHost) {
    return simulate('smtp', payload, '未配置 SMTP（设置 → 邮件集成）。已记录为模拟发送，不影响流程推进。');
  }
  try {
    const mailer = getTransporter(cfg);
    const info = await mailer.sendMail({
      from: payload.fromAddr ? `"${cfg.fromName}" <${payload.fromAddr}>` : `"${cfg.fromName}" <${cfg.user}>`,
      to: payload.toAddr,
      subject: payload.subject ?? '(no subject)',
      text: payload.body,
      html: payload.bodyHtml ?? textToHtml(payload.body),
      attachments: payload.attachments,
    });
    return {
      ok: true,
      provider: 'smtp',
      providerMessageId: info.messageId ?? null,
      error: null,
      simulated: false,
      detail: `已通过 ${cfg.smtpHost} 投递。`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, provider: 'smtp', providerMessageId: null, error: message, simulated: false, detail: `SMTP 投递失败：${message}` };
  }
}

export async function sendWhatsapp(payload: OutboundPayload): Promise<SendResult> {
  const cfg = whatsappConfig();
  if (!cfg.enabled || !cfg.accessToken || !cfg.phoneNumberId) {
    return simulate('whatsapp', payload, '未配置 WhatsApp Business API（设置 → WhatsApp）。已记录为模拟发送。');
  }
  try {
    const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: payload.toAddr.replace(/[^\d]/g, ''),
        type: 'text',
        text: { preview_url: false, body: payload.body },
      }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      const detail = json.error?.message ?? `HTTP ${response.status}`;
      return { ok: false, provider: 'whatsapp', providerMessageId: null, error: detail, simulated: false, detail: `WhatsApp 发送失败：${detail}` };
    }
    return {
      ok: true,
      provider: 'whatsapp',
      providerMessageId: json.messages?.[0]?.id ?? null,
      error: null,
      simulated: false,
      detail: 'WhatsApp Cloud API 已受理。',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, provider: 'whatsapp', providerMessageId: null, error: message, simulated: false, detail: `WhatsApp 发送异常：${message}` };
  }
}

export async function deliver(payload: OutboundPayload): Promise<SendResult> {
  if (payload.channel === 'whatsapp') return sendWhatsapp(payload);
  return sendEmail(payload);
}

function simulate(provider: string, payload: OutboundPayload, note: string): SendResult {
  const id = `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    getDb().run(
      `INSERT INTO events (id, type, actor, entity_type, entity_id, subject, payload, created_at)
       VALUES (?, 'message.simulated', 'integration:outbound', 'message', ?, ?, ?, ?)`,
      `evt_sim_${id}`,
      id,
      `模拟发送 → ${payload.toAddr}`,
      JSON.stringify({ channel: payload.channel, note }),
      nowIso(),
    );
  } catch {
    /* the audit row is best-effort */
  }
  return { ok: true, provider, providerMessageId: id, error: null, simulated: true, detail: note };
}

export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1f2329;white-space:pre-wrap">${escaped}</div>`;
}

/** Verifies SMTP credentials without sending anything. */
export async function verifyEmailConfig(): Promise<{ ok: boolean; detail: string }> {
  const cfg = emailConfig();
  if (!cfg.enabled || !cfg.smtpHost) {
    return { ok: false, detail: '邮件集成未启用或未填写 SMTP 主机。' };
  }
  try {
    const mailer = getTransporter(cfg);
    await mailer.verify();
    return { ok: true, detail: `SMTP 连接成功（${cfg.smtpHost}:${cfg.smtpPort}）。` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `SMTP 校验失败：${message}` };
  }
}
