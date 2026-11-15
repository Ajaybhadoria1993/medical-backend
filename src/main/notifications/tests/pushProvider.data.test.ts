import { PushProvider } from '../providers/push.provider';
import { SnsNotificationService } from '../services/sns.service';

jest.mock('../services/sns.service', () => ({
  SnsNotificationService: { sendPushNotification: jest.fn() },
}));

describe('PushProvider data', () => {
  it('sends event, data and metadata as strings, dropping nulls', async () => {
    await new PushProvider().send({
      recipient: { userId: 'u1' },
      event: 'running_late',
      channels: ['push'],
      title: 't',
      body: 'b',
      data: { appointmentId: 'a1', delayMinutes: 76, originalTime: null },
      metadata: { doctorId: 'd1' },
    });

    expect(SnsNotificationService.sendPushNotification).toHaveBeenCalledWith(
      'u1',
      't',
      'b',
      {
        event: 'running_late',
        appointmentId: 'a1',
        delayMinutes: '76',
        doctorId: 'd1',
      }
    );
  });
});
