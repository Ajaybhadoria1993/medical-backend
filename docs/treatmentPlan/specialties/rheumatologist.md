# Rheumatologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: Biologic infusion = weeks 0, 2, 6, then 3 more every 8 weeks.
Parent: `../specialty-rollout-research.md` (Wave 4, specialty 28). Clinical values need a rheumatologist's check.
Covers: no sub-specialties; also practises General Physician, Immunologist, Pain Management (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** methotrexate must print clearly as **once a week** (safety); rheum card must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` |
| Dose frequency | Daily / Weekly / Custom; Custom = every N days with a dose count → "every 7 days" works | FE `workspace/components/editor/DoseControls.tsx`, `PrescriptionEditorCard.tsx` |
| Booking symptoms | Morning stiffness, swollen joints, muscle pain, dry eyes / mouth, fever + rash, back / hip pain, Raynaud's, widespread pain, abnormal autoimmune tests | FE `constants/specialitySymptoms.ts` |
| Joint table | Planned for Ortho (rows + Add) | `orthopedic-doctor.md` §4 |
| Infusions | Biologic infusion charges billable as clinic services | `appointmentMultipleService` |
| Treatment plan | None; infusion cycles need `cycle` | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Generic lists | New block (§4) | B |
| G2 | **No disease-activity record** — tender / swollen joints, stiffness, ESR / CRP | Treatment is changed by the score | Rheum card (§3) with **DAS28 auto** | F |
| G3 | **Drug-safety checks** — blood tests on methotrexate, TB screen before biologics, eye check on hydroxychloroquine | Serious harm if missed | Safety rows in the card | F |
| G4 | **Methotrexate once a WEEK** | A daily dose by mistake can kill | Instruction phrase "Once a week on ___day — never daily"; browser check that Custom every 7 days prints clearly | C |
| G5 | Rheum tests (RF, anti-CCP, ANA, ESR, CRP, HLA-B27, uric acid) | Lab catalog | Step I | I |

### 3. Rheum card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).
Joint counts are two numbers — no 28-joint picture (body map can add one later).

| Group | Row | Input |
|---|---|---|
| Activity | Morning stiffness (min) | number 0–600 |
| | Tender joints (of 28) | number 0–28 |
| | Swollen joints (of 28) | number 0–28 |
| | ESR (mm/hr) | number 0–150 |
| | CRP (mg/L) | number 0–300 |
| | Patient global (0–100) | number |
| | DAS28-ESR | **auto** from the 4 values above; read-only |
| | Activity | **auto**: Remission < 2.6, Low ≤ 3.2, Moderate ≤ 5.1, High > 5.1 |
| Safety | Blood tests on methotrexate | pick: Up to date, Due, Abnormal |
| | TB screen before biologic | pick: Not needed, Negative, Positive, Not done |
| | Eye check on hydroxychloroquine | pick: Not needed, Done this year, Due |
| Gout | Uric acid (mg/dL), last | number 1–20 |

Only filled rows print.

### 4. Prescription config

**New block `Rheumatologist`:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Allergy → Habits → Pathology Test → Advice → Dietary Suggestions → Visiting Days → Follow-Up (no Surgery Suggested)
- **Habits:** Smoking, Alcohol, Inactive, High purine diet (gout)
- **Allergy:** Sulfa allergy, Drug allergy, Methotrexate intolerance
- **Pre-Diagnosis:** Joint pain, Morning stiffness, Swollen joints, Back stiffness, Rash, Mouth ulcers, Dry eyes / mouth, Fingers turn blue in cold
- **Diagnosis:** Rheumatoid arthritis, Ankylosing spondylitis, Psoriatic arthritis, Gout, SLE (lupus), Sjögren's syndrome, Fibromyalgia, Osteoarthritis, Polymyalgia rheumatica, Systemic sclerosis, Reactive arthritis, Vasculitis
- **Advice:** Methotrexate is taken ONCE A WEEK — never daily, Take folic acid as written (not on the methotrexate day), Get the blood test every ___ weeks, Report fever, cough or mouth ulcers at once, Get the eye check every year on hydroxychloroquine
- **Diet:** Limit red meat, organ meat and alcohol (gout), Drink 2–3 litres of water (gout), Calcium + vitamin D foods on steroids

**Instruction phrase (Tablet, step C):** "Once a week on ___day — never daily".

### 5. Checklist (tick in browser)

- [ ] Rheumatologist sees rheum lists (B)
- [ ] **Methotrexate set as Custom every 7 days prints as once a week, with the day** (C — safety)
- [ ] DAS28-ESR matches a standard calculator for 3 test patients; activity label correct (F)
- [ ] DAS28 empty if any of the 4 inputs is missing (F)
- [ ] Safety rows save; only filled rows print (D + F)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `rheum.biologic_infusion` | Biologic infusion cycle | **cycle**, e.g. 0 / 2 / 6 weeks then every 8 weeks | Infusion each visit | biologic, infliximab, rituximab |
| `rheum.ra_review` | RA review | **review**, every 90d | DAS28 each visit | rheumatoid arthritis |
| `rheum.mtx_monitoring` | Methotrexate monitoring | **review**, every 60d | Blood tests each visit | methotrexate |
| `rheum.gout_titration` | Gout — urate-lowering start | **staged — works today** | Start → Review (+14d) → Review (+28d) → Review (+56d) | gout, uric acid |
| `rheum.steroid_taper` | Steroid taper | **staged — works today** | Start → Review (+14d) → Review (+14d) → Review (+28d) | steroid taper, PMR |

### 7. Plan config row

**Plan fields:** `condition` (RA, AS, PsA, Gout, SLE, Other).
**Step fields:** `das28` (number), `uric_acid` (number).

### 8. Plan checklist

- [ ] Gout + steroid taper work today; infusion waits for `cycle`, reviews for `review`

## 9. Decisions (2026-10-24)

1. Joint counts = **two numbers + auto DAS28**; no joint picture now.
2. Methotrexate **"once a week — never daily" phrase + print safety check — high priority**.
3. **Safety rows** (blood tests, TB screen, eye check) in the card.
4. **No Surgery Suggested** section.
5. Biologic infusion = **`cycle` template**, later.
