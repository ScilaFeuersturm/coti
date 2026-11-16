// API de Coti con Request/Response estándar (Cloudflare Workers; también corre en Node para los tests).

import * as auth from "./auth.js";
import * as payments from "./payments.js";
import { CotiStore } from "./store.js";

const HOUR_48 = 48 * 3600 * 1000;
const DAY = 86400000;

export const DEMO_EMAIL = "demo@coti.app";
export const DEMO_PASSWORD = "coti-demo-1234";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY"
};

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

async function parseBody(request, { maxBytes = 1e6 } = {}) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new HttpError(413, "El contenido enviado es demasiado grande.");
  const raw = await request.text();
  if (raw.length > maxBytes) throw new HttpError(413, "El contenido enviado es demasiado grande.");
  if (!raw) return {};
  if (!String(request.headers.get("content-type") || "").includes("application/json")) {
    throw new HttpError(415, "Se esperaba JSON.");
  }
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
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
  const num = Number(v);
  if (!Number.isFinite(num) || num < 0 || num > 1e9) throw new HttpError(400, `Monto inválido en ${field}.`);
  return Math.round(num * 100) / 100;
}

function intInRange(v, min, max, fallback) {
  const num = Math.round(Number(v));
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
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
  if (items.length === 0) items = [{ title: fallbackTitle || "Servicio cotizado", qty: 1, unitPrice: fallbackTotal || 0 }];
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

export function computeMetrics(state, now = Date.now()) {
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

// Lo único que ve el cliente final: sin notas internas ni IDs de agenda.
function publicView(quote, workshop, mpMode) {
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
      mercadoPago: mpMode, // live | test | demo | off
      transfer: Boolean(workshop.alias || workshop.cbu)
    }
  };
}

// ---------------------------------------------------------------------------
// Manejador
// ---------------------------------------------------------------------------
// options.mpClient: cliente de Mercado Pago (simulado en tests).
// options.limits: { login, register } intentos permitidos (ajustable en tests).
export function createApiHandler(options = {}) {
  const limits = { login: 10, register: 5, ...(options.limits || {}) };
  const mpClient = options.mpClient || payments.mercadoPagoClient;
  let demoChecked = false;
  // ¿El token global es de prueba? Se consulta una vez por instancia (solo se guardan respuestas exitosas).
  const globalTokenChecks = new Map();
  const redirect = (location) =>
    new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, Location: location, "Cache-Control": "no-store" } });

  return async function handleApi(request, env) {
    const store = new CotiStore(env.DB);
    const isProd = env.ENVIRONMENT === "production";
    const demoTools = env.COTI_DEMO_TOOLS ? env.COTI_DEMO_TOOLS === "1" : !isProd;
    const payCfg = payments.getPaymentConfig(env, { demoTools });
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const baseUrl = String(env.PUBLIC_BASE_URL || url.origin).replace(/\/$/, "");
    const clientIp = request.headers.get("cf-connecting-ip") || "local";

    try {
      // Cuenta demo: se crea la primera vez que hace falta (solo fuera de producción).
      if (demoTools && !demoChecked) {
        if ((await store.countUsers()) === 0) {
          await store.createAccount({
            email: DEMO_EMAIL,
            passwordHash: await auth.hashPassword(DEMO_PASSWORD),
            withDemoData: true,
            demoIdentity: true
          });
        }
        demoChecked = true;
      }
      return await route(request, url, { env, store, demoTools, payCfg, secure, baseUrl, clientIp });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error("Error del servidor:", err && err.stack ? err.stack : err);
      return json(500, { error: "Error interno del servidor" });
    }
  };

  async function requireSession(request, store) {
    const { token, viaCookie } = auth.extractToken(request);
    if (!token) throw new HttpError(401, "Iniciá sesión para continuar.");
    const session = await store.getSession(await auth.hashToken(token));
    if (!session || session.expires_at < Date.now()) throw new HttpError(401, "Tu sesión venció. Volvé a ingresar.");

    // Protección CSRF para sesiones por cookie: cambios solo desde nuestro propio origen.
    if (viaCookie && !["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const host = new URL(request.url).host;
      if (origin) {
        let originHost = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          /* origen inválido */
        }
        if (originHost !== host) throw new HttpError(403, "Origen no permitido.");
      } else if (request.headers.get("sec-fetch-site") === "cross-site") {
        throw new HttpError(403, "Origen no permitido.");
      }
    }
    return { workshopId: session.workshop_id, userId: session.user_id, email: session.email };
  }

  async function startSession(store, userId, body, secure) {
    const token = auth.randomToken();
    await store.createSession(await auth.hashToken(token), userId, auth.SESSION_TTL_MS);
    // La app móvil (sin cookies) pide el token explícitamente; la web nunca lo ve.
    return {
      cookie: auth.sessionCookie(token, { secure }),
      token: body && body.client === "mobile" ? token : undefined
    };
  }

  // ¿El token global es de prueba? (resultado cacheado en globalTokenChecks)
  async function globalTokenIsTest(token) {
    if (globalTokenChecks.has(token)) return globalTokenChecks.get(token);
    try {
      const isTest = await mpClient.isTestToken(token);
      globalTokenChecks.set(token, isTest);
      if (!isTest) console.error("MP_ACCESS_TOKEN es de PRODUCCIÓN: se ignora. Las señas reales se cobran con la cuenta conectada de cada negocio.");
      return isTest;
    } catch (err) {
      console.error("No se pudo verificar MP_ACCESS_TOKEN:", err.message);
      return false;
    }
  }

  // Token del negocio (descifrado), renovándolo si vence en menos de 7 días.
  async function workshopMpToken(store, payCfg, wsId) {
    const row = await store.getMpConnectionRow(wsId);
    if (!row || !payCfg.encKey) return null;
    try {
      let accessToken = await auth.decryptSecret(row.access_token_enc, payCfg.encKey);
      let liveMode = Boolean(row.live_mode);
      if (row.expires_at - Date.now() < 7 * DAY && payCfg.oauthEnabled) {
        try {
          const refreshToken = await auth.decryptSecret(row.refresh_token_enc, payCfg.encKey);
          const data = await mpClient.refreshToken(payCfg, { refreshToken });
          await saveConnection(store, payCfg, wsId, data);
          accessToken = data.access_token;
          liveMode = Boolean(data.live_mode);
        } catch (err) {
          console.error(`No se pudo renovar el token MP del negocio ${wsId}:`, err.message);
          if (row.expires_at < Date.now()) return null;
        }
      }
      return { accessToken, liveMode };
    } catch (err) {
      console.error(`No se pudo leer la conexión MP del negocio ${wsId}:`, err.message);
      return null;
    }
  }

  async function saveConnection(store, payCfg, wsId, data) {
    await store.saveMpConnection(wsId, {
      mpUserId: data.user_id,
      accessTokenEnc: await auth.encryptSecret(data.access_token, payCfg.encKey),
      refreshTokenEnc: await auth.encryptSecret(data.refresh_token || "", payCfg.encKey),
      publicKey: data.public_key,
      liveMode: data.live_mode,
      expiresAt: Date.now() + (Number(data.expires_in) || 180 * 24 * 3600) * 1000
    });
  }

  // ¿Con qué cuenta se cobra la seña de este negocio?
  //   live/test → cuenta conectada del negocio (o token global de PRUEBA) · demo → sin cobro · off → no se ofrece
  async function resolveCollector(store, payCfg, wsId) {
    const own = await workshopMpToken(store, payCfg, wsId);
    if (own) return { mode: own.liveMode ? "live" : "test", token: own.accessToken };
    if (payCfg.globalToken && (await globalTokenIsTest(payCfg.globalToken))) {
      return { mode: "test", token: payCfg.globalToken };
    }
    return { mode: payCfg.demoTools ? "demo" : "off", token: null };
  }

  async function approveFromMpPayment(store, payCfg, paymentId, { quote, workshop, token }) {
    const payment = await mpClient.getPayment(payCfg, paymentId, token);
    const problem = payments.validatePaymentForQuote(payment, quote, workshop, payCfg);
    if (problem) return { ok: false, reason: problem };
    const result = await store.approveQuote(quote.id, {
      method: "Mercado Pago",
      provider: "mercadopago",
      providerPaymentId: payment.id,
      amount: Number(payment.transaction_amount)
    });
    return { ok: true, quote: result.quote };
  }


  async function stateFor(store, wsId) {
    const state = await store.getState(wsId);
    return { ...state, metrics: computeMetrics(state), serverTime: Date.now() };
  }

  async function route(request, url, ctx) {
    const { store, demoTools, payCfg, secure, baseUrl, clientIp } = ctx;
    const pathname = url.pathname;
    const method = request.method;
    let m;

    // ================================ Público ================================
    if (pathname === "/api/config" && method === "GET") {
      return json(200, {
        demoTools,
        demoLogin: demoTools ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : null,
        payments: { connectAvailable: payCfg.oauthEnabled }
      });
    }

    // Vuelta desde Mercado Pago después de que el negocio autorizó a Coti (OAuth).
    // El "state" de un solo uso identifica al negocio y evita que alguien conecte su cuenta a otro.
    if (pathname === "/api/mp/callback" && method === "GET") {
      if (!payCfg.oauthEnabled) return redirect("/?mp=no-disponible");
      const state = str(url.searchParams.get("state"), 100);
      const code = str(url.searchParams.get("code"), 300);
      const wsId = state ? await store.consumeOAuthState(state) : null;
      if (!wsId) return redirect("/?mp=error");
      if (!code) return redirect("/?mp=cancelado");
      try {
        const data = await mpClient.exchangeCode(payCfg, { code, redirectUri: `${baseUrl}/api/mp/callback` });
        if (!data || !data.access_token || !data.user_id) throw new Error("Respuesta sin token");
        await saveConnection(store, payCfg, wsId, data);
        return redirect("/?mp=conectado");
      } catch (err) {
        console.error("Error conectando Mercado Pago:", err.message);
        return redirect("/?mp=error");
      }
    }

    if (pathname === "/api/auth/register" && method === "POST") {
      const key = `register|${clientIp}`;
      if (await store.tooManyAttempts(key, limits.register, 3600 * 1000)) {
        throw new HttpError(429, "Demasiados registros. Probá más tarde.");
      }
      const body = await parseBody(request);
      const email = validEmail(body.email);
      const password = String(body.password || "");
      if (password.length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
      if (password.length > 200) throw new HttpError(400, "Contraseña demasiado larga.");
      const workshopName = requiredStr(body.workshopName, "nombre del negocio", 120);
      const ownerName = requiredStr(body.ownerName, "tu nombre", 120);
      const phone = validPhone(body.phone, "WhatsApp del negocio");
      if (await store.findUserByEmail(email)) throw new HttpError(409, "Ya existe una cuenta con ese email.");

      let account;
      try {
        account = await store.createAccount({
          email,
          passwordHash: await auth.hashPassword(password),
          workshopName,
          ownerName,
          phone,
          withDemoData: Boolean(body.withDemoData)
        });
      } catch (err) {
        if (String(err && err.message).includes("UNIQUE")) throw new HttpError(409, "Ya existe una cuenta con ese email.");
        throw err;
      }
      await store.recordAttempt(key);
      const s = await startSession(store, account.userId, body, secure);
      return json(201, { ok: true, token: s.token }, { "Set-Cookie": s.cookie });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await parseBody(request);
      const email = str(body.email, 254).toLowerCase();
      const key = `login|${clientIp}|${email}`;
      if (await store.tooManyAttempts(key, limits.login, 15 * 60 * 1000)) {
        throw new HttpError(429, "Demasiados intentos. Esperá unos minutos.");
      }
      const user = email ? await store.findUserByEmail(email) : null;
      const password = String(body.password || "");
      const ok = user
        ? await auth.verifyPassword(password, user.password_hash)
        : (await auth.verifyPassword(password, await auth.dummyHash()), false);
      if (!ok) {
        await store.recordAttempt(key);
        throw new HttpError(401, "Email o contraseña incorrectos.");
      }
      await store.clearAttempts(key);
      await store.purgeExpired();
      const s = await startSession(store, user.id, body, secure);
      return json(200, { ok: true, token: s.token }, { "Set-Cookie": s.cookie });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      const { token } = auth.extractToken(request);
      if (token) await store.deleteSession(await auth.hashToken(token));
      return json(200, { ok: true }, { "Set-Cookie": auth.clearSessionCookie({ secure }) });
    }

    // Presupuesto público (link que recibe el cliente por WhatsApp)
    if ((m = pathname.match(/^\/api\/public\/quote\/([A-Za-z0-9_-]{6,40})$/)) && method === "GET") {
      const found = await store.getQuoteByPublicId(m[1]);
      if (!found) throw new HttpError(404, "Presupuesto no encontrado");
      const collector = await resolveCollector(store, payCfg, found.workshop.id);
      return json(200, publicView(found.quote, found.workshop, collector.mode));
    }

    if (
      (m = pathname.match(/^\/api\/public\/quote\/([A-Za-z0-9_-]{6,40})\/(checkout|report-transfer|verify-payment)$/)) &&
      method === "POST"
    ) {
      const found = await store.getQuoteByPublicId(m[1]);
      if (!found) throw new HttpError(404, "Presupuesto no encontrado");
      const { quote, workshop } = found;
      const action = m[2];
      const body = await parseBody(request);
      const collector = await resolveCollector(store, payCfg, workshop.id);
      const view = (q) => publicView(q, workshop, collector.mode);

      if (quote.status === "approved") return json(200, view(quote));

      if (action === "verify-payment") {
        if (!collector.token) throw new HttpError(400, "Mercado Pago no está configurado.");
        const paymentId = str(body.paymentId, 40);
        if (!/^\d+$/.test(paymentId)) throw new HttpError(400, "Pago inválido.");
        const result = await approveFromMpPayment(store, payCfg, paymentId, { quote, workshop, token: collector.token });
        if (!result.ok) return json(200, { ...view(quote), pending: true });
        return json(200, view(result.quote));
      }

      if (isExpired(quote)) throw new HttpError(410, "Este presupuesto venció. Pedile al negocio que lo actualice.");

      if (action === "report-transfer") {
        if (!(workshop.alias || workshop.cbu)) throw new HttpError(400, "El negocio no cargó datos de transferencia.");
        return json(200, view(await store.reportTransfer(quote.id)));
      }

      // checkout con Mercado Pago
      if (collector.mode === "off") throw new HttpError(400, "El pago con Mercado Pago no está disponible.");
      if (collector.mode === "demo") {
        const { quote: approved } = await store.approveQuote(quote.id, {
          method: "Mercado Pago (demo, sin cobro real)",
          provider: "demo"
        });
        return json(200, view(approved));
      }
      try {
        const pref = await mpClient.createPreference(payCfg, { quote, workshop, baseUrl, accessToken: collector.token });
        return json(200, { redirectUrl: pref.initPoint });
      } catch (err) {
        console.error("Error creando preferencia MP:", err.message);
        throw new HttpError(
          502,
          err.code === "FX_RATE_MISSING" ? err.message : "No pudimos conectar con Mercado Pago. Probá de nuevo."
        );
      }
    }

    // Notificaciones de Mercado Pago. La ruta lleva el ID público del presupuesto: así se sabe de qué
    // negocio es y con qué cuenta consultar el pago. Nunca se confía en el cuerpo: se re-consulta a la API.
    if ((m = pathname.match(/^\/api\/webhooks\/mercadopago(?:\/([A-Za-z0-9_-]{6,40}))?$/)) && method === "POST") {
      const body = await parseBody(request).catch(() => ({}));
      const dataId = url.searchParams.get("data.id") || (body.data && body.data.id);
      const type = url.searchParams.get("type") || body.type;
      const validSig = await payments.verifyWebhookSignature({
        secret: payCfg.webhookSecret,
        signatureHeader: request.headers.get("x-signature"),
        requestId: request.headers.get("x-request-id"),
        dataId
      });
      if (!validSig) return json(401, { error: "Firma inválida" });
      if (type !== "payment" || !dataId || !/^\d+$/.test(String(dataId)) || !m[1]) return json(200, { ok: true });

      const found = await store.getQuoteByPublicId(m[1]);
      if (!found || found.quote.status === "approved") return json(200, { ok: true });
      const collector = await resolveCollector(store, payCfg, found.workshop.id);
      if (!collector.token) return json(200, { ok: true });
      try {
        const r = await approveFromMpPayment(store, payCfg, String(dataId), { ...found, token: collector.token });
        if (!r.ok) console.warn(`Webhook MP pago ${dataId} ignorado: ${r.reason}`);
      } catch (err) {
        console.error("Webhook MP error:", err.message);
        return json(500, { error: "Reintentar" }); // Mercado Pago reintenta
      }
      return json(200, { ok: true });
    }

    // ====================== Panel del negocio (con sesión) ======================
    const session = await requireSession(request, store);
    const ws = session.workshopId;

    if (pathname === "/api/auth/me" && method === "GET") {
      return json(200, { email: session.email, workshop: await store.getWorkshop(ws) });
    }

    if (pathname === "/api/state" && method === "GET") {
      return json(200, await stateFor(store, ws));
    }

    // "Conectar Mercado Pago": lleva al negocio a autorizar a Coti con SU cuenta.
    if (pathname === "/api/mp/connect" && method === "GET") {
      if (!payCfg.oauthEnabled) return redirect("/?mp=no-disponible");
      const state = auth.randomToken(24);
      await store.createOAuthState(ws, state);
      return redirect(payments.authorizationUrl(payCfg, { state, redirectUri: `${baseUrl}/api/mp/callback` }));
    }

    if (pathname === "/api/mp/disconnect" && method === "POST") {
      await store.deleteMpConnection(ws);
      return json(200, { state: await stateFor(store, ws) });
    }

    if (pathname === "/api/workshop" && method === "PUT") {
      const body = await parseBody(request);
      const current = await store.getWorkshop(ws);
      await store.updateWorkshop(ws, {
        name: requiredStr(body.name ?? current.name, "nombre del negocio", 120),
        owner: requiredStr(body.owner ?? current.owner, "responsable", 120),
        phone: validPhone(body.phone ?? current.phone, "WhatsApp del negocio"),
        alias: str(body.alias ?? current.alias, 60),
        cbu: str(body.cbu ?? current.cbu, 40).replace(/\s/g, ""),
        defaultDepositPct: intInRange(body.defaultDepositPct ?? current.defaultDepositPct, 0, 100, 40),
        validityDays: intInRange(body.validityDays ?? current.validityDays, 1, 90, 7)
      });
      return json(200, { state: await stateFor(store, ws) });
    }

    if (pathname === "/api/quotes" && method === "POST") {
      const body = await parseBody(request);
      const items = parseItems(body.items, str(body.serviceSummary, 300), Number(body.total) || 0);
      const total = Math.round(items.reduce((s, it) => s + it.total, 0) * 100) / 100;
      const workshop = await store.getWorkshop(ws);
      const depositPct = intInRange(body.depositPct, 0, 100, workshop.defaultDepositPct);
      const quote = await store.createQuote(ws, {
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
      return json(201, { quote, state: await stateFor(store, ws) });
    }

    if ((m = pathname.match(/^\/api\/quotes\/([^/]+)\/(send|remind|age48h|confirm-payment)$/)) && method === "POST") {
      const id = decodeURIComponent(m[1]);
      const action = m[2];
      const existing = await store.getQuote(ws, id);
      if (!existing) throw new HttpError(404, "Presupuesto no encontrado");
      let quote;
      if (action === "send") quote = await store.markSent(ws, id);
      else if (action === "remind") quote = await store.markReminded(ws, id);
      else if (action === "age48h") {
        if (!demoTools) throw new HttpError(404, "No disponible");
        quote = await store.ageQuote48h(ws, id);
      } else {
        const body = await parseBody(request);
        const allowed = ["Transferencia Bancaria", "Efectivo", "Mercado Pago", "Otro"];
        const methodName = allowed.includes(body.method) ? body.method : "Otro";
        quote = (await store.approveQuote(existing.id, { method: methodName, provider: "manual" })).quote;
      }
      return json(200, { quote, state: await stateFor(store, ws) });
    }

    if ((m = pathname.match(/^\/api\/clients\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]);
      if (method === "PUT") {
        const body = await parseBody(request);
        const client = await store.updateClient(ws, id, {
          name: requiredStr(body.name, "nombre", 120),
          phone: validPhone(body.phone),
          address: str(body.address, 200),
          notes: str(body.notes, 1000)
        });
        if (!client) throw new HttpError(404, "Cliente no encontrado");
        return json(200, { client, state: await stateFor(store, ws) });
      }
      if (method === "DELETE") {
        if (!(await store.deleteClient(ws, id))) throw new HttpError(404, "Cliente no encontrado");
        return json(200, { state: await stateFor(store, ws) });
      }
    }

    if (pathname === "/api/catalog" && method === "POST") {
      const body = await parseBody(request);
      const item = await store.addCatalogItem(ws, {
        title: requiredStr(body.title, "nombre del combo", 150),
        category: str(body.category, 60) || "Servicio",
        price: money(body.price, "precio"),
        description: str(body.description, 500)
      });
      return json(201, { item, state: await stateFor(store, ws) });
    }

    if ((m = pathname.match(/^\/api\/catalog\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]);
      if (method === "PUT") {
        const body = await parseBody(request);
        const item = await store.updateCatalogItem(ws, id, {
          title: requiredStr(body.title, "nombre del combo", 150),
          category: str(body.category, 60) || "Servicio",
          price: money(body.price, "precio"),
          description: str(body.description, 500)
        });
        if (!item) throw new HttpError(404, "Combo no encontrado");
        return json(200, { item, state: await stateFor(store, ws) });
      }
      if (method === "DELETE") {
        if (!(await store.deleteCatalogItem(ws, id))) throw new HttpError(404, "Combo no encontrado");
        return json(200, { state: await stateFor(store, ws) });
      }
    }

    if (pathname === "/api/reset" && method === "POST") {
      if (!demoTools) throw new HttpError(404, "No disponible");
      await store.resetToDemo(ws);
      return json(200, await stateFor(store, ws));
    }

    throw new HttpError(404, "Ruta no encontrada");
  }
}
