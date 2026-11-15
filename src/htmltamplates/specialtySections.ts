// Inline styles, so the grid looks the same inside every layout's own section markup.
// Headers may wrap, so an 8-column table (Limb Exam) still fits a narrow side column.
const TABLE =
  'width:100%;border-collapse:collapse;margin:2px 0 4px;font-size:inherit;color:inherit;break-inside:avoid';
const TH =
  'text-align:left;font-weight:600;padding:2px 6px;border-bottom:1px solid #cbd2da';
const TD = 'padding:2px 6px;border-bottom:1px solid #e6e9ee;vertical-align:top';

// An exam table's rows as a grid (Right ear / Left ear × fields); an empty cell prints a dash.
const examGrid =
  `{{#if this.table}}<table style="${TABLE}"><thead><tr><th style="${TH}">{{this.table.labelHeader}}</th>` +
  `{{#each this.table.columns}}<th style="${TH}">{{this}}</th>{{/each}}</tr></thead><tbody>` +
  `{{#each this.table.rows}}<tr><td style="${TD};font-weight:600;white-space:nowrap">{{this.label}}</td>` +
  `{{#each this.cells}}<td style="${TD}">{{#if this}}{{this}}{{else}}—{{/if}}</td>{{/each}}</tr>{{/each}}` +
  `</tbody></table>{{/if}}`;

/** History and chart notes for every layout; `open` is the layout's section markup around `{{this.heading}}`.
 * `only` splits them for side-column layouts: lists stay in the column, tables go where there is width. */
export const specialtySectionsHtml = (
  open = '<div style="margin-top:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">{{this.heading}}</div>',
  close = '</div>',
  listClass = '',
  only?: 'lists' | 'tables'
) => {
  const body = `${open}${examGrid}{{#if this.rows.length}}<ul${listClass ? ` class="${listClass}"` : ''}>{{#each this.rows}}<li style="break-inside:avoid">{{#if this.label}}{{this.label}}: {{/if}}{{this.value}}</li>{{/each}}</ul>{{/if}}${close}`;
  const shown =
    only === 'tables'
      ? `{{#if this.table}}${body}{{/if}}`
      : only === 'lists'
        ? `{{#unless this.table}}${body}{{/unless}}`
        : body;
  return `{{#each (specialtySections additionalInformation comorbidities config.elements.showAdditionalInformation)}}${shown}{{/each}}`;
};

/** Quick print (canned templates and designer layouts): inline-styled, no template classes to borrow. */
export const SPECIALTY_SECTIONS_HTML = specialtySectionsHtml();
