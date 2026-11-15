// How chart notes from `additionalInformation` are grouped and labelled for print.
import { chartPrintSections, visitPrintSections } from '..';

describe('chartPrintSections', () => {
  it('groups notes under their chart with readable labels, teeth in number order', () => {
    expect(
      chartPrintSections({
        'Tooth-36': 'Caries',
        'Tooth-11': 'Crown',
        'Ovary-Left': 'Cyst noted',
      })
    ).toEqual([
      {
        heading: 'Dental Chart',
        rows: [
          { label: 'Tooth 11', value: 'Crown' },
          { label: 'Tooth 36', value: 'Caries' },
        ],
      },
      {
        heading: 'Reproductive Chart',
        rows: [{ label: 'Left Ovary', value: 'Cyst noted' }],
      },
    ]);
  });

  it('never prints private or empty notes, and keeps unknown keys under Other details', () => {
    expect(
      chartPrintSections({
        'private.risk': 'High',
        'Tooth-21': '  ',
        legacyKey: 'Old note',
      })
    ).toEqual([
      {
        heading: 'Other details',
        rows: [{ label: 'legacyKey', value: 'Old note' }],
      },
    ]);
  });

  it('prints one ear-drum line per finding with the parts it covers, right ear first', () => {
    const perforation = 'Perforation · Central · Moderate (25–50%)';
    expect(
      chartPrintSections({
        'EarDrum-Left-PI': perforation,
        'EarDrum-Left-AI': perforation,
        'EarDrum-Right-Attic': 'Retraction',
      })
    ).toEqual([
      {
        heading: 'Ear Drum',
        rows: [
          { label: 'Right Ear', value: 'Retraction — Attic' },
          {
            label: 'Left Ear',
            value: `${perforation} — Antero-inferior, Postero-inferior`,
          },
        ],
      },
    ]);
  });

  it('prints nothing for a missing or non-object value', () => {
    expect(chartPrintSections(null)).toEqual([]);
    expect(chartPrintSections('text')).toEqual([]);
  });
});

describe('visitPrintSections', () => {
  it('prints history first, always, and chart notes only when switched on', () => {
    const notes = { 'Tooth-36': 'Caries' };
    const history = ['Diabetes', ' ', 'Pregnant (EDD 14 Mar 2027)'];
    expect(visitPrintSections(notes, history, false)).toEqual([
      {
        heading: 'History',
        rows: [
          { label: '', value: 'Diabetes' },
          { label: '', value: 'Pregnant (EDD 14 Mar 2027)' },
        ],
      },
    ]);
    expect(visitPrintSections(notes, [], true).map((s) => s.heading)).toEqual([
      'Dental Chart',
    ]);
  });
});
