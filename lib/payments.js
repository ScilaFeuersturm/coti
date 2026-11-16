// Cobro de señas con Mercado Pago (Checkout Pro).
//
// Modos:
//  - "live": hay MP_ACCESS_TOKEN. Se crea una preferencia y el cliente paga en Mercado Pago.
//            El presupuesto se aprueba SOLO cuando el servidor consulta el pago a la API de
//            Mercado Pago y confirma status=approved por el monto correcto.
//  - "demo": no hay token y las herramientas demo están activas. Se aprueba sin cobrar,
//            marcado como "(demo, sin cobro real)".
//  - "off":  no hay token y estamos en producción. La opción Mercado Pago no se ofrece.

const crypto = require("crypto");

const MP_API = "https://api.mercadopago.com";

function getConfig(env = process.env, { demoTools }) {
  const token = (env.MP_ACCESS_TOKEN || "").trim();
  return {
    mode: token ? "live" : demoTools ? "demo" : "off",
    token,
    webhookSecret: (env.MP_WEBHOOK_SECRET || "").trim(),
    currency: (env.MP_CURRENCY || "ARS").trim().toUpperCase(),
    // Cuántas unidades de MP_CURRENCY vale 1 unidad de la moneda del taller (ej. 1 USD = 1200 ARS).
    fxRate: Number(env.MP_FX_RATE) || null
  };
}

// Convierte la seña (en la moneda del taller) a la moneda en que cobra Mercado Pago.
function chargeAmount(depositAmount, workshopCurrency, cfg) {
  if ((workshopCurrency || "USD").toUpperCase() === cfg.currency) {
    return Math.round(depositAmount * 100) / 100;
  }
  if (!cfg.fxRate) {
    const err = new Error(
      `El taller cotiza en ${workshopCurrency} pero Mercado Pago cobra en ${cfg.currency}. Configurá MP_FX_RATE.`
    );
    err.code = "FX_RATE_MISSING";
    throw err;
  }
  return Math.round(depositAmount * cfg.fxRate * 100) / 100;
}

async function mpFetch(cfg, pathname, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${cfg.token}` };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${MP_API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Mercado Pago respondió ${res.status}: ${data.message || "error"}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function createPreference(cfg, { quote, workshop, baseUrl }) {
  const amount = chargeAmount(quote.depositAmount, workshop.currency, cfg);
  const backUrl = `${baseUrl}/p/${quote.publicId}`;
  const pref = await mpFetch(cfg, "/checkout/preferences", {
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
      notification_url: baseUrl.startsWith("https://") ? `${baseUrl}/api/webhooks/mercadopago` : undefined,
      back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
      auto_return: baseUrl.startsWith("https://") ? "approved" : undefined,
      statement_descriptor: String(workshop.name || "COTI").slice(0, 22)
    }
  });
  return { initPoint: pref.init_point, preferenceId: pref.id, amount };
}

function getPayment(cfg, paymentId) {
  return mpFetch(cfg, `/v1/payments/${encodeURIComponent(paymentId)}`);
}

// Verifica la cabecera x-signature de las notificaciones (Webhooks) de Mercado Pago.
// Plantilla oficial: "id:{data.id};request-id:{x-request-id};ts:{ts};"
function verifyWebhookSignature({ secret, signatureHeader, requestId, dataId }) {
  if (!secret) return true; // sin secreto configurado: se confía solo en la re-consulta a la API
  if (!signatureHeader || !dataId) return false;
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
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Valida un pago de MP contra un presupuesto. Devuelve null si es válido o el motivo del rechazo.
function validatePaymentForQuote(payment, quote, workshop, cfg) {
  if (!payment || payment.status !== "approved") return "El pago no está aprobado";
  if (payment.external_reference !== quote.id) return "El pago no corresponde a este presupuesto";
  if (String(payment.currency_id || "").toUpperCase() !== cfg.currency) return "Moneda inesperada";
  const expected = chargeAmount(quote.depositAmount, workshop.currency, cfg);
  if (Number(payment.transaction_amount) + 0.01 < expected) return "Monto menor a la seña";
  return null;
}

module.exports = {
  getConfig,
  createPreference,
  getPayment,
  verifyWebhookSignature,
  validatePaymentForQuote,
  chargeAmount
};
