import { and, notInArray, sql } from 'drizzle-orm';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AppointmentModel } from '../models/appointment.model';

/** A visit that starts a service's validity ("Expiring on"): it still stands and its money was received.
 *  Upcoming / Patient Arrived count (they used to be skipped); unpaid Pay Later and "Already Paid"
 *  (itself covered) never do, so cover can't be chained or given for free. Used by every "Expiring on". */
export const coveringVisit = () =>
  and(
    notInArray(AppointmentModel.appointmentStatus, [
      'Cancelled',
      'Missed',
      'NoShow',
      'Rescheduled',
    ]),
    sql`lower(${AppointmentPaymentModel.paymentStatus}) = 'paid'`
  );
