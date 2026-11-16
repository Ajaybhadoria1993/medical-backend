# Lab Catalog Schema Rework — Status & Reference

Working notes for expanding the lab test catalog (`lab_updated_department`,
`lab_updated_tests`, `lab_updated_test_result_parameters`) with clinical
metadata, test groups, aliases and structured reference ranges. Source
requirements: `mediarogya_laboratory_database_schema_recommendations.md`,
reconciled against a UI dry run. Use this as the source of truth for what's
shipped vs. what still needs a human step (migration) or further wiring
(services/controllers/schemas/routes/caching) before it's live.

## Done

### 1. Model changes — `src/main/lab/models/labUpdated.model.ts`

**`lab_updated_tests`** (altered) — added `shortName`, `loincCode`,
`container`, `sampleVolume` (single `varchar`, intentionally *not* split into
numeric + unit), `stability`, `storage`, `method`, `technology`,
`testType` (nullable, no default — e.g. "Profile", "Single Test",
"Microscopy"; the source catalog calls this `testCategory`, but the API and
column are `testType` — a payload still sending `testCategory` is accepted
with that key silently stripped by Zod, so `testType` saves as null),
`turnaroundTimeHours` (hours, not minutes), `clinicalSignificance`,
`limitations`, `advice`, `testDisclaimer`, `whenResultHigh`, `whenResultLow`,
`whenResultCritical`, `groupId` (nullable FK → `lab_updated_test_groups`,
indexed), and `version` (integer, default `0`) — an edit counter, not a
version-pin: it increments by 1 (`sql\`${col} + 1\``, an atomic DB-side
increment, never read-then-write) on every successful `PUT /lab-tests/:testId`
and on every suggestion-apply update of an existing test. 0 means "never
edited since creation."

**`lab_updated_test_result_parameters`** (altered) — added `code`,
`unitless` (boolean), `decimals` (default `1`), `section`, `formula`.
`referenceRange` is kept **deprecated-in-place** — not dropped — until the
create/update/report-generation code stops reading it (see §10 of the
recommendations doc; this is the same staged-migration discipline).

**`lab_updated_test_groups`** (new) — `id, labId, name, status, createdAt,
updatedAt` + unique `(labId, name)`. `code` and `description` were
deliberately left out: nothing in the UI creates or displays them.

**`lab_updated_test_aliases`** (new) — `id, testId, alias, createdAt` +
unique `(testId, alias)`.

**`lab_updated_parameter_reference_ranges`** (new) — `id, parameterId,
gender, ageFromYears, ageToYears, condition, type, lowRange, highRange,
label, createdAt, updatedAt`. No `ageUnit` — age is normalized to years at
write time (fractional, e.g. `0.08` ≈ 1 month). `condition` (Fasting /
Post-prandial / Pregnancy trimester) and `label` (for "band" type ranges,
e.g. "Borderline high") were added; they weren't in the original
recommendations doc but are required by real reference ranges seen in use.
`type` is the *shape* of the interval (`range` / `lt` / `gt` / `band`), not a
clinical classification — that ambiguity in the recommendations doc is
resolved this way. Only applies to `inputType: 'number'` parameters — see
below for `'select'`.

**`lab_updated_parameter_options`** (new) — `id, parameterId, optionValue,
isNormal, createdAt`. Not in the recommendations doc at all, and
deliberately kept separate from `lab_updated_parameter_reference_ranges`
rather than folded into it: a categorical/semi-quantitative parameter (e.g.
`Haemoparasites: Not seen/Seen`, `Pus cells: Nil/Trace/1+/2+/3+/4+`) is a
fixed option list, not a numeric interval — it has no `lowRange`/`highRange`,
and reusing `label` for the option text would collide with that column's
existing meaning (the band caption on a numeric range, e.g. "Borderline
high"). `inputType` on the parameter discriminates which table has rows:
`'select'` → this table; `'number'` → the reference ranges table (`'text'`,
`'textarea'`, `'date'`, `'boolean'` use neither — see
`RANGE_INPUT_TYPES`/`OPTION_INPUT_TYPES` in `labCatalog.service.ts`, the
single source of truth for this mapping). `isNormal` flags which option(s) render un-flagged on a
report; a parameter with no "normal" option (e.g. Blood Group) just never
flags anything. No `sortOrder` — ladder order (`Nil < Trace < 1+ < 2+...`)
relies on insertion order via the replace-all endpoint rather than an
explicit column; fine as long as options are always written through that
endpoint in the intended order, not edited one row at a time.

`npx tsc -p tsconfig.json --noEmit` and `npx eslint` both pass clean after
these changes.

### 2. CRUD + suggestions wiring

All three catalog write paths accept and return the new fields — this is no
longer schema-only.

- **`labCatalog.service.ts`** (shared helpers used by every path below):
  - `LabCatalogTestInput`/`LabCatalogParameterInput` types grew to cover every
    new column, plus `aliases: string[]`, `ranges`/`options` per parameter,
    and `groupId`/`groupName` on the test.
  - New: `ensureGroup` (validates a `groupId` belongs to the lab, like
    `ensureDepartment`), `ensureGroupByName` (auto-create-or-match by name —
    used only by the suggestions path, see below), `replaceAliases`,
    `replaceParameterRanges`, `replaceParameterOptions` — all delete-then-
    insert, matching `replaceParameters`'s existing pattern.
  - `replaceParameters` now inserts parameters one at a time (was a single
    bulk `INSERT ... VALUES`) so each row's generated id is available
    immediately to attach its ranges/options — Postgres doesn't guarantee
    multi-row `RETURNING` order matches `VALUES` input order, so bulk-insert
    + positional-index correlation would have been fragile.
  - `formatTest()` now also returns `aliases: string[]` and, per parameter,
    `ranges` (when `inputType === 'number'`) or `options` (when `inputType
    === 'select'`) — never both, and never a silent fallback to the wrong
    shape. `RANGE_INPUT_TYPES`/`OPTION_INPUT_TYPES` in this file are the one
    place that mapping is defined; `labTestResultParameters.service.ts`
    mirrors it in `applyRangesOrOptions` and must stay in sync by hand (no
    shared enum to import it from, since input types are plain strings).
- **`labTests.service.ts`** (`POST`/`PUT /lab-tests`) — `createTest` validates
  `groupId` via `ensureGroup` before insert; both `createTest` and
  `updateTest` write every new scalar column and call `replaceAliases`.
  `getTests` (the list endpoint) additionally returns `shortName`, `testType`,
  `turnaroundTimeHours`, `groupId` — the long clinical-text fields stay
  detail-only (`getTestById`/`formatTest`) to keep the list response light.
- **`labTestResultParameters.service.ts`** (`POST`/`PUT
  /lab-test-result-parameters`) — `createParameter`/`updateParameter` now
  build their `.values()`/`.set()` explicitly (previously spread `...payload`
  directly into the Drizzle call, which would have forwarded the new
  `ranges`/`options` keys as if they were columns); both call
  `applyRangesOrOptions` after the write, keyed off the resolved `inputType`.
- **`labUpdated.service.ts`** (`/suggestions`) — `upsertSuggestedTest`
  resolves `groupId` by **auto-create-or-match by name** when a suggestion
  carries `groupName` instead of a direct `groupId` (the confirmed design
  choice — see "Open decisions" for the alternative that was turned down),
  and writes every new column + aliases. `applySuggestions`' bulk
  create/update path reuses this, so no separate wiring was needed there.
  `getDefaultSuggestionsForLab` (the `GET /suggestions` *preview* diff, not
  the apply path) was **not** updated — it still diffs only the pre-existing
  fields. Low priority: it's a preview endpoint, not a write path.
- Schemas: `createLabTestResultParameterWithoutTestSchema` (in
  `labTestResultParameters.schemas.ts`) gained `code`, `unitless`, `decimals`,
  `section`, `formula`, `ranges`, `options`, `referenceGender`, and is the
  single parameter schema for every payload. **Bug found and fixed later:**
  `labTests.schemas.ts` originally kept its own private 6-field copy of this
  schema, so Zod silently stripped every new nested parameter field from
  `POST`/`PUT /lab-tests` bodies until that copy was deleted and replaced by
  an import of the shared one. Caught by running the real catalog through
  `createLabTestSchema` — typecheck can't see it, since stripping is runtime
  behaviour. `labTests.schemas.ts` exports a new
  `labTestClinicalFieldsSchema` fragment (the new test-level columns +
  `aliases`), which `labUpdated.schemas.ts` `.merge()`s into its suggestion
  schema and then adds `groupName` on top of.
- Controllers and routes needed **no changes** — every controller in this
  module already passes `req.validatedBody` straight through to its service,
  so a richer Zod schema is all it took.

### 3. `data/labUpdatedDefaultSuggestions.json` — rebuilt from the full catalog
Regenerated from `lab_departments_all_tests_and_parameters.json` (the
product-supplied catalog): **17 departments, 130 tests** (was 11 / 38). New
departments: Endocrinology, Cardiac Markers, Vitamins & Nutrition, Tumor
Markers, Autoimmune Diagnostics, Therapeutic Drug Monitoring. All 11
original department codes are kept, so `departmentCode` lookups in
`createTest` still resolve. The old `BLOOD_SUGAR` test is gone from the
library (the source splits it into `FASTING_BLOOD_SUGAR`, `PPBS`, `RBS`,
`HBA1C`); labs that already applied it keep their copy — it just shows as a
custom test in the `GET /suggestions` preview.

Refinements made while converting (source data otherwise kept verbatim):
- **Gender rows merged.** The source lists 14 parameters twice — one entry
  per `referenceGender` (e.g. two "Haemoglobin" rows in CBC). Stored as-is
  that breaks the unique `(testId, parameterName)` index, and
  `upsertParameters` matches by name, so the Female row would silently
  overwrite the Male one. Each pair is now one parameter with
  `ranges: [{gender: "Male", …}, {gender: "Female", …}]`, and its
  `referenceRange` text combined as `"Male: 13.0–17.0; Female: 12.0–15.5"`
  so the not-yet-migrated report templates still print both.
- **`testType`** — the source's `testCategory` values, stored under the
  `testType` key; `"Molecular"` normalized to `"Molecular Diagnostics"` (the
  source uses both for the same thing).
- **`groupName`** added to every test (34 clinical groups — "Routine
  Haematology", "Anaemia Profile", "Fever Profile", "Thyroid Profile", …).
  The source has no group field; this is what exercises
  `ensureGroupByName`'s auto-create path.
- **Every one of the 180 numeric source entries** (counted before gender
  merging) decided one of three ways — 132 get structured `ranges`, 48 stay
  text-only. The build script fails if any numeric entry isn't covered:
  - *90 strict-parsed* — clean values (`"13.0–17.0"`, `"4,000–11,000"`,
    `"150–450 ×10^3/µL"`, `"<5"`, `">40"`, `"Male: 65–175"`), same rules as
    the runtime `parseReferenceRange`.
  - *42 curated overrides* for hedged or multi-clause text: `"Adults: …"` →
    `ageFromYears: 18`; ACR → KDIGO A1/A2/A3 `band`s; Vitamin D → Deficient /
    Insufficient / Sufficient `band`s; Anti-HBs → Non-protective / Protective
    `band`s; lipid targets and therapeutic drug ranges carry a `label`
    ("Desirable", "Therapeutic", "Not on anticoagulants"…).
  - *48 deliberately text-only* — "use laboratory interval", "assay-specific
    99th percentile", "no universal reference interval". These keep their
    text and get **no** structured range, so they never auto-flag a patient
    result off a number the source itself says not to use.
- **No `condition` on any range.** Fasting/2-hour/OGTT context lives in the
  parameter name instead. Report selection matches a range only when its
  `condition` equals the patient's, so a `condition` here would make the
  range never match for patients with no recorded condition.
- Text-type parameters (Negative / Non-reactive / Absent…) left as `text`,
  not converted to `select` + `options` — that changes the result-entry UI
  and wasn't in the source. A reasonable follow-up, not done here.

Build script: run once from scratch, not committed (one-off data
conversion). Its counts: 90 parsed, 42 overridden, 48 text-only, 14 merged.

### 4. APIs accept the source catalog's flat shape
Every parameter payload (`POST`/`PUT /lab-tests` `parameters[]`,
`POST`/`PUT /lab-test-result-parameters`, `POST /suggestions` `tests[]`) now
also accepts the flat shape the catalog uses — one entry per gender with
`referenceGender` + a `referenceRange` string, no `ranges`:
- `normalizeParameterInputs` (inside `replaceParameters` /
  `upsertParameters`) merges same-name entries into one parameter, builds
  `ranges` from each entry's `referenceRange` + `referenceGender` via the
  strict `parseReferenceRange`, and combines the text the same way the data
  file does. Explicit `ranges` always win over derivation.
- The same gender listed twice for one parameter → **400**, not a silent
  overwrite.
- Unparseable `referenceRange` text stores as text only, with no range
  derived — never a guess.
- On `PUT /lab-test-result-parameters/:id`, sending a new parseable
  `referenceRange` without `ranges` re-derives the ranges so they don't drift
  from the text; an unparseable or absent one leaves existing ranges alone.
- Verified by pushing all 130 source tests through `createLabTestSchema` +
  `normalizeParameterInputs`: all accepted, all merged to the same parameter
  set as the stored file.

Responses show the merged shape, not the flat one: `referenceGender` is
input-only, and gender lives on each `ranges[]` entry. `formatTest` now
returns range bounds as numbers (Postgres `numeric` came back from Drizzle as
strings like `"13.0000"`).

### 5. `isCustom` — custom vs system, derived on read
Every catalog response now says whether a test/parameter is the lab's own
(`isCustom: true`) or from the default library (`false`). **Derived, not
stored** — no origin column (chosen over adding one). Rule, in
`findLibraryTest` / `isCustomParameter` (`labCatalog.service.ts`), the same
one `GET /suggestions` already used:
- Test is system when its department matches a library department (code or
  name) **and** the test matches one of that department's library tests
  (code or name).
- Parameter is system when its test is system **and** its name matches one of
  that library test's parameters — a field a lab adds to CBC is custom.

Returned by: `GET /lab-tests` (each list item), `GET /lab-tests/:testId` and
create/update responses (test + each parameter), `GET
/lab-test-result-parameters`, `.../test/:testId`, create/update parameter
responses. `GET /suggestions` now sends `isCustom: false` explicitly on
library departments/tests/parameters — before, the key was simply missing.
Test and list responses also gained `departmentCode` (needed for the match).

**Known limitation:** a test a lab creates using a library code or name
(e.g. its own "Hemoglobin") reads as system. Adding a stored `isCustom`
column set at write time removes this; it was offered and declined.

### Known gap: no group CRUD API yet
`groupId` can be set on a test, and `ensureGroup`/`ensureGroupByName` can
validate or auto-create one — but there's still no direct way for a lab to
list/create/rename a group outside of the suggestions flow's auto-create.
A `labTestGroups.route.ts` mirroring `labDepartment.route.ts` (see the table
below) is the natural next step whenever a lab needs to manage groups
without going through `/suggestions`.

## Pending — needs a human step

### A. Generate + apply the dev migration
Per `CLAUDE.md` §7, migrations are generated and applied by the repo owner,
never by an agent. Run `npm run db:migrations:dev`, review the generated SQL
(every new column should be `ADD COLUMN ... DEFAULT ...` or nullable — no
`DROP`/`RENAME`, so this one shouldn't need the interactive rename-confirm
flow that item A in `LAB_MODULE_REFACTOR.md` needed), then
`npm run db:migrate:dev`. Repeat for staging/prod at deploy time via their
own tracked migration folders.

### B. Report generation still reads the old shape
`labReport.service.ts` + `reportTemplate/labReportTemplate1.ts` /
`labReportTemplate2.ts` haven't been touched — they still render from the
flat `referenceRange` string and don't surface `clinicalSignificance`,
`limitations`, `advice`, `testDisclaimer`, `whenResultHigh/Low/Critical`, or
the structured ranges/options. This is the last consumer standing between
the new tables and actually dropping `referenceRange` (see "Open decisions").

### C. New API routes

Routes are auto-mounted by `src/utils/loadRoutes.ts`: a file
`src/main/lab/routes/v1/{name}.ts` mounts at `/api/v1/lab` if `{name}` equals
the feature folder (`lab`), else at `/api/v1/lab/{kebab-case-name}`. Existing
catalog routes, for reference:

| File | Mounted at | Methods |
|---|---|---|
| `labDepartment.route.ts` | `/api/v1/lab/lab-department` | `POST /`, `GET /`, `GET /departments` (default suggestions), `GET /:departmentId`, `PUT /:departmentId` |
| `labTests.route.ts` | `/api/v1/lab/lab-tests` | `POST /`, `GET /`, `GET /:testId`, `PUT /:testId` |
| `labTestResultParameters.route.ts` | `/api/v1/lab/lab-test-result-parameters` | `POST /`, `GET /`, `GET /test/:testId`, `PUT /:parameterId` |

All three gate on the same middleware stack: `requireAuth`,
`requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist'])`,
`requireLab`, `requireLabClinicContext`,
`requireFeature(FEATURE_KEYS.LAB_INTEGRATION)`. New routes should match it
exactly — don't invent a different guard set for sibling catalog resources.

**Decision made:** aliases, reference ranges and options ended up **not**
needing their own route files. They're nested fields on the test/parameter
payload (`aliases` on a test; `ranges`/`options` on a parameter) and are
replace-all'd by `labTests.service.ts`/`labTestResultParameters.service.ts`
as part of the normal create/update call — one request configures a test or
parameter completely, rather than requiring 2-3 follow-up calls to separate
sub-resource endpoints. Only test groups still need a standalone route,
since a group isn't nested under anything — it's a sibling lab-scoped master
like department:

| New file | Mounts at | Methods | Notes |
|---|---|---|---|
| `labTestGroups.route.ts` | `/api/v1/lab/lab-test-groups` | `POST /`, `GET /`, `GET /:groupId`, `PUT /:groupId` | Mirrors `labDepartment.route.ts` shape. Not yet built — see "Known gap" above. |

No route changes were needed on `lab-tests` or `lab-test-result-parameters`
themselves — they accept the new body fields through their existing
`create`/`update` schemas.

## Caching plan (per `docs/playbook/BACKEND_STANDARDS.md` §8)

No caching exists in `src/main/lab/` today (`getOrSetCache`/`CacheKeys` — zero
hits). Two candidates are worth adding once the wiring above lands; nothing
else in this module currently justifies the complexity.

### What to cache

1. **`CacheKeys.labCatalogTestDetail(testId)`** — the assembled
   `formatTest()` shape (test + aliases + parameters, each with its ranges or
   options). Read by `getTestById`, `getParametersByTestId`, and — most
   importantly — **report generation**, which needs this per result line
   once `labReport.service.ts` is updated to read it (see Pending B).
   Catalog config changes rarely; reports and order screens read it
   constantly. TTL: ~10 minutes.
2. **`CacheKeys.labCatalogDepartmentsActive(labId)`** — the lab's active
   department list, read as a code→department map. `LabTestsService.createTest`
   calls `getOrCreateDepartmentByCode` on every test creation/import, doing a
   DB round-trip each time. TTL: ~15 minutes.

### What not to cache
- `LabTestsService.getTests` / `LabTestResultParametersService.getParameters`
  — paginated + free-text search; the key space explodes per
  `search`/`page`/`status` combo, so a cache here would have a poor hit rate
  for the complexity added. Leave DB-direct unless profiling says otherwise.
- `LabDepartmentService.getDefaultDepartments()` — reads a static JSON file
  in memory already, not the DB.

### Writers that must invalidate (rule 1 — found by grepping every write to
these three tables; belongs in the PR description per the playbook)

| Table | Writer | File |
|---|---|---|
| department | `createDepartment`, `updateDepartment` | `labDepartment.service.ts` |
| department | `getOrCreateDepartmentByCode` (inside `createTest`) | `labTests.service.ts` |
| department | `upsertSuggestedDepartment`, `syncInactiveItems` (via `applySuggestions`) | `labUpdated.service.ts` |
| test | `createTest`, `updateTest` | `labTests.service.ts` |
| test | `upsertSuggestedTest`, `syncInactiveItems` (via `applySuggestions`) | `labUpdated.service.ts` |
| parameters | `replaceParameters`, `upsertParameters` (called from `createTest`/`updateTest`) | `labCatalog.service.ts` |
| parameters | `createParameter`, `updateParameter` | `labTestResultParameters.service.ts` |
| parameters | (same `applySuggestions` path) | `labUpdated.service.ts` |

`labUpdated.service.ts`'s `applySuggestions` flow is the easy one to miss —
it bulk-writes all three tables from the "apply default suggestions" wizard
in one pass, so it needs the same invalidation as the individual
create/update paths, even though it never calls them directly.

### Mechanics
- Add both keys to `CacheKeys` in `src/utils/cache.util.ts` — never build a
  key by string concatenation at the call site.
- Group invalidation, not single members: `updateTest` must clear
  `labCatalogTestDetail(testId)` even when the actual write was
  `replaceParameters`, which runs inside the shared `trx` and must **not**
  invalidate itself — the function that owns the transaction invalidates,
  after `database.transaction(...)` resolves (rule 3).
- Wrap reads in `getOrSetCache` with an explicit TTL (rule 5 — no key
  without an expiry); wrap writes in `withCacheInvalidation` or a bare
  `invalidateCache` call after the transaction returns (rule 4 — cache
  failures log and swallow, never fail or roll back the write).

## Open decisions / tradeoffs to flag if revisited
- `lab_updated_parameter_options` and `lab_updated_parameter_reference_ranges`
  are two separate tables rather than one polymorphic one, discriminated by
  the parameter's `inputType` at the application layer — there's no DB
  constraint stopping both tables from having rows for the same parameter.
  If that ever happens (a bug, or a parameter's `inputType` changed after
  ranges/options were already configured), `formatTest()` must still pick
  one deterministically rather than merging both into the response.
- `sampleVolume` is a single free-text `varchar`, not split into numeric +
  unit — matches the current UI, but means it can't be validated or
  aggregated numerically later without a follow-up migration.
- `ageFromYears`/`ageToYears` without `ageUnit` loses day-level precision —
  fine for an adult-focused catalog, worth revisiting if neonatal/paediatric
  reference ranges (e.g. bilirubin-by-day-of-life) are ever needed.
- `referenceRange` on `lab_updated_test_result_parameters` stays until every
  consumer (create/update APIs, report generation) reads from
  `lab_updated_parameter_reference_ranges` instead — don't drop it early.
