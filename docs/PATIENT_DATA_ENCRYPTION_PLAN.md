# Patient Data Encryption Plan — Complete Guide

Status: **Proposed / not yet implemented.** Nothing in this document exists in code
yet — see [Current State](#current-state) for what's actually in place today.

---

## 1. Problem

Patients are shared across multiple clinics (a patient can visit Clinic A and
Clinic B; both need access to the same underlying record). If we encrypted
patient data per-clinic (one key per clinic), we'd have to either:

- duplicate the patient's data once per clinic (data divergence, storage
  blowup, sync bugs), or
- re-encrypt/re-key the same record every time a new clinic gets access
  (expensive, racy, and leaks the plaintext at re-encryption time).

Neither is acceptable. We need **one encrypted copy per patient**, with
**per-clinic access control** layered on top — not baked into the encryption
key itself.

---

## 2. Method — Envelope Encryption with AWS KMS

**Encrypt once per patient. Control access via a mapping table, not via key
separation.**

```
Plaintext patient field
        │
        │  AES-256-GCM  (data key, generated per patient/field-group)
        ▼
Ciphertext  ──────────────► stored in Postgres column
        ▲
        │  data key encrypted by
        │  AWS KMS Customer Master Key (CMK)
        ▼
Encrypted Data Key (EDK) ──► stored alongside ciphertext (small, opaque blob)
```

This is standard **envelope encryption**:

1. **Data Encryption Key (DEK)** — a random AES-256 key generated once per
   patient (or per sensitive field-group, see §5). Used to actually encrypt/
   decrypt the plaintext with AES-256-GCM (authenticated encryption — gives
   confidentiality + tamper detection in one primitive).
2. **Key Encryption Key (KEK)** — never leaves AWS KMS. We call
   `kms:GenerateDataKey` to mint a DEK; KMS returns the DEK in both plaintext
   (used once, in memory, to encrypt) and ciphertext form (the **encrypted
   data key**, safe to store in Postgres). We never persist the plaintext
   DEK — only the KMS-wrapped ciphertext blob.
3. To decrypt later: call `kms:Decrypt` on the stored EDK to get the
   plaintext DEK back (KMS enforces IAM policy + CloudTrail audit logging on
   this call), then AES-256-GCM-decrypt the column data with it.
4. **Encryption context (AAD)** — every `GenerateDataKey`/`Decrypt` call
   passes an encryption context of `{ patientId, tableName }` (KMS's
   built-in AAD mechanism). This doesn't change confidentiality, but it
   binds the wrapped key cryptographically to *that specific patient and
   column* — KMS refuses to decrypt if the context passed at decrypt time
   doesn't match what was used to encrypt. This closes a subtle class of
   bug: a ciphertext (or its EDK) accidentally copied/mislinked to the
   wrong patient row fails closed instead of silently decrypting under the
   wrong identity. Cheap to add, meaningful defense-in-depth for a
   multi-tenant healthcare system — added here because it directly
   supports the "wrong clinic/patient sees the wrong data" failure mode
   this whole plan exists to prevent.

**Why this instead of a clinic-specific key:**

| | Per-clinic key | Per-patient DEK (this plan) |
|---|---|---|
| Same patient, 2 clinics | needs 2 copies or re-encrypt on grant | 1 ciphertext, decrypt gated by ACL |
| Revoke clinic access | re-encrypt data | delete one mapping-table row |
| Key rotation | re-encrypt every patient touched by that clinic | rotate CMK in KMS; DEKs unaffected (KMS re-wraps transparently) |
| Blast radius of a leaked key | one clinic's key exposes only that clinic's copies | a leaked DEK only exposes *that one patient's* ciphertext (DEKs are per-patient, not shared) |

Access control is enforced **at the application layer**, before the KMS
`Decrypt` call is ever made — see §4.

---

## 3. Current State

- `src/utils/mfaCrypto.ts` already implements AES-256-GCM encrypt/decrypt
  helpers, used today only for MFA TOTP secrets/recovery codes
  (`src/main/mfa/models/mfa.model.ts`, `recoveryCode.model.ts`).
- It is keyed by a **single static env var** (`MFA_ENCRYPTION_KEY`), not KMS —
  no envelope encryption, no per-record key, no rotation story. Do not reuse
  it as-is for patient data; the pattern (AES-256-GCM, IV + authTag stored
  alongside ciphertext) is a fine reference for the crypto primitive, but the
  key management is exactly what this plan replaces.
- **No patient-facing data is encrypted today.** Every column listed in §5 is
  currently plaintext in Postgres.
- **No patient-clinic access-control table exists.** Clinic access to a
  patient today is implicit — inferred from appointment/report history, not
  a first-class grant/revoke list. This plan requires adding one (§6).

---

## 4. Access Control Flow

Every decrypt path must go through a single service function — never call
KMS or AES directly from a controller.

```
Controller/Service needs patient field
        │
        ▼
patientCrypto.decryptField(patientId, clinicId, fieldName)
        │
        ├─► 1. Check patient_clinic_access: does (patientId, clinicId) exist
        │      and is it active (not revoked)?
        │         NO  → throw HttpError(403, "Clinic does not have access
        │               to this patient")
        │         YES → continue
        │
        ├─► 2. Load ciphertext + EDK + IV + authTag from the row
        │
        ├─► 3. kms:Decrypt(EDK) → plaintext DEK  (KMS call, audited)
        │
        ├─► 4. AES-256-GCM decrypt(ciphertext, DEK, IV, authTag) → plaintext
        │
        └─► 5. Return plaintext to caller (never cached to disk/logs)
```

Encryption follows the mirror path: check the clinic is the one *creating*
the record (or has an active grant) → generate/reuse the patient's DEK →
`kms:GenerateDataKey` if no DEK exists yet for this patient → AES-encrypt →
store ciphertext + EDK + IV + authTag.

**Hard rule:** `req.clinicId` (already attached by `auth.middleware.ts`) is
the only source of truth for "which clinic is asking." Never trust a
clinic ID passed in the request body for an access check.

---

## 5. What Gets Encrypted

Not everything — only fields that are genuinely sensitive PHI/PII. Structural
fields (foreign keys, statuses, enums, timestamps, prices) stay plaintext so
they remain indexable/queryable/filterable in Postgres. Encrypting an FK or
an enum you need to `WHERE`/`JOIN` on defeats the point of a relational DB.

| Module | Table | Columns to encrypt |
|---|---|---|
| users | `user_profiles` | `address`, `city`, `state`, `zipCode`, `dob`, `bloodGroup`, `height`, `weight`, `allergies`, `chronicConditions` |
| appointments | `appointment_clinical_data` | `commonSymptoms`, `appointmentNotes`, `vitals`, `referrals`, `consentNotes` |
| appointments | `medical_certificate` | `medicalCondition`, `notes` |
| appointments | `doctor_manual_prescription` | `doctorManualPrescription` |
| reports | `report_cards` | `comorbidities`, `habits`, `generalExamination`, `systemExamination`, `provisionalDiagnosis`, `differentialDiagnosis`, `finalDiagnosis`, `investigations`, `advice`, `clinicalNotes`, `allergies`, `surgerySuggested`, `visitingNotes` |
| reports | `prescriptions` | `composition`, `dosage`, `frequency`, `notes` |
| lab | `lab_order_results` / `lab_order_result_values` | `remarks` only — see §5.2 for `value` |
| lab/test | `independent_patients` | `name` |

### 5.1 `email` / `mobile` — deliberately NOT encrypted by default

**Changed from the earlier draft**, which listed `users.email`/`users.mobile`
and `independent_patients.mobile` as encrypted. These are dropped for now:

- `mobile` is the **login/OTP identifier** (`docs/patient-data-model.md` —
  "One mobile number = one patient identity") and both `email` and `mobile`
  need `WHERE mobile = ?` / `UNIQUE` lookups on every login, OTP send, and
  duplicate-patient check. AES-256-GCM ciphertext is non-deterministic by
  design (random IV per encryption) — the same plaintext never produces the
  same ciphertext twice, so an indexed equality lookup against an encrypted
  column is impossible without decrypting every row.
- **Trade-off if we did encrypt them**: two options exist, both add real
  complexity and were deferred rather than silently skipped —
  - *Deterministic encryption* (fixed IV, or AES-SIV) — makes equality
    lookups possible again, but two patients with the same mobile number
    now produce identical ciphertext, which leaks equality to anyone with
    DB access (a much weaker guarantee than GCM's semantic security) and
    still can't support partial/LIKE search.
  - *Separate blind index* — store an HMAC-SHA256(mobile, server-side
    secret) in its own indexed column purely for lookup, keep the real
    value AES-256-GCM encrypted for display. This is the stronger option
    (no ciphertext-equality leak beyond "same HMAC = same value", which is
    the same leakage a hashed-password column already accepts) but is
    additional schema + a second secret to manage, and is *not* included in
    this phase.
  - Recommendation: leave `email`/`mobile` plaintext for now (they're
    contact info, not clinical PHI — lower sensitivity than diagnoses/notes)
    and revisit with a blind-index design only if compliance explicitly
    requires it. Flagged as an open question in §10.

### 5.2 Lab result `value` — split, not blanket-encrypted

**Changed from the earlier draft**, which encrypted `value` alongside
`remarks`. Splitting these because they serve different purposes:

- `lab_order_result_values.value` (the numeric/measured result — e.g. a
  glucose reading, a hemoglobin count) is what dashboards, trend charts, and
  reporting queries (`reports` module, analytics endpoints) aggregate and
  filter on (`WHERE value > x`, averages over time, out-of-range counts).
  Encrypting it would force every analytics/dashboard query to decrypt-then-
  filter in application code, which doesn't scale past a small patient
  count and breaks SQL-level aggregation entirely.
- **Recommendation**: keep `value` (and `flag` — Low/High/Abnormal, already
  a low-cardinality enum used for filtering) in plaintext, since a bare
  numeric lab value without the patient/test-name/date context it's joined
  against is low-sensitivity in isolation. Encrypt `remarks` (free-text
  clinician commentary — this is where actual clinical narrative/PHI
  lives) as originally planned.
- If compliance later requires the numeric values encrypted too, the
  correct pattern is a **separate analytics store** (e.g. a nightly
  de-identified export/warehouse) rather than encrypting the operational
  column — keeps the OLTP path fast and the analytics path compliant. Not
  scoped into this plan; call out as a follow-on if needed.

**Explicitly NOT encrypted** (needs to stay queryable, or is not PHI):
`patientId`/`clinicId`/`doctorId` FKs, `users.email`/`users.mobile`,
`independent_patients.mobile` (§5.1), `lab_order_result_values.value`/`flag`
(§5.2), appointment `status`, `age`/`gender` (low sensitivity, used for
filtering/analytics — confirm with product/legal before excluding), payment
amounts/transaction IDs (separate PCI-adjacent concern, own key policy — out
of scope here), file paths/URLs stored as `imageUrl`/`reportPdf`/
`prescriptionPdf` (the *files* in S3 should be encrypted via S3-SSE-KMS at
the bucket level, not this column-level scheme).

---

## 6. New Schema

### 6.1 `patient_data_keys` (one row per patient)

```
┌───────────────────────────────────────────────────────────────┐
│                   patient_data_keys  (NEW)                     │
├───────────────────────────────────────────────────────────────┤
│  id                UUID PK                                     │
│  patient_id        UUID FK → users.id (unique, cascade)        │
│  encrypted_dek      TEXT   -- base64, KMS-wrapped DEK           │
│  kms_key_id         VARCHAR  -- which CMK wrapped it (for       │
│                                rotation/audit trail)            │
│  created_at         TIMESTAMP                                  │
│  rotated_at         TIMESTAMP NULL                              │
└───────────────────────────────────────────────────────────────┘
```

One DEK per patient, reused across all their encrypted columns/tables. Avoids
minting a KMS data key per field (KMS API calls have latency + cost;
`GenerateDataKey` is the expensive one, `Decrypt` on a cached plaintext DEK
within a request is cheap).

### 6.2 `patient_clinic_access` (the ACL)

```
┌───────────────────────────────────────────────────────────────┐
│                 patient_clinic_access  (NEW)                   │
├───────────────────────────────────────────────────────────────┤
│  id                UUID PK                                     │
│  patient_id        UUID FK → users.id                          │
│  clinic_id         UUID FK → clinics.id                        │
│  granted_at         TIMESTAMP                                  │
│  granted_by         UUID FK → users.id (staff who created link) │
│  revoked_at         TIMESTAMP NULL                              │
│  status             ENUM: Active | Revoked                     │
├───────────────────────────────────────────────────────────────┤
│  UNIQUE (patient_id, clinic_id)                                 │
│  INDEX (patient_id, status) -- fast "which clinics can see X"   │
│  INDEX (clinic_id, status)  -- fast "which patients can Y see"  │
└───────────────────────────────────────────────────────────────┘
```

Granted automatically the first time a patient books/checks in at a clinic
(first appointment, first lab order, etc. — hook into the existing
appointment-creation flow rather than adding a manual step). Revocation is a
manual admin action (e.g. patient requests a clinic be cut off) — soft
delete via `status`/`revoked_at`, never hard-delete the row (audit trail).

### 6.3 Per-encrypted-column storage shape

Each encrypted column doesn't stay a plain `VARCHAR`/`TEXT` — it becomes a
small JSON envelope (or three sibling columns, see note) so decrypt has
everything it needs:

```json
{ "iv": "base64...", "authTag": "base64...", "ciphertext": "base64..." }
```

Prefer **one JSONB column per encrypted field** over three separate
`_iv`/`_tag`/_cipher` columns — keeps migrations simpler when adding new
encrypted fields, and Postgres JSONB indexing isn't needed here since we
never query into these fields.

---

## 7. Code Structure (follows existing module conventions)

New module: `src/main/patientCrypto/` (or `src/utils/patientCrypto/` if it's
considered infra rather than a feature — treat it as infra since no routes
are needed, only a service consumed by other modules).

```
src/utils/patientCrypto/
  kmsClient.ts          -- thin wrapper around AWS SDK KMS client
                            (GenerateDataKey, Decrypt), config from envConfig.ts
  dek.service.ts         -- getOrCreateDekForPatient(patientId) → plaintext DEK
                            (calls KMS GenerateDataKey once, persists encrypted_dek).
                            CACHING RULE (see §9): the returned plaintext DEK is
                            held ONLY on the request-scoped context object (e.g.
                            attached to `req`, or a per-call memo passed down the
                            service chain) so repeated field decrypts within the
                            same request reuse it instead of re-calling KMS. It
                            MUST NOT be written to Redis, an in-process LRU/shared
                            cache, a log, or any persistent store — it is
                            discarded when the request ends and re-fetched via
                            kms:Decrypt on the next request.
  aesField.ts            -- encryptField(plaintext, dek) / decryptField(envelope, dek)
                            (AES-256-GCM, same primitive as mfaCrypto.ts)
  accessControl.ts       -- assertClinicHasAccess(patientId, clinicId) — throws
                            HttpError(403, ...) if no active patient_clinic_access row
  patientCrypto.service.ts -- public API: encryptPatientField(...) /
                            decryptPatientField(...) — the only entrypoint other
                            modules should import; wraps DEK fetch + access check
                            + AES call together so callers can't skip a step
```

Consuming modules (e.g. `patient`, `appointments`, `reports`, `lab`) call
`patientCrypto.service.ts` from their `services/` layer when reading/writing
the sensitive columns — never from controllers directly, matching the
existing controller → service → model layering.

`envConfig.ts` gains: `AWS_REGION`, `AWS_KMS_KEY_ID` (CMK ARN/alias), and
whatever IAM credential mechanism ops decides on (IAM role on the ECS/EC2
instance is preferred over static access keys — avoids another secret to
rotate).

---

## 8. Migration Strategy

Rolling out on live data needs a backfill, not a big-bang cutover:

1. **Add columns/tables** (dual-write phase): add `patient_data_keys`,
   `patient_clinic_access`, and new JSONB envelope columns alongside the
   existing plaintext columns (don't drop plaintext yet).
2. **Backfill `patient_clinic_access`**: derive initial grants from existing
   appointment/lab-order history (any clinic a patient has an existing
   appointment/order with gets an `Active` grant, `granted_by` = system).
3. **Backfill encryption**: a one-off script (`src/scripts/` or a Kafka-
   driven batch job, following the pattern of other cron/batch jobs in
   `src/cron/jobs/`) that, per patient: mints a DEK via KMS, encrypts each
   plaintext column into its sibling envelope column, leaves the plaintext
   column in place.
4. **Cut over reads**: switch service-layer reads to the encrypted column
   behind a feature flag (per `subscriptionAccess`/`limitation` middleware
   pattern already used for gated rollouts) so it can be reverted instantly
   if decrypt errors spike.
5. **Stop writes to plaintext**: once reads are stable, controllers/services
   write only to the encrypted column.
6. **Drop plaintext columns**: a tracked migration (staging first, prod via
   tag release per the existing `db:migrate:*` pipeline) once confidence is
   high and enough time has passed to rule out rollback need.

Each phase is its own PR/migration — do not combine schema-add and
plaintext-drop in one migration.

---

## 9. Operational Notes

- **Key rotation**: rotating the KMS CMK (automatic annual rotation, AWS-
  managed) does *not* require touching any `patient_data_keys` row — KMS
  transparently re-wraps under the new key material on next `Decrypt` call.
  Rotating an individual patient's *DEK* (e.g. suspected compromise) means:
  generate a new DEK, re-encrypt just that patient's columns, update
  `encrypted_dek`/`rotated_at` — same backfill-script pattern as §8 step 3,
  scoped to one patient.
- **Performance — DEK is request-scoped only, never shared across requests**:
  KMS `Decrypt` adds network latency (~10-20ms) per call. A patient's DEK is
  fetched **at most once per request** (e.g. once per `GET /patient/:id`
  call, reused for every field on that response) and held only for the
  lifetime of that request — passed down the service call chain (or
  attached to the request context), never written to Redis, an in-process
  cache shared across requests, or any persistent store. This is a
  deliberate security boundary, not just a performance detail: a plaintext
  DEK that outlives its request is a plaintext key sitting in memory a
  process compromise or memory dump could recover, for every patient it
  was ever fetched for, instead of just the one request in flight. For a
  list endpoint returning many patients, batch-fetch each patient's DEK
  once at the start of that same request (still request-scoped, just
  covering N patients instead of 1) rather than per-row inside a loop that
  might re-fetch.
- **Audit logging — two layers, not one**:
  - *Infrastructure layer*: AWS CloudTrail logs every `kms:GenerateDataKey`/
    `kms:Decrypt` call automatically (caller identity/IAM role, key ID,
    timestamp, encryption context) — no extra code needed, but it only
    proves "a decrypt happened," not "which patient record a human
    actually viewed," since one request can touch several fields under one
    Decrypt call.
  - *Application layer* (new — this is the layer that actually answers "who
    looked at this patient's data and why"): every call through
    `patientCrypto.service.ts` writes a row to a new `patient_data_audit_log`
    table (or emits a Kafka event consumed into one, following the existing
    `notification.consumer.ts` pattern, if synchronous writes on the hot
    decrypt path are a latency concern):

    ```
    ┌───────────────────────────────────────────────────────────────┐
    │              patient_data_audit_log  (NEW)                     │
    ├───────────────────────────────────────────────────────────────┤
    │  id              UUID PK                                       │
    │  user_id         UUID FK → users.id  (who performed the action) │
    │  clinic_id       UUID FK → clinics.id                          │
    │  patient_id      UUID FK → users.id                            │
    │  action          ENUM: View | Update | Delete | Export          │
    │  resource        VARCHAR  -- e.g. "report_cards.clinicalNotes"  │
    │  ip_address      VARCHAR NULL                                   │
    │  user_agent      TEXT NULL  -- device/client info               │
    │  created_at      TIMESTAMP                                     │
    ├───────────────────────────────────────────────────────────────┤
    │  INDEX (patient_id, created_at)  -- "who accessed my record"   │
    │  INDEX (user_id, created_at)     -- staff activity audit        │
    └───────────────────────────────────────────────────────────────┘
    ```

    Write this row on every `View`/`Update`/`Delete`/`Export` that flows
    through the crypto service — not just on decrypt failures — since
    HIPAA's audit-control requirement (§164.312(b)) and GDPR accountability
    (Art. 5(2)) both expect a record of legitimate access, not only
    exceptions. `ip_address`/`user_agent` are optional (populate from
    `req` when available) — useful for anomaly detection (e.g. same user
    account, new IP, bulk export) but not required for every internal
    service-to-service call. Never log the plaintext field value itself
    into this table — `resource` names *which* field was touched, not its
    content.
  - Never log plaintext DEKs, decrypted field values, or raw KMS response
    bodies in application logs (Winston/whatever logger is in use) — the
    audit table above is the only place "an access happened" gets recorded,
    and it never carries the decrypted content itself.
- **GDPR erasure via crypto-shredding**: healthcare records often can't be
  hard-deleted (retention laws require keeping clinical history), which
  seems to conflict with GDPR's right to erasure. Deleting the *DEK* in
  `patient_data_keys` (not the encrypted rows) makes all of that patient's
  ciphertext permanently unrecoverable — satisfies "erase the personal
  data" in a cryptographic sense while leaving the (now-unreadable)
  clinical row in place for retention/legal-hold purposes. Confirm with
  legal whether this satisfies your specific erasure obligations before
  relying on it as *the* erasure mechanism — flagged here as a known
  pattern, not a legal conclusion.
- **Least-privilege IAM for the CMK**: the app's IAM role/policy should only
  be granted `kms:GenerateDataKey` and `kms:Decrypt` on the specific CMK
  (never `kms:*` or account-wide key access), and KMS key policy should
  restrict `Decrypt` to that role alone — a compromised app server should
  not be able to use the CMK to decrypt unrelated secrets (e.g. the MFA
  key, if a separate CMK isn't used for that — recommend a **separate CMK
  per data class**: one for patient PHI, one for MFA, rather than reusing
  a single account CMK for everything, so a policy/scope mistake on one
  doesn't expose the other).
- **Testing**: local/dev/test envs should NOT hit real AWS KMS. Use
  `@aws-sdk/client-kms` against LocalStack, or a mock KMS client behind the
  same `kmsClient.ts` interface, gated by `NODE_ENV` the same way
  `envConfig.ts` already branches `DEV_DB_*`/`STAGING_DB_*`/`PROD_DB_*`.

---

## 10. Open Questions (need a decision before implementation starts)

1. Should `age`/`gender` be encrypted? They're low-sensitivity individually
   but combine with other fields for re-identification — legal/compliance
   call, not an engineering one.
2. Payment fields (`appointment_payments`, `lab_invoices`) — same envelope
   scheme, or a separate PCI-scoped key policy? Recommend separate, since
   payment data has different retention/compliance rules than clinical PHI.
3. Who can call the manual "revoke clinic access" action — Super_Admin only,
   or can a Clinic Admin revoke their own clinic's access to a patient (self-
   revoke), or can the patient themselves request it via the patient portal?
4. File-based PHI (`reportDocs`, `prescriptionPdf`, `consentFile`,
   `patient_gallery.imageUrl`) — this plan covers column-level encryption
   only; those need S3-SSE-KMS at the bucket/object level, ideally using the
   *same* CMK for consistency, tracked as a follow-on, not blocking this plan.
5. Does compliance actually require `email`/`mobile` to be unreadable at
   rest (vs. access-controlled + encrypted-at-the-disk-level via RDS/EBS
   encryption, which every column already gets regardless of this plan)? If
   yes, this is the trigger to build the blind-index design from §5.1 —
   otherwise recommend leaving them plaintext-in-column as decided above.
6. Does any current or planned analytics/dashboard feature need to query or
   trend on `lab_order_result_values.value` in ways that would break if it
   were ever encrypted later (§5.2)? Confirms the plaintext decision won't
   need to be revisited once those features are built.
7. Should the `patient_data_audit_log` (§9) retention period differ from the
   underlying clinical record's retention period? Audit logs are often kept
   *longer* than the data they describe under HIPAA/GDPR accountability
   expectations — needs a retention policy decision, not just a table.

---

## 11. Appendix — Consolidated Model/Field List (planning reference)

Confirmed by a repo-wide check (Aadhaar/PAN/insurance/emergency-contact/bank-
account patterns) — no other patient-linked sensitive fields exist beyond
what's listed below. Any bank/account fields found elsewhere belong to
clinics/suppliers, not patients, and are out of scope for this plan.

### 11.1 Existing models — fields to encrypt

| Module | Model file | Table | Fields to encrypt |
|---|---|---|---|
| users | `users/models/userProfile.model.ts` | `user_profiles` | `address`, `city`, `state`, `zipCode`, `dob`, `bloodGroup`, `height`, `weight`, `allergies`, `chronicConditions` |
| appointments | `appointments/models/appointmentClinical.model.ts` | `appointment_clinical_data` | `commonSymptoms`, `appointmentNotes`, `vitals`, `referrals`, `consentNotes` |
| appointments | `appointments/models/medicalCertificate.model.ts` | `medical_certificate` | `medicalCondition`, `notes` |
| appointments | `appointments/models/doctorManualPrescription.model.ts` | `doctor_manual_prescription` | `doctorManualPrescription` |
| reports | `reports/models/reports.model.ts` | `report_cards` | `comorbidities`, `habits`, `generalExamination`, `systemExamination`, `provisionalDiagnosis`, `differentialDiagnosis`, `finalDiagnosis`, `investigations`, `advice`, `clinicalNotes`, `allergies`, `surgerySuggested`, `visitingNotes` |
| reports | `reports/models/reports.model.ts` | `prescriptions` | `composition`, `dosage`, `frequency`, `notes` |
| lab | `lab/models/labResult.model.ts` | `lab_order_results` / `lab_order_result_values` | `remarks` only (`value`/`flag` stay plaintext — analytics, §5.2) |
| lab/test | `test/models/labOrder.model.ts` | `independent_patients` | `name` only (`mobile` stays plaintext — lookup key, §5.1) |

**Deliberately excluded**: `users.email`/`mobile` (login/OTP lookup key,
§5.1), all FKs/enums/statuses, payment fields (separate PCI-adjacent scope),
file URLs/paths (need S3-SSE-KMS at the object level, not column
encryption — §10.4).

### 11.2 New schema — not yet created, required by this plan itself

These aren't existing patient tables — they're new infrastructure the
encryption/access-control system needs to function (full specs in §6/§9):

1. **`patient_data_keys`** — one row per patient; holds the KMS-wrapped DEK.
2. **`patient_clinic_access`** — the ACL gating decrypt access per clinic.
3. **`patient_data_audit_log`** — application-level audit trail of
   View/Update/Delete/Export actions.

Status: identification only — no model/migration files exist yet. Model
files are to be created once §10's open questions are resolved and the list
above is signed off, following the existing Drizzle conventions in
`src/main/*/models/` (e.g. `mfa/models/mfa.model.ts` as the closest existing
reference for an encrypted-secret-holding table).
