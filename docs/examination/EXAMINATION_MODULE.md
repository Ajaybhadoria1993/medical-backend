# Examination module (`src/main/examination/`)

The engine behind the specialty exam tabs (ENT, Eye, Diet, Session…). Logic only: no routes, no tables.
Other code imports **only** from `src/main/examination/index.ts`.

## What lives where

| Piece | Where | Owner |
|---|---|---|
| Each specialty's tabs, lists, tests, vaccine names (configuration) | `src/utils/specialties/*.ts` | specialty config |
| Tab / field **types** | `src/utils/specialties/examTables.ts` | specialty config |
| Save check (`noteProblem`), the key map (`EXAM_KEYS`) | `examination/utils/examKeys.utils.ts` | examination |
| Print rows (`chartPrintSections`, `visitPrintSections`) | `examination/utils/chartPrint.utils.ts` | examination |
| Privacy (`ExaminationService.notesFor`), vaccine picks on a visit | `examination/services/examination.service.ts` | examination |
| Vaccine record, schedule, patient-bar columns | `src/main/patient/` (`PatientVaccineService`) | patient |

## Storage

**`visit_examinations`** (model `examination/models/visitExamination.model.ts`): one row per visit,
`appointment_id` (PK) · `patient_id` · `clinic_id` · `findings` (JSONB, flat keys like `ear.right.canal`,
`Tooth-36`) · timestamps; index on (patient_id, clinic_id).

- **Writes:** the prescription save (`createPatientReportCard`, edit-today `updatePatientReportCard`) sends
  the visit's `additionalInformation` to `ExaminationService.saveFindings` in the same transaction. A card
  with no visit keeps them inline in `report_cards.additional_information`.
- **Reads:** `ExaminationService.findingsColumn(appointmentId, legacy)` inside the caller's own query:
  this table first, else the older copy in `report_cards.additional_information`. No data copy was needed;
  that old column stays until a later clean-up.
- **API unchanged:** responses still carry the field as `reportCard.additionalInformation`, so screens and
  the mobile app see no difference.
- Keys are never renamed; old visits keep printing.

## Rules

- **Every read that returns exam notes goes through `ExaminationService.notesFor(notes, role)`.**
  Doctor / Admin get them whole; everyone else (reception, nurse, the patient) loses `private.` keys and
  never-print cells. `__tests__/notesPrivacy.test.ts` fails if a service reads the notes without it.
- The prescription save hands the visit's vaccine picks to `PatientVaccineService.syncVisitDoses` only when
  the save carries the vaccine field, so a client that doesn't send it never clears doses.
- The patient module owns its table: appointment details takes the last / next vaccine from
  `PatientVaccineService.patientBarColumns` / `nextDue`, inside its existing query.
