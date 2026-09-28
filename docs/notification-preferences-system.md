# Notification Preferences System — Design Document

## Overview

This document outlines the design for a **customizable notification preference system** that allows users (Doctor, Admin, Receptionist, Patient, etc.) to control which in-app and push notifications they receive through the MediSetu app.

---

## Problem Statement

Currently, all users receive all notifications relevant to their role with no ability to customize. This leads to:
- Notification fatigue (especially for Admins/Receptionists in busy clinics)
- No granular control over delivery channels (in-app vs push)
- No way to mute non-critical notifications while keeping important ones

---

## Chosen Approach: JSONB Column on Existing `settings` Table

### Why JSONB over a Normalized Table?

| Criteria                           | JSONB Column (Option A)                   | Normalized Table (Option B)           |
| ---------------------------------- | ----------------------------------------- | ------------------------------------- |
| **DB calls per notification send** | 0 extra (already fetched with settings)   | 1 extra JOIN or query                 |
| **New user setup**                 | Nothing to insert (NULL = defaults)       | Must INSERT 10-15 rows per user       |
| **Adding new notification type**   | Update code constant only                 | Data migration for all existing users |
| **Table bloat**                    | None                                      | ~15 rows × N users                    |
| **Query flexibility**              | Limited (can't easily query across users) | Full SQL queryability                 |
| **Schema flexibility**             | High (add/remove types freely)            | Requires migrations                   |
| **Caching**                        | Simple (one object per user)              | Complex (multiple rows to assemble)   |
| **Performance at scale**           | Excellent                                 | Degrades with user count              |

### Why Option A wins for MediSetu:

1. **Hot path optimization** — Notification sending happens hundreds of times per day. Every extra DB call adds latency. JSONB keeps preferences in the same row we already fetch.

2. **Zero cost for new users** — NULL means "use role defaults." No insert, no migration, no setup. The app handles it in code.

3. **Future-proof** — When you add a new notification type (e.g., `prescription_ready`, `lab_result_available`), you just add it to the defaults constant. No data migration needed.

4. **Cacheable** — One Redis key per user holds their entire preference map. Invalidate on update. Simple.

5. **Your analytics need is low** — You don't need queries like "how many users disabled push for appointments." If you ever do, you can query JSONB with PostgreSQL's `->` operators.

---

## Architecture

### Data Flow

```
User customizes preferences
        │
        ▼
PUT /api/v1/settings/notification-preferences
        │
        ▼
Store in settings.notification_preferences (JSONB)
        │
        ▼
Invalidate Redis cache (key: notif_prefs:{userId})
        │
        ▼
Next notification send:
  1. Check Redis cache for preferences
  2. Cache miss? Fetch from DB (1 query, same settings row)
  3. Merge user overrides with role defaults
  4. Check if notification type is enabled for channel
  5. Skip or deliver accordingly
```

### Default Preference Resolution

```
Final Preference = Role Default ← merge ← User Override (stored JSONB)
```

- If `notification_preferences` is NULL → 100% role defaults apply
- If partially filled → only overridden keys are used, rest fall back to defaults
- Critical notifications (non-configurable) bypass preference check entirely

---

## Schema Design

### Model Change (Single Column Addition)

```typescript
// settings table — NEW column
notificationPreferences: jsonb('notification_preferences') // nullable
```

### JSONB Structure

```json
{
  "inApp": {
    "appointment_created": true,
    "appointment_rescheduled": true,
    "appointment_confirmed": false,
    "test_report_uploaded": true
  },
  "push": {
    "appointment_created": true,
    "appointment_rescheduled": false,
    "appointment_confirmed": false,
    "test_report_uploaded": true
  }
}
```

Users only store keys they've changed. Missing keys = role default applies.

---

## Role-Based Defaults

### Non-Configurable (Always ON — Cannot Be Disabled)

| Notification Type      | Reason                                     |
| ---------------------- | ------------------------------------------ |
| `appointment_canceled` | Business-critical for all parties          |
| `payment_received`     | Financial confirmation — legal requirement |
| `appointment_no_show`  | Staff must always be informed              |

### Default Preferences by Role

#### Admin
| Type                    | In-App      | Push        |
| ----------------------- | ----------- | ----------- |
| appointment_created     | ✅           | ✅           |
| appointment_rescheduled | ✅           | ✅           |
| appointment_confirmed   | ✅           | ❌           |
| appointment_canceled    | 🔒 Always ON | 🔒 Always ON |
| appointment_no_show     | 🔒 Always ON | 🔒 Always ON |
| payment_received        | 🔒 Always ON | ✅           |
| test_log_created        | ✅           | ❌           |
| test_report_uploaded    | ✅           | ❌           |
| user_created            | ✅           | ✅           |

#### Doctor
| Type                    | In-App      | Push        |
| ----------------------- | ----------- | ----------- |
| appointment_created     | ✅           | ✅           |
| appointment_rescheduled | ✅           | ✅           |
| appointment_confirmed   | ✅           | ❌           |
| appointment_canceled    | 🔒 Always ON | 🔒 Always ON |
| appointment_no_show     | 🔒 Always ON | 🔒 Always ON |
| test_assigned_to_lab    | ✅           | ❌           |
| test_report_uploaded    | ✅           | ✅           |
| pdf_ready               | ✅           | ❌           |

#### Patient
| Type                    | In-App      | Push        |
| ----------------------- | ----------- | ----------- |
| appointment_created     | ✅           | ✅           |
| appointment_rescheduled | ✅           | ✅           |
| appointment_confirmed   | ✅           | ✅           |
| appointment_canceled    | 🔒 Always ON | 🔒 Always ON |
| payment_received        | 🔒 Always ON | 🔒 Always ON |
| test_report_uploaded    | ✅           | ✅           |
| pdf_ready               | ✅           | ✅           |

#### Receptionist
| Type                    | In-App      | Push        |
| ----------------------- | ----------- | ----------- |
| appointment_created     | ✅           | ✅           |
| appointment_rescheduled | ✅           | ❌           |
| appointment_confirmed   | ✅           | ❌           |
| appointment_canceled    | 🔒 Always ON | 🔒 Always ON |
| appointment_no_show     | 🔒 Always ON | ✅           |
| payment_received        | ✅           | ❌           |

#### Lab_Assistant
| Type                 | In-App | Push |
| -------------------- | ------ | ---- |
| test_log_created     | ✅      | ✅    |
| test_assigned_to_lab | ✅      | ✅    |
| test_report_uploaded | ✅      | ❌    |

---

## API Design

### Endpoints

| Method | Path                                                 | Description                                                    |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------- |
| `GET`  | `/api/v1/settings/notification-preferences`          | Get resolved preferences (defaults merged with user overrides) |
| `PUT`  | `/api/v1/settings/notification-preferences`          | Update user's notification preferences                         |
| `GET`  | `/api/v1/settings/notification-preferences/defaults` | Get available notification types & defaults for caller's role  |

### GET Response Example

```json
{
  "success": true,
  "data": {
    "inApp": {
      "appointment_created": { "enabled": true, "configurable": true },
      "appointment_canceled": { "enabled": true, "configurable": false },
      "payment_received": { "enabled": true, "configurable": false },
      "test_report_uploaded": { "enabled": true, "configurable": true }
    },
    "push": {
      "appointment_created": { "enabled": true, "configurable": true },
      "appointment_canceled": { "enabled": true, "configurable": false },
      "payment_received": { "enabled": true, "configurable": false },
      "test_report_uploaded": { "enabled": false, "configurable": true }
    }
  }
}
```

### PUT Request Example

```json
{
  "inApp": {
    "appointment_created": false,
    "test_report_uploaded": false
  },
  "push": {
    "appointment_created": false
  }
}
```

Non-configurable types are silently ignored if included in the request.

---

## Caching Strategy

```
┌─────────────┐    cache miss    ┌──────────────┐
│   Redis     │ ◄──────────────► │  PostgreSQL  │
│             │                  │  (settings)  │
│ Key: notif_ │    cache hit     └──────────────┘
│ prefs:{uid} │ ──────────────►  Return cached
│ TTL: 5 min  │
└─────────────┘
        │
        │ invalidate on PUT
        ▼
   Delete key on preference update
```

- **Cache hit**: 0 DB calls for preference resolution
- **Cache miss**: 1 DB call (same query that fetches existing settings)
- **Invalidation**: On `PUT /notification-preferences` → delete Redis key
- **TTL**: 5 minutes (auto-expire even without explicit invalidation)

---

## Implementation Plan

### Phase 1: Foundation (Model + Constants + Migration)
1. ✅ Add `notificationPreferences` JSONB column to `SettingModel`
2. Create role-based defaults constant file
3. Create SQL migration file
4. Add Zod validation schema for preferences

### Phase 2: API Layer
5. Add `getNotificationPreferences` service method
6. Add `updateNotificationPreferences` service method
7. Add controller handlers
8. Add routes + OpenAPI docs

### Phase 3: Enforcement (Global Application)
9. Create `resolveNotificationPreferences()` utility
10. Add Redis caching layer for preferences
11. Modify `sendNotificationToUser()` to check preferences before delivery
12. Add preference check before SNS push delivery

### Phase 4: Testing & Verification
13. Verify existing notifications still work (backwards compatible)
14. Test new user with NULL preferences (defaults apply)
15. Test partial override scenarios
16. Test non-configurable types cannot be disabled

---

## Rating & Justification

### Overall Rating: 8.5/10

| Aspect                      | Score | Notes                                                    |
| --------------------------- | ----- | -------------------------------------------------------- |
| **Performance**             | 9/10  | Zero extra DB calls on hot path with caching             |
| **Simplicity**              | 9/10  | One column, one constant, one utility function           |
| **Flexibility**             | 8/10  | Easy to add types; limited cross-user querying           |
| **Maintainability**         | 8/10  | Clear separation: defaults in code, overrides in DB      |
| **Backwards Compatibility** | 10/10 | NULL = old behavior (all enabled), zero breaking changes |
| **Scalability**             | 8/10  | Redis cache handles high throughput; JSONB doesn't bloat |
| **Developer Experience**    | 8/10  | Frontend gets clean API; backend logic is centralized    |

### Why not 10/10?

- JSONB loses strict DB-level type safety (mitigated by Zod validation)
- Can't efficiently query "all users who disabled X" without scanning (acceptable trade-off)
- If preference categories grow to 50+, JSONB object gets large (unlikely for this domain)

### Why this is the right choice for MediSetu:

1. **Clinic software is latency-sensitive** — doctors and receptionists use this in real-time during patient flow. Extra DB queries per notification = slower UX.
2. **User base is bounded** — clinics have finite staff. You won't hit JSONB size limits.
3. **Notification types evolve** — healthcare features grow fast. JSONB adapts without migrations.
4. **Existing architecture supports it** — settings row already loaded, Redis already in place, Kafka already handles delivery. This plugs in cleanly.

---

## Migration SQL

```sql
ALTER TABLE settings
ADD COLUMN notification_preferences JSONB DEFAULT NULL;

COMMENT ON COLUMN settings.notification_preferences IS
  'User notification preferences. NULL = use role-based defaults. Structure: { inApp: { type: bool }, push: { type: bool } }';
```

---

## Files to Create/Modify

| File                                                  | Action     | Description                                      |
| ----------------------------------------------------- | ---------- | ------------------------------------------------ |
| `src/main/settings/models/setting.model.ts`           | ✅ Modified | Added JSONB column                               |
| `src/utils/notificationPreferences.constants.ts`      | Create     | Role defaults + non-configurable list            |
| `src/utils/notificationPreferences.utils.ts`          | Create     | Resolve + merge preferences utility              |
| `src/main/settings/schemas/setting.schemas.ts`        | Modify     | Add Zod schema for preferences                   |
| `src/main/settings/services/setting.service.ts`       | Modify     | Add get/update preference methods                |
| `src/main/settings/controllers/setting.controller.ts` | Modify     | Add preference handlers                          |
| `src/main/settings/routes/v1/settings.route.ts`       | Modify     | Add preference routes                            |
| `src/utils/notification.utils.ts`                     | Modify     | Add preference check in `sendNotificationToUser` |
| Migration SQL file                                    | Create     | ALTER TABLE for new column                       |

---

## Conclusion

This approach delivers maximum customization with minimum infrastructure change. One column, one cache key, one utility function — globally applied across the entire notification system without touching individual notification senders.
