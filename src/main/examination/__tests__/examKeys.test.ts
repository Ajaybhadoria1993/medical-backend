// Which chart / exam-table notes a prescription may save, and how exam rows print.
import {
  chartPrintSections,
  EXAM_KEYS,
  ExaminationService,
  noteProblem,
} from '..';
import { DOCTOR_SPECIALTY_CONFIG } from '../../../utils/specialties';
import type { ExamTable } from '../../../utils/specialties/examTables';

describe('exam table notes', () => {
  it('knows the ENT and Eye table keys', () => {
    expect(EXAM_KEYS.has('ear.right.canal')).toBe(true);
    expect(EXAM_KEYS.has('nt.tonsils')).toBe(true);
    expect(EXAM_KEYS.has('subj.le_d.sph')).toBe(true);
  });

  it('accepts real fields and older plain keys, rejects unknown table keys and bad numbers', () => {
    expect(noteProblem('ear.right.canal', 'Wax')).toBeNull();
    expect(noteProblem('Tooth-36', 'Caries')).toBeNull();
    expect(noteProblem('legacyKey', 'Old note')).toBeNull();
    expect(noteProblem('ear.right.colour', 'Red')).toMatch(/not a field/);
    expect(noteProblem('eye.re.iop', '90')).toMatch(/60 or less/);
    expect(noteProblem('hearing.left.f500', 'loud')).toMatch(/number/);
    expect(noteProblem('Tooth-11', 'x'.repeat(201))).toMatch(/under 200/);
  });

  it('checks eye vision notation and lens power in 0.25 steps', () => {
    for (const v of ['6/9', '6/9p', '3/60', 'N6', 'CF 1m', 'HM', 'NIPH'])
      expect(noteProblem('va.re.ucdva', v)).toBeNull();
    expect(noteProblem('va.re.ucdva', '20/20')).toMatch(/use 6\/9/);
    for (const v of ['-1.25', '−1.5', '+2', 'Plano'])
      expect(noteProblem('subj.re_u.sph', v)).toBeNull();
    expect(noteProblem('subj.re_u.sph', '-1.37')).toMatch(/0.25 steps/);
    expect(noteProblem('subj.re_u.add', '5')).toMatch(/between 0 and 4/);
  });

  it('prints dilated refraction only when undilated is empty', () => {
    const rows = (notes: Record<string, string>) =>
      chartPrintSections(notes)[0].table?.rows.map((r) => r.label);
    expect(rows({ 'subj.re_u.sph': '-1.25', 'subj.re_d.sph': '-1.5' })).toEqual(
      ['RE (undilated)']
    );
    expect(rows({ 'subj.re_d.sph': '-1.5' })).toEqual(['RE (dilated)']);
  });

  it('accepts only the ear-drum diagram picks', () => {
    expect(noteProblem('EarDrum-Right-AS', 'Retraction')).toBeNull();
    expect(
      noteProblem(
        'EarDrum-Left-PI',
        'Perforation · Central · Moderate (25–50%)'
      )
    ).toBeNull();
    expect(
      noteProblem('EarDrum-Left-PI', 'Perforation · Central · 25–50%')
    ).toMatch(/not a finding/);
    expect(noteProblem('EarDrum-Left-Attic', 'Perforation')).toBeNull();
    expect(noteProblem('EarDrum-Right-AS', 'Hole')).toMatch(/not a finding/);
    expect(noteProblem('EarDrum-Right-AS', 'Fluid · Central')).toMatch(
      /not a finding/
    );
  });

  it('prints table rows as a grid of the filled columns, singles as lines', () => {
    expect(
      chartPrintSections({
        'ear.left.drum': 'Perforated',
        'ear.right.drum': 'Intact',
        'ear.right.canal': 'Wax',
        'ear.weber': 'Centre',
      })
    ).toEqual([
      {
        heading: 'Ear Exam',
        table: {
          labelHeader: '',
          columns: ['Ear Canal', 'Ear Drum'],
          rows: [
            { label: 'Right Ear', cells: ['Wax', 'Intact'] },
            { label: 'Left Ear', cells: ['', 'Perforated'] },
          ],
        },
        rows: [{ label: 'Weber', value: 'Centre' }],
      },
    ]);
  });

  it('gives every exam table a unique id, since saved keys start with it', () => {
    // One table shared by two specialties (GP Chronic Care) is a single table, so it counts once.
    const tables = new Set(
      Object.values(DOCTOR_SPECIALTY_CONFIG).flatMap((c) =>
        'exam_tables' in c ? (c.exam_tables as readonly ExamTable[]) : []
      )
    );
    const ids = [...tables].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('knows the F2 batch 1 tables and their limits', () => {
    expect(noteProblem('limb.left.abi', '0.6')).toBeNull();
    expect(noteProblem('limb.left.abi', '2')).toMatch(/1.5 or less/);
    expect(noteProblem('chest.rr', '18')).toBeNull();
    expect(noteProblem('cardiac.lvef', '5')).toMatch(/10 or more/);
    expect(EXAM_KEYS.has('gproc.hpylori')).toBe(true);
    expect(EXAM_KEYS.has('geri.katz')).toBe(true);
  });

  it('checks F2 batch 2 dates and limits, and prints dates as DD/MM/YYYY', () => {
    expect(noteProblem('anc.lmp', '2026-05-10')).toBeNull();
    expect(noteProblem('anc.lmp', '2026-02-30')).toMatch(/real date/);
    expect(noteProblem('anc.lmp', '10/05/2026')).toMatch(/real date/);
    expect(noteProblem('kidney.creatinine', '25')).toMatch(/20 or less/);
    expect(noteProblem('rheum.esr', '0')).toMatch(/1 or more/);
    expect(chartPrintSections({ 'gyn.pap': '2025-11-03' })).toEqual([
      {
        heading: 'Gyn',
        rows: [{ label: 'Last Pap Smear', value: '03/11/2025' }],
      },
    ]);
  });

  it('checks F2 batch 3 multi picks and times, and prints a note beside its field', () => {
    expect(noteProblem('case.cravings', 'Sweets, Salt')).toBeNull();
    expect(noteProblem('case.cravings', 'Sweets, Chocolate')).toMatch(
      /Chocolate is not an option/
    );
    expect(noteProblem('er.arrival', '09:45')).toBeNull();
    expect(noteProblem('er.arrival', '25:00')).toMatch(/HH:MM/);
    expect(noteProblem('endo.t_score', '-2.5')).toBeNull();
    expect(noteProblem('endo.tsh', '150')).toMatch(/100 or less/);
    expect(noteProblem('chronic.hba1c', '20')).toMatch(/15 or less/);
    expect(
      chartPrintSections({
        'blood.spleen_size': '4',
        'blood.spleen': 'Enlarged',
      })
    ).toEqual([
      {
        heading: 'Blood',
        rows: [{ label: 'Spleen', value: 'Enlarged · Spleen Size (cm) 4' }],
      },
    ]);
  });

  it('keeps session notes private: only Homework prints, and non-clinical readers lose the rest', () => {
    const notes = {
      'session.risk': 'High',
      'session.homework': 'Thought diary daily',
      'mse.mood': 'Low',
      'private.x': 'secret',
    };
    expect(chartPrintSections(notes)).toEqual([
      {
        heading: 'Session',
        rows: [{ label: 'Homework', value: 'Thought diary daily' }],
      },
    ]);
    expect(ExaminationService.notesFor(notes, 'Receptionist')).toEqual({
      'session.homework': 'Thought diary daily',
    });
    expect(ExaminationService.notesFor(notes, 'Patient')).toEqual({
      'session.homework': 'Thought diary daily',
    });
    expect(ExaminationService.notesFor(notes, 'Doctor')).toEqual(notes);
  });

  it('prints the diet meal plan as plain values and checks calorie limits', () => {
    expect(noteProblem('diet.calories', '100')).toMatch(/500 or more/);
    expect(
      chartPrintSections({
        'meals.breakfast.food': 'Vegetable poha',
        'meals.breakfast.quantity': '1 bowl',
      })
    ).toEqual([
      {
        heading: 'Meal Plan',
        table: {
          labelHeader: '',
          columns: ['What To Eat', 'Quantity'],
          rows: [{ label: 'Breakfast', cells: ['Vegetable poha', '1 bowl'] }],
        },
        rows: [],
      },
    ]);
  });

  it('prints a tooth status on the same line as its note, status first', () => {
    expect(
      chartPrintSections({
        'Tooth-36': 'Deep caries',
        'ToothStatus-36': 'Decayed',
        'ToothStatus-11': 'Missing',
      })
    ).toEqual([
      {
        heading: 'Dental Chart',
        rows: [
          { label: 'Tooth 11', value: 'Missing' },
          { label: 'Tooth 36', value: 'Decayed · Deep caries' },
        ],
      },
    ]);
  });

  it('knows addable row slots up to their max and names each printed row by its first field', () => {
    expect(noteProblem('joint.10.pain', '3')).toBeNull();
    expect(noteProblem('joint.11.pain', '3')).toMatch(/not a field/);
    expect(noteProblem('exercise.1.exercise', 'My own stretch')).toBeNull();
    expect(
      chartPrintSections({
        'joint.2.joint': 'Hip',
        'joint.1.side': 'Right',
        'joint.1.joint': 'Knee',
      })
    ).toEqual([
      {
        heading: 'Joints',
        table: {
          labelHeader: 'Joint',
          columns: ['Side'],
          rows: [
            { label: 'Knee', cells: ['Right'] },
            { label: 'Hip', cells: [''] },
          ],
        },
        rows: [],
      },
    ]);
  });

  it('marks the vaccine picks that write dose rows, and checks their names', () => {
    expect(EXAM_KEYS.get('child.vaccines')?.cell.recordsVaccines).toBe(true);
    expect(EXAM_KEYS.get('chronic.vaccines')?.cell.recordsVaccines).toBe(true);
    expect(EXAM_KEYS.get('anc.vaccines')?.cell.recordsVaccines).toBe(true);
    expect(noteProblem('child.vaccines', 'BCG, OPV')).toBeNull();
    expect(noteProblem('child.vaccines', 'BCG, Polio')).toMatch(
      /Polio is not an option/
    );
  });
});
