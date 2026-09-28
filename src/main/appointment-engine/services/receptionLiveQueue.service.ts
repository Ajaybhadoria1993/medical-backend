import { and, eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { resolveDoctorAvailabilityToday } from '../../clinic/services/doctorAvailability.service';
import {
  getISTDateString,
  appointmentInstantIST,
} from '../../../utils/istDateTime';
import { doctorScopeFilter } from '../../permissions/utils/staffScope.utils';
import { QueueService } from './queue.service';
import { getConsultationStartedAt } from './queueHoldStore.service';
import { DelayTrackerService } from './delayTracker.service';
import { ScheduleShiftService } from './scheduleShift.service';
import { TokenCapacityService } from './tokenCapacity.service';

/** Statuses whose token number is free to hand out again. */
const RELEASED_STATUSES = new Set(['Cancelled', 'NoShow']);
import type { DoctorQueueBoard, QueueEntry } from '../types/queue.types';
import {
  DoctorLiveQueue,
  LiveQueueCurrentEntry,
  LiveQueueEntry,
  ReceptionLiveQueueBoard,
} from '../types/receptionLiveQueue.types';

function toSlot(entry: QueueEntry): string {
  // Qualified by session on a split-shift day: numbering restarts at 1 per
  // shift, so an unqualified board shows the morning's and the evening's token
  // 3 as the same "3" and the receptionist cannot tell which patient is meant.
  // A null or first session keeps the bare number, which is what a
  // single-session day — the overwhelming majority — should read as.
  if (entry.tokenNo != null) {
    return entry.sessionIndex != null && entry.sessionIndex > 1
      ? `S${entry.sessionIndex}-${entry.tokenNo}`
      : String(entry.tokenNo);
  }
  return entry.appointmentTime ?? '-';
}

/**
 * Builds the clinic-wide live doctor queue board for the receptionist
 * dashboard: reused as-is for both the REST snapshot and the socket push
 * (QueueBroadcastService.emitReceptionLiveQueueUpdated), so the two can't
 * drift out of sync.
 *
 * The queue itself comes from `QueueService` — the single writer, and the only
 * place that knows about holds and positions. This service composes: roster,
 * availability, and the derived answers the screens would otherwise each work
 * out for themselves. It used to re-derive the queue from `DelayTrackerService`
 * with its own copy of "who is with the doctor" (`find(status === 'Confirmed')`,
 * no hold awareness, no appointment ids), which is why the frontend had to
 * merge two endpoints and re-apply the rules client-side.
 */
export class ReceptionLiveQueueService {
  static async getLiveQueueBoard(
    clinicId: string,
    date?: string,
    allowedDoctorIds?: string[] | null
  ): Promise<ReceptionLiveQueueBoard> {
    const targetDate = date || getISTDateString();
    const scopeFilter = doctorScopeFilter(
      UserModel.id,
      allowedDoctorIds ?? null
    );

    const staff = await database
      .select({
        userId: UserModel.id,
        name: UserModel.name,
        profilePhoto: UserProfileModel.profileImage,
        speciality: UserProfessionalModel.speciality,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.userType, ['Doctor', 'Admin']),
          ...(scopeFilter ? [scopeFilter] : [])
        )
      );

    if (staff.length === 0) {
      return {
        clinicId,
        date: targetDate,
        generatedAt: new Date().toISOString(),
        doctors: [],
      };
    }

    const staffIds = staff.map((s) => s.userId);

    const delayTracker = new DelayTrackerService();
    const [availabilityResults, boards, startedAtResults, delaySnapshots] =
      await Promise.all([
        resolveDoctorAvailabilityToday(clinicId, staffIds),
        // One board per doctor on the roster — including doctors with nothing
        // booked, because an idle doctor is information, not an empty slot.
        Promise.all(
          staffIds.map((doctorId) =>
            QueueService.getBoard(clinicId, doctorId, targetDate)
          )
        ),
        /*
         * When each doctor actually took their current patient in — the instant
         * `send-in` records, not the booking.
         *
         * In the same batch as the boards rather than after them, so this costs
         * no extra round trip.
         */
        Promise.all(
          staffIds.map((doctorId) =>
            getConsultationStartedAt(clinicId, doctorId, targetDate).then(
              (startedAt) => ({ doctorId, startedAt })
            )
          )
        ),
        // Cached snapshots only: rebuilding a board must never recalculate a queue.
        Promise.all(
          staffIds.map((doctorId) =>
            delayTracker
              .getQueueDelayData(clinicId, doctorId, targetDate)
              .catch(() => null)
          )
        ),
      ]);

    const activeNowByDoctor = new Map(
      availabilityResults.map((r) => [r.doctorId, r.isActiveNow])
    );
    const startedAtByDoctor = new Map(
      startedAtResults.map((r) => [r.doctorId, r.startedAt])
    );
    const boardByDoctor = new Map<string, DoctorQueueBoard>(
      boards.map((board) => [board.doctorId, board])
    );

    // The engine's verdict: this patient's shift closed before their turn came.
    const missedShiftIds = new Set(
      delaySnapshots.flatMap((snapshot) =>
        (snapshot?.appointments ?? [])
          .filter((entry) => entry.isMissedSession)
          .map((entry) => entry.appointmentId)
      )
    );

    // Shifts are looked up only where the queue is numbered per shift.
    const sessionsByDoctor = new Map(
      await Promise.all(
        boards.map(async (board) => {
          const isSessioned = [
            board.currentPatient,
            ...board.waiting,
            ...board.notArrived,
            ...board.onHold,
          ].some((entry) => entry?.sessionIndex != null);
          const sessions: Array<{ start: string; end: string }> = isSessioned
            ? await ScheduleShiftService.listSessions(
                clinicId,
                board.doctorId,
                targetDate,
                true
              ).catch(() => [])
            : [];
          const everyone = [
            board.currentPatient,
            ...board.waiting,
            ...board.notArrived,
            ...board.onHold,
            ...board.completed,
          ].filter((entry): entry is QueueEntry => entry != null);
          const withRoom = await Promise.all(
            sessions.map(async (s, i) => {
              const sessionIndex = i + 1;
              // Only a shift right after one with missed patients can receive a move, so only it pays for capacity.
              const receivesMoves = everyone.some(
                (e) =>
                  e.sessionIndex === sessionIndex - 1 &&
                  missedShiftIds.has(e.appointmentId)
              );
              if (!receivesMoves) return { sessionIndex, ...s };
              const { capacity } = await TokenCapacityService.resolveForSession(
                clinicId,
                board.doctorId,
                targetDate,
                s.start,
                undefined,
                undefined,
                sessionIndex
              ).catch(() => ({ capacity: 0 }));
              // Same clash rule as booking: cancelled and no-show numbers are free again.
              const taken = new Set(
                everyone
                  .filter(
                    (e) =>
                      e.sessionIndex === sessionIndex &&
                      e.tokenNo != null &&
                      !RELEASED_STATUSES.has(e.appointmentStatus)
                  )
                  .map((e) => e.tokenNo as number)
              );
              const freeTokens = Array.from(
                { length: capacity },
                (_, n) => n + 1
              ).filter((token) => !taken.has(token));
              return {
                sessionIndex,
                ...s,
                capacity,
                takenCount: taken.size,
                freeTokens,
              };
            })
          );
          return [board.doctorId, withRoom] as const;
        })
      )
    );

    const toEntry = (entry: QueueEntry): LiveQueueEntry => ({
      appointmentId: entry.appointmentId,
      patientName: entry.patientName,
      slot: toSlot(entry),
      isCheckedIn: entry.position !== 'not_arrived',
      isMissedSession: missedShiftIds.has(entry.appointmentId),
      sessionIndex: entry.sessionIndex,
    });

    const toCurrentEntry = (
      entry: QueueEntry,
      doctorId: string
    ): LiveQueueCurrentEntry => ({
      ...toEntry(entry),
      /*
       * The real instant the doctor took them in. Measuring from the scheduled
       * slot instead reported a 12:30 appointment begun at 12:25 as "since 0
       * min" — the same reading whether the doctor started early, on time, or
       * had not started at all.
       *
       * Falls back to the slot only when that instant is missing (an evicted
       * key, or a consultation that predates this being recorded): a stale
       * timer beats a blank one, but it under-reports an early start, so a
       * value exactly equal to the slot means the fallback fired.
       */
      startedAt:
        startedAtByDoctor.get(doctorId) ??
        (entry.appointmentTime
          ? appointmentInstantIST(
              targetDate,
              entry.appointmentTime
            ).toISOString()
          : null),
    });

    const doctors: DoctorLiveQueue[] = staff.map((s) => {
      const board = boardByDoctor.get(s.userId);
      const current = board?.currentPatient ?? null;

      // Checked-in first, then everyone still expected: the order is what lets
      // reception see the whole day while the controls still target only
      // someone they can actually act on.
      const nextInQueue = [
        ...(board?.waiting ?? []).map(toEntry),
        ...(board?.notArrived ?? []).map(toEntry),
      ];

      // The board's own next, so reception and the doctor's screen can never
      // offer different patients; it already skips a shift worked past.
      const actionTarget = board?.nextPatient?.appointmentId ?? null;
      // A closed shift's patient is moved or rescheduled, never checked in.
      const checkInTarget =
        nextInQueue.find(
          (entry) => !entry.isCheckedIn && !entry.isMissedSession
        )?.appointmentId ?? null;

      return {
        doctorId: s.userId,
        name: s.name ?? 'Unknown',
        profilePhoto: s.profilePhoto ?? null,
        speciality: s.speciality ?? null,
        // Follows the queue, not the roster: availability stays true between
        // patients, so it cannot answer "is someone with them right now".
        status: current ? 'Consulting' : 'Available',
        isAvailableNow: Boolean(activeNowByDoctor.get(s.userId)),
        currentRunning: current ? toCurrentEntry(current, s.userId) : null,
        nextInQueue,
        onHold: (board?.onHold ?? []).map((entry) => ({
          ...toEntry(entry),
          holdReason: entry.holdReason,
        })),
        waitingCount: board?.waiting.length ?? 0,
        totalWaiting: nextInQueue.length,
        actionTarget,
        checkInTarget,
        // Worth announcing only to patients who have not set off yet: nobody
        // in the room, somebody booked, and none of them arrived.
        canAnnounceLate:
          !current &&
          nextInQueue.some((entry) => !entry.isMissedSession) &&
          !nextInQueue.some((entry) => entry.isCheckedIn),
        sessions: sessionsByDoctor.get(s.userId) ?? [],
        // From the cached snapshot already loaded above; lets reception size a move into the next shift.
        consultationMinutes:
          delaySnapshots[staffIds.indexOf(s.userId)]?.consultationMinutes ??
          null,
      } satisfies DoctorLiveQueue;
    });

    return {
      clinicId,
      date: targetDate,
      generatedAt: new Date().toISOString(),
      doctors,
    };
  }
}
