// Coti CRM — servidor HTTP (Node 22+, sin dependencias externas).
// Datos en SQLite (data/coti.sqlite), cuentas por taller y sesiones con cookie HttpOnly.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { openDb } = require("./lib/db");
const auth = require("./lib/auth");
const payments = require("./lib/payments");

const PUBLIC_DIR = path.join(__dirname, "public");
const HOUR_48 = 48 * 3600 * 1000;
const DAY = 86400000;

const DEMO_EMAIL = "demo@coti.app";
const DEMO_PASSWORD = "coti-demo-1234";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};

// ---------------------------------------------------------------------------
// Utilidades HTTP
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY"
};

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req, { maxBytes = 1e6 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, "El contenido enviado es demasiado grande."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      const type = String(req.headers["content-type"] || "");
      if (!type.includes("application/json")) {
        return reject(new HttpError(415, "Se esperaba JSON."));
      }
      try {
        const data = JSON.parse(raw);
        resolve(data && typeof data === "object" ? data : {});
      } catch {
        reject(new HttpError(400, "JSON inválido."));
      }
    });
    req.on("error", reject);
  });
}

function serveStaticFile(res, filePath, { cache = false } = {}) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Recurso no encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": cache ? "public, max-age=3600" : "no-cache"
    });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

function requiredStr(v, field, max = 200) {
  const s = str(v, max);
  if (!s) throw new HttpError(400, `Falta completar: ${field}.`);
  return s;
}

function money(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, `Monto inválido en ${field}.`);
  return Math.round(n * 100) / 100;
}

function intInRange(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function validEmail(v) {
  const e = str(v, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "Ingresá un email válido.");
  return e;
}

function validPhone(v, field = "Teléfono / WhatsApp") {
  const p = requiredStr(v, field, 40);
  const d = p.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) throw new HttpError(400, `${field}: ingresá un número válido con código de área.`);
  return p;
}

function parseItems(raw, fallbackTitle, fallbackTotal) {
  let items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    items = [{ title: fallbackTitle || "Servicio cotizado", qty: 1, unitPrice: fallbackTotal || 0 }];
  }
  if (items.length > 50) throw new HttpError(400, "Máximo 50 ítems por presupuesto.");
  return items.map((it, i) => {
    const qty = intInRange(it && it.qty, 1, 100000, 1);
    const unitPrice = money(it && it.unitPrice, `ítem ${i + 1}`);
    return {
      title: requiredStr(it && it.title, `concepto del ítem ${i + 1}`, 200),
      qty,
      unitPrice,
      total: Math.round(qty * unitPrice * 100) / 100
    };
  });
}

// ---------------------------------------------------------------------------
// Métricas (Módulo C)
// ---------------------------------------------------------------------------
function yearMonthIn(ts, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(ts);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit" }).format(ts);
  }
}

function computeMetrics(state, now = Date.now()) {
  const tz = (state.workshop && state.workshop.timezone) || "America/Argentina/Buenos_Aires";
  const thisMonth = yearMonthIn(now, tz);
  const waiting = state.quotes.filter((q) => q.status === "waiting_reply");
  const approved = state.quotes.filter((q) => q.status === "approved");
  const drafts = state.quotes.filter((q) => q.status === "draft");
  const approvedThisMonth = approved.filter((q) => q.approvedAt && yearMonthIn(q.approvedAt, tz) === thisMonth);

  const sum = (list, key) => list.reduce((acc, q) => acc + Number(q[key] || 0), 0);
  const sentOrClosed = waiting.length + approved.length;

  return {
    dineroEnLaCalle: sum(waiting, "total"),
    cerradosEsteMes: sum(approvedThisMonth, "total"),
    senasCobradas: sum(approvedThisMonth, "depositAmount"),
    tasaConversion: sentOrClosed > 0 ? Math.round((approved.length / sentOrClosed) * 100) : 0,
    counts: {
      draft: drafts.length,
      waiting_reply: waiting.length,
      approved: approved.length,
      approvedThisMonth: approvedThisMonth.length,
      sentOrClosed,
      overdue48h: waiting.filter((q) => q.sentAt && now - q.sentAt >= HOUR_48).length,
      transferReported: waiting.filter((q) => q.transferReportedAt).length
    }
  };
}

function isExpired(quote, now = Date.now()) {
  return quote.status !== "approved" && (quote.createdAt || 0) + (quote.validityDays || 7) * DAY < now;
}

// Lo único que ve el cliente final: sin notas internas, sin IDs de agenda.
function publicView(quote, workshop, payCfg) {
  return {
    quote: {
      publicId: quote.publicId,
      code: quote.code,
      clientName: quote.clientName,
      clientPhone: quote.clientPhone,
      clientAddress: quote.clientAddress,
      serviceSummary: quote.serviceSummary,
      items: quote.items,
      total: quote.total,
      depositPct: quote.depositPct,
      depositAmount: quote.depositAmount,
      status: quote.status,
      createdAt: quote.createdAt,
      approvedAt: quote.approvedAt,
      paymentMethod: quote.paymentMethod,
      transferReportedAt: quote.transferReportedAt,
      validityDays: quote.validityDays,
      expired: isExpired(quote)
    },
    workshop: {
      name: workshop.name,
      owner: workshop.owner,
      phone: workshop.phone,
      alias: workshop.alias,
      cbu: workshop.cbu,
      currency: workshop.currency
    },
    paymentOptions: {
      mercadoPago: payCfg.mode, // live | demo | off
      transfer: Boolean(workshop.alias || workshop.cbu)
    }
  };
}

// ---------------------------------------------------------------------------
// Aplicación
// ---------------------------------------------------------------------------
function createApp(options = {}) {
  const env = options.env || process.env;
  const isProd = env.NODE_ENV === "production";
  const demoTools = env.COTI_DEMO_TOOLS ? env.COTI_DEMO_TOOLS === "1" : !isProd;
  const secureCookies = env.COOKIE_SECURE ? env.COOKIE_SECURE === "1" : isProd;
  const trustProxy = env.TRUST_PROXY === "1";
  const store = openDb(options.dbPath || env.COTI_DB_PATH || path.join(__dirname, "data", "coti.sqlite"));
  const payCfg = payments.getConfig(env, { demoTools });
  const mpClient = options.mpClient || payments; // inyectable en tests

  const limits = { login: 10, register: 5, ...(options.limits || {}) };
  const loginLimiter = new auth.RateLimiter({ max: limits.login, windowMs: 15 * 60 * 1000 });
  const registerLimiter = new auth.RateLimiter({ max: limits.register, windowMs: 60 * 60 * 1000 });

  const clientIp = (req) =>
    (trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) ||
    req.socket.remoteAddress ||
    "?";

  const baseUrl = (req) => {
    if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/$/, "");
    const proto = trustProxy && req.headers["x-forwarded-proto"] ? req.headers["x-forwarded-proto"] : "http";
    return `${proto}://${req.headers.host}`;
  };

  const ready = (async () => {
    if (demoTools && store.countUsers() === 0) {
      store.createDemoAccount({ email: DEMO_EMAIL, passwordHash: await auth.hashPassword(DEMO_PASSWORD) });
      if (!options.quiet) console.log(`   Cuenta demo creada → ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    }
    store.purgeExpiredSessions();
  })();

  function stateFor(wsId) {
    const state = store.getState(wsId);
    return { ...state, metrics: computeMetrics(state), serverTime: Date.now() };
  }

  function requireSession(req) {
    const { token, viaCookie } = auth.extractToken(req);
    if (!token) throw new HttpError(401, "Iniciá sesión para continuar.");
    const session = store.getSession(auth.hashToken(token));
    if (!session || session.expires_at < Date.now()) throw new HttpError(401, "Tu sesión venció. Volvé a ingresar.");

    // Protección CSRF para sesiones por cookie: los cambios solo desde nuestro propio origen.
    if (viaCookie && !["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let host;
        try {
          host = new URL(origin).host;
        } catch {
          host = null;
        }
        if (host !== req.headers.host) throw new HttpError(403, "Origen no permitido.");
      } else if (req.headers["sec-fetch-site"] === "cross-site") {
        throw new HttpError(403, "Origen no permitido.");
      }
    }
    return { workshopId: session.workshop_id, userId: session.user_id, email: session.email };
  }

  async function startSession(res, req, userId, body) {
    const token = auth.newSessionToken();
    store.createSession(auth.hashToken(token), userId, auth.SESSION_TTL_MS);
    // La app móvil (sin cookies) pide el token explícitamente; la web nunca lo ve.
    const wantsToken = body && body.client === "mobile";
    return {
      cookie: auth.sessionCookie(token, { secure: secureCookies }),
      token: wantsToken ? token : undefined
    };
  }

  async function approveFromMpPayment(paymentId) {
    const payment = await mpClient.getPayment(payCfg, paymentId);
    const ref = payment && payment.external_reference ? store.getQuoteById(payment.external_reference) : null;
    if (!ref) return { ok: false, reason: "Presupuesto no encontrado" };
    const { quote, workshop } = store.getQuoteByPublicId(ref.publicId);
    const problem = payments.validatePaymentForQuote(payment, quote, workshop, payCfg);
    if (problem) return { ok: false, reason: problem, quote };
    const result = store.approveQuote(quote.id, {
      method: "Mercado Pago",
      provider: "mercadopago",
      providerPaymentId: payment.id,
      amount: Number(payment.transaction_amount)
    });
    return { ok: true, quote: result.quote };
  }

  // -------------------------------------------------------------------------
  async function handle(req, res) {
    await ready;
    const urlObj = new URL(req.url, "http://localhost");
    const pathname = urlObj.pathname;
    const method = req.method;
    let m;

    // ================================ Público ================================
    if (pathname === "/api/config" && method === "GET") {
      return sendJson(res, 200, {
        demoTools,
        demoLogin: demoTools ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : null,
        payments: { mercadoPago: payCfg.mode }
      });
    }

    if (pathname === "/api/auth/register" && method === "POST") {
      if (!registerLimiter.hit(clientIp(req))) throw new HttpError(429, "Demasiados registros. Probá más tarde.");
      const body = await parseBody(req);
      const email = validEmail(body.email);
      const password = String(body.password || "");
      if (password.length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
      if (password.length > 200) throw new HttpError(400, "Contraseña demasiado larga.");
      const workshopName = requiredStr(body.workshopName, "nombre del taller o empresa", 120);
      const ownerName = requiredStr(body.ownerName, "tu nombre", 120);
      const phone = validPhone(body.phone, "WhatsApp del taller");
      if (store.findUserByEmail(email)) throw new HttpError(409, "Ya existe una cuenta con ese email.");

      const passwordHash = await auth.hashPassword(password);
      let account;
      try {
        account = store.createAccount({
          email,
          passwordHash,
          workshopName,
          ownerName,
          phone,
          withDemoData: Boolean(body.withDemoData)
        });
      } catch (err) {
        if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Ya existe una cuenta con ese email.");
        throw err;
      }
      const s = await startSession(res, req, account.userId, body);
      return sendJson(res, 201, { ok: true, token: s.token }, { "Set-Cookie": s.cookie });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await parseBody(req);
      const email = str(body.email, 254).toLowerCase();
      const key = `${clientIp(req)}|${email}`;
      if (!loginLimiter.hit(key)) throw new HttpError(429, "Demasiados intentos. Esperá unos minutos.");
      const user = email ? store.findUserByEmail(email) : null;
      const ok = user
        ? await auth.verifyPassword(String(body.password || ""), user.password_hash)
        : (await auth.verifyPassword(String(body.password || ""), await auth.dummyHash()), false);
      if (!ok) throw new HttpError(401, "Email o contraseña incorrectos.");
      loginLimiter.reset(key);
      const s = await startSession(res, req, user.id, body);
      return sendJson(res, 200, { ok: true, token: s.token }, { "Set-Cookie": s.cookie });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      const { token } = auth.extractToken(req);
      if (token) store.deleteSession(auth.hashToken(token));
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": auth.clearSessionCookie({ secure: secureCookies }) });
    }

    // Presupuesto público (link que recibe el cliente por WhatsApp)
    if ((m = pathname.match(/^\/api\/public\/quote\/([A-Za-z0-9_-]{6,40})$/)) && method === "GET") {
      const found = store.getQuoteByPublicId(m[1]);
      if (!found) throw new HttpError(404, "Presupuesto no encontrado");
      return sendJson(res, 200, publicView(found.quote, found.workshop, payCfg));
    }

    if ((m = pathname.match(/^\/api\/public\/quote\/([A-Za-z0-9_-]{6,40})\/(checkout|report-transfer|verify-payment)$/)) && method === "POST") {
      const found = store.getQuoteByPublicId(m[1]);
      if (!found) throw new HttpError(404, "Presupuesto no encontrado");
      const { quote, workshop } = found;
      const action = m[2];
      const body = await parseBody(req);

      if (quote.status === "approved") {
        return sendJson(res, 200, publicView(quote, workshop, payCfg));
      }

      if (action === "verify-payment") {
        if (payCfg.mode !== "live") throw new HttpError(400, "Mercado Pago no está configurado.");
        const paymentId = str(body.paymentId, 40);
        if (!/^\d+$/.test(paymentId)) throw new HttpError(400, "Pago inválido.");
        const result = await approveFromMpPayment(paymentId);
        if (!result.ok || !result.quote || result.quote.id !== quote.id) {
          return sendJson(res, 200, { ...publicView(quote, workshop, payCfg), pending: true });
        }
        return sendJson(res, 200, publicView(result.quote, workshop, payCfg));
      }

      if (isExpired(quote)) throw new HttpError(410, "Este presupuesto venció. Pedile al taller que lo actualice.");

      if (action === "report-transfer") {
        if (!(workshop.alias || workshop.cbu)) throw new HttpError(400, "El taller no cargó datos de transferencia.");
        const updated = store.reportTransfer(quote.id);
        return sendJson(res, 200, publicView(updated, workshop, payCfg));
      }

      // checkout con Mercado Pago
      if (payCfg.mode === "off") throw new HttpError(400, "El pago con Mercado Pago no está disponible.");
      if (payCfg.mode === "demo") {
        const { quote: approved } = store.approveQuote(quote.id, {
          method: "Mercado Pago (demo, sin cobro real)",
          provider: "demo"
        });
        return sendJson(res, 200, publicView(approved, workshop, payCfg));
      }
      try {
        const pref = await mpClient.createPreference(payCfg, { quote, workshop, baseUrl: baseUrl(req) });
        return sendJson(res, 200, { redirectUrl: pref.initPoint });
      } catch (err) {
        console.error("Error creando preferencia MP:", err.message);
        throw new HttpError(502, err.code === "FX_RATE_MISSING" ? err.message : "No pudimos conectar con Mercado Pago. Probá de nuevo.");
      }
    }

    // Webhook de Mercado Pago: nunca se confía en el cuerpo, se re-consulta el pago a la API.
    if (pathname === "/api/webhooks/mercadopago" && method === "POST") {
      if (payCfg.mode !== "live") return sendJson(res, 404, { error: "No configurado" });
      const body = await parseBody(req).catch(() => ({}));
      const dataId = urlObj.searchParams.get("data.id") || (body.data && body.data.id);
      const type = urlObj.searchParams.get("type") || body.type;
      const validSig = payments.verifyWebhookSignature({
        secret: payCfg.webhookSecret,
        signatureHeader: req.headers["x-signature"],
        requestId: req.headers["x-request-id"],
        dataId
      });
      if (!validSig) return sendJson(res, 401, { error: "Firma inválida" });
      if (type === "payment" && dataId && /^\d+$/.test(String(dataId))) {
        try {
          const r = await approveFromMpPayment(String(dataId));
          if (!r.ok) console.warn(`Webhook MP pago ${dataId} ignorado: ${r.reason}`);
        } catch (err) {
          console.error("Webhook MP error:", err.message);
          return sendJson(res, 500, { error: "Reintentar" }); // MP reintenta
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // ====================== Panel del taller (con sesión) ======================
    if (pathname.startsWith("/api/")) {
      const session = requireSession(req);
      const ws = session.workshopId;

      if (pathname === "/api/auth/me" && method === "GET") {
        return sendJson(res, 200, { email: session.email, workshop: store.getWorkshop(ws) });
      }

      if (pathname === "/api/state" && method === "GET") {
        return sendJson(res, 200, stateFor(ws));
      }

      if (pathname === "/api/workshop" && method === "PUT") {
        const body = await parseBody(req);
        const current = store.getWorkshop(ws);
        store.updateWorkshop(ws, {
          name: requiredStr(body.name ?? current.name, "nombre del taller", 120),
          owner: requiredStr(body.owner ?? current.owner, "responsable", 120),
          phone: validPhone(body.phone ?? current.phone, "WhatsApp del taller"),
          alias: str(body.alias ?? current.alias, 60),
          cbu: str(body.cbu ?? current.cbu, 40).replace(/\s/g, ""),
          defaultDepositPct: intInRange(body.defaultDepositPct ?? current.defaultDepositPct, 0, 100, 40),
          validityDays: intInRange(body.validityDays ?? current.validityDays, 1, 90, 7)
        });
        return sendJson(res, 200, { state: stateFor(ws) });
      }

      if (pathname === "/api/quotes" && method === "POST") {
        const body = await parseBody(req);
        const items = parseItems(body.items, str(body.serviceSummary, 300), Number(body.total) || 0);
        const total = Math.round(items.reduce((s, it) => s + it.total, 0) * 100) / 100;
        const workshop = store.getWorkshop(ws);
        const depositPct = intInRange(body.depositPct, 0, 100, workshop.defaultDepositPct);
        const quote = store.createQuote(ws, {
          clientName: requiredStr(body.clientName, "nombre del cliente", 120),
          clientPhone: validPhone(body.clientPhone),
          clientAddress: str(body.clientAddress, 200),
          serviceSummary: str(body.serviceSummary, 300) || items.map((i) => i.title).join(" + ").slice(0, 300),
          voiceTranscript: str(body.voiceTranscript, 2000),
          items,
          total,
          depositPct,
          depositAmount: Math.round((total * depositPct) / 100),
          sendImmediately: Boolean(body.sendImmediately)
        });
        return sendJson(res, 201, { quote, state: stateFor(ws) });
      }

      if ((m = pathname.match(/^\/api\/quotes\/([^/]+)\/(send|remind|age48h|confirm-payment)$/)) && method === "POST") {
        const id = decodeURIComponent(m[1]);
        const action = m[2];
        const existing = store.getQuote(ws, id);
        if (!existing) throw new HttpError(404, "Presupuesto no encontrado");
        let quote;
        if (action === "send") quote = store.markSent(ws, id);
        else if (action === "remind") quote = store.markReminded(ws, id);
        else if (action === "age48h") {
          if (!demoTools) throw new HttpError(404, "No disponible");
          quote = store.ageQuote48h(ws, id);
        } else {
          const body = await parseBody(req);
          const allowed = ["Transferencia Bancaria", "Efectivo", "Mercado Pago", "Otro"];
          const methodName = allowed.includes(body.method) ? body.method : "Otro";
          quote = store.approveQuote(existing.id, { method: methodName, provider: "manual" }).quote;
        }
        return sendJson(res, 200, { quote, state: stateFor(ws) });
      }

      if ((m = pathname.match(/^\/api\/clients\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        if (method === "PUT") {
          const body = await parseBody(req);
          const client = store.updateClient(ws, id, {
            name: requiredStr(body.name, "nombre", 120),
            phone: validPhone(body.phone),
            address: str(body.address, 200),
            notes: str(body.notes, 1000)
          });
          if (!client) throw new HttpError(404, "Cliente no encontrado");
          return sendJson(res, 200, { client, state: stateFor(ws) });
        }
        if (method === "DELETE") {
          if (!store.deleteClient(ws, id)) throw new HttpError(404, "Cliente no encontrado");
          return sendJson(res, 200, { state: stateFor(ws) });
        }
      }

      if (pathname === "/api/catalog" && method === "POST") {
        const body = await parseBody(req);
        const item = store.addCatalogItem(ws, {
          title: requiredStr(body.title, "nombre del combo", 150),
          category: str(body.category, 60) || "Servicio",
          price: money(body.price, "precio"),
          description: str(body.description, 500)
        });
        return sendJson(res, 201, { item, state: stateFor(ws) });
      }

      if ((m = pathname.match(/^\/api\/catalog\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        if (method === "PUT") {
          const body = await parseBody(req);
          const item = store.updateCatalogItem(ws, id, {
            title: requiredStr(body.title, "nombre del combo", 150),
            category: str(body.category, 60) || "Servicio",
            price: money(body.price, "precio"),
            description: str(body.description, 500)
          });
          if (!item) throw new HttpError(404, "Combo no encontrado");
          return sendJson(res, 200, { item, state: stateFor(ws) });
        }
        if (method === "DELETE") {
          if (!store.deleteCatalogItem(ws, id)) throw new HttpError(404, "Combo no encontrado");
          return sendJson(res, 200, { state: stateFor(ws) });
        }
      }

      if (pathname === "/api/reset" && method === "POST") {
        if (!demoTools) throw new HttpError(404, "No disponible");
        store.resetToDemo(ws);
        return sendJson(res, 200, stateFor(ws));
      }

      throw new HttpError(404, "Ruta no encontrada");
    }

    // ============================ Archivos estáticos ============================
    if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "Método no permitido");

    if (pathname.startsWith("/p/")) {
      return serveStaticFile(res, path.join(PUBLIC_DIR, "quote.html"));
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, "Ruta inválida");
    }
    const filePath = path.resolve(PUBLIC_DIR, "." + (decoded === "/" ? "/index.html" : decoded));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, "Prohibido");
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStaticFile(res, filePath, { cache: filePath.includes(`${path.sep}assets${path.sep}`) });
    }
    return serveStaticFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error("Error del servidor:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Error interno del servidor" });
    });
  });

  server.on("close", () => store.close());
  return { server, store, ready, config: { demoTools, payments: payCfg.mode } };
}

module.exports = { createApp, computeMetrics };

if (require.main === module) {
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const PORT = Number(process.env.PORT) || 3456;
  const app = createApp();
  app.server.listen(PORT, () => {
    console.log(`\n🐦 Coti CRM corriendo en http://localhost:${PORT}`);
    console.log(`   Herramientas demo: ${app.config.demoTools ? "activadas" : "desactivadas"}`);
    console.log(`   Mercado Pago: ${app.config.payments}`);
  });
}
