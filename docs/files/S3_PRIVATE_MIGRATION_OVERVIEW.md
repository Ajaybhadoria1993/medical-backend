# File Storage Privacy — Overview

Status: **Partly built.** Revised 2026-09-24.

The application-side work is written: files are signed on the way out,
documents are fetched on click, new uploads are filed per clinic and checked
for type and size. What remains is creating the new storage area and pointing
the application at it. None of it has been exercised against a running system
yet.

**Scope narrowed 2026-09-24.** Files already stored are deliberately left as
they are — still public, not moved. Only uploads from the cutover onward are
protected. See "What happens to files already stored".

This is a plain-language summary for anyone who needs the "what and why"
without file paths or code details. For the full technical plan, see
`S3_PRIVATE_MIGRATION_PLAN.md`.

This also answers one of the open questions left in
`PATIENT_DATA_ENCRYPTION_OVERVIEW.md` — "should protection extend to uploaded
files, not just database fields?" It should, and this is how.

---

## The problem

Every file the system stores — prescriptions, lab reports, consent forms,
patient images, clinic logos — currently sits behind a permanent public web
address. Anyone who has that address can open the file: no login, no expiry,
no record of who looked.

Those addresses are not secret in practice. They travel in browser history, in
server logs, in support tickets, in anything a staff member copies and pastes.
Once one escapes, it works forever and for everyone.

Separately, files are not organised by clinic. Two clinics' prescriptions sit
side by side in the same folder, distinguishable only by looking them up in
the database. Nothing in storage itself knows which clinic a file belongs to,
so there is no way to express "give this clinic its files" or "remove this
clinic's files" as a single operation.

Two upload endpoints are also open to the internet with no login required.
That is a separate and more urgent problem, fixed first.

## The approach, in plain terms

**Start a new, private storage area rather than converting the existing one.**

1. **A new private area.** Closed to the public from the moment it is created.
   To view a file, the application issues a short-lived pass that expires on
   its own. There is no permanent address to leak.
2. **Everything new goes there**, filed under the clinic that owns it, so the
   owner is readable from where the file sits rather than from a database
   lookup.
3. **The existing area is left exactly as it is** — same contents, still
   public. Nothing is moved, and nothing is closed.

The second point is what makes the first affordable. When a file location
already names its clinic, checking "is this caller allowed to see this?" is a
direct comparison. Without it, every kind of file needs its own ownership
lookup — a different one per file type, and each one is a place where someone
can forget the check.

## Why a new area instead of closing the existing one

**It removes the riskiest moment.** Switching a live, in-use storage area from
public to private is a single irreversible action affecting everything at
once. A new area is private from creation, so that moment never arrives.

**It needs no migration.** The existing files are not copied, not rewritten
and not deleted. Switching over is a single configuration change, and nothing
already stored is disturbed by it.

## Why not simpler alternatives

- **Leave it public but use unguessable names.** Roughly the situation today,
  and it is security by obscurity: one leaked address is a permanent leak, and
  there is still no record of access.
- **Route every file through the application itself.** Strongest option — no
  shareable address ever exists. But every report download then consumes the
  application's bandwidth and holds a connection open for its duration.
- **Put a content delivery network in front of it.** The right answer at
  larger scale, with caching benefits too. Also a meaningful amount of new
  infrastructure to run and pay for, hard to justify before there is a volume
  problem to solve.

Short-lived passes give most of the protection of routing everything through
the application, at a fraction of the running cost, using mechanisms already
present in the system.

## How files are treated differently

Not all files carry the same risk, and treating them identically would mean
either weak protection or a frustrating experience.

- **Clinical documents** — prescriptions, lab reports, consent forms, pharmacy
  invoices. The pass is issued at the moment someone clicks to open the file,
  and lasts minutes. It is never handed out in advance, so it cannot sit
  unused in a cached page or in browser history.
- **Interface imagery** — clinic logos, profile pictures, banners, gallery
  images. These appear on screen constantly, so their passes are issued with
  the page and last hours. They are lower sensitivity, and a short expiry here
  would simply mean images breaking while someone has a page open.
- **Company artwork** — the product logo and similar fixed pieces. These stay
  in the existing public area, unchanged. They are not anyone's data, and
  they appear in documents sent to patients, so they need no pass at all.

## How it will behave

**For clinic staff and patients, almost nothing changes.** Images appear
exactly as they do now. Opening a report works the same way. The difference is
invisible in normal use, which is the intent.

What does change:

- **A copied file address stops working.** Pasting a report link into a chat
  or an email will work for the recipient only briefly, then stop. Sharing a
  document with someone now means sharing it through the system, not by
  forwarding a link.
- **A saved address stops working on its own.** One that used to work in any
  browser, forever, now only works for as long as its pass lasts. Pages meant
  to be seen without logging in — the public doctor profile, for instance —
  keep working, because the system issues their passes for them.
- **Very old passes expire mid-session.** Someone who leaves a page open
  overnight may find an image no longer loads until they refresh. This is why
  interface imagery gets hours rather than minutes.
- **Generated PDFs keep their logos.** They would otherwise lose them
  silently, which is the single most likely way this change could go wrong
  unnoticed. It is handled explicitly and early.

**Anyone holding a live pass can use it.** The system checks that the pass is
valid, not who is presenting it. A pass forwarded to someone else works until
it expires, and it cannot be cancelled early. That is why clinical documents
get minutes rather than hours — the short window is the protection.

**For the mobile app, nothing changes until the final step.** A pass is still
just a web address as far as the app is concerned, so existing installed
versions keep working throughout. Only the last stage requires an app release,
and users are moved onto it with the existing forced update mechanism rather
than by guesswork.

## Rollout shape (not a step-by-step plan)

Deliberately gradual, and ordered so that nothing irreversible happens early:

1. ~~Remove the two upload endpoints open to the internet.~~ **Done.**
2. ~~Start issuing passes.~~ **Done** — nothing breaks; the new path works
   against the existing storage while it is still open.
3. ~~File new uploads under their clinic.~~ **Done**, pointing at the current
   storage until the new area exists.
4. Create the new private storage area, configured correctly from the start.
5. Point the application at it. One configuration change; from that moment
   every new upload is private.
6. Release the mobile app update and retire the last of the old behaviour.

Steps 1 to 3 are written but not yet exercised against a running system.
Steps 4 and 5 are storage work that has not started.

There is no step that moves or closes the existing storage. That is the
deliberate narrowing described below.

## What happens to files already stored

**Nothing. They stay where they are, and they stay public.**

This was decided deliberately on 24 September 2026, and it is worth being
plain about what it means: every prescription, lab report and consent form
uploaded before the cutover remains readable by anyone who has, or guesses,
its address. Permanently.

**Why:** moving roughly sixteen hundred files and rewriting the records that
point at them is a project in its own right, with its own risk. Stopping the
exposure from growing was judged the thing worth having now. It turns a
migration into a configuration change.

**It can be undone cheaply, whenever you want.** Closing those files needs no
migration and no new code — a single permission change on the existing area,
keeping only the company artwork public. The option stays open indefinitely.

## Future scope — charging clinics for storage

**Not part of this work and not scheduled.** Noted because it was raised
during planning.

The idea is to measure how much storage each clinic uses and bill for it. That
only becomes possible once files are filed under the clinic that owns them —
which this work does.

One catch, following from the decision above: the sixteen hundred existing
files carry no clinic marker and are not being moved, so metering cannot see
them. Anything uploaded before the cutover would be free storage for that
clinic, permanently. Billing could still launch — it would simply start from
the cutover — but that needs saying out loud rather than discovering it in
the first invoice.

## What this does not cover

This closes the largest gap. It is not a complete clinical data protection
programme, and the difference is worth stating.

- **No record of who viewed a document.** The system will know a pass was
  issued, not that it was used or by whom. Storage-level logging was
  considered and deliberately deferred — nothing in the application depends on
  it, and there is no such record today either.
- **No malware scanning on upload.** File types and sizes will finally be
  checked, which blocks the obvious cases, but files are not scanned.
- **No protection against accidental deletion.** Keeping old copies of files
  was deferred too, for cost reasons. A deleted or overwritten file is gone.
  This is also the position today, and it can be switched on later at any
  time — but only protects from the day it is enabled.
- **No enforced retention.** Nothing yet prevents a record being deleted
  early. That needs a decision on how long clinical records must be kept,
  which is a legal question rather than a technical one.

## Bottom line

**Stop publishing files, and start handing out short-lived passes instead** —
in a new storage area that is private from the day it is created, with every
file filed under the clinic that owns it, so that who-may-see-what becomes a
property of where the file lives rather than something each feature has to
remember to check.
