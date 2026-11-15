// Outbox worker: switched-off messages skipped, credits checked before sending,
// recorded once after Meta accepts, for a known clinic.
import { Worker } from 'bullmq';

const send = jest.fn();
jest.mock('../../../utils/smsClient', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => send(...args),
}));

const checkSend = jest.fn();
const recordSent = jest.fn();
jest.mock('../../credits', () => ({
  checkSend: (...args: unknown[]) => checkSend(...args),
  recordSent: (...args: unknown[]) => recordSent(...args),
}));

const isMessageOff = jest.fn();
jest.mock('../services/whatsappMessagePrefs.service', () => ({
  WhatsAppMessagePrefsService: {
    isMessageOff: (...args: unknown[]) => isMessageOff(...args),
  },
}));

const getClinicChannelSettings = jest.fn();
jest.mock('../ports', () => ({
  getDirectoryPort: () => ({
    getClinicChannelSettings: (...args: unknown[]) =>
      getClinicChannelSettings(...args),
  }),
}));

const warn = jest.fn();
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: (...args: unknown[]) => warn(...args),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import '../queues/whatsappOutbox.queue';

// Captured by queue name: several modules build a Worker at import (WORKFLOW §6).
const processor = (Worker as unknown as jest.Mock).mock.calls.find(
  (call) => call[0] === 'whatsapp-outbox'
)?.[1] as (job: unknown) => Promise<void>;

const job = (clinicId?: string | null, key = 'appointmentBooked') => ({
  data: {
    to: '+919876543210',
    message: { key, params: {} },
    clinicId,
  },
});

beforeEach(() => {
  send.mockReset();
  recordSent.mockReset();
  warn.mockReset();
  checkSend.mockReset().mockResolvedValue({ allowed: true });
  isMessageOff.mockReset().mockResolvedValue(false);
  getClinicChannelSettings
    .mockReset()
    .mockResolvedValue({ whatsappEnabled: true, smsEnabled: false });
});

it('skips every clinic message when the main WhatsApp switch is off or unset', async () => {
  getClinicChannelSettings.mockResolvedValueOnce({ whatsappEnabled: false });
  await processor(job('c1', 'labReportReady'));
  getClinicChannelSettings.mockResolvedValueOnce(null);
  await processor(job('c1'));

  expect(checkSend).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it('skips a message the clinic switched off, before any credit check', async () => {
  isMessageOff.mockResolvedValue(true);
  await processor(job('c1', 'appointmentCompleted'));

  expect(isMessageOff).toHaveBeenCalledWith(
    { type: 'clinic', id: 'c1' },
    'appointmentCompleted'
  );
  expect(checkSend).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it('skips per-message choices for lab messages and all checks without a clinic', async () => {
  send.mockResolvedValue('wamid.1');
  await processor(job('c1', 'labReportReady'));
  await processor(job(null));

  expect(isMessageOff).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(2);
});

it('checks the clinic before sending', async () => {
  send.mockResolvedValue('wamid.1');
  await processor(job('c1'));
  expect(checkSend).toHaveBeenCalledWith('c1', 'whatsapp', 'appointmentBooked');
});

it('sends nothing and records nothing when the clinic has nothing left', async () => {
  checkSend.mockResolvedValue({ allowed: false });
  await expect(processor(job('c1'))).resolves.toBeUndefined();

  expect(send).not.toHaveBeenCalled();
  expect(recordSent).not.toHaveBeenCalled();
});

it('records the accepted message against its clinic', async () => {
  send.mockResolvedValue('wamid.1');
  await processor(job('c1'));

  expect(recordSent).toHaveBeenCalledTimes(1);
  expect(recordSent).toHaveBeenCalledWith({
    clinicId: 'c1',
    channel: 'whatsapp',
    messageId: 'wamid.1',
    templateKey: 'appointmentBooked',
  });
});

it('records nothing when sending is disabled (no message id)', async () => {
  send.mockResolvedValue(undefined);
  await processor(job('c1'));
  expect(recordSent).not.toHaveBeenCalled();
});

it('sends but does not count a message with no clinic, and says so', async () => {
  send.mockResolvedValue('wamid.2');
  await processor(job(null));

  expect(checkSend).not.toHaveBeenCalled();
  expect(recordSent).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('wamid.2'));
});

it('records nothing when Meta fails, so a retry is the only send', async () => {
  send.mockRejectedValue(new Error('socket hang up'));
  await expect(processor(job('c1'))).rejects.toThrow(
    'Transient WhatsApp failure'
  );
  expect(recordSent).not.toHaveBeenCalled();
});
