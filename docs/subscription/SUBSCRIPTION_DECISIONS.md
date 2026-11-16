# Subscription rebuild — decisions and pending items

Short summary for review. Full detail: `SUBSCRIPTION_REBUILD_PLAN.md` (same folder); data model:
`SUBSCRIPTION_MODEL.dbml`; user stories: `Medi_Arogya_FE/docs/SUBSCRIPTION_USER_STORIES.md`.

Last updated: 2026-11-03. Status: **plan ready, waiting for approval** — no code changed yet.

---

## Why we are rebuilding

A review of the current subscription code found money problems, for example:

- Any staff member (receptionist, nurse) could cancel or change the clinic's plan.
- After a cancel or plan change, AutoPay **kept charging** the clinic.
- AutoPay amounts **could not change** for UPI and bank AutoPay, so add-ons were never charged.
- If the server went down after a payment, the money could be taken with **no plan** turned on.
- The free trial could be **taken again and again**, and it switched off a paid plan.
- Invoices **changed over time** (dates and amounts), had no proper number series, and always used
  CGST + SGST even for other states.
- Renewal dates **drifted** (30 days instead of the same date every month).

The module is **not live** for payments yet (clinics are only on Free or trial), so we can fix it
properly now. **No existing data is lost.**

---

## Decisions taken

| # | Decision |
|---|---|
| A | Not live for payments, so the core is rebuilt cleanly. |
| B | AutoPay uses **Razorpay Recurring Payments**: our server sets the amount each month, so add-ons work on card, UPI and bank. |
| C | One way to get a first plan: **Free** when the clinic is created, and the **free trial once** per clinic. |
| D | Existing clinics (staging and production) are **copied** into the new tables with the same plan and end date. Nothing is deleted. |
| D2 | Only the clinic **Admin** and **Super Admin** can buy, cancel or change a plan. |
| D6 | The unused "plan + add-ons in one payment" feature is removed (easy to add back). |
| D9 | Clinics can add their **GSTIN** (optional), printed on invoices. |
| E | 28 API routes no screen uses are removed (73 → about 45). |
| F | Super Admin add-on management routes removed now; a proper screen later. |
| G | **Plan versions**: Super Admin can change price or limits **from a future date**; existing clinics move at their next renewal. |
| H | Coupon clean-up: the "trial" coupon type is removed (it gave a whole year free by mistake). |
| I | A coupon applies to **one payment only**; renewals are full price. |
| J | An invoice is issued for **every sale, including ₹0** (like ChatGPT/Stripe). None for Free, trial or failed payments. |
| K | **Must:** the renewal date is the **same date every month/year** (15th → 15th; 31 Jan → 28 Feb → 31 Mar). |
| L | **Must:** a payment still being processed **never blocks** a clinic. |
| M | Subscriptions belong to an **owner** (clinic, lab or pharmacy), ready for labs and pharmacies to split off. |
| N | When a clinic is deactivated or deleted, **AutoPay is cancelled** and billing stops; records are kept. |
| O | Support (Super Admin) can extend days or give free months — recorded with who, when and why. |
| P | **Two releases**: Release 1 = plans, payments, invoices, add-ons, emails (AutoPay "coming soon"). Release 2 = AutoPay. |
| Q | Refunds in general come later (Super Admin only). |
| R | An upgrade **keeps the renewal date**; the clinic pays only the difference for the days left. |
| S | Yearly → monthly only at the end of the year. |
| T | Monthly and yearly prices are **separate and each optional**. |
| U | Super Admin enters the yearly price directly (no hidden 20% formula). |
| V | One list of every subscription email; each sent **once**. |
| W | Emails are sent by the **notifications (email) module**; subscription only reports what happened. Emails are **always sent** (no on/off option). |
| X | **Idempotency**: one click = one charge; double clicks, two tabs, repeated webhooks or jobs never charge twice. |
| X8 | A real duplicate charge is **refunded automatically** and the clinic is emailed. |
| Y | **Clean API names (v2):** new routes follow the repo naming rules under `/api/v2/subscription`; screens move one by one; the old v1 routes are deleted at the end. |

---

## Razorpay features we use

| Feature | Used for | Release | Docs |
|---|---|---|---|
| **Orders + Checkout** (payment window) | buying a plan, upgrade, add-ons, paying a renewal by hand | 1 | [Standard Checkout](https://razorpay.com/docs/us/payments/payment-gateway/web-integration/standard/integration-steps) |
| **Webhooks** | Razorpay telling us "paid / failed / refunded" | 1 | [Best practices](https://razorpay.com/docs/us/webhooks/best-practices/) |
| **Refunds** | automatic refund of a duplicate charge | 1 | [Create a refund](https://razorpay.com/docs/api/refunds/create-normal/?preferred-country=IN) |
| **Recurring Payments** | AutoPay on UPI, card and bank; our server sets each month's amount | 2 | [Recurring Payments](https://razorpay.com/docs/api/payments/recurring-payments/) · [UPI AutoPay](https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi/?preferred-country=IN) |

Not used: **Razorpay Subscriptions** (its amount can only change for card —
[docs](https://razorpay.com/docs/api/payments/subscriptions/update-subscription)) and **Razorpay
Invoices** (we issue our own GST invoices). Details: plan §10.

---

## Pending — needs an answer

| # | Who | Question | Needed before |
|---|---|---|---|
| D7 | **Accountant** | GST rules (CGST + SGST for Madhya Pradesh, IGST for other states?), invoice number format (`MS/2026-27/0001`?), prices including GST or not, SAC code, how long to keep invoices, heading for ₹0 invoices | Invoices (Phase 6) |
| D8 | **Razorpay support** | AutoPay limits for our business type (₹15,000 per charge? ₹99,999 per mandate?), yearly charges above ₹15,000, one-step "pay + turn on AutoPay", webhook event names | AutoPay (Release 2) |
| W | **Client** | Allow email in the notifications module (lift "Standing Rule 11") for subscription emails | Emails (Phase 9) |
| — | **Team** | Confirm production `AWS_REGION` is Mumbai (`ap-south-1`) so invoices and data stay in India | Go-live |
| — | **You** | Share the **Medisetu Frontend Design Spec** (claude.ai doc) with the account doing the work — `CLAUDE.md` requires reading it before any screen changes | First frontend step (4.1) |
| — | **Reviewers** | **Approve the plan** so work can start | Start |

Note for reviewers: after Release 1, the Super Admin analytics (MRR, collected, plan mix) come from
real captured payments instead of list prices, so they will be exact and may differ from today's
numbers. The Super Admin screens themselves do not change; only the data connector does.

Defaults are written in the plan for D7 and D8, so the build does not wait for these answers.

---

## How the work runs

- About **40 small steps**, one commit each; every step is checked before the next.
- The owner reviews and commits each step; nothing is pushed without asking.
- Database migrations are run by the owner.
- Go-live: backup → test run of the data copy → deploy → watch 2–4 weeks → only then archive the
  old tables. If anything breaks, go back to the old version; nothing is lost.
- Cleanup (after 2–4 weeks live): old v1 routes, old code and old email templates are deleted, old
  tables are only renamed `legacy_*` (no data deleted). Full checklist: plan §7 "Cleanup checklist".
