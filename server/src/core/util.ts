import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Time helpers — every timestamp in DealTrack is an ISO-8601 UTC string so the
// data stays portable between SQLite and PostgreSQL.
// ---------------------------------------------------------------------------

export const nowIso = (): string => new Date().toISOString();

export const toIso = (d: Date | string | number): string =>
  d instanceof Date ? d.toISOString() : new Date(d).toISOString();

export const addMinutes = (minutes: number, from: Date = new Date()): string =>
  new Date(from.getTime() + minutes * 60_000).toISOString();

export const addHours = (hours: number, from: Date = new Date()): string =>
  addMinutes(hours * 60, from);

export const addDays = (days: number, from: Date = new Date()): string =>
  addHours(days * 24, from);

export const secondsBetween = (a: string, b: string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);

export const daysBetween = (a: string, b: string): number =>
  Math.floor(secondsBetween(a, b) / 86_400);

/** `d1 - d2` in milliseconds, ms-safe for short agent runs. */
export const msBetween = (a: string, b: string): number =>
  new Date(b).getTime() - new Date(a).getTime();

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export const uid = (prefix?: string): string =>
  prefix ? `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}` : randomUUID();

export const token = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

export const shortHash = (input: string, len = 12): string => sha256(input).slice(0, len);

/** Human-friendly sequence codes: INQ-20260929-0007 */
export const code = (prefix: string, seq: number, at: Date = new Date()): string => {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${String(seq).padStart(4, '0')}`;
};

// ---------------------------------------------------------------------------
// Value normalisation — node:sqlite only binds null / number / bigint / string /
// Uint8Array. Everything else blows up, so repositories funnel writes through
// here and SQLite stays boring.
// ---------------------------------------------------------------------------

export type BindValue = null | number | bigint | string | Uint8Array;

export function toBind(value: unknown): BindValue {
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return value;
    case 'boolean':
      return value ? 1 : 0;
    case 'object':
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Uint8Array) return value;
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

export const toBool = (value: unknown): boolean => value === 1 || value === true || value === '1';

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max);

export const round = (n: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function truncate(input: string, max = 4000): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const resolvePath = (...parts: string[]): string => path.join(...parts);

// ---------------------------------------------------------------------------
// Secret storage — BYOK LLM keys and SMTP passwords are encrypted at rest with
// AES-256-GCM. The master key lives in `data/.master.key` and is never committed.
// ---------------------------------------------------------------------------

const SCRYPT_SALT = 'dealtrack.v1';

export function deriveKey(masterKey: string): Buffer {
  return scryptSync(masterKey, SCRYPT_SALT, 32);
}

export function encryptSecret(plaintext: string, masterKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(masterKey), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string, masterKey: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('unsupported secret format');
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(masterKey),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Keep only the tail of a secret so the UI can show "sk-…9f2a". */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}
