# Session Override — API & Staff Permission Reference

Staff-declared delays on a doctor's day: "Dr. Sharma is running 30 minutes late
today" (`running_late`), or "move the whole day forward two hours"
(`schedule_shift`).

This document is the **API + permission reference**. For *why* the feature is
shaped the way it is — the floor rule, the append-only model, the
date-availability materialisation — see
[RUNNING_LATE_OVERRIDE.md](./RUNNING_LATE_OVERRIDE.md).

- Feature module: `src/main/appointment-engine/`
- Routes: `src/main/appointments/routes/v1/appointments.route.ts`
- Swagger: `http://localhost:5000/api-docs` → tag **Appointments** (paths under
  `/api/v1/appointments/session-override`)

---

## 1. Staff permission model

Every route requires a valid JWT (`Authorization: Bearer <token>`) **and** a
clinic context (`req.clinicId`, resolved by `requireClinic` from the token /
selected clinic).

### Role gate (route level — `requireRole`)

| Route | Allowed roles |
|---|---|
| `POST /session-override` | `Admin`, `Super_Admin`, `Receptionist`, `Doctor` |
| `GET /session-override` | `Admin`, `Super_Admin`, `Receptionist`, `Doctor` |
| `GET /session-override/history` | `Admin`, `Super_Admin`, `Receptionist`, `Doctor` |

`Patient`, `Pharmacist`, `Lab_Assistant` are rejected with **403 `Insufficient
role`**. An `Admin` account with `isAdminDoctorAccess` is treated as a `Doctor`
for a `Doctor`-only gate, but these routes list both roles explicitly so that
path never matters here.

### Action gate (service level — `SessionOverrideService.announce`)

The *target* of the action is checked separately, because the rule depends on
both the caller's role and the `doctorIds` they passed:

| Caller role | May declare an override for |
|---|---|
| `Admin`, `Super_Admin` | any doctor assigned to their clinic — one or many |
| `Receptionist` | any doctor assigned to their clinic — one or many |
| `Doctor` | **their own user id only** |

- A `Doctor` passing any id other than their own → **403** `A doctor can only
  announce running late for themselves`.
- Any `doctorId` not assigned to the caller's clinic (checked against
  `clinic_assign` + `users.user_type IN ('Doctor','Admin')`) → **400** `Not a
  doctor in this clinic: <ids>`. One clinic can never override another clinic's
  doctor.

The two **read** endpoints do not filter by target beyond the clinic scope: any
of the four allowed roles sees every override in their own clinic.

---

## 2. Data written (quick reference)

| Action | Tables touched |
|---|---|
| `running_late` (any value, incl. `0`) | `doctor_session_overrides` — 1 row per doctor. Nothing else. |
| `schedule_shift` `dryRun: true` | none (preview only) |
| `schedule_shift` (real) | `doctor_session_overrides` (1 row/doctor) + each moved `appointments.appointment_time` + `appointment_activity_history` (`RESCHEDULED`) + `clinic_date_availability` / `clinic_date_availability_time_slots` (window slide) + a `running_late = 0` row if one was live |
| `schedule_shift` `valueMinutes: 0` (revert) | appointment times moved back; the shift-owned `clinic_date_availability` row deleted; `doctor_session_overrides` row with `value_minutes = 0` |

Redis mirror (24h TTL, plain integer):
`appointment_engine:override:{type}:{clinicId}:{doctorId}:{date}`.

---

## 3. `POST /api/v1/appointments/session-override`

Declare, adjust, or clear an override.

### Request body

| field | type | required | notes |
|---|---|---|---|
| `doctorIds` | `string[]` (UUID) | yes | 1–50 ids; one row written per doctor |
| `type` | `"running_late"` \| `"schedule_shift"` | no | defaults to `running_late` |
| `valueMinutes` | integer | yes | `0` to clear, otherwise **5–240**. For `schedule_shift` this is **cumulative** ("day now stands N minutes late"), not a delta |
| `forDate` | `"YYYY-MM-DD"` | no | IST calendar day; defaults to IST today. Past date → 400; more than **14** days ahead → 400 |
| `sessionStart` | `"HH:mm"` (24h) | no | `schedule_shift` only — which session to move on a multi-session day. Omitted = the session the clock implies |
| `allSessions` | boolean | no | `schedule_shift` only — move every session that day (doctor out entirely). Ignored when `sessionStart` is given |
| `dryRun` | boolean | no | `schedule_shift` only — compute and return the plan, write nothing. Defaults to `false` |

### 3a. Running late — announce 30 minutes

```bash
curl -X POST http://localhost:5000/api/v1/appointments/session-override \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "doctorIds": ["3f2b…"], "type": "running_late", "valueMinutes": 30 }'
```

```jsonc
{
  "success": true,
  "message": "Running late set to 30 minutes",
  "data": {
    "date": "2026-08-27",
    "overrides": [
      {
        "doctorId": "3f2b…",
        "type": "running_late",
        "valueMinutes": 30,
        "createdBy": "a91c…",
        "createdAt": "2026-08-27T09:12:00.000Z"
      }
    ]
  }
}
```

Clear it: same call with `"valueMinutes": 0` → message `Running late cleared`.

### 3b. Schedule shift — preview (`dryRun`)

```bash
curl -X POST http://localhost:5000/api/v1/appointments/session-override \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "doctorIds": ["3f2b…"], "type": "schedule_shift", "valueMinutes": 120, "dryRun": true }'
```

```jsonc
{
  "success": true,
  "message": "Schedule shift preview",
  "data": {
    "date": "2026-08-27",
    "overrides": [],
    "dryRun": true,
    "shifts": [
      {
        "doctorId": "3f2b…",
        "deltaMinutes": 120,          // how far THIS action moves the day
        "totalMinutes": 120,          // where the day stands cumulatively
        "sessionStart": "09:00",
        "sessionEnd": "16:00",
        "shiftWindowLabel": null,     // "09:00–13:00" only on a multi-session day
        "appliedToAllSessions": false,
        "appointments": [
          { "appointmentId": "…", "patientId": "…", "from": "09:30", "to": "11:30" }
        ],
        "skipped": [
          { "appointmentId": "…", "reason": "in_consultation" }
        ],
        "sessions": []               // populated only on a multi-session day
      }
    ]
  }
}
```

`skipped[].reason` values: `in_consultation`, `no_time` (token row),
`other_shift` (belongs to a session this shift didn't touch).

### 3c. Schedule shift — commit

Same body without `dryRun` (or `dryRun: false`). Response is the same shape as
3b but `overrides` now contains the written `schedule_shift` rows and `dryRun`
is absent. Message: `Schedule shifted by 120 minutes`
(or `Schedule shifted; no appointments needed moving` when only the window
moved).

Revert with `"valueMinutes": 0` → message `Schedule shift reverted`.

### Errors

| Status | When |
|---|---|
| 400 | body fails validation (`valueMinutes` out of range, bad UUID, `forDate` past / >14d ahead, bad `sessionStart`) |
| 400 | a `doctorId` is not a doctor in the caller's clinic |
| 400 | a `schedule_shift` would push an appointment or the window past midnight / into the next session — message points at custom slots |
| 401 | missing/invalid token, or no clinic context |
| 403 | role not permitted, or a `Doctor` targeting someone else |

---

## 4. `GET /api/v1/appointments/session-override`

Active overrides for a day (cleared ones filtered out).

### Query params

| param | type | notes |
|---|---|---|
| `forDate` | `"YYYY-MM-DD"` | defaults to IST today — a future delay never badges a doctor who is on time now |
| `doctorIds` | string | repeated (`?doctorIds=a&doctorIds=b`) or comma-separated (`?doctorIds=a,b`). Omit to get every doctor in the clinic that currently has a non-zero value |
| `type` | `"running_late"` \| `"schedule_shift"` | defaults to `running_late` |

### Example

```bash
curl "http://localhost:5000/api/v1/appointments/session-override?type=schedule_shift&doctorIds=3f2b…" \
  -H "Authorization: Bearer $TOKEN"
```

```jsonc
{
  "success": true,
  "message": "Session overrides fetched successfully",
  "data": {
    "date": "2026-08-27",
    "overrides": [
      { "doctorId": "3f2b…", "type": "schedule_shift", "valueMinutes": 120,
        "createdBy": "a91c…", "createdAt": "2026-08-27T09:12:00.000Z" }
    ],
    "sessions": [                     // only when type=schedule_shift AND doctorIds given
      { "doctorId": "3f2b…", "sessions": [ { "start": "11:00 AM", "end": "06:00 PM" } ] }
    ]
  }
}
```

---

## 5. `GET /api/v1/appointments/session-override/history`

The full append-only log for a day — cleared rows included, newest first — with
`isActive` marking the row currently in effect per `(doctorId, type)`.

### Query params

| param | type | notes |
|---|---|---|
| `forDate` | `"YYYY-MM-DD"` | defaults to IST today |
| `doctorIds` | string | repeated or comma-separated; omit for all clinic doctors |
| `limit` | integer 1–100 | page size (default 20) |
| `cursor` | string | ISO `createdAt` of the last row already shown; returns strictly older rows |

### Example

```bash
curl "http://localhost:5000/api/v1/appointments/session-override/history?limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

```jsonc
{
  "success": true,
  "message": "Session override history fetched successfully",
  "data": {
    "date": "2026-08-27",
    "entries": [
      { "id": "d4…", "doctorId": "3f2b…", "type": "running_late", "valueMinutes": 0,
        "createdBy": "a91c…", "createdAt": "2026-08-27T11:40:00.000Z", "isActive": true },
      { "id": "c1…", "doctorId": "3f2b…", "type": "running_late", "valueMinutes": 40,
        "createdBy": "a91c…", "createdAt": "2026-08-27T10:05:00.000Z", "isActive": false },
      { "id": "b7…", "doctorId": "3f2b…", "type": "running_late", "valueMinutes": 20,
        "createdBy": "a91c…", "createdAt": "2026-08-27T09:12:00.000Z", "isActive": false }
    ],
    "nextCursor": null               // pass as ?cursor= for the next page; null = end
  }
}
```

> **Route order:** `/session-override/history` is registered *above*
> `GET /:appointmentId/history`. That two-segment pattern would otherwise bind
> `appointmentId` to the literal `"session-override"` and 400 on UUID
> validation. Keep it where it is.

---

## 6. Typical staff flows

**Reception, doctor just called in 30 min late**
1. `POST` `{ doctorIds: [<doc>], type: "running_late", valueMinutes: 30 }`.
2. Queue board + patient apps update via the existing `running_late` / queue
   socket events. No further action.
3. Doctor arrives early after all → `POST` same body with `valueMinutes: 0`.

**Reception, doctor is 2 hours late and the morning is lost**
1. `POST` `{ doctorIds: [<doc>], type: "schedule_shift", valueMinutes: 120, dryRun: true }`.
2. Show the returned `shifts[0].appointments` (`from → to`) and `sessionEnd` in
   a confirm dialog.
3. On confirm, `POST` the same body **without** `dryRun`.
4. Correct a wrong guess later: `POST` `valueMinutes: 90` (moves the day back
   30 min) or `valueMinutes: 0` to fully revert.

**Settings / audit page**
- `GET /session-override/history?forDate=…` for the who/what/when log.
- `GET /session-override?type=schedule_shift&doctorIds=…` for the current
  window per doctor.

---

## 7. Swagger

All three endpoints are registered in `docsRegistry` at the bottom of
`appointments.route.ts`, with request schemas, query schemas, **and response
schemas** (`announceSessionOverrideResponseSchema`,
`getSessionOverridesResponseSchema`,
`getSessionOverrideHistoryResponseSchema` in
`src/main/appointment-engine/schemas/sessionOverride.schemas.ts`). The response
schemas mirror the `{ success, message, data }` envelope and are for
documentation only — the controllers build payloads directly and are not
runtime-validated against them.
