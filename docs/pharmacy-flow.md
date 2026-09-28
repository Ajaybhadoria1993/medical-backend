# Pharmacy Flow and Available Stock

This document explains the pharmacy module flow in `src/main/pharmacies` and how available stock is calculated.

Note: the source folder is `src/main/pharmacies`. If you see `/main/pharamacies` in notes or tickets, that is a spelling typo.

## Main Files

| Area | Files |
| --- | --- |
| Medicine catalog | `src/main/pharmacies/routes/v1/medicine.route.ts`, `controllers/medicine.controller.ts`, `services/medicine.service.ts`, `models/pharmacyMedicine.model.ts` |
| Stock purchase and batches | `src/main/pharmacies/routes/v1/stock.route.ts`, `controllers/stock.controller.ts`, `services/stock.service.ts`, `models/pharmacyStock.model.ts`, `models/pharmacyStockMedicine.model.ts` |
| Sales | `src/main/pharmacies/routes/v1/sales.route.ts`, `controllers/sales.controller.ts`, `services/sales.service.ts`, `models/pharmacySales.model.ts`, `models/pharmacySalesItems.model.ts` |
| Suppliers | `src/main/pharmacies/routes/v1/supplier.route.ts`, `controllers/supplier.controller.ts`, `services/supplier.service.ts`, `models/pharmacySupplier.model.ts` |

## High Level Flow

```text
Authenticated user
  -> PharmacySupplierService.getUserPharmacyId(userId)
  -> pharmacyId
  -> pharmacy service method
  -> Drizzle query/transaction
  -> JSON response
```

Most pharmacy endpoints first resolve the current user's pharmacy by calling `PharmacySupplierService.getUserPharmacyId(userId)`. After that, every query is scoped by `pharmacyId`, so one pharmacy does not read or modify another pharmacy's data.

## Core Data Model

```text
pharmacies
  -> pharmacy_medicines
       Medicine catalog for a pharmacy.

pharmacies
  -> pharmacy_stock
       Purchase header: supplier, purchase date, invoice, payment status, total amount.

pharmacy_stock
  -> pharmacy_stock_medicine
       Purchase line/batch: medicine, batch, expiry, purchased quantity, MRP, cost.

pharmacy_stock_medicine
  -> pharmacy_sales_items
       Sold quantity from a specific stock batch.

pharmacy_sales
  -> pharmacy_sales_items
       Sale header and sale line items.
```

Important tables:

| Table | Purpose |
| --- | --- |
| `pharmacy_medicines` | Stores medicine catalog entries for each pharmacy. |
| `pharmacy_stock` | Stores one purchase/stock entry. |
| `pharmacy_stock_medicine` | Stores individual stock batches for medicines. |
| `pharmacy_sales` | Stores sale header information. |
| `pharmacy_sales_items` | Stores sold quantities against stock batch IDs. |

## Medicine Catalog Flow

Medicine records are created before stock can be added for them.

```text
POST /add-medicine
  -> medicine.route.ts
  -> addMedicineController
  -> PharmacyMedicineService.createMedicine(payload, pharmacyId)
  -> insert into pharmacy_medicines
```

The medicine catalog stores values like medicine name, brand, composition, category, HSN, form, shelf, reorder level, pack size, SKU, and status.

Medicine listing also calculates `availableQuantity` and `stockStatus`.

```text
GET /get-all-medicines
  -> getMedicinesController
  -> PharmacyMedicineService.getMedicines(pharmacyId, query)
```

For each medicine, the service:

1. Finds non-expired batches from `pharmacy_stock_medicine`.
2. Sums sold quantity from `pharmacy_sales_items`.
3. Calculates available quantity per batch.
4. Adds positive remaining quantities.
5. Compares the total against the medicine reorder value.

Stock status rules:

| Status | Rule |
| --- | --- |
| `empty` | Available quantity is `0`. |
| `low` | Available quantity is greater than `0` and less than or equal to `reorder`. |
| `medium` | Available quantity is less than or equal to `reorder * 3`. |
| `good` | Available quantity is greater than `reorder * 3`. |

## Stock Purchase Flow

Stock is added through `PharmacyStockService.addStock`.

```text
POST /add-stock
  -> stock.route.ts
  -> addStockController
  -> PharmacyStockService.addStock(payload, pharmacyId)
  -> transaction
       -> verify pharmacy exists
       -> verify supplier belongs to pharmacy, if supplierId is provided
       -> insert purchase header into pharmacy_stock
       -> verify all medicine IDs belong to pharmacy
       -> insert batch rows into pharmacy_stock_medicine
  -> refresh Redis stock cache for affected medicines
```

Request body is validated by `addStockSchema`.

Each stock request contains:

| Field | Meaning |
| --- | --- |
| `supplierId` | Optional supplier linked to the purchase. |
| `purchaseDate` | Purchase date. |
| `invoice` | Optional invoice URL/string. |
| `pharmacyStockPaymentStatus` | `paid`, `unpaid`, or `partial`. |
| `paymentNotes` | Optional notes. |
| `medicines` | One or more stock batch rows. |

Each medicine stock row contains:

| Field | Meaning |
| --- | --- |
| `pharmacyMedicineId` | Medicine catalog ID. |
| `batch` | Optional batch number. |
| `expiry` | Batch expiry date. |
| `quantity` | Purchased quantity for this batch. |
| `mrp` | Selling price used for billing. |
| `cost` | Purchase cost. |

`addStock` also calculates:

```text
unit = number of medicines in the purchase
totalAmount = SUM(cost * quantity)
totalCost per row = cost * quantity
```

After the transaction succeeds, `refreshStockCacheMedicinesSafely(pharmacyId, medicineIds)` updates the stock cache for the medicines affected by the purchase.

## Sales Flow

Sales consume stock by inserting rows into `pharmacy_sales_items`. The code does not decrement `pharmacy_stock_medicine.quantity` directly. Instead, it keeps the original purchased quantity and subtracts sold quantities when calculating availability.

```text
POST /create-sale
  -> sales.route.ts
  -> createSaleController
  -> PharmacySalesService.createSale(payload, pharmacyId, userId)
  -> transaction
       -> verify pharmacy exists
       -> fetch selected stock batches
       -> fetch already sold quantity per batch
       -> reject expired batches
       -> calculate available quantity
       -> reject if requested quantity is greater than available quantity
       -> insert sale into pharmacy_sales
       -> insert sale items into pharmacy_sales_items
  -> refresh Redis stock cache for affected medicines
```

Availability validation during sale:

```text
availableQuantity =
  original batch quantity
  - already sold quantity for that batch
  - quantity already reserved earlier in the same request
```

This prevents over-selling, including the case where the same batch appears more than once in the same sale request.

## Available Stock Endpoint

The main available-stock API is:

```text
GET /get-available-stock
```

Route/controller/service path:

```text
stock.route.ts
  -> getAvailableStockController
  -> PharmacySupplierService.getUserPharmacyId(userId)
  -> PharmacyStockService.getAvailableStock(pharmacyId, query)
```

Supported query filters from `getAvailableStockQuerySchema`:

| Query | Meaning |
| --- | --- |
| `pageNumber` | Page number, default handled in service. |
| `pageSize` | Page size, max `100`. |
| `search` | Searches medicine name, SKU, brand name, and composition. |
| `category` | Exact medicine category filter. |
| `form` | Exact medicine form filter. |
| `medicineName` | Partial medicine name filter. |

## How Available Stock Is Calculated

Available stock is calculated from batches, not from the medicine catalog alone.

Formula:

```text
available quantity per batch =
  COALESCE(pharmacy_stock_medicine.quantity, 0)
  - COALESCE(SUM(pharmacy_sales_items.quantity), 0)
```

Only batches are counted when:

```text
pharmacy_stock.pharmacy_id = current pharmacyId
pharmacy_medicines.pharmacy_id = current pharmacyId
pharmacy_medicines.status = 'active'
pharmacy_stock_medicine.expiry > NOW()
available quantity per batch > 0
```

The service first finds medicines that have at least one non-expired batch with remaining quantity. Then it fetches all non-expired batches for the medicines on the current page and removes fully sold batches.

Response shape:

```json
{
  "success": true,
  "data": [
    {
      "id": "medicine-id",
      "medicineName": "Paracetamol 500",
      "sku": "PCM-500",
      "brandName": "Brand",
      "composition": "Paracetamol",
      "category": "Tablet",
      "form": "Tablet",
      "shelf": "A1",
      "packOf": 10,
      "availableQuantity": 40,
      "tags": ["fever"],
      "medicineAvailable": [
        {
          "id": "stock-medicine-batch-id",
          "batch": "BATCH-001",
          "expiry": "2027-01-01T00:00:00.000Z",
          "quantity": 40,
          "mrp": 20,
          "cost": 12,
          "gstPercentage": 12
        }
      ]
    }
  ],
  "pagination": {
    "totalRecords": 1,
    "totalPages": 1,
    "currentPage": 1,
    "pageSize": 10
  }
}
```

In this response:

| Field | Meaning |
| --- | --- |
| `availableQuantity` | Total remaining quantity across all available batches for that medicine. |
| `medicineAvailable` | Batch-level availability list used for sale selection. |
| `medicineAvailable[].quantity` | Remaining quantity in that specific batch. |

## Redis Stock Cache

The stock service also maintains a Redis cache for quick pharmacy stock lookup.

Cache key:

```text
pharmacy:stock-cache:{pharmacyId}
```

Cache value:

```json
[
  {
    "medicineName": "Paracetamol 500",
    "availableQuantity": 40
  }
]
```

The cache is built using the same core idea:

```text
SUM(GREATEST(batch quantity - sold quantity, 0))
```

The cache only includes:

```text
active medicines
current pharmacy stock
non-expired batches
medicines with available quantity greater than 0
```

Cache-related methods:

| Method | Purpose |
| --- | --- |
| `buildStockCache(pharmacyId)` | Builds full pharmacy stock cache. |
| `buildStockCacheForMedicines(pharmacyId, medicineIds)` | Builds cache rows for selected medicines. |
| `refreshStockCache(pharmacyId)` | Writes full cache to Redis. |
| `refreshStockCacheMedicines(pharmacyId, medicineIds)` | Updates only affected medicines in Redis. |
| `getStockCache(pharmacyId)` | Reads cache; if missing, rebuilds it. |

Cache update points:

| Event | Method |
| --- | --- |
| Stock purchase added | `PharmacyStockService.addStock` |
| Stock batch updated | `PharmacyStockService.updateStockMedicine` |
| Sale created | `PharmacySalesService.createSale` |

## Expiry Stock

Expired and expiring stock is read through:

```text
GET /get-expiry-stock
```

This uses `PharmacyStockService.getExpiryStock`.

It calculates:

```text
remainingQuantity =
  purchased quantity
  - sold quantity
```

It supports:

| Query | Meaning |
| --- | --- |
| `medicineName` | Filter by medicine name or SKU. |
| `expiryDays = 0` | Expired stock. |
| `expiryDays > 0` | Stock expiring within that many days from current date. |

Only rows with remaining quantity greater than zero are returned.

## Important Notes

- `pharmacy_stock_medicine.quantity` stores purchased/original batch quantity.
- Sold quantity is stored separately in `pharmacy_sales_items.quantity`.
- Available stock is always computed as purchased minus sold.
- Expired batches are excluded from normal available stock.
- Fully sold batches are excluded from available stock.
- A sale validates stock before inserting sale items.
- The current user's `pharmacyId` is resolved server-side; clients do not choose the pharmacy scope for these flows.
