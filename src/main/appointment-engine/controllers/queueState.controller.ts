import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { DelayTrackerService } from '../services/delayTracker.service';
import { TimeToNextService } from '../services/timeToNext.service';
import { getISTDateString } from '../../../utils/istDateTime';
import { IN_CONSULTATION } from '../types/engine.types';

/**
 * GET /api/v1/appointments/queue-state?clinicId=X&doctorId=Y&date=YYYY-MM-DD
 *
 * Returns the current queue state from Redis cache for instant page load.
 * If no cache exists, computes fresh data on the fly.
 *
 * The response includes `lastCalculatedAt` so the frontend can start
 * its local countdown timer from an accurate baseline.
 */
export const getQueueStateController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId, doctorId, date } = req.query as {
      clinicId: string;
      doctorId: string;
      date?: string;
    };

    if (!clinicId || !doctorId) {
      return res.status(400).json({
        success: false,
        message: 'clinicId and doctorId are required query parameters',
      });
    }

    // Default to today if date not provided
    const targetDate = date || getISTDateString();

    const delayTrackerService = new DelayTrackerService();
    const timeToNextService = new TimeToNextService();

    // Try Redis cache first, fall back to fresh computation
    let queueData = await delayTrackerService.getQueueDelayData(
      clinicId,
      doctorId,
      targetDate
    );

    if (!queueData) {
      // No cache — compute fresh
      queueData = await delayTrackerService.recalculate(
        clinicId,
        doctorId,
        targetDate
      );
    }

    // Compute time-to-next
    const timeToNextMinutes = await timeToNextService.compute(
      clinicId,
      doctorId,
      targetDate
    );

    const STATUS_DISPLAY_PRIORITY: Record<string, number> = {
      // The engine stamps the occupant `In Consultation`; `Confirmed` is the
      // legacy spelling a cached payload can still carry.
      [IN_CONSULTATION]: 0,
      Confirmed: 0,
      'Patient Arrived': 1,
      Upcoming: 2,
      Pending: 2,
    };
    /** Parked: not progressing, so below the active queue but above terminal. */
    const HELD_PRIORITY = 3;
    const TERMINAL_PRIORITY = 4;

    const response = {
      clinicId: queueData.clinicId,
      doctorId: queueData.doctorId,
      date: queueData.date,
      cumulativeDelay: queueData.cumulativeDelayMinutes,
      lastCalculatedAt: queueData.lastCalculatedAt,
      timeToNextMinutes,
      // Published so the client can say where a wait estimate came from
      // instead of presenting the booking grid's slot size as fact.
      consultationBasis: queueData.consultationBasis ?? null,
      consultationMinutes: queueData.consultationMinutes ?? null,
      consultationSampleSize: queueData.consultationSampleSize ?? 0,
      appointments: queueData.appointments
        .map((entry) => ({
          appointmentId: entry.appointmentId,
          patientId: entry.patientId,
          status: entry.status,
          appointmentTime: entry.scheduledTime,
          tokenNo: entry.tokenNo,
          projectedStartTime: entry.projectedStartTime,
          estimatedWaitMinutes:
            entry.status === IN_CONSULTATION ? 0 : entry.estimatedWaitMinutes,
          durationMinutes: entry.durationMinutes,
          isOnHold: Boolean(entry.isOnHold),
          holdReason: entry.holdReason ?? null,
          // The shift closed before this patient was reached, so the projected
          // time below is an anchor to sort by, not an estimate to show.
          isMissedSession: Boolean(entry.isMissedSession),
          consultationStartedAt: entry.startedAt ?? null,
          arrivedAt: entry.arrivedAt ?? null,
        }))
        .sort((a, b) => {
          // A held patient keeps a waiting status, so status alone ranked
          // them above patients actually in the queue.
          const tier = (e: { status: string; isOnHold: boolean }) =>
            e.isOnHold
              ? HELD_PRIORITY
              : (STATUS_DISPLAY_PRIORITY[e.status] ?? TERMINAL_PRIORITY);
          return tier(a) - tier(b);
        }),
    };

    return sendOk(res, 'Queue state fetched successfully', response);
  }
);
