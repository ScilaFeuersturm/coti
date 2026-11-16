# 🐦 Coti — CRM Ultraligero & "Inbox Zero" para Servicios Locales de Alto Ticket

> *"Cotizá en 60 segundos desde tu celular, cerrá señas por link y asegurá el seguimiento sin pensar."*

Implementación completa de [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) con **Coti, el Hornero de Oficio** como mascota oficial de la marca.

---

## 🚀 Cómo correr la aplicación

Coti corre en **Cloudflare Workers** con base de datos **D1**. Requiere Node 22.13+ para las herramientas.

```bash
npm install
cp .dev.vars.example .dev.vars   # configuración local
npm run dev                      # http://localhost:8787 (Worker + D1 local)
npm test                         # tests de la API
```

- **Panel del taller:** `/`. Pide ingresar o crear una cuenta. Cada taller ve solo sus datos.
- **Cuenta demo** (solo en desarrollo): `demo@coti.app` / `coti-demo-1234`, con presupuestos de ejemplo.
- **Link público del cliente:** `/p/<id>`. Cada presupuesto tiene un ID aleatorio no adivinable.

### Estructura

| Ruta | Qué es |
|---|---|
| `src/worker.js` | Entrada del Worker: `/api/*` a la API, `/p/*` a la página del presupuesto, el resto archivos estáticos |
| `src/app.js` | API (login, presupuestos, cobros, webhooks) |
| `src/store.js` | Consultas a D1 |
| `src/auth.js` / `src/payments.js` | Contraseñas y sesiones / Mercado Pago |
| `migrations/` | Esquema de la base (se aplica con `wrangler d1 migrations apply`) |
| `public/` | App web (PWA) que sirve Cloudflare |

### Publicar en Cloudflare (primera vez)

```bash
npx wrangler login                       # con la cuenta de Cloudflare donde va Coti
npx wrangler d1 create coti              # copiar el database_id que devuelve a wrangler.jsonc
npm run deploy                           # tests + migraciones + publicar
```

### Configuración

Variables no secretas en `wrangler.jsonc` (`vars`); para desarrollo se pisan con `.dev.vars`.

| Variable | Para qué |
|---|---|
| `ENVIRONMENT` | `production` desactiva cuenta demo, reset y "adelantar 48hs". |
| `PUBLIC_BASE_URL` | Opcional: URL pública si se usa un dominio propio. |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | **Secretos.** Datos de la app de Mercado Pago (Credenciales de producción). Activan "Conectar Mercado Pago". |
| `TOKEN_ENCRYPTION_KEY` | **Secreto.** Cifra en la base los tokens de cada negocio. No cambiarla: si se pierde, cada negocio debe reconectar. |
| `MP_ACCESS_TOKEN` | **Secreto, opcional, solo de PRUEBA.** Si Mercado Pago no confirma que es de prueba, se ignora. |
| `MP_WEBHOOK_SECRET` | **Secreto, opcional.** Verifica la firma de las notificaciones de Mercado Pago. |
| `MP_CURRENCY` | Moneda de cobro: `ARS`. Los presupuestos se cotizan en pesos, sin conversión. |

En la app de Mercado Pago, la URL de redireccionamiento es `https://<dominio>/api/mp/callback`.

### Cómo se cobra la seña

- **Mercado Pago:** cada negocio toca "Conectar Mercado Pago" en ⚙️ Mi negocio y autoriza con **su** cuenta; las señas entran directo en ella. El presupuesto se aprueba **solo** cuando el servidor confirma el pago con la API de Mercado Pago, usando la cuenta del negocio (por notificación o al volver al link). En desarrollo, sin cuentas conectadas, hay un modo demo marcado "sin cobro real".
- **Transferencia:** el cliente ve alias/CBU y avisa "ya transferí"; el taller lo confirma desde el tablero.
- **Efectivo / otro:** el taller marca "Seña cobrada" desde la tarjeta.

---

## ✨ Qué incluye esta implementación

1. **Identidad y Mascota ("Coti, el Hornero de Oficio"):**
   - Ilustración estilo sello de taller/xilografía con lápiz de carpintero en la oreja y libreta de presupuestos bajo el ala (`public/assets/coti-mascot.jpg` y `public/assets/coti-badge.jpg`).
2. **Diseño "Anti-Plantilla IA" (Human-First Design):**
   - Paleta terrenal y legible bajo el sol: fondo hueso cálido (`#F9F9FB`), texto carbón (`#1A1A1A`), acento verde bosque/oliva (`#1E4D3B`) y alertas de seguimiento en ámbar (`#D97706`).
   - Bordes nítidos estilo libreta de remito, tipografía `Plus Jakarta Sans` + `JetBrains Mono` en importes/códigos y botones táctiles de `48px+`.
3. **Flujo Central en 3 Pasos:**
   - **Paso 1 — Cotización Flash en 3 Clics (15s):** Autocompletado de clientes, combos rápidos de 1 toque, dictado/transcripción de nota de voz de taller y adicionales rápidos (`+ Repuestos`, `+ Mano de obra`, `+ Flete`).
   - **Paso 2 — Link Web Único (`/p/COT-XXXX`) + PDF + WhatsApp:** Página optimizada para el celular del cliente con botón **"Aceptar presupuesto y señar"** (Mercado Pago / Transferencia / Stripe) e impresión PDF con membrete.
   - **Paso 3 — Tablero "Inbox Zero" & Superpoder de las 48hs:** Dividido en *Por Enviar*, *Esperando Respuesta* y *Listas / Seña Pagada*. Las cotizaciones con más de 48hs sin respuesta se resaltan en ámbar con botón directo a `wa.me/` y el mensaje empático pre-redactado.
4. **Módulos A, B y C:**
   - **Módulo A:** Agenda de clientes con búsqueda instantánea e historial de presupuestos por cliente.
   - **Módulo B:** Catálogo de servicios/combos preestablecidos editable.
   - **Módulo C:** Las 3 métricas clave siempre visibles (*1. Dinero en la calle*, *2. Cerrados este mes*, *3. Tasa de conversión*).
