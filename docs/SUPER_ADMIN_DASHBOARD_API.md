# Super Admin Dashboard API

## Endpoint

```
GET /api/v1/dashboard/super-admin?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

**Authorization:** Bearer token (Super Admin role only)

## Query Parameters

| Parameter   | Type   | Required | Description                      |
| ----------- | ------ | -------- | -------------------------------- |
| `startDate` | string | Yes      | Start of date range (YYYY-MM-DD) |
| `endDate`   | string | Yes      | End of date range (YYYY-MM-DD)   |

## Headers

```
Authorization: Bearer <token>
```

## Example Request

```
GET /api/v1/dashboard/super-admin?startDate=2026-06-14&endDate=2026-06-17
```

---

## Response

```json
{
  "success": true,
  "result": {
    "clinics": {
      "total": 79,
      "active": 65,
      "inactive": 14,
      "monthlyActive": 42,
      "hikePersent": "+400.0%"
    },
    "conversionRate": {
      "rate": 34.8,
      "hikePersent": "+5.4%"
    },
    "users": {
      "total": 4285,
      "monthlyActive": 1248,
      "byRole": {
        "Admin": 23,
        "Doctor": 27,
        "Patient": 4200,
        "Receptionist": 28
      },
      "hikePersent": "+12.3%"
    },
    "subscriptions": {
      "active": 79,
      "total": 79,
      "yearly": 35,
      "trial": 0,
      "expired": 0,
      "cancelled": 0,
      "byPlan": [
        { "planName": "Clinic", "count": 76 },
        { "planName": "CareHub", "count": 3 }
      ],
      "hikePersent": "+8.7%"
    },
    "revenue": {
      "total": 125680,
      "yearly": 124560,
      "currentPeriod": 4256,
      "hikePersent": "+4.4%",
      "dailySeries": {
        "labels": ["Jun 14", "Jun 15", "Jun 16", "Jun 17"],
        "data": [1200, 800, 1500, 756]
      },
      "byPlan": {
        "thisWeek": [
          { "planName": "Clinic Plan", "amount": 2987, "percentage": 75.6 },
          { "planName": "CareHub Plan", "amount": 969, "percentage": 24.4 }
        ],
        "thisMonth": [
          { "planName": "Clinic Plan", "amount": 8500, "percentage": 72.0 },
          { "planName": "CareHub Plan", "amount": 3300, "percentage": 28.0 }
        ]
      },
      "analytics": {
        "thisMonth": { "amount": 14560, "growthPercent": 23.5 },
        "lastMonth": { "amount": 11789, "growthPercent": 15.2 },
        "allTime": { "amount": 125680, "growthPercent": 23.5 }
      }
    },
    "topClinics": [
      { "name": "City Health Clinic", "revenue": 1250, "growthPercent": 24.5 },
      { "name": "Sunrise Medical Center", "revenue": 1120, "growthPercent": 18.2 },
      { "name": "Green Valley Clinic", "revenue": 985, "growthPercent": 15.7 },
      { "name": "Health Plus Clinic", "revenue": 901, "growthPercent": 12.9 }
    ],
    "registrationTrends": {
      "clinics": {
        "labels": ["Jun 14", "Jun 15", "Jun 16", "Jun 17"],
        "data": [2, 5, 8, 3]
      }
    },
    "lastUpdatedAt": "2026-06-17T10:30:00.000Z"
  }
}
```

---

## Field Reference

### `clinics`

| Field           | Type   | Description                                         |
| --------------- | ------ | --------------------------------------------------- |
| `total`         | number | Total registered clinics (all time)                 |
| `active`        | number | Currently active clinics                            |
| `inactive`      | number | Currently inactive/blocked clinics                  |
| `monthlyActive` | number | Clinics with activity in the current calendar month |
| `hikePersent`   | string | % change vs previous equivalent period              |

### `conversionRate`

| Field         | Type   | Description                                           |
| ------------- | ------ | ----------------------------------------------------- |
| `rate`        | number | Trial → Paid conversion rate (e.g., 34.8 means 34.8%) |
| `hikePersent` | string | % change vs previous equivalent period                |

### `users`

| Field           | Type   | Description                                                    |
| --------------- | ------ | -------------------------------------------------------------- |
| `total`         | number | Total registered users (all time)                              |
| `monthlyActive` | number | Users active in current calendar month                         |
| `byRole`        | object | `{ "Admin": N, "Doctor": N, "Patient": N, "Receptionist": N }` |
| `hikePersent`   | string | % change vs previous equivalent period                         |

### `subscriptions`

| Field         | Type   | Description                                                |
| ------------- | ------ | ---------------------------------------------------------- |
| `active`      | number | Currently active subscriptions                             |
| `total`       | number | Total subscriptions (active + expired + cancelled + trial) |
| `yearly`      | number | Active yearly subscriptions                                |
| `trial`       | number | Subscriptions in trial period                              |
| `expired`     | number | Expired subscriptions                                      |
| `cancelled`   | number | Cancelled subscriptions                                    |
| `byPlan`      | array  | `[{ "planName": string, "count": number }]`                |
| `hikePersent` | string | % change vs previous equivalent period                     |

### `revenue`

| Field                 | Type   | Description                                               |
| --------------------- | ------ | --------------------------------------------------------- |
| `total`               | number | Total revenue in INR (all time)                           |
| `yearly`              | number | Revenue from yearly subscriptions                         |
| `currentPeriod`       | number | Revenue in the requested date range                       |
| `hikePersent`         | string | % change vs previous equivalent period                    |
| `dailySeries`         | object | `{ labels: string[], data: number[] }` — daily chart data |
| `byPlan`              | object | Revenue breakdown by plan (two sub-keys)                  |
| `byPlan.thisWeek`     | array  | `[{ planName, amount, percentage }]`                      |
| `byPlan.thisMonth`    | array  | `[{ planName, amount, percentage }]`                      |
| `analytics`           | object | Pre-computed revenue analytics                            |
| `analytics.thisMonth` | object | `{ amount: number, growthPercent: number }`               |
| `analytics.lastMonth` | object | `{ amount: number, growthPercent: number }`               |
| `analytics.allTime`   | object | `{ amount: number, growthPercent: number }`               |

### `topClinics`

Array of top 4 performing clinics:

| Field           | Type   | Description                         |
| --------------- | ------ | ----------------------------------- |
| `name`          | string | Clinic name                         |
| `revenue`       | number | Revenue amount (INR) for the period |
| `growthPercent` | number | Growth % vs previous period         |

### `registrationTrends`

| Field     | Type   | Description                                                      |
| --------- | ------ | ---------------------------------------------------------------- |
| `clinics` | object | `{ labels: string[], data: number[] }` — registration chart data |

### `lastUpdatedAt`

| Field           | Type   | Description                                               |
| --------------- | ------ | --------------------------------------------------------- |
| `lastUpdatedAt` | string | ISO timestamp of when data was last queried from database |

---

## `hikePersent` Format

| Format     | Meaning         |
| ---------- | --------------- |
| `"+12.3%"` | Positive growth |
| `"-5.2%"`  | Negative growth |
| `"0%"`     | No change       |

Comparison logic:

| Selected Range      | Compared Against            |
| ------------------- | --------------------------- |
| Today               | Yesterday                   |
| Yesterday           | Day before yesterday        |
| This Week (Mon-Sun) | Previous week (Mon-Sun)     |
| This Month          | Same days in previous month |
| Custom (N days)     | Previous N days             |

---

## `dailySeries` / `registrationTrends` Label Granularity

| Range      | Granularity | Label Format     |
| ---------- | ----------- | ---------------- |
| ≤ 14 days  | Daily       | `"Jun 14"`       |
| 15–90 days | Daily       | `"Jun 14"`       |
| > 90 days  | Monthly     | `"Jan"`, `"Feb"` |

---

## Caching Behavior

- **Cache TTL:** 1 hour (3600 seconds)
- **Cache Key:** `super_admin_dashboard:{startDate}:{endDate}`
- **`lastUpdatedAt`:** Indicates when data was fetched from the database. If cached, this will show the original fetch time, NOT the current request time.
- The frontend should display `lastUpdatedAt` to show users how fresh the data is.

---

## Frontend Integration Notes

1. **Single API call per tab change** — cache with RTK Query, no polling needed.
2. **`byPlan` (This Week / This Month toggle)** — both are returned in the same response. Switch locally, do NOT make a new API call.
3. **`analytics` (This Month / Last Month / All Time)** — all pre-loaded in the response. Toggle locally without additional API calls.
4. **`topClinics`** — max 4 items, already sorted by revenue descending.
5. **`dailySeries` and `registrationTrends`** — `labels` and `data` arrays are same length and aligned by index. Use directly for chart rendering.

---

## Error Responses

### 401 Unauthorized
```json
{ "success": false, "message": "Authorization token missing" }
```

### 403 Forbidden
```json
{ "success": false, "message": "Insufficient role" }
```

### 400 Validation Error (missing startDate/endDate)
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "path": "startDate", "message": "startDate is required" },
    { "path": "endDate", "message": "endDate is required" }
  ]
}
```

---

## TypeScript Types (for frontend)

```typescript
interface SuperAdminDashboardResponse {
  success: true;
  result: {
    clinics: {
      total: number;
      active: number;
      inactive: number;
      monthlyActive: number;
      hikePersent: string;
    };
    conversionRate: {
      rate: number;
      hikePersent: string;
    };
    users: {
      total: number;
      monthlyActive: number;
      byRole: Record<string, number>;
      hikePersent: string;
    };
    subscriptions: {
      active: number;
      total: number;
      yearly: number;
      trial: number;
      expired: number;
      cancelled: number;
      byPlan: Array<{ planName: string; count: number }>;
      hikePersent: string;
    };
    revenue: {
      total: number;
      yearly: number;
      currentPeriod: number;
      hikePersent: string;
      dailySeries: {
        labels: string[];
        data: number[];
      };
      byPlan: {
        thisWeek: Array<{ planName: string; amount: number; percentage: number }>;
        thisMonth: Array<{ planName: string; amount: number; percentage: number }>;
      };
      analytics: {
        thisMonth: { amount: number; growthPercent: number };
        lastMonth: { amount: number; growthPercent: number };
        allTime: { amount: number; growthPercent: number };
      };
    };
    topClinics: Array<{
      name: string;
      revenue: number;
      growthPercent: number;
    }>;
    registrationTrends: {
      clinics: {
        labels: string[];
        data: number[];
      };
    };
    lastUpdatedAt: string;
  };
}
```
