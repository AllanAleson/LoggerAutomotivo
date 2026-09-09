import { createDatabase, migrate } from './database.js'
import { seed } from './seed.js'

const db = createDatabase()
try {
  const command = process.argv[2]
  if (command === 'migrate') await migrate(db)
  else if (command === 'seed') { await migrate(db); await seed(db) }
  else throw new Error('Use: npm run db:migrate ou npm run db:seed')
  console.log(command === 'seed' ? 'Banco migrado e dados de demonstração criados.' : 'Migrations aplicadas.')
} finally {
  await db.close()
}
