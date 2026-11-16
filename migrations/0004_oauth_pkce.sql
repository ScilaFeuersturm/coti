-- PKCE (S256) en la conexión con Mercado Pago: el "code_verifier" se guarda junto al state
-- y solo Coti puede canjear el código de autorización.
ALTER TABLE oauth_states ADD COLUMN code_verifier TEXT NOT NULL DEFAULT '';
