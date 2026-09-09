CREATE TABLE IF NOT EXISTS loggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logger_id VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'WARNING')),
  last_seen TIMESTAMPTZ,
  firmware_version VARCHAR(40),
  communication_mode VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN',
  battery_voltage NUMERIC(6,2),
  pending_events INTEGER NOT NULL DEFAULT 0 CHECK (pending_events >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id VARCHAR(80) NOT NULL UNIQUE,
  serial_number VARCHAR(120) NOT NULL UNIQUE,
  model VARCHAR(160) NOT NULL,
  description TEXT,
  vehicle_identifier VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS part_logger_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  logger_id UUID NOT NULL REFERENCES loggers(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_logger_per_part
  ON part_logger_assignments(part_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_part_per_logger
  ON part_logger_assignments(logger_id) WHERE unassigned_at IS NULL;

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logger_id UUID NOT NULL REFERENCES loggers(id) ON DELETE RESTRICT,
  timestamp TIMESTAMPTZ NOT NULL,
  level VARCHAR(20) NOT NULL CHECK (level IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  event VARCHAR(120) NOT NULL,
  signal VARCHAR(120),
  expected TEXT,
  received TEXT,
  result VARCHAR(80),
  possible_cause TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  synchronized BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_logger_timestamp_idx ON events(logger_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS events_level_timestamp_idx ON events(level, timestamp DESC);
CREATE INDEX IF NOT EXISTS assignments_part_idx ON part_logger_assignments(part_id, assigned_at DESC);
