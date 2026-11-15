# Treatment Plan — Physiotherapist (end-to-end plan)

Status: **All phases built (P1 on 2026-10-28).** Rx config, assessment + exercise tables, medicine panel hidden
(checked 2026-10-28: every §5 list item present, both tables print); 5 templates (§3) in
`treatmentPlan/seeds/libraryTemplates.json`; §5 fields in `seeds/specialtyConfigs.json`. Later, shared: ortho prefill, exercise media.
Parent: `../specialty-rollout-research.md` (Wave 2, specialty 10). Clinical values need a physiotherapist's check.
Covers sub-specialties: Occupational, Sports, Neuro, Orthopedic Physiotherapist (`utils/specialtyCatalog.ts`).

**Part A (now):** G1 new Rx config → B · G2 assessment + G3 exercise table → G · G5 hide medicines + ℞ off → E — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G4, G6, G8 · §3 templates · §5 plan / step fields · P1.
**Output check:** Exercise plan must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription config | **None.** Generic lists (fever, cough, URTI…) | BE `utils/doctorSpecialtyConfig.ts` → `GENERIC_DOCTOR_PREFERENCES` |
| Section control | Only sections in `header_order` render — a config can leave sections out | FE `prescription/details/PrescriptionDetailsPanel.tsx` (`sectionsToRender`) |
| Medicine panel | Always shown ("Add medicine") — not controlled by `header_order` | FE `PrescriptionSummarySection.tsx` |
| Booking symptoms | Post-stroke rehab, stiffness, post-surgery recovery, balance, back / neck pain, sports injury… | FE `constants/specialitySymptoms.ts` |
| Treatment plan templates | 1: Physiotherapy sessions (10 × 2d, expiry 45d) | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |
| Ortho → physio handover | Decided: rehab is always a separate physio plan (`orthopedic-doctor.md` §8) | — |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No prescription config** | Physio sees GP lists | New `Physiotherapist` block (§5), without Surgery Suggested |
| G2 | **No assessment** — pain, movement, muscle power | Physio progress = pain down, movement + power up | Assessment table (§4), reuse Ortho joint table + Power column |
| G3 | **No exercise prescription** | The main thing a physio hands the patient is a home exercise plan | Exercise table on the Rx (§4), prints |
| G4 | No session record — what was done | Each session uses machines / manual therapy; billing and progress need it | Step fields (§5) |
| G5 | Medicine panel shows for physios | Physios don't prescribe medicines | Hide medicine panel for non-prescribing specialties (shared gap — Psychologist, Speech, Dietitian) |
| G6 | Referral from Ortho arrives as a note only | Physio should see the surgery + date + restrictions | Shared "plan step by another doctor" gap |
| G7 | 3 sessions a week | Package repeats every N days, not set weekdays | Every 2 days is close enough (known limit) |
| G8 | Only 1 template | Post-op rehab, stroke, frozen shoulder are daily | Add 5 (§3) |

## 3. Templates (1 existing + 5 new)

All package — run on today's engine. Existing generic one stays for back / neck pain.

| Code | Template | Type / price | Sessions | Keywords |
|---|---|---|---|---|
| `physio.sessions` ✅ | Physiotherapy sessions | package, 10 × 2d, expiry 45d | — | back pain, neck pain |
| `physio.knee_replacement_rehab` | Knee replacement rehab | package, package price, 18 × 2d, expiry 60d | Start after staple removal | TKR, knee replacement rehab |
| `physio.acl_rehab` | ACL reconstruction rehab | package, package price, 24 × 3d, expiry 120d | — | ACL, arthroscopy rehab |
| `physio.frozen_shoulder` | Frozen shoulder | package, package price, 12 × 2d, expiry 45d | — | frozen shoulder, adhesive capsulitis |
| `physio.stroke_rehab` | Stroke rehab (neuro) | package, package price, 24 × 2d, expiry 90d | — | stroke, hemiplegia, paralysis |
| `physio.sports_injury` | Sprain / sports injury | package, per step, 8 × 2d, expiry 30d | — | ankle sprain, sports injury, muscle strain |

## 4. Two tables — simple and dynamic

Both use the shared "rows with + Add" component (Ortho joints, Urology stones, Derm lesions).
Saved in `additionalInformation`.

**Assessment** — Ortho joint table plus a Power column:

| Region | Side | Pain (0–10) | Movement (ROM °) | Power (0–5) |
|---|---|---|---|---|
| Knee | Right | 5 | Flexion 0–80 | 3 |
| + Add region | | | | |

Plus one row: **Balance / walking** — pick: Normal, Needs support, Walker, Wheelchair.

**Home exercise plan** — the physio's "prescription", prints in place of medicines:

| Exercise | Sets × Reps | Hold (sec) | Times a day |
|---|---|---|---|
| Quadriceps setting | 3 × 10 | 5 | 2 |
| + Add exercise | | | |

- Exercise pick-list (own suggestions can be added, like other lists): Quadriceps setting, Straight leg raise,
  Heel slides, Ankle pumps, Pendulum, Wall climbing, Chin tucks, Bridging, Cat-camel, Calf stretch.
- Only filled rows print.
- Plan form: **no widget.** Pain, movement, power are step fields, so each session shows progress.

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `region` | Body region | select, required | Neck, Shoulder, Elbow, Wrist / hand, Upper back, Lower back, Hip, Knee, Ankle / foot, Whole body (neuro) |
| `side` | Side | select | Right, Left, Both |
| `condition` | Condition | select | Post-surgery, Sports injury, Back / neck pain, Frozen shoulder, Stroke, Arthritis, Other |
| `surgery_date` | Surgery date | date | when post-op |
| `referred_by` | Referred by | text | doctor's name |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `modalities` | Treatment given | multiselect | IFT, TENS, Ultrasound, Hot pack, Cold pack, Traction, Laser, Manual therapy, Exercise, Taping |
| `pain_score` | Pain (0–10) | number | 0–10 |
| `rom` | Movement (ROM) | text | e.g. Flexion 0–100 |
| `power` | Muscle power (0–5) | number | 0–5 |
| `step_note` | Progress note | text | short |

**New prescription config block `Physiotherapist`** (G1):
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Advice → Visiting Days → Follow-Up → Habits → Allergy (no Surgery Suggested, no Diet, no Pathology Test)
- **Habits:** Poor posture, Prolonged sitting, Lack of exercise, Heavy lifting, Long screen time
- **Allergy:** Adhesive tape allergy, Gel allergy, Latex allergy
- **Pre-Diagnosis:** Back pain, Neck pain, Knee pain, Shoulder stiffness, Weakness after stroke, Difficulty walking, Sports injury, Post-surgery stiffness
- **Diagnosis:** Mechanical low back pain, Cervical spondylosis, Frozen shoulder, Knee osteoarthritis, Post-TKR rehab, ACL rehab, Hemiplegia, Ankle sprain, Plantar fasciitis, Tennis elbow
- **Advice:** Do the home exercises daily as shown, Stop an exercise if pain sharply increases, Apply a hot pack for 15 minutes before exercise, Keep correct posture at work, Use the walker / support as advised

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | New `Physiotherapist` Rx config block (G1) | BE | — |
| P3 | Assessment + home exercise tables (G2, G3) | FE (+ print) | reuse rows-table build (Ortho P3) |
| P4 | Hide medicine panel for non-prescribing specialties (G5) | FE | shared gap |

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 6 physio templates for Physio + sub-specialties
- [ ] Sessions, gaps, expiry match §3
- [ ] Region required; side, condition, surgery date, referred by save
- [ ] Treatment given (multi), pain, ROM, power save per session and show on plan detail

**P2 — prescription config**
- [ ] Physio sees physio lists, not GP lists
- [ ] Surgery Suggested, Diet, Pathology Test sections don't show
- [ ] Doctor's own suggestions still on top; saved section order kept

**P3 — tables**
- [ ] "+ Add region" / "+ Add exercise" work; remove works
- [ ] Pain 0–10, power 0–5 validate
- [ ] Exercise plan prints clearly (patient takes it home)
- [ ] Old prescriptions still open

**P4 — medicine panel**
- [ ] No "Add medicine" for a physio; medicines still show for every prescribing specialty

## 8. Decisions (2026-10-24)

1. **Hide the medicine panel** for physios; Psychologist, Speech, Dietitian follow.
2. Home exercise plan = **text first**; pictures / videos later.
3. Ortho surgery date + restrictions **prefill the physio plan**, built with the shared "step by another doctor" work.
4. **Keep the 5 templates**; neck pain, plantar fasciitis, post-fracture, chest physio not now.
5. **No Pathology Test** section for physio.
