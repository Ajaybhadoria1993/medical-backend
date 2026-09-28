# Staff Directory & Staff Access

Reference for the Users & Roles list and how a staff member's access is configured.
Written 2026-08-23, covering the work on `feat/users-roles-filters`.

Frontend counterparts are logged as entries #66–#68 in
`InfinityMedisetuWeb_FE/docs/playbook/UI_REMEDIATION_LOG.md`.

---

## 1. What exists

### `GET /api/v1/users/staff-directory`
The Users & Roles list for **one** staff role. Admin/Super_Admin, clinic-scoped.

Returns `users`, `summary`, `filterOptions`, `availableFilters`, `pagination`.

Deliberately separate from `getAllUser`: that endpoint serves every consumer, so
widening it with lab/pharmacy/assignment joins would make the patient list pay
for columns it never reads. Here the requested role decides which joins run at
all — a Doctor query never touches `staff_scopes`, a Receptionist query never
touches labs.

### `GET /api/v1/permissions/catalog?role=`
Without `role`, the whole catalog (unchanged). With it, the matrix for a role
that **has no user yet** — what Add User needs to offer permissions at creation
time. Both paths share `catalogForRole()` / `roleDefaultsFor()` in
`permissions/services/permission.service.ts`, so the list a role is offered
before it exists cannot differ from the list it gets afterwards.

### `POST /api/v1/users/adduser`
Accepts optional `permissionKeys` and `assignment` alongside the user fields and
applies them in the same request. Both optional — every pre-existing caller is
unaffected. This is why it is one endpoint and not three client calls: a user
created and then left without the permissions the admin chose is a
half-configured account nobody is told about.

---

## 2. Invariants — do not break these

**`ROLE_FILTERS` (`users/utils/staffDirectory.utils.ts`) is the single source of
truth for both halves of the filter contract.** It decides which joins and
options the service builds *and* is returned as `availableFilters`. A filter
cannot appear on one side and not the other, which is what stops the UI
rendering a filter the server would silently ignore.

| Role | Filters |
|---|---|
| Doctor | speciality, status |
| Receptionist / Nurse | assignedDoctor, location, status |
| Lab_Assistant | lab, status |
| Pharmacist | pharmacy, location, status |

**A filter is only meaningful if the row displays what it filters by.** The
client mirrors `ROLE_FILTERS` with `ROLE_COLUMNS` for this reason — filtering
receptionists by assigned doctor while never showing assigned doctors leaves the
user unable to see why a row survived.

**`summary` and `filterOptions` are clinic-wide and deliberately NOT narrowed by
the active filters or the current page.** The cards describe the role, not the
ten rows on screen; a dropdown offers the same choices however the list is paged.
Deriving either from the loaded page is the bug this design exists to prevent.

**Assignment applies only to `SCOPED_STAFF_ROLES`** (`Receptionist`, `Nurse` —
`permissions/utils/staffScope.utils.ts`). Adding a role there is all it takes to
bring it under the same rules; the schema and every enforcement point are
role-neutral.

**Permissions and assignment answer different questions.** Permissions say *what*
a staff member may do; assignment says *whose data* they may do it to. Never
conflate them — a staff member with `payment:manage` still cannot touch a payment
for a doctor they are not assigned to.

---

## 3. Query cost — measured, not estimated

Per `StaffDirectoryService.list()` call, as of this commit:

| Role | count | page | 2nd pass | summary | filterOptions | total |
|---|---|---|---|---|---|---|
| Doctor | 1 | 1 | 0 | 1 | 1 | **4** |
| Receptionist / Nurse | 1 | 1 | 2 | 1 | 2 | **7** |
| Lab_Assistant | 1 | 1 | 1 | 1 | 1 | **5** |
| Pharmacist | 1 | 1 | 2 | 1 | 2 | **7** |

This fires on every page change, every filter change, and every debounced
keystroke.

---

## 4. Future work

Format matches `docs/BACKEND_OPTIMIZATION_PLAN.md`: `[ ]` not started, `[~]` in
progress, `[x]` done.

### Step 1 — Cache `summary` + `filterOptions`
**File:** `users/services/staffDirectory.service.ts`

Both are identical on every request for a given (clinic, role) — they ignore
search, filters and page — yet are rebuilt on every keystroke. Worth 3 of the 7
queries on a Receptionist list.

Use `getOrSetCache` with a key added to `CacheKeys` (`src/utils/cache.util.ts`);
never build the key inline, per `docs/playbook/BACKEND_STANDARDS.md`.

**Decision still open:** a short TTL (~60s) with no explicit invalidation is
near-zero maintenance and self-correcting, but leaves the summary tiles stale for
up to a minute after a user is added. Explicit invalidation is accurate but has
to be wired into user create/update/status-change, assignment writes, and
lab/pharmacy create/delete — five places that will drift.

**Status:** [ ]

### Step 2 — Fold the count into the page query
Two queries share an identical `WHERE`. `COUNT(*) OVER()` as a window column on
the page query removes one round trip for every role, with no staleness cost.

**Status:** [ ]

### Step 3 — Fold `location` into the base query
`staff_scopes` has `staff_scopes_user_clinic_unique` on (user_id, clinic_id), so
a `LEFT JOIN` cannot multiply rows. The separate second-pass query is
unnecessary. Removes one query for Receptionist/Nurse/Pharmacist.

Note the contrast: `assignedDoctors` **must** stay a second pass — it is 1:many,
and joining it would turn a staff member with three doctors into three rows and
break the page size.

**Status:** [ ]

### Step 4 — Parallelise the remaining second-pass queries
`assignedDoctors`, `labs` and `pharmacies` are independent of each other but run
back to back. `Promise.all` does not reduce the query count but does cut latency.
(`summary`/`filterOptions` were already done this way.)

**Status:** [ ]

### Step 5 — Department filter for Lab Assistants
Requested in the original brief, **not shippable on the current schema**.

`lab_departments` links a department to a *lab*, not to a person, and
`user_lab_assignments` has only (user_id, lab_id, clinic_id). So two assistants
in the same lab are indistinguishable by department — the filter could only
return everyone in the lab or nobody.

Needs `department_id` on `user_lab_assignments` (migration) plus a way to set it
when assigning an assistant to a lab. Only then add `'department'` to
`ROLE_FILTERS.Lab_Assistant`.

**Status:** [ ]

### Step 6 — Atomicity when editing access
`EditAccessModal` (frontend) saves permissions and assignment as two sequential
mutations, so a failure on the second leaves the first applied. This is the same
shape as the problem `POST /users/adduser` was extended to avoid.

Less severe than at creation — both are edits to a user who already exists, and
the failure is surfaced in a toast — but a combined endpoint would close it.

**Status:** [ ]

---

## 5. Not verified

Nothing in section 1 has been exercised against a running server. Everything is
typechecked, `npm run build` passes in both repos, and
`permissions/tests/permission.service.test.ts` passes (4/4) over the refactored
catalog. The paths with no runtime evidence are `GET /permissions/catalog?role=`
and `POST /users/adduser` carrying the new fields.
