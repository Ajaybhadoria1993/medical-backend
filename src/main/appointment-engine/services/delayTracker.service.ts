import { and, eq, gte, lt } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  getCurrentAppointmentId,
  getNextAppointmentIds,
  getConsultationStartedAt,
  getConsultationEndedAt,
  getHeldAppointments,
} from './queueHoldStore.service';
import {
  ClinicAvailability,
  ClinicDateAvailability,
  ClinicDateAvailabilityTimeSlots,
  ClinicAvailabilityBreak,
} from '../../clinic/models/clinic.model';
import {
  AppointmentDelayEntry,
  QueueDelayData,
  IN_CONSULTATION,
} from '../types/engine.types';
import {
  BreakWindow,
  deriveWindowGaps,
  effectiveAppointmentTime,
  getRedisKey,
  isTerminalStatus,
  normalizeBreaks,
  resolveAppointmentDuration,
  shiftPastBreaks,
} from '../utils/helpers';
import {
  getISTDateString,
  getISTDayName,
  getISTHoursMinutes,
  startOfDayIST,
} from '../../../utils/istDateTime';
import { orderLikeBoard } from '../utils/queueBoard';
import { fetchDoctorDayQueue } from './dayQueue.service';
import { SessionOverrideService } from './sessionOverride.service';
import { ConsultationDurationService } from './consultationDuration.service';
import { DoctorArrivalModel } from '../models/doctorArrival.model';

/** A gap this long between two blocks is a separate sitting needing its own arrival, not lunch. */
const SEPARATE_SITTING_GAP_MINUTES = 120;

const DELAY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** Computes and caches delay data for a doctor's daily queue (time- or token-based). */
export class DelayTrackerService {
  /** Walks the day's queue cascading projectedStart = max(slot, previous end); cached 24h. */
  async recalculate(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<QueueDelayData> {
    // Token order; walked below in the board's order (see orderLikeBoard).
    const [dayQueue, priorityIds] = await Promise.all([
      this.fetchDailyQueue(clinicId, doctorId, date),
      getNextAppointmentIds(clinicId, doctorId, date),
    ]);

    // The room is a Redis pointer, not a stored status; one left on a finished visit is ignored.
    const pointerId = await getCurrentAppointmentId(clinicId, doctorId, date);
    const currentAppointmentId = dayQueue.some(
      (a) => a.id === pointerId && !isTerminalStatus(a.appointmentStatus)
    )
      ? pointerId
      : null;

    // Real wall-clock start, for an accurate elapsed-time display — only
    // meaningful when someone is actually in the room.
    const consultationStartedAt = currentAppointmentId
      ? await getConsultationStartedAt(clinicId, doctorId, date)
      : null;

    // When the doctor last became free: an empty room projects from then, not the planned slot end.
    const endedAtIso = currentAppointmentId
      ? null
      : await getConsultationEndedAt(clinicId, doctorId, date);
    const freeSinceMinutes = (() => {
      if (!endedAtIso) return null;
      const endedAt = new Date(endedAtIso);
      if (isNaN(endedAt.getTime())) return null;
      const { hours, minutes } = getISTHoursMinutes(endedAt);
      return hours * 60 + minutes;
    })();

    // Held/skipped is a Redis flag (DB status stays Patient Arrived); they don't push others later.
    const heldAppointments = await getHeldAppointments(
      clinicId,
      doctorId,
      date
    );

    // Walk in the reception board's order, so the estimates and "patients
    // ahead" follow whoever reception will actually call next.
    const appointments = orderLikeBoard(
      dayQueue,
      currentAppointmentId,
      heldAppointments,
      priorityIds
    );
    /** The status the engine sees: in-room (not `Confirmed`, a stored booking status) beats stored. */
    const engineStatus = (appt: { id: string; appointmentStatus: string }) =>
      appt.id === currentAppointmentId
        ? IN_CONSULTATION
        : appt.appointmentStatus;

    // Slot duration and session start come from the same availability rows —
    // resolved together so the queue costs one cache lookup, not two.
    const {
      slotMinutes,
      sessionStartMinutes: resolvedSessionStart,
      breaks,
    } = await this.resolveDayConfig(clinicId, doctorId, date);

    const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes();
    const nowMinutes = istHours * 60 + istMinutes;

    // No hours configured today: anchor tokens at now, since unknown hours can't make anyone late.
    const sessionStartMinutes = resolvedSessionStart ?? nowMinutes;

    // Where each shift opens, so a token schedules from its own session's
    // start rather than the day's — see deriveSessionStarts.
    const sessionStarts = this.deriveSessionStarts(sessionStartMinutes, breaks);

    // The queue pointer, not a status: "Patient Arrived" is only checked-in, and
    // counting it would let a patient's own status suppress their delay.
    const isAnyoneBeingServed = appointments.some(
      (a) =>
        !isTerminalStatus(a.appointmentStatus) && a.id === currentAppointmentId
    );

    // Token slots follow serving order, so whoever reception calls next gets the
    // next slot. Keyed by id: identity-based indexOf broke once rows were copied.
    const indexOfAppointment = new Map(appointments.map((a, i) => [a.id, i]));

    // Staff-announced delay is a floor: a worse measured delay still wins.
    const announcedDelayMinutes = await SessionOverrideService.getActiveMinutes(
      clinicId,
      doctorId,
      date
    );

    // Measured consultation length, read once per queue rather than per row.
    const consultationDuration =
      await ConsultationDurationService.resolveForDoctor(clinicId, doctorId);
    const durationFallbacks = {
      // Measured and doctor-configured are both statements about *this*
      // doctor, so both outrank the booking grid.
      doctorMinutes:
        consultationDuration.basis === 'learned' ||
        consultationDuration.basis === 'doctor'
          ? consultationDuration.minutes
          : null,
      // A clinic-wide number is less specific than this doctor's own slot
      // size, so it sits below it in the chain.
      clinicMinutes:
        consultationDuration.basis === 'clinic'
          ? consultationDuration.minutes
          : null,
    };

    // Only a length the doctor set themselves, never a learned one: a figure
    // that moves on its own must not move the baseline delay is measured from.
    const configuredMinutes =
      consultationDuration.basis === 'doctor'
        ? consultationDuration.minutes
        : null;

    // The chain a row without its own duration resolves through, so the
    // published figure and the spacing on screen can never disagree.
    const resolvedMinutes = resolveAppointmentDuration(
      null,
      slotMinutes,
      durationFallbacks
    );
    const effectiveConsultationMinutes = {
      minutes: resolvedMinutes,
      basis:
        resolvedMinutes === consultationDuration.minutes
          ? consultationDuration.basis
          : slotMinutes === resolvedMinutes
            ? 'slot'
            : 'default',
    };

    // Walk the queue and compute delay data
    const delayEntries: AppointmentDelayEntry[] = [];
    let previousProjectedEnd: number | null = null;
    let cumulativeDelayMinutes = 0;
    /** Last session walked, to reset the cascade at a shift boundary. */
    let previousSessionIndex: number | null | undefined = undefined;

    // A shift token's stored time is not a slot (the app saves the shift start as it was at
    // booking), so it's due at its place in line under today's hours. Custom slots have no shift.
    const scheduledMinutesFor = (appt: (typeof appointments)[number]) => {
      const isShiftToken = appt.tokenNo != null && appt.sessionIndex != null;
      const stored = isShiftToken
        ? null
        : parseTimeToMinutes(effectiveAppointmentTime(appt));
      return (
        stored ??
        this.computeTokenScheduledMinutes(
          indexOfAppointment.get(appt.id) ?? 0,
          appointments,
          slotMinutes,
          sessionStarts,
          breaks,
          configuredMinutes
        )
      );
    };

    for (const appt of appointments) {
      const duration = resolveAppointmentDuration(
        appt.appointmentDurationMinutes,
        slotMinutes,
        durationFallbacks
      );

      // A new shift starts fresh: a late morning must not drag the evening's first token.
      if (
        previousSessionIndex !== undefined &&
        appt.sessionIndex != null &&
        previousSessionIndex != null &&
        appt.sessionIndex !== previousSessionIndex
      ) {
        previousProjectedEnd = null;
      }
      previousSessionIndex = appt.sessionIndex ?? null;

      const holdReason = heldAppointments.get(appt.id);
      const isHeld = Boolean(holdReason);

      if (isTerminalStatus(appt.appointmentStatus) || isHeld) {
        // Terminal and held rows are listed but don't cascade onto anyone behind them.
        const anchorTime = minutesToTimeString(scheduledMinutesFor(appt));
        delayEntries.push({
          appointmentId: appt.id,
          patientId: appt.patientId,
          userId: appt.patientId,
          status: engineStatus(appt) as AppointmentDelayEntry['status'],
          scheduledTime: anchorTime,
          tokenNo: appt.tokenNo ?? null,
          sessionIndex: appt.sessionIndex ?? null,
          // Their own slot as an anchor; `isOnHold` tells clients it isn't an estimate.
          projectedStartTime: anchorTime,
          estimatedWaitMinutes: 0,
          durationMinutes: duration,
          isOnHold: isHeld,
          holdReason,
          startedAt:
            appt.id === currentAppointmentId ? consultationStartedAt : null,
          arrivedAt: appt.arrivedAt ? appt.arrivedAt.toISOString() : null,
        });
        continue;
      }

      // Tokens (and unparseable times) derive a slot from the shift start plus everyone ahead.
      const scheduledMinutes = scheduledMinutesFor(appt);

      // Compute projected start
      let projectedStartMinutes: number;

      if (previousProjectedEnd === null) {
        // First in line and the slot has passed without a start: project from now.
        if (!isAnyoneBeingServed && nowMinutes > scheduledMinutes) {
          projectedStartMinutes = nowMinutes;
        } else if (!isAnyoneBeingServed && freeSinceMinutes !== null) {
          // Doctor free early with an empty room: the next patient can start then.
          projectedStartMinutes = Math.min(scheduledMinutes, freeSinceMinutes);
        } else {
          projectedStartMinutes = scheduledMinutes;
        }

        // Apply the announced delay as a floor (see announcedDelayMinutes above).
        if (announcedDelayMinutes > 0) {
          projectedStartMinutes = Math.max(
            projectedStartMinutes,
            scheduledMinutes + announcedDelayMinutes
          );
        }
      } else {
        // Projected start = max(scheduled time, previous projected end)
        projectedStartMinutes = Math.max(
          scheduledMinutes,
          previousProjectedEnd
        );
      }

      // A start inside a break moves past it; not for numbered shifts, whose end is that break.
      if (appt.sessionIndex == null) {
        projectedStartMinutes = shiftPastBreaks(projectedStartMinutes, breaks);
      }

      const isBeingSeenNow = appt.id === currentAppointmentId;

      // The room occupant runs from when they actually went in, so the next
      // patient waits out the full consultation, not just until "now".
      if (isBeingSeenNow && consultationStartedAt) {
        const started = new Date(consultationStartedAt);
        if (!isNaN(started.getTime())) {
          const { hours, minutes } = getISTHoursMinutes(started);
          projectedStartMinutes = hours * 60 + minutes;
        }
      }

      // Nobody waiting can be seen in the past; the patient in the room is the exception.
      if (!isBeingSeenNow) {
        projectedStartMinutes = Math.max(projectedStartMinutes, nowMinutes);
      }

      // Missed only once the projection runs past the NEXT sitting's start; the gap
      // before it is usable overflow. The last or only sitting never closes early.
      let isMissedSession = false;
      if (!isBeingSeenNow && appt.sessionIndex != null) {
        const nextStart = sessionStarts[appt.sessionIndex];
        if (nextStart !== undefined && projectedStartMinutes > nextStart) {
          isMissedSession = true;
        }
      }

      // Estimated wait = max(0, projectedStart - scheduledTime)
      const estimatedWaitMinutes = Math.max(
        0,
        projectedStartMinutes - scheduledMinutes
      );

      // An ongoing consultation ends no earlier than now, so an overrun pushes everyone behind.
      previousProjectedEnd = isBeingSeenNow
        ? Math.max(projectedStartMinutes + duration, nowMinutes)
        : projectedStartMinutes + duration;

      // Track cumulative delay (will be the last non-terminal's delay)
      cumulativeDelayMinutes = estimatedWaitMinutes;

      delayEntries.push({
        appointmentId: appt.id,
        patientId: appt.patientId,
        userId: appt.patientId,
        status: engineStatus(appt) as AppointmentDelayEntry['status'],
        // Tokens publish their derived slot; the running-late check needs a time to compare.
        scheduledTime: minutesToTimeString(scheduledMinutes),
        tokenNo: appt.tokenNo ?? null,
        sessionIndex: appt.sessionIndex ?? null,
        projectedStartTime: minutesToTimeString(projectedStartMinutes),
        isMissedSession,
        estimatedWaitMinutes,
        isOnHold: false,
        durationMinutes: duration,
        startedAt: isBeingSeenNow ? consultationStartedAt : null,
        arrivedAt: appt.arrivedAt ? appt.arrivedAt.toISOString() : null,
      });
    }

    const queueDelayData: QueueDelayData = {
      clinicId,
      doctorId,
      date,
      cumulativeDelayMinutes,
      lastCalculatedAt: new Date().toISOString(),
      appointments: delayEntries,
      // What the projection actually spaced patients by, not what the
      // service alone answered — the slot outranks a clinic-wide default.
      consultationBasis: effectiveConsultationMinutes.basis,
      consultationMinutes: effectiveConsultationMinutes.minutes,
      consultationSampleSize: consultationDuration.sampleSize,
      doctorArrived: await this.readDoctorArrival(
        doctorId,
        date,
        delayEntries,
        resolvedSessionStart,
        breaks ?? [],
        nowMinutes
      ),
    };

    // Store in Redis with 24h TTL
    await this.storeInRedis(queueDelayData);

    return queueDelayData;
  }

  /** Clock-shift arrival, plus each entry's own: its token shift, or its sitting on a time day. Fails open. */
  private async readDoctorArrival(
    doctorId: string,
    date: string,
    entries: AppointmentDelayEntry[],
    dayStartMinutes: number | null,
    breaks: BreakWindow[],
    nowMinutes: number
  ): Promise<boolean> {
    try {
      // Shifts come from the cached day config the recalculation already holds.
      const dayBreaks =
        dayStartMinutes === null
          ? []
          : breaks.filter((b) => b.endMinutes > dayStartMinutes);
      const starts = [
        dayStartMinutes ?? 0,
        ...dayBreaks.map((b) => b.endMinutes),
      ];
      const sessionAt = (minutes: number) =>
        dayBreaks.filter((b) => b.startMinutes <= minutes).length;
      // ponytail: schedules don't say lunch vs second sitting, so a long gap means a new sitting; add a flag if this misfires.
      const sittingOf = [0];
      for (const b of dayBreaks) {
        const long =
          b.endMinutes - b.startMinutes >= SEPARATE_SITTING_GAP_MINUTES;
        sittingOf.push(sittingOf[sittingOf.length - 1] + (long ? 1 : 0));
      }

      const rows = await database
        .select({ sessionStart: DoctorArrivalModel.sessionStart })
        .from(DoctorArrivalModel)
        .where(
          and(
            eq(DoctorArrivalModel.doctorId, doctorId),
            eq(DoctorArrivalModel.forDate, date)
          )
        );
      const arrivedSessions = new Set(
        rows.map((r) =>
          r.sessionStart == null
            ? 0
            : starts.indexOf(parseTimeToMinutes(r.sessionStart) ?? -1)
        )
      );
      arrivedSessions.delete(-1);
      if (starts.length < 2) return rows.length > 0;
      const arrivedSittings = new Set(
        [...arrivedSessions].map((i) => sittingOf[i])
      );

      for (const entry of entries) {
        if (entry.sessionIndex != null) {
          entry.doctorArrived = arrivedSessions.has(entry.sessionIndex - 1);
          continue;
        }
        const slot = parseTimeToMinutes(entry.scheduledTime);
        if (slot === null) continue;
        entry.doctorArrived = arrivedSittings.has(sittingOf[sessionAt(slot)]);
      }
      return arrivedSittings.has(sittingOf[sessionAt(nowMinutes)]);
    } catch (error) {
      logger.warn(
        `[DelayTracker] Arrival read failed for doctor=${doctorId} date=${date}`,
        { error }
      );
      return true;
    }
  }

  /** One appointment's wait: its own cache key, then the queue cache, then a recalculation; 0 if absent. */
  async getEstimatedWaitTime(appointmentId: string): Promise<number> {
    // Step 1: Try per-appointment cache key (fastest path — no DB query)
    try {
      const waitKey = getRedisKey('wait', appointmentId);
      const waitRaw = await redisClient.get(waitKey);

      if (waitRaw) {
        const waitData = JSON.parse(waitRaw);
        return waitData.estimatedWaitMinutes ?? 0;
      }
    } catch {
      // Redis unavailable or parse error — fall through to full lookup
    }

    // Step 2: Look up the appointment to get clinicId, doctorId, date
    const [appointment] = await database
      .select({
        clinicId: AppointmentModel.clinicId,
        doctorId: AppointmentModel.doctorId,
        appointmentDate: AppointmentModel.appointmentDate,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment || !appointment.doctorId) {
      return 0;
    }

    const date = getISTDateString(appointment.appointmentDate);

    // Step 3: Try to read from full queue Redis cache
    let delayData: QueueDelayData | null = null;

    try {
      delayData = await this.getQueueDelayData(
        appointment.clinicId,
        appointment.doctorId,
        date
      );
    } catch {
      // Redis unavailable — will fall through to on-the-fly computation
    }

    if (delayData) {
      const entry = delayData.appointments.find(
        (a) => a.appointmentId === appointmentId
      );
      return entry?.estimatedWaitMinutes ?? 0;
    }

    // Step 4: Redis unavailable or no data — compute on-the-fly from DB
    logger.warn(
      `[DelayTracker] Redis cache miss for appointment ${appointmentId}. Computing delay on-the-fly from DB.`
    );

    const computedData = await this.recalculate(
      appointment.clinicId,
      appointment.doctorId,
      date
    );

    const entry = computedData.appointments.find(
      (a) => a.appointmentId === appointmentId
    );
    return entry?.estimatedWaitMinutes ?? 0;
  }

  /** Full queue delay data from Redis, or null if absent/unavailable. */
  async getQueueDelayData(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<QueueDelayData | null> {
    const key = getRedisKey('delay', clinicId, doctorId, date);

    try {
      const raw = await redisClient.get(key);

      if (!raw) {
        return null;
      }

      const data: QueueDelayData = JSON.parse(raw);
      return data;
    } catch (error) {
      logger.warn(
        `[DelayTracker] Failed to read delay data from Redis for key=${key}. Returning null.`,
        { error }
      );
      return null;
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /** The same day query the reception board reads; kept as a method so tests can stub it. */
  private fetchDailyQueue(clinicId: string, doctorId: string, date: string) {
    return fetchDoctorDayQueue(clinicId, doctorId, date);
  }

  /** Slot length: Redis (1h), then date availability, then weekly availability; null if none. */
  async resolveSlotMinutes(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<number | null> {
    return (await this.resolveDayConfig(clinicId, doctorId, date)).slotMinutes;
  }

  /**
   * Resolves slot duration AND session start in one pass.
  
   */
  private async resolveDayConfig(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<{
    slotMinutes: number | null;
    sessionStartMinutes: number | null;
    sessionEndMinutes: number | null;
    breaks: BreakWindow[];
  }> {
    const cacheKey = getRedisKey('day_config', clinicId, doctorId, date);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          slotMinutes: parsed.slotMinutes ?? null,
          sessionStartMinutes: parsed.sessionStartMinutes ?? null,
          // Entries written before the day's end was recorded simply lack it;
          // the final shift is then left unclamped rather than cut at a guess.
          sessionEndMinutes: parsed.sessionEndMinutes ?? null,
          // Entries written before breaks existed simply lack the field.
          breaks: Array.isArray(parsed.breaks) ? parsed.breaks : [],
        };
      }
    } catch {
      // Redis unavailable or corrupt entry — fall through to DB
    }

    const startOfDay = startOfDayIST(date);
    const nextDay = new Date(startOfDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    // Date-specific availability and its time slots in a single round trip.
    // LEFT JOIN so a date row with no slots still yields its slotMinutes.
    const dateRows = await database
      .select({
        slotMinutes: ClinicDateAvailability.slotMinutes,
        slotStart: ClinicDateAvailabilityTimeSlots.startTime,
        slotEnd: ClinicDateAvailabilityTimeSlots.endTime,
        slotAvailable: ClinicDateAvailabilityTimeSlots.isAvailable,
      })
      .from(ClinicDateAvailability)
      .leftJoin(
        ClinicDateAvailabilityTimeSlots,
        eq(
          ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
          ClinicDateAvailability.id
        )
      )
      .where(
        and(
          eq(ClinicDateAvailability.clinicId, clinicId),
          eq(ClinicDateAvailability.doctorId, doctorId),
          gte(ClinicDateAvailability.date, startOfDay),
          lt(ClinicDateAvailability.date, nextDay)
        )
      );

    let slotMinutes: number | null = dateRows[0]?.slotMinutes || null;
    let sessionStartMinutes: number | null = null;
    let sessionEndMinutes: number | null = null;

    // Each date slot is a working window; the gap between two shifts is not working time.

    const dateWindows: Array<{ start: number; end: number }> = [];

    for (const row of dateRows) {
      if (row.slotAvailable === false) continue;
      const mins = parseTimeToMinutes(row.slotStart);
      if (
        mins !== null &&
        (sessionStartMinutes === null || mins < sessionStartMinutes)
      ) {
        sessionStartMinutes = mins;
      }

      const endMins = parseTimeToMinutes(row.slotEnd);
      // The day closes when its last window does, mirroring how the start is
      // taken from the earliest.
      if (
        endMins !== null &&
        (sessionEndMinutes === null || endMins > sessionEndMinutes)
      ) {
        sessionEndMinutes = endMins;
      }

      if (mins !== null && endMins !== null && endMins > mins) {
        dateWindows.push({ start: mins, end: endMins });
      }
    }

    // A split shift for this date shows up only as the gap between its slots.
    const dateGapBreaks = deriveWindowGaps(dateWindows);

    // Always fetched, not just as a fallback: breaks hang off the weekly row,
    // so short-circuiting here would silently lose them. Cached for an hour.
    const dayOfWeek = getISTDayName(date);
    const weekdayRows = await database
      .select({
        slotMinutes: ClinicAvailability.slotMinutes,
        startTime: ClinicAvailability.startTime,
        endTime: ClinicAvailability.endTime,
        breaksStart: ClinicAvailability.breaksStart,
        breaksEnd: ClinicAvailability.breaksEnd,
        breakStart: ClinicAvailabilityBreak.startTime,
        breakEnd: ClinicAvailabilityBreak.endTime,
        breakActive: ClinicAvailabilityBreak.status,
      })
      .from(ClinicAvailability)
      .leftJoin(
        ClinicAvailabilityBreak,
        eq(ClinicAvailabilityBreak.clinicAvailabilityId, ClinicAvailability.id)
      )
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId),
          eq(ClinicAvailability.dayOfWeek, dayOfWeek)
        )
      );

    const weekday = weekdayRows[0];

    slotMinutes = slotMinutes ?? weekday?.slotMinutes ?? null;
    sessionStartMinutes =
      sessionStartMinutes ?? parseTimeToMinutes(weekday?.startTime ?? null);
    sessionEndMinutes =
      sessionEndMinutes ?? parseTimeToMinutes(weekday?.endTime ?? null);

    // Inline and typed breaks are merged so one lunch defined twice counts once.
    const rawBreaks: Array<{
      startMinutes: number | null;
      endMinutes: number | null;
    }> = [];

    if (weekday) {
      rawBreaks.push({
        startMinutes: parseTimeToMinutes(weekday.breaksStart),
        endMinutes: parseTimeToMinutes(weekday.breaksEnd),
      });
    }

    for (const row of weekdayRows) {
      if (row.breakActive === false) continue;
      rawBreaks.push({
        startMinutes: parseTimeToMinutes(row.breakStart),
        endMinutes: parseTimeToMinutes(row.breakEnd),
      });
    }

    // This date's split-shift gap; merged so it doesn't double-count the weekly lunch.

    rawBreaks.push(...dateGapBreaks);

    const breaks = normalizeBreaks(rawBreaks);

    const result = {
      slotMinutes,
      sessionStartMinutes,
      sessionEndMinutes,
      breaks,
    };
    await redisClient
      .set(cacheKey, JSON.stringify(result), 'EX', 3600)
      .catch(() => {});

    return result;
  }

  /** Each shift's start (minutes): shift 1 at day start, shift N+1 where break N ends. */
  private deriveSessionStarts(
    dayStartMinutes: number,
    // Older cached configs have no breaks list.
    breaks?: BreakWindow[] | null
  ): number[] {
    const starts = [dayStartMinutes];
    if (!Array.isArray(breaks)) return starts;
    for (const b of breaks) {
      if (b.endMinutes > dayStartMinutes) starts.push(b.endMinutes);
    }
    return starts;
  }

  /** Token slot: its shift's start plus every non-terminal booking ahead of it in that shift. */
  private computeTokenScheduledMinutes(
    currentIndex: number,
    allAppointments: Array<{
      appointmentDurationMinutes: string | null;
      appointmentStatus: string;
      sessionIndex?: number | null;
    }>,
    slotMinutes: number | null,
    sessionStarts: number[],
    breaks: BreakWindow[] = [],
    /** A length the doctor set for themselves; never a learned one. */
    configuredMinutes: number | null = null
  ): number {
    const currentSession = allAppointments[currentIndex]?.sessionIndex ?? null;
    // A shift beyond the schedule falls back to the day's start, not 00:00.
    let cumulativeMinutes =
      (currentSession != null
        ? sessionStarts[currentSession - 1]
        : undefined) ??
      sessionStarts[0] ??
      0;

    for (let i = 0; i < currentIndex; i++) {
      if (isTerminalStatus(allAppointments[i].appointmentStatus)) continue;
      if (
        currentSession != null &&
        (allAppointments[i].sessionIndex ?? null) !== currentSession
      ) {
        continue;
      }
      // The slot steps over breaks like the projection, or lunch would read as lateness.
      cumulativeMinutes = shiftPastBreaks(cumulativeMinutes, breaks);
      // A doctor-set length spaces the nominal grid; a learned one never does,
      // since that would shift the baseline the delay is measured from.
      cumulativeMinutes += resolveAppointmentDuration(
        allAppointments[i].appointmentDurationMinutes,
        slotMinutes,
        { doctorMinutes: configuredMinutes }
      );
    }

    // A slot landing in a break belongs after it, which puts shift 2's token 1 at its start.
    return shiftPastBreaks(cumulativeMinutes, breaks);
  }

  /** Caches queue data (24h) with a Lua compare-and-set so an older result never overwrites a newer one. */
  private async storeInRedis(data: QueueDelayData): Promise<void> {
    const key = getRedisKey('delay', data.clinicId, data.doctorId, data.date);

    try {
      const luaScript = `
                local current = redis.call('GET', KEYS[1])
                local newVersion = tonumber(ARGV[2])
                if current then
                    local ok, decoded = pcall(cjson.decode, current)
                    if ok and decoded.version and tonumber(decoded.version) >= newVersion then
                        return 0
                    end
                end
                redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
                return 1
            `;

      // Versioned by timestamp: two instances incrementing would compute the same next value.
      const newVersion = Date.parse(data.lastCalculatedAt);

      const payload = JSON.stringify({ ...data, version: newVersion });

      const result = await redisClient.eval(
        luaScript,
        1,
        key,
        payload,
        String(newVersion),
        String(DELAY_TTL_SECONDS)
      );

      if (result === 0) {
        logger.warn(
          `[DelayTracker] Stale version detected for key=${key}. Skipping write — a newer version already exists.`
        );
      } else {
        // Queue data was written successfully — write per-appointment cache keys
        await this.storePerAppointmentCache(data);
      }
    } catch (error) {
      logger.warn(
        `[DelayTracker] Failed to store delay data in Redis for key=${key}. Computed data returned to caller.`,
        { error }
      );
    }
  }

  /** Per-appointment wait keys (24h), so the patient detail API needs one Redis GET. */
  private async storePerAppointmentCache(data: QueueDelayData): Promise<void> {
    const pipeline = redisClient.pipeline();

    for (const entry of data.appointments) {
      if (isTerminalStatus(entry.status)) {
        continue;
      }

      const waitKey = getRedisKey('wait', entry.appointmentId);
      const waitPayload = JSON.stringify({
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        status: entry.status,
        appointmentTime: entry.scheduledTime,
        projectedStartTime: entry.projectedStartTime,
        lastUpdated: data.lastCalculatedAt,
      });

      pipeline.set(waitKey, waitPayload, 'EX', DELAY_TTL_SECONDS);
    }

    try {
      await pipeline.exec();
    } catch (error) {
      logger.warn(
        `[DelayTracker] Failed to write per-appointment cache keys for clinic=${data.clinicId}, doctor=${data.doctorId}`,
        { error }
      );
    }
  }
}

// ─── Local Helper Functions ───────────────────────────────────────────────────

/** Time label to minutes since midnight; null when absent, since 0 is a real time. */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const t = time.trim();
  if (!t) return null;

  // Handle 12-hour format with AM/PM
  const ampmMatch = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2] ?? 0);
    const ampm = ampmMatch[3].toLowerCase();
    if (hour === 12 && ampm === 'am') hour = 0;
    if (hour !== 12 && ampm === 'pm') hour += 12;
    return hour * 60 + min;
  }

  // Handle 24-hour format HH:MM or HH:MM:SS
  const hhmmMatch = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmMatch) {
    const hour = Number(hhmmMatch[1]);
    const min = Number(hhmmMatch[2]);
    return hour * 60 + min;
  }

  return null;
}

/** Minutes since midnight to "HH:MM". */
function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}
