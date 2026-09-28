import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { AppointmentActivityHistoryModel } from '../../appointments/models/appointmentActivityHistory.model';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  startOfDayIST,
  getISTDateString,
  istNaiveTimestampToIso,
} from '../../../utils/istDateTime';
import { realtimeBus, target } from '../../realtime';
import { invalidateClinicDashboardCaches } from '../../dashboard/utils/dashboardCache.utils';
import { AppointmentActivityHistoryService } from '../../appointments/services/appointmentActivityHistory.service';
import logger from '../../../utils/logger';
import { AppointmentEngineOrchestrator } from './orchestrator.service';
import { DoctorArrivalService } from './doctorArrival.service';
import { fetchDoctorDayQueue } from './dayQueue.service';
import { doctorScopeFilter } from '../../permissions/utils/staffScope.utils';
import type { DoctorQueueBoard } from '../types/queue.types';
import {
  TERMINAL_STATUSES,
  buildBoard,
  isPresentStatus,
} from '../utils/queueBoard';
import {
  getCurrentAppointmentId,
  getConsultationStartedAt,
  getHeldAppointments,
  getNextAppointmentIds,
  removeNextAppointment,
  setCurrentAppointment,
  setConsultationStartedAt,
  setConsultationEndedAt,
  setNextAppointment,
  holdAppointment,
  resumeAppointment,
} from './queueHoldStore.service';

interface AppointmentRow {
  id: string;
  appointmentDate: Date;
  appointmentTime: string | null;
  tokenNo: number | null;
  sessionIndex: number | null;
  appointmentStatus: string;
  /** Only selected by the board's day query. */
  lateQueueDemotion?: number | null;
  /** Only selected by `loadForAction`; absent on the board's own day query. */
  arrivedAt?: Date | null;
  clinicId: string;
  patientId: string;
  doctorId: string | null;
}

export class QueueService {
  static async getBoard(
    clinicId: string,
    doctorId: string,
    date?: string
  ): Promise<DoctorQueueBoard> {
    const targetDate = date || getISTDateString();

    const [rows, held, currentAppointmentId, priorityIds, startedAt] =
      await Promise.all([
        QueueService.fetchDay(clinicId, doctorId, targetDate),
        getHeldAppointments(clinicId, doctorId, targetDate),
        getCurrentAppointmentId(clinicId, doctorId, targetDate),
        getNextAppointmentIds(clinicId, doctorId, targetDate),
        // In the same batch as the pointer rather than after it, so an accurate
        // elapsed-time display costs no extra round trip.
        getConsultationStartedAt(clinicId, doctorId, targetDate),
      ]);

    const names = await QueueService.resolvePatientNames(rows);

    const startedAtForRoom =
      currentAppointmentId && !startedAt
        ? await QueueService.confirmedAtFromHistory(currentAppointmentId)
        : startedAt;

    return buildBoard(
      clinicId,
      doctorId,
      targetDate,
      rows,
      held,
      currentAppointmentId,
      priorityIds,
      names,
      // Only meaningful while someone is actually in the room; a leftover key
      // with an empty pointer would otherwise start a timer on nobody.
      currentAppointmentId ? startedAtForRoom : null
    );
  }

  private static async confirmedAtFromHistory(
    appointmentId: string
  ): Promise<string | null> {
    try {
      const [row] = await database
        .select({ createdAt: AppointmentActivityHistoryModel.createdAt })
        .from(AppointmentActivityHistoryModel)
        .where(
          and(
            eq(AppointmentActivityHistoryModel.appointmentId, appointmentId),
            eq(AppointmentActivityHistoryModel.action, 'CONFIRMED')
          )
        )
        .orderBy(asc(AppointmentActivityHistoryModel.createdAt))
        .limit(1);

      return istNaiveTimestampToIso(row?.createdAt ?? null);
    } catch (err) {
      logger.warn(
        `[Queue] Could not read the consultation start from history for appointment=${appointmentId}`,
        err
      );
      return null;
    }
  }

  /**
   * Every doctor's queue in one response. Built here rather than by a client
   * loop so all of them are read at the same moment — a loop would show doctor
   * A as of 10:00:01 and doctor B as of 10:00:03.
   */
  static async getClinicBoards(
    clinicId: string,
    date?: string,
    allowedDoctorIds?: string[] | null
  ): Promise<DoctorQueueBoard[]> {
    const targetDate = date || getISTDateString();
    const scopeFilter = doctorScopeFilter(
      AppointmentModel.doctorId,
      allowedDoctorIds ?? null
    );

    const doctorRows = await database
      .selectDistinct({ doctorId: AppointmentModel.doctorId })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          ...QueueService.dayBounds(targetDate),
          ...(scopeFilter ? [scopeFilter] : [])
        )
      );

    const doctorIds = doctorRows
      .map((r) => r.doctorId)
      .filter((id): id is string => Boolean(id));

    return Promise.all(
      doctorIds.map((doctorId) =>
        QueueService.getBoard(clinicId, doctorId, targetDate)
      )
    );
  }

  /* ── Actions ──────────────────────────────────────────────────────────── */

  /**
   * Moves a patient to the front of the queue — and, for the doctor whose queue
   * it is, into the room. Everyone else only sets the order override.
   */
  static async sendIn(
    clinicId: string,
    appointmentId: string,
    /** Who is asking. Defaults to the cautious reading: reorder only. */
    actorType: string = 'Receptionist',
    /** The acting user, recorded on the activity row when they take the room. */
    performedBy?: string
  ): Promise<DoctorQueueBoard> {
    const appointment = await QueueService.loadForAction(
      clinicId,
      appointmentId
    );
    const date = getISTDateString(appointment.appointmentDate);
    const doctorId = appointment.doctorId!;

    // "In the room" is the queue's pointer, not a status — see putInRoom.
    if (
      (await getCurrentAppointmentId(clinicId, doctorId, date)) ===
      appointmentId
    ) {
      throw new HttpError(409, 'This patient is already with the doctor');
    }

    // Only someone who has physically checked in can go in to the doctor.
    if (!isPresentStatus(appointment.appointmentStatus)) {
      throw new HttpError(
        409,
        'Patient must be marked as arrived before being sent in to the doctor'
      );
    }

    // Only the doctor whose queue this is may change the room. Role alone is not
    // enough: an admin covering (or switched into) reception is reception here.
    const mayChangeRoom =
      (actorType === 'Doctor' || actorType === 'Admin') &&
      Boolean(performedBy) &&
      performedBy === doctorId;

    if (mayChangeRoom) {
      await QueueService.putInRoom(
        clinicId,
        doctorId,
        date,
        appointmentId,
        performedBy
      );
    } else {
      await setNextAppointment(clinicId, doctorId, date, appointmentId);
    }

    QueueService.signal(clinicId, doctorId, date, 'queue.patient_sent_in');

    return QueueService.getBoard(clinicId, doctorId, date);
  }

  /**
   * Parks a patient and starts the next one in a single action. A hold rather
   * than its own status: the patient is almost always still in the building,
   * and Resume puts them back in token order. The advance half is what
   * separates this from Hold.
   */
  static async skip(
    clinicId: string,
    appointmentId: string
  ): Promise<DoctorQueueBoard> {
    const appointment = await QueueService.loadForAction(
      clinicId,
      appointmentId
    );
    const date = getISTDateString(appointment.appointmentDate);
    const doctorId = appointment.doctorId!;

    if (TERMINAL_STATUSES.has(appointment.appointmentStatus)) {
      throw new HttpError(
        409,
        `Cannot skip an appointment that is already ${appointment.appointmentStatus}`
      );
    }

    // Skip is a hold plus an advance, so it inherits the hold rule: the
    // patient in the room is not skippable. Skip means "didn't answer when
    // called", which is only ever true of someone still waiting.
    if (
      (await getCurrentAppointmentId(clinicId, doctorId, date)) ===
      appointmentId
    ) {
      throw new HttpError(
        409,
        'This patient is already with the doctor, so there is nobody to skip. ' +
          'Send the next patient in to move the queue on.'
      );
    }

    // No arrival check, same as hold: a patient who has not turned up when
    // called is exactly the one reception needs to skip past.
    //
    // Park first, so the skipped patient is excluded when we ask who is next
    // and can never be chosen as their own replacement.
    await holdAppointment(clinicId, doctorId, date, appointmentId, 'skipped');

    const parked = await QueueService.getBoard(clinicId, doctorId, date);
    const nextUp = parked.nextPatient;

    // Advance only into an empty room: promoting while a consultation runs
    // would end it from the front desk. Busy means skip is exactly a hold.
    if (nextUp && !parked.currentPatient) {
      await QueueService.putInRoom(
        clinicId,
        doctorId,
        date,
        nextUp.appointmentId
      );
    }

    // One signal for the whole action — parking and promoting are one move to
    // everyone watching, and two signals would make both screens refetch twice
    // to land on the same board.
    QueueService.signal(clinicId, doctorId, date, 'queue.patient_skipped');
    return QueueService.getBoard(clinicId, doctorId, date);
  }

  /**
   * Marks a checked-in patient as unavailable. Refuses the patient with the
   * doctor — a consultation is the doctor's to end.
   */
  static async hold(
    clinicId: string,
    appointmentId: string
  ): Promise<DoctorQueueBoard> {
    const appointment = await QueueService.loadForAction(
      clinicId,
      appointmentId
    );
    const date = getISTDateString(appointment.appointmentDate);
    const doctorId = appointment.doctorId!;

    if (TERMINAL_STATUSES.has(appointment.appointmentStatus)) {
      throw new HttpError(
        409,
        `Cannot hold an appointment that is already ${appointment.appointmentStatus}`
      );
    }

    if (
      (await getCurrentAppointmentId(clinicId, doctorId, date)) ===
      appointmentId
    ) {
      throw new HttpError(
        409,
        'This patient is with the doctor. Only the doctor can end a ' +
          'consultation — send the next patient in if the queue should move on.'
      );
    }

    // No arrival check: reception parks a patient who phones ahead, which is
    // before the check-in. `buildBoard` reads the flag on not-arrived rows too.
    await holdAppointment(clinicId, doctorId, date, appointmentId, 'held');

    QueueService.signal(clinicId, doctorId, date, 'queue.patient_held');
    return QueueService.getBoard(clinicId, doctorId, date);
  }

  /** Returns a held patient to the waiting list, in their normal queue order. */
  static async resume(
    clinicId: string,
    appointmentId: string
  ): Promise<DoctorQueueBoard> {
    const appointment = await QueueService.loadForAction(
      clinicId,
      appointmentId
    );
    const date = getISTDateString(appointment.appointmentDate);
    const doctorId = appointment.doctorId!;

    await resumeAppointment(clinicId, doctorId, date, appointmentId);

    // Back in the queue means back in the waiting room. Not `isPresentStatus`:
    // it counts `Confirmed`, the in-room value a resume has to clear.
    if (
      appointment.appointmentStatus !== 'Patient Arrived' &&
      !TERMINAL_STATUSES.has(appointment.appointmentStatus)
    ) {
      await database
        .update(AppointmentModel)
        .set({
          appointmentStatus: 'Patient Arrived',
          ...(appointment.arrivedAt ? {} : { arrivedAt: new Date() }),
        })
        .where(eq(AppointmentModel.id, appointmentId));

      await AppointmentActivityHistoryService.logActivity({
        appointmentId,
        action: 'PATIENT_ARRIVED',
        remarks: 'Returned to the waiting queue from hold',
      });
    }

    QueueService.signal(clinicId, doctorId, date, 'queue.patient_resumed');
    return QueueService.getBoard(clinicId, doctorId, date);
  }

  /* ── Internals ────────────────────────────────────────────────────────── */

  /**
   * Puts one patient in the room — a pointer move, not a status change. The
   * pointer names exactly one appointment, so there is no window with two in
   * the room or none, and no DB write. It used to set `Confirmed`, which claims
   * the booking was confirmed — a different thing, and not reception's to say.
   */
  private static async putInRoom(
    clinicId: string,
    doctorId: string,
    date: string,
    appointmentId: string,
    /** Whoever moved the room, for the activity row. Optional — a skip advances the queue with no explicit actor. */
    performedBy?: string
  ): Promise<void> {
    // Whoever was in the room is parked, not re-queued: their consultation was
    // interrupted, and re-queueing would put them straight back in line.
    // Unconditional — a terminal row's flag is never read.
    const displaced = await getCurrentAppointmentId(clinicId, doctorId, date);
    if (displaced && displaced !== appointmentId) {
      await holdAppointment(clinicId, doctorId, date, displaced, 'held');
    }

    // The room changing hands ends whatever was running, so record when: the
    // projection cascades from that end, and without a real one it uses the
    // planned length, hiding the time a doctor finishing early frees up.
    if (displaced) {
      await setConsultationEndedAt(
        clinicId,
        doctorId,
        date,
        new Date().toISOString()
      );
    }

    await setCurrentAppointment(clinicId, doctorId, date, appointmentId);
    const startedAt = new Date();
    await setConsultationStartedAt(
      clinicId,
      doctorId,
      date,
      startedAt.toISOString()
    );

    // Taking a patient in *is* the doctor confirming them, so the status
    // follows the room — see this module's header.
    const [confirmed] = await database
      .update(AppointmentModel)
      .set({ appointmentStatus: 'Confirmed' })
      .where(eq(AppointmentModel.id, appointmentId))
      .returning({
        appointmentDate: AppointmentModel.appointmentDate,
        sessionIndex: AppointmentModel.sessionIndex,
      });

    // Same fallback as confirming from the appointment page: taking someone in means the doctor is here.
    if (confirmed) {
      void DoctorArrivalService.autoMarkOnConfirm(
        clinicId,
        doctorId,
        doctorId,
        confirmed
      ).catch((err) => {
        logger.warn(
          `[DoctorArrival] auto-mark on send-in failed for appointment=${appointmentId}`,
          err
        );
      });
    }

    // The durable record of the same moment: the Redis key is one per
    // doctor-day and does not survive a flush, while
    // `ConsultationDurationService` measures MIN(CONFIRMED) -> MAX(COMPLETED)
    // from the activity history. Only `PUT /appointments/:id` wrote that row,
    // so a patient taken in from the queue card was absent from the samples.
    await AppointmentActivityHistoryService.logActivity({
      appointmentId,
      action: 'CONFIRMED',
      performedBy,
      remarks: 'Patient taken in to the doctor from the queue',
    });

    // This patient's promotion has been honoured, so it has no further claim —
    // but only theirs. Clearing the whole list would drop the queue reception
    // built back to plain token order the moment anybody entered the room.
    await removeNextAppointment(clinicId, doctorId, date, appointmentId).catch(
      () => {}
    );

    // Being sent in supersedes a hold — otherwise the patient would show as
    // with the doctor and on hold at the same time.
    await resumeAppointment(clinicId, doctorId, date, appointmentId).catch(
      () => {}
    );
  }

  private static dayBounds(date: string) {
    const startOfDay = startOfDayIST(date);
    const nextDay = new Date(startOfDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return [
      gte(AppointmentModel.appointmentDate, startOfDay),
      lt(AppointmentModel.appointmentDate, nextDay),
    ];
  }

  /** The same day query the time projection reads; kept as a method so tests can stub it. */
  private static fetchDay(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<AppointmentRow[]> {
    return fetchDoctorDayQueue(clinicId, doctorId, date);
  }

  /**
   * Loads an appointment for a queue action, rejecting anything that would
   * make the action meaningless. Clinic ownership is checked here so no caller
   * can act on another clinic's queue by guessing an id.
   */
  private static async loadForAction(
    clinicId: string,
    appointmentId: string
  ): Promise<AppointmentRow> {
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        sessionIndex: AppointmentModel.sessionIndex,
        appointmentStatus: AppointmentModel.appointmentStatus,
        arrivedAt: AppointmentModel.arrivedAt,
        clinicId: AppointmentModel.clinicId,
        patientId: AppointmentModel.patientId,
        doctorId: AppointmentModel.doctorId,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.id, appointmentId),
          eq(AppointmentModel.clinicId, clinicId)
        )
      );

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found');
    }
    if (!appointment.doctorId) {
      throw new HttpError(
        400,
        'This appointment has no doctor assigned, so it is not in a queue'
      );
    }

    return appointment;
  }

  private static async resolvePatientNames(
    rows: AppointmentRow[]
  ): Promise<Map<string, string>> {
    const ids = Array.from(new Set(rows.map((r) => r.patientId)));
    if (ids.length === 0) return new Map();

    const patients = await database
      .select({ id: UserModel.id, name: UserModel.name })
      .from(UserModel)
      .where(inArray(UserModel.id, ids));

    return new Map(patients.map((p) => [p.id, p.name ?? 'Unknown']));
  }

  /**
   * Tells the doctor's screen and the reception board to re-read.
   * Fire-and-forget, after the write.
   */
  private static signal(
    clinicId: string,
    doctorId: string,
    date: string,
    reason: string
  ): void {
    // Recalculate before notifying: `GET /queue-state` serves a cached
    // snapshot, so the reverse order has clients refetch pre-action data.
    // The status write changed dashboard counts, and a failed recalculation
    // skips the orchestrator's own cache bump, so retire the caches here too.
    void new AppointmentEngineOrchestrator()
      .onQueueAction(clinicId, doctorId, date)
      .catch(() => {})
      .then(() => invalidateClinicDashboardCaches(clinicId))
      .finally(() => {
        try {
          realtimeBus.notify(target.queue(clinicId, doctorId, date), reason);
          realtimeBus.notify(target.board(clinicId), reason);
        } catch (err) {
          logger.warn(`[Queue] Failed to signal queue change: ${reason}`, err);
        }
      });
  }
}
