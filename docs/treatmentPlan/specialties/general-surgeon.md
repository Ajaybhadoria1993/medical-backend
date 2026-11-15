# Treatment Plan — General Surgeon (end-to-end plan)

Status: **Part A + P1 built 2026-10-27.** Order, diagnoses and pre-op tests (LFT, Urine Routine, Anti HCV
added); 5 templates (§3) in `treatmentPlan/seeds/libraryTemplates.json`; §5 fields in `seeds/specialtyConfigs.json`.
Still later, shared: P3 Surgery Suggested → plan, body map, discharge summary, test panels.
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 3). Clinical values need a surgeon's check.

**Part A (now):** G7 order + diagnosis adds → B · G2 / G8 pre-op tests → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G1, G3–G6, G9 · §3 templates · §5 plan / step fields · P1, P3 (G10 Rx → plan) · G11 discharge summary = shared later.
**Output check:** No fit-for-surgery certificate (only sick-leave) — shared, later.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Diagnosis, Surgery Suggested, Vitals, Pathology Test, Advice, Pre-Diagnosis, Allergy, Habits, Visiting Days, Follow-Up, Diet | BE `utils/doctorSpecialtyConfig.ts` → `General Surgeon` |
| Pick-lists | Diagnosis (gallstones, hernia, appendicitis, piles, fissure, cholecystitis, lipoma), complaints (lump, RIF pain, bleeding PR, abscess), surgeries (hernia repair, cholecystectomy, appendectomy, mastectomy, thyroidectomy, hemorrhoidectomy), wound-care advice, post-op diet | same file |
| Booking symptoms | Hernia, gallstones, piles, abscess/cyst, thyroid nodule… | FE `constants/specialitySymptoms.ts` |
| Diagram on prescription | None | FE `PrescriptionSummarySection.tsx` |
| Plan consent | Plan can require consent; consent file + time saved on accept | BE `treatmentPlan/models/treatmentPlan.model.ts` |
| Long visits | Step `durationMinutes` + dedicated booking mode exist (surgery slot) | same |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | No pre-op checklist | Surgery can't go ahead without tests, anaesthesia fitness, consent, fasting | Yes/no step fields on the surgery step (§5) — no code |
| G2 | No pre-op test panel | Surgeon orders the same 8–10 tests every time | Add tests to the pick-list now; one-click panel = shared gap |
| G3 | No operation note | Procedure, anaesthesia, findings, mesh/implant, complications are recorded per surgery | Step fields on the surgery step (§5) |
| G4 | No wound review record | Every dressing visit checks the wound | Step fields: wound status, sutures removed |
| G5 | Biopsy (HPE) report follow-up | Lipoma, gallbladder, lumps go for HPE; result must be reviewed | "HPE sent" field + a report-review step in templates |
| G6 | No surgical site picker | Which side / where (left groin, right breast) | Site select + side now; clickable body map = shared widget later |
| G7 | Section order starts with Diagnosis | Surgeon flow is complaint → exam → diagnosis → surgery | Reorder: Pre-Diagnosis → Vitals → Diagnosis → Surgery Suggested → Tests → Advice → Follow-Up |
| G8 | Pre-op tests missing from list | Pathology list has no PT/INR, viral markers, ECG, chest X-ray, USG | Add to the surgeon's test list |
| G9 | No templates | Surgeon gets only generic plans | Add 5 (§3) |
| G10 | "Surgery Suggested" doesn't open a plan | Surgeon picks Hernia repair, then retypes it as a plan | Shared Rx → plan gap; map surgery pick → template code |
| G11 | No discharge summary | Day-care / admitted patients need one | Out of plan scope; shared gap for all surgical specialties |

## 3. Templates (5 new)

All staged — run on today's engine. Surgery priced as a package (all-inclusive), I&D per step.

| Code | Template | Type / price | Steps | Keywords |
|---|---|---|---|---|
| `surgery.hernia_repair` | Hernia repair (open / lap) | staged, package, consent | Pre-op check + tests → Surgery (+3d, max 30d, 90 min) → Wound review (+3d) → Suture removal (+7d) → Final review (+21d) | inguinal hernia, umbilical hernia |
| `surgery.lap_cholecystectomy` | Lap cholecystectomy | staged, package, consent | Pre-op check + USG + tests → Surgery (+3d, max 30d, 90 min) → Review (+7d) → HPE report + final review (+14d) | gallstones, cholecystitis |
| `surgery.abscess_id` | Abscess I&D + dressings | staged, per step, consent | I&D → Dressing (+1d) → Dressing (+2d) → Dressing (+2d) → Review (+5d) | abscess, boil |
| `surgery.hemorrhoidectomy` | Piles surgery (open / laser) | staged, package, consent | Pre-op check → Surgery (+3d, max 30d) → Review (+7d) → Review (+21d) | piles, hemorrhoids, fissure |
| `surgery.lump_excision` | Lump / lipoma excision | staged, per step, consent | Excision under local (45 min) → Suture removal (+7d) → HPE report review (+7d) | lipoma, cyst, lump |

## 4. Diagram / widget

**None needed now.** Surgeon data is a checklist and an op note — plain fields (§5) cover it.

Later, shared: a **body map** (front / back outline, click a region). Same widget would serve
Ortho, Plastic, Derm, Physio, Vascular — build it once when 2+ of those are planned.

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `procedure` | Procedure | select | Hernia repair, Lap cholecystectomy, Appendectomy, Hemorrhoidectomy, Fistulectomy, Lump excision, I&D, Thyroidectomy, Mastectomy, Other |
| `approach` | Approach | select | Open, Laparoscopic, Laser |
| `site` | Site | text | e.g. Right groin |
| `side` | Side | select | Right, Left, Both, Midline |
| `anaesthesia` | Anaesthesia | select | Local, Spinal, General, Sedation |

**Step fields** (filled on the visit they apply to)

| Key | Label | Type | Options |
|---|---|---|---|
| `preop_tests_done` | Pre-op tests done | boolean | |
| `anaesthesia_fit` | Anaesthesia fitness | boolean | |
| `fasting_advised` | Fasting (NPO) advised | boolean | |
| `findings` | Operative findings | text | |
| `implant` | Mesh / implant | text | e.g. Prolene mesh 15×15 cm |
| `complications` | Complications | select | None, Bleeding, Infection, Other |
| `hpe_sent` | Sent for HPE | boolean | |
| `wound_status` | Wound | select | Healthy, Discharge, Infected, Gaping |
| `sutures_removed` | Sutures / staples removed | boolean | |

Step fields show on every step today; the doctor fills only what applies to that visit.

Prescription config additions:
- **Pre-op tests:** CBC, RBS, LFT, RFT, PT/INR, HIV, HBsAg, HCV, Urine routine, ECG, Chest X-ray, USG abdomen
- **Diagnosis add:** Fistula-in-ano, Breast lump, Thyroid nodule, Sebaceous cyst

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | Section reorder (G7) + pre-op tests and diagnosis adds (G8) | BE | — |
| P3 | Surgery Suggested → matching template (G10) | FE | shared Rx → plan gap |

Later, shared: test panels (G2), body map (G6), discharge summary (G11).

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 surgeon templates
- [ ] Steps, gaps, 30-day surgery window and durations match §3
- [ ] Surgery step books a long (90 min) slot
- [ ] Consent asked on accept; consent file saves
- [ ] Plan fields (procedure, approach, side, anaesthesia) save and show
- [ ] Pre-op checklist ticks, op findings, mesh, HPE sent, wound status save per step
- [ ] Package price shows once, not per step

**P2 — prescription lists**
- [ ] Sections show in the new order for a surgeon only
- [ ] Pre-op tests and new diagnoses appear and print
- [ ] Other specialties unchanged

**P3 — Surgery Suggested → plan**
- [ ] Picking "Hernia repair" offers the hernia template
- [ ] Plan opens with patient, consultation and diagnosis filled
- [ ] A surgery with no template opens a blank staged plan

## 8. Decisions (2026-10-24)

1. Surgery priced as **one package** (all-inclusive); I&D and lump excision stay per step.
2. Step fields **show on every step** for now; per-step fields stay a shared gap.
3. HPE: the **report-review step is enough**, no reminder.
4. **No Appendectomy template** — mostly emergency.
5. Discharge summary = **own shared feature, planned later**.
