/**
 * Quick Print Template 3 — "Minimal Prescription"
 * Clean layout with only essential info. No branding, no vitals, no diagnosis.
 */
import {
  clinicalNotesSection,
  clinicalSummarySection,
  testsSection,
} from './clinicalSections';

export const quickPrintTemplate3 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
{{{i18n.head}}}
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: '{{config.primaryFont}}', Poppins, sans-serif;
    font-size: 12px; line-height: 1.5; color: #1f2937;
    max-width: 700px; margin: 0 auto; padding: 24px;
  }
  .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .patient-name { font-size: 15px; font-weight: 700; }
  .patient-meta { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .date { font-size: 10px; color: {{config.accentColor}}; font-weight: 600; }
  .rx { font-size: 18px; color: {{config.accentColor}}; font-weight: bold; margin: 10px 0 6px; }
  .med-item { display: flex; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #e5e7eb; align-items: baseline; }
  .med-num { font-size: 11px; color: #9ca3af; min-width: 18px; }
  .med-name { font-size: 12px; font-weight: 600; color: #1f2937; }
  .med-details { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 24px; padding-top: 10px; border-top: 1.5px solid {{config.accentColor}}20; }
  .followup { font-size: 10px; color: {{config.accentColor}}; font-weight: 600; background: {{config.accentColor}}10; padding: 3px 8px; border-radius: 4px; }
  .doctor-name { font-weight: 700; font-size: 12px; text-align: right; }
  .doctor-qual { font-size: 9px; color: #6b7280; text-align: right; }
</style>
</head>
<body>

<div class="top-bar">
  <div>
    {{#if config.elements.showPatientName}}<div class="patient-name">{{patient.name}}</div>{{/if}}
    <div class="patient-meta">
      {{#if config.elements.showPatientAge}}{{patient.age}}y · {{patient.gender}}{{/if}}
      {{#if config.elements.showPatientUhid}} · UHID: {{patient.uhid}}{{/if}}
    </div>
  </div>
  {{#if config.elements.showVisitDate}}<div class="date">{{visitDate}}</div>{{/if}}
</div>

${clinicalSummarySection}

<div class="rx">℞</div>

{{#if config.elements.showMedicineTable}}
<div class="medicines">
  {{#each prescriptions}}
  <div class="med-item">
    <span class="med-num">{{addOne @index}}.</span>
    <div style="flex:1">
      <div class="med-name">{{#if this.form}}{{formPrefix this.form}} {{/if}}{{this.medicineName}}</div>
      <div class="med-details">{{biJoin this.dosage this.frequency this.duration " · "}}</div>
    </div>
  </div>
  {{/each}}
</div>
{{/if}}

${testsSection}
${clinicalNotesSection}

{{#if config.elements.showAdvice}}
{{#if advice}}
<div style="font-size:10px;color:#6b7280;margin-top:10px;"><strong>{{bi "Advice:"}}</strong> {{bi advice}}</div>
{{/if}}
{{/if}}

<div class="footer">
  <div>
    {{#if config.elements.showFollowUp}}{{#if followUpDate}}<div class="followup">{{bi "Next:"}} {{followUpDate}}</div>{{/if}}{{/if}}
  </div>
  <div>
    {{#if config.elements.showDoctorName}}<div class="doctor-name">{{doctor.name}}</div>{{/if}}
    {{#if config.elements.showDoctorQualification}}<div class="doctor-qual">{{doctor.qualification}}</div>{{/if}}
  </div>
</div>

<div style="position:fixed;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#999;">Powered by Infinity Medisetu | www.infinitymedisetu.com</div>

{{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}
</body>
</html>`;
