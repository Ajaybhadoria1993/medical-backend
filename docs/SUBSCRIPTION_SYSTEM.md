# Subscription & Add-On System Documentation

## Overview

The subscription system manages clinic plans, feature limits, add-on purchases, and billing lifecycle. It integrates with Razorpay for payments and uses Redis for caching.

---

## Database Schema

### subscription_plans

Master table of available plans (e.g., Solo, CareHub).

| Column      | Type          | Description                                   |
| ----------- | ------------- | --------------------------------------------- |
| id          | UUID (PK)     | Plan identifier                               |
| slug        | VARCHAR(80)   | Unique slug (e.g., "solo", "carehub-monthly") |
| name        | VARCHAR(150)  | Display name                              |
| description | VARCHAR(255)  | Plan description                          |
| price       | DECIMAL(12,2) | Monthly base price in INR                 |
| currency    | VARCHAR(8)    | Currency code (default: INR)              |
| created_at  | TIMESTAMP     |                                           |
| updated_at  | TIMESTAMP     |                                           |

### clinic_subscriptions

Tracks which plan each clinic is on. One active record per clinic at a time.

| Column                   | Type          | Description                                   |
| ------------------------ | ------------- | --------------------------------------------- |
| id                       | UUID (PK)     |                                               |
| clinic_id                | UUID          | Reference to clinic                           |
| plan_id                  | UUID (FK)     | References subscription_plans                 |
| starts_at                | TIMESTAMP     | When subscription started                     |
| expires_at               | TIMESTAMP     | When subscription expires (null = never/Solo) |
| active                   | BOOLEAN       | Whether this is the current active sub        |
| provider                 | VARCHAR(80)   | Payment provider (razorpay, manual, coupon)   |
| provider_subscription_id | VARCHAR(200)  | Billing cycle identifier or provider ref      |
| payment_status           | VARCHAR(20)   | pending, success                              |
| payment_mode             | VARCHAR(20)   | upi, card, online, free, coupon               |
| transaction_id           | VARCHAR(50)   | Razorpay payment ID                           |
| price                    | DECIMAL(12,2) | Actual amount paid                            |
| cancel_at_period_end     | BOOLEAN       | If true, won't renew after expires_at         |
| cancelled_at             | TIMESTAMP     | When user requested cancellation              |
| cancellation_reason      | VARCHAR(255)  | Optional reason from user                     |
| auto_renew               | BOOLEAN       | If true, Razorpay auto-charges before expiry  |
| razorpay_subscription_id | VARCHAR(200)  | Razorpay recurring subscription ID            |
| created_at               | TIMESTAMP     |                                               |
| updated_at               | TIMESTAMP     |                                               |

### plan_features

Per-plan feature configuration (limits, boolean flags, marketing features).

| Column               | Type         | Description                             |
| -------------------- | ------------ | --------------------------------------- |
| id                   | UUID (PK)    |                                         |
| plan_id              | UUID (FK)    | References subscription_plans           |
| feature_key          | VARCHAR(100) | Unique key (e.g., "doctor_accounts")    |
| display_name         | VARCHAR(150) | Human-readable label                    |
| description          | VARCHAR(255) |                                         |
| type                 | VARCHAR(20)  | numeric, boolean, marketing             |
| limit_value          | INTEGER      | Numeric cap (null for boolean features) |
| is_unlimited         | BOOLEAN      | If true, no numeric cap                 |
| enabled              | BOOLEAN      | Is feature available on this plan?      |
| sort_order           | INTEGER      | Display ordering                        |
| is_marketing_feature | BOOLEAN      | Highlighted in plan comparison UI       |

**Feature Keys in Use:**

| Key                         | Type    | Solo Plan | Clinic Plan | CareHub Plan |
| --------------------------- | ------- | --------- | ----------- | ------------ |
| doctor_accounts             | numeric | 1         | 1           | 2            |
| staff_accounts              | numeric | 1         | 1           | 4            |
| whatsapp_messages_per_month | numeric | unlimited | unlimited   | unlimited    |
| cloud_storage               | numeric | 100 MB    | 500 MB      | 3 GB         |
| storage_months              | numeric | 3         | unlimited   | unlimited    |
| payment_history_months      | numeric | 3         | unlimited   | unlimited    |
| lab_integration             | boolean | disabled  | disabled    | enabled      |
| pharmacy_integration        | boolean | disabled  | disabled    | enabled      |
| dashboard_full_access       | boolean | disabled  | disabled    | enabled      |
| reports_analytics           | boolean | disabled  | disabled    | disabled     |
| custom_branded_rx           | boolean | disabled  | enabled     | enabled      |
| ocr_prescription_scan       | boolean | disabled  | disabled    | enabled      |
| smart_prescriptions         | boolean | enabled   | enabled     | enabled      |
| chatbot_support             | boolean | disabled  | enabled     | enabled      |
| priority_support            | boolean | disabled  | disabled    | enabled      |
| add_ons                     | boolean | disabled  | enabled     | enabled      |
| waiting_room_queue          | boolean | enabled   | enabled     | enabled      |

### add_ons

Master catalog of purchasable add-ons.

| Column        | Type          | Description                           |
| ------------- | ------------- | ------------------------------------- |
| id            | UUID (PK)     |                                       |
| name          | VARCHAR(150)  | Display name                          |
| description   | TEXT          |                                       |
| feature_key   | VARCHAR(100)  | Links to limit system (unique)        |
| unit_value    | INTEGER       | Value added per unit (e.g., 1 doctor) |
| monthly_price | DECIMAL(12,2) | Price per month                       |
| yearly_price  | DECIMAL(12,2) | Price per year (10% discount)         |
| currency      | VARCHAR(8)    | INR                                   |
| is_active     | BOOLEAN       | Available for purchase                |

**Available Add-Ons:**

| Feature Key        | Name               | Monthly | Yearly  |
| ------------------ | ------------------ | ------- | ------- |
| additional_doctor  | Additional Doctor  | ₹499    | ₹5,389  |
| additional_staff   | Additional Staff   | ₹99     | ₹1,069  |
| additional_storage | Additional Storage | ₹199    | ₹2,149  |
| additional_branch  | Additional Branch  | ₹999    | ₹10,789 |

### clinic_add_ons

Tracks purchased add-ons per clinic.

| Column                   | Type          | Description                           |
| ------------------------ | ------------- | ------------------------------------- |
| id                       | UUID (PK)     |                                       |
| clinic_id                | UUID          | Reference to clinic                   |
| add_on_id                | UUID (FK)     | References add_ons                    |
| quantity                 | INTEGER       | Units purchased                       |
| billing_cycle            | VARCHAR(20)   | monthly or yearly                     |
| starts_at                | TIMESTAMP     | When add-on activated                 |
| expires_at               | TIMESTAMP     | When add-on expires                   |
| is_active                | BOOLEAN       | Currently active                      |
| provider                 | VARCHAR(80)   | Payment provider                      |
| provider_subscription_id | VARCHAR(200)  | Razorpay order ID                     |
| payment_status           | VARCHAR(20)   | pending, success                      |
| payment_mode             | VARCHAR(20)   | Payment method                        |
| transaction_id           | VARCHAR(100)  | Razorpay payment ID                   |
| price                    | DECIMAL(12,2) | Amount paid (pro-rated)               |
| cancel_at_period_end     | BOOLEAN       | If true, won't renew after expires_at |
| cancelled_at             | TIMESTAMP     | When user requested cancellation      |
| cancellation_reason      | VARCHAR(255)  | Optional reason                       |

### clinic_usage

Tracks usage-based feature consumption per billing period.

| Column       | Type      | Description                                       |
| ------------ | --------- | ------------------------------------------------- |
| id           | UUID (PK) |                                                   |
| clinic_id    | UUID      |                                                   |
| feature_key  | VARCHAR   | Which feature (e.g., whatsapp_messages_per_month) |
| usage_count  | INTEGER   | Current usage in period                           |
| period_start | TIMESTAMP | Start of billing period                           |
| period_end   | TIMESTAMP | End of billing period                             |

UNIQUE constraint: (clinic_id, feature_key, period_start)

---

## Limit Calculation

```
Total Limit = Base Plan Limit + Add-On Limit
```

Example: A clinic on CareHub plan (2 doctors base) with 1 "Additional Doctor" add-on = 3 doctors total.

**Feature Key Mapping (Add-Ons → Plan Features):**

| Plan Feature Key | Add-On Keys That Contribute                             |
| ---------------- | ------------------------------------------------------- |
| doctor_accounts  | additional_doctor, doctor_accounts                      |
| staff_accounts   | additional_staff, staff_accounts                        |

---

## API Endpoints

### Plan Management (Super Admin)

| Method | Path                                  | Description                |
| ------ | ------------------------------------- | -------------------------- |
| POST   | /subscription/plans                   | Create plan                |
| PATCH  | /subscription/plans/:id               | Update plan                |
| DELETE | /subscription/plans/:id               | Delete plan                |
| PATCH  | /subscription/manage-features/:planId | Add/update/delete features |
| GET    | /subscription/plans                   | Get all plans (public)     |

### Subscription (Clinic)

| Method | Path                                 | Description                                |
| ------ | ------------------------------------ | ------------------------------------------ |
| POST   | /subscription/subscribe              | Subscribe to plan (creates Razorpay order) |
| POST   | /subscription/verify-subscription    | Verify payment & activate                  |
| POST   | /subscription/initial-subscribe      | First-time subscribe (trial)               |
| PUT    | /subscription/cancel/:subscriptionId | Cancel immediately                         |
| PUT    | /subscription/schedule-cancel        | Cancel at end of period                    |
| PUT    | /subscription/undo-cancel            | Undo scheduled cancellation                |
| GET    | /subscription/my-subscription        | Current plan + add-ons + usage             |
| GET    | /subscription/billing-history        | All past payments                          |

### Add-Ons (Clinic)

| Method | Path                                     | Description                        |
| ------ | ---------------------------------------- | ---------------------------------- |
| GET    | /subscription/addons/available           | Browse purchasable add-ons         |
| GET    | /subscription/addons/pricing             | Get pricing info                   |
| GET    | /subscription/addons/my-addons           | Clinic's purchased add-ons         |
| GET    | /subscription/addons/limits              | Add-on limits breakdown            |
| POST   | /subscription/addons/purchase            | Initiate purchase (Razorpay order) |
| POST   | /subscription/addons/verify-purchase     | Verify & activate                  |
| PUT    | /subscription/addons/cancel/:id          | Cancel immediately                 |
| PUT    | /subscription/addons/schedule-cancel/:id | Cancel at end of period            |
| PUT    | /subscription/addons/undo-cancel/:id     | Undo scheduled cancellation        |

### Combined Purchase

| Method | Path                                   | Description                          |
| ------ | -------------------------------------- | ------------------------------------ |
| POST   | /subscription/subscribe-with-addons    | Plan + add-ons in one Razorpay order |
| POST   | /subscription/verify-combined-purchase | Verify combined payment              |
| POST   | /subscription/preview-combined-price   | Preview pricing without ordering     |

### Add-On Admin (Super Admin)

| Method | Path                        | Description              |
| ------ | --------------------------- | ------------------------ |
| POST   | /subscription/addons        | Create add-on            |
| GET    | /subscription/addons        | Get all (admin view)     |
| GET    | /subscription/addons/active | Get active only          |
| PATCH  | /subscription/addons/:id    | Update add-on            |
| DELETE | /subscription/addons/:id    | Soft delete (deactivate) |

### Coupons

| Method | Path                           | Description          |
| ------ | ------------------------------ | -------------------- |
| POST   | /subscription/coupons/validate | Validate coupon code |

### Webhooks

| Method | Path                   | Description              |
| ------ | ---------------------- | ------------------------ |
| POST   | /subscription/razorpay | Razorpay webhook handler |

---

## Payment Flow

### New Subscription

```
Client                        Backend                       Razorpay
  │                              │                              │
  ├─ POST /subscribe ───────────►│                              │
  │  { planId, couponCode? }     │── createRazorpayOrder() ────►│
  │                              │◄─ { orderId, amount } ───────│
  │◄─ { orderId, keyId } ───────│                              │
  │                              │                              │
  ├─ Open Razorpay Checkout ────►│                              │
  │◄─ { paymentId, signature } ──│                              │
  │                              │                              │
  ├─ POST /verify-subscription ─►│                              │
  │  { orderId, paymentId,       │── verifyRazorpayPayment() ──►│
  │    signature, planId }       │◄─ valid ─────────────────────│
  │                              │                              │
  │                              │── Deactivate old sub         │
  │                              │── Create new sub (active)    │
  │                              │── Reactivate staff           │
  │                              │── Invalidate Redis cache     │
  │◄─ { subscription } ─────────│                              │
```

### Add-On Purchase (Pro-Rated)

```
Client                        Backend                       Razorpay
  │                              │                              │
  ├─ POST /addons/purchase ─────►│                              │
  │  { addOns: [...] }           │── Calculate pro-rata price   │
  │                              │── Align with sub expiry      │
  │                              │── createRazorpayOrder() ────►│
  │                              │◄─ { orderId, amount } ───────│
  │◄─ { orderId, proRatedPrice } │                              │
  │                              │                              │
  ├─ Open Razorpay ────────────►│                              │
  │◄─ { paymentId, signature } ──│                              │
  │                              │                              │
  ├─ POST /addons/verify ───────►│                              │
  │                              │── Insert clinic_add_ons      │
  │                              │── expiresAt = sub.expiresAt  │
  │◄─ { success } ──────────────│                              │
```

---

## Cancellation Lifecycle

### Schedule Cancellation (Soft Cancel)

```
User clicks "Cancel"
  │
  ▼
PUT /subscription/schedule-cancel
  │
  ▼
Set cancel_at_period_end = true, cancelled_at = NOW()
Subscription stays ACTIVE until expires_at
  │
  ▼
[When expires_at arrives — future auto-renewal phase]
  ├─ If cancel_at_period_end = true  → Don't renew, deactivate
  └─ If cancel_at_period_end = false → Charge & extend (auto-renew)
```

### Undo Cancellation

```
User clicks "Undo Cancellation"
  │
  ▼
PUT /subscription/undo-cancel
  │
  ▼
Set cancel_at_period_end = false, cancelled_at = null
Subscription continues normally
```

### Immediate Cancellation

```
PUT /subscription/cancel/:id
  │
  ▼
Set active = false immediately
  │
  ▼
enforceStaffLimitsOnExpiry()
  ├─ Archive excess doctors (oldest first)
  └─ Archive excess staff (oldest first)
  │
  ▼
Return list of deactivated users
```

---

## Auto-Renewal (Auto-Pay)

### Overview

Auto-renewal uses Razorpay's Subscriptions API to create a recurring payment mandate. When enabled, Razorpay automatically charges the customer's card/UPI before each billing period ends.

### Endpoints

| Method | Path                             | Description                             |
| ------ | -------------------------------- | --------------------------------------- |
| GET    | /subscription/auto-renew/status  | Get auto-renewal state for the clinic   |
| POST   | /subscription/auto-renew/enable  | Enable auto-pay (creates Razorpay sub)  |
| POST   | /subscription/auto-renew/disable | Disable auto-pay (cancels at cycle end) |

### Enable Flow

```
User toggles "Auto-Renewal" ON
  │
  ▼
POST /subscription/auto-renew/enable
  │
  ├─ Validate: must have active paid plan
  ├─ Get/Create a Razorpay Plan (cached in Redis for 30 days)
  ├─ Create a Razorpay Subscription (recurring mandate)
  ├─ Update clinic_subscriptions: auto_renew=true, razorpay_subscription_id=xxx
  │
  ▼
Return { shortUrl } → User opens in browser to authorize mandate (UPI/Card)
  │
  ▼
Razorpay sends `subscription.authenticated` webhook (mandate confirmed)
  │
  ▼
Before each period ends, Razorpay auto-charges
  │
  ▼
Webhook: `subscription.charged` fires
  │
  ├─ Extend subscription.expires_at by 30d (monthly) or 365d (yearly)
  ├─ Renew active add-ons (extend their expires_at too)
  ├─ Deactivate add-ons with cancel_at_period_end=true
  ├─ Invalidate Redis cache
  │
  ▼
Clinic continues uninterrupted
```

### Disable Flow

```
User toggles "Auto-Renewal" OFF
  │
  ▼
POST /subscription/auto-renew/disable
  │
  ├─ Cancel Razorpay subscription (cancel_at_cycle_end=true)
  ├─ Update clinic_subscriptions: auto_renew=false, razorpay_subscription_id=null
  │
  ▼
Current period continues normally, just won't auto-charge next time
```

### Add-Ons & Auto-Renewal

When auto-renewal charges at period end:

| Add-On State                             | What Happens                  |
| ---------------------------------------- | ----------------------------- |
| `isActive=true, cancelAtPeriodEnd=false` | Renewed (expiry extended)     |
| `isActive=true, cancelAtPeriodEnd=true`  | Deactivated (user removed it) |
| `isActive=false`                         | Ignored (already inactive)    |

New add-ons purchased mid-cycle are automatically included in the next auto-renewal.

### UI Behavior

| Condition                | Toggle State           |
| ------------------------ | ---------------------- |
| Solo plan                | Hidden (not shown)     |
| Paid plan, auto-pay OFF  | Toggle OFF, enabled    |
| Paid plan, auto-pay ON   | Toggle ON, enabled     |
| Cancellation scheduled   | Toggle disabled + note |
| Loading (enable/disable) | Toggle disabled        |

### Razorpay Webhook Events

| Event                      | Action                                       |
| -------------------------- | -------------------------------------------- |
| subscription.authenticated | Mandate confirmed (no action needed)         |
| subscription.charged       | Extend expiry + renew add-ons                |
| subscription.cancelled     | Mark auto_renew=false in DB                  |
| subscription.halted        | Payment failed — send notification to clinic |

---

## Upgrade / Downgrade

### Upgrade (Solo → CareHub)

1. Old subscription deactivated (`active: false`)
2. Razorpay payment collected
3. New subscription created with fresh expiry (30d monthly / 365d yearly)
4. `LimitationService.reactivateStaffOnUpgrade()` re-enables archived staff/doctors
5. Redis cache invalidated

### Downgrade / Expiry

1. On any API call, `LimitationService.getClinicActivePlan()` checks expiry
2. If expired → falls back to Solo plan limits
3. `enforceStaffLimitsOnExpiry()` runs (once, via Redis flag):
   - Counts current doctors/staff vs Solo plan limit
   - Archives excess (oldest first, `isArchive=true`, `userStatus='Inactive'`)
   - Fully reversible on upgrade

---

## Caching Strategy

| Redis Key                             | TTL        | Purpose                               |
| ------------------------------------- | ---------- | ------------------------------------- |
| clinic_plan:{clinicId}                | 5 min      | Active plan ID + slug                 |
| plan_limit:{planId}:{featureKey}      | 5 min      | Feature limit config                  |
| clinic_limits_overview:{clinicId}     | 2 min      | Full limits dashboard data            |
| clinic_addons:{clinicId}              | —          | Invalidated on change                 |
| clinic_active_subscription:{clinicId} | —          | Invalidated on change                 |
| user_subscription_expiry:{userId}     | TTL=expiry | Per-user expiry for middleware        |
| staff_enforcement_done:{clinicId}     | 24h        | Prevents repeated enforcement         |
| addons:active                         | 5 min      | Available add-ons catalog             |
| purchase_intent:{orderId}             | 30 min     | Combined purchase data during payment |

---

## File Structure

```
src/main/subscription/
├── models/
│   ├── subscription.model.ts     # SubscriptionPlanModel, ClinicSubscriptionModel
│   ├── addon.model.ts            # AddOnModel, ClinicAddOnModel
│   ├── planFeatures.model.ts     # PlanFeaturesModel
│   └── clinicUsage.model.ts      # ClinicUsageModel
├── services/
│   ├── subscription.service.ts   # Plan CRUD, subscribe, cancel, billing history
│   ├── addon.service.ts          # Add-on CRUD, purchase, pro-rating, cancel
│   ├── autoRenew.service.ts      # Auto-pay enable/disable, webhook handler
│   ├── limitation.service.ts     # Limit checks, staff enforcement, reactivation
│   ├── coupon.service.ts         # Coupon validation and usage tracking
│   └── renewalReminder.service.ts# Expiry reminder emails
├── controllers/
│   ├── subscription.controller.ts
│   ├── addon.controller.ts
│   ├── autoRenew.controller.ts
│   ├── combinedPurchase.controller.ts
│   └── renewalReminder.controller.ts
├── routes/v1/
│   ├── subscription.routes.ts
│   ├── addons.routes.ts
│   └── subscription.combinedPurchase.routes.ts
└── schemas/
    ├── subscription.schemas.ts
    ├── addon.schemas.ts
    └── combinedPurchase.schemas.ts
```

---

## Key Business Rules

1. **Solo plan** — No expiry, no payment, limited features
2. **Clinic plan** — Monthly (₹499/mo) / Yearly essential practice plan
3. **CareHub plan** — Monthly (₹999/mo) or Yearly (20% discount)
4. **Add-ons require paid plan (Clinic / CareHub)** — Solo plan users cannot purchase add-ons (enforced via `add_ons` plan feature flag)
5. **Pro-rated add-on billing** — Price calculated based on remaining days until subscription expiry
6. **Add-on expiry aligns with subscription** — Everything renews on the same date
7. **Staff enforcement on downgrade** — Oldest staff archived first, fully reversible
8. **Coupon support** — Percentage or flat discounts, per-clinic usage limits
9. **Webhook fallback** — If client verification fails, Razorpay webhook activates the subscription
10. **Cancel at period end** — User keeps access until expiry, won't auto-renew
11. **Auto-renewal** — Razorpay recurring subscription charges before expiry; renews plan + all active add-ons
12. **Add-ons follow auto-renewal** — Active add-ons (cancelAtPeriodEnd=false) renew with the subscription; cancelled add-ons (cancelAtPeriodEnd=true) get deactivated at renewal
13. **Reduce add-on quantity** — Users can reduce quantity immediately (limit drops instantly); removal schedules for period end
