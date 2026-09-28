# File Storage Privacy — Overview

Status: **Decided / not yet implemented.**

This is a plain-language summary for anyone who needs the "what and why"
without file paths or code details. For the full technical plan, see
`S3_PRIVATE_MIGRATION_PLAN.md`.

This also answers one of the open questions left in
`PATIENT_DATA_ENCRYPTION_OVERVIEW.md` — "should protection extend to
uploaded files, not just database fields?" It should, and this is how.

---

## The problem

Every file the system stores — prescriptions, lab reports, consent forms,
patient images, clinic logos — currently sits behind a permanent public
web address. Anyone who has that address can open the file: no login, no
expiry, no record of who looked.

Those addresses are not secret in practice. They travel in browser
history, in server logs, in support tickets, in anything a staff member
copies and pastes. Once one escapes, it works forever and for everyone.

Separately, files are not organised by clinic. Two clinics' prescriptions
sit side by side in the same folder, distinguishable only by looking them
up in the database. Nothing in storage itself knows which clinic a file
belongs to, so there is no way to express "give this clinic its files" or
"remove this clinic's files" as a single operation.

## The approach, in plain terms

Two separate concerns, kept separate:

1. **Nothing is readable without asking.** The storage bucket stops
   serving files to the public entirely. To view a file, the application
   issues a short-lived, single-file pass. The pass expires on its own;
   there is no permanent address to leak any more.
2. **Files are filed under the clinic that owns them.** New uploads are
   stored in a per-clinic location, so the owner is readable from where
   the file sits, not from a database lookup.

The second part is what makes the first part cheap. When the file's
location already names its clinic, checking "is this caller allowed to
see this?" is a direct comparison. Without it, every kind of file needs
its own ownership lookup — a different one per file type, and each one is
a place where someone can forget the check.

## Why not simpler alternatives

- **Leave it public but use unguessable names.** This is roughly the
  situation today, and it is security by obscurity: one leaked address is
  a permanent leak, and there is still no record of access.
- **Route every file through the application itself.** Strongest option —
  no shareable address ever exists. But every report download then
  consumes the application's bandwidth and holds a connection open for
  its duration, which is a real cost on large PDFs.
- **Put a content delivery network in front of it.** The right answer at
  larger scale, and it would bring caching benefits too. It is also a
  meaningful amount of new infrastructure to run and pay for, which is
  hard to justify before there is a volume problem to solve.

Short-lived passes give most of the protection of routing everything
through the application, at a fraction of the running cost, using
mechanisms already present in the system.

## How files are treated differently

Not all files carry the same risk, and treating them identically would
mean either weak protection or a frustrating experience.

- **Clinical documents** — prescriptions, lab reports, consent forms,
  pharmacy invoices. The pass is issued at the moment someone clicks to
  open the file, and lasts minutes. It is never handed out in advance, so
  it cannot sit unused in a cached page or in browser history.
- **Interface imagery** — clinic logos, profile pictures, banners,
  gallery images. These appear on screen constantly, so their passes are
  issued with the page and last hours. They are lower sensitivity, and a
  short expiry here would simply mean images breaking while someone has a
  page open.
- **Brand assets** — the product logo and similar fixed artwork. These
  stop living in file storage altogether and ship with the application.
  They are not anyone's data, and keeping them in storage would mean
  keeping a public door open for them.

## How it will behave

**For clinic staff and patients, almost nothing changes.** Images appear
exactly as they do now. Opening a report works the same way. The
difference is invisible in normal use, which is the intent.

What does change:

- **A copied file address stops working.** Pasting a report link into a
  chat or an email will work for the recipient only briefly, then stop.
  Sharing a document with someone now means sharing it through the
  system, not by forwarding a link.
- **Files cannot be opened while logged out.** An address that used to
  work in any browser now requires an active session to obtain a pass.
- **Very old passes expire mid-session.** Someone who leaves a page open
  overnight may find an image no longer loads until they refresh. This is
  why interface imagery gets hours rather than minutes.
- **Generated PDFs keep their logos.** They would otherwise lose them
  silently, which is the single most likely way this change could go
  wrong unnoticed. It is handled explicitly and early.

**For the mobile app, nothing changes until the final step.** A pass is
still just a web address as far as the app is concerned, so existing
installed versions keep working throughout. Only the last stage requires
an app release, and users are moved onto it with the existing forced
update mechanism rather than by guesswork.

## Rollout shape (not a step-by-step plan)

Deliberately gradual, and ordered so that the risky step is last:

1. Make the storage recoverable first — today there is no undo on
   anything, which has to change before any of this begins.
2. Move fixed brand artwork out of storage, so nothing outside the system
   depends on public access any more.
3. Start issuing passes while the bucket is still public. Nothing breaks
   yet; the new path is proven while the old one still works.
4. Begin filing new uploads under their clinic. Existing files stay where
   they are.
5. Close public access. By this point every consumer is already using
   passes, so this should be uneventful.
6. Release the mobile app update and retire the last of the old
   behaviour.

## What existing files do and do not get

**Nothing is moved, re-uploaded or converted.** There is no data migration
step anywhere in this work, and no downtime. Existing files and existing
records are read exactly as they are today; only the way they are handed
to a browser changes.

Files uploaded before this change keep their current location, because
moving roughly sixteen hundred live files carries more risk than it
removes. They **do** stop being publicly readable — that is the main
protection, and they get it in full.

What they do not get is the per-clinic filing. They remain protected by
pass-and-expiry rather than by ownership, until and unless they are
migrated later. That migration is a separate decision, worth making only
if per-clinic export or deletion becomes a real requirement.

## Open questions

- Should there be a record of who viewed which clinical document, as the
  encryption work proposes for database fields? Nothing here creates one
  yet.
- Should patients be able to share their own reports outward — and if so,
  through a deliberate sharing feature rather than a leaked address?
- How long should a document pass last? Minutes is the proposal; if staff
  routinely open a report and return to it much later, that needs
  revisiting.
- Are there integrations outside the web and mobile applications that
  hold stored file addresses? A partner system doing so would need
  handling before public access closes.

## Bottom line

**Stop publishing files, and start handing out short-lived passes
instead** — while filing new uploads under the clinic that owns them, so
that who-may-see-what becomes a property of where the file lives rather
than something each feature has to remember to check.
