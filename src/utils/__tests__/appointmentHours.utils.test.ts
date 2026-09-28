import {
  parseHourFromTimeLabel,
  bucketRowsByHour,
  formatHour12,
  formatHourSlot12,
  formatHourSlotShort,
} from '../appointmentHours.utils';

describe('parseHourFromTimeLabel', () => {
  it('parses 12-hour labels, including the midnight/noon edges', () => {
    expect(parseHourFromTimeLabel('12:00 AM')).toBe(0);
    expect(parseHourFromTimeLabel('12:30 AM')).toBe(0);
    expect(parseHourFromTimeLabel('9:00 AM')).toBe(9);
    expect(parseHourFromTimeLabel('09:00 AM')).toBe(9);
    expect(parseHourFromTimeLabel('9 AM')).toBe(9);
    expect(parseHourFromTimeLabel('11:59 AM')).toBe(11);
    expect(parseHourFromTimeLabel('12:00 PM')).toBe(12);
    expect(parseHourFromTimeLabel('1:00 PM')).toBe(13);
    expect(parseHourFromTimeLabel('11:30 PM')).toBe(23);
  });

  it('is case and whitespace insensitive', () => {
    expect(parseHourFromTimeLabel('  9:00 am  ')).toBe(9);
    expect(parseHourFromTimeLabel('9:00pm')).toBe(21);
    expect(parseHourFromTimeLabel('9:00 Pm')).toBe(21);
  });

  it('parses 24-hour labels', () => {
    expect(parseHourFromTimeLabel('00:00')).toBe(0);
    expect(parseHourFromTimeLabel('09:00')).toBe(9);
    expect(parseHourFromTimeLabel('14:30')).toBe(14);
    expect(parseHourFromTimeLabel('14:30:00')).toBe(14);
    expect(parseHourFromTimeLabel('23:59')).toBe(23);
  });

  it('returns null rather than defaulting to midnight for bad input', () => {
    expect(parseHourFromTimeLabel(null)).toBeNull();
    expect(parseHourFromTimeLabel(undefined)).toBeNull();
    expect(parseHourFromTimeLabel('')).toBeNull();
    expect(parseHourFromTimeLabel('   ')).toBeNull();
    expect(parseHourFromTimeLabel('morning')).toBeNull();
    expect(parseHourFromTimeLabel('25:00')).toBeNull();
    expect(parseHourFromTimeLabel('13:00 PM')).toBeNull();
    expect(parseHourFromTimeLabel('0 AM')).toBeNull();
    expect(parseHourFromTimeLabel('09:70')).toBeNull();
  });
});

describe('bucketRowsByHour', () => {
  it('merges 12-hour and 24-hour spellings of the same hour', () => {
    const out = bucketRowsByHour([
      { time: '9:00 AM', cnt: 3 },
      { time: '09:00', cnt: 2 },
    ]);
    expect(out).toEqual([{ hour: 9, cnt: 5 }]);
  });

  it('orders busiest first with a deterministic tie-break', () => {
    const out = bucketRowsByHour([
      { time: '15:00', cnt: 4 },
      { time: '09:00', cnt: 9 },
      { time: '11:00', cnt: 4 },
    ]);
    expect(out).toEqual([
      { hour: 9, cnt: 9 },
      { hour: 11, cnt: 4 },
      { hour: 15, cnt: 4 },
    ]);
  });

  it('drops unparseable rows instead of counting them as midnight', () => {
    const out = bucketRowsByHour([
      { time: null, cnt: 100 },
      { time: 'n/a', cnt: 50 },
      { time: '10:00 AM', cnt: 1 },
    ]);
    expect(out).toEqual([{ hour: 10, cnt: 1 }]);
  });

  it('tolerates string counts and empty input', () => {
    expect(bucketRowsByHour([{ time: '10:00', cnt: '7' }])).toEqual([
      { hour: 10, cnt: 7 },
    ]);
    expect(bucketRowsByHour([])).toEqual([]);
  });
});

describe('hour formatting', () => {
  it('never renders "0 AM"', () => {
    for (let h = 0; h < 24; h++) {
      expect(formatHour12(h)).not.toMatch(/^0\s/);
    }
    expect(formatHour12(0)).toBe('12 AM');
    expect(formatHour12(12)).toBe('12 PM');
    expect(formatHour12(9)).toBe('9 AM');
    expect(formatHour12(21)).toBe('9 PM');
  });

  it('builds slot labels that wrap correctly at the end of the day', () => {
    expect(formatHourSlot12(9)).toBe('09:00 AM - 10:00 AM');
    expect(formatHourSlot12(11)).toBe('11:00 AM - 12:00 PM');
    expect(formatHourSlot12(23)).toBe('11:00 PM - 12:00 AM');
    expect(formatHourSlotShort(9)).toBe('9-10 AM');
    expect(formatHourSlotShort(23)).toBe('11-12 PM');
  });
});
