# Nephrologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: Dialysis 3 a week = sessions every 2 days.
Parent: `../specialty-rollout-research.md` (Wave 4, specialty 27). Clinical values need a nephrologist's check.
Covers: no sub-specialties; also practises General Physician (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** dialysis sessions billable as clinic services (exists); kidney card must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` |
| Vitals | BP, weight, pulse | FE `prescription/details/constants.ts` |
| Patient age / gender | On the patient — enough to calculate eGFR from creatinine | patient profile |
| Booking symptoms | Foamy urine, swelling, hard-to-control BP, less urine, blood in urine, metallic taste, fatigue, cramps, itching, high creatinine | FE `constants/specialitySymptoms.ts` |
| Related plans | AV fistula (Vascular), Kidney diet (Dietitian) — planned | `vascular-specialist.md`, `dietitian-nutritionist.md` |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Generic lists | New block (§4) | B |
| G2 | **No kidney record** — creatinine, eGFR, CKD stage, urine protein, potassium | Every kidney visit compares these | Kidney card (§3) | F |
| G3 | **eGFR is worked out by hand** | Stage and drug doses depend on it | Card calculates eGFR (CKD-EPI 2021) from creatinine + patient age + gender, and the stage from eGFR | F |
| G4 | **No dialysis record** — access, dry weight, weight gain between sessions | Each dialysis day | Dialysis rows in the same card | F |
| G5 | Kidney tests (creatinine, urea, electrolytes, urine ACR, USG KUB, PTH) | Lab catalog | Step I | I |
| G6 | Dialysis 3 a week | Package repeats every N days, not set weekdays | Every 2 days is close (known limit) | — |

### 3. Kidney card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).

| Group | Row | Input |
|---|---|---|
| Kidney | Creatinine (mg/dL) | number 0.2–20 |
| | eGFR (mL/min/1.73m²) | **auto** — CKD-EPI 2021 from creatinine + age + gender; read-only |
| | CKD stage | **auto** from eGFR: G1, G2, G3a, G3b, G4, G5 |
| | Urine protein | pick: Nil, Trace, 1+, 2+, 3+ — or ACR text |
| | Potassium (mmol/L) | number 2–9 |
| | Hb (g/dL) | number 3–20 |
| | Swelling | pick: None, Feet, Up to knees, Whole body |
| Dialysis | Access | pick: AV fistula, Graft, Catheter, None |
| | Dry weight (kg) | number 20–200 |
| | Weight gain between sessions (kg) | number 0–10 |
| Transplant | Tacrolimus level | text |

Only filled rows print.

### 4. Prescription config

**New block `Nephrologist`:**
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Allergy → Habits → Pathology Test → Dietary Suggestions → Advice → Surgery Suggested → Visiting Days → Follow-Up
- **Habits:** Painkiller use, Smoking, High salt intake, Low water intake, Herbal / unknown medicines
- **Allergy:** Drug allergy, Contrast dye allergy, Iron injection reaction
- **Pre-Diagnosis:** Swelling, Foamy urine, Less urine, Blood in urine, Breathlessness, Itching, Vomiting, Cramps
- **Diagnosis:** CKD stage 3, CKD stage 4, CKD stage 5 (on dialysis), Diabetic kidney disease, Hypertensive kidney disease, Nephrotic syndrome, Acute kidney injury, Glomerulonephritis, Polycystic kidney disease, Kidney transplant recipient, Anaemia of CKD, Hyperkalaemia
- **Surgery Suggested (procedures):** Haemodialysis, AV fistula creation, Kidney biopsy, Dialysis catheter insertion, Kidney transplant work-up
- **Advice:** Do not take painkillers like ibuprofen or diclofenac, Weigh yourself every morning, Limit fluids to ___ litres a day, Protect the fistula arm — no BP cuff or blood test on it, Bring the dialysis record to every visit
- **Diet:** Low salt, Limit high-potassium fruits (banana, coconut water), Protein as advised, Avoid star fruit

### 5. Checklist (tick in browser)

- [ ] Nephrologist sees kidney lists (B)
- [ ] eGFR + stage calculate from creatinine; match a CKD-EPI 2021 calculator for 3 test patients (F)
- [ ] eGFR stays empty if age or gender is missing (F)
- [ ] Dialysis rows save; only filled rows print (D + F)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `nephro.haemodialysis` | Haemodialysis — monthly block | package, 13 × 2d, expiry 35d | ~3 a week | dialysis, ESRD |
| `nephro.ckd_review` | CKD review | **review**, every 90d (60d at stage 4–5) | Creatinine + eGFR each visit | CKD |
| `nephro.transplant_followup` | Kidney transplant follow-up | **staged — works today** | Weekly × 4 (+7d each) → Monthly × 3 (+30d each) | kidney transplant |
| `nephro.nephrotic_steroid` | Nephrotic syndrome steroid course | **staged — works today** | Start → Review (+14d) → Review (+28d) → Taper review (+28d) | nephrotic syndrome |

AV fistula → Vascular template; kidney diet → Dietitian template (both under "Other specialties").

### 7. Plan config row

**Plan fields:** `ckd_stage` (G1–G5), `on_dialysis` (boolean), `access` (AV fistula, Graft, Catheter).
**Step fields:** `creatinine`, `weight_kg` (numbers).

### 8. Plan checklist

- [ ] Transplant + nephrotic work today; dialysis block works as a package; CKD review waits for `review`

## 9. Decisions (2026-10-24)

1. **Auto-calculate eGFR** (CKD-EPI 2021) + CKD stage from creatinine + age + gender.
2. **Kidney card** with kidney, dialysis, transplant groups.
3. Dialysis = **13-session monthly package** until a weekday schedule exists.
4. AV fistula + kidney diet **stay under Vascular / Dietitian**, shown under "Other specialties".
5. Dialysis unit charting **out of scope**.
