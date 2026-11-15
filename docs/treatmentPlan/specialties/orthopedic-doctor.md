# Treatment Plan — Orthopedic Doctor (end-to-end plan)

Status: **Part A + P1 built (P1 on 2026-10-28).** Lists, order and joint table done earlier; quick tests add
CT Spine (new), DEXA Scan, NCV; 5 templates (§3) in `treatmentPlan/seeds/libraryTemplates.json`; §5 fields
in `seeds/specialtyConfigs.json`. Still later, shared: body map, physio step in an ortho plan, fitness certificate.
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 4). Clinical values need an orthopedic surgeon's check.
Covers sub-specialties: Orthopedic Surgeon, Joint Replacement, Spine, Sports Medicine (`utils/specialtyCatalog.ts`).

**Part A (now):** G1 diagnosis + G8 order + G10 both configs → B · G3 joint table → G · G2 imaging → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G4–G7, G9 · §3 templates · §5 plan / step fields · P1.
**Output check:** No return-to-work / fitness certificate — shared, later.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Diagnosis, Vitals, Pathology Test, Surgery Suggested, Advice, Pre-Diagnosis, Habits, Visiting Days, Follow-Up, Diet, Allergy | BE `utils/doctorSpecialtyConfig.ts` → `Orthopedic Doctor` (and a separate `Orthopedic Surgeon` block) |
| Pick-lists | Diagnosis (back/neck pain, knee OA, bursitis, sprain, canal stenosis, disc), complaints, posture habits, metal/painkiller allergy, surgeries (knee/hip replacement, fracture fixation, arthroscopy, spine) | same file |
| Booking symptoms | Joint pain, sprain, fracture, limited motion, sports injury… | FE `constants/specialitySymptoms.ts` |
| Diagram on prescription | None | FE `PrescriptionSummarySection.tsx` |
| Plan consent / long slots | Consent on accept; step `durationMinutes` + dedicated booking | BE `treatmentPlan` models |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No fractures or tears in the diagnosis list** | Fractures are the core of ortho OPD | Add fractures, ACL/meniscus tear, frozen shoulder, CTS, gout, PIVD |
| G2 | No X-ray / MRI / CT / DEXA list | Every ortho visit orders imaging | Shared test/imaging list gap (with views: AP, Lateral) |
| G3 | **No joint exam** — pain score, range of motion, side | Progress is measured by pain and motion | Joint exam table on the prescription (§4) |
| G4 | No cast / splint tracking | Cast type, removal date, check X-ray | Step fields (§5) |
| G5 | No implant record (plate, nail, prosthesis, size, lot no.) | Medico-legal; needed if removed or recalled | Plan field `implant` (§5) |
| G6 | No weight-bearing status | Tells the patient how much to load the limb | Step field (§5) |
| G7 | Rehab handover to physio | Post-op rehab is done by a physio, often in the same clinic | Referral exists on the visit; plan step by another doctor = shared gap |
| G8 | Section order starts with Diagnosis | Ortho flow is complaint → exam → imaging → diagnosis | Reorder: Pre-Diagnosis → Vitals → Joint exam → Tests → Diagnosis → Surgery → Advice → Follow-Up |
| G9 | No templates | Ortho gets only generic plans | Add 5 (§3) |
| G10 | `Orthopedic Surgeon` Rx block is **never used** (checked 2026-10-24: a doctor's speciality is always the catalog main, and the main's config wins) | Edits to it change nothing | Add to the `Orthopedic Doctor` block only; dead block merged into main + deleted in step B (`general-physician.md` §9) |

## 3. Templates (5 new)

All staged or package — run on today's engine.

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|
| `ortho.fracture_cast` | Fracture — cast care | staged, per step | Cast applied → Check X-ray (+7d) → Review (+14d) → Cast removal + X-ray (+21d) → Mobilisation review (+14d) | fracture, cast, plaster |
| `ortho.fracture_fixation` | Fracture fixation (ORIF) | staged, package, consent | Pre-op check → Surgery (+1d, max 7d, 120 min) → Wound review (+3d) → Suture removal (+11d) → X-ray review (+28d) → X-ray review (+42d) | fracture fixation, ORIF, plating |
| `ortho.knee_replacement` | Total knee replacement | staged, package, consent | Pre-op check → Surgery (+7d, max 60d, 150 min) → Wound review (+3d) → Staple removal (+11d) → Review (+28d) → Review (+42d) → Review (+90d) | knee OA, TKR, knee replacement |
| `ortho.acl_arthroscopy` | Arthroscopy / ACL reconstruction | staged, package, consent | Pre-op + MRI review → Surgery (+3d, max 30d, 90 min) → Review (+3d) → Suture removal (+11d) → Review (+28d) → Review (+60d) → Return-to-sport review (+90d) | ACL tear, meniscus tear, arthroscopy |
| `ortho.knee_injection_series` | Knee injection series (PRP / gel) | package, 3 sessions × 21d, expiry 120d, consent | — | knee OA, PRP, viscosupplementation |

Rehab sessions are not inside these plans — physio gets its own package plan (Physiotherapist file).

## 4. Joint exam table — simple and dynamic

A small table on the prescription, one row per joint; "+ Add joint" adds a row. Saved in
`additionalInformation` like the dental chart.

| Joint | Side | Pain (0–10) | Movement (ROM °) | Swelling | Tenderness |
|---|---|---|---|---|---|
| Knee | Right | 7 | Flexion 0–90 | Yes | Medial joint line |
| + Add joint | | | | | |

- Joint pick: Shoulder, Elbow, Wrist, Hand, Hip, Knee, Ankle, Foot, Cervical spine, Lumbar spine.
- Only filled rows print.
- Plan form: **no widget.** Pain and movement are step fields, so each review shows progress.
- Body map (click the joint on a figure) = shared widget later (see `README.md`).

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `body_part` | Body part | select, required | Shoulder, Elbow, Wrist, Hand, Hip, Knee, Ankle, Foot, Cervical spine, Lumbar spine, Other |
| `side` | Side | select | Right, Left, Both |
| `procedure` | Procedure | select | Cast, ORIF, Knee replacement, Hip replacement, Arthroscopy, ACL reconstruction, Injection, Spine surgery, Other |
| `implant` | Implant (type, size, lot) | text | e.g. Locking plate 4.5 mm, lot 2231 |
| `anaesthesia` | Anaesthesia | select | Local, Regional block, Spinal, General |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `pain_score` | Pain (0–10) | number | 0–10 |
| `rom` | Movement (ROM) | text | e.g. Flexion 0–110 |
| `weight_bearing` | Weight bearing | select | Non, Toe-touch, Partial, Full |
| `cast_type` | Cast / support | select | Plaster, Fibreglass, Slab, Brace, None |
| `xray_finding` | X-ray | select | Not done, Aligned, Healing, United, Delayed union, Malunion |
| `wound_status` | Wound | select | Healthy, Discharge, Infected, Gaping |
| `sutures_removed` | Sutures / staples removed | boolean | |

Prescription config additions (both Orthopedic Doctor and Orthopedic Surgeon):
- **Diagnosis add:** Distal radius fracture, Neck of femur fracture, Ankle fracture, Clavicle fracture, ACL tear, Meniscus tear, Frozen shoulder, Carpal tunnel syndrome, Gout, PIVD
- **Imaging:** X-ray (AP / Lateral), MRI, CT, DEXA scan, Nerve conduction study
- **Advice add:** Keep the cast dry, Elevate the limb, Do not bear weight until advised

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | Diagnosis / advice adds (G1), section reorder (G8), both configs (G10) | BE | — |
| P3 | Joint exam table on the prescription (G3) | FE (+ print) | — |

Shared, later: imaging list (G2), plan step by another doctor (G7), body map.

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 ortho templates for Orthopedic Doctor and its sub-specialties
- [ ] Steps, gaps, surgery windows and durations match §3
- [ ] Injection series books 3 sessions 21 days apart, expires at 120 days
- [ ] Body part required; side, procedure, implant, anaesthesia save
- [ ] Pain, ROM, weight bearing, cast, X-ray, wound save per step and show on plan detail

**P2 — prescription lists**
- [ ] Fractures and tears appear in diagnosis for both configs
- [ ] New advice lines appear; sections show in the new order
- [ ] Other specialties unchanged

**P3 — joint exam table**
- [ ] "+ Add joint" adds a row; remove works
- [ ] Pain limited to 0–10
- [ ] Saved rows reload; old prescriptions still open
- [ ] Only filled rows print; layout fits the Rx

## 8. Decisions (2026-10-24)

1. Rehab is **always a separate physio plan**, not inside the ortho plan.
2. Implant record = **one text field** (type, size, lot typed together).
3. Joint exam table on the **prescription only** for now; next-visit comparison later if asked.
4. **Keep the 5 templates**; hip replacement, frozen shoulder, spine, kids' plaster not now.
5. ~~Keep two configs~~ — corrected 2026-10-24: the `Orthopedic Surgeon` block is never used; P2 adds to `Orthopedic Doctor` only (see `general-physician.md` Q1).
