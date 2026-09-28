# Mobile: file URLs are becoming temporary

Written 2026-09-24 for the mobile app team. Backend side is built; nothing has
been switched on in production yet. Updated 2026-09-25: added
[Saving a document](#saving-a-document-to-the-device) (`/files/download`), and
the patient path now covers lab reports, consent and family members.

## What is changing

Today every file the API returns — clinic logos, patient photos,
prescriptions, lab reports — is a permanent public web address. Anyone with
the link can open it forever, with no login.

We are moving new uploads into a private storage bucket. From then on a file
URL only works for a limited time and only if the server issued it.

**Files uploaded before the switch keep working exactly as they do now.** They
stay public and permanent. Nothing already on a user's device breaks. This
change only affects files uploaded after the cutover.

## What you need to do

Two categories, and only one of them needs work.

### 1. Images — no change needed

Clinic logos, profile pictures, banners, gallery images.

The server signs these automatically inside every API response, valid for
**12 hours**. You use them exactly as today: take the URL out of the response
and load it.

One rule: **do not persist these URLs**. If you cache an API response to disk
and re-read it two days later, the image will 404. Cache the *data*, refetch
the URL.

### 2. Documents — must be fetched on demand

Prescriptions, lab reports, consent forms, scanned prescriptions, pharmacy
invoices.

These are **not** signed in API responses. The value you get back is a
reference, not something you can open. Opening it directly returns:

```xml
<Error><Code>AccessDenied</Code>...</Error>
```

To open one, call the signing endpoint at the moment the user taps, then open
what it returns.

## The endpoint

```
GET /api/v1/files/sign?type=<type>&id=<uuid>
Authorization: Bearer <token>
```

Response:

```json
{
  "success": true,
  "message": "Signed URL generated",
  "data": {
    "url": "https://infinity-medisetu-private.s3.ap-south-1.amazonaws.com/...&X-Amz-Signature=...",
    "expiresIn": 300
  }
}
```

`expiresIn` is seconds. Currently **300 (5 minutes)**.

### Types and which id to send

| `type` | `id` is | Used for |
|---|---|---|
| `labReport` | lab order / appointment test id | Lab report PDF |
| `prescription` | report card id | Prescription PDF |
| `appointmentPrescription` | appointment id | Prescription history rows, which are keyed by appointment |
| `manualPrescription` | appointment id | Doctor's scanned prescription image |
| `consent` | appointment id | Signed consent form |
| `stockInvoice` | pharmacy stock id | Supplier invoice (pharmacy screens) |

Send the wrong id shape and you get a 404, not a helpful error — see below.

### Patient-facing screens use a different path

```
GET /api/v1/files/sign/patient?type=<type>&id=<uuid>
Authorization: Bearer <patient token>
```

A patient is not assigned to a clinic, so the clinic endpoint rejects them
with 403. The patient path signs documents belonging to **the patient or a
family member they manage**, the same people the `/patient/*` lists return.
Anything else is a 404. The response is the same as the clinic endpoint's.

| `type` | `id` is | Take it from |
|---|---|---|
| `labReport` | lab order id | `GET /patient/lab-reports`: item `id`. `associated-documents` `lab_report`: `id` |
| `appointmentPrescription` | appointment id | `GET /patient/prescriptions`: item `appointmentId` |
| `prescription` | report card id | `associated-documents` `digital_prescription`: `id` |
| `manualPrescription` | appointment id | `associated-documents` `manual_prescription`: **`appointmentId`, not `id`** |
| `consent` | appointment id | `associated-documents` `consent_file`: **`appointmentId`, not `id`** |

- **Prescription rows:** use `appointmentPrescription`. It opens the digital
  PDF, or the doctor's scan when there is no digital one. `prescription` only
  works when a report card exists.
- **Gallery (`gallery`)** items are images, so they're signed in the response
  already. Open `fileUrl` directly.
- **`fileUrl` in `/patient/associated-documents`** arrives signed for **5
  minutes** for documents (12 hours for `gallery` images). A list left open
  longer holds dead document links, so sign on tap as above rather than
  opening `fileUrl`.

Sending a `type` not in this table gives `400` with
`"Invalid input: expected …"`.

### Errors

| Status | Meaning | What to show |
|---|---|---|
| `400` | A query value failed validation (bad `type`, `id` not a UUID) | Nothing to the user; it's a bug in the request |
| `401` | Token missing or expired | Normal auth handling |
| `403` | Caller has no clinic (or a clinic user hit the patient path) | "You do not have access to this document" |
| `404` | Document missing, **or** it belongs to another clinic | "Document not found" |

The 404 is deliberately the same for "does not exist" and "not yours", so the
endpoint cannot be used to probe for valid ids. Do not treat 404 as a bug.

## Rules for handling the signed URL

1. **Fetch it when the user taps, not when the screen loads.** A link signed
   on page load may be dead by the time it is used.
2. **Never store it.** Not in local state that outlives the screen, not in a
   database, not in an offline cache. It stops working in 5 minutes.
3. **Re-sign on every open.** Reopening the same document means calling the
   endpoint again. It is cheap.
4. **Anyone holding the link can use it while it is alive.** There is no
   second check on who presents it. Do not put it anywhere it could leak — log
   output, crash reports, analytics, share sheets.
5. **A download in progress is fine.** The expiry applies to *starting* the
   download, not finishing it.

## Saving a document to the device

To **open** a document, use `/files/sign` as above. To **save** it with a
readable file name, there is a second endpoint:

```
GET /api/v1/files/download?type=<type>&id=<uuid>&downloadAs=<name without extension>
Authorization: Bearer <token>
```

It returns **the file itself, not JSON**. `Content-Type` is the file's own
type, and `Content-Disposition` carries the name, with the stored file's
extension added: `downloadAs=Lab-Report_CT-KUB_Raju` saves as
`Lab-Report_CT-KUB_Raju.pdf`, or `.jpg` for a photographed report. Non-Latin
names (e.g. Devanagari) arrive intact in `filename*=UTF-8''…`.

What the server does, in order:

1. Checks the token. Missing or expired: `401`.
2. Finds the caller's clinic. None: `403`.
3. Validates the query: `type` from the table above, `id` a UUID,
   `downloadAs` 1–120 characters. Otherwise: `400`.
4. Looks the document up on its record, **filtered by the caller's clinic**.
   Missing, or another clinic's: `404`.
5. Reads the file from storage. The stored file is gone: `404`.
6. Sends the bytes with the name from step 3 plus the stored extension.

Errors come back as the usual JSON body, so **check the status before treating
the response as a file**.

**Which to use.** The app can also save a document by downloading the signed
URL from `/files/sign`: native HTTP clients are not bound by the browser's
cross-origin rules. The file then arrives named after its storage key (a
UUID), so rename it yourself. `/files/download` exists because a web browser
cannot save a cross-origin file without leaving the page; the web app uses it
for its Download and Print buttons.

**Clinic staff only.** There is no patient version. A patient saving a
document uses the signed URL from `/files/sign/patient`.

## Fields affected

If a response field is named one of these, its value is a reference and must
be signed before use:

```
prescriptionPdf   reportPdf         reportDocs       consentFile
doctorManualPrescription            invoice          invoiceUrl
attachments       pdfUrl            downloadUrl      currentFileUrl
```

Every other file-looking value in a response is already signed and usable
directly.

**One exception:** the lab report download endpoint
(`/api/v1/lab/results/:resultId/report`) returns `pdfUrl` and `downloadUrl`
already signed at 5 minutes. That call *is* the on-demand step — open what it
gives you, do not sign it again.

## Rollout

Nothing is forced on you. The order is:

1. Backend cutover happens. New uploads become private; everything already
   stored keeps working. **Installed app versions keep working** — a signed
   URL is just a URL as far as the app is concerned, and old files are
   unaffected.
2. You ship a release implementing the above.
3. We raise `minimum_version` via `GET /api/v1/app-update/` to force users
   onto it.
4. Only then does the backend stop returning document references at all.

So the app keeps running throughout. Step 2 is not urgent, but until it ships,
any document uploaded *after* the cutover will fail to open in the app.

## How to test before the cutover

Ask backend to point your environment at the private bucket
(`DEV_AWS_BUCKET_NAME`). Then:

- Upload a new prescription or report
- Try opening it the old way — should be `AccessDenied`
- As a patient, open a lab report, a prescription row and a consent form
  through `/files/sign/patient`, including one for a linked family member —
  all should work; another patient's id should give `404`
- Open it through `/files/sign` — should work
- Save it through `/files/download` — should arrive with the `downloadAs` name
  and the right extension
- Wait six minutes and retry the same signed link — should fail
- Check that an old, pre-existing document still opens normally

## Open question for you

**Does the app cache API responses to disk?** If it does, any cached response
older than 12 hours has dead image URLs in it. Tell us and we will size the
inline TTL accordingly — it is one constant on our side
(`INLINE_TTL_SECONDS`), currently 12 hours, and the presigned maximum is
7 days.

## Contact

Backend detail lives in `S3_PRIVATE_MIGRATION_PLAN.md`; the non-technical
summary is `S3_PRIVATE_MIGRATION_OVERVIEW.md`. Both in this repo under
`docs/files/`.
