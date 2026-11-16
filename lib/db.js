// Capa de datos de Coti sobre SQLite (node:sqlite, incluido en Node 22+).
// Todo dato de negocio pertenece a un taller (workshop_id): ninguna consulta
// de lectura/escritura del panel se hace sin filtrar por el taller de la sesión.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { getSeedData } = require("../data/seed");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workshops (
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

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_ws ON clients(workshop_id, phone_digits);

CREATE TABLE IF NOT EXISTS catalog (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_ws ON catalog(workshop_id);

CREATE TABLE IF NOT EXISTS quick_addons (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  title TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quotes (
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
  status TEXT NOT NULL CHECK (status IN ('draft','waiting_reply','approved')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  reminded_at INTEGER,
  approved_at INTEGER,
  payment_method TEXT,
  transfer_reported_at INTEGER,
  validity_days INTEGER NOT NULL DEFAULT 7,
  UNIQUE (workshop_id, code)
);
CREATE INDEX IF NOT EXISTS idx_quotes_ws ON quotes(workshop_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  status TEXT NOT NULL,
  amount REAL,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_payment_id)
);
`;

const DEFAULT_ADDONS = [
  { label: "+ Materiales / Repuestos", title: "Materiales y repuestos adicionales", price: 50 },
  { label: "+ Mano de obra extra", title: "Mano de obra adicional", price: 50 },
  { label: "+ Flete y traslado", title: "Traslado y logística a domicilio", price: 30 }
];

const uid = () => crypto.randomUUID();
const publicId = () => crypto.randomBytes(9).toString("base64url"); // 12 chars, no adivinable
const digits = (s) => String(s || "").replace(/\D/g, "");

function openDb(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  return new CotiStore(db);
}

// ---------------------------------------------------------------------------
// Mapeos fila SQL -> objeto que consume el frontend (camelCase, igual que antes)
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

function mapClient(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    address: r.address,
    notes: r.notes,
    createdAt: r.created_at
  };
}

function mapCatalog(r) {
  return { id: r.id, title: r.title, category: r.category, price: r.price, description: r.description };
}

function mapAddon(r) {
  return { id: r.id, label: r.label, title: r.title, price: r.price };
}

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

class CotiStore {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ------------------------------------------------------------------ Cuentas
  countUsers() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  }

  findUserByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim());
  }

  createAccount({ email, passwordHash, workshopName, ownerName, phone, withDemoData, trialDays = 14 }) {
    return this.tx(() => {
      const now = Date.now();
      const wsId = uid();
      this.db
        .prepare(
          `INSERT INTO workshops (id, name, owner, phone, created_at, trial_ends_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(wsId, workshopName, ownerName, phone || "", now, now + trialDays * 86400000);
      const userId = uid();
      this.db
        .prepare("INSERT INTO users (id, workshop_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(userId, wsId, String(email).trim(), passwordHash, now);
      if (withDemoData) {
        this._loadDemoData(wsId, { keepIdentity: true });
      } else {
        this._insertAddons(wsId, DEFAULT_ADDONS);
      }
      return { userId, workshopId: wsId };
    });
  }

  // ------------------------------------------------------------------ Sesiones
  createSession(tokenHash, userId, ttlMs) {
    const now = Date.now();
    this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, userId, now, now + ttlMs);
  }

  getSession(tokenHash) {
    return this.db
      .prepare(
        `SELECT s.user_id, s.expires_at, u.workshop_id, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash);
  }

  deleteSession(tokenHash) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  purgeExpiredSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  }

  // ------------------------------------------------------------------ Taller
  getWorkshop(wsId) {
    return mapWorkshop(this.db.prepare("SELECT * FROM workshops WHERE id = ?").get(wsId));
  }

  updateWorkshop(wsId, f) {
    this.db
      .prepare(
        `UPDATE workshops SET name = ?, owner = ?, phone = ?, alias = ?, cbu = ?,
           default_deposit_pct = ?, validity_days = ? WHERE id = ?`
      )
      .run(f.name, f.owner, f.phone, f.alias, f.cbu, f.defaultDepositPct, f.validityDays, wsId);
    return this.getWorkshop(wsId);
  }

  // ------------------------------------------------------------------ Estado completo del panel
  getState(wsId) {
    return {
      workshop: this.getWorkshop(wsId),
      catalog: this.db
        .prepare("SELECT * FROM catalog WHERE workshop_id = ? ORDER BY created_at DESC")
        .all(wsId)
        .map(mapCatalog),
      quickAddons: this.db
        .prepare("SELECT * FROM quick_addons WHERE workshop_id = ? ORDER BY position")
        .all(wsId)
        .map(mapAddon),
      clients: this.db
        .prepare("SELECT * FROM clients WHERE workshop_id = ? ORDER BY created_at DESC")
        .all(wsId)
        .map(mapClient),
      quotes: this.db
        .prepare("SELECT * FROM quotes WHERE workshop_id = ? ORDER BY created_at DESC")
        .all(wsId)
        .map(mapQuote)
    };
  }

  // ------------------------------------------------------------------ Clientes
  getClient(wsId, id) {
    const r = this.db.prepare("SELECT * FROM clients WHERE id = ? AND workshop_id = ?").get(id, wsId);
    return r ? mapClient(r) : null;
  }

  updateClient(wsId, id, f) {
    const res = this.db
      .prepare(
        `UPDATE clients SET name = ?, phone = ?, phone_digits = ?, address = ?, notes = ?
         WHERE id = ? AND workshop_id = ?`
      )
      .run(f.name, f.phone, digits(f.phone), f.address, f.notes, id, wsId);
    return res.changes > 0 ? this.getClient(wsId, id) : null;
  }

  deleteClient(wsId, id) {
    return this.db.prepare("DELETE FROM clients WHERE id = ? AND workshop_id = ?").run(id, wsId).changes > 0;
  }

  // ------------------------------------------------------------------ Catálogo
  addCatalogItem(wsId, f) {
    const id = uid();
    this.db
      .prepare(
        "INSERT INTO catalog (id, workshop_id, title, category, price, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, wsId, f.title, f.category, f.price, f.description, Date.now());
    return mapCatalog(this.db.prepare("SELECT * FROM catalog WHERE id = ?").get(id));
  }

  updateCatalogItem(wsId, id, f) {
    const res = this.db
      .prepare(
        "UPDATE catalog SET title = ?, category = ?, price = ?, description = ? WHERE id = ? AND workshop_id = ?"
      )
      .run(f.title, f.category, f.price, f.description, id, wsId);
    if (!res.changes) return null;
    return mapCatalog(this.db.prepare("SELECT * FROM catalog WHERE id = ?").get(id));
  }

  deleteCatalogItem(wsId, id) {
    return this.db.prepare("DELETE FROM catalog WHERE id = ? AND workshop_id = ?").run(id, wsId).changes > 0;
  }

  // ------------------------------------------------------------------ Presupuestos
  getQuote(wsId, idOrCode) {
    return mapQuote(
      this.db
        .prepare("SELECT * FROM quotes WHERE workshop_id = ? AND (id = ? OR code = ?)")
        .get(wsId, idOrCode, idOrCode)
    );
  }

  getQuoteByPublicId(pid) {
    const r = this.db.prepare("SELECT * FROM quotes WHERE public_id = ?").get(pid);
    if (!r) return null;
    return { quote: mapQuote(r), workshop: this.getWorkshop(r.workshop_id) };
  }

  getQuoteById(id) {
    return mapQuote(this.db.prepare("SELECT * FROM quotes WHERE id = ?").get(id));
  }

  createQuote(wsId, q) {
    return this.tx(() => {
      const now = Date.now();
      const ws = this.db.prepare("SELECT * FROM workshops WHERE id = ?").get(wsId);
      const phoneDigits = digits(q.clientPhone);

      // Agenda: buscar por teléfono (no por nombre: dos "Juan" no son el mismo cliente)
      let client = this.db
        .prepare("SELECT * FROM clients WHERE workshop_id = ? AND phone_digits = ?")
        .get(wsId, phoneDigits);
      if (client) {
        this.db
          .prepare("UPDATE clients SET name = ?, phone = ?, address = CASE WHEN ? <> '' THEN ? ELSE address END WHERE id = ?")
          .run(q.clientName, q.clientPhone, q.clientAddress, q.clientAddress, client.id);
      } else {
        const cid = uid();
        this.db
          .prepare(
            `INSERT INTO clients (id, workshop_id, name, phone, phone_digits, address, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(cid, wsId, q.clientName, q.clientPhone, phoneDigits, q.clientAddress, "", now);
        client = { id: cid, address: q.clientAddress };
      }

      const number = ws.next_quote_number;
      this.db.prepare("UPDATE workshops SET next_quote_number = ? WHERE id = ?").run(number + 1, wsId);

      const id = uid();
      this.db
        .prepare(
          `INSERT INTO quotes (id, workshop_id, public_id, code, client_id, client_name, client_phone,
             client_address, service_summary, voice_transcript, items_json, total, deposit_pct,
             deposit_amount, status, created_at, sent_at, validity_days)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          wsId,
          publicId(),
          `COT-${number}`,
          client.id,
          q.clientName,
          q.clientPhone,
          q.clientAddress || client.address || "",
          q.serviceSummary,
          q.voiceTranscript,
          JSON.stringify(q.items),
          q.total,
          q.depositPct,
          q.depositAmount,
          q.sendImmediately ? "waiting_reply" : "draft",
          now,
          q.sendImmediately ? now : null,
          ws.validity_days
        );
      return this.getQuoteById(id);
    });
  }

  markSent(wsId, id) {
    this.db
      .prepare(
        `UPDATE quotes SET status = 'waiting_reply', sent_at = COALESCE(sent_at, ?)
         WHERE workshop_id = ? AND (id = ? OR code = ?) AND status = 'draft'`
      )
      .run(Date.now(), wsId, id, id);
    return this.getQuote(wsId, id);
  }

  markReminded(wsId, id) {
    this.db
      .prepare("UPDATE quotes SET reminded_at = ? WHERE workshop_id = ? AND (id = ? OR code = ?)")
      .run(Date.now(), wsId, id, id);
    return this.getQuote(wsId, id);
  }

  // Solo para modo demo: retrocede el envío 50hs para ver la alerta ámbar.
  ageQuote48h(wsId, id) {
    this.db
      .prepare(
        `UPDATE quotes SET status = 'waiting_reply', sent_at = ?
         WHERE workshop_id = ? AND (id = ? OR code = ?) AND status <> 'approved'`
      )
      .run(Date.now() - 50 * 3600 * 1000, wsId, id, id);
    return this.getQuote(wsId, id);
  }

  reportTransfer(quoteId) {
    this.db
      .prepare(
        "UPDATE quotes SET transfer_reported_at = ? WHERE id = ? AND status <> 'approved' AND transfer_reported_at IS NULL"
      )
      .run(Date.now(), quoteId);
    return this.getQuoteById(quoteId);
  }

  // Aprueba el presupuesto registrando el pago. Idempotente por (provider, providerPaymentId).
  approveQuote(quoteId, { method, provider, providerPaymentId = null, amount = null }) {
    return this.tx(() => {
      if (providerPaymentId) {
        const dup = this.db
          .prepare("SELECT id FROM payments WHERE provider = ? AND provider_payment_id = ?")
          .get(provider, String(providerPaymentId));
        if (dup) return { quote: this.getQuoteById(quoteId), duplicate: true };
      }
      this.db
        .prepare(
          `INSERT INTO payments (id, quote_id, provider, provider_payment_id, status, amount, created_at)
           VALUES (?, ?, ?, ?, 'approved', ?, ?)`
        )
        .run(uid(), quoteId, provider, providerPaymentId ? String(providerPaymentId) : null, amount, Date.now());
      this.db
        .prepare(
          `UPDATE quotes SET status = 'approved', approved_at = COALESCE(approved_at, ?),
             payment_method = ?, sent_at = COALESCE(sent_at, ?)
           WHERE id = ? AND status <> 'approved'`
        )
        .run(Date.now(), method, Date.now(), quoteId);
      return { quote: this.getQuoteById(quoteId), duplicate: false };
    });
  }

  // ------------------------------------------------------------------ Demo
  resetToDemo(wsId) {
    this.tx(() => {
      this.db.prepare("DELETE FROM quotes WHERE workshop_id = ?").run(wsId);
      this.db.prepare("DELETE FROM clients WHERE workshop_id = ?").run(wsId);
      this.db.prepare("DELETE FROM catalog WHERE workshop_id = ?").run(wsId);
      this.db.prepare("DELETE FROM quick_addons WHERE workshop_id = ?").run(wsId);
      this._loadDemoData(wsId, { keepIdentity: true });
    });
  }

  // Carga los datos de ejemplo de data/seed.js en un taller, con IDs nuevos.
  _loadDemoData(wsId, { keepIdentity }) {
    const seed = getSeedData();
    if (!keepIdentity) {
      const w = seed.workshop;
      this.db
        .prepare(
          "UPDATE workshops SET name = ?, owner = ?, phone = ?, alias = ?, cbu = ?, default_deposit_pct = ?, validity_days = ? WHERE id = ?"
        )
        .run(w.name, w.owner, w.phone, w.alias, w.cbu, w.defaultDepositPct, w.validityDays, wsId);
    }
    const insCat = this.db.prepare(
      "INSERT INTO catalog (id, workshop_id, title, category, price, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    seed.catalog.forEach((c, i) => insCat.run(uid(), wsId, c.title, c.category, c.price, c.description, Date.now() - i));
    this._insertAddons(wsId, seed.quickAddons);

    const clientIdMap = {};
    const insCli = this.db.prepare(
      `INSERT INTO clients (id, workshop_id, name, phone, phone_digits, address, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of seed.clients) {
      clientIdMap[c.id] = uid();
      insCli.run(clientIdMap[c.id], wsId, c.name, c.phone, digits(c.phone), c.address, c.notes, c.createdAt);
    }

    const insQ = this.db.prepare(
      `INSERT INTO quotes (id, workshop_id, public_id, code, client_id, client_name, client_phone,
         client_address, service_summary, voice_transcript, items_json, total, deposit_pct, deposit_amount,
         status, created_at, sent_at, reminded_at, approved_at, payment_method, validity_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let maxNum = 1000;
    for (const q of seed.quotes) {
      maxNum = Math.max(maxNum, parseInt(q.code.replace("COT-", ""), 10) || 0);
      insQ.run(
        uid(), wsId, publicId(), q.code, clientIdMap[q.clientId] || null, q.clientName, q.clientPhone,
        q.clientAddress, q.serviceSummary, q.voiceTranscript, JSON.stringify(q.items), q.total,
        q.depositPct, q.depositAmount, q.status, q.createdAt, q.sentAt, q.remindedAt, q.approvedAt,
        q.paymentMethod, q.validityDays
      );
    }
    this.db.prepare("UPDATE workshops SET next_quote_number = ? WHERE id = ?").run(maxNum + 1, wsId);
  }

  _insertAddons(wsId, addons) {
    const ins = this.db.prepare(
      "INSERT INTO quick_addons (id, workshop_id, label, title, price, position) VALUES (?, ?, ?, ?, ?, ?)"
    );
    addons.forEach((a, i) => ins.run(uid(), wsId, a.label, a.title, a.price, i));
  }

  // Cuenta demo con la identidad de ejemplo (ClimaSur) — solo en modo demo.
  createDemoAccount({ email, passwordHash }) {
    const seed = getSeedData();
    const { workshopId } = this.createAccount({
      email,
      passwordHash,
      workshopName: seed.workshop.name,
      ownerName: seed.workshop.owner,
      phone: seed.workshop.phone,
      withDemoData: false
    });
    this.tx(() => {
      this.db.prepare("DELETE FROM quick_addons WHERE workshop_id = ?").run(workshopId);
      this._loadDemoData(workshopId, { keepIdentity: false });
    });
    return workshopId;
  }
}

module.exports = { openDb, digits };
