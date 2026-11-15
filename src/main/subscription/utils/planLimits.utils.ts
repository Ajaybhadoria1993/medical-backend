export const LIMIT_KEYS = {
  WHATSAPP_MESSAGES: 'whatsapp_messages_per_month',
  DOCTOR_ACCOUNTS: 'doctor_accounts',
  STORAGE_MONTHS: 'storage_months',
  CLOUD_STORAGE: 'cloud_storage',
} as const;

export const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

export const percentage = (count: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
};

export const mapAddOnFeatureKey = (featureKey: string): string => {
  switch (featureKey) {
    case 'additional_doctor':
      return LIMIT_KEYS.DOCTOR_ACCOUNTS;
    case 'additional_storage':
      return LIMIT_KEYS.CLOUD_STORAGE;
    default:
      return featureKey;
  }
};

export const addMapValue = (
  map: Map<string, number>,
  key: string,
  value: number
): void => {
  map.set(key, (map.get(key) ?? 0) + value);
};

export const isDateOutsideRetention = (
  createdAt: Date,
  retentionMonths: number,
  now: Date
): boolean => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  return createdAt <= cutoff;
};
