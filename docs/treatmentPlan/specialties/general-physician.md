# General Physician — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: `gp.diabetes_review` skipped: the existing `general.diabetes_review` is the same plan.
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 16). Clinical values need a physician's check.
Covers sub-specialties: General Practitioner, Family Medicine Physician, Internal Medicine, Infectious Disease (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** GP is the main user of the medical certificate (exists, sick-leave only) and of a vitals trend (missing).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Vitals | BP, pulse, SpO2, temp, height, weight, BMI (auto), FBS / PPBS / RBS | FE `prescription/details/constants.ts` |
| Prescription config | Full `General Physician` block (11 sections, all lists) | BE `utils/doctorSpecialtyConfig.ts` |
| Sub-specialty configs | `General Practitioner`, `Chest Specialist`, `Diabetologist` blocks exist but are **never used** for a GP — the picker takes the main first; `Family Medicine` matches no catalog name | same, `configSpecialty` |
| Patient profile | Blood group, allergies, chronic conditions (Diabetes, Hypertension, Asthma, Heart, Thyroid, COPD, Kidney, Liver…) | BE `users/models/userProfile.model.ts`, FE `PatientFormSections.tsx` |
| Profile in the Rx | **Not shown** — the context bar shows only this visit's allergy section | FE `workspace/components/PrescriptionClinicalContextBar.tsx` |
| Booking symptoms | Fever, body ache, cough, chest congestion, headache, stomach upset, BP check, sore throat, dizziness, joint pain | FE `constants/specialitySymptoms.ts` |
| Medical certificate | Exists — condition, rest days, notes | BE `appointments/models/medicalCertificate.model.ts` |
| OPD procedures | Billable as clinic services (injection, nebulisation, dressing, ECG) | `appointmentMultipleService` |
| Follow-up | Reception call list | `appointments/services/followUp.service.ts` |
| Treatment plan | None for GP | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **Patient's chronic conditions / allergies / blood group not shown in the Rx** | GP prescribes around diabetes, BP, kidney, allergies — must see them without leaving the screen | Show profile chips in the context bar; doctor can add a condition from there | **J** (new, shared) |
| G2 | **No chronic-care card** | Diabetes / BP visits need target, control and yearly checks | Chronic-care card (§3), shown when the patient has Diabetes or Hypertension | F |
| G3 | Sub-specialty configs never used | A GP who also practises diabetology still gets GP lists | Question 1 | B |
| G4 | Diagnosis / complaint lists miss common OPD cases | Viral fever, dengue, typhoid, gastroenteritis, GERD, anaemia, Vit D, hypothyroid | Adds (§4) | B |
| G5 | Only a sick-leave certificate | Fitness for job / school / sports / travel is daily GP work | Shared, later (output check §8.2) | — |
| G6 | No BP / sugar / weight trend across visits | Shows if treatment works | Shared, later (decided in Dietitian) | — |

### 3. Chronic-care card — simple

Single-column rows on the shared exam grid. Shows only if the patient's chronic conditions include
Diabetes or Hypertension (or the doctor opens it). Saved in `additionalInformation`.

| Row | Input |
|---|---|
| BP target | pick: < 130/80, < 140/90 |
| BP control | pick: Controlled, Not controlled |
| Last HbA1c (%) | number 4–15 |
| Sugar control | pick: Controlled, Not controlled, Low sugar episodes |
| Eye check this year | pick: Done, Due |
| Foot check | pick: Normal, Numbness, Wound |
| Kidney test (creatinine / urine protein) this year | pick: Done, Due |
| Lifestyle | multi-pick: Diet followed, Exercise, Quit smoking |

Prints under its own heading (step D); only filled rows.

### 4. Prescription config

**`General Physician` block — adds:**
- **Pre-Diagnosis add:** Loose motions, Burning urination, Dizziness, Chest pain, Breathlessness, Weakness, Weight loss
- **Diagnosis add:** Viral fever, Dengue, Typhoid, Acute gastroenteritis, GERD, Anaemia, Vitamin D deficiency, Hypothyroidism, Migraine, Vertigo
- **Advice add:** Check BP at home and note it, Check sugar before breakfast twice a week, Return at once if fever goes above 103°F or you feel breathless
- Section order: keep (already Vitals first).

**Patient profile — chronic condition options add** (shared with Dentist / Surgeon): Blood thinners, Pregnancy, Bleeding disorder, Pacemaker, Stroke, TB.

### 5. Checklist (tick in browser)

- [ ] Rx context bar shows the patient's blood group, allergies, chronic conditions (J)
- [ ] Adding a condition from the Rx saves to the patient profile (J)
- [ ] Chronic-care card appears for a diabetic / hypertensive patient; HbA1c 4–15 validates (F)
- [ ] Card prints under its heading, only filled rows (D)
- [ ] New diagnoses / complaints / advice appear (B)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `gp.diabetes_review` | Diabetes review | **review**, every 90d | Open-ended | diabetes, sugar |
| `gp.bp_review` | BP review | **review**, every 30d | Open-ended | hypertension, BP |
| `gp.thyroid_review` | Thyroid review | **review**, every 180d | Open-ended | hypothyroidism |
| `gp.hep_b_vaccine` | Hepatitis B vaccine (3 doses) | **staged — works today** | Dose 1 → Dose 2 (+30d) → Dose 3 (+150d) | hepatitis B, vaccine |
| `gp.dressing_series` | Wound dressing series | package, 5 × 2d, expiry 20d | — | wound, dressing |

### 7. Plan config row

**Plan fields:** `condition` (Diabetes, Hypertension, Thyroid, Vaccine, Wound, Other), `target` (text, e.g. HbA1c < 7).
**Step fields:** `bp` (text, e.g. 130/80), `sugar_fasting` (number), `hba1c` (number), `weight_kg` (number).

### 8. Plan checklist

- [ ] Review templates wait for the `review` type; Hep B and dressing work on today's engine
- [ ] Step values show per visit on plan detail

## 9. Decisions (2026-10-24)

1. Unused sub-specialty configs: **merge their useful lists into the main block, then delete them** (one list per main). Applies to all 8 + the orphan `Family Medicine`; Diabetologist kept (Endocrinologists use it until Endocrinologist gets its own block).
2. Step J (patient profile chips in the Rx) for **every specialty**.
3. Chronic-care card **auto-shows** for Diabetes / Hypertension patients and **opens on demand** for others.
4. Fitness certificate types = **next shared feature** after the prescription steps.
5. Hep B vaccine **stays in GP** (adults).
