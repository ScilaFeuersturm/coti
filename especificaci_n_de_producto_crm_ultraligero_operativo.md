# Product Brief: CRM Ultraligero & "Inbox Zero" para Servicios Locales de Alto Ticket

## 1. Visión y Posicionamiento de Producto
* **Nombre provisional:** *TallerFlow* / *PresupuestoYa* (o nombre de trabajo interno).
* **Target:** Proveedores de servicios locales con cotizaciones de ticket medio/alto ($300 a $5.000+ USD) que trabajan en movimiento: instaladores de climatización, empresas de aberturas, catering, organizadores de eventos, talleres de chapa y pintura, reformas integrales.
* **Problema raíz:** No usan Salesforce, HubSpot ni Monday porque son sistemas lentos, corporativos y llenos de campos innecesarios. Su operación vive en WhatsApp y papel. Pierden entre 20% y 40% de ingresos simplemente porque **olvidan hacer seguimiento** o tardan 3 días en enviar un PDF formal.
* **Propuesta de valor esencial:** *"Cotizá en 60 segundos desde tu celular, cerrá señas por link y asegurá el seguimiento sin pensar."*

---

## 2. Directivas de Diseño & UX: "Anti-Plantilla IA" (Human-First Design)

Para que el software se sienta confiable, práctico y adoptado de inmediato por personas no técnicas, **debe evitar a toda costa la estética genérica de landing page de IA**:

* **Fuentes y Tipografía:** 
  * Prohibido el uso de degradados multicolores violeta/cian o estética "cyberpunk".
  * Usar tipografías tipográficas limpias, legibles bajo la luz del sol (interfaz para usar en la calle/taller): fuentes grotescas sólidas o monoespaciadas sutiles en números (tipo *Geist*, *Inter*, *Plus Jakarta Sans*).
* **Paleta de Colores Terrenal y Utilitaria:**
  * Fondo neutro cálido (off-white / gris hueso `#F9F9FB`), no modo oscuro estridente.
  * Contrastes definidos: negro carbón (`#1A1A1A`) para texto primario.
  * Color de acento sobrio: un verde bosque/oliva o un azul tinta industrial que denote solidez y confianza financiera.
* **Componentes Táctiles (Mobile First absoluto):**
  * Botones grandes pensados para pulgares y dedos con polvo o guantes (mínimo 48px de alto).
  * Menos "cards flotantes con sombras difusas" y más **bordes nítidos de 1px**, estilo papel de remito o libreta de notas bien organizada.
  * Respuestas micro-hápticas y estados vacíos (*empty states*) con textos directos y humanos, no frases robóticas ni ilustraciones genéricas de personas flotando con laptops.

---

## 3. Flujo Central del Usuario (Core User Flow)

El producto hace exactamente **3 cosas excepcionalmente bien**:

```
[Ingreso de Consulta] ──► [Cotización Flash en 3 Clics] ──► [Seguimiento Automático & Cobro]
```

### Paso 1: Carga Ultrarrápida (15 segundos)
* Campos mínimos obligatorios:
  * Nombre del cliente.
  * Teléfono / WhatsApp.
  * Servicio requerido (selector rápido o nota de voz transcrita).
  * Monto estimado o ítems pre-cargados.

### Paso 2: Generación de Presupuesto Limpio (Link Web + PDF)
* En lugar de obligar al usuario a diseñar un PDF pesado:
  * El sistema genera una **página web única y optimizada para celular** para el cliente final (`app.link/p/1234`).
  * El cliente ve: Detalle claro del trabajo, valor total, validez de la oferta y un botón destacado: **"Aceptar y señar"** (integración con Mercado Pago / Stripe / transferencia bancaria).
  * Opción de descargar como PDF con membrete simple.
  * Envío con un toque mediante WhatsApp ("Abrir chat con mensaje pre-redactado").

### Paso 3: Tablero "Inbox Zero" & Seguimiento a las 48hs
* Vista tipo lista compacta dividida en 3 columnas/pestañas:
  1. **Por Enviar:** Consultas que entraron pero no se cotizaron.
  2. **Esperando Respuesta:** Cotizaciones enviadas sin confirmación.
  3. **Listas para Ejecutar / Seña Pagada:** Trabajos confirmados.
* **El "Superpoder" (El Botón de las 48 Horas):**
  * Si pasaron 48 horas sin respuesta del cliente, la tarjeta se resalta en ámbar con un botón directo: *"Mandar recordatorio por WhatsApp"*.
  * Abre WhatsApp con un mensaje empático y natural: *"Hola [Nombre], ¿cómo estás? Te consulto si pudiste revisar el presupuesto que te pasé el [Día] o si tenés alguna duda sobre los materiales."*

---

## 4. Requisitos Funcionales Esenciales (MVP Scope)

### Módulo A: Gestión de Oportunidades & Clientes
* Agenda simple de clientes (autocompletado por teléfono).
* Historial de cotizaciones anteriores por cliente.
* Búsqueda instantánea por nombre o número de teléfono.

### Módulo B: Catálogo de Servicios / Plantillas Rápidas
* Posibilidad de guardar 5 a 10 combos preestablecidos (ejemplo: *"Mantenimiento estándar - $120"*, *"Instalación básica 3000 frigorías - $250"*).
* Carga de ítems adicionales con un solo toque (+ Repuestos, + Mano de obra).

### Módulo C: Métricas Clave (Sin gráficos complejos)
El panel no debe tener dashboards financieros abrumadores, solo 3 números visibles:
1. **Dinero en la calle:** Suma total de presupuestos pendientes de respuesta.
2. **Cerrados este mes:** Dinero facturado/señalado.
3. **Tasa de conversión simple:** % de cotizaciones aprobadas.

---

## 5. Arquitectura Técnica y Stack Sugerido

* **Frontend:** Next.js / React con Tailwind CSS (diseñado mobile-first, empaquetable como PWA para agregar a la pantalla de inicio del teléfono sin pasar por las trabas del App Store en la fase 1).
* **Backend:** Node.js / Supabase o Firebase (PostgreSQL para relaciones simples de usuarios, presupuestos y clientes).
* **Mensajería:** Enlaces profundos (*Deep links*) a `wa.me/` para no depender de la API oficial de WhatsApp en el MVP (reduce costos operativos a cero para el usuario).
* **Cobros:** Webhook de pasarela local (Mercado Pago / Stripe Checkout) para marcar el presupuesto automáticamente como "Señado/Aprobado".

---

## 6. Estrategia de Monetización & Pricing

* **Período de prueba:** 14 días sin tarjeta de crédito.
* **Plan Único (Simplicidad total):**
  * **$19 - $29 USD / mes** (o equivalente en moneda local): Cotizaciones ilimitadas, seguimiento por WhatsApp y link de cobro de señas.
* **Métrica de éxito para el cliente:** Si recupera **una sola cotización perdida al mes**, el software ya se pagó solo por los siguientes 6 meses.