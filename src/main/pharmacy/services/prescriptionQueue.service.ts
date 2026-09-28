import {
  and,
  desc,
  eq,
  ilike,
  or,
  sql,
  lte,
  gte,
  asc,
  between,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { PrescriptionQueueModel } from '../models/prescriptionQueue.model';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { MedicineModel } from '../../medicine/models/medicine.model';
import {
  PrescriptionModel,
  ReportCardModel,
} from '../../reports/models/reports.model';
import { alias } from 'drizzle-orm/pg-core';
import { pagination } from '../../../utils/utils';

export class PrescriptionQueueService {
  static async createEntry(data: {
    reportId?: string;
    appointmentId: string;
    doctorId: string;
    clinicId: string;
    pharmacyUserId?: string;
  }) {
    return await database
      .insert(PrescriptionQueueModel)
      .values({
        ...data,
        status: 'PENDING',
      })
      .returning();
  }

  static async updateStatus(
    id: string,
    status: 'PENDING' | 'ON_HOLD' | 'COMPLETED' | 'REJECTED',
    pharmacyUserId: string
  ) {
    return await database
      .update(PrescriptionQueueModel)
      .set({ status, pharmacyUserId, updatedAt: new Date() }) // update pharmacyId too
      .where(eq(PrescriptionQueueModel.id, id))
      .returning();
  }

  static async getList(query: {
    clinicId: string;
    page: string;
    limit: string;
    sort?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }) {
    const { limit, offset } = pagination(query.page, query.limit);
    const doctor = alias(UserModel, 'doctor');
    const patient = alias(UserModel, 'patient');

    let whereCondition = eq(PrescriptionQueueModel.clinicId, query.clinicId);

    if (query.status) {
      whereCondition = and(
        whereCondition,
        eq(
          PrescriptionQueueModel.status,
          query.status as 'PENDING' | 'ON_HOLD' | 'COMPLETED' | 'REJECTED'
        )
      )!;
    }

    if (query.startDate && query.endDate) {
      const start = new Date(query.startDate);
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      whereCondition = and(
        whereCondition,
        between(PrescriptionQueueModel.createdAt, start, end)
      )!;
    }

    if (query.search) {
      const searchPattern = `%${query.search}%`;
      whereCondition = and(
        whereCondition,
        or(
          ilike(doctor.name, searchPattern),
          ilike(patient.name, searchPattern),
          // Search in medicine names - simpler approach: filter rows where medicine matches
          ilike(PrescriptionModel.medicineName, searchPattern)
        )
      )!;
    }

    // We need to fetch the list.
    // Note: If we search by medicine name, the array_agg might be incomplete if we don't handle it carefully,
    // but for now this is a standard implementation.

    const data = await database
      .select({
        id: PrescriptionQueueModel.id,
        status: PrescriptionQueueModel.status,
        createdAt: PrescriptionQueueModel.createdAt,
        doctorName: doctor.name,
        patientName: patient.name,
        medicineNames: sql<
          string[]
        >`array_agg(DISTINCT CONCAT(${PrescriptionModel.medicineName},' ', ${PrescriptionModel.strength},'(mg)'))`,
      })
      .from(PrescriptionQueueModel)
      .leftJoin(doctor, eq(PrescriptionQueueModel.doctorId, doctor.id))
      .leftJoin(
        AppointmentModel,
        eq(PrescriptionQueueModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(patient, eq(AppointmentModel.patientId, patient.id))
      .leftJoin(
        ReportCardModel,
        eq(PrescriptionQueueModel.reportId, ReportCardModel.id)
      )
      .leftJoin(
        PrescriptionModel,
        eq(ReportCardModel.id, PrescriptionModel.reportCardId)
      )
      .where(whereCondition)
      .groupBy(
        PrescriptionQueueModel.id,
        PrescriptionQueueModel.status,
        PrescriptionQueueModel.createdAt,
        doctor.name,
        patient.name
      )
      .orderBy(
        query.sort === 'asc'
          ? asc(PrescriptionQueueModel.createdAt)
          : desc(PrescriptionQueueModel.createdAt)
      )
      .limit(Number(limit))
      .offset(Number(offset));

    // Get total count for pagination
    // This is expensive with complex joins and groupBy, simplified count:
    // We can't easily get exact count with groupBy without a subquery.
    // For now, we'll return the data and maybe a separate count query if needed,
    // or just execute a count query without limit/offset.

    // Simplified count query (might be inaccurate if search filters by medicine)
    // To be accurate, we need the same joins.
    const countResult = await database
      .select({
        count: sql<number>`count(DISTINCT ${PrescriptionQueueModel.id})`,
      })
      .from(PrescriptionQueueModel)
      .leftJoin(doctor, eq(PrescriptionQueueModel.doctorId, doctor.id))
      .leftJoin(
        AppointmentModel,
        eq(PrescriptionQueueModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(patient, eq(AppointmentModel.patientId, patient.id))
      .leftJoin(
        ReportCardModel,
        eq(PrescriptionQueueModel.reportId, ReportCardModel.id)
      )
      .leftJoin(
        PrescriptionModel,
        eq(ReportCardModel.id, PrescriptionModel.reportCardId)
      )
      .where(whereCondition);

    return {
      data,
      total: Number(countResult[0]?.count || 0),
      page: Number(query.page),
      limit: Number(limit),
    };
  }
  static async getFrequentMedicines(
    clinicId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      sort?: 'createdAt' | 'name';
      order?: 'asc' | 'desc';
      startDate?: string;
      endDate?: string;
    }
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const orderBy = query.order === 'asc' ? asc : desc;

    const conditions = [eq(PrescriptionQueueModel.clinicId, clinicId)];

    if (query.search) {
      conditions.push(ilike(MedicineModel.name, `%${query.search}%`));
    }

    if (query.startDate) {
      conditions.push(
        gte(PrescriptionQueueModel.createdAt, new Date(query.startDate))
      );
    }

    if (query.endDate) {
      conditions.push(
        lte(PrescriptionQueueModel.createdAt, new Date(query.endDate))
      );
    }

    /* ---------------- TOTAL COUNT (for pagination) ---------------- */
    const [{ total }] = await database
      .select({
        total: sql<number>`COUNT(DISTINCT ${MedicineModel.id})`,
      })
      .from(PrescriptionModel)
      .innerJoin(
        ReportCardModel,
        eq(PrescriptionModel.reportCardId, ReportCardModel.id)
      )
      .innerJoin(
        PrescriptionQueueModel,
        eq(PrescriptionQueueModel.reportId, ReportCardModel.id)
      )
      .innerJoin(
        MedicineModel,
        eq(PrescriptionModel.medicineName, MedicineModel.name)
      )
      .where(and(...conditions));

    /* ---------------- DATA QUERY ---------------- */
    const medicines = await database
      .select({
        id: MedicineModel.id,
        name: MedicineModel.name,
        genericName: MedicineModel.genericName,
        manufacturer: MedicineModel.manufacturer,
        composition: MedicineModel.composition,
        form: MedicineModel.form,
        strength: MedicineModel.strength,
        category: MedicineModel.category,
        requiresPrescription: MedicineModel.requiresPrescription,
        usageCount: sql<number>`COUNT(*)`,
      })
      .from(PrescriptionModel)
      .innerJoin(
        ReportCardModel,
        eq(PrescriptionModel.reportCardId, ReportCardModel.id)
      )
      .innerJoin(
        PrescriptionQueueModel,
        eq(PrescriptionQueueModel.reportId, ReportCardModel.id)
      )
      .innerJoin(
        MedicineModel,
        eq(PrescriptionModel.medicineName, MedicineModel.name)
      )
      .where(and(...conditions))
      .groupBy(
        MedicineModel.id,
        MedicineModel.name,
        MedicineModel.genericName,
        MedicineModel.manufacturer,
        MedicineModel.composition,
        MedicineModel.form,
        MedicineModel.strength,
        MedicineModel.category,
        MedicineModel.requiresPrescription
      )
      .orderBy(
        query.sort === 'name'
          ? orderBy(MedicineModel.name)
          : orderBy(sql`COUNT(*)`)
      )
      .limit(limit)
      .offset(offset);

    return {
      medicines,
      pagination: {
        totalRecords: total ?? 0,
        totalPages: Math.ceil((total ?? 0) / limit),
        currentPage: page,
        pageSize: limit,
      },
    };
  }
}
