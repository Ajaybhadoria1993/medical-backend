# Realtime Rollout Plan

Plan only — no code changed. Answers the "Real-Time Data Synchronization"
requirement list. Read `REALTIME_SIGNAL_CONTRACT.md` first: it is the
architecture this plan rolls out, not something this plan replaces.

## Headline finding

The requested "system-wide real-time synchronization architecture" **already
exists and is live**: `src/main/realtime/` (signal bus + Redis version
counters + section→room map) on the backend, `useSectionSync` on the web
frontend. It is generic — the socket carries `{section, v, reason, at}` and
never state, and the client refetches that section's existing REST snapshot.

So requirement §1 (central architecture, not screen-by-screen) is **met**.
What is missing is **coverage**: only appointments and the queue emit signals.
Vitals, payments, lab, prescriptions and staff status have no call sites,
which is why they still need a manual refresh. Notifications are already
covered by their own live socket channel and are out of scope here.

This is deliberately cheap work per feature: one `realtimeBus.notify(...)`
after the committed write on the backend, one `useSectionSync` on the screen.
No new transport, no new sockets, no per-screen protocol.

## Audit — current state against the checklist

| Requirement | State | Gap |
|---|---|---|
| §1 Central architecture | **Done** | — |
| §2 Web | **Done** | — |
| §2 Mobile | **Not in this workspace** | Mobile app is a separate repo; the contract doc is the deliverable it builds against. Parity checklist below. |
| §3 Vitals | **Missing** | `updateAppointment` signals only when status or date changed; a clinical/vitals-only edit is silent. This is the exact reported bug. |
| §4 Appointment created/updated/cancelled/rescheduled | **Done** | `signalAppointmentChange` (`appointment.service.ts:1999`), incl. cross-day reschedule. |
| §5 Check-in / queue / waiting | **Done** | Queue actions signal; `board:` + `queue:` sections. |
| §6 Sent to cabin / hold / skip / resume | **Done** | `queue.service.ts:199,272,323,341`. |
| §7 Consultation start/complete | **Done** via status change | Every status write signals. The richer state machine it would need to *express* is a data-model gap — see Not in scope. |
| §8 Prescription completed | **Partial** | Auto-complete signals (`appointment.service.ts:3075`). Prescription *created*, edited, and PDF-ready do not. |
| §9 Payments | **Missing** | No signal on any payment-status write. |
| §10 Lab | **Missing** | No signal in `lab.service.ts` or `appointmentTest.service.ts`. |
| §11 Notifications | **Done — out of scope here** | Live notification delivery is already handled: `notification.initial_unread` on connect plus `mark_read`/`mark_all_read` in `socketManager`, fed by the Kafka notification consumer. Not touched by this plan. |
| §12 Staff status | **Missing** | No signal. |
| §14 Role/permission control | **Done** | Rooms are correctly scoped (`clinic:{c}`, `clinic:{c}:role:{r}`, `clinic:{c}:doctor:{d}`), and signals carry no data so nothing leaks. Receptionist→doctor assignment filtering (Phase 6) is now enforced in `joinScopedRooms` via `StaffScopeService`. |
| §15 Consistency / reconnect | **Done** | Inequality version compare, 250 ms debounce, visibility gating, reconnect resync, `reconnectionAttempts: Infinity`. |
| §16 Audit & testing | **This plan + Phase 7** | — |

**Re-verified against the code, not just this doc's own claims** (branch
`docs/realtime-rollout-plan`, checked directly): `src/main/realtime/utils/sections.ts`
still defines only `queue`, `board` and `appointment` — no `encounter`, `billing`,
`lab`, `pharmacyQueue` or `staff` section exists, and `report.service.ts`, the lab
module and every payment path have zero `realtimeBus`/`target.*` call sites. The
table above is still accurate: nothing in Phases 1–5 has shipped since this plan
was written.

### Web screen coverage — where §2 actually reaches today

§1/§2 being "Done" is about the architecture existing, not every screen using it.
Grepping the frontend for actual `useSectionSync` call sites (not just the section
definitions) gives the real per-screen picture:

| Screen / hook | Section it watches | Covers |
|---|---|---|
| `AppointmentDetails.tsx` | `queue:{clinic}:{doctor}:{date}` | Refetches the open appointment on any queue/status change |
| `DoctorDash.tsx` | `queue:{clinic}:{doctor}:{date}` | Doctor's queue board + dashboard stats |
| `ReceptionistDash.tsx` (+ `useReceptionLiveQueueRealtime`) | `board:{clinic}` | Reception's live queue card, appointment list, stat cards |
| `Appointment.tsx` (+ `useClinicQueueRealtime`) | `queue:{clinic}:{doctor}:{date}` | Appointment list/calendar, queue status bar |
| `NewAppointment.tsx` (+ `useAppointmentRealtimeSync`) | `board:{clinic}` | Booking screen's token/slot-availability grid |

**Gap this surfaces that the requirement-line audit above doesn't call out on its
own**: the backend already defines `target.appointment(appointmentId, patientId)` —
a section addressed to the *patient's own room* — but **no frontend screen
subscribes to it**. `grep -rn "sectionIds.appointment" src` in the web repo returns
nothing. So a patient viewing their own appointment/booking status in the patient
portal gets no realtime update at all today; this is the same class of bug as the
vitals report (§3), just on the patient-facing side instead of staff-facing, and
it's free to fix once a patient screen calls `useSectionSync` on that existing
section — no backend work needed, the section and its signal already exist.

## Phases

Ordered by operational pain. Each phase is independently shippable and
independently testable; stopping after any phase leaves the system working.

### Phase 0 — Patient portal *(zero backend work, do this first)*

Frontend only. The `appointment:{id}` section and its signal already exist and
already fire on every appointment write (`signalAppointmentChange`) — nothing on
the backend needs to change.
- Add `useSectionSync({ sections: [sectionIds.appointment(appointmentId)] })`
  (patient's own appointment id) to the patient-portal appointment/booking-status
  screen(s) (`PatientAppointment.tsx` and any patient detail view showing live
  status), refetching that screen's own query on change.
- Acceptance test: clinic updates a patient's appointment status while that
  patient has the portal open in another tab/device — status changes with no
  refresh.

### Phase 1 — Vitals & the clinical encounter  *(the reported bug)*

Backend
- Add `target.encounter(clinicId, doctorId, appointmentId)` to
  `realtime/utils/sections.ts`, emitted to `rooms.clinicDoctor(...)`.
  Needed because the existing `appointment:{id}` section goes to the
  **patient's** room only — no staff socket is in it, so a doctor's open
  patient screen can never be reached today.
- In `appointment.service.ts`: widen the signal condition around line 2925 so a
  clinical-fields-only update (`AppointmentClinicalModel` insert/update at
  2467–2480 and 3159–3171) also signals, with reason `encounter.vitals_updated`.
  Signal the encounter section *and* the doctor's queue section.

Frontend
- `AppointmentDetails.tsx` already calls `useSectionSync` on the queue section
  (line 616); add the encounter section and invalidate the clinical/vitals
  query. This is the "doctor sees vitals without refreshing" acceptance test.

### Phase 2 — Payments
- Signal after every committed payment-status write (`appointment.service.ts`,
  `paymentReservation.service.ts`, `cancellationPolicy`, lab invoice paths):
  encounter + `board:{clinicId}` + a new `billing:{clinicId}` section.
- Frontend: `paymentHistory/`, billing views, and the reception board subscribe.
- Covers §9 including "no second receptionist sees stale unpaid".

### Phase 3 — Lab
- New sections `lab:{labId}` (lab worklist) and reuse `encounter:` for the
  ordering doctor.
- Call sites: test created/assigned, sample status
  (`appointmentTest.service.ts:5470,5874,6146`), result published
  (`labResult.service.ts`).
- Frontend: `pages/lab/`, `labDashboardApi`, plus doctor/reception encounter view.

### Phase 4 — Prescription

**Corrected after auditing the reports modules.** The prescription write path is
*not* in `src/main/prescription/` — that module is scan/AI/agent work. Prescriptions
and report cards are owned by `src/main/reports/`
(`PrescriptionModel`, `PrescriptionTemplateModel` in `reports.model.ts`), and the
writes are in `report.service.ts`:

| Call site | Reason to emit |
|---|---|
| `createPatientReportCard` (line 153) | `prescription.created` |
| `updatePatientReportCard` (line 2316) | `prescription.updated` |
| `generatePdfAndSendNotifications` (line 637) | `prescription.pdf_ready` |

`generatePdfAndSendNotifications` already selects `patientId`, `clinicId` and
`doctorId` for its notification, so signalling from there costs **zero extra
queries** — the ids are in hand.

- Reuse `encounter:`; add `pharmacyQueue:{clinicId}` for
  `pharmacy/services/prescriptionQueue.service.ts`.
- `src/main/reports/` currently has **no realtime imports at all**.

### Phase 5 — Staff status
- Signal `staff:{clinicId}` from `staffDirectory.service.ts` / `user.service.ts`
  on any staff availability or status write, emitted to `rooms.clinic(...)`.
- Frontend: staff directory and any header/sidebar presence indicator subscribe.

Notifications are **not** part of this phase: live notification delivery
already works over its own socket channel and is deliberately left alone.

### Phase 6 — Role & permission tightening — **Done**

Realtime work here was exactly one change: narrow doctor-room membership in
`SocketManager.joinScopedRooms` so a receptionist joins only their assigned
doctors' rooms, instead of every doctor in the clinic.

Originally recorded as **blocked** on the receptionist→doctor assignment model
not existing — that was wrong. Re-checked directly against the code: it
already exists (`src/main/permissions/models/staffAssignment.model.ts` —
`StaffDoctorAssignmentModel` + `StaffScopeModel`), with a working admin-facing
`PUT /api/v1/permissions/users/:userId/assignment` to configure it, and a
service (`StaffScopeService.getAccessibleDoctorIds`) already used elsewhere in
the codebase to enforce it on reads. `joinScopedRooms` was the one place that
still ignored it and joined every doctor's room regardless. Fixed: it now
calls `getAccessibleDoctorIds` per connecting Receptionist/Admin and joins
only what comes back (`null` = unrestricted, still joins every doctor — Admin
always gets `null`; a `Receptionist` with no configured scope also defaults to
`null` so deploying this never blanks a live dashboard mid-shift).

Room membership is only evaluated at connect time, not on a timer, so an
assignment changed mid-session takes effect on that socket's next reconnect —
not instantly. Phases 1–5 shipped without this regardless: signals carry no
data, so the worst case beforehand was an authorized-but-uninterested user
making one wasted refetch, never a leak.

### Phase 7 — Audit, cleanup, test
- Delete the legacy data-carrying events `queue.updated` and
  `timeToNext.updated` **once mobile confirms it does not consume them**.
  (Realtime cleanup — they are superseded by the sections above.)
- Two-browser matrix: doctor+receptionist, 2 receptionists, 2 doctors, 2
  devices, across vitals / appointments / queue / consultation / prescription /
  payment / lab / staff. (Notifications are already live; re-test only to
  confirm the new signals did not regress them.)

### Mobile parity (separate repo)
Mobile needs no backend work beyond the phases above — it consumes the same
`realtime.section.changed` event and `GET /api/v1/realtime/versions`. Deliver:
the contract doc, the section-id list, and a port of `useSectionSync`'s four
guards (watched-section, foreground, version inequality, 250 ms debounce) plus
resync on app-foreground and on reconnect.

## Not in scope

Everything above is realtime transport and coverage only: emit a signal after a
committed write, subscribe a screen to it. The items below surfaced during the
audit and are **deliberately excluded** — they are feature or data-model work
that happens to touch the same screens. None of them blocks Phases 1–5.

| Excluded | Why it is not realtime work | Effect on this plan |
|---|---|---|
| **Queue state machine / `apointment_status` enum** — no `In Consultation`, `On Hold` or `Skipped` value, and no stored pointer for who is currently with the doctor | A missing data model, not a missing transport. Every status write already signals; the states just are not representable yet. | None. Consultation sync works for the statuses that exist today, and gains the new ones free if they are ever added. |
| **Notifications** | Already live over their own socket channel (`notification.initial_unread`, `mark_read`, `mark_all_read` + the Kafka consumer). Not being migrated onto the bus. | None. Re-test in Phase 7 only to confirm no regression. |
| **RTK Query stale-cache config** (`refetchOnMountOrArgChange`, long `keepUnusedDataFor`) | A separate class of refresh bug: data stale *on mount*, with no socket involved. Realtime cannot fix it and does not cause it. | None, but worth a separate pass — a screen can be perfectly subscribed and still open stale. |
| **`reportsOverview` analytics** — 12 read endpoints plus one `POST /custom/run` that runs a report rather than writing state | Read-only analytics with no writes to propagate. Dashboards are point-in-time by nature, and its services are 600–1300 lines of aggregation each — live-syncing them would re-run the most expensive queries in the backend on every clinic event. | None. Deliberately excluded from every phase. |
| **Mobile app implementation** | Separate repository. No backend work beyond the phases above. | None. See Mobile parity above for what it consumes. |

## Cost shape

Phase 0 is a frontend-only hook wire-up, no backend change — ship it first.
Phase 1 is small and fixes the reported bug. Phases 2–5 are each roughly one
sections entry + 2–5 notify call sites + 1–3 frontend hooks. Phase 6 turned out
to be the one-rule change it was always expected to be, once its assumed
blocker was found to already exist. Phase 7 is testing.
