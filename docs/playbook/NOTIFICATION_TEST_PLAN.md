# Notification Center — API reference & verification plan

Covers Phase 1 (engine), Phase 2a (API), 2b (FE data layer) and 2c (UI).
Tick as you go. An unticked box means "not done", never "unknown".

**All three flags must be on**, or you are testing the old path:

| Flag | File | Effect if off |
|---|---|---|
| `NOTIFICATIONS_INAPP_ENABLED=true` | `InfinityMedisetu_BE/.env` | Nothing is written or emitted |
| `NOTIFICATIONS_REGISTRY_ENABLED=true` | `InfinityMedisetu_BE/.env` | Legacy helpers run — old recipients, no `event_key` |
| `VITE_NOTIFICATIONS_ENABLED=true` | `InfinityMedisetuWeb_FE/.env` | Bell dropped from the bundle. **Restart Vite**, a reload is not enough |

---

## 1. API reference

Base: `http://localhost:5000/api/v1/notifications`. All require `Authorization: Bearer <token>`.
Responses use the standard envelope `{ success, message, data }`.

### Notification Center (new — Phase 2a)

| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/inbox` | `kind`, `category`, `actionRequired`, `unreadOnly`, `limit` (≤50), `cursor` | `{ items[], hasMore, nextCursor }` |
| GET | `/unread-count` | — | `{ badge, badgeCapped, cap, total, actionRequired, byCategory }` |
| PUT | `/read` | `{ notificationIds: string[] }` | `{ updated: number }` |
| PUT | `/read-all` | — | `{ count: number }` |

`kind`: `notification` \| `activity`.
`category`: `appointments` \| `payments` \| `prescription` \| `lab` \| `staff` \| `system`.

### Legacy (mobile consumes these; removed in Phase 9)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Array shape, offset pagination |
| GET | `/unread` | Array shape |
| PUT | `/read/:notificationId` | Single mark-read |
| DELETE | `/:notificationId` | Single delete |
| DELETE | `/all` | Delete all for the user |
| POST | `/devices` | Push token registration |
| DELETE | `/devices/:deviceToken` | Push token removal |

### Socket events

| Direction | Event | Notes |
|---|---|---|
| server → client | `notification.new` | Emitted to room `user:<id>` after the row is committed |
| client → server | `notification.mark_read` | `{ notificationId }` — scoped to the caller |
| client → server | `notification.mark_all_read` | — |

---

## 2. Backend verification

- [ ] **Boot clean.** `npm run dev` in the BE. Redis must connect — without it `notify()`
      enqueues into nothing and no notification is ever written.
- [ ] **Registry parity.** `npm run notifications:parity` → `0 mismatches`.
- [ ] **Event docs match code.** `npm run notifications:docs`, then confirm
      `docs/NOTIFICATION_EVENTS.md` is unchanged (a diff means the registry moved without
      the docs being regenerated).

### The three behaviours that matter

- [ ] **Recipients are narrowed.** Book an appointment, then:

      SELECT u.name, u.user_type, n.event_key
      FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.event_key = 'appointment.created'
      ORDER BY n.created_at DESC LIMIT 10;

      **Pass:** assigned doctor + the receptionist responsible for that doctor + patient.
      **Fail:** every admin and receptionist in the clinic → the legacy helper ran; check
      `NOTIFICATIONS_REGISTRY_ENABLED`.

- [ ] **Collapse works.** Reschedule that appointment, re-run the query.
      **Pass:** still one row per recipient, now worded "rescheduled", same `collapse_key`.
      **Fail:** two rows.

- [ ] **Rollback leaves nothing.** Book something that fails validation after the insert
      (a double-booked slot). No `appointment.created` row should exist for it.
      **Fail** here means a `notify()` call is still inside a transaction.

- [ ] **Columns populated.** Any row should have `event_key`, `category`, `priority`, `kind`,
      `click_route` and `tenant_type='clinic'` set — not null.

### Auth (each must be refused)

- [ ] `GET /inbox` with no token → 401.
- [ ] `PUT /read` with **another user's** notification id → `{ updated: 0 }`, and that row
      stays unread in the database.
- [ ] Socket `notification.mark_read` with another user's id → `not found`, row unchanged,
      and the ack carries no notification content.
- [ ] `GET /inbox` never returns a row whose `user_id` is not the caller's.

---

## 2b. Phase 3, 7 and 8 verification (added 2026-08-30)

**Setup.** In the BE `.env`:

    NOTIFICATIONS_INAPP_ENABLED=true
    NOTIFICATIONS_REGISTRY_ENABLED=true
    NOTIFY_STRICT_RECIPIENTS_APPOINTMENT=true

All three are needed. With the registry flag off, none of the code below runs at all —
both new events check it at their call site — and the *result would look like a pass*
(no notification is what you get either way when nothing fires). Confirm the flags are
actually loaded before reading anything into a quiet inbox.

Two accounts in one clinic, logged in side by side: a **doctor** and a **receptionist**.

### S1 — Patient sent in, by reception (the main case)

1. Receptionist marks a patient arrived, then sends them in to the doctor.

- [ ] Doctor's bell increments; the notification reads "*Patient* is in your cabin"
- [ ] It is **pinned** in the Notification Center — priority is `action_required`
- [ ] Clicking it opens that appointment, not a list
- [ ] **Receptionist gets nothing** — they performed the action
- [ ] Both queue boards refresh without a manual reload

      SELECT u.user_type, n.title, n.priority, n.collapse_key
      FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.event_key = 'queue.patient_sent_in' ORDER BY n.created_at DESC LIMIT 5;

      **Pass:** exactly one row, `user_type = 'Doctor'`, `priority = 'action_required'`,
      `collapse_key` **null**.
      **Fail — a receptionist or admin row:** the audience is wrong; this event is doctor-only.
      **Fail — `collapse_key` set:** two patients sent in would overwrite each other, leaving
      the doctor looking at one name while a second waits.

### S2 — Patient sent in, by the doctor themselves (the exclusion)

2. The **doctor** sends a patient in from their own screen.

- [ ] **No notification to anyone.** The doctor does not get told about their own action.

      Re-run the S1 query. **Pass:** no new row. **Fail:** a row addressed to the doctor —
      the `actorType !== 'Doctor'` guard in `queue.service.ts` is not holding.

> Worth doing as an **Admin** too: an admin sending a patient in *should* notify the doctor.
> The rule is "someone other than the doctor moved the patient", not "reception did".

### S3 — Consultation completed

3. Doctor marks the appointment **Completed**.

- [ ] Receptionist is notified: "Consultation done – *Patient*"
- [ ] **Doctor is not** — they are the performer
- [ ] Clicking opens the appointment

### S4 — Re-saving a completed appointment (the duplicate guard)

4. Open that same completed appointment and change something harmless — a note, a payment field.

- [ ] **No second notification.** This is the check most likely to fail: it is hung off
      `statusChanged`, so a re-save must not re-announce a consultation that ended an hour ago.

      SELECT count(*) FROM notifications WHERE event_key = 'consultation.completed';

      **Pass:** count unchanged from S3.

### S5 — The recipient trim is reversible (Standing Rule 7)

5. Set `NOTIFY_STRICT_RECIPIENTS_APPOINTMENT=false`, restart, book an appointment.

- [ ] **Every** Admin, Doctor and Receptionist in the clinic is notified — the legacy-wide set
- [ ] Set it back to `true`, book another: only the doctor and their assigned staff

      **Fail — identical results both ways:** the flag is not reaching `appointmentStaff`,
      and the trim is not reversible, which is the whole point of the flag.

### S6 — Push actually fires (Phase 8, and it never has before)

6. With a device token registered for the doctor, repeat S1.

- [ ] A push arrives alongside the in-app row
- [ ] Turn the doctor's **push** preference off in My Notifications, repeat: in-app row
      arrives, **no push**
- [ ] Perform a staff action that writes `kind='activity'` (apply a discount as a receptionist):
      the admin gets an activity row and **no push, ever** — history must not interrupt

      **Fail — no push in any case:** check `NOTIFICATIONS_INAPP_ENABLED`. Push deliberately
      honours the kill switch even though the in-app insert does not, so that enabling the
      registry for a trial cannot start pushing to real phones. This asymmetry is intended;
      see Phase 8 in the rebuild doc.

### S7 — Renewal reminder, both paths (Phase 8)

7. Trigger `POST /api/v1/subscriptions/reminders/send-to-clinic` as an admin, twice.

- [ ] One inbox row, refreshed rather than duplicated — it collapses per clinic
- [ ] It is **not** mutable away: `subscription.expiring` is non-configurable, so the toggle
      renders locked. A muted renewal warning is a clinic whose staff accounts deactivate
      without notice

      **Fail — two rows:** the manual path is still on the legacy helper. It was migrated on
      2026-08-30; before that it produced a second, uncollapsed warning.

### S8 — Settings screen reflects the registry (Phase 2c / A8)

- [ ] `GET /api/v1/notifications/events` as a doctor lists **10** events; as a receptionist
      **8**; as an admin **17**; as a Super_Admin **18**
- [ ] `queue.patient_sent_in` appears for the doctor and **not** for the receptionist
- [ ] Every row's `key` matches a key in
      `GET /api/v1/settings/notification-preferences/defaults` for the same user

      **Fail — a row with no matching default:** the settings screen would render a toggle
      that saves nowhere.

---

## 3. Frontend verification

- [ ] **Bell appears** in the header after a Vite restart.
- [ ] **Badge matches the server** — compare with `GET /unread-count` → `badge`.
- [ ] **Live delivery.** Book from another browser; the bell updates without a refresh.
- [ ] **Survives a refresh.** Reload the page — the notification is still there.
      This is the localStorage bug being fixed; it used to vanish.
- [ ] **Arrives while closed.** Close the tab, book an appointment, reopen. It should be
      waiting. (Previously impossible — nothing fetched on load.)
- [ ] **Click-through** lands on the right page, from the server's `click_route`.
- [ ] **Single read.** Clicking a notification removes it from the bell and drops the badge by one.
- [ ] **Clear all** empties the panel and zeroes the badge. Refresh — still empty.
- [ ] **Cross-device.** Read on one browser, refresh the other: also read.

### Notification Center — `/notifications`

- [ ] All eight tabs load: Action Required, Appointments, Payments, Prescriptions, Lab,
      Staff, System, Activity.
- [ ] Tab counts match `byCategory` from `/unread-count`.
- [ ] **Action-required items are pinned** to the top of whichever tab they are in, with the
      red treatment and the "Action required" label.
- [ ] **Activity tab** shows `kind='activity'` rows (staff actions — discounts, refunds,
      payment confirmations) and carries **no** unread badge.
- [ ] **Load more** appends rather than replacing, and does not repeat a row already shown.
- [ ] Switching tabs resets to the first page.
- [ ] `?tab=activity` in the URL opens that tab directly.
- [ ] **Mark all read** empties the badges across every tab.

---

## 4. Known gaps — not bugs

- Notifications dispatched **before** the flags were switched on were suppressed at source
  and are not recoverable. Book fresh ones.
- The new routes have **no Swagger entries** yet — test them by URL, not `/api-docs`.
- **Push still goes out on the legacy SNS path**; only in-app runs through the queue.
- **Email / SMS / WhatsApp are deliberately untouched** (Standing Rule 11). Patient WhatsApp
  on booking, reschedule and no-show should behave exactly as before — if it changed,
  that *is* a bug.
- Phases 3–8 have not run, so these events do **not** exist yet: `queue.patient_sent_in`,
  `consultation.completed`, `prescription.completed`, and `payment.received` to staff.

---

## 5. Reporting a failure

Include: which box failed, the SQL output or API response, whether all three flags were on,
and whether the row exists in `notifications`. Whether the row exists is the fastest split —
row present but not on screen is a frontend problem; no row at all is the engine.
