# Treatment Plan — Specialty Rollout Research

Status: **research only — nothing built from this doc.** Each wave needs approval before code.
Authority order: workspace-root `treatment_plan/CLAUDE.md` → build plan → this doc.
Code lives in `src/main/treatmentPlan/`. Per-specialty plans + tracker: `specialties/README.md`.

## 1. What already exists

| Piece | Where | What it gives a specialty |
|---|---|---|
| Plan types | `tp_plan_type`: `staged`, `package` work; `timeline`, `review`, `cycle` reserved, **not built** (schemas accept only staged/package) | the shape of the plan |
| Library templates | `seeds/libraryTemplates.json` → `treatment_templates` (`code`, `specialty`) | ready-made plans, seeded only when missing |
| Extra fields | `treatment_specialty_configs` (`planFields`, `stepFields`, `widget`) | e.g. tooth no., eye side, body part — a row, not code |
| Field types | `text, number, select, multiselect, date, boolean` | enough for every specialty below |
| Clinic override | same config table, `clinic_id` set | clinic can tweak fields over the platform default |

Seeded today: Dentist (3), Dermatologist (4), Gynecologist (1), Ophthalmologist (1), Physiotherapist (1).
Missing: the other 28 specialties.

**Rule kept:** a new specialty = JSON templates + one config row. Code only when a `widget` is
needed, or when it needs a plan type not built yet (review / cycle / timeline — see §4).

## 2. Applying clinic details (who sees which templates)

Sync key = the **main specialty string** from `src/utils/specialtyCatalog.ts` (same 33 names).

1. **Doctor's specialties** (`specialization[]`: main + sub + also-practises) → template picker
   shows those specialties first.
2. **Clinic specialties** = union of all its doctors' mains → Treatment Plan list filter, library
   browser, and which `treatment_specialty_configs` rows load.
3. **Custom templates** are always visible to their clinic, any specialty.
4. **Generic 4** (multi-step, session package, periodic review, custom) — every clinic, always.
5. Template `specialty` must be a catalog main — validate on write (same rule as doctor profile).

Open: should a doctor *without* the specialty be able to use another specialty's template?
Recommend **yes, shown under "Other specialties"** — clinics share patients across doctors.

## 3. Specialty matrix

Fit: **High** = multi-visit plans are core work · **Med** = some plans · **Low** = generic templates enough.

### Medicine & surgery

| Specialty | Fit | Main types | Starter templates | Plan / step fields |
|---|---|---|---|---|
| Cardiologist | Med | review, staged | Post-angioplasty follow-up (1w/1m/3m/6m), Cardiac rehab 12 sessions | Procedure, stent count, LVEF % |
| General Physician | Low | review | Diabetes review (3-monthly), BP review (monthly) | Condition, target value |
| Emergency Medicine | Low | staged | Wound dressing series | Wound site |
| Anesthesiologist | Low | package | Pain block series | Block type, side |
| General Surgeon | High | staged | Hernia repair, Lap cholecystectomy, Abscess I&D + dressings | Procedure, side, pre-op tests |
| ENT Specialist | Med | staged, review | Tonsillectomy, Septoplasty, Ear wash series | Ear/side (L/R/Both) |
| Orthopedic Doctor | High | staged, timeline | Fracture care (cast → X-ray → removal), Knee replacement + rehab | Body part, side, implant |
| Rheumatologist | Med | cycle, review | Biologic infusion cycle, DMARD monitoring | Drug, cycle no., lab due |
| Urologist | Med | staged | Stone (ESWL sessions), TURP | Stone size mm, side |
| Vascular Specialist | Med | staged, package | Varicose laser, Compression + review | Limb, side |
| Endocrinologist | Med | review | Thyroid review, Insulin titration | HbA1c / TSH target |
| Gastroenterologist | Med | staged, review | Endoscopy + biopsy follow-up, H. pylori course + retest | Procedure |
| Pulmonologist | Med | package, review | Pulmonary rehab, TB DOTS review | Condition |
| Oncologist | High | cycle | Chemo cycles (n × 21 days), Radiation fractions | Regimen, cycle no., BSA |
| Hematologist | Med | cycle, review | Iron infusion series, Transfusion schedule | Hb target |
| Immunologist | Med | package | Allergy immunotherapy shots | Allergen, dose |
| Nephrologist | High | package, cycle | Dialysis (3/week), CKD review | Sessions/week, access type |
| Neurologist | Med | review, package | Botox cycle (3-monthly), Epilepsy review | Condition |
| Plastic Surgeon | High | staged | Rhinoplasty, Scar revision, Liposuction | Area, side |

### Skin, women's health, eyes, teeth

| Specialty | Fit | Main types | Starter templates | Plan / step fields |
|---|---|---|---|---|
| Dermatologist | High | package | ✅ seeded 4; add Acne course, Vitiligo phototherapy | Area, skin type, sessions |
| Gynecologist | High | timeline, staged | ✅ Laparoscopy; add **Antenatal care** (visits by week), Post-natal | LMP, EDD, gravida/para |
| Fertility Specialist | High | cycle | IUI cycle, IVF cycle (stim → OPU → ET → beta) | Cycle no., day-of-cycle |
| Ophthalmologist | High | staged, review | ✅ Cataract; add Lasik, Glaucoma review, Anti-VEGF injections | Eye (L/R/Both), lens |
| Dentist | High | staged | ✅ 3 seeded; pack = tooth chart widget, Dental Lab tab | Tooth no. (FDI), surfaces |

### Age groups & mind

| Specialty | Fit | Main types | Starter templates | Plan / step fields |
|---|---|---|---|---|
| Pediatrician | High | timeline | **Vaccination schedule** (IAP, by birth date), Growth review | DOB anchor, vaccine |
| Geriatrician | Low | review | Comprehensive review (3-monthly) | — |
| Psychiatrist | Med | review, package | Medication review, rTMS sessions | Condition |
| Psychologist | High | package | Therapy 8/12 sessions (CBT etc.) | Therapy type, mode (online/in-clinic) |

### Therapy & wellness

| Specialty | Fit | Main types | Starter templates | Plan / step fields |
|---|---|---|---|---|
| Physiotherapist | High | package | ✅ seeded; add Post-op rehab, Back pain 10 sessions | Body part, side |
| Speech Therapist | High | package | Speech therapy 12 sessions | Disorder |
| Dietitian / Nutritionist | High | package, review | Weight-loss 3-month program | Weight, target weight, BMI |
| Ayurvedic Doctor | High | package | Panchakarma (7/14/21 days) | Therapy, dosha |
| Homeopathic Doctor | Med | review | Constitutional review (monthly) | Condition |

## 4. Engine gaps found (base, because 2+ specialties need them)

| Gap | Needed by | Note |
|---|---|---|
| **Review type** (repeat visit every N days, open-ended) | GP, Endocrine, Cardio, Homeopathy, Glaucoma, … | enum value only — **must be built** |
| **Repeat count on cycle** (n cycles × gap) | Oncology, Rheumatology, Fertility, Neurology Botox | enum value only — **must be built** |
| **Date-anchored timeline** (step due = anchor + N days) | Pediatrician (DOB), Gynecologist (LMP), Fertility (cycle day 1) | enum value only — **must be built**; templates have no anchor field today |
| **Fixed frequency** (3/week) | Nephrology dialysis, Physio, Ayurveda daily | `package` + `intervalDays: 2` = every other day, not fixed weekdays; OK for now |
| **Side / laterality select** | Ortho, ENT, Eye, Vascular, Plastic, Urology | just a `select` field — no gap, ship as shared field preset |

Specialty-only widgets (specialty layer, later): Dental tooth chart, Antenatal week tracker, Vaccine chart.

## 5. Step-by-step rollout

Each step = approval → build → you check in browser. One wave at a time.

| Step | Scope | Work |
|---|---|---|
| 0 | Sync | Template create already validates `specialty` (`template.schema.ts`); left: custom-plan `specialty` (free text in `plan.schema.ts`) + picker sorts by doctor's specialties (§2) |
| 1 | Wave 1 — staged | Dentist, Ophthalmologist (Cataract, Lasik, Anti-VEGF), General Surgeon, Ortho, ENT, Plastic, Urology, Vascular (laterality preset) |
| 2 | Wave 2 — session packages | Dermatologist, Physiotherapist, Psychologist, Speech Therapist, Dietitian / Nutritionist, Ayurvedic (JSON only) |
| 3 | Engine: review | Build `review` type in base |
| 4 | Wave 3 — review-only | Homeopathic, GP, Endocrine, Cardio, Gastro, Pulmo, Geriatric, Psychiatry, Emergency, Anesthesia; plus Glaucoma review |
| 5 | Engine: cycle | Build `cycle` type (n cycles × gap) in base |
| 6 | Wave 4 — cycles | Oncology, Nephrology, Rheumatology, Hematology, Immunology, Neurology |
| 7 | Engine: timeline | Build `timeline` type with a date anchor (DOB / LMP / cycle day 1) |
| 8 | Wave 5 — timelines | Pediatrician vaccination, Fertility |
| 9 | Wave 6 — Gynecologist (last) | Laparoscopy config + Antenatal, Post-natal (needs timeline) |
| 10 | Widgets | Dental tooth chart pack, then others only if clinics ask |

Simplest first: staged → package → review → cycle → timeline → Gynecologist. Waves 1–2 run on
today's engine; each later wave waits for the engine step before it.

## 6. Questions for you

1. Cross-specialty template use (§2) — show under "Other specialties"? (recommend yes)
2. Who writes clinical defaults (gaps, session counts)? Values above are typical, need a doctor's check.
3. Pediatric vaccine schedule — IAP only, or let clinic edit?
4. Wave order OK, or a specific specialty first (sales priority)?
