# Clinic ETA — Architecture & Technical Documentation

## Overview

Given a patient's current lat/long, estimates travel time to a clinic for 4 vehicle modes
(car, bike, walking, transit) and returns a shareable Google Maps directions link. Delivered
over Socket.io only — there is no REST endpoint for this feature.

Two entry points, both patient-authenticated sockets:

1. **`join.live-queue`** (`src/socket/socketManager.ts`) — optionally accepts `latitude`/`longitude`
   alongside the existing `appointmentId`. When present, the `queue.update` payload gets an
   extra `eta` field, computed once at join time. See `docs/PATIENT_APP_INTEGRATION.md` §2b.
2. **`clinic.eta`** (`src/socket/socketManager.ts`) — standalone, repeatable event: `{ clinicId, latitude, longitude }`
   in, `clinic.eta.result` (and ack) out. Not tied to an appointment or room; intended for
   polling while the patient is en route.

Both paths delegate all computation to `src/main/clinic/services/distance.service.ts`.

---

## File Structure

```
src/main/clinic/
├── models/
│   └── clinic.model.ts              # ClinicModel.latitude / .longitude (doublePrecision, nullable)
├── services/
│   ├── clinic.service.ts            # invalidates `clinic_geo:{clinicId}` on clinic update
│   └── distance.service.ts          # getClinicCoordinates(), computeClinicEta()
src/socket/socketManager.ts          # `join.live-queue` (optional eta) + `clinic.eta` handlers
src/utils/envConfig.ts               # GOOGLE_MAPS_API_KEY (optional)
```

---

## Data Source Strategy — Google API with Haversine Fallback

Per vehicle mode, independently:

1. If `GOOGLE_MAPS_API_KEY` is configured, call the Google Distance Matrix API
   (`https://maps.googleapis.com/maps/api/distancematrix/json`) with `mode` mapped as:
   `car→driving`, `bike→bicycling`, `walking→walking`, `transit→transit`.
2. If the key isn't configured, the call fails, times out (5s), or Google returns a
   non-`OK` element status — fall back to a **haversine straight-line distance** divided by
   an assumed average speed for that mode:

   | Mode    | Assumed avg speed (km/h) |
   | ------- | ------------------------- |
   | car     | 35                         |
   | bike    | 18                         |
   | walking | 5                          |
   | transit | 25                         |

Each `vehicles[]` entry carries `source: 'google' | 'estimate'` so the caller knows which
path produced it — this is informational/logging only, **not** meant to be shown differently
in the patient-facing UI (see `PATIENT_APP_INTEGRATION.md` §2b field notes).

The top-level `distanceKm` in the response is always the haversine straight-line distance
(patient → clinic), independent of per-vehicle routed distances.

`mapsShareUrl` is a static Google Maps directions deep link
(`https://www.google.com/maps/dir/?api=1&origin={lat,lng}&destination={lat,lng}`) — does not
require the Google Maps API key, works purely from the two coordinate pairs.

**Why hybrid instead of Google-only or estimate-only:** Google gives real routing distance/time
when available, but requiring an API key/billing to be configured in every environment
(dev/staging/prod) would make the feature non-functional out of the box. The haversine
fallback keeps it usable everywhere; Google, when configured, transparently improves accuracy
per-mode without any caller-side changes.

---

## Caching — `clinic_geo:{clinicId}`

Clinic lat/long rarely changes, so both `join.live-queue` and `clinic.eta` resolve
coordinates through a single cached helper instead of hitting Postgres on every call:

```
getClinicCoordinates(clinicId) → { found: boolean; coordinates: {latitude, longitude} | null }
```

| Aspect       | Detail                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| Redis key    | `clinic_geo:{clinicId}`                                                 |
| TTL          | 1 hour                                                                   |
| Cached value | JSON-serialized `{ found, coordinates }` — **caches both hits and misses/nulls**, so a nonexistent clinic or one without coordinates doesn't repeatedly hit the DB either |
| Invalidation | Explicitly `del`'d in `clinic.service.ts` (`updateClinicById`) alongside `clinic_details:{clinicId}` whenever clinic profile fields — including lat/long — are updated |
| Fallback     | Redis unavailable → falls through to a direct DB `select`, result still returned (just not cached for that call) |

**Why cache `found`/`coordinates` as one object instead of just the coordinates:** so the
socket handlers can still distinguish "clinic not found" (404-equivalent) from "clinic exists
but has no location configured" (a normal, expected state for clinics that haven't set it up)
without a second query — both branches need different user-facing error messages (see
`PATIENT_APP_INTEGRATION.md` §2b error table).

Google Distance Matrix responses themselves are **not** cached — each `clinic.eta` /
`join.live-queue` call with fresh coordinates makes a fresh routing call per mode (patient
location changes between calls, so caching the route result wouldn't be valid).

---

## Request Flow

```
Patient app: navigator.geolocation → { latitude, longitude }
    │
    ├── socket.emit('join.live-queue', { appointmentId, latitude, longitude })
    │       │
    │       ├── existing appointment/ownership/today/active validation (unchanged)
    │       ├── computeLiveQueuePayload(...)              (existing)
    │       ├── IF coords valid: getClinicCoordinates(clinicId) → computeClinicEta(...)
    │       └── socket.emit('queue.update', { ...existing fields, eta? })
    │
    └── socket.emit('clinic.eta', { clinicId, latitude, longitude })
            │
            ├── auth + payload validation
            ├── getClinicCoordinates(clinicId)
            ├── computeClinicEta(clinicId, patientCoords, clinicCoords)
            └── socket.emit('clinic.eta.result', result) + ack({status:'success', data: result})
```

---

## Error Handling

| Failure                                  | Behavior                                                          |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Not authenticated                         | `ack({status:'error', message:'authentication required'})`, no emit |
| Missing/invalid `clinicId`/coords         | `ack({status:'error', ...})`, no emit                                |
| Coordinates out of range (±90 / ±180)     | `ack({status:'error', message:'Invalid coordinates'})`               |
| Clinic doesn't exist                      | `ack({status:'error', message:'Clinic not found'})`                  |
| Clinic exists, no lat/long configured     | `ack({status:'error', message:'Clinic location is not configured'})` — `join.live-queue` instead just omits `eta` and proceeds normally |
| Google API down/misconfigured/times out (5s) | Silent per-mode fallback to haversine estimate — never surfaced as an error, never blocks the response |
| Redis down                                | `getClinicCoordinates` falls through to direct DB read              |
| Unexpected exception                      | Logged (`logger.error('[SocketManager] clinic.eta error', err)`), `ack({status:'error', message: String(err)})` |

---

## Configuration

| Env var               | Required? | Effect                                                                 |
| ---------------------- | --------- | ------------------------------------------------------------------------- |
| `GOOGLE_MAPS_API_KEY`  | No        | When set, `vehicles[].source` becomes `"google"` (real routing) whenever that mode's API call succeeds; unset → always `"estimate"` (haversine + assumed speed) |

No migration needed — `latitude`/`longitude` already existed on `ClinicModel` prior to this
feature (used for clinic search/onboarding).

---

## Future Modification Guide

- **Adding a vehicle mode:** add to `TravelMode`, `GOOGLE_TRAVEL_MODE`, and
  `FALLBACK_AVG_SPEED_KMH` in `distance.service.ts` — both call sites pick it up automatically
  via `TRAVEL_MODES`.
- **Changing fallback speeds:** edit `FALLBACK_AVG_SPEED_KMH` in `distance.service.ts`.
- **Changing the geo cache TTL:** `CLINIC_GEO_CACHE_TTL_SECONDS` in `distance.service.ts`.
- **Adding a REST equivalent:** wrap `getClinicCoordinates` + `computeClinicEta` in a
  controller under `src/main/clinic/controllers/` — the service functions have no socket
  dependency and can be reused directly.
