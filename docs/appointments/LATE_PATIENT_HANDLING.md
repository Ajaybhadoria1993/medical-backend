# Late Patient Handling

What happens when a patient checks in after their slot.

## What it replaces

The old answer was implicit and binary. Inside the grace period, **nothing
happened at all** — the late patient slotted straight back into their original
position and everyone who arrived on time waited longer. Outside it, the
auto-no-show job marked them absent and the queue closed over them.

There was no way to admit a late patient while still protecting the people who
turned up on time, and nothing recorded *when* anyone actually arrived.

## A bug fixed along the way

The auto-no-show job's eligible statuses were
`['Upcoming', 'Confirmed', 'Pending']`. `Patient Arrived` was correctly
excluded — but **`Confirmed` was not**, and the engine treats `Confirmed` as
"the doctor is with this patient" (`delayTracker`'s `isAnyoneBeingServed`,
`receptionLiveQueue`'s `currentRunningEntry`).

So a patient physically in the consulting room could be auto-marked a no-show
the moment the grace period expired. `Confirmed` is no longer eligible. This is
the `Confirmed` overload — booking-confirmed vs in-consultation — surfacing
again; see the note at the end.

## Data model

**`appointments`** — two columns:

| column | meaning |
|---|---|
| `arrived_at` | when the patient checked in; set once, on first reaching `Patient Arrived` |
| `late_queue_demotion` | how many places they were moved back; `0` means untouched |

`appointmentTime` and `tokenNo` are deliberately **not** rewritten. They record
what the clinic promised, wait time is measured as `projected − scheduled`
against them, and overwriting them would both corrupt that figure and erase the
evidence that a demotion ever happened.

**`clinic_settings`** — the policy, per the settings-vs-events split:

| column | values |
|---|---|
| `late_patient_policy` | `keep_position` \| `move_back` \| `move_to_end` (default `move_back`) |
| `late_patient_move_positions` | places to move back, default 2 |

**Lateness itself is not configured here.** It is measured against
`no_show_policies.gracePeriodMinutes`, which already existed. One clinic
carrying two definitions of "late" is how the two drift apart.

## How it works

1. Status changes to `Patient Arrived` for the first time.
2. `arrivedAt` is stamped. The guard is `!existing.arrivedAt`, so re-saving the
   row later — a payment, a note — cannot re-stamp the arrival or re-apply the
   penalty.
3. **The pending auto-no-show job is cancelled.** This is what makes the whole
   feature possible: a patient standing at the desk is not a no-show, and
   without this the grace timer would still fire and mark them absent while they
   sat in the waiting room.
4. `LatePatientService.assess` compares `arrivedAt` to the scheduled time
   against the clinic's grace period, and maps the policy to a demotion count.
5. `applyQueueDemotions` reorders the queue on every read, among **checked-in**
   patients only, through `orderCheckedIn` (`utils/queueBoard.ts`). The
   reception board and the patient-app projection both use it, so a late
   check-in moves back the same number of places on reception's "next patient"
   and in every patient's `patientsAhead` (before 2026-09-25 only the projection
   applied it).

`assess` never throws: a missing policy row, unreadable settings or a malformed
time all resolve to "not late". Failing to penalise a patient is a much better
failure mode than penalising one by accident.

Token appointments are never late — they carry no promised clock time, so there
is nothing to be late *against*.

### The reorder

`applyQueueDemotions` (in `appointment-engine/utils/helpers.ts`) is pure and
order-stable. A queue with no late arrivals is returned **by reference** — it
does not pay for this feature at all.

Two rules make the demotion mean something:

**Terminal appointments do not count as places moved.** Being moved back two
places past two cancelled slots would demote nobody in practice while appearing,
in the data, to have applied a penalty.

**Other late patients do not count either.** This one is less obvious and was
caught by a failing test: with two patients each demoted one place, each would
step over the other, the two penalties would cancel exactly, and the queue would
come back in its original order — a demotion visible in the data and meaningless
in the room. Only patients who arrived *on time* count as places moved.

Each appointment is also moved exactly once. Without that guard the loop
re-encounters it at its new position, sees the same non-zero demotion, and walks
it to the back of the queue one pass at a time.

`move_to_end` is expressed as an oversized demotion count rather than a separate
concept in the reorder — the walk stops at the end of the list, so it simply
lands last.

## Reception override

`PUT /api/v1/appointments/:id` accepts `keepQueuePosition: true` alongside
`appointmentStatus: 'Patient Arrived'`, waiving the penalty. For the cases a
policy cannot encode: an emergency, a frail patient, a delay the clinic itself
caused. The waiver lands in the activity history alongside the arrival, because
that is exactly the kind of decision someone argues about later.

## Affected patients

No new machinery. The status change already runs
`AppointmentEngineOrchestrator.onStatusChange`, which recalculates and
broadcasts, so everyone who moved up a place is updated through the path they
already use.

## UI

`components/appointment/LatePatientPolicyCard.tsx`, mounted twice from one
component:

- **The appointment screen** — where reception will need to know the rule.
- **`/profile/no-show-policy`** — beside the grace period it is measured
  against. Configuring "what happens when someone is late" on a different screen
  from "how late counts as late" is how the two end up contradicting each other.

Editing is Admin-only; reception sees it read-only. They need to know the rule
they are enforcing — they are the ones who will be asked to justify it at the
desk — without being able to change clinic policy mid-shift.

## Migration

Three new columns and one new enum (`late_patient_policy`). All additive:

```bash
npm run db:migrations:dev && npm run db:migrate:dev
```

Existing rows default to `move_back` / 2 with `late_queue_demotion = 0`, so
nothing changes until a patient actually arrives late.

## Files

| file | role |
|---|---|
| `appointments/models/appointment.model.ts` | `arrivedAt`, `lateQueueDemotion` |
| `clinic/models/clinicSettings.model.ts` | policy enum + columns |
| `appointments/services/latePatient.service.ts` | grace + policy → demotion |
| `appointments/services/appointment.service.ts` | arrival hook, no-show cancel |
| `appointments/services/autoNoShow.service.ts` | the `Confirmed` fix |
| `appointment-engine/utils/helpers.ts` | `applyQueueDemotions` |
| `appointment-engine/utils/queueDemotion.test.ts` | reorder invariants |
| `components/appointment/LatePatientPolicyCard.tsx` | the settings card (FE) |

## Still unresolved

`Confirmed` means both "booking confirmed" and "in consultation" depending on
who is reading it. It caused the auto-no-show bug above, and it is the same
overload behind the currently-serving and wait-time issues recorded in
[PREDICTIVE_WAIT_TIME.md](./PREDICTIVE_WAIT_TIME.md). A dedicated
`In Consultation` status — the lifecycle state machine originally scoped and
parked — is what actually fixes it. Everything since has worked around it.
