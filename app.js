(() => {
  "use strict";
  const STORAGE_KEY = "meuDinheiro.v1";
  const LEGACY_SETTINGS_KEY = "meuDinheiro.jsonbin";
  const FIREBASE_SDK_VERSION = "13.4.0";
  const PERIOD_WIDGET_KEY = "meuDinheiro.periodWidget";
  const PATIENT_VIEW_KEY = "meuDinheiro.patientView";
  const TRANSACTION_VIEW_KEY = "meuDinheiro.transactionView";
  const THEME_KEY = "meuDinheiro.theme";
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
  let firebaseSdkPromise = null;
  let firebaseContext = null;
  let firebaseShadow = null;
  let firebaseWatchUnsubscribers = [];
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
    pendingRescheduleSessionId: "",
    pendingPatientDelete: "",
    pendingSessionChange: null,
    pendingPatientSave: null,
    potPercentages: { accounts: 50, wishes: 30, future: 20 },
    categories: [...DEFAULT_CATEGORIES],
    importedThrough: {},
    activeMonth: localMonth(),
    agendaWeek: null,
    agendaSelectedDay: null,
    filters: { type: "all", month: "" },
    showAll: false,
    patientView: readPatientView(),
    transactionView: readTransactionView(),
    charts: {},
  };
  function applyTheme(theme) {
    const selectedTheme = theme === "pink" ? "pink" : "blue";
    document.body.dataset.theme = selectedTheme;
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const active = button.dataset.themeChoice === selectedTheme;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    });
    try { localStorage.setItem(THEME_KEY, selectedTheme); } catch {}
    if (state.charts.trend && window.Chart) renderCharts();
  }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { applyTheme("blue"); }
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
  function formatBrazilianPhone(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
    digits = digits.slice(0, 11);
    if (!digits) return "";
    if (digits.length <= 2) return `(${digits}`;
    const area = digits.slice(0, 2), local = digits.slice(2);
    if (digits.length <= 6) return `(${area}) ${local}`;
    if (digits.length <= 10) return `(${area}) ${local.slice(0, 4)}-${local.slice(4)}`;
    return `(${area}) ${local.slice(0, 5)}-${local.slice(5)}`;
  }
  function formatPhoneInput(input) {
    const original = input.value,
      caret = input.selectionStart ?? original.length,
      digitsBeforeCaret = original.slice(0, caret).replace(/\D/g, "").length,
      formatted = formatBrazilianPhone(original);
    input.value = formatted;
    let nextCaret = 0, digitCount = 0;
    while (nextCaret < formatted.length && digitCount < digitsBeforeCaret) {
      if (/\d/.test(formatted[nextCaret])) digitCount++;
      nextCaret++;
    }
    if (!digitsBeforeCaret && formatted.startsWith("(")) nextCaret = 1;
    input.setSelectionRange(nextCaret, nextCaret);
  }
  function readLegacySettings() {
    try {
      return JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) || "{}");
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
    let signedInUser = null;
    try {
      let response;
      try {
        response = await fetch("/.netlify/functions/firebase-config", { cache: "no-store" });
      } catch {
        throw Error("Não consegui acessar a configuração Firebase. Abra o site publicado no Netlify e confira se a função firebase-config está no deploy.");
      }
      if (response.status === 503) throw Error("A configuração Firebase ainda não foi cadastrada nas variáveis do Netlify com escopo Functions.");
      if (!response.ok) throw Error("A função Firebase do Netlify não respondeu corretamente. Publique um novo deploy e tente novamente.");
      const payload = await response.json(), firebaseConfig = payload.firebaseConfig;
      if (!firebaseConfig) throw Error("A configuração Firebase não foi retornada pelo Netlify. Confira as variáveis do projeto.");
      try { localStorage.removeItem("leidiane.firebaseConfigCache"); } catch {}
      firebaseContext = await createFirebaseContext(firebaseConfig);
      signedInUser = await waitForFirebaseUser(firebaseContext);
      if (signedInUser) await activateFirebaseUser(signedInUser);
    } catch (error) {
      signedInUser = null;
      if (firebaseContext) firebaseContext.user = null;
      $("#login-status").textContent = "Não foi possível conectar ao sistema. Atualize a página e tente novamente.";
      $("#login-status").className = "settings-status error";
    }
    if (generateRecurringEntries()) {
      alignInitialMonth();
      await saveRecurringEntries();
    }
    $("#app-shell").hidden = !signedInUser;
    $("#auth-screen").hidden = Boolean(signedInUser);
    $("#auth-loading").hidden = true;
    $("#firebase-login-form").hidden = Boolean(signedInUser);
    render();
    bind();
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
  function clinicSessionsForStorage(sessions = state.clinicSessions) {
    const [year, month] = localMonth().split("-").map(Number),
      nextMonthDate = new Date(year, month, 1),
      nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
    return sessions.filter((session) => {
      const sessionMonth = String(session.date || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(sessionMonth) || sessionMonth <= nextMonth) return true;
      if (session.rescheduledFromId || session.rescheduledToId || session.kind !== "regular" || session.deleted || session.paid || session.attendance && session.attendance !== "pending" || session.note) return true;
      const patient = state.patients.find((item) => item.id === session.patientId);
      if (!patient) return true;
      const scheduledDate = session.scheduledDate || session.originalDate || session.date;
      return session.date !== scheduledDate ||
        Number(session.amount || 0) !== Number(patient.price || 0);
    });
  }
  function dataRecord() {
    return {
      entries: state.entries,
      patients: state.patients,
      clinicSessions: clinicSessionsForStorage(),
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
    if (firebaseContext?.user) {
      try {
        await syncFirebaseRecord(dataRecord());
      } catch {
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
  function applyData(data, { clearLocal = true } = {}) {
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
      if (clearLocal) persistLocal();
    }
  }
  function persistLocal() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  async function saveData(message = "Movimentação salva.") {
    persistLocal();
    render();
    if (firebaseContext?.user) {
      try {
        await syncFirebaseRecord(dataRecord());
        toast(message);
      } catch {
        toast("Não foi possível salvar. Verifique sua conexão e tente novamente; a alteração não foi gravada.");
      }
    } else {
      toast(message);
    }
  }
  async function binRequest(method, body, { binId, key } = readLegacySettings()) {
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
  function monthLabel(ym) {
    if (!ym) return "";
    const [y, m] = ym.split("-").map(Number);
    return `${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)} ${y}`;
  }
  function monthEntries(ym) {
    const entries = state.entries.filter((e) => e.date?.slice(0, 7) === ym);
    const sessionIncome = state.clinicSessions
      .filter((session) => session.month === ym && session.paid && !session.deleted && !session.placeholder && (
        session.attendance !== "rescheduled" || state.clinicSessions.some((item) => !item.deleted && item.placeholder && item.rescheduledFromId === session.id)
      ))
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
  const WEEKDAY_OPTIONS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  const WEEKDAY_SHORT = ["Dom.", "Seg.", "Ter.", "Qua.", "Qui.", "Sex.", "Sáb."];
  const MONTH_WEEK_LABELS = { first: "1ª", second: "2ª", third: "3ª", fourth: "4ª", last: "Última" };
  function patientSchedules(patient) {
    const source = Array.isArray(patient.schedules)
      ? patient.schedules
      : patient.weekday !== undefined || patient.time
        ? [{ weekday: patient.weekday, time: patient.time }]
        : [];
    return source.map((schedule) => ({ weekday: schedule.weekday === undefined || schedule.weekday === null || schedule.weekday === "" ? null : Number(schedule.weekday), day: schedule.day === undefined || schedule.day === null || schedule.day === "" ? null : Number(schedule.day), weekOfMonth: schedule.weekOfMonth || null, time: String(schedule.time || "").slice(0, 5) }))
      .filter((schedule) => ((schedule.weekday !== null && schedule.weekday >= 0 && schedule.weekday <= 6) || (schedule.day !== null && schedule.day >= 1 && schedule.day <= 31)) && /^\d{2}:\d{2}$/.test(schedule.time));
  }
  function scheduleId(schedule) {
    if (schedule.weekOfMonth) return `${schedule.weekOfMonth}-${schedule.weekday}`;
    return String(schedule.day ?? schedule.weekday);
  }
  function monthlyRuleFromLegacyDay(day, referenceDate) {
    const [year, month] = (referenceDate || dateKey(new Date())).split("-").map(Number),
      monthEnd = new Date(year, month, 0, 12),
      selectedDay = Math.min(Math.max(1, Number(day) || 1), monthEnd.getDate()),
      selectedDate = new Date(year, month - 1, selectedDay, 12),
      occurrence = Math.floor((selectedDay - 1) / 7) + 1,
      isLast = selectedDay + 7 > monthEnd.getDate();
    return { weekday: selectedDate.getDay(), weekOfMonth: isLast ? "last" : ["first", "second", "third", "fourth"][occurrence - 1] || "last" };
  }
  function monthlyWeekdayDate(year, month, weekday, weekOfMonth) {
    const first = new Date(year, month - 1, 1, 12),
      last = new Date(year, month, 0, 12),
      weekNumber = { first: 1, second: 2, third: 3, fourth: 4 }[weekOfMonth] || Number(weekOfMonth) || 1;
    if (weekOfMonth === "last") {
      last.setDate(last.getDate() - ((last.getDay() - weekday + 7) % 7));
      return last;
    }
    const date = new Date(first);
    date.setDate(1 + ((weekday - first.getDay() + 7) % 7) + (weekNumber - 1) * 7);
    return date;
  }
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  function agendaWeekDates(reference = new Date()) {
    const monday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }
  function agendaDateLabel(date, options = { day: "numeric", month: "short" }) {
    return new Intl.DateTimeFormat("pt-BR", options).format(date).replace(" de ", " ");
  }
  function renderAgenda() {
    const dates = agendaWeekDates(state.agendaWeek || new Date()),
      keys = dates.map(dateKey),
      todayKey = dateKey(new Date());
    if (!state.agendaSelectedDay || !keys.includes(state.agendaSelectedDay)) state.agendaSelectedDay = keys.includes(todayKey) ? todayKey : keys[0];
    const months = [...new Set(keys.map((key) => key.slice(0, 7)))];
    months.forEach((month) => ensureClinicSessions(month));
    const sessionsByDate = new Map(keys.map((key) => [key, []]));
    state.clinicSessions.filter((session) => !session.deleted && !session.placeholder && session.attendance !== "rescheduled" && session.date && sessionsByDate.has(session.date)).forEach((session) => {
      const patient = state.patients.find((item) => item.id === session.patientId);
      if (!patient) return;
      const time = (session.time || patient.time || "09:00").slice(0, 5);
      sessionsByDate.get(session.date).push({ session, patient, time });
    });
    sessionsByDate.forEach((items) => items.sort((a, b) => a.time.localeCompare(b.time) || a.patient.name.localeCompare(b.patient.name, "pt-BR")));
    const scheduledHours = [...sessionsByDate.values()].flat().map((item) => Number(item.time.split(":")[0])).filter((hour) => Number.isFinite(hour)),
      firstHour = Math.max(0, Math.min(7, ...scheduledHours)),
      lastHour = Math.min(23, Math.max(22, ...scheduledHours)),
      agendaHours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
    const first = dates[0], last = dates[6], sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear(), sameYear = first.getFullYear() === last.getFullYear(),
      dateRange = sameMonth
        ? `${first.getDate()}–${last.getDate()} ${agendaDateLabel(last, { month: "long" })} ${last.getFullYear()}`
        : sameYear
          ? `${agendaDateLabel(first)} – ${agendaDateLabel(last)} ${last.getFullYear()}`
          : `${agendaDateLabel(first)} ${first.getFullYear()} – ${agendaDateLabel(last)} ${last.getFullYear()}`;
    $("#agenda-week-label").textContent = dateRange;
    $("#agenda-mobile-days").innerHTML = dates.map((date) => {
      const key = dateKey(date), count = sessionsByDate.get(key).length;
      return `<button type="button" class="calendar-day-button${key === state.agendaSelectedDay ? " selected" : ""}${key === todayKey ? " today" : ""}" data-agenda-day="${key}" aria-pressed="${key === state.agendaSelectedDay}" aria-label="${WEEKDAYS[date.getDay()]}, ${agendaDateLabel(date, { day: "numeric", month: "long" })}${count ? `, ${count} ${count === 1 ? "sessão" : "sessões"}` : ", sem sessões"}"><small>${["seg.", "ter.", "qua.", "qui.", "sex.", "sáb.", "dom."][ (date.getDay() + 6) % 7 ]}</small><strong>${date.getDate()}</strong><i class="calendar-day-dot${count ? " has-sessions" : ""}"></i></button>`;
    }).join("");
    const eventMarkup = (item) => {
      const { session, patient, time } = item,
        status = session.attendance === "missed" ? "Faltou" : session.attendance === "rescheduled" ? "Remarcou" : session.paid ? "Pago" : "";
      return `<button type="button" class="calendar-event${session.attendance === "missed" ? " missed" : ""}" data-agenda-session="${escapeHtml(session.id)}" aria-haspopup="dialog" aria-label="Editar sessão de ${escapeHtml(patient.name)}, ${time}${status ? `, ${status}` : ""}"><strong>${escapeHtml(patient.name)}</strong><span>${time}${status ? ` · ${status}` : ""}</span></button>`;
    };
    const weekCells = [`<div class="calendar-day-heading calendar-time-heading"></div>`, ...dates.map((date) => {
      const key = dateKey(date);
      return `<div class="calendar-day-heading${key === todayKey ? " is-today" : ""}"><small>${["seg.", "ter.", "qua.", "qui.", "sex.", "sáb.", "dom."][ (date.getDay() + 6) % 7 ]}</small><strong>${date.getDate()}</strong></div>`;
    })];
    for (const hour of agendaHours) {
      weekCells.push(`<div class="calendar-time-cell">${String(hour).padStart(2, "0")}:00</div>`);
      dates.forEach((date) => {
        const hourItems = sessionsByDate.get(dateKey(date)).filter((item) => Number(item.time.split(":")[0]) === hour);
        const content = hourItems.length > 1
          ? `<div class="calendar-overlap-group"><span class="calendar-overlap-count">${hourItems.length} sessões</span>${hourItems.map((item) => `<button type="button" class="calendar-overlap-item" data-agenda-session="${escapeHtml(item.session.id)}" aria-haspopup="dialog" aria-label="Editar sessão de ${escapeHtml(item.patient.name)}, ${item.time}"><strong>${escapeHtml(item.patient.name)}</strong><span>${item.time}${item.session.attendance === "missed" ? " · Faltou" : item.session.attendance === "rescheduled" ? " · Remarcou" : item.session.paid ? " · Pago" : ""}</span></button>`).join("")}</div>`
          : hourItems.map(eventMarkup).join("");
        weekCells.push(`<div class="calendar-hour-cell${dateKey(date) === todayKey ? " is-today" : ""}">${content}</div>`);
      });
    }
    $("#agenda-week").innerHTML = weekCells.join("");
    const selectedItems = sessionsByDate.get(state.agendaSelectedDay) || [],
      selectedDate = dates.find((date) => dateKey(date) === state.agendaSelectedDay);
    $("#agenda-mobile-day").innerHTML = `<h3>${agendaDateLabel(selectedDate, { weekday: "long", day: "numeric", month: "long" })}</h3>${selectedItems.length ? `<div class="calendar-day-timeline">${selectedItems.map((item) => `<div class="calendar-mobile-event"><time>${item.time}</time>${eventMarkup(item)}</div>`).join("")}</div>` : `<p class="calendar-empty-day">Nenhuma sessão agendada para este dia.</p>`}`;
  }
  function closeAgendaSessionPopover() {
    const popover = $("#agenda-session-popover");
    popover.hidden = true;
    popover.removeAttribute("data-session-id");
    state.agendaSessionAnchor = null;
  }
  function positionAgendaSessionPopover() {
    const anchor = state.agendaSessionAnchor,
      popover = $("#agenda-session-popover");
    if (!anchor || !document.contains(anchor)) {
      closeAgendaSessionPopover();
      return;
    }
    const rect = anchor.getBoundingClientRect(), width = Math.min(340, window.innerWidth - 24);
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      closeAgendaSessionPopover();
      return;
    }
    popover.style.width = `${width}px`;
    const height = popover.offsetHeight,
      left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top = rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }
  function openAgendaSessionPopover(sessionId, anchor) {
    const session = state.clinicSessions.find((item) => item.id === sessionId && !item.deleted),
      patient = state.patients.find((item) => item.id === session?.patientId),
      popover = $("#agenda-session-popover");
    if (!session || !patient) return;
    $("#agenda-session-title").textContent = patient.name;
    $("#agenda-session-date").value = session.date || "";
    $("#agenda-session-time").value = (session.time || patient.time || "09:00").slice(0, 5);
    $("#agenda-session-attendance").value = ["attended", "missed"].includes(session.attendance) ? session.attendance : "pending";
    $("#agenda-session-amount").value = Number(session.amount || 0);
    $("#agenda-session-paid").checked = Boolean(session.paid);
    const isRescheduled = session.attendance === "rescheduled";
    ["#agenda-session-date", "#agenda-session-time", "#agenda-session-attendance", "#agenda-session-amount", "#agenda-session-paid"].forEach((selector) => { $(selector).disabled = isRescheduled; });
    $("#agenda-session-form button[type=submit]").disabled = isRescheduled;
    $("#agenda-session-reschedule").textContent = isRescheduled ? "Corrigir remarcação" : "Remarcar";
    popover.dataset.sessionId = session.id;
    state.agendaSessionAnchor = anchor;
    popover.hidden = false;
    positionAgendaSessionPopover();
    $("#agenda-session-date").focus({ preventScroll: true });
  }
  function sessionIsOverdue(session, patient, today = new Date().toLocaleDateString("sv-SE")) {
    if (session.paid || session.deleted || session.placeholder || session.attendance === "missed" || session.attendance === "rescheduled" || !session.date) return false;
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
  function openRescheduleModal(session, draft = {}) {
    const patient = state.patients.find((item) => item.id === session.patientId),
      linked = state.clinicSessions.find((item) => item.id === session.rescheduledToId) || state.clinicSessions.find((item) => item.rescheduledFromId === session.id),
      dateInput = $("#reschedule-date"),
      replacement = linked || null;
    state.pendingRescheduleSessionId = session.id;
    $("#reschedule-session-title").textContent = replacement ? "Corrigir remarcação" : "Remarcar sessão";
    $("#reschedule-session-copy").textContent = `${patient?.name || "Paciente"} · sessão original em ${formatStatementDate(session.date)} às ${(session.time || patient?.time || "09:00").slice(0, 5)}. Se ainda não souber o novo horário, você poderá defini-lo depois.`;
    dateInput.value = draft.date || replacement?.date || "";
    $("#reschedule-time").value = draft.time || replacement?.time || session.time || patient?.time || "09:00";
    $("#reschedule-note").value = draft.note ?? replacement?.rescheduleNote ?? session.rescheduleNote ?? "";
    $("#reschedule-time-error").hidden = true;
    openModal("reschedule-session-modal");
  }
  async function commitReschedule(change) {
    const source = state.clinicSessions.find((item) => item.id === change.originalSessionId);
    if (!source) return;
    let replacement = state.clinicSessions.find((item) => item.id === source.rescheduledToId) || state.clinicSessions.find((item) => item.rescheduledFromId === source.id);
    source.attendance = "rescheduled";
    source.rescheduledAt ||= new Date().toISOString();
    source.rescheduleNote = change.note || "";
    const deferred = Boolean(change.defer),
      sessionDate = deferred ? "" : change.date,
      sessionMonth = deferred ? (source.month || source.date.slice(0, 7)) : change.date.slice(0, 7);
    if (!replacement) {
      replacement = {
        id: uid(), patientId: source.patientId, date: sessionDate, scheduledDate: sessionDate,
        month: sessionMonth, time: deferred ? "" : change.time, amount: Number(source.amount || 0),
        kind: source.kind || "regular", attendance: "pending", paid: Boolean(source.paid), placeholder: deferred,
        rescheduledFromId: source.id, rescheduleNote: change.note || "",
      };
      state.clinicSessions.push(replacement);
      source.rescheduledToId = replacement.id;
    } else {
      replacement.deleted = false;
      replacement.placeholder = deferred;
      replacement.date = sessionDate;
      replacement.scheduledDate = sessionDate;
      replacement.month = sessionMonth;
      replacement.time = deferred ? "" : change.time;
      if (deferred) replacement.paid = Boolean(source.paid);
      replacement.rescheduleNote = change.note || "";
      source.rescheduledToId = replacement.id;
    }
    state.pendingSessionChange = null;
    state.pendingRescheduleSessionId = "";
    closeModal("session-conflict-modal");
    closeModal("reschedule-session-modal");
    await saveData("Remarcação salva.");
  }
  function monthSessionDates(patient, ym) {
    const [year, month] = ym.split("-").map(Number);
    const monthStart = new Date(year, month - 1, 1, 12),
      monthEnd = new Date(year, month, 0, 12),
      storedStart = patient.startDate || dateKey(new Date()),
      effectiveFrom = patient.scheduleModel === "v2" && storedStart.slice(0, 7) === ym ? `${ym}-01` : storedStart,
      start = new Date(`${effectiveFrom}T12:00:00`),
      dates = [], schedules = patientSchedules(patient),
      modernSchedule = patient.scheduleModel === "v2";
    if (start > monthEnd) return dates;
    if (!schedules.length) schedules.push({ weekday: start.getDay(), day: start.getDate(), time: patient.time || "" });
    for (const schedule of schedules) {
      if (patient.frequency === "monthly") {
        const date = modernSchedule && schedule.weekOfMonth && schedule.weekday !== null
          ? monthlyWeekdayDate(year, month, schedule.weekday, schedule.weekOfMonth)
          : new Date(year, month - 1, Math.min(modernSchedule ? schedule.day || start.getDate() : start.getDate(), monthEnd.getDate()), 12);
        if (date >= monthStart && date >= start) dates.push({ date: dateKey(date), time: schedule.time, scheduleId: scheduleId(schedule) });
        continue;
      }
      const weekday = schedule.weekday ?? start.getDay();
      if (modernSchedule && patient.frequency === "biweekly") {
        let date = new Date(start);
        date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
        const occurrence = Math.floor((date.getDate() - 1) / 7) + 1,
          wantsEvenWeek = patient.biweeklyPattern === "second-fourth",
          isEvenWeek = occurrence % 2 === 0;
        if (wantsEvenWeek !== isEvenWeek) date.setDate(date.getDate() + 7);
        while (date < monthStart) date.setDate(date.getDate() + 14);
        while (date <= monthEnd) {
          if (date >= start) dates.push({ date: dateKey(date), time: schedule.time, scheduleId: scheduleId(schedule) });
          date.setDate(date.getDate() + 14);
        }
        continue;
      }
      const interval = patient.frequency === "biweekly" ? 14 : 7;
      let date = new Date(start);
      date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
      while (date < monthStart) date.setDate(date.getDate() + interval);
      while (date <= monthEnd) {
        dates.push({ date: dateKey(date), time: schedule.time, scheduleId: scheduleId(schedule) });
        date.setDate(date.getDate() + interval);
      }
    }
    return dates;
  }
  function ensureClinicSessions(ym) {
    const regularOccurrences = new Map(),
      extraSessions = [];
    let changed = false;
    for (const session of state.clinicSessions) {
      if (session.kind === "extra" || session.kind === "emergency" || session.rescheduledFromId) {
        extraSessions.push(session);
        continue;
      }
      if (!session.scheduleId) {
        const patient = state.patients.find((item) => item.id === session.patientId),
          scheduledDate = session.scheduledDate || session.originalDate || session.date,
          weekday = scheduledDate ? new Date(`${scheduledDate}T12:00:00`).getDay() : -1,
          patientSlots = patientSchedules(patient || {}),
          candidates = patientSlots.filter((slot) => slot.weekday === weekday),
          sessionTime = (session.time || patient?.time || "").slice(0, 5),
          matched = (patient?.frequency === "monthly" ? patientSlots.find((slot) => slot.time === sessionTime) : null) || candidates.find((slot) => slot.time === sessionTime) || (candidates.length === 1 ? candidates[0] : patient?.frequency === "monthly" && patientSlots.length === 1 ? patientSlots[0] : null);
        if (matched) {
          session.scheduleId = scheduleId(matched);
          changed = true;
        }
      }
      const scheduledDate = session.scheduledDate || session.originalDate || session.date,
        key = `${session.patientId}|${scheduledDate}|${session.scheduleId || session.time || ""}`,
        previous = regularOccurrences.get(key);
      if (!previous) regularOccurrences.set(key, session);
      else {
        const previousMoved = previous.date !== (previous.scheduledDate || previous.originalDate || previous.date),
          currentMoved = session.date !== scheduledDate;
        if (currentMoved && !previousMoved) regularOccurrences.set(key, session);
      }
    }
    const cleaned = [...regularOccurrences.values(), ...extraSessions];
    changed ||= cleaned.length !== state.clinicSessions.length;
    if (changed) state.clinicSessions = cleaned;
    const existing = new Set();
    state.clinicSessions.forEach((session) => {
      const date = session.scheduledDate || session.originalDate || session.date;
      existing.add(`${session.patientId}|${date}|${session.scheduleId || session.time || ""}`);
      if (session.time) existing.add(`${session.patientId}|${date}|${session.time}`);
    });
    for (const patient of state.patients) {
      for (const occurrence of monthSessionDates(patient, ym)) {
        const { date, time, scheduleId: occurrenceScheduleId } = occurrence,
          key = `${patient.id}|${date}|${occurrenceScheduleId || time}`,
          timeKey = `${patient.id}|${date}|${time}`;
        if (existing.has(key) || existing.has(timeKey)) continue;
        state.clinicSessions.push({ id: uid(), patientId: patient.id, date, scheduledDate: date, scheduleId: occurrenceScheduleId, month: ym, time: time || patient.time || "", amount: Number(patient.price || 0), kind: "regular", attendance: "pending", paid: false });
        existing.add(key);
        if (time) existing.add(timeKey);
        changed = true;
      }
    }
    for (const source of state.clinicSessions.filter((session) => !session.deleted && session.attendance === "rescheduled")) {
      const replacement = state.clinicSessions.find((session) => !session.deleted && session.rescheduledFromId === source.id);
      if (replacement) {
        if (!replacement.date || !replacement.time) {
          if (!replacement.placeholder) changed = true;
          replacement.placeholder = true;
          replacement.date = "";
          replacement.scheduledDate = "";
          replacement.time = "";
          replacement.paid = Boolean(source.paid);
        }
        if (replacement.placeholder && replacement.paid !== Boolean(source.paid)) {
          replacement.paid = Boolean(source.paid);
          changed = true;
        }
        if (replacement.placeholder && !Number(replacement.amount || 0) && Number(source.amount || 0)) {
          replacement.amount = Number(source.amount || 0);
          changed = true;
        }
        source.rescheduledToId = replacement.id;
        continue;
      }
      const month = source.month || source.date?.slice(0, 7) || ym,
        placeholder = {
          id: uid(), patientId: source.patientId, date: "", scheduledDate: "", month, time: "",
          amount: Number(source.amount || 0), kind: source.kind || "regular", attendance: "pending",
        paid: Boolean(source.paid), placeholder: true, rescheduledFromId: source.id,
        };
      state.clinicSessions.push(placeholder);
      source.rescheduledToId = placeholder.id;
      changed = true;
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
      visibleSessions = (overdueOnly ? overdueSessions : sessions).filter((session) => visiblePatientIds.has(session.patientId) && !session.placeholder && session.attendance !== "rescheduled"),
      paidTotal = (overdueOnly ? overdueSessions : sessions).filter((session) => visiblePatientIds.has(session.patientId) && session.paid && session.attendance !== "rescheduled").reduce((sum, session) => sum + Number(session.amount || 0), 0),
      receivableTotal = visibleSessions.filter((session) => !session.paid && session.attendance !== "missed").reduce((sum, session) => sum + Number(session.amount || 0), 0),
      totalExpected = paidTotal + receivableTotal,
      overdueTotal = visibleSessions.reduce((sum, session) => sum + Number(session.amount || 0), 0),
      seenCount = visibleSessions.filter((session) => session.attendance === "attended").length;
    $("#patients-month").textContent = monthLabel(state.activeMonth).toLocaleLowerCase("pt-BR");
    $("#patient-list").innerHTML = visiblePatients.map((patient) => {
      const visits = (overdueOnly ? overdueSessions : sessions).filter((session) => session.patientId === patient.id).sort((a, b) => {
          return a.date.localeCompare(b.date);
        }),
        activeVisits = visits.filter((session) => !session.placeholder && session.attendance !== "rescheduled"),
        displayVisits = visits.filter((session) => !session.placeholder).flatMap((session) => [
          session,
          ...visits.filter((item) => item.placeholder && item.rescheduledFromId === session.id),
        ]),
        total = activeVisits.reduce((sum, session) => sum + Number(session.amount || 0), 0),
        scheduleSlots = patientSchedules(patient),
        scheduleLabel = scheduleSlots.length ? scheduleSlots.map((slot) => patient.frequency === "monthly" ? `${MONTH_WEEK_LABELS[slot.weekOfMonth] || "Última"} ${WEEKDAY_SHORT[slot.weekday] || "—"} · ${slot.time}` : `${WEEKDAY_SHORT[slot.weekday] || "Dia —"} · ${slot.time}`).join(" / ") : "Dia e horário a definir",
        visitControls = displayVisits.map((session) => {
          const overdue = sessionIsOverdue(session, patient),
            extra = session.kind === "extra" || session.kind === "emergency",
            readonly = session.attendance === "rescheduled",
            placeholder = Boolean(session.placeholder),
            replacement = readonly ? state.clinicSessions.find((item) => !item.deleted && item.rescheduledFromId === session.id) : null,
            source = session.rescheduledFromId ? state.clinicSessions.find((item) => item.id === session.rescheduledFromId) : null,
            linkLabel = replacement
              ? `Remarcada para${replacement.placeholder ? " · data e horário a definir" : ` · ${formatStatementDate(replacement.date)} às ${(replacement.time || patient.time || "09:00").slice(0, 5)}`}`
              : source
                ? `${placeholder ? "Nova sessão · remarcação de" : "Continuação da sessão de"} ${formatStatementDate(source.date)} às ${(source.time || patient.time || "09:00").slice(0, 5)}`
                : "",
            linked = Boolean(linkLabel),
            disabled = readonly || placeholder;
          return `<div class="session-line${overdue ? " overdue" : ""}${readonly ? " readonly reschedule-source" : ""}${source ? " reschedule-destination" : ""}${linked ? " reschedule-linked" : ""}${placeholder ? " reschedule-placeholder" : ""}">${linkLabel ? `<small class="session-link-label">↳ ${escapeHtml(linkLabel)}</small>` : ""}<input class="session-datetime" type="datetime-local" value="${placeholder ? "" : `${session.date}T${(session.time || patient.time || "09:00").slice(0, 5)}`}" data-session-datetime="${session.id}" aria-label="Data e horário da sessão de ${escapeHtml(patient.name)}" ${readonly ? "disabled" : ""} />${overdue ? '<span class="session-kind-placeholder" aria-hidden="true"></span><span class="session-kind overdue-tag">Vencida</span>' : extra ? '<span class="session-kind emergency-tag">Extra</span>' : '<span class="session-kind-placeholder" aria-hidden="true"></span>'}<select aria-label="Presença de ${escapeHtml(patient.name)}" data-attendance="${session.id}" ${disabled ? "disabled" : ""}><option value="pending" ${session.attendance === "pending" ? "selected" : ""}>A confirmar</option><option value="attended" ${session.attendance === "attended" ? "selected" : ""}>Compareceu</option><option value="missed" ${session.attendance === "missed" ? "selected" : ""}>Faltou</option><option value="rescheduled" ${session.attendance === "rescheduled" ? "selected" : ""}>Remarcou</option></select><label class="session-paid"><input type="checkbox" data-paid="${session.id}" ${session.paid ? "checked" : ""} aria-label="Sessão paga" ${disabled ? "disabled" : ""} /> Pago</label><input class="session-amount" type="number" min="0" step="0.01" value="${session.amount === "" ? "" : Number(session.amount || 0)}" data-session-amount="${session.id}" aria-label="Valor da sessão" ${readonly ? "disabled" : ""} /><button class="session-delete" type="button" data-session-delete="${session.id}" aria-label="Excluir sessão de ${escapeHtml(patient.name)}" title="Excluir sessão" ${disabled ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg></button></div>`;
        }).join("") || `<span class="metric-period">${overdueOnly ? "Sem sessões vencidas" : "Sem sessões neste mês"}</span>`,
        frequencyClass = patient.frequency || "weekly";
      const paid = visits.filter((session) => session.paid && session.attendance !== "rescheduled").reduce((sum, session) => sum + Number(session.amount || 0), 0),
        receivable = activeVisits.filter((session) => !session.paid && session.attendance !== "missed").reduce((sum, session) => sum + Number(session.amount || 0), 0),
        overdueAmount = activeVisits.filter((session) => sessionIsOverdue(session, patient)).reduce((sum, session) => sum + Number(session.amount || 0), 0),
        accordionOpen = !isMobileLayout && state.patientView === "table" ? " open" : "";
      return `<tr><td><div class="patient-name-cell"><strong>${escapeHtml(patient.name)}</strong><button class="patient-edit" data-patient-edit="${patient.id}" aria-label="Editar paciente">✎</button></div></td><td data-label="Telefone">${escapeHtml(patient.phone || "—")}</td><td data-label="Agenda"><span class="frequency-badge ${frequencyClass}">${FREQUENCIES[frequencyClass] || "Semanal"}</span><small class="schedule-sub">${scheduleLabel}</small><small class="schedule-sub payment-frequency">Pagamento ${FREQUENCIES[patient.paymentFrequency] || "mensal"}</small></td><td data-label="Sessões"><strong>${activeVisits.length}</strong><small class="sessions-sub">${activeVisits.filter((session) => session.attendance === "attended").length} realizadas</small></td><td data-label="Valor por sessão"><strong>${money(patient.price || 0)}</strong><small class="sessions-sub">${money(total)} ${overdueOnly ? "vencido" : "no mês"}</small></td><td class="patient-sessions-cell" data-label="Sessões e pagamentos"><details class="session-accordion"${accordionOpen}><summary><span>Ver ${visits.length === 1 ? "sessão" : `${visits.length} sessões`}</span>${overdueAmount ? `<strong>${money(overdueAmount)} vencidos</strong>` : "<small>presenças e pagamentos</small>"}<i class="session-disclosure-chevron" aria-hidden="true"></i></summary><div class="session-lines">${visitControls}</div></details></td><td data-label="Recebido / a receber"><strong>${money(paid)}</strong><small class="sessions-sub receivable-amount">${overdueOnly ? "Vencido: " : "A receber: "}${money(receivable)}</small></td></tr>`;
    }).join("");
    const noPatients = patients.length === 0;
    $("#patients-empty").classList.toggle("show", visiblePatients.length === 0);
    $("#patients-empty-title").textContent = noPatients ? "Nenhum paciente cadastrado" : "Nenhum paciente encontrado";
    $("#patients-empty-copy").textContent = noPatients
      ? "Cadastre um paciente para acompanhar sessões, pagamentos e frequência."
      : "Tente alterar ou limpar os filtros para ver pacientes.";
    $("#empty-patient-add").hidden = !noPatients;
    $("#patient-list").closest(".table-wrap").querySelector("table").style.display = visiblePatients.length ? "" : "none";
    $("#patients-totals").innerHTML = `<span>${visiblePatients.length} de ${patients.length} ${patients.length === 1 ? "paciente" : "pacientes"}</span><span>${overdueOnly ? `${visibleSessions.length} sessões vencidas` : `${visibleSessions.length} sessões previstas · ${seenCount} realizadas`}</span>${overdueOnly ? `<strong>${money(overdueTotal)} em aberto</strong>` : `<strong>${money(paidTotal)} recebidos</strong><strong class="patients-receivable-total">${money(receivableTotal)} a receber</strong><strong class="patients-grand-total">${money(totalExpected)} total do mês</strong>`}`;
  }
  function render() {
    ensureClinicSessions(state.activeMonth);
    renderPeriod();
    renderSummary();
    renderCharts();
    renderTransactions();
    renderCategories();
    renderClinic();
    renderAgenda();
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
    const brandColor = getComputedStyle(document.body).getPropertyValue("--brand").trim() || "#6f9fca";
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
            borderColor: brandColor,
            backgroundColor: `${brandColor}18`,
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
    $("#patient-phone").value = formatBrazilianPhone(patient?.phone || "");
    $("#patient-frequency").value = patient?.frequency || "weekly";
    $("#patient-payment-frequency").value = patient?.paymentFrequency || "monthly";
    const frequency = $("#patient-frequency").value,
      today = dateKey(new Date()),
      oldSchedules = patientSchedules(patient || {}),
      defaultWeekday = patient?.weekday ?? new Date(`${patient?.startDate || today}T12:00:00`).getDay(),
      defaultMonthlyDay = Number(patient?.monthlyDay || patient?.startDate?.slice(8, 10)) || Number(today.slice(8, 10)),
      schedules = oldSchedules.length
        ? oldSchedules.map((schedule) => frequency === "monthly"
          ? schedule.weekOfMonth && schedule.weekday !== null
            ? { weekday: schedule.weekday, weekOfMonth: schedule.weekOfMonth, time: schedule.time }
            : { ...monthlyRuleFromLegacyDay(schedule.day ?? defaultMonthlyDay, patient?.startDate || today), time: schedule.time }
          : { weekday: schedule.weekday ?? defaultWeekday, time: schedule.time })
        : [frequency === "monthly" ? { ...monthlyRuleFromLegacyDay(Number(today.slice(8, 10)), today), time: patient?.time || "" } : { weekday: defaultWeekday, time: patient?.time || "" }];
    const legacyBiweeklyDate = patient?.startDate ? Number(patient.startDate.slice(8, 10)) : 1,
      legacyPattern = legacyBiweeklyDate <= 7 || (legacyBiweeklyDate > 14 && legacyBiweeklyDate <= 21) ? "first-third" : "second-fourth";
    renderPatientRecurrenceOptions(frequency, patient?.biweeklyPattern || legacyPattern);
    renderPatientScheduleFields(schedules, frequency);
    $("#patient-price").value = patient?.price ?? "";
    $("#patient-time-conflict").hidden = true;
    state.pendingPatientSave = null;
    $("#patient-modal-title").textContent = patient ? "Editar paciente" : "Novo paciente";
    $("#delete-patient-action").hidden = !patient;
    openModal("patient-modal");
  }
  function renderPatientRecurrenceOptions(frequency, biweeklyPattern = "first-third") {
    const options = $("#patient-recurrence-options");
    options.dataset.biweeklyPattern = biweeklyPattern;
    if (frequency === "biweekly") {
      options.innerHTML = `<label class="field-label">Quais semanas do mês?<select id="patient-biweekly-pattern"><option value="first-third" ${biweeklyPattern === "first-third" ? "selected" : ""}>1ª e 3ª semanas</option><option value="second-fourth" ${biweeklyPattern === "second-fourth" ? "selected" : ""}>2ª e 4ª semanas</option></select><small class="field-hint">As sessões quinzenais são geradas desde o início do mês conforme esse padrão.</small></label>`;
    } else if (frequency === "monthly") {
      options.innerHTML = `<p class="field-hint recurrence-hint">Escolha a semana, o dia da semana e o horário. Ex.: última quarta-feira ou primeira terça-feira do mês.</p>`;
    } else options.innerHTML = "";
  }
  function renderPatientScheduleFields(schedules, frequency) {
    const container = $("#patient-schedules");
    const isMonthly = frequency === "monthly";
    $(".patient-schedule-columns").classList.toggle("monthly", isMonthly);
    $("#patient-schedule-heading").textContent = isMonthly ? "Regras mensais" : "Dias fixos da semana";
    $("#patient-schedule-day-label").textContent = isMonthly ? "Semana" : "Dia da semana";
    $("#patient-schedule-weekday-label").hidden = !isMonthly;
    $("#add-patient-schedule").textContent = isMonthly ? "＋ Adicionar regra mensal" : "＋ Adicionar horário";
    container.innerHTML = schedules.map((schedule) => `<div class="patient-schedule-row${isMonthly ? " monthly" : ""}">${isMonthly ? `<select data-schedule-week aria-label="Semana do mês">${[["first", "1ª"], ["second", "2ª"], ["third", "3ª"], ["fourth", "4ª"], ["last", "Última"]].map(([value, label]) => `<option value="${value}" ${schedule.weekOfMonth === value ? "selected" : ""}>${label}</option>`).join("")}</select>` : ""}<select data-schedule-weekday aria-label="Dia da semana">${WEEKDAY_OPTIONS.map((day, weekday) => `<option value="${weekday}" ${Number(schedule.weekday) === weekday ? "selected" : ""}>${day}</option>`).join("")}</select><input data-schedule-time type="time" value="${escapeHtml(schedule.time || "")}" aria-label="Horário da sessão" required /><button class="remove-patient-schedule" type="button" aria-label="Remover este horário" title="Remover horário">×</button></div>`).join("");
    const removeButtons = [...container.querySelectorAll(".remove-patient-schedule")];
    removeButtons.forEach((button) => { button.hidden = removeButtons.length === 1; });
  }
  function readPatientScheduleFields() {
    return [...$("#patient-schedules").querySelectorAll(".patient-schedule-row")].map((row) => ({ weekday: Number(row.querySelector("[data-schedule-weekday]").value), weekOfMonth: row.querySelector("[data-schedule-week]")?.value || null, time: row.querySelector("[data-schedule-time]").value }));
  }
  async function savePatientRecord(patient) {
    const id = patient.id,
      previousPatient = state.patients.find((item) => item.id === id),
      previousSchedules = patientSchedules(previousPatient || {}).map((schedule) => `${scheduleId(schedule)}-${schedule.time}`).sort().join("|"),
      nextSchedules = patientSchedules(patient).map((schedule) => `${scheduleId(schedule)}-${schedule.time}`).sort().join("|"),
      scheduleChanged = previousPatient && (previousPatient.frequency !== patient.frequency || previousPatient.startDate !== patient.startDate || previousPatient.scheduleModel !== patient.scheduleModel || previousPatient.biweeklyPattern !== patient.biweeklyPattern || previousPatient.monthlyDay !== patient.monthlyDay || previousSchedules !== nextSchedules);
    if (previousPatient?.frequency === "monthly" && previousPatient.scheduleModel !== "v2") {
      const legacyMonthlyDay = String(Number(previousPatient.startDate?.slice(8, 10)) || 1);
      state.clinicSessions.forEach((session) => { if (session.patientId === id && session.kind !== "extra" && session.kind !== "emergency" && !session.rescheduledFromId) session.scheduleId = legacyMonthlyDay; });
    }
    state.patients = state.patients.some((item) => item.id === id) ? state.patients.map((item) => item.id === id ? patient : item) : [...state.patients, patient];
    if (scheduleChanged) {
      state.clinicSessions = state.clinicSessions.filter((session) => session.patientId !== id || session.kind === "extra" || session.kind === "emergency" || session.rescheduledFromId || (session.date || session.scheduledDate) < patient.startDate || session.paid || session.attendance !== "pending");
    } else if (previousPatient && previousPatient.price !== patient.price) {
      for (const session of state.clinicSessions) {
        if (session.patientId === id && session.date >= state.activeMonth + "-01" && !session.paid && session.attendance === "pending") session.amount = patient.price;
      }
    }
    ensureClinicSessions(localMonth());
    state.pendingPatientSave = null;
    $("#patient-time-conflict").hidden = true;
    closeModal("patient-modal");
    await saveData("Paciente salvo.");
  }
  async function commitSessionDateTime(change) {
    if (change.kind === "reschedule") {
      await commitReschedule(change);
      return;
    }
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
    session.date = change.date;
    session.time = change.time;
    session.month = change.date.slice(0, 7);
    session.scheduledDate ||= change.date;
    session.placeholder = false;
    if (change.edits) Object.assign(session, change.edits);
    state.pendingSessionChange = null;
    closeModal("session-conflict-modal");
    closeAgendaSessionPopover();
    await saveData("Horário da sessão atualizado.");
  }
  function bind() {
    bindSectionNavigation();
    $("#patient-phone").addEventListener("input", (event) => formatPhoneInput(event.currentTarget));
    $("#agenda-prev").addEventListener("click", () => {
      const current = state.agendaWeek || new Date();
      state.agendaWeek = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7, 12);
      renderAgenda();
    });
    $("#agenda-next").addEventListener("click", () => {
      const current = state.agendaWeek || new Date();
      state.agendaWeek = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7, 12);
      renderAgenda();
    });
    $("#agenda-today").addEventListener("click", () => {
      state.agendaWeek = new Date();
      state.agendaSelectedDay = null;
      renderAgenda();
    });
    $("#agenda-mobile-days").addEventListener("click", (event) => {
      const button = event.target.closest("[data-agenda-day]");
      if (!button) return;
      state.agendaSelectedDay = button.dataset.agendaDay;
      renderAgenda();
    });
    $("#agenda").addEventListener("click", (event) => {
      const sessionButton = event.target.closest("[data-agenda-session]");
      if (sessionButton) {
        openAgendaSessionPopover(sessionButton.dataset.agendaSession, sessionButton);
        return;
      }
      if (!event.target.closest("#agenda-session-popover")) closeAgendaSessionPopover();
    });
    document.addEventListener("pointerdown", (event) => {
      const popover = $("#agenda-session-popover");
      if (!popover.hidden && !popover.contains(event.target) && !event.target.closest("[data-agenda-session]")) closeAgendaSessionPopover();
    });
    document.addEventListener("scroll", positionAgendaSessionPopover, true);
    window.addEventListener("resize", positionAgendaSessionPopover);
    $("#agenda-session-close").addEventListener("click", closeAgendaSessionPopover);
    $("#agenda-session-reschedule").addEventListener("click", () => {
      const session = state.clinicSessions.find((item) => item.id === $("#agenda-session-popover").dataset.sessionId);
      if (!session) return;
      closeAgendaSessionPopover();
      openRescheduleModal(session);
    });
    $("#agenda-session-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const sessionId = $("#agenda-session-popover").dataset.sessionId,
        session = state.clinicSessions.find((item) => item.id === sessionId),
        date = $("#agenda-session-date").value,
        time = $("#agenda-session-time").value,
        patient = state.patients.find((item) => item.id === session?.patientId);
      if (!session || !patient || !date || !time) return;
      const edits = { attendance: $("#agenda-session-attendance").value, paid: $("#agenda-session-paid").checked, amount: Math.max(0, Number($("#agenda-session-amount").value || 0)) },
        samePatientDuplicate = state.clinicSessions.some((item) => !item.deleted && !item.placeholder && item.attendance !== "rescheduled" && item.id !== session.id && item.patientId === session.patientId && item.date === date && (item.time || patient.time || "") === time);
      if (samePatientDuplicate) {
        toast("Este paciente já tem uma sessão nesse dia e horário.");
        return;
      }
      const conflicts = state.clinicSessions.filter((item) => {
        if (item.deleted || item.id === session.id || item.patientId === session.patientId || item.attendance === "rescheduled" || item.date !== date) return false;
        const otherPatient = state.patients.find((candidate) => candidate.id === item.patientId);
        return (item.time || otherPatient?.time || "") === time;
      });
      if (conflicts.length) {
        const names = [...new Set(conflicts.map((item) => state.patients.find((candidate) => candidate.id === item.patientId)?.name || "Outro paciente"))];
        state.pendingSessionChange = { sessionId: session.id, date, time, edits };
        $("#session-conflict-copy").textContent = `Já há sessão de ${names.join(", ")} em ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${date}T12:00:00`))} às ${time}. Você pode voltar e escolher outro horário ou salvar mesmo assim.`;
        closeAgendaSessionPopover();
        openModal("session-conflict-modal");
        return;
      }
      session.date = date;
      session.time = time;
      session.month = date.slice(0, 7);
      session.scheduledDate ||= date;
      Object.assign(session, edits);
      closeAgendaSessionPopover();
      await saveData("Sessão atualizada.");
    });
    bindPeriodWidget();
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
    });
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const password = document.getElementById(button.dataset.passwordToggle);
        if (password) setPasswordVisibility(button, password.type === "password");
      });
    });
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
    $("#add-patient-schedule").addEventListener("click", () => {
      const schedules = readPatientScheduleFields(),
        last = schedules[schedules.length - 1] || { weekday: 0, weekOfMonth: "first", time: "" },
        frequency = $("#patient-frequency").value,
        nextSchedule = frequency === "monthly"
          ? { weekOfMonth: ({ first: "second", second: "third", third: "fourth", fourth: "last", last: "first" })[last.weekOfMonth] || "first", weekday: last.weekday, time: last.time }
          : { weekday: ((last.weekday ?? new Date().getDay()) + 1) % 7, time: last.time };
      renderPatientScheduleFields([...schedules, nextSchedule], frequency);
    });
    $("#patient-frequency").addEventListener("change", (event) => {
      const frequency = event.currentTarget.value,
        currentSchedules = readPatientScheduleFields(),
        today = dateKey(new Date()),
        defaultWeekday = new Date(`${today}T12:00:00`).getDay(),
        schedules = currentSchedules.map((schedule) => frequency === "monthly"
          ? { weekday: schedule.weekday ?? defaultWeekday, weekOfMonth: schedule.weekOfMonth || "first", time: schedule.time }
          : { weekday: schedule.weekday ?? defaultWeekday, time: schedule.time }),
        pattern = $("#patient-biweekly-pattern")?.value || $("#patient-recurrence-options").dataset.biweeklyPattern || "first-third";
      renderPatientRecurrenceOptions(frequency, pattern);
      renderPatientScheduleFields(schedules, frequency);
    });
    $("#patient-schedules").addEventListener("click", (event) => {
      const remove = event.target.closest(".remove-patient-schedule");
      if (!remove || $("#patient-schedules").querySelectorAll(".patient-schedule-row").length <= 1) return;
      remove.closest(".patient-schedule-row").remove();
      const buttons = [...$("#patient-schedules").querySelectorAll(".remove-patient-schedule")];
      buttons.forEach((button) => { button.hidden = buttons.length === 1; });
    });
    $("#patient-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = $("#patient-id").value || uid(),
        schedules = readPatientScheduleFields(),
        scheduleKeys = schedules.map((schedule) => scheduleId(schedule));
      if (new Set(scheduleKeys).size !== scheduleKeys.length) {
        toast("Escolha apenas um horário fixo por dia para este paciente.");
        return;
      }
      const primarySchedule = schedules[0],
        frequency = $("#patient-frequency").value,
        today = dateKey(new Date()),
        biweeklyPattern = $("#patient-biweekly-pattern")?.value || $("#patient-recurrence-options").dataset.biweeklyPattern || "first-third",
        previousPatient = state.patients.find((item) => item.id === id),
        scheduleSignature = schedules.map((schedule) => `${scheduleId(schedule)}-${schedule.time}`).sort().join("|"),
        previousSignature = patientSchedules(previousPatient || {}).map((schedule) => `${scheduleId(schedule)}-${schedule.time}`).sort().join("|"),
        recurrenceChanged = previousPatient && (previousPatient.scheduleModel !== "v2" || previousPatient.frequency !== frequency || previousPatient.biweeklyPattern !== biweeklyPattern || previousSignature !== scheduleSignature),
        currentMonthStart = `${today.slice(0, 7)}-01`,
        effectiveStartDate = previousPatient?.scheduleModel === "v2" && !recurrenceChanged
          ? previousPatient.startDate?.slice(0, 7) === today.slice(0, 7) ? currentMonthStart : previousPatient.startDate || currentMonthStart
          : currentMonthStart,
        patient = { id, name: $("#patient-name").value.trim(), phone: $("#patient-phone").value.trim(), frequency, paymentFrequency: $("#patient-payment-frequency").value, startDate: effectiveStartDate, scheduleModel: "v2", biweeklyPattern, monthlyDay: primarySchedule.day || null, schedules, weekday: primarySchedule.weekday ?? new Date(`${today}T12:00:00`).getDay(), time: primarySchedule.time, price: Number($("#patient-price").value) },
        proposedOccurrences = monthSessionDates(patient, state.activeMonth),
        conflicts = state.patients.filter((item) => item.id !== id && monthSessionDates(item, state.activeMonth).some((other) => proposedOccurrences.some((proposed) => proposed.date === other.date && proposed.time === other.time)));
      if (conflicts.length) {
        state.pendingPatientSave = patient;
        $("#patient-time-conflict-copy").textContent = `Já existe atendimento no mesmo dia e horário com ${conflicts.map((item) => item.name).join(", ")} neste mês. Você pode salvar mesmo assim ou voltar e ajustar os horários.`;
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
      if (target.dataset.attendance && target.value === "rescheduled") {
        target.value = session.attendance || "pending";
        openRescheduleModal(session);
        return;
      }
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
      const samePatientDuplicate = session.placeholder && state.clinicSessions.some((item) =>
        !item.deleted && !item.placeholder && item.id !== session.id && item.patientId === session.patientId && item.date === newDate && (item.time || state.patients.find((patient) => patient.id === item.patientId)?.time || "") === newTime,
      );
      if (samePatientDuplicate) {
        toast("Este paciente já tem uma sessão nesse dia e horário.");
        renderClinic();
        return;
      }
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
    $("#reschedule-session-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const source = state.clinicSessions.find((item) => item.id === state.pendingRescheduleSessionId);
      if (!source) return;
      const date = $("#reschedule-date").value,
        time = $("#reschedule-time").value,
        note = $("#reschedule-note").value.trim(),
        linked = state.clinicSessions.find((item) => item.id === source.rescheduledToId) || state.clinicSessions.find((item) => item.rescheduledFromId === source.id),
        duplicate = state.clinicSessions.find((item) => !item.deleted && item.patientId === source.patientId && item.id !== source.id && item.id !== linked?.id && item.attendance !== "rescheduled" && item.date === date && (item.time || state.patients.find((p) => p.id === item.patientId)?.time || "") === time);
      if (duplicate) {
        $("#reschedule-time-error").hidden = false;
        return;
      }
      $("#reschedule-time-error").hidden = true;
      const change = { kind: "reschedule", originalSessionId: source.id, date, time, note };
      const conflicts = state.clinicSessions.filter((item) => {
        if (item.deleted || item.id === source.id || item.id === linked?.id || item.patientId === source.patientId || item.attendance === "rescheduled" || item.date !== date) return false;
        const otherPatient = state.patients.find((patient) => patient.id === item.patientId);
        return (item.time || otherPatient?.time || "") === time;
      });
      if (conflicts.length) {
        const names = [...new Set(conflicts.map((item) => state.patients.find((candidate) => candidate.id === item.patientId)?.name || "Outro paciente"))];
        state.pendingSessionChange = change;
        $("#session-conflict-copy").textContent = `Já há sessão de ${names.join(", ")} em ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${date}T12:00:00`))} às ${time}. Você pode voltar e escolher outro horário ou salvar mesmo assim.`;
        closeModal("reschedule-session-modal");
        openModal("session-conflict-modal");
        return;
      }
      await commitReschedule(change);
    });
    $("#reschedule-later").addEventListener("click", async () => {
      const source = state.clinicSessions.find((item) => item.id === state.pendingRescheduleSessionId);
      if (!source) return;
      await commitReschedule({
        kind: "reschedule", originalSessionId: source.id, defer: true,
        note: $("#reschedule-note").value.trim(),
      });
    });
    $("#cancel-session-conflict").addEventListener("click", () => {
      const change = state.pendingSessionChange;
      state.pendingSessionChange = null;
      closeModal("session-conflict-modal");
      if (change?.kind === "reschedule") {
        const source = state.clinicSessions.find((item) => item.id === change.originalSessionId);
        if (source) openRescheduleModal(source, change);
        return;
      }
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
      $("#current-password").value = "";
      $("#new-password").value = "";
      $("#confirm-password").value = "";
      resetPasswordVisibility($("#change-password-form"));
      $("#settings-status").textContent = "";
      openModal("settings-modal");
    });
    $("#open-settings-mobile").addEventListener("click", () =>
      $("#open-settings").click(),
    );
    $("#firebase-login-form").addEventListener("submit", loginFirebase);
    $("#change-password-form").addEventListener("submit", changeFirebasePassword);
    $("#disconnect-firebase").addEventListener("click", disconnectFirebase);
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
  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }
  async function loadFirebaseSdk() {
    if (!firebaseSdkPromise) {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
      firebaseSdkPromise = Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
      ]).then(([app, auth, firestore]) => ({ ...app, ...auth, ...firestore })).catch((error) => {
        firebaseSdkPromise = null;
        throw error;
      });
    }
    return firebaseSdkPromise;
  }
  async function createFirebaseContext(config) {
    const sdk = await loadFirebaseSdk(),
      existingContext = firebaseContext && stableStringify(firebaseContext.app.options) === stableStringify(config);
    if (existingContext) return firebaseContext;
    const previousApp = sdk.getApps().find((item) => item.name === "controle-leidiane");
    if (previousApp) await sdk.deleteApp(previousApp);
    const app = sdk.initializeApp(config, "controle-leidiane"),
      auth = sdk.getAuth(app),
      db = sdk.getFirestore(app);
    firebaseContext = { ...sdk, app, auth, db, config, user: null };
    return firebaseContext;
  }
  function waitForFirebaseUser(context) {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      unsubscribe = context.onAuthStateChanged(context.auth, (user) => {
        unsubscribe();
        resolve(user);
      }, (error) => {
        unsubscribe();
        reject(error);
      });
    });
  }
  function firebaseCollection(context, name) {
    return context.collection(context.db, "users", context.user.uid, name);
  }
  function firebaseMetaDocument(context) {
    return context.doc(context.db, "users", context.user.uid, "appData", "main");
  }
  async function readFirebaseRecord(context = firebaseContext) {
    const [entries, patients, clinicSessions, metadata] = await Promise.all([
      context.getDocs(firebaseCollection(context, "entries")),
      context.getDocs(firebaseCollection(context, "patients")),
      context.getDocs(firebaseCollection(context, "clinicSessions")),
      context.getDoc(firebaseMetaDocument(context)),
    ]);
    const meta = metadata.exists() ? metadata.data() : {},
      data = {
        entries: entries.docs.map((item) => item.data()),
        patients: patients.docs.map((item) => item.data()),
        clinicSessions: clinicSessions.docs.map((item) => item.data()),
        potPercentages: { accounts: 50, wishes: 30, future: 20, ...(meta.potPercentages || {}) },
        categories: mergeCategories(meta.categories || []),
        importedThrough: meta.importedThrough || {},
        updatedAt: meta.updatedAt || "",
      },
      exists = entries.size > 0 || patients.size > 0 || clinicSessions.size > 0;
    firebaseShadow = exists || metadata.exists() ? cloneData(data) : null;
    return { data, exists, metadataExists: metadata.exists() };
  }
  function stopFirebaseWatch() {
    firebaseWatchUnsubscribers.forEach((unsubscribe) => unsubscribe());
    firebaseWatchUnsubscribers = [];
  }
  function watchFirebaseRecord(context) {
    stopFirebaseWatch();
    const live = { entries: [], patients: [], clinicSessions: [], metadata: {} }, ready = new Set();
    const publish = (key, value) => {
      live[key] = value;
      ready.add(key);
      if (ready.size < 4 || firebaseContext !== context || !context.user) return;
      const data = {
        entries: live.entries,
        patients: live.patients,
        clinicSessions: live.clinicSessions,
        potPercentages: { accounts: 50, wishes: 30, future: 20, ...(live.metadata.potPercentages || {}) },
        categories: mergeCategories(live.metadata.categories || []),
        importedThrough: live.metadata.importedThrough || {},
        updatedAt: live.metadata.updatedAt || "",
      };
      firebaseShadow = cloneData(data);
      firebaseShadow.metadata = live.metadata;
      applyData(data);
      alignInitialMonth();
      render();
    };
    const watchCollection = (name) => context.onSnapshot(
      firebaseCollection(context, name),
      (snapshot) => publish(name, snapshot.docs.map((item) => item.data())),
      () => {},
    );
    firebaseWatchUnsubscribers = [
      watchCollection("entries"),
      watchCollection("patients"),
      watchCollection("clinicSessions"),
      context.onSnapshot(firebaseMetaDocument(context), (snapshot) => publish("metadata", snapshot.exists() ? snapshot.data() : {}), () => {}),
    ];
  }
  async function syncFirebaseRecord(record = dataRecord()) {
    if (!firebaseContext?.user) throw Error("Entre na conta Firebase para sincronizar.");
    const context = firebaseContext,
      shadow = firebaseShadow || { entries: [], patients: [], clinicSessions: [] },
      operations = [];
    for (const name of ["entries", "patients", "clinicSessions"]) {
      const oldItems = new Map((shadow[name] || []).map((item) => [String(item.id), item])),
        newItems = new Map((record[name] || []).map((item) => [String(item.id), item]));
      for (const [id, item] of newItems) {
        if (!id || id === "undefined") throw Error(`Um registro em ${name} não tem ID.`);
        if (stableStringify(oldItems.get(id)) === stableStringify(item)) continue;
        operations.push({ type: "set", ref: context.doc(context.db, "users", context.user.uid, name, id), data: item });
      }
      for (const id of oldItems.keys()) {
        if (!newItems.has(id)) operations.push({ type: "delete", ref: context.doc(context.db, "users", context.user.uid, name, id) });
      }
    }
    const metadata = {
      potPercentages: record.potPercentages,
      categories: record.categories,
      importedThrough: record.importedThrough,
      updatedAt: record.updatedAt,
    };
    if (stableStringify(shadow.metadata || {}) !== stableStringify(metadata))
      operations.push({ type: "set", ref: firebaseMetaDocument(context), data: metadata });
    for (let start = 0; start < operations.length; start += 400) {
      const batch = context.writeBatch(context.db);
      operations.slice(start, start + 400).forEach((operation) => {
        if (operation.type === "delete") batch.delete(operation.ref);
        else batch.set(operation.ref, operation.data);
      });
      await batch.commit();
    }
    firebaseShadow = cloneData(record);
    firebaseShadow.metadata = metadata;
  }
  async function legacyJsonBinRecord() {
    const legacy = readLegacySettings();
    if (!legacy.binId || !legacy.key) return null;
    const response = await binRequest("GET", undefined, legacy),
      data = response.record || response;
    return Array.isArray(data.entries) ? data : null;
  }
  async function activateFirebaseUser(user) {
    const context = firebaseContext;
    context.user = user;
    const remote = await readFirebaseRecord(context);
    if (remote.exists) {
      applyData(remote.data);
      alignInitialMonth();
      watchFirebaseRecord(context);
      return;
    }
    let seed = null;
    try { seed = await legacyJsonBinRecord(); } catch {}
    seed ||= readLocal();
    if (!seed && remote.metadataExists) applyData(remote.data);
    if (seed) {
      applyData(seed, { clearLocal: false });
      alignInitialMonth();
      await syncFirebaseRecord(dataRecord());
      persistLocal();
    }
    watchFirebaseRecord(context);
  }
  function setPasswordVisibility(button, visible) {
    const input = document.getElementById(button.dataset.passwordToggle),
      label = visible ? button.dataset.hideLabel : button.dataset.showLabel;
    if (input) input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  function resetPasswordVisibility(scope) {
    scope.querySelectorAll("[data-password-toggle]").forEach((button) => setPasswordVisibility(button, false));
  }
  function authErrorMessage(error) {
    if (error.code === "auth/operation-not-allowed") return "O acesso ainda não está disponível. Tente novamente mais tarde.";
    if (error.code === "permission-denied") return "Não foi possível acessar os dados da clínica. Tente novamente mais tarde.";
    if (["auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found", "auth/wrong-password"].includes(error.code)) return "E-mail ou senha incorretos.";
    if (error.code === "auth/too-many-requests") return "Muitas tentativas. Aguarde um pouco e tente novamente.";
    if (error.code === "auth/requires-recent-login") return "Entre novamente antes de trocar a senha.";
    return "Não foi possível concluir. Verifique sua conexão e tente novamente.";
  }
  async function loginFirebase(event) {
    event.preventDefault();
    const status = $("#login-status"), button = $("#login-submit"),
      email = $("#login-email").value.trim(),
      password = $("#login-password").value;
    status.textContent = "Entrando…";
    status.className = "settings-status";
    button.disabled = true;
    try {
      if (!firebaseContext) throw Error("Firebase não está configurado no Netlify.");
      const credential = await firebaseContext.signInWithEmailAndPassword(firebaseContext.auth, email, password);
      await activateFirebaseUser(credential.user);
      alignInitialMonth();
      persistLocal();
      $("#auth-screen").hidden = true;
      $("#app-shell").hidden = false;
      render();
      $("#login-password").value = "";
      resetPasswordVisibility($("#firebase-login-form"));
    } catch (error) {
      if (firebaseContext) firebaseContext.user = null;
      status.textContent = authErrorMessage(error);
      status.className = "settings-status error";
    } finally {
      button.disabled = false;
    }
  }
  async function changeFirebasePassword(event) {
    event.preventDefault();
    const status = $("#settings-status"),
      currentPassword = $("#current-password").value,
      newPassword = $("#new-password").value,
      confirmPassword = $("#confirm-password").value,
      user = firebaseContext?.user;
    status.className = "settings-status";
    try {
      if (!user?.email) throw Error("Entre na conta antes de trocar a senha.");
      if (newPassword.length < 6) throw Error("A nova senha precisa ter pelo menos 6 caracteres.");
      if (newPassword !== confirmPassword) throw Error("A confirmação da nova senha não corresponde.");
      status.textContent = "Atualizando senha…";
      const credential = firebaseContext.EmailAuthProvider.credential(user.email, currentPassword);
      await firebaseContext.reauthenticateWithCredential(user, credential);
      await firebaseContext.updatePassword(user, newPassword);
      $("#change-password-form").reset();
      resetPasswordVisibility($("#change-password-form"));
      status.textContent = "Senha atualizada com sucesso.";
      status.className = "settings-status success";
    } catch (error) {
      status.textContent = authErrorMessage(error);
      status.className = "settings-status error";
    }
  }
  async function disconnectFirebase() {
    stopFirebaseWatch();
    try {
      if (firebaseContext) await firebaseContext.signOut(firebaseContext.auth);
    } catch {}
    if (firebaseContext) firebaseContext.user = null;
    firebaseShadow = null;
    closeModal("settings-modal");
    $("#app-shell").hidden = true;
    $("#auth-screen").hidden = false;
    $("#login-password").value = "";
    resetPasswordVisibility($("#firebase-login-form"));
    $("#login-status").textContent = "Você saiu da sua conta.";
    $("#login-status").className = "settings-status";
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
