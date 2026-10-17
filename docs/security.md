# Security

## What we protect

A stream key is a credential. Anyone holding it can broadcast as you, and on most platforms
they can also disrupt or impersonate an in-progress stream.

## How keys are handled

| Stage | Handling |
| --- | --- |
| Transport into the app | The browser sends the key once, over the local HTTP API, on `POST /api/destinations`. |
| At rest | Encrypted with AES-256-GCM. The 32-byte key lives in `data/secret.key` (mode 0600). |
| Reading back | `GET /api/destinations` **never** returns the key. It returns `hasStreamKey` and a 4-character fingerprint. |
| Logs | `redactArgs()` strips the key from the ffmpeg argv before it is logged or sent to the UI. |
| To ffmpeg | Passed as an argv element via `spawn()` with no shell, so it cannot be word-split or land in shell history. |

### What this does and does not defend against

It defends against: a stray backup of `data/`, someone reading the JSON file, a screenshot
of the UI, or log lines being pasted into a bug report.

It does **not** defend against: an attacker who already has code execution as your user.
They can read `data/secret.key` and decrypt everything. For that threat model you want the
OS keychain — `keytar` on desktop, `libsecret`/Keychain/DPAPI underneath — which is a
reasonable next step but not implemented here.

## The API has no authentication

This is deliberate and it is the most important thing to understand before you expose this.

On `localhost`, no auth is correct: the studio is a personal tool on your own machine, and
adding a login would be friction for no benefit.

On a **public IP**, no auth means anyone who can reach port 8080 can list your destinations,
add their own, and start or stop your stream. Anyone who can reach port 1935 can push video
into your ingest.

Do not port-forward this as-is. If you need remote access, pick one:

1. **SSH tunnel** — `ssh -L 8080:localhost:8080 you@host`. Simplest and safest.
2. **A reverse proxy with auth** — nginx or Caddy in front, with HTTP basic auth or an
   identity provider, plus TLS.
3. **A VPN** — Tailscale, WireGuard, or similar. The studio is on the private network only.

If you run it on a VPS, also bind the ingest port so only you can reach it, and rotate your
stream keys if the host is ever compromised.

## Other boundaries in the code

- **Path traversal** on the static file server: the resolved path must stay inside
  `WEB_DIR`, or the request is rejected with 403.
- **Request body limit**: 256 KB, to bound memory on a malformed or hostile request.
- **Renderer isolation** in the desktop app: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`. The preload script exposes no privileged operations — the UI
  talks to the local HTTP API instead, so the trust boundary is a single well-understood
  surface.
- **External links** open in the system browser, never inside the app frame.

## Reporting

Open an issue at
<https://github.com/blazebanditske/streaming-software/issues>. For anything exploitable,
please describe the impact without publishing a working exploit.
