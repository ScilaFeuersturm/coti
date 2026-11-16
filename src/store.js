// Capa de datos de Coti sobre la API de Cloudflare D1 (db.prepare().bind().first()/all()/run(), db.batch()).
// Todas las consultas del panel filtran por workshop_id: un taller nunca ve datos de otro.
// D1 no admite BEGIN/COMMIT: lo que debe ser atómico va en db.batch(), que es transaccional.

import { getSeedData } from "./seed.js";

const DEFAULT_ADDONS = [
  { label: "+ Materiales / Repuestos", title: "Materiales y repuestos adicionales", price: 50000 },
  { label: "+ Mano de obra extra", title: "Mano de obra adicional", price: 50000 },
  { label: "+ Flete y traslado", title: "Traslado y logística a domicilio", price: 30000 }
];

const uid = () => crypto.randomUUID();
export const digits = (s) => String(s ?? "").replace(/\D/g, "");

// ID público de 12 caracteres (72 bits aleatorios): imposible de adivinar.
function publicId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
}

// D1 no acepta undefined en bind(): se normaliza a null.
const n = (v) => (v === undefined ? null : v);

// ---------------------------------------------------------------------------
// Mapeos fila SQL -> objeto del frontend (camelCase)
// ---------------------------------------------------------------------------
function mapWorkshop(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    owner: r.owner,
    phone: r.phone,
    alias: r.alias,
    cbu: r.cbu,
    currency: r.currency,
    defaultDepositPct: r.default_deposit_pct,
    validityDays: r.validity_days,
    timezone: r.timezone,
    createdAt: r.created_at,
    trialEndsAt: r.trial_ends_at
  };
}

const mapClient = (r) => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  address: r.address,
  notes: r.notes,
  createdAt: r.created_at
});

const mapCatalog = (r) => ({ id: r.id, title: r.title, category: r.category, price: r.price, description: r.description });

const mapAddon = (r) => ({ id: r.id, label: r.label, title: r.title, price: r.price });

function mapQuote(r) {
  if (!r) return null;
  return {
    id: r.id,
    publicId: r.public_id,
    code: r.code,
    clientId: r.client_id,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    clientAddress: r.client_address,
    serviceSummary: r.service_summary,
    voiceTranscript: r.voice_transcript,
    items: JSON.parse(r.items_json),
    total: r.total,
    depositPct: r.deposit_pct,
    depositAmount: r.deposit_amount,
    status: r.status,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    remindedAt: r.reminded_at,
    approvedAt: r.approved_at,
    paymentMethod: r.payment_method,
    transferReportedAt: r.transfer_reported_at,
    validityDays: r.validity_days
  };
}

export class CotiStore {
  constructor(db) {
    this.db = db;
  }

  q(sql, ...params) {
    return this.db.prepare(sql).bind(...params.map(n));
  }

  async rows(sql, ...params) {
    const { results } = await this.q(sql, ...params).all();
    return results || [];
  }

  // ------------------------------------------------------------------ Cuentas
  async countUsers() {
    return (await this.q("SELECT COUNT(*) AS c FROM users").first("c")) || 0;
  }

  findUserByEmail(email) {
    return this.q("SELECT * FROM users WHERE email = ?", String(email).trim()).first();
  }

  async createAccount({ email, passwordHash, workshopName, ownerName, phone, withDemoData, demoIdentity, trialDays = 14 }) {
    const now = Date.now();
    const wsId = uid();
    const userId = uid();
    const seed = getSeedData();
    const identity = demoIdentity ? seed.workshop : null;
    const stmts = [
      this.q(
        `INSERT INTO workshops (id, name, owner, phone, alias, cbu, currency, default_deposit_pct, validity_days, created_at, trial_ends_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, ?)`,
        wsId,
        identity ? identity.name : workshopName,
        identity ? identity.owner : ownerName,
        identity ? identity.phone : phone || "",
        identity ? identity.alias : "",
        identity ? identity.cbu : "",
        identity ? identity.defaultDepositPct : 40,
        identity ? identity.validityDays : 7,
        now,
        now + trialDays * 86400000
      ),
      this.q(
        "INSERT INTO users (id, workshop_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        userId,
        wsId,
        String(email).trim(),
        passwordHash,
        now
      ),
      ...(withDemoData ? this._demoStatements(wsId, seed) : this._addonStatements(wsId, DEFAULT_ADDONS))
    ];
    await this.db.batch(stmts);
    return { userId, workshopId: wsId };
  }

  // ------------------------------------------------------------------ Límite de intentos (login / registro)
  async tooManyAttempts(key, max, windowMs) {
    const since = Date.now() - windowMs;
    const count = await this.q("SELECT COUNT(*) AS c FROM auth_attempts WHERE key = ? AND created_at > ?", key, since).first("c");
    return count >= max;
  }

  async recordAttempt(key) {
    await this.q("INSERT INTO auth_attempts (key, created_at) VALUES (?, ?)", key, Date.now()).run();
  }

  async clearAttempts(key) {
    await this.q("DELETE FROM auth_attempts WHERE key = ?", key).run();
  }

  // Limpieza ocasional de sesiones e intentos viejos (se llama al hacer login).
  async purgeExpired() {
    const now = Date.now();
    await this.db.batch([
      this.q("DELETE FROM sessions WHERE expires_at < ?", now),
      this.q("DELETE FROM auth_attempts WHERE created_at < ?", now - 24 * 3600 * 1000)
    ]);
  }

  // ------------------------------------------------------------------ Sesiones
  async createSession(tokenHash, userId, ttlMs) {
    const now = Date.now();
    await this.q(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      tokenHash,
      userId,
      now,
      now + ttlMs
    ).run();
  }

  getSession(tokenHash) {
    return this.q(
      `SELECT s.user_id, s.expires_at, u.workshop_id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
      tokenHash
    ).first();
  }

  async deleteSession(tokenHash) {
    await this.q("DELETE FROM sessions WHERE token_hash = ?", tokenHash).run();
  }

  // ------------------------------------------------------------------ Taller
  async getWorkshop(wsId) {
    return mapWorkshop(await this.q("SELECT * FROM workshops WHERE id = ?", wsId).first());
  }

  async updateWorkshop(wsId, f) {
    await this.q(
      `UPDATE workshops SET name = ?, owner = ?, phone = ?, alias = ?, cbu = ?,
         default_deposit_pct = ?, validity_days = ? WHERE id = ?`,
      f.name,
      f.owner,
      f.phone,
      f.alias,
      f.cbu,
      f.defaultDepositPct,
      f.validityDays,
      wsId
    ).run();
    return this.getWorkshop(wsId);
  }

  // ------------------------------------------------------------------ Estado completo del panel
  async getState(wsId) {
    const [ws, catalog, addons, clients, quotes, mp] = await this.db.batch([
      this.q("SELECT * FROM workshops WHERE id = ?", wsId),
      this.q("SELECT * FROM catalog WHERE workshop_id = ? ORDER BY created_at DESC", wsId),
      this.q("SELECT * FROM quick_addons WHERE workshop_id = ? ORDER BY position", wsId),
      this.q("SELECT * FROM clients WHERE workshop_id = ? ORDER BY created_at DESC", wsId),
      this.q("SELECT * FROM quotes WHERE workshop_id = ? ORDER BY created_at DESC", wsId),
      // Solo el estado de la conexión; los tokens nunca salen de la base.
      this.q("SELECT mp_user_id, live_mode, connected_at FROM mp_connections WHERE workshop_id = ?", wsId)
    ]);
    const mpRow = (mp.results || [])[0];
    return {
      workshop: {
        ...mapWorkshop((ws.results || [])[0]),
        mercadoPago: mpRow
          ? { connected: true, mpUserId: mpRow.mp_user_id, liveMode: Boolean(mpRow.live_mode), connectedAt: mpRow.connected_at }
          : { connected: false }
      },
      catalog: (catalog.results || []).map(mapCatalog),
      quickAddons: (addons.results || []).map(mapAddon),
      clients: (clients.results || []).map(mapClient),
      quotes: (quotes.results || []).map(mapQuote)
    };
  }

  // ------------------------------------------------------------------ Clientes
  async getClient(wsId, id) {
    const r = await this.q("SELECT * FROM clients WHERE id = ? AND workshop_id = ?", id, wsId).first();
    return r ? mapClient(r) : null;
  }

  async updateClient(wsId, id, f) {
    const res = await this.q(
      `UPDATE clients SET name = ?, phone = ?, phone_digits = ?, address = ?, notes = ?
       WHERE id = ? AND workshop_id = ?`,
      f.name,
      f.phone,
      digits(f.phone),
      f.address,
      f.notes,
      id,
      wsId
    ).run();
    return res.meta.changes > 0 ? this.getClient(wsId, id) : null;
  }

  async deleteClient(wsId, id) {
    const res = await this.q("DELETE FROM clients WHERE id = ? AND workshop_id = ?", id, wsId).run();
    return res.meta.changes > 0;
  }

  // ------------------------------------------------------------------ Catálogo
  async addCatalogItem(wsId, f) {
    const id = uid();
    await this.q(
      "INSERT INTO catalog (id, workshop_id, title, category, price, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      wsId,
      f.title,
      f.category,
      f.price,
      f.description,
      Date.now()
    ).run();
    return mapCatalog(await this.q("SELECT * FROM catalog WHERE id = ?", id).first());
  }

  async updateCatalogItem(wsId, id, f) {
    const res = await this.q(
      "UPDATE catalog SET title = ?, category = ?, price = ?, description = ? WHERE id = ? AND workshop_id = ?",
      f.title,
      f.category,
      f.price,
      f.description,
      id,
      wsId
    ).run();
    if (!res.meta.changes) return null;
    return mapCatalog(await this.q("SELECT * FROM catalog WHERE id = ?", id).first());
  }

  async deleteCatalogItem(wsId, id) {
    const res = await this.q("DELETE FROM catalog WHERE id = ? AND workshop_id = ?", id, wsId).run();
    return res.meta.changes > 0;
  }

  // ------------------------------------------------------------------ Presupuestos
  async getQuote(wsId, idOrCode) {
    return mapQuote(
      await this.q("SELECT * FROM quotes WHERE workshop_id = ? AND (id = ? OR code = ?)", wsId, idOrCode, idOrCode).first()
    );
  }

  async getQuoteById(id) {
    return mapQuote(await this.q("SELECT * FROM quotes WHERE id = ?", id).first());
  }

  async getQuoteByPublicId(pid) {
    const r = await this.q("SELECT * FROM quotes WHERE public_id = ?", pid).first();
    if (!r) return null;
    return { quote: mapQuote(r), workshop: await this.getWorkshop(r.workshop_id) };
  }

  async createQuote(wsId, q) {
    const now = Date.now();
    const phoneDigits = digits(q.clientPhone);

    // Reserva atómica del número de presupuesto (COT-XXXX) del taller.
    const reserved = await this.q(
      `UPDATE workshops SET next_quote_number = next_quote_number + 1 WHERE id = ?
       RETURNING next_quote_number - 1 AS number, validity_days`,
      wsId
    ).first();

    // Agenda: se busca por teléfono (no por nombre: dos "Juan" no son el mismo cliente).
    const existing = await this.q(
      "SELECT id, address FROM clients WHERE workshop_id = ? AND phone_digits = ?",
      wsId,
      phoneDigits
    ).first();
    const clientId = existing ? existing.id : uid();
    const clientStmt = existing
      ? this.q(
          "UPDATE clients SET name = ?, phone = ?, address = CASE WHEN ? <> '' THEN ? ELSE address END WHERE id = ?",
          q.clientName,
          q.clientPhone,
          q.clientAddress,
          q.clientAddress,
          clientId
        )
      : this.q(
          `INSERT INTO clients (id, workshop_id, name, phone, phone_digits, address, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
          clientId,
          wsId,
          q.clientName,
          q.clientPhone,
          phoneDigits,
          q.clientAddress,
          now
        );

    const id = uid();
    await this.db.batch([
      clientStmt,
      this.q(
        `INSERT INTO quotes (id, workshop_id, public_id, code, client_id, client_name, client_phone,
           client_address, service_summary, voice_transcript, items_json, total, deposit_pct,
           deposit_amount, status, created_at, sent_at, validity_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        wsId,
        publicId(),
        `COT-${reserved.number}`,
        clientId,
        q.clientName,
        q.clientPhone,
        q.clientAddress || (existing && existing.address) || "",
        q.serviceSummary,
        q.voiceTranscript,
        JSON.stringify(q.items),
        q.total,
        q.depositPct,
        q.depositAmount,
        q.sendImmediately ? "waiting_reply" : "draft",
        now,
        q.sendImmediately ? now : null,
        reserved.validity_days
      )
    ]);
    return this.getQuoteById(id);
  }

  async markSent(wsId, id) {
    await this.q(
      `UPDATE quotes SET status = 'waiting_reply', sent_at = COALESCE(sent_at, ?)
       WHERE workshop_id = ? AND (id = ? OR code = ?) AND status = 'draft'`,
      Date.now(),
      wsId,
      id,
      id
    ).run();
    return this.getQuote(wsId, id);
  }

  async markReminded(wsId, id) {
    await this.q("UPDATE quotes SET reminded_at = ? WHERE workshop_id = ? AND (id = ? OR code = ?)", Date.now(), wsId, id, id).run();
    return this.getQuote(wsId, id);
  }

  // Solo modo demo: retrocede el envío 50hs para ver la alerta ámbar.
  async ageQuote48h(wsId, id) {
    await this.q(
      `UPDATE quotes SET status = 'waiting_reply', sent_at = ?
       WHERE workshop_id = ? AND (id = ? OR code = ?) AND status <> 'approved'`,
      Date.now() - 50 * 3600 * 1000,
      wsId,
      id,
      id
    ).run();
    return this.getQuote(wsId, id);
  }

  async reportTransfer(quoteId) {
    await this.q(
      "UPDATE quotes SET transfer_reported_at = ? WHERE id = ? AND status <> 'approved' AND transfer_reported_at IS NULL",
      Date.now(),
      quoteId
    ).run();
    return this.getQuoteById(quoteId);
  }

  // Aprueba el presupuesto registrando el pago. Idempotente por (provider, providerPaymentId):
  // un webhook repetido de Mercado Pago no duplica nada.
  async approveQuote(quoteId, { method, provider, providerPaymentId = null, amount = null }) {
    const now = Date.now();
    const [ins] = await this.db.batch([
      this.q(
        `INSERT OR IGNORE INTO payments (id, quote_id, provider, provider_payment_id, status, amount, created_at)
         VALUES (?, ?, ?, ?, 'approved', ?, ?)`,
        uid(),
        quoteId,
        provider,
        providerPaymentId ? String(providerPaymentId) : null,
        amount,
        now
      ),
      this.q(
        `UPDATE quotes SET status = 'approved', approved_at = COALESCE(approved_at, ?),
           payment_method = ?, sent_at = COALESCE(sent_at, ?)
         WHERE id = ? AND status <> 'approved'`,
        now,
        method,
        now,
        quoteId
      )
    ]);
    return { quote: await this.getQuoteById(quoteId), duplicate: ins.meta.changes === 0 };
  }

  // ------------------------------------------------------------------ Mercado Pago por negocio (OAuth)
  async createOAuthState(wsId, state, codeVerifier) {
    const now = Date.now();
    await this.db.batch([
      this.q("DELETE FROM oauth_states WHERE created_at < ?", now - 30 * 60 * 1000),
      this.q(
        "INSERT INTO oauth_states (state, workshop_id, code_verifier, created_at) VALUES (?, ?, ?, ?)",
        state,
        wsId,
        codeVerifier,
        now
      )
    ]);
  }

  // Consume el state (un solo uso). Devuelve { workshopId, codeVerifier } si es válido y no venció (15 min).
  async consumeOAuthState(state) {
    const row = await this.q(
      "DELETE FROM oauth_states WHERE state = ? RETURNING workshop_id, code_verifier, created_at",
      state
    ).first();
    if (!row || Date.now() - row.created_at > 15 * 60 * 1000) return null;
    return { workshopId: row.workshop_id, codeVerifier: row.code_verifier };
  }

  getMpConnectionRow(wsId) {
    return this.q("SELECT * FROM mp_connections WHERE workshop_id = ?", wsId).first();
  }

  async saveMpConnection(wsId, c) {
    const now = Date.now();
    await this.q(
      `INSERT INTO mp_connections (workshop_id, mp_user_id, access_token_enc, refresh_token_enc, public_key,
         live_mode, expires_at, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workshop_id) DO UPDATE SET
         mp_user_id = excluded.mp_user_id, access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc, public_key = excluded.public_key,
         live_mode = excluded.live_mode, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      wsId,
      String(c.mpUserId),
      c.accessTokenEnc,
      c.refreshTokenEnc,
      c.publicKey || "",
      c.liveMode ? 1 : 0,
      c.expiresAt,
      now,
      now
    ).run();
  }

  async deleteMpConnection(wsId) {
    await this.q("DELETE FROM mp_connections WHERE workshop_id = ?", wsId).run();
  }

  // ------------------------------------------------------------------ Demo
  async resetToDemo(wsId) {
    await this.db.batch([
      this.q("DELETE FROM quotes WHERE workshop_id = ?", wsId),
      this.q("DELETE FROM clients WHERE workshop_id = ?", wsId),
      this.q("DELETE FROM catalog WHERE workshop_id = ?", wsId),
      this.q("DELETE FROM quick_addons WHERE workshop_id = ?", wsId),
      ...this._demoStatements(wsId, getSeedData())
    ]);
  }

  // Sentencias que cargan los datos de ejemplo en un taller, con IDs nuevos.
  _demoStatements(wsId, seed) {
    const stmts = [];
    seed.catalog.forEach((c, i) =>
      stmts.push(
        this.q(
          "INSERT INTO catalog (id, workshop_id, title, category, price, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          uid(),
          wsId,
          c.title,
          c.category,
          c.price,
          c.description,
          Date.now() - i
        )
      )
    );
    stmts.push(...this._addonStatements(wsId, seed.quickAddons));

    const clientIdMap = {};
    for (const c of seed.clients) {
      clientIdMap[c.id] = uid();
      stmts.push(
        this.q(
          `INSERT INTO clients (id, workshop_id, name, phone, phone_digits, address, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          clientIdMap[c.id],
          wsId,
          c.name,
          c.phone,
          digits(c.phone),
          c.address,
          c.notes,
          c.createdAt
        )
      );
    }

    let maxNum = 1000;
    for (const q of seed.quotes) {
      maxNum = Math.max(maxNum, parseInt(q.code.replace("COT-", ""), 10) || 0);
      stmts.push(
        this.q(
          `INSERT INTO quotes (id, workshop_id, public_id, code, client_id, client_name, client_phone,
             client_address, service_summary, voice_transcript, items_json, total, deposit_pct, deposit_amount,
             status, created_at, sent_at, reminded_at, approved_at, payment_method, validity_days)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          uid(),
          wsId,
          publicId(),
          q.code,
          clientIdMap[q.clientId] || null,
          q.clientName,
          q.clientPhone,
          q.clientAddress,
          q.serviceSummary,
          q.voiceTranscript,
          JSON.stringify(q.items),
          q.total,
          q.depositPct,
          q.depositAmount,
          q.status,
          q.createdAt,
          q.sentAt,
          q.remindedAt,
          q.approvedAt,
          q.paymentMethod,
          q.validityDays
        )
      );
    }
    stmts.push(this.q("UPDATE workshops SET next_quote_number = ? WHERE id = ?", maxNum + 1, wsId));
    return stmts;
  }

  _addonStatements(wsId, addons) {
    return addons.map((a, i) =>
      this.q(
        "INSERT INTO quick_addons (id, workshop_id, label, title, price, position) VALUES (?, ?, ?, ?, ?, ?)",
        uid(),
        wsId,
        a.label,
        a.title,
        a.price,
        i
      )
    );
  }
}
