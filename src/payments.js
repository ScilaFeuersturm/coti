// Cobro de señas con Mercado Pago (Checkout Pro).
//
// ¿A qué cuenta va la seña?
//  - Cada negocio conecta SU cuenta de Mercado Pago (OAuth, "Conectar Mercado Pago" en Mi negocio).
//    Las preferencias se crean con el token de ese negocio → el dinero va directo a él.
//  - MP_ACCESS_TOKEN (token global) es SOLO para pruebas: se usa únicamente si Mercado Pago confirma
//    que es de una cuenta de prueba. Un token de producción global se ignora, para que nunca
//    entre la seña de un negocio en la cuenta de la plataforma.
//  - Sin nada de lo anterior: modo "demo" (solo fuera de producción, sin cobro real) u "off".

import { hmacSha256Hex, safeEqual } from "./auth.js";

const MP_API = "https://api.mercadopago.com";
// Dominio de autorización por país (sin esto, Mercado Pago pide elegir el país antes de ingresar).
const MP_AUTH_DEFAULT_DOMAIN = "auth.mercadopago.com.ar";

export function getPaymentConfig(env, { demoTools }) {
  const clientId = String(env.MP_CLIENT_ID || "").trim();
  const clientSecret = String(env.MP_CLIENT_SECRET || "").trim();
  const encKey = String(env.TOKEN_ENCRYPTION_KEY || "").trim();
  return {
    demoTools,
    globalToken: String(env.MP_ACCESS_TOKEN || "").trim(),
    webhookSecret: String(env.MP_WEBHOOK_SECRET || "").trim(),
    currency: String(env.MP_CURRENCY || "ARS").trim().toUpperCase(),
    // Cuántas unidades de MP_CURRENCY vale 1 unidad de la moneda del negocio (solo si algún negocio cotiza en otra moneda).
    fxRate: Number(env.MP_FX_RATE) || null,
    clientId,
    clientSecret,
    encKey,
    oauthEnabled: Boolean(clientId && clientSecret && encKey),
    authDomain: /^auth\.mercadopago\.[a-z.]+$/.test(String(env.MP_AUTH_DOMAIN || ""))
      ? String(env.MP_AUTH_DOMAIN)
      : MP_AUTH_DEFAULT_DOMAIN,
    // Con credenciales de prueba, pide a MP tokens de prueba al conectar cuentas.
    oauthTestTokens: env.MP_OAUTH_TEST_TOKENS === "1"
  };
}

// Convierte la seña (moneda del negocio) a la moneda en que cobra Mercado Pago.
export function chargeAmount(depositAmount, workshopCurrency, cfg) {
  if (String(workshopCurrency || "ARS").toUpperCase() === cfg.currency) {
    return Math.round(depositAmount * 100) / 100;
  }
  if (!cfg.fxRate) {
    const err = new Error(
      `El negocio cotiza en ${workshopCurrency} pero Mercado Pago cobra en ${cfg.currency}. Configurá MP_FX_RATE.`
    );
    err.code = "FX_RATE_MISSING";
    throw err;
  }
  return Math.round(depositAmount * cfg.fxRate * 100) / 100;
}

async function mpFetch(token, pathname, { method = "GET", body, idempotencyKey, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${MP_API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : form,
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Mercado Pago respondió ${res.status}: ${data.message || data.error || "error"}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function authorizationUrl(cfg, { state, redirectUri }) {
  const u = new URL(`https://${cfg.authDomain}/authorization`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("platform_id", "mp");
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", redirectUri);
  return u.toString();
}

// Cliente real de la API de Mercado Pago (en los tests se reemplaza por uno simulado).
export const mercadoPagoClient = {
  async createPreference(cfg, { quote, workshop, baseUrl, accessToken }) {
    const amount = chargeAmount(quote.depositAmount, workshop.currency, cfg);
    const backUrl = `${baseUrl}/p/${quote.publicId}`;
    const isHttps = baseUrl.startsWith("https://");
    const pref = await mpFetch(accessToken, "/checkout/preferences", {
      method: "POST",
      idempotencyKey: `coti-pref-${quote.id}-${amount}`,
      body: {
        items: [
          {
            id: quote.code,
            title: `Seña ${quote.code} — ${workshop.name}`.slice(0, 250),
            description: String(quote.serviceSummary || "").slice(0, 250),
            quantity: 1,
            currency_id: cfg.currency,
            unit_price: amount
          }
        ],
        external_reference: quote.id,
        metadata: { quote_id: quote.id },
        // El ID público en la ruta permite saber de qué negocio es el pago al recibir la notificación.
        notification_url: isHttps ? `${baseUrl}/api/webhooks/mercadopago/${quote.publicId}` : undefined,
        back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
        auto_return: isHttps ? "approved" : undefined,
        statement_descriptor: String(workshop.name || "COTI").slice(0, 22)
      }
    });
    return { initPoint: pref.init_point, preferenceId: pref.id, amount };
  },

  getPayment(cfg, paymentId, accessToken) {
    return mpFetch(accessToken, `/v1/payments/${encodeURIComponent(paymentId)}`);
  },

  // ¿El token es de una cuenta de prueba? (TEST-... o usuario de prueba con la etiqueta test_user)
  async isTestToken(token) {
    if (token.startsWith("TEST-")) return true;
    const me = await mpFetch(token, "/users/me");
    return Array.isArray(me.tags) && me.tags.includes("test_user");
  },

  exchangeCode(cfg, { code, redirectUri }) {
    return mpFetch(null, "/oauth/token", {
      method: "POST",
      body: {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        ...(cfg.oauthTestTokens ? { test_token: "true" } : {})
      }
    });
  },

  refreshToken(cfg, { refreshToken }) {
    return mpFetch(null, "/oauth/token", {
      method: "POST",
      body: {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }
    });
  }
};

// Verifica la cabecera x-signature de las notificaciones de Mercado Pago.
// Plantilla oficial: "id:{data.id};request-id:{x-request-id};ts:{ts};"
export async function verifyWebhookSignature({ secret, signatureHeader, requestId, dataId }) {
  if (!secret || !signatureHeader) return true; // sin firma: igual se re-consulta el pago a la API
  if (!dataId) return false;
  const parts = {};
  String(signatureHeader)
    .split(",")
    .forEach((p) => {
      const [k, v] = p.split("=").map((s) => (s || "").trim());
      if (k && v) parts[k] = v;
    });
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : String(dataId);
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = await hmacSha256Hex(secret, manifest);
  const enc = new TextEncoder();
  return safeEqual(enc.encode(expected), enc.encode(parts.v1.toLowerCase()));
}

// Valida un pago de MP contra un presupuesto. Devuelve null si es válido o el motivo del rechazo.
export function validatePaymentForQuote(payment, quote, workshop, cfg) {
  if (!payment || payment.status !== "approved") return "El pago no está aprobado";
  if (payment.external_reference !== quote.id) return "El pago no corresponde a este presupuesto";
  if (String(payment.currency_id || "").toUpperCase() !== cfg.currency) return "Moneda inesperada";
  const expected = chargeAmount(quote.depositAmount, workshop.currency, cfg);
  if (Number(payment.transaction_amount) + 0.01 < expected) return "Monto menor a la seña";
  return null;
}
