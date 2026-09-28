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

const DELAY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** Computes and caches delay data for a doctor's daily queue (time- or token-based). */
export class DelayTrackerService {
  /**
   * Recalculates estimated wait and cumulative delay for all non-terminal
   * appointments, by walking the queue in order and cascading
   * projectedStart = max(scheduledTime, previousProjectedEnd). Cached 24h.
   */
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

    // Who is with the doctor: a Redis pointer, not `appointmentStatus` —
    // marking the row `Confirmed` would claim the *booking* was confirmed,
    // which shows up in activity entries and reports. Stamped onto the
    // engine's own view below, so downstream status readers are unaffected.
    const currentAppointmentId = await getCurrentAppointmentId(
      clinicId,
      doctorId,
      date
    );

    // Real wall-clock start, for an accurate elapsed-time display — only
    // meaningful when someone is actually in the room.
    const consultationStartedAt = currentAppointmentId
      ? await getConsultationStartedAt(clinicId, doctorId, date)
      : null;

    // When the doctor last became free, in minutes since midnight. Only read
    // for an empty room, so the queue projects from when they actually
    // finished rather than the planned end of a slot they beat.
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

    // Who is paused (Hold or Skip) — a Redis flag, since a held patient's DB
    // status stays `Patient Arrived`. Excluded from the cascade below: a
    // paused patient isn't progressing, so they must not push others later
    // or count as "ahead" of them.
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
    /** The status the engine should see for one row: in-room beats stored. */
    // Not `Confirmed`: that is a real persisted booking status, so stamping it
    // here hid the difference from the patient actually in the room.
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

    // No known start (no weekly or date availability for today): anchor the
    // token grid at now. Midnight made every token "~17 hours late" and pushed
    // that as a running-late alert; unknown hours can't make anyone late.
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

    // A staff-announced delay ("running 30 minutes behind") — the only signal
    // for a doctor stuck in surgery who never touched the app. Applied as a
    // floor, never a replacement, so a worse measured delay still wins; the
    // rest of the queue inherits it through the cascade.
    const announcedDelayMinutes = await SessionOverrideService.getActiveMinutes(
      clinicId,
      doctorId,
      date
    );

    // How long this doctor actually takes, measured from completed
    // consultations rather than assumed from the booking slot. Resolved once
    // per queue, not per appointment — it is a property of the doctor, and the
    // Redis cache behind it would otherwise be read once per row.
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
    /**
     * The session most recently walked, so a boundary crossing can be
     * detected and the cascade reset — see the reset block below.
     */
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

      // A new shift doesn't continue the last one's delay: otherwise a
      // morning clinic running two hours late dragged the unrelated evening
      // session's first token with it. Reset only on a real session change —
      // a null session is one undivided queue.
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
        // Terminal and held appointments stay in the entries but not the
        // timeline — neither is going to be seen next, so neither may cascade
        // onto whoever is behind. Times derived as usual so they don't
        // surface as 00:00.
        // Always published as HH:MM: "13:00:00" beside "13:00" is the
        // inconsistency that reached the patient payload.
        const anchorTime = minutesToTimeString(scheduledMinutesFor(appt));
        delayEntries.push({
          appointmentId: appt.id,
          patientId: appt.patientId,
          userId: appt.patientId,
          status: engineStatus(appt) as AppointmentDelayEntry['status'],
          scheduledTime: anchorTime,
          tokenNo: appt.tokenNo ?? null,
          sessionIndex: appt.sessionIndex ?? null,
          // The anchor, not a live projection: a held patient has no scheduled
          // moment to resume at, and `isOnHold` tells the client not to read
          // this as an estimate (see AppointmentDelayEntry.isOnHold).
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

      // Resolve scheduled time in minutes since midnight. A token appointment
      // has no appointmentTime, so its slot is derived from the session start
      // plus everyone ahead of it. An appointment that claims a time but whose
      // value is unparseable falls back to the same derivation rather than
      // silently becoming midnight.
      const scheduledMinutes = scheduledMinutesFor(appt);

      // Compute projected start
      let projectedStartMinutes: number;

      if (previousProjectedEnd === null) {
        // First non-terminal appointment: if the doctor hasn't started and is
        // past the scheduled time, project from now. Token queues included —
        // they carry a real scheduled time, so excluding them pinned them to
        // zero delay.
        if (!isAnyoneBeingServed && nowMinutes > scheduledMinutes) {
          projectedStartMinutes = nowMinutes;
        } else if (!isAnyoneBeingServed && freeSinceMinutes !== null) {
          // Doctor finished early and the room is still empty: a doctor free
          // since 12:40 can start the 13:00 patient then. Only ever moves a
          // start forward, and only from a recorded end.
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

      // A projected start landing inside a break moves to its end, after the
      // cascade so the push propagates to everyone behind.
      //
      // Skipped for a numbered session: its end *is* the following break, so
      // shifting past it would relocate a late morning token into the evening
      // shift, colliding with that shift's own token 1. Those are confined by
      // the clamp below instead; sessionless days are one continuous queue.
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

      // Nobody still waiting can be seen in the past: otherwise a doctor
      // still on the 13:00 patient at 15:46 projected 13:00 → 13:30 → …, and
      // every waiting patient reported zero delay. The patient in the room is
      // excluded — their start really is in the past.
      if (!isBeingSeenNow) {
        projectedStartMinutes = Math.max(projectedStartMinutes, nowMinutes);
      }

      // A projection past its own shift's end is a missed appointment, not a
      // booking in the next shift — those minutes belong to the next shift's
      // own token holders. Flagged rather than blanked so the row can read
      // "(Missed)" with a time behind it. Sessioned appointments only.
      let isMissedSession = false;
      if (appt.sessionIndex != null && !isBeingSeenNow) {
        // Only the next sitting's start closes this one; the gap before it is usable overflow.
        // The last (or only) sitting has nothing after it, so its patients just keep waiting.
        const nextStart = sessionStarts[appt.sessionIndex] ?? null;
        if (nextStart !== null && projectedStartMinutes > nextStart) {
          isMissedSession = true;
        }
      }

      // Estimated wait = max(0, projectedStart - scheduledTime)
      const estimatedWaitMinutes = Math.max(
        0,
        projectedStartMinutes - scheduledMinutes
      );

      // An in-progress consultation finishes no earlier than now — the patient
      // is still in the room. Everyone behind cascades from that floor, which
      // is what makes an overrunning consultation visible to the queue.
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
        // Token appointments have no stored time, so publish the derived slot.
        // RunningLateNotifier gates its real-time-delay branch on this field
        // being present — leaving it null is what suppressed running-late
        // notifications for every token-based appointment.
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
    };

    // Store in Redis with 24h TTL
    await this.storeInRedis(queueDelayData);

    return queueDelayData;
  }

  /**
   * Estimated wait for one appointment: per-appointment cache key, then the
   * full queue cache, then an on-the-fly recalculation. 0 if not found.
   */
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

  /**
   * Resolves the slot duration for this doctor/clinic/date.
   * Priority: Redis cache → ClinicDateAvailability → ClinicAvailability → null
   * Cached in Redis for 1 hour (slot config rarely changes during the day).
   */
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

    /*
     * Each available date slot is one working window. A doctor with a morning
     * and an evening shift has two, and the gap between them is not working
     * time — see `dateGapBreaks` below.
     */
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

    // Two break sources, both legitimate: the single inline window on the
    // availability row, and any number of typed rows beside it. Collected
    // together and merged so overlapping definitions of the same lunch break
    // don't get counted twice.
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

    /*
     * A split shift defined for this specific date. Added last; normalizeBreaks
     * sorts and merges, so a gap that coincides with the weekly lunch break is
     * counted once rather than twice.
     */
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

  /**
   * Start of each shift in minutes since midnight, by 1-based session number:
   * session 1 opens at the day's start, session N+1 where break N ends. Mirrors
   * `resolveDaySegmentsForTokens` without repeating its queries.
   */
  private deriveSessionStarts(
    dayStartMinutes: number,
    // Tolerates a missing list for the same reason shiftPastBreaks does: this
    // is reached from a Redis-cached day config that predates breaks, and from
    // callers that build a config object by hand.
    breaks?: BreakWindow[] | null
  ): number[] {
    const starts = [dayStartMinutes];
    if (!Array.isArray(breaks)) return starts;
    for (const b of breaks) {
      if (b.endMinutes > dayStartMinutes) starts.push(b.endMinutes);
    }
    return starts;
  }

  /**
   * Scheduled start for a token appointment: its session's start plus the
   * duration of every non-terminal appointment ahead of it in that same
   * session. Terminal rows are skipped so this matches the projection walk.
   *
   * Both halves must be session-scoped — seeding from the day's start instead
   * of the session's put a session-2 token at 09:30 rather than 17:15. A null
   * session sums from the day's start, as one undivided queue.
   */
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
    // Falls back to the day's start when this session has no derived opening
    // time — a token numbered beyond the shifts the schedule actually
    // describes, which is a data mismatch rather than a reason to return 00:00.
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
      // Skip breaks here too. Wait is `projected - scheduled`, and the
      // projection steps over lunch — if the nominal schedule didn't, a
      // 60-minute lunch would report every afternoon patient as 60 minutes
      // late. A break is part of the promised grid; consultation pace is not.
      cumulativeMinutes = shiftPastBreaks(cumulativeMinutes, breaks);
      // A doctor-set length spaces the nominal grid; a learned one never does,
      // since that would shift the baseline the delay is measured from.
      cumulativeMinutes += resolveAppointmentDuration(
        allAppointments[i].appointmentDurationMinutes,
        slotMinutes,
        { doctorMinutes: configuredMinutes }
      );
    }

    // Shift the appointment's own slot too: the last patient before lunch
    // pushes the next nominal start into the break, and it belongs after it.
    // This is what lands a second session's token 1 at its own start time.
    return shiftPastBreaks(cumulativeMinutes, breaks);
  }

  /**
   * Stores delay data in Redis (24h TTL) behind an atomic Lua compare-and-set,
   * skipping the write if a newer version is already there. Also writes the
   * per-appointment wait keys. Warns rather than throws if Redis is down.
   */
  private async storeInRedis(data: QueueDelayData): Promise<void> {
    const key = getRedisKey('delay', data.clinicId, data.doctorId, data.date);

    try {
      // Atomically set only if our version is newer than what's currently stored.
      // The Lua script reads the current version, and only writes if the new
      // version is greater, preventing stale data from overwriting fresh data.
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

      // Version comes from lastCalculatedAt, not a read-then-increment: two
      // concurrent instances would read the same value and compute the same
      // "next" one, which the Lua compare-and-set can't tell apart.
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

  /**
   * Writes `appointment_engine:wait:{appointmentId}` (24h) per non-terminal
   * appointment, so the patient detail API needs one Redis GET and no DB hit.
   */
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

/** Parses a time string into minutes since midnight; 0 if unparseable. */
/**
 * Parse a time label into minutes since midnight, or null when absent. Null
 * rather than 0, since 0 is a valid time (midnight) and coercing "missing" to
 * it produced appointments apparently scheduled at 00:00.
 */
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

/**
 * Converts minutes since midnight back to a "HH:MM" time string.
 */
function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}
