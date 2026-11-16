// Tests de la API de Coti. Correr con: npm test
// Llaman al mismo manejador que usa el Worker, con una base D1 simulada en memoria.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createApiHandler, computeMetrics } from "../src/app.js";
import worker from "../src/worker.js";
import { createTestD1 } from "./d1-shim.js";

const BASE = "https://coti.test";

function makeApp(vars = {}, options = {}) {
  const env = { DB: createTestD1(), ENVIRONMENT: "development", ...vars };
  const handler = createApiHandler({ limits: { register: 1000 }, ...options });
  return { env, handler };
}

// Cliente mínimo que conserva la cookie de sesión.
function agent({ env, handler }) {
  let cookie = "";
  return async function call(method, path, body, headers = {}) {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers
        },
        body: body ? JSON.stringify(body) : undefined
      }),
      env
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  };
}

let seq = 0;
async function register(app, extra = {}) {
  const call = agent(app);
  const nn = ++seq;
  const r = await call("POST", "/api/auth/register", {
    email: `taller${nn}@ejemplo.com`,
    password: "clave-segura-1",
    workshopName: `Taller ${nn}`,
    ownerName: `Dueño ${nn}`,
    phone: "+54 9 11 5555-" + String(1000 + nn),
    ...extra
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return call;
}

const sampleQuote = {
  clientName: "Ana López",
  clientPhone: "+54 9 11 4444-1234",
  clientAddress: "Calle 123",
  serviceSummary: "Instalación split",
  voiceTranscript: "nota interna: cliente regatea",
  items: [
    { title: "Instalación", qty: 1, unitPrice: 250 },
    { title: "Caño", qty: 2, unitPrice: 25 }
  ],
  depositPct: 40,
  sendImmediately: true
};

describe("Cuentas y aislamiento entre talleres (modo desarrollo)", () => {
  const app = makeApp();
  const pub = agent(app);

  test("sin sesión no se puede leer el panel", async () => {
    assert.equal((await pub("GET", "/api/state")).status, 401);
  });

  test("la cuenta demo existe y entra con sus datos de ejemplo", async () => {
    const call = agent(app);
    const cfg = await call("GET", "/api/config");
    const r = await call("POST", "/api/auth/login", cfg.data.demoLogin);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie"), /HttpOnly/);
    assert.match(r.headers.get("set-cookie"), /Secure/);
    const s = await call("GET", "/api/state");
    assert.equal(s.data.workshop.name, "ClimaSur & Reformas Integrales");
    assert.equal(s.data.quotes.length, 6);
    assert.ok(s.data.quotes.every((q) => q.createdAt > 1e12), "fechas reales, no 0");
  });

  test("login incorrecto falla y se bloquea tras 10 intentos", async () => {
    const call = agent(app);
    assert.equal((await call("POST", "/api/auth/login", { email: "bloqueo@coti.app", password: "mala" })).status, 401);
    for (let i = 0; i < 9; i++) await call("POST", "/api/auth/login", { email: "bloqueo@coti.app", password: "mala" });
    assert.equal((await call("POST", "/api/auth/login", { email: "bloqueo@coti.app", password: "mala" })).status, 429);
  });

  test("registro valida campos y emails repetidos", async () => {
    const call = agent(app);
    const bad = await call("POST", "/api/auth/register", { email: "x@y.com", password: "123", workshopName: "a", ownerName: "b", phone: "1155550000" });
    assert.equal(bad.status, 400);
    await register(app, { email: "repetido@ejemplo.com" });
    const dup = await call("POST", "/api/auth/register", {
      email: "REPETIDO@ejemplo.com", password: "clave-segura-1", workshopName: "a", ownerName: "b", phone: "1155550000"
    });
    assert.equal(dup.status, 409);
  });

  test("un taller no ve ni puede tocar los presupuestos de otro", async () => {
    const a = await register(app);
    const b = await register(app);
    const created = await a("POST", "/api/quotes", sampleQuote);
    assert.equal(created.status, 201);
    const q = created.data.quote;
    assert.equal(q.code, "COT-1001");
    assert.equal(q.total, 300);
    assert.equal(q.depositAmount, 120);

    const sb = await b("GET", "/api/state");
    assert.equal(sb.data.quotes.length, 0);
    assert.equal(sb.data.clients.length, 0);
    assert.equal((await b("POST", `/api/quotes/${q.id}/remind`)).status, 404);
    assert.equal((await b("POST", `/api/quotes/${q.id}/confirm-payment`, { method: "Efectivo" })).status, 404);
    assert.equal((await b("DELETE", `/api/clients/${q.clientId}`)).status, 404);

    // Los códigos COT-XXXX se repiten entre talleres sin chocar, y avanzan dentro de cada uno
    assert.equal((await b("POST", "/api/quotes", sampleQuote)).data.quote.code, "COT-1001");
    assert.equal((await a("POST", "/api/quotes", sampleQuote)).data.quote.code, "COT-1002");
  });

  test("el mismo teléfono reutiliza el cliente de la agenda", async () => {
    const a = await register(app);
    await a("POST", "/api/quotes", sampleQuote);
    await a("POST", "/api/quotes", { ...sampleQuote, clientName: "Ana María López", clientPhone: "+54 (9) 11 4444 1234" });
    const s = await a("GET", "/api/state");
    assert.equal(s.data.quotes.length, 2);
    assert.equal(s.data.clients.length, 1);
    assert.equal(s.data.clients[0].name, "Ana María López");
  });

  test("el link público usa un ID no adivinable y no muestra notas internas", async () => {
    const a = await register(app);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const p = await pub("GET", `/api/public/quote/${data.quote.publicId}`);
    assert.equal(p.data.quote.code, data.quote.code);
    assert.equal(p.data.quote.voiceTranscript, undefined);
    assert.equal(p.data.quote.id, undefined);
    assert.equal((await pub("GET", "/api/public/quote/COT-1001")).status, 404);
  });

  test("el viejo webhook abierto ya no aprueba presupuestos", async () => {
    assert.equal((await pub("POST", "/api/webhooks/payment", { quoteId: "COT-1041" })).status, 401);
  });

  test("en modo demo, señar con Mercado Pago aprueba marcado como demo", async () => {
    const a = await register(app);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const r = await pub("POST", `/api/public/quote/${data.quote.publicId}/checkout`, {});
    assert.equal(r.status, 200);
    assert.equal(r.data.quote.status, "approved");
    assert.match(r.data.quote.paymentMethod, /demo/);
    const s = await a("GET", "/api/state");
    assert.equal(s.data.metrics.counts.approvedThisMonth, 1);
    assert.equal(s.data.metrics.cerradosEsteMes, 300);
  });

  test("transferencia: el cliente avisa y el taller confirma", async () => {
    const a = await register(app);
    await a("PUT", "/api/workshop", { alias: "TALLER.CINCO" });
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const rep = await pub("POST", `/api/public/quote/${data.quote.publicId}/report-transfer`, {});
    assert.equal(rep.data.quote.status, "waiting_reply");
    assert.ok(rep.data.quote.transferReportedAt);
    const conf = await a("POST", `/api/quotes/${data.quote.id}/confirm-payment`, { method: "Transferencia Bancaria" });
    assert.equal(conf.data.quote.status, "approved");
    assert.equal(conf.data.quote.paymentMethod, "Transferencia Bancaria");
  });

  test("editar y borrar clientes y combos", async () => {
    const a = await register(app);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const up = await a("PUT", `/api/clients/${data.quote.clientId}`, { name: "Ana L.", phone: "+54 9 11 4444-1234", notes: "VIP" });
    assert.equal(up.data.client.notes, "VIP");
    const cat = await a("POST", "/api/catalog", { title: "Combo", price: 100 });
    const edited = await a("PUT", `/api/catalog/${cat.data.item.id}`, { title: "Combo 2", price: 150 });
    assert.equal(edited.data.item.price, 150);
    assert.equal((await a("DELETE", `/api/catalog/${cat.data.item.id}`)).status, 200);
    assert.equal((await a("DELETE", `/api/clients/${data.quote.clientId}`)).status, 200);
    const s = await a("GET", "/api/state");
    assert.equal(s.data.quotes.length, 1, "el presupuesto sobrevive al borrar el cliente");
  });

  test("reset de demo recarga los ejemplos del propio taller", async () => {
    const a = await register(app);
    const r = await a("POST", "/api/reset");
    assert.equal(r.status, 200);
    assert.equal(r.data.quotes.length, 6);
  });

  test("CSRF: un POST con cookie desde otro origen se rechaza", async () => {
    const a = await register(app);
    assert.equal((await a("POST", "/api/quotes", sampleQuote, { Origin: "https://sitio-malicioso.com" })).status, 403);
    assert.equal((await a("POST", "/api/quotes", sampleQuote, { Origin: BASE })).status, 201);
  });

  test("valida montos negativos y teléfonos inválidos", async () => {
    const a = await register(app);
    assert.equal((await a("POST", "/api/quotes", { ...sampleQuote, items: [{ title: "x", qty: 1, unitPrice: -5 }] })).status, 400);
    assert.equal((await a("POST", "/api/quotes", { ...sampleQuote, clientPhone: "12" })).status, 400);
  });

  test("logout invalida la sesión", async () => {
    const a = await register(app);
    await a("POST", "/api/auth/logout");
    assert.equal((await a("GET", "/api/state")).status, 401);
  });

  test("la app móvil puede pedir el token y usarlo como Bearer", async () => {
    const call = agent(app);
    const r = await call("POST", "/api/auth/register", {
      email: "movil@ejemplo.com", password: "clave-segura-1", workshopName: "Móvil", ownerName: "M", phone: "1155550101", client: "mobile"
    });
    assert.ok(r.data.token);
    const s = await agent(app)("GET", "/api/state", null, { Authorization: `Bearer ${r.data.token}` });
    assert.equal(s.data.workshop.name, "Móvil");
  });
});

describe("Modo producción", () => {
  const app = makeApp({ ENVIRONMENT: "production" });

  test("sin cuenta demo, sin reset, sin adelantar reloj y sin MP falso", async () => {
    const cfg = await agent(app)("GET", "/api/config");
    assert.equal(cfg.data.demoLogin, null);
    assert.equal(cfg.data.payments.mercadoPago, "off");
    const login = await agent(app)("POST", "/api/auth/login", { email: "demo@coti.app", password: "coti-demo-1234" });
    assert.equal(login.status, 401);

    const a = await register(app);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    assert.equal((await a("POST", "/api/reset")).status, 404);
    assert.equal((await a("POST", `/api/quotes/${data.quote.id}/age48h`)).status, 404);
    assert.equal((await agent(app)("POST", `/api/public/quote/${data.quote.publicId}/checkout`, {})).status, 400);
  });

  test("el registro se limita por IP", async () => {
    const limited = makeApp({ ENVIRONMENT: "production" }, { limits: { register: 2 } });
    const body = (i) => ({ email: `lim${i}@ej.com`, password: "clave-segura-1", workshopName: "a", ownerName: "b", phone: "1155550000" });
    const call = agent(limited);
    const ip = { "CF-Connecting-IP": "203.0.113.9" };
    assert.equal((await call("POST", "/api/auth/register", body(1), ip)).status, 201);
    assert.equal((await call("POST", "/api/auth/register", body(2), ip)).status, 201);
    assert.equal((await call("POST", "/api/auth/register", body(3), ip)).status, 429);
  });
});

describe("Mercado Pago en modo live (API simulada)", () => {
  const SECRET = "secreto-webhook";
  const fakePayments = {};
  const mpClient = {
    createPreference: async (cfg, { quote }) => ({ initPoint: `https://mp.test/checkout/${quote.id}` }),
    getPayment: async (cfg, id) => fakePayments[id]
  };
  const app = makeApp(
    { ENVIRONMENT: "production", MP_ACCESS_TOKEN: "TEST-123", MP_WEBHOOK_SECRET: SECRET, MP_CURRENCY: "ARS", MP_FX_RATE: "1000" },
    { mpClient }
  );
  const pub = agent(app);

  function signed(dataId) {
    const ts = String(Date.now());
    const reqId = randomUUID();
    const v1 = createHmac("sha256", SECRET).update(`id:${dataId};request-id:${reqId};ts:${ts};`).digest("hex");
    return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": reqId };
  }

  const hook = (id, headers) =>
    pub("POST", `/api/webhooks/mercadopago?data.id=${id}&type=payment`, { type: "payment", data: { id: String(id) } }, headers);

  test("checkout devuelve la URL de pago y no aprueba nada todavía", async () => {
    const a = await register(app);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const r = await pub("POST", `/api/public/quote/${data.quote.publicId}/checkout`, {});
    assert.equal(r.data.redirectUrl, `https://mp.test/checkout/${data.quote.id}`);
    assert.equal((await pub("GET", `/api/public/quote/${data.quote.publicId}`)).data.quote.status, "waiting_reply");
  });

  test("webhook con firma inválida se rechaza", async () => {
    assert.equal((await hook(1, { "x-signature": "ts=1,v1=deadbeef", "x-request-id": "abc" })).status, 401);
  });

  test("webhook firmado aprueba solo si MP confirma el pago por el monto correcto", async () => {
    const a = await register(app);
    const q = (await a("POST", "/api/quotes", sampleQuote)).data.quote; // seña 120 USD = 120000 ARS

    fakePayments["111"] = { id: 111, status: "approved", external_reference: q.id, currency_id: "ARS", transaction_amount: 500 };
    await hook(111, signed("111"));
    assert.equal((await a("GET", "/api/state")).data.quotes[0].status, "waiting_reply", "monto insuficiente no aprueba");

    fakePayments["222"] = { id: 222, status: "approved", external_reference: q.id, currency_id: "ARS", transaction_amount: 120000 };
    assert.equal((await hook(222, signed("222"))).status, 200);
    const s = await a("GET", "/api/state");
    assert.equal(s.data.quotes[0].status, "approved");
    assert.equal(s.data.quotes[0].paymentMethod, "Mercado Pago");

    assert.equal((await hook(222, signed("222"))).status, 200, "reintento idempotente");
  });

  test("al volver de MP, verify-payment confirma el pago (sirve sin webhook)", async () => {
    const a = await register(app);
    const q = (await a("POST", "/api/quotes", sampleQuote)).data.quote;
    fakePayments["333"] = { id: 333, status: "approved", external_reference: q.id, currency_id: "ARS", transaction_amount: 120000 };
    const r = await pub("POST", `/api/public/quote/${q.publicId}/verify-payment`, { paymentId: "333" });
    assert.equal(r.data.quote.status, "approved");
  });

  test("verify-payment con un pago de OTRO presupuesto no aprueba este", async () => {
    const a = await register(app);
    const q1 = (await a("POST", "/api/quotes", sampleQuote)).data.quote;
    const q2 = (await a("POST", "/api/quotes", sampleQuote)).data.quote;
    fakePayments["444"] = { id: 444, status: "approved", external_reference: q1.id, currency_id: "ARS", transaction_amount: 120000 };
    const r = await pub("POST", `/api/public/quote/${q2.publicId}/verify-payment`, { paymentId: "444" });
    assert.equal(r.data.quote.status, "waiting_reply");
  });
});

describe("Worker: ruteo", () => {
  test("/p/<id> sirve la página del presupuesto y el resto va a los archivos estáticos", async () => {
    const asked = [];
    const env = {
      DB: createTestD1(),
      ENVIRONMENT: "production",
      ASSETS: { fetch: async (req) => (asked.push(new URL(req.url).pathname), new Response("<html>ok</html>", { status: 200 })) }
    };
    const r = await worker.fetch(new Request(`${BASE}/p/abc123XYZ`), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
    await worker.fetch(new Request(`${BASE}/styles.css`), env);
    assert.deepEqual(asked, ["/quote", "/styles.css"]);
    const api = await worker.fetch(new Request(`${BASE}/api/config`), env);
    assert.equal((await api.json()).payments.mercadoPago, "off");
  });
});

describe("Métricas", () => {
  test("'Cerrados este mes' ignora lo aprobado en meses anteriores", () => {
    const now = Date.UTC(2026, 10, 16, 15);
    const state = {
      workshop: { timezone: "America/Argentina/Buenos_Aires" },
      quotes: [
        { status: "approved", total: 1000, depositAmount: 400, approvedAt: now - 3600e3 },
        { status: "approved", total: 2000, depositAmount: 1000, approvedAt: Date.UTC(2026, 9, 20, 15) },
        { status: "waiting_reply", total: 500, sentAt: now - 50 * 3600e3 },
        { status: "draft", total: 300 }
      ]
    };
    const m = computeMetrics(state, now);
    assert.equal(m.cerradosEsteMes, 1000);
    assert.equal(m.senasCobradas, 400);
    assert.equal(m.dineroEnLaCalle, 500);
    assert.equal(m.tasaConversion, 67);
    assert.equal(m.counts.overdue48h, 1);
  });
});
