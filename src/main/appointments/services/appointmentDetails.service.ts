import { and, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { MoneyReadService } from '../../money';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { ClinicSymptomModel } from '../../clinic/models/clinic-symptom.model';
import {
  ClinicAvailability,
  ClinicServiceModel,
} from '../../clinic/models/clinic.model';
import { PatientVaccineService } from '../../patient/services/patientVaccine.service';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { AppointmentClinicalModel } from '../models/appointmentClinical.model';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AppointmentModel } from '../models/appointment.model';
import { doctorManualPrescriptionModel } from '../models/doctorManualPrescription.model';
import { AppointmentMultipleServiceService } from './appointmentMultipleService.service';
import { AppointmentRegistrationService } from './appointmentRegistration.service';
import { coveringVisit } from '../utils/serviceCoverage.utils';
import { DoctorServices } from '../../doctor/services/doctor.service';

type RequestingUser = { id: string; userType: string; clinicId?: string };

export class AppointmentDetailsService {
  // The staff appointment page's payload: only what that screen reads, with the
  // patient nested under `patient` instead of spread across the root.
  static async getDetails(
    appointmentId: string,
    requestingUser: RequestingUser
  ) {
    const [scope] = await database
      .select({
        doctorId: AppointmentModel.doctorId,
        clinicId: AppointmentModel.clinicId,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!scope) {
      throw new HttpError(404, 'Appointment not found');
    }

    // Same rules as AppointmentService.getAppointmentDetails, so both endpoints agree.
    const isClinicStaff =
      (requestingUser.userType === 'Admin' ||
        requestingUser.userType === 'Receptionist') &&
      !!requestingUser.clinicId &&
      scope.clinicId === requestingUser.clinicId;
    const isOwnDoctor =
      requestingUser.userType === 'Doctor' &&
      scope.doctorId === requestingUser.id;

    if (!isClinicStaff && !isOwnDoctor) {
      throw new HttpError(
        403,
        'You do not have permission to access this appointment'
      );
    }

    if (requestingUser.clinicId) {
      await StaffScopeService.assertDoctorAllowed(
        requestingUser,
        requestingUser.clinicId,
        scope.doctorId as string
      );
    }

    const DoctorUser = alias(UserModel, 'doctor');

    const [row] = await database
      .select({
        patient: {
          id: UserModel.id,
          name: UserModel.name,
          mobile: UserModel.mobile,
          email: UserModel.email,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          profileImage: UserProfileModel.profileImage,
          // Shown read-only as tags on the prescription; the profile is shared across clinics, so it is never written here.
          bloodGroup: UserProfileModel.bloodGroup,
          allergies: UserProfileModel.allergies,
          chronicConditions: UserProfileModel.chronicConditions,
          // Last vaccine and dose counts, owned by the patient module; next due is worked out below.
          ...PatientVaccineService.patientBarColumns(
            UserModel.id,
            AppointmentModel.clinicId
          ),
          // One printable line; the separate city/state/zip fields are not needed.
          address: sql<
            string | null
          >`NULLIF(concat_ws(', ', NULLIF(${UserProfileModel.address}, ''), NULLIF(${UserProfileModel.city}, ''), NULLIF(${UserProfileModel.state}, ''), ${UserProfileModel.zipCode}::text), '')`,
        },
        appointment: {
          id: AppointmentModel.id,
          patientId: AppointmentModel.patientId,
          doctorId: AppointmentModel.doctorId,
          clinicId: AppointmentModel.clinicId,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentType: AppointmentModel.appointmentType,
          appointmentNotes: AppointmentClinicalModel.appointmentNotes,
          appointmentStatus: AppointmentModel.appointmentStatus,
          reReasonForCancellation: AppointmentModel.reReasonForCancellation,
          reasionForReSchedule: AppointmentModel.reasionForReSchedule,
          tokenNo: AppointmentModel.tokenNo,
          registrationNo: AppointmentRegistrationService.formattedColumn,
          sessionIndex: AppointmentModel.sessionIndex,
          clinicServiceId: AppointmentModel.clinicServiceId,
          vitals: AppointmentClinicalModel.vitals,
          referrals: AppointmentClinicalModel.referrals,
          consentNotes: AppointmentClinicalModel.consentNotes,
          consentFile: AppointmentClinicalModel.consentFile,
          commonSymptoms: AppointmentClinicalModel.commonSymptoms,
          clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
          bookingSource: AppointmentModel.bookingSource,
          dayStartTime: ClinicAvailability.startTime,
          dayEndTime: ClinicAvailability.endTime,
          paymentMode: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          price: AppointmentPaymentModel.price,
          primaryServicePrice: AppointmentPaymentModel.primaryServicePrice,
          paymentNotes: AppointmentPaymentModel.paymentNotes,
        },
        doctor: {
          id: DoctorUser.id,
          name: DoctorUser.name,
          email: DoctorUser.email,
          mobile: DoctorUser.mobile,
          speciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${DoctorUser.id} LIMIT 1)`,
          profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${DoctorUser.id} LIMIT 1)`,
        },
      })
      .from(AppointmentModel)
      .innerJoin(UserModel, eq(UserModel.id, AppointmentModel.patientId))
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .leftJoin(
        AppointmentClinicalModel,
        eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
      )
      .innerJoin(DoctorUser, eq(AppointmentModel.doctorId, DoctorUser.id))
      .leftJoin(
        ClinicAvailability,
        and(
          eq(ClinicAvailability.clinicId, AppointmentModel.clinicId),
          eq(ClinicAvailability.doctorId, AppointmentModel.doctorId),
          sql`trim(both from lower(${ClinicAvailability.dayOfWeek})) = trim(both from lower(to_char(${AppointmentModel.appointmentDate}, 'Day')))`
        )
      )
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!row) {
      throw new HttpError(404, 'Appointment not found');
    }

    const { clinicSymptomIds, ...appointment } = row.appointment;

    const [
      manualPrescription,
      serviceRows,
      symptoms,
      additionalServices,
      doctorDegreeLine,
      refunds,
    ] = await Promise.all([
      database
        .select({
          id: doctorManualPrescriptionModel.id,
          doctorManualPrescription:
            doctorManualPrescriptionModel.doctorManualPrescription,
          createdAt: doctorManualPrescriptionModel.createdAt,
          updatedAt: doctorManualPrescriptionModel.updatedAt,
        })
        .from(doctorManualPrescriptionModel)
        .where(eq(doctorManualPrescriptionModel.appointmentId, appointmentId))
        .limit(1),
      appointment.clinicServiceId
        ? database
            .select({
              id: ClinicServiceModel.id,
              serviceName: ClinicServiceModel.serviceName,
              price: ClinicServiceModel.price,
              currency: ClinicServiceModel.currency,
              durationDays: ClinicServiceModel.durationDays,
              additionalServices: ClinicServiceModel.additionalServices,
            })
            .from(ClinicServiceModel)
            .where(eq(ClinicServiceModel.id, appointment.clinicServiceId))
            .limit(1)
        : Promise.resolve([]),
      Array.isArray(clinicSymptomIds) && clinicSymptomIds.length > 0
        ? database
            .select({
              id: ClinicSymptomModel.id,
              name: ClinicSymptomModel.name,
            })
            .from(ClinicSymptomModel)
            .where(inArray(ClinicSymptomModel.id, clinicSymptomIds))
        : Promise.resolve([]),
      AppointmentMultipleServiceService.listByAppointmentId(appointmentId),
      // The appointment's own doctor, never the viewer: same 3-degree line as the prescription.
      row.doctor?.id
        ? DoctorServices.degreeLine(row.doctor.id, 3)
        : Promise.resolve(''),
      MoneyReadService.refundsOf([appointmentId]),
    ]);
    const refund = refunds.get(appointmentId);

    const clinicService = serviceRows[0] ?? null;

    return {
      patient: (() => {
        const { vaccineCounts, ...patient } = row.patient;
        return {
          ...patient,
          nextVaccine: PatientVaccineService.nextDue(
            patient.dob,
            vaccineCounts
          ),
        };
      })(),
      appointment: {
        ...appointment,
        refundMode: refund?.refundMode ?? null,
        refundedAmount: refund?.refundedAmount ?? null,
        refundNotes: refund?.refundNotes ?? null,
        coveredBy: await AppointmentDetailsService.findCoveringVisit(
          appointmentId,
          scope,
          appointment,
          clinicService?.durationDays ?? null
        ),
      },
      doctor: row.doctor
        ? { ...row.doctor, degreeLine: doctorDegreeLine }
        : row.doctor,
      clinicService,
      symptoms,
      manualPrescription: manualPrescription[0] ?? null,
      additionalServices,
    };
  }

  // A covered visit stores no payment of its own: find the paid visit it falls under.
  // ponytail: copy of the rule in AppointmentService.getAppointmentDetails; share it once that API can change.
  private static async findCoveringVisit(
    appointmentId: string,
    scope: { doctorId: string | null; clinicId: string | null },
    appt: {
      patientId: string | null;
      paymentMode: string | null;
      paymentStatus: string | null;
      clinicServiceId: string | null;
      appointmentDate: Date;
    },
    durationDaysRaw: number | null
  ) {
    if (
      appt.paymentMode ||
      appt.paymentStatus !== 'Already Paid' ||
      !appt.clinicServiceId ||
      !appt.appointmentDate ||
      !scope.clinicId ||
      !appt.patientId ||
      !scope.doctorId
    ) {
      return null;
    }

    const [payingVisit] = await database
      .select({
        appointmentId: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        paymentMode: AppointmentPaymentModel.paymentMode,
        amount: sql<
          string | null
        >`COALESCE(${AppointmentPaymentModel.primaryServicePrice}, ${AppointmentPaymentModel.price})`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, scope.clinicId),
          eq(AppointmentModel.patientId, appt.patientId),
          eq(AppointmentModel.doctorId, scope.doctorId),
          eq(AppointmentModel.clinicServiceId, appt.clinicServiceId),
          ne(AppointmentModel.id, appointmentId),
          lte(AppointmentModel.appointmentDate, appt.appointmentDate),
          coveringVisit()
        )
      )
      .orderBy(
        desc(AppointmentModel.appointmentDate),
        desc(AppointmentPaymentModel.createdAt)
      )
      .limit(1);

    if (!payingVisit) return null;

    // Same date arithmetic as UserService's "Expiring on", so the two never disagree.
    const durationDays = Number(durationDaysRaw ?? 0);
    let validTill: string | null = null;
    if (durationDays > 0) {
      const expiry = new Date(payingVisit.appointmentDate);
      expiry.setDate(expiry.getDate() + durationDays);
      validTill = expiry.toISOString().split('T')[0];
    }
    return { ...payingVisit, validTill };
  }
}
