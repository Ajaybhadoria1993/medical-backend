# Treatment Plan — Vascular Specialist (end-to-end plan)

Status: **Part A + P1 built (P1 on 2026-10-28).** Rx config and limb grid done earlier; tests add D-Dimer,
CT Peripheral Angiography, Ankle Brachial Index (ABI); 5 templates (§3) in `treatmentPlan/seeds/libraryTemplates.json`;
§5 fields in `seeds/specialtyConfigs.json`. Still later, shared: wound photos, DVT / INR review plan.
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 8). Clinical values need a vascular surgeon's check.
Covers sub-specialty: Vascular Surgeon (`utils/specialtyCatalog.ts`).

**Part A (now):** G1 new Rx config → B · G2 limb grid → F · G5 Doppler / tests → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G3, G4, G6, G7 · §3 templates · §5 plan / step fields · P1.
**Output check:** —.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription config | **None.** No `Vascular Specialist` block, so the doctor gets the generic lists (fever, cough, URTI…) | BE `utils/doctorSpecialtyConfig.ts` → `GENERIC_DOCTOR_PREFERENCES` |
| Booking symptoms | Varicose veins, leg swelling, cold feet, claudication, non-healing ulcer, spider veins… | FE `constants/specialitySymptoms.ts` |
| Diagram on prescription | None | FE `PrescriptionSummarySection.tsx` |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No prescription config** — generic lists only | Vascular doctor sees GP diagnoses, no vascular surgeries or advice | Add a `Vascular Specialist` block (§5) — shared gap, 15 specialties |
| G2 | **No limb exam** — pulses, ABI, varicose grade | Pulses + ABI decide arterial disease; CEAP grades varicose veins | Right / Left limb grid (§4), reuse the eye-grid component |
| G3 | No ulcer tracking — size, healing | Ulcer care runs for weeks; size shows progress | Step fields (§5); photos = shared gap |
| G4 | No compression record | Stocking / bandage class is the main venous treatment | Step field (§5) |
| G5 | No vascular tests (Venous / Arterial Doppler, CT angiography, D-dimer) | Every case needs Doppler | Shared test / imaging list gap |
| G6 | No INR record for blood thinners | DVT patients on warfarin need INR checks | Step field now; ongoing checks = review type (Wave 3) |
| G7 | No templates | Vascular gets only generic plans | Add 5 (§3) |

## 3. Templates (5 new)

All staged or package — run on today's engine.

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|
| `vascular.varicose_laser` | Varicose vein laser / RFA | staged, package, consent | Pre-op Doppler → Procedure (+3d, max 30d, 60 min) → Review + Doppler (+3d) → Review (+28d) → Final review + Doppler (+60d) | varicose veins, EVLA, RFA |
| `vascular.sclerotherapy` | Sclerotherapy (spider veins) | package, per step, 4 sessions × 21d, expiry 180d, consent | — | spider veins, sclerotherapy |
| `vascular.venous_ulcer` | Venous ulcer compression care | package, per step, 8 sessions × 7d, expiry 90d | Weekly dressing + compression bandage | venous ulcer, leg ulcer |
| `vascular.wound_debridement` | Diabetic foot / wound debridement | staged, per step, consent | Debridement → Dressing (+2d) → Dressing (+3d) → Review (+7d) → Review (+14d) | diabetic foot, gangrene, non-healing wound |
| `vascular.av_fistula` | AV fistula for dialysis | staged, package, consent | Pre-op vein mapping → Surgery (+3d, max 30d, 90 min) → Wound review (+7d) → Suture removal (+7d) → Maturation check (+28d) → Ready-for-use check (+28d) | AV fistula, dialysis access, CKD |

AV fistula ties to Nephrology (Wave 4) — the "ready for use" step hands over to dialysis.

## 4. Limb exam grid — simple and dynamic

Right | Left grid, same component as the eye / ENT grids. Saved in `additionalInformation`.

| Row | Right | Left | Input |
|---|---|---|---|
| Femoral pulse | Present | Present | pick: Present, Weak, Absent |
| Popliteal pulse | Present | Weak | same |
| Dorsalis pedis | Weak | Absent | same |
| Posterior tibial | Weak | Absent | same |
| ABI | 0.9 | 0.6 | number 0–1.5 |
| Varicose grade (CEAP) | C2 | C0 | pick: C0 … C6 |
| Swelling | Yes | No | pick: Yes, No |
| Ulcer | — | 4 × 3 cm | short note |

- "Copy to left"; only filled rows print.
- Plan form: **no widget.** Limb is a select; ulcer size, compression, Doppler are step fields.

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `limb` | Limb | select, required | Right leg, Left leg, Both legs, Right arm, Left arm |
| `condition` | Condition | select | Varicose veins, Venous ulcer, Peripheral artery disease, DVT, Diabetic foot, Dialysis access |
| `ceap` | CEAP grade | select | C0, C1, C2, C3, C4, C5, C6 |
| `anaesthesia` | Anaesthesia | select | Local, Tumescent, Spinal, General |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `ulcer_size` | Ulcer size | text | e.g. 4 × 3 cm |
| `healing` | Healing | select | Improving, Same, Worse, Healed |
| `compression` | Compression | select | None, Class 1, Class 2, Class 3, Bandage |
| `doppler` | Doppler | select | Not done, Normal, Reflux, DVT, Occlusion |
| `abi` | ABI | number | 0–1.5 |
| `inr` | INR | number | 0.5–6 |

**New prescription config block `Vascular Specialist`** (G1):
- **Sections:** Vitals → Pre-Diagnosis → Allergy → Habits → Tests → Diagnosis → Surgery Suggested → Advice → Diet → Follow-Up
- **Habits:** Smoking, Tobacco chewing, Prolonged standing, Sedentary lifestyle, Obesity
- **Allergy:** Drug allergy, Contrast dye allergy, Latex allergy, Heparin allergy
- **Pre-Diagnosis:** Leg pain on walking, Leg swelling, Visible veins, Leg ulcer, Cold feet, Skin darkening, Leg cramps, Numbness
- **Diagnosis:** Varicose veins, Venous ulcer, DVT, Peripheral artery disease, Diabetic foot, Spider veins, Lymphedema, Chronic venous insufficiency
- **Surgery Suggested:** Laser / RFA, Sclerotherapy, Angioplasty, Bypass surgery, Debridement, Amputation, AV fistula
- **Advice:** Wear compression stockings daily, Raise the legs when resting, Walk 30 minutes daily, Check the feet daily for wounds, Do not smoke
- **Diet:** Reduce salt, Control blood sugar, Eat high-fibre foods, Drink enough water, Limit fried foods
- **Tests:** Venous Doppler, Arterial Doppler, ABI, CT angiography, D-dimer, Lipid profile, HbA1c

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | New `Vascular Specialist` Rx config block (G1) | BE | — |
| P3 | Limb exam grid (G2) | FE (+ print) | reuse eye-grid build (Ophthalmologist P3) |

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 vascular templates for Vascular Specialist + Vascular Surgeon
- [ ] Steps, gaps, windows, durations match §3
- [ ] Sclerotherapy = 4 × 21d (180d expiry); ulcer care = 8 × 7d (90d expiry)
- [ ] Limb required; condition, CEAP, anaesthesia save
- [ ] Ulcer size, healing, compression, Doppler, ABI, INR save per step

**P2 — prescription config**
- [ ] Vascular doctor now sees vascular lists, not generic ones
- [ ] Doctor's own saved suggestions still show on top
- [ ] A doctor who changed section order keeps their order
- [ ] Other specialties unchanged

**P3 — limb exam grid**
- [ ] Grid shows for Vascular only (incl. Vascular Surgeon)
- [ ] Pulses pick Present / Weak / Absent; ABI 0–1.5; CEAP C0–C6
- [ ] "Copy to left" works; only filled rows print; old prescriptions still open

## 8. Decisions (2026-10-24)

1. Missing Rx configs added **one by one**, each in its specialty's file.
2. CEAP = **C0–C6 only** (clinical part).
3. AV fistula **under Vascular**; Nephrology links to it later.
4. **Keep the 5 templates**; angioplasty follow-up, DVT review, amputation care not now.
5. Ulcer size = **text** ("4 × 3 cm").
