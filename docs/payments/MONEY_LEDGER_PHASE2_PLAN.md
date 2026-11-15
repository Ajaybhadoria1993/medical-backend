# Money — Phase 2: one ledger for all money

Status: **plan; decisions D1–D9 made (owner, 2026-10-13); waiting for "OK, planning done"**. No code until the owner says "OK, planning done".
Follows `MONEY_SYNC_PHASE1_PLAN.md` (Phase 1 = one place to *read*; Phase 2 = one place to *write*).

## Why

Money is saved three different ways today, and most payment bugs found so far come from that split:

| Where | How it saves money | Problems |
|---|---|---|
| `appointment_payments` | One row per visit, **edited in place** | A refund overwrites the payment; only one refund per visit; no partial payments; `refunded_amount` is text; no receipt number; history lost |
| `appointment_multiple_service` | Add-on rows; price as text | Text money; visit price kept in step by hand |
| `financial_ledgers` | Append-only, but online payments only | Desk money never appears in it |
| `treatment_ledger` | Append-only, paise-exact, receipts, idempotent | Good design, but separate from the rest |

## Goal

**One append-only ledger, `money_entries`, for every rupee that moves**, read by every screen.
Nothing is updated or deleted; a mistake is corrected with a new entry. `appointment_payments` keeps only
the **bill** (what was charged); money in and out lives in the ledger.

## Design (proposed)

**`money_entries`** (one row per movement)

| Column | Notes |
|---|---|
| `id` uuid, `clinic_id`, `patient_id` | |
| `source_type` | `appointment` · `treatment_plan` · later `pharmacy`, `lab` |
| `source_id` | appointment id / plan id |
| `line_ref` | optional: add-on service id, plan step id |
| `entry_type` | `charge` · `payment` · `refund` · `write_off` · `adjustment` |
| `amount_paise` | bigint, always positive; `entry_type` gives the direction |
| `payment_mode` | Cash · UPI · Card · Online · … (normalised list) |
| `channel` | `desk` · `online` |
| `receipt_no` | for payment/refund: `R-YYYY-NNNNNN` per clinic (see D3) |
| `gateway_ref` | gateway payment/refund id (online) |
| `request_id` | idempotency key; unique per clinic |
| `reason`, `created_by`, `created_at` (IST day derived) | |
| `reverses_entry_id` | for corrections |

Rules: FKs `RESTRICT`; unique `(clinic_id, request_id)`; check `amount_paise > 0`; refunds can never exceed
payments on the same source (checked in the service, under a row lock on the source).

**Read side:** one `MoneyService` (`src/main/money/`) with `totals`, `byDay`, `byMode`, `byDoctor`, `entries`,
`balance(source)`; every screen reads only this. It replaces `revenueSql.ts` and `PlanMoneyService` reads.

## Module: `src/main/money/` (new)

| Module | Job | Owns |
|---|---|---|
| `money` (new) | The record of every rupee the clinic received or returned | `money_entries`, `receipt_sequences`; `MoneyWriteService`, `MoneyReadService`; public `index.ts` only |
| `payment` (existing) | How money moves through a gateway (adapters, split engine, intents) | `financial_ledgers` **moves here** from `appointments/models` |
| `appointments`, `cancellation-policy`, `clinicFinance`, `patient`, `treatmentPlan` | Their features | Write money only through `money`'s public API |

`money` depends on no feature module (it receives ids only), so there are no import cycles and pharmacy/lab can
join later. Readers (Finance, Dashboard, Reports, Payment History) use `MoneyReadService` only.

```
src/main/money/
  models/     moneyEntry.model.ts, receiptSequence.model.ts
  services/   moneyWrite.service.ts, moneyRead.service.ts, reconciliation.service.ts
  index.ts    the only import point for other modules
```

## Production safeguards

| # | Safeguard | How |
|---|---|---|
| P1 | Daily match with the gateway | Nightly job: Razorpay payments/refunds/settlement report vs `money_entries` + `financial_ledgers`; differences listed |
| P2 | No edit, no delete in the database | Trigger on `money_entries` that rejects UPDATE and DELETE (code rule enforced by Postgres) |
| P3 | Instant switch-back | One setting per screen: read old / read new (step 2.5), changeable without a release |
| P4 | Alerts | Nightly parity and gateway-match results sent to Super Admin (in-app; email optional) |
| P5 | End-to-end on staging | Razorpay test mode checklist: pay, partial refund, full refund, failed refund, late/out-of-order webhook, chargeback |

Not needed: card data security (Razorpay holds cards; we store none), multi-currency (INR only).

## Online payments: fees, commission, GST (D6)

Two ledgers, each with one job, linked by `gateway_ref` (the gateway payment / refund id):

| Ledger | Records | ₹500 online consultation |
|---|---|---|
| `money_entries` | The **clinic's** money with the patient | charge 500 · payment 500 (Online) |
| `financial_ledgers` (kept) | The **gateway split** of that payment | PAYMENT_RECEIVED 520 · CONVENIENCE_FEE +20 · PLATFORM_COMMISSION −25 · GST −4.50 · PG_FEE −10 · TRANSFER_CREATED −480.50 |

- Clinic revenue reads `money_entries` only (same rule as today: online fee and GST are never clinic money).
- Finance fee/payout/settlement figures keep reading `financial_ledgers`; `financial_snapshot` stays on the bill.
- Phase 2 additions: `financial_ledgers` writes move to paise integers (today `parseFloat`); an online refund writes a
  `refund` entry **and** the matching reversal in `financial_ledgers` (same gateway refund id); a **reconciliation
  check** per online payment: patient total = clinic amount + convenience fee, and clinic amount = transfer +
  commission + GST + PG fee (when the clinic bears them). Any mismatch is reported.

## Online refunds (found in code, and the gap)

Today (`cancellationPolicy.service.ts`, `refundReview.service.ts`): Razorpay refund with `reverse_all`, then
`financial_ledgers` gets `REFUND −X` and `TRANSFER_REVERSAL +X`, both the full refund amount. Gaps:
the PG fee Razorpay keeps is never recorded; commission/GST are never reversed or marked kept; the transfer
reversal is assumed to equal the refund (it is really only what was routed to the clinic and still there);
the convenience fee has no rule.

Phase 2 rules:
1. Store **what the gateway reports** (refund + transfer-reversal webhooks, `amount_reversed`), not assumed values.
2. New `financial_ledgers` types: `PG_FEE_RETAINED`, `COMMISSION_REVERSAL`, `GST_REVERSAL`, `CONVENIENCE_FEE_REFUND` (per D8).
3. `money_entries`: a `refund` entry only when the gateway **confirms** the refund (a failed refund writes nothing;
   a retry uses the same `request_id`); a clinic-borne fee is a separate `adjustment` with a reason.
4. Check per refund: patient refund = clinic share reversed + platform share reversed + fees retained.
5. Cash refund of an online payment: `refund` entry, mode Cash, no gateway rows.
6. Chargebacks (D9): an `adjustment` linked to the dispute record; webhooks idempotent by gateway id, safe out of order.

## Write paths to move (found in code)

| Path | File | Today |
|---|---|---|
| Book with payment | `appointments/services/appointment.service.ts` (create) | inserts payment row |
| Collect / change payment, discount | same (update) | edits payment row |
| Desk refund | same (update, status Refunded) | overwrites row |
| Add services | `appointmentMultipleService.service.ts` | add-on rows + price |
| Online confirm | `patient/services/patient.service.ts` `confirmPaymentAndAppoint` (+2 more spots) | edits row |
| Late online payment | `appointments/services/paymentReservation.service.ts` | edits row + `financial_ledgers` |
| Cancellation refunds | `cancellation-policy/services/cancellationPolicy.service.ts` | refund rows + row edits |
| Refund reviews | `clinicFinance/services/refundReview.service.ts` | refund rows + row edits |
| Gateway webhooks | `clinicFinance/services/financeProviderWebhook.service.ts` | status updates |
| Treatment plans | `treatmentPlan/services/plans/planLedger.service.ts` | `treatment_ledger` |

Readers (≈20 files): Payment History, Finance, Dashboard, clinic insights, Reports (revenue, overview,
custom catalog), patient screens (recent activity, counts), day queue, appointment details, settlements.

## Steps (each releasable on its own)

| # | Step | Done when |
|---|---|---|
| 2.1 | Table `money_entries` + `MoneyWriteService` (record charge/payment/refund/write-off, idempotent, locked, receipt numbers) + unit tests on the rules | Rules proven by tests; nothing calls it yet |
| 2.2 | **Dual write**: every write path above also records ledger entries, in the same transaction | New activity appears in both places, totals equal |
| 2.3 | **Backfill script**: old payment rows, add-ons, refunds, online ledger → entries (dry-run first) | Script report: every clinic/month total equal old vs new |
| 2.4 | `MoneyService` read layer + **parity check** script (old rules vs ledger, per clinic/month/mode) | Zero differences on staging |
| 2.5 | Switch readers one at a time: Payment History → Finance → Dashboard → Reports → others | Each screen's numbers equal before/after |
| 2.6 | Desk features unlocked: many refunds per visit, partial payments, desk receipt numbers | Owner browser pass |
| 2.7 | Stop writing money to `appointment_payments` (bill only); retire `revenueSql.ts` money fragments | Old fields read nowhere |
| 2.8 | Treatment plans: move into `money_entries` or keep `treatment_ledger` behind `MoneyService` (D1) | One reader for all money |
| 2.9 | Production safeguards P1–P5 (gateway match job, no-edit trigger, per-screen switch, alerts, staging test checklist) | All five in place before prod switch |

Online payments and settlements move **last** within each step (most sensitive).

## Decisions (owner, 2026-10-13: all as recommended)

| # | Question | Recommendation |
|---|---|---|
| D1 | Treatment plan money: move into `money_entries`, or keep its ledger and read it through `MoneyService`? | **Keep it** (already correct); read through `MoneyService`. Move later only if needed |
| D2 | Revenue date for appointment money: keep the **visit day** (today's rule) or switch to the **day the money was received** (cash basis, like plans)? | **Day received**, so every screen uses one date rule; the visit day stays for visit reports. Numbers per day will shift; old reports change once |
| D3 | Receipt numbers for desk payments: one series per clinic (`R-2026-000123`) or random like plans (`TP-2026-AB12CD`)? | **One sequential series per clinic** (easier for front desk and audits) |
| D4 | Partial payments for appointments (pay ₹300 now, ₹200 later)? | **Yes** (comes free with the ledger) |
| D5 | Many refunds per visit? | **Yes** |
| D6 | Keep `financial_ledgers` (online fee/commission split) as is, linked to entries by `gateway_ref`? | **Keep** — it records the gateway split, not the patient's money. **Replaced 2026-11-12 by FINANCE_REBUILD_PLAN.md Q5 (option A: one double-entry ledger in `money_entries`).** |
| D7 | Old data: backfill all history, or only from a cut-over date? | **All history**, verified by the parity script |
| D8 | Online refund costs: who bears the PG fee Razorpay keeps; is commission + GST returned; is the convenience fee refunded? | **A**: clinic bears the PG fee; platform returns commission + GST only on a full refund before the visit; convenience fee not refunded. **Business/pricing decision: confirm with the pricing owner** |
| D9 | Chargebacks (bank takes money back) | Record as an `adjustment` linked to the dispute; clinic share reversed per the dispute outcome |

## Risks and how we handle them

| Risk | Handling |
|---|---|
| Numbers change on a screen | Parity script before every switch; switch one screen at a time; easy switch back |
| Double counting during dual write | Readers keep the old source until 2.5; the ledger is only compared, not shown, until parity is zero |
| Online payment race / retries | Same transaction as today's update, `request_id` = gateway payment id, row lock on the appointment |
| Backfill mistakes | Dry run, per clinic report, re-runnable (idempotent on `request_id = 'backfill:<row>'`) |
| Migration on prod | Owner-run, after staging pass; tables are new, so old flows keep working |

## Tests
Unit tests for the write rules (refund cap, idempotency, receipt series); a parity script per step; check
scripts like Phase 1; TEST_LOG pages per screen. Not run (owner rule): tsc, lint, jest.

## Out of scope
Pharmacy and lab money (they can join later as new `source_type`s); GST invoices; accounting exports.

## Decision record (owner, 2026-10-13)
D1 keep `treatment_ledger`, read through `MoneyReadService` · D2 revenue on the **day received** for all money ·
D3 receipts `R-YYYY-NNNNNN` per clinic · D4 partial payments yes · D5 many refunds per visit yes ·
D6 keep `financial_ledgers` for the gateway split (moves to `payment`) · D7 backfill all history ·
D8 option A (clinic bears the PG fee; commission + GST returned only on a full refund before the visit;
convenience fee not refunded) · D9 chargebacks as `adjustment` linked to the dispute.

## Progress

| Step | Status (2026-10-13) |
|---|---|
| 2.1 | **Code done, migration pending (owner)**: `src/main/money/` — models `money_entries` (+ enums), `receipt_sequences`; `MoneyWriteService.record` (in the caller's transaction; idempotent by `request_id`; per-source advisory lock; refund ≤ received, write-off ≤ due, adjustment ≤ what is left of its entry; reason/gateway rules; receipt `R-YYYY-NNNNNN` per clinic per IST year); pure rules in `utils/money.utils.ts`; `index.ts` is the only import point. Nothing calls it yet. Pure-rules check 13/13; DB check script ready for after the migration. Change from the design: no FK on patient/doctor ids (keeps `money` free of the users module; ids still required/indexed) |
| 2.2 | **Code done, off by default** (`MONEY_LEDGER_WRITE=on` turns it on after the migration). One function, `appointments/services/appointmentMoneySync.service.ts`: after any money change it works out charged / paid / refunded from the payment row (revenueSql rules) and records only the difference (increase = new entry, decrease = adjustment of the newest entries); runs in a savepoint and only logs on error, so it can never fail a booking or payment. Called from: book, update (payment or status), add services, online confirm (×2) and failure, late online payment, expired checkout, cancellation refunds (×2), refund review approval. Load check: all 9 files OK; Phase 5/6/money-sync checks unchanged with the switch off. Post-migration check script ready (sync 200 real appointments in a rolled-back transaction, compare with the old rule, rerun adds nothing). Known limit: a refund entry carries the payment's gateway id, not the refund's own id (to fix with the refund rules in 2.6) |
| 2.3 | **Code done, waiting for the migration.** `src/scripts/backfillMoneyLedger.ts`: dry run by default, `--apply` to copy, `--clinic=` for one clinic; batches of 200; reuses `AppointmentMoneySync.sync`, so it is re-runnable. Old entries are dated on the **visit day** (`occurredAt`), so past reports keep their numbers. Sync now writes **one charge line per added service** (`line_ref` = service id). Cross-checks: (1) completed cancellation refunds vs the payment row, (2) online ledger payments without a PAYMENT_RECEIVED fee row, (3) received money per clinic per month vs the old rule, (4) rows that could not be copied, listed. Kept, not copied: `financial_ledgers` (D6), settlements/disputes, `treatment_ledger` (D1). Guard: refuses to run before the migration (checked) |
| 2.4 | **Code done, checks wait for the migration.** `money/services/moneyRead.service.ts`: `totals`, `byDay`, `byDoctor`, `entries`, `balance` over `money_entries` (payments in, refunds out, adjustments undo their target), plus registered outside sources. `money/ports.ts` + `src/adapters/money` register treatment plan money (D1) at boot, so `money` imports no feature module. `src/scripts/moneyParity.ts`: per clinic per month, Payment History, Finance, Dashboard and Reports vs the ledger (fresh figures, caches cleared). Screens still read the old figures (switch is 2.5) |

## Runbook: migration and backfill (owner-run; dev → staging → prod)

Move to the next environment only when every check passes. No screen reads the new table until step 2.5,
so these steps change nothing users see.

1. **Deploy** with `MONEY_LEDGER_WRITE` unset (dual write off).
2. **Duplicate add-ons:** `NODE_ENV=<env> npx tsx src/scripts/dedupeAppointmentAddons.ts` (lists only).
   If any are listed, review those visits, then rerun with `--apply`.
3. **Generate:** `npm run db:migrations:<env>`. Read the SQL; it must contain only:
   enums `money_source`, `money_entry_type`, `money_channel`; tables `money_entries`, `receipt_sequences`
   (indexes + checks); `financial_ledgers` FKs → RESTRICT; unique index on `appointment_multiple_service`
   (appointment_id, service_id); `appointment_payments.payment_status` default → 'Pending'.
   **Prod:** the prod snapshot is behind staging, so the generated file may bundle unrelated tables.
   Stop and review if it contains anything beyond this list.
4. **Apply:** `npm run db:migrate:<env>`.
5. **Backfill dry run:** `NODE_ENV=<env> npx tsx src/scripts/backfillMoneyLedger.ts` (checks 1 and 4).
   Then `--apply`; **check 3 must say "All monthly totals match"**. Send any differences for review.
6. **Turn on dual write:** `MONEY_LEDGER_WRITE=on` in that environment's `.env`; restart.
7. **Backfill `--apply` once more** to catch money moved between steps 5 and 6 (adds nothing else).

On dev, after step 4, also run the two database checks (write rules; sync of 200 real appointments) before staging.
**Undo:** unset `MONEY_LEDGER_WRITE` and restart; the old flow is untouched.

## Cutover decision (owner, 2026-10-13): option B — remove the old money logic now

Replaces steps 2.5–2.7 (staged switch with fallback) with one cutover.
- **Writes:** every payment path always writes the ledger; a ledger failure fails the payment (no switch, no savepoint swallowing).
- **Reads:** every money figure comes from `MoneyReadService` only: Finance (summary, revenue breakdown), Dashboard
  (earning card, daily rows, revenue overview, today, reception, collections), Reports (revenue, overview, custom
  catalog), Payment History, clinic insights, patient money views.
- **Removed:** `revenueSql.ts` money fragments, the Phase 1 plan-money additions (plan money comes through the reader),
  `MONEY_LEDGER_WRITE`.
- **Kept:** the visit's bill and payment state on `appointment_payments` (shown on appointment screens),
  `financial_ledgers` (platform fees and transfers only, since Phase 2.6), cancellation and refund records.
- **Deploy order per environment:** migrate → backfill `--apply` (check 3 must match) → deploy this code.
  Deploying before the backfill shows ₹0 everywhere.
- Each screen is switched and checked against today's figures on dev before the next.

### Cutover progress (option B)

| Part | Status |
|---|---|
| Writes mandatory (no switch; ledger failure fails the payment) | **Done**: `AppointmentMoneySync.afterChange` calls `sync` directly; `MONEY_LEDGER_WRITE` removed |
| Dev backfill | **Done**: 10 appointments, 6 entries; checks 1–4 clean; "All monthly totals match" |
| Reader additions | **Done**: `byChannel` (desk/online) in `totals`; `outstanding` (dues on visits charged in the range) |
| Finance summary | **Done**: revenue, refunds, online/desk split, dues and the treatment plan line from `MoneyReadService`; counts and platform fee stay on visits. Parity 0 differences |
| Finance revenue breakdown | **Done**: "collected" (total, desk, online) by day / doctor / service from `MoneyReadService.receivedGrouped`; booked/completed/cancelled stay the visit bill. Check 18/18 (each view = old rule + plan money; rows add up) |
| Dashboard | **Done**: earning card + unpaid dues, daily rows, revenue overview (days, modes, refunds, previous period, dues, planRevenue), today's revenue and paid count from `MoneyReadService`; today's pending visits stay on the bill. Parity 0; dashboard/reports check 6/6 |
| Clinic insights | **Done**: doctor revenue from `byDoctor` (IST bounds); dues aging stays on the bill. Doctor sum = total |
| Reports revenue | **Done**: metrics, trend (`buckets`), service / mode / doctor / type breakdowns, insights from the reader; reader gained `serviceName` filter, `type` grouping and `buckets`. Aging and mode options stay on the bill. Parity 0; checks 6/6 |
| Payment History | **Done**: money rows (payments, refunds, corrections; appointments and plans) from `MoneyReadService.entries` with receipts; pay-later dues stay on the bill; same filters and summary. Phase 1 plan-row helper removed. Parity 0; checks 8/8; rows add up to netAmount |
| Reports overview, custom reports | **Done**: every visit-grouped money figure uses `visitMoneySql` (a visit's ledger sum), so all groupings keep working; overview revenue 1,500 = old rule, custom revenue by doctor 1,500 = old rule. Plan money stays out of these visit views, as before |
| Old money-received rule | **Deleted** from `revenueSql.ts` (`RECEIVED_AMOUNT`); a private copy lives only in the backfill script for its check 3. **Kept** as bill rules: `CLINIC_AMOUNT`, `PAYMENT_MODE`, `clinicAmountLines`, `HAS_RECEIVED_MONEY` (fee figures). Final run on dev: backfill rerun writes 0 and all totals match; parity 0; money sync 8/8, 6/6, write rules 10/10, Phase 5 20/20, Phase 6 21/21 |

## Phase 2.6 plan — direct ledger writes (remove the legacy write path)

Status: **code done on dev, waiting for the owner's browser test** (2026-10-13). Decisions P1–P4 taken as recommended. Progress at the end.

**Today:** every payment action edits `appointment_payments` first; `AppointmentMoneySync` then derives ledger
entries from that row. The row holds one payment and one refund, so partial payments and repeat refunds are impossible.

**Goal:** each action writes the ledger directly; the payment row keeps only the **bill**, and its status is
**derived from the ledger**.

| # | Step | Side |
|---|---|---|
| 1 | New endpoints: `POST /appointments/:id/payments` (amount, mode, requestId) and `POST /appointments/:id/refunds` (amount, mode, reason, requestId), via `MoneyWriteService`; caps already enforced there | BE |
| 2 | Booking with payment, add services, online confirm/failure, late payment, cancellation refunds, refund reviews: write ledger entries directly (charge on booking / add-on; payment; refund) | BE |
| 3 | `appointment_payments.payment_status` becomes a cache written from the ledger balance after every write: **Pending** (nothing paid), **Partly paid**, **Paid**, **Partly refunded**, **Refunded**; free / not-required visits keep **Free Consultation** | BE |
| 4 | Remove `AppointmentMoneySync`, the money part of `updateAppointment`, and the money fields `refunded_amount`, `refund_mode`, `refund_notes` (owner-run migration, after backfill on every environment) | BE |
| 5 | Reports overview mode slices, custom "payment mode" grouping and the mode filter list read ledger modes | BE |
| 6 | FE: Appointment details — "Collect payment" (amount defaults to what is due, any mode, many times) and "Refund" (up to what was received, many times) using the new endpoints; payment section lists every payment/refund with receipts; new status chips (Partly paid, Partly refunded) | FE |
| 7 | FE: `RefundPaymentModal`, `PaymentCell`, `AppointmentSummaryCard`, `AppointmentServicesCard`, list cards, Finance refunds section read the new status and entries | FE |
| 8 | Checks: write rules (partial, overpay refused, many refunds, retries), parity script still 0, browser pass (TEST_LOG page) | Both |

**Decisions needed**

| # | Question | Recommendation |
|---|---|---|
| P1 | Can a patient pay **more** than the bill (credit kept for later)? | **No** for appointments (cap at what is due); credit stays a treatment-plan feature |
| P2 | Status names for the new states | **Partly paid**, **Partly refunded** (plain words; chips use existing colours) |
| P3 | Online refunds of a partial online payment | Allowed up to what that gateway payment received; uses the gateway refund API as today |
| P4 | Old `updateAppointment` payment fields from older app versions | Accept for one release and translate into ledger writes, then reject |

### Phase 2.6 progress

| # | Status |
|---|---|
| 1 | **Done.** `POST /appointments/:id/payments` and `/refunds` (body: `amount?` in rupees, `paymentMode`, `requestId`, `reason?`; no amount = all due / all received) and `GET /appointments/:id/payments` (balance + entries). Admin always; Doctor/Receptionist need `payment:manage`. A repeated `requestId` returns the saved result |
| 2 | **Done, in one place.** `AppointmentMoneySync.afterChange` (called by all 11 money paths, no caller edits) syncs **charges only**, then turns a Paid / Refunded status the caller just set into a direct `pay` / `refund` (online ones carry the gateway ref; keyed on the balance they move from, so a retry writes nothing). `pay` is capped at what is due (P1), `refund` at what was received |
| 3 | **Done.** `refreshStatus` sets Pending / Partly paid / Paid / Partly refunded / Refunded from the balance; Free Consultation and Failed are never overwritten; Already Paid kept for covered visits. Bill rules know the new statuses (`UNPAID_PAYMENT`, `HAS_RECEIVED_MONEY`) |
| 4 | **Waits for the backfill on every environment.** The full row-derivation `sync` stays only for the backfill; old payment fields stay accepted on `PUT /appointments/:id` for one release (P4) |
| 5 | **Done.** Overview mode chart splits each visit's money by the mode actually used (₹0 slices hidden); mode filter list = modes in the ledger; custom report mode = the visit's last payment mode. The dues chart's mode filter stays on the bill (dues have no ledger mode) |
| 6–7 | **Done.** Appointment details: Payments section (received, due, every payment/refund with receipt) and "Collect payment" (part or full). Refund modal uses the new endpoint, max = money received (a second refund used to be ignored). Partly paid / Partly refunded colours on the badge, list cell and card grid. Finance refunds: one row per refund from the ledger (plus gateway refunds not completed yet), with receipt |
| 8 | **Dev checks pass:** direct writes 7/7 (part payment, overpay refused, legacy Paid pays the rest, rerun writes nothing, partial and full refund), mode reports 3/3, dues 3/3, money sync 8/8 and 6/6, write rules 10/10, Phase 5 20/20, Phase 6 21/21, parity 0. **Pending:** owner browser test; online Razorpay paths on staging |

**Also changed in 2.6**
- **Dues** = bill less money received (`DUE_AMOUNT`), so a part payment lowers them; used by dashboard aging, Reports dues and the custom dues column. Aging also stopped missing add-on services.
- **Payment History:** a Pending row no longer matches a payment-mode filter.
- **`financial_ledgers`:** stopped writing `PAYMENT_RECEIVED` / `REFUND` rows (duplicates of `money_entries`); platform-fee rows (commission, GST, PG fee, convenience fee, transfer, transfer reversal) are kept. Unused `FinancialLedgerService` deleted.

**Still to do**
- After the backfill on every environment: drop `refunded_amount`, `refund_mode`, `refund_notes`, the full `sync`, the old payment fields on `PUT /appointments/:id`, and the old duplicate rows in `financial_ledgers` (owner-run migration).
- Payment History: filter and page in SQL instead of in memory.

## Phase 2.7 — finish removing the old way (2026-10-15, branch `feat/money-pending`, BE + FE)

**Why:** after 2.6, money could still change two ways: the payment/refund endpoints, and editing the
visit's payment row through `PUT /appointments/:id`, after which `AppointmentMoneySync` *guessed* the
ledger entries from the row's status. The guessing caused the Pay Later bug and dropped the refund's own
gateway id (Finance → Refunds showed no reason for online refunds). The sync had no automated tests.

| Phase | What | Status |
|---|---|---|
| Fix | **Pay Later is never recorded as paid.** Update appointment saves Pay Later as Pending; add services records the add-on charge only (`afterChange` `chargesOnly`), then pays exactly the add-on amount for a real mode | **Done** |
| A | **Tests:** `src/main/money/__tests__` (balance, receipts, caps incl. capped payment, retries, lock, backfill year), `appointments/__tests__/appointmentMoneySync.service.test.ts` (Paid/Refunded/Pay Later/Free Consultation, add-ons, limits, direct moves); finance summary test updated to mock `MoneyReadService` | **Done**: 67/67 pass |
| B | **Web "Mark as Paid"** (`AppointmentDetails.tsx`) uses `POST /appointments/:id/payments`; confirm and notes sent separately, no payment status. No other web screen sends money fields through `PUT` | **Done** |
| C | **Server paths record money directly**: `afterChange` takes `move` (`DirectMove`: pay/refund, amount, gateway id, stable request id). Razorpay confirms (reservation, patient app, late payment) pay with `razorpay:pay:<paymentId>`, recorded once across paths; policy and review refunds carry their own refund id (fixes Finance refund reasons; reviews only when PROCESSED); desk-paid bookings pay directly; expired/failed record no money. Unchanged: the "already refunded in Razorpay" branch (no refund id), online-mode booking | **Done** |
| D | **`PUT /appointments/:id` refuses money fields** (`paymentStatus`, `paymentMode`, `refundedAmount`, `refundMode`, `refundNotes`) with a 422 pointing to the payment/refund endpoints. Each attempt is logged as `[Money] legacy payment fields on PUT /appointments/:id` (user, clinic, user agent, `x-app-version`). `price` and `paymentNotes` still allowed | **Done (owner chose: reject now)** |
| E | **Clean-up**, after the backfill on every environment incl. prod: remove the status-guessing part of `afterChange` and the full row `sync`; drop `refunded_amount`, `refund_mode`, `refund_notes` (owner-run migration) | **Split (Finance rebuild 6c):** guessing removed, readers on the ledger, columns no longer written (6c-1, 2026-11-12). 6c-2 (same day): `sync` charges-only, backfill script removed, columns out of the model; owner runs parity → backup script → migration per env |

**Risk accepted by the owner (D):** an older mobile app that marks visits paid through `PUT` now gets
the 422. After deploying, search the logs for `legacy payment fields`; send the user agents / versions
to the mobile team. Ask the mobile app to send an `x-app-version` header.

**Tests to run before a release (owner rule):**
`npm test -- src/main/money src/main/treatmentPlan/__tests__/money.utils.test.ts src/main/clinicFinance/tests src/main/appointments/__tests__/appointmentMoneySync.service.test.ts src/main/appointments/__tests__/appointmentMultipleService.service.test.ts`
Not yet run (heavy, owner to run): `appointment.service.test.ts`, `patient.service.test.ts`.

**Check on staging after deploy:** one online app payment (recorded once, Razorpay id); one policy
cancellation refund (Finance → Refunds shows the reason); "Mark as Paid" on a Pay Later visit;
`moneyParity.ts` still 0.

**Still open (safeguards, 2.9):** no-edit trigger on `money_entries` and `treatment_ledger`; daily
Razorpay reconciliation; alerts; unique plan receipt numbers (today `TP-YYYY-` + part of the row id);
Payment History filter/page in SQL; D8 confirmed with the pricing owner. Unused tables found:
`clinic_commissions`, `clinic_razorpay_accounts` (no model, no raw SQL): drop after a backup and a row check.

## D1 changed (owner, 2026-10-15): treatment plan money moves into `money_entries`

**Why now:** treatment plans are not in production yet, so there is no live plan data to migrate; after
launch the same change would need a data migration. One ledger means one set of rules, one receipt
series and one reader.

**What changed (BE, `feat/money-pending`):**
- `money_entries`: new entry types `advance` (counts as received) and `paid_at_visit` (settles a plan
  step; not counted as revenue again — that money is already received on the visit); new column
  `approved_by` (plan write-offs). Plan rows: `source_type = treatment_plan`, `source_id` = plan,
  `line_ref` = step, channel desk. `credit_note` was never written, so it is not carried over.
- Plan money writes (`planLedger`, `planDecision` advance, `planLifecycle` extension) go through
  `MoneyWriteService.record` via `PlanMoneyStore` (`services/plans/planMoney.service.ts`): same lock, retry
  safety (`requestId`), paise and receipt series as appointments. Step charges and paid-at-visit use
  server keys `tpl:<planId>:charge:<stepId>` / `tpl:<planId>:visit:<stepId>`. Plan-only limits stay in
  `PlanLedgerService`.
- `MoneyReadService` reads plan rows directly: advances count as received; by service/type they group as
  "Treatment plans"; Payment History labels them "Treatment plan: <title> (Advance|Payment|Refund)";
  plan dues (plans charged in the range) come from the same table. The external-source port
  (`money/ports.ts`) and `src/adapters/money` are removed.
- `treatment_ledger` table and `tp_ledger_entry` enum removed; `treatment_instalments` stays (schedule).
  Plan receipts are now `R-YYYY-NNNNNN` from the clinic series (no more `TP-…`).

**Migration (owner-run):** add `advance`, `paid_at_visit` to `money_entry_type`; add
`money_entries.approved_by`; update `money_entries_reason_ck`; drop `treatment_ledger` and
`tp_ledger_entry`. Dev/staging plan test money is reset (owner chose reset over copy).

`financial_ledgers` (online split, D6) and `appointment_payments` (bill + status) are unchanged.

## Clean-up after prod (planned 2026-10-15, not started)

Start only when: prod migration + backfill are done, `moneyParity.ts` shows 0 differences, and the `[Money] legacy payment fields` log stays quiet for one release (or mobile is updated).

### Item 1 — drop 2 unused tables (in the prod migration)
`clinic_commissions`, `clinic_razorpay_accounts`: no code uses them.
1. Back up prod.
2. `SELECT count(*)` on both; if rows exist, export them (`COPY ... TO ... CSV HEADER`).
3. Keep their `DROP TABLE` lines when reviewing the generated prod migration.

### Item 2 — Phase E (code by dev, DB by owner)
Code:
1. Remove the status-guessing branch in `AppointmentMoneySync.afterChange` (callers pass a direct move).
2. Remove the full row `sync` (backfill only).
3. Remove the old fields from the `PUT /appointments/:id` schema (`paymentStatus`, `paymentMode`, `refundedAmount`, `refundMode`, `refundNotes`; already 422 today).
4. Remove or archive `backfillMoneyLedger.ts` and `dedupeAppointmentAddons.ts`.
5. Run the money tests; update the ones on the old path.

Database (owner-run migration, after the model change):

6. Drop `appointment_payments.refunded_amount`, `refund_mode`, `refund_notes`.
7. After a backup, delete the duplicate patient-money rows from `financial_ledgers`:
   ```sql
   SELECT entry_type, count(*) FROM financial_ledgers
   WHERE entry_type IN ('PAYMENT_RECEIVED','REFUND') GROUP BY entry_type;
   DELETE FROM financial_ledgers WHERE entry_type IN ('PAYMENT_RECEIVED','REFUND');
   ```
   Keep fee, transfer and reversal rows (payouts still use them).

Order: prod rollout → Item 1 (same migration) → wait one release → Item 2.
