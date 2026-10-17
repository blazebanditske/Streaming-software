/**
 * Destination store.
 *
 * Stream keys are credentials: anyone holding one can broadcast as you. They
 * are encrypted at rest with AES-256-GCM under a key that lives in
 * data/secret.key with mode 0600. This is deliberately modest — it protects
 * against a stray backup or a shared screenshot of the data file, not against
 * an attacker who already has code execution as your user. For that, use your
 * OS keychain; see docs/security.md.
 *
 * A stream key is never returned over the API. Clients get a fingerprint.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { redactDestination, validateDestination, resolveRtmpUrl } from './destinations.js'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

export class DestinationStore {
  /**
   * @param {{ dataDir?: string, keyPath?: string, dbPath?: string }} [opts]
   */
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || join(process.cwd(), 'data')
    this.keyPath = opts.keyPath || join(this.dataDir, 'secret.key')
    this.dbPath = opts.dbPath || join(this.dataDir, 'destinations.json')

    mkdirSync(this.dataDir, { recursive: true })
    this.key = this.#loadOrCreateKey()
    /** @type {any[]} */
    this.items = this.#load()
  }

  #loadOrCreateKey() {
    if (existsSync(this.keyPath)) {
      const raw = readFileSync(this.keyPath)
      if (raw.length !== 32) throw new Error(`Encryption key at ${this.keyPath} is corrupt.`)
      return raw
    }
    const key = randomBytes(32)
    writeFileSync(this.keyPath, key, { mode: 0o600 })
    try {
      chmodSync(this.keyPath, 0o600)
    } catch {
      // Windows and some mounted filesystems ignore POSIX modes; not fatal.
    }
    return key
  }

  #load() {
    if (!existsSync(this.dbPath)) return []
    try {
      return JSON.parse(readFileSync(this.dbPath, 'utf8'))
    } catch {
      throw new Error(`Destination store at ${this.dbPath} is not valid JSON.`)
    }
  }

  #save() {
    mkdirSync(dirname(this.dbPath), { recursive: true })
    writeFileSync(this.dbPath, JSON.stringify(this.items, null, 2), { mode: 0o600 })
  }

  #encrypt(plaintext) {
    const iv = randomBytes(IV_LEN)
    const cipher = createCipheriv(ALGO, this.key, iv)
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
  }

  #decrypt(blob) {
    const buf = Buffer.from(blob, 'base64')
    const iv = buf.subarray(0, IV_LEN)
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const data = buf.subarray(IV_LEN + TAG_LEN)
    const decipher = createDecipheriv(ALGO, this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  }

  /** Public view of a destination — no secrets. */
  #public(dest) {
    return redactDestination({
      id: dest.id,
      platform: dest.platform,
      label: dest.label,
      rtmpUrl: dest.rtmpUrl,
      createdAt: dest.createdAt,
      streamKey: this.#decrypt(dest.streamKeyEnc),
    })
  }

  list() {
    return this.items.map((d) => this.#public(d))
  }

  get(id) {
    const found = this.items.find((d) => d.id === id)
    return found ? this.#public(found) : null
  }

  /**
   * Internal use only: the destination with its real key, for handing to
   * ffmpeg. Never return this from a route handler.
   */
  getWithSecret(id) {
    const found = this.items.find((d) => d.id === id)
    if (!found) return null
    return {
      id: found.id,
      platform: found.platform,
      label: found.label,
      rtmpUrl: resolveRtmpUrl(found),
      streamKey: this.#decrypt(found.streamKeyEnc),
    }
  }

  /**
   * @param {{platform:string,label:string,rtmpUrl?:string,streamKey:string}} input
   */
  create(input) {
    const problems = validateDestination(input)
    if (problems.length) {
      const err = new Error(problems.join(' '))
      err.statusCode = 400
      err.problems = problems
      throw err
    }

    const dest = {
      id: randomBytes(8).toString('hex'),
      platform: input.platform,
      label: input.label.trim(),
      rtmpUrl: (input.rtmpUrl || '').trim(),
      streamKeyEnc: this.#encrypt(input.streamKey.trim()),
      createdAt: new Date().toISOString(),
    }
    this.items.push(dest)
    this.#save()
    return this.#public(dest)
  }

  update(id, patch) {
    const idx = this.items.findIndex((d) => d.id === id)
    if (idx === -1) return null

    const current = this.items[idx]
    const candidate = {
      platform: patch.platform ?? current.platform,
      label: patch.label ?? current.label,
      rtmpUrl: patch.rtmpUrl ?? current.rtmpUrl,
      streamKey: patch.streamKey?.trim()
        ? patch.streamKey.trim()
        : this.#decrypt(current.streamKeyEnc),
    }

    const problems = validateDestination(candidate)
    if (problems.length) {
      const err = new Error(problems.join(' '))
      err.statusCode = 400
      err.problems = problems
      throw err
    }

    this.items[idx] = {
      ...current,
      platform: candidate.platform,
      label: candidate.label.trim(),
      rtmpUrl: (candidate.rtmpUrl || '').trim(),
      streamKeyEnc: this.#encrypt(candidate.streamKey),
    }
    this.#save()
    return this.#public(this.items[idx])
  }

  remove(id) {
    const idx = this.items.findIndex((d) => d.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    this.#save()
    return true
  }
}
