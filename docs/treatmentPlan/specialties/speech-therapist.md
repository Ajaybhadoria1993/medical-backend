# Treatment Plan — Speech Therapist (end-to-end plan)

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 2, specialty 12). Clinical values need a speech-language pathologist's check.
Covers sub-specialty: Audiologist (`utils/specialtyCatalog.ts`).

**Part A (now):** G1 new Rx config → B · G2 assessment + G3 practice table → G · G4 hearing rows → F · G6 hide medicines → E — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G5, G8 · §3 templates · §5 plan / step fields · P1.
**Output check:** Practice plan must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription config | **None.** Generic lists (fever, cough, URTI…) | BE `utils/doctorSpecialtyConfig.ts` → `GENERIC_DOCTOR_PREFERENCES` |
| Booking symptoms | Stuttering, unclear speech, language delay, hoarse voice, swallowing problems, aphasia after stroke… | FE `constants/specialitySymptoms.ts` |
| Medicine panel | Always shown (decided: hide for non-prescribing, `physiotherapist.md` §8) | FE `PrescriptionSummarySection.tsx` |
| Online sessions | No online / video mode (shared gap, `psychologist.md`) | — |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No prescription config** | Speech therapist sees GP lists | New `Speech Therapist` block (§5) |
| G2 | **No speech assessment** — which area, how severe, goal | Therapy is planned per area (fluency, language, voice, swallowing) | Assessment table (§4) |
| G3 | **No home practice plan** | Daily practice at home is half the therapy, often done by the parent | Practice table (§4) — same build as the Physio exercise table |
| G4 | No hearing record for Audiologists | Hearing test is the Audiologist's main work | Reuse the ENT hearing rows (PTA per ear, loss type) |
| G5 | No session record | Activities done, goal reached %, parent present | Step fields (§5) — non-sensitive only (reception reads plans) |
| G6 | Medicine panel shows | Speech therapists don't prescribe | Hide (shared, decided) |
| G7 | Online sessions | Common for speech therapy | `mode` plan field now; online feature later (decided in Psychologist) |
| G8 | No templates | Speech work is session packages | Add 5 (§3) |

## 3. Templates (5 new)

All package except hearing aid — run on today's engine. "2 a week" ≈ every 3 days (known limit).

| Code | Template | Type / price | Sessions / steps | Keywords |
|---|---|---|---|---|
| `speech.therapy_12` | Speech therapy — 12 sessions | package, package price, 12 × 3d, expiry 60d | 2 a week | articulation, unclear speech, dysarthria |
| `speech.child_language` | Child language delay program | package, package price, 24 × 3d, expiry 100d | 2 a week, parent joins | language delay, late talker, autism |
| `speech.stuttering` | Stuttering (fluency) program | package, package price, 16 × 7d, expiry 150d | Weekly | stuttering, stammering, fluency |
| `speech.swallowing` | Swallowing therapy (dysphagia) | package, per step, 10 × 2d, expiry 30d | Often post-stroke | dysphagia, swallowing difficulty |
| `speech.hearing_aid` | Hearing aid trial + fitting (Audiologist) | staged, per step | Hearing test → Trial (+3d) → Fitting (+7d) → Review (+14d) → Review (+30d) | hearing loss, hearing aid |

Hearing aid was deferred in ENT (`ent-specialist.md` §8) — it lands here under the Audiologist.

## 4. Two tables — simple and dynamic

Both use the shared "rows with + Add" component. Saved in `additionalInformation`.

**Assessment** — one row per area:

| Area | Severity | Goal | Note |
|---|---|---|---|
| Fluency | Moderate | Fluent speech in 2-word phrases | Blocks on /p/, /b/ |
| + Add area | | | |

- Area pick: Articulation, Fluency, Expressive language, Receptive language, Voice, Swallowing, Hearing, Social communication.
- Severity pick: Mild, Moderate, Severe, Profound.
- **Audiologist:** same card adds the ENT hearing rows (PTA dB per ear, loss type) — reuse, not a new build.

**Home practice plan** — prints for the parent / patient (same table as the Physio exercise plan):

| Activity | How often | Minutes | Who helps |
|---|---|---|---|
| Name-the-picture cards | Daily | 10 | Parent |
| + Add activity | | | |

- Activity pick-list (own suggestions can be added): Picture naming, Slow easy speech, Breathing for speech,
  Reading aloud, Oral-motor exercises, Swallowing exercise, Listening game, Story retelling.
- Only filled rows print.

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `area` | Main area | select, required | Articulation, Fluency, Language, Voice, Swallowing, Hearing |
| `age_group` | Age group | select | Child (0–5), Child (6–12), Teen, Adult, Older adult |
| `mode` | Mode | select | In clinic, Online, Mixed |
| `parent_involved` | Parent / carer joins | boolean | |

**Step fields** (non-sensitive — reception can read plans)

| Key | Label | Type | Options |
|---|---|---|---|
| `goal_met` | Goal reached | select | 0–25%, 25–50%, 50–75%, 75–100% |
| `attended_by` | Attended with | select | Alone, Parent, Carer |
| `step_note` | Session note | text | short, non-clinical |

**New prescription config block `Speech Therapist`** (G1):
- **Sections:** Pre-Diagnosis → Diagnosis → Advice → Visiting Days → Follow-Up → Habits (no Vitals, Surgery Suggested, Pathology Test, Diet, Allergy)
- **Habits:** Long screen time (child), Shouting / voice overuse, Smoking, Little talking at home, Mouth breathing
- **Pre-Diagnosis:** Stuttering, Unclear speech, Late talking, Hoarse voice, Swallowing difficulty, Speech loss after stroke, Poor understanding, Hearing difficulty
- **Diagnosis:** Articulation disorder, Stuttering, Expressive language delay, Receptive language delay, Aphasia, Dysarthria, Voice disorder, Dysphagia, Autism-related communication difficulty, Hearing loss
- **Advice:** Practise the home activities every day, Talk slowly and clearly with the child, Limit screen time to under 1 hour a day, Rest the voice and drink warm water, Follow the swallowing positions shown

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | New `Speech Therapist` Rx config block (G1) | BE | — |
| P3 | Assessment + home practice tables; hearing rows for Audiologist (G2–G4) | FE (+ print) | Physio P3 (practice table), ENT P3 (hearing rows) |
| P4 | Hide medicine panel (G6) | FE | Physio P4 (same change) |

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 speech templates for Speech Therapist + Audiologist
- [ ] Sessions, gaps, expiry match §3; hearing aid has 5 steps
- [ ] Area required; age group, mode, parent joins save
- [ ] Goal reached, attended with, note save per session

**P2 — prescription config**
- [ ] Speech therapist sees speech lists, not GP lists
- [ ] Only the 6 sections show
- [ ] Own suggestions still on top; saved section order kept

**P3 — tables**
- [ ] "+ Add area" / "+ Add activity" work; remove works
- [ ] Practice plan prints clearly for the parent
- [ ] Audiologist sees hearing rows; Speech Therapist doesn't
- [ ] Old prescriptions still open

**P4 — medicine panel**
- [ ] No "Add medicine"; prescription completes without medicines

## 8. Decisions (2026-10-24)

1. Audiologist **reuses the ENT hearing rows**.
2. Home practice table **reuses the Physio exercise table** (own columns).
3. Hearing aid trial **lives here under Audiologist**.
4. **Keep the 5 templates**; voice therapy, aphasia rehab, autism group not now.
5. **Age group stays a plan field** (for reports later).
