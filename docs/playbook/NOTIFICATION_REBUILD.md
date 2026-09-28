# Notification Center — Rebuild Plan & Task Checklist

**Branch:** `feat/notification-permissions` (BE + FE, same name)
**Started:** 2026-08-23
**Status (2026-08-30):** Phases 0, 1, 2, **3 (tested)**, 7 and most of 8 are complete. Phases 4,
5 and 6 are deferred by the author. Phase 9 has its two non-destructive items done; the five
destructive ones stay gated. Outstanding and not ours: the client's walkthrough, and their
decision on lifting Standing Rule 11 for email.
**Update 2026-09-23:** this line is out of date. Since `323eb90e` (2026-08-31), both
`NOTIFICATIONS_INAPP_ENABLED` and `NOTIFICATIONS_REGISTRY_ENABLED` are hard-coded **on** in
`envConfig.ts`. They are no longer flags. The retention cron is gated on the first of them.
BE and FE typecheck clean on top of the 2026-08-30 `staging` merge.

**Open before Phase 2 can close and be signed off (Standing Rule 2):**

1. ~~A registry-backed events endpoint~~ — **done 2026-08-30**, A8 closed
2. ~~Swagger entries for the new routes~~ — **done 2026-08-30**, all 12 routes documented
3. The end-to-end appointment walkthrough, which is the client's to run (Standing Rule 5)

**Phase 2 is code-complete and verified against a running app** (2026-08-30): `/events` returns
the predicted 17 rows for Super_Admin, matches the frontend's declared contract exactly, and agrees
with the preferences endpoint key-for-key and value-for-value. What remains is the client's
appointment walkthrough and sign-off. One deliberate gap, recorded at the end of §2c: the settings
screen still has no per-event toggle UI, which is a design decision rather than missing wiring.

Two things need a real environment and are the client's to run, not blockers on the code:
the row-count measurement, and that walkthrough (see "Phase 1 — End-to-end verification"
below).

The branch is pushed on both repos up to the 2026-08-30 `staging` merge; the event-catalogue
commits (`5b35a901` BE, `4720f679` FE) are **committed but unpushed**. Standing Rule 4 still
governs anything new.

Verification steps and the API reference live beside this file in
`docs/playbook/NOTIFICATION_TEST_PLAN.md`.

This is a **living checklist**. Work spans multiple sessions — tick items as they land,
leave everything else unticked. An unticked box means "not done", never "unknown".

| Marker | Meaning |
|---|---|
| `- [ ]` | Not started |
| `- [x]` | Done and verified |
| `- [~]` | In progress |
| `- [!]` | Blocked — see Open Decisions |

---

## 1. Open Decisions

### D1 — How is the "relevant receptionist" defined? ✅ RESOLVED 2026-08-23

**The data model already answers this — no schema change needed.** `main/permissions/`
contains a staff responsibility model built for exactly this question:

- `StaffScopeModel` — per (user, clinic): `accessScope` (`assigned_doctors` | `all_doctors`),
  plus `location` and `responsibility`
- `StaffDoctorAssignmentModel` — the staff ↔ doctor relation, with
  `idx_staff_doctor_by_doctor` on `(clinicId, doctorUserId)`. Its own comment: a relation
  rather than an array column *"so the reverse question — who is responsible for
  Doctor 1? — stays an indexed lookup."*
- `StaffScopeService.getAccessibleDoctorIds()` — already used by queue and lab routes

"Notify the receptionist responsible for this doctor" is therefore a single indexed
query today. No `createdByUserId`, no new table.

Only the fallback remains open:

- [x] **D1a — DECIDED 2026-08-24: mirror `StaffScopeService`.** A receptionist with no scope
      row (`isDefault: true`) is treated as covering **all doctors** and is notified
      accordingly, matching the access they already have on screen. Rationale: the scope
      service defaults that way precisely so that enabling staff scoping never blanks a live
      dashboard mid-shift, and notifications disagreeing with the dashboard would be worse
      than either behaviour on its own. Revisit once clinics have actually configured staff.

> Doctor-side was never in question: `doctorId` exists on the appointment.

### D2 — Event key naming

Namespaced keys (`appointment.created`) fix collisions between bare verbs already in
use (`view`, `delete`, `created`, `updated`). But saved user preferences are JSONB
keyed by the **old** names — renaming without an alias map silently un-mutes everyone.

- [x] **D2 DECIDED 2026-08-24 — namespaced keys + `aliases: []` on each entry.** Decided by
      implementation and confirmed here: every registry entry carries its legacy name as an
      alias, `resolveEventKey()` resolves either form, and `dispatch.service.ts` looks
      preferences up under `aliases[0]` rather than the canonical key. The generated role
      defaults are emitted in legacy key style for the same reason — stored preferences are
      JSONB keyed by the old names, and a lookup miss resolves to "enabled", which would have
      silently un-muted everyone who had turned something off. `npm run notifications:parity`
      is what keeps this honest: 0 mismatches

---

## 2. Requirement Coverage (client checklist, section by section)

| § | Requirement | Covered by | Status |
|---|---|---|---|
| 1 | Core objective — real-time, role-based, action-oriented | Registry + RealtimeBus + Activity split | ✅ planned |
| 2 | Role-based recipients | Registry `recipients()` + `StaffScopeService` + `PERMISSION_KEYS` | ✅ planned |
| 3 | Relevance test before creating an event | Registry entry cannot compile without recipients + reason + click action | ✅ planned |
| 4 | Appointment & queue events | Phase 3 | ✅ planned (2 new events) |
| 5 | Prescription → receptionist → next patient | Phase 4 | ✅ planned (status `Completed` exists) |
| 6 | Payment events, prevent duplicate collection | Phase 5 | ✅ planned (`PAYMENT_MANAGE` + staff scope) |
| 7 | Categories + highlighting | `category`/`priority` columns + FE rebuild | ✅ planned |
| 8 | Real-time, no refresh | RealtimeBus (already built) | ✅ exists |
| 9 | Click actions | Registry `clickAction()`, resolved server-side | ✅ planned |
| 10 | Notification vs Activity separation | `kind` column, same table, Activity tab | ✅ planned |
| 11 | Per-event documentation | Registry **is** the table; docs generated from it | ✅ planned |
| 12 | Synchronization across all state | RealtimeBus + new payment/prescription targets | ✅ planned |
| 13 | Spam prevention | Recipient trimming + permission filter | ✅ planned |
| 14 | Review existing notifications | §4 inventory below | ✅ done |
| 15 | Acceptance criteria | All 16 criteria reachable | ✅ planned |

---

## 3. Architecture Decisions (recorded)

| # | Decision | Rationale |
|---|---|---|
| A1 | **Two brains, kept separate.** `main/realtime/` = state sync (§8, §12). `main/notifications/` = relevance + delivery (§2, §3, §7, §9, §10, §13) | Conflating them is why admins are spammed today with things that should be a silent refresh |
| A2 | **Redis + BullMQ for the queue. Not Kafka.** | Needs per-job retry/backoff/DLQ/delay/dedupe — a work queue, not an event log. A poison message stalls a Kafka partition. Redis is already mandatory (socket adapter), so no new failure domain |
| A3 | **Remove Kafka entirely** (4 topics, all socket relays the Redis adapter already handles) | Kafka is optional at boot today = it carries no unique load. Saves 2 containers × 3 envs |
| A4 | **Generalize the WhatsApp outbox**, don't invent a queue | `whatsappOutbox.queue.ts` is already production-grade (5 attempts, exp backoff, permanent-error classification, bounded history) |
| A5 | **Boundary rule.** No file outside `main/notifications/` imports a notification model/provider/queue/template. No file inside imports a Drizzle model from another feature — everything crosses via a port | Makes later microservice extraction mechanical rather than a rewrite |
| A6 | **Strangler migration.** Old helpers become shims; delete per module | "Without breaking functionality" becomes verifiable, not hopeful |
| A7 | **Reuse existing DB models.** `notifications` table (+3 columns) and `settings.notificationPreferences` JSONB. No new tables | Per client instruction |
| A8 | **Reuse the My Notifications module** — endpoints, `settingApi.ts`, the settings screen | Once `ROLE_DEFAULTS` is generated from the registry, the screen picks up new events with zero FE change |
| A10 | **Notifications are tenant-scoped: `tenant_type` + `tenant_id` (both nullable, no FK).** Everything written today is `tenant_type='clinic'`. Chosen over a bare `clinic_id` because lab and pharmacy are planned to separate into independent tenants: the pair costs one extra column now, versus renaming a column and backfilling a large table mid-separation later. The usual objection to a polymorphic tenant — no enforceable FK — does not apply, because A5/§7c already forbids FKs for extractability. `UserLabAssignmentsModel` already carries `labId`, so lab notifications just start writing `tenant_type='lab'` with no migration. **Do not build a `tenants` table now** — real tenancy belongs to subscriptions/billing/permissions; notifications follow that decision rather than leading it. | Users are multi-clinic (`ClinicAssignModel`; the socket joins several `clinic:` rooms). Without it a doctor working at two clinics gets one blended inbox with no filter, and per-clinic retention, analytics and superadmin lookups are impossible. Nullable now costs nothing; backfilling 20M rows later is painful. Null = not clinic-scoped (e.g. `clinic_created` for Super_Admins, account-level welcome/password events). Clinic is today's tenant: subscriptions, `clinic_usage` and `coupon_usage` are all keyed by it (the tenant is what you bill), `ClinicModel` has no parent/org column, and labs currently sit *inside* a clinic. If an org layer is ever added above clinic, notifications stay at the clinic grain — it is the finer one, and org views aggregate over it. **`tenant_id` is NOT the security boundary**: access control stays `user_id` (you only ever read your own rows). It exists for filtering, retention and analytics only — never let "filter by tenant" become a substitute for user scoping |
| A11 | **No digest / batching. `kind='activity'` is the digest.** | Clinical work is same-day: a summary of what happened this morning has near-zero operational value, and batching adds windowing + "already sent" state. Activity is a browsable feed with no delivery cost. Revisit only if users complain about volume *after* correct recipients ship — the volume problem is fan-out, not the absence of batching |
| A12 | **Partitioning is not built. Documented trigger instead:** `notifications` past ~20M rows, or the retention job exceeding ~2 minutes → partition monthly on `created_at` | At 1,000 clinics with correct recipients + collapse: ~600k rows/day, held near 50M by 90-day retention. Postgres handles that with these indexes, given keyset pagination and a bounded unread count |
| A9 | **Recipient entitlement = staff scope × permission, not role.** Resolution order: role → `StaffScopeService.getAccessibleDoctorIds()` → required `PERMISSION_KEYS` | §13's *"do not notify users who cannot take action"* is literally implementable as *"recipient must hold the permission the click action's route requires"*. Reuses `permissions` / `user_permissions` / `staff_doctor_assignments` — **no new permission model** |

---

## 4. Current-State Inventory — 18 events

Verdicts apply §2 / §10 / §13.

| # | Event | Recipients today | Verdict |
|---|---|---|---|
| 1 | `appointment_created` | **all** Admins + **all** Receptionists + doctor + patient | Trim → doctor + responsible receptionist + patient. Admin → Activity |
| 2 | `appointment_rescheduled` | doctor + patient | Extend — assigned receptionist missing (§4) |
| 3 | `appointment_confirmed` | doctor + patient | Keep, narrow |
| 4 | `appointment_canceled` | **all** Receptionists + doctor + patient | Trim to assigned receptionist |
| 5 | `appointment_no_show` | **all** Admins + **all** Receptionists + doctor (+ patient SMS) | Trim. Admin → Activity |
| 6 | `payment_received` | **patient only** | **Gap** — §6 needs staff. Duplicate-collection risk |
| 7 | `test_log_created` | only when performer is Admin → all doctors + all lab | Dead branch for other roles; narrow |
| 8 | `test_assigned_to_lab` | all lab users in clinic | Keep — lab queue is genuinely shared |
| 9 | `test_report_uploaded` | role-dependent fan-out + patient | Keep, narrow to ordering doctor |
| 10 | `pdf_generation_started` | patient | **Delete** — no action, pure noise |
| 11 | `pdf_ready` | patient | Keep; click → prescription |
| 12 | `user_created` (welcome) | the new user | Keep or drop — no action target |
| 13 | `clinic_created` | all Super_Admins + email | Keep (superadmin) |
| 14 | Staff-action alerts ×8 call sites (discount, refund, offline payment, password change, staff status) | clinic Admins | **→ Activity.** All 8 mislabeled `action: 'user_created'` |
| 15 | `running_late` | patient (push + socket) | Keep |
| 16 | `appointment_shifted` | patient (push + socket) | Keep |
| 17 | queue proximity (`patientsAhead`) | patient (push) | Keep |
| 18 | subscription renewal ×2 | clinic Admin | Keep → System category |
| — | `upload_manual_prescription` | doctor (push, not stored) | Transient by design, not an inbox item |

### Required by the brief, does not exist at all

- [!] **Patient sent to doctor** → doctor ("Patient C is in your cabin"). Built and then removed on 2026-08-30 at the author's request; the bus signal still fires, no notification exists. Requirement reopened
- [ ] **Consultation completed** → receptionist
- [ ] **Prescription completed** → receptionist (only the *patient* gets `pdf_ready` today)
- [ ] **Payment received** → staff (only the patient is notified today)

---

## 5. Channel Inventory

| Channel | Today | Action |
|---|---|---|
| WhatsApp | BullMQ outbox, retries, error classification | ✅ reference implementation |
| Email — login alerts | BullMQ | ✅ keep |
| Email — other 17 call sites | inline nodemailer + in-process `setTimeout` retry loop | ❌ **lost on restart** → migrate |
| SMS | direct SNS, error swallowed | migrate |
| Push | SNS fire-and-forget | migrate |
| In-app | DB + socket + dead Kafka hop | migrate |

---

## PHASE 0 — Inventory & additive prep
*No shared infrastructure touched. Nothing deleted that is still referenced.*

### Step 0 — Turn the current in-app notifications OFF first

Ships before anything else. Stops the spam immediately, and means every later phase is
switching a dark feature on rather than changing a live one.

**This must be a scoped switch, not a global one.** Several functional flows ride the
same code path and would break:

| Keeps working — do NOT disable | Why |
|---|---|
| Patient SMS / WhatsApp (booked, rescheduled, no-show) | Clinically important patient comms; goes out via `smsClient` / the WhatsApp outbox |
| `upload_manual_prescription` push | **Functional, not informational** — carries the OTP + upload URL. Disabling it breaks the doctor's manual-prescription flow |
| Subscription renewal reminders (email + in-app) | Billing. A missed renewal deactivates staff accounts |
| Login alert emails | Security |
| `running_late`, `appointment_shifted`, queue proximity push | Patient-facing, already narrowly targeted, genuinely useful |
| `RealtimeBus` signals | Not notifications — screens must keep updating |

- [x] `NOTIFICATIONS_INAPP_ENABLED` env flag — `utils/envConfig.ts`. Unset = off, so no
      deploy config changes anywhere for it to take effect. Documented in `.env.example`
- [x] Enforced at the **two dispatch entry points only** — `sendNotificationToUser`
      (`utils/notification.utils.ts`) and `UniversalNotificationService.send` — suppressing
      **DB row + socket emit + SNS push**. *Refined during implementation:* the plan
      originally said DB row + socket only, but leaving push on would still spam every
      phone with exactly the notifications being switched off. Push is the interruptive
      half of "in-app", so it goes with it
- [x] Allowlist of event keys that bypass the switch —
      `main/notifications/killswitch/killSwitch.ts`. Matches on `metadata.action`,
      `metadata.source` **and** `event`, because the two legacy paths label events
      differently and subscription renewal sets no `action` at all
- [x] SMS / WhatsApp / email providers left entirely outside the switch
- [x] FE: bell hidden behind `VITE_NOTIFICATIONS_ENABLED` (`src/config/featureFlags.ts`,
      consumed in `components/shared/Header.tsx`). Vite inlines the constant, so the panel
      is dropped from the bundle rather than branched at runtime
- [ ] Pair with the **zero the bell** step in §6 so existing unread junk is cleared at the
      same moment *(deferred — needs the row-count measurement first)*
- [x] Rollback = flip one env var. No deploy, no migration

**Not switched off — verified against the allowlist:** `upload_manual_prescription`
(carries the OTP + upload URL), `subscription-renewal` (billing), `running_late`,
`appointment_shifted`, `queue_my_turn`, `queue_patients_ahead`, `queue_doctor_active`.
The patient notification page keeps working, since those still write rows.

> Note for Phase 1: the queue-proximity events **do** currently write DB rows (the legacy
> path persists before it looks at `channels`), even though they are declared push-only.
> That is the "transient events never persisted" task, not a Step 0 concern.

> As each module ships (Phases 3–8) its events move onto the new path and come back on
> under their own per-module flag. This switch is retired when Phase 8 completes.

### Step 1 onward

- [ ] Freeze the §4 inventory as the spec (done above — confirm with client)
- [ ] Measure existing data:
      `SELECT metadata->>'action', read, count(*) FROM notifications GROUP BY 1,2;`
- [x] Migration on `notifications` — one additive migration, no column altered or dropped.
      Generated as `src/drizzle/migrations/dev/0008_unusual_justin_hammer.sql`; diff contains
      only these changes. **Generated, not applied** — needs a DB:
      - `tenant_type` enum (clinic | lab | pharmacy) + `tenant_id` uuid, both **nullable**,
        CHECK both-null-or-both-set, no FK → tenant scope (see A10).
        **Never make these NOT NULL.** `NULL/NULL` is a valid, meaningful state:
        platform-level notifications that belong to no tenant — Super_Admin events
        (`clinic_created`), and account-level events (welcome, password changed) that
        follow the *user*, not a clinic. A Super_Admin has no tenant by definition
      - `category` enum (appointments | payments | prescription | lab | staff | system), default `system`
      - `priority` enum (action_required | normal | low), default `normal`
      - `kind` enum (notification | activity), default `notification`
      - `event_key` varchar(120) — registry key, replaces `metadata->>'action'` (a JSONB
        extraction can't be btree-indexed or constrained)
      - `click_route` varchar(255), `click_params` jsonb
      - `collapse_key` varchar(200)
- [x] Index `(user_id, kind, created_at desc)` — every list query filters on `kind`
- [x] Partial unique index `(user_id, collapse_key)` where `read = false AND collapse_key IS NOT NULL`
- [x] Index `(tenant_type, tenant_id, created_at desc)` — per-tenant retention, superadmin lookups
- [!] **Keyset pagination** — *moved to Phase 2.* It changes the list endpoint contract,
      and building it now with no consumer risks shipping the wrong shape; the FE that
      will actually use it is rebuilt in Phase 2. The index it needs
      (`user_id, created_at desc`) already exists, so nothing is lost by waiting
- [x] **Bounded unread count** — `LIMIT UNREAD_COUNT_CAP` (100) over the partial unread
      index; UI shows `99+` beyond. No Redis counter (four invalidation points = a wrong
      badge nobody can reproduce). Endpoint exposed in Phase 2

> Idempotency comes from the BullMQ job id, not a `dedupe_key` column — one mechanism, not two.
- [ ] Backfill existing rows: map `metadata->>'action'` → category/kind; unknown → `system`
- [x] Scaffold `main/notifications/registry/` — `types.ts` (the event contract), `defineEvents.ts`, `index.ts` (merge point + alias resolution). Empty of entries by design: Phase 0 lands the contract, not the content
- [x] Scaffold `main/notifications/ports/` — `DirectoryPort` (users, staff-by-doctor, permission filter, clinic channel settings, appointment context), `EmitPort`, and boot-time registration that throws if a port is read before it is wired
- [x] `getUnreadCount` **rewritten rather than deleted** — it is the bounded badge count Phase 2 needs, so deleting it only to re-add it made no sense. Now `LIMIT UNREAD_COUNT_CAP` (100) over the partial unread index
- [x] `markReadHandler` / `deleteNotificationHandler` now `throw new HttpError(404, …)` (repo convention)
- [x] `markAllNotificationsRead` and `deleteAllNotificationsForUser` now `.returning({ id })` instead of full rows — a user with a large backlog no longer pulls it all over the wire

## PHASE 1 — Unified infra
*New path built beside the old one. Both run. Nothing removed.*

- [x] `notificationQueue` — `main/notifications/queues/notification.queue.ts`, modelled on the
      WhatsApp outbox (5 attempts, exponential backoff, bounded history). Constructed lazily on
      first use, not at import, so merely importing the module does not start consuming jobs.
      `notify(eventKey, ctx, { jobId })` is the single entry point and never throws into the
      caller. **Idempotency comes from the BullMQ job id** — a duplicate id is dropped while the
      original is still known, which is why the table needs no dedupe column
- [x] `dispatch.service.ts` — resolves recipients at *delivery* time (role -> staff scope ->
      permission), batch-inserts one statement for the whole fan-out, upserts on the collapse
      key so one appointment's five state changes stay one inbox row, then emits via `EmitPort`.
      Activity rows are written regardless of preference: a muted toggle must not erase history
- [x] Redis logical DB for queues is now configurable — `REDIS_QUEUE_DB`, **defaulting to 0**
      rather than hard-switching to 1. Changing it strands jobs already queued in the old
      database, so it is a deliberate drain-and-switch, not a config edit that ships silently
- [x] Redis AOF persistence — **already enabled**. All three compose files already run
      `redis-server --appendonly yes`; this task was written from an assumption and turned out
      to be a non-issue on inspection. No change made
- [x] Registry entries for all existing events — **complete**: appointment (5),
      `prescription.ready`, `payment.received`, lab (3), staff (6 activity entries +
      `account.welcome` + `clinic.created`), `subscription.expiring`.
      `pdf_generation_started` is deliberately not registered (no action, removed rather
      than migrated)
- [x] **Super_Admin inheritance preserved.** `getRoleDefaults()` keeps the Admin→Super_Admin
      merge explicitly; the generator does not reproduce it, since it emits only what an
      audience names a role for. Verified after the swap: Super_Admin renders 17 in-app rows
      against Admin's 16 — i.e. Admin's set plus `clinic_created`, which is what it had before.
- [x] **Preference swap done.** `getRoleDefaults()` now layers the generated map over the
      hand-written one — static first so unmigrated events keep their entries, generated on
      top for the ones that moved. Nothing can be lost by construction.
      Generated in **legacy key style** (`appointment_created`, not `appointment.created`),
      because stored preferences are JSONB keyed by those names; canonical keys would leave
      every saved override unmatched, and a miss resolves to "enabled" — silently un-muting
      everyone who had turned something off. `dispatch.service.ts` looks preferences up under
      the same alias for the same reason.
      **Verified by diffing every role's rendered defaults before and after:** zero entries
      lost. Four entries changed, all the same dead-data case — `payment_received` and
      `appointment_no_show` are in `NON_CONFIGURABLE_NOTIFICATIONS`, which
      `resolveNotificationPreferences` forces to `{ enabled: true, configurable: false }`
      before role defaults are read, so those differences never reach a user.
      Everything else is an **addition**: `staff.*` (6), `subscription-renewal`,
      `user_created`, `test_log_created` now appear in the settings screens of the roles that
      actually receive them. Those are events users have been getting all along with no way
      to see or mute them.
- [x] ~~Generate `ROLE_DEFAULTS` from the registry~~ — `preferences/generateRoleDefaults.ts`,
      now wired in (above).
- [x] **Parity check has a runner** — `npm run notifications:parity`
      (`src/scripts/checkNotificationParity.ts`), exit 1 on any mismatch so CI can hold the
      line. `checkRoleDefaultsParity()` had existed since the registry was written with nothing
      calling it: the "0 mismatches" recorded below was one person running it by hand once, which
      is true until the next edit and cited as evidence forever after. Current run: **0
      mismatches**, verified by the command rather than by assertion. Output names the mismatch
      kind — `missing` (a role lost an event: the one that means an audience stopped being
      notified) versus `value` — and points at `INTENTIONAL_DROPS` for deliberate ones, because a
      check that always prints something red stops being read
- [x] **Retention cron gated on `NOTIFICATIONS_INAPP_ENABLED`** (decided 2026-08-24). It was
      registered unconditionally, so it deleted rows nightly in every environment while the rest
      of the rebuild shipped dark — the one piece that *deletes* rather than writes, and the one
      piece not behind a flag. The deciding argument was not symmetry but §6: the cleanup
      procedure archives the table, runs on staging first, compares counts and classifies rows
      before deleting anything, and this job was already removing read notifications over 90 days
      old — precisely the population §6 means to archive first. The automatic path was
      front-running the careful one. `initNotificationRetention()` now logs a skip line and
      returns when the flag is off; the table grows in the meantime, which is the cheaper
      mistake, and `countExpiredNotifications()` reports what the first real run would remove
- [x] `checkRoleDefaultsParity()` — proves the registry reproduces current behaviour before
      anything depends on it. **Currently 0 mismatches** across the 7 migrated events.
      Both sides are normalised through the same `NON_CONFIGURABLE_NOTIFICATIONS` override
      that `resolveNotificationPreferences` applies, because `ROLE_DEFAULTS` is inconsistent
      about those events and comparing raw values reported four differences that do not exist
      in behaviour: `appointment_no_show` is marked configurable for Receptionist and not for
      anyone else, and `payment_received` is marked disabled for Receptionist push and enabled
      everywhere else. Resolution forces all of them to `{ enabled: true, configurable: false }`
      before a role default is consulted, so those entries are dead data. Normalising is what
      makes the check trustworthy for the remaining 11 events — noise like that is exactly
      what hides a real mismatch
- [x] Missing roles — **resolved by the registry rather than by adding entries.** Roles are
      now derived from audiences, so a role receives exactly what some event names it for.
      `Pharmacist`, `Nurse` and `Radiologist` appear in no audience because no event targets
      them: there are no pharmacy notifications in the system at all, and Nurse/Radiologist
      are enum values nothing dispatches to. That is now *accurate* rather than a gap — the
      old failure was that `getUserNotificationPreference` fell through to "enabled" for
      anything unlisted, so those roles silently received everything while their settings
      screen showed nothing. If pharmacy notifications are built later, adding the audience
      is what puts Pharmacist on the settings screen.
- [x] Fix name drift — resolved by **aliasing rather than renaming**, so saved preferences keep
      matching. `prescription.ready` claims both `pdf_ready` and `prescription_pdf_ready`;
      `appointment.rescheduled` claims both `appointment_rescheduled` and the bare `rescheduled`;
      `appointment.created` claims `appointment_created`
- [x] Alias map so saved preferences survive the rename (D2) — see D2 in §1
- [~] **Port implementations landed** — `src/adapters/notifications/` (outside the module,
      per the boundary rule), registered from `app.ts` at boot. `directory.adapter.ts` resolves
      users, staff-by-doctor, lab users, super admins, permissions and clinic channel settings;
      `emit.adapter.ts` backs `EmitPort` with the live Socket.io server, injected rather than
      imported so it does not recreate the import cycle that makes the old broadcast helpers
      call `require()` inline at emit time.
      **D1a is implemented here**: `getStaffResponsibleForDoctor` includes staff with no scope
      row at all, mirroring `StaffScopeService`'s `all_doctors` default, in one query with two
      left joins. Notifications and the dashboard now agree about who covers which doctor —
      disagreeing would be worse than either rule applied consistently.
      `filterByPermission` calls `PermissionService` per candidate rather than reimplementing
      the rules in SQL, which is how a permission model grows a second, quietly divergent copy.
- [~] Collapse the two send paths — **superseded rather than done.** Both legacy paths now
      sit behind shims that route to the registry when the flag is on, so there is one live
      path and two dormant ones. Merging the dormant pair into each other would be work on
      code scheduled for deletion; they go together in Phase 9, once nothing reads them.
- [~] Channel resolution — in-app and push resolve through the registry and preferences.
      SMS/WhatsApp are **not** routed through it: SMS is out of scope entirely (see above)
      and WhatsApp still goes out from the legacy helpers, so the clinic-settings half
      (`getClinicChannelSettings`) is implemented on the port but not yet consulted
- [x] ~~Migrate channels onto the queue — push / email / in-app~~ — **moved to Phase 8
      (decided 2026-08-24).** It was double-booked: Phase 8 already carries "Email path onto the
      queue". Nothing in Phase 2 needs it — the FE reads rows, and in-app already resolves
      through the registry — so keeping it here only held the phase open. SMS was already out of
      scope.

### SMS — appointment SMS removed, verification SMS untouched (2026-08-24)

An SMS outbox was built and then **reverted at the client's instruction**, and appointment
SMS was removed outright. Recorded here so nobody reinstates either without the reasoning.

**What the investigation found:**

- Only **4 DLT template ids** exist, all mobile verification (patient and admin, each with
  a resend). Appointment SMS went through `sendSMS` with **no template id at all**.
- DLT registration is mandatory for Indian A2P SMS, so appointment texts were an
  *unregistered send path*, not a working channel — and `sendSMS(...).catch(log)` swallowed
  the failure, so nothing ever surfaced.
- It was also blocking: `appointment.service:1961` → `notifyAppointmentRescheduled` →
  `sendRescheduleToPatient` → `sendAppointmentNotification` → `await sendSMS`, on the HTTP
  request path.

**What changed:** `sendAppointmentNotification()` is WhatsApp-only — the `smsEnabled`
parameter is gone and its four call sites updated (reschedule, no-show, prescription
reminder, prescription notification). WhatsApp carries these through nine approved
templates and the outbox, which retries. Queueing the SMS instead would only have made an
unusable channel reliably unusable.

**Untouched:** the two DLT-registered verification flows, which work. `sendSMS()` itself
stays — it is what those flows use.

**Reminder queue removed too (client instruction, 2026-08-24).**
`appointmentSmsReminder.service.ts` is deleted, along with its six call sites in
`appointment.service.ts` (schedule on create, remove + reschedule on update) and
`paymentReservation.service.ts` (remove on expiry).

Checked before deleting: `whatsAppReminderQueue` is scheduled and cancelled at exactly the
same points — create, update, expiry — so patients keep their appointment reminders over
WhatsApp. Had that not been true, removing this would have left them with no reminder at
all, which is why it was verified rather than assumed.

**If appointment SMS is wanted later:** register the DLT templates first, then make the
send non-blocking. Not the other way round.

### Notification query audit (2026-08-24)

- **Removed 3 redundant `getUserById(doctorId)` lookups** in `notificationHelpers.ts`
  (reschedule, confirm, cancel). Each fetched a whole user row and then used `doctor.id` —
  the id the caller already held. The only thing bought was an existence check, and the
  insert would fail on its foreign key anyway. One query saved per event.
- **Remaining, by design:** `getClinicNameById` runs once per patient-facing event and is
  uncached; the per-recipient preference lookup is Redis-first with a DB fallback. Both are
  superseded by the registry path rather than worth optimising in code being replaced.
- The new `dispatch.service.ts` issues **one** insert for a whole audience and no per-user
  row fetches at all.

- [x] **Leave awaited auth/OTP emails synchronous** — confirmed unchanged. Nothing in this phase
      touched them, and Standing Rule 11 now puts email out of scope entirely, so this is settled
      rather than pending
- [~] Old `notifyXxx` helpers become shims delegating to `notify()` — **4 appointment helpers
      done** (created, rescheduled, confirmed, cancelled), behind
      `NOTIFICATIONS_REGISTRY_ENABLED` (default **off**). With the flag off every helper
      behaves exactly as before; with it on they enqueue and the registry decides recipients.
      One env var switches the whole cutover back.
      **The WhatsApp trap was live and is handled:** `notifyAppointmentRescheduled` does the
      in-app notification *and* the patient WhatsApp send in one function. The shim keeps the
      WhatsApp call explicitly — a shim that only delegated would have silently stopped
      reschedule messages reaching patients, and neither a typecheck nor a review of
      notification code would have shown it.
      **10 helpers shimmed**: 5 appointment, `payment.received`, `prescription.ready`, 3 lab,
      `account.welcome`, `clinic.created`.
      Three of them message a patient *and* fan out to staff, so their guards are placed
      deliberately rather than at the top of the function:
      `notifyAppointmentRescheduled` keeps the patient WhatsApp send inside the shim;
      `notifyAppointmentNoShow` puts the guard *below* the WhatsApp block so only the staff
      fan-out moves; `notifyClinicCreated` guards just the in-app branch so the super-admin
      email still goes out. In each case a shim that simply returned early would have
      dropped a live channel with nothing in the notification code looking wrong.
      **All 12 helpers shimmed.** `notifyClinicAdminsOfStaffAction` now takes an `eventKey`
      and its 8 call sites pass a real one — `staff.discount_applied`,
      `staff.refund_initiated`, `staff.offline_payment_confirmed`, `staff.security_modified`
      (×2), `staff.profile_updated` (×2), `staff.status_changed`. They previously all sent
      `action: 'user_created'`, which is what made a clinic's financial audit trail mutable
      by turning off the welcome notification.
      The staff activity copy takes the call site's whole sentence as `detail` rather than
      reassembling it from parts — the amounts and names are only known where the action
      happened. Subscription renewal is shimmed as a clean if/else so the legacy body stays
      readable next to the new one.
- [x] **Send-time enrichment** — `enrich?` added to the event contract. Call sites hold ids;
      copy wants names. Requiring every caller to fetch and pass a patient and doctor name
      would push notification concerns back into the services this rebuild is clearing, and
      would freeze those names at enqueue time so a delayed job renders the doctor the
      appointment *used to* have. Appointment events resolve participants through
      `DirectoryPort` at delivery. Caller-supplied values always win over the lookup.
- [x] `no-restricted-imports` — three groups in `eslint.config.ts`: the two legacy helper
      modules, and the notification module's internals. Outside the module the only way in is
      `notify()`; the module's own files and the shims are exempted, since the shims must
      keep importing what they wrap. This is the boundary rule from A5 enforced by tooling
      rather than by review — the version that survives someone in a hurry.
- [~] Batch INSERT per event — **done** in `dispatch.service.ts`: one statement for the whole
      audience, upserting on the collapse key. Preference lookups are **concurrent, not
      pipelined** — `Promise.all` over `getUserNotificationPreference`, which is N Redis reads
      rather than one `MGET`. Fine at a clinic's fan-out size; revisit if a single event ever
      targets a large audience
- [x] **De-block the awaited call sites — achieved architecturally, not by editing them.**
      On the registry path `notify()` is a single Redis write that cannot throw, so awaiting
      it costs about a millisecond and can never fail the caller. Everything expensive —
      recipient resolution, the per-recipient preference lookups, the batch insert, the
      socket emits — runs in the worker, which was the actual goal.
      Rewriting 17 multi-line call sites to `void …catch()` would have added real risk
      (each spans several lines and is easy to break) for no measurable gain, and the legacy
      path they would protect is deleted in Phase 9 anyway.
      **Still true on the legacy path:** with the flag off, those 17 sites remain blocking,
      exactly as they are in production today. That is unchanged rather than fixed, and it
      stops mattering when Phase 9 removes the old helpers.
- [x] **Fix silent-drop on persist failure** — a failed INSERT was swallowed and the socket
      still fired, so the client showed a toast with `notificationId: null` that could never be
      marked read and vanished on refresh. Fixed on **both legacy paths**
      (`sendNotificationToUser`, `UniversalNotificationService.send`): a `persistFailed` flag now
      cancels the socket emit and the Kafka publish, leaving the inbox and the screen agreeing
      with each other. **Scoped deliberately to the in-app channel** — email, SMS, WhatsApp and
      push are separate deliveries that do not depend on the row, so a database blip must not
      silence a patient's WhatsApp message as well. The registry path already had this property:
      `dispatch.service.ts` emits from the rows the insert `.returning()`s, so there is nothing
      to emit when it fails and the job retries
- [x] **Fix the cross-transaction write (data integrity).** `notifyAppointmentCreated` ran
      *inside* the `database.transaction` opened at `appointment.service.ts:1390`, while
      `sendNotificationToUser` writes via the global `database` handle — a different connection.
      A rollback after that point left a notification for an appointment that never existed, and
      the socket fired before the row was visible, so a client refetching on the signal read
      pre-commit state. **Moved to the post-commit block** that already exists for the booking
      SMS/WhatsApp and the realtime signal, which carry the same constraint for the same reason.
      The two `getUserById` lookups moved with it — they only ever fed this call, so the
      transaction is now shorter by two round trips as well. A `doctorId` guard was added on the
      way out: it is nullable on the row, and the staff side of this notification is addressed to
      the assigned doctor.
      **Remaining call sites audited** — `notifyTestLogCreated`, `notifyTestReportUploaded` (×2),
      `notifyAppointmentNoShow` and `notifyClinicAdminsOfStaffAction` also sit near transaction
      bodies and are *not* yet verified as post-commit. Not fixed here: each needs its own read of
      the surrounding transaction, and the queue removes the class of bug anyway once
      `NOTIFICATIONS_REGISTRY_ENABLED` is on — a job in another process cannot be inside the
      caller's transaction. Tracked as its own item below
- [x] **All 5 remaining in-transaction notify call sites moved post-commit.** Every one was the
      same shape as the appointment case — the notification writes through the global `database`
      handle, not the transaction's, so it announced state a rollback could still undo and the
      socket emit beat the row's own visibility. None were safe; none were left.
      - `patientsTest.service.ts` (`notifyTestLogCreated`) — the transaction now returns the
        inserted row and the notification follows it
      - `appointmentTest.service.ts` (`notifyTestReportUploaded`) — the transaction returns
        `{ updated, patientId, testName }`; the performer lookup moved out with the send, so it no
        longer runs on the transaction's connection either
      - `patient.service.ts` (`notifyTestReportUploaded`, patient-uploaded report) — same shape;
        the values the copy needs are carried out of the transaction rather than re-queried
      - `noShow.service.ts` (`notifyAppointmentNoShow`) — moved into the post-commit block that
        already existed for the appointment-engine hook, which carried this constraint for the
        same reason. `actionTaken` is returned from the transaction so the notification still
        reports the policy outcome
      - `doctor.controller.ts` (`notifyClinicAdminsOfStaffAction`) — the alert is *captured*
        inside the transaction and sent after it commits. This one is the audit trail for a
        staff email/mobile change, where an entry describing something that was rolled back is
        worse than a missing one
      **Not moved: the approval email in the same controller transaction.** It is a different
      channel (Standing Rule 11) and has its own failure handling; folding it into this change
      would have altered behaviour nobody asked about
- [x] **Persist regardless of preference — narrowed during implementation.** The plan said to
      always write the row and let preference gate delivery only. That is wrong for in-app: the
      row *is* the in-app delivery, so writing it for a user who muted the bell would defeat the
      mute and put the item straight back in their inbox. What ships instead: `kind='activity'`
      is always recorded (history must survive a muted toggle), while `kind='notification'`
      still honours the in-app preference. Push is gated separately by the push preference
- [x] **Transient events never persisted** — `UniversalNotificationService` wrote a row for
      any recipient with a `userId`, ignoring `channels` entirely. So the queue-position
      pushes ("3 patients ahead", then 2, then 1) each left a permanent inbox row for a
      number already stale by the time it was read. Persistence now requires the in-app
      channel to have actually been requested; those events are push-only by declaration and
      now by behaviour too.
- [x] Retention cron — `cron/jobs/notificationRetention.cron.ts` (3:30 AM IST, after the OTP
      cleanup so two table-wide deletes do not share a window) plus
      `services/retention.service.ts` holding the policy, so it is readable and testable
      apart from the schedule.
      Three rules: **unread is never deleted at any age** (age does not make an unseen
      notification seen); **activity is kept a year** against 90 days for notifications,
      because it is the audit trail someone comes looking for months later; and deletes run
      in 10k batches, since the table carries four indexes and one unbounded DELETE would
      hold locks across all of them while the inbox is being read. Both windows are
      env-configurable with a 7-day floor, so a mistyped variable cannot quietly empty the
      table. `countExpiredNotifications()` reports what a run would remove — worth calling
      before enabling this against a large table.
- [x] `npm run notifications:docs` — generates `docs/NOTIFICATION_EVENTS.md` from the
      registry: 19 rows covering event, category, notification-vs-activity, priority, each
      audience and its roles, the permission each needs, the route each lands on, and
      whether it can be muted. Click routes are resolved by calling the action against a
      placeholder context, so the table shows `/appointments/:id` rather than a promise that
      a route exists. Aliases and descriptions follow. This is §11 of the brief, generated
      from the code that runs rather than maintained beside it — which is precisely how the
      three copies of the event list this registry replaced drifted apart.
- [x] **Socket ACL fix** — `mayJoinRoom()` in `socket/socketManager.ts` is now an allowlist,
      not a fall-through. `user:` (own id) and `clinic:<uuid>` (membership, exact match) are
      the only prefixes reachable by request; everything else is refused **and logged**, so a
      legitimate unlisted prefix surfaces as a warning rather than a feature that quietly
      stopped working. `leave` now only accepts rooms the socket actually holds.
      - [x] Gate: room prefixes enumerated. The web FE emits `join` **only** for
        `user:<id>` (`services/socket.ts:122`) — nothing else uses the generic handler.
        `clinic:*`, `clinic:{c}:role:{r}` and `clinic:{c}:doctor:{d}` are joined on connect
        from the user's own assignments; `live-queue:*` has its own ownership-checked
        handler. So the lockdown removes the hole with no functional change.
      - [x] `clinic:{c}:doctor:{d}` / `clinic:{c}:role:{r}` are refused **deliberately**, not
        fixed to be joinable: honouring them would mean trusting a client-supplied doctor id,
        and connect already joins them from the user's own assignments.
      - [x] DB fallback on cache miss — `getUserClinicIds()`, now shared with the connect
        handler. The 10-minute Redis TTL previously outlived long sockets, so every join
        after expiry was denied for an entitled user
      - [ ] Gate: test patient live-queue flow end to end *(needs a running app)*

> Found while enumerating: nothing joins `appointment:<id>`, so
> `broadcastPrescriptionPdfReadyToAppointmentRoom` and the FE listener at
> `services/socket.ts:106` are already a dead path. Patients still get the PDF via their
> `user:` room. Worth deciding in Phase 4 whether to wire it or delete it.

## PHASE 1 — End-to-end verification (appointment notifications)

Standing Rule 5 applies: appointment notifications touch live clinic workflow, so this is run
deliberately, on dev, with the client's knowledge. Requested by the client 2026-08-24.

**Preconditions**

| | Value | Where |
|---|---|---|
| `NOTIFICATIONS_INAPP_ENABLED` | `true` | `InfinityMedisetu_BE/.env` — off by default, so the bell is silent until set |
| `NOTIFICATIONS_REGISTRY_ENABLED` | `true` | same file — off means the legacy helpers run instead of the registry |
| `VITE_NOTIFICATIONS_ENABLED` | `true` | `InfinityMedisetuWeb_FE/.env` — Vite inlines it, so the FE must be restarted, not just reloaded |
| Migration 0008 | applied to dev | already done; `tenant_type`, `category`, `kind`, `event_key`, `click_route`, `collapse_key` |
| Redis | running | the BullMQ worker is where dispatch happens; without it `notify()` enqueues into nothing |

Turning both BE flags on is also what makes the retention cron start (it is gated on the first
of them) — on dev that is harmless, but it is no longer a no-op.

**What to walk through**

1. **Book an appointment** (reception or patient portal). Expect: the assigned doctor and the
   receptionist responsible for that doctor get a row; every *other* receptionist and admin does
   not. That narrowing is the point of the phase — the old path notified all of them.
2. **Check the row, not just the toast.** `event_key = 'appointment.created'`,
   `category = 'appointments'`, `kind = 'notification'`, `click_route` populated,
   `tenant_type = 'clinic'`. A toast with no row is the bug fixed this phase.
3. **Reschedule the same appointment.** Expect the *same* inbox row to update rather than a
   second appearing — that is the collapse key. The patient WhatsApp must still go out.
4. **Cancel it.** Same collapse behaviour; `event_key` follows the latest state.
5. **Mark a no-show.** Verify the patient WhatsApp still sends: it moved post-commit with the
   notification, so its timing changed even though nothing about it did.
6. **Force a rollback** (book with a payload that fails validation after the insert). Expect no
   notification at all — this is what the post-commit move fixes.
7. **Click through** from the notification and confirm it lands on the appointment.

**Known gaps this run will show, and should not be treated as regressions**

- The Notification Center UI is Phase 2, so the bell is still the old panel: no category tabs,
  no Activity tab, no action-required pinning.
- `click_route` is stored and returned, but nothing in the FE consumes it yet.
- Push goes out on the legacy SNS path; only in-app runs through the queue.

- [ ] Run the walkthrough above, record what differed here

## PHASE 2 — FE Notification Center

> **Survey first, 2026-08-24 — the phase is bigger than it looked.** Three findings, and the
> first one reframes the rest:
>
> - **The FE notification state is entirely localStorage-backed, and no API slice exists.**
>   `redux/slices/notificationSlice.ts` persists to `medisetu_notifications` and is fed *only*
>   by socket events; `GET /api/v1/notifications` is never called by the web FE. So a
>   notification that arrives while the tab is closed is never seen, the badge counts whatever
>   localStorage holds rather than what the server has, and "dismissed" ids are per-device.
>   Mark-read goes over the socket, not REST.
> - **There is no staff notification page.** `pages/notification/Notification.tsx` is hardcoded
>   sample data and is not routed — only `PatientNotification` is. The bell dropdown in
>   `components/shared/Header.tsx` is the whole staff surface.
> - **Click routing is a client-side switch** (`resolveNotificationRoute()` in `Header.tsx`),
>   which is exactly what `click_route` replaces.
>
> Consequence: the listed UI work all sits in **2c**. It needs a data layer under it first, and
> **the localStorage store is retired rather than synced** — two sources of truth for read state
> means the dismissed-ids set fights the server, hiding rows the server still has and vice versa.

### 2a — Backend list API

- [x] **`GET /notifications/inbox`** — keyset pagination (`cursor` = base64url `createdAt|id`,
      id breaking ties so a fan-out writing several rows in one millisecond still paginates),
      plus `kind`, `category`, `actionRequired` and `unreadOnly` filters. Returns
      `{ items, hasMore, nextCursor }`; fetches `limit + 1` rows so "is there more" costs no
      second query. Offset pagination was the alternative and re-scans what it skips — worse, it
      drops and repeats rows on a feed that grows at the top.
- [x] **`GET /notifications/unread-count`** — `badge` (bounded at `UNREAD_COUNT_CAP`, with
      `badgeCapped` so the UI knows to render "99+") plus **exact** per-category counts and an
      `actionRequired` total, in one grouped query. The badge is capped and the tab labels are
      not, deliberately: "Payments (99+)" would be wrong rather than abbreviated.
- [x] **`PUT /notifications/read`** — bulk mark-read, scoped by `userId` in the WHERE clause
      rather than trusting the ids. Without that scope anyone holding a notification id could
      mark another user's row read.
- [x] **Added beside the legacy endpoints, not replacing them.** `GET /` and `GET /unread` keep
      their array shape because the mobile client consumes it (the device-registration endpoints
      are the evidence it exists); they go in Phase 9 with the rest of the legacy path.
- [x] **Socket `notification.mark_read` IDOR fixed.** The handler called
      `markNotificationRead(notificationId)` with no ownership check and returned the whole
      updated row in its ack, so any authenticated client holding a notification id could mark
      *and read* another user's notification — title, body, data and metadata. It now goes
      through `markManyRead(user.id, [id])`, which scopes the UPDATE by `user_id` in the same
      statement, and the ack no longer echoes the row. The REST handlers were already checking
      ownership; only the socket path was missing it, and the socket path is the one the FE uses.
      `notification.mark_all_read` was already scoped correctly
- [x] **`markNotificationRead` and `deleteNotification` now take `userId`** and put it in the
      WHERE clause. Both were "safe" only because their single caller checked ownership first —
      an arrangement that holds until someone adds a second caller, which is exactly how the
      socket handler above ended up unscoped. The two controllers drop their check-then-act
      lookup and 404 on an empty result instead: one statement instead of two, no window between
      the check and the act, and a row that is not yours is indistinguishable from one that does
      not exist, which is the right answer to give either way
- [x] Swagger entries for the new routes — **done 2026-08-30.** The mechanism is
      `docsRegistry.addEndpoint()` in the route file, not an exported `apiDocs` array; the module
      already had 7 entries for the legacy routes. All of `/inbox`, `/unread-count`, `/read`,
      `/read-all` and `/events` are documented: **12 routes, 12 entries**, verified by diffing the
      router's own registrations against the documented paths.
      **`responseExample` is a dead field — do not use it.** It exists on `EndpointDoc` but nothing
      consumes it: `swagger.ts` renders `responseSchema` and `playground.ts` passes `requestExample`
      only. The first version of this work used it and the examples never appeared anywhere, which
      only surfaced by fetching the running server's spec. The three endpoints whose shape is not
      self-evident now carry real Zod `responseSchema`s
      (`inboxResponseSchema`, `unreadCountResponseSchema`, `eventCatalogResponseSchema` in
      `schemas/notifications.schemas.ts`), confirmed rendering in the generated OpenAPI

### 2b — Frontend data layer

- [x] `redux/api/notificationApi.ts` — RTK Query on `baseQueryWithAutoLogout`, registered in
      `apiRoot.ts`. Five endpoints: `getInbox`, `getUnreadCounts`, `markRead` (bulk),
      `markAllRead`, `deleteNotification`. Tags `Inbox` / `UnreadCount`, so every mutation
      refreshes both the list and the badge without the caller wiring it.
      **Cursor pages are merged in the cache**, keyed on the filters with `cursor` stripped, so
      "load more" appends to what the user is looking at while changing a tab starts fresh. A
      request with no cursor *replaces* rather than appends — otherwise a socket-triggered
      refresh of page one would duplicate every row on screen.
      Types live in `src/types/notification/`, mirroring the backend enums.
- [x] **`PUT /notifications/read-all` added to the backend** — mark-all-read existed only as a
      socket event, so the Notification Center had no way to do it over REST. The service
      function was already there and already user-scoped
- [x] Socket becomes an invalidation signal, not the store — `hooks/useNotificationCenter.ts`
      subscribes to `notification.new` / `notification.marked_read` / `notification.all_marked_read`
      and dispatches `invalidateTags(['Inbox', 'UnreadCount'])`. A device that was asleep, closed or
      offline converges on the same server state as one that stayed connected, instead of holding
      whatever frames it happened to catch
- [x] Retire `notificationSlice`'s localStorage persistence and the dismissed-ids set — slice
      **deleted** along with `hooks/useSocketNotifications.ts`, and unregistered from `store.ts`.
      Landed with the `Header.tsx` rewrite as planned, since the bell was its only consumer

### 2c — Frontend UI

- [x] Category tabs — `pages/notification/NotificationCenter.tsx`, 9 tabs: Action Required,
      the 6 categories (appointments / payments / prescription / lab / staff / system), and
      Activity. Tab state lives in the URL (`?tab=`), so a tab is linkable and survives reload.
      **Action Required is a tab but not a category** — it is a *priority*, so an appointment or
      a payment stays in its own category tab while also appearing there
- [x] Action-required pinned and visually highlighted — a stable partition (the server already
      sorts by date), so action-required items pin to the top of *every* tab, not just their own
- [x] Click-through navigation from server-provided `click_route` — `buildNotificationRoute()`
      fills the `clickRoute` pattern from `clickParams`; no FE switch statement. An unfilled
      `:placeholder` returns `null` rather than navigating to a literal `:id`. Items with no
      route are still marked read on click, so the badge reflects that they were seen
- [x] Activity tab (same table, `kind='activity'`) — never badges, by design: activity is
      browsable history that must not interrupt
- [x] `NOTIFICATION_EVENTS` fetched from the backend instead of hand-maintained — **done
      2026-08-30, closing A8.** BE: `GET /api/v1/notifications/events`
      (`preferences/eventCatalog.ts` + `listEventCatalogHandler`), generated from the registry and
      scoped to the caller's role. FE: `useGetEventCatalogQuery`, and the hardcoded array is
      **deleted** — `constants.ts` now holds only the category→icon map, since an icon is
      presentation and the server has no opinion about it.
      Three things the implementation got right only because they were checked:
      - **`key` is the preference key (`aliases[0]`), not the canonical event key.** Stored
        preferences are keyed by the pre-rebuild names and a lookup miss resolves to "enabled",
        so serving canonical keys would have silently un-muted everything users had turned off.
        `eventKey` carries the canonical name alongside
      - **Super_Admin inherits Admin**, mirroring `getRoleDefaults()`. Caught by running the
        catalogue: Super_Admin returned **1 event** before the merge and 17 after — the exact
        collapse that function's comment warns about
      - Events reaching a role on no configurable channel are omitted; a WhatsApp-only event has
        nothing to toggle on this screen
- [x] **Catalogue verified against `getRoleDefaults()` for all six roles** — every row has a
      default behind it and every default has a row, values included. 5 of 6 exact; the single
      difference is `Doctor:pdf_ready`, already recorded in `INTENTIONAL_DROPS`: the legacy map
      offers Doctor a toggle for a notification only the patient ever receives, so the catalogue
      omitting it removes a switch that controls nothing. Row counts by role:
      Admin 16, Super_Admin 17, Doctor 9, Receptionist 7, Patient 8, Lab_Assistant 4
- [x] Unread badge from the real count endpoint — `useGetUnreadCountsQuery`; the bell shows the
      bounded `badge`, each tab its exact per-category count
- [x] A real staff notification page replacing the hardcoded `Notification.tsx` — routed at
      `/notifications` (`routes.ts:330`). The old `pages/notification/Notification.tsx` is now
      **orphaned but not deleted** — no import, no route — pending Standing Rule 6

- [ ] **Per-event toggle UI is missing from the settings screen** — found 2026-08-30 while wiring
      the catalogue. `NotificationSettings.tsx` renders only Communication Channels and Reminders;
      the in-app/push switches the preferences endpoints, `ROLE_DEFAULTS` and now the catalogue all
      exist to drive have no UI. `handleToggleEvent` and `handleSavePreferences` are live in the
      hook and `eventsByCategory` is grouped and returned, but nothing consumes them — so the
      screen's own "total events" stat counts rows a user cannot actually see or change. Logged
      rather than built: restoring the section is a design decision, not a wiring fix, and the
      catalogue it would render is now in place either way.

## PHASE 3 — Appointment & Queue module

> **Consistency review of the legacy appointment code (2026-08-24).** Findings that
> shaped the registry entries, and one still open:
>
> - **Copy differs by audience.** The old helpers sent staff `"{performer} booked an
>   appointment for {patient}"` and the patient `"Your appointment at {clinic} is
>   booked"`. The first registry draft had one message for everyone, which would have
>   shown patients staff-facing copy about themselves. The event contract now carries
>   `audiences[]`, each with its own recipients, permission rule and wording.
> - **Permission must not apply to patients.** Staff need `APPOINTMENT_VIEW`; a patient
>   reading about their own appointment holds no clinic permission at all, so a single
>   event-level permission filter would have silently dropped every patient
>   notification. The rule now sits per audience.
> - **Reschedule reaches reception now.** The old helper told only the doctor and the
>   patient — §4 requires the assigned receptionist, and the staff audience covers them.
> - **Recipients narrowed deliberately** for created / cancelled / no_show: the old code
>   notified every receptionist and admin in the clinic, these resolve through staff
>   scope. User-visible, so it ships behind `NOTIFY_STRICT_RECIPIENTS_APPOINTMENT`.
> - **DECIDED 2026-08-24: in-app and push first; SMS/WhatsApp stay put.** The registry owns
>   `['inApp', 'push']` for now. Booked, rescheduled and no-show keep sending patient
>   SMS/WhatsApp through `appointmentNotification.service`, `sendRescheduleToPatient` and
>   `sendAppointmentNotification` exactly as they do today, untouched. Folding them into the
>   registry is a later pass.
>
>   **The trap this creates, for whoever writes the shims.** `notifyAppointmentRescheduled`
>   does two jobs in one function: the in-app notification *and* the SMS/WhatsApp send.
>   `notifyAppointmentNoShow` is the same shape. Turning either into a thin shim that only
>   delegates to `notify()` silently stops patients receiving reschedule and no-show texts —
>   a failure nobody sees in a typecheck, a test run, or a code review that is looking at
>   notification code. The SMS call must be kept in the shim explicitly, and its presence
>   checked when the call site finally migrates.


- [x] `appointment.created` / `.cancelled` / `.rescheduled` — **already trimmed by Phase 1**, not
      work this phase had to do. `appointmentStaff` resolved through
      `directory.getStaffResponsibleForDoctor()` from the day the registry landed, and the adapter
      already implements the D1a fallback (no scope row → treated as all-doctors). The checklist
      read as if three migrations were outstanding; re-reading the code found them done
- [x] **Flag `NOTIFY_STRICT_RECIPIENTS_APPOINTMENT`** — `utils/envConfig.ts`, default **off**.
      **The real gap this phase found:** trimming was unconditional whenever the registry was on,
      so the only way back to the old recipients was disabling the registry entirely — losing the
      queue, preference resolution and click routes along with it. Standing Rule 7 requires the
      trim itself to be reversible. `appointmentStaff` now switches between
      `getStaffResponsibleForDoctor` (narrow) and `getStaffByRole` (the legacy wide set), so
      *routing through the registry* and *changing who is told* are independently switchable
- [!] **`queue.patient_sent_in`** — built 2026-08-30, then **removed the same day at the author's
      request**. It was doctor-only, in-app only, `action_required`, firing only when someone other
      than the doctor moved the patient. **§4 of the client brief still asks for it** ("Patient sent
      to doctor → doctor"), so removing it reopens that requirement — recorded here rather than
      silently dropped from §4. The queue's `queue.patient_sent_in` **bus signal is untouched**:
      that predates this work and still refreshes the boards; only the notification went
- [x] **`consultation.completed`** — NEW. Admin + Receptionist, doctor excluded as performer.
      Hung off the existing `statusChanged` check in `updateAppointment`, not on the payload alone,
      so re-saving an already-Completed appointment (a note, a payment) cannot re-announce a
      consultation that ended an hour ago
- [x] Click actions for all of the above — both new events open `/appointment/:id`
- [x] **Both new call sites gated on `NOTIFICATIONS_REGISTRY_ENABLED`.** `notify()` enqueues
      unconditionally; the flag is checked by the legacy `notify*` helpers, not by `notify()`
      itself. The five existing events are safe because they are reached through those helpers —
      but a new event has no legacy path, so a bare call would have gone live on deploy, in a phase
      meant to stay dark. Worth remembering for every later phase that adds an event
- [x] Bus: queue + board + schedule sync verified alongside each — **tested by the author
      2026-08-30 against a running app with all three flags on; reported successful.** Covered by
      scenarios S1–S8 in `NOTIFICATION_TEST_PLAN.md` §2b, including the two most likely to be
      wrong: S4 (re-saving a completed appointment must not re-announce it) and S6 (push fires,
      and activity never pushes). Recorded as the author's result rather than an observed one —
      no transcript of the run was captured here

## PHASE 4 — Prescription / Consultation module
> **DEFERRED 2026-08-30, at the author's instruction.** Not in scope for the current run —
> skipped rather than dropped: every item below stays unticked and the registry entries these
> phases would migrate to are already written and parity-checked, so picking this up later is
> resuming, not restarting.
>
> **What deferring costs, recorded so the decision is visible rather than rediscovered.** Phase 3
> narrows appointment recipients through staff scope while these modules keep the old
> notify-everyone fan-out, so for a while the same clinic gets precise appointment notifications
> and blanket prescription/payment/lab ones. That is a consistency gap users can see, not just an
> unfinished checklist — and §13's "do not notify users who cannot take action" stays unmet for
> these three. Phase 9 also cannot fully close while their legacy helpers still have live call
> sites.

- [ ] `prescription.completed` → receptionist (NEW)
- [ ] Patient status → Completed, queue updates, next patient active
- [ ] Bus: add prescription target to `sections.ts`
- [ ] `pdf_generation_started` removed
- [ ] `pdf_ready` retained with click action

## PHASE 5 — Payments module
> **DEFERRED 2026-08-30, at the author's instruction.** Not in scope for the current run —
> skipped rather than dropped: every item below stays unticked and the registry entries these
> phases would migrate to are already written and parity-checked, so picking this up later is
> resuming, not restarting.
>
> **What deferring costs, recorded so the decision is visible rather than rediscovered.** Phase 3
> narrows appointment recipients through staff scope while these modules keep the old
> notify-everyone fan-out, so for a while the same clinic gets precise appointment notifications
> and blanket prescription/payment/lab ones. That is a consistency gap users can see, not just an
> unfinished checklist — and §13's "do not notify users who cannot take action" stays unmet for
> these three. Phase 9 also cannot fully close while their legacy helpers still have live call
> sites.

- [ ] `payment.received` → **staff** (NEW — currently patient only)
- [ ] Payment status + appointment status sync immediately
- [ ] Bus: add payment target to `sections.ts`
- [ ] Duplicate-collection prevention verified with two concurrent receptionist sessions

## PHASE 6 — Lab module
> **DEFERRED 2026-08-30, at the author's instruction.** Not in scope for the current run —
> skipped rather than dropped: every item below stays unticked and the registry entries these
> phases would migrate to are already written and parity-checked, so picking this up later is
> resuming, not restarting.
>
> **What deferring costs, recorded so the decision is visible rather than rediscovered.** Phase 3
> narrows appointment recipients through staff scope while these modules keep the old
> notify-everyone fan-out, so for a while the same clinic gets precise appointment notifications
> and blanket prescription/payment/lab ones. That is a consistency gap users can see, not just an
> unfinished checklist — and §13's "do not notify users who cannot take action" stays unmet for
> these three. Phase 9 also cannot fully close while their legacy helpers still have live call
> sites.


> **Registered in Phase 1.** Two things the lab module forced, both now part of the contract:
>
> - **Click destinations are per-audience.** Lab routes are role-scoped — lab staff reach a
>   test at `/lab/assigned`, reception at `/lab-tests`, patients at `/reports`. A single
>   event-level destination would have sent half the recipients to a page their role cannot
>   open. `clickAction` is now optional on an audience and falls back to the event's.
> - **`DirectoryPort.getLabUsers()`** added. The lab audience is *every* assistant attached
>   to the clinic, and that broad fan-out is correct rather than spam: a sample waiting for
>   collection is any assistant's to pick up. Unchanged from current behaviour, deliberately.
>
> `lab.report_uploaded` narrows to the **ordering** doctor rather than every doctor in the
> clinic — a result is only actionable by whoever asked the question.
>
> **The parity check caught a regression here, after being taught to look for it.** The
> first version of `lab.report_uploaded` had no lab audience at all, so lab staff would
> have stopped being told when a doctor or admin uploaded a report — and the check still
> reported a clean run, because it iterated the *generated* map and therefore never saw a
> role the registry had dropped. It now also walks the legacy map for events the registry
> has claimed, which surfaced both this and a `Doctor` toggle for `pdf_ready` that controls
> nothing (`notifyPrescriptionPdfReady` only ever notified the patient). The first is fixed;
> the second is declared in `INTENTIONAL_DROPS`, because a permanent false positive is
> exactly what hides the next real one.


- [ ] `test_assigned_to_lab`, `test_report_uploaded`, `test_log_created` re-scoped
- [ ] Fix the Admin-only dead branch in `test_log_created`

## PHASE 7 — Staff / Account module

> **Registered in Phase 1.** The eight staff-action alerts all shipped under the same
> `action: 'user_created'` key, which made them indistinguishable from each other *and*
> from the genuine welcome notification — so a user muting "User Account Created" would
> have silenced their clinic's entire financial audit trail. Each now has its own key.
>
> They are `kind: 'activity'`, per §10: an admin needs to be able to see that a
> receptionist discounted an appointment; they do not need to be paged about it. They are
> also **deliberately not collapsed** — two discounts in an afternoon are two facts, and an
> audit trail that overwrites itself is not one.
>
> `clinic.created` carries **no tenant** — it is the platform-level `null/null` case the
> tenant columns exist to allow, and needed `DirectoryPort.getSuperAdmins()` because
> Super_Admins belong to no clinic and the staff-scope path cannot reach them.


- [x] 8 staff-action alerts → `kind='activity'` — **landed in Phase 1**, confirmed 2026-08-30
- [x] Each has a distinct event key — **confirmed by auditing all 8 call sites**, not by reading
      the registry. The risk worth checking was the reverse of what the item describes: a call
      site that omits `eventKey` falls back to the legacy fan-out *silently*, even with the
      registry on, because `notifyClinicAdminsOfStaffAction` requires both the flag and the key.
      All 8 pass one. (`doctor.controller.ts` builds its payload as a variable rather than inline,
      so a literal-only grep reports it as missing — it is not.)
- [x] **`user_created` welcome — DECIDED 2026-08-30: keep.** It is the only in-app notification a
      new account ever receives, and its click route (`/profile/my-notifications`) makes it the
      one thing that tells a user notification preferences exist at all. Dropping it would remove
      a discovery path rather than noise. The original reason to reconsider it — that muting it
      also silenced the clinic's financial audit trail — was removed when the 8 staff events got
      their own keys, so the objection no longer applies

## PHASE 8 — Subscription / System module

> **Registered in Phase 1.** `subscription.expiring` is non-configurable: a renewal
> reminder a clinic admin has muted is a clinic whose staff accounts deactivate without
> warning. It collapses per clinic, because the reminder fires on several days as expiry
> approaches and each firing should replace the last rather than stack five copies of the
> same warning.


- [x] Renewal reminders → System category — `subscription.expiring` was already registered as
      `category: 'system'`. **But only one of the two send paths had been migrated.**
      `sendExpiryReminders()` (the nightly cron) routed through the registry;
      `sendReminderToClinic()` — the admin-triggered "remind them now" button behind
      `POST /subscriptions/reminders/send-to-clinic` — still wrote through
      `sendNotificationToUser` directly. So a manual reminder produced a *second*, uncollapsed
      warning about the same expiry, under a different preference key and with no registry click
      route. Nothing failed, which is why it survived the Phase 1 sweep. Now migrated to the same
      event, with the legacy call kept as the flag-off branch
- [x] **Push path onto the queue — done 2026-08-30, and it was a rollout blocker, not a
      tidy-up.** The registry dispatcher sent **no push at all**: it read each recipient's push
      preference and discarded it, while the legacy path it replaced *did* push and the settings
      screen kept offering a push toggle for all 21 events. Turning
      `NOTIFICATIONS_REGISTRY_ENABLED` on would therefore have silently killed every migrated
      event's push, with nothing logged. `dispatch.service.ts` now sends push after the insert:
      - Activity **never** pushes, whatever the preference says — history that interrupts is not
        history
      - Errors are swallowed per recipient: the row is already committed, so a failed push must
        not fail the job and duplicate the notification on retry
      - **Not its own queue job** — the dispatcher *is* a queue job; a second hop buys nothing
        and would make a retry re-run the insert
      - **Deliberate asymmetry:** the in-app insert ignores `NOTIFICATIONS_INAPP_ENABLED`
        (the registry path is governed by the registry flag at its call sites) but **push honours
        it**, so enabling the registry for a trial cannot start pushing to real phones. The cost
        is a half-state that needs explaining; the alternative is a surprise that cannot be
        taken back
- [!] **Email path onto the queue — blocked on the client.** Standing Rule 11 ("in-app only",
      client instruction 2026-08-24) has kept email out of scope throughout. Unblocking it is
      their call, not ours
- [~] **WhatsApp can be delivered from the registry — mechanism built 2026-08-30, deliberately
      unused.** `DirectoryPort.getUserMobiles()` (batched), `deliverWhatsApp()` in
      `dispatch.service.ts` (clinic `whatsappEnabled` honoured, `WHATSAPP_FORCE_ENABLED`
      respected, delivery through the existing outbox so retries are unchanged), and the registry's
      `WhatsAppMessage` retyped to the outbox's discriminated union — an entry whose params do not
      match the template it names now fails to compile rather than failing at Meta.
      **No event declares the channel, and none should yet.** Wiring two events was tried and
      backed out the same day on finding it double-sends: **the legacy senders are
      flag-independent while the registry path is not.** Declaring the channel sends the message
      twice; deleting the legacy call instead makes patient WhatsApp depend on
      `NOTIFICATIONS_REGISTRY_ENABLED`, which is off in every deployed environment, so patients
      would get nothing. Both halves must land in one commit, per template.
      **This is the same asymmetry that blocks the email item above and the helper deletion in
      Phase 9** — it is why neither is simply "more work".
- [x] **W1 (2026-09-23): the registry WhatsApp path is built, and no event uses it.** Standing
      Rule 11 was lifted **for WhatsApp only** by the author on 2026-09-23. It still holds for
      email and SMS. What landed:
      - Event-level `whatsapp: { recipients, message → WhatsAppMessage | null }` in
        `registry/types.ts`. It replaces the unused per-audience `message.whatsapp`.
      - `deliverWhatsApp` now runs **first** in `dispatch()`, outside the audiences, so bell
        prefs, `seen` and the performer exclusion cannot drop it.
      - Outbox job id `wa-<dispatchJobId>-<userId>`, so a retried dispatch cannot resend.
        Ceiling: this only de-dupes while the outbox still keeps the completed job
        (`removeOnComplete: 200`).
      - `WHATSAPP_VIA_REGISTRY` (comma-separated template keys, empty by default) is the
        one per-template switch.
      - Tests: `__tests__/dispatch.whatsapp.test.ts` (4 cases). `registry.contract.test.ts` was
        moved to `__tests__/` per BACKEND_STANDARDS §12. The contract, dispatch rules and new
        test all pass.
      **No behaviour change:** no event declares `whatsapp` and the set is empty.
- [~] **WhatsApp migration: W0 done 2026-09-23, W1 done, W2 next.** The prerequisite
      above is met. `323eb90e` hard-codes `NOTIFICATIONS_REGISTRY_ENABLED: true` and is on
      `origin/main` and `origin/staging`. Still to confirm: that a prod tag was cut after it.
      Standing Rule 11 must be lifted for WhatsApp by the client before any template moves.
      **W0 found that the simple mapping, "declare `whatsapp` on the matching event", breaks
      parity:**
      - **Booked ≠ `appointment.created`.** The WhatsApp is sent when `notificationsEnabled()`,
        the booking is not Razorpay, and it has an `appointmentTime` (`appointment.service`
        ~1758). `appointment.created` instead requires a `doctorId`, skips when the performer
        lookup fails, and is **also** fired after Razorpay payment (`patient.service` ~2693),
        where no booked WhatsApp goes out today. Attaching the template to the event would add
        messages in one flow and drop them in the other. It needs its own WhatsApp-only event,
        fired at the same point with the same guard.
      - **The patient audience drops the performer; WhatsApp must not.** A patient who
        books or reschedules their own appointment gets the WhatsApp today.
      - **`deliverWhatsApp` runs inside `deliverInApp`, after `if (!rows.length) return`.** A
        patient who muted the bell would also lose WhatsApp, and the cross-audience `seen`
        de-dupe would drop recipients as well. WhatsApp must be delivered outside the in-app path.
      - **Reschedule runs inside the update transaction.** The worker can read the pre-commit
        schedule, so the new date/time must travel in ctx, as the legacy code does, and not come
        from `enrich`.
      - **No-show needs a `clinic_settings` row even under `WHATSAPP_FORCE_ENABLED`**
        (`patientMobile && settings`), while `deliverWhatsApp` sends without one. The registry
        side has to reproduce that rule, and the `'Patient'` name fallback.
      - The outbox's `appointmentId` argument is used for logging only, not de-duplication.
        Pass it anyway so failure logs keep naming the appointment.
      **Revised plan:**
      - **W1** (additive, no event uses it): event-level `whatsapp: { recipients, message →
        WhatsAppMessage | null }`, delivered after the audiences and independent of bell prefs,
        `seen` and the performer. Add a per-template env set `WHATSAPP_VIA_REGISTRY`, and one
        test file.
      - **W2:** booked. Add a WhatsApp-only event at the ~1758 guard. The legacy enqueue is
        skipped when the template is in the set. SMS is untouched.
      - **W3:** rescheduled and no-show, each riding its existing `notify()` call with the
        legacy guards reproduced in `message`. One template per commit, with the same set
        guarding both halves.
      - The completed, lab, reminder, follow-up and pharmacy templates stay put (see the table
        in the 2026-09-23 log row).
- [ ] **Quiet hours for push** — per-user window on the settings row. Push only, never
      `action_required`. Doctors use personal phones; this gets asked for immediately
      after launch. **More relevant since 2026-08-30**: push now actually fires on the registry
      path, so the window has something to suppress. Still not needed for correctness

## PHASE 9 — Removal (gated; last)
*Only after the replacement is proven in production.*

- [~] Gate: prove chat delivery cross-node without Kafka — **investigated 2026-08-30, and the
      answer inverted A3.** Chat did **not** work without Kafka: the client emitted, the server
      *published to Kafka*, and the topic binding fed the message back into sockets. There was no
      direct emit, so with the broker unreachable — routine locally, and tolerated at boot by
      design — a chat message reached nobody. It now emits straight through
      `emitByKafkaMessage`, fanned out by the Redis adapter like every other emit in the file.
      **Still wants a real two-node run**: the adapter is built for this and single-node works,
      but one process cannot demonstrate delivery *between* processes
- [x] Gate: confirm which emitter feeds `usePatientAppointmentRealtime.ts:179` — **resolved: it is
      `queueBroadcast.service.ts:163`**, which emits to `user:{userId}`. The frontend joins exactly
      one room, `user:{userId}` (`services/socket.ts:126`). `broadcastAppointmentChange` emits to
      `clinic:{clinicId}`, which patients never join — the socket ACL refuses it, since a patient
      is not a clinic member. So it does **not** feed that hook, which is what the gate was
      protecting
- [x] Remove Kafka notification topic + `notification.consumer.ts` — `src/kafka/` deleted entirely
- [x] Migrate `chat.message`, `broadcast`, `pdf_ready` topics to the Redis adapter — plus **7 other
      Kafka publishes removed as pure duplicates** (call signalling, the socket provider, the
      notification path, pdf_ready). Each already emitted directly *and then* published to Kafka so
      other nodes could re-emit; the adapter had been covering that the whole time, and
      `originNodeId` existed only to de-duplicate the two paths. Chat was the sole exception, and
      the sole thing that actually broke without a broker
- [x] Remove Kafka + Zookeeper from all three compose files — each still valid YAML, now `redis`
      and `app` only. `kafkajs` dropped from `package.json` and the lockfile; the `dev` script no
      longer asks compose for `kafka zookeeper`, services that no longer exist; `KAFKA_*` removed
      from `.env.example`
- [!] Delete `utils/notificationHelpers.ts`, `utils/notification.utils.ts` — **blocked, and not on
      effort.** `notificationHelpers.ts` is 1,091 lines and 21 functions, four of which send live
      patient-facing messages: `notifyAppointmentRescheduled` and `sendRescheduleToPatient`
      (WhatsApp), `notifyAppointmentNoShow` (WhatsApp/SMS) and `notifyClinicCreated` (email).
      Deleting the file stops patients receiving reschedule and no-show messages, and **no
      typecheck, test, or review of notification code would catch it** — exactly the trap recorded
      in the Phase 3 notes. It also holds shared query helpers (`getUsersByRolesInClinic`,
      `getUserById`, `getLabUsersByClinicId`, `getDoctorUsersByClinicId`) with callers well beyond
      notifications. Doing it properly means relocating the channel logic first, which Standing
      Rule 11 puts out of scope — the same client decision that blocks Phase 8's email item
- [x] Move `notificationPreferences.*` into `main/notifications/preferences/` — **done
      2026-08-30**, together with its test. **Closes an A5 boundary violation**: the module was
      reaching into `src/utils/` for its own preference resolution. Nothing outside imports those
      paths now. Three things a bare `git mv` breaks silently and that had to be fixed by hand:
      the moved files' own relative imports (three levels deeper), the lazy
      `require('../main/notifications/preferences/generateRoleDefaults')` inside the constants
      file (now `./generateRoleDefaults`), and the moved test's import — a path-rewriting script
      computes from the file's *new* location and so skips exactly the files that moved
- [x] Deprecate (do **not** drop) the 4 dead settings columns — **done 2026-08-30**, as JSDoc on
      `setting.model.ts`. **Correction worth carrying:** they are not "read by nothing".
      `updateSetting` still accepts them in its payload and echoes them back, so a client can
      still write a value that changes nothing; no *delivery* path consults them. **Retiring that
      write path is the prerequisite**, before the columns themselves can go. Dropping stays
      out of this rebuild: `notNull` with defaults costs a boolean per row, while a drop is
      irreversible and breaks any deploy still running the previous image mid-rollout

---

## 6. Existing-Data Cleanup Procedure

Destructive — follow in order.

- [ ] `CREATE TABLE notifications_archive_20260823 AS SELECT * FROM notifications;` (no FK)
- [ ] Run on **staging first**, compare counts before/after
- [ ] Classify (do not purge wholesale):
      - Staff-action alerts → **keep**, `kind='activity'` (they are the audit trail)
      - `pdf_generation_started` → delete (noise, no action, no record value)
      - Appointment/payment/lab → keep, backfill category
      - Unknown actions → keep, `category='system'` (never delete what you can't classify)
      - Read + older than 90 days → delete
- [ ] **Zero the bell** instead of purging:
      `UPDATE notifications SET read = true WHERE created_at < '<cutover>' AND read = false;`
- [ ] Batch deletes (10k at a time) if the table is large
- [ ] Count assertions in the migration — abort if it would delete more than expected
- [ ] Drop the archive table only after a week in prod

---

## 7. Registry Layout

```
main/notifications/registry/
  index.ts             merges modules, builds lookup, generates ROLE_DEFAULTS
  defineEvents.ts      typed helper
  appointment/
    index.ts
    events.ts          POLICY: who, why, channels, category, kind, click action
    messages.ts        COPY: title/body/subject per channel
  payment/  prescription/  lab/  staff/  subscription/
```

Policy and copy are separate files: they change for different reasons, by different
people, at different review bars. Email HTML stays in `htmltamplates/` (27 large files),
referenced by name from `messages.ts`.

Entry shape:

```ts
'appointment.created': {
  aliases: ['appointment_created'],
  label: 'Appointment Created',
  category: 'appointments',
  priority: 'normal',
  kind: 'notification',
  configurable: true,
  defaults: { inApp: true, push: true },
  channels: ['inApp', 'push', 'sms', 'whatsapp'],
  recipients: (ctx) => [ctx.doctorId, ctx.receptionistId, ctx.patientId],
  clickAction: (ctx) => ({ route: '/appointments/:id', params: { id: ctx.appointmentId } }),
  message: { inApp: …, email: …, sms: …, whatsapp: … },
}
```

Context is resolved **at send time**, not enqueue time — a reminder firing hours later
may target a reassigned doctor. (`appointmentParticipants.model.ts` already does this
correctly; it just needs to move behind `DirectoryPort`.)

---

## 7b. Where the Code Lives (inside vs outside the module)

~80% of the work is inside `main/notifications/`. The outside surface is bounded and
mostly one-line call-site swaps.

**Inside** — `registry/`, `ports/`, `queues/`, `providers/`, `services/`, `models/`.
Three files **move in** from `src/utils/`: `notificationHelpers.ts` (dissolved into
registry entries), `notification.utils.ts` (→ `services/dispatch.service.ts`),
`notificationPreferences.{utils,constants}.ts` (→ `preferences/`).

**Outside** — unavoidable:

| Location | Change |
|---|---|
| ~12 service/controller files | ~25 call sites swap `notifyXxx(...)` → `notify('event', ctx)` — the only permanent outside surface |
| `socket/socketManager.ts` | `join` ACL fix (transport security, not notification logic) |
| `main/realtime/utils/sections.ts` | add payment + prescription targets |
| `app.ts` | wire the worker; later unwire Kafka |
| `kafka/` | deleted in Phase 9 |
| `utils/email.ts`, `utils/smsClient.ts` | become adapters called only by providers |
| `main/settings/` | preference endpoints read from the registry |
| `cron/jobs/` | retention job |
| FE repo | `pages/notification/`, `pages/notification-settings/`, `redux/api/`, hooks |

## 7c. Future Microservice Extraction

Not to be built now — one team, one DB, one deployment. But the boundary is kept
service-shaped so extraction stays mechanical. When the time comes:

- [ ] Move `main/notifications/` + registry to its own package
- [ ] Move the `notifications` table (and optionally the preferences column)
- [ ] Implement `DirectoryPort` as an HTTP client against the main API
- [ ] Swap the socket provider to `@socket.io/redis-emitter` (works because the
      Socket.io Redis adapter is already in use)
- [ ] Deploy the worker as its own container; the app keeps calling `notificationQueue.add()`

Prerequisite carried through every phase: **`notifications.user_id` must not keep its
`onDelete: cascade` FK to `users`** if extraction is ever intended — a separate service
cannot hold that constraint. Decide before the table grows.

## 8. Standing Rules

1. **Current in-app notifications are switched OFF before any other work** (Phase 0, Step 0),
   scoped so functional flows — patient SMS/WhatsApp, the manual-prescription OTP push,
   billing and security mail — keep running. Every later phase then turns a dark feature
   on rather than altering a live one.
2. **Stop at the end of every phase.** Each phase ends with a review checkpoint: report what
   landed, tick the boxes in this doc, add a Progress Log row, and wait for sign-off before
   starting the next phase. No phase begins while the previous one is unreviewed.
3. **This document is part of the change, not a report about it.** Every piece of work
   updates it in the same breath: tick the boxes, add a Progress Log row, and record any
   decision that was made differently from the plan *and why*. A change that is not
   reflected here did not happen as far as the next session is concerned — that is the
   whole point of a checklist that outlives the conversation.
4. **Do not commit directly.** Implement, typecheck, report — the commit is the author's
   call, not the agent's. (Phase 0's three commits predate this rule.)
5. **Ping the client before testing appointment notifications**, and whenever a new event is
   added, record it in §4 and in the module's Phase section here. Appointment notifications
   touch live clinic workflow, so a test run is not something to spring on them.
6. Nothing shared is deleted until its replacement is proven — Phase 9 is last, always.
7. Every module ships behind a flag; recipient trimming is user-visible and must be reversible.
8. No cross-module Drizzle imports inside `main/notifications/` — use a port.
9. Outside the module, the only import is `notify()`.
10. Do not run the Jest suite locally (it hangs this machine) — hand the command to the user.
11. **In-app notifications only (client instruction, 2026-08-24).** *Lifted for WhatsApp
    only on 2026-09-23 (author), for the Phase 8 migration. It still holds for email and SMS.* Work stays on the in-app
    path — the `notifications` table, the bell, the socket emit, preferences and the registry
    entries that feed them. **Do not touch the other channels**: email, SMS, WhatsApp and push
    keep behaving exactly as they do today. Where a change would otherwise reach them, scope it
    to in-app and say so — the silent-drop fix is the pattern: a failed INSERT cancels the socket
    emit and nothing else, because a database blip must not also silence a patient's WhatsApp
    message.
12. Typecheck is a pre-commit gate, not a per-edit step. **Capture `tsc`'s own exit code** —
    `npm run typecheck | tail` reports *tail's* status, so a failing build reads as exit 0.
    Redirect to a file and check `$?`. This masked a real `TS2769` error once, and would
    have masked a patch that silently never applied (a `cd` in a compound command failed and
    `&&` short-circuited the edit).

---

## 9. What's Left, In Order

Consolidated 2026-08-30. The per-phase checklists above stay the detail; this is the
running order, so a session resuming here does not have to reconstruct it from ticked
boxes. Update it in the same breath as the boxes.

### Blocking Phase 2 sign-off — no code

1. **Client runs the end-to-end appointment walkthrough** (§"Phase 1 — End-to-end
   verification", Standing Rule 5). Theirs to run, not ours to spring on them
2. **Author sign-off on Phase 2.** Standing Rule 2 holds Phase 3 shut until this happens

### Decisions waiting on a person

3. **Per-event toggle UI** — the settings screen has none. `handleToggleEvent`,
   `handleSavePreferences` and the grouped `eventsByCategory` are all live in the hook and
   the catalogue now feeds them, but nothing renders it. Rebuild the section, or drop the
   grouping? A design call, not a wiring fix — see the last item in §2c
4. **`user_created` welcome notification** — keep or drop (Phase 7)
5. **`notifications.user_id` cascade FK** — must go before the table grows if extraction is
   ever intended (§7c). Decide early, not at extraction time

### Needs a real database

6. Measure existing `notifications` row counts (Phase 0)
7. Backfill existing rows: `metadata->>'action'` → category/kind, unknown → `system`
8. "Zero the bell" per §6's archive-and-classify procedure — archive first, classify,
   never purge wholesale

### Then, in phase order

9. **Phase 3** — appointment & queue: recipient trimming via `StaffScopeService`, plus the
   two events that do not exist yet (`queue.patient_sent_in`, `consultation.completed`),
   behind `NOTIFY_STRICT_RECIPIENTS_APPOINTMENT`
10. **Phases 4, 5 and 6 — DEFERRED 2026-08-30** (prescription, payments, lab). Skipped for the
    current run at the author's instruction; see the note at the head of each. Their registry
    entries already exist, so resuming is not restarting. The cost while they sit: appointment
    notifications are recipient-trimmed and these are not, which users experience as the same
    clinic behaving two different ways
11. ~~**Phase 7** — staff~~ — **closed 2026-08-30, no code required.** · **Phase 8** —
    subscription/system, behind its own flag
12. **Phase 9** — removal, gated and last (**note:** it cannot fully close while the deferred
    modules' legacy helpers still have live call sites): Kafka out, legacy helpers deleted, the 4 dead
    settings columns deprecated (not dropped)

### Housekeeping

- Four commits sit unpushed: `5b35a901`, `d0c701f7`, `d96bc98c` (BE) and `4720f679` (FE)
- Root `CLAUDE.md` documents Swagger UI at `/api-docs`; it is served at **`/api/api-docs`**
  (`app.ts:134`)
- Local dev `.env` has both notification flags **on**, unlike every deployed environment
- `pages/notification/Notification.tsx` is orphaned — no import, no route — kept under
  Standing Rule 6 until the replacement is proven against a live environment

---

## 10. Progress Log

| Date | Phase | What landed |
|---|---|---|
| 2026-09-23 | 8 | **WhatsApp W1: registry WhatsApp path built, unused.** Added the event-level `whatsapp` spec. `deliverWhatsApp` now runs first and apart from the bell, with a retry-safe outbox job id and the `WHATSAPP_VIA_REGISTRY` per-template switch. The dead per-audience field is gone. Standing Rule 11 was lifted for WhatsApp only by the author. Tests: new file 4/4, contract 267/267, dispatch rules 12/12. Lint clean. **No behaviour change:** no event declares WhatsApp and the switch is empty. Not exercised against a running server, since W1 has nothing live to send. Stopped for review before W2 (Standing Rule 2). |
| 2026-09-23 | 8 | **WhatsApp migration W0: checks done, stopped before code (Standing Rule 2).** The prerequisite is met: the registry flag is hard-coded on (`323eb90e`, on main and staging). But mapping templates onto the existing events is **not** parity-safe, for five reasons recorded under Phase 8: booked vs `appointment.created` trigger mismatch, performer exclusion, WhatsApp nested inside the bell path, reschedule's pre-commit read, and no-show's settings-row rule. **Moves:** booked (new WhatsApp-only event), rescheduled, no-show. **Stays:** appointmentCompleted (no matching event), labReportReady (lab-tenant, own trigger), labPaymentReceived (no event), reminder and follow-up (time-triggered), pharmacyInvoice (not an event). **No code changed; all nine templates send exactly as before.** Waiting on: client lifting Standing Rule 11 for WhatsApp, and sign-off on the revised W1–W3. |
| 2026-08-30 | 8/9 | **WhatsApp delivery from the registry: mechanism kept, wiring backed out.** Built `getUserMobiles()`, `deliverWhatsApp()` and a typed `WhatsAppMessage`, then wired `appointmentBooked` and `appointmentRescheduled` onto their events — and backed both out on realising each would send **twice**. The legacy senders fire regardless of any flag; the registry path fires only when `NOTIFICATIONS_REGISTRY_ENABLED` is on. So there is no safe move while that flag is off: declaring the channel duplicates, deleting the legacy call silences. **The prerequisite is the registry flag being permanently on in production** — until then WhatsApp cannot migrate, and neither can the legacy helpers Phase 9 wants deleted. Recorded because the wiring looks obviously safe and is not. Three of the nine templates do not fit the registry shape at all: reminders and follow-ups are time-triggered rather than event-triggered, and the pharmacy invoice is not an appointment event — those need a scheduled-event concept that does not exist. Typecheck 0, parity 0 mismatches, **no legacy code touched: all nine templates send exactly as before**. |
| 2026-08-30 | 3 | **`queue.patient_sent_in` removed at the author's request**, hours after it was built. Registry entry, the `notify()` call in `queue.service.ts` and the now-unused `treatingDoctor` recipient all gone; the **bus signal of the same name stays** — it predates this work and is what refreshes the queue boards, so removing it would have broken the board refresh rather than the notification. Registry back to 20 events, parity 0 mismatches, docs regenerated. **§4 of the brief still requires this notification**, so the requirement is marked `[!]` rather than dropped. |
| 2026-08-30 | **9 — Kafka removed** | **Kafka is gone: `src/kafka/` deleted, wiring out of `app.ts`, services and volumes out of all three compose files, `kafkajs` off `package.json` and the lockfile.** The investigation reversed A3's premise. A3 held that Kafka carried no unique load because its topics were socket relays the Redis adapter already handled — true of 7 of the 8 publishes, which emitted directly *and then* published for other nodes, and false of the one that mattered: **chat had no direct emit at all**, so it depended entirely on the Kafka round trip and silently reached nobody whenever the broker was down. Chat now emits through the adapter like everything else. Gate 2 resolved by tracing rooms rather than assuming: the frontend joins only `user:{userId}`, so `queueBroadcast.service.ts:163` feeds the patient hook and `broadcastAppointmentChange` (clinic rooms) does not. Typecheck exit 0, parity 0 mismatches, app boots clean with no Kafka warning, compose files valid. **The helper deletion stays blocked** — those files send live patient WhatsApp/SMS/email, and removing them is invisible to every automated check. |
| 2026-08-30 | **3 — verified** | **Phase 3 tested against a running app and reported successful by the author**, closing its last open item. Scenarios S1–S8 (`NOTIFICATION_TEST_PLAN.md` §2b) cover both new events, the performer-exclusion rules, the reversible recipient trim, push delivery, and the manual renewal reminder. Getting there needed a Redis fix first: `.env` had been pointed at the local docker Redis on `localhost:6380`, but the user is not in the `docker` group, so compose failed with `permission denied on /var/run/docker.sock`, `npm run dev` logged "Docker not running, skipping…" and continued with no Redis — ioredis then exhausted its 20 retries and a BullMQ worker crashed the process. Switched back to the hosted Redis; boot clean, 0 `ECONNREFUSED`. **Worth remembering: without Redis every scenario passes by producing silence**, since `notify()` enqueues into nothing — which is why §2b opens by insisting the flags and Redis are confirmed before an empty inbox is read as a result. |
| 2026-08-30 | **9 (safe items only)** | **The two non-destructive Phase 9 items, deliberately taken without the gates.** `notificationPreferences.constants/.utils` (and their test) moved into `main/notifications/preferences/`, closing an A5 violation — the module had been reaching into `src/utils/` for its own preference resolution. The four dead settings columns are now `@deprecated` in the model, not dropped. Both were chosen precisely because they delete nothing: the other five Phase 9 items remove the legacy helpers that are still the flag-off path for all 21 events, so deleting them turns `NOTIFICATIONS_REGISTRY_ENABLED=false` from a revert into "no notifications at all", and every flag built this session assumes that path exists. Typecheck exit 0, parity 0 mismatches, ESLint clean. |
| 2026-08-30 | **8 (partial)** | **Push delivery on the registry path — a rollout blocker, found by reading what the dispatcher did with the preference it fetched.** It read `prefs[i].push` and threw it away: the registry path sent no push at all, while the legacy path did and settings kept showing a push toggle for all 21 events. Enabling `NOTIFICATIONS_REGISTRY_ENABLED` would have silently ended push for every migrated event — including the Phase 3 work, which only takes effect with that flag on. Now sent after the insert, activity excluded, errors swallowed per recipient, inline rather than a second queue job, and gated on the kill switch (a documented asymmetry with the in-app insert beside it — see Phase 8). Also found while checking the "renewal reminders → System" item: `sendReminderToClinic()`, the admin-triggered reminder, had never been migrated and was still writing a second uncollapsed warning through the legacy helper. Migrated. Typecheck exit 0, parity 0 mismatches. **Email stays blocked on Standing Rule 11** — the client's call. |
| 2026-08-30 | **7 — closed, no code** | **Phase 7 was already done; closing it took an audit and a decision.** Both build items landed in Phase 1: the 8 staff-action alerts are `kind='activity'` with distinct keys. Verified at the call sites rather than in the registry, because the failure mode runs the other way — `notifyClinicAdminsOfStaffAction` takes the registry path only when the flag **and** an `eventKey` are present, so a site that omits the key keeps using the legacy clinic-wide fan-out with nothing to show for it. All 8 pass a key. (One reports as missing to a literal-only grep: `doctor.controller.ts` builds its payload as a variable. Checked before concluding.) **`user_created` welcome: keep** — it is the only notification a new account receives and the only pointer to notification settings; the reason to reconsider it disappeared once the audit events stopped sharing its key. Third phase running where re-reading the code found the listed work already complete — the checklist is describing Phase 1's intentions, not the current tree. |
| 2026-08-30 | **3** | **Phase 3 implementation: the flag that makes trimming reversible, and the two missing events.** Re-reading the code first changed the plan: `appointment.created/.cancelled/.rescheduled` were **already** resolving through staff scope, so the three migration items were done — while the thing actually missing was the revert path, since trimming happened unconditionally whenever the registry was on. `NOTIFY_STRICT_RECIPIENTS_APPOINTMENT` now switches `appointmentStaff` between the narrow and legacy-wide recipient sets. Both new events built (`registry/appointment/queueEvents.ts`) and wired: `queue.patient_sent_in` at the existing queue signal, firing only when someone other than the doctor moved the patient; `consultation.completed` on the existing `statusChanged` check in `updateAppointment`. **Both call sites gated on `NOTIFICATIONS_REGISTRY_ENABLED`** — `notify()` enqueues unconditionally and only the legacy helpers check the flag, so a new event with no legacy path would otherwise ship live. Registry now 21 events; parity **0 mismatches**; catalogue shows Doctor 10, Receptionist 8, Admin 17, Patient unchanged at 8; `notifications:docs` regenerated. Bus-sync verification still needs a running app with the flag on. |
| 2026-08-30 | **2 — SIGNED OFF** | **Phase 2 signed off by the author**, satisfying Standing Rule 2 so Phase 3 may begin. The client's end-to-end appointment walkthrough is **still outstanding** and remains tracked in §9 — it was not a precondition of this sign-off, and Phase 3 ships behind `NOTIFY_STRICT_RECIPIENTS_APPOINTMENT` (default off), so the walkthrough can run against the branch in parallel without seeing Phase 3 behaviour. Phases 4, 5 and 6 deferred at the same time; Phase 3 is followed by 7, then 8, then a partial 9. |
| 2026-08-30 | **2 — verified** | **`/events` exercised end to end against the running app, as Super_Admin.** HTTP 200 returning **17 events across 5 categories — exactly what the static probe predicted** (appointments 5, payments 1, lab 2, staff 7, system 2), which confirms the Admin-inheritance merge works through the real auth path and not just in isolation. Two further checks while a live token was in hand: every field the frontend's `CatalogEvent` type declares is present with **nothing extra**, so the contract matches on both sides; and live parity against `GET /settings/notification-preferences/defaults` for the same user — **17 catalogue keys against 17 preference keys, no row without a default, no default without a row, and no value disagreement on any channel.** The static cross-check is therefore confirmed by the running system. Logged in with the seeded superadmin from `.env` at the author's instruction; the token was never printed and its scratch file was deleted afterwards. |
| 2026-08-30 | 2 | **First run against a live server — two doc-layer facts corrected.** The catalogue endpoint had only ever been exercised by calling its function directly, so the branch was booted with the freshly migrated dev DB. `/events` returns **401 without a token and 401 with a bad one** — reachable, auth-gated, and correctly ordered ahead of the `/:notificationId` matchers. Fetching the running spec then showed the response examples added an hour earlier were **silently discarded**: `responseExample` is declared on `EndpointDoc` but no consumer reads it. Replaced with Zod `responseSchema`s, and re-checked against the running server rather than the source: all 13 notification paths render in the generated OpenAPI, with 200-response schemas on exactly the three intended. Also noted: Swagger UI is served at **`/api/api-docs`**, not the `/api-docs` the root `CLAUDE.md` documents (`app.ts:134`). Still unverified: the authenticated payload, which needs a real login. |
| 2026-08-30 | **2a — closed** | **Swagger entries for the five Notification Center routes.** `/inbox` and `/unread-count` carry response examples, since neither shape is self-evident — the keyset cursor is opaque, and the count endpoint mixes a bounded badge with exact per-category numbers. Checked by diffing the router's own `router.get/put/...` registrations against the documented paths rather than by eye: 12 routes, 12 entries, nothing undocumented and nothing documenting a route that does not exist. Phase 2 is now code-complete; the local dev DB was migrated to the post-merge schema by the author beforehand, so the remaining verification needs only a running app. |
| 2026-08-30 | 2c | **Event catalogue endpoint — A8 closed.** `GET /api/v1/notifications/events` serves the My Notifications rows from the registry, scoped to the caller's role, and the frontend's hardcoded `NOTIFICATION_EVENTS` array is deleted; adding a registry entry is now the whole job of adding an event to settings. The old array had 11 events against the registry's 18 and its own category vocabulary (`laboratory`/`documents`/`accounts` vs the enum's `lab`/`prescription`/`staff`) — the drift A8 was written to end. Two corrections came out of verifying rather than assuming: the row key must be the legacy preference key or every saved mute is silently lost, and Super_Admin needs the Admin merge `getRoleDefaults()` performs (it returned 1 event instead of 17 without it). Catalogue cross-checked against `getRoleDefaults()` across all six roles — rows and defaults agree both ways, the only difference being the already-documented `Doctor:pdf_ready` drop. BE `tsc --noEmit` exit 0, FE `tsc -b` exit 0, ESLint clean on every changed file (the BE's 2 repo-wide lint errors are pre-existing, in `notification.queue.ts` and `generateNotificationDocs.ts`). Committed at the author's instruction: `5b35a901` (BE) and `4720f679` (FE), **unpushed**. |
| 2026-08-30 | — | **Both repos merged up to `staging`** (BE 41 commits, FE 64) and pushed. One conflict, in `Header.tsx`: staging had added client-side click-route resolution (`resolveNotificationRoute`, `getAppointmentIdFromNotification`, `debugSafeParseMeta`, a `UiNotification` type) into the exact block 2c had emptied. Resolved in favour of the branch and the four dropped — nothing else referenced them, and keeping them would reinstate the FE switch statement that server-resolved `click_route` exists to delete. Verified after merging that the things staging touched silently were still intact: `mayJoinRoom()` / `getUserClinicIds()` in `socketManager.ts`, and the three `PERMISSION_KEYS` the registry uses. BE `tsc --noEmit` exit 0; FE build (`tsc -b` + vite) exit 0 via the pre-commit hook. **Note:** staging brought migrations 0023–0025 (doctor arrival, per-session slot config, missed-slot dismissal, clinic-phone rename), so the local dev DB is behind the merged schema — `db:migrations:dev` + `db:migrate:dev` needed before the BE runs locally. |
| 2026-08-30 | 2c | **Status reconciled with the code.** The 2c boxes were all still unticked while commit `d547ebfc` (2026-08-25) had in fact shipped most of the section — recorded now per Standing Rule 3. Done: the 9-tab Notification Center with URL-held tab state, action-required pinning across every tab, server-resolved click-through, the Activity tab, the real unread badge, and the routed staff page. 2b's last two items closed with it: the socket is now an invalidation signal, and `notificationSlice` + `useSocketNotifications` are deleted. **Still open in 2c: the events endpoint** so notification settings stops hand-maintaining `NOTIFICATION_EVENTS` — plus 2a's Swagger entries. Old `pages/notification/Notification.tsx` is orphaned but deliberately left on disk (Standing Rule 6). |
| 2026-08-24 | **2b** | **FE data layer: `notificationApi` RTK Query slice** (inbox, unread counts, bulk mark-read, mark-all-read, delete) registered in `apiRoot.ts`, with types in `src/types/notification/`. Cursor pages merge in the cache keyed on filters-minus-cursor, and a cursorless request replaces instead of appending so a socket refresh cannot duplicate the list. Backend gained `PUT /notifications/read-all`, which had existed only as a socket event. BE and FE typecheck clean, lint clean. Socket-as-invalidation and retiring the localStorage store move to 2c, since the bell consumes that slice today. |
| 2026-08-24 | 2a | **Ownership pushed into the service layer.** `markNotificationRead` and `deleteNotification` now take `userId` and scope the statement by it, rather than trusting callers to have checked — the arrangement that let the socket handler ship unscoped. Both controllers lose their separate ownership lookup and 404 on an empty result. Typecheck and lint clean. |
| 2026-08-24 | 2a | **Socket mark-read IDOR fixed.** `notification.mark_read` updated by id alone and returned the full row in its ack — any authenticated client could mark and read another user's notification. Now scoped through `markManyRead(user.id, [id])`. Found while answering how auth is enforced across the REST and socket paths; the REST handlers already checked ownership, the socket one did not, and the FE uses the socket. |
| 2026-08-24 | **2a** | **Phase 2 started; survey reframed it.** The FE notification store turned out to be localStorage fed only by sockets, with no API slice and no staff notification page — so the listed UI work needs a data layer under it, split into 2a/2b/2c. 2a landed: `GET /notifications/inbox` (keyset cursor + kind/category/actionRequired/unread filters), `GET /notifications/unread-count` (capped badge, exact per-category counts), `PUT /notifications/read` (bulk, user-scoped). Added beside the legacy array endpoints rather than replacing them, since mobile consumes those. Typecheck and lint clean. |
| 2026-08-24 | **1 — closed** | Last two items settled, both by confirmation rather than code: **D2 decided** (namespaced keys + `aliases: []`, already implemented and proven by `npm run notifications:parity` at 0 mismatches), and the auth/OTP emails confirmed untouched — email is out of scope under Standing Rule 11. BE typecheck clean across all nine changed files. Phase 1 is implementation-complete and awaiting sign-off; the end-to-end walkthrough is the client's to run. |
| 2026-08-24 | 1 | **All 5 remaining in-transaction notify call sites moved post-commit** (`patientsTest`, `appointmentTest`, `patient.service`, `noShow`, `doctor.controller`). Each wrote through the global `database` handle from inside a transaction, so a rollback could leave a notification for something that never happened. Two of them returned extra values from the transaction rather than re-querying; the doctor-controller one captures the alert inside and sends it after, since it is the staff audit trail. The approval email in that same transaction was deliberately left alone — different channel, Standing Rule 11. |
| 2026-08-24 | 1 | **Retention cron gated on `NOTIFICATIONS_INAPP_ENABLED`.** It was the only part of the rebuild running live, and the only part that deletes — nightly removal of read notifications over 90 days old, which is exactly what §6's archive-and-classify procedure is meant to handle first. Now skips with a log line while the flag is off. |
| 2026-08-24 | 1 | **Scope narrowed to in-app; channel migration moved to Phase 8.** Client instruction: touch nothing but the in-app notification path — email/SMS/WhatsApp/push stay as they are (now Standing Rule 11). "Migrate channels onto the queue" was double-booked with Phase 8's "Email path onto the queue" and blocks nothing in Phase 2, so it moves there rather than holding Phase 1 open. |
| 2026-08-24 | 1 (partial) | **Parity check got a runner.** `npm run notifications:parity` (`src/scripts/checkNotificationParity.ts`) calls `checkRoleDefaultsParity()` and exits 1 on a mismatch — the function had been sitting uncalled, so the recorded "0 mismatches" was a one-off manual run rather than something that stays true. Verified by running it: **0 mismatches**. Also logged, not fixed: the retention cron runs unflagged while everything else ships dark. |
| 2026-08-24 | 1 (partial) | **Cross-transaction write fixed.** `notifyAppointmentCreated` moved out of `createAppointment`'s transaction into the post-commit block that already handles the booking SMS/WhatsApp and the realtime signal — it wrote through the global `database` handle, so a rollback could leave a notification for an appointment that never existed and the socket fired before the row was visible. Its two `getUserById` lookups moved with it, shortening the transaction. Five other in-transaction notify call sites found and logged as a follow-up item rather than fixed blind. |
| 2026-08-24 | 1 (partial) | **Silent-drop on persist failure fixed.** Both legacy dispatch paths now cancel the in-app socket emit (and the Kafka publish) when the INSERT fails, instead of pushing a toast carrying `notificationId: null` that could never be marked read. Kept to the in-app channel only: email/SMS/WhatsApp/push do not depend on the row and must not be silenced by a database blip. The registry path was already correct by construction — it emits from the rows the insert returns. |
| 2026-08-23 | — | Review + plan complete. Branch `feat/notification-permissions` created (BE + FE). No code changes yet. |
| 2026-08-23 | — | **D1 resolved without a schema change** — `StaffScopeModel` / `StaffDoctorAssignmentModel` / `StaffScopeService` in `main/permissions/` already model staff↔doctor responsibility, with a reverse index. Coverage table updated: all 15 sections now reachable. Added A9 (entitlement = scope × permission). |
| 2026-08-24 | **1 — complete** | All 12 helpers shimmed, including the 8 staff-action call sites which now pass real event keys instead of a shared `user_created`. Transient queue-position pushes no longer persist (they were writing an inbox row per stale number). `no-restricted-imports` added as a **warning** — as an error it turned lint red for every existing caller, which is the migration itself, and trains people to ignore it; promote in Phase 9. De-blocking resolved architecturally rather than by editing 17 call sites: `notify()` is one Redis write that cannot throw. **Preference swap done and diffed — zero entries lost**, 4 dead-data changes that resolution overrides anyway, and 9 events now visible in settings that users were already receiving blind. Not committed, at the client's request. |
| 2026-08-24 | 1 (partial) | **Dev migration applied; SMS removed from appointment flows.** Migration 0008 applied to dev only (staging/prod untouched per instruction) and verified against `information_schema` — 8 columns, 3 indexes. `sendAppointmentNotification()` is now WhatsApp-only and `appointmentSmsReminder.service.ts` is deleted with all six call sites; appointment SMS had no DLT template, so it was an unregistered send path rather than a working channel. WhatsApp reminders verified to fire at the same points first, so patients keep their reminders. Query audit: 3 redundant `getUserById(doctorId)` lookups removed. |
| 2026-08-24 | 1 (partial) | **Registry complete — all 18 events.** Committed `c8076be2` (payment + prescription) and `4fd1b339` (lab). Staff and subscription registered: the 8 staff-action alerts became distinct `kind='activity'` entries — they had all shared `action: 'user_created'`, so muting the welcome notification would have silenced a clinic's whole financial audit trail. `clinic.created` is the first tenant-less event. Parity 0 mismatches across all 18. An SMS outbox was built and **reverted** — appointment SMS has no DLT template, so it is an unregistered send path rather than a channel worth queueing. Logged `[!]`: the generator does not reproduce `getRoleDefaults`' Super_Admin-inherits-Admin merge, which must be handled at the preference swap. |
| 2026-08-24 | 1 (partial) | **Appointment registry + audience refactor.** Committed `54877b29` (socket ACL), `a988f5d6` (queue + dispatcher), `1f0fc0dc` (appointment registry). Then a consistency review against the legacy appointment helpers found the registry sent one message to everyone, where the old code had distinct staff and patient copy — and an event-level `requiredPermission` would have dropped every patient notification, since patients hold no clinic permission. Contract restructured around `audiences[]` (own recipients, permission and wording each). Dispatch collapse-upsert now also refreshes `event_key`/`category`/`kind`; `type` carries the event key. Parity re-verified after the refactor. |
| 2026-08-23 | 1 (partial) | **Socket ACL fix + queue foundation.** `mayJoinRoom()` is now an allowlist (`user:` own id, `clinic:<uuid>` membership); everything else refused and logged. `getUserClinicIds()` extracted with a DB fallback and shared with the connect handler; `leave` restricted to held rooms. `notification.queue.ts` + `dispatch.service.ts` added, lazily constructed and not yet wired to anything. `REDIS_QUEUE_DB` added, default 0. Redis AOF found already enabled — no change. Typecheck clean. **Uncommitted.** |
| 2026-08-23 | 0 | **Schema + scaffolding.** `notifications` model extended (tenant pair, category, priority, kind, event_key, click route/params, collapse_key) with 3 new indexes and a CHECK on the tenant pair; dev migration 0008 generated, not applied. Registry contract (`registry/types.ts`, `defineEvents.ts`, `index.ts`) and ports (`DirectoryPort`, `EmitPort`) scaffolded, no entries yet. Convention fixes: `HttpError` in both handlers, bounded `getUnreadCount`, `.returning({ id })` on the two bulk ops. Keyset pagination moved to Phase 2. |
| 2026-08-23 | 0 · Step 0 | **Kill switch implemented and typechecked.** BE: `NOTIFICATIONS_INAPP_ENABLED` in `utils/envConfig.ts`; `main/notifications/killswitch/killSwitch.ts` (allowlist + `isLegacyInAppAllowed`); guards wired into `utils/notification.utils.ts` and `main/notifications/services/universalNotification.service.ts`. FE: `src/config/featureFlags.ts` + bell hidden in `components/shared/Header.tsx`, `vite-env.d.ts` typed. Both `.env.example` files documented. BE typecheck clean. Scope refined: push suppressed too (see Step 0). Not committed. |
| 2026-08-23 | — | Added Phase 0 **Step 0: switch current in-app notifications off first** (`NOTIFICATIONS_INAPP_ENABLED`), scoped via an allowlist so patient SMS/WhatsApp, the manual-prescription OTP push, billing and security mail keep working. Promoted to Standing Rule 1. |
| 2026-08-23 | — | Tenant column changed from `clinic_id` to `tenant_type` + `tenant_id` ahead of the planned lab/pharmacy separation. No FK — A5/§7c already forbids them for extractability, which removes the usual objection to a polymorphic tenant. |
| 2026-08-23 | — | Volume/scale pass. Added A10 (tenant `clinic_id`), A11 (no digest — activity feed is the digest), A12 (partitioning threshold, not built). Phase 0 migration fully specified incl. keyset pagination + bounded unread count. Phase 1 gained three data-integrity tasks: cross-transaction write, persist-regardless-of-preference, transient events never persisted. Quiet hours deferred to Phase 8. |
