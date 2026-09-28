import { and, desc, eq, gte, lte, or, ilike, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AppointmentModel } from '../models/appointment.model';
import { AppointmentNoShowActionModel } from '../models/appointmentNoShow.model';
import { NoShowPolicyModel } from '../models/noShowPolicy.model';
import {
  CreateNoShowPolicyDto,
  MarkNoShowDto,
} from '../schemas/appointment.schemas';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { AppointmentActivityHistoryService } from './appointmentActivityHistory.service';
import { notifyAppointmentNoShow } from '../../../utils/notificationHelpers';
import { AppointmentEngineOrchestrator } from '../../appointment-engine/services/orchestrator.service';
import { signalAppointmentChange } from '../../realtime';
import {
  AppointmentRecord,
  AppointmentStatus,
} from '../../appointment-engine/types/engine.types';
import logger from '../../../utils/logger';
import { istDayBoundsUtc } from '../../../utils/istDateTime';
import { DAY_END_NO_SHOW_REASON } from '../../../cron/jobs/missedAppointments.cron';

export class NoShowService {
  /**
   * Set or Update No Show Policy for a clinic
   */
  static async setPolicy(clinicId: string, payload: CreateNoShowPolicyDto) {
    return await database.transaction(async (trx) => {
      const gracePeriodMinutes =
        typeof payload.gracePeriodMinutes === 'number'
          ? payload.gracePeriodMinutes
          : 15;

      const rules = Array.isArray(payload.rules) ? payload.rules : [];

      const [policy] = await trx
        .insert(NoShowPolicyModel)
        .values({
          clinicId,
          gracePeriodMinutes,
          rules,
          isActive: payload.isActive,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [NoShowPolicyModel.clinicId],
          set: {
            gracePeriodMinutes,
            rules,
            isActive: payload.isActive,
            updatedAt: new Date(),
          },
        })
        .returning();

      return policy;
    });
  }

  /**
   * Get No Show Policy for a clinic
   */
  static async getPolicy(clinicId: string) {
    const [policy] = await database
      .select()
      .from(NoShowPolicyModel)
      .where(eq(NoShowPolicyModel.clinicId, clinicId));

    return policy || null;
  }

  /**
   * Get No Show Policy mapped for client response
   */
  static async getPolicyView(clinicId: string) {
    const policy = await this.getPolicy(clinicId);

    if (!policy) {
      return null;
    }

    const rules = (policy.rules as any[]) || [];
    const blockedRule = rules.find((r) => r.action === 'blocked');

    return {
      isEnabled: policy.isActive,
      maxNoShows: blockedRule?.count ?? 3,
      blockDurationDays: blockedRule?.blockDurationDays ?? 30,
      gracePeriodMinutes: policy.gracePeriodMinutes,
      isActive: policy.isActive,
      rules,
    };
  }

  /**
   * Mark an appointment as No Show
   */
  static async markAsNoShow(
    appointmentId: string,
    performerId: string,
    performerRole: 'doctor' | 'receptionist' | 'system' | 'admin',
    payload: MarkNoShowDto
  ) {
    let previousStatus: string | null = null;

    const result = await database.transaction(async (trx) => {
      // 1. Get Appointment
      const [appointment] = await trx
        .select()
        .from(AppointmentModel)
        .where(eq(AppointmentModel.id, appointmentId));

      if (!appointment) throw new HttpError(404, 'Appointment not found');
      if (appointment.appointmentStatus === 'NoShow') {
        throw new HttpError(400, 'Appointment already marked as No Show');
      }

      // Capture previous status for appointment engine orchestrator
      previousStatus = appointment.appointmentStatus;

      // 2. Update Appointment Status
      const [updatedAppt] = await trx
        .update(AppointmentModel)
        .set({
          appointmentStatus: 'NoShow',
          noShowMarkedBy: performerRole,
          updatedAt: new Date(),
        })
        .where(eq(AppointmentModel.id, appointmentId))
        .returning();

      // 3. Get Clinic Policy
      const policy = await this.getPolicy(appointment.clinicId);

      let actionTaken: 'warning' | 'penalty' | 'advance_required' | 'blocked' =
        'warning';
      let policySnapshot = null;

      if (policy && policy.isActive) {
        policySnapshot = policy;
        // Count previous no-shows for this patient in this clinic
        const [countResult] = await trx
          .select({ count: sql`COUNT(*)` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.patientId, appointment.patientId),
              eq(AppointmentModel.clinicId, appointment.clinicId),
              eq(AppointmentModel.appointmentStatus, 'NoShow'),
              // The nightly day-end closures are not the patient's strike.
              sql`NOT EXISTS (SELECT 1 FROM appointment_no_show_actions a
                WHERE a.appointment_id = ${AppointmentModel.id}
                  AND a.reason = ${DAY_END_NO_SHOW_REASON})`
            )
          );

        const noShowCount = Number(countResult?.count || 0);

        // Find applicable rule
        const rules = (policy.rules as any[]) || [];
        const sortedRules = [...rules].sort((a, b) => b.count - a.count); // Higher count first
        const applicableRule = sortedRules.find((r) => noShowCount >= r.count);

        if (applicableRule) {
          actionTaken = applicableRule.action;
        }
      }

      // If action is blocked, update user model
      if (actionTaken === 'blocked') {
        await trx
          .update(UserModel)
          .set({ isUserBlocked: true, userStatus: 'Blocked' })
          .where(eq(UserModel.id, appointment.patientId));
      }

      // 4. Log No Show Action
      const [noShowAction] = await trx
        .insert(AppointmentNoShowActionModel)
        .values({
          appointmentId,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          clinicId: appointment.clinicId,
          markedByRole: performerRole,
          markedByUserId: performerId,
          reason: payload.reason || 'No reason provided',
          policySnapshot: policySnapshot,
          actionTaken: actionTaken,
        })
        .returning();

      // 5. Log Activity History
      await AppointmentActivityHistoryService.logActivity({
        appointmentId,
        action: 'STATUS_CHANGED',
        performedBy: performerId,
        previousState: appointment,
        newState: updatedAppt,
        remarks: `Marked as No Show by ${performerRole}. Action: ${actionTaken}. Reason: ${payload.reason || 'None'}`,
        tx: trx,
      });

      // Notification is dispatched post-commit, with the engine hook below.
      return {
        appointment: updatedAppt,
        action: noShowAction,
        actionTaken,
      };
    });

    // Post-commit: the status change is durable before it is announced.
    if (result?.appointment) {
      await notifyAppointmentNoShow(
        appointmentId,
        result.appointment.clinicId,
        result.appointment.patientId,
        result.appointment.doctorId,
        result.actionTaken,
        payload.reason || 'None'
      );
    }

    // ─── Appointment Engine: fire-and-forget post-commit hook ───────────────
    if (result?.appointment) {
      const appt = result.appointment;

      // Every other appointment-writing service signals here; without it the
      // engine recalculates but no board, list or patient view refetches.
      signalAppointmentChange(appt, 'appointment.no_show');

      const engineRecord: AppointmentRecord = {
        id: appt.id,
        appointmentDate: appt.appointmentDate,
        appointmentTime: appt.appointmentTime,
        tokenNo: appt.tokenNo,
        appointmentStatus: appt.appointmentStatus as AppointmentStatus,
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        doctorId: appt.doctorId!,
        appointmentDurationMinutes: appt.appointmentDurationMinutes ?? null,
        userId: appt.patientId,
      };

      const orchestrator = new AppointmentEngineOrchestrator();
      orchestrator
        .onStatusChange(
          engineRecord,
          previousStatus as unknown as AppointmentStatus
        )
        .catch((err) => {
          logger.error(
            `[AppointmentEngine] Post-commit orchestrator hook failed for no-show appointment=${appt.id}`,
            { error: err }
          );
        });
    }

    return result;
  }

  /**
   * Get No Show History for a Patient in a Clinic
   */
  static async getPatientNoShowHistory(patientId: string, clinicId: string) {
    const doctor = alias(UserModel, 'doctor');

    const rows = await database
      .select({
        // No-show action
        id: AppointmentNoShowActionModel.id,
        reason: AppointmentNoShowActionModel.reason,
        actionTaken: AppointmentNoShowActionModel.actionTaken,
        createdAt: AppointmentNoShowActionModel.createdAt,

        // Patient
        patientId: UserModel.id,
        patientName: UserModel.name,
        patientMobile: UserModel.mobile,
        patientEmail: UserModel.email,
        patientProfileImage: UserProfileModel.profileImage,

        // Doctor
        doctorId: doctor.id,
        doctorName: doctor.name,
        doctorEmail: doctor.email,

        // Appointment
        appointmentId: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        appointmentType: AppointmentModel.appointmentType,
        appointmentStatus: AppointmentModel.appointmentStatus,

        // No-show marked by role
        noShowMarkedByRole: AppointmentModel.noShowMarkedBy,
      })
      .from(AppointmentNoShowActionModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentNoShowActionModel.appointmentId, AppointmentModel.id)
      )
      .innerJoin(
        UserModel,
        eq(AppointmentNoShowActionModel.patientId, UserModel.id)
      )
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(doctor, eq(AppointmentModel.doctorId, doctor.id))
      .where(
        and(
          eq(AppointmentNoShowActionModel.patientId, patientId),
          eq(AppointmentNoShowActionModel.clinicId, clinicId)
        )
      )
      .orderBy(desc(AppointmentNoShowActionModel.createdAt));

    return rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      actionTaken: row.actionTaken,
      createdAt: row.createdAt,

      patient: {
        id: row.patientId,
        name: row.patientName,
        mobile: row.patientMobile,
        email: row.patientEmail,
        profileImage: row.patientProfileImage,
      },

      doctor: row.doctorId
        ? {
            id: row.doctorId,
            name: row.doctorName || row.doctorEmail,
          }
        : null,

      appointment: {
        id: row.appointmentId,
        date: row.appointmentDate,
        time: row.appointmentTime,
        tokenNo: row.tokenNo,
        type: row.appointmentType,
        status: row.appointmentStatus,
      },

      markedBy: {
        role: row.noShowMarkedByRole,
      },
    }));
  }

  /**
   * Get No Show list for Clinic (Admin) with optional search + date filters
   */
  static async getClinicNoShowList(
    clinicId: string,
    startDate?: string,
    endDate?: string,
    search?: string
  ) {
    const doctor = alias(UserModel, 'doctor');

    const conditions = [eq(AppointmentNoShowActionModel.clinicId, clinicId)];

    // `created_at` is a zone-less timestamp holding IST wall clock, so the
    // bounds are IST days too. `setHours` read the server's zone instead and
    // cut the last 5h30m off "today" on any IST machine.
    if (startDate) {
      conditions.push(
        gte(
          AppointmentNoShowActionModel.createdAt,
          istDayBoundsUtc(startDate).start
        )
      );
    }

    if (endDate) {
      conditions.push(
        lte(
          AppointmentNoShowActionModel.createdAt,
          istDayBoundsUtc(endDate).end
        )
      );
    }

    const trimmed = search?.trim();
    if (trimmed) {
      const term = `%${trimmed}%`;
      const searchConditions = [
        ilike(UserModel.name, term),
        ilike(UserModel.mobile, term),
        ilike(sql`COALESCE(${doctor.name}, '')`, term),
        ilike(sql`COALESCE(${doctor.email}, '')`, term),
      ];
      conditions.push(or(...searchConditions)!);
    }

    // Get all no-shows
    const allRows = await database
      .select({
        id: AppointmentNoShowActionModel.id,
        reason: AppointmentNoShowActionModel.reason,
        actionTaken: AppointmentNoShowActionModel.actionTaken,
        createdAt: AppointmentNoShowActionModel.createdAt,

        patientId: UserModel.id,
        patientName: UserModel.name,
        patientMobile: UserModel.mobile,
        patientProfileImage: UserProfileModel.profileImage,

        doctorId: doctor.id,
        doctorName: doctor.name,
        doctorEmail: doctor.email,

        appointmentId: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        appointmentType: AppointmentModel.appointmentType,
        appointmentStatus: AppointmentModel.appointmentStatus,
        noShowMarkedBy: AppointmentModel.noShowMarkedBy,
      })
      .from(AppointmentNoShowActionModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentNoShowActionModel.appointmentId, AppointmentModel.id)
      )
      .innerJoin(
        UserModel,
        eq(AppointmentNoShowActionModel.patientId, UserModel.id)
      )
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(doctor, eq(AppointmentModel.doctorId, doctor.id))
      .where(and(...conditions))
      .orderBy(desc(AppointmentNoShowActionModel.createdAt));

    // Group by patient and find latest action
    const patientsMap = new Map();

    for (const row of allRows) {
      const patientId = row.patientId;

      if (!patientsMap.has(patientId)) {
        patientsMap.set(patientId, {
          patient: {
            id: row.patientId,
            name: row.patientName,
            mobile: row.patientMobile,
            profileImage: row.patientProfileImage,
          },
          doctor: row.doctorId
            ? {
                id: row.doctorId,
                name: row.doctorName || row.doctorEmail,
              }
            : null,
          latestNoShow: null,
          latestAppointment: null,
          latestAction: null,
          totalNoShows: 0,
        });
      }

      const patientData = patientsMap.get(patientId);

      // Because query is ORDER BY createdAt DESC
      if (!patientData.latestNoShow) {
        patientData.latestNoShow = {
          id: row.id,
          reason: row.reason,
          actionTaken: row.actionTaken,
          createdAt: row.createdAt,
          appointment: {
            id: row.appointmentId,
            appointmentDate: row.appointmentDate,
            appointmentTime: row.appointmentTime,
            tokenNo: row.tokenNo,
            appointmentType: row.appointmentType,
            appointmentStatus: row.appointmentStatus,
            noShowMarkedBy: row.noShowMarkedBy,
          },
        };

        patientData.latestAppointment = {
          id: row.appointmentId,
          appointmentDate: row.appointmentDate,
          appointmentTime: row.appointmentTime,
          tokenNo: row.tokenNo,
          appointmentType: row.appointmentType,
          appointmentStatus: row.appointmentStatus,
          noShowMarkedBy: row.noShowMarkedBy,
          createdAt: row.createdAt,
        };

        patientData.latestAction = row.actionTaken;
      }

      patientData.totalNoShows++;

      // Track latest appointment and action
      if (
        !patientData.latestAppointment ||
        new Date(row.createdAt) >
          new Date(patientData.latestAppointment.createdAt)
      ) {
        patientData.latestAppointment = {
          id: row.appointmentId,
          appointmentDate: row.appointmentDate,
          appointmentTime: row.appointmentTime,
          tokenNo: row.tokenNo,
          appointmentType: row.appointmentType,
          appointmentStatus: row.appointmentStatus,
          noShowMarkedBy: row.noShowMarkedBy,
          createdAt: row.createdAt,
        };
        patientData.latestAction = row.actionTaken;
      }
    }

    // Convert map to array format
    const result = Array.from(patientsMap.values()).map((patientData) => ({
      patient: patientData.patient,
      doctor: patientData.doctor,
      latestAction: patientData.latestAction,
      totalNoShows: patientData.totalNoShows,
      latestAppointment: patientData.latestAppointment,
      allNoShows: patientData.noShows, // Keep all no-shows if needed
      // Calculate penalty status based on latest action and total count
      currentStatus: NoShowService.getPatientNoShowStatus(
        patientData.latestAction
      ),
      isBlocked: patientData.latestAction === 'blocked',
    }));

    return result;
  }

  // Helper function to calculate status
  private static getPatientNoShowStatus(latestAction: string) {
    if (latestAction === 'blocked') return 'blocked';
    if (latestAction === 'advance_required') return 'advance_required';
    if (latestAction === 'penalty') return 'penalty_applied';
    if (latestAction === 'warning') return 'warned';
    return 'active';
  }
}
