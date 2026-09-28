/** Template 5 — "Clinical Rail": colour band header, ruled patient line, findings rail beside the ℞ table.
 * Print-first: hairlines and plain sections, no boxed cards. Spec: docs/prescription-templates.md. */
export const reportCardTemplate5 = `
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
    .ico { width: 13px; height: 13px; flex: 0 0 auto; }

    /* ---------- Header band ---------- */
    /* Clinic grows and clamps; the doctor column keeps its intrinsic width so a
       long address can never squeeze the credentials into a ragged column. */
    .band {
        background: var(--color1);
        color: var(--color8);
        padding: 22px 32px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 28px;
    }
    .band-left { flex: 1 1 auto; min-width: 0; }
    .clinic-name { font-family: 'Playfair Display', serif; font-size: 25px; font-weight: 700; line-height: 1.15; }
    .clinic-tagline {
        font-size: 11px; font-style: italic; opacity: 0.88; margin-top: 3px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Two lines max — beyond that a postal address is noise on a prescription. */
    .clinic-meta {
        font-size: 10.5px; opacity: 0.9; margin-top: 9px; line-height: 1.5;
        display: flex; align-items: flex-start; gap: 7px;
    }
    .clinic-meta .txt {
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    /* Stretched so the divider spans the whole band, not just the doctor's lines. */
    .band-right {
        flex: 0 0 auto; align-self: stretch; text-align: right; max-width: 42%;
        padding-left: 24px; border-left: 1px solid rgba(255, 255, 255, 0.25);
    }
    /* Names wrap at spaces; an unbroken token (an email saved as the name) breaks anywhere. */
    .doctor-name { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
    .doctor-meta { font-size: 11px; opacity: 0.9; margin-top: 3px; line-height: 1.35; }
    .doctor-reg {
        display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px;
        font-size: 10.5px; margin-top: 9px; padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.25);
    }

    /* ---------- Patient details ---------- */
    /* A ruled line of "LABEL value" pairs as on a printed pad; baseline-aligned so mixed sizes line up. */
    .patient { margin: 16px 32px 0; padding-bottom: 10px; border-bottom: 1px solid var(--color5); }
    .pt-row { display: flex; align-items: baseline; gap: 30px; }
    .pt-field { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
    .pt-field.is-name { flex: 1 1 auto; }
    .pt-label { font-size: 9px; font-weight: 600; color: var(--color4); text-transform: uppercase; letter-spacing: 0.7px; white-space: nowrap; }
    .pt-value { font-size: 12.5px; font-weight: 500; color: var(--color9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pt-field.is-name .pt-value { font-size: 14px; text-transform: capitalize; }
    /* Address is variable-length, so it gets its own line, clamped to two rows. */
    .pt-address { margin-top: 5px; }
    .pt-address .pt-value {
        font-size: 11.5px; color: var(--color3); white-space: normal;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }

    /* ---------- Rx heading ---------- */
    .rx-head { display: flex; align-items: flex-end; gap: 12px; padding: 20px 32px 0; }
    .rx-glyph { height: 30px; width: auto; fill: var(--color1); display: block; }
    .rx-title {
        font-family: 'Playfair Display', serif;
        font-size: 18px; font-weight: 700; letter-spacing: 2.5px;
        color: var(--color9); text-transform: uppercase;
        border-bottom: 2px solid var(--color1); padding-bottom: 3px;
    }

    /* ---------- Body: findings rail + medication table ---------- */
    .body { flex: 1; margin-top: 16px; padding: 0 32px; display: flex; gap: 20px; align-items: flex-start; }
    /* Plain sections split by hairlines — boxed cards read as an app screen, not paper.
       Rendered only when it has content, so an empty rail never squeezes the table. */
    .rail { flex: 0 0 26%; padding-right: 18px; border-right: 1px solid var(--color5); }
    .rail-sec + .rail-sec { margin-top: 11px; padding-top: 11px; border-top: 1px dashed var(--color5); }
    .rail-title {
        display: flex; align-items: center; gap: 6px;
        font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.9px;
        color: var(--color1); margin-bottom: 4px;
    }
    .rail-sec.is-alert .rail-title { color: var(--color6); }
    .rail-text { font-size: 11.5px; line-height: 1.55; color: var(--color3); }
    .rail-text ul { margin: 0; padding-left: 14px; }
    .rail-text li { margin: 2px 0; }
    .vitals { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
    .vital .vk { font-size: 8.5px; color: var(--color4); text-transform: uppercase; letter-spacing: 0.4px; }
    .vital .vv { font-size: 12px; font-weight: 600; color: var(--color9); white-space: nowrap; }

    .main { flex: 1 1 auto; min-width: 0; }
    .med-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .med-table thead { display: table-header-group; }
    .med-table th {
        text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
        color: var(--color1); background: var(--color7); padding: 8px 6px; border-bottom: 1.5px solid var(--color1);
    }
    .med-table td { padding: 9px 6px; border-bottom: 1px solid var(--color5); font-size: 11.5px; color: var(--color3); vertical-align: top; word-break: break-word; }
    .med-table th.c, .med-table td.c { text-align: center; }
    .med-table tr { break-inside: avoid; page-break-inside: avoid; }
    .med-no { color: var(--color4); font-weight: 600; }
    .medicine-name { font-weight: 600; font-size: 12px; color: var(--color9); }
    .medicine-strength { font-size: 10px; color: var(--color4); margin-top: 2px; }
    .medicine-composition { font-size: 10px; color: var(--color4); font-style: italic; margin-top: 1px; }
    .nil { color: var(--color4); }

    .tests { margin-top: 14px; padding-left: 10px; border-left: 2px solid var(--color1); }
    .tests-title { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.9px; color: var(--color1); margin-bottom: 2px; }
    .tests-text { font-size: 11.5px; color: var(--color3); }

    /* ---------- Sign-off: next visit, QR, signature ---------- */
    .sign-off {
        margin: 18px 32px 12px;
        display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
    }
    .sign-left { display: flex; align-items: center; gap: 26px; }
    .info-label { font-size: 8.5px; font-weight: 600; color: var(--color4); text-transform: uppercase; letter-spacing: 0.9px; }
    .info-value { font-size: 13px; font-weight: 600; color: var(--color9); margin-top: 2px; }
    .qr-item { display: flex; align-items: center; gap: 10px; }
    .qr-item img { width: 56px; height: 56px; display: block; }
    .qr-text { font-size: 9.5px; color: var(--color4); line-height: 1.45; max-width: 120px; }
    /* Blank space above the rule is where the doctor signs a printed copy. */
    .sign { min-width: 190px; margin-left: auto; text-align: center; }
    .sign-space { height: 40px; }
    .sign-name { border-top: 1px solid var(--color3); padding-top: 5px; font-size: 12px; font-weight: 600; color: var(--color9); }
    .sign-caption { font-size: 9px; color: var(--color4); margin-top: 1px; }

    .timings {
        display: flex; flex-wrap: wrap; gap: 4px 18px;
        padding: 8px 32px; font-size: 10px; color: var(--color4);
        background: var(--color7); border-top: 1px solid var(--color5);
    }
    .timings .lbl { font-weight: 600; color: var(--color1); text-transform: uppercase; letter-spacing: 0.5px; margin-right: 6px; }
    .timing-item span:first-child { font-weight: 600; color: var(--color3); }

    .footer {
        background: var(--color1); color: var(--color8); padding: 11px 32px;
        font-size: 10px; display: flex; justify-content: space-between; align-items: center;
    }
    .footer-brand { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .footer-brand img { height: 14px; width: auto; object-fit: contain; opacity: 0.9; }
</style>
</head>
<body>
<div class="pad">

    <!-- Header band -->
    {{#if config.elements.showClinicHeader}}
    <div class="band">
        <div class="band-left">
            <div class="clinic-name">{{clinic.name}}</div>
            {{#if config.elements.showClinicTagline}}{{#if clinic.tagline}}<div class="clinic-tagline">{{clinic.tagline}}</div>{{/if}}{{/if}}
            {{#if config.elements.showClinicAddress}}
            <div class="clinic-meta">
                <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span class="txt">{{clinicAddress clinic.address clinic.city clinic.state clinic.zipcode}}</span>
            </div>
            {{/if}}
            {{#if config.elements.showClinicPhone}}{{#if clinic.phone}}
            <div class="clinic-meta" style="margin-top: 4px;">
                <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>
                <span class="txt">{{clinic.phone}}</span>
            </div>
            {{/if}}{{/if}}
        </div>
        <div class="band-right">
            <div class="doctor-name">Dr.&nbsp;{{doctor.name}}</div>
            {{#if config.elements.showDoctorQualification}}{{#if doctor.qualification}}<div class="doctor-meta">{{doctor.qualification}}</div>{{/if}}{{/if}}
            {{#if config.elements.showDoctorSpeciality}}{{#if doctor.speciality}}<div class="doctor-meta">{{doctor.speciality}}</div>{{/if}}{{/if}}
            {{#if config.elements.showDoctorRegistration}}{{#if doctor.registrationNumber}}
            <div class="doctor-reg">
                <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/></svg>
                <span>Medical Reg. No: {{doctor.registrationNumber}}</span>
            </div>
            {{/if}}{{/if}}
        </div>
    </div>
    {{else}}
    <!-- Letterhead mode: the band is off, so the prescriber moves inline. -->
    <div class="patient">
        <div class="pt-row">
            <div class="pt-field">
                <span class="pt-label">Prescribed by</span>
                <span class="pt-value" style="white-space: normal;">Dr. {{doctor.name}}{{#if config.elements.showDoctorQualification}}{{#if doctor.qualification}} &middot; {{doctor.qualification}}{{/if}}{{/if}}{{#if config.elements.showDoctorRegistration}}{{#if doctor.registrationNumber}} &middot; Medical Reg. No: {{doctor.registrationNumber}}{{/if}}{{/if}}</span>
            </div>
        </div>
    </div>
    {{/if}}

    <!-- Patient details -->
    <div class="patient">
        <div class="pt-row">
            <div class="pt-field is-name">
                <span class="pt-label">Patient</span>
                <span class="pt-value">{{patient.name}}</span>
            </div>
            {{#if registrationNo}}
            <div class="pt-field">
                <span class="pt-label">Reg. No.</span>
                <span class="pt-value">{{registrationNo}}</span>
            </div>
            {{/if}}
            {{#if (anyValue config.elements.showPatientAge config.elements.showPatientGender)}}
            <div class="pt-field">
                <span class="pt-label">{{#if config.elements.showPatientAge}}Age{{#if config.elements.showPatientGender}} / Sex{{/if}}{{else}}Sex{{/if}}</span>
                <span class="pt-value">{{#if config.elements.showPatientAge}}{{patient.age}} Y{{#if config.elements.showPatientGender}} / {{patient.gender}}{{/if}}{{else}}{{patient.gender}}{{/if}}</span>
            </div>
            {{/if}}
            {{#if config.elements.showVisitDate}}
            <div class="pt-field">
                <span class="pt-label">Date</span>
                <span class="pt-value">{{appointmentDate}}</span>
            </div>
            {{/if}}
        </div>
        {{#if config.elements.showPatientAddress}}{{#if patient.address}}
        <div class="pt-field pt-address">
            <span class="pt-label">Address</span>
            <span class="pt-value">{{patient.address}}</span>
        </div>
        {{/if}}{{/if}}
    </div>

    <!-- Rx heading -->
    {{#if config.elements.showRxSymbol}}
    <div class="rx-head">
        <svg class="rx-glyph" viewBox="0 0 384 512">
            <path d="M301.26 352l78.06-78.06c6.25-6.25 6.25-16.38 0-22.63l-22.63-22.63c-6.25-6.25-16.38-6.25-22.63 0L256 306.74l-83.96-83.96C219.31 216.8 256 176.89 256 128c0-53.02-42.98-96-96-96H16C7.16 32 0 39.16 0 48v256c0 8.84 7.16 16 16 16h32c8.84 0 16-7.16 16-16v-80h18.75l128 128-78.06 78.06c-6.25 6.25-6.25 16.38 0 22.63l22.63 22.63c6.25 6.25 16.38 6.25 22.63 0L256 397.25l78.06 78.06c6.25 6.25 16.38 6.25 22.63 0l22.63-22.63c6.25-6.25 6.25-16.38 0-22.63L301.26 352zM64 96h96c17.64 0 32 14.36 32 32s-14.36 32-32 32H64V96z"/>
        </svg>
        <span class="rx-title">Prescription</span>
    </div>
    {{/if}}

    <!-- Body: findings rail + medication table -->
    <div class="body">
        {{#if (anyValue
            (whenShown config.elements.showVitals vitalsMoreThanOne)
            (whenShown config.elements.showChiefComplaints symptoms)
            (whenShown config.elements.showDiagnosis diagnosis)
            (whenShown config.elements.showPreDiagnosis preDiagnosis)
            (whenShown config.elements.showClinicalNotes visitingNotes)
            (whenShown config.elements.showAllergies allergies)
            (whenShown config.elements.showHabits habits)
            (whenShown config.elements.showAdvice advice)
            (whenShown config.elements.showDietarySuggestion dietarySuggestion)
            (whenShown config.elements.showSurgerySuggested surgerySuggested)
            (whenShown config.elements.showVisitingDays visitingDays)
            (whenShown config.elements.showAdditionalInformation additionalInformation))}}
        <div class="rail">
            <!-- Clinical reading order: findings first, allergies before anything is prescribed, advice last. -->
            {{#if config.elements.showVitals}}{{#if vitalsMoreThanOne}}
            <div class="rail-sec">
                <div class="rail-title">Vitals</div>
                <div class="vitals">
                    {{#if vitals.bpSys}}{{#if vitals.bpDia}}<div class="vital"><div class="vk">BP</div><div class="vv">{{vitals.bpSys}}/{{vitals.bpDia}}</div></div>{{/if}}{{/if}}
                    {{#if vitals.pulse}}<div class="vital"><div class="vk">Pulse</div><div class="vv">{{vitals.pulse}} bpm</div></div>{{/if}}
                    {{#if vitals.spo2}}<div class="vital"><div class="vk">SpO&#8322;</div><div class="vv">{{vitals.spo2}}%</div></div>{{/if}}
                    {{#if vitals.temperatureC}}<div class="vital"><div class="vk">Temp</div><div class="vv">{{vitals.temperatureC}}&deg;C</div></div>{{/if}}
                    {{#if vitals.fbs}}<div class="vital"><div class="vk">FBS</div><div class="vv">{{vitals.fbs}} mg/dL</div></div>{{/if}}
                    {{#if vitals.ppbs}}<div class="vital"><div class="vk">PPBS</div><div class="vv">{{vitals.ppbs}} mg/dL</div></div>{{/if}}
                    {{#if vitals.rbs}}<div class="vital"><div class="vk">RBS</div><div class="vv">{{vitals.rbs}} mg/dL</div></div>{{/if}}
                    {{#if vitals.weightKg}}<div class="vital"><div class="vk">Weight</div><div class="vv">{{vitals.weightKg}} kg</div></div>{{/if}}
                    {{#if vitals.heightCm}}<div class="vital"><div class="vk">Height</div><div class="vv">{{vitals.heightCm}} cm</div></div>{{/if}}
                    {{#if vitals.bmi}}<div class="vital"><div class="vk">BMI</div><div class="vv">{{vitals.bmi}}</div></div>{{/if}}
                </div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showChiefComplaints}}{{#if symptoms.length}}
            <div class="rail-sec">
                <div class="rail-title">Complaints</div>
                <div class="rail-text">{{#each symptoms}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showAllergies}}{{#if allergies.length}}
            <div class="rail-sec is-alert">
                <div class="rail-title">
                    <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                    Allergies
                </div>
                <div class="rail-text">{{#each allergies}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showDiagnosis}}{{#if diagnosis}}
            <div class="rail-sec">
                <div class="rail-title">Diagnosis</div>
                <div class="rail-text">{{diagnosis}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showPreDiagnosis}}{{#if preDiagnosis}}
            <div class="rail-sec">
                <div class="rail-title">Pre-Diagnosis</div>
                <div class="rail-text">{{preDiagnosis}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showClinicalNotes}}{{#if visitingNotes}}
            <div class="rail-sec">
                <div class="rail-title">Notes</div>
                <div class="rail-text">{{visitingNotes}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showHabits}}{{#if habits.length}}
            <div class="rail-sec">
                <div class="rail-title">Habits</div>
                <div class="rail-text">{{#each habits}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showAdditionalInformation}}
            {{#with (objectEntries additionalInformation) as |additionalInfoEntries|}}
            {{#if additionalInfoEntries.length}}
            <div class="rail-sec">
                <div class="rail-title">Extra Diagnosis Details</div>
                <div class="rail-text">
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

            {{#if config.elements.showAdvice}}{{#if advice}}
            <div class="rail-sec">
                <div class="rail-title">{{bi "Advice"}}</div>
                <div class="rail-text">{{bi advice}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showDietarySuggestion}}{{#if dietarySuggestion}}
            <div class="rail-sec">
                <div class="rail-title">{{bi "Diet"}}</div>
                <div class="rail-text">{{bi dietarySuggestion}}</div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showSurgerySuggested}}{{#if surgerySuggested.length}}
            <div class="rail-sec">
                <div class="rail-title">Surgery Suggested</div>
                <div class="rail-text"><ul>{{#each surgerySuggested}}<li>{{this}}</li>{{/each}}</ul></div>
            </div>
            {{/if}}{{/if}}

            {{#if config.elements.showVisitingDays}}{{#if visitingDays.length}}
            <div class="rail-sec">
                <div class="rail-title">Visiting Days</div>
                <div class="rail-text"><ul>{{#each visitingDays}}<li>{{this}}</li>{{/each}}</ul></div>
            </div>
            {{/if}}{{/if}}
        </div>
        {{/if}}

        <div class="main">
            {{#if prescriptions.length}}
            <table class="med-table">
                <!-- The optional Timing column is third, so its width must be the third <col>. -->
                <colgroup>
                    <col style="width: 5%;" />
                    <col style="width: 31%;" />
                    {{#if config.elements.showMedicineInstructions}}<col style="width: 16%;" />{{/if}}
                    <col style="width: 13%;" />
                    <col style="width: 14%;" />
                    <col style="width: 21%;" />
                </colgroup>
                <thead>
                    <tr>
                        <th class="c">#</th>
                        <th>Medicine</th>
                        {{#if config.elements.showMedicineInstructions}}<th>Timing</th>{{/if}}
                        <th class="c">Dosage</th>
                        <th class="c">Duration</th>
                        <th>Instruction</th>
                    </tr>
                </thead>
                <tbody>
                    {{#each prescriptions}}
                    <tr>
                        <td class="c med-no">{{addOne @index}}</td>
                        <td>
                            <!-- No formPrefix: stored names already carry their form ("KENT GEL"). -->
                            <div class="medicine-name">{{{medicineNameWithOr this.medicineName}}}</div>
                            {{#if ../config.elements.showMedicineStrength}}{{#if this.strength}}<div class="medicine-strength">{{this.strength}}</div>{{/if}}{{/if}}
                            {{#if ../config.elements.showMedicineComposition}}{{#if (hasValue this.composition)}}<div class="medicine-composition">{{this.composition}}</div>{{/if}}{{/if}}
                        </td>
                        {{#if ../config.elements.showMedicineInstructions}}<td>{{#if (hasValue this.notes)}}{{bi this.notes}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>{{/if}}
                        <td class="c">{{#if (hasValue this.frequency)}}{{bi this.frequency}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>
                        <td class="c">{{#if (hasValue this.duration)}}{{bi this.duration}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>
                        <td>{{#if (hasValue this.dosage)}}{{bi this.dosage}}{{else}}<span class="nil">&ndash;</span>{{/if}}</td>
                    </tr>
                    {{/each}}
                </tbody>
            </table>
            {{/if}}

            {{#if config.elements.showTests}}{{#if hasTests}}
            <div class="tests">
                <div class="tests-title">Investigations Advised</div>
                <div class="tests-text">{{testNames}}</div>
            </div>
            {{/if}}{{/if}}
        </div>
    </div>

    <!-- Sign-off: clinic phone/name stay in the band only (one home per field). -->
    {{#if (anyValue (whenShown config.elements.showFollowUp followUpDate) config.elements.showQrCode config.elements.showDoctorSignature)}}
    <div class="sign-off">
        <div class="sign-left">
            {{#if config.elements.showFollowUp}}{{#if followUpDate}}
            <div>
                <div class="info-label">{{bi "Next Visit"}}</div>
                <div class="info-value">{{followUpDate}}</div>
            </div>
            {{/if}}{{/if}}
            {{#if config.elements.showQrCode}}{{#if qrCode}}
            <div class="qr-item">
                <img src="{{{qrCode}}}" alt="Scan to get the Infinity Medisetu app" />
                <span class="qr-text">Scan to get the app &mdash; prescriptions &amp; follow-ups</span>
            </div>
            {{/if}}{{/if}}
        </div>
        {{#if config.elements.showDoctorSignature}}
        <div class="sign" style="display: none;">
            <div class="sign-space"></div>
            <div class="sign-name">Dr. {{doctor.name}}</div>
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

    <!-- Footer -->
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
