# Admin / Doctor / Receptionist — Frontend Integration Guide

## Overview

The clinic dashboard shows the live appointment queue, delay status, and time-to-next patient. Data is loaded via REST on page load and updated in real-time via WebSocket.

**Important: The appointment engine and live queue only work for today's appointments.** If the user switches to a different date, no engine runs, no socket events fire, and no Redis/queue queries execute. Past and future dates show static appointment lists only — no live tracking.

---

## 1. REST API — Initial Page Load

### GET `/api/v1/appointments/queue-state`

```
GET /api/v1/appointments/queue-state?clinicId={CLINIC_ID}&doctorId={DOCTOR_ID}

Headers:
  Authorization: Bearer {TOKEN}
```

Optional query param: `date=YYYY-MM-DD` (defaults to today)

**Response:**
```json
{
  "success": true,
  "data": {
    "clinicId": "27976770-...",
    "doctorId": "3785b3d8-...",
    "date": "2026-06-25",
    "cumulativeDelay": 12,
    "lastCalculatedAt": "2026-06-25T10:45:00.000Z",
    "timeToNextMinutes": 8,
    "appointments": [
      {
        "appointmentId": "uuid-1",
        "patientId": "patient-uuid",
        "status": "Completed",
        "appointmentTime": "09:00",
        "tokenNo": 1,
        "projectedStartTime": "09:00",
        "estimatedWaitMinutes": 0,
        "durationMinutes": 15
      },
      {
        "appointmentId": "uuid-2",
        "patientId": "patient-uuid",
        "status": "Confirmed",
        "appointmentTime": "09:15",
        "tokenNo": 2,
        "projectedStartTime": "09:15",
        "estimatedWaitMinutes": 0,
        "durationMinutes": 15
      },
      {
        "appointmentId": "uuid-3",
        "patientId": "patient-uuid",
        "status": "Upcoming",
        "appointmentTime": "09:30",
        "tokenNo": 3,
        "projectedStartTime": "09:32",
        "estimatedWaitMinutes": 2,
        "durationMinutes": 15
      }
    ]
  }
}
```

### Field Reference

| Field                                 | Type           | Description                                                             |
| ------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `cumulativeDelay`                     | number         | Total queue delay in minutes                                            |
| `timeToNextMinutes`                   | number or null | Minutes until next patient (null = no more today)                       |
| `lastCalculatedAt`                    | string (ISO)   | When the queue was last computed                                        |
| `appointments[].appointmentId`        | string         | Appointment UUID                                                        |
| `appointments[].patientId`            | string         | Patient UUID                                                            |
| `appointments[].status`               | string         | Upcoming / Confirmed / Patient Arrived / Completed / Cancelled / NoShow |
| `appointments[].appointmentTime`      | string or null | Scheduled time "HH:MM"                                                  |
| `appointments[].tokenNo`              | number or null | Token number                                                            |
| `appointments[].projectedStartTime`   | string         | Computed actual start time "HH:MM"                                      |
| `appointments[].estimatedWaitMinutes` | number         | How long this patient waits                                             |
| `appointments[].durationMinutes`      | number         | Slot duration in minutes                                                |

---

## 2. WebSocket Events — Real-Time Updates

The admin/doctor socket automatically joins `clinic:{clinicId}` on connection. No extra setup needed.

### Event: `queue.updated`

Fired whenever any appointment status changes in the queue.

```json
{
  "clinicId": "27976770-...",
  "doctorId": "3785b3d8-...",
  "date": "2026-06-25",
  "cumulativeDelay": 12,
  "lastCalculatedAt": "2026-06-25T10:47:00.000Z",
  "appointments": [
    {
      "appointmentId": "uuid-1",
      "status": "Completed",
      "appointmentTime": "09:00",
      "estimatedWaitMinutes": 0,
      "cumulativeDelay": 12
    },
    {
      "appointmentId": "uuid-2",
      "status": "Confirmed",
      "appointmentTime": "09:15",
      "estimatedWaitMinutes": 0,
      "cumulativeDelay": 12
    },
    {
      "appointmentId": "uuid-3",
      "status": "Upcoming",
      "appointmentTime": "09:30",
      "estimatedWaitMinutes": 2,
      "cumulativeDelay": 12
    }
  ]
}
```

### Event: `timeToNext.updated`

Fired when the time-to-next value changes by 1+ minute.

```json
{
  "clinicId": "27976770-...",
  "timeToNextMinutes": 8,
  "ts": "2026-06-25T10:47:00.000Z"
}
```

When `timeToNextMinutes` is `null` — no more appointments today.

---

## 3. Status Change API — Triggering the Engine

```
PUT /api/v1/appointments/{appointmentId}

Headers:
  Authorization: Bearer {ADMIN_TOKEN}
  Content-Type: application/json

Body:
{ "appointmentStatus": "Confirmed" }
```

### Which statuses trigger the queue engine:

| Status            | Triggers Engine | What Happens                                             |
| ----------------- | --------------- | -------------------------------------------------------- |
| `Confirmed`       | YES             | Doctor starts seeing patient, timeToNext starts counting |
| `Patient Arrived` | YES             | Reception marks arrival, queue recalculates              |
| `Completed`       | YES             | Doctor finishes, next patient's turn                     |
| `NoShow`          | YES             | Queue shifts forward, affected patients notified         |
| `Upcoming`        | NO              | Default status, no engine action                         |
| `Cancelled`       | NO              | No engine action                                         |

---

## 4. UI Mapping

### Queue Table

| Column          | Data Source                                                 |
| --------------- | ----------------------------------------------------------- |
| Token #         | `appointments[].tokenNo`                                    |
| Patient Name    | Join with `appointments[].patientId` from your patient data |
| Scheduled Time  | `appointments[].appointmentTime`                            |
| Projected Start | `appointments[].projectedStartTime`                         |
| Status          | `appointments[].status`                                     |
| Estimated Wait  | `appointments[].estimatedWaitMinutes`                       |
| Duration        | `appointments[].durationMinutes`                            |

### Header Widgets

| Widget                      | Data Source                                           |
| --------------------------- | ----------------------------------------------------- |
| "Queue running 12 min late" | `cumulativeDelay` from REST or `queue.updated`        |
| "Next patient in ~8 min"    | `timeToNextMinutes` from REST or `timeToNext.updated` |
| "No more appointments"      | When `timeToNextMinutes === null`                     |

---

## 5. Frontend Code Example

```javascript
// On page load
const loadQueue = async () => {
  const res = await fetch(
    `/api/v1/appointments/queue-state?clinicId=${clinicId}&doctorId=${doctorId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { data } = await res.json();
  setQueue(data.appointments);
  setDelay(data.cumulativeDelay);
  setTimeToNext(data.timeToNextMinutes);
};

// Socket listeners (register once)
socket.on('queue.updated', (data) => {
  setQueue(data.appointments);
  setDelay(data.cumulativeDelay);
});

socket.on('timeToNext.updated', (data) => {
  setTimeToNext(data.timeToNextMinutes);
});
```

---

## 6. Clinic Settings — Running Late Threshold

### GET `/api/v1/clinic/settings`

```json
{ "runningLateThresholdMinutes": 10 }
```

### PUT `/api/v1/clinic/settings`

```json
{ "runningLateThresholdMinutes": 15 }
```

Range: 5-60 minutes. Default: 10.

When queue delay exceeds this threshold, patients receive "Doctor Running Late" notification.

---

## 7. Events Fired After Each Action

| Doctor/Admin Action         | Dashboard Gets                         | Patients Get                                                 |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| Confirms a patient          | `queue.updated` + `timeToNext.updated` | `appointment.updated` (all in queue)                         |
| Completes a patient         | `queue.updated` + `timeToNext.updated` | `appointment.updated` + `queue.completed` (for that patient) |
| Marks NoShow                | `queue.updated`                        | `appointment_shifted` + `appointment.updated`                |
| Patient Arrived (reception) | `queue.updated` + `timeToNext.updated` | `appointment.updated`                                        |
