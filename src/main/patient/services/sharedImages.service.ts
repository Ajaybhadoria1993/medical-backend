import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { doctorGalleryShare } from '../../appointments/models/doctorGalleryShare.model';
import { UserModel } from '../../users/models/user.model';
import { PatientFamilyLinksModel } from '../models/patientFamilyLinks.model';

const MAX_SHARES_LISTED = 100;

export class PatientSharedImagesService {
  /** Images the doctor shared on this visit, for the patient or a family member they manage. */
  static async listForAppointment(userId: string, appointmentId: string) {
    const familyIds = database
      .select({ id: PatientFamilyLinksModel.linkedPatientId })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    return database
      .select({
        id: doctorGalleryShare.id,
        imageUrl: doctorGalleryShare.imageUrl,
        note: doctorGalleryShare.note,
        doctorName: UserModel.name,
        createdAt: doctorGalleryShare.createdAt,
      })
      .from(doctorGalleryShare)
      .leftJoin(UserModel, eq(UserModel.id, doctorGalleryShare.doctorId))
      .where(
        and(
          eq(doctorGalleryShare.appointmentId, appointmentId),
          or(
            eq(doctorGalleryShare.patientId, userId),
            inArray(doctorGalleryShare.patientId, familyIds)
          )
        )
      )
      .orderBy(desc(doctorGalleryShare.createdAt))
      .limit(MAX_SHARES_LISTED);
  }
}
