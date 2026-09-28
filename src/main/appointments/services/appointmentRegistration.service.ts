import { sql } from 'drizzle-orm';
import type { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../models/appointment.model';
import { AppointmentRegistrationCounterModel } from '../models/appointmentRegistrationCounter.model';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

/** Printed width: 125 prints as 00125, and a longer number is never cut. */
const REGISTRATION_NO_WIDTH = 5;

/** Each doctor's running appointment registration number within a clinic. */
export class AppointmentRegistrationService {
  /** The number as people see it, for selects that return it to the client. */
  static readonly formattedColumn = sql<
    string | null
  >`lpad(${AppointmentModel.registrationNo}::text, greatest(${sql.raw(String(REGISTRATION_NO_WIDTH))}, length(${AppointmentModel.registrationNo}::text)), '0')`;

  /** Issues the doctor's next number. The counter row stays locked until the booking
   * commits, so concurrent bookings queue, and a rolled-back booking returns its number. */
  static async next(
    tx: Tx,
    clinicId: string,
    doctorId: string
  ): Promise<number> {
    const [counter] = await tx
      .insert(AppointmentRegistrationCounterModel)
      .values({ clinicId, doctorId, lastNo: 1 })
      .onConflictDoUpdate({
        target: [
          AppointmentRegistrationCounterModel.clinicId,
          AppointmentRegistrationCounterModel.doctorId,
        ],
        set: {
          lastNo: sql`${AppointmentRegistrationCounterModel.lastNo} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ lastNo: AppointmentRegistrationCounterModel.lastNo });

    return counter.lastNo;
  }

  static format(registrationNo: number | null | undefined): string {
    return registrationNo
      ? String(registrationNo).padStart(REGISTRATION_NO_WIDTH, '0')
      : '';
  }
}
