import { database } from '../../../configurations/dbConnection';
import { AppointmentActivityHistoryModel } from '../models/appointmentActivityHistory.model';
import { eq, desc } from 'drizzle-orm';
import { UserModel } from '../../users/models/user.model';

export interface LogActivityParams {
  appointmentId: string;
  action:
    | 'CREATED'
    | 'UPDATED'
    | 'CONFIRMED'
    | 'COMPLETED'
    | 'STATUS_CHANGED'
    | 'VITALS_UPDATED'
    | 'RESCHEDULED'
    | 'PATIENT_ARRIVED'
    | 'CANCELLED'
    | 'NOTES_ADDED'
    | 'TEST_PRESCRIBED'
    | 'TEST_REPORT_UPLOADED'
    | 'PRESCRIPTION_CREATED'
    | 'PRESCRIPTION_UPDATED'
    | 'REMINDER_SENT'
    | 'PAYMENT_STATUS';
  performedBy?: string;
  previousState?: any;
  newState?: any;
  remarks?: string;
  tx?: any; // Optional transaction object
}

export class AppointmentActivityHistoryService {
  /**
   * Logs an activity for an appointment
   */
  static async logActivity(params: LogActivityParams) {
    try {
      const db = params.tx || database;

      // Validate performedBy is a valid UUID if provided
      const performedBy =
        params.performedBy &&
        params.performedBy.match(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        )
          ? params.performedBy
          : null;

      await db.insert(AppointmentActivityHistoryModel).values({
        appointmentId: params.appointmentId,
        action: params.action,
        performedBy: performedBy,
        previousState: params.previousState,
        newState: params.newState,
        remarks: params.remarks,
      });
    } catch (error) {
      // We don't want to fail the main transaction if logging fails,
      // but we should log the error
      console.error('Failed to log appointment activity:', error);
    }
  }

  /**
   * Fetches activity history for a specific appointment
   */
  static async getHistoryByAppointmentId(appointmentId: string) {
    return await database
      .select({
        id: AppointmentActivityHistoryModel.id,
        action: AppointmentActivityHistoryModel.action,
        remarks: AppointmentActivityHistoryModel.remarks,
        createdAt: AppointmentActivityHistoryModel.createdAt,
        performedBy: {
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
        },
      })
      .from(AppointmentActivityHistoryModel)
      .leftJoin(
        UserModel,
        eq(AppointmentActivityHistoryModel.performedBy, UserModel.id)
      )
      .where(eq(AppointmentActivityHistoryModel.appointmentId, appointmentId))
      .orderBy(desc(AppointmentActivityHistoryModel.createdAt));
  }
}
