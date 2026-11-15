import { sql, type AnyColumn } from 'drizzle-orm';
import { VisitExaminationModel } from '../models/visitExamination.model';
import type { DbOrTx } from '../types/examination.types';
import { EXAM_KEYS } from '../utils/examKeys.utils';

// Who reads private exam notes (`private.` keys and never-print cells); everyone else gets them stripped.
const PRIVATE_NOTE_ROLES = ['Doctor', 'Admin'];

export class ExaminationService {
  /** Saves a visit's findings (replaces them), inside the prescription save's transaction. */
  static async saveFindings(
    tx: DbOrTx,
    visit: {
      appointmentId: string;
      patientId: string;
      clinicId: string;
      findings: Record<string, string>;
    }
  ) {
    await tx
      .insert(VisitExaminationModel)
      .values(visit)
      .onConflictDoUpdate({
        target: VisitExaminationModel.appointmentId,
        set: { findings: visit.findings, updatedAt: sql`NOW()` },
      });
  }

  /**
   * A visit's findings as a column for the caller's own query: this table first, else the older copy
   * in report_cards.additional_information. No extra round trip.
   */
  static findingsColumn(appointmentId: AnyColumn, legacyFindings: AnyColumn) {
    const f = VisitExaminationModel;
    // Latest row only: a database without the primary key on appointment_id can hold two, which broke the whole visit read.
    return sql<Record<
      string,
      string
    > | null>`COALESCE((SELECT ${f.findings} FROM ${f} WHERE ${f.appointmentId} = ${appointmentId} ORDER BY ${f.updatedAt} DESC LIMIT 1), ${legacyFindings})`;
  }

  /**
   * A visit's exam notes as this role may see them; every read that returns notes goes through here.
   * Doctor / Admin get them whole, anyone else without the private ones.
   */
  static notesFor(
    notes: unknown,
    userType?: string
  ): Record<string, unknown> | null {
    if (!notes || typeof notes !== 'object') return null;
    const all = notes as Record<string, unknown>;
    if (userType && PRIVATE_NOTE_ROLES.includes(userType)) return all;
    return Object.fromEntries(
      Object.entries(all).filter(
        ([key]) =>
          !key.startsWith('private.') && !EXAM_KEYS.get(key)?.cell.noPrint
      )
    );
  }

  /** Vaccine names ticked in the visit's "Vaccines given today" fields. */
  static vaccinePicks(notes: unknown): string[] {
    if (!notes || typeof notes !== 'object') return [];
    const picks = Object.entries(notes as Record<string, unknown>).flatMap(
      ([key, value]) =>
        EXAM_KEYS.get(key)?.cell.recordsVaccines && typeof value === 'string'
          ? value.split(', ')
          : []
    );
    return [...new Set(picks.filter(Boolean))];
  }

  /** True when the save carries a "Vaccines given today" field, even an emptied one (""). */
  static hasVaccineField(notes: unknown): boolean {
    return Boolean(
      notes &&
      typeof notes === 'object' &&
      Object.keys(notes).some((key) => EXAM_KEYS.get(key)?.cell.recordsVaccines)
    );
  }
}
