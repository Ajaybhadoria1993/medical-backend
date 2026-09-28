# Permissions Module — API & Staff Permission Reference

Two separate questions, one module (`src/main/permissions/`):

```
Staff member → Assignment → Doctor(s) → data in reach
             → Permissions            → actions allowed
```

- **Permissions** (`PermissionService`) — *what* a staff member may do
  (`appointment:create`, `payment:manage`, …). This doc's sections 3–6.
- **Assignment** (`StaffAssignmentService` / `StaffScopeService`) — *whose*
  data is in reach. This doc's sections 7–10; design in
  [STAFF_ASSIGNMENT.md](./STAFF_ASSIGNMENT.md).

A grant without an assignment does nothing, and vice versa. A receptionist with
`payment:manage` still cannot touch a doctor's payment unless that doctor is in
their scope.

- Routes: `src/main/permissions/routes/v1/permissions.route.ts`
- Swagger: `http://localhost:5000/api-docs` → tag **Permissions**
- Permission keys: `src/main/permissions/utils/permission.constants.ts`
  (`PERMISSION_KEYS`)

---

## 1. Common contract

- All routes require `Authorization: Bearer <token>` **and** a clinic context
  (`requireClinic`).
- Success envelope: `{ "success": true, "message": string, "data": … }`
  (`sendOk`). Errors: `{ "success": false, "message": string }` via `HttpError`.
- "Admin-only" below means `requireRole(['Admin', 'Super_Admin'])` → **403
  `Insufficient role`** for anyone else.

---

## 2. Permission keys (the catalog)

| key | resource | meaning |
|---|---|---|
| `appointment:view` | appointment | see appointments / queue for in-scope doctors |
| `appointment:create` | appointment | book a normal appointment |
| `appointment:walkin` | appointment | book a walk-in |
| `appointment:custom_slot` | appointment | book **outside** configured availability (2am, during a break) — deliberately separate from `create` |
| `queue:manage` | queue | act on the live queue |
| `payment:manage` | payment | take / edit payment |
| `patient:manage` | patient | create / edit patient records |
| `lab_test:view` / `:create` / `:mark_paid` | lab_test | lab ordering |

**Role defaults** (`ROLE_DEFAULT_PERMISSIONS`): `Super_Admin` bypasses every
check; `Admin` implicitly holds all keys; every scoped staff role
(`Receptionist`, `Nurse`, `Pharmacist`, `Lab_Assistant`, `Radiologist`,
`Doctor`) starts with **nothing** and is configured per person. A role default
shows as `viaRole: true` and is **read-only** in the admin UI — only explicit
grants can be toggled.

---

## 3. `GET /api/v1/permissions/me`

The authenticated user's **effective** permission keys in the current clinic —
role defaults ∪ explicit grants. This is the endpoint the frontend calls on
login to gate UI. Access: **any authenticated clinic user**.

```bash
curl http://localhost:5000/api/v1/permissions/me -H "Authorization: Bearer $TOKEN"
```

```jsonc
{
  "success": true,
  "message": "Permissions fetched successfully",
  "data": {
    "permissions": ["appointment:view", "appointment:create", "queue:manage"]
  }
}
```

A `Super_Admin` gets the full key list; an `Admin` gets all keys via role
default.

> Real-time: when an admin changes a user's grants, that user's session is
> signalled `permissions.updated` (revocation → `permissions.revoked`) on the
> `permissions:{userId}` channel — re-fetch this endpoint on that event.

---

## 4. `GET /api/v1/permissions/catalog`

Every active permission, grouped by resource. Access: **Admin-only**.

| query | type | effect |
|---|---|---|
| `role` | `Doctor` \| `Receptionist` \| `Nurse` \| `Pharmacist` \| `Lab_Assistant` \| `Radiologist` | narrows to the subset that role supports and adds `granted` / `viaRole` (all grants false — no user yet). Used by **Add User** to offer permissions at creation time. |

```bash
curl "http://localhost:5000/api/v1/permissions/catalog?role=Receptionist" \
  -H "Authorization: Bearer $TOKEN"
```

```jsonc
{
  "success": true,
  "message": "Permission catalog fetched successfully",
  "data": [
    {
      "resource": "appointment",
      "permissions": [
        { "key": "appointment:view",   "resource": "appointment", "action": "view",
          "description": "View appointments", "granted": false, "viaRole": false },
        { "key": "appointment:create", "resource": "appointment", "action": "create",
          "description": "Book appointments", "granted": false, "viaRole": false }
      ]
    }
  ]
}
```

Without `?role=`, entries omit `granted` / `viaRole` — it's just the raw
catalog.

---

## 5. `GET /api/v1/permissions/users/:userId`

The full catalog **for that user's role**, each entry flagged with its current
state. Access: **Admin-only**. `:userId` must be a UUID of a user assigned to
the caller's clinic.

```jsonc
{
  "success": true,
  "message": "User permissions fetched successfully",
  "data": {
    "userId": "9b1c…",
    "userType": "Receptionist",
    "permissions": [
      {
        "resource": "appointment",
        "permissions": [
          { "key": "appointment:view",   "action": "view",   "description": "…",
            "granted": true,  "viaRole": false },
          { "key": "appointment:walkin", "action": "walkin", "description": "…",
            "granted": false, "viaRole": false }
        ]
      }
    ]
  }
}
```

- `granted` — an explicit `user_permissions` row exists. Toggleable.
- `viaRole` — a role default. Always effective, rendered read-only.

---

## 6. `PUT /api/v1/permissions/users/:userId`  — admin grants permissions

Replace the user's **explicit grant set**. Send the full desired list; the
server diffs against what exists, inserts/deletes the difference, and writes a
`permission_audit_log` row per change. Access: **Admin-only**.

### Request body

| field | type | notes |
|---|---|---|
| `permissionKeys` | `string[]` | the complete desired set of explicit grants. `[]` removes all explicit grants (role defaults remain). Unknown / inactive keys → 400 |

```bash
curl -X PUT http://localhost:5000/api/v1/permissions/users/9b1c… \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "permissionKeys": ["appointment:view", "appointment:create", "queue:manage"] }'
```

```jsonc
{
  "success": true,
  "message": "Permissions updated",
  "data": { "added": ["queue:manage"], "removed": ["payment:manage"] }
}
```

`{ "added": [], "removed": [] }` means the set already matched — no rows
written.

### Errors

| Status | When |
|---|---|
| 400 | `permissionKeys` contains an unknown / inactive key |
| 400 | `userId === caller` — *You cannot change your own permissions* |
| 403 | caller is not Admin / Super_Admin |
| 403 | target is a `Super_Admin` — *Permissions cannot be assigned to a Super Admin* |
| 404 | target user is not assigned to this clinic |

The user's cached permission set (`CacheKeys.userPermissions`) is invalidated
and a `permissions.updated` real-time signal is sent.

---

## 7. `GET /api/v1/permissions/me/scope`

The caller's own data scope. Access: **any authenticated clinic user** — the FE
gates doctor pickers on it.

```jsonc
{
  "success": true,
  "message": "Scope fetched successfully",
  "data": {
    "accessScope": "assigned_doctors",       // or "all_doctors"
    "location": "OPD Block B",                // free text, nullable
    "responsibility": "Front desk",           // nullable
    "isDefault": false,                       // true = no scope row → all doctors
    "doctors": [ { "id": "…", "name": "Dr. Rao", "speciality": "Cardiology" } ]
  }
}
```

`isDefault: true` means the clinic has not configured this person yet; they are
treated as `all_doctors` so a fresh deploy doesn't blank a live dashboard.

---

## 8. `GET /api/v1/permissions/assignments`

Every assignable staff member (scoped roles only) with their full assignment
view. Access: **Admin-only**.

```jsonc
{
  "success": true,
  "message": "Staff assignments fetched successfully",
  "data": {
    "assignments": [
      {
        "userId": "9b1c…", "name": "Asha", "email": "asha@…", "userType": "Receptionist",
        "accessScope": "assigned_doctors", "location": "Ground Floor",
        "responsibility": "Front desk", "isDefault": false,
        "doctors": [ { "id": "…", "name": "Dr. Rao", "speciality": "Cardiology" } ]
      }
    ]
  }
}
```

---

## 9. `GET /api/v1/permissions/users/:userId/assignment`

One staff member's assignment view (same object shape as an `assignments[]`
entry above). Access: **Admin-only**. 404 if the user isn't in the clinic.

---

## 10. `PUT /api/v1/permissions/users/:userId/assignment`  — admin sets scope

Replace a staff member's scope. Access: **Admin-only**. Applies to scoped roles
(`Receptionist`, `Nurse`) only — other roles → 400.

### Request body

| field | type | notes |
|---|---|---|
| `accessScope` | `"assigned_doctors"` \| `"all_doctors"` | required |
| `doctorIds` | `string[]` (UUID) | required non-empty when `accessScope = "assigned_doctors"`, else ignored. Defaults to `[]` |
| `location` | string ≤120 / null | optional free text |
| `responsibility` | string ≤255 / null | optional free text |

```bash
curl -X PUT http://localhost:5000/api/v1/permissions/users/9b1c…/assignment \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "accessScope": "assigned_doctors", "doctorIds": ["3f2b…"], "location": "OPD Block B" }'
```

Returns the updated assignment view (`{ success, message, data: <view> }`).

### Errors

| Status | When |
|---|---|
| 400 | `accessScope = "assigned_doctors"` with empty `doctorIds` |
| 400 | target role is not a scoped staff role |
| 403 | caller is not Admin / Super_Admin |
| 404 | target user is not assigned to this clinic |

---

## 11. `GET /api/v1/permissions/doctors/:doctorId/staff`

Who covers a given doctor — explicit assignments **plus** clinic-wide
(`all_doctors`) staff. Access: **Admin-only**.

```jsonc
{
  "success": true,
  "message": "Doctor staff fetched successfully",
  "data": {
    "doctorId": "3f2b…",
    "staff": [
      { "id": "…", "name": "Asha",  "userType": "Receptionist", "location": "Ground Floor",
        "viaAllDoctorsAccess": false },
      { "id": "…", "name": "Ravi",  "userType": "Nurse",        "location": null,
        "viaAllDoctorsAccess": true }
    ]
  }
}
```

`viaAllDoctorsAccess: true` — this person covers the doctor only because their
scope is `all_doctors`, not through an explicit assignment row.

---

## 12. Route → access summary

| Method & path | Access | Request | Response schema |
|---|---|---|---|
| `GET /permissions/me` | any clinic user | — | `myPermissionsResponseSchema` |
| `GET /permissions/me/scope` | any clinic user | — | `myScopeResponseSchema` |
| `GET /permissions/catalog` | Admin / Super_Admin | `?role=` | `permissionCatalogResponseSchema` |
| `GET /permissions/users/:userId` | Admin / Super_Admin | path | `userPermissionsResponseSchema` |
| `PUT /permissions/users/:userId` | Admin / Super_Admin | `permissionKeys[]` | `updateUserPermissionsResponseSchema` |
| `GET /permissions/assignments` | Admin / Super_Admin | — | `listStaffAssignmentsResponseSchema` |
| `GET /permissions/users/:userId/assignment` | Admin / Super_Admin | path | `staffAssignmentResponseSchema` |
| `PUT /permissions/users/:userId/assignment` | Admin / Super_Admin | `updateStaffAssignmentSchema` | `staffAssignmentResponseSchema` |
| `GET /permissions/doctors/:doctorId/staff` | Admin / Super_Admin | path | `doctorStaffResponseSchema` |

Response schemas live in `src/main/permissions/schemas/permission.schema.ts` and
`.../staffAssignment.schema.ts` and are registered on each endpoint in
`permissions.route.ts` for Swagger. They are documentation only — controllers
build payloads directly and are not validated against them.
