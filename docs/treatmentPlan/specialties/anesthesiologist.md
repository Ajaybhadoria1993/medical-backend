# Anesthesiologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 24 — last of Wave 3). Clinical values need an anaesthetist's check.
Covers sub-specialty: Pain Management Specialist; also practises General Physician, Intensivist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** "Fit for anaesthesia" is a certificate — only sick-leave exists (shared certificate gap); PAC card must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` |
| Booking symptoms | **None** (only Anesthesiologist and Dietitian lack them) | FE `constants/specialitySymptoms.ts` |
| Surgeon pre-op | Surgeon's planned step field "Anaesthesia fitness" (yes / no) | `general-surgeon.md` §5 (later) |
| Referral | Surgeon → anaesthetist via referral letter (exists) | `appointmentClinical.referrals` |
| Procedures | Nerve blocks / injections billable as clinic services | `appointmentMultipleService` |
| Medicine panel | Shown — correct (pain medicines) | FE |
| Treatment plan | None | — |

OPD work = **pre-anaesthetic check-up (PAC)** before surgery + **pain clinic**.

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Generic lists | New block (§4) | B |
| G2 | **No booking symptoms** | Patient can't pick a reason | Add list (§4) | C |
| G3 | **No PAC record** — ASA grade, airway, fitness | The PAC note decides if surgery goes ahead | PAC card (§3) | F |
| G4 | **No pain-clinic record** | Pain score, type, site over visits | Pain rows in the same card (§3) | F |
| G5 | Fit-for-anaesthesia certificate | Surgeon / hospital needs it on paper | Shared certificate gap (later) | — |

### 3. PAC + pain card — simple

Single-column rows on the shared exam grid, two groups. Saved in `additionalInformation`; prints under its heading (step D).

| Group | Row | Input |
|---|---|---|
| PAC | Planned surgery | short note |
| | ASA grade | pick: I, II, III, IV, V |
| | Airway (Mallampati) | pick: I, II, III, IV |
| | Mouth opening | pick: Normal, Reduced |
| | Neck movement | pick: Normal, Reduced |
| | Loose teeth / dentures | pick: None, Loose teeth, Dentures |
| | Past anaesthesia problem | short note |
| | Planned anaesthesia | pick: General, Spinal, Epidural, Nerve block, Local + sedation |
| | Fasting advised | pick: 6 h food / 2 h clear fluids, Other |
| | Fitness | pick: Fit, Fit — higher risk, Not fit yet (needs optimisation) |
| Pain | Pain site | short note |
| | Pain score (0–10) | number |
| | Pain type | pick: Nociceptive, Neuropathic, Mixed, Cancer pain |

Only filled rows print.

### 4. Prescription config

**New block `Anesthesiologist`:**
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Allergy → Habits → Pathology Test → Advice → Surgery Suggested → Follow-Up (no Diet, Visiting Days)
- **Habits:** Smoking, Alcohol, Tobacco chewing, Snoring
- **Allergy:** Anaesthesia drug allergy, Latex allergy, Drug allergy, Iodine / contrast allergy
- **Pre-Diagnosis:** Pre-surgery check-up, Back pain, Neck pain, Knee pain, Nerve pain, Cancer pain, Headache, Shoulder pain
- **Diagnosis:** Fit for surgery, Fit — higher risk, Difficult airway, Uncontrolled diabetes (pre-op), Uncontrolled hypertension (pre-op), Chronic low back pain, Lumbar radiculopathy, Knee osteoarthritis pain, Post-herpetic neuralgia, Trigeminal neuralgia, Cancer pain
- **Surgery Suggested (procedures):** Epidural steroid injection, Nerve block, Radiofrequency ablation, Trigger-point injection, Genicular nerve block
- **Advice:** Nothing to eat 6 hours before surgery; water allowed until 2 hours before, Take your BP medicines with a sip of water on the morning of surgery, Stop blood thinners only as told by your doctor, Bring all your reports and medicines on the day of surgery

**Booking symptoms (FE):** Pre-surgery check-up, Chronic back pain, Neck pain, Knee pain, Nerve pain, Cancer pain, Headache / migraine, Shoulder pain, Pain after surgery.

### 5. Checklist (tick in browser)

- [ ] Anaesthetist sees PAC / pain lists; no Diet / Visiting Days (B)
- [ ] Booking an anaesthetist shows symptoms (C)
- [ ] PAC card: ASA / Mallampati / fitness picks save and reload; pain 0–10 (F)
- [ ] Only filled rows print (D + F)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `anaes.epidural_steroid` | Epidural steroid injection | **staged — works today** | Injection → Review (+14d) → Review (+42d) | back pain, sciatica, epidural |
| `anaes.rf_ablation` | Radiofrequency ablation | **staged — works today** | Diagnostic block → RFA (+14d) → Review (+30d) | knee pain, facet pain, RFA |
| `anaes.pain_block_series` | Nerve block series | package, 3 × 14d, expiry 60d | — | nerve block, chronic pain |
| `anaes.cancer_pain_review` | Cancer pain review | **review**, every 14d | — | cancer pain |

PAC itself is a single visit — no plan. Its "Fitness" result is what the Surgeon's plan step reads (later).

### 7. Plan config row

**Plan fields:** `pain_site` (select: Back, Neck, Knee, Shoulder, Head / face, Other), `procedure` (select from §4).
**Step fields:** `pain_score` (number 0–10), `relief` (select: None, < 50%, > 50%).

### 8. Plan checklist

- [ ] Epidural + RFA work today; cancer pain review waits for `review`

## 9. Decisions (2026-10-24)

1. **One card**, PAC + pain groups.
2. Fit-for-anaesthesia certificate = **part of the shared certificate feature**, later.
3. PAC "Fitness" **feeds the Surgeon pre-op step** — plan phase.
4. Intensivist (ICU) **out of scope**.
5. **No Diet, Visiting Days** sections.
