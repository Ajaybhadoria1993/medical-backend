import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString } from '../../../utils/istDateTime';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import {
  DoctorSessionOverrideModel,
  NewDoctorSessionOverride,
} from '../models/doctorSessionOverride.model';
import { DismissMissedSlotDto } from '../schemas/missedSlotDismissal.schemas';

/** Marks a past, never-booked grid slot as handled (shifted elsewhere / acknowledged) so `getAvailableSlots` stops offering it — same append-only override table as slot_config/extra_slots, one row per dismissed time. */
export class MissedSlotDismissalService {
  static async dismissSlot(
    clinicId: string,
    actor: { id: string; userType: string },
    dto: DismissMissedSlotDto
  ): Promise<{ forDate: string; slotStart: string }> {
    const doctorId = this.resolveTargetDoctorId(actor, dto.doctorId);
    await this.assertDoctorBelongsToClinic(clinicId, doctorId);

    // A "missed" slot is by definition already past — dismissing one for a future date makes no sense.
    if (dto.forDate > getISTDateString()) {
      throw new HttpError(400, 'Cannot dismiss a slot for a future date');
    }

    await database.insert(DoctorSessionOverrideModel).values({
      clinicId,
      doctorId,
      forDate: dto.forDate,
      type: 'missed_dismissed',
      sessionStart: dto.slotStart,
      createdBy: actor.id,
    } satisfies NewDoctorSessionOverride);

    return { forDate: dto.forDate, slotStart: dto.slotStart };
  }

  /** Every slot start dismissed for this doctor/day — used by `AvailableSlotsService` to drop them from the list entirely. */
  static async getDismissedSlots(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<Set<string>> {
    const rows = await database
      .select({ sessionStart: DoctorSessionOverrideModel.sessionStart })
      .from(DoctorSessionOverrideModel)
      .where(
        and(
          eq(DoctorSessionOverrideModel.clinicId, clinicId),
          eq(DoctorSessionOverrideModel.doctorId, doctorId),
          eq(DoctorSessionOverrideModel.forDate, date),
          eq(DoctorSessionOverrideModel.type, 'missed_dismissed')
        )
      );

    return new Set(
      rows.map((r) => r.sessionStart).filter((v): v is string => !!v)
    );
  }

  private static resolveTargetDoctorId(
    actor: { id: string; userType: string },
    requestedDoctorId?: string
  ): string {
    if (actor.userType !== 'Doctor') {
      if (!requestedDoctorId) {
        throw new HttpError(400, 'doctorId is required');
      }
      return requestedDoctorId;
    }

    if (requestedDoctorId && requestedDoctorId !== actor.id) {
      throw new HttpError(
        403,
        'A doctor can only dismiss slots on their own day'
      );
    }
    return actor.id;
  }

  private static async assertDoctorBelongsToClinic(
    clinicId: string,
    doctorId: string
  ): Promise<void> {
    const [assigned] = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          eq(ClinicAssignModel.userId, doctorId)
        )
      );

    if (!assigned) {
      throw new HttpError(400, `Not a doctor in this clinic: ${doctorId}`);
    }
  }
}
