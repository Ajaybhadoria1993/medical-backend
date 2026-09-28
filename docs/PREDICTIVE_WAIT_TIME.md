# Predictive Waiting Time & Tentative Appointment Times

Plan of record. All five steps are built.

## Where the estimate comes from today

`DelayTrackerService.recalculate` walks a doctor's day in order and projects
each appointment's start as `max(scheduled, previous projected end)`, so a
delay at the front cascades to everyone behind. That already covers most of the
checklist:

| Requirement | Status |
|---|---|
| Calculate from current token | ✅ token slots derived from session start |
| Consider patients ahead | ✅ the `previousProjectedEnd` cascade |
| Consider upcoming appointments | ✅ the whole day's queue is walked |
| Consider average consultation duration | ✅ **step 2, below** |
| Consider doctor delays | ✅ derived, plus [RUNNING_LATE_OVERRIDE.md](./RUNNING_LATE_OVERRIDE.md) |
| Consider doctor **breaks** | ✅ **step 3, below** |
| Update prediction dynamically | ✅ **step 1, below** |

---

## Step 1 — The queue tick ✅ built

**The problem.** The engine was entirely event-driven: it recalculated on a
status change, on a patient opening their screen, or from the per-appointment
running-late job (which fires only while the doctor is inactive, repeats every
15 minutes, and caps at 12 attempts). But the dominant input to a waiting-time
estimate is the wall clock, and the clock produces no events. Between two status
changes a patient's "18 minutes" stayed frozen while 18 real minutes passed.

**The fix.** `src/cron/jobs/queueTick.cron.ts` runs every minute and calls
`QueueTickService.tick()`, which:

1. Finds distinct `(clinicId, doctorId)` with a non-terminal appointment today —
   the status filter is in SQL, so a finished day is never fetched.
2. Recalculates each doctor's projection.
3. **Broadcasts only if it changed.**

### Change detection is the point

Recalculating is one indexed query. *Broadcasting* fans out to every patient's
socket room, so an unconditional tick would push identical payloads to every
patient in every clinic once a minute. Each projection is therefore
fingerprinted:

```
bucket(cumulativeDelay) # appointmentId|status|bucket(projectedStart)|bucket(wait) ; …
```

stored at `appointment_engine:tick_fingerprint:{clinicId}:{doctorId}:{date}`.
Equal fingerprint → no emit. A quiet clinic costs one query per doctor per
minute and zero sockets.

`lastCalculatedAt` is deliberately **excluded** — it changes on every
recalculation, so including it would make every fingerprint unique and defeat
the mechanism entirely. Covered by `queueTick.service.test.ts`.

### Other properties worth knowing

- **Overlap guard.** A tick still running when the next fires is skipped, so a
  slow pass can't stack unbounded concurrent DB work behind it.
- **Sequential, not parallel.** Doctors are refreshed one at a time; this is
  background work with nobody waiting on it, and it should not compete with live
  requests for the connection pool.
- **Running-late is evaluated before the listener gate**, so a threshold crossed
  by the passage of time alone still notifies a patient whose app is closed.
- **Never throws.** A failing doctor is logged and the pass continues.
- **Logs only when something happened** (a broadcast, or a pass over 5s), so it
  doesn't fill the log with a line a minute.


### What a tick actually costs

The cron fires every 60 seconds **unconditionally**. The broadcast is
conditional; the recalculation is not.

| | queries |
|---|---|
| `findActiveDoctors` | 1, always |
| `recalculate`, per active doctor | 1 warm (up to 6 on a cold cache) |
| reception board rebuild | ~3, once per clinic that changed |

A recalculation is one indexed query warm — `resolveDayConfig` (1h),
`consult_duration` (10m) and the running-late override (24h) are all Redis-cached
and contribute nothing in the steady state.

### Three things keep it from scaling badly

**Listener gate.** With nobody connected — no clinic dashboard, no patient in a
live-queue room — the broadcast is skipped entirely. The socket fan-out and the
board rebuild are the expensive part of a tick, far more than the recalculation,
and there is nobody to receive them. Anyone connecting later gets a fresh
projection from `computeLiveQueuePayload`, which never trusts the cache.

The check uses `fetchSockets`, which is cluster-aware through the Redis adapter;
a local room check would see only this instance's connections and skip clinics
being watched from another. It **fails open**: if the socket layer cannot be
reached the tick broadcasts anyway, because a wasted emit costs nothing and a
queue that silently stops updating is the failure this service exists to prevent.

**Running-late is evaluated *before* the gate, deliberately.** The
per-appointment BullMQ running-late job is only ever scheduled when a patient
opens their live-queue screen, so for a queue nobody is watching this tick is the
only thing that will notice a doctor crossing the threshold. A push has to reach
a patient whether or not their app is open, so this cannot be skipped to save
work — the gate skips the *broadcast*, never the *notification*.

**Five-minute buckets.** Once the overrun fix pinned every waiting patient's
projected start to "now", those values moved by one minute on every tick, so the
fingerprint changed every minute for every late doctor — exactly the case the
change detection was meant to help with. The comparison now happens in
five-minute buckets while the payload keeps the exact minute. Statuses are still
compared exactly, so "you're next" lands the moment it is true.

**One board per clinic per pass.** The reception board is clinic-scoped, so five
doctors changing used to rebuild the identical board five times a minute. The
tick collects the clinics that changed and rebuilds each once, via
`emitQueueUpdated(..., { skipBoard: true })` plus a single `emitReceptionBoard`.

### Rough shape, five doctors all running late

| | queries/min |
|---|---|
| no gate, no buckets, per-doctor board | ~21 |
| with buckets + board coalescing | ~7 |
| nobody watching | ~6 (recalculation only, no broadcast) |


### Multi-instance deployments

The tick assumes **one owner**. Running several app instances against one
database means several ticks; they are idempotent (the fingerprint makes the
losers no-op) but they duplicate the DB work. Set `QUEUE_TICK_ENABLED=false` on
all but one instance.

---


## Overrunning consultations

**The bug.** While a doctor was mid-consultation, `isAnyoneBeingServed` was
true, which skipped the clock-based branch entirely and built the projection
from scheduled times alone. A doctor still on the 13:00 patient at 15:46
produced a timeline of `13:00 → 13:30 → 14:00 → …`, so every waiting patient was
told:

- `delayMinutes: 0`
- `isRunningLate: false`
- a `minutesUntilSeen` that assumed four consultations would clear in fourteen
  minutes

The clock branch only ran when **nobody** was being served — precisely the case
where a delay is least visible in the data, and most obvious to everyone sitting
in the waiting room.

**Two invariants now hold.**

*Nobody still waiting is projected into the past.* `projectedStart ≥ now` for
every non-`Confirmed` appointment.

*A consultation in progress ends no earlier than now.* The patient is
demonstrably still in the room, so a projected end already in the past is a fact
we can see is wrong. Everyone behind cascades from that floor, which is what
makes an overrun visible to the rest of the queue.

The patient *in* the room is excluded from the first rule — their start really
is in the past, which is what "in consultation" means.

**Consequence for the tick.** Every waiting patient's projected start is now
pinned to "now" while a doctor is behind, so those values move every minute.
That is what made the five-minute fingerprint buckets necessary — before this
fix, an overrunning doctor produced a frozen projection, and the change
detection looked efficient only because the numbers were wrong.

Covered by `overrunningConsultation.test.ts`, including that an on-schedule
queue still reports zero delay — the guard must not invent lateness for a doctor
running to time.


---

## Step 2 — Learned consultation duration ✅ built

**The problem.** The engine projected wait times from the appointment's *slot
length*, which is a booking-grid artefact rather than a measurement. A clinic
that books everyone into 30-minute slots but averages 12 minutes per patient
produced estimates that were wrong all day, in the same direction, for every
patient — and no amount of ticking (step 1) fixes a wrong duration.

Two separate things were conflated, and both now exist:

**Config** — `clinic_settings.defaultConsultationMinutes`, one column, per the
settings-vs-events split in [RUNNING_LATE_OVERRIDE.md](./RUNNING_LATE_OVERRIDE.md).

**Learned, per doctor** — the gap between the `Confirmed` and `Completed` rows
in `appointment_activity_history` *is* the real consultation length, already
recorded. No new table: derived data, cached in Redis.

```
baseline = median of this doctor's last 30 days
todayMed = median of this doctor's completed consultations today
weight   = nToday / (nToday + 8)
duration = round(baseline * (1 - weight) + todayMed * weight)
```

Pure baseline at the start of the day, converging on today's actual pace as the
day proves it. No cliff, no single-sample whiplash.

**Median, not mean** — one outlier must not move it.

**Trim junk samples first; this matters more than the formula.** A
`Confirmed → Completed` gap is only a real consultation if someone marked
Completed promptly. Staff forget and close everything at 6pm, producing
four-hour "consultations". Discard samples outside 2–180 minutes and clamp the
result to 5–90. Without this, learned durations are worse than the current
slot-size guess.

**Configured, per doctor — not per clinic.** Consultation length is a property
of the doctor: a GP and a surgeon in the same building are nothing alike, so
one clinic-wide number is wrong for at least one of them. The configured value
lives on `clinic_assign` (one row per doctor per clinic, beside the existing
per-doctor booking settings), which also lets a doctor carry a different length
at each clinic they work at. `clinic_settings.default_consultation_minutes`
remains as a clinic-wide baseline for doctors with nothing of their own.

Resolution chain, strictly most-specific first:

| # | source | scope |
|---|---|---|
| 1 | the appointment's own duration | this appointment |
| 2 | learned median (≥10 samples) | this doctor |
| 3 | `clinic_assign.default_consultation_minutes` | this doctor at this clinic |
| 4 | `ClinicAvailability.slotMinutes` | this doctor's booking grid |
| 5 | `clinic_settings.default_consultation_minutes` | the whole clinic |
| 6 | 30 | — |

Note that the clinic-wide default sits **below** the slot size. The slot comes
from this doctor's own availability row, so it is still a statement about this
doctor; a clinic-wide number is not. An earlier version had these the other way
round, which let one building-wide figure override a slot length someone had
deliberately set for that doctor.

Published as `consultationBasis: "learned" | "doctor" | "clinic" | "slot" |
"default"` on the patient payload, carried on `QueueDelayData` so every
consumer reports the same basis without re-deriving it. A surprising estimate
can then be explained rather than guessed at.

### The nominal schedule deliberately does *not* use it

`computeTokenScheduledMinutes` still resolves on slot size alone. It derives a
token appointment's *nominal* slot — the position the clinic effectively
promised when it issued the token — and wait time is `projected - scheduled`.
Letting learned data move the scheduled side too would measure the projection
against a baseline shifting underneath it, and a doctor speeding up would show
no improvement at all. Learned duration belongs to the projection only.

### Caching

`appointment_engine:consult_duration:{doctorId}:{date}`, 10-minute TTL, holding
the resolved `{minutes, basis, sampleSize}`. Short on purpose: the value is
meant to track *this session's* pace, so caching it for hours would defeat the
blend — but recomputing per recalculation would run an aggregate query every
minute per doctor now that the tick exists. Resolved once per queue, not per
appointment.

### Operational caveat — clinics that skip "Confirmed"

The learned value is derived from the `CONFIRMED → COMPLETED` gap in
`appointment_activity_history`. An appointment moved straight from `Upcoming` to
`Completed` never writes a `CONFIRMED` row, so it produces no sample and is
excluded. A clinic whose staff skip the confirm step will never accumulate the
10 samples needed and will silently stay on `configured` or `slot` — which is
correct behaviour, but reads as "the feature isn't working". Check
`consultationBasis` and `sampleSize` before assuming a bug.

## Step 3 — Breaks in the projection ✅ built

**The problem.** `resolveDayConfig` returned only `slotMinutes` and
`sessionStartMinutes`. `ClinicAvailabilityBreak` and the inline
`breaksStart`/`breaksEnd` pair on `ClinicAvailability` existed in the schema and
were never read, so a queue projected straight through lunch.

**Two break sources**, both legitimate and both loaded: the single inline window
on the availability row, and any number of typed `clinic_availability_break`
rows (inactive ones skipped). They commonly describe the *same* lunch break, so
`normalizeBreaks` drops incomplete/inverted windows, sorts, and merges overlaps
rather than counting one break twice.

The weekly availability row is now fetched **unconditionally** rather than only
as a fallback — breaks hang off it, so short-circuiting when slot size and
session start were already known would silently lose every break. The whole
result is cached for an hour, so this is one extra round trip per doctor per
hour, not per recalculation.

### Breaks move BOTH sides of the calculation

This is the part worth understanding, and it differs from how learned duration
is treated.

Wait time is `projected - scheduled`. The projection steps over lunch. If the
*nominal* token schedule did not, every afternoon token would report the entire
lunch break as delay — a 60-minute lunch would show every patient as an hour
late and fire running-late notifications at all of them, while the doctor was
perfectly on time.

So unlike consultation pace, a break **is** part of the nominal schedule:
`computeTokenScheduledMinutes` skips breaks too. A break is a structural gap in
the clinic's own grid — it never promised a token slot during lunch. Pace is
not; see "The nominal schedule deliberately does not use it" above. Both
behaviours are pinned by `breaks.test.ts`.

### Only the start is shifted

A consultation beginning ten minutes before lunch and overrunning into it is
**not** pushed. In a real clinic the doctor finishes the patient in front of
them and lunch is what gets shortened; modelling that as "you are moved to after
lunch" would be both wrong and alarming. Only a start that lands *inside* a
break moves, to that break's end — and it walks the list, since the end of one
break can fall inside the next.

`shiftPastBreaks` tolerates a missing break list, so a day-config cache entry
written before this existed projects exactly as it did before rather than
throwing.

## Step 4 — Tentative time in the payload ✅ built

`projectedStartTime` was computed on every recalculation and never exposed to
patients, who only ever saw `estimatedWaitMinutes` — a duration, which they then
had to add to the current time themselves. The payload now carries the clock
time directly:

```jsonc
{
  "tentativeStartTime": "13:45",
  "tentativeRangeMinutes": 20,
  "isTentative": true,
  "consultationBasis": "learned"
}
```

### The band is the honest part

A single projected time is not equally reliable for everyone in the queue. The
patient who is next is nearly certain; one six places back depends on six
consultations that have not happened yet, each free to run over. Publishing
"13:45" with identical confidence in both cases invites a complaint every time
the queue moves.

So the band widens with the queue ahead:

```
range = min(60, round(5 + patientsAhead * consultationMinutes * 0.25))
```

A fixed floor for the irreducible uncertainty of any prediction, plus a share of
one consultation for each patient in between, capped — past a point "give or
take five hours" stops being information. With 20-minute consultations that is
±5 minutes for the next patient and ±25 for the fifth.

This is a legibility device, not a statistical interval. It exists so the UI can
say "around 1:45, give or take 20 minutes" instead of implying a booked slot.

### `isTentative` is explicit on purpose

It is redundant — it is true exactly when `tentativeStartTime` is present — and
carried anyway, so a client cannot render the time as a commitment *by
omission*. A prediction from a queue that is still moving must be labelled as
one, and the flag makes that impossible to forget rather than merely
documented.

A terminal appointment gets `null` and `false`: there is nothing left to
predict for a completed or cancelled visit. Both invariants are pinned by
`tentativeTime.test.ts` — including that the flag is never true without a time.

## Step 5 — Clients ✅ built

**Patient portal** (`PatientAppointment.tsx`) — a `TentativeTimeBadge` beside the
existing wait badge, reading "Estimated ~2:30 PM (± 20 min)". Both are shown:
the duration answers "how long" and the clock time answers "when", and patients
read the second far faster than they convert the first themselves.

`usePatientAppointmentRealtime` carries the projection as a single `tentative`
object rather than three loose fields, so a consumer cannot show the time while
dropping the caveat. It is populated only when the server sends `isTentative`
with a time — an appointment that has become terminal sends neither, and the
card then stops predicting instead of freezing on its last guess.

**Clinic appointment screen** (`QueueStatusBar`) — each up-next entry shows
`~HH:MM` next to its booked slot. The tilde is load-bearing: two clock times
side by side with no distinction read as a contradiction rather than as slot vs
projection. The tooltip spells out "estimated".

### Two bugs this surfaced

Rendering the projection exposed the fact that it was never actually reaching
the clinic dashboard live:

1. `emitQueueUpdated` omitted `projectedStartTime` from the `queue.updated`
   payload, even though it changes on every recalculation exactly like the wait
   estimate beside it.
2. `queueSlice.updateQueueFromSocket` merged it as a REST-only field
   (`existing ?? socket`), so even once sent, the value from page load would
   have won forever.

Either alone would have pinned every dashboard to whatever was true when the
page opened — defeating the queue tick from step 1 entirely, and invisibly,
since a stale time still looks like a time. The socket value now wins for
`projectedStartTime`; the genuinely static fields beside it (`tokenNo`,
`durationMinutes`, `patientId`) still prefer the REST value.

See [APPOINTMENT_ENGINE_TEST_SCENARIOS.md](./APPOINTMENT_ENGINE_TEST_SCENARIOS.md) for end-to-end verification scenarios.

## Files

| file | role |
|---|---|
| `appointment-engine/services/queueTick.service.ts` | the tick + change detection |
| `appointment-engine/services/queueTick.service.test.ts` | fingerprint + overlap guard |
| `cron/jobs/queueTick.cron.ts` | every-minute schedule, `QUEUE_TICK_ENABLED` |
| `cron/index.ts` | registration |
| `appointment-engine/services/consultationDuration.service.ts` | learned median + blend |
| `appointment-engine/services/consultationDuration.test.ts` | blend + resolution chain |
| `appointment-engine/utils/helpers.ts` | `resolveAppointmentDuration` chain |
| `clinic/models/clinicSettings.model.ts` | `defaultConsultationMinutes` column |
| `appointment-engine/utils/helpers.ts` | `normalizeBreaks` / `shiftPastBreaks` |
| `appointment-engine/services/breaks.test.ts` | break windows + the token regression |
| `appointment-engine/services/liveQueueHelper.ts` | tentative time + confidence band |
| `appointment-engine/services/tentativeTime.test.ts` | band growth + isTentative invariants |
| `appointment-engine/services/overrunningConsultation.test.ts` | the overrun invariants |
| `appointment-engine/utils/timeFormat.test.ts` | published time formats |
