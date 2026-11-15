# Treatment Plan — Ayurvedic Doctor (end-to-end plan)

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 2, specialty 14). Clinical values need a BAMS doctor's check.
Covers sub-specialties: Panchakarma Specialist, Ayurvedic Physician (Kayachikitsa) (`utils/specialtyCatalog.ts`).

**Part A (now):** G1 new Rx config + G6 Pathya lists → B · G3 forms + G4 anupana phrases → C · G2 exam card → F — steps in `prescription-first-plan.md`.
**Part B (later, treatment plan):** G5, G8 · §3 templates · §5 plan / step fields · P1.
**Output check:** —.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | Symptoms, notes, vitals, referrals, consent note + file | BE `appointments/models/appointmentClinical.model.ts` |
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` → `GENERIC_DOCTOR_PREFERENCES` |
| Booking symptoms | Digestive issues, fatigue, joint pain, skin, stress, sleep, weight, hormones, immunity, acidity | FE `constants/specialitySymptoms.ts` |
| Medicine panel | Shown — **correct here**, Ayurvedic doctors prescribe | FE `PrescriptionSummarySection.tsx` |
| Medicine forms | Free text; suggestion list has **no Ayurvedic forms** (Churna, Vati, Kwath, Arishta…) | FE `editor/constants.ts` → `MEDICINE_FORM_OPTIONS` |
| Food timing | Before Food, After Food, Empty stomach, Custom | FE `helpers/schedulePattern.ts` |
| Instruction suggestions | Built-in phrases **per medicine form** | BE `doctor/utils/instructionSuggestionDefaults.ts` |
| Treatment plan templates | **None** | BE `seeds/libraryTemplates.json` |
| Plan specialty fields | No config row | `treatment_specialty_configs` |

## 2. What's missing

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| G1 | **No prescription config** | Ayurvedic doctor sees GP lists | New block (§5), Ayurvedic + modern names |
| G2 | **No Ayurvedic exam** — Prakriti, Vikriti, Agni, Nadi, Koshta | Every Ayurvedic consult starts here; it decides the treatment | Ayurveda exam card (§4) |
| G3 | **No Ayurvedic medicine forms** | Doctor types "Churna" every time | Add forms to the suggestion list (§5) |
| G4 | **No anupana (vehicle)** — with warm water / honey / ghee / milk | Part of every Ayurvedic dose | Instruction phrases per new form — no new field (§5) |
| G5 | No therapy record per session | Panchakarma is daily therapies; each day's therapy + oil matters | Step fields (§5) |
| G6 | No Pathya–Apathya (diet do / don't) lists | Diet is half of Ayurvedic treatment | Dietary Suggestions list (§5) |
| G7 | Daily sessions | Package `intervalDays: 1` — works | No gap |
| G8 | No templates | Panchakarma is the core package | Add 5 (§3) |

## 3. Templates (5 new)

All package except Virechana — run on today's engine. Daily sessions = interval 1 day.

| Code | Template | Type / price | Sessions / steps | Keywords |
|---|---|---|---|---|
| `ayur.panchakarma_7` | Panchakarma — 7 days | package, package price, 7 × 1d, expiry 14d | Daily therapies; doctor changes count to 14 / 21 | detox, panchakarma |
| `ayur.virechana` | Virechana (purgation) | staged, package, consent | Snehapana start → Snehapana check (+3d) → Abhyanga + Swedana (+2d) → Virechana day (+1d) → Diet review (+7d) | virechana, skin disease, acidity |
| `ayur.shirodhara` | Shirodhara | package, package price, 7 × 1d, expiry 14d | — | stress, insomnia, anxiety, headache |
| `ayur.kati_janu_basti` | Kati / Janu Basti (back / knee) | package, package price, 7 × 1d, expiry 14d | — | back pain, knee pain, sciatica |
| `ayur.nasya` | Nasya | package, per step, 7 × 1d, expiry 14d | — | sinusitis, migraine, rhinitis |

## 4. Ayurveda exam card — simple

Fixed rows, one column — same exam-grid component as eye / ENT (single-value rows). Saved in `additionalInformation`.

| Row | Input |
|---|---|
| Prakriti (body type) | pick: Vata, Pitta, Kapha, Vata-Pitta, Pitta-Kapha, Vata-Kapha, Sama |
| Vikriti (current imbalance) | multi-pick: Vata, Pitta, Kapha |
| Agni (digestion) | pick: Sama, Vishama, Tikshna, Manda |
| Koshta (bowel) | pick: Mridu, Madhya, Krura |
| Nadi (pulse) | pick: Vata, Pitta, Kapha, mixed + short note |
| Jihva (tongue) | pick: Clean, Coated (Sama), Dry |
| Mala / Mutra (stool / urine) | short note |
| Nidra (sleep) | pick: Good, Disturbed, Less, Excess |

- Only filled rows print; Prakriti also saved on the plan (§5) so later visits see it.
- Plan form: **no widget.**

## 5. Config row

**Plan fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `condition` | Condition | select, required | Joint pain, Digestive, Skin, Stress / sleep, Weight, Respiratory, Detox / wellness, Other |
| `prakriti` | Prakriti | select | Vata, Pitta, Kapha, Vata-Pitta, Pitta-Kapha, Vata-Kapha, Sama |
| `therapist_pref` | Therapist preference | select | Male, Female, Any |

**Step fields**

| Key | Label | Type | Options |
|---|---|---|---|
| `therapies` | Therapies done | multiselect | Abhyanga, Swedana, Shirodhara, Basti, Kati Basti, Janu Basti, Nasya, Virechana, Udvartana, Pizhichil, Elakizhi |
| `oil_used` | Oil / medicine used | text | e.g. Mahanarayan taila |
| `reaction` | Reaction | select | None, Comfortable, Mild discomfort, Stopped early |
| `step_note` | Note | text | short |

**Medicine forms to add** (FE `MEDICINE_FORM_OPTIONS`): Churna, Vati, Guggulu, Kwath, Arishta, Asava, Bhasma, Ghrita, Taila, Avaleha.

**Instruction phrases per form** (BE `instructionSuggestionDefaults.ts`) — covers anupana:
- Churna: Take with warm water, Take with honey, Take with buttermilk
- Vati / Guggulu: Take with warm water, Chew and take with warm water
- Kwath: Take fresh, warm, on an empty stomach
- Arishta / Asava: Mix with equal water, after food
- Ghrita: Take with warm milk, early morning
- Taila: Apply warm and massage gently

**New prescription config block `Ayurvedic Doctor`** (G1):
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Allergy → Habits → Pathology Test → Dietary Suggestions → Advice → Visiting Days → Follow-Up (no Surgery Suggested)
- **Habits:** Day sleep, Late-night waking, Irregular meals, Cold drinks, Holding natural urges, Sedentary lifestyle, Eating curd at night
- **Allergy:** Oil allergy, Herbal medicine allergy, Drug allergy
- **Pre-Diagnosis:** Joint pain, Acidity, Constipation, Fatigue, Poor sleep, Skin rash, Weight gain, Frequent cold
- **Diagnosis:** Amavata (rheumatoid arthritis), Sandhivata (osteoarthritis), Grudhrasi (sciatica), Amlapitta (acidity), Vibandha (constipation), Prameha (diabetes), Sthaulya (obesity), Anidra (insomnia), Twak roga (skin disease), Pratishyaya (rhinitis)
- **Dietary Suggestions (Pathya):** Eat warm, freshly cooked food, Avoid curd at night, Drink ginger-cumin water, Avoid cold and stale food, Eat the main meal at noon
- **Advice:** Wake before sunrise, Oil massage before bath, Avoid day sleep, Practise pranayama 15 minutes daily, Follow the diet chart strictly

## 6. Build phases

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| P1 | Config row (§5) + 5 templates (§3) | BE | Dentist P1 (config seed) |
| P2 | New Rx config block (G1) + instruction phrases per form (G4) | BE | — |
| P3 | Ayurvedic medicine forms in the suggestion list (G3) | FE | — |
| P4 | Ayurveda exam card (G2) | FE (+ print) | reuse eye-grid build (Ophthalmologist P3) |

## 7. Checklist (tick in browser after each phase)

**P1 — templates and fields**
- [ ] Plan picker shows 5 Ayurveda templates for Ayurvedic Doctor + subs
- [ ] Daily packages book 7 sessions 1 day apart; Virechana has 5 steps
- [ ] Condition required; Prakriti, therapist preference save
- [ ] Therapies (multi), oil used, reaction save per session

**P2 — prescription config**
- [ ] Ayurvedic doctor sees Ayurvedic lists; diagnoses show both names
- [ ] Picking form "Churna" offers "Take with warm water / honey / buttermilk"
- [ ] Own suggestions on top; saved section order kept

**P3 — medicine forms**
- [ ] Churna, Vati, Kwath etc. appear in the form picker
- [ ] Other doctors' medicine forms unchanged

**P4 — exam card**
- [ ] Card shows for Ayurveda only; picks save and reload
- [ ] Only filled rows print; old prescriptions still open

## 8. Decisions (2026-10-24)

1. Diagnoses show **both names**, e.g. "Amavata (rheumatoid arthritis)".
2. Anupana via **instruction phrases per form** — no new field.
3. **Therapist preference** (male / female / any) on the plan.
4. **One 7-day Panchakarma template**; doctor extends to 14 / 21.
5. **Keep the 5 templates**; Basti course, Udvartana, Raktamokshana not now.
