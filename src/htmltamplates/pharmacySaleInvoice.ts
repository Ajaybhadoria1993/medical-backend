export const pharmacySaleInvoiceTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice - {{invoice.id}}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    @page {
      size: A4;
      margin: 10mm;
    }
    
    body {
      font-family: 'Courier New', 'Lucida Console', monospace;
      line-height: 1.4;
      color: #000;
      background: #fffdf7;
      letter-spacing: 0.5px;
      font-weight: 700;
      text-transform: uppercase;
    }
    
    .container {
        width: 100%;
        margin: 0 auto;
        background: white;
        padding: 10px;
    }
    
    /* PHARMACY HEADER */
    .pharmacy-header {
      border-bottom: 2px solid #000;
      padding-bottom: 15px;
      margin-bottom: 15px;
      text-align: center;
    }
    
    .pharmacy-header h1 {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 5px;
      letter-spacing: 1px;
    }
    
    .pharmacy-header p {
      font-size: 11px;
      margin: 2px 0;
      letter-spacing: 0.5px;
    }
    
    /* INVOICE DETAILS ROW */
    .invoice-details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 15px;
      font-size: 10px;
    }
    
    .invoice-detail-item span {
      display: inline-block;
      width: auto;
    }
    
    .invoice-detail-item .label {
      font-weight: bold;
      margin-right: 5px;
    }
    
    .invoice-details .right {
      text-align: right;
    }
    
    /* CUSTOMER DETAILS BOX */
    .customer-payment-box {
      background: #f5f5f5;
      border-left: 4px solid #000;
      border-right: 4px solid #000;
      padding: 12px 20px;
      margin-bottom: 15px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      font-size: 11px;
    }
    
    .customer-section h3,
    .payment-section h3 {
      font-size: 9px;
      font-weight: bold;
      margin-bottom: 8px;
      letter-spacing: 1px;
    }
    
    .customer-section p,
    .payment-section p {
      margin: 3px 0;
      font-size: 10px;
    }
    
    .customer-name {
      font-weight: bold;
      font-size: 12px;
    }
    
    /* ITEMS TABLE */
    .items-table {
      width: 100%;
      margin: 20px 0;
      border-collapse: collapse;
      font-size: 10px;
    }
    
    .items-table thead {
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
    }
    
    .items-table th {
      padding: 8px 5px;
      text-align: left;
      font-weight: bold;
      font-size: 9px;
      letter-spacing: 0.5px;
    }
    
    .items-table td {
      padding: 8px 5px;
      border-bottom: 1px solid #ddd;
    }
    
    .items-table tbody tr:hover {
      background: #f9f9f9;
    }
    
    .medicine-name {
      font-weight: bold;
      font-size: 10px;
    }
    
    .text-center {
      text-align: center;
    }
    
    .text-right {
      text-align: right;
    }
    
    /* AMOUNT SUMMARY */
    .amount-summary {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }
    
    .summary-box {
      width: 100%;
      max-width: 320px;
    }
    
    .summary-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      padding: 8px 0;
      border-bottom: 1px solid #ddd;
      font-size: 11px;
    }
    
    .summary-row .label {
      text-align: left;
      font-weight: 600;
    }
    
    .summary-row .value {
      text-align: right;
      font-weight: 600;
    }
    
    .summary-row.total {
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
      padding: 10px 0;
      font-size: 13px;
      font-weight: bold;
    }
    
    /* NOTES */
    .payment-notes {
      border-top: 1px solid #ddd;
      border-bottom: 1px solid #ddd;
      padding: 8px 0;
      margin-top: 15px;
      font-size: 8px;
      line-height: 1.6;
      letter-spacing: 0.3px;
    }
    
    .payment-notes p {
      margin: 3px 0;
    }
    
    /* FOOTER */
    .footer {
      text-align: center;
      margin-top: 15px;
      font-size: 8px;
      border-top: 1px solid #ddd;
      padding-top: 10px;
    }
    
    .footer img {
      height: 30px;
      object-fit: contain;
      filter: grayscale(100%);
    }
    
    /* PRINT STYLES */
    @media print {
      body {
        background: white;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- PHARMACY HEADER -->
    <div class="pharmacy-header">
      <h1>{{pharmacy.name}}</h1>
      <p>{{pharmacy.address}}</p>
      <p>Phone: {{pharmacy.contactNumber}}</p>
    </div>

    <!-- INVOICE DETAILS -->
    <div class="invoice-details">
      <div class="invoice-detail-item">
        <span class="label">INVOICE ID:</span>
        <span class="value">{{invoice.id}}</span>
      </div>
      <div class="invoice-detail-item right">
        <span class="label">DATE:</span>
        <span class="value">{{invoice.createdAt}}</span>
      </div>
    </div>

    <!-- CUSTOMER & PAYMENT DETAILS BOX -->
    <div class="customer-payment-box">
      <div class="customer-section">
        <h3>CUSTOMER DETAILS</h3>
        <p class="customer-name">{{invoice.customerName}}</p>
        <p>{{invoice.mobile}}</p>
      </div>
      <div class="payment-section">
        <h3>PAYMENT DETAILS</h3>
        <p><strong>{{billing.paymentMethod}}</strong></p>
        {{#if invoice.paymentNotes}}
        <p>{{invoice.paymentNotes}}</p>
        {{/if}}
      </div>
    </div>

    <!-- ITEMS TABLE -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 30%;">MEDICINE</th>
          <th style="width: 8%; text-align: center;">QTY</th>
          <th style="width: 12%; text-align: right;">MRP</th>
          <th style="width: 12%; text-align: right;">AMOUNT</th>
          <th style="width: 10%; text-align: center;">DISC %</th>
          <th style="width: 10%; text-align: center;">GST %</th>
          <th style="width: 14%; text-align: right;">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        {{#each medicines}}
        <tr>
          <td>
            <p class="medicine-name">{{this.medicineName}}</p>
          </td>
          <td class="text-center">{{this.quantity}}</td>
          <td class="text-right">{{this.mrp}}</td>
          <td class="text-right">{{this.amount}}</td>
          <td class="text-center">{{this.discountPercent}}</td>
          <td class="text-center">{{this.gstPercentage}}</td>
          <td class="text-right"><strong>{{this.total}}</strong></td>
        </tr>
        {{/each}}
      </tbody>
    </table>

    <!-- AMOUNT SUMMARY -->
    <div class="amount-summary">
      <div class="summary-box">
        <div class="summary-row">
          <span class="label">Subtotal</span>
          <span class="value">{{billing.price}}</span>
        </div>
        <div class="summary-row">
          <span class="label">Discount</span>
          <span class="value">-{{billing.discount}}</span>
        </div>
        <div class="summary-row">
          <span class="label">GST (CGST+SGST)</span>
          <span class="value">{{billing.tax}}</span>
        </div>
        <div class="summary-row total">
          <span class="label">TOTAL AMOUNT</span>
          <span class="value">{{billing.totalPrice}}</span>
        </div>
      </div>
    </div>

    <!-- PAYMENT NOTES -->
    <div class="payment-notes">
      <p>◦ Schedule H and H1 medicines are sold only with valid prescriptions.</p>
      <p>◦ Verify medicine details, expiry and quantity before leaving pharmacy.</p>
      <p>◦ Store medicines properly and keep away from sunlight and children always.</p>
      <p>◦ {{pharmacy.name}} will not be responsible for medicine misuse or overdose.</p>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <img src="https://infinitymedisetu.com/assets/images/logoDark.svg" alt="Medisetu Logo">
    </div>
  </div>
</body>
</html>
`;
