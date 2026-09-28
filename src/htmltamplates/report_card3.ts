/** Template 3 — "Handwritten Pad": cream paper, Inter labels with Caveat handwriting values.
 * The warm cream boxes are this layout's paper identity — keep them. Spec: docs/prescription-templates.md. */
export const reportCardTemplate3 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{{patient.name}}'s Prescription</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Caveat:wght@400;500;600;700&display=swap" rel="stylesheet">
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
        font-family: 'Inter', sans-serif;
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
        background: #fffef7;
        display: flex;
        flex-direction: column;
        border-top: 8px solid var(--color1);
    }

    /* ---------- Letterhead ---------- */
    .letterhead {
        display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
        padding: 24px 40px 16px; border-bottom: 2px solid var(--color2);
    }
    .doctor-block { flex: 0 0 auto; max-width: 56%; }
    /* Names wrap at spaces; an unbroken token (an email saved as the name) breaks anywhere. */
    .doctor-name { font-size: 22px; font-weight: 800; color: var(--color1); line-height: 1.15; overflow-wrap: anywhere; }
    .doctor-qual { font-size: 12px; color: var(--color4); margin-top: 4px; }
    .doctor-speciality { font-size: 12px; font-weight: 600; color: var(--color3); margin-top: 2px; }
    .doctor-reg { font-size: 11px; color: var(--color4); margin-top: 4px; }
    .clinic-block { flex: 1 1 auto; min-width: 0; text-align: right; }
    .clinic-name { font-size: 17px; font-weight: 800; color: var(--color3); }
    .clinic-tagline { font-size: 11px; font-style: italic; color: var(--color4); margin-top: 2px; }
    /* Two lines max so a long postal address can't push the letterhead open. */
    .clinic-meta {
        font-size: 11px; color: var(--color4); margin-top: 6px; line-height: 1.5;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    /* Own line, outside the clamp: a two-line address used to clip the phone away. */
    .clinic-phone { font-size: 11px; color: var(--color4); margin-top: 1px; }

    /* ---------- Patient card ---------- */
    /* Flex-wrap on one baseline inside the cream card — a fixed grid broke a fourth field onto its own row. */
    .patient-row {
        display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 24px;
        padding: 12px 18px; margin: 12px 40px 0;
        background: #fefbf5; border: 1px solid #e9e0cf; border-radius: 12px;
    }
    .field { flex: 1 1 0; min-width: 0; font-size: 13px; display: flex; align-items: baseline; gap: 6px; }
    .field.is-name { flex-grow: 2; }
    .field.is-address { flex-basis: 100%; }
    .field .k { font-weight: 700; color: var(--color1); white-space: nowrap; text-transform: uppercase; font-size: 11px; }
    /* Values wrap rather than clip: overflow:hidden cut off Caveat's descenders ("Raj" lost its "j"). */
    .field .v { font-family: 'Caveat', cursive; font-size: 19px; color: #2c2418; overflow-wrap: anywhere; }
    .field.is-name .v { font-size: 21px; text-transform: capitalize; }

    /* ---------- Clinical lines ---------- */
    .clinical { padding: 10px 40px 0; }
    .info-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
    .info-row .k {
        font-weight: 700; font-size: 12px; letter-spacing: 0.4px;
        color: var(--color1); text-transform: uppercase; min-width: 130px; flex-shrink: 0;
    }
    .info-row .v { font-family: 'Caveat', cursive; font-size: 18px; color: #2c2418; flex: 1; }

    /* ---------- Rx ---------- */
    .rx-body { padding: 4px 40px 4px; }
    .rx-glyph { height: 46px; width: auto; fill: var(--color1); display: block; margin-bottom: 6px; }
    .med-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .med-table th.c, .med-table td.c { text-align: center; }
    .med-table th {
        text-align: left; font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.4px; color: var(--color1);
        padding: 6px 8px; border-bottom: 2px solid var(--color1);
    }
    .med-table td {
        padding: 10px 8px; border-bottom: 0.5px dotted var(--color5);
        font-family: 'Caveat', cursive; font-size: 18px; color: #1f1a10; vertical-align: top; word-break: break-word;
    }
    .med-index { font-weight: 700; color: var(--color4); font-family: 'Inter', sans-serif; font-size: 13px; }
    .medicine-name { font-weight: 700; color: #1f1a10; }
    .medicine-strength { font-family: 'Inter', sans-serif; font-size: 11px; color: var(--color4); margin-top: 2px; }
    .medicine-composition { font-family: 'Inter', sans-serif; font-size: 10px; color: var(--color4); font-style: italic; margin-top: 1px; }
    .nil { color: var(--color4); }

    /* ---------- Multi-page handling (10+ medicines) ---------- */
    .med-table thead { display: table-header-group; }
    .med-table tr { break-inside: avoid; page-break-inside: avoid; }

    /* ---------- Advice ---------- */
    .advice-section { padding: 12px 40px 0; }
    .advice-block {
        background: #fef6e7; border-radius: 12px; padding: 8px 14px;
        border-left: 4px solid var(--color10);
        display: flex; align-items: baseline; gap: 10px;
    }
    .advice-title { font-weight: 700; color: var(--color10); text-transform: uppercase; letter-spacing: 0.3px; font-size: 11px; min-width: 90px; flex-shrink: 0; }
    .advice-text { font-family: 'Caveat', cursive; font-size: 17px; color: #2c2418; line-height: 1.4; }
    .advice-text ul { margin: 0; padding-left: 18px; }
    .advice-text ul li { margin: 1px 0; }
    .follow-up { padding: 12px 40px 0; }
    .follow-up .info-row { margin-bottom: 0; }

    /* ---------- Sign-off ---------- */
    /* The spacer pins the sign-off to the page bottom while advice stays right under the medicines. */
    .push { flex: 1; }
    .sign-off { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin: 20px 40px 14px; }
    .qr-item { display: flex; align-items: center; gap: 10px; }
    .qr-item img { width: 60px; height: 60px; display: block; }
    .qr-text { font-size: 10px; color: var(--color4); line-height: 1.45; max-width: 130px; }
    /* Blank space above the rule is where the doctor signs a printed copy. */
    .sign { min-width: 190px; margin-left: auto; text-align: center; }
    .sign-space { height: 40px; }
    .sign-name { border-top: 1px solid var(--color3); padding-top: 5px; font-size: 13px; font-weight: 600; color: var(--color9); }
    .sign-caption { font-size: 10px; color: var(--color4); margin-top: 1px; }

    /* ---------- Timings strip ---------- */
    .timings {
        display: flex; flex-wrap: wrap; gap: 4px 18px;
        padding: 8px 40px; font-size: 10px; color: var(--color4);
        background: #faf6ed; border-top: 1px solid var(--color5);
    }
    .timings .lbl { font-weight: 700; color: var(--color1); text-transform: uppercase; letter-spacing: 0.5px; margin-right: 6px; }
    .timing-item span:first-child { font-weight: 700; color: var(--color1); }

    /* ---------- Footer ---------- */
    .footer {
        border-top: 1px dashed var(--color5); padding: 10px 40px;
        font-size: 10px; color: var(--color4);
        display: flex; justify-content: space-between; align-items: center;
    }
    .footer-brand { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .footer-brand img { height: 16px; width: auto; object-fit: contain; }
</style>
</head>
<body>
<div class="pad">

    <!-- Letterhead -->
    <div class="letterhead">
        <div class="doctor-block">
            <div class="doctor-name">Dr.&nbsp;{{doctor.name}}</div>
            {{#if config.elements.showDoctorQualification}}{{#if doctor.qualification}}<div class="doctor-qual">{{doctor.qualification}}</div>{{/if}}{{/if}}
            {{#if config.elements.showDoctorSpeciality}}{{#if doctor.speciality}}<div class="doctor-speciality">{{doctor.speciality}}</div>{{/if}}{{/if}}
            {{#if config.elements.showDoctorRegistration}}{{#if doctor.registrationNumber}}<div class="doctor-reg">Medical Reg. No: {{doctor.registrationNumber}}</div>{{/if}}{{/if}}
        </div>
        {{#if config.elements.showClinicHeader}}
        <div class="clinic-block">
            <div class="clinic-name">{{clinic.name}}</div>
            {{#if config.elements.showClinicTagline}}{{#if clinic.tagline}}<div class="clinic-tagline">{{clinic.tagline}}</div>{{/if}}{{/if}}
            {{#if config.elements.showClinicAddress}}<div class="clinic-meta">{{clinicAddress clinic.address clinic.city clinic.state clinic.zipcode}}</div>{{/if}}
            {{#if config.elements.showClinicPhone}}{{#if clinic.phone}}<div class="clinic-phone">Ph: {{clinic.phone}}</div>{{/if}}{{/if}}
        </div>
        {{/if}}
    </div>

    <!-- Patient details -->
    <div class="patient-row">
        <div class="field is-name"><span class="k">Patient:</span><span class="v">{{patient.name}}</span></div>
        {{#if registrationNo}}<div class="field"><span class="k">Reg. No.:</span><span class="v">{{registrationNo}}</span></div>{{/if}}
        {{#if (anyValue config.elements.showPatientAge config.elements.showPatientGender)}}
        <div class="field"><span class="k">{{#if config.elements.showPatientAge}}Age{{#if config.elements.showPatientGender}}/Sex{{/if}}{{else}}Sex{{/if}}:</span><span class="v">{{#if config.elements.showPatientAge}}{{patient.age}} Y{{#if config.elements.showPatientGender}} / {{patient.gender}}{{/if}}{{else}}{{patient.gender}}{{/if}}</span></div>
        {{/if}}
        {{#if config.elements.showVisitDate}}
        <div class="field"><span class="k">Date:</span><span class="v">{{appointmentDate}}</span></div>
        {{/if}}
        {{#if config.elements.showPatientAddress}}{{#if patient.address}}
        <div class="field is-address"><span class="k">Address:</span><span class="v">{{patient.address}}</span></div>
        {{/if}}{{/if}}
    </div>

    <!-- Clinical findings -->
    <div class="clinical">
        {{#if config.elements.showChiefComplaints}}{{#if symptoms.length}}
        <div class="info-row"><span class="k">C/O</span><span class="v">{{#each symptoms}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}</span></div>
        {{/if}}{{/if}}
        {{#if config.elements.showAllergies}}{{#if allergies.length}}
        <div class="info-row"><span class="k">Allergies</span><span class="v">{{#each allergies}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</span></div>
        {{/if}}{{/if}}
        {{#if config.elements.showHabits}}{{#if habits.length}}
        <div class="info-row"><span class="k">Habits</span><span class="v">{{#each habits}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</span></div>
        {{/if}}{{/if}}
        {{#if config.elements.showVitals}}{{#if vitalsMoreThanOne}}
        <div class="info-row"><span class="k">Vitals</span><span class="v">{{#if vitals.bpSys}}{{#if vitals.bpDia}}BP {{vitals.bpSys}}/{{vitals.bpDia}} mmHg &nbsp;{{/if}}{{/if}}{{#if vitals.fbs}}FBS {{vitals.fbs}} mg/dL &nbsp;{{/if}}{{#if vitals.ppbs}}PPBS {{vitals.ppbs}} mg/dL &nbsp;{{/if}}{{#if vitals.rbs}}RBS {{vitals.rbs}} mg/dL &nbsp;{{/if}}{{#if vitals.pulse}}Pulse {{vitals.pulse}}/min &nbsp;{{/if}}{{#if vitals.spo2}}SpO2 {{vitals.spo2}}% &nbsp;{{/if}}{{#if vitals.temperatureC}}Temp {{vitals.temperatureC}}&deg;C &nbsp;{{/if}}{{#if vitals.weightKg}}Wt {{vitals.weightKg}} kg &nbsp;{{/if}}{{#if vitals.heightCm}}Ht {{vitals.heightCm}} cm &nbsp;{{/if}}{{#if vitals.bmi}}BMI {{vitals.bmi}}{{/if}}</span></div>
        {{/if}}{{/if}}
        {{#if config.elements.showDiagnosis}}{{#if diagnosis}}
        <div class="info-row"><span class="k">Diagnosis</span><span class="v">{{diagnosis}}</span></div>
        {{/if}}{{/if}}
        {{#if config.elements.showClinicalNotes}}{{#if visitingNotes}}
        <div class="info-row"><span class="k">Notes</span><span class="v">{{visitingNotes}}</span></div>
        {{/if}}{{/if}}
    </div>

    <!-- Rx / Medications -->
    <div class="rx-body">
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
    </div>

    <!-- Advice / Investigations / Follow-up -->
    {{#if config.elements.showTests}}{{#if hasTests}}
    <div class="advice-section"><div class="advice-block"><span class="advice-title">Investigations</span><span class="advice-text">{{testNames}}</span></div></div>
    {{/if}}{{/if}}
    {{#if config.elements.showPreDiagnosis}}{{#if preDiagnosis}}
    <div class="advice-section"><div class="advice-block"><span class="advice-title">Pre-Diagnosis</span><span class="advice-text">{{preDiagnosis}}</span></div></div>
    {{/if}}{{/if}}
    {{#if config.elements.showAdvice}}{{#if advice}}
    <div class="advice-section"><div class="advice-block"><span class="advice-title">{{bi "Advice"}}</span><span class="advice-text">{{bi advice}}</span></div></div>
    {{/if}}{{/if}}
    {{#if config.elements.showDietarySuggestion}}{{#if dietarySuggestion}}
    <div class="advice-section"><div class="advice-block"><span class="advice-title">{{bi "Dietary Suggestion"}}</span><span class="advice-text">{{bi dietarySuggestion}}</span></div></div>
    {{/if}}{{/if}}
    {{#if config.elements.showSurgerySuggested}}{{#if surgerySuggested.length}}
    <div class="advice-section"><div class="advice-block"><span class="advice-title">Surgery Suggested</span><div class="advice-text"><ul>{{#each surgerySuggested}}<li>{{this}}</li>{{/each}}</ul></div></div></div>
    {{/if}}{{/if}}
    {{#if config.elements.showAdditionalInformation}}
    {{#with (objectEntries additionalInformation) as |additionalInfoEntries|}}
    {{#if additionalInfoEntries.length}}
    <div class="advice-section">
        <div class="advice-block">
            <span class="advice-title">Extra Diagnosis Details</span>
            <div class="advice-text">
                <ul>
                    {{#each additionalInfoEntries}}
                    <li>{{this.key}} - {{this.value}}</li>
                    {{/each}}
                </ul>
            </div>
        </div>
    </div>
    {{/if}}
    {{/with}}
    {{/if}}
    {{#if config.elements.showFollowUp}}{{#if followUpDate}}
    <div class="follow-up"><div class="info-row"><span class="k">{{bi "Next Visit"}}</span><span class="v">{{followUpDate}}</span></div></div>
    {{/if}}{{/if}}
    {{#if config.elements.showVisitingDays}}{{#if visitingDays.length}}
    <div class="follow-up"><div class="info-row"><span class="k">Visiting Days</span><span class="v">{{#each visitingDays}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</span></div></div>
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

    <!-- Footer: no clinic name — the letterhead already carries it (one home per field). -->
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
