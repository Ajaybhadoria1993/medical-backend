# Lab Module Refactor — Status & Reference

Working notes for the lab-module cleanup (indexes, naming, response envelope, catalog
linking, table renames). Use this as the source of truth for what's shipped vs.
what still needs a human step before it's live.

## Done

### 1. Missing indexes (additive, no data risk)
- `lab_orders` (formerly `appointment_tests`) — added indexes on `appointmentId`,
  `testId`, `patientId`, `doctorId`, `clinicId`, `labAssistantId`, `reportStatus`,
  `paymentStatus`, `workflowStatus`, `sampleStatus`, plus composites
  `(labAssistantId, createdAt)` and `(clinicId, reportStatus)`. Previously had zero
  indexes besides one unique constraint.
- `lab_order_tracking_events` (formerly `appointment_test_tracking_events`) — added
  indexes on `appointmentTestId`, `clinicId`, `labId`, `createdAt`. Previously had
  none.
- `labs.clinicId`, `user_lab_assignments` (`labId`, `userId` standalone),
  `lab_departments_master.departmentId` (on the `lab_departments` join table),
  `lab_departments_master.name`, `lab_samples` (`clinicId`, `status`, composite
  `(labId, status)`), `lab_invoices` (`patientId`, `doctorId`),
  `lab_order_result_values.parameterId`, `test_catalog` (`doctorId`, `status`).
- Removed one redundant duplicate index on `lab_samples.appointmentTestId` (was
  already covered by a unique index on the same column).

Files: `src/main/test/models/appointmentTest.model.ts`,
`src/main/lab/models/lab.model.ts`, `src/main/lab/models/labSample.model.ts`,
`src/main/lab/models/labInvoice.model.ts`, `src/main/lab/models/labResult.model.ts`,
`src/main/test/models/patientsTest.model.ts`.

### 2. Response envelope standardization
- `src/main/lab/controllers/lab.controller.ts` (30 endpoints) rewritten to use
  `sendOk`/`sendCreated` from `utils/response.utils.ts` instead of hand-rolled
  `res.status(...).json(...)`. Every endpoint now returns a consistent
  `{ success, message, data }` shape (paginated endpoints also include
  `pagination`), matching the CLAUDE.md-documented convention.
- FE (`InfinityMedisetuWeb_FE/src/redux/api/labApi.ts`) response pickers
  (`pickLabArray`, `pickLabOne`, etc.) already probed `res.data` first, so no FE
  change was required — the defensive multi-shape fallback branches are now dead
  weight but harmless; left in place.

### 3. Naming fix: `clientId` → `clinicId`
- `test_catalog` (formerly `patients_test`) column `client_id` renamed to
  `clinic_id` to match every sibling table's FK naming convention.
- Updated: `src/main/test/services/patientsTest.service.ts`,
  `src/main/test/services/appointmentTest.service.ts`,
  FE `src/schemas/test.ts`, `src/redux/api/testApi.ts`,
  `src/pages/test-catalog/TestCatalog.tsx`.

### 4. Catalog linking: `test_catalog` ↔ `lab_test_catalog`
- Added `test_catalog.lab_test_id` → `lab_test_catalog.id` (nullable FK,
  `ON DELETE SET NULL`, indexed).
- Replaced two fragile name-string-matching joins in
  `src/main/test/services/appointmentTest.service.ts`
  (`getStoredSampleScanValue` and the appointment-test detail query) with a
  direct FK match, keeping the old name-match as a fallback for legacy rows
  that predate the FK.
- `getOrCreatePatientTestFromLabCatalog` now looks up/links by `labTestId`
  first, backfills the link onto existing name-matched rows, and sets it on
  newly created rows going forward.
- **Decision**: `lab_test_catalog` was *not* dropped/merged away. Verified via a
  dev-DB audit that it backs a real, actively-coded feature (lab-assistant
  catalog management + fuzzy test-matching in `labTests.service.ts`), even
  though it currently has 0 rows in the dev DB (feature unexercised there, not
  dead). Since every FK already pointed at `test_catalog`, no FK repointing was
  needed — this was the lowest-risk resolution of the original "two catalog
  tables" duplication finding.

### 5. Table renames (clarity)
| Old name | New name | Reason |
|---|---|---|
| `patients_test` | `test_catalog` | Was easily misread as "tests belonging to a patient"; it's actually the doctor-facing price list/catalog. |
| `appointment_tests` | `lab_orders` | Was easily misread as being about appointments; it's actually the lab order + workflow instance (sample/report status tracking). |
| `lab_tests` | `lab_test_catalog` | Disambiguates from `test_catalog` — this is specifically the lab's own offered-tests catalog (per `labId`/`departmentId`, with `testCode`/`sampleType`/`source`). |
| `appointment_test_tracking_events` | `lab_order_tracking_events` | Matches the `lab_orders` rename. |
| `departments` | `lab_departments_master` | Was missing the `lab_` prefix despite being lab-domain-only; avoids ambiguity with the `lab_departments` join table. |

Only the SQL table name (and index/constraint names) changed — Drizzle export
identifiers (`PatientsTestModel`, `AppointmentTestModel`, `LabTestsModel`,
`AppointmentTestTrackingEventModel`, `DepartmentsModel`) were **not** renamed
in this pass, to keep the diff scoped to the DB layer. TypeScript imports
across the codebase are unaffected.

Files: `src/main/test/models/patientsTest.model.ts`,
`src/main/test/models/appointmentTest.model.ts`,
`src/main/test/models/labTest.model.ts`,
`src/main/lab/models/lab.model.ts`.

### 6. TS symbol/file rename to match table renames
Followed up on item C below: renamed the Drizzle model files and their
exported symbols so the TS side matches the SQL table names from item 5
(the SQL/table names themselves were untouched — no migration involved).
- `src/main/test/models/patientsTest.model.ts` → `testCatalog.model.ts`, `PatientsTestModel` → `TestCatalogModel`
- `src/main/test/models/appointmentTest.model.ts` → `labOrder.model.ts`, `AppointmentTestModel` → `LabOrderModel`, `AppointmentTestTrackingEventModel` → `LabOrderTrackingEventModel`
- `src/main/test/models/labTest.model.ts` → `labTestCatalog.model.ts`, `LabTestsModel` → `LabTestCatalogModel`
- `src/main/lab/models/lab.model.ts` (file unchanged): `DepartmentsModel` → `LabDepartmentsMasterModel`

All importers were updated accordingly (services, other model files, seeds,
reports). `npx tsc -p tsconfig.json --noEmit` passes clean after the rename.

## Pending — needs a human step

### A. Generate + apply the dev migration for the table renames
`npm run db:migrations:dev` requires an **interactive terminal** to confirm
each table rename (drizzle-kit can't tell "renamed" from "dropped + recreated"
from a schema diff alone, and a wrong answer here would drop live data). Run it
yourself and answer **rename** (not "create new table") for each of these 5
prompts:

| Old name | New name |
|---|---|
| `patients_test` | `test_catalog` |
| `appointment_tests` | `lab_orders` |
| `lab_tests` | `lab_test_catalog` |
| `appointment_test_tracking_events` | `lab_order_tracking_events` |
| `departments` | `lab_departments_master` |

It will also show a batch of dropped/recreated index names (renamed to match
the new table names) — those are safe to accept either way, no data loss.

**Before running `db:migrate:dev`**, share the generated SQL file
(`src/drizzle/migrations/dev/000X_*.sql`) so it can be verified as
`ALTER TABLE ... RENAME TO ...` statements, not `DROP TABLE`/`CREATE TABLE`
pairs.

### B. Repeat for staging/prod when ready to deploy
Same rename confirmation flow via `npm run db:migrations:staging` /
`db:migrations:prod`, on their own tracked migration folders, at deploy time —
not before this is verified in dev.

### C. (Moved to Done — see below.)

### D. Not attempted: full catalog table merge
Merging `test_catalog` and `lab_test_catalog` into one table (rather than
linking them via FK) was considered and explicitly deferred — it would require
repointing `lab_orders.testId`, `lab_invoices.testId`, `lab_samples.testId` and
a real data backfill verified against staging/prod, which needs a dedicated
pass with production data access, not something to run from a dev-only audit.
