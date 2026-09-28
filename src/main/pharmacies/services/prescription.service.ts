import { and, eq, gte, lte, sql, desc, between } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import { ReportCardModel } from '../../reports/models/reports.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { PrescriptionQueueModel } from '../../pharmacy/models/prescriptionQueue.model';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { PharmacyStockService } from './stock.service';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { doctorManualPrescriptionModel } from '../../appointments/models/doctorManualPrescription.model';

export class PrescriptionService {
  static async getPrescriptions(
    clinicId: string,
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      status?: 'PENDING' | 'ON_HOLD' | 'COMPLETED' | 'REJECTED';
      doctorId?: string;
      patientId?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    }
  ) {
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);

    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: any[] = [eq(PrescriptionQueueModel.clinicId, clinicId)];

    if (query.status) {
      conditions.push(eq(PrescriptionQueueModel.status, query.status));
    }

    if (query.doctorId) {
      conditions.push(eq(PrescriptionQueueModel.doctorId, query.doctorId));
    }

    if (query.startDate && query.endDate) {
      conditions.push(
        between(
          PrescriptionQueueModel.createdAt,
          new Date(query.startDate),
          new Date(query.endDate)
        )
      );
    } else if (query.startDate) {
      // gte/lte, not a raw sql`` template: the column helpers run the Date
      // through the timestamp column's driver mapper. Interpolating a Date into
      // sql`` skips it and postgres-js rejects the param with
      // ERR_INVALID_ARG_TYPE.
      conditions.push(
        gte(PrescriptionQueueModel.createdAt, new Date(query.startDate))
      );
    } else if (query.endDate) {
      conditions.push(
        lte(PrescriptionQueueModel.createdAt, new Date(query.endDate))
      );
    }

    // Total count query
    const [{ count }] = await database
      .select({
        count: sql<number>`count(*)`,
      })
      .from(PrescriptionQueueModel)
      .where(and(...conditions));

    const totalRecords = Number(count);

    let prescriptions = await database
      .select({
        id: PrescriptionQueueModel.id,
        reportId: PrescriptionQueueModel.reportId,
        appointmentId: PrescriptionQueueModel.appointmentId,
        doctorId: PrescriptionQueueModel.doctorId,
        clinicId: PrescriptionQueueModel.clinicId,
        status: PrescriptionQueueModel.status,
        pharmacyUserId: PrescriptionQueueModel.pharmacyUserId,
        pharmacistName: sql<string>`pharmacist.name`,
        createdAt: PrescriptionQueueModel.createdAt,
        updatedAt: PrescriptionQueueModel.updatedAt,

        patientId: UserModel.id,
        patientName: UserModel.name,
        patientMobile: UserModel.mobile,
        patientAge: UserProfileModel.age,
        patientGender: UserProfileModel.gender,
        patientAddress: UserProfileModel.address,
        patientCity: UserProfileModel.city,
        patientState: UserProfileModel.state,

        doctorName: sql<string>`doctor.name`,
        doctorSpeciality: sql<string>`COALESCE(doctor_speciality.speciality, 'General')`,

        prescriptionPdf: sql<string>`COALESCE(${ReportCardModel.prescriptionPdf}, ${doctorManualPrescriptionModel.doctorManualPrescription})`,
      })
      .from(PrescriptionQueueModel)
      .leftJoin(
        ReportCardModel,
        eq(PrescriptionQueueModel.reportId, ReportCardModel.id)
      )
      .leftJoin(
        AppointmentModel,
        eq(PrescriptionQueueModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(
          doctorManualPrescriptionModel.appointmentId,
          PrescriptionQueueModel.appointmentId
        )
      )
      .leftJoin(
        UserModel,
        eq(
          UserModel.id,
          sql`COALESCE(${ReportCardModel.petientId}, ${AppointmentModel.patientId})`
        )
      )
      .leftJoin(UserProfileModel, eq(UserModel.id, UserProfileModel.userId))
      .leftJoin(
        sql`users AS doctor`,
        eq(PrescriptionQueueModel.doctorId, sql`doctor.id`)
      )
      .leftJoin(
        sql`user_professionals AS doctor_speciality`,
        eq(PrescriptionQueueModel.doctorId, sql`doctor_speciality.user_id`)
      )
      .leftJoin(
        sql`users AS pharmacist`,
        eq(PrescriptionQueueModel.pharmacyUserId, sql`pharmacist.id`)
      )
      .where(and(...conditions))
      .orderBy(desc(PrescriptionQueueModel.createdAt))
      .limit(limit)
      .offset(offset);

    // Existing search filter
    if (query.search?.trim()) {
      const searchPattern = query.search.trim().toLowerCase();

      prescriptions = prescriptions.filter(
        (prescription) =>
          prescription.patientName?.toLowerCase().includes(searchPattern) ||
          prescription.doctorName?.toLowerCase().includes(searchPattern) ||
          prescription.status?.toLowerCase().includes(searchPattern)
      );
    }

    if (query.patientId) {
      prescriptions = prescriptions.filter(
        (prescription) => prescription.patientId === query.patientId
      );
    }

    const formattedPrescriptions = prescriptions.map((prescription) => ({
      id: prescription.id,
      status: prescription.status,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt,

      patient: {
        id: prescription.patientId,
        name: prescription.patientName,
        mobile: prescription.patientMobile,
        age: prescription.patientAge,
        gender: prescription.patientGender,
        address: prescription.patientAddress,
        city: prescription.patientCity,
        state: prescription.patientState,
      },

      doctor: {
        id: prescription.doctorId,
        name: prescription.doctorName,
        speciality: prescription.doctorSpeciality,
      },

      pharmacist: {
        id: prescription.pharmacyUserId,
        name: prescription.pharmacistName,
      },

      prescriptionPdf: prescription.prescriptionPdf,
      reportId: prescription.reportId,
      appointmentId: prescription.appointmentId,
    }));

    return {
      prescriptions: formattedPrescriptions,
      pagination: {
        totalRecords,
        totalPages: Math.ceil(totalRecords / pageSize),
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async getPrescriptionById(
    id: string,
    clinicId: string,
    pharmacyId: string
  ) {
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const [prescription] = await database
      .select({
        id: PrescriptionQueueModel.id,
        reportId: PrescriptionQueueModel.reportId,
        appointmentId: PrescriptionQueueModel.appointmentId,
        doctorId: PrescriptionQueueModel.doctorId,
        clinicId: PrescriptionQueueModel.clinicId,
        status: PrescriptionQueueModel.status,
        pharmacyUserId: PrescriptionQueueModel.pharmacyUserId,
        pharmacistName: sql<string>`pharmacist.name`,
        createdAt: PrescriptionQueueModel.createdAt,
        updatedAt: PrescriptionQueueModel.updatedAt,

        patientId: UserModel.id,
        patientName: UserModel.name,
        patientMobile: UserModel.mobile,
        patientAge: UserProfileModel.age,
        patientGender: UserProfileModel.gender,

        doctorName: sql<string>`doctor.name`,
        doctorSpeciality: sql<string>`COALESCE(doctor_speciality.speciality, 'General')`,

        prescriptionPdf: sql<string>`COALESCE(${ReportCardModel.prescriptionPdf}, ${doctorManualPrescriptionModel.doctorManualPrescription})`,
      })
      .from(PrescriptionQueueModel)
      .leftJoin(
        ReportCardModel,
        eq(PrescriptionQueueModel.reportId, ReportCardModel.id)
      )
      .leftJoin(
        AppointmentModel,
        eq(PrescriptionQueueModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(
          doctorManualPrescriptionModel.appointmentId,
          PrescriptionQueueModel.appointmentId
        )
      )
      .leftJoin(
        UserModel,
        eq(
          UserModel.id,
          sql`COALESCE(${ReportCardModel.petientId}, ${AppointmentModel.patientId})`
        )
      )
      .leftJoin(UserProfileModel, eq(UserModel.id, UserProfileModel.userId))
      .leftJoin(
        sql`users AS doctor`,
        eq(PrescriptionQueueModel.doctorId, sql`doctor.id`)
      )
      .leftJoin(
        sql`user_professionals AS doctor_speciality`,
        eq(PrescriptionQueueModel.doctorId, sql`doctor_speciality.user_id`)
      )
      .leftJoin(
        sql`users AS pharmacist`,
        eq(PrescriptionQueueModel.pharmacyUserId, sql`pharmacist.id`)
      )
      .where(
        and(
          eq(PrescriptionQueueModel.id, id),
          eq(PrescriptionQueueModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!prescription) {
      throw new HttpError(404, 'Prescription not found');
    }

    const medicines = await database
      .select({
        medicineName: sql<string>`prescriptions.medicine_name`,
        prescribedForm: sql<string>`medicines.form`,
        dosage: sql<string>`prescriptions.dosage`,
        frequency: sql<string>`prescriptions.frequency`,
        duration: sql<string>`prescriptions.duration`,
      })
      .from(sql`prescriptions`)
      .leftJoin(
        sql`medicines`,
        eq(sql`prescriptions.medicine_id`, sql`medicines.id`)
      )
      .where(eq(sql`prescriptions.report_card_id`, prescription.reportId));

    const stockResult = await PharmacyStockService.getAvailableStock(
      pharmacyId,
      {
        pageNumber: 1,
        pageSize: 100,
      }
    );

    const stockMedicines = stockResult.stocks;

    const normalize = (name: unknown) =>
      String(name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const enrichedMedicines = medicines.map((med) => {
      const prescriptionName = normalize(med.medicineName);

      let matchingStock = null;

      for (const stock of stockMedicines) {
        const stockName = normalize(stock.medicineName);

        if (stockName === prescriptionName) {
          matchingStock = stock;
          break;
        }
      }

      const defaultBatchId = matchingStock?.medicineAvailable?.[0]?.id || null;

      const stockTags = matchingStock?.tags || [];

      return {
        // Prescribed medicine details (from doctor's prescription + Medicine model)
        medicineName: med.medicineName,
        prescribedForm: med.prescribedForm,
        dosage: med.dosage,
        frequency: med.frequency,
        duration: med.duration,
        isAvailable: !!matchingStock,

        stockMedicine: matchingStock
          ? {
              id: matchingStock.id,
              medicineName: matchingStock.medicineName,
              brandName: matchingStock.brandName,
              composition: matchingStock.composition,
              category: matchingStock.category,
              form: matchingStock.form,
              shelf: matchingStock.shelf,
              packOf: matchingStock.packOf,
              tags: stockTags,
              availableQuantity: matchingStock.availableQuantity,
              defaultBatchId: defaultBatchId,
              medicineAvailable: matchingStock.medicineAvailable,
            }
          : null,
      };
    });

    return {
      id: prescription.id,
      status: prescription.status,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt,

      patient: {
        id: prescription.patientId,
        name: prescription.patientName,
        mobile: prescription.patientMobile,
        age: prescription.patientAge,
        gender: prescription.patientGender,
      },

      doctor: {
        id: prescription.doctorId,
        name: prescription.doctorName,
        speciality: prescription.doctorSpeciality,
      },

      pharmacist: {
        id: prescription.pharmacyUserId,
        name: prescription.pharmacistName,
      },

      prescriptionPdf: prescription.prescriptionPdf,
      medicines: enrichedMedicines,
      reportId: prescription.reportId,
      pharmacyUserId: prescription.pharmacyUserId,
    };
  }

  static async updatePrescriptionStatus(
    id: string,
    clinicId: string,
    status: 'PENDING' | 'ON_HOLD' | 'COMPLETED' | 'REJECTED',
    pharmacyUserId: string,
    pharmacyId: string
  ) {
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }
    // Verify prescription exists and belongs to clinic
    const [existingPrescription] = await database
      .select({ id: PrescriptionQueueModel.id })
      .from(PrescriptionQueueModel)
      .where(
        and(
          eq(PrescriptionQueueModel.id, id),
          eq(PrescriptionQueueModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!existingPrescription) {
      throw new HttpError(404, 'Prescription not found');
    }

    // Update status
    const [updated] = await database
      .update(PrescriptionQueueModel)
      .set({
        status,
        pharmacyUserId,
        updatedAt: new Date(),
      })
      .where(eq(PrescriptionQueueModel.id, id))
      .returning();

    return updated;
  }

  static async checkMedicinesExist(
    pharmacyId: string,
    medicineNames: string[]
  ) {
    const normalize = (name: unknown) =>
      String(name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const medicines = await database
      .select({
        id: pharmacyMedicineModel.id,
        medicineName: pharmacyMedicineModel.medicineName,
      })
      .from(pharmacyMedicineModel)
      .where(
        and(
          eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.status, 'active')
        )
      );

    return medicineNames.map((requestedName) => {
      const normalizedRequested = normalize(requestedName);

      const exists = medicines.some(
        (medicine) => normalize(medicine.medicineName) === normalizedRequested
      );

      return {
        medicineName: requestedName,
        exists,
      };
    });
  }

  static async getPrescriptionStats(pharmacyId: string) {
    // Verify pharmacy exists
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    // ==================== PRESCRIPTION STATS ====================
    const prescriptionsResult = await database
      .select({
        status: PrescriptionQueueModel.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(PrescriptionQueueModel)
      .innerJoin(
        PharmacyModel,
        eq(PrescriptionQueueModel.clinicId, PharmacyModel.clinicId)
      )
      .where(eq(PharmacyModel.id, pharmacyId))
      .groupBy(PrescriptionQueueModel.status);

    const prescriptionsByStatus = {
      pending: 0,
      onHold: 0,
      completed: 0,
      rejected: 0,
    };

    prescriptionsResult.forEach((result) => {
      const count = Number(result.count);
      if (result.status === 'PENDING') {
        prescriptionsByStatus.pending = count;
      } else if (result.status === 'ON_HOLD') {
        prescriptionsByStatus.onHold = count;
      } else if (result.status === 'COMPLETED') {
        prescriptionsByStatus.completed = count;
      } else if (result.status === 'REJECTED') {
        prescriptionsByStatus.rejected = count;
      }
    });

    const totalPrescriptions =
      prescriptionsByStatus.pending +
      prescriptionsByStatus.onHold +
      prescriptionsByStatus.completed +
      prescriptionsByStatus.rejected;

    const calculatePercentage = (count: number) => {
      if (totalPrescriptions === 0) return 0;
      return Number(((count / totalPrescriptions) * 100).toFixed(2));
    };

    return {
      pending: {
        count: prescriptionsByStatus.pending,
        percentageOfTotal: calculatePercentage(prescriptionsByStatus.pending),
      },
      onHold: {
        count: prescriptionsByStatus.onHold,
        percentageOfTotal: calculatePercentage(prescriptionsByStatus.onHold),
      },
      completed: {
        count: prescriptionsByStatus.completed,
        percentageOfTotal: calculatePercentage(prescriptionsByStatus.completed),
      },
      rejected: {
        count: prescriptionsByStatus.rejected,
        percentageOfTotal: calculatePercentage(prescriptionsByStatus.rejected),
      },
    };
  }
}
