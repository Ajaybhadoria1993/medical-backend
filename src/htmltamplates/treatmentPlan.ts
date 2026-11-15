// Inline styles only and colours inherited, so the block takes each template's font and palette.
const CELL = 'padding:3px 0;vertical-align:top';
const RULE =
  '{{#unless @first}}border-top:1px solid rgba(127,127,127,.22);{{/unless}}';

/** The treatment plan(s) suggested at this visit (`treatmentPlans`), one source for every layout; never shows prices.
 *  Each template passes its own section markup, so the heading prints like its other sections. */
export const treatmentPlanHtml = (
  open = '<div style="margin-top:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">Treatment Plan</div>',
  close = '</div>'
) =>
  `{{#if config.elements.showTreatmentPlan}}{{#if treatmentPlans.length}}${open}{{#each treatmentPlans}}` +
  `<div style="break-inside:avoid;{{#unless @first}}margin-top:8px;{{/unless}}">` +
  `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">` +
  `<span style="font-weight:600">{{this.title}}</span>` +
  `<span style="flex:none;font-size:.78em;font-weight:600;letter-spacing:.4px;text-transform:uppercase;opacity:.7">{{this.status}}</span></div>` +
  `{{#if this.steps.length}}<table style="width:100%;border-collapse:collapse;margin-top:3px;font-size:.92em">` +
  `{{#each this.steps}}<tr style="break-inside:avoid">` +
  `<td style="${CELL};${RULE}width:1.6em;opacity:.6">{{this.n}}.</td>` +
  `<td style="${CELL};${RULE}padding-right:8px">{{this.name}}</td>` +
  `<td style="${CELL};${RULE}text-align:right;white-space:nowrap;opacity:.7">{{this.when}}</td>` +
  `</tr>{{/each}}</table>{{/if}}</div>{{/each}}${close}{{/if}}{{/if}}`;

/** Quick print (canned templates and designer layouts): inline-styled, no template classes to borrow. */
export const TREATMENT_PLAN_HTML = treatmentPlanHtml();
