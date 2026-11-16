(() => {
  "use strict";
  const STORAGE_KEY = "meuDinheiro.v1";
  const SETTINGS_KEY = "meuDinheiro.jsonbin";
  const PERIOD_WIDGET_KEY = "meuDinheiro.periodWidget";
  const PATIENT_VIEW_KEY = "meuDinheiro.patientView";
  const TRANSACTION_VIEW_KEY = "meuDinheiro.transactionView";
  const EXPENSE_CATEGORIES = [
    "Aluguel do consultório",
    "Água, luz e internet",
    "Materiais clínicos",
    "Formação e supervisão",
    "Impostos e contabilidade",
    "Transporte",
    "Marketing e divulgação",
    "Plataformas e softwares",
    "Taxas bancárias",
    "Emergências",
    "Outros",
  ];
  const INCOME_CATEGORIES = [
    "Salário",
    "Atendimentos clínicos",
    "Pacotes de sessões",
    "Avaliações psicológicas",
    "Cursos e palestras",
    "Supervisão profissional",
    "Reembolsos",
    "Outros",
  ];
  // Categorias que deixaram de ser sugeridas. Entradas antigas continuam
  // preservadas, mas essas opções não devem aparecer em novos lançamentos.
  const RETIRED_CATEGORIES = new Set([
    "Internet",
    "Moto",
    "Moto/Bike",
    "Remédio",
    "Remedio",
    "Gasolina",
    "Gazolina",
    "Ferias",
    "Férias",
    "Cartão",
    "Psicóloga",
    "Piscicologa",
    "psicologa",
    "Udemy",
  ]);
  const normalizeCategory = (category) =>
    String(category || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase("pt-BR");
  const retiredCategoryNames = new Set(
    [...RETIRED_CATEGORIES, "Gazolina"].map(normalizeCategory),
  );
  const isRetiredCategory = (category) =>
    retiredCategoryNames.has(normalizeCategory(category));
  const DEFAULT_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  const COLORS = [
    "#4d9a7e",
    "#f0a084",
    "#7094c4",
    "#e0bc62",
    "#a487c7",
    "#63aeba",
    "#d67e91",
    "#8ca76b",
    "#e28c54",
    "#6c7e89",
    "#b09278",
    "#dc719c",
    "#688ac1",
    "#83ae9b",
  ];
  const MONTHS = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const $ = (selector) => document.querySelector(selector);
  const localMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };
  const readPatientView = () => {
    try {
      return localStorage.getItem(PATIENT_VIEW_KEY) === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  };
  const readTransactionView = () => {
    try {
      return localStorage.getItem(TRANSACTION_VIEW_KEY) === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  };
  const state = {
    entries: [],
    patients: [],
    clinicSessions: [],
    pendingSessionDelete: "",
    pendingPatientDelete: "",
    pendingSessionChange: null,
    pendingPatientSave: null,
    potPercentages: { accounts: 50, wishes: 30, future: 20 },
    categories: [...DEFAULT_CATEGORIES],
    importedThrough: {},
    activeMonth: localMonth(),
    filters: { type: "all", month: "" },
    showAll: false,
    patientView: readPatientView(),
    transactionView: readTransactionView(),
    settings: readSettings(),
    charts: {},
  };
  const money = (value, compact = false) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    }).format(value);
  const uid = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const escapeHtml = (text) =>
    String(text ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function readLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return data && Array.isArray(data.entries) ? data : null;
    } catch {
      return null;
    }
  }
  async function boot() {
    const local = readLocal();
    if (local) {
      state.entries = local.entries;
      state.patients = Array.isArray(local.patients) ? local.patients : [];
      state.clinicSessions = Array.isArray(local.clinicSessions) ? local.clinicSessions : [];
      state.potPercentages = { ...state.potPercentages, ...(local.potPercentages || {}) };
      state.categories = mergeCategories(local.categories || []);
      state.importedThrough = mergeStatementCheckpoints(
        local.importedThrough,
        state.entries,
      );
      alignInitialMonth();
    } else if (state.settings.binId && state.settings.key) {
      try {
        const remote = await binRequest("GET");
        applyData(remote.record || remote);
        alignInitialMonth();
        persistLocal();
        toast("Dados recuperados do JSONBin.");
      } catch {
        toast("Não foi possível buscar os dados do JSONBin.");
      }
    }
    if (generateRecurringEntries()) {
      alignInitialMonth();
      await saveRecurringEntries();
    }
    render();
    bind();
    updateSyncLabel();
  }
  function mergeCategories(items) {
    return [...new Set([...DEFAULT_CATEGORIES, ...items].filter(Boolean))];
  }
  function mergeStatementCheckpoints(checkpoints, entries = state.entries) {
    const merged = { ...inferStatementCheckpoints(entries) };
    for (const source of ["mercado-pago", "nubank"]) {
      const savedDate = checkpoints?.[source];
      if (/^\d{4}-\d{2}-\d{2}$/.test(savedDate || ""))
        merged[source] =
          merged[source] && merged[source] > savedDate
            ? merged[source]
            : savedDate;
    }
    return merged;
  }
  function inferStatementCheckpoints(entries = []) {
    const checkpoints = {};
    for (const entry of entries) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "") ||
        !["Importado de extrato PDF", "Total de rendimentos do extrato PDF"].includes(entry.note)
      )
        continue;
      const operationIds = [
        entry.externalId,
        ...(entry.externalOperations || []).map((operation) => operation.id),
      ].filter(Boolean);
      const source =
        entry.importSource === "nubank" ||
        operationIds.some((id) => String(id).startsWith("nubank:"))
          ? "nubank"
          : "mercado-pago";
      if (!checkpoints[source] || entry.date > checkpoints[source])
        checkpoints[source] = entry.date;
    }
    return checkpoints;
  }
  function statementSource(entries) {
    return entries.some(
      (entry) =>
        entry.importSource === "nubank" ||
        String(entry.externalId || "").startsWith("nubank:") ||
        (entry.externalOperations || []).some((operation) =>
          String(operation.id).startsWith("nubank:"),
        ),
    )
      ? "nubank"
      : "mercado-pago";
  }
  function latestStatementDate(entries) {
    return entries.reduce(
      (latest, entry) =>
        /^\d{4}-\d{2}-\d{2}$/.test(entry.date || "") && entry.date > latest
          ? entry.date
          : latest,
      "",
    );
  }
  function formatStatementDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return date || "";
    const [year, month, day] = date.split("-").map(Number);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  function dataRecord() {
    return {
      entries: state.entries,
      patients: state.patients,
      clinicSessions: state.clinicSessions,
      potPercentages: state.potPercentages,
      categories: state.categories,
      importedThrough: state.importedThrough,
      updatedAt: new Date().toISOString(),
    };
  }
  function generateRecurringEntries() {
    const today = new Date(),
      currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    let changed = false;
    state.entries
      .filter((entry) => entry.recurring && entry.date)
      .forEach((source) => {
        const rootId = source.recurrenceId || source.id,
          start = source.date.slice(0, 7),
          lastMonth = source.recurringUntil?.slice(0, 7) || currentMonth;
        const existing = new Set(
          state.entries
            .filter((item) => item.recurrenceId === rootId)
            .map((item) => item.recurrenceMonth || item.date?.slice(0, 7)),
        );
        let [year, month] = start.split("-").map(Number);
        month++;
        while (
          `${year}-${String(month).padStart(2, "0")}` <= currentMonth &&
          `${year}-${String(month).padStart(2, "0")}` <= lastMonth
        ) {
          const monthKey = `${year}-${String(month).padStart(2, "0")}`,
            recurrenceDay = Number(source.recurrenceDay || source.date.slice(8, 10)),
            day = Math.min(recurrenceDay, new Date(year, month, 0).getDate());
          if (!existing.has(monthKey)) {
            state.entries.push({
              ...source,
              id: uid(),
              date: `${monthKey}-${String(day).padStart(2, "0")}`,
              recurrenceDay,
              recurring: false,
              recurrenceId: rootId,
              recurrenceMonth: monthKey,
            });
            existing.add(monthKey);
            changed = true;
          }
          if (++month > 12) {
            month = 1;
            year++;
          }
        }
      });
    return changed;
  }
  async function saveRecurringEntries() {
    persistLocal();
    if (state.settings.binId && state.settings.key) {
      try {
        await binRequest("PUT", {
          ...dataRecord(),
        });
      } catch {
        updateSyncLabel("Salvo neste dispositivo");
      }
    }
  }
  function alignInitialMonth() {
    const latest = state.entries.reduce(
      (max, e) => (e.date?.slice(0, 7) > max ? e.date.slice(0, 7) : max),
      state.activeMonth,
    );
    state.activeMonth = latest;
  }
  function applyData(data) {
    if (data && Array.isArray(data.entries)) {
      state.entries = data.entries;
      state.patients = Array.isArray(data.patients) ? data.patients : [];
      state.clinicSessions = Array.isArray(data.clinicSessions) ? data.clinicSessions : [];
      state.potPercentages = { ...state.potPercentages, ...(data.potPercentages || {}) };
      state.categories = mergeCategories(data.categories || []);
      state.importedThrough = mergeStatementCheckpoints(
        data.importedThrough,
        state.entries,
      );
      persistLocal();
    }
  }
  function persistLocal() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          entries: state.entries,
          patients: state.patients,
          clinicSessions: state.clinicSessions,
          potPercentages: state.potPercentages,
          categories: state.categories,
          importedThrough: state.importedThrough,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch {
      toast(
        "O armazenamento local está cheio. Exporte seus dados para liberar espaço.",
      );
    }
  }
  async function saveData(message = "Movimentação salva.") {
    persistLocal();
    render();
    if (state.settings.binId && state.settings.key) {
      updateSyncLabel("Sincronizando…");
      try {
        await binRequest("PUT", {
          ...dataRecord(),
        });
        updateSyncLabel("Sincronizado com JSONBin");
        toast(message);
      } catch (error) {
        updateSyncLabel("Salvo neste dispositivo");
        toast(`${message} JSONBin indisponível; os dados locais estão salvos.`);
      }
    } else {
      updateSyncLabel();
      toast(message);
    }
  }
  async function binRequest(method, body) {
    const { binId, key } = state.settings;
    if (!binId || !key) throw Error("Configure o JSONBin nas configurações.");
    const url = `https://api.jsonbin.io/v3/b/${encodeURIComponent(binId)}${method === "GET" ? "/latest" : ""}`;
    const response = await fetch(url, {
      method,
      ...(method === "GET" ? { cache: "no-store" } : {}),
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": key,
        ...(method === "PUT" ? { "X-Bin-Versioning": "false" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Error(`JSONBin respondeu ${response.status}`);
    return response.json();
  }
  function updateSyncLabel(text) {
    $("#sync-label").textContent =
      text ||
      (state.settings.binId
        ? "Sincronizado com JSONBin"
        : "Salvos neste dispositivo");
  }
  function monthLabel(ym) {
    if (!ym) return "";
    const [y, m] = ym.split("-").map(Number);
    return `${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)} ${y}`;
  }
  function monthEntries(ym) {
    const entries = state.entries.filter((e) => e.date?.slice(0, 7) === ym);
    const sessionIncome = state.clinicSessions
      .filter((session) => session.month === ym && session.paid && !session.deleted)
      .map((session) => ({ id: `clinic-${session.id}`, type: "income", amount: Number(session.amount || 0), date: session.date, category: "Atendimentos clínicos", description: "Sessão de paciente", paid: true, pot: "accounts" }));
    return [...entries, ...sessionIncome];
  }
  function colorFor(category) {
    let hash = 0;
    for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
  }
  const POT_LABELS = { accounts: "Contas", wishes: "Desejos", future: "Futuro" };
  const FREQUENCIES = { weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal" };
  const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  function sessionIsOverdue(session, patient, today = new Date().toLocaleDateString("sv-SE")) {
    if (session.paid || session.deleted || session.attendance === "missed" || !session.date) return false;
    const due = new Date(`${session.date}T12:00:00`);
    if (patient.paymentFrequency === "weekly") due.setDate(due.getDate() + 7);
    else if (patient.paymentFrequency === "biweekly") due.setDate(due.getDate() + 15);
    else {
      const day = due.getDate();
      due.setDate(1);
      due.setMonth(due.getMonth() + 1);
      due.setDate(Math.min(day, new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate()));
    }
    return due.toLocaleDateString("sv-SE") < today;
  }
  function monthSessionDates(patient, ym) {
    const [year, month] = ym.split("-").map(Number);
    const monthStart = new Date(year, month - 1, 1, 12),
      monthEnd = new Date(year, month, 0, 12),
      start = new Date(`${patient.startDate}T12:00:00`),
      dates = [];
    if (!patient.startDate || start > monthEnd) return dates;
    if (patient.frequency === "monthly") {
      const day = Math.min(start.getDate(), monthEnd.getDate());
      const date = new Date(year, month - 1, day, 12);
      if (date >= monthStart && date >= start) dates.push(date.toISOString().slice(0, 10));
      return dates;
    }
    const interval = patient.frequency === "biweekly" ? 14 : 7,
      weekday = Number.isInteger(Number(patient.weekday)) ? Number(patient.weekday) : start.getDay();
    let date = new Date(start);
    date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
    while (date < monthStart) date.setDate(date.getDate() + interval);
    while (date <= monthEnd) {
      dates.push(date.toISOString().slice(0, 10));
      date.setDate(date.getDate() + interval);
    }
    return dates;
  }
  function ensureClinicSessions(ym) {
    const regularOccurrences = new Map(),
      extraSessions = [];
    for (const session of state.clinicSessions) {
      if (session.kind === "extra" || session.kind === "emergency") {
        extraSessions.push(session);
        continue;
      }
      const scheduledDate = session.scheduledDate || session.originalDate || session.date,
        key = `${session.patientId}|${scheduledDate}`,
        previous = regularOccurrences.get(key);
      if (!previous) regularOccurrences.set(key, session);
      else {
        const previousMoved = previous.date !== (previous.scheduledDate || previous.originalDate || previous.date),
          currentMoved = session.date !== scheduledDate;
        if (currentMoved && !previousMoved) regularOccurrences.set(key, session);
      }
    }
    const cleaned = [...regularOccurrences.values(), ...extraSessions];
    let changed = cleaned.length !== state.clinicSessions.length;
    if (changed) state.clinicSessions = cleaned;
    const existing = new Set(state.clinicSessions.map((session) => `${session.patientId}|${session.scheduledDate || session.originalDate || session.date}`));
    for (const patient of state.patients) {
      for (const date of monthSessionDates(patient, ym)) {
        const key = `${patient.id}|${date}`;
        if (existing.has(key)) continue;
        state.clinicSessions.push({ id: uid(), patientId: patient.id, date, scheduledDate: date, month: ym, time: patient.time || "", amount: Number(patient.price || 0), kind: "regular", attendance: "pending", paid: false });
        existing.add(key);
        changed = true;
      }
    }
    if (changed) persistLocal();
  }
  function renderClinic() {
    const isMobileLayout = window.matchMedia("(max-width: 600px)").matches;
    $(".patients-panel").classList.toggle("cards-view", state.patientView === "cards" && !isMobileLayout);
    document.querySelectorAll("[data-patient-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.patientView === state.patientView));
    });
    const pct = state.potPercentages,
      entries = monthEntries(state.activeMonth),
      income = entries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
      spent = { accounts: 0, wishes: 0, future: 0 };
    for (const entry of entries) if (entry.type === "expense" && entry.paid !== false) spent[entry.pot || "accounts"] += Number(entry.amount || 0);
    for (const [key, share] of Object.entries(pct)) {
      const allocated = income * Number(share || 0) / 100,
        available = allocated - spent[key],
        el = $(`#pot-${key}-value`),
        bar = $(`#pot-${key}-bar`);
      $(`#pot-${key}-percent`).textContent = `${share}%`;
      el.textContent = money(allocated);
      $(`#pot-${key}-note`).textContent = `${money(available)} disponível${available < 0 ? " · acima do planejado" : ""}`;
      bar.style.width = `${allocated > 0 ? Math.max(0, Math.min(100, available / allocated * 100)) : 0}%`;
    }
    const patients = state.patients,
      allSessions = state.clinicSessions.filter((session) => !session.deleted),
      sessions = allSessions.filter((session) => session.month === state.activeMonth),
      search = $("#patient-search").value.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      frequencyFilter = $("#patient-frequency-filter").value,
      sessionFilter = $("#patient-session-filter").value,
      overdueOnly = $("#overdue-only-filter").checked,
      overdueSessions = allSessions.filter((session) => sessionIsOverdue(session, patients.find((patient) => patient.id === session.patientId) || {})),
      visiblePatients = patients.filter((patient) => {
        const patientSessions = sessions.filter((session) => session.patientId === patient.id),
          patientOverdue = overdueSessions.filter((session) => session.patientId === patient.id),
          searchable = `${patient.name || ""} ${patient.phone || ""}`.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
          searchDigits = search.replace(/\D/g, ""),
          phoneDigits = String(patient.phone || "").replace(/\D/g, ""),
          filterSessions = overdueOnly ? patientOverdue : patientSessions,
          matchesSession = (sessionFilter === "all" || filterSessions.some((session) => {
            if (sessionFilter === "extra") return session.kind === "extra" || session.kind === "emergency";
            if (sessionFilter === "regular") return session.kind !== "extra" && session.kind !== "emergency";
            if (sessionFilter === "paid") return session.paid;
            if (sessionFilter === "unpaid") return !session.paid;
            return session.attendance === sessionFilter;
          })) && (!overdueOnly || patientOverdue.length > 0);
        return (!search || searchable.includes(search) || Boolean(searchDigits && phoneDigits.includes(searchDigits))) &&
          (frequencyFilter === "all" || patient.frequency === frequencyFilter) &&
          matchesSession;
      }),
      visiblePatientIds = new Set(visiblePatients.map((patient) => patient.id)),
      visibleSessions = (overdueOnly ? overdueSessions : sessions).filter((session) => visiblePatientIds.has(session.patientId)),
      paidTotal = visibleSessions.filter((session) => session.paid).reduce((sum, session) => sum + Number(session.amount || 0), 0),
      overdueTotal = visibleSessions.reduce((sum, session) => sum + Number(session.amount || 0), 0),
      seenCount = visibleSessions.filter((session) => session.attendance === "attended").length;
    $("#patients-month").textContent = monthLabel(state.activeMonth).toLocaleLowerCase("pt-BR");
    $("#patient-list").innerHTML = visiblePatients.map((patient) => {
      const visits = (overdueOnly ? overdueSessions : sessions).filter((session) => session.patientId === patient.id).sort((a, b) => a.date.localeCompare(b.date)),
        total = visits.reduce((sum, session) => sum + Number(session.amount || 0), 0),
        scheduleWeekday = Number.isInteger(Number(patient.weekday)) && patient.weekday !== ""
          ? Number(patient.weekday)
          : patient.startDate
            ? new Date(`${patient.startDate}T12:00:00`).getDay()
            : visits[0]
              ? new Date(`${visits[0].date}T12:00:00`).getDay()
              : null,
        scheduleTime = patient.time || visits.find((session) => session.time)?.time || "",
        scheduleLabel = `${scheduleWeekday === null ? "Dia a definir" : WEEKDAYS[scheduleWeekday]}${scheduleTime ? ` · ${scheduleTime}` : ""}`,
        visitControls = visits.map((session) => {
          const overdue = sessionIsOverdue(session, patient), extra = session.kind === "extra" || session.kind === "emergency";
          return `<div class="session-line${overdue ? " overdue" : ""}"><input class="session-datetime" type="datetime-local" value="${session.date}T${(session.time || patient.time || "09:00").slice(0, 5)}" data-session-datetime="${session.id}" aria-label="Data e horário da sessão de ${escapeHtml(patient.name)}" />${overdue ? '<span class="session-kind-placeholder" aria-hidden="true"></span><span class="session-kind overdue-tag">Vencida</span>' : extra ? '<span class="session-kind emergency-tag">Extra</span>' : '<span class="session-kind-placeholder" aria-hidden="true"></span>'}<select aria-label="Presença de ${escapeHtml(patient.name)}" data-attendance="${session.id}"><option value="pending" ${session.attendance === "pending" ? "selected" : ""}>A confirmar</option><option value="attended" ${session.attendance === "attended" ? "selected" : ""}>Compareceu</option><option value="missed" ${session.attendance === "missed" ? "selected" : ""}>Faltou</option><option value="rescheduled" ${session.attendance === "rescheduled" ? "selected" : ""}>Remarcou</option></select><label class="session-paid"><input type="checkbox" data-paid="${session.id}" ${session.paid ? "checked" : ""} aria-label="Sessão paga" /> Pago</label><input class="session-amount" type="number" min="0" step="0.01" value="${Number(session.amount || 0)}" data-session-amount="${session.id}" aria-label="Valor da sessão" /><button class="session-delete" type="button" data-session-delete="${session.id}" aria-label="Excluir sessão de ${escapeHtml(patient.name)}" title="Excluir sessão"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg></button></div>`;
        }).join("") || `<span class="metric-period">${overdueOnly ? "Sem sessões vencidas" : "Sem sessões neste mês"}</span>`,
        frequencyClass = patient.frequency || "weekly";
      const paid = visits.filter((session) => session.paid).reduce((sum, session) => sum + Number(session.amount || 0), 0),
        overdueAmount = visits.filter((session) => sessionIsOverdue(session, patient)).reduce((sum, session) => sum + Number(session.amount || 0), 0),
        accordionOpen = !isMobileLayout && state.patientView === "table" ? " open" : "";
      return `<tr><td><div class="patient-name-cell"><strong>${escapeHtml(patient.name)}</strong><button class="patient-edit" data-patient-edit="${patient.id}" aria-label="Editar paciente">✎</button></div></td><td data-label="Telefone">${escapeHtml(patient.phone || "—")}</td><td data-label="Agenda"><span class="frequency-badge ${frequencyClass}">${FREQUENCIES[frequencyClass] || "Semanal"}</span><small class="schedule-sub">${scheduleLabel}</small><small class="schedule-sub payment-frequency">Pagamento ${FREQUENCIES[patient.paymentFrequency] || "mensal"}</small></td><td data-label="Sessões"><strong>${visits.length}</strong><small class="sessions-sub">${visits.filter((session) => session.attendance === "attended").length} realizadas</small></td><td data-label="Valor por sessão"><strong>${money(patient.price || 0)}</strong><small class="sessions-sub">${money(total)} ${overdueOnly ? "vencido" : "no mês"}</small></td><td class="patient-sessions-cell" data-label="Sessões e pagamentos"><details class="session-accordion"${accordionOpen}><summary><span>Ver ${visits.length === 1 ? "sessão" : `${visits.length} sessões`}</span>${overdueAmount ? `<strong>${money(overdueAmount)} vencidos</strong>` : "<small>presenças e pagamentos</small>"}<i class="session-disclosure-chevron" aria-hidden="true"></i></summary><div class="session-lines">${visitControls}</div></details></td><td data-label="Recebido"><strong>${money(paid)}</strong></td></tr>`;
    }).join("");
    const noPatients = patients.length === 0;
    $("#patients-empty").classList.toggle("show", visiblePatients.length === 0);
    $("#patients-empty-title").textContent = noPatients ? "Nenhum paciente cadastrado" : "Nenhum paciente encontrado";
    $("#patients-empty-copy").textContent = noPatients
      ? "Cadastre um paciente para acompanhar sessões, pagamentos e frequência."
      : "Tente alterar ou limpar os filtros para ver pacientes.";
    $("#empty-patient-add").hidden = !noPatients;
    $("#patient-list").closest(".table-wrap").querySelector("table").style.display = visiblePatients.length ? "" : "none";
    $("#patients-totals").innerHTML = `<span>${visiblePatients.length} de ${patients.length} ${patients.length === 1 ? "paciente" : "pacientes"}</span><span>${overdueOnly ? `${visibleSessions.length} sessões vencidas` : `${visibleSessions.length} sessões previstas · ${seenCount} realizadas`}</span><strong>${money(overdueOnly ? overdueTotal : paidTotal)} ${overdueOnly ? "em aberto" : "recebidos"}</strong>`;
  }
  function render() {
    ensureClinicSessions(state.activeMonth);
    renderPeriod();
    renderSummary();
    renderCharts();
    renderTransactions();
    renderCategories();
    renderClinic();
  }
  function renderPeriod() {
    const [year, month] = state.activeMonth.split("-");
    $("#current-month-name").textContent = MONTHS[Number(month) - 1][0].toLocaleUpperCase("pt-BR") + MONTHS[Number(month) - 1].slice(1);
    $("#current-year").textContent = year;
  }
  function renderSummary() {
    const items = monthEntries(state.activeMonth),
      income = items
        .filter((e) => e.type === "income")
        .reduce((s, e) => s + e.amount, 0),
      expense = items
        .filter((e) => e.type === "expense" && e.paid !== false)
        .reduce((s, e) => s + e.amount, 0);
    $("#income-value").textContent = money(income);
    $("#expense-value").textContent = money(expense);
    $("#balance-value").textContent = money(income - expense);
    $("#income-count").textContent =
      `${items.filter((e) => e.type === "income").length} lançamentos`;
    $("#expense-count").textContent =
      `${items.filter((e) => e.type === "expense" && e.paid !== false).length} lançamentos`;
  }
  function renderCharts() {
    if (!window.Chart) return;
    const range = Number($("#chart-range")?.value || 6);
    const [year, month] = state.activeMonth.split("-").map(Number);
    const labels = [],
      incomes = [],
      expenses = [];
    for (let offset = range - 1; offset >= 0; offset--) {
      const d = new Date(year, month - 1 - offset, 1),
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        entries = monthEntries(key);
      labels.push(MONTHS[d.getMonth()].slice(0, 3));
      incomes.push(
        entries
          .filter((e) => e.type === "income")
          .reduce((s, e) => s + e.amount, 0),
      );
      expenses.push(
        entries
          .filter((e) => e.type === "expense" && e.paid !== false)
          .reduce((s, e) => s + e.amount, 0),
      );
    }
    const common = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#20352c",
          padding: 12,
          titleFont: { size: 14 },
          bodyFont: { size: 13 },
          displayColors: true,
          callbacks: { label: (c) => ` ${money(c.raw)}` },
        },
      },
      interaction: { intersect: false, mode: "index" },
    };
    const trend = $("#trend-chart");
    if (state.charts.trend) state.charts.trend.destroy();
    state.charts.trend = new Chart(trend, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Entradas",
            data: incomes,
            borderColor: "#45987e",
            backgroundColor: "#45987e18",
            fill: true,
            tension: 0.37,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
          },
          {
            label: "Despesas",
            data: expenses,
            borderColor: "#f2a188",
            backgroundColor: "#f2a1880d",
            fill: true,
            tension: 0.37,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        ...common,
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: "#56675c", font: { size: 12, weight: "600" } },
          },
          y: {
            beginAtZero: true,
            grid: { color: "#ebe5db", drawTicks: false },
            border: { display: false, dash: [3, 4] },
            ticks: {
              color: "#56675c",
              font: { size: 11, weight: "500" },
              maxTicksLimit: 5,
              callback: (v) =>
                new Intl.NumberFormat("pt-BR", {
                  notation: "compact",
                  maximumFractionDigits: 0,
                }).format(v),
            },
          },
        },
      },
    });
    const expensesThis = monthEntries(state.activeMonth).filter(
        (e) => e.type === "expense" && e.paid !== false,
      ),
      groups = {};
    expensesThis.forEach(
      (e) => (groups[e.category] = (groups[e.category] || 0) + e.amount),
    );
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]),
      chartData = sorted.slice(0, 7),
      total = expensesThis.reduce((s, e) => s + e.amount, 0);
    $("#category-total").textContent = money(total, true);
    if (state.charts.category) state.charts.category.destroy();
    state.charts.category = new Chart($("#category-chart"), {
      type: "doughnut",
      data: {
        labels: chartData.map((x) => x[0]),
        datasets: [
          {
            data: chartData.map((x) => x[1]),
            backgroundColor: chartData.map((x) => colorFor(x[0])),
            borderColor: "#fff",
            borderWidth: 3,
            hoverOffset: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "76%",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#20352c",
            padding: 11,
            titleFont: { size: 13 },
            bodyFont: { size: 12 },
            callbacks: { label: (c) => ` ${c.label}: ${money(c.raw)}` },
          },
        },
      },
    });
    $("#category-legend").innerHTML =
      sorted
        .slice(0, 6)
        .map(
          ([name, value]) =>
            `<div class="category-item"><i style="background:${colorFor(name)}"></i><span>${escapeHtml(name)}</span><b>${money(value, true)}</b></div>`,
        )
        .join("") ||
      '<span class="metric-period">Sem despesas neste mês</span>';
  }
  function renderTransactions() {
    const isMobileLayout = window.matchMedia("(max-width: 600px)").matches;
    $(".transactions-panel").classList.toggle("cards-view", state.transactionView === "cards" && !isMobileLayout);
    document.querySelectorAll("[data-transaction-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.transactionView === state.transactionView));
    });
    const filtered = state.entries
      .filter(
        (e) =>
          (state.filters.type === "all" || e.type === state.filters.type) &&
          (!state.filters.month || e.date?.slice(0, 7) === state.filters.month),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const visible = state.showAll ? filtered : filtered.slice(0, 6);
    $("#transaction-list").innerHTML = visible
      .map((e) => {
        const color = colorFor(e.category);
        return `<tr class="transaction-row"><td class="transaction-description"><div class="description-cell"><span class="row-icon" style="background:${color}20;color:${color}">${e.type === "income" ? "↙" : "↗"}</span>${escapeHtml(e.description)}</div></td><td data-label="Categoria"><span class="category-tag" style="background:${color}17;color:${color}"><i style="background:${color}"></i>${escapeHtml(e.category)}</span></td><td data-label="Data">${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${e.date}T12:00:00`)).replace(".", "")}</td><td data-label="Tipo"><span class="type-tag ${e.type}">${e.type === "income" ? "Entrada" : "Despesa"}</span></td><td data-label="Valor" class="amount-cell ${e.type === "expense" ? "negative" : ""}">${e.type === "expense" ? "−" : "+"} ${money(e.amount)}</td><td class="transaction-actions"><div class="row-actions"><button data-edit="${escapeHtml(e.id)}" aria-label="Editar">✎</button><button data-delete="${escapeHtml(e.id)}" aria-label="Excluir">×</button></div></td></tr>`;
      })
      .join("");
    const empty = filtered.length === 0;
    $("#empty-state").classList.toggle("show", empty);
    $("#transaction-list")
      .closest(".table-wrap")
      .querySelector("table").style.display = empty ? "none" : "";
    $("#result-count").textContent =
      `${filtered.length} ${filtered.length === 1 ? "movimentação" : "movimentações"}`;
    $("#show-all").style.display = filtered.length > 6 ? "" : "none";
    $("#show-all").innerHTML = state.showAll
      ? "Mostrar menos <span>↑</span>"
      : "Ver todas <span>→</span>";
  }
  function renderCategories(selected) {
    const select = $("#entry-category"),
      type =
        document.querySelector('input[name="type"]:checked')?.value ||
        "expense",
      current = selected || select.value;
    const defaults = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const used = state.entries
      .filter((e) => e.type === type)
      .map((e) => e.category)
      .filter((category) => !isRetiredCategory(category));
    // Ao editar um lançamento antigo, mantenha a categoria atual disponível
    // até que a pessoa escolha outra. Ela não será sugerida em lançamentos novos.
    const preservedSelection =
      selected && isRetiredCategory(selected) && $("#entry-id").value
        ? [selected]
        : [];
    const available = [
      ...new Set([...defaults, ...used, ...preservedSelection]),
    ];
    select.innerHTML = available
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join("");
    if ([...select.options].some((o) => o.value === current))
      select.value = current;
    else if (available.length) select.value = available[0];
  }
  function openModal(id) {
    $(`#${id}`).classList.add("open");
    $(`#${id}`).setAttribute("aria-hidden", "false");
  }
  function closeModal(id) {
    $(`#${id}`).classList.remove("open");
    $(`#${id}`).setAttribute("aria-hidden", "true");
  }
  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
  }
  function prepareNew() {
    const form = $("#entry-form");
    form.reset();
    $("#entry-id").value = "";
    $("#entry-date").value = new Date().toISOString().slice(0, 10);
    $("#entry-recurring").checked = false;
    $("#entry-recurring-until").value = "";
    $("#recurring-end-field").hidden = true;
    $('input[name="type"][value="expense"]').checked = true;
    $("#entry-paid").checked = true;
    document.querySelectorAll(".expense-details-field").forEach((field) => field.hidden = false);
    $("#entry-recurring-label").hidden = true;
    renderCategories("Outros");
    $("#modal-title").textContent = "Nova movimentação";
    openModal("entry-modal");
  }
  function editEntry(id) {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    $("#entry-id").value = entry.id;
    $("#entry-description").value = entry.description;
    $("#entry-amount").value = entry.amount;
    $("#entry-date").value = entry.date;
    $("#entry-note").value = entry.note || "";
    $("#entry-recurring").checked = Boolean(entry.recurring);
    $("#entry-recurring-until").value = entry.recurringUntil || "";
    $("#entry-expense-kind").value = entry.expenseKind || "fixed";
    $("#entry-due-status").value = entry.dueStatus || "current";
    $("#entry-pot").value = entry.pot || "accounts";
    $("#entry-paid").checked = entry.paid !== false;
    document.querySelectorAll(".expense-details-field").forEach((field) => field.hidden = entry.type !== "expense");
    $("#entry-recurring-label").hidden = entry.type === "expense";
    $("#recurring-end-field").hidden = !entry.recurring;
    document.querySelector(
      `input[name="type"][value="${entry.type}"]`,
    ).checked = true;
    renderCategories(entry.category);
    if (!state.categories.includes(entry.category)) {
      $("#new-category").value = entry.category;
    }
    $("#modal-title").textContent = "Editar movimentação";
    openModal("entry-modal");
  }
  function preparePatient(patient = null) {
    $("#patient-form").reset();
    $("#patient-id").value = patient?.id || "";
    $("#patient-name").value = patient?.name || "";
    $("#patient-phone").value = patient?.phone || "";
    $("#patient-frequency").value = patient?.frequency || "weekly";
    $("#patient-payment-frequency").value = patient?.paymentFrequency || "monthly";
    $("#patient-start").value = patient?.startDate || `${state.activeMonth}-01`;
    $("#patient-weekday").value = patient?.weekday ?? new Date(`${patient?.startDate || `${state.activeMonth}-01`}T12:00:00`).getDay();
    $("#patient-time").value = patient?.time || "";
    $("#patient-price").value = patient?.price ?? "";
    $("#patient-time-conflict").hidden = true;
    state.pendingPatientSave = null;
    $("#patient-modal-title").textContent = patient ? "Editar paciente" : "Novo paciente";
    $("#delete-patient-action").hidden = !patient;
    openModal("patient-modal");
  }
  async function savePatientRecord(patient) {
    const id = patient.id,
      previousPatient = state.patients.find((item) => item.id === id);
    state.patients = state.patients.some((item) => item.id === id) ? state.patients.map((item) => item.id === id ? patient : item) : [...state.patients, patient];
    if (previousPatient && (previousPatient.frequency !== patient.frequency || previousPatient.startDate !== patient.startDate)) {
      state.clinicSessions = state.clinicSessions.filter((session) => session.patientId !== id || session.date < state.activeMonth + "-01" || session.paid || session.attendance !== "pending");
    } else if (previousPatient && previousPatient.price !== patient.price) {
      for (const session of state.clinicSessions) {
        if (session.patientId === id && session.date >= state.activeMonth + "-01" && !session.paid && session.attendance === "pending") session.amount = patient.price;
      }
    }
    state.pendingPatientSave = null;
    $("#patient-time-conflict").hidden = true;
    closeModal("patient-modal");
    await saveData("Paciente salvo.");
  }
  async function commitSessionDateTime(change) {
    if (change.kind === "extra") {
      state.clinicSessions.push({ id: uid(), patientId: change.patientId, date: change.date, month: change.date.slice(0, 7), time: change.time, amount: change.amount, kind: "extra", attendance: "pending", paid: false, note: change.note });
      state.pendingSessionChange = null;
      closeModal("session-conflict-modal");
      closeModal("emergency-session-modal");
      await saveData("Sessão extra de emergência adicionada.");
      return;
    }
    const session = state.clinicSessions.find((item) => item.id === change.sessionId);
    if (!session) return;
    session.scheduledDate ||= session.originalDate || session.date;
    session.originalDate ||= session.scheduledDate;
    session.date = change.date;
    session.time = change.time;
    session.month = change.date.slice(0, 7);
    session.attendance = "rescheduled";
    state.pendingSessionChange = null;
    closeModal("session-conflict-modal");
    await saveData("Sessão remarcada.");
  }
  function bind() {
    bindSectionNavigation();
    bindPeriodWidget();
    $("#new-entry").addEventListener("click", prepareNew);
    $(".transaction-view-switch").addEventListener("click", (event) => {
      const button = event.target.closest("[data-transaction-view]");
      if (!button) return;
      state.transactionView = button.dataset.transactionView;
      try { localStorage.setItem(TRANSACTION_VIEW_KEY, state.transactionView); } catch {}
      renderTransactions();
    });
    $("#new-patient").addEventListener("click", () => preparePatient());
    $("#empty-patient-add").addEventListener("click", () => preparePatient());
    $("#new-emergency-session").addEventListener("click", () => {
      if (!state.patients.length) {
        toast("Cadastre um paciente antes de adicionar uma sessão extra.");
        return;
      }
      $("#emergency-session-form").reset();
      $("#emergency-patient").innerHTML = state.patients.map((patient) => `<option value="${escapeHtml(patient.id)}">${escapeHtml(patient.name)}</option>`).join("");
      $("#emergency-date").value = `${new Date().toLocaleDateString("sv-SE")}T${(state.patients[0].time || "09:00").slice(0, 5)}`;
      $("#emergency-amount").value = state.patients[0].price || "";
      openModal("emergency-session-modal");
    });
    $("#emergency-patient").addEventListener("change", () => {
      const patient = state.patients.find((item) => item.id === $("#emergency-patient").value);
      $("#emergency-amount").value = patient?.price || "";
    });
    $("#emergency-session-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const patient = state.patients.find((item) => item.id === $("#emergency-patient").value);
      if (!patient) return;
      const [date, time] = $("#emergency-date").value.split("T"),
        change = { kind: "extra", patientId: patient.id, date, time, amount: Number($("#emergency-amount").value), note: $("#emergency-note").value.trim() },
        conflicts = state.clinicSessions.filter((item) => {
          if (item.deleted || item.patientId === patient.id || item.date !== date) return false;
          const otherPatient = state.patients.find((candidate) => candidate.id === item.patientId);
          return (item.time || otherPatient?.time || "") === time;
        });
      if (conflicts.length) {
        const names = [...new Set(conflicts.map((item) => state.patients.find((candidate) => candidate.id === item.patientId)?.name || "Outro paciente"))];
        state.pendingSessionChange = change;
        $("#session-conflict-copy").textContent = `Já há sessão de ${names.join(", ")} em ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${date}T12:00:00`))} às ${time}. Você pode voltar e escolher outro horário ou salvar mesmo assim.`;
        openModal("session-conflict-modal");
        return;
      }
      await commitSessionDateTime(change);
    });
    document.querySelector(".patients-panel .patient-view-switch").addEventListener("click", (event) => {
      const button = event.target.closest("[data-patient-view]");
      if (!button) return;
      state.patientView = button.dataset.patientView;
      try { localStorage.setItem(PATIENT_VIEW_KEY, state.patientView); } catch {}
      renderClinic();
    });
    $("#patient-search").addEventListener("input", renderClinic);
    ["#patient-frequency-filter", "#patient-session-filter", "#overdue-only-filter"].forEach((selector) => $(selector).addEventListener("change", renderClinic));
    $("#clear-patient-filters").addEventListener("click", () => {
      $("#patient-search").value = "";
      $("#patient-frequency-filter").value = "all";
      $("#patient-session-filter").value = "all";
      $("#overdue-only-filter").checked = false;
      renderClinic();
    });
    $("#patient-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = $("#patient-id").value || uid(),
        patient = { id, name: $("#patient-name").value.trim(), phone: $("#patient-phone").value.trim(), frequency: $("#patient-frequency").value, paymentFrequency: $("#patient-payment-frequency").value, startDate: $("#patient-start").value, weekday: Number($("#patient-weekday").value), time: $("#patient-time").value, price: Number($("#patient-price").value) },
        conflicts = state.patients.filter((item) => item.id !== id && Number(item.weekday) === patient.weekday && item.time && item.time === patient.time);
      if (conflicts.length) {
        state.pendingPatientSave = patient;
        $("#patient-time-conflict-copy").textContent = `Já existe atendimento neste dia e horário com ${conflicts.map((item) => item.name).join(", ")}. Você pode salvar mesmo assim ou voltar e escolher outro horário.`;
        $("#patient-time-conflict").hidden = false;
        return;
      }
      await savePatientRecord(patient);
    });
    $("#save-patient-with-conflict").addEventListener("click", async () => {
      if (state.pendingPatientSave) await savePatientRecord(state.pendingPatientSave);
    });
    $("#patient-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-patient-edit]");
      if (button) preparePatient(state.patients.find((patient) => patient.id === button.dataset.patientEdit));
      const deleteButton = event.target.closest("[data-session-delete]");
      if (deleteButton) {
        const session = state.clinicSessions.find((item) => item.id === deleteButton.dataset.sessionDelete),
          patient = state.patients.find((item) => item.id === session?.patientId);
        if (!session) return;
        state.pendingSessionDelete = session.id;
        $("#delete-session-copy").textContent = `Excluir a sessão de ${patient?.name || "este paciente"} do dia ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${session.date}T12:00:00`))}? Essa ação não pode ser desfeita.`;
        openModal("delete-session-modal");
      }
    });
    $("#confirm-delete-session").addEventListener("click", async () => {
      const session = state.clinicSessions.find((item) => item.id === state.pendingSessionDelete);
      if (!session) return;
      session.deleted = true;
      state.pendingSessionDelete = "";
      closeModal("delete-session-modal");
      await saveData("Sessão excluída.");
    });
    $("#delete-patient-action").addEventListener("click", () => {
      const patient = state.patients.find((item) => item.id === $("#patient-id").value);
      if (!patient) return;
      state.pendingPatientDelete = patient.id;
      $("#delete-patient-copy").textContent = `Excluir ${patient.name} e todas as sessões e pagamentos registrados para esse paciente? Essa ação não pode ser desfeita.`;
      openModal("delete-patient-modal");
    });
    $("#confirm-delete-patient").addEventListener("click", async () => {
      const patientId = state.pendingPatientDelete;
      if (!patientId) return;
      state.patients = state.patients.filter((item) => item.id !== patientId);
      state.clinicSessions = state.clinicSessions.filter((item) => item.patientId !== patientId);
      state.pendingPatientDelete = "";
      state.pendingPatientSave = null;
      $("#patient-time-conflict").hidden = true;
      closeModal("delete-patient-modal");
      closeModal("patient-modal");
      await saveData("Paciente excluído.");
    });
    $("#patient-list").addEventListener("change", async (event) => {
      const target = event.target,
        sessionId = target.dataset.paid || target.dataset.attendance || target.dataset.sessionAmount;
      if (!sessionId) return;
      const session = state.clinicSessions.find((item) => item.id === sessionId);
      if (!session) return;
      if (target.dataset.paid) session.paid = target.checked;
      if (target.dataset.attendance) session.attendance = target.value;
      if (target.dataset.sessionAmount) session.amount = Math.max(0, Number(target.value || 0));
      await saveData("Sessão atualizada.");
    });
    $("#patient-list").addEventListener("focusout", async (event) => {
      const target = event.target;
      if (!target.matches("[data-session-datetime]") || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(target.value)) return;
      const session = state.clinicSessions.find((item) => item.id === target.dataset.sessionDatetime),
        [newDate, newTime] = target.value.split("T");
      if (!session || (session.date === newDate && (session.time || "") === newTime)) return;
      const conflicts = state.clinicSessions.filter((item) => {
        if (item.deleted || item.id === session.id || item.patientId === session.patientId || item.date !== newDate) return false;
        const otherPatient = state.patients.find((patient) => patient.id === item.patientId);
        return (item.time || otherPatient?.time || "") === newTime;
      });
      if (conflicts.length) {
        const names = [...new Set(conflicts.map((item) => state.patients.find((patient) => patient.id === item.patientId)?.name || "Outro paciente"))];
        state.pendingSessionChange = { sessionId: session.id, date: newDate, time: newTime };
        $("#session-conflict-copy").textContent = `Já há sessão de ${names.join(", ")} em ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${newDate}T12:00:00`))} às ${newTime}. Você pode voltar e escolher outro horário ou salvar mesmo assim.`;
        openModal("session-conflict-modal");
        return;
      }
      await commitSessionDateTime({ sessionId: session.id, date: newDate, time: newTime });
    });
    $("#cancel-session-conflict").addEventListener("click", () => {
      state.pendingSessionChange = null;
      closeModal("session-conflict-modal");
      renderClinic();
    });
    $("#confirm-session-conflict").addEventListener("click", async () => {
      if (state.pendingSessionChange) await commitSessionDateTime(state.pendingSessionChange);
    });
    $("#edit-pot-percentages").addEventListener("click", () => {
      for (const key of Object.keys(POT_LABELS)) $(`#pot-${key}-input`).value = state.potPercentages[key];
      openModal("pots-modal");
    });
    $("#save-pot-percentages").addEventListener("click", async () => {
      const values = Object.fromEntries(Object.keys(POT_LABELS).map((key) => [key, Number($(`#pot-${key}-input`).value)]));
      if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0) || Object.values(values).reduce((sum, value) => sum + value, 0) !== 100) {
        toast("A divisão dos potes precisa somar exatamente 100%.");
        return;
      }
      state.potPercentages = values;
      closeModal("pots-modal");
      await saveData("Divisão dos potes atualizada.");
    });
    $("#privacy-toggle").addEventListener("click", () => {
      const hidden = document.body.classList.toggle("values-hidden"),
        button = $("#privacy-toggle");
      button.setAttribute("aria-pressed", String(hidden));
      button.setAttribute(
        "aria-label",
        hidden ? "Mostrar valores" : "Esconder valores",
      );
      button.title = hidden ? "Mostrar valores" : "Esconder valores";
      button.querySelector("span").textContent = hidden
        ? "Mostrar valores"
        : "Esconder valores";
    });
    $("#entry-recurring").addEventListener("change", (event) => {
      $("#recurring-end-field").hidden = !event.target.checked;
    });
    $("#entry-expense-kind").addEventListener("change", (event) => {
      const recurring = event.target.value === "recurring";
      $("#entry-recurring").checked = recurring;
      $("#recurring-end-field").hidden = !recurring;
    });
    $("#empty-add").addEventListener("click", prepareNew);
    $("#prev-month").addEventListener("click", () => shiftMonth(-1));
    $("#next-month").addEventListener("click", () => shiftMonth(1));
    $("#chart-range").addEventListener("change", renderCharts);
    document.querySelectorAll('input[name="type"]').forEach((input) =>
      input.addEventListener("change", () => {
        const current = $("#entry-category").value;
        renderCategories(current);
        const isExpense = document.querySelector('input[name="type"]:checked').value === "expense";
        document.querySelectorAll(".expense-details-field").forEach((field) => field.hidden = !isExpense);
        $("#entry-recurring-label").hidden = isExpense;
        if (isExpense) $("#recurring-end-field").hidden = $("#entry-expense-kind").value !== "recurring";
      }),
    );
    $("#entry-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const custom = $("#new-category").value.trim(),
        category = custom || $("#entry-category").value;
      if (
        custom &&
        !state.categories.some((c) => c.toLowerCase() === custom.toLowerCase())
      )
        state.categories.push(custom);
      const id = $("#entry-id").value;
      const previousEntry = id
        ? state.entries.find((item) => item.id === id)
        : null;
      const entry = {
        ...(previousEntry || {}),
        id: id || uid(),
        type: document.querySelector('input[name="type"]:checked').value,
        description: $("#entry-description").value.trim(),
        amount: Number($("#entry-amount").value),
        date: $("#entry-date").value,
        category,
        note: $("#entry-note").value.trim(),
        recurring: $("#entry-recurring").checked,
        recurrenceDay: Number($("#entry-date").value.slice(8, 10)),
        recurringUntil: $("#entry-recurring").checked
          ? $("#entry-recurring-until").value
          : "",
        expenseKind: document.querySelector('input[name="type"]:checked').value === "expense" ? $("#entry-expense-kind").value : "",
        dueStatus: document.querySelector('input[name="type"]:checked').value === "expense" ? $("#entry-due-status").value : "",
        pot: document.querySelector('input[name="type"]:checked').value === "expense" ? $("#entry-pot").value : "",
        paid: document.querySelector('input[name="type"]:checked').value === "expense" ? $("#entry-paid").checked : true,
      };
      if (
        entry.recurring &&
        entry.recurringUntil &&
        entry.recurringUntil < entry.date
      ) {
        toast("A data final deve ser igual ou posterior à data do lançamento.");
        return;
      }
      if (entry.recurring) entry.recurrenceId = id || entry.id;
      else if (id) {
        const previous = state.entries.find((item) => item.id === id);
        if (previous?.recurrenceId) entry.recurrenceId = previous.recurrenceId;
        if (previous?.recurrenceMonth)
          entry.recurrenceMonth = previous.recurrenceMonth;
      }
      if (id)
        state.entries = state.entries.map((e) => (e.id === id ? entry : e));
      else state.entries.push(entry);
      state.categories = mergeCategories(state.categories);
      closeModal("entry-modal");
      await saveData(id ? "Movimentação atualizada." : "Movimentação salva.");
    });
    $("#transaction-list").addEventListener("click", async (event) => {
      const edit = event.target.closest("[data-edit]"),
        del = event.target.closest("[data-delete]");
      if (edit) editEntry(edit.dataset.edit);
      if (del) {
        const entry = state.entries.find((e) => e.id === del.dataset.delete);
        if (entry && confirm(`Excluir “${entry.description}”?`)) {
          state.entries = state.entries.filter((e) => e.id !== entry.id);
          await saveData("Movimentação excluída.");
        }
      }
    });
    $("#type-filter").addEventListener("change", (e) => {
      state.filters.type = e.target.value;
      renderTransactions();
    });
    $("#date-filter").addEventListener("change", (e) => {
      state.filters.month = e.target.value;
      renderTransactions();
    });
    $("#clear-filters").addEventListener("click", () => {
      $("#type-filter").value = "all";
      $("#date-filter").value = "";
      state.filters = { type: "all", month: "" };
      renderTransactions();
    });
    $("#show-all").addEventListener("click", () => {
      state.showAll = !state.showAll;
      renderTransactions();
    });
    $("#import-button").addEventListener("click", () => $("#csv-file").click());
    $("#csv-file").addEventListener("change", importCSV);
    $("#category-more").addEventListener("click", () => {
      $("#type-filter").value = "expense";
      state.filters.type = "expense";
      $("#movimentacoes").scrollIntoView({ behavior: "smooth" });
      renderTransactions();
    });
    $("#open-settings").addEventListener("click", () => {
      if (state.settings.binId) $("#bin-id").value = state.settings.binId;
      if (state.settings.key) $("#bin-key").value = state.settings.key;
      $("#settings-status").textContent = "";
      openModal("settings-modal");
    });
    $("#open-settings-mobile").addEventListener("click", () =>
      $("#open-settings").click(),
    );
    $("#save-settings").addEventListener("click", connectBin);
    $("#refresh-data").addEventListener("click", refreshFromBin);
    $("#disconnect-bin").addEventListener("click", () => {
      state.settings = {};
      localStorage.removeItem(SETTINGS_KEY);
      closeModal("settings-modal");
      updateSyncLabel();
      toast("Sincronização JSONBin desativada.");
    });
    document
      .querySelectorAll("[data-close]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          closeModal(button.dataset.close),
        ),
      );
    document.querySelectorAll(".modal-backdrop").forEach((el) =>
      el.addEventListener("click", (event) => {
        if (event.target === el) closeModal(el.id);
      }),
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape")
        document
          .querySelectorAll(".modal-backdrop.open")
          .forEach((el) => closeModal(el.id));
    });
  }
  function bindPeriodWidget() {
    const widget = $("#period-widget"),
      handle = $("#period-drag-handle"),
      reopen = $("#reopen-period-widget");
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(PERIOD_WIDGET_KEY) || "{}");
    } catch {}
    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      widget.style.left = `${saved.left}px`;
      widget.style.top = `${saved.top}px`;
      widget.style.right = "auto";
    }
    widget.hidden = Boolean(saved.closed);
    reopen.hidden = !saved.closed;
    if (saved.closed) reopen.textContent = `Mês: ${monthLabel(state.activeMonth)}`;
    const keepMonthVisibleOnMobile = () => {
      if (!window.matchMedia("(max-width: 600px)").matches) return;
      widget.hidden = false;
      reopen.hidden = true;
      const currentLeft = Number.parseFloat(widget.style.left),
        currentTop = Number.parseFloat(widget.style.top),
        preferredLeft = Number.isFinite(currentLeft) ? currentLeft : saved.left,
        preferredTop = Number.isFinite(currentTop) ? currentTop : saved.top;
      if (Number.isFinite(preferredLeft) && Number.isFinite(preferredTop)) {
        const maxLeft = Math.max(8, window.innerWidth - widget.offsetWidth - 8),
          maxTop = Math.max(8, window.innerHeight - widget.offsetHeight - 88);
        widget.style.left = `${Math.max(8, Math.min(maxLeft, preferredLeft))}px`;
        widget.style.top = `${Math.max(8, Math.min(maxTop, preferredTop))}px`;
        widget.style.right = "auto";
      } else {
        widget.style.left = "";
        widget.style.top = "";
        widget.style.right = "";
      }
    };
    keepMonthVisibleOnMobile();
    window.addEventListener("resize", keepMonthVisibleOnMobile);
    const savePosition = () => {
      const rect = widget.getBoundingClientRect();
      localStorage.setItem(PERIOD_WIDGET_KEY, JSON.stringify({ left: rect.left, top: rect.top, closed: widget.hidden }));
    };
    $("#close-period-widget").addEventListener("click", () => {
      const rect = widget.getBoundingClientRect();
      widget.hidden = true;
      reopen.hidden = false;
      reopen.textContent = `Mês: ${monthLabel(state.activeMonth)}`;
      localStorage.setItem(PERIOD_WIDGET_KEY, JSON.stringify({ left: rect.left, top: rect.top, closed: true }));
    });
    reopen.addEventListener("click", () => {
      widget.hidden = false;
      reopen.hidden = true;
      savePosition();
    });
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = widget.getBoundingClientRect();
      handle.setPointerCapture(event.pointerId);
      handle.dataset.dragging = "true";
      handle.dataset.pointerX = String(event.clientX);
      handle.dataset.pointerY = String(event.clientY);
      handle.dataset.left = String(rect.left);
      handle.dataset.top = String(rect.top);
    });
    handle.addEventListener("pointermove", (event) => {
      if (handle.dataset.dragging !== "true") return;
      const left = Math.max(8, Math.min(window.innerWidth - widget.offsetWidth - 8, Number(handle.dataset.left) + event.clientX - Number(handle.dataset.pointerX))),
        bottomClearance = window.matchMedia("(max-width: 600px)").matches ? 88 : 8,
        top = Math.max(8, Math.min(window.innerHeight - widget.offsetHeight - bottomClearance, Number(handle.dataset.top) + event.clientY - Number(handle.dataset.pointerY)));
      widget.style.left = `${left}px`;
      widget.style.top = `${top}px`;
      widget.style.right = "auto";
    });
    const stopDragging = () => {
      if (handle.dataset.dragging !== "true") return;
      handle.dataset.dragging = "false";
      savePosition();
    };
    handle.addEventListener("pointerup", stopDragging);
    handle.addEventListener("pointercancel", stopDragging);
  }
  function bindSectionNavigation() {
    const links = [...document.querySelectorAll('.side-nav a[href^="#"]')],
      sections = links.map((link) => ({ link, section: $(link.getAttribute("href")) })).filter((item) => item.section);
    if (!sections.length) return;
    const setActive = (link) => links.forEach((item) => item.classList.toggle("active", item === link));
    let queued = false;
    const update = () => {
      queued = false;
      const visible = sections.filter(({ section }) => {
        const rect = section.getBoundingClientRect();
        return rect.top < window.innerHeight * 0.58 && rect.bottom > 145;
      });
      const current = visible[visible.length - 1];
      if (current) setActive(current.link);
    };
    window.addEventListener(
      "scroll",
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    window.addEventListener("resize", update);
    sections.forEach(({ link }) => link.addEventListener("click", () => setActive(link)));
    update();
  }
  function shiftMonth(delta) {
    const [y, m] = state.activeMonth.split("-").map(Number),
      d = new Date(y, m - 1 + delta, 1);
    state.activeMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    render();
  }
  async function connectBin() {
    const binId = $("#bin-id").value.trim(),
      key = $("#bin-key").value.trim(),
      status = $("#settings-status");
    if (!binId || !key) {
      status.textContent = "Informe o ID do bin e a chave de acesso.";
      status.className = "settings-status error";
      return;
    }
    status.textContent = "Conectando…";
    status.className = "settings-status";
    const previous = state.settings;
    state.settings = { binId, key };
    try {
      let remote;
      try {
        remote = await binRequest("GET");
      } catch (error) {
        if (/404/.test(error.message)) {
          await binRequest("PUT", dataRecord());
          remote = null;
        } else throw error;
      }
      if (remote) {
        const remoteData = remote.record || remote;
        if (!readLocal() && Array.isArray(remoteData.entries))
          applyData(remoteData);
        else
          await binRequest("PUT", dataRecord());
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      persistLocal();
      updateSyncLabel("Sincronizado com JSONBin");
      render();
      status.textContent =
        "Conexão ativa. Seus dados serão salvos nos dois lugares.";
      status.className = "settings-status success";
      setTimeout(() => closeModal("settings-modal"), 900);
    } catch (error) {
      state.settings = previous;
      status.textContent =
        "Não foi possível conectar. Confira o Bin ID e a X-Master-Key.";
      status.className = "settings-status error";
    }
  }
  async function refreshFromBin() {
    const button = $("#refresh-data"),
      status = $("#settings-status");
    if (!state.settings.binId || !state.settings.key) {
      status.textContent = "Conecte o JSONBin antes de atualizar os dados.";
      status.className = "settings-status error";
      return;
    }
    button.disabled = true;
    button.textContent = "Atualizando…";
    status.textContent = "Buscando a versão mais recente do JSONBin…";
    status.className = "settings-status";
    // Remove só os dados locais. As credenciais do JSONBin ficam intactas.
    localStorage.removeItem(STORAGE_KEY);
    state.entries = [];
    state.patients = [];
    state.clinicSessions = [];
    state.potPercentages = { accounts: 50, wishes: 30, future: 20 };
    state.categories = [...DEFAULT_CATEGORIES];
    state.importedThrough = {};
    try {
      const response = await binRequest("GET"),
        data = response.record || response;
      if (!Array.isArray(data.entries))
        throw Error("O JSONBin não contém uma lista de lançamentos válida.");
      state.entries = data.entries;
      state.patients = Array.isArray(data.patients) ? data.patients : [];
      state.clinicSessions = Array.isArray(data.clinicSessions)
        ? data.clinicSessions
        : [];
      state.potPercentages = {
        accounts: 50,
        wishes: 30,
        future: 20,
        ...(data.potPercentages || {}),
      };
      state.categories = mergeCategories(data.categories || []);
      state.importedThrough = mergeStatementCheckpoints(
        data.importedThrough,
        state.entries,
      );
      alignInitialMonth();
      if (generateRecurringEntries()) await saveRecurringEntries();
      else persistLocal();
      render();
      updateSyncLabel("Sincronizado com JSONBin");
      status.textContent = "Dados atualizados do JSONBin neste dispositivo.";
      status.className = "settings-status success";
      toast("Dados atualizados do JSONBin.");
    } catch {
      render();
      updateSyncLabel("Falha ao atualizar");
      status.textContent =
        "Não foi possível atualizar. Os dados locais foram limpos; confira sua conexão e tente novamente.";
      status.className = "settings-status error";
    } finally {
      button.disabled = false;
      button.textContent = "↻ Atualizar dados";
    }
  }
  function parseCSV(text) {
    let rows = [],
      row = [],
      cell = "",
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (cell.length || row.length) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
    }
    return rows;
  }
  function parseAmount(raw) {
    let s = String(raw || "")
      .trim()
      .replace(/R\$\s?/gi, "")
      .replace(/\s/g, "");
    if (!s) return 0;
    const negative = s.startsWith("-") || /^\(.*\)$/.test(s);
    s = s
      .replace(/[()]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? Math.abs(negative ? -n : n) : 0;
  }
  function importMatrix(rows) {
    let year = new Date().getFullYear(),
      type = "",
      months = [],
      added = [];
    for (const row of rows) {
      const joined = row.join(" ").trim(),
        yearMatch = joined.match(/20\d{2}/);
      if (/PLANILHA DE CONTROLE FINANCEIRO/i.test(joined) && yearMatch)
        year = Number(yearMatch[0]);
      const marker = String(row[1] || "")
        .trim()
        .toLocaleLowerCase("pt-BR");
      if (marker === "receitas" || marker === "despesas") {
        type = marker === "receitas" ? "income" : "expense";
        months = row.map((v) =>
          MONTHS.indexOf(String(v).trim().toLocaleLowerCase("pt-BR")),
        );
        continue;
      }
      if (!type || row.length < 3) continue;
      const category = String(row[1] || "").trim();
      if (
        !category ||
        ["total", "resultado"].includes(category.toLocaleLowerCase("pt-BR"))
      )
        continue;
      row.forEach((raw, index) => {
        if (index < 2 || !raw.trim()) return;
        const month = months[index];
        if (month < 0 || month === undefined) return;
        const amount = parseAmount(raw);
        if (!amount) return;
        added.push({
          id: uid(),
          type,
          description: category,
          amount,
          date: `${year}-${String(month + 1).padStart(2, "0")}-01`,
          category,
          note: "Importado de CSV",
        });
      });
    }
    return added;
  }
  function importFlat(rows) {
    if (rows.length < 2) return [];
    const normalize = (v) =>
      String(v || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const headers = rows[0].map(normalize);
    const find = (...names) => headers.findIndex((h) => names.includes(h));
    const dateI = find("data", "date"),
      amountI = find("valor", "amount", "value"),
      categoryI = find("categoria", "category"),
      typeI = find("tipo", "type"),
      descriptionI = find("descricao", "description", "nome"),
      noteI = find("observacao", "observacoes", "nota", "note");
    if (amountI < 0 || dateI < 0) return [];
    return rows.slice(1).flatMap((row) => {
      const amount = parseAmount(row[amountI]);
      if (!amount) return [];
      const rawType = normalize(row[typeI] || "despesa"),
        type = /receita|entrada|income/.test(rawType) ? "income" : "expense";
      let date = String(row[dateI] || "").trim(),
        match = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (match)
        date = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      } else return [];
      const category = String(row[categoryI] || "Outros").trim() || "Outros";
      return [
        {
          id: uid(),
          type,
          description: String(row[descriptionI] || category).trim() || category,
          amount,
          date,
          category,
          note: String(row[noteI] || "").trim(),
        },
      ];
    });
  }
  async function importCSV(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (
        file.name.toLowerCase().endsWith(".pdf") ||
        file.type === "application/pdf"
      ) {
        const allEntries = await importStatementPDF(file);
        if (!allEntries.length) {
          toast(
            "Não encontrei movimentações neste PDF. A importação aceita extratos do Mercado Pago e do Nubank.",
          );
          return;
        }
        const source = statementSource(allEntries),
          lastImportedDate =
            state.importedThrough[source] ||
            inferStatementCheckpoints(state.entries)[source] ||
            "",
          newestDateInFile = latestStatementDate(allEntries),
          entries = allEntries.filter(
            (entry) =>
              entry.externalOperations?.length ||
              !lastImportedDate ||
              entry.date >= lastImportedDate,
          );
        if (!entries.length) {
          toast(
            `Este extrato não tem movimentações a partir de ${formatStatementDate(lastImportedDate)}.`,
          );
          return;
        }
        const importedInterestIds = new Set(
          entries.flatMap((entry) =>
            (entry.externalOperations || []).map((operation) => operation.id),
          ),
        );
        const parsedInterest = entries.find(
          (entry) => entry.externalOperations?.length,
        );
        const previousInterestEntries = importedInterestIds.size
          ? state.entries.filter(
              (entry) =>
                entry.externalOperations?.some((operation) =>
                  importedInterestIds.has(operation.id),
                ) ||
                (importedInterestIds.has(entry.externalId) &&
                  entry.note === "Importado de extrato PDF") ||
                (parsedInterest &&
                  !entry.externalId &&
                  entry.note === "Importado de extrato PDF" &&
                  entry.type === "income" &&
                  entry.date?.slice(0, 7) ===
                    parsedInterest.date?.slice(0, 7) &&
                  (/^rendimento(?:s)?$/i.test(entry.description || "") ||
                    /rendimentos?/i.test(entry.description || "") ||
                    parsedInterest.externalOperations.some(
                      (operation) =>
                        Number(operation.amount.toFixed(2)) ===
                        Number(Number(entry.amount).toFixed(2)),
                    ))),
            )
          : [];
        if (parsedInterest && previousInterestEntries.length) {
          const previousAggregate = previousInterestEntries.find(
            (entry) => entry.externalOperations?.length,
          );
          const categoryCounts = new Map();
          previousInterestEntries.forEach((entry) =>
            categoryCounts.set(
              entry.category,
              (categoryCounts.get(entry.category) || 0) + 1,
            ),
          );
          const mostUsedCategory = [...categoryCounts].sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0];
          const operations = [
            ...new Map(
              [
                ...previousInterestEntries.flatMap(
                  (entry) => entry.externalOperations || [],
                ),
                ...parsedInterest.externalOperations,
              ].map((operation) => [operation.id, operation]),
            ).values(),
          ];
          parsedInterest.id = previousAggregate?.id || parsedInterest.id;
          parsedInterest.category =
            previousAggregate?.category ||
            mostUsedCategory ||
            parsedInterest.category;
          if (
            previousAggregate &&
            previousAggregate.description !== "Rendimento"
          )
            parsedInterest.description = previousAggregate.description;
          parsedInterest.externalOperations = operations;
          parsedInterest.amount = Number(
            operations
              .reduce((sum, operation) => sum + operation.amount, 0)
              .toFixed(2),
          );
        }
        if (previousInterestEntries.length) {
          const previousIds = new Set(
            previousInterestEntries.map((entry) => entry.id),
          );
          state.entries = state.entries.filter(
            (entry) => !previousIds.has(entry.id),
          );
        }
        const parsedByOperation = new Map(
          entries
            .filter((entry) => entry.externalId)
            .map((entry) => [entry.externalId, entry]),
        );
        const recoveredOperationIds = new Set();
        let repairedDescriptions = 0;
        state.entries = state.entries.map((entry) => {
          const parsed =
            parsedByOperation.get(entry.externalId) ||
            (!entry.externalId && entry.note === "Importado de extrato PDF"
              ? entries.find(
                  (candidate) =>
                    candidate.externalId &&
                    !recoveredOperationIds.has(candidate.externalId) &&
                    candidate.date === entry.date &&
                    candidate.type === entry.type &&
                    Number(candidate.amount.toFixed(2)) ===
                      Number(Number(entry.amount).toFixed(2)),
                )
              : null);
          if (!parsed || entry.note !== "Importado de extrato PDF")
            return entry;
          if (parsed.externalId) {
            recoveredOperationIds.add(parsed.externalId);
          }
          const updates = {};
          if (!entry.externalId && parsed.externalId)
            updates.externalId = parsed.externalId;
          if (
            (!entry.sourceDescription ||
              entry.description === entry.sourceDescription) &&
            entry.description !== parsed.description
          ) {
            updates.description = parsed.description;
            updates.sourceDescription = parsed.description;
            repairedDescriptions++;
          }
          if (!entry.sourceDescription) {
            updates.sourceDescription = parsed.description;
          }
          if (Object.keys(updates).length) return { ...entry, ...updates };
          return entry;
        });
        const knownOperations = new Set(
          state.entries
            .flatMap((entry) => [
              entry.externalId,
              ...(entry.externalOperations || []).map(
                (operation) => operation.id,
              ),
            ])
            .filter(Boolean),
        );
        const fresh = entries.flatMap((entry) => {
          if (entry.externalOperations) {
            const newOperations = entry.externalOperations.filter(
              (operation) => !knownOperations.has(operation.id),
            );
            newOperations.forEach((operation) =>
              knownOperations.add(operation.id),
            );
            if (!newOperations.length) return [];
            return [
              {
                ...entry,
                externalOperations: newOperations,
                amount: Number(
                  newOperations
                    .reduce((sum, operation) => sum + operation.amount, 0)
                    .toFixed(2),
                ),
              },
            ];
          }
          if (!entry.externalId || knownOperations.has(entry.externalId))
            return [];
          knownOperations.add(entry.externalId);
          return [entry];
        });
        if (!fresh.length && !repairedDescriptions) {
          toast(
            "Este extrato já foi importado. Nenhuma movimentação duplicada foi adicionada.",
          );
          return;
        }
        state.entries.push(...fresh);
        if (newestDateInFile) {
          state.importedThrough = mergeStatementCheckpoints(
            {
              ...state.importedThrough,
              [source]:
                !lastImportedDate || newestDateInFile > lastImportedDate
                  ? newestDateInFile
                  : lastImportedDate,
            },
            state.entries,
          );
        }
        state.categories = mergeCategories([
          ...state.categories,
          ...fresh.map((entry) => entry.category),
        ]);
        const skipped = entries.length - fresh.length;
        await saveData(
          `${fresh.length} lançamentos importados${lastImportedDate ? ` desde ${formatStatementDate(lastImportedDate)} (inclusive)` : ""}${repairedDescriptions ? `; ${repairedDescriptions} descrições corrigidas` : ""}${skipped ? `; ${skipped} duplicados ignorados` : ""}.`,
        );
        return;
      }
      const text = new TextDecoder("utf-8")
        .decode(await file.arrayBuffer())
        .replace(/^\uFEFF/, "");
      const rows = parseCSV(text),
        matrix = importMatrix(rows),
        flat = matrix.length ? matrix : importFlat(rows);
      if (!flat.length) {
        toast(
          "Não encontrei lançamentos. Confira se o CSV tem data e valor ou o formato mensal da planilha.",
        );
        return;
      }
      const categories = flat.map((e) => e.category);
      state.entries.push(...flat);
      state.categories = mergeCategories([...state.categories, ...categories]);
      await saveData(`${flat.length} lançamentos importados.`);
    } catch (error) {
      toast(
        error?.name === "PasswordException"
          ? "Este PDF está protegido por senha e não pode ser lido."
          : "Não foi possível ler o arquivo. Confira se o PDF é um extrato do Mercado Pago ou Nubank, ou tente outro CSV.",
      );
    } finally {
      event.target.value = "";
    }
  }
  async function importStatementPDF(file) {
    if (!window.pdfjsLib) throw Error("Leitor de PDF indisponível.");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() })
      .promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber),
        content = await page.getTextContent(),
        lines = new Map();
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const y = Math.round(item.transform[5] / 2) * 2;
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push({ x: item.transform[4], text: item.str.trim() });
      }
      pages.push(
        [...lines.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, items]) =>
            items
              .sort((a, b) => a.x - b.x)
              .map((item) => item.text)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim(),
          ),
      );
    }
    const fullText = pages.flat().join("\n");
    if (/\bnu pagamentos\b|\bnubank\b/i.test(fullText))
      return parseNubankStatement(pages);
    // Keep the Mercado Pago reader as-is; this only routes other PDF formats.
    const mercadoPagoEntries = await importBankPDF(file);
    return mercadoPagoEntries.map((entry) => ({
      ...entry,
      importSource: "mercado-pago",
    }));
  }
  function parseNubankStatement(pages) {
    const monthNumbers = {
      JAN: "01",
      FEV: "02",
      MAR: "03",
      ABR: "04",
      MAI: "05",
      JUN: "06",
      JUL: "07",
      AGO: "08",
      SET: "09",
      OUT: "10",
      NOV: "11",
      DEZ: "12",
    };
    const datePattern = /^\s*(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})\b\s*(.*)$/i;
    const amountPattern = /(?<![\d.])((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})(?!\d)/;
    const transactionPattern = /^(?:transfer[eê]ncia|pix|compra|pagamento|aplica[cç][aã]o|resgate|dep[oó]sito|rendimento|estorno|saque|recarga|d[eé]bito|cr[eé]dito|tarifa|boleto|cashback|empr[eé]stimo)\b/i;
    const boilerplatePattern = /^(?:cpf\b|\d{8,}[-\d]*$|\d{1,2}\s+de\s+\w+\s+de\s+\d{4}\s+a\s+|valores em r\$|saldo inicial\b|rendimento l[ií]quido\b|saldo final do per[ií]odo\b|movimenta[cç][oõ]es\b|extrato gerado\b|tem alguma d[uú]vida\b|caso a solu[cç][aã]o\b|o saldo l[ií]quido\b|n[aã]o nos responsabilizamos\b|asseguramos a autenticidade\b|nu financeira\b|cnpj\s*:)/i;
    const parsed = [];
    let currentDate = "";
    let pending = null;
    const finishPending = () => {
      if (!pending) return;
      const amountLineIndex = pending.lines.findIndex((line) =>
        amountPattern.test(line),
      );
      if (amountLineIndex < 0) {
        pending = null;
        return;
      }
      const amountMatch = pending.lines[amountLineIndex].match(amountPattern);
      const rawDescription = [
        ...pending.lines.slice(0, amountLineIndex),
        pending.lines[amountLineIndex].slice(0, amountMatch.index),
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .replace(/\s+-\s*$/, "")
        .trim();
      const amount = parseSignedAmount(amountMatch[1]);
      if (currentDate && rawDescription && Number.isFinite(amount))
        parsed.push({ date: currentDate, description: rawDescription, amount });
      pending = null;
    };
    for (const pageLines of pages) {
      for (const originalLine of pageLines) {
        const line = originalLine.trim();
        if (!line || boilerplatePattern.test(line)) continue;
        const dateMatch = line.match(datePattern);
        if (dateMatch) {
          finishPending();
          currentDate = `${dateMatch[3]}-${monthNumbers[dateMatch[2].toUpperCase()]}-${String(dateMatch[1]).padStart(2, "0")}`;
          continue;
        }
        if (/^(?:total de entradas|total de sa[ií]das|saldo inicial|saldo final|rendimento l[ií]quido)\b/i.test(line)) {
          finishPending();
          continue;
        }
        if (!currentDate) continue;
        const hasAmount = amountPattern.test(line);
        const startsTransaction = transactionPattern.test(line);
        if (startsTransaction) {
          finishPending();
          pending = { lines: [line] };
        } else if (hasAmount && pending && pending.lines.some((part) => amountPattern.test(part))) {
          finishPending();
          pending = { lines: [line] };
        } else if (pending) {
          pending.lines.push(line);
        } else if (hasAmount) {
          pending = { lines: [line] };
        }
      }
    }
    finishPending();

    const occurrences = new Map(),
      entries = [],
      interestOperations = [];
    for (const transaction of parsed) {
      const normalizedDescription = transaction.description
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
      const descriptionKey = `${transaction.date}|${transaction.amount.toFixed(2)}|${normalizedDescription}`;
      const occurrence = (occurrences.get(descriptionKey) || 0) + 1;
      occurrences.set(descriptionKey, occurrence);
      const operationId = `nubank:${hashStatementIdentity(descriptionKey)}:${occurrence}`;
      const normalized = normalizeStatementText(transaction.description);
      const income = /^(?:transferencia recebida|pix recebido|resgate|deposito|rendimento|estorno recebido|credito recebido)\b/.test(normalized);
      if (income && /^rendimentos?\b/.test(normalized)) {
        interestOperations.push({ id: operationId, amount: transaction.amount });
        continue;
      }
      entries.push({
        id: uid(),
        externalId: operationId,
        type: income ? "income" : "expense",
        description: transaction.description,
        amount: transaction.amount,
        date: transaction.date,
        category: "Indefinido",
        sourceDescription: transaction.description,
        importSource: "nubank",
        note: "Importado de extrato PDF",
      });
    }
    if (interestOperations.length) {
      const interestDate = parsed.find((transaction) =>
        /^rendimentos?\b/.test(normalizeStatementText(transaction.description)),
      )?.date;
      entries.push({
        id: uid(),
        type: "income",
        description: "Rendimento",
        amount: Number(
          interestOperations
            .reduce((sum, operation) => sum + operation.amount, 0)
            .toFixed(2),
        ),
        date: `${interestDate?.slice(0, 7) || currentDate.slice(0, 7)}-01`,
        category: "Rendimentos",
        externalOperations: interestOperations,
        importSource: "nubank",
        note: "Total de rendimentos do extrato PDF",
      });
    }
    return entries;
  }
  function normalizeStatementText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/\s+/g, " ")
      .trim();
  }
  function hashStatementIdentity(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  async function importBankPDF(file) {
    if (!window.pdfjsLib) throw Error("Leitor de PDF indisponível.");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() })
      .promise;
    const transactions = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber),
        content = await page.getTextContent(),
        lines = new Map();
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const x = item.transform[4],
          y = Math.round(item.transform[5] / 2) * 2;
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push({ x, text: item.str.trim() });
      }
      const pageText = [...lines.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) =>
          items
            .sort((a, b) => a.x - b.x)
            .map((item) => item.text)
            .join(" "),
        )
        .join("\n");
      transactions.push(
        ...parseBankStatementText(pageText, extractPdfDescriptions(lines)),
      );
    }
    const earnings = transactions.filter(
      (entry) => entry.externalOperations?.length,
    );
    if (earnings.length > 1) {
      const operations = [
        ...new Map(
          earnings
            .flatMap((entry) => entry.externalOperations)
            .map((operation) => [operation.id, operation]),
        ).values(),
      ];
      const firstEarningIndex = transactions.indexOf(earnings[0]);
      for (let index = transactions.length - 1; index >= 0; index--)
        if (transactions[index].externalOperations?.length)
          transactions.splice(index, 1);
      transactions.splice(firstEarningIndex, 0, {
        ...earnings[0],
        id: uid(),
        externalOperations: operations,
        amount: Number(
          operations
            .reduce((sum, operation) => sum + operation.amount, 0)
            .toFixed(2),
        ),
      });
    }
    return transactions;
  }
  function extractPdfDescriptions(lines) {
    const descriptions = new Map();
    const orderedLines = [...lines.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([y, items]) => ({
        y,
        items: [...items].sort((a, b) => a.x - b.x),
      }));
    const dateRows = [];
    const operations = [];
    for (const line of orderedLines)
      for (const item of line.items) {
        if (item.x < 89 && /\b\d{2}-\d{2}-\d{4}\b/.test(item.text))
          dateRows.push(line.y);
        if (item.x >= 180 && item.x < 308) {
          const match = item.text.match(/\b(\d{12,13})\b/);
          if (match) operations.push({ id: match[1], y: line.y });
        }
      }
    const nearestDateRow = (y) =>
      dateRows.reduce(
        (nearest, candidate) =>
          nearest === null || Math.abs(candidate - y) < Math.abs(nearest - y)
            ? candidate
            : nearest,
        null,
      );
    const descriptionsByDate = new Map();
    for (const line of orderedLines) {
      for (const item of line.items) {
        if (
          item.x < 70 ||
          item.x >= 197 ||
          /^descri[cç][aã]o$/i.test(item.text)
        )
          continue;
        const dateY = nearestDateRow(line.y);
        if (dateY === null || Math.abs(dateY - line.y) > 18) continue;
        if (!descriptionsByDate.has(dateY)) descriptionsByDate.set(dateY, []);
        descriptionsByDate
          .get(dateY)
          .push({ y: line.y, x: item.x, text: item.text });
      }
    }
    for (const operation of operations) {
      const dateY = nearestDateRow(operation.y);
      const words = descriptionsByDate.get(dateY) || [];
      const description = words
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((word) => word.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (description) descriptions.set(operation.id, description);
    }
    return descriptions;
  }
  function parseBankStatementText(text, columnDescriptions = new Map()) {
    const dates = [...text.matchAll(/\b(\d{2})-(\d{2})-(\d{4})\b/g)],
      entries = [],
      seen = new Set();
    const interestOperations = [];
    let interestDate = "";
    dates.forEach((dateMatch, index) => {
      const start = dateMatch.index + dateMatch[0].length,
        end = dates[index + 1]?.index ?? text.length,
        segment = text.slice(start, end);
      const idMatch = segment.match(/\b(\d{12,13})\b/),
        amountMatch = (
          idMatch ? segment.slice(idMatch.index + idMatch[0].length) : segment
        ).match(/R\$\s*(-?[\d.]+,\d{2})/);
      if (!amountMatch) return;
      const signedAmount = parseSignedAmount(amountMatch[1]);
      let description = segment
        .slice(0, idMatch ? idMatch.index : segment.indexOf(amountMatch[0]))
        .replace(/[\s\n]+/g, " ")
        .trim();
      description = description
        .replace(/^(?:Data\s+Descri[cç][aã]o|Descri[cç][aã]o)\s*/i, "")
        .trim();
      const operationId =
        idMatch?.[1] ||
        `sem-id:${dateMatch[3]}${dateMatch[2]}${dateMatch[1]}:${description.toLocaleLowerCase("pt-BR")}:${signedAmount}`;
      description = columnDescriptions.get(idMatch?.[1]) || description;
      if (!description) description = "Movimentação do extrato";
      if (seen.has(operationId)) return;
      seen.add(operationId);
      const income = signedAmount > 0;
      if (income && /^rendimentos?\b/i.test(description)) {
        interestOperations.push({ id: operationId, amount: signedAmount });
        interestDate = `${dateMatch[3]}-${dateMatch[2]}-01`;
        return;
      }
      entries.push({
        id: uid(),
        externalId: operationId,
        type: income ? "income" : "expense",
        description,
        amount: Math.abs(signedAmount),
        date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
        category: categorizeBankEntry(description, income),
        sourceDescription: description,
        note: "Importado de extrato PDF",
      });
    });
    if (interestOperations.length)
      entries.push({
        id: uid(),
        type: "income",
        description: "Rendimento",
        amount: Number(
          interestOperations
            .reduce((sum, operation) => sum + operation.amount, 0)
            .toFixed(2),
        ),
        date: interestDate,
        category: "Rendimentos",
        externalOperations: interestOperations,
        note: "Total de rendimentos do extrato PDF",
      });
    return entries;
  }
  function parseSignedAmount(raw) {
    const value = String(raw || "")
      .trim()
      .replace(/R\$\s?/gi, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  function categorizeBankEntry(description, income) {
    const text = description
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (income && /pix recebido\s+guilherme marques dos santos/.test(text))
      return "Salário";
    return "Indefinido";
  }
  boot();
})();
