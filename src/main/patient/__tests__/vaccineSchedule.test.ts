// Next-due vaccines from the IAP schedule: worked from date of birth and the doses already given.
import { dueVaccines } from '../utils/vaccineSchedule.utils';

describe('dueVaccines', () => {
  const today = '2026-10-27';

  it('lists the 6-week doses as overdue for a 10-week-old with only birth doses', () => {
    const due = dueVaccines(
      '2026-08-18',
      { BCG: 1, OPV: 1, 'Hep B': 1 },
      today
    );
    expect(due?.map((d) => `${d.vaccine}-${d.doseNo}`)).toEqual([
      'Hep B-2',
      'DTwP / DTaP-1',
      'Hib-1',
      'IPV-1',
      'PCV-1',
      'Rotavirus-1',
    ]);
    expect(due?.every((d) => d.overdue && d.dueOn === '2026-09-29')).toBe(true);
  });

  it('moves a vaccine to its next dose once one is given', () => {
    const due = dueVaccines('2026-08-18', { 'DTwP / DTaP': 1 }, today);
    expect(due?.find((d) => d.vaccine === 'DTwP / DTaP')).toEqual({
      vaccine: 'DTwP / DTaP',
      doseNo: 2,
      dueOn: '2026-10-27',
      overdue: false,
    });
  });

  it('reads DD-MM-YYYY, and returns null for adults or no date of birth', () => {
    expect(dueVaccines('18-08-2026', {}, today)).not.toBeNull();
    expect(dueVaccines('1990-01-01', {}, today)).toBeNull();
    expect(dueVaccines(null, {}, today)).toBeNull();
    expect(dueVaccines('not a date', {}, today)).toBeNull();
  });
});
