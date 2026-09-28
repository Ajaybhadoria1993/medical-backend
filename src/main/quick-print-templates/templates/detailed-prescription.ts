/**
 * Quick Print Template 5 — "Detailed Prescription"
 * Full-featured layout with clinic banner, diagnosis, medicines, advice, QR code.
 */
import {
  clinicalNotesSection,
  clinicalSummarySection,
  testsSection,
} from './clinicalSections';

export const quickPrintTemplate5 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
{{{i18n.head}}}
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: '{{config.primaryFont}}', Inter, sans-serif;
    font-size: 12px; line-height: 1.5; color: #333;
    max-width: 850px; margin: 0 auto; padding: 20px;
  }
  .clinic-banner { background: linear-gradient(135deg, {{config.accentColor}}, {{config.accentColor}}dd); color: #fff; border-radius: 8px; padding: 14px 18px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
  .clinic-name { font-size: 16px; font-weight: 700; }
  .clinic-info { font-size: 9px; opacity: 0.9; margin-top: 2px; }
  .clinic-contact { font-size: 9px; text-align: right; opacity: 0.85; }
  .patient-card { background: {{config.accentColor}}08; border: 1px solid {{config.accentColor}}30; border-radius: 6px; padding: 12px; margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .pf { font-size: 10px; color: #374151; }
  .pf b { color: #111827; }
  .diagnosis-box { background: {{config.accentColor}}08; border-left: 3px solid {{config.accentColor}}; padding: 8px 12px; margin-bottom: 12px; border-radius: 0 4px 4px 0; }
  .diagnosis-label { font-size: 9px; color: {{config.accentColor}}; font-weight: 700; text-transform: uppercase; }
  .diagnosis-text { font-size: 11px; color: #1f2937; margin-top: 2px; }
  .rx { font-size: 18px; font-weight: bold; color: {{config.accentColor}}; margin: 8px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: {{config.accentColor}}; color: #fff; padding: 7px 9px; font-size: 9px; text-align: left; }
  td { padding: 7px 9px; border-bottom: 1px solid {{config.accentColor}}20; font-size: 11px; }
  tr:nth-child(even) { background: {{config.accentColor}}05; }
  .med-name { font-weight: 600; }
  .med-comp { font-size: 9px; color: #6b7280; }
  .advice { background: {{config.accentColor}}08; border-radius: 6px; padding: 10px 12px; margin-top: 12px; font-size: 11px; }
  .advice strong { color: {{config.accentColor}}; }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; padding-top: 12px; border-top: 2px solid {{config.accentColor}}20; }
  .followup-badge { background: {{config.accentColor}}10; color: {{config.accentColor}}; font-size: 10px; font-weight: 600; padding: 4px 10px; border-radius: 4px; }
  .doc-block { text-align: right; }
  .doc-name { font-size: 13px; font-weight: 700; color: #1f2937; }
  .doc-qual { font-size: 10px; color: #6b7280; }
  .doc-reg { font-size: 9px; color: #9ca3af; }
</style>
</head>
<body>

{{#if config.elements.showClinicHeader}}
<div class="clinic-banner">
  <div>
    <div class="clinic-name">{{clinic.name}}</div>
    <div class="clinic-info">{{clinic.address}}</div>
  </div>
  <div class="clinic-contact">{{clinic.phone}}</div>
</div>
{{/if}}

{{#if config.elements.showPatientName}}
<div class="patient-card">
  <div class="pf"><b>Patient:</b> {{patient.name}}</div>
  {{#if config.elements.showPatientUhid}}<div class="pf"><b>UHID:</b> {{patient.uhid}}</div>{{/if}}
  {{#if config.elements.showVisitDate}}<div class="pf"><b>Date:</b> {{visitDate}}</div>{{/if}}
  {{#if config.elements.showPatientAge}}<div class="pf"><b>Age:</b> {{patient.age}}y</div>{{/if}}
  <div class="pf"><b>Gender:</b> {{patient.gender}}</div>
  {{#if config.elements.showPatientMobile}}<div class="pf"><b>Mobile:</b> {{patient.mobile}}</div>{{/if}}
</div>
{{/if}}

${clinicalSummarySection}

{{#if config.elements.showDiagnosis}}
{{#if diagnosis}}
<div class="diagnosis-box">
  <div class="diagnosis-label">Diagnosis</div>
  <div class="diagnosis-text">{{diagnosis}}</div>
</div>
{{/if}}
{{/if}}

<div class="rx">℞ Medications</div>

{{#if config.elements.showMedicineTable}}
<table>
  <thead><tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Timing</th><th>Freq.</th><th>Duration</th>{{#if config.elements.showMedicineInstructions}}<th>Notes</th>{{/if}}</tr></thead>
  <tbody>
  {{#each prescriptions}}
  <tr>
    <td>{{addOne @index}}</td>
    <td><span class="med-name">{{#if this.form}}{{formPrefix this.form}} {{/if}}{{this.medicineName}}</span>{{#if ../config.elements.showMedicineComposition}}{{#if (hasValue this.composition)}}<br><span class="med-comp">{{this.composition}}</span>{{/if}}{{/if}}</td>
    <td>{{bi this.dosage}}</td>
    <td>{{bi this.notes}}</td>
    <td>{{bi this.frequency}}</td>
    <td>{{bi this.duration}}</td>
    {{#if ../config.elements.showMedicineInstructions}}<td style="font-size:9px;color:#6b7280">{{bi this.notes}}</td>{{/if}}
  </tr>
  {{/each}}
  </tbody>
</table>
{{/if}}

${testsSection}
${clinicalNotesSection}

{{#if config.elements.showAdvice}}
{{#if advice}}
<div class="advice"><strong>{{bi "Advice:"}}</strong> {{bi advice}}</div>
{{/if}}
{{/if}}

<div class="bottom">
  <div>
    {{#if config.elements.showFollowUp}}{{#if followUpDate}}<div class="followup-badge">📅 {{bi "Follow-up:"}} {{followUpDate}}</div>{{/if}}{{/if}}
  </div>
  <div class="doc-block">
    {{#if config.elements.showDoctorName}}<div class="doc-name">{{doctor.name}}</div>{{/if}}
    {{#if config.elements.showDoctorQualification}}<div class="doc-qual">{{doctor.qualification}}</div>{{/if}}
    {{#if config.elements.showDoctorRegistration}}<div class="doc-reg">Reg: {{doctor.registrationNumber}}</div>{{/if}}
  </div>
</div>

<div style="position:fixed;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#999;">Powered by Infinity Medisetu | www.infinitymedisetu.com</div>

{{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}
</body>
</html>`;
