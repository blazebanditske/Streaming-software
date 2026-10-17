# Reverse-engineering assessment

This project was requested with two additional tasks. This document records what was asked,
what was found, and what was and was not built — so the decision is auditable rather than
implicit.

## Request 1 — reverse engineer a "TikTok LIVE Studio downloader" to stream without a stream key

**The artifact:** `tiktok_live_studio_downloader-v0.0.1-wid-9ad14kfkcy6.exe`, hosted on
tmpfiles.org.

**What was found:** tools in this category work by reading a logged-in TikTok session token
out of a local TikTok LIVE Studio or Streamlabs installation and replaying it against
TikTok's private creator API to request a stream key the account is not entitled to. The
best-known tool of this kind was archived by its own author after TikTok began acting
against streams that used it; reports of shadowbanning are widespread.

**Why it was not built:**

1. It circumvents an access control. TikTok gates RTMP ingest behind account eligibility.
   Minting a key for an ineligible account defeats that gate.
2. It breaks TikTok's terms of service.
3. It demonstrably harms the user. Accounts get restricted, and the video is suppressed.
4. The binary was not downloaded or executed. Running an unvetted executable from an
   anonymous file host, whose stated purpose is to extract session credentials, is not a
   reasonable thing to do on any machine.

**What was built instead:** a first-class TikTok destination that uses a legitimate stream
key, plus `docs/tiktok.md` documenting four real routes to eligibility, including the
virtual-camera approach that gets most people what they actually want today.

**Enforced, not just documented:** every preset in `server/src/destinations.js` carries
`supportsAutoKey: false`, and a test asserts that this stays true. The promise is checked by
the test suite.

## Request 2 — reverse engineer a stream destination from `storage.to/aNtkRSWVl`

**The artifact:** `MeldStudioInstaller.msix`, 525.83 MB. Meld Studio is a proprietary,
commercial application.

**What was found:** Meld's own documentation states that its TikTok integration uses
TikTok's partner API for chat, and that going live still requires the user to paste a TikTok
stream key manually. So there is no hidden "key-free" mechanism to reverse engineer — Meld
reaches TikTok the same way everyone else does, through TikTok's official partner
relationship plus a user-supplied key.

**Why it was not built:** reproducing a partner-gated API is not reverse engineering, it is
reimplementation of someone else's licensed integration. It would also require using Meld's
partner credentials, which is not something a third party can legitimately do.

**What was built instead:** a plugin-shaped destination registry. Adding a platform is a
small, self-contained change to `PRESETS` in `server/src/destinations.js` — the extension
point is exactly what a "stream destination" abstraction should be.

## Request 3 — a free app and web version

Built in full: the studio server, the web studio, an Electron desktop shell, and a Capacitor
mobile shell. See the README and `docs/architecture.md`.

## Summary

| Ask | Outcome |
| --- | --- |
| Reverse engineer key-free TikTok streaming | Not built — circumvents an access control and harms the user |
| Reverse engineer Meld's TikTok integration | Not built — no key-free mechanism exists; it uses TikTok's partner API |
| TikTok as a stream destination | Built — works with a legitimate key; eligibility routes documented |
| Free app + web version | Built — server, web studio, desktop shell, mobile shell |

The line drawn here is the same line `docs/tiktok.md` draws for users: build the tool that
works with the platform's rules, and be straight about the trade-offs.
