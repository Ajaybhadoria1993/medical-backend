import {
  fillDuesBrackets,
  fillFollowUpGroups,
  orderBusiestDays,
  rankDoctors,
  topBusiestHours,
} from '../utils/clinicInsights.utils';

describe('rankDoctors', () => {
  it('ranks by appointments, keeps idle doctors and computes completion', () => {
    const out = rankDoctors([
      {
        doctorId: 'a',
        doctor: 'Dr A',
        appointments: '4',
        completed: '3',
        revenue: '1500.50',
      },
      {
        doctorId: 'b',
        doctor: 'Dr B',
        appointments: 0,
        completed: 0,
        revenue: '0',
      },
      {
        doctorId: 'c',
        doctor: 'Dr C',
        appointments: 9,
        completed: 3,
        revenue: 900,
      },
    ]);

    expect(out.map((d) => d.doctorId)).toEqual(['c', 'a', 'b']);
    expect(out[0].completionRate).toBe(33.3);
    expect(out[1]).toMatchObject({ completionRate: 75, revenue: 1501 });
    // An idle doctor is a signal, not a divide-by-zero.
    expect(out[2]).toMatchObject({ appointments: 0, completionRate: 0 });
  });

  it('caps the list', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      doctorId: String(i),
      doctor: `Dr ${i}`,
      appointments: i,
      completed: 0,
      revenue: 0,
    }));
    expect(rankDoctors(rows)).toHaveLength(5);
  });
});

describe('fillDuesBrackets', () => {
  it('always returns the four brackets in order', () => {
    expect(
      fillDuesBrackets([{ bracket: '90+', amount: '1200.4', count: '2' }])
    ).toEqual([
      { bracket: '0-30', amount: 0, count: 0 },
      { bracket: '31-60', amount: 0, count: 0 },
      { bracket: '61-90', amount: 0, count: 0 },
      { bracket: '90+', amount: 1200, count: 2 },
    ]);
  });
});

describe('topBusiestHours', () => {
  it('buckets mixed time formats by hour, busiest first', () => {
    const out = topBusiestHours([
      { time: '09:00', cnt: '2' },
      { time: '9:30 AM', cnt: '3' },
      { time: '14:15', cnt: '1' },
      { time: null, cnt: '7' },
    ]);
    expect(out).toEqual([
      { hour: 9, label: '9-10 AM', appointments: 5 },
      { hour: 14, label: '2-3 PM', appointments: 1 },
    ]);
  });
});

describe('orderBusiestDays', () => {
  it('orders Monday first and fills empty days with zero', () => {
    const out = orderBusiestDays([
      { dow: '0', cnt: '4' },
      { dow: 1, cnt: 2 },
    ]);
    expect(out[0]).toEqual({ day: 'Mon', appointments: 2 });
    expect(out[6]).toEqual({ day: 'Sun', appointments: 4 });
    expect(out.slice(1, 6).every((d) => d.appointments === 0)).toBe(true);
  });
});

describe('fillFollowUpGroups', () => {
  it('always returns the four groups in order', () => {
    expect(
      fillFollowUpGroups([{ group: '31-90', patients: '6' }]).map(
        (g) => g.patients
      )
    ).toEqual([0, 6, 0, 0]);
  });
});
