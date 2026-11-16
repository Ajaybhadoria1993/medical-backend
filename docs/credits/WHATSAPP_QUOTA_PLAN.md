# WhatsApp Quota & Credits — Plan

Status: **plan only, nothing built** (decisions agreed 2026-10-05).
Simple explanation with examples: `WHATSAPP_QUOTA_EXPLAINED.md`.

> **Phase 1 (building now):** free messages per plan, credits **granted and removed by Super Admin**, expiry, alerts, real cost, Super Admin settings and cost report.
> **On hold:** clinics **buying** credits (packs, Razorpay) and the per-plan "can buy" toggle. The subscription module is not touched in phase 1.

---

## 1. Why

- Meta charges us for **every WhatsApp message delivered** to a patient — [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing).
- All our messages (booking, reminder, lab report, invoice, etc.) are the same type, so they all cost the same: **≈ ₹0.136 each** incl. GST.
- Today every plan has **unlimited** WhatsApp. A busy clinic on a cheap plan costs us more than it pays.
- Meta gives volume discounts on our total platform usage — that saving is our margin.

## 2. Meta pricing — facts and sources

Checked 2026-10-05. India utility is **unchanged** in the 1 Oct 2026 rate card — the Oct changes cover Bangladesh, Iraq, Nepal, Sri Lanka, Kazakhstan, Kuwait, Morocco, Oman and Ukraine only. Recent India changes: 1 Jan 2026 marketing up, 1 Apr 2026 authentication-international up — **re-check the rate card before setting prices.**

### What one message costs (India)

| Message type | Meta rate | + 18% GST | Do we send it? |
|---|---|---|---|
| **Utility** (bookings, reminders, reports, invoices) | **₹0.115** | **≈ ₹0.136** | ✅ All our messages |
| Marketing (offers, promotions) | Raised on 1 Jan 2026 — check rate card | — | ❌ No |
| Authentication (OTP) | ≈ ₹0.115 | ≈ ₹0.136 | ❌ No (OTP goes by SMS) |

- Meta charges only when the message is **delivered**, not when it's sent.
- We connect to Meta **directly**, not through a reseller (WATI, Interakt, etc.), so there's **no extra markup** on top of Meta's rate. Resellers typically add ₹0.10–₹0.30 per message.
- **GST:** 18% is added to the Meta invoice. If MediArogya claims GST input credit, the real cost is ₹0.115.

### How many messages are free by default?

**For us: zero.** Meta has no free monthly allowance any more. Messages are free only in these cases:

| Free case | How it works | Applies to us? |
|---|---|---|
| Customer service window | Patient messages us first → for 24 hours, our replies and utility messages are free | ❌ We don't receive or reply to patient messages |
| Free entry point | Patient comes from a click-to-WhatsApp ad → everything free for 72 hours | ❌ We don't run WhatsApp ads |
| Service (non-template) replies | Free since 1 Nov 2024, but only inside the 24-hour window | ❌ Same reason |

All our messages are business-started (booking, reminder, report), so **every delivered message is paid.**

### Volume discount

- Counted on **our whole platform**, all clinics together, and resets every month.
- India utility: full rate up to about **7.5 lakh messages/month**; above that, discounts of roughly **6% to 30%** in steps.
- 7.5 lakh messages ≈ **170 busy clinics** (4,500 each) or **≈ 830 small clinics** (900 each). Once we pass it, our cost drops; clinic prices stay the same.

### Sources

- Meta — WhatsApp pricing (official): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta — pricing calculator, India · INR · Utility (official, **use this to check our rate**): https://whatsappbusiness.com/products/platform-pricing/?country=India&currency=Indian%20Rupee%20(INR)&category=Utility
- Meta — rate cards and volume tiers by country/currency (official, INR CSV/PDF): https://whatsappbusiness.com/products/platform-pricing/
- India rates, GST and volume tiers summarised (third-party, 2026): https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026
- India cost per message (third-party, 2026): https://chatmitra.com/blog/whatsapp-business-cost-per-message/
- Rates by country (third-party, Oct 2026): https://www.flowcall.co/blog/whatsapp-business-api-pricing

The marketing rate, the volume-tier numbers and GST are from the third-party summaries above. Confirm them on Meta's INR rate card before quoting them.

One third-party source says utility messages inside the 24-hour window are **charged from 1 Oct 2026**. Meta's own page still says free. This doesn't change our cost, since we never use that window.

## 3. Exact price calculation

All figures exact to the paisa. Other tables in this doc round to ₹0.136.

**Check the current rate here first (official Meta calculator, India · INR · Utility):**
https://whatsappbusiness.com/products/platform-pricing/?country=India&currency=Indian%20Rupee%20(INR)&category=Utility

How to use it:
1. Open the link — India, INR and Utility are already selected.
2. Read the **per-message rate**.
3. If it isn't ₹0.1150, put the new rate into Step 1 and follow Step 7 — every other number follows from it.

### Step 1 — cost of one message

```
Meta rate (India, Utility)      ₹0.1150
+ 18% GST     0.1150 × 0.18   = ₹0.0207
                                ────────
Cost per message                ₹0.1357
```

### Step 2 — cost for any number of messages

`Cost = messages × ₹0.1150 × 1.18 = messages × ₹0.1357`

| Messages | Meta charge | GST (18%) | **Total** |
|---|---|---|---|
| 1 | ₹0.1150 | ₹0.0207 | **₹0.1357** |
| 3 (one appointment) | ₹0.3450 | ₹0.0621 | **₹0.4071** |
| 100 | ₹11.50 | ₹2.07 | **₹13.57** |
| 1,000 | ₹115.00 | ₹20.70 | **₹135.70** |
| 10,000 | ₹1,150.00 | ₹207.00 | **₹1,357.00** |
| 1,00,000 | ₹11,500.00 | ₹2,070.00 | **₹13,570.00** |

### Step 3 — what a clinic costs us per month

`Messages/month = patients per day × 3 × working days`

| Clinic | Calculation | Messages | **Cost** |
|---|---|---|---|
| Small | 10 × 3 × 30 | 900 | **₹122.13** |
| Medium | 20 × 3 × 30 | 1,800 | **₹244.26** |
| Busy | 50 × 3 × 30 | 4,500 | **₹610.65** |
| Very busy | 150 × 3 × 30 | 13,500 | **₹1,831.95** |

### Step 4 — cost of each plan's free messages (worst case: all used)

`Cost = free messages × ₹0.1357` · `Share = cost ÷ plan price`

| Plan | Price | Free messages | **Max cost** | Share of price |
|---|---|---|---|---|
| Solo | ₹0 | 100 | **₹13.57** | — |
| Clinic | ₹499 | 1,000 | **₹135.70** | 27.2% |
| CareHub | ₹999 | 3,000 | **₹407.10** | 40.8% |

To pick free messages for a target share:
`Free messages = plan price × share ÷ 0.1357`
e.g. CareHub at 30% → `999 × 0.30 ÷ 0.1357 = 2,208` → round to **2,200**.

### Step 5 — credit pack profit

`Cost = credits × ₹0.1357` · `Profit = price − cost` · `Margin = profit ÷ price`

| Pack | Price | **Our cost** | **Profit** | Margin |
|---|---|---|---|---|
| 250 | ₹75 | ₹33.93 | **₹41.07** | 54.8% |
| 1,000 | ₹249 | ₹135.70 | **₹113.30** | 45.5% |
| 5,000 | ₹999 | ₹678.50 | **₹320.50** | 32.1% |

To price a pack for a target margin:
`Price = credits × 0.1357 ÷ (1 − margin)`
e.g. 1,000 credits at 45% → `135.70 ÷ 0.55 = ₹246.73` → round to **₹249**.

### Step 6 — Sunrise Clinic example, exact

| | Calculation | Amount |
|---|---|---|
| Messages sent | 1,000 free + 300 credits | 1,300 |
| Our WhatsApp cost | 1,300 × 0.1357 | **₹176.41** |
| Clinic pays (plan only, today) | | ₹499.00 |
| We keep today | 499 − 176.41 | **₹322.59** |
| Clinic pays (plan + 1,000 credits) | 499 + 249 | ₹748.00 |
| We keep this month | 748 − 176.41 | **₹571.59** |
| Later cost of 700 leftover credits | 700 × 0.1357 | ₹94.99 |
| **We keep overall** | 571.59 − 94.99 | **₹476.60** |

### Step 7 — when Meta changes its rate

Only the first number changes; every formula above stays the same.
`New cost per message = new Meta rate × 1.18`

| Meta rate | Cost per message | 1,000 messages | Clinic plan (1,000 free) share |
|---|---|---|---|
| ₹0.1000 | ₹0.1180 | ₹118.00 | 23.6% |
| **₹0.1150 (today)** | **₹0.1357** | **₹135.70** | **27.2%** |
| ₹0.1300 | ₹0.1534 | ₹153.40 | 30.7% |
| ₹0.1500 | ₹0.1770 | ₹177.00 | 35.5% |

### GST note

These figures treat GST as a cost. If MediArogya is GST-registered and claims input credit on Meta's invoice, the real cost is **₹0.1150** per message (≈ 15% lower). Our own GST on plan and pack prices is separate and not included here.

## 4. Cost at a glance

| Clinic size | Patients/day | Messages/month | Our cost/month |
|---|---|---|---|
| Small | 10 | ~900 | ~₹122 |
| Medium | 20 | ~1,800 | ~₹245 |
| Busy | 50 | ~4,500 | ~₹612 |
| Very busy | 150 | ~13,500 | ~₹1,836 |

Formula: `messages × ₹0.136`. One appointment ≈ 3 messages ≈ ₹0.41.

## 5. What we already have

- A monthly usage counter per clinic — built, but WhatsApp never uses it.
- A WhatsApp limit per plan — exists, set to unlimited everywhere.
- Super Admin plan-limits page — can already edit the WhatsApp limit.
- Super Admin "upgrade opportunities" — already counts clinics at their limit.
- Razorpay purchase flow for add-ons — a pattern we can copy for credits.
- Clinic billing page with usage bars — no WhatsApp bar yet.

Most of the groundwork exists; the work is connecting it.

## 6. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Monthly free messages | Set **per plan by Super Admin**. Reset on the clinic's **monthly renewal date**. Unused ones are lost. |
| 2 | Extra messages | Clinic buys **credits**. **1 credit = 1 message.** |
| 3 | Credit carry-forward | Credits **carry forward** from one month to the next. |
| 4 | Credit expiry | **1 year after purchase** by default, reminder 7 days before. Both editable by Super Admin. |
| 5 | Order of use | Free messages first, then credits — oldest credits first. |
| 6 | When everything runs out | **Only WhatsApp stops.** Booking, billing, lab and pharmacy always work. |
| 7 | Alerts | Clinic admin is told at the **warning point (80% by default, editable)** and when **paused**, once each per billing month. |
| 8 | Message types | One shared allowance for all message types. Current messages unchanged. |
| 9 | Who can buy credits | **Super Admin turns it on/off per plan.** |
| 10 | Plans where buying is off | **Super Admin adds credits** to the clinic manually. Same rules apply. |
| 11 | One credit pool or one per channel? | **One credit system, a separate balance per channel.** WhatsApp credits now; SMS (or other types) later reuse the same system with their own packs and balance. 1 credit = 1 message of that channel. A rupee wallet only if we reach 3+ channels at very different prices. |
| 12 | Credits on downgrade or cancel | Credits **stay usable** until they expire. **No automatic refunds.** Any exception is **Super Admin's call**: Super Admin can remove credits from a clinic, with a reason. A money refund, if agreed, is done by hand outside the system. |
| 13 | Credit packs | **Managed by Super Admin**: add, edit price and size, switch a pack off. The system starts with three default packs: **250 for ₹75**, **1,000 for ₹249**, **5,000 for ₹999**. |
| 14 | Joining mid-month | No special case. Free messages follow the **renewal date**, so a clinic joining on the 20th gets its full allowance from the 20th to the next 20th. |
| 15 | Fully dynamic | **Super Admin edits every value**, with no code change or deploy: free messages and can-buy per plan, packs, and per credit type the expiry, reminder days, warning %, Meta rate and GST. Changes apply at once; expiry changes apply to new credits only. |
| 16 | New plans | A new plan has no WhatsApp setting until Super Admin sets one. Until then: **unlimited** free messages (flagged "WhatsApp limit not set" on the plan-limits page) and **can buy credits**. |

Still open: if we ever send promotional messages (Meta charges several times more), the credit rule will need revisiting.

## 7. How it works

### Every time a message is about to go out

1. Clinic turned WhatsApp off for this message? → Not sent, nothing used.
2. Plan is unlimited? → Send.
3. Free messages left this billing month? → Send, use 1 free message.
4. Credits left? → Send, use 1 credit.
5. Nothing left? → Don't send. Alert the admin (once per billing month).

Only messages Meta actually accepts are counted. Failed ones use nothing.

### A clinic's billing month

Example: the clinic's plan renews on the **20th**.

- **20th (renewal day):** free messages reset. Leftover credits stay.
- **80% used:** admin alert + amber banner.
- **100% used:** switches to credits if any; if none, WhatsApp pauses + red banner.
- **Buys credits:** WhatsApp resumes immediately.
- **Next 20th:** starts again.

What sets the reset day:

| Plan | Free messages reset on |
|---|---|
| Monthly paid plan | Every renewal date |
| Yearly paid plan | Every month on the same day it started (e.g. started 20 Jan → 20 Feb, 20 Mar…). No yearly pool. |
| Free plan | Every month on the day the clinic joined or moved to the free plan |
| Start date is the 29th, 30th or 31st | The last day of shorter months |

### A credit pack's life

- **Bought or added by Super Admin** → available.
- Used after free messages each billing month; leftovers carry forward.
- **7 days before 1 year:** reminder to the admin.
- **1 year:** whatever is left expires.
- **Super Admin removes credits** (rare, with a reason) → gone straight away.

## 8. Who does what

| Who | Can do |
|---|---|
| **Super Admin** | Set free messages per plan · turn credit buying on/off per plan · manage credit packs (add, edit, switch off) · edit credit settings (expiry, reminder, warning %, Meta rate, GST) · add or remove a clinic's credits (with a reason) · see cost and margin per clinic |
| **Clinic admin** | See free messages used and credit balance · buy credits (if plan allows) · get alerts |
| **Doctor / receptionist** | Nothing changes for them |

Example plan setup:

| Plan | Free messages | Clinic can buy credits? |
|---|---|---|
| Solo (Free) | 100 | No — Super Admin adds, or clinic upgrades |
| Clinic (₹499) | 1,000 | Yes |
| CareHub (₹999) | 3,000 | Yes |
| Custom | Unlimited or custom | No — Super Admin handles |

## 9. What gets built

### Backend
- Every WhatsApp message knows **which clinic** it belongs to.
- Free-message count follows each clinic's **billing month** (renewal date), not the calendar month.
- Check free messages / credits **before** sending; count **after** Meta accepts.
- 80% / 100% alerts to the clinic admin.
- Record each message and its **real cost** from Meta's delivery report.
- Credits: buy with Razorpay, use oldest first, 1-year expiry, reminder 7 days before.
- Credits are built **by type** from day one. Only the WhatsApp type is switched on now; adding SMS later means adding its packs, not a new system.
- Credit packs stored and managed by Super Admin, seeded with the three defaults.
- Per-plan on/off for buying credits.
- Super Admin can add or remove a clinic's credits. Each change is kept permanently in the clinic's credit history, with who did it and why, and appears on the clinic's billing timeline.
- Super Admin report: messages, cost, credits sold and margin per clinic per month.

### Super Admin screens
- **Plan limits page:** free messages per plan (already there) + "can buy credits" on/off + a hint showing the monthly cost at that limit.
- **New Credits page** (sidebar, beside Subscription Plans and Plan Limits), three tabs:
  - **Settings:** per credit type: expiry, reminder days, warning %, Meta rate, GST, on/off.
  - **Packs:** size, price, order, on/off; add and edit.
  - **Cost report:** per clinic and platform totals for a chosen month.
- **Clinic 360° — new Credits tab:** balance per type, packs and grants with expiry, "Add credits" and "Remove credits" (choose the type, give a reason), history.

### Clinic screens
- **Billing page — WhatsApp card:**
  ```
  Free this billing month:  840 / 1,000   (resets 20 Nov)
  Credits:                  150           (50 expire on 5 Oct 2027)
  [ Buy credits ]
  ```
- **Buy credits:** pick from the packs Super Admin has switched on, pay with Razorpay, balance updates instantly. Hidden if the plan doesn't allow it — shows "Contact support or upgrade" instead.
- **Banners:** amber at 80%, red when paused. No banner while running on credits.

## 10. Plan lifecycle scenarios

Two rules cover almost everything:
- **Free messages** follow the clinic's **billing month** (from one renewal date to the next) and its **current** plan.
- **Credits** belong to the **clinic**, not the plan, so they survive any plan change until they expire.

How plan changes work today: an **upgrade starts a new billing period** straight away (the clinic pays the new price minus credit for unused days). A **downgrade or cancel takes effect at the end** of the current period.

### Joining

| Scenario | Free messages | Credits |
|---|---|---|
| New clinic on the free plan | Free plan's allowance (e.g. 100) from the day it joins | Can't buy if the plan has buying off; Super Admin can add |
| Joins a paid plan on the 20th | Full allowance from the 20th; resets every 20th | Can buy straight away |

### Changing plan

| Scenario | Free messages | Credits |
|---|---|---|
| Upgrade (1,000 → 3,000, 1,000 already used) | New billing period starts now → **fresh 3,000**. A paused clinic resumes. | Untouched; used only after the new allowance runs out |
| Downgrade (3,000 → 1,000) | Keeps 3,000 until the current period ends; 1,000 from the next renewal | Untouched |
| Monthly → yearly switch | New billing period starts → fresh allowance; then resets monthly on the new start day | Untouched |
| Moved to a custom plan by Super Admin | Same as upgrade or downgrade | Untouched |
| Moved to an unlimited plan | No limit | Kept but not used |

### Renewal and billing

| Scenario | Free messages | Credits |
|---|---|---|
| Plan renews | Fresh allowance on the renewal date | Untouched |
| Yearly plan | Monthly allowance, reset on the same day each month; no yearly pool | Untouched |
| Renewal day while running on credits | Fresh allowance, used first again | Stop being used until free messages run out |

### Ending and coming back

| Scenario | Free messages | Credits |
|---|---|---|
| Subscription expires / payment fails | Clinic drops to the free plan → free plan's allowance, resetting monthly from that day | Stay usable until they expire |
| Clinic cancels | Paid allowance until the period ends, then free plan's allowance | Stay usable until they expire. No automatic refund; Super Admin decides any exception. |
| Renews after a lapse | New billing period starts → fresh paid allowance | Untouched |

### Super Admin changes

| Scenario | Free messages | Credits |
|---|---|---|
| Changes a plan's free messages | Applies to every clinic on that plan straight away | Untouched |
| Turns credit buying off for a plan | No change | Clinics keep what they have but can't buy more |
| Edits or switches off a credit pack | No change | Credits already bought are unaffected; only new purchases see the change |
| Adds credits to a clinic | No change | Added immediately; same rules as bought ones |
| Removes credits from a clinic | No change | Removed immediately; who did it and why are kept in the credit history |
| Sets every plan back to unlimited (emergency) | No limit | Kept, not used |

### Credits over time

| Scenario | What happens |
|---|---|
| Two packs bought at different times | The one that expires sooner is used first |
| Credits expire in 7 days | One reminder to the admin with count and date |
| Credits reach 1 year unused | Removed, no refund |
| Credits run out mid-month | WhatsApp pauses until more are bought or the next renewal date |

### Other situations

| Situation | What happens |
|---|---|
| Payment done but page closed before confirming | Credits must still be added — handled the same way add-on payments are. |
| Many messages at once right at the limit | May go over by a few messages. Acceptable — a few paise. |
| Message accepted but not delivered | Counts against the allowance; Meta doesn't charge us. |
| Clinic turned WhatsApp off | Nothing sent, nothing used. |
| Go-live day falls part-way through a clinic's billing month | The clinic gets its full allowance from go-live until its next renewal date. |

## 11. Build order

Phase 1. Technical detail: `CREDITS_IMPLEMENTATION.md`.

| Step | What | Needs a database change |
|---|---|---|
| 1 | New credits module; link every message to its clinic and **start counting** (all plans still unlimited) | **Yes — all 3 tables, once** |
| 2 | Stop WhatsApp when nothing is left; warning and paused alerts | No |
| 3 | Record each message's real cost from Meta | No |
| 4 | Credits: Super Admin grant and remove, oldest-first use, expiry, reminder | No |
| 5 | Super Admin: credit settings, clinic credits, cost report | No |
| 6 | Clinic screen: WhatsApp usage card on Notification settings, banners | No |
| 7 | Super Admin screens: Credits page, Credits tab in Clinic 360° | No |

**Later (purchase phase):** credit packs, buying with Razorpay, per-plan "can buy credits" toggle.

## 12. Execution workflow

Six phases, in order. No clinic is limited before go-live, and credits are on sale before then.

| Phase | When | What | Done when |
|---|---|---|---|
| 1. Prepare | Week 1 | Confirm open points. Check Meta's rate. | Decisions signed off |
| 2. Start counting | Weeks 2–3 | Release steps 1–4 with every plan still unlimited | Every message counted per clinic |
| 3. Measure and build credits | Next month | Release steps 5–8. Collect one full month of usage. | Month of cost data; test purchase works |
| 4. Set limits and announce | 2 weeks before go-live | Agree free messages per plan, tell clinics, open credit sales | Clinics told, credits on sale |
| 5. Go live | Any agreed day | Super Admin enters the limits. Each clinic gets its full allowance until its next renewal date. | Limits active |
| 6. Monitor | First month | Track paused clinics, credits sold, complaints. Adjust limits. | One clean month |

**If it goes wrong:** Super Admin raises a plan's free messages, adds credits by hand, or sets plans back to unlimited. Each takes effect immediately.

## 13. How we'll test

- Plan with 3 free messages + 250 credits bought in test mode → book 5 appointments → 3 free + 2 credits used.
- Free messages reset on the clinic's renewal date, not the 1st. Yearly plan resets monthly on its start day; a 31st start resets on the last day of shorter months.
- Upgrade gives a fresh allowance at once; downgrade changes the allowance only at the next renewal.
- Super Admin edits a pack's price → new purchases use it; credits already bought are unchanged. Removing credits is logged with a reason.
- Alerts arrive once at 80% and once at 100%.
- No credits left → WhatsApp stops, booking still works.
- Oldest credits used first; expired credits ignored.
- Paying twice for the same order adds credits only once.
- Plan with buying off → no Buy button; Super Admin can still add credits.

## 14. Not in this plan

- Different limits per message type.
- Charging clinics after the fact instead of prepaid credits.
- Automatic refunds. Any refund is Super Admin's call, done by hand.
- Promotional (marketing) messages.
- SMS credits. The credit system is ready for them; switch on when patient SMS comes back (today SMS is OTP only).
- Countries other than India.
