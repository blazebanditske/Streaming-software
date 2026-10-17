# Verification

This document records what was actually executed and observed, so the claims in the README
can be checked rather than trusted.

## Unit tests

```
$ npm test
ℹ tests 18
ℹ pass 18
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

## What is not verified

- **Real platform endpoints.** No live stream was pushed to YouTube, Twitch, Facebook, or
  TikTok — that requires real stream keys and live accounts.
- **Behaviour when one destination dies mid-stream.** `onfail=ignore` and `use_fifo=1` are
  set per target and covered by unit tests, but a mid-stream kill of one sink while the
  others continue was not exercised.
- **Desktop and mobile builds.** Electron and Capacitor were not installed or compiled here
  (no Android SDK/Java in the build environment). Their source is syntax-checked only.
- **Browser capture → RTMP.** The UI captures camera preview via `getUserMedia`, but
  pushing that to the ingest requires an encoder process; see `docs/capture.md`.

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
