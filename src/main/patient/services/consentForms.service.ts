import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import type { AuthUser } from '../../../middlewear/auth.middleware';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { planConsentForms } from '../../treatmentPlan';
import { UserModel } from '../../users/models/user.model';
import type { PatientConsentForm } from '../types/consentForms.types';

export class PatientConsentFormsService {
  /** Both sources read live, so an upload on either page shows here; a Doctor sees only their own. */
  static async list(
    clinicId: string,
    user: AuthUser,
    patientId: string
  ): Promise<PatientConsentForm[]> {
    const isDoctor = user.userType === 'Doctor';
    const [visits, plans] = await Promise.all([
      database
        .select({
          id: AppointmentModel.id,
          date: AppointmentModel.appointmentDate,
          doctorName: UserModel.name,
        })
        .from(AppointmentClinicalModel)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentClinicalModel.appointmentId, AppointmentModel.id)
        )
        .leftJoin(UserModel, eq(UserModel.id, AppointmentModel.doctorId))
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.patientId, patientId),
            isNotNull(AppointmentClinicalModel.consentFile),
            isDoctor ? eq(AppointmentModel.doctorId, user.id) : undefined
          )
        ),
      planConsentForms(
        clinicId,
        { id: user.id, isDoctor, userType: user.userType },
        patientId
      ),
    ]);

    const names = await this.doctorNames([
      ...new Set(plans.map((p) => p.doctorId)),
    ]);
    const forms: PatientConsentForm[] = [
      ...visits.map((v) => ({
        source: 'appointment' as const,
        id: v.id,
        title: 'Appointment Consent',
        doctorName: v.doctorName,
        date: v.date,
      })),
      ...plans.map((p) => ({
        source: 'plan' as const,
        id: p.planId,
        title: p.optionLabel ? `${p.title} (Option ${p.optionLabel})` : p.title,
        doctorName: names.get(p.doctorId) ?? null,
        date: p.acceptedAt,
      })),
    ];
    return forms.sort(
      (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)
    );
  }

  private static async doctorNames(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const rows = await database
      .select({ id: UserModel.id, name: UserModel.name })
      .from(UserModel)
      .where(inArray(UserModel.id, ids));
    return new Map(rows.map((r) => [r.id, r.name ?? '']));
  }
}
