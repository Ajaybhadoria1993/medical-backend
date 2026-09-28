/**
 * Quick Print Template 2 — "Standard Medicine Sheet"
 * Professional A4 layout for everyday clinics with clinic header and medicine table.
 */
import {
  clinicalNotesSection,
  clinicalSummarySection,
  testsSection,
} from './clinicalSections';

export const quickPrintTemplate2 = `
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
    max-width: 800px; margin: 0 auto; padding: 20px;
  }
  .clinic-header { text-align: center; border-bottom: 3px solid {{config.accentColor}}; padding-bottom: 12px; margin-bottom: 14px; }
  .clinic-name { font-size: 17px; font-weight: 700; color: #000; }
  .clinic-details { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .patient-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; background: #f8fafc; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
  .field { font-size: 11px; }
  .field-label { color: #6b7280; }
  .field-value { font-weight: 600; color: #1f2937; }
  .rx-symbol { font-size: 20px; font-weight: bold; color: #000; margin: 6px 0; }
  .diagnosis-box { font-size: 11px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th { background: #333; color: #fff; padding: 7px 9px; font-size: 10px; text-align: left; font-weight: 600; }
  td { padding: 7px 9px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  .med-name { font-weight: 600; color: #1f2937; }
  .med-comp { font-size: 9px; color: #6b7280; }
  .advice-section { background: {{config.accentColor}}10; border-radius: 6px; padding: 10px; margin-top: 10px; font-size: 11px; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; padding-top: 10px; border-top: 2px solid #e5e7eb; }
  .followup { font-size: 11px; color: #000; font-weight: 600; }
  .doctor-block { text-align: right; }
  .doctor-name { font-weight: 700; font-size: 13px; color: #1f2937; }
  .doctor-qual { font-size: 10px; color: #6b7280; }
</style>
</head>
<body>

{{#if config.elements.showClinicHeader}}
<div class="clinic-header">
  <div class="clinic-name">{{clinic.name}}</div>
  <div class="clinic-details">{{clinic.address}} {{#if clinic.phone}}| {{clinic.phone}}{{/if}}</div>
</div>
{{/if}}

{{#if config.elements.showPatientName}}
<div class="patient-grid">
  <div class="field"><span class="field-label">Patient: </span><span class="field-value">{{patient.name}}</span></div>
  {{#if config.elements.showPatientUhid}}<div class="field"><span class="field-label">UHID: </span><span class="field-value">{{patient.uhid}}</span></div>{{/if}}
  {{#if config.elements.showVisitDate}}<div class="field"><span class="field-label">Date: </span><span class="field-value">{{visitDate}}</span></div>{{/if}}
  {{#if config.elements.showPatientAge}}<div class="field"><span class="field-label">Age: </span><span class="field-value">{{patient.age}}y</span></div>{{/if}}
  <div class="field"><span class="field-label">Gender: </span><span class="field-value">{{patient.gender}}</span></div>
  {{#if config.elements.showPatientMobile}}<div class="field"><span class="field-label">Mobile: </span><span class="field-value">{{patient.mobile}}</span></div>{{/if}}
</div>
{{/if}}

${clinicalSummarySection}

{{#if config.elements.showDiagnosis}}
{{#if diagnosis}}
<div class="diagnosis-box"><strong>Diagnosis:</strong> {{diagnosis}}</div>
{{/if}}
{{/if}}

<div class="rx-symbol">℞</div>

{{#if config.elements.showMedicineTable}}
<table>
  <thead><tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Timing</th><th>Frequency</th><th>Duration</th></tr></thead>
  <tbody>
  {{#each prescriptions}}
  <tr>
    <td>{{addOne @index}}</td>
    <td><span class="med-name">{{#if this.form}}{{formPrefix this.form}} {{/if}}{{this.medicineName}}</span>{{#if ../config.elements.showMedicineComposition}}{{#if (hasValue this.composition)}}<br><span class="med-comp">{{this.composition}}</span>{{/if}}{{/if}}</td>
    <td>{{bi this.dosage}}</td>
    <td>{{bi this.notes}}</td>
    <td>{{bi this.frequency}}</td>
    <td>{{bi this.duration}}</td>
  </tr>
  {{/each}}
  </tbody>
</table>
{{/if}}

${testsSection}
${clinicalNotesSection}

{{#if config.elements.showAdvice}}
{{#if advice}}
<div class="advice-section"><strong>{{bi "Advice:"}}</strong> {{bi advice}}</div>
{{/if}}
{{/if}}

<div class="footer">
  <div>
    {{#if config.elements.showFollowUp}}{{#if followUpDate}}<div class="followup">{{bi "Follow-up:"}} {{followUpDate}}</div>{{/if}}{{/if}}
  </div>
  <div class="doctor-block">
    {{#if config.elements.showDoctorName}}<div class="doctor-name">{{doctor.name}}</div>{{/if}}
    {{#if config.elements.showDoctorQualification}}<div class="doctor-qual">{{doctor.qualification}}</div>{{/if}}
    {{#if config.elements.showDoctorRegistration}}<div class="doctor-qual">Reg: {{doctor.registrationNumber}}</div>{{/if}}
  </div>
</div>

<div style="position:fixed;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#999;">Powered by Infinity Medisetu | www.infinitymedisetu.com</div>

{{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}
</body>
</html>`;
