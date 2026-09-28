# Appointment Engine — Architecture & Technical Documentation

## Overview

The Appointment Engine is a real-time queue management system that computes wait times, broadcasts updates, and notifies patients about delays. It operates exclusively on today's appointments and is triggered by appointment status changes and BullMQ delayed jobs.

---

## Core Principles

1. **Fire-and-forget** — Engine never blocks the API that triggered it
2. **Today only** — No computation for past or future dates
3. **Event-driven + scheduled** — Runs on status change (event-driven) AND via BullMQ delayed jobs for inactive-doctor detection (scheduled, no polling)
4. **Cache-first for broadcasts, always-fresh for patient reads** — The orchestrator/broadcast hot path (status changes, dashboard) is cache-first: Redis used for reads, DB only when cache is cold. The patient-facing live-queue read path (REST page load / socket join) always recalculates from the DB instead — see LiveQueueHelper and "Per patient live-queue read" below for why.
5. **Graceful degradation** — If Redis is down, falls back to DB; if engine fails, API still works
6. **Only "Confirmed" means the doctor is actively with a patient** — "Patient Arrived" means checked in/waiting, not yet with the doctor. Every "is doctor serving/busy" check across the engine must use `status === 'Confirmed'` only, never `Confirmed || Patient Arrived` — that conflation was a real, repeated bug (see "Known Pitfalls" below).

---

## File Structure

```
src/main/appointment-engine/
├── interfaces/
│   └── index.ts                    # Types: AppointmentRecord, QueueDelayData, AppointmentDelayEntry
├── services/
│   ├── orchestrator.service.ts     # Entry point — dispatches to other services
│   ├── delayTracker.service.ts     # Computes wait times, manages Redis cache
│   ├── timeToNext.service.ts       # Computes minutes until next patient
│   ├── queueBroadcast.service.ts   # Emits socket events to dashboard + patients
│   ├── runningLateNotifier.service.ts  # Evaluates threshold + sends notifications
│   ├── runningLateQueue.service.ts # BullMQ delayed jobs for inactive-doctor detection
│   ├── noShowShift.service.ts      # Shifts appointments forward on no-show
│   └── liveQueueHelper.ts         # Shared helper for patient-facing payloads
├── controllers/
│   └── queueState.controller.ts   # REST endpoint for dashboard page load
└── utils/
    └── helpers.ts                  # getRedisKey, isTerminalStatus, resolveAppointmentDuration
```

---

## Trigger Flow

```
POST /api/v1/appointments  (create appointment)
    │
    ▼
AppointmentService.createAppointment()
    │
    ├── DB transaction commits
    ├── API responds immediately
    │
    └── Fire-and-forget (post-commit):
        ├── runningLateQueue.scheduleCheck(appointmentTime + threshold)
        ├── delayTracker.recalculate() (populates Redis cache for today)
        └── QueueBroadcastService.emitQueueUpdated() + emitPatientUpdated()
            (broadcasts updated queue to dashboard & patients via socket)

PUT /api/v1/appointments/:id  (status change)
    │
    ▼
AppointmentService.updateAppointment()
    │
    ├── DB transaction commits (status saved)
    ├── API responds to client immediately
    │
    └── Fire-and-forget (post-commit):
        ├── Orchestrator.onStatusChange(appointment, previousStatus)
        └── If rescheduled (date/time change) for today:
            ├── delayTracker.recalculate()
            └── QueueBroadcastService.emitQueueUpdated() + emitPatientUpdated()
```

### Which statuses trigger the engine:

| Status            | Triggers | Action                             |
| ----------------- | -------- | ---------------------------------- |
| `Confirmed`       | YES      | Doctor starts seeing patient       |
| `Patient Arrived` | YES      | Reception marks arrival            |
| `Completed`       | YES      | Doctor finishes consultation       |
| `NoShow`          | YES      | Patient didn't show (shifts queue) |
| `Upcoming`        | NO       | Default status                     |
| `Cancelled`       | NO       | No engine action                   |

---

## Orchestrator Dispatch

```
onStatusChange(appointment, previousStatus)
    │
    ├── Cancel running-late BullMQ jobs for past-due appointments
    │
    ├── Confirmed / Patient Arrived / Completed:
    │     1. DelayTrackerService.recalculate()
    │     2. RunningLateNotifier.evaluateFromCache(queueData)  ← zero extra DB
    │     3. TimeToNextService.computeAndBroadcastFromQueue(queueData)  ← zero extra cache read
    │     4. QueueBroadcastService.emitQueueUpdated(queueData)
    │     5. QueueBroadcastService.emitPatientUpdated(queueData)  ← awaited (returns Promise<void>)
    │
    └── NoShow:
          1. NoShowShiftService.shiftForward()
          2. DelayTrackerService.recalculate()
          3. RunningLateNotifier.evaluateFromCache(queueData)
          4. QueueBroadcastService.emitQueueUpdated(queueData)
          5. QueueBroadcastService.emitPatientUpdated(queueData)  ← awaited (returns Promise<void>)
```

**Key optimization:** The orchestrator recalculates once and passes the result (`queueData`) directly to all downstream services. No redundant Redis reads or DB queries for notification evaluation or time-to-next computation.

---

## Services — Detailed

### 1. DelayTrackerService

**Purpose:** Computes estimated wait time for every appointment in a doctor's daily queue.

**Algorithm:**
1. Fetch all appointments for (clinicId, doctorId, today) ordered by time/token
2. Resolve slot duration: `appointmentDurationMinutes` → `slotMinutes` → 30 (default)
3. Check if doctor is actively serving someone — **`Confirmed` status only**. `Patient Arrived` means checked in/waiting, not with the doctor yet; treating it as "serving" is self-referential for the first patient in the queue (their own check-in would suppress their own real-time-delay computation) and was a real bug — see "Known Pitfalls".
4. Walk queue sequentially:
   - First non-terminal appointment:
     - If doctor IS serving: `projectedStart = scheduledTime`
     - If doctor is NOT serving AND `currentTime > scheduledTime`: `projectedStart = currentTime` (real-time delay)
     - Otherwise: `projectedStart = scheduledTime`
   - Subsequent appointments: `projectedStart = max(scheduledTime, previousProjectedEnd)`
   - `estimatedWaitMinutes = max(0, projectedStart - scheduledTime)`
5. Store result in Redis with 24h TTL + version check (Lua atomic write). The version is `Date.parse(lastCalculatedAt)` — a timestamp fixed once at the start of `recalculate()`, not a read-then-increment against the current Redis value. A read-then-increment is racy across concurrent/multi-instance writers (two callers can read the same "current" version and compute the same "next" one); a timestamp fixed at computation start is monotonic per-writer regardless of what else is happening in Redis, which is what the Lua compare-and-set guard actually needs.
6. Also store per-appointment cache keys for fast patient lookups

**Real-time delay:** When the doctor hasn't started seeing anyone and the first appointment's time has passed, the algorithm uses `currentTime` as the projected start. This cascades accurate delay values to all subsequent appointments, so the dashboard shows real delay even when no status changes have occurred.

**DB Queries:** 1 (fetchDailyQueue) + 0-2 (resolveSlotMinutes, cached after first call)

**Redis Keys:**
- `appointment_engine:delay:{clinicId}:{doctorId}:{date}` — full queue data (24h TTL)
- `appointment_engine:wait:{appointmentId}` — per-appointment wait time (24h TTL)
- `appointment_engine:slot_minutes:{clinicId}:{doctorId}:{date}` — cached slot config (1h TTL)

---

### 2. TimeToNextService

**Purpose:** Computes minutes until the next patient for the doctor view.

**Logic:**
- If a patient is "Confirmed" or "Patient Arrived": `timeToNext = slotDuration - elapsed`
- If no one is in-progress: `timeToNext = nextProjectedStart - now`
- If no more appointments: `timeToNext = null`

**DB Queries:** 1 (get updatedAt for timing calculation)

**Redis Keys:**
- `appointment_engine:time_to_next:{clinicId}:{doctorId}` — last broadcast value (1h TTL, throttles broadcasts)

---

### 3. RunningLateNotifier

**Purpose:** Sends "Doctor Running Late" notification when delay exceeds clinic threshold.

**Who gets notified:** Any patient still waiting on the doctor — `"Upcoming"` (hasn't arrived) **and** `"Patient Arrived"` (checked in, but doctor hasn't started with them). Only `"Confirmed"` (doctor actively seeing them) or terminal states are excluded. Excluding `Patient Arrived` was a bug: a checked-in patient sitting in the waiting room while the doctor runs an hour behind is exactly who this notification/tile is for.

**Two-layer detection:**

**Layer 1 — Queue-based delay (event-driven):**
1. Read threshold from cache (or DB on cold start)
2. For each eligible appointment (`Upcoming` or `Patient Arrived`): if `estimatedWaitMinutes > threshold` → notify
3. Once-per-crossing semantics: uses Redis flags to avoid duplicate notifications. The flag's **value** is the effective delay in minutes (not just a `'1'` marker) — it doubles as durable "is running late" state for the patient-facing payload, not just a notification dedupe marker.
4. If delay drops below threshold, clears flag (re-notification on next crossing)

**Layer 2 — Real-time lateness (when doctor is inactive):**
1. Check if anyone is currently being served — **`Confirmed` status only**, not `Patient Arrived` (same rationale as DelayTrackerService above)
2. If NOT → compute `realTimeDelay = currentTime - scheduledTime`
3. Use `max(estimatedWaitMinutes, realTimeDelay)` as effective delay
4. Notify if effective delay > threshold

**Methods:**
- `evaluate(clinicId, doctorId, date)` — reads queue data from cache, evaluates (standalone use)
- `evaluateFromCache(clinicId, doctorId, date, queueData)` — evaluates the **whole queue** using pre-fetched data (zero DB), called by orchestrator, RunningLateQueue, and cron
- `evaluateSingleFromCache(clinicId, appointmentId, queueData)` — evaluates **one appointment only**, used by `liveQueueHelper.computeLiveQueuePayload` (patient screen-open path). Runs the same underlying `evaluateSingleAppointment` logic as the full-queue loop, just scoped to one entry — avoids redundantly re-evaluating every other patient's appointment each time any one patient opens their live-queue screen.

**DB Queries:** 0-1 (getThresholdMinutes, cached after first call)

**Redis Keys:**
- `appointment_engine:threshold:{clinicId}` — cached threshold value (1h TTL)
- `appointment_engine:notified:{appointmentId}` — notification sent flag (24h TTL)

---

### 3b. RunningLateQueue (BullMQ Delayed Jobs)

**Purpose:** Detects when doctor is completely inactive (no status changes at all) and patients are waiting past their scheduled time. Covers the blind spot where the event-driven engine never fires.

**Flow:**
```
Appointment Booked → scheduleCheck(appointmentTime + threshold)
                          │
                          ▼ (fires at exact time)
                    processJob()
                          │
                    ┌─────▼──────┐
                    │ Recent      │─ YES → Skip (between patients)
                    │ status      │   (last_activity key, written only by
                    │ change?     │    orchestrator on real status changes)
                    └─────┬──────┘
                          │ NO
                    ┌─────▼──────┐
                    │ Doctor      │─ YES → Skip (cached statuses, zero DB)
                    │ serving?    │
                    └─────┬──────┘
                          │ NO
                          ▼
                    Recalculate delay (1 fresh DB read —
                    cached wait times go stale; cache may be cold)
                          │
                    ┌─────▼──────┐
                    │ Doctor      │─ YES → Skip (fresh re-check)
                    │ serving?    │
                    └─────┬──────┘
                          │ NO
                    ┌─────▼──────┐
                    │ Appointment │─ NO → Skip
                    │ active?     │
                    └─────┬──────┘
                          │ YES
                          ▼
                    Send running_late notification (evaluated on fresh data)
                    + Broadcast queue.updated to dashboard (same data, 0 extra DB)
                          │
                          ▼
                    Reschedule in 15 min (up to 12 times)
```

**Key behaviors:**
- Self-rescheduling: re-notifies every 15 minutes while doctor remains inactive (max 12 attempts = 3 hours)
- Cancelled when doctor becomes active: `cancelAllForDoctor()` removes only past-due jobs (future appointments keep their jobs)
- Token-based support: `scheduleCheckFromProjectedTime()` uses projected start time from delay tracker
- Past appointments: if threshold time already passed, schedules for 1 minute (immediate check)
- First attempt respects event-driven notification flags (avoids duplicate on first fire)
- Repeat attempts (attempt > 1) clear the flag to allow re-notification every 15 minutes
- After notification, recalculates queue and broadcasts `queue.updated` so dashboard shows live delay
- Both "Doctor serving?" checks in `processJob()` (cached pre-check and fresh re-check) use **`status === 'Confirmed'` only** — `Patient Arrived` must not count, or a job targeting a checked-in-but-not-confirmed patient would skip itself (self-referential: the target appointment's own check-in would suppress its own notification)

⚠️ **Boot-time requirement:** `RunningLateQueueService`'s constructor creates both the BullMQ `Queue` and `Worker`. The module was previously only ever loaded via a dynamic `import()` from `appointment.service.ts` (on appointment create/reschedule/cancel) — meaning a fresh process (or any instance that never happens to handle one of those calls) never had a live `Worker`, so jobs sat in Redis un-consumed and notifications silently never fired. `src/server.ts` now imports this module for its side effect once at boot (alongside `initCronJobs()`), guaranteeing the `Worker` exists as soon as the process is up. Do not remove that import.

**DB queries per job fire:** 0 when the job no-ops (recent activity or doctor serving — Redis-only checks); 1 (`fetchDailyQueue` via `recalculate()`) when the doctor looks inactive and the notification must be evaluated. Works even if the delay cache is cold (Redis restart) — the recalculation rebuilds it.

**BullMQ Queue:** `running-late-check`

**Job lifecycle:**
| Event                      | Action                                                         |
| -------------------------- | -------------------------------------------------------------- |
| Appointment booked         | `scheduleCheck()` → job created with delay                     |
| Doctor confirms patient    | `cancelAllForDoctor()` → removes past-due jobs                 |
| Appointment rescheduled    | `cancelCheck()` + `scheduleCheck()` with new time              |
| Appointment cancelled      | `cancelCheck()` → job removed                                  |
| Job fires, doctor active   | Job completes (no-op)                                          |
| Job fires, doctor inactive | Sends notification + broadcasts queue + reschedules for 15 min |

---

### 4. NoShowShiftService

**Purpose:** When a patient is marked NoShow, shifts all subsequent appointments forward by the no-show's slot duration.

**Logic:**
1. Determine shift amount = no-show appointment's duration
2. For each subsequent "Upcoming"/"Confirmed" appointment: `newTime = currentTime - shiftAmount`
3. Handles break avoidance (skips clinic breaks)
4. Token-based queues: no time shift, only recalculates wait times
5. All updates in a single DB transaction (atomic rollback on failure)
6. Sends `appointment_shifted` notification to affected patients

---

### 5. QueueBroadcastService

**Purpose:** Emits socket events after recalculation. Redis-only (batched `mget` for running-late flags), zero DB queries.

**Events emitted:**
| Event                 | Room                               | Recipient                       | Data                                |
| --------------------- | ---------------------------------- | ------------------------------- | ----------------------------------- |
| `queue.updated`       | `clinic:{clinicId}`                | Dashboard                       | Full queue with all appointments    |
| `timeToNext.updated`  | `clinic:{clinicId}`                | Dashboard                       | Minutes to next patient             |
| `appointment.updated` | `user:{userId}`                    | Each patient                    | Full `LiveQueuePayload` (see below) |
| `queue.update`        | `live-queue:{clinicId}:{doctorId}` | Patients in live-queue          | Full `LiveQueuePayload`             |
| `queue.completed`     | `live-queue:...`                   | Patient whose appointment ended | Auto-removed from room              |

`emitPatientUpdated(queueData: QueueDelayData)` (note: takes the **full** `QueueDelayData`, not just `.appointments`, and returns `Promise<void>` — callers must await/`.catch()` it) delegates per-entry payload construction to `LiveQueueHelper.buildPayloadFromQueue` instead of duplicating the stage-derivation logic inline — this used to be a second, independently-maintained copy of the same branching as `buildPayloadFromQueue`, which had drifted out of sync (see "Known Pitfalls"). Both `emitPatientUpdated` and `emitLiveQueueUpdates` batch the running-late Redis flag lookup via a single `mget` across all active appointment IDs per broadcast, rather than one `GET` per appointment.

---

### 6. LiveQueueHelper

**Purpose:** Shared utility for computing patient-facing queue payloads. Used by socket handler, REST endpoint, and broadcast service.

**Functions:**
- `computeLiveQueuePayload(appointmentId, clinicId, doctorId)` — **always recalculates fresh from the DB** (no cache-first). Real-time delay for an inactive doctor changes purely with elapsed wall-clock time — no event necessarily fires to invalidate a stale cache entry — so trusting the cache here meant a patient's `estimatedWaitMinutes` could stay frozen at whatever it was near booking time indefinitely. This is the per-appointment, patient-initiated read path (REST page load / socket join), so the added DB cost is bounded by patient screen-opens, not broadcast frequency: 1 indexed query per call. It also calls `RunningLateNotifier.evaluateSingleFromCache` on the freshly recalculated data before returning, so a push notification doesn't lag behind a BullMQ job's next 15-minute repeat.
- `buildPayloadFromQueue(appointmentId, queueData, thresholdMinutes?)` — pure/sync computation from existing data (no I/O). Every path (REST, socket join, `queue.refresh`, both broadcasts) builds through it, so they cannot disagree.
- `loadLiveQueueAppointment(appointmentId, userId)` — the one access rule for REST and `join.live-queue`: resolves a paid booking's temp id, then requires the patient or their family primary (`ACCESS_DENIED`, checked first), a doctor (`NO_DOCTOR`), today in IST (`NOT_TODAY`) and a non-terminal status (`TERMINAL_STATUS`). Throws `HttpError` with `details.code`.

**`LiveQueuePayload` fields:**
| Field                | Meaning                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `queue.stage`         | One of `not-arrived` \| `in-queue` \| `almost-there` \| `consultation` \| `completed` — see `deriveQueueStage()` in `utils/helpers.ts`: terminal → `completed`; with the doctor (`In Consultation`) → `consultation`; not checked in (`isPresentStatus` false) → `not-arrived` (named `waiting-area` before 2026-09-25); on hold → `in-queue`; otherwise `almost-there` (≤5 ahead) or `in-queue` (>5). |
| `patientsAhead`       | Non-held, non-terminal appointments before this one **in the same shift**, in the reception board's order (`orderLikeBoard`): the patient with the doctor, then checked-in patients, then not-arrived ones, each by token. |
| `totalPatientsInQueue`| **Same value as `patientsAhead`** — patients ahead of this one, not the day's total queue size. Kept as a separate field name for API stability; do not reintroduce a "whole day" count under this name. |
| `isCheckedIn`         | `true` once reception has checked the patient in (or they are with the doctor / on hold). Same rule as the reception board (`isPresentStatus`). |
| `delay.isLate` / `delay.lateMinutes` | Live: `estimatedWaitMinutes > clinic threshold`, never while on hold; `lateMinutes` is that live delay. The `notified:{id}` flag is **not** read — it only de-duplicates pushes. |

**Stale cache handling:** No longer applicable in the old sense — every call recalculates fresh, so there's no "cache miss" branch to force a recompute for newly booked appointments; it's unconditional now.

**Token-based running-late:** For token-based appointments (no `appointmentTime`), schedules a running-late BullMQ job using the `projectedStartTime` from the delay tracker when the patient first opens the live-queue screen.

---

## Caching Strategy

### Redis Key Patterns

| Key                                                            | Data                    | TTL | Written by                            | Read by            |
| -------------------------------------------------------------- | ----------------------- | --- | ------------------------------------- | ------------------ |
| `appointment_engine:delay:{clinicId}:{doctorId}:{date}`        | Full QueueDelayData     | 24h | DelayTracker.recalculate              | All services       |
| `appointment_engine:wait:{appointmentId}`                      | Per-appointment wait    | 24h | DelayTracker.storePerAppointmentCache | Patient detail API |
| `appointment_engine:slot_minutes:{clinicId}:{doctorId}:{date}` | Slot duration (number)  | 1h  | DelayTracker.resolveSlotMinutes       | Same               |
| `appointment_engine:threshold:{clinicId}`                      | Running-late threshold  | 1h  | RunningLateNotifier                   | Same               |
| `appointment_engine:time_to_next:{clinicId}:{doctorId}`        | Last broadcast value    | 1h  | TimeToNextService                     | Same               |
| `appointment_engine:notified:{appointmentId}`                  | Flag: notification sent | 24h | RunningLateNotifier                   | Same               |
| `appointment_engine:last_activity:{clinicId}:{doctorId}`       | Last status-change ts   | derived (`MAX_REPEAT_ATTEMPTS × REPEAT_INTERVAL_MS` + 1h margin, currently 4h) | Orchestrator.onStatusChange | RunningLateQueue |

**Note on `last_activity` TTL:** this used to be a hardcoded `2 * 3600` (2h), which was *shorter* than the running-late repeat window (12 × 15min = 3h) — meaning the "recent activity" gap-check silently stopped applying for the last hour of repeat attempts once the flag expired. It's now derived from `MAX_REPEAT_ATTEMPTS`/`REPEAT_INTERVAL_MS` (imported from `runningLateQueue.service.ts` into `orchestrator.service.ts`) plus a 1h safety margin, so it can't drift out of sync with the repeat window again if either constant changes.

### Cache Invalidation

| Event                         | Invalidates                                              |
| ----------------------------- | -------------------------------------------------------- |
| Any status change             | `delay:*` key is overwritten by fresh recalculation      |
| Admin updates clinic settings | `threshold:{clinicId}` explicitly deleted                |
| Day changes                   | All keys auto-expire via TTL                             |
| Slot config changes           | `slot_minutes:*` expires after 1h (eventual consistency) |

**Important:** When clinic settings are updated via `clinicSettingUpsert()`, the Redis key `appointment_engine:threshold:{clinicId}` is explicitly deleted alongside `clinic_settings` and `clinic_autologout` cache keys. This ensures threshold changes take effect immediately.

### Race Condition Handling

The `delay:*` key uses a Lua script for atomic versioned writes:
- Each write increments a version number
- If the version in Redis is already newer, the write is skipped
- Prevents stale data from a slow computation overwriting fresh data

---

## DB Queries — Complete Breakdown

### Per status change (after first trigger of the day):

| #   | Query                                        | Source                | Can be cached             | Speed            |
| --- | -------------------------------------------- | --------------------- | ------------------------- | ---------------- |
| 1   | SELECT appointments WHERE clinic+doctor+date | fetchDailyQueue       | NO (needs fresh statuses) | ~5ms (indexed)   |
| 2   | SELECT slot_minutes FROM clinic availability | resolveSlotMinutes    | YES (1h Redis cache)      | 0ms after first  |
| 3   | SELECT updated_at FROM appointments WHERE id | computeFromInProgress | NO (needs exact time)     | ~1ms (PK lookup) |
| 4   | SELECT threshold FROM clinic_settings        | getThresholdMinutes   | YES (1h Redis cache)      | 0ms after first  |

**First trigger:** 3-4 queries (~8ms total)
**Subsequent triggers (warm cache):** 1-2 queries (~5ms total)

### Per appointment creation (today only):

| #   | Query                                        | Source          | Speed          |
| --- | -------------------------------------------- | --------------- | -------------- |
| 1   | SELECT appointments WHERE clinic+doctor+date | fetchDailyQueue | ~5ms (indexed) |

**Note:** Was already being called; now we use the return value for broadcast (0 new queries).

### Per running-late job fire (every 15 min while doctor inactive):

| #   | Query                                        | Source          | Speed          |
| --- | -------------------------------------------- | --------------- | -------------- |
| 1   | SELECT appointments WHERE clinic+doctor+date | fetchDailyQueue | ~5ms (indexed) |

**Note:** Previously zero DB (cache only). Now 1 indexed query to ensure fresh delay values for broadcast.

**Note:** The orchestrator passes pre-computed `queueData` to all downstream services. RunningLateNotifier and TimeToNextService no longer re-read from Redis — they use the already-fetched data directly.

### Per patient live-queue read (REST page load / socket `join.live-queue`):

| #   | Query                                         | Source                              | Speed          |
| --- | ---------------------------------------------- | ------------------------------------ | -------------- |
| 1   | SELECT appointments WHERE clinic+doctor+date   | `fetchDailyQueue` via `recalculate()` | ~5ms (indexed) |

**This is a deliberate, unconditional query — not a cache-first optimization.** `computeLiveQueuePayload` always recalculates, on every call, regardless of cache warmth (see LiveQueueHelper section). Cost is bounded by how often a patient opens their live-queue screen, not by broadcast frequency, so it doesn't compound with the trigger-volume numbers above. `RunningLateNotifier.evaluateSingleFromCache` (also called on this path) is Redis-only for the common case — 1 DB `INSERT` only occurs if this specific appointment just crossed the running-late threshold and a notification is actually sent.

### Required index:

```sql
CREATE INDEX idx_appointments_clinic_doctor_date 
ON appointments (clinic_id, doctor_id, appointment_date);
```

---

## WebSocket Architecture

### Connection flow:

```
Client connects → ws://server:5000/socket.io/
    │
    ├── Auth middleware verifies JWT
    ├── Auto-joins: user:{userId}, clinic:{clinicId} (for each assigned clinic)
    ├── Sends unread notifications
    └── Sends cached queue state (for dashboard users)
```

### Socket rooms:

| Room                               | Who joins                               | Purpose                                     |
| ---------------------------------- | --------------------------------------- | ------------------------------------------- |
| `user:{userId}`                    | Every authenticated user                | Personal notifications, appointment updates |
| `clinic:{clinicId}`                | Clinic staff (doctor, reception, admin) | Dashboard queue updates                     |
| `live-queue:{clinicId}:{doctorId}` | Patients who called `join.live-queue`   | Live queue tracking screen                  |

### Multi-instance support:

- `@socket.io/redis-adapter` — rooms work across multiple server instances
- Kafka forwarding — cross-node event delivery for custom events
- Graceful fallback — if Redis adapter fails, works in single-instance mode

### Security:

- `join` event validates room access (can't join other users' or clinics' rooms)
- `join.live-queue` validates: today only, active status, ownership
- Auto-removes patients from live-queue when appointment completes

---

## REST Endpoints

### Admin/Doctor:

| Endpoint                                                     | Purpose                              |
| ------------------------------------------------------------ | ------------------------------------ |
| `GET /api/v1/appointments/queue-state?clinicId=X&doctorId=Y` | Full queue on page load              |
| `PUT /api/v1/appointments/:id`                               | Status change (triggers engine)      |
| `PUT /api/v1/clinic/settings`                                | Update threshold (invalidates cache) |

### Patient:

| Endpoint                                                     | Purpose                              |
| ------------------------------------------------------------ | ------------------------------------ |
| `GET /api/v1/patient/appointments/live-queue/:appointmentId` | Queue status for live tracking       |
| `GET /api/v1/patient/appointments/detail/:appointmentId`     | Full appointment detail + queue data |

---

## Error Handling

| Failure                 | Impact                                    | Recovery                                      |
| ----------------------- | ----------------------------------------- | --------------------------------------------- |
| Engine throws error     | API response unaffected (fire-and-forget) | Error logged, next trigger retries            |
| Redis down              | Stale cache reads fail, falls back to DB  | Auto-reconnects, next write repopulates cache |
| Socket emit fails       | Patient misses one update                 | Next status change sends fresh data           |
| NoShow shift fails      | Appointments don't move forward           | Queue recalculates correctly without shift    |
| Lua version conflict    | Stale write skipped                       | Fresh recalculation writes newer version      |
| BullMQ job fails        | Patient misses running-late notification  | Job retries once; next repeat fires in 15 min |
| Redis restart (BullMQ)  | Pending delayed jobs lost                 | Self-healing: next booking re-schedules       |
| Running-late cache cold | processJob recalculates from DB (1 query) | Cache rebuilt; notification still fires       |

---

## Performance Characteristics

| Metric                                                    | Value                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Queries per trigger (warm)                                | 1-2                                                              |
| Queries per trigger (cold)                                | 3-4                                                              |
| Total time per trigger                                    | ~5-10ms                                                          |
| Socket broadcast time                                     | <1ms (in-memory)                                                 |
| Redis read time                                           | <1ms                                                             |
| Max triggers per day (30 patients, confirm+complete each) | ~60                                                              |
| Redis keys per clinic per day                             | ~35 (30 per-appointment + queue + slot + threshold + timeToNext) |
| BullMQ jobs per appointment                               | 1 (auto-cleaned on completion)                                   |
| Running-late job processing cost                          | 0 DB (no-op path) / 1 DB query (notify path) + 3-4 Redis reads   |
| Running-late repeat interval                              | 15 minutes (configurable: REPEAT_INTERVAL_MS)                    |
| Running-late max repeats                                  | 12 (3 hours, configurable: MAX_REPEAT_ATTEMPTS)                  |

---

## Future Modification Guide

### Adding a new trigger status:

1. Update `orchestrator.service.ts` switch statement
2. Add the status to the appropriate handler (or create a new one)
3. No other changes needed — broadcast and cache work automatically

### Adding a new field to patient payload:

1. Update `liveQueueHelper.ts` → `LiveQueuePayload` interface + `buildPayloadFromQueue()`
2. The REST endpoint, socket event (`join.live-queue`), and both broadcast paths (`emitPatientUpdated`, `emitLiveQueueUpdates`) all call `buildPayloadFromQueue()` — one change propagates everywhere. Do not add a second, hand-rolled payload construction anywhere else (see Known Pitfall #3).
3. If the new field needs data that isn't already on `AppointmentDelayEntry`/`QueueDelayData`, keep `buildPayloadFromQueue` itself pure/sync (no Redis/DB calls) — fetch the extra data in the caller and pass it in as a parameter, the way `runningLateMinutes` is handled.

### Adding a new socket event:

1. Add emit call in `queueBroadcast.service.ts`
2. Document in `PATIENT_APP_INTEGRATION.md` or `ADMIN_DASHBOARD_INTEGRATION.md`

### Changing cache TTL:

- Delay data: `DELAY_TTL_SECONDS` in `delayTracker.service.ts`
- Slot/threshold: hardcoded `3600` (1 hour) in respective methods
- Notification flags: `NOTIFIED_FLAG_TTL_SECONDS` in `runningLateNotifier.service.ts`

### Changing running-late behavior:

- Re-notify interval: `REPEAT_INTERVAL_MS` in `runningLateQueue.service.ts` (default: 15 minutes)
- Max repeat count: `MAX_REPEAT_ATTEMPTS` in `runningLateQueue.service.ts` (default: 12 = 3 hours)
- Default threshold: `return 10` in `getThreshold()` (used when Redis cache is cold)
- "Gap between patients" tolerance: uses `threshold` minutes as the recency window

### Adding a new Redis cached value:

1. Use `getRedisKey('your_type', ...parts)` for consistent key naming
2. Always set a TTL (prefer 24h for daily data, 1h for config data)
3. Add cache invalidation where the source data is updated
4. Handle cache miss gracefully (fall through to DB)

---

## Known Pitfalls

These are real bugs found and fixed in this codebase — recorded so they aren't reintroduced.

1. **`Confirmed || Patient Arrived` as "doctor is serving"** — appeared independently in `delayTracker.service.ts` (`isAnyoneBeingServed`), `runningLateNotifier.service.ts` (`isAnyoneBeingServed` and the `Upcoming`-only notify filter), and `runningLateQueue.service.ts` (both "doctor serving?" checks in `processJob`). Since `Patient Arrived` just means checked in/waiting, this was self-referential: a patient's own check-in could suppress their own real-time-delay computation and their own running-late notification. Fix: only `Confirmed` counts as "doctor is busy with someone." When adding a new check anywhere in this engine that asks "is the doctor occupied," grep for `'Patient Arrived'` first — if you're tempted to `||` it with `'Confirmed'`, you're probably about to reintroduce this bug.
2. **BullMQ `Worker` only instantiated via dynamic `import()`** — `RunningLateQueueService`'s constructor creates the `Worker`, but the module was only ever loaded lazily from `appointment.service.ts`. A fresh process (or a multi-instance deployment where some instances never handle an appointment create/reschedule/cancel) could have zero live `Worker`s, silently dropping all running-late notifications. Fixed by a boot-time side-effect import in `server.ts`. Don't remove it, and don't reintroduce another `RunningLateQueueService`-like singleton without a boot-time import.
3. **Stage-derivation logic duplicated in two places** — `buildPayloadFromQueue` (`liveQueueHelper.ts`) and `emitPatientUpdated` (`queueBroadcast.service.ts`) each had their own independent copy of the `queuePosition` branching. Fixed by extracting `deriveQueueStage()` into `utils/helpers.ts` and having `emitPatientUpdated` delegate to `buildPayloadFromQueue` instead of reimplementing it. If you need to change stage derivation, there should only be one place to change it — `deriveQueueStage()`.
4. **Patient-facing cache treated as authoritative for real-time delay** — `computeLiveQueuePayload` used to trust the Redis cache whenever the appointment existed in it, only recalculating on a full miss. Real-time delay for an inactive doctor changes with elapsed wall-clock time alone, with no event to invalidate the cache, so patients could see a frozen `estimatedWaitMinutes` indefinitely. Fixed by always recalculating on this specific (bounded, patient-initiated) read path — see "Per patient live-queue read" in the DB Queries section.
5. **Token-based timelines anchored to midnight** — `computeTokenScheduledMinutes` started its cumulative sum at `0` (midnight) instead of the doctor's session start, despite a docstring claiming otherwise. Because the scheduled timeline and the projected timeline were then produced by the *same* cumulative walk, `estimatedWaitMinutes = max(0, projectedStart − scheduled)` was **structurally always 0** for token queues, and `projectedStartTime` rendered as `"00:00"`. Three further guards each independently suppressed the feature: a `!isTokenBased` condition skipped real-time delay in `delayTracker`, `runningLateNotifier` gated its real-time branch on a `scheduledTime` that was always null for tokens, and `scheduleCheckFromProjectedTime` computed a negative delay from `"00:00"` and returned without ever creating a BullMQ job. Fixed by resolving the session start (`resolveSessionStartMinutes`) and anchoring token slots to it, publishing the derived time as `scheduledTime`, and classifying token-vs-time **per appointment** rather than from `appointments[0]` (Postgres sorts NULLs last, so one timed row made every token row parse as midnight in a mixed queue). If you touch token scheduling, run `delayTracker.token.test.ts` — the whole token path had zero coverage before it, which is how all of the above shipped together.
6. **`parseTimeToMinutes` returning `0` for missing/invalid input** — `0` is a *valid* time (midnight), so coercing "no usable time" to it made bad data indistinguishable from a real midnight appointment. It now returns `null` and callers must decide. The same failure mode caused the reports module's "peak hours are 12 AM" bug; prefer `null` over a sentinel any time the sentinel is inside the valid range.

---

## Deployment Checklist

- [ ] Run DB migration: create index `idx_appointments_clinic_doctor_date`
- [ ] Ensure Redis is running and accessible
- [ ] Verify `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` env vars are set
- [ ] Restart server after deploy (new code must load)
- [ ] Watch startup logs for `[RunningLateQueue] Worker initialized at boot` — if missing, running-late notifications will silently never fire (see Known Pitfall #2)
- [ ] Test: confirm a patient → check dashboard receives `queue.updated`
- [ ] Test: patient calls `/live-queue/:id` → receives queue data with correct `status` and `queuePosition` (values are now `not-arrived`/`in-queue`/`almost-there`/`consultation`/`completed`)
- [ ] Test: book appointment for 5 minutes from now, don't confirm → verify `running_late` notification arrives after threshold, for both `Upcoming` and `Patient Arrived` statuses
- [ ] Test: book appointment, then cancel → verify no `running_late` notification fires
- [ ] Monitor logs for `[AppointmentEngine]` and `[RunningLateQueue]` entries on first day
- [ ] Verify BullMQ dashboard (if available) shows `running-late-check` queue with jobs
