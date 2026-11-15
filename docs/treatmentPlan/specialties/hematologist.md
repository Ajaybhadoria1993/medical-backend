# Hematologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: Thalassaemia transfusion = 12 per-visit repeats every 21 days; Factor VIII / IX assays and APTT added.
Parent: `../specialty-rollout-research.md` (Wave 4, specialty 29). Clinical values need a hematologist's check.
Covers: no sub-specialties; also practises General Physician, Hemato-Oncologist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** transfusion / iron infusion charges billable as clinic services (exists); blood card must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` |
| Patient profile | **Blood group** stored; chronic conditions | `userProfile.model.ts` (shown in Rx after step J) |
| Booking symptoms | Bruising / bleeding, chronic anaemia, nosebleeds, painless nodes, DVT, fatigue / paleness, infections, abnormal counts, big spleen, clotting disorders | FE `constants/specialitySymptoms.ts` |
| INR | Planned row in the Cardiac card; INR review template in Cardiologist | `cardiologist.md` |
| Treatment plan | None; regular transfusions need `cycle` | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Generic lists | New block (§4) | B |
| G2 | **No blood record** — Hb, MCV, platelets, ferritin, INR, transfusions, spleen | Each visit compares counts; transfusion patients track iron load | Blood card (§3) | F |
| G3 | Blood tests (CBC, peripheral smear, ferritin, B12, folate, Hb electrophoresis, PT / INR, factor levels) | Lab catalog | Step I | I |
| G4 | Blood group visible to the doctor | Transfusion safety | Step J (profile chips) | J |

### 3. Blood card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).

| Row | Input |
|---|---|
| Hb (g/dL) | number 2–20 |
| MCV (fL) | number 50–130 |
| Platelets (×10⁹/L) | number 1–1500 |
| WBC / ANC | text, e.g. "WBC 4.2, ANC 1.9" |
| Ferritin (ng/mL) | number 1–15000 |
| INR | number 0.5–6 |
| Transfusions so far | number 0–500 |
| Last transfusion | date |
| Spleen | pick: Not felt, Enlarged + short note (cm) |
| Lymph nodes | pick: None, Enlarged + short note (site) |
| Bleeding | multi-pick: None, Gums, Nose, Skin bruises, Heavy periods, Joints |

Only filled rows print.

### 4. Prescription config

**New block `Hematologist`:**
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Allergy → Habits → Pathology Test → Advice → Dietary Suggestions → Surgery Suggested → Visiting Days → Follow-Up
- **Habits:** Tea / coffee with meals, Vegetarian diet (low iron / B12), Alcohol, Smoking
- **Allergy:** Iron injection reaction, Blood transfusion reaction, Drug allergy
- **Pre-Diagnosis:** Tiredness, Paleness, Breathless on walking, Easy bruising, Bleeding gums, Nosebleed, Heavy periods, Swollen glands, Leg swelling (clot)
- **Diagnosis:** Iron deficiency anaemia, B12 deficiency anaemia, Thalassaemia major, Thalassaemia trait, Sickle cell disease, ITP, Haemophilia, Aplastic anaemia, Polycythaemia, DVT, Iron overload, Pancytopenia
- **Surgery Suggested (procedures):** Blood transfusion, Iron infusion, Bone marrow biopsy, Phlebotomy, Factor replacement
- **Advice:** Take iron tablets with lemon water, not with tea or milk, Iron makes the stool black — this is normal, Report bleeding that does not stop in 10 minutes, Carry your blood group and diagnosis card, Do not take painkillers like aspirin or ibuprofen if platelets are low
- **Diet:** Iron-rich foods (green leafy vegetables, jaggery, dates), Vitamin C with meals, No tea / coffee 1 hour around meals

### 5. Checklist (tick in browser)

- [ ] Hematologist sees blood lists (B)
- [ ] Blood card: ranges validate, bleeding multi-pick saves and reloads (F)
- [ ] Only filled rows print (D + F)
- [ ] Blood group shows in the Rx context bar (J)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `hemat.iron_infusion` | Iron infusion series | **package — works today**, 3 × 7d, expiry 30d | — | iron deficiency, IV iron |
| `hemat.b12_course` | Vitamin B12 injection course | **staged — works today** | Daily × 7 (+1d each) → Weekly × 4 (+7d each) → Monthly review (+30d) | B12 deficiency |
| `hemat.itp_steroid` | ITP steroid course | **staged — works today** | Start → Platelet check (+7d) → Review (+14d) → Taper review (+28d) | ITP, low platelets |
| `hemat.thal_transfusion` | Thalassaemia transfusion | **cycle**, every 21d | Hb + ferritin each visit | thalassaemia major, transfusion |
| `hemat.anaemia_review` | Anaemia review | **review**, every 60d | Hb each visit | anaemia |

Warfarin INR review → Cardiologist template ("Other specialties").

### 7. Plan config row

**Plan fields:** `condition` (Iron deficiency, B12, Thalassaemia, ITP, Haemophilia, Clot, Other), `blood_group` (read from profile).
**Step fields:** `hb`, `platelets`, `ferritin` (numbers), `units_transfused` (number).

### 8. Plan checklist

- [ ] Iron, B12, ITP work today; transfusion waits for `cycle`, anaemia review for `review`

## 9. Decisions (2026-10-24)

1. **Blood card with the 11 rows** in §3.
2. Warfarin INR review **stays under Cardiologist**, shown under "Other specialties".
3. Blood group **from the patient profile** (step J).
4. Regular transfusions = **`cycle` template**, later.
5. Blood bank / cross-match **out of scope**.
