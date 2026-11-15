import { LeaveMoveService } from '../services/leaveMove.service';
import { AppointmentService } from '../services/appointment.service';
import { MoveToTodayService } from '../services/moveToToday.service';
import { ScheduleShiftService } from '../../appointment-engine/services/scheduleShift.service';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import { AvailableSlotsService } from '../../appointment-engine/services/availableSlots.service';
import { CancellationPolicyService } from '../../cancellation-policy/services/cancellationPolicy.service';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString } from '../../../utils/istDateTime';
import { notifyAppointmentCanceled } from '../../../utils/notificationHelpers';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/notificationHelpers', () => ({
  notifyAppointmentCanceled: jest.fn(),
}));

// Leave move: visits on leave days go to one working date, never blocked by a taken token or slot.
const day = (n: number) => {
  const d = new Date(getISTDateString());
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const doctor = { id: 'doctor-a', userType: 'Doctor' } as any;
const LEAVE = day(2);
const TARGET = day(3);
const S = LeaveMoveService as any;

const appt = (over: object) => ({
  appointment: {
    id: 'a1',
    clinicId: 'clinic-1',
    doctorId: 'doctor-a',
    appointmentStatus: 'Upcoming',
    appointmentDate: new Date(LEAVE),
    tokenNo: 3,
    sessionIndex: 1,
    appointmentTime: null,
    ...over,
  },
  patientName: 'Ravi',
});

let update: jest.SpyInstance;
let resolveSession: jest.SpyInstance;

const setup = (
  rows: object[],
  opts: { shifts?: number; taken?: number[]; free?: string[] } = {}
) => {
  jest.spyOn(S, 'findBooked').mockResolvedValue(rows);
  jest
    .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
    .mockResolvedValue({
      segments: Array.from({ length: opts.shifts ?? 1 }, () => ({})),
    } as any);
  resolveSession = jest
    .spyOn(TokenSessionService, 'resolve')
    .mockImplementation(
      async (_e, _c, _d, _date, requested) =>
        ({ sessionIndex: requested ?? 1 }) as any
    );
  jest
    .spyOn(MoveToTodayService, 'takenTokens')
    .mockImplementation(async () => new Set(opts.taken ?? []));
  jest.spyOn(AvailableSlotsService, 'getAvailableSlots').mockResolvedValue({
    slots: (opts.free ?? []).map((t) => ({
      start: `${TARGET}T${t}:00`,
      status: 'available',
    })),
  } as any);
  update = jest
    .spyOn(AppointmentService, 'updateAppointment')
    .mockResolvedValue({} as any);
};

const move = (targetDate = TARGET) =>
  LeaveMoveService.move('clinic-1', doctor, { dates: [LEAVE], targetDate });

beforeEach(() => jest.restoreAllMocks());

describe('LeaveMoveService.move — target date', () => {
  it.each([
    ['today', day(0)],
    ['past 30 days', day(31)],
    ['a leave day', LEAVE],
  ])('refuses %s', async (_label, target) => {
    setup([appt({})]);
    await expect(move(target)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a day the doctor does not work', async () => {
    setup([appt({})]);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue(null);
    await expect(move()).rejects.toMatchObject({ status: 400 });
  });
});

describe('LeaveMoveService.move — placement', () => {
  it('keeps a free token and shift, and a taken one falls to the lowest free', async () => {
    setup([appt({ id: 'a1', tokenNo: 3 }), appt({ id: 'a2', tokenNo: 1 })], {
      taken: [1],
    });
    const result = await move();
    expect(update.mock.calls[0][1]).toMatchObject({
      appointmentDate: TARGET,
      tokenNo: 3,
      sessionIndex: 1,
    });
    // 1 is taken on the target day, 3 by the visit just placed.
    expect(update.mock.calls[1][1].tokenNo).toBe(2);
    expect(result).toEqual({ moved: 2, failed: [] });
  });

  it('puts a shift the target day lacks into its last shift', async () => {
    setup([appt({ sessionIndex: 2 })], { shifts: 1 });
    await move();
    expect(resolveSession.mock.calls[0][4]).toBe(1);
  });

  it('brings a confirmed visit back as Upcoming', async () => {
    setup([appt({ appointmentStatus: 'Confirmed' })]);
    await move();
    expect(update.mock.calls[0][1].appointmentStatus).toBe('Upcoming');
  });

  it('gives time visits the same, next free, or kept time', async () => {
    setup(
      [
        appt({ id: 'a1', tokenNo: null, appointmentTime: '10:00' }),
        appt({ id: 'a2', tokenNo: null, appointmentTime: '10:00' }),
        appt({ id: 'a3', tokenNo: null, appointmentTime: '12:00' }),
      ],
      { free: ['10:00', '10:30'] }
    );
    await move();
    expect(update.mock.calls.map((c) => c[1].appointmentTime)).toEqual([
      '10:00',
      '10:30',
      '12:00',
    ]);
  });

  it('keeps moving the rest when one visit fails', async () => {
    setup([appt({ id: 'a1' }), appt({ id: 'a2', tokenNo: 4 })]);
    update.mockRejectedValueOnce(new Error('boom'));
    const result = await move();
    expect(result).toEqual({
      moved: 1,
      failed: [{ id: 'a1', reason: 'Could not move' }],
    });
  });
});

describe('LeaveMoveService.cancel', () => {
  it('cancels each visit as its doctor with the leave reason and tells the patient', async () => {
    setup([appt({ id: 'a1' }), appt({ id: 'a2' })]);
    jest.spyOn(S, 'nameOf').mockResolvedValue('Dr. Rao');
    const cancel = jest
      .spyOn(CancellationPolicyService, 'processCancellationRequest')
      .mockRejectedValueOnce(new HttpError(400, 'Not allowed'))
      .mockResolvedValueOnce({} as any);
    const notify = (notifyAppointmentCanceled as jest.Mock).mockResolvedValue(
      undefined
    );
    const result = await LeaveMoveService.cancel('clinic-1', doctor, [LEAVE]);
    expect(cancel.mock.calls[1]).toEqual([
      'a2',
      'doctor-a',
      'Doctor',
      { reasonCode: 'doctor_leave' },
      'clinic-1',
    ]);
    // Only the cancelled visit's patient is notified.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toBe('a2');
    expect(result).toEqual({
      cancelled: 1,
      failed: [{ id: 'a1', reason: 'Not allowed' }],
    });
  });
});

describe('LeaveMoveService.preview', () => {
  it('suggests the first working day after the leave', async () => {
    setup([appt({})]);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockImplementation(async (_e, _c, _d, date) =>
        date === day(4) ? ({ segments: [{}] } as any) : null
      );
    const result = await LeaveMoveService.preview('clinic-1', 'doctor-a', [
      LEAVE,
    ]);
    expect(result).toMatchObject({ count: 1, nextWorkingDay: day(4) });
  });
});
