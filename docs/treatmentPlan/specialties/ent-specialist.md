# Treatment Plan — ENT Specialist (end-to-end plan)

Status: **plan only — nothing built.** Questions answered (§8). Approve a phase before code.
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 5). Clinical values need an ENT surgeon's check.
Covers sub-specialties: ENT Surgeon, Head and Neck Surgeon (`utils/specialtyCatalog.ts`).

**Part A (now):** G4 diagnosis + advice → B · G1 exam grid + G2 hearing rows → F · G3 ENT tests → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G6, G7 · §3 templates · §5 plan / step fields · P1.
**Output check:** G5 OPD procedures **already billable** as clinic services (output check §8.4).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Pre-Diagnosis, Allergy, Habits, Vitals, Pathology Test, Diagnosis, Advice, Diet, Visiting Days, Follow-Up, Surgery Suggested | BE `utils/doctorSpecialtyConfig.ts` → `ENT Specialist` |
| Pick-lists | Diagnosis (sinusitis, otitis media, allergic rhinitis, tonsillitis, pharyngitis, wax, DNS), complaints (ear pain, blocked nose, hearing loss, discharge, tinnitus, nose bleed, hoarseness), surgeries (tonsillectomy, septoplasty, ear, sinus), gargle/steam advice | same file |
| Diagram on prescription | None | FE `PrescriptionSummarySection.tsx` |
| Hearing test fields | **None** anywhere | — |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

Section order already starts with complaints — fits ENT; only the exam needs adding.

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No ENT exam** — ear drum, nose, throat | Every ENT visit examines all three | Ear / Nose / Throat exam grid on the prescription (§4) |
| G2 | **No hearing record** — tuning fork, audiometry | Hearing loss is a top complaint; result decides surgery or hearing aid | Hearing rows in the same grid (§4) |
| G3 | No ENT test list (PTA, tympanometry, nasal endoscopy, CT PNS, laryngoscopy, BERA) | "Pathology Test" is lab only | Shared test/imaging list gap |
| G4 | Diagnosis list misses common cases | Vertigo, CSOM, polyps, epistaxis, SNHL, adenoids are daily | Add to diagnosis list (§5) |
| G5 | OPD procedures (wax removal, nasal pack, foreign body) not billed as a procedure | Done in the visit, not a plan | Out of plan scope; note for billing |
| G6 | Nasal pack removal / graft check not recorded | Post-op visits check these | Step fields (§5) |
| G7 | No templates | ENT gets only generic plans | Add 5 (§3) |

## 3. Templates (5 new)

> **Built 2026-10-27** in `treatmentPlan/seeds/libraryTemplates.json` (codes below); the §5 plan / step
> fields in `seeds/specialtyConfigs.json`. Surgeries are one package price; ear wax is two named steps
> (not a package, so no 21-day expiry). Seeded as drafts with no fees: Super Admin prices and activates.

All staged or package — run on today's engine.

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|
| `ent.tonsillectomy` | Tonsillectomy | staged, package, consent | Pre-op check → Surgery (+3d, max 30d, 60 min) → Review (+7d) → Final review (+7d) | chronic tonsillitis, tonsils |
| `ent.septoplasty` | Septoplasty | staged, package, consent | Pre-op check → Surgery (+3d, max 30d, 60 min) → Pack removal (+2d) → Review (+7d) → Final review (+21d) | DNS, deviated septum, blocked nose |
| `ent.fess` | Sinus surgery (FESS) | staged, package, consent | Pre-op + CT PNS review → Surgery (+3d, max 30d, 120 min) → Pack removal (+2d) → Nasal cleaning (+7d) → Review (+14d) → Final review (+28d) | chronic sinusitis, nasal polyps, FESS |
| `ent.tympanoplasty` | Ear drum repair (tympanoplasty) | staged, package, consent | Pre-op + PTA → Surgery (+3d, max 30d, 120 min) → Pack / suture removal (+7d) → Review (+21d) → Hearing test review (+60d) | CSOM, perforation, tympanoplasty |
| `ent.ear_wax` | Ear wax removal | package, per step, 2 sessions × 5d, expiry 21d | Session 1 = start softening drops; session 2 = removal | ear wax, impacted wax |

## 4. ENT sections — revised 2026-10-24 (research + Eka Care pad)

**Shape:** ENT data are **sections in the pad** (like Vitals, Diagnosis), listed in the ENT `header_order`,
so a doctor reorders or hides them in Prescription Preference. Each section is a table (shared exam-grid
component). Values = **text with example hints** (as Eka), findings = **dropdowns**. Saved in `additionalInformation`.

**Section "Ear Exam"** — rows RE / LE:

| Column | Input |
|---|---|
| Ear canal | pick: Clear, Wax, Discharge, Swelling, Foreign body |
| Ear drum | pick: Intact, Perforated, Retracted, Bulging, Dull — **"Draw" opens the ear-drum diagram** |
| Rinne (512 Hz) | pick: +, − |
| Tympanogram | pick: A, As, Ad, B, C (Jerger) |

Single rows: **Weber** — pick Centre / Right / Left.

**Ear-drum diagram** (pop-up, one per ear, same mechanism as the existing ovary diagram): 4 quadrants
(antero-superior, antero-inferior, postero-superior, postero-inferior) + attic. Click a part → finding
(Perforation, Retraction, Tympanosclerosis, Cholesteatoma, Fluid). Perforation adds type (Central, Marginal,
Attic) and size (< 25%, 25–50%, 50–90%, Total). **Marginal / attic → red "Unsafe ear" label** (cholesteatoma risk).

**Section "Hearing"** — rows RE / LE:

| Column | Input |
|---|---|
| 500, 1000, 2000, 4000 Hz | number −10 to 120 dB, hint "e.g. 20" |
| PTA | **auto** — average of the 4 |
| Grade | **auto** (WHO 2021): < 20 Normal · 20–34 Mild · 35–49 Moderate · 50–64 Moderately severe · 65–79 Severe · 80–94 Profound · ≥ 95 Complete |
| Type | pick: None, Conductive, Sensorineural, Mixed |

Small audiogram drawn from the numbers: frequency across, dB down, **O red = right, X blue = left** (ASHA symbols).
Audiologist sees this section only.

**Section "Nose & Throat"** — single rows: Septum (pick: Straight, Deviated right, Deviated left),
Turbinates (Normal, Enlarged, Pale), Polyps (No, Right, Left, Both), Tonsils (Brodsky 0–4 with hint:
0 in fossa · 1 ≤ 25% · 2 26–50% · 3 51–75% · 4 > 75%), Throat note (text).

**Grey hints (screen only, never printed; the doctor decides):**
- Rinne − in an ear + Weber to that ear → "Suggests conductive loss, that ear"
- Rinne + both + Weber to one ear → "Suggests sensorineural loss, other ear"
- Rinne + both + Weber centre → "Normal or equal loss both ears"
- Tympanogram B → "Fluid or perforation"; C → "Negative pressure (Eustachian tube)"
- Marginal / attic perforation → "Unsafe ear"

**Print (step D):** text only, filled rows only, no hints, no drawing — e.g.
"Left ear: TM central perforation, antero-inferior, 25–50%. Hearing PTA 48 dB (Moderate)."

- "Copy right → left" on Ear Exam and Hearing.
- **Existing setup to reuse:** the ENT default gallery images (S3 `Doctor Images/ENT Specialist/`, if the folder exists) can be offered next to Ear Exam to explain the finding to the patient — check which images exist first.
- Plan form: **no widget.**
- References: WHO hearing grades (PMC11266198), ASHA audiometric symbols, LITFL tuning-fork tests,
  Jerger tympanogram types, Brodsky tonsil scale — **values need an ENT surgeon's check**.

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `site` | Area | select, required | Ear, Nose, Sinus, Throat, Neck |
| `side` | Side | select | Right, Left, Both |
| `procedure` | Procedure | select | Tonsillectomy, Adenoidectomy, Septoplasty, FESS, Tympanoplasty, Mastoidectomy, Wax removal, Other |
| `anaesthesia` | Anaesthesia | select | Local, General |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `pack_removed` | Pack removed | boolean | |
| `healing` | Healing | select | Healthy, Crusting, Slough, Infected, Bleeding |
| `graft` | Graft | select | Not applicable, Taken, Partial, Failed |
| `hearing_db` | Hearing (dB) | number | −10 to 120 |
| `step_note` | Finding | text | short |

Prescription config additions:
- **Diagnosis add:** Vertigo (BPPV), CSOM, Nasal polyps, Epistaxis, Sensorineural hearing loss, Laryngitis, Adenoid hypertrophy, Foreign body
- **ENT tests:** Pure tone audiometry, Tympanometry, Diagnostic nasal endoscopy, CT PNS, Laryngoscopy, BERA, X-ray soft tissue neck
- **Advice add:** Keep water out of the ear, Do not blow the nose hard, Sleep with the head raised

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | Diagnosis / advice adds (G4) | BE | — |
| P3 | ENT exam grid with hearing rows (G1, G2) | FE (+ print) | reuse eye-grid build (Ophthalmologist P3) |

Shared, later: ENT tests list (G3).

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 ENT templates for ENT and its sub-specialties
- [ ] Steps, gaps, surgery windows and durations match §3
- [ ] Wax removal = 2 sessions 5 days apart, expires at 21 days
- [ ] Area required; side, procedure, anaesthesia save
- [ ] Pack removed, healing, graft, hearing dB save per step and show on plan detail

**P2 — prescription lists**
- [ ] New diagnoses and advice appear and print
- [ ] Other specialties unchanged

**P3 — ENT exam grid**
- [ ] Grid shows for ENT only (incl. sub-specialties)
- [ ] Right / Left values independent; "Copy to left" works
- [ ] Hearing dB limited to −10 to 120 (−10 is a real reading); single-value rows (Weber, septum, tonsils) save once
- [ ] Saved values reload; old prescriptions still open
- [ ] Only filled rows print

## 8. Decisions (2026-10-24)

1. ENT grid **reuses the eye-grid component** — one build, a config per specialty.
2. ~~One PTA number per ear~~ — **replaced 2026-10-24:** 4 values per ear (500 / 1k / 2k / 4k), PTA + WHO grade auto, small audiogram.
3. **Keep the 5 templates**; adenoidectomy, Epley, hearing aid trial, mastoidectomy not now.
4. OPD procedures **already billable** as clinic services (output check §8.4).
5. Tonsil size = **grade 0–4 (Brodsky)**.

**Added 2026-10-24 (research + Eka Care pad review):**
6. ENT data are **sections in the pad** (Ear Exam, Hearing, Nose & Throat), reorderable / hideable via Prescription Preference.
7. Inputs = **text with example hints for values, dropdowns for findings**.
8. **Ear-drum diagram** (quadrants + attic) with the **"Unsafe ear"** label.
9. **Grey interpretation hints** — screen only, never printed.
10. **Tympanogram** type included (Jerger A / As / Ad / B / C).
11. Print = **text only** for now; drawing on print later.
