# Super Admin billing: Razorpay match, AutoPay and money tools — plan

Status: **approved 2026-11-05** (Q1 yes · Q2 tab on Revenue · Q3 Super Admin only · Q4 email only). All 5 steps written 2026-11-05 (match job + Billing checks, Revenue cards + attention, clinic Billing tab, actions + audit, daily alert email); needs the billing_mismatches migration and a run on staging.

Goal: a Super Admin can see that our billing numbers match Razorpay, spot what needs a hand, and
fix it safely, using the pages that already exist instead of new parallel ones.

## 1. What already exists (kept)

| Page | Today | Data from |
|---|---|---|
| Revenue | MRR, average per clinic, collected, MRR bridge, plan mix, failed payments | subscription activity log (`SubscriptionReadService`, `subscription_activity`) |
| Overview | KPIs, **Attention** card | analytics adapter |
| Clinic detail | Overview, payments table, credits, activity log, timeline, support access | clinic + subscription read services |
| Audit log / Sessions | who did what, logins | `audit_logs` |
| Plans, Add-ons, Coupons, Credits | catalogue management | subscription / credits modules |

Gaps: the money figures come from the activity log, not from `subscription_payments`; nothing
compares us with Razorpay; AutoPay, webhooks and stuck refunds are invisible; billing fixes need SQL.

## 2. What we add (inside the existing pages)

| # | Where | What |
|---|---|---|
| A | **Revenue** | "Collected" and "Failed payments" read `subscription_payments` (the real money), activity log stays for history. New card **Razorpay match**: our total vs Razorpay's for the period, number of mismatches → link to B. New card **AutoPay**: active / paused / cancelled mandates, this week's charges paid / pending / failed, past-due clinics. |
| B | **Revenue → "Billing checks" tab** (new tab, not a new menu item) | Mismatch list from the daily check: captured at Razorpay but not applied · applied by us but refunded/failed at Razorpay · amount differs · refund owed but stuck · AutoPay mandate state differs. Each row: clinic, our ID, Razorpay IDs (link to the Dashboard), what differs, **Retry** / **Mark resolved** with a reason. Plus **Webhook health**: last event received, failed/retrying events. |
| C | **Overview → Attention** | New items: open mismatches, no webhook for 6 h in business hours, stuck refunds, past-due clinics. Each links to B or the clinic. |
| D | **Clinic detail → payments** | Each payment shows kind, status, Razorpay order/payment ID (link), refund state, invoice. New **AutoPay** block: on/off, method, limit, token ID, approved on, last sync. |
| E | **Clinic detail → actions** (Super Admin, reason required, audit-logged) | Refund a payment · extend the plan by N days · cancel AutoPay · grant WhatsApp credits (exists) · resend invoice. |
| F | **Audit log** | The E actions and B resolutions appear with their reason. |

## 3. Backend

| Step | What |
|---|---|
| 1 | Daily **match job** (extends `ReconcileService`, 23:45 IST, before PeriodEnd): Razorpay payments for the last 7 days (`GET /payments?from&to`, paged) vs our rows by order/payment ID; AutoPay tokens already synced by `AutoPayService.syncAll()`. Writes `billing_mismatches` (new table: kind, clinic, our payment id, Razorpay ids, ours vs theirs JSON, status open/resolved, resolved_by, reason). **You run the migration.** |
| 2 | Read endpoints in `superadminAnalytics` (through ports, not other modules' models): revenue from payments, Razorpay match summary, AutoPay summary, billing checks list, webhook health, clinic billing. |
| 3 | Action endpoints (Super Admin only, reason required, audit log): retry apply, resolve mismatch, refund, extend plan, cancel AutoPay. Refund/extend reuse `PaymentsService` / subscription services. |
| 4 | Alerts: an open mismatch, webhook silence or AutoPay failure spike emails the Super Admins once a day (notifications module). |

## 4. Order (each step: commit message, user checks)

1. Match job + `billing_mismatches` + Billing checks tab (B) — the core answer to "are we in sync".
2. Revenue cards A + Attention items C.
3. Clinic detail D.
4. Actions E + audit F.
5. Alerts (step 3.4).

## 5. Not in this plan

- **Razorpay Route** (clinic payouts for appointments) stays in the clinic/appointment modules; a
  Route admin page is a separate plan.
- MRR/churn redesign — Revenue already has MRR and the bridge; only the money source changes.

## 6. Questions

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Revenue "Collected" switches from the activity log to `subscription_payments`. Past months may show small differences where the log missed a payment. OK? | Yes, switch |
| Q2 | Billing checks as a **tab on Revenue** or its own menu item? | Tab on Revenue |
| Q3 | Who may refund / extend: every Super Admin, or a named few? | Every Super Admin, reason required |
| Q4 | Alerts by email only, or Slack/WhatsApp too? | Email only |
