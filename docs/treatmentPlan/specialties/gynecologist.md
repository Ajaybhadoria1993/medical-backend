# Gynecologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: Antenatal care starts at the first visit (~10 weeks), not at LMP (no LMP timeline yet).
Parent: `../specialty-rollout-research.md` (Wave 6, specialty 34 — last). Clinical values need an obstetrician-gynecologist's check.
Covers sub-specialties: Obstetrician, Laparoscopic Gynecologist, Maternal-Fetal Medicine (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** antenatal card must print in all 3 paths → D; USG / procedures billable as clinic services (exists).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Gynecologist` block — Vitals first; dysmenorrhoea, amenorrhoea, menorrhagia, PCOS, PID, candidiasis, vaginitis, ovarian cyst; painful / irregular / heavy / missed periods, discharge, pelvic pain; C-section, hysterectomy… | BE `utils/doctorSpecialtyConfig.ts` |
| `Obstetrician` block | **Never used** (main wins) → merge + delete (GP decision §9) | same |
| Ovary diagram | Click tube / ovary / uterus → free-text note | FE `workspace/helpers/ovaryDiagram.ts` |
| Patient profile | Blood group (Rh matters in pregnancy), chronic conditions — shown in the Rx after step J; "Pregnancy" option planned | `userProfile.model.ts` |
| Vaccine record | Planned, patient-level (step K) — TT / Tdap in pregnancy | `pediatrician.md` §9 |
| Treatment plan template | Laparoscopy (staged) seeded | BE `seeds/libraryTemplates.json` |
| Plan step gap limit | **Max 365 days** — an IUD removal (5–10 years) can't be a step | BE `treatmentPlan/schemas/plan.schema.ts` |
| Antenatal plan | Needs `timeline` (visits by week from LMP) | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No antenatal record** — LMP → EDD, weeks pregnant, GPAL, fetal heart, fundal height | Every pregnancy visit | Antenatal card (§3), **EDD + gestational age auto from LMP** | F |
| G2 | **Pregnancy not flagged for other doctors** | Any doctor prescribing must know the patient is pregnant | Profile option "Pregnancy" (step J) + a "Pregnant — check medicine safety" chip in every Rx | J |
| G3 | Obstetric items missing (unused `Obstetrician` block) | GDM, PIH, anaemia in pregnancy, threatened abortion… | Merge into the Gyn block + adds (§4) | B |
| G4 | **IUD removal date** | Forgotten IUD = harm; due years later | Card row "IUD inserted on / remove by" + profile chip; not a plan step (365-day limit) | F / J |
| G5 | Screening due (Pap smear, mammogram) | Preventive | Card row | F |
| G6 | Ob-gyn tests (USG — NT, anomaly, growth; OGTT; Hb; TSH; urine; Pap) | Lab catalog | Step I | I |
| G7 | TT / Tdap in pregnancy | Must be recorded | Vaccine record (step K) | K |

### 3. Antenatal + gyn card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).
Ovary diagram stays for gyn notes.

| Group | Row | Input |
|---|---|---|
| Pregnancy | LMP | date |
| | EDD | **auto** — LMP + 280 days; editable if corrected by scan |
| | Weeks pregnant | **auto** — e.g. "24 w 3 d" |
| | G / P / A / L | text, e.g. "G2 P1 A0 L1" |
| | Fundal height (cm) | number 10–45 |
| | Fetal heart (bpm) | number 60–220 |
| | Presentation | pick: Cephalic, Breech, Transverse, Not yet |
| | Swelling | pick: None, Feet, Face / hands |
| | Urine | pick: Normal, Protein +, Sugar +, Both |
| | Scan note | short note (EFW, liquor, placenta) |
| Gyn | Last Pap smear | date |
| | Contraception | pick: None, IUD, Pills, Injection, Implant, Tubal ligation |
| | IUD — remove by | date |
| | Menopause | pick: No, Peri, Post |

BP / weight / Hb from Vitals and profile. Only filled rows print.

### 4. Prescription config

**`Gynecologist` block — adds** (plus the unused `Obstetrician` block's items during the merge):
- **Pre-Diagnosis add:** Missed period / pregnancy test positive, Vomiting in pregnancy, Bleeding in pregnancy, Reduced baby movements, Leaking fluid, Hot flushes, Lump in breast
- **Diagnosis add:** Intrauterine pregnancy, Gestational diabetes, Pregnancy-induced hypertension, Pre-eclampsia, Anaemia in pregnancy, Hyperemesis, Threatened abortion, Uterine fibroid, Endometriosis, Menopause, Cervical erosion, UTI in pregnancy, Postpartum care
- **Surgery Suggested add:** Normal delivery, IUD insertion, IUD removal, Pap smear, D&C, Colposcopy, Tubal ligation
- **Advice add:** Take iron and folic acid daily, Count baby movements — at least 10 in 12 hours, Come at once for bleeding, leaking fluid, severe headache or less baby movement, Next scan at ___ weeks, Remove the IUD by ___
- **Diet add:** Extra protein and green vegetables in pregnancy, Small frequent meals for vomiting, Avoid raw papaya and alcohol in pregnancy
- Section order: keep (Vitals first).

**Patient profile options (step J):** Pregnancy (with EDD), IUD in place.

### 5. Checklist (tick in browser)

- [ ] New lists for Gynecologist + all 3 subs; Obstetrician loses nothing after the merge (B)
- [ ] EDD = LMP + 280 days and weeks pregnant correct for 3 test dates; EDD editable (F)
- [ ] Ovary diagram still works alongside the card
- [ ] "Pregnant" chip shows in another doctor's Rx for the same patient (J)
- [ ] IUD remove-by date shows as a chip (J)
- [ ] TT / Tdap given today goes to the vaccine record (K)
- [ ] Only filled rows print (D)
- [ ] Other specialties unchanged (Fertility ovary diagram unchanged)

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps | Keywords |
|---|---|---|---|---|
| `gynae.laparoscopy` ✅ | Laparoscopy (existing) | staged | Pre-op → Surgery → Stitch check → Review | laparoscopy, cyst, fibroid |
| `gynae.antenatal` | Antenatal care | **timeline** from LMP | 8–12 w → 16 w → 20 w (anomaly scan) → 24 w → 28 w (OGTT) → 32 w → 34 w → 36 w → 38 w → 40 w | pregnancy, antenatal |
| `gynae.postnatal` | Postnatal care | **staged — works today** | Day 7 (+7d) → 6 weeks (+35d) | postnatal, after delivery |
| `gynae.iud_check` | IUD insertion + check | **staged — works today** | Insertion → Thread check (+42d) → Review (+365d) | IUD, Copper-T |
| `gynae.menopause_review` | Menopause review | **review**, every 180d | — | menopause, HRT |

IUD removal (years later) = profile chip (§2 G4), not a plan step — the step gap is capped at 365 days.

### 7. Plan config row

**Plan fields:** `lmp` (date), `edd` (date), `gpal` (text).
**Step fields:** `weeks` (text), `bp` (text), `weight_kg`, `fhr` (numbers).

### 8. Plan checklist

- [ ] Postnatal + IUD check work today; antenatal waits for `timeline`, menopause for `review`
- [ ] Antenatal dates match the week chart for 3 test LMPs (when `timeline` is built)

## 9. Decisions (2026-10-24)

1. **EDD + weeks pregnant auto** from LMP; EDD editable after a dating scan.
2. **"Pregnant" profile flag**, shown as a chip in every doctor's Rx (step J).
3. IUD remove-by date = **profile chip**, not a plan step (365-day limit).
4. **Merge the `Obstetrician` block** into Gynecologist, then delete it.
5. **Ovary diagram stays** alongside the new card.
