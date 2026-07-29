# Bento Booking Mobile Release

## Current Output

- Web/PWA download page: `/app-download`
- Dynamic QR SVG: `/app-download/qr.svg`
- Store link environment variables:
  - `APP_PUBLIC_URL`
  - `IOS_APP_STORE_URL`
  - `ANDROID_PLAY_STORE_URL`

## App Store / Google Play Checklist

1. Deploy production web app with HTTPS and set `APP_PUBLIC_URL`.
2. Prepare native wrapper or store-ready mobile build:
   - iOS: Xcode archive signed with Apple Developer account.
   - Android: Android App Bundle signed for Google Play.
3. Prepare store assets:
   - App name: `Bento Booking`
   - Short description, full description, keywords.
   - App icon, screenshots for phone/tablet.
   - Privacy policy URL and support URL.
   - Data safety / privacy answers.
4. Submit:
   - App Store Connect for iOS.
   - Google Play Console for Android.
5. After approval, set:
   - `IOS_APP_STORE_URL=https://apps.apple.com/...`
   - `ANDROID_PLAY_STORE_URL=https://play.google.com/store/apps/details?id=...`
6. Restart the app so `/app-download` and QR point users to the official stores.

## Notes

- App Store and Google Play publishing cannot be completed from source code alone. It requires developer accounts, verified ownership, app signing, store metadata, privacy declarations, screenshots, and review approval.
- Until store links are available, QR points users to the PWA/Web App so the system is still usable across iOS, Android, and desktop.
