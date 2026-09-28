import { SNSClient } from '@aws-sdk/client-sns';
import dotenv from 'dotenv';

dotenv.config();

const accessKey =
  process.env.ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_TOKEN ||
  process.env.AWS_ACCESS_KEY_ID;
const secretKey =
  process.env.SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_TOKEN ||
  process.env.AWS_SECRET_ACCESS_KEY;
const sessionToken = process.env.AWS_SESSION_TOKEN;
const region = process.env.AWS_REGION || 'ap-south-1';

const snsConfig: any = {
  region,
  maxAttempts: 3,
};

if (accessKey && secretKey) {
  const credentials: any = {
    accessKeyId: accessKey.trim(),
    secretAccessKey: secretKey.trim(),
  };

  if (sessionToken) {
    credentials.sessionToken = sessionToken.trim();
  }

  snsConfig.credentials = credentials;
}

export const snsClient = new SNSClient(snsConfig);
export const SNS_PLATFORM_APPLICATION_ARN_ANDROID =
  process.env.SNS_PLATFORM_APPLICATION_ARN_ANDROID || '';
export const SNS_PLATFORM_APPLICATION_ARN_IOS =
  process.env.SNS_PLATFORM_APPLICATION_ARN_IOS || '';
