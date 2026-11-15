import {
  and,
  count,
  desc,
  eq,
  inArray,
  sql,
  type AnyColumn,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { ALL_VACCINES } from '../../../utils/specialties/vaccines';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { getISTDateString } from '../../../utils/istDateTime';
import { dueVaccines, type DueVaccine } from '../utils/vaccineSchedule.utils';
import { PatientVaccineModel } from '../models/patientVaccine.model';
import type { DbOrTx } from '../types/patientVaccine.types';

// A full childhood schedule is about 40 doses; this only guards against runaway data.
const MAX_DOSES = 200;

export class PatientVaccineService {
  /** The patient's doses in this clinic, newest first, the names a new dose may use, and what's due next. */
  static async list(patientId: string, clinicId: string) {
    const [vaccines, [profile]] = await Promise.all([
      database
        .select({
          id: PatientVaccineModel.id,
          vaccine: PatientVaccineModel.vaccine,
          doseNo: PatientVaccineModel.doseNo,
          givenOn: PatientVaccineModel.givenOn,
          batch: PatientVaccineModel.batch,
          appointmentId: PatientVaccineModel.appointmentId,
          givenBy: UserModel.name,
        })
        .from(PatientVaccineModel)
        .leftJoin(UserModel, eq(UserModel.id, PatientVaccineModel.givenBy))
        .where(
          and(
            eq(PatientVaccineModel.patientId, patientId),
            eq(PatientVaccineModel.clinicId, clinicId)
          )
        )
        .orderBy(
          desc(PatientVaccineModel.givenOn),
          desc(PatientVaccineModel.createdAt)
        )
        .limit(MAX_DOSES),
      database
        .select({ dob: UserProfileModel.dob })
        .from(UserProfileModel)
        .where(eq(UserProfileModel.userId, patientId))
        .limit(1),
    ]);
    const given: Record<string, number> = {};
    for (const v of vaccines) given[v.vaccine] = (given[v.vaccine] ?? 0) + 1;
    // null = adult or no date of birth; the screen says which.
    const due = dueVaccines(profile?.dob, given, getISTDateString());
    return {
      vaccines,
      vaccineNames: ALL_VACCINES,
      due,
      hasDob: Boolean(profile?.dob),
    };
  }

  /** A past dose typed in from the patient page, e.g. off the parent's vaccine card. */
  static async add(
    input: {
      patientId: string;
      vaccine: string;
      givenOn: string;
      batch?: string;
    },
    clinicId: string,
    userId: string
  ) {
    // Loaded here, not at the top: UserService pulls in MFA, which every importer of this service (the
    // prescription save) would otherwise load too.
    const { UserService } = await import('../../users/services/user.service');
    if (!(await UserService.isPatientInClinic(input.patientId, clinicId))) {
      throw new HttpError(404, 'Patient not found in this clinic');
    }
    const [{ doses }] = await database
      .select({ doses: count() })
      .from(PatientVaccineModel)
      .where(
        and(
          eq(PatientVaccineModel.patientId, input.patientId),
          eq(PatientVaccineModel.clinicId, clinicId),
          eq(PatientVaccineModel.vaccine, input.vaccine)
        )
      );
    const [row] = await database
      .insert(PatientVaccineModel)
      .values({
        patientId: input.patientId,
        clinicId,
        vaccine: input.vaccine,
        doseNo: doses + 1,
        givenOn: input.givenOn,
        batch: input.batch || null,
        givenBy: userId,
      })
      .returning();
    return row;
  }

  /** Removes a wrong entry; only rows of this clinic. */
  static async remove(id: string, clinicId: string) {
    const [row] = await database
      .delete(PatientVaccineModel)
      .where(
        and(
          eq(PatientVaccineModel.id, id),
          eq(PatientVaccineModel.clinicId, clinicId)
        )
      )
      .returning({ id: PatientVaccineModel.id });
    if (!row) throw new HttpError(404, 'Vaccine entry not found');
    return row;
  }

  /**
   * "Last vaccine" and dose counts per vaccine for the patient bar, as sub-selects, so the caller's
   * existing query carries them with no extra round trip. Columns: the patient's id and the clinic's id.
   */
  static patientBarColumns(patientId: AnyColumn, clinicId: AnyColumn) {
    const v = PatientVaccineModel;
    return {
      lastVaccine: sql<
        string | null
      >`(SELECT ${v.vaccine} || '-' || ${v.doseNo} || ', ' || to_char(${v.givenOn}, 'DD Mon') FROM ${v} WHERE ${v.patientId} = ${patientId} AND ${v.clinicId} = ${clinicId} ORDER BY ${v.givenOn} DESC, ${v.createdAt} DESC LIMIT 1)`,
      vaccineCounts: sql<Record<
        string,
        number
      > | null>`(SELECT json_object_agg(c.vaccine, c.n) FROM (SELECT ${v.vaccine} AS vaccine, count(*)::int AS n FROM ${v} WHERE ${v.patientId} = ${patientId} AND ${v.clinicId} = ${clinicId} GROUP BY ${v.vaccine}) c)`,
    };
  }

  /** The first schedule dose due for a child, from the counts above; null for adults or no date of birth. */
  static nextDue(
    dob: string | null | undefined,
    counts: Record<string, number> | null
  ): DueVaccine | null {
    const [next] = dueVaccines(dob, counts ?? {}, getISTDateString()) ?? [];
    return next ?? null;
  }

  /**
   * Makes the visit's doses match its ticked vaccines, inside the prescription save.
   * Re-saving replaces this visit's rows, so each dose number counts the other visits only.
   */
  static async syncVisitDoses(
    tx: DbOrTx,
    visit: {
      patientId: string;
      clinicId: string;
      appointmentId: string;
      givenBy: string;
      givenOn: string;
      picks: string[];
    }
  ) {
    await tx
      .delete(PatientVaccineModel)
      .where(
        and(
          eq(PatientVaccineModel.appointmentId, visit.appointmentId),
          eq(PatientVaccineModel.clinicId, visit.clinicId)
        )
      );
    const { picks } = visit;
    if (!picks.length) return;
    const earlier = await tx
      .select({ vaccine: PatientVaccineModel.vaccine, doses: count() })
      .from(PatientVaccineModel)
      .where(
        and(
          eq(PatientVaccineModel.patientId, visit.patientId),
          eq(PatientVaccineModel.clinicId, visit.clinicId),
          inArray(PatientVaccineModel.vaccine, picks)
        )
      )
      .groupBy(PatientVaccineModel.vaccine);
    const given = new Map(earlier.map((r) => [r.vaccine, r.doses]));
    await tx.insert(PatientVaccineModel).values(
      picks.map((vaccine) => ({
        patientId: visit.patientId,
        clinicId: visit.clinicId,
        vaccine,
        doseNo: (given.get(vaccine) ?? 0) + 1,
        givenOn: visit.givenOn,
        givenBy: visit.givenBy,
        appointmentId: visit.appointmentId,
      }))
    );
  }
}
