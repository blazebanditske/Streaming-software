import { createApp } from './app.js'

const port = Number(process.env.PORT || 8080)
const ingestPort = Number(process.env.INGEST_PORT || 1935)

const app = createApp({ port, ingestPort })

app.server.listen(port, () => {
  const base = `http://localhost:${port}`
  console.log('')
  console.log('  streaming-software')
  console.log('  ------------------')
  console.log(`  Studio:      ${base}`)
  console.log(`  Ingest:      rtmp://localhost:${ingestPort}/live/studio`)
  console.log('')
  console.log('  Point OBS at the ingest URL, or use the studio in your browser.')
  console.log('  Add destinations in the UI, then press Go Live.')
  console.log('')
})

const shutdown = () => {
  app.engine.stop()
  app.server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
