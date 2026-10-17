# Architecture

## The one idea

ffmpeg can accept a single incoming stream and push it to many servers at once using the
`tee` muxer. Everything else in this project is plumbing around that fact.

```
                                  ┌──────────────────────────────┐
 browser camera ──┐               │  server/src/engine.js        │
                  ├──RTMP────────▶│  ffmpeg -listen 1 ... -f tee │──┬──▶ destination 1
 OBS / Streamlabs ┘   port 1935   └──────────────────────────────┘  ├──▶ destination 2
                                                                     └──▶ destination N
```

## Process model

One Node process owns everything:

- an HTTP server for the UI and JSON API (`node:http`, no framework),
- a WebSocket for live status and ffmpeg's stderr (`ws`),
- at most one ffmpeg child process while a stream is running.

There is no database. Destinations live in `data/destinations.json`, with stream keys
encrypted. There is no queue, no worker, no message bus.

## The ffmpeg command

Built in `buildFfmpegArgs()`:

```
ffmpeg -hide_banner -loglevel warning -nostdin \
  -listen 1 -f flv -i rtmp://127.0.0.1:1935/live/studio \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 3500k \
  -maxrate 3500k -bufsize 7000k -pix_fmt yuv420p -g 60 -r 30 -s 1280x720 \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  -map 0:v -map 0:a -f tee \
  "[f=flv:onfail=ignore:use_fifo=1]rtmp://a.rtmp.youtube.com/live2/KEY|..."
```

Three decisions in there are worth calling out, because getting them wrong produces bugs
that are hard to diagnose:

**`-listen 1`** makes ffmpeg act as the RTMP *server*. That is why neither the browser nor
OBS needs to negotiate with any platform, and why the studio can start before the encoder
connects.

**One `-map` pair, not one per output.** Only the first tee target takes the mapping; later
ones inherit it. Adding `-map 0:v -map 0:a` per destination is a common mistake that makes
ffmpeg silently drop the extra outputs — the stream "works" but only reaches one platform.

**`use_fifo=1` and `onfail=ignore` per target.** Each destination gets its own send buffer,
so a slow or dead platform cannot stall the others via TCP backpressure. `onfail=ignore`
means one bad key does not take down the whole broadcast.

### Query-parameter URLs

Twitch and Facebook use URLs like `rtmp://host/app?bandwidthtest=true`. The key must be
inserted *before* the query string, not appended after it:

```
rtmp://live.twitch.tv/app?bandwidthtest=true  +  KEY
  -> rtmp://live.twitch.tv/app/KEY?bandwidthtest=true
```

Getting this wrong yields an authentication failure that looks like a bad key. It is
handled in `joinRtmp()` and covered by a test.

## Module map

| File | Responsibility |
| --- | --- |
| `server/src/destinations.js` | Platform presets, validation, redaction. Pure functions, no I/O. |
| `server/src/engine.js` | ffmpeg argv construction, process lifecycle, stderr ring buffer. |
| `server/src/store.js` | Persistence and AES-256-GCM encryption of stream keys. |
| `server/src/app.js` | HTTP routing, JSON helpers, WebSocket broadcast, static file serving. |
| `server/src/index.js` | Entry point, signal handling, startup banner. |
| `web/app.js` | Studio UI logic. Plain DOM. |
| `desktop/main.js` | Electron shell that supervises the server as a child process. |
| `mobile/www/app.js` | Capacitor shell that connects to a remote studio server. |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness and version. |
| GET | `/api/presets` | Platform defaults for the destination form. |
| GET | `/api/destinations` | List, keys redacted to a fingerprint. |
| POST | `/api/destinations` | Create. |
| PATCH | `/api/destinations/:id` | Update. Omitting `streamKey` keeps the stored one. |
| DELETE | `/api/destinations/:id` | Delete. |
| POST | `/api/stream/start` | Begin fan-out. Body: `{ destinationIds: [] }`. |
| POST | `/api/stream/stop` | End fan-out. |
| GET | `/api/stream/status` | Current state plus recent stderr. |
| WS | `/ws` | Pushes `stream`, `stderr`, and `error` events. |

## Testing strategy

`buildFfmpegArgs()` is exported separately from `StreamEngine` specifically so the argv can
be asserted on without spawning ffmpeg. The argv is where the subtle bugs live, and it is
cheap to test exhaustively.

The end-to-end path (ingest → transcode → push) is verified by running a second ffmpeg as
an RTMP sink and confirming the received file is valid H.264/AAC of the expected duration.
See `docs/verification.md`.

## Deliberate non-goals

- **No cloud relay.** The stream goes from your machine straight to each platform.
- **No scenes, overlays, or transitions.** Use OBS and point it at the ingest. This is
  the one thing OBS does that this project will not reimplement.
- **No chat aggregation** (yet). Meld Studio and Restream both do this well.
- **No automatic platform key fetching.** See `docs/tiktok.md`.

Recording is **not** a non-goal: it is one extra tee branch, so it costs no CPU beyond
the encode you are already doing. See `docs/capture.md`.
