# Treatment Plan — Urologist (end-to-end plan)

Status: **Part A + P1 built (P1 on 2026-10-28).** Lists, tests and the urology card done earlier; 5 templates (§3)
in `treatmentPlan/seeds/libraryTemplates.json` (stent removal: 21 days, max 35); §5 fields in `seeds/specialtyConfigs.json`.
**Still open:** the shared missed-step cron (G3, decision 1) — `window_missed` is never set yet; plan it next.
Parent: `../specialty-rollout-research.md` (Wave 1, specialty 7). Clinical values need a urologist's check.
Covers sub-specialties: Urologic Surgeon, Andrologist (has an Rx block, but it is **never used** — Urologist main wins), Uro-Oncologist (`utils/specialtyCatalog.ts`).

**Part A (now):** G6 diagnosis / advice → B · G1 stones + G2 prostate card → G · G5 urology tests → I — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G3 stent window + missed-step cron, G4, G7 · §3 templates · §5 plan / step fields · P1.
**Output check:** Check in plan phase: overdue plan steps on the follow-up call list (§8.3).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Vitals, Pre-Diagnosis, Habits, Allergy, Pathology Test, Diagnosis, Surgery Suggested, Advice, Diet, Visiting Days, Follow-Up | BE `utils/doctorSpecialtyConfig.ts` → `Urologist` (+ separate `Andrologist`) |
| Pick-lists | Diagnosis (UTI, BPH, kidney / ureteric stone, cystitis, prostatitis, ED, incontinence), complaints (burning, frequency, blood in urine, colic, retention, weak stream, nocturia), surgeries (TURP, lithotripsy, prostatectomy, nephrectomy, cystoscopy, vasectomy, urethroplasty), water / stone-diet advice | same file |
| Diagram on prescription | None | FE `PrescriptionSummarySection.tsx` |
| Missed visit window | Step status `window_missed` is **declared but never set** by any code | BE `treatmentPlan/models/treatmentEnums.model.ts` |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

Section order already fits (vitals → complaints → tests → diagnosis → surgery).

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No stone record** — side, location, size, count | Size + site decide ESWL vs URS vs PCNL | Stone table on the prescription (§4) |
| G2 | **No prostate / flow record** — IPSS, Qmax, residual urine, prostate size | Tracks BPH and decides TURP | Same card, BPH rows (§4) |
| G3 | **Forgotten DJ stent** | A stent left in too long blocks and damages the kidney — a known patient-safety risk | Stent-removal step with a tight window + step field `stent_removed`; a daily cron marks past-window steps `window_missed` and reminds clinic (shared gap) |
| G4 | No catheter tracking | Placed / removed, size | Step fields (§5) |
| G5 | Urology tests not listed (PSA, creatinine, urine culture, USG KUB, CT KUB, uroflowmetry) | Every visit orders some | Shared test / imaging list gap |
| G6 | Diagnosis list misses common cases | Stricture, overactive bladder, hydrocele, varicocele, phimosis, raised PSA, male infertility | Add (§5) |
| G7 | No templates | Urology gets only generic plans | Add 5 (§3) |

## 3. Templates (5 new)

All staged or package — run on today's engine.

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|
| `uro.eswl` | Shock-wave stone treatment (ESWL) | package, per step, 3 sessions × 14d, expiry 90d, consent | Last session = X-ray KUB check | kidney stone, ESWL, lithotripsy |
| `uro.urs_stent` | Ureteroscopy + DJ stent | staged, package, consent | Pre-op check → URS + stent (+3d, max 30d, 90 min) → Review (+7d) → **Stent removal (+21d, max 35d)** → USG review (+30d) | ureteric stone, URS, DJ stent |
| `uro.turp` | Prostate surgery (TURP) | staged, package, consent | Pre-op (PSA, uroflow) → Surgery (+7d, max 60d, 90 min) → Catheter removal (+3d) → Review (+11d) → Uroflow review (+60d) | BPH, enlarged prostate, TURP |
| `uro.circumcision` | Circumcision | staged, package, consent | Procedure (45 min) → Review (+3d) → Final review (+7d) | phimosis, circumcision |
| `uro.vasectomy` | Vasectomy | staged, package, consent | Procedure (30 min) → Review (+7d) → Semen test review (+84d) | vasectomy, sterilisation |

## 4. Urology card — simple and dynamic

A small card on the prescription with two parts. Saved in `additionalInformation` like the dental chart.

**Stones** — one row per stone, "+ Add stone":

| Side | Location | Size (mm) | Hydronephrosis |
|---|---|---|---|
| Right | Lower ureter | 8 | Mild |
| + Add stone | | | |

Location pick: Kidney upper / mid / lower, Renal pelvis, Ureter upper / mid / lower, Bladder.
Hydronephrosis pick: None, Mild, Moderate, Severe.

**Prostate / flow** — one row:

| IPSS (0–35) | Qmax (ml/s) | Residual urine (ml) | Prostate size (g) | PSA (ng/ml) |
|---|---|---|---|---|

- Only filled parts print.
- Plan form: **no widget.** Side, stone size and stent / catheter are fields (§5).
- Reuse: same "rows with + Add" table as the Ortho joint table — one component, config per specialty.

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `procedure` | Procedure | select, required | ESWL, URS, PCNL, TURP, Cystoscopy, Circumcision, Vasectomy, Hydrocelectomy, Other |
| `side` | Side | select | Right, Left, Both, Not applicable |
| `stone_size_mm` | Stone size (mm) | number | 1–60 |
| `stent_placed` | DJ stent placed | boolean | |
| `anaesthesia` | Anaesthesia | select | Local, Spinal, General |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `stent_removed` | DJ stent removed | boolean | |
| `catheter` | Catheter | select | None, In place, Removed |
| `stone_status` | Stone | select | Present, Fragmented, Cleared |
| `qmax` | Qmax (ml/s) | number | 0–50 |
| `step_note` | Finding | text | short |

Prescription config additions (`Urologist` block only — the `Andrologist` block is never used; male-health items go in Urologist):
- **Diagnosis add:** Urethral stricture, Overactive bladder, Hydrocele, Varicocele, Phimosis, Raised PSA, Male infertility, Hydronephrosis
- **Tests:** PSA, Serum creatinine, Urine culture, USG KUB, CT KUB, Uroflowmetry, Semen analysis
- **Advice add:** Do not miss the stent removal date, Keep the catheter bag below the waist

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | Diagnosis / tests / advice adds (G5, G6) | BE | — |
| P3 | Urology card on the prescription (G1, G2) | FE (+ print) | reuse Ortho joint-table build |

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 urology templates for Urologist and its sub-specialties
- [ ] Steps, gaps, windows, durations match §3
- [ ] Stent removal step has the 35-day window (missed-window flag comes with the shared cron)
- [ ] ESWL = 3 sessions 14 days apart, expires at 90 days
- [ ] Procedure required; side, stone size, stent placed, anaesthesia save
- [ ] Stent removed, catheter, stone status, Qmax save per step

**P2 — prescription lists**
- [ ] New diagnoses, tests and advice appear and print (Urologist + Andrologist)
- [ ] Other specialties unchanged

**P3 — urology card**
- [ ] "+ Add stone" adds a row; remove works; size limited to 1–60
- [ ] IPSS 0–35, Qmax, residual, prostate size, PSA validate
- [ ] Saved values reload; old prescriptions still open
- [ ] Only filled parts print

## 8. Decisions (2026-10-24)

1. **Build the shared missed-step cron early** — marks `window_missed`, reminds clinic + patient (patient safety).
2. IPSS = **one total number** (0–35).
3. **Keep the 5 templates**; PCNL, hydrocelectomy, BPH review not now.
4. PSA in **both**: card shows the value, tests list orders it.
5. Andrologist gets **the same 5 templates**.
