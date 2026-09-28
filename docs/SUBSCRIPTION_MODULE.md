# IMS Subscription & Billing Module - Complete Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Database Models](#database-models)
3. [Add-On System](#add-on-system)
4. [API Reference](#api-reference)
5. [Usage & Limits](#usage--limits)
6. [Payment Flow](#payment-flow)

---

## Architecture Overview

```
src/main/subscription/
├── controllers/       # HTTP request handlers
├── models/           # Database schema definitions (5 core models)
├── routes/v1/        # API route definitions
├── schemas/          # Validation schemas (Zod)
├── services/
│   ├── subscription.service.ts   # Plan CRUD, clinic subscribe, billing history
│   ├── addon.service.ts          # Add-on lifecycle (purchase, cancel, reduce)
│   ├── autoRenew.service.ts      # AutoPay (Razorpay recurring subscriptions)
│   ├── limitation.service.ts     # Feature gating & usage limit enforcement
│   ├── coupon.service.ts         # Coupon validation & tracking
│   └── renewalReminder.service.ts # Email/notification reminders (cron-driven)
```
└── services/         # Business logic
```

### Module Responsibilities
- **Subscription Plans**: Solo, Clinic, CareHub tier management
- **Add-Ons**: Purchase additional resources (doctors, staff, storage)
- **AutoPay**: Razorpay recurring subscriptions with mandate authorization; recurring amount = base plan + active add-ons; synced automatically when add-ons change
- **Scheduled Cancellation**: End-of-period cancellation (subscription and add-ons) with undo capability
- **Limit Enforcement**: Enforce usage limits based on subscription; deactivate excess staff/doctors on plan expiry
- **Billing**: Razorpay integration for one-time and recurring payments
- **Webhooks**: Database synchronization via verified Razorpay events (never rely on frontend state alone)
- **Payment Retry**: Creates fresh orders for failed/pending payments
- **Coupons**: Percentage, fixed, and trial discount codes with per-clinic usage limits
- **Renewal Reminders**: Cron-driven email + in-app notifications at 7, 3, 1 days before expiry
- **Proration**: Add-ons purchased mid-cycle are charged proportionally to remaining days

### Access Control (Simplified)

This module uses a **simplified access control approach**:

| Level             | Mechanism                      | Implementation                         |
| ----------------- | ------------------------------ | -------------------------------------- |
| **Role-based**    | `userType` enum                | `auth.middleware.ts`                   |
| **Feature-based** | `PlanFeaturesModel.enabled`    | `LimitationService.isFeatureEnabled()` |
| **Limit-based**   | `PlanFeaturesModel.limitValue` | `LimitationService.check*Limit()`      |

> **Note:** The previous granular permission system (`PermissionModel`, `RolePermissionModel`, `PlanPermissionModel`) has been removed as it was unused and redundant with the existing `userType` + subscription features approach.

---

## Database Models

### Core Models (5 Total)

#### 1. SubscriptionPlanModel (`subscription_plans`)

Defines available subscription tiers.

| Field         | Type      | Description                                          |
| ------------- | --------- | ---------------------------------------------------- |
| `id`          | UUID (PK) | Unique identifier                                    |
| `slug`        | String    | URL-friendly name (e.g., 'solo', 'carehub-monthly')  |
| `name`        | String    | Display name (e.g., 'CareHub')                       |
| `description` | Text      | Plan description                                |
| `price`       | Decimal   | Base price                                      |
| `currency`    | String    | Currency code (default: 'INR')                  |
| `createdAt`   | Timestamp | Creation time                                   |
| `updatedAt`   | Timestamp | Last update time                                |

**Relationships:**
- Has many `PlanFeaturesModel` (features & limits)

---

#### 2. PlanFeaturesModel (`plan_features`) ⭐ UNIFIED

**Merged from:** `FeatureModel` + `PlanLimitsModel`

Single table for all plan features - both marketing display and enforcement limits.

| Field                | Type      | Description                            |
| -------------------- | --------- | -------------------------------------- |
| `id`                 | UUID (PK) | Unique identifier                      |
| `planId`             | UUID (FK) | References subscription_plans          |
| `featureKey`         | String    | Machine name (e.g., 'doctor_accounts') |
| `displayName`        | String    | Human-readable name                    |
| `description`        | String    | Feature description                    |
| `type`               | Enum      | 'numeric' \| 'boolean' \| 'marketing'  |
| `limitValue`         | Integer   | Numeric limit (for type='numeric')     |
| `isUnlimited`        | Boolean   | No limit if true                       |
| `enabled`            | Boolean   | Feature enabled for this plan          |
| `sortOrder`          | Integer   | Display order                          |
| `isMarketingFeature` | Boolean   | For marketing page only                |
| `createdAt`          | Timestamp | Creation time                          |
| `updatedAt`          | Timestamp | Last update time                       |

**Feature Types:**

| Type        | Use Case              | Example Fields               |
| ----------- | --------------------- | ---------------------------- |
| `numeric`   | Limited resources     | `limitValue`, `isUnlimited`  |
| `boolean`   | On/off features       | `enabled`                    |
| `marketing` | Display-only features | `displayName`, `description` |

**Feature Keys:**
```typescript
FEATURE_KEYS = {
  WHATSAPP_MESSAGES: 'whatsapp_messages_per_month',
  DOCTOR_ACCOUNTS: 'doctor_accounts',
  STAFF_ACCOUNTS: 'staff_accounts',
  CLOUD_STORAGE: 'cloud_storage',
  STORAGE_MONTHS: 'storage_months',
  PAYMENT_HISTORY_MONTHS: 'payment_history_months',
  LAB_INTEGRATION: 'lab_integration',
  PHARMACY_INTEGRATION: 'pharmacy_integration',
  DASHBOARD_FULL_ACCESS: 'dashboard_full_access',
  REPORTS_ANALYTICS: 'reports_analytics',
  SMART_PRESCRIPTIONS: 'smart_prescriptions',
  CUSTOM_BRANDED_RX: 'custom_branded_rx',
  OCR_PRESCRIPTION_SCAN: 'ocr_prescription_scan',
  CHATBOT_SUPPORT: 'chatbot_support',
  PRIORITY_SUPPORT: 'priority_support',
  ADD_ONS: 'add_ons',
  WAITING_ROOM_QUEUE: 'waiting_room_queue',
}
```

**Migration from Old Schema:**
```typescript
// OLD (separate tables)
features: { name, description, value, isUnlimited }
plan_limits: { featureKey, limitValue, isUnlimited, enabled, description }

// NEW (unified table)
plan_features: { 
  featureKey, displayName, description, type,
  limitValue, isUnlimited, enabled, sortOrder, isMarketingFeature 
}
```

---

#### 3. ClinicSubscriptionModel (`clinic_subscriptions`)

Tracks clinic subscriptions.

| Field                    | Type      | Description                                                           |
| ------------------------ | --------- | --------------------------------------------------------------------- |
| `id`                     | UUID (PK) | Unique identifier                                                     |
| `clinicId`               | UUID      | Clinic identifier                                                     |
| `planId`                 | UUID (FK) | References subscription_plans                                         |
| `startsAt`               | Timestamp | Subscription start date                                               |
| `expiresAt`              | Timestamp | Subscription expiry date                                              |
| `active`                 | Boolean   | Active status                                                         |
| `provider`               | String    | Payment provider ('razorpay', 'manual')                               |
| `providerSubscriptionId` | String    | Provider's subscription ID                                            |
| `paymentStatus`          | String    | 'success', 'pending', 'failed'                                        |
| `paymentMode`            | String    | Payment method ('online', 'free')                                     |
| `transactionId`          | String    | Transaction reference                                                 |
| `price`                  | Decimal   | Amount paid                                                           |
| `cancelAtPeriodEnd`      | Boolean   | If true, subscription will NOT renew after `expiresAt`                |
| `cancelledAt`            | Timestamp | When the user requested cancellation (null if not cancelled)          |
| `cancellationReason`     | String    | Optional user-provided reason                                         |
| `autoRenew`              | Boolean   | AutoPay enabled — Razorpay auto-charges before expiry                 |
| `razorpaySubscriptionId` | String    | Razorpay subscription ID for recurring payments (null if AutoPay off) |

---

#### 4. AddOnModel (`add_ons`)

Available add-ons for purchase.

| Field          | Type      | Description                                      |
| -------------- | --------- | ------------------------------------------------ |
| `id`           | UUID (PK) | Unique identifier                                |
| `name`         | String    | Add-on name                                      |
| `description`  | Text      | Description                                      |
| `featureKey`   | String    | Links to plan_limits (e.g., 'additional_doctor') |
| `unitValue`    | Integer   | Value per unit (e.g., 1 doctor)                  |
| `monthlyPrice` | Decimal   | Monthly price                                    |
| `yearlyPrice`  | Decimal   | Yearly price (20% discount)                      |
| `currency`     | String    | Currency code                                    |
| `isActive`     | Boolean   | Available for purchase                           |

**Default Add-Ons:**
| Add-On                  | Monthly | Yearly  | Description       |
| ----------------------- | ------- | ------- | ----------------- |
| Additional Doctor       | ₹499    | ₹4,790  | +1 doctor account |
| Additional Staff        | ₹99     | ₹950    | +1 staff account  |
| Additional 1 GB Storage | ₹199    | ₹1,910  | +1GB storage      |
| Additional Branch       | ₹999    | ₹9,590  | +1 branch support |

---

#### 5. ClinicAddOnModel (`clinic_add_ons`)

Tracks clinic add-on purchases.

| Field                | Type      | Description                                      |
| -------------------- | --------- | ------------------------------------------------ |
| `id`                 | UUID (PK) | Unique identifier                                |
| `clinicId`           | UUID      | Clinic identifier                                |
| `addOnId`            | UUID (FK) | References add_ons                               |
| `quantity`           | Integer   | Number of units purchased                        |
| `billingCycle`       | String    | 'monthly' or 'yearly'                            |
| `startsAt`           | Timestamp | Start date                                       |
| `expiresAt`          | Timestamp | Expiry date                                      |
| `isActive`           | Boolean   | Active status                                    |
| `provider`           | String    | Payment provider                                 |
| `transactionId`      | String    | Payment transaction ID                           |
| `paymentStatus`      | String    | Payment status                                   |
| `price`              | Decimal   | Amount paid                                      |
| `cancelAtPeriodEnd`  | Boolean   | If true, add-on will NOT renew after `expiresAt` |
| `cancelledAt`        | Timestamp | When removal was scheduled (null if active)      |
| `cancellationReason` | String    | Optional user-provided reason                    |

---

#### 6. ClinicUsageModel (`clinic_usage`)

Tracks feature usage counts.

| Field         | Type      | Description           |
| ------------- | --------- | --------------------- |
| `id`          | UUID (PK) | Unique identifier     |
| `clinicId`    | UUID      | Clinic identifier     |
| `featureKey`  | String    | Feature being tracked |
| `usageCount`  | Integer   | Current usage count   |
| `periodStart` | Timestamp | Billing period start  |
| `periodEnd`   | Timestamp | Billing period end    |

---

## Add-On System

### How It Works

1. **Base Limits**: Each subscription plan has built-in limits via `PlanFeaturesModel`
2. **Add-Ons**: Clinics can purchase additional capacity via `ClinicAddOnModel`
3. **Total Limit**: `baseLimit + sum(addOnValues)`

### Example: Doctor Accounts

**Free Plan:**
- Base limit: 2 doctors (from `PlanFeaturesModel.limitValue`)
- Add-ons purchased: +2 doctors (2 × ₹499/mo)
- **Total allowed: 4 doctors**

### Limit Calculation Flow

```typescript
// LimitationService.checkDoctorLimit()
async checkDoctorLimit(clinicId: string): Promise<UsageCheckResult> {
  // 1. Get base plan limit from PlanFeaturesModel
  const baseLimit = await this.getPlanLimit(clinicId, 'doctor_accounts');
  
  // 2. Get add-on contributions
  const addOnLimit = await this.getAddOnLimit(clinicId, 'doctor_accounts');
  
  // 3. Calculate total
  const totalLimit = baseLimit + addOnLimit;
  
  // 4. Check current usage
  const currentDoctors = await this.countDoctors(clinicId);
  
  // 5. Return result
  return {
    allowed: currentDoctors < totalLimit,
    currentUsage: currentDoctors,
    limit: totalLimit,
    remaining: totalLimit - currentDoctors,
  };
}
```

---

## API Reference

### Admin Endpoints (Super Admin Required)

#### Subscription Plans
```typescript
// Create plan
POST /api/v1/subscription/plans
Body: { slug, name, description, price, currency }

// Update plan
PATCH /api/v1/subscription/plans/:id
Body: { name?, description?, price?, currency? }

// Delete plan
DELETE /api/v1/subscription/plans/:id

// List plans
GET /api/v1/subscription/plans
```

#### Plan Features (Unified)
```typescript
// Get all plan features
GET /api/v1/subscription/plan-features

// Get features for specific plan
GET /api/v1/subscription/plan-features/:planId

// Add/update plan features (bulk)
PUT /api/v1/subscription/plan-features/:planId
Body: { 
  features: [
    { 
      featureKey: 'doctor_accounts',
      displayName: 'Doctor Accounts',
      type: 'numeric',
      limitValue: 2,
      isUnlimited: false,
      enabled: true 
    }
  ] 
}

// Update single feature
PATCH /api/v1/subscription/plan-features/:planId/:featureKey
Body: { limitValue?, isUnlimited?, enabled?, description? }
```

#### Add-Ons
```typescript
// Create add-on
POST /api/v1/subscription/addons
Body: { name, description, featureKey, unitValue, monthlyPrice, yearlyPrice }

// Update add-on
PATCH /api/v1/subscription/addons/:id

// Delete add-on
DELETE /api/v1/subscription/addons/:id

// List all add-ons
GET /api/v1/subscription/addons

// List active add-ons
GET /api/v1/subscription/addons/active
```

### Clinic Endpoints (Authentication Required)

#### Subscriptions
```typescript
// Get available plans
GET /api/v1/subscription/plans

// Subscribe to plan (initiates payment)
POST /api/v1/subscription/subscribe
Body: { planId, providerSubscriptionId? }

// Verify payment and complete subscription
POST /api/v1/subscription/verify-subscription
Body: { orderId, paymentId, signature, planId }

// Cancel subscription (immediate)
PUT /api/v1/subscription/cancel/:subscriptionId

// Schedule cancellation at end of billing period (recommended)
PUT /api/v1/subscription/schedule-cancel
Body: { reason? }

// Undo a scheduled cancellation
PUT /api/v1/subscription/undo-cancel

// Retry a failed / pending payment — creates a fresh Razorpay order
// (complete via /verify-subscription)
POST /api/v1/subscription/payment/retry

// Get current subscription + active add-ons + usage
GET /api/v1/subscription/my-subscription
// Response addOns format:
// {
//   addOns: [
//     {
//       id: "...",
//       addOnName: "Additional Staff Member",
//       featureKey: "staff_accounts",
//       totalQuantity: 3,     // Active today
//       renewalQuantity: 0,   // Quantity that will renew next cycle (0 if cancelAtPeriodEnd=true)
//       cancelAtPeriodEnd: true,
//       ...
//     }
//   ]
// }

// Get billing history
GET /api/v1/subscription/billing-history
```

#### AutoPay (Auto-Renewal)
```typescript
// Get AutoPay status
GET /api/v1/subscription/auto-renew/status
// → { autoRenew, canEnable, reason?, expiresAt, cancelAtPeriodEnd }

// Enable AutoPay — creates a Razorpay recurring subscription and returns a
// short_url for the customer to authorize the mandate. The recurring amount
// is base plan + active add-ons. First charge is scheduled at current expiry
// (start_at), so enabling never charges immediately.
POST /api/v1/subscription/auto-renew/enable
// → { enabled, razorpaySubscriptionId, shortUrl, status }

// Disable AutoPay — cancels the Razorpay subscription at cycle end.
// Current plan stays active until expiresAt.
POST /api/v1/subscription/auto-renew/disable
```

#### Add-Ons
```typescript
// Get available add-ons
GET /api/v1/subscription/addons/available

// Get add-on pricing
GET /api/v1/subscription/addons/pricing

// Get my add-ons
GET /api/v1/subscription/addons/my-addons

// Get add-on limits breakdown
GET /api/v1/subscription/addons/limits

// Purchase add-on (initiates payment)
POST /api/v1/subscription/addons/purchase
Body: { addOns: [{ addOnId, billingCycle: 'monthly' | 'yearly', quantity }], couponCode? }

// Verify add-on purchase
POST /api/v1/subscription/addons/verify-purchase
Body: { orderId, paymentId, signature, addOns: [...], couponId? }

// Schedule add-on removal at end of period
PUT /api/v1/subscription/addons/schedule-cancel/:clinicAddOnId
Body: { reason? }

// Undo a scheduled add-on removal
PUT /api/v1/subscription/addons/undo-cancel/:clinicAddOnId

// Reduce add-on quantity (immediate)
PUT /api/v1/subscription/addons/reduce-quantity/:clinicAddOnId
Body: { reduceBy? }

// Cancel add-on (immediate)
PUT /api/v1/subscription/addons/cancel/:clinicAddOnId
```

#### Usage & Limits
```typescript
// Get clinic limits overview
GET /api/v1/subscription/limitations/overview

// Check specific feature limit
GET /api/v1/subscription/limitations/check/:featureKey

// Get cloud storage capacity, usage, and remaining MB
GET /api/v1/subscription/limitations/storage

// Get storage retention
GET /api/v1/subscription/limitations/storage-retention

// Get payment history retention
GET /api/v1/subscription/limitations/payment-history-retention
```

### Webhook Endpoints

```typescript
// Razorpay webhook (receives raw body for HMAC signature verification)
POST /api/v1/subscription/razorpay
```

**Handled events:**

| Event                        | Action                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment.captured`           | Activates subscription (idempotent by transactionId). Skips add-on orders (`providerSubscriptionId === 'addon-purchase'`). For add-on orders, completes the purchase via `AddOnService.completePurchase`. |
| `payment.failed`             | Sets `paymentStatus: 'failed'` on the active subscription so the UI shows a retry banner.                                                                                                                 |
| `subscription.charged`       | Auto-renewal success — extends subscription expiry by 30d/1yr, extends active add-ons that are NOT scheduled for removal, deactivates add-ons that ARE scheduled for removal.                             |
| `subscription.authenticated` | Mandate authorized — marks `autoRenew: true`.                                                                                                                                                             |
| `subscription.pending`       | Payment initiated but not confirmed — invalidates cache for UI freshness.                                                                                                                                 |
| `subscription.halted`        | Repeated failures — disables AutoPay, clears `razorpaySubscriptionId`.                                                                                                                                    |
| `subscription.cancelled`     | External cancellation — disables AutoPay, clears `razorpaySubscriptionId`.                                                                                                                                |
| `account.activated`          | Route account activated — updates clinic `routeStatus`.                                                                                                                                                   |
| `account.suspended`          | Route account suspended — updates clinic `routeStatus`.                                                                                                                                                   |

**Signature verification:** The global `express.json()` in `app.ts` stores the raw body via a `verify` callback (`req.rawBody`). The subscription webhook controller verifies the HMAC against these exact bytes using `RAZORPAY_WEBHOOK_SECRET` (while the patient appointments webhook uses `RAZORPAY_WEBHOOK_APP_SECRET`), ensuring integrity even though `req.body` is already parsed.

**Idempotency:** All handlers are idempotent — duplicate deliveries are safely ignored via `transactionId` / `razorpaySubscriptionId` checks.

---

## Usage & Limits

### Checking Limits in Your Code

```typescript
import { LimitationService, FEATURE_KEYS } from '../subscription/services/limitation.service';

// Check if feature is enabled
const canUseLab = await LimitationService.isFeatureEnabled(
  clinicId, 
  FEATURE_KEYS.LAB_INTEGRATION
);

// Check usage limit
const whatsappCheck = await LimitationService.checkUsageLimit(
  clinicId, 
  FEATURE_KEYS.WHATSAPP_MESSAGES
);
if (!whatsappCheck.allowed) {
  throw new HttpError(403, 'WhatsApp limit reached');
}

// Check account limits
const doctorCheck = await LimitationService.checkDoctorLimit(clinicId);
if (!doctorCheck.allowed) {
  throw new HttpError(403, `Doctor limit reached: ${doctorCheck.message}`);
}

// Get full overview
const overview = await LimitationService.getClinicLimitsOverview(clinicId);
```

### Tracking Usage

```typescript
import { LimitationService, FEATURE_KEYS } from '../subscription/services/limitation.service';

// Increment usage counter
await LimitationService.incrementUsage(
  clinicId,
  FEATURE_KEYS.WHATSAPP_MESSAGES,
  1  // increment by 1
);
```

---

## Payment Flow

### Subscription Purchase Flow

```
1. Client → POST /subscribe { planId }
   └─→ Server creates Razorpay order
   └─→ Returns: { orderId, amount, keyId }

2. Client → Razorpay Checkout (user completes payment)
   └─→ Razorpay returns: { paymentId, signature }

3. Client → POST /verify-subscription { orderId, paymentId, signature, planId }
   └─→ Server verifies signature
   └─→ Server creates ClinicSubscriptionModel record
   └─→ Server invalidates cache
   └─→ Returns: { subscription, status: 'active' }
```

### Add-On Purchase Flow

```
1. Client → POST /addons/purchase { addOnId, billingCycle, quantity }
   └─→ Server validates clinic has active subscription
   └─→ Server creates Razorpay order
   └─→ Returns: { orderId, amount, keyId }

2. Client → Razorpay Checkout

3. Client → POST /addons/verify-purchase { orderId, paymentId, signature, ... }
   └─→ Server verifies signature
   └─→ Server creates ClinicAddOnModel record
   └─→ Server invalidates cache
   └─→ Returns: { clinicAddOn, expiresAt }
```

### Free Plan Activation

```
POST /subscribe { planId: freePlanId }
└─→ Server creates subscription without payment
└─→ Returns: { subscription, status: 'active' }
```

### AutoPay (Auto-Renewal) Flow

```
ENABLE:
1. Client → POST /auto-renew/enable
   └─→ Server fetches active subscription + plan
   └─→ Server computes recurring amount = basePlan + activeAddOns
   └─→ Server creates Razorpay Plan (cached by planId:period:amount)
   └─→ Server creates Razorpay Subscription with start_at = expiresAt
   └─→ Server updates DB: autoRenew=true, razorpaySubscriptionId
   └─→ Returns: { shortUrl } (customer must open this to authorize mandate)

2. Customer authorizes mandate via shortUrl
   └─→ Razorpay sends `subscription.authenticated` webhook
   └─→ Server confirms autoRenew=true

3. At each billing cycle (automatic):
   └─→ Razorpay charges the authorized mandate
   └─→ Razorpay sends `subscription.charged` webhook
   └─→ Server extends subscription expiresAt by 30d/365d
   └─→ Server extends non-cancelled add-on expiries
   └─→ Server deactivates add-ons scheduled for removal

DISABLE:
1. Client → POST /auto-renew/disable
   └─→ Server calls razorpay.subscriptions.cancel(id, cancel_at_cycle_end=true)
   └─→ Server updates DB: autoRenew=false, razorpaySubscriptionId=null
   └─→ Current subscription stays active until expiresAt

ADD-ON SYNC (automatic):
When add-ons change while AutoPay is on (add/remove/qty change):
   └─→ Server recomputes recurring amount = basePlan + updatedAddOns
   └─→ Server creates new Razorpay Plan with new amount (if needed)
   └─→ Server calls razorpay.subscriptions.update({ plan_id, schedule_change_at: 'cycle_end' })
   └─→ Next renewal will charge the updated total (never mid-cycle)
```

### Payment Retry Flow

```
When a payment fails (subscription.paymentStatus = 'failed'):
1. Client → POST /payment/retry
   └─→ Server finds most recent pending/failed subscription
   └─→ Server computes price (monthly or yearly based on providerSubscriptionId)
   └─→ Server creates fresh Razorpay order
   └─→ Returns: { orderId, amount, keyId, planId }

2. Client → Razorpay Checkout (user completes payment)

3. Client → POST /verify-subscription { orderId, paymentId, signature, planId }
   └─→ Normal verification + activation flow
```

### Cancellation Flow

```
SCHEDULED (recommended):
1. Client → PUT /schedule-cancel { reason? }
   └─→ Server sets cancelAtPeriodEnd=true, cancelledAt=now
   └─→ Subscription remains FULLY ACTIVE until expiresAt
   └─→ Add-ons continue working until expiresAt
   └─→ User can undo via PUT /undo-cancel at any time

UNDO:
1. Client → PUT /undo-cancel
   └─→ Server clears cancelAtPeriodEnd, cancelledAt, cancellationReason
   └─→ Subscription resumes normal renewal

ADD-ON REMOVAL:
1. Client → PUT /addons/schedule-cancel/:clinicAddOnId
   └─→ Sets cancelAtPeriodEnd=true on the add-on
   └─→ Add-on stays active until expiresAt, then won't renew
   └─→ AutoPay mandate is updated to exclude it from next charge
   └─→ Can be undone via PUT /addons/undo-cancel/:clinicAddOnId
```

---

## Response Formats

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... }
}
```

### Limit Check Response
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "currentUsage": 2,
    "limit": 5,
    "isUnlimited": false,
    "remaining": 3,
    "message": null
  }
}
```

### Limits Overview Response
```json
{
  "success": true,
  "data": {
    "plan": {
      "planId": "...",
      "planSlug": "pro-monthly"
    },
    "limits": [
      {
        "featureKey": "doctor_accounts",
        "description": "Maximum doctor accounts",
        "enabled": true,
        "baseLimit": 2,
        "addOnLimit": 1,
        "totalLimit": 3,
        "currentUsage": 2,
        "remaining": 1
      }
    ]
  }
}
```

---

## Error Handling

### Common Error Codes

| Status | Code                   | Description                       |
| ------ | ---------------------- | --------------------------------- |
| 400    | LIMIT_REACHED          | Usage limit exceeded              |
| 400    | FEATURE_DISABLED       | Feature not available on plan     |
| 400    | NO_ACTIVE_SUBSCRIPTION | Clinic has no active subscription |
| 400    | INVALID_PAYMENT        | Payment verification failed       |
| 403    | FORBIDDEN              | Super admin access required       |

### Example Error Response
```json
{
  "success": false,
  "message": "You have reached the maximum of 2 doctor(s) on your pro-monthly plan. Please upgrade to add more doctors.",
  "status": 400,
  "code": "LIMIT_REACHED"
}
```

---

## Caching Strategy

### Redis Keys

```
clinic_plan:{clinicId}                    → { planId, planSlug }
clinic_limits_overview:{clinicId}         → Complete limits overview
clinic_active_subscription:{clinicId}     → Active subscription data
plan_limit:{planId}:{featureKey}          → Plan limit for feature
clinic_addons:{clinicId}                  → Clinic's add-ons
clinic_limits:{clinicId}                  → Combined limits
user_subscription_expiry:{userId}         → Subscription expiry for user middleware

addons:active                             → Active add-ons list (5 min TTL)
razorpay_plan:{planId}:{period}:{amount}  → Razorpay plan ID (30 day TTL, keyed by amount so plan-change creates a new one)
renewal_reminder:{clinicId}:{daysLeft}    → Prevents duplicate renewal reminders (48h TTL)
staff_enforcement_done:{clinicId}         → Prevents repeated staff enforcement on expiry (24h TTL)
```

### Cache Invalidation

- Subscription changes → Clear `clinic_plan`, `clinic_active_subscription`, `user_subscription_expiry`
- Add-on purchase/removal → Clear `clinic_addons`, `clinic_limits`, `clinic_limits_overview`
- Plan limit updates → Clear `plan_limit:*`, `clinic_limits_overview:*`
- AutoPay enable/disable → Clear `clinic_plan`, `clinic_active_subscription`

---

## Migrations & Changes

### From v1.0 to v2.0

#### Removed (Unused)
| Component                  | Replacement                                |
| -------------------------- | ------------------------------------------ |
| `PermissionModel`          | Use `userType` enum                        |
| `RolePermissionModel`      | Use `userType` enum                        |
| `PlanPermissionModel`      | Use `PlanFeaturesModel.enabled`            |
| `AccessService`            | Use `LimitationService`                    |
| `permission.middleware.ts` | Use `LimitationService.isFeatureEnabled()` |

#### Merged
| Old Tables                 | New Table       |
| -------------------------- | --------------- |
| `features` + `plan_limits` | `plan_features` |

#### Migration SQL
```sql
-- Migrate features to plan_features
INSERT INTO plan_features (plan_id, feature_key, display_name, description, type, is_marketing_feature)
SELECT plan_id, LOWER(REPLACE(name, ' ', '_')), name, description, 'marketing', true
FROM features;

-- Migrate plan_limits to plan_features
INSERT INTO plan_features (plan_id, feature_key, limit_value, is_unlimited, enabled, description, type)
SELECT plan_id, feature_key, limit_value, is_unlimited, enabled, description, 'numeric'
FROM plan_limits
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  limit_value = EXCLUDED.limit_value,
  is_unlimited = EXCLUDED.is_unlimited,
  enabled = EXCLUDED.enabled;
```

---

## Testing

### Run Seeds
```bash
# Seed subscription plans, features, and add-ons
npx tsx src/drizzle/seed.ts
```

### Test Add-On