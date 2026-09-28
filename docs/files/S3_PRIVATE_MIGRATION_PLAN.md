# S3 Private Migration Plan

Takes new file uploads private and files them per clinic. A new private bucket
receives everything from the cutover onward; the existing bucket is left
exactly as it is.

**Status 2026-09-24: all application code is built.** What remains is creating
the bucket, pointing `AWS_BUCKET_NAME` at it, and applying the IAM policy —
all console work. Nothing has been run against a live server or in a browser
yet. See "What is built" for the per-step state and the decisions that changed
during the build.

**Scope narrowed 2026-09-24 — read "Decision: draw a line" before anything
else.** Earlier drafts migrated the ~1,600 existing objects into the new
bucket. That is no longer in scope. The existing bucket stays public and keeps
its contents; only new uploads are protected. Steps 1, 4 and 5 are struck.

## Decision: draw a line

**Taken 2026-09-24. Deliberate, not an oversight.**

The ~1,600 objects already in `infninity-medisatu` — including prescriptions,
lab reports and consent forms — **remain publicly readable**. They are not
migrated, and the bucket is not closed. Everything uploaded from the cutover
onward goes to a new private bucket and is protected.

**Why:** it turns a migration project into a configuration change. Copying
objects and rewriting fourteen columns of database rows carries its own risk,
and the value is retrospective. Stopping the exposure growing was judged the
thing worth having now.

**What it costs, stated plainly:**

- Every clinical document uploaded before the cutover stays world-readable to
  anyone holding or guessing its URL, permanently.
- Those keys were generated with `Math.random()`, so they are not reliably
  unguessable — see "What is wrong with the current naming".
- Per-clinic storage billing, if it ever happens, cannot see them.

**This is reversible, cheaply, at any time.** Closing them needs no migration
and no code — one bucket policy on the old bucket keeping only `ims/*` and
`docoter_refernce_images/*` public, plus turning the ACL blocks on. The brand
logo keeps working; everything else in that bucket goes private and is signed
by code that already exists. Recorded here so the option is not lost.

## Headline findings

**1. The database stores the full public https URL, not the S3 key.** Every
controller persists `req.file.location` straight into its column — roughly
fourteen columns across the models. Any approach has to cope with that.

**2. No clinic ID appears anywhere in a key.** A prescription for one clinic
and a prescription for another are neighbours in the same folder,
distinguishable only by a database lookup.

**3. Uploads are not validated.** The `allowedFormats` list passed to every
uploader is written into S3 metadata and never enforced, and only two of nine
uploaders set a size limit. Any file type, any size, on almost every upload
route today.

**4. Two upload routes are unauthenticated — the most urgent item here.**
`POST /api/v1/global/upload/single` and `/multiple` hand a presigned PUT URL
to anyone who asks, for a folder the caller names. Unauthenticated write
access to the bucket, live today, unrelated to this migration. Step 0.5.

---

## Why a new bucket

An earlier draft flipped Block Public Access on the existing bucket. A new
bucket is better, and combined with "draw a line" it is also much cheaper.

- **Nothing is flipped on a live bucket.** Changing an access setting on
  storage serving production traffic was the riskiest step in that draft. A
  new bucket is private from creation, so that moment never arrives.
- Correct name, versioning from day one, lifecycle rules and access logging in
  place before a single object lands.
- Only clean keys in it — no mixture of old and new shapes to reason about.
- **No migration.** The old bucket is not touched at all: not copied, not
  closed, not deleted.

**Two buckets, indefinitely.** The old one keeps its contents and stays
public; the new one takes everything from the cutover on. Each database row
carries the bucket in its stored value, so both resolve without any flag or
lookup — which is exactly why the signer accepts a URL *or* a key.

---

## Current state

One bucket, `infninity-medisatu` (`ap-south-1`), shared by all three
environments and separated only by a top-level folder — `withEnvPrefix`,
`src/configurations/s3/client.ts:55`. Block Public Access **off**, versioning
**off**.

```
{env}/{category}/{basename}-{timestamp}-{random}{ext}
```

Categories are flat and global: `clinic_logos/`, `prescriptions/`,
`medical_reports/`, `patient_tests/`, `consent_files/`, `patient_gallery/`,
`doctor_gallery/`, `pharmacy_supplier_invoice/`, `banner_images/`,
`profile_pictures/`.

### Columns holding a file URL

| Model | Column |
|---|---|
| `clinic.model.ts` | `clinicLogo` |
| `reports.model.ts` | `prescriptionPdf`, `reportDocs`, `imageUrl` |
| `labOrder.model.ts` | `reportPdf` |
| `appointmentClinical.model.ts` | `consentFile` |
| `doctorGallery.model.ts` / `patientGallery.model.ts` | `imageUrl` |
| `userProfile.model.ts` | `profileImage` |
| `lab.model.ts` | `logo` |
| `doctorManualTemplate.model.ts` | `templateImage` |
| `doctorManualPrescription.model.ts` | `doctorManualPrescription` |
| `feedback.model.ts` | `attachments[]` |
| `banner.model.ts` | `imageUrl`, `thumbnailUrl` |

### What already exists and gets reused

- Presign helper: `src/main/global/services/uploads.service.ts:80` — 300s PUT
  URLs via `getSignedUrl`. Not a new S3 layer, an extension of this one.
- URL → key derivation: `deleteFromS3`, `client.ts:135` already does
  `new URL(u).pathname`.
- Force-update lever: `app_update_config.minimum_version` / `force_update`
  (`src/main/appUpdate/models/appUpdate.model.ts`), for the final step.

---

## What the old bucket being public still carries

Under "draw a line" the old bucket stays public, so none of these break. Kept
as the checklist for whoever eventually closes it.

**1. Every generated PDF.** Server-side Puppeteer (`src/utils/browserPdf.ts`)
renders invoices and all six report cards, and those templates hardcode the
bucket URL for the brand logo: `htmltamplates/invoice.ts:365`,
`report_card1.ts:327`, `report_card2.ts:344`, `report_card3.ts:350`,
`report_card4.ts:350`, `report_card5.ts:501`, `report_card6.ts:545`. A 403
makes Chromium render a broken image with no error raised — PDFs go to
patients with a hole where the logo was.

**2. Doctor reference images** — `appointment.service.ts:6410`.

**3. Clinic logos on the public doctor profile.** `/doctor/:doctorId` is a
genuinely unauthenticated page, and `doctorPublicProfile.utils.ts:42` maps
`clinicLogo: clinic.clinicLogo ?? null` into the response. Anonymous visitors
see clinic logos today.

This one does **not** need a public bucket. Signing is server-side, so the
endpoint can sign for a caller who is not logged in. But it must be done
deliberately — every other clinic-logo path is behind auth, so an
implementation that hooks signing into the authenticated paths only will leave
this page serving dead URLs.

**What does not depend on it:** nothing sends an S3 URL to WhatsApp or Meta,
and email uses real attachments rather than remote image tags.

**Also found in passing:** `uploadBannerForm` never calls `withEnvPrefix`
(`banner.storage.ts:68`), unlike every other uploader, so staging and
production banners share a namespace today. The step 3 rewrite fixes it.

---

## The plan

| # | Step | Client changes | State |
|---|---|---|---|
| — | Delete the dead `aws.client.ts` | none | **built** |
| 0 | Create `infinity-medisetu-private`, configured correctly | none | console |
| 0.5 | **Delete the two unauthenticated upload routes** | none | **built** |
| ~~1~~ | ~~Brand assets → public assets bucket~~ | — | **struck** |
| 2a | Signer; inline images signed in place, 12h | **none** | **built** |
| 2b | On-demand sign endpoint for documents, 5 min | web: 5 sites | **built** |
| 3a | New key shape, UUID names, upload validation | none | **built** |
| 3b | Add `requireClinic` to the routes missing it | none | **built** |
| ~~4~~ | ~~Copy old objects across~~ | — | **struck** |
| ~~5~~ | ~~Retire the old bucket~~ | — | **struck** |
| 6 | Mobile release; raise `minimum_version` | **app** | mobile team |
| 7 | Drop document URLs from response bodies | none | waits on 6 |

Steps 1, 4 and 5 are struck by "Decision: draw a line". The old bucket keeps
its contents and stays public, so the brand logo keeps its current URL and the
seven PDF templates need no change.

**The cutover is one environment variable.** Point `AWS_BUCKET_NAME` at the
new bucket and every upload from that moment lands private and clinic-scoped.
Old rows keep resolving against the old bucket because each row carries its
own — so the app's IAM needs `GetObject` on both, permanently, not just
during a transition.

### Step 0 — create the private bucket

**`infinity-medisetu-private`** — everything users upload from the cutover on.

**Required:**

- Block Public Access **on** from creation. It is never public, so there is
  never a flip.
- TLS-only bucket policy (`aws:SecureTransport` deny).
- Scoped IAM policy on `s3user_IMS`, replacing its current `s3:*`.
- SSE-S3 — applied by default on new buckets, nothing to do.

**Deferred 2026-09-24 — none of it blocks the cutover:**

- **Versioning + expire-noncurrent-after-30-days.** These are a pair. Enabling
  versioning without the expiry rule starts paying for invisible old copies
  from day one, so either both or neither. Both can be turned on at any later
  date; they only protect from the moment they are enabled, which is the same
  position as today.
- **Abort incomplete multipart uploads after 7 days.** Partial uploads consume
  storage that does not appear in the object listing, so they are paid for and
  invisible. AWS is explicit that expiration rules do not cover them — it must
  be its own rule. Harmless to defer; the cost is real but small.
- **Object-level access logging.** Would be the difference between answering
  "what was read" after an incident and having nothing to investigate with.
  Dropped for now because nothing in the application depends on it and there
  is no such record today either. Not a regression, just a gap left open.

Revisit all four once the bucket carries real volume, or sooner if a clinical
record is ever deleted by accident — that is the event versioning exists for.

**No second bucket.** An earlier draft added `infinity-medisetu-public-assets`
for brand artwork. Unnecessary now: the old bucket stays public, so the logo
keeps the URL the templates already hardcode.

**The old bucket is not touched, in this step or any other.**

**The cutover is one environment variable.** `AWS_BUCKET_NAME`, per
environment, pointed at the new bucket. Uploads land private and
clinic-scoped from that moment; nothing already stored moves.

**One question worth settling here:** the 30-day noncurrent-version rule
expires *superseded* versions, not live files — a prescription is never
deleted by it. The narrow consequence is that if a report is overwritten and
the previous version is needed after 30 days for a medico-legal reason, it is
gone. Worth a moment's thought before choosing 30; not a blocker.

Console work — see "Not mine to run".

### Step 0.5 — delete the unauthenticated upload routes

**A live hole, not migration work.** It predates this plan and is worse than
the read-side problem, because write access is worse than read access.

Two routes in `src/main/global/routes/v1/upload.route.ts` are marked
`@access Public` with **no auth middleware at all**:

| Route | Auth |
|---|---|
| `POST /api/v1/global/upload/single` | **none** |
| `POST /api/v1/global/upload/multiple` | **none** |
| `POST /api/v1/global/upload/single/external` | `apiKeyAuth` |

Anyone can POST to the first two, receive a presigned PUT URL, and upload into
the bucket. The folder comes from the request body — `uploads/${path}/...` in
`uploads.service.ts` — so the caller chooses where it lands. With the bucket
currently public-read, an uploaded file is then publicly servable from your S3
URL: the standard pattern for hosting phishing or malware on someone else's
storage, at their cost.

**Confirmed 2026-09-24: neither the web app nor the mobile apps call these
routes.** Both RTK Query hooks have zero usages.

So: **delete both.** Keep `/single/external`, which is behind `apiKeyAuth`.
Deleting removes the unvalidated `path` segment with them, so there is no
whitelist to write. Check whether anything still imports
`generatePresignedURL` / `generatePresignedURLBulk` afterwards; if not, those
go too.

### Step 2 — the read path

One helper, `signS3Url(urlOrKey, expiresIn)` in the new `src/main/files/`
module. It takes a full URL or a bare key and derives the key the way
`deleteFromS3` already does.

**It must resolve which bucket an object lives in.** During the transition
both are live, and the stored value says which:

| Stored value | Bucket |
|---|---|
| Full URL containing `infninity-medisatu` | old bucket |
| Bare key | new private bucket |

Both cases persist indefinitely — the old bucket is never emptied.

Files split by how they are consumed, because one TTL cannot serve both:

| | Files | Mechanism | TTL |
|---|---|---|---|
| **Inline images** | logos, avatars, banners, galleries | signed in place, same field name and type | 12h |
| **Documents** | prescription PDF, report docs, lab report PDF, consent file, pharmacy invoice | `GET /api/v1/files/sign?key=` at click time | 5 min |

The inline path keeps field names and types identical, so **the web frontend
changes zero lines** across ~185 references and the mobile app needs no
release — a signed URL is still a URL string.

The 12h inline TTL exists because RTK Query caches responses; a shorter
signature expires while the cached response is still on screen. Documents
never sit in a cached response at all.

**Signatures are generated per response and never stored.** The object never
changes; each response signs it again. Signing is local crypto, not an AWS
call, so it is free at any volume.

The side effect: the same image gets a different URL on every response, so the
browser cache misses. Handled by rounding — see Decisions.

**Three places that are easy to miss:**

- The clinic logo before it is injected into the Puppeteer HTML.
- The **unauthenticated** doctor profile endpoint. Signing needs no logged-in
  caller, but hooking signing into the authenticated paths only leaves
  `/doctor/:doctorId` serving dead URLs.
- Old rows still pointing at the old bucket, which is permanent.

### Step 3 — the write path

#### What is wrong with the current naming

`createS3Storage` (`client.ts:61`) builds every key as:

```
{env}/{category}/{originalName}-{Date.now()}-{Math.random()}{ext}
```

**1. The original filename is in the key.** `Ramesh-Sharma-report.pdf` ends up
in the key, the URL, browser history, S3 access logs and any support ticket it
is pasted into.

**2. The random suffix is weaker than it looks.**
`Math.random().toString(36).substring(7)` — measured over 2,000,000 samples:

| suffix length | count |
|---|---|
| 2 chars | 12 |
| 3 chars | 427 |
| 4 chars | 14,545 |
| 5 chars | 526,208 |
| 6 chars | 1,409,847 |
| 7+ chars | 48,961 |

Usually six characters, but it degrades to two or three roughly once in 4,500
uploads, and two base-36 characters is 1,296 possibilities. `Math.random()` is
also not cryptographically secure, so keys were somewhat predictable for the
entire period the bucket was public.

**3. No tenant in the path.**

**4. The basename is never sanitised.** Spaces and unicode go straight into
keys, which is why there is ad-hoc `encodeURIComponent(...)` in one file and
`decodeURIComponent` in another.

#### Two worse things in the same function

**`allowedFormats` is decorative.** The factory accepts the list and writes it
into S3 *metadata*. It is never enforced. Only `banner.storage.ts` sets a real
`fileFilter`. Prescriptions, medical reports, consent files, patient tests,
galleries and profile pictures currently accept **any file type** — including
HTML, which becomes stored XSS the moment someone opens it.

**No size caps** anywhere except banner and clinic.

#### The new convention

```
{env}/c/{clinicId}/{category}/{yyyy}/{mm}/{uuid}{ext}
```

Example:

```
production/c/8f3a91c2-4d5e-4a1b-9c33-77e2b0a4f1d9/prescriptions/2026/09/a91c4e77-2b3d-4f8a-9e11-6c0d5a2e3b44.pdf
```

- `clinicId` from `req.clinicId` on the token, never the request body — the
  tenancy rule already in `BACKEND_STANDARDS.md`.
- `crypto.randomUUID()` — built into Node, cryptographically secure, 122 bits.
  It replaces both the timestamp and `Math.random()`.
- Extension kept, lowercased, checked against a whitelist that is actually
  enforced this time.
- Date partition costs nothing and enables lifecycle rules. S3 has not needed
  prefix randomisation for performance since 2018.
- The original filename goes to S3 metadata — never the key.
- Non-clinic tenants get their own roots: `{env}/lab/{labId}/...` and
  `{env}/platform/...` for superadmin banners.

**Give the user their filename back at signing time.** With UUID keys a
download otherwise saves as `a91c4e.pdf`. Set `ResponseContentDisposition` on
the `GetObjectCommand` when signing and the friendly name comes back without
it ever being in the key.

#### Scope of the edit

One edit to `createS3Storage` covers every uploader except the three that
hand-roll `multerS3(...)` — banner plus the two clinic forms. Folding those
into the factory is the same edit that fixes the missing environment prefix.

The real `fileFilter` and `limits` belong in that same factory, in this step.

Also: `sales.service.ts:808` hand-builds a public URL string rather than going
through a helper.

From here, nothing new lands in the old bucket.

### Steps 1, 4 and 5 — struck

Brand assets, copying old objects, and retiring the old bucket are all out of
scope under "Decision: draw a line". The old bucket keeps its contents, stays
public, and is never emptied or deleted.

If that decision is ever revisited, the work is: copy each object to a
clinic-scoped key in the new bucket using the clinic from its owning row,
rewrite the row, then close the old bucket. The source is never modified, so
it is abandonable at any point. Orphans with no owning row are almost
certainly failed uploads — list them, do not copy them, decide separately.

### Steps 6 and 7 — mobile, then cleanup

The mobile app keeps working untouched through every step above, because a
signed URL is still a URL string. Step 6 ships the app release that uses the
document sign endpoint, and raises `minimum_version` / `force_update` to
retire old installs. Only then does step 7 remove document URLs from response
bodies.

### Code organisation

#### Delete `src/utils/aws.client.ts` — 163 lines, effectively unused

| Export | Usages elsewhere |
|---|---|
| `downloadFileFromS3` | **0** |
| `uploadToS3` | **0** |
| `deleteFromS3` | **0** |
| `s3Client` | 1 — `uploads.service.ts` |

The file exists to hand one `s3Client` to one caller, and
`configurations/s3/client.ts` already exports an identical one. Change one
import, delete the file.

It also removes a real trap — two functions sharing a name with incompatible
signatures:

```ts
deleteFromS3(urlOrKey)            // configurations/s3/client.ts  — in use
deleteFromS3(bucketName, key)     // utils/aws.client.ts          — unused
```

Standalone work: depends on no step and blocks none.

#### Leave `src/configurations/s3/` where it is

Twenty files import it across appointments, clinic, doctor, patient, lab and
pharmacy. Moving it is a twenty-file diff through clinical modules for no
functional gain, and `configurations/` is already where this repo keeps
infrastructure config.

#### New code gets a proper module

```
src/main/files/
  services/file-url.service.ts     signS3Url, bucket resolution, TTLs
  routes/v1/files.route.ts         GET /api/v1/files/sign
  schemas/files.schemas.ts
```

Route auto-discovery mounts it at `/api/v1/files` with no router edit.

---

## What is built

### Where the code lives

| Path | Holds |
|---|---|
| `src/main/files/` | The feature: signer, sign endpoints, lookups, types, tests |
| `src/configurations/s3/keys.ts` | Key building, tenant resolution, the unscoped warning |
| `src/configurations/s3/client.ts` | `createUploader` — one factory, validation enforced |
| `src/middlewear/signFileUrls.middleware.ts` | Signs stored values on the way out |
| `src/utils/pdf.utils.ts` | Signs before Chromium renders a template |

### Decisions that changed while building

**Inline images are signed by a response middleware, not per service.** 36
files return an image column across 269 `sendOk` sites; hand-editing them
would have missed some, and a miss is an invisible broken image found only
after the flip. The middleware has a synchronous fast path, so a response with
no file value behaves exactly as before and never enters the async walk.

**The walker must skip document fields.** It would otherwise sign
`prescriptionPdf`, `reportPdf` and friends at the 12-hour inline lifetime,
undoing the whole point of the on-demand endpoint. `DOCUMENT_FIELDS` is that
skip list, with a test per field.

**`requireAuth` does not set `req.clinicId` — `requireClinic` does.** The sign
route originally had only `requireAuth`, so its ownership check read
`undefined` and would have refused every request.

**Only 6 of 25 upload sites established a clinic context.** The plan assumed
`req.clinicId` was broadly available; it was not. Step 3b closed this by
reading the routes rather than waiting on production logs, and the count was
much smaller than feared: of the 19 unscoped sites, 8 were spreadsheet imports
on `multer.memoryStorage()` that never reach S3 at all, 3 are patient
self-serve, 1 is a superadmin banner and 2 create the clinic in the same
request that uploads its logo — correctly unscoped, all of them.

Seven routes actually needed work, and three of those were worse than a
missing scope: `doctor.route.ts` /update-doctor-manual-template and both
`appointmentTest.route.ts` upload routes ran multer **before** `requireAuth`.
Multer writes to S3 as it runs, so an unauthenticated caller's file landed in
the bucket and only then was the request rejected. Reordering fixed the hole
and the key in one move. The remaining four — both appointment gallery
uploads, the doctor profile image and the pharmacy stock invoice — simply
gained `requireClinic`.

The `unscoped/` fallback and its warning log stay. They now cover only the
cases that are meant to be unscoped, which is what they should have been
measuring all along.

**Patients need their own route.** `requireClinic` resolves a clinic from
`ClinicAssignModel`, a staff assignment, so it 403s a patient outright.
`GET /files/sign/patient` scopes by `req.user.id` instead. The two tenancy
models are kept in separate handlers deliberately.

**Saving needs its own route.** (2026-09-25) The private bucket has no CORS rule,
so a browser can neither save nor print a signed link without leaving the page.
`GET /files/download?type&id&downloadAs` uses the same clinic-scoped lookup,
reads the object with `readS3Object`, and returns the bytes as an attachment.
The file passes through the API; fine at current report sizes. A bucket CORS
rule would remove the need, but was declined: its origin list breaks silently
when a domain changes.

**The lab report download mutation signs at 12h, not 5 min.** Its `pdfUrl` is
returned by the mutation the user just triggered rather than sitting in a
cached list, so the middleware covers it and the frontend needed no change.
Open to revisiting; it is the one document link that is not short-lived.

### Corrections to earlier drafts of this document

- The public doctor profile **does** return clinic logos
  (`doctorPublicProfile.utils.ts:42`), so that unauthenticated endpoint must be
  signed too. An earlier draft said it returned no images.
- Rounding applies to the **signing time**, not the expiry. Rounding the expiry
  would leave a link signed at 10:59 alive for one minute.
- The 30-day noncurrent-version rule expires superseded versions only. It does
  not delete live records, so it does not conflict with record retention.
- The frontend has 5 affected click sites, not ~12. The rest open local blob
  URLs that never touch S3.

### Not verified

Nothing has been run against a running server or opened in a browser. That
matters more than usual here: the response middleware sits in front of every
endpoint, and the upload factory rewrites the path every upload takes.

---

## Clinic-wise data

Two different things get called this, and only one protects data.

**Authorization** stops the leak: before signing, check the caller may see the
object.

**Key layout** makes that check cheap. With the clinic ID in the key it is a
string comparison:

```ts
key.startsWith(`${env}/c/${req.clinicId}/`);
```

Without it, every feature needs its own ownership query before it can sign
anything — a different query per file type, each one a place to forget the
filter.

The same partition is what makes per-clinic export, offboarding, deletion,
lifecycle rules and cost attribution expressible at all.

**It applies to new objects only.** Everything uploaded before the cutover
keeps a flat key and gets no ownership check — see "Decision: draw a line".

---

## Decisions taken

**A mobile app consumes these URLs.** It does not force an early release:
signing in place keeps it working throughout. Only step 7 needs a shipped app
plus a `minimum_version` bump.

**Documents get an on-demand endpoint, not a long-lived URL in the response.**
5-minute links fetched at click time, so a prescription link never lands in
RTK Query's cache or in browser history. Cost: frontend work at the click
sites — a much smaller set than the 185 inline references. Rejected
alternative: streaming bytes through an authenticated route, strictly stronger
but puts every download on the app's bandwidth.

**Inline signatures are rounded to a fixed window, not signed from `now`.** A
signature computed from the current timestamp differs on every response, so
the browser re-downloads unchanged images.

The fix rounds the **signing time** down to a window boundary and keeps the
TTL as-is — not the expiry. Signed at 10:59 with a one-hour window: signing
time becomes 10:00, validity stays 12h, expiry lands at 22:00. Every response
in that hour produces a byte-identical URL. Effective minimum life is TTL
minus the window.

Rounding the expiry instead is the obvious-looking mistake: a URL signed at
10:59 against an 11:00 boundary would live one minute.

**Old objects are left alone.** Not copied, not closed, not scoped. An
intermediate draft copied them; that was reversed. See "Decision: draw a
line" at the top for the reasoning and the cost.

### Deliberately out of scope

**CloudFront + OAC + signed cookies.** The right answer at scale: CDN caching,
one cookie per session instead of a signed URL per object. Also a new
distribution, a certificate and an invalidation story. Add it when image
latency or S3 GET cost shows up in a bill.

---

## Future scope — per-clinic storage billing

**Not scheduled. Nothing here is being built.** Recorded because it was raised
during planning and the design should not be re-derived later.

The intent: meter how much storage each clinic uses and bill for it.

**Step 3 makes it possible, for new uploads only.** Without clinic IDs in
keys there is no way to measure per-clinic storage from S3 at all.

But pre-cutover files carry no clinic prefix and are never migrated, so they
are invisible to metering. Billing would silently exclude them — permanent
free storage for whatever a clinic uploaded before the cutover. Closing that
means backfilling those objects, which "Decision: draw a line" rules out for
now.

### How to measure it — both, for different jobs

- **A database counter written at upload time.** Add the byte size on upload,
  subtract on delete. Instant, free, always current. This is what the UI shows
  and what a limit check reads.
- **S3 Inventory, monthly.** A scheduled report of every object and its size,
  aggregated by clinic prefix. The billing truth, and what corrects counter
  drift.

Both are needed. A counter alone drifts the first time a file is removed
outside the application. Inventory alone is a day stale, useless for "you have
hit your limit" in the interface.

Not CloudWatch: `BucketSizeBytes` is bucket-level only. Storage Lens does
prefix metrics but is expensive at one-prefix-per-clinic cardinality.

Note that Inventory's `Size` field excludes incomplete multipart uploads —
another reason step 0's abort rule matters.

### What already exists to build on

`clinic_usage` (clinicId + featureKey + usageCount + period) and
`plan_features` (limitValue, isUnlimited), enforced by
`limitation.middleware.ts`. Two catches:

- **`usageCount` is `integer`** — overflows around 2.1 GB counting bytes.
  Track megabytes, or add a bigint column.
- **`clinic_usage` resets each period.** Storage is cumulative — a file
  uploaded in January still occupies space in March. Storage needs a standing
  total, not a period row.

### Questions to settle before building it

- Do noncurrent versions count toward a clinic's quota? They cost real money.
- Does a quota include files deleted but still within version retention?
- Is the quota enforced at upload (reject) or billed as overage?

---

## What this plan does not cover

This closes the largest hole — files readable by anyone, forever. It is not a
clinical-grade file protection programme.

### Already covered, at no extra cost

| Gap | Where it lands |
|---|---|
| Object-level access logging | Step 0, one console toggle |
| Upload type validation | Step 3 |
| Environment isolation | IAM scoping to `{env}/*` |
| Patient names out of keys and logs | Step 3 |
| Encryption at rest and in transit | Already on; add a TLS-only bucket policy |
| Data residency | Already correct — `ap-south-1` |

### Left for later — each a separate piece of work

**No in-app access audit.** You will know a link was *issued*, not that it was
*used*, by whom, or how many times. For a clinical system "who opened this
patient's report" is usually expected. Step 0's access logging gives the raw
material for an investigation; it does not give a queryable trail in the
product.

**No malware scanning on upload.** Step 3 adds type validation, which blocks
the obvious cases, but a malicious PDF uploaded as a report and later opened
by a doctor is still a live path.

**Versioning is not a backup.** It protects against overwrite and accidental
delete, not against the bucket being deleted or the account compromised. No
cross-region replication, no copy in a separate account.

**No enforced retention or deletion protection.** No Object Lock. Cannot be
designed until there is an answer to what the retention period is — a legal
question, not an engineering one.

**Erasure requests stay hard.** Keys are clinic-scoped, not patient-scoped, so
"delete everything for patient X" remains a database-driven job.

**Environments are not isolated.** All three share one bucket, separated only
by the `{env}/` prefix — and as of 2026-09-24 they also share one IAM user
(`s3user_IMS`) whose policy grants all three prefixes. So a developer running
locally can read and delete production prescriptions. The separation is a
naming convention, not a boundary.

This was chosen knowingly to get moving; the fix is AWS-side only and needs no
code. Create one IAM user per environment, each scoped to a single prefix, and
put its keys in that environment's `.env`. The bucket name and credentials are
both already per-environment settings, so nothing in the application changes.

Until then, a presigned URL signed in any environment works against every
environment's objects.

---

## Traps and open questions

### What a signed URL exposes

A presigned URL does **not** hide the bucket or the path:

```
https://<bucket>.s3.<region>.amazonaws.com/production/c/<clinicId>/prescriptions/2026/09/<uuid>.pdf
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=<accessKeyId>/<region>/s3/aws4_request
  &X-Amz-Expires=43200
  &X-Amz-Signature=<sig>
```

Visible: bucket, region, environment, clinic ID, category, date and filename,
plus the access key ID — public by design, not the secret half.

None of it grants access. The bucket is private and a sibling path cannot be
signed without credentials. **The part that mattered was the filename**, and
step 3 fixes it.

### A signed link is bearer access

Whoever holds a valid link can open it, logged in or not. S3 checks the
signature and nothing else — no session, no cookie, no IP check. And it cannot
be revoked once issued.

That is why documents get 5 minutes: the window *is* the protection. If
revocation or per-view audit ever becomes a hard requirement, the answer is
streaming through the API, not a shorter TTL.

### Presigned URLs cap at seven days — and only with long-lived credentials

A SigV4 presigned URL cannot outlive the credentials that signed it. The
backend signs with an IAM user key from `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY`,
so seven days is available.

But `getCredentials` falls back to the default credential chain when those are
absent (`src/utils/aws.client.ts:37`, or its replacement). The moment
production moves to an instance role, every signed URL silently inherits the
session token's expiry — often 1–12h — with no code change and no error.

Worth an explicit assertion at boot rather than discovering it in production.

### Answered

**Does the mobile app persist image URLs?** No — resolved 2026-09-24. The 12h
inline TTL stands. Re-check if the app ever adds offline support.

**Do the mobile apps call the public upload routes?** No — resolved
2026-09-24. Hence deletion rather than authentication.

### Blocks the production cutover

**The WhatsApp pharmacy invoice link dies at cutover.** `sales.service.ts`
sends the sale invoice URL to the patient as a WhatsApp template *body
parameter* — it leaves the app entirely, so there is no tap of ours to sign
on. Once the bucket is private the patient taps it and gets `AccessDenied`.
This is a live patient-facing break, not a dormant one.

Skipped by decision on 2026-09-24, with the fix deferred. **Do not cut
production over until this is resolved.** Dev is already in this state.

Three ways out, cheapest first:

1. **Sign for 7 days at send time.** One line, no external dependency. The
   link stops working after a week — acceptable for a pharmacy bill, and 7
   days is the presigned maximum so it cannot be stretched further.
2. **Attach the PDF instead of a link.** The right answer: nothing expires,
   nothing leaks, the patient keeps the file. Needs the `pharmacy_invoice`
   template changed from a body text parameter to a **document header** and
   re-approved by Meta (1–24h, can be rejected), plus uploading the bytes to
   Meta's `/media` endpoint for a media id — those expire after 30 days, so
   the send path has to handle re-upload.
3. **Keep sale invoices in the old public bucket.** No behaviour change at
   all, but a patient's name and medicine list stay permanently public, which
   is the thing this work exists to stop.

### Still open

- **Does the application need write access to the public assets bucket?**
  Nothing found so far requires it, and the no-write guard is the main
  protection on that bucket.
- **What is the retention period for clinical documents?** Blocks any Object
  Lock work and informs the version lifecycle choice.
- **Pharmacy stock invoices are scoped to the wrong tenant.** Decided
  2026-09-24: a supplier invoice belongs to the *pharmacy*, not the clinic, so
  `requireClinic` was deliberately reverted on
  `stock.route.ts` `POST /upload-invoice/:stockId`. Consequence, accepted for
  now: those uploads land under `unscoped/` and carry no tenant at all.
  Deferred, not resolved. The fix needs a `ph/{pharmacyId}` tenant segment in
  `buildObjectKey` plus something setting `req.pharmacyId` before multer —
  this module resolves the pharmacy inside its controllers
  (`PharmacySupplierService.getUserPharmacyId`), not in middleware, so there is
  no existing hook to reuse. Reading is unaffected: the `stockInvoice` signing
  lookup joins `pharmacy_stock → pharmacy → clinic_id`, and `requireClinic`
  does resolve a clinic for the Pharmacist role, so previews already work.

### Not mine to run

Step 0 is entirely console work — creating both buckets, their policies,
lifecycle rules and logging. Step 5's Block Public Access and deletion are the
same, as is the IAM narrowing. All left to run by hand: no AWS call,
read-only included, happens from here without explicit permission.
