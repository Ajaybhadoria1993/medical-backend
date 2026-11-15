import {
  addDays,
  daysBetween,
  packageGaps,
  earliestDates,
  sampleDates,
  type StepTiming,
} from '../utils/timing.utils';

describe('timing utils', () => {
  it('root canal gaps 0, 2, 3, 3, 7 from 12 Oct give 12, 14, 17, 20, 27 Oct (T12)', () => {
    expect(sampleDates('2026-10-12', [0, 2, 3, 3, 7])).toEqual([
      '2026-10-12',
      '2026-10-14',
      '2026-10-17',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('crosses month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts whole days between two IST days', () => {
    expect(daysBetween('2026-10-12', '2026-10-27')).toBe(15);
  });

  it('spaces package sessions by the interval, first on the start day', () => {
    expect(packageGaps(3, 28)).toEqual([0, 28, 28]);
    expect(sampleDates('2026-10-12', packageGaps(3, 28))).toEqual([
      '2026-10-12',
      '2026-11-09',
      '2026-12-07',
    ]);
  });
});

describe('earliestDates (DEV_PLAN §5)', () => {
  const step = (
    gapDays: number,
    extra: Partial<StepTiming> = {}
  ): StepTiming => ({
    gapDays,
    status: 'pending',
    doneOn: null,
    bookedOn: null,
    ...extra,
  });

  it('only the first step is bookable before anything is booked', () => {
    expect(earliestDates('2026-10-12', [step(0), step(2), step(3)])).toEqual([
      '2026-10-12',
      null,
      null,
    ]);
  });

  it('step 1 ignores a saved gap and is bookable from the start day', () => {
    expect(earliestDates('2026-10-22', [step(2), step(2)])).toEqual([
      '2026-10-22',
      null,
    ]);
  });

  it('each next step counts its gap from the booked day of the one before', () => {
    expect(
      earliestDates('2026-10-12', [
        step(0, { bookedOn: '2026-10-13' }),
        step(2, { bookedOn: '2026-10-16' }),
        step(3),
      ])
    ).toEqual(['2026-10-12', '2026-10-15', '2026-10-19']);
  });

  it('a done day wins over the booked day', () => {
    expect(
      earliestDates('2026-10-12', [
        step(0, {
          status: 'done',
          doneOn: '2026-10-14',
          bookedOn: '2026-10-13',
        }),
        step(2),
      ])
    ).toEqual(['2026-10-12', '2026-10-16']);
  });

  it('a missed, unbooked step blocks the rest until it is rebooked', () => {
    expect(
      earliestDates('2026-10-12', [
        step(0, { status: 'done', doneOn: '2026-10-12' }),
        step(2, { status: 'missed' }),
        step(3),
      ])
    ).toEqual(['2026-10-12', '2026-10-14', null]);
  });

  it('a skipped step never blocks the next one', () => {
    expect(
      earliestDates('2026-10-12', [
        step(0, { status: 'done', doneOn: '2026-10-12' }),
        step(2, { status: 'skipped' }),
        step(3),
      ])
    ).toEqual(['2026-10-12', '2026-10-14', '2026-10-17']);
  });
});
