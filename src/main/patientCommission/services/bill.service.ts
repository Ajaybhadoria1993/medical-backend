import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString, startOfDayIST } from '../../../utils/istDateTime';
import { getAppointmentsPort } from '../ports';
import type {
  CommissionOverview,
  CommissionPeriod,
  CommissionPricing,
  DoctorAppointmentsPage,
  DoctorBill,
  PricingSource,
} from '../types/patientCommission.types';
import { addDays, periodContaining } from '../utils/commissionPeriod.utils';
import {
  nextTierAfter,
  rateForPatients,
} from '../utils/commissionPricing.utils';
import { PricingService } from './pricing.service';

/** Who is asking: a Doctor sees only their own patients, an Admin the whole clinic. */
export interface BillActor {
  id: string;
  userType: string;
}

/** A clinic's per-patient bill: one line per doctor, each priced by that doctor's own patient count. */
export class BillService {
  /** The bill for the period holding `date` (default today), one line per doctor the actor may see. */
  static async overview(input: {
    clinicId: string;
    actor: BillActor;
    date?: string;
  }): Promise<CommissionOverview> {
    const { clinicId, actor } = input;
    const { today, period, pricing, source } = await BillService.periodFor(
      clinicId,
      input.date
    );
    const counts = await getAppointmentsPort().countByDoctor(
      clinicId,
      period.startDate,
      period.nextStartDate
    );
    const visible =
      actor.userType === 'Doctor'
        ? counts.filter((c) => c.doctorId === actor.id)
        : counts;
    const doctors: DoctorBill[] = visible
      .map((c) => {
        const ratePaise = rateForPatients(pricing.tiers, c.patients);
        return {
          doctorId: c.doctorId,
          name: c.name,
          patients: c.patients,
          ratePaise,
          amountPaise: ratePaise * c.patients,
          nextTier: nextTierAfter(pricing.tiers, c.patients),
        };
      })
      .sort((a, b) => b.patients - a.patients || a.name.localeCompare(b.name));
    return {
      period: {
        ...period,
        isCurrent: period.nextStartDate > today,
        previousDate: addDays(period.startDate, -1),
        nextDate: period.nextStartDate <= today ? period.nextStartDate : null,
      },
      pricing: { ...pricing, source },
      doctors,
      totals: {
        patients: doctors.reduce((sum, d) => sum + d.patients, 0),
        amountPaise: doctors.reduce((sum, d) => sum + d.amountPaise, 0),
      },
    };
  }

  /** One doctor's billable appointments in the period holding `date`, newest first. */
  static async doctorAppointments(input: {
    clinicId: string;
    actor: BillActor;
    doctorId: string;
    date?: string;
    pageNumber: number;
    pageSize: number;
  }): Promise<DoctorAppointmentsPage> {
    const { clinicId, actor, doctorId } = input;
    if (actor.userType === 'Doctor' && actor.id !== doctorId) {
      throw new HttpError(403, 'Doctors can see only their own patients.');
    }
    const port = getAppointmentsPort();
    const name = await port.getDoctorName(clinicId, doctorId);
    if (name === null) throw new HttpError(404, 'Doctor not found.');
    const { period } = await BillService.periodFor(clinicId, input.date);
    const { total, items } = await port.listForDoctor(
      clinicId,
      doctorId,
      period.startDate,
      period.nextStartDate,
      input.pageSize,
      (input.pageNumber - 1) * input.pageSize
    );
    return { period, doctor: { id: doctorId, name }, total, items };
  }

  /** The period holding `date` under the pricing in force that day; a change only ever starts on a period boundary. */
  private static async periodFor(
    clinicId: string,
    date?: string
  ): Promise<{
    today: string;
    period: CommissionPeriod;
    pricing: CommissionPricing;
    source: PricingSource;
  }> {
    const today = getISTDateString();
    const day = date ?? today;
    if (day > today) {
      throw new HttpError(400, 'A bill cannot be shown for a future date.');
    }
    const { pricing, source } = await PricingService.resolveFor(
      clinicId,
      startOfDayIST(day)
    );
    return {
      today,
      period: periodContaining(day, pricing.periodKind),
      pricing,
      source,
    };
  }
}
