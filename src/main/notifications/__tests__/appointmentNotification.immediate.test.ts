// Booking message: WhatsApp only, and only when the clinic has WhatsApp on.
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

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { AppointmentNotificationService } from '../services/appointmentNotification.service';
import { envConfig } from '../../../utils/envConfig';

const context = (whatsappEnabled: boolean) => ({
  patientName: 'Asha',
  doctorName: 'Dr. Rajesh Kumar',
  clinicId: 'clinic-1',
  patientMobile: '9876543210',
  clinicName: 'Apollo',
  smsEnabled: false,
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

  it('queues one appointmentBooked WhatsApp', async () => {
    getNotificationContext.mockResolvedValue(context(true));

    await send();

    expect(enqueueWhatsAppTemplate).toHaveBeenCalledTimes(1);
    expect(enqueueWhatsAppTemplate).toHaveBeenCalledWith(
      '+919876543210',
      expect.objectContaining({ key: 'appointmentBooked' }),
      { clinicId: 'clinic-1', appointmentId: 'appt-1' }
    );
  });

  it('sends nothing when the clinic has WhatsApp off', async () => {
    getNotificationContext.mockResolvedValue(context(false));

    await send();

    expect(enqueueWhatsAppTemplate).not.toHaveBeenCalled();
  });
});
