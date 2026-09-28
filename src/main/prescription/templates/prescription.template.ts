// import type { PrescriptionData } from "../types/prescription.types";
import type { HtmlTemplateResult } from '../types/prescription.types';

export const sampleTemplate = (): HtmlTemplateResult => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{{patient.name}}'s Prescription</title>
<style>
    @page { size: A4; margin: 0; }
    :root {
        --color1: #0A6C74;
        --color2: #EBFCF4;
        --color3: #333333;
        --color4: #666666;
        --color5: #e0e0e0;
        --color6: #b22222;
        --color7: #f9f9f9;
        --color8: #ffffff;
        --color9: #000000;
        --color10: #856404;
    }
    body { 
        font-family: Georgia, "Times New Roman", serif;
        margin: 0; padding: 0;
        color: var(--color3);
        line-height: 1.4;
        background-color: var(--color7);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .container {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: var(--color8);
        position: relative;
        display: flex;
        flex-direction: column;
    }
    /* Header Background with Curves */
    .header-bg {
        height: 120px;
        background-color: var(--color1);
        position: relative;
        overflow: hidden;
    }
    .header-bg::after {
        content: "";
        position: absolute;
        bottom: -80px; left: 0; right: 0;
        height: 100px;
        background: var(--color2);
        border-radius: 50% 50% 0 0;
        transform: scaleX(1.5);
    }
    .header-content {
        position: absolute;
        top: 0; left: 0; width: 100%;
        padding: 20px 40px;
        z-index: 10;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: var(--color8);
        box-sizing: border-box;
    }
    .hospital-brand { display: flex; align-items: center; gap: 15px; }
    .hospital-logo { 
        width: 50px; 
        height: 50px; 
        object-fit: contain;
    }
    .hospital-name { 
        font-family: "Palatino Linotype", "Book Antiqua", serif;
        font-size: 24px; 
        font-weight: 800; 
    }
    .hospital-tagline { 
        font-size: 12px; 
        opacity: 0.9; 
        font-style: italic;
    }
    
        /* Light Green Strip for Logo */
    .logo-strip {
        background-color: var(--color2);
        padding: 8px 40px;
        display: flex;
        justify-content: flex-end;
        border-bottom: 1px solid var(--color5);
    }

    /* Main Layout */
    .main-layout { display: flex; flex: 1; }
    
    /* Left Sidebar */
    .sidebar {
        width: 25%;
        border-right: 2px solid var(--color1);
        padding: 30px 20px;
        font-size: 11px;
        background: var(--color8);
    }
    .sidebar-section { margin-bottom: 25px; }
    .sidebar-label { 
        font-weight: 700; 
        font-size: 13px; 
        margin-bottom: 8px; 
        color: var(--color1); 
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .doc-name { 
        font-size: 16px; 
        font-weight: 700; 
        color: var(--color9); 
        margin-bottom: 4px; 
        font-family: 'Playfair Display', serif;
    }
    .doc-qual { 
        color: var(--color4); 
        margin-bottom: 4px;
        font-size: 10px;
    }
    .clinic-address {
        line-height: 1.6;
        color: var(--color4);
        font-size: 10px;
    }

    /* Right Content */
    .content-area { 
        width: 75%; 
        padding: 25px 30px; 
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: calc(100% - 120px);
    }
    
    /* Meta Row - Date/Token */
    .meta-row {
        display: flex;
        justify-content: space-between;
        background: var(--color7);
        padding: 8px 12px;
        border-radius: 6px;
        margin-bottom: 20px;
        border: 1px solid var(--color5);
    }
    .meta-item {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .meta-label {
        font-weight: 600;
        color: var(--color1);
        font-size: 10px;
    }
    .meta-value {
        font-weight: 500;
        color: var(--color3);
        font-size: 10px;
    }

    /* Patient Grid */
    .patient-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 15px;
        padding: 12px;
        background: var(--color7);
        border-radius: 8px;
        border: 1px solid var(--color5);
    }
    .patient-item {
        display: flex;
        flex-direction: column;
    }
    .patient-label {
        font-size: 8px;
        font-weight: 600;
        color: var(--color4);
        text-transform: uppercase;
        letter-spacing: 0.3px;
        margin-bottom: 2px;
    }
    .patient-value {
        font-size: 11px;
        font-weight: 600;
        color: var(--color3);
    }

    /* Rx Symbol */
    .rx-symbol {
        font-family: "Palatino Linotype", "Book Antiqua", serif;
        font-size: 32px;
        font-weight: 700;
        color: var(--color1);
        margin: 0px 0 10px;
        opacity: 0.8;
    }

    /* Section Cards */
    .section-card {
        margin-bottom: 20px;
        border-left: 3px solid var(--color1);
        background: var(--color8);
        border-radius: 0 4px 4px 0;
    }
    .section-header {
        padding: 8px 12px;
        background: linear-gradient(to right, #e8f0e5, transparent);
        border-bottom: 1px solid var(--color5);
    }
    .section-title {
        font-family: "Palatino Linotype", "Book Antiqua", serif;
        font-size: 12px;
        font-weight: 600;
        color: var(--color1);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .section-content {
        padding: 12px;
    }

    /* Comma-separated lists */
    .comma-list {
        display: inline;
        font-size: 10px;
        color: var(--color3);
        line-height: 1.6;
    }
    .comma-item {
        display: inline;
    }
    .comma-item:not(:last-child)::after {
        content: ", ";
    }

    /* Two column layout for habits/allergies */
    .two-col {
        display: flex;
        gap: 20px;
        margin-bottom: 20px;
    }
    .col {
        flex: 1;
    }

    /* Vitals Grid - Modified for single line */
    .vitals-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .vital-item {
        background: var(--color7);
        padding: 2px 4px;
        border-radius: 6px;
        border: 1px solid var(--color5);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
    }
    .vital-title {
        font-size: 8px;
        font-weight: 600;
        color: var(--color4);
        text-transform: uppercase;
    }
    .vital-reading {
        font-size: 10px;
        font-weight: 600;
        color: var(--color3);
    }

    /* Tables & Lists */
    .med-table { 
        width: 100%; 
        border-collapse: collapse; 
        margin: 15px 0; 
    }
    .med-table th { 
        text-align: left; 
        border-bottom: 2px solid var(--color1); 
        padding: 8px; 
        font-size: 10px;
        font-weight: 600;
        color: var(--color1);
    }
    .med-table td { 
        padding: 6px 8px; 
        border-bottom: 1px solid var(--color5); 
        font-size: 10px; 
    }
    .medicine-name {
        font-weight: 600;
        font-size: 11px;
        color: var(--color1);
    }
    .medicine-notes {
        font-size: 8px;
        color: var(--color4);
        margin-top: 2px;
    }

    /* Advice Box - Modified to touch bottom */
    .advice-box {
        margin-top: auto;
        background: var(--color7);
        border: 1px solid var(--color2);
        border-radius: 4px;
        padding: 12px;
        width: 100%;
        box-sizing: border-box;
    }
    .advice-header {
        font-weight: 600;
        color: var(--color10);
        margin-bottom: 5px;
        text-transform: uppercase;
        font-size: 10px;
    }
    .advice-content {
        font-size: 10px;
        line-height: 1.5;
        color: var(--color3);
    }

    /* Footer */
    .footer-bg {
        height: 60px;
        background-color: var(--color1);
        position: relative;
        overflow: hidden;
        margin-top: auto;
    }
    .footer-bg::before {
        content: "";
        position: absolute;
        top: -40px; left: 0; right: 0;
        height: 80px;
        background: var(--color2);
        border-radius: 0 0 50% 50%;
        transform: scaleX(1.5);
    }
    .footer-text {
        position: absolute;
        bottom: 10px;
        right: 40px;
        color: var(--color8); 
        font-size: 9px; 
        font-weight: 500;
        font-style: italic;
    }
    
    /* Surgery Suggested specific style */
    .surgery-text {
        color: var(--color6);
        font-weight: 600;
    }
    .surgery-badge {
        color: var(--color6);
        font-weight: 600;
        margin-right: 6px;
    }
</style>
</head>
<body>
<div class="container">
    <div class="header-bg">
        <div class="header-content">
            <div class="hospital-brand">
                {{#if clinic.logo}}
                    <img src="{{clinic.logo}}" class="hospital-logo" alt="clinic logo" />
                {{/if}}
                <div>
                    <div class="hospital-name">{{clinic.name}}</div>
                    <div class="hospital-tagline">{{clinic.tagline}}</div>
                </div>
            </div>
            <div style="text-align: right; font-size: 12px;">
                <div style="font-weight: 600;">Date: {{appointmentDate}}</div>
                {{#if token}}
                    <div style="font-size: 11px;">Token #: {{token}}</div>
                {{else}}
                    <div style="font-size: 11px;">Time: {{appointmentTime}}</div>
                {{/if}}
            </div>
        </div>
    </div>
    
    <!-- Logo in Light Green Strip (below date/time) -->
    <div class="logo-strip">
        <img src="https://infinitymedisetu.com/app/assets/images/new-logo.svg" 
             alt="Infinity Medisetu" 
             style="height: 30px; width: auto; object-fit: contain;" />
    </div>

    <div class="main-layout">
        <div class="sidebar">
            <div class="sidebar-section">
                <div class="doc-name">Dr. {{doctor.name}}</div>
                <div class="doc-qual">({{doctor.speciality}})</div>
                <div class="doc-qual">{{doctor.qualification}}</div>
                <div class="doc-qual">{{doctor.email}}</div>
            </div>

            {{#if doctor.registrationNumber}}
            <div class="sidebar-section">
                <div class="doc-name">Registration Number</div>
                <div class="doc-qual">{{doctor.registrationNumber}}</div>
            </div>
            {{/if}}

            <div class="sidebar-section">
                <div class="doc-name">Clinic Address</div>
                <div class="clinic-address">
                    {{clinic.address}}<br>
                    {{clinic.city}}, {{clinic.state}} - {{clinic.zipcode}}
                </div>
            </div>

            <div class="sidebar-section">
                <div class="doc-name">Contact Number</div>
                <div class="doc-qual">{{clinic.phone}}</div>
            </div>

            <div class="sidebar-section">
                <div class="doc-name">Consultation Timings</div>
                <div style="font-size: 9px; margin-top: 4px;">
                    {{#each doctor.availability}}
                    <div style="display: flex; margin-bottom: 2px;">
                        <span style="width: 35px; font-weight: 500; color: var(--color1);">{{this.day}}:</span>
                        {{#if this.isAvailable}}
                            <span style="color: var(--color4);">{{{this.display}}}</span>
                        {{else}}
                            <span style="color: var(--color9);">Off</span>
                        {{/if}}
                    </div>
                    {{/each}}
                </div>
            </div>
        </div>

        <div class="content-area">
            <!-- Patient Information -->
            <div class="patient-grid">
                <div class="patient-item">
                    <span class="patient-label">Patient Name</span>
                    <span class="patient-value">{{patient.name}}</span>
                </div>
                <div class="patient-item">
                    <span class="patient-label">Age</span>
                    <span class="patient-value">{{patient.age}} Y</span>
                </div>
                <div class="patient-item">
                    <span class="patient-label">Gender</span>
                    <span class="patient-value">{{patient.gender}}</span>
                </div>
                <div class="patient-item">
                    <span class="patient-label">Address</span>
                    <span class="patient-value">{{patient.address}}</span>
                </div>
            </div>

            {{#if followUpDate}}
            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px;">
                <div style="font-weight: 600; color: var(--color1);">Follow-up Date:</div>
                <div style="color: var(--color3); font-weight: 600;">{{followUpDate}}</div>
            </div>
            {{/if}}

            {{#if visitingDays}}
            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12px;">
                <div style="font-weight: 600; color: var(--color1);">Visiting Date:</div>
                <div style="color: var(--color3); font-weight: 600;">{{#each visitingDays}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</div>
                {{#if visitingNotes}}<p style="color: var(--color4);">({{visitingNotes}})</p>{{/if}}
            </div>
            {{/if}}

            <div class="rx-symbol">
                <img
                    src="https://res.cloudinary.com/ddzkedas8/image/upload/v1772172278/download_zafkmm.png"
                    alt="Rx"
                    style="height:25px; width:auto; object-fit:contain;"
                />
            </div>

            <!-- Surgery Suggested with consistent color6 -->
            {{#if surgerySuggested}}
            <p style="margin: 0 0 6px 0; font-size: 12px;">
                <strong class="surgery-text">Surgery Suggested:</strong>
                {{#each surgerySuggested}}<span class="surgery-badge">{{this}}</span>{{/each}}
            </p>
            {{/if}}

            <!-- Symptoms Section -->
            {{#if symptoms.length}}
            <p style="margin: 0 0 6px 0; font-size: 12px;">
                <strong style="color: var(--color1);">Symptoms:</strong>
                {{#each symptoms}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}
            </p>
            {{/if}}

            {{#if diagnosis}}
            <p style="margin: 0 0 6px 0; font-size: 12px;">
                <strong style="color: var(--color1);">Diagnosis:</strong> 
                {{diagnosis}}
            </p>
            {{/if}}

            {{#if habits}}
            <p style="margin: 0 0 6px 0; font-size: 12px;">
                <strong style="color: var(--color1);">Habits:</strong> 
                {{#each habits}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
            </p>
            {{/if}}

            {{#if allergies}}
            <p style="margin: 0 0 6px 0; font-size: 12px;">
                <strong style="color: var(--color1);">Allergies:</strong>
                {{#each allergies}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
            </p>
            {{/if}}

            {{#if hasTests}}
            <p style="margin: 0 0 6px 0; font-size: 12px;">
                <strong style="color: var(--color1);">Test Prescribed:</strong> 
                {{testNames}}
            </p>
            {{/if}}

            <!-- Vitals Section -->
            {{#if vitalsMoreThanOne}}
            <div style="display: flex; align-items: center; margin: 0 0 4px 0;">
                <div style="font-size: 12px; font-weight: 600; margin-right: 8px; white-space: nowrap; color: var(--color1);">Vitals:</div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    {{#if vitals.bpSys}}{{#if vitals.bpDia}}
                    <div class="vital-item">
                        <span class="vital-title">BP</span>
                        <span class="vital-reading">{{vitals.bpSys}}/{{vitals.bpDia}}</span>
                    </div>
                    {{/if}}{{/if}}

                    {{#if vitals.fbs}}
                    <div class="vital-item">
                        <span class="vital-title">FBS</span>
                        <span class="vital-reading">{{vitals.fbs}} mg/dL</span>
                    </div>
                    {{/if}}

                    {{#if vitals.ppbs}}
                    <div class="vital-item">
                        <span class="vital-title">PPBS</span>
                        <span class="vital-reading">{{vitals.ppbs}} mg/dL</span>
                    </div>
                    {{/if}}

                    {{#if vitals.rbs}}
                    <div class="vital-item">
                        <span class="vital-title">RBS</span>
                        <span class="vital-reading">{{vitals.rbs}} mg/dL</span>
                    </div>
                    {{/if}}

                    {{#if vitals.pulse}}
                    <div class="vital-item">
                        <span class="vital-title">Pulse</span>
                        <span class="vital-reading">{{vitals.pulse}}</span>
                    </div>
                    {{/if}}
                    
                    {{#if vitals.spo2}}
                    <div class="vital-item">
                        <span class="vital-title">SpO2</span>
                        <span class="vital-reading">{{vitals.spo2}}%</span>
                    </div>
                    {{/if}}
                    
                    {{#if vitals.temperatureC}}
                    <div class="vital-item">
                        <span class="vital-title">Temp</span>
                        <span class="vital-reading">{{vitals.temperatureC}}°C</span>
                    </div>
                    {{/if}}
                    
                    {{#if vitals.weightKg}}
                    <div class="vital-item">
                        <span class="vital-title">Wt</span>
                        <span class="vital-reading">{{vitals.weightKg}} kg</span>
                    </div>
                    {{/if}}
                    
                    {{#if vitals.heightCm}}
                    <div class="vital-item">
                        <span class="vital-title">Ht</span>
                        <span class="vital-reading">{{vitals.heightCm}} cm</span>
                    </div>
                    {{/if}}
                    
                    {{#if vitals.bmi}}
                    <div class="vital-item">
                        <span class="vital-title">BMI</span>
                        <span class="vital-reading">{{vitals.bmi}}</span>
                    </div>
                    {{/if}}
                </div>
            </div>
            {{/if}}

            <!-- Prescriptions -->
            {{#if prescriptions.length}}
            <table class="med-table">
                <thead>
                    <tr>
                        <th>Medication</th>
                        <th>Dosage / Frequency</th>
                        <th>Duration</th>
                        <th>Instructions</th>
                    </tr>
                </thead>
                <tbody>
                    {{#each prescriptions}}
                    <tr>
                        <td>
                            <div class="medicine-name">{{this.medicineName}}</div>
                        </td>
                        <td>{{this.dosage}} - {{this.frequency}}</td>
                        <td>{{this.duration}}</td>
                        <td>{{this.notes}}</td>
                    </tr>
                    {{/each}}
                </tbody>
            </table>
            {{/if}}

            <!-- Advice with consistent color10 -->
            {{#if advice}}
            <div class="advice-box">
                <div class="advice-header">Advice</div>
                <div class="advice-content">{{advice}}</div>
            </div>
            {{/if}}

            <!-- Dietary Suggestion -->
            {{#if dietarySuggestion}}
            <div class="advice-box" {{#if advice}}style="margin-top: 10px;"{{/if}}>
                <div class="advice-header" style="color: var(--color10);">Dietary Suggestion</div>
                <div class="advice-content">{{dietarySuggestion}}</div>
            </div>
            {{/if}}
        </div>
    </div>

    <div class="footer-bg">
        <div class="footer-text">This prescription is electronically generated and valid without signature</div>
    </div>
</div>
</body>
</html>
`.trim();

  return {
    html,
  };
};
