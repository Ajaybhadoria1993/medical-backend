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
      <img src="https://infninity-medisatu.s3.ap-south-1.amazonaws.com/ims/Logo%20V1.png" alt="Infinity MediSetu">
    </div>
    <div class="invoice-title">
      <p><strong>Invoice No:</strong> {{invoiceNumber}}</p>
      <p><strong>Date/Time:</strong> {{currentDateTime}}</p>
    </div>
  </div>
  <div class="company-details">
    <strong>Infinity Medisetu</strong><br>
    <strong>GSTIN: </strong>23AAFCI1029R1ZF
  </div>
  <div class="info-grid">
    <div class="info-box">
      <div class="section-title">Clinic Details</div>
      <div class="info-row"><span class="info-label">Name:</span> <span class="info-value">{{clinicName}}</span></div>
      <div class="info-row"><span class="info-label">Address:</span> <span class="info-value">{{clinicAddress}}</span></div>
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
  <table>
    <thead>
      <tr>
        <th>Plan</th>
        <th>Start Date</th>
        <th>End Date</th>
        <th>Transaction Date/Time</th>
        <th>Transaction ID</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>{{planName}}</strong><br><span style="font-size: 10px; text-transform: lowercase;">({{planDescription}})</span></td>
        <td>{{startsAt}}</td>
        <td>{{expiresAt}}</td>
        <td>{{createdAt}}</td>
        <td>{{transactionId}}</td>
        <td>{{subtotal}}</td>
      </tr>
      <tr>
        <td colspan="5" style="font-size:12px; text-align:right; line-height: 20px;">
          <p>CGST (9%)</p>
          <p>SGST (9%)</p>
        </td>
        <td style="line-height: 20px; white-space: nowrap;">
          <p>+ {{cgst}}</p>
          <p>+ {{sgst}}</p>
        </td>
      </tr>
      <tr class="grand-total">
        <td colspan="5" style="text-align:right; font-weight:bold;">Grand Total</td>
        <td style="font-weight:bold;">{{grandTotal}}</td>
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
    For queries: support@infinitymedisetu.com
</div>
</body>
</html>
`;
