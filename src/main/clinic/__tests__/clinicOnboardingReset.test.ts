import { ClinicService } from '../services/clinic.service';
import { database } from '../../../configurations/dbConnection';
import { comparePassword } from '../../../utils/authUtils';
import { realtimeBus } from '../../realtime/services/realtimeBus.service';
import { AppointmentActivityHistoryService } from '../../appointments/services/appointmentActivityHistory.service';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('../../../utils/authUtils', () => ({
  comparePassword: jest.fn(),
  generateOTP: jest.fn(),
  hashToken: jest.fn(),
}));
// `attach` is required: app.ts calls it at module scope, which this file
// reaches through clinic.service -> notificationHelpers.
jest.mock('../../realtime/services/realtimeBus.service', () => ({
  realtimeBus: {
    attach: jest.fn(),
    notifySessionInvalidated: jest.fn(),
    notify: jest.fn(),
  },
}));
jest.mock('../../appointments/services/autoNoShow.service', () => ({
  autoNoShowQueue: { removeAutoNoShow: jest.fn() },
}));
jest.mock(
  '../../notifications/services/appointmentWhatsappReminder.service',
  () => ({
    whatsAppReminderQueue: { removeWhatsAppReminders: jest.fn() },
  })
);
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: { get: jest.fn(), setex: jest.fn(), del: jest.fn() },
}));

describe('ClinicService.resetClinicOnboarding', () => {
  const SUPER_ADMIN_ID = 'super-1';
  const CLINIC_ID = 'clinic-1';
  const OWNER_ID = 'owner-1';

  type Chain = { [method: string]: unknown };

  const createChain = (finalValue: unknown, onSet?: jest.Mock): Chain => {
    const chain: Chain = {};
    ['from', 'where', 'limit', 'select', 'returning', 'values'].forEach((m) => {
      chain[m] = jest.fn(() => chain);
    });
    chain.set = jest.fn((payload: unknown) => {
      onSet?.(payload);
      return chain;
    });
    chain.then = (resolve: (value: unknown) => void) => resolve(finalValue);
    return chain;
  };

  const updateSets: unknown[] = [];
  const auditInsert = jest.fn();
  let txDelete: jest.Mock;
  let assignFreePlan: jest.SpyInstance;

  /** Wires the three selects (super admin, clinic, members) and the transaction. */
  const arrange = (
    clinicRow: Record<string, unknown> = { id: CLINIC_ID, userId: OWNER_ID },
    laterUpdateRows: unknown[] = []
  ) => {
    (comparePassword as jest.Mock).mockResolvedValue(true);

    // Post-commit and already covered by its own callers; stubbed so this file
    // stays about the reset rather than the free-plan helper's queries.
    assignFreePlan = jest
      .spyOn(ClinicService, 'assignDefaultFreePlan')
      .mockResolvedValue(undefined);

    const select = database.select as jest.Mock;
    [
      createChain([{ password: 'hashed' }]),
      createChain([clinicRow]),
      createChain([{ userId: 'staff-1' }]),
    ].forEach((chain) => select.mockReturnValueOnce(chain));

    const recordSet = jest.fn((payload: unknown) => updateSets.push(payload));
    txDelete = jest.fn(() => createChain([]));

    (database.transaction as jest.Mock).mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          update: jest
            .fn()
            .mockReturnValueOnce(createChain([{ id: CLINIC_ID }], recordSet))
            .mockReturnValue(createChain(laterUpdateRows, recordSet)),
          delete: txDelete,
          insert: jest.fn(() => ({
            values: auditInsert.mockResolvedValue(undefined),
          })),
        })
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks leaves queued mockReturnValueOnce values in place, and a
    // test that throws early leaves its unused chains for the next one.
    (database.select as jest.Mock).mockReset();
    (database.transaction as jest.Mock).mockReset();
    updateSets.length = 0;
  });

  it('rejects a wrong password without writing anything', async () => {
    (comparePassword as jest.Mock).mockResolvedValue(false);
    (database.select as jest.Mock).mockReturnValueOnce(
      createChain([{ password: 'hashed' }])
    );

    await expect(
      ClinicService.resetClinicOnboarding(CLINIC_ID, SUPER_ADMIN_ID, {
        password: 'wrong',
      })
    ).rejects.toThrow('Password confirmation failed');

    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown clinic as 404', async () => {
    (comparePassword as jest.Mock).mockResolvedValue(true);
    (database.select as jest.Mock)
      .mockReturnValueOnce(createChain([{ password: 'hashed' }]))
      .mockReturnValueOnce(createChain([]));

    await expect(
      ClinicService.resetClinicOnboarding(CLINIC_ID, SUPER_ADMIN_ID, {
        password: 'right',
      })
    ).rejects.toThrow('Clinic not found');

    expect(database.transaction).not.toHaveBeenCalled();
  });

  // The regression that matters: a partial reset leaves the owner in the app.
  it('clears all three wizard gates and sets the owner back to New', async () => {
    arrange();

    await ClinicService.resetClinicOnboarding(CLINIC_ID, SUPER_ADMIN_ID, {
      password: 'right',
      reason: 'Wrong clinic type chosen',
    });

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        onboardingStatus: 'NOT_STARTED',
        approvalRequestSent: false,
        currentStep: 0,
        status: 'Pending',
      })
    );
    expect(updateSets[1]).toEqual(
      expect.objectContaining({ userStatus: 'New' })
    );
  });

  // The whole point of a flags-only reset: the clinic's own data is untouched.
  it('never writes to the clinic details or deletes any row', async () => {
    arrange();

    await ClinicService.resetClinicOnboarding(CLINIC_ID, SUPER_ADMIN_ID, {
      password: 'right',
    });

    expect(updateSets[0]).not.toHaveProperty('clinicName');
    expect(updateSets[0]).not.toHaveProperty('clinicPhone');
    expect(txDelete).not.toHaveBeenCalled();
  });

  // Deactivated, never deleted: the free-month offer reads subscription history.
  it('ends the active subscription and keeps its row', async () => {
    arrange();

    await ClinicService.resetClinicOnboarding(CLINIC_ID, SUPER_ADMIN_ID, {
      password: 'right',
    });

    expect(updateSets).toContainEqual(
      expect.objectContaining({
        active: false,
        autoRenew: false,
        cancellationReason: 'Onboarding reset by super admin',
      })
    );
    expect(txDelete).not.toHaveBeenCalled();
    // Back on the free tier a new signup starts from, so they pick a plan again.
    expect(assignFreePlan).toHaveBeenCalledWith(CLINIC_ID);
  });

  it('records the audit row and ends the owner session', async () => {
    arrange();

    await ClinicService.resetClinicOnboarding(CLINIC_ID, SUPER_ADMIN_ID, {
      password: 'right',
      reason: 'Duplicate signup',
    });

    // resetAt must be written here rather than by the column default, which
    // would record the DB's IST wall clock against UTC updatedAt values.
    expect(auditInsert).toHaveBeenCalledWith({
      clinicId: CLINIC_ID,
      performedBy: SUPER_ADMIN_ID,
      reason: 'Duplicate signup',
      resetAt: expect.any(Date),
    });
    expect(realtimeBus.notifySessionInvalidated).toHaveBeenCalledWith(
      OWNER_ID,
      'ONBOARDING_RESET'
    );
  });

  // Delete shares the password gate and wiring, so it rides on the same arrange().
  it('deleteClinic soft-deletes: Inactive, owner blocked, plan ended, no rows removed', async () => {
    arrange(undefined, [{ id: 'appt-1' }]);
    const logActivity = jest
      .spyOn(AppointmentActivityHistoryService, 'logActivity')
      .mockResolvedValue(undefined);

    await ClinicService.deleteClinic(CLINIC_ID, SUPER_ADMIN_ID, {
      password: 'right',
      reason: 'Closed down',
    });

    // Every cancelled appointment gets the same audit entry as a manual cancel.
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'appt-1',
        action: 'CANCELLED',
        performedBy: SUPER_ADMIN_ID,
      })
    );
    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'Inactive',
        deletedAt: expect.any(Date),
        deletedBy: SUPER_ADMIN_ID,
        deleteReason: 'Closed down',
      })
    );
    expect(updateSets[1]).toEqual(
      expect.objectContaining({ userStatus: 'Inactive' })
    );
    expect(updateSets[2]).toEqual(
      expect.objectContaining({ active: false, autoRenew: false })
    );
    expect(updateSets[3]).toEqual(
      expect.objectContaining({
        appointmentStatus: 'Cancelled',
        reReasonForCancellation: 'Clinic closed',
      })
    );
    expect(txDelete).not.toHaveBeenCalled();
    expect(realtimeBus.notifySessionInvalidated).toHaveBeenCalledWith(
      'staff-1',
      'CLINIC_DELETED'
    );
  });

  // The regression that matters: a restore must never reactivate (or unblock) a clinic.
  it('restoreClinic brings the clinic and owner back as Inactive, never Active', async () => {
    arrange();

    await ClinicService.restoreClinic(CLINIC_ID, SUPER_ADMIN_ID, {
      password: 'right',
    });

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'Inactive',
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      })
    );
    expect(updateSets[1]).toEqual(
      expect.objectContaining({ userStatus: 'Inactive' })
    );
    expect(assignFreePlan).toHaveBeenCalledWith(CLINIC_ID);
    expect(txDelete).not.toHaveBeenCalled();
  });

  it('deleteClinic rejects a wrong password without writing anything', async () => {
    (comparePassword as jest.Mock).mockResolvedValue(false);
    (database.select as jest.Mock).mockReturnValueOnce(
      createChain([{ password: 'hashed' }])
    );

    await expect(
      ClinicService.deleteClinic(CLINIC_ID, SUPER_ADMIN_ID, { password: 'x' })
    ).rejects.toThrow('Password confirmation failed');

    expect(database.transaction).not.toHaveBeenCalled();
  });
});
