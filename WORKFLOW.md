# WORKFLOW.md

How a task gets executed in this workspace. `CLAUDE.md` says what the code **is**;
the two standards playbooks say how code is **written**; this file says how work is
**run** — read order, when to ask, what "done" means, and what never happens without
being asked.

Applies to every task in `InfinityMedisetu_BE/` and `InfinityMedisetuWeb_FE/`.

**This file is maintained continuously, not written once** — §7 is the standing
obligation to capture each new rule as it earns its place, and to delete the ones
that stop applying.

---

## 1. The rule set, in precedence order

Later entries win over earlier ones on any conflict.

| # | Source | Covers |
|---|---|---|
| 1 | Root `CLAUDE.md` | Cross-repo shape, deploy environments, architecture |
| 2 | Sub-repo `CLAUDE.md` | That repo's commands, architecture, traps |
| 3 | `docs/playbook/FRONTEND_STANDARDS.md` / `BACKEND_STANDARDS.md` | **The code rules.** Structure, naming, types, responses, tenancy, a11y |
| 4 | This file | How the task is run |
| 5 | The user, in the current conversation | Everything |

**There are exactly two standards docs — one per repo. Never create a third.**
A new rule goes in the right section of the existing file. The FE playbook already
replaced six drifting docs; the failure mode is documented, don't repeat it.

---

## 2. Before writing any code

1. **Read the standards file for the repo you're touching** — FE work reads
   `FRONTEND_STANDARDS.md`, BE work reads `BACKEND_STANDARDS.md`. Not optional,
   not "if the change looks big".
2. **Check `docs/`** — most subsystems have a write-up. Read it before
   re-deriving how the thing works from source.
3. **Look for what already exists.** A helper, hook, type, primitive, or Zod
   schema that already lives here is the answer. Re-implementing something that
   sits a few files over is the most common defect in this codebase.
4. **Trace the real flow end to end** before choosing where to edit. For a
   feature, that means the FE/BE folder pair, not just the file named in the ask.

Understanding is never the thing that gets shortened. The smallest diff in the
wrong place is a second bug, not a fast fix.

---

## 3. Scope

**Do what was asked. Not less, not more.**

- Fix the **root cause**, not the symptom. Before editing a shared function,
  grep its callers — one guard in the shared path is a smaller diff than a guard
  in each caller, and patching only the reported path leaves the siblings broken.
- **No unrequested refactors.** Noticed something bad next to your change?
  Mention it, don't fix it. Cleanups land as their own commit.
- **Fix what you touch, don't go hunting.** The backlogs in the playbooks
  (hand-rolled responses, `any`, `console.log`, oversized services) are fix-forward
  policy — convert a file when you're already editing it. Never a sweep.
- A cleanup PR spanning hundreds of files is unreviewable, so real bugs hide in
  it. In a clinical system an unnecessary diff carries risk a stale line doesn't.

If part of the scope turns out to be blocked, finish everything else and say
plainly what was left and why. Scaling the work down is the user's call.

---

## 4. Ask vs. proceed

**Proceed** on routine judgment calls — naming, which existing helper to reuse,
where a file goes under the documented structure. State the assumption and move.

**Ask first** when:

- Two readings of the request lead to materially different work.
- The change alters an API contract the other repo consumes.
- It touches auth, tenancy filtering, payments, or prescription data.
- It would delete or rewrite something you didn't write.

**Never without being asked:**

- **Generate or apply DB migrations.** Write the model change and stop —
  migrations are the repo owner's (BE §7).
- **Run the full Jest suite.** It hangs the machine. One file only (BE §12).
- **Run `npm run build` or a full `tsc -b` as a routine check.** Minutes each,
  for something the IDE already covers — see §5 for the cases that justify it.
- **Run Prettier on the frontend.** That repo has no Prettier config; it reflows
  every file against the codebase's long-line style (FE §7).
- **Commit, push, tag, or deploy.** The owner commits by hand; end the task with
  one commit message covering every repo touched, and never run `git commit`.
- **Change what fails a build** — flipping an ESLint rule from `warn` to `error`
  is a policy decision, deliberately left pending in both playbooks.

---

## 5. Definition of done

A task is done when the repo's own review checklist passes — **FE §16**,
**BE §15**. Run it; don't summarise it from memory.

### Per-task gates (run these)

| | Frontend | Backend |
|---|---|---|
| Lint | `npx eslint <changed files>`, **no new warnings** | `npx eslint <changed files>` clean |
| Types | IDE diagnostics on the changed files | IDE diagnostics on the changed files |
| Tests | none configured | the one relevant test file, never the suite |
| Real check | **opened in a browser** — click-through, one keyboard-only pass, one dark-mode pass | endpoint hit against a running server |

**Lint the changed files, not the repo.** `eslint .` walks 1,163 FE files to
report warnings in files you never touched. Scope it to the diff.

### Banned commands

**Do not run these. Ever, unless the user asks for them by name in the current
message.** This is a prohibition, not a preference — there is no "the change felt
big enough" exception, and no judgment call to make.

```
npm run build          # FE: ~2-3 min, every time
npx tsc -b             # FE: 2m41s cold, 2m08s warm — measured, not estimated
tsc -b                 # same thing
npm run typecheck      # BE: 1m45s cold
npx jest               # BE: hangs the machine
prettier               # FE has no Prettier config — reflows every file
```

The IDE already type-checks the files you edited, live, and reports diagnostics
straight back to me after every edit. Running a full build to learn what the IDE
already told me is pure waiting.

**If a type change feels cross-cutting** — a shared `src/types/` edit, an API
response shape, a widely-imported util — the answer is **not** a build. It is:

1. `grep` the importers and read them, or
2. ask the user to start `npm run typecheck:watch` once and leave it running
   (**22s** rebuilds on FE, **4s** on BE, per FE §14).

**The commit hook is the backstop.** `.husky/pre-commit` runs `npm run build`
already, so a type error cannot reach a commit whether or not I ran it. Running
it myself duplicates a check that is guaranteed to happen anyway.

If I genuinely think a build is warranted, I **ask first and say why** — I do not
just spend three minutes of your time and report it afterwards.

### What the gates don't prove

Typecheck proves nothing about focus order, live regions, or contrast. Compiling
proves nothing about a route that 500s. **A green BE Jest file proves nothing about
types either** — ts-jest runs with `isolatedModules`, so it transpiles without
type-checking; types still come from the IDE or `typecheck:watch`. **The real check — browser or running
server — is the one that isn't optional.** If a slow gate has to be dropped for
time, drop the build, never the real check.

Report outcomes honestly. Tests fail → say so with the output. Step skipped →
say it was skipped. Never call something verified that wasn't run.

---

## 6. The traps that bite immediately

Full lists live in the playbooks; these are the ones that cost time repeatedly.

**Frontend**
- No Prettier. Never run it.
- Types go in `src/types/<domain>/` — not inline in the component, not in a
  sibling `*Api.types.ts`.
- `slate` is inverted in dark mode and nothing else is. A `dark:bg-slate-900` is
  very likely a bug, not a fix.
- A new API slice must be registered in `apiRoot.ts` (or `store.ts`) or its
  reducer and middleware are never wired.
- Build new slices on `baseQueryWithAutoLogout.ts`, not raw `fetchBaseQuery`.
- No `src/` path alias exists — imports are relative.

**Backend**
- Every tenant-scoped query filters by `req.clinicId`/`req.labId` **from the
  token**. A missing filter leaks one clinic's patient data to another.
- Success goes through `sendOk`/`sendCreated`/`sendNoContent`; errors are
  `throw new HttpError(...)`. Never hand-roll `res.status(...).json(...)`.
- Routes are auto-discovered — a file in the right folder is enough, there is no
  central router to edit.
- Redis is not optional; an outage takes the process down. A `.env` pointing at
  a Redis that isn't running is the most common local failure.
- `src/htmltamplates/` — the spelling is intentional. Do not "fix" it.
- A token booking stores `appointmentTime = '23:59'`, not null. Identify one by
  `tokenNo != null` (or `effectiveAppointmentTime()`); a null-time test never matches.
  Hour-of-day stats must skip it too, or token clinics show a fake 11 PM peak.
- Zone-less `timestamp` columns hold IST wall clock. Bound them with
  `istDayBoundsUtc()`; `setHours(23,59,59)` reads the server's zone and loses 5h30m.
- `/queue-state` serves a 24h Redis snapshot: recalculate post-commit, **then** signal
  the queue section. Signal-first has clients refetch the old times until a reload.
  Same for caches: retire them before signalling (`signalAppointmentChange` does this for dashboards).
- `updateAppointment` recalculates the queue and signals screens only for the changes its post-commit hooks
  recognise. A token/session-only payload (moving into another shift) used to match none, so it saved silently.
  A new kind of queue-affecting edit must be added to both the `onReschedule` trigger and `rescheduled`.
- Don't import an `appointment-engine` service at module scope from another module: the engine's graph attaches the
  realtime bus on load, and any Jest suite importing that module then dies with `realtimeBus.attach is not a function`.
  Use `await import(...)` inside the function (see `doctor.service.ts`'s availability branch).
- Testing a BullMQ processor: capture it from the `Worker` mock **by queue name**
  (`calls.find(c => c[0] === 'auto-no-show')`), never `calls[0]` — seven services build a worker at import time,
  so position depends on import order and silently runs a different queue's job.
- An engine field reaches no client until `queueState.controller.ts` projects it into its response (and
  `queue.schemas.ts` declares it). `isMissedSession` was computed, cached and invisible for exactly that reason.
- Web screens refetch only on `realtimeBus.notify(target.queue…)`; nothing in the FE listens to `queue.updated`. A path that
  recomputes the queue without that signal (the per-minute tick did) leaves delays and estimates frozen until a reload.
- Revenue on dashboards uses `RECEIVED_AMOUNT` (`dashboard/utils/revenueSql.ts`), matching Payments
  History. "Already Paid" appointments still carry money (their added services); a Paid/Refunded-only
  sum dropped ₹565 on one clinic and the two screens disagreed.
- Dashboard caches (`/dashboard`, revenue-overview, today-overview, today-stats) embed a per-clinic
  version (`CacheKeys.dashboardCacheVersion`). A new write path touching appointments or payments
  must call `signalAppointmentChange` (or `invalidateClinicDashboardCaches`) after commit, or those
  screens serve its old numbers for up to the cache TTL.
- The prescription PDF prints whichever template row (`prescription_templates`, `quick_print_templates`, the two HTML
  uploads) has the newest `updatedAt`. Writing a setting to one must leave `updatedAt` alone, or it flips the active template.
- A custom-token override is saved with `sessionIndex = null` (read as session 1) and can sit above capacity. Anything
  listing a session's tokens must include it, or the desk re-offers a taken number and the create fails "already booked".
- A partial save (suggestions, translations) inserts the `doctor_preferences` row with generic column defaults. Reads go
  through `resolvePreferenceLists`, which treats a list still at that default as unset — else a Dentist loses their layout.
- `PUT /doctor` rewrites each sent day's `doctor_weekly_shift_capacity` rows from `shiftCapacities`; a sender that omits
  them deletes them, and every shift then inherits the day-wide total (50 + 50 became 100 + 100).
- `io.in(room).fetchSockets()` returns only `socket.data` for sockets on other nodes. `socketAuth` puts `{ id, name, userType }` there;
  anything else set on the socket object (`socket.user`) is invisible to a presence check.
- `clinic:{c}:doctor:{d}` rooms are joined once at connect, from a 10-min cached doctor list. A doctor added mid-shift is in no
  receptionist's room until they reconnect. Presence/targeting that must be current checks `StaffScopeService` at use time.
- `pg_trgm` is enabled by the tracked staging/prod migrations only; a dev DB can lack it (gitignored `dev/`). `similarity()`,
  `word_similarity()` and `gin_trgm_ops` then fail with `42883` — run `CREATE EXTENSION IF NOT EXISTS pg_trgm` on dev.
- The limits overview counts doctors, staff, labs and pharmacies, and is cached twice (Redis 120s, FE never expires). A write
  changing one must call `LimitationService.invalidateClinicCache` after commit and invalidate FE `Limitations`, or counts go stale.

**Both**
- Every comment ≤2 lines, JSDoc included. Comments explain **why**, not what.
- No `console.log`. No commented-out or dead code. No swallowed failures.

**This machine** (environment facts, not code rules)
- **No `python`** — the Windows Store alias intercepts it and exits 49. Use Node
  for scripting, or the Edit tool for file changes.
- **No `jq`** — parse JSON with `node -e` instead. Hook scripts must not need it.
- `eslint --format=compact` is gone from core ESLint; use the default formatter.
- `git mv` from PowerShell failed with "The system cannot find the path specified" (2026-09-15); the same command in Bash worked.
- `src/main/patient/tests/patient.service.test.ts` did not finish in 6m40s (2026-09-14) and left
  6 Jest node processes running. Don't run it as a gate; if you must, stop the leftover `jest` processes.
- Measured timings: FE `tsc -b` 2m41s cold / 2m08s warm, `typecheck:watch` 22s.
  BE typecheck 1m45s cold / 4s warm. Re-measure before quoting these as fact.

---

## 7. Keeping these rules alive

**These files are meant to grow. Every session should leave them slightly more
useful than it found them** — that is part of the work, not an extra.

### Capture a rule the moment it earns its place

When any of these happens, **write the rule down before moving on** — don't wait
to be asked:

| Signal | What it means |
|---|---|
| The user corrects me | The correction is a rule. Capture it in their words. |
| I get the same thing wrong twice | Once is a slip, twice is a missing rule. |
| Something costs real time (a slow command, a hang, a wrong path) | Cost + fix, with the measured number. |
| A trap only obvious after reading the code | The next reader won't read that code. Write it down. |
| I nearly did something destructive | Add it to §4's never-unasked list. |

Rules earn their place by having **bitten someone**. Do not invent rules for
problems that have not happened — that is how a rule set becomes noise nobody
reads.

### Where each rule goes

| Kind | Destination |
|---|---|
| How a task is run (scope, gates, banned commands) | This file |
| How code is written (structure, naming, types) | That repo's `*_STANDARDS.md`, in the matching section |
| A recurring FE bug | `FRONTEND_STANDARDS.md` §17 fix log |
| A slow or dangerous command | This file §4, **and** `.claude/hooks/block-slow-commands.js` if it can be blocked mechanically |

**Never create a new rules file.** There are exactly four (this file + two
standards + the hook). A fifth would drift out of sync, and the FE playbook
already documents that failure — it replaced six overlapping docs.

### How to write one

- **Say the cost, not the preference.** "`tsc -b` is 2m08s warm" beats "avoid
  `tsc -b`". A rule with a number attached survives arguments.
- **Measure it if you can.** Time the command, count the occurrences, name the
  file and line. Guesses become folklore.
- **One rule, one line.** If it needs a paragraph, it's two rules.
- **Say why.** A rule whose reason is lost gets deleted by the next person.

### Prune as well as add

A rule set that only grows stops being read.

- A rule that no longer applies gets **deleted**, not left "just in case".
- A completed migration's rules go with the migration.
- A doc describing a different checkout or a finished cutover is **worse than no
  doc** — it looks authoritative and misleads. Say so or delete it.
- If two files say the same thing, delete one — the copies drift, and then
  nobody knows which is current.

### Tell the user

When a rule is added, changed, or removed, say so in one line: what changed and
what triggered it. A rule the user doesn't know about can't be corrected — and
their correction is the highest-value input this file gets.

---

## 8. Changelog

Newest first. One line per rule change, with what triggered it. Append here
whenever §7 fires — this is what makes the file's growth visible.

**2026-09-16** — §6 backend trap: doctor rooms are fixed at connect. *Trigger:* a newly added doctor saw "All reception (0 online)"
while two receptionists were logged in, because they had connected before the doctor existed.

**2026-09-16** — §6 backend trap: `fetchSockets()` only carries `socket.data`. *Trigger:* the rebuilt doctor→reception call
needs "which assigned receptionists are online", but `socketAuth` had stored the user on `socket.user`, which remote sockets never expose.

**2026-09-16** — Search standard revised: every row a type-ahead can Enter-add must contain the typed text; the typo-match
rule is gone. *Trigger:* safety review — typo matching put AZITHRAL 500 MG first for `AZITHRAL 250`; user chose exact-text only.

**2026-09-16** — Predictive-search standard: BE §7 "Search endpoints" and FE §6 "Predictive search", plus a checklist
line in each. *Trigger:* user asked for a search standard after the medicine search review. Every rule has a failure behind it:
500 unranked rows, `q=_` matching all, typos below `<%`'s default, stale `data` rows reachable by Enter.

**2026-09-16** — §6 backend trap: dev DBs can lack `pg_trgm`. *Trigger:* ranked medicine search failed on dev with
`function word_similarity(unknown, character varying) does not exist`; the extension was available but never installed.

**2026-09-16** — §6 backend trap: `updateAppointment`'s post-commit hooks ignore unrecognised changes. *Trigger:*
moving a token into the evening shift saved correctly, but the row kept its morning "Missed · Shift ended" until an
unrelated queue event — the move changed neither date, time nor status, so nothing recalculated or signalled.

**2026-09-16** — §6 backend trap: import engine services lazily from other modules. *Trigger:* adding
`AppointmentEngineOrchestrator` to `doctor.service.ts` made `doctor.service.test.ts` fail to load entirely
(`realtimeBus.attach is not a function`); `await import(...)` inside the function fixed it.

**2026-09-16** — §6 backend trap: capture a BullMQ processor by queue name, not `calls[0]`. *Trigger:* a new
import reordered the graph, so the auto-no-show test drove the RunningLate worker instead — one assertion
passed for the wrong reason (it only checked something had *not* happened).

**2026-09-16** — §6 backend trap: an engine field is invisible until the queue-state controller projects it.
*Trigger:* the timeline showed a closed shift's token as "Upcoming · +9h 22m" — the engine had flagged it
`isMissedSession` all along, but the endpoint never sent the field.

**2026-09-15** — §6 backend trap: the limits overview is cached on both sides. *Trigger:* the role switcher moved its
lab/pharmacy existence check onto the overview's counts, so a new lab needs both caches cleared to appear.

**2026-09-15** — §6 trap: omitting `shiftCapacities` from `PUT /doctor` deletes them. *Trigger:* onboarding's final submit
re-sent availability without them, so each shift of a two-shift doctor showed the day's 100 tokens.

**2026-09-15** — §6 backend trap: partial preference saves write generic defaults. *Trigger:* a Dentist's Clinical details
drawer showed the generic order — saving one instruction suggestion had created their row, and a row skipped the specialty.

**2026-09-15** — §6 backend trap: the FE refetches only on section signals. *Trigger:* "Running Late · Approx. delay"
froze between events — the per-minute queue tick emitted `queue.updated`, which no web screen listens to.

**2026-09-15** — §6 backend trap: override tokens sit above capacity with a null session. *Trigger:* Emergency offered
token 23, already held by an earlier emergency, because the grid listed only 1..capacity; the create failed.

**2026-09-15** — §6 backend trap: template rows compete on `updatedAt`, so a write to one must not bump it; plus the
PowerShell `git mv` machine fact. *Trigger:* the Preview's "What prints" switches save onto the template row.

**2026-09-14** — BE §9: every permission key needs a route that enforces it. *Trigger:* the
Receptionist "Book lab test" permission (`lab_test:create`) could be ticked, but no route checked it.

**2026-09-14** — FE playbook §10 gained "Dashboards" (layout, card grid, data, refresh rules) and
§16 a matching checklist line. *Trigger:* user asked for the admin dashboard redesign to be
reusable on the other dashboards. Backend `docs/DASHBOARD_API_CHANGES.md` added as a **temporary**
mobile hand-off; delete it once the mobile app ships.

**2026-09-14** — §6 shared revenue rule. *Trigger:* dashboard Total Revenue ₹29,195 vs Payments
History ₹29,760 — the dashboard skipped an added service on an "Already Paid" appointment.

**2026-09-14** — §6 dashboard cache-version rule, and the hanging `patient.service.test.ts` machine fact.
*Trigger:* versioned dashboard caches only stay correct if every appointment/payment writer bumps the
version; two writers (patient payment failure, added services) never signalled. The patient test
file ran 6m40s without finishing.

**2026-09-14** — §6 signal-ordering rule extended to caches. *Trigger:* the admin dashboard refetched
on every signal but read a 2-minute revenue cache and a 60s today-stats cache nothing ever cleared.

**2026-09-14** — §6 token trap extended to hour-of-day stats. *Trigger:* the Reports "peak hours"
query counts every token booking as 11 PM; found while building the admin dashboard's Busiest Hours.

**2026-09-14** — §6 backend trap: recalculate the queue snapshot before signalling it. *Trigger:*
a new booking and running-late both left queue times stale until reload — booking recomputed
inside the transaction, and the override path never signalled after its recompute.

**2026-09-11** — BE §6: the `sendOk`/`sendCreated` example had the arguments swapped; the real
signature is `(res, message, data)`. *Trigger:* pre-commit review of the translation feature
checked the helper against the playbook and found the doc, not the code, was wrong.

**2026-09-11** — §5: a green BE Jest file is not a type check (ts-jest runs
`isolatedModules`). *Trigger:* the prescription-translation test passed 13/13
while the run printed that it had skipped type-checking.

**2026-09-09** — BE §1.7 rewritten: it told authors to put a new module's tests
in `tests/`, which §12 forbids outright. *Trigger:* user asked why `appointments`
had both folders; its three files were `git mv`d into `__tests__/`.

**2026-09-09** — §6 backend traps: the `'23:59'` token placeholder and IST
day bounds on zone-less timestamps. *Trigger:* no-show was broken three ways by
both — token queues never requeued, a mixed day rewrote token rows to 23:29, and
the clinic list's date filter dropped everything after 18:30 IST.

**2026-09-09** — File created. Rules drawn from the two existing standards
playbooks plus this session:

- **§5 — slow commands banned as per-task checks** (`build`, `tsc -b`, full
  `typecheck`, full Jest suite). *Trigger:* user reported builds ate every task;
  measured FE `tsc -b` at 2m41s cold / 2m08s warm.
- **§4 + the hook — the same commands blocked mechanically.** *Trigger:* user
  pointed out I ran `tsc -b` immediately after writing the rule; docs alone
  don't bind.
- **Hook false positive fixed** — heredoc bodies and quoted strings are stripped
  before matching, so a banned name written *inside* a doc or `echo` is content,
  not a command. *Trigger:* the hook blocked me writing this changelog.
  Regression test: `node .claude/hooks/test.js` (16 cases).
- **§6 — machine facts:** no `python`, no `jq` on this box. *Trigger:* both
  failed mid-task while building the hook.
- **§7 — standing obligation** to capture and prune rules each session.
  *Trigger:* user asked that the rules keep growing over time.
