export const labReportTemplate = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Lab Report</title>
    <style>
      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Arial, Helvetica, sans-serif;
        color: #172033;
        background: #ffffff;
      }

      .page {
        width: 210mm;
        min-height: 297mm;
        padding: 28px 34px;
      }

      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        border-bottom: 2px solid #0f766e;
        padding-bottom: 16px;
        margin-bottom: 18px;
      }

      .brand h1 {
        margin: 0;
        font-size: 24px;
        color: #0f766e;
      }

      .brand p,
      .meta p,
      .info p {
        margin: 4px 0;
        font-size: 12px;
        color: #526078;
      }

      .badge {
        display: inline-block;
        padding: 5px 10px;
        border: 1px solid #0f766e;
        border-radius: 4px;
        color: #0f766e;
        font-weight: 700;
        font-size: 12px;
        text-transform: uppercase;
      }

      .section {
        margin-top: 16px;
      }

      .section-title {
        margin: 0 0 8px;
        font-size: 13px;
        color: #0f172a;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 22px;
        padding: 12px;
        border: 1px solid #dbe3ea;
        border-radius: 6px;
      }

      .label {
        font-size: 10px;
        color: #64748b;
        text-transform: uppercase;
        margin-bottom: 3px;
      }

      .value {
        font-size: 13px;
        font-weight: 700;
        color: #172033;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
        font-size: 12px;
      }

      th {
        text-align: left;
        background: #ecfdf5;
        color: #0f766e;
        border: 1px solid #cbd5e1;
        padding: 8px;
      }

      td {
        border: 1px solid #dbe3ea;
        padding: 8px;
        vertical-align: top;
      }

      .remarks {
        min-height: 54px;
        padding: 12px;
        border: 1px solid #dbe3ea;
        border-radius: 6px;
        font-size: 12px;
        color: #334155;
      }

      .footer {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        margin-top: 36px;
        padding-top: 16px;
        border-top: 1px solid #dbe3ea;
        color: #64748b;
        font-size: 11px;
      }

      .signature {
        text-align: right;
        min-width: 180px;
      }

      .signature-line {
        height: 34px;
        border-bottom: 1px solid #64748b;
        margin-bottom: 6px;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <div class="brand">
          <h1>{{clinic.name}}</h1>
          <p>{{clinic.address}}</p>
          <p>Lab Report</p>
        </div>
        <div class="meta">
          <span class="badge">{{labResult.status}}</span>
          <p><strong>Report ID:</strong> {{labResult.id}}</p>
          <p><strong>Generated:</strong> {{generatedAt}}</p>
        </div>
      </header>

      <section class="section">
        <h2 class="section-title">Patient And Test</h2>
        <div class="grid">
          <div>
            <div class="label">Patient</div>
            <div class="value">{{patient.name}}</div>
          </div>
          <div>
            <div class="label">Doctor</div>
            <div class="value">{{doctor.name}}</div>
          </div>
          <div>
            <div class="label">Test</div>
            <div class="value">{{test.name}}</div>
          </div>
          <div>
            <div class="label">Category</div>
            <div class="value">{{test.category}}</div>
          </div>
          <div>
            <div class="label">Appointment Date</div>
            <div class="value">{{appointment.date}}</div>
          </div>
          <div>
            <div class="label">Sample Type</div>
            <div class="value">{{template.sampleType}}</div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Result Values</h2>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Result</th>
              <th>Unit</th>
              <th>Reference Range</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {{#each values}}
              <tr>
                <td>{{parameterName}}</td>
                <td><strong>{{value}}</strong></td>
                <td>{{unit}}</td>
                <td>{{referenceRange}}</td>
                <td>{{flag}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Remarks</h2>
        <div class="remarks">{{labResult.remarks}}</div>
      </section>

      <footer class="footer">
        <div>
          <p>This is a system-generated laboratory report.</p>
          <p>Verified At: {{labResult.verifiedAt}}</p>
        </div>
        <div class="signature">
          <div class="signature-line"></div>
          <div>Authorized Signatory</div>
        </div>
      </footer>
    </main>
  </body>
</html>
`;
