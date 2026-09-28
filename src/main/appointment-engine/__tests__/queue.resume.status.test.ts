/**
 * Hold has no arrival check, so a `Confirmed` row can be held — and resuming
 * it must not leave that status, which every board reads as "not here yet".
 */

const updateSet = jest.fn().mockReturnValue({ where: jest.fn() });

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    update: jest.fn(() => ({ set: updateSet })),
    select: jest.fn(),
  },
}));

jest.mock('../services/queueHoldStore.service', () => ({
  resumeAppointment: jest.fn().mockResolvedValue(undefined),
  getHeldAppointments: jest.fn().mockResolvedValue(new Map()),
  getCurrentAppointmentId: jest.fn().mockResolvedValue(null),
  getNextAppointmentIds: jest.fn().mockResolvedValue([]),
  getConsultationStartedAt: jest.fn().mockResolvedValue(null),
}));

const logActivity = jest.fn().mockResolvedValue(undefined);
jest.mock(
  '../../appointments/services/appointmentActivityHistory.service',
  () => ({ AppointmentActivityHistoryService: { logActivity } })
);

jest.mock('../../realtime', () => ({
  realtimeBus: { notify: jest.fn() },
  target: { queue: () => ({}), board: () => ({}) },
}));

jest.mock('../services/orchestrator.service', () => ({
  AppointmentEngineOrchestrator: jest.fn().mockImplementation(() => ({
    onQueueAction: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { QueueService } from '../services/queue.service';

const APPT = 'appt-1';

const runResume = async (appointmentStatus: string, arrivedAt: Date | null) => {
  jest.spyOn(QueueService as any, 'loadForAction').mockResolvedValue({
    id: APPT,
    appointmentDate: new Date('2026-09-09T00:00:00Z'),
    appointmentStatus,
    arrivedAt,
    clinicId: 'clinic-1',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
  });
  jest.spyOn(QueueService, 'getBoard').mockResolvedValue({} as any);
  await QueueService.resume('clinic-1', APPT);
};

beforeEach(() => jest.clearAllMocks());

describe('QueueService.resume', () => {
  it('promotes a never-arrived patient to Patient Arrived and stamps arrival', async () => {
    await runResume('Confirmed', null);

    expect(updateSet).toHaveBeenCalledTimes(1);
    const written = updateSet.mock.calls[0][0];
    expect(written.appointmentStatus).toBe('Patient Arrived');
    expect(written.arrivedAt).toBeInstanceOf(Date);
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it('keeps the original arrival time when one is already recorded', async () => {
    const arrived = new Date('2026-09-09T05:18:08.543Z');
    await runResume('Pending', arrived);

    const written = updateSet.mock.calls[0][0];
    expect(written.appointmentStatus).toBe('Patient Arrived');
    expect(written.arrivedAt).toBeUndefined();
  });

  it('never resurrects a cancelled appointment', async () => {
    await runResume('Cancelled', null);

    expect(updateSet).not.toHaveBeenCalled();
  });

  it('leaves an already-arrived patient untouched', async () => {
    await runResume('Patient Arrived', new Date());

    expect(updateSet).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});
