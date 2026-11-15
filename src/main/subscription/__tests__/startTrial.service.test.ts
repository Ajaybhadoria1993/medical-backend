import { database } from '../../../configurations/dbConnection';
import { FirstPlanService } from '../services/core/firstPlan.service';
import { LimitationService } from '../services/limitation.service';
import { SubscriptionActivityService } from '../services/subscriptionActivity.service';
import { subscriptionNotify } from '../notify/subscriptionNotify';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('../services/limitation.service');
jest.mock('../services/subscriptionActivity.service');
jest.mock('../notify/subscriptionNotify', () => ({
  subscriptionNotify: jest.fn(),
}));
const mockIsApproved = jest.fn();
jest.mock('../ports', () => ({
  getClinicPort: () => ({ isApproved: mockIsApproved }),
}));
const mockClinicTrialDays = jest.fn();
jest.mock('../services/core/trialOverride.service', () => ({
  TrialOverrideService: { daysFor: (...args: unknown[]) => mockClinicTrialDays(...args) },
}));

const svc = FirstPlanService as unknown as Record<string, jest.Mock>;
const trialPlan = {
  plan: { id: 'plan-1', name: 'Trial', trialDays: 14 },
  version: { id: 'ver-1' },
};

describe('FirstPlanService.startTrial', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(svc, 'planWithVersion').mockResolvedValue(trialPlan);
    mockIsApproved.mockResolvedValue(true);
    mockClinicTrialDays.mockResolvedValue(null);
  });

  it("gives the clinic's own trial length when Super Admin set one", async () => {
    mockClinicTrialDays.mockResolvedValue(90);
    jest
      .spyOn(svc, 'trialFacts')
      .mockResolvedValue({ current: undefined, onFree: true, hadTrial: false });
    const insert = {
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([{ id: 'sub-1' }]),
    };
    (database.transaction as jest.Mock).mockImplementation((fn) =>
      fn({ insert: () => insert })
    );

    const out = await FirstPlanService.startTrial('clinic', 'clinic-1', 'u-1');

    expect(mockClinicTrialDays).toHaveBeenCalledWith('clinic-1');
    expect(out.trialDays).toBe(90);
    const row = insert.values.mock.calls[0][0];
    expect(row.currentPeriodEnd - row.currentPeriodStart).toBe(90 * 86400000);
  });

  it('can offer a trial even when the plan itself has no trial days, if the clinic has its own', async () => {
    mockClinicTrialDays.mockResolvedValue(30);
    svc.planWithVersion.mockResolvedValue({
      plan: { id: 'plan-1', name: 'Trial', trialDays: null },
      version: { id: 'ver-1' },
    });
    jest
      .spyOn(svc, 'trialFacts')
      .mockResolvedValue({ current: undefined, onFree: true, hadTrial: false });
    (database.transaction as jest.Mock).mockImplementation((fn) =>
      fn({
        insert: () => ({
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{ id: 'sub-1' }]),
        }),
      })
    );

    await expect(
      FirstPlanService.startTrial('clinic', 'clinic-1', null)
    ).resolves.toMatchObject({ trialDays: 30 });
  });

  it('refuses a clinic still waiting for Super Admin approval with 403', async () => {
    mockIsApproved.mockResolvedValue(false);

    await expect(
      FirstPlanService.startTrial('clinic', 'clinic-1', 'u-1')
    ).rejects.toMatchObject({ status: 403 });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('starts a 14-day trial and clears the plan cache', async () => {
    jest
      .spyOn(svc, 'trialFacts')
      .mockResolvedValue({ current: undefined, onFree: true, hadTrial: false });
    const insert = {
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([{ id: 'sub-1' }]),
    };
    (database.transaction as jest.Mock).mockImplementation((fn) =>
      fn({ insert: () => insert })
    );

    const out = await FirstPlanService.startTrial('clinic', 'clinic-1', 'u-1');

    expect(out).toMatchObject({ trial: { id: 'sub-1' }, trialDays: 14 });
    const row = insert.values.mock.calls[0][0];
    expect(row).toMatchObject({ status: 'trialing', isTrial: true });
    expect(row.currentPeriodEnd - row.currentPeriodStart).toBe(14 * 86400000);
    expect(LimitationService.invalidateClinicCache).toHaveBeenCalledWith(
      'clinic-1'
    );
    expect(SubscriptionActivityService.recordTrialStarted).toHaveBeenCalled();
    expect(subscriptionNotify).toHaveBeenCalledWith(
      'subscription.trial_started',
      expect.objectContaining({ clinicId: 'clinic-1', trialDays: 14 }),
      'sub-1'
    );
  });

  it('refuses a second trial with 409', async () => {
    jest
      .spyOn(svc, 'trialFacts')
      .mockResolvedValue({ current: undefined, onFree: true, hadTrial: true });
    (database.transaction as jest.Mock).mockImplementation((fn) => fn({}));

    await expect(
      FirstPlanService.startTrial('clinic', 'clinic-1', null)
    ).rejects.toMatchObject({ status: 409 });
    expect(LimitationService.invalidateClinicCache).not.toHaveBeenCalled();
  });

  it('turns a double click that lost the race into 409, not 500', async () => {
    (database.transaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505' })
    );

    await expect(
      FirstPlanService.startTrial('clinic', 'clinic-1', null)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('answers 503 when no trial plan is set up', async () => {
    svc.planWithVersion.mockResolvedValue({
      plan: undefined,
      version: undefined,
    });

    await expect(
      FirstPlanService.startTrial('clinic', 'clinic-1', null)
    ).rejects.toMatchObject({ status: 503 });
    expect(database.transaction).not.toHaveBeenCalled();
  });
});

describe('FirstPlanService trial requests before approval', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('saves a request instead of starting the trial while the clinic is unapproved', async () => {
    mockIsApproved.mockResolvedValue(false);
    jest
      .spyOn(svc, 'trialFacts')
      .mockResolvedValue({ current: undefined, onFree: true, hadTrial: false });
    const start = jest.spyOn(svc, 'startTrial');
    const requestedAt = new Date('2026-11-11T10:00:00Z');
    const insert = {
      values: jest.fn().mockReturnThis(),
      onConflictDoNothing: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([{ requestedAt }]),
    };
    (database.insert as jest.Mock).mockReturnValue(insert);

    const out = await FirstPlanService.requestOrStartTrial(
      'clinic',
      'clinic-1',
      'u-1'
    );

    expect(out).toEqual({ requested: true, requestedAt });
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a request from a clinic that already had its trial', async () => {
    mockIsApproved.mockResolvedValue(false);
    jest
      .spyOn(svc, 'trialFacts')
      .mockResolvedValue({ current: undefined, onFree: true, hadTrial: true });

    await expect(
      FirstPlanService.requestOrStartTrial('clinic', 'clinic-1', 'u-1')
    ).rejects.toMatchObject({ status: 409 });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it('starts nothing on approval when the clinic never asked', async () => {
    jest.spyOn(svc, 'trialRequestedAt').mockResolvedValue(null);
    const start = jest.spyOn(svc, 'startTrial');

    await expect(
      FirstPlanService.startRequestedTrial('clinic-1', null)
    ).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('starts the requested trial on approval and clears the request', async () => {
    jest.spyOn(svc, 'trialRequestedAt').mockResolvedValue(new Date());
    jest.spyOn(svc, 'startTrial').mockResolvedValue({});
    const del = { where: jest.fn().mockResolvedValue(undefined) };
    (database.delete as jest.Mock).mockReturnValue(del);

    await expect(
      FirstPlanService.startRequestedTrial('clinic-1', 'admin-1')
    ).resolves.toBe(true);
    expect(svc.startTrial).toHaveBeenCalledWith(
      'clinic',
      'clinic-1',
      'admin-1'
    );
    expect(del.where).toHaveBeenCalled();
  });
});
