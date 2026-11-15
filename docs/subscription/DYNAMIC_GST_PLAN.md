# Dynamic GST — plan

Super Admin can change the GST rate and how it is charged, from a chosen date, without a deploy.
Today GST is fixed in code (`GST_RATE_PERCENT = 18`, always inclusive) and invoices store the tax
amounts but not the rate.

Status: decisions taken 2026-11-11; all 6 steps written (2026-11-11). Open: accountant confirms Bill of Supply and SAC; a GST-specific notice email.

## How it works (the SaaS standard: Stripe, Chargebee, Zoho)

1. A tax setting is a **record with a start date**, never a number in code. A row in use is never
   edited; a change is a new row.
2. The tax is **frozen on every payment**: a quote, checkout, AutoPay renewal or add-on purchase uses
   the setting in force on the day it is charged and stores the rate and mode on the payment. The
   invoice copies them; a credit note reverses with the invoice's own rate. Old bills never change.
3. Clinics are **told before they pay more**, unless the Super Admin chooses to apply it at once.
4. Every change is **audited**: who, when, why, old → new.

## Decisions

| # | Decision |
|---|---|
| G1 | Three modes: `inclusive` (price contains GST), `exclusive` (GST added on top), `none` (no GST; the document is a Bill of Supply, not a Tax Invoice). |
| G2 | Rate stored in basis points (1800 = 18%); money stays in integer paise. |
| G3 | A change that makes clinics pay more defaults to **30 days' notice** with an email. The Super Admin may choose **"apply from now"** instead; the screen then asks to confirm that clinics get no notice. |
| G4 | No change in the past. A scheduled change can be undone until it starts. |
| G5 | A renewal already sent to the bank keeps its amount; the new setting applies from the next charge. |
| G6 | Coupons and pro-rating apply first; GST is then added (exclusive) or taken out (inclusive). |
| G7 | MRR on the Super Admin Revenue page is shown **without GST** and labelled "excl. GST". Collected stays the cash received. |
| G8 | Before any setting row exists, the service uses 18% inclusive, so deploying changes nothing. |
| Open | The accountant confirms the `none` mode (Bill of Supply) and the SAC code. |

### Example: Clinic Plan ₹499

| Mode | Breakdown | Clinic pays |
|---|---|---|
| Inclusive 18% | ₹422.88 + GST ₹76.12 | ₹499 |
| Exclusive 18% | ₹499 + GST ₹89.82 | ₹588.82 |
| None | ₹499, no GST lines | ₹499 |

## Steps

1. **Model** (you run the migration): `billing_tax_rates` table; `tax_rate_bp` and `tax_mode` on
   `subscription_payments` and `subscription_invoices` (defaults 1800 / inclusive, so old rows read right).
2. **Tax service**: the setting in force on a date (cached), replacing the fixed 18%; inclusive /
   exclusive / none maths with tests and exact rounding.
3. **Pricing**: quotes, checkout, renewal and add-ons use it and freeze it on the payment; the AutoPay
   limit checks the amount with tax.
4. **Invoices**: use the frozen rate; the PDF shows "GST 18%" or "Bill of Supply".
5. **Super Admin**: API + screen (current, scheduled, history; rate, mode, start date, notice or
   "apply from now", reason, live preview); audit; notice emails.
6. **Clinic screens**: GST line in checkout and "What you'll pay next"; Revenue MRR excl. GST.
