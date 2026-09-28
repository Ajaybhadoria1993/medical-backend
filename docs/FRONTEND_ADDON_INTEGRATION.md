# Frontend Integration Guide - Add-Ons (Separate API Approach)

This guide shows how to integrate add-ons using **separate API calls**.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PRICING PAGE                             │
├─────────────────────────────────────────────────────────────┤
│  SECTION 1: SUBSCRIPTION PLANS                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ API: GET /subscription/plans                        │   │
│  │ Returns: Plans with built-in features               │   │
│  │ Example: Free, Pro (₹999), Custom                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  SECTION 2: AVAILABLE ADD-ONS (Separate Section)           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ API: GET /subscription/addons/available             │   │
│  │ Returns: Purchasable add-ons                        │   │
│  │ Example: +1 Doctor (₹499), +1 Staff (₹99)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  SECTION 3: MY CURRENT ADD-ONS (Dashboard)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ API: GET /subscription/addons/my-addons             │   │
│  │ Returns: Active add-on subscriptions                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## API 1: Get Subscription Plans

**Purpose:** Display main subscription tiers (Free, Pro, Custom)

**Endpoint:**
```http
GET /api/v1/subscription/plans
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Plans fetched successfully",
  "data": [
    {
      "id": "f1b41673-8f51-4ed8-bd77-808ba446a006",
      "slug": "Free",
      "name": "Free",
      "description": "Basic access for small clinics",
      "price": "0.00",
      "currency": "INR",
      "features": [
        {
          "id": "...",
          "name": "Reports",
          "description": "Standard clinic reports"
        },
        {
          "id": "...",
          "name": "Appointments",
          "description": "Limited appointment scheduling"
        }
      ]
    },
    {
      "id": "a2c52784-9f62-5ed9-ce88-919cb557b117",
      "slug": "pro-monthly",
      "name": "Pro",
      "description": "Advanced features for growing clinics",
      "price": "999.00",
      "currency": "INR",
      "features": [
        {
          "id": "...",
          "name": "Pharmacy",
          "description": "Full pharmacy management"
        },
        {
          "id": "...",
          "name": "Labs",
          "description": "Unlimited lab management"
        }
      ]
    }
  ]
}
```

**UI Display:**
```
┌─────────────────┐  ┌─────────────────┐
│     FREE        │  │      PRO        │
│     ₹0          │  │    ₹999/mo      │
├─────────────────┤  ├─────────────────┤
│ ✓ Reports       │  │ ✓ Pharmacy      │
│ ✓ Appointments  │  │ ✓ Labs          │
│ ✗ Pharmacy      │  │ ✓ Reports       │
│ ✗ Labs          │  │ ✓ Appointments  │
├─────────────────┤  ├─────────────────┤
│  [Select]       │  │  [Upgrade]      │
└─────────────────┘  └─────────────────┘
```

---

## API 2: Get Available Add-Ons (SEPARATE)

**Purpose:** Display purchasable add-ons below plans or in a marketplace section

**Endpoint:**
```http
GET /api/v1/subscription/addons/available
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Available add-ons fetched successfully",
  "data": [
    {
      "id": "d3e63895-af73-7fa0-df99-a2adb668c228",
      "name": "Additional Doctor",
      "description": "Add 1 extra doctor account to your clinic",
      "featureKey": "additional_doctor",
      "unitValue": 1,
      "monthlyPrice": "499.00",
      "yearlyPrice": "4790.00",
      "currency": "INR",
      "isActive": true,
      "pricing": {
        "monthly": 499,
        "yearly": 4790
      }
    },
    {
      "id": "e4f74906-bf84-8fb1-eg00-b3bce779d339",
      "name": "Additional Staff Member",
      "description": "Add 1 extra receptionist/staff account",
      "featureKey": "additional_staff",
      "unitValue": 1,
      "monthlyPrice": "99.00",
      "yearlyPrice": "950.00",
      "currency": "INR",
      "isActive": true,
      "pricing": {
        "monthly": 99,
        "yearly": 950
      }
    },
    {
      "id": "f5g85017-cg95-9gc2-fh11-c4cdf880e440",
      "name": "Additional 1 GB Storage",
      "description": "Increase your storage capacity by 1GB",
      "featureKey": "additional_storage",
      "unitValue": 1,
      "monthlyPrice": "199.00",
      "yearlyPrice": "1910.00",
      "currency": "INR",
      "isActive": true,
      "pricing": {
        "monthly": 199,
        "yearly": 1910
      }
    },
    {
      "id": "g6i96128-dh06-ahd3-gi22-d5def991f551",
      "name": "Additional Branch",
      "description": "Add support for 1 additional clinic branch",
      "featureKey": "additional_branch",
      "unitValue": 1,
      "monthlyPrice": "999.00",
      "yearlyPrice": "9590.00",
      "currency": "INR",
      "isActive": true,
      "pricing": {
        "monthly": 999,
        "yearly": 9590
      }
    }
  ]
}
```

**UI Display (Separate Section Below Plans):**
```
═══════════════════════════════════════════════
           BOOST YOUR PLAN                      
         Purchase Add-Ons                       
═══════════════════════════════════════════════

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  +1 DOCTOR      │  │   +1 STAFF      │  │  +1 GB STORAGE  │
│    ₹499/mo      │  │    ₹99/mo       │  │   ₹199/mo       │
│  ₹5,389/yr      │  │  ₹1,069/yr      │  │  ₹2,149/yr      │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ Adds 1 doctor   │  │ Adds 1 staff    │  │ Adds 1GB        │
│ to your limit   │  │ to your limit   │  │ storage         │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│  [BUY NOW]      │  │  [BUY NOW]      │  │  [BUY NOW]      │
└─────────────────┘  └─────────────────┘  └─────────────────┘

┌─────────────────────────────────────────────┐
│           +1 BRANCH                         │
│           ₹999/mo                           │
│          ₹10,789/yr                         │
├─────────────────────────────────────────────┤
│ Add 1 additional clinic branch              │
├─────────────────────────────────────────────┤
│              [BUY NOW]                      │
└─────────────────────────────────────────────┘

💡 You have 2 doctors (limit: 3). Adding 1 more allows 4 doctors total.
```

---

## Frontend Integration - Pricing Page (Complete)

```javascript
// ==========================================
// PRICING PAGE COMPONENT
// ==========================================

import React, { useState, useEffect } from 'react';

const PricingPage = () => {
  const [plans, setPlans] = useState([]);
  const [addOns, setAddOns] = useState([]);
  const [myAddOns, setMyAddOns] = useState([]);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const token = getAuthToken();

  // Fetch all data when page loads
  useEffect(() => {
    loadPricingData();
  }, []);

  const loadPricingData = async () => {
    setLoading(true);
    try {
      // STEP 1 & 2: Fetch BOTH APIs in parallel
      const [plansRes, addOnsRes, myAddOnsRes, limitsRes] = await Promise.all([
        fetch('/api/v1/subscription/plans', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/v1/subscription/addons/available', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/v1/subscription/addons/my-addons', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/v1/subscription/limitations/overview', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const plansData = await plansRes.json();
      const addOnsData = await addOnsRes.json();
      const myAddOnsData = await myAddOnsRes.json();
      const limitsData = await limitsRes.json();

      setPlans(plansData.data);
      setAddOns(addOnsData.data);
      setMyAddOns(myAddOnsData.data);
      setLimits(limitsData.data);
    } catch (error) {
      console.error('Failed to load pricing data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // SECTION 1: SUBSCRIPTION PLANS
  // ==========================================
  const PlansSection = () => (
    <div className="plans-section">
      <h1>Choose Your Plan</h1>
      <div className="plans-grid">
        {plans.map(plan => (
          <PlanCard 
            key={plan.id} 
            plan={plan}
            isCurrentPlan={limits?.plan?.planId === plan.id}
            onSelect={() => handleSubscribe(plan.id)}
          />
        ))}
      </div>
    </div>
  );

  const PlanCard = ({ plan, isCurrentPlan, onSelect }) => (
    <div className={`plan-card ${isCurrentPlan ? 'current' : ''}`}>
      <h2>{plan.name}</h2>
      <div className="price">
        ₹{plan.price}
        {parseFloat(plan.price) > 0 && <span>/mo</span>}
      </div>
      <p className="description">{plan.description}</p>
      
      <ul className="features">
        {plan.features.map(feature => (
          <li key={feature.id}>✓ {feature.name}</li>
        ))}
      </ul>
      
      <button onClick={onSelect} disabled={isCurrentPlan}>
        {isCurrentPlan ? 'Current Plan' : 'Select'}
      </button>
    </div>
  );

  // ==========================================
  // SECTION 2: AVAILABLE ADD-ONS
  // ==========================================
  const AddOnsSection = () => {
    // Filter out add-ons already purchased
    const availableAddOns = addOns.filter(addOn => {
      const alreadyPurchased = myAddOns.some(
        myAddOn => myAddOn.addOn.id === addOn.id && myAddOn.isActive
      );
      return !alreadyPurchased;
    });

    if (availableAddOns.length === 0) return null;

    return (
      <div className="addons-section">
        <h2>Boost Your Plan</h2>
        <p className="subtitle">Purchase additional resources</p>
        
        <div className="addons-grid">
          {availableAddOns.map(addOn => (
            <AddOnCard 
              key={addOn.id} 
              addOn={addOn}
              onBuy={() => handleBuyAddOn(addOn)}
            />
          ))}
        </div>
      </div>
    );
  };

  const AddOnCard = ({ addOn, onBuy }) => (
    <div className="addon-card">
      <h3>{addOn.name}</h3>
      <div className="pricing-tabs">
        <div className="price-option">
          <span className="price">₹{addOn.pricing.monthly}</span>
          <span className="period">/mo</span>
        </div>
        <div className="price-option yearly">
          <span className="price">₹{addOn.pricing.yearly}</span>
          <span className="period">/yr</span>
          <span className="badge">Save 10%</span>
        </div>
      </div>
      <p className="description">{addOn.description}</p>
      
      {/* Show how it affects current limits */}
      <LimitImpact addOn={addOn} limits={limits} />
      
      <button onClick={onBuy}>Buy Now</button>
    </div>
  );

  // Show impact on current limits
  const LimitImpact = ({ addOn, limits }) => {
    const featureKey = addOn.featureKey.replace('additional_', '') + '_accounts';
    const currentLimit = limits?.limits?.find(l => l.featureKey === featureKey);
    
    if (!currentLimit) return null;
    
    const newTotal = currentLimit.baseLimit + currentLimit.addOnLimit + addOn.unitValue;
    
    return (
      <div className="limit-impact">
        <p>
          Current: {currentLimit.currentUsage} / {currentLimit.totalLimit}
        </p>
        <p className="new-limit">
          After purchase: {currentLimit.currentUsage} / <strong>{newTotal}</strong>
        </p>
      </div>
    );
  };

  // ==========================================
  // SECTION 3: MY ACTIVE ADD-ONS
  // ==========================================
  const MyAddOnsSection = () => {
    if (myAddOns.length === 0) return null;

    return (
      <div className="my-addons-section">
        <h2>My Active Add-Ons</h2>
        <div className="my-addons-list">
          {myAddOns.map(addOn => (
            <MyAddOnCard key={addOn.id} addOn={addOn} />
          ))}
        </div>
      </div>
    );
  };

  const MyAddOnCard = ({ addOn }) => (
    <div className={`my-addon-card ${addOn.isExpired ? 'expired' : ''}`}>
      <div className="addon-info">
        <h4>{addOn.addOn.name}</h4>
        <p>Qty: {addOn.quantity} × ₹{addOn.price}</p>
        <p>Billing: {addOn.billingCycle}</p>
      </div>
      <div className="addon-status">
        {addOn.isActive ? (
          <>
            <span className="badge active">Active</span>
            <p>Renews: {new Date(addOn.expiresAt).toLocaleDateString()}</p>
          </>
        ) : (
          <span className="badge expired">Expired</span>
        )}
      </div>
      <button onClick={() => handleCancelAddOn(addOn.id)}>
        Cancel Renewal
      </button>
    </div>
  );

  // ==========================================
  // PURCHASE FLOW
  // ==========================================
  const handleBuyAddOn = async (addOn) => {
    // Show billing cycle selector modal
    const billingCycle = await showBillingCycleSelector(addOn);
    if (!billingCycle) return;

    try {
      // Step 1: Initiate purchase
      const initResponse = await fetch('/api/v1/subscription/addons/purchase', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          addOnId: addOn.id,
          billingCycle: billingCycle,
          quantity: 1
        })
      });

      const { data } = await initResponse.json();

      // Step 2: Open Razorpay checkout
      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        order_id: data.orderId,
        name: 'IMS Add-On',
        description: `${data.addOn.name} (${data.billingCycle})`,
        
        handler: async (razorpayResponse) => {
          // Step 3: Verify payment
          const verifyResponse = await fetch(
            '/api/v1/subscription/addons/verify-purchase',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                orderId: data.orderId,
                paymentId: razorpayResponse.razorpay_payment_id,
                signature: razorpayResponse.razorpay_signature,
                addOnId: data.addOn.id,
                billingCycle: data.billingCycle,
                quantity: data.quantity
              })
            }
          );

          const result = await verifyResponse.json();

          if (result.success) {
            showToast('Add-on purchased successfully!');
            loadPricingData(); // Refresh all data
          }
        }
      };

      const rzp = new Razorpay(options);
      rzp.open();

    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const handleCancelAddOn = async (clinicAddOnId) => {
    if (!confirm('Cancel this add-on renewal?')) return;

    try {
      const response = await fetch(
        `/api/v1/subscription/addons/cancel/${clinicAddOnId}`,
        {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (response.ok) {
        showToast('Add-on renewal cancelled');
        loadPricingData();
      }
    } catch (error) {
      showToast('Failed to cancel add-on', 'error');
    }
  };

  const handleSubscribe = async (planId) => {
    // Similar flow for subscription purchase
    // ...
  };

  // ==========================================
  // RENDER
  // ==========================================
  if (loading) return <div>Loading pricing...</div>;

  return (
    <div className="pricing-page">
      <PlansSection />
      <MyAddOnsSection />
      <AddOnsSection />
    </div>
  );
};

export default PricingPage;
```

---

## Dashboard Integration - Show CurrentUsage

```javascript
// ==========================================
// DASHBOARD WIDGET - USAGE OVERVIEW
// ==========================================

const UsageWidget = () => {
  const [limits, setLimits] = useState(null);

  useEffect(() => {
    fetchLimits();
  }, []);

  const fetchLimits = async () => {
    const response = await fetch('/api/v1/subscription/limitations/overview', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { data } = await response.json();
    setLimits(data);
  };

  return (
    <div className="usage-widget">
      <h3>Usage Overview</h3>
      <p className="plan-name">{limits?.plan?.planSlug}</p>
      
      {limits?.limits?.map(limit => (
        <UsageBar key={limit.featureKey} limit={limit} />
      ))}
      
      <button onClick={() => navigate('/pricing')}>
        Buy Add-Ons
      </button>
    </div>
  );
};

const UsageBar = ({ limit }) => {
  const percent = (limit.currentUsage / limit.totalLimit) * 100;
  const isNearLimit = percent >= 80;
  const isAtLimit = limit.remaining === 0;

  return (
    <div className="usage-bar">
      <div className="usage-header">
        <span>{limit.description}</span>
        <span className={isAtLimit ? 'text-red' : isNearLimit ? 'text-yellow' : ''}>
          {limit.currentUsage} / {limit.totalLimit}
          {limit.addOnLimit > 0 && (
            <small> (Base: {limit.baseLimit}, Add-ons: {limit.addOnLimit})</small>
          )}
        </span>
      </div>
      
      <div className="progress-bar">
        <div 
          className={`progress-fill ${isAtLimit ? 'red' : isNearLimit ? 'yellow' : 'green'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      
      {isNearLimit && !isAtLimit && (
        <p className="warning">⚠️ Approaching limit! Consider buying an add-on.</p>
      )}
      
      {isAtLimit && (
        <p className="error">❌ Limit reached. Upgrade or buy add-ons to add more.</p>
      )}
    </div>
  );
};
```

---

## API Summary Table

| Purpose | API | When to Call |
|---------|-----|--------------|
| **Pricing Page** | `GET /plans` | Page load |
| **Add-On Marketplace** | `GET /addons/available` | Page load |
| **My Add-Ons** | `GET /addons/my-addons` | Page load |
| **Usage Stats** | `GET /limitations/overview` | Page load + Dashboard |
| **Buy Add-On** | `POST /addons/purchase` | User clicks "Buy" |
| **Complete Purchase** | `POST /addons/verify-purchase` | After Razorpay payment |
| **Cancel Add-On** | `PUT /addons/cancel/:id` | User clicks "Cancel" |

---

## Key Points to Remember

### 1. Separate APIs = Better Architecture
```
/plans          → Subscription tiers (Free, Pro, Custom)
/addons         → Purchasable extensions (+1 doctor, etc.)
```

### 2. Parallel API Calls
```javascript
const [plans, addOns] = await Promise.all([
  fetch('/plans'),
  fetch('/addons/available')
]);
```

### 3. Limits Include Add-Ons
```json
{
  "baseLimit": 2,      // From Pro plan
  "addOnLimit": 1,     // From purchased add-ons
  "totalLimit": 3      // Base + Add-ons
}
```

### 4. Payment is 2-Step
```
1. POST /addons/purchase → Get Razorpay order
2. Razorpay checkout → User pays
3. POST /addons/verify-purchase → Activate add-on
```

This is the **separate API approach** - clean, modular, and maintainable! 🚀
