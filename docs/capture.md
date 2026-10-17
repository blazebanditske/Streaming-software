# Browser capture

The studio UI can preview your camera and microphone with `getUserMedia`. Getting that
preview **into the RTMP ingest** is the one part of the stack a browser cannot do by itself:
browsers do not speak RTMP, and `MediaRecorder` produces a file, not a live push.

There are two supported paths. Both keep the fan-out on the server, where it belongs.

## Path A — external encoder (works today)

Point OBS, Streamlabs, or a one-line ffmpeg command at the ingest:

```bash
ffmpeg -f v4l2 -i /dev/video0 -f alsa -i default \
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
  -b:v 3500k -g 60 -c:a aac -b:a 128k \
  -f flv rtmp://localhost:1935/live/studio
```

macOS uses `-f avfoundation -i "0:0"`; Windows uses `-f dshow -i video="Camera"`. This is
the most reliable option and it is what the README recommends. OBS additionally gives you
scenes, overlays, and transitions for free.

## Path B — server-side capture (planned)

Have the studio open the camera itself and encode locally:

```bash
# Linux
ffmpeg -f v4l2 -i /dev/video0 -f alsa -i default -c:v libx264 -preset veryfast \
  -tune zerolatency -pix_fmt yuv420p -c:a aac -f flv rtmp://127.0.0.1:1935/live/studio
```

This is the natural next feature: a `POST /api/capture/start` that spawns a local capture
process and feeds the same ingest, so the UI's device pickers become real. The plumbing is
already in place — `StreamEngine` supervises ffmpeg, and this would be a second instance of
the same pattern writing to the ingest instead of reading from it.

Caveat: a server-side capture process runs as the server's user, so on macOS it triggers
camera permission prompts for the *server*, not the browser. That is a confusing experience
and one reason OBS remains the recommendation.

## Path C — WHIP / WebRTC bridge (possible, more work)

Browsers do speak WebRTC. A WHIP endpoint in front of ffmpeg would let the browser push
directly:

```
browser --WebRTC/WHIP--> whip endpoint --> ffmpeg --> tee --> platforms
```

MediaMTX can act as the WHIP endpoint and republish to RTMP, which would make this a
configuration exercise rather than new code. It adds a dependency and a second network hop,
so it is only worth it if browser-only capture is a hard requirement.

## Why not capture in the phone app

Both iOS and Android aggressively suspend background capture, and neither offers a
long-running RTMP encoder to a WebView. A phone is a fine *camera* and a fine *remote
control*; it is a bad broadcast origin. See `mobile.md`.
