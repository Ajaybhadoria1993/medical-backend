// ClinicCreditsService: Super Admin actions only on a clinic that exists, with the actor recorded.
const grant = jest.fn();
const remove = jest.fn();
jest.mock('../services/core/grants.service', () => ({
  GrantsService: {
    grant: (...args: unknown[]) => grant(...args),
    remove: (...args: unknown[]) => remove(...args),
    balance: async () => 12,
    nextExpiring: async () => null,
    list: async () => ({ items: [], total: 0, pageNumber: 1, pageSize: 25 }),
  },
}));

import { registerClinicPort } from '..';
import { ClinicCreditsService } from '../services/core/clinicCredits.service';

const getClinicNames = jest.fn();
registerClinicPort({ getClinicNames, getUserNames: jest.fn() });

const body = {
  creditType: 'whatsapp' as const,
  credits: 50,
  reason: 'Goodwill credit',
};

beforeEach(() => {
  jest.clearAllMocks();
  getClinicNames.mockResolvedValue(new Map([['c1', 'Sunrise Clinic']]));
});

it('grants for an existing clinic, recording the Super Admin', async () => {
  await ClinicCreditsService.grant('c1', body, 'sa1');
  expect(grant).toHaveBeenCalledWith({
    clinicId: 'c1',
    ...body,
    actorUserId: 'sa1',
  });
});

it('removes for an existing clinic, recording the Super Admin', async () => {
  await ClinicCreditsService.remove('c1', body, 'sa1');
  expect(remove).toHaveBeenCalledWith({
    clinicId: 'c1',
    ...body,
    actorUserId: 'sa1',
  });
});

it('returns 404 for an unknown clinic and changes nothing', async () => {
  getClinicNames.mockResolvedValue(new Map());
  await expect(
    ClinicCreditsService.grant('nope', body, 'sa1')
  ).rejects.toMatchObject({
    status: 404,
  });
  expect(grant).not.toHaveBeenCalled();
});

it('shows the clinic name with its balance and history', async () => {
  const overview = await ClinicCreditsService.overview('c1', {
    creditType: 'whatsapp',
    pageNumber: 1,
    pageSize: 25,
  });
  expect(overview).toMatchObject({
    clinicId: 'c1',
    clinicName: 'Sunrise Clinic',
    balance: 12,
  });
});
