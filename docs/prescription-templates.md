# Prescription Templates — Design & Regeneration Guide

This project ships **six distinct, non-overlapping** prescription templates
(`template6` doubles as the default fallback). They are rendered with
[Handlebars](https://handlebarsjs.com/) in two places:

- **PDF generation** — `generateAndUploadPdf()` in `src/utils/pdf.utils.ts`
- **Live preview** — `getPreviewPrescriptionTemplateController` in
  `src/main/reports/controllers/report.controller.ts`
  (`POST /api/v1/reports/preview-prescription-template`)

| Slot        | File                                | Design                           | Selectable |
| ----------- | ----------------------------------- | -------------------------------- | ---------- |
| `template1` | `src/htmltamplates/report_card1.ts` | **Simple / Minimal**             | yes        |
| `template2` | `src/htmltamplates/report_card2.ts` | **Letterhead Pad**               | yes        |
| `template3` | `src/htmltamplates/report_card3.ts` | **Handwritten Pad**              | yes        |
| `template4` | `src/htmltamplates/report_card4.ts` | **Modern Banner**                | yes        |
| `template5` | `src/htmltamplates/report_card5.ts` | **Clinical Rail**                | yes        |
| `template6` | `src/htmltamplates/report_card6.ts` | **Clinical Card** (also default) | yes        |

> Picker order is **not** template numbering: the FE `templateOptions` list shows
> Template 6 and 5 first because they are the current house layouts. Reordering
> that list is display-only — the persisted `templateName` keys never change.

> The selector → file mapping lives in `report.service.ts` (`switch (latestTemplate.templateName)`
> and the `namedMap` in `getResolvedTemplateForPreview`).
> `template6` is also the fallback used when a doctor has no template configured. All six are genuinely distinct designs.

---

## 1. Shared data contract (consistency)

Every template **must** use only these Handlebars variables and **must not**
introduce new ones without updating the data builders in `report.service.ts`
(`pdfData`) and `report.controller.ts` (`sampleData`). Keeping this contract
identical across templates is what makes them consistent and interchangeable.

### `templateConfig`
```
templateConfig.fontFamily            // the saved CSS stack, e.g. "Inter, sans-serif"
templateConfig.primaryFont           // bare family name, e.g. "Inter" — use THIS in CSS
templateConfig.fontUrl               // ready-made Google Fonts href (may be empty)
templateConfig.colors.color1..color10
```

**Never interpolate `fontFamily` into a `font-family` declaration.** It is a
*stack*, so `font-family: '{{templateConfig.fontFamily}}'` renders
`font-family: 'Poppins, sans-serif'` — one quoted family name that matches
nothing, silently falling back to the next entry. Every template must use
`font-family: '{{templateConfig.primaryFont}}', <fallbacks>;` instead.

**The stylesheet link is `fontUrl`, rendered with a triple-stache**, because
Handlebars escapes `=` and would corrupt the query string:
```html
{{#if templateConfig.fontUrl}}<link href="{{{templateConfig.fontUrl}}}" rel="stylesheet">{{/if}}
```
`buildFontUrl` (`src/utils/fontConfig.utils.ts`) URL-encodes spaces
(`Open Sans` → `Open+Sans`), requests weights `400;500;600;700`, and returns an
empty string for families Google does not host (Graphik), so the `{{#if}}`
guard is required — a bad family name 400s the whole stylesheet request.

### Helpers
`clinicAddress address city state zipcode` (`src/utils/handlebarsHelpers.ts`)
renders the letterhead address as **street + locality/city only**. State,
postal code and country are stripped — including when they are embedded in the
free-text `address` — because a prescription is handed to a patient standing in
the clinic, so those three are noise that pushed the header to two lines.

`state`/`zipcode` are still passed so the helper can *recognise and remove*
them. Clinics routinely save a full postal address *and* populate the
city/state/zipcode columns, so the previous hand-concatenation produced a
duplicated line ("… Madhya Pradesh 452010, India, Ratna Lok Colony, Madhya
Pradesh - 452010"). Always use the helper — never hand-concatenate
`{{clinic.address}}, {{clinic.city}}…` again.

Country stripping is a small allow-list (`COUNTRY_NAMES`); add to it rather
than trying to detect countries generically.
Color roles (keep usage consistent across templates):

| Var       | Role                             |
| --------- | -------------------------------- |
| `color1`  | Primary brand / headings / rules |
| `color2`  | Light accent / soft borders      |
| `color3`  | Body text                        |
| `color4`  | Muted/secondary text             |
| `color5`  | Hairlines / dashed borders       |
| `color6`  | Alert/surgery (reserved)         |
| `color7`  | Subtle background fill           |
| `color8`  | Paper/white                      |
| `color9`  | Strong black                     |
| `color10` | Advice/highlight accent          |

### QR code (`qrCode` / `appDownloadUrl`)
`src/utils/qr.utils.ts` builds both. **The QR points at the app listing, not at
the prescription.** A printed prescription can be photographed by anyone, so
encoding a per-report link would put a document URL on paper the patient carries
around; the store listing is public by nature and the patient signs in there to
reach their own records.

`appDownloadUrl` resolves as `PRESCRIPTION_QR_URL` → the Play Store listing
(`com.infinity.medisetu`). The iOS listing is not published yet — the FE footer's
App Store link is still a placeholder — so when it exists, point
`PRESCRIPTION_QR_URL` at a "get the app" landing page offering both stores; **no
template change is needed.**

`qrCode` is that URL as a **PNG data URI**, so the PDF renderer never fetches a
remote image. It is now identical on every prescription, so it is generated once
and cached in-process (keyed by URL).

**Render it with a triple-stache — `<img src="{{{qrCode}}}">`.** Handlebars
escapes `=`, which would corrupt the base64 padding and silently produce a
broken image; this is the same trap as `templateConfig.fontUrl`. Always guard it
with `{{#if qrCode}}` — generation failures return an empty string on purpose so
a bad QR can never take down PDF generation.

### Content
```
qrCode          // PNG data URI, render with {{{ }}}, guard with {{#if}}
appDownloadUrl  // the app-listing URL encoded in the QR
clinic.{ name, tagline, address, city, state, zipcode, phone }   // logo exists in the builders but is deliberately NOT rendered
doctor.{ name, qualification, speciality, registrationNumber }
doctor.groupedAvailability[] -> { days, isAvailable, display }   // display is HTML, use {{{ }}}
patient.{ name, age, gender, address }   // address prints only when showPatientAddress is on
appointmentDate
symptoms[] -> { name }
diagnosis
hasTests        // boolean-ish; when truthy show testNames
testNames
prescriptions[] -> { medicineName, strength, dosage, frequency, duration, notes }
advice
followUpDate
```

### Bilingual printing (`i18n` and the `bi` helper)
`i18n` is the one sanctioned addition to the contract. When a regional language is
chosen, the data carries `i18n` (`{ lang, map, head }`), and translated fields print
through `{{bi value}}`, which adds the regional line under the English:
- `{{{i18n.head}}}` goes once in `<head>` (Noto font link plus `.tr` styles). It renders
  empty in English.
- **Wrap only what the patient must act on:**
  - the Timing, Dosage, Duration and Instruction **cells**. The medicine table's column
    headings (`<th>`) stay English in every template (user decision, 2026-09-11).
  - the `doseSlots` labels
  - `advice` (and its split items) and `dietarySuggestion`
  - the *Next Visit* label and the footer note
  - the disclaimer, placed before the footer:
    `{{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}`
- **Language and print style** are per doctor, set on the Translations tab and stored on the doctor's existing `doctor_preferences` row (`prescriptionLanguage`, `prescriptionPrintStyle`). Print style is:
  - `regional` (the default, and what null means) prints only the translation, inline (`.tr-only`). Text with no translation stays English and is never blank, and the English-prevails note is left out.
  - `bilingual` (the doctor ticked "Also print the English") prints English with the translation under it (`.tr`).
  - No language set means English only; translation is optional.
- **Never wrap** the medicine name, strength or composition, diagnosis, symptoms,
  vitals, tests, allergies or habits, or any name, date or number. What isn't wrapped
  is never sent to a translation provider.
- With no language set, `bi` returns the English unchanged, so English output is
  identical.
- Translation lookup order is dictionary, then the doctor's `prescription_translations`
  memory (scoped to doctor plus clinic), then the provider (`TRANSLATION_PROVIDER`). The code is in
  `src/main/reports/services/prescriptionTranslation.service.ts`.
- **Status:** all six named templates and quick print (`src/main/quick-print-templates/`: the
  static templates, `clinicalSections.ts` and the designer's `layoutRenderer.ts`) are wired.
  `pharmacy-copy.ts` stays English on purpose; it is the pharmacist's copy.
- The saved PDF uses the language picked in the workspace Preview (`printLanguage` on create/update
  report card), else the doctor's default. English picked there prints English only.
  The choice is stored on the prescription (`report_cards.print_language`), so reopening it starts
  the Preview on that language and a later re-save regenerates the PDF in it.
- Language pickers list only what can print: `GET /api/v1/reports/translations/languages` returns English
  plus every language with a dictionary, and all 22 once `TRANSLATION_PROVIDER` is on.
- Combined cells use `{{biJoin a b " - "}}` instead of `joinValues`, so each part is looked up
  in the dictionary on its own.
- Labels may end in a colon (`{{bi "Next Visit:"}}`): the lookup key ignores a trailing
  full stop or colon, so the English stays byte-for-byte as it was.

### Extra clinical fields (all templates)
**Every template renders `vitals` (+ `vitalsMoreThanOne`),
`allergies`, `habits`, `dietarySuggestion` and `visitingDays`**, because the clinical summary the
doctor fills in was otherwise dropped from the printed prescription entirely —
a record with vitals, allergies and a diet note but no diagnosis printed a page
with nothing clinical on it at all. All five are `{{#if}}`-guarded.

`visitingDays` reaches the template already formatted (`12-Sep-2026`): the calendar
stores `YYYY-MM-DD`, and both data builders in `report.service.ts` format it.

`allergies` and `habits` are Postgres **text arrays** (`text().array()`) — iterate
them with `{{#each}}`, never print them directly.

Template 5's rail is wrapped in
`{{#if (anyValue vitalsMoreThanOne symptoms diagnosis allergies habits advice dietarySuggestion additionalInformation)}}`.
The rail reserves 27% of the width, so without that guard an appointment with no
clinical notes left a blank column and squeezed the medication table. Note the
`anyValue` helper treats booleans as flags — a bare `hasValue` would see `false`
stringified as `"false"` and count it as content.

### Standard-prescription field set (scope)
Every template prints every section the doctor's toggles allow
(`prescriptionSection.service.ts`); an empty value hides its section. Two things
are printed by **no** template: the **token** (removed at the user's request,
2026-09-10 — the "Token number" toggle is currently a no-op) and, on Templates
1–5, the **clinic logo** (logos vary wildly in aspect ratio and broke header
alignment; Template 6 renders it in a fixed 54px contain box).

**One set of switches for every template.** The settings page and the workspace Preview's *What prints*
panel edit the same `prescription_templates.section_config`. Named templates use every switch; Quick Print
keeps its layout and drops only sections switched off (`applySwitchedOff`, designer blocks via
`hiddenBlockIds`, fields inside a block such as age via `hiddenSections`), even when the visit filled them in. The Preview saves through
`PUT /reports/prescription-template/sections/:doctorId` (your own, or a clinic admin's for a doctor in
their clinic), which never touches `updatedAt` — bumping it would make
the named template the active one.

**Medication table columns** are identical in all six templates and must stay in
this order: `#`, `Medication` (`medicineName` + strength/composition underneath),
`Timing` (`notes`, optional via showMedicineInstructions), `Dosage` (`frequency`),
`Duration`, `Instruction` (`dosage`). Empty cells print a muted en dash (`.nil`).
The table uses `table-layout: fixed` with a `<colgroup>` of
`6% / 30% / 14% / 13% / 13% / 24%` — the optional Timing `<col>` is **third**,
matching its `<th>`, so columns land in the same place regardless of content length. **Template 5 is the one exception** — beside its rail the table is
only ~73% of the content width, so it uses `5% / 31% / 16% / 13% / 14% / 21%` (optional Timing `<col>` third) with
9px/6px header cells; at the shared widths "FREQUENCY" and "DURATION" collided. `Dosage` / `Frequency` / `Duration` are centered (class `c` on both
`th` and `td`); `Medication` and `Instructions` stay left-aligned. Do not put a
`width` on `.med-index` — it fights the colgroup.

**Patient row** is a baseline-aligned flex row (Patient / Reg. No. / Age-Sex / Date, address on
its own line), **never a fixed-column grid** — a fourth field wrapped into a broken
second row. The name is weight 500 and `text-transform: capitalize`.
Reg. No. is the appointment's `registrationNo` — the doctor's running number, issued by
`AppointmentRegistrationService` at booking and padded to 5 digits — and prints only when set.

### Hard rules
1. `doctor.groupedAvailability[].display` is pre-formatted HTML → render with
   triple-stache `{{{this.display}}}`. Everything else uses double-stache.
2. Page is A4: `@page { size: A4; margin: 0; }` and the root wrapper is
   `width: 210mm; min-height: 297mm;`.
3. Consultation hours sit in a **bottom** strip (or the sidebar for Template 1).
4. Footer carries the "Powered by Infinity MediSetu" logo
   (`https://infninity-medisatu.s3.ap-south-1.amazonaws.com/ims/Logo%20V1.png`).
5. Every template prints a signature area only when `showDoctorSignature` is on:
   blank signing space above a rule, then `Dr.&nbsp;{{doctor.name}}` and a
   "Signature" caption, at the right end of a bottom sign-off row (QR on the left).
   Templates 1–4 put a `.push` spacer (flex: 1) before that row, so advice stays
   directly under the medicines while the sign-off sits at the page bottom.
6. **One home per field — never render the same value twice on one page.** This
   is the rule that keeps a prescription from reading like a form filled in
   twice. Each template picks exactly one place for each value:

   | Value | Template 5 | Template 6 |
   | --- | --- | --- |
   | `clinic.name` | header band | header band |
   | `clinic.phone` | header band | sign-off row ("Emergency Contact") |
   | consultation hours | bottom strip | sign-off row, under the phone |
   | `followUpDate` | sign-off row | sign-off row |

   So Template 5's sign-off row carries **no** clinic phone/name, and Template 6's
   header band carries **no** phone and the template has **no** hours strip.
   Medicine names never get `formPrefix` in Templates 5/6 either — stored names
   already end in their form, so it printed "Gel KENT GEL".

   **How to check:** render the template and count occurrences of each value in
   the HTML — every one should be exactly 1. That is a two-line assertion in the
   throwaway render script from section 5, and it catches this class of bug far
   more reliably than reading the markup.
7. No new top-level variables. No external JS. Inline/`<style>` CSS only.
8. **No filler for missing data.** A section with no value is hidden, never padded
   with "As advised" / "N/A" — filler reads as an instruction the doctor never
   gave (user feedback, 2026-09-11). Next Visit prints only when `followUpDate` is set.
9. **Header details:** `Dr.&nbsp;name` (so "Dr." never sits alone on a line) with
   `overflow-wrap: anywhere`; qualification before speciality; the clinic phone on
   its own line, never inside the 2-line address clamp (a long address clipped it).
10. **Footer note** is "Please consult your doctor if symptoms persist or worsen."
    — never "valid without signature" beside a signature area.

---

## 2. Template 1 — "Simple / Minimal"

**Concept:** the most lightweight, no-frills pad. Single column, no colored
fills or decorative fonts — just the configured font, thin hairline rules and
generous whitespace. Header is clinic (left) + doctor (right) over a single
rule; then patient line, complaints, diagnosis, ℞, a minimal medication table,
plain advice/investigations/next-visit notes, a signature, and a small
consultation-hours line at the bottom.

**Identity:** plain typography, no color blocks (color1 used only for thin rules
and the ℞ glyph), lots of whitespace, page padding ~18mm.

**Regeneration instructions**
```
Regenerate src/htmltamplates/report_card1.ts as `reportCardTemplate1`
(a single exported template literal string).

Layout: single-column .pad (210mm x min 297mm) with internal padding
18mm 18mm 12mm 20mm (tuned so a typical visit fits one A4 page) and NO colored backgrounds.
Order:
  - .head      : flex row, top-aligned. Left = clinic name (~21px bold) + tagline +
                 address (2-line clamp) + phone on its own line. Right = Dr.&nbsp;name
                 + qualification + speciality + Medical Reg. No. Bottom border 2px var(--color1).
  - .patient   : ruled "LABEL value" baseline row (see Patient row above) + address line.
  - .clinical  : plain C/O, Allergies, Habits, Vitals, Diagnosis, Notes lines.
  - .rx        : ℞ glyph ~32px then a minimal medication table — header underline
                 + row hairlines, shared column set (see Medication table columns).
  - .note      : plain Investigations, Pre-Diagnosis, Advice, Dietary Suggestion,
                 Surgery, Next Visit (only with a date), Visiting Days, Extra details.
  - .push      : flex: 1 spacer, then .sign-off = QR left, signature right.
  - .timings   : small bottom line "Consultation Hours: {{this.days}}: {{{this.display}}}".
  - .footer    : patient-safety note | IMS logo.
Use ONLY the shared data contract. Single font ('{{templateConfig.primaryFont}}');
do NOT load Playfair or Caveat. Keep it visually minimal — this is the plain option.
```

---

## 3. Template 2 — "Letterhead Pad"

**Concept:** formal, traditional single column. Top letterhead splits doctor
(left) and clinic (right) under a `color1` accent bar and rule. Body flows
straight down: patient line with dotted fill-in underlines, complaints,
diagnosis, ℞, medication table, investigations, advice, next-visit, signature.
Consultation hours sit in a bottom strip above the footer.

**Identity:** white paper, 8px `color1` top border, Playfair Display headings,
dotted "fill-in-the-blank" patient underlines.

**Regeneration instructions**
```
Regenerate src/htmltamplates/report_card2.ts as `reportCardTemplate2`
(a single exported template literal string).

Layout: flex column .pad (210mm x min 297mm), border-top 8px var(--color1).
Order:
  - .letterhead : flex row, top-aligned. Left .doctor-block = Dr.&nbsp;name (Playfair,
                  color1) + qualification + speciality + Reg. No. Right .clinic-block
                  (text-align right) = clinic name + tagline + address (2-line clamp)
                  + phone on its own line. Bottom border 2px color1.
  - .patient-row: flex-wrap baseline row; each value has a dotted bottom border
                  (fill-in-the-blank look): Patient (grows), Age/Sex, Date, then
                  Address as a full-width field.
  - .clinical   : C/O, Allergies, Habits, Vitals, Diagnosis, Notes lines.
  - .rx-body    : big ℞ glyph then the medication table (shared column set).
  - .advice-section blocks: Investigations, Pre-Diagnosis, Advice, Diet, Surgery,
                  Next Visit (only with a date), Visiting Days, Extra details.
  - .push + .sign-off : QR left, signature right, at the page bottom.
  - .timings    : BOTTOM strip (border-top), label "Consultation Hours" + each
                  available {{this.days}}: {{{this.display}}}.
  - .footer     : patient-safety note | IMS logo (no clinic name — the letterhead has it).
Use ONLY the shared data contract. Fonts: '{{templateConfig.primaryFont}}' + Playfair Display.
```

---

## 4. Template 3 — "Handwritten Pad"

**Concept:** single column on **cream** paper (`#fffef7`). Static labels use a
clean sans (Inter); every dynamic value (patient details, complaints, medicines,
advice) uses the **Caveat** handwriting font to feel hand-written. Patient details
sit in a rounded cream card; advice blocks use a warm highlight.

**Identity:** cream paper, Inter labels + Caveat values, warm `#faf6ed`/`#fef6e7`
fills, dotted medicine separators.

**Regeneration instructions**
```
Regenerate src/htmltamplates/report_card3.ts as `reportCardTemplate3`
(a single exported template literal string).

Load Google Fonts: Inter (labels) + Caveat (handwriting values).
Layout: flex column .pad (210mm x min 297mm), background #fffef7,
border-top 8px var(--color1).
Order:
  - .letterhead : same split as Template 2 (doctor left, clinic right, top-aligned,
                  Dr.&nbsp;name, phone outside the address clamp) but Inter 800
                  headings, bottom border 2px var(--color2).
  - .patient-row: rounded cream card (#fefbf5 / #e9e0cf) holding a flex-wrap
                  baseline row. Labels uppercase Inter; values in Caveat ~19px
                  (name ~21px, capitalized). Patient, Age/Sex, Date, full-width Address.
                  Values wrap, never overflow:hidden (it clips Caveat descenders).
                  The cream card is this layout's paper identity — keep it.
  - .clinical   : info-rows C/O, Allergies, Habits, Vitals, Diagnosis, Notes; label Inter, value Caveat.
  - .rx-body    : ℞ glyph ~46px, then medication table. Table CELL text is
                  Caveat ~18px; medicine strength/composition drop back to small Inter.
  - advice blocks: warm #fef6e7 boxes, label Inter uppercase, text Caveat.
                  Then Next Visit (only with a date) and Visiting Days info-rows.
  - .push + .sign-off : QR left, signature right, at the page bottom.
  - .timings    : BOTTOM strip on #faf6ed, "Consultation Hours".
  - .footer     : dashed top border, patient-safety note | IMS logo.
Use ONLY the shared data contract. Do NOT use Playfair here (Caveat is the signature font).
```

---

## 4b. Template 4 — "Modern Banner"

**Concept:** single column with a bold full-width colored header band. The band
(`color1`, white text) carries the clinic on the left (name + tagline +
address/phone) and the doctor on the right. The body is clean white: a ruled
patient line, ℞, a medication table whose header row is `color1` with zebra-striped
body rows, advice, signature, and a bottom consultation-hours strip.

**Identity:** full-width color band header + colored table header row; Playfair
Display headings; otherwise clean white body. No sidebar.

**Regeneration instructions**
```
Regenerate src/htmltamplates/report_card4.ts as `reportCardTemplate4`
(a single exported template literal string).

Layout: flex column .pad (210mm x min 297mm).
Order:
  - .banner   : full-width band, background var(--color1), color var(--color8),
                padding 20px 36px (= body padding, so left edges line up), flex row,
                top-aligned. Left = clinic name (Playfair) + tagline + address
                (2-line clamp) + phone on its own line. Right (align-self stretch,
                hairline divider) = Dr.&nbsp;name (Playfair) + qualification +
                speciality + Reg. No.
  - .body     : padding 22px 36px, flex column. Order:
                ruled patient line (no card) -> C/O, Allergies, Habits, Vitals,
                Diagnosis, Notes -> ℞ glyph -> medication table with COLORED header
                row (thead color1, white text, "#" in white, even rows color7) ->
                Investigations / Pre-Diagnosis / Advice / Diet / Surgery as plain
                sections with a 2px color10 left rule (no fill) -> Next Visit (only
                with a date) -> Visiting Days -> .push -> sign-off (QR left, signature right).
  - .timings  : BOTTOM strip (color7, border-top), "Consultation Hours".
  - .footer   : color1 band, patient-safety note | IMS logo.
Use ONLY the shared data contract. Fonts: '{{templateConfig.fontFamily}}' + Playfair Display.
Do NOT use a colored sidebar — the band header is what makes this distinct.
```

---

## 4c. Template 5 — "Clinical Rail"

**Concept:** a solid `color1` header band carries the clinic on the left (name,
tagline, icon-prefixed address + phone) and the doctor on the right, split by a
translucent hairline rule, with Reg. No. in its own bordered line. Below it a
plain ruled **patient line** (Patient / Age-Sex / Date, address below). Then a
"℞ PRESCRIPTION" heading and a body split into a narrow **left rail** of
findings and the medication table. A plain sign-off row carries Next Visit, the
optional QR and the optional signature, above the consultation-hours strip and
the `color1` footer. Next Visit lives only in the sign-off row.

**Identity:** band header + a findings rail beside the table, styled for print:
**plain sections split by hairlines, never boxed/filled cards** — the boxed
version read as an app screen, not a prescription (user feedback, 2026-09-10).
Icons are inline stroked SVG (`currentColor`) — no external images beyond the
IMS footer logo.

**Regeneration instructions**
```
Regenerate src/htmltamplates/report_card5.ts as `reportCardTemplate5`
(a single exported template literal string).

Layout: flex column .pad (210mm x min 297mm).
Order:
  - .band      : full-width var(--color1) band, white text, flex row, top-aligned,
                 side padding = the body's 32px so every left edge lines up.
                 Left = clinic name (Playfair 25px) + tagline + icon rows for
                 address (clinicAddress helper, 2-line clamp) and phone.
                 Right (align-self stretch, so its hairline divider spans the
                 band) = "Dr.&nbsp;name" (Playfair, overflow-wrap anywhere) +
                 qualification + speciality + .doctor-reg (shield + Reg. No.).
  - .patient   : no box, no icons, 1px color5 bottom rule. One baseline-aligned
                 row of inline "LABEL value" pairs: Patient (grows, 14px, weight
                 500, capitalized) / Reg. No. / Age-Sex / Date — no token. Values single-line
                 with ellipsis. Address, when shown, on its own line below,
                 clamped to 2 lines. NEVER a fixed-column grid — 5 fields in 3
                 columns wrapped into a broken second row. Letterhead mode reuses
                 it for "Prescribed by". NO Next Visit here (sign-off row only).
  - .rx-head   : Rx glyph SVG (30px) + "PRESCRIPTION" with a 2px color1 underline.
  - .body      : flex row. .rail (26%, right hairline, wrapped in
                 {{#if (anyValue ...)}} so it collapses when empty) = unboxed
                 .rail-sec sections split by dashed hairlines, in clinical order:
                 Vitals (2-col label/value grid), Complaints, Allergies [color6
                 title + warning icon], Diagnosis, Pre-Diagnosis, Notes, Habits,
                 Extra Diagnosis Details, Advice, Diet, Surgery Suggested,
                 Visiting Days (showVisitingDays, bullet list of dates).
                 .main = medication table: color7 thead with color1 text and a
                 1.5px color1 bottom rule, hairline rows, no outer box. Columns
                 #, Medicine, Timing (notes, optional), Dosage (frequency),
                 Duration, Instruction (dosage); colgroup 5/31/16/13/14/21 with
                 the optional Timing <col> third. Empty cells print a muted en dash.
                 Then Investigations (2px color1 left rule).
  - .sign-off  : no box, no border. Left = Next Visit (only with a date) + QR (56px
                 <img src="{{{qrCode}}}">). Right = signature when
                 showDoctorSignature: 40px blank space, rule, Dr. name, "Signature".
                 NO clinic phone/name (the band has them).
  - .timings   : BOTTOM strip (color7), "Consultation Hours".
  - .footer    : color1 band, clinic name | patient-safety note | IMS logo.
Use ONLY the shared data contract. Fonts: '{{templateConfig.primaryFont}}' + Playfair Display.
Keep the rail — it is what separates this from Template 4.
```

---

## 4d. Template 6 — "Clinical Card" (also the default)

**Concept:** solid `color1` header band (optional clinic logo + name + tagline +
icon address on the left, doctor credentials right of a hairline rule), a plain
ruled **patient line** (Patient / Age-Sex / Date, address below), a full-width
ruled **vitals line**, then a body split into a narrow left **rail** (Diagnosis
and Complaints as bullet lists, Advice as a check list, plus Allergies / Habits /
Diet / Additional Information) and the medication table. A plain **sign-off row**
carries Next Visit + Emergency Contact + the optional QR and signature, above the
`color1` footer.

**Identity:** solid band header, filled square row-index badges, and a frequency
column broken into labelled Morning / Afternoon / Night dose rows with sun/moon
icons — that last one is what visually separates it from every other template.
It also ships its own **navy** starting palette (see below). Styled for print
like Template 5: **hairlines and plain sections, never boxed/filled cards**
(user feedback, 2026-09-10).

**Hard content rules for this template**
- **Habits print only when `showHabits` is on.** This line used to say "never
  printed", but the rail has been wired to the toggle — the toggle is the truth.
- **No `formPrefix` on the medicine name.** Stored names already carry their form
  ("KENT GEL", "YORICOLD SYRUP"), so prefixing printed "GEL KENT GEL".
- **No consultation-hours strip and no phone in the header band.** Both already
  appear in the sign-off row under Emergency Contact — see the one-home-per-field
  rule in the hard rules above.
- Next Visit appears once (sign-off row). Signature only when `showDoctorSignature` is on.
- **It must fit ONE A4 page with six medicines.** The compact paddings/font sizes
  are load-bearing — re-measure `.pad` height (must stay ≤ 1123px at 96dpi) after
  any spacing change.

**Regeneration instructions**
```
Regenerate src/htmltamplates/report_card6.ts as `reportCardTemplate6`
(a single exported template literal string).

Layout: flex column .pad (210mm x min 297mm).
Order:
  - .band        : full-width var(--color1) band, white text, top-aligned, side
                   padding = the body's 24px so every left edge lines up. Left =
                   optional {{#if clinic.logo}} 54px contain logo + clinic name
                   (Playfair 26px) + tagline + icon row for address
                   (clinicAddress helper, 2-line clamp). NO phone. Right
                   (align-self stretch, so its divider spans the band) =
                   "Dr.&nbsp;name" (Playfair, overflow-wrap anywhere) +
                   qualification + speciality + .doctor-reg (shield + Reg. No.).
  - .patient     : same as Template 5 — no box, no icons, 1px color5 bottom
                   rule, baseline-aligned "LABEL value" row: Patient (grows,
                   14px, weight 500, capitalized) / Reg. No. / Age-Sex / Date — no token.
                   Address on its own line, clamped to 2 lines. Letterhead mode
                   reuses it for "Prescribed by". NO Next Visit here.
  - .vitals-line : full-width, no fill, 1px color5 bottom rule. Grid `auto 1fr`:
                   "VITALS" title, then a .vitals-grid (auto-fit, minmax 92px)
                   of label-over-value cells split by hairlines, unit inline and
                   muted, so 6+ readings wrap under the readings, not under the
                   title. Guarded by {{#if vitalsMoreThanOne}}.
  - .body        : flex row, align-items flex-start.
                   .rail (23%, right hairline, wrapped in {{#if (anyValue ...)}}
                   so it collapses when empty) = unboxed .rail-block sections
                   split by dashed hairlines, in clinical order: Complaints,
                   Allergies [color6 + warning icon], Diagnosis (.dot-list over
                   `split diagnosis ","`), Pre-Diagnosis, Notes, Habits, Extra
                   Diagnosis Details, Advice (.check-list over `split advice ","`),
                   Diet, Surgery Suggested, Visiting Days (showVisitingDays,
                   .dot-list of dates).
                   .main: Rx glyph + "PRESCRIPTION" heading, then the medication
                   table, then Investigations (2px color1 left rule).
  - med table    : no outer box. color7 thead with color1 text and a 1.5px color1
                   bottom rule, hairline rows. Columns #, Medicine, Timing (notes,
                   optional), Dosage (frequency), Duration, Instruction (dosage);
                   colgroup 7/29/14/20/15/15 with the optional Timing <col> third.
                   # is a filled 18px square badge. Dosage uses
                   {{#if (doseSlots this.frequency)}} to print labelled
                   Morning/Afternoon/Night rows (sun icon, moon when
                   this.isNight), falling back to the raw frequency text. Other
                   cells are plain text; empty ones print a muted en dash.
  - .sign-off    : no box, no border. Left = hairline-split items: Next Visit (only with a date),
                   Emergency Contact (phone + first available day/hours line),
                   QR (56px <img src="{{{qrCode}}}">). Right = signature when
                   showDoctorSignature: 38px blank space, rule, Dr. name, "Signature".
  - .footer      : color1 band, shield + safety note | "Powered by" IMS logo.
                   NO clinic name (the band already carries it).
Use ONLY the shared data contract. Fonts: '{{templateConfig.primaryFont}}' + Playfair Display.
Keep it to one A4 page with six medicines.
```

**Starting palette.** `templateDefaultColors` in the FE
`prescription-templates/helpers/designerOptions.ts` gives `template6` a navy
default (`color1 #1E3A5F`, `color2 #EFF4FA`, `color10 #0F5C8C` — the existing
"Navy" preset, so contrast is already validated). It is applied on template
switch **only while the doctor's palette is still an untouched default**
(`isUntouchedPalette`), so choosing a layout can never discard custom colours.
Add an entry to that map to give any other template its own starting palette.

---

## 5. Verifying a regenerated template

After editing any template:

1. **Type/lint check**
   ```
   npx tsc --noEmit -p tsconfig.json
   npx eslint src/htmltamplates/report_cardN.ts
   ```
2. **Handlebars render check** — compile the exported string with the shared
   sample data and assert there are **no leftover `{{ }}` tags** and no compile
   error. (A throwaway Node script that reads the exported string and runs
   `handlebars.compile(str)(sampleData)` is sufficient.)
3. **Visual check** — call
   `POST /api/v1/reports/preview-prescription-template`
   with `{ "templateName": "templateN", "colors": {...color1..10}, "fontFamily": "Inter, sans-serif" }`
   and open the returned `html`. The preview uses the same Handlebars engine as
   real PDF output, so it is pixel-faithful.

## 6. Adding a brand-new template

1. Create `src/htmltamplates/report_cardN.ts` exporting `reportCardTemplateN`.
2. Follow the **shared data contract** above (no new variables).
3. Import it in `report.service.ts` and `report.controller.ts`, and add a
   `case 'templateN':` to the service `switch`.
4. Document its concept + regeneration instructions in this file.
5. Run the verification steps in section 5.
