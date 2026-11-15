import { and, eq } from 'drizzle-orm';
import redisClient from '../../../configurations/redisConfig';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import { hhmmToMinutes } from '../../../utils/time.util';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { PatientFamilyLinksModel } from '../../patient/models/patientFamilyLinks.model';
import { IN_CONSULTATION } from '../types/engine.types';
import { DelayTrackerService } from './delayTracker.service';
import { RunningLateNotifier } from './runningLateNotifier.service';
import { QueueDelayData } from '../types/engine.types';
import { TERMINAL_STATUSES, isPresentStatus } from '../utils/queueBoard';
import {
  deriveQueueStage,
  minutesUntil,
  toDisplayTime,
  isTerminalStatus,
  QueueStage,
} from '../utils/helpers';
import {
  getISTDateString,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';

export interface LiveQueuePayload {
  appointmentId: string;
  tokenNo: number | null;
  /** 1-based shift; null is one undivided queue. Place in line is counted within this shift. */
  sessionIndex: number | null;
  status: string | null;
  /** Checked in or with the doctor; same rule as the reception board. */
  isCheckedIn: boolean;
  appointmentTime: string | null;
  /** Server clock (ISO) when built, so countdowns don't trust the device clock. */
  serverTime: string;
  /** True when the patient being consulted is the one this payload is for. */
  isMyTurn: boolean;
  avgConsultationMinutes: number | null;
  /** Source of `avgConsultationMinutes`: `learned` | `configured` | `slot` | `default` (30). */
  consultationBasis: string | null;
  /** Projected "HH:MM" to be seen; null when terminal, held, missed or the doctor hasn't arrived. */
  tentativeStartTime: string | null;
  /** "Give or take" minutes around `tentativeStartTime`; widens with patients ahead. */
  tentativeRangeMinutes: number | null;
  /** True whenever `tentativeStartTime` is set: an estimate, never a booked slot. */
  isTentative: boolean;
  /** Paused by staff (Hold or Skip); no countdown is sent alongside it. */
  isOnHold: boolean;
  /** Only meaningful when isOnHold is true. */
  holdReason: 'held' | 'skipped' | null;
  /** Shift ended before they were seen; no start time, show as missed. */
  isMissedSession: boolean;
  /** False until the doctor arrives for this shift; times, now serving and next up are then withheld. */
  doctorArrived: boolean;

  /** How late this appointment is running, grouped rather than spread across
   * five separate top-level fields. */
  delay: {
    /** Lateness against the patient's own slot, not time until seen (see `untilSeenMinutes`). */
    minutes: number;
    /** Minutes from now until seen; null with no projection, since 0 would read as "you are next". */
    untilSeenMinutes: number | null;
    isLate: boolean;
    /** Minutes late when `isLate`; before the doctor arrives, minutes past the slot. Else null. */
    lateMinutes: number | null;
  };
  /** Who the doctor is with; `label` is ready to show ("Token 4" / "1:00 PM"). Null between patients. */
  nowServing: {
    /** Null on time-based queues. */
    token: number | null;
    /** "HH:MM". Null on token-based queues. */
    time: string | null;
    label: string | null;
    /** "In Consultation" while the doctor is with someone, else null. */
    status: string | null;
  };
  /** Who goes in after `nowServing`, in the patient's shift. Null when nobody waits. */
  nextUp: { token: number | null; label: string | null };
  /** This patient's place in today's line. */
  queue: {
    stage: QueueStage | null;
    /** Active (non-held, non-terminal) appointments ahead of this one. */
    patientsAhead: number;
    /** 1-based rank (the patient with the doctor is 1); null for terminal or held. */
    position: number | null;
  };
}

/** A live-queue rejection: `status` for REST, `details.code` for the socket's ack. */
const reject = (status: number, code: string, message: string): never => {
  throw new HttpError(status, message, { code });
};

/** Shared REST/socket access rule: own or family appointment, today (IST), open, with a doctor. */
export async function loadLiveQueueAppointment(
  appointmentId: string,
  userId: string
) {
  const mappedId = await redisClient.get(
    `temp_booking_mapped:${appointmentId}`
  );
  const resolvedId = mappedId || appointmentId;

  const [appointment] = await database
    .select({
      id: AppointmentModel.id,
      clinicId: AppointmentModel.clinicId,
      doctorId: AppointmentModel.doctorId,
      patientId: AppointmentModel.patientId,
      appointmentDate: AppointmentModel.appointmentDate,
      appointmentTime: AppointmentModel.appointmentTime,
      appointmentStatus: AppointmentModel.appointmentStatus,
      tokenNo: AppointmentModel.tokenNo,
    })
    .from(AppointmentModel)
    .where(eq(AppointmentModel.id, resolvedId))
    .limit(1);

  if (!appointment) return reject(404, 'NOT_FOUND', 'Appointment not found');

  // Ownership before anything else, so a stranger's id reveals nothing about
  // the appointment's date or status.
  if (appointment.patientId !== userId) {
    const [link] = await database
      .select({ id: PatientFamilyLinksModel.id })
      .from(PatientFamilyLinksModel)
      .where(
        and(
          eq(PatientFamilyLinksModel.primaryPatientId, userId),
          eq(PatientFamilyLinksModel.linkedPatientId, appointment.patientId)
        )
      )
      .limit(1);

    if (!link) {
      // Both ids: a foreign appointment and an unlinked duplicate patient row
      // look identical from the device.
      logger.warn(
        `[LiveQueue] ownership mismatch: user=${userId} appointmentPatient=${appointment.patientId} appointment=${resolvedId}`
      );
      return reject(
        403,
        'ACCESS_DENIED',
        'Access denied — this appointment belongs to another patient'
      );
    }
  }

  if (!appointment.doctorId) {
    return reject(400, 'NO_DOCTOR', 'No doctor assigned');
  }
  // IST, like the engine: the server clock is UTC.
  if (
    getISTDateString(new Date(appointment.appointmentDate)) !==
    getISTDateString()
  ) {
    return reject(
      400,
      'NOT_TODAY',
      "Live queue only available for today's appointments"
    );
  }
  if (TERMINAL_STATUSES.has(appointment.appointmentStatus)) {
    return reject(400, 'TERMINAL_STATUS', 'Appointment is no longer in queue');
  }

  return { ...appointment, doctorId: appointment.doctorId };
}

const EMPTY_PAYLOAD: LiveQueuePayload = {
  appointmentId: '',
  tokenNo: null,
  sessionIndex: null,
  status: null,
  isCheckedIn: false,
  appointmentTime: null,
  serverTime: '',
  isMyTurn: false,
  avgConsultationMinutes: null,
  consultationBasis: null,
  tentativeStartTime: null,
  tentativeRangeMinutes: null,
  isTentative: false,
  isOnHold: false,
  holdReason: null,
  isMissedSession: false,
  doctorArrived: true,
  delay: {
    minutes: 0,
    untilSeenMinutes: null,
    isLate: false,
    lateMinutes: null,
  },
  nowServing: { token: null, time: null, label: null, status: null },
  nextUp: { token: null, label: null },
  queue: { stage: null, patientsAhead: 0, position: null },
};

/** "Give or take" band: a floor plus a share of a consultation per patient ahead; not a statistical interval. */
const TENTATIVE_BASE_MINUTES = 5;
const TENTATIVE_PER_PATIENT_RATIO = 0.25;
const TENTATIVE_MAX_MINUTES = 60;
/** Used when the queue has no duration data at all to reason from. */
const TENTATIVE_FALLBACK_DURATION = 30;

function computeTentativeRange(
  patientsAhead: number,
  avgConsultationMinutes: number | null
): number {
  const perConsultation =
    avgConsultationMinutes && avgConsultationMinutes > 0
      ? avgConsultationMinutes
      : TENTATIVE_FALLBACK_DURATION;

  const spread =
    TENTATIVE_BASE_MINUTES +
    patientsAhead * perConsultation * TENTATIVE_PER_PATIENT_RATIO;

  return Math.min(TENTATIVE_MAX_MINUTES, Math.round(spread));
}

/** Fresh payload for a screen open; recalculates because delay grows with time alone, with no event. */
export async function computeLiveQueuePayload(
  appointmentId: string,
  clinicId: string,
  doctorId: string
): Promise<LiveQueuePayload> {
  const delayTrackerService = new DelayTrackerService();
  const today = getISTDateString();

  const queueData = await delayTrackerService.recalculate(
    clinicId,
    doctorId,
    today
  );

  if (!queueData || queueData.appointments.length === 0) {
    // serverTime is stamped on every path, including the empty one — a client
    // greying out stale data must not treat "no queue today" as "no clock".
    return {
      ...EMPTY_PAYLOAD,
      appointmentId,
      serverTime: new Date().toISOString(),
    };
  }

  // For token-based appointments (no appointmentTime), ensure a running-late
  // job is scheduled using the projected start time from the delay tracker.
  const myEntry = queueData.appointments.find(
    (a) => a.appointmentId === appointmentId
  );
  if (myEntry && !myEntry.scheduledTime && myEntry.projectedStartTime) {
    import('./runningLateQueue.service')
      .then(({ runningLateQueue }) =>
        runningLateQueue.scheduleCheckFromProjectedTime(
          appointmentId,
          clinicId,
          doctorId,
          today,
          myEntry.projectedStartTime
        )
      )
      .catch(() => {});
  }

  // Not awaited: it may send a push, and the payload doesn't depend on it.
  const notifier = new RunningLateNotifier();
  notifier
    .evaluateSingleFromCache(clinicId, appointmentId, queueData)
    .catch(() => {});

  const thresholdMinutes = await notifier.getThresholdMinutes(clinicId);

  return buildPayloadFromQueue(appointmentId, queueData, thresholdMinutes);
}

/** Cached payload for refresh/reconnect, recalculating on a miss; null when not in today's queue. */
export async function computeLiveQueuePayloadFromCache(
  appointmentId: string,
  clinicId: string,
  doctorId: string
): Promise<{ payload: LiveQueuePayload; fromCache: boolean } | null> {
  const delayTrackerService = new DelayTrackerService();
  const today = getISTDateString();

  let fromCache = true;
  let queueData = await delayTrackerService.getQueueDelayData(
    clinicId,
    doctorId,
    today
  );

  if (!queueData) {
    fromCache = false;
    queueData = await delayTrackerService.recalculate(
      clinicId,
      doctorId,
      today
    );
  }

  if (!queueData || queueData.appointments.length === 0) return null;

  const inQueue = queueData.appointments.some(
    (a) => a.appointmentId === appointmentId
  );
  if (!inQueue) return null;

  // Cached for an hour by the notifier, so this stays a single Redis read.
  const thresholdMinutes = await new RunningLateNotifier()
    .getThresholdMinutes(clinicId)
    .catch(() => null);

  return {
    payload: buildPayloadFromQueue(appointmentId, queueData, thresholdMinutes),
    fromCache,
  };
}

/** First active, non-held entry in line that the doctor is not already with. */
function buildNextUp(
  appointments: QueueDelayData['appointments'],
  sessionIndex: number | null | undefined
): LiveQueuePayload['nextUp'] {
  const next = appointments.find(
    (a) =>
      !isTerminalStatus(a.status) &&
      !a.isOnHold &&
      a.status !== IN_CONSULTATION &&
      (sessionIndex == null || a.sessionIndex === sessionIndex)
  );
  if (!next) return { token: null, label: null };
  return {
    token: next.tokenNo ?? null,
    label:
      next.tokenNo != null
        ? `Token ${next.tokenNo}`
        : toDisplayTime(next.scheduledTime),
  };
}

/** Pure payload builder, so REST, join, refresh and every push send identical data. */
export function buildPayloadFromQueue(
  appointmentId: string,
  queueData: QueueDelayData,
  thresholdMinutes: number | null = null
): LiveQueuePayload {
  const appointments = queueData.appointments;

  // Only In Consultation is "with the doctor"; Patient Arrived is still in the waiting room.
  const currentlyServing =
    appointments.find((a) => a.status === IN_CONSULTATION) ?? null;

  const nowServingLabel = currentlyServing
    ? currentlyServing.tokenNo != null
      ? `Token ${currentlyServing.tokenNo}`
      : toDisplayTime(currentlyServing.scheduledTime)
    : null;

  const durations = appointments
    .filter((a) => a.durationMinutes > 0)
    .map((a) => a.durationMinutes);

  const avgConsultationMinutes =
    durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : null;

  const myEntry = appointments.find((a) => a.appointmentId === appointmentId);

  if (!myEntry) {
    const nowServingStatus = currentlyServing ? 'In Consultation' : null;
    return {
      ...EMPTY_PAYLOAD,
      appointmentId,
      nowServing: {
        token: currentlyServing?.tokenNo ?? null,
        time: currentlyServing?.scheduledTime ?? null,
        label: nowServingLabel,
        status: nowServingStatus,
      },
      nextUp: buildNextUp(appointments, null),
      avgConsultationMinutes,
      consultationBasis: queueData.consultationBasis ?? null,
      serverTime: new Date().toISOString(),
    };
  }

  // Held patients aren't "ahead" of anyone; an evening patient isn't behind the morning's.
  const nonHeldActiveAppointments = appointments.filter(
    (a) =>
      !isTerminalStatus(a.status) &&
      !a.isOnHold &&
      (myEntry.sessionIndex == null || a.sessionIndex === myEntry.sessionIndex)
  );

  const myIndex = nonHeldActiveAppointments.indexOf(myEntry);
  // Paused, everyone still in line is ahead of them — 0 read as "you're next".
  // Matches reception's "Next in queue (N)" for the same shift.
  const patientsAhead =
    myEntry.isOnHold && !isTerminalStatus(myEntry.status)
      ? nonHeldActiveAppointments.length
      : Math.max(myIndex, 0);
  // myIndex is -1 when this entry is terminal or held (both excluded from
  // nonHeldActiveAppointments) — neither has a rank in the line right now.
  const position = myIndex >= 0 ? myIndex + 1 : null;

  const isCheckedIn = isPresentStatus(myEntry.status);
  const queuePosition = deriveQueueStage(myEntry.status, patientsAhead, {
    isCheckedIn,
    isOnHold: Boolean(myEntry.isOnHold),
  });

  // Nothing live to count down to for terminal, held or missed-shift entries.
  const isTerminal = isTerminalStatus(myEntry.status);
  const tentativeStartTime =
    isTerminal || myEntry.isOnHold || myEntry.isMissedSession
      ? null
      : (myEntry.projectedStartTime ?? null);
  const tentativeRangeMinutes = tentativeStartTime
    ? computeTentativeRange(patientsAhead, avgConsultationMinutes)
    : null;

  const delayMinutes = myEntry.estimatedWaitMinutes;

  // A patient's "wait" is minutes until seen, unlike delay (lateness against their slot).
  const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes();
  const minutesUntilSeen = minutesUntil(
    tentativeStartTime,
    istHours * 60 + istMinutes
  );
  // Live reading only, never the notifier's stored alert value, so the banner matches the screen.
  const isRunningLate =
    !myEntry.isOnHold &&
    thresholdMinutes !== null &&
    delayMinutes > thresholdMinutes;

  const nowServingStatus = currentlyServing ? 'In Consultation' : null;
  const resolvedRunningLateMinutes = isRunningLate ? delayMinutes : null;

  // Before the doctor arrives every projection is a guess, so only place in line is shown.
  if ((myEntry.doctorArrived ?? queueData.doctorArrived) === false) {
    const slotMinutes = hhmmToMinutes(myEntry.scheduledTime);
    const pastSlotBy =
      slotMinutes === null ? 0 : istHours * 60 + istMinutes - slotMinutes;
    const lateBeforeArrival = !isTerminal && pastSlotBy > 0;
    return {
      ...EMPTY_PAYLOAD,
      appointmentId: myEntry.appointmentId,
      tokenNo: myEntry.tokenNo,
      sessionIndex: myEntry.sessionIndex ?? null,
      status: myEntry.status,
      isCheckedIn,
      appointmentTime: myEntry.scheduledTime,
      serverTime: new Date().toISOString(),
      isOnHold: Boolean(myEntry.isOnHold),
      holdReason: myEntry.holdReason ?? null,
      isMissedSession: Boolean(myEntry.isMissedSession),
      doctorArrived: false,
      delay: {
        minutes: Math.max(pastSlotBy, 0),
        untilSeenMinutes: null,
        isLate: lateBeforeArrival,
        lateMinutes: lateBeforeArrival ? pastSlotBy : null,
      },
      queue: { stage: queuePosition, patientsAhead, position },
    };
  }

  return {
    appointmentId: myEntry.appointmentId,
    tokenNo: myEntry.tokenNo,
    sessionIndex: myEntry.sessionIndex ?? null,
    status: myEntry.status,
    isCheckedIn,
    appointmentTime: myEntry.scheduledTime,
    isMyTurn: currentlyServing?.appointmentId === myEntry.appointmentId,
    avgConsultationMinutes,
    consultationBasis: queueData.consultationBasis ?? null,
    serverTime: new Date().toISOString(),
    tentativeStartTime,
    tentativeRangeMinutes,
    isTentative: tentativeStartTime !== null,
    isOnHold: Boolean(myEntry.isOnHold),
    holdReason: myEntry.holdReason ?? null,
    isMissedSession: Boolean(myEntry.isMissedSession),
    doctorArrived: true,
    delay: {
      minutes: delayMinutes,
      untilSeenMinutes: minutesUntilSeen,
      isLate: isRunningLate,
      lateMinutes: resolvedRunningLateMinutes,
    },
    nowServing: {
      token: currentlyServing?.tokenNo ?? null,
      time: currentlyServing?.scheduledTime ?? null,
      label: nowServingLabel,
      status: nowServingStatus,
    },
    nextUp: buildNextUp(appointments, myEntry.sessionIndex),
    queue: {
      stage: queuePosition,
      patientsAhead,
      position,
    },
  };
}
