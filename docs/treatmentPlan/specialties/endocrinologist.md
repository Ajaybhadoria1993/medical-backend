# Endocrinologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: Osteoporosis yearly infusion = 3-session package, 365 days apart.
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 17). Clinical values need an endocrinologist's check.
Covers sub-specialties: Diabetologist, Thyroid Specialist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** endocrine card must print in all 3 paths → D; insulin dose must print clearly.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **No `Endocrinologist` block.** Gets the `Diabetologist` block only if "Diabetologist" is picked as a sub-specialty; otherwise generic lists. Thyroid Specialist has no block | BE `utils/doctorSpecialtyConfig.ts`, `configSpecialty` |
| `Diabetologist` block | Full diabetes lists (T1 / T2, neuropathy, nephropathy, low-sugar episodes, foot advice, HbA1c every 3 months) — no thyroid / PCOS / bone | same |
| Vitals | BP, weight, height, BMI (auto), FBS / PPBS / RBS | FE `prescription/details/constants.ts` |
| Patient profile | Chronic conditions incl. Diabetes, Thyroid — not shown in the Rx yet (step J) | `userProfile.model.ts` |
| Dose schedule | Patterns 0–2 per slot (`1-0-1`, `2-0-2`…); **insulin units (10-8-12) don't fit** — go in instruction text | FE `workspace/helpers/schedulePattern.ts` |
| Booking symptoms | Weight change, fatigue, heat / cold intolerance, hirsutism, irregular periods, bone loss, thirst + urination, growth, mood, goitre | FE `constants/specialitySymptoms.ts` |
| Chronic-care card | Planned for GP (BP, HbA1c, sugar control, yearly eye / foot / kidney checks) | `general-physician.md` §3 |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No Endocrinologist config** — most endocrinologists see generic lists | Diabetes, thyroid, PCOS, bone are the whole OPD | New block = `Diabetologist` lists + thyroid / PCOS / bone (§4); then the `Diabetologist` block is merged and deleted (GP decision §9) | B |
| G2 | **No endocrine record** — HbA1c, home sugar log, low-sugar episodes, TSH, goitre | Each visit compares these to the last | Reuse the GP chronic-care card + endocrine rows (§3) | F |
| G3 | **Insulin dose in units** | Different units at each meal; a pattern can't hold 10-8-12 | Now: instruction phrases for insulin ("10 units before breakfast…"); later, if asked: units per slot | C |
| G4 | Endocrine tests (HbA1c, TSH, FT4, lipid, vitamin D, DEXA, cortisol) | Lab catalog, not config | Step I | I |
| G5 | Sugar / weight / TSH trend across visits | Core of follow-up | Shared, later (decided) | — |

### 3. Card — GP chronic-care card + endocrine rows

Same single-column card as GP (`general-physician.md` §3) — one build, more rows when the doctor
is an Endocrinologist. Auto-shows for Diabetes / Thyroid patients.

| Row | Input |
|---|---|
| *GP rows* | BP target / control, last HbA1c, sugar control, eye / foot / kidney checks, lifestyle |
| Home sugar log | text, e.g. "Fasting 110–140, post-meal 160–220" |
| Low-sugar episodes (last month) | number 0–30 |
| Total insulin (units / day) | number 0–300 |
| Foot sensation (monofilament) | pick: Normal, Reduced, Absent |
| TSH (mIU/L) | number 0–100 |
| Free T4 (ng/dL) | number 0–10 |
| Goitre grade | pick: 0, 1, 2 |
| PCOS — cycle | pick: Regular, Irregular, Absent |
| DEXA T-score | number −5 to +3 |

Only filled rows print.

### 4. Prescription config

**New block `Endocrinologist`** (start from `Diabetologist`, add):
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Pathology Test → Dietary Suggestions → Advice → Habits → Allergy → Visiting Days → Follow-Up (no Surgery Suggested)
- **Pre-Diagnosis add:** Weight gain, Neck swelling, Heat intolerance, Cold intolerance, Hair growth on face, Irregular periods, Bone pain, Palpitations
- **Diagnosis add:** Hypothyroidism, Hyperthyroidism, Thyroid nodule, PCOS, Osteoporosis, Vitamin D deficiency, Prediabetes, Gestational diabetes, Obesity, Dyslipidemia
- **Advice add:** Take the thyroid tablet empty stomach, 30 minutes before breakfast, Keep sugar / glucose tablets with you, Rotate insulin injection sites, Store insulin in the fridge door, not the freezer
- **Diet add:** Eat at fixed times with insulin, Include protein in every meal, Limit fruit juice

**Instruction phrases (Injection / insulin forms):** "__ units before breakfast", "__ units before lunch", "__ units before dinner", "__ units at bedtime", "Inject under the skin of the abdomen", "Check sugar before each dose".

### 5. Checklist (tick in browser)

- [ ] Endocrinologist (no sub picked) sees endocrine lists, not generic (B)
- [ ] Diabetologist sub still gets diabetes items after the `Diabetologist` block is merged (B)
- [ ] Insulin phrases offered for injection forms; dose prints clearly (C)
- [ ] Card shows GP rows + endocrine rows for an Endocrinologist; GP sees GP rows only (F)
- [ ] TSH, FT4, T-score ranges validate; only filled rows print (F + D)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `endo.insulin_start` | Insulin start + titration | **staged — works today** | Start → Review (+3d) → Review (+7d) → Review (+14d) → Review (+30d) | insulin start, uncontrolled diabetes |
| `endo.diabetes_review` | Diabetes review | **review**, every 90d | Open-ended | diabetes |
| `endo.thyroid_review` | Thyroid review | **review**, every 60d until stable, then 180d | Open-ended | hypothyroid, hyperthyroid |
| `endo.pcos_6m` | PCOS programme (6 months) | package, 6 × 30d, expiry 200d | Monthly | PCOS |
| `endo.osteoporosis` | Osteoporosis injection (yearly) | **cycle**, 3 × 365d | Yearly infusion + DEXA | osteoporosis, zoledronic acid |

### 7. Plan config row

**Plan fields:** `condition` (Type 1, Type 2, Thyroid, PCOS, Osteoporosis, Other), `target_hba1c` (number).
**Step fields:** `hba1c`, `fasting_sugar`, `tsh`, `insulin_units_day`, `weight_kg` (numbers).

### 8. Plan checklist

- [ ] Insulin start works on today's engine; review / cycle templates wait for those types
- [ ] Step values show per visit on plan detail

## 9. Decisions (2026-10-24)

1. **One shared chronic-care card** — GP rows + endocrine rows for Endocrinologists.
2. Insulin units via **instruction phrases** now; units-per-slot dosing later only if asked.
3. **Merge the `Diabetologist` block** into the new `Endocrinologist` block, then delete it.
4. Thyroid Specialist and Diabetologist subs **use the Endocrinologist block**.
5. Yearly osteoporosis injection = **`cycle` template**, later.
