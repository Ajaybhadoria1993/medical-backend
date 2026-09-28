# Doctor Dashboard (v2) — Architecture & Data Flow

Reference doc for `GET /api/v2/dashboard/doctor` and `GET /api/v2/dashboard/doctor/profile`,
which back the Doctor Dashboard page (`InfinityMedisetuWeb_FE/src/pages/dashboard/doctorDash/DoctorDash.tsx`).

Implementation: `src/main/dashboard/services/dashboard.service.ts`
(`DashboardService.getDoctorDashboardDataV2`, `DashboardService.getDoctorDashboardProfile`).

v1 (`/api/v1/dashboard/doctor`) still exists and is unchanged — v2 is additive, not a breaking
replacement. See `docs/dashboard-apis.md` for the older v1 FE integration reference.

## Why two endpoints

The dashboard page makes exactly **2** API calls, split by how often the data actually changes —
not by which UI card it feeds:

| Endpoint | Contains | Change frequency |
|---|---|---|
| `GET /api/v2/dashboard/doctor` | Status counts, earnings, trend series, pending appointments, today's token shifts, top symptoms, new/returning patients | Every booking / check-in / status change |
| `GET /api/v2/dashboard/doctor/profile` | `doctorName`, onboarding `setupProgress` | Once per onboarding step / profile edit |

Bundling both behind one cache/TTL meant near-static data (`doctorName`, `setupProgress`) was
refetched on the same 45s cadence as live queue data for no reason. Splitting them means the
profile card doesn't refetch every time an appointment status changes.

An earlier iteration also called `/api/v1/dashboard/today-overview` just to get new/returning
patient counts — that endpoint computes over a **hardcoded 30-day window** regardless of the
dashboard's selected date range, which silently disagreed with every other card, and pulled a
large unrelated payload (today's revenue, full appointment list, weekly symptom counts) for 2
numbers. New/returning is now computed directly inside `getDoctorDashboardDataV2` using the
user-selected range, and that endpoint is no longer called from this page.

## Two-tier caching inside `/doctor`

A single request can still trigger DB work, but it's split into two independently-cached slices
so a miss on one doesn't force recomputation of the other:

| Tier | Cache key | TTL | Contains | Why this TTL |
|---|---|---|---|---|
| **Live** | `doctor_dashboard_v2_live:{clinicId}:{doctorId}:v{version}:{start}:{end}` | 45s | Status counts (confirmed/pending/waiting/completed/cancelled/no-show/remaining), earnings, daily trend series, pending-appointments list | Doctors act on "who's waiting right now" — this must stay close to real-time |
| **Analytics** | `doctor_dashboard_v2_analytics:{clinicId}:{doctorId}:v{version}:{start}:{end}` | 300s (5min) | Top symptoms, new-vs-returning patients | These are slow-moving aggregates — one new booking doesn't meaningfully shift "busiest hour" or new/returning classification, so a longer TTL trades negligible staleness for a much higher cache-hit rate |

Both are checked in parallel at the top of the request (`Promise.all([redisClient.get(liveKey), redisClient.get(analyticsKey)])`).
Each missing slice is recomputed and re-cached independently; the final response is assembled by
merging whichever pieces came from cache with whichever were freshly computed. There is **no
outer cache** wrapping the whole response — the two inner caches already serve that purpose, and
assembling the final JSON from them is cheap object construction.

Both keys embed the clinic's dashboard cache version (`CacheKeys.dashboardCacheVersion`), which
every appointment change bumps after commit — via `signalAppointmentChange`, or directly for an
update that sends no signal. A bump retires every doctor's and every range's entry in one O(1)
write, so a cancel or booking shows on the next refetch instead of after the TTL. Old keys are
never read again and expire on their own; there is no pattern wipe.

The `profile` endpoint uses a single cache (`doctor_dashboard_profile:{clinicId}:{doctorId}`,
1hr TTL) **with** explicit invalidation — `DashboardService.invalidateDoctorDashboardProfile(clinicId)`
is called from `UserService.updateOnboardingProgress` whenever onboarding state changes, since
that data changes rarely but must reflect instantly when it does.

## Query breakdown (live tier, on cache miss)

Four queries, run concurrently via `Promise.all`:

1. **`getStatsForRange(currentStart, currentEnd)`** and **`getStatsForRange(previousStart, previousEnd)`**
   — one query each (not per-status sequential queries), joining `AppointmentModel` + `AppointmentPaymentModel`,
   using `COUNT(CASE WHEN status = X THEN 1 END)` to get every status count in a single pass, plus
   `SUM(...)` for earnings (Paid = full price, Refunded = price minus refunded amount, matching the
   `revenue-overview` endpoint's logic) and `COUNT(DISTINCT patientId)` for unique patients. The
   "previous" call exists only to compute `hikePercent` trend badges.
2. **Daily trend query** — `GROUP BY DATE(appointmentDate)`, backfilled with zero-count days so the
   frontend trend chart doesn't have gaps.
3. **Pending appointments list** — joins patient/profile/payment/symptom data, `LIMIT 10`. Symptom
   name resolution (`clinicSymptomIds` → names) runs as a follow-up query gated on whether any
   pending row actually has clinic-specific symptom IDs.

`remaining` (status count) is derived as `total - completed - cancelled - noShow` — i.e. anything
not yet finalized (Upcoming/Confirmed/Pending/Patient Arrived/Missed), not a separately stored status.

## Query breakdown (analytics tier, on cache miss)

Three queries, run concurrently:

1. **`topSymptoms`** — top 5 symptoms on this doctor's non-cancelled appointments in the selected
   range. Counts built-in `common_symptoms` (underscores shown as spaces) and clinic-defined
   `clinic_symptom_ids` together; `percent` is the share of all mentions, not just the top five.
   Unlike the admin card (`clinic_symptom_counts`, clinic-wide, current week), it is doctor-scoped.
2. **`getPatientTypeStats(currentStart, currentEnd)`** and **`getPatientTypeStats(previousStart, previousEnd)`**
   — "new" means no prior appointment with this doctor before the range start; "returning" means at
   least one. Computed as: distinct patient IDs with an appointment in-range, minus distinct patient
   IDs from that set who also have an appointment *before* the range start. Same shape as
   `getTodayOverview`'s `getPatientStats`, but parameterized by the dashboard's selected range instead
   of a fixed 30 days.

## Response shape (`/api/v2/dashboard/doctor`)

```jsonc
{
  "success": true,
  "message": "Doctor dashboard fetched successfully",
  "data": {
    "status": {
      "totalEarning": { "amount": 4500, "hikePercent": 12, "previous": 4020 },
      "totalAppointments": { "count": 18, "hikePercent": 5, "previous": 17 },
      "confirmedAppointments": { "count": 6, "hikePercent": 0, "previous": 6 },
      "pendingAppointments": { "count": 3, "hikePercent": -10, "previous": 4 },
      "noShowAppointments": { "count": 1, "hikePercent": 0, "previous": 1 },
      "completedAppointments": { "count": 12, "hikePercent": 20, "previous": 10 },
      "cancelledAppointments": { "count": 2, "hikePercent": 0, "previous": 2 },
      "waitingPatients": { "count": 1, "hikePercent": 100, "previous": 0 },
      "remainingAppointments": { "count": 4, "hikePercent": -5, "previous": 5 },
      "uniquePatients": { "count": 15, "hikePercent": 7, "previous": 14 }
    },
    "appointmentStats": [
      { "date": "2026-07-20", "count": 5, "noShowCount": 0, "completedCount": 4 }
    ],
    "pendingAppointments": [
      {
        "id": "uuid", "name": "...", "profileImage": null, "gender": "Male", "age": 34,
        "mobile": "...", "appointmentId": "uuid", "appointmentDate": "...", "appointmentTime": "10:30",
        "appointmentType": "Consultation", "reasonForVisit": "...", "symptoms": "Fever, Headache",
        "tokenNo": 3, "payment": { "paymentMode": "...", "paymentStatus": "...", "price": "500" }
      }
    ],
    "topSymptoms": [{ "name": "Fever", "count": 12, "percent": 30 }],
    "todaySessions": [{ "sessionIndex": 1, "start": "09:00", "end": "13:00" }],
    "patientTypes": {
      "newPatients": { "count": 4, "hikePercent": 100, "previous": 0 },
      "returningPatients": { "count": 11, "hikePercent": 10, "previous": 10 }
    }
  }
}
```

## Response shape (`/api/v2/dashboard/doctor/profile`)

```jsonc
{
  "success": true,
  "message": "Doctor dashboard profile fetched successfully",
  "data": {
    "doctorName": "Dr. Jane Doe",
    "setupProgress": {
      "title": "Welcome! Let's set up a few things to get you started.",
      "completed": 2,
      "total": 4,
      "ctaLabel": "Continue Setup",
      "ctaPath": "/clinic-setup",
      "secondaryLabel": "Setup Center",
      "steps": [
        { "title": "Clinic Profile", "subtitle": "Add your clinic details", "status": "completed", "stepNumber": 1, "path": "/clinic-setup" }
      ]
    }
  }
}
```

`setupProgress` is `null` once `ClinicModel.onboardingStatus === 'COMPLETED'` — the frontend hides
the setup banner in that case.

## Frontend consumption

- `src/redux/api/dashboardApi.ts` — `useGetDoctorDashboardV2Query`, `useGetDoctorDashboardProfileQuery`.
  Separate RTK Query tags (`DoctorDashboard` vs `DoctorDashboardProfile`) so realtime invalidation of
  one doesn't force a refetch of the other.
- `src/pages/dashboard/doctorDash/DoctorDash.tsx` — calls both queries, derives `dashStats` and
  `statusBreakdown` from `status`, feeds `appointmentStats` to `AppointmentTrendChart`, feeds
  `topSymptoms`/`patientTypes` to `PatientInsightsCard`, and `todaySessions` to the S1/S2 queue picker.
- Realtime: `useAppointmentRealtime` listens for `appointment.created`/`appointment.updated` socket
  events and dispatches `dashboardApi.util.invalidateTags(["DoctorDashboard"])` — this only affects
  the frontend's RTK Query cache, not the backend Redis cache described above.
