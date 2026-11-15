import { SubscriptionActivityService } from '../services/subscriptionActivity.service';
import { database } from '../../../configurations/dbConnection';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');

describe('SubscriptionActivityService.recordTrialStarted', () => {
  let inserted: Record<string, unknown> | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    inserted = undefined;
    (database.insert as jest.Mock).mockReturnValue({
      values: jest.fn(async (row: Record<string, unknown>) => {
        inserted = row;
      }),
    });
  });

  it('writes a free_trial_started entry the timeline can show', async () => {
    await SubscriptionActivityService.recordTrialStarted({
      clinicId: 'clinic-1',
      planId: 'plan-1',
      planName: 'Clinic Plan',
      subscriptionId: 'sub-1',
      trialDays: 30,
      // 02 Dec 2026, 11:51 UTC = 17:21 IST
      expiresAt: new Date('2026-12-02T11:51:00.000Z'),
      currency: 'INR',
      actorUserId: 'user-1',
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        clinicId: 'clinic-1',
        type: 'free_trial_started',
        title: 'Free trial started: Clinic Plan',
        description: '30-day free trial. Ends on 02 Dec 2026.',
        // A trial moves no money.
        amount: null,
        actorUserId: 'user-1',
        metadata: expect.objectContaining({
          subscriptionId: 'sub-1',
          planId: 'plan-1',
          trialDays: 30,
        }),
      })
    );
  });

  it('shows the end date on the IST calendar, not the server clock', async () => {
    // 20:00 UTC on 01 Dec is already 02 Dec in India.
    await SubscriptionActivityService.recordTrialStarted({
      clinicId: 'clinic-1',
      planId: 'plan-1',
      planName: 'Clinic Plan',
      trialDays: 30,
      expiresAt: new Date('2026-12-01T20:00:00.000Z'),
    });

    expect(inserted?.description).toBe(
      '30-day free trial. Ends on 02 Dec 2026.'
    );
  });

  it('still reads sensibly when the trial length or end is unknown', async () => {
    await SubscriptionActivityService.recordTrialStarted({
      clinicId: 'clinic-1',
      planId: 'plan-1',
      planName: 'Clinic Plan',
    });

    expect(inserted?.description).toBe('Free trial is active.');
  });

  // The entry is a log line: losing it must never break activating the trial.
  it('never throws when the write fails', async () => {
    (database.insert as jest.Mock).mockReturnValue({
      values: jest.fn(async () => {
        throw new Error('db down');
      }),
    });

    await expect(
      SubscriptionActivityService.recordTrialStarted({
        clinicId: 'clinic-1',
        planId: 'plan-1',
        planName: 'Clinic Plan',
        trialDays: 30,
      })
    ).resolves.toBeUndefined();
  });
});
