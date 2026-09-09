import type { Database } from './database.js'

const demoEvents = [
  { hours: 48, level: 'INFO', event: 'LOGGER_START', signal: 'SYSTEM', expected: 'READY', received: 'READY', result: 'OK', cause: null, evidence: [] },
  { hours: 30, level: 'INFO', event: 'IGNITION_ON', signal: 'IGNITION', expected: 'HIGH', received: 'HIGH', result: 'OK', cause: null, evidence: ['Transição de sinal registrada'] },
  { hours: 26, level: 'WARNING', event: 'ANALOG_WARNING', signal: 'SUPPLY_VOLTAGE', expected: '>= 11.8V', received: '11.4V', result: 'WARNING', cause: 'Possível queda momentânea na alimentação elétrica.', evidence: ['Tensão abaixo do limite configurado', 'Logger permaneceu operacional'] },
  { hours: 23, level: 'INFO', event: 'LOCK_COMMAND', signal: 'LOCK_COMMAND', expected: 'HIGH', received: 'HIGH', result: 'OK', cause: null, evidence: [] },
  { hours: 23, minutes: -1, level: 'INFO', event: 'LOCK_RESPONSE', signal: 'LOCK_RESPONSE', expected: 'HIGH', received: 'HIGH', result: 'OK', cause: null, evidence: [] },
  { hours: 8, level: 'INFO', event: 'UNLOCK_COMMAND', signal: 'UNLOCK_COMMAND', expected: 'HIGH', received: 'HIGH', result: 'OK', cause: null, evidence: [] },
  { hours: 8, minutes: -1, level: 'INFO', event: 'UNLOCK_RESPONSE', signal: 'UNLOCK_RESPONSE', expected: 'HIGH', received: 'HIGH', result: 'OK', cause: null, evidence: [] },
  { hours: 4, level: 'ERROR', event: 'COMMUNICATION_LOST', signal: 'CELLULAR_LINK', expected: 'CONNECTED', received: 'DISCONNECTED', result: 'FAIL', cause: 'Possível indisponibilidade temporária da rede ou sinal insuficiente.', evidence: ['Tentativas de envio sem confirmação', 'Eventos mantidos na fila local'] },
  { hours: 3, minutes: 45, level: 'INFO', event: 'COMMUNICATION_RESTORED', signal: 'CELLULAR_LINK', expected: 'CONNECTED', received: 'CONNECTED', result: 'OK', cause: null, evidence: ['Fila local sincronizada'] },
  { hours: 1, level: 'ERROR', event: 'RESPONSE_TIMEOUT', signal: 'LOCK_RESPONSE', expected: 'HIGH', received: 'NONE', result: 'FAIL', cause: 'Possível falha de conexão, saída ou componente.', evidence: ['Comando LOCK detectado', 'Logger permaneceu operacional', 'Resposta LOCK_RESPONSE não foi detectada dentro do tempo esperado'] },
  { hours: 0, minutes: 8, level: 'INFO', event: 'HEARTBEAT', signal: 'SYSTEM', expected: 'ONLINE', received: 'ONLINE', result: 'OK', cause: null, evidence: [] },
]

export async function seed(db: Database) {
  const logger = await db.query<{ id: string }>(`
    INSERT INTO loggers (logger_id, status, last_seen, firmware_version, communication_mode, battery_voltage, pending_events)
    VALUES ('LOGGER-001', 'ONLINE', NOW() - INTERVAL '2 minutes', '0.1.0', 'CELLULAR', 12.4, 0)
    ON CONFLICT (logger_id) DO UPDATE SET
      status = EXCLUDED.status, last_seen = EXCLUDED.last_seen, firmware_version = EXCLUDED.firmware_version,
      communication_mode = EXCLUDED.communication_mode, battery_voltage = EXCLUDED.battery_voltage,
      pending_events = EXCLUDED.pending_events, updated_at = NOW()
    RETURNING id
  `)
  const part = await db.query<{ id: string }>(`
    INSERT INTO parts (piece_id, serial_number, model, description, vehicle_identifier)
    VALUES ('PT-00018429', 'SN-2026-18429', 'Módulo Automotivo Demonstrativo', 'Peça de demonstração do Logger IoT Automotivo', 'VEICULO-DEMO-01')
    ON CONFLICT (piece_id) DO UPDATE SET model = EXCLUDED.model, description = EXCLUDED.description, updated_at = NOW()
    RETURNING id
  `)
  await db.query(`
    INSERT INTO part_logger_assignments (part_id, logger_id, assigned_at)
    SELECT $1, $2, NOW() - INTERVAL '60 days' WHERE NOT EXISTS (
      SELECT 1 FROM part_logger_assignments WHERE part_id = $1 AND logger_id = $2 AND unassigned_at IS NULL
    )
  `, [part.rows[0].id, logger.rows[0].id])

  const count = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM events WHERE logger_id = $1', [logger.rows[0].id])
  if (Number(count.rows[0].count) === 0) {
    for (const item of demoEvents) {
      const minutes = item.hours * 60 + (item.minutes ?? 0)
      await db.query(`
        INSERT INTO events (logger_id, timestamp, level, event, signal, expected, received, result, possible_cause, evidence)
        VALUES ($1, NOW() - ($2 * INTERVAL '1 minute'), $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      `, [logger.rows[0].id, minutes, item.level, item.event, item.signal, item.expected, item.received, item.result, item.cause, JSON.stringify(item.evidence)])
    }
  }
}
