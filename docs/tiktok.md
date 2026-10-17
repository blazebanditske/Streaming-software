# Streaming to TikTok

This page exists because "stream to TikTok without a stream key" is a common promise and
almost always a dishonest one. Here is what is actually true.

## The short version

TikTok exposes RTMP ingest only to accounts that meet its eligibility requirements. If
your account qualifies, TikTok gives you a **Server URL** and a **Stream key**, and this
project uses them like any other destination. If your account does not qualify, there is no
supported way to make it work, and this project will not fake one.

## How to get a real TikTok stream key

1. Confirm your account is eligible. TikTok's general requirements:
   - **1,000+ followers** (varies by region)
   - **18 or older** (19 in South Korea)
   - Account in **good standing** — no active community-guideline violations
2. Get the key from TikTok itself, not a third party:
   - **TikTok Live Center** (web): log in, choose **Go LIVE with software**, and copy the
     Server URL and Stream key.
   - **TikTok LIVE Studio** (desktop app): sign in and the RTMP details are shown in the
     stream settings.
   - **Mobile app**: `+` → LIVE → **Cast to PC**.
3. In this studio: add a destination, choose **TikTok**, paste the **Server URL** into the
   RTMP field and the **Stream key** into the key field. Save, check it, Go live.

Note that TikTok mints a **new key per broadcast**, so you will re-paste it each time.

## Why we do not "generate" a stream key

Several tools advertise generating a TikTok stream key for accounts that are not eligible.
They work by one of these routes:

- Reading your logged-in TikTok session token out of a local TikTok LIVE Studio or
  Streamlabs install, then replaying that token against TikTok's **private creator API** to
  request a key on your behalf.
- Using a third-party relay's own partner credentials to carry your stream, which means
  your video and audio pass through someone else's infrastructure.

Both are problems:

- **They violate TikTok's terms of service.** You are using an authenticated interface in a
  way it was not offered to you.
- **They get accounts restricted.** This is not hypothetical. The best-known tool in this
  category was archived by its own author after TikTok began acting against streams that
  used it, and reports of shadowbanning are widespread. A reviewer testing one of these
  approaches found the resulting streams were being suppressed in the algorithm.
- **The first route means handing your session credentials to an unvetted binary.** That
  token is full account access, not just streaming.

So this project does not implement it. Concretely, every preset in
`server/src/destinations.js` carries `supportsAutoKey: false`, and a test asserts it stays
that way. That is a product promise enforced by the test suite, not just a comment.

## Legitimate routes if you are not yet eligible

These are real options, ordered by how much I would recommend them:

1. **Get to 1,000 followers.** Tedious, but it is the intended path and the only one with no
   downside.
2. **Use a TikTok Creator Network (agency).** MCNs can enable LIVE and stream-key access for
   members, often with no follower minimum. This is TikTok-adjacent and above board when the
   agency is a genuine partner. Vet them: a real agency does not ask for your password, only
   for account authorization through TikTok's own flow.
3. **Restream's TikTok integration.** Restream is an official TikTok partner and its TikTok
   channel auto-applies for LIVE access with expedited review. It is a paid product and a
   cloud relay, but it is legitimate, and it is the honest answer to "how do I stream to
   TikTok without a key of my own."
4. **Use your phone as the camera.** TikTok's own app can go live without any key. If you
   want desktop production quality, use a virtual camera (OBS Virtual Camera, or Meld
   Studio's virtual camera on Windows) and select it as the camera source inside TikTok LIVE
   Studio. No key, no circumvention, full scene control.

Option 4 is the one most people actually want. It gets you a professionally produced
TikTok stream today, using only supported software.

## What this project gives you for TikTok

If you have a key: first-class support, identical to YouTube or Twitch.

If you do not: a clear explanation and four legitimate paths forward. That is the whole
point of drawing the line here — a tool that lies to you about this will lie to you about
other things too.

## References

- TikTok LIVE creator hub — <https://www.tiktok.com/live/creator>
- TikTok LIVE Center (stream key, when eligible) — <https://livecenter.tiktok.com>
- Restream's TikTok integration — <https://restream.io/integrations/tiktok>
- Meld Studio on virtual camera with TikTok LIVE Studio —
  <https://meldstudio.co/blog/how-to-use-meld-studios-virtual-camera-with-tiktok-live-studio>
