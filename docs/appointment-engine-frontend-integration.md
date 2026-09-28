# Appointment Engine — Frontend Integration Guide

This document covers everything frontend developers need to integrate the Appointment Engine into the **Admin/Clinic Dashboard** and **Patient App**.

---

## Table of Contents

- [Admin / Clinic Dashboard](#admin--clinic-dashboard)
  - [Configure Running-Late Threshold](#1-configure-running-late-threshold)
  - [Real-Time Queue Display](#2-real-time-queue-display)
  - [Time-to-Next Patient Display](#3-time-to-next-patient-display)
  - [Doctor Arrival Tracking](#4-doctor-arrival-tracking)
  - [Custom Slot Configuration](#5-custom-slot-configuration)
  - [Booking a slot that has passed](#booking-a-slot-that-has-passed)
- [Patient App](#patient-app)
  - [Estimated Wait Time on Appointment Detail](#1-estimated-wait-time-on-appointment-detail)
  - [Real-Time Wait Time Updates](#2-real-time-wait-time-updates)
  - [Running-Late Notification](#3-running-late-notification)
  - [Appointment Shifted Notification](#4-appointment-shifted-notification)

---

## Admin / Clinic Dashboard

### 1. Configure Running-Late Threshold

Admins can set how many minutes of delay trigger a "running late" notification to patients.

#### API

**GET** `/api/v1/clinic/settings`

Response includes:
```json
{
  "runningLateThresholdMinutes": 10
}
```

**PUT** `/api/v1/clinic/settings`

Body:
```json
{
  "runningLateThresholdMinutes": 15
}
```

| Field                         | Type    | Range | Default | Description                                   |
| ----------------------------- | ------- | ----- | ------- | --------------------------------------------- |
| `runningLateThresholdMinutes` | integer | 5–60  | 10      | Minutes of delay before patients are notified |

#### UI Suggestion

A slider or number input in the clinic settings page labeled:
> "Notify patients when doctor is running late by more than X minutes"

---

### 2. Real-Time Queue Display

The clinic dashboard receives live queue updates via WebSocket without polling.

#### Socket Room to Join

```
clinic:{clinicId}
```

Join this room on dashboard load. The backend emits events to this room whenever the queue state changes.

#### Event: `queue.updated`

Emitted when any appointment status changes that affects the queue (completion, arrival, no-show).

**Payload:**
```typescript
{
  clinicId: string;
  doctorId: string;
  date: string;              // "YYYY-MM-DD"
  cumulativeDelay: number;   // Total delay in minutes for the queue
  appointments: Array<{
    appointmentId: string;
    status: "Upcoming" | "Confirmed" | "Patient Arrived" | "Completed" | "Cancelled" | "NoShow";
    appointmentTime: string | null;   // "HH:MM" or null for token-based
    estimatedWaitMinutes: number;     // 0 for completed/arrived appointments
    cumulativeDelay: number;          // Queue-level cumulative delay
  }>;
}
```

#### How to Use

```typescript
// Join clinic room on mount
socket.emit('join', { room: `clinic:${clinicId}` });

// Listen for queue updates
socket.on('queue.updated', (data) => {
  // Replace the queue display with fresh data
  setQueueAppointments(data.appointments);
  setCumulativeDelay(data.cumulativeDelay);
});
```

#### Display Recommendations

| Column           | Source                                                           |
| ---------------- | ---------------------------------------------------------------- |
| Patient Name     | Your existing data (join by appointmentId)                       |
| Appointment Time | `appointmentTime`                                                |
| Status           | `status`                                                         |
| Estimated Wait   | `estimatedWaitMinutes` (show as "~15 min" or similar)            |
| Queue Delay      | `cumulativeDelay` (show at the top: "Queue running 12 min late") |

---

### 3. Time-to-Next Patient Display

Shows doctors/receptionists how many minutes until the next patient.

#### Socket Room

Same `clinic:{clinicId}` room.

#### Event: `timeToNext.updated`

**Payload:**
```typescript
{
  clinicId: string;
  timeToNextMinutes: number | null;   // null = no more appointments today
  ts: string;                          // ISO timestamp of computation
}
```

#### How to Use

```typescript
socket.on('timeToNext.updated', (data) => {
  if (data.timeToNextMinutes === null) {
    // No more appointments — hide the widget or show "Done for today"
    setTimeToNext(null);
  } else {
    setTimeToNext(data.timeToNextMinutes);
  }
});
```

#### Display Suggestion

A card or badge near the queue showing:
> "Next patient in ~**8 min**"

Or when null:
> "No more appointments today"

**Note:** This event is throttled — it only fires when the value changes by ≥ 1 minute, so you won't get excessive updates.

---

### 4. Doctor Arrival Tracking

Lets a doctor mark their own arrival, or reception mark it on a doctor's behalf — scoped per shift, so a doctor with two sessions in one day (e.g. 9–1 and 5–9) arrives for each independently. If nobody marks arrival, confirming the first patient of a shift auto-fills it.

#### API — Mark Arrival

**POST** `/api/v1/appointments/doctor-arrival`

Body:
```json
{
  "doctorId": "b3f1c2a0-1234-4a56-8abc-1234567890ab",
  "arrivedAt": "2026-08-26T03:35:00.000Z",
  "sessionStart": "09:00"
}
```

| Field          | Required                        | Notes                                                                 |
| -------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `doctorId`     | Only if actor isn't the doctor   | A Doctor can only mark their own arrival                              |
| `arrivedAt`    | No                               | ISO datetime; defaults to now. Must be today, not in the future        |
| `sessionStart` | No                               | `HH:mm`; omitted resolves to whichever shift the clock currently implies |

Response:
```json
{
  "success": true,
  "message": "Doctor arrival recorded",
  "data": {
    "doctorId": "b3f1c2a0-1234-4a56-8abc-1234567890ab",
    "arrivedAt": "2026-08-26T03:35:00.000Z",
    "sessionStart": "09:00",
    "source": "self",
    "createdBy": "b3f1c2a0-1234-4a56-8abc-1234567890ab"
  }
}
```

`source` is `"self"`, `"reception"`, or `"auto_confirm"` (backfilled when a patient was confirmed with no prior arrival tap).

#### API — Read Arrival Status

**GET** `/api/v1/appointments/doctor-arrival?doctorIds=id1,id2`

Omit `doctorIds` to get every doctor in the clinic who has arrived today (their currently-relevant shift only). Response:
```json
{
  "success": true,
  "message": "Doctor arrival status fetched successfully",
  "data": {
    "date": "2026-08-26",
    "arrivals": [
      {
        "doctorId": "b3f1c2a0-1234-4a56-8abc-1234567890ab",
        "arrivedAt": "2026-08-26T03:35:00.000Z",
        "sessionStart": "09:00",
        "source": "self",
        "createdBy": "b3f1c2a0-1234-4a56-8abc-1234567890ab"
      }
    ]
  }
}
```

A doctor absent from `arrivals` has not arrived for their currently-relevant shift.

#### UI Suggestion

- Doctor dashboard: a "Mark Arrival" button, replaced with "Arrived at 9:05 AM" once recorded for the current shift.
- Reception board: a per-doctor badge — "Arrived" / "Not arrived" — with a "Mark Arrived" action for doctors who don't self-report. For a two-shift doctor, badge reflects the shift currently in progress, not the whole day.

---

### 5. Custom Slot Configuration

Lets a doctor or reception customize one shift's slot count/duration (time-based) or token count (token-based), instead of using the clinic's default. Scoped per shift and per date — a two-shift day can have different setups for morning vs. evening, and this only affects the target date's bookings going forward.

#### API — Read Current Setup

**GET** `/api/v1/appointments/slot-config?doctorId=...&date=2026-08-27&sessionStart=17:00`

`sessionStart` is optional — omitted returns all of that date's sessions plus a `selected` one (the day's only session, or whichever the clock currently implies).

Response:
```json
{
  "success": true,
  "message": "Slot config fetched successfully",
  "data": {
    "date": "2026-08-27",
    "isTokenBased": false,
    "sessions": [
      {
        "sessionStart": "09:00",
        "sessionEnd": "13:00",
        "windowMinutes": 240,
        "isTokenBased": false,
        "slotMinutes": 20,
        "stepMinutes": 0,
        "numberOfSlots": 12,
        "customized": false
      },
      {
        "sessionStart": "17:00",
        "sessionEnd": "21:00",
        "windowMinutes": 240,
        "isTokenBased": false,
        "slotMinutes": 15,
        "stepMinutes": 5,
        "numberOfSlots": 12,
        "customized": true
      }
    ],
    "selected": { "sessionStart": "17:00", "...": "..." }
  }
}
```

`isTokenBased` at the top level is only `true` for a token-based day with no listable time sessions at all (`sessions` will be empty in that case — read the doctor's token count from the existing availability API instead).

#### API — Customize a Session

**POST** `/api/v1/appointments/slot-config`

Time-based example — set an exact slot count and let duration be derived:
```json
{
  "doctorId": "b3f1c2a0-1234-4a56-8abc-1234567890ab",
  "forDate": "2026-08-27",
  "sessionStart": "17:00",
  "numberOfSlots": 15
}
```

Token-based example:
```json
{
  "doctorId": "b3f1c2a0-1234-4a56-8abc-1234567890ab",
  "forDate": "2026-08-27",
  "sessionStart": "17:00",
  "noOfPatients": 20
}
```

| Field           | Notes                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| `doctorId`      | Only if actor isn't the doctor                                                             |
| `forDate`       | `YYYY-MM-DD`; today or up to 60 days ahead                                                 |
| `sessionStart`  | `HH:mm`; required if the date has more than one session, optional if it only has one       |
| `slotMinutes`   | Time-based only                                                                             |
| `stepMinutes`   | Time-based only; buffer between slots                                                      |
| `numberOfSlots` | Time-based (slot count) — cannot combine with `noOfPatients`                                |
| `noOfPatients`  | Token-based (token count) — cannot combine with `slotMinutes`/`stepMinutes`/`numberOfSlots` |

A config that doesn't fit the session's real time window is rejected with a specific error (e.g. "15 slots of 20 min... need 300 min, but this session is only 240 min long") — show this directly to the user rather than a generic failure message.

Response mirrors one entry from the GET `sessions` array.

#### UI Suggestion

- On the doctor's session/schedule screen: show current setup ("15 slots, 20 min each") per shift, with a "Customize Slots" button opening a form for count and/or duration.
- Validate client-side where possible, but always surface the server's fit-check message on save failure — it names the exact shortfall.

#### API — Booking Screens: Get Available Slots (Custom-Slot-Aware)

**GET** `/api/v1/appointments/available-slots?doctorId=...&date=2026-08-27`

Use this instead of the legacy `.../doctor/available/slot-date-clinic/:doctorId` endpoint wherever the booking screen needs to respect a customized session — it returns the exact same `Slot[]` shape (`start`, `end`, `status`, `tokens`, etc.), but any session with a live `slot_config` override is regenerated using that override instead of the clinic's default grid. A session with no override behaves identically to the legacy endpoint. The legacy endpoint itself is unchanged and still works for screens that haven't migrated.

```json
{
  "success": true,
  "message": "Available slots fetched successfully",
  "data": {
    "slots": [
      { "start": "2026-08-27T17:00:00", "end": "2026-08-27T17:15:00", "status": "available", "source": "availability", "clinicAvailabilityId": "..." },
      { "start": "2026-08-27T17:15:00", "end": "2026-08-27T17:30:00", "status": "booked", "source": "appointment", "appointmentId": "..." }
    ],
    "shifts": ["9:00 AM - 1:00 PM", "5:00 PM - 9:00 PM"]
  }
}
```

**Known limitation:** if an existing booking's time doesn't align with a newly customized grid's cell boundaries, that booking is kept as its own entry rather than reshaping the grid around it — this is the appointment-overlap policy question, a separate feature not yet built.

#### API — Extra Slots (Walk-In Surge)

Adds extra bookable capacity **after** one session's real end time — for "we need to squeeze in a few more today" — without touching the session's own slot grid. These extra slots show up automatically in `GET /available-slots` for that date, appended after the session's normal slots.

**POST** `/api/v1/appointments/extra-slots`

```json
{
  "doctorId": "b3f1c2a0-1234-4a56-8abc-1234567890ab",
  "forDate": "2026-08-27",
  "sessionStart": "17:00",
  "numberOfSlots": 5,
  "slotMinutes": 15,
  "stepMinutes": 0
}
```

| Field           | Notes                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| `doctorId`      | Only if actor isn't the doctor                                                             |
| `forDate`       | `YYYY-MM-DD`; today or up to 60 days ahead                                                 |
| `sessionStart`  | `HH:mm`; required if the date has more than one session                                    |
| `numberOfSlots` | `0` clears; max 50 at once                                                                  |
| `slotMinutes`   | Duration of each extra slot                                                                 |
| `stepMinutes`   | Optional buffer between them                                                               |

Rejected if the requested extra slots don't fit in the free time before the next session that day (or before midnight, on the last/only session) — the error names the exact shortfall, same as `slot-config`.

**GET** `/api/v1/appointments/extra-slots?doctorId=...&date=2026-08-27` reads the current setup the same way `slot-config` does.

#### UI Suggestion

- A "Add Extra Slots" tab inside the Custom Slot modal — count + duration, no patient chosen yet. On confirm, the new slots simply appear in the normal available-slots list for anyone (including the current user) to book afterward.

### Booking a slot that has passed

**GET** `/api/v1/appointments/missed-slot-options?doctorId=...&date=2026-09-01&slotStart=09:30`

What a receptionist may do with a slot whose time has gone: shift the patient to
a newly created slot, or record the visit at its original past time.

```jsonc
{
  "date": "2026-09-01",
  "slotStart": "09:30",
  "isMissed": true,
  "canShift": true,
  "shift": {
    "targetStart": "14:00",      // start of the break after the 09:00-14:00 session
    "targetEnd": "14:30",
    "needsCreation": true,       // always true: the slot does not exist yet
    "reason": "after_session_end"
  },
  "shiftBlockedReason": null,
  "canBookAnyway": true
}
```

The placement rules live here on purpose. The client used to walk its own
rendered grid for a free slot and then do session arithmetic to place a new one,
which put booking rules in the browser and made the answer depend on what
happened to be displayed — it could propose a target the server then rejected.
**Render this response; do not re-derive it.**

The offer is always a *newly created* slot after the missed slot's own session
ends — landing in the break before the next sitting, or after the day's last one
— bounded by the next session's start. Never an already-open slot earlier in the
day: those are held for ordinary bookings, and spending one on a lapsed walk-in
quietly eats the day's remaining capacity.

Worked example, sessions 09:00–14:00 and 16:15–19:30 at 30-minute slots:

| Missed slot | Extras already added | Offer |
|---|---|---|
| 09:30 (AM session) | 0 | 14:00–14:30 |
| 09:30 | 1 | 14:30–15:00 |
| 09:30 | 4+ | `canShift: false` — the break is full, it will not spill into 16:15 |
| 17:00 (PM session) | 0 | 19:30–20:00 |

The append offset counts **extras already appended to that session**
(`ExtraSlotsService`), not the session's own slot count. `slot_config.numberOfSlots`
is the total slots *inside* the session — 10 for a five-hour session at 30
minutes — and offsetting by it pushes the target five hours past the session end
and reports "no room" on a day with hours free.

`shiftBlockedReason` carries the server's own wording for a disabled Shift
option; show it rather than a generic line. `canBookAnyway` stays true even when
shifting is blocked — recording a past visit is always allowed.

Cached in Redis for 60s per (clinic, doctor, date, slot). Registered in the docs
registry, so it appears in Swagger at `/api/api-docs`.

---

## Patient App

### 1. Estimated Wait Time on Appointment Detail

When a patient opens their appointment detail, the response now includes their estimated wait time.

#### API

**GET** `/api/v1/patient/appointments/detail/:appointmentId`

Response now includes:
```json
{
  "appointment": { ... },
  "estimatedWaitMinutes": 12
}
```

#### Rules

| Condition                               | Value                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Appointment status is "Patient Arrived" | `0`                                                  |
| Appointment is not today                | `0`                                                  |
| No delay data available                 | `0`                                                  |
| Normal case                             | Computed wait time (non-negative integer in minutes) |

#### Display Suggestion

```
Estimated wait: ~12 minutes
```

Show only when `estimatedWaitMinutes > 0` and appointment is today. Hide or show "You're next!" when value is 0 and status is not "Patient Arrived".

---

### 2. Real-Time Wait Time Updates

The patient receives live updates to their wait time via WebSocket without re-fetching.

#### Socket Room to Join

```
user:{userId}
```

The patient app should join this room on login/app launch (you likely already do this for other notifications).

#### Event: `appointment.updated`

Emitted whenever the queue is recalculated and the patient's wait time changes.

**Payload:**
```typescript
{
  appointmentId: string;
  status: "Upcoming" | "Confirmed" | "Patient Arrived";
  appointmentTime: string | null;      // May change if shifted due to no-show
  estimatedWaitMinutes: number;
}
```

#### How to Use

```typescript
socket.on('appointment.updated', (data) => {
  // Update the specific appointment in your local state
  updateAppointment(data.appointmentId, {
    status: data.status,
    appointmentTime: data.appointmentTime,
    estimatedWaitMinutes: data.estimatedWaitMinutes,
  });
});
```

#### Important Notes

- This event fires for **all active appointments** of the patient (self + family members)
- Match by `appointmentId` to update the correct record
- `appointmentTime` may change if a no-show shift moved the appointment earlier
- The event is emitted within 5 seconds of any queue change

---

### 3. Running-Late Notification

Patients receive a push notification and socket event when their doctor is running late beyond the clinic's configured threshold.

#### Push Notification

Arrives via FCM/APNs as a standard push notification.

| Field | Value                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| Title | "Doctor Running Late"                                                                                                  |
| Body  | "Your appointment originally at 10:00 is now estimated at 10:25. The doctor is running approximately 25 minutes late." |

#### Socket Event: `running_late`

Delivered via the patient's socket room `user:{userId}`.

**Payload:**
```typescript
{
  appointmentId: string;
  estimatedNewTime: string;    // "HH:MM" — projected start time
  delayMinutes: number;        // How many minutes late
  originalTime: string | null; // Originally scheduled time
}
```

#### How to Use

```typescript
socket.on('running_late', (data) => {
  showToast({
    title: 'Doctor Running Late',
    message: `Your ${data.originalTime} appointment is now expected at ${data.estimatedNewTime} (~${data.delayMinutes} min delay)`,
    appointmentId: data.appointmentId,
  });
});
```

#### Behavior Notes

- Sent **once per threshold crossing** — not repeatedly while delay persists
- If delay drops below threshold and rises again, a new notification is sent
- Only sent for appointments with status "Upcoming" or "Confirmed" (not after arrival)

---

### 4. Appointment Shifted Notification

When a no-show causes appointments to shift forward, affected patients receive:

#### Push Notification

| Field | Value                                                                          |
| ----- | ------------------------------------------------------------------------------ |
| Title | "Appointment Time Updated"                                                     |
| Body  | "Your appointment has been moved earlier. New time: 09:45 (previously 10:00)." |

#### Socket Event: `appointment_shifted`

Delivered via the patient's socket room `user:{userId}`.

**Payload:**
```typescript
{
  appointmentId: string;
  oldTime: string;     // Previous appointment time "HH:MM"
  newTime: string;     // New (earlier) appointment time "HH:MM"
}
```

#### How to Use

```typescript
socket.on('appointment_shifted', (data) => {
  // Update the appointment time in local state
  updateAppointmentTime(data.appointmentId, data.newTime);
  
  showToast({
    title: 'Appointment Moved Earlier',
    message: `Your appointment was moved from ${data.oldTime} to ${data.newTime}`,
  });
});
```

---

## Socket Room Summary

| Room Pattern        | Who Joins                                      | Events Received                                              |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `clinic:{clinicId}` | Clinic Dashboard (doctor, receptionist, admin) | `queue.updated`, `timeToNext.updated`                        |
| `user:{userId}`     | Patient App                                    | `appointment.updated`, `running_late`, `appointment_shifted` |

---

## Complete Event Reference

| Event Name            | Room                | Direction       | Trigger                                |
| --------------------- | ------------------- | --------------- | -------------------------------------- |
| `queue.updated`       | `clinic:{clinicId}` | Server → Client | Any queue-affecting status change      |
| `timeToNext.updated`  | `clinic:{clinicId}` | Server → Client | Time-to-next changes by ≥ 1 min        |
| `appointment.updated` | `user:{userId}`     | Server → Client | Queue recalculated, wait times changed |
| `running_late`        | `user:{userId}`     | Server → Client | Delay exceeds clinic threshold         |
| `appointment_shifted` | `user:{userId}`     | Server → Client | No-show causes time shift              |

---

## Migration Checklist

### Admin Dashboard

- [ ] Add "Running Late Threshold" field to clinic settings page (GET/PUT `/api/v1/clinic/settings`)
- [ ] Join Socket.IO room `clinic:{clinicId}` on dashboard mount
- [ ] Listen for `queue.updated` — refresh queue display with new data
- [ ] Listen for `timeToNext.updated` — show/update time-to-next widget
- [ ] Display `estimatedWaitMinutes` column in the appointment queue table
- [ ] Display `cumulativeDelay` as a queue-level indicator
- [ ] Add "Mark Arrival" (doctor) / "Mark Arrived" (reception) using `POST /api/v1/appointments/doctor-arrival`, badge status from `GET /api/v1/appointments/doctor-arrival`
- [ ] Add "Customize Slots" on the doctor session/schedule screen using `GET`/`POST /api/v1/appointments/slot-config`, surfacing the server's fit-validation message on rejection
- [ ] Migrate booking screens to `GET /api/v1/appointments/available-slots` (custom-slot-aware) where customization needs to be respected; legacy endpoint still works unchanged for screens that haven't migrated
- [ ] Add an "Add Extra Slots" tab to the Custom Slot modal using `GET`/`POST /api/v1/appointments/extra-slots`; surface the fit-validation error on rejection

### Patient App

- [ ] Display `estimatedWaitMinutes` from appointment detail API response
- [ ] Ensure Socket.IO room `user:{userId}` is joined on app launch
- [ ] Listen for `appointment.updated` — update wait time in real-time
- [ ] Listen for `running_late` — show in-app alert/toast
- [ ] Listen for `appointment_shifted` — update appointment time + notify user
- [ ] Handle push notifications for "Doctor Running Late" and "Appointment Time Updated"
