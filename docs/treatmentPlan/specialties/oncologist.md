# Oncologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: Chemo cycles are named per-cycle steps; radiation is 25 daily sessions (no weekday-only scheduling).
Parent: `../specialty-rollout-research.md` (Wave 4, specialty 25). Clinical values need an oncologist's check.
Covers sub-specialties: Medical, Surgical, Radiation, Hemato-Oncologist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** oncology card must print in all 3 paths → D; chemo day-care charges billable as clinic services (exists).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` |
| Vitals | Height, weight, BMI (auto) — **no BSA** (body surface area, used for chemo doses) | FE `prescription/details/constants.ts`, `helpers.ts` |
| Booking symptoms | Weight loss, fatigue, lump, mole change, cough / hoarseness, pain, night sweats, fever, bruising, abnormal biopsy | FE `constants/specialitySymptoms.ts` |
| Medicine panel | Shown; injection instruction phrases exist | FE; BE `instructionSuggestionDefaults.ts` |
| Privacy | Plans readable by reception | `treatmentPlan.route.ts` |
| Treatment plan | None; chemo cycles need the `cycle` type (not built) | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Generic lists | New block (§4) | B |
| G2 | **No oncology record** — site, stage, regimen, cycle, performance, toxicity, pre-chemo counts | Every oncology visit; decides if the next cycle can go ahead | Oncology card (§3) | F |
| G3 | **No BSA** | Chemo doses are per m² | Card shows BSA auto from Vitals height + weight (Mosteller); **dose stays typed by the doctor** — no auto-dose (safety) | F |
| G4 | Cancer tests (CBC, LFT, RFT, tumour markers, PET-CT, biopsy / IHC) | Lab catalog, not config | Step I | I |
| G5 | Chemo cycles / radiation fractions | Core treatment schedule | Part B — cycles need `cycle` type; radiation works today as a package | — |

### 3. Oncology card — simple

Single-column rows on the shared exam grid. Saved in `additionalInformation`; prints under its heading (step D).

| Row | Input |
|---|---|
| Cancer site | pick: Breast, Lung, Head & neck, Cervix, Ovary, Colorectal, Stomach, Prostate, Blood, Lymphoma, Other |
| Stage | pick: I, II, III, IV, Not staged |
| Histology / markers | short note (e.g. "IDC, ER+ PR+ HER2−") |
| Line of treatment | pick: First, Second, Third+, Palliative, Surveillance |
| Regimen | short note (e.g. "AC × 4 → Paclitaxel × 12") |
| Cycle | text, e.g. "3 of 6" |
| BSA (m²) | **auto** from Vitals height + weight; read-only |
| ECOG performance | pick: 0, 1, 2, 3, 4 |
| Pre-chemo counts | text, e.g. "Hb 10.2, ANC 1800, Plt 1.6 L" |
| Worst side effect (grade) | pick: None, Grade 1, 2, 3, 4 + short note (which one) |
| Go ahead with this cycle | pick: Yes, Delay, Dose reduce |

Only filled rows print.

### 4. Prescription config

**New block `Oncologist`:**
- **Sections:** Vitals → Pre-Diagnosis → Diagnosis → Allergy → Pathology Test → Advice → Dietary Suggestions → Surgery Suggested → Visiting Days → Follow-Up (no Habits — moved under Pre-Diagnosis as tobacco use)
- **Allergy:** Drug allergy, Contrast allergy, Platinum (chemo) reaction, Paclitaxel reaction
- **Pre-Diagnosis:** Lump, Weight loss, Pain, Vomiting after chemo, Loose motions, Mouth ulcers, Fever after chemo, Tingling hands / feet, Tobacco use
- **Diagnosis:** Carcinoma breast, Carcinoma lung, Head and neck cancer, Carcinoma cervix, Carcinoma ovary, Colorectal cancer, Carcinoma prostate, Lymphoma, Leukaemia, Chemotherapy-induced nausea, Febrile neutropenia, Cancer pain
- **Surgery Suggested (procedures):** Biopsy, Port / PICC insertion, Mastectomy, Radiotherapy, Palliative care referral
- **Advice:** Go to hospital at once if fever above 100.4°F after chemo, Drink 2–3 litres of water on chemo days, Avoid crowds and raw food when counts are low, Keep the port / PICC dry and covered, Get the blood test 1 day before the next cycle
- **Diet:** High-protein small meals, Well-cooked food only during chemo, Ginger or lemon for nausea

### 5. Checklist (tick in browser)

- [ ] Oncologist sees oncology lists for all 4 subs (B)
- [ ] BSA calculates from Vitals height + weight and matches a manual check; empty if height / weight missing (F)
- [ ] No dose is auto-calculated (F)
- [ ] Cycle, ECOG, side-effect grade, go-ahead save and reload; only filled rows print (D + F)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates (names plain — reception schedules them)

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `onco.chemo_21d` | Chemotherapy — 21-day cycles | **cycle**, 6 × 21d | Counts check before each cycle | chemotherapy, chemo |
| `onco.chemo_weekly` | Weekly chemotherapy | **cycle**, 12 × 7d | — | weekly paclitaxel |
| `onco.radiation_25` | Radiation — 25 fractions | **package — works today**, 25 × 1d, expiry 40d | Weekdays | radiotherapy, radiation |
| `onco.surgery` | Cancer surgery | **staged — works today** | Pre-op → Surgery (+7d, max 30d) → Drain / wound check (+5d) → Biopsy report review (+10d) | surgical oncology |
| `onco.surveillance` | Follow-up after treatment | **review**, every 90d | Tumour marker + scan as due | surveillance, remission |

### 7. Plan config row

**Plan fields:** `site` (same list as §3), `regimen` (text).
**Step fields:** `cycle_no` (number), `delayed` (boolean). Counts, toxicity stay on the prescription.

### 8. Plan checklist

- [ ] Radiation + surgery work today; chemo waits for `cycle`, surveillance for `review`
- [ ] A delayed cycle moves later cycles too (check when `cycle` is built)

## 9. Decisions (2026-10-24)

1. BSA **auto from Vitals**; **no auto-calculated chemo dose** — doctor types it (safety).
2. **Oncology card with the 11 rows** in §3.
3. Counts + side effects **only on the prescription**, not in plan steps.
4. Chemo day-care charges **as clinic services** (exists).
5. Radiation = **package now** (works today).
