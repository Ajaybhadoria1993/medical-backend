# Treatment Plan — Ophthalmologist (end-to-end plan)

Status: **plan only — nothing built.** Questions answered (§8). Approve a phase before code.
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 2). Clinical values need an ophthalmologist's check.

**Part A (now):** G5 section order → B · G3 eye-side phrases → C · G1 exam grid → F · G2 spectacle print → D + F · G4 eye tests → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G6, G7, G9 · §3 templates · §5 plan / step fields · P1.
**Output check:** Spectacle Rx must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals (BP, pulse, SpO2, temp, weight), referrals, consent | BE `appointments/models/appointmentClinical.model.ts`, FE `prescription/details/constants.ts` |
| Prescription sections | Diagnosis, Advice, Pre-Diagnosis, Visiting Days, Follow-Up, Allergy, Vitals, Pathology Test, Diet, Habits, Surgery Suggested | BE `utils/doctorSpecialtyConfig.ts` → `Ophthalmologist` |
| Pick-lists | Diagnosis (cataract, conjunctivitis, myopia, presbyopia, glaucoma, diabetic retinopathy, AMD, strabismus), complaints, screen-time habits, eye-drop allergy, surgeries (LASIK, cataract, retinal, corneal) | same file |
| Booking symptoms | Ophthalmologist list incl. "Need for reading glasses" | FE `constants/specialitySymptoms.ts` |
| Diagram on prescription | **None.** Only Dentist (tooth chart) and Ob-Gyn (ovary diagram) have one | FE `PrescriptionSummarySection.tsx` |
| Eye drop instruction | Placeholder text only: "Instil 2 drops into the affected eye" | FE `summary/MedicineCard.tsx` |
| Treatment plan templates | Cataract surgery (surgery → day 1 → week 1 → month 1) | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No Ophthalmologist config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No eye exam** — visual acuity, IOP, refraction | Every eye visit records these; today they go in free-text notes | Right eye / Left eye exam grid on the prescription (§4) |
| G2 | No spectacle prescription print | Glasses Rx is the most common output of an eye clinic | Print the refraction block as a standard spectacle Rx table |
| G3 | Eye drops don't say which eye | "Both eyes" vs "Right eye" is a safety point | Quick picks Right / Left / Both eyes in medicine instructions |
| G4 | No eye test list (OCT, fundus photo, A-scan, visual field, topography, B-scan) | "Pathology Test" is lab only | Specialty test/imaging pick-list (shared gap, also Dentist X-ray) |
| G5 | Section order puts Diagnosis first, Vitals mid | Eye flow is complaint → exam → diagnosis | Reorder: Pre-Diagnosis → Eye exam → Diagnosis → Surgery → Advice → Follow-Up |
| G6 | No config row | Plan can't record eye side, lens, drug | Seed one row (§5) |
| G7 | Only 1 template | LASIK, injections, pterygium, squint are routine | Add 5 templates (§3) |
| G8 | Post-op drop taper (e.g. 6× → 4× → 3× → 2× a day, weekly) | Every cataract/LASIK patient gets one | Note only — tapering dose is a medicine feature, not plan; shared gap |
| G9 | Glaucoma review needs `review` type | Lifelong 3-monthly IOP checks | ✅ Built 2026-10-27: `eye.glaucoma_review`, 4 reviews 90 days apart, per visit; IOP + vision are the step fields |

## 3. Templates (1 existing + 5 new)

> **Built 2026-10-27** in `treatmentPlan/seeds/libraryTemplates.json` (codes below); the §5 plan / step
> fields in `seeds/specialtyConfigs.json`. Seeded as drafts with no fees: Super Admin prices and activates.

All staged — run on today's engine.

| Code | Template | Type / price | Steps | Keywords |
|---|---|---|---|---|
| `eye.cataract` ✅ | Cataract surgery | staged, per step, consent | Surgery → Day 1 (+1d) → Week 1 (+6d) → Month 1 (+23d) | cataract, lens opacity |
| `eye.lasik` | LASIK | staged, package, consent | Pre-op evaluation → Surgery (+3d, max 30d) → Day 1 (+1d) → Week 1 (+6d) → Month 1 (+23d) → Month 3 (+60d) | myopia, refractive error, lasik |
| `eye.anti_vegf` | Anti-VEGF injections (loading) | staged, per step, consent | Injection 1 → Review (+7d) → Injection 2 (+21d, max 35d) → Injection 3 (+28d, max 35d) → Review (+28d) | AMD, macular edema, diabetic retinopathy |
| `eye.pterygium` | Pterygium excision | staged, per step, consent | Surgery → Day 1 (+1d) → Week 1 (+6d) → Month 1 (+23d) | pterygium |
| `eye.squint` | Squint surgery | staged, per step, consent | Pre-op orthoptic check → Surgery (+7d, max 30d) → Day 1 (+1d) → Week 1 (+6d) → Month 1 (+23d) | strabismus, squint |
| `eye.retinal_laser` | Retinal laser (PRP, 3 sittings) | staged, package | Sitting 1 → Sitting 2 (+7d) → Sitting 3 (+7d) → Review (+30d) | diabetic retinopathy, PRP |

## 4. Eye sections — revised 2026-10-24 (Eka Care pad review)

**Shape:** eye data are **sections in the pad**, listed in the Ophthalmologist `header_order`, so a doctor
reorders or hides them in Prescription Preference (as Eka's "Configure your pad"). Each section is a table
(shared exam-grid component); values are **text with example hints**. Saved in `additionalInformation`.

**Section "Visual Acuity"** — rows RE / LE:

| UCDVA | UCNVA | Pinhole | BCDVA | BCNVA |
|---|---|---|---|---|
| e.g. 6/6 | e.g. N6 | e.g. 6/6, HM, PL | e.g. 6/6 | e.g. N6 |

(UC = uncorrected, BC = best corrected, DVA / NVA = distance / near vision; CF, HM, PL, NPL accepted.)

**Section "Subjective Refraction"** — rows RE undilated, LE undilated, RE dilated, LE dilated:

| SPH | CYL | AXIS | ADD | DVA | NVA |
|---|---|---|---|---|---|
| e.g. −1.5 | e.g. −1.5 | e.g. 90° | e.g. +1.5 | e.g. 6/6 | e.g. N6 |

**Section "Auto Refraction"** — same columns and rows (machine reading).

**Section "Eye Exam"** — rows RE / LE: IOP (number 5–60 mmHg), Anterior segment (note), Fundus (note).

- SPH / CYL / ADD in 0.25 steps; AXIS 0–180. **Built 2026-10-27:** SPH ±30, CYL ±10, ADD 0–4 (Plano allowed);
  vision cells accept 6/9, 3/60, N6, a trailing p, CF (+ distance), HM, PL, NPL, PR, NIPH — refused otherwise,
  on screen and on save. Dilated refraction prints only when undilated is empty (`fallbackRows`).
- Glasses Rx (G2) prints from Subjective Refraction (undilated unless only dilated is filled).
- "Copy RE → LE" on every section — most rows match.
- Only the rows the doctor fills print; refraction rows print as a spectacle Rx table (G2).
- Plan form: **no widget.** Eye side is a select; each review step records vision + IOP as step fields.
- Later, only if asked: a clickable eye diagram (lids, cornea, lens, retina) like the ovary diagram.

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `eye` | Eye | select, required | Right, Left, Both |
| `iol_type` | Lens (IOL) | select | Monofocal, Multifocal, Toric, None |
| `iol_power` | IOL power | number (D) | 0–40 |
| `drug` | Injection drug | select | Ranibizumab, Aflibercept, Bevacizumab, Other |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `vision` | Vision | text | e.g. 6/9 |
| `iop` | IOP | number (mmHg) | 5–60 |
| `step_note` | Finding | text | short |

Prescription config additions:
- **Eye tests:** OCT, Fundus photo, A-scan biometry, Visual field (perimetry), Corneal topography, B-scan
- **Instruction picks:** Right eye, Left eye, Both eyes

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (G6) + 5 templates (G7) | BE | Dentist P1 (config seed) |
| P2 | Section reorder (G5), eye test list (G4), eye-side instruction picks (G3) | BE + FE | shared test-list gap |
| P3 | Eye exam grid on the prescription (G1) | FE (+ print) | — |
| P4 | Spectacle Rx print block (G2) | BE print + FE preview | P3 |

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 6 Ophthalmologist templates for an eye doctor
- [ ] Steps, gaps and windows match §3
- [ ] Plan form asks Eye (required); IOL and drug fields save
- [ ] Review steps record vision + IOP; values show on plan detail

**P2 — prescription lists**
- [ ] Sections show in the new order for an eye doctor only
- [ ] Eye tests list shows and prints
- [ ] Eye drop instruction offers Right / Left / Both eyes

**P3 — eye exam grid**
- [ ] Grid shows for an eye doctor only (incl. sub-specialties)
- [ ] Vision picks, IOP 5–60 and refraction 0.25 steps validate
- [ ] "Copy to left eye" works; editing one side doesn't change the other
- [ ] Saved values reload; old prescriptions without the grid still open
- [ ] Only filled rows print

**P4 — spectacle Rx**
- [ ] Refraction prints as a standard table (Sph, Cyl, Axis, Add per eye)
- [ ] Blank refraction = no table printed
- [ ] Preview matches print; Hindi print labels OK

## 8. Decisions (2026-10-24)

1. Vision notation: **6/6 only** (no 20/20).
2. Exam grid sits **beside Vitals** — BP still matters before surgery.
3. Anti-VEGF: **3 loading doses** in the template; doctor adds steps if needed.
4. Spectacle Rx prints **on the main Rx only**; separate optical-shop slip later if asked.
5. Templates: **keep the 5** in §3; DCR, YAG, corneal transplant, patching not now.

**Added 2026-10-24 (Eka Care pad review):**
6. Eye data are **4 sections in the pad** (Visual Acuity, Subjective Refraction, Auto Refraction, Eye Exam), reorderable / hideable.
7. Full rows as in §4: UCDVA, UCNVA, Pinhole, BCDVA, BCNVA; refraction **undilated + dilated** with DVA / NVA.
8. Inputs = **text with example hints**, as Eka.
