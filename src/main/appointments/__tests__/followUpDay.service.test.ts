import { FollowUpDayService } from '../services/followUpDay.service';
import { getISTDateString } from '../../../utils/istDateTime';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/cache.util', () => ({
  ...jest.requireActual('../../../utils/cache.util'),
  getOrSetCache: (_key: string, _ttl: number, loader: () => unknown) =>
    loader(),
}));

// Follow-up day check: leave, off and past days get the first later working day.
const day = (n: number) => {
  const d = new Date(`${getISTDateString()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const S = FollowUpDayService as any;

const setup = (schedule: Record<string, 'leave' | 'off'>, active = true) => {
  const scheduleDay = jest
    .spyOn(S, 'scheduleDay')
    .mockImplementation(
      async (...a: unknown[]) => schedule[a[2] as string] ?? 'ok'
    );
  jest.spyOn(S, 'isActive').mockResolvedValue(active);
  jest.spyOn(S, 'patientBooking').mockResolvedValue(null);
  return scheduleDay;
};

afterEach(() => jest.restoreAllMocks());

describe('FollowUpDayService.check', () => {
  it('suggests the first later working day', async () => {
    setup({ [day(3)]: 'leave', [day(4)]: 'off' });
    const r = await FollowUpDayService.check('c', 'd', day(3));
    expect(r).toMatchObject({ status: 'leave', nextGoodDay: day(5) });
  });

  it('leaves a working day without a suggestion', async () => {
    setup({});
    const r = await FollowUpDayService.check('c', 'd', day(2));
    expect(r).toMatchObject({ status: 'ok', nextGoodDay: null });
  });

  it('suggests from today for a past pick', async () => {
    setup({});
    const r = await FollowUpDayService.check('c', 'd', day(-2));
    expect(r).toMatchObject({ status: 'past', nextGoodDay: day(0) });
  });

  it('suggests nothing for an inactive doctor', async () => {
    setup({ [day(2)]: 'leave' }, false);
    const r = await FollowUpDayService.check('c', 'd', day(2));
    expect(r).toMatchObject({ status: 'inactive', nextGoodDay: null });
  });

  it('never reads the schedule for a past day', async () => {
    const scheduleDay = setup({});
    await FollowUpDayService.days('c', 'd', day(-3), day(-1));
    expect(scheduleDay).not.toHaveBeenCalled();
  });
});
