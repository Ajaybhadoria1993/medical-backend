import { brandLogoHtml } from '../../../htmltamplates/brandLogo';
export const labReportTemplate1 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{{lab.name}} - Laboratory Report</title>
<style>
  @page { size: A4; margin: 0; }
  :root {
    --color1: {{colors.color1}};
    --color2: {{colors.color2}};
    --color3: {{colors.color3}};
    --color4: {{colors.color4}};
    --color5: {{colors.color5}};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #ffffff;
    color: var(--color3);
    font-family: Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { width: 210mm; min-height: 297mm; padding: 13mm 12mm 10mm; margin: 0 auto; }
  .header { border-bottom: 2px solid var(--color1); padding-bottom: 9px; }
  .header-main { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
  .lab-name { color: var(--color1); font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; }
  .lab-address { color: var(--color4); font-size: 10px; margin-top: 5px; max-width: 570px; }
  .lab-contact { color: var(--color1); font-size: 11px; text-align: right; white-space: nowrap; line-height: 1.6; }
  .accent { height: 7px; margin-top: 8px; background: linear-gradient(135deg, var(--color1) 0 68%, var(--color5) 68% 73%, var(--color1) 73% 78%, var(--color2) 78%); }
  .patient { display: grid; grid-template-columns: 1.1fr 1.4fr .8fr; gap: 16px; padding: 12px 4px 10px; border-bottom: 1px solid var(--color5); }
  .patient-block { min-width: 0; }
  .patient-name { color: var(--color1); font-weight: 800; font-size: 16px; margin-bottom: 6px; }
  .label { color: var(--color4); font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .value { color: var(--color3); font-size: 11px; margin-left: 5px; }
  .patient-line { line-height: 1.7; }
  .report-title { color: var(--color1); font-size: 20px; font-weight: 800; text-align: center; text-transform: uppercase; padding: 11px 0 8px; }
  .test { break-inside: avoid; page-break-inside: avoid; margin-bottom: 16px; }
  .test-title { color: var(--color1); background: var(--color2); border-top: 1px solid var(--color5); border-bottom: 1px solid var(--color5); padding: 7px 9px; font-size: 15px; font-weight: 800; }
  .test-code { color: var(--color4); font-size: 10px; font-weight: 400; margin-left: 7px; }
  .rich-text-section { color: var(--color4); font-size: 10px; padding: 8px 9px 0; }
  .rich-text-label { color: var(--color1); font-weight: 700; margin-bottom: 3px; }
  .rich-text { line-height: 1.45; }
  .rich-text p { margin: 0 0 4px; }
  .rich-text ul, .rich-text ol { margin: 4px 0 4px 18px; padding-left: 14px; }
  .rich-text li { margin: 2px 0; }
  .rich-text blockquote { margin: 4px 0; padding-left: 8px; border-left: 2px solid var(--color5); }
  .test > table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .test > table th { color: var(--color1); background: var(--color2); text-align: left; font-size: 10px; padding: 6px 8px; border-bottom: 1px solid var(--color5); }
  .test > table td { color: var(--color3); font-size: 11px; padding: 7px 8px; border-bottom: 1px solid var(--color5); vertical-align: top; word-break: break-word; }
  .test > table th:nth-child(1), .test > table td:nth-child(1) { width: 35%; }
  .test > table th:nth-child(2), .test > table td:nth-child(2) { width: 25%; }
  .test > table th:nth-child(3), .test > table td:nth-child(3) { width: 25%; }
  .test > table th:nth-child(4), .test > table td:nth-child(4) { width: 15%; }
  .rich-text table { width: 100%; margin: 6px 0; border-collapse: collapse; table-layout: auto; }
  .rich-text th, .rich-text td { border: 1px solid var(--color5); padding: 5px 6px; vertical-align: top; word-break: break-word; }
  .rich-text th { color: var(--color1); background: var(--color2); text-align: left; font-weight: 700; }
  .rich-text td { color: var(--color3); }
  .parameter-name { font-weight: 700; }
  .required { color: var(--color1); font-size: 8px; margin-left: 3px; }
  .footer { background: var(--color2); display: flex; justify-content: space-between; align-items: center; margin-top: 18px; padding: 9px 10px; color: var(--color2); font-size: 9px; text-align: center; }
  .footer-logo { width: 150px; max-height: 20px; object-fit: contain; margin-bottom: 5px; }
  .footer-note { color: var(--color1); margin-top: 4px; }
</style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div class="header-main">
        <div>
          <div class="lab-name">{{lab.name}}</div>
          <div class="lab-address">{{lab.address}}</div>
        </div>
        <div class="lab-contact">
          {{#if lab.contactNo}}{{lab.contactNo}}<br>{{/if}}
          {{#if lab.email}}{{lab.email}}{{/if}}
        </div>
      </div>
      <div class="accent"></div>
    </header>

    <section class="patient">
      <div class="patient-block">
        <div class="patient-name">{{patient.name}}</div>
        <div class="patient-line"><span class="label">Age</span><span class="value">{{patient.age}}</span></div>
        <div class="patient-line"><span class="label">Sex</span><span class="value">{{patient.gender}}</span></div>
        <div class="patient-line"><span class="label">Mobile</span><span class="value">{{patient.mobile}}</span></div>
      </div>
      <div class="patient-block">
        <div class="patient-line"><span class="label">Report Date</span><span class="value">{{reportDate}}</span></div>
        <div class="patient-line"><span class="label">Ref. By</span><span class="value">{{referringDoctorName}}</span></div>
      </div>
      <div class="patient-block"></div>
    </section>

    <div class="report-title">Laboratory Report</div>

    {{#each tests}}
      <section class="test">
        <div class="test-title">{{testName}} <span class="test-code">({{testCode}})</span></div>
        <table>
          <thead><tr><th>Investigation</th><th>Result</th><th>Reference Value</th><th>Unit</th></tr></thead>
          <tbody>
            {{#each parameters}}
              <tr>
                <td class="parameter-name">{{parameterName}}{{#if isRequired}}<span class="required">*</span>{{/if}}</td>
                <td>{{resultValue}}</td>
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

    <div style="margin-top: 60px; font-weight: bold; display: flex; justify-content: flex-end; text-align: center;">
    	<div style="display: flex; flex-direction: column; align-items: center;"> <p style="margin: 0;">___________________</p>
        <p style="margin: 8px 0 0;">Lab Incharge</p>
        </div>
     </div>

    <footer class="footer">
      <div style="margin-bottom:5px;">${brandLogoHtml(20, 12)}</div>
      <div class="footer-note">This is a computer-generated report and is valid without a signature.</div>
    </footer>
  </main>
</body>
</html>
`;
