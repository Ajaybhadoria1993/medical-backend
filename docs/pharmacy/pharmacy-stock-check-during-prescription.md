# Pharmacy Stock Check During Prescription Writing

## Overview

This feature allows doctors to see real-time pharmacy **stock availability** (not just catalog existence) while writing prescriptions. It uses an event-driven write-through Redis cache that requires **zero DB queries** on the doctor side and **zero API calls per appointment**.

---

## Problem Statement

When a doctor writes a prescription, they have no visibility into whether the clinic's pharmacy has the medicine **in stock**. This leads to:
- Patients receiving prescriptions for out-of-stock medicines
- Pharmacy rejecting or putting prescriptions on hold
- Poor patient experience

**Constraints:**
- No extra database tables
- No extra DB calls on doctor side
- No per-medicine API calls during prescription writing
- Must account for actual stock (stocked - sold - expired)
- Must handle clinics without a pharmacy gracefully

---

## Data Model (Existing — No Changes)

```
pharmacy_medicines (catalog entry)
    ↓ has many
pharmacy_stock_medicine (batches: quantity, expiry, batch number)
    ↓ linked via
pharmacy_stock (purchase record: pharmacyId, supplier, date)
    ↓ sold via
pharmacy_sales_items (sold quantity per batch)

Available Stock = SUM(non-expired batch quantities) - SUM(sold quantities)
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ PHARMACY SIDE (Write-Through Cache — triggers on stock change)       │
│                                                                      │
│ Events that trigger cache rebuild:                                   │
│   • addStock() — new inventory received                              │
│   • createSale() — medicine sold to patient                          │
│   • updateStockMedicine() — batch quantity/expiry edited             │
│   • createMedicine() — new medicine added to catalog                 │
│   • updateMedicine() — medicine status/name changed                  │
│                                                                      │
│ On trigger → rebuildStockAvailabilityCache(pharmacyId)               │
│   → Single aggregated SQL query                                      │
│   → Redis SET "clinic:{clinicId}:pharmacy-stock"                     │
│   → Value: { "medicineName": availableQuantity, ... }                │
│   → TTL: NONE (lives until next stock change)                        │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                     ┌────────────────┐
                     │     REDIS      │
                     │                │
                     │ Key:           │
                     │ clinic:{id}:   │
                     │ pharmacy-stock │
                     │                │
                     │ Value:         │
                     │ JSON object    │
                     │ {name: qty}    │
                     └────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DOCTOR SIDE (Read ONCE per login session)                            │
│                                                                      │
│ Doctor logs in → frontend calls GET /pharmacy-availability (ONCE)    │
│   → Backend reads Redis (0 DB queries)                               │
│   → Returns { hasPharmacy, medicines: {name: qty} }                  │
│                                                                      │
│ Frontend stores Map<string, number> in memory                        │
│                                                                      │
│ Doctor writes prescription:                                          │
│   → Each medicine checked via local Map.get() (instant, 0 network)  │
│   → UI shows: ✅ In Stock (45) / ⚠️ Low Stock (3) /                 │
│               ❌ Out of Stock / ⬜ Not in Pharmacy                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Backend Implementation

### 1. Cache Rebuild Method (Pharmacy Side)

Add to `PharmacyMedicineService` or as a shared utility:

```ts
static async rebuildStockAvailabilityCache(pharmacyId: string) {
  // 1. Get clinicId for this pharmacy
  const [pharmacy] = await database
    .select({ clinicId: PharmacyModel.clinicId })
    .from(PharmacyModel)
    .where(eq(PharmacyModel.id, pharmacyId))
    .limit(1);

  if (!pharmacy) return;

  // 2. Single aggregated query: available stock per medicine
  //    Available = SUM(batch qty where not expired) - SUM(sold qty)
  const stockData = await database.execute(sql`
    SELECT
      pm.medicine_name,
      COALESCE(SUM(psm.quantity), 0) - COALESCE(SUM(sold.total_sold), 0) AS available
    FROM pharmacy_medicines pm
    LEFT JOIN pharmacy_stock_medicine psm
      ON psm.pharmacy_medicine_id = pm.id
    LEFT JOIN pharmacy_stock ps
      ON psm.pharmacy_stock_id = ps.id
      AND ps.pharmacy_id = ${pharmacyId}
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(psi.quantity), 0) AS total_sold
      FROM pharmacy_sales_items psi
      WHERE psi.pharmacy_stock_medicine_id = psm.id
    ) sold ON true
    WHERE pm.pharmacy_id = ${pharmacyId}
      AND pm.status = 'active'
      AND (psm.expiry > NOW() OR psm.expiry IS NULL)
    GROUP BY pm.id, pm.medicine_name
  `);

  // 3. Build stock map: { "medicine name": available_quantity }
  const stockMap: Record<string, number> = {};
  for (const row of stockData.rows) {
    const name = (row.medicine_name as string).toLowerCase().trim();
    const available = Math.max(Number(row.available) || 0, 0);
    // Accumulate if same normalized name appears multiple times
    stockMap[name] = (stockMap[name] || 0) + available;
  }

  // 4. Write to Redis — NO TTL (rebuilt only on stock change)
  const cacheKey = `clinic:${pharmacy.clinicId}:pharmacy-stock`;
  await redisClient.set(cacheKey, JSON.stringify(stockMap));
}
```

**Query cost:** 1 aggregated query with LATERAL join. Runs only when stock changes (20-50 times/day for a busy pharmacy).

---

### 2. Cache Invalidation Points

Add `rebuildStockAvailabilityCache(pharmacyId)` call (fire-and-forget) to these existing methods:

| File                                      | Method                  | Why                                          |
| ----------------------------------------- | ----------------------- | -------------------------------------------- |
| `pharmacies/services/stock.service.ts`    | `addStock()`            | New inventory received → quantities increase |
| `pharmacies/services/stock.service.ts`    | `updateStockMedicine()` | Batch qty/expiry edited                      |
| `pharmacies/services/stock.service.ts`    | `updateStock()`         | Stock entry modified                         |
| `pharmacies/services/sales.service.ts`    | `createSale()`          | Medicine sold → quantities decrease          |
| `pharmacies/services/medicine.service.ts` | `createMedicine()`      | New catalog entry (stock = 0)                |
| `pharmacies/services/medicine.service.ts` | `updateMedicine()`      | Status/name change                           |

**Pattern:**
```ts
// At the end of each method, after the main operation succeeds:
// Fire and forget — don't block the response
rebuildStockAvailabilityCache(pharmacyId).catch(err => {
  logger.error('Failed to rebuild stock cache', err);
});
```

---

### 3. Doctor-Side Read Endpoint

**Route:** `GET /api/v1/medicine/medicines/pharmacy-availability`
**Middleware:** `requireAuth`, `enforceClinicAutoLogout`
**Place BEFORE:** `/medicines/:medicineId` (to avoid param conflict)

**Service method:**

```ts
static async getPharmacyAvailability(clinicId: string) {
  // Fast path: check if we already know there's no pharmacy
  const noPharmacyFlag = await redisClient.get(
    `clinic:${clinicId}:no-pharmacy`
  );
  if (noPharmacyFlag) {
    return { hasPharmacy: false, medicines: {} };
  }

  // Read stock cache from Redis (0 DB queries)
  const cacheKey = `clinic:${clinicId}:pharmacy-stock`;
  const cached = await redisClient.get(cacheKey);

  if (cached) {
    return { hasPharmacy: true, medicines: JSON.parse(cached) };
  }

  // Cache miss — check if clinic has a pharmacy
  const [pharmacy] = await database
    .select({ id: PharmacyModel.id })
    .from(PharmacyModel)
    .where(
      and(
        eq(PharmacyModel.clinicId, clinicId),
        eq(PharmacyModel.isDeleted, false),
        eq(PharmacyModel.status, 'active')
      )
    )
    .limit(1);

  if (!pharmacy) {
    // No pharmacy — cache this fact for 1 hour
    await redisClient.setex(`clinic:${clinicId}:no-pharmacy`, 3600, '1');
    return { hasPharmacy: false, medicines: {} };
  }

  // Pharmacy exists but cache not built — build now (one-time bootstrap)
  await rebuildStockAvailabilityCache(pharmacy.id);
  const freshCache = await redisClient.get(cacheKey);

  return {
    hasPharmacy: true,
    medicines: freshCache ? JSON.parse(freshCache) : {},
  };
}
```

---

### 4. Controller

```ts
export const getPharmacyAvailabilityController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: 'Clinic context required',
      });
    }

    const result = await MedicineService.getPharmacyAvailability(clinicId);
    return res.status(200).json({ success: true, data: result });
  }
);
```

### 5. API Response

**Clinic with pharmacy (has stock):**
```json
{
  "success": true,
  "data": {
    "hasPharmacy": true,
    "medicines": {
      "paracetamol 500mg": 45,
      "amoxicillin 250mg": 120,
      "metformin 500mg": 0,
      "azithromycin 500mg": 8,
      "omeprazole 20mg": 200,
      "cetirizine 10mg": 3
    }
  }
}
```

**Clinic without pharmacy:**
```json
{
  "success": true,
  "data": {
    "hasPharmacy": false,
    "medicines": {}
  }
}
```

---

## Frontend Implementation

### 1. Pharmacy Stock Service

```ts
// src/services/pharmacyStockCheck.ts

interface PharmacyStockCache {
  hasPharmacy: boolean;
  stockMap: Map<string, number>;
}

let cache: PharmacyStockCache | null = null;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Initialize pharmacy stock data.
 * Call ONCE on doctor login or clinic entry.
 * Will not re-fetch if already loaded.
 */
export async function initPharmacyStock(): Promise<void> {
  if (cache !== null) return; // Already loaded

  try {
    const response = await fetch(
      '/api/v1/medicine/medicines/pharmacy-availability',
      { headers: { Authorization: `Bearer ${getAuthToken()}` } }
    );
    const result = await response.json();

    if (result.success && result.data.hasPharmacy) {
      const map = new Map<string, number>();
      for (const [name, qty] of Object.entries(result.data.medicines)) {
        map.set(normalize(name), qty as number);
      }
      cache = { hasPharmacy: true, stockMap: map };
    } else {
      cache = { hasPharmacy: false, stockMap: new Map() };
    }
  } catch {
    cache = { hasPharmacy: false, stockMap: new Map() };
  }
}

/**
 * Check medicine stock availability.
 * Returns null if clinic has no pharmacy (show nothing in UI).
 * Otherwise returns status + quantity.
 *
 * ZERO network calls — pure local Map lookup.
 */
export function checkMedicineStock(medicineName: string): {
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'not_in_pharmacy';
  quantity: number;
} | null {
  if (!cache || !cache.hasPharmacy) return null;

  const key = normalize(medicineName);

  // Exact match
  if (cache.stockMap.has(key)) {
    const qty = cache.stockMap.get(key)!;
    return {
      status: qty > 10 ? 'in_stock' : qty > 0 ? 'low_stock' : 'out_of_stock',
      quantity: qty,
    };
  }

  // Partial match: pharmacy name contains typed name or vice versa
  for (const [stockName, qty] of cache.stockMap) {
    if (stockName.includes(key) || key.includes(stockName)) {
      return {
        status: qty > 10 ? 'in_stock' : qty > 0 ? 'low_stock' : 'out_of_stock',
        quantity: qty,
      };
    }
  }

  // Medicine not in pharmacy catalog at all
  return { status: 'not_in_pharmacy', quantity: 0 };
}

/** Clear cache on logout or clinic switch */
export function clearPharmacyStock(): void {
  cache = null;
}

/** Force refresh (e.g., after extended idle) */
export async function refreshPharmacyStock(): Promise<void> {
  cache = null;
  await initPharmacyStock();
}
```

---

### 2. App Initialization

```tsx
// In main app or auth provider
useEffect(() => {
  if (isAuthenticated && clinicId) {
    initPharmacyStock(); // Non-blocking, fires once
  }
  return () => clearPharmacyStock();
}, [isAuthenticated, clinicId]);
```

### 3. Stock Badge Component

```tsx
import { checkMedicineStock } from '@/services/pharmacyStockCheck';

export function MedicineStockBadge({ medicineName }: { medicineName: string }) {
  const stock = checkMedicineStock(medicineName);

  // No pharmacy — show nothing
  if (!stock) return null;

  switch (stock.status) {
    case 'in_stock':
      return (
        <span className="badge bg-green-100 text-green-800">
          ✓ In Stock ({stock.quantity})
        </span>
      );
    case 'low_stock':
      return (
        <span className="badge bg-yellow-100 text-yellow-800">
          ⚠ Low Stock ({stock.quantity})
        </span>
      );
    case 'out_of_stock':
      return (
        <span className="badge bg-red-100 text-red-800">
          ✗ Out of Stock
        </span>
      );
    case 'not_in_pharmacy':
      return (
        <span className="badge bg-gray-100 text-gray-600">
          Not in Pharmacy
        </span>
      );
  }
}
```

### 4. Integration in Prescription Form

```tsx
function PrescriptionMedicineRow({ medicine }) {
  return (
    <div className="flex items-center gap-3">
      <MedicineNameInput value={medicine.medicineName} />
      
      {/* Instant stock indicator — no async, no loading state */}
      {medicine.medicineName && (
        <MedicineStockBadge medicineName={medicine.medicineName} />
      )}
      
      <DosageInput value={medicine.dosage} />
      <FrequencyInput value={medicine.frequency} />
      <DurationInput value={medicine.duration} />
    </div>
  );
}
```

---

## Redis Key Schema

| Key                                | Value                              | TTL               | Written By                                         | Read By             |
| ---------------------------------- | ---------------------------------- | ----------------- | -------------------------------------------------- | ------------------- |
| `clinic:{clinicId}:pharmacy-stock` | `{"medicine name": quantity, ...}` | None (persistent) | `rebuildStockAvailabilityCache()` on stock change  | Doctor API endpoint |
| `clinic:{clinicId}:no-pharmacy`    | `"1"`                              | 1 hour            | Doctor API on first check (when no pharmacy found) | Doctor API          |

---

## When Cache Gets Rebuilt (Complete — All Scenarios Covered)

### Stock Quantity Changes

| Event                                        | Method                                        | Frequency             |
| -------------------------------------------- | --------------------------------------------- | --------------------- |
| New stock purchased                          | `PharmacyStockService.addStock()`             | 1-3 times/day         |
| Medicine sold to patient                     | `PharmacySalesService.createSale()`           | 10-30 times/day       |
| Stock batch edited                           | `PharmacyStockService.updateStockMedicine()`  | 1-5 times/day         |
| Stock entry modified (batches added/deleted) | `PharmacyStockService.updateStock()`          | 1-3 times/day         |
| Bulk stock import from Excel                 | `PharmacyStockService.importStockFromExcel()` | Rare (1-2 times/week) |

### Catalog Changes

| Event                           | Method                                               | Frequency             |
| ------------------------------- | ---------------------------------------------------- | --------------------- |
| New medicine added to catalog   | `PharmacyMedicineService.createMedicine()`           | 1-3 times/day         |
| Medicine status/name changed    | `PharmacyMedicineService.updateMedicine()`           | Rare                  |
| Bulk medicine import from Excel | `PharmacyMedicineService.importMedicinesFromExcel()` | Rare (1-2 times/week) |

### Expiry Handling (CRON)

| Trigger        | Schedule      | Reason                                                                     |
| -------------- | ------------- | -------------------------------------------------------------------------- |
| Daily CRON job | 2:00 AM daily | Batches that expired overnight need to be removed from cached stock counts |

```ts
// src/cron/jobs/pharmacyStockCache.cron.ts
cron.schedule('0 2 * * *', async () => {
  const pharmacies = await database
    .select({ id: PharmacyModel.id })
    .from(PharmacyModel)
    .where(and(eq(PharmacyModel.isDeleted, false), eq(PharmacyModel.status, 'active')));

  for (const pharmacy of pharmacies) {
    await rebuildStockAvailabilityCache(pharmacy.id);
  }
  logger.info(`CRON: Rebuilt stock cache for ${pharmacies.length} pharmacies`);
});
```

### Methods That Do NOT Need Cache Rebuild

| Method                                                                                  | Reason                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `updateStockInvoice()`                                                                  | Only changes invoice file URL, no quantity change |
| `getStocks()`, `getStockById()`, `getAvailableStock()`                                  | Read-only                                         |
| `getStockStats()`, `getExpiryStock()`                                                   | Read-only                                         |
| `exportAllStock()`, `exportAllMedicines()`                                              | Read-only                                         |
| `getMedicines()`, `getMedicineCategories()`, `getMedicineBrands()`, `getMedicineTags()` | Read-only                                         |
| `PatientSubscriptionService.createPatientSubscription()`                                | Only saves subscription config, doesn't sell      |
| `PatientSubscriptionService.updatePatientSubscription()`                                | Only edits subscription, no stock movement        |
| `generateStockSampleTemplate()`, `generateMedicineSampleTemplate()`                     | Template generation                               |
| `PharmacySalesService.getSales()`, `getSaleById()`, `getSalesStats()`                   | Read-only                                         |
| `PharmacySalesService.sendInvoiceViaWhatsApp()`                                         | Only sends message                                |
| `PharmacySalesService.getBatchAvailableQuantity()`                                      | Read-only                                         |

### Total Rebuilds

**~20-50 per day** for a busy pharmacy. Each rebuild = 1 aggregated SQL query + 1 Redis SET. Cost is negligible.

---

## Edge Cases

| Scenario                                | Behavior                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Clinic has no pharmacy                  | `hasPharmacy: false`. Frontend shows no stock indicators. Cached "no-pharmacy" flag for 1 hour.                                         |
| Medicine in catalog but zero stock      | Shows "Out of Stock" (quantity = 0). Doctor can still prescribe.                                                                        |
| Medicine not in catalog at all          | Shows "Not in Pharmacy". Doctor can still prescribe.                                                                                    |
| Pharmacy created after doctor logged in | Doctor won't see stock until next login/refresh. Acceptable.                                                                            |
| Sale happens while doctor is writing    | Cache rebuilds in background. Doctor sees slightly stale data (few minutes). Acceptable — pharmacy manages real-time stock, not doctor. |
| 5000+ medicines in pharmacy             | ~120KB JSON in Redis. ~25KB gzipped over network. Loaded once per session.                                                              |
| Multiple doctors in same clinic         | All read same Redis key. Zero additional cost per doctor.                                                                               |
| Redis unavailable                       | Graceful fallback — returns empty, no stock indicators shown. Prescription writing unaffected.                                          |
| Pharmacy deletes a medicine             | Rebuild removes it from cache. Existing doctor sessions show stale (shows old stock). Next login corrects.                              |

---

## Performance Summary

| Metric                             | Value                                       |
| ---------------------------------- | ------------------------------------------- |
| API calls per doctor per day       | **1** (on login)                            |
| DB queries per doctor per day      | **0** (Redis serves everything)             |
| DB queries per cache rebuild       | **1** (aggregated query)                    |
| Cache rebuilds per day             | **15-40** (only on stock changes)           |
| Frontend stock check latency       | **<1ms** (Map.get())                        |
| Redis reads per doctor per session | **1**                                       |
| Payload size (2000 medicines)      | ~80KB raw / ~15KB gzipped                   |
| Frontend memory usage              | ~300KB (Map with 2000 entries + quantities) |

---

## Files to Modify

### Backend

| File                                                        | Change                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/main/pharmacies/services/medicine.service.ts`          | Add `rebuildStockAvailabilityCache()`. Call in `createMedicine()`, `updateMedicine()`, `importMedicinesFromExcel()`.        |
| `src/main/pharmacies/services/stock.service.ts`             | Call `rebuildStockAvailabilityCache()` in `addStock()`, `updateStock()`, `updateStockMedicine()`, `importStockFromExcel()`. |
| `src/main/pharmacies/services/sales.service.ts`             | Call `rebuildStockAvailabilityCache()` in `createSale()`.                                                                   |
| `src/main/medicine/services/medicine.service.ts`            | Add `getPharmacyAvailability(clinicId)` method.                                                                             |
| `src/main/medicine/controllers/medicine-crud.controller.ts` | Add `getPharmacyAvailabilityController`.                                                                                    |
| `src/main/medicine/routes/v1/medicine.route.ts`             | Add GET route before `:medicineId` param route.                                                                             |
| `src/cron/jobs/pharmacyStockCache.cron.ts`                  | NEW — Daily CRON to rebuild caches (handles expiry).                                                                        |

### Frontend

| File                             | Change                                           |
| -------------------------------- | ------------------------------------------------ |
| `services/pharmacyStockCheck.ts` | New file — init, check, clear, refresh functions |
| App init / auth provider         | Call `initPharmacyStock()` on login              |
| `MedicineStockBadge` component   | New component showing stock status               |
| Prescription form medicine rows  | Integrate `MedicineStockBadge`                   |

---

## Implementation Checklist

### Backend
- [ ] Create `rebuildStockAvailabilityCache(pharmacyId)` helper
- [ ] Add fire-and-forget call in `PharmacyStockService.addStock()`
- [ ] Add fire-and-forget call in `PharmacyStockService.updateStock()`
- [ ] Add fire-and-forget call in `PharmacyStockService.updateStockMedicine()`
- [ ] Add fire-and-forget call in `PharmacyStockService.importStockFromExcel()`
- [ ] Add fire-and-forget call in `PharmacySalesService.createSale()`
- [ ] Add fire-and-forget call in `PharmacyMedicineService.createMedicine()`
- [ ] Add fire-and-forget call in `PharmacyMedicineService.updateMedicine()`
- [ ] Add fire-and-forget call in `PharmacyMedicineService.importMedicinesFromExcel()`
- [ ] Create daily CRON job (`src/cron/jobs/pharmacyStockCache.cron.ts`) for expiry handling
- [ ] Add `getPharmacyAvailability()` to `MedicineService`
- [ ] Add controller + route
- [ ] Clear `clinic:{clinicId}:no-pharmacy` when new pharmacy is created
- [ ] Test: verify cache rebuilds correctly with sample data

### Frontend
- [ ] Create `pharmacyStockCheck.ts` service
- [ ] Call `initPharmacyStock()` on authentication/clinic entry
- [ ] Call `clearPharmacyStock()` on logout
- [ ] Create `MedicineStockBadge` component
- [ ] Integrate badge in prescription form
- [ ] Handle edge case: stock data not yet loaded (show nothing, not error)
- [ ] Test: verify correct badges for in-stock, low, out-of-stock, not-in-pharmacy

---

## Security

- Endpoint requires `requireAuth` — only authenticated clinic users can access
- Data scoped by `clinicId` from auth middleware — no cross-clinic leakage
- Redis keys are clinic-scoped
- Only medicine names + quantities exposed — no pricing, supplier, or batch details
- Doctor can still prescribe any medicine regardless of stock status (informational only)
