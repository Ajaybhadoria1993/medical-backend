// PacksService: add and edit with who and why; 409 on a duplicate size, 404 on an unknown pack; seeding is rerun-safe.
const insertReturning = jest.fn();
const insertValues = jest.fn((_row: unknown) => ({
  returning: insertReturning,
}));
const updateReturning = jest.fn();
const updateSet = jest.fn((_row: unknown) => ({
  where: () => ({ returning: updateReturning }),
}));
const selectLimit = jest.fn();
jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    insert: () => ({ values: (row: unknown) => insertValues(row) }),
    update: () => ({ set: (row: unknown) => updateSet(row) }),
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  },
}));

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { PacksService } from '../services/core/packs.service';

const duplicate = Object.assign(new Error('duplicate'), { code: '23505' });

beforeEach(() => jest.clearAllMocks());

it('adds a pack with who and why', async () => {
  insertReturning.mockResolvedValue([{ id: 'p1' }]);
  const body = {
    credits: 2000,
    priceInr: '449.00',
    sortOrder: 1,
    reason: 'Mid-size pack',
  };

  await PacksService.create('whatsapp', body, 'sa1');

  expect(insertValues).toHaveBeenCalledWith({
    creditType: 'whatsapp',
    ...body,
    changedBy: 'sa1',
  });
});

it('rejects a second pack of the same size with 409', async () => {
  insertReturning.mockRejectedValue(duplicate);
  await expect(
    PacksService.create(
      'whatsapp',
      { credits: 250, priceInr: '75.00', sortOrder: 0, reason: 'Again' },
      'sa1'
    )
  ).rejects.toMatchObject({ status: 409 });
});

it('switches a pack off and records who', async () => {
  updateReturning.mockResolvedValue([{ id: 'p1', active: false }]);

  await PacksService.update(
    'whatsapp',
    'p1',
    { active: false, reason: 'Retired' },
    'sa1'
  );

  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({
      active: false,
      reason: 'Retired',
      changedBy: 'sa1',
      updatedAt: expect.any(Date),
    })
  );
});

it('returns 404 for an unknown pack, 409 for a size clash', async () => {
  updateReturning.mockResolvedValueOnce([]);
  await expect(
    PacksService.update(
      'whatsapp',
      'nope',
      { active: true, reason: 'Back on' },
      'sa1'
    )
  ).rejects.toMatchObject({ status: 404 });

  updateReturning.mockRejectedValueOnce(duplicate);
  await expect(
    PacksService.update(
      'whatsapp',
      'p1',
      { credits: 250, reason: 'Resize' },
      'sa1'
    )
  ).rejects.toMatchObject({ status: 409 });
});

it('seeds the three default packs once, then skips', async () => {
  selectLimit.mockResolvedValueOnce([]);
  insertValues.mockReturnValueOnce(Promise.resolve() as never);
  expect(await PacksService.seedDefaults()).toBe(1);
  expect(insertValues).toHaveBeenCalledWith([
    expect.objectContaining({
      credits: 250,
      priceInr: '75.00',
      sortOrder: 0,
      changedBy: null,
    }),
    expect.objectContaining({
      credits: 1000,
      priceInr: '249.00',
      sortOrder: 1,
    }),
    expect.objectContaining({
      credits: 5000,
      priceInr: '999.00',
      sortOrder: 2,
    }),
  ]);

  selectLimit.mockResolvedValueOnce([{ id: 'p1' }]);
  expect(await PacksService.seedDefaults()).toBe(0);
});
