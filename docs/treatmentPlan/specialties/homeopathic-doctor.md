# Homeopathic Doctor — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 15). Clinical values need a BHMS doctor's check.
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** case card + potency must print in all 3 paths → D (`prescription-first-plan.md` §8.1).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` → `GENERIC_DOCTOR_PREFERENCES` |
| Booking symptoms | Recurrent cold / allergy, skin, migraine, acidity, joint pain, anxiety, hair fall, sinus, periods, sleep | FE `constants/specialitySymptoms.ts` |
| Medicine panel | Shown — **correct**, homeopaths prescribe | FE `PrescriptionSummarySection.tsx` |
| Medicine forms | Suggestion list has no Globules, Dilution, Mother tincture (Q), Biochemic | FE `editor/constants.ts` |
| Potency (30C, 200C, 1M) | Medicine has `strength`, but a global medicine is **unique by name + form** — one "Arnica Montana / Dilution" only | BE `medicine/models/medicine.model.ts` |
| Case-taking card | None | — |
| Treatment plan templates / fields | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Homeopath sees GP lists | New block (§4) | B |
| G2 | **No case-taking card** — mind, thermal, thirst, cravings, sleep, modalities | Homeopathic remedy is chosen from these, not only the disease | Case card (§3) — exam-grid component, single column | F |
| G3 | **No homeopathic forms** | Doctor types "Globules" every time | Add forms (§4) | C |
| G4 | **Potency** | Same remedy in 30C / 200C / 1M is a different prescription | Decided: potency in the medicine name ("Arnica Montana 30C") — doctor's own medicines, no code | — |
| G5 | **No standard homeopathy instructions** | Every Rx says: on a clean tongue, 30 min away from food, avoid coffee / camphor / mint | Instruction phrases per form (§4) | C |
| G6 | Section order | Case-taking leads; Surgery Suggested not used | Sections (§4) | B |

### 3. Case card — simple

Single-column rows, same exam-grid component as eye / ENT / Ayurveda. Saved in `additionalInformation`;
prints under its own heading (step D).

| Row | Input |
|---|---|
| Thermal | pick: Chilly, Hot, Ambithermal |
| Thirst | pick: Thirstless, Normal, Thirsty (large quantity), Thirsty (small, often) |
| Appetite | pick: Poor, Normal, Increased |
| Cravings | multi-pick: Sweets, Salt, Spicy, Sour, Cold drinks, Warm drinks, Eggs, Fats |
| Aversions | multi-pick: same list |
| Sleep | pick: Sound, Disturbed, Sleepless, Excess |
| Perspiration | pick: Normal, Scanty, Profuse, Offensive |
| Mind | short note (e.g. anxious, weepy, irritable) |
| Better from | short note (modalities) |
| Worse from | short note |

Only filled rows print.

### 4. Prescription config

**New block `Homeopathic Doctor`:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Allergy → Habits → Pathology Test → Dietary Suggestions → Advice → Visiting Days → Follow-Up (no Surgery Suggested)
- **Habits:** Coffee, Tea, Smoking, Alcohol, Late nights, Irregular meals, Stress
- **Allergy:** Lactose (sugar of milk) intolerance, Alcohol (dilution base) intolerance, Drug allergy
- **Pre-Diagnosis:** Recurrent cold, Skin rash, Headache, Acidity, Joint pain, Anxiety, Hair fall, Poor sleep
- **Diagnosis:** Allergic rhinitis, Eczema, Migraine, Acid peptic disease, Osteoarthritis, Anxiety, Alopecia, Sinusitis, PCOS, Warts
- **Dietary Suggestions:** Avoid coffee during treatment, Avoid raw onion and garlic close to the dose, Eat light, warm food, Drink enough water
- **Advice:** Take the medicine on a clean tongue, Keep 30 minutes from food and drink, Avoid camphor, mint and strong smells, Store medicines away from sunlight and perfumes, Do not touch the pills with fingers

**Medicine forms to add:** Globules (Pills), Dilution, Mother Tincture (Q), Biochemic Tablet, Trituration.

**Instruction phrases per form:**
- Globules: 4 pills on a clean tongue, 3 times a day; Dissolve under the tongue
- Dilution: 2 drops in a little water, 3 times a day; 2 drops on the tongue
- Mother Tincture: 10 drops in half a cup of water, twice a day
- Biochemic Tablet: 4 tablets to chew, 3 times a day

### 5. Checklist (tick in browser)

- [ ] Homeopath sees homeopathy lists; no Surgery Suggested section (B)
- [ ] Globules / Dilution / Mother Tincture in the form picker, with their instruction phrases (C)
- [ ] Case card shows for Homeopathic Doctor only; multi-picks save and reload (F)
- [ ] Case card prints under its heading, only filled rows (D + F)
- [ ] Potency shows clearly on the printed Rx (whichever way question 1 goes)
- [ ] Old prescriptions still open; other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates (needs `review` type for the first)

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|
| `homeo.constitutional_review` | Constitutional treatment (monthly review) | **review**, every 30d | Open-ended | chronic disease, constitutional |
| `homeo.allergy_course` | Allergy / recurrent cold course | package, 6 × 30d, expiry 200d | Monthly | allergic rhinitis, recurrent cold |
| `homeo.skin_course` | Skin course | package, 6 × 30d, expiry 200d | Monthly | eczema, psoriasis, acne |
| `homeo.hair_course` | Hair fall course | package, 4 × 30d, expiry 150d | Monthly | hair fall, alopecia |
| `homeo.child_immunity` | Child immunity course | package, 6 × 30d, expiry 200d | Monthly | recurrent infections, child |

### 7. Plan config row

**Plan fields:** `condition` (select), `thermal` (Chilly, Hot, Ambithermal), `mode` (In clinic, Online).
**Step fields:** `improvement` (None, < 25%, 25–50%, 50–75%, > 75%), `aggravation` (boolean — first reaction after a remedy), `step_note`.

### 8. Plan checklist

- [ ] Templates match §6; constitutional review needs the `review` type built first
- [ ] Improvement + aggravation save per visit

## 9. Decisions (2026-10-24)

1. Potency **in the medicine name** ("Arnica Montana 30C") — no code; potency pick on the Rx line later if asked.
2. Case card = **single-column rows on the shared exam grid**.
3. Homeopathy instructions = **phrases per form**, no new field.
4. **No Surgery Suggested** section.
5. Repertory / remedy search **out of scope**.
