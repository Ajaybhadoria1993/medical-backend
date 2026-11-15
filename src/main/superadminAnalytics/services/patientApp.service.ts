import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { getSourceDataPort } from '../ports';
import type { PeriodQueryDto } from '../schemas/superadminAnalytics.schema';
import type { PatientAppResponse } from '../types/responses.types';
import { fillDays, resolvePeriod } from '../utils/period.utils';

/** Business figures; a few minutes' lag is fine and nothing invalidates them. */
const PATIENT_APP_TTL_SECONDS = 300;

const pct = (n: number, of: number) =>
  of ? Math.round((n / of) * 1000) / 10 : 0;

export class PatientAppService {
  static getPatientApp(query: PeriodQueryDto): Promise<PatientAppResponse> {
    const p = resolvePeriod(query);
    return getOrSetCache(
      CacheKeys.superadminPatientApp(
        p.current.from,
        p.current.to,
        p.previous.from
      ),
      PATIENT_APP_TTL_SECONDS,
      () => PatientAppService.build(p)
    );
  }

  private static async build(
    p: ReturnType<typeof resolvePeriod>
  ): Promise<PatientAppResponse> {
    const port = getSourceDataPort();
    const [now, before] = await Promise.all([
      port.getPatientApp(p.current.from, p.current.to),
      port.getPatientApp(p.previous.from, p.previous.to),
    ]);
    const labels = new Map(
      (
        await port.getClinicLabels(now.topAppClinics.map((c) => c.clinicId))
      ).map((l) => [l.clinicId, l])
    );
    const signedIn = now.signedInPatients;
    const appDays = fillDays(
      p.current.from,
      p.current.to,
      now.appBookingsByDay
    );

    return {
      period: p.current,
      previousPeriod: p.previous,
      kpis: {
        totalPatients: now.totalPatients,
        signedInApp: signedIn,
        signedInShare: pct(signedIn, now.totalPatients),
        appSignIns: now.appSignIns,
        appSignInsPrevious: before.appSignIns,
        appBookings: now.appBookings,
        appBookingsPrevious: before.appBookings,
        appBookingShare: pct(now.appBookings, now.allBookings),
        pushEnabled: now.pushPatients,
        newPatientAccounts: now.newPatientAccounts,
      },
      signedInByPlatform: now.signedInApp,
      pushByPlatform: now.pushEnabled,
      newPushDevices: now.newPushDevices,
      bookingsByDay: fillDays(
        p.current.from,
        p.current.to,
        now.allBookingsByDay
      ).map((d, i) => ({
        day: d.day,
        app: appDays[i].count,
        all: d.count,
      })),
      topAppClinics: now.topAppClinics.map((c) => ({
        ...c,
        clinicCode: labels.get(c.clinicId)?.clinicCode ?? '—',
        name: labels.get(c.clinicId)?.name ?? 'Removed clinic',
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
