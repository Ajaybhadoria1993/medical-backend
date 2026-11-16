# Treatment Plan — test log (page by page)

Manual test record, one section per screen. Tick `[x]` when a row passes and fill in the result,
date and notes. A failed row stays `[ ]` with **Fail** and what you saw.
Ref = the test ID in `TEST_CHECKLIST.md` where one exists.

**How to use**
- Before a run: restart the backend, refresh the browser, note the build (branch + last commit) below.
- Result: `Pass` · `Fail` · `Skip` (say why in notes).
- New phases add their screens at the bottom; earlier sections are re-run when a phase touches them.

| Run | Date | Tester | Branch / commit | Covers |
|---|---|---|---|---|
| 1 | | | `feat/treatment-plan` / | Phase 0 + Phase 1 |
| 2 | | | `feat/treatment-plan` / | Phase 1 re-run (shared dialog changed) + Phase 2 |
| 3 | | | `feat/treatment-plan` / | Pages 15–20: options, today's visit, booking, remove visit, time-based alerts, shared form controls |

---

## Setup (once per database)

| ✓ | # | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|
| [ ] | S0.1 | `npm run db:migrations:dev` then `npm run db:migrate:dev` | Applies with no error | | | |
| [ ] | S0.2 | `npm run db:seed:dev` | "Treatment templates seeded: 10 added as drafts" | | | |
| [ ] | S0.3 | Run the seed again | "already present. Skipping" (L1, L2) | | | |
| [x] | S0.4 | Migration for options / today's visit: `treatment_plans.option_name`, `treatment_plans.consultation_step_seq`, `paid_at_visit` on `tp_ledger_entry` | All three present | Pass (dev) | 2026-10-14 | Checked on the dev DB; staging/prod still to run |

---

## Page 1 — Treatment Plans (`/treatment-plans`) · Phase 0

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P1.1 | Admin, Doctor, Receptionist | Click **Treatment Plans** in the menu | Page with header and "No treatment plans yet" | 0.5 | | | |
| [ ] | P1.2 | Admin, Doctor | Look at the header | **Templates** button | 1.6 | | | |
| [ ] | P1.3 | Receptionist | Look at the header | No Templates button | X4 | | | |
| [ ] | P1.4 | Any staff | Complete, cancel or no-show any appointment | Works as before; backend log shows `[TreatmentPlan] appointment …` | G1, 0.4 | | | |
| [ ] | P1.5 | Doctor, Admin with doctor access | Look at the header | **New plan** button opens "Select treatment template" over this page | | | | |

## Page 2 — Settings → Treatment Plans (`/settings/treatment-plans`) · Phase 0/1

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P2.1 | Admin | Open it | Defaults: 4 billing ways, "After each step", 10%, reminders 7 / 2 / 7 | 0.3 | | | |
| [ ] | P2.2 | Admin | Discount 150 → save | "Enter a whole number from 0 to 100" | | | | |
| [ ] | P2.3 | Admin | Discount 15 → save → reload | Still 15; toast with description | | | | |
| [ ] | P2.4 | Admin | "When the invoice is made" | Two tiles, lined up with the other fields | | | | |
| [ ] | P2.5 | Doctor, Receptionist | Open Settings | No Treatment Plans item | | | | |

## Page 3 — Clinic template list (`/treatment-plans/templates`) · Phase 1

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P3.1 | Admin | Open it | Filters in order: Status → Speciality → Search; Clear filters at the right | 1.6 | | | |
| [ ] | P3.2 | Admin | Search "root", "ROOT", "%" | Found, found, nothing | T11 | | | |
| [ ] | P3.3 | Admin | Speciality: type "dent" | Searchable list; picking Dentist filters the rows | | | | |
| [ ] | P3.4 | Admin | Status filter: Draft / Active / Archived | Rows match; archived hidden under the default "All but archived" | | | | |
| [ ] | P3.5 | Admin | Filters that match nothing | "No templates match these filters" + how to clear | U1 | | | |
| [ ] | P3.6 | Admin | **Copy ready-made** | Dialog lists only **published** library templates | L6 | | | |
| [ ] | P3.7 | Admin | Copy one | Opens as the clinic's Draft with `source` kept | L5 | | | |
| [ ] | P3.8 | Doctor | Show: **My versions** | Only the doctor's own versions, with a "My version" chip | V3 | | | |
| [ ] | P3.9 | Admin | Look for a doctor's own version | Not listed | V4 | | | |
| [ ] | P3.10 | Admin | Phone width (320px) | Header buttons become icons; no sideways scroll | U4 | | | |

## Page 4 — Clinic template builder (`/treatment-plans/templates/new`, `/:id`) · Phase 1

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P4.1 | Admin | **New template**, Staged, 5 steps, gaps 0 2 3 3 7 → **Save as draft** | Toast, back to the list; template is Draft with steps 1–5 | T1 | | | |
| [ ] | P4.2 | Admin | Same form | Sample schedule: today, +2, +5, +8, +15 days; 15 days total | T12 | | | |
| [ ] | P4.3 | Admin | Leave a step's Duration blank | Saves; hint "Blank = normal slot length" | T6 | | | |
| [ ] | P4.4 | Admin | Gap −1, Duration 0 | Field errors; save blocked | T5 | | | |
| [ ] | P4.5 | Admin | Latest gap less than Gap | "The latest gap must be at least the minimum gap." | | | | |
| [ ] | P4.6 | Admin | Type a 200-character name | Box stops at 150 | | | | |
| [ ] | P4.7 | Admin | 31 keywords, or one over 60 characters | Clear message on the keywords box | | | | |
| [ ] | P4.8 | Admin | Plan type → **Session package**, 6 sessions, every 28 days, valid 30 | "The sessions take 140 days; …" | | | | |
| [ ] | P4.9 | Admin | Open a Draft, not checked | Line: "Not checked yet. Review …"; button **Mark as checked** | 1.3 | | | |
| [ ] | P4.10 | Admin | **Mark as checked** | Toast; stays on the page; button becomes **Activate** | | | | |
| [ ] | P4.11 | Admin | **Activate** with fees empty | Jumps to the first Fee; empty fees red; no request sent | T7 | | | |
| [ ] | P4.12 | Admin | Type a fee | Its red message clears; preview "₹… · So far · N prices still empty" | | | | |
| [ ] | P4.13 | Admin | Fill all fees → **Save changes** | Toast, back to the list | T10 | | | |
| [ ] | P4.14 | Admin | Reopen → **Activate** | "… activated", back to the list; status Active | 1.3 | | | |
| [ ] | P4.15 | Admin | Open an Active one → **Deactivate** | Grey button; toast; back to the list; Inactive | | | | |
| [ ] | P4.16 | Admin | ⋯ → **Archive template** → confirm | Dialog names it; back to the list; under Archived only | T8 | | | |
| [ ] | P4.17 | Admin | Open an archived one | Read-only line; only "Back to templates" | | | | |
| [ ] | P4.18 | Doctor | ⋯ → **Save as my version** | A new Draft opens, only for this doctor | V5 | | | |
| [ ] | P4.19 | Admin | Edit a template that a plan was made from | Template changes; the plan keeps its own steps (check in Phase 2) | T9 | | | |
| [ ] | P4.20 | Admin | Step card | Badge + name + ↑ ↓ 🗑 on one row; "days"/"min" in the boxes; no spinner arrows | | | | |
| [ ] | P4.21 | Admin | 1280×720 and 1366×768 | Steps in 2 columns; buttons at the bottom of the preview card | U4 | | | |
| [ ] | P4.22 | Admin | Below 1280px | Buttons in a bar pinned to the bottom | U4 | | | |

## Page 5 — Super Admin: ready-made library (`/treatment-templates`) · Phase 1

| ✓ | # | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P5.1 | Open it | 10 seeded templates, Draft, "Not checked yet" | L1 | | | |
| [ ] | P5.2 | Open Root canal | Gaps 0, 2, 3, 3, 7; fees empty | | | | |
| [ ] | P5.3 | **Mark as checked** → **Publish** (no fees) | "… published", back to the list; Active | 1.5 | | | |
| [ ] | P5.4 | Rename a seeded template, then run the seed again | Your name stays | L3 | | | |
| [ ] | P5.5 | Create two templates with the same Code | Second refused: "Another ready-made template already uses this code" | L4 | | | |
| [ ] | P5.6 | **Unpublish** | Inactive; clinics can no longer copy it | | | | |
| [ ] | P5.7 | Edit a published template a clinic has copied | Clinic's copy unchanged; it shows "The ready-made version changed…" | L8 | | | |

## Page 6 — Super Admin: Treatment Plan Fields (`/configuration/treatment-plan-fields`) · Phase 1

| ✓ | # | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P6.1 | Open it with none saved | "No specialty has extra fields yet" | S1 | | | |
| [ ] | P6.2 | **Add fields**: Dentist, Number "Tooth number", key `tooth_number`, min 11, max 48, Required → save | Saved; row shows "1 plan field" | | | | |
| [ ] | P6.3 | Reopen → **Preview** → type 50 | "Enter at most 48." | S2, S3 | | | |
| [ ] | P6.4 | Add the same specialty again | Refused: "… already has a field set; edit that one" | | | | |
| [ ] | P6.5 | One-choice field with "PFM, PFM" | "A choice is listed twice; remove the repeat." | | | | |
| [ ] | P6.6 | Two fields with the same key | "Two fields use the same key…" | | | | |
| [ ] | P6.7 | Turn "Offer these fields" off | Row shows "Off" | | | | |

## Access (all pages)

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | X.1 | Receptionist | Open `/treatment-plans/templates` | Blocked | X4 | | | |
| [ ] | X.2 | Clinic Admin | Open `/treatment-templates` | Blocked | L10 | | | |
| [ ] | X.3 | Clinic A user | Open a clinic B template id | "This template couldn't be opened" (404) | X1 | | | |

## Every screen (run once per page above)

| ✓ | # | Check | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | E.1 | Dark mode | Text boxes and dropdowns alike; no navy/white boxes; readable | U3 | | | |
| [ ] | E.2 | Keyboard only | Tab order sensible; Enter opens rows; Esc closes dialogs | U2 | | | |
| [ ] | E.3 | 320×568, 1024×768, 1280×720, 1366×768 | No sideways page scroll; buttons reachable | U4 | | | |
| [ ] | E.4 | Wording | No raw values like `in_treatment`; toasts have a title and a line | U5, U8 | | | |
| [ ] | E.5 | Loading / empty / error | Skeleton, a "what to do next" empty state, a human error | U1 | | | |

## Unit tests (owner runs; no Jest on the dev machine)

| ✓ | # | Command (in `Medi_Arogya_BE`) | Result | Date | Notes |
|---|---|---|---|---|---|
| [ ] | J.1 | `npx jest src/main/treatmentPlan/__tests__/timing.utils.test.ts` | | | |
| [ ] | J.2 | `npx jest src/main/treatmentPlan/__tests__/templatePreview.utils.test.ts` | | | |
| [ ] | J.3 | `npx jest src/main/treatmentPlan/__tests__/specialtyFields.utils.test.ts` | | | |
| [ ] | J.4 | `npx jest src/main/treatmentPlan/__tests__/routes.guard.test.ts` | | | |

---

## Failures found

Copy a failed row here with what you saw; mark it fixed when it passes again.

| # | Page / row | What happened | Fixed in | Re-tested |
|---|---|---|---|---|
| | | | | |

---

## Page 7 — Consultation: plan card in Clinical details · Phase 2

Open a confirmed appointment → **Clinical** (drawer) → **Diagnosis**. The card sits under "Add other diagnosis…".

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P7.1 | Doctor (Dentist) | Add the chip "Irreversible pulpitis" | Card: "Suggested plan: Root canal treatment · Matched 'pulpitis' · 5 steps · ₹…" with **Create plan · Choose another template · Custom plan** (needs an active clinic template with that keyword) | P1 | | | |
| [ ] | P7.2 | Doctor | Diagnosis with no matching keyword | One line: "Treatment plan: Choose a template · Custom plan" | | | | |
| [ ] | P7.3 | Doctor | **Create plan** | Customise dialog opens over the drawer; the drawer stays open behind it | 2.5 | | | |
| [ ] | P7.4 | Doctor | Press **Esc** / **×** in the dialog | Only the dialog closes; drawer still open with the same chips | | | | |
| [ ] | P7.5 | Doctor | **Choose another template** | "Select treatment template" dialog with the suggestion pre-selected | | | | |
| [ ] | P7.6 | Doctor | Propose from the consultation | Toast "… proposed"; you stay on the consultation | | | | |
| [ ] | P7.7 | Doctor | Medicine area (under ALLERGIES / DX strip) | No plan card there any more | | | | |
| [ ] | P7.8 | Doctor | Collapse layout (Rx settings) | Card under its Diagnosis field; same dialog | | | | |

## Page 8 — Select template + Customise dialog · Phase 2

Opened from Page 7, or **Treatment plans → New plan**, or **+ New → Treatment plan** (`/treatment-plans/new` opens it over the list).

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P8.1 | Doctor | Open **Select treatment template** | Search; groups on the left (All · My versions · categories) with counts; cards; preview of steps/gap/fee + Total on the right | P11 | | | |
| [ ] | P8.2 | Doctor | Search a name, then a group | List filters; selection jumps to the first match; preview follows | | | | |
| [ ] | P8.3 | Doctor | **Use this template** (Staged) | Customise: steps, gaps, fees, options copied; title filled | P2 | | | |
| [ ] | P8.4 | Doctor | **Use this template** (Package) | One row per session, gap = interval; pricing = one package price | P3 | | | |
| [ ] | P8.5 | Doctor | **Custom plan (no template)** | Customise with one empty step; title and diagnosis boxes open | | | | |
| [ ] | P8.6 | Doctor | Look at the top of Customise | One line "Title / Patient · Diagnosis" + **Edit**; allergy line under it | 2.4 | | | |
| [ ] | P8.7 | Doctor | Steps table | Columns # · Step name · Gap · Visit date · Duration · Fee · ⋮; empty Duration shows "Default" | | | | |
| [ ] | P8.8 | Doctor | Change a gap | Visit dates update at once; **no network call** (DevTools → Network stays empty) | | | | |
| [ ] | P8.9 | Doctor | Type letters / `2222224` in Gap or Duration | Only digits, max 3; Duration 999 → "Enter 1 to 600 minutes…" on leaving the box | | | | |
| [ ] | P8.10 | Doctor | Type `12.345` / letters in a Fee or Discount | Stays `12.34`; letters ignored | | | | |
| [ ] | P8.11 | Doctor | ⋮ on a step → Move up / Move down / Remove | Works; first can't move up, last can't move down, last step can't be removed | P5 | | | |
| [ ] | P8.12 | Doctor | Pricing switch → **One package price** | Fee column hides; Package price box appears; footer asks for the price until filled | | | | |
| [ ] | P8.13 | Doctor | Add a discount | Footer: "Patient pays ₹…" and "₹… off · First to last visit: N days" | | | | |
| [ ] | P8.14 | Doctor | Scroll the dialog | Only the plan scrolls; footer (total + buttons) never covers a field | | | | |
| [ ] | P8.15 | Doctor | **Change template** | Back to the picker with the same template selected | | | | |
| [ ] | P8.16 | Doctor | **Propose plan** | Toast "… proposed" (from Treatment plans it opens the plan) | P2 | | | |
| [ ] | P8.17 | Doctor | Lower a gap below the template's | Reason dialog names the step; save with a reason works | P7 | | | |
| [ ] | P8.18 | Doctor | Discount above the clinic limit | Reason dialog; save with a reason works | P8 | | | |
| [ ] | P8.19 | Doctor | Propose the same template again for the same patient | Reason dialog "Same treatment already open" | P9 | | | |
| [ ] | P8.20 | Doctor | From Treatment plans (no patient yet) | Patient search shown first; results after 2 letters | 2.4 | | | |
| [ ] | P8.21 | Doctor | Session package plan | "Valid for … days" in the pricing row | | | | |
| [ ] | P8.22 | Doctor | Specialty with plan fields (Treatment Plan Fields) | Those fields show under the pricing row | S2 | | | |
| [ ] | P8.23 | Doctor | Light **and** dark mode, 200% zoom | Readable, no overlap, table scrolls inside its box on a phone | | | | |

## Page 8b — Edit a plan (`/treatment-plans/:planId/edit`) · Phase 2

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P8b.1 | Doctor | Open a proposed plan | Same panel as Customise, "Proposed" chip, **Save changes** only after a change | | | | |
| [ ] | P8b.2 | Doctor | Reorder / add / remove steps, save → reload | Order kept | P5 | | | |
| [ ] | P8b.3 | Doctor | ⋯ → **Add another option** | Option B opens; switcher shows Option A / Option B with prices | P6 | | | |
| [ ] | P8b.4 | Doctor | ⋯ → **Save as my template** | Toast; it appears under Templates → My versions as a Draft | V5 | | | |
| [ ] | P8b.5 | Doctor (2 tabs) | Save in tab 1, then save in tab 2 | Tab 2: "changed by someone else" | P10 | | | |

## Page 9 — Access for plans · Phase 2

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P9.1 | Receptionist / plain Admin | Open `/treatment-plans/new` | Blocked (doctors propose plans) | X4 | | | |
| [ ] | P9.2 | Admin with doctor access | Open `/treatment-plans/new`; header quick add | Allowed; "Treatment plan" item shown | | | | |
| [ ] | P9.3 | Doctor B | Open Doctor A's plan link | "This plan couldn't be opened" | X2 | | | |
| [ ] | P9.4 | Receptionist / plain Admin | Treatment plans page; header quick add | No **New plan** button; no "Treatment plan" item | | | | |

## Page 10 — Find a suggested plan · Phase 2

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P10.1 | Doctor | Suggest a plan from the consultation | Toast "… suggested" with **Open plan** (stays ~10 s); Open plan opens it | | | | |
| [ ] | P10.2 | Doctor | Open **Treatment plans** | Table: Patient · Plan · Status "Suggested" · "0 of 5 steps" · Total · Suggested on; newest first | | | | |
| [ ] | P10.3 | Doctor | Click a row (or Tab + Enter) | Opens that plan | | | | |
| [ ] | P10.4 | Doctor | Suggest another plan, go back to the list | New row on top without a page reload | | | | |
| [ ] | P10.5 | Doctor B | Open Treatment plans | Only Doctor B's own plans | X2 | | | |
| [ ] | P10.6 | Receptionist (scoped) | Open Treatment plans | Plans of their doctors; rows not clickable yet (staff plan page is Phase 6) | | | | |
| [ ] | P10.7 | Doctor | More than 25 plans | Pages at the bottom | | | | |
| [ ] | P10.8 | Doctor / Admin | Header of Treatment plans | **Templates** (outlined) and **New plan** buttons; Templates opens the template list |  | | | |
| [ ] | P10.9 | Doctor | Search a patient name, part of a mobile, or a plan title | Only matching plans; "Clear" appears; page goes back to 1 | | | | |
| [ ] | P10.10 | Doctor | Status → Suggested / back to All statuses | List filters / shows all again | | | | |
| [ ] | P10.11 | Doctor | Click **Total**, then again; same for **Suggested on** | Sorts high→low, then low→high; arrow shows the order | | | | |
| [ ] | P10.12 | Doctor | Search for something with no match | "No plans match these filters" with **Clear filters** | | | | |
| [ ] | P10.13 | Receptionist | Open Treatment plans | No Templates or New plan button; list and filters work | | | | |

## Page 11 — Patient decision (`/treatment-plans/:planId`) · Phase 3

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P11.1 | Receptionist | Treatment plans → click a suggested plan | Plan page opens (no edit button); steps, total, "Patient's answer" | 3.4 | | | |
| [ ] | P11.2 | Receptionist | **Will think about it** → call-back date + note | Toast; "Call back on …"; a call in the log; list "Next call" shows the date | 3.2 | | | |
| [ ] | P11.3 | Receptionist | **Log a call** → No answer, next date | New call on top; Next call moves | 3.5 | | | |
| [ ] | P11.4 | Receptionist | Pick a past date | "Pick today or a later date." | | | | |
| [ ] | P11.5 | Receptionist | **Accept** → "Pay at each visit", no advance | Accepted card: date, pays, Advance "None", Version 1; answer buttons gone | 3.1 | | | |
| [ ] | P11.6 | Receptionist | Accept another plan with ₹500 advance, UPI | Receipt `TP-2026-XXXXXX`; payment way required once an amount is typed | 3.1 | | | |
| [ ] | P11.7 | Receptionist | Advance above the total | "The advance can't be more than the plan total…" | | | | |
| [ ] | P11.8 | Receptionist | Accept a plan that needs consent, without a file / with a 12 MB file / with a PDF | Asks for the form / "larger than 10 MB" / accepted; **View consent form** opens it | 3.1 | | | |
| [ ] | P11.9 | Receptionist | Payment options | Only the clinic's enabled ones; never "Package in instalments" | Q24 | | | |
| [ ] | P11.10 | Doctor | Plan with Options A and B → accept B | A shows Declined "Option B was accepted" | 3.2 | | | |
| [ ] | P11.11 | Receptionist | **Decline** → reason + try-again date | Red dialog; Declined card with reason and date; Log a call still works | 3.2 | | | |
| [ ] | P11.12 | Doctor | Accepted plan → **Edit plan** → change a fee → save | Header note about the next version; back on the plan page: "Waiting for the patient's approval" | 3.3 | | | |
| [ ] | P11.13 | Receptionist | **Patient approved** | Banner goes; toast | 3.3 | | | |
| [ ] | P11.14 | Doctor | Edit an accepted plan so the total is below the advance | "The new total is less than the advance already paid" | | | | |
| [ ] | P11.15 | Two tabs | Accept in tab 1, then Decline in tab 2 | Tab 2: "already answered… Reload" | | | | |
| [ ] | P11.16 | Admin | Audit screen after an answer | "Recorded treatment plan decision" | | | | |
| [ ] | P11.17 | Any | Keyboard only, dark mode, phone width | Dialogs trap focus, Esc closes; readable; no sideways page scroll | | | | |

## Page 12 — Booking and visits · Phase 4

Use an accepted plan with 3+ steps (accept one on Page 11 first).

| ✓ | # | As | Do | Expect | Ref | Result | Date | Notes |
|---|---|---|---|---|---|---|---|---|
| [ ] | P12.1 | Receptionist | Treatment plans → filter **Needs booking** | The accepted plan is listed | 4.7 | | | |
| [ ] | P12.2 | Receptionist | Plan page → Steps | Step 1 "From today" with **Book**; later steps "After step N is booked" | 4.1 | | | |
| [ ] | P12.3 | Receptionist | **Book** step 1 → tomorrow → pick a time (or token session) → Book visit | Toast; step shows the day and time; step 2 shows "From …" (gap counted from step 1's day) | 4.2 | | | |
| [ ] | P12.4 | Receptionist | Appointments list for that day | The visit is there, type **Treatment**, no fee | 4.2 | | | |
| [ ] | P12.5 | Receptionist | Book step 2 before its earliest day | The day picker won't allow it | 4.1 | | | |
| [ ] | P12.6 | Doctor | Book step 2 early | Asks "Why earlier than the gap?"; books with the reason | 4.1 | | | |
| [ ] | P12.7 | Receptionist | **Unlink** step 2 | Step 2 not booked; toast says the appointment itself is still booked | 4.4 | | | |
| [ ] | P12.8 | Receptionist | **Book all remaining** → change one row's day and time | Each row has a day picker and time/token choice; moving a row earlier than the gap after the row above shows "Too early: from …" in red and blocks booking; confirm books them all | 4.3 | | | |
| [ ] | P12.9 | Receptionist | Mark step 2's appointment **No-show** (Appointments) | Plan page (open) updates: step 2 "Missed, rebook"; filter **Missed visits** shows the plan | 4.5 | | | |
| [ ] | P12.10 | Receptionist | **Cancel** step 3's appointment | Step 3 back to not booked | 4.5 | | | |
| [ ] | P12.11 | Receptionist | **Reschedule** step 1's appointment later | Later steps' "From" dates move; a too-early booking shows "Too early now; rebook" | 4.5 | | | |
| [ ] | P12.12 | Receptionist | Book a normal appointment for the patient with the plan's doctor, then open the plan | "The patient already has a visit — **Use it for step N**" links it | 4.4, 4.8 | | | |
| [ ] | P12.13 | Doctor | Open step 1's appointment → Clinical details → Diagnosis | "This visit: <plan> · Step 1 — Done when you complete this consultation"; no Mark done button anywhere | Q26 | | | |
| [ ] | P12.14 | Doctor | **Complete Consultation** on that visit | Step 1 → Done; plan → **In treatment**; next step bookable | Q26 | | | |
| [ ] | P12.15 | Any | Plan page, a step with no visit or an upcoming visit | No way to mark it done by hand | Q26 | | | |
| [ ] | P12.16 | Doctor | Complete the last step's visit | Plan → **Completed**; no booking buttons | Q26 | | | |
| [ ] | P12.17 | Doctor | Edit an accepted plan that has a booked step | "Some steps already have booked visits. Unlink them…" | Q25 | | | |
| [ ] | P12.18 | Any | Keyboard only, dark mode, phone width | Dialogs work by keyboard; times readable; steps table scrolls inside its box | | | | |

## Page 13 — Payments · Phase 5

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P13.1 | Receptionist | Accept a plan with ₹200 advance → plan page | Payments: Paid ₹200, **In credit** ₹200, Still to come = total | | | |
| [ ] | P13.2 | Doctor | Complete step 1's visit | A "Visit charged" entry; Due now = charge − 200 | | | |
| [ ] | P13.3 | Receptionist | **Collect payment** (amount pre-filled) → UPI | Toast with receipt TP-2026-XXXXXX; Due now ₹0 | | | |
| [ ] | P13.4 | Receptionist | Double-click Record payment | Only one payment entry | | | |
| [ ] | P13.5 | Receptionist | **Refund** more than paid | "can't be more than what was paid" | | | |
| [ ] | P13.6 | Receptionist | Look for Write off / Discount | Not shown | | | |
| [ ] | P13.7 | Doctor | **Write off** part of the due, with a reason | Entry "Written off"; due drops; Audit shows it | | | |
| [ ] | P13.8 | Doctor | **Discount** with a reason | Total and Still to come drop | | | |
| [ ] | P13.9 | Receptionist | Accept a plan with **Package in instalments**: rows that don't add up / do add up | Refused with the right total / accepted; Instalments list shows Due | | | |
| [ ] | P13.10 | Receptionist | Pay the first instalment's amount | First instalment **Paid** | | | |
| [ ] | P13.11 | Any | Open a plan visit's appointment | "Payment is collected on the treatment plan · Open plan"; no fee taken there | | | |
| [ ] | P13.12 | Doctor | Complete every visit | Charges add up to exactly the plan total | | | |

## Page 14 — Track and close · Phase 6 (6.3 reminders on hold)

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P14.1 | Receptionist | Open an accepted plan | No **Manage plan** button | | | |
| [ ] | P14.2 | Doctor | Manage plan → **Pause plan**, reason "Travelling" | Yellow "This plan is paused" banner with the reason; no Book buttons; status chip Paused | | | |
| [ ] | P14.3 | Doctor | Banner → **Resume plan** | Back to Accepted / In treatment; Book buttons back | | | |
| [ ] | P14.4 | Doctor | Complete a visit that was booked before pausing | Step still marked Done | | | |
| [ ] | P14.5 | Doctor | Manage plan → **End plan early** (red, last in the menu), tick **Sensitive** | Plan Ended early; "Messages and reminders … turned off"; Audit shows it | | | |
| [ ] | P14.6 | Any | Booked visit of that plan, at its reminder time | No WhatsApp reminder sent | | | |
| [ ] | P14.7 | Doctor | Package plan past its last day | "This package ended on …"; booking refused | | | |
| [ ] | P14.8 | Doctor | Manage plan → **Extend package**, new day + ₹200 fee | New last day; Payments shows "Visit charged · Package extension ₹200"; total +₹200 | | | |
| [ ] | P14.9 | Doctor | Completed plan → **Set recall date** (6 months) | Banner "Recall on …"; History "Recall set for …" | | | |
| [ ] | P14.10 | Receptionist | **Add a note** | Note at the top of Notes and history, with your name | | | |
| [ ] | P14.11 | Any | Plans list tabs | All · Suggested · Active · Paused · Completed · Declined · Ended early, counts match the rows | | | |
| [ ] | P14.12 | Any | Plans list Progress column | "2 of 5 steps" / "3 of 6 sessions" with a small bar | | | |
| [ ] | P14.13 | Any | Keyboard only, dark mode, phone width | Menu, dialogs and tabs work by keyboard; tabs scroll on a phone | | | |

## Page 15 — Options A/B/C (plan page, editor, list)

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P15.1 | Doctor | Edit a suggested plan → **+ Add option** beside the option tabs | Dialog asks the new option's name (and this plan's name if it has none); new option opens for editing | | | |
| [ ] | P15.2 | Doctor | Edit an option and clear its name → Save changes | Refused: "Name this option, e.g. Ceramic crown…" | | | |
| [ ] | P15.3 | Doctor | Add options until there are 3 | "+ Add option" greyed out with tooltip "up to 3 options" | | | |
| [ ] | P15.4 | Doctor | ⋯ → **Remove this option** → confirm | Option gone; the others stay; with one left it becomes an ordinary plan (no letter) | | | |
| [ ] | P15.5 | Any | Plans list, a proposal with 3 options | One row: "3 options to choose from", price range; Suggested count counts it once | | | |
| [ ] | P15.6 | Receptionist | Plan page while choosing | Option tiles in Patient's answer; picking one shows its steps; **Accept Option X** accepts that one | | | |
| [ ] | P15.7 | Any | After accepting | Quiet line "Option A was chosen. Other options: …"; declined option page says "The patient chose Option A · Open" | | | |

## Page 16 — Today's visit counts as step 1, paid at the visit

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P16.1 | Doctor | Propose a plan from a consultation | "Today's visit is step 1" ticked by default ("session 1" for a package) | | | |
| [ ] | P16.2 | Receptionist | Accept that plan after the visit was completed (₹500 cash) | Step 1 Done; Payments shows **Paid at the visit ₹500**; Left to pay drops by ₹500 | | | |
| [ ] | P16.3 | Doctor | Consultation of a patient with an accepted plan, step 1 unbooked | Teal strip under the patient bar: "… Count this visit as step 1" → **Count as step 1** | | | |
| [ ] | P16.4 | Any | After counting | Strip gone; tag "◫ <plan> · Step 1" in the bar, appointment list and details | | | |
| [ ] | P16.5 | Any | Same visit, step 1 already linked | No strip, no "Count today's visit"; a second attempt is refused | | | |
| [ ] | P16.6 | Receptionist | Visit paid ₹300, step fee ₹500, completed | Paid at the visit ₹300; ₹200 still due | | | |
| [ ] | P16.7 | Receptionist | Full package paid upfront, then step 1 visit completed | No "Paid at the visit" entry (already covered); no credit | | | |
| [ ] | P16.8 | Admin | Finance / Payment History for that day | The ₹500 counted once, as appointment money | | | |

## Page 17 — Book a step (dialog)

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P17.1 | Receptionist | Book step 2 | Shared calendar (today ringed, earlier days faded, "Today" button); first free token pre-selected; button "Book Token N" | | | |
| [ ] | P17.2 | Receptionist | Pick a later token (e.g. 7) → book | Appointment shows token 7 | | | |
| [ ] | P17.3 | Receptionist | Session with 26 free | 10 numbers on an even grid, "Show all 26" / "Show fewer" | | | |
| [ ] | P17.4 | Receptionist | Clinic with two sessions | Session switch first; only that session's tokens | | | |
| [ ] | P17.5 | Doctor | Pick a day before the earliest | Amber notice "… is N days before the earliest day", **Use <day>**, reason required | | | |

## Page 18 — Remove a booked visit

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P18.1 | Receptionist | Plan-booked visit → **Remove visit** | Confirm names the visit; **Remove and cancel visit** → step free, appointment **Cancelled** | | | |
| [ ] | P18.2 | Receptionist | Counted consultation (normal paid visit) → Remove visit | **Remove from step**; appointment stays | | | |
| [ ] | P18.3 | Any | Patient arrived / visit completed | No Remove visit; server also refuses | | | |
| [ ] | P18.4 | Any | Cancelled visit's WhatsApp reminder time | No reminder sent | | | |

## Page 19 — Missed visits and time limits

Dates can't be waited for: ask for dev test data (package ending in 3 days, package ended yesterday, plan with a step due 40 days ago and nothing booked).

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P19.1 | Receptionist | Book step 2 for today, mark the visit **No show** | Red banner "Missed: Step 2 … was missed" with **Rebook step 2** | | | |
| [ ] | P19.2 | Receptionist | Book all, then move step 2's visit later | Amber "Step 3 is now booked too early … Use Remove visit" | | | |
| [ ] | P19.3 | Any | Package ending in 3 days | Plan page amber notice + **Extend package**; list tag "Ends in 3 days" | | | |
| [ ] | P19.4 | Any | Package ended | Red notice + **End plan** / **Extend package**; list tag "Package ended"; booking refused | | | |
| [ ] | P19.5 | Any | Stalled plan | Amber "No visit booked for over 30 days" + **Log a call**; list tag "Needs follow-up"; **Needs follow-up** filter lists it | | | |
| [ ] | P19.6 | Any | Plans are never ended on their own | Stalled / ended plans stay active until staff choose | | | |

## Page 20 — Shared form controls (app-wide)

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P20.1 | Any | Treatment plan forms and dialogs vs create appointment | Same field look: rounded-xl (not pills), same border and dark-mode fill | | | |
| [ ] | P20.2 | Any | Login, pharmacy, profile forms | Also rounded-xl now; nothing else changed | | | |
| [ ] | P20.3 | Any | Any dialog: click outside | Stays open; Esc and X close it; Cancel is neutral (one teal button) | | | |
| [ ] | P20.4 | Any | Coupon form, credits settings, leave editor date pickers | New calendar look; same dates saved | | | |
| [ ] | P20.5 | Any | Upload a consent named like "Screenshot … 7.15 PM.png" | Uploads (no "signature" error) | | | |

## Page 21 — Review type · Phase R (Q28)

Needs the `treatment_templates_review_ck` migration and the library seed run first.

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P21.1 | Admin | New template → **Regular Check-ups**: "Diabetes review", ₹500, 4 reviews, 84 days → Save | "Ready to use"; list shows "Review · 4 reviews, every 84 days · ₹2,000" | | | |
| [ ] | P21.2 | Admin | Same, fee left empty → Save | Saved as a draft; "Fee per review" named as missing | | | |
| [ ] | P21.3 | Admin | Review setup | No Steps card, no "Patient may pay in instalments"; preview shows Review 1…4 with dates | | | |
| [ ] | P21.4 | Doctor | New plan → pick "Diabetes review" | Rows "Diabetes review 1…4", ₹500 each, 84 days apart; total ₹2,000; headings say "Reviews" | | | |
| [ ] | P21.5 | Doctor | In the plan, set review 2's gap to 30 days → Save | Asks for a reason (shorter than the template's 84) | | | |
| [ ] | P21.6 | Receptionist | Accept the plan | Only "Pay at each visit" and "Advance, then pay at each visit" offered | | | |
| [ ] | P21.7 | Receptionist | Book review 1, complete the visit | Review 1 done; review 2 bookable from 84 days after; list "1 of 4 reviews" | | | |
| [ ] | P21.8 | Receptionist | Mark review 2's visit No show | "Missed" with rebook, as for other plans | | | |
| [ ] | P21.9 | Doctor | Plan page → Save as template | New template is Review · 4 reviews, every 84 days, one "Diabetes review" step | | | |
| [ ] | P21.10 | Super Admin | Ready-made templates | PCOS, Diabetes, Thyroid, Acne, Dental check-up listed as unchecked drafts | | | |
| [ ] | P21.11 | Any | Staged and Session package templates and plans | Unchanged: same words ("Steps", "Sessions"), same prices | | | |

## Page 22 — Money fixes · Phase F (Q29)

| ✓ | # | As | Do | Expect | Result | Date | Notes |
|---|---|---|---|---|---|---|---|
| [ ] | P22.1 | Doctor | Accepted plan → Discount ₹100 → double-click Apply | Total drops by ₹100 once | | | |
| [ ] | P22.2 | Doctor | Plan with 2 booked future visits → End plan | Dialog lists both visits "will be cancelled"; after ending, both are Cancelled in Appointments | | | |
| [ ] | P22.3 | Doctor | Plan whose step uses a normal paid visit → End plan | Dialog says it stays booked at its own fee; the appointment shows its normal price again | | | |
| [ ] | P22.4 | Receptionist | Package with a last day → Book step | Picker can't go past the last day; note "The package ends on …" | | | |
| [ ] | P22.5 | Receptionist | Book all on the same package | A row moved past the last day turns red "After the package ends" and blocks booking | | | |
