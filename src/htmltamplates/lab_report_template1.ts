export const labReportTemplate1 = `
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
        font-family: '{{templateConfig.fontFamily}}', Arial, Helvetica, sans-serif;
        margin: 0; padding: 0;
        color: var(--color3);
        line-height: 1.5;
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
        border-left: 3px solid var(--color1);
        padding: 24mm 18mm 14mm 20mm;
    }

    /* ---------- Header ---------- */
    .head {
        display: flex; justify-content: space-between; align-items: flex-start;
        padding-bottom: 14px; margin-bottom: 4px;
        border-bottom: 2px solid var(--color1);
    }
    .head-left { max-width: 60%; }
    .clinic-name {
        font-size: 21px; font-weight: 700; color: var(--color1);
        letter-spacing: 0.2px;
    }
    .clinic-meta { font-size: 11px; color: var(--color4); margin-top: 5px; line-height: 1.55; }
    .head-right { text-align: right; max-width: 40%; }
    .report-meta { font-size: 11px; color: var(--color4); }
    .report-meta strong { color: var(--color9); }

    /* ---------- Patient and Test Info ---------- */
    .patient-row {
        display: flex; flex-wrap: wrap; gap: 6px 30px;
        padding: 14px 0; border-bottom: 1px solid var(--color5);
    }
    .field { font-size: 13px; }
    .field .k {
        color: var(--color4); font-size: 10px; text-transform: uppercase;
        letter-spacing: 0.5px; display: block; margin-bottom: 1px;
    }
    .field .v { color: var(--color9); font-weight: 600; }

    /* ---------- Table Area ---------- */
    .result-section { flex: 1; padding-top: 16px; }
    .result-table { width: 100%; border-collapse: collapse; }
    .result-table th {
        text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--color1); padding: 8px 6px; border-bottom: 1.5px solid var(--color1);
    }
    .result-table td { padding: 10px 6px; border-bottom: 1px solid var(--color5); font-size: 13px; vertical-align: top; }
    .param-name { font-weight: 600; color: var(--color9); }
    .flag-badge {
        font-weight: 700;
    }
    .flag-badge[data-flag="High"] { color: var(--color6); }
    .flag-badge[data-flag="Low"] { color: #D97706; }
    .flag-badge[data-flag="Normal"] { color: #16A34A; }

    /* ---------- Remarks ---------- */
    .remarks-section { margin-top: 20px; padding: 12px; border: 1px solid var(--color5); border-radius: 4px; }
    .remarks-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--color1); margin-bottom: 4px; }
    .remarks-text { font-size: 12px; color: var(--color3); }

    /* ---------- Footer ---------- */
    .footer {
        margin-top: auto; padding-top: 14px;
        border-top: 1px solid var(--color5);
        display: flex; justify-content: space-between; align-items: flex-end;
    }
    .footer-left { font-size: 10px; color: var(--color4); }
    .footer-right { text-align: right; }
    .sig-line { width: 150px; border-bottom: 1px solid var(--color3); margin-bottom: 4px; }
    .sig-label { font-size: 11px; font-weight: 600; color: var(--color9); }
</style>
</head>
<body>
<div class="pad">
    <header class="head">
        <div class="head-left">
            <div class="clinic-name">{{clinic.name}}</div>
            <div class="clinic-meta">
                {{clinic.address}}
            </div>
        </div>
        <div class="head-right">
            <div class="report-meta">
                <strong>Status:</strong> {{labResult.status}}<br>
                <strong>Generated:</strong> {{generatedAt}}
            </div>
        </div>
    </header>

    <div class="patient-row">
        <div class="field"><span class="k">Patient Name</span><span class="v">{{patient.name}}</span></div>
        <div class="field"><span class="k">Referral Doctor</span><span class="v">{{doctor.name}}</span></div>
        <div class="field"><span class="k">Test Name</span><span class="v">{{test.name}}</span></div>
        <div class="field"><span class="k">Category</span><span class="v">{{test.category}}</span></div>
        <div class="field"><span class="k">Date/Time</span><span class="v">{{appointment.date}} {{appointment.time}}</span></div>
        <div class="field"><span class="k">Sample Type</span><span class="v">{{template.sampleType}}</span></div>
    </div>

    <main class="result-section">
        <table class="result-table">
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
    <div class="remarks-section">
        <div class="remarks-title">Remarks / Interpretations</div>
        <div class="remarks-text">{{labResult.remarks}}</div>
    </div>
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
