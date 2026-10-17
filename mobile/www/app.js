/**
 * Mobile studio.
 *
 * The mobile app is the same studio UI, pointed at a server you run (your
 * laptop, a VPS, a Raspberry Pi). Phones cannot host the ffmpeg fan-out
 * themselves — there is no background RTMP encoder, and both iOS and Android
 * will kill a long-running capture — so the app is a remote control plus a
 * camera source.
 *
 * On first launch the user enters the address of their studio server. We
 * remember it, health-check it, then hand off to the real UI.
 *
 * Why not bundle a local server like the desktop app? Because the point of
 * this project is one encode fanned out to many platforms, and that belongs
 * on a machine that stays awake and has the CPU. See docs/mobile.md.
 */

const STORAGE_KEY = 'studio.serverUrl'

const els = {
  setup: document.getElementById('setup'),
  frame: document.getElementById('frame'),
  input: document.getElementById('server-url'),
  connect: document.getElementById('connect'),
  status: document.getElementById('status'),
  hint: document.getElementById('hint'),
  change: document.getElementById('change'),
}

function setStatus(text, kind = '') {
  els.status.textContent = text
  els.status.className = `status ${kind}`
}

function normalise(url) {
  let value = (url || '').trim()
  if (!value) return ''
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  return value.replace(/\/+$/, '')
}

async function probe(base) {
  // Short timeout: on a phone, a wrong address should fail fast and visibly
  // rather than hang on a black hole.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${base}/api/health`, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function connect(rawUrl) {
  const base = normalise(rawUrl)
  if (!base) {
    setStatus('Enter your studio server address.', 'bad')
    return
  }

  setStatus('Looking for your studio…')
  els.connect.disabled = true
  const health = await probe(base)
  els.connect.disabled = false

  if (!health || !health.ok) {
    setStatus(
      'No studio answered there. Check the address, that the server is running, and that both devices are on the same network.',
      'bad',
    )
    els.hint.textContent =
      'Tip: on your computer run "npm start" and use its LAN address, e.g. http://192.168.1.20:8080'
    return
  }

  localStorage.setItem(STORAGE_KEY, base)
  setStatus(`Connected to studio v${health.version}`, 'ok')
  openStudio(base)
}

function openStudio(base) {
  els.setup.hidden = true
  els.frame.hidden = false
  els.frame.src = base
}

function showSetup(prefill = '') {
  els.frame.hidden = true
  els.frame.src = 'about:blank'
  els.setup.hidden = false
  els.input.value = prefill
  els.input.focus()
}

els.connect.addEventListener('click', () => connect(els.input.value))
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connect(els.input.value)
})
els.change.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY)
  showSetup()
})

const saved = localStorage.getItem(STORAGE_KEY)
if (saved) {
  showSetup(saved)
  connect(saved)
} else {
  showSetup()
}
