import { database } from '../../../configurations/dbConnection';
import { TrialOverrideService } from '../services/core/trialOverride.service';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');

const select = database.select as jest.Mock;

const rowsFrom = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
});

describe('TrialOverrideService.daysFor', () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the clinic's own trial length", async () => {
    select.mockReturnValue(rowsFrom([{ days: 90 }]));
    await expect(TrialOverrideService.daysFor('clinic-1')).resolves.toBe(90);
  });

  it('returns null when the clinic has none, so the plan default applies', async () => {
    select.mockReturnValue(rowsFrom([]));
    await expect(TrialOverrideService.daysFor('clinic-1')).resolves.toBeNull();
  });

  it('fails open when the lookup fails, e.g. the table is not migrated yet', async () => {
    select.mockImplementation(() => {
      throw new Error('relation "clinic_trial_overrides" does not exist');
    });
    await expect(TrialOverrideService.daysFor('clinic-1')).resolves.toBeNull();
  });
});
