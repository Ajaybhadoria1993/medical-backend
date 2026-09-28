# Implementation Plan - Notification Preferences (Aligned with Design Document)

Introduce customizable notification preferences (in-app and push) for users (Doctor, Admin, Receptionist, Patient, etc.), storing overrides in the `settings.notification_preferences` JSONB column, with fallback to role-based defaults and a Redis caching layer.

## User Review Required

> [!IMPORTANT]
> The database migration will add the `notification_preferences` JSONB column to the existing `settings` table. 
> 
> A Redis caching layer with a 5-minute TTL will be added to prevent performance degradation on the notification dispatch path.

## Design Document Checklist Alignment

The design document outlines several critical specifications. We will align our changes to them:

1. **JSONB Structure**:
   ```json
   {
     "inApp": {
       "appointment_created": true,
       "appointment_rescheduled": true
     },
     "push": {
       "appointment_created": true,
       "appointment_rescheduled": false
     }
   }
   ```
2. **API Routes**:
   - `GET /api/v1/settings/notification-preferences` -> Get resolved preferences (defaults merged with user overrides)
   - `PUT /api/v1/settings/notification-preferences` -> Update user preferences (ignores non-configurable types)
   - `GET /api/v1/settings/notification-preferences/defaults` -> Get available notification types & defaults for the user's role
3. **Role Defaults & Non-Configurable Toggles**:
   - Always-ON events: `appointment_canceled`, `payment_received`, `appointment_no_show`.
   - Specific default mappings for: `Admin`, `Doctor`, `Patient`, `Receptionist`, `Lab_Assistant`.
4. **Caching Strategy**:
   - Key: `notif_prefs:{userId}`
   - TTL: 5 minutes
   - Invalidation: `del` key on `PUT /api/v1/settings/notification-preferences`.

---

## Proposed Changes

### 1. Database Schema

#### [MODIFY] [setting.model.ts](file:///d:/MediSetu_backend/src/main/settings/models/setting.model.ts)
Add a JSONB column `notificationPreferences` to `SettingModel`:
```typescript
import { jsonb } from 'drizzle-orm/pg-core';

// Inside SettingModel:
notificationPreferences: jsonb('notification_preferences'),
```

---

### 2. Constants & Utilities

#### [NEW] [notificationPreferences.constants.ts](file:///d:/MediSetu_backend/src/utils/notificationPreferences.constants.ts)
Define role-based defaults and non-configurable notification lists:
- `NON_CONFIGURABLE_NOTIFICATIONS`: `['appointment_canceled', 'payment_received', 'appointment_no_show']`
- `ROLE_DEFAULTS`: Constant mapping for `Admin`, `Doctor`, `Patient`, `Receptionist`, `Lab_Assistant` as specified in the design doc.

#### [NEW] [notificationPreferences.utils.ts](file:///d:/MediSetu_backend/src/utils/notificationPreferences.utils.ts)
Define helper functions:
- `resolveNotificationPreferences(userId: string, role: string)`: Resolves full preference mapping (merging defaults and user overrides). Caches the result in Redis with key `notif_prefs:{userId}` and TTL of 5 minutes.
- `getUserNotificationPreference(userId: string, action: string)`: Queries Redis (falling back to DB settings join) to get `{ inApp: boolean; push: boolean }` for a specific action/type.

---

### 3. Notification Dispatch Interception

#### [MODIFY] [notification.utils.ts](file:///d:/MediSetu_backend/src/utils/notification.utils.ts)
In `sendNotificationToUser`:
- Extract `action` from `opts.metadata?.action`. If no action is provided, default to sending on all channels.
- Call `getUserNotificationPreference(opts.userId, action)` to retrieve `inApp` and `push` status.
- Respect toggles: skip DB writing/socket/Kafka if `inApp` is false, and skip SNS push if `push` is false.

#### [MODIFY] [universalNotification.service.ts](file:///d:/MediSetu_backend/src/main/notifications/services/universalNotification.service.ts)
In `UniversalNotificationService.send`:
- Call `getUserNotificationPreference` if `recipient.userId` and `event` exist.
- Filter the socket and push channels based on the resolved preferences.

---

### 4. REST APIs for Preferences

#### [MODIFY] [setting.schemas.ts](file:///d:/MediSetu_backend/src/main/settings/schemas/setting.schemas.ts)
Add Zod validation schema for `PUT /notification-preferences`:
- Validate input shape (nested `inApp` and `push` structures).

#### [MODIFY] [setting.controller.ts](file:///d:/MediSetu_backend/src/main/settings/services/setting.service.ts) & [setting.controller.ts](file:///d:/MediSetu_backend/src/main/settings/controllers/setting.controller.ts)
Implement:
- `getNotificationPreferences`: Fetches cached/resolved preferences for the user's role.
- `updateNotificationPreferences`: Validates inputs, saves to settings DB, and deletes Redis cache key.
- `getDefaultPreferences`: Returns the available list of types and their defaults for the current user's role.

#### [MODIFY] [settings.route.ts](file:///d:/MediSetu_backend/src/main/settings/routes/v1/settings.route.ts)
Expose the routes under `/api/v1/settings/notification-preferences`.

---

## Verification Plan

### Automated Tests
- Create unit tests in [universalNotification.service.test.ts](file:///d:/MediSetu_backend/src/main/notifications/tests/universalNotification.service.test.ts) to verify defaults fallback, overrides filtering, and caching behavior.

### Manual Verification
- Run database migrations locally.
- Test endpoints (`GET /defaults`, `GET /`, and `PUT /`) and verify cache invalidation.
- Verify notifications are conditionally delivered.
