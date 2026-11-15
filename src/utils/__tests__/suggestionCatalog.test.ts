import { searchSuggestions } from '../suggestionCatalog';

describe('searchSuggestions', () => {
  it('finds another specialty’s chip and names where it comes from', () => {
    const [first] = searchSuggestions('allergy', 'metal', 'Dentist');
    expect(first.label).toBe('Metal allergy');
    expect(first.specialties).toEqual(
      expect.arrayContaining(['Dentist', 'Orthopedic Doctor'])
    );
  });

  it('returns only rows containing the text, best match first', () => {
    const rows = searchSuggestions('habit', 'smok');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.label.toLowerCase().includes('smok'))).toBe(
      true
    );
    expect(rows[0].label).toBe('Smoking');
  });

  it('keeps only the chosen specialty, and lists all of it A–Z without text', () => {
    const rows = searchSuggestions('diagnosis', '', 'Dentist');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.specialties.includes('Dentist'))).toBe(true);
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(searchSuggestions('diagnosis', '')).toEqual([]);
  });

  it('lists each label once and caps at 25', () => {
    const rows = searchSuggestions('diagnosis', 'it');
    const keys = rows.map((r) => r.label.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.length).toBeLessThanOrEqual(25);
  });
});
