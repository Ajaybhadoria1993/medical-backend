-- Hand-ordered per docs/payments/FINANCE_REBUILD_PLAN.md (0a): money_entries already has rows,
-- so the 3 new columns go in nullable, get filled, then become NOT NULL.
CREATE TYPE "public"."money_account" AS ENUM('clinic', 'patient_receivable', 'desk_cash', 'gateway_clearing', 'clinic_fees', 'convenience_fee', 'platform_commission', 'gst_on_platform_fees', 'pg_fee', 'route_fee', 'clinic_output_gst', 'clinic_payout', 'platform_payout');--> statement-breakpoint
CREATE TYPE "public"."money_side" AS ENUM('debit', 'credit');--> statement-breakpoint
ALTER TABLE "financial_ledgers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "financial_ledgers" CASCADE;--> statement-breakpoint
ALTER TABLE "money_entries" DROP CONSTRAINT "money_entries_reason_ck";--> statement-breakpoint
ALTER TABLE "money_entries" DROP CONSTRAINT "money_entries_online_ref_ck";--> statement-breakpoint
DROP INDEX "money_entries_request_uq";--> statement-breakpoint

-- 1. New columns, nullable first
ALTER TABLE "money_entries" ADD COLUMN "journal_id" uuid;--> statement-breakpoint
ALTER TABLE "money_entries" ADD COLUMN "account" "money_account";--> statement-breakpoint
ALTER TABLE "money_entries" ADD COLUMN "side" "money_side";--> statement-breakpoint

-- 2. Existing rows become clinic lines, one journal each
UPDATE "money_entries" e SET journal_id = e.id, account = 'clinic',
  side = (CASE
    WHEN e.entry_type IN ('charge','payment','advance','paid_at_visit') THEN 'credit'
    WHEN e.entry_type IN ('refund','write_off') THEN 'debit'
    WHEN (SELECT t.entry_type FROM money_entries t WHERE t.id = e.reverses_entry_id)
         IN ('charge','payment','advance','paid_at_visit') THEN 'debit'
    ELSE 'credit' END)::money_side;--> statement-breakpoint

-- Counter lines reuse the request id, so the unique key includes the account before they go in
CREATE UNIQUE INDEX "money_entries_request_uq" ON "money_entries" USING btree ("clinic_id","request_id","account");--> statement-breakpoint

-- 3. Their counter lines, so every old journal balances
INSERT INTO money_entries (journal_id, account, side, clinic_id, patient_id, doctor_id, source_type, source_id,
  line_ref, entry_type, amount_paise, payment_mode, channel, gateway_ref, request_id, reverses_entry_id,
  reason, approved_by, created_by, created_at)
SELECT e.id,
  (CASE WHEN COALESCE(t.entry_type, e.entry_type) IN ('charge','write_off','paid_at_visit') THEN 'patient_receivable'
        WHEN e.channel = 'online' THEN 'gateway_clearing' ELSE 'desk_cash' END)::money_account,
  (CASE WHEN e.side = 'credit' THEN 'debit' ELSE 'credit' END)::money_side,
  e.clinic_id, e.patient_id, e.doctor_id, e.source_type, e.source_id, e.line_ref, e.entry_type, e.amount_paise,
  e.payment_mode, e.channel, e.gateway_ref, e.request_id, e.reverses_entry_id, e.reason, e.approved_by,
  e.created_by, e.created_at
FROM money_entries e LEFT JOIN money_entries t ON t.id = e.reverses_entry_id
WHERE e.account = 'clinic';--> statement-breakpoint

-- 4. Now required; indexes, FK and checks scoped to clinic lines
ALTER TABLE "money_entries" ALTER COLUMN "journal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "money_entries" ALTER COLUMN "account" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "money_entries" ALTER COLUMN "side" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_config_versions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_reverses_entry_id_money_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."money_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_bank_history_clinic_active_idx" ON "clinic_bank_history" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE INDEX "money_entries_journal_idx" ON "money_entries" USING btree ("journal_id");--> statement-breakpoint
ALTER TABLE "appointment_payments" DROP COLUMN "refund_mode";--> statement-breakpoint
ALTER TABLE "appointment_payments" DROP COLUMN "refunded_amount";--> statement-breakpoint
ALTER TABLE "appointment_payments" DROP COLUMN "refund_notes";--> statement-breakpoint
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_reason_ck" CHECK ("money_entries"."account" <> 'clinic' OR "money_entries"."entry_type"::text IN ('charge', 'payment', 'advance', 'paid_at_visit') OR "money_entries"."reason" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_online_ref_ck" CHECK ("money_entries"."account" <> 'clinic' OR "money_entries"."channel" = 'desk' OR "money_entries"."entry_type" NOT IN ('payment', 'refund') OR "money_entries"."gateway_ref" IS NOT NULL);--> statement-breakpoint

-- 5. Debits = credits per journal, checked at commit
CREATE OR REPLACE FUNCTION money_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(SUM(CASE WHEN side = 'debit' THEN amount_paise ELSE -amount_paise END), 0)
      FROM money_entries WHERE journal_id = NEW.journal_id) <> 0 THEN
    RAISE EXCEPTION 'money journal % does not balance', NEW.journal_id;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER money_journal_balanced AFTER INSERT ON money_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION money_journal_balanced();--> statement-breakpoint

-- 6. Add-only ledger: no edit, no delete
CREATE OR REPLACE FUNCTION money_entries_no_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'money_entries is add-only: post a reversing entry instead'; END $$;--> statement-breakpoint
CREATE TRIGGER money_entries_no_change BEFORE UPDATE OR DELETE ON money_entries
  FOR EACH ROW EXECUTE FUNCTION money_entries_no_change();
