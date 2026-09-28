export type NotificationChannel = 'push' | 'email' | 'sms' | 'socket';

export interface NotificationRecipient {
  userId?: string;
  email?: string;
  mobile?: string;
  socketRoom?: string;
}

export interface UniversalNotificationOptions {
  recipient: NotificationRecipient;
  event: string; // e.g. 'patient_otp', 'appointment_confirmed'
  channels: NotificationChannel[];
  title: string;
  body: string;
  data?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  emailHtml?: string; // custom HTML content if needed
  throwOnError?: boolean;

}
