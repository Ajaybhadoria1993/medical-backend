# Backend Optimization & Cleanup Plan

Findings from a full-repo audit (2026-07-13) of `InfinityMedisetu_BE`, ordered as sequential steps.
Each step is independent and can be picked up, PR'd, and checked off separately.

## Status legend
- [ ] Not started
- [~] In progress
- [x] Done

---

## Step 1 — Fix N+1 query loop in pharmacy checkout
**File:** `src/main/pharmacies/services/sales.service.ts` — `createSale` (~lines 117–246)

Per-cart-item loop currently does, per item:
- a `SELECT` joining `PharmacyStockMedicineModel` + `pharmacyMedicineModel` + `HsnTaxMasterModel` (line ~119)
- a separate `getAvailableQuantity()` DB call (line ~171)
- a separate `INSERT` into `PharmacySalesItemsModel` (line ~233)

For an N-item cart this is 2N+ sequential round trips inside one DB transaction.

**Fix:** batch the lookup with `WHERE id IN (...)`, batch availability checks, and use a single multi-row `.values([...])` insert. Shortens the transaction and reduces lock contention on every checkout.

**Done:** batch/HSN lookup and sold-quantity lookup now each run once via `inArray(...)` instead of per item; sale items insert is now a single multi-row insert. As a side effect, availability checking now also accounts for the same batch appearing more than once within one cart (previously could oversell in that case). Verified with `tsc --noEmit` — no type errors.

**Status:** [x]

---

## Step 2 — Reorder auth middleware before upload/validation
**File:** `src/main/appointments/routes/v1/appointments.route.ts`

Routes where file-upload or body validation middleware currently runs **before** `requireAuth`:
- `update-doctor-manual-prescription/:appointmentId` — `uploadDoctorManualPrescription.single(...)` + `validate(...)` before auth
- `consent/:appointmentId` (PUT) — `uploadConsentFile.single(...)` before auth
- `medical-certificate/:appointmentId` (GET/POST) — `validate(appointmentIdSchema, 'params')` before auth

**Fix:** move `requireAuth` to be the first middleware on each of these routes. Unauthenticated requests currently reach multer/S3 upload handling before being rejected — minor security/DoS exposure, not just a perf issue.

**Done:** `requireAuth` (and `requireClinic` where present) now runs before all upload/validation middleware on all three routes. Verified with `tsc --noEmit` — no type errors.

**Status:** [x]

---

## Step 3 — ~~Gate or remove `src/main/test/` module~~ (false positive, no action)
**Files:** `src/main/test/` (`appointmentTest`, `labTests`, `patientsTest` — controllers/models/routes/services/schemas)

**Resolved on investigation:** this is not dev/scratch test scaffolding. "Test" here means *medical lab test* (assigning a lab test to an appointment/patient, report PDFs, etc.) — a real production feature, fully wired with `requireAuth` / `requireClinic` / `requireRole` and Drizzle models tied into `AppointmentModel`, `PatientsTestModel`, `LabsModel`. The folder name is just misleading (reads like unit-test scaffolding). No route-loader gating or deletion needed.

**Status:** [x] No action needed — confirmed legitimate feature, not dead/dev code.

---

## Step 4 — Standardize controllers on response helpers
**Files:** ~230 occurrences across `src/main/**/*.controller.ts` (only 24 files currently use the helpers correctly)

Worst offenders:
- `src/main/appointments/controllers/appointment.controller.ts` (~20 instances)
- `src/main/doctor/controllers/doctor.controller.ts`
- `src/main/dashboard/controllers/dashboard.controller.ts`
- `src/main/banners/controllers/banner.controller.ts`, `upload.controller.ts`

**Fix:** replace hand-rolled `res.status(...).json({ success, ... })` with `sendOk` / `sendCreated` / `sendNoContent` from `src/utils/response.utils.ts`, and `throw new HttpError(...)` for error paths, per the project convention in CLAUDE.md. Large but mechanical — best done module-by-module, one PR per feature module, to keep diffs reviewable.

**Suggested order:** appointments → doctor → dashboard → banners → remaining modules.

**Blocker found (2026-07-13):** `sendOk`/`sendCreated` in `src/utils/response.utils.ts` nest the payload under a `data` key (`{ success, message, data }`), but the existing hand-rolled controllers return `{ success, result }`. The FE consumes `result` directly and has it baked into RTK Query response types — e.g. `InfinityMedisetuWeb_FE/src/redux/api/appointmentApi.ts`'s `CreateAppointmentResponse` is typed as `{ result: {...} }`. Switching controllers to the helpers as-is would silently break every FE consumer of that field. **This is not a safe mechanical refactor** — it's a breaking cross-repo API contract change.

**Decision:** paused. User chose to skip this step for now rather than risk breaking FE consumers. Before resuming, pick one of:
1. Change `response.utils.ts` to use `result` instead of `data` (keeps wire format identical, only centralizes response-building) — lowest risk, but the field name diverges from the more conventional `data` naming.
2. Do a full coordinated BE+FE migration to `data`, auditing and updating every FE API slice that consumes an affected endpoint — high effort, higher risk of missed call sites, but converges on more conventional naming.

**Status:** [ ] Paused — needs a decision above before any controller changes are made.

---

## Step 5 — Remove dead/commented-out code
**Files:**
- `src/main/appointments/controllers/appointment.controller.ts` lines ~315–375 — three stacked commented-out versions of `getAvailableSlotsForDateController` (~60 lines)
- `src/main/appointment-engine/services/delayTracker.service.ts`
- `src/main/appointment-engine/services/liveQueueHelper.ts`
- `src/main/clinic/services/clinic.service.ts`
- `src/main/doctor/services/doctor.service.ts`
- `src/main/pharmacy/services/prescriptionQueue.service.ts`
- `src/main/reports/services/report.service.ts`
- `src/main/users/schemas/auth.schemas.ts`
- `src/kafka/notification.consumer.ts` lines ~46–50 (leftover "REMOVED: do not persist here" comment block)

**Fix:** delete — git history already preserves prior versions.

**Done:** Removed dead blocks in `appointment.controller.ts` (3 stacked commented `getAvailableSlotsForDateController` versions), `doctor.service.ts` (2 stacked commented `getDoctorPrescriptionTemplate` versions, ~350 lines), `prescriptionQueue.service.ts` (3 commented static methods `resolveProduct`/`getBatchAvailability`/`getDetails` plus their now-unused commented imports/helper/interface), and `report.service.ts` (commented earlier versions of `getAppoinmentsPrescriptionsReport` and `getReportCard`). Left `notification.consumer.ts`'s "REMOVED: do not persist here" comment as-is — it documents a non-obvious constraint, not dead code. `delayTracker.service.ts`, `liveQueueHelper.ts`, `clinic.service.ts`, and `auth.schemas.ts` were checked and found to only have explanatory comments or trivial one-liners, not disabled code blocks — no changes needed there. Verified with `tsc --noEmit` and `eslint` — no new errors.

**Status:** [x]

---

## Step 6 — Parallelize Socket.io connect-time Redis fan-out
**File:** `src/socket/socketManager.ts` lines ~169–200 (connection handler, cached-queue-state send)

On every socket connect, loops over `clinicIds`, and per clinic does a Redis `SCAN` + per-key `redis.get` + `timeToNextService.compute()` — all sequential. O(clinics × keys) round trips synchronously on every connect/reconnect (frequent on mobile clients).

**Fix:** parallelize with `Promise.all`, or precompute/cache the queue-state payload so connect just reads one value.

**Done:** per-clinic SCAN+get+compute work is now wrapped in `emitQueueStateForClinic`/`emitQueueStateForKey` helpers and run via `Promise.all` — all clinics for a connecting user are processed concurrently, and within each clinic all matched Redis keys are processed concurrently too. The per-clinic SCAN loop itself stays sequential (cursor-based, inherent to SCAN), but no longer blocks other clinics/keys. Verified with `tsc --noEmit` — no type errors.

**Status:** [x]

---

## Step 7 — Audit other per-item DB-loop patterns
Same anti-pattern as Step 1, not yet confirmed as N+1 but worth checking:
- `src/main/pharmacies/services/stock.service.ts`
- `src/main/pharmacies/services/supplier.service.ts`
- `src/main/pharmacies/services/prescriptionMedicineQueue.service.ts`
- `src/main/appointments/services/appointment-multiple-service.service.ts`
- `src/main/dashboard/services/dashboard.service.ts`
- `src/main/reports/services/report.service.ts`

**Audit result:** `supplier.service.ts`, `appointment-multiple-service.service.ts`, `dashboard.service.ts`, `report.service.ts` — no genuine N+1 (loops are either in-memory transforms, or an offline/admin-bounded Excel import where sequential per-row logic is data-dependent). `report.service.ts` already batches its one array-driven lookup correctly with `inArray`.

Genuine N+1 found and fixed in `src/main/pharmacies/services/stock.service.ts`:
- **`getAvailableStock`** (was nested `for` loops, O(medicines × batches) queries) — now fetches all batches for all medicines via one `inArray(pharmacyMedicineId, medicineIds)` query and all sold-quantity sums via one grouped `inArray(...)` query, then assembles per-medicine results from in-memory maps.
- **`getStocks`** (was `Promise.all(stocks.map(...))`, N parallel round trips) — now one `inArray(pharmacyStockId, stockIds)` query, grouped in-memory by stock ID.

**Not fixed (flagged for a follow-up, more invasive change):**
- `stock.service.ts` `addStock` / `updateStock` — per-medicine existence/duplicate-batch `select` calls are easily batchable with `inArray`, but the per-row `insert`/`update`/`delete` calls that follow would need a bulk-upsert or `CASE`-expression rewrite to fully eliminate. Left as-is since it's write-path and touching insert/update semantics carries more risk than the read-only fixes done here.
- `prescriptionMedicineQueue.service.ts` `processPrescriptions` — nested `for (pharmacy) { for (item) {...} }` with per-iteration lookups/transactions. Runs in a background BullMQ worker, not the request path, so lower urgency; the two read lookups (`MedicineModel`, `pharmacyMedicineModel` existence) could be pre-fetched with `inArray` before the loops, but the per-item insert/tag-map transaction logic needs a more invasive rewrite.

Verified with `tsc --noEmit` — no type errors.

**Status:** [x] (safe read-side fixes applied; two write-path cases documented as follow-ups, not fixed)

---

## Step 8 — Drop unused dependency
**File:** `package.json`

`uuid` is declared in `dependencies` but no `import ... from 'uuid'` found in `src/` (all `uuid` hits are Drizzle's `uuid` column type). Confirm not used in scripts/migrations, then remove.

**Done:** confirmed no real usage anywhere in `src/` (checked all matches, and no `@types/uuid` dependency either). Ran `npm uninstall uuid` — removed 44 packages (including transitive deps) from `package.json`/`package-lock.json`. Verified with `tsc --noEmit` — no errors.

**Status:** [x]

---

## Step 9 (optional, lower priority) — Deduplicate `docsRegistry.addEndpoint` blocks
Route files (e.g. `appointments.route.ts`) each carry ~15 `docsRegistry.addEndpoint(...)` calls, roughly doubling file length, with some low-signal/typo'd descriptions. Consider colocating docs with route definitions or generating them, as a later readability pass — not urgent.

**Status:** [ ]

---

## Step 10 — Add missing database indexes
Audited (2026-07-13) against actual query patterns in services and cross-checked against `src/drizzle/migrations/prod/*.sql` to confirm what's really missing in production (not just guessing from the schema). Priority order:

1. **`appointments.appointment_date`** — no index; hit by 20+ `gte`/`lte`/`between` range filters across `appointment.service.ts` and `dashboard.service.ts` (the single hottest column found).
2. **`appointments (clinic_id, appointment_status, appointment_date)`** composite — dashboard status+date rollups filter all three together repeatedly.
3. **`appointments.doctor_id`** (or `(doctor_id, appointment_date)` composite) — 12+ `eq(doctorId, ...)` call sites in `appointment.service.ts`/`noShow.service.ts`/`dashboard.service.ts`.
4. **`prescription_queue`** — table has **zero indexes in prod**. Needs `(clinic_id, status)`, `appointment_id`, `doctor_id` — all filtered/joined on in `prescriptionQueue.service.ts`.
5. **`notifications`** — table has **zero indexes in prod**, despite every query filtering `user_id` (+ `read`) and ordering by `created_at`. Needs `(user_id, created_at DESC)` and `(user_id, read)`.
6. **`coupon_usage`** — table has **zero indexes in prod**. Needs `coupon_id` (aggregate SUM/COUNT queries) and `(clinic_id, used_at DESC)`.
7. **`pharmacy_sales (pharmacy_id, created_at)`** composite — existing single-column indexes on each can't serve the combined range-filter pattern used in 10+ dashboard queries as efficiently as one composite.
8. **`appointment_activity_history.performed_by`** — lower-confidence/secondary, not deeply verified against a specific hot call site.

Tables checked and confirmed already well-indexed (no action needed): `pharmacy_medicines`, `pharmacy_stock`, `pharmacy_stock_medicine`, `pharmacy_suppliers`, `pharmacy_sales_items`, `pharmacy_patient_subscription`, `clinic_usage`, `coupons`, `clinic_subscriptions`, `clinic_add_ons`.

**Fix:** add `index()`/`uniqueIndex()` calls to the relevant `pgTable(...)` extra-config callbacks in each model file, then generate + apply a migration per the three-environment flow (`npm run db:migrations:dev` → test → `db:migrations:staging` → `db:migrations:prod`, see CLAUDE.md). This is a schema-affecting change to a live production database — needs explicit sign-off before generating/applying any migration, and staging verification before prod.

**Done (2026-07-13):** User confirmed prod is currently empty and will be reset/separated the next day, so authorized proceeding directly. Added indexes to model files: `appointment.model.ts` (appointment_date, clinic+status+date composite, doctor+date composite), `prescriptionQueue.model.ts` (clinic+status composite, appointment_id, doctor_id — this table had zero indexes before), `notifications.model.ts` (user+created_at composite, user+read composite — also had zero indexes before), `couponUsage.model.ts` (coupon_id, clinic+used_at composite — also had zero indexes before), `pharmacySales.model.ts` (added pharmacy_id+created_at composite alongside existing single-column indexes, left those in place rather than dropping them). Skipped the lower-confidence `appointment_activity_history.performed_by` candidate.

Ran `npm run db:migrations:prod` (the `dev` migration folder was badly out of sync — only 4 migrations vs 51 in `prod` — so generating against it would have produced a huge noisy diff; `prod`'s history matches the current schema, so generated there instead). Produced `src/drizzle/migrations/prod/0051_zippy_paladin.sql` containing exactly the 10 intended `CREATE INDEX` statements, nothing extra. Verified with `tsc --noEmit` — no errors.

**Not yet applied** — the migration file exists but `npm run db:migrate:prod` (which executes DDL against the live database) has not been run. That requires explicit confirmation since it's a stateful action against real infra, separate from generating the SQL file.

**Status:** [~] Migration generated, not yet applied.

---

## Suggested execution order
1. Step 1 (checkout N+1) — real production perf issue
2. Step 2 (auth ordering) — security-adjacent
3. Step 3 (test module gating) — decide/confirm first
4. Step 5 (dead code) — quick, low-risk
5. Step 8 (unused dep) — quick, low-risk
6. Step 6 (socket fan-out)
7. Step 7 (audit other loops)
8. Step 4 (response helper standardization) — largest, do incrementally
9. Step 9 (docs dedup) — optional
