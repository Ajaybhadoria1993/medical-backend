import { sql } from 'drizzle-orm';
import { getISTDateString } from './istDateTime';

/** Stable 32-bit hash, used as a Postgres advisory-lock key. */
function hashStringToInt32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** Serialises every write to one doctor's IST day; booking, payment hold and no-show shift must share this key. */
export async function lockDoctorDay(
  trx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  doctorId: string,
  date: Date
): Promise<void> {
  await trx.execute(
    sql`SELECT pg_advisory_xact_lock(${hashStringToInt32(doctorId)}, ${hashStringToInt32(getISTDateString(date))})`
  );
}
