import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AppointmentModel } from '../models/appointment.model';
import {
  AppointmentPaymentModel,
  activeAppointmentFilter,
} from '../models/appointment-payment.model';
import { FinancialLedgerModel } from '../models/financialLedger.model';
import { whatsAppReminderQueue } from '../../notifications/services/appointmentWhatsappReminder.service';
import { autoNoShowQueue } from './autoNoShow.service';
import { signalAppointmentChange } from '../../realtime';
import { HttpError } from '../../../middlewear/errorHandler';
import { and, eq, ne, gte, lt, sql, inArray } from 'drizzle-orm';
import logger from '../../../utils/logger';

function formatDateOnlyLocal(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseTimeToMinutes(time?: string | null): number | null {
  if (!time) return null;
  const t = time.trim();

  const ampmMatch = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2] ?? 0);
    const ampm = ampmMatch[3].toLowerCase();
    if (hour === 12 && ampm === 'am') hour = 0;
    if (hour !== 12 && ampm === 'pm') hour += 12;
    return hour * 60 + min;
  }

  const hhmmMatch = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmMatch) {
    const hour = Number(hhmmMatch[1]);
    const min = Number(hhmmMatch[2]);
    return hour * 60 + min;
  }

  const plainNumMatch = t.match(/^(\d{1,2})$/);
  if (plainNumMatch) {
    const hour = Number(plainNumMatch[1]);
    return hour * 60;
  }

  const parsed = new Date(`1970-01-01T${t}`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getUTCHours() * 60 + parsed.getUTCMinutes();
  }

  return null;
}

function hashStringToInt32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export class PaymentReservationService {
  /**
   * Generates a reusable Drizzle filter to omit unpaid online bookings
   */
  static buildActiveAppointmentFilter = activeAppointmentFilter;

  /**
   * Generates a standardized Redis lock key
   */
  static buildLockKey(
    doctorId: string,
    date: Date,
    slotOrToken: string | number,
    /**
     * Which shift the token belongs to. Token numbering restarts at 1 per
     * shift, so without this a held morning token 3 also blocks evening
     * token 3 — two different appointments that merely share a number.
     * Omitted (or 1) keeps the original key shape, so locks written before
     * shift-wise numbering still match.
     */
    sessionIndex?: number | null
  ): string {
    const dateStr = formatDateOnlyLocal(date);
    if (
      typeof slotOrToken === 'number' ||
      (typeof slotOrToken === 'string' && /^\d+$/.test(slotOrToken))
    ) {
      const suffix =
        sessionIndex != null && sessionIndex > 1 ? `s${sessionIndex}:` : '';
      return `token_lock:${doctorId}:${dateStr}:${suffix}${slotOrToken}`;
    }
    return `slot_lock:${doctorId}:${dateStr}:${slotOrToken}`;
  }

  /**
   * Acquires a Redis slot/token lock. `false` means somebody else holds it.
   *
   * NX, not a plain write: two checkouts starting in the same instant both
   * passed validation before either hold existed, and a plain SET let the
   * second overwrite the first — so both paid and only one kept the slot.
   */
  static async createLock(
    appointmentId: string,
    doctorId: string,
    date: Date,
    slotOrToken: string | number,
    ttlSeconds: number,
    metadata?: { duration?: number; patientId?: string },
    sessionIndex?: number | null
  ): Promise<boolean> {
    const key = PaymentReservationService.buildLockKey(
      doctorId,
      date,
      slotOrToken,
      sessionIndex
    );
    const value = metadata
      ? JSON.stringify({ bookingRefId: appointmentId, ...metadata })
      : appointmentId;

    const acquired = await redisClient.set(key, value, 'EX', ttlSeconds, 'NX');
    if (acquired) return true;

    // The holder may be this same patient re-entering checkout on the same
    // slot; refusing that would block a retry of their own abandoned payment.
    if (!metadata?.patientId) return false;
    const existing = await redisClient.get(key);
    if (!existing) return false;
    try {
      const parsed = JSON.parse(existing);
      if (parsed?.patientId !== metadata.patientId) return false;
    } catch {
      return false;
    }

    await redisClient.setex(key, ttlSeconds, value);
    return true;
  }

  /**
   * Fetches all active Redis slot/token locks for a doctor on a specific date.
   */
  static async getActiveLocksForDate(
    doctorId: string,
    dateStr: string
  ): Promise<
    Array<{
      slotOrToken: string | number;
      /** Shift the token is held in; 1 for slot locks and pre-session keys. */
      sessionIndex: number;
      value: string;
    }>
  > {
    const tokenPattern = `token_lock:${doctorId}:${dateStr}:*`;
    const slotPattern = `slot_lock:${doctorId}:${dateStr}:*`;

    const [tokenKeys, slotKeys] = await Promise.all([
      redisClient.keys(tokenPattern),
      redisClient.keys(slotPattern),
    ]);

    const allKeys = [...tokenKeys, ...slotKeys];
    if (allKeys.length === 0) return [];

    const values = await redisClient.mget(...allKeys);
    const tokenPrefix = `token_lock:${doctorId}:${dateStr}:`;
    const slotPrefix = `slot_lock:${doctorId}:${dateStr}:`;

    return allKeys.map((key, idx) => {
      const isToken = key.startsWith('token_lock:');
      const prefix = isToken ? tokenPrefix : slotPrefix;
      const lastPart = key.slice(prefix.length);

      // Token keys are either '<token>' (session 1, the original shape) or
      // 's<n>:<token>' for a later shift.
      const sessioned = isToken ? /^s(\d+):(\d+)$/.exec(lastPart) : null;

      return {
        slotOrToken: isToken
          ? Number(sessioned ? sessioned[2] : lastPart)
          : lastPart,
        sessionIndex: sessioned ? Number(sessioned[1]) : 1,
        value: values[idx] || '',
      };
    });
  }

  /**
   * Deletes a Redis slot/token lock
   */
  static async releaseLock(
    doctorId: string,
    date: Date,
    slotOrToken: string | number,
    sessionIndex?: number | null
  ): Promise<void> {
    const key = PaymentReservationService.buildLockKey(
      doctorId,
      date,
      slotOrToken,
      sessionIndex
    );
    await redisClient.del(key);
  }

  /**
   * Filters out expired pending online bookings in-memory via Redis Pipeline (single round-trip)
   */
  static async filterExpiredPendingAppointments(
    appointments: any[]
  ): Promise<any[]> {
    const pendingAppts = appointments.filter(
      (appt) =>
        appt.appointmentStatus === 'Pending' &&
        appt.paymentMode === 'Online' &&
        appt.paymentStatus === 'Pending'
    );

    if (pendingAppts.length === 0) return appointments;

    const pipeline = redisClient.pipeline();
    pendingAppts.forEach((appt) => {
      const lockKey = PaymentReservationService.buildLockKey(
        appt.doctorId,
        new Date(appt.appointmentDate),
        appt.tokenNo || appt.appointmentTime,
        appt.sessionIndex
      );
      pipeline.exists(lockKey);
    });

    const lockResults = await pipeline.exec();
    const activePendingIds = new Set<string>();

    pendingAppts.forEach((appt, index) => {
      const [err, exists] = lockResults?.[index] ?? [null, 0];
      if (!err && exists === 1) {
        activePendingIds.add(appt.id);
      }
    });

    return appointments.filter((appt) => {
      if (
        appt.appointmentStatus === 'Pending' &&
        appt.paymentMode === 'Online' &&
        appt.paymentStatus === 'Pending'
      ) {
        return activePendingIds.has(appt.id);
      }
      return true;
    });
  }

  /**
   * Non-blocking background transaction to clean up an expired checkout
   */
  static async cleanupExpired(appointmentId: string): Promise<void> {
    try {
      const cancelled = await database.transaction(async (tx) => {
        // 1. Fetch appointment details
        const [appointment] = await tx
          .select({
            id: AppointmentModel.id,
            clinicId: AppointmentModel.clinicId,
            doctorId: AppointmentModel.doctorId,
            patientId: AppointmentModel.patientId,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            tokenNo: AppointmentModel.tokenNo,
            paymentStatus: AppointmentPaymentModel.paymentStatus,
            paymentMode: AppointmentPaymentModel.paymentMode,
          })
          .from(AppointmentModel)
          .leftJoin(
            AppointmentPaymentModel,
            eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
          )
          .where(
            and(
              eq(AppointmentModel.id, appointmentId),
              eq(AppointmentModel.appointmentStatus, 'Pending')
            )
          );

        if (
          !appointment ||
          appointment.paymentStatus !== 'Pending' ||
          appointment.paymentMode !== 'Online'
        ) {
          return null; // Already paid, cancelled, or not online
        }

        // 2. Perform DB updates
        await tx
          .update(AppointmentModel)
          .set({
            appointmentStatus: 'Cancelled',
            reReasonForCancellation: 'payment_expired',
            updatedAt: new Date(),
          })
          .where(eq(AppointmentModel.id, appointmentId));

        await tx
          .update(AppointmentPaymentModel)
          .set({
            paymentStatus: 'Failed',
            paymentNotes: 'Payment window expired (10 minutes limit exceeded).',
            updatedAt: new Date(),
          })
          .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));

        // 3. Clear Redis Slot Lock
        const lockKey = PaymentReservationService.buildLockKey(
          appointment.doctorId!,
          new Date(appointment.appointmentDate),
          appointment.tokenNo || appointment.appointmentTime!
        );
        await redisClient.del(lockKey);

        // 4. Remove BullMQ Notification Queues
        await Promise.allSettled([
          whatsAppReminderQueue.removeWhatsAppReminders(
            appointment.id,
            appointment.clinicId
          ),
          autoNoShowQueue.removeAutoNoShow(appointment.id),
        ]);

        return appointment;
      });

      // Post-commit: the slot just freed up and the payment failed — both the
      // doctor's queue and reception's billing view are stale without this.
      if (cancelled) {
        signalAppointmentChange(cancelled, 'appointment.cancelled');
      }

      logger.info(
        `Successfully cleaned up expired checkout for appointment ${appointmentId}`
      );
    } catch (err) {
      logger.error(
        `Failed to clean up expired checkout for appointment ${appointmentId}`,
        err
      );
    }
  }

  /**
   * Conflict verification inside Postgres Advisory Lock during payment completion
   */
  static async verifyLatePayment(
    appointmentId: string,
    paymentId: string,
    _performedByUserId: string
  ): Promise<void> {
    // 1. Fetch appointment details
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
        doctorId: AppointmentModel.doctorId,
        clinicId: AppointmentModel.clinicId,
        appointmentStatus: AppointmentModel.appointmentStatus,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        appointmentDurationMinutes: AppointmentModel.appointmentDurationMinutes,
        price: AppointmentPaymentModel.price,
        paymentStatus: AppointmentPaymentModel.paymentStatus,
        paymentRecordId: AppointmentPaymentModel.id,
        platformCommission: AppointmentPaymentModel.platformCommission,
        pgFee: AppointmentPaymentModel.pgFee,
        gstAmount: AppointmentPaymentModel.gstAmount,
        convenienceFee: AppointmentPaymentModel.convenienceFee,
        transferredAmount: AppointmentPaymentModel.transferredAmount,
      })
      .from(AppointmentModel)
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found');
    }

    // If already paid, do nothing
    if (appointment.paymentStatus === 'Paid') {
      return;
    }

    const apptDateObj = new Date(appointment.appointmentDate);
    const dayStart = new Date(apptDateObj);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    let conflictExists = false;

    await database.transaction(async (tx) => {
      const dateOnlyStr = formatDateOnlyLocal(apptDateObj);
      const key1 = hashStringToInt32(appointment.doctorId || '');
      const key2 = hashStringToInt32(dateOnlyStr);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${key1}, ${key2})`);

      // Query conflicting active appointments on the same date
      const conflictingAppts = await tx
        .select({
          id: AppointmentModel.id,
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
          appointmentStatus: AppointmentModel.appointmentStatus,
          tokenNo: AppointmentModel.tokenNo,
          paymentMode: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          doctorId: AppointmentModel.doctorId,
          appointmentDate: AppointmentModel.appointmentDate,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, appointment.clinicId),
            eq(AppointmentModel.doctorId, appointment.doctorId!),
            gte(AppointmentModel.appointmentDate, dayStart),
            lt(AppointmentModel.appointmentDate, dayEnd),
            ne(AppointmentModel.id, appointment.id),
            inArray(AppointmentModel.appointmentStatus, [
              'Upcoming',
              'Confirmed',
              'Patient Arrived',
              'Pending',
              'Rescheduled',
              'Completed',
            ])
          )
        );

      const activeConflictingAppts =
        await PaymentReservationService.filterExpiredPendingAppointments(
          conflictingAppts
        );

      if (appointment.tokenNo !== null && appointment.tokenNo > 0) {
        conflictExists = activeConflictingAppts.some(
          (ca) =>
            ca.tokenNo !== null &&
            Number(ca.tokenNo) === Number(appointment.tokenNo)
        );
      } else if (appointment.appointmentTime) {
        const apptMin = parseTimeToMinutes(appointment.appointmentTime);
        if (apptMin !== null) {
          const defaultDuration = 30;
          const apptDur = Math.max(
            1,
            Number(appointment.appointmentDurationMinutes) || defaultDuration
          );
          const apptEndMin = apptMin + apptDur;

          conflictExists = activeConflictingAppts.some((ca) => {
            if (!ca.appointmentTime) return false;
            const caStart = parseTimeToMinutes(ca.appointmentTime);
            if (caStart === null) return false;
            const caDur = Math.max(
              1,
              Number(ca.appointmentDurationMinutes) || defaultDuration
            );
            const caEnd = caStart + caDur;
            return apptMin < caEnd && apptEndMin > caStart;
          });
        }
      }

      if (conflictExists) {
        // Record payment but keep appointment cancelled/system-cancelled
        await tx
          .update(AppointmentPaymentModel)
          .set({
            paymentStatus: 'Paid',
            transactionId: paymentId,
            refundNotes: 'Refund Required: Slot occupied by another booking',
            paymentNotes: 'Paid via Razorpay. Booking slot occupied.',
            updatedAt: new Date(),
          })
          .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
      } else {
        // No conflict, safe to confirm
        await tx
          .update(AppointmentModel)
          .set({
            appointmentStatus: 'Pending', // keep status as Pending as per existing confirmPaymentAndAppoint logic
            updatedAt: new Date(),
          })
          .where(eq(AppointmentModel.id, appointmentId));

        await tx
          .update(AppointmentPaymentModel)
          .set({
            paymentStatus: 'Paid',
            transactionId: paymentId,
            paymentNotes: 'Paid via Razorpay.',
            updatedAt: new Date(),
          })
          .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
      }

      // 3. Append ledger entries (Idempotency Guard: check if payment_received is already logged)
      if (appointment.paymentRecordId) {
        const [existingLedger] = await tx
          .select({ id: FinancialLedgerModel.id })
          .from(FinancialLedgerModel)
          .where(
            and(
              eq(FinancialLedgerModel.paymentId, appointment.paymentRecordId),
              eq(FinancialLedgerModel.entryType, 'PAYMENT_RECEIVED')
            )
          )
          .limit(1);

        if (!existingLedger) {
          const priceVal = parseFloat(appointment.price || '0');
          const commVal = parseFloat(appointment.platformCommission || '0');
          const gstVal = parseFloat(appointment.gstAmount || '0');
          const pgVal = parseFloat(appointment.pgFee || '0');
          const convVal = parseFloat(appointment.convenienceFee || '0');
          const txVal = parseFloat(appointment.transferredAmount || '0');

          const ledgerValues: any[] = [
            {
              appointmentId,
              clinicId: appointment.clinicId,
              paymentId: appointment.paymentRecordId,
              entryType: 'PAYMENT_RECEIVED',
              amount: String(priceVal),
              description: 'Patient payment captured',
              gatewayReferenceId: paymentId,
            },
          ];

          if (commVal > 0) {
            ledgerValues.push({
              appointmentId,
              clinicId: appointment.clinicId,
              paymentId: appointment.paymentRecordId,
              entryType: 'PLATFORM_COMMISSION',
              amount: String(-commVal),
              description: 'Platform commission retained',
              gatewayReferenceId: paymentId,
            });
          }

          if (gstVal > 0) {
            ledgerValues.push({
              appointmentId,
              clinicId: appointment.clinicId,
              paymentId: appointment.paymentRecordId,
              entryType: 'GST',
              amount: String(-gstVal),
              description: 'GST on platform commission',
              gatewayReferenceId: paymentId,
            });
          }

          if (pgVal > 0) {
            ledgerValues.push({
              appointmentId,
              clinicId: appointment.clinicId,
              paymentId: appointment.paymentRecordId,
              entryType: 'PG_FEE',
              amount: String(-pgVal),
              description: 'Razorpay PG processing fee',
              gatewayReferenceId: paymentId,
            });
          }

          if (convVal > 0) {
            ledgerValues.push({
              appointmentId,
              clinicId: appointment.clinicId,
              paymentId: appointment.paymentRecordId,
              entryType: 'CONVENIENCE_FEE',
              amount: String(convVal),
              description: 'PG convenience fee markup charged to patient',
              gatewayReferenceId: paymentId,
            });
          }

          if (txVal > 0) {
            ledgerValues.push({
              appointmentId,
              clinicId: appointment.clinicId,
              paymentId: appointment.paymentRecordId,
              entryType: 'TRANSFER_CREATED',
              amount: String(-txVal),
              description: 'Routed split transfer to clinic sub-account',
              gatewayReferenceId: paymentId,
            });
          }

          await tx.insert(FinancialLedgerModel).values(ledgerValues);
        }
      }
    });

    // Delete Redis Lock key outside database transaction
    const lockKey = PaymentReservationService.buildLockKey(
      appointment.doctorId!,
      apptDateObj,
      appointment.tokenNo || appointment.appointmentTime!
    );
    await redisClient.del(lockKey).catch((err) => {
      logger.error('Failed to delete lock key in verifyLatePayment', err);
    });

    // The payment was recorded in both branches above (Paid either way) —
    // signal even when a conflict is about to be thrown below, since the
    // write already committed and reception's billing view is now stale.
    signalAppointmentChange(appointment, 'billing.payment_updated');

    if (conflictExists) {
      throw new HttpError(
        409,
        'This slot has been booked by another user because the payment window expired.'
      );
    }
  }
}
