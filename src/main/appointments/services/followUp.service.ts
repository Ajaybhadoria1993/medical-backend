import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import type { AuthUser } from '../../../middlewear/auth.middleware';
import { isDoctorAssignedToClinic } from '../../../utils/clinicOwnership';
import { getISTDateString } from '../../../utils/istDateTime';
import logger from '../../../utils/logger';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { ReportCardModel } from '../../reports/models/reports.model';
import {
  dismissPlanFollowUp,
  isPlanVisible,
  logPlanCall,
  planCalls,
  planFollowUps,
} from '../../treatmentPlan';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { AppointmentModel } from '../models/appointment.model';
import { AppointmentActivityHistoryModel as Activity } from '../models/appointmentActivityHistory.model';
import type {
  DismissFollowUpDto,
  FollowUpCheckDateQueryDto,
  FollowUpRefDto,
  GetFollowUpsQueryDto,
  LogFollowUpCallDto,
} from '../schemas/followUp.schemas';
import type {
  FollowUpCall,
  FollowUpDateCheck,
  FollowUpItem,
  FollowUpList,
  People,
  RawCall,
} from '../types/followUp.types';
import {
  dueOf,
  isPlanRow,
  push,
  toRawCall,
  withName,
} from '../utils/followUp.utils';
import { FollowUpDayService } from './followUpDay.service';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 120;
// ponytail: plan rows come only through the treatmentPlan barrel, so the two capped sources merge and page in Node.
const SOURCE_CAP = 500;
const SEARCH_CAP = 200;
const CALL_HISTORY_CAP = 200;

type RawFollowUp = Omit<
  FollowUpItem,
  'due' | 'patient' | 'doctor' | 'lastCall' | 'callCount' | 'doctorDay'
> & { patientId: string; doctorId: string };

export class FollowUpService {
  /** Doctor-set follow-up dates and plan follow-ups for one clinic, oldest due first. */
  static async list(
    clinicId: string,
    user: AuthUser,
    query: GetFollowUpsQueryDto
  ): Promise<FollowUpList> {
    const today = getISTDateString();
    const from =
      query.from ?? getISTDateString(new Date(Date.now() - 30 * DAY_MS));
    const to = query.to ?? getISTDateString(new Date(Date.now() + 30 * DAY_MS));
    const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
    if (span < 0)
      throw new HttpError(
        422,
        'The end date must be on or after the start date'
      );
    if (span > MAX_RANGE_DAYS)
      throw new HttpError(
        422,
        `Pick a range of ${MAX_RANGE_DAYS} days or less`
      );

    const [doctorIds, patientIds] = await Promise.all([
      this.scopeDoctorIds(clinicId, user),
      query.q ? this.searchPatientIds(query.q) : Promise.resolve(null),
    ]);
    const wantDoctor = !query.type || query.type === 'doctor_followup';
    const wantPlan = query.type !== 'doctor_followup';
    const [doctorRows, planRows] = await Promise.all([
      wantDoctor && patientIds?.length !== 0
        ? this.doctorFollowUps(clinicId, doctorIds, from, to, patientIds)
        : [],
      wantPlan && patientIds?.length !== 0
        ? planFollowUps(
            clinicId,
            this.actor(user),
            from,
            to,
            SOURCE_CAP,
            patientIds
          )
        : [],
    ]);

    const planRaw: RawFollowUp[] = planRows
      .filter((p) => !query.type || p.kind === query.type)
      .map((p) => ({
        id: `${p.kind}:${p.stepId ?? p.planId}`,
        kind: p.kind,
        refId: p.stepId ?? p.planId,
        dueDate: p.dueDate,
        patientId: p.patientId,
        doctorId: p.doctorId,
        sourceAppointmentId: null,
        plan: {
          id: p.planId,
          title: p.planTitle,
          stepId: p.stepId,
          stepName: p.stepName,
          stepSeq: p.stepSeq,
          stepStatus: p.stepStatus,
          stepCount: p.stepCount,
          status: p.planStatus,
        },
      }));
    const raw = [...doctorRows, ...planRaw];

    const [doctorCalls, planCallRows] = await Promise.all([
      this.doctorCalls(doctorRows.map((r) => r.refId)),
      planCalls(clinicId, this.actor(user), [
        ...new Set(planRaw.map((r) => r.plan!.id)),
      ]),
    ]);
    const callsByKey = new Map<string, RawCall[]>();
    for (const c of doctorCalls)
      push(callsByKey, `doctor_followup:${c.refId}`, c);
    for (const c of planCallRows)
      push(callsByKey, `plan:${c.planId}`, toRawCall(c));
    const callsOf = (r: RawFollowUp) =>
      callsByKey.get(
        r.plan ? `plan:${r.plan.id}` : `doctor_followup:${r.refId}`
      ) ?? [];

    const people = await this.people([
      ...new Set([
        ...raw.flatMap((r) => [r.patientId, r.doctorId]),
        ...raw
          .map((r) => callsOf(r)[0]?.actorId)
          .filter((id): id is string => !!id),
      ]),
    ]);
    const all: FollowUpItem[] = raw
      .map((r) => {
        const { patientId, doctorId, ...rest } = r;
        const calls = callsOf(r);
        return {
          ...rest,
          due: dueOf(r.dueDate, today),
          patient: {
            id: patientId,
            name: people.get(patientId)?.name ?? null,
            mobile: people.get(patientId)?.mobile ?? null,
            alternateMobile: people.get(patientId)?.alternateMobile ?? null,
            email: people.get(patientId)?.email ?? null,
            age: people.get(patientId)?.age ?? null,
            gender: people.get(patientId)?.gender ?? null,
            lastVisit: null as string | null,
          },
          doctor: { id: doctorId, name: people.get(doctorId)?.name ?? null },
          lastCall: calls[0] ? withName(calls[0], people) : null,
          callCount: calls.length,
          doctorDay: null as FollowUpItem['doctorDay'],
        };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const summary = { overdue: 0, today: 0, upcoming: 0 };
    for (const r of all) summary[r.due] += 1;
    const items = query.due ? all.filter((r) => r.due === query.due) : all;
    const start = (query.pageNumber - 1) * query.pageSize;
    const page = items.slice(start, start + query.pageSize);
    // Looked up for the page only, so a wide range doesn't scan every listed patient's visits.
    const lastVisits = await this.lastVisits(clinicId, [
      ...new Set(page.map((r) => r.patient.id)),
    ]);
    for (const r of page)
      r.patient.lastVisit = lastVisits.get(r.patient.id) ?? null;
    await this.tagDoctorDays(clinicId, page, today);
    return {
      items: page,
      summary,
      range: { from, to },
      pagination: {
        pageNumber: query.pageNumber,
        pageSize: query.pageSize,
        total: items.length,
      },
    };
  }

  /** Whether a picked follow-up day works for the doctor, and a better day when it doesn't. */
  static async checkDate(
    clinicId: string,
    user: AuthUser,
    query: FollowUpCheckDateQueryDto
  ): Promise<FollowUpDateCheck> {
    await this.assertDoctorVisible(clinicId, user, query.doctorId);
    return FollowUpDayService.check(
      clinicId,
      query.doctorId,
      query.date,
      query.patientId
    );
  }

  /** Every logged call on one follow-up row, newest first. */
  static async calls(
    clinicId: string,
    user: AuthUser,
    ref: FollowUpRefDto
  ): Promise<FollowUpCall[]> {
    await this.assertVisible(clinicId, user, ref);
    const raw = isPlanRow(ref)
      ? (await planCalls(clinicId, this.actor(user), [ref.planId])).map(
          toRawCall
        )
      : await this.doctorCalls([ref.refId]);
    const people = await this.people(
      raw.map((c) => c.actorId).filter((id): id is string => !!id)
    );
    return raw.map((c) => withName(c, people));
  }

  /** Plan rows log on the plan's history (so the plan page shows it); doctor follow-ups on the source visit's activity. */
  static async logCall(
    clinicId: string,
    user: AuthUser,
    body: LogFollowUpCallDto
  ): Promise<void> {
    if (body.nextCallDate && body.nextCallDate < getISTDateString())
      throw new HttpError(422, 'Pick today or a later day to call again');
    if (isPlanRow(body)) {
      await logPlanCall(clinicId, this.actor(user), body.planId, {
        outcome: body.outcome,
        notes: body.notes,
        nextFollowUpDate: body.nextCallDate,
      });
      return;
    }
    // Inserted directly, not via logActivity, which swallows failures the desk must see.
    const appointmentId = await this.assertVisible(clinicId, user, body);
    await database.insert(Activity).values({
      appointmentId,
      action: 'FOLLOW_UP_CALL',
      performedBy: user.id,
      newState: {
        reportCardId: body.refId,
        outcome: body.outcome,
        nextCallDate: body.nextCallDate ?? null,
      },
      remarks: body.notes ?? null,
    });
  }

  /** Hides one follow-up row for good; the plan or prescription itself is untouched. */
  static async dismiss(
    clinicId: string,
    user: AuthUser,
    body: DismissFollowUpDto
  ): Promise<void> {
    if (isPlanRow(body)) {
      await dismissPlanFollowUp(
        clinicId,
        this.actor(user),
        body.planId,
        body.kind,
        body.refId,
        body.reason
      );
      return;
    }
    const appointmentId = await this.assertVisible(clinicId, user, body);
    await database.insert(Activity).values({
      appointmentId,
      action: 'FOLLOW_UP_DISMISSED',
      performedBy: user.id,
      newState: { reportCardId: body.refId },
      remarks: body.reason,
    });
  }

  private static actor(user: AuthUser) {
    return {
      id: user.id,
      isDoctor: user.userType === 'Doctor',
      userType: user.userType,
    };
  }

  // Staff scope leaves Doctor unrestricted, so a doctor is pinned to their own patients here.
  private static scopeDoctorIds(clinicId: string, user: AuthUser) {
    return user.userType === 'Doctor'
      ? Promise.resolve([user.id])
      : StaffScopeService.getAccessibleDoctorIds(user, clinicId);
  }

  private static async assertDoctorVisible(
    clinicId: string,
    user: AuthUser,
    doctorId: string
  ): Promise<void> {
    // Admin scope is null (whole clinic), so the doctor must also be assigned to this clinic.
    const doctorIds = await this.scopeDoctorIds(clinicId, user);
    if (
      (doctorIds && !doctorIds.includes(doctorId)) ||
      !(await isDoctorAssignedToClinic(doctorId, clinicId))
    )
      throw new HttpError(404, 'Doctor not found');
  }

  // Visit rows only: a call-back is a phone call, and an overdue row books from today on.
  // Optional on the list, so a failure is logged and the rows go out untagged.
  private static async tagDoctorDays(
    clinicId: string,
    page: FollowUpItem[],
    today: string
  ): Promise<void> {
    try {
      const byDay = new Map<string, FollowUpItem[]>();
      for (const r of page)
        if (r.kind !== 'plan_callback' && r.dueDate >= today)
          push(byDay, `${r.doctor.id}|${r.dueDate}`, r);
      for (const rows of byDay.values()) {
        const { doctor, dueDate } = rows[0];
        const [day] = await FollowUpDayService.days(
          clinicId,
          doctor.id,
          dueDate,
          dueDate
        );
        const tag =
          day.status === 'leave' || day.status === 'off' ? day.status : null;
        for (const r of rows) r.doctorDay = tag;
      }
    } catch (err) {
      logger.error('[FollowUps] Doctor day tags failed', err);
    }
  }

  /** 404 for a row outside the clinic or the caller's doctors; returns a doctor follow-up's source visit. */
  private static async assertVisible(
    clinicId: string,
    user: AuthUser,
    ref: FollowUpRefDto
  ): Promise<string> {
    if (isPlanRow(ref)) {
      if (!(await isPlanVisible(clinicId, this.actor(user), ref.planId)))
        throw new HttpError(404, 'Follow-up not found');
      return ref.planId;
    }
    const doctorIds = await this.scopeDoctorIds(clinicId, user);
    const filters: SQL[] = [
      eq(ReportCardModel.id, ref.refId),
      eq(AppointmentModel.clinicId, clinicId),
    ];
    if (doctorIds)
      filters.push(
        doctorIds.length
          ? inArray(AppointmentModel.doctorId, doctorIds)
          : sql`false`
      );
    const [row] = await database
      .select({ appointmentId: AppointmentModel.id })
      .from(ReportCardModel)
      .innerJoin(
        AppointmentModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...filters))
      .limit(1);
    if (!row) throw new HttpError(404, 'Follow-up not found');
    return row.appointmentId;
  }

  /** Drops off once dismissed, or once the patient has a later visit with that doctor that wasn't missed or cancelled. */
  private static async doctorFollowUps(
    clinicId: string,
    doctorIds: string[] | null,
    from: string,
    to: string,
    patientIds: string[] | null
  ): Promise<RawFollowUp[]> {
    if (doctorIds?.length === 0) return [];
    const idList = (ids: string[]) =>
      sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `
      );
    // Candidates come from two index-backed sets: the prescribed date in range, or a "call again on" date in range.
    // The latest call-again date then wins over the prescribed one, computed once per row in the lateral join.
    const rows = (await database.execute(sql`
      with cand as (
        select rc.id from report_cards rc
        where rc.follow_up_date >= ${from}::date and rc.follow_up_date < ${to}::date + 1
        union
        select (h.new_state->>'reportCardId')::uuid from appointment_activity_history h
        where h.action = 'FOLLOW_UP_CALL'
          and (h.new_state->>'nextCallDate')::date between ${from}::date and ${to}::date
      ),
      dated as (
        select rc.id as report_card_id, a.id as appointment_id, a.patient_id, a.doctor_id,
          coalesce(lc.next_call, rc.follow_up_date::date) as due
        from cand
        join report_cards rc on rc.id = cand.id
        join appointments a on a.id = rc.appointment_id
        left join lateral (
          select (h.new_state->>'nextCallDate')::date as next_call from appointment_activity_history h
          where h.action = 'FOLLOW_UP_CALL' and h.appointment_id = a.id
            and h.new_state->>'reportCardId' = rc.id::text
          order by h.created_at desc limit 1
        ) lc on true
        where a.clinic_id = ${clinicId} and rc.follow_up_date is not null
          ${doctorIds ? sql`and a.doctor_id in (${idList(doctorIds)})` : sql``}
          ${patientIds ? sql`and a.patient_id in (${idList(patientIds)})` : sql``}
          and not exists (select 1 from appointment_activity_history d
            where d.action = 'FOLLOW_UP_DISMISSED' and d.appointment_id = a.id
              and d.new_state->>'reportCardId' = rc.id::text)
          and not exists (select 1 from appointments n
            where n.clinic_id = a.clinic_id and n.patient_id = a.patient_id and n.doctor_id = a.doctor_id
              and n.appointment_date::date > a.appointment_date::date
              and n.appointment_status not in ('Cancelled', 'NoShow', 'Missed'))
      )
      select report_card_id, appointment_id, patient_id, doctor_id, due::text as due_date
      from dated
      where due between ${from}::date and ${to}::date
      order by due
      limit ${SOURCE_CAP}
    `)) as unknown as {
      report_card_id: string;
      appointment_id: string;
      patient_id: string | null;
      doctor_id: string | null;
      due_date: string;
    }[];
    return rows
      .map((r) => ({
        reportCardId: r.report_card_id,
        appointmentId: r.appointment_id,
        patientId: r.patient_id,
        doctorId: r.doctor_id,
        dueDate: r.due_date,
      }))
      .filter(
        (r): r is typeof r & { patientId: string; doctorId: string } =>
          !!r.patientId && !!r.doctorId
      )
      .map((r) => ({
        id: `doctor_followup:${r.reportCardId}`,
        kind: 'doctor_followup' as const,
        refId: r.reportCardId,
        dueDate: r.dueDate,
        patientId: r.patientId,
        doctorId: r.doctorId,
        sourceAppointmentId: r.appointmentId,
        plan: null,
      }));
  }

  private static async doctorCalls(reportCardIds: string[]) {
    if (!reportCardIds.length) return [];
    const reportCardId = sql<string>`${Activity.newState}->>'reportCardId'`;
    return database
      .select({
        refId: reportCardId,
        outcome: sql<string | null>`${Activity.newState}->>'outcome'`,
        notes: Activity.remarks,
        nextCallDate: sql<string | null>`${Activity.newState}->>'nextCallDate'`,
        actorId: Activity.performedBy,
        at: Activity.createdAt,
      })
      .from(Activity)
      .where(
        and(
          eq(Activity.action, 'FOLLOW_UP_CALL'),
          inArray(reportCardId, reportCardIds)
        )
      )
      .orderBy(desc(Activity.createdAt))
      .limit(CALL_HISTORY_CAP);
  }

  /** Users whose name or mobile contains the text; the follow-up queries stay clinic-scoped on their own. */
  private static async searchPatientIds(q: string): Promise<string[]> {
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await database
      .select({ id: UserModel.id })
      .from(UserModel)
      .where(
        or(ilike(UserModel.name, pattern), ilike(UserModel.mobile, pattern))
      )
      .limit(SEARCH_CAP);
    return rows.map((r) => r.id);
  }

  private static async people(ids: string[]): Promise<People> {
    if (!ids.length) return new Map();
    const rows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        mobile: UserModel.mobile,
        email: UserModel.email,
        alternateMobile: UserProfileModel.alternateMobile,
        age: UserProfileModel.age,
        gender: UserProfileModel.gender,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(inArray(UserModel.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Each patient's latest completed visit day at this clinic. */
  private static async lastVisits(
    clinicId: string,
    patientIds: string[]
  ): Promise<Map<string, string>> {
    if (!patientIds.length) return new Map();
    const rows = await database
      .select({
        patientId: AppointmentModel.patientId,
        day: sql<string>`max(${AppointmentModel.appointmentDate})::date::text`,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          inArray(AppointmentModel.patientId, patientIds),
          eq(AppointmentModel.appointmentStatus, 'Completed')
        )
      )
      .groupBy(AppointmentModel.patientId);
    return new Map(rows.map((r) => [r.patientId, r.day]));
  }
}
