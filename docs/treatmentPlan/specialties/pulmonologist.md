# Pulmonologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 20). Clinical values need a pulmonologist's check.
Covers sub-specialties: Chest Specialist, Sleep Medicine Specialist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** chest card must print in all 3 paths → D; nebulisation in clinic is billable as a clinic service (exists).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Pulmonologist` block — COPD, asthma, pneumonia, bronchitis, emphysema, fibrosis; cough, breathlessness, wheeze, sputum, blood in sputum; bronchoscopy, biopsy, tap, rehab; inhaler-technique advice | BE `utils/doctorSpecialtyConfig.ts` |
| Section order | Diagnosis first, Pre-Diagnosis 6th | same |
| `Chest Specialist` block | Same lists as Pulmonologist; **never used** → merge + delete (GP decision §9) | same |
| Vitals | SpO2, pulse, temp, BP — **no respiratory rate** | FE `prescription/details/constants.ts` |
| Inhaler instructions | Phrases exist for form `inhaler` | BE `doctor/utils/instructionSuggestionDefaults.ts` |
| Medicine form picker | **No Inhaler, Rotacap, Respules** in the suggestion list | FE `editor/constants.ts` |
| Booking symptoms | Breathlessness, cough, wheeze, snoring / gasping, blood in cough, chest pain, dust exposure, fast breathing, sleep apnoea, low oxygen | FE `constants/specialitySymptoms.ts` |
| Card on the Rx | None | — |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No chest record** — breath sounds per side, peak flow, spirometry, breathlessness grade | Every chest visit; side matters (left vs right) | Chest card (§3) — Right / Left exam grid | F |
| G2 | **No respiratory rate** | Basic sign of breathing trouble (adults, children) | Row in the chest card now; add to Vitals later if GP / Pediatrician need it too | F |
| G3 | **Inhaler / Rotacap / Respules missing from the form picker** | Most chest medicines; instruction phrases exist but the form isn't offered | Add forms (step C) | C |
| G4 | Section order | Complaint → exam → diagnosis | Reorder (§4) | B |
| G5 | Diagnosis list misses common cases | TB, bronchiectasis, ILD, sleep apnoea, pleural effusion, lung nodule, post-COVID | Adds (§4) + merge `Chest Specialist` | B |
| G6 | Chest tests (PFT, chest X-ray, HRCT, sputum AFB / CBNAAT, ABG, sleep study) | Lab catalog, not config | Step I | I |
| G7 | TB must be notified (Nikshay) | Legal duty in India | Note only — no Nikshay link in scope | — |

### 3. Chest card — simple

Right / Left exam grid (same component as eye / ENT / limb) + single rows. Saved in `additionalInformation`.

| Row | Right | Left | Input |
|---|---|---|---|
| Breath sounds | Vesicular | Reduced | pick: Vesicular, Reduced, Absent, Bronchial |
| Added sounds | Wheeze | Crackles | pick: None, Wheeze, Crackles, Rub |
| Respiratory rate (/min) | one value | | number 8–60 |
| Peak flow (L/min) | one value | | number 50–800 |
| FEV1 (% predicted) / FEV1/FVC | one value | | text, e.g. "62% / 0.65" |
| Breathlessness (mMRC) | one value | | pick: 0, 1, 2, 3, 4 |
| Inhaler technique | one value | | pick: Good, Needs training |
| Home oxygen (L/min) | one value | | number 0–15 |
| Smoking (pack-years) | one value | | number 0–150 |
| Sleep (STOP-BANG) | one value | | number 0–8 — Sleep Medicine |

"Copy to left"; only filled rows print. SpO2 / pulse come from Vitals.

### 4. Prescription config

**`Pulmonologist` block — changes:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Pathology Test → Advice → Habits → Allergy → Dietary Suggestions → Surgery Suggested → Visiting Days → Follow-Up
- **Pre-Diagnosis add:** Snoring, Daytime sleepiness, Night sweats, Weight loss, Chest tightness on exercise
- **Diagnosis add:** Pulmonary tuberculosis, Bronchiectasis, Interstitial lung disease, Obstructive sleep apnoea, Pleural effusion, Lung nodule, Post-COVID lung disease, Allergic asthma, Chronic cough
- **Advice add:** Rinse the mouth after the steroid inhaler, Use the spacer with the inhaler, Complete the full TB course — do not stop early, Get the flu vaccine every year
- **Medicine forms add (step C):** Inhaler, Rotacap, Respules, Nebuliser solution

### 5. Checklist (tick in browser)

- [ ] New section order; new complaints / diagnoses / advice for Pulmonologist + both subs (B)
- [ ] Chest Specialist loses nothing after its block is merged + deleted (B)
- [ ] Inhaler / Rotacap / Respules in the form picker; inhaler phrases offered (C)
- [ ] Chest card: Right / Left picks, RR 8–60, peak flow 50–800 save and reload (F)
- [ ] Only filled rows print (D + F)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `pulmo.tb_6m` | TB treatment (6 months) | package, 6 × 30d, expiry 200d | Monthly review + weight; sputum at 2 and 6 months | tuberculosis, TB |
| `pulmo.pulmonary_rehab` | Pulmonary rehab — 12 sessions | package, 12 × 3d, expiry 60d | — | COPD, pulmonary rehab |
| `pulmo.cpap_trial` | Sleep apnoea CPAP trial | **staged — works today** | Sleep study → CPAP trial (+7d) → Review (+14d) → Review (+60d) | sleep apnoea, CPAP |
| `pulmo.post_pneumonia` | Post-pneumonia follow-up | **staged — works today** | Review (+7d) → Chest X-ray review (+42d) | pneumonia |
| `pulmo.asthma_copd_review` | Asthma / COPD review | **review**, every 90d | Peak flow + inhaler check | asthma, COPD |

### 7. Plan config row

**Plan fields:** `condition` (Asthma, COPD, TB, ILD, Sleep apnoea, Pneumonia, Other).
**Step fields:** `spo2`, `peak_flow`, `weight_kg` (numbers), `mmrc` (select 0–4).

### 8. Plan checklist

- [ ] TB, rehab, CPAP, post-pneumonia work on today's engine; review waits for `review`

## 9. Decisions (2026-10-24)

1. Chest card on the **Right / Left exam grid**.
2. Respiratory rate **in the chest card now**; added to Vitals for everyone later, with Pediatrician.
3. **Add Inhaler / Rotacap / Respules / Nebuliser solution** to the form picker.
4. **New section order** — complaint first.
5. TB notification (Nikshay) **out of scope**.
