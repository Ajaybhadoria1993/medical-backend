export const labReportTemplate4 = `
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
        font-family: '{{templateConfig.fontFamily}}', Arial, Helvetica, sans-serif;
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
        display: flex;
        flex-direction: column;
    }

    /* ---------- Banner header ---------- */
    .banner {
        background: var(--color1);
        color: var(--color8);
        padding: 22px 36px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
    }
    .clinic-block { max-width: 100%; }
    .clinic-name { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; }
    .clinic-meta { font-size: 10px; opacity: 0.85; margin-top: 4px; line-height: 1.5; }

    /* ---------- Body ---------- */
    .body { flex: 1; padding: 22px 36px; display: flex; flex-direction: column; }

    /* ---------- Patient Details ---------- */
    .patient-card {
        background: var(--color7); border-radius: 10px; padding: 14px 18px;
        margin-bottom: 20px; display: grid; grid-template-columns: 2fr 1fr 2fr; gap: 12px;
    }
    .pf-item { display: flex; flex-direction: column; }
    .pf-label { font-size: 9px; font-weight: 600; color: var(--color4); text-transform: uppercase; letter-spacing: 0.5px; }
    .pf-value { font-size: 13px; font-weight: 600; color: var(--color9); margin-top: 3px; }

    /* ---------- Result Table ---------- */
    .result-section { flex: 1; }
    .result-table { width: 100%; border-collapse: collapse; border-radius: 8px; overflow: hidden; }
    .result-table thead { background: var(--color1); color: var(--color8); }
    .result-table th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; padding: 10px; }
    .result-table td { padding: 11px 10px; border-bottom: 1px solid var(--color5); font-size: 13px; vertical-align: top; }
    .result-table tbody tr:nth-child(even) { background: var(--color7); }
    .param-name { font-weight: 700; color: var(--color9); }
    .flag-badge { font-weight: 700; }
    .flag-badge[data-flag="High"] { color: var(--color6); }
    .flag-badge[data-flag="Low"] { color: #D97706; }
    .flag-badge[data-flag="Normal"] { color: #16A34A; }

    /* ---------- Remarks ---------- */
    .remarks-section {
        margin-top: 20px;
        padding: 16px;
        background-color: var(--color7);
        border-radius: 8px;
        border: 1px solid var(--color5);
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
        padding: 20px 36px;
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
        width: 150px;
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
    <header class="banner">
        <div class="clinic-block">
            <div class="clinic-name">{{clinic.name}}</div>
            <div class="clinic-meta">
                {{clinic.address}}
            </div>
        </div>
    </header>

    <div class="body">
        <section class="patient-card">
            <div class="pf-item">
                <span class="pf-label">Patient Name</span>
                <span class="pf-value">{{patient.name}}</span>
            </div>
            <div class="pf-item">
                <span class="pf-label">Referral Doctor</span>
                <span class="pf-value">{{doctor.name}}</span>
            </div>
            <div class="pf-item">
                <span class="pf-label">Test Name</span>
                <span class="pf-value">{{test.name}}</span>
            </div>
            <div class="pf-item">
                <span class="pf-label">Sample Type</span>
                <span class="pf-value">{{template.sampleType}}</span>
            </div>
            <div class="pf-item">
                <span class="pf-label">Category</span>
                <span class="pf-value">{{test.category}}</span>
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
</div>
</body>
</html>
`;
