import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { z } from 'zod'
import type { Database } from './database.js'

const eventSchema = z.object({
  loggerId: z.string().trim().min(1).max(80),
  timestamp: z.iso.datetime({ offset: true }),
  level: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']),
  event: z.string().trim().min(1).max(120),
  signal: z.string().trim().max(120).nullable().optional(),
  expected: z.string().max(1000).nullable().optional(),
  received: z.string().max(1000).nullable().optional(),
  result: z.string().trim().max(80).nullable().optional(),
  possibleCause: z.string().max(2000).nullable().optional(),
  evidence: z.array(z.string().max(500)).max(30).default([]),
  synchronized: z.boolean().default(true),
}).strict()

const heartbeatSchema = z.object({
  timestamp: z.iso.datetime({ offset: true }),
  batteryVoltage: z.number().min(0).max(100).optional(),
  firmwareVersion: z.string().trim().min(1).max(40).optional(),
  pendingEvents: z.number().int().min(0).max(1_000_000).optional(),
}).strict()

const eventColumns = `
  e.id, e.timestamp, e.level, e.event, e.signal, e.expected, e.received, e.result,
  e.possible_cause AS "possibleCause", e.evidence, e.synchronized, e.created_at AS "createdAt",
  l.logger_id AS "loggerId", p.piece_id AS "pieceId"
`

const partColumns = `
  p.id, p.piece_id AS "pieceId", p.serial_number AS "serialNumber", p.model, p.description,
  p.vehicle_identifier AS "vehicleIdentifier", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  l.logger_id AS "loggerId", l.status AS "storedStatus", l.last_seen AS "lastSeen",
  l.firmware_version AS "firmwareVersion", l.communication_mode AS "communicationMode",
  l.battery_voltage::float AS "batteryVoltage", l.pending_events AS "pendingEvents",
  (SELECT jsonb_build_object('id', ef.id, 'timestamp', ef.timestamp, 'level', ef.level, 'event', ef.event,
    'signal', ef.signal, 'expected', ef.expected, 'received', ef.received, 'result', ef.result,
    'possibleCause', ef.possible_cause, 'evidence', ef.evidence, 'loggerId', l.logger_id, 'pieceId', p.piece_id)
   FROM events ef WHERE ef.logger_id = l.id AND ef.level IN ('WARNING','ERROR','CRITICAL')
   ORDER BY ef.timestamp DESC LIMIT 1) AS "latestFailure"
`

const partJoins = `
  FROM parts p
  LEFT JOIN part_logger_assignments a ON a.part_id = p.id AND a.unassigned_at IS NULL
  LEFT JOIN loggers l ON l.id = a.logger_id
`

function positiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

function effectiveStatus(lastSeen: unknown, stored: unknown, threshold: number) {
  if (!lastSeen) return 'OFFLINE'
  const instant = lastSeen instanceof Date ? lastSeen.getTime() : new Date(String(lastSeen)).getTime()
  if (!Number.isFinite(instant) || Date.now() - instant > threshold * 60_000) return 'OFFLINE'
  return stored === 'WARNING' ? 'WARNING' : 'ONLINE'
}

function normalizePart(row: Record<string, unknown>, threshold: number) {
  const { storedStatus, ...part } = row
  return { ...part, status: effectiveStatus(row.lastSeen, storedStatus, threshold) }
}

function eventFilter(query: Request['query'], startAt = 1) {
  const clauses: string[] = []
  const params: unknown[] = []
  const add = (sql: string, value: unknown) => { params.push(value); clauses.push(sql.replace('?', `$${startAt + params.length - 1}`)) }
  if (query.level && ['INFO', 'WARNING', 'ERROR', 'CRITICAL'].includes(String(query.level))) add('e.level = ?', String(query.level))
  if (query.event) add('e.event ILIKE ?', `%${String(query.event).slice(0, 120)}%`)
  if (query.startDate) add('e.timestamp >= ?::timestamptz', String(query.startDate))
  if (query.endDate) add('e.timestamp <= ?::timestamptz', String(query.endDate))
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
}

function csvCell(value: unknown) {
  let text = Array.isArray(value) ? value.join(' | ') : value == null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function createApp(db: Database) {
  const app = express()
  const threshold = positiveInt(process.env.OFFLINE_THRESHOLD_MINUTES, 10, 1440)
  app.disable('x-powered-by')
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(x => x.trim()) ?? ['http://localhost:5173'] }))
  app.use(express.json({ limit: '256kb' }))
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1 AS ok')
    res.json({ status: 'ok', database: process.env.DATABASE_URL ? 'postgresql' : 'pglite', timestamp: new Date().toISOString() })
  })

  app.get('/api/dashboard', async (_req, res) => {
    const [loggers, failures, recent] = await Promise.all([
      db.query<Record<string, unknown>>('SELECT status, last_seen AS "lastSeen" FROM loggers'),
      db.query<{ level: string; count: string }>(`SELECT level, COUNT(*)::text AS count FROM events WHERE timestamp >= NOW() - INTERVAL '24 hours' AND level IN ('WARNING','ERROR','CRITICAL') GROUP BY level`),
      db.query<Record<string, unknown>>(`SELECT ${eventColumns} FROM events e JOIN loggers l ON l.id=e.logger_id LEFT JOIN part_logger_assignments a ON a.logger_id=l.id AND a.unassigned_at IS NULL LEFT JOIN parts p ON p.id=a.part_id WHERE e.level <> 'INFO' ORDER BY e.timestamp DESC LIMIT 6`),
    ])
    const statuses = loggers.rows.map(x => effectiveStatus(x.lastSeen, x.status, threshold))
    const byLevel = Object.fromEntries(failures.rows.map(x => [x.level, Number(x.count)]))
    res.json({
      summary: { online: statuses.filter(x => x === 'ONLINE').length, offline: statuses.filter(x => x === 'OFFLINE').length, warning: statuses.filter(x => x === 'WARNING').length, critical: byLevel.CRITICAL ?? 0, failures24h: (byLevel.ERROR ?? 0) + (byLevel.CRITICAL ?? 0) },
      recentEvents: recent.rows,
    })
  })

  app.get('/api/parts', async (req, res) => {
    const search = String(req.query.search ?? '').trim()
    const params: unknown[] = []
    let where = ''
    if (search) { params.push(`%${search.slice(0, 120)}%`); where = 'WHERE p.piece_id ILIKE $1 OR p.serial_number ILIKE $1 OR l.logger_id ILIKE $1' }
    const result = await db.query<Record<string, unknown>>(`SELECT ${partColumns} ${partJoins} ${where} ORDER BY p.piece_id LIMIT 50`, params)
    res.json({ items: result.rows.map(x => normalizePart(x, threshold)), count: result.rows.length })
  })

  app.get('/api/parts/:pieceId', async (req, res) => {
    const result = await db.query<Record<string, unknown>>(`SELECT ${partColumns} ${partJoins} WHERE p.piece_id = $1`, [req.params.pieceId])
    if (!result.rows[0]) return res.status(404).json({ error: 'Peça não encontrada.' })
    const latest = await db.query<Record<string, unknown>>(`SELECT ${eventColumns} FROM events e JOIN loggers l ON l.id=e.logger_id LEFT JOIN part_logger_assignments a ON a.logger_id=l.id AND a.unassigned_at IS NULL LEFT JOIN parts p ON p.id=a.part_id WHERE p.piece_id=$1 AND e.level IN ('WARNING','ERROR','CRITICAL') ORDER BY e.timestamp DESC LIMIT 1`, [req.params.pieceId])
    res.json({ ...normalizePart(result.rows[0], threshold), latestFailure: latest.rows[0] ?? null })
  })

  app.get('/api/parts/:pieceId/events', async (req, res) => {
    const exists = await db.query<{ id: string }>('SELECT id FROM parts WHERE piece_id=$1', [req.params.pieceId])
    if (!exists.rows[0]) return res.status(404).json({ error: 'Peça não encontrada.' })
    const limit = positiveInt(req.query.limit, 50, 500)
    const page = positiveInt(req.query.page, 1, 100000)
    const filter = eventFilter(req.query, 2)
    const base = `FROM events e JOIN loggers l ON l.id=e.logger_id JOIN part_logger_assignments a ON a.logger_id=l.id JOIN parts p ON p.id=a.part_id WHERE p.piece_id=$1 AND e.timestamp >= a.assigned_at AND (a.unassigned_at IS NULL OR e.timestamp <= a.unassigned_at) ${filter.sql}`
    const params = [req.params.pieceId, ...filter.params]
    const [items, count] = await Promise.all([
      db.query<Record<string, unknown>>(`SELECT ${eventColumns} ${base} ORDER BY e.timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, (page - 1) * limit]),
      db.query<{ count: string }>(`SELECT COUNT(*)::text AS count ${base}`, params),
    ])
    res.json({ items: items.rows, count: Number(count.rows[0].count), page, limit })
  })

  app.get('/api/parts/:pieceId/events/export', async (req, res) => {
    const filter = eventFilter(req.query, 2)
    const result = await db.query<Record<string, unknown>>(`SELECT ${eventColumns} FROM events e JOIN loggers l ON l.id=e.logger_id JOIN part_logger_assignments a ON a.logger_id=l.id JOIN parts p ON p.id=a.part_id WHERE p.piece_id=$1 AND e.timestamp >= a.assigned_at AND (a.unassigned_at IS NULL OR e.timestamp <= a.unassigned_at) ${filter.sql} ORDER BY e.timestamp DESC LIMIT 10000`, [req.params.pieceId, ...filter.params])
    const headers = ['timestamp','pieceId','loggerId','level','event','signal','expected','received','result','possibleCause','evidence']
    const csv = [headers.map(csvCell).join(','), ...result.rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\r\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.pieceId}-eventos.csv"`)
    res.send(`\uFEFF${csv}`)
  })

  app.get('/api/parts/:pieceId/diagnosis', async (req, res) => {
    const result = await db.query<Record<string, unknown>>(`SELECT ${eventColumns} FROM events e JOIN loggers l ON l.id=e.logger_id JOIN part_logger_assignments a ON a.logger_id=l.id JOIN parts p ON p.id=a.part_id WHERE p.piece_id=$1 AND e.timestamp >= a.assigned_at AND e.level IN ('WARNING','ERROR','CRITICAL') ORDER BY CASE e.level WHEN 'CRITICAL' THEN 1 WHEN 'ERROR' THEN 2 ELSE 3 END, e.timestamp DESC LIMIT 1`, [req.params.pieceId])
    if (!result.rows[0]) return res.json({ diagnosis: null })
    res.json({ diagnosis: result.rows[0] })
  })

  app.get('/api/loggers', async (_req, res) => {
    const result = await db.query<Record<string, unknown>>(`SELECT l.id, l.logger_id AS "loggerId", l.status AS "storedStatus", l.last_seen AS "lastSeen", l.firmware_version AS "firmwareVersion", l.communication_mode AS "communicationMode", l.battery_voltage::float AS "batteryVoltage", l.pending_events AS "pendingEvents", p.piece_id AS "pieceId" FROM loggers l LEFT JOIN part_logger_assignments a ON a.logger_id=l.id AND a.unassigned_at IS NULL LEFT JOIN parts p ON p.id=a.part_id ORDER BY l.logger_id`)
    res.json({ items: result.rows.map(x => normalizePart(x, threshold)), count: result.rows.length })
  })

  app.get('/api/loggers/:loggerId', async (req, res) => {
    const result = await db.query<Record<string, unknown>>(`SELECT l.id, l.logger_id AS "loggerId", l.status AS "storedStatus", l.last_seen AS "lastSeen", l.firmware_version AS "firmwareVersion", l.communication_mode AS "communicationMode", l.battery_voltage::float AS "batteryVoltage", l.pending_events AS "pendingEvents", p.piece_id AS "pieceId" FROM loggers l LEFT JOIN part_logger_assignments a ON a.logger_id=l.id AND a.unassigned_at IS NULL LEFT JOIN parts p ON p.id=a.part_id WHERE l.logger_id=$1`, [req.params.loggerId])
    if (!result.rows[0]) return res.status(404).json({ error: 'Logger não encontrado.' })
    res.json(normalizePart(result.rows[0], threshold))
  })

  app.get('/api/alerts', async (req, res) => {
    const limit = positiveInt(req.query.limit, 100, 500)
    const result = await db.query<Record<string, unknown>>(`SELECT ${eventColumns} FROM events e JOIN loggers l ON l.id=e.logger_id LEFT JOIN part_logger_assignments a ON a.logger_id=l.id AND a.unassigned_at IS NULL LEFT JOIN parts p ON p.id=a.part_id WHERE e.level IN ('WARNING','ERROR','CRITICAL') ORDER BY CASE e.level WHEN 'CRITICAL' THEN 1 WHEN 'ERROR' THEN 2 ELSE 3 END, e.timestamp DESC LIMIT $1`, [limit])
    res.json({ items: result.rows, count: result.rows.length })
  })

  app.post('/api/events', async (req, res) => {
    const parsed = eventSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Payload inválido.', details: z.flattenError(parsed.error).fieldErrors })
    const x = parsed.data
    const result = await db.query<{ id: string; receivedAt: Date }>(`
      WITH target AS (SELECT id FROM loggers WHERE logger_id=$1),
      inserted AS (
        INSERT INTO events (logger_id,timestamp,level,event,signal,expected,received,result,possible_cause,evidence,synchronized)
        SELECT id,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11 FROM target RETURNING id
      ), updated AS (
        UPDATE loggers SET last_seen=NOW(),status='ONLINE',updated_at=NOW() WHERE id IN (SELECT id FROM target)
      ) SELECT id, NOW() AS "receivedAt" FROM inserted
    `, [x.loggerId,x.timestamp,x.level,x.event,x.signal ?? null,x.expected ?? null,x.received ?? null,x.result ?? null,x.possibleCause ?? null,JSON.stringify(x.evidence),x.synchronized])
    if (!result.rows[0]) return res.status(404).json({ error: 'Logger não encontrado.' })
    res.status(201).json({ success: true, eventId: result.rows[0].id, receivedAt: result.rows[0].receivedAt })
  })

  app.post('/api/loggers/:loggerId/heartbeat', async (req, res) => {
    const parsed = heartbeatSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Payload inválido.', details: z.flattenError(parsed.error).fieldErrors })
    const x = parsed.data
    const result = await db.query<Record<string, unknown>>(`UPDATE loggers SET last_seen=NOW(),status='ONLINE',battery_voltage=COALESCE($2,battery_voltage),firmware_version=COALESCE($3,firmware_version),pending_events=COALESCE($4,pending_events),updated_at=NOW() WHERE logger_id=$1 RETURNING logger_id AS "loggerId",last_seen AS "lastSeen",status,battery_voltage::float AS "batteryVoltage",firmware_version AS "firmwareVersion",pending_events AS "pendingEvents"`, [req.params.loggerId,x.batteryVoltage ?? null,x.firmwareVersion ?? null,x.pendingEvents ?? null])
    if (!result.rows[0]) return res.status(404).json({ error: 'Logger não encontrado.' })
    res.json({ success: true, logger: result.rows[0] })
  })

  app.use((_req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }))
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error)
    res.status(500).json({ error: 'Erro interno do servidor.' })
  })
  return app
}
