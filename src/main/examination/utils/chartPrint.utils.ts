import type { SpecialtySection } from '../../../utils/doctorSpecialtyConfig';
import type { ExamTable } from '../../../utils/specialties/examTables';
import { EAR_DRUM, EAR_DRUM_PARTS, EXAM_KEYS } from './examKeys.utils';

/** An exam table's rows as a printed grid; `labelHeader` heads the row-name column. */
export interface ChartPrintTable {
  labelHeader: string;
  columns: string[];
  rows: { label: string; cells: string[] }[];
}

export interface ChartPrintSection {
  heading: string;
  rows: { label: string; value: string }[];
  table?: ChartPrintTable;
}

const REPRODUCTIVE_LABELS: Record<string, string> = {
  'FallopianTube-Right': 'Right fallopian tube',
  'FallopianTube-Left': 'Left fallopian tube',
  'Ovary-Right': 'Right ovary',
  'Ovary-Left': 'Left ovary',
  Endometrium: 'Endometrium',
  Uterus: 'Uterus',
  Cervix: 'Cervix',
};

// `ToothStatus-36` (Decayed, Filled…) prints on the same line as the `Tooth-36` note, status first.
const TOOTH = /^Tooth(Status)?-(\d{2})$/;

/** Which chart a saved note key belongs to, and its printed label; null for keys no chart owns. */
function chartOf(
  key: string
): { chart: SpecialtySection; label: string; order: number } | null {
  const tooth = key.match(TOOTH);
  if (tooth) {
    return {
      chart: 'Dental Chart',
      label: `Tooth ${tooth[2]}`,
      order: Number(tooth[2]),
    };
  }
  if (key in REPRODUCTIVE_LABELS) {
    return {
      chart: 'Reproductive Chart',
      label: title(REPRODUCTIVE_LABELS[key]),
      order: Object.keys(REPRODUCTIVE_LABELS).indexOf(key),
    };
  }
  return null;
}

// Title Case ("Ear canal" → "Ear Canal"), leaving units in brackets and "H. pylori" alone.
const title = (label: string) =>
  label.replace(
    /\([^)]*\)|[A-Z]\.\s|(^|\s)([a-z])/g,
    (match: string, gap?: string, c?: string) =>
      c ? `${gap}${c.toUpperCase()}` : match
  );

// Dates are saved as YYYY-MM-DD and print as DD/MM/YYYY.
const shown = (type: string, value: string) =>
  type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split('-').reverse().join('/')
    : value;

/** The visit's chart notes as headed, labelled rows for print; `private.` keys and empty values never print. */
export function chartPrintSections(notes: unknown): ChartPrintSection[] {
  if (!notes || typeof notes !== 'object') return [];
  const groups = new Map<
    string,
    { label: string; value: string; order: number }[]
  >();
  // Row cells of an exam table (right / left ear, a meal, a joint) print as one grid per table.
  const grids = new Map<
    string,
    {
      table: ExamTable;
      rows: Map<
        string,
        { label: string; order: number; cells: Map<string, string> }
      >;
    }
  >();
  // Single fields print as lines; a field's note joins its line: "Spleen: Enlarged · Spleen size (cm) 4".
  const examRows = new Map<
    string,
    {
      heading: string;
      label: string;
      parts: { text: string; order: number }[];
      order: number;
    }
  >();
  // Ear drum: side → finding → parts, since one perforation often covers several quadrants.
  const drumFindings = new Map<string, Map<string, string[]>>();
  for (const [key, raw] of Object.entries(notes as Record<string, unknown>)) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || key.startsWith('private.')) continue;
    const drum = key.match(EAR_DRUM);
    if (drum) {
      const side = drumFindings.get(drum[1]) ?? new Map<string, string[]>();
      side.set(value, [...(side.get(value) ?? []), drum[2]]);
      drumFindings.set(drum[1], side);
      continue;
    }
    const exam = EXAM_KEYS.get(key);
    if (exam?.cell.noPrint) continue;
    if (exam && exam.rowLabel !== null) {
      const grid = grids.get(exam.table.id) ?? {
        table: exam.table,
        rows: new Map(),
      };
      const row = grid.rows.get(exam.rowLabel) ?? {
        label: title(exam.rowLabel),
        order: exam.order,
        cells: new Map<string, string>(),
      };
      // Addable rows are named by their first field: the Knee row, the Hip row.
      if (exam.table.addable && exam.cell.key === exam.table.columns[0]?.key)
        row.label = value;
      else row.cells.set(exam.cell.key, shown(exam.cell.type, value));
      row.order = Math.min(row.order, exam.order);
      grid.rows.set(exam.rowLabel, row);
      grids.set(exam.table.id, grid);
      continue;
    }
    if (exam) {
      const noteOwner = exam.cell.noteFor
        ? EXAM_KEYS.get(`${exam.table.id}.${exam.cell.noteFor}`)
        : undefined;
      const rowId = `${exam.table.id}|${exam.cell.noteFor ?? exam.cell.key}`;
      const row = examRows.get(rowId) ?? {
        heading: exam.table.title,
        label: title(noteOwner?.cell.label ?? exam.cell.label),
        parts: [],
        order: exam.order,
      };
      row.parts.push({
        text: noteOwner
          ? `${title(exam.cell.label)} ${shown(exam.cell.type, value)}`
          : shown(exam.cell.type, value),
        order: exam.order,
      });
      row.order = Math.min(row.order, exam.order);
      examRows.set(rowId, row);
      continue;
    }
    const owner = chartOf(key) ?? {
      chart: 'Other details',
      label: key,
      order: Number.MAX_SAFE_INTEGER,
    };
    const rows = groups.get(owner.chart) ?? [];
    const same = rows.find((r) => r.label === owner.label);
    if (same) {
      same.value = key.startsWith('ToothStatus-')
        ? `${value} · ${same.value}`
        : `${same.value} · ${value}`;
    } else {
      rows.push({ label: owner.label, value, order: owner.order });
    }
    groups.set(owner.chart, rows);
  }
  for (const row of examRows.values()) {
    const rows = groups.get(row.heading) ?? [];
    const cells = row.parts
      .sort((a, b) => a.order - b.order)
      .map((p) => p.text);
    rows.push({ label: row.label, value: cells.join(' · '), order: row.order });
    groups.set(row.heading, rows);
  }
  const tables = new Map<string, ChartPrintTable>();
  // One line per finding, as doctors write it: "Right Ear: Perforation · Central — Antero-inferior, Postero-inferior".
  const partOrder = Object.keys(EAR_DRUM_PARTS);
  const drumRows = ['Right', 'Left'].flatMap((side, s) =>
    [...(drumFindings.get(side) ?? [])].map(([text, parts]) => {
      const sorted = parts.sort(
        (a, b) => partOrder.indexOf(a) - partOrder.indexOf(b)
      );
      return {
        label: `${side} Ear`,
        value: `${text} — ${sorted.map((p) => EAR_DRUM_PARTS[p]).join(', ')}`,
        order: s * 100 + partOrder.indexOf(sorted[0]),
      };
    })
  );
  if (drumRows.length) groups.set('Ear Drum', drumRows);
  for (const { table, rows } of grids.values()) {
    // Fallback rows (dilated refraction) print only when no other row is filled.
    const fallback = new Set(
      table.rows
        .filter((r) => table.fallbackRows?.includes(r.key))
        .map((r) => r.label)
    );
    const hasMain = [...rows.keys()].some((label) => !fallback.has(label));
    const ordered = [...rows.entries()]
      .filter(([label]) => !hasMain || !fallback.has(label))
      .map(([, row]) => row)
      .sort((a, b) => a.order - b.order);
    // Only columns with a value in some row print, so a half-filled table stays narrow.
    const columns = table.columns.filter(
      (c, i) =>
        !(table.addable && i === 0) && ordered.some((r) => r.cells.has(c.key))
    );
    tables.set(table.title, {
      labelHeader: table.addable ? title(table.columns[0]?.label ?? '') : '',
      columns: columns.map((c) => title(c.label)),
      rows: ordered.map((r) => ({
        label: r.label,
        cells: columns.map((c) => r.cells.get(c.key) ?? ''),
      })),
    });
    if (!groups.has(table.title)) groups.set(table.title, []);
  }
  return [...groups.entries()].map(([heading, rows]) => ({
    heading,
    ...(tables.has(heading) ? { table: tables.get(heading) } : {}),
    rows: rows
      .sort((a, b) => a.order - b.order)
      .map(({ label, value }) => ({ label, value })),
  }));
}

/** Everything the shared print block shows: the visit's history (always), then chart notes when switched on. */
export function visitPrintSections(
  notes: unknown,
  history: unknown,
  showCharts: unknown
): ChartPrintSection[] {
  const items = Array.isArray(history)
    ? history.map((h) => String(h ?? '').trim()).filter(Boolean)
    : [];
  const historySection: ChartPrintSection[] = items.length
    ? [
        {
          heading: 'History',
          rows: items.map((value) => ({ label: '', value })),
        },
      ]
    : [];
  return [...historySection, ...(showCharts ? chartPrintSections(notes) : [])];
}
