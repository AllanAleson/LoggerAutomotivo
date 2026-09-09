import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'

export type QueryResult<T> = { rows: T[]; rowCount?: number | null }
export interface Database {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  close(): Promise<void>
}

class PGliteDatabase implements Database {
  constructor(private readonly db: PGlite) {}
  async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const result = await this.db.query<T>(sql, params)
    return { rows: result.rows, rowCount: result.affectedRows }
  }
  async close() { await this.db.close() }
}

class PostgresDatabase implements Database {
  private readonly pool: pg.Pool
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url }) }
  async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const result = await this.pool.query(sql, params)
    return { rows: result.rows as T[], rowCount: result.rowCount }
  }
  async close() { await this.pool.end() }
}

export function createDatabase(options: { memory?: boolean } = {}): Database {
  const url = process.env.DATABASE_URL?.trim()
  if (url && !options.memory) return new PostgresDatabase(url)
  const location = options.memory ? undefined : path.resolve(process.cwd(), 'data/logger-mvp')
  if (location) mkdirSync(path.dirname(location), { recursive: true })
  return new PGliteDatabase(new PGlite(location))
}

export async function migrate(db: Database) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const migrationPath = path.resolve(here, '../migrations/001_initial.sql')
  const migration = await readFile(migrationPath, 'utf8')
  for (const statement of migration.split(/;\s*(?:\r?\n|$)/).map(x => x.trim()).filter(Boolean)) {
    await db.query(statement)
  }
}
