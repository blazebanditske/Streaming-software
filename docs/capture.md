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

## Path B — built-in capture (works today)

The studio can open a local camera itself and publish it to the ingest, so the device
pickers in the UI are real and no separate app is needed:

```bash
# what the server runs for you, Linux
ffmpeg -f v4l2 -i /dev/video0 -f alsa -i default -c:v libx264 -preset veryfast \
  -tune zerolatency -pix_fmt yuv420p -c:a aac -f flv rtmp://127.0.0.1:1935/live/studio
```

Press **Publish camera** in the studio. The server enumerates devices
(`GET /api/devices`), maps the one you picked to the name ffmpeg expects, and starts a
capture process pointed at its own ingest. The fan-out engine then treats it exactly like
an OBS publisher — nothing else changes.

Capture is a separate process from the fan-out on purpose. Capture is local and
disposable; destinations are remote and stateful. If a camera is unplugged mid-stream the
fan-out survives, and restarting capture does not drop the platform connections.

Order matters: **start the stream first**. The engine is the RTMP listener, so a capture
process started before it has nothing to connect to and exits immediately. The server
rejects that ordering with an explanatory message rather than letting ffmpeg fail
obscurely.

Caveat: this process runs as the *server's* user, so on macOS and Windows the camera
permission prompt belongs to the app, not the browser. That is why the browser preview
and this path both exist — the preview shows you what the browser can see, this publishes
what the app can see.

## Recording

Tick **Also record a copy on this machine** before pressing Go live. The recording is a
third kind of tee branch — the same encoded bytes that go to the platforms are written to
a file, so it costs no extra CPU. Files land in `data/recordings/` named
`<timestamp>-<label>.ts`.

MPEG-TS is deliberate. Recordings were tested against a hard kill (`kill -9`) mid-write:

| Container | Bytes recovered | Playable |
| --- | --- | --- |
| **mpegts** | 262144 | **yes, ~3s of video** |
| flv | 0 | no |
| mp4 | 48 | no |
| fragmented mp4 | 28 | no |
| matroska | header write fails under `tee` | n/a |

A crash should cost you the last few seconds, not the whole stream. MP4 writes its index at
the end, so anything short of a clean stop leaves an unplayable file; FLV buffers and loses
everything. Matroska is the intuitive pick and it does not work here — the tee muxer hands
slaves a non-seekable output and the matroska muxer refuses to write a header.

The label is sanitised before it becomes a file name, and the path is asserted to stay
inside the recordings directory, because the label reaches the server from the browser.

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
