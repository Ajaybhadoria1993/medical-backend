/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import {
  isPayLaterMode,
  isOnlinePaymentMode,
} from '../utils/paymentMode.constants';
import { MoneyReadService } from '../../money';
import { AppointmentModel } from '../models/appointment.model';
import { appointmentMultipleService } from '../models/appointmentMultipleService.model';
import { istDayBoundsUtc } from '../../../utils/istDateTime';
import { clinicAmountLines } from '../../dashboard/utils/revenueSql';
import { GetAppointmentPaymentsDto } from '../schemas/appointment.schemas';
import type { PaymentTransaction } from '../types/appointment.types';
import { buildActiveAppointmentFilter } from './appointment.service';

/** Payment History rows for appointments and treatment plans, from the money ledger and legacy payments. */
export class AppointmentPaymentsService {
  /** Payment History rows for the clinic, filtered by role, date and status. */
  static async getAppointmentPaymentTransactions(
    query: GetAppointmentPaymentsDto,
    user: any,
    clinicId: string
  ) {
    return await database.transaction(async (tx) => {
      // Check authorization
      if (
        !['Admin', 'Doctor', 'Receptionist', 'Super_Admin'].includes(
          user.userType
        )
      ) {
        throw new HttpError(
          403,
          'Access denied. Only Admin, Doctor, and Receptionist can access this resource.'
        );
      }

      const conditions = [];

      // Exclude unpaid pending online checkouts
      conditions.push(buildActiveAppointmentFilter());

      // Clinic filter
      conditions.push(eq(AppointmentModel.clinicId, clinicId));

      // Role-based filtering
      if (user.userType === 'Doctor') {
        conditions.push(eq(AppointmentModel.doctorId, user.id));
      }

      // Uncollected appointment attempts are read from the payment record;
      // successful payments and refunds come from the money ledger below.
      const requestedStatuses = query.paymentStatus
        ? Array.isArray(query.paymentStatus)
          ? query.paymentStatus
          : [query.paymentStatus]
        : ['Paid', 'Refunded', 'Already Paid'];
      const normalizedStatuses = requestedStatuses.map((status) =>
        status.toLowerCase()
      );
      const wantsAllStatuses = normalizedStatuses.includes('all');
      const wantPending =
        wantsAllStatuses || normalizedStatuses.includes('pending');
      const wantFailed =
        wantsAllStatuses || normalizedStatuses.includes('failed');
      const appointmentPaymentStatuses = [
        ...(wantPending ? ['Pending', 'pending', 'PENDING'] : []),
        ...(wantFailed ? ['Failed', 'failed', 'FAILED'] : []),
      ];
      if (appointmentPaymentStatuses.length) {
        conditions.push(
          inArray(
            AppointmentPaymentModel.paymentStatus,
            appointmentPaymentStatuses
          )
        );
      }

      // Doctor filter
      if (query.doctorId) {
        const doctorIds = Array.isArray(query.doctorId)
          ? query.doctorId
          : [query.doctorId];
        conditions.push(inArray(AppointmentModel.doctorId, doctorIds));
      }

      // Booked via: the patient app/portal, or staff in the clinic app.
      if (query.source) {
        conditions.push(
          inArray(
            AppointmentModel.bookingSource,
            query.source === 'patient_app'
              ? ['mobile_app', 'web_portal']
              : ['walk_in', 'phone_call', 'system']
          )
        );
      }

      // Patient filter
      if (query.patientId) {
        const patientIds = Array.isArray(query.patientId)
          ? query.patientId
          : [query.patientId];
        conditions.push(inArray(AppointmentModel.patientId, patientIds));
      }

      // IST days, the bounds the dashboard uses; default is the last 30 days.
      const todayIst = istDayBoundsUtc().start;
      const { start } = istDayBoundsUtc(
        (
          query.startDate ??
          new Date(todayIst.getTime() - 30 * 86_400_000).toISOString()
        ).slice(0, 10)
      );
      const { end } = istDayBoundsUtc(query.endDate?.slice(0, 10));

      // Matches if either the visit date (appointmentDate) OR booking creation (createdAt)
      // falls within the selected date range.
      conditions.push(
        or(
          and(
            gte(AppointmentModel.appointmentDate, start),
            lte(AppointmentModel.appointmentDate, end)
          ),
          and(
            gte(AppointmentModel.createdAt, start),
            lte(AppointmentModel.createdAt, end)
          )
        )
      );

      // Aliases for joins
      const patientUser = alias(UserModel, 'patientUser');
      const doctorUser = alias(UserModel, 'doctorUser');

      // Search condition
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        const isGenericKeyword = [
          'credit',
          'debit',
          'primary',
          'additional',
        ].some((kw) => searchLower.includes(kw) || kw.includes(searchLower));

        if (!isGenericKeyword) {
          const searchPattern = `%${searchLower}%`;
          conditions.push(
            sql`(
              lower(${patientUser.name}) LIKE ${searchPattern} OR 
              lower(${doctorUser.name}) LIKE ${searchPattern} OR 
              lower(${ClinicServiceModel.serviceName}) LIKE ${searchPattern} OR
              ${patientUser.mobile} LIKE ${searchPattern} OR
              lower(${AppointmentPaymentModel.transactionId}) LIKE ${searchPattern} OR
              lower(cast(${AppointmentModel.id} as text)) LIKE ${searchPattern}
            )`
          );
        }
      }

      const appointments = !appointmentPaymentStatuses.length
        ? []
        : await tx
            .select({
              id: AppointmentModel.id,
              appointmentDate: AppointmentModel.appointmentDate,
              bookingSource: AppointmentModel.bookingSource,
              createdAt: AppointmentModel.createdAt,
              paymentUpdatedAt: AppointmentPaymentModel.updatedAt,
              paymentRecordId: AppointmentPaymentModel.id,
              paymentStatus: AppointmentPaymentModel.paymentStatus,
              paymentMode: AppointmentPaymentModel.paymentMode,
              primaryServicePrice: AppointmentPaymentModel.primaryServicePrice,
              price: AppointmentPaymentModel.price,
              transactionId: AppointmentPaymentModel.transactionId,
              gatewayOrderId: AppointmentPaymentModel.gatewayOrderId,
              gatewayResponse: AppointmentPaymentModel.gatewayResponse,
              serviceId: ClinicServiceModel.id,
              serviceName: ClinicServiceModel.serviceName,
              doctorId: doctorUser.id,
              doctorName: doctorUser.name,
              doctorSpeciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`,
              patientId: patientUser.id,
              patientName: patientUser.name,
              patientMobile: patientUser.mobile,
            })
            .from(AppointmentModel)
            .innerJoin(
              AppointmentPaymentModel,
              eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
            )
            .leftJoin(
              patientUser,
              eq(AppointmentModel.patientId, patientUser.id)
            )
            .leftJoin(doctorUser, eq(AppointmentModel.doctorId, doctorUser.id))
            .leftJoin(
              ClinicServiceModel,
              eq(AppointmentModel.clinicServiceId, ClinicServiceModel.id)
            )
            .where(and(...conditions))
            .orderBy(desc(AppointmentModel.createdAt));

      // Fetch additional services for ALL appointments that might need them
      const allAppointmentIds = appointments.map((apt) => apt.id);
      const additionalServicesMap = new Map<string, any[]>();

      if (allAppointmentIds.length > 0) {
        const additionalServices = await tx
          .select({
            appointmentId: appointmentMultipleService.appointmentId,
            id: appointmentMultipleService.id,
            serviceId: appointmentMultipleService.serviceId,
            serviceName: ClinicServiceModel.serviceName,
            price: appointmentMultipleService.price,
            paymentMode: appointmentMultipleService.paymentMode,
            payment_notes: appointmentMultipleService.payment_notes,
            createdAt: appointmentMultipleService.createdAt,
          })
          .from(appointmentMultipleService)
          .leftJoin(
            ClinicServiceModel,
            eq(appointmentMultipleService.serviceId, ClinicServiceModel.id)
          )
          .where(
            inArray(appointmentMultipleService.appointmentId, allAppointmentIds)
          );

        additionalServices.forEach((service) => {
          if (!additionalServicesMap.has(service.appointmentId)) {
            additionalServicesMap.set(service.appointmentId, []);
          }
          additionalServicesMap.get(service.appointmentId)!.push(service);
        });
      }

      // Transform appointments into payment transactions
      let transactions: PaymentTransaction[] = [];

      appointments.forEach((appointment) => {
        const additionalServices =
          additionalServicesMap.get(appointment.id) || [];
        const statusLower = appointment.paymentStatus?.toLowerCase();
        // Same split as the dashboard's CLINIC_AMOUNT, so both screens sum alike.
        const { primary: primaryPrice } = clinicAmountLines(
          appointment.primaryServicePrice,
          appointment.price,
          additionalServices.map((s) => Number(s.price) || 0)
        );

        if (statusLower === 'pending' || statusLower === 'failed') {
          // Pay Later/at Clinic aren't transactions yet; keep gateway/online attempts even if failed.
          const isRazorpayOrOnlineAttempt = (
            paymentMode?: string | null,
            gatewayTransactionId?: string | null
          ) => isOnlinePaymentMode(paymentMode, gatewayTransactionId);
          const primaryHasPaymentFlow =
            !isPayLaterMode(appointment.paymentMode) ||
            isRazorpayOrOnlineAttempt(
              appointment.paymentMode,
              appointment.transactionId || appointment.gatewayOrderId
            );

          if (primaryPrice > 0 && primaryHasPaymentFlow) {
            const onlineAttempt = isRazorpayOrOnlineAttempt(
              appointment.paymentMode,
              appointment.transactionId || appointment.gatewayOrderId
            );
            const providerPaymentId =
              appointment.transactionId &&
              !appointment.transactionId.startsWith('offline_')
                ? appointment.transactionId
                : null;
            const localReference = onlineAttempt
              ? null
              : providerPaymentId || `offline_${appointment.paymentRecordId}`;
            transactions.push({
              id: appointment.paymentRecordId,
              paymentRecordId: appointment.paymentRecordId,
              providerPaymentId: onlineAttempt ? providerPaymentId : null,
              providerOrderId: onlineAttempt
                ? appointment.gatewayOrderId || null
                : null,
              localReference,
              patientName: appointment.patientName || 'Unknown',
              patientMobile: appointment.patientMobile || 'N/A',
              doctorName: appointment.doctorName || 'Unknown',
              doctorSpeciality: appointment.doctorSpeciality || 'General',
              serviceName: appointment.serviceName || 'Consultation',
              appointmentDate:
                appointment.appointmentDate || appointment.createdAt,
              transactionTimestamp: appointment.createdAt,
              price: primaryPrice,
              entryType: 'Credit',
              paymentStatus: statusLower === 'failed' ? 'Failed' : 'Pending',
              paymentMode: appointment.paymentMode || 'Unknown',
              transactionId: onlineAttempt
                ? appointment.transactionId || appointment.gatewayOrderId || ''
                : localReference || '',
              originalAppointmentId: appointment.id,
              gatewayTransactionId: onlineAttempt
                ? appointment.transactionId ||
                  appointment.gatewayOrderId ||
                  undefined
                : undefined,
              bookingSource: appointment.bookingSource,
            });
          }
          additionalServices.forEach((service) => {
            const servicePrice = Number(service.price) || 0;
            const servicePaymentMode =
              service.paymentMode || appointment.paymentMode;
            const serviceHasPaymentFlow =
              !isPayLaterMode(servicePaymentMode) ||
              isRazorpayOrOnlineAttempt(
                servicePaymentMode,
                appointment.transactionId || appointment.gatewayOrderId
              );
            if (servicePrice > 0 && serviceHasPaymentFlow) {
              const onlineAttempt = isRazorpayOrOnlineAttempt(
                servicePaymentMode,
                appointment.transactionId || appointment.gatewayOrderId
              );
              const providerPaymentId =
                appointment.transactionId &&
                !appointment.transactionId.startsWith('offline_')
                  ? appointment.transactionId
                  : null;
              const localReference = onlineAttempt
                ? null
                : providerPaymentId || `offline_${service.id}`;
              transactions.push({
                id: service.id,
                paymentRecordId: appointment.paymentRecordId,
                providerPaymentId: onlineAttempt ? providerPaymentId : null,
                providerOrderId: onlineAttempt
                  ? appointment.gatewayOrderId || null
                  : null,
                localReference,
                patientName: appointment.patientName || 'Unknown',
                patientMobile: appointment.patientMobile || 'N/A',
                doctorName: appointment.doctorName || 'Unknown',
                doctorSpeciality: appointment.doctorSpeciality || 'General',
                serviceName: service.serviceName || 'Additional Service',
                appointmentDate:
                  appointment.appointmentDate || appointment.createdAt,
                transactionTimestamp: appointment.createdAt,
                price: servicePrice,
                entryType: 'Credit',
                paymentStatus: statusLower === 'failed' ? 'Failed' : 'Pending',
                paymentMode: servicePaymentMode || 'Unknown',
                transactionId: onlineAttempt
                  ? appointment.transactionId ||
                    appointment.gatewayOrderId ||
                    ''
                  : localReference || '',
                originalAppointmentId: appointment.id,
                gatewayTransactionId: onlineAttempt
                  ? appointment.transactionId ||
                    appointment.gatewayOrderId ||
                    undefined
                  : undefined,
                bookingSource: appointment.bookingSource,
              });
            }
          });
        }
      });

      // Attach channel ("online" vs "offline") to each transaction:
      // An appointment booked via patient app/portal or paid online is marked 'online'.
      transactions = transactions.map((t) => ({
        ...t,
        channel:
          ['mobile_app', 'web_portal'].includes(
            String(t.bookingSource || '').toLowerCase()
          ) ||
          isOnlinePaymentMode(
            t.paymentMode || t.refundMode,
            t.gatewayTransactionId
          )
            ? 'online'
            : 'offline',
      }));

      // Filter out transactions with invalid payment modes
      transactions = transactions.filter((t) => {
        const mode = t.entryType === 'Credit' ? t.paymentMode : t.refundMode;
        return mode && mode !== 'Not Required';
      });

      // Money received and refunded (appointments and treatment plans) from the ledger reader;
      // the search, mode and entry filters below apply to these rows too.
      transactions.push(
        ...(await AppointmentPaymentsService.ledgerTransactions(
          tx,
          query,
          user,
          clinicId,
          start,
          end
        ))
      );

      // Filter by search query on transactions
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        transactions = transactions.filter((t) => {
          return (
            t.patientName.toLowerCase().includes(searchLower) ||
            t.patientMobile.toLowerCase().includes(searchLower) ||
            t.doctorName.toLowerCase().includes(searchLower) ||
            t.doctorSpeciality.toLowerCase().includes(searchLower) ||
            t.serviceName.toLowerCase().includes(searchLower) ||
            (t.transactionId &&
              t.transactionId.toLowerCase().includes(searchLower)) ||
            (t.gatewayTransactionId &&
              t.gatewayTransactionId.toLowerCase().includes(searchLower)) ||
            (t.paymentMode &&
              t.paymentMode.toLowerCase().includes(searchLower)) ||
            (t.refundMode && t.refundMode.toLowerCase().includes(searchLower))
          );
        });
      }

      if (query.paymentMode) {
        const normalizeMode = (m?: string | null) =>
          (m || '').toLowerCase().replace(/\s+/g, '');

        const requestedModes = (
          Array.isArray(query.paymentMode)
            ? query.paymentMode
            : [query.paymentMode]
        ).map(normalizeMode);

        transactions = transactions.filter((t) => {
          if (t.entryType === 'Credit') {
            // A due is not collected yet, so payment-mode filters apply only
            // to actual payments and failed attempts.
            return (
              t.paymentStatus !== 'Pending' &&
              requestedModes.includes(normalizeMode(t.paymentMode))
            );
          } else if (t.entryType === 'Debit') {
            return requestedModes.includes(normalizeMode(t.refundMode));
          }
          return true;
        });
      }

      // Filter by entry type
      if (query.entryType) {
        transactions = transactions.filter(
          (t) => t.entryType === query.entryType
        );
      }

      // Summary: only collected credit counts; Pending (Pay Later) goes to totalPendingAmount.
      const isCollectedCredit = (t: PaymentTransaction) =>
        t.entryType === 'Credit' &&
        ['Paid', 'Already Paid'].includes(t.paymentStatus);

      const summary = {
        totalCreditAmount: transactions
          .filter(isCollectedCredit)
          .reduce((sum, t) => sum + t.price, 0),
        totalDebitAmount: transactions
          .filter((t) => t.entryType === 'Debit')
          .reduce((sum, t) => sum + t.price, 0),
        // Booked-but-uncollected dues, kept apart so the UI doesn't show them as received.
        totalPendingAmount: transactions
          .filter(
            (t) => t.entryType === 'Credit' && t.paymentStatus === 'Pending'
          )
          .reduce((sum, t) => sum + t.price, 0),
        netAmount: transactions.reduce((sum, t) => {
          if (isCollectedCredit(t)) return sum + t.price;
          if (t.entryType === 'Debit') return sum - t.price;
          return sum;
        }, 0),
        totalTransactions: transactions.length,
        creditTransactions: transactions.filter((t) => t.entryType === 'Credit')
          .length,
        debitTransactions: transactions.filter((t) => t.entryType === 'Debit')
          .length,
        paymentModeSummary: {
          credit: transactions.filter(isCollectedCredit).reduce(
            (acc, t) => {
              const mode = t.paymentMode || 'Unknown';
              acc[mode] = (acc[mode] || 0) + t.price;
              return acc;
            },
            {} as Record<string, number>
          ),
          debit: transactions
            .filter((t) => t.entryType === 'Debit')
            .reduce(
              (acc, t) => {
                const mode = t.refundMode || 'Unknown';
                acc[mode] = (acc[mode] || 0) + t.price;
                return acc;
              },
              {} as Record<string, number>
            ),
        },
      };

      transactions.sort(
        (a, b) =>
          new Date(b.transactionTimestamp).getTime() -
          new Date(a.transactionTimestamp).getTime()
      );

      // Apply pagination
      const pageSize = Math.max(Number(query.pageSize) || 100, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      const paginatedTransactions = transactions.slice(offset, offset + limit);
      const totalRecords = transactions.length;
      const totalPages = Math.ceil(totalRecords / pageSize);

      return {
        data: paginatedTransactions,
        summary,
        metadata: {
          totalRecords,
          totalPages,
          currentPage: pageNumber,
          pageSize,
          dateRange: {
            start,
            end,
          },
        },
      };
    });
  }

  /** Ledger entries (appointments and plans) as Payment History rows, with the screen's filters. */
  private static async ledgerTransactions(
    tx: Parameters<Parameters<typeof database.transaction>[0]>[0],
    query: GetAppointmentPaymentsDto,
    user: { id: string; userType: string },
    clinicId: string,
    start: Date,
    end: Date
  ): Promise<PaymentTransaction[]> {
    const statuses = query.paymentStatus
      ? Array.isArray(query.paymentStatus)
        ? query.paymentStatus
        : [query.paymentStatus]
      : ['Paid', 'Refunded', 'Already Paid'];
    const wantPaid = statuses.some((s) =>
      ['paid', 'already paid', 'all'].includes(s.toLowerCase())
    );
    const wantRefunds = statuses.some((s) =>
      ['refunded', 'all'].includes(s.toLowerCase())
    );
    if (!wantPaid && !wantRefunds) return [];
    const asList = (v?: string | string[]) =>
      v ? (Array.isArray(v) ? v : [v]) : undefined;
    const patients = asList(query.patientId);
    const entries = (
      await MoneyReadService.entries({
        clinicId,
        start: start.toISOString(),
        end: end.toISOString(),
        // A doctor sees only their own money, as with appointments.
        doctorIds:
          user.userType === 'Doctor' ? [user.id] : asList(query.doctorId),
      })
    ).filter(
      (e) =>
        (e.type === 'refund' ? wantRefunds : wantPaid) &&
        (!patients || patients.includes(e.patientId)) &&
        // "Booked via" belongs to appointments; plan money has no booking source.
        (!query.source || e.sourceType === 'appointment')
    );
    if (!entries.length) return [];

    const visitIds = [
      ...new Set(
        entries
          .filter((e) => e.sourceType === 'appointment')
          .map((e) => e.sourceId)
      ),
    ];
    const providerPaymentReferences = new Map(
      (visitIds.length
        ? await tx
            .select({
              appointmentId: AppointmentPaymentModel.appointmentId,
              paymentRecordId: AppointmentPaymentModel.id,
              transactionId: AppointmentPaymentModel.transactionId,
              gatewayOrderId: AppointmentPaymentModel.gatewayOrderId,
            })
            .from(AppointmentPaymentModel)
            .where(inArray(AppointmentPaymentModel.appointmentId, visitIds))
        : []
      ).map((payment) => [payment.appointmentId, payment])
    );
    const visits = new Map(
      (visitIds.length
        ? await tx
            .select({
              id: AppointmentModel.id,
              date: AppointmentModel.appointmentDate,
              bookingSource: AppointmentModel.bookingSource,
              serviceName: ClinicServiceModel.serviceName,
            })
            .from(AppointmentModel)
            .leftJoin(
              ClinicServiceModel,
              eq(AppointmentModel.clinicServiceId, ClinicServiceModel.id)
            )
            .where(
              and(
                inArray(AppointmentModel.id, visitIds),
                query.source
                  ? inArray(
                      AppointmentModel.bookingSource,
                      query.source === 'patient_app'
                        ? ['mobile_app', 'web_portal']
                        : ['walk_in', 'phone_call', 'system']
                    )
                  : undefined
              )
            )
        : []
      ).map((v) => [v.id, v])
    );
    const people = new Map(
      (
        await tx
          .select({
            id: UserModel.id,
            name: UserModel.name,
            mobile: UserModel.mobile,
          })
          .from(UserModel)
          .where(
            inArray(UserModel.id, [
              ...new Set(
                entries.flatMap(
                  (e) => [e.patientId, e.doctorId].filter(Boolean) as string[]
                )
              ),
            ])
          )
      ).map((u) => [u.id, u])
    );

    const rows: PaymentTransaction[] = [];
    for (const e of entries) {
      const visit =
        e.sourceType === 'appointment' ? visits.get(e.sourceId) : undefined;
      // The booked-via filter dropped this visit.
      if (e.sourceType === 'appointment' && !visit) continue;
      const refund = e.type === 'refund';
      const amount = e.amountPaise / 100;
      const providerPayment =
        e.sourceType === 'appointment'
          ? providerPaymentReferences.get(e.sourceId)
          : undefined;
      const providerPaymentReference =
        providerPayment?.transactionId &&
        !providerPayment.transactionId.startsWith('offline_')
          ? providerPayment.transactionId
          : null;
      const providerRefundId =
        refund && e.channel === 'online' ? e.gatewayRef || null : null;
      const providerPaymentId =
        e.channel !== 'online'
          ? null
          : refund
            ? providerPaymentReference
            : providerPaymentReference ||
              (e.sourceType !== 'appointment' ? e.gatewayRef : null);
      const providerOrderId =
        e.channel === 'online' ? providerPayment?.gatewayOrderId || null : null;
      const localReference =
        e.channel === 'online' ? null : e.receiptNo || `offline_${e.id}`;
      const displayTransactionId =
        e.channel === 'online'
          ? refund
            ? providerRefundId || ''
            : providerPaymentId || providerOrderId || ''
          : localReference || '';
      rows.push({
        id: e.id,
        paymentRecordId: providerPayment?.paymentRecordId || null,
        providerPaymentId,
        providerOrderId,
        providerRefundId,
        localReference,
        patientName: people.get(e.patientId)?.name || 'Unknown',
        patientMobile: people.get(e.patientId)?.mobile || 'N/A',
        doctorName: (e.doctorId && people.get(e.doctorId)?.name) || 'Unknown',
        doctorSpeciality: 'General',
        serviceName: e.correction
          ? 'Correction'
          : e.sourceType === 'appointment'
            ? visit?.serviceName || 'Consultation'
            : e.label || (refund ? 'Refund' : 'Consultation'),
        appointmentDate: visit?.date ?? e.createdAt,
        transactionTimestamp: e.createdAt,
        price: amount,
        entryType: refund ? 'Debit' : 'Credit',
        paymentStatus: refund ? 'Refunded' : 'Paid',
        paymentMode: refund ? undefined : e.paymentMode || 'Unknown',
        refundMode: refund ? e.paymentMode || 'Unknown' : undefined,
        refundNotes: refund ? e.reason || undefined : undefined,
        channel: e.channel === 'online' ? 'online' : 'offline',
        // Online: gateway ID. Offline: last UUID segment of the money-entry ID as a stable reference.
        transactionId: displayTransactionId,
        originalAppointmentId: e.sourceType === 'appointment' ? e.sourceId : '',
        gatewayTransactionId: displayTransactionId || undefined,
        bookingSource: visit?.bookingSource ?? undefined,
        source:
          e.sourceType === 'appointment' ? 'appointment' : 'treatment_plan',
        planId: e.sourceType === 'treatment_plan' ? e.sourceId : undefined,
        receiptNo: e.receiptNo || undefined,
      });
    }
    return rows;
  }
}
