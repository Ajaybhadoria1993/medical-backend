# Treatment Plan — Dietitian / Nutritionist (end-to-end plan)

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 2, specialty 13). Clinical values need a registered dietitian's check.
Covers sub-specialties: Dietitian, Nutritionist (`utils/specialtyCatalog.ts`).

**Part A (now):** G1 new Rx config → B · G6 booking symptoms → C · G2 diet card + G3 measurements → H · G7 hide medicines → E — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G4, G5, G9 · §3 templates · §5 plan / step fields · P1.
**Output check:** Diet chart must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Vitals | Height, weight, **BMI auto**, BP, pulse, SpO2, temp, FBS / PPBS / RBS | FE `prescription/details/constants.ts`, `helpers.ts` |
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` → `GENERIC_DOCTOR_PREFERENCES` |
| Booking symptoms | **None** for Dietitian | FE `constants/specialitySymptoms.ts` |
| Diet chart / meal plan | **None** anywhere | — |
| Weight across visits | **No trend** — each visit's vitals stand alone | — |
| Medicine panel | Always shown (decided: hide for non-prescribing) | FE `PrescriptionSummarySection.tsx` |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No prescription config** | Dietitian sees GP lists | New block (§5) |
| G2 | **No diet chart** | The diet chart *is* the dietitian's prescription | Meal plan card, prints (§4) |
| G3 | **No body measurements beyond weight / BMI** | Waist, hip, body fat show fat loss when weight stalls | Measurement rows in the same card (§4) |
| G4 | **No weight progress** | Patients come back to see the number drop | Weight step field per session → shows on plan detail; chart = shared later |
| G5 | No food preference | Veg / Jain / egg decides every meal (India) | Plan field (§5) |
| G6 | No booking symptoms | Patient booking a dietitian picks nothing | Add list (§5) |
| G7 | Medicine panel shows | Dietitians don't prescribe drugs | Hide (shared, decided); supplements go in the diet chart |
| G8 | Online sessions | Common for diet follow-ups | `mode` field now; online feature later (decided) |
| G9 | No templates | Diet work is programmes | Add 5 (§3) |

## 3. Templates (5 new)

All package — run on today's engine.

| Code | Template | Type / price | Sessions | Keywords |
|---|---|---|---|---|
| `diet.weight_loss_3m` | Weight-loss programme (3 months) | package, package price, 12 × 7d, expiry 100d | Weekly weigh-in + chart update | obesity, overweight, weight loss |
| `diet.diabetes` | Diabetes diet programme | package, package price, 6 × 14d, expiry 100d | Every 2 weeks | diabetes, high sugar, prediabetes |
| `diet.pcos` | PCOS diet programme | package, package price, 6 × 14d, expiry 100d | Every 2 weeks | PCOS, PCOD, irregular periods |
| `diet.weight_gain` | Weight-gain / muscle programme | package, package price, 8 × 14d, expiry 130d | Every 2 weeks | underweight, weight gain, muscle |
| `diet.kidney` | Kidney (CKD) diet | package, per step, 6 × 30d, expiry 200d | Monthly, with lab values | CKD, kidney disease, high creatinine |

Pregnancy nutrition → belongs to Gynecologist timeline (Wave 6), not here.

## 4. Diet card — simple and dynamic

On the prescription, saved in `additionalInformation`. Two parts.

**Measurements** (weight / height / BMI come from Vitals — not typed twice):

| Waist (cm) | Hip (cm) | Waist–hip ratio | Body fat % | Target weight (kg) | Calories / day | Water (L / day) |
|---|---|---|---|---|---|---|
| 92 | 104 | 0.88 (auto) | 32 | 68 | 1500 | 3 |

**Meal plan** — fixed meal rows, doctor fills what applies; "+ Add meal" for extra:

| Meal | What to eat | Quantity |
|---|---|---|
| Early morning | Warm water + 5 soaked almonds | 1 glass |
| Breakfast | Vegetable poha | 1 bowl |
| Mid-morning | Fruit | 1 |
| Lunch | 2 roti, dal, sabzi, salad | — |
| Evening | Green tea + roasted chana | 1 cup |
| Dinner | | |
| Bedtime | | |

Plus two short lists: **Avoid** (e.g. sugar, fried food) and **Supplements** (e.g. Vitamin D weekly).

- Own suggestions per row, like other lists — a dietitian builds their usual items once.
- **"Copy last chart"** — next visit starts from the previous chart, change only what's new.
- Prints as a clean one-page diet chart.
- Plan form: **no widget.** Weight + waist are step fields (§5).

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `goal` | Goal | select, required | Weight loss, Weight gain, Diabetes control, PCOS, Thyroid, Kidney diet, Heart health, Sports nutrition |
| `food_preference` | Food preference | select | Vegetarian, Non-vegetarian, Eggetarian, Vegan, Jain |
| `start_weight` | Start weight (kg) | number | 1–200 |
| `target_weight` | Target weight (kg) | number | 1–200 |
| `mode` | Mode | select | In clinic, Online, Mixed |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `weight_kg` | Weight (kg) | number | 1–200 |
| `waist_cm` | Waist (cm) | number | 30–200 |
| `adherence` | Followed the chart | select | Poorly, Partly, Mostly, Fully |
| `step_note` | Note | text | short |

**New prescription config block `Dietitian / Nutritionist`** (G1):
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Allergy → Habits → Pathology Test → Dietary Suggestions → Advice → Visiting Days → Follow-Up (no Surgery Suggested)
- **Habits:** Skipping breakfast, Late-night eating, Junk food, Sugary drinks, Low water intake, Sedentary lifestyle, Stress eating
- **Allergy / intolerance:** Lactose intolerance, Gluten intolerance, Nut allergy, Egg allergy, Seafood allergy, Soy allergy
- **Pre-Diagnosis:** Weight gain, Weight loss, Low energy, Bloating, Acidity, Irregular periods, High sugar, High cholesterol
- **Diagnosis:** Obesity, Overweight, Underweight, Type 2 diabetes, Prediabetes, PCOS, Hypothyroidism, Dyslipidemia, Fatty liver, CKD, Anaemia
- **Tests:** HbA1c, Lipid profile, Thyroid profile, Vitamin D, Vitamin B12, Hb, Serum creatinine
- **Advice:** Eat every 3 hours in small portions, Walk 30 minutes daily, Drink water before meals, Sleep 7–8 hours, Weigh yourself once a week, same time

**Booking symptoms (FE `specialitySymptoms.ts`):** Weight gain, Weight loss help, Diabetes diet, PCOS diet, Thyroid diet, Kidney diet, Pregnancy nutrition, Child nutrition, Sports nutrition, Digestion problems.

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | New Rx config block (G1) + booking symptoms (G6) | BE + FE | — |
| P3 | Diet card — measurements + meal plan + copy last chart + print (G2, G3) | FE (+ print) | — |
| P4 | Hide medicine panel (G7) | FE | Physio P4 (same change) |

Shared, later: weight / vitals trend chart across visits (G4).

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 diet templates for Dietitian / Nutritionist + subs
- [ ] Sessions, gaps, expiry match §3
- [ ] Goal required; food preference, start / target weight, mode save
- [ ] Weight, waist, adherence save per session; plan detail shows weight per session

**P2 — prescription config**
- [ ] Dietitian sees diet lists, not GP lists; no Surgery Suggested
- [ ] Booking a dietitian shows the new symptoms
- [ ] Own suggestions on top; saved section order kept

**P3 — diet card**
- [ ] Weight / height / BMI read from Vitals, not asked again
- [ ] Waist–hip ratio calculates
- [ ] Meal rows fill; "+ Add meal" works; own suggestions save
- [ ] "Copy last chart" fills from the previous visit
- [ ] Prints as a one-page chart; old prescriptions still open

**P4 — medicine panel**
- [ ] No "Add medicine"; supplements typed in the diet card print

## 8. Decisions (2026-10-24)

1. Supplements go **in the diet card**, not the medicine panel.
2. **"Copy last chart"** on the next visit — yes.
3. Weight progress chart = **shared feature later** (GP, Endo, Gyn too).
4. **Keep the 5 templates**; thyroid, heart, child, sports nutrition not now.
5. Calories = **one number** for now.
