# Super Admin Analytics Module

How the Super Admin backend is built and why. Written 2026-09-30.
Endpoint-by-endpoint request/response reference: [SUPERADMIN_ANALYTICS_API.md](./SUPERADMIN_ANALYTICS_API.md).

---

## 1. What it is

The backend for the Infinity Medisetu Super Admin: business figures across **all** clinics
(MRR, growth, usage, patient app), the clinic list and Clinic 360°, follow-up tasks, and
security views (audit log, login sessions).

It is **cross-clinic on purpose** and returns **counts only**: no patient names, contact
details, clinical data or prescription content, in any response or log.

Mounted at `/api/v1/superadmin-analytics` (auto-discovered by `loadRoutes`).

---

## 2. Architecture: a modular monolith

```
src/main/superadminAnalytics/          the module
  index.ts        public surface: the ONLY import other code may use
  ports/          what it needs from outside, as interfaces (no Drizzle)
  models/         tables it owns: followup_tasks, followup_notes
  services/       overview · revenue · growth · usage · patientApp · clinics ·
                  timeline · followups · access (audit + sessions)
  utils/          pure formulas: metrics, followupRules, period, device
  routes/ controllers/ schemas/ types/ __tests__/

src/adapters/superadminAnalytics/
  sourceData.adapter.ts   the ONLY code with SQL on other modules' tables
  platformFees.adapter.ts online booking fees, via the payment module's public index
```

**Boundary rules (must hold):**
1. Nothing inside the module imports another module's Drizzle model. Outside data comes in
   through `SourceDataPort`, implemented by the adapter and registered at boot in `app.ts`.
2. Nothing outside reaches into it except through `index.ts` (e.g. the cron calls
   `runFollowupRules()`).
3. The module owns `followup_tasks` and `followup_notes`; no other module reads or writes them.
4. Enforced by an ESLint `no-restricted-imports` group.

**Why:** extracting it into its own service later means swapping the adapter from SQL to HTTP
or a read replica. Screens and APIs stay the same.

---

## 3. Security

Every route has `requireAuth` then `requireSuperAdmin`, set per route (15 of 15).

- The role is read from the **database row** on every request, not the token, so an edited or
  stale token can't grant access. Blocked/Inactive/Rejected accounts are refused.
- Every query, param and body is validated with Zod (`schemas/`).
- Sign-out can only target clinic staff: the adapter query excludes `Patient` and
  `Super_Admin`, and each sign-out is logged with who did it.
- Sessions show device and IP only, never tokens.

Checked live 2026-09-30: every endpoint returns 401 with no token or a fake one.

---

## 4. Endpoints

| Method | Path | Service | Cached |
|---|---|---|---|
| GET | `/overview` | overview | 5 min (attention counts live) |
| GET | `/revenue` | revenue | 5 min |
| GET | `/growth` | growth | 5 min |
| GET | `/usage` | usage | 5 min |
| GET | `/patient-app` | patientApp | 5 min |
| GET | `/clinics` | clinics | no |
| GET | `/clinics/:clinicId` | clinics | no |
| GET | `/clinics/:clinicId/timeline` | timeline | no |
| GET | `/audit` | access | no |
| GET | `/sessions` | access | no |
| POST | `/sessions/:userId/sign-out` | access | — |
| GET | `/followups` | followups | no |
| GET | `/followups/:taskId` | followups | no |
| PATCH | `/followups/:taskId` | followups | — |
| POST | `/followups/run` | followups | — |
| GET | `/platform-fees` (?clinicId) | platformFees | no |
| PUT | `/platform-fees` | platformFees | — |
| POST | `/platform-fees/preview` | platformFees | — |
| GET | `/platform-fees/history` (?clinicId) | platformFees | no |
| DELETE | `/platform-fees/clinics/:clinicId` | platformFees | — |
| GET | `/payout-accounts` (?page&pageSize&state&q&clinicId) | payoutAccounts | no (paged in SQL) |

Date-range endpoints take `from`/`to` (IST days) and return the matching previous period for trends.

- **Revenue booking fees** come from `money_entries` (convenience fee + commission = Medisetu's earning; GST and gateway fee shown as passed on), the same ledger clinic Finance reads. Not from `appointment_payments.platform_commission`.
- **Payout accounts** list every live clinic with a plain state (`utils/payoutState.utils.ts`) and the masked bank only; never PAN or full account numbers.

---

## 5. Caching

- The five dashboard endpoints use `getOrSetCache` with keys from `CacheKeys`
  (`superadmin:<name>:<from>:<to>`), TTL **300 s**. A few minutes' lag is fine for business
  figures, so nothing invalidates them.
- Overview's "Needs attention" counts are read live, outside the cache, so resolving a task
  lowers the number at once.
- If Redis is down, `getOrSetCache` logs and loads from the DB; pages still work.
- **When you change a cached response shape, clear its keys after deploy**
  (`superadmin:usage:*` etc.), or old entries miss the new fields for up to 5 minutes.

---

## 6. Timestamp frames (the main trap)

| Column | Holds |
|---|---|
| DB-default columns: `clinics.created_at`, `users.created_at`, `refresh_tokens.created_at`, `user_devices.created_at` | IST wall-clock time |
| App-written: `clinic_subscriptions.starts_at/expires_at`, `refresh_tokens.expires_at` | UTC |
| `appointments.appointment_date` | IST wall-clock; bound with text like `'2026-09-01 00:00:00'` |

- The adapter shifts UTC spans onto the IST clock with `utcToStored` (+5h30), and uses
  `storedNow()` for "now" on zone-less columns.
- Compare UTC columns with `now() AT TIME ZONE 'UTC'`, never a bare `now()`.
- Test rows must be written the way the app writes them (UTC), not with SQL `now()`.

---

## 7. Metrics (all in `utils/metrics.utils.ts`, pure and tested)

**Clinic stage** (`CLINIC_STAGES`): Registered → SetupDone → FirstValue → Active → Declining / Dormant → Churned.
Exact rules are in the Definitions table of the API reference.

| Constant | Value | Meaning |
|---|---|---|
| `ACTIVE_MIN_DAYS` | 4 | Distinct days with appointments (last 30) to count as Active |
| `DORMANT_AFTER_DAYS` | 14 | No activity for this long = Dormant |
| `CHURNED_AFTER_DAYS` | 60 | No activity for this long = Churned |
| `DECLINE_DROP_RATIO` | 0.5 | Appointments fell to half or less of the previous 30 days |

- **Paid** = `payment_status` in (`success`, `paid`); yearly plans are detected with
  `isYearlyProviderId()` and counted as price ÷ 12 in MRR. Booking fees are excluded.
- **MRR bridge:** each clinic's MRR at period start vs end, so opening + new + expansion −
  contraction − churn = closing **by construction**.
- **Collected** = subscription payments + platform commission. It is NOT a clinic's patient
  revenue (`RECEIVED_AMOUNT`).
- UI names: Signed up · Finished setup · First visit completed · Using regularly · On a paid plan.
  Never "paying" or "first value" in UI copy.

---

## 8. Follow-ups

**Tables (owned):** `followup_tasks` (one open task per clinic per problem, enforced by a
partial unique index) and `followup_notes` (append-only history).

**Rules** (`utils/followupRules.utils.ts`, pure, run by `FollowupsService.runRules()`):

| Type | Opens when | Priority |
|---|---|---|
| `setup_stuck` | Signed up ≥ 3 days, setup not finished | Medium |
| `no_first_value` | Setup done and approved, no completed appointment after 7 days | Medium |
| `usage_drop` | Stage Declining | High if paid, else Medium |
| `dormant` | No activity ≥ 14 days | High if paid, else Medium |
| `churn_risk` | No activity ≥ 60 days | High if paid, else Low |
| `trial_ending` | Trial ends within 3 days, not paid | High |
| `payout_blocked` | Payout account is Action Needed or Suspended. `payoutCause()` names the cause (`bank_locked`, `bank_details`, `documents`, `suspended`, `rejected`, `other`); the reason says who acts, `triggerData` keeps Razorpay's words, days waiting and the linked account id | High |

- Runs nightly at **2:30 AM IST** (`cron/jobs/followupRules.cron.ts`), and on demand via
  `POST /followups/run`. Idempotent: a rerun updates open tasks, never duplicates them.
- A task closes by itself when the problem clears. One closed by a person is not reopened for
  **30 days** (`FOLLOWUP_COOLDOWN_DAYS`).
- Rejected and Blocked clinics are skipped.
- `payout_blocked` closes when the account turns Ready; Super Admins also get an in-app alert at once (`payment.payout_action_needed`). Only Razorpay support can unlock a locked account; the drawer copies a ready support request.

---

## 9. Security views

**Audit log** (`GET /audit`) reads `audit_log` across clinics. The log itself is written by
the audit module, not this one:

- `middlewear/auditLog.middleware.ts` skips reads, and records only 2xx responses on routes
  listed in `audit/utils/trackedActions.utils.ts`, **after the response is sent**.
- `AuditLogService.record()` only queues the entry (with the action's own timestamp). The queue
  is written in **one multi-row insert** every **10 s** or at **200** entries; missing clinics
  are resolved for the whole batch in at most 2 queries. The queue is capped at 5,000 and
  flushed on SIGINT/SIGTERM. A hard crash can lose up to the last 10 s.
- Entries hold ids only; the nightly purge keeps **90 days**.

**Login sessions** (`GET /sessions`) reads `refresh_tokens`: one row per user per platform,
staff only. Apps sign in as `android`/`ios`, so "mobile" = anything not `web`.

**Sign-out everywhere** (`POST /sessions/:userId/sign-out`) reuses the password-change cut-off:
delete the user's refresh tokens, then set Redis `user:password_changed_at:<id>` to now+1 s
(TTL 30 days). `requireAuth` and the socket auth reject tokens issued before it.

---

## 10. Adding an endpoint

1. Outside data? Add a method to `ports/sourceData.port.ts` and implement it in the adapter.
2. Formula? Put it in `utils/` as a pure function and test it in `__tests__/`.
3. Service in `services/` (under ~800 lines; split by use case).
4. Zod schema in `schemas/`, thin controller, route with `requireAuth, requireSuperAdmin`
   and an `apiDocs` entry.
5. Heavy read? Cache it with a named `CacheKeys` entry and a TTL.
6. Counts only; no patient identifiers in the response or logs.

**Tests:** `__tests__/metrics.utils.test.ts`, `followupRules.utils.test.ts`,
`device.utils.test.ts`; audit batching in `main/audit/__tests__/auditLog.batch.test.ts`.

---

## 11. Known limits

- The "before → after" column in the audit log is not built (needs a migration and middleware work).
- Patient app DAU/MAU and app-version spread need the mobile app to send `last_seen_at` / `app_version`.
- Requests has no sidebar count: its API loads every clinic; a count needs its own endpoint.
- No rate limit on sign-out or "Check now" (Super Admin only, low risk).
