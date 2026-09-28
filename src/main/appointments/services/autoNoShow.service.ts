// src/main/appointments/services/autoNoShow.service.ts
import { Queue, Worker } from 'bullmq';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../models/appointment.model';
import { eq, and } from 'drizzle-orm';
import { NoShowService } from './noShow.service';
import { NoShowPolicyModel } from '../models/noShowPolicy.model';
import {
  ScheduleShiftService,
  toHHMM,
} from '../../appointment-engine/services/scheduleShift.service';
import { DoctorArrivalService } from '../../appointment-engine/services/doctorArrival.service';
import logger from '../../../utils/logger';
import {
  appointmentInstantIST,
  getISTDateString,
  istTimeToDate,
} from '../../../utils/istDateTime';

/** The appointment fields the deadline is derived from. */
export interface AutoNoShowAppointment {
  id: string;
  clinicId: string;
  doctorId: string | null;
  appointmentDate: Date | string;
  appointmentTime: string | null;
  tokenNo: number | null;
  sessionIndex: number | null;
}

interface AutoNoShowJobData {
  appointmentId: string;
  clinicId: string;
}

class AutoNoShowQueue {
  private queue: Queue;
  private worker: Worker;

  constructor() {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    };

    this.queue = new Queue('auto-no-show', { connection });

    this.worker = new Worker('auto-no-show', this.processJob.bind(this), {
      connection,
    });
  }

  private async processJob(job: { data: AutoNoShowJobData }) {
    const { appointmentId } = job.data;

    // 1. Check current status of appointment
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        appointmentStatus: AppointmentModel.appointmentStatus,
        // The sitting this booking belongs to, for the arrival check below.
        clinicId: AppointmentModel.clinicId,
        doctorId: AppointmentModel.doctorId,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        sessionIndex: AppointmentModel.sessionIndex,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) return;

    // 2. Only mark as No Show if it's still eligible.
    //
    // "Confirmed" is deliberately NOT eligible. The appointment engine treats
    // it as "the doctor is with this patient" (see delayTracker's
    // isAnyoneBeingServed and receptionLiveQueue's currentRunningEntry), so
    // including it meant a patient physically in the consulting room could be
    // auto-marked a no-show the moment the grace period expired.
    //
    // "Patient Arrived" was already excluded for the same reason: someone who
    // has checked in is, by definition, not absent.
    const eligibleStatuses = ['Upcoming', 'Pending'];

    if (eligibleStatuses.includes(appointment.appointmentStatus || '')) {
      // A no-show is a policy event — it counts against the patient and can
      // escalate to a penalty — so it must never land on the doctor's absence.
      if (!(await this.doctorArrivedForShift(appointment))) {
        logger.info(
          `[AutoNoShow] Skipped ${appointmentId}: the doctor never arrived for this sitting`
        );
        return;
      }

      await NoShowService.markAsNoShow(
        appointmentId,
        '00000000-0000-0000-0000-000000000000', // System User ID
        'system',
        { reason: 'Auto-marked after grace period' }
      );
    }
  }

  /**
   * When a booking's grace period starts counting.
   *
   * A time-based booking is judged against its own slot. A token booking has
   * no slot — it carries a '23:59' placeholder, and grace measured from that
   * fired after midnight, so token patients were never auto-marked on the day
   * they missed. Its turn can only be said to have passed when the session it
   * belongs to has ended, so that is the anchor.
   */
  /** Nobody is absent from a clinic that never opened: did the doctor arrive for this sitting? */
  private async doctorArrivedForShift(
    appt: AutoNoShowAppointment
  ): Promise<boolean> {
    // Unassigned: there is no arrival to look for, so leave the rule as it was.
    if (!appt.doctorId) return true;

    const dateStr = getISTDateString(
      appt.appointmentDate instanceof Date
        ? appt.appointmentDate
        : new Date(appt.appointmentDate)
    );

    // A token belongs to one sitting. A timed booking is judged against the
    // day, where an arrival still carries across the lunch break.
    let sessionStart: string | undefined;
    if (appt.tokenNo != null) {
      const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
        database,
        appt.clinicId,
        appt.doctorId,
        dateStr
      );
      const segment = day?.segments[(appt.sessionIndex ?? 1) - 1];
      if (segment) sessionStart = toHHMM(segment.start);
    }

    const arrival = await DoctorArrivalService.getArrival(
      appt.clinicId,
      appt.doctorId,
      dateStr,
      sessionStart
    );

    return arrival !== null;
  }

  private async resolveDeadline(appt: AutoNoShowAppointment): Promise<Date> {
    const fallback = () =>
      appointmentInstantIST(appt.appointmentDate, appt.appointmentTime);

    if (appt.tokenNo == null || !appt.doctorId) return fallback();

    const dateStr = getISTDateString(
      appt.appointmentDate instanceof Date
        ? appt.appointmentDate
        : new Date(appt.appointmentDate)
    );

    const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
      database,
      appt.clinicId,
      appt.doctorId,
      dateStr
    );

    const segment = day?.segments[(appt.sessionIndex ?? 1) - 1];
    // No resolvable session leaves the placeholder as the only anchor, which
    // is late but never marks a patient absent before their turn.
    return segment ? istTimeToDate(dateStr, toHHMM(segment.end)) : fallback();
  }

  async scheduleAutoNoShow(appt: AutoNoShowAppointment) {
    // 1. Get clinic's grace period
    const [policy] = await database
      .select({ gracePeriodMinutes: NoShowPolicyModel.gracePeriodMinutes })
      .from(NoShowPolicyModel)
      .where(
        and(
          eq(NoShowPolicyModel.clinicId, appt.clinicId),
          eq(NoShowPolicyModel.isActive, true)
        )
      )
      .limit(1);

    const gracePeriod = policy?.gracePeriodMinutes ?? 15;

    // 2. Calculate execution time
    const deadline = await this.resolveDeadline(appt);
    const executionTime = new Date(
      deadline.getTime() + gracePeriod * 60 * 1000
    );

    const now = new Date();
    if (executionTime <= now) return;

    const delay = executionTime.getTime() - now.getTime();

    await this.queue.add(
      `auto_no_show_${appt.id}`,
      { appointmentId: appt.id, clinicId: appt.clinicId },
      {
        delay,
        jobId: `auto_no_show_${appt.id}`,
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  }

  async removeAutoNoShow(appointmentId: string) {
    const job = await this.queue.getJob(`auto_no_show_${appointmentId}`);
    if (job) await job.remove();
  }
}

export const autoNoShowQueue = new AutoNoShowQueue();
