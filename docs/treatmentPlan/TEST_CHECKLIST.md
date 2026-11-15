# Treatment Plan module — test checklist (Phase 1)

Every rule and decision in `DEV_PLAN.md` has at least one test here. Tick a box only after running it. Page-by-page browser record: `TEST_LOG.md`.
**Ref** points back to the plan (`Q` = decision in §10, number = build step in §11, § = section).
**How**: `U` unit test (Jest, one file at a time) · `A` API call against a running server · `UI` browser
check · `M` manual with a test clinic. Example data: Rahul, root canal, fees 2,000 / 2,000 / 1,500 /
2,500 / 3,000 = ₹11,000; Priya, laser package 6 sessions.

---

## 1. Templates (Phase 1)

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | T1 | Create a Staged template with 5 steps | Saved as draft; steps in order 1–5 | 1.1 | A |
| [ ] | T2 | Create a Package template: 6 sessions, every 28 days, ₹15,000 | Saved; no step rows | 1.2 | A |
| [ ] | T3 | Create a Timeline, Review or Cycle template | Refused with a clear message | Q1 (B2 #1), 1.2 | A |
| [ ] | T4 | Package with 0 sessions or 0-day interval | Refused (DB check) | §3.7 | A |
| [ ] | T5 | Step with negative gap, 0 duration, negative fee | Refused (DB check) | §3.7 | A |
| [ ] | T6 | Step with **blank duration** | Saved; shows "Same as appointment slot (N min)" using the doctor's slot length | Q13 | A, UI |
| [ ] | T7 | Activate without "Checked by doctor" | Refused | 1.3 | A |
| [ ] | T8 | Archive a template used by a plan; try to delete it | Archive works; delete refused | 1.3 | A |
| [ ] | T9 | Edit a template after a plan was made from it | Template changes; the existing plan's steps and fees **do not** | §3.2, 1.1 | A |
| [ ] | T10 | Each template edit | One history row `template_edit` with `changedFields` | §3.4 | A |
| [ ] | T11 | Template search "root" / "ROOT" / "%" / "_" | Ranked contains-matches; `%` and `_` match literally | §12 search | A |
| [ ] | T12 | Template preview, gaps 0, 2, 3, 3, 7 starting 12 Oct | 12, 14, 17, 20, 27 Oct; total and duration shown | 1.4, Q10 | U |

## 2. Library, seed and copies

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | L1 | Run the seed on an empty DB | Guide's Staged + Package examples inserted as **draft, fees empty, not checked** | Q11, 1.5 | A |
| [ ] | L2 | Run the seed again | No duplicates, no changes | Q11, §3.2 | A |
| [ ] | L3 | Super Admin edits a seeded template, then seed runs again | Super Admin's edit stays | §3.2 | A |
| [ ] | L4 | Two library templates with the same `code` | Refused (partial unique) | §3.7 | A |
| [ ] | L5 | Clinic copies an **active** library template | Clinic row with `source_template_id`; clinic sets its own fees | 1.5 | A |
| [ ] | L6 | Clinic tries to copy a **draft** library template | Refused | Q11 | A |
| [ ] | L7 | Clinic user calls update on a library row | 404; library row unchanged | §3.2 guardrails | A |
| [ ] | L8 | Library template updated after the clinic copied it | Clinic sees "A newer library version exists"; its copy unchanged | §3.2 | A, UI |
| [ ] | L9 | Library templates in the consultation list | Not shown; empty state links to the library | §3.2 | UI |
| [ ] | L10 | Super Admin routes called by a clinic Admin | 403; `routes.guard.test.ts` passes | §12, 0.2 | U, A |

## 3. Which templates a doctor sees

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | V1 | Dentist opens templates | Only active Dental templates of their clinic | Q1, §3.2 | A |
| [ ] | V2 | Doctor with Dental + Derma specializations | Sees both | Q1 | A |
| [ ] | V3 | Dr. Ajay has his own version of the clinic "Root canal" | Ajay sees only his version; Dr. Neha (Dental) sees the clinic one | §3.2 | A |
| [ ] | V4 | Doctor A's own version | Never visible to doctor B | §3.2 | A |
| [ ] | V5 | "Save as my template" from an edited plan | New template with `owner_doctor_id` and `source_template_id` | 2.3 | A |

## 4. Specialty fields (configurable)

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | S1 | No config for a specialty | Specialty slot hidden; plan saves with empty `specialty_data` | 1.9, §3.6 | A, UI |
| [ ] | S2 | Add a test specialty config (number field, min 11, max 48) | Form shows the field with **no FE code change** | 1.10, Q (feedback) | UI |
| [ ] | S3 | Value outside min/max, wrong type, missing required | Refused with a how-to-fix message | 1.9 | A |
| [ ] | S4 | Grep the code for specialty names (`Dental`, `Derma`…) | None in logic | §1.1 | M |

## 5. Creating a plan

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | P1 | Consultation diagnosis "Irreversible pulpitis" | Root canal suggested + up to 3 others, each with the matched word | 2.1 | A, UI |
| [ ] | P2 | Create a plan from a template | Status `proposed`; steps, gaps, fees, options copied; `consent_required` copied | 2.2, §6.1 | A |
| [ ] | P3 | Create from a Package template | One step row per session, gap = interval | 2.2, §5 | A |
| [ ] | P4 | Custom plan (no template) | Saved; `template_id` null | 2.2 | A |
| [ ] | P5 | Edit a proposed plan: add, remove, reorder steps | Saved; order correct; no unique-seq error during reorder | 2.3, §3.7 | A |
| [ ] | P6 | Add option B | Both share `proposal_group_id`, labelled A and B | 2.3 | A |
| [ ] | P7 | Gap below minimum | Asks for an override reason; history `gap_override` | 2.4, §3.4 | A |
| [ ] | P8 | Discount above the clinic cap by a Receptionist / by a Doctor | Receptionist refused; Doctor or Admin approves; history `discount_approved` + audit entry | B2 #5, 2.4 | A |
| [ ] | P9 | Medicine allergy conflict; patient already has an active plan for the same problem | Warning shown | 2.4 | UI |
| [ ] | P10 | Two people edit the same proposed plan | Second save gets 409 "changed by someone else" | §3.7 | A |
| [ ] | P11 | "+ New → Treatment plan" from the header | Opens create plan | 2.6 | UI |

## 6. Patient decision and versions

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | D1 | Accept with consent required but no consent file | Refused | §6.1 | A |
| [ ] | D2 | Accept with consent file + advance ₹3,000 | One transaction: status accepted, version 1 snapshot, advance ledger row, history, audit entry | 3.1 | A |
| [ ] | D3 | Accept option A | Option B becomes declined in the same transaction | 3.2, §3.7 | A |
| [ ] | D4 | Accept A and B at the same moment | Only one succeeds | §3.7 | A |
| [ ] | D5 | "Wants to think" | Stays proposed; follow-up date set; shows in Suggested list | 3.2 | A, UI |
| [ ] | D6 | Log a follow-up call | History `follow_up_call` with outcome and notes; next date updated | 3.2, §3.4 | A |
| [ ] | D7 | Declined plan proposed again after a call | declined → proposed allowed | Q19 | A |
| [ ] | D8 | Change price or steps after accept | Version 2; needs patient approval; version 1 unchanged | 3.3 | A |
| [ ] | D9 | Package accepted | `package_expires_on` = accept date + expiry days | 3.1, Q21 | A |

## 7. Booking and timing

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | B1 | Allowed dates for step 2 when step 1 is booked on 12 Oct, gap 2 | Earliest 14 Oct; earlier dates blocked with the reason | 4.1, Q2 | A, UI |
| [ ] | B2 | Book before the earliest date without a reason / with a reason (Doctor) | Refused / allowed, `gap_override_reason` saved | §5 | A |
| [ ] | B3 | Token-mode doctor | Booking takes one token; screen shows "Token #N", not 11:59 PM | Q5, §12 | A, UI |
| [ ] | B4 | Slot-mode doctor, step with 60-min duration | Books **one** slot (multi-slot is D2) | Q5 | A |
| [ ] | B5 | Book a step | Appointment type `Treatment`, created by the appointments module; link row; **no fee** collected | 4.2, B2 #3 | A |
| [ ] | B6 | "Book all" | All steps booked in order, each anchored on the previous booking | 4.3, Q2 | A |
| [ ] | B7 | Move step 2's appointment later | Steps 3–5 re-checked; bookings that now break the gap flagged in Need booking | 4.5, Q2 | A |
| [ ] | B8 | Flagged booking → staff choose Cancel | Confirmed in a danger dialog; appointment cancelled | Q2 | UI |
| [ ] | B9 | Link an existing appointment; unlink; link again | Works; step back to not booked after unlink; re-link allowed | 4.4, §3.7 | A |
| [ ] | B10 | After accept, patient already has a booking **with the same doctor** | Offered "Use it for Step N?"; bookings with other doctors not offered | Q (feedback item 3), 4.8 | A, UI |
| [ ] | B11 | Lab time | Never changes dates; only the gap does | Q10, Q14 | U |

## 8. Visits and appointment sync

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | Y1 | Appointment completed | Step stays booked until the doctor marks it done; prompt shown | §7 | A, UI |
| [ ] | Y2 | Doctor marks step done | Step done; charge row added; next step bookable; plan → in treatment on the first step | 4.6, §6 | A |
| [ ] | Y3 | Double click "Mark step done" | Only one charge (DB unique) | §3.7 | A |
| [ ] | Y4 | Non-plan doctor tries "Mark step done" | Button hidden; API refuses | §12 FE | A, UI |
| [ ] | Y5 | No-show | Step missed; in "Missed – rebook"; later steps re-checked; open screens update without reload | 4.5 | A, UI |
| [ ] | Y6 | Appointment cancelled | Link closed; step back to not booked | §7 | A |
| [ ] | Y7 | Hook fails (simulate an error) | Appointment action still succeeds; error logged; rerun is safe | §7, 0.4 | U |
| [ ] | Y8 | Treatment appointment's payment section | Shows "Payment is collected on the treatment plan"; no collect button | §6, 4.8 | UI |

## 9. Money (most sensitive — test every row)

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | M1 | Rahul, no discount, steps done in order | Charges 2,000 · 2,000 · 1,500 · 2,500 · 3,000 = ₹11,000 | Q18 | U |
| [ ] | M2 | Fees ₹11,000, agreed ₹10,000 | Step 1 charged ₹1,818.18; total charged exactly ₹10,000 | Q18 rule 1 | U |
| [ ] | M3 | Package 6 × ₹3,000 at ₹15,000 | Each session ₹2,500; total ₹15,000 | Q18 | U |
| [ ] | M4 | Amounts that don't divide evenly (₹10,000 ÷ 3) | 3,333.33 · 3,333.33 · 3,333.34; last step takes the remainder | Q18 rule 1 | U |
| [ ] | M5 | Price changed after 2 steps charged | Charged rows unchanged; remaining steps share new total − charged | Q18 rule 2 | U |
| [ ] | M6 | A step skipped | Not charged; its share moves to remaining steps (or a version lowers the total) | Q18 rule 3 | U |
| [ ] | M7 | Money maths | No floating-point drift; paise or SQL numeric only | Q18 rule 4 | U |
| [ ] | M8 | Overcharged step | Credit note with reason; balance correct | Q18 rule 5 | A |
| [ ] | M9 | Balance through Rahul's full journey (advance 3,000, payments 4,000 + 4,000) | Matches the ledger table on the schema page row by row; ends at ₹0 | §3.5, 5.1 | U |
| [ ] | M10 | "Due now" and "Remaining" | Always shown; correct at every step | §3.5 | A, UI |
| [ ] | M11 | Collect payment | Ledger row with `payment_mode` Cash / UPI / Card; receipt `TP-{year}-…` | Q15, 5.2 | A |
| [ ] | M12 | **Same payment request sent twice** (double click / retry) | One row; second call returns the first receipt | Q17 | A |
| [ ] | M13 | Two different payments, same amount | Two rows (different request ids) | Q17 | A |
| [ ] | M14 | Refund by Admin, Doctor, Receptionist | Allowed with reason; audit entry | B2 #5 | A |
| [ ] | M15 | Refund without reason | Refused (DB check) | §3.7 | A |
| [ ] | M16 | Write-off by Receptionist / by Doctor | 403 / allowed with reason + approver; audit entry | B2 #5, 5.4 | A |
| [ ] | M17 | Ledger row edit or delete attempt | Not possible through any route | §3.5 | M |
| [ ] | M18 | Amount 0 or negative | Refused (DB check) | §3.7 | A |
| [ ] | M19 | Plan money recorded anywhere else | Not in appointment payments or `financial_ledgers` | §6 | M |
| [ ] | M20 | Close with balance 0 / credit / due | Settled / refund flow / write-off flow | §6 | A |

## 10. Instalments

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | I1 | Schedule that doesn't add up to total − advance | Refused with the amount needed | 5.3 | A |
| [ ] | I2 | Partial payment against an instalment | Linked; `paid_at` set only when fully paid | §3.5 | A |
| [ ] | I3 | Instalment due in 2 days (clinic setting) | One reminder; not repeated | 6.3 | A |
| [ ] | I4 | Price change or extension fee on an instalment plan | Must re-balance unpaid instalments or collect now; refused until the sum matches; paid ones unchanged | Q23 | A |

## 11. Plan lifecycle

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | F1 | Every allowed transition in §6.1 | Allowed | Q19 | U |
| [ ] | F2 | A disallowed one (completed → paused, declined → in treatment…) | 409 with a clear message | Q19 | U |
| [ ] | F3 | Pause a plan with booked future visits | Visits flagged in Need booking; none auto-cancelled | Q20 | A |
| [ ] | F4 | Resume | Back to in treatment; next earliest date from today | Q19 | A |
| [ ] | F5 | End early with a sensitive reason | No more plan messages **and** no existing appointment reminders for it | 6.2, 6.4 | A |
| [ ] | F6 | All steps done | Completed; recall date = completed + recall days | 6.2 | A |
| [ ] | F7 | Package 7 days before expiry | Reminder to staff and patient (clinic setting) | Q22 | A |
| [ ] | F8 | Package past expiry | "Package expired"; new session booking refused | Q21 | A, UI |
| [ ] | F9 | Extend package without a fee | New expiry date; history `package_extended` | Q21 | A |
| [ ] | F10 | Extend package with ₹2,000 fee | New version (patient approves); total +2,000; one charge row without step, reason "Package extension"; not spread over sessions | Q21 | A, U |
| [ ] | F11 | Charge with no step and no reason | Refused (DB check) | §3.7 | A |

## 12. History and audit

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | H1 | Every action in the §3.4 table | One history row with the defined `meta` shape | §3.4 | U |
| [ ] | H2 | An action with no defined shape | Rejected by the service | §3.4 | U |
| [ ] | H3 | History row with both or neither of plan_id and template_id | Refused (DB check) | §3.7 | A |
| [ ] | H4 | Patient names or phones in history `meta` | Never present | §3.4 | M |
| [ ] | H5 | Accept, discount approval, refund, write-off, end early, extend package | Each also appears in the clinic audit log | §3.4 | A |

## 13. Access and security

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | X1 | Clinic A user opens a clinic B plan id | 404 (not 403) | §12 tenancy | A |
| [ ] | X2 | Doctor lists plans | Only their own | Q9 | A |
| [ ] | X3 | Receptionist lists plans | Only assigned doctors' plans | Q9 | A |
| [ ] | X4 | Every route | Has `requireRole` after `requireAuth`; Zod rejects bad input with 400 | §2.1 | U, A |
| [ ] | X5 | Consent file | Stored as S3 key; served signed; upload refused before ownership check | §12 | A |
| [ ] | X6 | Logs during a full journey | No patient names, phones or diagnoses | §12 | M |

## 14. Live updates, cache, notifications

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | R1 | Two receptionist screens open; one books a step | Other screen updates without reload | 4.5, §12 | UI |
| [ ] | R2 | Template edited | Active-templates cache cleared; new values on the next consultation | §12 caching | A |
| [ ] | R3 | Plan changed | Tab counts correct within one refresh | §12 caching | A |
| [ ] | R4 | Redis down during a write | Write still succeeds; cache error logged | §12 caching | M |
| [ ] | R5 | Every alert (follow-up, need booking, missed, instalment, recall, package expiry) | Fires once per due item; job safe to rerun | 6.3 | A |

## 15. Frontend (every screen)

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | U1 | Four states | Loading skeleton, empty with next action, human error, populated | FE §8 | UI |
| [ ] | U2 | Keyboard only | Every action reachable; dialogs trap focus, close on Esc | FE §8 | UI |
| [ ] | U3 | Dark mode + contrast | Readable in both; colour greps clean | FE §8 | UI, M |
| [ ] | U4 | 320×568, 1024×768, 1366×768, 1920×1080 | No sideways page scroll; actions visible | FE §8 | UI |
| [ ] | U5 | Labels | No enum values shown (e.g. "In treatment", never `in_treatment`) | FE §6 | UI |
| [ ] | U6 | Progress | "3 of 6 sessions" / "2 of 5 steps" | 6.6 | UI |
| [ ] | U7 | Payment form while saving | Button disabled; dialog can't close | FE §8 | UI |
| [ ] | U8 | Error messages | Say how to fix; never raw backend text | FE §8 | UI |
| [ ] | U9 | `npx eslint` on changed files | Clean | WORKFLOW §5 | M |

## 16. Regression (nothing outside plans changed)

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | G1 | Normal consultation booking, check-in, complete, no-show, cancel | Same as before | 0.4, 7.2 | M |
| [ ] | G2 | Normal appointment payments, Payments History, dashboards | Same figures as before | 7.2 | M |
| [ ] | G3 | Prescription workspace without a diagnosis | No suggestion call fired | 2.5 | UI |
| [ ] | G4 | Simulator patients (Staged and Package) end to end on staging | Each ends in the expected state and balance | 7.1 | M |

## 17. Phase D interim behaviour (until each decision)

| ✓ | ID | Test | Expected | Ref | How |
|---|---|---|---|---|---|
| [ ] | Z1 | D1: treatment visit payment | No fee at the desk; plan money only on plan screens | D1 | A, UI |
| [ ] | Z2 | D2: long step | One slot or token | D2 | A |
| [ ] | Z3 | D3: settings | Only "normal" booking offered | D3 | UI |
| [ ] | Z4 | D4: GST, receipts | `taxable` stored, not applied; receipt number built from the row | D4 | A |
| [ ] | Z5 | D5: every subscription plan | Module available | D5 | UI |
| [ ] | Z6 | D6: privacy | Nothing deleted; staff-scope access; actions logged | D6 | A |

## 18. Not in Phase 1 (should not exist)

- [ ] No branch fields · no outside-work tracking or tab · no Timeline/Review/Cycle behaviour · no subscription gate · no stored receipt counter.
