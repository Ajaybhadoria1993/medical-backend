// Super Admin's block wins over the clinic, hides the message, and keeps the clinic's hidden choice.
const cached: Record<string, unknown> = {};
jest.mock('../../../utils/cache.util', () => ({
  CacheKeys: {
    whatsappMessagePrefs: (type: string, id: string) => `prefs:${type}:${id}`,
    whatsappPlatformOffs: () => 'platform-offs',
  },
  getOrSetCache: async (key: string) => cached[key],
  invalidateCache: jest.fn(),
}));

const saved = jest.fn();
const dbOverrides = jest.fn();
jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ overrides: dbOverrides() }],
        }),
      }),
    }),
    insert: () => ({
      values: (row: unknown) => ({
        onConflictDoUpdate: async () => saved(row),
      }),
    }),
  },
}));

import { WhatsAppMessagePrefsService } from '../services/whatsappMessagePrefs.service';

const clinic = { type: 'clinic' as const, id: 'c1' };

beforeEach(() => {
  saved.mockReset();
  cached['platform-offs'] = ['appointmentFollowUp'];
  cached['prefs:clinic:c1'] = { appointmentFollowUp: false };
});

it('treats a message Super Admin turned off as off, whatever the clinic chose', async () => {
  cached['prefs:clinic:c1'] = {};
  await expect(
    WhatsAppMessagePrefsService.isMessageOff(clinic, 'appointmentFollowUp')
  ).resolves.toBe(true);
  await expect(
    WhatsAppMessagePrefsService.isMessageOff(clinic, 'appointmentBooked')
  ).resolves.toBe(false);
});

it('hides a message Super Admin turned off from the clinic list', async () => {
  const keys = (await WhatsAppMessagePrefsService.listClinicMessages('c1')).map(
    (m) => m.key
  );
  expect(keys).not.toContain('appointmentFollowUp');
  expect(keys).toContain('appointmentBooked');
});

it("keeps the clinic's choice for a hidden message when it saves the shown ones", async () => {
  // Cache says nothing is off; the save must still use the database's saved choice.
  cached['prefs:clinic:c1'] = {};
  dbOverrides.mockReturnValue({ appointmentFollowUp: false });
  await WhatsAppMessagePrefsService.saveClinicMessages(
    'c1',
    { appointmentCompleted: false, appointmentBooked: true },
    'admin-1'
  );
  expect(saved).toHaveBeenCalledWith(
    expect.objectContaining({
      overrides: { appointmentCompleted: false, appointmentFollowUp: false },
    })
  );
});
