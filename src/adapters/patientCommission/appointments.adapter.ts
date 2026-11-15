import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import {
  AppointmentPaymentModel as P,
  activeAppointmentFilter,
} from '../../main/appointments/models/appointment-payment.model';
import { AppointmentModel as A } from '../../main/appointments/models/appointment.model';
import { ClinicAssignModel } from '../../main/clinic/models/clinic.model';
import type { AppointmentsPort } from '../../main/patientCommission';
import { UserModel } from '../../main/users/models/user.model';

/** A cancelled or missed visit is not billed. */
const NOT_BILLED = ['Cancelled', 'Missed', 'NoShow'] as const;

/** appointment_date holds the IST day at UTC midnight, so IST dates bound it directly. */
const billable = (
  clinicId: string,
  startDate: string,
  nextStartDate: string
) =>
  and(
    eq(A.clinicId, clinicId),
    gte(A.appointmentDate, new Date(`${startDate}T00:00:00Z`)),
    lt(A.appointmentDate, new Date(`${nextStartDate}T00:00:00Z`)),
    notInArray(A.appointmentStatus, [...NOT_BILLED]),
    activeAppointmentFilter()
  );

const isDoctor = or(
  eq(UserModel.userType, 'Doctor'),
  eq(UserModel.isAdminDoctorAccess, true)
);

/** Read-only appointment counts and lists for the per-patient bill. */
export const appointmentsAdapter: AppointmentsPort = {
  async countByDoctor(clinicId, startDate, nextStartDate) {
    const [counts, assigned] = await Promise.all([
      database
        .select({
          doctorId: A.doctorId,
          patients: sql<number>`count(*)::int`,
        })
        .from(A)
        .leftJoin(P, eq(P.appointmentId, A.id))
        .where(
          and(
            billable(clinicId, startDate, nextStartDate),
            isNotNull(A.doctorId)
          )
        )
        .groupBy(A.doctorId),
      database
        .select({ id: UserModel.id, name: UserModel.name })
        .from(ClinicAssignModel)
        .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
        .where(
          and(
            eq(ClinicAssignModel.clinicId, clinicId),
            eq(UserModel.userStatus, 'Active'),
            isDoctor
          )
        ),
    ]);

    const names = new Map(assigned.map((d) => [d.id, d.name]));
    // A doctor no longer on the clinic can still have billed appointments in the period.
    const missing = counts
      .map((c) => c.doctorId!)
      .filter((id) => !names.has(id));
    if (missing.length) {
      const rows = await database
        .select({ id: UserModel.id, name: UserModel.name })
        .from(UserModel)
        .where(inArray(UserModel.id, missing));
      rows.forEach((r) => names.set(r.id, r.name));
    }

    const patients = new Map(counts.map((c) => [c.doctorId!, c.patients]));
    return [...names.entries()].map(([doctorId, name]) => ({
      doctorId,
      name: name ?? 'Doctor',
      patients: patients.get(doctorId) ?? 0,
    }));
  },

  async listForDoctor(
    clinicId,
    doctorId,
    startDate,
    nextStartDate,
    limit,
    offset
  ) {
    const where = and(
      billable(clinicId, startDate, nextStartDate),
      eq(A.doctorId, doctorId)
    );
    const [[totalRow], rows] = await Promise.all([
      database
        .select({ total: sql<number>`count(*)::int` })
        .from(A)
        .leftJoin(P, eq(P.appointmentId, A.id))
        .where(where),
      database
        .select({
          id: A.id,
          date: A.appointmentDate,
          time: A.appointmentTime,
          tokenNo: A.tokenNo,
          status: A.appointmentStatus,
          source: A.bookingSource,
          patientName: UserModel.name,
        })
        .from(A)
        .innerJoin(UserModel, eq(UserModel.id, A.patientId))
        .leftJoin(P, eq(P.appointmentId, A.id))
        .where(where)
        .orderBy(desc(A.appointmentDate), desc(A.createdAt))
        .limit(limit)
        .offset(offset),
    ]);
    return {
      total: totalRow?.total ?? 0,
      items: rows.map((r) => ({
        appointmentId: r.id,
        date: new Date(r.date).toISOString().slice(0, 10),
        // A token booking stores a placeholder clock time, so it has none to show.
        time: r.tokenNo ? null : (r.time?.slice(0, 5) ?? null),
        tokenNo: r.tokenNo ?? null,
        patientName: r.patientName,
        status: r.status,
        bookingSource: r.source,
      })),
    };
  },

  async getDoctorName(clinicId, doctorId) {
    const [user] = await database
      .select({ name: UserModel.name })
      .from(UserModel)
      .where(and(eq(UserModel.id, doctorId), isDoctor))
      .limit(1);
    if (!user) return null;
    const [assigned] = await database
      .select({ id: ClinicAssignModel.id })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          eq(ClinicAssignModel.userId, doctorId)
        )
      )
      .limit(1);
    if (assigned) return user.name ?? 'Doctor';
    const [hasAppointment] = await database
      .select({ id: A.id })
      .from(A)
      .where(and(eq(A.clinicId, clinicId), eq(A.doctorId, doctorId)))
      .limit(1);
    return hasAppointment ? (user.name ?? 'Doctor') : null;
  },
};
