import { mergeInstructionSuggestions } from '../utils/instructionSuggestions.utils';

describe('mergeInstructionSuggestions', () => {
  it("replaces only the forms sent, leaving the doctor's other forms untouched", () => {
    const merged = mergeInstructionSuggestions(
      { tablet: ['Take with milk'], drops: ['Instil at night'] },
      { tablet: ['Take with honey'] }
    );

    expect(merged).toEqual({
      tablet: ['Take with honey'],
      drops: ['Instil at night'],
    });
  });

  it('normalises form keys and drops blank or repeated phrases', () => {
    const merged = mergeInstructionSuggestions(null, {
      ' Tablet ': ['Take with milk', ' take with MILK ', '   '],
    });

    expect(merged).toEqual({ tablet: ['Take with milk'] });
  });

  it('keeps the order the doctor chose', () => {
    const merged = mergeInstructionSuggestions(
      { tablet: ['A', 'B'] },
      { tablet: ['B', 'A', 'C'] }
    );

    expect(merged.tablet).toEqual(['B', 'A', 'C']);
  });

  it('removes a form when its list is emptied', () => {
    expect(
      mergeInstructionSuggestions(
        { tablet: ['Take with milk'] },
        { tablet: [] }
      )
    ).toEqual({});
  });
});
