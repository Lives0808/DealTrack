import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { fail } from './context.js';

/**
 * Request validation.
 *
 * v1 handed request bodies straight to the repositories with `as never` casts.
 * That is not just untidy — anything reaching a repository can write a row, so a
 * typo in an integration script could set `customers.country` to an object, and
 * the failure would surface days later as a broken document instead of a 400.
 *
 * Every write endpoint now parses its body against one of these schemas. Invalid
 * input is rejected at the edge with a field-level message.
 */

const trimmed = (max: number) => z.string().trim().max(max);

export const CustomerInput = z.object({
  company: trimmed(200).min(1, '公司名称必填'),
  contactName: trimmed(120).nullish(),
  email: z.string().trim().email('邮箱格式不正确').max(200).nullish().or(z.literal('')),
  phone: trimmed(60).nullish(),
  whatsapp: trimmed(60).nullish(),
  website: trimmed(300).nullish(),
  country: trimmed(120).nullish(),
  countryCode: z.string().trim().length(2, '国家代码应为 2 位').nullish().or(z.literal('')),
  language: z.string().trim().min(2).max(8).nullish(),
  timezone: trimmed(80).nullish(),
  source: trimmed(40).nullish(),
  status: z.enum(['lead', 'prospect', 'active', 'dormant', 'blocked']).nullish(),
  tier: trimmed(40).nullish(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  preferences: z.record(z.unknown()).optional(),
  notes: trimmed(4000).nullish(),
  ownerId: trimmed(60).nullish(),
});

export const ProductInput = z.object({
  sku: trimmed(80).min(1, 'SKU 必填'),
  nameEn: trimmed(300).min(1, '英文品名必填'),
  nameZh: trimmed(300).nullish(),
  category: trimmed(80).nullish(),
  descriptionEn: trimmed(4000).nullish(),
  descriptionZh: trimmed(4000).nullish(),
  unit: trimmed(20).nullish(),
  moq: z.coerce.number().int().min(1).max(10_000_000).nullish(),
  hsCode: trimmed(20).nullish(),
  hsDescription: trimmed(300).nullish(),
  netWeightKg: z.coerce.number().min(0).max(100_000).nullish(),
  grossWeightKg: z.coerce.number().min(0).max(100_000).nullish(),
  cbm: z.coerce.number().min(0).max(1000).nullish(),
  certifications: z.array(z.string().trim().max(40)).max(30).optional(),
  targetMarkets: z.array(z.string().trim().max(40)).max(60).optional(),
  status: z.enum(['active', 'draft', 'discontinued']).nullish(),
  spec: z.record(z.unknown()).optional(),
});

export const TierInput = z.object({
  id: trimmed(60).optional(),
  minQty: z.coerce.number().int().min(1).max(10_000_000),
  unitCost: z.coerce.number().min(0).max(100_000_000),
  costCurrency: z.string().trim().length(3).optional(),
  marginPct: z.coerce.number().min(0).max(0.95).optional(),
  listPrice: z.coerce.number().min(0).nullish(),
  currency: z.string().trim().length(3).optional(),
  incoterm: z.string().trim().max(6).optional(),
  packagingCost: z.coerce.number().min(0).max(1_000_000).optional(),
  inlandCost: z.coerce.number().min(0).max(1_000_000).optional(),
  leadTimeDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const PlaybookInput = z.object({
  name: trimmed(160).min(1, '话术名称必填'),
  bodyTpl: z.string().min(1, '正文模板必填').max(20_000),
  subjectTpl: trimmed(400).nullish(),
  category: trimmed(80).nullish(),
  stage: trimmed(60).optional(),
  channel: z.enum(['email', 'whatsapp']).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  variables: z.array(z.string().trim().max(40)).max(60).optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  active: z.boolean().optional(),
});

export const UserInput = z.object({
  name: trimmed(120).min(1, '姓名必填'),
  email: z.string().trim().email().max(200).nullish().or(z.literal('')),
  role: z.enum(['owner', 'ops', 'sales']).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  avatarColor: z.string().trim().max(20).nullish(),
  active: z.boolean().optional(),
});

export const ManualInquiryInput = z.object({
  body: z.string().trim().min(3, '询盘正文不能为空').max(60_000),
  company: trimmed(200).nullish(),
  contactName: trimmed(120).nullish(),
  email: z.string().trim().email('邮箱格式不正确').max(200).nullish().or(z.literal('')),
  phone: trimmed(60).nullish(),
  channel: z.enum(['email', 'whatsapp', 'web', 'manual']).optional(),
  subject: trimmed(500).nullish(),
  autoRun: z.boolean().optional(),
});

export const InboundEmailInput = z.object({
  from: z.string().trim().email('发件邮箱格式不正确').max(200),
  fromName: trimmed(200).nullish(),
  to: trimmed(200).nullish(),
  subject: trimmed(500).nullish(),
  text: z.string().max(200_000).nullish(),
  html: z.string().max(400_000).nullish(),
  messageId: trimmed(400).nullish(),
  threadId: trimmed(400).nullish(),
  receivedAt: z.string().datetime({ offset: true }).nullish(),
  attachments: z
    .array(
      z.object({
        filename: trimmed(300).min(1),
        mime: trimmed(120).optional(),
        size: z.coerce.number().min(0).optional(),
        path: trimmed(1000).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export const SendMessageInput = z.object({
  messageId: trimmed(80).min(1),
});

export const MessageEditInput = z.object({
  subject: trimmed(500).nullish(),
  body: z.string().max(60_000).nullish(),
});

export const PlaybookStage = z.enum([
  'first_reply',
  'quote_cover',
  'quote_followup',
  'followup_2',
  'followup_3',
  'reengagement',
  'objection_price',
  'objection_leadtime',
  'objection_moq',
  'thank_you',
  'shipping_update',
  'payment_reminder',
]);

/**
 * Drop explicit nulls from a validated payload.
 *
 * Zod's `nullish()` produces `T | null | undefined`, but our repository inputs
 * model "absent" as `undefined` only. Types matter here: without the mapped
 * return type, a null would silently reach a repository and land in a column.
 */
export function dropNulls<T extends Record<string, unknown>>(
  input: T,
): { [K in keyof T]: Exclude<T[K], null> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  // The mapped type is homomorphic, so required keys stay required and optional
  // keys stay optional — only `null` is removed.
  return out as { [K in keyof T]: Exclude<T[K], null> };
}

/** Parse a body, or send a 400 and return null. */
export function validate<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  reply: FastifyReply,
): T | null {
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  reply.code(400).send({
    ...fail(`请求参数校验失败：${issues.map((issue) => `${issue.field} ${issue.message}`).join('；')}`, 400, 'validation_error'),
    issues,
  });
  return null;
}
