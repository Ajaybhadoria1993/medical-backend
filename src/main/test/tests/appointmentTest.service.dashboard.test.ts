import { AppointmentTestService } from '../services/appointmentTest.service';

type DashboardTrend = {
  value: number;
  previousValue: number;
  change: number;
  percentage: number;
  trendPercentage: number;
  direction: 'up' | 'down' | 'neutral';
  comparisonLabel: string;
  comparisonStartDate: string | null;
  comparisonEndDate: string | null;
};

type AppointmentTestServiceDashboardInternals = {
  buildDashboardTrend: (
    current: number,
    previous: number,
    comparison: {
      comparisonLabel: string;
      comparisonStartDate: string | null;
      comparisonEndDate: string | null;
    }
  ) => DashboardTrend;
};

describe('AppointmentTestService dashboard trends', () => {
  const service =
    AppointmentTestService as unknown as AppointmentTestServiceDashboardInternals;
  const comparison = {
    comparisonLabel: 'vs yesterday',
    comparisonStartDate: '2026-06-24',
    comparisonEndDate: '2026-06-24',
  };

  it('uses the larger metric value as the dashboard trend baseline', () => {
    const result = service.buildDashboardTrend(13, 2, comparison);

    expect(result).toEqual({
      value: 13,
      previousValue: 2,
      change: 11,
      percentage: 84.62,
      trendPercentage: 84.62,
      direction: 'up',
      ...comparison,
    });
  });

  it('keeps normal trend percentages proportional to the dashboard baseline', () => {
    const result = service.buildDashboardTrend(6, 4, comparison);

    expect(result.percentage).toBe(33.33);
    expect(result.trendPercentage).toBe(33.33);
    expect(result.change).toBe(2);
    expect(result.direction).toBe('up');
  });

  it('does not show a fake 100 percent trend when the comparison period has no data', () => {
    const result = service.buildDashboardTrend(8, 0, comparison);

    expect(result.percentage).toBe(0);
    expect(result.trendPercentage).toBe(0);
    expect(result.change).toBe(8);
    expect(result.direction).toBe('neutral');
  });
});
