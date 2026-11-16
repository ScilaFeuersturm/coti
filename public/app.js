// ============================================================================
// COTI CRM — Frontend Mobile-First ("Anti-Plantilla IA" · Human-First Design)
// Con Selector de Rol: 👷 Dueño del Negocio vs 👤 Cliente Final
// ============================================================================

const HOUR_48_MS = 48 * 3600 * 1000;

let appState = {
  workshop: {},
  catalog: [],
  quickAddons: [],
  clients: [],
  quotes: [],
  metrics: {
    dineroEnLaCalle: 0,
    cerradosEsteMes: 0,
    senasCobradas: 0,
    tasaConversion: 0,
    counts: { draft: 0, waiting_reply: 0, approved: 0, overdue48h: 0 }
  }
};

let activeRoleMode = "workshop"; // 'workshop' | 'client'
let selectedClientQuoteCode = "COT-1041";
let selectedClientGateway = "Mercado Pago";

let activeMainSection = "board"; // 'board' | 'clients' | 'catalog'
let activeInboxTab = "waiting_reply"; // 'waiting_reply' | 'draft' | 'approved'
let searchQuery = "";
let onlyOverdueFilter = false;

// Estado temporal del Modal de Cotización Flash
let draftItems = [];
let draftDepositPct = 40;
let speechRecognizer = null;
let isRecordingVoice = false;

let appConfig = { demoTools: false, demoLogin: null, payments: { mercadoPago: "off" } };

// Escapa texto antes de insertarlo en HTML (nombres, notas, conceptos...).
function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Cliente de la API: JSON + cookie de sesión. Si la sesión venció, vuelve al login.
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin"
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    showAuthScreen();
    const err = new Error(data.error || "Iniciá sesión para continuar.");
    err.authRequired = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || "Algo salió mal. Probá de nuevo.");
    err.status = res.status;
    throw err;
  }
  return data;
}

// Ejecuta una acción mostrando el error al usuario en vez de fallar en silencio.
async function safely(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err.authRequired) showToast(`⚠️ ${esc(err.message)}`);
    return null;
  }
}

// ============================================================================
// ACCESO: LOGIN / REGISTRO / SALIR
// ============================================================================
function showAuthScreen() {
  document.getElementById("appRoot").style.display = "none";
  document.getElementById("authScreen").style.display = "flex";
  const hint = document.getElementById("authDemoHint");
  if (appConfig.demoLogin) {
    hint.style.display = "block";
    hint.innerHTML = `🧪 <strong>Modo demo:</strong> probá con <span class="mono">${esc(appConfig.demoLogin.email)}</span> / <span class="mono">${esc(appConfig.demoLogin.password)}</span>
      <button type="button" class="btn btn-secondary btn-block" style="margin-top: 8px;" onclick="fillDemoLogin()">Usar cuenta demo</button>`;
  } else {
    hint.style.display = "none";
  }
}

function showApp() {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("appRoot").style.display = "block";
  document.getElementById("resetDemoBtn").style.display = appConfig.demoTools ? "" : "none";
  updateInstallUi();
}

function setAuthTab(tab) {
  document.getElementById("authTabLogin").classList.toggle("active", tab === "login");
  document.getElementById("authTabRegister").classList.toggle("active", tab === "register");
  document.getElementById("loginForm").style.display = tab === "login" ? "flex" : "none";
  document.getElementById("registerForm").style.display = tab === "register" ? "flex" : "none";
  setAuthError("");
}

function setAuthError(msg) {
  const el = document.getElementById("authError");
  el.textContent = msg;
  el.classList.toggle("show", Boolean(msg));
}

function fillDemoLogin() {
  setAuthTab("login");
  document.getElementById("loginEmail").value = appConfig.demoLogin.email;
  document.getElementById("loginPassword").value = appConfig.demoLogin.password;
}

async function handleLogin(e) {
  e.preventDefault();
  setAuthError("");
  try {
    await api("POST", "/api/auth/login", {
      email: document.getElementById("loginEmail").value,
      password: document.getElementById("loginPassword").value
    });
    document.getElementById("loginPassword").value = "";
    await fetchAppState();
  } catch (err) {
    setAuthError(err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  setAuthError("");
  try {
    await api("POST", "/api/auth/register", {
      workshopName: document.getElementById("regWorkshop").value,
      ownerName: document.getElementById("regOwner").value,
      phone: document.getElementById("regPhone").value,
      email: document.getElementById("regEmail").value,
      password: document.getElementById("regPassword").value,
      withDemoData: document.getElementById("regDemoData").checked
    });
    document.getElementById("regPassword").value = "";
    await fetchAppState();
    showToast("¡Cuenta creada! Cargá tu alias o CBU en ⚙️ Mi negocio para cobrar señas.");
  } catch (err) {
    setAuthError(err.message);
  }
}

async function handleLogout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  appState.quotes = [];
  appState.clients = [];
  setAuthTab("login");
  showAuthScreen();
}

// ============================================================================
// AJUSTES DEL NEGOCIO
// ============================================================================
function openSettingsModal() {
  const w = appState.workshop || {};
  document.getElementById("setName").value = w.name || "";
  document.getElementById("setOwner").value = w.owner || "";
  document.getElementById("setPhone").value = w.phone || "";
  document.getElementById("setAlias").value = w.alias || "";
  document.getElementById("setCbu").value = w.cbu || "";
  document.getElementById("setDeposit").value = w.defaultDepositPct ?? 40;
  document.getElementById("setValidity").value = w.validityDays ?? 7;
  document.getElementById("settingsAccountInfo").textContent = w.trialEndsAt
    ? `Prueba gratis hasta el ${formatDate(w.trialEndsAt)}.`
    : "";
  renderMpConnectStatus();
  document.getElementById("settingsModal").classList.add("open");
}

// Estado de "Conectar Mercado Pago": cada negocio cobra las señas en SU cuenta.
function renderMpConnectStatus() {
  const box = document.getElementById("mpConnectStatus");
  if (!box) return;
  const mp = (appState.workshop && appState.workshop.mercadoPago) || { connected: false };
  const available = Boolean(appConfig.payments && appConfig.payments.connectAvailable);

  if (mp.connected) {
    box.innerHTML = `
      <span class="mp-connected-pill">✓ Mercado Pago conectado${mp.liveMode ? "" : " (cuenta de prueba)"}</span>
      <span>Las señas que pagan tus clientes con Mercado Pago entran directo en tu cuenta (usuario ${esc(mp.mpUserId)}).</span>
      <button type="button" class="btn btn-ghost" onclick="disconnectMercadoPago()">Desconectar</button>`;
  } else if (available) {
    box.innerHTML = `
      <span>Conectá tu cuenta y tus clientes van a poder pagar la seña con tarjeta, débito o dinero en cuenta. La plata entra directo en tu Mercado Pago: Coti no la toca.</span>
      <a href="/api/mp/connect" class="btn btn-primary">Conectar Mercado Pago</a>`;
  } else {
    box.innerHTML = `
      <span>Muy pronto vas a poder conectar tu Mercado Pago. Mientras tanto, tus clientes pueden transferirte la seña al alias o CBU de arriba.</span>`;
  }
}

async function disconnectMercadoPago() {
  if (!window.confirm("¿Desconectar Mercado Pago? Tus clientes ya no van a poder pagar la seña con tarjeta hasta que lo vuelvas a conectar.")) return;
  const data = await runAction("POST", "/api/mp/disconnect", null, "Mercado Pago desconectado.");
  if (data) renderMpConnectStatus();
}

function closeSettingsModal() {
  document.getElementById("settingsModal").classList.remove("open");
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const data = await safely(() =>
    api("PUT", "/api/workshop", {
      name: document.getElementById("setName").value,
      owner: document.getElementById("setOwner").value,
      phone: document.getElementById("setPhone").value,
      alias: document.getElementById("setAlias").value,
      cbu: document.getElementById("setCbu").value,
      defaultDepositPct: Number(document.getElementById("setDeposit").value),
      validityDays: Number(document.getElementById("setValidity").value)
    })
  );
  if (!data) return;
  appState = data.state;
  renderAll();
  closeSettingsModal();
  showToast("✓ Datos del negocio guardados.");
}

// ============================================================================
// MODAL DE EDICIÓN GENÉRICO (clientes y combos)
// ============================================================================
let editModalCtx = null;

function openEditModal({ title, fields, onSave, onDelete, deleteConfirm }) {
  editModalCtx = { onSave, onDelete, deleteConfirm };
  document.getElementById("editModalTitle").textContent = title;
  document.getElementById("editModalFields").innerHTML = fields
    .map(
      (f) => `
      <div>
        <label class="field-label" for="edit_${f.key}">${esc(f.label)}</label>
        ${
          f.type === "textarea"
            ? `<textarea id="edit_${f.key}" class="field-input" style="min-height: 70px;" maxlength="${f.max || 1000}">${esc(f.value)}</textarea>`
            : `<input id="edit_${f.key}" type="${f.type || "text"}" class="field-input ${f.mono ? "mono" : ""}" value="${esc(f.value)}" ${f.required ? "required" : ""} ${f.type === "number" ? 'min="0" step="any"' : ""} maxlength="${f.max || 200}" />`
        }
      </div>`
    )
    .join("");
  editModalCtx.keys = fields.map((f) => f.key);
  document.getElementById("editModalDelete").style.display = onDelete ? "" : "none";
  document.getElementById("editModal").classList.add("open");
}

function closeEditModal() {
  document.getElementById("editModal").classList.remove("open");
  editModalCtx = null;
}

async function handleEditModalSave(e) {
  e.preventDefault();
  if (!editModalCtx) return;
  const values = {};
  editModalCtx.keys.forEach((k) => (values[k] = document.getElementById(`edit_${k}`).value));
  const data = await safely(() => editModalCtx.onSave(values));
  if (!data) return;
  appState = data.state;
  renderAll();
  closeEditModal();
  showToast("✓ Cambios guardados.");
}

async function handleEditModalDelete() {
  if (!editModalCtx || !editModalCtx.onDelete) return;
  if (!window.confirm(editModalCtx.deleteConfirm || "¿Eliminar?")) return;
  const data = await safely(() => editModalCtx.onDelete());
  if (!data) return;
  appState = data.state;
  renderAll();
  closeEditModal();
  showToast("Eliminado.");
}

function openEditClient(clientId) {
  const c = appState.clients.find((cl) => cl.id === clientId);
  if (!c) return;
  openEditModal({
    title: "Editar cliente",
    fields: [
      { key: "name", label: "Nombre", value: c.name, required: true, max: 120 },
      { key: "phone", label: "Teléfono / WhatsApp", value: c.phone, type: "tel", mono: true, required: true, max: 40 },
      { key: "address", label: "Dirección / Obra", value: c.address },
      { key: "notes", label: "Notas internas (el cliente no las ve)", value: c.notes, type: "textarea" }
    ],
    onSave: (v) => api("PUT", `/api/clients/${encodeURIComponent(clientId)}`, v),
    onDelete: () => api("DELETE", `/api/clients/${encodeURIComponent(clientId)}`),
    deleteConfirm: `¿Eliminar a ${c.name} de la agenda? Sus presupuestos se conservan.`
  });
}

function openEditCatalogItem(itemId) {
  const it = appState.catalog.find((c) => c.id === itemId);
  if (!it) return;
  openEditModal({
    title: "Editar combo",
    fields: [
      { key: "title", label: "Nombre del combo", value: it.title, required: true, max: 150 },
      { key: "category", label: "Rubro", value: it.category, max: 60 },
      { key: "price", label: "Precio ($)", value: it.price, type: "number", mono: true, required: true },
      { key: "description", label: "Detalle incluido", value: it.description, type: "textarea", max: 500 }
    ],
    onSave: (v) => api("PUT", `/api/catalog/${encodeURIComponent(itemId)}`, { ...v, price: Number(v.price) }),
    onDelete: () => api("DELETE", `/api/catalog/${encodeURIComponent(itemId)}`),
    deleteConfirm: `¿Eliminar el combo "${it.title}"?`
  });
}

// Formateadores
function formatMoney(val) {
  return "$\u00a0" + Number(val || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function formatDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDayName(ts) {
  if (!ts) return "otro día";
  const d = new Date(ts);
  const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${days[d.getDay()]} ${d.getDate()}`;
}

function formatHoursAgo(ts) {
  if (!ts) return "Sin enviar";
  const diffH = Math.max(1, Math.round((Date.now() - ts) / (3600 * 1000)));
  if (diffH < 24) return `hace ${diffH} hs`;
  const days = Math.floor(diffH / 24);
  const remH = diffH % 24;
  return `hace ${days}d ${remH}hs (${diffH}hs)`;
}

function showToast(message) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast-msg";
  el.innerHTML = `<span>🐦</span> <span>${message}</span>`;
  container.innerHTML = "";
  container.appendChild(el);
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 3600);
}

// ============================================================================
// SELECTOR GLOBAL DE ROL (👷 Taller vs 👤 Cliente)
// ============================================================================
function switchRoleMode(mode, quoteCode = null) {
  activeRoleMode = mode;
  if (quoteCode) {
    selectedClientQuoteCode = quoteCode;
  } else if (!selectedClientQuoteCode && appState.quotes.length > 0) {
    selectedClientQuoteCode = appState.quotes[0].code;
  }

  const btnWorkshop = document.getElementById("roleBtnWorkshop");
  const btnClient = document.getElementById("roleBtnClient");
  const banner = document.getElementById("roleContextBanner");
  const workshopWrap = document.getElementById("workshopModeWrapper");
  const clientWrap = document.getElementById("clientModeWrapper");

  if (mode === "workshop") {
    btnWorkshop.className = "role-tab-btn active-workshop";
    btnClient.className = "role-tab-btn";
    banner.className = "role-context-banner workshop-mode";
    banner.innerHTML = `
      <span>
        <strong>👷 Estás en la Vista del Dueño del Negocio:</strong> Esta es tu app privada en el celular para crear presupuestos en 60 segundos, ver cuánta plata tenés en la calle y mandar recordatorios a las 48hs.
      </span>
    `;
    workshopWrap.style.display = "block";
    clientWrap.style.display = "none";
  } else {
    btnWorkshop.className = "role-tab-btn";
    btnClient.className = "role-tab-btn active-client";
    banner.className = "role-context-banner client-mode";
    banner.innerHTML = `
      <span>
        <strong>👤 Estás en la Vista del Cliente (que pidió presupuesto):</strong> Esto es lo único que ve tu cliente en su celular cuando abre el link que le enviaste por WhatsApp. Acá puede descargar el PDF o pagar la seña.
      </span>
    `;
    workshopWrap.style.display = "none";
    clientWrap.style.display = "block";
    renderInlineClientView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function selectClientPreviewQuote(code) {
  selectedClientQuoteCode = code;
  renderInlineClientView();
}

function selectClientGateway(gw) {
  selectedClientGateway = gw;
  renderInlineClientView();
}

function publicQuoteUrl(quote) {
  return `${window.location.origin}/p/${quote.publicId}`;
}

function renderInlineClientView() {
  const selector = document.getElementById("clientQuoteSelector");
  const container = document.getElementById("inlineClientQuoteContainer");
  if (!selector || !container) return;

  const quotes = appState.quotes || [];
  if (quotes.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay presupuestos creados todavía.</div>`;
    return;
  }

  let currentQuote = quotes.find((q) => q.code === selectedClientQuoteCode);
  if (!currentQuote) {
    currentQuote = quotes[0];
    selectedClientQuoteCode = currentQuote.code;
  }

  selector.innerHTML = quotes
    .map((q) => {
      const stateLabel =
        q.status === "approved"
          ? "✓ Señado"
          : q.status === "waiting_reply"
          ? "⏳ Pendiente"
          : "📝 Borrador";
      return `<option value="${esc(q.code)}" ${q.code === currentQuote.code ? "selected" : ""}>
        ${esc(q.code)} — ${esc(q.clientName)} (${formatMoney(q.total)} · ${stateLabel})
      </option>`;
    })
    .join("");

  const workshop = appState.workshop || {};
  const validUntil = new Date(
    (currentQuote.createdAt || Date.now()) + (currentQuote.validityDays || 7) * 86400000
  );
  const isApproved = currentQuote.status === "approved";

  const itemsRows = (currentQuote.items || [])
    .map(
      (it) => `
      <tr>
        <td><strong>${esc(it.title)}</strong></td>
        <td class="num">${it.qty}</td>
        <td class="num">${formatMoney(it.unitPrice)}</td>
        <td class="num"><strong>${formatMoney(it.total)}</strong></td>
      </tr>
    `
    )
    .join("");

  const cleanWorkshopPhone = (workshop.phone || "").replace(/\D/g, "");
  const waQuestionUrl = `https://wa.me/${cleanWorkshopPhone}?text=${encodeURIComponent(
    `Hola ${workshop.owner}, estoy viendo el presupuesto ${currentQuote.code} (${currentQuote.serviceSummary}) y quería hacerte una consulta.`
  )}`;

  container.innerHTML = `
    <article class="remito-sheet">
      <!-- Membrete Oficial del Negocio que ve el cliente -->
      <header class="remito-letterhead">
        <div class="remito-brand">
          <img src="/assets/coti-badge.jpg" alt="Sello Coti" class="remito-stamp" />
          <div>
            <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; color: #1E4D3B;">
              Presupuesto Oficial de Servicio
            </div>
            <h1 style="font-size: 1.2rem; font-weight: 800;">${esc(workshop.name || "Negocio")}</h1>
            <div style="font-size: 0.82rem; color: #4A4843;">
              Resp: ${esc(workshop.owner)} · WhatsApp ${esc(workshop.phone)}
            </div>
          </div>
        </div>
        <div class="remito-code-box">
          <span class="remito-code-tag">${esc(currentQuote.code)}</span>
          <div style="font-size: 0.75rem; color: #4A4843; margin-top: 6px;">
            Emitido: ${formatDate(currentQuote.createdAt)}
          </div>
          <div style="font-size: 0.75rem; color: #92400E; font-weight: 700;">
            Válido hasta: ${formatDate(validUntil)}
          </div>
        </div>
      </header>

      <!-- Datos del Cliente -->
      <section class="remito-section">
        <div class="remito-grid-2">
          <div>
            <div class="remito-field-label">Preparado para (Cliente)</div>
            <div class="remito-field-val">${esc(currentQuote.clientName)}</div>
            <div style="font-size: 0.82rem; color: #4A4843;">${esc(currentQuote.clientPhone)}</div>
          </div>
          <div>
            <div class="remito-field-label">Domicilio / Obra</div>
            <div class="remito-field-val">${esc(currentQuote.clientAddress || "A coordinar")}</div>
          </div>
        </div>
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #EAE6DC;">
          <div class="remito-field-label">Trabajo Solicitado</div>
          <div class="remito-field-val">${esc(currentQuote.serviceSummary)}</div>
        </div>
      </section>

      <!-- Detalle de Ítems -->
      <section class="remito-section">
        <div class="remito-field-label">Detalle de Mano de Obra y Materiales</div>
        <table class="items-table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th class="num">Cant.</th>
              <th class="num">Unitario</th>
              <th class="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
      </section>

      <!-- Totales y Seña -->
      <section class="totals-box">
        <div class="total-row grand">
          <span>VALOR TOTAL DEL TRABAJO</span>
          <span class="mono">${formatMoney(currentQuote.total)}</span>
        </div>
        <div class="deposit-highlight">
          <div>
            <div style="font-size: 0.78rem; text-transform: uppercase;">
              Seña para congelar precio y agendar turno (${currentQuote.depositPct}%)
            </div>
            <div style="font-size: 0.8rem; font-weight: 500; color: #1A1A1A;">
              El saldo restante (${formatMoney(currentQuote.total - currentQuote.depositAmount)}) se abona al finalizar el trabajo.
            </div>
          </div>
          <div class="mono" style="font-size: 1.3rem;">${formatMoney(currentQuote.depositAmount)}</div>
        </div>
      </section>

      <!-- Acción Principal del Cliente: Aceptar y Señar -->
      <section class="payment-area">
        ${
          isApproved
            ? `
          <div class="approved-stamp-box">
            <div style="font-size: 1.25rem; font-weight: 800; margin-bottom: 4px;">
              ✓ PRESUPUESTO ACEPTADO Y SEÑADO POR EL CLIENTE
            </div>
            <div style="font-size: 0.9rem;">
              Seña de <strong>${formatMoney(currentQuote.depositAmount)}</strong> abonada con <strong>${esc(currentQuote.paymentMethod || "Mercado Pago")}</strong> el ${formatDate(currentQuote.approvedAt)}.
            </div>
            <div style="margin-top: 12px;" class="no-print">
              <button type="button" class="btn btn-primary" onclick="goBackToWorkshopApproved()">
                👷 Ver en el Tablero del Negocio ("Listas / Seña Pagada") →
              </button>
            </div>
          </div>
        `
            : `
          <div class="preview-note no-print">
            👁️ <strong>Vista previa.</strong> Acá tu cliente ve el botón <em>"Aceptar presupuesto y señar ${formatMoney(currentQuote.depositAmount)}"</em>
            ${workshop.alias || workshop.cbu ? "y tus datos de transferencia" : "(cargá tu alias o CBU en ⚙️ Mi negocio para que también pueda transferirte)"}.
            El pago solo se hace desde el link real.
          </div>
        `
        }

        <div class="quote-actions no-print" style="margin-top: 14px;">
          <a href="${esc(publicQuoteUrl(currentQuote))}" target="_blank" rel="noopener" class="btn btn-primary">
            🔗 Abrir el link real del cliente
          </a>
          <button type="button" class="btn btn-secondary" onclick="window.print()">
            📄 Descargar PDF / Imprimir con membrete
          </button>
          <a href="${waQuestionUrl}" target="_blank" rel="noopener" class="btn btn-secondary">
            💬 Hacerle una pregunta al negocio por WhatsApp
          </a>
        </div>
      </section>
    </article>
  `;
}

function goBackToWorkshopApproved() {
  activeInboxTab = "approved";
  switchRoleMode("workshop");
  renderAll();
}

// ============================================================================
// CARGA DE ESTADO Y VISTA DEL NEGOCIO
// ============================================================================
async function fetchAppState() {
  try {
    appState = await api("GET", "/api/state");
    showApp();
    renderAll();
  } catch (err) {
    if (!err.authRequired) {
      console.error(err);
      showToast("⚠️ No se pudo cargar el tablero. Revisá tu conexión.");
    }
  }
}

// Ejecuta una acción del panel que devuelve { state } y re-renderiza.
async function runAction(method, url, body, okMessage) {
  const data = await safely(() => api(method, url, body));
  if (!data) return null;
  if (data.state) appState = data.state;
  else if (data.quotes) appState = data;
  renderAll();
  if (okMessage) showToast(okMessage);
  return data;
}

function renderAll() {
  renderHeaderAndMetrics();
  renderCotiAssistantBar();
  renderInboxBoard();
  renderClientsSection();
  renderCatalogSection();
  if (activeRoleMode === "client") {
    renderInlineClientView();
  }
}

function renderHeaderAndMetrics() {
  const { workshop, metrics, clients, catalog } = appState;
  const wsEl = document.getElementById("workshopHeaderName");
  if (wsEl && workshop.name) {
    wsEl.textContent = `${workshop.name} · Resp: ${workshop.owner}`;
  }

  const trialEl = document.getElementById("trialPill");
  if (trialEl && workshop.trialEndsAt) {
    const daysLeft = Math.ceil((workshop.trialEndsAt - Date.now()) / 86400000);
    trialEl.style.display = "";
    trialEl.classList.toggle("ending", daysLeft <= 3);
    trialEl.textContent = daysLeft > 0 ? `Prueba: ${daysLeft} día(s)` : "Prueba terminada";
  }

  document.getElementById("metricStreet").textContent = formatMoney(metrics.dineroEnLaCalle);
  document.getElementById("metricStreetSub").textContent =
    `${metrics.counts.waiting_reply} presupuesto(s) esperando respuesta`;

  document.getElementById("metricClosed").textContent = formatMoney(metrics.cerradosEsteMes);
  document.getElementById("metricClosedSub").textContent =
    `Señas cobradas: ${formatMoney(metrics.senasCobradas)}`;

  document.getElementById("metricConversion").textContent = `${metrics.tasaConversion}%`;
  document.getElementById("metricConversionSub").textContent =
    `${metrics.counts.approved} de ${metrics.counts.sentOrClosed} enviados se aprobaron`;
  document.getElementById("metricClosedSub").textContent =
    `${metrics.counts.approvedThisMonth} trabajo(s) · Señas: ${formatMoney(metrics.senasCobradas)}`;

  document.getElementById("navClientsCount").textContent = clients.length;
  document.getElementById("navCatalogCount").textContent = catalog.length;

  document.getElementById("countWaiting").textContent = metrics.counts.waiting_reply;
  document.getElementById("countDraft").textContent = metrics.counts.draft;
  document.getElementById("countApproved").textContent = metrics.counts.approved;

  document.getElementById("tabWaiting").classList.toggle("active", activeInboxTab === "waiting_reply");
  document.getElementById("tabDraft").classList.toggle("active", activeInboxTab === "draft");
  document.getElementById("tabApproved").classList.toggle("active", activeInboxTab === "approved");
}

function renderCotiAssistantBar() {
  const bar = document.getElementById("cotiAssistantBar");
  const speech = document.getElementById("cotiSpeechText");
  const action = document.getElementById("cotiAssistantAction");

  const now = Date.now();
  const overdueQuotes = appState.quotes.filter(
    (q) => q.status === "waiting_reply" && q.sentAt && now - q.sentAt >= HOUR_48_MS
  );

  if (overdueQuotes.length > 0) {
    const overdueSum = overdueQuotes.reduce((acc, q) => acc + Number(q.total || 0), 0);
    bar.classList.add("has-alerts");
    speech.innerHTML = `
      <strong>¡Atención!</strong> Tenés <strong>${overdueQuotes.length} cliente(s)</strong> que recibieron presupuesto hace más de 48 horas y todavía no respondieron (<span class="mono">${formatMoney(overdueSum)}</span> en juego).
    `;
    action.innerHTML = `
      <button type="button" class="btn btn-amber" onclick="focusOverdueQuotes()">
        ⏰ Filtrar los ${overdueQuotes.length} de +48hs
      </button>
    `;
  } else {
    bar.classList.remove("has-alerts");
    speech.innerHTML = `
      <strong>Coti al día:</strong> Ningún presupuesto lleva más de 48hs colgado sin seguimiento. ¡Buen ritmo de obra!
    `;
    action.innerHTML = `
      <button type="button" class="btn btn-ghost" onclick="openNewQuoteModal()">
        + Cotizar rápido
      </button>
    `;
  }
}

function focusOverdueQuotes() {
  switchMainSection("board");
  activeInboxTab = "waiting_reply";
  onlyOverdueFilter = !onlyOverdueFilter;
  renderAll();
  if (onlyOverdueFilter) {
    showToast("Mostrando solo presupuestos con +48hs sin respuesta");
  }
}

function switchMainSection(section) {
  activeMainSection = section;
  document.getElementById("navBoard").classList.toggle("active", section === "board");
  document.getElementById("navClients").classList.toggle("active", section === "clients");
  document.getElementById("navCatalog").classList.toggle("active", section === "catalog");

  document.getElementById("sectionBoard").classList.toggle("active", section === "board");
  document.getElementById("sectionClients").classList.toggle("active", section === "clients");
  document.getElementById("sectionCatalog").classList.toggle("active", section === "catalog");
}

function setInboxTab(tab) {
  activeInboxTab = tab;
  onlyOverdueFilter = false;
  renderAll();
}

function handleSearch(val) {
  searchQuery = (val || "").trim().toLowerCase();
  renderAll();
}

function matchesSearch(quote) {
  if (!searchQuery) return true;
  const haystack = [
    quote.code,
    quote.clientName,
    quote.clientPhone,
    quote.clientAddress,
    quote.serviceSummary
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(searchQuery);
}

// Construcción de enlaces profundos a WhatsApp (wa.me/)
function buildInitialWhatsAppLink(quote) {
  const cleanPhone = (quote.clientPhone || "").replace(/\D/g, "");
  const publicUrl = publicQuoteUrl(quote);
  const firstName = (quote.clientName || "Cliente").split(" ")[0];
  const text = `Hola ${firstName}, ¿cómo estás? Te paso el presupuesto formal (${quote.code}) por *${quote.serviceSummary}*.\n\n📄 Podés ver el detalle completo, descargar el PDF o confirmar el turno abonando la seña (${formatMoney(quote.depositAmount)}) directo desde este link:\n${publicUrl}\n\nCualquier consulta avisame. ¡Saludos!`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

function build48hReminderMessage(quote) {
  const firstName = (quote.clientName || "Cliente").split(" ")[0];
  const sentDay = formatDayName(quote.sentAt || quote.createdAt);
  return `Hola ${firstName}, ¿cómo estás? Te consulto si pudiste revisar el presupuesto que te pasé el ${sentDay} o si tenés alguna duda sobre los materiales.`;
}

function build48hWhatsAppLink(quote) {
  const cleanPhone = (quote.clientPhone || "").replace(/\D/g, "");
  const publicUrl = publicQuoteUrl(quote);
  const msg = `${build48hReminderMessage(quote)}\n\nTe dejo a mano el link directo al presupuesto ${quote.code}: ${publicUrl}`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

// Renderizado del Tablero "Inbox Zero" del Dueño del Negocio
function renderInboxBoard() {
  const container = document.getElementById("quotesListContainer");
  const now = Date.now();

  let list = appState.quotes.filter(
    (q) => q.status === activeInboxTab && matchesSearch(q)
  );

  if (activeInboxTab === "waiting_reply" && onlyOverdueFilter) {
    list = list.filter((q) => q.sentAt && now - q.sentAt >= HOUR_48_MS);
  }

  if (activeInboxTab === "waiting_reply") {
    list.sort((a, b) => {
      const aOver = a.sentAt && now - a.sentAt >= HOUR_48_MS ? 1 : 0;
      const bOver = b.sentAt && now - b.sentAt >= HOUR_48_MS ? 1 : 0;
      if (aOver !== bOver) return bOver - aOver;
      return (a.sentAt || 0) - (b.sentAt || 0);
    });
  }

  if (list.length === 0) {
    const emptyMessages = {
      waiting_reply: {
        title: "Todo al día en la calle",
        desc: "No tenés presupuestos colgados esperando respuesta en esta vista. Cuando envíes uno nuevo, Coti vigilará las 48 horas por vos."
      },
      draft: {
        title: "Bandeja 'Por Enviar' en cero (Inbox Zero)",
        desc: "Todas las consultas que entraron ya fueron cotizadas y enviadas. Tocá '+ Cotizar Flash' si entró un pedido nuevo por WhatsApp."
      },
      approved: {
        title: "Aún no hay señas confirmadas con este filtro",
        desc: "Cuando un cliente abra su link y toque 'Aceptar y señar', el trabajo aparecerá confirmado en esta columna."
      }
    };
    const msg = emptyMessages[activeInboxTab];
    container.innerHTML = `
      <div class="empty-state">
        <img src="/assets/coti-mascot.jpg" alt="Coti el Hornero" class="empty-mascot" />
        <div class="empty-title">${msg.title}</div>
        <div class="empty-desc">${msg.desc}</div>
        <button type="button" class="btn btn-primary" onclick="openNewQuoteModal()">
          + Crear Cotización Flash en 60s
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = list
    .map((q) => {
      const isOverdue48h =
        q.status === "waiting_reply" && q.sentAt && now - q.sentAt >= HOUR_48_MS;
      const reminderText = build48hReminderMessage(q);
      const waReminderHref = build48hWhatsAppLink(q);
      const waInitialHref = buildInitialWhatsAppLink(q);

      let badgeHtml = "";
      if (q.status === "draft") {
        badgeHtml = `<span class="badge-status badge-draft">📝 Borrador sin enviar</span>`;
      } else if (isOverdue48h) {
        badgeHtml = `<span class="badge-status badge-overdue">⏰ +48hs sin respuesta (${formatHoursAgo(q.sentAt)})</span>`;
      } else if (q.status === "waiting_reply") {
        badgeHtml = `<span class="badge-status badge-waiting">⏳ Enviado al cliente ${formatHoursAgo(q.sentAt)}</span>`;
      } else if (q.status === "approved") {
        badgeHtml = `<span class="badge-status badge-approved">✓ Seña Pagada por el cliente (${esc(q.paymentMethod || "Confirmado")})</span>`;
      }

      const itemsSummaryHtml = (q.items || [])
        .map(
          (it) =>
            `<span style="display:inline-block; background: var(--bg-subtle); border: 1px solid var(--border-crisp); border-radius: 4px; padding: 2px 8px; font-size: 0.78rem; margin-right: 6px; margin-bottom: 4px;">${it.qty}x ${esc(it.title)} (<strong class="mono">${formatMoney(it.total)}</strong>)</span>`
        )
        .join("");

      return `
        <article class="quote-card ${isOverdue48h ? "overdue-48h" : ""} ${q.status === "approved" ? "status-approved" : ""}">
          <div class="quote-header">
            <div class="quote-meta-left">
              <div class="quote-code-row">
                <span class="quote-code">${esc(q.code)}</span>
                ${badgeHtml}
                ${
                  q.remindedAt
                    ? `<span class="badge-status" style="background:#E5EFEA; color:#1E4D3B; border:1px solid #1E4D3B;">✓ Recordatorio enviado</span>`
                    : ""
                }
              </div>
              <h3 class="client-name">Cliente: ${esc(q.clientName)}</h3>
              <div class="client-sub">
                <span class="mono">📞 ${esc(q.clientPhone)}</span>
                ${q.clientAddress ? `<span>📍 ${esc(q.clientAddress)}</span>` : ""}
              </div>
            </div>

            <div class="quote-price-box">
              <div class="quote-total">${formatMoney(q.total)}</div>
              <div class="quote-deposit">Seña pedida (${q.depositPct}%): ${formatMoney(q.depositAmount)}</div>
            </div>
          </div>

          <div class="quote-summary">${esc(q.serviceSummary)}</div>
          <div style="margin-bottom: 10px;">${itemsSummaryHtml}</div>

          ${
            q.voiceTranscript
              ? `<div class="voice-note-pill">🎙️ <strong>Tu nota de voz:</strong> "${esc(q.voiceTranscript)}"</div>`
              : ""
          }

          ${
            q.status === "waiting_reply" && q.transferReportedAt
              ? `
            <div class="transfer-alert">
              🏦 <strong>${esc(q.clientName.split(" ")[0])} avisó que te transfirió la seña</strong> (${formatHoursAgo(q.transferReportedAt)}).
              Revisá tu cuenta y confirmalo para pasarlo a "Listas / Seña Pagada".
              <div class="quote-actions">
                <button type="button" class="btn btn-primary" onclick="confirmPayment('${q.id}', 'Transferencia Bancaria')">
                  ✓ Ya me llegó la transferencia
                </button>
              </div>
            </div>
          `
              : ""
          }

          ${
            isOverdue48h
              ? `
            <!-- EL SUPERPODER: EL BOTÓN DE LAS 48 HORAS (Acción del Dueño del Negocio) -->
            <div class="superpower-48h-box">
              <div class="superpower-header">
                <span>⚡ PASARON +48 HORAS SIN RESPUESTA DEL CLIENTE</span>
                <span class="mono">${formatHoursAgo(q.sentAt)}</span>
              </div>
              <div class="superpower-preview">
                Mensaje listo para enviarle: "${reminderText}"
              </div>
              <a
                href="${waReminderHref}"
                target="_blank"
                rel="noopener"
                class="btn btn-amber btn-block"
                onclick="markReminded('${q.id}')"
              >
                📲 Mandar recordatorio por WhatsApp a ${esc(q.clientName.split(" ")[0])}
              </a>
            </div>
          `
              : ""
          }

          <!-- Acciones Reales del Dueño del Negocio -->
          <div class="quote-actions">
            ${
              q.status === "draft"
                ? `
              <a
                href="${waInitialHref}"
                target="_blank"
                rel="noopener"
                class="btn btn-primary"
                onclick="markQuoteSent('${q.id}')"
              >
                📲 Enviar Presupuesto por WhatsApp
              </a>
            `
                : ""
            }

            ${
              q.status === "approved"
                ? `
              <a
                href="https://wa.me/${(q.clientPhone || "").replace(/\D/g, "")}?text=${encodeURIComponent(
                  `Hola ${(q.clientName || "").split(" ")[0]}, ¡recibimos tu seña del presupuesto ${q.code}! Coordinemos día y horario para ir a realizar el trabajo.`
                )}"
                target="_blank"
                rel="noopener"
                class="btn btn-primary"
              >
                🛠️ Coordinar Fecha de Visita por WhatsApp
              </a>
            `
                : ""
            }

            <button
              type="button"
              class="btn btn-secondary"
              onclick="switchRoleMode('client', '${q.code}')"
            >
              👤 Ver cómo lo ve ${esc(q.clientName.split(" ")[0])} (Vista Cliente)
            </button>

            ${
              q.status === "waiting_reply" && !q.transferReportedAt
                ? `
              <button type="button" class="btn btn-ghost" onclick="confirmPayment('${q.id}', 'Efectivo')" title="Si te pagó la seña en mano o por otro medio">
                💵 Marcar seña cobrada
              </button>
            `
                : ""
            }
          </div>

          ${
            appConfig.demoTools && q.status === "waiting_reply" && !isOverdue48h
              ? `
            <div class="demo-lab-strip">
              <span>🧪 <strong>Atajo de demostración:</strong> ¿Querés ver cómo se activa la alerta amarilla de las 48hs en esta tarjeta?</span>
              <button type="button" class="demo-lab-btn" onclick="simulate48Hours('${q.id}')">
                ⏩ Adelantar reloj +48hs
              </button>
            </div>
          `
              : ""
          }
        </article>
      `;
    })
    .join("");
}

// Acciones de API sobre las tarjetas
async function markQuoteSent(quoteId) {
  activeInboxTab = "waiting_reply";
  await runAction("POST", `/api/quotes/${encodeURIComponent(quoteId)}/send`, null, "Presupuesto enviado al cliente. Coti activó el reloj de 48hs.");
}

async function simulate48Hours(quoteId) {
  await runAction("POST", `/api/quotes/${encodeURIComponent(quoteId)}/age48h`, null, "⏰ ¡Reloj adelantado +48hs! Mirá cómo se activó el botón ámbar de recordatorio.");
}

async function markReminded(quoteId) {
  await runAction("POST", `/api/quotes/${encodeURIComponent(quoteId)}/remind`, null, "📲 Abriendo WhatsApp con el recordatorio empático de las 48hs...");
}

async function confirmPayment(quoteId, method) {
  const q = appState.quotes.find((x) => x.id === quoteId);
  const label = method === "Efectivo" ? "cobrada en mano / otro medio" : "recibida por transferencia";
  if (!window.confirm(`¿Confirmás la seña de ${q ? formatMoney(q.depositAmount) : ""} ${label}?`)) return;
  const data = await runAction("POST", `/api/quotes/${encodeURIComponent(quoteId)}/confirm-payment`, { method }, "✓ Seña confirmada. El trabajo pasó a 'Listas / Seña Pagada'.");
  if (data) {
    activeInboxTab = "approved";
    renderAll();
  }
}

// ============================================================================
// MÓDULO A: AGENDA DE CLIENTES E HISTORIAL
// ============================================================================
function renderClientsSection() {
  const container = document.getElementById("clientsListContainer");
  if (!container) return;

  const filteredClients = appState.clients.filter((c) => {
    if (!searchQuery) return true;
    return `${c.name} ${c.phone} ${c.address} ${c.notes}`.toLowerCase().includes(searchQuery);
  });

  if (filteredClients.length === 0) {
    container.innerHTML = `<div class="empty-state">No se encontraron clientes con ese criterio.</div>`;
    return;
  }

  container.innerHTML = filteredClients
    .map((client) => {
      const clientQuotes = appState.quotes.filter(
        (q) =>
          q.clientId === client.id ||
          (q.clientPhone || "").replace(/\D/g, "") === (client.phone || "").replace(/\D/g, "")
      );
      const totalQuoted = clientQuotes.reduce((acc, q) => acc + Number(q.total || 0), 0);

      const historyPills = clientQuotes
        .map(
          (q) => `
          <div
            onclick="switchRoleMode('client', '${esc(q.code)}')"
            style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; color:var(--ink-primary); background:var(--bg-bone); border:1px solid var(--border-crisp); padding:8px 10px; border-radius:4px; margin-top:6px; font-size:0.84rem;"
          >
            <span><strong class="mono">${esc(q.code)}</strong> · ${esc(q.serviceSummary)}</span>
            <span class="mono" style="font-weight:800;">${formatMoney(q.total)} (${q.status === "approved" ? "✓ Señado" : q.status === "waiting_reply" ? "⏳ En espera" : "📝 Borrador"})</span>
          </div>
        `
        )
        .join("");

      return `
        <div class="panel-card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
            <div>
              <h3 style="font-size:1.08rem; font-weight:800;">${esc(client.name)}</h3>
              <div class="mono" style="font-size:0.85rem; color:var(--ink-secondary);">📞 ${esc(client.phone)}</div>
              <div style="font-size:0.84rem; color:var(--ink-secondary);">📍 ${esc(client.address || "Sin dirección")}</div>
              ${client.notes ? `<div style="font-size:0.8rem; color:var(--ink-muted); margin-top:4px;">Nota: ${esc(client.notes)}</div>` : ""}
            </div>
            <div style="text-align:right;">
              <div class="mono" style="font-size:1rem; font-weight:800;">Total cotizado: ${formatMoney(totalQuoted)}</div>
              <button type="button" class="btn btn-secondary" style="margin-top:8px; min-height:40px; padding:6px 12px;" onclick="openNewQuoteForClient('${client.id}')">
                + Nueva Cotización a ${esc(client.name.split(" ")[0])}
              </button>
              <button type="button" class="btn btn-ghost" style="margin-top:8px; min-height:40px; padding:6px 12px;" onclick="openEditClient('${client.id}')">
                ✏️ Editar
              </button>
            </div>
          </div>
          <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-crisp);">
            <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--ink-muted);">
              Historial de cotizaciones (${clientQuotes.length})
            </div>
            ${historyPills || `<div style="font-size:0.82rem; color:var(--ink-muted); margin-top:4px;">Sin presupuestos todavía.</div>`}
          </div>
        </div>
      `;
    })
    .join("");
}

// ============================================================================
// MÓDULO B: CATÁLOGO DE COMBOS PREESTABLECIDOS
// ============================================================================
function renderCatalogSection() {
  const container = document.getElementById("catalogListContainer");
  if (!container) return;

  if (appState.catalog.length === 0) {
    container.innerHTML = `<div class="empty-state">Todavía no guardaste combos. Cargá tus 5 trabajos más pedidos y cotizalos en 1 toque.</div>`;
    return;
  }

  container.innerHTML = appState.catalog
    .map(
      (item) => `
      <div class="panel-card" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div style="flex:1; min-width:220px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span class="quote-code">${esc(item.category)}</span>
            <h3 style="font-size:1rem; font-weight:800;">${esc(item.title)}</h3>
          </div>
          <p style="font-size:0.84rem; color:var(--ink-secondary);">${esc(item.description)}</p>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="mono" style="font-size:1.25rem; font-weight:800; color:var(--forest);">${formatMoney(item.price)}</span>
          <button type="button" class="btn btn-secondary" style="min-height:42px; padding:6px 12px;" onclick="useComboInFlashQuote('${item.id}')">
            ⚡ Usar en Cotización
          </button>
          <button type="button" class="btn btn-ghost" style="min-height:42px;" onclick="openEditCatalogItem('${item.id}')" title="Editar o eliminar combo">
            ✏️ Editar
          </button>
        </div>
      </div>
    `
    )
    .join("");
}

async function handleAddCatalogItem(e) {
  e.preventDefault();
  const title = document.getElementById("catTitle").value.trim();
  const category = document.getElementById("catCategory").value.trim() || "Oficio";
  const price = Number(document.getElementById("catPrice").value);
  const description = document.getElementById("catDesc").value.trim();

  if (!title || !price) return;

  const data = await runAction("POST", "/api/catalog", { title, category, price, description }, "✓ Combo guardado en el catálogo.");
  if (data) {
    document.getElementById("catTitle").value = "";
    document.getElementById("catCategory").value = "";
    document.getElementById("catPrice").value = "";
    document.getElementById("catDesc").value = "";
  }
}

// ============================================================================
// FLUJO CENTRAL PASO 1: MODAL DE COTIZACIÓN FLASH EN 3 CLICS (15 SEGUNDOS)
// ============================================================================
function openNewQuoteModal(prefillClient = null, prefillCombo = null) {
  const modal = document.getElementById("newQuoteModal");
  modal.classList.add("open");

  document.getElementById("fqClientName").value = prefillClient ? prefillClient.name : "";
  document.getElementById("fqClientPhone").value = prefillClient ? prefillClient.phone : "";
  document.getElementById("fqClientAddress").value = prefillClient ? prefillClient.address : "";
  document.getElementById("fqVoiceTranscript").value = "";

  if (prefillCombo) {
    draftItems = [{ title: prefillCombo.title, qty: 1, unitPrice: prefillCombo.price }];
    document.getElementById("fqServiceSummary").value = prefillCombo.title;
  } else if (appState.catalog.length > 0) {
    const first = appState.catalog[0];
    draftItems = [{ title: first.title, qty: 1, unitPrice: first.price }];
    document.getElementById("fqServiceSummary").value = first.title;
  } else {
    draftItems = [{ title: "Servicio técnico a domicilio", qty: 1, unitPrice: 250000 }];
    document.getElementById("fqServiceSummary").value = "Servicio técnico a domicilio";
  }

  draftDepositPct = appState.workshop.defaultDepositPct ?? 40;
  [30, 40, 50].forEach((p) => document.getElementById(`depBtn${p}`).classList.toggle("selected", p === draftDepositPct));
  renderFlashQuoteModalParts();
}

function closeNewQuoteModal() {
  document.getElementById("newQuoteModal").classList.remove("open");
}

function openNewQuoteForClient(clientId) {
  const client = appState.clients.find((c) => c.id === clientId);
  openNewQuoteModal(client, null);
}

function useComboInFlashQuote(comboId) {
  const combo = appState.catalog.find((c) => c.id === comboId);
  openNewQuoteModal(null, combo);
}

function renderFlashQuoteModalParts() {
  const clientChipsEl = document.getElementById("clientQuickChips");
  clientChipsEl.innerHTML = appState.clients
    .map(
      (c) => `
      <button type="button" class="chip-btn" onclick="selectClientChip('${c.id}')">
        👤 ${esc(c.name)}
      </button>
    `
    )
    .join("");

  const comboListEl = document.getElementById("modalComboList");
  comboListEl.innerHTML = appState.catalog
    .slice(0, 5)
    .map(
      (cat) => `
      <button type="button" class="combo-pick-btn" onclick="pickComboInModal('${cat.id}')">
        <div>
          <div class="combo-pick-title">${esc(cat.title)}</div>
          <div style="font-size: 0.76rem; color: var(--ink-secondary);">${esc(cat.category)}</div>
        </div>
        <span class="combo-pick-price">+ ${formatMoney(cat.price)}</span>
      </button>
    `
    )
    .join("");

  const addonChipsEl = document.getElementById("addonQuickChips");
  addonChipsEl.innerHTML = (appState.quickAddons || [])
    .map(
      (add) => `
      <button type="button" class="chip-btn" onclick="addQuickAddon('${add.id}')">
        ${esc(add.label)} (${formatMoney(add.price)})
      </button>
    `
    )
    .join("");

  renderDraftItemsList();
}

function selectClientChip(clientId) {
  const c = appState.clients.find((cl) => cl.id === clientId);
  if (!c) return;
  document.getElementById("fqClientName").value = c.name;
  document.getElementById("fqClientPhone").value = c.phone;
  document.getElementById("fqClientAddress").value = c.address || "";
  showToast(`Autocompletado: ${c.name}`);
}

function pickComboInModal(comboId) {
  const cat = appState.catalog.find((c) => c.id === comboId);
  if (!cat) return;
  if (draftItems.length === 1 && draftItems[0].qty === 1) {
    draftItems = [{ title: cat.title, qty: 1, unitPrice: cat.price }];
    document.getElementById("fqServiceSummary").value = cat.title;
  } else {
    draftItems.push({ title: cat.title, qty: 1, unitPrice: cat.price });
    document.getElementById("fqServiceSummary").value = draftItems.map((i) => i.title).join(" + ");
  }
  renderDraftItemsList();
}

function addQuickAddon(addonId) {
  const add = (appState.quickAddons || []).find((a) => a.id === addonId);
  if (!add) return;
  draftItems.push({ title: add.title, qty: 1, unitPrice: add.price });
  renderDraftItemsList();
}

function addBlankItemRow() {
  draftItems.push({ title: "Ítem adicional", qty: 1, unitPrice: 50000 });
  renderDraftItemsList();
}

function updateDraftItem(idx, field, val) {
  if (!draftItems[idx]) return;
  if (field === "title") {
    draftItems[idx].title = val;
  } else if (field === "qty") {
    draftItems[idx].qty = Math.max(1, Number(val) || 1);
  } else if (field === "unitPrice") {
    draftItems[idx].unitPrice = Math.max(0, Number(val) || 0);
  }
  updateDraftTotalsOnly();
}

function removeDraftItem(idx) {
  draftItems.splice(idx, 1);
  if (draftItems.length === 0) {
    draftItems.push({ title: "Mano de obra", qty: 1, unitPrice: 100000 });
  }
  renderDraftItemsList();
}

function setDepositPct(pct) {
  draftDepositPct = pct;
  document.getElementById("depBtn30").classList.toggle("selected", pct === 30);
  document.getElementById("depBtn40").classList.toggle("selected", pct === 40);
  document.getElementById("depBtn50").classList.toggle("selected", pct === 50);
  updateDraftTotalsOnly();
}

function renderDraftItemsList() {
  const container = document.getElementById("fqItemsList");
  container.innerHTML = draftItems
    .map(
      (it, idx) => `
      <div class="quote-item-row">
        <input
          type="text"
          value="${esc(it.title)}"
          placeholder="Concepto"
          oninput="updateDraftItem(${idx}, 'title', this.value)"
        />
        <input
          type="number"
          class="mono"
          min="1"
          value="${it.qty}"
          title="Cantidad"
          oninput="updateDraftItem(${idx}, 'qty', this.value)"
        />
        <input
          type="number"
          class="mono"
          min="0"
          value="${it.unitPrice}"
          title="Precio unitario ($)"
          oninput="updateDraftItem(${idx}, 'unitPrice', this.value)"
        />
        <button type="button" class="remove-item-btn" onclick="removeDraftItem(${idx})" title="Quitar ítem">
          ✕
        </button>
      </div>
    `
    )
    .join("");

  updateDraftTotalsOnly();
}

function updateDraftTotalsOnly() {
  const total = draftItems.reduce(
    (sum, it) => sum + (Number(it.qty) || 1) * (Number(it.unitPrice) || 0),
    0
  );
  const deposit = Math.round((total * draftDepositPct) / 100);
  document.getElementById("fqGrandTotal").textContent = formatMoney(total);
  document.getElementById("fqDepositTotal").textContent = `${formatMoney(deposit)} (${draftDepositPct}%)`;
}

function simulateWorkshopVoiceNote() {
  const samples = [
    {
      transcript: "Instalar equipo Split Inverter 4500 frigorías en primer piso con 4 metros de cañería de cobre y soporte exterior inoxidable.",
      summary: "Instalación Split Inverter 4500fg + 4m cañería cobre",
      items: [
        { title: "Instalación equipo Inverter 4500/6000 fg", qty: 1, unitPrice: 380000 },
        { title: "Metro adicional de cañería frigorífica + aislación", qty: 4, unitPrice: 45000 },
        { title: "Materiales y repuestos (ménsulas inox)", qty: 1, unitPrice: 85000 }
      ]
    },
    {
      transcript: "Colocar dos ventanas balcón Módena con vidrio doble DVH en obra de Belgrano, incluyendo desmonte de marcos viejos y flete.",
      summary: "Provisión y colocación 2 ventanales Módena DVH + desmonte",
      items: [
        { title: "Colocación de abertura aluminio Módena DVH", qty: 2, unitPrice: 640000 },
        { title: "Mano de obra adicional en obra (desmonte)", qty: 1, unitPrice: 95000 },
        { title: "Traslado de equipos y logística a domicilio", qty: 1, unitPrice: 40000 }
      ]
    }
  ];
  const pick = samples[Math.floor(Math.random() * samples.length)];
  document.getElementById("fqVoiceTranscript").value = pick.transcript;
  document.getElementById("fqServiceSummary").value = pick.summary;
  draftItems = pick.items;
  renderDraftItemsList();
  showToast("🎙️ Nota de voz transcrita e ítems precargados automáticamente.");
}

function toggleVoiceDictation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById("voiceRecordBtn");
  if (!SpeechRecognition) {
    simulateWorkshopVoiceNote();
    return;
  }

  if (isRecordingVoice && speechRecognizer) {
    speechRecognizer.stop();
    isRecordingVoice = false;
    btn.textContent = "🎤 Dictar voz";
    return;
  }

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.lang = "es-AR";
  speechRecognizer.interimResults = false;

  speechRecognizer.onstart = () => {
    isRecordingVoice = true;
    btn.textContent = "⏹️ Escuchando...";
  };

  speechRecognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const area = document.getElementById("fqVoiceTranscript");
    area.value = (area.value ? area.value + " " : "") + transcript;
    if (!document.getElementById("fqServiceSummary").value) {
      document.getElementById("fqServiceSummary").value = transcript;
    }
    showToast("🎙️ Audio transcrito con éxito.");
  };

  speechRecognizer.onend = () => {
    isRecordingVoice = false;
    btn.textContent = "🎤 Dictar voz";
  };

  speechRecognizer.start();
}

async function submitNewQuote(sendImmediately) {
  const clientName = document.getElementById("fqClientName").value.trim();
  const clientPhone = document.getElementById("fqClientPhone").value.trim();
  const clientAddress = document.getElementById("fqClientAddress").value.trim();
  const serviceSummary = document.getElementById("fqServiceSummary").value.trim();
  const voiceTranscript = document.getElementById("fqVoiceTranscript").value.trim();

  if (!clientName || !clientPhone) {
    showToast("⚠️ Completá el nombre y WhatsApp del cliente.");
    document.getElementById("fqClientName").focus();
    return;
  }

  // Se abre la pestaña antes del await para que el navegador no la bloquee como popup.
  const waWindow = sendImmediately ? window.open("about:blank", "_blank") : null;

  const data = await safely(() =>
    api("POST", "/api/quotes", {
      clientName,
      clientPhone,
      clientAddress,
      serviceSummary,
      voiceTranscript,
      items: draftItems,
      depositPct: draftDepositPct,
      sendImmediately
    })
  );

  if (!data) {
    if (waWindow) waWindow.close();
    return;
  }

  closeNewQuoteModal();
  switchMainSection("board");
  activeInboxTab = sendImmediately ? "waiting_reply" : "draft";
  if (data.quote) {
    selectedClientQuoteCode = data.quote.code;
  }
  appState = data.state;
  renderAll();

  if (sendImmediately && data.quote) {
    const waUrl = buildInitialWhatsAppLink(data.quote);
    if (waWindow) {
      waWindow.opener = null;
      waWindow.location.href = waUrl;
    } else {
      window.location.href = waUrl;
    }
    showToast(`✓ ${data.quote.code} creado y listo en WhatsApp.`);
  } else if (data.quote) {
    showToast(`✓ ${data.quote.code} guardado en 'Por Enviar'.`);
  }
}

// Modal de Mascota Coti y Reset de Demo
function openMascotModal() {
  document.getElementById("mascotModal").classList.add("open");
}

function closeMascotModal() {
  document.getElementById("mascotModal").classList.remove("open");
}

async function resetDemoData() {
  if (!window.confirm("Esto borra todos los presupuestos, clientes y combos de esta cuenta y carga los de ejemplo. ¿Seguir?")) return;
  closeMascotModal();
  activeInboxTab = "waiting_reply";
  onlyOverdueFilter = false;
  await runAction("POST", "/api/reset", null, "🔄 Datos de demostración restaurados.");
}

// ============================================================================
// INSTALAR COTI COMO APP (PWA): Android/Chrome con un toque, iPhone con guía
// ============================================================================
const INSTALL_DISMISS_KEY = "coti.installDismissedAt";
const INSTALL_SNOOZE_MS = 7 * 86400000; // "Ahora no" lo esconde una semana
let deferredInstallPrompt = null;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInAppBrowser() {
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|; wv\)/i.test(navigator.userAgent);
}

function isMobile() {
  return isIos() || /Android/i.test(navigator.userAgent);
}

function installSnoozed() {
  try {
    const at = Number(localStorage.getItem(INSTALL_DISMISS_KEY));
    return at && Date.now() - at < INSTALL_SNOOZE_MS;
  } catch {
    return false;
  }
}

function updateInstallUi() {
  const banner = document.getElementById("installBanner");
  const infoBtn = document.getElementById("installFromInfoBtn");
  if (!banner) return;
  const installed = isStandalone();
  // Se ofrece si el navegador permite instalar con un toque, o si es un celular (guía manual).
  const canOffer = !installed && (deferredInstallPrompt || isMobile());
  banner.style.display = canOffer && !installSnoozed() ? "flex" : "none";
  if (infoBtn) infoBtn.style.display = canOffer ? "" : "none";
}

async function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (outcome !== "accepted") dismissInstallBanner();
    updateInstallUi();
    return;
  }
  openInstallGuide();
}

function openInstallGuide() {
  const ios = isIos();
  document.getElementById("installStepsIos").style.display = ios ? "" : "none";
  document.getElementById("installStepsOther").style.display = ios ? "none" : "";
  document.getElementById("installGuideInApp").style.display = isInAppBrowser() ? "" : "none";
  document.getElementById("installGuideModal").classList.add("open");
}

function closeInstallGuide() {
  document.getElementById("installGuideModal").classList.remove("open");
}

function dismissInstallBanner() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {
    /* sin almacenamiento: se oculta solo por esta visita */
  }
  document.getElementById("installBanner").style.display = "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // mostramos nuestro propio botón en lugar del aviso del navegador
  deferredInstallPrompt = e;
  updateInstallUi();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallUi();
  showToast("✓ Coti quedó instalada. Ya la tenés en tu pantalla de inicio.");
});

// Atajos del ícono instalado (mantener apretado el ícono): ?accion=nueva | 48hs
function handleLaunchAction() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("accion");
  const mpResult = params.get("mp");
  if (params.has("accion") || params.has("origen") || mpResult) {
    window.history.replaceState(null, "", "/");
  }
  // Vuelta de "Conectar Mercado Pago"
  const mpMessages = {
    conectado: "✓ ¡Mercado Pago conectado! Las señas ahora entran directo en tu cuenta.",
    cancelado: "No se conectó Mercado Pago. Podés intentarlo de nuevo desde ⚙️ Mi negocio.",
    error: "⚠️ No pudimos conectar Mercado Pago. Probá de nuevo en unos minutos.",
    "no-disponible": "La conexión con Mercado Pago todavía no está disponible."
  };
  if (mpResult && mpMessages[mpResult]) {
    showToast(mpMessages[mpResult]);
    if (mpResult === "conectado" || mpResult === "error") openSettingsModal();
  }
  if (action === "nueva") openNewQuoteModal();
  else if (action === "48hs") {
    onlyOverdueFilter = false;
    focusOverdueQuotes();
  }
}

// Registro de Service Worker para PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Inicializar
async function init() {
  try {
    appConfig = await fetch("/api/config").then((r) => r.json());
  } catch {
    /* sin config: valores por defecto */
  }
  await fetchAppState();
  updateInstallUi();
  if (document.getElementById("appRoot").style.display === "block") handleLaunchAction();
}

window.addEventListener("DOMContentLoaded", init);
