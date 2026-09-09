import 'dotenv/config'
import { createApp } from './app.js'
import { createDatabase, migrate } from './database.js'
import { seed } from './seed.js'

const port = Number(process.env.PORT ?? 3333)
const db = createDatabase()
await migrate(db)
await seed(db)

const server = createApp(db).listen(port, () => {
  console.log(`API Logger Automotivo disponível em http://localhost:${port}`)
})

async function shutdown() {
  server.close(async () => { await db.close(); process.exit(0) })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
