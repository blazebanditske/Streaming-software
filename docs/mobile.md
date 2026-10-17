# Mobile app (Android + iOS)

## What it is

The mobile app is the same studio UI, wrapped with Capacitor so it installs as a real app.
On first launch it asks for the address of a studio server you run, health-checks it, and
then loads the real UI in a WebView.

```
phone app  ──HTTP──▶  studio server on your computer  ──RTMP──▶  platforms
```

## Why the app does not run the server itself

It would be convenient if the phone could fan out on its own. It cannot, for three reasons:

1. **No long-running RTMP encoder.** A WebView has no access to a system encoder, and the
   JS ecosystem has no production-grade RTMP muxer for mobile.
2. **The OS will suspend it.** iOS suspends background execution aggressively; Android
   (especially with modern Doze behaviour) is only slightly better. A stream that dies when
   the screen locks is not a stream.
3. **Fan-out belongs where the CPU is.** One encode serving four platforms wants a machine
   that stays awake. A laptop, a desktop, a mini PC, or a Raspberry Pi 4 all do this well.

So the phone is a **camera source and a remote control**, which is genuinely useful: you can
check status, add a destination, or start and stop the stream from the couch.

## Build

```bash
cd mobile
npm install

# Android
npm run add:android
npm run build:android          # -> android/app/build/outputs/apk/debug/

# iOS (macOS with Xcode only)
npm run add:ios
npm run open:ios
```

Requirements: **JDK 17+**, **Android SDK** (via Android Studio) for Android; **Xcode 15+** on
a Mac for iOS. Neither is present in the environment this repository was authored in, so the
native projects are generated on first `cap add` rather than committed.

## Permissions

Add these to `android/app/src/main/AndroidManifest.xml` after `cap add android`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
```

For iOS, add to `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Used to show your camera preview in the studio.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Used to capture your microphone for the stream.</string>
```

Without these, `getUserMedia` fails silently inside the WebView — a common and confusing
first-run problem.

## Connecting to your server

The app needs to reach your studio server, so:

- **Same Wi-Fi**: use the computer's LAN address, e.g. `http://192.168.1.20:8080`.
- **Away from home**: put both on a VPN (Tailscale is the least fiddly), or front the
  server with TLS and authentication.

Cleartext HTTP is blocked by default on modern Android. For LAN use, either enable it for
your local network in `network_security_config.xml`, or terminate TLS properly — which you
should do anyway if the server is reachable beyond your home network. The studio API has no
authentication; see `security.md` before exposing it.

## Current status

The Capacitor config, the mobile UI, and the connection flow are complete and the JS is
syntax-checked. The native Android and iOS projects are not built in this repository because
the toolchain is not available here. Running `npm run add:android` produces them.
