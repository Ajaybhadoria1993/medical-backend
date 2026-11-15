import {
  and,
  desc,
  eq,
  gte,
  inArray,
  ilike,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import redisClient from '../../configurations/redisConfig';
import {
  ClinicAssignModel,
  ClinicModel,
} from '../../main/clinic/models/clinic.model';
import { ClinicPaymentAccountModel } from '../../main/clinic/models/clinicPaymentAccount.model';
import { UserModel } from '../../main/users/models/user.model';
import { referredUserExistsSql } from '../../main/referral';
import { AuditLogModel } from '../../main/audit/models/auditLog.model';
import {
  REPORTED_ACTIONS,
  TRACKED_ACTIONS,
  auditActionLabel,
} from '../../main/audit/utils/trackedActions.utils';
import { RefreshTokenModel } from '../../main/users/models/refreshToken.model';
import { UserDevicesModel } from '../../main/users/models/userDevices.model';
import { AppointmentModel } from '../../main/appointments/models/appointment.model';
import {
  BillingReadService,
  SubscriptionActivityModel,
  SubscriptionReadService,
} from '../../main/subscription';
import type {
  AccountStatus,
  AdminUser,
  ClinicLabel,
  AuditFilters,
  SubscriptionEvent,
  PatientAppFacts,
  UsageFacts,
  AccountStatusCounts,
  ClinicFacts,
  ClinicIdentity,
  SourceDataPort,
  SubscriptionSpan,
} from '../../main/superadminAnalytics';

/** Reads a raw zone-less timestamp the way Drizzle's columns do (clock time as UTC), so the two compare. */
const asStoredDate = (v: string | Date | null): Date | null => {
  if (v === null) return null;
  if (v instanceof Date) return v;
  return new Date(
    `${v.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'}`
  );
};

// clinic_subscriptions dates are written by the app as UTC (checked: 5h30m behind clinics.created_at
// on every clinic), unlike DB-default columns, which hold IST clock time. Shift onto the IST clock.
const utcToStored = (d: Date) => new Date(d.getTime() + 330 * 60 * 1000);

/** Real instant of an IST calendar-day start, for timezone-aware columns. */
const istMidnight = (ymd: string) => new Date(`${ymd}T00:00:00.000+05:30`);

const shiftDay = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// A soft-deleted clinic is also 'Inactive'; report it as 'Deleted' so it isn't counted twice.
const ACCOUNT_STATUS = sql<string>`CASE WHEN ${ClinicModel.deletedAt} IS NOT NULL THEN 'Deleted' ELSE ${ClinicModel.status}::text END`;

// Nothing writes acquisition_source yet: an explicit value wins, else a referral signup by the owner.
const SOURCE = sql<string>`CASE
  WHEN ${ClinicModel.acquisitionSource} <> 'Unknown' THEN ${ClinicModel.acquisitionSource}
  WHEN ${referredUserExistsSql(ClinicModel.userId)} THEN 'Referral'
  ELSE 'Self sign-up' END`;

const IDENTITY = {
  clinicId: ClinicModel.id,
  clinicCode: ClinicModel.clinicCode,
  name: ClinicModel.clinicName,
  tagline: ClinicModel.Tagline,
  logo: ClinicModel.clinicLogo,
  city: ClinicModel.City,
  state: ClinicModel.State,
  phone: ClinicModel.clinicPhone,
  acquisitionSource: SOURCE,
  status: ACCOUNT_STATUS,
  createdAt: ClinicModel.createdAt,
};

// Same set as Clinic Management (ClinicService.getAvailableClinics): approved clinics
// whose owner finished signup. Pending/Rejected belong to the Requests board.
const MANAGED = and(
  sql`${ClinicModel.status} IN ('Active', 'Inactive', 'Blocked')`,
  sql`${UserModel.userStatus} <> 'New'`
);

// Any booking that wasn't cancelled shows the clinic used the product that day.
const A = AppointmentModel;
/** The clinic's Razorpay payout account (one row per clinic). */
const P = ClinicPaymentAccountModel;
const USED = sql`${A.appointmentStatus} <> 'Cancelled'`;

// Action families for the audit filter, e.g. 'appointment' from 'appointment.cancelled'.
const AUDIT_TYPES = [
  ...new Set(
    [...Object.values(TRACKED_ACTIONS), ...Object.values(REPORTED_ACTIONS)].map(
      (t) => t.action.split('.')[0]
    )
  ),
].sort();

/** Only SQL in the module's orbit that touches other features' tables (boundary rule). */
export const sourceDataAdapter: SourceDataPort = {
  async getClinicFacts(today: string): Promise<ClinicFacts[]> {
    // Raw sql`` params must be text (postgres-js rejects a Date). appointment_date holds IST
    // clock time, so bound it with IST wall-clock text, not UTC instants.
    const end = `${today} 23:59:59.999`;
    const start30 = `${shiftDay(today, -29)} 00:00:00`;
    const startPrev = `${shiftDay(today, -59)} 00:00:00`;

    const rows = await database
      .select({
        clinicId: ClinicModel.id,
        createdAt: ClinicModel.createdAt,
        acquisitionSource: SOURCE,
        onboardingStatus: ClinicModel.onboardingStatus,
        accountStatus: ClinicModel.status,
        deletedAt: ClinicModel.deletedAt,
        firstValueAt: sql<
          string | null
        >`MIN(${A.appointmentDate}) FILTER (WHERE ${A.appointmentStatus} = 'Completed')`,
        lastActivityAt: sql<
          string | null
        >`MAX(${A.appointmentDate}) FILTER (WHERE ${USED} AND ${A.appointmentDate} <= ${end})`,
        appointments30: sql<number>`COUNT(${A.id}) FILTER (WHERE ${USED} AND ${A.appointmentDate} BETWEEN ${start30} AND ${end})::int`,
        appointmentsPrev30: sql<number>`COUNT(${A.id}) FILTER (WHERE ${USED} AND ${A.appointmentDate} >= ${startPrev} AND ${A.appointmentDate} < ${start30})::int`,
        activeDays30: sql<number>`COUNT(DISTINCT DATE(${A.appointmentDate})) FILTER (WHERE ${USED} AND ${A.appointmentDate} BETWEEN ${start30} AND ${end})::int`,
        // The payout account for payout_blocked: one Razorpay row per clinic, so MAX is that row.
        payoutStatus: sql<string | null>`MAX(${P.routeStatus})`,
        payoutReason: sql<
          string | null
        >`MAX(${P.routeOnboardingRejectionReason})`,
        payoutChangedAt: sql<string | null>`MAX(${P.updatedAt})`,
        payoutAccountId: sql<string | null>`MAX(${P.gatewayAccountId})`,
      })
      .from(ClinicModel)
      .leftJoin(A, eq(A.clinicId, ClinicModel.id))
      .leftJoin(
        P,
        and(eq(P.clinicId, ClinicModel.id), eq(P.paymentProvider, 'razorpay'))
      )
      .groupBy(ClinicModel.id);

    return rows.map((r) => ({
      clinicId: r.clinicId,
      createdAt: r.createdAt,
      acquisitionSource: r.acquisitionSource,
      onboardingCompleted: r.onboardingStatus === 'COMPLETED',
      accountStatus: r.accountStatus,
      deleted: r.deletedAt !== null,
      firstValueAt: asStoredDate(r.firstValueAt),
      lastActivityAt: asStoredDate(r.lastActivityAt),
      appointments30: Number(r.appointments30),
      appointmentsPrev30: Number(r.appointmentsPrev30),
      activeDays30: Number(r.activeDays30),
      payoutStatus: r.payoutStatus,
      payoutReason: r.payoutReason,
      payoutChangedAt: asStoredDate(r.payoutChangedAt),
      payoutAccountId: r.payoutAccountId,
    }));
  },

  async getSubscriptionSpans(): Promise<SubscriptionSpan[]> {
    const rows = await SubscriptionReadService.spans();
    return rows.map((r) => ({
      ...r,
      startsAt: utcToStored(r.startsAt),
      expiresAt: r.expiresAt && utcToStored(r.expiresAt),
    }));
  },

  async searchClinics(
    q: string | undefined,
    filters: { status?: AccountStatus; city?: string; state?: string },
    limit: number
  ): Promise<ClinicIdentity[]> {
    const { status, city, state } = filters;
    const scope: SQL[] = [
      MANAGED as SQL,
      status === 'Deleted'
        ? isNotNull(ClinicModel.deletedAt)
        : isNull(ClinicModel.deletedAt),
    ];
    if (status && status !== 'Deleted')
      scope.push(sql`${ClinicModel.status} = ${status}`);
    // City/state are free text, so match trimmed and case-insensitively ("indore " = "Indore").
    if (city)
      scope.push(
        sql`LOWER(TRIM(${ClinicModel.City})) = ${city.trim().toLowerCase()}`
      );
    if (state)
      scope.push(
        sql`LOWER(TRIM(${ClinicModel.State})) = ${state.trim().toLowerCase()}`
      );
    const base = () =>
      database
        .select(IDENTITY)
        .from(ClinicModel)
        .innerJoin(UserModel, eq(UserModel.id, ClinicModel.userId));

    const term = q?.trim();
    if (!term) {
      return base()
        .where(and(...scope))
        .orderBy(desc(ClinicModel.createdAt))
        .limit(limit);
    }
    // BE §7: escape LIKE wildcards, then rank exact → prefix → word prefix → contains.
    const lower = term.toLowerCase();
    const escaped = lower.replace(/[\\%_]/g, '\\$&');
    const contains = `%${escaped}%`;
    const prefix = `${escaped}%`;
    const name = sql`LOWER(${ClinicModel.clinicName})`;
    const code = sql`LOWER(${ClinicModel.clinicCode})`;
    const rank = sql`CASE
      WHEN ${code} = ${lower} OR ${name} = ${lower} THEN 0
      WHEN ${code} LIKE ${prefix} OR ${name} LIKE ${prefix} THEN 1
      WHEN ${name} LIKE ${`% ${escaped}%`} THEN 2
      WHEN ${name} LIKE ${contains} OR ${code} LIKE ${contains} THEN 3
      ELSE 4 END`;
    return base()
      .where(
        and(
          ...scope,
          or(
            ilike(ClinicModel.clinicName, contains),
            ilike(ClinicModel.clinicCode, contains),
            ilike(ClinicModel.clinicPhone, contains),
            ilike(ClinicModel.City, contains)
          )
        )
      )
      .orderBy(
        rank,
        sql`LENGTH(${ClinicModel.clinicName})`,
        ClinicModel.clinicName
      )
      .limit(limit);
  },

  async getLocationOptions() {
    const rows = await database
      .selectDistinct({
        city: sql<string | null>`INITCAP(TRIM(${ClinicModel.City}))`,
        state: sql<string | null>`INITCAP(TRIM(${ClinicModel.State}))`,
      })
      .from(ClinicModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicModel.userId))
      .where(MANAGED);
    const uniq = (values: (string | null)[]) =>
      [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
        a.localeCompare(b)
      );
    return {
      cities: uniq(rows.map((r) => r.city)),
      states: uniq(rows.map((r) => r.state)),
    };
  },

  async countByAccountStatus(): Promise<AccountStatusCounts> {
    const rows = await database
      .select({ status: ACCOUNT_STATUS, count: sql<number>`COUNT(*)::int` })
      .from(ClinicModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicModel.userId))
      .where(MANAGED)
      .groupBy(ACCOUNT_STATUS);
    const counts: AccountStatusCounts = {
      total: 0,
      active: 0,
      inactive: 0,
      blocked: 0,
      deleted: 0,
    };
    for (const r of rows) {
      const n = Number(r.count);
      if (r.status === 'Deleted') {
        counts.deleted = n;
        continue;
      }
      counts.total += n;
      if (r.status === 'Active') counts.active = n;
      else if (r.status === 'Inactive') counts.inactive = n;
      else if (r.status === 'Blocked') counts.blocked = n;
    }
    return counts;
  },

  async getMoney(from: string, to: string) {
    // Payments are timezone-aware: bound by real IST instants.
    const startAt = istMidnight(from);
    const endAt = istMidnight(shiftDay(to, 1));

    // Booking fees come from the money ledger, the same source as clinic Finance (one truth).
    // A fee line is a credit to its own account; an adjustment debits it back.
    // Raw SQL can't bind a Date; ISO text keeps the exact IST instant.
    const range = sql`m.created_at >= ${startAt.toISOString()}::timestamptz AND m.created_at < ${endAt.toISOString()}::timestamptz`;
    const net = sql`SUM(CASE WHEN m.side = 'credit' THEN m.amount_paise ELSE -m.amount_paise END)`;
    const earned = sql`m.account IN ('convenience_fee', 'platform_commission')`;

    // Subscription money and failures come from the payments table (the real money), not the activity log.
    const [subs, feeRows, topRows, failedRows] = await Promise.all([
      BillingReadService.collected(startAt, endAt),
      database.execute(sql`
        SELECT m.account, ${net}::bigint AS paise,
          COUNT(DISTINCT m.source_id) FILTER (WHERE m.side = 'credit')::int AS bookings
        FROM money_entries m
        WHERE m.account IN ('convenience_fee', 'platform_commission', 'gst_on_platform_fees', 'pg_fee')
          AND ${range}
        GROUP BY m.account`),
      database.execute(sql`
        SELECT m.clinic_id, c.clinic_name, ${net}::bigint AS paise
        FROM money_entries m JOIN clinics c ON c.id = m.clinic_id
        WHERE ${earned} AND ${range}
        GROUP BY m.clinic_id, c.clinic_name
        HAVING ${net} > 0
        ORDER BY paise DESC
        LIMIT 5`),
      BillingReadService.failed(startAt, endAt),
    ]);

    const fees = feeRows as unknown as {
      account: string;
      paise: string;
      bookings: number;
    }[];
    const rupees = (account: string) =>
      Number(fees.find((f) => f.account === account)?.paise ?? 0) / 100;
    const split = {
      convenience: rupees('convenience_fee'),
      commission: rupees('platform_commission'),
      gst: rupees('gst_on_platform_fees'),
      gatewayFee: rupees('pg_fee'),
    };

    return {
      collected: {
        subscriptions: subs.amount,
        subscriptionPayments: subs.payments,
        subscriptionRefunds: subs.refunded,
        // MediArogya's own earning: convenience fee + commission (GST and gateway fee pass through).
        bookingFees: split.convenience + split.commission,
        bookingFeePayments: Math.max(
          0,
          ...fees
            .filter((f) =>
              ['convenience_fee', 'platform_commission'].includes(f.account)
            )
            .map((f) => f.bookings)
        ),
        bookingFeeSplit: split,
        topFeeClinics: (
          topRows as unknown as {
            clinic_id: string;
            clinic_name: string;
            paise: string;
          }[]
        ).map((r) => ({
          clinicId: r.clinic_id,
          clinicName: r.clinic_name,
          fees: Number(r.paise) / 100,
        })),
      },
      failed: failedRows.map((r) => ({
        ...r,
        clinicCode: r.clinicCode ?? '—',
        clinicName: r.clinicName ?? 'Clinic',
        at: r.at,
      })),
    };
  },

  async getPayoutAccounts({
    page,
    pageSize,
    q,
    statusIn,
    statusNotIn,
    clinicId,
  }) {
    const status = sql`UPPER(a.route_status)`;
    const list = (values: string[]) =>
      sql.join(
        values.map((v) => sql`${v}`),
        sql`, `
      );
    // BE §7: escape LIKE wildcards, then rank exact → prefix → word prefix → contains.
    const term = q?.trim().toLowerCase() ?? '';
    const escaped = term.replace(/[\\%_]/g, '\\$&');
    const name = sql`LOWER(c.clinic_name)`;
    const code = sql`LOWER(COALESCE(c.clinic_code, ''))`;
    const searched = term
      ? sql`AND (${name} LIKE ${`%${escaped}%`} OR ${code} LIKE ${`%${escaped}%`})`
      : sql``;
    const rank = term
      ? sql`CASE WHEN ${name} = ${term} OR ${code} = ${term} THEN 0
          WHEN ${name} LIKE ${`${escaped}%`} OR ${code} LIKE ${`${escaped}%`} THEN 1
          WHEN ${name} LIKE ${`% ${escaped}%`} THEN 2 ELSE 3 END,`
      : sql``;
    const byStatus = statusIn?.length
      ? sql`AND ${status} IN (${list(statusIn)})`
      : statusNotIn?.length
        ? sql`AND (a.route_status IS NULL OR ${status} NOT IN (${list(statusNotIn)}))`
        : sql``;
    const account = sql`clinics c
      LEFT JOIN clinic_payment_accounts a
        ON a.clinic_id = c.id AND a.payment_provider = 'razorpay'`;
    const live = sql`WHERE c.deleted_at IS NULL ${searched} ${clinicId ? sql`AND c.id = ${clinicId}` : sql``}`;

    // One page with its total (window count), and chip counts for the same search, in parallel.
    const [pageRows, countRows] = await Promise.all([
      database.execute(sql`
        SELECT c.id AS clinic_id, c.clinic_code, c.clinic_name,
          a.route_status, a.route_onboarding_rejection_reason AS reason, a.updated_at,
          b.bank_name, b.masked_account_number, COUNT(*) OVER () AS total
        FROM ${account}
        LEFT JOIN LATERAL (
          SELECT bank_name, masked_account_number FROM clinic_bank_history
          WHERE clinic_id = c.id AND is_active = true
          ORDER BY effective_from DESC LIMIT 1
        ) b ON true
        ${live} ${byStatus}
        ORDER BY ${rank} c.clinic_name
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
      // One clinic (Clinic Overview) has no chips to count, so the second query is skipped.
      clinicId
        ? Promise.resolve([])
        : database.execute(
            sql`SELECT ${status} AS route_status, COUNT(*)::int AS count FROM ${account} ${live} GROUP BY 1`
          ),
    ]);
    const rows = pageRows as unknown as {
      clinic_id: string;
      clinic_code: string | null;
      clinic_name: string;
      route_status: string | null;
      reason: string | null;
      updated_at: Date | null;
      bank_name: string | null;
      masked_account_number: string | null;
      total: string;
    }[];
    return {
      total: Number(rows[0]?.total ?? 0),
      statusCounts: (
        countRows as unknown as { route_status: string | null; count: number }[]
      ).map((r) => ({ routeStatus: r.route_status, count: r.count })),
      rows: rows.map((r) => ({
        clinicId: r.clinic_id,
        clinicCode: r.clinic_code,
        clinicName: r.clinic_name,
        routeStatus: r.route_status,
        reason: r.reason,
        bankName: r.bank_name,
        // Masked again on read: older rows may hold a full number (Razorpay test mode); UPI is already masked.
        maskedAccount:
          r.bank_name === 'UPI' || !r.masked_account_number
            ? r.masked_account_number
            : `XXXX${r.masked_account_number.replace(/\D/g, '').slice(-4)}`,
        updatedAt: r.updated_at,
      })),
    };
  },

  async getBillingHealth(from: string, to: string) {
    const startAt = istMidnight(from);
    const endAt = istMidnight(shiftDay(to, 1));
    const [autoPay, razorpayMatch] = await Promise.all([
      BillingReadService.autoPay(startAt, endAt),
      BillingReadService.matchSummary(startAt, endAt),
    ]);
    return { autoPay, razorpayMatch };
  },

  async getClinicIdentity(clinicId: string): Promise<ClinicIdentity | null> {
    const [row] = await database
      .select(IDENTITY)
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);
    return row ?? null;
  },

  async getClinicLabels(clinicIds: string[]): Promise<ClinicLabel[]> {
    if (clinicIds.length === 0) return [];
    return database
      .select({
        clinicId: ClinicModel.id,
        clinicCode: ClinicModel.clinicCode,
        name: ClinicModel.clinicName,
      })
      .from(ClinicModel)
      .where(inArray(ClinicModel.id, clinicIds));
  },

  async getSuperAdmins(): Promise<AdminUser[]> {
    const rows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
      })
      .from(UserModel)
      .where(eq(UserModel.userType, 'Super_Admin'));
    return rows.map((r) => ({
      id: r.id,
      name: r.name || r.email || 'Super Admin',
    }));
  },

  async getMonthlyAppointments(fromYmd: string) {
    // appointment_date holds IST wall clock, so its text month is the IST month.
    const month = sql<string>`to_char(${A.appointmentDate}, 'YYYY-MM')`;
    const rows = await database
      .select({ month, count: sql<number>`COUNT(*)::int` })
      .from(A)
      .where(and(USED, gte(A.appointmentDate, sql`${fromYmd}::date`)))
      .groupBy(month);
    return rows.map((r) => ({ month: r.month, count: Number(r.count) }));
  },

  async getClinicOwner(clinicId: string): Promise<AdminUser | null> {
    const [row] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
      })
      .from(ClinicModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicModel.userId))
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);
    return row
      ? { id: row.id, name: row.name || row.email || 'Clinic owner' }
      : null;
  },

  async getSubscriptionEvents(
    clinicId: string,
    limit: number
  ): Promise<SubscriptionEvent[]> {
    const S = SubscriptionActivityModel;
    const rows = await database
      .select({
        type: S.type,
        title: S.title,
        description: S.description,
        amount: S.amount,
        at: S.createdAt,
      })
      .from(S)
      .where(eq(S.clinicId, clinicId))
      .orderBy(desc(S.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      ...r,
      amount: r.amount === null ? null : Number(r.amount),
    }));
  },

  async getStaffActivity(clinicId: string, days: number) {
    // audit_log.created_at is timezone-aware, so a real "now minus N days" is correct here.
    const since = new Date(Date.now() - days * 86_400_000);
    const [row] = await database
      .select({
        actions: sql<number>`COUNT(*) FILTER (WHERE ${AuditLogModel.createdAt} >= ${since.toISOString()})::int`,
        lastAt: sql<string | null>`MAX(${AuditLogModel.createdAt})`,
      })
      .from(AuditLogModel)
      .where(eq(AuditLogModel.clinicId, clinicId));
    return {
      actions: Number(row?.actions ?? 0),
      lastAt: row?.lastAt ? new Date(row.lastAt) : null,
    };
  },

  async getUsage(from: string, to: string): Promise<UsageFacts> {
    // appointment_date is IST clock time: bound with wall-clock text. audit_log is timezone-aware.
    const lo = `${from} 00:00:00`;
    const hi = `${shiftDay(to, 1)} 00:00:00`;
    const inRange = and(
      sql`${A.appointmentDate} >= ${lo}`,
      sql`${A.appointmentDate} < ${hi}`
    );
    const day = sql<string>`to_char(${A.appointmentDate}, 'YYYY-MM-DD')`;
    const L = AuditLogModel;

    const [byDay, byStatus, bySource, top, clinics, newPatients, staff] =
      await Promise.all([
        database
          .select({
            day,
            count: sql<number>`COUNT(*)::int`,
            app: sql<number>`COUNT(*) FILTER (WHERE ${A.bookingSource} = 'mobile_app')::int`,
          })
          .from(A)
          .where(inRange)
          .groupBy(day)
          .orderBy(day),
        database
          .select({
            key: sql<string>`${A.appointmentStatus}::text`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(A)
          .where(inRange)
          .groupBy(A.appointmentStatus),
        database
          .select({
            key: sql<string>`COALESCE(${A.bookingSource}::text, 'unknown')`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(A)
          .where(inRange)
          .groupBy(A.bookingSource),
        database
          .select({ clinicId: A.clinicId, count: sql<number>`COUNT(*)::int` })
          .from(A)
          .where(and(inRange, USED))
          .groupBy(A.clinicId)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(5),
        database
          .select({ n: sql<number>`COUNT(DISTINCT ${A.clinicId})::int` })
          .from(A)
          .where(and(inRange, USED)),
        database.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM (
          SELECT MIN(${A.appointmentDate}) AS first_at FROM ${A} WHERE ${USED} GROUP BY ${A.patientId}
        ) f WHERE f.first_at >= ${lo} AND f.first_at < ${hi}`),
        database
          .select({
            role: sql<string>`${UserModel.userType}::text`,
            actions: sql<number>`COUNT(*)::int`,
            people: sql<number>`COUNT(DISTINCT ${L.userId})::int`,
          })
          .from(L)
          .innerJoin(UserModel, eq(UserModel.id, L.userId))
          .where(
            and(
              gte(L.createdAt, istMidnight(from)),
              lt(L.createdAt, istMidnight(shiftDay(to, 1)))
            )
          )
          .groupBy(UserModel.userType)
          .orderBy(sql`COUNT(*) DESC`),
      ]);

    const num = <T extends { count: number }>(rows: T[]) =>
      rows.map((r) => ({ ...r, count: Number(r.count) }));
    return {
      appointmentsByDay: byDay.map((r) => ({
        day: r.day,
        count: Number(r.count),
        app: Number(r.app),
      })),
      byStatus: num(byStatus).sort((a, b) => b.count - a.count),
      bySource: num(bySource).sort((a, b) => b.count - a.count),
      topClinics: num(top),
      newPatients: Number(
        (newPatients as unknown as { n: number }[])[0]?.n ?? 0
      ),
      clinicsWithBookings: Number(clinics[0]?.n ?? 0),
      staffByRole: staff.map((r) => ({
        role: r.role,
        actions: Number(r.actions),
        people: Number(r.people),
      })),
    };
  },

  async listAudit(filters: AuditFilters, limit: number, offset: number) {
    const L = AuditLogModel;
    const where = and(
      gte(L.createdAt, istMidnight(filters.from)),
      lt(L.createdAt, istMidnight(shiftDay(filters.to, 1))),
      filters.clinicId ? eq(L.clinicId, filters.clinicId) : undefined,
      filters.type ? ilike(L.action, `${filters.type}.%`) : undefined,
      filters.role
        ? sql`${UserModel.userType}::text = ${filters.role}`
        : undefined
    );
    const [rows, [{ total }]] = await Promise.all([
      database
        .select({
          id: L.id,
          action: L.action,
          entityId: L.entityId,
          ip: L.ip,
          createdAt: L.createdAt,
          clinicId: L.clinicId,
          clinicCode: ClinicModel.clinicCode,
          clinicName: ClinicModel.clinicName,
          userName: UserModel.name,
          userRole: sql<string | null>`${UserModel.userType}::text`,
        })
        .from(L)
        .leftJoin(UserModel, eq(UserModel.id, L.userId))
        .leftJoin(ClinicModel, eq(ClinicModel.id, L.clinicId))
        .where(where)
        .orderBy(desc(L.createdAt))
        .limit(limit)
        .offset(offset),
      database
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(L)
        .leftJoin(UserModel, eq(UserModel.id, L.userId))
        .where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r, label: auditActionLabel(r.action) })),
      total: Number(total),
      types: AUDIT_TYPES,
    };
  },

  async listSessions(
    filters: { q?: string; platform?: string; activeOnly: boolean },
    limit: number,
    offset: number
  ) {
    const R = RefreshTokenModel;
    // Owner first, else the first clinic the staff member was assigned to.
    const clinicId = sql<string | null>`COALESCE(
      (SELECT c.id FROM ${ClinicModel} c WHERE c.user_id = ${R.userId} LIMIT 1),
      (SELECT a.clinic_id FROM ${ClinicAssignModel} a WHERE a.user_id = ${R.userId} ORDER BY a.created_at LIMIT 1)
    )`;
    const q = filters.q?.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
    const where = and(
      // Patients are not staff; their sessions are patient data and stay out.
      sql`${UserModel.userType} NOT IN ('Patient', 'Super_Admin')`,
      // The apps sign in as 'android' / 'ios'; everything not 'web' is a phone.
      filters.platform === 'web' ? eq(R.platform, 'web') : undefined,
      filters.platform === 'mobile' ? ne(R.platform, 'web') : undefined,
      // expires_at is app-written UTC; a bare now() would compare it on the IST clock.
      filters.activeOnly
        ? sql`${R.expiresAt} > (now() AT TIME ZONE 'UTC')`
        : undefined,
      q
        ? or(ilike(UserModel.name, `%${q}%`), ilike(UserModel.email, `%${q}%`))
        : undefined
    );
    const [rows, [{ total }]] = await Promise.all([
      database
        .select({
          userId: R.userId,
          userName: UserModel.name,
          role: sql<string>`${UserModel.userType}::text`,
          clinicId,
          platform: R.platform,
          userAgent: R.userAgent,
          ip: R.ipAddress,
          signedInAt: R.createdAt,
          expiresAt: R.expiresAt,
        })
        .from(R)
        .innerJoin(UserModel, eq(UserModel.id, R.userId))
        .where(where)
        .orderBy(desc(R.createdAt))
        .limit(limit)
        .offset(offset),
      database
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(R)
        .innerJoin(UserModel, eq(UserModel.id, R.userId))
        .where(where),
    ]);
    const labels = new Map(
      (
        await sourceDataAdapter.getClinicLabels([
          ...new Set(
            rows.map((r) => r.clinicId).filter((x): x is string => Boolean(x))
          ),
        ])
      ).map((l) => [l.clinicId, l])
    );
    return {
      items: rows.map(({ clinicId: id, ...r }) => ({
        ...r,
        clinicName: id ? (labels.get(id)?.name ?? null) : null,
        clinicCode: id ? (labels.get(id)?.clinicCode ?? null) : null,
      })),
      total: Number(total),
    };
  },

  async getPatientApp(from: string, to: string): Promise<PatientAppFacts> {
    // DB-default created_at columns hold IST clock time: bound with wall-clock text.
    const lo = `${from} 00:00:00`;
    const hi = `${shiftDay(to, 1)} 00:00:00`;
    const R = RefreshTokenModel;
    const D = UserDevicesModel;
    const isPatient = sql`${UserModel.userType} = 'Patient'`;
    const APP = sql`${R.platform} IN ('android', 'ios')`;
    const APP_BOOKING = sql`${A.bookingSource} = 'mobile_app'`;
    const bookingRange = and(
      sql`${A.appointmentDate} >= ${lo}`,
      sql`${A.appointmentDate} < ${hi}`
    );
    const day = sql<string>`to_char(${A.appointmentDate}, 'YYYY-MM-DD')`;
    const n = sql<number>`COUNT(DISTINCT ${UserModel.id})::int`;

    const [
      patients,
      signedIn,
      signedInTotal,
      signIns,
      push,
      pushTotal,
      newPush,
      bookings,
      byDay,
      top,
    ] = await Promise.all([
      database
        .select({
          total: sql<number>`COUNT(*)::int`,
          fresh: sql<number>`COUNT(*) FILTER (WHERE ${UserModel.createdAt} >= ${lo} AND ${UserModel.createdAt} < ${hi})::int`,
        })
        .from(UserModel)
        .where(isPatient),
      database
        .select({ platform: R.platform, n })
        .from(R)
        .innerJoin(UserModel, eq(UserModel.id, R.userId))
        // expires_at is app-written UTC; a bare now() would compare it on the IST clock.
        .where(
          and(isPatient, APP, sql`${R.expiresAt} > (now() AT TIME ZONE 'UTC')`)
        )
        .groupBy(R.platform),
      // A patient signed in on two phones counts once in the total (not android + ios).
      database
        .select({ n })
        .from(R)
        .innerJoin(UserModel, eq(UserModel.id, R.userId))
        .where(
          and(isPatient, APP, sql`${R.expiresAt} > (now() AT TIME ZONE 'UTC')`)
        ),
      database
        .select({ n })
        .from(R)
        .innerJoin(UserModel, eq(UserModel.id, R.userId))
        .where(
          and(
            isPatient,
            APP,
            sql`${R.createdAt} >= ${lo}`,
            sql`${R.createdAt} < ${hi}`
          )
        ),
      database
        .select({ platform: D.platform, n })
        .from(D)
        .innerJoin(UserModel, eq(UserModel.id, D.userId))
        .where(isPatient)
        .groupBy(D.platform),
      // Distinct patients: one person with two phones counts once in the total.
      database
        .select({ n })
        .from(D)
        .innerJoin(UserModel, eq(UserModel.id, D.userId))
        .where(isPatient),
      database
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(D)
        .innerJoin(UserModel, eq(UserModel.id, D.userId))
        .where(
          and(
            isPatient,
            sql`${D.createdAt} >= ${lo}`,
            sql`${D.createdAt} < ${hi}`
          )
        ),
      database
        .select({
          all: sql<number>`COUNT(*)::int`,
          app: sql<number>`COUNT(*) FILTER (WHERE ${APP_BOOKING})::int`,
        })
        .from(A)
        .where(bookingRange),
      database
        // All bookings per day too, so the chart shows app bookings in context.
        .select({
          day,
          count: sql<number>`COUNT(*) FILTER (WHERE ${APP_BOOKING})::int`,
          all: sql<number>`COUNT(*)::int`,
        })
        .from(A)
        .where(bookingRange)
        .groupBy(day)
        .orderBy(day),
      database
        .select({ clinicId: A.clinicId, count: sql<number>`COUNT(*)::int` })
        .from(A)
        .where(and(bookingRange, APP_BOOKING))
        .groupBy(A.clinicId)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(5),
    ]);

    const per = (rows: { platform: string; n: number }[]) => ({
      android: Number(rows.find((r) => r.platform === 'android')?.n ?? 0),
      ios: Number(rows.find((r) => r.platform === 'ios')?.n ?? 0),
    });
    return {
      totalPatients: Number(patients[0]?.total ?? 0),
      newPatientAccounts: Number(patients[0]?.fresh ?? 0),
      signedInApp: per(signedIn),
      signedInPatients: Number(signedInTotal[0]?.n ?? 0),
      appSignIns: Number(signIns[0]?.n ?? 0),
      pushEnabled: per(push),
      pushPatients: Number(pushTotal[0]?.n ?? 0),
      newPushDevices: Number(newPush[0]?.n ?? 0),
      appBookings: Number(bookings[0]?.app ?? 0),
      allBookings: Number(bookings[0]?.all ?? 0),
      appBookingsByDay: byDay.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
      allBookingsByDay: byDay.map((r) => ({
        day: r.day,
        count: Number(r.all),
      })),
      topAppClinics: top.map((r) => ({
        clinicId: r.clinicId,
        count: Number(r.count),
      })),
    };
  },

  async signOutEverywhere(userId: string) {
    const [user] = await database
      .select({
        name: UserModel.name,
        email: UserModel.email,
        role: sql<string>`${UserModel.userType}::text`,
      })
      .from(UserModel)
      .where(
        and(
          eq(UserModel.id, userId),
          sql`${UserModel.userType} NOT IN ('Patient', 'Super_Admin')`
        )
      )
      .limit(1);
    if (!user) return null;

    // No refresh token left means no new access tokens can be issued.
    await database
      .delete(RefreshTokenModel)
      .where(eq(RefreshTokenModel.userId, userId));
    // Same cut-off the password-change flow uses: requireAuth and socketAuth reject any token
    // issued before it. +1s so a token minted this same second is cut off too; 30 days = max token life.
    await redisClient.setex(
      `user:password_changed_at:${userId}`,
      86400 * 30,
      String(Math.floor(Date.now() / 1000) + 1)
    );
    await redisClient.del(`user:${userId}`);
    return { name: user.name || user.email || 'Staff member', role: user.role };
  },
};
