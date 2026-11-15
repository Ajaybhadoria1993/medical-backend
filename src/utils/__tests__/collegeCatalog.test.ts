import { canonicalCollege, searchColleges } from '../collegeCatalog';

describe('collegeCatalog', () => {
  it('ranks starts-with above contains and returns only matching names', () => {
    const results = searchColleges('andhra');
    expect(results[0].name).toBe('Andhra Medical College, Visakhapatnam');
    expect(
      results.every(
        (c) =>
          c.name.toLowerCase().includes('andhra') ||
          c.state.toLowerCase().includes('andhra')
      )
    ).toBe(true);
  });

  it('finds colleges by initials, alone or with a city', () => {
    expect(searchColleges('kgmu')[0].name).toBe(
      'King George Medical University, Lucknow'
    );
    expect(searchColleges('aiims delhi')[0].name).toBe(
      'All India Institute of Medical Sciences, New Delhi'
    );
  });

  it('caps results at 25', () => {
    expect(searchColleges('medical').length).toBe(25);
  });

  it('saves a listed college in official spelling and keeps custom names', () => {
    expect(canonicalCollege('  andhra medical college,   visakhapatnam ')).toBe(
      'Andhra Medical College, Visakhapatnam'
    );
    expect(canonicalCollege('Delhi Univercity')).toBe('Delhi Univercity');
  });
});
