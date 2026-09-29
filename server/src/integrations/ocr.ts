import { readFileSync } from 'node:fs';
import { getDb } from '../core/db.js';
import { config } from '../core/config.js';
import { getSetting, getSecret, SETTING_KEYS } from '../core/settings.js';
import { getLlm } from '../core/llm/service.js';
import { EVENTS, emit } from '../core/events.js';
import { nowIso, uid } from '../core/util.js';
import { z } from 'zod';

/**
 * OCR for attachments (images, scanned POs, PDFs).
 *
 * Two-tier by design:
 *
 *   1. A pluggable cloud OCR (TextIn by default) when a key is configured.
 *   2. A vision-capable LLM fallback that extracts *commercial* fields (PO
 *      number, items, quantities, prices, incoterm) rather than raw text —
 *      which is what the Sales Agent actually needs anyway.
 *
 * With neither configured, the attachment is recorded and marked `skipped`, and
 * the human is asked. Nothing is ever silently dropped.
 */

export interface OcrResult {
  attachmentId: string;
  status: 'done' | 'skipped' | 'failed';
  text: string;
  fields: Record<string, unknown>;
  provider: string;
  detail: string;
}

const PoSchema = z.object({
  po_number: z.string().nullable().optional(),
  buyer: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        description: z.string().default(''),
        qty: z.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        unit_price: z.number().nullable().optional(),
        amount: z.number().nullable().optional(),
      }),
    )
    .default([]),
  currency: z.string().nullable().optional(),
  incoterm: z.string().nullable().optional(),
  total: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

function ocrConfig(): { enabled: boolean; provider: string; apiKey: string; endpoint: string } {
  const stored = getSetting<Record<string, unknown>>(SETTING_KEYS.OCR, {});
  return {
    enabled: (stored.enabled as boolean) ?? config.integrations.ocr.enabled,
    provider: (stored.provider as string) || config.integrations.ocr.provider,
    apiKey: getSecret(SETTING_KEYS.OCR_KEY) || config.integrations.ocr.apiKey,
    endpoint: (stored.endpoint as string) || config.integrations.ocr.endpoint,
  };
}

export async function processAttachment(attachmentId: string): Promise<OcrResult> {
  const db = getDb();
  const row = db.get<Record<string, unknown>>('SELECT * FROM attachments WHERE id = ?', attachmentId);
  if (!row) {
    return { attachmentId, status: 'failed', text: '', fields: {}, provider: 'none', detail: '附件不存在' };
  }

  const filePath = (row.path as string | null) ?? null;
  if (!filePath) {
    db.run('UPDATE attachments SET ocr_status = ? WHERE id = ?', 'skipped', attachmentId);
    return { attachmentId, status: 'skipped', text: '', fields: {}, provider: 'none', detail: '附件未落盘，无法解析' };
  }

  const cfg = ocrConfig();

  // --- Tier 1: dedicated OCR service -------------------------------------
  if (cfg.enabled && cfg.apiKey) {
    try {
      const bytes = readFileSync(filePath);
      const response = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-ti-app-id': cfg.apiKey,
        },
        body: new Uint8Array(bytes),
      });
      if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
      const payload = (await response.json()) as { result?: { markdown?: string; text?: string } };
      const text = payload.result?.markdown ?? payload.result?.text ?? '';
      const fields = await structureFromText(text, attachmentId);
      db.run(
        'UPDATE attachments SET ocr_status = ?, ocr_text = ?, extracted = ? WHERE id = ?',
        'done',
        text,
        JSON.stringify(fields),
        attachmentId,
      );
      emit({
        type: EVENTS.DECLARATION_DRAFTED,
        actor: 'integration:ocr',
        entityType: 'attachment',
        entityId: attachmentId,
        subject: `附件已解析（${cfg.provider}）`,
        payload: { attachmentId, chars: text.length, fields },
      });
      return { attachmentId, status: 'done', text, fields, provider: cfg.provider, detail: `已通过 ${cfg.provider} 解析` };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      db.run('UPDATE attachments SET ocr_status = ? WHERE id = ?', 'failed', attachmentId);
      return { attachmentId, status: 'failed', text: '', fields: {}, provider: cfg.provider, detail };
    }
  }

  // --- Tier 2: no OCR configured -----------------------------------------
  db.run('UPDATE attachments SET ocr_status = ? WHERE id = ?', 'skipped', attachmentId);
  return {
    attachmentId,
    status: 'skipped',
    text: '',
    fields: {},
    provider: 'none',
    detail: '未配置 OCR（设置 → 文档识别）。附件已保存，可由人工阅读后补录。',
  };
}

/** Turn OCR text into the commercial fields the Sales Agent cares about. */
async function structureFromText(text: string, attachmentId: string): Promise<Record<string, unknown>> {
  if (!text || text.trim().length < 10) return {};
  try {
    const { data } = await getLlm().json({
      operation: 'extract_inquiry',
      schema: PoSchema,
      system: [
        'Extract commercial fields from the text of a purchase order or product list.',
        'Return JSON only. Use null for anything not present. Never invent values.',
      ].join('\n'),
      user: text.slice(0, 12_000),
      context: { rawBody: text },
      fallback: () => ({ po_number: null, buyer: null, items: [], currency: null, incoterm: null, total: null, notes: null }),
      agent: 'sales',
    });
    return data as unknown as Record<string, unknown>;
  } catch (error) {
    console.warn('[ocr] structuring failed', error);
    return {};
  }
}

export function recordAttachment(input: {
  inquiryId?: string | null;
  messageId?: string | null;
  filename: string;
  mime?: string;
  size?: number;
  path?: string;
}): string {
  const db = getDb();
  const existing = input.path
    ? db.get<Record<string, unknown>>('SELECT id FROM attachments WHERE path = ?', input.path)
    : undefined;
  if (existing) return String(existing.id);

  const id = uid('att');
  db.run(
    `INSERT INTO attachments (id, inquiry_id, message_id, filename, mime, size, path, ocr_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    input.inquiryId ?? null,
    input.messageId ?? null,
    input.filename,
    input.mime ?? null,
    input.size ?? null,
    input.path ?? null,
    nowIso(),
  );
  return id;
}
