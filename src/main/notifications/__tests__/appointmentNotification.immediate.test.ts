// Booking message: WhatsApp only. The old "Appointment Booked" SMS is gone, so
// a clinic's SMS switch no longer sends anything on its own.
const getNotificationContext = jest.fn();
jest.mock('../models/appointmentParticipants.model', () => ({
  getNotificationContext: (...args: unknown[]) =>
    getNotificationContext(...args),
}));

const enqueueWhatsAppTemplate = jest.fn();
jest.mock('../queues/whatsappOutbox.queue', () => ({
  enqueueWhatsAppTemplate: (...args: unknown[]) =>
    enqueueWhatsAppTemplate(...args),
}));

const sendTransactionalSms = jest.fn();
jest.mock('../services/sns.service', () => ({
  SnsNotificationService: {
    sendTransactionalSms: (...args: unknown[]) => sendTransactionalSms(...args),
  },
}));

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { AppointmentNotificationService } from '../services/appointmentNotification.service';
import { envConfig } from '../../../utils/envConfig';

const context = (smsEnabled: boolean, whatsappEnabled: boolean) => ({
  patientName: 'Asha',
  doctorName: 'Dr. Rajesh Kumar',
  clinicId: 'clinic-1',
  patientMobile: '9876543210',
  clinicName: 'Apollo',
  smsEnabled,
  whatsappEnabled,
  appointmentDate: new Date('2026-07-10T00:00:00Z'),
  appointmentTime: '10:00',
  tokenNo: 7,
});

const send = () =>
  AppointmentNotificationService.sendImmediateNotification(
    'appt-1',
    new Date('2026-07-10T00:00:00Z'),
    '10:00',
    7
  );

describe('AppointmentNotificationService.sendImmediateNotification', () => {
  const forceEnabled = envConfig.WHATSAPP_FORCE_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    envConfig.WHATSAPP_FORCE_ENABLED = false;
    enqueueWhatsAppTemplate.mockResolvedValue(undefined);
  });

  afterAll(() => {
    envConfig.WHATSAPP_FORCE_ENABLED = forceEnabled;
  });

  it('queues one appointmentBooked WhatsApp and never sends an SMS', async () => {
    getNotificationContext.mockResolvedValue(context(true, true));

    await send();

    expect(enqueueWhatsAppTemplate).toHaveBeenCalledTimes(1);
    expect(enqueueWhatsAppTemplate).toHaveBeenCalledWith(
      '+919876543210',
      expect.objectContaining({ key: 'appointmentBooked' }),
      { clinicId: 'clinic-1', appointmentId: 'appt-1' }
    );
    expect(sendTransactionalSms).not.toHaveBeenCalled();
  });

  it('sends nothing when the clinic has WhatsApp off, even with SMS on', async () => {
    getNotificationContext.mockResolvedValue(context(true, false));

    await send();

    expect(enqueueWhatsAppTemplate).not.toHaveBeenCalled();
    expect(sendTransactionalSms).not.toHaveBeenCalled();
  });
});
