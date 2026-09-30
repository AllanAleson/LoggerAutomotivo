import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase, migrate, type Database } from '../src/database.js'
import { seed } from '../src/seed.js'

let db: Database
let app: ReturnType<typeof createApp>

before(async () => {
  db = createDatabase({ memory: true })
  await migrate(db)
  await seed(db)
  app = createApp(db)
})
after(async () => db.close())

describe('API Logger Automotivo', () => {
  it('consulta a peça demo e preserva IDs distintos', async () => {
    const response = await request(app).get('/api/parts/PT-00018429').expect(200)
    assert.equal(response.body.pieceId, 'PT-00018429')
    assert.equal(response.body.loggerId, 'LOGGER-001')
    assert.notEqual(response.body.pieceId, response.body.loggerId)
  })

  it('pesquisa por peça, série e logger, incluindo estado vazio', async () => {
    for (const term of ['PT-00018429', 'SN-2026-18429', 'LOGGER-001']) {
      const response = await request(app).get('/api/parts').query({ search: term }).expect(200)
      assert.equal(response.body.count, 1)
    }
    const empty = await request(app).get('/api/parts').query({ search: 'INEXISTENTE' }).expect(200)
    assert.equal(empty.body.count, 0)
  })

  it('consulta eventos e aplica filtros', async () => {
    const all = await request(app).get('/api/parts/PT-00018429/events').query({ limit: 100 }).expect(200)
    assert.ok(all.body.count >= 10)
    const errors = await request(app).get('/api/parts/PT-00018429/events').query({ level: 'ERROR', event: 'TIMEOUT', limit: 100 }).expect(200)
    assert.equal(errors.body.items.length, 1)
    assert.equal(errors.body.items[0].event, 'RESPONSE_TIMEOUT')
    const recent = await request(app).get('/api/parts/PT-00018429/events').query({ startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }).expect(200)
    assert.ok(recent.body.count >= 1)
  })

  it('exporta CSV com colunas e dados da peça', async () => {
    const response = await request(app).get('/api/parts/PT-00018429/events/export').expect(200)
    assert.match(response.headers['content-type'], /text\/csv/)
    assert.match(response.text, /"timestamp","pieceId","loggerId"/)
    assert.match(response.text, /PT-00018429/)
    assert.match(response.text, /LOGGER-001/)
  })

  it('rejeita evento inválido', async () => {
    const response = await request(app).post('/api/events').send({ loggerId: 'LOGGER-001', level: 'INVALID' }).expect(400)
    assert.equal(response.body.error, 'Payload inválido.')
  })

  it('recebe evento genérico e o disponibiliza na consulta', async () => {
    const timestamp = new Date().toISOString()
    const payload = { loggerId: 'LOGGER-001', timestamp, level: 'ERROR', event: 'OUTPUT_RESPONSE_TIMEOUT', signal: 'OUTPUT_RESPONSE', expected: 'HIGH', received: 'NONE', result: 'FAIL', possibleCause: 'Possível falha de conexão, saída ou componente.', evidence: ['Comando detectado', 'Logger permaneceu operacional'] }
    const created = await request(app).post('/api/events').send(payload).expect(201)
    assert.equal(created.body.success, true)
    assert.ok(created.body.eventId)
    const events = await request(app).get('/api/parts/PT-00018429/events').query({ event: 'OUTPUT_RESPONSE_TIMEOUT' }).expect(200)
    assert.equal(events.body.items[0].event, payload.event)
  })

  it('atualiza heartbeat e telemetria do Logger', async () => {
    const timestamp = new Date().toISOString()
    const heartbeat = await request(app).post('/api/loggers/LOGGER-001/heartbeat').send({ timestamp, batteryVoltage: 12.7, firmwareVersion: '0.1.1', pendingEvents: 2 }).expect(200)
    assert.equal(heartbeat.body.success, true)
    const logger = await request(app).get('/api/loggers/LOGGER-001').expect(200)
    assert.equal(logger.body.firmwareVersion, '0.1.1')
    assert.equal(logger.body.batteryVoltage, 12.7)
    assert.equal(logger.body.pendingEvents, 2)
    assert.equal(logger.body.status, 'ONLINE')
  })

  it('retorna diagnóstico baseado em evento sem afirmar causa definitiva', async () => {
    const response = await request(app).get('/api/parts/PT-00018429/diagnosis').expect(200)
    assert.ok(response.body.diagnosis)
    assert.match(response.body.diagnosis.possibleCause, /^Possível/)
  })
})

describe('presence uses server receipt time', () => {
  it('heartbeat -> ONLINE, timeout -> OFFLINE, new heartbeat -> ONLINE across every status endpoint', async () => {
    const isolated = createDatabase({ memory: true })
    const realNow = Date.now
    const previousThreshold = process.env.OFFLINE_THRESHOLD_MINUTES
    process.env.OFFLINE_THRESHOLD_MINUTES = '10'
    try {
      await migrate(isolated)
      await isolated.query("SET TIME ZONE 'America/Sao_Paulo'")
      await isolated.query("INSERT INTO loggers (logger_id) VALUES ('LOGGER-001')")
      await isolated.query("INSERT INTO parts (piece_id, serial_number, model) VALUES ('PT-00018429', 'TEST-SERIAL', 'Test')")
      await isolated.query(`INSERT INTO part_logger_assignments (part_id, logger_id)
        SELECT p.id, l.id FROM parts p CROSS JOIN loggers l`)
      const api = createApp(isolated)
      const check = async (status: string) => {
        const logger = await request(api).get('/api/loggers/LOGGER-001').expect(200)
        assert.equal(logger.body.status, status)
        assert.equal(logger.headers['cache-control'], 'no-store')
        assert.equal((await request(api).get('/api/loggers').expect(200)).body.items[0].status, status)
        assert.equal((await request(api).get('/api/parts?search=PT-00018429').expect(200)).body.items[0].status, status)
        assert.equal((await request(api).get('/api/parts/PT-00018429').expect(200)).body.status, status)
        const dashboard = (await request(api).get('/api/dashboard').expect(200)).body.summary
        assert.equal(dashboard.online, status === 'ONLINE' ? 1 : 0)
        assert.equal(dashboard.offline, status === 'OFFLINE' ? 1 : 0)
      }
      await check('OFFLINE')
      for (const timestamp of ['2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z', '2000-01-01T03:00:00+03:00']) {
        Date.now = realNow
        const before = realNow()
        const heartbeat = await request(api).post('/api/loggers/LOGGER-001/heartbeat')
          .send({ timestamp, batteryVoltage: 12.7, firmwareVersion: 'test', pendingEvents: 2 }).expect(200)
        const received = Date.parse(heartbeat.body.logger.lastSeen)
        assert.ok(received >= before && received <= realNow())
        const persisted = (await request(api).get('/api/loggers/LOGGER-001').expect(200)).body
        assert.equal(persisted.lastSeen, heartbeat.body.logger.lastSeen)
        assert.equal(persisted.batteryVoltage, 12.7)
        assert.equal(persisted.firmwareVersion, 'test')
        assert.equal(persisted.pendingEvents, 2)
        Date.now = () => received + 30_000
        await check('ONLINE')
        Date.now = () => received + 600_000
        await check('ONLINE')
        Date.now = () => received + 600_001
        await check('OFFLINE')
      }
      Date.now = realNow
      await request(api).post('/api/loggers/LOGGER-001/heartbeat').send({ timestamp: '2000-01-01T00:00:00Z' }).expect(200)
      await check('ONLINE')
      const before = realNow()
      const event = await request(api).post('/api/events').send({ loggerId: 'LOGGER-001', timestamp: '2000-01-01T03:00:00+03:00', level: 'INFO', event: 'LOCK' }).expect(201)
      const stored = await isolated.query<{ timestamp: Date }>('SELECT timestamp FROM events WHERE id=$1', [event.body.eventId])
      assert.equal(stored.rows[0].timestamp.toISOString(), '2000-01-01T00:00:00.000Z')
      const logger = (await request(api).get('/api/loggers/LOGGER-001').expect(200)).body
      assert.ok(Date.parse(logger.lastSeen) >= before)
      await check('ONLINE')
    } finally {
      Date.now = realNow
      if (previousThreshold === undefined) delete process.env.OFFLINE_THRESHOLD_MINUTES
      else process.env.OFFLINE_THRESHOLD_MINUTES = previousThreshold
      await isolated.close()
    }
  })
})