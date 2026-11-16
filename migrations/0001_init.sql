-- Esquema inicial de Coti (Cloudflare D1 / SQLite).
-- Todo dato de negocio pertenece a un taller (workshop_id).

CREATE TABLE workshops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL DEFAULT '',
  cbu TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  default_deposit_pct INTEGER NOT NULL DEFAULT 40,
  validity_days INTEGER NOT NULL DEFAULT 7,
  timezone TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  next_quote_number INTEGER NOT NULL DEFAULT 1001,
  created_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Intentos de login/registro, para limitar fuerza bruta entre todas las instancias del Worker.
CREATE TABLE auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_attempts_key ON auth_attempts(key, created_at);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_clients_ws ON clients(workshop_id, phone_digits);

CREATE TABLE catalog (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_catalog_ws ON catalog(workshop_id);

CREATE TABLE quick_addons (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  title TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_addons_ws ON quick_addons(workshop_id);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  public_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_address TEXT NOT NULL DEFAULT '',
  service_summary TEXT NOT NULL DEFAULT '',
  voice_transcript TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  total REAL NOT NULL,
  deposit_pct INTEGER NOT NULL,
  deposit_amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'waiting_reply', 'approved')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  reminded_at INTEGER,
  approved_at INTEGER,
  payment_method TEXT,
  transfer_reported_at INTEGER,
  validity_days INTEGER NOT NULL DEFAULT 7,
  UNIQUE (workshop_id, code)
);
CREATE INDEX idx_quotes_ws ON quotes(workshop_id, status);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  status TEXT NOT NULL,
  amount REAL,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_payment_id)
);
