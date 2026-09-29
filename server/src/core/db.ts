import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { MIGRATIONS } from './schema.js';
import { nowIso, toBind, type BindValue } from './util.js';

export type Row = Record<string, unknown>;

/**
 * Thin, synchronous wrapper over node:sqlite.
 *
 * Why SQLite: DealTrack is local-first. Customer data, quotes and BYOK keys stay
 * on the operator's machine unless they explicitly deploy it. The SQL used here
 * is deliberately ANSI-flavoured (TEXT ids, ISO timestamps, no AUTOINCREMENT) so
 * swapping in PostgreSQL later is a driver change, not a rewrite.
 */
export class Database {
  readonly raw: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(file: string = config.dbFile) {
    if (file !== ':memory:') {
      mkdirSync(path.dirname(file), { recursive: true });
    }
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );`);
    const applied = new Set(
      (this.raw.prepare('SELECT version FROM schema_migrations').all() as Row[]).map((r) =>
        Number(r.version),
      ),
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      // The initial schema bundles its own PRAGMAs; strip them inside a transaction.
      const body = migration.sql
        .split('\n')
        .filter((line) => !/^\s*PRAGMA\s+(journal_mode|foreign_keys|busy_timeout)/i.test(line))
        .join('\n');
      this.transaction(() => {
        this.raw.exec(body);
        this.raw
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, nowIso());
      });
    }
  }

  private stmt(sql: string): StatementSync {
    let cached = this.cache.get(sql);
    if (!cached) {
      cached = this.raw.prepare(sql);
      this.cache.set(sql, cached);
    }
    return cached;
  }

  private bind(params: unknown[]): BindValue[] {
    return params.map((p) => toBind(p));
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const result = this.stmt(sql).run(...this.bind(params));
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowid: Number(result.lastInsertRowid ?? 0),
    };
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    const row = this.stmt(sql).get(...this.bind(params));
    return row === undefined ? undefined : (row as T);
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.stmt(sql).all(...this.bind(params)) as T[];
  }

  /** Single scalar value from a one-column query. */
  scalar<T = number>(sql: string, ...params: unknown[]): T | undefined {
    const row = this.get<Record<string, unknown>>(sql, ...params);
    if (!row) return undefined;
    return Object.values(row)[0] as T;
  }

  count(sql: string, ...params: unknown[]): number {
    return Number(this.scalar<number>(sql, ...params) ?? 0);
  }

  /**
   * Nested-safe transaction. node:sqlite has no savepoint helper, so we track
   * depth and use SAVEPOINTs for anything nested.
   */
  transaction<T>(fn: () => T): T {
    const nested = this.txDepth > 0;
    const name = `sp_${this.txDepth}`;
    this.raw.exec(nested ? `SAVEPOINT ${name};` : 'BEGIN IMMEDIATE;');
    this.txDepth += 1;
    try {
      const result = fn();
      this.txDepth -= 1;
      this.raw.exec(nested ? `RELEASE ${name};` : 'COMMIT;');
      return result;
    } catch (error) {
      this.txDepth -= 1;
      try {
        this.raw.exec(nested ? `ROLLBACK TO ${name}; ROLLBACK TO ${name};` : 'ROLLBACK;');
      } catch {
        /* the outer transaction is already gone */
      }
      throw error;
    }
  }

  /** Insert helper: builds `INSERT INTO t (cols) VALUES (?,?)` from an object. */
  insert(table: string, data: Record<string, unknown>): string {
    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(', ');
    this.run(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
      ...cols.map((c) => data[c]),
    );
    return String(data.id ?? '');
  }

  update(
    table: string,
    id: string,
    patch: Record<string, unknown>,
    touch = true,
  ): boolean {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return false;
    const sets = entries.map(([k]) => `"${k}" = ?`);
    const values = entries.map(([, v]) => v);
    if (touch) {
      sets.push('"updated_at" = ?');
      values.push(nowIso());
    }
    const result = this.run(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`,
      ...values,
      id,
    );
    return result.changes > 0;
  }

  close(): void {
    this.cache.clear();
    try {
      this.raw.close();
    } catch {
      /* already closed */
    }
  }
}

let instance: Database | null = null;

export function getDb(): Database {
  if (!instance) {
    instance = new Database();
  }
  return instance;
}

/** Test/CLI helper: build an isolated in-memory or temp database. */
export function createDb(file?: string): Database {
  return new Database(file);
}

/**
 * Install a specific connection as the process-wide singleton.
 *
 * Tests and the seed CLI use this to work on a throwaway file — without it,
 * any code path that reaches for `getDb()` would quietly open the real database
 * instead, which is exactly the kind of bug that ruins someone's data.
 */
export function setDb(db: Database): Database {
  instance = db;
  return instance;
}

export function resetDbSingleton(): void {
  instance = null;
}

export function dbExists(file: string = config.dbFile): boolean {
  return existsSync(file);
}
