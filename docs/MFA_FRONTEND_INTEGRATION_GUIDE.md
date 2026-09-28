# MFA Frontend Integration Guide

This document provides step-by-step integration instructions for the frontend, including exact API routes, request/response formats, headers, error codes, and flow logic.

---

## Base URL

```
/api/v1/mfa
```

---

## Authentication Headers

There are **two types of tokens** used in MFA flows:

| Token Type              | When Used                                                                             | Header Format                        |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| **Full-access JWT**     | All MFA management endpoints (enable, verify-enrollment, disable, regenerate, status) | `Authorization: Bearer <full_jwt>`   |
| **Temporary MFA Token** | Only during login MFA verification (verify-login, recovery-login)                     | `Authorization: Bearer <temp_token>` |

> **Important:** The temp token has a **5-minute expiry** and scope `mfa_verification`. It can ONLY be used for `/verify-login` and `/recovery-login`. Using it on any other endpoint will return 401.

---

## Flow 1: Login (Modified for MFA)

### Step 1 — Primary Login

```
POST /api/v1/auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "userPassword123"
}
```

**Response A — MFA NOT enabled (no change from before):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "user@example.com",
    "userStatus": "Active",
    "emailVerifiedAt": "2024-01-01T00:00:00.000Z",
    "userType": "Admin"
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "isFirstLogin": false
}
```

**Response B — MFA IS enabled:**
```json
{
  "success": true,
  "mfaRequired": true,
  "tempToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Frontend Logic:**
```
if (response.mfaRequired === true) {
  // Store tempToken in memory (NOT localStorage)
  // Navigate to MFA verification page
} else {
  // Store full JWT, navigate to dashboard (existing flow)
}
```

---

### Step 2A — Verify TOTP Code During Login

```
POST /api/v1/mfa/verify-login
Authorization: Bearer <tempToken>
```

**Request Body:**
```json
{
  "totpCode": "123456"
}
```

**Validation:** Must be exactly 6 digits (`/^\d{6}$/`)

**Success Response (200):**
```json
{
  "success": true,
  "message": "MFA verification successful."
}
```

> **NOTE:** The current implementation returns success confirmation. After this succeeds, the frontend should receive/issue the full-access JWT. Check if your backend has been updated to return the token here, or if you need to call a separate token-exchange endpoint. Based on the design spec, this endpoint should return the full JWT — if it doesn't yet, coordinate with backend to add `token` and `user` to this response.

**Error Responses:**

| Status | Body                                                                                          | When                             |
| ------ | --------------------------------------------------------------------------------------------- | -------------------------------- |
| 401    | `{ "success": false, "message": "Invalid verification code" }`                                | Wrong TOTP code                  |
| 401    | `{ "success": false, "message": "MFA verification session expired. Please log in again" }`    | Temp token expired (>5 min)      |
| 401    | `{ "success": false, "message": "Authorization token missing" }`                              | No token provided                |
| 429    | `{ "success": false, "message": "Too many verification attempts. Try again in 847 seconds" }` | Rate limited (5 attempts/15 min) |

---

### Step 2B — Use Recovery Code During Login (Alternative)

```
POST /api/v1/mfa/recovery-login
Authorization: Bearer <tempToken>
```

**Request Body:**
```json
{
  "recoveryCode": "Ab3kM9xZ"
}
```

**Validation:** Must be exactly 8 alphanumeric characters (`/^[a-zA-Z0-9]{8}$/`)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Recovery code verified successfully.",
  "data": {
    "remainingCodes": 7,
    "warning": null
  }
}
```

**Success Response with Warning (remaining < 3):**
```json
{
  "success": true,
  "message": "Recovery code verified successfully.",
  "data": {
    "remainingCodes": 2,
    "warning": "Only 2 recovery codes remaining. Please regenerate your codes."
  }
}
```

**Success Response with Warning (last code used):**
```json
{
  "success": true,
  "message": "Recovery code verified successfully.",
  "data": {
    "remainingCodes": 0,
    "warning": "No recovery codes remaining. Please regenerate codes immediately."
  }
}
```

**Error Responses:**

| Status | Body                                                                                        | When                       |
| ------ | ------------------------------------------------------------------------------------------- | -------------------------- |
| 401    | `{ "success": false, "message": "Invalid recovery code" }`                                  | Wrong or already-used code |
| 401    | `{ "success": false, "message": "MFA verification session expired. Please log in again" }`  | Temp token expired         |
| 429    | `{ "success": false, "message": "Too many verification attempts. Try again in N seconds" }` | Rate limited               |

---

## Flow 2: Enable MFA (Account Settings)

### Step 1 — Initiate Enrollment

```
POST /api/v1/mfa/enable
Authorization: Bearer <full_jwt>
```

**Request Body:** None (empty body)

**Success Response (200):**
```json
{
  "success": true,
  "message": "MFA enrollment initiated. Scan the QR code with your authenticator app.",
  "data": {
    "otpauthUri": "otpauth://totp/MediSetu:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MediSetu",
    "base32Secret": "JBSWY3DPEHPK3PXP"
  }
}
```

**Frontend Logic:**
- Render `data.otpauthUri` as a QR code (use `qrcode.react` or similar library)
- Display `data.base32Secret` as plain text for manual entry
- Show input field for user to enter the 6-digit code from their authenticator app
- **Enrollment expires in 10 minutes** — show a countdown or warning

**Error Responses:**

| Status | Body                                                                        | When               |
| ------ | --------------------------------------------------------------------------- | ------------------ |
| 409    | `{ "success": false, "message": "MFA is already enabled on this account" }` | MFA already active |
| 401    | `{ "success": false, "message": "Authentication required" }`                | Not logged in      |

---

### Step 2 — Verify Enrollment (Complete Setup)

```
POST /api/v1/mfa/verify-enrollment
Authorization: Bearer <full_jwt>
```

**Request Body:**
```json
{
  "totpCode": "123456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "MFA has been successfully activated on your account.",
  "data": {
    "recoveryCodes": [
      "Ab3kM9xZ",
      "Pq7nR2wY",
      "Ks5mT8vX",
      "Lf9jW4uC",
      "Hn2bQ6tD",
      "Gx8cE1sA",
      "Dv4aF3rB",
      "Mw6dH5pN",
      "Ry1gJ7oK",
      "Tz3iL0nU"
    ]
  }
}
```

**Frontend Logic:**
- Display recovery codes in a modal/page
- Provide "Copy All" button
- Provide "Download as .txt" button
- Show strong warning: "Save these codes in a safe place. You won't be able to see them again."
- User must acknowledge before closing

**Error Responses:**

| Status | Body                                                                                            | When                  |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------- |
| 400    | `{ "success": false, "message": "No MFA enrollment in progress" }`                              | No pending enrollment |
| 400    | `{ "success": false, "message": "MFA enrollment has expired. Please start a new enrollment." }` | 10-min timeout passed |
| 401    | `{ "success": false, "message": "Invalid verification code" }`                                  | Wrong TOTP code       |

---

## Flow 3: Check MFA Status

```
GET /api/v1/mfa/status
Authorization: Bearer <full_jwt>
```

**Request Body:** None

**Response — MFA Enabled:**
```json
{
  "success": true,
  "data": {
    "mfaEnabled": true,
    "recoveryCodesRemaining": 8,
    "lastModifiedAt": "2024-06-15T10:30:00.000Z"
  }
}
```

**Response — MFA Never Enabled:**
```json
{
  "success": true,
  "data": {
    "mfaEnabled": false,
    "recoveryCodesRemaining": 0,
    "lastModifiedAt": null
  }
}
```

**Frontend Logic:**
- Call this on settings page load
- If `mfaEnabled: true` → show "Disable MFA" button + "Regenerate Recovery Codes" button + remaining codes count
- If `mfaEnabled: false` → show "Enable MFA" button

---

## Flow 4: Disable MFA

```
POST /api/v1/mfa/disable
Authorization: Bearer <full_jwt>
```

**Request Body:**
```json
{
  "password": "userCurrentPassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "MFA has been disabled on your account."
}
```

**Error Responses:**

| Status | Body                                                                                        | When                                 |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| 400    | `{ "success": false, "message": "MFA is not enabled on this account" }`                     | MFA not active                       |
| 401    | `{ "success": false, "message": "Invalid credentials" }`                                    | Wrong password                       |
| 429    | `{ "success": false, "message": "Too many verification attempts. Try again in N seconds" }` | 5 failed password attempts in 15 min |

**Frontend Logic:**
- Show confirmation dialog: "Are you sure? This will remove MFA from your account."
- Require password input
- On success, update MFA status in state
- Rate limit: 5 password attempts per 15 minutes

---

## Flow 5: Regenerate Recovery Codes

```
POST /api/v1/mfa/regenerate-recovery
Authorization: Bearer <full_jwt>
```

**Request Body:**
```json
{
  "totpCode": "123456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Recovery codes regenerated successfully.",
  "data": {
    "recoveryCodes": [
      "Nw8fK2mP",
      "Qx3gL5nR",
      "Sv7hM9oT",
      "Uy1iN4pV",
      "Wz6jO8qX",
      "Aa2kP3rY",
      "Bc5lQ7sZ",
      "De9mR1tA",
      "Fg4nS6uB",
      "Hi8oT2vC"
    ]
  }
}
```

**Error Responses:**

| Status | Body                                                                    | When            |
| ------ | ----------------------------------------------------------------------- | --------------- |
| 400    | `{ "success": false, "message": "MFA is not enabled on this account" }` | MFA not active  |
| 401    | `{ "success": false, "message": "Invalid verification code" }`          | Wrong TOTP code |

**Frontend Logic:**
- Show dialog asking for current TOTP code
- On success, display new recovery codes (same modal as enrollment)
- Warn: "Your old recovery codes are now invalid"

---

## Rate Limiting Summary

| Endpoint          | Limit      | Window     | Shared Counter                   |
| ----------------- | ---------- | ---------- | -------------------------------- |
| `/verify-login`   | 5 attempts | 15 minutes | Yes (shared with recovery-login) |
| `/recovery-login` | 5 attempts | 15 minutes | Yes (shared with verify-login)   |
| `/disable`        | 5 attempts | 15 minutes | Separate counter                 |

When rate limited, the response includes the seconds remaining:
```json
{
  "success": false,
  "message": "Too many verification attempts. Try again in 847 seconds"
}
```

**Frontend Logic:** Parse the seconds from the message or use the 429 status to show a countdown timer.

---

## Validation Rules (for frontend form validation)

| Field          | Rule                              | Regex                |
| -------------- | --------------------------------- | -------------------- |
| `totpCode`     | Exactly 6 digits                  | `/^\d{6}$/`          |
| `recoveryCode` | Exactly 8 alphanumeric characters | `/^[a-zA-Z0-9]{8}$/` |
| `password`     | Non-empty string (min 1 char)     | —                    |

---

## Frontend State Management Recommendations

```typescript
// Auth store additions
interface AuthState {
  // Existing
  token: string | null;        // Full-access JWT
  user: User | null;

  // New for MFA
  mfaPending: boolean;         // true when waiting for TOTP during login
  tempToken: string | null;    // Limited-scope token (5-min expiry)
  mfaStatus: {
    mfaEnabled: boolean;
    recoveryCodesRemaining: number;
    lastModifiedAt: string | null;
  } | null;
}
```

---

## Complete Login Flow Diagram

```
User enters email + password
        │
        ▼
POST /api/v1/auth/login
        │
        ├── response.mfaRequired === true
        │       │
        │       ▼
        │   Store tempToken in memory
        │   Navigate to /mfa-verify page
        │       │
        │       ├── User enters TOTP code
        │       │       │
        │       │       ▼
        │       │   POST /api/v1/mfa/verify-login
        │       │   Header: Authorization: Bearer <tempToken>
        │       │   Body: { "totpCode": "123456" }
        │       │       │
        │       │       ├── 200 OK → Get full JWT → Dashboard
        │       │       ├── 401 → Show "Invalid code" error
        │       │       └── 429 → Show rate limit countdown
        │       │
        │       └── User clicks "Use recovery code"
        │               │
        │               ▼
        │           POST /api/v1/mfa/recovery-login
        │           Header: Authorization: Bearer <tempToken>
        │           Body: { "recoveryCode": "Ab3kM9xZ" }
        │               │
        │               ├── 200 OK → Get full JWT → Dashboard
        │               │   (check data.warning for low codes)
        │               ├── 401 → Show "Invalid code" error
        │               └── 429 → Show rate limit countdown
        │
        └── response.mfaRequired !== true (normal login)
                │
                ▼
            Store token + user → Dashboard
```

---

## Complete MFA Settings Flow Diagram

```
User navigates to Security Settings
        │
        ▼
GET /api/v1/mfa/status
        │
        ├── mfaEnabled: false
        │       │
        │       ▼
        │   Show "Enable MFA" button
        │       │
        │       ▼ (user clicks)
        │   POST /api/v1/mfa/enable
        │       │
        │       ▼
        │   Show QR code (otpauthUri) + manual secret (base32Secret)
        │   Show TOTP input field
        │   ⏱️ 10-minute enrollment timeout
        │       │
        │       ▼ (user enters code)
        │   POST /api/v1/mfa/verify-enrollment
        │       │
        │       ├── 200 → Show recovery codes modal
        │       │         (Copy All / Download / Acknowledge)
        │       └── 401 → Show "Invalid code, try again"
        │
        └── mfaEnabled: true
                │
                ▼
            Show: "MFA Enabled ✓"
            Show: "Recovery codes remaining: X"
            Show: "Last modified: <date>"
                │
                ├── "Disable MFA" button
                │       │
                │       ▼
                │   Show password confirmation dialog
                │       │
                │       ▼
                │   POST /api/v1/mfa/disable
                │   Body: { "password": "..." }
                │       │
                │       ├── 200 → Update status, show success
                │       ├── 401 → "Wrong password"
                │       └── 429 → Rate limited
                │
                └── "Regenerate Recovery Codes" button
                        │
                        ▼
                    Show TOTP input dialog
                        │
                        ▼
                    POST /api/v1/mfa/regenerate-recovery
                    Body: { "totpCode": "123456" }
                        │
                        ├── 200 → Show new recovery codes modal
                        └── 401 → "Invalid code"
```

---

## Important Notes for Frontend Dev

1. **Temp token is short-lived (5 min):** Start a timer when you receive it. If it expires, redirect to login with a message like "Session expired, please log in again."

2. **Recovery codes are shown ONCE:** After enrollment or regeneration, the backend will never return them again. Make sure the UI forces the user to acknowledge/save them.

3. **Rate limiting is per-user, not per-session:** If the user gets rate-limited, switching browsers won't help. Show the countdown.

4. **The verify-login and recovery-login share a rate limit counter:** 5 total attempts across both endpoints within 15 minutes.

5. **Enrollment expires in 10 minutes:** If the user takes too long to scan the QR code and enter the TOTP, they'll need to start over. Consider showing a countdown.

6. **QR code rendering:** The `otpauthUri` is a standard URI format. Any QR code library can render it. Example with `qrcode.react`:
   ```jsx
   import { QRCodeSVG } from 'qrcode.react';
   <QRCodeSVG value={otpauthUri} size={200} />
   ```

7. **Recovery code format for display:** Show codes in a grid (2 columns × 5 rows) with monospace font for readability.

8. **Full JWT after MFA verification:** After successful `/verify-login` or `/recovery-login`, the backend should return the full JWT + user data (same shape as normal login). If it currently only returns `{ success: true }`, coordinate with backend to add `token` and `user` fields to the response.
