/**
 * Destination registry.
 *
 * A "destination" is one place the program is sent to. Every destination is
 * plain RTMP(S): a server URL plus a stream key. That is the only ingest
 * protocol the major platforms expose to third-party software, so the whole
 * product is built around it.
 *
 * Platforms differ in *how you obtain* that URL and key:
 *
 *   - youtube, twitch, facebook, custom  -> the platform hands you the key
 *                                           in its own dashboard. We just
 *                                           store it.
 *   - tiktok                             -> TikTok gates RTMP behind account
 *                                           eligibility. We deliberately do
 *                                           NOT automate or bypass that gate;
 *                                           see the `notes` on the entry and
 *                                           docs/tiktok.md.
 *
 * Nothing in this file contacts a platform. It is a lookup table for defaults
 * so the UI can prefill what it knows and ask for what it does not.
 */

/** @typedef {'youtube'|'twitch'|'facebook'|'tiktok'|'custom'} PlatformId */

/**
 * @typedef {object} DestinationPreset
 * @property {PlatformId} id
 * @property {string} label            Human name shown in the UI.
 * @property {string} rtmpUrl          Default RTMP server URL, or '' if the
 *                                     user must paste their own.
 * @property {string} keyHint          Where the user finds their stream key.
 * @property {string} ingestNote       What to tell the user in the form.
 * @property {boolean} supportsAutoKey Whether we can ever fetch the key for
 *                                     them. Always false here: fetching a key
 *                                     requires the user's platform session,
 *                                     and replaying that session against a
 *                                     private creator API is what "stream key
 *                                     generator" tools do. We do not do it.
 * @property {string} docs             Link the UI shows.
 */

/** @type {Record<PlatformId, DestinationPreset>} */
export const PRESETS = {
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    keyHint: 'YouTube Studio → Go Live → Stream settings → Stream key',
    ingestNote:
      'YouTube issues one reusable stream key per channel. Enable "Stream now" or create a scheduled event first.',
    supportsAutoKey: false,
    docs: 'https://support.google.com/youtube/answer/2907883',
  },
  twitch: {
    id: 'twitch',
    label: 'Twitch',
    rtmpUrl: 'rtmp://live.twitch.tv/app',
    keyHint: 'Twitch Dashboard → Settings → Stream → Primary Stream key',
    ingestNote:
      'Twitch stream keys are long-lived. Rotating the key in your dashboard instantly invalidates the old one here.',
    supportsAutoKey: false,
    docs: 'https://help.twitch.tv/s/article/broadcast-guidelines',
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook Live',
    rtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp',
    keyHint: 'Facebook Live Producer → Streaming software → Stream key',
    ingestNote:
      'Facebook Live Producer mints a fresh key per broadcast. Copy a new one before each stream.',
    supportsAutoKey: false,
    docs: 'https://www.facebook.com/business/help/1624197822708004',
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    rtmpUrl: '',
    keyHint:
      'TikTok Live Center / LIVE Studio → Go LIVE with software → Server URL + Stream key',
    ingestNote:
      'TikTok only exposes a stream key to accounts that already have LIVE access. Paste the Server URL and key TikTok gives you. If your account is not eligible yet, this project will not fake it for you — see docs/tiktok.md for the real routes to eligibility.',
    supportsAutoKey: false,
    docs: 'https://www.tiktok.com/live/creator',
  },
  custom: {
    id: 'custom',
    label: 'Custom RTMP',
    rtmpUrl: '',
    keyHint: 'Whatever your destination provider gave you.',
    ingestNote:
      'Any RTMP or RTMPS endpoint works: a self-hosted MediaMTX, an nginx-rtmp box, a friend\'s server, or another relay.',
    supportsAutoKey: false,
    docs: '',
  },
}

export const PLATFORM_IDS = /** @type {PlatformId[]} */ (Object.keys(PRESETS))

/**
 * Resolve the RTMP URL for a destination: an explicit URL wins, otherwise
 * fall back to the platform default. TikTok and custom have no default, so
 * the user must supply one.
 *
 * @param {{platform?: string, rtmpUrl?: string}} dest
 * @returns {string}
 */
export function resolveRtmpUrl(dest) {
  const explicit = (dest.rtmpUrl || '').trim()
  if (explicit) return explicit
  const preset = PRESETS[/** @type {PlatformId} */ (dest.platform)]
  return preset ? preset.rtmpUrl : ''
}

/**
 * Validate a destination before we try to hand it to ffmpeg. Returns a list of
 * human-readable problems; empty means it is usable.
 *
 * @param {{platform?: string, label?: string, rtmpUrl?: string, streamKey?: string}} dest
 * @returns {string[]}
 */
export function validateDestination(dest) {
  const problems = []

  if (!dest.platform || !PRESETS[dest.platform]) {
    problems.push(`Unknown platform "${dest.platform ?? ''}".`)
  }
  if (!(dest.label || '').trim()) {
    problems.push('Destination needs a name.')
  }

  const url = resolveRtmpUrl(dest)
  if (!url) {
    problems.push('Destination needs an RTMP server URL.')
  } else if (!/^rtmps?:\/\//i.test(url)) {
    problems.push('Server URL must start with rtmp:// or rtmps://.')
  }

  if (!(dest.streamKey || '').trim()) {
    problems.push('Destination needs a stream key.')
  } else if (/\s/.test(dest.streamKey)) {
    // Whitespace almost always means a bad copy/paste, and ffmpeg will treat
    // it as part of the key rather than erroring.
    problems.push('Stream key contains whitespace — check for a bad paste.')
  }

  return problems
}

/**
 * Strip secrets so a destination can safely cross the wire or hit a log.
 * The stream key is replaced by a short fingerprint the UI can still use to
 * tell two destinations apart.
 *
 * @param {{streamKey?: string}} dest
 */
export function redactDestination(dest) {
  const key = dest.streamKey || ''
  return {
    ...dest,
    streamKey: undefined,
    hasStreamKey: key.length > 0,
    streamKeyFingerprint: key ? fingerprint(key) : '',
  }
}

/**
 * Short non-reversible-ish tag for a secret, for display only. Not a security
 * boundary — the key is encrypted at rest; this is just so the UI can show
 * "key set (…a91f)" without leaking the value.
 *
 * @param {string} secret
 */
export function fingerprint(secret) {
  let h = 0x811c9dc5
  for (let i = 0; i < secret.length; i++) {
    h ^= secret.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(-4)
}
