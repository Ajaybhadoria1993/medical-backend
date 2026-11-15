import { getTableColumns, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { database } from '../../configurations/dbConnection';
import logger from '../../utils/logger';

export type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Db = typeof database | Tx;

export type SyncResult = 'created' | 'updated' | 'unchanged';

export interface SyncCounts {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
}

export const newCounts = (): SyncCounts => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  removed: 0,
});

/** Compares DB and seed values the same way: decimals as numbers, dates as ISO, objects as JSON. */
const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))
    return String(Number(v));
  return String(v);
};

/** The seed fields whose value differs from the stored row. */
export function changedFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(next).filter(
      ([k, v]) => v !== undefined && norm(current[k]) !== norm(v)
    )
  );
}

/** Check, then write: insert if missing, else update only changed fields; `createOnly` is set on insert only. */
export async function syncRow<T extends PgTable>(opts: {
  db?: Db;
  table: T;
  where: SQL | undefined;
  /** Synced every run. With createOnly it must make a full row; the insert fails loudly if not. */
  values: Partial<T['$inferInsert']>;
  createOnly?: Partial<T['$inferInsert']>;
}): Promise<{ result: SyncResult; row: T['$inferSelect'] }> {
  // An empty filter would update every row in the table.
  if (!opts.where) throw new Error('syncRow needs a where clause');
  const db = opts.db ?? database;
  const table = opts.table as PgTable;
  const [current] = (await db
    .select()
    .from(table)
    .where(opts.where)
    .limit(1)) as Record<string, unknown>[];

  if (!current) {
    const [row] = await db
      .insert(table)
      .values({ ...opts.createOnly, ...opts.values } as never)
      .returning();
    return { result: 'created', row: row as T['$inferSelect'] };
  }

  const diff = changedFields(current, opts.values as Record<string, unknown>);
  if (Object.keys(diff).length === 0) {
    return { result: 'unchanged', row: current as T['$inferSelect'] };
  }
  const stamp =
    'updatedAt' in getTableColumns(table) ? { updatedAt: new Date() } : {};
  const [row] = await db
    .update(table)
    .set({ ...diff, ...stamp } as never)
    .where(opts.where)
    .returning();
  return { result: 'updated', row: row as T['$inferSelect'] };
}

/** One summary line per seed; the changed keys go to debug so a normal run stays short. */
export function logSeed(
  name: string,
  c: SyncCounts,
  changed: string[] = []
): void {
  const parts = [
    `${c.created} created`,
    `${c.updated} updated`,
    `${c.unchanged} unchanged`,
  ];
  if (c.removed) parts.push(`${c.removed} removed`);
  logger.info(`[seed] ${name}: ${parts.join(', ')}`);
  if (changed.length)
    logger.debug(`[seed] ${name} changed: ${changed.join(', ')}`);
}

/** Adds one syncRow result to the counts, remembering the key when something changed. */
export function tally(
  c: SyncCounts,
  changed: string[],
  key: string,
  result: SyncResult
): void {
  c[result]++;
  if (result !== 'unchanged') changed.push(`${key} (${result})`);
}
