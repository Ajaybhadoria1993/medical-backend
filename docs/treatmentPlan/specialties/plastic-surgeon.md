# Treatment Plan — Plastic Surgeon (end-to-end plan)

Status: **Part A + P1 built (P1 on 2026-10-28).** Lists, order and pre-op tests (LFT, Urine Routine, Anti HCV
added); 4 templates (§3) in `treatmentPlan/seeds/libraryTemplates.json`, cosmetic ones `taxable` and the seed now
copies it; §5 fields in `seeds/specialtyConfigs.json`. Still later, shared: photos on plan steps, body map, GST.
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 6). Clinical values need a plastic surgeon's check.
Covers sub-specialties: Cosmetic, Reconstructive, Hair Transplant Surgeon (`utils/specialtyCatalog.ts`).

**Part A (now):** G4 order + G5 diagnosis / advice → B · G6 pre-op tests → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G2, G3, G7, G8, G9 · §3 templates · §5 plan / step fields · P1.
**Output check:** G1 photos: **visit gallery exists** (shareable); only before / after compare is missing (§8.4).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Diagnosis, Surgery Suggested, Advice, Pre-Diagnosis, Habits, Allergy, Visiting Days, Follow-Up, Vitals, Pathology Test, Diet | BE `utils/doctorSpecialtyConfig.ts` → `Plastic Surgeon` |
| Pick-lists | Diagnosis (scar, hypertrophic scar, excess skin, breast hypertrophy, cyst, cosmetic), complaints (keloid, loose skin, fat, stretch marks, breast, nose), surgeries (rhinoplasty, breast augmentation, liposuction, facelift, blepharoplasty, abdominoplasty, burn reconstruction, cleft lip), garment/sun advice | same file |
| Diagram on prescription | None | FE `PrescriptionSummarySection.tsx` |
| Photos | **None.** Plan holds only a consent file; reports upload on the prescription | BE `treatmentPlan/models/treatmentPlan.model.ts` |
| GST | Template `taxable` flag stored, **not applied** (open item) | BE `treatmentTemplate.model.ts` |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No before / after photos** | Core of cosmetic work: shows result, protects the doctor medico-legally | Photos on a plan step (shared gap — Derm, Dentist, Hair too); private bucket, sign on click |
| G2 | No amounts recorded — fat removed (ml), grafts, implant size (cc) | Defines the procedure and the price | Plan fields (§5) |
| G3 | No drain / garment / splint tracking | Every post-op visit checks these | Step fields (§5) |
| G4 | Section order starts with Diagnosis | Flow is complaint → exam → diagnosis → surgery | Reorder: Pre-Diagnosis → Vitals → Diagnosis → Surgery Suggested → Tests → Advice → Follow-Up |
| G5 | Diagnosis list misses common cases | Keloid, gynecomastia, hair loss, burn contracture, cleft, droopy eyelid are daily | Add (§5) |
| G6 | No pre-op tests | Same panel as General Surgeon | Reuse surgeon's pre-op test list |
| G7 | GST not applied | Cosmetic procedures attract GST; reconstructive often don't | Open item already; mark cosmetic templates `taxable` now so they're ready |
| G8 | Area picked as text only | Face / abdomen / thighs etc. | Area multiselect now; body map = shared widget later |
| G9 | No templates | Plastic gets only generic plans | Add 5 (§3) |

## 3. Templates (4 new)

All staged or package — run on today's engine. Cosmetic ones marked `taxable`.

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|
| `plastic.rhinoplasty` | Rhinoplasty | staged, package, consent, taxable | Pre-op + photos → Surgery (+7d, max 60d, 180 min) → Splint removal (+7d) → Review (+21d) → Review (+60d) → Result review + photos (+90d) | nasal deformity, rhinoplasty |
| `plastic.liposuction` | Liposuction | staged, package, consent, taxable | Pre-op + photos → Surgery (+7d, max 60d, 180 min) → Drain / dressing check (+2d) → Review (+7d) → Review (+21d) → Result review + photos (+60d) | fat deposits, liposuction |
| `plastic.keloid_injections` | Keloid / scar injections | package, per step, 4 sessions × 28d, expiry 180d | — | keloid, hypertrophic scar |
| `plastic.blepharoplasty` | Eyelid surgery (blepharoplasty) | staged, package, consent, taxable | Pre-op + photos → Surgery (+7d, max 60d, 90 min) → Suture removal (+5d) → Review (+21d) → Result review (+60d) | droopy eyelids, dermatochalasis |

Hair transplant: **dropped here** (2026-10-24) — the existing Derm `hair.transplant` is extended instead
and shows to Plastic under "Other specialties" (see `dermatologist.md` G9).

## 4. Diagram / widget

**None needed now.** Plastic work is defined by area + amount + photos, not an exam grid.
- Area = multiselect (§5).
- Photos = the real need (G1) — shared feature, planned once in the research doc.
- Body map (click area on a front / back figure): now wanted by Surgeon and Plastic → candidate to build
  as the shared widget once Derm / Vascular are planned (see `README.md`).

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `area` | Area | multiselect, required | Face, Nose, Eyelids, Ears, Scalp, Neck, Chest / breast, Abdomen, Back, Arms, Thighs, Hands, Other |
| `side` | Side | select | Right, Left, Both, Midline |
| `procedure_kind` | Type | select | Cosmetic, Reconstructive |
| `amount` | Amount | number | ml of fat, grafts, or cc of implant |
| `amount_unit` | Amount unit | select | ml, grafts, cc |
| `anaesthesia` | Anaesthesia | select | Local, Local + sedation, General |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `drain_removed` | Drain removed | boolean | |
| `garment` | Compression garment | select | Not needed, Wearing, Not wearing |
| `splint_removed` | Splint removed | boolean | |
| `healing` | Healing | select | Healthy, Swelling, Bruising, Seroma, Infection |
| `photos_taken` | Photos taken | boolean | until photo upload exists |
| `sutures_removed` | Sutures removed | boolean | |

Prescription config additions:
- **Diagnosis add:** Keloid, Gynecomastia, Androgenetic alopecia, Burn contracture, Cleft lip / palate, Dermatochalasis, Localised fat deposits
- **Tests:** reuse General Surgeon pre-op list
- **Advice add:** Sleep with the head raised, No heavy exercise for 4 weeks, Massage the scar as shown

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 4 templates (§3); seed must copy `taxable` (it doesn't today) | BE | Dentist P1 (config seed) |
| P2 | Section reorder (G4), diagnosis / advice adds (G5), pre-op tests (G6) | BE | General Surgeon P2 |

Shared, later: photos on plan steps (G1), body map (G8), GST applied (G7).

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 4 plastic templates (+ Derm hair transplant under Other specialties) for Plastic and its sub-specialties
- [ ] Steps, gaps, windows and durations match §3 
- [ ] Keloid series = 4 sessions 28 days apart, expires at 180 days
- [ ] Area required (multi); amount + unit, type, anaesthesia save
- [ ] Drain, garment, splint, healing, photos-taken save per step
- [ ] Cosmetic templates show `taxable` set (no tax applied yet — expected)

**P2 — prescription lists**
- [ ] Sections show in the new order for a plastic surgeon only
- [ ] New diagnoses, advice and pre-op tests appear and print
- [ ] Other specialties unchanged

## 8. Decisions (2026-10-24)

1. Photos on plan steps = **next shared feature**, planned after the Wave 1 templates.
2. **Area multiselect now**; body map decided after Dermatologist is planned.
3. Cosmetic templates **marked `taxable` now**; GST applied later.
4. **Keep the templates** (hair transplant later moved to Derm); breast augmentation, abdominoplasty, burn dressings, cleft lip not now.
5. **Keep the "Photos taken" tick** until photo upload exists.
