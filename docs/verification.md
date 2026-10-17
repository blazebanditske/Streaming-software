# Verification

This document records what was actually executed and observed, so the claims in the README
can be checked rather than trusted.

## Unit tests

```
$ npm test
ℹ tests 45
ℹ pass 45
ℹ fail 0
```

Coverage highlights:

| Test | What it protects |
| --- | --- |
| `joinRtmp inserts the key before query params` | Twitch/Facebook URL shape |
| `buildFfmpegArgs maps once, not once per output` | The silent multi-destination drop |
| `buildFfmpegArgs puts every destination in the tee target list` | All destinations reach the tee |
| `redactArgs hides keys from logs` | Keys never appear in logs or the UI |
| `store encrypts keys at rest and round-trips them` | AES-256-GCM correctness, 0600 key file |
| `no preset claims to auto-fetch a stream key` | The product promise in `docs/tiktok.md` |
| `server ships its own package.json declaring ESM` | The packaged-app startup crash (see below) |
| `the only bare server dependency is declared for packaging` | A new dep silently missing from the installer |
| `createApp serves the UI from an explicit webDir` | `WEB_DIR` being dropped on the way in |

## End-to-end fan-out

A second ffmpeg instance was used as an RTMP sink, standing in for YouTube or TikTok.

Setup:

1. RTMP sink listening on `rtmp://127.0.0.1:1936/live/sink/testkey`, writing to `sink.flv`.
2. Studio server started with `PORT=8080 INGEST_PORT=1935`.
3. A destination created via `POST /api/destinations` pointing at the sink.
4. Fan-out started via `POST /api/stream/start`.
5. A synthetic source (`testsrc` 640×360 @ 30fps + 440 Hz sine, 8 seconds) pushed into
   `rtmp://127.0.0.1:1935/live/studio` — exactly what OBS or the browser studio does.

Result, from `ffprobe` on what the sink received:

```
codec_name=h264
codec_type=video
width=1280
height=720
codec_name=aac
codec_type=audio
sample_rate=44100
duration=8.057000
size=1986804
bit_rate=1972748
```

What this demonstrates:

- The ingest accepted a real RTMP publisher.
- The transcode applied the configured profile: the 640×360 source arrived at the sink as
  **1280×720**, i.e. the encoding settings in `engine.js` took effect.
- Audio survived as AAC at 44.1 kHz.
- The tee delivered a complete 8.06-second stream — duration matches the 8-second source,
  so nothing was dropped or truncated.

The server reported `running: true, destinationCount: 1` while the stream was live.

## End-to-end multi-destination fan-out

The same test repeated with **three** RTMP sinks on ports 1941–1943, one ingest, six
seconds of source:

```
sink 1941: duration=6.060000s video=h264,1280,720 audio=aac,44100 size=1507707
sink 1942: duration=6.060000s video=h264,1280,720 audio=aac,44100 size=1507707
sink 1943: duration=6.060000s video=h264,1280,720 audio=aac,44100 size=1507707

a6a6c03bad1c52a5c1d8af7bba4ec5b2  sink-1941.flv
a6a6c03bad1c52a5c1d8af7bba4ec5b2  sink-1942.flv
a6a6c03bad1c52a5c1d8af7bba4ec5b2  sink-1943.flv
```

Identical MD5 across all three confirms every destination received byte-for-byte the same
stream, which is the core claim of the product. The server reported
`destinationCount: 3` throughout.

## Packaged desktop app

The installer is the artifact most users touch, and it failed on first launch. It was
rebuilt and verified by extracting the payload, not by trusting the build log.

The first build shipped a server that could not start, so the app showed
*"The local server exited with code 1"*. Three separate faults, all invisible to the unit
tests because those only ever ran against the repo layout:

1. `server/` had no `package.json`. The repo root declares `type: module`, which is what
   made the ESM imports work. electron-builder copies `server/` into `resources/` without
   the root `package.json`, so Node treated the files as CommonJS and threw
   *"Cannot use import statement outside a module"*.
2. `ws` was never packaged, so `import 'ws'` failed with `ERR_MODULE_NOT_FOUND`.
3. `index.js` ignored `WEB_DIR`, so the window loaded a 404 once the server was up.

Each fault was reproduced before being fixed, using the real Electron 33 binary with the
packaged directory layout:

```
$ ELECTRON_RUN_AS_NODE=1 electron resources/server/src/index.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ws' imported from .../app.js
```

After the fix, the server runs and the UI serves from the packaged layout:

```
$ ELECTRON_RUN_AS_NODE=1 PORT=8093 WEB_DIR=.../resources/web \
    streaming-software-desktop resources/server/src/index.js
{"ok":true,"version":"0.1.0","ingestPort":1935}
$ curl -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8093/
200 text/html; charset=utf-8
```

The shipped installer was then opened and its payload extracted (`7z` on the NSIS
installer, then the inner `app-64.7z`) to confirm the fix is actually inside the artifact:

```
resources/server/package.json        "type": "module"
resources/node_modules/ws/package.json   version 8.22.0
resources/web/index.html, app.js, styles.css
```

A full fan-out was run through the packaged server: one publisher, two sinks, both
receiving 2,474,675 bytes of valid H.264 + AAC.

The whole app was then launched, not just the server, under a virtual display
(`xvfb-run`). The shell spawned the server, the window loaded from `app.asar`, and the
UI served:

```
$ xvfb-run -a ./streaming-software-desktop --no-sandbox
[server]   streaming-software
[server]   Studio:      http://localhost:8080
[server]   Ingest:      rtmp://localhost:1935/live/studio
$ curl http://127.0.0.1:8080/api/health
{"ok":true,"version":"0.1.0","ingestPort":1935}
$ curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
200
```

Quitting the app released the port and produced no error dialog, confirming the
shutdown path is not mistaken for a crash.

## Android APK

Verified against the published artifact rather than the build output.

```
$ apksigner verify --print-certs -v streaming-software-1.0.apk
Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Signer #1 certificate DN: CN=Streaming Software, OU=Open Source, O=Streaming Software, ...
Signer #1 certificate SHA-256 digest: a334ee3cb2e2f47d328bc0a2d9587e840a397db716bd01bb8e611821c30352b2
```

```
$ aapt dump badging streaming-software-1.0.apk
package: name='org.streamingsoftware.app' versionCode='1' versionName='1.0'
sdkVersion:'24'  targetSdkVersion:'36'
uses-permission: android.permission.INTERNET, CAMERA, RECORD_AUDIO, ...
```

The web assets are present inside the APK (`assets/public/index.html`, `app.js`,
`styles.css`), and `android:usesCleartextTraffic` is set, which the app needs because it
talks to a studio server on the LAN over plain `http://`.

Note the app's role: it is a remote control and camera source, not a host. Phones cannot
run the ffmpeg fan-out. See `docs/mobile.md`.

## What is not verified

- **Real platform endpoints.** No live stream was pushed to YouTube, Twitch, Facebook, or
  TikTok — that requires real stream keys and live accounts.
- **Behaviour when one destination dies mid-stream.** `onfail=ignore` and `use_fifo=1` are
  set per target and covered by unit tests, but a mid-stream kill of one sink while the
  others continue was not exercised.
- **The Windows GUI on Windows.** The installer's contents were verified by extraction and
  the server was exercised with the real Electron binary, but the app window was not
  clicked through on a Windows desktop. The desktop packaging path was verified on Linux.
- **The Android app on a device.** The APK is signed, well-formed, and correctly
  configured, but it was not installed and run on a physical phone or emulator.
- **Browser capture → RTMP.** The browser preview (`getUserMedia`) and the server-side
  publish path are both implemented. See the next section for what was and was not
  exercised.

## Built-in capture and recording

Both features were verified against real ffmpeg, not mocks.

Capture:

- `GET /api/devices` enumerates real devices and degrades to empty lists with an
  explanatory note rather than erroring (this container has no camera, which is itself the
  degradation case).
- `POST /api/capture/start` before the stream is live is refused with an explanation,
  because the engine is the RTMP listener and capture has nothing to connect to yet.
- A capture pointed at a nonexistent device surfaces ffmpeg's own reason
  (`Cannot open video device /dev/video99: No such file or directory`) through
  `/api/capture/status` and the WebSocket, instead of failing silently.
- The exact argv shape capture uses was confirmed end-to-end: a publisher at
  `rtmp://127.0.0.1:<ingest>/live/studio` reaches the fan-out, and the sink received a
  valid 6.06s H.264/AAC file.

Recording:

- `POST /api/stream/start` with `record: true` writes to `data/recordings/`, and the path
  is reported in the stream status.
- The recorded file is playable H.264/AAC of the expected duration (726432 bytes, 6.06s
  for a 6s source).
- Container choice was decided by measurement. Against `kill -9` mid-write: mpegts
  recovered 262144 bytes and played; flv recovered 0; mp4 recovered 48 and would not play;
  fragmented mp4 recovered 28 and would not play. Matroska's header write fails outright
  under the tee muxer.
- Stream labels are sanitised (`My Channel!!` → `My-Channel`) and the resolved path is
  asserted to stay inside the recordings directory.

Still unverified:

- A real physical camera. This container has no `/dev/video*` and no loadable
  `v4l2loopback`, so device selection, permission prompts, and the Windows/macOS input
  formats (`dshow`, `avfoundation`) are covered by argv unit tests rather than a live
  device.
- Recording through a long stream with a mid-stream destination failure.

## Reproducing the end-to-end test

```bash
# terminal 1 — sink
ffmpeg -listen 1 -f flv -i rtmp://127.0.0.1:1936/live/sink/testkey -c copy sink.flv

# terminal 2 — studio
npm start

# terminal 3 — create destination, start fan-out, then publish
curl -X POST localhost:8080/api/destinations -H 'content-type: application/json' \
  -d '{"platform":"youtube","label":"Sink","rtmpUrl":"rtmp://127.0.0.1:1936/live/sink","streamKey":"testkey"}'
curl -X POST localhost:8080/api/stream/start -H 'content-type: application/json' \
  -d '{"destinationIds":["<id from previous response>"]}'
ffmpeg -f lavfi -i testsrc=size=640x360:rate=30 -f lavfi -i sine=frequency=440 \
  -t 8 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac \
  -f flv rtmp://127.0.0.1:1935/live/studio
ffprobe sink.flv
```
