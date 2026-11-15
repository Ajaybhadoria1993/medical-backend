# Treatment Plan — Dermatologist (end-to-end plan)

Status: **Part A + P1 built (P1 on 2026-10-28).** Lists and lesion table done earlier; tests add Wood Lamp
Examination, Dermoscopy (+ LFT, Lipid, Ferritin quick); 4 new templates (acne course **skipped** — the existing
`derma.acne_review` covers it) and the 4 existing ones updated in the JSON for fresh DBs; §5 fields seeded.
**P1b (Super Admin, existing DBs):** edit hair transplant steps + taxable, mark laser / PRP / peel taxable.
Parent: `../specialty-rollout-research.md` (Wave 2, specialty 9). Clinical values need a dermatologist's check.
Covers sub-specialties: Trichologist, Cosmetologist, Venereologist (`utils/specialtyCatalog.ts`).

**Part A (now):** G6 diagnosis / advice → B · G1 lesion table → G · G7 derm tests → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G2, G4, G5, G8, G9, G10 · §3 templates · §5 plan / step fields · P1, P1b.
**Output check:** G3 photos: **visit gallery exists** (shareable); only before / after compare is missing (§8.4).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Pre-Diagnosis, Diagnosis, Habits, Allergy, Pathology Test, Advice, Diet, Visiting Days, Follow-Up, Vitals, Surgery Suggested | BE `utils/doctorSpecialtyConfig.ts` → `Dermatologist` |
| Pick-lists | Diagnosis (acne, atopic / seborrheic / contact dermatitis, tinea, psoriasis, rosacea, cellulitis), complaints (itching, rash, pimples, hair fall, pigmentation, hives, nails), procedures (biopsy, laser, mole removal, scar revision), sunscreen / moisturiser advice | same file |
| Diagram on prescription | None | FE `PrescriptionSummarySection.tsx` |
| Photos | None (shared gap, from Plastic) | — |
| Treatment plan templates | 4: Hair transplant (staged), Laser hair reduction (6 × 28d), Hair PRP (4 × 30d), Chemical peel (4 × 14d) | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

Section order (complaint → diagnosis first, vitals late) already fits skin work.

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No lesion record** — where, what type, size, how many | The skin exam *is* the lesion description | Lesion table on the prescription (§4) |
| G2 | **No severity scores** — PASI, SCORAD, acne grade, VASI | Shows if treatment is working | Step fields (§5) |
| G3 | **No photos** | Derm progress is judged by photos more than any other specialty | Shared photo gap (from Plastic) — Derm is the main user |
| G4 | **No skin type (Fitzpatrick I–VI)** | Laser / peel settings and burn risk depend on it | Plan field, required for laser / peel (§5) |
| G5 | Isotretinoin monitoring | Acne course needs LFT, lipids, pregnancy test for women | Tests + advice adds; monthly review step |
| G6 | Diagnosis list misses common cases | Vitiligo, melasma, urticaria, scabies, warts, alopecia, herpes zoster, nail fungus are daily | Add (§5) |
| G7 | No derm tests (KOH, patch test, Wood's lamp, dermoscopy, biopsy) | Basic derm workup | Shared test list gap |
| G8 | Existing cosmetic templates not `taxable` | Laser, peel, PRP are cosmetic | Mark taxable (seed fix from Plastic P1) |
| G9 | **Hair transplant twice** — `hair.transplant` here and `plastic.hair_transplant` planned for Plastic | Two templates for one procedure | Keep this one, extend its steps; drop the Plastic one (§3) |
| G10 | Phototherapy is 2–3 × a week | Package repeats every N days, not fixed weekdays | Every 3 days is close enough (known limit) |

## 3. Templates (4 existing + 5 new)

All package except hair transplant — run on today's engine.

**Existing — changes** (done by Super Admin in the library UI — the seed never updates a row
once inserted, `librarySeed.service.ts`; editing the JSON would only affect fresh databases)

| Code | Change |
|---|---|
| `hair.transplant` | Add steps: Review (+90d) → Result review + photos (+180d); mark taxable; add 360 min to surgery. Plastic uses this one (G9) |
| `derma.laser_hair_reduction`, `hair.prp`, `derma.chemical_peel` | Mark taxable |

**New**

| Code | Template | Type / price | Sessions | Keywords |
|---|---|---|---|---|
| `derma.acne_course` | Acne treatment course (with monthly review) | package, per step, 6 × 30d, expiry 210d | Monthly review + tests every 2nd visit if on isotretinoin | acne, isotretinoin |
| `derma.vitiligo_nbuvb` | Vitiligo / psoriasis phototherapy (NB-UVB) | package, package price, 24 × 3d, expiry 120d | Dose noted each session | vitiligo, psoriasis, phototherapy |
| `derma.pigmentation_laser` | Pigmentation laser (Q-switched) | package, package price, 6 × 28d, expiry 240d, taxable | — | melasma, pigmentation, freckles |
| `derma.wart_cryo` | Wart cryotherapy | package, per step, 4 × 14d, expiry 90d | — | warts, verruca, cryotherapy |
| `derma.microneedling` | Microneedling for acne scars | package, package price, 4 × 28d, expiry 180d, taxable | — | acne scars, microneedling |

## 4. Lesion table — simple and dynamic

One row per lesion, "+ Add lesion" — same "rows with + Add" component as Ortho joints / Urology stones.
Saved in `additionalInformation`.

| Site | Type | Size | Count | Colour | Note |
|---|---|---|---|---|---|
| Face — cheeks | Papule / pustule | 2–3 mm | Many | Red | Acne grade 3 |
| + Add lesion | | | | | |

- Site pick: Scalp, Face, Neck, Chest, Back, Abdomen, Arms, Hands, Groin, Legs, Feet, Nails, Generalised.
- Type pick: Macule, Patch, Papule, Plaque, Nodule, Vesicle, Pustule, Wheal, Scale, Ulcer.
- Count pick: Single, Few, Many, Widespread.
- Only filled rows print.
- **Body map:** Surgeon, Plastic and now Derm all want it. Derm would use it most → good first user
  when the shared body map is built (question 1).

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `area` | Area | multiselect, required | Scalp, Face, Neck, Chest, Back, Abdomen, Arms, Hands, Groin, Legs, Feet, Nails, Full body |
| `skin_type` | Skin type (Fitzpatrick) | select | I, II, III, IV, V, VI |
| `condition` | Condition | select | Acne, Acne scars, Pigmentation, Vitiligo, Psoriasis, Eczema, Warts, Hair loss, Unwanted hair, Other |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `severity_score` | Severity score | number | 0–103 (PASI / SCORAD / VASI — named in `score_type`) |
| `score_type` | Score | select | None, Acne grade, PASI, SCORAD, VASI |
| `laser_setting` | Laser / UV dose | text | e.g. 1064 nm, 4 J/cm² or 300 mJ/cm² |
| `reaction` | Reaction | select | None, Redness, Peeling, Blister, Darkening, Lightening |
| `improvement` | Improvement | select | None, < 25%, 25–50%, 50–75%, > 75% |
| `photos_taken` | Photos taken | boolean | until photo upload exists |

Prescription config additions:
- **Diagnosis add:** Vitiligo, Melasma, Urticaria, Scabies, Warts, Alopecia areata, Androgenetic alopecia, Herpes zoster, Onychomycosis
- **Tests:** KOH mount, Skin biopsy, Patch test, Wood's lamp, Dermoscopy, LFT, Lipid profile, Thyroid profile, Ferritin, Vitamin D
- **Advice add:** Avoid sun for 48 hours after the procedure, Do not pick or scrub treated skin, Use a reliable method to avoid pregnancy on isotretinoin

Venereologist (STIs) — separate list later if a clinic asks; not in this file.

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 new templates (§3); also update the JSON for the 4 existing ones so fresh DBs match | BE | Dentist P1 (config seed), Plastic P1 (taxable seed fix) |
| P1b | Super Admin edits the 4 existing library templates (§3) and activates the new drafts with fees | your side, browser | P1 |
| P2 | Diagnosis / tests / advice adds (G5–G7) | BE | — |
| P3 | Lesion table on the prescription (G1) | FE (+ print) | reuse rows-table build (Ortho P3) |

Shared, later: photos (G3), body map.

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 9 derm templates for Dermatologist + sub-specialties
- [ ] Hair transplant now has 5 steps (incl. 90d, 180d reviews) and a 6-hour slot
- [ ] Cosmetic templates show taxable (no tax applied yet — expected)
- [ ] Phototherapy books 24 sessions 3 days apart; expires at 120 days
- [ ] Area required (multi); skin type and condition save
- [ ] Severity score + type, laser / UV dose, reaction, improvement save per session
- [ ] Seed adds only the 5 new templates, as drafts with no fees; existing 4 untouched
- [ ] After P1b, a clinic that copied the old hair transplant sees "newer version"

**P2 — prescription lists**
- [ ] New diagnoses, tests, advice appear and print
- [ ] Other specialties unchanged

**P3 — lesion table**
- [ ] "+ Add lesion" adds a row; remove works
- [ ] Site / type / count picks save; old prescriptions still open
- [ ] Only filled rows print

## 8. Decisions (2026-10-24)

1. **Build the shared body map, Derm first**, after the Wave 2 templates; lesion table now.
2. **Keep Derm `hair.transplant`** and extend it; `plastic.hair_transplant` dropped.
3. Existing-template changes = **Super Admin edit in the browser** (P1b); seed keeps "SA owns the row".
4. **One severity score field + score-type pick.**
5. **Keep the 5 templates**; biologics, mole / tattoo removal, Botox / fillers not now.
