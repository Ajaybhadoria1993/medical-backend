# Patient App — Queue Engine Changes

What the mobile app needs to change, and what it can now do that it could not
before. The full contract stays in
[PATIENT_APP_INTEGRATION.md](./PATIENT_APP_INTEGRATION.md); this is the delta
and the reasoning.

Nothing here is a breaking change. Every field the app reads today still exists
and still carries the same value. Two of them are now **deprecated** because
their names describe something other than what they hold.

---

## 1. Read this first — the three time numbers

The single most important change. These answer different questions, and using
the wrong one shows the patient something false.

| field | question it answers | new? |
|---|---|---|
| `delayMinutes` | How late is this appointment against **its own slot**? | renamed |
| `minutesUntilSeen` | How long until **this patient** is seen, from now? | **new** |
| `tentativeStartTime` | What clock time will they be seen at? | existing |

**`delayMinutes` is not the wait.** A patient booked at 15:00 and projected at
15:00 has `delayMinutes: 0` while still having three people ahead and two hours
to wait. Rendering that as "Est. wait: 0 min" tells them they are next.

```
Show minutesUntilSeen  wherever the UI says "wait"
Show tentativeStartTime wherever the UI shows a time
Show delayMinutes       only on a "running late" banner
```

`minutesUntilSeen` is `null` when there is nothing to project from. Show
"we'll update you shortly" — never `0`.

### Deprecated

| field | replacement | why |
|---|---|---|
| `estimatedWaitMinutes` | `delayMinutes` | same value; the name says "wait" but it measures lateness against the slot |
| `totalPatientsInQueue` | `patientsAhead` | equal to `patientsAhead` by construction — **not** the size of the day's queue |

Both still ship. They will be removed once this app has migrated; tell us when.

---

## Schedule shift — an appointment's time can now change during the day

Previously `appointmentTime` was fixed once booked, and only the projection
around it moved. That is no longer true.

When a doctor arrives late, reception can shift the day: the stored
`appointmentTime` of every remaining appointment moves forward together (09:30
becomes 11:30), so the slots behind the delay stay usable. The patient's booked
time itself has changed — this is a reschedule, not an estimate.

**No contract change and no release needed.** `appointment.updated` already
carries `appointmentTime` and already fires on the `user:{userId}` room the app
is always joined to. Nothing new to subscribe to.

**The one thing to check:** the app must *re-render from* `appointment.updated`,
not only toast it. An app that caches `appointmentTime` from the initial fetch
and treats the event as a notification will keep showing 9:30 after the
appointment has moved to 11:30 — the worst possible failure for this feature,
because the patient arrives two hours early having been told nothing.

`delayMinutes` resets to ~0 after a shift, and correctly so: the promise is now
11:30, and a doctor starting at 11:30 is on time against it. Lateness is
measured against the new time, not the original booking.

---

## 2. New fields

```jsonc
{
  "delayMinutes": 150,
  "minutesUntilSeen": 90,
  "serverTime": "2026-08-19T11:30:15.549Z",

  "nowServingTime": "13:00",
  "nowServingLabel": "1:00 PM",
  "nowServingStatus": "In Consultation",
  "isMyTurn": false,

  "tentativeStartTime": "18:30",
  "tentativeRangeMinutes": 28,
  "isTentative": true,

  "consultationBasis": "learned"
}
```

**`serverTime`** — the server's clock when the payload was built. Drive
countdowns from this, not the device clock: a phone several minutes fast counts
down to the wrong moment. Also lets you grey out a payload that arrived a while
ago.

**`nowServingLabel`** — already display-ready: `"Token 12"` on a token queue,
`"1:00 PM"` on a time-based one. **Render it verbatim.** The token-or-time
choice is made server-side so clients cannot disagree about it. A label of
`"13:00:00"` would be a server bug — report it.

**`nowServingStatus`** — `"In Consultation"` while the doctor is with someone,
`null` between patients.

**`isMyTurn`** — true when the patient being consulted is this one. Saves
comparing ids.

**`tentativeRangeMinutes`** — the ± band around `tentativeStartTime`. It widens
with the queue ahead, because a prediction six patients out is far softer than
the next one in. Render it: *"around 6:30 PM, give or take 28 minutes"*.

**`isTentative`** — redundant (true exactly when `tentativeStartTime` is
present) and carried deliberately, so a time cannot be rendered as a commitment
*by omission*. **Never show `tentativeStartTime` without an "estimated" label.**

**`consultationBasis`** — diagnostic, not content. Do not show it to patients;
it explains a surprising estimate during support calls.

| value | meaning |
|---|---|
| `learned` | measured from this doctor's real consultation history |
| `doctor` | configured for this doctor at this clinic |
| `clinic` | clinic-wide default |
| `slot` | the booking grid |
| `default` | nothing configured — 30 minutes |

> If you see `"configured"`, the server predates this change and needs a
> restart. That value was split into `doctor` and `clinic`.

### Time formats

Every published time is `HH:MM`, 24-hour, normalised server-side — except
`nowServingLabel`, which is 12-hour and display-ready. Previously a stored
`"13:00:00"` and a derived `"13:00"` both reached clients in the same payload.

---

## 3. Events

### Client → server

| event | payload | notes |
|---|---|---|
| `join.live-queue` | `{ appointmentId, latitude?, longitude? }` | joins the queue room; lat/long optionally attaches a clinic ETA |
| `queue.refresh` | `{}` | **new** — on-demand refresh, zero DB queries |
| `leave.live-queue` | — | leaves the room |
| `clinic.eta` | `{ appointmentId, latitude, longitude }` | travel time to the clinic |
| `notification.mark_read` | `{ notificationId }` | |
| `notification.mark_all_read` | — | |
| `call.reception` / `call.acknowledge` / `call.decline` / `call.cancel` / `call.wait` | | call alerts |

### Server → client

| event | when | act on it |
|---|---|---|
| `queue.update` | on join, on refresh, and whenever the queue materially changes | **primary** — replace your queue state |
| `queue.error` | **new** — any `join.live-queue` / `queue.refresh` rejection | show the reason; see codes below |
| `queue.completed` | the appointment left today's queue | close the queue screen; the socket has left the room |
| `running_late` | the doctor crosses the clinic's threshold | persistent banner, **not** a toast — the delay lasts all morning |
| `appointment.updated` | queue changes, to `user:{userId}` | same payload shape as `queue.update` |
| `appointment_shifted` | an earlier slot opened up | tell them their time moved **earlier** |
| `timeToNext.updated` | clinic dashboards | ignore in the patient app |
| `clinic.eta.result` | reply to `clinic.eta` | |
| `notification.*` | | unread list and read receipts |

### `queue.error` codes

Every rejection now emits this event **and** calls the ack, so a client that
emitted without a callback still sees the reason. Previously a rejection was
silent and indistinguishable from a hung screen.

| code | cause |
|---|---|
| `ACCESS_DENIED` | not this patient's appointment (nor a linked family member) |
| `NOT_TODAY` | the appointment is not today |
| `TERMINAL_STATUS` | already Completed / Cancelled / NoShow |
| `NOT_FOUND` | unknown appointment id |
| `NOT_JOINED` | `queue.refresh` before `join.live-queue` |
| `UNAUTHENTICATED` | no user on the socket |
| `INTERNAL_ERROR` | server-side failure — details are in the server log, not the payload |

---

## 4. `queue.refresh` — the one new capability

```js
socket.emit("queue.refresh", {}, (res) => {
  // { status: "success", inQueue: true, fromCache: true }
});
```

No payload: the appointment, clinic and doctor were stored on the socket at
join time, so there is no lookup and no ownership re-check.

**Use it for** pull-to-refresh, a screen regaining focus, waking from
background, and after a reconnect.

**Why it exists.** The server only broadcasts when something materially
changed — deliberately, so it does not push an identical payload to every
patient every minute. That left a client with no way to ask "what is it right
now?". This is that.

**Do not poll it.** Throttled to one per five seconds per socket; a throttled
call acks `status: "throttled"` and emits nothing. For a live countdown, use
`serverTime` + `tentativeStartTime` and tick locally.

| ack | meaning |
|---|---|
| `success`, `inQueue: true` | a `queue.update` was emitted |
| `success`, `inQueue: false` | left the queue; `queue.completed` was emitted |
| `throttled` | under the five-second floor |
| `error` | see `queue.error` |

`fromCache: false` means the cache had expired and the server recalculated —
correct, but should be rare.

---

## 5. What the app should compute, and what it should not

**Compute locally**

- The countdown between pushes: `tentativeStartTime − serverTime`, ticking
  every second. This is why `serverTime` exists.
- Staleness: grey out or show "reconnecting" when the last `serverTime` is more
  than a couple of minutes old.

**Do not compute locally**

- *Wait time.* Use `minutesUntilSeen`. Deriving it from `patientsAhead ×
  avgConsultationMinutes` ignores the doctor's actual pace, breaks, announced
  delays, and an overrunning consultation — all of which the server already
  accounts for.
- *Which of token or time to show.* Use `nowServingLabel`.
- *Whether the doctor is late.* Use `isRunningLate`. It is derived from the
  delay against the clinic's configured threshold, which the app does not know.

---

## 6. Suggested enhancements

Roughly in order of value to a patient.

**1. Replace "wait: N minutes" with a clock time.** `tentativeStartTime` with
its band reads far better than a duration a patient has to add to the current
time themselves. *"Around 6:30 PM (± 28 min)"* beats *"in 90 minutes"*.

**2. Make the running-late notice persistent.** It arrives as an event but the
delay lasts hours. A banner that survives until it clears; a toast does not.

**3. Show `nowServingLabel` prominently.** "Now serving Token 12" is the single
most reassuring thing on a queue screen — it is visible proof the queue is
moving.

**4. A local countdown.** With `serverTime` the app can tick every second
between pushes, so the screen feels live even though the server pushes roughly
every five minutes.

**5. Handle `isMyTurn` explicitly.** A distinct "You're next — please go in"
state, ideally with a local notification. This is the moment the whole feature
exists for.

**6. Widen language with the band.** When `tentativeRangeMinutes` is large,
soften the copy: *"roughly 6:30 PM"* rather than *"6:30 PM"*. The server is
already telling you how confident it is.

**7. Call `queue.refresh` on app foreground.** Cheap, and it removes the "was
this screen stale?" question entirely.

**8. Subscribe to `queue.error`.** Today a failed join looks identical to a
slow one. The codes distinguish "not your appointment" from "not today" from
"server problem".

---

## 7. Migration checklist

- [ ] Swap `estimatedWaitMinutes` → `delayMinutes` (same value, clearer name)
- [ ] Swap `totalPatientsInQueue` → `patientsAhead`
- [ ] Use `minutesUntilSeen` wherever the UI says "wait"
- [ ] Render `tentativeStartTime` with `tentativeRangeMinutes` and an
      "estimated" label — never the time alone
- [ ] Render `nowServingLabel` verbatim; stop deriving token-or-time
- [ ] Drive countdowns from `serverTime`
- [ ] Subscribe to `queue.error` and handle the codes
- [ ] Call `queue.refresh` on foreground / pull-to-refresh
- [ ] Persist the `running_late` notice instead of toasting it
- [ ] Confirm migration so `estimatedWaitMinutes` and `totalPatientsInQueue`
      can be removed
