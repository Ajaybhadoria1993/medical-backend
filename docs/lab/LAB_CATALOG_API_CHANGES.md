# Lab Catalog API Changes — Frontend Integration Guide

What changed in the lab test catalog APIs (tests, parameters, suggestions),
exactly which fields are optional, and what each endpoint now returns.
Base path: `/api/v1/lab/...`. All endpoints below require the existing
auth headers (`Authorization: Bearer <token>`) and a lab/clinic context —
nothing changed there.

> **Not live yet.** The database migration for these columns hasn't been run.
> Treat every shape below as the target contract to build against; it will
> 500 until the backend confirms the migration is applied.

---

## 1. `POST /lab-tests` — create a test

### Request body

| Field | Type | Required? |
|---|---|---|
| `testName` | string (1–255) | **required** |
| `testCode` | string (2–100) | **required** — uppercased, spaces→`_` server-side |
| `departmentCode` | string (2–80) | **required** — uppercased, spaces→`_` server-side |
| `sampleType` | string (1–100) | **required** |
| `price` | integer ≥ 0 | **required** |
| `status` | `"active"` \| `"inactive"` | optional, default `"active"` |
| `comments` | string ≤ 20000, nullable | optional |
| `interpretation` | string ≤ 20000, nullable | optional |
| `notes` | string ≤ 20000, nullable | optional |
| `shortName` | string ≤ 100, nullable | optional |
| `loincCode` | string ≤ 30, nullable | optional |
| `container` | string ≤ 100, nullable | optional |
| `sampleVolume` | string ≤ 100, nullable | optional — free text, e.g. `"2 mL"` |
| `stability` | string ≤ 2000, nullable | optional |
| `storage` | string ≤ 2000, nullable | optional |
| `method` | string ≤ 2000, nullable | optional |
| `technology` | string ≤ 150, nullable | optional |
| `testType` | string ≤ 50, nullable | optional — e.g. `"Profile"`, `"Single Test"`, `"Microscopy"` |
| `turnaroundTimeHours` | integer ≥ 0, nullable | optional — **hours**, not minutes |
| `clinicalSignificance` | string ≤ 20000, nullable | optional |
| `limitations` | string ≤ 20000, nullable | optional |
| `advice` | string ≤ 20000, nullable | optional |
| `testDisclaimer` | string ≤ 20000, nullable | optional |
| `whenResultHigh` | string ≤ 20000, nullable | optional |
| `whenResultLow` | string ≤ 20000, nullable | optional |
| `whenResultCritical` | string ≤ 20000, nullable | optional |
| `groupId` | uuid, nullable | optional — must already exist (see §5) |
| `aliases` | string[] (each 1–255, max 20 items) | optional |
| `parameters` | array (max 100) | optional, default `[]` — shape below |

**`parameters[]` item:**

| Field | Type | Required? |
|---|---|---|
| `parameterName` | string (1–255) | **required** |
| `inputType` | `"text"` \| `"number"` \| `"textarea"` \| `"select"` \| `"date"` \| `"boolean"` | optional, default `"text"` |
| `code` | string ≤ 50, nullable | optional — short code, e.g. `"HB"` |
| `unit` | string ≤ 80, nullable | optional |
| `unitless` | boolean | optional, default `false` |
| `decimals` | integer 0–6 | optional, default `1` |
| `section` | string ≤ 150, nullable | optional — report sub-heading, e.g. `"RBC indices"` |
| `formula` | string ≤ 500, nullable | optional — free text, e.g. `"HCT / RBC × 10"`; display only, not evaluated server-side |
| `isRequired` | boolean | optional, default `false` |
| `isActive` | boolean | optional, default `true` |
| `referenceRange` | string ≤ 255, nullable | optional — free-text display string |
| `referenceGender` | `"All"` \| `"Male"` \| `"Female"` | optional, no default — see §4 |
| `ranges` | array (max 50) | optional — only meaningful when `inputType: "number"`, see §4 |
| `options` | array (max 50) | optional — only meaningful when `inputType: "select"` |

**`ranges[]` item** (only used when `inputType: "number"`):

| Field | Type | Required? |
|---|---|---|
| `gender` | `"All"` \| `"Male"` \| `"Female"` | optional, default `"All"` |
| `type` | `"range"` \| `"lt"` \| `"gt"` \| `"band"` | optional, default `"range"` |
| `lowRange` | number, nullable | optional — set for `"range"`/`"gt"`; leave null for `"lt"` |
| `highRange` | number, nullable | optional — set for `"range"`/`"lt"`; leave null for `"gt"` |
| `ageFromYears` | number 0–150, nullable | optional |
| `ageToYears` | number 0–150, nullable | optional |
| `condition` | string ≤ 100, nullable | optional — e.g. `"Fasting"`, `"Pregnancy – 2nd trimester"` |
| `label` | string ≤ 100, nullable | optional — caption for `"band"` type, e.g. `"Borderline high"` |

**`options[]` item** (only used when `inputType: "select"`):

| Field | Type | Required? |
|---|---|---|
| `optionValue` | string (1–100) | **required** — e.g. `"Not seen"`, `"Positive"` |
| `isNormal` | boolean | optional, default `false` |

### Example

```json
{
  "testName": "Complete Blood Count",
  "testCode": "CBC",
  "departmentCode": "HEMATOLOGY",
  "sampleType": "Blood",
  "price": 350,
  "shortName": "CBC",
  "testType": "Profile",
  "groupId": "b2e1f1a0-....",
  "aliases": ["Hemogram", "FBC"],
  "parameters": [
    {
      "parameterName": "Haemoglobin",
      "code": "HB",
      "inputType": "number",
      "unit": "g/dL",
      "decimals": 1,
      "ranges": [
        { "gender": "Male", "type": "range", "lowRange": 13.0, "highRange": 17.0 },
        { "gender": "Female", "type": "range", "lowRange": 12.0, "highRange": 15.5 }
      ]
    },
    {
      "parameterName": "Haemoparasites",
      "inputType": "select",
      "options": [
        { "optionValue": "Not seen", "isNormal": true },
        { "optionValue": "Seen", "isNormal": false }
      ]
    }
  ]
}
```

### Response — full test detail (see §3 for the complete shape)

---

## 2. `PUT /lab-tests/:testId` — update a test

Same body as create, but:
- **every field is optional** — send only what changed. At least one field required.
- `departmentId` (uuid) instead of `departmentCode`.
- No `price`/`sampleType`/etc. required — this is a partial update.
- Sending `parameters: [...]` **fully replaces** the test's parameter list (delete + recreate). Omit it to leave parameters untouched.
- Sending `aliases: [...]` fully replaces aliases; omit to leave untouched; send `[]` to clear.
- `groupId: null` clears the group.
- `version` is **not** a request field — it auto-increments server-side on every successful call (see §3).

### Response — full test detail (§3)

---

## 3. `GET /lab-tests/:testId` — test detail (also the response shape for create/update)

```jsonc
{
  "id": "uuid",
  "labId": "uuid",
  "testName": "Complete Blood Count",
  "shortName": "CBC",
  "loincCode": "58410-2",
  "comments": null,
  "interpretation": null,
  "notes": null,
  "testCode": "CBC",
  "sampleType": "Blood",
  "container": "EDTA (lavender top)",
  "sampleVolume": "2 mL",
  "stability": null,
  "storage": null,
  "method": null,
  "technology": null,
  "testType": "Profile",
  "turnaroundTimeHours": 6,
  "clinicalSignificance": null,
  "limitations": null,
  "advice": null,
  "testDisclaimer": null,
  "whenResultHigh": null,
  "whenResultLow": null,
  "whenResultCritical": null,
  "price": 350,
  "departmentId": "uuid",
  "departmentName": "Hematology",
  "departmentCode": "HEMATOLOGY",
  "groupId": "uuid | null",
  "version": 0,
  "status": "active",
  "createdAt": "2026-...",
  "updatedAt": "2026-...",
  "isCustom": false,
  "aliases": ["Hemogram", "FBC"],
  "parameters": [
    {
      "id": "uuid",
      "testId": "uuid",
      "parameterName": "Haemoglobin",
      "code": "HB",
      "inputType": "number",
      "unit": "g/dL",
      "unitless": false,
      "decimals": 1,
      "section": null,
      "formula": null,
      "referenceRange": "Male: 13.0–17.0; Female: 12.0–15.5",
      "isRequired": false,
      "isActive": true,
      "createdAt": "2026-...",
      "updatedAt": "2026-...",
      "isCustom": false,
      "ranges": [
        { "id": "uuid", "parameterId": "uuid", "gender": "Male", "type": "range", "lowRange": 13, "highRange": 17, "ageFromYears": null, "ageToYears": null, "condition": null, "label": null, "createdAt": "...", "updatedAt": "..." },
        { "id": "uuid", "parameterId": "uuid", "gender": "Female", "type": "range", "lowRange": 12, "highRange": 15.5, "ageFromYears": null, "ageToYears": null, "condition": null, "label": null, "createdAt": "...", "updatedAt": "..." }
      ]
    },
    {
      "id": "uuid",
      "parameterName": "Haemoparasites",
      "inputType": "select",
      "isCustom": false,
      "options": [
        { "id": "uuid", "parameterId": "uuid", "optionValue": "Not seen", "isNormal": true, "createdAt": "..." },
        { "id": "uuid", "parameterId": "uuid", "optionValue": "Seen", "isNormal": false, "createdAt": "..." }
      ]
    }
  ]
}
```

Notes for rendering this:
- A parameter has **either** `ranges` **or** `options`, never both, and only when `inputType` is `"number"` or `"select"` respectively. A `"text"`/`"textarea"`/`"date"`/`"boolean"` parameter has neither key at all.
- `ranges[].lowRange` / `highRange` / `ageFromYears` / `ageToYears` are numbers (not strings) in the response.
- `isCustom` appears on the test itself and on every parameter independently — a lab can add a custom field to an otherwise system (library) test; that field alone shows `isCustom: true`.

### `GET /lab-tests` — list (lighter shape, paginated)

Same auth/filters as before (`page`, `limit`, `search`, `status`, `departmentId`). Each row now includes:

```jsonc
{
  "id": "uuid", "labId": "uuid", "testName": "...", "shortName": "...",
  "comments": null, "interpretation": null, "notes": null,
  "testCode": "CBC", "sampleType": "Blood",
  "testType": "Profile", "turnaroundTimeHours": 6,
  "price": 350, "departmentId": "uuid", "departmentName": "Hematology",
  "departmentCode": "HEMATOLOGY", "groupId": "uuid | null",
  "version": 0, "status": "active", "createdAt": "...", "updatedAt": "...",
  "isCustom": false
}
```

**The list does NOT include** `aliases`, `parameters`, or the long clinical-text fields (`clinicalSignificance`, `limitations`, `advice`, `testDisclaimer`, `whenResultHigh/Low/Critical`, `stability`, `storage`, `method`, `technology`, `container`, `sampleVolume`, `loincCode`) — fetch `GET /lab-tests/:testId` for those.

---

## 4. Two ways to send a reference range

Pick whichever is easier for your form:

**A — structured, explicit** (recommended for a form with a ranges table UI):
```json
{ "parameterName": "Haemoglobin", "inputType": "number",
  "ranges": [{ "gender": "Male", "type": "range", "lowRange": 13, "highRange": 17 }] }
```

**B — flat, one row per gender with text** (matches a spreadsheet-style import — the server parses and merges it):
```json
[
  { "parameterName": "Haemoglobin", "inputType": "number", "unit": "g/dL", "referenceRange": "13.0–17.0", "referenceGender": "Male" },
  { "parameterName": "Haemoglobin", "inputType": "number", "unit": "g/dL", "referenceRange": "12.0–15.5", "referenceGender": "Female" }
]
```
Both rows must use the same `parameterName` (case/whitespace-insensitive) — the server merges them into **one** parameter with two gender-specific ranges, and combines the text into `"Male: 13.0–17.0; Female: 12.0–15.5"`.

Rules:
- The same `referenceGender` sent twice for one parameter → **400 error**, not a silent overwrite.
- If `ranges` is sent explicitly, it's used as-is — the server never re-derives from text when you already gave it structured data.
- If only `referenceRange` text is sent and it's a clean pattern (`"13–17"`, `"<5"`, `">40"`), the server derives `ranges` from it automatically.
- If the text is hedged or non-numeric (`"Use laboratory interval"`, `"< 1:80"`), nothing is derived — it's stored as display text only, with no `ranges`.
- On **update**, sending a new `referenceRange` without `ranges` re-derives the ranges from it (if parseable); sending neither leaves existing ranges untouched.

---

## 5. `POST /lab-tests` groups — one gap today

`groupId` must reference an **existing** `lab_updated_test_groups` row — there is currently **no API to create or list groups directly**. The only way a group gets created today is through `POST /lab-updated/suggestions` with `groupName` (a plain string — see §7), which auto-creates the group by name if it doesn't exist.

**If you need a "pick or create a group" dropdown in a test form, flag this to backend first** — a `labTestGroups` CRUD endpoint isn't built yet.

---

## 6. `POST` / `PUT /lab-test-result-parameters` — standalone parameter endpoints

Same field table as the `parameters[]` item in §1, plus `testId` (uuid, **required** on create only — not sendable on update).

- `POST /lab-test-result-parameters` body: `{ testId, parameterName, ... }` (all other fields per §1's parameter table).
- `PUT /lab-test-result-parameters/:parameterId` body: same minus `testId`, **every field optional**, at least one required.

### ⚠️ Response does NOT include `ranges`/`options`

Unlike the test-detail response (§3), `createParameter`/`updateParameter` return just the parameter row + `isCustom` — **no `ranges` or `options` key**, even if you just sent them:

```jsonc
{
  "id": "uuid", "testId": "uuid", "parameterName": "Haemoglobin",
  "code": "HB", "inputType": "number", "unit": "g/dL", "unitless": false,
  "decimals": 1, "section": null, "formula": null,
  "referenceRange": "13.0–17.0", "isRequired": false, "isActive": true,
  "createdAt": "...", "updatedAt": "...",
  "isCustom": false
}
```

**If your UI needs to show the saved ranges/options right after a create/update call, re-fetch `GET /lab-test-result-parameters/test/:testId`** (see below) — that one returns the full shape with `ranges`/`options` attached, same as the test-detail parameters array.

### `GET /lab-test-result-parameters` — all parameters for the lab (flat list)

```jsonc
{
  "id": "uuid", "testId": "uuid", "testName": "CBC", "testCode": "CBC",
  "departmentCode": "HEMATOLOGY", "departmentName": "Hematology",
  "parameterName": "Haemoglobin", "code": "HB", "inputType": "number",
  "unit": "g/dL", "unitless": false, "decimals": 1, "section": null, "formula": null,
  "referenceRange": "13.0–17.0", "isRequired": false, "isActive": true,
  "createdAt": "...", "updatedAt": "...", "isCustom": false
}
```
Also no `ranges`/`options` here — this is a lightweight overview table, not a detail view.

### `GET /lab-test-result-parameters/test/:testId` — one test's parameters, full detail

Returns the same `parameters[]` array as `GET /lab-tests/:testId` (§3) — **this one has `ranges`/`options`**.

---

## 7. `POST /lab-updated/suggestions` — bulk apply from the default library or custom tests

### Request body

| Field | Type | Required? |
|---|---|---|
| `departmentCodes` | string[] | optional — pulls whole departments straight from the built-in library |
| `testCodes` | string[] | optional — pulls individual tests from the library |
| `testPrices` | `{ [testCode: string]: number }` | optional — override price for library tests pulled above |
| `departments` | array (same shape as `POST /lab-department`) | optional — custom departments |
| `tests` | array | optional — custom tests, shape below |

At least one of the five fields must be present.

**`tests[]` item** — same as §1's test body, **plus**:

| Field | Type | Required? |
|---|---|---|
| `departmentId` | uuid | required **unless** `departmentCode` given |
| `departmentCode` | string | required **unless** `departmentId` given |
| `groupName` | string (1–255) | optional — **suggestions-only.** Auto-creates or matches a group by name (unlike the direct test API, which only takes an existing `groupId`) |
| all §1 fields (`shortName`, `aliases`, `groupId`, `parameters[]` with `ranges`/`options`, etc.) | — | all optional, same rules as §1 |

Use `groupName` **or** `groupId`, not both — `groupName` is for when the group may not exist yet.

### ⚠️ Full resync, not additive

Anything **not** referenced by `departmentCodes`/`testCodes`/`departments`/`tests` in a given call gets marked `inactive` for that lab. This call represents the lab's *complete* desired catalog state each time, not an incremental add.

### Response

```jsonc
{
  "departments": [ /* upserted lab_updated_department rows */ ],
  "tests": [ /* upserted lab_updated_tests rows, same shape as §3's test fields (no aliases/parameters nested here) */ ]
}
```

### `GET /lab-updated/suggestions` — preview (unchanged behavior, one addition)

Still diffs the default library against what the lab already has. Library items now explicitly carry `isCustom: false` (previously the key was just missing on library rows). **Not yet updated** to show `groupName`/`aliases`/`ranges`/`options` in the preview diff — only the pre-existing fields.

---

## Summary of breaking/behavioral changes to watch for

1. **Field renamed:** was briefly called `testCategory` during development — the shipped field is `testType`. If any screen or mock was built against `testCategory`, it needs updating; sending `testCategory` is accepted but silently ignored (Zod strips unknown keys), so `testType` will save as `null`.
2. **`isCustom`** now appears on every test and parameter in every response (list, detail, create, update) — not stored, computed per-request by matching against the default library by code/name. A lab's own test that happens to reuse a library code or name will show as `isCustom: false` (known limitation, not a bug).
3. **`version`** on tests is an edit counter (starts at 0), not a version you set — ignore it in request bodies, read it from responses if you want to show "edited N times."
4. **Parameter create/update responses don't include `ranges`/`options`** — re-fetch the test or `test/:testId` parameters endpoint if you need to display them immediately after saving.
5. **`PUT` endpoints fully replace `parameters[]` and `aliases[]`** when those keys are present at all — there's no partial/merge semantics for those two array fields. Omit the key entirely to leave it untouched.
