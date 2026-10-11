-- Where and when each person gets alerts (src/alerts.ts). One row per person; missing = defaults.
CREATE TABLE alert_settings (
  user TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'instant_strong',   -- instant_strong | daily | off
  quiet_start TEXT, quiet_end TEXT,              -- 'HH:MM' New York time, both or neither
  email TEXT, email_verified INTEGER NOT NULL DEFAULT 0, email_enabled INTEGER NOT NULL DEFAULT 0,
  phone TEXT, phone_verified INTEGER NOT NULL DEFAULT 0, sms_enabled INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);

-- The current verification code per person and channel, hashed. Replaced on each send.
CREATE TABLE alert_codes (
  user TEXT NOT NULL, channel TEXT NOT NULL,     -- email | sms
  dest TEXT NOT NULL,                            -- the address or number the code went to
  code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user, channel)
);

-- Everything sent: codes, tests and real alerts. Rate limits read it, and the matcher uses
-- (user, listing_id, reason) so the same place is never alerted twice.
CREATE TABLE alert_log (
  id INTEGER PRIMARY KEY,
  user TEXT NOT NULL, channel TEXT NOT NULL,
  kind TEXT NOT NULL,                            -- code | test | alert | digest
  dest TEXT NOT NULL,
  listing_id INTEGER, reason TEXT,
  message_id TEXT, error TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX alert_log_user_at ON alert_log (user, kind, at);
CREATE UNIQUE INDEX alert_log_once ON alert_log (user, listing_id, reason) WHERE kind = 'alert';
