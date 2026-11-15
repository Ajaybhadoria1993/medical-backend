# Specialty code groundwork — standard way first (plan only)

Status: **plan approved 2026-10-26 — G1–G4 built; G5 on hold; G6 (= F1, exam tables) built 2026-10-26.** Written after reviewing the current code.
Runs **before** `prescription-first-plan.md` steps B–K. Each item is approved by name before code.
Rules followed: `BACKEND_STANDARDS.md` / `FRONTEND_STANDARDS.md` — "fix what you touch", cleanups as
their own commit, no sweeping refactor.

## 1. What the review found

| # | Finding | Where | Why it blocks a clean rollout |
|---|---|---|---|
| R1 | All specialty lists are one 2,110-line data file | BE `utils/doctorSpecialtyConfig.ts` | +15 specialties → ~3,500 lines; every change is a merge conflict in one file |
| R2 | The screen decides "which specialty gets a diagram" by **name checks in the FE** (`=== "dentist"`, an ob-gyn name set) | FE `helpers/dentalChart.ts`, `helpers/ovaryDiagram.ts`, used in 3 places | Backend and screen can disagree; each new specialty adds another name check. `obstetrician` in the set is dead (main is always saved) |
| R3 | Tooth chart and ovary diagram render **twice** (copy-pasted JSX for "no medicines" / "has medicines") and sit under the medicines, not in the pad | FE `PrescriptionSummarySection.tsx` 361–375, 438–452 | Every new diagram would be pasted twice; doctor cannot move or hide it |
| R4 | Specialty data is a flat text map with mixed keys (`Tooth-36`, `Uterus`) | `additionalInformation` (`Record<string,string>`) | No way to know which section a key belongs to → print shows raw "key - value" |
| R5 | Print block for that data is **copied into 6 report templates**; quick print and the patient-page PDF don't print it | BE `htmltamplates/report_card1–6.ts`, `quick-print-templates`, FE `pages/patient/PrescriptionPdf.tsx` | 9 places to change per new section. The treatment-plan block already shows the fix: one shared block (`htmltamplates/treatmentPlan.ts`) |
| R6 | Patient-page PDF is a separate React renderer that already drifted (no treatment plan, no specialty data) | FE `PrescriptionPdf.tsx` (495 lines) | Breaks BE playbook §4 "one code path per generated document" |
| R7 | Pad sections are one big inline map keyed by the **display label** (`"Follow-Up (days)"`) | FE `PrescriptionDetailsPanel.tsx` (1,336 lines) | Doctors' saved section order stores these labels → **a label must never be renamed** |
| R8 | Same small helpers duplicated (`readToothNote` / `readStructureNote`, `isValidToothNote` / `isValidStructureNote`) | FE dental + ovary helpers | Will be copied a third time for ENT |
| R9 | Large files on the path: `PrescriptionWorkspace.tsx` 2,656, `PrescriptionEditorCard.tsx` 1,749, `report.service.ts` 3,050 | FE / BE | Split only the part we touch (playbook backlog rule) |
| R10 | Doctor-preferences response is read in 3 shapes on the FE (`result`, `data.result`, `data`) | FE `details/helpers.ts` `extractDoctorPreferences` | Adding `sections` to the response must use one shape |

Good already: list merging (`resolvePreferenceLists`) is tested; the treatment-plan print block is
the right pattern; Super Admin reads the same backend config.

## 2. The standard (one way, for every specialty)

1. **Backend owns specialty knowledge.** Lists, section order **and which specialty sections / diagrams
   exist** come from the backend with doctor preferences. The FE never checks a specialty name.
2. **One file per specialty** for its data; one index exports the same functions as today.
3. **A specialty section is a pad section** — listed in `header_order`, rendered by one component
   from its config, reorderable / hideable. Diagrams (tooth chart, ovary, ear drum) are pad sections too.
4. **Saved data stays in `additionalInformation`** (no migration). New keys are namespaced
   `section.row.column` (e.g. `ear.right.canal`); old `Tooth-36` / `Uterus` keys keep working.
5. **One print block** for specialty sections, shared by all report templates and quick print
   (same as `treatmentPlan.ts`). Labels come from the section config, so screen and print match.
6. **One prescription PDF.** The patient page shows the server PDF instead of its own renderer.
7. **Never rename a section label** — saved orders store it. New sections are appended to saved orders.

## 3. Groundwork steps (in order, each its own commit)

| Step | What | Repo | Risk | Behaviour change |
|---|---|---|---|---|
| **G1** | Split `doctorSpecialtyConfig.ts` into `utils/specialties/<specialty>.ts` + index; same exports; existing test passes unchanged | BE | Low (pure move) | None |
| **G2** | Add `sections` to the doctor-preferences response (which diagram / section each specialty has). FE reads it instead of name checks; remove `isDentistSpeciality` / `isObGynSpeciality` from 3 places | BE + FE | Low | None — Dentist and Gyn see the same as today |
| **G3** | Move tooth chart + ovary diagram into the pad as sections ("Dental Chart", "Ovary Diagram"); delete the duplicated JSX; one shared note helper (R8) | FE | Medium — doctors see them in a new place | Diagram moves from under medicines to the pad |
| **G4** | One shared specialty print block (labels from config, filled rows only, private keys skipped) used by `report_card1–6` and quick print — **this is step D** | BE | Medium — every print | Raw "key - value" becomes headed, labelled rows |
| **G5** | Patient-page PDF uses the server PDF; retire the separate renderer after a side-by-side check | FE | Medium | Patient PDF gains treatment plan + specialty data |
| **G6** | Generic section component (Right / Left table, "+ Add rows") driven by backend config — **this is steps F / G**, first used by ENT + Eye | FE (+ BE config) | Medium | New sections appear for ENT + Eye |

G1, G2 and the R8 helper cleanup are small and safe; G3–G6 change what doctors see and need a browser check each.

## 4. How it joins the existing order

```
G1 split data  →  G2 backend says which sections  →  B lists + C small adds
→  G3 diagrams into pad  →  G4 print block (= D)  →  G5 one PDF
→  J profile tags + E hide medicines  →  G6 section component (= F/G) with ENT + Eye
→  other specialties in batches  →  H unique cards  →  K vaccine record  →  I tests
```

Super Admin preview (Speciality Defaults → Prescription) reads the same `sections`, so it stays in sync from G2 on.

## 5. Checks per step

- **G1** — existing specialty-config test passes; Super Admin Prescription tab unchanged for 3 specialties.
- **G2** — Dentist sees the tooth chart, Gynecologist + Fertility see the ovary diagram, GP sees neither; Super Admin preview same as before.
- **G3** — chart shows in the pad, can be moved / hidden in Prescription Preference; old prescriptions reopen with their tooth notes.
- **G4** — one Dentist prescription printed in all 6 layouts + quick print: tooth notes under a heading, no raw keys; old prescriptions still print.
- **G5** — patient page PDF matches the clinic PDF for the same prescription.
- **G6** — ENT Ear Exam: fill, save, reopen, print; GP unchanged.

## 6. Open questions (log)

1. **Decided (2026-10-26, revised same day):** the charts are **not** pad sections and are **not** stored in the section order (mobile-safe). They open full-size inside the widened Clinical details drawer, notes beside the chart (no pop-ups), from a chip on the main screen or a button beside Done. The backend only names them in `sections` ("Dental Chart", "Reproductive Chart").
2. **ON HOLD (2026-10-26)** — Patient page PDF → server PDF: any reason the patient page must render offline / client-side? **G5 waits for this.**
3. **Answered (2026-10-26): yes, the mobile app reads them.** Mobile update is prepared later. Until then every change stays backward compatible: no section label renamed or removed, old keys (`Tooth-36`, `Uterus`) keep working, new sections and keys are additions only. **G3, G6 must pass a mobile check before release.**

## 7. Specialty knowledge still kept on the FE — move to the BE (added 2026-10-26)

Same rule as §2.1: the backend owns specialty knowledge; the FE only shows what it is sent.
**Rule for new code: no specialty name, list or mapping is added to the FE.**

| # | What | FE file | Move to | When |
|---|---|---|---|---|
| F1 | "Is dentist / gyn" name checks for diagrams | `workspace/helpers/dentalChart.ts`, `ovaryDiagram.ts` | `sections` in doctor preferences | G2 |
| F2 | ✅ **Done 2026-10-26** (C4) — Booking recommended symptoms (770 lines, 64 names — ~30 are sub-specialties that never match, since doctors are saved with the main) | `constants/specialitySymptoms.ts`, used by `new-appointment/components/SymptomsSection.tsx` | a `symptoms` list per **main** specialty in BE `utils/specialties/`; sent with the doctor data the booking screen already loads; FE file deleted. Add Dietitian + Anaesthesia lists | Step C |
| F3 | Public "Find Doctors" filter: 8 hard-coded names; **"Orthopedist" is not a catalog name** ("Orthopedic Doctor"), so that filter likely finds no one | `pages/doctorPublic/FindDoctors.tsx` | small public read of catalog main names (no login) | own small step after G2 — browser-check the bug first |
| F4 | Specialty → degree keyword map for qualification suggestions | `utils/qualificationSuggestions.ts` | qualification catalog (BE) | later, with the qualification work |

F2 checks before build: which BE call gives the booking screen its doctor; whether the mobile app has its own symptom list
(if yes, nothing breaks — it switches later). Browser check: book Dentist, Dietitian, GP → each shows its own symptoms; typed search still works.
