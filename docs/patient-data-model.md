# Patient Data Model — Complete Solution

---

## Core Rule

**One mobile number = One patient identity across the entire system.**

- Mobile number is the universal patient identifier.
- If two people share a phone, one is the primary (has mobile), the other is a family member (mobile = NULL).
- No two patients can have the same mobile number in the database.

---

## Database Schema Changes

### users table (modified)

```
┌─────────────────────────────────────────────────────────────────┐
│                         users                                    │
├─────────────────────────────────────────────────────────────────┤
│  id              UUID PK                                         │
│  name            VARCHAR(150) NOT NULL                           │
│  email           VARCHAR — CHANGED: now NULLABLE                 │
│  mobile          VARCHAR — NULLABLE                              │
│  password        VARCHAR — NULL for patients                     │
│  user_type       ENUM: Admin|Doctor|Patient|Receptionist|...     │
│  user_status     ENUM: Active|New|Inactive|Blocked|...           │
│  created_at      TIMESTAMP                                       │
│  updated_at      TIMESTAMP                                       │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                        │
│  • UNIQUE partial: mobile WHERE user_type='Patient'              │
│    AND mobile IS NOT NULL (patients can't share mobile)          │
│  • UNIQUE partial: email WHERE user_type != 'Patient'            │
│    AND email IS NOT NULL (staff must have unique email)           │
│  • Partial index: mobile WHERE user_type='Patient'               │
│    (fast OTP lookup)                                             │
│  • Partial index: email WHERE user_type != 'Patient'             │
│    (fast staff login)                                            │
└─────────────────────────────────────────────────────────────────┘
```

**What changed in users table:**
- `email` → now NULLABLE (was NOT NULL). Patients (especially family members) don't need email.
- Removed global unique constraint on email.
- Added partial unique index on email for staff only.
- Added partial unique index on mobile for patients only.
- Stop generating fake emails for patients — just store NULL.

### user_profiles table (NO CHANGE)

```
┌─────────────────────────────────────────────────────────────────┐
│                     user_profiles                                 │
├─────────────────────────────────────────────────────────────────┤
│  id              UUID PK                                         │
│  user_id         UUID FK → users.id (unique, cascade)            │
│  gender          VARCHAR                                         │
│  age             INTEGER                                         │
│  dob             VARCHAR                                         │
│  address         TEXT                                            │
│  city            VARCHAR                                         │
│  state           VARCHAR                                         │
│  zip_code        VARCHAR(10)                                     │
│  profile_image   TEXT                                            │
│  blood_group     VARCHAR(5)                                      │
│  height          VARCHAR(10)                                     │
│  weight          VARCHAR(10)                                     │
│  allergies       JSONB                                           │
│  chronic_conditions JSONB                                        │
└─────────────────────────────────────────────────────────────────┘
```

### patient_family_links table (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│                  patient_family_links  (NEW)                      │
├─────────────────────────────────────────────────────────────────┤
│  id                  UUID PK                                     │
│  primary_patient_id  UUID FK → users.id (cascade)                │
│  linked_patient_id   UUID FK → users.id (cascade)                │
│  relationship        VARCHAR(50)                                  │
│                      values: spouse|child|parent|sibling|other    │
│  created_at          TIMESTAMP                                   │
│  updated_at          TIMESTAMP                                   │
├─────────────────────────────────────────────────────────────────┤
│  UNIQUE (primary_patient_id, linked_patient_id)                  │
│  INDEX on primary_patient_id                                     │
└─────────────────────────────────────────────────────────────────┘
```

### tokens table (modified — enum only)

```
┌─────────────────────────────────────────────────────────────────┐
│                     tokens                                        │
├─────────────────────────────────────────────────────────────────┤
│  type ENUM — ADDED VALUE: 'patient_otp'                          │
│                                                                   │
│  Full enum: email_verification | password_reset |                │
│             registration_verification | registration_session |   │
│             set_initial_password | patient_otp (NEW)             │
│                                                                   │
│  For patient_otp: 'email' column stores mobile number            │
└─────────────────────────────────────────────────────────────────┘
```

---

## How Different User Types Use the Table

| Column      | Staff (Admin/Doctor/Receptionist) | Patient (self-registered)     | Patient (family member/dependent) |
| ----------- | --------------------------------- | ----------------------------- | --------------------------------- |
| name        | Required                          | Required                      | Required                          |
| email       | Required (used for login)         | Optional                      | NULL                              |
| mobile      | Optional                          | Required (used for OTP login) | NULL                              |
| password    | Required                          | NULL (no password, OTP only)  | NULL                              |
| user_type   | Admin/Doctor/Receptionist/etc.    | Patient                       | Patient                           |
| user_status | Active/Inactive/etc.              | Active                        | Active                            |

---

## Relationships Diagram

```
                    ┌──────────┐
                    │  users   │
                    │(Patient) │
                    └────┬─────┘
                         │
         ┌───────────────┼───────────────────────────────┐
         │               │                               │
         ▼               ▼                               ▼
┌─────────────┐  ┌──────────────┐            ┌────────────────────┐
│user_profiles│  │ clinic_assign │            │patient_family_links│
│   (1:1)     │  │   (many)     │            │      (many)        │
└─────────────┘  └──────┬───────┘            └────────┬───────────┘
                         │                             │
                         ▼                             ▼
                  ┌────────────┐              ┌──────────────┐
                  │  clinics   │              │    users     │
                  └────────────┘              │(family member)│
                                              └──────────────┘
```

---

## How Patient Connects to Everything

```
Patient (users.id = "rahul-uuid", mobile = 9876543210)
    │
    ├──→ user_profiles (1:1) — personal/medical info
    │
    ├──→ clinic_assign (many) — linked to Clinic A, Clinic B, etc.
    │
    ├──→ appointments.patient_id (many) — all appointments across all clinics
    │
    ├──→ reports (via appointments) — all medical reports
    │
    ├──→ feedback.patient_id (many)
    │
    ├──→ patient_gallery.patient_id (many)
    │
    └──→ patient_family_links.primary_patient_id (many)
              │
              ├──→ Mother (mobile: NULL) — accessed only via Rahul
              ├──→ Priya (mobile: 9876543211) — can also login independently
              └──→ Arjun (mobile: NULL) — accessed only via Rahul
```

---

## Scenario: Patient Visits Multiple Clinics

### What happens step by step:

**Step 1:** Rahul visits Clinic A for the first time.
- Receptionist enters: name "Rahul Kumar", mobile "9876543210"
- Backend: no patient with this mobile → creates new user (status: New)
- Creates clinic_assign: Rahul ↔ Clinic A
- Books appointment under Rahul's userId

**Step 2:** Rahul visits Clinic B.
- Receptionist enters mobile "9876543210"
- Backend: **patient already exists** (Rahul Kumar)
- Backend returns existing patient to receptionist
- Receptionist sees: "Patient found: Rahul Kumar (9876543210)"
- Receptionist confirms → clinic_assign added: Rahul ↔ Clinic B
- Books appointment under SAME userId

**Step 3:** Rahul visits Clinic B but says name is "Rahul K" (slightly different)
- Same as Step 2 — mobile match found
- Name is NOT changed (existing record preserved)
- Receptionist sees existing name "Rahul Kumar" and uses that

**Result in database:**
- 1 row in users (Rahul Kumar)
- 2 rows in clinic_assign (Clinic A, Clinic B)
- All appointments point to same patientId regardless of which clinic booked

---

## Scenario: Family Member Management

### Adding family member without mobile:

```
Rahul adds his mother (no phone):
  → Creates user: { name: "Sunita Devi", mobile: NULL, email: NULL, userType: Patient }
  → Creates profile: { gender: Female, age: 65 }
  → Creates link: { primary: Rahul, linked: Mother, relationship: parent }

Mother has no login — accessed only through Rahul's app.
```

### Adding family member with their own mobile:

```
Rahul adds wife Priya (has her own phone):
  → Backend checks: patient with mobile 9876543211 exists?
    → NO: creates new user { name: "Priya", mobile: 9876543211 }
    → YES: reuses existing patient, just creates link
  → Creates link: { primary: Rahul, linked: Priya, relationship: spouse }

Priya can ALSO login independently with her own OTP.
Both Rahul (via link) and Priya (directly) can see Priya's data.
```

### Clinic booking for a family member:

```
Rahul takes his mother to clinic:
  → Receptionist searches Rahul's mobile: 9876543210
  → Finds Rahul + sees family members listed
  → Selects "Sunita Devi (Mother)"
  → Books appointment with patientId = Mother's userId

OR if mother has no mobile:
  → Clinic creates her as new patient without mobile
  → Rahul later links her in his app
```

---

## Scenario: Same Mobile — Different Person?

**Rule: This is not allowed.** One mobile = one patient. Period.

| Situation                                            | How to handle                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Two people sharing one phone                         | One is primary (has mobile on record), other is family member (mobile = NULL)                       |
| Receptionist enters someone else's number by mistake | System shows existing patient — receptionist should verify name before confirming                   |
| Patient claims different name at different clinic    | System keeps original name. Only the patient (via app) can change their own name after registration |

---

## Data Ownership Rules

| Patient Status                          | Who can edit profile?      | What can clinic do?                    |
| --------------------------------------- | -------------------------- | -------------------------------------- |
| New (created by clinic, not yet on app) | Clinic that created them   | Full edit — name, age, gender, etc.    |
| Active (registered on mobile app)       | Only the patient (via app) | Read-only. Can only book appointments. |

**Why?** Once a patient registers on the app, they own their identity. No clinic should overwrite their name, age, or other personal details. Clinics can still:
- Book appointments for them
- Add clinical notes/reports under the appointment
- View profile (read-only)

---

## What Changed vs Current System

| Item                             | Before                                   | After                                  |
| -------------------------------- | ---------------------------------------- | -------------------------------------- |
| email column                     | NOT NULL, globally unique                | NULLABLE, unique only for staff        |
| mobile column                    | nullable, not unique                     | nullable, unique per patient (partial) |
| Fake emails for patients         | Generated (e.g., rahul_abc@random.local) | Not needed — store NULL                |
| Duplicate patients (same mobile) | Possible (bug)                           | Blocked by DB constraint               |
| patient_family_links table       | Does not exist                           | NEW                                    |
| token_type enum                  | 5 values                                 | 6 values (added patient_otp)           |
| users table columns              | No change                                | No change (same columns)               |
| user_profiles columns            | No change                                | No change                              |
| appointments columns             | No change                                | No change                              |
| All existing FKs                 | No change                                | No change                              |

---

## Example Data

### users:

| id          | name        | email            | mobile     | user_type | user_status |
| ----------- | ----------- | ---------------- | ---------- | --------- | ----------- |
| rahul-uuid  | Rahul Kumar | NULL             | 9876543210 | Patient   | Active      |
| priya-uuid  | Priya Kumar | NULL             | 9876543211 | Patient   | Active      |
| mother-uuid | Sunita Devi | NULL             | NULL       | Patient   | Active      |
| arjun-uuid  | Arjun Kumar | NULL             | NULL       | Patient   | Active      |
| doc-uuid    | Dr. Sharma  | dr@email.com     | 9898989898 | Doctor    | Active      |
| admin-uuid  | Admin User  | admin@clinic.com | NULL       | Admin     | Active      |

### patient_family_links:

| primary_patient_id | linked_patient_id | relationship |
| ------------------ | ----------------- | ------------ |
| rahul-uuid         | priya-uuid        | spouse       |
| rahul-uuid         | mother-uuid       | parent       |
| rahul-uuid         | arjun-uuid        | child        |

### clinic_assign:

| user_id     | clinic_id   |
| ----------- | ----------- |
| rahul-uuid  | clinic-a-id |
| rahul-uuid  | clinic-b-id |
| priya-uuid  | clinic-a-id |
| mother-uuid | clinic-a-id |

### appointments:

| patient_id  | clinic_id   | doctor_id | status    |
| ----------- | ----------- | --------- | --------- |
| rahul-uuid  | clinic-a-id | doc-uuid  | Completed |
| rahul-uuid  | clinic-b-id | doc-uuid  | Upcoming  |
| priya-uuid  | clinic-a-id | doc-uuid  | Upcoming  |
| mother-uuid | clinic-a-id | doc-uuid  | Completed |

---

## Database Migration Steps (in order)

1. Make `email` column nullable: `ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`
2. Drop existing global unique index on email
3. Add partial unique index on email for staff: `WHERE user_type != 'Patient' AND email IS NOT NULL`
4. Cleanup existing duplicate patient records (merge by mobile)
5. Add partial unique index on mobile for patients: `WHERE user_type = 'Patient' AND mobile IS NOT NULL`
6. Add `patient_otp` to token_type enum
7. Create `patient_family_links` table
8. Remove fake email generation from `createPatient` code — store NULL instead

---

## Summary

- **1 model change:** email becomes nullable in users table
- **1 new table:** patient_family_links
- **1 new enum value:** patient_otp in tokens
- **3 new indexes:** partial unique on patient mobile, partial unique on staff email, fast lookup indexes
- **1 data cleanup:** merge existing duplicate patients
- **Zero FK changes** — all existing relationships stay exactly the same
- **Zero column additions** — no new columns in any existing table
