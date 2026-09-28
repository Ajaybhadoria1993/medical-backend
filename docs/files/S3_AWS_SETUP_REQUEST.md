# S3 Setup Request — `infinity-medisetu-private`

For whoever holds IAM admin. Bucket already created in **ap-south-1**; these
are the permission changes it still needs. Written 2026-09-24.

> ## ⚠️ Do not change anything on `infninity-medisatu`
>
> The old bucket stays public, exactly as it is. Making it private would
> immediately break every clinic logo, every patient image, and the logo on
> every generated invoice and report PDF — silently, with no error shown
> anywhere. This is a deliberate decision, not an oversight.

---

## Step 1 — Bucket permissions

**S3 → `infinity-medisetu-private` → Permissions tab**

**1a.** Confirm **Block all public access = On**

**1b.** Under **Bucket policy**, click Edit and paste this (forces HTTPS only):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::infinity-medisetu-private",
        "arn:aws:s3:::infinity-medisetu-private/*"
      ],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

## Step 2 — Create an IAM policy

**IAM → Policies → Create policy → JSON tab → paste → name it `MedisetuS3Access`**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "NewBucketObjectsAllEnvs",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::infinity-medisetu-private/development/*",
        "arn:aws:s3:::infinity-medisetu-private/staging/*",
        "arn:aws:s3:::infinity-medisetu-private/production/*"
      ]
    },
    {
      "Sid": "LegacyBucketReadPermanent",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::infninity-medisatu/*"
    },
    {
      "Sid": "ListBoth",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::infinity-medisetu-private",
        "arn:aws:s3:::infninity-medisatu"
      ]
    }
  ]
}
```

## Step 3 — Update the user `s3user_IMS`

**IAM → Users → `s3user_IMS` → Permissions**

1. Attach the new `MedisetuS3Access` policy
2. Remove the existing `s3:*` policy

This last step is the important one — the change has no effect until `s3:*` is
removed.

Before removing it, confirm no other script or job uses this user's access key.
The application only reads and writes objects, so anything doing bucket-level
operations with these credentials would stop working.

---

## Notes

- **`LegacyBucketReadPermanent` is permanent, not transitional.** Existing
  database rows carry full URLs pointing at the old bucket and always will, so
  the app needs read access there indefinitely.
- **Encryption needs no action.** AWS applies SSE-S3 by default on new buckets.
- **All three environments share this bucket**, separated by the `{env}/`
  prefix, and share this one IAM user. A developer running locally can
  therefore read and delete production files. Accepted for now — splitting
  into three IAM users later is a policy change only, no code change.
- **Deliberately skipped:** versioning, both lifecycle rules, and object-level
  access logging. Reasoning is recorded under Step 0 of
  `S3_PRIVATE_MIGRATION_PLAN.md`. None of it blocks this work.

Once the above is applied, the switchover is one environment variable on our
side (`{ENV}_AWS_BUCKET_NAME`). Nothing in the running application changes
until then.
