# Appointment Engine — How It Works

## Overview

The Appointment Engine is a real-time appointment flow management system that runs automatically in the backend. It activates whenever an appointment status changes and provides five core capabilities:

1. **Estimated Delay Tracking** — Calculates how long each patient will wait
2. **Running-Late Notifications** — Alerts patients when their doctor falls behind
3. **Time-to-Next Display** — Shows doctors/receptionists minutes until next patient
4. **No-Show Schedule Shifting** — Moves appointments forward when someone doesn't show up
5. **Real-Time Queue Broadcasting** — Pushes queue changes to all connected clients instantly

---

## Trigger Flow

The engine fires automatically whenever the backend updates an appointment status. No frontend action is needed beyond the existing status change calls.

```
Appointment Status Change (via existing API)
         │
         ▼
┌─────────────────────────────────────┐
│  AppointmentEngineOrchestrator      │
│  .onStatusChange(appointment, prev) │
└─────────┬───────────────────────────┘
          │
          ├── Status = "Completed" or "Patient Arrived"
          │     1. Recalculate delays for entire doctor queue
          │     2. Evaluate running-late notification thresholds
          │     3. Compute & broadcast time-to-next
          │     4. Emit queue.updated → clinic room
          │     5. Emit appointment.updated → each patient room
          │
          └── Status = "NoShow"
                1. Shift subsequent appointments forward (earlier)
                2. Notify shifted patients (push + socket)
                3. Broadcast schedule change to clinic room
                4. Recalculate delays for entire doctor queue
                5. Emit queue.updated → clinic room
                6. Emit appointment.updated → each patient room
```

---

## Core Concepts

### Estimated Wait Time

For each appointment in a doctor's daily queue, the engine computes how many minutes the patient will wait beyond their scheduled time.

**Calculation:**
- Walk appointments in queue order (by time or token number)
- Each appointment's projected start = max(scheduled time, end of previous appointment)
- Estimated wait = projected start − scheduled time (in whole minutes, minimum 0)

**Duration resolution:** Each appointment's duration is resolved as:
1. `appointmentDurationMinutes` on the record (varchar, parsed as integer)
2. `slotMinutes` from ClinicAvailability or ClinicDateAvailability
3. Default: 30 minutes

### Running-Late Threshold

Each clinic can configure a `runningLateThresholdMinutes` value (5–60 minutes, default 10). When a patient's estimated wait exceeds this threshold, they receive a push notification and socket event.

The notification is sent only **once per upward threshold crossing** — if the delay drops below and rises again, a new notification is sent.

### No-Show Forward Shift

When an appointment is marked "NoShow", all subsequent "Upcoming" or "Confirmed" appointments shift forward (to earlier times) by the no-show appointment's duration. If a shifted time would land within a clinic break, the appointment is placed at the break's end time.

For token-based queues (no appointmentTime), times are not modified — instead the estimated wait times are recalculated.

### Time-to-Next

Displayed to doctors/receptionists:
- **Patient currently being seen:** max(0, ceil(duration − elapsed since arrival))
- **No patient being seen:** max(0, next projected start − now)
- **No more appointments:** null (hide the display)

Broadcast to the clinic room only when the value changes by ≥ 1 minute.

---

## Caching & Performance

| Data                        | Storage                                                         | TTL      |
| --------------------------- | --------------------------------------------------------------- | -------- |
| Queue delay data            | Redis (`appointment_engine:delay:{clinicId}:{doctorId}:{date}`) | 24 hours |
| Notification sent flag      | Redis (`appointment_engine:notified:{appointmentId}`)           | 24 hours |
| Last time-to-next broadcast | Redis (`appointment_engine:time_to_next:{clinicId}:{doctorId}`) | 1 hour   |

If Redis is unavailable, delays are computed on-the-fly from the database and results are still returned to callers.

---

## Error Handling Philosophy

- The engine **never** blocks or fails the original appointment status change
- All engine operations are fire-and-forget
- Individual service failures (notifications, broadcasts) are logged but don't stop other services from running
- Database transaction failures during no-show shifts roll back cleanly — no partial state
- WebSocket broadcast failures are logged and ignored (patients get data on next API call)
