# Treatment Plan module — development plan (Phase 1)

Status: plan, not started · 2026-10-12 · Source of truth for scope: the "Treatment Plan Module – Final Plan"
doc (section B2 holds the review decisions). This file maps that plan onto this codebase.

## 1. Scope

Phase 1 delivers one baseline flow for every specialty, with two plan types: **Staged** and **Session
package**. Timeline, Review and Cycle get reserved enum values only; their columns (`anchor_date`, follow-on plan, step checklist and result) are added in the phase that uses them. The current plan version is read from `treatment_plan_versions`, not stored on the plan.

Decisions already made (Final Plan, B2):

| # | Decision | What it means in code |
|---|---|---|
| 1 | Phase 1 = Staged + Package | `plan_type` enum carries all five; validation accepts only `staged` / `package` |
| 2 | Book all visits at once; gap counts from the previous step's **booked** date | `earliest_date` recalculated on every booking, move, miss (§5) |
| 3 | No consultation fee on treatment visits | A plan-linked appointment carries no consultation charge; money lives in the plan ledger (§6) |
| 4 | Normal booking or dedicated treatment time, per clinic setting | `treatment_plan_settings.booking_mode`; Phase 1 builds `normal` first |
| 5 | Refund: Admin, Doctor, Receptionist · Discount: Admin, Doctor | `requireRole` on those routes |
| 6 | No branches in Phase 1 | No `branch_id` column; added with the branch feature later (§9) |
| 7 | Review feedback: steps, gaps, sessions, timing, fees and specialty settings are configurable, not hard-coded | §1.1 below |

### 1.1 Configurable, not hard-coded

Adding Dental (and later specialties) must be **data entry, not a code change**. The rule for the code:
no specialty name, step name, gap, fee or session count appears in source, and nothing branches on a
specialty (`if (specialty === 'Dental')` is a review rejection).

| What | Where it is configured | Who sets it |
|---|---|---|
| Steps, order, step names | `treatment_template_steps` | Super Admin (library), Admin/Doctor (clinic) |
| Gaps (min, optional max), optional duration per step (blank = appointment slot length) | `treatment_template_steps.gap_days`, `max_gap_days`, `duration_minutes` | same |
| Session count, interval, package expiry | `treatment_templates.session_count`, `interval_days`, `package_expiry_days` | same |
| Fees, package price, priced options, taxable, instalments | `treatment_templates`, `treatment_template_steps.fee`, `options` | same |
| Which timing rule applies | `treatment_templates.plan_type` (each type's date maths is one function in `timing.utils.ts`, fed only by the values above) | same |
| Specialty-specific fields (tooth number, body area, pain score…) | `treatment_specialty_configs` (§3.6), values in `specialty_data` on plans and steps | Super Admin |
| Diagnosis keywords for suggestions | `treatment_templates.diagnosis_keywords` | same as templates |
| Billing modes, discount cap, invoice timing, booking mode, reminder lead times | `treatment_plan_settings` | Clinic Admin |
| Every per-plan change (steps, gaps, fees, dates) | `treatment_plan_steps`, copied from the template and editable | Doctor |

What stays code: the date maths per plan type, validation of field values against their definitions, and
special widgets (a tooth chart). A widget reads and writes the same `specialty_data`, so it adds UI only.

## 2. Module shape

New code follows the **bounded module** shape (BACKEND_STANDARDS §1, reference: `credits`).

```
src/main/treatmentPlan/
  index.ts                 public surface only (onAppointmentChanged, cron entry points, seeds)
  ports/                   appointment, patient, consultation, doctor, notify (+ index.ts)
  routes/v1/
    treatmentPlan.route.ts → /api/v1/treatment-plan
    templates.route.ts     → /api/v1/treatment-plan/templates
    payments.route.ts      → /api/v1/treatment-plan/payments
    settings.route.ts      → /api/v1/treatment-plan/settings
    superadmin.route.ts    → /api/v1/treatment-plan/superadmin (ready-made library)
  controllers/ models/ schemas/ types/ utils/ __tests__/
  services/
    templates/             template CRUD, copy, activate/archive
    plans/                 create, propose, decide, version, close
    scheduling/            timing rules, booking, appointment sync
    billing/               ledger, instalments, refunds, receipts
src/adapters/treatmentPlan/  one adapter per port + initTreatmentPlanPorts() called in app.ts
```

Boundary rules that apply here:
- No foreign keys to other modules' tables. Store `clinic_id`, `patient_id`, `doctor_id`, `appointment_id` as plain uuids.
- The plan module never writes `appointments`. It books through the appointments module's own public
  function, reached via `AppointmentPort`.
- The appointments module tells the plan module about status changes by calling
  `treatmentPlan.onAppointmentChanged(event)` **after commit**. It never throws (§7).

### 2.1 Layer flow (every endpoint)

Each request passes the same layers, each with one job (BACKEND_STANDARDS §1–§6). Nothing skips a layer,
and nothing reaches into another module except through a port.

| Layer | File | Does | Never does |
|---|---|---|---|
| Route | `routes/v1/treatmentPlan.route.ts` | 2-line header; `requireAuth` → `requireClinic` → `requireRole([...])` → `validateZod(schema)` → `asyncHandler(controller)` | logic, DB, reshaping the body |
| Schema | `schemas/plan.schema.ts` | Zod for body, params, query; types come from `z.infer` | — |
| Controller | `controllers/plan.controller.ts` | reads validated input + `req.user`/`req.clinicId`, calls **one** service method, returns `sendOk`/`sendCreated` | business rules, queries, `res.status().json()` |
| Service | `services/plans/decision.service.ts` | business rules, transaction, DB access through the models, `throw new HttpError` | touch `req`/`res`, call HTTP or queues inside a transaction |
| Model | `models/treatmentPlan.model.ts` | Drizzle table, enums, indexes, checks, `$type` for jsonb | logic |
| Port | `ports/appointment.port.ts` | the module's own description of what it needs from another module | import that module |
| Adapter | `src/adapters/treatmentPlan/appointment.adapter.ts` | implements the port by calling the other module's public function | write another module's tables |
| Types / utils | `types/plan.types.ts`, `utils/timing.utils.ts` | shared types; pure helpers with tests | DB access |
| After commit | service, after the transaction resolves | cache invalidation, realtime signal, `notify()` | run inside the transaction |

Worked example: **POST `/api/v1/treatment-plan/:planId/decision`** (accept)

```
route        requireAuth → requireClinic → requireRole(['Admin','Doctor','Receptionist'])
             → validateZod(decisionSchema) → asyncHandler(PlanController.decide)
controller   PlanController.decide → DecisionService.accept({ planId, clinicId, userId, input }) → sendOk(res, 'Plan accepted', result)
service      staff scope check (404 if not visible) → database.transaction(tx =>
               lock proposal group FOR UPDATE → status accepted → insert version 1
               → insert advance ledger row → decline option B → history rows)
             → after commit: invalidate treatmentPlanCounts, realtimeBus.notify(target.treatmentPlans), notify(...)
models       treatment_plans, treatment_plan_versions, treatment_ledger, treatment_plan_settings, treatment_plan_history
```

Services split by sub-domain once a folder passes ~6 files (`templates/`, `plans/`, `scheduling/`,
`billing/`), with one-way imports: `billing` and `scheduling` may use `plans`, never the reverse.

## 3. Schema

All tables: `id uuid pk default random`, `clinic_id uuid` (not null, except library rows: `treatment_templates`, `treatment_template_steps`, `treatment_specialty_configs`), `created_at timestamptz`. `updated_at` on every table except the append-only ones (`treatment_ledger`, `treatment_plan_history`, `treatment_plan_versions`, `treatment_step_appointments`).
Money is `decimal(12,2)`. Migrations are generated by the repo owner, never by an agent (§7 of the standards).

### 3.1 Enums

| Enum | Values |
|---|---|
| `tp_plan_type` | `staged`, `package`, `timeline`, `review`, `cycle` (last three reserved) |
| `tp_template_status` | `draft`, `active`, `inactive`, `archived` |
| `tp_plan_status` | `proposed`, `accepted`, `in_treatment`, `completed`, `declined`, `paused`, `ended_early` |
| `tp_step_status` | `pending`, `in_progress`, `done`, `missed`, `skipped`, `window_missed` |
| `tp_pricing_mode` | `per_step`, `package` |
| `tp_billing_mode` | `per_visit`, `advance_per_visit`, `package_full`, `package_instalments` (how the plan is billed; not the cash/UPI/card mode) |
| `tp_ledger_entry` | `charge`, `advance`, `payment`, `refund`, `write_off`, `credit_note` |
| `tp_booking_mode` | `normal`, `dedicated` |

Step status stores only the step's **own** outcome. "Booked" and "Arrived" are read from the linked
appointment, so the two records can't disagree (appointments already hold `Patient Arrived`, `NoShow`).

### 3.2 Templates

**`treatment_templates`** — ready-made (`clinic_id` null), clinic copy, or a doctor's own version.
Edited in place: a plan copies the steps and fees it uses (§3.3), so editing a template never changes an
existing plan. Each edit writes a history row (who, when).

Library rows and clinic rows share this table. Guardrails that make that safe:
- **Writes are always scoped.** Clinic routes update/delete only `where clinic_id = req.clinicId`, so a
  library row (`clinic_id is null`) can never be changed by a clinic. Only Super Admin routes write library rows.
- **Reads never mix by accident.** The library endpoint asks for `clinic_id is null`; clinic endpoints ask
  for `clinic_id = req.clinicId`. No query uses `clinic_id is null or …`.
- **Seed never overwrites.** The seed inserts a library template only when its `code` is missing. After
  that, Super Admin's screen owns the row; re-running the seed changes nothing.
- **Copies don't drift silently.** A clinic copy keeps `source_template_id`; when the library row's
  `updated_at` is newer than the copy's `created_at`, the clinic sees "A newer library version exists"
  and can review it. Nothing is pushed to clinics automatically (their fees and edits are theirs).
- **Unique rules use partial indexes** (`code` unique where `clinic_id is null`), because Postgres treats
  nulls as distinct in a plain unique index.

**Which templates a doctor sees** (consultation suggestions and "Choose template"):

```
status = 'active'
and clinic_id = <clinic from token>
and specialty in <doctor's specialization list>            -- Q1
and (owner_doctor_id is null or owner_doctor_id = <doctor>) -- clinic copies + only their own versions
```

- A doctor's own version **replaces** the clinic template it was made from, for that doctor only: if
  doctor X has a version whose `source_template_id` is clinic template T, X sees their version, not T.
  Other doctors still see T.
- Order: best diagnosis-keyword match first; on a tie, the doctor's own version before the clinic's.
- Library templates (`clinic_id is null`) are not offered in consultation: their fees are not the clinic's.
  When the clinic has no template for that specialty, the empty state says so and links to the library
  ("Copy a ready-made template").

**Changing it for one patient**: creating a plan copies the template's steps, gaps, fees and options into
`treatment_plan_steps`. The doctor edits those rows (add, remove, reorder, change gap, fee, option, date,
specialty values) and the template stays untouched. "Save as my template" turns the edited plan into a
new template row with `owner_doctor_id` = that doctor and `source_template_id` = the template used.

| Column | Type | Notes |
|---|---|---|
| clinic_id | uuid null | null = ready-made library template |
| owner_doctor_id | uuid null | set = a doctor's own version, shown first to that doctor |
| source_template_id | uuid null | copied from |
| code | varchar(64) null | stable key of a library template, e.g. `dental.root_canal`; unique where `clinic_id is null`; the seed inserts only when it is missing |
| name | varchar(150) | |
| specialty | varchar(100) | matched against the doctor's specialization (§10 Q1) |
| ~~category~~ | removed 2026-10-16 | dropped end to end (form, list, search, API); see CHANGELOG "Polish 2026-10-15/16" |
| plan_type | tp_plan_type | |
| status | tp_template_status | only `active` is offered to doctors |
| pricing_mode | tp_pricing_mode | |
| package_price | decimal null | when `pricing_mode = package` |
| session_count | int null | package only |
| interval_days | int null | package only |
| package_expiry_days | int null | package only |
| consent_required | bool | |
| taxable | bool | GST open item; stored, not applied yet |
| instalments_allowed | bool | |
| recall_after_days | int null | |
| diagnosis_keywords | text[] | GIN index; suggestion match |
| checked_by / checked_at | uuid / timestamptz null | "Checked by doctor" before activate |
| created_by | uuid | |

**`treatment_template_steps`** — Staged only; a package template has no step rows (sessions are generated).

| Column | Type | Notes |
|---|---|---|
| clinic_id | uuid null | same as the parent template (null for library steps) |
| template_id | uuid → treatment_templates | same module, FK allowed |
| seq | int | `(template_id, seq)` unique |
| name | varchar(150) | |
| gap_days | int | minimum gap after the previous step |
| max_gap_days | int null | reminder only |
| duration_minutes | int null | null = use the doctor's normal slot length (slot settings, else `clinic_settings.default_consultation_minutes`) |
| fee | decimal null | |
| options | jsonb `$type<StepOption[]>` | `[{ label, extraFee }]`, e.g. crown material |

### 3.3 Plans

**`treatment_plans`**

| Column | Type | Notes |
|---|---|---|
| patient_id, doctor_id | uuid | |
| template_id | uuid null | null = custom plan |
| consultation_appointment_id | uuid null | the visit that created it; its `report_cards` row holds the diagnosis, so no separate report-card id is stored |
| proposal_group_id | uuid | option A and B share it; accepting one declines the others |
| option_label | varchar(10) null | `A`, `B` |
| title | varchar(150) | |
| diagnosis | text | copied at creation |
| plan_type | tp_plan_type | |
| status | tp_plan_status | |
| billing_mode | tp_billing_mode null | chosen on accept |
| discount_amount, total_amount, advance_amount | decimal | `total_amount` = the agreed price; the steps' fee sum is calculated, not stored |
| consent_file_url | text null | plain S3 key, never a signed link |
| accepted_at, completed_at | timestamptz null | consent is given in the accept action, so `accepted_at` is also the consent time; who approved a discount above the cap is in `treatment_plan_history` (`discount_approved`) |
| follow_up_date | date null | think / decline → suggested list |
| end_reason | varchar(255) null | |
| end_reason_sensitive | bool default false | true stops all messages for the plan |
| recall_date | date null | |
| consent_required | bool | copied from the template at creation, so a later template edit never changes the rule for this plan |
| package_expires_on | date null | package plans: accept date + `package_expiry_days`; moved by "Extend package" |
| specialty_data | jsonb `$type<Record<string, SpecialtyValue>>` default `{}` | plan-level specialty values (e.g. tooth 36), validated against §3.6 |
| created_by | uuid | |

Indexes: `(clinic_id, status)`, `(clinic_id, patient_id)`, `(clinic_id, follow_up_date)`, `(clinic_id, recall_date)`.

**`treatment_plan_versions`** — immutable snapshot each time the accepted plan changes.

| Column | Type | Notes |
|---|---|---|
| plan_id | uuid → treatment_plans | `(plan_id, version)` unique |
| version | int | |
| snapshot | jsonb `$type<PlanSnapshot>` | steps, fees, totals at that version |
| change_reason | varchar(255) null | |
| needs_patient_approval | bool | true when cost or steps changed |
| patient_approved_at | timestamptz null | |
| created_by | uuid | |

**`treatment_plan_steps`** — one row per step; a package plan gets one row per session.

| Column | Type | Notes |
|---|---|---|
| plan_id | uuid → treatment_plans | `(plan_id, seq)` unique |
| seq | int | |
| name | varchar(150) | |
| gap_days | int | from template or edited |
| duration_minutes | int null | null = use the doctor's normal slot length (slot settings, else `clinic_settings.default_consultation_minutes`) |
| fee | decimal | |
| selected_option | jsonb null | |
| specialty_data | jsonb `$type<Record<string, SpecialtyValue>>` default `{}` | step-level specialty values (e.g. machine settings), validated against §3.6 |
| status | tp_step_status default `pending` | |
| earliest_date | date null | computed (§5); partial index `(clinic_id, earliest_date) where status = pending` serves "Need booking" |
| gap_override_reason | varchar(255) null | set when a booking goes under the gap |
| done_at | timestamptz null | |
| done_appointment_id | uuid null | |
| notes | text null | |

**`treatment_step_appointments`** — the link table. One visit can cover steps from two plans; one step can need two visits.

| Column | Type | Notes |
|---|---|---|
| step_id | uuid → treatment_plan_steps | |
| plan_id | uuid → treatment_plans | denormalised for list queries |
| appointment_id | uuid | no FK (boundary) |
| linked_by | uuid | |
| unlinked_at | timestamptz null | unlink keeps the row; step goes back to "not booked" |

Unique `(step_id, appointment_id) where unlinked_at is null` (a partial index, so an appointment unlinked by mistake can be linked again); index `(appointment_id)` for the status-change hook.

### 3.4 History

**`treatment_plan_history`** — `plan_id` (null for a template edit), `template_id` (null for a plan
event), `actor_id`, `action` (`varchar(64)`), `from_value`, `to_value`, `reason`, `notes text`,
`meta jsonb $type<HistoryMeta>`. Every status change, override, discount approval, refund and template edit
writes a row. **A follow-up call is a row too** (`action = 'follow_up_call'`, outcome in `to_value`, call
notes in `notes`); the plan's next follow-up date stays on `treatment_plans.follow_up_date`.
Index `(plan_id, action, created_at)` for the call log; `(template_id, created_at)` for template history.
**History vs the shared audit log.** Both are used, for different jobs, with no duplicated purpose:

| | `audit_log` (existing) | `treatment_plan_history` |
|---|---|---|
| Job | security log: which staff member did which action | the plan's own record: what happened and why |
| Filled by | `auditLog.middleware` for routes in `TRACKED_ACTIONS` | the plan services, per business event |
| Holds | user, action, record id, IP | actor, action, from → to, reason, notes, `meta` |
| System events (missed step via the appointment hook) | not recorded | recorded |
| Kept | 90 days (`AUDIT_LOG_RETENTION_DAYS` purge) | with the plan; retention decided in D6 |
| Shown in | the clinic's audit screen | plan History tab, follow-up call log |

So the plan module adds its sensitive routes to `TRACKED_ACTIONS` (one line each, no new code): accept
plan, approve discount, refund, write-off, end early, extend package. Everything else is plan history only.

**`meta` per action** (typed as a union keyed by `action` in `types/history.types.ts`; ids and numbers
only, never names, phones or other patient details):

| `action` | `from_value` → `to_value` | `meta` |
|---|---|---|
| `plan_created` | — | `{ templateId? }` |
| `status_change` | e.g. proposed → accepted | — |
| `ended_early` | in_treatment → ended_early | `{ sensitive: boolean }` |
| `version_created` | 1 → 2 | `{ needsPatientApproval: boolean }` |
| `gap_override` | — | `{ stepId, earliestDate, bookedDate }` |
| `discount_approved` | — | `{ discountAmount, capPercent }` |
| `refund`, `write_off`, `credit_note` | — | `{ ledgerEntryId, amount }` |
| `step_done`, `step_missed`, `step_linked`, `step_unlinked` | — | `{ stepId, appointmentId? }` |
| `follow_up_call` | — → call outcome | `{ nextFollowUpDate? }` (call notes in `notes`) |
| `template_copy` | — | `{ sourceTemplateId }` |
| `template_edit` | — | `{ changedFields: string[] }` |
| `package_extended` | old → new expiry date | `{ extensionFee?: string; ledgerEntryId?: string }` |

Pause and resume are `status_change` rows (in_treatment → paused, paused → in_treatment).

A new action adds a row here and a member to the union; the service rejects an action with no defined shape.

### 3.5 Money

**`treatment_ledger`** — append-only. Rows are never updated or deleted; a correction is a `credit_note`.

| Column | Type | Notes |
|---|---|---|
| plan_id | uuid | the patient is read through the plan, not stored twice |
| entry_type | tp_ledger_entry | |
| amount | decimal | always positive; the type gives the direction |
| step_id | uuid null | set on a step charge; null on a package-extension charge (reason required) |
| instalment_id | uuid null | |
| payment_mode | varchar(20) null | same values as appointment payments: `Cash`, `UPI`, `Card` (`Online` later), so screens and reports use one vocabulary |
| reason | varchar(255) null | required for refund, write_off, credit_note |
| approved_by | uuid null | required for write_off |
| request_id | uuid null | sent by the screen with every money action; unique `(clinic_id, request_id)`, so a retried or double-clicked request returns the first entry instead of saving a second (§3.7) |
| created_by | uuid | |

Balance = charges − (advance + payments) + refunds − write-offs − credit notes.
**Receipt number** (Q15): not stored. It is built from the ledger row the same way appointment invoices are
(`INV-{year}-{6 chars of the payment id}` in `patient.service.ts`): `TP-{year}-{first 6 chars of the ledger id}`,
in one helper in `utils/`. If D4 decides taxable plans need consecutive serial numbers (GST receipt
vouchers), D4 adds a stored number and a per-clinic counter; receipts already issued keep theirs.

"Due now" = charges not yet covered; "Remaining" = total_amount − charges. Both computed in SQL.

**`treatment_instalments`** — `plan_id`, `seq`, `amount`, `due_date`, `paid_at`, `reminded_at`.
Sum must equal `total_amount − advance_amount`, checked in the service on save **and on every new version that changes the total** (price change, package extension fee). That version must re-balance the unpaid instalments (add one, or change unpaid amounts) or collect the difference at once; it is refused until the sum matches. Paid instalments never change.

### 3.6 Settings

**`treatment_plan_settings`** — one row per clinic (own table, so `clinic_settings` stays untouched).

| Column | Type | Notes |
|---|---|---|
| clinic_id | uuid unique | |
| billing_modes | tp_billing_mode[] | which billing modes the clinic offers |
| invoice_timing | varchar(10) | `per_step` or `at_end` |
| discount_cap_percent | int | above it needs Admin/Doctor approval |
| booking_mode | tp_booking_mode default `normal` | B2 #4 |
| booking_horizon_days | int null | how far ahead steps may be booked |
| recall_reminder_days | int default 7 | days before the recall date the patient is reminded |
| instalment_reminder_days | int default 2 | days before an instalment is due |
| package_expiry_reminder_days | int default 7 | days before `package_expires_on` that reception and the patient are reminded |

**`treatment_specialty_configs`** — one row per specialty: the extra fields that specialty needs. Adding
a specialty's fields is inserting a row here, not a code change.

| Column | Type | Notes |
|---|---|---|
| clinic_id | uuid null | null = platform default (Super Admin); a clinic row overrides it later if needed |
| specialty | varchar(100) | matched to the template's specialty; unique with `clinic_id` |
| plan_fields | jsonb `$type<FieldDef[]>` | fields asked once per plan, e.g. tooth number |
| step_fields | jsonb `$type<FieldDef[]>` | fields asked at each step, e.g. machine settings |
| widget | varchar(50) null | name of a special UI widget, e.g. `tooth_chart` (UI only) |
| is_active | bool | |

`FieldDef` = `{ key, label, type: 'text'|'number'|'select'|'multiselect'|'date'|'boolean', options?, unit?, min?, max?, required }`.
The service builds a Zod schema from the definitions at runtime and validates `specialty_data` with it;
the FE renders the same definitions with the shared form fields. Phase 1 seeds **no** rows, so the
baseline works with empty `specialty_data`; Dental adds its row in product Phase 2.

### 3.7 Integrity rules (enforced by the database, not only the service)

The service checks these too, but the database is the last line: a double click, a retried request or
two receptionists at once must not be able to break the data. Drizzle supports each one (`check()` and
partial `.where(sql…)` indexes are already used in `notifications` and `credits`).

**Duplicates and races**

| Risk | Guard |
|---|---|
| Step marked done twice → charged twice | Unique `(step_id) where entry_type = 'charge'` on `treatment_ledger` |
| "Collect payment" clicked twice, or retried after a network drop → paid twice | Every money action (accept with advance, payment, refund, write-off, credit note) carries a `request_id` the screen generates once per form; unique `(clinic_id, request_id) where request_id is not null` on `treatment_ledger`; a repeat returns the existing entry and receipt (200), never a new row |
| Same step linked to the same appointment twice | Partial unique on `treatment_step_appointments` (above) |
| Two library templates with one code | Unique `(code) where clinic_id is null` |
| Option A and B both accepted | Accept runs in one transaction that locks the proposal group (`SELECT … FOR UPDATE`) and declines the others |
| Two people edit the same proposed plan | Edit sends the `updated_at` it read; update `where id = … and updated_at = …`; 0 rows → 409 "This plan was changed by someone else. Reload to see the latest." |
| Reordering steps clashes with unique `(plan_id, seq)` | Reorder in one transaction: add 1000 to every `seq` in the plan, then write the final order (keeps `seq >= 1` valid) |

**Bad values** (`check()` constraints)

| Table | Check |
|---|---|
| `treatment_ledger` | `amount > 0`; `reason is not null` for refund, write_off, credit_note, and for a `charge` with no `step_id`; `approved_by is not null` for write_off |
| `treatment_plans` | `total_amount >= 0`, `discount_amount >= 0`, `advance_amount >= 0`, `discount_amount <= total_amount + discount_amount` |
| `treatment_plan_steps`, `treatment_template_steps` | `seq >= 1`, `gap_days >= 0`, `duration_minutes is null or duration_minutes > 0`, `fee >= 0` |
| `treatment_templates` | package plans have `session_count >= 1` and `interval_days >= 1` |
| `treatment_instalments` | `amount > 0` |
| `treatment_plan_history` | exactly one of `plan_id`, `template_id` is set |

**Indexes for the real queries**

| Query | Index |
|---|---|
| Plan list with staff scope (Doctor → own) | `treatment_plans (clinic_id, doctor_id, status)` |
| Need booking | `treatment_plan_steps (clinic_id, earliest_date) where status = 'pending'` |
| Ledger by period (reports, D1) | `treatment_ledger (clinic_id, created_at)` |
| Appointment hook | `treatment_step_appointments (appointment_id)` |
| Due instalments job | `treatment_instalments (due_date) where paid_at is null` |

**Dates**: `date` columns hold the IST calendar day; `timestamptz` columns hold instants. Appointments
store `appointment_date` as UTC midnight of the IST day, so conversions go through `utils/istDateTime.ts`
helpers only, never `setHours` (WORKFLOW §6).

### 3.8 Changes outside the module

| Where | Change | Why |
|---|---|---|
| `appointments/utils/appointmentType.constants.ts` | add `APPOINTMENT_TYPE_TREATMENT = 'Treatment'` | `appointment_type` is free text; no enum change |
| appointments service: complete, no-show, cancel, reschedule paths | call `treatmentPlan.onAppointmentChanged()` after commit | §7 |
| appointment booking | a plan-linked booking carries no consultation fee | B2 #3; see §10 Q4 |
| `src/adapters/treatmentPlan/` + `app.ts` | ports + `initTreatmentPlanPorts()` | boundary |
| `audit/utils/trackedActions.utils.ts` | 6 lines: accept, approve discount, refund, write-off, end early, extend package | clinic audit screen shows sensitive plan actions |
| notification registry | new events (§8) | all sends through `notify()` |

## 4. Endpoints

All routes: `requireAuth` → `requireClinic` → `requireRole([...])`, Zod on every input, `sendOk`/`sendCreated`,
tenant filter from the token. "Staff" = Admin, Doctor, Receptionist.

| Method · path (`/api/v1/treatment-plan…`) | Purpose | Roles |
|---|---|---|
| GET `/templates` · GET `/templates/:id` | management list (clinic templates + the caller's own versions; filters, ranked search, archived only on request) · one template with steps | Staff |
| GET `/templates/available` | active templates this doctor may use (rules in §3.2: specialty, own versions replace the clinic copy); cached | Doctor |
| GET `/templates/library` · `/library/:id` | active ready-made templates to copy | Admin, Doctor |
| POST `/templates/preview` | sample dates, total and length from unsaved values (saves nothing) | Admin, Doctor |
| POST `/templates/:id/copy` | copy to clinic or own version | Admin, Doctor |
| POST `/templates` · PUT `/templates/:id` | create · edit in place (existing plans keep their copy) | Admin, Doctor |
| POST `/templates/:id/check` | mark checked (needed before activate); records who and when | Admin, Doctor |
| POST `/templates/:id/activate` · `/deactivate` · `/archive` | status moves; archived is final; no delete | Admin, Doctor |
| GET `/suggestions?diagnosis=` | best match + up to 3 others, with the matched keyword; reads the diagnosis as typed (final, else provisional) | Doctor |
| POST `/` | create plan (proposed), optional option B | Doctor |
| GET `/` | list; `tab=suggested\|need_booking\|missed\|in_treatment\|closed`; each row carries `steps_done` and `steps_total` (for "3 of 6 sessions"), counted in the same query | Staff |
| GET `/:planId` | detail: steps, appointments, ledger, history | Staff |
| PUT `/:planId` | edit; after accept creates a version | Doctor |
| POST `/:planId/save-as-template` | turn this plan into the doctor's own template | Doctor |
| POST `/:planId/options` | copy as the next option (A → B → C, max 3) in the same proposal group | Doctor |
| GET `/patients/:patientId` | patient name + recorded allergies for the create screen (allergies are a reminder, never a block) | Doctor |
| POST `/:planId/decision` | accept / think / decline | Staff |
| POST `/:planId/followups` | log a call (history row) + set next date | Staff |
| GET `/:planId/steps/:stepId/allowed-dates` | earliest date + doctor's free slots | Staff |
| GET `/:planId/linkable-appointments` | the patient's upcoming appointments with the plan's doctor, not yet linked, to offer for the next unbooked steps | Staff |
| POST `/:planId/book` | book one step, or all remaining steps | Staff |
| POST `/:planId/steps/:stepId/link` · `/unlink` | link an existing appointment | Staff |
| POST `/:planId/steps/:stepId/complete` | notes, mark done, adds the charge | Doctor |
| POST `/:planId/pause` · `/end` · `/complete` | close actions; `end` takes reason + sensitive flag | Admin, Doctor |
| POST `/:planId/resume` | paused → in treatment; recalculates the next step's earliest date | Admin, Doctor |
| POST `/:planId/extend-package` | new expiry date + optional extension fee (new version; fee charged as its own row) | Admin, Doctor |
| POST `/payments/:planId` | advance / payment, returns receipt; body carries `requestId` (repeat → same receipt) | Staff |
| POST `/payments/:planId/refund` | | Admin, Doctor, Receptionist |
| POST `/payments/:planId/write-off` | | Admin, Doctor |
| POST `/payments/:planId/discount` | approve discount above cap | Admin, Doctor |
| GET · PUT `/settings` | clinic settings | GET Staff · PUT Admin |
| `/superadmin/templates` (list, get, create, edit, preview, check, activate, deactivate, archive) | manage the ready-made library | Super Admin |
| `/superadmin/specialty-configs` (CRUD) | specialty field definitions | Super Admin |
| GET `/specialty-configs/:specialty` | field definitions for a form | Staff |

Before building any endpoint, check the appointments and payments routes for one that already returns
the data (standards §3 "API design").

## 5. Timing rule (Staged + Package)

```
earliest(step 1)   = plan start (accept date)
earliest(step n)   = anchor(step n−1) + gap_days(step n)
anchor(step n−1)   = done_at, else the booked appointment date, else not bookable
```

- Package sessions are steps with the same `gap_days` (= `interval_days`), so one rule serves both types.
- "Book all" books steps in order inside one call, each using the previous booking as its anchor.
- When a booked step moves or is missed, every later step's `earliest_date` is recalculated. A later
  booking that now breaks the gap is **flagged into "Need booking"**; staff can rebook it or cancel it
  from there (§10 Q2).
- Slot days: one slot per step in the core build; consecutive slots by duration come with D2. Token days: one token (§10 Q5).
- A booking before `earliest_date` is refused with the reason, unless `gap_override_reason` is given (Doctor/Admin).
- Lab or outside work **never changes dates** (Q10) and is **not tracked in Phase 1** (Q14). The clinic sets a
  gap long enough for lab time (e.g. crown gap 7 days) and notes the lab on the step.
- All dates are IST (`utils/istDateTime.ts`); never `setHours`.
- This is pure logic: put it in `utils/timing.utils.ts` with a test file. It is the module's riskiest code.

## 6. Money flow

**One payment, one home.** Money for a treatment plan (advance, step payment, instalment, refund) is
recorded **only** in `treatment_ledger`. Treatment appointments carry no fee (B2 #3), so they never get an
appointment payment row; the appointment screen shows "Payment is collected on the treatment plan" instead
of its collect button, so nothing lands in both places. Online plan payments (later) are recorded by the
`payment` module as the gateway transaction and in the ledger as what it paid for, linked by a
`gateway_reference_id` column added then (same name as `financial_ledgers`); they are two views of one
payment, not a duplicate. The existing `financial_ledgers` cannot hold plan money: it requires an
appointment and an appointment payment, and deletes with the appointment.

1. Proposal shows the estimate (steps total, `discount`, `total`, `advance`).
2. Accept records the `advance` ledger row; it is credit, used first.
3. Step done → `charge` row for the step's **share of the agreed total** (charge rules below), not its raw fee.
4. Collect payment → `payment` row + receipt.
5. Close: balance zero = settled; negative = refund; positive with approval = write-off.

**Charge rules** (Q18). The patient agreed to `total_amount`, which can differ from the sum of step fees
(discount, package price). Charges must add up to exactly that total, so:

1. **Share of the total.** A step's charge = `(total − already charged) × step fee ÷ fees of the steps not yet
   charged`, **rounded down to the paisa**. The **last** step to be charged takes whatever is left, so rounding never leaves a paisa over or
   short. Steps with no fee (a package priced only as a whole) split the remainder evenly.
   Example: fees ₹11,000, agreed ₹10,000 → step 1 (₹2,000) is charged ₹1,818.18; …; the last step closes the
   total at exactly ₹10,000. Package 6 × ₹3,000 at ₹15,000 → each session ₹2,500.
2. **Plan changes midway** (new version): charges already made stay; the remaining steps share
   `new total − already charged` by the same rule.
3. **Skipped step:** no charge. If the price should drop, that is a plan change (new version, patient
   approves); otherwise its share moves to the remaining steps by rule 1.
4. **Exact arithmetic:** all money maths in paise (integers) or in SQL `numeric`, never JavaScript floats.
   One helper in `utils/money.utils.ts`, with tests.
5. **Wrong charge:** too much → a `credit_note` for the difference (with reason); too little → corrected
   through a plan change, so later charges absorb it. The one-charge-per-step rule (§3.7) stays.

Dashboards and Payments History read appointment payments today (`dashboard/utils/revenueSql.ts`). Plan
money is invisible there until a port feeds it in. That integration is Phase D item D1; until it ships, plan
money appears only on plan screens. Every ledger write calls `signalAppointmentChange` /
`invalidateClinicDashboardCaches` after commit once that integration exists (WORKFLOW §6).

### 6.1 Plan lifecycle rules (Q19–Q21)

**Allowed status changes.** Anything not listed is refused with 409 "This plan can't be <action> while it is <status>."

| From | To | By |
|---|---|---|
| proposed | accepted · declined | decision (3.1, 3.2) |
| declined | proposed | re-proposed after a follow-up call (Summary, Appendix A) |
| accepted | in_treatment | first step done |
| in_treatment | paused | Pause (6.2) |
| paused | in_treatment | Resume (6.2) |
| in_treatment | completed | all steps done or skipped |
| proposed · accepted · in_treatment · paused | ended_early | End early, with reason |

**Pause.** Linked future appointments are **flagged into "Need booking"** for staff to cancel or keep, as for
a missed visit (Q2); nothing is cancelled automatically. **Resume** sets the plan back to in treatment and
recalculates the next step's `earliest_date` from today.

**Consent.** `consent_required` is copied onto the plan at creation; accept refuses without a consent file
when it is true.

**Package expiry and extension.** For package plans, `package_expires_on` = accept date +
`package_expiry_days`. After that date the plan shows "Package expired" and no new session can be booked.
The doctor (or Admin) then either:

- **Extends the package:** sets a new `package_expires_on` and, optionally, an **extension fee**. A fee raises
  `total_amount` as a plan change (new version, patient approves) and is charged at once as its own ledger
  `charge` with no `step_id` and reason "Package extension". It is not spread over the remaining sessions,
  because charge rule 1 shares only `total − already charged`.
  On a plan billed in instalments, the fee must also be re-balanced into the instalments or paid at once (§3.5).
- **Ends the plan early:** unused sessions are not charged; any credit goes back through the normal refund flow.

## 7. Appointment sync

`onAppointmentChanged({ appointmentId, clinicId, status, date })`, called by the appointments module after commit:

| Appointment event | Plan effect |
|---|---|
| Completed | linked step(s) stay booked until the doctor marks them done; prompt shown |
| NoShow / Missed | step → `missed`, patient into "Missed – rebook", later steps re-checked |
| Cancelled | link closed, step back to "not booked" |
| Rescheduled | later steps re-checked (§5) |

It never throws and is safe to rerun (standards §1 rule 6, §4). It logs and returns on any error.

## 8. Notifications

New events, all through `notify()`, each skipped when the plan has `end_reason_sensitive = true` or the
patient's messaging is off:

- proposal follow-up due (staff)
- step needs booking (staff)
- missed step (staff)
- instalment due (patient + staff)
- recall due, 1 week before (patient)
- package expiring, `package_expiry_reminder_days` before (staff + patient)

The **existing** appointment reminders also have to skip a plan-linked appointment whose plan has a
sensitive end. That is a change inside the notifications module.

## 9. Branches (not in Phase 1)

No branch concept exists today (`clinics` has none; only a subscription add-on counts branches), and
Phase 1 adds none. When the branch feature is built, it adds a nullable `branch_id` to
`treatment_templates` and `treatment_plans` in the same change. Existing rows stay null.

## 10. Open questions (answer before the step that needs them)

| # | Question | Needed by | Recommendation |
|---|---|---|---|
| Q1 | Specialization source: `doctor.specialization` (one value) or `user_professional.specialization` (list)? | 1.6 / 2.1 | **Decided:** the doctor's specialization list (`user_professional.specialization`); a multi-specialty doctor sees all their templates. **Changed 2026-10-27 (owner):** the New plan "Start from" list shows every active clinic template, the doctor's specialties first and the rest named with their specialty; diagnosis suggestions stay own-specialty only |
| Q2 | A later booking that breaks the gap after a move: flag it, or cancel it? | 4.5 | **Decided:** flag it into "Need booking"; staff can also cancel it from there (with confirm) |
| Q3 | Dedicated treatment time: hours set per doctor or per clinic? | D3 | **Decided:** per doctor, through the existing doctor timing flow (availability + session overrides); no new hours table |
| Q4 | Plan-linked appointment payment row: price 0, or no row? Also: when step 1 is done in the same visit as the consultation, is the consultation fee charged as well as the step fee? | D1 | **Deferred:** needs a separate discussion. Moved to Phase D (D1); core booking uses an interim rule, so nothing waits |
| Q5 | A slot-mode step longer than one slot: one slot or several? | D2 | **Decided:** dynamic. Slots booked = step duration ÷ the doctor's slot length, rounded up; a token day books one token. The engine has no multi-slot booking today (none in `availableSlots`/`slotConfig`), so it is built separately as D2; core books one slot until then |
| Q6 | GST, consent format, invoice format (Final Plan, C) | D4 | — |
| Q7 | Plans for minors: guardian consent field? | D4 | add `consent_by_guardian` once data privacy item closes |
| Q8 | Is the module behind a subscription plan (feature gate)? | D5 | **Decided:** not in Phase 1; open to every plan. Add `useFeatureGate` + `subscriptionAccess` later if required |
| Q9 | Who sees which plans: Doctor → own only? Receptionist → assigned doctors only? | 2.2 | **Decided:** yes, same rule as appointments (`StaffScopeService`) |
| Q10 | Does lab/outside work time push the next step's date? | 1.4 | **Decided:** no. Dates use gaps only; the clinic sets a gap that covers lab time |
| Q11 | Seed ready-made templates in Phase 1? | 1.5 | **Decided:** yes. Seed the guide's Staged and Package examples as drafts with empty fees; Super Admin reviews, marks them checked and publishes; fees on a ready-made template are optional suggestions (2026-10-12). A clinic must set every fee on its copy before activating it |
| Q12 | Mockups vs plan | 0.5 | **Decided:** `FE_PLAN.md` is the source of truth; the design canvas mockups are reference only (they still show Cycle and old tab names) |
| Q13 | Step duration: required, or taken from the appointment time? | 1.1 | **Decided:** optional. Blank = the doctor's normal slot length (slot settings, else the clinic default consultation time). Set it only for steps that need longer, e.g. implant surgery 90 min; D2 uses it |
| Q14 | Track outside work (lab, scan) in Phase 1? | — | **Decided:** no, moved to product Phase 2 (Dental), which already lists lab tracking. Until then the doctor notes the lab on the step and marks it done once fitted. Phase 2 adds `treatment_outside_work`, a "done" block, an Outside work tab and a late alert, with no change to existing tables |
| Q15 | Stored, sequential receipt numbers? | 5.2 | **Decided:** no for Phase 1. Receipt number is built from the ledger row (`TP-2026-A1B2C3`), like appointment invoices; no column, counter or lock. D4 adds consecutive numbers only if GST requires them |
| Q16 | Build all plan payments in Phase 1, or only pay-per-visit first? | 5.x | **Decided:** all in Phase 1 (per visit, advance, instalments, refund, write-off, credit note), to avoid rework; payments are the most sensitive part, so Phase 5 is tested hardest |
| Q17 | Stop the same payment being recorded twice (double click, retry)? | 5.2 | **Decided:** yes. Every money action carries a `requestId`; `treatment_ledger.request_id` is unique per clinic; a repeat returns the first entry and receipt |
| Q18 | How are steps charged when the agreed total differs from the step fees (discount, package price)? | 5.1 | **Decided:** each step is charged its share of the agreed total; the last step takes the rounding remainder; plan changes, skipped steps and wrong charges follow §6 "Charge rules"; maths in paise |
| Q19 | Which status changes are allowed; can a declined plan be proposed again; resume after pause? | 6.2 | **Decided:** the table in §6.1; declined → proposed after a follow-up call; paused ↔ in treatment |
| Q20 | What does pause do to booked visits? | 6.2 | **Decided:** linked future appointments are flagged into "Need booking"; staff cancel or keep them; nothing auto-cancelled |
| Q21 | Package expiry: what happens, and can the doctor charge for an extension? | 6.2 | **Decided:** after `package_expires_on` no new booking; doctor extends (new date + optional fee, as a plan change charged as its own row) or ends the plan |
| Q22 | Remind before a package expires? | 6.3 | **Decided:** yes; staff and patient, `package_expiry_reminder_days` before (default 7, clinic setting) |
| Q23 | Instalments when the total changes (price change, extension fee)? | 3.3 | **Decided:** the new version must re-balance unpaid instalments or collect the difference; refused until the sum matches |
| Q24 | Phase 3 choices (owner, 2026-10-12) | 3.1–3.5 | **Decided:** any staff member records the answer from a new staff plan page (`/treatment-plans/:planId`, read-only plan + answer); advance optional; consent file reuses the existing consent uploader (PDF/JPG/PNG, 10 MB) and opens through a 5-minute link (`GET /:planId/consent-file`, file port), never embedded; "Package in instalments" hidden and refused until Phase 5; changing an accepted plan = new version, re-balancing waits for instalments (Phase 5); call reminders (notifications) in Phase 6 |
| Q25 | Phase 4 choices (owner, 2026-10-12) | 4.1–4.8 | **Decided:** no fee at the desk (bookings use the existing "Not Required" payment mode, appointment type "Treatment"); one slot or one token per step (D2 unchanged); booking before the earliest day only by Doctor/Admin with a reason; slot vs token follows the doctor's schedule; "Book all" = each step on its first free day after the gap (60-day search), shown for confirmation; "Mark done" by the plan's doctor only; plan lists refresh on the existing `board` realtime signal (no new section); editing an accepted plan is refused while any step has a live visit (in-place step edits are a later phase); booking/missed reminders come with the Phase 6 notifications |
| Q26 | When is a step done? (owner, 2026-10-13) | 4.6 | **Decided:** only when its linked appointment is completed (Complete Consultation). No manual "Mark done" anywhere; a step with no visit can't be finished — book or link one first. Plan status follows (first done → in treatment, last → completed). **Changed 2026-10-27 (owner):** a step with no booked visit (walk-in) may be marked done by the doctor or an admin, `POST /:planId/steps/:stepId/done`; no undo yet (money reversal deferred). |
| Q27 | Phase 6 choices (owner, 2026-10-13) | 6.2–6.6 | **Decided:** 6.3 reminder jobs on hold. Pause, resume, end early, extend and recall by Doctor/Admin; notes by any staff. Pause also allowed from accepted; resume returns to in treatment if a step is done, else accepted; pause only flags booked visits (nothing cancelled). Extension fee raises the total and is charged at once as "Package extension", not re-spread over instalments, no re-approval. Sensitive end silences the plan's appointment reminders at send time. Dashboard counts wait for D1. |
| Q29 | Money fixes from the 2026-10-24 review (owner) | F.1–F.6 | **Decided:** discount carries a `requestId` (Q17) kept in its history meta; booking, book-all and link refuse a visit dated after `package_expires_on`; ending a plan cancels its future plan-booked visits (after commit, through the same cancel as "Remove visit"), unlinks and re-prices covered normal visits, and leaves started visits alone; a failed cancel is reported, never rolls back the end |
| Q28 | Review type (owner, 2026-10-24) | R.1–R.7 | **Decided:** fixed number of reviews set on the template (plan completes after the last; continuing = a new plan); same fee for every review (the doctor may still edit a step's fee on the plan); billing `per_visit` or `advance_per_visit` only; no package price, instalments or expiry; next review = last review done/booked + gap (the package rule) |

## 11. Build steps

8 core phases (0–7), 48 steps, plus **Phase D**: 6 items that wait on a decision and are built separately.
**One step = one pull request**, small enough to review in one sitting. Phases run in order; steps inside a
phase run in order unless marked *(parallel)*. BE = backend, FE = frontend.

**Review gate after every phase.** Work stops at the end of each phase until the user has reviewed it:
1. `npx eslint` on the changed files, IDE type diagnostics clean;
2. the phase's unit test files, one at a time (never the full suite);
3. the phase's API tests from `TEST_CHECKLIST.md`, run against a running server (Postman MCP when connected, otherwise `curl`), results listed in the hand-over; the phase's screens added to `TEST_LOG.md` (page by page) for the owner's browser pass;
4. a short hand-over: what changed, what was tested and how, what was skipped and why, also added to `CHANGELOG.md`.
The next phase starts only when the user says so.

### Phase 0 — Foundation

| Step | Side | Work | Done when |
|---|---|---|---|
| 0.1 | BE | Write the 8 enums and 11 models (§3). The owner generates and applies the migration | Migration applies on dev; tables exist |
| 0.2 | BE | Module skeleton: `index.ts`, 5 ports, adapters, `initTreatmentPlanPorts()` in `app.ts`, `routes.guard.test.ts`, `target.treatmentPlans` realtime section | Server boots; a missing port throws at boot; guard test passes |
| 0.3 | BE | Settings: GET/PUT `/settings`, defaults created on first read | Admin can read and save clinic settings |
| 0.4 | BE | `APPOINTMENT_TYPE_TREATMENT`; empty `onAppointmentChanged()` called after commit on complete, no-show, cancel, reschedule | Normal appointments work exactly as before |
| 0.5 | FE | "Treatment Plans" nav item in `components/shared/Sidebar.tsx`, empty page with `PageHeader`, `treatmentPlanApi.ts` registered in `apiRoot.ts` *(parallel with 0.2–0.4)* | Page opens from the menu for Admin, Doctor, Receptionist |

### Phase 1 — Templates

| Step | Side | Work | Done when |
|---|---|---|---|
| 1.1 | BE | Create, edit, list Staged templates with steps; edit in place + history row | Template saved; a plan made earlier keeps its old steps and fees |
| 1.2 | BE | Package templates: session count, interval, expiry, package price; validation per type | Both types save; Timeline/Review/Cycle refused |
| 1.3 | BE | Activate (needs "checked by"), deactivate, archive; archive only if used in a plan | Status rules hold |
| 1.4 | BE | `utils/timing.utils.ts` + tests; preview endpoint (sample dates, total, duration) | Root-canal preview (gaps 0, 2, 3, 3, 7) gives 12, 14, 17, 20, 27 Oct |
| 1.5 | BE | Library: Super Admin routes (`superadmin.route.ts`); idempotent seed from `treatmentPlan/seeds/templates/*.json` (insert only when `code` is missing, never overwrite) of the Staged and Package examples from the Plan Types guide, as **draft, fees empty, not checked** (Q11); copy to clinic; doctor's own version; active-templates cache | Seeded rows appear as drafts for Super Admin; a clinic can copy only after Super Admin activates |
| 1.6 | FE | Template list: filter by specialty and status, all four data states | List shows templates with status chips |
| 1.7 | FE | Template builder: basic info, steps or sessions, pricing, keywords, live preview | Doctor builds and activates a template |
| 1.8 | FE | Super Admin library page under `pages/dashboard/superadmin/` (list, create, edit, archive ready-made templates), reusing the 1.7 builder | Super Admin publishes a ready-made template that clinics can copy |
| 1.9 | BE | Specialty configs: Super Admin CRUD, `FieldDef` → Zod validator in `utils/specialtyFields.utils.ts` + tests | A config row validates `specialty_data`; no specialty name in code |
| 1.10 | FE | Super Admin specialty-fields editor + a generic `SpecialtyFields` renderer built on the shared form fields | Adding a test specialty's fields needs no FE code |

### Phase 2 — Create a plan

| Step | Side | Work | Done when |
|---|---|---|---|
| 2.1 | BE | Suggestions: match `report_cards.final_diagnosis` to keywords, filtered by the doctor's specialty | Best match + up to 3 others, each with its matched word |
| 2.2 | BE | Create plan from a template (package → one step per session) or custom; status `proposed`; staff scope on list and detail | Plan and steps saved; a Receptionist sees only assigned doctors' plans |
| 2.3 | BE | Edit a proposed plan: add, remove, reorder steps; gaps, fees, options, dates; option B (shared proposal group); "Save as my template" | Edits saved; A and B linked |
| 2.4 | BE | Safety checks: gap below minimum, discount cap, allergy, duplicate active plan; history rows | Each check blocks or asks for a reason |
| 2.5 | FE | "Suggested plan" card on the consultation screen | Card shows match and reason |
| 2.6 | FE | Select template dialog + create plan screen with estimate; the specialty slot renders `SpecialtyFields` (empty when the specialty has no config); "+ New → Treatment plan" in `HeaderQuickAdd` | Doctor saves a customised proposed plan |

### Phase 3 — Patient decision

| Step | Side | Work | Done when |
|---|---|---|---|
| 3.1 | BE | Accept: payment mode, version 1 snapshot, consent as an uploaded file (e-signature is D4), advance ledger row (one transaction); audit entry for accept; advance carries `requestId`; consent required only when `plans.consent_required`; sets `package_expires_on` for packages | Accepted plan is locked as v1 |
| 3.2 | BE | Think / decline: follow-up date; call log as history rows; accepting option A declines option B | Plan appears in the suggested list |
| 3.3 | BE | Change after accept: new version, needs re-approval when cost or steps change; re-balance unpaid instalments when the total changes | v2 created; v1 untouched |
| 3.4 | FE | Estimate + decision screen (accept, think, decline) | All three decisions work |
| 3.5 | FE | Suggested list tab with call log *(parallel with 3.4)* | Reception can log a call and set the next date |

### Phase 4 — Booking and visits

| Step | Side | Work | Done when |
|---|---|---|---|
| 4.1 | BE | Allowed dates: earliest date (timing utils) + doctor's free slots or tokens via `AppointmentPort`; one slot or one token per step (multi-slot is D2) | Dates before the gap are shown blocked, with reason |
| 4.2 | BE | Book one step through the appointments module; link row; no fee collected at the desk. The appointment-payment handling sits in one function so D1 changes only that | Appointment created with type Treatment |
| 4.3 | BE | Book all remaining steps, each anchored on the previous booking | Whole plan booked in one action |
| 4.4 | BE | Link an existing appointment to a step; unlink; `linkable-appointments` lookup (same patient, same doctor, upcoming, not linked) through `AppointmentPort` | Unlink returns the step to not booked; only the plan doctor's appointments are offered |
| 4.5 | BE | Real `onAppointmentChanged`: no-show → missed, cancel → unlink, reschedule → re-check later steps; realtime signal + count cache cleared after commit; tests | Missed step lands in "Missed – rebook" on open screens without a reload |
| 4.6 | BE | Complete step: notes, mark done | Next step becomes bookable |
| 4.7 | FE | Need-booking list + book-from-slots screen | Reception books a step on an allowed date |
| 4.8 | FE | "Which step is this for?" prompt in today's visit; missed tab; after accept, "Use it for Step N?" for each already-booked appointment with the same doctor | Doctor marks a step done from the visit; an existing booking links in one click |

### Phase 5 — Payments

| Step | Side | Work | Done when |
|---|---|---|---|
| 5.1 | BE | Ledger service + balance in SQL (due now, remaining) + tests; `utils/money.utils.ts` (share-of-total, paise maths) + tests: discount, package, plan change midway, skipped step | Root-canal example matches to the rupee; charges always add up to the agreed total |
| 5.2 | BE | Charge on step done; payment with a receipt (number built from the ledger row, Q15); `requestId` on every payment; repeat returns the first receipt; test: same request twice = one row | Every payment has a receipt |
| 5.3 | BE | Instalments: schedule must sum to total minus advance | Wrong sum refused |
| 5.4 | BE | Refund (Admin, Doctor, Receptionist), write-off and discount (Admin, Doctor), all with reason; audit entries for refund, write-off, discount; same `requestId` rule | Wrong role gets 403 |
| 5.5 | FE | Payments panel on the plan: balance, collect, refund, instalments; on-screen receipt (printable format is D4) | Reception collects and sees the receipt number |

### Phase 6 — Track and close

| Step | Side | Work | Done when |
|---|---|---|---|
| 6.1 | — | Moved to product Phase 2 (outside work tracking, Q14); number kept so later steps keep theirs | — |
| 6.2 | BE | Pause, end early (reason, sensitive flag), complete with recall date; audit entry for end early; status rules (§6.1); resume; pause flags future visits; package expiry + extend with optional fee | Sensitive end stops plan messages |
| 6.3 | BE | Notification events + cron jobs (follow-up, need booking, missed, instalment, recall); package-expiring reminder | Each alert fires once per due item |
| 6.4 | BE | Existing appointment reminders skip plans ended for a sensitive reason | No reminder after a sensitive end |
| 6.5 | FE | Plan detail page: steps, visits, payments, notes, history | All plan data on one page |
| 6.6 | FE | List tabs + dashboard counts; progress column in words and numbers ("3 of 6 sessions", "2 of 5 steps") | Counts match the list |

### Phase 7 — Test and release

| Step | Side | Work | Done when |
|---|---|---|---|
| 7.1 | Both | Run the simulator patients (Staged and Package) on staging | Every scenario ends in the expected state |
| 7.2 | Both | Regression: normal consultations, bookings, payments, dashboards | Nothing outside plans changed |
| 7.3 | FE | UX definition of done: keyboard pass, dark mode, four data states | Checklist passes |
| 7.4 | — | Short guide for doctors and reception | Guide shared with the pilot clinic |

### Phase R — Review type (Q28)

Regular check-ups of a long-term condition (PCOS, diabetes, thyroid). Reuses the package date rule;
screens, booking, missed visits, pause/end and money are unchanged.

| Step | Side | Work | Done when |
|---|---|---|---|
| R.1 | BE | Template schema + service accept `review`: exactly one step (the review's name and fee, repeated N times), `session_count` (number of reviews) and `interval_days` required, priced `per_step`, package price/expiry/instalments refused; preview shows "Review 1…N" and fee × N; model check constraint extended (owner generates the migration) | Review template saves; package-only fields refused with 422 |
| R.2 | BE | Plan create from a review template builds "Review 1…N" with `packageGaps`; each step's fee = the template fee; total = sum of fees | Plan of 4 reviews every 56 days, ₹500 each = ₹2,000 |
| R.3 | BE | Gap safety check uses the review interval; billing modes limited to `per_visit` / `advance_per_visit` on accept (progress wording is FE, R.5) | Wrong billing mode 422 |
| R.4 | FE | Template builder: "Review" type with count, gap (weeks) and fee; template list shows "Review · 4 reviews, every 8 weeks" | Saves and lists |
| R.5 | FE | Plan form and plan page: "Review N" wording, progress in words, only the two payment options on accept | Accept offers two options |
| R.6 | BE | Ready-made library: PCOS, diabetes, thyroid, acne, dental check-up | Library shows them under their specialties |
| R.7 | Both | Tests: template validation + review dates (`__tests__/`); TEST_LOG page for Review | Tests pass; browser page run |

### Phase F — Money fixes (Q29)

| Step | Side | Work | Done when |
|---|---|---|---|
| F.1 | BE | Discount `requestId` (optional for old clients); a repeat on the same plan returns the first result | Retried discount applies once |
| F.2 | FE | Discount form sends its `requestId` | — |
| F.3 | BE | Book, book-all and link refuse a date after `package_expires_on` (422, plain words) | Late session refused |
| F.4 | FE | Book / Book all date pickers stop at the package's last day, with the reason | Picker can't pass it |
| F.5 | BE | End plan: future plan-booked visits cancelled after commit; covered normal visits unlinked and re-priced; started visits kept; failures reported | No ₹0 visit left on an ended plan |
| F.6 | FE | End dialog lists the visits that will be cancelled; result names any that failed | Staff see what happens before confirming |

### Phase D — Decision-dependent (separate)

Work that waits on a decision. None of it blocks Phases 0–7: each core step either doesn't need it or
uses the interim behaviour below. Each D item starts only once its decision is written into this file,
and slots in after the core step it extends.

| # | Waiting on | Interim behaviour in the core build | Work once decided | Extends | Earliest start |
|---|---|---|---|---|---|
| D1 | **Q4** How a treatment visit's appointment payment is recorded (price 0, no row, or other); and whether the consultation fee is charged when step 1 is done in the same visit | No fee collected at the desk; one isolated function decides the payment row | Final payment-row rule; then plan money into dashboards and Payments History via `revenueSql.ts`, with dashboard cache signals | 4.2, 5.x | After 5.1 |
| D2 | **Engine change** for one appointment over several consecutive slots (Q5) | One slot or one token per step; duration shown for information | Multi-slot hold and release in the appointment engine; booking uses duration ÷ slot length | 4.1, 4.2 | After 4.2; estimate first |
| D3 | **Dedicated treatment time** in the doctor timing flow (Q3) | `booking_mode = normal` only; `dedicated` not offered in settings | Treatment hours in the existing doctor availability/session overrides; booking reads them when the clinic chooses `dedicated` | 4.1, 0.3 | After D2 |
| D4 | **Q6/Q7** GST, consent format, estimate/invoice/receipt format, guardian consent | Consent = uploaded file; receipt = number on screen; `taxable` stored but not applied | GST calculation, consecutive receipt/invoice numbers if GST requires them, estimate/invoice/receipt PDFs (through the shared PDF path), e-signature, `consent_by_guardian` | 3.1, 5.2, 5.5 | After the meeting with sir |
| D5 | **Subscription gate** (Q8) | Open to every plan | `useFeatureGate` + `subscriptionAccess` on the module | 0.5 | When decided |
| D6 | **Data privacy** (Final Plan, C): consent rules, who sees what, retention, children's data, security, breach | Access follows staff scope (Q9); nothing is deleted; every action is in `treatment_plan_history`; no patient data in logs | Retention and archive/anonymise job, any access rule beyond staff scope, guardian consent (with D4) | 2.2, 3.1 | After the meeting with sir |

Branches are not a D item; they are a separate feature with their own spec (§9).

Frontend detail (screens, routes, files touched, slice, status wording): `InfinityMedisetuWeb_FE/docs/treatmentPlan/FE_PLAN.md`.
Test checklist (every decision and rule, with expected results): `docs/treatmentPlan/TEST_CHECKLIST.md`.

Tests per standards §12: `__tests__/` in the module, one file at a time, never the full suite.
Highest value: `timing.utils.test.ts` (1.4), `ledger.service.test.ts` (5.1), `onAppointmentChanged.test.ts` (4.5).

## 12. Standards check (BE + FE)

Each rule below is from `BACKEND_STANDARDS.md` or `FRONTEND_STANDARDS.md`, with the step that applies it.

### Backend

| Rule | How this module follows it | Step |
|---|---|---|
| §1 Bounded module | Imported only via `index.ts`; other modules only through ports + adapters; no FKs to other modules' tables | 0.2 |
| §1.8 Separate Super Admin routes | Ready-made library is managed by Super Admin in `routes/v1/superadmin.route.ts`; `routes.guard.test.ts` asserts every route has `requireSuperAdmin` or `requireClinic` | 0.2, 1.5 |
| §1.6 Hooks state their failure mode | `onAppointmentChanged` never throws and is safe to rerun | 0.4, 4.5 |
| §1.7 Cron + seeds through exported, idempotent entry points | `seedTreatmentTemplates`, `runTreatmentPlanAlerts` on the barrel | 1.5, 6.3 |
| §3 Routes thin, 2-line header, `requireRole` after `requireAuth` | Every route; roles as in §4 | all |
| §3 Swagger via `export const apiDocs` | Every route file exports `apiDocs` with relative paths (loadRoutes adds the prefix), `requestSchema`/`query`/`params` and a `responseSchema` of the full envelope; never `docsRegistry.addEndpoint` with a hand-typed path | all |
| §3 API design | Check existing endpoints first; list + tab counts in one call; detail = one aggregate | 2.x, 6.5 |
| §3 Response changes are additive | Appointment responses gain an optional `treatmentStep` field only | 4.8 |
| §4 Services | No `req`/`res` in services; files under ~800 lines; split by sub-domain folder | all |
| §5 Zod on every input, types from `z.infer` | `schemas/` per route file | all |
| §6 Envelopes + `HttpError`; other clinic's record = 404 | Every controller | all |
| §7 Migrations by the owner | Models only; owner generates | 0.1 |
| §7 Multi-step writes in one transaction, no side effects inside | Accept, book-all, step done + charge, refund | 3.1, 4.3, 4.6, 5.x |
| §7 Lists paginate | Plans list, templates, ledger, history | all lists |
| §7 jsonb keys typed with `$type` | options, specialty_data, snapshot, meta | 0.1 |
| §7 File columns store the S3 key | `consent_file_url`; ownership check before upload middleware | 3.1 |
| §7 Search endpoints | Template search: contains-only, ranked in SQL, `%`/`_` escaped, page 25, trigram index on `name` | 1.1 |
| §7 Money figures | Ledger totals in SQL; dashboard integration uses the `revenueSql.ts` fragments; IST days | 5.1, D1 |
| §7 Token vs slot | Booking reads `tokenNo` per appointment, never the `23:59` placeholder | 4.1 |
| §8 Caching | See "Caching" below | 1.1, 2.x, D1 |
| §9 Tenancy from the token | Every query filters by `req.clinicId` | all |
| §9 Staff scope | Admin → clinic; Doctor → own plans; Receptionist → assigned doctors' plans, via `StaffScopeService` (decided, Q9) | 2.2 |
| §9 Appointment routes | Link/book go through the appointments module, which applies `requireAppointmentScope` | 4.2, 4.4 |
| §10 Realtime | New section `target.treatmentPlans(clinicId)`; signal after commit on every plan write | 4.5 |
| §10 Notifications through `notify()` only; cron idempotent | Alerts | 6.3 |
| §11 No patient data in logs or errors | All services | all |
| §12 Tests in `__tests__/`, one file at a time | timing, ledger, hook, routes guard | 1.4, 4.5, 5.1 |

### Caching (BE §8)

| What | Key (`CacheKeys`) | TTL | Invalidated by |
|---|---|---|---|
| Active templates for a clinic (read on every consultation) | `treatmentTemplatesActive(clinicId)` | 10 min | any template create, edit, activate, archive, copy |
| Plan list tab counts | `treatmentPlanCounts(clinicId)` | 60 s | any plan, step, link or ledger write |
| Existing dashboard caches | `dashboardCacheVersion` | — | `signalAppointmentChange` after every ledger write (once D1 ships) |

Not cached: plan detail, suggestions, allowed dates. They change on every booking and must be current.
Invalidate after commit, in the function that owns the transaction; cache errors never fail the write.

### Frontend

| Rule | How this module follows it | Step |
|---|---|---|
| §1 Folder names match the BE module | `pages/treatmentPlan/` with `components/`, `hooks/`, `helpers/` | 0.5 |
| §2 No generic names outside `shared/` | `TreatmentPlanStatusChip`, not `StatusChip` | all |
| §4 Types in `src/types/treatmentPlan/` | Barrel `index.ts`; nothing inline in `treatmentPlanApi.ts` | 0.5 |
| §6 One slice, registered in `apiRoot.ts`, on `baseQueryWithAutoLogout` | `treatmentPlanApi.ts` | 0.5 |
| §6 API calls | One call per screen purpose; list returns tab counts; detail is one aggregate; `skipToken` for closed tabs and modals; no polling | all |
| §6 Live refresh | `useSectionSync` on the plans section; `refetchOnMountOrArgChange` | 4.7, 6.6 |
| §6 Predictive search | Template search debounced 250 ms, skipped under 2 characters | 1.6, 2.6 |
| §10 Primitives | `PageContainer`/`PageHeader`, `PageBackNav`, `AppButton`, `AppModal`, `StatusChip`, `StateCard`, `SectionCard`, HeroUI `Select`/`Autocomplete`, form fields | all |
| §10 Tables | HeroUI `Table` in a tokened shell (`CommonTable` breaks in dark mode); whole row clickable; scrolls inside the card | 1.6, 4.7, 6.6 |
| §10 Filter bars | One row, actions pinned right | 6.6 |
| §10 Token vs slot | "Token #N" or slot time, via `hasSlotTime` | 4.7 |
| §11 Forms | react-hook-form + Zod in `src/schemas/treatmentPlan.ts`; errors say how to fix | 1.7, 2.6, 3.4 |
| §13 Accessibility | Four data states, keyboard pass, labels, `aria-live` for socket updates, destructive actions confirm in `AppModal tone="danger"` | all FE, 7.3 |
| Root `CLAUDE.md` UX §3 | End early, write-off and refund are demoted, never primary buttons | 5.5, 6.5 |

## 13. Not in Phase 1

Timeline, Review and Cycle behaviour · tooth chart and other specialty slots · outside work (lab, scan) tracking and alerts · follow-on
plans · patients already mid-treatment · patient-app screens · branches · subscription-plan gating.
