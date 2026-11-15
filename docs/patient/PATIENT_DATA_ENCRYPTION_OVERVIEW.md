# Patient Data Encryption — Overview

Status: **Proposed / not yet implemented.**

This is a plain-language summary for anyone who needs the "what and why"
without schema or code details. For the full technical plan, see
`PATIENT_DATA_ENCRYPTION_PLAN.md`.

---

## The problem

Patients can be seen at more than one clinic, but their medical record is
one shared record, not a separate copy per clinic. If we protect that
record by giving each clinic its own encryption key, we end up either
duplicating the patient's data per clinic, or re-scrambling the same record
every time a new clinic is granted access — both are fragile and expensive
at scale.

We need a way to keep **one protected copy of each patient's sensitive
data**, while still controlling, clinic by clinic, who is allowed to see it.

## The approach, in plain terms

Two separate concerns, kept separate:

1. **Protecting the data** — each patient's sensitive information is
   locked with its own key. That key is itself locked away by a managed
   cloud key service (AWS KMS), so the "key to the key" never has to be
   stored or handled directly by our application.
2. **Controlling who can unlock it** — a simple access list says which
   clinics currently have permission to view a given patient's record.
   Granting or revoking a clinic's access is just adding or removing an
   entry on that list — it never requires touching or re-locking the
   underlying data.

This separation is the whole point: access can change constantly (a
patient switches clinics, a clinic is removed) without ever needing to
re-protect the data itself.

## Why not simpler alternatives

- **One key per clinic** — means either copying patient data per clinic
  (drift, duplication, sync bugs) or re-locking shared data every time
  access changes (slow, risky, and briefly exposes the data in the
  process).
- **One key for everything** — simplest to build, but a single leaked key
  exposes every patient at once instead of just one.

Per-patient protection with a separate access list gives the best balance:
revoking access is instant and cheap, and a worst-case key leak is limited
to one patient, not the whole system.

## What gets protected vs. what doesn't

Not all patient-related data needs this treatment. Roughly:

- **Protected**: free-text clinical content — symptoms, notes, diagnoses,
  prescriptions, medical history, clinical remarks. This is the material
  that's genuinely sensitive on its own.
- **Left as-is**: things the system needs to search, filter, or report on
  directly (dates, statuses, numeric lab values used in trends/dashboards),
  and login identifiers (mobile number, email), since those need to be
  looked up directly and can't be meaningfully "locked" without breaking
  login and search. These are lower-sensitivity in isolation and get
  standard database-level protection instead.

## How access would work day to day

- The first time a patient interacts with a clinic (books an appointment,
  gets a lab order), that clinic is automatically granted access.
- A clinic can later be manually cut off, which immediately blocks that
  clinic from viewing the patient's protected data — no data migration
  needed.
- Every time protected data is actually viewed, updated, or exported, that
  event is recorded (who, from which clinic, when) — separate from the
  cloud key service's own automatic logging — so there's a clear answer to
  "who looked at this patient's record."

## Rollout shape (not a step-by-step plan)

This would be introduced gradually, not as a single switch-over:

1. Build the new protection and access-list machinery alongside existing
   data, without touching what's already there.
2. Backfill access grants from existing appointment/lab history, so
   current clinic relationships aren't disrupted.
3. Backfill-protect existing records in the background.
4. Switch reads over first, with an easy way to revert if problems show up.
5. Switch writes over once reads are stable.
6. Retire the old unprotected copies only after enough confidence and time
   has passed.

## Open questions (need a business/legal decision, not an engineering one)

- Should low-sensitivity identifying details (age, gender) also be
  protected, given they can help re-identify someone in combination?
- Do payment records need the same treatment, or a separate policy?
- Who is allowed to revoke a clinic's access — platform admins only, the
  clinic itself, or the patient directly?
- Should protection extend to uploaded files (reports, prescriptions), not
  just database fields?
- Do login identifiers (mobile/email) need stronger protection than
  today, or is current database-level protection sufficient?
- How long should the "who accessed what" audit history be kept?

## Bottom line

The core idea is simple even though the implementation isn't: **protect
each patient's data once, and manage who can see it through a separate,
easily changeable permission list** — rather than tying protection and
access together.
