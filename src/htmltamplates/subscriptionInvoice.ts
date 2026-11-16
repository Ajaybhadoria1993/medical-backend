import { brandLogoHtml } from './brandLogo';
export const subscriptionInvoiceTemplate = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>{{invoiceNumber}}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Courier New", "Lucida Console", monospace;
    background: #fffdf7;
    padding: 12px;
    color: #000;
    letter-spacing: 1px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .invoice-container {
    width: 100%;
    max-width: 850px;
    margin: auto;
    border: 1px solid rgba(0,0,0,0.25);
    padding: 22px;
    background: #fffdf7;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #000;
    padding-bottom: 15px;
    margin-bottom: 20px;
  }
  .logo img { height: 30px; }
  .company-details {
    font-size: 12px;
    line-height: 1.5;
    margin-bottom: 20px;
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .invoice-title {
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .invoice-title h1 {
    font-size: 28px;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .invoice-title p {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .section-title {
    font-weight: bold;
    font-size: 13px;
    margin-bottom: 8px;
    text-transform: uppercase;
    border-bottom: 1px solid #000;
    padding-bottom: 4px;
    letter-spacing: 1px;
  }
  .info-grid {
    display: flex;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 20px;
  }
  .info-box {
    flex: 1;
    font-size: 13px;
    line-height: 1.6;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .info-box .info-row {
    margin-bottom: 4px;
    display: flex;
    flex-wrap: wrap;
  }
  .info-box .info-label {
    font-weight: bold;
    min-width: 100px;
    text-transform: uppercase;
  }
  .info-box .info-value {
    flex: 1;
    word-wrap: break-word;
    word-break: break-word;
    text-transform: uppercase;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 20px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  table th, table td {
    border: 1px solid #000;
    padding: 10px;
    font-size: 13px;
    text-align: left;
    vertical-align: top;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  table th {
    background: #f5f5f5;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .transaction-meta {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    margin-top: 18px;
    font-size: 11px;
    line-height: 1.6;
  }
  .transaction-meta > div { flex: 1; }
  .transaction-meta > div:last-child { text-align: right; }
  /* Gateway IDs are case-sensitive; the page-wide uppercase would make
     pay_Tu5cDWBmWnt4L8 print as PAY_TU5CDWBMWNT4L8, which cannot be searched. */
  .ref-id { text-transform: none; letter-spacing: 0; word-break: break-all; }
  .item-name { font-weight: bold; }
  .item-description {
    display: block;
    margin-top: 4px;
    font-size: 9px;
    line-height: 1.35;
    text-transform: none;
    letter-spacing: 0.5px;
  }
  .number { text-align: right; white-space: nowrap; }
  .proration { color: #333; }
  .proration-days {
    display: block;
    margin-top: 3px;
    font-size: 8px;
    line-height: 1.2;
    white-space: normal;
  }
  .summary-label { text-align: right; font-size: 12px; }
  .summary-value { text-align: right; white-space: nowrap; }
  .summary-grid {
    display: grid;
    grid-template-columns: max-content max-content;
    justify-content: end;
    align-items: baseline;
    column-gap: 16px;
    row-gap: 4px;
    line-height: 1.4;
    font-size: 12px;
  }
  .grand-total td {
    font-size: 15px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .signature-section {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
  }
  .signature-box {
    text-align: center;
    position: relative;
  }
  .seal img {
    max-width: 120px;
  }
  .footer {
    margin-top: 30px;
    font-size: 12px;
    text-align: center;
    border-top: 1px solid #000;
    padding-top: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
</style>
</head>
<body>
<div class="invoice-container">
  <div class="header">
    <div class="logo">
      ${brandLogoHtml(30)}
    </div>
    <div class="invoice-title">
      <p><strong>Invoice No:</strong> {{invoiceNumber}}</p>
      <p><strong>Date/Time:</strong> {{currentDateTime}}</p>
    </div>
  </div>
  <div class="company-details">
    <strong>MediArogya</strong><br>
    <strong>GSTIN: </strong>23AAFCI1029R1ZF
  </div>
  <div class="info-grid">
    <div class="info-box">
      <div class="section-title">Clinic Details</div>
      <div class="info-row"><span class="info-label">Name:</span> <span class="info-value">{{clinicName}}</span></div>
      <div class="info-row"><span class="info-label">Address:</span> <span class="info-value">{{this.clinicAddress}}</span></div>
      <div class="info-row"><span class="info-label">City/State:</span> <span class="info-value">{{clinicCity}}, {{clinicState}} - {{zipCode}}</span></div>
      <div class="info-row"><span class="info-label">Phone:</span> <span class="info-value">{{clinicPhone}}</span></div>
    </div>
    <div class="info-box">
      <div class="section-title">Customer Details</div>
      <div class="info-row"><span class="info-label">Name:</span> <span class="info-value">{{adminName}}</span></div>
      <div class="info-row"><span class="info-label">Email:</span> <span class="info-value">{{adminEmail}}</span></div>
      <div class="info-row"><span class="info-label">Phone:</span> <span class="info-value">{{adminMobile}}</span></div>
    </div>
  </div>
  <div class="transaction-meta">
    <div><strong>Transaction Date/Time:</strong> {{createdAt}}</div>
    <div><strong>Transaction ID:</strong> <span class="ref-id">{{transactionId}}</span></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 28%;">Item</th>
        <th style="width: 22%;">Billing Period</th>
        <th style="width: 8%; text-align: center;">Qty</th>
        <th style="width: 14%; text-align: right;">Rate<br><span style="font-size: 8px;">(Incl. GST)</span></th>
        <th style="width: 14%; text-align: right;">Prorated<br>Deduction</th>
        <th style="width: 14%; text-align: right;">Net Amount</th>
      </tr>
    </thead>
    <tbody>
      {{#each lineItems}}
      <tr>
        <td>
          <span class="item-name">{{name}}</span>
          <span class="item-description">{{description}}</span>
        </td>
        <td>{{startDate}}<br>TO {{endDate}}</td>
        <td style="text-align: center;">{{quantity}}</td>
        <td class="number">{{rate}}</td>
        <td class="number proration">
          {{proratedDeduction}}
          {{#if proratedDays}}<span class="proration-days">{{proratedDays}}</span>{{/if}}
        </td>
        <td class="number"><strong>{{netAmount}}</strong></td>
      </tr>
      {{/each}}
      <tr>
        <td colspan="6">
          <div class="summary-grid">
          {{#if couponDiscount}}
            <span class="summary-label">Subtotal</span>
            <span class="summary-value">{{invoiceSubtotal}}</span>
            <span class="summary-label">Coupon Discount</span>
            <span class="summary-value">{{couponDiscount}}</span>
          {{/if}}
            <span class="summary-label">{{#if couponDiscount}}Taxable Value (After Discount){{else}}Taxable Value{{/if}}</span>
            <span class="summary-value">{{subtotal}}</span>
            <span class="summary-label">CGST (9%)</span>
            <span class="summary-value">+ {{cgst}}</span>
            <span class="summary-label">SGST (9%)</span>
            <span class="summary-value">+ {{sgst}}</span>
          </div>
        </td>
      </tr>
      <tr class="grand-total">
        <td colspan="5" style="text-align:right; font-weight:bold;">Grand Total</td>
        <td class="summary-value" style="font-weight:bold;">{{grandTotal}}</td>
      </tr>
      <tr>
        <td colspan="6" style="border-top: none;">
          <p style="font-size: 10px; margin-bottom: 5px;">Total in Words:</p>
          <p style="font-size: 12px; font-weight: bold;">{{amountInWords}}</p>
        </td>
      </tr>
    </tbody>
  </table>
  <div class="signature-section">
    <div class="signature-box">
      <div class="seal" style="opacity: 0.8">
        <img src="https://i.ibb.co/YTKDDQbY/IMS-Seal.png" alt="Seal">
      </div>
    </div>
  </div>
  <div class="footer">
    This is a computer-generated invoice.<br>
    For queries: bhadoriaajay99@gmail.com
</div>
</body>
</html>
`;
