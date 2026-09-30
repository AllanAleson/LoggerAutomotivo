$ErrorActionPreference = 'Stop'
$project = 'C:\Users\aluno\Desktop\DSM\log\LoggerAutomotivo\Logger\LoggerAutomotivo'
$encoding = New-Object System.Text.UTF8Encoding($false)
$file = Join-Path $project 'backend/src/app.ts'
$source = [IO.File]::ReadAllText($file)
$source = $source.Replace("if (Date.now() - new Date(String(lastSeen)).getTime() > threshold * 60_000) return 'OFFLINE'", "const instant = lastSeen instanceof Date ? lastSeen.getTime() : new Date(String(lastSeen)).getTime()`n  if (!Number.isFinite(instant) || Date.now() - instant > threshold * 60_000) return 'OFFLINE'")
$source = $source.Replace("UPDATE loggers SET last_seen=`$2::timestamptz,status='ONLINE',updated_at=NOW()", "UPDATE loggers SET last_seen=NOW(),status='ONLINE',updated_at=NOW()")
$source = $source.Replace("last_seen=`$2::timestamptz,status='ONLINE',battery_voltage=COALESCE(`$3,battery_voltage),firmware_version=COALESCE(`$4,firmware_version),pending_events=COALESCE(`$5,pending_events)", "last_seen=NOW(),status='ONLINE',battery_voltage=COALESCE(`$2,battery_voltage),firmware_version=COALESCE(`$3,firmware_version),pending_events=COALESCE(`$4,pending_events)")
$source = $source.Replace('[req.params.loggerId,x.timestamp,x.batteryVoltage', '[req.params.loggerId,x.batteryVoltage')
[IO.File]::WriteAllText($file, $source, $encoding)
$testFile = Join-Path $project 'backend/test/api.test.ts'
$tests = @'

describe('UTC presence regression (isolated PGlite)', () => {
  it('uses receipt time despite past/future RTC and offset, and preserves event time', async () => {
    const isolated = createDatabase({ memory: true })
    try {
      await migrate(isolated)
      await isolated.query("SET TIME ZONE 'America/Sao_Paulo'")
      await isolated.query("INSERT INTO loggers (logger_id) VALUES ('LOGGER-001')")
      const api = createApp(isolated)
      for (const timestamp of ['2026-09-30T10:32:55Z', '2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z', '2026-09-30T10:32:55-03:00']) {
        const before = Date.now()
        const heartbeat = await request(api).post('/api/loggers/LOGGER-001/heartbeat').send({ timestamp }).expect(200)
        const lastSeen = heartbeat.body.logger.lastSeen
        assert.match(lastSeen, /Z$/)
        assert.ok(Date.parse(lastSeen) >= before && Date.parse(lastSeen) <= Date.now())
        assert.equal((await request(api).get('/api/loggers/LOGGER-001').expect(200)).body.status, 'ONLINE')
        assert.equal((await request(api).get('/api/loggers').expect(200)).body.items[0].status, 'ONLINE')
        assert.equal((await request(api).get('/api/dashboard').expect(200)).body.summary.online, 1)
      }
      const before = Date.now()
      const event = await request(api).post('/api/events').send({ loggerId: 'LOGGER-001', timestamp: '2000-01-01T03:00:00+03:00', level: 'INFO', event: 'LOCK' }).expect(201)
      const stored = await isolated.query<{ timestamp: Date }>('SELECT timestamp FROM events WHERE id=$1', [event.body.eventId])
      assert.equal(stored.rows[0].timestamp.toISOString(), '2000-01-01T00:00:00.000Z')
      const logger = (await request(api).get('/api/loggers/LOGGER-001').expect(200)).body
      assert.ok(Date.parse(logger.lastSeen) >= before)
      assert.equal(logger.status, 'ONLINE')
    } finally { await isolated.close() }
  })

  it('keeps 30-second heartbeats online and expires at the existing threshold', async () => {
    const isolated = createDatabase({ memory: true })
    const originalNow = Date.now
    const previousThreshold = process.env.OFFLINE_THRESHOLD_MINUTES
    process.env.OFFLINE_THRESHOLD_MINUTES = '10'
    try {
      await migrate(isolated)
      await isolated.query("INSERT INTO loggers (logger_id) VALUES ('LOGGER-001')")
      const api = createApp(isolated)
      for (let cycle = 0; cycle < 3; cycle++) {
        Date.now = originalNow
        const response = await request(api).post('/api/loggers/LOGGER-001/heartbeat').send({ timestamp: '2000-01-01T00:00:00Z' }).expect(200)
        const received = Date.parse(response.body.logger.lastSeen)
        Date.now = () => received + 30_000
        assert.equal((await request(api).get('/api/loggers/LOGGER-001').expect(200)).body.status, 'ONLINE')
        Date.now = () => received + 600_000
        assert.equal((await request(api).get('/api/loggers/LOGGER-001').expect(200)).body.status, 'ONLINE')
        Date.now = () => received + 600_001
        assert.equal((await request(api).get('/api/loggers/LOGGER-001').expect(200)).body.status, 'OFFLINE')
      }
    } finally {
      Date.now = originalNow
      if (previousThreshold === undefined) delete process.env.OFFLINE_THRESHOLD_MINUTES
      else process.env.OFFLINE_THRESHOLD_MINUTES = previousThreshold
      await isolated.close()
    }
  })
})
'@
[IO.File]::AppendAllText($testFile, $tests, $encoding)
