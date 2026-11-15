# Psychiatrist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 22). Clinical values need a psychiatrist's check.
Covers sub-specialties: Child and Adolescent Psychiatrist, Addiction Psychiatrist (De-addiction) (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** private rows (risk, MSE, scores) must never print — any of the 3 paths → D. Pharmacy view + pharmacy copy show **no diagnosis** (checked).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Psychiatrist` block — depression, GAD, bipolar, PTSD, ADHD, OCD, alcohol dependence; low mood, anxiety, sleep, **suicidal thoughts**, hallucinations; ECT; adherence / no-abrupt-stop advice | BE `utils/doctorSpecialtyConfig.ts` |
| Section order | Diagnosis first, Vitals 8th | same |
| Medicine panel | Shown — **correct**, psychiatrists prescribe | FE `PrescriptionSummarySection.tsx` |
| Pharmacy | Pharmacy screen and pharmacy-copy print show **no diagnosis** | FE `pages/pharmacies/ProcessPrescription.tsx`, BE `quick-print-templates/templates/pharmacy-copy.ts` |
| Controlled drugs (benzodiazepines, Schedule H1) | No flag or register | BE `medicine`, `pharmacy` |
| Privacy | Rx = Doctor + Admin (2026-10-22 change, uncommitted); plans readable by reception | memory; `treatmentPlan.route.ts` |
| Session card | Planned for Psychologist (private print, High-risk banner) | `psychologist.md` §4 |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No mental-status / risk record** | MSE + risk + scores every visit; High risk must stand out | Reuse the Psychologist session card + psychiatry rows (§3); private print; High-risk banner | H |
| G2 | **No side-effect / drug-level tracking** | Lithium / valproate levels; weight, sugar, lipids on antipsychotics; tremor, stiffness | Card rows (§3); tests in step I | H / I |
| G3 | Section order | Complaint → exam → diagnosis | Reorder (§4) | B |
| G4 | Diagnosis list misses common cases | Schizophrenia, insomnia, panic, opioid / cannabis / tobacco dependence, postpartum depression, child disorders | Adds (§4) | B |
| G5 | Controlled-drug flag (Schedule H1) | Legal record for pharmacies | Out of scope — pharmacy feature, note only | — |
| G6 | Online follow-ups | Common | Shared, later (decided in Psychologist) | — |

### 3. Card — Psychologist session card + psychiatry rows

One card component (built in step H for Psychologist). Psychiatrists see extra rows. **Private** rows never print.

| Row | Input | Prints? |
|---|---|---|
| *Psychologist rows* | Session no., therapy type, focus, PHQ-9, GAD-7, risk, homework, progress | Homework only |
| Mood / affect | pick: Euthymic, Low, Elevated, Anxious, Irritable, Flat | No |
| Thought / perception | multi-pick: Normal, Delusions, Hallucinations, Obsessions, Suicidal ideas | No |
| Insight | pick: Full, Partial, None | No |
| Adherence | pick: Taking all, Missing some, Stopped | No |
| Side effects | multi-pick: None, Weight gain, Sleepiness, Tremor, Stiffness, Restlessness, Sexual | No |
| Lithium / valproate level, last | text, e.g. "Li 0.7 mmol/L" | No |
| Weight (kg) | from Vitals | — |

Risk = High → red banner for Doctor / Admin only (same as Psychologist).

### 4. Prescription config

**`Psychiatrist` block — changes:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Allergy → Habits → Pathology Test → Advice → Dietary Suggestions → Surgery Suggested (ECT) → Visiting Days → Follow-Up
- **Pre-Diagnosis add:** Not sleeping, Talking to self, Fearfulness, Craving, Withdrawal symptoms, School problems (child)
- **Diagnosis add:** Schizophrenia, Insomnia disorder, Panic disorder, Opioid dependence, Cannabis use disorder, Tobacco dependence, Postpartum depression, Somatic symptom disorder, Autism spectrum disorder, Conduct disorder
- **Surgery add (procedures):** rTMS
- **Advice add:** Do not drive or use machines if the medicine makes you sleepy, Family to keep medicines and give daily doses, Call the clinic or a helpline if you feel unsafe, Get the blood level test before the next visit

### 5. Checklist (tick in browser)

- [ ] New section order; new complaints / diagnoses / advice for Psychiatrist + both subs (B)
- [ ] Session card shows Psychologist rows + psychiatry rows for a Psychiatrist (H)
- [ ] Print shows homework / medicines / advice only — no MSE, risk, side effects (D + H)
- [ ] High risk → banner for Doctor / Admin; **Receptionist doesn't see it** (H)
- [ ] Pharmacy screen still shows no diagnosis
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates (names neutral — reception reads plans)

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `psychiatry.deaddiction` | De-addiction programme | **staged — works today** | Start → Review (+3d) → Review (+7d) → Review (+14d) → Review (+30d) | alcohol dependence, de-addiction |
| `psychiatry.ect_course` | ECT course | package, 8 × 2d, expiry 30d, consent | — | ECT, severe depression |
| `psychiatry.rtms` | rTMS course | package, 20 × 1d, expiry 35d, consent | Weekdays | rTMS, depression |
| `psychiatry.depot` | Long-acting injection | **review**, every 28d | Injection each visit | depot, long-acting injection |
| `psychiatry.med_review` | Medication review | **review**, every 30d | — | depression, bipolar, schizophrenia |

### 7. Plan config row

**Plan fields:** `mode` (In clinic, Online, Mixed) — nothing clinical (reception reads plans).
**Step fields:** none — session content stays on the prescription.

### 8. Plan checklist

- [ ] De-addiction, ECT, rTMS work today; depot + review wait for `review`
- [ ] Log in as Receptionist: plan shows neutral name + dates only

## 9. Decisions (2026-10-24)

1. **Reuse the Psychologist session card** + psychiatry rows (one build).
2. MSE, risk, side effects, drug levels — **all private, never print**.
3. **No clinical content in plans** — same rule as Psychologist.
4. Controlled-drug (Schedule H1) register = **pharmacy feature, later**.
5. ECT / rTMS **stay under Surgery Suggested**.
