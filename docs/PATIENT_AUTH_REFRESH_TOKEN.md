# Patient App — Access & Refresh Token Integration Guide

## Overview

Patient login (mobile OTP) now issues **two tokens** instead of one:

| Token | Lifetime | Purpose |
|---|---|---|
| `accessToken` | 15 minutes | Sent as `Authorization: Bearer {accessToken}` on every API/socket call |
| `refreshToken` | 30 days | Never sent to business endpoints — only used to obtain a new `accessToken` |

The old single long-lived `token` field is gone. Every response that used to return `token` now returns `accessToken` + `refreshToken`.

**Why:** a 30-day access token that leaked (device theft, log capture, MITM on an unpinned connection) stayed valid for the full 30 days with no way to revoke it. Short-lived access tokens limit that exposure window to 15 minutes; the refresh token is rotated on every use and can be revoked server-side (logout, reuse detection).

**One session per platform:** logging in replaces only *that platform's* session, not every session the patient has. Concretely, `verify-otp` now takes an optional `platform` field (`"web"` | `"ios"` | `"android"`, defaults to `"web"`) — **the mobile app must send `platform: "ios"` or `platform: "android"`** so its session is tracked separately from the patient web portal. Get this wrong (e.g. app omits `platform` and it defaults to `"web"`) and logging into the app will silently kick the patient out of the web portal, or vice versa, the next time the evicted side tries to refresh.

- Logging into the **same platform twice** (e.g. app on phone A, then app on phone B) still evicts the first — one session per platform, not per physical device.
- Logging into **different platforms** (web + app) are independent — neither evicts the other.
- If a refresh token is detected as reused/stolen (§3), only that one platform's session is torn down — other platforms stay logged in.

---

## 1. Login Flow (unchanged endpoints, changed response shape)

### `POST /api/v1/patient/patient-auth/send-otp`
No change.

### `POST /api/v1/patient/patient-auth/verify-otp`

```
POST /api/v1/patient/patient-auth/verify-otp
Body: {
  "mobile": "9876543210",
  "otp": "123456",
  "platform": "android"   // "web" | "ios" | "android" — omit only for the web portal
}
```

**The mobile app must always send `platform: "ios"` or `platform: "android"`.** If omitted, it defaults to `"web"` and will collide with — and silently log out — the patient web portal session (see the note above).

**Response** (`data`):
```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "isNewUser": false,
  "user": {
    "id": "cf9d43dd-...",
    "mobile": "9876543210",
    "userType": "Patient",
    "userStatus": "Active"
  }
}
```

**Store both tokens securely** (Keychain/Keystore on native, httpOnly-equivalent secure storage on web — do not put the refresh token in a place readable by arbitrary JS/plugins if avoidable). Use `accessToken` for all subsequent `Authorization: Bearer` headers.

### `POST /api/v1/patient/patient-auth/resend-otp`
No change.

---

## 2. Using the Access Token

Same as before — every REST call and the socket handshake use `accessToken`:

```javascript
const socket = io('http://server:5000', {
  auth: { token: accessToken },
  transports: ['websocket'],
});
```

```javascript
fetch('/api/v1/patient/appointments/live-queue/{id}', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

The only behavior change: this token now expires after **15 minutes** instead of 7 days. You must implement the refresh flow below or the app will start getting `401`s ~15 minutes after login.

---

## 3. Refreshing the Access Token

### `POST /api/v1/users/refresh-token`

> Note: this is a shared endpoint under `/users/`, not `/patient/patient-auth/` — the same refresh mechanism is used for all user types (patient, doctor, staff, admin). There is nothing patient-specific to configure here.

```
POST /api/v1/users/refresh-token
Body: { "refreshToken": "eyJhbGciOi..." }
```

**Success response** (`data`):
```json
{
  "accessToken": "eyJ...new...",
  "refreshToken": "eyJ...new..."
}
```

**Replace both stored tokens with the ones in the response.** The old `refreshToken` is invalidated the moment this call succeeds (rotation) — do not reuse it.

**Error response:** `401` if the refresh token is expired, malformed, already used (rotated away), or unknown. Treat this as "session ended" — clear stored tokens and send the patient back to the mobile-OTP login screen.

> **Reuse detection:** if a refresh token that was already rotated away gets replayed (e.g. two devices/tabs racing, or a stolen token being used after the legitimate client already refreshed), the server treats it as a compromised session and **revokes every active refresh token for that patient** — all devices get logged out on their next refresh attempt. This is intentional; if you see users unexpectedly logged out across devices, check for duplicate/concurrent refresh calls in the client (see §5).

### Recommended client strategy

Pick one (or both):

1. **Reactive (simplest):** on any `401` from a business endpoint, call `/users/refresh-token`, retry the original request once with the new `accessToken`. If refresh also fails, log out.
2. **Proactive (smoother UX):** decode the `accessToken`'s JWT `exp` claim after login/refresh and schedule a refresh ~1 minute before it lapses, so requests never hit a 401 in the first place. Recommended for a mobile app where API calls are frequent (live-queue polling, sockets) — avoids the extra round-trip latency reactive retry adds to the *first* request after expiry.

Either way, **serialize refresh calls** — don't fire a `/users/refresh-token` request per failed API call if several fail around the same moment; share one in-flight refresh promise across them (see §5).

---

## 4. Logout

There are **two separate logout mechanisms** — call both:

### a) `POST /api/v1/patient/patient-auth/logout` (existing, patient-specific)
```
Headers: Authorization: Bearer {accessToken}
```
Clears the server-side Redis cache of the patient record. Requires a still-valid access token. Does **not** touch the refresh token — the access token itself remains cryptographically valid until it naturally expires (JWTs are stateless).

### b) `POST /api/v1/users/logout` (new, shared)
```
Body: { "refreshToken": "eyJhbGciOi..." }
```
Revokes the refresh token so it can never be exchanged for a new access token again. This is the call that actually **ends the session** rather than just clearing a cache. No `Authorization` header needed — the refresh token itself is the credential.

**On logout, call both, then clear local storage regardless of either response** (best-effort — a failed revoke call shouldn't block the user from logging out of the device):

```javascript
async function logout() {
  try {
    await fetch('/api/v1/patient/patient-auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch { /* ignore */ }

  try {
    await fetch('/api/v1/users/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch { /* ignore */ }

  clearStoredTokens();
  navigateToLogin();
}
```

---

## 5. Reference Implementation (React Native / fetch-based)

```javascript
let refreshPromise = null;

async function getValidAccessToken() {
  if (!isExpiredOrExpiringSoon(accessToken)) return accessToken;
  return refreshAccessToken();
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise; // dedupe concurrent refreshes

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/users/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: getStoredRefreshToken() }),
      });

      if (!res.ok) {
        await forceLogout(); // refresh token dead — session over
        return null;
      }

      const { data } = await res.json();
      storeTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function apiCall(path, options = {}) {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) throw new Error('Session expired');
    return fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${newToken}` },
    });
  }

  return res;
}
```

The socket connection should re-authenticate with the new `accessToken` after a refresh (reconnect with updated `auth.token`, or emit an app-level re-auth event if the backend socket layer expects one) — a stale token on an already-established socket connection won't retroactively fail until the socket layer re-validates it, but any reconnect (app resume, network drop) will use whatever token is currently stored, so keep the stored value current.

---

## 6. What Changed vs. What Didn't

| | Before | After |
|---|---|---|
| Login response field | `token` | `accessToken` + `refreshToken` |
| Access token lifetime | 7 days | 15 minutes |
| Refresh mechanism | none | `POST /api/v1/users/refresh-token`, rotates on every call |
| Revocation | none (token valid until natural expiry) | `POST /api/v1/users/logout` revokes that platform's refresh token; reuse of a rotated token revokes that platform's session only |
| `send-otp` / `resend-otp` | unchanged | unchanged |
| Socket auth | `auth: { token }` | same shape, just pass `accessToken` and keep it refreshed |
| Concurrent devices | any number, all valid indefinitely | one session per **platform** — web + app both stay logged in simultaneously; a second login on the *same* platform evicts the first |
