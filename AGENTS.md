# AGENTS.md

Persistent notes for working in this repository.

## What this project is

A free, local multistreaming tool: one RTMP ingest, one ffmpeg `tee` fan-out to many
platforms. Three deliverables: Android APK, Windows EXE, and the web studio (Node server +
browser UI). No account, cloud relay, subscription, or per-destination fee.

## Commands

```bash
npm test                 # 45 tests, must stay green
npm start                # server on :8080, RTMP ingest on :1935
cd desktop && npx electron-builder --linux   # desktop packaging
```

## Environment caveats (this container)

- **ffmpeg is not persistent.** It disappears after container restarts. Reinstall with
  `apt-get install -y ffmpeg` before running anything end-to-end. Needed for any real
  verification, not for `npm test`.
- **No camera.** There is no `/dev/video*` and `v4l2loopback` cannot be installed. Test
  capture paths with a synthetic source (`testsrc`) or by asserting on argv.
- **Electron needs `--no-sandbox`** under `xvfb-run` here; the bundled `chrome-sandbox`
  is not setuid-root. D-Bus and GPU errors in the log are expected noise.
- `ws` is CommonJS. Import as `import pkg from 'ws/index.js'; const { WebSocket } = pkg`.
  A named import fails.

## Testing conventions

- Test the real thing, not a mock. Verification in `docs/verification.md` records what was
  actually executed.
- For media paths, assert end-to-end: run the fan-out, publish a synthetic stream, and
  `ffprobe` the sink. Argv assertions alone miss muxer-level failures.
- When a claim depends on ffmpeg behaviour, measure it and record the numbers in the docs
  rather than trusting intuition. See the container-choice table in `docs/capture.md`.

## Decisions worth not re-litigating

- **Recording is a tee branch, not a second encode.** It costs no extra CPU because the
  file receives the same bytes the platforms do.
- **Recordings are MPEG-TS.** Chosen by measuring survival of `kill -9` mid-write: mpegts
  recovers and plays; flv loses everything; mp4 and fragmented mp4 are unplayable. Matroska
  looks right but its header write fails under the `tee` muxer.
- **Recording is appended as the last tee target** so a failing disk cannot disturb the
  platform outputs.
- **No reverse-engineering closed-source software.** The project explicitly refuses to lift
  a logged-in TikTok session token to mint stream keys. See `docs/tiktok.md`. Requests to
  rebuild Restream-style session-lifting behaviour should be declined; the real routes to
  TikTok eligibility are documented instead.

## Repo layout

- `server/src/app.js` — HTTP + WS routes; `createApp` returns the server, store, engine,
  capture, wss, and ports.
- `server/src/engine.js` — `StreamEngine`, builds the ffmpeg `tee` argv.
- `server/src/capture.js` — `CaptureEngine`, publishes a local camera to the ingest.
- `server/src/recordings.js` — recording paths, label sanitising, listing.
- `web/` — the studio UI (`index.html`, `app.js`, `styles.css`).
- `desktop/` — Electron wrapper; `extraResources` copies `../server` and `../web` wholesale,
  so new server modules ship automatically.
