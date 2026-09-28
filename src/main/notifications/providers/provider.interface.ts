import { UniversalNotificationOptions } from '../types';

export interface NotificationProvider {
  send(options: UniversalNotificationOptions): Promise<void>;
}
