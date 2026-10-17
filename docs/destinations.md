# Destinations

A destination is a server URL plus a stream key. That is the only ingest contract the major
platforms offer to third-party software, so it is the only one this project speaks.

## YouTube

- URL: `rtmp://a.rtmp.youtube.com/live2`
- Key: YouTube Studio → **Go Live** → Stream settings → **Stream key**

Create a scheduled event or enable **Stream now** first, otherwise there is no key to copy.
YouTube keys are long-lived and reusable across broadcasts. YouTube is the most forgiving
platform for a fan-out: it accepts a wide range of bitrates and recovers quickly from a
brief drop.

## Twitch

- URL: `rtmp://live.twitch.tv/app`
- Key: Twitch Dashboard → Settings → Stream → **Primary Stream key**

Twitch's URL often carries query parameters. The key goes **before** the `?`, and `joinRtmp()`
handles that. Twitch is stricter about bitrate ceilings than YouTube — keep the video
bitrate at or below roughly 6000 kbps for most accounts, or it will drop frames. It also
dislikes long keyframe intervals; the default `-g` of twice the frame rate is a good setting.

## Facebook Live

- URL: `rtmps://live-api-s.facebook.com:443/rtmp` (note **rtmps** and the explicit port)
- Key: Facebook Live Producer → **Streaming software** → Stream key

Facebook mints a **new key per broadcast**, so re-paste it each time. It also has the
tightest connection tolerance of the three: if the ingest drops, Facebook ends the broadcast
rather than waiting.

## TikTok

Covered in depth in [tiktok.md](tiktok.md). Summary: TikTok exposes RTMP only to eligible
accounts (typically 1,000+ followers, 18+, in good standing). If you have it, paste the
Server URL and key from Live Center or LIVE Studio. Keys are per-broadcast.

This project does not generate, fetch, or bypass TikTok stream keys. Every preset has
`supportsAutoKey: false` and a test enforces it.

## Custom RTMP

Anything that accepts an RTMP or RTMPS publish. Useful targets:

- **MediaMTX** — a small self-hosted server; great for testing and for relaying to a
  location your computer cannot reach directly.
- **nginx with the RTMP module** — a classic; also gives you HLS output for free.
- **Another instance of this studio** — chain them if you want a second tier of fan-out.
- **A local sink for testing** — see `docs/verification.md`.

## Choosing a bitrate

The engine defaults to 3500 kbps video at 720p30, which is a safe common denominator across
all four platforms. If you are streaming to several at once, the slowest platform sets your
practical ceiling — so tune for that one.

| Resolution | Video | Audio |
| --- | --- | --- |
| 480p30 | 1200 kbps | 96 kbps |
| 720p30 | 3500 kbps | 128 kbps |
| 720p60 | 4500 kbps | 128 kbps |
| 1080p30 | 5000 kbps | 160 kbps |
| 1080p60 | 6000 kbps | 160 kbps |

Override by passing `encoding` to `POST /api/stream/start`, or by editing `DEFAULT_ENCODING`
in `server/src/engine.js`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| One platform works, others silent | `-map` repeated per output. Check `buildFfmpegArgs()`. |
| "Connection refused" from ffmpeg | Wrong URL, or a key with a leading/trailing space. |
| Auth failure on Twitch | Key placed after the `?`. Check `joinRtmp()`. |
| Stream dies when one platform drops | `onfail=ignore` missing from that tee target. |
| Everything stutters together | One slow platform without `use_fifo=1`, causing backpressure. |
| Works for a minute, then stops | Bitrate above the platform ceiling. Lower it. |
