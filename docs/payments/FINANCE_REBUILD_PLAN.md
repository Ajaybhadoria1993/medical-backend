# Finance section + clinic Razorpay onboarding — review and plan

Status: **Q1–Q8 decided, 2c approved, Q9 on hold (owner, 2026-11-12). Plan only: no code until the owner says start.**
Related: `MONEY_LEDGER_PHASE2_PLAN.md` (money ledger), `CLINIC_LINKED_ACCOUNT_FRONTEND_INTEGRATION_GUIDE.md` (onboarding FE), `../clinic/CLINIC_FINANCE_DASHBOARD_API.md` (finance API).

## 1. Clinic Razorpay onboarding

**Method: correct.** Razorpay **Route with Linked Accounts** — the standard setup for a platform that collects for many businesses.
- Onboarding: create account → stakeholder → Route product with the clinic's bank → KYC documents → Razorpay activates.
- Patient payment: the order carries `transfers` to the clinic's account; Razorpay splits and pays the clinic.
- Refund: `reverse_all_transfers` pulls the clinic's share back.

**Problems found (code read, 2026-11-12):**

| # | Problem | Impact |
|---|---|---|
| R1 | Two handlers for account events with opposite results: via the subscription webhook URL (`clinic/services/paymentAccountWebhook.service.ts`) `account.activated` → **ACTIVE**; via the patient-appointments URL (`ClinicService.handleRazorpayAccountWebhook`) the same event → **PENDING** (correct: account activated ≠ Route activated) | A clinic can show Active before it can receive money; the result depends on which URL Razorpay calls |
| R2 | Different event names per handler: `product.route.activated` vs `product.activated` / `product.rejected` / `product.needs_clarification`; `account.suspended` in one only | Rejected / needs clarification / suspended can be missed |
| R3 | Razorpay events arrive at 3 URLs: `/api/v2/subscription/webhooks/razorpay`, old `/api/v1/subscription/razorpay`, `/api/v1/patient/appointments/webhook`. Settlement, transfer and dispute events are handled only on the patient URL | An event ticked on the wrong webhook is silently lost |
| R4 | Onboarding lives inside `clinic.service.ts` (~4,000 lines), no tests of its own | Risky to change |
| R5 | No daily check of appointment payments / settlements against Razorpay (subscriptions have PaymentCheck) | A missed webhook stays wrong |

## 2. Finance section (FE `pages/finance/`)

Tabs today: Overview, Transactions, Refunds & Cancellations, Payout & Settlement, Disputes (Fee transparency hidden).
Good: totals come from the money ledger (`MoneyReadService`); CSV export, refund review queue and dispute evidence exist.

| Item | Problem |
|---|---|
| Fee transparency tab | Hidden; code and endpoints remain |
| Custom date picker | Cancel resets to Today, not the previous range |
| Tabs | `role="tab"` without `tablist` / `tabpanel` / `aria-controls` |
| Shared components | 24 raw `<button>` / `<input>`; 71 hard-coded palette colours (`amber-`, `emerald-`, `red-`), mostly Revenue and Payout |
| `PayoutAccountView` | Never shown (dead code) |
| `helpers/mockFinanceData.ts` | Empty file |
| Revenue chart booked / completed / cancelled toggle | Appointment counts, not money — belongs in Reports |
| Date filter default **Today** | Finance is read by month |
| Refunds issued as its own tab | Same money list as Transactions, filtered |
| "Change Policy Rules" on the Refunds tab | Set-once setting → Settings (UX rules §3) |
| Payout tab mixes 5 onboarding states with settlement history | Two jobs on one tab; onboarding also at `/link-clinic-account` |
| File size | `PayoutSettlementSection` 1,211 lines, `RevenueBreakdownSection` 1,002 lines |

### FE playbook check (`FRONTEND_STANDARDS.md` §16, grep of `pages/finance/`, 2026-11-12)

| Rule | Found | Fix in step 5 |
|---|---|---|
| Colour traps (§8) | 2 `dark:…slate-N`, 5 `bg-white`, 8 `bg-{color}-50/100`; 71 hard-coded palette colours | Theme tokens |
| Typography (§12) | 65 hand-sized `text-[Npx]` | 7-step type scale |
| Primitives (§10) | 2 raw HeroUI `Button`, 24 raw `<button>`/`<input>`, badges as raw `Chip` | `AppButton`, `InputField`, `StatusChip` |
| Charts (§16) | 8 fixed `h-[Npx]` | Height on the card |
| Focus (§13) | 5 `outline-none` (check each has a `focus-visible` ring) | Keep focus rings |
| Tabs (§13) | `role="tab"` without `tablist` / `tabpanel` / `aria-controls` | Proper tabs |
| Types (§4) | 11 inline `interface`/`type` in `.tsx` | `src/types/finance/` |
| API calls (§6) | Finance summary fetched twice (page + Payout tab); clinic + user fetched only for the clinic name | Fetch once, pass down |
| Hygiene (§7) | Commented-out Fee tab, dead `PayoutAccountView`, empty mock file | Delete |
| Dashboards (§10) | Revenue toggle shows appointment counts, not money | Remove; counts live in Reports |
| Default range | Today | This month |

Clean: no `console.log`, no polling, no `bg-opacity-`, no `dark:bg-[#`.
Done-check for step 5: §16 checklist and IDE diagnostics by the dev; `npx eslint` and the light + dark + keyboard browser pass run by the owner (or by the dev when asked).

## 2b. The second ledger: `financial_ledgers` (first priority)

Two money tables exist today:

| Table | Job | Written by | Read by |
|---|---|---|---|
| `money_entries` (`src/main/money/`) | The clinic's money with the patient: charges, payments, refunds | `money` module only | Finance, Dashboard, Reports, Payment History |
| `financial_ledgers` (`appointments/models/financialLedger.model.ts`) | The **gateway split** of an online payment: commission, GST, PG fee, convenience fee, transfer to the clinic, transfer reversal | **4 modules, 5 copies of the same code**: `appointments/paymentReservation.service.ts`, `patient/patient.service.ts` (2 copies), `cancellation-policy/cancellationPolicy.service.ts`, `clinicFinance/refundReview.service.ts` | **No screen.** Only the writers' own duplicate checks and `scripts/backfillMoneyLedger.ts` |

Found against the Phase 2 decision D6 (keep it, Finance reads it):
- Nothing reads it: the Fee summary reads `fee_config_versions` (rates), not the ledger.
- `PAYMENT_RECEIVED` / `REFUND` stopped on purpose in Phase 2.6 (duplicates of `money_entries`); backfill check 2 still expects them, so the check is stale.
- The D6 refund rules (`PG_FEE_RETAINED`, commission/GST reversal, gateway-reported amounts) were never built; reversals assume the full refund.
- Amounts are `decimal` with `parseFloat`, not paise.

**Options (owner decides, Q5):**
- **A — Merge and remove:** the split becomes entry types in `money_entries` (kept out of clinic revenue), one writer, `financial_ledgers` dropped after a backfill. One ledger; touches the revenue reader, so needs a parity check.
- **B — Keep, one writer (recommended):** `financial_ledgers` stays for the split only; one writer in the `payment` module (D6) writes it (paise, idempotent by payment + type + gateway id; split rows only, no `PAYMENT_RECEIVED`); the 5 copies call it; refunds record what Razorpay reports; Payouts / Fees read it. Revenue untouched.

## 2c. Option A design — one double-entry ledger (approved by owner, 2026-11-12)

Online appointment payments are **not live with real clinics** (owner, 2026-11-12): `financial_ledgers` holds test data only, so no history migration is needed.

**Idea:** every money event is one **journal** of lines in `money_entries`; debits = credits per journal.
Example, ₹500 visit; the patient pays every fee (today's behaviour, Q10): ₹20 convenience, ₹25 commission, ₹8.10 GST on them, ₹10 PG fee → ₹563.10 online.

| journal | account | debit | credit |
|---|---|---|---|
| payment (`record()`) | `gateway_clearing` (Razorpay holds it) | 500.00 | |
| payment (`record()`) | `clinic` (revenue; Razorpay transfers the full ₹500) | | 500.00 |
| fees (`post()`) | `gateway_clearing` | 63.10 | |
| fees (`post()`) | `convenience_fee` | | 20.00 |
| fees (`post()`) | `platform_commission` | | 25.00 |
| fees (`post()`) | `gst_on_platform_fees` | | 8.10 |
| fees (`post()`) | `pg_fee` (Route fee would go to `route_fee`) | | 10.00 |

`clinic_fees` is used only for a cost the clinic bears: the PG fee Razorpay keeps on a refund (D8).

`clinic` lines are never debited for fees, so revenue stays the full clinic amount (readers use `entry_type` for direction, not `side`).
Desk payment ₹500: `desk_cash` debit 500 / `clinic` credit 500.
Desk charge ₹500 (no money moves): `patient_receivable` debit 500 / `clinic` credit 500 (`entry_type = charge`).
Exact online lines follow today's split math (`payment/engine/dynamicSplit.engine.ts`: P, gstOnP, F, G1, CC, G2, RG, G3, RT, G4), checked in tests.

**Counter line per entry type** (`record()`): `charge`, `write_off`, `paid_at_visit` → `patient_receivable`; `payment`, `advance`, `refund` → `desk_cash` (desk) or `gateway_clearing` (online); `adjustment` → mirror of the entry it reverses.
**Side of the clinic line**: `charge`, `payment`, `advance`, `paid_at_visit` → credit; `refund`, `write_off` → debit; `adjustment` → opposite of its target. The counter line takes the other side.

### DB changes (model only; owner generates and runs the migration)
- `money_entries` new columns:
  - `journal_id uuid NOT NULL`: groups the lines of one event;
  - `account` enum: `clinic`, `patient_receivable`, `desk_cash`, `gateway_clearing`, `clinic_fees`, `convenience_fee`, `platform_commission`, `gst_on_platform_fees` (G1 + G2), `pg_fee` (RG + G3), `route_fee` (RT + G4), `clinic_output_gst` (gstOnP, the clinic's own GST), `clinic_payout`, `platform_payout` (Q7: settlement webhook writes them; `gateway_clearing` returns to zero). Separate GST accounts so step 7's invoice reads platform GST alone;
  - `side` enum: `debit` / `credit`.
- Existing rows: `account = 'clinic'`, `journal_id = id`, side from `entry_type`; the migration adds the matching `desk_cash` / `gateway_clearing` line so old journals balance.
- Unique `(clinic_id, request_id)` → `(clinic_id, request_id, account)`, so a retry still returns the first journal.
- Checks that only mean something for clinic money (reason, online gateway ref) apply to `account = 'clinic'` lines; receipt numbers only on clinic lines.
- Balance rule: deferred constraint trigger, debits = credits per `journal_id` at commit.
- No edit / no delete trigger on `money_entries` (Phase 2 P2).
- `financial_ledgers`: no backfill (test data only); dropped by the owner in 0d.

#### 0a migration SQL (owner: generate with Drizzle, then edit the generated file to this order)

Drizzle cannot add the 3 required columns to a table that has rows, and does not write triggers. Run in one migration:

```sql
-- 1. Types and columns (nullable first)
CREATE TYPE money_account AS ENUM ('clinic','patient_receivable','desk_cash','gateway_clearing','clinic_fees',
  'convenience_fee','platform_commission','gst_on_platform_fees','pg_fee','route_fee','clinic_output_gst',
  'clinic_payout','platform_payout');
CREATE TYPE money_side AS ENUM ('debit','credit');
ALTER TABLE money_entries ADD COLUMN journal_id uuid, ADD COLUMN account money_account, ADD COLUMN side money_side;

-- 2. Existing rows become clinic lines, one journal each
UPDATE money_entries e SET journal_id = e.id, account = 'clinic',
  side = (CASE
    WHEN e.entry_type IN ('charge','payment','advance','paid_at_visit') THEN 'credit'
    WHEN e.entry_type IN ('refund','write_off') THEN 'debit'
    WHEN (SELECT t.entry_type FROM money_entries t WHERE t.id = e.reverses_entry_id)
         IN ('charge','payment','advance','paid_at_visit') THEN 'debit'
    ELSE 'credit' END)::money_side;
-- Counter lines reuse the request id, so the unique key gains the account first
DROP INDEX money_entries_request_uq;
CREATE UNIQUE INDEX money_entries_request_uq ON money_entries (clinic_id, request_id, account);

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
WHERE e.account = 'clinic';

-- 4. Required, indexes, FK, checks scoped to clinic lines
ALTER TABLE money_entries ALTER COLUMN journal_id SET NOT NULL, ALTER COLUMN account SET NOT NULL,
  ALTER COLUMN side SET NOT NULL;
CREATE INDEX money_entries_journal_idx ON money_entries (journal_id);
ALTER TABLE money_entries ADD CONSTRAINT money_entries_reverses_entry_id_money_entries_id_fk
  FOREIGN KEY (reverses_entry_id) REFERENCES money_entries(id) ON DELETE RESTRICT;
ALTER TABLE money_entries DROP CONSTRAINT money_entries_reason_ck, ADD CONSTRAINT money_entries_reason_ck
  CHECK (account <> 'clinic' OR entry_type::text IN ('charge','payment','advance','paid_at_visit') OR reason IS NOT NULL);
ALTER TABLE money_entries DROP CONSTRAINT money_entries_online_ref_ck, ADD CONSTRAINT money_entries_online_ref_ck
  CHECK (account <> 'clinic' OR channel = 'desk' OR entry_type NOT IN ('payment','refund') OR gateway_ref IS NOT NULL);

-- 5. Debits = credits per journal, checked at commit
CREATE FUNCTION money_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(SUM(CASE WHEN side = 'debit' THEN amount_paise ELSE -amount_paise END), 0)
      FROM money_entries WHERE journal_id = NEW.journal_id) <> 0 THEN
    RAISE EXCEPTION 'money journal % does not balance', NEW.journal_id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER money_journal_balanced AFTER INSERT ON money_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION money_journal_balanced();

-- 6. No edit, no delete
CREATE FUNCTION money_entries_no_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'money_entries is add-only: post a reversing entry instead'; END $$;
CREATE TRIGGER money_entries_no_change BEFORE UPDATE OR DELETE ON money_entries
  FOR EACH ROW EXECUTE FUNCTION money_entries_no_change();
```

After running: Payment History, Finance, Dashboard and Reports totals must be unchanged (`moneyParity.ts`).

### Code
- `MoneyWriteService.record()` keeps its signature for desk money: it writes the clinic line plus its counter line (table above), same journal. Its idempotency, per-source lock, caps and receipt numbers stay.
- New `MoneyWriteService.post(tx, journal)` for online money: clinic line + split lines in one journal; rejects an unbalanced journal before the DB does.
- Refunds, transfer reversals, D8 refund rows (PG fee retained; commission + GST reversed only on a full refund before the visit; convenience fee not refunded) and chargebacks (D9) are reversing journals.
- `MoneyReadService` and `balanceOf` read `account = 'clinic'` only, so revenue figures do not change (`moneyParity.ts` proves it). Payouts / fees read the other accounts.

### Steps (one reviewable change each)
- **0a** Model columns + 2 triggers (SQL note for the owner's migration) + `post()` + `record()` counter line + reads filtered to `clinic`. Tests in `money/__tests__/`: split math (patient total = clinic + convenience fee; clinic = transfer + commission + GST + PG fee), journal balance, retry returns the first journal, reads unchanged.
- **0b** Switch the 5 writers to `post()`: `paymentReservation.service.ts`, `patient.service.ts` (2), `cancellationPolicy.service.ts`, `refundReview.service.ts`; remove their duplicate checks.
- **0c** Remove stale backfill check 2 in `scripts/backfillMoneyLedger.ts`; point Payouts / fee reads at the new accounts; owner runs `moneyParity.ts` on staging.
- **0d** Owner drops `financial_ledgers`; delete `financialLedger.model.ts` and its export in `appointments/models/index.ts`.

### Risks
- Every reader of `money_entries` must filter `account = 'clinic'` (self-joins on `reverses_entry_id` and subqueries too), or totals double. Raw-SQL readers found 2026-11-12: `money/services/moneyRead.service.ts`, `money/utils/visitMoneySql.ts`, `clinicFinance/services/clinicFinance.service.ts`, `clinicFinance/services/settlement.service.ts`, `reportsOverview/services/reportsRevenue.service.ts`, `dashboard/utils/revenueSql.ts`, `treatmentPlan/services/plans/planMoney.service.ts`, `scripts/backfillMoneyLedger.ts`, `scripts/moneyParity.ts`; plus every Drizzle `MoneyEntryModel` query.
- The deferred trigger only checks at commit, so `post()` validates balance first for a clear error.

### DB model (agreed; ✚ new column, ❌ to delete)

```
┌──────────────────────── money module (the one ledger) ────────────────────────┐
│  money_entries   (add-only: UPDATE / DELETE blocked by a DB rule)             │
│  ├─ id                uuid  PK                                                │
│  ├─ journal_id    ✚   uuid  ── groups the lines of one payment                │
│  ├─ account       ✚   enum  clinic | desk_cash | gateway_clearing |           │
│  │                          convenience_fee | platform_commission |           │
│  │                          gst_payable | pg_fee | clinic_payout ✚ |         │
│  │                          platform_payout ✚                                 │
│  ├─ side          ✚   enum  debit | credit                                    │
│  ├─ clinic_id         uuid  → clinics                                         │
│  ├─ patient_id, doctor_id                                                     │
│  ├─ source_type       enum  appointment | treatment_plan                      │
│  ├─ source_id, line_ref                                                       │
│  ├─ entry_type        enum  charge | payment | refund | write_off |           │
│  │                          adjustment | advance | paid_at_visit              │
│  ├─ amount_paise      bigint  > 0                                             │
│  ├─ channel           desk | online      payment_mode                         │
│  ├─ receipt_no        R-YYYY-NNNNNN (clinic lines only)                       │
│  ├─ gateway_ref       Razorpay payment / refund / transfer id                 │
│  ├─ request_id        unique (clinic_id, request_id, account ✚)               │
│  ├─ reverses_entry_id → money_entries.id ✚ FK                                 │
│  └─ reason, approved_by, created_by, created_at (timestamptz)                 │
│  Rules: debits = credits per journal_id · no edit / no delete                 │
│                                                                               │
│  receipt_sequences   (clinic_id, year) PK → last_no                           │
└───────────────────────────────────────────────────────────────────────────────┘
          ▲ gateway_ref links to Razorpay ids
┌─ appointments ─────────────┐   ┌─ clinicFinance ──────────────────────────────┐
│ appointment_payments       │   │ clinic_settlements → clinic_settlement_items │
│  (bill + payment status)   │   │ refund_reviews     → refund_review_documents │
│ financial_ledgers   ❌     │   │ payment_disputes   → payment_dispute_evidence│
└────────────────────────────┘   └──────────────────────────────────────────────┘
┌─ payment ──────────────────┐   ┌─ clinic (→ payment/payoutAccount, step 3) ──┐
│ fee_config_versions (rates)│   │ clinic_payment_accounts (Route status)       │
│ payment_intents            │   │ clinic_razorpay_accounts  ❌                 │
│ payment_transactions       │   │ clinic_commissions        ❌                 │
└────────────────────────────┘   └──────────────────────────────────────────────┘
┌─ subscription (kept as is) ───────────────────────────────────────────────────┐
│ subscription_webhook_events (unique event_id)                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Delete ❌ | When |
|---|---|
| `financial_ledgers` | 0d, after writers move to `money_entries` |
| `clinic_razorpay_accounts`, `clinic_commissions` | Step 6, after a backup |

Later (agreed, not in this phase): paise + timestamptz in `clinic_settlements`, `refund_reviews`, `payment_disputes`, `appointment_payments`; one shared Razorpay events table.

### Future: lab and pharmacy (no change now; owner, 2026-11-12)

The ledger stays clinic-only until the owner says (see "Out of scope"). When lab / pharmacy join, add:

| Need | Change |
|---|---|
| Lab money is keyed by `labId` (labs split from clinics) | `lab_id` column; check "clinic **or** lab" set |
| Pharmacy walk-in sales may have no patient | `patient_id` optional for pharmacy only |
| Pharmacy prices include GST (government's money) | `gst_output` account |
| Pharmacy GST invoices, lab bill numbers | Receipt series per source, not per clinic |
| New sources | `lab`, `pharmacy` values in `money_source` |

Now (0a): readers filter by account and source without assuming only two sources, so new sources need no reader rewrite.

### Module rules (BACKEND_STANDARDS §1, bounded module)
- `money` owns the ledger; other modules call only `money/index.ts` (`post(journal)`), never its models.
- `financialLedger.model.ts` leaves `appointments`; the 4 writers stop importing it.
- `dashboard/utils/revenueSql.ts` reaches into `money/` internals → import from `money/index.ts`.
- `clinicFinance` imports `payment/services` internals → use `payment/index.ts`.
- Module jobs (Q16): `money` ledger · `payment` Razorpay, fee engine, payout setup, the one webhook URL · `clinicFinance` Finance screens, settlements, disputes, refund reviews · `cancellation-policy` refund rules (incl. its settings, Q15).
- New tests go in `__tests__/`; one-line comments.
- §7 "Money figures" still describes the old `CLINIC_AMOUNT` / visit-day rule; update it to the ledger (D2, day received).

## 3. Plan (one step = one reviewable change)

**Rules for every step (Q17, owner 2026-11-12):**
- **Order:** 0a → 0b → **4 (daily check)** → 0c → 0d → 1 → 2 → 3 → 5 → 6 → 7 → 8 → 9 → 10. Step 4 runs right after 0b so a lost webhook is caught before real online money flows.
- **Safety gate (money steps):** backup → staging → DB checks + `moneyParity.ts` → browser check → prod.
- **Migrations:** a step that changes a table ships a ready-to-run edited SQL for dev, staging and prod (Drizzle cannot fill required columns or write triggers), flagged at the top of the hand-over.
- **Q9 (TDS) is answered before step 9**, since it can change payout amounts.

0. **Sync the gateway split (BE, first priority).** Per Q5, in line with `MONEY_LEDGER_PHASE2_PLAN.md` D6/D8 and safeguards P1 (daily gateway match) and P2 (no-edit trigger), which are still open there. Includes D8 refund rows, removing stale backfill check 2, and tests for the split math (patient total = clinic amount + convenience fee; clinic amount = transfer + commission + GST + PG fee).

1. **Fix onboarding webhooks (BE, bug first).** One handler for all account / Route events from every URL. ACTIVE only when Route is activated; rejected, needs clarification and suspended handled; status confirmed by reading Razorpay. Tests per event.
2. **One Razorpay webhook URL (BE).** One endpoint routing by event family: subscription, appointment payment, account / Route, settlement / transfer, dispute. Old URLs keep working until Razorpay is switched, then removed.
3. **Payout setup into the payment module (BE + FE, Q14).** Onboarding moves from `clinic.service.ts` to `payment/services/payoutAccount/` (gateway work, no new module), with tests. Q6 = yes: one form + one status card (BE runs the 4 Razorpay calls, safe to retry from the step that failed).
4. **Daily appointment-payment check (BE; runs right after 0b, Q17).** One cron registry entry; shows in System jobs.
5. **Finance to 4 tabs (FE).** Read the Frontend Design Spec first.
   - **Overview:** collected (cash / online), refunds, net, outstanding, next payout; one chart, daily or monthly by range; default **This month**.
   - **Transactions:** money in and out (payments + refunds) with filters and CSV; refund review queue on top when not empty.
   - **Payouts:** settlement history + one payout-account status card linking to `/link-clinic-account`.
   - **Disputes:** as today.
   - Remove: Fee transparency code, `PayoutAccountView`, mock file, booked/cancelled toggle. Refund policy rules → Settings; `clinicFinance/services/cancellationSettings.service.ts` moves into `cancellation-policy` (Q15: one owner of refund rules).
6. **Clean-up (owner-run migrations).** Money Phase 2.7 E (old refund columns); drop unused `clinic_razorpay_accounts`, `clinic_commissions` after a backup.
7. **Monthly GST tax invoice for platform fees (BE + FE, Q8).** Commission + GST per clinic per month from the ledger; PDF via `utils/pdf`.
8. **Monthly statement PDF (BE + FE, Q8).** Collected, fees, refunds, paid to bank; for the clinic's accountant.
9. **"Paid to your bank" with dates (FE, Q8).** From `clinic_payout` lines, on Payouts.
10. **Failed transfer / settlement alert (BE, Q8).** Notify the clinic admin and Super Admin through `notify()`.

**Code to remove (found 2026-11-12, removed in the step named):**

| What | Why | Step |
|---|---|---|
| `financial_ledgers` model + 5 duplicate writers | Replaced by journals in `money_entries` | 0b / 0d |
| Backfill check 2 (`scripts/backfillMoneyLedger.ts`) | Expects rows stopped in Phase 2.6 | 0c |
| `ClinicService.handleRazorpayAccountWebhook` or `paymentAccountWebhook.service.ts` (keep one) | Two handlers, opposite results (R1) | 1 |
| Old `POST /api/v1/subscription/razorpay` and patient webhook URL | Same handler as v2 / moves to the one URL | 2 (after Razorpay is switched) |
| `payment/services/reconciliationAuditor.service.ts` | Used only by its own test; step 4's daily check replaces it | 4 |
| FE `PayoutAccountView` (455 lines) | Never shown | 5 |
| FE `FeeTransparencySection` + its BE fee-summary / fee-transactions endpoints | Tab hidden; Payouts read the ledger accounts instead | 5 |
| FE `helpers/mockFinanceData.ts` | Empty file | 5 |
| FE revenue chart booked / completed / cancelled toggle | Counts, not money | 5 |
| Tables `clinic_razorpay_accounts`, `clinic_commissions` | No code uses them (only old prod schema) | 6 (owner, after backup) |

Cashfree: owner (2026-11-12) — not planned; remove `payment/adapters/cashfree.adapter.ts`, its factory entry, tests and `cashfree` payment-mode values (step 6; check no stored rows use it first).

Out of scope: pharmacy and lab money (not in the ledger until the owner says).

## 4. Decisions (owner)

| # | Question | Decision |
|---|---|---|
| Q1 | Finance 5 → 4 tabs, Refunds merged into Transactions? | **yes** (owner, 2026-11-12): one money list with filter All · Payments · Refunds; pending refund reviews as a box on top; badge moves to Transactions |
| Q2 | Refund policy rules move to Settings? | **yes** (owner, 2026-11-12): set-once setting; Transactions keeps a "Refund rules → Settings" link |
| Q3 | One Razorpay webhook URL (needs a Razorpay dashboard change)? | **yes, later** (owner, 2026-11-12): old URLs keep working until Razorpay is switched |
| Q4 | Order: Step 0 (ledger sync, owner's first priority), then Step 1 (webhook bug), then in order? | **yes** (owner, 2026-11-12): money data correct before screens change |
| Q5 | `financial_ledgers`: A merge into `money_entries` and drop, or B keep with one writer? | **A** (owner, 2026-11-12): one double-entry ledger; replaces Phase 2 D6. Design in 2c (approved) |
| Q6 | Clinic payout setup as **one form + one status card**? Clinic fills legal name, PAN, bank account, IFSC, holder name once; BE runs Razorpay's 4 calls (account → stakeholder → Route product with bank → KYC) in the background; card shows Verifying bank / Ready to receive payments / Action needed: reason. Done in step 3; replaces the step-by-step flow at `/link-clinic-account` and the Payout tab | **yes** (owner, 2026-11-12). Method stays Razorpay Route + Linked Accounts (standard; the platform never holds clinic money) |
| Q7 | Add ledger accounts `clinic_payout` (money sent to the clinic's bank) and `platform_payout` (platform share settled), written by the settlement webhook, so `gateway_clearing` returns to zero and Finance can show "paid to your bank"? Revenue still reads `clinic` lines only | **yes** (owner, 2026-11-12), part of step 0a |
| Q8 | New Finance items after step 5: (1) monthly GST tax invoice to the clinic for platform fees; (2) monthly statement PDF (collected, fees, refunds, paid to bank); (3) "Paid to your bank" with dates from payout lines; (4) alert when a transfer / settlement fails | **yes** (owner, 2026-11-12), steps 7–10 |
| Q10 | Who pays each online fee? | **Patient pays all fees, as today** (owner, 2026-11-12, corrected): the order total is price + every fee, Razorpay transfers the full price to the clinic, and every seeded `feePayer` is PATIENT. D8 covers refunds only. No engine fix step, no price change; optional later: the engine refuses a `feePayer` it cannot honour. 0b books every payment fee as patient-paid (`gateway_clearing`) |
| Q11 | Clinic GST on the consultation price (`gstOnP`) is not stored | **Save it on the appointment at booking** (owner, 2026-11-12), so 0b books it to `clinic_output_gst`; empty until then |
| Q12 | When to update BACKEND_STANDARDS §7 "Money figures" | **In 0c** (owner, 2026-11-12) |
| Q13 | Staging / prod timing for 0a | **After dev passes migration, money tests, parity and the browser check; 0a and 0b go to staging together** (owner, 2026-11-12) |
| Q14 | Payout setup (step 3): new `payoutAccount` module or inside `payment`? | **Inside `payment`** (owner, 2026-11-12): `payment/services/payoutAccount/`; linked accounts are gateway work, no 6th money module |
| Q15 | Refund rules have two editors (`clinicFinance/cancellationSettings.service.ts` and `cancellation-policy`) | **Move into `cancellation-policy`** in step 5 (owner, 2026-11-12) |
| Q16 | Merge money, payment, clinicFinance, cancellation-policy into one module? | **No** (owner, 2026-11-12): money = ledger, payment = Razorpay + fee engine + payout setup, clinicFinance = Finance screens + settlements / disputes / refund reviews, cancellation-policy = refund rules; subscription stays separate (platform billing) |
| Q17 | Make the rollout production-grade? | **yes** (owner, 2026-11-12): step 4 moves to right after 0b; safety gate on every money step; edited migration SQL for every env in each table-changing step; Q9 answered before step 9 |
| Q18 | 0b refunds: keep today's rule or build D8 (return commission + GST on a full refund before the visit)? | **Keep today's rule** (owner, 2026-11-12): a refund returns the consultation fee only; the platform keeps every fee; no fee reversal lines. D8 deferred (changes refund amounts) |
| Q19 | Old bookings without a fee snapshot | **Skip and log** (owner, 2026-11-12): test data only |
| Q20 | Step 4: where differences live, auto-fix, email, window | **Summary + log only; auto-fix the 2 safe cases; reuse the billing alert email; 3 days** (owner, 2026-11-12). A mismatch table + Super Admin list when real volume arrives |
| Q21 | Step 1: confirm with Razorpay before ACTIVE; on a failed check? | **Confirm first; a failed check keeps the status and logs** (owner, 2026-11-12) |
| Q22 | Step 2: URL, secrets, old URLs | **`/api/v1/payment/webhooks/razorpay`; accept both secrets until the dashboard merge; old URLs use the router now; removed after the owner confirms the switch** (owner, 2026-11-12) |
| Q23 | Step 3: split 3a–3d; documents in the one submit; keep Change bank; mobile app | **Yes / yes / yes; the owner updates the app team, so 3d waits for their go** (owner, 2026-11-12) |
| Q24 | 3b: stage failure response; bank digits; card wording | **200 + action-needed card (bad input 422); last 4 digits only; Not Set Up · Action Needed · Verifying Bank · Ready To Receive Payments · Suspended** (owner, 2026-11-12) |
| Q25 | 3c: folders, reuse sections, document preview, browser draft, checks | **pages/payment + components/payment; reuse the field sections; drop preview (file name + Replace); keep the draft; owner does the browser pass** (owner, 2026-11-12) |
| Q26 | Step 5 split, refund reviews UI, cancellation columns, old BE endpoints, default range | **5a then 5b; build the Refund Reviews box with a confirm; refund reason on refund rows only; old fee/cancellation endpoints removed with 3d; This Month** (owner, 2026-11-12) |
| Q27 | 5b: reuse Reports LineChart; money-only doctor/service view; split 5b-1 / 5b-2 | **Yes / yes / yes** (owner, 2026-11-12) |
| Q28 | Step 6 order and gates | **6a now; 6b with the next prod migration (backup first); 6c last, after the backfill has run on every env and the app team confirms the refund fields** (owner, 2026-11-12) |
| Q29 | Step 8: on demand, Admin only, fees as information, on Overview | **Yes to all; step 7 postponed** (owner, 2026-11-12) |
| Q9 | TDS under section 194-O on clinic payouts (e-commerce operator)? | **on hold** (owner, 2026-11-12): confirm with CA; not planned until answered |

## 5. Progress

| Step | Status |
|---|---|
| 0a | **Code done 2026-11-12, uncommitted.** Waiting on the owner's migration (SQL above), the money test files and the parity check |
| 0b | **Code done 2026-11-12, uncommitted.** One fee writer (`payment/services/onlineFeeLedger.service.ts`) books patient-paid fees from the booking snapshot in the payment's transaction; 5 old writers removed (refund reversal = the refund journal); no migration. Fee test 5/5, parity 0 differences |
| 4 | **Code done 2026-11-12, uncommitted.** Nightly `AppointmentPaymentCheck` (23:30 IST + at start): compares 3 days of Razorpay appointment payments / refunds with the ledger, fixes a missing payment on a Paid visit and missing fees, lists the rest in System jobs and the billing alert email (Redis hand-off). Lives in `clinicFinance` (fixing calls appointments; payment → appointments would be circular). Old `ReconciliationAuditor` removed; `getReconciliationReport` goes with Cashfree in step 6. Rules test 9/9. Dev run blocked: Razorpay rejects the dev test keys |
| 0c | **Done 2026-11-12, uncommitted.** Stale backfill check 2 removed; BACKEND_STANDARDS §7 "Money figures" rewritten for the ledger (Q12). Payout reads already use clinic lines (correct: clinic gets the full price); fee-screen reads go with the Fee tab in step 5; "paid to your bank" in step 9. Owner runs `moneyParity.ts` on staging |
| 0d | **Code done 2026-11-12, uncommitted.** `financialLedger.model.ts` and its export deleted; no reference left. Owner: backup, generate + run the drop migration per env (dev / staging / prod), file checked before running |
| 1 | **Code done 2026-11-12, uncommitted.** One handler (`clinic/services/paymentAccountWebhook.service.ts`) for account / Route events from both URLs; both Razorpay event names; ACTIVE only after Razorpay confirms Route (failed check keeps the status, Q21); a late event never moves ACTIVE back to PENDING; `ClinicService.handleRazorpayAccountWebhook` removed. Tests 10/10 |
| 2 | **Code done 2026-11-12, uncommitted.** New `POST /api/v1/payment/webhooks/razorpay`; one `RazorpayWebhookRouter` sends every event to its owner (subscription inbox / appointment confirm / onboarding / clinic finance); signature checked against either secret. The 3 old URLs call the same controller now. Owner: merge the two dashboard webhooks into one, then old URLs + second secret are removed (Q22). Tests 8/8 |
| 3a | **Code done 2026-11-12, uncommitted.** Route onboarding moved from `clinic.service.ts` (4,143 → 2,353 lines) to `payment/services/payoutAccount/` (setup, status, webhook) + `payment/utils/` (pure rules); no behaviour change, old `/clinic/...` endpoints call the moved code. Tests: onboarding 6/6, webhook 10/10, router 8/8, reset 9/9 (2 stale tests fixed) |
| 3b | **Code done 2026-11-12, uncommitted.** `GET/POST /api/v1/payment/payout-account` (status card; one multipart submit running account → documents → activation, resumable) + `PUT /payout-account/bank`; a Razorpay refusal returns 200 with the action-needed card, bad input 422 (Q24); onboarding lock moved to `payment/middlewares` and shared. Tests 17/17 |
| 3c | **Code done 2026-11-12, uncommitted (both repos).** FE: `paymentApi` slice; `/link-clinic-account` is one form (`pages/payment/PayoutAccountSetup.tsx`, 4 sections, one Set Up Payouts); one `PayoutAccountCard` on Finance → Payouts and online booking settings; change bank on `AppModal` + new PUT; old wizard, stepper, card, 1,245-line page and 5 old hooks deleted. BE: card carries the saved form for a retry. Document preview dropped (Q25). Owner: browser pass (light, dark, keyboard; 375 / 768 / 1366) |
| 5a | **Code done 2026-11-12, uncommitted (FE).** Finance has 4 tabs (Overview · Transactions · Payouts · Disputes), default This Month, custom-range Cancel restores the previous range, proper ARIA tabs + arrow keys; Transactions: Type filter (All · Payments · Refunds), refund reason under refund rows, Refund Reviews box (Approve / Decline with confirm), link to refund rules in Settings; removed Fee tab, Refunds tab, `PayoutAccountView`, mock file and 8 orphan hooks. Revenue chart's money-only rework moved to 5b (same 1,002-line file) |
| 5b-1 | **Code done 2026-11-12, uncommitted (FE).** Revenue section is money received only (`collected`, online / at desk): totals, By Day on the Reports `LineChart` (new optional series names + rupee tooltip), By Doctor / By Service tables; 1,002 → ~120 lines + 2 small components + `helpers/revenueDays.ts`; booked / completed / cancelled values removed (Reports has them) (Q27) |
| 5b-2 | **Code done 2026-11-12, uncommitted (FE).** Payout section 1,086 → ~125 lines + `payouts/SettlementKpis`, `SettlementTable`, `SettlementPayments` + `helpers/settlementRows.ts`; shared date formatters reused; page keyed to filters; state update during render fixed; row toggle is a button with aria-expanded; StatusChip; playbook pass on KPI strip, disputes, transactions table. Flagged, not changed: guessed payment count, made-up Expected payout row, browser KPI fallback (`ponytail:` comments) |
| 6a | **Code done 2026-11-12, uncommitted.** Cashfree adapter, factory entry and tests removed; checkout accepts only razorpay; adapter `getReconciliationReport` + its type removed; `.env.example` cleaned. Old rows reading "cashfree" still display. Dev has no Cashfree data; owner runs the same check on staging / prod before deploy |
| 8 | **Code done 2026-11-12, uncommitted (both repos).** BE: `GET /api/v1/clinic-finance/statements/:month` builds a PDF on request from `getSummary` + the settlement list (same figures as Finance; no table); Admin only; future month refused. FE: Monthly Statement card on Overview (month picker, View in the in-page viewer, Download saves); shared `useLocalPdfActions` hook, invoice preview uses it too. Tests 5/5 |
| 7 | **Postponed** (owner, 2026-11-12): a tax invoice needs one stored table (frozen number, amounts, parties; number from the year's highest under a lock, no counter table). Open: CA on commission-only and B2B GST |
| 10 | **Code done 2026-11-12, uncommitted.** `transfer.failed` / `transfer.reversed` → `payment.transfer_failed` via `notify()`: clinic Admins and Super Admins get bell + email (opens Finance → Payouts); not switchable. One alert per transfer per event (retried webhook sends none). No settlement-failed event exists for linked accounts. Tests 3/3 + registry contract |
| 3d | **Code done 2026-11-12, uncommitted (both repos).** Owner: the app team moves to the new endpoints (Q23). Removed 13 old routes with their controllers, the dead KYC preview (service + `fetchRazorpayDocumentContent`), `CancellationSettingsService`, 3 `ClinicFinanceService` methods, 2 schemas and their tests; FE stale types. Old callers get a plain 404. Old webhook URLs kept until Razorpay points at the one URL. Old → new: `POST /clinic/onboard-route`, `/activate-route`, `/onboard-documents` (+ `/:type/retry`) → `POST /payment/payout-account`; `GET /clinic/onboarding-status` → `GET /payment/payout-account`; `GET`/`PATCH /clinic/bank-details` → the card + `PUT /payment/payout-account/bank`; `GET /clinic/onboard-documents/:type/preview` → none (Q25); `GET /clinic-finance/fees/*` → `/clinic-finance/summary`; `GET /clinic-finance/cancellations` → `/clinic-finance/transactions` (refunds); `GET`/`PUT /clinic-finance/cancellation-settings` → `/cancellation-policy` |
| 6b | **Script ready 2026-11-12, owner runs.** `NODE_ENV=<env> npx tsx src/scripts/dropOldPayoutTables.ts` checks (rows, anything pointing at them); `--apply` saves the rows to a JSON file in the home folder, then drops both tables in one transaction (no CASCADE). Done once it has run on prod |
| 6c-1 | **Code done 2026-11-12, uncommitted (BE).** App team not waited on (owner updates them). Appointment list / details / get read refunds from the ledger (`MoneyReadService.refundsOf`, one grouped query per page; same field names `refundedAmount` / `refundMode` / `refundNotes`); Dashboard earning uses ledger refunds; nothing writes the 3 columns (policy, review, update path, late-payment "Refund Required" note); status-guessing removed from `afterChange` (update path → charges only, policy "already refunded" branch → direct move keyed `policy:refund:<refundRecordId>`); PUT 422 guard kept. Kept until the backfill gate (B, unanswered): full `sync` + `backfillMoneyLedger.ts` / `dedupeAppointmentAddons.ts` (they still read the columns). Money sync tests 15/15 |
| 6c-2 | **Code done 2026-11-12, uncommitted (BE).** `AppointmentMoneySync.sync` → private `syncCharges` (charge lines only; nothing reads the old row's money); `backfillMoneyLedger.ts` deleted; `refunded_amount`, `refund_mode`, `refund_notes` removed from the model. Kept: `dedupeAppointmentAddons.ts` (until the add-on unique index runs on prod), the PUT 422 guard, request fields and API names. **Owner, per env:** `moneyParity.ts` = 0 → `backupRefundColumns.ts` (JSON to the home folder) → generate + run the migration. Money tests pass |
| Q30 | Payout setup documents | **Details only first** (business, owner, bank); documents shown only when Razorpay's product config asks (`document_missing`), each with why; no standing cancelled-cheque slot. Per Razorpay Route docs (linked accounts: details + penny test). Unverified on a live account: dev keys rejected (owner, 2026-11-12) |
| Q31 | Payout destination | **UPI ID or bank account** (UPI default: instant check, minutes to arrive, ₹1 lakh per transfer). UPI goes to Razorpay as `settlement_accounts` (method upi). Change Bank stays bank-only; switching from UPI is later. Unverified live: dev keys rejected (owner, 2026-11-12) |
| 11 | **Code done 2026-11-12, uncommitted (BE only, no migration).** One Razorpay inbox for every event: the webhook URL verifies, saves the event (unique event id) and replies 200 at once; the router runs it in the background with the existing retries; Super Admin "webhooks stuck" shows all types. Reuses `subscription_webhook_events` as is (owner chose A: no rename); subscriptions behave as today |
| 12 | **Code done 2026-11-12, uncommitted (both repos); Super Admin → Revenue → Platform Fees.** Super Admin Platform Fees: default fees for all clinics + a clinic's own (else default); each save a new version from now or a date (old one closed there, a scheduled one replaced); limits: convenience ≤10% or ₹200, commission ≤25% or ₹500, gateway ≤5% (percentage only); preview by the booking engine; history with who saved. API: `/api/v1/superadmin-analytics/platform-fees` (GET, PUT, POST /preview, GET /history, DELETE /clinics/:id). Engine cleaned: percentage or fixed only, all fees patient-paid. **Migration:** `fee_config_versions.created_by` (nullable) |
| 9 | Not started; waits for Q9 (TDS) |

## Platform fees — later suggestions (not planned)

Common in production SaaS; none is built. Start with 2, 4 and 10 (small effort, high trust).

1. **Two-person approval:** one Super Admin proposes a fee change, another approves it before it goes live.
2. **Reason required** on every save, shown in History ("Diwali offer", "Clinic agreement 2027").
3. **Notify affected clinics** before a change takes effect (e.g. 7 days ahead, email + in-app).
4. **Fee breakdown at patient checkout:** "Consultation ₹500 + Platform fee ₹84.28", with a short explanation.
5. **Temporary offers with an end date:** a fee drops (e.g. to 0%) until a date, then returns to the previous value automatically.
6. **Rules beyond one clinic:** fees by plan, city or booking type, with a clear order of priority.
7. **Simulation before saving:** "With this change, last month's bookings would have earned ₹X more / less."
8. **Fee revenue report:** money earned per fee type, per month and per clinic, including fee refunds, for the CA.
9. **GST tax invoice to clinics for platform fees** (step 7, postponed).
10. **Stronger safety:** an alert when a fee changes sharply, and one-click "go back to the previous version".

## Razorpay dashboard webhook (owner, checked 2026-11-13)

One webhook, **24 events** (staging matches):

- Payments and refunds: `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`, `order.notification.delivered`, `order.notification.failed`
- Disputes: `payment.dispute.created`, `.won`, `.lost`, `.closed`, `.under_review`, `.action_required`
- Subscriptions (AutoPay): `token.confirmed`, `token.rejected`, `token.paused`, `token.cancelled`
- Payouts: `settlement.processed`, `transfer.processed`, `transfer.failed`
- Payout account: `account.activated`, `account.updated`, `product.route.activated`, `product.route.needs_clarification`, `product.route.rejected`

**Not available in the India dashboard, and not needed:**
- `account.suspended` is a Partner-program event. A suspended linked account arrives as `account.updated` with status `suspended`, which the handler already maps to Suspended.
- `transfer.reversed` is a transfer status, not a webhook. We reverse transfers ourselves on refund; `refund.processed`, `transfer.failed` and the nightly payment check cover the rest.
- Both handlers stay in code; they are harmless if Razorpay adds the events later.

**Still to do (owner):** point the dashboard webhook at `/api/v1/payment/webhooks/razorpay` (staging shows the old `/api/v2/subscription/webhooks/razorpay`, which still works), then remove the old URLs and the second secret (Q22).

## Clinic payout dates (built 2026-11-13)

- **Estimate:** Settlement History's "Expected" date = capture day + 2 bank days (Razorpay's default; Sundays and 2nd/4th Saturdays skipped, public holidays not known). UPI linked accounts settle per payment, so same day. A Super Admin timing page (holidays, per-clinic days) was built and removed: the real date replaces the estimate anyway.
- **Confirmation:** `settlement.processed`, or the `ClinicSettlementSync` job (11:00, 19:00 IST) that reads unsettled transfers from Razorpay and records the settlement with its UTR through the same save path. Test keys never settle.

## Payout data clean-up on a server (owner, once per environment)

`clearPayoutDrafts` erases the stored setup forms of payout accounts that are already active and cuts full bank account numbers in `clinic_bank_history` down to `XXXX` + last 4 (DPDP). The image holds only compiled code, so it runs as `node dist/...` inside the app container, which already has that environment's `NODE_ENV` and database settings.

1. Deploy the image that contains the script first (staging: push to `staging`; prod: the release tag).
2. SSH to the server and count what would change (dry run, nothing is written):
   `docker exec cms-backend-app-stg node dist/scripts/clearPayoutDrafts.js`
3. If the counts look right, apply:
   `docker exec cms-backend-app-stg node dist/scripts/clearPayoutDrafts.js --apply`
4. Run step 2 again; both counts should be 0. Safe to rerun.

Prod: the same commands inside the prod app container. Locally: `NODE_ENV=development npx tsx src/scripts/clearPayoutDrafts.ts [--apply]`.

## Payout account: one owner email per Razorpay account

- Razorpay allows one email per linked account. We create each clinic's account with a `reference_id` tied to that clinic, so Razorpay's record says whose it is.
- A clinic that already has an account (its id saved) reuses it on every resubmit: no new account, so no email check. That is why the clinic that owns an email never sees "email already used".
- Creating a new account with a taken email: we fetch the account that owns it (`ownAccountForTakenEmail`). Same clinic's `reference_id` (an earlier half-finished setup) → reuse it; another clinic's → 422 with `field: email`, shown under the Email field.
- Testing several clinics: give each a different owner email (`name+clinic@domain` works).
- Code: `payment/services/payoutAccount/payoutAccountSetup.service.ts`; test: `payment/__tests__/payoutAccountTakenEmail.test.ts`.

## Testing payouts (Razorpay test mode never settles)

`src/scripts/simulateSettlement.ts <clinicId>` marks a clinic's unsettled online payments as paid out, so the Payouts tab can be tested end to end. Runs only on development/staging with `rzp_test_` keys. It saves through the webhook's own path (`SettlementService.upsertFromProvider`) with a `setl_TEST_…` id and `TESTUTR…` UTR; no Razorpay call, no money entries. Local: `NODE_ENV=development npx tsx src/scripts/simulateSettlement.ts <clinicId>`; staging: `docker exec cms-backend-app-stg node dist/scripts/simulateSettlement.js <clinicId>`. Undo: delete the `setl_TEST_…` row from `clinic_settlements` (its items go with it).
