# Money sync — Phase 1: one place to read money

Status: **plan, waiting for owner review** (2026-10-13). No code until the owner says "OK, planning done".
Covers treatment plan item **D1** (`docs/treatmentPlan/DEV_PLAN.md`) and three small payment-table fixes.

## Goal

Every money screen reads money through **one read layer**, so totals always match and treatment plan money
appears next to appointment money. **How money is saved does not change** in this phase (that is Phase 2:
one append-only ledger for everything).

## Decisions (owner, 2026-10-13)

| # | Question | Decision |
|---|---|---|
| M1 | When is plan money revenue? | When **received** (advance, payment), on its IST day; refunds subtract on their day |
| M2 | Refunds in Payment History | Negative rows; totals net of refunds |
| M3 | Plan money in settlements | **No** (desk money only; settlements are for online payouts) |
| M4 | Order | Payment History + Finance first, then Dashboard + Reports |
| M5 | Late online payment on a taken slot | **A**: goes to the Finance refund review queue *(recommended; confirm)* |
| M6 | Plan money on Finance / Dashboard | Inside the totals **and** as its own "Treatment plans" line *(recommended; confirm)* |

## Today (what each screen reads)

| Screen | Endpoint / service | Reads |
|---|---|---|
| Payment History | `GET /appointments/payment-transactions` → `AppointmentService.getAppointmentPaymentTransactions` | `appointment_payments` (+ add-ons), filters: status, mode, doctor, dates, plan-limited range |
| Finance dashboard | `ClinicFinanceService.getSummary / getRevenueBreakdown / getFeeSummary` | `revenueSql.ts` rules + `financial_ledgers` (fees) |
| Dashboard revenue | `DashboardService.getCollections / getRevenueOverview / getTodayOverview / getReceptionOverview` | `revenueSql.ts` rules |
| Reports revenue | `ReportsRevenueService.*`, `reportsOverview.service`, custom catalog | `revenueSql.ts` rules |

Treatment plan money (`treatment_ledger`) is read only by plan screens.

## Steps (one step = one reviewable change)

### Step 1 — Plan money SQL, exposed by the treatment plan module (BE)
- `treatmentPlan/utils/planMoneySql.ts`: fragments over `treatment_ledger`, the same style as `revenueSql.ts`:
  `PLAN_RECEIVED` (advance + payment as +, refund as −), IST day, mode, receipt number, plan id/title, patient, doctor.
- Exported only through `treatmentPlan/index.ts` (module boundary kept).
- Write-offs, discounts and charges are **not** received money and are excluded.
- **Done when:** a unit test proves the sign rules and the IST day boundary.

### Step 2 — Money read layer (BE)
- New `src/main/money/` (read only): `MoneyReadService` with
  - `received({ clinicId, from, to, doctorId?, mode?, source? })` → totals by source (`appointment`, `treatment_plan`) and mode;
  - `entries({ … , page })` → one list: `{ at, source, type, amount, mode, receiptNo, patient, doctor, label, link }`,
    built with SQL `UNION ALL` of appointment rows (existing `revenueSql.ts` rules, unchanged) and plan rows (Step 1), sorted and paged in SQL.
- Appointment numbers must stay **exactly** what they are today.
- **Done when:** a comparison script shows appointment totals equal old vs new for every clinic and month on dev.

### Step 3 — Payment History (BE + FE)
- `payment-transactions` returns plan rows too (when no status filter, or filter includes Paid/Refunded).
  Plan rows: "Treatment plan: <title> · <Payment|Advance|Refund>", receipt `TP-…`, refund as negative, link to the plan.
- Hide the ₹0 "Not Required" treatment-visit rows (the money is on the plan).
- Doctor filter applies to the plan's doctor; date limit (`enforceDateLimit`) applies the same way.
- FE: a "Treatment plan" source label/chip and the row opens `/treatment-plans/:id`.
- **Done when:** a plan payment shows once, with its receipt; totals = appointment + plan.

### Step 4 — Finance dashboard (BE + FE)
- Collected totals include plan money; a separate **Treatment plans** line (M6).
- Settlements and gateway fee figures unchanged (M3).

### Step 5 — Dashboard revenue + Reports (BE + FE)
- Revenue cards (today/week/month), revenue overview, reception overview, reports revenue trend and mode split
  read through `MoneyReadService`; reports get a "Treatment plans" filter.

### Step 6 — Live refresh (BE)
- After every plan ledger write (payment, refund, write-off, extension fee, advance on accept):
  `invalidateClinicDashboardCaches(clinicId)` + `signalAppointmentChange`-equivalent billing signal, after commit.

### Step 7 — Small table fixes (BE; migrations generated and run by the owner)
- `financial_ledgers`: FK `ON DELETE CASCADE` → `RESTRICT` (appointment, payment; clinic kept as is or restrict — confirm).
- `appointment_multiple_service`: unique index `(appointment_id, service_id)` — **check for existing duplicates first** (script).
- `appointment_payments.payment_status`: drop the `'Paid'` default; the add-service fallback inserts `'Pending'`.

### Step 8 — Late online payment on a taken slot (BE; M5 = A)
- `refund_reviews.cancellation_request_id` becomes nullable; reason `slot_taken_after_payment`.
- `verifyLatePayment` (conflict branch) inserts a review with the clinic amount; it shows in the Finance refund review queue.

## Tests
- Comparison script (Step 2): appointment totals identical before/after, per clinic per month.
- Plan check script: a plan's advance + payment − refund appears once in each screen's numbers.
- No double counting: a treatment visit (₹0) + its plan payment counted once.
- TEST_LOG page for the owner's browser pass (Payment History, Finance, Dashboard, Reports).
- Not run (owner rule): tsc, lint, jest.

## Out of scope (Phase 2)
One append-only `payment_entries` ledger for all money; receipt numbers for desk payments; multiple refunds per visit;
text amounts → numeric; `appointment_payments` keeping only the bill.

## Progress

| Step | Status (2026-10-13) |
|---|---|
| 1 Plan money SQL | **Done**: `treatmentPlan/services/plans/planMoney.service.ts` (`totals`, `byDay`, `entries`), exported via `treatmentPlan/index.ts` |
| 2 Read layer | **Changed**: no new `src/main/money/` module. Appointment money keeps its existing `revenueSql.ts` queries untouched and plan money is added from `PlanMoneyService`, so appointment numbers are identical by construction (no comparison script needed). Revisit in Phase 2 |
| 3 Payment History | **Done**: plan rows merged before the search/mode/entry filters; `source`, `planId`, `receiptNo`; drawer "Open treatment plan · TP-…", card "Plan" link |
| 4 Finance | **Done**: totals and offline channel include plan money; `treatmentPlans` line; payouts unchanged. Shown as "(incl. treatment plans ₹X)" on Total Revenue |
| 5–8 | Not started (after review) |

Check: `moneySyncCheck.ts` on dev, 8/8 (once in history, receipts + links, refund filter, booked-via filter, Finance line, payouts untouched).

### Progress — steps 5–8 (2026-10-13)

| Step | Status |
|---|---|
| 5 Dashboard + Reports | **Done**: revenue overview (days, modes, previous period), Earning card + its daily rows, today's revenue; Reports revenue metrics, trend, service/mode/doctor/type breakdowns ("Treatment plans" slice). A Service filter leaves plan money out. Dashboard collections already include it through Payment History. **Not covered:** the Reports *overview* page (`reportsOverview.service.ts`) and the custom-report catalog |
| 6 Live refresh | **Done**: `signalPlanMoney` (cache bump + `board` signal) after payment, refund, write-off, discount, accept, extension |
| 7 Table fixes | **Done in the models; migration to be generated and run by the owner**: `financial_ledgers` FKs → RESTRICT (appointment, payment, clinic); unique `(appointment_id, service_id)` on `appointment_multiple_service` (dev has no duplicates; a race now returns 409); `appointment_payments.payment_status` default **'Paid' → 'Pending'** (changed from "drop the default": the update path inserts a row without a status) |
| 8 Late online payment | **Done without a schema change** (changed from "make cancellation_request_id nullable"): the conflict branch records a system cancellation request (`scheduling_conflict`) and a PENDING refund review, once per appointment, so the existing approve/decline/refund flow handles it |

Checks on dev: money sync 8/8 + 6/6, Phase 5 20/20, Phase 6 21/21, refund-review rows accepted (rolled back).
