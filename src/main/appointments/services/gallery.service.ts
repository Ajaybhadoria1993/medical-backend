import { and, desc, eq, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { deleteFromS3 } from '../../../configurations/s3';
import { HttpError } from '../../../middlewear/errorHandler';
import { isDoctorAssignedToClinic } from '../../../utils/clinicOwnership';
import { findReferenceImages } from '../../../utils/referenceImages';
import { UserModel } from '../../users/models/user.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { AppointmentModel } from '../models/appointment.model';
import { doctorGallery } from '../models/doctorGallery.model';
import { patientGallery } from '../models/patientGallery.model';
import { CreatePatientGalleryDto } from '../schemas/appointment.schemas';

/** Paging block every gallery list returns. */
function pageInfo(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/** Patient images per appointment and the doctor's own gallery, stored in S3. */
export class GalleryService {
  /** Saves a patient gallery image uploaded by the doctor. */
  static async createGalleryImage(
    doctorId: string,
    imageUrl: string,
    data: CreatePatientGalleryDto
  ) {
    const [result] = await database
      .insert(patientGallery)
      .values({
        appointmentId: data.appointmentId,
        patientId: data.patientId,
        doctorId: doctorId,
        imageUrl,
        description: data.description,
      })
      .returning();

    return result;
  }

  /** Paged patient gallery by patient or appointment; clinic-scoped for staff. */
  static async getPatientGallery(
    patientId?: string,
    appointmentId?: string,
    page: number = 1,
    limit: number = 30,
    clinicId?: string
  ) {
    // Staff calls pass clinicId: another clinic's patient reads as absent. The appointmentId path is route-scoped.
    if (
      clinicId &&
      patientId &&
      !(await isDoctorAssignedToClinic(patientId, clinicId))
    ) {
      throw new HttpError(404, 'Patient not found');
    }
    const offset = (page - 1) * limit;
    // and() skips undefined parts, so this covers patient, appointment, both, or neither.
    const filter = and(
      patientId ? eq(patientGallery.patientId, patientId) : undefined,
      appointmentId
        ? eq(patientGallery.appointmentId, appointmentId)
        : undefined
    );

    const [countResult, data] = await Promise.all([
      database
        .select({ count: sql<number>`count(*)` })
        .from(patientGallery)
        .where(filter),
      database
        .select()
        .from(patientGallery)
        .where(filter)
        .orderBy(desc(patientGallery.createdAt))
        .limit(limit)
        .offset(offset),
    ]);
    const total = Number(countResult[0]?.count) || 0;

    return { data, pagination: pageInfo(total, page, limit) };
  }

  /** One patient gallery image by id. */
  static async getGalleryImageById(id: string) {
    const [result] = await database
      .select()
      .from(patientGallery)
      .where(eq(patientGallery.id, id));

    return result;
  }

  /** Deletes the doctor's own patient gallery image and its S3 file. */
  static async deleteGalleryImage(id: string, doctorId: string) {
    const image = await this.getGalleryImageById(id);

    if (!image) {
      throw new HttpError(404, 'Image not found');
    }

    if (image.doctorId != doctorId) {
      throw new HttpError(403, 'You do not have access to delete this image.');
    }

    if (image.imageUrl) {
      await deleteFromS3(image.imageUrl);
    }

    const [result] = await database
      .delete(patientGallery)
      .where(eq(patientGallery.id, id))
      .returning();

    return result;
  }

  /** Deletes all gallery images of the doctor's appointment, with their S3 files. */
  static async deleteGalleryImagesByAppointment(
    appointmentId: string,
    doctorId: string
  ) {
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId));

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found');
    }

    if (appointment.doctorId !== doctorId) {
      throw new HttpError(403, 'You do not have access to delete this images.');
    }

    const { data: images } = await this.getPatientGallery(
      undefined,
      appointmentId
    );

    for (const image of images) {
      if (image.imageUrl) {
        await deleteFromS3(image.imageUrl);
      }
    }

    const result = await database
      .delete(patientGallery)
      .where(eq(patientGallery.appointmentId, appointmentId))
      .returning();

    return result;
  }

  /** Saves an image to the doctor's own gallery. */
  static async createDoctorGalleryImage(doctorId: string, imageUrl: string) {
    const [result] = await database
      .insert(doctorGallery)
      .values({
        doctorId: doctorId,
        imageUrl: imageUrl,
      })
      .returning();

    return result;
  }

  /** Paged images from the doctor's own gallery. */
  static async getDoctorGallery(
    doctorId: string,
    page: number = 1,
    limit: number = 30
  ) {
    const offset = (page - 1) * limit;

    const countResult = await database
      .select({ count: sql<number>`count(*)` })
      .from(doctorGallery)
      .where(eq(doctorGallery.doctorId, doctorId));

    const total = Number(countResult[0]?.count) || 0;

    const data = await database
      .select()
      .from(doctorGallery)
      .where(eq(doctorGallery.doctorId, doctorId))
      .orderBy(desc(doctorGallery.createdAt))
      .limit(limit)
      .offset(offset);

    return { data, pagination: pageInfo(total, page, limit) };
  }

  /** One doctor gallery image by id. */
  static async getDoctorGalleryImageById(id: string) {
    const [result] = await database
      .select()
      .from(doctorGallery)
      .where(eq(doctorGallery.id, id));

    return result;
  }

  /** Deletes the doctor's own gallery image and its S3 file. */
  static async deleteDoctorGalleryImage(id: string, doctorId: string) {
    const image = await this.getDoctorGalleryImageById(id);

    if (!image) {
      throw new HttpError(404, 'Image not found');
    }

    if (image.doctorId !== doctorId) {
      throw new HttpError(403, 'You do not have access to delete this image.');
    }

    if (image.imageUrl) {
      await deleteFromS3(image.imageUrl);
    }

    const [result] = await database
      .delete(doctorGallery)
      .where(eq(doctorGallery.id, id))
      .returning();

    return result;
  }

  /** The default images for the doctor's main speciality, one page of them. */
  static async getDoctorGalleryFromLocal(
    doctorId: string,
    page: number = 1,
    limit: number = 30
  ) {
    const [row] = await database
      .select({ specialty: UserProfessionalModel.speciality })
      .from(UserModel)
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .where(eq(UserModel.id, doctorId));

    const images = findReferenceImages(row?.specialty || 'General Physician');
    return {
      data: images.slice((page - 1) * limit, page * limit),
      pagination: pageInfo(images.length, page, limit),
    };
  }
}
