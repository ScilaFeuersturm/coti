// Tests de integración de la API de Coti. Correr con: npm test
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const net = require("net");
const { createApp, computeMetrics } = require("../server");

async function startApp(env = {}, extra = {}) {
  const app = createApp({ dbPath: ":memory:", env: { NODE_ENV: "test", ...env }, quiet: true, limits: { register: 1000 }, ...extra });
  await app.ready;
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, close: () => new Promise((r) => app.server.close(r)) };
}

// Cliente HTTP mínimo que conserva la cookie de sesión.
function agent(base) {
  let cookie = "";
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

async function register(base, n, extra = {}) {
  const call = agent(base);
  const r = await call("POST", "/api/auth/register", {
    email: `taller${n}@ejemplo.com`,
    password: "clave-segura-1",
    workshopName: `Taller ${n}`,
    ownerName: `Dueño ${n}`,
    phone: "+54 9 11 5555-000" + n,
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
  items: [{ title: "Instalación", qty: 1, unitPrice: 250 }, { title: "Caño", qty: 2, unitPrice: 25 }],
  depositPct: 40,
  sendImmediately: true
};

describe("Cuentas y aislamiento entre talleres (modo demo)", () => {
  let ctx;
  before(async () => (ctx = await startApp()));
  after(() => ctx.close());

  test("sin sesión no se puede leer el panel", async () => {
    const r = await agent(ctx.base)("GET", "/api/state");
    assert.equal(r.status, 401);
  });

  test("la cuenta demo existe y entra con sus datos de ejemplo", async () => {
    const call = agent(ctx.base);
    const cfg = await call("GET", "/api/config");
    const r = await call("POST", "/api/auth/login", cfg.data.demoLogin);
    assert.equal(r.status, 200);
    const s = await call("GET", "/api/state");
    assert.equal(s.data.workshop.name, "ClimaSur & Reformas Integrales");
    assert.equal(s.data.quotes.length, 6);
  });

  test("login con contraseña incorrecta falla y se bloquea tras 10 intentos", async () => {
    const call = agent(ctx.base);
    const r = await call("POST", "/api/auth/login", { email: "bloqueo@coti.app", password: "mala" });
    assert.equal(r.status, 401);
    for (let i = 0; i < 9; i++) await call("POST", "/api/auth/login", { email: "bloqueo@coti.app", password: "mala" });
    const blocked = await call("POST", "/api/auth/login", { email: "bloqueo@coti.app", password: "mala" });
    assert.equal(blocked.status, 429);
  });

  test("registro valida campos y emails repetidos", async () => {
    const call = agent(ctx.base);
    let r = await call("POST", "/api/auth/register", { email: "x@y.com", password: "123", workshopName: "a", ownerName: "b", phone: "1155550000" });
    assert.equal(r.status, 400);
    await register(ctx.base, 9);
    r = await call("POST", "/api/auth/register", {
      email: "TALLER9@ejemplo.com", password: "clave-segura-1", workshopName: "a", ownerName: "b", phone: "1155550000"
    });
    assert.equal(r.status, 409);
  });

  test("un taller no ve ni puede tocar los presupuestos de otro", async () => {
    const a = await register(ctx.base, 1);
    const b = await register(ctx.base, 2);

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

    // Los códigos COT-XXXX se repiten entre talleres sin chocar
    const qb = await b("POST", "/api/quotes", sampleQuote);
    assert.equal(qb.data.quote.code, "COT-1001");
  });

  test("el link público usa un ID no adivinable y no muestra notas internas", async () => {
    const a = await register(ctx.base, 3);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const pub = await fetch(`${ctx.base}/api/public/quote/${data.quote.publicId}`).then((r) => r.json());
    assert.equal(pub.quote.code, data.quote.code);
    assert.equal(pub.quote.voiceTranscript, undefined);
    assert.equal(pub.quote.id, undefined);
    assert.equal((await fetch(`${ctx.base}/api/public/quote/COT-1001`)).status, 404);
  });

  test("el viejo webhook abierto ya no aprueba presupuestos", async () => {
    const r = await agent(ctx.base)("POST", "/api/webhooks/payment", { quoteId: "COT-1041" });
    assert.equal(r.status, 401);
  });

  test("en modo demo, señar con Mercado Pago aprueba marcado como demo", async () => {
    const a = await register(ctx.base, 4);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const r = await agent(ctx.base)("POST", `/api/public/quote/${data.quote.publicId}/checkout`, {});
    assert.equal(r.status, 200);
    assert.equal(r.data.quote.status, "approved");
    assert.match(r.data.quote.paymentMethod, /demo/);
    const s = await a("GET", "/api/state");
    assert.equal(s.data.metrics.counts.approvedThisMonth, 1);
    assert.equal(s.data.metrics.cerradosEsteMes, 300);
  });

  test("transferencia: el cliente avisa y el taller confirma", async () => {
    const a = await register(ctx.base, 5);
    await a("PUT", "/api/workshop", { alias: "TALLER.CINCO" });
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const pid = data.quote.publicId;
    const rep = await agent(ctx.base)("POST", `/api/public/quote/${pid}/report-transfer`, {});
    assert.equal(rep.data.quote.status, "waiting_reply");
    assert.ok(rep.data.quote.transferReportedAt);
    const conf = await a("POST", `/api/quotes/${data.quote.id}/confirm-payment`, { method: "Transferencia Bancaria" });
    assert.equal(conf.data.quote.status, "approved");
    assert.equal(conf.data.quote.paymentMethod, "Transferencia Bancaria");
  });

  test("editar y borrar clientes y combos", async () => {
    const a = await register(ctx.base, 6);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const up = await a("PUT", `/api/clients/${data.quote.clientId}`, { name: "Ana L.", phone: "+54 9 11 4444-1234", notes: "VIP" });
    assert.equal(up.data.client.notes, "VIP");
    const cat = await a("POST", "/api/catalog", { title: "Combo", price: 100 });
    const edited = await a("PUT", `/api/catalog/${cat.data.item.id}`, { title: "Combo 2", price: 150 });
    assert.equal(edited.data.item.price, 150);
    assert.equal((await a("DELETE", `/api/catalog/${cat.data.item.id}`)).status, 200);
    assert.equal((await a("DELETE", `/api/clients/${data.quote.clientId}`)).status, 200);
  });

  test("CSRF: un POST con cookie desde otro origen se rechaza", async () => {
    const a = await register(ctx.base, 7);
    const r = await a("POST", "/api/quotes", sampleQuote, { Origin: "https://sitio-malicioso.com" });
    assert.equal(r.status, 403);
  });

  test("valida montos negativos y teléfonos inválidos", async () => {
    const a = await register(ctx.base, 8);
    assert.equal((await a("POST", "/api/quotes", { ...sampleQuote, items: [{ title: "x", qty: 1, unitPrice: -5 }] })).status, 400);
    assert.equal((await a("POST", "/api/quotes", { ...sampleQuote, clientPhone: "12" })).status, 400);
  });

  test("no se pueden leer archivos fuera de /public", async () => {
    const port = new URL(ctx.base).port;
    const raw = await new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => sock.write("GET /../server.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
      let buf = "";
      sock.on("data", (d) => (buf += d));
      sock.on("end", () => resolve(buf));
    });
    assert.ok(!raw.includes("createApp"), "no debe servir el código del servidor");
  });

  test("logout invalida la sesión", async () => {
    const a = await register(ctx.base, 10);
    await a("POST", "/api/auth/logout");
    assert.equal((await a("GET", "/api/state")).status, 401);
  });
});

describe("Modo producción", () => {
  let ctx;
  before(async () => (ctx = await startApp({ NODE_ENV: "production", COOKIE_SECURE: "0" })));
  after(() => ctx.close());

  test("sin cuenta demo, sin reset, sin adelantar reloj y sin MP falso", async () => {
    const cfg = await agent(ctx.base)("GET", "/api/config");
    assert.equal(cfg.data.demoLogin, null);
    assert.equal(cfg.data.payments.mercadoPago, "off");

    const a = await register(ctx.base, 1);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    assert.equal((await a("POST", "/api/reset")).status, 404);
    assert.equal((await a("POST", `/api/quotes/${data.quote.id}/age48h`)).status, 404);
    const r = await agent(ctx.base)("POST", `/api/public/quote/${data.quote.publicId}/checkout`, {});
    assert.equal(r.status, 400);
  });
});

describe("Mercado Pago en modo live (API simulada)", () => {
  const SECRET = "secreto-webhook";
  const fakePayments = {};
  const mpClient = {
    createPreference: async (cfg, { quote }) => ({ initPoint: `https://mp.test/checkout/${quote.id}` }),
    getPayment: async (cfg, id) => fakePayments[id]
  };
  let ctx;
  before(async () => {
    ctx = await startApp(
      { MP_ACCESS_TOKEN: "TEST-123", MP_WEBHOOK_SECRET: SECRET, MP_CURRENCY: "ARS", MP_FX_RATE: "1000" },
      { mpClient }
    );
  });
  after(() => ctx.close());

  function signed(dataId) {
    const ts = String(Date.now());
    const reqId = crypto.randomUUID();
    const v1 = crypto.createHmac("sha256", SECRET).update(`id:${dataId};request-id:${reqId};ts:${ts};`).digest("hex");
    return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": reqId };
  }

  test("checkout devuelve la URL de pago y no aprueba nada todavía", async () => {
    const a = await register(ctx.base, 1);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    const r = await agent(ctx.base)("POST", `/api/public/quote/${data.quote.publicId}/checkout`, {});
    assert.equal(r.data.redirectUrl, `https://mp.test/checkout/${data.quote.id}`);
    const pub = await fetch(`${ctx.base}/api/public/quote/${data.quote.publicId}`).then((x) => x.json());
    assert.equal(pub.quote.status, "waiting_reply");
  });

  test("webhook con firma inválida se rechaza", async () => {
    const r = await agent(ctx.base)("POST", "/api/webhooks/mercadopago?data.id=1&type=payment", { type: "payment", data: { id: "1" } }, {
      "x-signature": "ts=1,v1=deadbeef",
      "x-request-id": "abc"
    });
    assert.equal(r.status, 401);
  });

  test("webhook firmado aprueba solo si MP confirma el pago por el monto correcto", async () => {
    const a = await register(ctx.base, 2);
    const { data } = await a("POST", "/api/quotes", sampleQuote); // seña 120 USD = 120000 ARS
    const q = data.quote;

    fakePayments["111"] = { id: 111, status: "approved", external_reference: q.id, currency_id: "ARS", transaction_amount: 500 };
    await agent(ctx.base)("POST", "/api/webhooks/mercadopago?data.id=111&type=payment", { type: "payment", data: { id: "111" } }, signed("111"));
    let s = await a("GET", "/api/state");
    assert.equal(s.data.quotes[0].status, "waiting_reply", "monto insuficiente no aprueba");

    fakePayments["222"] = { id: 222, status: "approved", external_reference: q.id, currency_id: "ARS", transaction_amount: 120000 };
    const r = await agent(ctx.base)("POST", "/api/webhooks/mercadopago?data.id=222&type=payment", { type: "payment", data: { id: "222" } }, signed("222"));
    assert.equal(r.status, 200);
    s = await a("GET", "/api/state");
    assert.equal(s.data.quotes[0].status, "approved");
    assert.equal(s.data.quotes[0].paymentMethod, "Mercado Pago");

    // Reintento del mismo webhook: idempotente
    const again = await agent(ctx.base)("POST", "/api/webhooks/mercadopago?data.id=222&type=payment", { type: "payment", data: { id: "222" } }, signed("222"));
    assert.equal(again.status, 200);
  });

  test("al volver de MP, verify-payment confirma el pago (sirve sin webhook en local)", async () => {
    const a = await register(ctx.base, 3);
    const { data } = await a("POST", "/api/quotes", sampleQuote);
    fakePayments["333"] = { id: 333, status: "approved", external_reference: data.quote.id, currency_id: "ARS", transaction_amount: 120000 };
    const r = await agent(ctx.base)("POST", `/api/public/quote/${data.quote.publicId}/verify-payment`, { paymentId: "333" });
    assert.equal(r.data.quote.status, "approved");
  });

  test("verify-payment con un pago de OTRO presupuesto no aprueba este", async () => {
    const a = await register(ctx.base, 4);
    const q1 = (await a("POST", "/api/quotes", sampleQuote)).data.quote;
    const q2 = (await a("POST", "/api/quotes", sampleQuote)).data.quote;
    fakePayments["444"] = { id: 444, status: "approved", external_reference: q1.id, currency_id: "ARS", transaction_amount: 120000 };
    const r = await agent(ctx.base)("POST", `/api/public/quote/${q2.publicId}/verify-payment`, { paymentId: "444" });
    assert.equal(r.data.quote.status, "waiting_reply");
  });
});

describe("Métricas", () => {
  test("'Cerrados este mes' ignora lo aprobado en meses anteriores", () => {
    const now = Date.UTC(2026, 10, 16, 15);
    const lastMonth = Date.UTC(2026, 9, 20, 15);
    const state = {
      workshop: { timezone: "America/Argentina/Buenos_Aires" },
      quotes: [
        { status: "approved", total: 1000, depositAmount: 400, approvedAt: now - 3600e3 },
        { status: "approved", total: 2000, depositAmount: 1000, approvedAt: lastMonth },
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
