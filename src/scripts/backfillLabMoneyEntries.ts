// Copies lab payment rows into money_entries, keeping their ids; adds only, re-runnable.
// Usage: NODE_ENV=<env> npx tsx src/scripts/backfillLabMoneyEntries.ts [--apply] (dry run by default).
// The dry run copies and checks inside one transaction, then rolls it back.
import { sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import { SYSTEM_ACTOR_ID } from '../main/money';

const apply = process.argv.includes('--apply');
const say = (...m: unknown[]) => console.info(...m);
type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute(q)) as unknown as Row[];

class DryRun extends Error {}

// Same mapping as LabMoneyService: paid is a payment; pending and failed stay owed as a
// charge, a failed one marked by its reason. Old rows had no receipts, so none is issued.
const ENTRY_TYPE = sql.raw(
  `CASE p.payment_status WHEN 'paid' THEN 'payment' ELSE 'charge' END::money_entry_type`
);
const REASON = sql.raw(
  `CASE p.payment_status WHEN 'failed' THEN 'Payment failed' END`
);
// Old created_at holds UTC wall time in a zone-less column.
const CREATED_AT = sql.raw(`p.created_at AT TIME ZONE 'UTC'`);

async function copy(tx: Tx) {
  const tests = await rows(
    tx,
    sql`
    INSERT INTO money_entries (id, clinic_id, patient_id, source_type, source_id, entry_type, reason,
      amount_paise, payment_mode, payment_notes, channel, created_by, created_at)
    SELECT p.id, NULL, o.patient_id, 'lab_test', p.lab_order_id, ${ENTRY_TYPE}, ${REASON},
      COALESCE(p.price, 0)::bigint * 100, p.payment_mode, LEFT(p.payment_notes, 50), 'desk',
      ${SYSTEM_ACTOR_ID}, ${CREATED_AT}
    FROM lab_updated_payments p
    LEFT JOIN lab_orders o ON o.id = p.lab_order_id
    ON CONFLICT (id) DO NOTHING
    RETURNING id`
  );
  const home = await rows(
    tx,
    sql`
    INSERT INTO money_entries (id, clinic_id, patient_id, source_type, source_id, entry_type, reason,
      amount_paise, payment_mode, payment_notes, channel, created_by, created_at)
    SELECT p.id, NULL, h.patient_id, 'lab_home_collection', p.home_collection_id, ${ENTRY_TYPE}, ${REASON},
      COALESCE(p.price, 0)::bigint * 100, p.payment_mode, LEFT(p.payment_notes, 50), 'desk',
      ${SYSTEM_ACTOR_ID}, ${CREATED_AT}
    FROM lab_updated_home_collection_payments p
    LEFT JOIN lab_updated_order_home_collections h ON h.id = p.home_collection_id
    ON CONFLICT (id) DO NOTHING
    RETURNING id`
  );
  return { tests: tests.length, home: home.length };
}

/** Per source: the old table's total and latest status/mode/notes must equal the ledger's. */
async function checkParity(
  tx: Tx,
  oldTable: string,
  sourceColumn: string,
  sourceType: string
) {
  const oldT = sql.raw(oldTable);
  const sourceCol = sql.raw(`p.${sourceColumn}`);
  return rows(
    tx,
    sql`
    WITH old_total AS (
      SELECT ${sourceCol} AS source_id, SUM(COALESCE(p.price, 0)) AS total FROM ${oldT} p GROUP BY 1
    ), old_latest AS (
      SELECT DISTINCT ON (${sourceCol}) ${sourceCol} AS source_id, p.payment_status::text AS status,
        p.payment_mode AS mode, LEFT(p.payment_notes, 50) AS notes
      FROM ${oldT} p ORDER BY ${sourceCol}, p.updated_at DESC, p.created_at DESC, p.id DESC
    ), new_total AS (
      SELECT e.source_id, SUM(e.amount_paise) / 100 AS total FROM money_entries e
      WHERE e.source_type = ${sql.raw(`'${sourceType}'`)} GROUP BY 1
    ), new_latest AS (
      SELECT DISTINCT ON (e.source_id) e.source_id,
        CASE WHEN e.entry_type = 'payment' THEN 'paid' WHEN e.reason = 'Payment failed' THEN 'failed'
          ELSE 'pending' END AS status,
        e.payment_mode AS mode, e.payment_notes AS notes
      FROM money_entries e WHERE e.source_type = ${sql.raw(`'${sourceType}'`)}
      ORDER BY e.source_id, e.created_at DESC, e.id DESC
    )
    SELECT ot.source_id, ot.total AS old_total, nt.total AS new_total,
      ol.status AS old_status, nl.status AS new_status, ol.mode AS old_mode, nl.mode AS new_mode
    FROM old_total ot
    JOIN old_latest ol ON ol.source_id = ot.source_id
    LEFT JOIN new_total nt ON nt.source_id = ot.source_id
    LEFT JOIN new_latest nl ON nl.source_id = ot.source_id
    WHERE nt.total IS DISTINCT FROM ot.total
       OR nl.status IS DISTINCT FROM ol.status
       OR nl.mode IS DISTINCT FROM ol.mode
       OR nl.notes IS DISTINCT FROM ol.notes`
  );
}

async function main() {
  say(apply ? 'APPLY: writing money_entries' : 'DRY RUN: nothing is kept');
  try {
    await database.transaction(async (tx) => {
      const copied = await copy(tx);
      say(
        `Copied ${copied.tests} lab test rows, ${copied.home} home collection rows (already-copied rows skipped).`
      );
      const testDiffs = await checkParity(
        tx,
        'lab_updated_payments',
        'lab_order_id',
        'lab_test'
      );
      const homeDiffs = await checkParity(
        tx,
        'lab_updated_home_collection_payments',
        'home_collection_id',
        'lab_home_collection'
      );
      say(`Lab test mismatches: ${testDiffs.length}`);
      for (const d of testDiffs.slice(0, 20)) say('  ', JSON.stringify(d));
      say(`Home collection mismatches: ${homeDiffs.length}`);
      for (const d of homeDiffs.slice(0, 20)) say('  ', JSON.stringify(d));
      if (!apply) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
