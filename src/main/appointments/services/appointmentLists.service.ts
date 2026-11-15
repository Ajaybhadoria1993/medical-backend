/* eslint-disable @typescript-eslint/no-explicit-any */
import { MoneyReadService } from '../../money';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  ScheduleShiftService,
  toHHMM,
} from '../../appointment-engine/services/scheduleShift.service';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { pagination } from '../../../utils/utils';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { doctorScopeFilter } from '../../permissions/utils/staffScope.utils';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { DoctorServices } from '../../doctor/services/doctor.service';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { AppointmentClinicalModel } from '../models/appointmentClinical.model';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AppointmentModel } from '../models/appointment.model';
import {
  appointmentQueryDto,
  ClinicAppointmentDetailsQueryDto,
} from '../schemas/appointment.schemas';
import type { ClinicAppointmentDetailsCounts } from '../types/appointment.types';
import {
  AppointmentService,
  buildActiveAppointmentFilter,
} from './appointment.service';

/** Local date as YYYY-MM-DD. */
function formatDateOnlyLocal(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Parses YYYY-MM-DD (or any date) to local midnight; today if empty. */
function parseDateOnlyLocal(dateLike?: string) {
  if (!dateLike) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const raw = String(dateLike).trim();
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new HttpError(400, 'Invalid date');
    }

    return parsed;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'Invalid date');
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/** [start, end) of the given local day. */
function getSingleDayRange(dateLike?: string) {
  const start = parseDateOnlyLocal(dateLike);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

/** Change between two counts, with a signed % label for dashboards. */
function buildMetricComparison(current: number, previous: number) {
  const changeCount = current - previous;
  const percentageChange =
    previous === 0
      ? current === 0
        ? 0
        : 100
      : Number(((changeCount / previous) * 100).toFixed(2));
  const percentageLabel = `${percentageChange > 0 ? '+' : ''}${percentageChange}%`;
  const trend =
    changeCount > 0 ? 'increase' : changeCount < 0 ? 'decrease' : 'no_change';

  return {
    count: current,
    previousCount: previous,
    changeCount,
    percentageChange,
    percentageLabel,
    trend,
  };
}

/** Paged appointment lists: the clinic list with status counts, the details list and the patient portal list. */
export class AppointmentListsService {
  /** Paged clinic appointment list with status counts, limited to the user's doctors. */
  static async getAllClinicAppointments(
    clinicId: string,
    query: appointmentQueryDto,
    user: AuthUser
  ) {
    // An out-of-scope doctorId is a 403 rather than a silently empty list, so
    // a receptionist is told why they cannot see another doctor's schedule.
    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      user,
      clinicId
    );
    if (query.doctorId) {
      await StaffScopeService.assertDoctorAllowed(
        user,
        clinicId,
        query.doctorId
      );
    }

    const trx = database;
    const pageSize = Math.max(Number(query?.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query?.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    const whereClauses: any[] = [];

    if (user.userType === 'Patient') {
      whereClauses.push(eq(AppointmentModel.patientId, user.id));
    } else {
      // Every staff role is held to this clinic; without it a Nurse with all-doctor access read every clinic.
      whereClauses.push(eq(AppointmentModel.clinicId, clinicId));
      if (user.userType === 'Doctor')
        whereClauses.push(eq(AppointmentModel.doctorId, user.id));
      else if (query.doctorId)
        whereClauses.push(eq(AppointmentModel.doctorId, query.doctorId));
    }

    const scopeFilter = doctorScopeFilter(
      AppointmentModel.doctorId,
      allowedDoctorIds
    );
    if (scopeFilter) whereClauses.push(scopeFilter);

    // Local-day range: today by default, startDate alone means that one day.
    const dayStart = (ymd: string) => {
      const [y, m, d] = ymd.split('-').map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };
    const dayEnd = (ymd: string) => {
      const [y, m, d] = ymd.split('-').map(Number);
      return new Date(y, m - 1, d, 23, 59, 59, 999);
    };
    const today = formatDateOnlyLocal(new Date());
    const startYmd = query.startDate || today;
    const endYmd = query.endDate || (query.startDate ? query.startDate : today);
    whereClauses.push(
      gte(AppointmentModel.appointmentDate, dayStart(startYmd))
    );
    whereClauses.push(lte(AppointmentModel.appointmentDate, dayEnd(endYmd)));

    whereClauses.push(buildActiveAppointmentFilter());

    const patientUser = alias(UserModel, 'patientUser');
    const doctorUser = alias(UserModel, 'doctorUser');
    const patientProfile = alias(UserProfileModel, 'patientProfile');
    const doctorProfile = alias(UserProfileModel, 'doctorProfile');

    if (query?.search) {
      const raw = String(query.search).trim();
      if (raw.length > 0) {
        const terms = raw.split(/\s+/).slice(0, 5);
        const termConditions = terms.map((term) => {
          const escaped = AppointmentService.escapeLike(term);
          const pattern = `%${escaped}%`.toLowerCase();
          const byName = sql`lower(${patientUser.name}) LIKE ${pattern}`;
          const byEmail = sql`lower(${patientUser.email}) LIKE ${pattern}`;
          const byMobile = sql`lower(${patientUser.mobile}) LIKE ${pattern}`;
          const byAltMobile = sql`lower((SELECT alternate_mobile FROM user_profiles WHERE user_id = ${patientUser.id})) LIKE ${pattern}`;
          const byAppointmentType = sql`lower(${AppointmentModel.appointmentType}) LIKE ${pattern}`;
          const byAppointmentStatus = sql`lower(CAST(${AppointmentModel.appointmentStatus} AS text)) LIKE ${pattern}`;
          return or(
            byName,
            byEmail,
            byMobile,
            byAltMobile,
            byAppointmentType,
            byAppointmentStatus
          );
        });
        if (termConditions.length === 1) {
          whereClauses.push(termConditions[0]);
        } else if (termConditions.length > 1) {
          whereClauses.push(and(...termConditions));
        }
      }
    }

    // Filters without status, so the status breakdown counts don't just mirror the selected tab.
    const baseWhereClauses = [...whereClauses];

    if (query?.appointmentStatus) {
      const raw = Array.isArray(query.appointmentStatus)
        ? query.appointmentStatus
        : [query.appointmentStatus];
      const normalized = raw
        .flatMap((s) => (typeof s === 'string' ? s.split(',') : s))
        .map((s) => String(s).trim())
        .filter((s) =>
          [
            'Upcoming',
            'Completed',
            'Cancelled',
            'Rescheduled',
            'Patient Arrived',
            'Pending',
            'Missed',
            'Confirmed',
            'NoShow',
          ].includes(s)
        );
      if (normalized.length > 0) {
        whereClauses.push(
          inArray(AppointmentModel.appointmentStatus, normalized as any)
        );
      }
    }

    // Counts join the patient (search reads it) and payment (the active filter reads it); doctor is unused here.
    const totalRecordsRead = trx
      .select({ count: sql`COUNT(${AppointmentModel.id})` })
      .from(AppointmentModel)
      .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...whereClauses));

    // Per-status counts for the "Status - All (N)" dropdown, ignoring the status filter.
    const statusBreakdownRead = trx
      .select({
        status: AppointmentModel.appointmentStatus,
        count: sql<number>`COUNT(${AppointmentModel.id})::int`,
      })
      .from(AppointmentModel)
      .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...baseWhereClauses))
      .groupBy(AppointmentModel.appointmentStatus);

    const patientsRead = trx
      .select({
        id: patientUser.id,
        name: patientUser.name,
        // Family members have no mobile; fall back to the primary patient's number.
        mobile: sql<string | null>`COALESCE(${patientUser.mobile}, (
          SELECT pu.mobile
          FROM patient_family_links pfl
          JOIN users pu ON pu.id = pfl.primary_patient_id
          WHERE pfl.linked_patient_id = ${patientUser.id}
            AND pu.mobile IS NOT NULL
          LIMIT 1
        ))`,
        profileImage: patientProfile.profileImage,
        appointment: {
          id: AppointmentModel.id,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
          appointmentType: AppointmentModel.appointmentType,
          appointmentStatus: AppointmentModel.appointmentStatus,
          paymentMethod: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          tokenNo: AppointmentModel.tokenNo,
          // Tokens restart per shift; without the session, morning and evening Token 1 look the same.
          sessionIndex: AppointmentModel.sessionIndex,
          bookingSource: AppointmentModel.bookingSource,
        },
        doctor: {
          id: doctorUser.id,
          name: doctorUser.name,
          email: doctorUser.email,
          mobile: doctorUser.mobile,
          gender: doctorProfile.gender,
          profileImage: doctorProfile.profileImage,
          // Timeline header shows speciality next to qualification.
          speciality: UserProfessionalModel.speciality,
        },
        service: {
          id: ClinicServiceModel.id,
          serviceName: ClinicServiceModel.serviceName,
          servicePrice: ClinicServiceModel.price,
        },
      })
      .from(AppointmentModel)
      .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
      .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
      // Profiles are one row per user (unique user_id), so these joins never duplicate a row.
      .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
      .leftJoin(doctorProfile, eq(doctorProfile.userId, doctorUser.id))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, doctorUser.id)
      )
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .leftJoin(
        ClinicServiceModel,
        eq(ClinicServiceModel.id, AppointmentModel.clinicServiceId)
      )
      .where(and(...whereClauses))
      .orderBy(
        sql`CASE ${AppointmentModel.appointmentStatus}
          WHEN 'Confirmed' THEN 0
          WHEN 'Patient Arrived' THEN 1
          WHEN 'Upcoming' THEN 2
          WHEN 'Pending' THEN 2
          ELSE 3
        END`,
        asc(AppointmentModel.appointmentDate),
        asc(AppointmentModel.appointmentTime),
        asc(AppointmentModel.tokenNo)
      )
      .limit(limit)
      .offset(offset);

    const [totalRecords, statusBreakdownRows, patients] = await Promise.all([
      totalRecordsRead,
      statusBreakdownRead,
      patientsRead,
    ]);

    const totalCount = Number(totalRecords?.[0]?.count ?? 0) || 0;
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

    const statusCounts: Record<string, number> = {};
    let allStatusCount = 0;
    for (const row of statusBreakdownRows) {
      const count = Number(row.count ?? 0);
      statusCounts[row.status as string] = count;
      allStatusCount += count;
    }
    statusCounts.all = allStatusCount;

    const tokenRows = patients.filter(
      (p): p is typeof p & { doctor: { id: string } } =>
        p.appointment.tokenNo != null &&
        (p.appointment as any).sessionIndex != null &&
        p.doctor?.id != null
    );

    if (tokenRows.length > 0) {
      const dayKey = (doctorId: string, date: Date) =>
        `${doctorId}:${formatDateOnlyLocal(new Date(date))}`;

      const uniqueDays = new Map<string, { doctorId: string; date: Date }>();
      for (const p of tokenRows) {
        const key = dayKey(p.doctor.id, p.appointment.appointmentDate as Date);
        if (!uniqueDays.has(key)) {
          uniqueDays.set(key, {
            doctorId: p.doctor.id,
            date: p.appointment.appointmentDate as Date,
          });
        }
      }

      const sessionWindowsByDay = new Map<
        string,
        Map<number, { sessionStart: string; sessionEnd: string }>
      >();

      await Promise.all(
        [...uniqueDays.entries()].map(async ([key, { doctorId, date }]) => {
          const dateStr = formatDateOnlyLocal(date);
          const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
            trx,
            clinicId,
            doctorId,
            dateStr
          );
          const windows = new Map<
            number,
            { sessionStart: string; sessionEnd: string }
          >();
          (day?.segments ?? []).forEach((segment, index) => {
            windows.set(index + 1, {
              sessionStart: toHHMM(segment.start),
              sessionEnd: toHHMM(segment.end),
            });
          });
          sessionWindowsByDay.set(key, windows);
        })
      );

      for (const p of tokenRows) {
        const key = dayKey(p.doctor.id, p.appointment.appointmentDate as Date);
        const window = sessionWindowsByDay
          .get(key)
          ?.get((p.appointment as any).sessionIndex);
        if (window) {
          (p.appointment as any).sessionStart = window.sessionStart;
          (p.appointment as any).sessionEnd = window.sessionEnd;
        }
      }
    }

    // One batched lookup per page each: the shared degree line, and refunds from the ledger.
    const [degreeByDoctor, refunds] = await Promise.all([
      DoctorServices.degreeLines(
        patients.map((p) => p.doctor?.id).filter((id): id is string => !!id),
        3
      ),
      MoneyReadService.refundsOf(patients.map((p) => p.appointment.id)),
    ]);

    return {
      patients: patients.map((p) => {
        const refund = refunds.get(p.appointment.id);
        const row = {
          ...p,
          appointment: {
            ...p.appointment,
            refundMode: refund?.refundMode ?? null,
            refundedAmount: refund?.refundedAmount ?? null,
            refundNotes: refund?.refundNotes ?? null,
          },
        };
        return p.doctor?.id
          ? {
              ...row,
              doctor: {
                ...p.doctor,
                qualification: degreeByDoctor.get(p.doctor.id) ?? '',
              },
            }
          : row;
      }),
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
      statusCounts,
    };
  }

  /** Appointment details list for the clinic, limited to the user's doctors. */
  static async getClinicAppointmentDetails(
    clinicId: string,
    query: ClinicAppointmentDetailsQueryDto,
    user: AuthUser
  ) {
    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      user,
      clinicId
    );
    if (query.doctorId) {
      await StaffScopeService.assertDoctorAllowed(
        user,
        clinicId,
        query.doctorId
      );
    }

    const selectedDate = query.date || query.startDate;
    const currentRange = getSingleDayRange(selectedDate);
    const previousRange = {
      start: new Date(currentRange.start),
      end: new Date(currentRange.start),
    };
    previousRange.start.setDate(previousRange.start.getDate() - 1);

    const getCountsForRange = async (
      start: Date,
      end: Date
    ): Promise<ClinicAppointmentDetailsCounts> => {
      return await database.transaction(async (trx) => {
        const whereClauses: any[] = [
          eq(AppointmentModel.clinicId, clinicId),
          gte(AppointmentModel.appointmentDate, start),
          lt(AppointmentModel.appointmentDate, end),
        ];

        if (user.userType === 'Patient') {
          whereClauses.push(eq(AppointmentModel.patientId, user.id));
        }

        if (user.userType === 'Doctor') {
          whereClauses.push(eq(AppointmentModel.doctorId, user.id));
        }

        if (
          query.doctorId &&
          ['Admin', 'Receptionist', 'Super_Admin'].includes(user.userType)
        ) {
          whereClauses.push(eq(AppointmentModel.doctorId, query.doctorId));
        }

        const scopeFilter = doctorScopeFilter(
          AppointmentModel.doctorId,
          allowedDoctorIds
        );
        if (scopeFilter) whereClauses.push(scopeFilter);

        const [counts] = await trx
          .select({
            totalAppointments: sql<number>`COUNT(*)::int`,
            completed: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
            upcoming: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Pending' THEN 1 END)::int`,
            cancelled: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Cancelled' THEN 1 END)::int`,
            noShow: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
            confirmed: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Confirmed' THEN 1 END)::int`,
            patientArrived: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Patient Arrived' THEN 1 END)::int`,
          })
          .from(AppointmentModel)
          .leftJoin(
            AppointmentPaymentModel,
            eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
          )
          .where(and(...whereClauses, buildActiveAppointmentFilter()));

        return {
          totalAppointments: Number(counts?.totalAppointments ?? 0),
          completed: Number(counts?.completed ?? 0),
          upcoming: Number(counts?.upcoming ?? 0),
          cancelled: Number(counts?.cancelled ?? 0),
          noShow: Number(counts?.noShow ?? 0),
          confirmed: Number(counts?.confirmed ?? 0),
          patientArrived: Number(counts?.patientArrived ?? 0),
        };
      });
    };

    const [currentCounts, previousCounts] = await Promise.all([
      getCountsForRange(currentRange.start, currentRange.end),
      getCountsForRange(previousRange.start, previousRange.end),
    ]);

    return {
      date: formatDateOnlyLocal(currentRange.start),
      previousDate: formatDateOnlyLocal(previousRange.start),
      totalAppointments: buildMetricComparison(
        currentCounts.totalAppointments,
        previousCounts.totalAppointments
      ),
      completed: buildMetricComparison(
        currentCounts.completed,
        previousCounts.completed
      ),
      upcoming: buildMetricComparison(
        currentCounts.upcoming,
        previousCounts.upcoming
      ),
      cancelled: buildMetricComparison(
        currentCounts.cancelled,
        previousCounts.cancelled
      ),
      noShow: buildMetricComparison(
        currentCounts.noShow,
        previousCounts.noShow
      ),
      confirmed: buildMetricComparison(
        currentCounts.confirmed,
        previousCounts.confirmed
      ),
      patientArrived: buildMetricComparison(
        currentCounts.patientArrived,
        previousCounts.patientArrived
      ),
    };
  }

  /** Paged appointments of one patient (patient portal), across clinics. */
  static async getAllUserAppointments(
    userId: string,
    query: appointmentQueryDto
  ) {
    return await database.transaction(async (trx) => {
      const pageSize = Math.max(Number(query?.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query?.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      // Build where clause safely
      const whereClauses: any[] = [eq(AppointmentModel.patientId, userId)];

      if (query?.search) {
        const raw = String(query.search).trim();
        if (raw.length > 0) {
          const terms = raw.split(/\s+/).slice(0, 5);

          const termConditions = terms.map((term) => {
            const escaped = AppointmentService.escapeLike(term);
            const pattern = `%${escaped}%`.toLowerCase();

            const byName = sql`lower(${UserModel.name}) LIKE ${pattern}`;
            const byEmail = sql`lower(${UserModel.email}) LIKE ${pattern}`;
            const byMobile = sql`lower(${UserModel.mobile}) LIKE ${pattern}`;
            const byAltMobile = sql`lower(${UserProfileModel.alternateMobile}) LIKE ${pattern}`;
            const byAppointmentType = sql`lower(${AppointmentModel.appointmentType}) LIKE ${pattern}`;
            const byAppointmentStatus = sql`lower(CAST(${AppointmentModel.appointmentStatus} AS text)) LIKE ${pattern}`;

            // For a single term, any of these fields may match => OR
            return or(
              byName,
              byEmail,
              byMobile,
              byAltMobile,
              byAppointmentType,
              byAppointmentStatus
            );
          });

          // Combine multiple term conditions with AND (each term must appear somewhere)
          if (termConditions.length === 1) {
            whereClauses.push(termConditions[0]);
          } else if (termConditions.length > 1) {
            whereClauses.push(and(...termConditions));
          }
        }
      }

      // total count of appointments matching the criteria
      const totalRecords = await trx
        .select({ count: sql`COUNT(${AppointmentModel.id})` })
        .from(AppointmentModel)
        .where(and(...whereClauses));

      const totalCount = Number(totalRecords?.[0]?.count ?? 0) || 0;
      const totalPages =
        totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
      const doctor = alias(UserModel, 'doctor');

      // fetch patients with their appointment (this will return one row per appointment)
      // If you want only latest appointment per patient, see note below.
      const patients = await trx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          alternateMobile: UserProfileModel.alternateMobile,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          status: UserModel.userStatus,
          updatedAt: UserModel.updatedAt,
          createdAt: UserModel.createdAt,
          doctor: {
            id: doctor.id,
            name: doctor.name,
            email: doctor.email,
            mobile: doctor.mobile,
            status: doctor.userStatus,
            updatedAt: doctor.updatedAt,
            createdAt: doctor.createdAt,
          },
          appointment: {
            id: AppointmentModel.id,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentType: AppointmentModel.appointmentType,
            appointmentNotes: AppointmentClinicalModel.appointmentNotes,
            appointmentStatus: AppointmentModel.appointmentStatus,
            reReasonForCancellation: AppointmentModel.reReasonForCancellation,
            reasionForReSchedule: AppointmentModel.reasionForReSchedule,
            bookingSource: AppointmentModel.bookingSource,
          },
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          AppointmentModel,
          eq(UserModel.id, AppointmentModel.patientId)
        )
        .leftJoin(doctor, eq(doctor.id, AppointmentModel.doctorId))
        .leftJoin(
          AppointmentClinicalModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .where(and(...whereClauses))
        // stable ordering so paging is deterministic:
        .orderBy(
          desc(UserModel.createdAt),
          desc(AppointmentModel.appointmentDate),
          desc(AppointmentModel.appointmentTime)
        )
        .limit(limit)
        .offset(offset);

      return {
        patients,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }
}
