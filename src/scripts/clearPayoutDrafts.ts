// Payout data clean-up: clears stored forms of active accounts and masks full bank numbers in history.
// Local: NODE_ENV=<env> npx tsx src/scripts/clearPayoutDrafts.ts [--apply]; server: docker exec <app> node dist/scripts/clearPayoutDrafts.js [--apply].
import { sql } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';

const apply = process.argv.includes('--apply');

const count = async (query: ReturnType<typeof sql>) =>
  ((await database.execute(query)) as unknown as { n: number }[])[0]?.n ?? 0;

async function main() {
  const drafts = sql`route_status = 'ACTIVE' AND onboarding_draft_data IS NOT NULL`;
  // Razorpay test mode returned full numbers; only the last 4 digits may stay. UPI rows are already masked.
  const fullNumbers = sql`bank_name IS DISTINCT FROM 'UPI' AND masked_account_number ~ '[0-9]{5,}'`;

  const draftCount = await count(
    sql`SELECT COUNT(*)::int AS n FROM clinic_payment_accounts WHERE ${drafts}`
  );
  const numberCount = await count(
    sql`SELECT COUNT(*)::int AS n FROM clinic_bank_history WHERE ${fullNumbers}`
  );
  console.info(
    `Active payout accounts still holding a stored form: ${draftCount}`
  );
  console.info(
    `Bank history rows holding a full account number: ${numberCount}`
  );
  if (!apply) {
    if (draftCount || numberCount)
      console.info('Run again with --apply to clean them.');
    return;
  }
  await database.execute(
    sql`UPDATE clinic_payment_accounts SET onboarding_draft_data = NULL, updated_at = NOW() WHERE ${drafts}`
  );
  await database.execute(sql`
    UPDATE clinic_bank_history
    SET masked_account_number = 'XXXX' || RIGHT(REGEXP_REPLACE(masked_account_number, '[^0-9]', '', 'g'), 4),
        updated_at = NOW()
    WHERE ${fullNumbers}`);
  console.info(
    `Cleared ${draftCount} forms and masked ${numberCount} account numbers. Done.`
  );
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
