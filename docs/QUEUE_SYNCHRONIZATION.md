# Queue Synchronization

How one queue stays the same queue on the receptionist's screen and the
doctor's.

**Where it lives.** The queue is same-day, live, status-driven work, so it sits
with the rest of that machinery in `src/main/appointment-engine/`:

| File | What it is |
|---|---|
| `services/queue.service.ts` | `QueueService` — the single writer; positions and actions |
| `services/queueHoldStore.service.ts` | holds (Redis, date-scoped, self-expiring) |
| `services/receptionLiveQueue.service.ts` | the composed board both screens read |
| `utils/queueBoard.ts` (+ `queueBoard.test.ts`) | `buildBoard` — the classification rules; `orderCheckedIn` / `orderLikeBoard` — the one queue order; pure and testable |
| `services/dayQueue.service.ts` | `fetchDoctorDayQueue` — the one query for a doctor's day, read by the board and the projection |
| `services/liveQueueHelper.ts` | the patient payload (`buildPayloadFromQueue`) and the live-queue access rule (`loadLiveQueueAppointment`) |
| `types/queue.types.ts`, `types/receptionLiveQueue.types.ts` | the shapes |
| `controllers/queue.controller.ts`, `schemas/queue.schemas.ts` | request handling |
| **`appointments/routes/v1/queue.route.ts`** | the only piece still outside the engine |

That last row is deliberate, not an oversight. `loadRoutes` derives the mount
path from the folder name, so moving the route file would silently rewrite
`/api/v1/appointments/queue/*` to `/api/v1/appointment-engine/queue/*`. The
engine has no `routes/` directory at all for the same reason — its other
endpoints (`/appointments/reception/live-queue`, `/appointments/queue-state`)
are exposed through `appointments.route.ts`. Logic in the engine, HTTP surface
in the feature module, URLs untouched.

## The rule

One writer, one set of rules, and screens that render rather than derive.

```
Receptionist action ─┐
                     ├─▶ QueueService (single writer) ─▶ realtime signal ─▶ both screens refetch
Doctor action ───────┘         │                                     the same board
                               │
                               ├─▶ GET /appointments/queue/board          (one doctor / whole clinic)
                               └─▶ GET /appointments/reception/live-queue (the composed board)
```

Nothing about "who is with the doctor" — or who an action applies to — is
computed on a client. That is the failure mode this design exists to remove,
and every time a screen has re-derived any of it, the two screens have ended up
disagreeing.

### Two endpoints, one source

`ReceptionLiveQueueService` (appointment-engine) **composes** `QueueService`
(appointments). It does not re-derive the queue.

| | `QueueService` (appointments) | `ReceptionLiveQueueService` (engine) |
|---|---|---|
| Owns | positions, holds, and every write | the *view*: roster, availability, derived affordances |
| Answers | who is where, and moves them | what a screen should render and offer |
| Reads | appointment rows + the held set | `QueueService.getBoard()` per doctor on the roster |

The engine used to build its own board from `DelayTrackerService`, with its own
copy of "who is with the doctor" (`entries.find(e => e.status === 'Confirmed')`,
no hold awareness, entries with no appointment id). The frontend therefore had
to call **both** endpoints and merge them — recovering ids by matching a slot
string, re-deciding which patient each control applied to, and re-deriving
check-in state. Every queue bug worth the name came from that layer. It is gone:
the composed board carries `appointmentId`, `isCheckedIn`, `onHold`,
`startedAt`, `actionTarget`, `checkInTarget` and `canAnnounceLate`, so the
client has nothing left to decide.

### `queue/board` and `queue/state` are not interchangeable

The timeline reads both, which looks redundant until you check the payloads.
They answer different questions and share no fields:

| | `/queue/board` | `/queue/state` |
|---|---|---|
| Answers | who is next, who is held, in what order | how long each patient waits, when this one went in |
| Per entry | `position`, `holdReason`, `appointmentStatus` | `estimatedWaitMinutes`, `projectedStartTime`, `consultationStartedAt`, `arrivedAt` |
| Drives | the rail's order and "next up" | the Est. time and Delay columns |

`QueueEntry` carries none of the wait fields, so dropping `queue/state` empties
those columns and dropping the board returns the ordering bugs above. Merging
them means adding the four wait fields to `QueueEntry` — a backend change, not a
frontend cleanup. Until then, both calls stay.

### One queue path (since 2026-09-25)

The board (who is where) and the projection (times, `patientsAhead`, alerts)
are still two builders, but every input and rule under them is now shared, so
reception, the doctor, the patient app and the notifications cannot disagree:

| Step | Shared piece | Before |
|---|---|---|
| Which appointments | `fetchDoctorDayQueue` — one query; excludes unpaid online checkouts (`activeAppointmentFilter`, the Appointments list's rule) | two copies; the projection sorted by time and kept unpaid checkouts |
| Queue state | the Redis records: room pointer, holds, "Set as next" | unchanged |
| Order | `orderLikeBoard`, per shift: patient with the doctor → checked-in patients by token (late check-ins demoted, promotions first) → not-arrived by token | the projection walked plain token/time order; demotion applied only there |
| Slot times | a shift token's slot is its place in that order from the doctor's **current** start time; its stored `appointmentTime` is ignored (the app saves the shift start). Custom-slot bookings (no shift) keep their time | a stored shift start made token 2 "30 min late" and ignored changed hours |
| Unknown start time | the token grid anchors at *now* | anchored at 00:00 — every token "~17 h late", pushed as an alert |
| Running late | live `delay > threshold` only; `notified:{id}` just de-duplicates pushes | the alert-time value was shown for 24 h |
| Patient payload | `buildPayloadFromQueue` for REST, join, `queue.refresh` and both broadcasts | unchanged |
| Access | `loadLiveQueueAppointment` for REST and `join.live-queue` (IST "today", ownership first) | two copies; the socket judged "today" in UTC |

**Remaining edge:** the board's `waiting` list spans shifts, while
`patientsAhead` counts within the patient's own shift. Each patient's own count
is right; the board list can interleave a checked-in evening patient with the
morning's.

## Responses

Shapes are the source types, not hand-written samples — see
`appointment-engine/types/queue.types.ts` and `.../receptionLiveQueue.types.ts`.
All three are wrapped in the standard `{ success, message, data }` envelope.

### `GET /api/v1/appointments/queue/board?doctorId=&date=`

Omit `doctorId` for every doctor in the clinic.

```jsonc
{
  "success": true,
  "message": "Queue board fetched successfully",
  "data": {
    "clinicId": "…",
    "generatedAt": "2026-09-01T07:02:11.000Z",
    "doctors": [
      {
        "clinicId": "…",
        "doctorId": "…",
        "date": "2026-09-01",
        "currentPatient": {            // null when the doctor is free
          "appointmentId": "…",
          "patientId": "…",
          "patientName": "raju",
          "tokenNo": null,
          "appointmentTime": "12:30",
          "appointmentStatus": "Confirmed",  // "Confirmed" = in the room
          "position": "with_doctor"
        },
        "nextPatient": { "…": "same shape, position: 'next'" },  // never someone held
        "waiting":     [ { "…": "position: 'waiting'" } ],       // server-ordered
        "onHold":      [ { "…": "position: 'on_hold'", "holdReason": "held" } ],
        "completed":   [ { "…": "position: 'done'" } ],
        "notArrived":  [ { "…": "position: 'not_arrived'" } ],
        "generatedAt": "2026-09-01T07:02:11.000Z"
      }
    ]
  }
}
```

`position` is derived per request, never stored. `holdReason` (`held` |
`skipped`) appears only on `onHold` entries — the two leave a patient in an
identical state otherwise.

**`waiting` order is the answer, not a suggestion.** It already reflects a
manual "Set as Next"; re-sorting it by `appointmentTime` on the client is what
made the timeline disagree with reception.

### `GET /api/v1/appointments/reception/live-queue`

The composed board — same queue, plus roster and the derived affordances.

```jsonc
{
  "success": true,
  "message": "Live doctor queue fetched successfully",
  "data": {
    "clinicId": "…",
    "date": "2026-09-01",
    "generatedAt": "2026-09-01T07:02:11.000Z",
    "doctors": [
      {
        "doctorId": "…",
        "name": "Ajay Sharma",
        "profilePhoto": null,
        "speciality": "Andrologist",
        "status": "Consulting",        // follows the queue, not the roster
        "isAvailableNow": true,        // inside working hours right now
        "currentRunning": {
          "appointmentId": "…",
          "patientName": "Aa",
          "slot": "12:30",             // tokenNo, else appointmentTime, else "-"
          "isCheckedIn": true,
          "startedAt": "2026-09-01T07:00:00.000Z"   // see the caveat below
        },
        "nextInQueue": [ { "appointmentId": "…", "patientName": "Yyy", "slot": "13:00", "isCheckedIn": false } ],
        "onHold":      [ { "…": "…", "holdReason": "skipped" } ],
        "waitingCount": 1,             // checked in — can be called now
        "totalWaiting": 3,             // everyone still ahead, arrived or not
        "actionTarget":  "appointmentId | null",  // who call/hold/skip apply to
        "checkInTarget": "appointmentId | null",  // who check-in applies to
        "canAnnounceLate": false
      }
    ]
  }
}
```

`actionTarget` / `checkInTarget` exist so no client decides which patient a
button acts on. Render the control against the id; never re-derive it.

> **`startedAt` is when the doctor actually took the patient in** — the instant
> `send-in` records via `queueHoldStore.setConsultationStartedAt`, so "since N
> min" is real consultation time. A 12:30 appointment begun at 12:25 reads as 5
> minutes, not 0.
>
> It falls back to the scheduled slot only when that instant is missing (an
> evicted key, or a consultation started before this was recorded). The
> fallback under-reports an early start, so a value that exactly matches the
> slot means the fallback fired.

### `GET /api/v1/appointments/queue-state?doctorId=&date=`

Per-appointment timing. Shares no fields with the board.

```jsonc
{
  "success": true,
  "message": "Queue state fetched successfully",
  "data": {
    "clinicId": "…",
    "doctorId": "…",
    "date": "2026-09-01",
    "cumulativeDelay": 23,
    "timeToNextMinutes": 8,
    "lastCalculatedAt": "2026-09-01T07:02:11.000Z",
    "consultationBasis": "learned",   // learned | configured | slot | default
    "appointments": [
      {
        "appointmentId": "…",
        "patientId": "…",
        "status": "Patient Arrived",
        "appointmentTime": "12:30",
        "tokenNo": null,
        "estimatedWaitMinutes": 12,
        "projectedStartTime": "12:42",
        "consultationStartedAt": null,  // set only for the patient in the room
        "arrivedAt": "2026-09-01T06:42:00.000Z"
      }
    ]
  }
}
```

`consultationBasis` names where the consultation length came from, so every
consumer reports the same basis without re-deriving it.

### Actions

`POST /queue/send-in` · `/hold` · `/skip` · `/resume`, each
`{ appointmentId }`, and each returning **the full board above** — the same
shape as `GET /queue/board`. Apply the response; do not patch local state and
do not refetch on success.

Failures are `409` with a message naming the reason (not arrived, already with
the doctor). See **The actions** for the full matrix.

## No new appointment status

The queue adds nothing to the `apointment_status` enum. Positions are derived:

| Board position | How it is stored |
|---|---|
| `with_doctor` | `appointmentStatus = 'Confirmed'` (the pre-existing convention — `DelayTrackerService` already reads it this way) |
| `next` | `'Patient Arrived'`, not held, first in queue order |
| `waiting` | `'Patient Arrived'`, not held, behind someone |
| `on_hold` | `'Patient Arrived'` **plus** a Redis flag (`queue:hold:{clinic}:{doctor}:{date}`) |
| `not_arrived` | booked but not checked in |
| `done` | `Completed` / `Cancelled` / `NoShow` |

A hold is Redis-only because it is meaningless tomorrow: the key is
date-scoped and expires itself, and if Redis is lost the holds clear and those
patients rejoin the waiting list — the safe direction, since reception sees
them again rather than losing them.

Classification lives in the pure `utils/queueBoard.ts` `buildBoard()`, which is
why the rules are testable without a database (`tests/queueBoard.test.ts`).

## The actions

All under `/api/v1/appointments/queue`, all `Receptionist | Admin | Doctor` —
a doctor working without a receptionist still has to move their own queue.
Every action returns the rebuilt board, so no caller needs a follow-up read.

| Action | What it does | Notes |
|---|---|---|
| `POST /send-in` | **Doctor/Admin:** the patient goes in the room (any displaced patient is parked). **Receptionist:** lines the patient up to go in next; the room is never touched | 409 if the patient has not arrived |
| `POST /hold` | flags a **checked-in, waiting** patient unavailable | never offered as `next` while held. **409** on the patient with the doctor, and **409** on anyone not yet arrived |
| `POST /skip` | **hold + advance in one action**: parks this checked-in patient and, *if the room is free*, sends the next one in | nothing is lost — Resume returns them in token order. With a consultation running it is exactly a hold. Same two **409**s as hold |
| `POST /resume` | clears the hold | the only way back; holds never clear on their own |

Completing is **not** a queue action. Reception moving the queue on is not a
clinical statement that a consultation finished, so only the doctor completes,
through the normal appointment update (`PUT /appointments/:id` →
`Completed`) — or automatically when a prescription is issued.

### `send-in` splits by role, not by room

Who is in front of the doctor is the doctor's call, so `send-in` does one of
two things depending only on who asked:

| | Doctor / Admin | Receptionist |
|---|---|---|
| room free | patient goes in | **lines the patient up next** — the room is untouched |
| room busy | swaps the room; the displaced patient is **parked**, not re-queued | **lines the patient up next** — the room is untouched |

Reception's order lives in `queue:next:{c}:{d}:{date}`, the one deliberate
override of token order. It is a Redis **list**, head first: promoting a
patient `LREM`s then `LPUSH`es them, so each promotion moves one patient to the
front and pushes everyone else down exactly one place. Nobody is swapped, and
an earlier promotion is not undone by a later one — it just drops a place.

It was a single key holding a single id, which meant a second promotion
overwrote the first: that patient did not move down one, they fell all the way
back to their token position, and reception watched a queue they had ordered
rearrange itself. Entering the room now removes only that patient from the list
(`LREM`), where it used to `DEL` the key and discard the order of everybody
still waiting.

Ids that no longer match a waiting patient (called in, held, completed since)
drop out silently wherever they sit in the list, so nothing has to clean up.

The room used to be the deciding factor: with nobody in, reception's press
went straight to `putInRoom`. That gave the front desk one button with two
outcomes, selected by a state that could change between reading the card and
pressing it — and it let reception assert a patient was *with the doctor*
before the doctor had seen them. The card matched, labelling the same button
"Call Next" or "Set as Next" depending on the room, which read as two features.
There is now one label, **Set as Next**, and one meaning: move this patient to
the front of the queue. It is disabled for a patient already at the front,
matching the `‹` arrow, which greys out on the same condition.

### Reception cannot take a patient out of the room

`hold` and `skip` both refuse an appointment that is `Confirmed`. Hold answers
"this person is not available right now", which cannot be true of someone
sitting in front of the doctor, and reception has no way to know a consultation
should stop. An earlier version demoted them to `Patient Arrived` and parked
them — from the front desk, that silently pulled a live consultation off the
doctor's screen, and the doctor's board showed the patient as *on hold* while
they were still in the room.

There are exactly two ways out of the room, and both are explicit:

- the **doctor completes** (`PUT /appointments/:id` → `Completed`), or
- the **doctor sends the next patient in** (`send-in` as Doctor/Admin), which
  returns the previous occupant to the waiting list — a deliberate "the queue
  moved on". Reception's `send-in` cannot do this; it only reorders.

The frontend follows the same rule rather than relying on the 409: reception's
Set as Next / Hold / Skip controls all target `next[0]`, never `currentPatient`.

The one remaining path from the front desk into the room is `skip`, which
parks a patient and — only when the room is already free — sends the next one
in. It is left as-is: the advance is the whole point of skip, and unlike
`send-in` it cannot interrupt anybody.

### A doctor confirming takes the room

`Confirmed` no longer *means* "with the doctor" — the room is a pointer — but a
doctor setting that status is still saying "I am seeing this patient now". So
when a **Doctor or Admin** confirms an appointment through
`PUT /appointments/:id`, the queue moves with it: the pointer goes to that
appointment, any hold on them is cleared, and whoever the doctor was with is
**parked**.

Two reasons that matters. Without it, a doctor who confirms from the
appointment page rather than the queue card changes nothing on the board, and
reception keeps seeing the previous patient as the one being seen. And parking
the displaced patient — rather than returning them to the waiting list — keeps
the fact that their consultation was interrupted, instead of quietly putting
them back in line to be called again.

Reception is excluded on purpose: confirming a booking is a statement about the
booking, not about who is in the room, and moving the room from the front desk
is what this rule exists to prevent.

### Arriving clears a hold

A check-in (`→ Patient Arrived`) clears any hold on that appointment, in
`AppointmentService` before the realtime signal goes out. "On hold" means *not
available right now*; walking in is the direct contradiction. `sendIn` clears
it for the same reason.

This also closes a trap that made the two actions look like one. `buildBoard`
reads the held set **only** for `Patient Arrived` rows, so a hold set while the
patient was still `not_arrived` sat invisible — and then fired the instant
reception checked them in, putting the patient straight into On hold instead of
the waiting list. Holding a patient who has not arrived is now refused (below),
but flags written before that rule are still in Redis for up to 36h, and this
clears them on the way through.

### Every action needs an arrival

`send-in`, `hold` and `skip` all reject a patient who is not `Patient Arrived`.
For send-in that was always true. For hold and skip it is enforced because
`buildBoard` reads the held set **only** for `Patient Arrived` rows:

```ts
if (row.appointmentStatus === ARRIVED) {
  if (heldIds.has(row.id)) onHold.push(...)   // the flag is read here
  else available.push(...)
  continue;
}
notArrived.push(...)                          // ...and nowhere else
```

Holding someone who had not checked in therefore wrote a flag nothing consults:
the request succeeded, the rebuilt board came back identical, and the screen
showed a success message for a hold that had not happened. Skip compounded it —
it also promoted nobody, because `nextPatient` is null when no one has arrived.

The reception card mirrors the rule instead of relying on the 409, and — more
usefully — offers the step that *is* possible. `queueActionTarget()` is the one
place that decides who an action applies to: check-in wants a patient who has
not arrived, everything else wants one who has. When nobody has arrived, the
card drops the Call/Hold/Skip row entirely and shows a single
**"Check in {name}"**, because three disabled buttons and a message pointing
elsewhere is a dead end, not a state. Rows in the waiting list that have not
arrived are tagged `not in`.

Check-in is therefore a queue action (`QueueAction = "checkin" | "call" |
"hold" | "skip" | "urgent"`), routed to the same appointment-status update the
Today's Appointments row uses.

### Hold vs skip

They write to the same place — a Redis flag on a checked-in patient — and
leave that patient in exactly the same state: `Patient Arrived`, in `onHold`,
one Resume from their place in token order. Only the **reason** differs, and it
is stored with the flag (`queue:hold:{c}:{d}:{date}` is a hash, id → `held` |
`skipped`) precisely because the end state cannot tell them apart: reception
parked two patients by two different routes and the list showed one thing.
Both boards render it as a per-row `on hold` / `skipped` tag under a
**Paused** heading.

The difference is what happens to *the rest of the queue*:

| | Hold | Skip |
|---|---|---|
| The named patient | parked, tagged `on hold` | parked, tagged `skipped` |
| The queue | stops where it is | the next patient goes in — **only if the room is free** |
| Means | "not available right now" | "didn't answer when called; keep moving" |
| Doctor mid-consultation | no effect on the room | no advance — so it does what Hold does. The button stays on screen; its tooltip says so |

So skip is hold plus one Call Next, folded into a single action and a single
signal, because reception clicks it *when the queue should keep moving* and a
second click at that moment is a second chance to get it wrong.

The "only if the room is free" clause matters: `putInRoom` returns whoever is
`Confirmed` to the waiting list, so advancing unconditionally would end a live
consultation from the front desk — via a button aimed at a completely different
patient. Same rule as the 409s above: only the doctor ends a consultation.

### Why skip is a hold, not a status

The patient who didn't answer is almost always still in the building, so the
honest reading is "not available right now" — which is exactly a hold. Marking
them `NoShow` is terminal and fires the penalty rules on someone who stepped
out for two minutes. The advance half is what separates Skip from Hold:
reception clicks Skip *because the queue should keep moving*, so the next
patient goes in without a second click.

## The flow, end to end

```
 booked ──check in──▶ waiting ──call next──▶ with doctor ──complete──▶ done
                        ▲   │                     │
                        │   └──hold──▶ on hold ◀──┘ (hold the current patient
                        └────resume────┘             frees the room)

 skip = hold this one  +  send the next one in, as one action
```

| Step | Receptionist | Doctor |
|---|---|---|
| Check in | "Check in" on the Today's Appointments row, or on the queue card when nobody has arrived | — |
| Call next | "Call Next" on the queue card | "Start with …" on their own board |
| Hold / Skip | Hold and Skip on the queue card | — |
| Resume | On Hold panel | On hold strip on their board |
| Complete | — | "Complete" on their board |

Call Next is one step, deliberately: it *is* send-in. There is no separate
"called but not yet in the room" state, because that would need a second flag
and a second click at the busiest moment of the day.

## Realtime

Queue writes signal through `realtimeBus` — see `REALTIME_SIGNAL_CONTRACT.md`
for the client rules. Every action emits to two sections:

```ts
realtimeBus.notify(target.queue(clinicId, doctorId, date), reason);
realtimeBus.notify(target.board(clinicId), reason);
```

The doctor's screen watches `queue:{clinic}:{doctor}:{date}`; the reception
board watches `board:{clinic}`. Signals carry no state — the client refetches
the board above, which is what keeps the two screens identical rather than
merely similar.

Skip emits **one** signal for the whole action, not one per half: parking and
promoting are a single move to everyone watching, and two signals would make
both screens refetch twice to land on the same board.

Reasons emitted: `queue.patient_sent_in`, `queue.patient_held`,
`queue.patient_skipped`, `queue.patient_resumed`. They are for logs — never
branch on them.

## Frontend

| Screen | File | Reads |
|---|---|---|
| Reception board | `InfinityMedisetuWeb_FE/src/pages/dashboard/receptionistDash/components/LiveDoctorQueueCard.tsx` | `/reception/live-queue` (composed) |
| Doctor's day + queue | `.../doctorDash/components/StartYourDayCard.tsx` | `/queue/board?doctorId=` |
| Appointment timeline | `.../pages/appointment/components/timeline/AppointmentTimelineContainer.tsx` | `/queue/board?doctorId=` + `/queue/state` |
| API slices | `.../src/redux/api/queueApi.ts`, `appointmentApi.ts` | |
| Signal hook | `.../src/hooks/useSectionSync.ts` | |

### Three screens, one board

All three render the same queue, so all three must read `position`, `nextPatient`
and `onHold` **from the board**. Deriving any of them from appointment rows
looks like it works and then disagrees the moment someone is held, skipped or
promoted, because none of those states exists on an appointment row.

The timeline learned this the hard way. It derived "next up" as
`waitingPatients[0]` after filtering on status, and ordered its rail by
scheduled time. Both are wrong in the same way:

- a **held** patient keeps a waiting status, so the rail named someone the other
  two screens had parked;
- **"Set as Next"** reorders the board and nothing else, so the rail's `#1`/`#2`
  were the reverse of reception's for the same two patients.

If a screen shows the queue, it reads the board. The only thing a client should
compute for itself is presentation.

`receptionQueue.ts` is now a pass-through plus the doctor-roster join
(`accountStatus`, which belongs to the roster and not the queue) and the
table's tab filter. The functions that merged two boards, matched slot strings
back to appointment rows and chose action targets — `resolveQueueBoards`,
`buildAppointmentLookup`, `queueActionTarget` — were deleted, not moved: the
server answers all of it.

## Running late

`RunningLateControl` on the reception card is shown only when patients are
booked for that doctor and **none of them has arrived** — the announcement
tells people who have not set off yet to come later, which is worthless once
they are already sitting in reception. It is hidden with an empty book
(nobody to tell) and during a consultation (nothing to announce).

Note for anyone reading the code: `Confirmed` in this module means *with the
doctor*, not "the booking is confirmed". A rule phrased as "hide it once an
appointment is confirmed" means "hide it once someone is in the room", which is
a narrower condition than the one above.

## Still open

- **Urgent** has no backend behaviour. The reception card renders it and says
  so rather than silently doing nothing.
- **Consultation timing is Redis-only.** Both ends are now recorded —
  `setConsultationStartedAt` on send-in, `setConsultationEndedAt` when the room
  changes hands or the appointment completes — which is what lets the board show
  real elapsed time and lets `DelayTrackerService` move a projection *earlier*
  when a doctor finishes ahead of a slot.

  Both keys are one per *doctor-day*, so the next patient overwrites them and
  nothing survives a flush. The durable record is the activity history
  (`CONFIRMED` → `COMPLETED`), which `ConsultationDurationService` reads for its
  learned medians. Redis is the live read; history is the archive. Anything
  needing per-appointment durations after the fact must use the history, not
  these keys.
- **The composed board builds one `QueueService.getBoard()` per doctor on the
  roster** — two queries each, plus a Redis read. Fine for a normal clinic, but
  it is rebuilt on every queue action by
  `QueueBroadcastService.emitReceptionLiveQueueUpdated`. `REALTIME_SIGNAL_CONTRACT.md`
  already flags that rebuild-and-push for deletion once every consumer reads
  through the signal contract; that matters more now the board is richer. The
  fix when it is needed is a batched multi-doctor read inside `QueueService`,
  not another board builder.
