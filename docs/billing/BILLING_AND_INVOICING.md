# Billing and Invoicing – Requirements

## 1. Documents

| Document | Purpose | Number format |
|---|---|---|
| Invoice | Bill for items supplied; frozen once issued | `SMC/2526/000123` |
| Receipt | Proof of one payment collection | `R-2026-000045` (existing) |
| Credit note | Reduces an issued invoice; the only correction allowed | `SMC/CN/2526/0012` |

- Paid and due amounts come from the money ledger; an invoice never stores them.

## 2. Current gaps

| Gap | Today |
|---|---|
| No stored invoice | Appointment and treatment plan invoices are built in the browser |
| Invalid numbers | Fragments of database ids; backend and frontend differ for the same visit |
| Date not fixed | Treatment plan invoice prints the date it is opened |
| Live details | Changing clinic details changes old invoices |
| No GST details | No GSTIN, SAC/HSN, Tax Invoice or Bill of Supply |
| No corrections | No credit note, no void |
| One mode per collection | Cash + UPI needs two collections |
| Wrong mode shown | Split visits show only the last mode |
| Plan setting unused | Invoice timing (per step / at end) is saved but never applied |
| No statement | No patient view of bills, payments and balance |
| No billing page | No invoice list with status |
| Mixed mode values | "Pay Later" and "Online" stored as free text |
| One lab invoice per order | A test added after billing cannot get an invoice |
| Scattered invoices | Appointment, treatment plan, lab and pharmacy each build their own |
| Closed visits editable | Server accepts services added after a refund |
| Two refund bases | Policy refund uses the whole visit price; manual review uses the consultation fee |
| Dead pages | Old pharmacy invoice pages call a route that does not exist |

## 3. Scope

**Phase 1 – Clinic billing:** stored invoices, numbering, billing code, GSTIN, draft bill, credit notes,
void, split payments, refunds by mode, treatment plan invoices, PDF, billing page, patient statement,
cancellation handling.

**Phase 2:** lab invoices, pharmacy invoices (sales return = credit note; drug licence number, batch
and expiry on each line), WhatsApp/email sending, insurance claims.

**Out of scope:** subscription invoices, pharmacy supplier bills, online fee split.

**Known problems in subscription invoices** (MediArogya billing the clinic; not fixed here):

| Problem | Today |
|---|---|
| Invalid number | Fragment of a database id, not a gapless financial-year series |
| Wrong tax split | Always CGST + SGST; a clinic in another state should be charged IGST |
| No clinic GSTIN | Registered clinics cannot claim input tax credit |
| E-invoicing | Required once MediArogya's turnover passes ₹5 crore; not supported |

## 4. Invoice rules

| Rule | Requirement |
|---|---|
| Storage | Stored and frozen at issue; never edited or deleted |
| Snapshot | Seller, patient, doctor, lines, rates and tax copied at issue |
| Numbering | `CODE/FY/NNNNNN`, unique and sequential per issuer (clinic, lab, pharmacy) per financial year (April–March), max 16 characters; never reused; a failed issue rolls back and takes no number; void keeps its number |
| Billing code | 2–3 letters per issuer (keeps credit note numbers within 16 characters) (e.g. clinic `SMC`, lab `SML`, pharmacy `SMP`), unique, locked after the first invoice; the format itself is the same for all and not customisable |
| Separate series | Each issuer has its own invoice and credit note series, allowed under GST even when they share one GSTIN |
| GSTIN | Optional |
| Document type | Unregistered clinic: plain Invoice (no GST wording). Registered: exempt lines = Bill of Supply, taxable = Tax Invoice, both = Invoice-cum-Bill of Supply |
| Tax | Decided per line from the item's rate or exemption and the place of supply; never hard-coded. Exempt services show SAC 9993 |
| Place of supply | Default: the clinic (services performed there) or pharmacy counter, giving CGST + SGST. Services not performed at the clinic (online consultation, out-of-state visit, delivery) use the patient's state and may be IGST. State name and code printed on every Tax Invoice |
| Recipient | Patient name always; address and state required when the invoice is ₹50,000 or more |
| Business recipient | A payer with a GSTIN (e.g. a company paying for staff check-ups) is business-to-business: GSTIN printed; e-invoicing applies if the clinic is above the threshold (Phase 2) |
| Lines | Description, SAC/HSN, quantity, unit, rate, discount, taxable value, tax rate and amount |
| Fixed text | "Reverse charge: No" and "Computer-generated invoice, no signature required" (or digital signature) |
| Amounts | Calculated by the server only |
| Rounding | Each line's tax rounded half away from zero to the paisa; invoice total optionally rounded to the rupee as a separate round-off line |
| PDF | Made from the stored invoice, stored privately; view in app or download |
| Retention | Invoices, credit notes and PDFs kept at least 6 years |
| Audit | Issue, void, credit note, payment and refund all logged |
| Not required | E-invoicing (IRN) and dynamic QR for patient (business-to-consumer) invoices; business-to-business invoices are checked against the threshold |

## 5. Issuing

| Source | Issued when |
|---|---|
| Appointment | First payment or visit completion, whichever is first; online prepaid at payment |
| Treatment plan – per step | Each step charged |
| Treatment plan – at end | Plan closed |

- Before issue the bill is a draft: no number, services and discounts change freely.
- Time limit: every service is invoiced within 30 days of being done. These triggers are business
  rules and never delay an invoice past that limit.
- Treatment plan "at end": completed steps not yet invoiced are invoiced once 30 days pass, even if
  the plan is still open.
- Treatment plan invoices are issued whether paid or not; advances get receipts only.
- The current plan invoice screen becomes a Statement.

## 6. Changes after issue

| Change | Result |
|---|---|
| Service added | New invoice for the added lines |
| Discount given | Credit note |
| Service added before first payment | Joins the draft; one invoice when issued |
| Lab test added to a billed order (Phase 2) | New invoice on the same order; an order can have several invoices |
| Added service removed, unpaid, same month | That invoice voided |
| Added service removed after payment | Credit note on that invoice, plus refund |
| Error, nothing paid, same month | Void and reissue; old number stays used |
| Error, money received or a later month | Credit note |

- A visit or order lists all its invoices with their status and one combined total.
- A payment covering several invoices of a visit is applied oldest invoice first.
- Cancelling a visit with several invoices gives one credit note per invoice, following the refund
  base rules.
- A voided invoice is never one already reported in the GST return.
- A credit note shows the original invoice number and date and a reason.
- Credit notes are allowed only until 30 November after the financial year ends (or the annual return,
  if earlier); after that only a refund is possible, with no change to the tax already reported.
- Advances for taxable services get a receipt voucher showing the tax; exempt services use the plain
  receipt.

## 7. Invoice status

| Status | Condition |
|---|---|
| Issued | Nothing paid |
| Partially Paid | Part paid |
| Paid | Fully paid |
| Partially Credited | Reduced by a credit note; remaining amount shown |
| Credited | Fully reduced to zero by credit notes |
| Void | Cancelled before payment, in the month of issue |

Status is derived from the ledger.

## 8. Payments

Modes: Cash, UPI, Card, Bank Transfer, Cheque, Advance, Insurance; Online (gateway only).
"Pay Later" is removed as a mode.

| Case | Requirement |
|---|---|
| Several modes at once | One collection, one receipt listing each mode |
| Receipt link | Receipt prints the invoice number(s) it paid, or "Advance" (optional, recommended) |
| Part payment | Allowed; rest stays due |
| Overpayment | Blocked, or extra kept as patient advance |
| Patient advance | Usable as one part of a collection |
| UPI / card reference | Optional |
| Wrong entry | Reversing entry; receipt reissued, old one marked Corrected |
| Visit list | Shows "Split" with breakdown when more than one mode |
| Reports by mode | Each mode counts only its own amount |
| Insurance | Plain mode; claims in Phase 2 |

## 9. Refunds and cancellations

| Case | Requirement |
|---|---|
| Split payment refund | Each mode gets back its own amount by default; override needs a reason |
| Partial refund | Staff choose the mode, capped at what it paid |
| Online payment | Refunded through the gateway only |

| Cancellation | Invoice | Credit note |
|---|---|---|
| Full refund | Stays, status Credited | Full amount |
| Partial refund | Stays for the kept part, status Partially Credited | Refunded part |
| No refund | Stays | None |
| Unpaid | Voided (draft dropped) | None |

| Refund base | Rule |
|---|---|
| Consultation fee | Policy percentage |
| Added services done | Admin manual refund with a reason only |
| Added services not done | Full refund |
| Online convenience fee and GST | Existing fee rules |

| Visit state | Add Service | Discount | Refund |
|---|---|---|---|
| Booked / In Progress | Yes | Yes | Policy |
| Completed | Same day, new invoice | Credit note | Admin, with reason |
| Cancelled + refunded | Locked | Locked | Done |
| Cancelled, no refund | Locked | Locked | Admin, with reason |
| Free Consultation conversion | New invoice | Yes | Yes |

- The lock is enforced by the server.

## 10. Dates and changes

**Date rules** – one shared logic, used by every billing flow:

| Rule | Requirement |
|---|---|
| Time zone | Every billing date (issue date, financial year, month) is worked out in IST in code, never from the database clock |
| Shared helpers | Reuse `src/utils/istDateTime.ts` (`getISTDateString`); the financial-year helper (`2526` for Apr 2025–Mar 2026) is added there once and used everywhere |
| Financial year | Taken from the IST issue date; the first invoice on or after 1 April starts the new series at 000001; no reset job |
| Issue date | The day the invoice is issued; the service date is printed separately |
| Visit in March, paid in April | New year's number, March service date printed |
| Credit note for last year's invoice | Current year's credit note number, references the original; allowed until 30 November |
| Void | "Same month" judged by IST calendar month |
| Simultaneous issue | Number counter locked in the transaction: no duplicates, no gaps |

**Settings and data changes** – what was issued never changes; new invoices follow the current setting:

| Change | Issued invoices | New invoices |
|---|---|---|
| Clinic name, address, phone, logo | Keep their snapshot | New details |
| GSTIN added | Stay plain Invoices | GST document types from the registration date, same series |
| GSTIN changed | Unchanged | New GSTIN; Admin only, audit logged |
| GST registration cancelled | Unchanged | Plain Invoices from the cancellation date; Admin only, audit logged |
| Clinic moves state (new GSTIN) | Unchanged | New series; billing code may change only here, audit logged |
| Service price | Old price | Drafts pick up the new price until issued |
| Tax rate | Each line keeps its rate | New rate |
| Patient or doctor details | Keep their snapshot | New details; a corrected document needs credit note + new invoice |
| Treatment plan invoice timing | — | Copied onto each plan when it is created, so a change affects only new plans |

## 11. Access

| Role | Access |
|---|---|
| Admin | All, including void and credit notes |
| Receptionist | Issue, collect, view, download, statement |
| Doctor | Own invoices, view only |
| Lab / Pharmacist | Own invoices (Phase 2) |

## 12. Screens

| Screen | Contents |
|---|---|
| Finance → Billing | Invoice list, filters, detail, Collect Payment, Void, Credit Note, View, Download |
| Patient → Statement | Bills, payments, credit notes, balance |
| Appointment / treatment plan | Own invoices in the shared viewer |
| Visit Summary print | All invoices and receipts of one visit on one sheet; not an invoice itself |
| Clinic Settings → Billing | Billing code, GSTIN |

## 13. Existing data

- Paid appointments and plans from before go-live get an invoice when first opened, dated the day it
  is issued, showing the original service and payment dates.
- Past payments are already in the money ledger for that visit or plan, so the new invoice's status
  comes from them; no payment is re-entered.
- Lab invoices keep their old numbers when moved (Phase 2).
