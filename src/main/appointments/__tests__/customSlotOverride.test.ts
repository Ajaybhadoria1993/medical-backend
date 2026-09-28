import { AppointmentService } from '../services/appointment.service';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  createCustomAppointmentSchema,
  MAX_TOKEN_NUMBER,
} from '../schemas/appointment.schemas';
import { isOverrideAppointmentType } from '../utils/appointmentType.constants';

jest.mock('../../../configurations/dbConnection');

/**
 * The override flow's whole purpose is that it does NOT consult the schedule.
 * These cover the two halves of that: what it must stop refusing (the bug —
 * "Clinic availability shift has already ended for today" on a deliberate
 * 4:15pm custom slot), and the one rule it must still enforce (past time).
 */
describe('AppointmentService.validateCustomOverrideBooking', () => {
  const createChain = (finalValue: any) => {
    const chain: any = {};
    ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit'].forEach(
      (method) => {
        chain[method] = jest.fn().mockImplementation(() => chain);
      }
    );
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  const activeUsers = [
    { id: 'doctor-1', status: 'Active', userType: 'Doctor' },
    { id: 'patient-1', status: 'Active', userType: 'Patient' },
  ];

  /** IST "today"/"tomorrow" as YYYY-MM-DD, matching what the validator derives. */
  const istDate = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const [day, month, year] = d
      .toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('/');
    return `${year}-${month}-${day}`;
  };

  const istNowMinutes = () => {
    const [h, m] = new Date()
      .toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
      })
      .split(':')
      .map(Number);
    return h * 60 + m;
  };

  const hhmm = (totalMinutes: number) => {
    const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
    const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const m = String(wrapped % 60).padStart(2, '0');
    return `${h}:${m}`;
  };

  /**
   * `availability` is what the normal path reads to decide the shift has ended.
   * Pass `null` for the day-off case, where no row exists at all.
   */
  const mockTx = (availability: any = null) => ({
    select: jest
      .fn()
      .mockReturnValueOnce(createChain(activeUsers)) // users
      .mockReturnValueOnce(createChain(availability ? [availability] : [])) // ClinicAvailability
      .mockReturnValueOnce(createChain([])), // active cancellation policy
  });

  const basePayload = {
    doctorId: 'doctor-1',
    patientId: 'patient-1',
    appointmentType: 'Consultation',
  } as any;

  it('allows a slot after the clinic shift has already ended today', async () => {
    // The reported bug: 4:15pm custom slot against a shift that ended at 4pm.
    // Only meaningful while there is still time left in the day to book into.
    const target = istNowMinutes() + 15;
    if (target >= 1440) return;

    const result = await AppointmentService.validateCustomOverrideBooking(
      'user-1',
      'clinic-1',
      {
        ...basePayload,
        appointmentDate: istDate(),
        appointmentTime: hhmm(target),
      },
      'user-1',
      mockTx({ slotMinutes: 30, endTime: '16:00', isAvailable: true })
    );

    expect(result.finalAppointmentTime).toBe(hhmm(target));
    expect(result.duration).toBe(30);
  });

  it('allows a slot on a day the doctor has no availability configured', async () => {
    // No ClinicAvailability row at all — the normal path throws
    // "Clinic is not available on {day}" here.
    const result = await AppointmentService.validateCustomOverrideBooking(
      'user-1',
      'clinic-1',
      {
        ...basePayload,
        appointmentDate: istDate(1),
        appointmentTime: '02:00',
      },
      'user-1',
      mockTx(null)
    );

    expect(result.finalAppointmentTime).toBe('02:00');
    // Falls back to the 30-minute default rather than failing on the missing row.
    expect(result.duration).toBe(30);
  });

  it('allows a time earlier today, for recording a walk-in already seen', async () => {
    // Deliberate: staff record a patient seen at 3am when they get to the desk
    // at 9am. Refusing would force them to enter a time they know is wrong.
    const target = istNowMinutes() - 30;
    if (target < 0) return;

    const result = await AppointmentService.validateCustomOverrideBooking(
      'user-1',
      'clinic-1',
      {
        ...basePayload,
        appointmentDate: istDate(),
        appointmentTime: hhmm(target),
      },
      'user-1',
      mockTx({ slotMinutes: 30, endTime: '23:59', isAvailable: true })
    );

    expect(result.finalAppointmentTime).toBe(hhmm(target));
  });

  it('rejects a date in the past', async () => {
    await expect(
      AppointmentService.validateCustomOverrideBooking(
        'user-1',
        'clinic-1',
        {
          ...basePayload,
          appointmentDate: istDate(-1),
          appointmentTime: '10:00',
        },
        'user-1',
        mockTx(null)
      )
    ).rejects.toThrow(
      new HttpError(400, 'Appointment date cannot be in the past')
    );
  });

  it('rejects a blocked patient', async () => {
    const tx = {
      select: jest.fn().mockReturnValueOnce(
        createChain([
          { id: 'doctor-1', status: 'Active', userType: 'Doctor' },
          { id: 'patient-1', status: 'Blocked', userType: 'Patient' },
        ])
      ),
    };

    await expect(
      AppointmentService.validateCustomOverrideBooking(
        'user-1',
        'clinic-1',
        {
          ...basePayload,
          appointmentDate: istDate(1),
          appointmentTime: '02:00',
        },
        'user-1',
        tx
      )
    ).rejects.toThrow(new HttpError(403, 'Patient account is blocked'));
  });

  it('rejects a token already taken, even for an override', async () => {
    // Token collision is data integrity, not schedule policy — an override
    // does not get to hand two patients the same queue position.
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(createChain(activeUsers)) // users
        .mockReturnValueOnce(createChain([])) // ClinicAvailability
        .mockReturnValueOnce(createChain([{ tokenNo: 7 }])), // booked tokens
    };

    await expect(
      AppointmentService.validateCustomOverrideBooking(
        'user-1',
        'clinic-1',
        {
          ...basePayload,
          appointmentDate: istDate(1),
          appointmentTime: '23:59',
          tokenNo: 7,
        },
        'user-1',
        tx
      )
    ).rejects.toThrow(new HttpError(400, 'Token 7 is already booked'));
  });
});

describe('override appointment types', () => {
  it('recognises every override type, case-insensitively', () => {
    expect(isOverrideAppointmentType('Custom')).toBe(true);
    expect(isOverrideAppointmentType('Emergency')).toBe(true);
    expect(isOverrideAppointmentType('Follow-up')).toBe(true);
    expect(isOverrideAppointmentType('emergency')).toBe(true);
  });

  it('does not treat an ordinary appointment as an override', () => {
    expect(isOverrideAppointmentType('Consultation')).toBe(false);
    expect(isOverrideAppointmentType('Online')).toBe(false);
    expect(isOverrideAppointmentType(null)).toBe(false);
    expect(isOverrideAppointmentType(undefined)).toBe(false);
  });

  it('defaults appointmentType to Custom when the client omits it', () => {
    const parsed = createCustomAppointmentSchema.parse({
      doctorId: '11111111-1111-4111-8111-111111111111',
      patientId: '22222222-2222-4222-8222-222222222222',
      appointmentDate: '2099-01-01',
      appointmentTime: '02:00',
    });

    expect(parsed.appointmentType).toBe('Custom');
  });

  it('refuses a non-override type on the override endpoint', () => {
    // Accepting 'Consultation' here would produce a booking that skipped
    // availability validation while looking like an ordinary one.
    const result = createCustomAppointmentSchema.safeParse({
      doctorId: '11111111-1111-4111-8111-111111111111',
      patientId: '22222222-2222-4222-8222-222222222222',
      appointmentDate: '2099-01-01',
      appointmentTime: '02:00',
      appointmentType: 'Consultation',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an appointmentTime that is not HH:mm', () => {
    const result = createCustomAppointmentSchema.safeParse({
      doctorId: '11111111-1111-4111-8111-111111111111',
      patientId: '22222222-2222-4222-8222-222222222222',
      appointmentDate: '2099-01-01',
      appointmentTime: '4:15 PM',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a token number that would overflow the integer column', () => {
    // `token_no` is a Postgres integer: without a bound this fails at insert as
    // a 500 rather than as validation. 2^31 is exactly one past what the column
    // holds, which is the boundary that matters here.
    const result = createCustomAppointmentSchema.safeParse({
      doctorId: '11111111-1111-4111-8111-111111111111',
      patientId: '22222222-2222-4222-8222-222222222222',
      appointmentDate: '2099-01-01',
      appointmentTime: '23:59',
      tokenNo: 2147483648,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a token at the maximum', () => {
    const result = createCustomAppointmentSchema.safeParse({
      doctorId: '11111111-1111-4111-8111-111111111111',
      patientId: '22222222-2222-4222-8222-222222222222',
      appointmentDate: '2099-01-01',
      appointmentTime: '23:59',
      tokenNo: MAX_TOKEN_NUMBER,
    });

    expect(result.success).toBe(true);
  });
});
