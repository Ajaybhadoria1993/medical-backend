# Fertility Specialist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: IUI / IVF / FET start at the day-2 baseline scan (no cycle-day-1 timeline yet).
Parent: `../specialty-rollout-research.md` (Wave 5, specialty 33). Clinical values need a fertility specialist's check.
Covers sub-specialties: IVF Specialist, Reproductive Endocrinologist; also practises General Physician, Gynecologist, Andrologist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** follicle chart must print in all 3 paths → D; scans / IUI / OPU billable as clinic services (exists).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Fertility Specialist` block — PCOS, tubal factor, male infertility, work-up…; unable to conceive, irregular / missed periods, repeated miscarriage; IVF, ICSI, IUI, laparoscopy, hysteroscopy, egg retrieval, embryo transfer | BE `utils/doctorSpecialtyConfig.ts` |
| Section order | Diagnosis first, Pre-Diagnosis 5th | same |
| Ovary diagram | Shown for Gynecologist / Obstetrician / Fertility Specialist — click tube / ovary / uterus → free-text note, saved in `additionalInformation` | FE `workspace/helpers/ovaryDiagram.ts` |
| Partner | Family links with relationship `spouse` | BE `patient/models/patientFamilyLinks.model.ts` |
| Privacy | Plans readable by reception | `treatmentPlan.route.ts` |
| Treatment plan | None; cycle-day plans need `timeline` (anchored on cycle day 1) | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No follicle tracking** — size per ovary by cycle day, endometrium | Scans on day 9 / 11 / 13 decide the trigger day | Follicle rows (§3) — shared rows table | G |
| G2 | **No cycle / reserve record** — LMP → cycle day, AMH, antral follicle count, tubes | Every fertility visit | Cycle card (§3) — shared exam grid, **cycle day auto from LMP** | F |
| G3 | **Partner not linked in the Rx** | Treatment is for the couple; semen report belongs to the partner | Spouse chip in the Rx (step J, with carer / parent) + partner semen rows (§3) | J / F |
| G4 | Section order | Complaint → exam → diagnosis | Reorder (§4) | B |
| G5 | Diagnosis list misses cases | Endometriosis, low AMH, unexplained infertility, thin endometrium, recurrent IVF failure, azoospermia | Adds (§4) | B |
| G6 | Ovary diagram is free text only | Follicle sizes need numbers | Keep the diagram for notes; numbers go in the follicle rows | — |
| G7 | Fertility tests (AMH, FSH / LH, prolactin, TSH, HSG, semen analysis, beta hCG) | Lab catalog | Step I | I |

### 3. Card — two parts (both reuse shared components)

**Cycle card** — single-column rows:

| Row | Input |
|---|---|
| LMP | date |
| Cycle day today | **auto** from LMP |
| Cycle length (days) | number 15–90 |
| AMH (ng/mL) | number 0–20 |
| Antral follicles — right / left | text, e.g. "6 / 5" |
| Tubes (HSG) | pick: Both open, Right blocked, Left blocked, Both blocked, Not done |
| Partner semen — count (million/mL) | number 0–300 |
| Partner semen — motility (%) | number 0–100 |
| Partner semen — normal forms (%) | number 0–100 |

**Follicle tracking** — rows table, "+ Add scan":

| Cycle day | Right ovary (mm) | Left ovary (mm) | Endometrium (mm) | Note |
|---|---|---|---|---|
| 9 | 12, 10 | 14 | 7.5 | — |
| 11 | 15, 12 | 17 | 8.6 | Trigger tomorrow |
| + Add scan | | | | |

Only filled rows print.

### 4. Prescription config

**`Fertility Specialist` block — changes:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Pathology Test → Advice → Habits → Allergy → Dietary Suggestions → Surgery Suggested → Visiting Days → Follow-Up
- **Pre-Diagnosis add:** Painful intercourse, Heavy periods, Low sperm count (partner), Failed IVF before
- **Diagnosis add:** Endometriosis, Low ovarian reserve, Unexplained infertility, Thin endometrium, Recurrent implantation failure, Azoospermia, Oligoasthenospermia, Hyperprolactinaemia, Uterine fibroid
- **Surgery Suggested add:** Ovulation induction, Follicle monitoring, Trigger injection, Frozen embryo transfer, Semen freezing, TESA / PESA
- **Advice add:** Come for the scan on day ___ of the cycle, Take the trigger injection at exactly ___ pm, Abstain for 2–5 days before semen collection, Do the pregnancy blood test 14 days after transfer

### 5. Checklist (tick in browser)

- [ ] New section order; new complaints / diagnoses / procedures / advice for all subs (B)
- [ ] Cycle day calculates from LMP; blank if LMP missing (F)
- [ ] "+ Add scan" rows save; ovary diagram still works for notes (G)
- [ ] Spouse shows in the Rx context bar (J)
- [ ] Only filled rows print (D)
- [ ] Other specialties unchanged (Gynecologist ovary diagram unchanged)

## Part B — treatment plan (later)

### 6. Templates (names plain — reception schedules them; no clinical values in steps)

| Code | Template | Type | Steps | Keywords |
|---|---|---|---|---|
| `fert.iui_cycle` | IUI cycle | **timeline** from cycle day 1 (staged works today if started on day 2) | Baseline scan (day 2) → Scan (day 9) → Scan (day 11) → IUI (day 13–14) → Pregnancy test (+14d) | IUI |
| `fert.ivf_cycle` | IVF cycle | **timeline** from cycle day 1 | Baseline (day 2) → Stimulation scans (day 6, 8, 10) → Egg retrieval (day 12–14) → Embryo transfer (+3 / +5d) → Pregnancy test (+14d) | IVF, ICSI |
| `fert.fet` | Frozen embryo transfer | **timeline** from cycle day 1 | Baseline (day 2) → Lining scan (day 10) → Transfer (day 16–19) → Pregnancy test (+14d) | FET, frozen embryo |
| `fert.ovulation_induction` | Ovulation induction — 3 cycles | **cycle**, 3 × ~28d | Follicle scans each cycle | letrozole, ovulation induction |

### 7. Plan config row

**Plan fields:** `partner_linked` (boolean), `protocol` (Natural, Letrozole, Antagonist, Long agonist) — kept neutral.
**Step fields:** none clinical — follicle sizes stay on the prescription.

### 8. Plan checklist

- [ ] IUI as staged works if started on day 2; full IUI / IVF / FET wait for `timeline`
- [ ] Log in as Receptionist: plan shows names + dates only

## 9. Decisions (2026-10-24)

1. Follicle tracking on the **shared rows table**, cycle card on the **shared exam grid** — no new component.
2. **Cycle day auto** from LMP.
3. **Spouse chip in the Rx** (step J); partner semen values on the woman's card.
4. **Ovary diagram stays for notes**; numbers in the follicle rows.
5. **No clinical values in plan steps** (reception reads plans).
