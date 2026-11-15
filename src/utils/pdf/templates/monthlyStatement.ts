/** A clinic's month of money for its accountant: received, refunds, fees, paid to bank, still to come. */
export const monthlyStatementTemplate = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; margin: 32px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 22px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .muted { color: #6b7280; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 6px 0; text-align: left; }
  th { color: #6b7280; font-weight: normal; border-bottom: 1px solid #e5e7eb; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { border-top: 1px solid #1f2937; font-weight: bold; }
  .note { margin-top: 4px; font-size: 11px; }
  footer { margin-top: 28px; font-size: 10px; color: #6b7280; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>Monthly Statement · {{monthLabel}}</h1>
      <div><strong>{{clinic.name}}</strong></div>
      {{#each clinic.lines}}<div class="muted">{{this}}</div>{{/each}}
    </div>
    <div class="muted" style="text-align:right">Generated {{generatedAt}}</div>
  </div>

  <h2>Money received</h2>
  <table>
    <tr><td>Online</td><td class="num">{{received.online}}</td></tr>
    <tr><td>At desk</td><td class="num">{{received.desk}}</td></tr>
    <tr><td>Total received</td><td class="num">{{received.total}}</td></tr>
    <tr><td>Refunds ({{refunds.count}})</td><td class="num">− {{refunds.total}}</td></tr>
    <tr class="total"><td>Net received</td><td class="num">{{net}}</td></tr>
  </table>

  <h2>Platform fees</h2>
  <table>
    <tr><td>Fees on online bookings</td><td class="num">{{fees}}</td></tr>
  </table>
  <div class="note muted">Paid by patients on top of your price; not deducted from your money.</div>

  <h2>Paid to your bank</h2>
  <table>
    <tr><th>Date</th><th>UTR</th><th class="num">Amount</th></tr>
    {{#each payouts}}<tr><td>{{date}}</td><td>{{utr}}</td><td class="num">{{amount}}</td></tr>{{/each}}
    {{#unless payouts.length}}<tr><td colspan="3" class="muted">No payouts this month.</td></tr>{{/unless}}
    <tr class="total"><td colspan="2">Total paid to bank</td><td class="num">{{paidTotal}}</td></tr>
  </table>

  <h2>Still to come</h2>
  <table>
    <tr><td>Online money received, not yet paid to your bank</td><td class="num">{{pending}}</td></tr>
  </table>

  <footer>All amounts in ₹ · Days in IST · Generated from MediArogya records. This is a statement, not a tax invoice.</footer>
</body>
</html>`;
