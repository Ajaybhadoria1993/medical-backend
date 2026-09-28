# Staff Assignment & Appointment Ownership

Who a staff member may act *for*, and what they may *do*. Two separate questions,
two separate systems, both living in `src/main/permissions/`:

```
Staff member → Assignment → Doctor(s) → Data scope → Permissions → Allowed actions
```

- **Assignment** (`StaffScopeService`) decides **whose** data is in reach.
- **Permissions** (`PermissionService`) decide **what** may be done with it.

A receptionist holding `payment:manage` still cannot touch Doctor 2's payment if
Doctor 2 is not assigned to them. Being assigned to Doctor 2 grants no action by
itself.

Nothing here is receptionist-specific. `SCOPED_STAFF_ROLES` in
`utils/staffScope.utils.ts` lists the roles whose reach is assignment-driven —
currently `Receptionist` and `Nurse`. Bringing another role (Manager) under the
same rules is one entry in that list once the `user_type` enum has it; the
schema, the guards and every query are already role-neutral.

## Data model

`src/main/permissions/models/staffAssignment.model.ts`

| Table | Purpose |
|---|---|
| `staff_scopes` | One row per staff member per clinic: `access_scope` (`assigned_doctors` \| `all_doctors`), `location`, `responsibility`, `updated_by`. Unique on (user, clinic). |
| `staff_doctor_assignments` | The doctors one staff member covers. Unique on (staff, clinic, doctor), plus an index on (clinic, doctor) for the reverse lookup. |

Kept off `clinic_assign` deliberately — that table is shared by every role, and a
doctor row has no business carrying an access scope.

`location` is free text ("Ground Floor", "OPD Block B"), not a foreign key: the
requirement is that location is part of the responsibility model and visible in
the configuration, not that it is clinic-managed vocabulary.

### The default matters

**A staff member with no `staff_scopes` row is treated as `all_doctors`.** This
ships into clinics whose receptionists already see everything; blanking a live
dashboard mid-shift on deploy would be worse than the looser default.
Restriction is something an admin opts into, per person. `getScope` returns
`isDefault: true` for that state so the UI can say "not configured yet" rather
than claiming clinic-wide access was chosen.

## Permissions

Added to `PERMISSION_KEYS`:

`appointment:view` · `appointment:create` · `appointment:walkin` ·
`queue:manage` · `payment:manage` · `patient:manage`

None is a `ROLE_DEFAULT_PERMISSIONS` entry. A role default is not revocable — the
admin UI renders `viaRole` rows read-only — and the whole point is per-person
configuration. Staff who already existed keep their abilities through the
**backfill in `src/drizzle/seeds/permissions.seed.ts`**, which grants all six to
every `SCOPED_STAFF_ROLES` member already in `clinic_assign`. Run the seed once
when deploying. New staff start with nothing and are configured by their admin.

## Enforcement

Enforcement lives in the **services**, not only in route middleware, so every
caller inherits it. Hiding a doctor in the UI is never the security boundary.

| Surface | How |
|---|---|
| `getAllClinicAppointments`, `getClinicAppointmentDetails` | `doctorScopeFilter` on the where-clause; an out-of-scope `query.doctorId` is a 403, not an empty list |
| `getAppointment` (single) | `assertDoctorAllowed` on the appointment's own doctor |
| `POST /appointments` | `requirePermission(appointment:create)` + `requireWalkInPermissionForPayload` + `requireDoctorScope('doctorId','body')` |
| `PUT /appointments/:id` | `requireAppointmentScope` + `requirePaymentPermissionForPayload` |
| `POST /appointments/:id/cancel` | `requireAppointmentScope` |
| Queue board (`/queue/board`) | scoped doctor list; a named `doctorId` is asserted |
| Queue actions (send-in/hold/skip/resume) | `requirePermission(queue:manage)` + `requireAppointmentScope` |
| `/appointments/reception/live-queue` | roster filtered to scope |
| `/dashboard/reception`, `/dashboard/reception/today-stats` | counts, payments, new-patients and doctor queues all scoped |
| `GET /users/doctor-list` | scoped — this is what makes an out-of-scope doctor unpickable rather than merely hidden |
| `POST`/`PUT /patient` | `requirePermission(patient:manage)` |

`null` from `getAccessibleDoctorIds` means **unrestricted**; `[]` means a
configured staff member assigned to nobody, who must see nothing. Callers have to
keep the two apart — `doctorScopeFilter` encodes the distinction (`[]` becomes
`sql\`false\``, since an empty `inArray` is not valid SQL and dropping the clause
would silently widen the query to the whole clinic).

## Caching

Scoped payloads are cached per scope. `CacheKeys.receptionOverview`,
`receptionTodayStats` and `clinicDoctorList` all take a `scopeKey` produced by
`scopeCacheKey(allowedDoctorIds)` — without it, someone assigned to Doctor 1
would read a payload built for the whole clinic.

Those keys cannot be enumerated from a clinic id alone, so invalidation goes
through `invalidateCacheByPattern` with the matching `*Pattern` helper. It uses
`SCAN`, not `KEYS`: this runs on the appointment write path, and `KEYS` blocks
the whole Redis server for the length of the scan.

Scope itself is cached for 5 minutes under `CacheKeys.staffScope` and invalidated
on every assignment update.

## Payment ownership

`appointment_payments` is the single source of truth; payment status never
depends on who is looking. Two people can hold the same appointment open, so
`updateAppointment` guards the second save:

- already `Paid`, request says `Pending` → **409**, naming who collected it
  (resolved from the last `PAYMENT_STATUS` row in
  `appointment_activity_history`). This is the "treating an already-paid
  appointment as unpaid" case.
- already `Paid`, request says `Paid` → the payment row is left exactly as it
  is. The same collection arriving twice must not be written twice, and a form
  resubmit must not fail.
- already `Paid`, request says `Refunded` → allowed; a refund is a real
  transition.

A `payment_updated` appointment broadcast already goes to the clinic room, so the
other person's screen updates without a refresh.

## API

All under the existing permissions router.

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/permissions/me/scope` | any clinic user — what their own screens gate on |
| GET | `/api/v1/permissions/assignments` | Admin — the whole responsibility table |
| GET | `/api/v1/permissions/users/:userId/assignment` | Admin |
| PUT | `/api/v1/permissions/users/:userId/assignment` | Admin — replaces scope, doctors, location |
| GET | `/api/v1/permissions/doctors/:doctorId/staff` | Admin — who covers this doctor, including clinic-wide staff |

`PUT` rejects `assigned_doctors` with an empty doctor list: someone restricted to
nobody sees nothing at all, which is almost always a half-finished form rather
than an intent.

## Migrations

Two new tables and one new enum (`staff_access_scope`). Generate and apply with
the usual `npm run db:migrations:<env>` / `db:migrate:<env>`, then run the seed so
the permission catalog and the staff backfill land together.
