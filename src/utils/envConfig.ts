import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Define the type for environment variables
interface EnvConfigType {
  NODE_ENV: string;
  PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASS: string;
  DB_HOST: string;
  DB_URL: string;
  DB_PORT: string;
  // Production DB Config
  PROD_DB_NAME: string;
  PROD_DB_USER: string;
  PROD_DB_PASS: string;
  PROD_DB_HOST: string;
  PROD_DB_URL: string;
  PROD_DB_PORT: string;
  // Development DB Config
  DEV_DB_NAME: string;
  DEV_DB_USER: string;
  DEV_DB_PASS: string;
  DEV_DB_HOST: string;
  DEV_DB_URL: string;
  DEV_DB_PORT: string;
  // Staging DB Config
  STAGING_DB_NAME: string;
  STAGING_DB_USER: string;
  STAGING_DB_PASS: string;
  STAGING_DB_HOST: string;
  STAGING_DB_URL: string;
  STAGING_DB_PORT: string;
  JWT_SECRET_KEY: string;
  ACCESS_TOKEN_EXPIRES_IN: string;
  REFRESH_TOKEN_SECRET: string;
  REFRESH_TOKEN_EXPIRES_IN: string;
  FRONT_END_URI: string;
  BACKEND_BASE_URL: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  THIRD_PARTY_API_KEY: string;
  AWS_ACCESS_TOKEN: string;
  AWS_SECRET_TOKEN: string;
  AWS_REGION: string;
  AWS_BUCKET_NAME: string;
  DEV_AWS_BUCKET_NAME: string;
  STAGING_AWS_BUCKET_NAME: string;
  PROD_AWS_BUCKET_NAME: string;

  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  TURNSTILE_SECRET_KEY: string;
  SUPER_ADMIN_NAME: string;
  SUPER_ADMIN_EMAIL: string;
  SUPER_ADMIN_PASSWORD: string;

  ENABLE_NOTIFICATIONS: string;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  RAZORPAY_WEBHOOK_APP_SECRET: string;
  ENABLE_RAZORPAY_ROUTE: boolean;

  GOOGLE_MAPS_API_KEY?: string;
  PAYMENT_LOCK_TTL_SECONDS?: number;

  GEMINI_API_KEY?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  GOOGLE_CLOUD_LOCATION: string;
  TRANSLATION_PROVIDER: 'none' | 'gemini' | 'bhashini';
  TRANSLATION_FALLBACK: 'none' | 'gemini';
  TRANSLATION_MODEL_NAME: string;
  BHASHINI_USER_ID?: string;
  BHASHINI_API_KEY?: string;

  MEDICINE_DB_NAME: string;
  MEDICINE_DB_USER: string;
  MEDICINE_DB_PASS: string;
  MEDICINE_DB_HOST: string;
  MEDICINE_DB_URL: string;

  OTP_BYPASS_ENABLED: boolean;
  BYPASS_TEST_MOBILE: string;
  OTP_FIXED: string;
  OTP_EXPIRY_MS: number;
  OTP_RESEND_COOLDOWN_SECS: number;
  OTP_MAX_RESEND_COUNT: number;
  OTP_RATE_REDIS_PREFIX: string;
  OTP_RATE_WINDOW_SECS: number;
  OTP_MAX_ATTEMPTS_PER_WINDOW: number;
  SESSION_CACHE_TTL_SECS: number;

  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID: string;
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: string;
  WHATSAPP_API_VERSION: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_SENDING_ENABLED: boolean;
  WHATSAPP_FORCE_ENABLED: boolean;
  WHATSAPP_VIA_REGISTRY: ReadonlySet<string>;
  NOTIFICATIONS_INAPP_ENABLED: boolean;
  NOTIFICATIONS_REGISTRY_ENABLED: boolean;
  NOTIFY_STRICT_RECIPIENTS_APPOINTMENT: boolean;
  SUPER_ADMIN_NOTIFY_EMAILS: string[] | null;
  DLT_ENTITY_ID?: string;
  DLT_SENDER_ID: string;
  DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION?: string;
  DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION_RESEND?: string;
  DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION?: string;
  DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION_RESEND?: string;
}

// Create the environment configuration object
const isProduction = process.env.NODE_ENV === 'production';
const isStaging = process.env.NODE_ENV === 'staging';

export const envConfig: EnvConfigType = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),
  JWT_SECRET_KEY: process.env.JWT_SECRET_KEY || 'secret_key',
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
  REFRESH_TOKEN_SECRET:
    process.env.REFRESH_TOKEN_SECRET || 'refresh_secret_key',
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
  FRONT_END_URI: process.env.FRONT_END_URI!,
  BACKEND_BASE_URL: process.env.BACKEND_BASE_URL!,

  // Selected DB Config
  DB_NAME:
    (isProduction
      ? process.env.PROD_DB_NAME
      : isStaging
        ? process.env.STAGING_DB_NAME
        : process.env.DEV_DB_NAME) || process.env.DB_NAME!,
  DB_USER:
    (isProduction
      ? process.env.PROD_DB_USER
      : isStaging
        ? process.env.STAGING_DB_USER
        : process.env.DEV_DB_USER) || process.env.DB_USER!,
  DB_PASS:
    (isProduction
      ? process.env.PROD_DB_PASS
      : isStaging
        ? process.env.STAGING_DB_PASS
        : process.env.DEV_DB_PASS) || process.env.DB_PASS!,
  DB_HOST:
    (isProduction
      ? process.env.PROD_DB_HOST
      : isStaging
        ? process.env.STAGING_DB_HOST
        : process.env.DEV_DB_HOST) || process.env.DB_HOST!,
  DB_URL:
    (isProduction
      ? process.env.PROD_DB_URL
      : isStaging
        ? process.env.STAGING_DB_URL
        : process.env.DEV_DB_URL) || process.env.DB_URL!,
  DB_PORT:
    (isProduction
      ? process.env.PROD_DB_PORT
      : isStaging
        ? process.env.STAGING_DB_PORT
        : process.env.DEV_DB_PORT) || process.env.DB_PORT!,

  // Production DB Config
  PROD_DB_NAME: process.env.PROD_DB_NAME!,
  PROD_DB_USER: process.env.PROD_DB_USER!,
  PROD_DB_PASS: process.env.PROD_DB_PASS!,
  PROD_DB_HOST: process.env.PROD_DB_HOST!,
  PROD_DB_URL: process.env.PROD_DB_URL!,
  PROD_DB_PORT: process.env.PROD_DB_PORT!,

  // Development DB Config
  DEV_DB_NAME: process.env.DEV_DB_NAME!,
  DEV_DB_USER: process.env.DEV_DB_USER!,
  DEV_DB_PASS: process.env.DEV_DB_PASS!,
  DEV_DB_HOST: process.env.DEV_DB_HOST!,
  DEV_DB_URL: process.env.DEV_DB_URL!,
  DEV_DB_PORT: process.env.DEV_DB_PORT!,

  // Staging DB Config
  STAGING_DB_NAME: process.env.STAGING_DB_NAME!,
  STAGING_DB_USER: process.env.STAGING_DB_USER!,
  STAGING_DB_PASS: process.env.STAGING_DB_PASS!,
  STAGING_DB_HOST: process.env.STAGING_DB_HOST!,
  STAGING_DB_URL: process.env.STAGING_DB_URL!,
  STAGING_DB_PORT: process.env.STAGING_DB_PORT!,

  SMTP_HOST: process.env.SMTP_HOST || 'smtp.example.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || 'user',
  SMTP_PASS: process.env.SMTP_PASS || 'password',
  SMTP_FROM: process.env.SMTP_FROM || 'Clinic <no-reply@clinic.example>',
  THIRD_PARTY_API_KEY: process.env.THIRD_PARTY_API_KEY || 'api_key',
  AWS_ACCESS_TOKEN: process.env.AWS_ACCESS_TOKEN!,
  AWS_SECRET_TOKEN: process.env.AWS_SECRET_TOKEN!,
  AWS_REGION: process.env.AWS_REGION!,
  AWS_BUCKET_NAME:
    (isProduction
      ? process.env.PROD_AWS_BUCKET_NAME
      : isStaging
        ? process.env.STAGING_AWS_BUCKET_NAME
        : process.env.DEV_AWS_BUCKET_NAME) || process.env.AWS_BUCKET_NAME!,
  DEV_AWS_BUCKET_NAME: process.env.DEV_AWS_BUCKET_NAME!,
  STAGING_AWS_BUCKET_NAME: process.env.STAGING_AWS_BUCKET_NAME!,
  PROD_AWS_BUCKET_NAME: process.env.PROD_AWS_BUCKET_NAME!,

  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  TURNSTILE_SECRET_KEY:
    process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA', // Default testing key
  SUPER_ADMIN_NAME: process.env.SUPER_ADMIN_NAME || 'Super Admin',
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL || 'admin@medisetu.com',
  SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD || 'Admin@123',

  ENABLE_NOTIFICATIONS: process.env.ENABLE_NOTIFICATIONS || 'true',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID!,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET!,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET!,
  RAZORPAY_WEBHOOK_APP_SECRET: process.env.RAZORPAY_WEBHOOK_APP_SECRET!,
  ENABLE_RAZORPAY_ROUTE: process.env.ENABLE_RAZORPAY_ROUTE === 'true',

  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  PAYMENT_LOCK_TTL_SECONDS: process.env.PAYMENT_LOCK_TTL_SECONDS
    ? parseInt(process.env.PAYMENT_LOCK_TTL_SECONDS, 10)
    : undefined,

  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION || 'asia-south1',
  // An unknown value means 'none', so a typo can never send patient text anywhere.
  TRANSLATION_PROVIDER:
    (['gemini', 'bhashini'] as const).find(
      (name) => name === process.env.TRANSLATION_PROVIDER
    ) ?? 'none',
  TRANSLATION_FALLBACK:
    process.env.TRANSLATION_FALLBACK === 'gemini' ? 'gemini' : 'none',
  TRANSLATION_MODEL_NAME:
    process.env.TRANSLATION_MODEL_NAME || 'gemini-2.5-flash',
  BHASHINI_USER_ID: process.env.BHASHINI_USER_ID,
  BHASHINI_API_KEY: process.env.BHASHINI_API_KEY,

  MEDICINE_DB_NAME: process.env.MEDICINE_DB_NAME!,
  MEDICINE_DB_USER: process.env.MEDICINE_DB_USER!,
  MEDICINE_DB_PASS: process.env.MEDICINE_DB_PASS!,
  MEDICINE_DB_HOST: process.env.MEDICINE_DB_HOST!,
  MEDICINE_DB_URL: process.env.MEDICINE_DB_URL!,

  OTP_BYPASS_ENABLED: process.env.OTP_BYPASS_ENABLED
    ? process.env.OTP_BYPASS_ENABLED === 'true'
    : true,
  BYPASS_TEST_MOBILE: process.env.BYPASS_TEST_MOBILE || '9999999999',
  OTP_FIXED: process.env.OTP_FIXED || '000000',
  OTP_EXPIRY_MS: process.env.OTP_EXPIRY_MS
    ? parseInt(process.env.OTP_EXPIRY_MS, 10)
    : 10 * 60 * 1000,
  OTP_RESEND_COOLDOWN_SECS: process.env.OTP_RESEND_COOLDOWN_SECS
    ? parseInt(process.env.OTP_RESEND_COOLDOWN_SECS, 10)
    : 60,
  OTP_MAX_RESEND_COUNT: process.env.OTP_MAX_RESEND_COUNT
    ? parseInt(process.env.OTP_MAX_RESEND_COUNT, 10)
    : 5,
  OTP_RATE_REDIS_PREFIX:
    process.env.OTP_RATE_REDIS_PREFIX || 'patient:otp_rate',
  OTP_RATE_WINDOW_SECS: process.env.OTP_RATE_WINDOW_SECS
    ? parseInt(process.env.OTP_RATE_WINDOW_SECS, 10)
    : 10 * 60,
  OTP_MAX_ATTEMPTS_PER_WINDOW: process.env.OTP_MAX_ATTEMPTS_PER_WINDOW
    ? parseInt(process.env.OTP_MAX_ATTEMPTS_PER_WINDOW, 10)
    : 5,
  SESSION_CACHE_TTL_SECS: process.env.SESSION_CACHE_TTL_SECS
    ? parseInt(process.env.SESSION_CACHE_TTL_SECS, 10)
    : 7 * 24 * 60 * 60,

  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN!,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN!,
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION || 'v20.0',
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET!,
  // Kill switch, off-by-default in staging so test data can't send real
  // messages to real patients (see docs/WHATSAPP_META_SETUP.md).
  // WHATSAPP_SENDING_ENABLED=true|false in .env always wins if set explicitly.
  WHATSAPP_SENDING_ENABLED:
    process.env.WHATSAPP_SENDING_ENABLED !== undefined
      ? process.env.WHATSAPP_SENDING_ENABLED === 'true'
      : !isStaging,
  // Ignores the per-clinic `clinic_settings.whatsapp_enabled` opt-in and treats
  // WhatsApp as on for every clinic. That column defaults to false, so a clinic
  // created without explicitly enabling WhatsApp silently gets no messages —
  // this is the escape hatch for that. Off by default: with it on, clinics that
  // deliberately disabled WhatsApp will message their patients anyway.
  WHATSAPP_FORCE_ENABLED: process.env.WHATSAPP_FORCE_ENABLED === 'true',
  // Template keys the registry sends instead of the legacy sender. One set
  // guards both sides, so a template is never sent twice or not at all.
  WHATSAPP_VIA_REGISTRY: new Set(
    (process.env.WHATSAPP_VIA_REGISTRY ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
  ),
  NOTIFICATIONS_INAPP_ENABLED: true,
  NOTIFICATIONS_REGISTRY_ENABLED: true,
  // Narrows appointment notifications from "every receptionist and admin in the

  NOTIFY_STRICT_RECIPIENTS_APPOINTMENT: true,
  // Non-prod only: super-admin emails go to this comma-separated list instead of
  // the DB users, so staging/local never mails real admins. Null in prod.
  SUPER_ADMIN_NOTIFY_EMAILS: isProduction
    ? null
    : (process.env.SUPER_ADMIN_NOTIFY_EMAILS || '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean),
  DLT_ENTITY_ID: process.env.DLT_ENTITY_ID,
  DLT_SENDER_ID: process.env.DLT_SENDER_ID || 'INFMSU',
  DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION:
    process.env.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION,
  DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION_RESEND:
    process.env.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION_RESEND,
  DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION:
    process.env.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION,
  DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION_RESEND:
    process.env.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION_RESEND,
};

/**
 * Global patient-notification kill switch, honoured by every trigger site
 * (booking, reschedule, reminders, lab, pharmacy).
 *
 * Read through this helper rather than comparing `ENABLE_NOTIFICATIONS`
 * inline: the flag used to be checked at some call sites and not others, so
 * booking notifications were silently off while reschedule and lab messages
 * still sent. Per-clinic `clinic_settings.sms_enabled` / `whatsapp_enabled`
 * remain the finer-grained control — this is the environment-wide switch.
 */
export function notificationsEnabled(): boolean {
  return envConfig.ENABLE_NOTIFICATIONS !== 'false';
}
