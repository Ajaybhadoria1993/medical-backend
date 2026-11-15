# Geriatrician — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 21). Clinical values need a geriatrician's check.
Covers: no sub-specialties; also practises General Physician (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** elderly patients need a readable print — large-font option is a shared idea (later); assessment card must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists — or GP lists if "General Physician" is ticked as also-practises | BE `utils/doctorSpecialtyConfig.ts`, `configSpecialty` |
| Booking symptoms | Memory loss, falls, many chronic conditions, mobility decline, many medicines, frailty, incontinence, daily-task difficulty, osteoporosis, sleep | FE `constants/specialitySymptoms.ts` |
| Patient profile | Chronic conditions, allergies — shown in the Rx after step J | `userProfile.model.ts` |
| Family links | Patient family links exist (carer / relative) | BE `patient/models/patientFamilyLinks.model.ts` |
| Medicines across doctors | The Rx shows only this visit's medicines — no "all current medicines" list | — |
| Card on the Rx | None | — |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Geriatrician sees generic lists | New block (§4) | B |
| G2 | **No geriatric assessment** — falls, memory, mood, daily activities, walking | This assessment *is* the geriatric visit | Assessment card (§3), single-column exam grid | F |
| G3 | **Many medicines from many doctors** (polypharmacy) | Main risk in the elderly — duplicates, interactions | Card row "total medicines" now; an all-current-medicines list = shared, later | F / later |
| G4 | Carer not visible in the Rx | Elderly often come with a carer who gives the history | Show linked family member in the context bar with step J (question 3) | J |
| G5 | Print readability | Small print is hard for elderly patients | Large-font print option = shared, later | — |

### 3. Assessment card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).

| Row | Input |
|---|---|
| Falls in last year | number 0–20 |
| Walking test (Timed Up and Go, sec) | number 0–120 |
| Walking aid | pick: None, Stick, Walker, Wheelchair |
| Memory (Mini-Cog, 0–5) | number |
| Mood (GDS-15, 0–15) | number |
| Daily activities (Katz ADL, 0–6) | number |
| Continence | pick: Normal, Urine leak, Stool leak, Both |
| Nutrition | pick: Good, At risk, Malnourished |
| Vision / hearing | pick: OK, Poor vision, Poor hearing, Both |
| Total medicines (all doctors) | number 0–30 |
| Lives with | pick: Family, Alone, Care home |

Only filled rows print.

### 4. Prescription config

**New block `Geriatrician`:**
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Allergy → Habits → Pathology Test → Advice → Dietary Suggestions → Visiting Days → Follow-Up (no Surgery Suggested)
- **Habits:** Smoking, Alcohol, Inactive most of the day, Poor sleep, Skipping meals, Living alone
- **Allergy:** Drug allergy, Sulfa allergy, Penicillin allergy
- **Pre-Diagnosis:** Forgetfulness, Falls, Unsteady walking, Weakness, Poor appetite, Weight loss, Urine leak, Poor sleep, Low mood, Confusion
- **Diagnosis:** Frailty, Recurrent falls, Dementia, Mild cognitive impairment, Delirium, Depression in elderly, Osteoporosis, Urinary incontinence, Polypharmacy, Malnutrition, Parkinsonism, Benign positional vertigo
- **Advice:** Remove loose rugs and keep lights on at night, Use the walking aid at all times, Keep a written list of all medicines, Carer to give medicines from a pill box, Get up slowly from bed or chair
- **Diet:** Eat protein with every meal, Drink 6–8 glasses of water unless told otherwise, Calcium and vitamin D-rich foods, Soft foods if chewing is hard

### 5. Checklist (tick in browser)

- [ ] Geriatrician sees geriatric lists, not generic (B)
- [ ] Assessment card: number ranges validate, picks save and reload (F)
- [ ] Card prints under its heading, only filled rows (D + F)
- [ ] Linked carer shows in the Rx context bar (J, if question 3 = yes)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `geri.post_discharge` | After-hospital follow-up | **staged — works today** | Review (+3d) → Review (+7d) → Review (+30d) | discharge, post-hospital |
| `geri.falls_programme` | Falls prevention programme | package, 8 × 7d, expiry 70d | Balance + strength sessions | falls, balance |
| `geri.comprehensive_review` | Comprehensive geriatric review | **review**, every 90d | Assessment card each visit | frailty, elderly |
| `geri.memory_review` | Memory clinic review | **review**, every 90d | Mini-Cog each visit | dementia, memory |
| `geri.pneumococcal` | Pneumococcal vaccine (PCV + PPSV) | **staged — works today** | PCV → PPSV (+365d) | pneumococcal, vaccine |

### 7. Plan config row

**Plan fields:** `condition` (Frailty, Falls, Memory, Post-discharge, Vaccine, Other), `carer_name` (text — non-sensitive).
**Step fields:** `falls_since_last` (number), `tug_seconds` (number), `mini_cog` (number).

### 8. Plan checklist

- [ ] Post-discharge + pneumococcal work today; reviews wait for `review`

## 9. Decisions (2026-10-24)

1. **Assessment card with the 11 rows** in §3.
2. All-current-medicines list = **shared feature, later**.
3. Linked carer **shows in the Rx context bar** with step J.
4. Large-font print = **shared, later**.
5. Geriatrician with GP ticked **gets the Geriatrician block** (main wins).
