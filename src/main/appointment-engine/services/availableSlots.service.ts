import { and, eq, gte, lt, ne } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentService } from '../../appointments/services/appointment.service';
import { hhmmToMinutes } from '../../../utils/time.util';
import { resolveAppointmentDuration } from '../utils/helpers';
import { ScheduleShiftService, toHHMM } from './scheduleShift.service';
import { SlotConfigService, DEFAULT_SLOT_MINUTES } from './slotConfig.service';
import { MissedSlotDismissalService } from './missedSlotDismissal.service';

/** `appointments.appointment_date` stores UTC midnight of the IST calendar day. */
const utcMidnight = (dateStr: string): Date => new Date(`${dateStr}T00:00:00Z`);

type AvailableSlotsResult = Awaited<
  ReturnType<typeof AppointmentService.getAvailableSlotsForDate>
>;
type SlotEntry = AvailableSlotsResult['slots'][number];

/** A plain slot from the default generator carries none of these — set only when it's something else. */
export type EnrichedSlotEntry = SlotEntry & {
  /** From an `extra_slots` override — appended after the session's real end time. */
  isExtra?: boolean;
  /** From a `slot_config` override — this session's own grid was customized. */
  isCustomized?: boolean;
  /** A real appointment outside every defined session window (typically a "Custom Slot" booking) — the default generator would otherwise hide it. */
  isOffGrid?: boolean;
};

export interface EnrichedAvailableSlotsResult {
  slots: EnrichedSlotEntry[];
  shifts?: string[];
}

/** Minutes-of-day parsed out of a Slot's `YYYY-MM-DDTHH:mm:00` string. */
function slotMinutes(iso: string): number {
  const timePart = iso.split('T')[1] ?? '00:00:00';
  const [hh, mm] = timePart.split(':').map(Number);
  return hh * 60 + mm;
}

interface AppointmentRow {
  id: string;
  patientId: string;
  appointmentTime: string | null;
  appointmentDurationMinutes: string | null;
  appointmentStatus: string;
  tokenNo: number | null;
}

/** Custom-slot-aware "get bookable slots" — wraps the unmodified legacy generator, overlaying slot_config/extra_slots on top; the legacy endpoint itself is untouched. */
export class AvailableSlotsService {
  static async getAvailableSlots(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<EnrichedAvailableSlotsResult> {
    const base = await AppointmentService.getAvailableSlotsForDate(
      clinicId,
      { date, onlyOccupied: false, occupyMode: 'partial' },
      { doctorId }
    );

    const day = await ScheduleShiftService.resolveDaySegments(
      database,
      clinicId,
      doctorId,
      date
    );

    // Fetched once, reused by buildExtraSlots and appendOffGridAppointments.
    const appointmentRows = await this.fetchDayAppointments(
      clinicId,
      doctorId,
      date
    );

    let slots: EnrichedSlotEntry[] = base.slots;

    for (const segment of day?.segments ?? []) {
      const sessionStart = toHHMM(segment.start);

      const slotConfigOverride = await SlotConfigService.findOverrideRow(
        clinicId,
        doctorId,
        date,
        sessionStart,
        'slot_config'
      );
      if (slotConfigOverride && day) {
        slots = this.applyOverride(
          slots,
          date,
          segment,
          slotConfigOverride,
          day
        );
      }

      const extraSlotsOverride = await SlotConfigService.findOverrideRow(
        clinicId,
        doctorId,
        date,
        sessionStart,
        'extra_slots'
      );
      if (extraSlotsOverride?.numberOfSlots) {
        slots = [
          ...slots,
          ...this.buildExtraSlots(
            date,
            segment,
            extraSlotsOverride,
            appointmentRows
          ),
        ];
      }
    }

    slots = this.appendOffGridAppointments(date, slots, appointmentRows);

    // Dropped entirely, not just re-tagged: once a missed slot has been
    // shifted elsewhere or acknowledged, it should stop being offered at all
    // — never a real booking, so nothing here is ever a booked/off-grid entry.
    const dismissed = await MissedSlotDismissalService.getDismissedSlots(
      clinicId,
      doctorId,
      date
    );
    if (dismissed.size > 0) {
      slots = slots.filter(
        (slot) =>
          slot.status !== 'available' ||
          !dismissed.has(toHHMM(slotMinutes(slot.start)))
      );
    }

    // Sort once at the end so extra/off-grid entries read chronologically.
    // Ties break in favour of `isExtra` entries: an extra slot's cursor starts
    // exactly at its own session's end, which can be the same minute a
    // following break/next-session cell starts — without this, a stable sort
    // would keep the extra slot in its append order (after every session's
    // own extras were appended in a later loop pass), landing it on the wrong
    // side of that boundary and grouping it under the next shift on the client.
    slots = [...slots].sort((a, b) => {
      const diff = slotMinutes(a.start) - slotMinutes(b.start);
      if (diff !== 0) return diff;
      return (a.isExtra ? 0 : 1) - (b.isExtra ? 0 : 1);
    });

    return { slots, shifts: base.shifts };
  }

  /** Every non-cancelled appointment for this doctor/date, fetched once and reused. */
  private static async fetchDayAppointments(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<AppointmentRow[]> {
    const dayStart = utcMidnight(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    return database
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentDurationMinutes: AppointmentModel.appointmentDurationMinutes,
        appointmentStatus: AppointmentModel.appointmentStatus,
        tokenNo: AppointmentModel.tokenNo,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          gte(AppointmentModel.appointmentDate, dayStart),
          lt(AppointmentModel.appointmentDate, dayEnd),
          ne(AppointmentModel.appointmentStatus, 'Cancelled')
        )
      );
  }

  /** `{start, end}` in minutes-of-day for a row's booked time, or null for a token-based booking. */
  private static rowWindow(
    row: AppointmentRow
  ): { start: number; end: number } | null {
    // A token booking carries a placeholder 23:59, not a real time. Placing it
    // on the grid drew a phantom late-night slot instead of its token.
    if (row.tokenNo != null) return null;
    const start = hhmmToMinutes(row.appointmentTime);
    if (start === null) return null;
    const duration = resolveAppointmentDuration(
      row.appointmentDurationMinutes,
      null
    );
    return { start, end: start + duration };
  }

  private static toEntry(
    dateStr: string,
    row: AppointmentRow,
    window: { start: number; end: number },
    extra: Partial<EnrichedSlotEntry> = {}
  ): EnrichedSlotEntry {
    return {
      start: AppointmentService.minutesToIso(dateStr, window.start),
      end: AppointmentService.minutesToIso(dateStr, window.end),
      clinicAvailabilityId: '',
      source: 'appointment',
      status:
        row.appointmentStatus === 'Confirmed' ||
        row.appointmentStatus === 'Patient Arrived'
          ? 'Confirmed'
          : 'booked',
      appointmentId: row.id,
      appointmentStatus: row.appointmentStatus,
      patientId: row.patientId,
      ...extra,
    };
  }

  /** Appends real appointments outside every resolved window (e.g. Custom Slot bookings) that aren't already represented. */
  private static appendOffGridAppointments(
    date: string,
    slots: EnrichedSlotEntry[],
    appointmentRows: AppointmentRow[]
  ): EnrichedSlotEntry[] {
    const isRepresented = (start: number, end: number) =>
      slots.some((slot) => {
        const sStart = slotMinutes(slot.start);
        const sEnd = slotMinutes(slot.end);
        return sStart < end && sEnd > start;
      });

    const extra: EnrichedSlotEntry[] = [];

    for (const row of appointmentRows) {
      const window = this.rowWindow(row);
      if (!window) continue; // token-based booking — nothing to place on this grid
      if (isRepresented(window.start, window.end)) continue;

      extra.push(this.toEntry(date, row, window, { isOffGrid: true }));
    }

    return [...slots, ...extra];
  }

  /** Extra capacity after a session's end; checks `appointmentRows` directly since this region sits outside the default generator's window entirely. */
  private static buildExtraSlots(
    dateStr: string,
    segment: { start: number; end: number },
    override: {
      numberOfSlots: number | null;
      slotMinutes: number | null;
      stepMinutes: number | null;
    },
    appointmentRows: AppointmentRow[]
  ): EnrichedSlotEntry[] {
    const count = override.numberOfSlots ?? 0;
    const slotLength = override.slotMinutes ?? DEFAULT_SLOT_MINUTES;
    const stepGap = Math.max(0, override.stepMinutes ?? 0);

    const booked = appointmentRows
      .map((row) => {
        const window = this.rowWindow(row);
        return window ? { row, window } : null;
      })
      .filter(
        (
          entry
        ): entry is {
          row: AppointmentRow;
          window: { start: number; end: number };
        } => entry !== null
      );

    const entries: EnrichedSlotEntry[] = [];
    const seen = new Set<string>();
    let cursor = segment.end;

    for (let i = 0; i < count; i++) {
      const cellStart = cursor;
      const cellEnd = cursor + slotLength;
      cursor = cellEnd + stepGap;

      const overlapping = booked.find(
        ({ window }) => window.start < cellEnd && window.end > cellStart
      );

      const entry: EnrichedSlotEntry = overlapping
        ? this.toEntry(dateStr, overlapping.row, overlapping.window, {
            isExtra: true,
          })
        : {
            start: AppointmentService.minutesToIso(dateStr, cellStart),
            end: AppointmentService.minutesToIso(dateStr, cellEnd),
            clinicAvailabilityId: '',
            source: 'availability',
            status: 'available',
            isExtra: true,
          };

      // Dedupe: a booking spanning multiple cells would otherwise repeat.
      const key = `${entry.start}-${entry.end}-${entry.appointmentId ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    }

    return entries;
  }

  /** Rebuilds one session's available placeholders from the override, keeping real booked/break entries as-is (misaligned bookings kept as their own entry — overlap policy is a separate, not-yet-built piece). */
  private static applyOverride(
    slots: EnrichedSlotEntry[],
    dateStr: string,
    segment: { start: number; end: number },
    override: {
      noOfPatients: number | null;
      slotMinutes: number | null;
      stepMinutes: number | null;
      numberOfSlots: number | null;
    },
    day: { slotMinutes: number | null; stepMinutes: number | null }
  ): EnrichedSlotEntry[] {
    const inWindow = (slot: EnrichedSlotEntry) => {
      const minutes = slotMinutes(slot.start);
      return minutes >= segment.start && minutes < segment.end;
    };

    const outside = slots.filter((slot) => !inWindow(slot));
    const insideBooked = slots.filter(
      (slot) => inWindow(slot) && slot.status !== 'available'
    );

    if (override.noOfPatients != null) {
      return [
        ...outside,
        this.buildTokenSlot(dateStr, segment, override.noOfPatients, slots),
      ];
    }

    const slotLength =
      override.slotMinutes ?? day.slotMinutes ?? DEFAULT_SLOT_MINUTES;
    const stepGap = override.stepMinutes ?? day.stepMinutes ?? 0;
    const step = Math.max(0, stepGap) + slotLength;

    const generated: EnrichedSlotEntry[] = [];
    const seen = new Set<string>();
    let cursor = segment.start;

    while (cursor + slotLength <= segment.end) {
      const cellStart = cursor;
      const cellEnd = cursor + slotLength;

      const overlapping = insideBooked.find((booked) => {
        const bStart = slotMinutes(booked.start);
        const bEnd = slotMinutes(booked.end);
        return bStart < cellEnd && bEnd > cellStart;
      });

      // A real booking keeps its identity; only a fresh placeholder is marked customized.
      const entry: EnrichedSlotEntry = overlapping ?? {
        start: AppointmentService.minutesToIso(dateStr, cellStart),
        end: AppointmentService.minutesToIso(dateStr, cellEnd),
        clinicAvailabilityId:
          insideBooked[0]?.clinicAvailabilityId ??
          outside[0]?.clinicAvailabilityId ??
          '',
        source: 'availability',
        status: 'available',
        isCustomized: true,
      };

      const key = `${entry.start}-${entry.end}-${entry.status}`;
      if (!seen.has(key)) {
        seen.add(key);
        generated.push(entry);
      }

      cursor += step;
    }

    return [...outside, ...generated];
  }

  /** Resizes the session's token capacity, keeping every already-booked token as-is. */
  private static buildTokenSlot(
    dateStr: string,
    segment: { start: number; end: number },
    totalTokens: number,
    slots: EnrichedSlotEntry[]
  ): EnrichedSlotEntry {
    const existing = slots.find(
      (slot) =>
        slotMinutes(slot.start) >= segment.start &&
        slotMinutes(slot.start) < segment.end &&
        Array.isArray(slot.tokens)
    );

    const bookedTokens = (existing?.tokens ?? []).filter(
      (token) => token.status !== 'available'
    );
    // Override bookings above the total are listed but hold no number inside it.
    const bookedInRange = bookedTokens.filter(
      (token) => token.tokenNo <= totalTokens
    ).length;
    const availableCount = Math.max(0, totalTokens - bookedInRange);

    const baseCapacity = existing?.totalTokens ?? existing?.tokens?.length ?? 0;

    const tokens = [
      ...bookedTokens,
      ...Array.from({ length: availableCount }, (_, index) => {
        const tokenNo = bookedInRange + index + 1;
        return {
          tokenNo,
          status: 'available' as const,
          ...(baseCapacity > 0 && tokenNo > baseCapacity
            ? { isExtra: true }
            : {}),
        };
      }),
    ].sort((a, b) => a.tokenNo - b.tokenNo);

    return {
      start: AppointmentService.minutesToIso(dateStr, segment.start),
      end: AppointmentService.minutesToIso(dateStr, segment.end),
      clinicAvailabilityId: existing?.clinicAvailabilityId ?? '',
      source: 'availability',
      status: 'available',
      totalTokens,
      availableTokens: availableCount,
      tokens,
      isCustomized: true,
    };
  }
}
