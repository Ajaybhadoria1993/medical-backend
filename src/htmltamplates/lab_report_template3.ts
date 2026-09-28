export const labReportTemplate3 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lab Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family={{templateConfig.primaryFont}}&display=swap" rel="stylesheet">
<style>
    @page { size: A4; margin: 0; }
    :root {
        --color1: {{templateConfig.colors.color1}};
        --color2: {{templateConfig.colors.color2}};
        --color3: {{templateConfig.colors.color3}};
        --color4: {{templateConfig.colors.color4}};
        --color5: {{templateConfig.colors.color5}};
        --color6: {{templateConfig.colors.color6}};
        --color7: {{templateConfig.colors.color7}};
        --color8: {{templateConfig.colors.color8}};
        --color9: {{templateConfig.colors.color9}};
        --color10: {{templateConfig.colors.color10}};
    }
    * { box-sizing: border-box; }
    body {
        font-family: '{{templateConfig.fontFamily}}', Arial, sans-serif;
        margin: 0; padding: 0;
        color: var(--color3);
        line-height: 1.45;
        background-color: #fffef7;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .pad {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: #fffef7;
        position: relative;
        display: flex;
        flex-direction: column;
        border-top: 8px solid var(--color1);
        padding-bottom: 20mm;
    }

    /* ---------- Letterhead ---------- */
    .letterhead {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 24px 40px 16px;
        border-bottom: 2px solid var(--color2);
    }
    .clinic-block {
        max-width: 70%;
    }
    .clinic-name {
        font-size: 22px;
        font-weight: 800;
        color: var(--color3);
    }
    .clinic-meta {
        font-size: 11px;
        color: var(--color4);
        margin-top: 5px;
    }

    /* ---------- Patient Details ---------- */
    .patient-section {
        padding: 20px 40px;
    }
    .patient-card {
        background: #fefbf5;
        border: 1px solid #e9e0cf;
        border-radius: 8px;
        padding: 14px 20px;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px 24px;
    }
    .info-label {
        font-size: 10px;
        text-transform: uppercase;
        color: var(--color4);
        font-weight: 800;
        letter-spacing: 0.5px;
    }
    .info-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--color9);
        margin-top: 1px;
    }

    /* ---------- Result Table ---------- */
    .result-section {
        flex: 1;
        padding: 20px 40px;
    }
    .result-table {
        width: 100%;
        border-collapse: collapse;
    }
    .result-table th {
        text-align: left;
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        color: var(--color1);
        padding: 8px 10px;
        border-bottom: 2px solid var(--color2);
    }
    .result-table td {
        padding: 12px 10px;
        border-bottom: 1px dashed var(--color5);
    }
    .param-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--color3);
    }
    .result-val {
        font-size: 13px;
        font-weight: 700;
        color: var(--color9);
    }
    .result-unit, .result-range {
        font-size: 12px;
        color: var(--color4);
    }
    .flag-badge {
        font-size: 12px;
        font-weight: 700;
    }
    .flag-badge[data-flag="High"] { color: var(--color6); }
    .flag-badge[data-flag="Low"] { color: #D97706; }
    .flag-badge[data-flag="Normal"] { color: #16A34A; }

    /* ---------- Remarks ---------- */
    .remarks-section {
        margin: 20px 40px;
        padding: 16px;
        background-color: #fef6e7;
        border: 1px solid #ebd0a7;
        border-radius: 6px;
    }
    .remarks-title {
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        color: var(--color10);
        margin-bottom: 4px;
        letter-spacing: 0.5px;
    }
    .remarks-text {
        font-size: 12px;
        color: var(--color3);
    }

    /* ---------- Footer ---------- */
    .footer {
        padding: 20px 40px 0;
        margin-top: auto;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        border-top: 1px dashed var(--color5);
    }
    .footer-left {
        font-size: 10px;
        color: var(--color4);
        line-height: 1.5;
    }
    .footer-right {
        text-align: right;
    }
    .sig-line {
        width: 150px;
        border-bottom: 1px solid var(--color2);
        margin-bottom: 4px;
    }
    .sig-label {
        font-size: 11px;
        font-weight: 800;
        color: var(--color9);
    }
</style>
</head>
<body>
<div class="pad">
    <header class="letterhead">
        <div class="clinic-block">
            <div class="clinic-name">{{clinic.name}}</div>
            <div class="clinic-meta">
                {{clinic.address}}
            </div>
        </div>
    </header>

    <section class="patient-section">
        <div class="patient-card">
            <div class="info-item">
                <div class="info-label">Patient Name</div>
                <div class="info-value">{{patient.name}}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Referral Doctor</div>
                <div class="info-value">{{doctor.name}}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Test Name</div>
                <div class="info-value">{{test.name}}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Category</div>
                <div class="info-value">{{test.category}}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Sample Type</div>
                <div class="info-value">{{template.sampleType}}</div>
            </div>
        </div>
    </section>

    <main class="result-section">
        <table class="result-table">
            <thead>
                <tr>
                    <th>Parameter</th>
                    <th>Result Value</th>
                    <th>Unit</th>
                    <th>Reference Range</th>
                    <th>Flag</th>
                </tr>
            </thead>
            <tbody>
                {{#each values}}
                <tr>
                    <td class="param-name">{{parameterName}}</td>
                    <td class="result-val">{{value}}</td>
                    <td class="result-unit">{{unit}}</td>
                    <td class="result-range">{{referenceRange}}</td>
                    <td class="flag-badge" data-flag="{{flag}}">{{flag}}</td>
                </tr>
                {{/each}}
            </tbody>
        </table>
    </main>

    {{#if labResult.remarks}}
    <section class="remarks-section">
        <div class="remarks-title">Remarks / Interpretations</div>
        <div class="remarks-text">{{labResult.remarks}}</div>
    </section>
    {{/if}}

    <footer class="footer">
        <div class="footer-left">
            This is a system-generated laboratory report.<br>
            Verified At: {{labResult.verifiedAt}}
        </div>
        <div class="footer-right">
            <div class="sig-line"></div>
            <div class="sig-label">Authorized Signatory</div>
        </div>
    </footer>
</div>
</body>
</html>
`;
