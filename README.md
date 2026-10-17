# Streaming Software

Free, simple, open-source multistreaming studio. Capture once on your machine, send it
to as many platforms as you want at the same time.

No account. No subscription. No cloud. No per-destination fee.

```
your camera / OBS ──RTMP──▶ studio (one ffmpeg) ──tee──┬──▶ YouTube
                                                       ├──▶ Twitch
                                                       ├──▶ Facebook Live
                                                       ├──▶ TikTok
                                                       └──▶ any RTMP server
```

---

## Why this exists

Every multistreaming service charges a monthly fee to relay a stream you are already
capable of relaying yourself. ffmpeg has shipped the `tee` muxer for years: it takes one
input and writes it to many outputs. That is the entire product. This project is a thin,
readable wrapper around that, plus a UI simple enough to use without touching a terminal.

The other half of why this exists is honesty about TikTok. A lot of tools advertise
"stream to TikTok without a stream key." What they actually do is lift your session token
out of a logged-in TikTok app and replay it against TikTok's private creator API to mint
a key you are not entitled to. That gets accounts restricted, and it breaks the platform's
terms. This project does not do that, and the [TikTok guide](docs/tiktok.md) explains the
real routes to eligibility instead.

---

## Quick start

Requires **Node.js 20+** and **ffmpeg** on your PATH.

```bash
git clone https://github.com/blazebanditske/streaming-software
cd streaming-software
npm install
npm start
```

Open <http://localhost:8080>.

1. Add a destination — pick a platform, paste your stream key, save.
2. Point your encoder at the ingest URL the UI shows:
   `rtmp://localhost:1935/live/studio`
3. Press **Go live**.

Each stream key is encrypted at rest with AES-256-GCM and is never returned to the
browser. The API only ever exposes a four-character fingerprint so you can tell two
destinations apart.

---

## Downloads

Signed and checksummed builds are attached to the
[v1.0.0 release](https://github.com/blazebanditske/Streaming-software/releases/tag/v1.0.0).

| Platform | File | Notes |
| --- | --- | --- |
| Windows 10/11 | [streaming-software-setup-0.1.0.exe](https://github.com/blazebanditske/Streaming-software/releases/download/v1.0.0/streaming-software-setup-0.1.0.exe) | NSIS installer, bundles the studio |
| Android 7.0+ | [streaming-software-1.0.apk](https://github.com/blazebanditske/Streaming-software/releases/download/v1.0.0/streaming-software-1.0.apk) | Signed release build |
| Any | [SHA256SUMS.txt](https://github.com/blazebanditske/Streaming-software/releases/download/v1.0.0/SHA256SUMS.txt) | Verify before running |

Verify a download:

```bash
sha256sum -c SHA256SUMS.txt
```

Neither build carries a paid code-signing certificate, so Windows SmartScreen and
Android will each show a warning the first time you run them. That is normal for
software distributed outside an app store; the checksums let you confirm the file
was not altered in transit.

### Android

The app is a Capacitor shell around the browser studio. It connects to a studio
server you run on your own network, then gives you a camera preview and a Go live
button. On first launch it requests camera and microphone permission — declining
leaves the preview black.

### Desktop

The desktop app is an Electron shell that starts the studio server as a child
process and opens the UI, so there is no separate `npm start` step. Build it
yourself:

```bash
cd desktop
npm install
npm run dist:win     # or dist:mac / dist:linux
```

Android rebuild:

```bash
cd mobile
npm ci
npx cap sync android
cd android && ./gradlew assembleDebug
```

Release builds read signing material from `mobile/android/keystore.properties`,
which is gitignored. Without it, `assembleRelease` produces an unsigned APK.

### Using OBS instead of the built-in camera

Settings → Stream → Service: **Custom…**

- Server: `rtmp://localhost:1935/live/studio`
- Stream Key: anything (the ingest does not check it)

Then press **Go live** in the studio UI. The studio fans out whatever arrives.

---

## Running it on other devices

| Platform | How |
| --- | --- |
| **Web** | `npm start`, open in any browser. This is the reference client. |
| **Desktop** | `cd desktop && npm install && npm start` — wraps the studio in a native window and supervises the server for you. `npm run dist` builds installers. |
| **Android / iOS** | `cd mobile && npm install && npm run add:android` (or `add:ios`), then `npm run build:android`. The app connects to a studio server you run. See [docs/mobile.md](docs/mobile.md). |

---

## Destinations

| Platform | RTMP URL | Where the key comes from |
| --- | --- | --- |
| YouTube | `rtmp://a.rtmp.youtube.com/live2` | Studio → Go Live → Stream settings |
| Twitch | `rtmp://live.twitch.tv/app` | Dashboard → Settings → Stream |
| Facebook Live | `rtmps://live-api-s.facebook.com:443/rtmp` | Live Producer → Streaming software |
| TikTok | *you supply it* | Live Center, **if your account is eligible** — see below |
| Custom | *you supply it* | Any RTMP endpoint: MediaMTX, nginx-rtmp, a friend's box |

Full detail, including per-platform gotchas: [docs/destinations.md](docs/destinations.md).

---

## About TikTok, plainly

TikTok does not offer a public API that hands third-party software a stream key. It gives
RTMP access to accounts that meet its eligibility rules (typically 1,000+ followers, 18+,
account in good standing). If you have that access, TikTok shows you a Server URL and a
Stream key in its Live Center — paste both here and it works exactly like any other
destination.

If you do not have access, this project will not manufacture it for you. There is no
supported technical path, and the tools that claim otherwise are using your session
credentials in ways that violate TikTok's terms and have a track record of getting users
shadowbanned. Read [docs/tiktok.md](docs/tiktok.md) for the legitimate routes.

---

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Studio UI / API port |
| `INGEST_PORT` | `1935` | RTMP port your encoder pushes to |
| `WEB_DIR` | `./web` | Static assets directory |

---

## Architecture

See [docs/architecture.md](docs/architecture.md). The short version:

- `server/src/destinations.js` — platform registry and validation. A pure lookup table.
- `server/src/engine.js` — builds the ffmpeg argv and supervises the process. The argv
  builder is exported separately so it can be tested without spawning anything.
- `server/src/store.js` — AES-256-GCM encryption for stream keys at rest.
- `server/src/app.js` — node:http routes plus a WebSocket for live status and ffmpeg stderr.
- `web/` — the studio UI. Plain DOM, no framework.
- `desktop/`, `mobile/` — shells around the same UI.

---

## Tests

```bash
npm test
```

23 tests covering RTMP URL joining (including the query-parameter case that Twitch and
Facebook need), the tee argv, secret redaction, encryption round-trips, the guarantee
that no destination preset ever advertises automatic key fetching, and the packaging
contract that the desktop installer depends on.

---

## Security

Stream keys are credentials. Read [docs/security.md](docs/security.md) before exposing the
studio beyond your own machine — by default the API has no authentication, which is fine on
localhost and not fine on a public IP.

---

## License

MIT. See [LICENSE](LICENSE).
