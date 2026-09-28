import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import {
  ClinicAvailability,
  ClinicAvailabilityBreak,
  ClinicDateAvailability,
  ClinicDateAvailabilityTimeSlots,
} from '../models/clinic.model';
import {
  getISTDateString,
  getISTDayName,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import {
  parseTimeToMinutes,
  subtractBreaksFromWindow,
} from '../../../utils/timeWindow.util';

export interface DoctorAvailabilityWindow {
  start: number;
  end: number;
}

export interface DoctorAvailabilityToday {
  doctorId: string;
  windows: DoctorAvailabilityWindow[];
  isActiveNow: boolean;
}


export async function resolveDoctorAvailabilityToday(
  clinicId: string,
  staffIds: string[]
): Promise<DoctorAvailabilityToday[]> {
  if (staffIds.length === 0) return [];

  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCHours(23, 59, 59, 999);

  const todayDateStr = getISTDateString(now);
  const todayDayName = getISTDayName(todayDateStr);
  const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes(now);
  const nowMinutes = istHours * 60 + istMinutes;

  const [weeklyRows, dateRows] = await Promise.all([
    database
      .select()
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.dayOfWeek, todayDayName),
          inArray(ClinicAvailability.doctorId, staffIds),
          eq(ClinicAvailability.isAvailable, true)
        )
      ),
    database
      .select()
      .from(ClinicDateAvailability)
      .where(
        and(
          eq(ClinicDateAvailability.clinicId, clinicId),
          inArray(ClinicDateAvailability.doctorId, staffIds),
          gte(ClinicDateAvailability.date, todayStart),
          lte(ClinicDateAvailability.date, todayEnd)
        )
      ),
  ]);

  const weeklyByDoctor = new Map(
    weeklyRows.map((r) => [r.doctorId as string, r])
  );
  const dateByDoctor = new Map(dateRows.map((r) => [r.doctorId, r]));

  const weeklyIds = weeklyRows.map((r) => r.id);
  const breakRows = weeklyIds.length
    ? await database
        .select()
        .from(ClinicAvailabilityBreak)
        .where(
          and(
            inArray(ClinicAvailabilityBreak.clinicAvailabilityId, weeklyIds),
            eq(ClinicAvailabilityBreak.status, true)
          )
        )
    : [];
  const breaksByAvailability = new Map<
    string,
    { startTime?: string | null; endTime?: string | null }[]
  >();
  for (const b of breakRows) {
    const key = b.clinicAvailabilityId;
    if (!breaksByAvailability.has(key)) breaksByAvailability.set(key, []);
    breaksByAvailability
      .get(key)!
      .push({ startTime: b.startTime, endTime: b.endTime });
  }

  const dateOverrideIds = dateRows
    .filter((r) => r.isAvailable)
    .map((r) => r.id);
  const customSlotRows = dateOverrideIds.length
    ? await database
        .select()
        .from(ClinicDateAvailabilityTimeSlots)
        .where(
          and(
            inArray(
              ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
              dateOverrideIds
            ),
            eq(ClinicDateAvailabilityTimeSlots.isAvailable, true)
          )
        )
    : [];
  const slotsByDateAvailability = new Map<
    string,
    { start: number; end: number }[]
  >();
  for (const s of customSlotRows) {
    const startMin = parseTimeToMinutes(s.startTime);
    const endMin = parseTimeToMinutes(s.endTime);
    if (startMin === null || endMin === null || startMin >= endMin) continue;
    const key = s.clinicDateAvailabilityId;
    if (!slotsByDateAvailability.has(key)) slotsByDateAvailability.set(key, []);
    slotsByDateAvailability.get(key)!.push({ start: startMin, end: endMin });
  }

  return staffIds.map((doctorId) => {
    const dateRow = dateByDoctor.get(doctorId);
    let windows: DoctorAvailabilityWindow[] = [];

    if (dateRow) {
      if (dateRow.isAvailable) {
        windows = slotsByDateAvailability.get(dateRow.id) || [];
      }
      // else: on leave today -> windows stays []
    } else {
      const weeklyRow = weeklyByDoctor.get(doctorId);
      if (weeklyRow) {
        const breaks = breaksByAvailability.get(weeklyRow.id) || [];
        windows = subtractBreaksFromWindow(
          weeklyRow.startTime,
          weeklyRow.endTime,
          breaks
        );
      }
    }

    const isActiveNow = windows.some(
      (w) => nowMinutes >= w.start && nowMinutes < w.end
    );

    return { doctorId, windows, isActiveNow };
  });
}
