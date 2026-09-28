# Google Social Login — Frontend Integration Guide

This backend supports Google Sign-In from **Web**, **iOS**, and **Android** apps. Each platform uses its own OAuth Client ID configured in Google Cloud Console.

---

## API Endpoint

```
POST /api/v1/users/social-login?device=web|ios|android
```

### Request Body

```json
{
  "provider": "google",
  "idToken": "<google_id_token>",
  "device": "web" // optional, can also be passed as query param
}
```

### Query Parameter

| Param    | Values                  | Default |
| -------- | ----------------------- | ------- |
| `device` | `web`, `ios`, `android` | `web`   |

The `device` query param takes priority over the body field.

### Response

```json
{
  "success": true,
  "user": { "id": "...", "name": "...", "email": "...", ... },
  "token": "jwt_token_here",
  "isFirstLogin": true
}
```

---

## Google Cloud Console Setup

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create **3 separate OAuth 2.0 Client IDs**:
   - **Web application** → use for web frontend
   - **iOS** → use for iOS app
   - **Android** → use for Android app
3. Add the client IDs to your backend `.env`:

```env
GOOGLE_CLIENT_ID=<web_client_id>
GOOGLE_CLIENT_ID_IOS=<ios_client_id>
GOOGLE_CLIENT_ID_ANDRIOD=<android_client_id>
```

---

## Android Integration (React Native)

### 1. Install the package

```bash
npm install @react-native-google-signin/google-signin
```

### 2. Configure in `android/app/build.gradle`

Make sure you have Google Play Services:

```gradle
dependencies {
    implementation 'com.google.android.gms:play-services-auth:20.7.0'
}
```

### 3. Add SHA-1 fingerprint to Google Cloud Console

```bash
# Debug key
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# Release key
keytool -list -v -keystore your-release-key.keystore -alias your-alias
```

Add the SHA-1 to your Android OAuth client in Google Cloud Console.

### 4. Frontend Code (React Native)

```typescript
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

// Configure once (e.g., in App.tsx or auth module)
GoogleSignin.configure({
  webClientId: 'YOUR_WEB_CLIENT_ID', // Yes, use the WEB client ID here
  offlineAccess: false,
});

// Sign-in handler
async function handleGoogleSignIn() {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo.idToken;

    if (!idToken) {
      throw new Error('No ID token received from Google');
    }

    // Call your backend
    const response = await fetch(
      'https://your-api.com/api/v1/users/social-login?device=android',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          idToken: idToken,
        }),
      }
    );

    const data = await response.json();
    // Store data.token for authenticated requests
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      console.log('User cancelled sign-in');
    } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      console.log('Play services not available');
    } else {
      console.error('Google sign-in error:', error);
    }
  }
}
```

> **Important:** Even on Android, `GoogleSignin.configure()` uses the **web** client ID as `webClientId`. Google's SDK uses this to generate an ID token whose `aud` claim matches the **Android** client ID. The backend verifies against `GOOGLE_CLIENT_ID_ANDRIOD`.

---

## iOS Integration (React Native)

### 1. Install the package

```bash
npm install @react-native-google-signin/google-signin
cd ios && pod install
```

### 2. Add URL scheme to `ios/YourApp/Info.plist`

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.googleusercontent.apps.YOUR_IOS_CLIENT_ID_REVERSED</string>
    </array>
  </dict>
</array>
```

The reversed client ID looks like: `com.googleusercontent.apps.905018528426-jm9g0n59uspqru324rlommfvqo8v9f3g`

### 3. Frontend Code (React Native)

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// Configure once
GoogleSignin.configure({
  iosClientId: 'YOUR_IOS_CLIENT_ID', // The iOS OAuth client ID
  offlineAccess: false,
});

// Sign-in handler
async function handleGoogleSignIn() {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo.idToken;

    if (!idToken) {
      throw new Error('No ID token received from Google');
    }

    // Call your backend
    const response = await fetch(
      'https://your-api.com/api/v1/users/social-login?device=ios',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          idToken: idToken,
        }),
      }
    );

    const data = await response.json();
    // Store data.token for authenticated requests
  } catch (error) {
    console.error('Google sign-in error:', error);
  }
}
```

---

## Web Integration (React / Next.js)

### 1. Install Google Identity Services

Add to your `index.html`:

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

Or use the npm package:

```bash
npm install @react-oauth/google
```

### 2. Frontend Code (React)

```typescript
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';

function App() {
  return (
    <GoogleOAuthProvider clientId="YOUR_WEB_CLIENT_ID">
      <GoogleLogin
        onSuccess={async (credentialResponse) => {
          const idToken = credentialResponse.credential;

          const response = await fetch(
            'https://your-api.com/api/v1/users/social-login?device=web',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: 'google',
                idToken: idToken,
              }),
            }
          );

          const data = await response.json();
          // Store data.token for authenticated requests
        }}
        onError={() => console.log('Login Failed')}
      />
    </GoogleOAuthProvider>
  );
}
```

---

## Flutter Integration

### Android Setup

Add to `android/app/build.gradle`:

```gradle
dependencies {
    implementation 'com.google.android.gms:play-services-auth:20.7.0'
}
```

### iOS Setup

Add your iOS client ID reversed URL scheme in `ios/Runner/Info.plist` (same as React Native above).

### Dart Code

```dart
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:io';

final GoogleSignIn _googleSignIn = GoogleSignIn(
  scopes: ['email', 'profile'],
  // Use server client ID (web) for Android, iOS client ID for iOS
  serverClientId: 'YOUR_WEB_CLIENT_ID',
);

Future<void> handleGoogleSignIn() async {
  try {
    final GoogleSignInAccount? account = await _googleSignIn.signIn();
    if (account == null) return; // User cancelled

    final GoogleSignInAuthentication auth = await account.authentication;
    final String? idToken = auth.idToken;

    if (idToken == null) throw Exception('No ID token');

    // Determine device
    final String device = Platform.isIOS ? 'ios' : 'android';

    final response = await http.post(
      Uri.parse('https://your-api.com/api/v1/users/social-login?device=$device'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'provider': 'google',
        'idToken': idToken,
      }),
    );

    final data = jsonDecode(response.body);
    // Store data['token'] for authenticated requests
  } catch (e) {
    print('Google sign-in error: $e');
  }
}
```

---

## Troubleshooting

| Error                                   | Cause                           | Fix                                                      |
| --------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| `Invalid Google token`                  | Wrong client ID for the device  | Ensure `?device=` matches the platform sending the token |
| `Google social login is not configured` | Missing env var                 | Check that the relevant `GOOGLE_CLIENT_ID_*` is set      |
| `DEVELOPER_ERROR` (Android)             | SHA-1 not registered            | Add debug/release SHA-1 to Google Cloud Console          |
| No ID token on Android                  | Missing `webClientId` in config | Pass the **web** client ID in `GoogleSignin.configure()` |
| No ID token on iOS                      | Missing `iosClientId` in config | Pass the **iOS** client ID in `GoogleSignin.configure()` |

---

## How It Works (Backend Flow)

```
Client (iOS/Android/Web)
  │
  ├─ Gets idToken from Google SDK
  │
  ├─ POST /api/v1/users/social-login?device=ios
  │   Body: { provider: "google", idToken: "..." }
  │
  └─► Backend
        │
        ├─ Reads `device` from query/body (default: "web")
        ├─ Picks the correct GOOGLE_CLIENT_ID_* env var
        ├─ Verifies idToken signature + audience against that client ID
        ├─ Creates or finds user
        └─ Returns JWT token
```
