import {
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
  PublishCommand,
} from '@aws-sdk/client-sns';
import {
  snsClient,
  SNS_PLATFORM_APPLICATION_ARN_ANDROID,
  SNS_PLATFORM_APPLICATION_ARN_IOS,
} from '../../../configurations/sns/client';
import { database } from '../../../configurations/dbConnection';
import { UserDevicesModel } from '../../users/models/userDevices.model';
import { eq } from 'drizzle-orm';
import logger from '../../../utils/logger';
import { envConfig } from '../../../utils/envConfig';

export class SnsNotificationService {
  /**
   * Registers a patient's mobile device token with AWS SNS Platform Application.
   * Creates an Endpoint ARN and saves the association in the database.
   */
  static async registerDevice(
    userId: string,
    deviceToken: string,
    platform: 'ios' | 'android'
  ) {
    const platformApplicationArn =
      platform === 'ios'
        ? SNS_PLATFORM_APPLICATION_ARN_IOS
        : SNS_PLATFORM_APPLICATION_ARN_ANDROID;

    if (!platformApplicationArn) {
      throw new Error(
        `AWS SNS Platform Application ARN for ${platform} is not configured.`
      );
    }

    // 1. Create Endpoint in AWS SNS
    const command = new CreatePlatformEndpointCommand({
      PlatformApplicationArn: platformApplicationArn,
      Token: deviceToken,
      CustomUserData: userId,
    });

    const response = await snsClient.send(command);
    const snsEndpointArn = response.EndpointArn;

    if (!snsEndpointArn) {
      throw new Error('Failed to create AWS SNS Platform Endpoint');
    }

    // 2. Save device info and endpoint to DB
    const [savedDevice] = await database
      .insert(UserDevicesModel)
      .values({
        userId,
        deviceToken,
        platform,
        snsEndpointArn,
      })
      .onConflictDoUpdate({
        target: UserDevicesModel.deviceToken,
        set: {
          userId,
          platform,
          snsEndpointArn,
          updatedAt: new Date(),
        },
      })
      .returning();

    return savedDevice;
  }

  /**
   * Unregisters a device token from AWS SNS and database
   */
  static async unregisterDevice(deviceToken: string) {
    const [device] = await database
      .select()
      .from(UserDevicesModel)
      .where(eq(UserDevicesModel.deviceToken, deviceToken))
      .limit(1);

    if (device) {
      try {
        const command = new DeleteEndpointCommand({
          EndpointArn: device.snsEndpointArn,
        });
        await snsClient.send(command);
      } catch (err) {
        logger.error('Failed to delete SNS platform endpoint', err);
      }

      await database
        .delete(UserDevicesModel)
        .where(eq(UserDevicesModel.deviceToken, deviceToken));
    }
  }

  /**
   * Sends a push notification to all devices registered to a specific user
   */
  static async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    customData?: Record<string, any>
  ) {
    const devices = await database
      .select()
      .from(UserDevicesModel)
      .where(eq(UserDevicesModel.userId, userId));

    if (!devices.length) return;

    const promises = devices.map(async (device) => {
      try {
        const alertPayload = { title, body };

        // AWS SNS payload structure for multi-platform delivery
        const snsMessage = {
          default: body,
          APNS: JSON.stringify({
            aps: {
              alert: alertPayload,
              sound: 'default',
              badge: 1,
            },
            data: customData || {},
          }),
          GCM: JSON.stringify({
            notification: alertPayload,
            data: customData || {},
          }),
        };

        const command = new PublishCommand({
          TargetArn: device.snsEndpointArn,
          Message: JSON.stringify(snsMessage),
          MessageStructure: 'json',
        });

        await snsClient.send(command);
      } catch (err) {
        logger.error(
          `Failed to deliver push notification to device endpoint ${device.snsEndpointArn}`,
          err
        );
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Sends a transactional SMS directly to the patient's phone
   */
  static async sendTransactionalSms(
    phoneNumber: string,
    message: string,
    templateId?: string
  ) {
    try {
      const dltEntityId = envConfig.DLT_ENTITY_ID;
      const dltSenderId = envConfig.DLT_SENDER_ID;

      const command = new PublishCommand({
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Transactional',
          },
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: dltSenderId,
          },
          ...(dltEntityId && {
            'AWS.MM.SMS.EntityId': {
              DataType: 'String',
              StringValue: dltEntityId,
            },
          }),
          ...(templateId && {
            'AWS.MM.SMS.TemplateId': {
              DataType: 'String',
              StringValue: templateId,
            },
          }),
        },
      });

      await snsClient.send(command);
      logger.info(`SMS sent successfully to ${phoneNumber}`);
    } catch (err) {
      logger.error(`Failed to send SMS to ${phoneNumber} via AWS SNS`, err);
      throw err;
    }
  }
}
