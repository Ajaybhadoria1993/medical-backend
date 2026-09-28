# Appointment Engine — Test Scenarios

End-to-end verification for the queue engine: predictive wait times, running
late, breaks, learned consultation duration, and the live queue.

Companion docs: [PREDICTIVE_WAIT_TIME.md](./PREDICTIVE_WAIT_TIME.md) (how the
prediction works), [RUNNING_LATE_OVERRIDE.md](./RUNNING_LATE_OVERRIDE.md) (the
staff-declared delay), [LATE_PATIENT_HANDLING.md](./LATE_PATIENT_HANDLING.md)
(late arrivals), [PATIENT_APP_INTEGRATION.md](./PATIENT_APP_INTEGRATION.md) (the
patient payload contract).

---

## 0. Before you start

### Everything is scoped to *today*, in IST

The engine only ever computes today's queue. An appointment on any other date
produces no queue, no prediction, no notification — and this is the single most
common reason a scenario below appears to do nothing. Check the server's IST
date, not your local one.

### Prerequisites

| | |
|---|---|
| Redis | **must** be running — projections, overrides and caches all live there |
| Server | `npm run dev`, restart after any change below |
| Data | ≥1 doctor assigned to a clinic (`clinic_assign`), with availability configured for today's weekday |
| Appointments | ≥3 for that doctor today, non-terminal |

### Tokens you will need

Three different roles, and mixing them up accounts for most false failures:

- **Receptionist / Admin** — reception dashboard, session overrides, queue state
- **Doctor** — own queue only
- **Patient** — the live-queue socket channel is **patient-only**; a staff token
  connects successfully and then fails ownership

### Redis keys worth watching

```
appointment_engine:delay:{clinicId}:{doctorId}:{date}          the projection
appointment_engine:override:running_late:{clinicId}:{doctorId}:{date}
appointment_engine:tick_fingerprint:{clinicId}:{doctorId}:{date}
appointment_engine:consult_duration:{doctorId}:{date}
appointment_engine:day_config:{clinicId}:{doctorId}:{date}     slot/session/breaks
appointment_engine:notified:{appointmentId}                    notification sent
appointment_engine:threshold:{clinicId}                        running-late threshold
appointment_engine:time_to_next:{clinicId}:{doctorId}
```

`redis-cli KEYS 'appointment_engine:*'` to list them.

**Clearing caches between scenarios** saves a lot of confusion — `day_config`
holds breaks for an hour and `consult_duration` for ten minutes, so changing
availability or history has no visible effect until they expire:

```bash
redis-cli --scan --pattern 'appointment_engine:day_config:*' | xargs -r redis-cli DEL
redis-cli --scan --pattern 'appointment_engine:consult_duration:*' | xargs -r redis-cli DEL
```

### The main read endpoint

```
GET /api/v1/appointments/queue-state?clinicId={id}&doctorId={id}
```

Returns the live projection for every appointment. Most scenarios below are
verified here.

---

## 1. Baseline projection

**S1.1 — A queue with no delay**

1. Three appointments today at 09:00, 09:30, 10:00; doctor has not started.
2. `GET /queue-state` before 09:00.

Expect `estimatedWaitMinutes: 0` for all three, `cumulativeDelay: 0`, and each
`projectedStartTime` equal to its scheduled time.

**S1.2 — Delay cascades to everyone behind**

1. Set the 09:00 appointment to `Confirmed` at 09:20 (doctor started late).
2. `GET /queue-state`.

Expect the first appointment delayed ~20 minutes and **every later appointment
delayed too** — the cascade is the core behaviour. A delay that appears on one
appointment only is a real bug.

**S1.4 — An overrunning consultation delays everyone behind**

1. Appointments at 13:00, 14:00, 14:30, 15:00, 16:00.
2. Set 13:00 to `Confirmed` and leave it there. Wait until well past 15:00.
3. `GET /queue-state`.

Expect every waiting appointment projected at or after **now**, a real
`delayMinutes`, and `isRunningLate: true`.

Zero delay here is the bug this scenario exists for: the projection used to be
built from scheduled times alone whenever a doctor was mid-consultation, so a
doctor hours behind reported an on-time queue.

**S1.3 — Terminal appointments drop out**

1. Cancel the middle appointment.
2. `GET /queue-state`.

Expect it present with `estimatedWaitMinutes: 0`, and the appointment after it
to move **earlier** — a cancelled slot must not hold the queue open.

---

## 2. Currently serving

**S2.1 — `Confirmed` means in consultation**

1. Set one of today's appointments to `Confirmed`.
2. Check the reception dashboard and the appointment screen's queue bar.

Expect: doctor chip reads **Consulting**; the queue bar shows that appointment
under "Now" with an **In Consultation** badge, identified by token or slot time
— not by patient name.

**S2.2 — `Patient Arrived` is NOT in consultation**

1. Set an appointment to `Patient Arrived` and leave everything else untouched.

Expect **no** "now serving" anywhere. This distinction was previously wrong in
three separate places; if a checked-in-but-waiting patient shows as being seen,
that is a regression.

**S2.3 — Time-based queues have no token**

On a queue where `tokenNo` is null, expect `nowServingToken: null`,
`nowServingTime: "13:00"` and `nowServingLabel: "1:00 PM"`.

**`nowServingToken: null` is not a bug here** — read `nowServingLabel`, which
is the token-or-time choice made server-side and is already display-ready.

A label of `"13:00:00"` **is** a bug: published times are normalised to
`HH:MM` at source, and the label to 12-hour.

---

## 3. Running late — staff declared

Full detail in [RUNNING_LATE_OVERRIDE.md](./RUNNING_LATE_OVERRIDE.md).

**S3.1 — Announce from reception**

1. Receptionist → Dashboard → Live Doctor Queue → **Running late** → 30 min.
2. Verify: row in `doctor_session_overrides`; Redis
   `…:override:running_late:{clinic}:{doctor}:{date}` = `30`; button now amber
   reading `Running late · 30 min`.
3. `GET /queue-state` — every live appointment's wait ≥ 30.

**S3.2 — Announced vs measured: the larger wins**

| now | announced | measured | expect |
|---|---|---|---|
| before the slot | 30 | 0 | **30** |
| an hour after the slot, doctor never started | 15 | 60 | **60** |
| doctor consulting | 20 | 0 | **20** |

Announcing 15 while the doctor is genuinely 60 behind must show **60**. Showing
15 would quote a better time than reality supports.

**S3.3 — Multi-doctor announcement**

From the appointment screen's **Running late** button, tick two doctors, choose
30 min. Expect one row per doctor and both queues shifted. The presets stay
disabled until at least one doctor is ticked — nothing is targeted by default,
because announcing for the wrong doctor pushes a wrong time to their patients.

**S3.4 — Doctor may only announce for themselves**

With a Doctor token, `POST /session-override` naming another doctor → **403**.
In the UI a doctor only ever sees themselves in the picker.

**S3.5 — Re-announcing re-notifies**

1. Announce 20. Confirm patients are notified.
2. Announce 40.

Expect patients notified **again**. The `notified:` flags are cleared before the
refresh; without that, everyone already told about the 20 would hear nothing.

**S3.6 — Clearing**

Announce `0` (the **Clear** button). Expect waits back to their derived values
and a new row with `value_minutes = 0` — rows are append-only, nothing is
deleted.

**S3.7 — Validation**

`valueMinutes: 3` → rejected (below the 5-minute floor).
`valueMinutes: 600` → rejected (above 240).
A doctorId from another clinic → 400.

---

## 3B. Schedule shift — moving the day

Full detail in [RUNNING_LATE_OVERRIDE.md](./RUNNING_LATE_OVERRIDE.md#schedule-shift--moving-the-day).

Section 3 above verifies the *announcement*, which changes estimates only. This
section verifies the *shift*, which rewrites `appointments.appointment_time` and
the day's bookable window. Because it edits real bookings, work down these in
order — S3B.2 and S3B.4 are the ones that would hurt a real clinic if wrong.

### Setup

A doctor with **time-based** availability today (not token), a window like
09:00–14:00, and four appointments at 09:30 / 10:00 / 10:30 / 11:00. Mark the
09:00 one `Completed` so there is something that must **not** move.

```bash
redis-cli DEL "appointment_engine:day_config:{clinic}:{doctor}:{date}"
```

**S3B.1 — Preview writes nothing**

Reception → doctor's queue card → **Shift schedule** → 2h. The dialog lists
`9:30 AM → 11:30 AM`, `10:00 AM → 12:00 PM`, … and "Bookable until 4:00 PM".

Before confirming, verify **nothing changed**: no new row in
`doctor_session_overrides`, `appointment_time` values untouched, Redis
`…:override:schedule_shift:…` absent. A preview that writes is the worst
possible bug here, because reception previews durations to compare them.

**S3B.2 — The shift itself, order preserved**

Confirm the 2h shift. Expect exactly:

| before | after |
|---|---|
| 09:00 (Completed) | **09:00 — unchanged** |
| 09:30 | 11:30 |
| 10:00 | 12:00 |
| 10:30 | 12:30 |
| 11:00 | 13:00 |

```sql
SELECT appointment_time, appointment_status FROM appointments
WHERE doctor_id = '…' AND appointment_date = CURRENT_DATE ORDER BY appointment_time;
```

Order preserved, gaps preserved, the completed one left behind.

**S3B.3 — What must not move**

Repeat with one appointment in each state. Expect **unmoved**: `Completed`,
`Cancelled`, `NoShow`, `Missed`, and whichever appointment the doctor is
currently *in the room with* (call a patient in first, then shift). The response
lists that one under `skipped` with `reason: "in_consultation"`.

`Missed` is the easy one to get wrong — the engine does not treat it as
terminal, but its time records an appointment the patient never came to.

**S3B.4 — Capacity survives (the whole point)**

Before shifting, at ~11:00 with a 09:00–14:00 day:

```
GET /api/v1/appointments/doctor/available/slot-date-clinic/{doctorId}?date={today}&time=11:00&clinicId=…
```

Note how few free slots remain — everything before 11:00 is gone to the
past-slot rule.

Shift by 2h and call it again. Expect the window now to run to **16:00** and the
freed slots to be bookable. A `clinic_date_availability` row exists for today
with time slots covering the shifted window:

```sql
SELECT ts.start_time, ts.end_time FROM clinic_date_availability_time_slots ts
JOIN clinic_date_availability da ON da.id = ts.clinic_date_availability_id
WHERE da.doctor_id = '…' AND da.date = CURRENT_DATE;
```

If this returns nothing, the shift moved appointments but not the window — the
clinic still loses the afternoon, and the feature has failed at its purpose.

**S3B.5 — The past-slot rule still works afterwards**

The protection from section 1 of the requirement must survive:

1. Try to book the shifted **11:30** slot at 11:31 → `Appointment slot time
   cannot be in the past`.
2. Book **13:00** → succeeds.

Both must behave exactly as before the shift. The shift moves times; it does not
weaken the rule.

**S3B.6 — No double counting with running late**

1. Announce running late 30 (section 3).
2. Now shift by 120.

Expect: a `running_late` row with `value_minutes = 0` written automatically,
Redis `…:override:running_late:…` = `0`, and `GET /queue-state` quoting the
appointment moved to 12:00 at **12:00** — not 14:00. Seeing 14:00 means the
projection floor is being applied on top of the rewritten times.

**S3B.7 — Everything updates without a refresh**

With the shift applied, and no page reloaded anywhere:

| screen | expect |
|---|---|
| Reception dashboard / queue card | new times, button reads `Shifted · 120 min` |
| Doctor dashboard | new times |
| Appointment list + detail | new times |
| `GET /reception/live-queue` | new times |
| Patient (own appointment, socket) | `appointment.updated` carrying the new `appointmentTime` |

**S3B.8 — Correcting and reverting**

The stored value is cumulative; the move is the difference.

| action | expect appointments |
|---|---|
| shift 120 | 09:30 → 11:30 |
| then shift 30 | 11:30 → **10:00** (moved back 90) |
| then shift 0 | back to **09:30** |

After `0`, the date-availability window is back where it started too. This is
the check that a fat-fingered 4h is recoverable without rebuilding the day.

**S3B.9 — Long delay → custom slots**

Shift 240 on a day where that pushes an appointment past midnight → **400**
naming custom slots. That is the intended answer: past four hours the running
order is not worth preserving, and the receptionist should build date-specific
availability instead (doctor profile → date availability). Confirm those custom
slots then generate bookable slots normally.

**S3B.10 — Token day is refused, not mangled**

On a doctor whose day has `no_of_patients` set, a shift must not invent clock
times. `sessionEnd` comes back `null` and no window is materialised. Running
late is the tool for a token day.

**S3B.11 — Breaks move with the day**

Give the doctor a 13:00–14:00 break, clear `day_config`, then shift 60. Expect
the break to land at 14:00–15:00 — visible as a **gap between two time-slot
rows**, since the date-availability path expresses breaks as gaps rather than
reading the break tables. A break that vanishes means the segments were
collapsed into one row.

**S3B.12 — `day_config` was actually cleared**

The sneaky one. Immediately after a shift:

```bash
redis-cli GET "appointment_engine:day_config:{clinic}:{doctor}:{date}"
```

Expect `nil`. It caches the session start for an hour and nothing else
invalidates it; a stale entry projects against the old session start while the
appointments carry new times, for up to an hour.

**S3B.13 — Upcoming days**

Pick a day from the **Day** dropdown other than today and shift it.

- Appointments on that day move; today's do **not**.
- No engine recalculation runs (`refreshQueuesIfLive` returns early) — Redis
  `…:delay:{clinic}:{doctor}:{today}` is untouched.
- The reception board still shows the doctor as on time **today**; the badge
  reads today's state, not the future row's.
- On a day with nothing booked yet, the shift is still offered and moves the
  bookable window — confirm reads "Move the bookable day".
- A past date → **400**. More than 14 days ahead → **400**.

The same picker exists on **Running late**, where a future announcement writes
the row but notifies nobody until that day arrives.

**S3B.14 — Reverting must un-shadow the weekly template**

The one that looks like a caching bug when it breaks.

1. Shift a day, then revert it (`0` / **Move back**).
2. `SELECT * FROM clinic_date_availability WHERE date = '<that day>'` → **no
   row**. If a row survives, stop: that date is now permanently pinned to the
   shifted hours.
3. Edit that doctor's **weekly** hours for that weekday, then reload the slots
   for the date → the new weekly hours apply.

Step 3 is the real check. A leftover date row shadows the weekly template, so
editing weekly hours appears to do nothing on that one date, with no error
anywhere.

A date row the clinic built **by hand** must survive a revert — it is theirs,
and only its times are moved back.

**S3B.15 — A day that cannot absorb the shift is refused**

On a doctor working 00:00–23:55, shift 60 → **400** naming custom slots. It must
not clamp: silently ending the day at 23:59 both shortens the requested shift
and pushes the day's end later than configured. The dry-run preview must refuse
identically, not preview success and fail on confirm.

**S3B.16 — Permissions**

Same rules as an announcement: Admin/Receptionist for any clinic doctor, Doctor
for themselves only (**403** otherwise), a doctor from another clinic → 400.

### Things that look like bugs but are not

- **`delayMinutes` drops to ~0 after a shift.** Correct — the promise is now
  11:30, and a doctor starting at 11:30 is on time against it.
- **The preview lists fewer appointments than the day has.** Terminal ones and
  the consultation in progress are excluded by design; check `skipped`.
- **A second shift "does nothing".** Re-sending the same cumulative value is a
  delta of zero. Send a different total.
- **Patient app still shows the old time.** It must re-render from
  `appointment.updated`, not only toast it — see
  [PATIENT_APP_CHANGES.md](./PATIENT_APP_CHANGES.md).

### Automated coverage

`src/main/appointment-engine/services/scheduleShift.test.ts` — shift maths,
order preservation, the in-consultation and token exemptions, the midnight
refusal, negative deltas, and the `MOVABLE_STATUSES` allowlist. It does not
cover the window materialisation or the cache clear; those are S3B.4 and S3B.12
by hand.

---

## 4. Breaks

Configure a 13:00–14:00 break on the doctor's weekly availability
(`breaksStart`/`breaksEnd`, or a `clinic_availability_break` row), then **clear
`day_config`** — it is cached for an hour.

**S4.1 — An appointment inside a break moves after it**

Appointment at 13:15 → `projectedStartTime: "14:00"`, wait 45 minutes.

**S4.2 — Lunch is not reported as delay (the important one)**

1. Token queue: nine 30-minute tokens from 09:00, break 13:00–14:00.
2. `GET /queue-state`, look at token 9.

Expect `appointmentTime: "14:00"`, `projectedStartTime: "14:00"`,
**`estimatedWaitMinutes: 0`**.

If token 9 shows ~60 minutes of delay, breaks are being applied to the
projection but not to the nominal schedule — which would report every afternoon
patient as an hour late and fire running-late notifications at all of them,
while the doctor is perfectly on time.

**S4.3 — Overrunning into a break is not pushed**

An appointment starting 12:50 and running 30 minutes keeps its 12:50 start. Only
a start *inside* the break moves. In a real clinic the doctor finishes the
patient and lunch gets shortened.

**S4.4 — Real delay survives a break**

A genuine delay on top of a break still shows: the break absorbs its own
duration, not the doctor's lateness.

---

## 5. Learned consultation duration

**S5.1 — Which basis is in use**

`GET /queue-state` or the patient payload → `consultationBasis`:

| value | meaning |
|---|---|
| `learned` | ≥10 real consultations measured for this doctor |
| `doctor` | configured for this doctor on `clinic_assign` |
| `clinic` | falling back to the clinic-wide `clinic_settings` value |
| `slot` | falling back to the availability grid |
| `default` | nothing at all — 30 minutes |

**S5.2 — A new doctor cannot be `learned`**

A doctor with no history shows `doctor`, `slot` or `clinic`. **This is correct, not a
bug** — under 10 samples the learned figure is not trusted.

**S5.3 — Learning requires the Confirmed step**

The measurement is the `CONFIRMED → COMPLETED` gap in
`appointment_activity_history`. An appointment moved straight from `Upcoming` to
`Completed` writes no `CONFIRMED` row and produces **no sample**.

A clinic whose staff skip confirming will never reach `learned`. To generate
samples deliberately: set an appointment `Confirmed`, wait a few minutes, set it
`Completed`, repeat ≥10 times. Then clear `consult_duration`.

**S5.4 — Junk samples are discarded**

A `Confirmed → Completed` gap under 2 or over 180 minutes is excluded. Verify by
leaving one appointment `Confirmed` overnight and closing it the next morning —
it must not drag the median.

**S5.5 — Today's pace blends in**

Baseline is the 30-day median; today's median gains weight as
`nToday / (nToday + 8)`. One fast consultation at 9am barely moves the number;
by the 8th, today carries half the weight.

**S5.6 — The appointment's own duration still wins**

An appointment with an explicit `appointmentDurationMinutes` uses that value
regardless of what was learned — someone deliberately booked a double slot.

---

## 6. The queue tick (dynamic updates)

**S6.1 — It is running**

At boot: `[Cron:QueueTick] Scheduled every minute`.

**S6.0 — It does not broadcast to an empty room**

With no dashboard open and no patient joined, expect **no** `[QueueTick] Scanned`
lines even while a doctor is running late — the listener gate skips the
broadcast. Running-late notifications still fire; only the socket fan-out is
skipped.

**S6.2 — It broadcasts only on change**

Watch the log for a few minutes with a live queue and nothing happening.

Expect **no** `[QueueTick] Scanned …` lines while the projection is unchanged —
the fingerprint suppresses the broadcast. A line every minute on an idle clinic
means change detection is broken and every patient socket is being written to
once a minute.

**S6.2b — Pushes are bucketed, not per-minute**

With a dashboard open and a doctor running late, expect a broadcast roughly
every five minutes, not every minute — the fingerprint compares in five-minute
buckets. A status change still pushes immediately.

**S6.3 — Time alone moves the estimate**

1. Open a patient live-queue socket, note `estimatedWaitMinutes`.
2. Change nothing. Wait past the first appointment's scheduled time.

Expect a `queue.update` to arrive on its own, with a larger wait. This is the
behaviour the tick exists for: before it, the estimate stayed frozen between
status changes while real minutes passed.

**S6.4 — Multi-instance**

Running more than one app instance against one database means more than one
tick. Harmless but wasteful — set `QUEUE_TICK_ENABLED=false` on all but one.

---

## 7. Tentative time

**S7.1 — Present and labelled**

Patient payload carries `tentativeStartTime`, `tentativeRangeMinutes`, and
`isTentative: true`. The portal shows `Estimated ~2:30 PM (± 20 min)`.

**S7.2 — The band widens down the queue**

Compare the 1st and 5th patients: the band must be larger for the 5th. With
20-minute consultations expect roughly ±5 and ±25.

**S7.3 — Never a time without the flag**

`isTentative` is true exactly when `tentativeStartTime` is present. A terminal
appointment returns `null` / `false` — it stops predicting rather than freezing
on its last guess.

**S7.4 — The clinic bar marks it too**

Up-next entries show `~HH:MM` beside the booked slot. The tilde matters: two
clock times with no distinction read as a contradiction.

---

## 8. Live queue socket (patient)

Connect with a **patient** token (`auth.token` in the handshake), emit
`join.live-queue` with `{ "appointmentId": "…" }`.

Subscribe to: `queue.update`, `queue.error`, `queue.completed`, `running_late`,
`appointment.updated`.

**S8.1 — Join returns immediately**

`queue.update` arrives right away. It must **not** wait on notification
dispatch — that was previously awaited inline, making the patient wait on a
third-party push provider before seeing their own queue.

**S8.2 — Failures are visible**

Every rejection emits `queue.error` *and* calls the ack, so a client that
emitted without a callback still sees the reason:

| code | cause |
|---|---|
| `ACCESS_DENIED` | **most common in testing** — patient-only channel, staff token |
| `NOT_TODAY` | appointment is not today |
| `TERMINAL_STATUS` | already Completed / Cancelled / NoShow |
| `NOT_FOUND` | wrong id, or wrong environment's database |
| `UNAUTHENTICATED` | no user on the socket |

**S8.2b — On-demand refresh costs no DB query**

After joining, emit `queue.refresh` with `{}`. Expect an immediate
`queue.update` and an ack of `{ status: "success", inQueue: true,
fromCache: true }`.

`fromCache: true` is the point — it served from the cached projection with **no**
database query. `false` means the cache had expired and it recalculated, which
is correct but should be rare.

Emit it twice within five seconds: the second acks `status: "throttled"` and
emits nothing. Emit it without joining first: `NOT_JOINED`.

**S8.3 — Terminal removes the patient**

Complete the appointment → `queue.completed`, socket leaves the room.

**S8.4 — Running-late reaches the patient**

Announce a delay → the patient receives `running_late` and the portal shows a
persistent amber banner (not just a toast, which vanishes in seconds while the
delay lasts all morning).

---

## 9. Permissions

| action | Admin | Receptionist | Doctor | Patient |
|---|---|---|---|---|
| `GET /queue-state` | ✅ | ✅ | ✅ | ❌ |
| `GET /reception/live-queue` | ✅ | ✅ | ❌ | ❌ |
| `POST /session-override` (any clinic doctor) | ✅ | ✅ | self only | ❌ |
| Edit late-patient policy | ✅ | read-only | read-only | ❌ |
| `join.live-queue` | ❌ | ❌ | ❌ | ✅ own/family |


## 10. Late patient handling

Full detail in [LATE_PATIENT_HANDLING.md](./LATE_PATIENT_HANDLING.md). Set the
policy on the appointment screen or `/profile/no-show-policy`; lateness is
measured against the no-show grace period (default 15 min).

**S12.1 — On time, or late within grace**

Check in a patient before `scheduled + grace`. Expect `arrived_at` set,
`late_queue_demotion = 0`, and no change in queue order.

**S12.2 — Late past grace, `move_back`**

Policy `move_back` / 2 places. Check in a patient 30 minutes after their slot
with at least two on-time patients behind them.

Expect `late_queue_demotion = 2`, and `GET /queue-state` returning them **after**
those two — with their `appointmentTime` unchanged, since it records what the
clinic promised.

**S12.3 — Cancelled slots do not absorb the penalty**

Same as S12.2, but cancel the two appointments behind the late patient first.
Expect them to move past the two cancelled slots *and* past two live ones —
moving back past cancellations would cost them nothing.

**S12.4 — Two late patients do not cancel out**

Check in two patients late, both demoted. Expect **both** behind the next on-time
patient, not merely swapped with each other. If the order comes back unchanged,
late patients are counting each other as places moved.

**S12.5 — Reception override**

Check in a late patient with `keepQueuePosition: true`. Expect
`late_queue_demotion = 0`, position unchanged, and the waiver visible in the
appointment's activity history.

**S12.6 — `move_to_end`**

Switch the policy. A late patient should land last among live appointments.

**S12.7 — `keep_position`**

Reproduces the behaviour before this feature: no demotion regardless of lateness.

**S12.8 — Arrival cancels the pending no-show**

Check in a patient *after* their grace period has passed but before the job would
next run. Expect them **not** to be auto-marked `NoShow` — they are standing at
the desk. This is what makes late handling possible at all.

**S12.9 — A patient in consultation is never auto-no-showed**

Set an appointment `Confirmed` (in consultation) and let the grace period expire.
Expect it to stay `Confirmed`. This was a live bug: `Confirmed` was an eligible
status for auto-no-show, so a patient in the room could be marked absent.

**S12.10 — The penalty is applied once**

After a late check-in, edit the appointment again (add a note, take payment).
Expect `arrived_at` and `late_queue_demotion` unchanged — re-saving must not
re-stamp the arrival or stack another demotion.

**S12.11 — Token queues are never late**

A token appointment has no promised clock time. Expect no demotion regardless of
when the patient arrives.

**S12.12 — Reception cannot edit the policy**

With a Receptionist login the card on the appointment screen is read-only; with
an Admin login it is editable.


---

## 11. Things that look like bugs but are not

| Symptom | Explanation |
|---|---|
| `nowServingToken: null` | time-based queue — read `nowServingLabel` |
| `consultationBasis: "slot"` | under 10 samples, or the clinic skips `Confirmed` (S5.3) |
| `consultationBasis: "clinic"` on one doctor only | that doctor has neither history nor a slot size; set one on their `clinic_assign` row |
| `isRunningLate: true`, no push received | the flag is derived from delay vs threshold, not from delivery. Check the push provider |
| `runningLateMinutes` > announced | measured delay exceeded the announcement and correctly won |
| Announcement seems to do nothing | queue is empty, not today, or all appointments terminal |
| Break change has no effect | `day_config` is cached for an hour — clear it |
| Learned duration will not update | `consult_duration` is cached for ten minutes — clear it |
| Queue frozen for another date | the engine only computes today |
| `delayMinutes: 0` with patients ahead | correct — that field is lateness vs the slot, not the wait. Read `minutesUntilSeen` |
| `minutesUntilSeen: null` | no projection to measure from; show "updating shortly", never 0 |
| `totalPatientsInQueue` looks too small | it equals `patientsAhead` by construction, not the day's total |
| No `[QueueTick]` log lines | correct on an idle clinic — it only logs when it broadcasts |
| Late patient not demoted | within grace, a token appointment, or reception waived it |
| Demoted patient still shows their original time | correct — `appointmentTime` records what was promised; their *position* moved |

---

## 12. Automated coverage

```bash
npx jest src/main/appointment-engine          # 35 suites, 324 tests (2026-09-25)
```

| suite | covers |
|---|---|
| `delayTracker.token.test.ts` | token queues, session anchoring, mixed queues |
| `sessionOverride.delay.test.ts` | announced-delay floor, cascade, consulting, tokens |
| `breaks.test.ts` | break windows, merging, the S4.2 token regression |
| `consultationDuration.test.ts` | the blend, sample gating, clamps, resolution chain |
| `queueTick.service.test.ts` | fingerprint stability, overlap guard |
| `tentativeTime.test.ts` | band growth, `isTentative` invariants |
| `timeToNext.service.test.ts` | time-to-next |
| `helpers.test.ts` | duration resolution, terminal/shiftable status |
| `queueDemotion.test.ts` | late-arrival reorder invariants |
| `timeFormat.test.ts` | time normalisation, 12-hour display, countdown |
| `queueBoard.test.ts` | board classification; `orderLikeBoard` (checked-in first, shifts kept together) |
| `liveQueueHelper.hold.test.ts` | held patients excluded; running late follows the live delay |
| `liveQueueAccess.test.ts` | the shared REST/socket live-queue access rule |

**Not covered by automated tests** — these need the manual scenarios above:
socket delivery end to end, cron scheduling, Redis cache expiry behaviour,
notification dispatch, and every UI surface.
