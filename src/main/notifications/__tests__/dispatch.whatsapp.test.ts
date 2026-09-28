// Registry WhatsApp must match the legacy senders exactly: one sender per
// template (WHATSAPP_VIA_REGISTRY), and no bell/performer rule may drop it.

const env = {
  WHATSAPP_VIA_REGISTRY: new Set<string>(),
  WHATSAPP_FORCE_ENABLED: false,
};
jest.mock('../../../utils/envConfig', () => ({ envConfig: env }));

const enqueue = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../queues/whatsappOutbox.queue', () => ({
  enqueueWhatsAppTemplate: (...args: unknown[]) => enqueue(...args),
}));
jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../services/sns.service', () => ({ SnsNotificationService: {} }));
jest.mock('../killswitch/killSwitch', () => ({
  isLegacyInAppAllowed: () => true,
}));
jest.mock('../preferences/notificationPreferences.utils', () => ({
  getUserNotificationPreferences: jest.fn(),
}));

const directory = {
  getClinicChannelSettings: jest.fn(async () => ({
    smsEnabled: false,
    whatsappEnabled: true,
  })),
  getUserMobiles: jest.fn(
    async (ids: string[]) =>
      new Map(
        ids.filter((id) => id !== 'no-mobile').map((id) => [id, '9876543210'])
      )
  ),
};
jest.mock('../ports', () => ({
  getDirectoryPort: () => directory,
  getEmitPort: () => ({ emitToRoom: jest.fn() }),
}));

let sendMessage = true;
// No audiences: proves WhatsApp does not ride on a bell row being inserted.
const event = {
  audiences: [],
  tenant: () => ({ type: 'clinic', id: 'c1' }),
  whatsapp: {
    // The performer is included on purpose — self-booked patients get it today.
    recipients: () => ['pat-1', 'pat-1', 'no-mobile'],
    message: () =>
      sendMessage
        ? {
            key: 'appointmentBooked',
            params: {
              patientName: 'Sunil',
              doctorName: 'Anita Mehta',
              clinicName: 'Sunrise Clinic',
              date: '12 Sep 2026',
              timeOrToken: 'Time: 4:30 PM',
            },
          }
        : null,
  },
};
jest.mock('../registry', () => ({
  resolveEventKey: (key: string) => key,
  getEvent: () => event,
}));

import { dispatch } from '../services/dispatch.service';

const run = () =>
  dispatch(
    {
      eventKey: 'test.whatsapp',
      ctx: { appointmentId: 'a1', performerUserId: 'pat-1' },
    },
    'job7'
  );

beforeEach(() => {
  env.WHATSAPP_VIA_REGISTRY = new Set(['appointmentBooked']);
  env.WHATSAPP_FORCE_ENABLED = false;
  directory.getClinicChannelSettings.mockResolvedValue({
    smsEnabled: false,
    whatsappEnabled: true,
  });
  sendMessage = true;
  enqueue.mockClear();
});

it('sends nothing while the template is not switched to the registry', async () => {
  env.WHATSAPP_VIA_REGISTRY = new Set();
  await run();
  expect(enqueue).not.toHaveBeenCalled();
});

it('sends once per recipient, performer included, with no bell row', async () => {
  await run();
  expect(enqueue).toHaveBeenCalledTimes(1); // de-duped; no-mobile skipped
  const [, message, appointmentId, jobId] = enqueue.mock.calls[0];
  expect((message as { key: string }).key).toBe('appointmentBooked');
  expect(appointmentId).toBe('a1');
  expect(jobId).toBe('wa-job7-pat-1'); // stable, so a job retry cannot resend
});

it('honours the clinic opt-out, and WHATSAPP_FORCE_ENABLED overrides it', async () => {
  directory.getClinicChannelSettings.mockResolvedValue({
    smsEnabled: false,
    whatsappEnabled: false,
  });
  await run();
  expect(enqueue).not.toHaveBeenCalled();

  env.WHATSAPP_FORCE_ENABLED = true;
  await run();
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it('sends nothing when the message builder declines (legacy early return)', async () => {
  sendMessage = false;
  await run();
  expect(enqueue).not.toHaveBeenCalled();
});
