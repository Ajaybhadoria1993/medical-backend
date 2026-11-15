# Prescription services (`src/main/reports/services/`)

The old 3,200-line `report.service.ts` is split by job. HTTP routes and responses did not change.

| Service | File | Owns |
|---|---|---|
| `ReportCardService` | `reportCard.service.ts` | Writing a prescription: create / edit-today save, favourites, the PDF and notifications after a save |
| `PrescriptionPrintService` | `prescriptionPrint.service.ts` | Which template and sections print, preview context, clinic availability, building and rendering the PDF |
| `ReportHistoryService` | `reportHistory.service.ts` | Reading saved prescriptions: a patient's visits / history, one report card, Copy From Last Visit |
| `PrescriptionPreviewService` | `prescriptionPreview.service.ts` | A doctor's custom (scanned / manual) template filled with the sample visit, same render as the PDF |
| `ReportService` | `report.service.ts` | The older diagnostic reports (`/reports`, `/reports/all/:id`) |

## One sample, one render

- **Sample visit + default colours:** `reports/utils/prescriptionSample.utils.ts` (`buildPrescriptionSample`,
  `DEFAULT_TEMPLATE_CONFIG`, `DEFAULT_TEMPLATE6_COLORS`). The settings / workspace preview and the custom-template
  preview use it; Quick Print keeps its own dermatology sample on purpose.
- **Custom templates preview through Handlebars**, the engine the PDF uses, with the same default colours the
  PDF uses for them. The old search-and-replace preview (two copies in `doctor.service.ts`) is gone, so a new
  field is added once.
- **Before relying on it in an environment:** `npx cross-env NODE_ENV=staging tsx src/scripts/checkCustomTemplates.ts`
  renders every saved custom template and lists any that fail (read-only).
