# Emergency Medicine Specialist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 23). Clinical values need an emergency physician's check.
Covers sub-specialty: Intensivist (Critical Care); also practises General Physician (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** quick-print footer says "Not valid for medico-legal purposes" — MLC / injury certificate not supported; referral letter (transfer) exists.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists — or GP lists if "General Physician" is ticked | BE `utils/doctorSpecialtyConfig.ts` |
| Emergency visit | Appointment type `Emergency` exists (books over the slot rules) | BE `appointments/utils/appointmentType.constants.ts` |
| "Triage" in code | The notifications tab — **not** clinical triage | BE `notifications/registry/appointment/queueEvents.ts` |
| Booking symptoms | Severe chest pain, breathing difficulty, weakness / numbness, severe abdominal pain, fever + stiff neck, trauma, deep cuts / burns, bleeding, confusion, poisoning | FE `constants/specialitySymptoms.ts` |
| Procedures | Suturing, dressing, nebulisation, IV fluids billable as clinic services | `appointmentMultipleService` |
| Referral / transfer | Referral letter exists | `appointmentClinical.referrals` |
| Medico-legal (MLC) | Not supported — print footer disclaims it | BE `quick-print-templates/services/quickPrintTemplate.service.ts` |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Generic lists | New block (§4) | B |
| G2 | **No emergency record** — triage level, GCS, what happened, outcome | Core of every emergency note | Emergency card (§3), single-column exam grid | F |
| G3 | **Medico-legal case (MLC)** — police intimation, injury certificate | Legal duty for accidents, assault, poisoning | Out of scope now — needs its own plan (legal format, register); note | — |
| G4 | Dog bite / rabies | Very common in India; vaccine schedule must be kept | Part B template (works today) | — |
| G5 | Intensivist (ICU) | ICU charting is not OPD | Out of scope | — |

### 3. Emergency card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).

| Row | Input |
|---|---|
| Arrival time | time |
| Triage | pick: Red (immediate), Orange (very urgent), Yellow (urgent), Green (standard) |
| GCS | number 3–15 |
| Pain (0–10) | number |
| Respiratory rate (/min) | number 8–60 |
| What happened | short note (e.g. "Bike fall, helmet on") |
| Wound | pick: None, Abrasion, Cut — sutured, Cut — dressed, Burn |
| Outcome | pick: Sent home, Admitted, Referred, Left against advice, Died |

SpO2 / BP / pulse come from Vitals. Only filled rows print.

### 4. Prescription config

**New block `Emergency Medicine Specialist`:**
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Allergy → Pathology Test → Advice → Surgery Suggested → Follow-Up (no Habits, Diet, Visiting Days)
- **Allergy:** Drug allergy, Penicillin allergy, Sulfa allergy, Latex allergy, Tetanus toxoid reaction
- **Pre-Diagnosis:** Chest pain, Breathlessness, Injury, Bleeding, Severe abdominal pain, Fainting, Fits, High fever, Poisoning, Animal bite
- **Diagnosis:** Road traffic injury, Lacerated wound, Fracture (suspected), Acute gastroenteritis with dehydration, Acute asthma, Hypoglycaemia, Seizure, Snake bite, Dog bite, Organophosphate poisoning, Heat stroke, Allergic reaction / anaphylaxis
- **Surgery Suggested (procedures):** Wound suturing, Dressing, Splinting, Nebulisation, IV fluids, Gastric lavage, Referral for surgery
- **Advice:** Keep the wound dry for 48 hours, Return at once if pain, swelling or bleeding increases, Complete the rabies vaccine schedule on the given dates, Get the stitches removed on the given date

### 5. Checklist (tick in browser)

- [ ] Emergency doctor sees emergency lists; no Habits / Diet / Visiting Days (B)
- [ ] Emergency card: GCS 3–15, triage picks, outcome save and reload (F)
- [ ] Only filled rows print (D + F)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates (all work today)

| Code | Template | Type | Steps | Keywords |
|---|---|---|---|---|
| `er.anti_rabies` | Anti-rabies vaccine (dog bite) | **staged** | Day 0 → Day 3 (+3d) → Day 7 (+4d) → Day 28 (+21d) | dog bite, rabies, animal bite |
| `er.suture_care` | Wound suturing + removal | **staged** | Suturing → Wound check (+2d) → Suture removal (+5d) | cut, laceration, sutures |
| `er.post_er_review` | Review after emergency visit | **staged** | Review (+1d) → Review (+7d) | emergency follow-up |
| `er.burn_dressing` | Burn dressing series | package, 6 × 2d, expiry 20d | — | burn, dressing |

### 7. Plan config row

**Plan fields:** `injury_type` (Cut, Burn, Bite, Fracture, Other), `site` (text).
**Step fields:** `wound_status` (Healthy, Infected, Healed), `dose_given` (boolean — vaccine).

### 8. Plan checklist

- [ ] Anti-rabies books Day 0 / 3 / 7 / 28 exactly
- [ ] All 4 work on today's engine (no new type needed)

## 9. Decisions (2026-10-24)

1. **Emergency card with the 8 rows** in §3.
2. MLC + injury certificate = **own plan, later**.
3. Intensivist (ICU) **out of scope**.
4. Anti-rabies = **intramuscular Day 0 / 3 / 7 / 28 only** for now.
5. **No Habits, Diet, Visiting Days** sections.
