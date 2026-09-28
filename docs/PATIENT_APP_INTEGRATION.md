# Patient App — Frontend Integration Guide

> **Migrating?** See
> [PATIENT_APP_CHANGES.md](./PATIENT_APP_CHANGES.md) for the delta, the two
> deprecated fields, and a migration checklist.

## Overview

The patient app shows live queue tracking for today's appointments. Data is available via REST (on page load) and WebSocket (real-time push). The patient sees: current token being served, their token, patients ahead, estimated wait, and queue progress.

**Important: Live queue only works for today's active appointments.** If the appointment is on a different date or has a terminal status (Completed/Cancelled/NoShow), the API returns an error and no engine/socket/Redis queries run. The frontend should only show the live queue widget for today's active appointments.

---

## 1. REST API — Live Queue (on page load / pull to refresh)

### GET `/api/v1/patient/appointments/live-queue/{appointmentId}`

```
GET /api/v1/patient/appointments/live-queue/{appointmentId}

Headers:
  Authorization: Bearer {PATIENT_TOKEN}
```

**Validation rules** (identical for this endpoint and the socket's `join.live-queue`, one shared check):
- Must belong to the patient, or to a family member linked under them as primary — checked first
- Appointment must have a doctor
- Appointment must be today, in IST
- Appointment must be active (not Completed/Cancelled/NoShow)

A paid online booking's temporary id is accepted and resolved to the real appointment.

**Response** (current shape, updated 2026-09-25):
```json
{
  "success": true,
  "message": "Live queue status fetched successfully",
  "data": {
    "appointmentId": "58adf570-...",
    "tokenNo": 1,
    "sessionIndex": 2,
    "status": "Patient Arrived",
    "isCheckedIn": true,
    "appointmentTime": "16:15:00",
    "isMyTurn": false,
    "avgConsultationMinutes": 30,
    "consultationBasis": "default",
    "serverTime": "2026-09-24T09:28:56.156Z",
    "tentativeStartTime": "15:08",
    "tentativeRangeMinutes": 5,
    "isTentative": true,
    "isOnHold": false,
    "holdReason": null,
    "isMissedSession": false,
    "delay": { "minutes": 8, "untilSeenMinutes": 0, "isLate": false, "lateMinutes": null },
    "nowServing": { "token": null, "time": null, "label": null, "status": null },
    "queue": { "stage": "almost-there", "patientsAhead": 0, "position": 1 },
    "notifyPrefs": null
  }
}
```

**Field notes:**
- `queue.patientsAhead` — people who will be seen before this patient **in their own shift**, in the same order reception serves: the patient with the doctor, then checked-in patients (late check-ins moved back, reception's "Set as next" first), then not-arrived patients, each by token. Held/skipped and finished patients are not counted. `queue.position` is `patientsAhead + 1`, or `null` while on hold. **While this patient is on hold**, `patientsAhead` is everyone still in line in their shift (the same number as reception's "Next in queue (N)"), since a paused patient goes behind all of them.
- **On hold** — show it from `isOnHold` / `holdReason` (`held` \| `skipped`), not from `queue.stage`. A patient held before checking in keeps `stage: "not-arrived"`; a checked-in one reads `in-queue`.
- `queue.stage` — a **code for the progress bar, not display text**. Map it to your own labels:

  | `stage` | Meaning | Suggested label |
  |---|---|---|
  | `not-arrived` | **booked, not checked in yet**. Every booking starts here; also Upcoming, Pending (pay at clinic), and held before arrival. *Renamed from `waiting-area` on 2026-09-25* — that name read as "in the clinic's waiting room" | "Booked · Not arrived yet" (or "Booking") |
  | `in-queue` | checked in, more than 5 ahead — or checked in and on hold | "Arrived" |
  | `almost-there` | checked in, 5 or fewer ahead | "Almost there" |
  | `consultation` | with the doctor | "Consultation" |
  | `completed` | finished, cancelled or no-show | — |

  **App update needed:** map `not-arrived` where you mapped `waiting-area`; a build that still checks only `waiting-area` shows no step for not-arrived patients. "Checked in" is the same rule as `isCheckedIn`, so the two never disagree — read `isCheckedIn` if you only need to know whether the patient has arrived. Being on hold is not a stage: read `isOnHold` (see below).
- `isCheckedIn` — `true` once reception has checked the patient in (also while with the doctor or on hold). Same rule as the reception board.
- `tentativeStartTime` / `delay.untilSeenMinutes` — when this patient is expected to be seen, and minutes from now until then. **Show these for "Your turn in"**, not `appointmentTime`. `null` while on hold or when the shift was missed.
- `appointmentTime` — the time stored on the booking. For a token booking it is not a slot (the app stores the shift start), and it does not move when the doctor's hours change.
- `delay.isLate` / `delay.lateMinutes` — computed live on every response: late when the patient's delay is over the clinic threshold (default 10 min). Safe across reloads because it is recalculated, not stored; it clears as soon as the queue catches up. Use these for the "Doctor is running late" tile.
- `nowServing` — all `null` between patients. **Render `null` as "—", not `0`** ("Current Token 0" is a display bug).
- `notifyPrefs` (object\|null) — the patient's saved "Notify me when" toggle state (see §4), or `null` if never set. Use it to hydrate the toggles on screen load.
- `status` — raw appointment status (`Upcoming` / `Pending` / `Patient Arrived` / `Confirmed`), or `In Consultation` while with the doctor.

**Error responses** — `details.code` matches the socket's `queue.error` codes:
| Status | `details.code` | Message | When |
| ------ | -------------- | ------- | ---- |
| 404 | `NOT_FOUND` | "Appointment not found" | Invalid appointmentId |
| 403 | `ACCESS_DENIED` | "Access denied — this appointment belongs to another patient" | Not yours or a linked family member's (checked before the rules below) |
| 400 | `NO_DOCTOR` | "No doctor assigned" | Appointment has no doctor |
| 400 | `NOT_TODAY` | "Live queue only available for today's appointments" | Appointment is not today (IST) |
| 400 | `TERMINAL_STATUS` | "Appointment is no longer in queue" | Status is Completed/Cancelled/NoShow |

---

## 2. WebSocket — Real-Time Updates

### Connect

Patient connects to the main socket with their JWT token (same connection used for notifications).

```javascript
const socket = io('http://your-server:5000', {
  auth: { token: patientJwtToken },
  transports: ['websocket'],
});
```

### Join Live Queue

Send `join.live-queue` event with the appointmentId:

```javascript
socket.emit('join.live-queue', { appointmentId: 'cf9d43dd-...' }, (response) => {
  // response = { status: 'success', message: 'Joined live queue' }
  // or { status: 'error', message: '...' }
});
```

**Validation (same as REST):**
- Appointment must be today
- Appointment must be active
- Must belong to the patient

### Listen for Updates

#### Event: `queue.update`

Received immediately after joining + every time the queue changes. Same shape as the REST `data` object (minus `notifyPrefs`).

```json
{
  "appointmentId": "cf9d43dd-...",
  "tokenNo": 18,
  "status": "Upcoming",
  "appointmentTime": "15:00",
  "estimatedWaitMinutes": 18,
  "delayMinutes": 18,
  "minutesUntilSeen": 112,
  "serverTime": "2026-08-19T13:08:00.000Z",
  "nowServingToken": 12,
  "nowServingTime": "14:30",
  "nowServingLabel": "Token 12",
  "nowServingStatus": "In Consultation",
  "isMyTurn": false,
  "patientsAhead": 6,
  "queuePosition": "in-queue",
  "totalPatientsInQueue": 6,
  "avgConsultationMinutes": 2,
  "tentativeStartTime": "14:30",
  "tentativeRangeMinutes": 20,
  "isTentative": true,
  "consultationBasis": "learned",
  "isRunningLate": true,
  "runningLateMinutes": 18
}
```


#### Event: `queue.refresh` (client → server)

Asks for the current state on demand. **Zero DB queries** when the projection
cache is warm.

```js
socket.emit("queue.refresh", {}, (res) => {
  // { status: "success", inQueue: true, fromCache: true }
});
```

No payload is needed — the appointment, clinic and doctor were stored on the
socket when you emitted `join.live-queue`, so there is no lookup and no
ownership re-check.

The server replies with a normal **`queue.update`** event, identical in shape to
the one a broadcast sends, so a client handles one code path rather than two.

**Use it for:** pull-to-refresh, a screen regaining focus, waking from
background, or after a reconnect. The server only broadcasts when something
actually changed — deliberately, to avoid pushing identical payloads every
minute — which otherwise leaves a client with no way to ask "what is it now?".

**Do not poll it.** Consecutive refreshes from one socket are throttled to one
per five seconds; a throttled call acks with `status: "throttled"` and emits
nothing. For a live countdown between pushes, use `serverTime` +
`tentativeStartTime` and tick locally.

| ack `status` | meaning |
|---|---|
| `success`, `inQueue: true` | a `queue.update` was emitted |
| `success`, `inQueue: false` | no longer in today's queue; a `queue.completed` was emitted and the socket left the room |
| `throttled` | under the five-second floor; nothing emitted |
| `error`, `NOT_JOINED` | emit `join.live-queue` first |
| `error`, `INTERNAL_ERROR` | see `queue.error` |

`fromCache: false` means the cache had expired and the server recalculated — a
refresh is never worse than a join, and usually free.


#### Event: `queue.completed`

Received when your appointment is completed/cancelled/noshow. Auto-removes you from live queue.

```json
{
  "appointmentId": "cf9d43dd-...",
  "status": "Completed",
  "message": "Your appointment is no longer in the queue"
}
```

#### Event: `appointment.updated`

Received on the `user:{userId}` room (always connected). Same data as `queue.update`.

```json
{
  "appointmentId": "cf9d43dd-...",
  "tokenNo": 18,
  "status": "Upcoming",
  "appointmentTime": "15:00",
  "estimatedWaitMinutes": 14,
  "delayMinutes": 18,
  "minutesUntilSeen": 112,
  "serverTime": "2026-08-19T13:08:00.000Z",
  "nowServingToken": 13,
  "nowServingTime": "14:35",
  "nowServingLabel": "Token 13",
  "nowServingStatus": "In Consultation",
  "isMyTurn": false,
  "patientsAhead": 5,
  "queuePosition": "in-queue",
  "totalPatientsInQueue": 5,
  "avgConsultationMinutes": 2,
  "tentativeStartTime": "14:30",
  "tentativeRangeMinutes": 20,
  "isTentative": true,
  "consultationBasis": "learned",
  "isRunningLate": true,
  "runningLateMinutes": 14
}
```

#### Event: `running_late`

Received when doctor is running late beyond clinic threshold.

```json
{
  "appointmentId": "cf9d43dd-...",
  "estimatedNewTime": "15:25",
  "delayMinutes": 25,
  "originalTime": "15:00"
}
```

#### Event: `appointment_shifted`

Received when a no-show causes your appointment to move earlier.

```json
{
  "appointmentId": "cf9d43dd-...",
  "oldTime": "15:00",
  "newTime": "14:45"
}
```

### Leave Live Queue

When patient closes the live queue screen:

```javascript
socket.emit('leave.live-queue');
```

---

## 2b. Clinic ETA — "How long to reach the clinic?"

Estimated travel time from the patient's current location to the clinic, for 4 vehicle
modes, plus a shareable Google Maps directions link. Only available for clinics that have
`latitude`/`longitude` configured (set during clinic onboarding/profile setup) — if not
configured, both paths below return an error and the FE should simply not show the ETA UI.

There are **two ways** to get it — pick based on the screen:

| Use case                                                             | Use                              |
| ---------------------------------------------------------------------- | --------------------------------- |
| Live Queue screen — show ETA alongside queue status, once, on open      | Pass `latitude`/`longitude` to `join.live-queue` (§2) |
| Any screen — repeated/standalone ETA lookups (e.g. while en route, polling every ~30s) | `clinic.eta` event (below)        |

### Option A — via `join.live-queue` (one-shot, tied to an appointment)

Add `latitude`/`longitude` to the existing `join.live-queue` payload:

```javascript
socket.emit('join.live-queue', {
  appointmentId: 'cf9d43dd-...',
  latitude: 28.6139,
  longitude: 77.2090,
}, (res) => { /* ... */ });
```

If the coordinates are valid and the clinic has location configured, the `queue.update`
event (§2) you already listen for gets an extra `eta` field — no additional event needed.
If coordinates are omitted, or the clinic has no location configured, `eta` is simply
absent from the payload (existing queue behavior is unaffected either way).

### Option B — standalone `clinic.eta` event (repeatable, no appointment needed)

```javascript
socket.emit('clinic.eta', {
  clinicId: 'e9434d89-...',
  latitude: 28.6139,
  longitude: 77.2090,
}, (ack) => {
  // ack = { status: 'success', data: { ...same shape as `eta` below... } }
  // or    { status: 'error', message: '...' }
});

// Also emitted (in case you're not using the ack):
socket.on('clinic.eta.result', (result) => { /* same shape */ });
```

Re-emit this on an interval (e.g. every 30s) as the patient's GPS updates, to keep the ETA
fresh while en route. This does not join any room and has no ongoing subscription — each
emit is a one-shot request/response.

### Response shape (`eta` field on `queue.update`, or `clinic.eta.result` / ack `data`)

```json
{
  "clinicId": "e9434d89-...",
  "distanceKm": 8.42,
  "mapsShareUrl": "https://www.google.com/maps/dir/?api=1&origin=28.6139,77.209&destination=28.5672,77.21",
  "vehicles": [
    { "mode": "car",     "distanceKm": 8.42, "durationMinutes": 14,  "source": "google" },
    { "mode": "bike",    "distanceKm": 8.42, "durationMinutes": 22,  "source": "google" },
    { "mode": "walking", "distanceKm": 8.42, "durationMinutes": 101, "source": "google" },
    { "mode": "transit", "distanceKm": 8.42, "durationMinutes": 28,  "source": "google" }
  ]
}
```

**Field notes:**
- `distanceKm` (top-level) — straight-line (haversine) distance, patient → clinic.
- `vehicles[].distanceKm` / `durationMinutes` — per-mode routed distance/time. When
  `vehicles[].source` is `"google"`, this is real routing data (Google Distance Matrix).
  When `"estimate"`, it's `distanceKm ÷ assumed average speed` for that mode (no Google Maps
  API key configured server-side, or that mode's Google call failed) — **don't format these
  two sources differently in the UI**, just show the number; `source` is informational only,
  not meant to be surfaced to the patient.
- `mapsShareUrl` — ready-to-open Google Maps directions link (patient's current location →
  clinic). Use for a "Get Directions" / share button.
- Vehicle `mode` is one of `car` \| `bike` \| `walking` \| `transit`.

**Errors** (`ack.message` / `res.status === 'error'`):

| Message                                | When                                          |
| --------------------------------------- | ---------------------------------------------- |
| `authentication required`               | Socket not authenticated                       |
| `clinicId, latitude and longitude are required` | Missing/non-numeric fields (Option B)  |
| `Invalid coordinates`                   | Lat/long out of valid range                    |
| `Clinic not found`                      | `clinicId` doesn't exist                       |
| `Clinic location is not configured`     | Clinic has no `latitude`/`longitude` set       |

---

## 2c. Online Booking — Clinic/Doctor Eligibility + Payment Options

**New behavior.** Clinics and doctors now opt in/out of online booking independently, and clinics choose which payment methods they accept. This affects every screen where the patient app lists doctors/clinics to book, or submits a booking. No endpoint paths or request/response shapes changed — the *filtering* and *validation rules* did. Read this before wiring up (or re-testing) the booking flow.

### How eligibility is decided

A doctor is bookable online **only if both** are true:
1. The **clinic** has online booking enabled (`Admin`-controlled).
2. That **doctor** has online booking enabled **for that specific clinic** (self-toggle by the doctor, or set by their Admin).

Both flags are independent per clinic — a doctor working at two clinics can be bookable at one and not the other. **Current defaults on a fresh clinic: clinic-level = ON, doctor-level = ON.** Existing/older clinics may have been backfilled differently — never assume a doctor is bookable client-side; always rely on the server-filtered lists below and the booking call's error response as the source of truth.

### Where this shows up

**`GET /api/v1/patient/directory/search`** and **`GET /api/v1/patient/directory/doctors/:doctorId`** now only return doctors/clinics that pass the eligibility check above. A doctor who has turned their own toggle off, or whose clinic has online booking disabled, **simply will not appear** in search results or in their own profile lookup (404-equivalent — treat as "not found", not as an error state to retry). No new query params are needed; this filtering is automatic and server-side.

The doctor-profile response (`directory/doctors/:doctorId`) also now includes, per clinic the doctor is bookable at:

```json
{
  "id": "clinic-uuid",
  "clinicName": "Sunrise Clinic",
  "clinicPhone": "+91XXXXXXXXXX",
  "...": "...existing fields unchanged...",
  "onlineBookingEnabled": true,
  "maxAdvanceBookingDays": 7,
  "payOnlineEnabled": true,
  "payAtClinicEnabled": false
}
```

- `clinicPhone` — **display this on the booking screen** so the patient has a fallback contact number if something goes wrong with online booking.
- `maxAdvanceBookingDays` (number, new) — how many days ahead **this doctor at this specific clinic** can be booked online, set by the doctor themselves (default `7`, range `1`–`90`). **Use this to bound the date picker/calendar on the booking screen** — don't let the patient select or scroll to a date beyond `today + maxAdvanceBookingDays` for this doctor/clinic pair. It is per clinic, same as `onlineBookingEnabled` — a doctor practicing at two clinics can have different windows at each.
- `payOnlineEnabled` / `payAtClinicEnabled` — use these to decide which payment method option(s) to show on the booking/payment step for this clinic. **Only show a payment method the clinic has enabled** — don't hardcode both options as always available. At least one of the two is always true for any clinic returned by these endpoints (a clinic with both disabled won't appear at all, since it can't complete a booking either way).

### Booking call — new rejection cases

**`POST /api/v1/patient/appointments`** (existing booking endpoint, unchanged payload) can now reject with `400` in four new cases, on top of existing validation:

| Message                                                    | Meaning / what to show the patient                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `Online booking is not enabled for this clinic.`             | Clinic turned off online booking after the patient loaded the screen — treat like a stale-listing error, prompt to go back and re-search. |
| `This doctor is not accepting online bookings.`               | Doctor turned off their toggle after the screen loaded — same as above. |
| `This doctor only accepts online bookings up to {N} day(s) in advance.` | Patient selected/kept an `appointmentDate` beyond the doctor's current `maxAdvanceBookingDays` — shouldn't normally happen if the date picker is bounded using the profile field above, but the doctor can shorten their window between the patient loading the screen and submitting. Surface the message as-is and prompt the patient to pick an earlier date. |
| `Online payment is not available for this clinic.`           | Patient selected "Pay Online" but the clinic disabled it — shouldn't normally happen if you only show enabled options (see above), but handle it defensively. |
| `Pay at clinic is not available; please pay online.`         | Same, for "Pay at Clinic".                                       |

These are all **defensive/race-condition cases** — the primary defense is bounding the calendar with `maxAdvanceBookingDays` and filtering the payment method UI using `payOnlineEnabled`/`payAtClinicEnabled`, both from the doctor-profile response, and trusting that directory search/profile lookups only return currently-eligible doctors. But settings can change between the patient loading the screen and submitting the booking, so **surface these 400 messages to the patient as-is** (they're already patient-friendly) rather than a generic "something went wrong."

### Nothing else changes

- Payment flow itself (Razorpay order creation, `verify-payment`, webhook) is unchanged — the gating above only decides *whether* a booking attempt is allowed to start, not how payment is processed once it is.
- Existing appointments (already booked) are unaffected regardless of a clinic/doctor later toggling settings off.

---

## 3. "Notify me when" — Push Notifications

The Live Queue screen has a **Notify me when** section with three independent opt-in
toggles. When an enabled condition becomes true, the patient receives a **push
notification** (works even if the app is backgrounded/closed — it does not require an open
socket). Preferences are stored server-side per appointment.

| Toggle              | Fires when                                                        | Push `event`           |
| ------------------- | ----------------------------------------------------------------- | ---------------------- |
| **My turn**         | The patient reaches the front of the queue (0 patients ahead)     | `queue_my_turn`        |
| **N patients before** | `patientsAhead` drops to or below the chosen number N            | `queue_patients_ahead` |
| **Doctor arrives**  | The doctor starts consulting (becomes active)                     | `queue_doctor_active`  |

Each condition notifies **once per crossing** — the patient won't be spammed on every
queue tick, but will be re-notified if the condition clears and later re-crosses (e.g. the
queue reshuffles after a no-show).

### Step 1 — Register the device for push (one-time, at login)

Push delivery needs the device's push token registered. This is the existing device
endpoint (no new setup specific to this feature):

```
POST /api/v1/notifications/devices
Authorization: Bearer {PATIENT_TOKEN}

Body: { "deviceToken": "<FCM/APNS token>", "platform": "android" | "ios" }
```

If no device is registered, saving preferences still succeeds — the pushes simply have
nowhere to go until a device is registered.

### Step 2 — Save the toggle state

Call this whenever the patient flips a toggle (send the full object each time — it
overwrites the stored preferences):

```
POST /api/v1/patient/appointments/live-queue/{appointmentId}/notify-prefs
Authorization: Bearer {PATIENT_TOKEN}

Body:
{
  "myTurn": true,
  "patientsAheadThreshold": 3,   // the "N patients before" value; null = toggle off
  "doctorArrives": true
}
```

**Body rules:**
- `myTurn` (boolean, required) — the "My turn" toggle.
- `patientsAheadThreshold` (integer 1–50 **or** `null`, required) — the "N patients before"
  value. Send the number when the toggle is on, `null` when off.
- `doctorArrives` (boolean, required) — the "Doctor arrives" toggle.

**Response:** `sendOk` with the saved prefs echoed back. Same validation/ownership/terminal
rules and error codes as the live-queue GET (see §1 error table).

The current saved state is also returned as `notifyPrefs` on the live-queue GET (§1) so you
can hydrate the toggles when the screen opens.

### Step 3 — Receive the push

Delivered as a normal push notification. The custom payload (`data` on Android / `aps.data`
on iOS) carries:

```json
{
  "appointmentId": "cf9d43dd-...",
  "patientsAhead": 0,
  "doctorId": "2187c798-..."
}
```

Titles/bodies are server-generated, e.g. "It's your turn — You are next, please be ready
for the doctor." Tapping the notification should deep-link into that appointment's Live
Queue screen using `appointmentId`.

> These are **push-only** — they are not mirrored as `socket` events or in-app inbox rows,
> to keep high-frequency queue events off the notification inbox. The live-queue socket
> events in §2 already give you real-time in-screen updates; this section is specifically
> for out-of-app alerts.

---


## Reading the timing fields

Three numbers describe time and they answer different questions. Getting them
confused is the single easiest way to show a patient something wrong.

| field | question it answers |
|---|---|
| `delayMinutes` | How late is this appointment against **its own slot**? |
| `minutesUntilSeen` | How long until **this patient** is seen, from now? |
| `tentativeStartTime` | What clock time will they be seen at? |

**`delayMinutes` is not the wait.** A patient booked at 15:00 and projected at
15:00 has `delayMinutes: 0` while still having two people ahead and two hours to
wait. Rendering that as "Est. wait: 0 min" tells them they are next.

Show **`minutesUntilSeen`** wherever the UI says "wait", and
`tentativeStartTime` wherever it shows a time. `delayMinutes` belongs on a
"running late" banner, nothing else.

`minutesUntilSeen` is `null` when there is nothing to project from — show
"we'll update you shortly", never `0`.

### Deprecated

`estimatedWaitMinutes` is the old name for `delayMinutes` and carries the same
value. It stays until this app has migrated; prefer `delayMinutes`, whose name
matches what it measures.

`totalPatientsInQueue` equals `patientsAhead` by construction — it is **not** the
size of the day's queue. Use `patientsAhead`.

### Times

Every published time is `HH:MM` (24-hour), normalised server-side — a stored
`"13:00:00"` and a derived `"13:00"` used to reach clients as-is, in the same
payload.

`nowServingLabel` is the exception and is **already display-ready**:
`"Token 12"` on a token queue, `"1:00 PM"` on a time-based one. Render it
verbatim; the token-or-time choice is made on the server so clients cannot
disagree about it.

### `serverTime`

The server's clock when the payload was built. Use it to drive countdowns and to
grey out a payload that arrived minutes ago, rather than trusting the device
clock — a phone several minutes fast will otherwise count down to the wrong
moment.


## 4. UI Mapping

| Screen Element                    | Field                             |
| --------------------------------- | --------------------------------- |
| Current Token: **12**             | `nowServingToken`                 |
| Now serving **Token 12** / **14:30** | `nowServingLabel` (token or slot) |
| **In Consultation** badge         | `nowServingStatus`                |
| "It's your turn" state          | `isMyTurn`                        |
| Est. **2:30 PM** (± **20** min)   | `tentativeStartTime` / `tentativeRangeMinutes` |
| "Estimated" / "Tentative" label   | `isTentative` — always show it     |
| (debugging) why the estimate says that | `consultationBasis`          |
| Your Token: **18**                | `tokenNo`                         |
| **6** Patient ahead               | `patientsAhead`                   |
| Your Turn in approx. **18 mins**  | `minutesUntilSeen` (NOT `delayMinutes`) |
| Based on avg **2** mins / patient | `avgConsultationMinutes`          |
| Queue Progress indicator          | `queue.stage`                     |
| "Doctor is running late" tile     | `delay.isLate` / `delay.lateMinutes` |

### `queue.stage` values (the 4-stage Queue Progress stepper):

| Value          | Stepper stage  | When                                                                     |
| -------------- | -------------- | ------------------------------------------------------------------------ |
| `not-arrived`  | Booking        | Not checked in yet (Upcoming, Pending, or held before arrival). Was `waiting-area` before 2026-09-25 |
| `in-queue`     | Arrived        | Checked in **and** more than 5 ahead, or checked in and on hold          |
| `almost-there` | Almost There   | Checked in **and** 5 or fewer patients ahead                             |
| `consultation` | Consultation   | The doctor has taken this patient in (`status: "In Consultation"`)       |
| `completed`    | (exited queue) | Terminal status (Completed/Cancelled/NoShow) — stop live-tracking        |

> Note: "checked in" is `Patient Arrived` or `Confirmed` (the same rule as `isCheckedIn`). Only being taken into the room maps to Consultation.

---

## 5. Frontend Code Example

```javascript
import { io } from 'socket.io-client';

const socket = io('http://server:5000', {
  auth: { token: patientToken },
  transports: ['websocket'],
});

// ─── Live Queue Screen ───────────────────────────────────────────

// On opening live queue screen
const joinLiveQueue = (appointmentId) => {
  socket.emit('join.live-queue', { appointmentId }, (res) => {
    if (res.status === 'error') {
      showError(res.message);
    }
  });
};

// Receive queue updates
socket.on('queue.update', (data) => {
  setNowServing(data.nowServingToken);
  setYourToken(data.tokenNo);
  setPatientsAhead(data.patientsAhead);
  setWaitTime(data.estimatedWaitMinutes);
  setAvgTime(data.avgConsultationMinutes);
  setQueuePosition(data.queuePosition);
  setRunningLate(data.isRunningLate, data.runningLateMinutes); // persistent tile
});

// ─── "Notify me when" toggles ───────────────────────────────────

// Hydrate toggles from the REST live-queue response's `notifyPrefs`
const hydrateToggles = (notifyPrefs) => {
  if (!notifyPrefs) return; // never set — leave all off
  setMyTurn(notifyPrefs.myTurn);
  setPatientsBefore(notifyPrefs.patientsAheadThreshold); // number or null
  setDoctorArrives(notifyPrefs.doctorArrives);
};

// Persist on any toggle change (send the full object each time)
const saveNotifyPrefs = async (appointmentId, prefs) => {
  await fetch(`/api/v1/patient/appointments/live-queue/${appointmentId}/notify-prefs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      myTurn: prefs.myTurn,
      patientsAheadThreshold: prefs.patientsBefore ?? null, // null = toggle off
      doctorArrives: prefs.doctorArrives,
    }),
  });
};

// Appointment done — close the screen
socket.on('queue.completed', (data) => {
  showMessage(data.message);
  navigateToHome();
});

// On closing live queue screen
const leaveLiveQueue = () => {
  socket.emit('leave.live-queue');
};

// ─── Notifications (always active) ──────────────────────────────

socket.on('running_late', (data) => {
  showToast({
    title: 'Doctor Running Late',
    message: `Your ${data.originalTime} appointment is now expected at ${data.estimatedNewTime} (~${data.delayMinutes} min delay)`,
  });
});

socket.on('appointment_shifted', (data) => {
  showToast({
    title: 'Appointment Moved Earlier',
    message: `Your appointment moved from ${data.oldTime} to ${data.newTime}`,
  });
  updateAppointmentTime(data.appointmentId, data.newTime);
});
```

---

## 6. Home Screen — Quick Queue Status

For the home screen "Live Queue Status" card, use the same REST endpoint:

```javascript
// Fetch for home screen card
const res = await fetch(`/api/v1/patient/appointments/live-queue/${appointmentId}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const { data } = await res.json();

// Display:
// Now Serving: data.nowServingToken
// Your Token: data.tokenNo
// Est. Time: data.estimatedWaitMinutes
```

Or use the `appointment.updated` socket event which fires on the `user:{userId}` room (always connected, no need to join anything):

```javascript
socket.on('appointment.updated', (data) => {
  // Update home screen card if this matches the current appointment
  if (data.appointmentId === myAppointmentId) {
    updateHomeCard(data);
  }
});
```

---

## 7. When to Show / Hide Live Queue

| Condition                                                           | Show Live Queue? |
| ------------------------------------------------------------------- | ---------------- |
| Appointment is today + status is Upcoming/Confirmed/Patient Arrived | YES              |
| Appointment is today + status is Completed/Cancelled/NoShow         | NO               |
| Appointment is not today                                            | NO               |
| No appointment exists                                               | NO               |

---

## 8. Event Summary

### Socket events

| Event                 | Room                                      | When Received                   |
| --------------------- | ----------------------------------------- | ------------------------------- |
| `queue.update`        | live-queue room (after `join.live-queue`) | Every queue change              |
| `queue.completed`     | live-queue room                           | Your appointment completed      |
| `appointment.updated` | `user:{userId}` (always)                  | Every queue change              |
| `running_late`        | `user:{userId}` (always)                  | Doctor delay exceeds threshold  |
| `appointment_shifted` | `user:{userId}` (always)                  | NoShow shifts your time earlier |
| `clinic.eta.result`   | sender socket only                        | Response to a `clinic.eta` emit (§2b) |

### Push notifications ("Notify me when" — opt-in, §3)

| Push `event`           | When Received                                  | Requires toggle         |
| ---------------------- | ---------------------------------------------- | ----------------------- |
| `queue_my_turn`        | 0 patients ahead (front of queue)              | My turn                 |
| `queue_patients_ahead` | `patientsAhead` ≤ chosen N                     | N patients before       |
| `queue_doctor_active`  | Doctor starts consulting (becomes active)      | Doctor arrives          |
