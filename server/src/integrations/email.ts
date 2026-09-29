import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../core/db.js';
import { config } from '../core/config.js';
import { getSetting, getSecret, SETTING_KEYS } from '../core/settings.js';
import { ingestInbound } from '../core/ingest.js';
import { ensureDir, nowIso, uid } from '../core/util.js';

/**
 * Email integration (IMAP in, SMTP out).
 *
 * Polls the configured mailbox and turns every unseen message into an inquiry or
 * a reply. Design choices worth noting:
 *
 * - **Idempotent by Message-ID.** Re-polling, restarting, or running two
 *   instances never creates duplicate leads.
 * - **Attachments land on disk** and are recorded, so the OCR step can pick them
 *   up and the inquiry keeps its evidence.
 * - **Disabled by default.** With no IMAP configured the sync is a no-op that
 *   reports clearly why, rather than throwing on every tick.
 */

export interface EmailSyncResult {
  enabled: boolean;
  fetched: number;
  ingested: number;
  skipped: number;
  replies: number;
  errors: string[];
  detail: string;
}

interface EmailConfig {
  enabled: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  user: string;
  password: string;
  mailbox: string;
}

function emailConfig(): EmailConfig {
  const stored = getSetting<Record<string, unknown>>(SETTING_KEYS.EMAIL, {});
  const password = getSecret(SETTING_KEYS.EMAIL_PASSWORD) || config.integrations.email.password;
  return {
    enabled: (stored.enabled as boolean) ?? config.integrations.email.enabled,
    imapHost: (stored.imapHost as string) || config.integrations.email.imapHost,
    imapPort: Number(stored.imapPort ?? config.integrations.email.imapPort),
    imapSecure: (stored.imapSecure as boolean) ?? config.integrations.email.imapSecure,
    user: (stored.user as string) || config.integrations.email.user,
    password,
    mailbox: config.integrations.email.mailbox,
  };
}

export async function syncEmailInbox(options: { limit?: number; mailbox?: string; markSeen?: boolean } = {}): Promise<EmailSyncResult> {
  const cfg = emailConfig();
  const result: EmailSyncResult = {
    enabled: cfg.enabled,
    fetched: 0,
    ingested: 0,
    skipped: 0,
    replies: 0,
    errors: [],
    detail: '',
  };

  if (!cfg.enabled || !cfg.imapHost || !cfg.user) {
    result.detail = '邮件集成未启用或未配置（设置 → 邮件集成）。此接口为幂等空操作。';
    recordSync('email', null, result);
    return result;
  }

  const client = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapSecure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  });

  try {
    await client.connect();
    const mailbox = options.mailbox ?? cfg.mailbox;
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      const list = (uids || []).slice(-(options.limit ?? 25));
      result.fetched = list.length;

      for await (const message of client.fetch(list, { source: true, uid: true, envelope: true }, { uid: true })) {
        try {
          const parsed = await simpleParser(message.source as Buffer);
          const fromAddress = parsed.from?.value?.[0]?.address ?? '';
          if (!fromAddress) {
            result.skipped += 1;
            continue;
          }

          // Never ingest our own outbound mail.
          if (fromAddress.toLowerCase() === cfg.user.toLowerCase()) {
            result.skipped += 1;
            continue;
          }

          const messageId = parsed.messageId ?? `imap-${message.uid}`;
          const existing = getDb().get<Record<string, unknown>>(
            "SELECT id FROM outbound_messages WHERE provider_message_id = ? AND direction = 'inbound'",
            messageId,
          );
          if (existing) {
            result.skipped += 1;
            continue;
          }

          const attachments = await persistAttachments(parsed.attachments ?? [], String(message.uid));

          const ingest = ingestInbound({
            channel: 'email',
            fromEmail: fromAddress,
            fromName: parsed.from?.value?.[0]?.name ?? null,
            toAddr: cfg.user,
            subject: parsed.subject ?? null,
            body: parsed.text ?? stripHtml(String(parsed.html ?? '')),
            messageId,
            threadId: parsed.inReplyTo ?? null,
            receivedAt: (parsed.date ?? new Date()).toISOString(),
            attachments,
          });

          result.ingested += 1;
          if (ingest.isReply) result.replies += 1;

          if (options.markSeen !== false) {
            await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen'], { uid: true });
          }
        } catch (error) {
          result.errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    result.detail = `已处理 ${result.ingested} 封新邮件（其中 ${result.replies} 封为回复）。`;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    result.detail = `IMAP 同步失败：${result.errors.at(-1)}`;
  }

  recordSync('email', null, result);
  return result;
}

async function persistAttachments(
  attachments: Array<{ filename?: string | null; contentType?: string; size?: number; content?: Buffer }>,
  uidHint: string,
): Promise<Array<{ filename: string; mime?: string; size?: number; path?: string }>> {
  const out: Array<{ filename: string; mime?: string; size?: number; path?: string }> = [];
  if (attachments.length === 0) return out;

  const dir = ensureDir(path.join(config.storageDir, 'attachments', uidHint));
  for (const attachment of attachments.slice(0, 10)) {
    const filename = attachment.filename || `attachment-${out.length + 1}`;
    const target = path.join(dir, `${uid()}-${filename.replace(/[^\w.-]+/g, '_')}`);
    if (attachment.content) {
      writeFileSync(target, attachment.content);
    }
    out.push({
      filename,
      mime: attachment.contentType,
      size: attachment.size ?? attachment.content?.length,
      path: attachment.content ? target : undefined,
    });
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function recordSync(id: string, cursor: string | null, stats: unknown): void {
  try {
    const db = getDb();
    const at = nowIso();
    const existing = db.get<Record<string, unknown>>('SELECT id FROM sync_state WHERE id = ?', id);
    if (existing) {
      db.run('UPDATE sync_state SET cursor = ?, last_run_at = ?, stats = ? WHERE id = ?', cursor, at, JSON.stringify(stats), id);
    } else {
      db.run('INSERT INTO sync_state (id, cursor, last_run_at, stats) VALUES (?, ?, ?, ?)', id, cursor, at, JSON.stringify(stats));
    }
  } catch {
    /* sync bookkeeping must never break ingestion */
  }
}

/** Long-poll driver started by the server when email integration is enabled. */
export function startEmailPoller(intervalSeconds = config.integrations.email.pollSeconds): () => void {
  const cfg = emailConfig();
  if (!cfg.enabled) return () => undefined;

  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await syncEmailInbox({ limit: 25 });
      if (result.ingested > 0) {
        console.log(`[email] ${result.detail}`);
      }
    } catch (error) {
      console.error('[email] poll failed', error);
    } finally {
      running = false;
    }
  }, Math.max(15, intervalSeconds) * 1000);
  timer.unref?.();

  return () => clearInterval(timer);
}
