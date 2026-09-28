/**
 * Computes patient-facing live queue payloads, shared by the socket
 * join.live-queue handler, the REST endpoint, and the broadcast service.
 */

import { and, eq } from 'drizzle-orm';
import redisClient from '../../../configurations/redisConfig';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
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
  /**
   * Which shift this appointment is in, 1-based. Null for a time-based
   * appointment or a pre-shift-numbering token — both are one undivided queue.
   * `patientsAhead`/`position`/`queue.stage` are scoped to this same session.
   */
  sessionIndex: number | null;
  status: string | null;
  /**
   * True once reception has checked the patient in (or they are with the
   * doctor). Same rule as the reception board's `isCheckedIn`, so both agree.
   */
  isCheckedIn: boolean;
  appointmentTime: string | null;
  /**
   * Server clock at the moment this payload was built, ISO-8601. Lets a client
   * run an honest countdown and grey out a payload that arrived minutes ago,
   * without trusting the device clock.
   */
  serverTime: string;
  /** True when the patient being consulted is the one this payload is for. */
  isMyTurn: boolean;
  avgConsultationMinutes: number | null;
  /**
   * Where `avgConsultationMinutes` came from: `learned` (measured median),
   * `configured`, `slot`, or `default` (30). Published so a surprising wait
   * time can be explained.
   */
  consultationBasis: string | null;
  /**
   * When this patient is currently projected to be seen, "HH:MM". Null once the
   * appointment is terminal — there is nothing left to predict.
   */
  tentativeStartTime: string | null;
  /**
   * Half-width of the band around `tentativeStartTime`: "around 13:45, give or
   * take 20 minutes". Widens with the patients ahead, each an independent
   * chance to run over.
   */
  tentativeRangeMinutes: number | null;
  /**
   * Always true when a `tentativeStartTime` is present. Carried explicitly so a
   * client cannot render the time as a commitment by omission — this is a
   * projection from a queue that is still moving, not a booked slot.
   */
  isTentative: boolean;
  /**
   * True while staff have paused this appointment (Hold or Skip).
   * `tentativeStartTime` is null alongside it — a countdown next to "you are
   * on hold" would contradict itself. Clients should render a paused state.
   */
  isOnHold: boolean;
  /** Only meaningful when isOnHold is true. */
  holdReason: 'held' | 'skipped' | null;
  /**
   * True when the patient's shift ran out before they were seen — the queue
   * would need minutes belonging to the next shift's tokens.
   * `tentativeStartTime` is null; clients should render missed/overdue.
   */
  isMissedSession: boolean;

  /** How late this appointment is running, grouped rather than spread across
   * five separate top-level fields. */
  delay: {
    /**
     * Lateness against this appointment's own slot, not time until seen: a
     * patient booked and projected at 15:00 has delay 0 even with two ahead.
     * See `untilSeenMinutes` for what a patient means by "wait".
     */
    minutes: number;
    /**
     * Whole minutes from now until this patient is projected to be seen. Null
     * when there is no projection to measure — better than a fabricated 0,
     * which would read as "you are next".
     */
    untilSeenMinutes: number | null;
    isLate: boolean;
    /**
     * Effective delay at the moment the running-late notification fired, which
     * can exceed `minutes` above (measured live at read time). Null unless
     * `isLate` is true.
     */
    lateMinutes: number | null;
  };
  /**
   * Whoever the doctor is currently with. `label` is a ready-to-render
   * "Token 4" or "1:00 PM" so clients need not reimplement the choice.
   * All fields null between patients.
   */
  nowServing: {
    /** Null on time-based queues. */
    token: number | null;
    /** "HH:MM". Null on token-based queues. */
    time: string | null;
    label: string | null;
    /** "In Consultation" while the doctor is with someone, else null. */
    status: string | null;
  };
  /**
   * This patient's place in today's line.
   */
  queue: {
    stage: QueueStage | null;
    /** Active (non-held, non-terminal) appointments ahead of this one. */
    patientsAhead: number;
    /**
     * 1-based rank among appointments progressing toward being seen: the
     * patient with the doctor is 1, then everyone waiting. Null for terminal
     * or held appointments.
     */
    position: number | null;
  };
}

/** A live-queue rejection: `status` for REST, `details.code` for the socket's ack. */
const reject = (status: number, code: string, message: string): never => {
  throw new HttpError(status, message, { code });
};

/**
 * The one access rule for a patient's live queue, shared by the REST endpoint
 * and the socket join so the two can't drift again. Resolves a paid booking's
 * temp id; the caller must be the patient or their family primary; the
 * appointment must be today's (IST), still open, and have a doctor.
 */
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
  delay: {
    minutes: 0,
    untilSeenMinutes: null,
    isLate: false,
    lateMinutes: null,
  },
  nowServing: { token: null, time: null, label: null, status: null },
  queue: { stage: null, patientsAhead: 0, position: null },
};

/**
 * Confidence band around a projected start time. The next patient in is nearly
 * certain; one six places back depends on six consultations that could each run
 * over. So the band grows with the queue ahead: a fixed floor plus a share of a
 * consultation per patient between. A legibility device, not a statistical
 * interval — a band wider than the wait itself tells the patient nothing.
 */
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

/**
 * Full live queue payload for one appointment. Always recalculates from the DB
 * rather than trusting the cache: real-time delay changes with elapsed time
 * alone, so no event necessarily invalidates a stale entry. Patient-initiated,
 * so cost is bounded by screen-opens — one indexed query per call.
 */
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

  // Evaluate running-late against what we just recalculated, so a patient
  // opening the screen before the job's next 15-minute repeat doesn't see an
  // unset flag beside a real delay.
  //
  // Single-appointment variant, since this runs on every screen-open and
  // evaluating the whole queue would re-run for every other patient too.
  //
  // Deliberately not awaited: evaluating can dispatch a push notification, and
  // the payload below doesn't depend on its result.
  const notifier = new RunningLateNotifier();
  notifier
    .evaluateSingleFromCache(clinicId, appointmentId, queueData)
    .catch(() => {});

  const thresholdMinutes = await notifier.getThresholdMinutes(clinicId);

  return buildPayloadFromQueue(appointmentId, queueData, thresholdMinutes);
}

/**
 * Serves a patient payload from the cached projection — zero DB queries when
 * warm. For "what is the state right now?" reads: pull-to-refresh, regained
 * focus, reconnect. Falls back to a full recalculation on a cache miss, so a
 * refresh is never worse than a join. Null when the appointment is not in
 * today's queue.
 */
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

/**
 * Builds a patient payload from existing QueueDelayData (no DB call). Pure, so
 * REST, socket join, refresh and every push produce identical payloads.
 */
export function buildPayloadFromQueue(
  appointmentId: string,
  queueData: QueueDelayData,
  thresholdMinutes: number | null = null
): LiveQueuePayload {
  const appointments = queueData.appointments;

  // Only "Confirmed" means the doctor is with this patient. Matching
  // "Patient Arrived" too reported someone still in the waiting room as being
  // seen. Agrees with delayTracker and receptionLiveQueue.
  const currentlyServing =
    appointments.find((a) => a.status === IN_CONSULTATION) ?? null;

  // Token-based queues identify a patient by token, time-based ones by slot.
  // Deciding it here means clients render whatever they are given rather than
  // each picking a different rule.
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
      avgConsultationMinutes,
      consultationBasis: queueData.consultationBasis ?? null,
      serverTime: new Date().toISOString(),
    };
  }

  // A held/skipped patient is paused, so they must not count as someone
  // another patient is waiting behind. Scoped to `myEntry`'s session when it
  // has one — an evening patient isn't behind the morning's. Null sessions
  // still rank against the whole day.
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

  // Terminal, held and missed-session appointments get no tentative time:
  // none has a live slot to count down to, and a countdown past the end of the
  // patient's own shift would promise minutes belonging to the next shift.
  const isTerminal = isTerminalStatus(myEntry.status);
  const tentativeStartTime =
    isTerminal || myEntry.isOnHold || myEntry.isMissedSession
      ? null
      : (myEntry.projectedStartTime ?? null);
  const tentativeRangeMinutes = tentativeStartTime
    ? computeTentativeRange(patientsAhead, avgConsultationMinutes)
    : null;

  const delayMinutes = myEntry.estimatedWaitMinutes;

  // What a patient means by "wait": minutes from now until seen. Distinct from
  // `delayMinutes` (lateness against their own slot) — someone booked and
  // projected at 15:00 has zero delay but may still wait two hours. Measured
  // against the server's IST clock, not the device's.
  const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes();
  const minutesUntilSeen = minutesUntil(
    tentativeStartTime,
    istHours * 60 + istMinutes
  );
  // Live only, so the banner always matches the queue on screen. The notifier's
  // `notified:{id}` flag only de-duplicates pushes: it kept the delay at alert
  // time for 24h, so one bad reading showed "16h behind" long after it passed.
  // Nothing live applies to a paused appointment.
  const isRunningLate =
    !myEntry.isOnHold &&
    thresholdMinutes !== null &&
    delayMinutes > thresholdMinutes;

  const nowServingStatus = currentlyServing ? 'In Consultation' : null;
  const resolvedRunningLateMinutes = isRunningLate ? delayMinutes : null;

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
    queue: {
      stage: queuePosition,
      patientsAhead,
      position,
    },
  };
}
