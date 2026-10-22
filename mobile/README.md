# Opulence Bliss Android

Two separately installable Android apps use the same secure booking backend:

- **Opulence Bliss**: `com.opulencebliss.app`, version 1.2.0 (code 3), starts at `/mobile/customer`. Home, Bookings, Inbox and Account. Customer sign-up has no professional recruitment or role switch.
- **Opulence Bliss Pro**: `com.opulencebliss.worker`, version 1.1.0 (code 2), starts at `/mobile/worker`. Today, Jobs, Inbox and Account, with availability, earnings and application details. Job tools remain protected by server approval checks.

The customer package and signing certificate are retained so it updates the first APK. The Pro app has a distinct launcher name, icon, shortcuts and verified link path, so both apps can be installed together. The apps do not change the user's shared website account or stored account mode.

Both use Android Browser Helper and dedicated app screens with touch navigation, safe-area spacing and keyboard-aware bottom tabs. They are web-backed apps, not a native offline booking engine. Google sign-in and Stripe Checkout still use secure browser flows. App presentation is scoped to the current app tab; a normal new website tab retains the website menus. No payment keys, service-role keys or passwords are embedded in either app.

## Build

1. Install JDK 17 and Android SDK platform 36, build-tools 36.1.0 and platform-tools.
2. Set `JAVA_HOME` and `ANDROID_HOME` to these installations.
3. Run `npm ci` inside `mobile` to install the pinned generator tools.
4. Run `npm run generate` only when regenerating the native source and icons.
5. Run `npm run build` inside `mobile` to build, lint, sign and verify the artifacts.

Artifacts go to `artifacts/android/` in the repository workspace and are not
committed. The Android source can also be opened in Android Studio.

## Signing and ownership

Private signing material is outside the repository, in the current Windows user's
`Documents/Opulence Bliss Android Signing` directory, with permissions restricted
to that user and SYSTEM. `OPULENCE_ANDROID_SIGNING_DIRECTORY` can override the path.
The local `signing.json` has the signing password and alias; the keystore is
`opulence-bliss.jks`. Do not commit or publish either file. Keep a secure backup
and hand them to the client through a secure method before production ownership
handover. The public fingerprint is in `android/signing-certificate.json`.

`https://www.opulencebliss.com/.well-known/assetlinks.json` must return both package identities with that
fingerprint without redirecting. It deliberately returns 404 on the admin host.
If Google Play App Signing uses a different certificate, add its app-signing
fingerprint to the website association before Play testing. Do not substitute the
upload-key fingerprint for the Play app-signing fingerprint.

## Offline and authentication

The service worker caches only the public offline help page. It never caches
accounts, bookings, payments, reviews, messages or API responses and never queues
mutations. Booking and payment operations require a connection. Registration is
restricted to the two public production domain names; admin and staging are excluded.

Production Supabase must allow `https://www.opulencebliss.com/**` as an authentication
return address. Checkout and billing return to the request's origin. No native
OAuth client or extra API keys are required by this browser-based app.

## Device acceptance checks before publishing

- Install the APK, verify the launch is full screen and the icon is legible.
- Test Back, rotation, keyboard, photo/file uploads and location permissions.
- Sign in with email and Google; sign out and sign in again.
- Check bookings in the customer app and approved jobs in the Pro app. Confirm neither exposes an account-mode switch.
- Verify pending applicants cannot enter job tools.
- Check offline screens do not claim that a booking or payment succeeded.
- Exercise Stripe card authentication and payment returns on a separate staging
  build with test keys. This production APK uses live website payments; never use
  a test card or make an unapproved live charge.
- Verify customer and professional deletion/data download screens.

An APK/AAB build is not a phone test or Play Store approval. Publishing still needs
the client's Play Console account, app signing setup, store artwork, privacy and
data-safety declarations, and an account-deletion web link. Held legal wording is
not changed by this app work. Notifications require an explicit in-app opt-in and
browser/system permission; neither app requests permission merely on launch.
