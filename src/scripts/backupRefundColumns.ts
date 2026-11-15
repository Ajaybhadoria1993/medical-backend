// Finance rebuild 6c-2: save appointment_payments refund columns before the migration drops them.
// Usage: NODE_ENV=<env> npx tsx src/scripts/backupRefundColumns.ts (run moneyParity.ts first; it must show 0).
import { writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';

const env = process.env.NODE_ENV || 'development';

async function main() {
  const cols = await database.execute<{
    name: string;
  }>(sql`SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_name = 'appointment_payments'
      AND column_name IN ('refunded_amount', 'refund_mode', 'refund_notes')`);
  if (cols.length < 3) {
    console.info(
      `[${env}] The refund columns are already gone. Nothing to back up.`
    );
    return;
  }

  const rows = [
    ...(await database.execute(sql`SELECT id, appointment_id, payment_status,
      refunded_amount, refund_mode, refund_notes
      FROM appointment_payments
      WHERE refunded_amount IS NOT NULL OR refund_mode IS NOT NULL OR refund_notes IS NOT NULL`)),
  ];

  // Outside the repo, so patient payment data is never committed.
  const file = join(homedir(), `6c_refund_columns_${env}_${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 2));
  console.info(
    `[${env}] ${rows.length} rows with refund values saved: ${file}`
  );
  console.info('Now generate and run the migration that drops the 3 columns.');
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
