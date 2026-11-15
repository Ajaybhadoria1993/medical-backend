# Treatment Plan — Dentist (end-to-end plan)

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 1). Clinical values need a dentist's check.

**Part A (now):** G1 tooth status → H · G2 X-ray → I · G3 medical history → J (patient profile, exists) — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G4, G5, G7, G8 · §3 templates · §5 plan / step fields · P1, P4, P5 (G6 Rx → plan).
**Output check:** Dental chart missing from quick-print + patient-page PDF → D.

## 1. The dentist's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals (JSON), referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Vitals, Pre-Diagnosis, Allergy, Habits, Pathology Test, Diagnosis, Surgery Suggested, Advice, Visiting Days, Follow-Up, Diet | BE `utils/doctorSpecialtyConfig.ts` → `Dentist` |
| Dentist pick-lists | Diagnosis (caries, pulpitis, gingivitis, periodontitis, abscess, impacted, cracked), complaints, dental habits, anaesthesia/latex/metal allergy | same file |
| Tooth chart (prescription) | 32-tooth SVG chart, click a tooth → free-text note (3–200 chars), saved as `{ "Tooth-16": "note" }` in `additionalInformation`, prints on the Rx | FE `prescription/workspace/components/dental/DentalChart.tsx` |
| Treatment plan templates | Root canal, Implant, Teeth whitening | BE `treatmentPlan/seeds/libraryTemplates.json` |
| Plan specialty fields | Engine supports them; **no Dentist config row** exists | `treatment_specialty_configs` |
| Plan tooth widget | Super Admin can pick `tooth_chart`, but **nothing draws it** on the plan form | FE `SpecialtyConfigModal.tsx` |
| Plan ↔ consultation | Plan stores `consultationAppointmentId`; diagnosis keywords show as hints on Plan create | FE `PlanCreatePage.tsx` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | Tooth chart notes are free text only | No tooth status (missing, filled, decayed), nothing to report or plan from | Add a status pick per tooth beside the note (§4) |
| G2 | No dental X-ray list (IOPA, OPG, CBCT, Bitewing) | "Pathology Test" is for lab tests; dentists order X-rays every day | Add an "X-ray / Imaging" pick-list to the Dentist config |
| G3 | No dental medical-history flags | Diabetes, blood thinners, heart condition, pregnancy, bisphosphonates change extraction/implant safety | **Corrected 2026-10-24:** patient profile already has chronic conditions + allergies + blood group — show them in the Rx (step J) and add options Blood thinners, Pregnancy, Bisphosphonates, Bleeding disorder |
| G4 | No Dentist plan config row | Plan can't record teeth, arch, anaesthesia | Seed one platform row (§5) |
| G5 | `tooth_chart` widget never renders | Doctor picks teeth from a 32-option list, slow | Reuse the prescription chart in the plan form (§4) |
| G6 | Prescription → plan has no link | Doctor diagnoses on Rx, then retypes everything on a new plan | "Start treatment plan" from the Rx, prefilled (§4) |
| G7 | Only 3 templates | Braces, gum treatment, bridge, denture, extraction are daily work | Add 5 templates (§3) |
| G8 | Config rows have no seed | Every new specialty needs one | Insert-if-missing seed, same rule as templates |
| G9 | ~~Dentist detection is exact name `dentist`~~ | **Corrected 2026-10-24:** `speciality` is always the catalog main, so dental sub-specialties already get the chart | No change needed (step A dropped) |

## 3. Templates (3 existing + 5 new)

All staged or package — run on today's engine.

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|
| `dental.root_canal` ✅ | Root canal | staged, per step, consent | Access → Cleaning (+2d) → Medication (+3d) → Obturation (+3d) → Crown (+7d) | rct, pulpitis, abscess |
| `dental.implant` ✅ | Implant | staged, per step, consent | Placement → Review (+7d) → Impression (+90d) → Crown (+7d) | missing tooth, implant |
| `dental.teeth_whitening` ✅ | Whitening | package, 2 × 7d, expiry 30d | — | stains, whitening |
| `dental.ortho_braces` | Braces | package, instalments, consent | 19 sessions × 30d (session 1 = bonding), expiry 30 months | malocclusion, braces |
| `dental.scaling_root_planing` | Gum treatment | staged, per step | Upper scaling → Lower scaling (+7d) → Review (+28d, max 42d) | periodontitis, bleeding gums |
| `dental.fixed_bridge` | Bridge (3-unit) | staged, per step, consent | Prep + impression → Try-in (+7d) → Cementation (+3d) → Review (+14d) | missing tooth, bridge |
| `dental.complete_denture` | Complete denture | staged, package | Primary imp. → Final imp. (+7d) → Jaw relation (+7d) → Try-in (+7d) → Insertion (+7d) → Review (+3d) | edentulous, denture |
| `dental.surgical_extraction` | Wisdom tooth removal | staged, per step, consent | Extraction (60 min) → Review (+3d) → Suture removal (+7d) | impacted, wisdom tooth |

## 4. Dental tooth chart — simple and dynamic

One chart, reused in three places. No new drawing — the prescription SVG chart already exists.

| Place | What the doctor does | Saves |
|---|---|---|
| Prescription | Click tooth → pick status + optional note | `Tooth-16` note (today) + status |
| Plan form | Click teeth to select (multi); chart replaces the 32-option list | plan field `teeth` = `[16, 26]` |
| Plan step | Step shows its tooth; doctor taps to set | step field `tooth` = `16` |

Tooth status list (one colour each on the chart):
Healthy · Decayed · Filled · Missing · Root canal done · Crown · Implant · Fractured · Mobile · To extract.

Start plan from Rx (G6): on a dentist's prescription, a "Start treatment plan" button opens Plan
create with patient, consultation, diagnosis and the teeth marked on the chart already filled.

## 5. Dentist config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `teeth` | Teeth (FDI) | multiselect (chart widget) | 11–18, 21–28, 31–38, 41–48 |
| `arch` | Arch | select | Upper, Lower, Both |
| `anaesthesia` | Anaesthesia | select | None, Local, Sedation, General |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `tooth` | Tooth (FDI) | select (chart widget) | same 32 |
| `surfaces` | Surfaces | multiselect | Mesial, Distal, Occlusal, Buccal, Lingual |
| `shade` | Shade | text | e.g. A2 |

Prescription config additions (G2, G3):
- **X-ray / Imaging:** IOPA, OPG, Bitewing, CBCT, Lateral ceph
- **Medical History:** Diabetes, Hypertension, Heart condition, Blood thinners, Pregnancy, Bisphosphonates, Bleeding disorder

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config-row seed (G8) + Dentist row (G4) + 5 templates (G7); template seed must copy `instalmentsAllowed` + `taxable` (it drops them today) | BE | — |
| P2 | X-ray + Medical History pick-lists (G2, G3); dentist match on catalog main (G9) | BE + FE | — |
| P3 | Tooth status on the prescription chart (G1) | FE (+ print) | — |
| P4 | Chart widget on plan form + steps (G5) | FE | P1 |
| P5 | "Start treatment plan" from Rx, prefilled (G6) | FE (+ BE if prefill needs it) | P1, P4 |

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Seed runs twice without duplicates (templates and config row)
- [ ] Plan picker shows 8 Dentist templates for a dentist
- [ ] Each new template's steps, gaps and session counts match §3
- [ ] Braces package allows instalments; consent asked where marked
- [ ] Plan form shows Teeth, Arch, Anaesthesia; step shows Tooth, Surfaces, Shade
- [ ] Values save, reload and show on plan detail
- [ ] Super Admin can edit the Dentist row; clinic override still wins

**P2 — prescription sections**
- [ ] X-ray / Imaging list shows for a dentist only, prints on the Rx
- [ ] Medical History list shows, prints, and shows on the next visit
- [ ] A doctor with a dental sub-specialty also gets the chart and lists
- [ ] Non-dentist prescriptions unchanged

**P3 — tooth status**
- [ ] Click tooth → pick status → colour changes
- [ ] Note still works alone (old Rx with notes only still open and print)
- [ ] Status + note print on the Rx
- [ ] Clearing a tooth removes both

**P4 — chart on the plan**
- [ ] Clicking teeth fills plan `teeth`; list and chart stay in sync
- [ ] Step tooth pick limited to the plan's teeth
- [ ] Works on mobile width; dark mode readable

**P5 — Rx → plan**
- [ ] Button shows only for a dentist with edit rights
- [ ] Plan create opens with patient, consultation, diagnosis, teeth filled
- [ ] Template hint matches the diagnosis (e.g. pulpitis → Root canal)
- [ ] Saved plan links back to that appointment

## 8. Questions

1. Tooth status list in §4 — right set, or add/remove?
2. FDI numbering everywhere (prescription already uses FDI) — confirm.
3. Braces as one package, or staged with fixed visits?
4. Should Medical History carry to every future visit of the patient (all specialties), or Dentist only?
5. Phase order OK, or P5 (Rx → plan) earlier?
