import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import { AppointmentModel as A } from '../../main/appointments/models/appointment.model';
import { CancellationRequestModel as CancellationRequest } from '../../main/cancellation-policy/models/cancellationPolicy.model';
import { CANCELLATION_REASONS } from '../../main/cancellation-policy/constants/reasons';
import { APPOINTMENT_TYPE_TREATMENT } from '../../main/appointments/utils/appointmentType.constants';
import { PaymentMode } from '../../main/appointments/utils/paymentMode.constants';
import type {
  AppointmentPort,
  BookingOption,
  PlanAppointment,
} from '../../main/treatmentPlan';
import { getISTDateString } from '../../utils/istDateTime';

// The booking services load lazily: their import chain reaches app.ts, which registers this adapter.
// Still ahead of the patient: the plan may link to these.
const OPEN_STATUSES = [
  'Upcoming',
  'Rescheduled',
  'Pending',
  'Confirmed',
  'Patient Arrived',
] as const;

const columns = {
  id: A.id,
  patientId: A.patientId,
  doctorId: A.doctorId,
  appointmentDate: A.appointmentDate,
  appointmentTime: A.appointmentTime,
  tokenNo: A.tokenNo,
  status: A.appointmentStatus,
  appointmentType: A.appointmentType,
};

type Row = {
  id: string;
  patientId: string;
  doctorId: string | null;
  appointmentDate: Date;
  appointmentTime: string | null;
  tokenNo: number | null;
  status: string | null;
  appointmentType: string | null;
};

// appointment_date holds UTC midnight of the IST day, so its UTC date is the IST day.
const toPlan = (r: Row): PlanAppointment => ({
  id: r.id,
  patientId: r.patientId,
  doctorId: r.doctorId,
  date: new Date(r.appointmentDate).toISOString().slice(0, 10),
  time: r.appointmentTime ? r.appointmentTime.slice(0, 5) : null,
  tokenNo: r.tokenNo,
  status: r.status ?? 'Upcoming',
  isPlanVisit: r.appointmentType === APPOINTMENT_TYPE_TREATMENT,
});

type SlotEntry = {
  start?: string;
  status?: string;
  isOffGrid?: boolean;
  sessionIndex?: number;
  tokens?: { tokenNo: number; status?: string }[];
  availableTokens?: number;
  sessionStart?: string;
  sessionEnd?: string;
};

export const appointmentAdapter: AppointmentPort = {
  async getAppointment(clinicId, appointmentId) {
    const [row] = await database
      .select(columns)
      .from(A)
      .where(and(eq(A.id, appointmentId), eq(A.clinicId, clinicId)))
      .limit(1);
    return row ? toPlan(row as Row) : null;
  },

  async cancelPlanVisit(clinicId, appointmentId, actorId, actorRole) {
    const { CancellationPolicyService } =
      await import('../../main/cancellation-policy/services/cancellationPolicy.service');
    await CancellationPolicyService.processCancellationRequest(
      appointmentId,
      actorId,
      actorRole,
      { reasonCode: 'other', comments: 'Taken off the treatment plan' },
      clinicId
    );
  },

  async cancellationOf(appointmentId) {
    const [row] = await database
      .select({
        actorId: CancellationRequest.userId,
        reasonCode: CancellationRequest.reasonCode,
        comments: CancellationRequest.comments,
      })
      .from(CancellationRequest)
      .where(eq(CancellationRequest.appointmentId, appointmentId))
      .orderBy(desc(CancellationRequest.createdAt))
      .limit(1);
    if (!row) return null;
    const label =
      CANCELLATION_REASONS.find((r) => r.code === row.reasonCode)
        ?.displayName ?? row.reasonCode;
    return {
      actorId: row.actorId,
      reason: [label, row.comments].filter(Boolean).join(': ') || null,
    };
  },

  async receivedOnVisitPaise(appointmentId) {
    const { MoneyReadService } = await import('../../main/money');
    return Math.max(
      0,
      (await MoneyReadService.balance('appointment', appointmentId)).received
    );
  },

  // Writes go through the appointments module's own entry point, in the plan's transaction.
  async coverVisit(tx, appointmentId, actorId) {
    const { AppointmentMoneySync } =
      await import('../../main/appointments/services/appointmentMoneySync.service');
    return AppointmentMoneySync.coverByPlan(
      tx as never,
      appointmentId,
      actorId
    );
  },

  async uncoverVisit(tx, appointmentId, actorId, was) {
    const { AppointmentMoneySync } =
      await import('../../main/appointments/services/appointmentMoneySync.service');
    await AppointmentMoneySync.coveredReturn(
      tx as never,
      appointmentId,
      actorId,
      was
    );
  },

  async getAppointments(clinicId, appointmentIds) {
    if (!appointmentIds.length) return new Map();
    const rows = await database
      .select(columns)
      .from(A)
      .where(and(inArray(A.id, appointmentIds), eq(A.clinicId, clinicId)));
    return new Map(rows.map((r) => [r.id, toPlan(r as Row)]));
  },

  // Same source as the appointment screen's slot grid, reduced to what a plan step can book.
  async bookingOptions(clinicId, doctorId, date) {
    const { AvailableSlotsService } =
      await import('../../main/appointment-engine/services/availableSlots.service');
    const { slots, tokensNotSet } =
      await AvailableSlotsService.getAvailableSlots(clinicId, doctorId, date);
    if (tokensNotSet)
      return { mode: 'token' as const, options: [], tokensNotSet: true };
    const entries = slots as unknown as SlotEntry[];
    // Today: the IST clock, to drop times and shifts already over.
    const now =
      date === getISTDateString()
        ? new Date()
            .toLocaleTimeString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: false,
            })
            .slice(0, 5)
        : null;
    if (entries.some((e) => Array.isArray(e.tokens))) {
      // Same rule as the appointment screen: an ended shift isn't offered, except the day's last (late walk-ins).
      const dayEnd = entries.reduce(
        (max, e) => (e.sessionEnd && e.sessionEnd > max ? e.sessionEnd : max),
        ''
      );
      const ended = (e: SlotEntry) =>
        !!now && !!e.sessionEnd && e.sessionEnd < dayEnd && e.sessionEnd <= now;
      // Every free number, not just the next: staff can give the patient the token they ask for.
      const options: BookingOption[] = entries
        .filter((e) => !ended(e))
        .flatMap((e) =>
          (e.tokens ?? [])
            .filter((t) => t.status === 'available')
            .map((t) => ({
              time: null,
              sessionIndex: e.sessionIndex ?? null,
              tokenNo: t.tokenNo,
              label: `Token ${t.tokenNo}`,
              group:
                e.sessionStart && e.sessionEnd
                  ? `${e.sessionStart}–${e.sessionEnd}`
                  : null,
            }))
        );
      return { mode: 'token' as const, options };
    }
    // Today: only times still ahead.
    const seen = new Set<string>();
    const options: BookingOption[] = [];
    for (const e of entries) {
      if (e.status !== 'available' || e.isOffGrid || !e.start) continue;
      const time = e.start.slice(11, 16);
      if ((now && time <= now) || seen.has(time)) continue;
      seen.add(time);
      options.push({
        time,
        sessionIndex: e.sessionIndex ?? null,
        tokenNo: null,
        label: time,
        group: null,
      });
    }
    return { mode: 'slot' as const, options };
  },

  // The plan never takes money at the desk (D1): "Not Required" is the existing no-fee mode.
  async bookTreatmentVisit(clinicId, actorId, input) {
    const { AppointmentService } =
      await import('../../main/appointments/services/appointment.service');
    const created = await AppointmentService.createAppointment(
      actorId,
      clinicId,
      {
        patientId: input.patientId,
        doctorId: input.doctorId,
        appointmentType: APPOINTMENT_TYPE_TREATMENT,
        appointmentDate: input.date,
        appointmentTime: input.time,
        ...(input.sessionIndex ? { sessionIndex: input.sessionIndex } : {}),
        ...(input.tokenNo ? { tokenNo: input.tokenNo } : {}),
        paymentMode: PaymentMode.NOT_REQUIRED,
        price: '0',
        appointmentNotes: input.notes,
      },
      actorId,
      { treatment: true }
    );
    return toPlan({
      id: created.id,
      patientId: created.patientId,
      doctorId: created.doctorId,
      appointmentDate: created.appointmentDate,
      appointmentTime: created.appointmentTime,
      tokenNo: created.tokenNo,
      status: created.appointmentStatus,
      appointmentType: APPOINTMENT_TYPE_TREATMENT,
    });
  },

  async todayForPatient(clinicId, patientId, doctorId, today) {
    const [row] = await database
      .select(columns)
      .from(A)
      .where(
        and(
          eq(A.clinicId, clinicId),
          eq(A.patientId, patientId),
          eq(A.doctorId, doctorId),
          eq(A.appointmentDate, new Date(`${today}T00:00:00Z`)),
          inArray(A.appointmentStatus, [
            'Upcoming',
            'Pending',
            'Confirmed',
            'Patient Arrived',
            'Completed',
          ])
        )
      )
      .orderBy(asc(A.appointmentTime))
      .limit(1);
    return row ? toPlan(row as Row) : null;
  },

  async upcomingForPatient(clinicId, patientId, doctorId, fromDate) {
    const rows = await database
      .select(columns)
      .from(A)
      .where(
        and(
          eq(A.clinicId, clinicId),
          eq(A.patientId, patientId),
          eq(A.doctorId, doctorId),
          gte(A.appointmentDate, new Date(`${fromDate}T00:00:00Z`)),
          inArray(A.appointmentStatus, [...OPEN_STATUSES])
        )
      )
      .orderBy(asc(A.appointmentDate), asc(A.appointmentTime))
      .limit(20);
    return rows.map((r) => toPlan(r as Row));
  },
};
