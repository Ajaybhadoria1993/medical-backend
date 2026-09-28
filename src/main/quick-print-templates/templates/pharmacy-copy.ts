/**
 * Quick Print Template 4 — "Pharmacy Copy"
 * Designed for pharmacies. Compact, maximum readability, quantity column, QR placeholder.
 */
import {
  clinicalNotesSection,
  clinicalSummarySection,
  testsSection,
} from './clinicalSections';

export const quickPrintTemplate4 = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A5; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: '{{config.primaryFont}}', Inter, sans-serif;
    font-size: 11px; line-height: 1.4; color: #333;
    max-width: 600px; margin: 0 auto; padding: 14px;
  }
  .header { background: #FEF3C7; border: 2px solid {{config.accentColor}}; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
  .header-left { font-size: 14px; font-weight: 700; color: #92400E; }
  .header-right { font-size: 9px; color: #92400E; text-align: right; }
  .patient-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; padding: 8px; background: #FFFBEB; border-radius: 4px; }
  .pfield { font-size: 10px; }
  .pfield b { color: #1f2937; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  th { background: {{config.accentColor}}; color: #fff; padding: 6px 8px; font-size: 9px; text-align: left; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 10px; }
  .med-name { font-weight: 700; color: #1f2937; }
  .med-comp { font-size: 9px; color: #6b7280; }
  .footer { margin-top: 12px; padding-top: 10px; border-top: 2px dashed {{config.accentColor}}; display: flex; justify-content: space-between; align-items: center; }
  .prescriber { font-size: 10px; color: #6b7280; }
  .prescriber b { color: #1f2937; font-size: 11px; }
  .qr-box { width: 50px; height: 50px; border: 2px dashed {{config.accentColor}}; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 8px; color: {{config.accentColor}}; text-align: center; }
</style>
</head>
<body>

{{#if config.elements.showClinicHeader}}
<div class="header">
  <div class="header-left">⚕ PHARMACY COPY</div>
  <div class="header-right">Date: {{visitDate}}<br/>{{#if config.elements.showPatientUhid}}UHID: {{patient.uhid}}{{/if}}</div>
</div>
{{/if}}

{{#if config.elements.showPatientName}}
<div class="patient-row">
  <div class="pfield"><b>Patient:</b> {{patient.name}}</div>
  {{#if config.elements.showPatientAge}}<div class="pfield"><b>Age:</b> {{patient.age}}y</div>{{/if}}
  <div class="pfield"><b>Gender:</b> {{patient.gender}}</div>
  {{#if config.elements.showPatientMobile}}<div class="pfield"><b>Mobile:</b> {{patient.mobile}}</div>{{/if}}
</div>
{{/if}}

${clinicalSummarySection}

{{#if config.elements.showMedicineTable}}
<table>
  <thead><tr><th>#</th><th>Medicine</th>{{#if config.elements.showMedicineQuantity}}<th>Qty</th>{{/if}}<th>Dosage</th><th>Duration</th><th>Instructions</th></tr></thead>
  <tbody>
  {{#each prescriptions}}
  <tr>
    <td>{{addOne @index}}</td>
    <td><span class="med-name">{{#if this.form}}{{formPrefix this.form}} {{/if}}{{this.medicineName}}</span>{{#if ../config.elements.showMedicineComposition}}{{#if (hasValue this.composition)}}<br><span class="med-comp">{{this.composition}}</span>{{/if}}{{/if}}</td>
    {{#if ../config.elements.showMedicineQuantity}}<td style="text-align:center;font-weight:600">{{this.quantity}}</td>{{/if}}
    <td>{{this.dosage}}</td>
    <td>{{this.duration}}</td>
    <td style="font-size:9px;color:#6b7280">{{this.notes}}</td>
  </tr>
  {{/each}}
  </tbody>
</table>
{{/if}}

${testsSection}
${clinicalNotesSection}

<div class="footer">
  <div class="prescriber">
    Prescribed by:<br/>
    {{#if config.elements.showDoctorName}}<b>{{doctor.name}}</b><br/>{{/if}}
    {{#if config.elements.showDoctorQualification}}{{doctor.qualification}}{{/if}}
  </div>
  {{#if config.elements.showQrCode}}<div class="qr-box">QR<br/>Code</div>{{/if}}
</div>

<div style="position:fixed;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#999;">Powered by Infinity Medisetu | www.infinitymedisetu.com</div>

</body>
</html>`;
