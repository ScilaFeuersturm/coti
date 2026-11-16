import React, { useState, useMemo } from "react";
import {
  SafeAreaView,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  Linking,
  Share,
  StyleSheet,
  Platform,
  StatusBar as RNStatusBar,
  Alert
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { getSeedData } from "./src/data/seed";

const HOUR_48_MS = 48 * 3600 * 1000;

const COLORS = {
  bone: "#F9F9FB",
  paper: "#FFFFFF",
  subtle: "#F2F0EA",
  ink: "#1A1A1A",
  inkSecondary: "#4A4843",
  inkMuted: "#76736B",
  border: "#D5D1C7",
  forest: "#1E4D3B",
  forestTint: "#E5EFEA",
  amberBg: "#FFFBEB",
  amberTint: "#FEF3C7",
  amberBorder: "#D97706",
  amberInk: "#92400E"
};

const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace"
});

function formatUsd(val) {
  return "USD $" + Number(val || 0).toLocaleString("es-AR");
}

function formatDate(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
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

export default function App() {
  const initialData = useMemo(() => getSeedData(), []);

  const [workshop] = useState(initialData.workshop);
  const [catalog, setCatalog] = useState(initialData.catalog);
  const [quickAddons] = useState(initialData.quickAddons);
  const [clients, setClients] = useState(initialData.clients);
  const [quotes, setQuotes] = useState(initialData.quotes);

  // Selector de Rol: 'workshop' (Dueño del Taller) | 'client' (Vista del Cliente)
  const [roleMode, setRoleMode] = useState("workshop");
  const [selectedClientQuoteCode, setSelectedClientQuoteCode] = useState("COT-1041");
  const [selectedGateway, setSelectedGateway] = useState("Mercado Pago");

  // Navegación del Taller
  const [mainSection, setMainSection] = useState("board"); // 'board' | 'clients' | 'catalog'
  const [inboxTab, setInboxTab] = useState("waiting_reply"); // 'waiting_reply' | 'draft' | 'approved'
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  // Modales
  const [flashModalOpen, setFlashModalOpen] = useState(false);
  const [mascotModalOpen, setMascotModalOpen] = useState(false);

  // Estado del Formulario Cotización Flash (3 Clics)
  const [fqClientName, setFqClientName] = useState("");
  const [fqClientPhone, setFqClientPhone] = useState("");
  const [fqClientAddress, setFqClientAddress] = useState("");
  const [fqServiceSummary, setFqServiceSummary] = useState("");
  const [fqVoiceTranscript, setFqVoiceTranscript] = useState("");
  const [fqItems, setFqItems] = useState([
    { title: initialData.catalog[0].title, qty: 1, unitPrice: initialData.catalog[0].price }
  ]);
  const [fqDepositPct, setFqDepositPct] = useState(40);

  // Nuevo Combo en Catálogo
  const [newCatTitle, setNewCatTitle] = useState("");
  const [newCatCategory, setNewCatCategory] = useState("Climatización");
  const [newCatPrice, setNewCatPrice] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");

  // Cálculo de las 3 Métricas Clave (Módulo C)
  const metrics = useMemo(() => {
    const now = Date.now();
    const waiting = quotes.filter((q) => q.status === "waiting_reply");
    const approved = quotes.filter((q) => q.status === "approved");
    const drafts = quotes.filter((q) => q.status === "draft");

    const dineroEnLaCalle = waiting.reduce((acc, q) => acc + Number(q.total || 0), 0);
    const cerradosEsteMes = approved.reduce((acc, q) => acc + Number(q.total || 0), 0);
    const senasCobradas = approved.reduce((acc, q) => acc + Number(q.depositAmount || 0), 0);

    const totalSentOrClosed = waiting.length + approved.length;
    const tasaConversion =
      totalSentOrClosed > 0 ? Math.round((approved.length / totalSentOrClosed) * 100) : 0;

    const overdue48h = waiting.filter((q) => q.sentAt && now - q.sentAt >= HOUR_48_MS);

    return {
      dineroEnLaCalle,
      cerradosEsteMes,
      senasCobradas,
      tasaConversion,
      overdue48h,
      counts: {
        draft: drafts.length,
        waiting_reply: waiting.length,
        approved: approved.length,
        overdue48h: overdue48h.length
      }
    };
  }, [quotes]);

  // Enlaces profundos a WhatsApp
  const openWhatsApp = async (phone, text) => {
    const cleanPhone = (phone || "").replace(/\D/g, "");
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Share.share({ message: text });
      }
    } catch {
      await Share.share({ message: text });
    }
  };

  const build48hReminderMessage = (q) => {
    const firstName = (q.clientName || "Cliente").split(" ")[0];
    const sentDay = formatDayName(q.sentAt || q.createdAt);
    return `Hola ${firstName}, ¿cómo estás? Te consulto si pudiste revisar el presupuesto que te pasé el ${sentDay} o si tenés alguna duda sobre los materiales.`;
  };

  const handleSendInitialWhatsApp = (q) => {
    const firstName = (q.clientName || "Cliente").split(" ")[0];
    const msg = `Hola ${firstName}, ¿cómo estás? Te paso el presupuesto formal (${q.code}) por *${q.serviceSummary}*.\n\n📄 Valor total: ${formatUsd(q.total)} (Seña ${q.depositPct}%: ${formatUsd(q.depositAmount)}).\nLink directo: https://coti.app/p/${q.code}`;
    setQuotes((prev) =>
      prev.map((item) =>
        item.id === q.id
          ? { ...item, status: "waiting_reply", sentAt: item.sentAt || Date.now() }
          : item
      )
    );
    setInboxTab("waiting_reply");
    openWhatsApp(q.clientPhone, msg);
  };

  const handleSend48hReminder = (q) => {
    const msg = `${build48hReminderMessage(q)}\n\nTe dejo a mano el link al presupuesto ${q.code}: https://coti.app/p/${q.code}`;
    setQuotes((prev) =>
      prev.map((item) => (item.id === q.id ? { ...item, remindedAt: Date.now() } : item))
    );
    openWhatsApp(q.clientPhone, msg);
  };

  const handleSimulate48Hours = (quoteId) => {
    setQuotes((prev) =>
      prev.map((q) =>
        q.id === quoteId
          ? { ...q, status: "waiting_reply", sentAt: Date.now() - 50 * 3600 * 1000 }
          : q
      )
    );
  };

  const handleClientPayDeposit = (quoteId) => {
    setQuotes((prev) =>
      prev.map((q) =>
        q.id === quoteId
          ? {
              ...q,
              status: "approved",
              approvedAt: Date.now(),
              paymentMethod: selectedGateway
            }
          : q
      )
    );
    Alert.alert(
      "✓ Seña Confirmada",
      `El pago por ${selectedGateway} fue registrado. El presupuesto ya figura en 'Listas / Seña Pagada' en el tablero del taller.`
    );
  };

  // Cotización Flash en 3 Clics
  const openFlashQuoteModal = (prefillClient = null, prefillCombo = null) => {
    setFqClientName(prefillClient ? prefillClient.name : "");
    setFqClientPhone(prefillClient ? prefillClient.phone : "");
    setFqClientAddress(prefillClient ? prefillClient.address : "");
    setFqVoiceTranscript("");

    const combo = prefillCombo || catalog[0];
    if (combo) {
      setFqItems([{ title: combo.title, qty: 1, unitPrice: combo.price }]);
      setFqServiceSummary(combo.title);
    } else {
      setFqItems([{ title: "Servicio técnico", qty: 1, unitPrice: 250 }]);
      setFqServiceSummary("Servicio técnico");
    }
    setFqDepositPct(40);
    setFlashModalOpen(true);
  };

  const simulateVoiceNoteInModal = () => {
    const transcript =
      "Instalar equipo Split Inverter 4500 frigorías en primer piso con 4 metros de cañería de cobre y soporte exterior inoxidable.";
    setFqVoiceTranscript(transcript);
    setFqServiceSummary("Instalación Split Inverter 4500fg + 4m cañería cobre");
    setFqItems([
      { title: "Instalación equipo Inverter 4500/6000 fg", qty: 1, unitPrice: 380 },
      { title: "Metro adicional de cañería frigorífica", qty: 4, unitPrice: 45 },
      { title: "Materiales y repuestos (ménsulas inox)", qty: 1, unitPrice: 85 }
    ]);
  };

  const fqTotal = useMemo(
    () =>
      fqItems.reduce(
        (sum, it) => sum + (Number(it.qty) || 1) * (Number(it.unitPrice) || 0),
        0
      ),
    [fqItems]
  );
  const fqDepositAmount = Math.round((fqTotal * fqDepositPct) / 100);

  const handleCreateFlashQuote = (sendImmediately) => {
    if (!fqClientName.trim() || !fqClientPhone.trim()) {
      Alert.alert("Faltan datos", "Completá el nombre y WhatsApp del cliente.");
      return;
    }

    const nextNum =
      quotes.reduce((max, q) => {
        const n = parseInt((q.code || "").replace("COT-", ""), 10);
        return !isNaN(n) && n > max ? n : max;
      }, 1044) + 1;

    const normalizedItems = fqItems.map((it) => ({
      title: it.title,
      qty: Number(it.qty) || 1,
      unitPrice: Number(it.unitPrice) || 0,
      total: (Number(it.qty) || 1) * (Number(it.unitPrice) || 0)
    }));

    const newQuote = {
      id: `q-${nextNum}`,
      code: `COT-${nextNum}`,
      clientId: `cli-${Date.now()}`,
      clientName: fqClientName.trim(),
      clientPhone: fqClientPhone.trim(),
      clientAddress: fqClientAddress.trim() || "A coordinar",
      serviceSummary:
        fqServiceSummary.trim() || normalizedItems.map((i) => i.title).join(" + "),
      voiceTranscript: fqVoiceTranscript.trim(),
      items: normalizedItems,
      total: fqTotal,
      depositPct: fqDepositPct,
      depositAmount: fqDepositAmount,
      status: sendImmediately ? "waiting_reply" : "draft",
      createdAt: Date.now(),
      sentAt: sendImmediately ? Date.now() : null,
      remindedAt: null,
      approvedAt: null,
      paymentMethod: null,
      validityDays: 7
    };

    // Guardar cliente si no existe
    const existsClient = clients.some(
      (c) => c.name.toLowerCase() === newQuote.clientName.toLowerCase()
    );
    if (!existsClient) {
      setClients((prev) => [
        {
          id: newQuote.clientId,
          name: newQuote.clientName,
          phone: newQuote.clientPhone,
          address: newQuote.clientAddress,
          notes: newQuote.voiceTranscript || "Creado desde Cotización Flash",
          createdAt: Date.now()
        },
        ...prev
      ]);
    }

    setQuotes((prev) => [newQuote, ...prev]);
    setSelectedClientQuoteCode(newQuote.code);
    setFlashModalOpen(false);
    setMainSection("board");
    setInboxTab(sendImmediately ? "waiting_reply" : "draft");

    if (sendImmediately) {
      handleSendInitialWhatsApp(newQuote);
    }
  };

  // Filtrado de tarjetas en el tablero
  const filteredQuotes = useMemo(() => {
    const now = Date.now();
    const qLower = searchQuery.trim().toLowerCase();
    let list = quotes.filter((q) => {
      if (q.status !== inboxTab) return false;
      if (!qLower) return true;
      return `${q.code} ${q.clientName} ${q.clientPhone} ${q.serviceSummary}`
        .toLowerCase()
        .includes(qLower);
    });

    if (inboxTab === "waiting_reply" && onlyOverdue) {
      list = list.filter((q) => q.sentAt && now - q.sentAt >= HOUR_48_MS);
    }

    if (inboxTab === "waiting_reply") {
      list.sort((a, b) => {
        const aOver = a.sentAt && now - a.sentAt >= HOUR_48_MS ? 1 : 0;
        const bOver = b.sentAt && now - b.sentAt >= HOUR_48_MS ? 1 : 0;
        if (aOver !== bOver) return bOver - aOver;
        return (a.sentAt || 0) - (b.sentAt || 0);
      });
    }
    return list;
  }, [quotes, inboxTab, searchQuery, onlyOverdue]);

  const currentClientQuote = useMemo(() => {
    return (
      quotes.find((q) => q.code === selectedClientQuoteCode) ||
      quotes[0] ||
      null
    );
  }, [quotes, selectedClientQuoteCode]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor="#1A1A1A" />

      {/* ====================================================================
          BARRA SUPERIOR DE CAMBIO DE ROL (👷 Taller vs 👤 Cliente)
          ==================================================================== */}
      <View style={styles.roleSwitcherBar}>
        <View style={styles.roleTabsRow}>
          <TouchableOpacity
            style={[
              styles.roleTabBtn,
              roleMode === "workshop" && styles.roleTabActiveWorkshop
            ]}
            onPress={() => setRoleMode("workshop")}
          >
            <Text
              style={[
                styles.roleTabText,
                roleMode === "workshop" && styles.roleTabTextActiveWorkshop
              ]}
            >
              👷 1. Dueño del Taller
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.roleTabBtn,
              roleMode === "client" && styles.roleTabActiveClient
            ]}
            onPress={() => setRoleMode("client")}
          >
            <Text
              style={[
                styles.roleTabText,
                roleMode === "client" && styles.roleTabTextActiveClient
              ]}
            >
              👤 2. Vista del Cliente
            </Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.roleBanner,
            roleMode === "workshop" ? styles.roleBannerWorkshop : styles.roleBannerClient
          ]}
        >
          <Text style={styles.roleBannerText}>
            {roleMode === "workshop"
              ? "👷 Estás en tu App del Taller: Acá cotizás en 60s y controlás quién lleva +48hs sin responder."
              : "👤 Estás viendo como el Cliente: Esto es lo que recibe tu cliente al abrir el link de WhatsApp."}
          </Text>
        </View>
      </View>

      {/* ====================================================================
          MODO 1: 👷 VISTA DEL DUEÑO DEL TALLER
          ==================================================================== */}
      {roleMode === "workshop" ? (
        <View style={{ flex: 1 }}>
          {/* Cabecera con Mascota Coti */}
          <View style={styles.topHeader}>
            <TouchableOpacity
              style={styles.brandRow}
              onPress={() => setMascotModalOpen(true)}
            >
              <Image
                source={require("./assets/coti-badge.jpg")}
                style={styles.mascotAvatar}
              />
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.brandName}>Coti</Text>
                  <View style={styles.brandBadge}>
                    <Text style={styles.brandBadgeText}>TALLER</Text>
                  </View>
                </View>
                <Text style={styles.workshopSub} numberOfLines={1}>
                  {workshop.name}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryBtnSmall}
              onPress={() => openFlashQuoteModal()}
            >
              <Text style={styles.primaryBtnText}>+ Cotizar</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 100 }}
          >
            {/* Módulo C: Las 3 Métricas Clave */}
            <View style={styles.metricsContainer}>
              <View style={[styles.metricCard, { borderLeftWidth: 4, borderLeftColor: COLORS.amberBorder }]}>
                <Text style={styles.metricLabel}>1. DINERO EN LA CALLE</Text>
                <Text style={styles.metricValue}>
                  {formatUsd(metrics.dineroEnLaCalle)}
                </Text>
                <Text style={styles.metricSub}>
                  {metrics.counts.waiting_reply} esperando respuesta
                </Text>
              </View>

              <View style={styles.metricsRow2}>
                <View style={[styles.metricCardHalf, { borderLeftWidth: 4, borderLeftColor: COLORS.forest }]}>
                  <Text style={styles.metricLabel}>2. CERRADOS ESTE MES</Text>
                  <Text style={styles.metricValueSmall}>
                    {formatUsd(metrics.cerradosEsteMes)}
                  </Text>
                  <Text style={styles.metricSub}>
                    Señas: {formatUsd(metrics.senasCobradas)}
                  </Text>
                </View>

                <View style={styles.metricCardHalf}>
                  <Text style={styles.metricLabel}>3. CONVERSIÓN</Text>
                  <Text style={styles.metricValueSmall}>
                    {metrics.tasaConversion}%
                  </Text>
                  <Text style={styles.metricSub}>
                    {metrics.counts.approved} aprobados
                  </Text>
                </View>
              </View>
            </View>

            {/* Barra Asistente de Coti (Alerta de +48hs) */}
            <View
              style={[
                styles.cotiBar,
                metrics.counts.overdue48h > 0 && styles.cotiBarAlert
              ]}
            >
              <Image
                source={require("./assets/coti-mascot.jpg")}
                style={styles.cotiMiniAvatar}
              />
              <View style={{ flex: 1 }}>
                {metrics.counts.overdue48h > 0 ? (
                  <Text style={styles.cotiBarText}>
                    <Text style={{ fontWeight: "800" }}>¡Atención! </Text>
                    Tenés {metrics.counts.overdue48h} presupuesto(s) con +48hs sin respuesta.
                  </Text>
                ) : (
                  <Text style={styles.cotiBarText}>
                    <Text style={{ fontWeight: "800" }}>Coti al día: </Text>
                    Ningún presupuesto lleva más de 48hs colgado.
                  </Text>
                )}
              </View>
              {metrics.counts.overdue48h > 0 && (
                <TouchableOpacity
                  style={styles.amberBtnSmall}
                  onPress={() => {
                    setMainSection("board");
                    setInboxTab("waiting_reply");
                    setOnlyOverdue(!onlyOverdue);
                  }}
                >
                  <Text style={styles.amberBtnText}>
                    {onlyOverdue ? "Ver todos" : "⏰ Ver +48hs"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Navegación de Secciones del Taller */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.navScroll}
            >
              <TouchableOpacity
                style={[
                  styles.navPill,
                  mainSection === "board" && styles.navPillActive
                ]}
                onPress={() => setMainSection("board")}
              >
                <Text
                  style={[
                    styles.navPillText,
                    mainSection === "board" && styles.navPillTextActive
                  ]}
                >
                  📋 Tablero Inbox Zero
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.navPill,
                  mainSection === "clients" && styles.navPillActive
                ]}
                onPress={() => setMainSection("clients")}
              >
                <Text
                  style={[
                    styles.navPillText,
                    mainSection === "clients" && styles.navPillTextActive
                  ]}
                >
                  👥 Clientes ({clients.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.navPill,
                  mainSection === "catalog" && styles.navPillActive
                ]}
                onPress={() => setMainSection("catalog")}
              >
                <Text
                  style={[
                    styles.navPillText,
                    mainSection === "catalog" && styles.navPillTextActive
                  ]}
                >
                  🧰 Combos ({catalog.length})
                </Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Buscador instantáneo */}
            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="🔍 Buscar por cliente, teléfono o trabajo..."
                placeholderTextColor={COLORS.inkMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {/* SECCIÓN 1: TABLERO INBOX ZERO */}
            {mainSection === "board" && (
              <View>
                <View style={styles.inboxTabsRow}>
                  <TouchableOpacity
                    style={[
                      styles.inboxTab,
                      inboxTab === "waiting_reply" && styles.inboxTabActive
                    ]}
                    onPress={() => {
                      setInboxTab("waiting_reply");
                      setOnlyOverdue(false);
                    }}
                  >
                    <Text style={styles.inboxTabTitle}>En Espera</Text>
                    <Text style={styles.inboxTabCount}>
                      {metrics.counts.waiting_reply}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.inboxTab,
                      inboxTab === "draft" && styles.inboxTabActive
                    ]}
                    onPress={() => setInboxTab("draft")}
                  >
                    <Text style={styles.inboxTabTitle}>Por Enviar</Text>
                    <Text style={styles.inboxTabCount}>
                      {metrics.counts.draft}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.inboxTab,
                      inboxTab === "approved" && styles.inboxTabActive
                    ]}
                    onPress={() => setInboxTab("approved")}
                  >
                    <Text style={styles.inboxTabTitle}>Señados</Text>
                    <Text style={styles.inboxTabCount}>
                      {metrics.counts.approved}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ paddingHorizontal: 14, gap: 12 }}>
                  {filteredQuotes.map((q) => {
                    const isOverdue =
                      q.status === "waiting_reply" &&
                      q.sentAt &&
                      Date.now() - q.sentAt >= HOUR_48_MS;

                    return (
                      <View
                        key={q.id}
                        style={[
                          styles.quoteCard,
                          isOverdue && styles.quoteCardOverdue,
                          q.status === "approved" && styles.quoteCardApproved
                        ]}
                      >
                        <View style={styles.quoteCardHeader}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <Text style={styles.quoteCode}>{q.code}</Text>
                              {isOverdue ? (
                                <Text style={styles.badgeOverdue}>
                                  ⏰ +48hs sin respuesta
                                </Text>
                              ) : q.status === "waiting_reply" ? (
                                <Text style={styles.badgeWaiting}>
                                  ⏳ {formatHoursAgo(q.sentAt)}
                                </Text>
                              ) : q.status === "approved" ? (
                                <Text style={styles.badgeApproved}>
                                  ✓ Seña Pagada ({q.paymentMethod})
                                </Text>
                              ) : (
                                <Text style={styles.badgeWaiting}>📝 Borrador</Text>
                              )}
                            </View>
                            <Text style={styles.clientName}>
                              Cliente: {q.clientName}
                            </Text>
                            <Text style={styles.clientPhone}>
                              📞 {q.clientPhone}
                            </Text>
                          </View>

                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={styles.quoteTotal}>
                              {formatUsd(q.total)}
                            </Text>
                            <Text style={styles.quoteDeposit}>
                              Seña ({q.depositPct}%): {formatUsd(q.depositAmount)}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.quoteSummary}>
                          {q.serviceSummary}
                        </Text>

                        {Boolean(q.voiceTranscript) && (
                          <View style={styles.voiceBoxNote}>
                            <Text style={styles.voiceBoxNoteText}>
                              🎙️ Nota de voz: "{q.voiceTranscript}"
                            </Text>
                          </View>
                        )}

                        {/* EL SUPERPODER DE LAS 48 HORAS */}
                        {isOverdue && (
                          <View style={styles.superpowerBox}>
                            <Text style={styles.superpowerTitle}>
                              ⚡ PASARON +48HS SIN RESPUESTA DEL CLIENTE
                            </Text>
                            <Text style={styles.superpowerPreview}>
                              "{build48hReminderMessage(q)}"
                            </Text>
                            <TouchableOpacity
                              style={styles.amberBtnFull}
                              onPress={() => handleSend48hReminder(q)}
                            >
                              <Text style={styles.amberBtnText}>
                                📲 Mandar recordatorio por WhatsApp
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <View style={styles.cardActionsRow}>
                          {q.status === "draft" && (
                            <TouchableOpacity
                              style={styles.primaryBtnFull}
                              onPress={() => handleSendInitialWhatsApp(q)}
                            >
                              <Text style={styles.primaryBtnText}>
                                📲 Enviar Presupuesto por WhatsApp
                              </Text>
                            </TouchableOpacity>
                          )}

                          <TouchableOpacity
                            style={styles.secondaryBtnFull}
                            onPress={() => {
                              setSelectedClientQuoteCode(q.code);
                              setRoleMode("client");
                            }}
                          >
                            <Text style={styles.secondaryBtnText}>
                              👤 Ver cómo lo ve {q.clientName.split(" ")[0]} (Vista Cliente)
                            </Text>
                          </TouchableOpacity>

                          {q.status === "waiting_reply" && !isOverdue && (
                            <TouchableOpacity
                              style={styles.demoBtn}
                              onPress={() => handleSimulate48Hours(q.id)}
                            >
                              <Text style={styles.demoBtnText}>
                                🧪 Demo: Adelantar reloj +48hs para probar alerta
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* SECCIÓN 2: AGENDA DE CLIENTES */}
            {mainSection === "clients" && (
              <View style={{ paddingHorizontal: 14, gap: 12 }}>
                {clients.map((c) => {
                  const cQuotes = quotes.filter(
                    (q) => q.clientName.toLowerCase() === c.name.toLowerCase()
                  );
                  return (
                    <View key={c.id} style={styles.quoteCard}>
                      <Text style={styles.clientName}>{c.name}</Text>
                      <Text style={styles.clientPhone}>📞 {c.phone}</Text>
                      <Text style={styles.metricSub}>📍 {c.address}</Text>
                      <View style={{ marginTop: 10, gap: 6 }}>
                        <TouchableOpacity
                          style={styles.secondaryBtnFull}
                          onPress={() => openFlashQuoteModal(c, null)}
                        >
                          <Text style={styles.secondaryBtnText}>
                            + Nueva Cotización a {c.name.split(" ")[0]} ({cQuotes.length} previas)
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* SECCIÓN 3: CATÁLOGO DE COMBOS */}
            {mainSection === "catalog" && (
              <View style={{ paddingHorizontal: 14, gap: 12 }}>
                <View style={styles.quoteCard}>
                  <Text style={styles.clientName}>+ Nuevo Combo Rápido</Text>
                  <TextInput
                    style={[styles.fieldInput, { marginTop: 8 }]}
                    placeholder="Nombre del combo (ej. Mantenimiento A/A)"
                    value={newCatTitle}
                    onChangeText={setNewCatTitle}
                  />
                  <TextInput
                    style={[styles.fieldInput, { marginTop: 8 }]}
                    placeholder="Precio en USD (ej. 120)"
                    keyboardType="numeric"
                    value={newCatPrice}
                    onChangeText={setNewCatPrice}
                  />
                  <TouchableOpacity
                    style={[styles.primaryBtnFull, { marginTop: 10 }]}
                    onPress={() => {
                      if (!newCatTitle.trim() || !newCatPrice) return;
                      setCatalog((prev) => [
                        {
                          id: `cat-${Date.now()}`,
                          title: newCatTitle.trim(),
                          category: newCatCategory || "Oficio",
                          price: Number(newCatPrice) || 100,
                          description: newCatDesc || "Combo de taller"
                        },
                        ...prev
                      ]);
                      setNewCatTitle("");
                      setNewCatPrice("");
                    }}
                  >
                    <Text style={styles.primaryBtnText}>Guardar Combo</Text>
                  </TouchableOpacity>
                </View>

                {catalog.map((cat) => (
                  <View key={cat.id} style={styles.quoteCard}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.quoteCode}>{cat.category}</Text>
                        <Text style={styles.clientName}>{cat.title}</Text>
                        <Text style={styles.metricSub}>{cat.description}</Text>
                      </View>
                      <Text style={styles.quoteTotal}>{formatUsd(cat.price)}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.secondaryBtnFull, { marginTop: 10 }]}
                      onPress={() => openFlashQuoteModal(null, cat)}
                    >
                      <Text style={styles.secondaryBtnText}>
                        ⚡ Usar este combo en Cotización Flash
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Barra Inferior Flotante para Cotizar en 60 Segundos */}
          <View style={styles.bottomFloatingBar}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <Image
                source={require("./assets/coti-mascot.jpg")}
                style={styles.bottomMascot}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 13, color: COLORS.ink }}>
                  Cotizá en 60 segundos
                </Text>
                <Text style={{ fontSize: 11, color: COLORS.inkSecondary }}>
                  3 clics · Link Web + Seña + WhatsApp
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.primaryBtnSmall}
              onPress={() => openFlashQuoteModal()}
            >
              <Text style={styles.primaryBtnText}>⚡ Nueva Cotización</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* ====================================================================
           MODO 2: 👤 VISTA DEL CLIENTE FINAL (EL LINK QUE RECIBE POR WHATSAPP)
           ==================================================================== */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
        >
          {/* Selector de cuál presupuesto está viendo el cliente */}
          <View style={styles.clientPickerCard}>
            <Text style={styles.metricLabel}>
              ELEGÍ QUÉ PRESUPUESTO ESTÁS MIRANDO COMO CLIENTE:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, marginTop: 8 }}
            >
              {quotes.map((q) => (
                <TouchableOpacity
                  key={q.id}
                  style={[
                    styles.navPill,
                    selectedClientQuoteCode === q.code && styles.navPillActive
                  ]}
                  onPress={() => setSelectedClientQuoteCode(q.code)}
                >
                  <Text
                    style={[
                      styles.navPillText,
                      selectedClientQuoteCode === q.code && styles.navPillTextActive
                    ]}
                  >
                    {q.code} · {q.clientName.split(" ")[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {currentClientQuote && (
            <View style={styles.remitoSheet}>
              <View style={styles.remitoHeader}>
                <Image
                  source={require("./assets/coti-badge.jpg")}
                  style={styles.mascotAvatar}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, fontWeight: "800", color: COLORS.forest }}>
                    PRESUPUESTO OFICIAL DE SERVICIO
                  </Text>
                  <Text style={styles.clientName}>{workshop.name}</Text>
                  <Text style={styles.metricSub}>
                    Resp: {workshop.owner} · {workshop.phone}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.quoteCode}>{currentClientQuote.code}</Text>
                  <Text style={styles.metricSub}>
                    {formatDate(currentClientQuote.createdAt)}
                  </Text>
                </View>
              </View>

              <View style={styles.remitoSection}>
                <Text style={styles.metricLabel}>PREPARADO PARA EL CLIENTE:</Text>
                <Text style={styles.clientName}>{currentClientQuote.clientName}</Text>
                <Text style={styles.metricSub}>
                  {currentClientQuote.clientAddress} · {currentClientQuote.clientPhone}
                </Text>
                <Text style={[styles.quoteSummary, { marginTop: 8 }]}>
                  Trabajo: {currentClientQuote.serviceSummary}
                </Text>
              </View>

              <View style={styles.remitoSection}>
                <Text style={styles.metricLabel}>DETALLE DE ÍTEMS:</Text>
                {(currentClientQuote.items || []).map((it, idx) => (
                  <View
                    key={idx}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.subtle
                    }}
                  >
                    <Text style={{ flex: 1, fontSize: 13, color: COLORS.ink }}>
                      {it.qty}x {it.title}
                    </Text>
                    <Text style={{ fontFamily: MONO_FONT, fontWeight: "700" }}>
                      {formatUsd(it.total)}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={[styles.remitoSection, { backgroundColor: COLORS.subtle }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontWeight: "800", fontSize: 15 }}>VALOR TOTAL</Text>
                  <Text style={styles.quoteTotal}>
                    {formatUsd(currentClientQuote.total)}
                  </Text>
                </View>
                <View style={styles.depositHighlightBox}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", color: COLORS.forest, fontSize: 12 }}>
                      SEÑA PARA RESERVAR TURNO ({currentClientQuote.depositPct}%)
                    </Text>
                    <Text style={{ fontSize: 11, color: COLORS.inkSecondary }}>
                      Saldo al finalizar: {formatUsd(currentClientQuote.total - currentClientQuote.depositAmount)}
                    </Text>
                  </View>
                  <Text style={[styles.quoteTotal, { color: COLORS.forest }]}>
                    {formatUsd(currentClientQuote.depositAmount)}
                  </Text>
                </View>
              </View>

              <View style={{ padding: 16 }}>
                {currentClientQuote.status === "approved" ? (
                  <View style={styles.approvedBox}>
                    <Text style={{ fontWeight: "800", color: COLORS.forest, fontSize: 15 }}>
                      ✓ PRESUPUESTO ACEPTADO Y SEÑADO
                    </Text>
                    <Text style={{ fontSize: 12, color: COLORS.inkSecondary, marginTop: 4 }}>
                      Seña de {formatUsd(currentClientQuote.depositAmount)} abonada vía{" "}
                      {currentClientQuote.paymentMethod || "Mercado Pago"}.
                    </Text>
                    <TouchableOpacity
                      style={[styles.primaryBtnFull, { marginTop: 12 }]}
                      onPress={() => {
                        setInboxTab("approved");
                        setRoleMode("workshop");
                      }}
                    >
                      <Text style={styles.primaryBtnText}>
                        👷 Volver a la App del Taller para verlo en 'Señados' →
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.metricLabel}>
                      ELEGÍ MEDIO DE PAGO PARA ABONAR LA SEÑA:
                    </Text>
                    <View style={{ flexDirection: "row", gap: 6, marginVertical: 10 }}>
                      {["Mercado Pago", "Transferencia", "Stripe"].map((gw) => (
                        <TouchableOpacity
                          key={gw}
                          style={[
                            styles.gatewayBtn,
                            selectedGateway === gw && styles.gatewayBtnActive
                          ]}
                          onPress={() => setSelectedGateway(gw)}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: "700",
                              color: selectedGateway === gw ? COLORS.forest : COLORS.ink
                            }}
                          >
                            {gw}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {selectedGateway === "Transferencia" && (
                      <Text style={{ fontSize: 12, marginBottom: 10, fontFamily: MONO_FONT }}>
                        Alias: {workshop.alias} · CBU: {workshop.cbu}
                      </Text>
                    )}

                    <TouchableOpacity
                      style={styles.primaryBtnFull}
                      onPress={() => handleClientPayDeposit(currentClientQuote.id)}
                    >
                      <Text style={styles.primaryBtnText}>
                        ✓ Aceptar presupuesto y señar {formatUsd(currentClientQuote.depositAmount)}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* ====================================================================
          MODAL NATIVO: COTIZACIÓN FLASH EN 3 CLICS
          ==================================================================== */}
      <Modal visible={flashModalOpen} animationType="slide">
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.topHeader}>
            <Text style={styles.brandName}>⚡ Cotización Flash (3 Clics)</Text>
            <TouchableOpacity
              style={styles.navPill}
              onPress={() => setFlashModalOpen(false)}
            >
              <Text style={styles.navPillText}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 40 }}>
            {/* PASO 1 */}
            <View style={styles.quoteCard}>
              <Text style={styles.clientName}>1. Cliente y WhatsApp</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, marginVertical: 8 }}
              >
                {clients.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.navPill}
                    onPress={() => {
                      setFqClientName(c.name);
                      setFqClientPhone(c.phone);
                      setFqClientAddress(c.address || "");
                    }}
                  >
                    <Text style={styles.navPillText}>👤 {c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TextInput
                style={styles.fieldInput}
                placeholder="Nombre del cliente *"
                value={fqClientName}
                onChangeText={setFqClientName}
              />
              <TextInput
                style={[styles.fieldInput, { marginTop: 8 }]}
                placeholder="Teléfono / WhatsApp *"
                keyboardType="phone-pad"
                value={fqClientPhone}
                onChangeText={setFqClientPhone}
              />
              <TextInput
                style={[styles.fieldInput, { marginTop: 8 }]}
                placeholder="Dirección / Obra"
                value={fqClientAddress}
                onChangeText={setFqClientAddress}
              />
            </View>

            {/* PASO 2 */}
            <View style={styles.quoteCard}>
              <Text style={styles.clientName}>2. Elegí un Combo o Nota de Voz</Text>
              <View style={{ gap: 6, marginTop: 8 }}>
                {catalog.slice(0, 4).map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={styles.comboBtn}
                    onPress={() => {
                      setFqItems([{ title: cat.title, qty: 1, unitPrice: cat.price }]);
                      setFqServiceSummary(cat.title);
                    }}
                  >
                    <Text style={{ fontWeight: "700", flex: 1, fontSize: 13 }}>
                      {cat.title}
                    </Text>
                    <Text style={{ fontFamily: MONO_FONT, fontWeight: "800", color: COLORS.forest }}>
                      {formatUsd(cat.price)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.secondaryBtnFull, { marginTop: 10 }]}
                onPress={simulateVoiceNoteInModal}
              >
                <Text style={styles.secondaryBtnText}>
                  🎙️ Simular Nota de Voz Transcrita en Taller
                </Text>
              </TouchableOpacity>
            </View>

            {/* PASO 3 */}
            <View style={styles.quoteCard}>
              <Text style={styles.clientName}>3. Adicionales y Seña</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, marginVertical: 8 }}
              >
                {quickAddons.map((add) => (
                  <TouchableOpacity
                    key={add.id}
                    style={styles.navPill}
                    onPress={() =>
                      setFqItems((prev) => [
                        ...prev,
                        { title: add.title, qty: 1, unitPrice: add.price }
                      ])
                    }
                  >
                    <Text style={styles.navPillText}>
                      {add.label} (${add.price})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {fqItems.map((it, idx) => (
                <View
                  key={idx}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.subtle
                  }}
                >
                  <Text style={{ flex: 1, fontSize: 13 }}>
                    {it.qty}x {it.title}
                  </Text>
                  <Text style={{ fontFamily: MONO_FONT, fontWeight: "700" }}>
                    {formatUsd(it.qty * it.unitPrice)}
                  </Text>
                </View>
              ))}

              <View style={styles.totalBlackBar}>
                <View>
                  <Text style={{ color: "#D5D1C7", fontSize: 11 }}>TOTAL</Text>
                  <Text style={{ color: "#FFF", fontFamily: MONO_FONT, fontSize: 18, fontWeight: "800" }}>
                    {formatUsd(fqTotal)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: "#A7F3D0", fontSize: 11 }}>
                    SEÑA ({fqDepositPct}%)
                  </Text>
                  <Text style={{ color: "#A7F3D0", fontFamily: MONO_FONT, fontSize: 16, fontWeight: "800" }}>
                    {formatUsd(fqDepositAmount)}
                  </Text>
                </View>
              </View>

              <View style={{ gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  style={styles.primaryBtnFull}
                  onPress={() => handleCreateFlashQuote(true)}
                >
                  <Text style={styles.primaryBtnText}>
                    📲 Crear y Enviar por WhatsApp
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtnFull}
                  onPress={() => handleCreateFlashQuote(false)}
                >
                  <Text style={styles.secondaryBtnText}>
                    Guardar en 'Por Enviar'
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ====================================================================
          MODAL MASCOTA: COTI, EL HORNERO DE OFICIO
          ==================================================================== */}
      <Modal visible={mascotModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.mascotDialog}>
            <Image
              source={require("./assets/coti-mascot.jpg")}
              style={styles.mascotHeroImg}
            />
            <Text style={[styles.clientName, { textAlign: "center", marginTop: 10 }]}>
              🐦 Coti, el Hornero de Oficio
            </Text>
            <Text style={{ fontSize: 13, color: COLORS.inkSecondary, textAlign: "center", marginVertical: 8 }}>
              "Cotizá en 60 segundos desde tu celular, cerrá señas por link y asegurá el seguimiento sin pensar."
            </Text>
            <TouchableOpacity
              style={styles.primaryBtnFull}
              onPress={() => setMascotModalOpen(false)}
            >
              <Text style={styles.primaryBtnText}>¡Entendido!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bone,
    paddingTop: Platform.OS === "android" ? RNStatusBar.currentHeight : 0
  },
  roleSwitcherBar: {
    backgroundColor: COLORS.ink,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  roleTabsRow: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#2C2C2A",
    padding: 4,
    borderRadius: 6
  },
  roleTabBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8
  },
  roleTabActiveWorkshop: {
    backgroundColor: COLORS.bone
  },
  roleTabActiveClient: {
    backgroundColor: "#A7F3D0"
  },
  roleTabText: {
    color: "#D5D1C7",
    fontSize: 12,
    fontWeight: "700"
  },
  roleTabTextActiveWorkshop: {
    color: COLORS.ink,
    fontWeight: "800"
  },
  roleTabTextActiveClient: {
    color: "#143629",
    fontWeight: "800"
  },
  roleBanner: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4
  },
  roleBannerWorkshop: {
    backgroundColor: "#2A2927",
    borderLeftWidth: 3,
    borderLeftColor: "#F59E0B"
  },
  roleBannerClient: {
    backgroundColor: "#143629",
    borderLeftWidth: 3,
    borderLeftColor: "#A7F3D0"
  },
  roleBannerText: {
    color: "#EAE6DC",
    fontSize: 11,
    fontWeight: "600"
  },
  topHeader: {
    backgroundColor: COLORS.paper,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.ink,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1
  },
  mascotAvatar: {
    width: 46,
    height: 46,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: COLORS.ink
  },
  brandName: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.ink
  },
  brandBadge: {
    backgroundColor: COLORS.forestTint,
    borderWidth: 1,
    borderColor: COLORS.forest,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  brandBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.forest,
    fontFamily: MONO_FONT
  },
  workshopSub: {
    fontSize: 12,
    color: COLORS.inkSecondary,
    fontWeight: "600"
  },
  metricsContainer: {
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8
  },
  metricCard: {
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.ink,
    borderRadius: 6,
    padding: 12
  },
  metricsRow2: {
    flexDirection: "row",
    gap: 8
  },
  metricCardHalf: {
    flex: 1,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.ink,
    borderRadius: 6,
    padding: 12
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.inkSecondary,
    letterSpacing: 0.4
  },
  metricValue: {
    fontFamily: MONO_FONT,
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.ink,
    marginTop: 2
  },
  metricValueSmall: {
    fontFamily: MONO_FONT,
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.ink,
    marginTop: 2
  },
  metricSub: {
    fontSize: 11,
    color: COLORS.inkMuted,
    marginTop: 2
  },
  cotiBar: {
    marginHorizontal: 14,
    marginTop: 10,
    backgroundColor: COLORS.paper,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    borderRadius: 6,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  cotiBarAlert: {
    backgroundColor: COLORS.amberBg,
    borderColor: COLORS.amberBorder
  },
  cotiMiniAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.ink
  },
  cotiBarText: {
    fontSize: 12,
    color: COLORS.ink
  },
  navScroll: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8
  },
  navPill: {
    minHeight: 42,
    paddingHorizontal: 14,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  navPillActive: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink
  },
  navPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.inkSecondary
  },
  navPillTextActive: {
    color: "#FFFFFF"
  },
  searchWrap: {
    paddingHorizontal: 14,
    marginBottom: 8
  },
  searchInput: {
    minHeight: 46,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.ink,
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.ink
  },
  inboxTabsRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 10
  },
  inboxTab: {
    flex: 1,
    minHeight: 48,
    backgroundColor: COLORS.subtle,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  inboxTabActive: {
    backgroundColor: COLORS.paper,
    borderWidth: 2,
    borderColor: COLORS.ink
  },
  inboxTabTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.ink
  },
  inboxTabCount: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: COLORS.forest,
    color: "#FFF",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  quoteCard: {
    backgroundColor: COLORS.paper,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    borderRadius: 6,
    padding: 14
  },
  quoteCardOverdue: {
    backgroundColor: COLORS.amberBg,
    borderWidth: 2,
    borderColor: COLORS.amberBorder
  },
  quoteCardApproved: {
    borderLeftWidth: 5,
    borderLeftColor: COLORS.forest
  },
  quoteCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 8,
    marginBottom: 8
  },
  quoteCode: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: COLORS.subtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    color: COLORS.ink
  },
  badgeOverdue: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.amberInk,
    backgroundColor: COLORS.amberTint,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  badgeWaiting: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.inkSecondary
  },
  badgeApproved: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.forest
  },
  clientName: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
    marginTop: 4
  },
  clientPhone: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: COLORS.inkSecondary,
    marginTop: 2
  },
  quoteTotal: {
    fontFamily: MONO_FONT,
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink
  },
  quoteDeposit: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.forest
  },
  quoteSummary: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.ink,
    marginBottom: 8
  },
  voiceBoxNote: {
    backgroundColor: COLORS.subtle,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.ink,
    padding: 8,
    marginBottom: 8
  },
  voiceBoxNoteText: {
    fontSize: 12,
    color: COLORS.inkSecondary,
    fontStyle: "italic"
  },
  superpowerBox: {
    backgroundColor: COLORS.amberTint,
    borderWidth: 1.5,
    borderColor: COLORS.amberBorder,
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
    gap: 8
  },
  superpowerTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.amberInk
  },
  superpowerPreview: {
    fontSize: 12,
    color: COLORS.ink,
    fontStyle: "italic",
    backgroundColor: "#FFF",
    padding: 8,
    borderRadius: 4
  },
  cardActionsRow: {
    gap: 8,
    marginTop: 4
  },
  primaryBtnSmall: {
    minHeight: 44,
    paddingHorizontal: 14,
    backgroundColor: COLORS.forest,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryBtnFull: {
    minHeight: 48,
    backgroundColor: COLORS.forest,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14
  },
  secondaryBtnFull: {
    minHeight: 48,
    backgroundColor: COLORS.paper,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  secondaryBtnText: {
    color: COLORS.ink,
    fontWeight: "800",
    fontSize: 13
  },
  amberBtnSmall: {
    minHeight: 38,
    paddingHorizontal: 10,
    backgroundColor: COLORS.amberBorder,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  amberBtnFull: {
    minHeight: 48,
    backgroundColor: COLORS.amberBorder,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  amberBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13
  },
  demoBtn: {
    paddingVertical: 6,
    alignItems: "center"
  },
  demoBtnText: {
    fontSize: 11,
    color: COLORS.inkMuted,
    textDecorationLine: "underline"
  },
  bottomFloatingBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.paper,
    borderTopWidth: 2,
    borderTopColor: COLORS.ink,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  bottomMascot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.ink
  },
  clientPickerCard: {
    backgroundColor: COLORS.paper,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    borderRadius: 6,
    padding: 12,
    marginBottom: 12
  },
  remitoSheet: {
    backgroundColor: COLORS.paper,
    borderWidth: 2,
    borderColor: COLORS.ink,
    borderRadius: 8,
    overflow: "hidden"
  },
  remitoHeader: {
    padding: 14,
    backgroundColor: COLORS.bone,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.ink,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  remitoSection: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  depositHighlightBox: {
    marginTop: 10,
    backgroundColor: COLORS.forestTint,
    borderWidth: 1.5,
    borderColor: COLORS.forest,
    borderRadius: 6,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  gatewayBtn: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bone
  },
  gatewayBtnActive: {
    borderColor: COLORS.forest,
    backgroundColor: COLORS.forestTint
  },
  approvedBox: {
    backgroundColor: COLORS.forestTint,
    borderWidth: 1.5,
    borderColor: COLORS.forest,
    borderRadius: 6,
    padding: 14,
    alignItems: "center"
  },
  fieldInput: {
    minHeight: 46,
    backgroundColor: COLORS.bone,
    borderWidth: 1,
    borderColor: COLORS.ink,
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.ink
  },
  comboBtn: {
    minHeight: 48,
    backgroundColor: COLORS.bone,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  totalBlackBar: {
    backgroundColor: COLORS.ink,
    borderRadius: 6,
    padding: 12,
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(26,26,26,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  mascotDialog: {
    backgroundColor: COLORS.paper,
    borderWidth: 2,
    borderColor: COLORS.ink,
    borderRadius: 10,
    padding: 20,
    width: "100%",
    maxWidth: 380,
    alignItems: "center"
  },
  mascotHeroImg: {
    width: 150,
    height: 150,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.ink
  }
});
