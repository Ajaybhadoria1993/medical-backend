/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { TokenCapacityService } from '../../appointment-engine/services/tokenCapacity.service';
import {
  ScheduleShiftService,
  toHHMM,
} from '../../appointment-engine/services/scheduleShift.service';
import { database } from '../../../configurations/dbConnection';
import { shiftWindowsForDay } from '../../../utils/timeWindow.util';
import {
  ClinicAvailability,
  ClinicAvailabilityBreak,
  ClinicDateAvailability,
  ClinicDateAvailabilityTimeSlots,
} from '../../clinic/models/clinic.model';
import { isOverrideAppointmentType } from '../utils/appointmentType.constants';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AppointmentModel } from '../models/appointment.model';
import { getISTDateString } from '../../../utils/istDateTime';
import { hhmmToMinutes } from '../../../utils/time.util';
import { PaymentReservationService } from './paymentReservation.service';
import {
  getAvailableSlotsForDateDto,
  getAvailableSlotsForParamsDto,
} from '../schemas/appointment.schemas';
import type { Slot } from '../types/slot.types';
import { filterExpiredPendingAppointments } from './appointment.service';

type DbExecutor =
  Parameters<Parameters<typeof database.transaction>[0]>[0] | typeof database;

/** Live statuses that occupy a time slot. */
const TIMED_LIVE_STATUSES = [
  'Confirmed',
  'Patient Arrived',
  'Pending',
  'Rescheduled',
  'Upcoming',
  'Completed',
] as const;

/** "14:05" -> "2:05 PM". */
function to12Hour(hhmm: string): string {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/** A shift window as the "9:00 AM - 1:00 PM" label the picker shows. */
const formatWindow = (w: { start: number; end: number }) =>
  `${to12Hour(toHHMM(w.start))} - ${to12Hour(toHHMM(w.end))}`;

/** Confirmed or arrived patients hold the slot; any other live status only reserves it. */
const occupancy = (status: string) =>
  status === 'Confirmed' || status === 'Patient Arrived'
    ? ('booked' as const)
    : ('reserved' as const);

/** Booking ref, patient and duration from a payment lock; a non-JSON value is the bare ref. */
function parseLock(value: string, defaultDuration: number) {
  let id = value;
  let patientId: string | undefined;
  let duration = defaultDuration;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      id = parsed.bookingRefId || value;
      duration = Number(parsed.duration) || defaultDuration;
      patientId = parsed.patientId;
    }
  } catch {
    // Older locks store the bare booking ref, which is not JSON.
  }
  return { id, patientId, duration };
}

/** Free and booked slots or tokens for a doctor's day, plus the date/time helpers they use. */
export class AppointmentSlotsService {
  /** Active breaks of the given weekly availability rows. */
  private static activeBreaks(tx: DbExecutor, availabilityIds: string[]) {
    return tx
      .select()
      .from(ClinicAvailabilityBreak)
      .where(
        and(
          inArray(
            ClinicAvailabilityBreak.clinicAvailabilityId,
            availabilityIds
          ),
          eq(ClinicAvailabilityBreak.status, true)
        )
      );
  }

  /** The doctor's live timed appointments that day, minus pending checkouts that expired. */
  private static async liveDayAppointments(
    tx: DbExecutor,
    clinicId: string,
    doctorId: string,
    startOfDay: Date,
    nextDay: Date
  ) {
    const appointments = await tx
      .select({
        id: AppointmentModel.id,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentDurationMinutes: AppointmentModel.appointmentDurationMinutes,
        appointmentStatus: AppointmentModel.appointmentStatus,
        patientId: AppointmentModel.patientId,
        paymentMode: AppointmentPaymentModel.paymentMode,
        paymentStatus: AppointmentPaymentModel.paymentStatus,
        doctorId: AppointmentModel.doctorId,
        appointmentDate: AppointmentModel.appointmentDate,
        tokenNo: AppointmentModel.tokenNo,
      })
      .from(AppointmentModel)
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          gte(AppointmentModel.appointmentDate, startOfDay),
          lt(AppointmentModel.appointmentDate, nextDay),
          inArray(AppointmentModel.appointmentStatus, TIMED_LIVE_STATUSES)
        )
      );
    return filterExpiredPendingAppointments(appointments);
  }

  /** Minute ranges held by appointments, then by time-slot payment locks. */
  private static occupiedRanges(
    appointments: any[] | null | undefined,
    locks: { slotOrToken: unknown; value: string }[],
    defaultLockMinutes: number
  ) {
    const lockRanges: any[] = [];
    for (const lock of locks) {
      if (typeof lock.slotOrToken !== 'string') continue;
      const startMin = hhmmToMinutes(lock.slotOrToken);
      if (startMin === null) continue;
      const { id, patientId, duration } = parseLock(
        lock.value,
        defaultLockMinutes
      );
      lockRanges.push({
        start: startMin,
        end: startMin + duration,
        id,
        status: 'Pending',
        patientId,
      });
    }
    return [
      ...(appointments || [])
        .map((a: any) => {
          const startMin = hhmmToMinutes(a.appointmentTime);
          if (startMin == null) return null;
          const duration = Math.max(
            1,
            Number(a.appointmentDurationMinutes) || 30
          );
          return {
            start: startMin,
            end: startMin + duration,
            id: a.id,
            status: a.appointmentStatus,
            patientId: a.patientId,
          };
        })
        .filter(Boolean),
      ...lockRanges,
    ];
  }

  /** YYYY-MM-DD (UTC day) from a date or ISO string; null if unparseable. */
  static normalizeToDateOnly(dateLike: string) {
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) {
      const m = String(dateLike).match(/(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    }
    // UTC parts, so the server's own timezone can't shift the day.
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /** Date + minutes since midnight as a local ISO string, e.g. "2026-10-29T09:30:00". */
  static minutesToIso(dateOnlyYMD: string, minutesSinceMidnight: number) {
    const hh = Math.floor(minutesSinceMidnight / 60)
      .toString()
      .padStart(2, '0');
    const mm = (minutesSinceMidnight % 60).toString().padStart(2, '0');
    return `${dateOnlyYMD}T${hh}:${mm}:00`;
  }

  /** Free/booked slots or tokens for a doctor on a date, per shift. */
  static async getAvailableSlotsForDate(
    clinicId: string,
    query: getAvailableSlotsForDateDto & {
      onlyOccupied?: boolean;
      occupyMode?: 'partial' | 'full' | 'start';
    } = {
      onlyOccupied: false,
      occupyMode: 'partial',
      date: getISTDateString(),
    },
    params: getAvailableSlotsForParamsDto
  ): Promise<{ slots: Slot[]; shifts?: string[]; tokensNotSet?: boolean }> {
    const tx = database;
    const rawDate = typeof query === 'string' ? query : (query as any)?.date;
    const dateStr = this.normalizeToDateOnly(rawDate);
    if (!dateStr) return { slots: [] };

    const startOfDay = new Date(`${dateStr}T00:00:00Z`);
    const nextDay = new Date(startOfDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    let finalSlots: Slot[] = [];
    let shifts: string[] = [];
    let isTokenBooking = false;

    // `breaks` are already filtered to status = true by every caller.
    const calculateShifts = (
      day: Parameters<typeof shiftWindowsForDay>[0],
      breaks: { startTime: string | null; endTime: string | null }[]
    ): string[] => shiftWindowsForDay(day, breaks).map(formatWindow);

    // A weekly row with noOfPatients makes this a token day.
    const weekdayForToken = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(
      'en-US',
      {
        weekday: 'long',
        timeZone: 'UTC',
      }
    );

    // The weekly rows and the date override don't depend on each other, so they load together.
    const [tokenAvailRows, dateUnavailable] = await Promise.all([
      tx
        .select()
        .from(ClinicAvailability)
        .where(
          and(
            eq(ClinicAvailability.clinicId, clinicId),
            eq(ClinicAvailability.doctorId, params.doctorId),
            eq(ClinicAvailability.dayOfWeek, weekdayForToken),
            eq(ClinicAvailability.isAvailable, true)
          )
        ),
      tx
        .select()
        .from(ClinicDateAvailability)
        .where(
          and(
            eq(ClinicDateAvailability.clinicId, clinicId),
            eq(ClinicDateAvailability.doctorId, params.doctorId),
            eq(ClinicDateAvailability.date, startOfDay)
          )
        ),
    ]);

    let tokenCapacity = 0;
    let tokenClinicAvailabilityId: string | null = null;
    for (const row of tokenAvailRows) {
      const n = (row as any).noOfPatients as number | null | undefined;
      if (typeof n === 'number' && n > tokenCapacity) {
        tokenCapacity = n;
        tokenClinicAvailabilityId = (row as any).id as string;
      }
    }

    // A date row that isn't explicitly available (false or null) turns the token day off.
    const shouldSkipToken =
      dateUnavailable.length > 0 &&
      (dateUnavailable[0].isAvailable === false ||
        dateUnavailable[0].isAvailable === null);

    if (tokenCapacity > 0 && tokenClinicAvailabilityId && !shouldSkipToken) {
      isTokenBooking = true;

      const apptStatuses = [
        'Confirmed',
        'Patient Arrived',
        'Pending',
        'Rescheduled',
        'Upcoming',
        'Completed',
        // Fetched alongside the active rows, then split out below: a
        // cancelled token is free again but its number is already issued.
        'Cancelled',
        'NoShow',
      ] as const;

      const availRow = tokenAvailRows.find(
        (r: any) => r.id === tokenClinicAvailabilityId
      );
      if (!availRow?.startTime || !availRow?.endTime) {
        throw new Error('Start time or End time missing');
      }

      // Bookings, payment locks, breaks and shift segments are independent reads.
      const bookedRead = tx
        .select({
          id: AppointmentModel.id,
          tokenNo: AppointmentModel.tokenNo,
          // bookedMap is keyed per shift, so each token needs its session.
          sessionIndex: AppointmentModel.sessionIndex,
          appointmentStatus: AppointmentModel.appointmentStatus,
          // Lets the token card name the override that booked it rather than
          // showing a generic "Booked" beside an ordinary consultation.
          appointmentType: AppointmentModel.appointmentType,
          patientId: AppointmentModel.patientId,
          paymentMode: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          doctorId: AppointmentModel.doctorId,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, params.doctorId),
            gte(AppointmentModel.appointmentDate, startOfDay),
            lt(AppointmentModel.appointmentDate, nextDay),
            inArray(AppointmentModel.appointmentStatus, apptStatuses)
          )
        );
      const [booked, redisLocks, breaks, day] = await Promise.all([
        bookedRead,
        PaymentReservationService.getActiveLocksForDate(
          params.doctorId,
          dateStr
        ),
        this.activeBreaks(tx, [tokenClinicAvailabilityId]),
        // One entry per shift, from the same resolver booking uses, so picker and booking can't drift.
        ScheduleShiftService.resolveDaySegmentsForTokens(
          tx,
          clinicId,
          params.doctorId,
          dateStr
        ),
      ]);

      // Terminal rows ride along in the query above but must not occupy a
      // token — that is what keeps capacity from shrinking on a cancellation.
      const isReleasedStatus = (status: string) =>
        status === 'Cancelled' || status === 'NoShow';
      const releasedBooked = booked.filter((b) =>
        isReleasedStatus(b.appointmentStatus as string)
      );
      const activeBooked = await filterExpiredPendingAppointments(
        booked.filter((b) => !isReleasedStatus(b.appointmentStatus as string))
      );

      // Key by session:token so morning token 3 doesn't block evening's; null session = 1.
      const bookedKey = (session: number | null, token: number) =>
        `${session ?? 1}:${token}`;

      // Cancelled/no-show tokens: free again, but flagged since a patient may still hold the number.
      // Taken from rows already fetched to avoid an extra query.
      const releasedKeys = new Set<string>();
      for (const b of releasedBooked) {
        const t = b.tokenNo == null ? null : Number(b.tokenNo);
        if (t && Number.isFinite(t)) {
          releasedKeys.add(`${(b as any).sessionIndex ?? 1}:${t}`);
        }
      }

      const bookedMap = new Map<string, any>();
      const bookedTokens: number[] = [];
      for (const b of activeBooked) {
        const t =
          b.tokenNo == null ? null : Number(b.tokenNo as unknown as number);
        if (t && Number.isFinite(t)) {
          bookedMap.set(bookedKey((b as any).sessionIndex ?? null, t), {
            id: b.id,
            appointmentStatus: b.appointmentStatus,
            appointmentType: b.appointmentType,
            patientId: b.patientId,
          });
          bookedTokens.push(t);
        }
      }

      for (const lock of redisLocks) {
        if (typeof lock.slotOrToken === 'number') {
          const t = lock.slotOrToken;
          const lockKey = bookedKey(lock.sessionIndex, t);
          if (!bookedMap.has(lockKey)) {
            const { id, patientId } = parseLock(lock.value, 0);
            bookedMap.set(lockKey, {
              id,
              appointmentStatus: 'Pending',
              patientId,
            });
            bookedTokens.push(t);
          }
        }
      }

      const calculatedShifts = calculateShifts(availRow, breaks);

      if (calculatedShifts.length > 0) {
        shifts = calculatedShifts;
      }

      const segments = day?.segments?.length
        ? day.segments
        : // No derivable blocks: treat the availability window as the single
          // session, so a plain token day behaves exactly as it always has.
          [
            {
              start: hhmmToMinutes(availRow.startTime) ?? 0,
              end: hhmmToMinutes(availRow.endTime) ?? 0,
              slotId: undefined as string | undefined,
            },
          ];

      const sessionSlots = await Promise.all(
        segments.map(async (segment, index) => {
          const sessionIndex = index + 1;
          const sessionStart = toHHMM(segment.start);
          const sessionEnd = toHHMM(segment.end);

          const {
            capacity,
            source: capacitySource,
            appointmentType: overrideType,
          } = await TokenCapacityService.resolveForSession(
            clinicId,
            params.doctorId,
            dateStr,
            sessionStart,
            (segment as { slotId?: string }).slotId,
            tx,
            sessionIndex
          );

          // Numbers past the standing capacity exist only because an
          // override raised it, so the card can say so rather than "extra".
          const baseCapacity =
            capacitySource === 'session_override'
              ? await TokenCapacityService.resolveStandingCapacity(
                  clinicId,
                  params.doctorId,
                  dateStr,
                  sessionIndex,
                  tx
                )
              : capacity;

          const sessionTokens: Slot['tokens'] = Array.from(
            { length: capacity },
            (_, i) => {
              const tokenNo = i + 1;
              const b = bookedMap.get(bookedKey(sessionIndex, tokenNo));
              return b
                ? {
                    tokenNo,
                    status: occupancy(b.appointmentStatus),
                    appointmentId: b.id,
                    appointmentStatus: b.appointmentStatus,
                    // Booking an override-created token through the ordinary
                    // grid stores 'Consultation'; the slot's own reason wins.
                    appointmentType: isOverrideAppointmentType(
                      b.appointmentType
                    )
                      ? b.appointmentType
                      : tokenNo > baseCapacity && overrideType
                        ? overrideType
                        : b.appointmentType,
                    patientId: b.patientId,
                  }
                : {
                    tokenNo,
                    status: 'available' as const,
                    // Free again, but this number is already in a patient's
                    // hands — see releasedKeys.
                    ...(releasedKeys.has(bookedKey(sessionIndex, tokenNo))
                      ? { isReopened: true }
                      : {}),
                    // Added by an override, so it carries that override's
                    // reason until someone books it.
                    ...(tokenNo > baseCapacity
                      ? {
                          isExtra: true,
                          ...(overrideType
                            ? { appointmentType: overrideType }
                            : {}),
                        }
                      : {}),
                  };
            }
          );

          // Override bookings above capacity sit outside 1..capacity; list them,
          // or the grid shows the number free and the modal re-offers it.
          for (const [key, b] of bookedMap) {
            const [session, tokenNo] = key.split(':').map(Number);
            if (session !== sessionIndex || tokenNo <= capacity) continue;
            sessionTokens.push({
              tokenNo,
              status: occupancy(b.appointmentStatus),
              appointmentId: b.id,
              appointmentStatus: b.appointmentStatus,
              appointmentType: b.appointmentType,
              patientId: b.patientId,
              isExtra: true,
            });
          }
          sessionTokens.sort((x, y) => x.tokenNo - y.tokenNo);

          // Scan from 1, not the highest booked, so a cancelled number is reused first.
          const firstFree = sessionTokens.find((t) => t.status === 'available');

          return {
            start: `${dateStr}T${sessionStart}:00`,
            end: `${dateStr}T${sessionEnd}:00`,
            clinicAvailabilityId: tokenClinicAvailabilityId,
            source: 'availability' as const,
            status: 'available' as const,
            tokens: sessionTokens,
            totalTokens: capacity,
            availableTokens: sessionTokens.filter(
              (t) => t.status === 'available'
            ).length,
            autoToken: firstFree ? firstFree.tokenNo : ('-' as const),
            sessionIndex,
            sessionStart,
            sessionEnd,
            totalSessions: segments.length,
          };
        })
      );

      // Drop finished sessions per session, not per day, so the evening stays bookable.
      const thresholdMinutes = query.time ? hhmmToMinutes(query.time) : null;

      const isToday = dateStr === getISTDateString();

      for (const sessionSlot of sessionSlots) {
        const endMinutes = hhmmToMinutes(sessionSlot.sessionEnd);

        const ended =
          isToday &&
          thresholdMinutes !== null &&
          endMinutes !== null &&
          endMinutes <= thresholdMinutes;

        // A finished session keeps its issued tokens — the day's queue still
        // has to be readable. Only its free numbers go.
        if (!ended) {
          finalSlots.push(sessionSlot);
        } else {
          const issued = sessionSlot.tokens.filter(
            (t: any) => t.status !== 'available'
          );
          if (issued.length > 0) {
            finalSlots.push({
              ...sessionSlot,
              tokens: issued,
              availableTokens: 0,
            });
          }
        }
      }
    }

    // Doctor took the token day off: offer no capacity but still list booked overrides as tokens.
    if (tokenCapacity > 0 && tokenClinicAvailabilityId && shouldSkipToken) {
      const leaveDayBooked = await tx
        .select({
          id: AppointmentModel.id,
          tokenNo: AppointmentModel.tokenNo,
          sessionIndex: AppointmentModel.sessionIndex,
          appointmentStatus: AppointmentModel.appointmentStatus,
          appointmentType: AppointmentModel.appointmentType,
          patientId: AppointmentModel.patientId,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, params.doctorId),
            gte(AppointmentModel.appointmentDate, startOfDay),
            lt(AppointmentModel.appointmentDate, nextDay),
            isNotNull(AppointmentModel.tokenNo)
          )
        );

      isTokenBooking = true;

      // The weekday's real sittings, so the override picker can still name
      // one. Off duty removes the capacity, not the shape of the day.
      const leaveAvailRow = tokenAvailRows.find(
        (r: any) => r.id === tokenClinicAvailabilityId
      );
      const leaveBreaks = await this.activeBreaks(tx, [
        tokenClinicAvailabilityId,
      ]);

      const leaveWindows = leaveAvailRow
        ? shiftWindowsForDay(leaveAvailRow, leaveBreaks)
        : [];
      if (leaveWindows.length > 0) shifts = leaveWindows.map(formatWindow);

      const leaveSegments = leaveWindows.length
        ? leaveWindows
        : [{ start: 0, end: 24 * 60 - 1 }];

      leaveSegments.forEach((segment, index) => {
        const sessionIndex = index + 1;
        // A booking made before shift-wise numbering carries no session and
        // belongs to the first, where its number was issued.
        const sessionTokens = leaveDayBooked
          .filter((b) => (b.sessionIndex ?? 1) === sessionIndex)
          .map((b) => ({
            tokenNo: Number(b.tokenNo),
            status: occupancy(b.appointmentStatus),
            appointmentId: b.id,
            appointmentStatus: b.appointmentStatus,
            appointmentType: b.appointmentType,
            patientId: b.patientId,
          }))
          .sort((a, b) => a.tokenNo - b.tokenNo);

        finalSlots.push({
          start: this.minutesToIso(dateStr, segment.start),
          end: this.minutesToIso(dateStr, segment.end),
          clinicAvailabilityId: tokenClinicAvailabilityId,
          source: 'availability' as const,
          status: 'available' as const,
          tokens: sessionTokens,
          totalTokens: 0,
          availableTokens: 0,
          autoToken: '-' as const,
          sessionIndex,
          sessionStart: toHHMM(segment.start),
          sessionEnd: toHHMM(segment.end),
          totalSessions: leaveSegments.length,
        } as any);
      });
    }

    // Time mode isn't offered yet, so an open weekday saved without tokens gets no time grid, only this flag.
    const tokensNotSet = !isTokenBooking && tokenAvailRows.length > 0;
    if (!isTokenBooking && !tokensNotSet) {
      // Same row the off-day check read above; no second query.
      const dateAvail = dateUnavailable;

      if (dateAvail.length > 0) {
        const da = dateAvail[0];
        if (da.isAvailable) {
          const dateAvailTimeSlots = await tx
            .select()
            .from(ClinicDateAvailabilityTimeSlots)
            .where(
              and(
                eq(
                  ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
                  da.id
                ),
                eq(ClinicDateAvailabilityTimeSlots.isAvailable, true)
              )
            );

          if (dateAvailTimeSlots.length > 0) {
            const slotDuration = Number(da.slotMinutes) || 30;
            const bufferMinutes = Number(da.stepMinutes) || 0;
            const stepDuration = slotDuration + bufferMinutes;

            const appointmentRanges = this.occupiedRanges(
              await this.liveDayAppointments(
                tx,
                clinicId,
                params.doctorId,
                startOfDay,
                nextDay
              ),
              await PaymentReservationService.getActiveLocksForDate(
                params.doctorId,
                dateStr
              ),
              slotDuration
            );

            for (const ts of dateAvailTimeSlots) {
              const startTimeMinutes = hhmmToMinutes(ts.startTime);
              const endTimeMinutes = hhmmToMinutes(ts.endTime);

              if (startTimeMinutes === null || endTimeMinutes === null) {
                continue;
              }

              for (
                let s = startTimeMinutes;
                s < endTimeMinutes;
                s += stepDuration
              ) {
                const e = s + slotDuration;
                if (e > endTimeMinutes) continue;

                const overlappingAppt = appointmentRanges.find(
                  (ar) => ar && ar.start < e && ar.end > s
                );

                if (overlappingAppt) {
                  finalSlots.push({
                    start: this.minutesToIso(dateStr, s),
                    end: this.minutesToIso(dateStr, e),
                    clinicAvailabilityId: da.id,
                    source: 'appointment',
                    status: occupancy(overlappingAppt.status),
                    appointmentId: overlappingAppt.id,
                    appointmentStatus: overlappingAppt.status,
                    patientId: overlappingAppt.patientId,
                  });
                } else {
                  finalSlots.push({
                    start: this.minutesToIso(dateStr, s),
                    end: this.minutesToIso(dateStr, e),
                    clinicAvailabilityId: da.id,
                    source: 'availability',
                    status: 'available',
                  });
                }
              }
            }
          }
        }
      } else {
        // Weekly time-slot grid, kept on purpose for when time mode returns; unreachable until
        // then because tokensNotSet already covers every open weekday. Do not delete.
        const weekday = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(
          'en-US',
          {
            weekday: 'long',
            timeZone: 'UTC',
          }
        );

        const availRows = await tx
          .select()
          .from(ClinicAvailability)
          .where(
            and(
              eq(ClinicAvailability.clinicId, clinicId),
              eq(ClinicAvailability.doctorId, params.doctorId),
              eq(ClinicAvailability.dayOfWeek, weekday),
              eq(ClinicAvailability.isAvailable, true)
            )
          );

        if (availRows && availRows.length > 0) {
          // A token row here only contributes shift labels; the token grid is built above.
          const tokenCapacity = Number((availRows[0] as any).noOfPatients);
          if (Number.isFinite(tokenCapacity) && tokenCapacity > 0) {
            const breaks = await this.activeBreaks(tx, [availRows[0].id]);

            const calculatedShifts = calculateShifts(availRows[0], breaks);

            if (calculatedShifts.length > 0 && shifts.length === 0) {
              shifts = calculatedShifts;
            }

            return {
              slots: finalSlots,
              shifts: shifts.length > 0 ? shifts : undefined,
            };
          } else {
            const availIds = availRows.map((r: any) => r.id);

            const breaks = await this.activeBreaks(tx, availIds);

            if (availRows.length > 0 && shifts.length === 0) {
              const calculatedShifts = calculateShifts(availRows[0], breaks);
              if (calculatedShifts.length > 0) {
                shifts = calculatedShifts;
              }
            }

            const appointmentRanges = this.occupiedRanges(
              await this.liveDayAppointments(
                tx,
                clinicId,
                params.doctorId,
                startOfDay,
                nextDay
              ),
              await PaymentReservationService.getActiveLocksForDate(
                params.doctorId,
                dateStr
              ),
              30
            );

            const breaksByAvail: Record<
              string,
              {
                start: number;
                end: number;
                id?: string;
                breakType?: string;
              }[]
            > = {};
            for (const b of breaks || []) {
              if (!b.startTime || !b.endTime) continue;
              const s = hhmmToMinutes(b.startTime);
              const e = hhmmToMinutes(b.endTime);
              if (s == null || e == null) continue;
              if (!breaksByAvail[b.clinicAvailabilityId])
                breaksByAvail[b.clinicAvailabilityId] = [];
              breaksByAvail[b.clinicAvailabilityId].push({
                start: s,
                end: e,
                id: b.id,
                breakType: b.breakType,
              });
            }

            for (const avail of availRows) {
              const availId = avail.id;
              const startMin = hhmmToMinutes(avail.startTime);
              const endMin = hhmmToMinutes(avail.endTime);
              if (startMin == null || endMin == null) continue;

              const breakRanges = breaksByAvail[availId] ?? [];
              const slotMinutes = Number(avail.slotMinutes) || 30;
              const bufferMinutes = Number(avail.stepMinutes) || 0;

              const allBlockers: {
                start: number;
                end: number;
                type: 'appointment' | 'break';
                data: any;
              }[] = [
                ...appointmentRanges
                  .filter((ar) => ar && ar.start < endMin && ar.end > startMin)
                  .map((ar) => ({
                    start: ar!.start,
                    end: ar!.end,
                    type: 'appointment' as const,
                    data: ar,
                  })),
                ...breakRanges
                  .filter((br) => br.start < endMin && br.end > startMin)
                  .map((br) => ({
                    start: br.start,
                    end: br.end,
                    type: 'break' as const,
                    data: br,
                  })),
              ].sort((a, b) => a.start - b.start);

              // Dynamic cursor: place a slot at each position; on a blocker, jump to
              // max(blockerEnd + buffer, next grid) so the next slot starts right after it.
              let cursor = startMin;
              let blockerIndex = 0;

              while (cursor + slotMinutes <= endMin) {
                const slotEnd = cursor + slotMinutes;

                while (
                  blockerIndex < allBlockers.length &&
                  allBlockers[blockerIndex].end <= cursor
                ) {
                  blockerIndex++;
                }

                const nextBlocker =
                  blockerIndex < allBlockers.length
                    ? allBlockers[blockerIndex]
                    : null;

                if (!nextBlocker || nextBlocker.start >= slotEnd) {
                  finalSlots.push({
                    start: this.minutesToIso(dateStr, cursor),
                    end: this.minutesToIso(dateStr, slotEnd),
                    clinicAvailabilityId: availId,
                    source: 'availability',
                    status: 'available',
                  });
                  cursor = slotEnd + bufferMinutes;
                  continue;
                }

                // Emit the booked/break block (clipped to [cursor, endMin])
                const blockStart = Math.max(nextBlocker.start, cursor);
                const blockEnd = Math.min(nextBlocker.end, endMin);

                if (blockStart < blockEnd) {
                  if (nextBlocker.type === 'appointment') {
                    finalSlots.push({
                      start: this.minutesToIso(dateStr, blockStart),
                      end: this.minutesToIso(dateStr, blockEnd),
                      clinicAvailabilityId: availId,
                      source: 'appointment',
                      status: occupancy(nextBlocker.data.status),
                      appointmentId: nextBlocker.data.id,
                      appointmentStatus: nextBlocker.data.status,
                      patientId: nextBlocker.data.patientId,
                    });
                  } else {
                    finalSlots.push({
                      start: this.minutesToIso(dateStr, blockStart),
                      end: this.minutesToIso(dateStr, blockEnd),
                      clinicAvailabilityId: availId,
                      source: 'break',
                      status: 'break',
                      breakId: nextBlocker.data.id,
                      breakType: nextBlocker.data.breakType,
                    });
                  }
                }

                cursor = blockEnd + bufferMinutes;
                blockerIndex++;
              }
            }
          }
        }
      }
    }

    // onlyOccupied callers want appointments only, not free or break slots.
    if ((query as any).onlyOccupied ?? false) {
      finalSlots = finalSlots.filter((x) => x.source === 'appointment');
    }

    // Today only: drop time slots that started before the caller's current time (IST).
    const thresholdTime = query.time;
    if (!isTokenBooking && thresholdTime && dateStr) {
      const thresholdMinutes = hhmmToMinutes(thresholdTime);
      if (thresholdMinutes !== null) {
        if (dateStr === getISTDateString()) {
          finalSlots = finalSlots.filter((s) => {
            const slotTimePart = s.start.split('T')[1];
            const slotMinutes = hhmmToMinutes(slotTimePart);
            return slotMinutes !== null && slotMinutes >= thresholdMinutes;
          });
        }
      }
    }

    finalSlots.sort((a, b) => (a.start < b.start ? -1 : 1));

    const result: {
      slots: Slot[];
      shifts?: string[];
      tokensNotSet?: boolean;
    } = {
      slots: finalSlots,
    };

    if (shifts.length > 0) result.shifts = shifts;
    if (tokensNotSet) result.tokensNotSet = true;

    return result;
  }
}
