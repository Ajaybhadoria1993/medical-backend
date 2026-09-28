# Backend Standards

The single rule set for `InfinityMedisetu_BE`. Every BE change is checked against this file.

**This is the only playbook.** It replaces `BACKEND_CONVENTIONS.md`. The other files in
`docs/playbook/` (`NOTIFICATION_REBUILD.md`, `NOTIFICATION_TEST_PLAN.md`) are migration plans for
one in-flight project, not standards — they retire when that cutover finishes. Everything in
`docs/` proper is per-feature reference (how the appointment engine works, how Razorpay flows);
architecture lives in `CLAUDE.md`. **Don't add a second rules doc** — add to the right section here.

Rule status:

- **MUST** — a reviewer rejects the change if it is broken.
- **SHOULD** — the default; deviating needs a reason stated in the PR.
- **MIGRATING** — the target state. New code follows it; existing code converts only when you are
  already editing that file. Never open a sweeping migration PR on its own.

**Contents**

1. [Module structure](#1-module-structure) · 2. [File naming](#2-file-naming) ·
3. [Routes & controllers](#3-routes--controllers) · 4. [Services](#4-services) ·
5. [Validation & types](#5-validation--types) · 6. [Responses & errors](#6-responses--errors) ·
7. [Database & Drizzle](#7-database--drizzle) · 8. [Caching](#8-caching) ·
9. [Auth & tenancy](#9-auth--tenancy) · 10. [Realtime & background work](#10-realtime--background-work) ·
11. [Logging & secrets](#11-logging--secrets) · 12. [Tests](#12-tests) ·
13. [Build & workflow](#13-build--workflow) · 14. [Enforcement](#14-enforcement) ·
15. [Review checklist](#15-review-checklist)

---

## 1. Module structure

There are 27 modules under `src/main/`, in two shapes. **Copy the one that matches what you're
building** — don't invent a third.

### Feature module (26 of 27) — owns HTTP routes

```
src/main/{feature}/
  routes/          thin: middleware wiring + controller call only
  controllers/     HTTP in, HTTP out — no business logic
  services/        orchestration + DB access
  models/          Drizzle schema + queries
  schemas/         Zod request/response schemas
  middlewares/     feature-specific middleware
  types/           {name}.types.ts — one types folder per feature
  utils/           {name}.utils.ts — pure helpers, constants
```

### Engine module — domain logic with no routes of its own

`appointment-engine` is the reference. It owns the real-time queue: delay tracking, running-late
notification, no-show rescheduling, token capacity, queue broadcast. It has **no `routes/`** — the
`appointments` feature imports its controllers and mounts them
(`appointments/routes/v1/appointments.route.ts`).

```
src/main/appointment-engine/
  index.ts               barrel — the module's public surface
  controllers/           8 files, mounted by the owning feature's routes
  services/              25 files + index.ts barrel
  models/                3 Drizzle models specific to the engine
  schemas/               6 Zod schemas
  types/                 engine.types.ts, queue.types.ts, receptionLiveQueue.types.ts
  utils/                 helpers.ts, queueBoard.ts, … + index.ts barrel
  __tests__/             28 co-located tests — the best-tested module in the repo
```

**Build an engine module when** the logic is substantial, has its own vocabulary, and is consumed
by more than one feature or by cron/socket callers as well as HTTP. Otherwise build a feature
module. An engine module still follows every rule below — it just has no `routes/`.

### Rules

1. **MUST** — follow the nearest sibling module rather than inventing a structure. New shapes
   fragment a 702-file codebase fast.
2. **MUST — a service file contains only its service.** No response/domain types, pure helpers, or
   lookup constants declared alongside the class. A file mixing all four is the specific smell this
   rule exists to prevent:

   | Concern | Location |
   |---|---|
   | Types | `src/main/{feature}/types/{name}.types.ts` |
   | Pure helpers / constants | `src/main/{feature}/utils/{name}.utils.ts` |
   | Orchestration + DB access | `src/main/{feature}/services/` |

3. **MUST** — one types **folder** per module (`types/`), never a flat `{feature}.types.ts` at the
   module root beside it. **`types/` gets no barrel** — import the specific file. All 10 modules
   with a `types/` folder follow this.
4. **SHOULD — a barrel `index.ts` is for a module's public surface, not for its types.** An engine
   module consumed from outside earns one at the module root (and optionally in `services/` and
   `utils/`), the way `appointment-engine` does, so callers import from the module rather than
   reaching into its internals. A feature module whose only consumer is its own routes does not
   need one.
5. **MUST** — versioned code reuses the same folders with a `v2/` subfolder (`controllers/v2/`,
   `services/v2/`), never a parallel top-level tree. See `appointments` and `clinic` for the
   precedent.
6. **MUST** — request-body transformation (multipart parsing, payload reshaping) lives in a
   middleware in the module's own `middlewares/`, never inline in a `routes/*.ts` file.
7. **MUST** — tests live in `__tests__/` in the module they cover. Both names exist for
   historical reasons; `tests/` is the backlog (§14), not the pattern. This entry used to say
   "use `tests/` for a new module, it's the majority" and contradicted §12 — never add a second
   folder to a module that already has one.

## 2. File naming

**MUST — camelCase base names**: `profileOverview.route.ts`, not `profile-overview.route.ts`.
Matches `clinic.service.ts` / `clinic.route.ts`.

| Kind | Pattern |
|---|---|
| Route | `{name}.route.ts` |
| Controller | `{name}.controller.ts` |
| Service | `{name}.service.ts` |
| Zod schema | `{name}.schema.ts` |
| Types | `{name}.types.ts` (in `types/`) |
| Helpers | `{name}.utils.ts` (in `utils/`) |
| Test | `{name}.test.ts` |

**MUST** — no junk files: no `.bak`, `.old`, `Copy`, or `V2`/`New`/`Final` suffixes in a filename.
API versioning is a `v2/` folder (§1.4), never a suffix.

## 3. Routes & controllers

**Routes are auto-discovered.** `src/utils/loadRoutes.ts` scans
`src/main/{feature}/routes/{version}/*.ts` at startup and mounts each default-exported router at
`/api/{version}/{kebab-case-feature}` — or `/api/{version}/{feature}/{kebab-case-filename}` when the
file isn't named after the feature. Adding a file in the right place is enough; there is no central
router to edit.

- **MUST** — a route file is middleware wiring plus a controller call. Nothing else: no inline
  handlers with logic, no DB access, no transformation.
- **MUST** — a controller does HTTP only: read the validated request, call one service method,
  return through a response helper (§6). Business logic, DB queries, and multi-step orchestration
  belong in the service.
- **MUST** — every route that changes data is wrapped in `asyncHandler` so a thrown `HttpError`
  reaches `middlewear/errorHandler.ts` instead of hanging the request.
- **SHOULD** — export an `apiDocs` array from the route module; it is picked up automatically into
  the Swagger/OpenAPI `docsRegistry`. Swagger UI is at `/api/api-docs` (note the `/api` prefix).

## 4. Services

**MUST** — the service owns business logic and DB access. It must not touch `req`/`res`, read
headers, or set status codes; that coupling is what makes a service impossible to call from a cron
job or a queue worker.

**MUST — reuse before writing a helper.** Grep `src/utils/` and `src/main/*/utils/` first. This is
not hypothetical: a duplicate `hhmmToMinutes` was written in `clinic/services/v2/clinic.service.ts`
while an equivalent already existed at `appointments/utils/time.utils.ts` — the two would have
drifted. A helper used by more than one feature belongs in shared `src/utils/`, not imported across
feature modules.

**SHOULD — a service file stays under ~800 lines.** Ten currently exceed 2,800
(`appointment.service.ts` 6,303, `dashboard.service.ts` 4,954, `patient.service.ts` 4,943). These
are the split backlog (§14), handled when touched. When you do split one, extract by use case into
`services/{feature}/{useCase}.service.ts` rather than by technical layer.

**MUST** — a service method that writes must be safe to retry where the caller can retry it (cron,
queue, webhook). Guard against double-application rather than assuming exactly-once delivery.

## 5. Validation & types

**MUST** — every request body, query, and param is validated by a Zod schema in the feature's
`schemas/`, wired through `middlewear/validateZod.ts` / `validation.middleware.ts`. A controller
must never read an unvalidated `req.body` field.

**MUST** — derive the TypeScript type from the schema (`z.infer`) rather than hand-writing a
parallel interface that can drift from what is actually enforced.

**SHOULD** — avoid `any`. 333 occurrences remain and the rule is `warn`, so this is on the author:
prefer `unknown` plus a narrowing check at the boundary. The highest-value places to be strict are
request payloads, external API responses, and anything crossing a queue.

**MUST** — validate at the edge, then trust the type inward. Re-checking the same shape in three
layers is noise; not checking it at the entry point is a bug.

## 6. Responses & errors

**MUST — use the shared envelopes in `utils/response.utils.ts`.**

```ts
sendOk(res, message, data)        // 200 — message first, data second
sendCreated(res, message, data)   // 201
sendNoContent(res)                // 204
throw new HttpError(status, msg)  // caught by asyncHandler
```

**MUST — never hand-roll `res.status(...).json({ success, ... })` in a controller.** 213 call sites
still do; they predate the convention and are the fix-forward backlog (§14). Don't copy the pattern
into new code.

**MUST** — errors are thrown, not returned. `throw new HttpError(404, "Appointment not found")`
flows through `middlewear/errorHandler.ts`; a hand-built error response bypasses the logging and
shape guarantees there.

**MUST — never leak internals to the client.** No stack traces, driver errors, SQL, or raw
third-party payloads in a response body. Log the detail server-side and return a message the caller
can act on. A Postgres unique-violation surfaces as "That email is already registered", not as
`duplicate key value violates unique constraint`.

**MUST** — the status code carries meaning: 400 malformed · 401 unauthenticated · 403 authenticated
but not allowed · 404 absent or not visible to this tenant · 409 conflicts with current state ·
422 well-formed but semantically invalid. Not everything is a 400 or a 500.

## 7. Database & Drizzle

**MUST — migrations are generated and applied by a human, never by an agent.** Write the model
change; leave `npm run db:migrations:*` to the repo owner. Three isolated paths keyed off
`NODE_ENV`: `dev/` (gitignored, local), `staging/` and `prod/` (tracked, deployed by CI).

**MUST — a multi-step write is one transaction.** `database.transaction(async (tx) => …)` is used
in 197 places; follow it. Anything that writes two tables and would leave the record inconsistent
if the second failed belongs in one. Pass `tx` down — a helper that opens its own connection
mid-transaction defeats it.

**MUST** — a transaction wraps DB work only. No HTTP calls, no queue publishes, no email sends
inside one: it holds locks for the length of a third party's timeout, and the side effect cannot be
rolled back. Publish after commit.

**MUST** — a query that can return unbounded rows takes a limit. A list endpoint paginates; an
export streams or batches.

**SHOULD** — filter in SQL, not in Node. Pulling a table into memory to `.filter()` it is the most
common cause of a slow endpoint here.

**MUST** — `src/drizzle/_prod_real/` is a raw introspection dump, not source. It is excluded from
`tsconfig.json` and must not be imported by application code.

### Search endpoints (predictive / type-ahead)

An endpoint the UI calls as the user types. Reference: `MedicineService.getAllMedicines`
(`GET /medicine/medicines?q=`). The §9 tenant filter still applies to every search.

- **MUST — every row contains the typed text** (in the name or a named secondary field such as
  generic name). No trigram/phonetic typo match in a list the UI can act on with Enter: a
  `word_similarity` match put AZITHRAL 500 MG first for `AZITHRAL 250`, and DOLO DB for `DOLO 500`.
  Fuzzy results go in a separate click-only list: `getAllMedicines` returns them as `suggestions`
  (`word_similarity >= 0.35`, 4+ chars, only when no row matched), never inside `medicines`.
- **MUST — rank in SQL, best match first:** exact → starts with → a word starts with → contains →
  secondary field (e.g. generic name); ties go shortest name, then A–Z. Never
  `ORDER BY created_at` when `q` is set — the client shows the top rows, so an unranked cut drops
  the best match. The medicine search returned 500 newest-first rows.
- **MUST — small default page when `q` is set (25), hard cap on `pageSize` (500).**
  `pageSize=999999` returned the whole medicines table.
- **MUST — escape `\`, `%`, `_` before building a `LIKE`/`ILIKE` pattern:**
  `q.replace(/[\\%_]/g, '\\$&')`. Values are parameterised, so it isn't injection — but `q=_`
  matched every row.
- **MUST — a column searched with `ILIKE '%q%'` gets a `gin_trgm_ops` index in the model.** A
  b-tree can't serve a leading wildcard, so every keystroke scans the table. Needs `pg_trgm`; a dev
  DB can lack it (`WORKFLOW.md` §6).
- **SHOULD — one search endpoint per data set.** `/medicine/medicines` and
  `/medicine/medicines/search` searched one table with different matching, paging and caching, and
  nobody could say which one the app used.

## 8. Caching

**MUST — never build a cache key by string concatenation.** Add a named function to `CacheKeys` in
`src/utils/cache.util.ts` and reference it everywhere. A typo'd key does not error — it silently
misses invalidation, which surfaces later as stale clinical data.

**MUST — a write invalidates what it changed.** Any service method writing data that feeds
`clinic:profile-overview:{clinicId}` (clinic core fields, settings, `clinics_service` rows,
`clinic_availability` rows) invalidates that key on success. Prefer the `withCacheInvalidation`
helper over a bare `invalidateCache` call so the pattern stays greppable.

**MUST** — before adding a mutation that touches cached data, grep for the key's `CacheKeys` call
sites and follow the existing pattern rather than inventing one.

**MUST** — invalidate **after** the transaction commits, not inside it. Invalidating first lets a
concurrent read repopulate the cache from pre-commit state.

**SHOULD** — cache what is expensive and tolerant of being briefly stale. Never cache
authorization decisions or anything whose staleness is a safety problem.

### 8.1 Cache invalidation — strict rules

These exist because an invalidation that was missed or put in the wrong place fails without any
error: the screen or push just shows old data (for example a renamed doctor still showing the old
name) until the TTL expires. Every rule below is a **MUST**.

1. **Adding a cache means finding every writer first.** Before adding a cache, grep every write to
   each column the cached value reads (`.update(Model)`, `.insert(...).onConflictDoUpdate`, raw
   SQL). Include dynamic writes: `.set(userSetObj)`, `.set({ ...payload })` and field-allowlist
   loops can change the column without naming it. Add invalidation to every one of those writers,
   and list the writer sites in the PR description. A cache added without that list is incomplete.
2. **One invalidation group per entity.** A new per-entity key (doctor, clinic, user) joins that
   entity's existing group in `CacheKeys` (e.g. `doctorPublicProfileAll(doctorId)`) instead of
   being cleared on its own. Writers invalidate the **group**, never single members, so a key
   added later is cleared everywhere automatically.
3. **Invalidate after commit, in the function that owns the transaction.** A helper that receives
   `tx` (such as `updateDoctorProfile(tx, …)`) never invalidates. Its caller does, after
   `database.transaction(...)` resolves. Clearing inside the transaction lets a concurrent read
   re-cache the pre-commit value.
4. **Cache failures never fail or roll back the write.** Use `invalidateCache` /
   `invalidateCacheMany` (they log and swallow errors) or wrap raw `redisClient` deletes in a
   `.catch` that logs. A Redis outage must not turn a committed save into a 500, or a transaction
   into a rollback.
5. **Every cached value has a TTL.** The TTL is the safety net for writers nobody wired up
   (direct DB edits, scripts, a writer added later). Use `getOrSetCache` with an explicit TTL.
   Keys without an expiry are not allowed.
6. **A new writer to a cached column checks the cache.** When you add a write to a column, grep
   `CacheKeys` for keys whose loader reads that table and invalidate the matching group. This is
   the same requirement as rule 1, seen from the writer's side.

## 9. Auth & tenancy

**MUST** — auth is `middlewear/auth.middleware.ts`, which attaches `req.user`, `req.clinicId`,
`req.labId`. Roles in `AuthUser`: Admin, User, Super_Admin, Doctor, Receptionist, Pharmacist. MFA
has its own `mfaAuth.middleware.ts`; plan gating is `subscriptionAccess.middleware.ts` +
`limitation.middleware.ts`.

**MUST — every tenant-scoped query filters by `req.clinicId` (or `req.labId`).** This is the single
most consequential rule in this file: a missing clinic filter leaks one clinic's patient data to
another. Take the scope from the authenticated token — **never** from a body or query param a
caller can set. 243 call sites do this correctly; match them.

**MUST** — a record that exists but belongs to another tenant is a **404**, not a 403. A 403
confirms the ID exists, which is itself a leak.

**MUST** — authorize in the route/middleware layer, explicitly per route. Never infer permission
from the shape of the request or trust a client-supplied role.

**MUST** — a `PERMISSION_KEYS` entry ships with the `requirePermission` that enforces it. A catalog
key alone is a checkbox that does nothing: `lab_test:create` was grantable while its route never
checked it, so every receptionist could book lab tests. `grep -rn "PERMISSION_KEYS.<KEY>" src/main`
must hit a route.

**MUST** — patient data is the most sensitive thing this system holds. Don't log it, don't put it
in an error message, don't return more of it than the endpoint needs. (Field-level encryption is
planned but **not yet implemented** — see `docs/PATIENT_DATA_ENCRYPTION_PLAN.md`. Until it lands,
access control is the only protection, which is what makes the tenancy rule above load-bearing.)

## 10. Realtime & background work

**MUST** — emit through `src/socket/socketManager.ts`. Every emit fans out across nodes via the
**Redis adapter**.

> Kafka was removed 2026-08-30: seven of its eight publish sites duplicated an emit the adapter
> already delivered, and the eighth (chat) had no direct emit at all — so chat silently failed
> whenever the broker was down. Don't reintroduce a second message path without a reason the
> adapter genuinely can't serve.

**MUST — Redis is not optional.** It backs the Socket.io adapter, BullMQ queues, and notification
delivery. An outage takes the process down rather than degrading. A `.env` pointing at a Redis that
isn't running is the most common local failure — check `ss -ltn | grep 6380` before debugging
anything else.

**MUST** — everything outside `src/main/notifications` sends notifications through `notify()` and
nothing else. The old helpers (`utils/notificationHelpers.ts`, `utils/notification.utils.ts`) are
shims being retired; a new caller reaching for them adds work to the migration. ESLint warns on
this (16 remaining) and the rule becomes an error when the cutover finishes.

**MUST** — a cron job (`src/cron/jobs/`, registered in `src/cron/index.ts`) or queue worker is
idempotent and logs its outcome. It runs unattended with no caller to see a thrown error.

**SHOULD** — work that is slow, external, or retryable belongs in a queue, not in the request path.

## 11. Logging & secrets

**MUST — no `console.log`.** ESLint enforces this as an error; `warn`/`error`/`debug`/`info` are
allowed. 44 `console.log` calls remain in files ESLint doesn't currently reach (§14).

**MUST** — never log secrets, tokens, passwords, OTPs, full card/payment payloads, or patient
identifiers. A webhook body is not safe to log wholesale.

**MUST** — secrets come from `src/utils/envConfig.ts` (`DEV_*` / `STAGING_*` / `PROD_*` by
`NODE_ENV`). Never hardcode a credential, and never commit a real value to `.env.example`.

**SHOULD** — log at the boundary where the failure is actionable: the caught error with enough
context to identify the request, once, rather than at every frame on the way up.

## 12. Tests

66 test files against 122 services — coverage is partial and concentrated. `appointment-engine`
alone holds 28 of them (queue state, token capacity, split shifts, no-show, delay tracking); the
other 38 are spread thin across 10 modules. **It is the module to read before writing a test here**
— it shows how to test scheduling logic without standing up a server (§1).

**MUST — `__tests__/`, never `tests/`.** A new test goes in the module's own `__tests__/` folder.
It is the Jest convention, and it is what `appointment-engine`, `medicine`, `reports`,
`quick-print-templates`, `middlewear` and `utils` already use. A module must never carry both —
`reports/` did, and the stray `tests/` copy was the one nobody looked in.

`tests/` still holds most existing files (§14 backlog). Don't bulk-move them, but when you touch a
test in a `tests/` folder, `git mv` it into `__tests__/` — the relative import depth is identical,
and Jest matches on `*.test.ts`, not on the folder.

**MUST — never run the whole Jest suite on the dev machine; it hangs it.** Run a single file
(`npx jest path/to/file.test.ts`) or a single name (`npx jest -t "test name"`), and hand the full
suite to CI.

**SHOULD** — new business logic in a service gets a test, especially: money (payments, refunds,
subscriptions), scheduling and slot allocation, and anything enforcing a clinical rule. These are
where a silent regression is most expensive.

**SHOULD** — test the service, not the controller. The service is where the logic is and it needs
no HTTP fixture.

**MUST** — a test that needs a real Redis, a real DB, or a live third party is an integration test
and must be marked as such, not left to fail confusingly in a unit run.

## 13. Build & workflow

Measured 2026-08-23: 629 files, cold `tsc` **1 m 45 s**, warm rebuild **4 s** — 26x. `tsc` is
single-threaded and uses one of eight cores no matter how long it runs.

```bash
npm run dev              # nodemon + tsx. Does NOT typecheck.
npm run typecheck:watch  # start once per session, read its output
npm run typecheck        # the one-off gate before committing
npm run build            # tsc -p tsconfig.json
```

- **MUST — use watch mode, started once per session.** Types are an editor concern while writing
  and a gate before committing, **not** a step between edits. Launching fresh `tsc` runs per edit
  is what makes development feel slow — not the compiler.
- **MUST — don't start this watcher while the frontend's is doing its cold pass.** The same 4 s
  rebuild took **76 s** under that contention. Let one reach "Found 0 errors" before starting the
  other.
- `npm run dev` does not typecheck — `tsx`/nodemon transpile and ignore types.
- `tsconfig.json` sets `incremental` + `tsBuildInfoFile` (under `node_modules`, gitignored). Before
  that every run re-checked everything; emit output is unchanged.

**Local infra:** `npm run dev` runs the server on the host, so `.env` must name the **published**
dev port — `REDIS_PORT=6380`, not 6379. The `REDIS_HOST=redis` in `docker-compose.dev.yml` is
service-name DNS for the containerized `app` service only.

**Deploy:** dev is local-only · staging deploys on push to `staging` · prod deploys only on a
`vX.Y.Z` tag reachable from `main`. Healthchecks use `wget --spider`, **not** `curl` — the runtime
image never installs `curl`, so a curl-based healthcheck silently never passes.

## 14. Enforcement

Better enforced than the frontend: `no-console` and `no-unused-vars` are already **errors**.
Current state — **2 errors, 349 warnings**:

| Count | Rule | Severity |
|---:|---|---|
| 333 | `@typescript-eslint/no-explicit-any` | warn |
| 16 | `no-restricted-imports` (notification shims) | warn — becomes error at cutover |
| 1 | `no-console` | **error** |
| 1 | Parsing error, `_prod_real/schema.ts` | **error** |

**`npm run lint` fails today.** Two fixes, both small:

1. **`src/drizzle/_prod_real/schema.ts:61` has an unterminated string** — `.default(')` from a bad
   introspection dump. The file is excluded from `tsconfig.json` but **not** from ESLint, so the
   build passes while lint fails. Add it to the ESLint ignores; it's a generated artifact, not
   source.
2. **`src/scripts/generateNotificationDocs.ts:111`** — one `console.log` in a script. Switch to
   `console.info` or add a scoped override for `src/scripts/`.

Then, in order:

3. **Fix-forward the 213 hand-rolled responses** — concentrated in ~12 files (`pharmacies` 6,
   `medicine` 5, `middlewear` 4). Convert as you touch them, not in one sweep.
4. **Leave `no-explicit-any` at `warn`** — 333 occurrences, and mechanically typing them invites
   wrong types worse than an honest `any`. Tighten at the boundaries first (request payloads,
   external responses).
5. **Promote `no-restricted-imports` to `error`** when the notification cutover finishes and the
   count is zero — as the config comment already says.

### The existing backlog

Rules bind **new** code; they do not authorise a cleanup sweep.

| Backlog | Count | Policy |
|---|---:|---|
| Hand-rolled responses | 213 | Fix forward when touched |
| `any` | 333 | Boundaries first, don't sweep |
| `console.log` | 44 | Remove when touched |
| Services > 2,800 lines | 10 | Split only when already editing |
| Notification shim callers | 16 | Migrating; no new ones |
| Tests in `tests/` not `__tests__/` | 26 files, 12 modules | `git mv` when you touch one (§12) |
| Lint errors | 2 | Fix now |

**The rule: fix what you touch, don't go hunting.** A cleanup PR spanning hundreds of files is
unreviewable, so real bugs hide in it — and in a clinical system an unnecessary diff carries risk
that a stale line of code does not. Cleanups land as their **own commit**, separate from feature
work.

## 15. Review checklist

Run before calling any BE change done.

**Structure** — route thin (wiring + controller call) · controller does HTTP only · logic in the
service · types in `types/`, helpers in `utils/` · tests in `__tests__/` · camelCase filenames ·
reused an existing helper rather than writing a second one.

**Contract** — Zod schema validates every input · responses go through `sendOk`/`sendCreated`/
`sendNoContent` · errors `throw new HttpError` · status codes carry meaning · no internals leaked
to the client.

**Data** — every tenant-scoped query filters by `req.clinicId`/`req.labId` from the **token** ·
cross-tenant miss returns 404, not 403 · multi-step writes in one transaction · no HTTP or queue
work inside a transaction · unbounded queries have a limit · model change written but **migration
left to the repo owner** · a type-ahead search returns only rows containing the text, ranks in SQL,
escapes `%`/`_`, caps its page and has a trigram index (§7 "Search endpoints").

**Cache** — key comes from `CacheKeys`, never concatenated · every write invalidates what it
changed · invalidation happens after commit, in the transaction owner, never in a `tx` helper ·
per-entity keys join the entity's `…All()` group · a new cache lists every writer site (including
dynamic `.set(obj)`/spread writes) in the PR · invalidation errors are caught, never fail the
request · every key has a TTL (§8.1).

**Infra** — notifications go through `notify()` · emits go through `socketManager` · cron/queue work
is idempotent and logs its outcome.

**Safety** — no `console.log` · no secrets, tokens, or patient data in logs or errors · nothing
returned beyond what the endpoint needs.

**Gates** — `npx eslint <changed files>` clean · IDE type diagnostics clean on the files you touched ·
single relevant test file run (**never the full suite locally**) · endpoint exercised against a
running server, not just compiled.

**BANNED as a per-task check: `npm run typecheck`, `npm run build`, `npx jest` (full suite).** The IDE
already type-checks what you edited; the full suite hangs the machine. Cross-cutting change? Grep the
importers, or leave `npm run typecheck:watch` running (4s rebuilds, §13) — not a fresh typecheck.
Ask before running one. See `../../../WORKFLOW.md` §5.
