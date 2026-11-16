# Subscription Module — Rebuild Plan

Status: **in build — Phases 0–7 and 9 written (2026-11-04), Release 1 go-live (Phase 10) next; AutoPay
(Phase 8) is Release 2.** Rewritten 2026-11-03 after the decision that the module is **not live**, so
the core is rebuilt cleanly instead of patched.

## Progress

Code written and reviewed; **you run** jest, lint, migrations and the browser checks, then commit.

| Phase | Steps | State |
|---|---|---|
| 0–4 | Safety net, data model, skeleton, access, core | ✅ written |
| 5 | Checkout, activatePayment, webhook inbox, coupons, upgrade/renew/to-yearly, daily payment check | ✅ written |
| 6 | GST invoices (6.1), billing history + download, `/plans` cache (6.2) | ✅ written — seller details and SAC code are env placeholders until the accountant confirms |
| 7 | Add-on catalog/quote (7.1), purchase (7.2), changes at period end (7.3), plan versions BE 7.4a-1/7.4a-2 + FE 7.4b, FE refetch cleanup and blocked-reason | ✅ written — run `scripts/backfillPlanVersionLimits.ts --apply` **before** the 7.4a-2 migration |
| 8 | AutoPay | 🛠 Backend 8.1–8.6 written 2026-11-05 (monthly only, D8 decided); frontend AutoPay card + checkout tick next; test-mode run with Razorpay pending |
| 9 | Emails through the notification module (9.1 + 9.1b), reminders and lifecycle emails (9.2), activity timeline (9.3), outside readers on `SubscriptionReadService` (9.4), prices only from the BE | ✅ done |
| 10 | Release 1 FE rows (10.1a: AutoPay "coming soon", Admin-only reminder, trial 409 message, "Payment processing", ₹0 "Activate plan", upgrade renewal-date note) · closed account stops billing (10.1b = 8.6 without the mandate) · go-live checklist (10.1c) | ✅ written — run the Release 1 go-live checklist (§7) |

**Changes from the plan below, decided while building**
- **Emails (W):** the notification module got a real email channel — per-recipient `email-outbox` queue
  (30-day dedupe, retries), templates in `notifications/templates/`, invoice attachments through an
  `AttachmentPort`. The stop-gap queue was built, then removed. A lint rule (error) now stops anything
  outside `main/notifications` importing its templates; only the legacy senders are allow-listed.
- **Plan versions:** limits and add-on caps belong to a version (`plan_version_id` NOT NULL); a version
  clinics are on can't be edited (409 → "create a new version"); clinics move to the new price at renewal.
- **Webhook:** one URL `/api/v2/subscription/webhooks/razorpay`; the controller only checks the signature,
  Route account events moved to the clinic module; the old v1 webhook and its legacy handler are deleted.
- **Outside readers** read plans only through `SubscriptionReadService` (Super Admin analytics, credits,
  clinic service).
- **Prices come only from the BE:** `/plans` sends `price` = the live version's monthly price plus
  `version.monthlyPrice/yearlyPrice`; the FE shows those as sent (no fixed 20%, no hard-coded prices). A
  cycle with no price shows "Not sold this way".
- **Scheduled downgrade (built 2026-11-05):** the next period on the scheduled plan can be paid before the
  change date (Pay now, or AutoPay 1-3 days before; add-ons the new plan doesn't allow are dropped, others
  capped). Paying extends the period but keeps the current plan; the 00:05 job switches it on the change day
  (`applyPaidSwitches`). Not paid by then → the plan ends and the clinic moves to Free, as before.

- **Old code removed before go-live (2026-11-04, decided: no live payments yet):** the old AutoPay, the v1 webhook,
  the old checkout/verify, old add-on purchase/expiry, old invoice PDF and legacy emails are deleted, and no live
  code reads `clinic_subscriptions` / `clinic_add_ons` / `coupon_usage` any more. Kept until prod is carried
  over: those tables, their models, `carryOverSubscriptions.ts` and the seed. Then rename them to `legacy_*`.
- **Billing page:** one call, `GET /api/v2/subscription/overview`.

- **Super Admin plans & add-ons (2026-11-05):** one page per plan (Overview, Versions, Features, Clinics);
  scheduled versions can be edited or cancelled before they start; feature wording and text-only selling
  points change in place, limits only through a new version; Super Admin creates plans (they start not
  sold); **Stop selling** keeps current clinics renewing; **End plan** moves clinics to a replacement at
  their first renewal after the end date (manual today, automatic with AutoPay). Add-ons page: prices
  change from a date (`add_on_prices`) for new purchases and renewals, stop/start selling, wording.
  Migrations to run: `add_on_prices` table, `subscription_plans.ends_at` + `replacement_plan_id`.
  The old Plan Limits page, Edit plan modal and v1 create/manage-features routes are removed.

**Open — needs a decision or an outside answer**
- Invoice seller details, SAC code.
- **Clinic GSTIN (D9) moved after go-live** (2026-11-04): no clinic column yet; invoices stay B2C until then.
- `support_adjustment` (Super Admin extend/free time) and `account_closed` emails need features not built
  yet (O, 8.6).

Branches (local, not pushed): BE `fix/subscription-rebuild` from `origin/fix/finance-related-bug`
(staging's newer commits merge cleanly; the owner merges them by hand) · FE `fix/subscription-rebuild`
from `origin/staging`.

---

## 1. Goal and rules

Goal: a production-grade, maintainable subscription module that charges the right amount, never
loses or double-applies a payment, and is easy to change.

| Rule | Meaning |
|---|---|
| **FE changes where they're needed** | The FE may change wherever the rebuild needs it: remove unused API calls, adopt new response fields, add the screens and states the user stories need. Each FE change ships in the **same step** as the BE change it depends on, so the app never breaks between commits. Endpoints the FE keeps unchanged stay contract-tested (step 0.1). |
| **Clean data model** | Not live, so tables are redesigned, not patched: no backfill, no old columns kept. |
| **Playbook** | BACKEND_STANDARDS §1 bounded module (only `index.ts` is public), thin routes/controllers, services < ~800 lines, `types/`, `CacheKeys` with TTLs, `requireRole`, 2-line comments, tests in `__tests__/`. |
| **Migrations are run by the owner** | We write Drizzle models and stop (BE §7). |
| **Plan before code** | Each phase starts only after this plan is approved. |
| **Checked, not assumed** | Every step: endpoints hit on a running server, Razorpay **test mode** for payments, IDE diagnostics on changed files. `jest`, `eslint` and `tsc` are run by the owner (named in each hand-over), never by me. |

---

## 2. Decisions

### Taken (2026-11-03)

| # | Decision |
|---|---|
| A | Module is not live → clean rebuild of the core. |
| B | AutoPay uses **Razorpay Recurring Payments** (token + our own charge each cycle), not Razorpay Subscriptions. The server sets the amount, so add-ons work on card, UPI and eMandate. |
| C | **One first-plan path**: Free plan when the clinic is created; the "Start free trial" button works **once per clinic**. `/initial-subscribe` and the approval-time 30-day reset are removed. |
| D | Clinics are onboarded on **staging and production**, all on Free or trial (payments are not enabled; no paid plan, no AutoPay). Nothing is wiped: a **carry-over script** copies each clinic's current plan into the new tables with the same plan and end date. |
| D2 | Billing (buy, cancel, change plan, AutoPay, add-ons) is **Admin + Super_Admin** only. FE billing pages are already Admin-only. |
| D6 | The unused combined checkout (`/subscribe-with-addons`, `/verify-combined-purchase`, `/preview-combined-price`) is **removed**. A payment's `lines` hold plan and/or add-ons, so a combined purchase can return later as optional `addOns` on `/subscribe` with no model change. |
| E | Only the **web app** calls these APIs. Routes no screen calls are removed (§6.1); if another client needs one later, it is added back on the new structure. |
| F | Super Admin add-on management routes are removed now. A Super Admin add-ons screen is planned later as new work, with `addons.superadmin.route.ts` reusing the catalog service. Tables and seed stay. |
| G | **Plan versions.** A plan change by Super Admin is a new `plan_versions` row with a start date; versions in use are never edited. New buyers get the version in effect; existing clinics move to it at their **next renewal** on/after the start date (no grandfathering). Feature-only improvements may apply immediately; price never mid-period. |
| H | Coupon clean-up: remove the `trial` discount type (it gave the whole period free and ignored `trial_days`), remove `status = 'expired'` (worked out from `expires_at`), `applies_to` = `all | plans | addons` + optional ID lists. Dead usage-counter code (`incrementUsage`, `utils/usageTracker.ts`) is deleted; `clinic_usage` stays for storage. |
| I | A coupon discounts **one payment only**: the purchase, or the first AutoPay charge. Renewals are always full price; no multi-month coupons. |
| J | An invoice is issued for every billing event on a paid plan, **including ₹0** (100% coupon, credit covering a whole upgrade). No invoice for the Free plan, trials, AutoPay setup checks or failed payments. |
| **K** | **MUST — renewal date = the same calendar date every cycle** (billing anchor, as Stripe does). The plan always renews to the day it started: start 15th → 15 Dec, 15 Jan, 15 Feb. Short month → its last day, then back to the anchor (Jan 31 → Feb 28 → Mar 31). Yearly → same date next year (Feb 29 → Feb 28). Never "+30 days" or "+365 days". Stored as `subscriptions.billing_anchor_day`. AutoPay charges start 27–51 h before the renewal date (changed from 3 days on 2026-11-11, so the bank window is short), but the renewal date itself never moves. |
| **L** | **MUST — a pending payment never blocks or expires a clinic.** While a payment is `pending` (bank result not known, up to 24–36 h): full access, no second charge, no invoice, no failure email. Unknown after 5 days → failed + alert. |
| **M** | **Owner, not clinic.** Labs and pharmacies will be split from clinics and can have their own plans, so every account-owned table has `owner_type` (`clinic | lab | pharmacy`) + `owner_id` instead of `clinic_id`, and each plan has an `owner_type` (which kind of account can buy it). Wherever this plan says `clinic_id`, read `owner_type` + `owner_id`. Until the split happens, every owner is a clinic and labs/pharmacies keep using the clinic's plan; the carry-over sets `owner_type = clinic`. Kept tables with `clinic_id` (`subscription_activity`, `clinic_usage`) get `owner_type` added and `clinic_id` renamed to `owner_id` — no rows lost. |
| **N** | **Closed account stops billing.** When a clinic (later a lab or pharmacy) is deactivated, blocked, deleted or reset, the owning module calls `subscription.onOwnerClosed(ownerType, ownerId, reason)`: cancel the mandate at Razorpay, end the subscription (`cancelled`, reason stored), no new charges. Payments and invoices are kept. Restoring the account starts it on the Free plan; AutoPay must be turned on again. |
| **O** | **Support changes go through the system.** Only Super Admin can extend days, give free months, or move an account to a plan without payment. Each is a ₹0 `manual_adjustment` payment row with `reason` and `done_by`, shown in the timeline — never a hand edit of the database. Model now; the Super Admin screen later. |
| **P** | **Two releases.** Release 1 = core, one-time payments, invoices, add-ons, emails (AutoPay shown as "coming soon"). Release 2 = AutoPay, after Release 1 runs smoothly for 2–4 weeks (§7 "Releases"). |
| **Q** | **Refunds later**, when real payments start: Super Admin only, full refunds first, credit note issued. The model already has status `refunded`. |
| **R** | **An upgrade keeps the renewal date** (same cycle, e.g. Clinic yearly → CareHub yearly): the clinic pays the new plan minus the old one for the days left, and the plan still renews on the same anchor date. Only a monthly → yearly switch starts a new period (and anchor) on that day, with credit for the unused days. |
| **S** | **Yearly → monthly only at the end of the year** (scheduled like a downgrade); never mid-year, so no partial refund is needed. |
| **T** | **Monthly and yearly prices are independent and each optional.** A paid plan or add-on can be sold monthly only, yearly only, or both; at least one price is required for a paid plan. A missing price means that cycle is not offered. |
| **U** | **Super Admin enters prices directly**, including the yearly price; there is no discount formula in code. The `YEARLY_DISCOUNT = 0.2` constant is removed; the seed uses it once to fill today's yearly prices. The screen may show "= 20% off monthly" as information only. |
| **W** | **Emails are part of the notifications (email) module.** They are **always sent** — no enable/disable option (`configurable: false`). The subscription module fires events (`NotifyPort.notify(eventKey, ctx)` after commit) and owns the event list; the notifications module owns templates, sending, retries, sent-once and the delivery log (§5 Emails). Needs the client to lift Standing Rule 11 for subscription emails and the email channel built before Phase 9; otherwise a stop-gap queue adapter behind the same port, deleted later. |
| **X** | **Idempotency everywhere money moves** (§5 Idempotency): idempotency key per checkout, one open checkout per owner, one winner when applying a payment, one renewal charge per period, duplicates never applied. |
| **Y** | **v2 routes with the repo's naming convention** (§6.2): built under `/api/v2/subscription`, each screen moves in the same step as its endpoint; v1 keeps working until all screens have moved and is deleted in step 10.3 (dangerous unused v1 routes go earlier, step 3.2). |
| **V** | **One event list for every subscription email** (§5 Emails), each with a dedupe key so it is sent once. How they are sent: decision W. |
| **D9** | **Clinic GSTIN — yes, optional.** One optional field in the clinic profile (clinic module + one FE input, Release 1), format-checked (15 characters), copied into `bill_to` when an invoice is issued, so a registered clinic can claim back the GST it pays us. |

### Defaults (build with these unless the accountant / Razorpay says otherwise)

| # | Default |
|---|---|
| D7 | Place of supply = clinic state: Madhya Pradesh (23) → CGST 9% + SGST 9%, any other state → IGST 18%. Invoice number `MS/2026-27/0001` (prefix / financial year / running number, resets 1 April, ≤ 16 characters). Prices stay **GST-inclusive** as today. SAC code from the accountant. ₹0 invoices use the same series and the "Tax Invoice" heading. |
| D8 | **Decided 2026-11-05.** AutoPay for **monthly plans only**; yearly plans hide it and renew by paying, with reminders. Limit asked = the plan + every add-on at its cap on that plan version (never below the current renewal), shown with its parts before approval; an add-on with no cap can still need a new approval. Pay the first month + register AutoPay in the same checkout flow. `frequency: as_presented` for card, UPI and eMandate. Webhooks: `token.confirmed`, `token.rejected`, `token.cancelled`, `token.paused`, `payment.captured`, `payment.failed`. An AutoPay charge is **plan + add-ons only**; WhatsApp packs are never auto-charged (one-time purchase). |

**Every default above is a setting, not code.** Seller details (legal name, address, GSTIN), GST
rates, the home state code, SAC code, invoice prefix, GST-inclusive or not, and the AutoPay limit
multiplier live in one config file (`subscription/utils/billingSettings.utils.ts`). Changing one
is a one-line change; **issued invoices never change**, because each invoice stores its own copy
of these values (`seller`, `bill_to`, tax amounts). Move the settings to a Super Admin screen later
if they need to change without a deploy.

### Open (confirmations)

| # | Question | Needed |
|---|---|---|
| D7 | GST on our invoices: CGST+SGST vs IGST by clinic state, invoice number series per financial year, prices GST-inclusive or not, SAC code, required fields (§5 Invoices); for ₹0 invoices (J) — heading "Tax Invoice" and the same number series? | Confirm with the accountant before Phase 6 |
| D8 | Razorpay support: (1) our MCC and its limits (docs: `max_amount` up to ₹99,999 for most categories; is there a ₹15,000 per-debit limit without PIN for UPI and cards?); (2) can one checkout both charge the first period and register the mandate, per method?; (3) is `frequency: as_presented` allowed for card and eMandate as well as UPI?; (4) webhook event names for token confirmed/cancelled and recurring debit result; (5) a yearly renewal is often above ₹15,000 — will UPI/card ask the clinic for PIN/OTP, and how does Razorpay handle that for a recurring debit? Fallback in our plan: "pay now" link + reminders before the date. | Answered 2026-11-05 (row D8 above) |

---

## 3. Kept as is

Good logic and tables that move into the new structure unchanged:

- Pricing math: proration credit, add-on pro-rating, coupon discount (`pricing.service.ts`,
  `addOnQuantity.utils.ts`, `billingCycle.utils.ts`, `paymentMode.utils.ts`) and their tests.
- Catalog tables: `subscription_plans`, `plan_features` and `plan_add_on_limits` (now keyed by plan version, G), `add_ons`,
  `clinic_usage`, `coupons`.
- Limit checks used by other modules (`isFeatureEnabled`, `checkDoctorLimit`, `checkStaffLimit`,
  `checkStorageLimit`, …) — same behaviour, exposed through `index.ts`.
- Email templates and the activity timeline UI data.

---

## 4. Data model

### Problems in today's model

| Today | Effect |
|---|---|
| `transaction_id` holds `pay_…`, `TRIAL`, `-`, `free_<time>`, `txn_<time>`; renewals overwrite it | Real and fake IDs mixed; old payment IDs lost; replay risk |
| `price` is the list price on the webhook path and never updated on renewal | Wrong amounts, wrong proration later |
| Billing cycle guessed from `provider_subscription_id` (`pro-yearly`, `free_plan`, `manual`) | A new value silently bills monthly |
| AutoPay columns live on the subscription row | Plan change or cancel leaves the mandate charging |
| State spread over `active` + `expires_at` + `payment_status` + `cancel_at_period_end` | Three different "expired" rules |
| Add-ons have their own `expires_at`, no link to the subscription or payment | Dates drift; double insert possible |
| No payments table; invoices built from activity JSON, numbered from a UUID | No reliable record, no proper invoice series |
| Order **notes** are the source of truth for what was bought | Our DB doesn't know a checkout until it's paid |

### New tables

Charged and billed money is `bigint` paise (production rules below); catalog prices are `decimal(12,2)` rupees. Enums are `pgEnum`. `clinic_id` is a
plain uuid, no FK to clinic tables (BE §1 rule 5).

**`subscription_plans`** (kept, 3 changes)
- add `kind` enum `free | paid` — replaces the `slug === 'solo' || 'Free'` checks.
- `price` becomes **`monthly_price` + `yearly_price`** (on `plan_versions`), like `add_ons`;
  independent and each optional (T); entered by Super Admin (U). The old "monthly × 12 − 20%"
  formula only fills the seed once.
- keep `is_trial_plan`, `trial_days`, `is_default_fallback`; partial unique: one trial plan, one
  fallback plan.

**Periods are calendar based** (the Stripe "billing anchor" pattern): monthly = same day next month
(Nov 3 → Dec 3), yearly = same day next year; not 30/365 days. The start day is stored as
`billing_anchor_day`; a short month uses its last day and the next month returns to the anchor
(Jan 31 → Feb 28 → Mar 31). Feb 29 yearly → Feb 28. Today's code charges on calendar months at
Razorpay but extends our expiry by 30 days, so the two drift apart in 31-day months.

New tables are built **next to** the old ones, so the old code keeps compiling until each area is
switched. **No data is lost**: old tables are never dropped by this plan, only archived (§4
"Old tables"), and every existing clinic's plan is carried over first (step 1.5).

**`subscriptions`** (new, replaces `clinic_subscriptions`) — one row per plan the clinic is on;
renewals extend the same row.

| Column | Notes |
|---|---|
| `id, clinic_id` | |
| `plan_version_id` | the plan comes from the version; no separate `plan_id` that could disagree |
| `status` | enum `trialing | active | past_due | cancelled | expired | replaced` (`replaced` = an upgrade ended it) |
| `billing_cycle` | enum `monthly | yearly | none` (none = free) |
| `current_period_start, current_period_end` | `current_period_end` null for free |
| `billing_anchor_day` | 1–31, the day renewals land on; null for free |
| `is_trial` | trial once per owner = no earlier row with `is_trial`; a trial row has `billing_cycle = none` and ends at `current_period_end` |
| (rule) | the plan version's plan must have the same `owner_type` as the subscription (a clinic can't be on a lab plan) — checked on every write |
| `cancel_at_period_end, cancelled_at, cancellation_reason` | |
| `scheduled_plan_id, scheduled_billing_cycle, scheduled_change_at` | downgrade at period end |
| `ended_at` | set when replaced or expired |
| `created_at, updated_at` | |

Partial unique: one row per clinic with status in (`trialing, active, past_due`). No payment, price
or mandate columns. On an upgrade the active add-ons are copied to the new row.

**`subscription_add_ons`** (replaces `clinic_add_ons`)

| Column | Notes |
|---|---|
| `id, clinic_id, subscription_id, add_on_id` | follows the subscription's period — no own expiry |
| `quantity` | a new purchase raises it |
| `status` | enum `active | cancelled` |
| `scheduled_quantity` | quantity from next period (reduce / cancel at period end) |
| `scheduled_deactivate_user_ids` | jsonb, as today |
| `created_at, updated_at` | |

Partial unique: (`subscription_id`, `add_on_id`) where `status = active`.

**`subscription_payments`** (new) — every checkout and every charge, created **before** the
Razorpay order, so our DB is the source of truth.

| Column | Notes |
|---|---|
| `id, clinic_id, subscription_id` | |
| `kind` | enum `plan_purchase | plan_change | addon_purchase | renewal | mandate_setup | manual_adjustment` |
| `status` | enum `created | pending | captured | failed | abandoned | refunded` (`pending` = sent to the bank, result not known yet) |
| `amount_paise, discount_paise, currency` | amount actually charged, in paise |
| `coupon_id` | a **captured** payment with a coupon is one coupon use — no separate redemptions table |
| `lines` | jsonb snapshot of what was bought (plan, cycle, add-ons, proration) — replaces order notes |
| `period_start, period_end` | the period this payment pays for |
| `provider` | `razorpay` |
| `provider_order_id` | **unique** |
| `provider_payment_id` | **unique** where not null |
| `payment_method` | `card | upi | netbanking | wallet` — billing history shows it today ("Paid via UPI"); copied on capture so reads never call Razorpay |
| `mandate_id` | set for AutoPay charges |
| `attempt_count, next_attempt_at, failure_reason` | renewal retries |
| `reason, done_by` | required for `manual_adjustment` (decision O): why, and which Super Admin |
| `paid_at, created_at, updated_at` | |

**`subscription_invoices`** (new) — issued once when a payment is captured, never rebuilt.

| Column | Notes |
|---|---|
| `id, payment_id (unique), clinic_id` | |
| `invoice_number` | unique; series per financial year (format per D7) |
| `status` | enum `issued | void` — never edited; a refund gets a credit note (later) |
| `issue_date` | |
| `seller` | jsonb snapshot: our legal name, address, GSTIN |
| `bill_to` | jsonb snapshot: clinic name, address, state, GSTIN (D9) |
| `place_of_supply` | clinic's state code; decides CGST+SGST vs IGST |
| `sac_code` | per D7 |
| `taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise` | per D7, in paise; they always add up |
| `pdf_key` | stored PDF |

**`subscription_mandates`** (new) — AutoPay belongs to the clinic, not to a subscription row.

| Column | Notes |
|---|---|
| `id, clinic_id` | |
| `provider, provider_customer_id, provider_token_id (unique)` | |
| `method` | enum `card | upi | emandate` |
| `max_amount_paise` | the cap the owner approved (Razorpay token `max_amount` is paise too) |
| `status` | enum `pending | active | paused | cancelled | failed` |
| `authorized_at, cancelled_at, failure_reason, created_at, updated_at` | |

Partial unique: one `active` mandate per clinic. **AutoPay is on ⇔ the clinic has an active
mandate** — no separate flag to drift.

**`subscription_webhook_events`** (new)

| Column | Notes |
|---|---|
| `id, provider, event_id (unique), type, payload` | `event_id` from `x-razorpay-event-id` |
| `status` | enum `received | processed | failed` |
| `attempts, error, received_at, processed_at` | |

**`plan_versions`** (new, decision G)

| Column | Notes |
|---|---|
| `id, plan_id, version_no` | unique (`plan_id`, `version_no`) |
| `monthly_price, yearly_price` | prices move here from `subscription_plans`; each nullable (null = cycle not sold); a paid plan needs at least one (T) |
| `effective_from` | when new buyers and renewals start using it |
| `created_by, created_at` | |

`plan_features` and `plan_add_on_limits` are keyed by `plan_version_id` instead of `plan_id`.
`subscriptions.plan_version_id` is the version for the current period; the renewal moves it to the
latest version in effect. AutoPay clinics get an email before a price rise; above their mandate's
`max_amount` they are asked to re-approve.

**Add-on prices** stay on `add_ons` (`monthly_price`, `yearly_price`), no version table: a price
change applies to new purchases and the next renewal; old payments and invoices keep the price they
were paid at, because each payment stores its own `lines`. A price-history table can be added if
scheduled add-on price changes are ever needed.

**Coupons**: no redemptions table. Uses per clinic = captured payments with that `coupon_id`.
`coupons.current_uses` is raised with `WHERE max_uses IS NULL OR current_uses < max_uses` in the
same transaction as the payment.

**`subscription_activity`** (kept) — timeline only; **never** a source of money or invoice data.

### Old tables — archived, never dropped

`clinic_subscriptions`, `clinic_add_ons`, `coupon_usage` stop being read or written in step 10.3
and are **renamed** to `legacy_clinic_subscriptions`, `legacy_clinic_add_ons`, `legacy_coupon_usage`
after a full database backup. Their rows stay; removing them for good is a separate decision for
later. Old real payments (`pay_…` IDs, with their coupon from `coupon_usage`) are copied into
`subscription_payments` as captured payments by the carry-over (step 1.5), so billing history and
per-clinic coupon limits keep working.

### Production rules for every table

The full model with columns and indexes is `docs/subscription/SUBSCRIPTION_MODEL.dbml`.

| Rule | Why |
|---|---|
| All times `timestamptz` | period ends and "end of day IST" must not shift with the server's time zone |
| Charged and billed money (`subscription_payments`, `subscription_invoices`, mandate limit) is **`bigint` paise**, like the money module (`money_entries.amount_paise`); catalog prices Super Admin enters stay `decimal(12,2)` rupees and become paise when priced; the API returns rupees | exact money with no rounding drift, one approach across the codebase; Razorpay works in paise too |
| **Money math in integer paise** inside `billing/`: proration, coupon, GST split; one rounding rule (half-up to the paisa); CGST + SGST always add up to the tax | the screen, the Razorpay charge and the invoice never differ by a paisa |
| Payments and invoices kept **at least 8 years**; no S3 lifecycle rule ever deletes the invoice prefix | GST law requires keeping tax records for years (exact period: accountant, D7) |
| `updated_at` not null, default `now()` | every row says when it last changed |
| `clinic_id` on every tenant table | every query filters by the token's clinic |
| CHECK constraints on amounts, quantities, percentages, period end > start | bad data can't be written even by a script |
| Indexes for each cron and lookup (renewal, expiry, retry, webhook worker, coupon limits) | crons stay fast as clinics grow |
| No `ON DELETE CASCADE` on payments, invoices, mandates; these rows are never deleted | money history can't vanish |
| Invoice numbers from `subscription_invoice_sequences`, row-locked in the payment transaction | consecutive, no gaps (a Postgres sequence can skip) |
| Webhook worker picks events with `FOR UPDATE SKIP LOCKED` (status `processing`) | two servers never handle the same event |
| Plans and add-ons are hidden (`is_active = false`), never deleted | old payments and invoices keep their references |
| `lines` jsonb validated by a Zod schema with a version field | old payments stay readable when the shape grows |

### What we store vs what Razorpay keeps

Rule: store only what **we** need to decide, charge, show or prove — Razorpay stays the record for
everything else, fetched only when needed (daily check, webhook), never on a screen read.

| Data | Stored by us? | Why |
|---|---|---|
| Order / payment / token / customer **IDs** | yes | to charge, match webhooks and reconcile |
| Amount, status, paid date, method (card/UPI/…) | yes | billing history, invoices, decisions — without calling Razorpay |
| Mandate limit, status, end date | yes | to know AutoPay is on and warn before a charge exceeds the limit or the mandate ends |
| Card number, last 4, UPI ID, bank account, IFSC | **never** | Razorpay holds them; storing them adds risk for no use |
| Customer name, email, phone at Razorpay | **no** | the clinic module already has them |
| Full webhook payload | **90 days**, then cleared | needed for retries and debugging; it contains email/phone |
| Razorpay "plans" and "subscriptions" (old product) | **no longer** | Recurring Payments doesn't use them; the old Redis caches go too |
| Order notes as the record of what was bought | **no longer** | `subscription_payments.lines` is the record |
| Copied amounts / Razorpay data in `subscription_activity.metadata` | **no** | IDs only; the timeline reads amounts from the payment row |
| `currency` columns (all INR today) | kept | harmless; ready if another currency comes |

**Monitoring** (logs + alerts, through the existing logger):
webhook event `failed` after its last retry · renewal payment failed · daily payment check fixed
anything · invoice issue failed · mandate halted. Each logs the clinic and payment ID, never card or
UPI details.

---

## 5. How it works

### One rule for "is the plan valid"

`subscriptionState(sub)` in `core/` is the only place that decides: valid until the **end of
`current_period_end`'s day in IST** (`subscriptionGraceEnd`), free never expires. Access guards,
limits, crons, add-ons and the API all call it.

**What a plan unlocks comes from its features only.** Every paid-feature guard (lab, pharmacy,
medicine, receptionist, …) checks the current plan version's `plan_features` (`isFeatureEnabled`).
Today the **screen** already hides pharmacy setup for Free clinics (`useFeatureGate("pharmacy_integration")`), but two server guards disagree: `requireSubscription` / `requireLabSubscription`
let a Free clinic in (no end date = "valid"), while `requireUserSubscription` (pharmacy routes)
blocks it — so 12 pharmacy setup routes (`pharmacy/routes/v1/pharmacy.route.ts`, `pharmacies/routes/v1/adminMedicine.route.ts`) still accept a Free clinic called directly. After the rebuild the server applies the same rule as the screen: the Free plan opens exactly what its features say (pharmacy off), on every route. Users see no change.

### Free plan and free trial

**Today** (checked 2026-11-03):

| # | Path | What's wrong |
|---|---|---|
| FT1 | Clinic create / onboarding reset / restore → `ClinicService.assignDefaultFreePlan` | Works and is idempotent; finds the Free plan by slug (`solo`/`Free`) |
| FT2 | "Start free trial" → `POST /users/verify-subscription` | **No once-only check in the API** — only the screen hides the button (`noSubscriptionTakenTillNow`). Calling it again gives a new trial and **switches off a paid plan**. Length falls back to 30 days; plan falls back to the one named "CareHub" |
| FT3 | `noSubscriptionTakenTillNow` (users service) | Works out "never subscribed" from the text marker `providerSubscriptionId !== 'default-free'` |
| FT4 | `POST /subscription/initial-subscribe` | Always 409 — every clinic already has the Free row from FT1, so it can never run (removed, decision C) |
| FT5 | Admin approval (`UserService.updateUserStatus`) | Puts a 30-day end date on the clinic's latest row — the **Free** row — so a Free clinic passes pharmacy guards for 30 days, then its "free" plan expires (finding 8) |
| FT6 | Trial ends | No Free row is created; the expired trial row stays `active = true` and every caller falls back to Free in its own way |

**Rules after the rebuild**

| Rule | |
|---|---|
| Free plan | Created when the owner is created, restored or its onboarding is reset (`assignFreePlan`, idempotent). `kind = free`, no end date, never expires. Found by `kind` + `is_default_fallback`, not by slug. |
| Who can start a trial | An owner that has **never had a trial** (no row with `is_trial`) **and is on Free**. On a paid plan → 409 "You already have a paid plan". Trial used → 409 "You have already used your free trial". Checked in the API, inside a transaction, not only on screen. |
| Which trial | The one plan with `is_trial_plan`, length = its `trial_days` (required for that plan). No 30-day or "CareHub" fallback — missing setup is an error Super Admin sees. |
| Trial ends | At the end of the trial's last day (IST) a cron sets the trial row `expired` and creates the Free row in the same transaction; staff above the Free limit are handled as on any expiry, and the Admin gets an email. Reminder emails before the end (US-11.1). |
| Buying during a trial | Allowed; the trial row becomes `replaced`, the paid plan starts that day (no credit — the trial was free). |
| Trial offer on screen | `noSubscriptionTakenTillNow` keeps its name and meaning for the FE, but is computed by the same rule as the API (never had a trial and on Free), so the button and the API always agree. |
| Approval | Changes no plan (decision C). |

### One way a payment is applied

`activatePayment(paymentId)` — called by the verify endpoint, the webhook worker and the daily
check. It loads the `subscription_payments` row, checks Razorpay says `captured` with the right
amount, then **in one transaction**: mark payment captured → create/extend subscription → set
add-ons → coupon `current_uses` → issue invoice. After commit: stop a replaced mandate if any, staff
reactivation, cache invalidation, receipt email. Already captured → returns the same result (safe
to call any number of times).

### Idempotency — one action, one charge, one result (decision X)

Every place a payment can be started or applied twice, and what stops it:

| # | Risk | Guard |
|---|---|---|
| X1 | Double click on "Pay", slow network, browser retry | The FE makes one **idempotency key** (UUID) when the checkout opens and sends it as `Idempotency-Key`. `subscription_payments` has unique (`owner_type`, `owner_id`, `idempotency_key`): the same key returns the **same** order, never a new one. The "Pay" button is disabled while the request runs. |
| X2 | Two tabs, or a new checkout while one is open | **One open checkout per owner**: partial unique on `subscription_payments` (`owner_type`, `owner_id`) where `status in (created, pending)` and `kind` is a purchase. Same lines → that checkout is reused. Different lines → the old unpaid one is marked `abandoned` first, then the new one is created. |
| X3 | Old order paid later (abandoned tab, slow UPI) | `activatePayment` still applies it if nothing newer replaced it; if it would duplicate a purchase already applied → **duplicate rule** (X8). |
| X4 | Verify call + webhook + daily check apply the same payment | `activatePayment` moves the row with one conditional update (`status in (created, pending)` → `captured` … `RETURNING`): exactly one caller wins, the others read the result. Plus unique `provider_payment_id`. |
| X5 | Same webhook delivered again | `subscription_webhook_events.event_id` unique — a repeat is a no-op. |
| X6 | Renewal cron runs twice, or two servers run it | Unique (`subscription_id`, `period_start`) for `kind = renewal`: one renewal charge per period. Crons run once across servers (`runOnce` lock), and never start a charge while the last one is `pending` (L). |
| X7 | Add-on bought twice by mistake | Same as X1 + X2: one key, one open checkout. |
| X8 | A real duplicate still gets captured (e.g. two Razorpay payments on one order) | The extra payment is kept `captured`, **not applied**, `needs_refund = true`, the Admin is told, and an alert is raised. Refund: see the open choice below. |
| X9 | Emails, invoices, coupon uses | Already one per payment / event (dedupe keys, unique `payment_id` on invoices, coupon count from captured payments). |

**X8 decided (2026-11-03): refund automatically.** A captured duplicate is refunded in full through Razorpay (`POST /payments/:id/refund` with no amount = full refund; only captured payments, within 6 months; normal speed 5–7 working days — [Razorpay Refunds API](https://razorpay.com/docs/api/refunds/create-normal/?preferred-country=IN)). The payment is marked `refunded` when the `refund.processed` webhook arrives; a refund that fails (e.g. low Razorpay balance) raises an alert for Super Admin. The clinic is emailed. This one refund case is built in step 5.2; all other refunds stay with decision Q.

### Flows

| Flow | Steps |
|---|---|
| **New clinic** | Clinic created → Free plan (`status active`, `billing_cycle none`). |
| **Free trial** | `POST /users/verify-subscription` → only if the clinic never had a trial → trial plan, `status trialing`, period = `trial_days`. |
| **Buy a plan** | `POST /subscribe` → quote → `subscription_payments` row (`created`, `lines`) → Razorpay order → popup → `POST /verify-subscription` → `activatePayment`. Webhook `payment.captured` → same. |
| **Set up AutoPay** | Create Razorpay customer → registration order with `token` { `max_amount`, `expire_at`, `frequency: as_presented` } (UPI ₹1 check, eMandate ₹0) → clinic approves → token `confirmed` → `subscription_mandates` row `active`. With a plan purchase: the first period is paid by the normal checkout, then the mandate is registered in the same flow (a single "pay + register" step only if Razorpay confirms it, D8). |
| **Renewal (AutoPay)** | Daily cron, **27–51 h before period end** (was 3 days until 2026-11-11): `renewal` payment row, amount = plan + add-ons (≤ `max_amount`) → `POST /orders` with a `notification` object → Razorpay sends the pre-debit notice → `POST /payments/create/recurring` → debit runs ~25 h (UPI) / ~36 h (card) after the notice; the result can take 24–36 h → webhook → `activatePayment` extends the period. Charge asked for 26 h after the notice (Razorpay refuses under 25 h, so a margin); never while the previous charge's result is unknown. While a renewal is with the bank, cancel / downgrade / add-on reduce are **accepted** and apply from the period after it (renewal capture keeps a cancel made after the charge and moves a late downgrade to the new period end; only add-on changes made before the charge apply). Buying or upgrading a plan and undoing a priced-in change stay blocked until the bank answers. |
| **Renewal failed** | Razorpay does **not** retry these debits; our cron does: next attempt only after the last result is known, up to 3 attempts. The plan stays usable until the end of `current_period_end`'s day; not paid by then → `past_due`, grace, then `expired` → Free, staff limits applied, clinic emailed at each step. |
| **Renewal (no AutoPay)** | Reminders before expiry; clinic pays through "Buy a plan" (renewal = same plan, period starts at old period end). |
| **Add-on mid-cycle** | Pro-rated one-time payment (`addon_purchase`) → quantity up. Next renewal charges the new total automatically. If the total exceeds the mandate's `max_amount`, the clinic is asked to re-approve AutoPay with a higher cap. |
| **Upgrade (same cycle)** | Immediate. Pays (new plan − old plan) × days left ÷ days in the period → `plan_change` payment → old row `replaced`, new row keeps the **same `current_period_end` and anchor** (R); add-ons copied; the mandate stays. |
| **Monthly → yearly** | Immediate. Credit for the unused days of the month, pays the yearly price minus the credit → new period and anchor start that day (R). |
| **Yearly → monthly** | Scheduled at the end of the year (S), like a downgrade. |
| **Downgrade / cancel** | Scheduled at period end (`scheduled_*`, `cancel_at_period_end`); undo allowed. Immediate cancel also cancels the mandate. |
| **Add-on cycle** | Always the subscription's cycle, decided by the server (a yearly plan gets yearly add-ons); pro-rated by calendar days left in the period. |
| **Turn AutoPay off** | Cancel the token at Razorpay → mandate `cancelled`. |
| **Missed events** | Daily check lists the last 2 days of captured Razorpay payments and calls `activatePayment` for any we haven't applied; logs what it fixed. |
| **Payment still in process** | Payment row `pending`: no second charge, no invoice, no failure email; the clinic keeps full access and the billing page shows "Payment processing". The daily check asks Razorpay for its status. Captured → `activatePayment`. Failed → retry rules. Still pending at period end → access continues (grace) and the subscription is **not** expired while a payment is pending. Unknown after 5 days → marked `failed`, alert raised. |
| **Late money for an abandoned checkout** | A payment captured for a row already `abandoned` is still applied through `activatePayment`; if the clinic already bought the same thing again, the extra payment is flagged for refund and an alert is raised — never applied twice. |

### Coupons

**Today** (`coupon.service.ts`, checked 2026-11-03):

| # | Problem | Example |
|---|---|---|
| C1 | `trial` type gives the whole period free, ignores `trial_days` | "7-day trial" coupon on yearly = free year (removed, H) |
| C2 | Limits checked when the order is made, use recorded only after payment | two open checkouts both use a one-time coupon; `max_uses` exceeded |
| C3 | Webhook-first purchase never records the use | coupon can be reused |
| C4 | A "valid" answer is cached 60 s and skips the re-check | coupon switched off by Super Admin still works for a minute |
| C5 | Add-on cart: checked against the **first** add-on only, discount on the **whole** cart | "Extra doctor" coupon also discounts storage |
| C6 | "Plans" coupon also discounts add-ons bought with the plan; min order judged after the upgrade credit | discount on the wrong lines |
| C7 | No upper limit on a percentage | 150% accepted (ends as 100% off) |
| C8 | Recording errors are swallowed (`recordUsage` returns `success: false`, callers ignore it) | use silently not counted |
| C9 | "First-time only" counts `paymentMode '-'` rows (old initial-subscribe trial) as paid | a real first-timer can be refused |

**New rules**
- Checked once at quote time and **again inside `activatePayment`'s transaction**; uses = captured
  payments + `created` payments younger than 30 minutes (a short hold), so two checkouts can't both
  take the last use. `current_uses` raised with the conditional update.
- No cached decision; only the coupon row may be cached.
- Discount applies to **eligible lines only** (plan line and/or add-on lines per `applies_to` and
  ID lists); min order value is checked on those lines before any credit.
- Percentage 1–100, fixed > 0 (Zod).
- First-time only = the clinic has no earlier **captured** payment with amount > 0.
- A coupon discounts **one payment**: the purchase, or the first AutoPay charge; renewals are full
  price.
- Errors are not swallowed: a failure rolls back with the payment transaction.

### Invoices

**Today** (`SubscriptionService.generateInvoicePdf`) the PDF is rebuilt from live data on every
download, so an old invoice changes over time:

| Problem | Example |
|---|---|
| Period read from the subscription row, which renewals extend in place | November's invoice later shows "Nov 3 → Mar 3" |
| Line rate read from the plan's **current** price | Super Admin raises the price → old invoices show the new rate and a fake "credit" |
| Number = last part of a UUID | `5c1f9a2b7e4d` — not a series, not per financial year |
| Always CGST 9% + SGST 9%, price treated as GST-inclusive | wrong for a clinic outside Madhya Pradesh (IGST) |
| Missing tax-invoice fields | no "Tax Invoice" title, our address, SAC code, place of supply, clinic GSTIN |
| Renewal invoices depend on activity JSON | missing metadata → wrong period or amount |

**When an invoice is issued (decision J):** one invoice for every billing event on a **paid plan**,
**including ₹0** — the same as Stripe.

| Event | Invoice |
|---|---|
| Plan purchase, manual renewal, AutoPay renewal, upgrade, add-on purchase | yes |
| 100% coupon, or credit covering a whole upgrade (₹0) | **yes, ₹0** — shows the price and the coupon/credit |
| Free plan, free trial, AutoPay setup check, failed or abandoned payment | no |
| Refund | credit note against the original invoice (later) |

A ₹0 purchase still creates a ₹0 `subscription_payments` row (`captured`, `provider` empty, no Razorpay IDs). Every **sale** row — `plan_purchase`, `plan_change`, `addon_purchase`, `renewal` — gets exactly one invoice; `mandate_setup` (AutoPay check) and `manual_adjustment` (support, O) rows **never** do.

**New rule: an invoice is issued once and never rebuilt.**
- Issued inside `activatePayment()` from the payment row: amount, period, lines, coupon.
- `bill_to` and seller details are copied in at issue time (clinic name, address, state, GSTIN).
- Number from a per-financial-year counter in the same transaction, e.g. `MS/2026-27/0001`
  (format per D7).
- Tax per D7: same state as our GSTIN (23, MP) → CGST + SGST; other state → IGST.
- PDF rendered once and stored (`pdf_key`); download returns the stored file.
- **We issue and store invoices ourselves**, not Razorpay's Invoices product. The PDF goes to our
  S3 bucket through the existing `uploadBufferToS3` (key `subscription-invoices/{financialYear}/{number}.pdf`
  under the environment prefix), **private** — never a public URL. `GET /invoice/:id/download`
  checks the owner from the token and streams the file. Bucket region: `ap-south-1` (Mumbai, India)
  by default in `configurations/s3/client.ts`; confirm `AWS_REGION` on prod so invoices and the
  database stay in India.
- Razorpay keeps its own record of each payment (in India, as RBI requires) and **always emails the
  payer a transaction receipt** — partner banks require it and it cannot be turned off
  ([Razorpay FAQ](https://razorpay.com/docs/us/payments/faqs)). So a clinic gets two emails per
  payment: Razorpay's bank receipt and **our email with the GST invoice**. Our subject line says
  "Invoice …" so the two aren't confused.
- One-time payments: order created on our server, Checkout gets that `order_id`, the signature is
  checked against **our stored** order id, and the plan turns on only once the payment is
  `captured`. Capture is set per order with the Orders API `payment.capture = automatic`
  (authorized payments left uncaptured are refunded by Razorpay after a few days) —
  [Standard Checkout](https://razorpay.com/docs/us/payments/payment-gateway/web-integration/standard/integration-steps),
  [capture settings](https://razorpay.com/docs/payments/payment-gateway/rainy-day/capture-settings/api/).
- Refund → a credit note against the invoice, never an edit.

Fields to confirm with the accountant (D7): "Tax Invoice" title, our legal name, address and GSTIN,
consecutive number, issue date, clinic name/address/state, clinic GSTIN if registered, place of
supply, SAC code, taxable value, tax rate and amount per tax, total, amount in words, signature.

### Undo and redo

| Action | Can the clinic undo it? |
|---|---|
| Scheduled cancel | **yes**, "Undo" until the period ends |
| Scheduled downgrade, yearly → monthly | **yes**, "Undo" until the period ends |
| Scheduled add-on reduce / remove | **yes**, "Undo" until the period ends |
| Plan ended (cancelled or expired) | **buy again** any time; the free trial is not offered again |
| AutoPay turned off | **turn on again** any time (approve again) |
| Upgrade or add-on already paid | **no undo** (money taken); schedule a downgrade / removal for the period end; a mistake is a refund by Super Admin (Q, later) |
| Coupon used | not usable again in that clinic |

Undo and redo use the existing `/undo-cancel`, `/undo-downgrade`, `/addons/undo-cancel/:id` endpoints
and the normal buy flow.

### Emails (decision V)

**Today:** 16 send functions (`subscriptionPurchaseEmail`, `renewalReminder`, `accountAccessEmail`,
`addOnExpiryReminder` services) call `utils/email.ts` `sendEmail()` directly. A failed send retries
in memory and is **lost on a restart**; duplicates are stopped only for renewal failures (through
activity JSON). The notification engine (`notify()`) has **no email channel yet** — its Standing
Rule 11 keeps email out of scope until the client lifts it (`docs/playbook/NOTIFICATION_REBUILD.md`).
It already carries the in-app/push event `subscription.expiring`.

**New — emails belong to the notifications (email) module.** The subscription module only
says *what happened*; the notifications module sends.

| Owned by the **subscription** module | Owned by the **notifications** module |
|---|---|
| The event list below and **when** each fires | Registry entries (`registry/subscription/index.ts`) with the email channel |
| The event data (`ctx`): plan, amount, dates, invoice id, staff list | Email templates (`src/main/notifications/templates/`, shared layout) |
| Calling `NotifyPort.notify(eventKey, ctx)` **after the DB transaction commits** | Queue, retries, surviving restarts, sent-once (dedupe key), delivery log, preferences |
| Making the invoice PDF available by id | Attaching it to the receipt email |

**Always sent:** subscription emails have no enable/disable option for clinics or users (registry `configurable: false`, as `subscription.expiring` already is) — they are billing and access notices.

Rules for both sides: one email per event (dedupe key below); a failed email never rolls back a
payment; amounts `₹1,234.00`, IST dates, never card/UPI/bank details; in-app and push for the
same event come from the same registry entry.

**Dependency:** the notifications module has no email channel yet — its Standing Rule 11 keeps
email out until the client lifts it (`docs/playbook/NOTIFICATION_REBUILD.md`). Decision W: the
client lifts it for subscription emails and the email channel is built in the notifications
module **before Phase 9**. If it isn't ready by then, a **stop-gap** adapter behind the same
`NotifyPort` sends through a BullMQ email queue (pattern of `loginAlertQueue.service.ts`) and is
deleted when the channel lands — the subscription module doesn't change either way. Today's
subscription email templates in `src/htmltamplates/` move to the notifications module with their
events.

**Email events** (recipient: the owner's Admin; dedupe key in brackets)

| Event | When | Attachment | Release |
|---|---|---|---|
| `subscription.trial_started` | trial begins [subscription id] | — | 1 |
| `subscription.trial_ending` | 3 days and 1 day before the trial ends [subscription id + days] | — | 1 |
| `subscription.trial_ended` | trial over, moved to Free [subscription id] | — | 1 |
| `subscription.payment_receipt` | any captured payment: purchase, renewal, upgrade, add-on, ₹0 [payment id] | invoice PDF | 1 |
| `subscription.payment_failed` | one-time payment failed or window closed [payment id] | — | 1 |
| `subscription.renewal_reminder` | no AutoPay: 7, 3 and 1 days before the renewal date [subscription id + period end + days] | — | 1 |
| `subscription.change_scheduled` | cancel, downgrade, yearly → monthly, add-on reduce/remove scheduled [subscription id + change] | — | 1 |
| `subscription.change_undone` | a scheduled change undone [subscription id + change] | — | 1 |
| `subscription.change_applied` | scheduled change took effect at period end [subscription id + date] | — | 1 |
| `subscription.staff_access_ending` | 3 days before staff are deactivated by a downgrade or expiry (today's `accountAccessEmail`) [subscription id + date] | — | 1 |
| `subscription.expired` | plan expired, moved to Free; lists staff deactivated [subscription id + period end] | — | 1 |
| `subscription.price_change` | a new plan version raises this owner's price at next renewal [owner + plan version] | — | 1 |
| `subscription.support_adjustment` | Super Admin extended / gave free time (O) [payment id] | — | 1 |
| `subscription.account_closed` | owner closed; billing stopped (N) [owner + date] | — | 1 |
| `autopay.enabled` / `autopay.disabled` / `autopay.method_changed` | AutoPay changes [mandate id + event] | — | 2 |
| `autopay.upcoming_charge` | when the renewal charge is created: amount and date [payment id] | — | 2 |
| `autopay.charge_failed` | a renewal charge failed, next try date [payment id + attempt] | — | 2 |
| `autopay.limit_too_low` | next charge above the mandate limit [subscription id + period end] | — | 2 |

Today's 16 send functions map onto these 20 events; the separate add-on expiry emails go, because
add-ons now follow the subscription period.

### Webhook

`POST /subscription/razorpay`: verify signature on the raw body → insert into
`subscription_webhook_events` (duplicate `event_id` → reply 200, do nothing) → reply 200 at once →
a worker processes it, retries on failure, stores the error. Only events for our orders/tokens are
handled; patient and appointment payments are ignored. Route **not** behind the general rate limit.

### Read endpoints

`GET /my-subscription`, `/auto-renew/status`, `/billing-history`, invoice download read **our DB
only** — they never call Razorpay.

---

## 6. Module structure

```
src/main/subscription/
  index.ts                 the only public surface
  routes/v1/     today's routes — kept working until every screen has moved, deleted in step 10.3
  routes/v2/     the new, correctly named routes (decision Y, §6.2)
    subscription.route.ts   /api/v2/subscription           current plan, plans list, activity
    checkout.route.ts       /api/v2/subscription/checkout  quote, start, verify, failed
    changes.route.ts        /api/v2/subscription/changes   preview, schedule, undo
    payments.route.ts       /api/v2/subscription/payments  billing history, retry
    invoices.route.ts       /api/v2/subscription/invoices  invoice PDF
    addOns.route.ts         /api/v2/subscription/add-ons   catalog, quote, checkout, changes
    autopay.route.ts        /api/v2/subscription/autopay   status, set up, verify, change method, turn off
    limits.route.ts         /api/v2/subscription/limits    plan limits and usage
    webhooks.route.ts       /api/v2/subscription/webhooks  POST /razorpay
    superadmin.route.ts     /api/v2/subscription/superadmin  plans, versions, plan limits, coupons
  controllers/   HTTP only (v2 controllers in controllers/v2/, playbook §1 rule 5)
  services/      one-way imports: core ← limits ← addons ← billing ← autopay; notify is a leaf
    core/        plans, subscriptions, state (expiry), firstPlan, access
    limits/      planLimit, staffLimit, storage, usage
    addons/      catalog, purchase, change
    billing/     pricing, coupons, payments (activatePayment), invoices, webhook, reconcile
    autopay/     mandates, renewal
    notify/      emails, reminders, activity
  gateway/       razorpay.client.ts — the only file that calls the Razorpay SDK
  middlewares/   subscriptionAccess, limitation (src/middlewear/* re-export them)
  models/ schemas/ types/ utils/ __tests__/
```

- `loadRoutes` mounts `routes/v2/{name}.route.ts` at `/api/v2/subscription/{kebab-name}`
  (`subscription.route.ts` → `/api/v2/subscription`), so each v2 file has its own mount and no
  `/:id` route can catch a sibling's path. Same layout as the `credits` and `treatmentPlan` modules
  (resource nouns, plural, kebab-case, actions as a sub-path, `superadmin.route.ts`).
- Every route: `requireAuth` → `requireRole([...])` → `requireClinic`, 2-line header.
- `routes.guard.test.ts` asserts every route has `requireSuperAdmin` or `requireClinic`
  (exempt: `GET /plans`, webhook).
- Outside code (lab, pharmacy, users, clinic, crons, adapters) imports only from `index.ts`.
- Other modules' data (staff counts, clinic owner/email) comes through ports (§1): `StaffPort`,
  `UsagePort`, `ClinicPort`. Razorpay Route account events (`account.*`, `product.route.*`) move
  to the module that owns `clinic_payment_accounts`.

### 6.1 Routes: 73 → ~45

Checked 2026-11-03: a route counts as used only if a screen uses its RTK hook.

**Removed (28 — no screen calls them)**

| Area | Routes |
|---|---|
| Plans | `DELETE /plans/:id`, `POST /initial-subscribe` |
| Immediate cancel | `PUT /cancel/:subscriptionId`, `PUT /addons/cancel/:clinicAddOnId` |
| Combined checkout (D6) | `POST /subscribe-with-addons`, `/verify-combined-purchase`, `/preview-combined-price` |
| Reminders (cron sends them) | `POST /reminders/send-expiry-reminders`, `/reminders/send-to-clinic` |
| Staff limits (server applies them) | `POST /limitations/enforce-staff-limits`, `/limitations/reactivate-staff` |
| Limit checks (covered by `/limitations/overview`) | `GET /limitations/check/:featureKey`, `/limitations/storage`, `/limitations/storage-retention`, `/limitations/payment-history-retention`, `GET /addons/limits` |
| Add-on extras | `GET /addons/pricing`, `/addons/my-addons`, `/addons/cancellation-preview/:clinicAddOnId` |
| Super Admin add-ons (F) | `POST/GET /addons`, `PATCH/DELETE /addons/:id`, `GET /addons/plan-limits/:planId`, `PUT /addons/plan-limits` |
| Others | `GET /coupons/:id`, `GET /coupons/my-history`, `GET /plan-limits/:planId` |

**Same job → one internal function (URLs kept)**

| Job | URLs | One function |
|---|---|---|
| Apply a payment | `/verify-subscription`, `/addons/verify-purchase`, `/auto-renew/verify`, webhook | `activatePayment()` |
| Change at period end | `/schedule-cancel`, `/undo-cancel`, `/schedule-downgrade`, `/undo-downgrade`, `/addons/schedule-cancel`, `/addons/undo-cancel`, `/addons/reduce-quantity` | one scheduled change (cancel = move to Free) |
| Price quote | `/quote`, `/addons/quote`, `/auto-renew/preview` | one pricing service |
| AutoPay | `/subscribe-autopay`, `/auto-renew/*` (7) | one mandate service |

FE dead code (optional, §8): `getSubscriptionStatus` calls `GET /subscription`, which has no
backend route; `GET /plans` is defined twice; ~10 hooks are unused.

### 6.2 v2 routes (decision Y)

Today's v1 names break the repo convention (verbs at the top level, `my-` prefixes, singular and
plural mixed, Super Admin routes mixed in). The rebuild serves **correctly named routes under
`/api/v2/subscription`**; v1 keeps working until every screen has moved, then is deleted (step 10.3).
The dangerous v1 routes (immediate cancel and the other unused ones) still go early, in step 3.2.

| v1 today | v2 |
|---|---|
| `GET /plans` | `GET /subscription/plans` (public) |
| `GET /my-subscription` | `GET /subscription/current` |
| `GET /activity` | `GET /subscription/activity` |
| `POST /quote` | `POST /subscription/checkout/quote` |
| `POST /subscribe` | `POST /subscription/checkout` (`Idempotency-Key` header) |
| `POST /verify-subscription` | `POST /subscription/checkout/:paymentId/verify` |
| `POST /report-payment-failed` | `POST /subscription/checkout/:paymentId/failed` |
| `POST /users/verify-subscription` (trial) | `POST /subscription/trial` (moved in step 4.2; the users route is gone) |
| `POST /check-downgrade` | `POST /subscription/changes/preview` |
| `PUT /schedule-downgrade`, `PUT /schedule-cancel` | `POST /subscription/changes` (`{ type: downgrade \| cycle_change \| cancel }`) |
| `PUT /undo-downgrade`, `PUT /undo-cancel` | `DELETE /subscription/changes/scheduled` |
| `GET /billing-history` | `GET /subscription/payments` |
| `POST /payment/retry` | `POST /subscription/payments/:paymentId/retry` |
| `GET /invoice/:invoiceId/download` | `GET /subscription/invoices/:invoiceId/pdf` |
| `GET /addons/available` | `GET /subscription/add-ons` |
| `POST /addons/quote` | `POST /subscription/add-ons/quote` |
| `POST /addons/purchase`, `POST /addons/verify-purchase` | `POST /subscription/add-ons/checkout`, `POST /subscription/add-ons/checkout/:paymentId/verify` |
| `PUT /addons/reduce-quantity/:id`, `PUT /addons/schedule-cancel/:id` | `PATCH /subscription/add-ons/:subscriptionAddOnId` (`{ scheduledQuantity }`, 0 = remove) |
| `PUT /addons/undo-cancel/:id` | `DELETE /subscription/add-ons/:subscriptionAddOnId/scheduled-change` |
| `GET /auto-renew/status`, `GET /auto-renew/preview` | `GET /subscription/autopay`, `GET /subscription/autopay/next-charge` |
| `POST /subscribe-autopay`, `POST /auto-renew/enable`, `POST /auto-renew/verify` | `POST /subscription/autopay` (set up, optionally with a purchase), `POST /subscription/autopay/verify` |
| `POST /auto-renew/replace`, `POST /auto-renew/replace/cancel` | `PUT /subscription/autopay/method`, `DELETE /subscription/autopay/method/pending` |
| `POST /auto-renew/disable` | `DELETE /subscription/autopay` |
| `GET /limitations/overview` | `GET /subscription/limits` |
| `POST /coupons/validate` | `POST /subscription/checkout/quote` (coupon is part of the quote) |
| `POST /razorpay` (webhook) | `POST /subscription/webhooks/razorpay` (Razorpay dashboard URL updated at go-live) |
| Super Admin `POST/PATCH /plans`, `PATCH /manage-features/:planId`, `/plan-limits/*` | `/subscription/superadmin/plans`, `/superadmin/plans/:planId/versions`, `/superadmin/plan-limits` |
| Super Admin `/coupons`, `/coupons/:id`, `/coupons/:id/stats` | `/subscription/superadmin/coupons`, `/superadmin/coupons/:couponId`, `/superadmin/coupons/:couponId/stats` |

Rules: the step that rebuilds an endpoint adds its v2 route and moves the screen to it in the same
step (FE + BE commit messages); v2 responses are designed for the screen (the contract fixtures from
step 0.1 guard v1 only while it lives); v1 and v2 never write different data — v1 handlers call the
same services until they are deleted.

---

## 7. Steps — one step, one commit

**How every step runs**

1. I do only that step.
2. I run its **real check** (the endpoints listed, hit against a running server; Razorpay test mode
   where it says so) and report what passed and what didn't. I do **not** run `jest`, `eslint` or
   `tsc` (owner's rule): I name the test file and changed files, and you run them — the commit hook
   runs them too. Exception: the money tests before each release, with the existing script.
3. I stop and give you the commit message. **You** review the changes and commit; I never run
   `git add`, `git commit` or `git push`.
4. Next step starts only when you say so.

Every commit **compiles and its checks pass**. The branch is not deployed while it is being built,
so between steps 4.1 and 5.4 paid checkout on the branch is incomplete; that is expected and is
shown in the "Works after" column.

### Phase 0 — Safety net

| Step | What | Check | Commit message |
|---|---|---|---|
| 0.1 | `src/scripts/subscriptionContract.ts`: calls the 14 read-only v1 endpoints (8 Admin GETs, 3 Admin POST quote/pre-check calls, 3 Super Admin GETs) on a running server and saves each response **shape** (field names + types, no values) to `src/main/subscription/__tests__/contract/*.shape.json`; `--check` reports removed or retyped fields. Endpoints that charge or change data are checked by hand in their own steps | `--record` then `--check` → "All shapes match" | `test(subscription): record API contract shapes` |
| 0.2 | Tests that pin today's pricing math (the existing `pricing.service.test.ts` already covers upgrade credit and renewals): `billingCycle.utils.test.ts` (yearly price, unused-days credit, cycle read from old provider ids — used by the carry-over), `coupon.math.test.ts` (fixed / percentage / cap / applies-to, incl. today's C1 and C7 behaviour), `addOnProRata.test.ts` (days-left price monthly and yearly). Cases a later decision changes say so (K, T, U, H) | owner runs the three files; all pass | `test(subscription): cover pricing math before rebuild` |

### Phase 1 — Data model (models only; you run the migration)

| Step | What | Check | Commit message |
|---|---|---|---|
| 1.1 | **Additive only, so today's code keeps working:** `subscription_plans` gets `owner_type`, `kind`, `is_active` and the one-trial / one-fallback-per-owner-type unique rules; new `plan_versions`; optional `plan_version_id` on `plan_features` and `plan_add_on_limits` (old `plan_id` stays for today's code; its unique rules go in step 7.4); the seed sets `kind`, creates version 1 of each plan from today's price (once) and links features and limits to it. Kept-table conversions (timestamptz, `owner_*` on activity/usage, nullable add-on prices) are done in the step that rebuilds that table's code | IDE clean; you run the migration; seed runs twice and the second run changes nothing | `feat(subscription): plan kind, owner type and plan versions` |
| 1.2 | New tables `subscriptions` and `subscription_add_ons` (`models/ownerSubscription.model.ts`): owner type + id, plan version, status, billing cycle, period, `billing_anchor_day`, `is_trial`, scheduled change; one current row per owner; add-ons follow the subscription (one active row per add-on); CHECK rules on period, anchor day, quantities; enums prefixed `subscription_` | IDE clean; nothing reads or writes them yet; you run the migration | `feat(subscription): add subscriptions and add-on tables` |
| 1.3 | New tables `subscription_payments`, `subscription_invoices`, `subscription_invoice_sequences` (`models/subscriptionPayment.model.ts`; JSON types in new `types/subscriptionPayment.types.ts`). Money in `bigint` paise. Database-level guards: unique Razorpay payment id, same idempotency key = same row (X1), one open checkout per owner (X2), one renewal per subscription period (X6), one invoice per payment, invoice total = taxable + taxes, manual adjustment needs ₹0 + reason + who. `mandate_id` comes with the mandates table in 1.4 | IDE clean; nothing reads or writes them yet; you run the migration | `feat(subscription): add payments and invoices tables` |
| 1.4 | New tables `subscription_mandates` (`models/subscriptionMandate.model.ts`: AutoPay per owner, limit in paise, one active per owner) and `subscription_webhook_events` (`models/subscriptionWebhookEvent.model.ts`: unique Razorpay event id, worker status and retries); `subscription_payments.mandate_id` added with its FK and index | IDE clean; all 11 subscription models load (columns, indexes, checks, FKs as designed); you run the migration | `feat(subscription): add mandates and webhook event tables` |
| 1.5 | Carry-over script (staging and prod), **nothing deleted**: current plan → `subscriptions` (same plan version, end date, status; `is_trial` for trials), active add-ons → `subscription_add_ons`, real past payments (`pay_…`) + their coupon → `subscription_payments` (captured). Dry run prints a report first; safe to rerun | dry run report matches clinic and payment counts; second run changes nothing; old tables unchanged | `chore(subscription): carry existing clinic plans into new tables` |

### Phase 2 — Module skeleton (no behaviour change)

| Step | What | Check | Commit message |
|---|---|---|---|
| 2.1 | `index.ts` re-exporting what outside code imports today. Folders are created with their first file; `gateway/razorpay.client.ts` comes with the first new Razorpay call (Phase 5), since today's calls are mostly the old Subscriptions API that is deleted | app starts; route list unchanged | `refactor(subscription): public index for outside callers` |
| 2.2 | The 19 outside importers + 4 crons import from `index.ts` | same + guarded lab/pharmacy route 403/200 | `refactor(subscription): outside callers use the module index` |
| 2.3 | `CacheKeys` for every subscription key, same strings; `autoRenew.service`, `combinedPurchase.service` and their one-off keys are left as they are, since they are deleted (3.2) or rebuilt (Phase 8) | same | `refactor(subscription): cache keys through CacheKeys` |

### Phase 3 — Access and cleanup

| Step | What | Check | Commit message |
|---|---|---|---|
| 3.1 | `requireRole(['Admin', 'Super_Admin'])` on billing routes (D2); `routes.guard.test.ts` | Receptionist → 403, Admin → 200 | `fix(subscription): billing routes for Admin and Super Admin only` |
| 3.2 | Remove the 28 unused routes (§6.1) and code only they used | route list = §6.1 kept list | `refactor(subscription): remove unused routes` |

### Phase 4 — Core on the new tables

| Step | What | Check | Works after |
|---|---|---|---|
| 4.1 | `subscriptionState`, plans and subscription read services on new tables; `nextPeriodEnd(start, cycle, anchorDay)` for decision K (+ tests); the seed manages only version 1 and stops deleting features by `plan_id` | tests pass, including anchor cases: 15th → 15th · Jan 31 → Feb 28 → Mar 31 · Feb 29 yearly → Feb 28 · Dec 31 → Jan 31 · IST end of day; seed run after a version 2 exists leaves version 2 and its limits untouched | — |
| 4.2 | Free plan and trial rules (§5 "Free plan and free trial"): `assignFreePlan`, trial in the API, trial-end cron creating the Free row, `noSubscriptionTakenTillNow` from the same rule | new clinic → Free; trial twice → 409; trial on a paid plan → 409; trial end → Free row (the trial-end email comes with step 9.2); button and API agree | Free and trial |
| 4.3 | Access guards from plan features (`isFeatureEnabled`) on every paid route; limits read the new tables; caches with TTLs | Free clinic → same answer on lab and pharmacy routes, matching its features; expired → 403, active → 200 | Free and trial |
| 4.4 | `GET /my-subscription`, `/limitations/overview` on new tables, no Razorpay calls; add-on limits read `subscription_add_ons` | contract fixtures match | Free and trial screens |
| 4.5 | Scheduled downgrade / cancel / undo + its cron | schedule → apply at period end | Plan changes for free/trial; renewal works only for the same plan and cycle, so with a downgrade scheduled renewal is refused (undo it first) and at period end the clinic moves to the scheduled plan or Free |

Commit messages: `feat(subscription): subscription state on new tables` · `feat(subscription): single first-plan path, trial once` · `feat(subscription): access guards and limits on new tables` · `feat(subscription): my-subscription and limits overview on new tables` · `feat(subscription): scheduled plan changes on new tables`

### Phase 5 — One-time payments

Webhook: one URL for now, `/api/v1/subscription/razorpay`, events `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`. Events for new checkouts go to the inbox queue; all others still go to the old handler (old add-on flow) until it is removed. Moves to the v2 URL at cutover (see checklist).

| Step | What | Check | Works after |
|---|---|---|---|
| 5.1 | new `gateway/razorpay.client.ts` (the only file that calls the Razorpay SDK) with order + payment fetch; `POST /subscribe` creates the payment row first; checkout idempotency (§5 Idempotency) | order created, row `created` | — |
| 5.2 | `activatePayment()` in one transaction; `POST /verify-subscription` uses it; `/report-payment-failed` marks the row; a captured duplicate is refunded automatically (X8) | test mode: pay → plan on; verify twice → one payment | **Buy a plan** |
| 5.3 | Webhook inbox + worker; route outside the general rate limit; only our orders handled; payload cleared 90 days after processing | close tab before verify → webhook turns plan on; replay event → no change | Buy, with backup |
| 5.4 | Coupons: uses counted from captured payments + conditional `current_uses`; coupon clean-up (H: remove the `trial` type and `expired` status, `applies_to` = all / plans / add-ons + lists, converting existing rows) — moved here from 1.1 because today's coupon code uses those values | coupon at its limit → refused | Buy with coupon |
| 5.5 | Upgrade (R) and monthly → yearly switch; `/payment/retry` | one pricing for quote and checkout (purchase, renewal, upgrade, to_yearly; credit for days left); renewal extends the same row, a change replaces it and moves add-ons; same-cycle upgrade mid-period → pays the difference for days left and **keeps the renewal date**; monthly → yearly → new anchor that day; yearly → monthly only scheduled (S); a plan with no yearly price can't be bought yearly (T) | Upgrade |
| 5.6 | Daily payment check (cron) | captured payment with no plan → fixed by the cron | Missed payments recovered |

Commit messages: `feat(subscription): create payment record before the order` · `feat(subscription): single activatePayment path` · `feat(subscription): webhook inbox with retries` · `feat(subscription): coupon limits from captured payments` · `feat(subscription): upgrades and payment retry` · `feat(subscription): daily payment reconciliation`

### Phase 6 — Invoices and billing history (needs D7)

Also in 6.2: cache `GET /plans` in Redis; FE loads billing history only when its section opens. After Phase 7 and auto-pay: fold add-on summary and auto-pay status into `my-subscription`, so the Subscription page needs 2 calls instead of 7.

| Step | What | Check | Commit message |
|---|---|---|---|
| 6.1 | Issue `subscription_invoices` on capture: number series, GST per D7, stored PDF; reuse the billing module's financial-year / number helper if it exists by then (`docs/billing/DEV_PLAN.md` step 1), never a second copy. Separate from the money module: `money_entries` is patient → clinic money, this is clinic → MediArogya | one invoice per payment, numbers in sequence | `feat(subscription): stored invoices with a number series` |
| 6.2 | `GET /billing-history`, invoice download read payments + invoices | contract fixtures match | `feat(subscription): billing history from payments` |

### Phase 7 — Add-ons

Also in Phase 7 (FE, `SubscriptionBilling.tsx`): refetch on tab focus only while an external payment tab is pending; after verify refetch only `my-subscription` + `user` (the mutation tags refresh the rest); each action refetches only what it changed. One payment goes from about 30 calls to about 5.

| Step | What | Check | Commit message |
|---|---|---|---|
| 7.1 | `GET /addons/available`, `POST /addons/quote` on new tables | pro-rated amount right | `feat(subscription): add-on catalog and quote on new tables` |
| 7.2 | `POST /addons/purchase` + `/addons/verify-purchase` through `activatePayment` | buy mid-cycle → quantity up, one payment | `feat(subscription): add-on purchase through activatePayment` |
| 7.3 | Reduce / cancel / undo at period end (limits already count add-ons from `subscription_add_ons` since step 4.4) | reduce → applied at period end | `feat(subscription): add-on changes at period end` |
| 7.4 | Super Admin plan versions: API to create a version (monthly and/or yearly price, limits, start date) and hide a plan; drop the old unique rules on (`plan_id`, `feature_key`) and (`plan_id`, `add_on_id`) so each version has its own rows; `LimitationService.getPlanLimit` reads by `plan_version_id`; `SubscriptionPlans.tsx` uses it | new version → new buyers get its price from its start date; current clinics keep theirs until renewal; seed run leaves version 2 untouched | `feat(subscription): Super Admin plan versions` |

### Phase 8 — AutoPay (needs D8)

| Step | What | Check | Commit message |
|---|---|---|---|
| 8.1 | Gateway: customer, token registration, recurring charge, token cancel | test mode calls work | `feat(subscription): Razorpay recurring payments client` |
| 8.2 | Mandate setup: `/auto-renew/enable`, `/verify`, `/status`, `/preview`, `/subscribe-autopay` | card, UPI, eMandate → mandate `active` | `feat(subscription): AutoPay mandate setup` |
| 8.3 | Renewal cron: charge plan + add-ons 3 days before the renewal date; `pending` handling (decision L) | test mode renewal → period extended to the **same anchor date**; a pending payment keeps access and starts no second charge | `feat(subscription): AutoPay renewals` |
| 8.4 | Failed renewal: retries, `past_due`, expiry to Free | failing card → past_due → expired | `feat(subscription): failed renewal handling` |
| 8.5 | Replace method, disable; cancel/plan change keeps or stops the mandate correctly | disable → token cancelled at Razorpay | `feat(subscription): replace and disable AutoPay` |
| 8.6 | `onOwnerClosed()` (decision N), called from the clinic module's deactivate / block / delete / reset / restore paths; reset and delete also end the owner's current `subscriptions` row so `assignFreePlan` can give it Free | deactivate a clinic with AutoPay → token cancelled, subscription `cancelled`, payments kept; restore → Free | `feat(subscription): stop billing when an account is closed` |

### Phase 9 — Emails, reminders, activity

| Step | What | Check | Commit message |
|---|---|---|---|
| 9.1 | Fire the email events (§5 Emails) through `NotifyPort` after commit; registry entries + templates in the notifications module (decision W; stop-gap queue adapter only if its email channel isn't ready) | each event sent once; server restart mid-send → still delivered; rerun → no second email; invoice PDF attached | `feat(subscription): subscription email events through notifications` |
| 9.2 | Reminder, trial, change, staff-access, expiry, price-change and support emails (crons + events, catalogue §5 Emails) | cron run twice → no duplicates; no card/UPI details in any email | `feat(subscription): reminder and lifecycle emails` |
| 9.3 | Activity timeline (`GET /activity`) | contract fixture matches | `feat(subscription): activity timeline on new tables` |
| 9.4 | **Switch the outside readers** to the new tables through `index.ts`: Super Admin dashboard (`adapters/superadminAnalytics/sourceData.adapter.ts` — revenue, trials), credits limits (`adapters/credits/plan.adapter.ts`), clinic profile plan (`ClinicService.getClinicByUserId`). Last step of Release 1, before go-live | Super Admin revenue/trial numbers match the payments table; WhatsApp limits match the plan version; clinic profile shows the current plan; grep finds no other reader of the old tables | `refactor(subscription): outside readers on the new tables` |

### Phase 10 — Finish

| Step | What | Check | Commit message |
|---|---|---|---|
| 10.1 | FE changes (§8) | browser click-through: billing pages, keyboard pass, dark mode | `feat(subscription): AutoPay notices and role-gated reminders` (FE repo) |
| 10.2 | Ports (`StaffPort`, `UsagePort`, `ClinicPort`); Route account events moved out | module imports no other module's models | `refactor(subscription): reach other modules through ports` |
| 10.3 | Delete `routes/v1/` (every screen is on v2) and the old services/models; after a full DB backup, **rename** `clinic_subscriptions`, `clinic_add_ons`, `coupon_usage` to `legacy_*` (you run the migration) — rows kept | no import of old models left; row counts in `legacy_*` = before; full FE click-through | `refactor(subscription): remove old subscription code, archive old tables` |

Prod: `migrations/prod` is behind staging (0001 vs 0015); the first prod migration bundles
unrelated tables, so plan that deploy separately.

### Releases (decision P)

| Release | Steps | Clinics get |
|---|---|---|
| **1** | Phases 0–7 · Phase 9 · step 8.6 without the mandate part · step 10.1 Release 1 rows (§8) | buy and renew by paying, coupons, upgrades, add-ons, stored invoices, emails; AutoPay shown as "coming soon" |
| — | watch 2–4 weeks on production | |
| **2** | Phase 8 · step 10.1 Release 2 rows (§8) | AutoPay |
| After | 10.2 ports · 10.3 archive old tables (only after Release 1 has run 2–4 weeks) | — |

### Go-live and rollback (each release)

Production today holds only plan data (Free and trial), no payments.

1. Back up the production database.
2. Carry-over **dry run**: prints counts only (e.g. "120 clinics: 90 Free, 30 trial"), changes nothing.
3. Counts right → deploy, run the carry-over for real. Old tables are not touched.
4. Watch 2–4 weeks: alerts, billing pages, the first real payments.
5. Only then step 10.3 renames the old tables to `legacy_*`.

### Release 1 go-live checklist (step 10.1c — you run every line, staging first, then prod)

Tick each line with its proof. Scripts are dry runs unless `--apply`; all are safe to rerun.

**Before the deploy**
- [ ] `npm test` and `npm run lint` green on BE; `npm run lint` and `npm run build` green on FE
- [ ] `npm run notifications:docs` and `npm run notifications:parity` clean
- [ ] Full DB backup taken — proof: backup file name + size noted here
- [ ] Prod migration planned separately (prod is at 0001, staging at 0015: the first prod migration bundles unrelated tables)
- [ ] Env set on the server: `INVOICE_SELLER_NAME / _ADDRESS / _CITY / _STATE / _STATE_CODE / _POSTAL_CODE / _GSTIN`, `INVOICE_SAC_CODE`, `INVOICE_PREFIX` (accountant-confirmed), `RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET` (live keys on prod)

**Deploy (in this order)**
1. [ ] Migrations up to and including 7.4a-1
2. [ ] `npx tsx src/scripts/backfillPlanVersionLimits.ts` → counts right → `--apply`
3. [ ] Migration 7.4a-2 (`plan_version_id` NOT NULL) — fails loudly if step 2 missed a row
4. [ ] `NODE_ENV=<env> npx tsx src/scripts/carryOverSubscriptions.ts` → counts match the old tables (e.g. "120 clinics: 90 Free, 30 trial") → `--apply`
5. [ ] `NODE_ENV=<env> npx tsx src/scripts/cleanupCoupons.ts` → `--apply`
6. [ ] Deploy BE, then FE
7. [ ] Razorpay dashboard: webhook URL → `https://<host>/api/v2/subscription/webhooks/razorpay`, same secret as `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed` (plus the Route `account.*` events the clinic payout setup already uses)

**Smoke test right after (one test clinic)**
- [ ] Plans page shows the version prices; yearly shows "Not sold this way" where no yearly price
- [ ] Buy a plan with a real ₹1 test coupon or the smallest plan → "Payment processing" clears → invoice in billing history, PDF downloads, email with the invoice arrives once
- [ ] Add-on purchase, upgrade (renewal date unchanged), cancel at period end + Undo
- [ ] Super Admin: create a plan version, coupons page, set the test clinic Inactive → plan ended in the timeline
- [ ] AutoPay shows "Coming soon" everywhere

**First 2–4 weeks**
- [ ] Daily: webhook inbox has no rows stuck in `processing`; the daily payment check log has no errors
- [ ] Every captured payment has an invoice; no clinic has two current subscriptions
- [ ] Then step 10.3 (cleanup) and Release 2 (AutoPay)

**Rollback:** redeploy the previous version. The old tables still hold every clinic's plan, so
nothing is lost; a clinic created after go-live has no old row and the old code already falls back
to the Free plan for it.

### Cleanup checklist (step 10.3, after Release 1 has run 2–4 weeks)

Cleanup removes code and renames tables — **it never deletes data**. Each line is ticked with its
proof before the step is committed.

**Backend**

- [ ] `src/main/subscription/routes/v1/` deleted — proof: the startup route list shows no `/api/v1/subscription`
- [ ] v1 controllers and every service, util and schema only v1 used — proof: no import of them left (`grep`)
- [ ] Old services split or replaced (`subscription.service`, `autoRenew.service`, `addon.service`, `limitation.service`, `combinedPurchase.service`, `subscriptionVerification.service`, `renewalReminder.service`, `accountAccessEmail.service`, `addOnExpiryReminder.service`, `subscriptionPurchaseEmail.service`) — proof: no import left
- [ ] Old models `clinic_subscriptions`, `clinic_add_ons`, `coupon_usage` out of the code — proof: no import of them left
- [ ] Old Redis keys gone from code (`clinic_active_subscription:`, `clinic_plan:`, `user_subscription_expiry:`, `pending_autopay_*`, `razorpay_plan:` …) — proof: all keys come from `CacheKeys`
- [ ] `YEARLY_DISCOUNT`, `billingCycleFromProviderId` text guessing, `incrementUsage` / `utils/usageTracker.ts` deleted
- [ ] Retired coupon enum values dropped (`discount_type.trial`, `coupon_status.expired`, `applies_to.specific_plans` / `specific_addons`) and `coupons.trial_days` removed, after `cleanupCoupons.ts --apply` ran on every database — proof: the cleanup dry run lists 0 coupons
- [ ] Old subscription email templates in `src/htmltamplates/` deleted once their events live in the notifications module
- [ ] `src/middlewear/subscriptionAccess.middleware.ts` / `limitation.middleware.ts` re-exports kept or callers moved to `index.ts`
- [ ] `/users/verify-subscription` (old trial route) removed once the screen uses `POST /subscription/trial`
- [ ] Razorpay dashboard webhook URL points only at `/api/v2/subscription/webhooks/razorpay`; old Razorpay Subscriptions plans/webhook events switched off
- [ ] Old tables renamed after a full DB backup: `legacy_clinic_subscriptions`, `legacy_clinic_add_ons`, `legacy_coupon_usage` — proof: row counts equal before and after (you run the migration)
- [ ] Docs: the old v1 docs are deleted; `SUBSCRIPTION_EMAIL_FUNCTIONALITY.md` is replaced or updated by one current doc, so nobody builds against v1

**Frontend**

- [ ] Every subscription hook in `redux/api/subscriptionApi.ts` calls `/api/v2/subscription` — proof: `grep "/subscription/"` finds no v1 path
- [ ] Unused hooks and types for removed routes deleted (combined checkout, immediate cancel, `getSubscriptionStatus`, duplicate `GET /plans`, …)
- [ ] `useSubscriptionCheckout.ts` has no code for removed flows
- [ ] `components/subscription/PlanCheckoutModal.tsx` deleted (nothing imports it)
- [ ] `npx eslint` on the changed files clean; browser click-through of the billing pages, Super Admin plans and coupons

**Later, separate decision:** dropping the `legacy_*` tables for good.

---

## 8. Frontend changes

FE changes are allowed wherever the rebuild needs them (§1). Each one ships in the same step as the
BE change it depends on, follows `CLAUDE.md`'s UX rules and the FE playbook, and is checked against
the user stories (`Medi_Arogya_FE/docs/SUBSCRIPTION_USER_STORIES.md`, US-x.x below) with a
browser click-through, a keyboard pass and a dark-mode pass.

### Remove (no screen needs them)

| Change | Where | With step |
|---|---|---|
| Hooks for the 28 removed routes: combined checkout, immediate cancel, `getSubscriptionStatus` (calls a route that doesn't exist), duplicate `GET /plans`, ~10 unused hooks | `redux/api/subscriptionApi.ts`, `hooks/useSubscriptionCheckout.ts` | 3.2 |
| Subscription calls for roles that don't need them: `RenewalReminderManager` → Admin only; `WidgetLoader` → skip Patient (check staff use first) | `components/subscription/RenewalReminderManager.tsx`, `components/WidgetLoader.tsx` | 4.4 |
| Billing cycle sent by the client for add-ons (the server decides it from the plan) | `hooks/useSubscriptionCheckout.ts`, add-on modals | 7.2 |

### Change (Release 1)

| Change | User story | Where | With step |
|---|---|---|---|
| Plan cards: monthly-only / yearly-only plans from nullable prices | US-1.1 | `components/subscription/PlanCard.tsx`, `PlanComparison.tsx` | 4.4 |
| Trial button: "Trial already used" state, 409 message | US-1.3 | `components/subscription/PromoSidebar.tsx`, `OnboardingDash/pages/ClinicSetup.tsx` | 4.2 |
| My Subscription: status in words, renewal date from `current_period_end`, "Payment processing" state | US-3.1, 3.2, 2.6 | `pages/subscription/SubscriptionBilling.tsx` | 4.4, 5.2 |
| Checkout: amount breakdown before paying (proration, coupon), ₹0 "Activate plan", closed-window / failed messages, no raw backend text | US-2.1–2.4 | `hooks/useSubscriptionCheckout.ts`, checkout modals | 5.2, 5.4 |
| Checkout idempotency: one `Idempotency-Key` (UUID) per checkout sent on create; "Pay" disabled while it runs; reopening the same checkout reuses the key | US-2.1, X1 | `hooks/useSubscriptionCheckout.ts` | 5.1 |
| Upgrade preview with "renewal date stays …"; monthly → yearly; yearly → monthly only as scheduled | US-4.1–4.3 | upgrade/downgrade modals | 5.5 |
| Cancel: period-end only, danger button + confirm naming plan and date, Undo | US-4.5 | `SubscriptionBilling.tsx` | 4.5 |
| Add-on modal: pro-rated amount now + next renewal total, cycle from the plan | US-5.1, 5.2 | `ManageAddonModal.tsx`, `UpgradeAddOnsModal.tsx` | 7.1–7.3 |
| Billing history: invoice number, "Paid via …", same stored PDF, ₹0 invoices, empty state | US-6.1, 6.2 | `BillingHistoryCard.tsx`, `SubscriptionInvoices.tsx` | 6.2 |
| Optional **GSTIN** field, format-checked, shared `InputField` | US-6.3 | clinic profile page | 6.1 |
| AutoPay card: "coming soon", disabled with a tooltip | US-8.0 | `SubscriptionBilling.tsx` | 5.2 |
| Super Admin plans: create a **new version** (monthly and/or yearly price, limits, start date) instead of editing in place; hide instead of delete | US-9.1, 9.2 | `pages/dashboard/superadmin/SubscriptionPlans.tsx`, `planlimt/` | 4.6 |
| Super Admin coupons: remove the "Free trial" type and the two `specific_*` options (`applies_to` = all / plans / add-ons + optional lists); percentage 1–100 | US-9.3 | `pages/dashboard/superadmin/CouponFormModal.tsx` | 5.4 |

### Change (Release 2)

| Change | User story | Where | With step |
|---|---|---|---|
| AutoPay setup: method, limit, date; pending bank approval state | US-8.1 | `AutoPayFlowModal.tsx`, `SubscriptionBilling.tsx` | 8.2 |
| Renewal processing / failed banner with "Pay now"; "Payment overdue" status | US-8.2, 8.3 | `SubscriptionBilling.tsx` | 8.3, 8.4 |
| "Approve a higher AutoPay limit" notice; yearly > ₹15,000 recommends bank AutoPay | US-8.4, 8.5 | AutoPay card | 8.3 |
| Change method / turn off AutoPay with confirm | US-8.6 | AutoPay card | 8.5 |

### Super Admin — where each part lands

Before any Super Admin (or other) FE screen is changed, the **MediArogya Frontend Design Spec** is read
for that module and its Feature-tracker row is updated afterwards (`CLAUDE.md`). It is not shared
with the account this plan was written from, so it is still to be read.

| Part | Release · step |
|---|---|
| Super Admin routes in their own files, `requireSuperAdmin` on each | 1 · Phase 3 (route split) |
| Plans: create a **version** (monthly and/or yearly price, limits, start date); hide a plan | 1 · step 7.4 (API + `SubscriptionPlans.tsx`) |
| Coupons: create / edit / stats with the cleaned-up rules | 1 · step 5.4 (API + `CouponFormModal.tsx`) |
| Duplicate-charge refunds (automatic, alert on failure) | 1 · step 5.2 |
| Dashboard numbers — the live dashboard is the **`superadminAnalytics`** module (`docs/superadmin/SUPERADMIN_MODULE.md`, `SUPERADMIN_ANALYTICS_API.md`: MRR, MRR bridge, plan mix, collected, trial→paid, Clinic 360° timeline, follow-ups). FE `docs/super-admin-dashboard-api.md` is now a frontend map of these screens and endpoints (rewritten 2026-11-03; it used to describe the removed `/dashboard/super-admin`) | 1 · step 9.4 — **only `adapters/superadminAnalytics/sourceData.adapter.ts` changes**; the module and its screens stay as they are (it already reads through `SourceDataPort`). See the adapter rules below |
| Credits (`docs/credits/WHATSAPP_QUOTA_PLAN.md`): free messages reset on the clinic's renewal day via `PlanPort.getBillingAnchor` | 1 · step 9.4 — `adapters/credits/plan.adapter.ts` reads `billing_anchor_day` (K) and limits from the plan version; not `starts_at`, which changes on an upgrade (R) while the renewal day does not |
| "Help a clinic" screen (extend days, free months — decision O) | later, own approval |
| Add-on catalog screen (F), general refunds (Q), a clinic's payment list | later, own approval |

**Super Admin analytics adapter rules (step 9.4)** — what each `SourceDataPort` call reads after
the rebuild, so the numbers stay correct:

| Port call | Today | After |
|---|---|---|
| `getSubscriptionSpans` (MRR, bridge, trial→paid) | one span per `clinic_subscriptions` row; monthly value = `price` (yearly ÷ 12); free by slug | one span per **paid period** from captured `subscription_payments` (`period_start` → `period_end`, amount; yearly ÷ 12), plus trial and Free spans from `subscriptions` (`is_trial`, plan `kind`). Renewals extend one subscription row, so spans must come from payments or price changes and upgrades would be lost from MRR history |
| `getMoney` (collected, failed) | sum of `subscription_activity.amount` | captured `subscription_payments.amount` (refunds subtracted); failed = `status failed` |
| `getSubscriptionEvents` (Clinic 360° timeline) | `subscription_activity` | unchanged — the activity table is kept |
| Paid / trial / free flags | `payment_status`, `isTrialPlan`, slug | captured payment · `is_trial` · plan `kind` |
| Time zones (`SUPERADMIN_MODULE.md` §6) | `clinic_subscriptions` dates are UTC in zone-less columns, shifted with `utcToStored` | new tables are `timestamptz`: **no shift** — applying `utcToStored` to them would move every date by 5½ hours |
| Follow-up `trial_ending` | trial plan + `expires_at` | `subscriptions.is_trial` + `current_period_end` |

Check: overview and revenue numbers before and after the switch are compared on staging; any
difference is explained by the list-price → captured-amount change.

### Later (own approval)

Super Admin "help a clinic" screen (US-9.4, decision O) · refunds and credit notes (Q).

FE commits are made in the FE repo on its own `fix/subscription-rebuild` branch; each step's hand-over
names both commit messages when it touches both repos.

---

## 9. Review findings → where they are fixed

| # | Finding | Fixed by |
|---|---|---|
| 1 | Any staff role can cancel or change billing | `requireRole(['Admin', 'Super_Admin'])` (D2) |
| 2 | AutoPay keeps charging after cancel or plan change | mandates belong to the clinic; cancel stops the token |
| 3 | Webhook-first purchase half done | one `activatePayment` |
| 4 | User expiry cache without TTL → lockout | `CacheKeys` + TTLs, one invalidation group |
| 5 | Two expiry rules; renewal-day staff and add-on loss | `subscriptionState`; add-ons follow the subscription period |
| 6 | Webhook always replies 200 | webhook inbox + worker retries |
| 7 | Failed upgrade marks current plan failed | failures recorded on the payment row only |
| 8 | Approval resets plan to 30 days | removed (decision C) |
| 9 | Swallowed errors, raw messages | playbook §6 |
| T1 | Free trial repeatable, replaces a paid plan | once per clinic (decision C) |
| R1 | AutoPay amount can't change on UPI/eMandate | Recurring Payments (decision B) |
| R2 | Patient payments treated as subscription failures | webhook handles only our orders/tokens |
| R3 | Webhook slow, no event-ID check | webhook inbox |
| R4 | Webhook behind the general rate limit | route excluded |
| R5 | Add-on purchase can insert twice | unique keys on `subscription_payments` |
| R6 | Coupon over-redemption | conditional `current_uses` update in the payment transaction |
| S1 | Server down after payment → money taken, no plan | webhook retries + daily check |
| S2 | Crash between old plan off and new plan on | one transaction |
| F1 | Every app open calls Razorpay | read endpoints use our DB only |
| F2 | Non-admin staff load billing data; patients get 403 | FE role conditions (§8) |
| DB | Mixed transaction IDs, wrong prices, no invoice series | §4 model + `subscription_invoices` |
| C1–C9 | Coupon logic (§5 Coupons) | coupon rules in `billing/` + step 5.4 |
| FT1–FT6 | Free plan and trial logic (§5 "Free plan and free trial") | steps 4.2 (first plan + trial) and 4.3 (guards from plan features) |

---
User stories for UI design and testing: `Medi_Arogya_FE/docs/SUBSCRIPTION_USER_STORIES.md`.


## 10. Razorpay — what we use and the docs

All Razorpay calls sit in one file, `src/main/subscription/gateway/razorpay.client.ts`, so the
gateway can be changed later without touching the rest of the module.

### Used

| # | Razorpay feature | What we use it for | Release | Razorpay docs |
|---|---|---|---|---|
| 1 | **Orders API + Standard Checkout** (the payment window) | buy a plan, upgrade, add-ons, pay a renewal by hand — card, UPI, net banking, wallets. Order made on our server; signature checked against our stored order; plan on only when `captured` | 1 | [Standard Checkout steps](https://razorpay.com/docs/us/payments/payment-gateway/web-integration/standard/integration-steps) · [Payment capture settings](https://razorpay.com/docs/payments/payment-gateway/rainy-day/capture-settings/api/) |
| 2 | **Webhooks** | Razorpay tells our server "paid / failed / AutoPay approved / refunded" — the backup when the browser never reports back, and the only signal for AutoPay charges | 1 | [Webhook best practices](https://razorpay.com/docs/us/webhooks/best-practices/) · [Validate and test webhooks](https://razorpay.com/docs/us/webhooks/validate-test) |
| 3 | **Refunds API** | automatic refund of a duplicate charge (X8); `refund.processed` webhook confirms it | 1 | [Create a normal refund](https://razorpay.com/docs/api/refunds/create-normal/?preferred-country=IN) |
| 4 | **Recurring Payments** (token / mandate) | AutoPay on **UPI, card and bank (eMandate)**: the clinic approves once with a limit, our server charges plan + add-ons each cycle | 2 | [Recurring Payments overview](https://razorpay.com/docs/api/payments/recurring-payments/) · [UPI AutoPay](https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi/?preferred-country=IN) · [UPI registration](https://razorpay.com/docs/api/payments/recurring-payments/upi/create-authorization-transaction.md) · [UPI charges](https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments.md) · [Card charges](https://razorpay.com/docs/api/payments/recurring-payments/cards/create-subsequent-payments.md) · [eMandate charges](https://razorpay.com/docs/api/payments/recurring-payments/emandate/create-subsequent-payments.md) |

### Not used, and why

| Razorpay feature | Why not | Razorpay docs |
|---|---|---|
| **Subscriptions** (today's AutoPay) | the amount is fixed inside Razorpay and can be changed only for card, so add-ons and price changes never reach UPI/bank AutoPay | [Update a subscription](https://razorpay.com/docs/api/payments/subscriptions/update-subscription) |
| **Invoices** | we issue our own GST invoices (number series, CGST/SGST or IGST, stored once) | — |
| **Route** | used for paying clinics their appointment money; not part of subscriptions | — |
| Turning off customer receipts | **not possible** — Razorpay always emails the payer a bank receipt; ours carries the GST invoice | [Razorpay FAQ](https://razorpay.com/docs/us/payments/faqs) |

### Rules confirmed in the docs

- One-time: create the order on the server, pass `order_id` to Checkout, verify the signature with
  our stored order id, deliver only after `captured`; authorized payments left uncaptured are
  refunded by Razorpay.
- AutoPay: token `max_amount` = the most one charge may be; each charge is a new order + a
  recurring payment; the debit runs ~25 h (UPI) / ~36 h (card) after the pre-debit notice; Razorpay
  does **not** retry — we do; a charge above `max_amount` fails.
- Webhooks: verify the signature on the raw body; the same event can arrive twice
  (`x-razorpay-event-id`); a non-2xx reply is retried for 24 h.
- Refunds: only captured payments, within 6 months; no amount = full refund; normal speed 5–7
  working days.

### Still to confirm with Razorpay support (D8, before Release 2)

Our business category's limits (₹15,000 per charge without PIN? ₹99,999 per mandate?) · one
checkout that both pays and registers AutoPay · `frequency: as_presented` for card and eMandate ·
exact webhook event names for AutoPay · yearly charges above ₹15,000. Background (blog, not
official docs): [UPI AutoPay guide](https://razorpay.com/blog/master-recurring-payments-upi-autopay-guide/).

## Trial = the plan, free until its end (2026-11-11)

- A trial works like its paid plan priced monthly: add-ons can be bought (pro-rated to the trial end) and AutoPay can be set up.
- At the trial end it renews like a paid month (plan + add-ons): AutoPay charges it, or the clinic pays by hand in the last 7 days. Paying clears `is_trial`.
- Only the same plan, monthly, renews from a trial; any other plan is a fresh purchase (unpaid trial days are never credited). Add-ons move to the bought plan.
- An unpaid trial gets the 3 grace days (`past_due`), then falls to Free.

## Renewal popup knows AutoPay (built 2026-11-12)

**Bug (QA):** the expiry popup shows "Renew Now" while AutoPay is on and the renewal is scheduled.

**Cause:** the popup reads the plan from `GET /api/v1/clinic/user`, which has no AutoPay field. `RenewalReminderService` takes `autoRenew` but its expiring branch ignores it, and `RenewalReminderManager` never passes it.

**Options compared (owner asked for no extra calls, 2026-11-12):**

| Option | Extra calls | Duplication |
|---|---|---|
| New `/renewal-status` route | +1 per Admin session | Repeats plan, state, end date, grace already in `/clinic/user` |
| Reuse `/overview` | +1 heavy call on every page | Usage, invoices, add-ons loaded for a popup |
| **`autoPayOn` in `/clinic/user`, Admin only (chosen)** | **0** | None; one indexed one-row lookup for Admins only |

**Same popup, also wrong:**
- the footer offers "Enable AutoPay Mandate" when it is already on;
- "…for your extra Cloud Storage capacity" filler is added to every popup;
- trials now renew with AutoPay too, so they hit the same bug.

**Plan (presentation + one field; billing logic unchanged):**
1. **BE:** `SubscriptionReadService.autoPayOn(clinicId)`, public, wraps `AutoPayService.active`; `SubscriptionOverviewService` calls it instead of its private copy.
2. **BE:** `clinic.service.ts` adds `autoPayOn` to the `subscription` block of `/clinic/user` **only when `userType === 'Admin'`** and a plan is active; other roles get no field and no lookup.
3. **FE:** add `autoPayOn?: boolean` to the `/clinic/user` subscription type; `RenewalReminderManager` passes it as `autoRenew`.
4. **Popup rules (`RenewalReminderService`):**
   - AutoPay on and not in grace → **no popup** (the standard; the billing page and the "renews tomorrow" email inform);
   - AutoPay off → today's "Renew Now" popup;
   - grace → today's "Payment due" popup;
   - footer "Enable AutoPay" only when it is off; storage filler removed.
5. **No new route, no new call.** `/overview` unchanged.

**Status:** approved and built 2026-11-12 on `fix/subscription-rebuild` (BE + FE). AutoPay on/off also refreshes `/clinic/user` so the popup updates without a reload. Not yet tested in a browser.

## Billing page shows the AutoPay order already sent (built 2026-11-12)

**QA:** next charge showed ₹1,178.82 (GST on now) while the Razorpay renewal order was ₹999 (made while GST was off).

**Rule:** once the AutoPay renewal order and its pre-debit notice exist (`subscription_payments`: `kind = renewal`, status `created` / `pending`, `mandate_id` and `provider_order_id` set, `period_start` = current period end), the billing page shows **that order's amount and lines**, not today's prices or GST. Before the order exists it keeps showing the live estimate.

**Code:** `OwnerSubscriptionService.scheduledRenewal`; `renewalSummary` takes `scheduled`; `SubscriptionOverviewService` passes it. Display only: the charge, the invoice and the running renewal test are unchanged. Test in `__tests__/mySubscription.test.ts`.
