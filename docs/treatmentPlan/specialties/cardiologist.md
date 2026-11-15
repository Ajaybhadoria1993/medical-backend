# Cardiologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 18). Clinical values need a cardiologist's check.
Covers sub-specialties: Interventional Cardiologist, Cardiac Electrophysiologist, Pediatric Cardiologist, Cardiothoracic Surgeon (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** cardiac card must print in all 3 paths → D; ECG in clinic is billable as a clinic service (exists).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Cardiologist` block — Vitals first; HTN, CAD, angina, AF, HFrEF / HFpEF; chest pain, breathlessness, palpitations, swelling, fainting; angioplasty, bypass, pacemaker, valve; salt / smoking advice | BE `utils/doctorSpecialtyConfig.ts` |
| Sub blocks | `Interventional Cardiologist`, `Cardiothoracic Surgeon` — **never used** (main wins); to be merged + deleted (GP decision §9) | same |
| Vitals | BP, pulse, SpO2, weight, BMI | FE `prescription/details/constants.ts` |
| Patient profile | Chronic conditions incl. Heart Disease, Hypertension — not shown in the Rx yet (step J) | `userProfile.model.ts` |
| Booking symptoms | Chest pain, breathlessness, high BP, leg swelling, palpitations, dizziness, fatigue, arm / jaw pain, past heart attack, cholesterol | FE `constants/specialitySymptoms.ts` |
| Card on the Rx | None | — |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No cardiac record** — ECG, LVEF, NYHA class, LDL, INR, devices | Every cardiac visit compares these | Cardiac card (§3), single-column exam grid | F |
| G2 | **Stent / pacemaker / bypass not on the patient** | Dentist, surgeon, any doctor must know | Profile chronic-condition options: Stent, Bypass surgery, Pacemaker, Valve replacement (step J) | J |
| G3 | Diagnosis list misses common cases | Dyslipidemia, valve disease, post-MI, post-PCI, cardiomyopathy, RHD, SVT, syncope | Adds (§4) + merge of the 2 unused sub blocks | B |
| G4 | Cardiac tests (ECG, Echo, TMT, Holter, troponin, BNP, lipid, angiography) | Lab catalog, not config | Step I | I |
| G5 | BP / weight trend (heart failure) | Weight gain = fluid build-up | Shared, later (decided) | — |
| G6 | INR record | Warfarin patients | Card row now; INR review plan later | F |

### 3. Cardiac card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).

| Row | Input |
|---|---|
| ECG | pick: Normal, Sinus tachycardia, ST-T changes, AF, LBBB / RBBB, Old MI, Other + short note |
| LVEF (%) | number 10–80 |
| NYHA class | pick: I, II, III, IV |
| Heart sounds | pick: Normal, Murmur, Gallop + short note |
| Leg swelling | pick: None, Mild, Moderate, Severe |
| LDL (mg/dL), last | number 20–300 |
| INR, last | number 0.5–6 |
| Device / stent | short note, e.g. "DES to LAD, Mar 2025" |

Only filled rows print. BP / pulse come from Vitals, not asked again.

### 4. Prescription config

**`Cardiologist` block — adds** (plus useful items from the 2 unused sub blocks during the merge):
- **Diagnosis add:** Dyslipidemia, Mitral regurgitation, Aortic stenosis, Post-MI, Post-angioplasty, Dilated cardiomyopathy, Rheumatic heart disease, SVT, Syncope, Congenital heart disease
- **Pre-Diagnosis add:** Breathless on lying flat, Night breathlessness, Reduced walking distance
- **Surgery add:** CABG, PTCA with stent, ICD implantation, TAVI
- **Advice add:** Weigh yourself daily; call if weight rises 2 kg in 3 days, Keep sorbitrate under the tongue for chest pain and come to hospital, Do not stop blood thinners without asking, Carry your stent / device card
- Section order: keep.

**Patient profile options add (step J):** Stent, Bypass surgery, Pacemaker, Valve replacement.

### 5. Checklist (tick in browser)

- [ ] New diagnoses, complaints, surgeries, advice appear for Cardiologist + all 4 subs (B)
- [ ] Interventional Cardiologist / Cardiothoracic Surgeon lose nothing after their blocks are merged + deleted (B)
- [ ] Profile shows Stent / Pacemaker; a Dentist sees it in their Rx (J)
- [ ] Cardiac card: LVEF 10–80, INR 0.5–6, NYHA picks save and reload (F)
- [ ] Card prints under its heading, only filled rows (D)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `cardio.post_angioplasty` | Post-angioplasty follow-up | **staged — works today** | Discharge review → 1 week (+7d) → 1 month (+23d) → 3 months (+60d) → 6 months (+90d) | angioplasty, PCI, stent |
| `cardio.cardiac_rehab` | Cardiac rehab — 12 sessions | package, 12 × 3d, expiry 60d | — | cardiac rehab, post-MI |
| `cardio.heart_failure_review` | Heart failure review | **review**, every 30d | Weight + swelling each visit | heart failure |
| `cardio.inr_review` | Warfarin INR review | **review**, every 14–28d | INR each visit | warfarin, AF, valve |
| `cardio.device_check` | Pacemaker / device check | **review**, every 180d | — | pacemaker, ICD |

### 7. Plan config row

**Plan fields:** `condition` (CAD, Post-PCI, Heart failure, AF, Valve, Device, Other), `procedure_date` (date).
**Step fields:** `bp` (text), `weight_kg`, `lvef`, `inr` (numbers), `nyha` (select I–IV).

### 8. Plan checklist

- [ ] Post-angioplasty + rehab work on today's engine; review templates wait for `review`
- [ ] Weight / INR per visit show on plan detail

## 9. Decisions (2026-10-24)

1. Cardiac card = **single-column rows on the shared exam grid**.
2. Stent / Pacemaker / Bypass / Valve = **patient-profile conditions** every doctor sees (step J).
3. ECG = **pick + note**; ECG images go in the visit gallery (exists).
4. Pediatric Cardiologist **uses the same block**; kids items later with Pediatrician.
5. **Section order unchanged** (Vitals first).
