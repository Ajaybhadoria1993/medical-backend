/** Builds the Handlebars template for a Quick Print designer layout; it receives the same `pdfData` as the canned templates.
 * `flow` (default) stacks the rows with no gaps; `exact` prints every block at its saved millimetre coordinates. */

export type LayoutBlockId =
  | 'clinicHeader'
  | 'patientInfo'
  | 'visitDate'
  | 'chiefComplaints'
  | 'vitals'
  | 'allergies'
  | 'preDiagnosis'
  | 'diagnosis'
  | 'rxSymbol'
  | 'medicineTable'
  | 'tests'
  | 'clinicalNotes'
  | 'advice'
  | 'followUp'
  | 'doctorSignature'
  | 'habits';

export type LayoutBlock = {
  id: LayoutBlockId | string;
  visible: boolean;
  position: { x: number; y: number; width: number; height: number };
};

/** Shape needed to estimate how tall the medicine table will actually render. */
export type MedicineRowMetrics = {
  hasComposition: boolean;
};

export type LayoutMode = 'flow' | 'exact';

export type QuickPrintDesign = 'original' | 'modern';

export type BuildLayoutOptions = {
  blockLayout: LayoutBlock[];
  pageSize?: string;
  tableStyle?: string;
  /** `flow` stacks rows and skips empty ones; `exact` keeps every saved coordinate (pre-printed pads). */
  layoutMode?: LayoutMode;
  /** `modern` (default), or `original` — the look Quick Print had before the redesign. */
  design?: QuickPrintDesign;
  medicineRows?: MedicineRowMetrics[];
  /** Switched-off blocks this visit has data for — they print anyway (see `applyDataDrivenBlocks`). */
  filledBlockIds?: string[];
  /** Blocks the doctor switched off; they never print, even when filled in. */
  hiddenBlockIds?: string[];
  /** Section keys switched off (`showPatientAge`…), dropped from inside blocks that still print. */
  hiddenSections?: string[];
};

/** Whether a section switch is on, for the fields inside a block. */
type Shows = (sectionKey: string) => boolean;

/** The section switches each block's markup honours — keep in step with `getBlockMarkup`. */
const BLOCK_SECTION_KEYS: Record<string, string[]> = {
  clinicHeader: ['showClinicHeader', 'showClinicAddress', 'showClinicPhone'],
  patientInfo: ['showPatientAge', 'showPatientGender'],
  visitDate: ['showVisitDate'],
  chiefComplaints: ['showChiefComplaints'],
  vitals: ['showVitals'],
  allergies: ['showAllergies'],
  preDiagnosis: ['showPreDiagnosis'],
  diagnosis: ['showDiagnosis'],
  rxSymbol: ['showRxSymbol'],
  medicineTable: ['showMedicineComposition', 'showMedicineInstructions'],
  tests: ['showTests'],
  clinicalNotes: ['showClinicalNotes'],
  advice: ['showAdvice'],
  followUp: ['showFollowUp'],
  doctorSignature: [
    'showDoctorQualification',
    'showDoctorRegistration',
    'showDoctorSignature',
  ],
  habits: ['showHabits'],
};

/** Switches a layout can act on: every block it holds, hidden ones too, since a filled-in block still prints. */
export function layoutSectionKeys(
  blockLayout: LayoutBlock[] | undefined
): string[] {
  return (blockLayout ?? []).flatMap(
    (block) => BLOCK_SECTION_KEYS[block.id] ?? []
  );
}

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  thermal80mm: { width: 80, height: 200 },
  letter: { width: 216, height: 279 },
  custom: { width: 210, height: 297 },
};

/** Space between flow rows in mm — must match `FLOW_ROW_GAP_MM` in the frontend designer. */
const FLOW_ROW_GAP_MM = 3;

/** Printed right after the content rather than pinned to the page bottom, so no gap opens above it. */
const poweredBy = (style: string) =>
  `<div class="qp-footer" style="${style}">Powered by Infinity Medisetu | www.infinitymedisetu.com</div>`;

// Row-height estimates in mm, used only by exact mode to push blocks below an overflowing table.
const TABLE_HEADER_MM = 6;
const TABLE_ROW_BASE_MM = 6;
const TABLE_ROW_COMPOSITION_MM = 3;

type TableStyleCss = {
  table: string;
  th: string;
  td: string;
  /** Emitted into the document head; striping via nth-child needs no helper. */
  stripeRule: string;
};

function getTableStyleCss(style: string): TableStyleCss {
  switch (style) {
    case 'bordered':
      return {
        table:
          'width:100%;border-collapse:collapse;font-size:10px;border:1px solid #333',
        th: 'padding:4px 6px;text-align:left;font-weight:bold;border:1px solid #333;background:#f5f5f5',
        td: 'padding:4px 6px;border:1px solid #ccc;vertical-align:top',
        stripeRule: '',
      };
    case 'striped':
      return {
        table: 'width:100%;border-collapse:collapse;font-size:10px',
        th: 'padding:4px 6px;text-align:left;font-weight:bold;border-bottom:2px solid #333',
        td: 'padding:5px 6px;vertical-align:top',
        stripeRule:
          '.qp-table tbody tr:nth-child(even) { background: #f9f9f9; }',
      };
    case 'minimal':
      return {
        table: 'width:100%;border-collapse:collapse;font-size:10px',
        th: 'padding:4px 6px;text-align:left;font-weight:bold;color:#666',
        td: 'padding:6px;vertical-align:top',
        stripeRule: '',
      };
    case 'classic':
    default:
      return {
        table: 'width:100%;border-collapse:collapse;font-size:10px',
        th: 'padding:3px 6px;text-align:left;font-weight:bold;border-bottom:1px solid #000',
        td: 'padding:4px 6px;border-bottom:1px solid #eee;vertical-align:top',
        stripeRule: '',
      };
  }
}

/** A medicine field, or a muted en dash when the visit left it empty or as a placeholder. */
const doseCell = (field: string) =>
  `{{#if (hasValue ${field})}}{{bi ${field}}}{{else}}<span style="color:#999">&ndash;</span>{{/if}}`;

/** A comma-separated list field. */
const listOf = (field: string) =>
  `{{#each ${field}}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}`;

/** Age and gender after the patient's name, leaving out whichever the doctor switched off. */
function ageGender(shows: Shows, design: QuickPrintDesign): string {
  const age = shows('showPatientAge');
  const gender = shows('showPatientGender');

  if (design === 'original') {
    if (age && gender)
      return '{{#if patient.age}} ({{patient.age}}y{{#if patient.gender}}, {{patient.gender}}{{/if}}){{else}}{{#if patient.gender}} ({{patient.gender}}){{/if}}{{/if}}';
    if (age) return '{{#if patient.age}} ({{patient.age}}y){{/if}}';
    return gender ? '{{#if patient.gender}} ({{patient.gender}}){{/if}}' : '';
  }

  if (age && gender)
    return '{{#if patient.age}} &middot; {{patient.age}} Y{{#if patient.gender}} / {{patient.gender}}{{/if}}{{else}}{{#if patient.gender}} &middot; {{patient.gender}}{{/if}}{{/if}}';
  if (age) return '{{#if patient.age}} &middot; {{patient.age}} Y{{/if}}';
  return gender
    ? '{{#if patient.gender}} &middot; {{patient.gender}}{{/if}}'
    : '';
}

function buildMedicineTable(style: string, shows: Shows): string {
  const s = getTableStyleCss(style);
  const showInstructions = shows('showMedicineInstructions');

  // `frequency` is the dose schedule (1-1-1), `notes` the food timing and `dosage` the free-text instruction.
  return `
{{#if prescriptions.length}}
<table class="qp-table" style="${s.table};table-layout:fixed">
  <thead>
    <tr>
      <th style="${s.th};width:6%">#</th>
      <th style="${s.th};width:36%">Medicine</th>
      <th style="${s.th};width:14%">Dosage</th>
      <th style="${s.th};width:16%">Timing</th>
      <th style="${s.th};width:12%">Duration</th>
      ${showInstructions ? `<th style="${s.th}">Instructions</th>` : ''}
    </tr>
  </thead>
  <tbody>
    {{#each prescriptions}}
    <tr>
      <td style="${s.td}">{{addOne @index}}.</td>
      <td style="${s.td}">
        <b>{{#if this.form}}{{formPrefix this.form}} {{/if}}{{this.medicineName}}</b>
        ${shows('showMedicineComposition') ? `{{#if (hasValue this.composition)}}<div style="font-size:9px;color:#555;font-style:italic">{{this.composition}}</div>{{/if}}` : ''}
      </td>
      <td style="${s.td}">${doseCell('this.frequency')}</td>
      <td style="${s.td}">${doseCell('this.notes')}</td>
      <td style="${s.td}">${doseCell('this.duration')}</td>
      ${showInstructions ? `<td style="${s.td}">${doseCell('this.dosage')}</td>` : ''}
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}`;
}

/** Handlebars markup for one block, wrapped in its own data guard so an empty block prints nothing at all. */
function getBlockMarkup(
  id: string,
  tableStyle: string,
  design: QuickPrintDesign,
  shows: Shows
): string {
  if (design === 'original')
    return getOriginalBlockMarkup(id, tableStyle, shows);

  switch (id) {
    case 'clinicHeader': {
      const address = shows('showClinicAddress');
      const phone = shows('showClinicPhone')
        ? `{{#if clinic.phone}}${address ? '{{#if clinic.address}} &middot; {{/if}}' : ''}Ph: {{clinic.phone}}{{/if}}`
        : '';
      return `{{#if clinic.name}}<div style="text-align:center;border-bottom:1px solid #000;padding-bottom:2mm"><div style="font-size:14px;font-weight:bold">{{clinic.name}}</div><div style="font-size:9px;color:#444;margin-top:1px">${address ? '{{#if clinic.address}}{{clinicAddress clinic.address clinic.city clinic.state clinic.zipcode}}{{/if}}' : ''}${phone}</div></div>{{/if}}`;
    }

    case 'patientInfo':
      return `{{#if patient.name}}<div style="font-size:12px">{{#if registrationNo}}<span style="color:#555">Reg. No. {{registrationNo}}</span> &middot; {{/if}}{{#if patient.uhid}}<span style="color:#555">{{patient.uhid}}</span> &middot; {{/if}}<b style="text-transform:capitalize">{{patient.name}}</b>${ageGender(shows, 'modern')}{{#if patient.mobile}} &middot; {{patient.mobile}}{{/if}}</div>{{/if}}`;

    case 'visitDate':
      return `{{#if visitDate}}<div style="font-size:12px;text-align:right"><span style="color:#555">Date:</span> <b>{{visitDate}}</b></div>{{/if}}`;

    case 'chiefComplaints':
      return `{{#if symptoms.length}}<div style="font-size:11px"><b>C/O:</b> {{#each symptoms}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}</div>{{/if}}`;

    case 'vitals':
      return `{{#if vitalsMoreThanOne}}<div style="font-size:11px"><b>Vitals:</b>{{#if vitals.bpSys}}{{#if vitals.bpDia}} BP: {{vitals.bpSys}}/{{vitals.bpDia}} mmHg{{/if}}{{/if}}{{#if vitals.fbs}} &middot; FBS: {{vitals.fbs}} mg/dL{{/if}}{{#if vitals.ppbs}} &middot; PPBS: {{vitals.ppbs}} mg/dL{{/if}}{{#if vitals.rbs}} &middot; RBS: {{vitals.rbs}} mg/dL{{/if}}{{#if vitals.pulse}} &middot; Pulse: {{vitals.pulse}}/min{{/if}}{{#if vitals.spo2}} &middot; SpO2: {{vitals.spo2}}%{{/if}}{{#if vitals.temperatureC}} &middot; Temp: {{vitals.temperatureC}}&deg;C{{/if}}{{#if vitals.heightCm}} &middot; Ht: {{vitals.heightCm}} cm{{/if}}{{#if vitals.weightKg}} &middot; Wt: {{vitals.weightKg}} kg{{/if}}{{#if vitals.bmi}} &middot; BMI: {{vitals.bmi}}{{/if}}</div>{{/if}}`;

    case 'allergies':
      return `{{#if allergies}}<div style="font-size:11px;color:#b91c1c"><b>Allergies:</b> {{allergies}}</div>{{/if}}`;

    case 'preDiagnosis':
      return `{{#if preDiagnosis}}<div style="font-size:11px"><b>Pre-Diagnosis:</b> {{preDiagnosis}}</div>{{/if}}`;

    case 'diagnosis':
      return `{{#if diagnosis}}<div style="font-size:11px"><b>Diagnosis:</b> {{diagnosis}}</div>{{/if}}`;

    case 'rxSymbol':
      return `<div style="font-size:18px;font-weight:bold">&#8478;</div>`;

    case 'medicineTable':
      return buildMedicineTable(tableStyle, shows);

    case 'tests':
      return `{{#if hasTests}}<div style="font-size:11px"><b>Tests / Investigations:</b> {{testNames}}</div>{{/if}}`;

    case 'clinicalNotes':
      return `{{#if dietarySuggestion}}<div style="font-size:11px"><b>{{bi "Notes:"}}</b> {{bi dietarySuggestion}}</div>{{/if}}`;

    case 'advice':
      return `{{#if advice}}<div style="font-size:11px"><b>{{bi "Advice:"}}</b> {{bi advice}}</div>{{/if}}`;

    case 'followUp':
      return `{{#if followUpDate}}<div style="font-size:11px"><b>{{bi "Next Visit:"}}</b> {{followUpDate}}</div>{{/if}}`;

    case 'doctorSignature': {
      // Blank space above the rule is where the doctor signs the printed copy.
      const signature = shows('showDoctorSignature');
      return `{{#if doctor.name}}<div style="text-align:right"><div style="display:inline-block;min-width:50mm;text-align:center">${signature ? '<div style="height:10mm"></div>' : ''}<div style="${signature ? 'border-top:1px solid #333;padding-top:1mm;' : ''}font-size:11px;font-weight:bold">Dr.&nbsp;{{doctor.name}}</div>${shows('showDoctorQualification') ? '{{#if doctor.qualification}}<div style="font-size:10px">{{doctor.qualification}}</div>{{/if}}' : ''}${shows('showDoctorRegistration') ? '{{#if doctor.registrationNumber}}<div style="font-size:9px;color:#555">Medical Reg. No: {{doctor.registrationNumber}}</div>{{/if}}' : ''}</div></div>{{/if}}`;
    }

    case 'habits':
      return `{{#if habits.length}}<div style="font-size:11px"><b>Habits:</b> ${listOf('habits')}</div>{{/if}}`;

    default:
      return '';
  }
}

/** The original medicine table, kept for doctors who choose the original design. */
function buildOriginalMedicineTable(style: string, shows: Shows): string {
  const s = getTableStyleCss(style);
  const showInstructions = shows('showMedicineInstructions');

  return `
{{#if prescriptions.length}}
<table class="qp-table" style="${s.table}">
  <thead>
    <tr>
      <th style="${s.th};width:24px"></th>
      <th style="${s.th};width:35%">Medicine</th>
      ${showInstructions ? `<th style="${s.th};width:15%">Dosage</th>` : ''}
      <th style="${s.th}">Timing - Freq. - Duration</th>
    </tr>
  </thead>
  <tbody>
    {{#each prescriptions}}
    <tr>
      <td style="${s.td}">{{addOne @index}})</td>
      <td style="${s.td}">
        <b>{{#if this.form}}{{formPrefix this.form}} {{/if}}{{this.medicineName}}</b>
        ${shows('showMedicineComposition') ? `{{#if (hasValue this.composition)}}<div style="font-size:9px;color:#555;font-style:italic">Composition: {{this.composition}}</div>{{/if}}` : ''}
        {{#if (hasValue this.notes)}}<div style="font-size:9px;font-style:italic">{{bi "Timing:"}} {{bi this.notes}}</div>{{/if}}
      </td>
      ${showInstructions ? `<td style="${s.td}">{{bi this.dosage}}</td>` : ''}
      <td style="${s.td}">{{biJoin this.frequency this.duration " - "}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}`;
}

/** The original block markup, kept so a doctor can stay on the look Quick Print first shipped with. */
function getOriginalBlockMarkup(
  id: string,
  tableStyle: string,
  shows: Shows
): string {
  switch (id) {
    case 'clinicHeader':
      return `{{#if clinic.name}}<div style="font-size:10px;text-align:center;border-bottom:1px solid #000;padding-bottom:3px">{{clinic.name}}${shows('showClinicAddress') ? '{{#if clinic.address}} | {{clinic.address}}{{/if}}' : ''}${shows('showClinicPhone') ? '{{#if clinic.phone}} | {{clinic.phone}}{{/if}}' : ''}</div>{{/if}}`;

    case 'patientInfo':
      return `{{#if patient.name}}<div style="font-size:11px;font-weight:bold">{{#if registrationNo}}Reg. No. {{registrationNo}} : {{/if}}{{#if patient.uhid}}{{patient.uhid}} : {{/if}}{{patient.name}}${ageGender(shows, 'original')}{{#if patient.mobile}} - {{patient.mobile}}{{/if}}</div>{{/if}}`;

    case 'visitDate':
      return `{{#if visitDate}}<div style="font-size:11px;font-weight:bold;text-align:right">Date: {{visitDate}}</div>{{/if}}`;

    case 'chiefComplaints':
      return `{{#if symptoms.length}}<div style="font-size:10px"><b>C/O:</b> {{#each symptoms}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}</div>{{/if}}`;

    case 'vitals':
      return `{{#if vitalsMoreThanOne}}<div style="font-size:10px"><b>Vitals:</b>{{#if vitals.bpSys}}{{#if vitals.bpDia}} BP: {{vitals.bpSys}}/{{vitals.bpDia}} mmHg{{/if}}{{/if}}{{#if vitals.fbs}} &middot; FBS: {{vitals.fbs}} mg/dL{{/if}}{{#if vitals.ppbs}} &middot; PPBS: {{vitals.ppbs}} mg/dL{{/if}}{{#if vitals.rbs}} &middot; RBS: {{vitals.rbs}} mg/dL{{/if}}{{#if vitals.pulse}} &middot; Pulse: {{vitals.pulse}}/min{{/if}}{{#if vitals.spo2}} &middot; SpO2: {{vitals.spo2}}%{{/if}}{{#if vitals.temperatureC}} &middot; Temp: {{vitals.temperatureC}}&deg;C{{/if}}{{#if vitals.heightCm}} &middot; Ht: {{vitals.heightCm}} cm{{/if}}{{#if vitals.weightKg}} &middot; Wt: {{vitals.weightKg}} kg{{/if}}{{#if vitals.bmi}} &middot; BMI: {{vitals.bmi}}{{/if}}</div>{{/if}}`;

    case 'allergies':
      return `{{#if allergies}}<div style="font-size:10px;color:#b91c1c"><b>Allergies:</b> {{allergies}}</div>{{/if}}`;

    case 'preDiagnosis':
      return `{{#if preDiagnosis}}<div style="font-size:10px"><b>Pre-Diagnosis:</b> {{preDiagnosis}}</div>{{/if}}`;

    case 'diagnosis':
      return `{{#if diagnosis}}<div style="font-size:11px;font-style:italic">Diagnosis: {{diagnosis}}</div>{{/if}}`;

    case 'rxSymbol':
      return `<div style="font-size:16px">&#8478;</div>`;

    case 'medicineTable':
      return buildOriginalMedicineTable(tableStyle, shows);

    case 'tests':
      return `{{#if hasTests}}<div style="font-size:10px"><b>Tests / Investigations:</b> {{testNames}}</div>{{/if}}`;

    case 'clinicalNotes':
      return `{{#if dietarySuggestion}}<div style="font-size:10px"><b>{{bi "Notes:"}}</b> {{bi dietarySuggestion}}</div>{{/if}}`;

    case 'advice':
      return `{{#if advice}}<div style="font-size:10px"><b>{{bi "Advice:"}}</b> {{bi advice}}</div>{{/if}}`;

    case 'followUp':
      return `{{#if followUpDate}}<div style="font-size:11px;font-weight:bold;font-style:italic">{{bi "Next Visit"}} : {{followUpDate}}</div>{{/if}}`;

    case 'doctorSignature':
      return `{{#if doctor.name}}<div style="text-align:right"><div style="font-size:12px;font-weight:bold">{{doctor.name}}</div>${shows('showDoctorQualification') ? '{{#if doctor.qualification}}<div style="font-size:11px">{{doctor.qualification}}</div>{{/if}}' : ''}${shows('showDoctorRegistration') ? '{{#if doctor.registrationNumber}}<div style="font-size:9px;color:#555">Medical Reg. No: {{doctor.registrationNumber}}</div>{{/if}}' : ''}</div>{{/if}}`;

    case 'habits':
      return `{{#if habits.length}}<div style="font-size:10px"><b>Habits:</b> ${listOf('habits')}</div>{{/if}}`;

    default:
      return '';
  }
}

/** Estimated rendered height of the medicine table, in millimetres. */
function estimateTableHeight(rows: MedicineRowMetrics[]): number {
  if (rows.length === 0) return 0;

  return rows.reduce(
    (total, row) =>
      total +
      TABLE_ROW_BASE_MM +
      (row.hasComposition ? TABLE_ROW_COMPOSITION_MM : 0),
    TABLE_HEADER_MM
  );
}

/** Switch on blocks the doctor left off but filled in for this visit — anything typed must reach the patient.
 * Blocks with no data stay hidden, so they never take space. */
function applyDataDrivenBlocks(
  blocks: LayoutBlock[],
  filledBlockIds: string[]
): LayoutBlock[] {
  if (filledBlockIds.length === 0) return blocks;

  const filled = new Set(filledBlockIds);

  return blocks.map((block) =>
    !block.visible && filled.has(block.id) ? { ...block, visible: true } : block
  );
}

const FOOTER_BLOCK_IDS = new Set(['followUp', 'doctorSignature']);

/** Flow order: the footer (Next Visit, signature) moves below every clinical block, even one saved beneath it.
 * Mirrors `flowY` in the FE quick-print types — the two must agree or the sample print lies. */
function flowY(blocks: LayoutBlock[]): (block: LayoutBlock) => number {
  const bodyBottom = Math.max(
    -Infinity,
    ...blocks
      .filter((b) => !FOOTER_BLOCK_IDS.has(b.id))
      .map((b) => b.position.y + (b.position.height || 0))
  );
  const footerTop = Math.min(
    Infinity,
    ...blocks.filter((b) => FOOTER_BLOCK_IDS.has(b.id)).map((b) => b.position.y)
  );
  const shift = Math.max(0, bodyBottom - footerTop);

  return (block) =>
    FOOTER_BLOCK_IDS.has(block.id)
      ? block.position.y + shift
      : block.position.y;
}

/** Top-to-bottom rows of blocks printed side by side (patient beside date). A block that overlaps a row
 * horizontally stacks below it instead — ℞ placed across the table's top edge must not push the table sideways. */
function groupIntoRows(blocks: LayoutBlock[]): LayoutBlock[][] {
  const rows: LayoutBlock[][] = [];
  let rowBottom = -Infinity;
  const yOf = flowY(blocks);

  for (const block of [...blocks].sort((a, b) => yOf(a) - yOf(b))) {
    const bottom = yOf(block) + (block.position.height || 0);
    const row = rows[rows.length - 1];
    const fitsBeside =
      row !== undefined &&
      yOf(block) < rowBottom &&
      row.every(
        (other) =>
          block.position.x >= other.position.x + other.position.width ||
          block.position.x + block.position.width <= other.position.x
      );

    if (fitsBeside) {
      row.push(block);
      rowBottom = Math.max(rowBottom, bottom);
    } else {
      rows.push([block]);
      rowBottom = bottom;
    }
  }

  return rows;
}

/** Left margin of each block within its row, so flow keeps the horizontal spacing set in the designer. */
function rowCellOffsets(
  row: LayoutBlock[]
): { block: LayoutBlock; marginLeft: number }[] {
  let edge = 0;

  return [...row]
    .sort((a, b) => a.position.x - b.position.x)
    .map((block) => {
      const marginLeft = Math.max(0, block.position.x - edge);
      edge = Math.max(edge, block.position.x + block.position.width);
      return { block, marginLeft };
    });
}

/** Normal document flow: no estimates, so nothing can overlap and a long list continues onto the next sheet. */
function renderFlow(
  blocks: LayoutBlock[],
  tableStyle: string,
  design: QuickPrintDesign,
  shows: Shows
): string {
  const top = Math.min(...blocks.map((block) => block.position.y));

  const rowsHtml = groupIntoRows(blocks)
    .map((row) => {
      const cells = rowCellOffsets(row)
        .map(({ block, marginLeft }) => {
          const markup = getBlockMarkup(block.id, tableStyle, design, shows);
          return markup
            ? `<div class="qp-cell" style="margin-left:${marginLeft}mm;width:${block.position.width}mm">${markup}</div>`
            : '';
        })
        .join('');

      return `<div class="qp-row">${cells}</div>`;
    })
    .join('\n');

  return `<div class="qp-flow" style="padding-top:${top}mm">${rowsHtml}\n${poweredBy('margin-top:1mm')}</div>`;
}

/** Exact mode keeps coordinates, so a table longer than designed pushes the blocks below it down instead of overlapping them. */
function reflowBelowMedicineTable(
  blocks: LayoutBlock[],
  rows: MedicineRowMetrics[]
): LayoutBlock[] {
  const table = blocks.find((b) => b.id === 'medicineTable');
  if (!table || rows.length === 0) return blocks;

  const designedHeight = table.position.height || 0;
  const overflow = estimateTableHeight(rows) - designedHeight;
  if (overflow <= 0) return blocks;

  const tableBottom = table.position.y + designedHeight;

  return blocks.map((block) =>
    block.id !== 'medicineTable' && block.position.y >= tableBottom
      ? {
          ...block,
          position: { ...block.position, y: block.position.y + overflow },
        }
      : block
  );
}

function renderExact(
  blocks: LayoutBlock[],
  rows: MedicineRowMetrics[],
  tableStyle: string,
  design: QuickPrintDesign,
  shows: Shows
): { html: string; contentBottom: number } {
  const laidOut = reflowBelowMedicineTable(blocks, rows);

  const html = laidOut
    .map((block) => {
      const markup = getBlockMarkup(block.id, tableStyle, design, shows);
      return markup
        ? `<div class="qp-block" style="left:${block.position.x}mm;top:${block.position.y}mm;width:${block.position.width}mm">${markup}</div>`
        : '';
    })
    .filter(Boolean)
    .join('\n');

  const contentBottom = laidOut.reduce(
    (lowest, block) =>
      Math.max(lowest, block.position.y + (block.position.height || 0)),
    0
  );

  return { html, contentBottom };
}

/** Returns `null` when there's no usable layout, so the caller falls back to its canned template. */
export function buildQuickPrintLayoutTemplate(
  options: BuildLayoutOptions
): string | null {
  const {
    blockLayout,
    pageSize,
    tableStyle = 'classic',
    layoutMode = 'flow',
    design = 'modern',
    medicineRows = [],
    filledBlockIds = [],
    hiddenBlockIds = [],
    hiddenSections = [],
  } = options;

  if (!Array.isArray(blockLayout) || blockLayout.length === 0) return null;

  const hidden = new Set(hiddenBlockIds);
  const hiddenFields = new Set(hiddenSections);
  const shows: Shows = (sectionKey) => !hiddenFields.has(sectionKey);
  const visibleBlocks = applyDataDrivenBlocks(
    blockLayout,
    filledBlockIds
  ).filter(
    (block) => block?.visible && block?.position && !hidden.has(block.id)
  );
  if (visibleBlocks.length === 0) return null;

  const page = PAGE_SIZES[pageSize ?? 'a4'] ?? PAGE_SIZES.a4;

  let content: string;
  let documentHeight = page.height;

  if (layoutMode === 'exact') {
    const exact = renderExact(
      visibleBlocks,
      medicineRows,
      tableStyle,
      design,
      shows
    );
    content = `${exact.html}\n${poweredBy(`position:absolute;left:0;right:0;top:${exact.contentBottom + 4}mm`)}`;
    // Tall enough for reflowed content, so a long list continues onto a second sheet instead of clipping.
    documentHeight = Math.max(page.height, exact.contentBottom + 15);
  } else {
    content = renderFlow(visibleBlocks, tableStyle, design, shows);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
{{{i18n.head}}}
<style>
  @page { size: ${page.width}mm ${page.height}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, Arial, sans-serif;
    width: ${page.width}mm;
    min-height: ${documentHeight}mm;
    position: relative;
    /* Paper is white even where the viewer (a dark-themed preview frame) is not. */
    background: #fff;
    color: #111;
    line-height: 1.35;
    /* Clip at the paper edge — a wider document scales the whole preview down. */
    overflow-x: hidden;
  }
  .qp-block { position: absolute; }
  .qp-flow { padding-bottom: 12mm; }
  .qp-row { display: flex; align-items: flex-start; margin-bottom: ${FLOW_ROW_GAP_MM}mm; }
  .qp-row:not(:has(.qp-cell > *)) { display: none; }
  .qp-cell { flex: 0 0 auto; }
  .qp-table tr { break-inside: avoid; }
  ${getTableStyleCss(tableStyle).stripeRule}
  .qp-footer { text-align: center; font-size: 8px; color: #999; }
</style>
</head>
<body>
${content}
{{#if i18n.bilingual}}<div class="tr-note">{{bi "Translation for patient convenience. The English text prevails."}}</div>{{/if}}
</body>
</html>`;
}
