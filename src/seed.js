// Datos iniciales realistas para Coti (Servicios Locales de Medio/Alto Ticket)
const HOUR = 3600 * 1000;

// Date.now() va dentro de la función: en Workers vale 0 si se evalúa al cargar el módulo.
export function getSeedData() {
  const now = Date.now();
  return {
    workshop: {
      name: "ClimaSur & Reformas Integrales",
      owner: "Martín Gómez",
      phone: "+54 9 11 5842-9100",
      alias: "CLIMASUR.MP",
      cbu: "0000003100084921048291",
      currency: "USD",
      defaultDepositPct: 40,
      validityDays: 7,
      plan: {
        name: "Plan Único Coti",
        priceUsd: 24,
        trialDaysLeft: 14
      }
    },
    catalog: [
      {
        id: "cat-1",
        title: "Instalación básica Split 3000 frigorías",
        category: "Climatización",
        price: 250,
        description: "Incluye hasta 3m de cañería de cobre, ménsulas exteriores, vacío de línea y prueba de hermeticidad."
      },
      {
        id: "cat-2",
        title: "Instalación equipo Inverter 4500/6000 fg",
        category: "Climatización",
        price: 380,
        description: "Cañería reforzada de 1/2 y 1/4, interconexión eléctrica certificada, desagüe oculto y puesta en marcha."
      },
      {
        id: "cat-3",
        title: "Mantenimiento preventivo + limpieza profunda",
        category: "Climatización",
        price: 120,
        description: "Desarme de turbina, lavado químico de evaporadora y condensadora, control de presiones R410a."
      },
      {
        id: "cat-4",
        title: "Colocación de abertura aluminio Módena DVH",
        category: "Aberturas",
        price: 640,
        description: "Provisión y amurado en seco de ventana balcón 200x200cm con doble vidriado hermético y sellado poliuretánico."
      },
      {
        id: "cat-5",
        title: "Tablero eléctrico seccional + disyuntor Siemens",
        category: "Electricidad",
        price: 520,
        description: "Recableado de circuitos principales, llaves térmicas tetrapolares, protector de tensión y puesta a tierra."
      },
      {
        id: "cat-6",
        title: "Pre-instalación en obra (cañería embutida por boca)",
        category: "Obra / Reforma",
        price: 310,
        description: "Canaleteado en pared, caja de preinstalación, cañería de cobre aislada y presurización con nitrógeno."
      },
      {
        id: "cat-7",
        title: "Chapa y pintura: Paño lateral + paragolpes bicapa",
        category: "Taller / Chapa",
        price: 450,
        description: "Desabollado artesanal, primer poliuretánico, color original en cabina presurizada y pulido espejo."
      }
    ],
    quickAddons: [
      { id: "add-1", label: "+ Materiales / Repuestos", title: "Materiales y repuestos adicionales", price: 85 },
      { id: "add-2", label: "+ Mano de obra extra", title: "Mano de obra adicional en altura / obra", price: 95 },
      { id: "add-3", label: "+ Metro cañería cobre", title: "Metro adicional de cañería frigorífica + aislación", price: 45 },
      { id: "add-4", label: "+ Flete y traslado", title: "Traslado de equipos y logística a domicilio", price: 40 },
      { id: "add-5", label: "+ Trabajo en altura / Hidroelevador", title: "Suplemento por trabajo en fachada exterior", price: 130 }
    ],
    clients: [
      {
        id: "cli-1",
        name: "Luciana Pereyra",
        phone: "+54 9 11 6421-8890",
        address: "Av. del Libertador 4820, Piso 6B (Palermo)",
        notes: "Pidió presupuesto urgente porque se muda el viernes. Prefiere pagar seña con Mercado Pago.",
        createdAt: now - 54 * HOUR
      },
      {
        id: "cli-2",
        name: "Estudio Arq. Brizuela & Asoc.",
        phone: "+54 9 11 4092-3312",
        address: "Obra: Sucre 2140 (Belgrano)",
        notes: "Obra de reforma integral de 3 ambientes. Pagan por transferencia bancaria.",
        createdAt: now - 72 * HOUR
      },
      {
        id: "cli-3",
        name: "Federico Santoro",
        phone: "+54 9 11 5109-7741",
        address: "Acassuso 840 (San Isidro)",
        notes: "Cliente recurrente. El año pasado instalamos 2 equipos en planta baja.",
        createdAt: now - 120 * HOUR
      },
      {
        id: "cli-4",
        name: "Restaurante La Brigada Norte",
        phone: "+54 9 11 3881-0944",
        address: "Av. Maipú 1950 (Vicente López)",
        notes: "Salón principal de eventos. Necesitan factura y detalle técnico.",
        createdAt: now - 16 * HOUR
      },
      {
        id: "cli-5",
        name: "Carolina Menéndez",
        phone: "+54 9 11 6988-1120",
        address: "Amenábar 1420, PB (Colegiales)",
        notes: "Mandó audio por WhatsApp consultando por cerramiento de patio interno.",
        createdAt: now - 2 * HOUR
      }
    ],
    quotes: [
      {
        id: "q-1041",
        code: "COT-1041",
        clientId: "cli-1",
        clientName: "Luciana Pereyra",
        clientPhone: "+54 9 11 6421-8890",
        clientAddress: "Av. del Libertador 4820, Piso 6B",
        serviceSummary: "Instalación de 2 equipos Inverter 4500fg + pre-instalación balcón",
        voiceTranscript: "Luciana pidió instalar dos equipos LG Inverter de 4500 frigorías en living y dormitorio principal, pasando cañería por taparrollos hacia el balcón.",
        items: [
          { title: "Instalación equipo Inverter 4500/6000 fg (x2)", qty: 2, unitPrice: 380, total: 760 },
          { title: "Materiales y repuestos adicionales (ménsulas inox + bandeja)", qty: 1, unitPrice: 110, total: 110 },
          { title: "Metro adicional de cañería frigorífica + aislación (4m)", qty: 4, unitPrice: 45, total: 180 }
        ],
        total: 1050,
        depositPct: 40,
        depositAmount: 420,
        status: "waiting_reply", // draft | waiting_reply | approved
        createdAt: now - 54 * HOUR,
        sentAt: now - 52 * HOUR, // Hace 52 horas -> Activa el Superpoder de las 48hs!
        remindedAt: null,
        approvedAt: null,
        paymentMethod: null,
        validityDays: 7
      },
      {
        id: "q-1042",
        code: "COT-1042",
        clientId: "cli-2",
        clientName: "Estudio Arq. Brizuela & Asoc.",
        clientPhone: "+54 9 11 4092-3312",
        clientAddress: "Obra: Sucre 2140 (Belgrano)",
        serviceSummary: "Pre-instalación en obra 4 bocas A/A + Tablero eléctrico dedicado",
        voiceTranscript: "Reforma completa en calle Sucre. Dejar las 4 preinstalaciones embutidas y presurizadas con nitrógeno más el tablero térmico independiente.",
        items: [
          { title: "Pre-instalación en obra (cañería embutida por boca)", qty: 4, unitPrice: 310, total: 1240 },
          { title: "Tablero eléctrico seccional + disyuntor Siemens", qty: 1, unitPrice: 520, total: 520 },
          { title: "Traslado de equipos y logística a domicilio", qty: 1, unitPrice: 40, total: 40 }
        ],
        total: 1800,
        depositPct: 50,
        depositAmount: 900,
        status: "waiting_reply",
        createdAt: now - 66 * HOUR,
        sentAt: now - 64 * HOUR, // Hace 64 horas -> Activa el Superpoder de las 48hs!
        remindedAt: null,
        approvedAt: null,
        paymentMethod: null,
        validityDays: 7
      },
      {
        id: "q-1043",
        code: "COT-1043",
        clientId: "cli-4",
        clientName: "Restaurante La Brigada Norte",
        clientPhone: "+54 9 11 3881-0944",
        clientAddress: "Av. Maipú 1950 (Vicente López)",
        serviceSummary: "Mantenimiento preventivo de 5 equipos piso-techo salón principal",
        voiceTranscript: "",
        items: [
          { title: "Mantenimiento preventivo + limpieza profunda", qty: 5, unitPrice: 120, total: 600 },
          { title: "Materiales y repuestos adicionales (carga gas R410a y capacitores)", qty: 2, unitPrice: 85, total: 170 }
        ],
        total: 770,
        depositPct: 40,
        depositAmount: 308,
        status: "waiting_reply",
        createdAt: now - 14 * HOUR,
        sentAt: now - 12 * HOUR, // Hace 12 horas (aún dentro de las 48hs)
        remindedAt: null,
        approvedAt: null,
        paymentMethod: null,
        validityDays: 7
      },
      {
        id: "q-1044",
        code: "COT-1044",
        clientId: "cli-5",
        clientName: "Carolina Menéndez",
        clientPhone: "+54 9 11 6988-1120",
        clientAddress: "Amenábar 1420, PB (Colegiales)",
        serviceSummary: "Colocación abertura aluminio Módena DVH 200x200 en patio interno",
        voiceTranscript: "Hola Martín, te mando foto del patio. Queremos sacar el ventanal viejo de hierro y colocar puerta ventana Módena negra con DVH.",
        items: [
          { title: "Colocación de abertura aluminio Módena DVH", qty: 1, unitPrice: 640, total: 640 },
          { title: "Mano de obra adicional: desmonte marco antiguo de hierro", qty: 1, unitPrice: 95, total: 95 },
          { title: "Traslado de equipos y logística a domicilio", qty: 1, unitPrice: 40, total: 40 }
        ],
        total: 775,
        depositPct: 40,
        depositAmount: 310,
        status: "draft", // Por Enviar
        createdAt: now - 2 * HOUR,
        sentAt: null,
        remindedAt: null,
        approvedAt: null,
        paymentMethod: null,
        validityDays: 7
      },
      {
        id: "q-1039",
        code: "COT-1039",
        clientId: "cli-3",
        clientName: "Federico Santoro",
        clientPhone: "+54 9 11 5109-7741",
        clientAddress: "Acassuso 840 (San Isidro)",
        serviceSummary: "Instalación Split 3000fg suite + Tablero térmico planta alta",
        voiceTranscript: "",
        items: [
          { title: "Instalación básica Split 3000 frigorías", qty: 1, unitPrice: 250, total: 250 },
          { title: "Tablero eléctrico seccional + disyuntor Siemens", qty: 1, unitPrice: 520, total: 520 },
          { title: "Suplemento por trabajo en fachada exterior", qty: 1, unitPrice: 130, total: 130 }
        ],
        total: 900,
        depositPct: 40,
        depositAmount: 360,
        status: "approved", // Listas para Ejecutar / Seña Pagada
        createdAt: now - 110 * HOUR,
        sentAt: now - 109 * HOUR,
        remindedAt: null,
        approvedAt: now - 90 * HOUR,
        paymentMethod: "Mercado Pago",
        validityDays: 7
      },
      {
        id: "q-1038",
        code: "COT-1038",
        clientId: "cli-2",
        clientName: "Estudio Arq. Brizuela & Asoc.",
        clientPhone: "+54 9 11 4092-3312",
        clientAddress: "Obra: Virrey del Pino 3110",
        serviceSummary: "Provisión y colocación 3 ventanales Módena DVH + flete obra",
        voiceTranscript: "",
        items: [
          { title: "Colocación de abertura aluminio Módena DVH (x3)", qty: 3, unitPrice: 640, total: 1920 },
          { title: "Traslado de equipos y logística a domicilio", qty: 1, unitPrice: 80, total: 80 }
        ],
        total: 2000,
        depositPct: 50,
        depositAmount: 1000,
        status: "approved",
        createdAt: now - 210 * HOUR,
        sentAt: now - 208 * HOUR,
        remindedAt: now - 158 * HOUR,
        approvedAt: now - 150 * HOUR,
        paymentMethod: "Transferencia Bancaria",
        validityDays: 7
      }
    ]
  };
}
