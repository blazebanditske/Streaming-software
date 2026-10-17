/**
 * Preload bridge.
 *
 * The renderer is sandboxed and has no Node access. This file exposes exactly
 * one thing: the app version, for the About line. Everything else the UI needs
 * it gets from the local HTTP API, which keeps the trust boundary in one place.
 */

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld(`studio`, {
  version: process.versions.electron,
  platform: process.platform,
})
