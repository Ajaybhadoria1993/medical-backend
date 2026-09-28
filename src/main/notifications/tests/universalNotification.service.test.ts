import { UniversalNotificationService } from '../services/universalNotification.service';
import { PushProvider } from '../providers/push.provider';
import { EmailProvider } from '../providers/email.provider';
import { SmsProvider } from '../providers/sms.provider';
import { SocketProvider } from '../providers/socket.provider';
import * as dbService from '../services/notifications.service';

import { getUserNotificationPreference } from '../preferences/notificationPreferences.utils';

jest.mock('../providers/push.provider');
jest.mock('../providers/email.provider');
jest.mock('../providers/sms.provider');
jest.mock('../providers/socket.provider');
jest.mock('../services/notifications.service');
jest.mock('../../../app', () => ({
  kafkaManager: null,
  socketManager: null,
}));
jest.mock('../preferences/notificationPreferences.utils', () => ({
  getUserNotificationPreference: jest.fn(),
}));

describe('UniversalNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserNotificationPreference as jest.Mock).mockResolvedValue({
      inApp: true,
      push: true,
    });
  });

  it('should create database entry when userId is present and send via selected channels', async () => {
    const mockDbRecord = { id: 'some-uuid' };
    (dbService.createNotification as jest.Mock).mockResolvedValue(mockDbRecord);

    const options = {
      recipient: {
        userId: 'user-123',
        email: 'test@example.com',
        mobile: '1234567890',
      },
      event: 'test_event',
      channels: ['email', 'sms'] as any[],
      title: 'Hello',
      body: 'World',
    };

    await UniversalNotificationService.send(options);

    // Should create DB record
    expect(dbService.createNotification).toHaveBeenCalledWith({
      userId: 'user-123',
      type: 'test_event',
      title: 'Hello',
      body: 'World',
      data: null,
      metadata: null,
    });

    // Should dispatch to email and SMS providers
    expect(EmailProvider.prototype.send).toHaveBeenCalledWith(options);
    expect(SmsProvider.prototype.send).toHaveBeenCalledWith(options);

    // Should NOT dispatch to push and socket providers
    expect(PushProvider.prototype.send).not.toHaveBeenCalled();
    expect(SocketProvider.prototype.send).not.toHaveBeenCalled();
  });

  it('should NOT create database entry when userId is absent', async () => {
    const options = {
      recipient: {
        email: 'test@example.com',
      },
      event: 'test_event',
      channels: ['email'] as any[],
      title: 'Hello',
      body: 'World',
    };

    await UniversalNotificationService.send(options);

    expect(dbService.createNotification).not.toHaveBeenCalled();
    expect(EmailProvider.prototype.send).toHaveBeenCalledWith(options);
  });

  it('should tolerate provider failures without failing other channels', async () => {
    (EmailProvider.prototype.send as jest.Mock).mockRejectedValue(
      new Error('SMTP failure')
    );

    const options = {
      recipient: {
        email: 'test@example.com',
        mobile: '1234567890',
      },
      event: 'test_event',
      channels: ['email', 'sms'] as any[],
      title: 'Hello',
      body: 'World',
    };

    // Should execute successfully despite SMTP failure
    await expect(
      UniversalNotificationService.send(options)
    ).resolves.not.toThrow();

    expect(EmailProvider.prototype.send).toHaveBeenCalled();
    expect(SmsProvider.prototype.send).toHaveBeenCalled();
  });

  it('should skip push notification when push is disabled in preferences', async () => {
    (getUserNotificationPreference as jest.Mock).mockResolvedValue({
      inApp: true,
      push: false,
    });

    const options = {
      recipient: {
        userId: 'user-123',
      },
      event: 'test_event',
      channels: ['push', 'socket'] as any[],
      title: 'Hello',
      body: 'World',
    };

    await UniversalNotificationService.send(options);

    // Push should NOT be sent
    expect(PushProvider.prototype.send).not.toHaveBeenCalled();
    // Socket should be sent
    expect(SocketProvider.prototype.send).toHaveBeenCalled();
  });

  it('should skip DB record and socket when in-app is disabled in preferences', async () => {
    (getUserNotificationPreference as jest.Mock).mockResolvedValue({
      inApp: false,
      push: true,
    });

    const options = {
      recipient: {
        userId: 'user-123',
      },
      event: 'test_event',
      channels: ['push', 'socket'] as any[],
      title: 'Hello',
      body: 'World',
    };

    await UniversalNotificationService.send(options);

    // DB record should NOT be created
    expect(dbService.createNotification).not.toHaveBeenCalled();
    // Socket should NOT be sent
    expect(SocketProvider.prototype.send).not.toHaveBeenCalled();
    // Push should be sent
    expect(PushProvider.prototype.send).toHaveBeenCalled();
  });

  it('should throw an error when throwOnError is true and a provider fails', async () => {
    (EmailProvider.prototype.send as jest.Mock).mockRejectedValue(
      new Error('SMTP failure')
    );

    const options = {
      recipient: {
        email: 'test@example.com',
      },
      event: 'test_event',
      channels: ['email'] as any[],
      title: 'Hello',
      body: 'World',
      throwOnError: true,
    };

    await expect(UniversalNotificationService.send(options)).rejects.toThrow(
      'SMTP failure'
    );

    expect(EmailProvider.prototype.send).toHaveBeenCalled();
  });
});
