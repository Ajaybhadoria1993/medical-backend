/**
 * Shared Handlebars fragments for the optional clinical sections of the quick
 * print templates (chief complaints, vitals, allergies, tests, clinical notes).
 *
 * Each fragment is gated twice: once on the doctor's element toggle from the
 * Quick Print designer, and once on the visit actually having that data — so a
 * section the doctor enabled never prints as an empty label.
 *
 * Interpolated into each template string with `${...}` so all six layouts stay
 * in sync; they use inline styles to remain layout-agnostic.
 */

/** Chief complaints / vitals / allergies — sits above the diagnosis line. */
export const clinicalSummarySection = `
{{#if config.elements.showChiefComplaints}}
{{#if symptoms.length}}
<div style="font-size:11px;margin-bottom:4px;"><strong>C/O:</strong> {{#each symptoms}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}</div>
{{/if}}
{{/if}}

{{#if config.elements.showVitals}}
{{#if vitalsMoreThanOne}}
<div style="font-size:11px;margin-bottom:4px;"><strong>Vitals:</strong>
  {{#if vitals.bpSys}}BP: {{vitals.bpSys}}/{{vitals.bpDia}} mmHg{{/if}}
  {{#if vitals.fbs}} &middot; FBS: {{vitals.fbs}} mg/dL{{/if}}
  {{#if vitals.ppbs}} &middot; PPBS: {{vitals.ppbs}} mg/dL{{/if}}
  {{#if vitals.rbs}} &middot; RBS: {{vitals.rbs}} mg/dL{{/if}}
  {{#if vitals.pulse}} &middot; Pulse: {{vitals.pulse}}/min{{/if}}
  {{#if vitals.spo2}} &middot; SpO2: {{vitals.spo2}}%{{/if}}
  {{#if vitals.temperatureC}} &middot; Temp: {{vitals.temperatureC}}&deg;C{{/if}}
  {{#if vitals.heightCm}} &middot; Ht: {{vitals.heightCm}} cm{{/if}}
  {{#if vitals.weightKg}} &middot; Wt: {{vitals.weightKg}} kg{{/if}}
  {{#if vitals.bmi}} &middot; BMI: {{vitals.bmi}}{{/if}}
</div>
{{/if}}
{{/if}}

{{#if config.elements.showAllergies}}
{{#if allergies}}
<div style="font-size:11px;margin-bottom:4px;color:#b91c1c;"><strong>Allergies:</strong> {{allergies}}</div>
{{/if}}
{{/if}}
`;

/** Tests / investigations advised — sits below the medicine table. */
export const testsSection = `
{{#if config.elements.showTests}}
{{#if hasTests}}
<div style="font-size:11px;margin-top:8px;"><strong>Tests / Investigations:</strong> {{testNames}}</div>
{{/if}}
{{/if}}
`;

/** Free-text clinical notes — sits below the tests section. */
export const clinicalNotesSection = `
{{#if config.elements.showClinicalNotes}}
{{#if dietarySuggestion}}
<div style="font-size:11px;margin-top:6px;"><strong>{{bi "Notes:"}}</strong> {{bi dietarySuggestion}}</div>
{{/if}}
{{/if}}
`;
