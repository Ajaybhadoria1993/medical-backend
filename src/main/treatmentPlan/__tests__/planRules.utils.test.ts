import {
  planBasePaise,
  printableOptions,
  safetyIssues,
} from '../utils/planRules.utils';
import { matchTemplates } from '../utils/suggestions.utils';
import type { ActiveTemplate } from '../types/template.types';

const template = (
  name: string,
  keywords: string[],
  ownerDoctorId: string | null = null
): ActiveTemplate => ({
  id: name,
  name,
  specialty: 'Dentist',
  planType: 'staged',
  pricingMode: 'per_step',
  packagePrice: null,
  sessionCount: null,
  ownerDoctorId,
  sourceTemplateId: null,
  diagnosisKeywords: keywords,
  stepCount: 1,
  stepsFeeTotal: null,
});

describe('matchTemplates (P1)', () => {
  const list = [
    template('Root canal', ['pulpitis', 'irreversible pulpitis']),
    template('Extraction', ['tooth infection']),
    template('Whitening', ['stain']),
  ];

  it('finds the template and names the matched keyword, most specific first', () => {
    const m = matchTemplates('Irreversible   PULPITIS, tooth 36', list);
    expect(m[0].template.name).toBe('Root canal');
    expect(m[0].matchedKeyword).toBe('irreversible pulpitis');
  });

  it('matches whole words only', () => {
    expect(matchTemplates('stained enamel', list)).toHaveLength(0);
  });

  it('puts the doctor own version first on a tie', () => {
    const own = template('My root canal', ['pulpitis'], 'doc-1');
    const m = matchTemplates('pulpitis', [list[0], own]);
    expect(m[0].template.name).toBe('My root canal');
  });

  it('returns at most 4', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      template(`T${i}`, ['pain'])
    );
    expect(matchTemplates('pain', many)).toHaveLength(4);
  });
});

describe('planBasePaise', () => {
  it('adds step fees and option extras in paise', () => {
    expect(
      planBasePaise(
        'per_step',
        [
          { fee: '2000' },
          { fee: '1500.50', selectedOption: { extraFee: '499.50' } },
        ],
        null
      )
    ).toBe(400000);
  });

  it('uses the package price for a package', () => {
    expect(planBasePaise('package', [{ fee: '0' }], '15000')).toBe(1500000);
  });
});

describe('safetyIssues (2.4)', () => {
  const base = {
    basePaise: 1100000,
    discountPaise: 0,
    capPercent: 10,
    activePlanIds: [],
  };

  it('flags a gap below the template minimum (P7)', () => {
    const issues = safetyIssues({
      ...base,
      steps: [
        { name: 'Access', gapDays: 0 },
        { name: 'Cleaning', gapDays: 1 },
      ],
      minGapByName: new Map([['cleaning', 2]]),
    });
    expect(issues).toEqual([
      expect.objectContaining({ kind: 'gap', seq: 2, minGapDays: 2 }),
    ]);
  });

  it('flags package sessions closer than the interval, not the first one', () => {
    const issues = safetyIssues({
      ...base,
      steps: [
        { name: 'Session 1', gapDays: 0 },
        { name: 'Session 2', gapDays: 20 },
      ],
      packageInterval: 28,
    });
    expect(issues.map((i) => i.seq)).toEqual([2]);
  });

  it('flags a discount above the cap, not at it (P8)', () => {
    expect(
      safetyIssues({ ...base, steps: [], discountPaise: 110000 })
    ).toHaveLength(0);
    expect(
      safetyIssues({ ...base, steps: [], discountPaise: 110001 })[0].kind
    ).toBe('discount');
  });

  it('flags an open plan for the same treatment (P9)', () => {
    expect(
      safetyIssues({ ...base, steps: [], activePlanIds: ['p1'] })[0].kind
    ).toBe('duplicate');
  });
});

describe('printableOptions (treatment plan on the prescription)', () => {
  const plan = (id: string, group: string, status: string) => ({
    id,
    proposalGroupId: group,
    status,
  });

  it('prints every option while the proposal is open', () => {
    const plans = [plan('a', 'g1', 'proposed'), plan('b', 'g1', 'proposed')];
    expect(printableOptions(plans).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('prints only the accepted option once the group is decided', () => {
    const plans = [plan('a', 'g1', 'accepted'), plan('b', 'g1', 'proposed')];
    expect(printableOptions(plans).map((p) => p.id)).toEqual(['a']);
  });

  it('keeps separate proposals from the same visit independent', () => {
    const plans = [
      plan('a', 'g1', 'in_treatment'),
      plan('b', 'g1', 'proposed'),
      plan('c', 'g2', 'proposed'),
    ];
    expect(printableOptions(plans).map((p) => p.id)).toEqual(['a', 'c']);
  });
});
