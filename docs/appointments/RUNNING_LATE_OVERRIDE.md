# Running Late — Doctor Session Overrides

Lets a doctor, admin or receptionist declare "this doctor is running 30 minutes
late today", and have every waiting patient's estimated time update accordingly.

## Why it exists

The appointment engine's delay is entirely *derived*: `DelayTrackerService`
infers it from appointment status changes and the wall clock. That works while
the clinic is using the app, but it has a blind spot — a doctor who is stuck in
surgery, delayed in traffic, or simply hasn't started their session produces a
measured delay of **zero**, because no status has changed yet. Patients keep
seeing their original time until the doctor is already late enough for the clock
to notice.

A staff-declared value fills that gap. It is not a second notification system:
it is fed into the projection the engine already computes, so the queue board,
the estimated wait times, the `running_late` push/socket notification and the
patient app all pick it up through the path they already use.

## Data model

`doctor_session_overrides` — `src/main/appointment-engine/models/doctorSessionOverride.model.ts`

| column | type | meaning |
|---|---|---|
| `id` | uuid | |
| `clinic_id` | uuid → clinics | |
| `doctor_id` | uuid → users | scope: one doctor |
| `for_date` | date | IST calendar day; **today only** |
| `type` | enum `session_override_type` | `running_late` today |
| `value_minutes` | integer | announced delay; `0` means cleared |
| `created_by` | uuid → users | who announced it |
| `created_at` | timestamp | |

Three deliberate choices:

**It is not a settings table.** Clinic-wide configuration — including
`runningLateThresholdMinutes`, which governs when the notifier fires — lives in
`clinic_settings` and is overwritten in place. An override happens *on a date*,
has an author, and is worth knowing about afterwards. Those are different
lifetimes and they do not belong in one row.

**Append-only; newest row wins.** There is no `status` column, no `cleared_at`,
no partial unique index. Re-announcing 20 → 40 minutes inserts a second row;
clearing inserts a row with `value_minutes = 0`. The read is "newest row for
(doctor, date, type)", served by `doctor_session_overrides_lookup_idx`, and the
day's history comes for free.

**`type` absorbs future features.** A break, an early finish or a cancelled
session is a new enum value reusing `value_minutes` — no new columns, no
migration, no new endpoint. Only add a column when a real request needs one.

### Migration

The model is picked up automatically by `drizzle.config.ts`
(`schema: './src/main/**/models/*.ts'`). Generate and apply it with the usual
per-environment commands, e.g.:

```bash
npm run db:migrations:dev && npm run db:migrate:dev
```

## How the delay reaches patients

The whole feature is one insertion point in `DelayTrackerService.recalculate`:

```
announcedDelayMinutes = SessionOverrideService.getActiveMinutes(clinic, doctor, date)

// on the first non-terminal appointment only:
projectedStartMinutes = max(projectedStartMinutes,
                            scheduledMinutes + announcedDelayMinutes)
```

It is a **floor, never a replacement**. If the doctor is already running worse
than what was announced, the measured value is larger and wins — so a patient is
never quoted a better time than reality supports. If nothing was announced the
value is `0` and the projection is byte-for-byte what it was before.

Only the first live appointment needs it. Everyone behind inherits it through
the existing `previousProjectedEnd` cascade, so a 30-minute announcement moves
the entire queue by 30 minutes.

This also settles the "doctor is consulting" case. A `Confirmed` appointment
means the doctor is with a patient, which suppresses the clock-based delay
branch — the announced value is then the only signal there is, and because the
floor is applied outside that branch it still applies. Covered by
`sessionOverride.delay.test.ts`.

### Fan-out

`SessionOverrideService.announce` writes the rows, mirrors the value to Redis,
then calls `AppointmentEngineOrchestrator.onSessionOverride`, which runs the
same pipeline a status change does:

1. `DelayTrackerService.recalculate` — reads the override back
2. `RunningLateNotifier.evaluateFromCache` — push + socket `running_late`
3. `TimeToNextService.computeAndBroadcastFromQueue`
4. `QueueBroadcastService.emitQueueUpdated` → clinic room
5. `QueueBroadcastService.emitPatientUpdated` → each patient room

The frontend already consumes the last two: `usePatientAppointmentRealtime`
handles `running_late` and `appointment.updated`, `useClinicQueueRealtime`
handles `queue.updated`. No new socket events were added for the announcement
itself — the only event added anywhere in this work is `queue.error`, which
reports `join.live-queue` rejections and is unrelated to announcing.

**Re-notification.** The notifier keeps an
`appointment_engine:notified:{appointmentId}` flag for 24h so one delay doesn't
notify a patient repeatedly. An announcement is a new fact rather than a repeat
of that crossing, so `refreshQueues` deletes those flags first — otherwise
raising 20 minutes to 40 would silently reach nobody who had already been told
about the 20.

### What `isRunningLate` actually means

Important when verifying, because it is **not** the same fact as the Redis
`notified:{appointmentId}` flag, and it used to be.

| field | source |
|---|---|
| `estimatedWaitMinutes` | the engine's projection for this appointment |
| `isRunningLate` (`delay.isLate`) | `estimatedWaitMinutes > clinic threshold` (default 10), never while on hold |
| `runningLateMinutes` (`delay.lateMinutes`) | the live `estimatedWaitMinutes` when late, else null |
| `notified:{id}` flag | a record that a push notification was **delivered**; de-duplicates pushes only |

`isRunningLate` was previously read straight off the notification flag. That
flag is only set *after* `sendRunningLateNotification` resolves, so any delivery
failure — patient has no device token, provider misconfigured, network blip —
left a payload reading `estimatedWaitMinutes: 45` next to
`isRunningLate: false`. Self-contradictory, and unrenderable by any client.

Since 2026-09-25 the payload no longer reads the flag at all. It used to win
when it carried the larger number, but it keeps the delay *at alert time* for
24h, so one bad reading stayed on the patient's screen long after the queue
recovered (seen in testing as "running about 16h 54min behind"). The banner now
always matches the queue shown beside it. The threshold
comes from `RunningLateNotifier.getThresholdMinutes` — public specifically so
the payload and the notifier cannot disagree about what "late" means — and is
passed into `buildPayloadFromQueue` on every path (REST, socket join,
`queue.refresh`, `queue.update` broadcast, `appointment.updated` broadcast).

**Consequence worth knowing:** an announcement makes `isRunningLate` true
immediately, whether or not any notification was successfully delivered. That is
the intended behaviour — the delay is real regardless of whether the push
landed.

### The join path does not wait for notifications

`computeLiveQueuePayload` fires `evaluateSingleFromCache` **without awaiting
it**. Evaluating can dispatch a push notification, whose delivery is an outbound
call to a third-party provider; awaiting it made a patient wait on Firebase
before receiving the queue payload they had just joined for. The payload does
not depend on its result, precisely because `isRunningLate` is derived rather
than read from the notification's side effect.

So when testing: the `queue.update` emitted on join is immediate, and the push
notification arrives independently, possibly a moment later.

### Caching

`appointment_engine:override:{type}:{clinicId}:{doctorId}:{date}`, 24h TTL,
holding the minutes as a plain integer. `getActiveMinutes` runs on every
recalculation, so the hot path is a single Redis `GET`. A cache miss falls back
to the newest DB row and repopulates, which keeps announcements correct across a
Redis restart instead of silently dropping every clinic's delay. All Redis
writes here are best-effort and never fail the caller.

## API

Both routes are mounted on the appointments router, alongside `/queue-state` and
`/reception/live-queue`. `GET /session-override` is registered **before**
`GET /:appointmentId` — Express matches in order and the parameterised route
would otherwise swallow it.

### `POST /api/v1/appointments/session-override`

```jsonc
{
  "doctorIds": ["<uuid>", "<uuid>"],  // 1–50; one row written per doctor
  "type": "running_late",             // optional, defaults to running_late
  "valueMinutes": 30,                 // 0 to clear, otherwise 5–240
  "forDate": "2026-08-25"             // optional, defaults to IST today
}
```

Response:

```jsonc
{
  "success": true,
  "message": "Running late set to 30 minutes",
  "data": {
    "date": "2026-08-19",
    "overrides": [
      { "doctorId": "…", "type": "running_late", "valueMinutes": 30,
        "createdBy": "…", "createdAt": "2026-08-19T09:12:00.000Z" }
    ]
  }
}
```

`valueMinutes` is bounded at 5–240 (or exactly 0). Below 5 minutes is noise
nobody needs a push notification about; above 240 the session should be
cancelled or rescheduled rather than described as running late.

### `GET /api/v1/appointments/session-override`

Optional `doctorIds` (repeated or comma-separated) and `type`. With no
`doctorIds`, returns every doctor in the clinic currently running late — one
call to badge the whole reception board. Cleared overrides (`valueMinutes: 0`)
are filtered out of the response.

### `GET /api/v1/appointments/session-override/history`

The day's full log — cleared rows included, newest first, each carrying
`isActive` for the row currently in effect per (doctor, type). The table is
append-only precisely so this costs nothing: raising 20 to 40 then clearing
leaves three rows and the whole story.

Optional `forDate` (defaults today) and `doctorIds`.

**Route order matters.** It is registered *above* `GET /:appointmentId/history`,
not merely above `GET /:appointmentId`. That two-segment pattern fits
`/session-override/history` exactly, binding `appointmentId` to the literal
string "session-override", which then fails UUID validation and 400s. The
one-segment `/session-override` routes are safe from it; this one is not.

### Permissions

| role | may announce for |
|---|---|
| `Admin`, `Super_Admin` | any doctor assigned to the clinic, one or many |
| `Receptionist` | any doctor assigned to the clinic, one or many |
| `Doctor` | themselves only |

Enforced in `SessionOverrideService.announce`, not in the route, because the
rule depends on both the role and the target ids. Doctor ids are checked against
`ClinicAssignModel`, so one clinic cannot announce for another clinic's doctor.

**Dates.** `forDate` ('YYYY-MM-DD') defaults to the server's IST today and may
name any day up to `MAX_OVERRIDE_DAYS_AHEAD` (14) ahead. A past date is refused
— those appointments are over — and so is anything beyond the ceiling, so a
mistyped year cannot write a row that waits three centuries to take effect.

This was today-only until upcoming days were requested. The original reasoning
("the projection is built against the current clock") only ever covered the
*live* effect, not the row: an override for a future day is read perfectly well
when that day arrives, keyed by date like everything else here. What does not
run ahead of time is the engine — `refreshQueuesIfLive` returns early for any
date other than today, because recalculating would build a projection against
the wrong clock and cache it under that date, where tomorrow's first real
recalculation would find it and trust it.

`GET /session-override` likewise defaults to today rather than returning every
future row, so a delay declared for next Tuesday cannot badge a doctor who is
perfectly on time this morning.

## Files

| file | role |
|---|---|
| `models/doctorSessionOverride.model.ts` | table |
| `schemas/sessionOverride.schemas.ts` | Zod validation + bounds |
| `services/sessionOverride.service.ts` | permissions, write, cache, fan-out |
| `controllers/sessionOverride.controller.ts` | request/response |
| `services/delayTracker.service.ts` | the floor (the one behavioural change) |
| `services/orchestrator.service.ts` | `onSessionOverride` entry point |
| `services/sessionOverride.delay.test.ts` | floor, cascade, consulting, tokens |
| `appointments/routes/v1/appointments.route.ts` | route registration |
| `services/liveQueueHelper.ts` | derives `isRunningLate` from delay vs threshold |
| `services/queueBroadcast.service.ts` | passes the threshold on both emit paths |
| `socket/socketManager.ts` | `join.live-queue`, `queue.error` |

## Frontend surfaces

**Settings page** — `pages/profile/DoctorDelaySettings.tsx`, at
`/profile/doctor-delays` under *Clinic & Scheduling*. The queue-card and
Queue-settings controls are for acting in the moment; this page answers what
the modals cannot — what is set, for which doctor, on which day, who set it,
and what changed before that. Disabling lives here, so turning a delay off is a
visible action rather than the side effect of finding a modal and pressing a
preset marked 0. Hidden from Patient, Pharmacist and Lab_Assistant; **visible
to Receptionist**, who is the main user, even though they cannot see Doctor
Availability.


One component, `components/appointment/RunningLateControl.tsx`, in two places:

- **Reception dashboard**, on each doctor's queue column — the doctor is
  already fixed, so the modal goes straight to the presets.
- **Appointment screen**, inside the **Queue settings** dialog
  (`QueueSettingsModal`) behind the gear on the queue status bar. That screen
  spans the clinic, so the picker lists doctors with checkboxes and announces
  for all of them in one call via `doctorIds`. It deliberately does *not* fall
  back to the queue's own `doctorId`: that value is a clinic-profile default
  rather than a doctor the user picked, and announcing against it would push a
  wrong time to another doctor's patients.

The status bar itself carries **no announce control** — only an amber
"Announced Nm" chip beside the delay figure. Announcing and clearing live in
one place so the same value cannot be changed from two surfaces that disagree;
the bar reports state, which is what the rest of it does.

A doctor logged in only ever sees themselves in the picker, matching the
backend rule, and gets the gear even though the surrounding settings are
admin-only — announcing is theirs to do, configuring is not.

Patient side: `usePatientAppointmentRealtime` persists the `running_late`
payload instead of only toasting it, so the appointment card keeps showing the
new expected time rather than losing it when the toast fades.

See also [APPOINTMENT_ENGINE_TEST_SCENARIOS.md](./APPOINTMENT_ENGINE_TEST_SCENARIOS.md) section 3 for the full running-late scenario list.

## Verifying the logic

### The floor rule, in one table

Announced 30 minutes, appointment scheduled 09:00, threshold 10:

| situation | measured | announced | patient sees | why |
|---|---|---|---|---|
| Doctor not started, now 09:00 | 0 | 30 | **30** | announcement is the only signal |
| Doctor not started, now 10:00 | 60 | 30 | **60** | never quote better than reality |
| Doctor consulting (`Confirmed`) | 0 | 30 | **30** | floor sits outside the clock branch |
| Announcement cleared (`0`) | 0 | 0 | **0** | straight back to derived |
| Nothing ever announced | 0 | — | **0** | byte-identical to pre-feature behaviour |

All five are covered by `sessionOverride.delay.test.ts`.

### End-to-end check

1. `POST /session-override` with `valueMinutes: 30` for a doctor with live
   appointments today.
2. Row in `doctor_session_overrides`; Redis key
   `appointment_engine:override:running_late:{clinicId}:{doctorId}:{date}` = `30`.
3. `GET /queue-state?clinicId=…&doctorId=…` — every live appointment's
   `estimatedWaitMinutes` ≥ 30, `projectedStartTime` pushed out.
4. A patient socket in the live-queue room receives `queue.update` with
   `isRunningLate: true` and `runningLateMinutes: 30`.
5. Re-announce `40` — patients are notified again, because `refreshQueues`
   clears the `notified:` flags first.
6. `valueMinutes: 0` — waits return to their derived values.

### Things that look like bugs but are not

- **`isRunningLate: true` with no push received.** Expected — see above. Check
  the notification provider, not the engine.
- **`runningLateMinutes` larger than what was announced.** The measured delay
  exceeded the announcement and correctly won.
- **Announcement appears to do nothing.** Check the queue is non-empty for
  *today* and that the appointments are non-terminal — a terminal appointment is
  skipped by the projection entirely.
- **`nowServingToken: null` on a time-based queue.** Correct; read
  `nowServingLabel` / `nowServingTime` instead.

### Silent failures to rule out first

`join.live-queue` rejections emit a `queue.error` event **and** call the ack, so
a client that emitted without a callback still sees the reason. Codes:
`INVALID_PAYLOAD`, `UNAUTHENTICATED`, `NOT_FOUND`, `NO_DOCTOR`, `NOT_TODAY`,
`TERMINAL_STATUS`, `ACCESS_DENIED`, `INTERNAL_ERROR`. Each also writes a warn
line with the user and appointment id.

`ACCESS_DENIED` is the common one during testing: the live queue is a **patient**
channel, so a clinic staff token fails ownership even though it connects fine.

## Schedule shift — moving the day instead of describing it

`running_late` above is an announcement: estimates move, nothing is rewritten.
It solves "tell the patient the truth" and does not solve the problem
underneath it.

A doctor who arrives two hours late does not work through the 09:30 booking
first — they see whoever is standing in the clinic. Meanwhile the past-slot
rule (`Appointment slot time cannot be in the past`) has quietly deleted two
hours of that doctor's capacity: every free slot before now is unbookable, and
every booked one is stranded at a time that has been and gone. The clinic has
lost the morning, and the only recovery is rebuilding the day by hand.

`schedule_shift` moves the day. Every remaining appointment and the bookable
window slide forward by the same number of minutes: 09:30 → 11:30, 10:00 →
12:00, order untouched, capacity intact, and the past-slot rule left exactly as
it was — it now measures against times that are real.

### The two never apply at once

Applying a shift **clears any live `running_late`** for that doctor/day. The
announcement is a floor on the projection; once the delay is written into the
appointment times themselves, that floor would count it a second time and quote
14:00 for an appointment already moved to 12:00. `clearRunningLate` writes the
usual zero row, and only for doctors that actually had one — an unconditional
insert would fill every clinic's history with zeros.

### Cumulative value, delta action

The stored `value_minutes` is where the day *stands* ("running 120 minutes
late"); the shift performed is the difference from where it already stood.
Everything else falls out of that one choice:

| action | stored | performed |
|---|---|---|
| first announcement of 120 | 120 | +120 |
| correcting 120 → 30 | 30 | −90 |
| clearing (`0`) | 0 | −120 |

There is no undo path, no "original times" column, and no second endpoint —
a correction is a shift like any other.

### What moves, and what deliberately does not

`MOVABLE_STATUSES` is an allowlist, not `!isTerminalStatus(...)`, and the
difference is load-bearing:

| left alone | why |
|---|---|
| `Completed`, `Cancelled`, `NoShow` | terminal; the day is done with them |
| `Missed` | **not** terminal to the engine, but its time records an appointment the patient never came to — sliding it forward invents a promise nobody made |
| the consultation in progress | read from the queue's Redis room pointer (`getCurrentAppointmentId`), **not** from `appointmentStatus` — `Confirmed` means the booking was confirmed, not that the doctor is in the room |
| token rows | a token is a number, not a clock time; there is nothing to slide |

`Rescheduled` **is** moved: the slot generator counts it as occupying the day,
so leaving it behind strands a blocker on a slot the doctor no longer works.

### Why the times are rewritten here, when `lateQueueDemotion` refuses to

`appointments.late_queue_demotion` stores a count precisely so that
`appointmentTime` is never overwritten — the booked time is what the clinic
promised, and wait time is measured against it. That reasoning holds for a
demotion, which is a queue-order nudge. A shift is a *new promise*, the same
thing a reschedule is, so the stored time has to carry it — and the wait-time
figure measured against the new time is then correct rather than corrupted.
Evidence lives in the override row (`created_by`, `created_at`) and in a
`RESCHEDULED` activity-history entry per appointment, written inside the same
transaction. `reason_for_reschedule` is deliberately left alone: it holds the
patient's own reason.

### The window moves as a date-availability row

The shift is materialised into `clinic_date_availability` +
`clinic_date_availability_time_slots` rather than applied inside the slot
generator. `getAvailableSlotsForDate` already prefers a date row over the weekly
template, so the entire grid moves with **zero changes** to a ~900-line function
every booking screen depends on.

- A day that already has a date row — a hand-built schedule — has its own slots
  shifted. Only a day running on the weekly template gets one materialised.
- Breaks survive as the **gaps between segments**, which is how the date path
  expresses them (it does not read the break tables at all). Lunch shifts with
  everything else.
- Token days are refused: `readWeekly` returns null when `no_of_patients` is
  set, so a token queue has nothing a shift could act on. Announce running late
  instead.

**Reverting deletes the row this feature created.** This is not tidiness, it is
the difference between working and broken. A date row *shadows* the weekly
template for its day — the generator prefers it and never reads the weekly hours
again. A row left behind after a revert means every later edit to that doctor's
weekly hours silently does nothing on that date, which presents as a caching bug
and is unguessable from the UI. Rows carry a `Schedule shifted by …` note
(`SHIFT_NOTE_PREFIX`) so `totalMinutes === 0` can remove ours and leave a
clinic's hand-built one alone — that one is only ever shifted back.

**The window is validated, never clamped.** If shifting would move the day's
hours past midnight (or before it), `plan` throws a 400 pointing at custom
slots. Clamping to 23:59 was the original behaviour and it was wrong twice over:
it turns the requested shift into a silently shorter one, and on a day ending at
23:55 `min(23:59, …)` pushes the end *later* than the clinic configured.
Validating in `plan` also keeps the dry-run preview and the write agreeing —
clamping at write time meant the preview promised something the write did not
do.

### `day_config` must be cleared

`DelayTrackerService.resolveDayConfig` caches the session start, slot length and
breaks for **one hour**, because availability does not normally change mid-day.
A shift is the one thing that changes it mid-day. Without the `DEL`, the engine
keeps projecting against the old session start while the appointments already
carry the new times — the self-contradictory state the rest of this document
works hard to avoid. `ScheduleShiftService.apply` deletes it after commit.

### API

Same endpoint, one new `type` and one new flag:

```jsonc
{
  "doctorIds": ["<uuid>"],
  "type": "schedule_shift",
  "valueMinutes": 120,      // cumulative; 0 reverts
  "forDate": "2026-08-25",  // optional, defaults to IST today
  "dryRun": true            // preview only, writes nothing
}
```

`dryRun` returns the plan the write would perform — the confirm dialog renders
it directly, so what reception approves cannot disagree with what lands:

```jsonc
{
  "date": "2026-08-23",
  "overrides": [],
  "dryRun": true,
  "shifts": [{
    "doctorId": "…",
    "deltaMinutes": 120,
    "totalMinutes": 120,
    "sessionEnd": "16:00",
    "appointments": [
      { "appointmentId": "…", "patientId": "…", "from": "09:30", "to": "11:30" }
    ],
    "skipped": [{ "appointmentId": "…", "reason": "in_consultation" }]
  }]
}
```

A shift that would push an appointment past midnight is refused with a 400
pointing at custom slots — which is the intended answer for a very long delay.
Beyond about four hours the original running order stops being worth
preserving, and the day should be rebuilt with date-specific availability
rather than slid.

### Real-time

No new events. `ScheduleShiftService` signals the doctor's queue, the reception
board, and each moved patient's own appointment section with
`appointment.rescheduled`, then `refreshQueues` runs the same orchestrator pass
an announcement does. The patient app needs no release: `appointment.updated`
already carries `appointmentTime` on the `user:{userId}` room — provided it
re-renders from that event rather than only toasting it.

### Frontend

`components/appointment/ShiftScheduleControl.tsx`, mounted beside
`RunningLateControl` in both of its places and gated on the same server-decided
`canAnnounceLate` flag. It never fires on a single tap: choosing a duration
previews server-side, and the confirm button names the number of appointments
it is about to move.

Both controls take a `presentation` prop. On a reception queue card there is no
room to expand, so they stay a trigger plus a modal; inside **Queue settings**
they render `presentation="inline"`, straight into the panel. They used to open
their own dialog there, which stacked a second modal on top of the settings
modal to ask for one number.

The day picker (`delayDateOptions.ts`, shared so the two cannot offer different
windows) builds its values from local calendar parts rather than
`toISOString()`: converting to UTC first sends yesterday's date for any clinic
ahead of UTC before 05:30, and IST is +5:30.

A shift is offered even when the day has **no appointments booked** — the
window still moves, so bookings start at the doctor's real arrival time. Gating
the confirm on moved appointments alone left that case with no way to act.

### Files

| file | role |
|---|---|
| `services/scheduleShift.service.ts` | the plan, the write, the cache clear, the signal |
| `services/scheduleShift.test.ts` | shift maths, exemptions, midnight refusal |
| `services/sessionOverride.service.ts` | `applyScheduleShift`, `clearRunningLate` |
| `models/doctorSessionOverride.model.ts` | the `schedule_shift` enum value |
| `components/appointment/ShiftScheduleControl.tsx` | preview + confirm (FE) |

## Not built (deliberately)

- **A reason field.** It was specced and cut: an optional free-text box stays
  empty in practice, leaks clinic-internal detail to patients when it doesn't,
  and costs the popover its three-tap simplicity. Patients care about the new
  time. `created_by` / `created_at` answer "who and when" if anyone asks. Add it
  when a clinic actually requests it.
- **`expectedResumeAt`.** Derivable from `created_at + value_minutes`.
- **Auto-expiry.** The override is scoped to a date and the Redis key carries
  it, so it cannot leak into tomorrow. Clearing it mid-day is one tap.
- **Clinic-wide announcements.** Scope is per doctor, matching how the engine
  keys everything else. Announcing for every doctor is the same call with more
  ids.
