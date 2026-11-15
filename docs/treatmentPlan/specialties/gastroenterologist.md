# Gastroenterologist — end-to-end plan

Status: **Templates + plan fields built 2026-10-28** in `treatmentPlan/seeds/` (prescription side built earlier).
Parent: `../specialty-rollout-research.md` (Wave 3, specialty 19). Clinical values need a gastroenterologist's check.
Covers sub-specialty: Hepatologist; also practises Proctologist (`utils/specialtyCatalog.ts`).
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.
**Output check:** endoscopy procedures are billable as clinic services and photos fit the visit gallery (both exist); gastro card must print in all 3 paths → D.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Prescription config | Full `Gastroenterologist` block — GERD, IBS-D / C, esophagitis, ulcer, cirrhosis, pancreatitis, UC; epigastric pain, heartburn, bloating, bowel change; endoscopy, colonoscopy; meal-timing / head-up advice | BE `utils/doctorSpecialtyConfig.ts` |
| Section order | Diagnosis first, Pre-Diagnosis 6th | same |
| Hepatologist / Proctologist | No blocks — use the main block | same |
| Booking symptoms | Reflux, bloating, heartburn, blood in vomit / stool, swallowing, weight loss, bowel change, jaundice, vomiting, appetite | FE `constants/specialitySymptoms.ts` |
| Procedures | Billable as clinic services; photos in the visit gallery; generic consent | `appointmentMultipleService`, `patientGallery`, `appointmentClinical` |
| Card on the Rx | None | — |
| Treatment plan | None | — |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step |
|---|---|---|---|---|
| G1 | **No gastro record** — abdomen exam, liver signs, bowel habit | Every visit checks these; liver patients are tracked by them | Gastro card (§3), single-column exam grid | F |
| G2 | **No endoscopy / colonoscopy note** | Findings, biopsy, H. pylori test are written every procedure day | Procedure rows in the same card (§3); images in the gallery | F |
| G3 | Section order | Flow is complaint → exam → diagnosis | Reorder (§4) | B |
| G4 | Diagnosis list misses common cases | Fatty liver, Hep B / C, H. pylori, gallstones, piles / fissure, Crohn's, celiac | Adds (§4) | B |
| G5 | Gastro tests (LFT, USG abdomen, FibroScan, stool, H. pylori breath test) | Lab catalog, not config | Step I | I |

### 3. Gastro card — simple

Single-column rows on the shared exam grid, in three short groups. Saved in `additionalInformation`; prints under its heading (step D).

| Group | Row | Input |
|---|---|---|
| Abdomen | Tenderness | pick: None, Epigastric, RIF, LIF, Diffuse |
| | Liver | pick: Normal, Enlarged |
| | Ascites | pick: None, Mild, Tense |
| | Jaundice | pick: None, Mild, Deep |
| | Bowel habit (Bristol) | pick: 1–7 |
| Liver | Child-Pugh class | pick: A, B, C |
| | Bilirubin (mg/dL), last | number 0–40 |
| Procedure | Procedure | pick: Upper GI endoscopy, Colonoscopy, Sigmoidoscopy, Banding, None |
| | Findings | short note |
| | Biopsy taken | pick: Yes, No |
| | H. pylori (rapid test) | pick: Positive, Negative, Not done |
| | Sedation | pick: None, Local spray, IV sedation |

Only filled rows print.

### 4. Prescription config

**`Gastroenterologist` block — changes:**
- **Sections:** Pre-Diagnosis → Vitals → Diagnosis → Pathology Test → Dietary Suggestions → Advice → Habits → Allergy → Surgery Suggested → Visiting Days → Follow-Up
- **Pre-Diagnosis add:** Black stools, Blood in stool, Difficulty swallowing, Yellow eyes, Weight loss
- **Diagnosis add:** Fatty liver (NAFLD), Hepatitis B, Hepatitis C, H. pylori gastritis, Gallstones, Piles, Anal fissure, Crohn's disease, Celiac disease, Acute gastroenteritis
- **Surgery add:** Banding of piles, ERCP, Polypectomy
- **Advice add:** Nothing to eat 6 hours before endoscopy, Take the bowel preparation as written the day before colonoscopy, Avoid painkillers like ibuprofen, No alcohol with liver disease

### 5. Checklist (tick in browser)

- [ ] New section order; new complaints / diagnoses / procedures / advice (B)
- [ ] Gastro card: picks save and reload; Bristol 1–7; bilirubin 0–40 (F)
- [ ] Procedure rows print as a short procedure note; only filled rows (D + F)
- [ ] Hepatologist gets the same block and card
- [ ] Other specialties unchanged

## Part B — treatment plan (later)

### 6. Templates

| Code | Template | Type | Steps | Keywords |
|---|---|---|---|---|
| `gastro.h_pylori` | H. pylori course + retest | **staged — works today** | Start (14-day course) → Review (+14d) → Breath test retest (+42d) | H. pylori, gastritis, ulcer |
| `gastro.endoscopy_biopsy` | Endoscopy + biopsy follow-up | **staged — works today** | Endoscopy → Biopsy report review (+7d) → Review (+30d) | endoscopy, biopsy |
| `gastro.colonoscopy` | Colonoscopy | **staged — works today** | Prep advice → Colonoscopy (+3d, max 14d) → Report review (+7d) | colonoscopy, polyp |
| `gastro.fatty_liver` | Fatty liver programme | package, 6 × 30d, expiry 200d | Monthly weight + LFT | NAFLD, fatty liver |
| `gastro.hep_b_review` | Hepatitis B review | **review**, every 180d | — | hepatitis B |

### 7. Plan config row

**Plan fields:** `condition` (GERD, H. pylori, Liver, IBD, Pancreas, Other), `procedure` (Endoscopy, Colonoscopy, None).
**Step fields:** `weight_kg`, `bilirubin`, `alt` (numbers), `biopsy_result` (select: Pending, Normal, Abnormal).

### 8. Plan checklist

- [ ] H. pylori, endoscopy, colonoscopy work on today's engine; Hep B review waits for `review`

## 9. Decisions (2026-10-24)

1. **One gastro card**, three groups (abdomen, liver, procedure).
2. Endoscopy note = **card rows + gallery images**; separate report document later if asked.
3. **New section order** — complaint first.
4. Proctologist items (piles, fissure, banding) **in this block**.
5. **Keep the 5 templates**; pancreatitis, IBD, cirrhosis review not now.
