# Referral module — dev plan

Status: **planning — not approved yet.** Branch: `feat/referral-rebuild` (BE + FE, from `origin/staging`).

## In simple points

**What it does**
- Admins and Doctors get their own referral code (e.g. `MEDI-7KQ2XB`).
- They share the link; new clinics sign up with it.
- We count two things: how many **joined** and how many **paid**.
- No rewards yet — can be added later.

**How it works, step by step**
1. Dr. A opens Settings → Referral and sees the code and a "Copy link" button.
2. Dr. A sends the link to Clinic B.
3. Clinic B signs up with the link → **Waiting for approval** (not counted yet).
4. Super Admin approves Clinic B → counted as **Joined**.
5. Clinic B buys a plan → counted as **Paid**.
6. Dr. A's screen shows "Joined 1 · Paid 1".
7. The superadmin sees everyone's referrals in one list.

**Automatic, no manual work**
- No approve/reject buttons. The status changes by itself.

**Safety rules**
- One code per user; it never changes.
- One link works for any number of signups.
- A clinic is counted only once.
- You can't use your own code.
- A wrong code doesn't block signup; it just isn't counted.
- Only Admins and Doctors get a code, checked on the server too, not just the screen.

**What changes in the code**
- **Removed:** old referral code (BE + FE) and old referral data.
- **Backend:** new referral module, 2 tables, 3 APIs.
- **Frontend:** new Settings → Referral page, simpler superadmin page, Doctors can see it too.
- **You run** the database migration.

## Steps

Each step stops for review before the next.

| # | Step | Repo |
|---|---|---|
| 1 | Remove old referral code | BE + FE |
| 2 | New tables (models) → owner runs the migration | BE |
| 3 | Module core: create code, `recordSignup`, `markPaid` | BE |
| 4 | 3 APIs (my code, my referrals, superadmin list) + tests | BE |
| 5 | Hook into signup + payment; update superadmin analytics | BE |
| 6 | Screens: Settings → Referral, superadmin page, Doctor menu | FE |

## Rules

- **Who can refer:** Admin and Doctor (`REFERRAL_ROLES = ['Admin', 'Doctor']`, one list on each end).
- **What we track (for now):** per referrer — **Waiting** (signed up, not approved yet), **Joined** (Super Admin approved the clinic) and **Paid** (first paid plan). Statuses `signed_up → joined → paid`, updated automatically.
- **Benefits later:** reward tables are added later without changing the tables below.
- **Old data:** the old `referrals` table and its rows are dropped.

Example: Dr. A shares `MEDI-7KQ2XB` → Clinic B signs up (**joined**) → B pays for its first plan (**paid**). Dr. A's screen shows "Joined 1 · Paid 1".

## Why rebuild

- Old `referralCode` was unique per row, so one shared link worked for only one signup; the next failed silently.
- Code was AES of the user id with a hardcoded key; a new, long code every time.
- No role check on the backend — any logged-in user (even Patient) could get a link.
- "Approve" changed nothing; no paid tracking.

## 1. Remove old code

**Backend**
- `src/main/users/models/referral.model.ts`
- `src/utils/referralEncodeDecode.ts`
- `user.controller.ts`: referral block in `registerController`, `generateReferralCodeController`, `referralsController`, `updateReferralController`
- `user.service.ts`: `updateReferralStatus`, `referrals`, referral stats query
- `users.route.ts`: the 3 referral routes · `auth.schemas.ts`: the 2 referral schemas
- Keep `referralCode` in the signup body.

**Frontend**
- `src/redux/api/referralApi.ts` (+ its entry in `apiRoot.ts`)
- `src/pages/profile/Referrals.tsx`
- `src/pages/dashboard/superadmin/Referral/` (3 files)

## 2. Backend — new bounded module `src/main/referral/`

Shape copies `credits` (BE standards §1 bounded module).

### Tables

`referral_codes`

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `code` | unique, short (`MEDI-7KQ2XB`) |
| `owner_user_id` | unique — one code per user (no FK, id only) |
| `clinic_id`, `lab_id` | owner's tenant, nullable |
| `active` | bool, default true |
| `created_at` | |

`referral_signups`

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `code_id` | → `referral_codes.id` |
| `referrer_user_id` | |
| `referred_user_id` | **unique** — a user is counted once |
| `referred_clinic_id` | nullable |
| `status` | enum `joined` / `paid` |
| `joined_at`, `paid_at` | |

### Routes

| Route | Who | Does |
|---|---|---|
| `GET /api/v1/referral/my-code` | Admin, Doctor | my code + link (created on first call) |
| `GET /api/v1/referral/my-referrals` | Admin, Doctor | paged list + Joined/Paid counts |
| `GET /api/v1/referral/superadmin/list` | Super Admin | all referrals, filters, totals |

### Automatic updates (exported on `index.ts`)

- `recordSignup(code, newUserId)` — called after signup. Saves a `joined` row. Bad code or own code → logs a warning, never blocks signup.
- `markPaid(userId)` — called from the Razorpay `payment.captured` flow (`subscription.controller.ts:532`). Moves `joined → paid` once; safe to rerun.

### Other

- Superadmin analytics source (`adapters/superadminAnalytics/sourceData.adapter.ts:84`) reads the new table.
- Tests: `routes.guard.test.ts` + one service test.

## 3. Frontend

- New `referralApi.ts` (3 calls) on `baseQueryWithAutoLogout`, registered in `apiRoot.ts`.
- **Settings → Referral:** code, "Copy link" button, Joined / Paid cards, list with loading/empty/error states.
- `settingsNav.tsx` `roleHide`: remove `"referral"` from Doctor.
- **Superadmin → Referrals:** read-only list and totals (no approve buttons).
- Signup: keeps reading `?rfc=` (`SignupEmail.tsx`).

## 4. Owner runs

- Migration: drop old `referrals` table + `referral_status` enum, create `referral_codes`, `referral_signups` + `referral_signup_status` enum. New names avoid clashing with the old table and enum.

## Open questions

1. Short code format like `MEDI-7KQ2XB` OK? Old links stop working.
2. "Paid" = **first** paid plan only, or every renewal?
