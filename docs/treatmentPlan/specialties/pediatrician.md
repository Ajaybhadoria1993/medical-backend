# Pediatrician — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: IAP schedule covers birth to 18 months: the 4–6 and 10–12 year doses exceed the 365-day step limit.
Parent: `../specialty-rollout-research.md` (Wave 5, specialty 32). Clinical values need a pediatrician's check.
Covers sub-specialty: Neonatologist; also practises General Physician, Allergist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** vaccine card + growth must print in all 3 paths → D; vaccines billable as clinic services (exists); school / fitness certificate is the shared certificate gap.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Pediatrician` block — Vitals first; gastroenteritis, asthma, dermatitis, constipation, UTI…; fever, cough, vomiting, loose motions, rash; tonsil / hernia / appendix / adenoid surgery | BE `utils/doctorSpecialtyConfig.ts` |
| Vitals | Weight (1–200 kg), height (30–200 cm), BMI; **no respiratory rate, no head circumference** | FE `prescription/details/constants.ts` |
| Date of birth | On the patient profile (`dob`) | BE `users/models/userProfile.model.ts` |
| Parent link | Family links with relationship `parent` / `child` | BE `patient/models/patientFamilyLinks.model.ts` |
| **Vaccination record** | **None anywhere** | — |
| Dose by weight | No mg/kg helper — doses typed | FE prescription editor |
| Booking symptoms | Fever, cough / wheeze, ear pain, rash, poor feeding, delayed milestones, colic, sore throat, **vaccinations**, behaviour | FE `constants/specialitySymptoms.ts` |
| Treatment plan | None; IAP schedule needs the `timeline` type (dates from DOB) | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No vaccination record** | Vaccines are a third of pediatric OPD; history must follow the child, not one visit | **Patient-level vaccine list** (new small table, like the profile) + "Vaccines given today" on the Rx — question 1 | **K** (new) |
| G2 | **No growth record** — head circumference, percentiles | Under-5 growth is checked every visit | Child card (§3): head circumference + values; WHO percentile chart = shared trend feature later | F |
| G3 | **No respiratory rate** in Vitals | Fast breathing = pneumonia sign in children | Add RR to Vitals (decided with Pulmonologist) | **C** |
| G4 | **No milestones** | Delay must be caught early | Milestone rows in the child card | F |
| G5 | Dose by weight | Child doses are mg/kg | Show weight next to medicines; **no auto-dose** (same safety rule as Oncology) | — |
| G6 | Parent not shown in the Rx | Parent gives the history and consent | Linked parent chip — step J (carer, decided in Geriatrician) | J |
| G7 | Diagnosis list misses common cases | Bronchiolitis, otitis media, febrile fits, dengue, HFMD, worms, anaemia, newborn jaundice, failure to thrive | Adds (§4) | B |

### 3. Child card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).

| Group | Row | Input |
|---|---|---|
| Growth | Head circumference (cm) | number 25–60 |
| | Weight / height | from Vitals — not typed again |
| | Growth | pick: Normal, Underweight, Stunted, Overweight |
| Development | Milestones | pick: On time, Delayed + short note (which) |
| | Feeding | pick: Breastfed, Formula, Mixed, Solids, Family food |
| Newborn | Birth weight (kg) | number 0.4–6 |
| | Jaundice | pick: None, Mild, Needs check |
| Vaccines | Given today | multi-pick from the IAP list (§3a) — also writes to the patient vaccine list (step K) |

**§3a — Vaccine list (IAP):** BCG, OPV, Hep B, DTwP / DTaP, Hib, IPV, PCV, Rotavirus, Influenza, MMR, Typhoid conjugate, Varicella, Hep A, Tdap, HPV, Meningococcal, JE.

**Patient vaccine record (step K):** one row per dose — vaccine, dose no., date given, given by, batch no. Shown as a list on the patient and in the Rx context bar ("Last vaccine: DTaP-2, 12 Aug").

### 4. Prescription config

**`Pediatrician` block — adds:**
- **Pre-Diagnosis add:** Fast breathing, Fits with fever, Not feeding, Ear discharge, Yellow skin (newborn), Worms in stool, Bedwetting, Not gaining weight
- **Diagnosis add:** Bronchiolitis, Viral URTI, Acute otitis media, Febrile seizure, Dengue, Hand-foot-mouth disease, Worm infestation, Iron deficiency anaemia, Neonatal jaundice, Failure to thrive, Developmental delay, ADHD
- **Advice add:** Sponge with plain water if fever is high; do not use cold water, Give ORS after every loose stool, Come at once if the child breathes fast, is very sleepy or stops feeding, Next vaccine is due on ___, Exclusive breastfeeding until 6 months
- **Diet add:** Mashed home food from 6 months, Iron-rich foods (ragi, green vegetables), No packaged juice or biscuits under 2 years
- Section order: keep (Vitals first).

### 5. Checklist (tick in browser)

- [ ] New complaints / diagnoses / advice for Pediatrician + Neonatologist (B)
- [ ] Vitals has respiratory rate; other specialties see it too (C)
- [ ] Child card: head circumference, milestones, feeding, newborn rows save and reload (F)
- [ ] "Given today" vaccines appear in the patient vaccine list; next visit shows "Last vaccine" (K)
- [ ] Parent shows in the Rx context bar (J)
- [ ] Only filled rows print; vaccine list prints on request (D)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `peds.iap_schedule` | Vaccination schedule (IAP) | **timeline** from DOB | Birth → 6 w → 10 w → 14 w → 6 m → 9 m → 12 m → 15 m → 16–18 m → 4–6 y → 10–12 y | vaccination, IAP |
| `peds.newborn_followup` | Newborn follow-up | **staged — works today** | Day 3 (+3d) → Day 7 (+4d) → 6 weeks (+35d) | newborn, neonatal |
| `peds.growth_review` | Growth review (under 5) | **review**, every 90d | Weight + height + head each visit | growth, failure to thrive |
| `peds.nebulisation` | Nebulisation course | package, 5 × 1d, expiry 10d | — | wheeze, bronchiolitis |

IAP schedule needs `timeline` (dates counted from DOB, not from the plan start) — engine step in the research doc.

### 7. Plan config row

**Plan fields:** `dob` (read from profile), `condition` (Vaccination, Growth, Newborn, Asthma, Other).
**Step fields:** `vaccine_given` (multiselect, IAP list), `weight_kg`, `head_cm` (numbers).

### 8. Plan checklist

- [ ] Newborn + nebulisation work today; IAP waits for `timeline`, growth for `review`
- [ ] IAP dates match the chart for 3 test DOBs (when `timeline` is built)

## 9. Decisions (2026-10-24)

1. **Patient-level vaccine record** (new table + migration, step K); GP adult vaccines + Gyn TT use it too.
2. **Respiratory rate added to Vitals** for everyone (step C).
3. Weight next to medicines, **no auto mg/kg dose** (safety).
4. WHO growth percentiles + chart **with the shared trend feature**, later.
5. **IAP schedule only** for now; clinic edits later.
