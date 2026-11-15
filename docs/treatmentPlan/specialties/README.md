# Treatment Plan — Specialty Tracker

One file per specialty, made from `_TEMPLATE.md` only when that specialty starts.
Shared engine work (seeds, review / cycle / timeline, Rx → plan) lives in `../specialty-rollout-research.md`.

Flow per specialty: plan → approval → build → browser check → tick here.

**Build order decided 2026-10-24:** prescription / visit gaps first → [prescription-first-plan.md](prescription-first-plan.md).
Treatment-plan work (config rows, templates, seeds) comes after, as its own phase.
Legend: ✅ done · 🟡 in progress (🟡 lists = own prescription lists built, step B) · — not started

| # | Specialty | Wave | Plan | Built | Checked | File |
|---|---|---|---|---|---|---|
| 1 | Dentist | 1 Staged | ✅ | — | — | [dentist.md](dentist.md) |
| 2 | Ophthalmologist | 1 Staged | ✅ | 🟡 lists | — | [ophthalmologist.md](ophthalmologist.md) |
| 3 | General Surgeon | 1 Staged | ✅ | 🟡 lists | — | [general-surgeon.md](general-surgeon.md) |
| 4 | Orthopedic Doctor | 1 Staged | ✅ | 🟡 lists | — | [orthopedic-doctor.md](orthopedic-doctor.md) |
| 5 | ENT Specialist | 1 Staged | ✅ | 🟡 lists | — | [ent-specialist.md](ent-specialist.md) |
| 6 | Plastic Surgeon | 1 Staged | ✅ | 🟡 lists | — | [plastic-surgeon.md](plastic-surgeon.md) |
| 7 | Urologist | 1 Staged | ✅ | 🟡 lists | — | [urologist.md](urologist.md) |
| 8 | Vascular Specialist | 1 Staged | ✅ | 🟡 lists | — | [vascular-specialist.md](vascular-specialist.md) |
| 9 | Dermatologist | 2 Package | ✅ | 🟡 lists | — | [dermatologist.md](dermatologist.md) |
| 10 | Physiotherapist | 2 Package | ✅ | 🟡 lists | — | [physiotherapist.md](physiotherapist.md) |
| 11 | Psychologist | 2 Package | ✅ | 🟡 lists | — | [psychologist.md](psychologist.md) |
| 12 | Speech Therapist | 2 Package | ✅ | 🟡 lists | — | [speech-therapist.md](speech-therapist.md) |
| 13 | Dietitian / Nutritionist | 2 Package | ✅ | 🟡 lists | — | [dietitian-nutritionist.md](dietitian-nutritionist.md) |
| 14 | Ayurvedic Doctor | 2 Package | ✅ | 🟡 lists | — | [ayurvedic-doctor.md](ayurvedic-doctor.md) |
| — | *Engine: build review type* | — | — | — | — | research doc |
| 15 | Homeopathic Doctor | 3 Review | ✅ | 🟡 lists | — | [homeopathic-doctor.md](homeopathic-doctor.md) |
| 16 | General Physician | 3 Review | ✅ | 🟡 lists | — | [general-physician.md](general-physician.md) |
| 17 | Endocrinologist | 3 Review | ✅ | 🟡 lists | — | [endocrinologist.md](endocrinologist.md) |
| 18 | Cardiologist | 3 Review | ✅ | 🟡 lists | — | [cardiologist.md](cardiologist.md) |
| 19 | Gastroenterologist | 3 Review | ✅ | 🟡 lists | — | [gastroenterologist.md](gastroenterologist.md) |
| 20 | Pulmonologist | 3 Review | ✅ | 🟡 lists | — | [pulmonologist.md](pulmonologist.md) |
| 21 | Geriatrician | 3 Review | ✅ | 🟡 lists | — | [geriatrician.md](geriatrician.md) |
| 22 | Psychiatrist | 3 Review | ✅ | 🟡 lists | — | [psychiatrist.md](psychiatrist.md) |
| 23 | Emergency Medicine | 3 Review | ✅ | 🟡 lists | — | [emergency-medicine.md](emergency-medicine.md) |
| 24 | Anesthesiologist | 3 Review | ✅ | 🟡 lists | — | [anesthesiologist.md](anesthesiologist.md) |
| 25 | Ophthalmologist (Glaucoma review) | 3 Review | ✅ | — | — | [ophthalmologist.md](ophthalmologist.md) (Part B) |
| — | *Engine: build cycle type* | — | — | — | — | research doc |
| 26 | Oncologist | 4 Cycle | ✅ | 🟡 lists | — | [oncologist.md](oncologist.md) |
| 27 | Nephrologist | 4 Cycle | ✅ | 🟡 lists | — | [nephrologist.md](nephrologist.md) |
| 28 | Rheumatologist | 4 Cycle | ✅ | 🟡 lists | — | [rheumatologist.md](rheumatologist.md) |
| 29 | Hematologist | 4 Cycle | ✅ | 🟡 lists | — | [hematologist.md](hematologist.md) |
| 30 | Immunologist | 4 Cycle | ✅ | 🟡 lists | — | [immunologist.md](immunologist.md) |
| 31 | Neurologist | 4 Cycle | ✅ | 🟡 lists | — | [neurologist.md](neurologist.md) |
| — | *Engine: build timeline type* | — | — | — | — | research doc |
| 32 | Pediatrician | 5 Timeline | ✅ | 🟡 lists | — | [pediatrician.md](pediatrician.md) |
| 33 | Fertility Specialist | 5 Timeline | ✅ | 🟡 lists | — | [fertility-specialist.md](fertility-specialist.md) |
| 34 | Gynecologist | 6 Last | ✅ | 🟡 lists | — | [gynecologist.md](gynecologist.md) |

## Specialties with no prescription config (get generic lists)

Checked 2026-10-24: 15 of 33 mains had none. **All 15 built 2026-10-26** (step B batches 1–3, one file each in
`src/utils/specialties/`). Every catalog main now has its own lists; no specialty falls back to the generic ones.

## Shared gaps found while planning

A gap found in one specialty that others will hit too — fix once, here, not per file.

| Gap | Found in | Also affects | Status |
|---|---|---|---|
| No config-row seed | Dentist | every specialty | — |
| ~~Specialty match is an exact name~~ — **not a gap**: `speciality` is always saved as the catalog main | Dentist | — | corrected (step A dropped) |
| Prescription → plan has no link / prefill | Dentist | every specialty | — |
| No specialty test / imaging list (lab only today) | Dentist (X-ray), Ophthalmologist (OCT…) | Ortho, ENT, Cardio, Gastro… | — |
| No side / laterality preset (Right / Left / Both) | Ophthalmologist | Ortho, ENT, Vascular, Plastic, Urology | — |
| No tapering dose in medicines | Ophthalmologist (drops) | Derm, Rheum, Pulmo (steroids) | — |
| No one-click test panel (e.g. pre-op panel) | General Surgeon | all surgical, Gyn (antenatal), Endo | — |
| No body map widget (click a body region) | General Surgeon | Ortho, Plastic, Derm, Physio, Vascular | — |
| No discharge summary | General Surgeon | all surgical specialties | — |
| Step fields show on every step, not per step | General Surgeon | Ortho, ENT, Plastic, Urology | — |
| Plan step done by another doctor (e.g. physio rehab) | Orthopedic Doctor | Ortho → Physio, Surgeon → Dietitian | — |
| **8 sub-specialty Rx configs are never used** (main always wins): General Practitioner, Obstetrician, Orthopedic Surgeon, Interventional Cardiologist, Andrologist, Cardiothoracic Surgeon, Chest Specialist, Cosmetologist; `Family Medicine` matches no catalog name; Diabetologist used only by Endocrinologists | General Physician | Gyn, Cardio, Ortho, Urology, Derm, Pulmo | ✅ **done 2026-10-26** — 10 blocks merged into their mains (duplicates and off-topic items skipped) and deleted |
| Patient profile (blood group, allergies, chronic conditions) exists but is not shown in the Rx | General Physician | every specialty (Dentist, Surgeon first) | step J |
| No "all current medicines from all doctors" list (polypharmacy) | Geriatrician | GP, Cardio, Psychiatry, any elderly patient | — |
| No large-font print option | Geriatrician | any elderly patient | — |
| No voice-to-prescription, no AI assist, no "push updates" to the patient (Eka Care has all three) | Eka review | every specialty | later |
| Plan step gap max 365 days — long-term items (IUD removal, implant removal) must be profile chips | Gynecologist | Ortho (implant removal), Dentist (implant review) | by design |
| No vaccination record anywhere (patient-level) | Pediatrician | GP (adult vaccines), Gyn (TT), Emergency (rabies) | step K |
| No medico-legal case (MLC) / injury certificate — print says "Not valid for medico-legal purposes" | Emergency Medicine | Ortho, Surgeon, GP | — |
| One Right / Left exam-grid component, config per specialty | Ophthalmologist, ENT | Ortho (joint table), Vascular | — |
| ~~OPD procedures not billed~~ — **exists**: clinic services per appointment (output check §8.4) | ENT | Surgeon, Derm, Dentist | covered |
| **Default teaching images per specialty already exist** (up to 20 per specialty in S3, doctor gallery, shareable); not yet checked which specialties have a folder | missed until 2026-10-24 | every specialty | check pending |
| Photos exist per visit (patient gallery, shareable); missing: before / after compare + link from plan step | Plastic Surgeon | Derm, Dentist, Physio | partly covered (§8.4) |
| 3 print paths; quick-print + patient-page PDF drop specialty data entirely | output check | every card specialty | step D |
| Only a sick-leave medical certificate — no fitness / return-to-work / school types | output check | Surgeon, Ortho, Physio, Pediatrician | — |
| Patient gets no prescription on WhatsApp; patient portal Reports page is sample data | output check | every specialty | — |
| GST stored (`taxable`) but not applied | Plastic Surgeon | Derm, Dentist (cosmetic) | — |
| Library seed drops `taxable` + `instalmentsAllowed` from the JSON | Plastic Surgeon, Dentist (braces) | any template using them | — |
| Receptionists can read plans (`STAFF`) — plan / step fields must hold no sensitive clinical notes | Psychologist | Psychiatrist, Venereologist, Fertility, any notes in step fields | — |
| No online / video appointment mode | Psychologist | Psychiatrist, Dietitian, Speech, Homeopathy | — |
| No weight / vitals trend across visits | Dietitian | GP, Endocrinologist, Gyn, Pediatrician (growth) | — |
| No booking symptoms list (checked all 33) | Dietitian | Anesthesiologist only | step C (both) |
| Medicine panel always shows, even for non-prescribing specialties | Physiotherapist | Psychologist, Speech Therapist, Dietitian | — |
| Seed never updates a template once inserted; new ones land as drafts with no fees → SA must edit / activate | Dermatologist | every specialty (each needs an SA browser step) | by design |
| One "rows with + Add" table component, config per specialty | Ortho (joints), Urologist (stones) | Derm (lesions), Vascular | — |
| `window_missed` declared but never set — no missed-step flag or reminder (e.g. DJ stent) | Urologist | every staged plan; Ortho, Gyn (IUD) | — **build early** (decided 2026-10-24) |
