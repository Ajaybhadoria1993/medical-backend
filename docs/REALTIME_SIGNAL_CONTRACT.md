# Realtime Signal Contract

Backend ↔ frontend contract for system-wide realtime sync.

The backend engine lives in `src/main/realtime/` and is **self-contained** — no
existing feature module was modified to add it. This document is what the
frontend needs to build against.

## The model

The socket carries a **signal**, never state:

```jsonc
// event name: "realtime.section.changed"
{
  "section": "queue:clinic-7:doctor-3:2026-08-21",
  "v": 42,
  "reason": "appointment.completed",
  "at": "2026-08-21T10:22:31.000Z"
}
```

About 120 bytes. It contains no appointments, no patients, no statuses — only
the fact that a named slice of state moved, and which version it moved to.

On receiving one, the client refetches that section's existing REST snapshot.
The snapshot stays the single source of truth, so two screens reading the same
section cannot disagree, and a socket payload can never drift from what the
endpoint returns.

`reason` is for logs and debugging. **Never branch on it.**

## Sections

A *section* names a slice of state a screen can be looking at.

| Section | Emitted to room | Snapshot endpoint (unchanged) |
|---|---|---|
| `queue:{clinicId}:{doctorId}:{date}` | `clinic:{c}:doctor:{d}` | `GET /api/v1/appointments/queue-state` |
| `board:{clinicId}` | `clinic:{c}` | `GET /api/v1/appointments/reception/live-queue` |
| `appointment:{appointmentId}` | `user:{patientId}` | the patient's own appointment query |
| `encounter:{appointmentId}` | `clinic:{c}:doctor:{d}` | the appointment's clinical/vitals fields — `GET /api/v1/appointments/:id` |
| `billing:{clinicId}` | `clinic:{c}` | whichever payment/billing list endpoint the screen uses |
| `lab:{labId}` | `lab:{labId}` | the lab worklist endpoint (`getLabAppointmentTests` / patient-grouped variant) |
| `staff:{clinicId}` | `clinic:{c}` | the staff directory endpoint |

The snapshot column names the *original* endpoint per section, not the only one.
`queue:` now also carries `GET /appointments/queue/board` and the schedule a
day view is drawn from, because a client watching that section renders all of
it — see client rule 8.

### What emits on `queue:`

| Emitter | Reason | Triggered by |
|---|---|---|
| `QueueService` | queue actions | send-in, hold, skip, resume, set-as-next |
| `DoctorArrivalService.signal` | `doctor.arrived` | marking the doctor in |
| `SlotConfigService.setSlotConfig` | `slot.config.changed` | changing a session's slot length or count |
| `DoctorServices.updateUser` | `schedule.changed` | editing weekly availability or breaks |

The last two are recent. Before them a schedule edit changed the shape of every
open day view — working hours, which slots exist, where the breaks fall — and
nothing told those screens, so they kept drawing the old grid until a manual
reload while arrival and delay had signalled all along. Both fire
fire-and-forget after the write, matching `DoctorArrivalService.signal`: a
signalling failure must never fail a schedule edit that is already saved.

`DoctorServices.updateUser` signals **today's** queue section. A weekly
availability edit has no single date — it changes every matching weekday — and
today is the day open timelines are showing; a future date re-reads when next
opened, since its cache is invalidated anyway. It uses `getISTDateString()`,
not a UTC-derived date, for the reason in client rule 9.

Section ids are built in `src/main/realtime/utils/sections.ts`. Adding a section
for another feature means adding it there, not changing that feature's
endpoint. See `docs/REALTIME_ROLLOUT_PLAN.md` for the full history of which
phase added which section and why, and `docs/REALTIME_INTEGRATION_GUIDE.md`
for a build-against-this-directly reference aimed at a new client (mobile).

## The one new endpoint

Versioning is served by the realtime module itself, so **no existing endpoint
changed shape**. The queue-state and live-queue responses return exactly what
they always returned.

### `GET /api/v1/realtime/versions`

**Auth:** `requireAuth`
**Query:** `sections` — comma-separated section ids, max 20

```
GET /api/v1/realtime/versions?sections=queue:clinic-7:doctor-3:2026-08-21,board:clinic-7
```

```jsonc
{
  "success": true,
  "message": "Realtime versions fetched successfully",
  "data": {
    "versions": [
      { "section": "queue:clinic-7:doctor-3:2026-08-21", "v": 42 },
      { "section": "board:clinic-7", "v": 17 }
    ],
    "at": "2026-08-21T10:22:31.000Z"
  }
}
```

A section nothing has changed yet reports `v: 0`. That is a real version, not
an absence — store and compare it like any other.

**When to call it:** on mount and on reconnect, in parallel with the snapshot
fetch. Never on the steady-state path — every subsequent version arrives on the
signal itself.

## Client rules

**1. Record the version your data came from.** From `/realtime/versions` on
mount, then from each signal you act on.

**2. On a signal, compare — then refetch or ignore.**

```
signal.v === localV   →  already current. Ignore. No request.
signal.v !== localV   →  refetch that section's snapshot once, and set
                         localV = signal.v
```

The comparison is **inequality, not "greater than"**. This matters: a counter
that expires or is lost to a Redis flush restarts low, and under a
greater-than rule a client holding the old high number would ignore every
subsequent signal forever. Inequality self-heals. The cost is one extra
refetch when a signal arrives out of order, which just re-reads current truth.

**3. Debounce ~250 ms, trailing.** A burst — the queue tick moving several
doctors at once — must collapse into one request, not five.

**4. Ignore signals while the page is hidden.** Check
`document.visibilityState === 'visible'`. Refetch on focus instead.

> Both halves, or neither. A client that drops signals while hidden and does
> **not** refetch on return is worse than one that ignores this rule entirely:
> it goes stale silently and stays stale for the life of the tab. This is what
> a doctor's dashboard did while reception moved the queue in another
> window — every signal discarded, nothing to trigger a re-read on return, a
> board still showing patients as held long after they had been resumed.
> `useSectionSync` now records that it skipped a signal and resyncs on
> `visibilitychange`, gated on having actually missed one.

**5. Refetch once on mount and once on reconnect.** The two moments you are
guaranteed to be behind.

**6. Never show a spinner on a signal-driven refetch.** Keep the current rows
on screen and swap them when the response lands. A receptionist reading a
queue must not have it blink.

**7. Never reload the page.** A doctor may be mid-prescription.

**8. Invalidate every cache the section feeds, not just the obvious one.**
Subscribing to a section and then invalidating an incomplete set is the
failure mode that looks like realtime working: some of the screen updates, the
rest silently goes stale, and it is only noticed when two screens disagree.

The appointment timeline subscribed to `queue:*` and invalidated
`DoctorArrival` and `SessionOverride` but not `QueueBoard`, so its rail
rebuilt only on mount — sitting on a stale order while the doctor and
reception dashboards, which do invalidate it, moved on. Same section, same
signal, different conclusions.

Before adding a `useSectionSync`, list what the screen renders from that
section and invalidate all of it. On the timeline that is:

| Tag | Feeds |
|---|---|
| `QueueBoard` | rail order, "next up", who is held |
| `DoctorArrival` | the arrival time and the running-late chip |
| `SessionOverride` | the declared delay |
| `SlotConfig` | slot length, which decides the grid's rows |
| `Doctor` (doctorApi) | weekly availability — working hours and breaks |

**9. Key `sectionIds.queue` on the backend's IST date, never the browser's.**
The channel name embeds the date the server published on, so a locally derived
one subscribes a client outside IST to a channel that never emits — signals
simply never arrive, with no error to notice. Take it from the response
(`queueBoard.date`) rather than computing it.

### Cost per situation, once implemented

| Situation | API calls |
|---|---|
| On page, one change | 1 |
| Five changes in one second | 1 |
| Signal matching local version | 0 |
| Off page or tab hidden | 0 |
| Return to page | 1 |
| Reconnect | 1 |
| Idle on page | 0 |

## Rooms

Joined automatically on socket connect, from the authenticated user. **The
client does not join these manually.**

| Room | Who is in it |
|---|---|
| `user:{id}` | that user *(pre-existing)* |
| `clinic:{c}` | everyone assigned to the clinic *(pre-existing)* |
| `clinic:{c}:role:{userType}` | everyone in the clinic with that role |
| `clinic:{c}:doctor:{d}` | that doctor, plus the clinic's Receptionists and Admins **assigned to them** (see below) |
| `lab:{labId}` | everyone in `UserLabAssignmentsModel` for that lab |

Doctor-room membership is cached 10 minutes, so a staff member added
mid-session is picked up within 10 minutes or immediately on their next
reconnect. Lab-room membership follows the same 10-minute cache.

**Role/permission scoping is enforced here, not by the client.** A
Receptionist or Admin no longer automatically joins every doctor's room —
`SocketManager.joinScopedRooms` calls `StaffScopeService.getAccessibleDoctorIds`
and joins only the doctors that staff member is actually assigned to (`null`
back from that call means unrestricted, e.g. Admin, or a receptionist never
explicitly scoped — that still joins every doctor). A client never filters
signals by permission itself; if a socket isn't in a room, it simply never
receives that room's signals. Room membership is fixed at connect time, so an
assignment changed mid-session takes effect on that socket's next reconnect.

## Two frontend defects to fix first

Both are independent of this contract and are the likely cause of the reported
"doctor and receptionist see different queues". Neither is a payload problem.

**1. The socket permanently gives up.** `src/services/socket.ts` sets
`reconnectionAttempts: 5` with `reconnectionDelay: 1000`, so after roughly five
seconds of network loss the client stops retrying forever. There is a
`disconnect` handler that only logs, and no `reconnect` handler anywhere. The
screen silently freezes and only a manual refresh recovers it. Set
`reconnectionAttempts: Infinity`, add `reconnectionDelayMax` and jitter.

**2. Stale cache is served on return to the page.** `getQueueState` in
`src/redux/api/appointmentApi.ts` sets `keepUnusedDataFor: 300` with no
`refetchOnMountOrArgChange`, which RTK Query defaults to `false` — so returning
to the queue within five minutes renders cached data and makes no network call.
The comment beside it ("socket events override this data anyway") is wrong:
socket handlers exist only while the hook is mounted, so nothing overrides it
off-page. Add `refetchOnMountOrArgChange: true` and `refetchOnReconnect: true`.

Also note Socket.IO does **not** restore room membership after a reconnect —
rooms must be explicitly re-joined, which is a second silent-staleness source.

## Migration is safe

The existing data-carrying events are **untouched and still emitted**:

- `queue.updated` → `clinic:{c}`
- `reception.liveQueue.updated` → `clinic:{c}`
- `appointment.updated` → `user:{id}` — **patient rooms only**, carrying the
  full live-queue payload (`QueueBroadcastService.emitPatientUpdated` →
  `buildPayloadFromQueue`). The old partial `{ appointmentId,
  estimatedWaitMinutes }` emitter was deleted 2026-09-25. Consumed by
  `usePatientAppointmentRealtime` on the patient's own screens.
- `timeToNext.updated` → `clinic:{c}`

Nothing about them changed, so screens keep working while the frontend
migrates one hook at a time.

### One correction, found while migrating

The frontend also had a `useAppointmentRealtime` hook on three **staff**
screens (appointment list, appointment details, doctor dashboard) listening for
`appointment.created` and `appointment.updated`. Neither could ever fire there:

- `appointment.created` **is not emitted as a socket event anywhere** in this
  backend. The string exists only as a signal `reason`.
- `appointment.updated` is emitted to `user:{patientId}` rooms, so a staff
  socket is not in the room unless the staff member is the patient.

So those screens had no working realtime path at all, and the symptom looked
like a queue bug: reception moved the board, and the list, the detail page and
the doctor's dashboard kept showing the previous status until a manual reload.
They now subscribe to sections, and the hook has been deleted. **No backend
change was needed or made** — there was nothing on this side to remove.

**Done — the board rebuild-and-push has been deleted.** Its last consumer was
the reception dashboard, which now re-reads
`GET /appointments/reception/live-queue` on a `board:{c}` signal. Removed with
it: `emitReceptionBoard`, the private `emitReceptionLiveQueueUpdated`, the
`skipBoard` option that existed only to stop it firing once per doctor, and
QueueTickService's per-clinic rebuild loop. A clinic with nobody watching now
costs nothing per queue action.

The remaining staff-facing events, `queue.updated` and `timeToNext.updated`,
**are still emitted but no longer consumed by this frontend**:
`useClinicQueueRealtime` now re-reads `GET /appointments/queue-state` on a
`queue:{c}:{d}:{date}` signal, which carries everything both pushes carried
(including `timeToNextMinutes`). They are cheap — the payload is built from
data the caller already holds — so they were left in place rather than removed
blind, in case another client (mobile, patient app) still listens. **Delete
them once that is confirmed.**

## Backend

### Module layout

```
src/main/realtime/
├── controllers/version.controller.ts
├── interfaces/index.ts                    RealtimeSignal, RealtimeTarget
├── routes/v1/realtime.route.ts            → /api/v1/realtime
├── schemas/realtime.schemas.ts
├── services/realtimeBus.service.ts        notify()
├── services/streamVersion.service.ts      INCR / read
├── utils/rooms.ts
├── utils/sections.ts
└── tests/
```

Three files outside the module were touched:

| File | Change |
|---|---|
| `src/app.ts` | one line attaching the bus to the live `io` instance |
| `src/socket/socketManager.ts` | joining the two new scoped rooms on connect |
| `src/main/appointments/services/appointment.service.ts` | the signal call sites below |

`src/main/appointment-engine/` was deliberately left untouched *by that work*.
It has since become the home of the queue itself — `QueueService`, the hold
store, `buildBoard` and the composed reception board all live there now, with
only the route file left behind in `appointments/` so the URLs do not move. See
`QUEUE_SYNCHRONIZATION.md`. The signal call sites are unchanged: the queue
signals through `realtimeBus` exactly as described above.

### Emitting a signal

**Live for appointments.** `AppointmentService` signals on every appointment
create, status change, reschedule, and prescription auto-complete. Three
signals go out per change — the doctor's queue, the reception board, and the
patient's own appointment — for zero database queries and three Redis `INCR`s.

| Trigger | `reason` sent |
|---|---|
| New booking | `appointment.created` |
| Status change | `appointment.completed`, `appointment.cancelled`, `appointment.patient_arrived`, … |
| Reschedule | `appointment.rescheduled` |
| Prescription auto-completes the appointment | `appointment.completed` |

A reschedule that moves an appointment to a **different day** signals both
days: the day it left is now short a slot, and its watchers have no other way
to find out.

Payments, lab and staff status now emit too — via `signalAppointmentChange`
(also fires `encounter` and `billing`) and `signalLabChange`
(`src/main/realtime/utils/`), shared helpers any service can call rather than
each duplicating the notify calls. Notifications remain out of scope — they
are already live over their own socket channel and are not being migrated
onto this bus. See `docs/REALTIME_ROLLOUT_PLAN.md` for the full per-feature
history.

```ts
import { realtimeBus, target } from '../../realtime';

// after the database write has committed
realtimeBus.notify(target.queue(clinicId, doctorId, date), 'appointment.completed');
```

Rules for anyone adding one:

- Call it from the **service layer**, after the write has committed — never
  before, or a client can refetch and read pre-commit state.
- Never from a controller: one controller can serve several write paths.
- Never put state in the signal. If a screen needs data, it has an endpoint.
- Do **not** route these through Kafka. The Socket.IO Redis adapter already
  fans out across nodes; double-pathing would emit every signal twice.
- Add new sections to `utils/sections.ts` rather than emitting a bare room
  name, so the section-to-room pairing stays in one place.
- `notify()` is fire-and-forget and never throws.

## Out of scope

The queue state machine is a separate phase. The `apointment_status` enum has
no `In Consultation`, `On Hold`, or `Skipped`, and there is no stored pointer
for who is currently with the doctor — so the target state *A completed, B on
hold, C with doctor* is not yet representable. That is a data-model gap, not a
transport one, and this work does not address it.

**Done.** Per-user permission filtering of signals (receptionist-to-doctor
assignment) is now enforced in `SocketManager.joinScopedRooms` via
`StaffScopeService.getAccessibleDoctorIds` — see the Rooms section above.
