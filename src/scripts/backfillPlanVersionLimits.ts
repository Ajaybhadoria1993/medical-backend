/** Links plan limits and add-on caps to their plan's current version; dry run unless --apply, safe to rerun.
 *  npx tsx src/scripts/backfillPlanVersionLimits.ts [--apply] */
import { sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';

const apply = process.argv.includes('--apply');
class DryRun extends Error {}

// The version in force now: the latest one whose start has passed.
const fill = (table: string) =>
  sql.raw(`
    UPDATE ${table} t
       SET plan_version_id = (
             SELECT v.id FROM plan_versions v
              WHERE v.plan_id = t.plan_id AND v.effective_from <= now()
              ORDER BY v.effective_from DESC LIMIT 1)
     WHERE t.plan_version_id IS NULL`);
const left = (table: string) =>
  sql.raw(
    `SELECT count(*)::int AS n FROM ${table} WHERE plan_version_id IS NULL`
  );
const count = async (q: ReturnType<typeof sql.raw>, db = database) => {
  const r = (await db.execute(q)) as unknown as { rows?: { n: number }[] } & {
    n: number;
  }[];
  return (r.rows ?? r)[0]?.n ?? 0;
};

async function main() {
  const tables = ['plan_features', 'plan_add_on_limits'];
  try {
    await database.transaction(async (tx) => {
      for (const t of tables) {
        const before = await count(left(t), tx as unknown as typeof database);
        await tx.execute(fill(t));
        const after = await count(left(t), tx as unknown as typeof database);
        console.info(
          `${t}: ${before - after} filled, ${after} still without a version (plan has no version)`
        );
      }
      if (!apply) throw new DryRun();
    });
    console.info('Applied.');
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
    console.info('Dry run: nothing written. Run again with --apply.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
