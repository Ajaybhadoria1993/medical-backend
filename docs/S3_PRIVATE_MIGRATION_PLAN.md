# S3 Private Migration Plan

Plan only — no code changed. Takes the `infninity-medisatu` bucket off public
read and partitions new uploads per clinic. Six phases, ordered so nothing
breaks mid-flight.

## Headline finding

The bucket is world-readable today, and **the database stores the full public
https URL, not the S3 key**. Every controller persists `req.file.location`
straight into its column — roughly fourteen columns across the models. Flip
Block Public Access and every one of those stored values is a dead link.

That single fact shapes the whole plan. The fix has to work without rewriting
fourteen columns and ~1,600 rows in one go, which is why the signer accepts a
URL *or* a key and the columns convert fix-forward instead of by migration.

Second finding: **no clinic ID appears anywhere in a key.** A prescription for
one clinic and a prescription for another are neighbours in the same folder,
distinguishable only by a database lookup.

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
- URL to key derivation: `deleteFromS3`, `client.ts:135` already does
  `new URL(u).pathname`. The signer uses the same trick.
- Force-update lever: `app_update_config.minimum_version` / `force_update`
  (`src/main/appUpdate/models/appUpdate.model.ts`). This is what makes the
  final phase safe rather than a guess about who upgraded.

---

## What breaks on the flip

Three things, two of them silently.

**1. Every generated PDF loses its images.** Server-side Puppeteer
(`src/utils/browserPdf.ts`) renders invoices and all six report cards, and
those templates hardcode the bucket URL for the brand logo:
`htmltamplates/invoice.ts:365`, `report_card1.ts:327`, `report_card2.ts:344`,
`report_card3.ts:350`, `report_card4.ts:350`, `report_card5.ts:501`,
`report_card6.ts:545`. A private bucket returns 403, Chromium renders a broken
image, and nothing surfaces an error — PDFs go out to patients with a hole
where the logo was. The clinic logo injected into the same templates goes with
it.

**2. Doctor reference images stop loading** — `appointment.service.ts:6410`,
public URL on the same bucket.

**3. Found in passing — banner uploads escape the environment prefix.**
`uploadBannerForm` builds its key directly and never calls `withEnvPrefix`
(`banner.storage.ts:68`), unlike every other uploader. Staging and production
banners share a namespace right now. Separate bug; the same phase-3 edit fixes
it.

**What does *not* break**, which is the useful half: the public doctor profile
returns no images, nothing sends an S3 URL to WhatsApp/Meta, and email uses
real attachments rather than remote image tags. Apart from the two static
brand assets above there are **no anonymous consumers**. That is what makes
the flip tractable.

---

## The plan

| # | Phase | Mobile release? |
|---|---|---|
| 0 | Versioning ON + lifecycle rule expiring noncurrent versions after 30d | — |
| 1 | Brand logo + doctor reference images out of S3, into the repo | no |
| 2a | `signS3Url` helper; inline images signed in place, 12h TTL | **no** |
| 2b | Add `GET /api/v1/files/sign`; keep signing PHI in place as well | no |
| 3 | Clinic-scoped key shape on write (server-side only) | **no** |
| 4 | **Flip Block Public Access ON**, narrow IAM to `{env}/*` | no |
| 5 | Mobile release using the sign endpoint; raise `minimum_version` | **yes** |
| 6 | Drop the PHI URL from response bodies | — |

### Phase 0 — make the bucket recoverable

Versioning is off, so there is no undo on a bucket holding ~1,600 live
objects. Every phase below writes to it or relists it. Nothing else starts
until this is done. The lifecycle rule keeps versioning's cost bounded.

Console work — see "Not mine to run" below.

### Phase 1 — take the static brand assets out of S3

The logo and doctor reference images are fixed brand files that never vary per
clinic. They do not need to be in object storage at all. Check them into the
repo, reference them as a data URI in the templates.

Removes the only anonymous-fetch dependency, touches no stored data, fully
independent — it can ship on its own. It **must** land before phase 4 or every
generated PDF loses its logo.

### Phase 2 — the read path

One helper, `signS3Url(urlOrKey, expiresIn)` in `src/utils/s3Url.ts`. It takes
a full URL or a bare key, deriving the key the way `deleteFromS3` already
does.

Accepting both shapes is what removes the migration: old rows holding URLs and
new rows holding keys both work, so a column converts whenever someone is
already editing that feature. Fix-forward, per `WORKFLOW.md` §3 — no big-bang
backfill.

Files then split by how they are consumed, because one TTL cannot serve both:

| | Files | Mechanism | TTL |
|---|---|---|---|
| **Inline images** | logos, avatars, banners, galleries | signed in place, same field name and type | 12h |
| **PHI documents** | prescription PDF, report docs, lab report PDF, consent file, pharmacy invoice | `GET /api/v1/files/sign?key=` at click time | 5 min |

The inline path keeps field names and types identical, so **the web frontend
changes zero lines** across ~185 references, and the mobile app needs no
release either — a signed URL is still a URL string and both clients just
render it.

The 12h inline TTL exists because RTK Query caches responses; a shorter
signature expires while the cached response is still on screen and the image
breaks. PHI never sits in a cached response at all, which is the point of the
separate endpoint.

**Signatures are generated per response and never stored.** The object never
changes — same key, same bytes. Each response signs it again. Signing is local
crypto, not an AWS call, so this is free at any volume.

The side effect: the same image gets a different URL on every response, so the
browser cache misses and re-downloads it. This is handled by rounding the
expiry to a fixed window — see Decisions below.

The clinic logo also needs signing before it is injected into the Puppeteer
HTML.

### Phase 3 — the write path

```
{env}/c/{clinicId}/{category}/{yyyy}/{mm}/{uuid}{ext}
```

- `clinicId` from `req.clinicId` on the token, never the request body — the
  tenancy rule already in `BACKEND_STANDARDS.md`.
- `uuid` replaces `basename-ts-rand`. Today the original filename goes into
  the key, so patient names land in S3 keys and access logs. The original name
  already goes into S3 object metadata, so nothing is lost.
- Non-clinic tenants get their own roots: `{env}/lab/{labId}/...`, and
  `{env}/platform/...` for superadmin banners.

One edit to `createS3Storage` (`client.ts:61`) covers every uploader except
the three that hand-roll `multerS3(...)` — banner plus the two clinic forms.
Folding those into the factory is the same edit that fixes the missing
environment prefix.

Also needs updating: `sales.service.ts:808` hand-builds a public URL string
rather than going through a helper.

### Phases 4-6 — flip, then clean up

Block Public Access goes on only after 1-3 are live and verified; IAM then
narrows from `s3:*` to `GetObject`/`PutObject`/`DeleteObject` on `{env}/*`.

The flip does **not** wait on a mobile release. While PHI is still signed in
place, the old app receives a working signed URL and behaves exactly as
before. The mobile release gates only phase 6 — removing those URLs from the
response body.

---

## Existing data — what happens to it

**Nothing is moved, renamed, re-uploaded or migrated.** No backfill job, no
downtime, no migration step in any phase.

**The ~1,600 objects in the bucket** stay at their current keys. They stop
being publicly readable at phase 4 — the main protection, and they get it in
full — and they are signed on read like everything else. What they do not get
is the clinic-scoped prefix, so they are protected by signature-and-expiry
only, not by an ownership check. See "The hole this leaves" below.

**The URLs already in the database** stay exactly as they are. On read the
signer strips the stored value down to the object key and signs that:

```
stored:  https://infninity-medisatu.s3.../production/clinic_logos/foo-123.png
signs:   production/clinic_logos/foo-123.png
```

This is the whole reason the signer accepts a URL *or* a key. It also means
objects uploaded before the environment prefix existed still resolve, because
the key is read from whatever the row actually holds rather than reconstructed
from an assumed shape.

**The signer must pass through anything that is not ours, unchanged** — nulls,
empty strings, and external URLs such as a Google avatar or a seeded
placeholder. Signing a foreign URL would corrupt it. This is the one case
where getting the helper wrong breaks working data rather than just failing to
protect it, so it wants the single test the standards ask for.

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
filter. That is the whole argument for phase 3. The same partition is also
what makes per-clinic export, offboarding, deletion, lifecycle rules and cost
attribution expressible at all; today none of them can be, because nothing in
the bucket knows which clinic it belongs to.

### The hole this leaves

Every row today points at an old flat key with no clinic ID, so the prefix
check cannot apply to them. They are grandfathered — signed on read, but not
ownership-checked by prefix.

After phase 4 the existing ~1,600 objects are protected by **signing and
expiry only**, not by tenancy. They stop being world-readable, which is the
main risk closed. They gain per-clinic isolation only if backfilled, and that
backfill is deliberately out of scope.

---

## Decisions taken (2026-09-23)

**A mobile app consumes these URLs.** It does not force an early release:
signing in place keeps it working through phase 4 unchanged. Only phase 6
needs a shipped app plus a `minimum_version` bump. This is why the flip comes
before the release rather than after.

**The existing ~1,600 objects are grandfathered, not moved.** They keep flat
keys and get signed on read. Zero migration risk; the bucket tidies itself as
new uploads land in the new shape. Cost: the tenancy hole above. Rejected
alternative — a script copying every object to its clinic-scoped key using the
clinic ID from its row. Correct, but real work against a bucket that until
phase 0 has no undo.

**PHI gets an on-demand endpoint, not a long-lived URL in the response.**
5-minute links fetched at click time, so a prescription link never lands in
RTK Query's cache or in browser history. Cost: frontend work at the click
sites — a much smaller set than the 185 inline references. Rejected
alternative — streaming bytes through an authenticated route, strictly
stronger but puts every PDF download on the app's bandwidth and holds a
connection per download.

**Inline signatures are rounded to a fixed window, not signed from `now`.** A
signature computed from the current timestamp differs on every response, so
the browser sees a new URL for an unchanged image and re-downloads it every
time — the cache never hits.

The fix is to round the **signing time** down to a window boundary and keep
the TTL as-is, not to round the expiry. Signed at 10:59 with a one-hour
window: signing time becomes 10:00, validity stays 12h, so the URL expires at
22:00. Every response between 10:00 and 11:00 produces a byte-identical URL
for that object, and caching works as it does today. Effective minimum life is
TTL minus the window — eleven hours in that example.

Rounding the expiry instead would be the obvious-looking mistake: a URL signed
at 10:59 against an 11:00 boundary would live one minute.

This has to be chosen before phase 2 ships. It costs nothing to build up
front, but it is not something that gets noticed and fixed later: the symptom
is a gradual "the app feels slower", with no error, no failing request and
nothing in the logs pointing at it.

### Deliberately out of scope

**CloudFront + OAC + signed cookies.** The right answer at scale: CDN caching,
one cookie per session instead of a signed URL per object. Also a new
distribution, a certificate and an invalidation story. Add it when image
latency or S3 GET cost shows up in a bill.

**Backfilling old objects into clinic prefixes.** Worth doing only if
per-clinic offboarding, export or deletion becomes a real requirement. Needs
phase 0 first and a dry-run inventory before anything moves.

---

## Traps and open questions

### What a signed URL exposes

A presigned URL does **not** hide the bucket or the path. It is the same
address with signature parameters appended:

```
https://<bucket>.s3.<region>.amazonaws.com/production/c/<clinicId>/prescriptions/2026/09/<uuid>.pdf
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=<accessKeyId>/<region>/s3/aws4_request
  &X-Amz-Expires=43200
  &X-Amz-Signature=<sig>
```

Visible to anyone holding the link: bucket name, region, environment, clinic
ID, document category, date and filename. The access key ID is visible too —
public by design, not the secret half.

None of that grants access. The bucket is private, and knowing a sibling
object's path does not help because it cannot be signed without the
credentials. The exposure is reconnaissance, plus whatever the path itself
says about the file.

**The part that actually mattered is the filename**, and phase 3 fixes it.
Keys currently embed the original upload name, so `Ramesh-Sharma-report.pdf`
travels in the URL, in browser history, in access logs and in any support
ticket it is pasted into. The UUID filename is not cosmetic — it is the
difference between a leaked link naming a patient and a leaked link naming
nothing.

If the bucket and path ever need hiding, two options, neither justified now:

- **CloudFront with a custom domain** — links become
  `https://files.<domain>/...`. Hides bucket and region; the path stays
  visible unless it is also rewritten. Needs a distribution and a certificate.
- **Streaming through the API** — links become
  `https://api.<domain>/api/v1/files/<id>`. Hides everything. Already rejected
  for PHI above, on bandwidth and held-connection cost.

### Presigned URLs cap at seven days — and only with long-lived credentials

A SigV4 presigned URL cannot outlive the credentials that signed it. The
backend currently signs with an IAM user key from `ACCESS_KEY_ID` /
`SECRET_ACCESS_KEY`, so the full seven days is available.

But `getCredentials` falls back to the default credential chain when those are
absent (`src/utils/aws.client.ts:37`). The moment production moves to an
instance role, every signed URL silently inherits the session token's expiry
instead — often 1-12h — with no code change and no error. Images would simply
start breaking.

Worth an explicit assertion at boot rather than discovering it in production.

### Does the mobile app persist URLs or bytes?

Caches decoded **bytes** — nothing to do. Stores **image URLs** in local
storage/SQLite and renders them later — anything older than the inline TTL
shows broken after phase 4. Fix would be a longer inline TTL (up to the 7-day
ceiling) plus refresh-on-fetch.

Cannot be verified from this workspace; needs an answer from the mobile
codebase **before phase 4**.

### Not mine to run

Phase 0 is entirely console work — enabling versioning on `infninity-medisatu`
and adding the lifecycle rule. Phase 4's IAM narrowing is the same. Both are
left to run by hand: no AWS call, read-only included, happens from here
without explicit permission.
