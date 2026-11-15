// Seed data passes the same rules a Super Admin's form does, so a bad row never reaches the database.
import { SPECIALTY_CATALOG } from '../../../utils/specialtyCatalog';
import { specialtyConfigCreateSchema } from '../schemas/specialtyConfig.schema';
import { libraryTemplateSchema } from '../schemas/template.schema';
import seedTemplates from '../seeds/libraryTemplates.json';
import specialtyConfigs from '../seeds/specialtyConfigs.json';

// JSON infers one type per row, so optional step fields need a declared shape to be read.
type SeedTemplate = {
  code: string;
  specialty: string;
  planType: string;
  consentRequired?: boolean;
  taxable?: boolean;
  sessionCount?: number;
  intervalDays?: number;
  packageExpiryDays?: number;
  steps?: {
    name: string;
    gapDays: number;
    maxGapDays?: number;
    durationMinutes?: number;
  }[];
};
const templates: SeedTemplate[] = seedTemplates;

describe('treatment-plan seed data', () => {
  it('every ready-made template is valid and has a unique code', () => {
    for (const t of templates) {
      expect(libraryTemplateSchema.safeParse(t).error?.issues).toBeUndefined();
    }
    const codes = templates.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has the five ENT plans, the four surgeries needing consent', () => {
    const ent = templates.filter((t) => t.code.startsWith('ent.'));
    expect(ent.map((t) => t.code)).toEqual([
      'ent.tonsillectomy',
      'ent.septoplasty',
      'ent.fess',
      'ent.tympanoplasty',
      'ent.ear_wax',
    ]);
    expect(ent.filter((t) => t.consentRequired)).toHaveLength(4);
  });

  it('has the seven eye plans, cataract and glaucoma review included', () => {
    expect(
      templates.filter((t) => t.code.startsWith('eye.')).map((t) => t.code)
    ).toEqual([
      'eye.cataract',
      'eye.lasik',
      'eye.anti_vegf',
      'eye.pterygium',
      'eye.squint',
      'eye.retinal_laser',
      'eye.glaucoma_review',
    ]);
  });

  it('has the five general surgery plans, all needing consent', () => {
    const surgery = templates.filter((t) => t.code.startsWith('surgery.'));
    expect(surgery.map((t) => t.code)).toEqual([
      'surgery.hernia_repair',
      'surgery.lap_cholecystectomy',
      'surgery.abscess_id',
      'surgery.hemorrhoidectomy',
      'surgery.lump_excision',
    ]);
    expect(surgery.every((t) => t.consentRequired)).toBe(true);
  });

  it('has the five ortho plans; the injection series is 3 sessions in 120 days', () => {
    const ortho = templates.filter((t) => t.code.startsWith('ortho.'));
    expect(ortho.map((t) => t.code)).toEqual([
      'ortho.fracture_cast',
      'ortho.fracture_fixation',
      'ortho.knee_replacement',
      'ortho.acl_arthroscopy',
      'ortho.knee_injection_series',
    ]);
    const series = ortho.find((t) => t.planType === 'package');
    expect([
      series?.sessionCount,
      series?.intervalDays,
      series?.packageExpiryDays,
    ]).toEqual([3, 21, 120]);
  });

  it('has the four plastic plans, cosmetic ones marked taxable', () => {
    const plastic = templates.filter((t) => t.code.startsWith('plastic.'));
    expect(plastic.filter((t) => t.taxable).map((t) => t.code)).toEqual([
      'plastic.rhinoplasty',
      'plastic.liposuction',
      'plastic.blepharoplasty',
    ]);
    expect(plastic.map((t) => t.code)).toContain('plastic.keloid_injections');
  });

  it('has the five urology plans; the DJ stent comes out within 35 days', () => {
    const uro = templates.filter((t) => t.code.startsWith('uro.'));
    expect(uro.map((t) => t.code)).toEqual([
      'uro.eswl',
      'uro.urs_stent',
      'uro.turp',
      'uro.circumcision',
      'uro.vasectomy',
    ]);
    const stentOut = uro
      .find((t) => t.code === 'uro.urs_stent')
      ?.steps?.find((s) => s.name === 'DJ stent removal');
    expect(stentOut?.maxGapDays).toBe(35);
  });

  it('has the five vascular plans; ulcer care is 8 weekly sessions', () => {
    const vascular = templates.filter((t) => t.code.startsWith('vascular.'));
    expect(vascular).toHaveLength(5);
    const ulcer = vascular.find((t) => t.code === 'vascular.venous_ulcer');
    expect([ulcer?.sessionCount, ulcer?.intervalDays]).toEqual([8, 7]);
  });

  it('has nine derm plans; hair transplant has its 6-hour surgery and two late reviews', () => {
    const derm = templates.filter((t) => t.specialty === 'Dermatologist');
    expect(derm).toHaveLength(9);
    const hair = derm.find((t) => t.code === 'hair.transplant');
    expect(hair?.steps?.[0].durationMinutes).toBe(360);
    expect(hair?.steps?.map((s) => s.gapDays)).toEqual([0, 1, 10, 90, 180]);
  });

  it('has six physio packages, every one fitting its sessions before expiry', () => {
    const physio = templates.filter((t) => t.specialty === 'Physiotherapist');
    expect(physio).toHaveLength(6);
    for (const t of physio) {
      const lastSession = ((t.sessionCount ?? 1) - 1) * (t.intervalDays ?? 0);
      expect(lastSession).toBeLessThanOrEqual(t.packageExpiryDays ?? 0);
    }
  });

  it('gives every catalog main specialty at least one template and a field set', () => {
    const missing = SPECIALTY_CATALOG.map((g) => g.mainSpecialty).filter(
      (main) =>
        !templates.some((t) => t.specialty === main) ||
        !specialtyConfigs.some((c) => c.specialty === main)
    );
    expect(missing).toEqual([]);
  });

  it('every specialty field set is valid', () => {
    for (const c of specialtyConfigs) {
      expect(
        specialtyConfigCreateSchema.safeParse(c).error?.issues
      ).toBeUndefined();
    }
  });
});
