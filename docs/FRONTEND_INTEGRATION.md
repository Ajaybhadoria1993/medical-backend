# Frontend Integration Guide - Subscription & Add-Ons

This guide helps frontend developers integrate the subscription and add-on billing system into the clinic dashboard.

---

## Table of Contents
1. [Getting Started](#getting-started)
2. [Subscription Plans](#subscription-plans)
3. [Current Subscription Status](#current-subscription-status)
4. [Add-On Management](#add-on-management)
5. [Payment Flow](#payment-flow)
6. [Usage & Limits Display](#usage--limits-display)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

---

## Getting Started

### Base URL
```
/api/v1/subscription
```

### Authentication
All endpoints require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

### Clinic Context
All clinic-scoped endpoints automatically use the logged-in user's clinic context (via `req.clinicId`).

---

## Subscription Plans

### 1. Get Available Plans (Pricing Page)

**Endpoint:**
```
GET /api/v1/subscription/plans
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Plans fetched successfully",
  "data": [
    {
      "id": "uuid",
      "slug": "Free",
      "name": "Free",
      "description": "Basic access for small clinics",
      "price": "0.00",
      "currency": "INR",
      "features": [
        {
          "id": "uuid",
          "name": "Reports",
          "description": "Standard clinic reports"
        }
      ]
    },
    {
      "id": "uuid",
      "slug": "pro-monthly",
      "name": "Pro",
      "description": "Advanced features for growing clinics",
      "price": "999.00",
      "currency": "INR",
      "features": [
        {
          "id": "uuid",
          "name": "Pharmacy",
          "description": "Full pharmacy and stock management"
        },
        {
          "id": "uuid",
          "name": "Labs",
          "description": "Unlimited labs create and manage"
        }
      ]
    }
  ]
}
```

**UI Implementation Notes:**
- Display plans in a pricing table/grid
- Highlight current plan (if any)
- Show "Upgrade" button for lower tiers
- Display yearly pricing with discount badge

---

## Current Subscription Status

### 2. Get My Current Subscription

**Endpoint:**
```
GET /api/v1/subscription/billing-history
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Billing history fetched successfully",
  "data": [
    {
      "id": "uuid",
      "planName": "Pro",
      "planDescription": "Advanced features for growing clinics",
      "startsAt": "2024-01-01T00:00:00Z",
      "expiresAt": "2024-02-01T00:00:00Z",
      "active": true,
      "paymentStatus": "success",
      "price": "999.00",
      "currency": "INR"
    }
  ]
}
```

**UI Implementation Notes:**
- Show current active subscription in dashboard
- Display renewal date
- Show payment history table

---

### 3. Get Limits Overview (Usage Dashboard)

**Endpoint:**
```
GET /api/v1/subscription/limitations/overview
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response - Success (200):**
```json
{
  "success": true,
  "data": {
    "plan": {
      "planId": "uuid",
      "planSlug": "pro-monthly"
    },
    "limits": [
      {
        "featureKey": "doctor_accounts",
        "description": "Maximum doctor accounts per clinic",
        "enabled": true,
        "baseLimit": 2,
        "addOnLimit": 1,
        "totalLimit": 3,
        "currentUsage": 2,
        "remaining": 1
      },
      {
        "featureKey": "staff_accounts",
        "description": "Maximum staff accounts per clinic",
        "enabled": true,
        "baseLimit": 2,
        "addOnLimit": 0,
        "totalLimit": 2,
        "currentUsage": 1,
        "remaining": 1
      },
      {
        "featureKey": "whatsapp_messages_per_month",
        "description": "WhatsApp messages allowed per month",
        "enabled": true,
        "baseLimit": 2000,
        "addOnLimit": 0,
        "totalLimit": 2000,
        "currentUsage": 150,
        "remaining": 1850
      }
    ]
  }
}
```

**UI Implementation Notes:**
- Display usage bars with percentages
- Show "Upgrade" or "Buy Add-On" buttons for limits near threshold
- Color code: Green (>50%), Yellow (<50%), Red (0 remaining)

---

## Add-On Management

### 4. Get Available Add-Ons (Add-On Marketplace)

**Endpoint:**
```
GET /api/v1/subscription/addons/available
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Available add-ons fetched successfully",
  "data": [
    {
      "id": "uuid",
      "name": "Additional Doctor",
      "description": "Add 1 extra doctor account to your clinic",
      "featureKey": "additional_doctor",
      "unitValue": 1,
      "monthlyPrice": "499.00",
      "yearlyPrice": "5389.00",
      "currency": "INR",
      "isActive": true,
      "pricing": {
        "monthly": 499,
        "yearly": 5389
      }
    },
    {
      "id": "uuid",
      "name": "Additional Staff Member",
      "description": "Add 1 extra receptionist/staff account",
      "featureKey": "additional_staff",
      "unitValue": 1,
      "monthlyPrice": "99.00",
      "yearlyPrice": "1069.00",
      "currency": "INR",
      "isActive": true,
      "pricing": {
        "monthly": 99,
        "yearly": 1069
      }
    }
  ]
}
```

**UI Implementation Notes:**
- Display add-ons in cards with pricing
- Show quantity selector
- Highlight yearly savings (10% discount)

---

### 5. Get My Add-Ons (Current Purchases)

**Endpoint:**
```
GET /api/v1/subscription/addons/my-addons
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Your add-ons fetched successfully",
  "data": [
    {
      "id": "uuid",
      "clinicId": "uuid",
      "addOnId": "uuid",
      "quantity": 1,
      "billingCycle": "monthly",
      "startsAt": "2024-01-01T00:00:00Z",
      "expiresAt": "2024-02-01T00:00:00Z",
      "isActive": true,
      "price": "499.00",
      "addOn": {
        "id": "uuid",
        "name": "Additional Doctor",
        "featureKey": "additional_doctor",
        "unitValue": 1
      },
      "isExpired": false
    }
  ]
}
```

**UI Implementation Notes:**
- Show active add-ons in dashboard
- Display expiry dates with renewal warnings
- Allow cancellation before renewal

---

### 6. Purchase Add-On (Step 1: Initiate)

**Endpoint:**
```
POST /api/v1/subscription/addons/purchase
```

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "addOnId": "uuid-of-addon",
  "billingCycle": "monthly",
  "quantity": 1
}
```

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Add-on purchase initiated",
  "data": {
    "orderId": "order_123456789",
    "amount": 49900,
    "currency": "INR",
    "keyId": "rzp_test_...",
    "addOn": {
      "id": "uuid",
      "name": "Additional Doctor",
      "featureKey": "additional_doctor",
      "unitValue": 1
    },
    "quantity": 1,
    "billingCycle": "monthly"
  }
}
```

**Validation Rules:**
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `addOnId` | UUID | Yes | Valid UUID format |
| `billingCycle` | String | Yes | Enum: 'monthly' \| 'yearly' |
| `quantity` | Integer | No | Default: 1, Min: 1 |

**Error Responses:**
```json
// 400 - Add-on not available
{
  "success": false,
  "message": "Add-on is not available for purchase",
  "status": 400
}

// 400 - Already have this add-on
{
  "success": false,
  "message": "Clinic already has this add-on active",
  "status": 400
}

// 400 - No active subscription
{
  "success": false,
  "message": "Clinic must have an active subscription to purchase add-ons",
  "status": 400
}
```

---

## Payment Flow

### Complete Razorpay Integration Flow

```javascript
// Step 1: Initiate purchase
const initiateResponse = await fetch('/api/v1/subscription/addons/purchase', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    addOnId: 'uuid',
    billingCycle: 'monthly',
    quantity: 1
  })
});

const { data } = await initiateResponse.json();

// Step 2: Open Razorpay Checkout
const options = {
  key: data.keyId,
  amount: data.amount,
  currency: data.currency,
  name: 'IMS Subscription',
  description: `${data.addOn.name} (${data.billingCycle})`,
  order_id: data.orderId,
  handler: async function (response) {
    // Step 3: Verify payment
    const verifyResponse = await fetch('/api/v1/subscription/addons/verify-purchase', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        orderId: data.orderId,
        paymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
        addOnId: data.addOn.id,
        billingCycle: data.billingCycle,
        quantity: data.quantity
      })
    });
    
    const result = await verifyResponse.json();
    
    if (result.success) {
      // Show success message, refresh subscription data
      showToast('Add-on purchased successfully!');
      refreshDashboard();
    }
  },
  prefill: {
    name: user.name,
    email: user.email
  },
  theme: {
    color: '#3399cc'
  }
};

const rzp = new Razorpay(options);
rzp.open();
```

### 7. Verify Payment & Complete Purchase (Step 2)

**Endpoint:**
```
POST /api/v1/subscription/addons/verify-purchase
```

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "orderId": "order_123456789",
  "paymentId": "pay_123456789",
  "signature": "signature_hash",
  "addOnId": "uuid-of-addon",
  "billingCycle": "monthly",
  "quantity": 1
}
```

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Add-on purchased successfully",
  "data": {
    "clinicAddOn": {
      "id": "uuid",
      "clinicId": "uuid",
      "addOnId": "uuid",
      "quantity": 1,
      "billingCycle": "monthly",
      "isActive": true
    },
    "addOn": {
      "name": "Additional Doctor",
      "featureKey": "additional_doctor",
      "unitValue": 1
    },
    "expiresAt": "2024-02-01T00:00:00Z"
  }
}
```

**Important: Frontend must implement Razorpay handler properly**

---

## Subscription Purchase (Same Flow)

### 8. Subscribe to Plan

**Step 1 - Initiate:**
```
POST /api/v1/subscription/subscribe
Body: { planId: "uuid", providerSubscriptionId?: "pro-yearly" }
```

**Step 2 - Verify:**
```
POST /api/v1/subscription/verify-subscription
Body: { orderId, paymentId, signature, planId, providerSubscriptionId? }
```

**Free Plan:**
```
POST /api/v1/subscription/initial-subscribe
Body: { planId: free-plan-uuid }
// No payment required
```

---

## Usage & Limits Display

### 9. Check Specific Feature Limit

**Endpoint:**
```
GET /api/v1/subscription/limitations/check/:featureKey
```

**Example Feature Keys:**
- `doctor_accounts`
- `staff_accounts`
- `whatsapp_messages_per_month`
- `lab_integration`

**Response:**
```json
{
  "success": true,
  "message": "Doctor limit check completed",
  "data": {
    "allowed": true,
    "currentUsage": 2,
    "limit": 3,
    "isUnlimited": false,
    "remaining": 1,
    "message": null
  }
}
```

**UI Usage:**
- Check **before** showing "Add Doctor" button
- Show upgrade prompt if `allowed: false`

---

## Error Handling

### Common Error Responses

| HTTP Status | Error | Frontend Action |
|-------------|-------|-----------------|
| 400 | `Clinic must have an active subscription` | Show subscription required modal |
| 400 | `You have reached your plan limit` | Show upgrade CTA |
| 400 | `Invalid payment` | Show retry payment button |
| 403 | `Clinic context required` | Redirect to clinic selection |
| 404 | `Add-on not found` | Refresh add-ons list |
| 403 | `This feature requires an active clinic subscription` | Redirect to pricing page |

### Frontend Error Handler Example

```javascript
async function handleApiError(response) {
  const error = await response.json();
  
  switch (error.status) {
    case 400:
      if (error.message.includes('active subscription')) {
        showSubscriptionModal();
      } else if (error.message.includes('limit')) {
        showUpgradeModal(error.message);
      }
      break;
    case 403:
      if (error.message.includes('subscription')) {
        redirectToPricing();
      }
      break;
    default:
      showToast(error.message, 'error');
  }
}
```

---

## Best Practices

### 1. Cache Limits Data
```javascript
// Cache clinic limits for 2 minutes (server-side TTL is 120s)
const limits = await fetchWithCache('/api/v1/subscription/limitations/overview', {
  cacheTime: 2 * 60 * 1000  // 2 minutes
});
```

### 2. Pre-check Before Actions
```javascript
// Check limit before showing "Add Doctor" button
async function canAddDoctor() {
  const check = await fetch('/api/v1/subscription/limitations/check/doctor_accounts');
  const { data } = await check.json();
  return data.allowed;
}

// In your component
const showAddButton = await canAddDoctor();
```

### 3. Show Warnings at Thresholds
```javascript
// Show warning at 80% usage
const usagePercent = (currentUsage / limit) * 100;
if (usagePercent >= 80 && usagePercent < 100) {
  showWarning('You are nearing your limit. Consider upgrading.');
}
```

### 4. Handle Payment Failures Gracefully
```javascript
// Razorpay failure handler
rzp.on('payment.failed', function (response) {
  // Log for analytics
  analytics.track('Payment Failed', response.error);
  
  // Show user-friendly message
  showToast('Payment failed. Please try again or contact support.', 'error');
  
  // Allow retry
  showRetryButton();
});
```

### 5. Refresh Data After Purchase
```javascript
// After successful add-on purchase
onPurchaseSuccess() {
  // Refresh all subscription-related data
  Promise.all([
    refreshLimits(),
    refreshMyAddOns(),
    refreshBillingHistory()
  ]);
  
  showToast('Purchase successful!', 'success');
}
```

---

## UI Components Checklist

### Must-Have Components

| Component | API Endpoint | Priority |
|-----------|--------------|----------|
| Pricing Table | `GET /plans` | High |
| Current Subscription Card | `GET /billing-history` | High |
| Usage Dashboard | `GET /limitations/overview` | High |
| Add-On Marketplace | `GET /addons/available` | Medium |
| My Add-Ons List | `GET /addons/my-addons` | Medium |
| Payment Integration | Razorpay Checkout | High |
| Upgrade Prompt Modal | N/A (UI only) | High |

---

## Quick Reference Table

| Feature | Endpoint | Method |
|---------|----------|--------|
| View plans | `/plans` | GET |
| Subscribe | `/subscribe` | POST |
| Verify payment | `/verify-subscription` | POST |
| View add-ons | `/addons/available` | GET |
| Buy add-on (init) | `/addons/purchase` | POST |
| Buy add-on (verify) | `/addons/verify-purchase` | POST |
| View my add-ons | `/addons/my-addons` | GET |
| Cancel add-on | `/addons/cancel/:id` | PUT |
| View limits | `/limitations/overview` | GET |
| Check limit | `/limitations/check/:key` | GET |
| Billing history | `/billing-history` | GET |

---

*Last updated: 2025-01-09*
*For backend API details, see [SUBSCRIPTION_MODULE.md](./SUBSCRIPTION_MODULE.md)*
