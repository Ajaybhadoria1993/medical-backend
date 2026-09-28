/**
 * Unit tests for learned consultation duration.
 *
 * Two things are worth pinning down here. The blend decides how fast today's
 * pace overtakes the 30-day baseline — get the weighting backwards and every
 * estimate lurches on the first consultation of the morning. The resolution
 * chain decides which source wins, and a wrong order silently reverts the
 * feature to the slot size it was built to replace.
 */

import { ConsultationDurationService } from '../services/consultationDuration.service';
import { resolveAppointmentDuration } from '../utils/helpers';

describe('learned duration blend', () => {
  const blend = (over: {
    baselineMinutes?: number | null;
    baselineCount?: number;
    todayMinutes?: number | null;
    todayCount?: number;
  }) =>
    ConsultationDurationService.blendForTest({
      baselineMinutes: 20,
      baselineCount: 40,
      todayMinutes: null,
      todayCount: 0,
      ...over,
    });

  it('is the pure baseline before any consultation today', () => {
    expect(blend({ todayMinutes: null, todayCount: 0 })).toBe(20);
  });

  it('barely moves on the first consultation of the day', () => {
    // One 40-minute consult must not double everyone's estimate. Weight is
    // 1/(1+8), so the baseline still dominates.
    expect(blend({ todayMinutes: 40, todayCount: 1 })).toBe(22);
  });

  it('reaches half weight at eight consultations', () => {
    // weight = 8/(8+8) = 0.5 → midpoint of 20 and 40.
    expect(blend({ todayMinutes: 40, todayCount: 8 })).toBe(30);
  });

  it('is dominated by today once the day is well established', () => {
    // weight = 24/(24+8) = 0.75 → 20*0.25 + 40*0.75.
    expect(blend({ todayMinutes: 40, todayCount: 24 })).toBe(35);
  });

  it('refuses to learn from too few samples', () => {
    expect(blend({ baselineCount: 9 })).toBeNull();
    expect(blend({ baselineCount: 10 })).toBe(20);
  });

  it('refuses to learn with no baseline at all', () => {
    expect(blend({ baselineMinutes: null })).toBeNull();
  });

  it('clamps an implausibly short result to the floor', () => {
    // A clinic whose history says one minute per patient is a data problem,
    // not a queue that should be projected at one minute per patient.
    expect(blend({ baselineMinutes: 1, todayMinutes: 1, todayCount: 20 })).toBe(
      5
    );
  });

  it('clamps an implausibly long result to the ceiling', () => {
    expect(
      blend({ baselineMinutes: 150, todayMinutes: 150, todayCount: 20 })
    ).toBe(90);
  });

  it('tracks a doctor running faster than their own baseline', () => {
    // The point of blending: a doctor moving quickly today should shorten
    // waits, not just lengthen them.
    expect(
      blend({ baselineMinutes: 30, todayMinutes: 10, todayCount: 24 })
    ).toBe(15);
  });
});

describe('duration resolution chain', () => {
  it("prefers the appointment's own duration over everything", () => {
    // Someone deliberately booked a double slot; they know more than any
    // average does.
    expect(
      resolveAppointmentDuration('60', 30, {
        doctorMinutes: 12,
        clinicMinutes: 20,
      })
    ).toBe(60);
  });

  it('prefers a doctor-specific value over the booking slot', () => {
    // The whole point: a clinic booking 30-minute slots for a doctor who
    // averages 12 minutes should project 12, not 30.
    expect(resolveAppointmentDuration(null, 30, { doctorMinutes: 12 })).toBe(
      12
    );
  });

  it("prefers this doctor's slot size over a clinic-wide default", () => {
    // The ordering that matters when a clinic has a GP and a surgeon: the slot
    // comes from this doctor's own availability row, so it is still a statement
    // about this doctor. A clinic-wide number is not, and is wrong for everyone
    // who is not the average.
    expect(
      resolveAppointmentDuration(null, 15, {
        doctorMinutes: null,
        clinicMinutes: 45,
      })
    ).toBe(15);
  });

  it('falls back to the clinic default when the doctor has no slot size', () => {
    expect(
      resolveAppointmentDuration(null, null, {
        doctorMinutes: null,
        clinicMinutes: 20,
      })
    ).toBe(20);
  });

  it('falls back to 30 when nothing at all is available', () => {
    expect(
      resolveAppointmentDuration(null, null, {
        doctorMinutes: null,
        clinicMinutes: null,
      })
    ).toBe(30);
  });

  it('behaves exactly as before when no fallbacks are supplied', () => {
    // Existing callers pass two arguments; none of them may change behaviour.
    expect(resolveAppointmentDuration(null, 30)).toBe(30);
    expect(resolveAppointmentDuration('45', 30)).toBe(45);
    expect(resolveAppointmentDuration(null, null)).toBe(30);
  });

  it('ignores non-positive configured values', () => {
    expect(
      resolveAppointmentDuration(null, 25, {
        doctorMinutes: 0,
        clinicMinutes: -5,
      })
    ).toBe(25);
  });
});
