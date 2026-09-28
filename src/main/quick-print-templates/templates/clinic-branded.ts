/**
 * Quick Print Template 6 — "Clinic Branded"
 * Full branding with logo area, colored header/footer, watermark.
 */
import {
  clinicalNotesSection,
  clinicalSummarySection,
  testsSection,
} from './clinicalSections';

export const quickPrintTemplate6 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
{{{i18n.head}}}
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: '{{config.primaryFont}}', Inter, sans-serif;
    font-size: 12px; line-height: 1.5; color: #333;
    max-width: 850px; margin: 0 auto; position: relative;
  }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 50px; color: {{config.accentColor}}08; font-weight: 900; pointer-events: none; z-index: 0; }
  .branded-header { background: linear-gradient(135deg, {{config.accentColor}}, {{config.accentColor}}cc); padding: 16px 22px; color: #fff; display: flex; justify-content: space-between; align-items: center; }
  .logo-area { display: flex; align-items: center; gap: 10px; }
  .logo-circle { width: 40px; height: 40px; background: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 900; color: {{config.accentColor}}; }
  .brand-name { font-size: 16px; font-weight: 700; }
  .brand-tagline { font-size: 9px; opacity: 0.85; }
  .header-right { text-align: right; font-size: 9px; opacity: 0.85; }
  .content { padding: 18px 22px; position: relative; z-index: 1; }
  .patient-strip { display: flex; flex-wrap: wrap; gap: 10px; background: {{config.accentColor}}08; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
  .ps-field { font-size: 10px; color: #374151; }
  .ps-field b { color: {{config.accentColor}}; }
  .rx { font-size: 18px; font-weight: bold; color: {{config.accentColor}}; margin: 8px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: {{config.accentColor}}; color: #fff; padding: 7px 9px; font-size: 9px; text-align: left; }
  td { padding: 7px 9px; border-bottom: 1px solid {{config.accentColor}}20; font-size: 11px; }
  tr:nth-child(even) { background: {{config.accentColor}}05; }
  .med-name { font-weight: 600; }
  .med-comp { font-size: 9px; color: #6b7280; }
  .branded-footer { background: {{config.accentColor}}08; border-top: 3px solid {{config.accentColor}}; padding: 12px 22px; display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
  .footer-left { font-size: 9px; color: #6b7280; }
  .footer-left a { color: {{config.accentColor}}; text-decoration: none; font-weight: 600; }
  .doc-block { text-align: right; }
  .doc-name { font-size: 13px; font-weight: 700; color: #1f2937; }
  .doc-qual { font-size: 10px; color: #6b7280; }
</style>
</head>
<body>

<div class="watermark">{{clinic.name}}</div>

{{#if config.elements.showClinicHeader}}
<div class="branded-header">
  <div class="logo-area">
    {{#if config.elements.showClinicLogo}}<div class="logo-circle">{{firstLetter clinic.name}}</div>{{/if}}
    <div>
      <div class="brand-name">{{clinic.name}}</div>
      <div class="brand-tagline">{{clinic.address}}</div>
    </div>
  </div>
  <div class="header-right">{{clinic.phone}}</div>
</div>
{{/if}}

<div class="content">

{{#if config.elements.showPatientName}}
<div class="patient-strip">
  <div class="ps-field"><b>Patient:</b> {{patient.name}}</div>
  {{#if config.elements.showPatientUhid}}<div class="ps-field"><b>UHID:</b> {{patient.uhid}}</div>{{/if}}
  {{#if config.elements.showPatientAge}}<div class="ps-field"><b>Age/Gender:</b> {{patient.age}}y / {{patient.gender}}</div>{{/if}}
  {{#if config.elements.showVisitDate}}<div class="ps-field"><b>Date:</b> {{visitDate}}</div>{{/if}}
  {{#if config.elements.showPatientMobile}}<div class="ps-field"><b>Mobile:</b> {{patient.mobile}}</div>{{/if}}
</div>
{{/if}}

${clinicalSummarySection}

{{#if config.elements.showDiagnosis}}
{{#if diagnosis}}
<div style="margin-bottom:8px;font-size:11px;"><strong style="color:{{config.accentColor}}">Diagnosis:</strong> {{diagnosis}}</div>
{{/if}}
{{/if}}

<div class="rx">℞</div>

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
<div style="background:{{config.accentColor}}08;padding:8px 10px;border-radius:4px;margin-top:10px;font-size:11px"><strong style="color:{{config.accentColor}}">{{bi "Advice:"}}</strong> {{bi advice}}</div>
{{/if}}
{{/if}}

</div>

{{#if config.elements.showFooter}}
<div class="branded-footer">
  <div class="footer-left">
    {{#if config.elements.showFollowUp}}{{#if followUpDate}}<div style="font-weight:600;color:{{config.accentColor}};margin-bottom:2px">{{bi "Follow-up:"}} {{followUpDate}}</div>{{/if}}{{/if}}
  </div>
  <div class="doc-block">
    {{#if config.elements.showDoctorName}}<div class="doc-name">{{doctor.name}}</div>{{/if}}
    {{#if config.elements.showDoctorQualification}}<div class="doc-qual">{{doctor.qualification}}</div>{{/if}}
  </div>
</div>
{{/if}}

<div style="position:fixed;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#999;">Powered by Infinity Medisetu | www.infinitymedisetu.com</div>

{{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}
</body>
</html>`;
