# Building ShieldGuard for Android

ShieldGuard is a Chrome extension; Android Chrome cannot run extensions. `android/` is a native
Kotlin app: a small browser (WebView) that applies ShieldGuard's rules.

## Easiest: build in the cloud (no Android tools needed)
1. Create a GitHub repo and upload this whole folder (`shieldguard/` contents at the repo root).
2. Open the **Actions** tab → **Build Android APK** → **Run workflow** (it also runs on every push).
3. When it finishes, download the **shieldguard-debug-apk** artifact and unzip it → `app-debug.apk`.

## Local build (Windows)
Install: Node 20+, JDK 17, Android Studio (installs the SDK), Gradle 8.7.
```
npm ci
npm run build:android-assets
cd android
gradle assembleDebug
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk` (debug build). Or open `android/` in Android Studio and press Run.

## Install on a phone
Copy the APK to the phone, open it, allow "install from this source" when asked.

## Release build
Create a keystore yourself (`keytool -genkey -v -keystore my.jks -alias sg -keyalg RSA -keysize 2048 -validity 10000`),
keep it out of git, and sign with Android Studio: Build → Generate Signed Bundle / APK.

## What it protects (and doesn't)
- Blocks requests to the ~44 ad/tracker/popup/security domains in `public/rules/*.json` (inside this app's browser only).
- Blocks window.open popups with no user tap; blocks non-web scheme redirects with no tap; blocks navigation to listed hosts.
- Runs the existing overlay filter on each page.
- NOT ported: popup-risk scoring, redirect-chain tracking, dashboard, profiles, stats history, subscriptions, site exceptions, custom rules, translations. Protection applies only to pages opened in this app, not other apps/browsers.
