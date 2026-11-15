// Finance rebuild 6b: drop clinic_razorpay_accounts and clinic_commissions (no code uses them).
// Usage: NODE_ENV=<env> npx tsx src/scripts/dropOldPayoutTables.ts [--apply] (checks only by default).
import { writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';

const apply = process.argv.includes('--apply');
const env = process.env.NODE_ENV || 'development';

async function main() {
  const found = (
    await database.execute<{
      name: string;
    }>(sql`SELECT relname AS name FROM pg_class
      WHERE relkind = 'r' AND relname IN ('clinic_razorpay_accounts', 'clinic_commissions')`)
  ).map((r) => r.name);
  if (!found.length) {
    console.info(`[${env}] Neither table exists. Nothing to do.`);
    return;
  }

  // Anything that still points at them blocks the drop (no CASCADE).
  const blockers = await database.execute<{ what: string }>(sql`
    SELECT conrelid::regclass::text || ' (foreign key ' || conname || ')' AS what FROM pg_constraint
    WHERE contype = 'f' AND confrelid IN (SELECT oid FROM pg_class WHERE relname IN ('clinic_razorpay_accounts', 'clinic_commissions'))
    UNION
    SELECT DISTINCT v.relname || ' (view)' FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
    WHERE d.refobjid IN (SELECT oid FROM pg_class WHERE relname IN ('clinic_razorpay_accounts', 'clinic_commissions'))
      AND v.relname NOT IN ('clinic_razorpay_accounts', 'clinic_commissions')`);

  const rows: Record<string, unknown[]> = {};
  for (const t of found) {
    rows[t] = [
      ...(await database.execute(sql.raw(`SELECT * FROM public.${t}`))),
    ];
    console.info(`[${env}] ${t}: ${rows[t].length} rows`);
  }
  if (blockers.length) {
    console.error(
      `STOP: still used by ${blockers.map((b) => b.what).join(', ')}`
    );
    process.exitCode = 1;
    return;
  }
  console.info('Nothing points at them.');
  if (!apply) {
    console.info('\nCheck only. Rerun with --apply to back up and drop.');
    return;
  }

  // Backup outside the repo, so table data is never committed.
  const file = join(homedir(), `6b_${env}_${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 2));
  console.info(`Backup saved: ${file}`);

  await database.transaction(async (tx) => {
    for (const t of found)
      await tx.execute(sql.raw(`DROP TABLE IF EXISTS public.${t}`));
  });
  console.info(`Dropped: ${found.join(', ')}. Done.`);
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
