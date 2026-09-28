import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { NoShowPolicyModel } from '../models/noShowPolicy.model';

export type LatePatientPolicy = 'keep_position' | 'move_back' | 'move_to_end';

/** Matches the no-show policy default, so "late" means one thing per clinic. */
const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_POLICY: LatePatientPolicy = 'move_back';
const DEFAULT_MOVE_POSITIONS = 2;

/**
 * Large enough to sink an appointment to the back of any realistic day, without
 * needing a separate "to the end" concept in the queue reorder itself. The
 * reorder steps over live appointments and stops at the end of the list, so an
 * oversized count simply lands it last.
 */
const MOVE_TO_END_POSITIONS = 999;

export interface LateArrivalAssessment {
  /** Minutes past the scheduled time, 0 when on time or early. */
  lateByMinutes: number;
  /** True once lateness exceeds the clinic's grace period. */
  isLate: boolean;
  policy: LatePatientPolicy;
  /** Places to move back; 0 means the patient keeps their position. */
  demotion: number;
}

/**
 * LatePatientService
 *
 * Decides what happens to a patient who checks in after their slot.
 *
 * Before this existed the answer was implicit and binary: inside the grace
 * period nothing happened at all, and outside it the auto-no-show job marked
 * them a no-show and the queue closed over them. There was no way to admit a
 * late patient while still protecting the people who arrived on time.
 *
 * Lateness is measured against the no-show policy's existing
 * `gracePeriodMinutes` rather than a second threshold of its own — two
 * independent definitions of "late" in one clinic would inevitably drift apart.
 */
export class LatePatientService {
  /**
   * Assesses an arrival against the clinic's policy.
   *
   * Never throws: a missing policy row, an unreadable settings row or a
   * malformed appointment time all resolve to "not late", because failing to
   * penalise a patient is a far better failure mode than penalising one by
   * accident.
   */
  static async assess(
    clinicId: string,
    scheduledTime: string | null,
    arrivedAt: Date
  ): Promise<LateArrivalAssessment> {
    const notLate: LateArrivalAssessment = {
      lateByMinutes: 0,
      isLate: false,
      policy: 'keep_position',
      demotion: 0,
    };

    try {
      const scheduledMinutes = this.parseTimeToMinutes(scheduledTime);

      // A token appointment has no promised clock time, so there is nothing to
      // be late *against*. Its position in the queue is already whatever the
      // queue says it is.
      if (scheduledMinutes === null) return notLate;

      const arrivedMinutes = arrivedAt.getHours() * 60 + arrivedAt.getMinutes();
      const lateByMinutes = Math.max(0, arrivedMinutes - scheduledMinutes);

      const [graceMinutes, settings] = await Promise.all([
        this.getGraceMinutes(clinicId),
        this.getPolicy(clinicId),
      ]);

      if (lateByMinutes <= graceMinutes) {
        return { ...notLate, lateByMinutes };
      }

      const demotion =
        settings.policy === 'keep_position'
          ? 0
          : settings.policy === 'move_to_end'
            ? MOVE_TO_END_POSITIONS
            : settings.movePositions;

      return {
        lateByMinutes,
        isLate: true,
        policy: settings.policy,
        demotion,
      };
    } catch (error) {
      logger.error(
        `[LatePatient] Assessment failed for clinic=${clinicId}; treating as on time`,
        { error }
      );
      return notLate;
    }
  }

  private static async getGraceMinutes(clinicId: string): Promise<number> {
    const [policy] = await database
      .select({ gracePeriodMinutes: NoShowPolicyModel.gracePeriodMinutes })
      .from(NoShowPolicyModel)
      .where(
        and(
          eq(NoShowPolicyModel.clinicId, clinicId),
          eq(NoShowPolicyModel.isActive, true)
        )
      )
      .limit(1);

    return policy?.gracePeriodMinutes ?? DEFAULT_GRACE_MINUTES;
  }

  private static async getPolicy(clinicId: string): Promise<{
    policy: LatePatientPolicy;
    movePositions: number;
  }> {
    const [settings] = await database
      .select({
        latePatientPolicy: ClinicSettingsModel.latePatientPolicy,
        latePatientMovePositions: ClinicSettingsModel.latePatientMovePositions,
      })
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, clinicId))
      .limit(1);

    const movePositions = settings?.latePatientMovePositions;

    return {
      policy:
        (settings?.latePatientPolicy as LatePatientPolicy) ?? DEFAULT_POLICY,
      movePositions:
        typeof movePositions === 'number' && movePositions > 0
          ? movePositions
          : DEFAULT_MOVE_POSITIONS,
    };
  }

  /** "13:00" / "13:00:00" → minutes since midnight. */
  private static parseTimeToMinutes(time: string | null): number | null {
    if (!time) return null;
    const parts = time.split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
  }

  /** Exposed for tests — the policy → demotion mapping is the decision worth pinning. */
  static demotionFor(policy: LatePatientPolicy, movePositions: number): number {
    if (policy === 'keep_position') return 0;
    if (policy === 'move_to_end') return MOVE_TO_END_POSITIONS;
    return movePositions;
  }
}
