import { envConfig } from './envConfig';

/** The two payment switches as stored per clinic. */
export interface BookingPaymentSettings {
  payOnlineEnabled?: boolean | null;
  payAtClinicEnabled?: boolean | null;
}

/** What a patient may use when booking; online off means pay at clinic is always allowed. */
export function bookingPaymentOptions(settings: BookingPaymentSettings): {
  payOnlineEnabled: boolean;
  payAtClinicEnabled: boolean;
} {
  const online = envConfig.ENABLE_ONLINE_APPOINTMENT_PAYMENTS;
  return {
    payOnlineEnabled: online && settings.payOnlineEnabled === true,
    payAtClinicEnabled: !online || settings.payAtClinicEnabled === true,
  };
}
