# 🐦 Coti — CRM Ultraligero & "Inbox Zero" para Servicios Locales de Alto Ticket

> *"Cotizá en 60 segundos desde tu celular, cerrá señas por link y asegurá el seguimiento sin pensar."*

Implementación completa de [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) con **Coti, el Hornero de Oficio** como mascota oficial de la marca.

---

## 🚀 Cómo correr la aplicación

Requiere **Node 22.13 o superior** (usa SQLite incluido en Node, sin dependencias externas).

```bash
cd /Users/priscilagomez/Desktop/Coti
npm start      # levanta el servidor en http://localhost:3456
npm test       # corre los tests de la API
```

- **Panel del taller:** `http://localhost:3456`. Pide ingresar o crear una cuenta. Cada taller ve solo sus datos.
- **Cuenta demo** (solo fuera de producción): `demo@coti.app` / `coti-demo-1234`, con presupuestos de ejemplo.
- **Link público del cliente:** `http://localhost:3456/p/<id>`. Cada presupuesto tiene un ID aleatorio no adivinable; se copia desde "Abrir el link real del cliente".
- **Datos:** `data/coti.sqlite`. Hacé copia de este archivo para respaldar.

### Configuración (`.env`)

Copiá [.env.example](./.env.example) como `.env`. Lo principal:

| Variable | Para qué |
|---|---|
| `NODE_ENV=production` | Desactiva cuenta demo, reset y "adelantar 48hs"; cookie `Secure`. |
| `PUBLIC_BASE_URL` | URL pública (https) para los links y el webhook de Mercado Pago. |
| `MP_ACCESS_TOKEN` | Activa el cobro real de señas con Mercado Pago (usá uno `TEST-` para probar). |
| `MP_WEBHOOK_SECRET` | Verifica la firma de las notificaciones de Mercado Pago. |
| `MP_CURRENCY` / `MP_FX_RATE` | Moneda de cobro (ARS) y conversión desde USD. |

### Cómo se cobra la seña

- **Mercado Pago:** sin token, en desarrollo funciona en modo demo (marcado "sin cobro real"); en producción sin token no se ofrece. Con token, el cliente paga en Mercado Pago y el presupuesto se aprueba **solo** cuando el servidor confirma el pago con la API de MP (por webhook o al volver al link).
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
