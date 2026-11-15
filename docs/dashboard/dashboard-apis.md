# Dashboard APIs - Frontend Integration Guide

## Authentication

All APIs require:
- `Authorization: Bearer <token>` header
- User must have role `Admin` or `Doctor`
- Clinic must be assigned to the user

---

## 1. Revenue Overview API

### Endpoint

```
GET /api/v1/dashboard/revenue-overview
```

### Query Parameters

| Param      | Type                  | Required | Default  | Description                                 |
| ---------- | --------------------- | -------- | -------- | ------------------------------------------- |
| `period`   | `"week"` \| `"month"` | No       | `"week"` | Select this week (Mon-Sun) or this month    |
| `doctorId` | `UUID`                | No       | —        | Admin can pass to filter by specific doctor |

### Access Control

- **Admin**: Sees clinic-wide revenue. Can pass `?doctorId=<uuid>` to filter for a specific doctor.
- **Doctor**: Sees only their own revenue. Cannot pass another doctor's ID (returns 403).

### Example Request

```
GET /api/v1/dashboard/revenue-overview?period=week
GET /api/v1/dashboard/revenue-overview?period=month&doctorId=abc-123-uuid
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Revenue overview fetched successfully",
  "data": {
    "period": "week",
    "totalRevenue": 2500,
    "totalRefunded": 200,
    "netRevenue": 2300,
    "revenueOverview": [
      {
        "date": "2026-05-26",
        "amount": 0,
        "refundedAmount": 0,
        "paymentModes": {}
      },
      {
        "date": "2026-05-27",
        "amount": 700,
        "refundedAmount": 0,
        "paymentModes": { "upi": 500, "cash": 200 }
      },
      {
        "date": "2026-05-28",
        "amount": 300,
        "refundedAmount": 100,
        "paymentModes": { "card": 300 }
      },
      {
        "date": "2026-05-29",
        "amount": 1000,
        "refundedAmount": 100,
        "paymentModes": { "upi": 600, "cash": 200, "card": 200 }
      },
      {
        "date": "2026-05-30",
        "amount": 500,
        "refundedAmount": 0,
        "paymentModes": { "cash": 500 }
      },
      {
        "date": "2026-05-31",
        "amount": 0,
        "refundedAmount": 0,
        "paymentModes": {}
      },
      {
        "date": "2026-06-01",
        "amount": 0,
        "refundedAmount": 0,
        "paymentModes": {}
      }
    ],
    "meta": {
      "clinicId": "clinic-uuid",
      "doctorId": null,
      "rangeStart": "2026-05-26",
      "rangeEnd": "2026-06-01",
      "generatedAt": "2026-05-28T10:30:00.000Z"
    }
  }
}
```

### Response Fields

| Field                              | Type             | Description                                                                                           |
| ---------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `period`                           | `string`         | `"week"` or `"month"`                                                                                 |
| `totalRevenue`                     | `number`         | Money received in the period, same rule as Payments History: `Paid` → price, `Refunded` → price − refunded, `Already Paid` → added services only (`src/main/dashboard/utils/revenueSql.ts`) |
| `totalRefunded`                    | `number`         | Sum of all refunds in the period                                                                      |
| `netRevenue`                       | `number`         | `totalRevenue - totalRefunded`                                                                        |
| `revenueOverview`                  | `array`          | Daily breakdown (always full 7 days for week, full month days for month)                              |
| `revenueOverview[].date`           | `string`         | Date in `YYYY-MM-DD` format                                                                           |
| `revenueOverview[].amount`         | `number`         | Total revenue for that day (0 if no completed appointments)                                           |
| `revenueOverview[].refundedAmount` | `number`         | Total refunded amount for that day                                                                    |
| `revenueOverview[].paymentModes`   | `object`         | Breakdown by payment mode. Keys: `"cash"`, `"upi"`, `"card"`, `"insurance"`. Empty `{}` if no revenue |
| `pendingPayments`                  | `number`         | Unpaid amount in the period: payment status `pending` or `credit`, excluding Cancelled/NoShow/Missed appointments |
| `pendingPaymentCount`              | `number`         | Number of appointments counted in `pendingPayments`                                                    |
| `meta.doctorId`                    | `string \| null` | `null` if clinic-wide, UUID if filtered by doctor                                                     |

### Caching

- Cached for **2 minutes**, keyed by a per-clinic dashboard cache version
- Any appointment or payment change bumps that version, so the next request is always fresh

### Error Responses

| Status | Condition                                      |
| ------ | ---------------------------------------------- |
| 401    | Missing or invalid token                       |
| 403    | Doctor trying to view another doctor's revenue |
| 400    | Invalid `doctorId` format (not a valid UUID)   |

---

## 2. Today Overview API

### Endpoint

```
GET /api/v1/dashboard/today-overview
```

### Query Parameters

| Param      | Type   | Required | Default           | Description                                               |
| ---------- | ------ | -------- | ----------------- | --------------------------------------------------------- |
| `doctorId` | `UUID` | No       | Current user's ID | Admin with doctor access can pass to view specific doctor |
| `scope`    | `"clinic"` | No   | —                 | Admin only: whole clinic instead of the admin's own data. Ignored when `doctorId` is passed |

### Access Control

- **Doctor**: Sees only their own data. Cannot pass another doctor's ID (returns 403). `scope` is ignored.
- **Admin**: Without parameters, sees their own data (unchanged default). `?doctorId=<uuid>` for a specific doctor, `?scope=clinic` for the whole clinic (used by the web admin dashboard).

### Example Request

```
GET /api/v1/dashboard/today-overview
GET /api/v1/dashboard/today-overview?doctorId=abc-123-uuid
GET /api/v1/dashboard/today-overview?scope=clinic
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Today overview fetched successfully",
  "data": {
    "date": "2026-05-27",
    "appointments": {
      "total": 12,
      "remaining": 5,
      "completed": 6,
      "pending": 3,
      "confirmed": 2,
      "cancelled": 1,
      "noShow": 0
    },
    "todaysAppointments": [
      {
        "id": "appointment-uuid-1",
        "appointmentDate": "2026-05-27T00:00:00.000Z",
        "appointmentTime": "09:30",
        "appointmentType": "Consultation",
        "appointmentStatus": "Completed",
        "tokenNo": 1,
        "patientName": "Ravi Kumar",
        "patientAge": 34,
        "patientGender": "Male",
        "patientProfileImage": "https://s3.../profile.jpg",
        "paymentStatus": "Paid",
        "reason": "Fever, Headache"
      },
      {
        "id": "appointment-uuid-2",
        "appointmentDate": "2026-05-27T00:00:00.000Z",
        "appointmentTime": "10:30",
        "appointmentType": "Consultation",
        "appointmentStatus": "Pending",
        "tokenNo": 2,
        "patientName": "Anita Sharma",
        "patientAge": 28,
        "patientGender": "Female",
        "patientProfileImage": null,
        "paymentStatus": null,
        "reason": "Cough, Cold"
      },
      {
        "id": "appointment-uuid-3",
        "appointmentDate": "2026-05-27T00:00:00.000Z",
        "appointmentTime": "12:00",
        "appointmentType": "Follow-up",
        "appointmentStatus": "Upcoming",
        "tokenNo": 3,
        "patientName": "Mohit Singh",
        "patientAge": 41,
        "patientGender": "Male",
        "patientProfileImage": null,
        "paymentStatus": null,
        "reason": "Body_Pain"
      },
      {
        "id": "appointment-uuid-4",
        "appointmentDate": "2026-05-27T00:00:00.000Z",
        "appointmentTime": "04:30",
        "appointmentType": "Consultation",
        "appointmentStatus": "Upcoming",
        "tokenNo": 4,
        "patientName": "Priya Verma",
        "patientAge": 35,
        "patientGender": "Female",
        "patientProfileImage": "https://s3.../priya.jpg",
        "paymentStatus": null,
        "reason": null
      }
    ],
    "symptomCounts": {
      "period": "this_week",
      "data": {
        "Fever": 8,
        "Cold": 5,
        "Headache": 3,
        "Body_Pain": 2
      }
    },
    "patientOverview": {
      "period": "past_30_days",
      "newPatients": {
        "count": 5,
        "trend": "↑ 100%"
      },
      "returningPatients": {
        "count": 4,
        "trend": "↑ 33%"
      }
    },
    "meta": {
      "clinicId": "clinic-uuid",
      "doctorId": "doctor-uuid",
      "generatedAt": "2026-05-27T10:30:00.000Z"
    }
  }
}
```

### Response Fields

#### `appointments` — Summary counts

| Field       | Type     | Description                                                 |
| ----------- | -------- | ----------------------------------------------------------- |
| `total`     | `number` | Total appointments for today                                |
| `remaining` | `number` | `total - completed - cancelled - noShow` (still to be seen) |
| `completed` | `number` | Appointments marked as Completed today                      |
| `pending`   | `number` | Appointments in Pending status                              |
| `confirmed` | `number` | Appointments in Confirmed status                            |
| `cancelled` | `number` | Appointments cancelled today                                |
| `noShow`    | `number` | Appointments marked as NoShow today                         |

#### `todaysAppointments` — Full list of today's appointments

All appointments for today (all statuses), sorted by time. Use this to render the "Today's Appointments" table.

| Field                 | Type             | Description                                                                               |
| --------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `id`                  | `string`         | Appointment UUID                                                                          |
| `appointmentDate`     | `string`         | ISO date string                                                                           |
| `appointmentTime`     | `string`         | Time in `HH:mm` format (e.g. "09:30")                                                     |
| `appointmentType`     | `string`         | e.g. "Consultation", "Follow-up"                                                          |
| `appointmentStatus`   | `string`         | "Upcoming", "Completed", "Cancelled", "Pending", "Confirmed", "Patient Arrived", "NoShow" |
| `tokenNo`             | `number \| null` | Token number for the day (null if time-based scheduling)                                  |
| `patientName`         | `string`         | Patient's full name                                                                       |
| `patientAge`          | `number \| null` | Patient's age                                                                             |
| `patientGender`       | `string \| null` | "Male", "Female", etc.                                                                    |
| `patientProfileImage` | `string \| null` | Profile image URL or null                                                                 |
| `paymentStatus`       | `string \| null` | "Paid", "Refunded", "pending", or null if not yet paid                                    |
| `reason`              | `string \| null` | Comma-separated symptoms (e.g. "Fever, Headache") or null if not recorded                 |

#### `symptomCounts` — This week's symptom breakdown

| Field    | Type     | Description                                                             |
| -------- | -------- | ----------------------------------------------------------------------- |
| `period` | `string` | Always `"this_week"` (Mon-Sun of current week)                          |
| `data`   | `object` | Key-value pairs: symptom name → count. e.g. `{ "Fever": 5, "Cold": 3 }` |

#### `patientOverview` — New vs Returning (past 30 days comparison)

| Field                     | Type     | Description                                                          |
| ------------------------- | -------- | -------------------------------------------------------------------- |
| `period`                  | `string` | Always `"past_30_days"`                                              |
| `newPatients.count`       | `number` | Patients with their first-ever appointment in the last 30 days       |
| `newPatients.trend`       | `string` | Change vs previous 30 days. Format: `"↑ 100%"`, `"↓ 25%"`, or `"0%"` |
| `returningPatients.count` | `number` | Patients who had prior appointments before the last 30 days          |
| `returningPatients.trend` | `string` | Change vs previous 30 days                                           |

### Caching

| Section                                           | Cache Duration | Invalidation                            |
| ------------------------------------------------- | -------------- | --------------------------------------- |
| Main response (appointments + todaysAppointments) | **2 minutes**  | Any appointment or payment change (per-clinic cache version) |
| `symptomCounts`                                   | **1 week**     | Expires naturally                       |
| `patientOverview`                                 | **6 hours**    | Expires naturally                       |

### Error Responses

| Status | Condition                                       |
| ------ | ----------------------------------------------- |
| 401    | Missing or invalid token                        |
| 403    | Doctor trying to view another doctor's overview |
| 400    | Invalid `doctorId` format (not a valid UUID)    |

---

## Frontend Usage Notes

### TypeScript Interfaces

```typescript
// Revenue Overview
interface RevenueOverviewResponse {
  period: 'week' | 'month';
  totalRevenue: number;
  totalRefunded: number;
  netRevenue: number;
  revenueOverview: {
    date: string;
    amount: number;
    refundedAmount: number;
    paymentModes: Record<string, number>;
  }[];
  meta: {
    clinicId: string;
    doctorId: string | null;
    rangeStart: string;
    rangeEnd: string;
    generatedAt: string;
  };
}

// Today Overview
interface TodayOverviewResponse {
  date: string;
  appointments: {
    total: number;
    remaining: number;
    completed: number;
    pending: number;
    confirmed: number;
    cancelled: number;
    noShow: number;
  };
  todaysAppointments: {
    id: string;
    appointmentDate: string;
    appointmentTime: string;
    appointmentType: string;
    appointmentStatus: string;
    tokenNo: number | null;
    patientName: string;
    patientAge: number | null;
    patientGender: string | null;
    patientProfileImage: string | null;
    paymentStatus: string | null;
    reason: string | null;
  }[];
  symptomCounts: {
    period: 'this_week';
    data: Record<string, number>;
  };
  patientOverview: {
    period: 'past_30_days';
    newPatients: { count: number; trend: string };
    returningPatients: { count: number; trend: string };
  };
  meta: {
    clinicId: string;
    doctorId: string;
    generatedAt: string;
  };
}
```

### Example API Calls (Axios)

```typescript
// Revenue Overview - this week (default)
const { data } = await api.get('/api/v1/dashboard/revenue-overview');

// Revenue Overview - this month
const { data } = await api.get('/api/v1/dashboard/revenue-overview?period=month');

// Revenue Overview - specific doctor (admin only)
const { data } = await api.get('/api/v1/dashboard/revenue-overview?period=week&doctorId=uuid');

// Today Overview
const { data } = await api.get('/api/v1/dashboard/today-overview');

// Today Overview - specific doctor (admin only)
const { data } = await api.get('/api/v1/dashboard/today-overview?doctorId=uuid');
```

### Display Tips

- **Revenue chart**: Use `revenueOverview` array for bar/line chart. X-axis = `date`, Y-axis = `amount`.
- **Payment mode pills**: Iterate `paymentModes` object keys to show colored badges (UPI=blue, Cash=green, Card=purple, Insurance=orange).
- **Trend arrows**: Parse `trend` string — if starts with `↑` show green, `↓` show red, `0%` show grey.
- **Today's Appointments table**: Render `todaysAppointments` as a table with columns: Time, Patient (name + age + gender + avatar), Type, Reason, Status, Payment, Action.
- **Token display**: If `tokenNo` is not null, show token badge. Otherwise show time.
- **Status badges**: Color-code `appointmentStatus` — Completed=green, Pending=yellow, Upcoming=blue, Cancelled=red, NoShow=grey.
- **Payment badges**: "Paid"=green, "pending"/null=orange, "Refunded"=red.
- **Symptom counts**: Show as horizontal bar chart or tag cloud sorted by count descending.
- **Patient overview cards**: Show two stat cards — "New Patients" and "Returning Patients" with count + trend arrow.
