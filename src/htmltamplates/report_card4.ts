/** Template 4 — "Modern Banner" (also the default): colour header band, ruled patient line,
 * colour-headed medication table, plain ruled sections. Spec: docs/prescription-templates.md. */
export const reportCardTemplate4 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{{patient.name}}'s Prescription</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
{{#if templateConfig.fontUrl}}<link href="{{{templateConfig.fontUrl}}}" rel="stylesheet">{{/if}}
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet">
{{{i18n.head}}}
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
        font-family: '{{templateConfig.primaryFont}}', Arial, Helvetica, sans-serif;
        margin: 0; padding: 0;
        color: var(--color3);
        line-height: 1.45;
        background-color: var(--color5);
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
    /* Clinic grows and clamps; the doctor column keeps its intrinsic width so a
       long address can never squeeze the credentials into a ragged column. */
    .banner {
        background: var(--color1);
        color: var(--color8);
        padding: 20px 36px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 28px;
    }
    .banner-left { flex: 1 1 auto; min-width: 0; }
    .clinic-name { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; line-height: 1.2; }
    .clinic-tagline {
        font-size: 11px; font-style: italic; opacity: 0.9; margin-top: 3px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Two lines max — beyond that a postal address is noise on a prescription. */
    .clinic-meta {
        font-size: 10px; opacity: 0.85; margin-top: 5px; line-height: 1.45;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    /* Own line, outside the clamp: a two-line address used to clip the phone away. */
    .clinic-phone { font-size: 10px; opacity: 0.85; margin-top: 1px; }
    /* Stretched so the divider spans the whole band, not just the doctor's lines. */
    .banner-right {
        flex: 0 0 auto; align-self: stretch; text-align: right; max-width: 42%;
        padding-left: 20px; border-left: 1px solid rgba(255, 255, 255, 0.22);
    }
    /* Names wrap at spaces; an unbroken token (an email saved as the name) breaks anywhere. */
    .doctor-name { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
    .doctor-meta { font-size: 11px; opacity: 0.9; margin-top: 2px; line-height: 1.35; }

    /* ---------- Body ---------- */
    .body { flex: 1; padding: 22px 36px; display: flex; flex-direction: column; }

    /* Ruled "LABEL value" line on one baseline — a filled card read as an app screen, not paper. */
    .patient { padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--color5); }
    .pt-row { display: flex; align-items: baseline; gap: 28px; }
    .pt-field { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
    .pt-field.is-name { flex: 1 1 auto; }
    .pt-label { font-size: 9px; font-weight: 600; color: var(--color4); text-transform: uppercase; letter-spacing: 0.7px; white-space: nowrap; }
    .pt-value { font-size: 13px; font-weight: 500; color: var(--color9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pt-field.is-name .pt-value { font-size: 14.5px; text-transform: capitalize; }
    /* Address is variable-length, so it gets its own line, clamped to two rows. */
    .pt-address { margin-top: 5px; }
    .pt-address .pt-value {
        font-size: 12px; color: var(--color3); white-space: normal;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }

    .clinical { font-size: 13px; margin-bottom: 6px; }
    .clinical p { margin: 4px 0; }
    .clinical .k { font-weight: 600; color: var(--color1); margin-right: 6px; }

    /* flex-start: as a stretched flex item the glyph was centred across the page. */
    .rx-glyph { height: 42px; width: auto; fill: var(--color1); display: block; margin: 8px 0 10px; align-self: flex-start; }

    .med-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .med-table th.c, .med-table td.c { text-align: center; }
    .med-table thead { background: var(--color1); color: var(--color8); }
    .med-table th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; padding: 10px 10px; }
    .med-table td { padding: 11px 10px; border-bottom: 1px solid var(--color5); font-size: 13px; vertical-align: top; word-break: break-word; }
    .med-table tbody tr:nth-child(even) { background: var(--color7); }
    .med-index { font-weight: 700; color: var(--color4); }
    .medicine-name { font-weight: 700; font-size: 14px; color: var(--color9); }
    .medicine-strength { font-size: 11px; color: var(--color4); margin-top: 2px; }
    .medicine-composition { font-size: 10px; color: var(--color4); font-style: italic; margin-top: 1px; }
    .nil { color: var(--color4); }

    /* ---------- Multi-page handling (10+ medicines) ---------- */
    .med-table thead { display: table-header-group; }
    .med-table tr { break-inside: avoid; page-break-inside: avoid; }

    /* Plain sections with a thin accent rule — no filled boxes. */
    .advice-block { margin-top: 14px; padding-left: 12px; border-left: 2px solid var(--color10); }
    .advice-title { font-weight: 700; color: var(--color10); text-transform: uppercase; letter-spacing: 0.4px; font-size: 11px; margin-bottom: 2px; }
    .advice-text { font-size: 12.5px; color: var(--color3); line-height: 1.6; }
    .advice-text ul { margin: 0; padding-left: 18px; }
    .advice-text ul li { margin: 2px 0; }
    .follow-up { font-size: 13px; margin-top: 12px; }
    .follow-up .k { font-weight: 600; color: var(--color1); margin-right: 6px; }

    /* ---------- Sign-off ---------- */
    /* The spacer pins the sign-off to the page bottom while advice stays right under the medicines. */
    .push { flex: 1; }
    .sign-off { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-top: 20px; }
    .qr-item { display: flex; align-items: center; gap: 10px; }
    .qr-item img { width: 60px; height: 60px; display: block; }
    .qr-text { font-size: 10px; color: var(--color4); line-height: 1.45; max-width: 130px; }
    /* Blank space above the rule is where the doctor signs a printed copy. */
    .sign { min-width: 190px; margin-left: auto; text-align: center; }
    .sign-space { height: 40px; }
    .sign-name { border-top: 1px solid var(--color3); padding-top: 5px; font-size: 12.5px; font-weight: 600; color: var(--color9); }
    .sign-caption { font-size: 9.5px; color: var(--color4); margin-top: 1px; }

    .timings {
        display: flex; flex-wrap: wrap; gap: 4px 18px;
        padding: 8px 36px; font-size: 10px; color: var(--color4);
        background: var(--color7); border-top: 1px solid var(--color5);
    }
    .timings .lbl { font-weight: 600; color: var(--color1); text-transform: uppercase; letter-spacing: 0.5px; margin-right: 6px; }
    .timing-item span:first-child { font-weight: 600; color: var(--color3); }

    .footer {
        background: var(--color1); color: var(--color8); padding: 10px 36px;
        font-size: 10px; display: flex; justify-content: space-between; align-items: center;
    }
    .footer-brand { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .footer-brand img { height: 14px; width: auto; object-fit: contain; opacity: 0.9; }
</style>
</head>
<body>
<div class="pad">

    <!-- Banner header -->
    {{#if config.elements.showClinicHeader}}
    <div class="banner">
        <div class="banner-left">
            <div class="clinic-name">{{clinic.name}}</div>
            {{#if config.elements.showClinicTagline}}{{#if clinic.tagline}}<div class="clinic-tagline">{{clinic.tagline}}</div>{{/if}}{{/if}}
            {{#if config.elements.showClinicAddress}}<div class="clinic-meta">{{clinicAddress clinic.address clinic.city clinic.state clinic.zipcode}}</div>{{/if}}
            {{#if config.elements.showClinicPhone}}{{#if clinic.phone}}<div class="clinic-phone">Ph: {{clinic.phone}}</div>{{/if}}{{/if}}
        </div>
        <div class="banner-right">
            <div class="doctor-name">Dr.&nbsp;{{doctor.name}}</div>
            {{#if config.elements.showDoctorQualification}}{{#if doctor.qualification}}<div class="doctor-meta">{{doctor.qualification}}</div>{{/if}}{{/if}}
            {{#if config.elements.showDoctorSpeciality}}{{#if doctor.speciality}}<div class="doctor-meta">{{doctor.speciality}}</div>{{/if}}{{/if}}
            {{#if config.elements.showDoctorRegistration}}{{#if doctor.registrationNumber}}<div class="doctor-meta">Medical Reg. No: {{doctor.registrationNumber}}</div>{{/if}}{{/if}}
        </div>
    </div>
    {{/if}}

    <!-- Body -->
    <div class="body">
        {{#unless config.elements.showClinicHeader}}
        <!-- Letterhead mode: the banner is off, so the prescriber's credentials move inline. -->
        <div class="clinical" style="text-align: right; margin-bottom: 10px;">
            <p><span class="k">Dr.&nbsp;{{doctor.name}}</span>{{#if config.elements.showDoctorQualification}}{{#if doctor.qualification}} &middot; {{doctor.qualification}}{{/if}}{{/if}}{{#if config.elements.showDoctorRegistration}}{{#if doctor.registrationNumber}} &middot; Medical Reg. No: {{doctor.registrationNumber}}{{/if}}{{/if}}</p>
        </div>
        {{/unless}}

        <div class="patient">
            <div class="pt-row">
                <div class="pt-field is-name"><span class="pt-label">Patient</span><span class="pt-value">{{patient.name}}</span></div>
                {{#if registrationNo}}<div class="pt-field"><span class="pt-label">Reg. No.</span><span class="pt-value">{{registrationNo}}</span></div>{{/if}}
                {{#if (anyValue config.elements.showPatientAge config.elements.showPatientGender)}}
                <div class="pt-field"><span class="pt-label">{{#if config.elements.showPatientAge}}Age{{#if config.elements.showPatientGender}} / Sex{{/if}}{{else}}Sex{{/if}}</span><span class="pt-value">{{#if config.elements.showPatientAge}}{{patient.age}} Y{{#if config.elements.showPatientGender}} / {{patient.gender}}{{/if}}{{else}}{{patient.gender}}{{/if}}</span></div>
                {{/if}}
                {{#if config.elements.showVisitDate}}
                <div class="pt-field"><span class="pt-label">Date</span><span class="pt-value">{{appointmentDate}}</span></div>
                {{/if}}
            </div>
            {{#if config.elements.showPatientAddress}}{{#if patient.address}}
            <div class="pt-field pt-address"><span class="pt-label">Address</span><span class="pt-value">{{patient.address}}</span></div>
            {{/if}}{{/if}}
        </div>

        {{#if config.elements.showChiefComplaints}}{{#if symptoms.length}}
        <div class="clinical"><p><span class="k">C/O:</span>{{#each symptoms}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}</p></div>
        {{/if}}{{/if}}
        {{#if config.elements.showAllergies}}{{#if allergies.length}}
        <div class="clinical"><p><span class="k">Allergies:</span>{{#each allergies}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</p></div>
        {{/if}}{{/if}}
        {{#if config.elements.showHabits}}{{#if habits.length}}
        <div class="clinical"><p><span class="k">Habits:</span>{{#each habits}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</p></div>
        {{/if}}{{/if}}
        {{#if config.elements.showVitals}}{{#if vitalsMoreThanOne}}
        <div class="clinical"><p><span class="k">Vitals:</span>{{#if vitals.bpSys}}{{#if vitals.bpDia}}BP {{vitals.bpSys}}/{{vitals.bpDia}} mmHg &nbsp;{{/if}}{{/if}}{{#if vitals.fbs}}FBS {{vitals.fbs}} mg/dL &nbsp;{{/if}}{{#if vitals.ppbs}}PPBS {{vitals.ppbs}} mg/dL &nbsp;{{/if}}{{#if vitals.rbs}}RBS {{vitals.rbs}} mg/dL &nbsp;{{/if}}{{#if vitals.pulse}}Pulse {{vitals.pulse}}/min &nbsp;{{/if}}{{#if vitals.spo2}}SpO2 {{vitals.spo2}}% &nbsp;{{/if}}{{#if vitals.temperatureC}}Temp {{vitals.temperatureC}}&deg;C &nbsp;{{/if}}{{#if vitals.weightKg}}Wt {{vitals.weightKg}} kg &nbsp;{{/if}}{{#if vitals.heightCm}}Ht {{vitals.heightCm}} cm &nbsp;{{/if}}{{#if vitals.bmi}}BMI {{vitals.bmi}}{{/if}}</p></div>
        {{/if}}{{/if}}
        {{#if config.elements.showDiagnosis}}{{#if diagnosis}}
        <div class="clinical"><p><span class="k">Diagnosis:</span>{{diagnosis}}</p></div>
        {{/if}}{{/if}}
        {{#if config.elements.showClinicalNotes}}{{#if visitingNotes}}
        <div class="clinical"><p><span class="k">Notes:</span>{{visitingNotes}}</p></div>
        {{/if}}{{/if}}

        {{#if config.elements.showRxSymbol}}
        <svg class="rx-glyph" viewBox="0 0 384 512">
            <path d="M301.26 352l78.06-78.06c6.25-6.25 6.25-16.38 0-22.63l-22.63-22.63c-6.25-6.25-16.38-6.25-22.63 0L256 306.74l-83.96-83.96C219.31 216.8 256 176.89 256 128c0-53.02-42.98-96-96-96H16C7.16 32 0 39.16 0 48v256c0 8.84 7.16 16 16 16h32c8.84 0 16-7.16 16-16v-80h18.75l128 128-78.06 78.06c-6.25 6.25-6.25 16.38 0 22.63l22.63 22.63c6.25 6.25 16.38 6.25 22.63 0L256 397.25l78.06 78.06c6.25 6.25 16.38 6.25 22.63 0l22.63-22.63c6.25-6.25 6.25-16.38 0-22.63L301.26 352zM64 96h96c17.64 0 32 14.36 32 32s-14.36 32-32 32H64V96z"/>
        </svg>
        {{/if}}

        {{#if prescriptions.length}}
        <table class="med-table">
            <!-- The optional Timing column is third, so its width must be the third <col>. -->
            <colgroup>
                <col style="width: 6%;" />
                <col style="width: 30%;" />
                {{#if config.elements.showMedicineInstructions}}<col style="width: 14%;" />{{/if}}
                <col style="width: 13%;" />
                <col style="width: 13%;" />
                <col style="width: 24%;" />
            </colgroup>
            <thead>
                <tr>
                    <th class="c">#</th>
                    <th>Medication</th>
                    {{#if config.elements.showMedicineInstructions}}<th>Timing</th>{{/if}}
                    <th class="c">Dosage</th>
                    <th class="c">Duration</th>
                    <th class="c">Instruction</th>
                </tr>
            </thead>
            <tbody>
                {{#each prescriptions}}
                <tr>
                    <td class="c med-index">{{addOne @index}}.</td>
                    <td>
                        <div class="medicine-name">{{#if this.form}}{{formPrefix this.form}} {{/if}}{{{medicineNameWithOr this.medicineName}}}</div>
                        {{#if ../config.elements.showMedicineStrength}}{{#if this.strength}}<div class="medicine-strength">{{this.strength}}</div>{{/if}}{{/if}}
                        {{#if ../config.elements.showMedicineComposition}}{{#if (hasValue this.composition)}}<div class="medicine-composition">{{this.composition}}</div>{{/if}}{{/if}}
                    </td>
                    {{#if ../config.elements.showMedicineInstructions}}<td>{{#if (hasValue this.notes)}}{{bi this.notes}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>{{/if}}
                    <td class="c">{{#if (hasValue this.frequency)}}{{bi this.frequency}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>
                    <td class="c">{{#if (hasValue this.duration)}}{{bi this.duration}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>
                    <td class="c">{{#if (hasValue this.dosage)}}{{bi this.dosage}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>
                </tr>
                {{/each}}
            </tbody>
        </table>
        {{/if}}

        {{#if config.elements.showTests}}{{#if hasTests}}
        <div class="advice-block"><div class="advice-title">Investigations Advised</div><div class="advice-text">{{testNames}}</div></div>
        {{/if}}{{/if}}
        {{#if config.elements.showPreDiagnosis}}{{#if preDiagnosis}}
        <div class="advice-block"><div class="advice-title">Pre-Diagnosis</div><div class="advice-text">{{preDiagnosis}}</div></div>
        {{/if}}{{/if}}
        {{#if config.elements.showAdvice}}{{#if advice}}
        <div class="advice-block"><div class="advice-title">{{bi "Advice"}}</div><div class="advice-text">{{bi advice}}</div></div>
        {{/if}}{{/if}}
        {{#if config.elements.showDietarySuggestion}}{{#if dietarySuggestion}}
        <div class="advice-block"><div class="advice-title">{{bi "Dietary Suggestion"}}</div><div class="advice-text">{{bi dietarySuggestion}}</div></div>
        {{/if}}{{/if}}
        {{#if config.elements.showSurgerySuggested}}{{#if surgerySuggested.length}}
        <div class="advice-block"><div class="advice-title">Surgery Suggested</div><div class="advice-text"><ul>{{#each surgerySuggested}}<li>{{this}}</li>{{/each}}</ul></div></div>
        {{/if}}{{/if}}
        {{#if config.elements.showAdditionalInformation}}
        {{#with (objectEntries additionalInformation) as |additionalInfoEntries|}}
        {{#if additionalInfoEntries.length}}
        <div class="advice-block">
            <div class="advice-title">Extra Diagnosis Details</div>
            <div class="advice-text">
                <ul>
                    {{#each additionalInfoEntries}}
                    <li>{{this.key}} - {{this.value}}</li>
                    {{/each}}
                </ul>
            </div>
        </div>
        {{/if}}
        {{/with}}
        {{/if}}
        {{#if config.elements.showFollowUp}}{{#if followUpDate}}
        <div class="follow-up"><span class="k">{{bi "Next Visit:"}}</span>{{followUpDate}}</div>
        {{/if}}{{/if}}
        {{#if config.elements.showVisitingDays}}{{#if visitingDays.length}}
        <div class="follow-up"><span class="k">Visiting Days:</span>{{#each visitingDays}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</div>
        {{/if}}{{/if}}

        <!-- Sign-off -->
        <div class="push"></div>
        {{#if (anyValue config.elements.showQrCode config.elements.showDoctorSignature)}}
        <div class="sign-off">
            {{#if config.elements.showQrCode}}{{#if qrCode}}
            <div class="qr-item">
                <img src="{{{qrCode}}}" alt="Scan to get the Infinity Medisetu app" />
                <span class="qr-text">Scan to get the app &mdash; prescriptions &amp; follow-ups</span>
            </div>
            {{/if}}{{/if}}
            {{#if config.elements.showDoctorSignature}}
            <div class="sign" style="display: none;">
                <div class="sign-space"></div>
                <div class="sign-name">Dr.&nbsp;{{doctor.name}}</div>
                <div class="sign-caption">Signature</div>
            </div>
            {{/if}}
        </div>
        {{/if}}
    </div>

    <!-- Consultation timings (bottom) -->
    {{#if config.elements.showConsultationHours}}{{#if doctor.groupedAvailability}}
    <div class="timings">
        <span class="lbl">Consultation Hours</span>
        {{#each doctor.groupedAvailability}}
            {{#if this.isAvailable}}
            <span class="timing-item"><span>{{this.days}}:</span> {{{this.display}}}</span>
            {{/if}}
        {{/each}}
    </div>
    {{/if}}{{/if}}

    {{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}

    <!-- Footer: no clinic name — the banner already carries it (one home per field). -->
    {{#if config.elements.showFooter}}
    <div class="footer">
        <span>{{bi "This prescription is computer-generated. Valid without signature."}}</span>
        <span class="footer-brand">
            Powered by
            <img src="https://infninity-medisatu.s3.ap-south-1.amazonaws.com/ims/Logo%20V1.png" alt="Infinity Medisetu" />
        </span>
    </div>
    {{/if}}
</div>
</body>
</html>
`;
