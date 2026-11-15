# Treatment Plan — Psychologist (end-to-end plan)

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 2, specialty 11). Clinical values need a clinical psychologist's check.
Covers sub-specialties: Clinical Psychologist, Counsellor (`utils/specialtyCatalog.ts`).

**Part A (now):** G7 sections + G8 diagnosis → B · G6 hide medicines → E · G2–G4 session card + banner → H (after privacy change is committed) — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G1 rule (no therapy content in plans) · §3 templates · §5 plan fields · P1.
**Output check:** Private keys must never print in any of the 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription sections | Diagnosis, Advice, Pre-Diagnosis, Habits, Visiting Days, Follow-Up, Allergy, Vitals, Diet, Pathology Test, Surgery Suggested (empty list) | BE `utils/doctorSpecialtyConfig.ts` → `Psychologist` |
| Pick-lists | Diagnosis (GAD, depression, adjustment, PTSD, ADHD, OCD), complaints (anxiety, low mood, stress, sleep, concentration, irritability, relationships), habits (stress, isolation, negative thinking), counselling / journal advice | same file |
| Who reads prescriptions | Clinical history = Doctor + Admin; a doctor sees own visits (built 2026-10-22, uncommitted) | memory: patient-history-doctor-only |
| **Who reads plans** | **Admin, Doctor, Receptionist** (receptionist: assigned doctors) | BE `treatmentPlan/routes/v1/treatmentPlan.route.ts` (`STAFF`) |
| Online sessions | **No online / video appointment mode** — "Online" exists only as a payment mode | BE `appointments` |
| Medicine panel | Always shown (decided: hide for non-prescribing, `physiotherapist.md` §8) | FE `PrescriptionSummarySection.tsx` |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **Privacy: plans are readable by reception** | Therapy content is the most private record in the clinic | **Rule: no therapy content in plan fields.** Plan holds only session count, type, mode. Notes, scores, risk go on the prescription (Doctor + Admin only) |
| G2 | **No session note structure** | Each session: focus, what was done, homework, progress | Session card on the prescription (§4) |
| G3 | **No standard scores** — PHQ-9, GAD-7 | Shows if therapy works; common in every clinic | Score rows in the session card (§4) |
| G4 | **No risk check** (self-harm / suicide) | Safety: a "High" must stand out | Risk pick in the session card; High shows a red banner on the visit |
| G5 | No online sessions | Many therapy sessions are online | Plan field `mode` records it now; real video / online booking = separate feature |
| G6 | Medicine panel shows | Psychologists don't prescribe (psychiatrists do) | Hide (shared gap, decided) |
| G7 | Header order has empty / unused sections | Surgery Suggested (empty), Pathology, Diet, Vitals clutter | New order (§5), drop those four |
| G8 | Diagnosis list misses common cases | Panic, social anxiety, grief, insomnia, autism / learning assessment, substance use, marital issues | Add (§5) |
| G9 | No templates | Psychology work is session packages | Add 5 (§3) |

## 3. Templates (5 new)

All package — run on today's engine. Names stay neutral (visible to reception).

| Code | Template | Type / price | Sessions | Keywords |
|---|---|---|---|---|
| `psych.therapy_8` | Therapy — 8 sessions | package, package price, 8 × 7d, expiry 90d | Weekly | anxiety, depression, CBT |
| `psych.therapy_12` | Therapy — 12 sessions | package, package price, 12 × 7d, expiry 120d | Weekly | OCD, PTSD, depression |
| `psych.couple_family` | Couple / family counselling | package, package price, 6 × 14d, expiry 120d | Every 2 weeks | marital issues, family conflict |
| `psych.child_assessment` | Child assessment (learning / ADHD / autism) | package, per step, 3 × 7d, expiry 45d | History → Testing → Feedback | ADHD, learning disability, autism |
| `psych.stress_program` | Stress / sleep program | package, package price, 6 × 7d, expiry 60d | Weekly | stress, insomnia, burnout |

## 4. Session card — on the prescription only (private)

Saved in `additionalInformation` on the prescription, so it follows the Doctor + Admin rule.

| Row | Input |
|---|---|
| Session no. | number (prefilled from the plan if linked) |
| Therapy type | pick: CBT, DBT, ACT, Supportive, Family, Play therapy, Other |
| Focus today | short text |
| PHQ-9 (depression, 0–27) | number |
| GAD-7 (anxiety, 0–21) | number |
| Risk (self-harm) | pick: None, Low, Medium, **High** |
| Homework | short text — prints for the patient |
| Progress | pick: Worse, Same, Better, Much better |

- **Print:** only Homework + next date print by default; scores, risk, focus stay off the printed Rx.
- **High risk:** red banner on the visit + appointment for Doctor / Admin only.
- Plan form: **no widget.**

## 5. Config row (plan — non-sensitive only)

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `therapy_type` | Therapy type | select | CBT, DBT, ACT, Supportive, Family, Play therapy, Assessment, Other |
| `mode` | Mode | select, required | In clinic, Online, Mixed |
| `session_minutes` | Session length | select | 30, 45, 60, 90 |

**Step fields** — none. Session content lives on the prescription (G1).

**Prescription config `Psychologist` — changes** (G7, G8):
- **Sections:** Pre-Diagnosis → Diagnosis → Advice → Visiting Days → Follow-Up → Habits (drop Surgery Suggested, Pathology Test, Diet, Vitals; drop Allergy too — no drugs)
- **Diagnosis add:** Panic disorder, Social anxiety, Grief reaction, Insomnia, Burnout, Autism spectrum (assessment), Learning disability, Substance use, Marital / relationship issue
- **Advice add:** Practise breathing exercise twice a day, Limit screen time before bed, Call the clinic or a helpline if you feel unsafe

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | Prescription config changes (G7, G8) | BE | — |
| P3 | Session card on the prescription, private print, High-risk banner (G2–G4) | FE (+ BE for banner) | patient-history privacy change committed |
| P4 | Hide medicine panel (G6) | FE | Physio P4 (same change) |

Separate, later: online / video sessions (G5).

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 psychology templates for Psychologist + sub-specialties
- [ ] Sessions, gaps, expiry match §3
- [ ] Mode required; therapy type, session length save
- [ ] **Log in as Receptionist: plan shows name, sessions, mode — no clinical content**

**P2 — prescription config**
- [ ] Only the 6 sections show; new diagnoses and advice appear
- [ ] A doctor who saved their own section order keeps it

**P3 — session card**
- [ ] Card shows for Psychologist + sub-specialties only
- [ ] PHQ-9 limited to 0–27, GAD-7 to 0–21
- [ ] Print shows Homework + next date only
- [ ] Risk = High → red banner for Doctor / Admin; **Receptionist doesn't see it**
- [ ] Receptionist / nurse can't open the prescription (history rule)

**P4 — medicine panel**
- [ ] No "Add medicine" for a psychologist; prescription completes without medicines

## 8. Decisions (2026-10-24)

1. **No therapy content in plans** — only on the prescription (Doctor + Admin).
2. Print **Homework + next date only**; scores, risk, focus stay off the paper.
3. High risk = **banner now**; notification later.
4. PHQ-9 / GAD-7 as **total numbers** for now.
5. Online / video therapy = **own feature, later**; `mode` field covers it now.
