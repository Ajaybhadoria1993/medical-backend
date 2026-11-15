import { MoveToTodayService } from '../services/moveToToday.service';
import { AppointmentService } from '../services/appointment.service';
import { DoctorArrivalService } from '../../appointment-engine/services/doctorArrival.service';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import { AvailableSlotsService } from '../../appointment-engine/services/availableSlots.service';
import { PermissionService } from '../../permissions/services/permission.service';
import { getISTDateString } from '../../../utils/istDateTime';

jest.mock('../../../configurations/dbConnection');

// Move-to-today: refused only for real reasons, never because a token or slot was taken.
const DAY = 86_400_000;
const user = { id: 'rec-1', userType: 'Receptionist' } as any;
const tomorrow = new Date(getISTDateString(new Date(Date.now() + DAY)));

const base = {
  id: 'appt-1',
  clinicId: 'clinic-1',
  doctorId: 'doctor-a',
  patientId: 'patient-1',
  appointmentStatus: 'Upcoming',
  appointmentDate: tomorrow,
  tokenNo: 5,
};

let update: jest.SpyInstance;
const S = MoveToTodayService as any;

const setup = (
  appointment: object,
  opts: { arrived?: boolean; taken?: number[] } = {}
) => {
  jest.spyOn(S, 'load').mockResolvedValue({ ...base, ...appointment });
  jest.spyOn(DoctorArrivalService, 'getActiveForClinic').mockResolvedValue({
    date: '',
    arrivals: opts.arrived === false ? [] : [{}],
  } as any);
  jest
    .spyOn(TokenSessionService, 'resolve')
    .mockResolvedValue({ sessionIndex: 1 } as any);
  jest.spyOn(S, 'takenTokens').mockResolvedValue(new Set(opts.taken ?? []));
  jest.spyOn(AvailableSlotsService, 'getAvailableSlots').mockResolvedValue({
    slots: [{ start: '2026-10-02T23:00:00', status: 'available' }],
  } as any);
  update = jest
    .spyOn(AppointmentService, 'updateAppointment')
    .mockResolvedValue({} as any);
};

const move = (body: object = {}) =>
  MoveToTodayService.move('appt-1', 'clinic-1', user, body as any);

beforeEach(() => jest.restoreAllMocks());

describe('MoveToTodayService.move — refusals', () => {
  it('refuses an appointment that is already today', async () => {
    setup({ appointmentDate: new Date(getISTDateString()) });
    await expect(move()).rejects.toMatchObject({ status: 409 });
  });

  it.each(['Completed', 'Cancelled', 'Confirmed'])(
    'refuses a %s appointment',
    async (status) => {
      setup({ appointmentStatus: status });
      await expect(move()).rejects.toMatchObject({ status: 409 });
    }
  );

  it('refuses a plan visit when the patient already has a visit today', async () => {
    setup({ appointmentType: 'Treatment' });
    jest.spyOn(S, 'hasSameDayAppointment').mockResolvedValue(true);
    await expect(move()).rejects.toMatchObject({
      status: 409,
      message:
        'Patient already has a visit today. Use that visit for the session instead',
    });
  });

  it('still moves a normal visit when the patient already has one today', async () => {
    setup({ appointmentType: 'Consultation' });
    jest.spyOn(S, 'hasSameDayAppointment').mockResolvedValue(true);
    await move();
    expect(update).toHaveBeenCalled();
  });

  it('refuses until the doctor has started today', async () => {
    setup({}, { arrived: false });
    await expect(move()).rejects.toMatchObject({
      status: 409,
      message: "The doctor hasn't started today yet",
    });
  });
});

describe('MoveToTodayService.move — tokens never block', () => {
  it('keeps the chosen token when it is free', async () => {
    setup({}, { taken: [1, 2] });
    await move({ tokenNo: 7 });
    expect(update.mock.calls[0][1]).toMatchObject({
      appointmentDate: getISTDateString(),
      tokenNo: 7,
      sessionIndex: 1,
    });
  });

  it('falls to the next free token when the chosen one is taken', async () => {
    setup({}, { taken: [1, 2, 3] });
    await move({ tokenNo: 2 });
    expect(update.mock.calls[0][1].tokenNo).toBe(4);
  });

  it('books into the shift the user chose and checks tokens within that shift', async () => {
    setup({}, { taken: [1] });
    const resolve = TokenSessionService.resolve as jest.Mock;
    resolve.mockResolvedValue({ sessionIndex: 2 });
    await move({ tokenNo: 1, sessionIndex: 2 });
    expect(resolve.mock.calls[0][4]).toBe(2);
    expect(S.takenTokens.mock.calls[0][1]).toBe(2);
    expect(update.mock.calls[0][1]).toMatchObject({
      sessionIndex: 2,
      tokenNo: 2,
    });
  });

  it('brings a no-show back as Upcoming', async () => {
    setup({ appointmentStatus: 'NoShow' });
    await move();
    expect(update.mock.calls[0][1].appointmentStatus).toBe('Upcoming');
  });
});

describe('MoveToTodayService.move — slot times', () => {
  it('refuses a time off the free slots without the custom slot permission', async () => {
    setup({ tokenNo: null });
    jest.spyOn(PermissionService, 'hasPermission').mockResolvedValue(false);
    await expect(move({ appointmentTime: '06:00' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('allows a time off the free slots with the custom slot permission', async () => {
    setup({ tokenNo: null });
    jest.spyOn(PermissionService, 'hasPermission').mockResolvedValue(true);
    await move({ appointmentTime: '06:00' });
    expect(update.mock.calls[0][1].appointmentTime).toBe('06:00');
  });

  it('takes a free slot time without any permission check', async () => {
    setup({ tokenNo: null });
    const perm = jest.spyOn(PermissionService, 'hasPermission');
    await move({ appointmentTime: '23:00' });
    expect(perm).not.toHaveBeenCalled();
  });
});
