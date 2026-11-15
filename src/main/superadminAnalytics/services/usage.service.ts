import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { getSourceDataPort } from '../ports';
import type { PeriodQueryDto } from '../schemas/superadminAnalytics.schema';
import type { UsageResponse } from '../types/responses.types';
import { fillDays, resolvePeriod } from '../utils/period.utils';

/** Business figures; a few minutes' lag is fine and nothing invalidates them. */
const USAGE_TTL_SECONDS = 300;

const pct = (n: number, of: number) =>
  of ? Math.round((n / of) * 1000) / 10 : 0;

export class UsageService {
  static getUsage(query: PeriodQueryDto): Promise<UsageResponse> {
    const p = resolvePeriod(query);
    return getOrSetCache(
      CacheKeys.superadminUsage(p.current.from, p.current.to, p.previous.from),
      USAGE_TTL_SECONDS,
      () => UsageService.build(p)
    );
  }

  private static async build(
    p: ReturnType<typeof resolvePeriod>
  ): Promise<UsageResponse> {
    const port = getSourceDataPort();
    const [now, before] = await Promise.all([
      port.getUsage(p.current.from, p.current.to),
      port.getUsage(p.previous.from, p.previous.to),
    ]);
    const labels = new Map(
      (await port.getClinicLabels(now.topClinics.map((c) => c.clinicId))).map(
        (l) => [l.clinicId, l]
      )
    );
    const total = now.byStatus.reduce((s, r) => s + r.count, 0);
    const count = (key: string) =>
      now.byStatus.find((r) => r.key === key)?.count ?? 0;

    return {
      period: p.current,
      previousPeriod: p.previous,
      kpis: {
        appointments: total,
        appointmentsPrevious: before.byStatus.reduce((s, r) => s + r.count, 0),
        completedRate: pct(count('Completed'), total),
        noShowRate: pct(count('NoShow'), total),
        newPatients: now.newPatients,
        newPatientsPrevious: before.newPatients,
        clinicsWithBookings: now.clinicsWithBookings,
        staffActions: now.staffByRole.reduce((s, r) => s + r.actions, 0),
      },
      appointmentsByDay: fillDays(
        p.current.from,
        p.current.to,
        now.appointmentsByDay
      ).map((d) => ({
        ...d,
        app: now.appointmentsByDay.find((r) => r.day === d.day)?.app ?? 0,
      })),
      byStatus: now.byStatus,
      bySource: now.bySource,
      topClinics: now.topClinics.map((c) => ({
        ...c,
        clinicCode: labels.get(c.clinicId)?.clinicCode ?? '—',
        name: labels.get(c.clinicId)?.name ?? 'Removed clinic',
      })),
      staffByRole: now.staffByRole,
      generatedAt: new Date().toISOString(),
    };
  }
}
