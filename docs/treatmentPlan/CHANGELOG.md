# Treatment Plan — change log per phase

What each phase changed, in both repos, in plain words. One section per phase, added at its review gate.
Plan: `DEV_PLAN.md` (backend) · `Medi_Arogya_FE/docs/treatmentPlan/FE_PLAN.md` (frontend).

---

## Phase 0 — Foundation (2026-10-12)

### Step 0.1 — Database models (BE)

New folder `src/main/treatmentPlan/`. Migration generated and applied by the owner.

| File | What it holds |
|---|---|
| `models/treatmentEnums.model.ts` | 8 enums: plan type, template status, plan status, step status, pricing mode, billing mode, ledger entry, booking mode |
| `models/treatmentTemplate.model.ts` | `treatment_templates`, `treatment_template_steps` |
| `models/treatmentPlan.model.ts` | `treatment_plans`, `treatment_plan_versions`, `treatment_plan_steps`, `treatment_step_appointments` |
| `models/treatmentLedger.model.ts` | `treatment_instalments`, `treatment_ledger` |
| `models/treatmentPlanHistory.model.ts` | `treatment_plan_history` |
| `models/treatmentPlanSettings.model.ts` | `treatment_plan_settings`, `treatment_specialty_configs` |
| `types/plan.types.ts`, `specialty.types.ts`, `history.types.ts` | shapes of the jsonb columns (step options, snapshot, specialty fields, history `meta`) |

Small differences from DEV_PLAN §3:
- Index on `treatment_plans.proposal_group_id` (accept locks the option group).
- Unique `(plan_id, seq)` on instalments.
- Check `discount <= total + discount` dropped: it only says `total >= 0`, already checked.
- `history.clinic_id` and `actor_id` nullable: a library template edit has no clinic, a system event has no user.
- Specialty configs: two partial unique indexes (platform rows and clinic rows).
- Settings defaults: all 4 billing modes, invoice `per_step`, discount cap 10%.

### Step 0.2 — Module skeleton (BE)

| File | Change |
|---|---|
| `treatmentPlan/index.ts` | the module's only public entry: `onAppointmentChanged()` |
| `treatmentPlan/__tests__/routes.guard.test.ts` | every clinic route needs login + role + clinic from the token |
| `realtime/utils/sections.ts` | new signal `target.treatmentPlans(clinicId)` → clinic room. Nothing sends it yet (from Phase 2) |

Not done (deviation): no ports yet. Nothing in Phase 0 calls another module, so each port is added in the step that first needs it.

### Step 0.3 — Clinic settings API (BE)

| Route | Who | What |
|---|---|---|
| `GET /api/v1/treatment-plan/settings` | Admin, Doctor, Receptionist | read; the row is created on first read |
| `PUT /api/v1/treatment-plan/settings` | Admin | save one or more settings; `dedicated` booking refused until D3 |

Files: `routes/v1/settings.route.ts`, `controllers/settings.controller.ts`, `services/settings.service.ts`, `schemas/settings.schema.ts`.
Queries: GET = 1 query once the row exists (insert only on the very first read); PUT = 1 upsert. Both return only
the 8 settings (no id, clinicId or timestamps); shape in `types/settings.types.ts`.
Swagger: the route exports `apiDocs` (relative paths, request + response schema), the playbook pattern; changed after review from a hand-typed `docsRegistry.addEndpoint` path.

### Step 0.4 — Appointment link (BE)

| File | Change |
|---|---|
| `appointments/utils/appointmentType.constants.ts` | `APPOINTMENT_TYPE_TREATMENT = 'Treatment'` |
| `realtime/utils/signalAppointmentChange.ts` | after an appointment is completed / no-show / missed / cancelled / rescheduled, calls `treatmentPlan.onAppointmentChanged()`. Errors are logged, never thrown |
| `treatmentPlan/types/appointmentSync.types.ts` | the event shape `{ appointmentId, clinicId, kind, date }` |

Deviation: one call in the shared after-commit function, not one per appointment path; every path already calls it.
Phase 0 behaviour: the hook only writes a debug log. Phase 4 adds the plan effects.

### Step 0.5 — Menu, page, API slice (FE)

| File | Change |
|---|---|
| `components/shared/Sidebar.tsx` | "Treatment Plans" menu item (Admin, Doctor, Receptionist) |
| `routes/routes.ts` | `/treatment-plans` route, same roles |
| `pages/treatmentPlan/TreatmentPlanList.tsx` | page with header + empty state |
| `redux/api/treatmentPlanApi.ts` | slice with settings get/update |
| `redux/api/apiRoot.ts` | slice registered |
| `types/treatmentPlan/api.ts`, `index.ts` | settings types |

Not in Phase 0: FE live refresh (`sectionIds.treatmentPlans`, FE step 4.5); the clinic settings form (no step yet).

### Review gate

| Check | Result |
|---|---|
| ESLint on changed files (BE + FE) | clean |
| IDE type diagnostics | no errors |
| `routes.guard.test.ts` | not run (no Jest on this machine); owner to run |
| API with a login | pending: needs an Admin token |
| Browser check | pending: owner |

---

## Phase 1 — Templates (2026-10-12)

**Owner action:** `treatment_templates.created_by` is now nullable (seeded library rows have no creator).
Generate and apply the dev migration, then run `npm run db:seed:dev` to add the 10 ready-made drafts.

### Backend

| Step | Files | What it does |
|---|---|---|
| 1.1–1.3 | `services/templates/templateWrite.service.ts`, `templateQuery.service.ts`, `controllers/template.controller.ts`, `routes/v1/templates.route.ts`, `schemas/template.schema.ts` | create, edit in place (history row `template_edit` with `changedFields`; no row for a no-op save), check, activate / deactivate / archive, copy, list with ranked search, detail |
| 1.2 | `schemas/template.schema.ts` | per-type rules: Staged needs steps, Package needs sessions + interval and no steps; Timeline/Review/Cycle refused |
| 1.4 | `utils/timing.utils.ts`, `utils/templatePreview.utils.ts`, `utils/money.utils.ts` + 2 test files | date maths on IST days, preview (dates, total in paise, length), `POST /templates/preview` |
| 1.5 | `seeds/libraryTemplates.json`, `services/templates/librarySeed.service.ts`, `drizzle/seeds/treatmentPlan.seed.ts`, `routes/v1/superadmin.route.ts` | 5 Staged + 5 Package examples from the Plan Types guide as unchecked drafts with no fees; insert only when the code is missing; Super Admin library routes; clinic copy; doctor's own version |
| 1.5 | `ports/`, `src/adapters/treatmentPlan/`, `app.ts` | first port: `DoctorPort.getSpecialties` (main speciality + specializations) |
| 1.5 | `utils/cache.util.ts` | `CacheKeys.treatmentTemplatesActive(clinicId)`, 10 min; cleared after every clinic template write (create, edit, check, status, copy) |
| 1.9 | `services/specialtyConfig.service.ts`, `schemas/specialtyConfig.schema.ts`, `utils/specialtyFields.utils.ts` + test, `routes/v1/specialtyConfigs.route.ts` | Super Admin field sets per specialty; `GET /specialty-configs/:specialty` (clinic row first, else platform; null = none) |
| all | `services/history.service.ts`, `schemas/response.schema.ts`, `__tests__/routes.guard.test.ts` | typed history writer; Swagger response shapes; guard test covers all 4 route files |

Decisions taken while building (say if any should change):
- **Template specialty = a catalog main speciality** (`specialtyCatalog.ts`, e.g. "Dentist"). A doctor matches on their main speciality **or** any specialization (Q1 said the list only; a dentist with no sub-specializations would otherwise see nothing).
- **`GET /templates/available`** is a separate endpoint (doctor rule + cache); `GET /templates` is the management list.
- **Check is its own action** (`POST /:id/check`, Doctor; Super Admin for the library). Activate needs it plus every price set.
- **No delete endpoint.** Archive is final and keeps plans' history intact (T8: delete is refused because it doesn't exist).
- **Copies start as unchecked drafts**, so the clinic sets and checks its own fees.
- **Editing does not clear "checked".** Open question for you: should a change to steps or fees need a fresh check?
- Seed: one file `seeds/libraryTemplates.json` (static import, so `tsc` copies it into `dist/`).

### Frontend

| Step | Files | What it does |
|---|---|---|
| 1.6 | `components/treatmentPlan/templates/TemplateListView.tsx`, `TemplateTable.tsx`, `pages/treatmentPlan/templates/TemplateList.tsx` | list with search (250 ms, ≥2 chars), status / speciality / "my versions" filters, four states, pagination |
| 1.6 | `LibraryCopyModal.tsx` | "Copy ready-made" dialog |
| 1.7 | `TemplateBuilder.tsx`, `TemplateStepsEditor.tsx`, `TemplatePreviewCard.tsx`, `TemplateActionsBar.tsx`, `pages/treatmentPlan/templates/TemplateBuilderPage.tsx` | builder: about, steps or sessions, pricing; live sample schedule; check / activate / deactivate / archive (confirm); "Save as my version" |
| 1.8 | `pages/dashboard/superadmin/treatmentPlan/LibraryPage.tsx`, `LibraryTemplatePage.tsx`, `superAdminNav.tsx` | Super Admin library reuses the same list and builder (`scope="library"`) |
| 1.10 | `components/treatmentPlan/SpecialtyFields.tsx`, `helpers/specialtyFields.ts`, `pages/dashboard/superadmin/treatmentPlan/SpecialtyFieldsPage.tsx`, `components/SpecialtyConfigModal.tsx`, `FieldDefsEditor.tsx` | field-set editor with a live preview built from the definitions |
| 1.11 | `pages/treatmentPlan/TreatmentPlanSettings.tsx`, `constants/settingsNav.tsx`, `types/profile/profile.ts` | Settings → Treatment Plans (Admin only) |
| — | `redux/api/treatmentPlanApi.ts`, `types/treatmentPlan/*`, `schemas/treatmentPlan.ts`, `helpers/treatmentPlanFormatters.ts`, `routes/routes.ts`, `TreatmentPlanList.tsx` | slice (clinic and library share endpoints by `scope`), types, form schemas, labels; routes; "Templates" button for Admin/Doctor |

### Review gate

| Check | Result |
|---|---|
| ESLint (BE + FE changed files) | clean, no warnings |
| IDE type diagnostics | no errors in analysed files; some new FE components not yet analysed by the IDE |
| Unit tests (`timing.utils`, `templatePreview.utils`, `specialtyFields.utils`, `routes.guard`) | not run with Jest (machine rule); the same cases were run as scripts against the code: all pass |
| Service checks on the dev DB (throwaway clinic, cleaned up) | 39 checks pass: T1–T7, T10–T12, V1, V3, V4, L4–L8, S1–S3, archive rules. One bug found and fixed (step count/total subquery bound to the wrong table) |
| Routes mounted on the running server | all 6 groups answer 401 without a login |
| API with a login, seed (L1–L3), browser check | pending: migration + token + owner's browser pass |

**Review fixes (after the owner's first browser pass)**
- Toasts follow the module pattern: the title names the record ("Teeth whitening published"), the description says what it means.
- One action group in the page header (`TemplateHeaderActions`): Save changes while there are edits, otherwise the one next step (Mark as checked → Activate/Publish → Deactivate/Unpublish); status chip beside the title and a plain status line under it. "Save as my version" and Archive (with confirm) sit in the ⋯ menu, as on the Super Admin clinic header. The separate status and archive cards are gone; checkbox labels are 14px.
- Fields use `radius="lg"` like the rest of the app; the speciality picker uses the normal size; buttons use 14px labels (`BUTTON` / `PRIMARY_BUTTON` in the formatters).
- Preview totals use the section-heading size; a missing fee reads "Fees not set yet" in muted text.
- No extra GET after a save or status change: each write's response becomes the cached detail; only the list is refetched.
- Publish/Activate shows once checked; pressed with a price missing, it marks every empty fee (or the package price) in red and puts the cursor in the first one, with no API call. Server messages are neutral ("Enter a fee for every step first").
- Dark mode: text fields use tokens (`FIELD_CLASSES`: `bg-surface`, `border-border-color`, 14px) so they match the dropdowns; the shared fields' hard-coded navy fill is logged in FRONTEND_STANDARDS §17 for an app-wide fix. Colour greps from FE_PLAN §8 run clean on all treatment-plan files.
- Responsive pass (FE §9): list header actions go icon-only below `sm` (no wrap or scroll at 320px); the steps grid stays 2 columns until `2xl`, because from `xl` the 340px preview rail takes room; filters carry `sm:shrink-0`. Still to verify in a browser at 320×568, 1024×768, 1280×720 and 1366×768.
- **Decision (owner, 2026-10-12): ready-made templates publish without fees.** Library fees are suggestions; Super Admin publishes after "Mark as checked". A clinic copy still needs every fee (or the package price) before Activate (`assertActivatable` skips the price check only when `clinic_id` is null). Verified on the dev DB.
- Speciality is one shared control: `components/shared/SpecialityField` (form) and `SpecialityFilter` (searchable toolbar filter), both on the existing `hooks/useMainSpecialties` that onboarding, referral, banners and Add User use. The template list puts Status first, then Speciality, then search.
- **Decision (owner, 2026-10-12): a clinic Admin can mark a template as checked and activate it**, not only a Doctor (a clinic's admin may not be a doctor). `POST /templates/:id/check` is Admin, Doctor; `checked_by`/`checked_at` still record who and when. Verified on the dev DB: Admin checks → refused until priced → activates.
- Builder actions moved to the foot of the page, like Reschedule: on `xl`+ the main button and "Cancel / Back to templates" sit at the bottom of the Sample schedule card; below `xl` the same pair rides a bar pinned to the bottom. The header keeps only the ⋯ menu (Save as my version, Archive). Saving or archiving returns to the list.
- Typing a fee clears its "Enter a fee to go live" message at once; the preview no longer dims while it refreshes and shows a running total ("₹2,500 · so far · 1 price still empty"). `POST …/preview` gains `feesMissing`; `totalAmount` is the sum of the prices entered so far (additive change; test updated).
- Alignment: "Plan type", "How it is priced", "When the invoice is made" and the field "Type" are radio tiles on their own row (`ChoiceField`), so no row mixes a `SelectField` (label overlaid) with text fields (label above). Logged in FRONTEND_STANDARDS §17.
- Step card: number badge + name + move/remove on one row (bottom-aligned); details grid has as many columns as fields (3, or 4 with a fee) so no empty slot; short labels with units inside the box (days, min, ₹); no browser spinner arrows (`NUMBER_FIELD_CLASSES`); shorter hints.
- Input limits: every text box stops at its schema limit (`maxLength`: names 150, category 100, code 64, keywords 1000, fees 13, labels 80, keys 40, units 20) and number boxes carry `max` (gap 365, latest gap 730, duration 600, sessions 100, interval 365, validity 1825, recall 3650, reminders 60). The form mirrors every server rule so errors show on the field: keywords ≤ 30 and ≤ 60 characters each; choices ≤ 50, ≤ 80 characters, no repeats. New rule on both sides: a package must be valid for at least (sessions − 1) × interval days. Checked by running the form schema; seed data still passes.
- Activate / Publish / Deactivate / Unpublish now return to the list (as Save and Archive do); Mark as checked stays, since Activate is the next step on the same page. Button weights: main action solid teal; Deactivate/Unpublish neutral outline; Cancel/Back to templates text-only.
- `TEST_LOG.md` added: page-by-page browser test record (Phase 0 + 1 screens, access, every-screen checks, unit tests, failures table); linked from the DEV_PLAN review gate.
- Query review: every template write builds its response from the rows it just wrote (`RETURNING`) via `TemplateQueryService.toDetail`, instead of re-reading the template (2–3 queries saved per save/check/status/copy). Create and copy need no read after commit; check/status read only the steps. Verified on the dev DB: each write's response equals a fresh read (12 checks).
- Commit-hook fixes: BE `templatePreview.utils.ts` used `Array.at()` (ES2022; BE targets ES2020) → index access. FE `treatmentPlanApi.ts` typed its cache helper with `typeof treatmentPlanApi`, a circular type that made the whole slice `any` (10 knock-on errors) → explicit types; unused React import removed. FE `tsc -b` run once with the owner's approval: 0 errors (1m32s).

---

## Phase 2 — Create a plan (2026-10-12)

**Owner action:** migration for `treatment_plans.package_expiry_days` (done).

Decisions (owner, 2026-10-12): allergies are a reminder on screen, never a block · package validity is copied onto the plan (new column) · suggestions read the diagnosis as typed (final, else provisional) · safety checks ask for a reason, then save.

### Backend

| Step | Files | What it does |
|---|---|---|
| 2.1 | `utils/suggestions.utils.ts`, `services/plans/planQuery.service.ts` | `GET /suggestions?diagnosis=`: whole-word keyword match over the doctor's available templates; most specific keyword first, own version first on a tie, up to 4, each with the matched word |
| 2.2 | `services/plans/planWrite.service.ts`, `controllers/plan.controller.ts`, `routes/v1/treatmentPlan.route.ts`, `schemas/plan.schema.ts` | `POST /` (Doctor): proposed plan for a patient of the clinic (`clinic_assign`), from an active template or custom; consultation must be the same patient; totals in paise. `GET /`, `GET /:planId` with staff scope (Admin: clinic · Doctor: own · Receptionist: assigned doctors) |
| 2.2 | `GET /patients/:patientId` | name + recorded allergies for the create screen (own endpoint, not the patient module's) |
| 2.3 | same | `PUT /:planId`: full edit of the doctor's own proposed plan; steps replaced (reorder can't hit the unique seq); 409 when `updatedAt` is stale. `POST /:planId/options`: copy as B/C in the same group (first becomes A; max 3). `POST /:planId/save-as-template`: the doctor's own draft template linked to the source |
| 2.4 | `utils/planRules.utils.ts` | gap below the template minimum (by step name; package: interval), discount above the clinic cap, same treatment already open → 422 `REASON_REQUIRED` with the issues; resubmitted reasons go to step `gap_override_reason` and history (`gap_override`, `discount_approved`, `duplicate_override`) |
| — | `ports/` + `src/adapters/treatmentPlan/` | new ports: Patient (clinic check, names, allergies), Appointment (read only), StaffScope (`StaffScopeService`) |
| — | `models/treatmentPlan.model.ts`, `types/history.types.ts` | `package_expiry_days`; history actions `plan_edit`, `option_added`, `duplicate_override`; `gap_override` meta also carries `minGapDays`/`gapDays` |

Also fixed: route files mount in no fixed order, so `/:planId` could have caught `/treatment-plan/settings`; the plan router leaves non-uuid ids to the next router (`router.param` → `next('router')`). Logged in WORKFLOW §6.

### Frontend

| Step | Files | What it does |
|---|---|---|
| 2.5 | `components/treatmentPlan/SuggestedPlanCard.tsx`, `components/PrescriptionWorkspace.tsx` | under the Diagnosis box: best match + matched word, "Also" links; **Create plan** opens a new tab so the consultation stays open; the diagnosis is handed over in localStorage, never the URL |
| 2.6 | `pages/treatmentPlan/PlanEditorPage.tsx`, `components/treatmentPlan/plans/*` | `/treatment-plans/new` (Doctor): template picker (or custom) → patient (search if not given), title, diagnosis, steps (options, specialty step fields), price/discount/consent/validity, plan specialty fields; Estimate card with dates, price, discount, total and **allergies on file**; reason dialog on 422; then `/treatment-plans/:planId/edit` with A/B switcher and ⋯ (Add another option, Save as my template) |
| 2.6 | `components/shared/Header.tsx`, `routes/routes.ts` | "+ New → Treatment plan" for doctors; routes behind a Doctor guard |
| — | `redux/api/treatmentPlanApi.ts`, `types/treatmentPlan/*`, `schemas/treatmentPlan.ts`, `helpers/planForm.ts` | plan endpoints, types, form schema, template → plan and plan → form mapping |

### Review gate

| Check | Result |
|---|---|
| ESLint (BE + FE changed files) | clean |
| Type check (BE `npm run typecheck`, FE `tsc -b`, owner-approved) | 0 errors both |
| Pure rules (suggestions, totals, safety) | 11/11 pass (`planRules.utils.test.ts` holds the same cases for Jest) |
| Service checks on the dev DB (real clinic patient, cleaned up) | 23/23: P1, P2, P4–P10, V5, X1–X3, non-proposed edit 409 |
| Routes on the running server | all answer 401 without a login; `/settings` and `/templates` unaffected |
| Browser pass | owner (TEST_LOG Pages 7–9) |
- Fix (owner's browser pass): the suggestion card sat only under the "collapse" layout's Diagnosis field; the drawer layout (the one in use) shows it under the clinical context bar, reading the diagnosis chips (`provisionalDiagnosis`). An Admin with doctor access (e.g. a clinic owner who treats) now reaches the create screen and the "+ New → Treatment plan" entry, as the API already allowed (`allowAdminDoctorAccess`).
- Change (owner's browser pass): plan creation moved from a new tab to a dialog on the same screen: "Select treatment template" (search, groups, preview) → Customise (one panel: steps with visit dates, pricing switch, discount, consent; total pinned at the bottom). Opened from Clinical details → Diagnosis (the drawer stays open beneath it), from Treatment plans → New plan, and from + New. Edit keeps its own page, same panel. Dates and total are worked out in the browser (no preview call); number and money boxes block wrong input as you type.
- Add: Treatment plans lists the plans (patient, plan, status "Suggested", progress, total, date) with search (patient name, mobile or plan title), status filter and sort by Total / Suggested on; Templates button kept in the header; "Open plan" in the success toast. BE: `GET /treatment-plan` takes `q`, `sortBy`, `sortOrder`; the patient port gains `searchIds` (first 200 matches). Not run: lint, type check, Jest (owner).

## Phase 3 — Patient decision (2026-10-12)

What the clinic can do now: record the patient's answer to a suggested plan (accept, think, decline), log follow-up calls, and change an accepted plan as a new version the patient approves.

### Backend
- `POST /:planId/decision` — accept (payment way from clinic settings, optional advance + Cash/UPI/Card, consent file as multipart `consentFile` when the plan needs it), think (call-back date) or decline (reason, optional try-again date). Accept is one transaction: plan → accepted, version 1 snapshot, advance ledger row, other options declined, history rows. A repeated `requestId` returns the first result, never a second advance.
- `POST /:planId/followups` — call outcome, note, next call date (suggested or declined plans).
- `POST /:planId/approve-change` — the patient agreed to a changed accepted plan.
- `GET /:planId/consent-file` — 5-minute link to the consent form (new `FilePort` + adapter over the files module's signer).
- `PUT /:planId` now also edits an accepted plan: a real change saves version N+1; price/discount/steps changes need the patient's approval; a total below the advance paid is refused.
- Plan detail adds `version`, `advance` (with receipt `TP-2026-XXXXXX`), `calls`, `hasConsentFile`, billing and dates; the list adds `followUpDate`. Version/advance reads are skipped while a plan is still suggested.
- History: `version_approved`; `version_created` carries the version number. Audit: one line, "Recorded treatment plan decision".
- Instalments are refused until Phase 5.

### Frontend
- New staff plan page `/treatment-plans/:planId` (all staff): status, options, patient's answer buttons (Accept · Will think about it · Decline), accepted summary (payment way, advance + receipt, package validity, version, "View consent form"), declined reason, steps with total, call log with "Log a call", and a "Waiting for the patient's approval" banner with "Patient approved".
- One answer dialog for Accept / Think / Decline / Log a call; decline uses the danger style; consent upload checks type and 10 MB before sending.
- List rows (and the "Open plan" toast) open the plan page for everyone; new "Next call" column. Edit page: accepted plans editable with the version note; back goes to the plan page.
- Plan writes now put the response straight into the cache (no second GET); accepting drops the other options' cached details.

### Review gate
| Check | Result |
|---|---|
| Service checks on the dev DB (throwaway plans, cleaned up) | 21/21 pass: think, call log, past date 422, instalments 422, advance > total 422, accept v1 + receipt, same requestId = one advance, decline/call after accept 409, edit after accept → v2 waiting, total below advance 422, approve + approve again 409, option B accept declines A, consent required 422, no-file link 404, decline with try-again date, call on declined, list followUpDate |
| New routes on the running server | 401 without login (4/4) |
| IDE diagnostics on changed files | none reported (may not cover unopened files) |
| Lint, type check, Jest | not run (owner's instruction); commit hook runs the build |
| Browser pass | owner (TEST_LOG Page 11) |
- Fix (review): no orphan consent files. The upload guard now refuses a plan that can take no answer before uploading (accepted still passes, so a retried accept gets its first result), and a failed or repeated accept deletes its upload through `FilePort.deleteDocument` (a failed delete is logged, never thrown). Dev-DB check with a fake file store: 12/12; Phase 3 checks re-run: 21/21.

## Phase 4 — Booking and visits (2026-10-12)

What the clinic can do now: book accepted plans' steps as real "Treatment" appointments (one by one or all at once), reuse a visit the patient already has, see missed / cancelled / moved visits update the plan by themselves, and the doctor marks steps done from the plan or the consultation.

### Backend
- Timing rule (§5) as a pure function `earliestDates` in `utils/timing.utils.ts` + tests: step 1 from the accept day; each next step from the previous step's done or booked day; a missed unbooked step blocks the rest; a skipped one doesn't. Stored in `treatment_plan_steps.earliest_date` after every change.
- `GET /:planId/steps/:stepId/booking-options?date=`, `POST …/book`, `GET|POST /:planId/book-all`, `GET /:planId/linkable-appointments`, `POST …/link`, `POST …/unlink`, `POST …/complete` (plan's Doctor), `GET /appointments/:appointmentId/steps`. List: `stage=needs_booking|missed`.
- Booking goes through the appointments module's own `createAppointment` (same validation, notifications, queue) via `AppointmentPort.bookTreatmentVisit`: type "Treatment", payment "Not Required", price 0. **Outside the module:** `createAppointment` gains an internal `options.treatment` flag (never read from a request), so the type is "Treatment" instead of the forced "Consultation".
- Early booking: Receptionist 403; Doctor/Admin need a reason (`gap_override` history, `gap_override_reason` on the step).
- `onAppointmentChanged` is real: no-show → step missed + unlinked; cancelled → step back to not booked; moved → dates re-checked (`needsRebooking` when a booked visit is now before its earliest day); completed → nothing (the doctor marks done). Never throws; logs.
- Mark done: first done step → plan in treatment; last → completed. Accept now stores step 1's earliest day, so the plan joins "Needs booking".
- Plan detail steps carry `booking` (date, time/token, status), `needsRebooking`, `doneAt`.
- The adapter loads the booking services lazily: their import chain reaches `app.ts`, which registers the adapter.
- Editing an accepted plan is refused while a step has a live visit (steps are replaced on save).

### Frontend
- Plan page steps card: visit column (booked day + time/token, "From …", "After step N is booked", "Missed, rebook", "Too early now; rebook"), Book / Rebook / Unlink / Mark done per step, "Book all remaining", and "The patient already has a visit — Use it for step N".
- Dialogs: Book step (day from the earliest day; earlier with a reason for Doctor/Admin; free times or token sessions from the real schedule), Book all (preview table, then confirm), Mark done (notes).
- Consultation (Clinical details → Diagnosis): "This visit: <plan> · Step N" with Mark done for the plan's doctor; its dialog is owned by the workspace so the drawer stays open beneath.
- Treatment plans list: "Needs booking" and "Missed visits" in the filter; list and plan page refresh on the existing `board` realtime signal.

### Review gate
| Check | Result |
|---|---|
| Service checks on the dev DB (fake appointment store: no real bookings or messages; throwaway plan cleaned up) | 29/29: book before accept 409, step 1 earliest on accept, Needs booking list, step 2 before step 1 409, options, booking chains dates, past 422, early: Receptionist 403 / no reason 422 / reason ok, double book 409, unlink, book-all preview chained + confirm, edit with booked steps 409, This visit lookup, no-show → missed + Missed list, cancel → not booked, unknown appointment ignored, linkable + link + bad link 422, other doctor 404, done → in treatment, done twice 409, last done → completed, completed plan 409 |
| Real slot lookup (read-only) | answers for the dev doctor (token mode) |
| Earlier phases re-run | Phase 3 21/21, consent files 12/12 |
| Unit tests added | `timing.utils.test.ts` (earliestDates, 5 cases) — owner runs Jest |
| IDE diagnostics | none new (may not cover unopened files) |
| Lint, type check, Jest | not run (owner's instruction); commit hook runs the build |
| Real booking end to end (creates an appointment, sends its messages) | owner, TEST_LOG Page 12 |
- Fix (owner's browser pass): a plan accepted before Phase 4 had no stored step-1 day, so it was missing from "Needs booking" and showed no Book button. The plan detail now works out every step's earliest day on read (same §5 rule) instead of trusting the stored column, and the list treats step 1 of an accepted plan as bookable. Checked on the owner's real plan (stored day empty → now 12 Oct, on Needs booking); Phase 4 checks 29/29.
- Change (owner's browser pass): "Book all" rows are now editable — a day picker and a time / token-session choice per step, pre-filled with the suggestion. Each row's earliest day follows the gap after the row above; a row moved too early turns red and blocks booking. New `GET /:planId/booking-options?date=` (the plan doctor's free times on any day, so a later visit can be moved before earlier ones are booked); the preview now carries each step's `gapDays` and `earliestDate`. Checked on the owner's plan (token session returned; preview 3:19 Oct min 17 Oct); Phase 4 checks 29/29.
- Fix (owner's browser pass): after earlier steps were unlinked, later steps kept their visits with no warning, and "Mark done" showed on every step. Now a booked step whose earlier step lost its visit is flagged (`needsRebooking`: "Step N has no visit now; check this booking"), unlinking warns when later steps still have visits, and "Mark done" shows only on the next unfinished step. Checked on the owner's plan (step 4 flagged); Phase 4 checks 29/29. Investigated and not a bug: the linked consultation visit was auto-marked No-show after step 1 had been unlinked, so the plan correctly ignored it.
- Change (owner, Q26): a step is done only when its appointment is completed. `onAppointmentChanged('completed')` now marks the linked step done (idempotent) and moves the plan to in treatment / completed; the manual `POST …/steps/:stepId/complete` route, its dialog and every "Mark done" button are removed. The consultation card says "Done when you complete this consultation". Phase 4 checks 29/29 (done now driven by completed visits).
- Change (owner): plan page redesigned as a next-step timeline (summary strip, one "Next" action, step dots, existing visits offered only on the step they fit and on or after its earliest day); Appointments list shows a Treatment badge and "Paid through the plan".

## Phase 5 — Payments (2026-10-13)

What the clinic can do now: each completed visit charges its share of the agreed total; reception collects payments with a receipt; instalment plans; refunds, write-offs and later discounts with reasons.

### Backend
- `stepChargePaise` / `planBalance` in `utils/money.utils.ts` + `money.utils.test.ts`: a step's share of what is left of the total, rounded down; the last step takes the rest, so charges add up to the total exactly (₹11,000 of fees at ₹10,000 → ₹1,818.18, …, exactly ₹10,000).
- `PlanLedgerService`: charge on visit completed (inside the same transaction; one charge per step), `POST /:planId/payments`, `/refunds`, `/write-offs` (Admin, Doctor), `/discount` (Admin, Doctor). Every money action carries a `requestId`; a repeat returns the first result. Refund ≤ paid; write-off ≤ due; discount ≤ still to come.
- Instalments: "Package in instalments" turned on. Accept takes the schedule; it must add up to total − advance and be in date order. Payments (less refunds) cover instalments in order; a discount shrinks unpaid instalments from the last one.
- Plan detail: `money` {charged, paid, due, toCome, writtenOff, refunded, entries with receipts, instalments}.
- Audit: refund, write-off, discount. No migration.
- Not in this phase: plan money in dashboards / revenue reports (D1).

### Frontend
- Plan page Payments card: charged / paid / due now (or in credit) / still to come, Collect payment, Refund, Write off, Discount, instalments (due / paid / overdue), every entry with its receipt.
- One money dialog (amount, Cash/UPI/Card, reason where needed), toast shows the receipt number.
- Accept dialog: instalment rows (amount + day) with a live "adds up to" check.
- Appointment details: "Treatment plan visit … Payment is collected on the treatment plan · Open plan".

### Review gate
| Check | Result |
|---|---|
| Money checks on the dev DB (fake appointment store; throwaway plans cleaned up) | 18/18: no money before accept, advance as credit, share-of-total charge 545.45, receipt, repeat payment ignored, last charge closes at exactly 1,000, no double charge, refund/write-off limits, roles 403, instalments must add up, instalment paid by payment, discount shrinks the last instalment |
| Earlier phases re-run | Phase 4 29/29; Phase 3 21/21 (one check updated: instalments are now on) |
| New routes | 401 without login |
| Unit tests added | `money.utils.test.ts` — owner runs Jest |
| Lint, type check, Jest, browser | not run (owner's instruction) / owner |

---

## Phase 6 — Track and close (2026-10-13)

6.3 (reminder jobs) is **on hold** by the owner. No database change: the columns were already there.

### Backend
| File | Change |
|---|---|
| `services/plans/planLifecycle.service.ts` | new: pause, resume, end early (sensitive flag), recall date, package extension (optional fee, `requestId`), notes, `isSilencedVisit` |
| `services/plans/planBooking.service.ts` | booking refused while paused or after the package's last day; a visit completed while paused still marks its step done |
| `services/plans/planQuery.service.ts` | detail returns `history` (newest first, with names); list returns `counts` per status and takes `stage=active` |
| `routes/v1/treatmentPlan.route.ts` | POST `/pause`, `/resume`, `/end`, `/extend` (Admin, Doctor); PUT `/recall` (Admin, Doctor); POST `/notes` (Staff); apiDocs |
| `schemas/plan.schema.ts`, `response.schema.ts`, `types/*` | new bodies; `history`, `recallDate`, `endReasonSensitive`, `completedAt`, list `counts`; history actions `note`, `recall_set` |
| `audit/utils/trackedActions.utils.ts` | pause, resume, end early, extend |
| `treatmentPlan/index.ts` + `notifications/services/appointmentWhatsappReminder.service.ts` | 6.4: a visit of a plan ended for a sensitive reason gets no reminder (checked at send time) |

Choices: Doctor/Admin manage; pause only flags (nothing cancelled); resume goes back to In treatment if a step is done, else Accepted; extension fee raises the total and is charged at once (not spread over instalments).

### Frontend
| File | Change |
|---|---|
| `PlanViewPage.tsx` | **Manage plan** menu (Pause / Resume / Extend / Recall; End plan early last, red); banners for paused, package ended, ended early, completed + recall |
| `PlanLifecycleDialog.tsx` | new: one dialog for pause, end, recall, extend |
| `PlanHistoryCard.tsx` | new: Notes and history, plain words, "Add note", show all |
| `TreatmentPlanList.tsx`, `PlanTable.tsx` | status tabs with counts; work-list filter (Needs booking / Missed); progress bar |
| `treatmentPlanApi.ts`, `types/treatmentPlan/*` | `changePlan` mutation, history and lifecycle types |

### Tested
- `phase6Check.ts` on dev: **21/21** (pause/resume rules, 403 for reception, booking blocked, sensitive silence, extension fee once, expiry, recall, notes, tab counts).
- Phase 4 (29/29) and Phase 5 (20/20) checks re-run: no change.
- Not run (owner's rule): tsc, lint, jest. Browser pass: TEST_LOG Page 14.

---

## Polish — 2026-10-15/16 (after Phase 6)

UI and flow fixes from owner review. Uncommitted at time of writing unless noted (PRs BE #547, FE #775 hold the 2026-10-15 part).

### Templates
- **Category removed end to end** (model, API, list, search, library seed). Migration drops `treatment_templates.category` (owner-run). API change is not additive: clients reading `category` get nothing.
- Builder reworked: one "How is this treatment set up?" choice grouped as **Staged plan** (fee per step / one price) and **Session package**; price and session fields sit under it; rare fields (check-up reminder, consent, instalments, tax) folded under **More options**; lighter steps list with tooltips; "Latest gap" → **Overdue after**, "Recall after" → **Check-up reminder**.
- New clinic template starts on the user's own speciality (`mySpecialties` from the catalogue list, 1 row).
- Session packages are no longer blocked by hidden step rows (separate form schema per type).
- Clinic templates go live in one click: **Make ready to use** = check + activate. Labels: Active → Ready to use, Inactive → Turned off, Deactivate → Turn off. Library keeps Check → Publish.
- Plan picker: package cards show the session count (was "0 sessions").

### Plans list and statuses
- Status labels: Waiting for patient, Not started, Ongoing, Done, Stopped early (data unchanged).
- List shows each patient's mobile; no own mobile → the in-clinic family contact's (`patientMobile`, one query per page).
- "Treatment plan" removed from the header's New menu.
- **Calls on active plans** (changes §3.3): "Log a call" now also on accepted, in-treatment and paused plans (reminders, moves, payments), not only while the patient decides. Status never changes on a call.

### Booking
- `GET …/steps/:stepId/booking-options` returns **`existingVisit`**: the patient's usable visit with the plan doctor that day. The dialog offers **Use token N** (links it) instead of tokens that would be refused (one visit per patient per day). A 409 still says what to do.

### Money (pay at each visit)
- Plan detail returns **`nextVisit` `{ stepId, fee }`**: the next unfinished step's share less unused credit (same rule as the visit page).
- Steps card: **Collect ₹N for this visit** on that step; Collect dialog adds a **This visit** chip.
- Appointment page: **Mark as Paid hidden on plan visits** (₹0, booked Pay Later); Confirm and Patient arrived no longer wait for it. The plan share is taken with Collect.
- Mark as Paid on a normal Pay Later visit now stores the method used (Cash/UPI/Card) instead of keeping "Pay Later".

### Steps / sessions in sync
- Packages say **session**, staged plans **step**, everywhere on the steps card and booking dialog ("Book session 3", not "Book step 3: Session 3").
- Package rows show their even share of the total.
- Warning when the sessions left can't fit before **Valid until** ("…extend the package from Manage plan").

### Not done / open
- "Paid ✓" per session (payments aren't tied to one step).
- Visit with a *different* doctor that day isn't detected up front (only the 409 message).
- Check-up reminder (`recallAfterDays`) is saved but not used to set a recall date.
- Lint, type check and browser checks not run by the agent.

## Phase R — Review type (2026-10-24)

What the clinic can do now: regular check-ups of a long-term condition (PCOS, diabetes, thyroid) as a plan.
A Review template holds one review (name + fee) repeated N times, a fixed gap apart; it is paid per visit,
with no package price, instalments or expiry (Q28).

| Step | Side | Change |
|---|---|---|
| R.1 | BE | `review` accepted on templates; new check `treatment_templates_review_ck` (owner migration); preview "Review 1…N", fee × N |
| R.2 | BE | `review` accepted on plans (per visit only); Save as template keeps one review step; list price and suggestion count use fee × N |
| R.3 | BE | Gap safety check uses the review gap; accept refuses package billing for a review (422) |
| R.4 | FE | Template builder "Regular Check-ups": review name, fee per review, number of reviews, days between |
| R.5 | FE | Plans from a review template: "Review 1…N"; `stepUnit()` names visits on every screen; accept shows the two per-visit options |
| R.6 | BE | Library seed: PCOS care, Diabetes review, Thyroid review, Acne on medicines, Routine dental check-up (unchecked drafts, no fees) |
| R.7 | Both | `__tests__/reviewType.test.ts` (template rules, preview dates/total, review dates, plan body); TEST_LOG Page 21 |

| Check | Result |
|---|---|
| Seed entries against the template schema | 15/15 valid |
| IDE type diagnostics on changed files | none |
| `reviewType.test.ts` | written, not run (owner runs tests) |
| Browser pass (TEST_LOG Page 21) | pending: owner |

## Phase F — Money fixes (2026-10-24)

From the module review (Q29). No migration.

| Step | Side | Change |
|---|---|---|
| F.1 | BE | Discount takes an optional `requestId`, kept in its history meta; a repeat on the same plan applies nothing |
| F.2 | FE | Discount form sends its `requestId` |
| F.3 | BE | Book, book-all and link refuse a day after `package_expires_on` |
| F.4 | FE | Book / Book all pickers stop at the package's last day; shared `SingleDayPicker` gains `maxValue` |
| F.5 | BE | End plan frees future visits not yet started: ₹0 plan visits cancelled after commit, covered normal visits re-priced; response adds `visitsNotCancelled` |
| F.6 | FE | End dialog lists the visits it will cancel; a failed cancel shows a lasting warning |

| Check | Result |
|---|---|
| Dev-DB flow (fake appointments, full clean-up) | 9/9: retried discount once, new discount applies, end cancels ₹0 visit, failed cancel counted, no live link left, day-11 session refused on a 10-day package, last day allowed, row counts unchanged |
| IDE type diagnostics on changed files | none |
| Browser pass (TEST_LOG Page 22) | pending: owner |

## Step done without a visit (2026-10-27)

For walk-ins: the doctor or an admin marks the next open step done with no appointment. No migration (`done_appointment_id` was already nullable).

- BE `POST /:planId/steps/:stepId/done` `{ doneOn?, note? }` → `PlanBookingService.markDoneWithoutVisit`. Refuses: other roles (403), a step with a booked visit, a step after an open one (409), a future day or a day before the previous step / accept day (422). Reuses `markDone`: charges the step's fee, moves the plan to in treatment / completed, logs `step_done` with the actor and note; no visit payment to settle.
- FE: step row ⋯ menu "Mark done (no visit)" → `MarkStepDoneDialog` (day + note); the row reads "27 Oct 2026 · no visit"; history says "Step N done without a visit".
- Dev-DB check: refusals, success, money charge, history, second try refused; the plan restored after.

## Booking and step-row fixes (2026-10-30)

- BE Book all skips a day the patient already has a visit with this doctor that it can't reuse (e.g. completed), or a day it already picked for an earlier step, so it no longer suggests a day the booking rule refuses.
- BE Step paid status: money covers charged steps first, then the rest by seq, so a step done out of order no longer shows "due" while an open step shows "Paid ahead". Totals unchanged.
- FE Book all uses the shared `SingleDayPicker`; Book/Rebook says "today or later" when the earliest day has passed; a missed step with no date says "After step N" instead of a stray "·".
- Not done: warning on the visit when earlier steps are still open (needs a field on the visit-steps response).
