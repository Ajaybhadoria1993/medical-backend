import { and, desc, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AppointmentModel } from '../models/appointment.model';
import { doctorGallery } from '../models/doctorGallery.model';
import { doctorGalleryShare } from '../models/doctorGalleryShare.model';
import type { CreateGalleryShareDto } from '../schemas/galleryShare.schemas';
import { stripS3Signature } from '../../files/utils/s3Ref.utils';
import { GalleryService } from './gallery.service';

const MAX_SHARES_LISTED = 100;
// getDoctorGalleryFromLocal probes at most 20 files per specialty.
const MAX_SUGGESTED_IMAGES = 20;

export class GalleryShareService {
  /** The appointment, only if it is in this clinic and assigned to this doctor. */
  private static async getOwnAppointment(
    appointmentId: string,
    doctorId: string,
    clinicId: string
  ) {
    const [appointment] = await database
      .select({ patientId: AppointmentModel.patientId })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.id, appointmentId),
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId)
        )
      )
      .limit(1);
    if (!appointment) throw new HttpError(404, 'Appointment not found');
    return appointment;
  }

  private static async getOwnGalleryImage(id: string, doctorId: string) {
    const [image] = await database
      .select({ id: doctorGallery.id, imageUrl: doctorGallery.imageUrl })
      .from(doctorGallery)
      .where(
        and(eq(doctorGallery.id, id), eq(doctorGallery.doctorId, doctorId))
      )
      .limit(1);
    return image ?? null;
  }

  /** Accepted only if it is in this doctor's own Suggested list, so no arbitrary URL reaches a patient. */
  private static async getSuggestedImage(url: string, doctorId: string) {
    const suggested = await GalleryService.getDoctorGalleryFromLocal(
      doctorId,
      1,
      MAX_SUGGESTED_IMAGES
    );
    // The list went out signed, so the URL may come back with a signature on it.
    const target = stripS3Signature(url);
    const match = suggested.data.find((image) => image.url === target);
    return match ? { id: null, imageUrl: match.url } : null;
  }

  static async share(
    appointmentId: string,
    doctorId: string,
    clinicId: string,
    dto: CreateGalleryShareDto
  ) {
    const { patientId } = await this.getOwnAppointment(
      appointmentId,
      doctorId,
      clinicId
    );

    const image = dto.galleryImageId
      ? await this.getOwnGalleryImage(dto.galleryImageId, doctorId)
      : await this.getSuggestedImage(dto.suggestedImageUrl!, doctorId);
    if (!image) throw new HttpError(404, 'Image not found');

    // The unique index makes a repeated share a no-op instead of a duplicate row.
    const [share] = await database
      .insert(doctorGalleryShare)
      .values({
        galleryImageId: image.id,
        imageUrl: image.imageUrl,
        appointmentId,
        patientId,
        doctorId,
        note: dto.note || null,
      })
      .onConflictDoNothing()
      .returning();
    if (!share) {
      throw new HttpError(409, 'This image is already shared with the patient');
    }
    return share;
  }

  static async listForDoctor(
    appointmentId: string,
    doctorId: string,
    clinicId: string
  ) {
    await this.getOwnAppointment(appointmentId, doctorId, clinicId);

    return database
      .select({
        id: doctorGalleryShare.id,
        galleryImageId: doctorGalleryShare.galleryImageId,
        imageUrl: doctorGalleryShare.imageUrl,
        note: doctorGalleryShare.note,
        createdAt: doctorGalleryShare.createdAt,
      })
      .from(doctorGalleryShare)
      .where(
        and(
          eq(doctorGalleryShare.appointmentId, appointmentId),
          eq(doctorGalleryShare.doctorId, doctorId)
        )
      )
      .orderBy(desc(doctorGalleryShare.createdAt))
      .limit(MAX_SHARES_LISTED);
  }

  static async unshare(
    appointmentId: string,
    shareId: string,
    doctorId: string,
    clinicId: string
  ) {
    await this.getOwnAppointment(appointmentId, doctorId, clinicId);

    const [deleted] = await database
      .delete(doctorGalleryShare)
      .where(
        and(
          eq(doctorGalleryShare.id, shareId),
          eq(doctorGalleryShare.appointmentId, appointmentId),
          eq(doctorGalleryShare.doctorId, doctorId)
        )
      )
      .returning({ id: doctorGalleryShare.id });
    if (!deleted) throw new HttpError(404, 'Shared image not found');
    return deleted;
  }
}
