// Tax invoice and credit note: compact, content-height layout on an A4 sheet.
// Reverse charge (always "No" for our sales) is left out at the owner's request; Rule 46 lists it.
export const subscriptionTaxInvoiceTemplate = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>{{invoiceNumber}}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, 'Noto Sans', 'DejaVu Sans', sans-serif; color: #111827; font-size: 11px; line-height: 1.45; }
  .page { padding: 28px 36px 24px; border-top: 5px solid #0a6c74; }
  .muted { color: #6b7280; }
  .label { color: #6b7280; font-size: 9px; text-transform: uppercase; letter-spacing: .6px; font-weight: bold; margin-bottom: 2px; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .logo { height: 32px; }
  .brand { font-size: 18px; font-weight: bold; color: #0a6c74; }
  .title { text-align: right; }
  .title h1 { font-size: 16px; letter-spacing: 1px; text-transform: uppercase; }
  .title .orig { font-size: 9px; color: #6b7280; }
  .strip { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 10px 14px; border-radius: 6px; background: #f0faf8; }
  .strip.credit { background: #f3f4f6; }
  /* Amount and text share a baseline and wrap instead of overlapping when the line is long. */
  .strip > div { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 6px; min-width: 0; line-height: 1.35; }
  .strip .amt { font-size: 18px; font-weight: bold; line-height: 1.2; }
  .strip .what { color: #374151; overflow-wrap: anywhere; }
  .grid > div { min-width: 0; overflow-wrap: anywhere; }
  .chip { font-size: 9px; font-weight: bold; letter-spacing: .6px; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; background: #0a6c74; color: #fff; }
  .strip.credit .chip { background: #374151; }
  .grid { display: grid; grid-template-columns: 1.2fr 1.2fr 1fr; gap: 16px; margin-top: 16px; }
  .grid strong { display: block; font-size: 12px; }
  .meta div { display: flex; justify-content: space-between; gap: 8px; }
  .meta div span:first-child { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: .6px; color: #6b7280; text-align: left; padding: 0 0 6px; border-bottom: 1.2px solid #111827; }
  td { padding: 7px 0; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  td .sub { font-size: 9.5px; color: #6b7280; }
  .num { text-align: right; white-space: nowrap; }
  .w-no { width: 22px; color: #6b7280; }
  .sum { display: flex; justify-content: space-between; gap: 24px; margin-top: 10px; align-items: flex-start; }
  .words { flex: 1; }
  .words p { font-weight: bold; }
  .totals { width: 240px; }
  .totals div { display: flex; justify-content: space-between; padding: 2px 0; }
  .grand { font-weight: bold; font-size: 13px; border-top: 1.2px solid #111827; margin-top: 4px; padding-top: 6px !important; }
  .foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 9px; display: flex; justify-content: space-between; gap: 16px; }
</style>
</head>
<body>
<div class="page">
  <div class="head">
    <div>
      {{#if logo}}<div style="display:flex;align-items:center;gap:8px;"><img class="logo" src="{{logo}}" alt=""><div class="brand">{{seller.name}}</div></div>{{else}}<div class="brand">{{seller.name}}</div>{{/if}}
    </div>
    <div class="title">
      <h1>{{#if creditNote}}Credit Note{{else if billOfSupply}}Bill of Supply{{else}}Tax Invoice{{/if}}</h1>
      <div class="orig">Original for recipient</div>
    </div>
  </div>

  {{#if creditNote}}
  <div class="strip credit">
    <div><span class="amt">₹{{total}}</span> <span class="what">credited · {{creditNote.reason}}{{#if transactionId}} · refunded to {{transactionId}}{{/if}}</span></div>
    <span class="chip">Refunded</span>
  </div>
  {{else}}
  <div class="strip">
    <div><span class="amt">₹{{total}}</span> <span class="what">paid{{#if paidOn}} on {{paidOn}}{{/if}}{{#if paidVia}} via {{paidVia}}{{/if}}{{#if transactionId}} · {{transactionId}}{{/if}}</span></div>
    <span class="chip">Paid</span>
  </div>
  {{/if}}

  <div class="grid">
    <div>
      <div class="label">Sold by</div>
      <strong>{{seller.name}}</strong>
      {{#each sellerLines}}<div>{{this}}</div>{{/each}}
      {{#if seller.gstin}}<div>GSTIN: <b>{{seller.gstin}}</b></div>{{/if}}
    </div>
    <div>
      <div class="label">Bill to</div>
      <strong>{{billTo.name}}</strong>
      {{#each billToLines}}<div>{{this}}</div>{{/each}}
      <div>GSTIN: {{#if billTo.gstin}}<b>{{billTo.gstin}}</b>{{else}}Unregistered{{/if}}</div>
    </div>
    <div class="meta">
      <div><span>{{#if creditNote}}Credit note{{else}}Invoice no.{{/if}}</span><b>{{invoiceNumber}}</b></div>
      <div><span>Date</span><b>{{issueDate}}</b></div>
      {{#if creditNote}}<div><span>Against</span><b>{{creditNote.invoiceNumber}}</b></div>{{/if}}
      <div><span>Place of supply</span><span>{{placeOfSupply}}</span></div>
      <div><span>SAC</span><span>{{sacCode}}</span></div>
    </div>
  </div>

  <table>
    <thead><tr><th class="w-no">#</th><th>Description</th><th class="num">{{#if amountsInclGst}}Amount (₹, incl. GST){{else}}Amount (₹){{/if}}</th></tr></thead>
    <tbody>
      {{#each lines}}<tr><td class="w-no">{{this.no}}</td><td>{{this.description}}{{#if this.note}}<div class="sub">{{this.note}}</div>{{/if}}</td><td class="num">{{this.amount}}</td></tr>{{/each}}
    </tbody>
  </table>

  <div class="sum">
    <div class="words">
      <div class="label">Amount in words</div>
      <p>{{amountInWords}}</p>
      {{#if period}}<div class="muted" style="margin-top:6px">Service period: {{period}}</div>{{/if}}
    </div>
    <div class="totals">
      {{#if billOfSupply}}<div><span class="muted">GST not charged</span><span></span></div>{{else}}
      <div><span class="muted">Taxable value</span><span>₹{{taxable}}</span></div>
      {{#if igst}}<div><span class="muted">IGST @ {{gstRate}}%</span><span>₹{{igst}}</span></div>{{else}}
      <div><span class="muted">CGST @ {{halfRate}}%</span><span>₹{{cgst}}</span></div>
      <div><span class="muted">SGST @ {{halfRate}}%</span><span>₹{{sgst}}</span></div>{{/if}}{{/if}}
      <div class="grand"><span>{{#if creditNote}}Total credited{{else}}Total{{/if}}</span><span>₹{{total}}</span></div>
    </div>
  </div>

  <div class="foot">
    <span>Computer-generated {{#if creditNote}}credit note{{else}}invoice{{/if}}; no signature needed.</span>
    <span>{{seller.name}}</span>
  </div>
</div>
</body>
</html>`;
