import redisClient from '../configurations/redisConfig';
import logger from './logger';

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  try {
    const cached = await redisClient.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    logger.error(`[cache.util] Failed to read cache key "${key}":`, err);
  }

  const result = await loader();

  try {
    await redisClient.set(key, JSON.stringify(result), 'EX', ttlSeconds);
  } catch (err) {
    logger.error(`[cache.util] Failed to write cache key "${key}":`, err);
  }

  return result;
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error(`[cache.util] Failed to invalidate cache key "${key}":`, err);
  }
}

export async function invalidateCacheMany(keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await redisClient.del(...keys);
  } catch (err) {
    logger.error(
      `[cache.util] Failed to invalidate cache keys "${keys.join(', ')}":`,
      err
    );
  }
}

/** For keys named by the reader, not the data (a receptionist's doctor scope), so a writer can't list them.
 *  SCAN, not KEYS: this runs on the appointment write path, and KEYS blocks Redis for the whole scan. */
export async function invalidateCacheByPattern(pattern: string): Promise<void> {
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200
      );
      cursor = next;
      if (keys.length) await redisClient.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    logger.error(
      `[cache.util] Failed to invalidate cache pattern "${pattern}":`,
      err
    );
  }
}

// Only invalidates on success — if `mutation` throws, the underlying write
// rolled back, so the cached value is still accurate and left untouched.
export function withCacheInvalidation<T>(
  cacheKey: string,
  mutation: () => Promise<T>
): Promise<T> {
  return mutation().then((result) => {
    return invalidateCache(cacheKey).then(() => result);
  });
}

const doctorPublicProfileKey = (doctorId: string) =>
  `doctor_public_profile:${doctorId}`;
const doctorPublicProfileWebKey = (doctorId: string) =>
  `doctor_public_profile_web:${doctorId}`;
const doctorPublicProfileFullKey = (doctorId: string) =>
  `doctor_public_profile_full:${doctorId}`;
const doctorDisplayNameKey = (doctorId: string) =>
  `doctor_display_name:${doctorId}`;
const clinicSettingsKey = (clinicId: string) => `clinic_settings:${clinicId}`;
const clinicAutoLogoutKey = (clinicId: string) =>
  `clinic_autologout:${clinicId}`;
// Versioned: bump when the cached GET /patient/:id shape changes so old entries
// retire at once. Family is left out: it depends on the viewer's clinic.
const patientDetailKey = (patientId: string) => `patient:${patientId}:v3`;

export const CacheKeys = {
  // Hand-off, not a cache: the night's appointment-payment items for the billing alert email; 26 h TTL.
  appointmentPaymentNeedsLook: () =>
    'finance:appointment-payment-check:needs-look',
  // Live marker for a "View as" session, not a cache: missing means ended. TTL = session length.
  supportSession: (sessionId: string) => `support:session:${sessionId}`,
  // Every settings row for a credit type; invalidated by the credits module's settings writes.
  creditSettings: (creditType: string) => `credits:settings:${creditType}`,
  // Set-once marker: one usage alert per clinic, channel, billing period and kind.
  creditUsageAlert: (
    clinicId: string,
    channel: string,
    periodKey: string,
    kind: 'warning' | 'paused'
  ) => `credits:alert:${clinicId}:${channel}:${periodKey}:${kind}`,
  // A clinic's active treatment templates with steps; cleared by every template write of that clinic.
  treatmentTemplatesActive: (clinicId: string) =>
    `treatment-plan:templates-active:${clinicId}`,
  // Messages an owner switched off; cleared by WhatsAppMessagePrefsService.save.
  whatsappMessagePrefs: (ownerType: string, ownerId: string) =>
    `notifications:whatsapp-prefs:${ownerType}:${ownerId}`,
  // Messages Super Admin turned off for every clinic; cleared by WhatsAppMessagePrefsService.setPlatformMessage.
  whatsappPlatformOffs: () => 'notifications:whatsapp-platform-offs',
  // Super Admin's main speciality display order; cleared by SpecialtyOrderService.save.
  specialtyDisplayOrder: () => 'superadmin:specialty-display-order',
  // Phone-to-desktop scan session (status + the uploaded file); Redis expiry is its TTL.
  scanBridgeSession: (otp: string) => `scan:bridge:${otp}`,
  // Platform-wide Super Admin figures; short TTL only, nothing invalidates them.
  superadminOverview: (from: string, to: string, prevFrom: string) =>
    `superadmin:overview:${from}:${to}:${prevFrom}`,
  superadminRevenue: (from: string, to: string, prevFrom: string) =>
    `superadmin:revenue:${from}:${to}:${prevFrom}`,
  superadminPatientApp: (from: string, to: string, prevFrom: string) =>
    `superadmin:patient-app:${from}:${to}:${prevFrom}`,
  superadminUsage: (from: string, to: string, prevFrom: string) =>
    `superadmin:usage:${from}:${to}:${prevFrom}`,
  superadminGrowth: (from: string, to: string, prevFrom: string) =>
    `superadmin:growth:${from}:${to}:${prevFrom}`,
  clinicProfileOverview: (clinicId: string) =>
    `clinic:profile-overview:${clinicId}`,
  // GET /clinic/settings blob (settings + reminders) and the auto-logout row.
  clinicSettings: clinicSettingsKey,
  clinicAutoLogout: clinicAutoLogoutKey,
  // Every key a clinic_settings or clinic_reminders write can stale.
  clinicSettingsAll: (clinicId: string) => [
    clinicSettingsKey(clinicId),
    clinicAutoLogoutKey(clinicId),
  ],
  // Auth guard's user row and the patient-app account blob.
  authUser: (userId: string) => `user:${userId}`,
  patientAccount: (userId: string) => `patient_account:${userId}`,
  userPermissions: (userId: string, clinicId: string) =>
    `perm:${userId}:${clinicId}`,
  staffScope: (userId: string, clinicId: string) =>
    `staff:scope:${userId}:${clinicId}`,
  // Live doctor→reception calls: a hash of doctorId → call JSON.
  clinicCalls: (clinicId: string) => `calls:${clinicId}`,
  receptionOverview: (clinicId: string, doctorId?: string, scopeKey?: string) =>
    `dashboard:reception-overview:${clinicId}:${doctorId ?? 'all'}:${
      scopeKey ?? 'all'
    }`,
  receptionOverviewPattern: (clinicId: string) =>
    `dashboard:reception-overview:${clinicId}:*`,
  // Bumped on every appointment or payment change. Keys below embed it, so a bump
  // retires every cached dashboard snapshot for the clinic in one O(1) write.
  dashboardCacheVersion: (clinicId: string) =>
    `dashboard:cache-version:${clinicId}`,
  receptionTodayStats: (clinicId: string, version: string, scopeKey?: string) =>
    `dashboard:reception-today-stats:${clinicId}:v${version}:${scopeKey ?? 'all'}`,
  revenueOverview: (
    clinicId: string,
    version: string,
    doctorId: string | null,
    startYmd: string,
    endYmd: string
  ) =>
    `revenue_overview:${clinicId}:v${version}:${doctorId ? `doctor:${doctorId}` : 'all'}:${startYmd}:${endYmd}`,
  // No doctorId = clinic-wide, the admin dashboard's view.
  todayOverview: (
    clinicId: string,
    version: string,
    doctorId?: string | null
  ) =>
    `today_overview:${clinicId}:v${version}:${doctorId ? `doctor:${doctorId}` : 'all'}`,
  clinicDashboard: (
    clinicId: string,
    version: string,
    startYmd: string,
    endYmd: string
  ) => `dashboard:clinic:${clinicId}:v${version}:${startYmd}:${endYmd}`,
  clinicDoctorList: (clinicId: string, scopeKey?: string) =>
    `doctors:list:${clinicId}:${scopeKey ?? 'all'}`,
  clinicDoctorListPattern: (clinicId: string) => `doctors:list:${clinicId}*`,
  // A doctor's day per the schedule (ok/leave/off); every schedule writer clears the pattern.
  followUpDoctorDay: (clinicId: string, doctorId: string, date: string) =>
    `follow-ups:day:${clinicId}:${doctorId}:${date}`,
  followUpDoctorDayPattern: (clinicId: string, doctorId: string) =>
    `follow-ups:day:${clinicId}:${doctorId}:*`,
  // Set once a shift has an arrival; arrivals are append-only, so it never needs clearing.
  doctorShiftArrived: (
    clinicId: string,
    doctorId: string,
    date: string,
    sessionIndex: number
  ) => `doctor_arrival:seen:${clinicId}:${doctorId}:${date}:s${sessionIndex}`,
  // Versioned like the other dashboards: a clinic version bump retires every range at once, no pattern wipe needed.
  doctorDashboardV2Live: (
    clinicId: string,
    doctorId: string,
    version: string,
    startYmd: string,
    endYmd: string
  ) =>
    `doctor_dashboard_v2_live:${clinicId}:${doctorId}:v${version}:${startYmd}:${endYmd}`,
  doctorDashboardV2Analytics: (
    clinicId: string,
    doctorId: string,
    version: string,
    startYmd: string,
    endYmd: string
  ) =>
    `doctor_dashboard_v2_analytics:${clinicId}:${doctorId}:v${version}:${startYmd}:${endYmd}`,
  // The patient-app and public-web payloads differ (clinic filtering, reviews,
  // timings), so they cache separately and must be invalidated together.
  doctorPublicProfile: doctorPublicProfileKey,
  doctorPublicProfileWeb: doctorPublicProfileWebKey,
  // The fully assembled public response (profile + timings + reviews).
  doctorPublicProfileFull: doctorPublicProfileFullKey,
  // Doctor's display name for patient push copy (queue, running-late, shift).
  doctorDisplayName: doctorDisplayNameKey,
  // Every per-doctor key a profile write can stale. The display name rides
  // along so each existing profile-write invalidation clears it too.
  doctorPublicProfileAll: (doctorId: string) => [
    doctorPublicProfileKey(doctorId),
    doctorPublicProfileWebKey(doctorId),
    doctorPublicProfileFullKey(doctorId),
    doctorDisplayNameKey(doctorId),
  ],
  // GET /patient/:id base details (familyMembers is added per request).
  patientDetail: patientDetailKey,
  // Every details key for a patient. Writers clear this group; a family-link
  // change clears it for both patients, since each page shows the other's number.
  patientDetailAll: (patientId: string) => [patientDetailKey(patientId)],
  // Clinic profile payload; owned by the clinic module, cleared by subscription changes too.
  clinicDetails: (clinicId: string) => `clinic_details:${clinicId}`,
  // Subscription module: a plan or add-on change clears the clinic's keys.
  clinicActiveSubscription: (clinicId: string) =>
    `clinic_active_subscription:${clinicId}`,
  clinicPlan: (clinicId: string) => `clinic_plan:${clinicId}`,
  clinicLimits: (clinicId: string) => `clinic_limits:${clinicId}`,
  clinicLimitsOverview: (clinicId: string) =>
    `clinic_limits_overview:${clinicId}`,
  clinicAddOns: (clinicId: string) => `clinic_addons:${clinicId}`,
  userSubscriptionExpiry: (userId: string) =>
    `user_subscription_expiry:${userId}`,
  // planId first, so planLimitPattern still clears every version of the plan.
  planLimit: (planId: string, featureKey: string, planVersionId = 'current') =>
    `plan_limit:${planId}:${planVersionId}:${featureKey}`,
  planLimitPattern: (planId: string) => `plan_limit:${planId}:*`,
  planAddOnLimits: (planId: string) => `plan_addon_limits:${planId}`,
  // The pricing page list; every plan, feature or add-on-limit write clears it.
  allPlans: 'subscription_plans:all',
  // Add-on names and prices, the same for every clinic; add-ons change only through the seed.
  addOnCatalog: 'subscription_addons:catalog',
} as const;
