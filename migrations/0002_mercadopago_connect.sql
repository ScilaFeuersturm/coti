-- Conexión de Mercado Pago por negocio (OAuth): cada negocio cobra las señas en SU cuenta.
-- Los tokens se guardan cifrados (AES-GCM) con la clave TOKEN_ENCRYPTION_KEY del Worker.

CREATE TABLE mp_connections (
  workshop_id TEXT PRIMARY KEY REFERENCES workshops(id) ON DELETE CASCADE,
  mp_user_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  public_key TEXT NOT NULL DEFAULT '',
  live_mode INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_mp_connections_user ON mp_connections(mp_user_id);

-- "state" de un solo uso para el ida y vuelta con Mercado Pago (protección CSRF del OAuth).
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
