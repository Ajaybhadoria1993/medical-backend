# Prescription-first build plan (treatment plans later)

Status: **plan only — nothing built.** Each step needs approval before code.
Decided 2026-10-24: build the **prescription / visit gaps** found in the 14 specialty files first;
all **treatment-plan** work (config rows, templates, seed fixes, missed-step cron) waits for its own phase.
**Data model decided (2026-10-26):** see §9 — only one new table (K); J and F reuse existing `report_cards` columns.
**Groundwork first (2026-10-26):** [code-groundwork-plan.md](code-groundwork-plan.md) — steps G1–G6 set one standard way (backend owns sections, one print block, one PDF) before B–K.

## 1. Code facts this plan rests on (checked 2026-10-24)

| Fact | Where |
|---|---|
| Rx lists + section order per specialty are data in one file; 15 mains have no block (generic lists) | BE `utils/doctorSpecialtyConfig.ts` |
| A doctor's own suggestions merge on top; a saved section order replaces the default | same, `resolvePreferenceLists` |
| Only sections listed in `header_order` render | FE `details/PrescriptionDetailsPanel.tsx` (`sectionsToRender`) |
| Specialty cards (dental chart, ovary diagram) save into `additionalInformation` (`Record<string, string>`) | FE `PrescriptionSummarySection.tsx` |
| **Print shows `additionalInformation` as a flat "key - value" list** ("Extra Diagnosis Details"), in all 6 templates | BE `htmltamplates/report_card1–6.ts` |
| Specialty detection is an exact name (`dentist`; ob-gyn set) — sub-specialties miss | FE `helpers/dentalChart.ts`, `helpers/ovaryDiagram.ts` |
| Tests are picked from the clinic's **lab test catalog** (by id), not from the Rx config | FE `pages/appointment/AppointmentDetails.tsx` (`rxTests`) |
| Medicine forms are free text with a suggestion list; instruction phrases are per form | FE `editor/constants.ts`, BE `doctor/utils/instructionSuggestionDefaults.ts` |
| Instruction phrases go to **every** specialty for **all** forms, on purpose (decided 2026-10-28): any doctor can prescribe any form (a dentist's syrup). Don't narrow by specialty. Everything else in doctor preferences is per specialty | BE `doctor.service.ts` `getDoctorPreferences` |
| Medicine panel always shows | FE `PrescriptionSummarySection.tsx` |

## 2. Build steps (one approval each, in this order)

| Step | What | Specialties | Repo | Size |
|---|---|---|---|---|
| **A** | ~~Specialty match helper~~ — **not needed** (checked 2026-10-24): `doctor.speciality` is always saved as the catalog main (BE `specialitySchema`), so sub-specialties already match. New cards just key on the main name — folded into F / G / H. Only risk: old rows saved before the catalog rule — question 5 | — | — | none |
| **B** | **Rx config data batch** — B1 (15 new blocks) + B2 (existing-block changes + merge / delete); B1 was built then **undone 2026-10-24** — rebuild after the execution plan is approved — — 15 new blocks + list / section changes for 10 + merge the 8 unused sub blocks (and `Family Medicine`) into their mains, then delete them | see §3 | BE | data only |
| **C** | 🟡 **C1, C2, C4 built 2026-10-26; **C3 built 2026-10-27** — respiratoryRate (/min, 8–60) in Vitals: drawer, chips, preview, all 6 layouts + quick print + template editor; no migration (vitals are JSON). Chest / Emergency tab RR fields retired (hidden, old visits still save and print).** Small data adds — Dietitian + Anesthesiologist booking symptoms; Ayurvedic + homeopathic + inhaler (Inhaler, Rotacap, Respules, Nebuliser solution) medicine forms; instruction phrases (eye side, Ayurvedic anupana, homeopathy rules, insulin units, methotrexate once-a-week); **respiratory rate added to Vitals** (small code) | Dietitian, Ayurveda, Homeopathy, Eye, Endocrine, Pulmo, Rheum | FE + BE | data only |
| **D** | **Print for cards** — each card under its own heading with readable labels, only filled rows, private keys skipped — in **all 3 print paths** (§8.1) | all cards | BE `report_card1–6` + `quick-print-templates` + FE `PrescriptionPdf.tsx` | medium-large — **must land before any new card** |
| **E** | ✅ **Built 2026-10-26.** Hide medicine panel + prescription completes with no medicines (no prompt) + ℞ prints only when there are medicines (all specialties). Backend flag `prescribes_medicines: false` in the 4 specialty files | Physio, Psychologist, Speech, Dietitian | FE (+ BE print default) | small |
| **F** | 🟡 **F1 built 2026-10-26** (engine + ENT + Eye) · **F2 batch 1 built** (Vascular, Cardiac, Gastro, Chest incl. respiratory rate, Geriatric; data only) · **F2 batch 2 built** (Kidney + Dialysis + Transplant, Oncology, Rheum Activity + Safety + Gout, Pregnancy + Gyn, Fertility Cycle; new date cell and autos: eGFR CKD-EPI 2021 + stage, BSA Mosteller from Vitals, DAS28-ESR + activity, EDD + weeks pregnant, cycle day; follicle tracking waits for G) · **F2 batch 3 built** (Ayurveda, Homeopathy Case, Emergency, PAC + Pain, Blood, Allergy Scores, Neuro Right / Left, Child; new multi-pick and time cells, notes print beside their field; skin-prick rows wait for G, vaccines given today for K) · **F3 built 2026-10-27** (GP Chronic Care, shared by the Endocrinologist, + Endocrine tab; always shown as a tab, no auto-show) · ear-drum diagram moved to a later item; Audiologist not in the catalog, not needed ( drawer tabs, not pad sections; backend checks keys on save). **Exam-grid component** (Right / Left + single rows), then configs one by one: Eye → ENT (+ hearing rows) → Vascular → Ayurveda → Homeopathy case card → GP / Endocrine chronic-care card → Cardiac card → Gastro card → Chest card → Geriatric assessment card → Emergency card → PAC + pain card → Oncology card (BSA auto) → Kidney card (eGFR auto) → Rheum card (DAS28 auto) → Blood card → Allergy scores → Neuro card → Child card → Fertility cycle card (cycle day auto) → Antenatal + gyn card (EDD auto) | 22 (+ Audiologist) | FE | medium, then small each |
| **G** | ✅ **Built 2026-10-27** — addable rows (numbered slots, Remove moves rows up, print labels a row by its first field), pick-or-type cell, skin-prick result auto; Joints, Urology, Lesions, Physio Assessment + Exercises, Speech Assessment + Practice, Skin Prick, Follicles. Follicle rows from earlier visits come in through Copy From Last Visit. **Rows table component** ("+ Add" rows), then configs: Ortho joints → Urology stones + prostate → Derm lesions → Physio assessment + exercises → Speech assessment + practice → Skin-prick test rows → Follicle tracking rows | 7 | FE | medium, then small each |
| **H** | 🟡 **H1 built 2026-10-27** (tooth status: 10 statuses, one colour each, saved as ToothStatus-XX beside the note, prints "Tooth 36: Decayed · Deep caries") · **H2 built 2026-10-27** (Diet: Measurements tab with waist–hip ratio auto + Meal Plan tab, 7 meals + Extra, pick-or-type foods, Avoid, Supplements; prints "Breakfast: Vegetable poha · 1 bowl"; copy last chart = Copy From Last Visit) · **H3 built 2026-10-27** (Session tab for Psychologist, shared with Psychiatrist + Mental Status tab; new never-print cells, only Homework prints; private values removed for everyone but Doctor / Admin in appointment details, report card and patient-portal reads; red High Self-Harm Risk banner on the prescription screen). **H complete.** Unique cards: Dental tooth status on the existing chart → Diet card (measurements, meal plan, copy last chart) → Psychology session card (private print, High-risk banner; + psychiatry rows) | Dentist, Dietitian, Psychologist, Psychiatrist | FE (+ BE for banner) | medium each |
| **CF** | ✅ **Built 2026-10-27** — **Copy From Last Visit**: one button per exam tab and in History; the same doctor's previous prescription for this patient in this clinic (today excluded); fills empty fields only, addable rows go above today's, autos recalculate; one read route, fetched only on press; no migration | All with exam tabs | BE + FE | small |
| **J** | ✅ **Built 2026-10-26** (profile tags read-only; History block → `comorbidities`, printed in every layout; carry-forward built 2026-10-27 — see below). **Patient profile in the Rx** — blood group, allergies, chronic conditions + linked carer / parent / spouse as chips in the context bar; add a condition or a confirmed allergy (e.g. from a skin-prick test) from the Rx; extra options (Blood thinners, Pregnancy (with EDD) — shown as a "Pregnant — check medicine safety" chip in every Rx, IUD in place (remove-by date), Bisphosphonates, Bleeding disorder, Pacemaker, Stent, Bypass surgery, Valve replacement, Stroke, TB) | all (GP, Dentist, Surgeon first) | FE (+ BE profile update) | small-medium |
| **K** | 🟡 **Built 2026-10-27, migration pending** — patient_vaccines table (per clinic); "Vaccines given today" picks in Child (IAP), GP Chronic Care (adult) and Gyn Pregnancy (TT) write dose rows inside the prescription save (dose no. counted, re-save replaces the visit's rows, never copied by Copy From Last Visit); Vaccines tab on the patient page (Doctor / Admin / Nurse add a past dose or remove; reception views); Last Vaccine in the patient bar. **K2 built 2026-10-27** — next-due doses from a simplified IAP 2023 schedule (children with a date of birth; next dose per vaccine, due or overdue within 60 days), Due list with Mark Given on the Vaccines tab, Next Vaccine in the patient bar; worked out on request, no table. **Patient vaccine record** — one row per dose (vaccine, dose no., date, given by, batch); list on the patient + "Last vaccine" in the Rx context bar; "Given today" from the child card writes to it | Pediatrician (+ GP adult vaccines, Gyn TT) | BE (new table — **migration**) + FE | medium — **decided** (`pediatrician.md` §9) |
| **I** | 🟡 **Checked 2026-10-27:** tests and imaging share one catalog (test_catalog: global seed + clinic-added, name + category); no new feature needed. **I1 built** — 50 missing global tests added to the seed (eye, ENT, thyroid, gyn scans, tumour markers, Doppler, derm, drug levels…), 96 → 146; no migration, seed run per environment. **I2 built** — common_tests per specialty (31 of 33; psychologist and speech therapist have none), returned as commonTests with the preferences; Add Test shows "Common For Your Specialty" chips, no extra request. **I complete.** Specialty tests / imaging — investigate the lab test catalog first (can a clinic add OCT, X-ray, Doppler? per specialty?), then plan | Dentist, Eye, Surgeon, Ortho, ENT, Urology, Derm, Vascular, Dietitian | BE + FE | unknown until checked |

Psychology card (H) also needs the patient-history privacy change (2026-10-22) committed first.

**Design rules for F / G / H (decided 2026-10-24, from the Eka Care pad review):**
- Specialty tables are **sections in the pad** — listed in the specialty's `header_order` like Vitals or Diagnosis, so a doctor reorders or hides them in Prescription Preference. Not a separate card under the medicines.
- Inputs: **text with example hints** for values (6/6, −1.5, 20 dB), **dropdowns** for findings (Intact / Perforated).
- The section config (rows, columns, labels, limits) lives in the **backend**, served with doctor preferences, so screen and print use the same labels.
- **Super Admin preview (added 2026-10-24):** each new section or diagram also shows read-only on Super Admin → Configuration → Speciality Defaults → Prescription (FE `superadmin/configuration/components/SpecialtyPrescriptionTab.tsx`). Today only the tooth chart and ovary diagram preview there; new lists from step B appear by themselves.
- Worked examples: `ent-specialist.md` §4 (Ear Exam, Hearing, Nose & Throat) and `ophthalmologist.md` §4 (Visual Acuity, Subjective / Auto Refraction, Eye Exam).

## 3. Step B detail — Rx config changes per specialty

**Progress (2026-10-26):** batch 1 built — Physiotherapist, Dietitian / Nutritionist, Ayurvedic Doctor, Homeopathic Doctor, Emergency Medicine Specialist. Batch 2 built — Speech Therapist, Vascular Specialist, Anesthesiologist, Rheumatologist, Nephrologist. One file each in `src/utils/specialties/`. Changes vs the files: Dietitian got a diet list (needs a dietitian's check); blanks removed from advice ("Get the blood test as advised", "Limit fluids as advised"). Batch 3 built — Endocrinologist (Diabetologist lists + thyroid / PCOS / bone adds), Oncologist, Geriatrician, Hematologist, Immunologist (no diet list in its file, left empty). **All 15 new blocks done; every catalog main has its own lists.** Part 2a built — Ophthalmologist, General Surgeon, Orthopedic Doctor, Plastic Surgeon start with complaints; diagnosis / advice adds for Ortho, ENT, Plastic, Urology, Surgeon (exam sections join the order in F; tests in I). Part 2b built — Derm, Psychologist (6 sections only), Psychiatrist (+ rTMS, ECT kept; reordered), GP, Pediatrician, Neurologist (reordered). Changes vs the files: Pediatrician "Next vaccine is due on ___" → "Bring the vaccine card to every visit" (due dates come with step K); Neurologist NCS / EEG left out of procedures — they are tests (step I). Part 2c built — Gynecologist, Fertility (reordered), Pulmonologist (reordered), Gastroenterologist (reordered), Cardiologist. Changes vs the files: four blanks replaced ("Come for the next scan on the date given", "Remove the IUD by the date on your card", "Come for the scan on the cycle day advised", "Take the trigger injection at the exact time given"). **All list edits done.** Cleanup done — the 10 unused sub-specialty blocks (General Practitioner, Family Medicine → GP; Obstetrician → Gyn; Orthopedic Surgeon → Ortho; Interventional Cardiologist, Cardiothoracic Surgeon → Cardiology; Andrologist → Urology; Chest Specialist → Pulmonology; Cosmetologist → Derm; Diabetologist → Endocrinology) were merged into their mains and deleted. Skipped on merge: duplicates (Androgenic alopecia, Leukoderma, pregnancy complaints already added in 2c, Gestational hypertension = PIH), lung items for Cardiology, procedures for Endocrinology (no Surgery section). **Step B complete: 33 specialty files, one per catalog main.**

| Specialty | Change | From file |
|---|---|---|
| Vascular Specialist | **New block** | `vascular-specialist.md` §5 |
| Physiotherapist | **New block** (no Surgery / Diet / Pathology) | `physiotherapist.md` §5 |
| Speech Therapist | **New block** (6 sections) | `speech-therapist.md` §5 |
| Dietitian / Nutritionist | **New block** | `dietitian-nutritionist.md` §5 |
| Ayurvedic Doctor | **New block** (both names) | `ayurvedic-doctor.md` §5 |
| Homeopathic Doctor | **New block** (no Surgery Suggested) | `homeopathic-doctor.md` §4 |
| Ophthalmologist | Section reorder | `ophthalmologist.md` G5 |
| General Surgeon | Reorder + diagnosis adds | `general-surgeon.md` §5 |
| Orthopedic Doctor | Diagnosis + advice adds, reorder (`Orthopedic Surgeon` block is never used) | `orthopedic-doctor.md` §5 |
| ENT Specialist | Diagnosis + advice adds | `ent-specialist.md` §5 |
| Plastic Surgeon | Reorder + diagnosis + advice adds | `plastic-surgeon.md` §5 |
| Urologist | Diagnosis + advice adds, incl. male-health (`Andrologist` block is never used) | `urologist.md` §5 |
| Dermatologist | Diagnosis + advice adds | `dermatologist.md` §5 |
| Psychologist | 6 sections only, diagnosis + advice adds | `psychologist.md` §5 |
| General Physician | Pre-diagnosis, diagnosis, advice adds | `general-physician.md` §4 |
| Gynecologist | Complaint, diagnosis, procedure, advice, diet adds + merge `Obstetrician` | `gynecologist.md` §4 |
| Fertility Specialist | Reorder + complaint, diagnosis, procedure, advice adds | `fertility-specialist.md` §4 |
| Pediatrician | Complaint, diagnosis, advice, diet adds | `pediatrician.md` §4 |
| Neurologist | Reorder + complaint, diagnosis, procedure, advice adds | `neurologist.md` §4 |
| Immunologist | **New block** | `immunologist.md` §4 |
| Hematologist | **New block** | `hematologist.md` §4 |
| Rheumatologist | **New block** | `rheumatologist.md` §4 |
| Nephrologist | **New block** | `nephrologist.md` §4 |
| Oncologist | **New block** | `oncologist.md` §4 |
| Anesthesiologist | **New block** | `anesthesiologist.md` §4 |
| Emergency Medicine Specialist | **New block** | `emergency-medicine.md` §4 |
| Psychiatrist | Reorder + complaint, diagnosis, procedure, advice adds | `psychiatrist.md` §4 |
| Geriatrician | **New block** | `geriatrician.md` §4 |
| Pulmonologist | Reorder + complaint, diagnosis, advice adds + merge `Chest Specialist` | `pulmonologist.md` §4 |
| Gastroenterologist | Reorder + complaint, diagnosis, procedure, advice adds | `gastroenterologist.md` §4 |
| Cardiologist | Diagnosis, complaint, surgery, advice adds + merge `Interventional Cardiologist` / `Cardiothoracic Surgeon` | `cardiologist.md` §4 |
| Endocrinologist | **New block** (from `Diabetologist` + thyroid / PCOS / bone); then `Diabetologist` merged + deleted | `endocrinologist.md` §4 |
| Dentist | X-ray list → step I; Medical History → step J (patient profile already has chronic conditions) | `dentist.md` G2, G3 |

Test-list additions written in the files ("Tests:") are **not** part of B — they go to step I.

## 4. Deferred to the treatment-plan phase

Config rows, all templates, seed fixes (`taxable`, `instalmentsAllowed`, config-row seed),
Super Admin template edits / activation, missed-step cron + reminder (marked "build early" in
`urologist.md` — first item of that phase), Rx → plan link.

## 5. Shared features, later (own plans)

Before / after photo compare (gallery exists, §8.4) · Body map (Derm first) · Online / video sessions ·
Discharge summary · More certificate types (§8.2) · Prescription on WhatsApp + patient portal (§8.5) ·
Tapering dose · Weight / vitals trend chart · Plan step by another doctor · GST applied ·
Voice-to-prescription (Eka "EkaScribe") · AI assist in the pad · Push updates to the patient (Eka review 2026-10-24).
~~OPD procedure billing~~ — exists as clinic services per appointment (§8.4).

## 6. Checklist per step (tick in browser)

**A** — (dropped) — the first card build checks: Dentist sub sees the dental chart · Fertility Specialist sees the ovary diagram · GP sees neither
**B** — [ ] Each of the 5 new specialties sees its own lists, not GP ones · [ ] Doctor's own suggestions stay on top · [ ] A doctor with a saved section order keeps it · [ ] Super Admin "Specialty" config tab shows the new blocks
**C** — [ ] Booking a dietitian shows symptoms · [ ] "Churna" in form picker, offers "Take with warm water" · [ ] Eye drops offer Right / Left / Both eyes
**D** — [ ] Dental notes still print (old prescriptions) · [ ] A card prints under its heading with labels, not raw keys · [ ] Private keys never print · [ ] All 6 report templates, all quick-print layouts and the patient-page PDF match
**E** — [ ] No "Add medicine" for the 4 · [ ] Their prescription completes and prints with no medicines · [ ] Every other specialty unchanged
**F / G / H** — use each specialty file's §7 card checklist · [ ] Super Admin Speciality Defaults → Prescription shows the new section / diagram read-only
**J** — [ ] Context bar shows blood group, allergies, chronic conditions · [ ] Adding a condition from the Rx saves to the profile · [ ] Receptionist view unchanged
**I** — [ ] Findings written up; plan approved before code

## 7. Questions

1. Order A → I OK, or a specific specialty's card first (sales priority)?
2. Step D (print) before any card — agreed? Without it new cards print raw keys and psychology risk would print.
3. ~~Dentist Medical History into step I~~ — resolved: Medical History is the patient profile (step J); X-ray stays in I.
4. Print paths (§8.1): fix all three in D, or retire one? (suggest: fix all three — each is in use)
5. Old doctor rows saved before the catalog rule may hold a non-catalog `speciality` (e.g. "Orthodontist") — run a read-only count on the dev DB before step B? (needs your OK)

## 8. Doctor output check (2026-10-24) — what the doctor gives the patient

Same for every specialty, so checked once here.

### 8.1 Printed prescription — **3 separate print paths**

| Path | Where | Specialty data (`additionalInformation`) |
|---|---|---|
| Report templates 1–6 | BE `htmltamplates/report_card1–6.ts` | Flat "key - value" list, "Extra Diagnosis Details" |
| Quick-print layouts (clinic-branded, compact slip, detailed, minimal, pharmacy copy, standard sheet) | BE `quick-print-templates/templates/` | **Not printed at all** — dental chart missing today |
| Patient-page PDF | FE `pages/patient/PrescriptionPdf.tsx` (react-pdf) | **Not printed at all** |

- Print sections are per-doctor toggles (`reports/services/prescriptionSection.service.ts`), one toggle "Additional information" for all card data — no per-card or private control.
- Medicine table toggle is locked on, but an empty list prints no table — OK for physio / psych / speech / diet.
- **℞ symbol still prints** with no medicines (own toggle) → step E sets it off by default for those 4.
- Treatment plan block prints in all 6 report templates (shared `htmltamplates/treatmentPlan.ts`) — OK.

### 8.2 Certificates, letters, consent

| Output | Today | Gap |
|---|---|---|
| Medical certificate | Exists — condition, rest days, notes; prints | Only sick-leave type. No fitness / fit-for-surgery / return-to-work / sports / school certificate (Surgeon, Ortho, Physio, Pediatrician) |
| Referral letter | Exists — referred doctor, clinic, address, phone, note; prints | OK |
| Consent | Exists — note + file on the visit, prints; plan consent on accept | Generic only; no per-procedure consent text (surgical specialties) — later |

### 8.3 Follow-up

Follow-Up (days) feeds a **reception call list** (`appointments/services/followUp.service.ts`): doctor-set dates + plan
follow-ups, call log, dismiss. Works for every specialty. No auto-booking — fine as is.
To check in the plan phase: does an overdue plan step appear here? If yes, it partly covers the missed DJ stent alarm.

### 8.4 Already exists — earlier "gaps" corrected

| Earlier gap | What exists | Real gap left |
|---|---|---|
| OPD procedure billing (ENT wax removal, dressings) | Clinic services per appointment, with price (`appointmentMultipleService` → clinic service catalog) | Only preset services per specialty (data), if wanted |
| Specialty teaching images (all) | **231 default images for 23 specialties** in the public bucket (`assets/doctor-images/<specialty-slug>/<file>.png`), listed in `utils/referenceImages.ts`, shown under Suggested Images in the doctor gallery and **shareable with the patient**; a doctor with no specialty gets General Physician's set, a specialty without a set gets none. Super Admin sees them in Configuration → Speciality Defaults → Images | No set yet for Gynecologist, Neurologist, Pediatrician, Oncologist and 6 more; an ENT ear-anatomy set could sit next to the Ear Exam section |
| No photos (Plastic, Derm, Dentist) | Patient gallery per appointment: doctor upload, description, **share with patient** (`patientGallery`, FE `components/appointment/gallery/`) | Before / after side-by-side across visits; link from a plan step |

### 8.5 What the patient receives

| Channel | Today | Gap |
|---|---|---|
| WhatsApp / SMS on completion | "Thank you! Your appointment is completed. Visit again." — **no prescription** | Send the Rx (PDF link) — needs signed links once the bucket is private (memory: WhatsApp invoice cutover) |
| Patient web portal "Reports" | **Hard-coded sample data** (`pages/report/PatientReport.tsx`) | Real prescription / report list for the patient |
| Patient appointment page | Gallery images shared by the doctor | Prescription not shown |
| Mobile app | Not checked (outside these repos) | — |

## 9. Data model (decided 2026-10-26)

Checked against BACKEND_STANDARDS §7 (database) and §9 (tenancy). Only these change:

| Table | Column | Change | Step |
|---|---|---|---|
| `report_cards` | `comorbidities` (text[]) | start using — exists, no input today | J |
| `report_cards` | `generalExamination` (text[]), `systemExamination` (text) | start using for simple exams — exist, no input today | F |
| `report_cards` | `additionalInformation` (jsonb) | new keys only, e.g. `ear.right.canal` | F, G, H |
| `patient_vaccines` | id, patientId, clinicId, vaccine, doseNo, givenOn, givenBy, batch, createdAt | **new table** — migration by the owner | K |
| `doctor_preferences` | `hiddenSections` | optional, only if hiding a chart is wanted | later |

**Rules**
1. **Nothing new on `user_profiles`** — it has no `clinicId`, so every clinic sees it. Pregnancy, IUD, stent, blood thinners go in the visit's `comorbidities` with their date (e.g. "Pregnant (EDD 14 Mar 2027)"); the next prescription in the same clinic shows them. Step J only *reads* `bloodGroup`, `allergies`, `chronicConditions`.
2. **`additionalInformation` values stay flat strings** (its type is `Record<string, string>`).
3. **Never rename a section key — only add.** Old keys keep a label in the section definition so old visits still print.
4. **The backend checks `additionalInformation` on save** (known keys for the doctor's specialty, length cap) — built with the first new sections (step F).
5. **`patient_vaccines`**: FKs to users / clinics, index on (patientId, clinicId), every read filtered by the logged-in clinic, "given today" from the child card saved with the prescription in one transaction. Cross-clinic visibility is an open question.
6. **Print (G4 / D)** also prints `comorbidities`, `generalExamination`, `systemExamination` — saved today but never printed.

