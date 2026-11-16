# Billing and Invoicing — dev plan (Phase 1: clinic billing)

Status: **planning, not approved yet.** Requirements: [BILLING_AND_INVOICING.md](BILLING_AND_INVOICING.md).
Branch (when approved): `feat/billing` in BE and FE, from `staging`.

## In simple points

**What changes for the clinic**
- Every bill becomes a real, stored invoice with a proper number (`SMC/2526/000123`) that never changes.
- Wrong bill? Before payment in the same month → **Void**. Otherwise → **Credit note**. Nothing is ever edited.
- One collection can be **Cash + UPI** together, with one receipt.
- New **Finance → Billing** page (all invoices + status) and **Patient → Statement** (bills, payments, balance).
- Clinic Settings → **Billing**: billing code (`SMC`) and GSTIN.

**Example — Rahul's visit**
1. Rahul books a ₹500 consultation → a **draft** bill (no number yet).
2. Doctor adds an X-ray ₹300 before he pays → still one draft, now ₹800.
3. He pays ₹500 cash + ₹300 UPI → invoice `SMC/2526/000041` is **issued** (first payment), one receipt `R-2026-000112` lists both modes.
4. Doctor adds a dressing ₹100 after that → a **second** invoice `SMC/2526/000042`, status Issued (unpaid).
5. Visit is cancelled with a full refund → one **credit note per invoice**, cash goes back as cash, UPI as UPI.

**What stays the same**
- The money ledger (`money_entries`) stays the one place for charges, payments and refunds. Invoices **point at** ledger charges; paid/due/status are always worked out from the ledger, never stored.
- Receipt numbers (`R-YYYY-NNNNNN`) stay as they are.

## Steps

Each step stops for review before the next. Step numbers are shared by BE and FE.

| # | Step | Repo |
|---|---|---|
| 1 | Groundwork: financial-year helper, fixed payment modes, `credit_note` ledger type | BE |
| 2 | New tables (models only) → **owner runs the migration** | BE |
| 3 | Billing settings API + Clinic Settings → Billing | BE + FE |
| 4 | Billing core: numbering, tax per line, snapshot, issue, status from ledger (+ tests) | BE |
| 5 | Hook issuing into appointments, treatment plans, 30-day job; server lock on closed visits | BE |
| 6 | Split payments, receipts listing modes, refunds by mode, receipt correction | BE + FE |
| 7 | Void, credit notes, cancellation handling | BE |
| 8 | PDF (private), billing routes, patient statement API | BE |
| 9 | Screens: Billing page, shared invoice viewer, Statement, Visit Summary print, "Split" in lists; remove old builders + dead pharmacy pages | FE |
| 10 | Existing data + go-live date | BE + FE |

## 1. Groundwork (BE)

- **Financial year** helper in `src/utils/istDateTime.ts`: `getISTFinancialYear(date) → '2526'` and `getISTMonth(date) → '2026-04'`, both from `getISTDateString`. Used by every billing date rule; nothing reads the DB clock.
- **Payment modes** become a fixed list in `appointments/utils/paymentMode.constants.ts`:
  `Cash, UPI, Card, Bank Transfer, Cheque, Advance, Insurance, Online`.
  - `MoneyWriteService.validate` rejects any other value on payment/refund entries (today it is free text).
  - `Online` only with `channel = 'online'` (gateway); desk money can't claim it.
  - "Pay Later" stops being a mode. At booking it means "no payment yet" (no ledger payment), which is what already happens. The old `appointment_payments.payment_mode` column keeps its old values for now (FE still reads it in 14 files); it is removed in the money "remove the old way" step E, not here.
- **`credit_note` ledger entry type** (`money_entry_type` enum). It lowers what is charged, like this:
  - `balanceOf`: `charged = charge − credit_note − adjustments on charges`.
  - Needs a reason (check constraint `money_entries_reason_ck` stays as is: it is not in the no-reason list).
  - Treatment plan maths already subtracts `credit_note` (`treatmentPlan/utils/money.utils.ts:33`); the SQL helpers `planDuePaise` / `planLeftToPayPaise` and `visitMoneySql` get the same line.
- **Refund base: no change.** Checked 2026-11-02: policy refund (`policyEvaluation.service.ts:424`) and refund review (`refundReview.service.ts:200`) already both use the consultation fee (`primaryServicePrice || price`); the "two refund bases" gap is already fixed.

## 2. Tables (models only; owner runs the migration)

New bounded module `src/main/billing/` (`models/ services/ routes/ schemas/ utils/ index.ts`), same layout as `money/`. Code outside imports only from `billing/index.ts`.

Every billing table keys on **issuer** (`issuer_type` = `clinic | lab | pharmacy`, `issuer_id`), so labs and pharmacies (Phase 2) need no table change.

| Table | Columns (main) | Notes |
|---|---|---|
| `billing_profiles` | issuer_type, issuer_id, `billing_code` (2–3 capital letters, Q2), `gstin`, `gst_from` (date), `gst_until` (date), `state_code`, `round_off` (bool), updated_by | One row per issuer. `billing_code` unique. Code locked once any invoice uses it (checked in service). |
| `billing_sequences` | issuer_type, issuer_id, `doc_type` (invoice / credit_note), `billing_code`, `fy`, `last_no` | PK on all but `last_no`. Same upsert-with-row-lock as `receipt_sequences`: a rolled-back issue takes no number. |
| `invoices` | id, issuer, clinic_id, `invoice_no`, `doc_kind` (invoice / tax_invoice / bill_of_supply / invoice_bos), source_type, source_id, patient_id, doctor_id, `issue_date` (IST date), `service_date`, `place_of_supply` (state code + name), `seller` jsonb, `buyer` jsonb, `doctor` jsonb, taxable / cgst / sgst / igst / round_off / total (paise), `voided_at`, `void_reason`, `pdf_key`, issued_by, created_at | Unique (issuer, invoice_no). Never updated except void + `pdf_key`. |
| `invoice_lines` | invoice_id, `money_entry_id` (the ledger charge it bills), description, sac_hsn, qty, unit, rate, discount, taxable, tax_rate, cgst / sgst / igst (paise), `void` (bool) | **Unique `money_entry_id` WHERE NOT void**: a charge is on one live invoice only. Void frees it for the reissue. |
| `credit_notes` | id, issuer, `cn_no`, invoice_id, `issue_date`, reason, `lines` jsonb (line id, amount, tax), totals (paise), issued_by | Unique (issuer, cn_no). Writes `credit_note` ledger entries in the same transaction. |
| `money_receipts` | id, clinic_id, `receipt_no`, source_type, source_id, total (paise), `status` (issued / corrected), `corrected_by_id`, `invoice_nos` (text[]), created_by, created_at | One row per collection. Unique (clinic_id, receipt_no). |

Changes to existing tables:
- `money_entries.receipt_id` (nullable). A split collection = several payment entries sharing one `receipt_id` and `receipt_no`. The unique index `money_entries_receipt_uq` moves to `money_receipts` (old rows keep their number; uniqueness is already true for them).
- `clinics_service.sac_code` (default `9993`), `clinics_service.gst_rate` (default `0` = exempt) and `clinics_service.price_includes_gst` (default `true`, Q1).
- `treatment_plans.invoice_timing` — copied from clinic settings when a plan is created, so a settings change affects only new plans.

## 3. Billing settings (BE + FE)

- `GET/PUT /api/v1/billing/settings` — Admin only. Receptionist can read.
- Billing code: 2–3 letters (keeps credit note numbers within 16 characters), unique, locked once used (error: "This code is on issued invoices and can't change"). Allowed to change only together with a new GSTIN in a different state (clinic moved), audit logged.
- GSTIN: optional, format + checksum checked, state code must match the clinic's state. Adding one sets `gst_from`; cancelling sets `gst_until`. All changes audit logged (`AuditLogService.record`).
- FE: Clinic Settings → **Billing** section (code, GSTIN, round-off). Shared `InputField` / `CheckBox`; help text only under GSTIN ("Leave empty if the clinic is not GST registered").

## 4. Billing core (BE)

Pure functions in `billing/utils/` (each with one small test file), services use them inside the caller's transaction:

- **Draft** = the source's ledger charges not yet on a live invoice line. Not stored; worked out on read. So services and discounts change freely before issue, and price changes flow in automatically.
- **`BillingService.issue(tx, source)`**: takes the draft charges, snapshots seller (clinic name, address, phone, logo, GSTIN, state), buyer (patient name, phone, address/state), doctor, lines with SAC and rate; works out tax; takes the next number; inserts invoice + lines. Nothing to bill → no invoice, no number.
- **Number**: `CODE/FY/NNNNNN` from `billing_sequences` (IST issue date → FY). First invoice on/after 1 April starts at 000001; no reset job.
- **Document kind**: no GSTIN on issue date → Invoice. Registered: all exempt → Bill of Supply, all taxable → Tax Invoice, mixed → Invoice-cum-Bill of Supply.
- **Tax per line**: rate from the service (`gst_rate`); 0 = exempt (SAC 9993 printed). Plan steps are exempt in Phase 1 (Q4).
- **Inclusive or exclusive, per service** (Q1): `price_includes_gst = true` → ₹1,000 is the total, tax is taken out of it (taxable ₹847.46 + tax ₹152.54). `false` → tax is added on top (₹1,000 + ₹180 = ₹1,180).
  - The ledger charge is always **what the patient pays** (₹1,000 or ₹1,180), so balances, dues and receipts stay correct.
  - One shared helper `lineTax(price, rate, inclusive)` is used by the charge (appointment sync), the booking total, the online payment amount and the invoice, so they can never differ.
  - ⚠ Exclusive is a **behaviour change** outside billing: the booking screen, desk total and Razorpay amount for that service become price + GST. Only services an Admin marks taxable + exclusive are affected; everything else stays exactly as today. Place of supply = clinic's state (CGST + SGST); online consultation uses the patient's state (IGST when it differs). Each line's tax rounded half away from zero (`toPaise` rule). Optional round-off line to the rupee.
- **Status** (`invoiceStatus` util): money received on the source is applied to its live invoices **oldest first**, after credit notes. Gives Issued / Partially Paid / Paid / Partially Credited / Credited / Void. Never stored.
- Fixed text on every invoice: "Reverse charge: No", "Computer-generated invoice, no signature required".
- Every issue is audit logged.

## 5. When invoices are issued (BE)

One rule, one call: **`BillingService.issueIfDue(tx, source)`** runs after every money change on a source, inside the same transaction. It issues the draft when the source has a trigger:

| Source | Trigger |
|---|---|
| Appointment | Any payment received, or visit Completed. Online prepaid = its payment. |
| Plan, per step | The step is charged (`PlanLedgerService.chargeStep`). |
| Plan, at end | Plan closed. |
| Any | 30-day job (below). |

Where it is called (the existing choke points, no new hooks per caller):
- `AppointmentMoneySync.pay` / `afterChange` (covers desk pay, booking-time pay, Razorpay confirm, add-service, completion — all go through these).
- `PlanMoneyStore.record` after a `charge`, and the plan close path.

So "service added after the first payment" automatically becomes a new invoice for just that line, and "added before the first payment" joins the draft.

**30-day job** (`src/cron/jobs/billingDue.cron.ts`, daily): issues drafts for appointments whose visit date is 30+ days ago (not cancelled / no-show) and plan steps done 30+ days ago, even if the plan is open. Only for services on/after the **go-live date** (§10), or day one would issue invoices for all history.

**Reducing a charge that is already invoiced** goes through billing, never a silent ledger adjustment:
- `AppointmentMoneySync.takeBack` today writes an `adjustment` on charges. For an invoiced charge it calls `BillingService.reduce` instead: unpaid + same IST month + whole invoice → void it (other lines of that invoice go back to draft and are reissued at once); otherwise → credit note (+ refund if paid).

**Server lock** (§9 visit-state table) in `appointmentMultipleService.service.ts` and the discount path:
- Booked / In progress: add, discount, policy refund.
- Completed: add only on the same IST day (new invoice); discount = credit note; refund Admin-only with reason.
- Cancelled: add and discount refused (`409`, "This visit is cancelled, so its bill is locked").

## 6. Split payments and receipts (BE + FE)

- `POST /appointments/:id/payments` and `POST /treatment-plan/:planId/payments` accept
  `parts: [{ mode, amount, reference? }]`. The old body (`amount` + `paymentMode`) still works as one part, so **older mobile apps keep working**.
- One transaction: one `money_receipts` row + one ledger payment entry per part, all with the same receipt. Then `issueIfDue`.
- Receipt prints each mode, and the invoice number(s) it paid (oldest first), or "Advance".
- Overpayment is refused (see open question Q3 for patient advance).
- **Wrong entry**: `POST /billing/receipts/:id/correct` → reversing `adjustment` entries + a new receipt; the old one marked Corrected. Admin + Receptionist.
- **Refunds by mode**: default = each mode gets back what it paid, newest first; staff can change it with a reason, capped per mode at what that mode paid. Online money only back through the gateway (existing path).
- `visitModeSql` returns `Split` when a visit has more than one mode; the breakdown comes with it. Reports by mode already count per entry.
- FE: one shared **Collect payment** dialog (appointment + plan) with mode rows ("Add another mode"), live total vs due, reference field for UPI/Card, pending + result toast.

## 7. Void, credit notes, cancellation (BE)

- `POST /billing/invoices/:id/void` — Admin. Only if nothing paid on it, same IST month as issue (so it's never in a filed GST return). Keeps its number. Its lines go back to draft.
- `POST /billing/invoices/:id/credit-notes` — Admin. Lines + amounts + reason. Number `CODE/CN/FY/NNNN` from its own series. Writes `credit_note` ledger entries (one per line, reversing that charge). Shows the original invoice number and date.
  - Allowed until **30 November after the invoice's FY ends**; after that refused ("Only a refund is possible now").
- **Cancellation**: no change in `cancellation-policy` or `clinicFinance`. Their refunds already go through `AppointmentMoneySync` (`afterChange` with a refund `move`), so billing reacts there: a refund on an invoiced visit → credit note for the refunded amount; charges taken back on an unpaid cancelled visit → void.
  - Unpaid → void the invoices (if past the month, credit note instead).
  - Full refund → full credit note per invoice → Credited.
  - Partial refund → credit note for the refunded part, oldest invoice first → Partially Credited.
  - No refund → invoices stay.
- All audit logged.

## 8. PDF, routes, statement (BE)

- One Handlebars template `src/utils/pdf/templates/clinicInvoice.hbs` (+ credit note and receipt variants), rendered only from the stored invoice row via `htmlToPdfBuffer`.
- Made on first view, uploaded privately to `invoices/<clinicId>/<invoiceId>.pdf`, key saved in `pdf_key`; later views reuse it. Served through the files module (new kind `invoice`, clinic-checked signed URL).
- Routes under `/api/v1/billing` (auto-loaded):

| Route | Who |
|---|---|
| `GET /invoices` (filters: date, status, kind, doctor, search number/patient; paged) | Admin, Receptionist; Doctor = own only |
| `GET /invoices/:id`, `GET /invoices/:id/pdf` | same |
| `GET /sources/:type/:id` — all invoices, draft, receipts and one combined total for a visit or plan | same |
| `POST /invoices/:id/void`, `POST /invoices/:id/credit-notes` | Admin |
| `POST /receipts/:id/correct` | Admin, Receptionist |
| `GET /patients/:patientId/statement` — bills, payments, credit notes, running balance | Admin, Receptionist |
| `GET/PUT /settings` | Admin (read: Receptionist) |

## 9. Screens (FE)

Read the MediArogya Frontend Design Spec for these modules first; update the Feature tracker rows when done. All screens follow the CLAUDE.md UX rules (four data states, shared form controls, confirm dialogs naming the invoice).

- **Finance → Billing**: `CommonTable` list (number, date, patient, kind, total, status via `StatusChip`), filters, detail drawer with lines, receipts, credit notes; actions Collect payment, View, Download; Void + Credit note (Admin, `danger`, confirm dialog).
- **Shared invoice viewer** (`components/billing/InvoiceViewer.tsx`): shows the stored PDF. Used by appointment, plan and Billing page.
  - Removes `pages/appointment/appointmentInvoice.tsx` (1012 lines) and `helpers/invoicePayloadHelper.ts` (the id-fragment numbers).
  - `PlanInvoiceDialog.tsx` becomes **Statement** (its "Invoice" mode goes; plan invoices open in the viewer).
- **Patient → Statement** tab.
- **Visit Summary print**: all invoices and receipts of one visit on one sheet, titled "Visit summary — not an invoice".
- "Split" with a breakdown tooltip + text in visit lists.
- Remove dead pharmacy invoice pages that call missing routes (`pages/pharmacy/NewInvoice.tsx`, `InvoiceDetails.tsx`, `PharmacyInvoice.tsx`, `PharmacyInvoiceDetails.tsx` — each confirmed unused/broken before removal).
- New `billingApi.ts` slice on `baseQueryWithAutoLogout`, added to `apiRoot.ts`.

## GST check (2026-11-02)

Checked against GST rules for invoices (Rule 46), bills of supply (Rule 49), credit notes (Rule 53) and the 30-day limit (Section 31). Covered except:

| Gap | Plan |
|---|---|
| Copy marking | PDF prints "Original for recipient" (step 8). |
| Signature | Plan prints "Computer-generated invoice, no signature required". **Owner to confirm with the CA**; if not enough, a signature image / digital signature in Billing settings. |
| Keeping records | GST likely needs ~8 years (72 months from the annual return due date), not 6. **Owner to confirm with the CA.** Invoices and credit notes are never deleted (FK `restrict`), and the S3 `invoices/` folder gets no auto-delete rule. |

## Removed old logic

Every old way of making an invoice goes, so only `billing` makes invoices.

| Old | Where | What happens |
|---|---|---|
| Appointment invoice built in the browser | FE `pages/appointment/appointmentInvoice.tsx`, `helpers/invoicePayloadHelper.ts` | Deleted; shared viewer instead (step 9) |
| Plan invoice built in the browser | FE `components/treatmentPlan/plans/PlanInvoiceDialog.tsx` | Becomes Statement only (step 9) |
| Dead pharmacy invoice pages | FE `pages/pharmacy/NewInvoice.tsx`, `InvoiceDetails.tsx`, `PharmacyInvoice.tsx`, `PharmacyInvoiceDetails.tsx` | Deleted after confirming unused (step 9) |
| Patient invoice data with an id-fragment number `INV-YYYY-XXXXXX` | BE `GET /patient/appointments/:id/invoice-data` (`patient.service.ts` `getPatientAppointmentInvoiceData`) | Not called by web; likely the patient mobile app. Kept, but returns the stored invoice + number, and logs `[Billing] legacy invoice-data` per call; removed once mobile moves (step 8) |
| Unused invoice template | BE `src/htmltamplates/invoice.ts` (nothing imports it) | Deleted (step 8) |

## 10. Existing data and go-live

- `BILLING_GO_LIVE` date in clinic-independent config (env, IST date).
- Visits/plans with services before go-live get no automatic invoice. When one is **first opened** (`GET /billing/sources/...`) and has money received, its invoice is issued then: dated that day, service date and payment dates shown as they were. Status comes from the ledger money already there; nothing re-entered.
- No backfill script, no mass issue.

## Owner runs

- The migration after step 2 (and after any later model change). No migration files are generated or left in the tree.
- Money tests before release (existing command), plus the new `billing` test folder.

## Decisions (2026-11-02)

| # | Decision |
|---|---|
| Q1 | Both: each service is **GST-inclusive or exclusive** (`price_includes_gst`, default inclusive). The services form gets the switch next to the tax rate. |
| Q2 | Billing codes are **2–3 letters** (a 4-letter code made credit notes 17 characters, over the GST limit of 16). |
| Q3 | **Patient advance later.** Phase 1 blocks overpayment and hides "Advance" on visits; plan advances work as today. |
| Q4 | **Plan steps exempt** (SAC 9993) in Phase 1; per-step tax later. |

## Open questions

| # | Question | Recommendation |
|---|---|---|
| Q8 | Refund rule for added services ("not done → full refund, done → Admin only") needs a "done" mark on added services, which doesn't exist. | **Later.** Policy keeps refunding the consultation fee only (today's safe behaviour). |
| Q5 | Clinic moves state (new GSTIN): same billing code would restart numbers and clash. | Moving state **requires a new billing code** = new series. |
| Q6 | Invoice ≥ ₹50,000 needs patient address + state, but issuing is automatic (job, payment). | Issue anyway with what we have; Billing page flags "Address missing"; Collect dialog asks for it when the bill is ≥ ₹50,000. |
| Q7 | Round-off to the rupee: default on or off? | **On**, switchable in Billing settings. |
