# Neurologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: Botox = 4 named sessions 84 days apart.
Parent: `../specialty-rollout-research.md` (Wave 4, specialty 31 — last of Wave 4). Clinical values need a neurologist's check.
Covers sub-specialty: Neurosurgeon; also practises General Physician, Spine, Pain Management, Sleep Medicine (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** neuro card must print in all 3 paths → D; Botox / nerve-study charges billable as clinic services (exists).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Neurologist` block — migraine, epilepsy, stroke, neuropathy, Parkinson's, TIA, restless legs…; headache, giddiness, tingling, fits, weakness, memory loss, tremor, fainting; brain / spine surgery referral, DBS; headache / seizure diary advice | BE `utils/doctorSpecialtyConfig.ts` |
| Section order | Diagnosis first, Pre-Diagnosis 4th | same |
| Neurosurgeon | No block — uses Neurologist | same |
| Booking symptoms | Exist | FE `constants/specialitySymptoms.ts` |
| Card on the Rx | None | — |
| Treatment plan | None; Botox every 12 weeks needs `cycle` | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No neuro exam** — power, reflexes, plantar, sensation per side | Side-to-side difference is the key finding | Right / Left exam grid (§3) | F |
| G2 | **No neuro scores** — stroke scale, seizures a month, headache days, memory, disability | Tracks stroke / epilepsy / migraine / dementia over time | Single rows in the same card | F |
| G3 | Section order | Complaint → exam → diagnosis | Reorder (§4) | B |
| G4 | Diagnosis list misses cases | Bell's palsy, GBS, myasthenia, MS, vertigo, sciatica, dementia, sleep disorders | Adds (§4) | B |
| G5 | Neuro tests (MRI brain / spine, CT, EEG, NCS / EMG) | Lab catalog | Step I | I |

### 3. Neuro card — simple

Right / Left exam grid (same component as eye / ENT / limb / chest) + single rows. Saved in `additionalInformation`.

| Row | Right | Left | Input |
|---|---|---|---|
| Power — arm (0–5) | 5 | 3 | number 0–5 |
| Power — leg (0–5) | 5 | 3 | number 0–5 |
| Reflexes | Normal | Brisk | pick: Absent, Reduced, Normal, Brisk |
| Plantar | Flexor | Extensor | pick: Flexor, Extensor, Equivocal |
| Sensation | Normal | Reduced | pick: Normal, Reduced, Absent |
| Gait | one value | | pick: Normal, Unsteady, Hemiplegic, Shuffling, Needs support |
| Stroke scale (NIHSS, 0–42) | one value | | number |
| Disability (mRS, 0–6) | one value | | number |
| Seizures in last month | one value | | number 0–100 |
| Last seizure | one value | | date |
| Headache days a month | one value | | number 0–31 |
| Memory (MoCA, 0–30) | one value | | number |
| Cranial nerves | one value | | short note |

"Copy to left"; only filled rows print.

### 4. Prescription config

**`Neurologist` block — changes:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Pathology Test → Advice → Habits → Allergy → Dietary Suggestions → Surgery Suggested → Visiting Days → Follow-Up
- **Pre-Diagnosis add:** Face deviation, Slurred speech, Double vision, Numbness one side, Back pain to leg, Sleep problems
- **Diagnosis add:** Bell's palsy, Guillain-Barré syndrome, Myasthenia gravis, Multiple sclerosis, BPPV (vertigo), Lumbar radiculopathy, Dementia, Tension headache, Cluster headache, Carpal tunnel syndrome, Insomnia
- **Surgery Suggested add:** Botox injection, Nerve conduction study, EEG, Lumbar puncture
- **Advice add:** Do not drive until seizure-free for the time your doctor tells you, Never stop the fit medicine suddenly, In a fit: turn the person on the side, nothing in the mouth, Come to hospital at once for sudden weakness, face droop or slurred speech (stroke)

### 5. Checklist (tick in browser)

- [ ] New section order; new complaints / diagnoses / procedures / advice for Neurologist + Neurosurgeon (B)
- [ ] Right / Left power 0–5, reflex / plantar picks save; "Copy to left" works (F)
- [ ] NIHSS 0–42, mRS 0–6, MoCA 0–30 validate (F)
- [ ] Only filled rows print (D + F)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `neuro.stroke_followup` | Stroke follow-up | **staged — works today** | Review (+7d) → Review (+30d) → Review (+90d) | stroke, TIA |
| `neuro.neurosurgery_postop` | After neurosurgery | **staged — works today** | Wound check (+7d) → Suture removal (+7d) → Review (+30d) → Scan review (+60d) | neurosurgery, spine surgery |
| `neuro.botox_migraine` | Botox for chronic migraine | **cycle**, every 84d × 4 | Headache days each visit | chronic migraine, Botox |
| `neuro.epilepsy_review` | Epilepsy review | **review**, every 90d | Seizure count each visit | epilepsy, seizures |
| `neuro.parkinson_review` | Parkinson's review | **review**, every 90d | — | Parkinson's |

### 7. Plan config row

**Plan fields:** `condition` (Stroke, Epilepsy, Migraine, Parkinson's, Neuropathy, Post-surgery, Other).
**Step fields:** `seizures_since_last`, `headache_days`, `mrs` (numbers).

### 8. Plan checklist

- [ ] Stroke + post-op work today; Botox waits for `cycle`, reviews for `review`

## 9. Decisions (2026-10-24)

1. Neuro card on the **Right / Left exam grid + single score rows**.
2. **New section order** — complaint first.
3. Neurosurgeon **uses the Neurologist block**.
4. Botox for migraine = **`cycle` template** (every 12 weeks), later.
5. Patient seizure diary **out of scope** now.
