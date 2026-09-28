import {
  buildQuickPrintLayoutTemplate,
  layoutSectionKeys,
  type BuildLayoutOptions,
} from '../templates/layoutRenderer';

const build = (options: BuildLayoutOptions) =>
  buildQuickPrintLayoutTemplate(options)!;

/** Every absolutely positioned block's `top:Nmm`, in document order (not paddings inside the markup). */
const tops = (html: string) =>
  [
    ...html.matchAll(/class="qp-block" style="left:[\d.]+mm;top:([\d.]+)mm/g),
  ].map((m) => Number(m[1]));

/** How many flow rows were emitted. */
const rowCount = (html: string) => (html.match(/class="qp-row"/g) ?? []).length;

const block = (
  id: string,
  y: number,
  height: number,
  visible = true,
  x = 12,
  width = 186
) => ({ id, visible, position: { x, y, width, height } });

/** The shipped defaults, so the tests track what doctors actually get. */
const defaults = () => [
  block('clinicHeader', 12, 16, false),
  block('patientInfo', 38, 12, true, 12, 132),
  block('visitDate', 38, 12, true, 150, 48),
  block('chiefComplaints', 52, 10, false),
  block('vitals', 64, 10, false),
  block('allergies', 76, 10, false),
  block('preDiagnosis', 88, 10, false),
  block('diagnosis', 100, 10),
  block('rxSymbol', 112, 8, true, 12, 15),
  block('medicineTable', 122, 90),
  block('tests', 216, 12, false),
  block('clinicalNotes', 230, 12, false),
  block('advice', 244, 12, false),
  block('followUp', 257, 10, true, 12, 110),
  block('doctorSignature', 257, 20, true, 130, 68),
];

describe('buildQuickPrintLayoutTemplate', () => {
  describe('flow mode', () => {
    it('is the default, including for layouts saved before the setting existed', () => {
      const html = build({ blockLayout: defaults() });

      expect(html).toContain('class="qp-flow"');
      expect(tops(html)).toHaveLength(0);
    });

    it('prints the signature after clinical sections saved below it', () => {
      const html = build({
        blockLayout: [
          block('diagnosis', 100, 10),
          block('doctorSignature', 150, 20, true, 130, 68),
          block('advice', 200, 12),
        ],
      });

      expect(html.indexOf('Advice')).toBeLessThan(html.indexOf('doctor.name'));
    });

    it('starts where the first block was placed', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('diagnosis', 100, 10),
        ],
      });

      expect(html).toContain('padding-top:38mm');
    });

    it('stacks rows in order without keeping the space of hidden blocks', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('vitals', 64, 10, false),
          block('diagnosis', 100, 10),
        ],
      });

      expect(rowCount(html)).toBe(2);
      expect(html.indexOf('patient.name')).toBeLessThan(
        html.indexOf('Diagnosis:')
      );
    });

    it('keeps side-by-side blocks on one row with their horizontal gap', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12, true, 12, 132),
          block('visitDate', 39, 12, true, 150, 48),
        ],
      });

      expect(rowCount(html)).toBe(1);
      expect(html).toContain('margin-left:6mm;width:48mm');
    });

    it('stacks a horizontally overlapping block instead of pushing it sideways', () => {
      const html = build({
        blockLayout: [
          block('rxSymbol', 112, 8, true, 12, 15),
          block('medicineTable', 114, 90, true, 13, 186),
        ],
      });

      expect(rowCount(html)).toBe(2);
      expect(html).toContain('margin-left:13mm;width:186mm');
    });

    it('drops a row whose blocks have no data for the visit', () => {
      const html = build({ blockLayout: defaults() });

      expect(html).toContain(
        '.qp-row:not(:has(.qp-cell > *)) { display: none; }'
      );
    });

    it('prints the powered-by line right after the content', () => {
      const html = build({ blockLayout: defaults() });

      expect(html.indexOf('Powered by')).toBeGreaterThan(
        html.lastIndexOf('class="qp-row"')
      );
      expect(html).not.toContain('bottom: 4mm');
    });
  });

  describe('exact mode', () => {
    it('prints every block at its saved coordinates', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('vitals', 64, 10, false),
          block('diagnosis', 100, 10),
        ],
        layoutMode: 'exact',
      });

      expect(tops(html).sort((a, b) => a - b)).toEqual([38, 100]);
    });

    it('pushes footer blocks down when the table outgrows its box', () => {
      const layout = [
        block('medicineTable', 122, 90),
        block('followUp', 257, 10),
      ];
      const many = Array.from({ length: 25 }, () => ({ hasComposition: true }));

      const short = build({ blockLayout: layout, layoutMode: 'exact' });
      const long = build({
        blockLayout: layout,
        layoutMode: 'exact',
        medicineRows: many,
      });

      expect(Math.max(...tops(long))).toBeGreaterThan(Math.max(...tops(short)));
    });

    it('grows the page so a long medicine list is not clipped', () => {
      const many = Array.from({ length: 40 }, () => ({ hasComposition: true }));

      const html = build({
        blockLayout: [
          block('medicineTable', 122, 90),
          block('doctorSignature', 257, 20),
        ],
        layoutMode: 'exact',
        medicineRows: many,
      });

      const minHeight = Number(/min-height: ([\d.]+)mm/.exec(html)![1]);
      expect(minHeight).toBeGreaterThan(297);
    });

    it('places the powered-by line just below the lowest block', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('diagnosis', 100, 10),
        ],
        layoutMode: 'exact',
      });

      expect(html).toContain(
        'class="qp-footer" style="position:absolute;left:0;right:0;top:114mm"'
      );
    });
  });

  describe('data-driven blocks', () => {
    it('prints a disabled block the doctor filled in', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('allergies', 76, 10, false),
        ],
        filledBlockIds: ['allergies'],
      });

      expect(html).toContain('Allergies:');
      expect(rowCount(html)).toBe(2);
    });

    it('leaves disabled blocks with no data hidden', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('allergies', 76, 10, false),
        ],
        filledBlockIds: [],
      });

      expect(html).not.toContain('Allergies');
      expect(rowCount(html)).toBe(1);
    });

    it('auto-shows several filled blocks at once', () => {
      const html = build({
        blockLayout: defaults(),
        filledBlockIds: ['vitals', 'allergies', 'advice', 'tests'],
      });

      expect(html).toContain('Vitals:');
      expect(html).toContain('Allergies:');
      expect(html).toContain('Advice:');
      expect(html).toContain('Tests / Investigations:');
    });
  });

  describe('medicine table', () => {
    it('gives the dose schedule, food timing and instruction their own columns', () => {
      const html = build({ blockLayout: [block('medicineTable', 122, 90)] });

      for (const heading of ['Dosage', 'Timing', 'Duration', 'Instructions']) {
        expect(html).toContain(`>${heading}</th>`);
      }
      expect(html).toContain('{{bi this.frequency}}');
      expect(html).toContain('{{bi this.notes}}');
      expect(html).toContain('{{bi this.dosage}}');
    });
  });

  describe('design', () => {
    it('defaults to the modern look', () => {
      const html = build({ blockLayout: [block('medicineTable', 122, 90)] });

      expect(html).not.toContain('Timing - Freq. - Duration');
    });

    it('restores the original look when the doctor chooses it', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('medicineTable', 52, 90),
        ],
        design: 'original',
      });

      expect(html).toContain('Timing - Freq. - Duration');
      expect(html).toContain('{{#if patient.uhid}}{{patient.uhid}} : {{/if}}');
    });
  });

  describe('guards', () => {
    it('returns null with no layout, so the caller keeps its canned template', () => {
      expect(buildQuickPrintLayoutTemplate({ blockLayout: [] })).toBeNull();
      expect(
        buildQuickPrintLayoutTemplate({ blockLayout: undefined as never })
      ).toBeNull();
    });

    it('returns null when every block is hidden', () => {
      expect(
        buildQuickPrintLayoutTemplate({
          blockLayout: [block('patientInfo', 38, 12, false)],
        })
      ).toBeNull();
    });

    it('honours the selected paper size', () => {
      const html = build({
        blockLayout: [block('patientInfo', 10, 12)],
        pageSize: 'a5',
      });

      expect(html).toContain('size: 148mm 210mm');
    });
  });

  describe('hidden blocks', () => {
    it('never prints a block this prescription switched off, even when filled in', () => {
      const html = build({
        blockLayout: [
          block('patientInfo', 38, 12),
          block('diagnosis', 100, 10),
          block('allergies', 76, 10, false),
        ],
        filledBlockIds: ['allergies'],
        hiddenBlockIds: ['diagnosis', 'allergies'],
      });

      expect(html).not.toContain('Diagnosis:');
      expect(html).not.toContain('Allergies:');
      expect(rowCount(html)).toBe(1);
    });
  });

  describe('hidden sections', () => {
    it('drops switched-off fields from blocks that still print, in both designs', () => {
      for (const design of ['modern', 'original'] as const) {
        const html = build({
          blockLayout: [
            block('patientInfo', 38, 12),
            block('medicineTable', 52, 90),
            block('doctorSignature', 150, 20),
          ],
          design,
          hiddenSections: [
            'showPatientAge',
            'showMedicineComposition',
            'showDoctorRegistration',
          ],
        });

        expect(html).toContain('patient.name');
        expect(html).toContain('patient.gender');
        expect(html).not.toContain('patient.age');
        expect(html).not.toContain('this.composition');
        expect(html).not.toContain('doctor.registrationNumber');
      }
    });
  });

  describe('section keys', () => {
    it('names the switches a layout can act on, hidden blocks included', () => {
      expect(
        layoutSectionKeys([
          block('patientInfo', 38, 12),
          block('doctorSignature', 150, 20, false),
        ])
      ).toEqual([
        'showPatientAge',
        'showPatientGender',
        'showDoctorQualification',
        'showDoctorRegistration',
        'showDoctorSignature',
      ]);
      expect(layoutSectionKeys(undefined)).toEqual([]);
    });
  });

  describe('habits', () => {
    it('prints habits in both designs', () => {
      for (const design of ['modern', 'original'] as const) {
        const html = build({ blockLayout: [block('habits', 10, 6)], design });

        expect(html).toContain('Habits:');
      }
    });
  });
});
