# Immunologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Engine fit: SCIT maintenance = 36 monthly per-visit repeats.
Parent: `../specialty-rollout-research.md` (Wave 4, specialty 30). Clinical values need an immunologist / allergist's check.
Covers sub-specialty: Allergist; also practises General Physician, Rheumatologist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** skin-prick results + anaphylaxis plan must print in all 3 paths → D; allergy shots billable as clinic services (exists).

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | **None.** Generic lists | BE `utils/doctorSpecialtyConfig.ts` |
| Patient profile allergies | List of allergies (Penicillin, Dust, Pollen, Nuts, Latex, Shellfish, Sulfa, Aspirin, Ibuprofen, Eggs, Milk, Soy, Wheat) — shown in the Rx after step J | FE `PatientFormSections.tsx`, `userProfile.model.ts` |
| Booking symptoms | Recurrent infections, chronic allergies, severe asthma, autoimmune symptoms, eczema, hives, anaphylaxis, stubborn sinusitis, immunodeficiency, drug allergy | FE `constants/specialitySymptoms.ts` |
| Rows table | Planned for Ortho / Urology / Derm (rows + Add) | `prescription-first-plan.md` step G |
| Treatment plan | None; maintenance shots need `cycle` | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No prescription config** | Generic lists | New block (§4) | B |
| G2 | **No allergy test record** — skin prick per allergen | The test result *is* the diagnosis | Skin-prick rows (§3) — shared rows table | G |
| G3 | **No control scores** — urticaria (UAS7), asthma control (ACT), IgE | Shows if treatment works | Score rows (§3) — shared exam grid | F |
| G4 | **Confirmed allergy not shared** with other doctors | A confirmed drug / food allergy must reach every doctor | "Add to patient allergies" from a positive result → profile (step J) | J |
| G5 | Anaphylaxis action plan | Patient must know what to do + carry adrenaline | Advice lines (§4) + card row "Adrenaline pen prescribed" | B / F |
| G6 | Immunology tests (IgE, specific IgE, immunoglobulins, complement, ANA) | Lab catalog | Step I | I |

### 3. Card — two small parts (both reuse shared components)

**Skin-prick test** — rows table, "+ Add allergen":

| Allergen | Wheal (mm) | Result |
|---|---|---|
| House dust mite | 6 | Positive |
| + Add allergen | | |

Allergen pick: House dust mite, Cockroach, Cat, Dog, Grass pollen, Parthenium, Mould, Egg, Milk, Peanut, Wheat, Shrimp, Histamine (control), Saline (control). Result auto: Positive if wheal ≥ 3 mm over saline.

**Scores** — single-column rows:

| Row | Input |
|---|---|
| Total IgE (IU/mL) | number 0–10000 |
| Urticaria score (UAS7, 0–42) | number |
| Asthma control (ACT, 5–25) | number |
| Anaphylaxis before | pick: Never, Once, More than once |
| Adrenaline pen prescribed | pick: Yes, No |

Only filled rows print.

### 4. Prescription config

**New block `Immunologist`:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Allergy → Habits → Pathology Test → Advice → Dietary Suggestions → Visiting Days → Follow-Up (no Surgery Suggested)
- **Habits:** Pets at home, Carpets / soft toys, Smoking at home, Dusty work, Damp house
- **Allergy:** House dust mite, Pollen, Pet dander, Mould, Peanut, Egg, Milk, Shellfish, Penicillin, NSAIDs, Insect sting, Latex
- **Pre-Diagnosis:** Sneezing, Itchy eyes, Hives, Lip / face swelling, Wheeze, Itching, Frequent infections, Reaction after food / drug
- **Diagnosis:** Allergic rhinitis, Allergic asthma, Chronic urticaria, Angioedema, Food allergy, Drug allergy, Anaphylaxis (history), Atopic dermatitis, Insect venom allergy, Primary immunodeficiency (suspected), Allergic conjunctivitis
- **Advice:** Carry the adrenaline pen at all times, In a severe reaction: inject adrenaline in the outer thigh, then go to hospital, Wash bedding in hot water weekly; use mite-proof covers, Read food labels for the allergen, Wear a medical alert band

### 5. Checklist (tick in browser)

- [ ] Immunologist + Allergist see allergy lists (B)
- [ ] "+ Add allergen" rows save; Positive / Negative from wheal vs saline (G)
- [ ] A positive result can be added to the patient's allergies; another doctor sees it (J)
- [ ] Scores save; UAS7 0–42, ACT 5–25 (F)
- [ ] Only filled rows print (D)
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps or sessions | Keywords |
|---|---|---|---|---|
| `immuno.scit_buildup` | Allergy shots — build-up | **package — works today**, 12 × 7d, expiry 100d | Dose noted each session | allergen immunotherapy, allergy shots |
| `immuno.scit_maintenance` | Allergy shots — maintenance | **cycle**, monthly × 36 | — | immunotherapy maintenance |
| `immuno.slit_review` | Under-tongue drops (SLIT) review | **review**, every 90d | — | SLIT, sublingual |
| `immuno.urticaria_review` | Chronic urticaria review | **review**, every 30d | UAS7 each visit | urticaria, hives |

### 7. Plan config row

**Plan fields:** `allergen` (text), `route` (Injection, Under-tongue drops).
**Step fields:** `dose` (text), `reaction` (None, Local, Systemic).

### 8. Plan checklist

- [ ] Build-up package works today; maintenance waits for `cycle`, reviews for `review`

## 9. Decisions (2026-10-24)

1. Skin-prick rows on the **shared rows table**, scores on the **shared exam grid** — no new component.
2. **Auto Positive / Negative** from wheal ≥ 3 mm over saline.
3. **"Add to patient allergies"** from a positive test (step J).
4. Anaphylaxis plan = **advice lines now**; printable action-plan card later.
5. Allergist **uses the same block**.
