/** Postgres "relation does not exist", e.g. a table not migrated yet; drizzle may wrap the driver error in `cause`. */
export const isUndefinedTable = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '42P01' || e?.cause?.code === '42P01';
};

/** Postgres unique violation; drizzle may wrap the driver error in `cause`. */
export const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};
