/**
 * Quick Print Template 1 — "Compact Medicine Slip"
 * Clean white layout matching HealthPlix-style prescriptions.
 * Black text on white background, minimal styling.
 */
import {
  clinicalNotesSection,
  clinicalSummarySection,
  testsSection,
} from './clinicalSections';

export const quickPrintTemplate1 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
{{{i18n.head}}}
<style>
  @page { size: A5; margin: 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: '{{config.primaryFont}}', Inter, Arial, sans-serif;
    font-size: 11px; line-height: 1.5; color: #000;
    max-width: 600px; margin: 0 auto; padding: 12px;
  }
  .header { padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #000; }
  .patient-line { font-size: 12px; font-weight: bold; }
  .date-line { font-size: 11px; font-weight: bold; text-align: right; margin-top: -16px; }
  .diagnosis { font-size: 11px; font-style: italic; margin: 6px 0; }
  .rx { font-size: 16px; margin: 8px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; font-size: 10px; font-weight: bold; border-bottom: 1px solid #000; padding: 4px 6px; }
  td { padding: 6px; border-bottom: 1px solid #ddd; font-size: 11px; vertical-align: top; }
  .med-name { font-weight: bold; font-size: 11px; }
  .med-comp { font-size: 9px; color: #555; font-style: italic; }
  .med-timing { font-size: 9px; font-style: italic; }
  .followup { font-size: 11px; font-weight: bold; font-style: italic; margin-top: 12px; }
  .doctor-block { text-align: right; margin-top: 30px; }
  .doctor-name { font-weight: bold; font-size: 12px; }
  .doctor-qual { font-size: 11px; }
</style>
</head>
<body>

{{#if config.elements.showPatientName}}
<div class="header">
  <div class="patient-line">{{patient.uhid}} : {{patient.name}} ({{patient.age}}y, {{patient.gender}}) - {{patient.mobile}}</div>
  {{#if config.elements.showVisitDate}}<div class="date-line">Date: {{visitDate}}</div>{{/if}}
</div>
{{/if}}

${clinicalSummarySection}

{{#if config.elements.showDiagnosis}}
{{#if diagnosis}}
<div class="diagnosis"><em>Diagnosis</em>: {{diagnosis}}</div>
{{/if}}
{{/if}}

{{#if config.elements.showMedicineTable}}
<div class="rx">℞</div>
<table>
  <thead>
    <tr>
      <th style="width:30px"></th>
      <th>Medicine</th>
      <th>Dosage</th>
      <th>Timing - Freq. - Duration</th>
    </tr>
  </thead>
  <tbody>
  {{#each prescriptions}}
  <tr>
    <td>{{addOne @index}})</td>
    <td>
      <span class="med-name">{{#if this.form}}{{formPrefix this.form}} {{/if}}{{this.medicineName}}</span>
      {{#if (hasValue this.composition)}}<br><span class="med-comp">Composition &nbsp;: {{this.composition}}</span>{{/if}}
      {{#if (hasValue this.notes)}}<br><span class="med-timing">{{bi "Timing"}} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {{bi this.notes}}</span>{{/if}}
    </td>
    <td>{{bi this.dosage}}</td>
    <td>{{biJoin this.frequency this.duration " - "}}</td>
  </tr>
  {{/each}}
  </tbody>
</table>
{{/if}}

${testsSection}
${clinicalNotesSection}

{{#if config.elements.showAdvice}}
{{#if advice}}
<div style="font-size:10px;margin-top:8px;"><strong>{{bi "Advice:"}}</strong> {{bi advice}}</div>
{{/if}}
{{/if}}

{{#if config.elements.showFollowUp}}
{{#if followUpDate}}
<div class="followup"><em>{{bi "Next Visit"}}</em> : {{followUpDate}}</div>
{{/if}}
{{/if}}

{{#if config.elements.showDoctorName}}
<div class="doctor-block">
  <div class="doctor-name">{{doctor.name}}</div>
  {{#if config.elements.showDoctorQualification}}<div class="doctor-qual">{{doctor.qualification}}</div>{{/if}}
  {{#if config.elements.showDoctorRegistration}}<div class="doctor-qual">Reg: {{doctor.registrationNumber}}</div>{{/if}}
</div>
{{/if}}

<div style="position:fixed;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#999;">Powered by Infinity Medisetu | www.infinitymedisetu.com</div>

{{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}
</body>
</html>`;
