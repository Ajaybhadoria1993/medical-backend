# WhatsApp Messages — How It Works

Technical plan: `WHATSAPP_QUOTA_PLAN.md`. Numbers below are examples.

---

## 1. In short

- Each WhatsApp message costs us **₹0.136** (Meta's ₹0.115 + 18% GST). [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- Meta gives us **no free messages** — every delivered message is paid. Details and sources: plan doc, section 2.
- Check the current rate: [Meta calculator — India · INR · Utility](https://whatsappbusiness.com/products/platform-pricing/?country=India&currency=Indian%20Rupee%20(INR)&category=Utility)
- Every plan gets **free messages each month** (e.g. 1,000). They **reset on the plan's monthly renewal date**.
- Need more? The clinic **buys credits**. **1 credit = 1 message.**
- Credits **carry forward** and **expire after 1 year**.
- Free messages are used **first**, credits **after**.
- If both run out, **only WhatsApp stops**. Booking, billing, lab and pharmacy keep working.

---

## 2. Free messages vs credits

| | Free messages | Credits |
|---|---|---|
| Comes from | The plan | Clinic buys them |
| Left over at renewal | **Lost** | **Carried forward** |
| Expires | Each renewal date | 1 year after purchase |
| Used | First | After free ones run out |

Like a phone: free messages = **monthly plan**, credits = **recharge**.

---

## 3. Who controls what

Super Admin decides, **per plan**:
- How many **free messages** a month.
- Whether clinics can **buy credits themselves**.

| Plan (example) | Free messages | Clinic can buy credits? | If not |
|---|---|---|---|
| Solo (Free) | 100 | ❌ No | Super Admin adds credits, or clinic upgrades |
| Clinic (₹499) | 1,000 | ✅ Yes | — |
| CareHub (₹999) | 3,000 | ✅ Yes | — |
| Custom / special clinic | Unlimited or custom | ❌ No | Super Admin handles it |

| Who | Can do |
|---|---|
| **Super Admin** | Set free messages per plan · turn credit buying on/off per plan · manage credit packs (sizes, prices) · change credit expiry, reminder, warning %, Meta rate and GST · add or remove a clinic's credits (e.g. goodwill, offline payment) |
| **Clinic admin** | See usage and credits · buy credits (only if the plan allows) |
| **Doctor / receptionist** | Nothing — WhatsApp just works or doesn't |

Credits added by Super Admin work the same as bought ones: carry forward, expire after 1 year.

---

## 4. How each message is decided

1. **Free messages left?** → Send, use 1 free message.
2. **No free messages, but credits left?** → Send, use 1 credit.
3. **Nothing left?** → Don't send WhatsApp. Everything else still works.

---

## 5. Example — Sunrise Clinic

Plan: **₹499/month**, **1,000 free messages**, renews on the **1st**. Needs **1,300 messages** a month.

| When | Free | Credits | What happens |
|---|---|---|---|
| 16th | 800 / 1,000 | 0 | ⚠️ Alert: 80% used |
| 20th | 1,000 / 1,000 | 0 | 🔴 WhatsApp paused |
| 21st | used up | **+1,000 bought** | ✅ WhatsApp back on |
| Before renewal | used up | **700 left** | — |
| Next renewal (1st) | **fresh 1,000** | **700 carried forward** | Free used first |

---

## 6. Pricing

**What we pay Meta**

| Messages | Cost |
|---|---|
| 1 | ₹0.136 |
| 1,000 | ₹136 |
| 1 appointment (~3 messages) | ₹0.41 |

**Why we need a limit** — today WhatsApp is unlimited:

| Clinic | Messages/month | Our cost | On ₹499 plan |
|---|---|---|---|
| Small (10 patients/day) | 900 | ₹122 | ✅ OK |
| Busy (50 patients/day) | 4,500 | ₹612 | ❌ Loss ₹113 |
| Very busy (150 patients/day) | 13,500 | ₹1,836 | ❌ Loss ₹1,337 |

**Credit packs**

| Pack | Price | Our cost | Our profit |
|---|---|---|---|
| 250 | ₹75 | ₹34 | ₹41 |
| 1,000 | ₹249 | ₹136 | ₹113 |
| 5,000 | ₹999 | ₹680 | ₹319 |

**Sunrise Clinic's month**

| | Today | With credits |
|---|---|---|
| Clinic pays | ₹499 | ₹748 |
| Our WhatsApp cost | ₹177 | ₹177 |
| **We keep** | **₹322** | **₹571** |

---

## 7. FAQ

**Do free messages carry forward?** No. Fresh ones on each renewal date.

**Do credits carry forward?** Yes, until used or 1 year old.

**Refund for expired credits?** No. Reminder 7 days before (Super Admin can change this).

**Refund if the clinic downgrades or cancels?** No automatic refund. Credits stay usable until they expire. Super Admin decides any exception.

**Are skipped messages sent later?** No.

**Does a failed message use a credit?** No.

**Is a booking ever blocked?** No. Only WhatsApp stops.

**Will SMS have credits too?** Later, yes, with their own balance. WhatsApp credits can't pay for SMS, and SMS credits can't pay for WhatsApp. 1 credit = 1 message of that channel.
