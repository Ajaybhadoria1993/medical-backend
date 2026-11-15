# Credits Module — Implementation Plan (messaging first)

Status: **plan, awaiting approval to start step 1.** Written 2026-10-05, branch `feat/whatsapp-credits`.
Product plan and decisions: `WHATSAPP_QUOTA_PLAN.md`. Rules: [BACKEND_STANDARDS.md](../playbook/BACKEND_STANDARDS.md), [WORKFLOW.md](../../../WORKFLOW.md).

---

## 0. Scope of this phase

| In now | On hold (later phase) |
|---|---|
| Free messages per plan, counted per clinic per billing month | **Clinics buying credits** (packs, Razorpay, webhook) |
| Credits **granted and removed by Super Admin** | Per-plan "can buy credits" toggle |
| Oldest-first use, expiry, reminders | Purchase entries in the billing timeline |
| Real cost per message from Meta | |
| Versioned Super Admin settings, clinic credits, cost report | |

**The subscription module is not touched.** No file under `src/main/subscription/` changes, no seed row is added to its tables, and no subscription screen changes. The module only **reads** plan data through an adapter (§1).

## 1. Shape: one new module, modular monolith

Copies the pattern of `superadminAnalytics` ([SUPERADMIN_MODULE.md](../superadmin/SUPERADMIN_MODULE.md) §2).

```
src/main/credits/                   the module (mounted at /api/v1/credits)
  index.ts        public surface — the ONLY import other code may use
  ports/          what it needs from outside, as interfaces (no Drizzle)
    plan.port.ts      free-message limit + billing period per clinic (read only)
    notify.port.ts    send warning / paused / expiry alerts (adapter calls notify())
    index.ts          register/get, throws if used before boot registration
  models/         3 tables it owns (§2) — no other module reads or writes them
  services/
    core/         shared by every credit type: settings · grants · expiry · billing period · allowance
    messaging/    messaging only: messageLog · deliveryCost · alerts · costReport
  utils/          pure: billingPeriod · cost · thresholds · creditTypes (the list of valid types)
  routes/v1/      credits.route.ts (clinic) · superadmin.route.ts (Super Admin, /api/v1/credits/superadmin)
  controllers/ schemas/ types/ __tests__/

src/adapters/credits/
  plan.adapter.ts      reads plan limit + subscription dates; calls existing functions, edits none
  notify.adapter.ts    calls notifications' notify()
  index.ts             initCreditsPorts(), called once in app.ts
```

**Boundary rules (must hold, ESLint-enforced like `superadminAnalytics`):**
1. Nothing inside the module imports another module's model. Outside data comes through `ports/`.
2. Nothing outside imports the module except through `index.ts`.
3. The module owns its tables; nobody else touches them.
4. Two ESLint `no-restricted-imports` groups added to `eslint.config`, same as the existing pair.
5. **No cycles.** Dependencies point one way only:

```
notifications ─┐
cron, app.ts ──┴──► credits/index.ts ──► ports/ (interfaces)
                                             ▲
                    src/adapters/credits ────┘ ──► reads: LimitationService.getClinicActivePlan / getPlanLimit,
                                                   clinic_subscriptions dates · calls: notify()
```

The adapter **reads** subscription data through functions that already exist; it changes nothing in that module.

### Public surface (`index.ts`)

| Function | Called by | Does |
|---|---|---|
| `checkSend(clinicId, channel)` | Outbox **worker**, just before calling Meta | `{ allowed, source: 'unlimited' \| 'plan' \| 'credit' }` or `{ allowed: false, reason }` |
| `recordSent({ clinicId, channel, messageId, templateKey })` | Outbox worker, after Meta 200 | Uses 1 free message or 1 credit, writes the message log row, fires the warning alert |
| `recordDeliveryStatus(messageId, pricing)` | WhatsApp webhook | Stores billable and real cost |
| `runCreditExpiryReminders()` | Daily cron | Expiry reminders, once per grant |
| `registerPlanPort`, `registerNotifyPort` | Adapter at boot | Port wiring |

**Credit types** are a fixed list in code (`utils/creditTypes.utils.ts`): `['whatsapp']`. Zod validates every `creditType` / `channel` against it. Adding `sms` later = one line here plus a settings row.

## 2. Data model — 3 tables (one migration, step 1)

Generated and applied by the repo owner (BE §7). **No existing table changes.** No name clashes: no `credit_*` or `messaging_*` table exists today.

**Conventions:** all timestamps are `timestamptz` written in UTC, like `audit_log` (most older tables are zone-less IST wall clock, WORKFLOW §6 — never compare the two without converting). Closed value sets are `pgEnum` (`source`, `paid_with`), as in 32 existing model files.

### 2.1 `credit_settings` — versioned settings, with a reason for every change

**Purpose:** every value Super Admin can change. A change never overwrites: it adds a new row. The row in force is the one with the latest `effective_from` that has started.

| Column | Type | Rules | Purpose |
|---|---|---|---|
| id | uuid | PK | |
| credit_type | varchar(30) | not null | `whatsapp` |
| expiry_days | integer | > 0 | Credit lifetime from the grant (seed 365) |
| reminder_days | integer | ≥ 0 | Days before expiry to remind; 0 = none (seed 7) |
| warn_percent | integer | 1–99 | Usage that triggers the warning (seed 80) |
| unit_cost_inr | numeric(10,4) | ≥ 0 | Meta's rate before tax (seed 0.1150) |
| tax_percent | numeric(5,2) | ≥ 0 | GST (seed 18.00) |
| effective_from | timestamptz | not null | When it starts; a future date schedules the change |
| changed_by | uuid | null only on the seeded defaults | Super Admin who made the change |
| reason | varchar(255) | not null | Why |
| created_at | timestamptz | default now | When it was entered |

Unique `(credit_type, effective_from)`, which also serves the "in force" lookup. Seed: one `whatsapp` row.

### 2.2 `credit_grants` — credits given to a clinic, and removals

**Purpose:** the clinic's balance and its permanent who/why history.

| Column | Type | Rules | Purpose |
|---|---|---|---|
| id | uuid | PK | |
| clinic_id | uuid | not null | Whose credits |
| credit_type | varchar(30) | not null | `whatsapp` |
| source | pgEnum | not null | `grant` · `removal` (`purchase` added with buying) |
| credits_total | integer | > 0 | Credits granted, or credits removed |
| credits_left | integer | 0 … total | Still usable (0 on a removal row) |
| granted_by | uuid | not null | Super Admin who did it |
| reason | varchar(255) | not null | Why |
| expires_at | timestamptz | not null | Grant: created + `expiry_days` in force. Removal: created time. |
| expiry_reminded_at | timestamptz | null | Reminder sent (only once) |
| created_at | timestamptz | default now | |

- **Balance** = sum of `credits_left` on grant rows not yet expired.
- **Removal** deducts from the grants (soonest-expiring first) and writes the removal row **in the same transaction**.
- Index: partial `(clinic_id, credit_type, expires_at) WHERE credits_left > 0`.

### 2.3 `messaging_message_log` — every message sent

**Purpose:** the **usage counter** (free messages used since the renewal date) and the **cost record**.

| Column | Type | Rules | Purpose |
|---|---|---|---|
| id | uuid | PK | |
| clinic_id | uuid | not null | Which clinic sent it |
| channel | varchar(30) | not null | `whatsapp` |
| message_id | varchar(128) | **unique** | Meta's ID; matches the delivery report |
| template_key | varchar(64) | not null | Which message (for the cost report) |
| paid_with | pgEnum | not null | `unlimited` · `plan` · `credit` |
| credit_grant_id | uuid | null, FK → `credit_grants.id` | The grant that paid, so a refund returns the credit to it |
| billable | boolean | null | Null until Meta reports; then whether we were charged |
| cost_inr | numeric(10,4) | null | Real cost incl. GST, from the settings in force at delivery |
| refunded_at | timestamptz | null | Set when Meta didn't charge us; the clinic gets the message back. Set once only. |
| sent_at | timestamptz | not null | When Meta accepted it |

Index: partial `(clinic_id, channel, sent_at) WHERE paid_with = 'plan' AND refunded_at IS NULL`, which serves the free-message count. No phone number or patient data.

### 2.4 How every movement is traced

| Movement | Recorded in |
|---|---|
| Super Admin grant | `credit_grants` grant row: who, why, how many, expiry |
| Super Admin removal | `credit_grants` removal row: who, why, how many |
| Use | Message log row (`paid_with = credit`, `credit_grant_id`) + lower `credits_left` |
| Give-back (Meta didn't charge) | `refunded_at` on the message row + `credits_left` back on that grant |
| Expiry | From `expires_at`; no row needed |
| Settings change | New `credit_settings` row: who, why, from when; old rows kept |
| Which rate priced a message | `credit_settings` in force at its delivery time |

### 2.5 Plan data (read only)

- Free messages per plan: the existing `whatsapp_messages_per_month` row, set on the existing Plan Limits page. Unchanged.
- A plan with no such row (e.g. a newly created plan) → **unlimited**, the existing behaviour, flagged "WhatsApp limit not set" in the Credits cost report.

## 3. Key rules in code

| Rule | Where | How |
|---|---|---|
| Billing period from renewal date | `utils/billingPeriod.utils.ts` (pure) | Anchor = active paid subscription start; else when the clinic moved to the free plan; else clinic creation. Monthly from the anchor day; day 29–31 clamps to month end. |
| Free messages used | `core/allowance` | `COUNT(*)` of `paid_with = 'plan'` rows not refunded since the period start, served by the index |
| **Give back what Meta didn't charge** | `messaging/messageLog` | On a `failed` status, or a report with `billable = false`: one transaction sets `refunded_at` (only where it is null, so a repeated report can't refund twice) and, if paid by credit, adds 1 back to `credit_grants.credits_left` of `credit_grant_id`. A free message stops counting. **A clinic pays only for messages Meta charges us for.** |
| Free first, then credits | `core/allowance` | Used < limit → plan; else balance > 0 → credit; else skip |
| Oldest credits first, race-safe | `core/grants` | `UPDATE … SET credits_left = credits_left - 1 WHERE id = (SELECT … ORDER BY expires_at LIMIT 1 FOR UPDATE)`. Plain `FOR UPDATE`, **not** `SKIP LOCKED`: with one grant row, a skipped lock reads as "no credits". |
| Check in the worker, record after send | outbox worker + `recordSent` | Checking at queue time would let a reminder batch pass before any is counted. In the worker the overshoot is at most 3 (worker concurrency). |
| `recordSent` never throws | `recordSent` | The message is already delivered; a thrown error makes BullMQ retry and **send it twice**. Catch, log at `error`, return. |
| Delivery report before the log row | `messaging/messageLog` | Unknown id → re-queue once after 30 s, then `warn`. |
| Removal | `core/grants` | One transaction: deduct across grants + removal row. Can't go below 0 (409). |
| Alerts once per period | `messaging/alerts` | Warning at `warn_percent`, paused alert when nothing is left. Redis `SET NX` on a `CacheKeys` key, TTL 35 days. Through the notify port. |
| Settings in force | `core/settings` | Latest row with `effective_from ≤ now`. Cached via `getOrSetCache` (`CacheKeys`, TTL 5 min, never past a scheduled `effective_from`); a new row invalidates after commit (BE §8.1). |
| Change settings | `core/settings` | Insert one row with `changed_by` + `reason` (Zod, 5–255 chars). `effective_from` defaults to now. |
| Tenancy | clinic routes | `clinicId` from the token only (BE §9). |

## 4. Files changed outside the module

| File | Change |
|---|---|
| `notifications/queues/whatsappOutbox.queue.ts` | Job carries `clinicId`. In `process()`: `checkSend` → skip, or call Meta → `recordSent`. |
| 10 WhatsApp senders: 6 `enqueueWhatsAppTemplate` callers + 4 via `sendAppointmentNotification` (prescription ×2, `notificationHelpers` ×2) | Pass `clinicId`. `enqueueWhatsAppTemplate` takes `{ clinicId, appointmentId?, jobId? }`; `clinicId` is a required key so every new caller decides. |
| `notifications/services/whatsapp.service.ts` | `sendTemplateMessage` returns Meta's message id. |
| `notifications/services/whatsappWebhook.service.ts` | Forward each status's `pricing` to `recordDeliveryStatus`. |
| `notifications` registry | Platform events: usage warning, paused, credits expiring. |
| `cron/index.ts` | Register the daily expiry-reminder job. |
| `app.ts` | `initCreditsPorts()` beside the existing two. |
| `eslint.config` | The two boundary groups. |
| **`src/main/subscription/**`** | **Nothing.** |

## 5. Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/credits/summary` | Admin | Free used / limit / reset date, credit balance and next expiry |
| GET | `/credits/grants` | Admin | The clinic's grants with credits left and expiry, paginated |
| GET | `/credits/superadmin/settings/:creditType` | Super_Admin | Settings in force + any scheduled change |
| GET | `/credits/superadmin/settings/:creditType/history` | Super_Admin | Every change: who, why, when, paginated |
| POST | `/credits/superadmin/settings/:creditType` | Super_Admin | New settings row: `{ expiryDays, reminderDays, warnPercent, unitCostInr, taxPercent, effectiveFrom?, reason }` |
| GET | `/credits/superadmin/clinics/:clinicId` | Super_Admin | Balance, grants and removals |
| POST | `/credits/superadmin/clinics/:clinicId/grant` | Super_Admin | `{ creditType, credits, reason }` |
| POST | `/credits/superadmin/clinics/:clinicId/remove` | Super_Admin | `{ creditType, credits, reason }` |
| GET | `/credits/superadmin/cost-report?from&to` | Super_Admin | Per clinic: messages, free vs credit, cost; plans with limit not set |

Every route: 2-line `@route`/`@access` header, `requireAuth` + `requireRole([...])`, Zod schema, `asyncHandler`, `sendOk`/`sendCreated`, `HttpError` (BE §3, §6).

## 6. Logging and records

| Need | Use |
|---|---|
| Debugging and operations | Shared `logger` (winston) |
| Where credits came from and where they went | `credit_grants` rows (grant, removal) |
| Each use and its cost | `messaging_message_log` |
| Settings history | `credit_settings` rows |

Not the audit log: it drops Super Admin actions, purges after 90 days and is best-effort (WORKFLOW §6).

| Event | Level | Fields | Never |
|---|---|---|---|
| Message skipped, nothing left | `info` | clinicId, channel, templateKey, periodStart | phone number, patient name |
| Credit used when free ran out (first per period) | `info` | clinicId, channel, balance | — |
| Grant / removal / settings change by Super Admin | `info` | clinicId or creditType, credits or fields changed, actorUserId | — |
| Delivery report for unknown message id | `warn` | messageId | webhook body |
| Unexpected failure in `recordSent` | `error` | clinicId, messageId, error message | — |
| Cron run | `info` | grants reminded | — |

## 7. Tests

In `src/main/credits/__tests__/`, **one file at a time** (BE §12).

| File | Covers |
|---|---|
| `billingPeriod.utils.test.ts` | Monthly / yearly anchor, 31st → month end, free-plan anchor, period boundary |
| `cost.utils.test.ts` | Unit cost × (1 + tax %); seeded values give ₹0.1357; billable vs not |
| `allowance.service.test.ts` | Unlimited; under limit → plan; over with credits → credit; nothing → skip; plan with no row → unlimited |
| `recordSent.test.ts` | DB failure logged and swallowed, no retry, nothing resent |
| `grants.service.test.ts` | Oldest first; expired ignored; two concurrent uses of a 1-credit grant → one succeeds, other falls to next; removal across grants + removal row in one transaction; below 0 → 409 |
| `settings.service.test.ts` | New row keeps old rows; reason required; a future `effective_from` applies at that time, not before; cost uses the settings in force at delivery; new expiry applies to new grants only; unknown credit type rejected |
| `alerts.service.test.ts` | Warning and paused once per period; new period fires again; changed `warn_percent` applies |
| `messageLog.service.test.ts` | Billable → cost; not billable → 0 and refunded; failed → refunded; credit-paid refund returns 1 to its grant; repeated failure report refunds once; refunded row stops counting; unknown id → re-queued once, then warn |
| `expiry.service.test.ts` | Reminder once per grant; rerun is a no-op |

Outside the module: `notifications/__tests__/dispatch.whatsapp.test.ts` (skipped when refused; `recordSent` once on success; capture the worker by queue name). Mock `realtimeBus` with `attach` (WORKFLOW §6).

## 8. Steps

| Step | Scope | Migration | Done when |
|---|---|---|---|
| **1. Counting** | Module skeleton, plan port + adapter, ESLint boundary, 3 models + `whatsapp` settings seed, `recordSent`, all 10 WhatsApp senders pass `clinicId`. (`checkSend` and the notify port arrive in step 2, where they are first used.) | **Yes — all 3 tables, once** | Every WhatsApp message writes a log row; plans still unlimited |
| **2. Limit + alerts** | Skip when nothing left, warning and paused alerts | No | Limit 3 → 4th skipped, booking saved, alerts once each |
| **3. Real cost + give-back** | Webhook → `recordDeliveryStatus`: store billable and cost; give back failed or not-billable messages | No | Delivered message shows ₹0.1357; a failed one is refunded once |
| **4. Credits** | Grants, removals, oldest-first use, expiry, reminder cron | No | Granted credits used after free runs out; removal recorded |
| **5. Super Admin API** | Settings (current, history, change with reason), clinic credits, grant / remove, cost report | No | Routes 401 / 403 for others; a settings change applies at once or on its date |
| **6. FE — clinic** | WhatsApp usage card on **Notification settings**, warning and paused banners | No | Browser: each state, keyboard pass, dark mode |
| **7. FE — Super Admin** | New **Credits** page (Settings with history · Cost report) and a **Credits tab in Clinic 360°** (grant / remove) | No | Browser: same |

Steps 1–5 backend, 6–7 frontend (FE reads `FRONTEND_STANDARDS.md` first; types in `src/types/credits/`, one API slice in `apiRoot.ts`).

## 9. Step outcomes and testing

**Who:** Dev (automated + API) · QA (you or a tester) · Business (Super Admin sign-off).
**Dev setup for steps 1–3:** `WHATSAPP_SENDING_ENABLED=true` in `.env`, a clinic whose patient number is your own phone. Signed webhook: [WHATSAPP_META_SETUP.md](../notifications/WHATSAPP_META_SETUP.md) §6.

| Step | What we achieve | How we test | Who |
|---|---|---|---|
| 1 | Every message recorded per clinic; nothing changes for clinics | Auto: billing period, dispatch. Manual: book → log row with right clinic, `unlimited`. Second clinic → separate rows. Cross-module import → ESLint error. | Dev, QA |
| 2 | Free messages enforced; bookings never blocked | Auto: allowance, alerts, recordSent. Manual: limit 3, book 4 → 4th skipped, booking saved, alerts once each | Dev, QA |
| 3 | Real cost; clinics pay only for what Meta charges | Auto: messageLog, cost. Manual: received message → billable, ₹0.1357. Send to a number not on WhatsApp → refunded, free-message count back by 1. | Dev, QA |
| 4 | Clinics hold and use credits | Auto: grants, expiry. Manual: grant 5 → send 2 past limit → balance 3; sooner-expiring used first; past expiry ignored; remove 10 of 3 → 409; removal row present | Dev, QA |
| 5 | Super Admin runs everything by API | Auto: settings. Manual: 401 / 403 for others; change rate with a reason → next delivery uses it, history shows both; schedule a change for tomorrow → today unchanged; new plan → "limit not set" in cost report | Dev, QA |
| 6 | Clinic admin sees usage and credits | Browser: card in normal, warning, paused, using-credits states; dark mode; keyboard | QA, Business |
| 7 | Super Admin works without the API | Browser: change settings with a reason, see history, grant / remove with reason, cost report for a month | QA, Business |

## 10. Scale and cost plan

Build now only what is cheap and needed. Each later item has a measured trigger, so it is added on evidence, not guesswork.

### Built now
| What | Saves |
|---|---|
| Settings and plan lookups served from Redis (existing plan cache, 5-min settings cache) | No extra DB read per message |
| Partial indexes (free-message rows; grants with credits left) | Usage count and balance stay fast as history grows |
| Cost stored once per message at delivery | Cost reports never recalculate history |
| Lean rows: 9 columns per message | Smallest table stays small |
| Check in the worker, record after send | No lost or double-counted messages, no second WhatsApp to a patient |

### Later, when the trigger is hit
| Trigger (measured) | Add | Effect |
|---|---|---|
| Message log > ~5 million rows, or the cost report takes > 2 s | `messaging_usage_monthly` rollup (clinic × channel × month: counts, cost), built nightly | Cost report reads a few thousand rows instead of millions |
| Message log > ~20 million rows | Monthly partitions on `sent_at` | Old months drop or archive without slowing new ones |
| Business agrees a retention period | Archive detail older than N months to S3; keep the rollup | Smaller, cheaper database; totals kept forever |
| Free-message check p95 > 20 ms | Redis counter per clinic × period, rebuilt from the log on a miss | One Redis read per message |
| A clinic needs different credit rules | `clinic_id` (null = everyone) on `credit_settings`, resolved clinic first, then global, as `fee_config_versions` does | Per-clinic deals without new tables |

At the current volume (~1 lakh messages a month at 20 busy clinics) no trigger is close. The rollup is the first one likely to be needed.

## 11. Known limits (accepted)

| Limit | Why accepted | Upgrade path |
|---|---|---|
| Up to 3 messages over at the limit | Worker concurrency 3; under ₹0.50 | Reserve a credit before sending |
| A message never delivered and never reported failed (phone off for weeks) stays counted | Meta retries up to 30 days and may never report | Monthly sweep: not delivered after 30 days → give back |
| Meta's sent / delivered / read status isn't stored | Only billable and cost are used | Add a `status` column |
| Clinics can't buy credits yet | On hold by decision | Purchase phase (§12) |
| Message log keeps all history | Small rows; needed for cost | Rollup + archive (§10) |

## 12. Later: purchase phase (not in this plan)

Needs the subscription module touched, so it waits for that decision:
- `credit_packs` table; `pack_id`, `price_paid`, `razorpay_order_id`, `razorpay_payment_id` (unique) on `credit_grants`; `source = 'purchase'`; `granted_by` and `reason` become nullable.
- Payment port + adapter (Razorpay order / verify), a branch in the Razorpay webhook, per-plan "can buy credits" toggle, buy screen.
- Nothing built now has to be rewritten for it.
