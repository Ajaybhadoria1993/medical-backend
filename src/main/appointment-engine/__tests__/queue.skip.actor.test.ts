// Skip's advance confirms the next patient, so only that doctor (or reception) may trigger it.

jest.mock('../../../configurations/dbConnection', () => ({
  database: { update: jest.fn(), select: jest.fn() },
}));

jest.mock('../services/queueHoldStore.service', () => ({
  holdAppointment: jest.fn().mockResolvedValue(undefined),
  getCurrentAppointmentId: jest.fn().mockResolvedValue(null),
}));

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

let putInRoom: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(QueueService as any, 'loadForAction').mockResolvedValue({
    id: 'appt-1',
    appointmentDate: new Date('2026-10-02T00:00:00Z'),
    appointmentStatus: 'Patient Arrived',
    clinicId: 'clinic-1',
    doctorId: 'doctor-a',
  });
  jest.spyOn(QueueService, 'getBoard').mockResolvedValue({
    currentPatient: null,
    nextPatient: { appointmentId: 'appt-2' },
  } as any);
  putInRoom = jest
    .spyOn(QueueService as any, 'putInRoom')
    .mockResolvedValue(undefined);
});

const skipAs = (actorType: string, performedBy: string) =>
  QueueService.skip('clinic-1', 'appt-1', actorType, performedBy);

describe('QueueService.skip — who may advance the queue', () => {
  it("does not send the next patient in when an admin skips another doctor's queue", async () => {
    await skipAs('Admin', 'admin-1');
    expect(putInRoom).not.toHaveBeenCalled();
  });

  it('sends the next patient in for the queue’s own doctor', async () => {
    await skipAs('Doctor', 'doctor-a');
    expect(putInRoom).toHaveBeenCalledTimes(1);
  });

  it('sends the next patient in for an admin-doctor on their own queue', async () => {
    await skipAs('Admin', 'doctor-a');
    expect(putInRoom).toHaveBeenCalledTimes(1);
  });

  it('keeps reception skip unchanged', async () => {
    await skipAs('Receptionist', 'rec-1');
    expect(putInRoom).toHaveBeenCalledTimes(1);
  });
});
