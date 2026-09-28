import { and, eq, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { getISTDateString } from '../../../utils/istDateTime';
import { getRedisKey } from '../utils/helpers';

/**
 * Where a consultation-length estimate came from. Published in the patient
 * payload so a surprising wait time can be explained rather than guessed at.
 */
export type ConsultationBasis =
  'learned' | 'doctor' | 'clinic' | 'slot' | 'default';

/**
 * A `Confirmed → Completed` gap only counts if Completed was marked promptly.
 * Staff close batches at day's end (multi-hour "consultations") and doctors
 * sometimes re-confirm within seconds — both are data errors that would make
 * the learned figure worse than the slot size it replaces.
 */
const MIN_VALID_SAMPLE_MINUTES = 2;
const MAX_VALID_SAMPLE_MINUTES = 180;

/** Below this many samples the learned value is not trusted at all. */
const MIN_SAMPLES = 10;

/**
 * How fast today overtakes the 30-day baseline:
 * `weight = nToday / (nToday + K)`. At K=8 today reaches half the weight after
 * 8 consultations and 75% after 24, so mornings stay stable while afternoons
 * track the pace this session is actually running at.
 */
const TODAY_WEIGHT_K = 8;

/** Sanity bounds on the final answer, whatever the maths produced. */
const MIN_RESULT_MINUTES = 5;
const MAX_RESULT_MINUTES = 90;

const BASELINE_WINDOW_DAYS = 30;

/**
 * Short TTL on purpose: the value tracks the current session's pace, so hours
 * of caching would defeat the blend, while recomputing per recalculation would
 * run an aggregate query every minute per doctor.
 */
const CACHE_TTL_SECONDS = 10 * 60;

export interface ResolvedConsultationDuration {
  /** Null when nothing better than the slot size is available. */
  minutes: number | null;
  basis: ConsultationBasis;
  /** Completed consultations the learned figure was derived from. */
  sampleSize: number;
}

interface DurationSamples {
  baselineMinutes: number | null;
  baselineCount: number;
  todayMinutes: number | null;
  todayCount: number;
}

/**
 * ConsultationDurationService
 *
 * Answers "how long does this doctor actually take?" from history, rather than
 * from how long their appointments were *scheduled* to take.
 *
 * The engine previously projected wait times using the appointment's slot
 * length, which is a booking-grid artefact: a clinic that books everyone into
 * 30-minute slots but averages 12 minutes per patient produced estimates that
 * were wrong all day, in the same direction, for every patient.
 *
 * The real consultation length is already recorded — the gap between the
 * `CONFIRMED` and `COMPLETED` rows in `appointment_activity_history`. So this
 * derives from data that exists rather than adding a table to collect it.
 */
export class ConsultationDurationService {
  /**
   * Resolves the consultation length to use for a doctor, with the basis that
   * produced it.
   *
   * Resolution order, strictly most-specific first:
   *   learned for this doctor (with enough samples)
   *   → configured for this doctor at this clinic
   *   → configured clinic-wide
   *   → null, letting the caller fall back to the availability slot size.
   *
   * The appointment's own explicit duration outranks all of it and is applied
   * by `resolveAppointmentDuration`.
   */
  static async resolveForDoctor(
    clinicId: string,
    doctorId: string
  ): Promise<ResolvedConsultationDuration> {
    const date = getISTDateString();
    const cacheKey = getRedisKey('consult_duration', doctorId, date);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as ResolvedConsultationDuration;
        if (typeof parsed?.basis === 'string') return parsed;
      }
    } catch {
      // Cache miss or unreadable — compute below.
    }

    const resolved = await this.compute(clinicId, doctorId);

    try {
      await redisClient.set(
        cacheKey,
        JSON.stringify(resolved),
        'EX',
        CACHE_TTL_SECONDS
      );
    } catch {
      // Best-effort: costs one extra aggregate query next time.
    }

    return resolved;
  }

  /**
   * Drops the cached answer after the configured length changes; without this
   * the engine keeps quoting the old figure for up to the TTL above.
   */
  static async invalidate(
    doctorId: string,
    date: string = getISTDateString()
  ): Promise<void> {
    try {
      await redisClient.del(getRedisKey('consult_duration', doctorId, date));
    } catch (error) {
      logger.warn(
        `[ConsultationDuration] Failed to clear cache for doctor=${doctorId}`,
        { error }
      );
    }
  }

  private static async compute(
    clinicId: string,
    doctorId: string
  ): Promise<ResolvedConsultationDuration> {
    let samples: DurationSamples = {
      baselineMinutes: null,
      baselineCount: 0,
      todayMinutes: null,
      todayCount: 0,
    };

    try {
      samples = await this.fetchSamples(doctorId);
    } catch (error) {
      logger.warn(
        `[ConsultationDuration] Sample query failed for doctor=${doctorId}`,
        { error }
      );
    }

    const totalSamples = samples.baselineCount;

    if (samples.baselineMinutes !== null && totalSamples >= MIN_SAMPLES) {
      // Blend today into the baseline, weighted by how much of today we have
      // actually seen. With no consultations yet today this is the pure
      // baseline; it converges on today's pace as the day proves it.
      const weight =
        samples.todayMinutes !== null && samples.todayCount > 0
          ? samples.todayCount / (samples.todayCount + TODAY_WEIGHT_K)
          : 0;

      const blended =
        samples.baselineMinutes * (1 - weight) +
        (samples.todayMinutes ?? samples.baselineMinutes) * weight;

      return {
        minutes: this.clamp(Math.round(blended)),
        basis: 'learned',
        sampleSize: totalSamples,
      };
    }

    // Configured values, most specific first. A number set for this doctor
    // always beats one set for the whole clinic — the point of asking the
    // question per doctor is that the answer differs per doctor.
    const doctorConfigured = await this.readDoctorDefault(clinicId, doctorId);
    if (doctorConfigured !== null) {
      return {
        minutes: this.clamp(doctorConfigured),
        basis: 'doctor',
        sampleSize: totalSamples,
      };
    }

    const clinicConfigured = await this.readClinicDefault(clinicId);
    if (clinicConfigured !== null) {
      return {
        minutes: this.clamp(clinicConfigured),
        basis: 'clinic',
        sampleSize: totalSamples,
      };
    }

    // Nothing learned and nothing configured — the caller falls back to the
    // availability slot size, which is what the engine used before this existed.
    return { minutes: null, basis: 'slot', sampleSize: totalSamples };
  }

  /**
   * Medians (not means) of real consultation lengths for this doctor, for the
   * baseline window and for today.
   *
   * Median because a single 90-minute consultation must not drag every other
   * patient's estimate with it — the mean is exactly the wrong statistic for a
   * distribution with a long right tail, which this always is.
   *
   * `MIN(CONFIRMED)` and `MAX(COMPLETED)` because an appointment can be
   * re-confirmed or re-completed; the outermost pair is the real span.
   */
  private static async fetchSamples(
    doctorId: string
  ): Promise<DurationSamples> {
    const rows = (await database.execute(sql`
      WITH spans AS (
        SELECT
          a.id,
          a.appointment_date,
          EXTRACT(
            EPOCH FROM (
              MAX(h.created_at) FILTER (WHERE h.action = 'COMPLETED')
              - MIN(h.created_at) FILTER (WHERE h.action = 'CONFIRMED')
            )
          ) / 60 AS minutes
        FROM appointments a
        JOIN appointment_activity_history h ON h.appointment_id = a.id
        WHERE a.doctor_id = ${doctorId}
          AND a.appointment_date >= NOW() - make_interval(days => ${BASELINE_WINDOW_DAYS})
        GROUP BY a.id, a.appointment_date
      ),
      valid AS (
        SELECT
          minutes,
          (appointment_date AT TIME ZONE 'Asia/Kolkata')::date
            = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS is_today
        FROM spans
        WHERE minutes IS NOT NULL
          AND minutes >= ${MIN_VALID_SAMPLE_MINUTES}
          AND minutes <= ${MAX_VALID_SAMPLE_MINUTES}
      )
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes) AS baseline_minutes,
        COUNT(*) AS baseline_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes)
          FILTER (WHERE is_today) AS today_minutes,
        COUNT(*) FILTER (WHERE is_today) AS today_count
      FROM valid
    `)) as unknown as Array<Record<string, unknown>>;

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) {
      return {
        baselineMinutes: null,
        baselineCount: 0,
        todayMinutes: null,
        todayCount: 0,
      };
    }

    const toNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      baselineMinutes: toNumber(row.baseline_minutes),
      baselineCount: toNumber(row.baseline_count) ?? 0,
      todayMinutes: toNumber(row.today_minutes),
      todayCount: toNumber(row.today_count) ?? 0,
    };
  }

  /**
   * This doctor's configured length at this clinic, from their assignment row.
   *
   * Per doctor per clinic rather than clinic-wide: consultation length is a
   * property of the doctor, so one number for the whole building is wrong for
   * everyone who is not the average. The same doctor can also carry different
   * lengths at two clinics.
   */
  private static async readDoctorDefault(
    clinicId: string,
    doctorId: string
  ): Promise<number | null> {
    try {
      const [assignment] = await database
        .select({
          defaultConsultationMinutes:
            ClinicAssignModel.defaultConsultationMinutes,
        })
        .from(ClinicAssignModel)
        .where(
          and(
            eq(ClinicAssignModel.clinicId, clinicId),
            eq(ClinicAssignModel.userId, doctorId)
          )
        )
        .limit(1);

      const value = assignment?.defaultConsultationMinutes;
      return typeof value === 'number' && value > 0 ? value : null;
    } catch (error) {
      logger.warn(
        `[ConsultationDuration] Failed to read doctor default for doctor=${doctorId}`,
        { error }
      );
      return null;
    }
  }

  private static async readClinicDefault(
    clinicId: string
  ): Promise<number | null> {
    try {
      const [settings] = await database
        .select({
          defaultConsultationMinutes:
            ClinicSettingsModel.defaultConsultationMinutes,
        })
        .from(ClinicSettingsModel)
        .where(eq(ClinicSettingsModel.clinicId, clinicId))
        .limit(1);

      const value = settings?.defaultConsultationMinutes;
      return typeof value === 'number' && value > 0 ? value : null;
    } catch (error) {
      logger.warn(
        `[ConsultationDuration] Failed to read clinic default for clinic=${clinicId}`,
        { error }
      );
      return null;
    }
  }

  /**
   * Final guard rail. Whatever the history says, a five-minute floor and a
   * ninety-minute ceiling keep one pathological clinic from producing a queue
   * projection nobody can act on.
   */
  private static clamp(minutes: number): number {
    return Math.min(
      MAX_RESULT_MINUTES,
      Math.max(MIN_RESULT_MINUTES, Math.round(minutes))
    );
  }

  /** Exposed for tests — the blend is the part worth pinning down. */
  static blendForTest(samples: DurationSamples): number | null {
    if (samples.baselineMinutes === null || samples.baselineCount < MIN_SAMPLES)
      return null;

    const weight =
      samples.todayMinutes !== null && samples.todayCount > 0
        ? samples.todayCount / (samples.todayCount + TODAY_WEIGHT_K)
        : 0;

    const blended =
      samples.baselineMinutes * (1 - weight) +
      (samples.todayMinutes ?? samples.baselineMinutes) * weight;

    return this.clamp(Math.round(blended));
  }
}
