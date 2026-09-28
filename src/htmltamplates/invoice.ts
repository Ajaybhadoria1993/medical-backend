export const invoiceTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice - {{invoice.id}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family={{templateConfig.primaryFont}}&family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet">
<style>
    @page { size: A4; margin: 0; }
    :root {
         --color1: #0A6C74;
  --color2: #EBFCF4;
  --color3: #333333;
  --color4: #666666;
  --color5: #e0e0e0;
  --color6: #b22222;
  --color7: #f9f9f9;
  --color8: #ffffff;
  --color9: #000000;
  --color10: #856404;
    }
    body { 
        font-family: {{templateConfig.fontFamily}};
        margin: 0; padding: 0;
        color: var(--color3);
        line-height: 1.4;
        background-color: var(--color7);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .container {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: var(--color8);
        position: relative;
        display: flex;
        flex-direction: column;
    }
    /* Header Background with Curves */
    .header-bg {
        height: 120px;
        background-color: var(--color1);
        position: relative;
        overflow: hidden;
    }
    .header-bg::after {
        content: "";
        position: absolute;
        bottom: -80px; left: 0; right: 0;
        height: 100px;
        background: var(--color2);
        border-radius: 50% 50% 0 0;
        transform: scaleX(1.5);
    }
    .header-content {
        position: absolute;
        top: 0; left: 0; width: 100%;
        padding: 20px 40px;
        z-index: 10;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: var(--color8);
        box-sizing: border-box;
    }
    .hospital-brand { display: flex; align-items: center; gap: 15px; }
    .hospital-logo { 
        width: 50px; 
        height: 50px; 
        object-fit: contain;
    }
    .hospital-name { 
        font-family: 'Playfair Display', serif;
        font-size: 24px; 
        font-weight: 800; 
    }
    .hospital-tagline { 
        font-size: 12px; 
        opacity: 0.9; 
        font-style: italic;
    }

    /* Light Green Strip for Logo */
    .logo-strip {
        background-color: var(--color2);
        padding: 8px 40px;
        display: flex;
        justify-content: flex-end;
        border-bottom: 1px solid var(--color5);
    }

    /* Main Layout */
    .main-layout { display: flex; flex: 1; }
    
    /* Left Sidebar */
    .sidebar {
        width: 25%;
        border-right: 2px solid var(--color1);
        padding: 30px 20px;
        font-size: 11px;
        background: var(--color8);
    }
    .sidebar-section { margin-bottom: 25px; }
    .sidebar-label { 
        font-weight: 700; 
        font-size: 13px; 
        margin-bottom: 8px; 
        color: var(--color1); 
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .pharmacy-name { 
        font-size: 16px; 
        font-weight: 700; 
        color: var(--color9); 
        margin-bottom: 4px; 
        font-family: 'Playfair Display', serif;
    }
    .pharmacy-detail { 
        color: var(--color4); 
        margin-bottom: 4px;
        font-size: 10px;
    }
    .pharmacy-address {
        line-height: 1.6;
        color: var(--color4);
        font-size: 10px;
    }
    .license-info {
        font-size: 9px;
        color: var(--color1);
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed var(--color5);
    }

    /* Right Content */
    .content-area { 
        width: 75%; 
        padding: 25px 30px; 
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: calc(100% - 120px);
    }
    
    /* Invoice Title */
    .invoice-title {
        font-family: 'Playfair Display', serif;
        font-size: 28px;
        font-weight: 700;
        color: var(--color1);
        margin: 0px 0 15px;
        opacity: 0.8;
        text-align: center;
        letter-spacing: 2px;
    }

    /* Customer and Invoice Grid - Reduced size */
    .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-bottom: 15px;
    }
    .info-card {
        background: var(--color7);
        border-radius: 6px;
        padding: 10px;
        border: 1px solid var(--color5);
    }
    .info-header {
        font-family: 'Playfair Display', serif;
        font-size: 12px;
        font-weight: 600;
        color: var(--color1);
        margin-bottom: 6px;
        border-bottom: 1px solid var(--color2);
        padding-bottom: 3px;
    }
    .info-row {
        display: flex;
        margin-bottom: 3px;
        font-size: 10px;
    }
    .info-label {
        font-weight: 600;
        color: var(--color4);
        width: 60px;
    }
    .info-value {
        color: var(--color3);
        flex: 1;
    }

    /* Doctor Badge - Compact */
    .doctor-badge {
        background: linear-gradient(135deg, var(--color2) 0%, var(--color7) 100%);
        border-radius: 6px;
        padding: 8px 12px;
        margin-bottom: 15px;
        border-left: 3px solid var(--color1);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 15px;
    }
    .doctor-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--color1);
    }
    .doctor-speciality {
        font-size: 10px;
        color: var(--color4);
    }
    .doctor-reg {
        font-size: 9px;
        color: var(--color3);
        margin-left: auto;
    }

    /* Table Styles */
    .table-container {
        margin: 10px 0;
        overflow-x: auto;
    }
    .invoice-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 9px;
    }
    .invoice-table th {
        background: linear-gradient(to right, var(--color7), var(--color8));
        color: var(--color1);
        font-weight: 600;
        padding: 6px 4px;
        text-align: left;
        border-bottom: 2px solid var(--color1);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
    }
    .invoice-table td {
        padding: 5px 4px;
        border-bottom: 1px solid var(--color5);
        color: var(--color3);
    }
    .medicine-name {
        font-weight: 600;
        color: var(--color9);
        font-size: 9px;
    }
    .text-right {
        text-align: right;
    }

    /* Summary Box - Bottom Right */
    .summary-wrapper {
        display: flex;
        justify-content: flex-end;
        margin-top: auto;
    }
    .summary-box {
        width: 280px;
        background: var(--color7);
        border-radius: 6px;
        padding: 12px;
        border: 1px solid var(--color2);
    }
    .summary-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 10px;
    }
    .summary-row.total {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid var(--color1);
        font-weight: 700;
        font-size: 12px;
        color: var(--color1);
    }
    .summary-label {
        color: var(--color4);
    }
    .summary-amount {
        font-weight: 600;
        color: var(--color3);
    }
    .total-amount {
        color: var(--color1);
        font-size: 14px;
    }

    /* Simple Payment Display - No pill */
    .payment-simple {
        font-size: 10px;
        color: var(--color3);
        font-weight: 500;
    }

    /* Footer */
    .footer-bg {
        height: 60px;
        background-color: var(--color1);
        position: relative;
        overflow: hidden;
        margin-top: auto;
    }
    .footer-bg::before {
        content: "";
        position: absolute;
        top: -40px; left: 0; right: 0;
        height: 80px;
        background: var(--color2);
        border-radius: 0 0 50% 50%;
        transform: scaleX(1.5);
    }
    .footer-text {
        position: absolute;
        bottom: 10px;
        right: 40px;
        color: var(--color8); 
        font-size: 9px; 
        font-weight: 500;
        font-style: italic;
    }
    .footer-note {
        position: absolute;
        bottom: 10px;
        left: 40px;
        color: var(--color8);
        font-size: 8px;
        opacity: 0.8;
    }
</style>
</head>
<body>
<div class="container">
    <div class="header-bg">
        <div class="header-content">
            <div class="hospital-brand">
                {{#if clinic.clinicLogo}}
                    <img src="{{clinic.clinicLogo}}" class="hospital-logo" alt="clinic logo" />
                {{/if}}
                <div>
                    <div class="hospital-name">{{clinic.clinicName}}</div>
                    <div class="hospital-tagline">{{clinic.tagline}}</div>
                </div>
            </div>
            <div style="text-align: right; font-size: 12px;">
                <div style="font-weight: 600;">Invoice #: {{invoice.id}}</div>
                <div style="font-size: 11px;">Date: {{invoice.createdAt}}</div>
            </div>
        </div>
    </div>

    <!-- Logo in Light Green Strip -->
    <div class="logo-strip">
        <img src="https://infninity-medisatu.s3.ap-south-1.amazonaws.com/ims/Logo%20V1.png" 
             alt="Infinity Medisetu" 
             style="height: 30px; width: auto; object-fit: contain;" />
    </div>

    <div class="main-layout">
        <div class="sidebar">
            <div class="sidebar-section">
                <div class="pharmacy-name">{{pharmacy.name}}</div>
                <div class="pharmacy-detail">{{pharmacy.type}}</div>
                <div class="pharmacy-address">
                    {{pharmacy.address}}<br>
                    {{pharmacy.city}} {{pharmacy.state}} - {{pharmacy.zipcode}}
                </div>
            </div>

            <div class="sidebar-section">
                <div class="pharmacy-name">Contact Details</div>
                <div class="pharmacy-detail">Phone: {{pharmacy.contactNumber}}</div>
                <div class="pharmacy-detail">Email: {{pharmacy.email}}</div>
                {{#if pharmacy.licenseNumber}}
                <div class="license-info">
                    <strong>License:</strong> {{pharmacy.licenseNumber}}<br>
                    <strong>GST:</strong> {{pharmacy.gstNumber}}
                </div>
                {{/if}}
            </div>
 
            </div>
         

        <div class="content-area">
            <div class="invoice-title">INVOICE</div>

            <!-- Customer and Invoice Information - Reduced Size -->
            <div class="info-grid">
                <div class="info-card">
                    <div class="info-header">Customer Details</div>
                    <div class="info-row">
                        <span class="info-label">Name:</span>
                        <span class="info-value">{{invoice.customerName}}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Mobile:</span>
                        <span class="info-value">{{invoice.mobile}}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Address:</span>
                        <span class="info-value">{{invoice.address}}</span>
                    </div>
                </div>

                <div class="info-card">
                    <div class="info-header">Invoice Details</div>
                    <div class="info-row">
                        <span class="info-label">Invoice:</span>
                        <span class="info-value">{{invoice.id}}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Date:</span>
                        <span class="info-value">{{invoice.createdAt}}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Payment:</span>
                        <span class="info-value payment-simple">{{billing.paymentMethod}}</span>
                    </div>
                </div>
            </div>

            <!-- Doctor Information - Compact -->
            {{#if doctor}}
            <div class="doctor-badge">
                <span class="doctor-name">Dr. {{doctor.name}}</span>
                <span class="doctor-speciality">{{doctor.speciality}}</span>
                <span class="doctor-reg">Reg: {{doctor.licenseNumber}}</span>
            </div>
            {{/if}}

            <!-- Medicines Table -->
            <div class="table-container">
                <table class="invoice-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Medicine Name</th>
                            <th>Qty</th>
                            <th>Expiry</th>
                            <th class="text-right">GST %</th>
                            <th class="text-right">GST Amt</th>
                            <th class="text-right">Unit Price</th>
                            <th class="text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {{#each medicines}}
                        <tr>
                            <td>{{addOne @index}}</td>
                            <td>
                                <span class="medicine-name">{{this.medicineName}}</span>
                                {{#if this.strength}}
                                <br><span style="font-size: 7px; color: var(--color4);">{{this.strength}}</span>
                                {{/if}}
                            </td>
                            <td>{{this.quantity}}</td>
                            <td>{{this.expiryDate}}</td>
                            <td class="text-right">{{this.gstPercent}}%</td>
                            <td class="text-right">₹{{this.gstAmount}}</td>
                            <td class="text-right">₹{{this.sellingPriceExclGst}}</td>
                            <td class="text-right">₹{{this.totalPrice}}</td>
                        </tr>
                        {{/each}}
                    </tbody>
                </table>
            </div>

            <!-- Billing Summary - Bottom Right -->
            <div class="summary-wrapper">
                <div class="summary-box">
                    <div class="summary-row">
                        <span class="summary-label">Subtotal (Excl. GST):</span>
                        <span class="summary-amount">₹{{billing.price}}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">Discount:</span>
                        <span class="summary-amount">- ₹{{billing.discount}}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">GST:</span>
                        <span class="summary-amount">+ ₹{{billing.tax}}</span>
                    </div>
                    <div class="summary-row total">
                        <span class="summary-label">Total Amount:</span>
                        <span class="summary-amount total-amount">₹{{billing.totalPrice}}</span>
                    </div>
                </div>
            </div>

            <!-- Additional Notes -->
            {{#if invoice.notes}}
            <div style="margin-top: 10px; padding: 6px; background: var(--color7); border-radius: 4px; font-size: 8px; color: var(--color4);">
                <strong>Note:</strong> {{invoice.notes}}
            </div>
            {{/if}}
        </div>
    </div>

    <div class="footer-bg">
        <div class="footer-note">This is a computer generated invoice</div>
        <div class="footer-text">Thank you for your business!</div>
    </div>
</div>
</body>
</html>
`;
