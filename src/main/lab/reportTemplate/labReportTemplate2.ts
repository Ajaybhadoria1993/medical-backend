export const labReportTemplate2 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{lab.name}} - Laboratory Report</title>
<style>
  @page { size: A4; margin: 0; }
  :root {
    --brand: {{colors.color1}};
    --brand-soft: {{colors.color2}};
    --ink: {{colors.color3}};
    --muted: {{colors.color4}};
    --line: {{colors.color5}};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #eef3f7;
    color: var(--ink);
    font-family: Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: #ffffff;
  }
  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 22px;
    min-height: 88px;
    padding: 14px 22px 13px;
    background: var(--brand);
    color: #ffffff;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .logo {
    width: 43px;
    height: 43px;
    flex: 0 0 43px;
    object-fit: contain;
  }
  .logo-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid rgba(255, 255, 255, .9);
    border-radius: 50%;
    color: #ffffff;
    font-size: 23px;
    font-weight: 700;
  }
  .lab-name {
    font-size: 22px;
    font-weight: 800;
    line-height: 1.08;
    letter-spacing: .15px;
  }
  .lab-address {
    margin-top: 5px;
    color: rgba(255, 255, 255, .82);
    font-size: 9px;
    line-height: 1.35;
  }
  .contact {
    flex: 0 0 auto;
    color: #ffffff;
    font-size: 9px;
    line-height: 1.6;
    text-align: right;
  }
  .contact-label {
    color: rgba(255, 255, 255, .72);
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .patient-bar {
    display: flex;
    align-items: stretch;
    gap: 0;
    margin: 0 18px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
  }
  .patient-details {
    display: grid;
    grid-template-columns: 1.35fr .72fr .72fr 1.25fr;
    flex: 1 1 auto;
    min-width: 0;
    gap: 0;
  }
  .patient-main,
  .patient-detail {
    min-width: 0;
    padding: 0 9px;
    border-right: 1px solid var(--line);
  }
  .patient-main { padding-left: 0; }
  .patient-name {
    color: #111827;
    font-size: 13px;
    font-weight: 800;
    line-height: 1.25;
  }
  .patient-line {
    margin-top: 3px;
    color: var(--muted);
    font-size: 8px;
    line-height: 1.35;
  }
  .label {
    color: var(--muted);
    font-size: 7px;
    font-weight: 700;
    letter-spacing: .45px;
    text-transform: uppercase;
  }
  .value {
    color: var(--ink);
    font-size: 9px;
    font-weight: 700;
    word-break: break-word;
  }
  .qr-panel {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 0 0 93px;
    padding-left: 9px;
  }
  .qr-panel img {
    width: 62px;
    height: 62px;
    display: block;
  }
  .qr-label {
    color: var(--muted);
    font-size: 7px;
    line-height: 1.25;
    text-align: center;
  }
  .report-title {
    padding: 7px 18px 6px;
    border-bottom: 2px solid var(--brand);
    color: #111827;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: .8px;
    text-align: center;
    text-transform: uppercase;
  }
  .report-date {
    padding: 5px 18px 0;
    color: var(--muted);
    font-size: 8px;
    text-align: right;
  }
  .tests { padding: 0 18px; }
  .test {
    break-inside: avoid;
    page-break-inside: avoid;
    margin-top: 10px;
  }
  .test-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 6px 8px;
    background: var(--brand-soft);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .test-name {
    color: var(--brand);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .test-code {
    color: var(--muted);
    font-size: 8px;
    white-space: nowrap;
  }
  .test > table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .test > table th {
    padding: 5px 7px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 7px;
    font-weight: 700;
    letter-spacing: .45px;
    text-align: left;
    text-transform: uppercase;
  }
  .test > table td {
    padding: 6px 7px;
    border-bottom: 1px solid #e8edf2;
    color: var(--ink);
    font-size: 9px;
    line-height: 1.3;
    vertical-align: top;
    word-break: break-word;
  }
  .test > table th:nth-child(1), .test > table td:nth-child(1) { width: 37%; }
  .test > table th:nth-child(2), .test > table td:nth-child(2) { width: 22%; }
  .test > table th:nth-child(3), .test > table td:nth-child(3) { width: 26%; }
  .test > table th:nth-child(4), .test > table td:nth-child(4) { width: 15%; }
  .parameter-name { font-weight: 700; }
  .result { color: var(--brand); font-weight: 800; }
  .required { color: var(--brand); font-size: 7px; margin-left: 2px; }
  .rich-text-section {
    padding: 6px 7px 0;
    color: var(--muted);
    font-size: 8px;
    line-height: 1.4;
  }
  .rich-text-label { color: var(--brand); font-weight: 700; margin-bottom: 2px; }
  .rich-text p { margin: 0 0 3px; }
  .rich-text ul, .rich-text ol { margin: 3px 0 3px 16px; padding-left: 12px; }
  .rich-text li { margin: 1px 0; }
  .signoff {
    display: flex;
    justify-content: flex-end;
    margin: 34px 18px 0;
    page-break-inside: avoid;
  }
  .signature {
    min-width: 132px;
    padding-top: 6px;
    border-top: 1px solid var(--brand);
    color: var(--ink);
    font-size: 9px;
    font-weight: 700;
    text-align: center;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    margin: 16px 18px 0;
    padding: 7px 0 10px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 7px;
    line-height: 1.35;
  }
  .footer-note { text-align: right; }
</style>
</head>
<body>
  <main class="page">
    <header class="masthead">
      <div class="brand">
        {{#if lab.logo}}
          <img class="logo" src="{{lab.logo}}" alt="{{lab.name}} logo">
        {{else}}
          <div class="logo logo-fallback">+</div>
        {{/if}}
        <div>
          <div class="lab-name">{{lab.name}}</div>
          <div class="lab-address">{{lab.address}}</div>
        </div>
      </div>
      <div class="contact">
        {{#if lab.gstNumber}}<div class="contact-label">Regd. / GST No.</div>{{lab.gstNumber}}<br>{{/if}}
        {{#if lab.contactNo}}{{lab.contactNo}}<br>{{/if}}
        {{#if lab.email}}{{lab.email}}{{/if}}
      </div>
    </header>

    <section class="patient-bar">
      <div class="patient-details">
        <div class="patient-main">
          <div class="patient-name">{{patient.name}}</div>
          <div class="patient-line"><span class="label">Age</span> <span class="value">{{patient.age}}</span></div>
          <div class="patient-line"><span class="label">Sex</span> <span class="value">{{patient.gender}}</span></div>
        </div>
        <div class="patient-detail">
          <div class="label">Referred by</div>
          <div class="value">{{referringDoctorName}}</div>
        </div>
        <div class="patient-detail">
          <div class="label">Report date</div>
          <div class="value">{{reportDate}}</div>
        </div>
        <div class="patient-detail">
          <div class="label">Mobile</div>
          <div class="value">{{patient.mobile}}</div>
        </div>
      </div>
      {{#if reportPdf}}
        {{#if reportQrCode}}
          <div class="qr-panel">
            <img src="{{{reportQrCode}}}" alt="Scan to download report">
            <div class="qr-label">Scan to<br>download</div>
          </div>
        {{/if}}
      {{/if}}
    </section>

    <div class="report-title">Laboratory Report</div>
    <div class="report-date">Report generated: {{reportDate}}</div>

    <section class="tests">
      {{#each tests}}
        <section class="test">
          <div class="test-heading">
            <div class="test-name">{{testName}}</div>
            <div class="test-code">{{testCode}}</div>
          </div>
          <table>
            <thead><tr><th>Investigation</th><th>Result</th><th>Reference Value</th><th>Unit</th></tr></thead>
            <tbody>
              {{#each parameters}}
                <tr>
                  <td class="parameter-name">{{parameterName}}{{#if isRequired}}<span class="required">*</span>{{/if}}</td>
                  <td class="result">{{resultValue}}</td>
                  <td>{{referenceRange}}</td>
                  <td>{{unit}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
          {{#if comments}}<div class="rich-text-section"><div class="rich-text-label">Comments</div><div class="rich-text">{{{comments}}}</div></div>{{/if}}
          {{#if interpretation}}<div class="rich-text-section"><div class="rich-text-label">Interpretation</div><div class="rich-text">{{{interpretation}}}</div></div>{{/if}}
          {{#if notes}}<div class="rich-text-section"><div class="rich-text-label">Notes</div><div class="rich-text">{{{notes}}}</div></div>{{/if}}
        </section>
      {{/each}}
    </section>

    <div class="signoff"><div class="signature">Lab Incharge</div></div>
    <footer class="footer">
      <div>{{lab.name}}</div>
      <div class="footer-note">{{#if lab.reportFooter}}{{lab.reportFooter}}{{else}}This is a computer-generated report and is valid without a signature.{{/if}}</div>
    </footer>
  </main>
</body>
</html>
`;
