export const labReportTemplate2 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lab Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family={{templateConfig.primaryFont}}&family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet">
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
        font-family: '{{templateConfig.fontFamily}}', Georgia, 'Times New Roman', serif;
        margin: 0; padding: 0;
        color: var(--color3);
        line-height: 1.45;
        background-color: var(--color8);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .pad {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: var(--color8);
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
        border-bottom: 2px solid var(--color1);
    }
    .clinic-block {
        max-width: 70%;
    }
    .clinic-name {
        font-family: 'Playfair Display', serif;
        font-size: 24px;
        font-weight: 700;
        color: var(--color1);
        line-height: 1.1;
    }
    .clinic-meta {
        font-size: 11px;
        color: var(--color4);
        margin-top: 6px;
        line-height: 1.4;
    }

    /* ---------- Patient Details ---------- */
    .patient-section {
        padding: 20px 40px;
    }
    .patient-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px 24px;
    }
    .info-item {
        border-bottom: 1px dotted var(--color4);
        padding-bottom: 4px;
    }
    .info-label {
        font-size: 10px;
        text-transform: uppercase;
        color: var(--color4);
        font-weight: 600;
    }
    .info-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--color9);
        margin-top: 2px;
    }

    /* ---------- Result Table ---------- */
    .result-section {
        flex: 1;
        padding: 24px 40px;
    }
    .result-title {
        font-family: 'Playfair Display', serif;
        font-size: 18px;
        color: var(--color1);
        margin-bottom: 12px;
        border-bottom: 1px solid var(--color2);
        padding-bottom: 6px;
    }
    .result-table {
        width: 100%;
        border-collapse: collapse;
    }
    .result-table th {
        font-family: 'Playfair Display', serif;
        text-align: left;
        font-size: 12px;
        font-weight: 700;
        color: var(--color1);
        padding: 10px;
        border-bottom: 2px solid var(--color1);
    }
    .result-table td {
        padding: 12px 10px;
        border-bottom: 1px solid var(--color5);
        font-size: 13px;
    }
    .param-name {
        font-weight: 700;
        color: var(--color9);
    }
    .flag-badge {
        font-weight: 700;
    }
    .flag-badge[data-flag="High"] { color: var(--color6); }
    .flag-badge[data-flag="Low"] { color: #D97706; }
    .flag-badge[data-flag="Normal"] { color: #16A34A; }

    /* ---------- Remarks ---------- */
    .remarks-section {
        margin: 20px 40px;
        padding: 16px;
        background-color: var(--color7);
        border-left: 4px solid var(--color1);
        border-radius: 4px;
    }
    .remarks-title {
        font-family: 'Playfair Display', serif;
        font-size: 13px;
        font-weight: 700;
        color: var(--color1);
        margin-bottom: 6px;
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
        border-top: 1px solid var(--color5);
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
        width: 160px;
        border-bottom: 1px solid var(--color1);
        margin-bottom: 6px;
    }
    .sig-label {
        font-size: 11px;
        font-weight: 700;
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
        <div class="patient-grid">
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
        <div class="result-title">Investigation Results</div>
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
                    <td><strong>{{value}}</strong></td>
                    <td>{{unit}}</td>
                    <td>{{referenceRange}}</td>
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
