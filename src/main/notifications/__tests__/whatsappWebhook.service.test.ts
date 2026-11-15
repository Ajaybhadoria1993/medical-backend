// Webhook statuses: each one is handed to credits; a failure is logged without the patient's number.
const recordDeliveryStatus = jest.fn();
jest.mock('../../credits', () => ({
  recordDeliveryStatus: (...args: unknown[]) => recordDeliveryStatus(...args),
}));

const logError = jest.fn();
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: (...args: unknown[]) => logError(...args),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

import { WhatsAppWebhookService } from '../services/whatsappWebhook.service';

const payload = (statuses: unknown[]) => ({
  entry: [{ changes: [{ value: { statuses } }] }],
});

beforeEach(() => jest.clearAllMocks());

it('hands every status to credits with its billable flag', () => {
  WhatsAppWebhookService.processDeliveryStatusPayload(
    payload([
      {
        id: 'wamid.1',
        status: 'delivered',
        pricing: { billable: true, category: 'utility' },
      },
      { id: 'wamid.2', status: 'read' },
    ])
  );

  expect(recordDeliveryStatus).toHaveBeenNthCalledWith(1, {
    messageId: 'wamid.1',
    status: 'delivered',
    billable: true,
  });
  expect(recordDeliveryStatus).toHaveBeenNthCalledWith(2, {
    messageId: 'wamid.2',
    status: 'read',
    billable: undefined,
  });
});

it('logs a failure without the recipient phone number', () => {
  WhatsAppWebhookService.processDeliveryStatusPayload(
    payload([
      {
        id: 'wamid.3',
        status: 'failed',
        recipient_id: '919876543210',
        errors: [{ title: 'Message undeliverable' }],
      },
    ])
  );

  expect(logError).toHaveBeenCalledWith(expect.stringContaining('wamid.3'));
  expect(logError.mock.calls[0][0]).not.toContain('919876543210');
  expect(recordDeliveryStatus).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: 'wamid.3', status: 'failed' })
  );
});

it('skips malformed statuses and empty payloads', () => {
  WhatsAppWebhookService.processDeliveryStatusPayload(
    payload([{ status: 'sent' }])
  );
  WhatsAppWebhookService.processDeliveryStatusPayload({});
  expect(recordDeliveryStatus).not.toHaveBeenCalled();
});
