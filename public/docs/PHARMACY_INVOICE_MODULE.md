# Pharmacy Invoice Module - Implementation Summary

## Overview

This module implements a complete pharmacy invoice system with strip-based medicine inventory management. The system automatically tracks stock, validates availability, and handles billing calculations.

---

## 📋 Database Schema Changes

### 1. **Stock Model Updates** (`stock.model.ts`)

**Changed Fields:**

- `quantity` → `totalStrips` (integer) - Number of strips in stock
- `initialQuantity` → `initialStrips` (integer) - Initial strips when added
- **NEW:** `stripQuantity` (integer) - Number of tablets per strip (e.g., 10, 12, 15)

**Pricing Model Updates:**

- `price` → `pricePerStrip` (decimal) - Price per strip instead of generic price

### 2. **New Invoice Models** (`invoice.model.ts`)

#### **Invoice Table** (`invoices`)

| Field        | Type      | Description             |
| ------------ | --------- | ----------------------- |
| id           | uuid      | Primary key             |
| customerName | string    | Required                |
| address      | text      | Optional                |
| mobile       | string    | Optional                |
| clinicId     | uuid      | FK → clinics.id         |
| pharmacyId   | uuid      | FK → pharmacies.id      |
| doctorId     | uuid      | Optional reference      |
| billingId    | uuid      | FK → invoice_billing.id |
| deletedAt    | timestamp | Soft delete             |
| createdAt    | timestamp | Auto                    |
| updatedAt    | timestamp | Auto                    |

#### **InvoiceMedicine Table** (`invoice_medicines`)

| Field         | Type      | Description           |
| ------------- | --------- | --------------------- |
| id            | uuid      | Primary key           |
| invoiceId     | uuid      | FK → invoices.id      |
| medicineId    | uuid      | FK → medicines.id     |
| strips        | integer   | Number of strips sold |
| pricePerStrip | decimal   | Price at time of sale |
| createdAt     | timestamp | Auto                  |

#### **InvoiceBilling Table** (`invoice_billing`)

| Field         | Type      | Description                  |
| ------------- | --------- | ---------------------------- |
| id            | uuid      | Primary key                  |
| invoiceId     | uuid      | FK → invoices.id (unique)    |
| tax           | decimal   | GST/VAT amount               |
| discount      | decimal   | Discount amount              |
| price         | decimal   | Subtotal before tax/discount |
| totalPrice    | decimal   | Final payable amount         |
| paymentMethod | enum      | CASH, CARD, UPI, WALLET      |
| createdAt     | timestamp | Auto                         |
| updatedAt     | timestamp | Auto                         |

---

## 🔧 API Endpoints

### **Base URL:** `/api/v1/pharmacy/invoice`

### 1. **Get Medicine Stock & Price**

```http
GET /api/v1/pharmacy/invoice/stock/:medicineId?pharmacyId={pharmacyId}
```

**Query Parameters:**

- `pharmacyId` (required) - Pharmacy ID

**Response:**

```json
{
  "success": true,
  "data": {
    "medicineId": "uuid",
    "medicineName": "Paracetamol 500mg",
    "availableStrips": 50,
    "stripQuantity": 10,
    "totalTablets": 500,
    "pricePerStrip": 12.5
  }
}
```

---

### 2. **Create Invoice**

```http
POST /api/v1/pharmacy/invoice
```

**Request Body:**

```json
{
  "customerName": "John Doe",
  "address": "123 Main St",
  "mobile": "9876543210",
  "pharmacyId": "uuid",
  "doctorId": "uuid",
  "medicines": [
    {
      "medicineId": "uuid",
      "strips": 2
    }
  ],
  "tax": 18.0,
  "discount": 5.0,
  "paymentMethod": "CASH"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Invoice created successfully",
  "data": {
    "invoice": { ... },
    "billing": { ... },
    "medicines": [ ... ]
  }
}
```

**Business Logic:**

1. Validates all medicines exist in stock
2. Checks sufficient quantity available
3. Reduces stock automatically
4. Calculates: `totalPrice = subtotal + tax - discount`
5. Creates invoice, billing, and medicine records in a transaction

---

### 3. **Get Invoices (List)**

```http
GET /api/v1/pharmacy/invoice?pharmacyId={id}&pageNumber=1&pageSize=10
```

**Query Parameters:**

- `pharmacyId` (optional) - Filter by pharmacy
- `pageNumber` (optional) - Default: 1
- `pageSize` (optional) - Default: 10

**Response:**

```json
{
  "success": true,
  "data": {
    "invoices": [ ... ],
    "pagination": {
      "total": 100,
      "pageNumber": 1,
      "pageSize": 10,
      "totalPages": 10
    }
  }
}
```

---

### 4. **Get Invoice by ID**

```http
GET /api/v1/pharmacy/invoice/:invoiceId
```

**Response:**

```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "uuid",
      "customerName": "John Doe",
      "address": "123 Main St",
      "mobile": "9876543210",
      ...
    },
    "billing": {
      "tax": "18.00",
      "discount": "5.00",
      "price": "100.00",
      "totalPrice": "113.00",
      "paymentMethod": "CASH"
    },
    "medicines": [
      {
        "medicineId": "uuid",
        "medicineName": "Paracetamol 500mg",
        "strips": 2,
        "pricePerStrip": "12.50"
      }
    ]
  }
}
```

---

### 5. **Update Invoice**

```http
PUT /api/v1/pharmacy/invoice/:invoiceId
```

**Request Body:** (all fields optional)

```json
{
  "customerName": "Jane Doe",
  "address": "456 Oak Ave",
  "mobile": "9876543211",
  "medicines": [
    {
      "medicineId": "uuid",
      "strips": 3
    }
  ],
  "tax": 20.0,
  "discount": 10.0,
  "paymentMethod": "UPI"
}
```

**Business Logic:**

1. Compares old vs new medicine list
2. **Adds back** stock for removed/reduced medicines
3. **Reduces** stock for added/increased medicines
4. Validates sufficient stock for increases
5. Recalculates billing
6. Updates all related tables in a transaction

---

### 6. **Delete Invoice (Soft Delete)**

```http
DELETE /api/v1/pharmacy/invoice/:invoiceId
```

**Authorization:** Admin or Super_Admin only

**Response:**

```json
{
  "success": true,
  "message": "Invoice deleted successfully"
}
```

---

## 📦 Stock Service Updates

### Updated Type Definitions

```typescript
export type AddStockPayload = {
  pharmacyId: string;
  medicineName: string;
  supplierName: string;
  batchNumber: string;
  totalStrips: number; // Number of strips
  stripQuantity: number; // Tablets per strip
  expiryDate: string;
  pricePerStrip?: number; // Price per strip
  mrp?: number;
  discount?: number;
};

export type UpdateStockPayload = {
  supplierName?: string;
  batchNumber?: string;
  totalStrips?: number;
  stripQuantity?: number;
  expiryDate?: string;
  lowStockThreshold?: number;
};

export type StockPricingPayload = {
  pricePerStrip: number; // Price per strip
  mrp?: number;
  discount?: number;
  currency?: string;
};
```

### Key Changes:

- All stock operations now use `totalStrips` and `stripQuantity`
- Stock status calculations based on strips, not individual units
- Pricing always references `pricePerStrip`

---

## 🔐 Authentication & Authorization

All endpoints require:

- `requireAuth` - Valid JWT token
- `requireClinic` - User must be assigned to a clinic

Delete endpoint additionally requires:

- `requireRole(['Admin', 'Super_Admin'])` - Admin privileges

---

## 🗂 File Structure

```
src/main/pharmacy/
├── models/
│   ├── pharmacy.model.ts
│   └── invoice.model.ts          ← NEW
├── services/
│   ├── pharmacy.service.ts
│   └── invoice.service.ts        ← NEW
├── controllers/
│   ├── pharmacy.controller.ts
│   └── invoice.controller.ts     ← NEW
├── routes/v1/
│   ├── pharmacy.route.ts
│   └── invoice.route.ts          ← NEW
└── schemas/
    └── pharmacy.schemas.ts

src/main/medicine/
├── models/
│   ├── medicine.model.ts
│   └── stock.model.ts            ← UPDATED
└── services/
    ├── medicine.service.ts
    └── stock.service.ts          ← UPDATED
```

---

## 🚀 Migration Steps

1. **Generate Migration:**

   ```bash
   npm run db:generate
   ```

2. **Review Migration File:**
   Check `src/drizzle/migrations/` for the new migration

3. **Run Migration:**

   ```bash
   npm run db:migrate
   ```

4. **Verify Tables:**
   - `invoices`
   - `invoice_medicines`
   - `invoice_billing`
   - Updated `stock` table with new fields

---

## 📊 Example Usage Flow

### Creating an Invoice:

1. **Check Stock Availability:**

   ```http
   GET /api/v1/pharmacy/invoice/stock/{medicineId}?pharmacyId={pharmacyId}
   ```

2. **Create Invoice:**

   ```http
   POST /api/v1/pharmacy/invoice
   {
     "customerName": "John Doe",
     "pharmacyId": "...",
     "medicines": [
       { "medicineId": "...", "strips": 2 }
     ],
     "tax": 18,
     "discount": 5,
     "paymentMethod": "CASH"
   }
   ```

3. **Stock Automatically Reduced:**
   - Medicine stock reduced by 2 strips
   - Invoice, billing, and medicine records created
   - Total price calculated and returned

### Updating an Invoice:

```http
PUT /api/v1/pharmacy/invoice/{invoiceId}
{
  "medicines": [
    { "medicineId": "...", "strips": 3 }  // Changed from 2 to 3
  ]
}
```

**Result:**

- 1 additional strip deducted from stock
- Billing recalculated
- All records updated atomically

---

## ✅ Testing Checklist

- [ ] Create invoice with single medicine
- [ ] Create invoice with multiple medicines
- [ ] Verify stock reduction after invoice creation
- [ ] Test insufficient stock error
- [ ] Update invoice - increase medicine quantity
- [ ] Update invoice - decrease medicine quantity
- [ ] Update invoice - change medicine list
- [ ] Verify stock adjustment on update
- [ ] Test billing calculation (tax + discount)
- [ ] Soft delete invoice
- [ ] Filter invoices by pharmacy
- [ ] Pagination works correctly
- [ ] Get single invoice with full details

---

## 🔍 Key Features

✅ **Strip-Based Inventory:** Medicines tracked in strips with configurable tablet counts
✅ **Automatic Stock Management:** Stock automatically reduced/adjusted on invoice operations
✅ **Transaction Safety:** All operations use database transactions for data integrity
✅ **Comprehensive Validation:** Stock availability, medicine existence, and data validation
✅ **Flexible Billing:** Supports tax, discounts, and multiple payment methods
✅ **Soft Delete:** Invoices can be soft-deleted without losing data
✅ **Audit Trail:** All timestamps tracked for created/updated records
✅ **Price History:** Prices captured at time of sale for accurate historical records

---

## 📝 Notes

- All prices stored as decimals with 2 decimal places
- Stock operations are atomic (transaction-based)
- Invoice updates intelligently adjust stock differences
- Deleted invoices remain in database with `deletedAt` timestamp
- Routes automatically loaded by the application
- API documentation auto-generated via Swagger

---

## 🐛 Troubleshooting

**Issue:** "Medicine stock not found"

- **Solution:** Ensure medicine exists in stock for the specified pharmacy

**Issue:** "Insufficient stock"

- **Solution:** Check available strips before creating/updating invoice

**Issue:** "Price not set for this medicine stock"

- **Solution:** Add pricing information to stock before creating invoice

**Issue:** "Clinic ID not found"

- **Solution:** Ensure user is authenticated and assigned to a clinic via `requireClinic` middleware
