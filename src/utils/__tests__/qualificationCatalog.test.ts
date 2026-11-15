import {
  QUALIFICATION_CATALOG,
  canonicalDegree,
  doctorDegreeLine,
  qualificationCategorySchema,
  qualificationDegreeSchema,
} from '../qualificationCatalog';

describe('qualificationCatalog', () => {
  it('saves categories in catalog spelling and maps legacy labels', () => {
    expect(qualificationCategorySchema.parse('undergraduate (ug)')).toBe(
      'Undergraduate (UG)'
    );
    expect(
      qualificationCategorySchema.parse('Post-Graduation (PG) - Degree')
    ).toBe('Postgraduate (PG) Degree');
    expect(qualificationCategorySchema.safeParse('Masters').success).toBe(
      false
    );
  });

  it('canonicalises catalog and legacy degrees, keeps custom ones', () => {
    expect(canonicalDegree(' mbbs ')).toBe('MBBS');
    expect(canonicalDegree('MS ENT')).toBe('MS Otorhinolaryngology (ENT)');
    expect(canonicalDegree('MD  Aviation Medicine')).toBe(
      'MD Aviation Medicine'
    );
    expect(qualificationDegreeSchema.safeParse('  ').success).toBe(false);
  });

  it('has unique codes and degrees that fit the column', () => {
    const codes = QUALIFICATION_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of QUALIFICATION_CATALOG)
      for (const d of c.degrees) expect(d.length).toBeLessThanOrEqual(100);
  });
});

describe('doctorDegreeLine', () => {
  const row = (degree: string, category?: string, year = 2010) => ({
    qualificationTitle: category ?? null,
    qualificationType: degree,
    yearOfCompletion: year,
  });

  it('prints degrees lowest level first, whatever order they were saved in', () => {
    const rows = [
      row('MD Anaesthesiology', 'PG_DEGREE', 2015),
      row('BUMS', 'UG', 2010),
    ];
    expect(doctorDegreeLine(rows)).toBe('BUMS, MD Anaesthesiology');
  });

  it('keeps the highest ones when capped, still lowest first', () => {
    const rows = [
      row('BUMS'),
      row('MBBS'),
      row('MD Anaesthesiology'),
      row('DM Cardiology'),
    ];
    expect(doctorDegreeLine(rows, null, 3)).toBe(
      'MBBS, MD Anaesthesiology, DM Cardiology'
    );
  });

  it('leaves out pursuing degrees and duplicates', () => {
    const rows = [
      row('MBBS'),
      row('mbbs'),
      row('MD Anaesthesiology (Pursuing)'),
    ];
    expect(doctorDegreeLine(rows)).toBe('MBBS');
  });

  it('falls back to the legacy text when there are no rows', () => {
    expect(doctorDegreeLine([], 'MBBS, MD')).toBe('MBBS, MD');
  });
});
