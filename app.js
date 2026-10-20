(() => {
  "use strict";
  const STORAGE_KEY = "meuDinheiro.v1";
  const SETTINGS_KEY = "meuDinheiro.jsonbin";
  const EXPENSE_CATEGORIES = [
    "Faculdade",
    "Serviços",
    "Internet",
    "Moto",
    "Moto/Bike",
    "Moto/Carro",
    "Compras",
    "Lazer",
    "Comida",
    "Remédio",
    "Remedio",
    "Gasolina",
    "Saúde",
    "Ferias",
    "Férias",
    "Cartão",
    "Psicóloga",
    "Piscicologa",
    "Outros",
  ];
  const INCOME_CATEGORIES = [
    "Salário",
    "Horas Extras",
    "Investimentos",
    "Rendimentos",
    "Udemy",
    "Outros",
  ];
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
  const state = {
    entries: [],
    categories: [...DEFAULT_CATEGORIES],
    activeMonth: localMonth(),
    filters: { type: "all", month: "" },
    showAll: false,
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
      state.categories = mergeCategories(local.categories || []);
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
  function generateRecurringEntries() {
    const today = new Date(), currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    let changed = false;
    state.entries.filter((entry) => entry.recurring && entry.date).forEach((source) => {
      const rootId = source.recurrenceId || source.id, start = source.date.slice(0, 7), lastMonth = source.recurringUntil?.slice(0, 7) || currentMonth;
      const existing = new Set(state.entries.filter((item) => item.recurrenceId === rootId).map((item) => item.recurrenceMonth || item.date?.slice(0, 7)));
      let [year, month] = start.split("-").map(Number); month++;
      while (`${year}-${String(month).padStart(2, "0")}` <= currentMonth && `${year}-${String(month).padStart(2, "0")}` <= lastMonth) {
        const monthKey = `${year}-${String(month).padStart(2, "0")}`;
        if (!existing.has(monthKey)) { state.entries.push({ ...source, id: uid(), date: `${monthKey}-01`, recurring: false, recurrenceId: rootId, recurrenceMonth: monthKey }); existing.add(monthKey); changed = true; }
        if (++month > 12) { month = 1; year++; }
      }
    });
    return changed;
  }
  async function saveRecurringEntries() {
    persistLocal();
    if (state.settings.binId && state.settings.key) {
      try { await binRequest("PUT", { entries: state.entries, categories: state.categories, updatedAt: new Date().toISOString() }); }
      catch { updateSyncLabel("Salvo neste dispositivo"); }
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
      state.categories = mergeCategories(data.categories || []);
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
          categories: state.categories,
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
          entries: state.entries,
          categories: state.categories,
          updatedAt: new Date().toISOString(),
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
    return state.entries.filter((e) => e.date?.slice(0, 7) === ym);
  }
  function colorFor(category) {
    let hash = 0;
    for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
  }
  function render() {
    renderPeriod();
    renderSummary();
    renderCharts();
    renderTransactions();
    renderCategories();
  }
  function renderPeriod() {
    $("#current-period").textContent = monthLabel(state.activeMonth);
  }
  function renderSummary() {
    const items = monthEntries(state.activeMonth),
      income = items
        .filter((e) => e.type === "income")
        .reduce((s, e) => s + e.amount, 0),
      expense = items
        .filter((e) => e.type === "expense")
        .reduce((s, e) => s + e.amount, 0);
    $("#income-value").textContent = money(income);
    $("#expense-value").textContent = money(expense);
    $("#balance-value").textContent = money(income - expense);
    $("#income-count").textContent =
      `${items.filter((e) => e.type === "income").length} lançamentos`;
    $("#expense-count").textContent =
      `${items.filter((e) => e.type === "expense").length} lançamentos`;
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
          .filter((e) => e.type === "expense")
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
        (e) => e.type === "expense",
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
        return `<tr class="transaction-row"><td><div class="description-cell"><span class="row-icon" style="background:${color}20;color:${color}">${e.type === "income" ? "↙" : "↗"}</span>${escapeHtml(e.description)}</div></td><td><span class="category-tag" style="background:${color}17;color:${color}"><i style="background:${color}"></i>${escapeHtml(e.category)}</span></td><td>${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${e.date}T12:00:00`)).replace(".", "")}</td><td><span class="type-tag ${e.type}">${e.type === "income" ? "Entrada" : "Despesa"}</span></td><td class="amount-cell ${e.type === "expense" ? "negative" : ""}">${e.type === "expense" ? "−" : "+"} ${money(e.amount)}</td><td><div class="row-actions"><button data-edit="${escapeHtml(e.id)}" aria-label="Editar">✎</button><button data-delete="${escapeHtml(e.id)}" aria-label="Excluir">×</button></div></td></tr>`;
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
      .map((e) => e.category);
    const available = [...new Set([...defaults, ...used])];
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
  function bind() {
    bindSectionNavigation();
    $("#new-entry").addEventListener("click", prepareNew);
    $("#privacy-toggle").addEventListener("click", () => {
      const hidden = document.body.classList.toggle("values-hidden"), button = $("#privacy-toggle");
      button.setAttribute("aria-pressed", String(hidden));
      button.setAttribute("aria-label", hidden ? "Mostrar valores" : "Esconder valores");
      button.title = hidden ? "Mostrar valores" : "Esconder valores";
      button.querySelector("span").textContent = hidden ? "Mostrar valores" : "Esconder valores";
    });
    $("#entry-recurring").addEventListener("change", (event) => {
      $("#recurring-end-field").hidden = !event.target.checked;
      if (event.target.checked) $("#entry-date").value = `${$("#entry-date").value.slice(0, 7)}-01`;
    });
    $("#empty-add").addEventListener("click", prepareNew);
    $("#prev-month").addEventListener("click", () => shiftMonth(-1));
    $("#next-month").addEventListener("click", () => shiftMonth(1));
    $("#chart-range").addEventListener("change", renderCharts);
    document.querySelectorAll('input[name="type"]').forEach((input) =>
      input.addEventListener("change", () => {
        const current = $("#entry-category").value;
        renderCategories(current);
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
      const entry = {
        id: id || uid(),
        type: document.querySelector('input[name="type"]:checked').value,
        description: $("#entry-description").value.trim(),
        amount: Number($("#entry-amount").value),
        date: $("#entry-date").value,
        category,
        note: $("#entry-note").value.trim(),
        recurring: $("#entry-recurring").checked,
        recurringUntil: $("#entry-recurring").checked ? $("#entry-recurring-until").value : "",
      };
      if (entry.recurring && entry.recurringUntil && entry.recurringUntil < entry.date) { toast("A data final deve ser igual ou posterior à data do lançamento."); return; }
      if (entry.recurring) entry.recurrenceId = id || entry.id;
      else if (id) {
        const previous = state.entries.find((item) => item.id === id);
        if (previous?.recurrenceId) entry.recurrenceId = previous.recurrenceId;
        if (previous?.recurrenceMonth) entry.recurrenceMonth = previous.recurrenceMonth;
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
    $("#open-settings-mobile").addEventListener("click", () => $("#open-settings").click());
    $("#save-settings").addEventListener("click", connectBin);
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
  function bindSectionNavigation() {
    const overview = $('.side-nav a[href="#inicio"]'),
      movements = $('.side-nav a[href="#movimentacoes"]'),
      section = $("#movimentacoes");
    if (!overview || !movements || !section) return;
    const setActive = (isMovements) => {
      overview.classList.toggle("active", !isMovements);
      movements.classList.toggle("active", isMovements);
    };
    let queued = false;
    const update = () => {
      queued = false;
      const rect = section.getBoundingClientRect();
      setActive(rect.top < window.innerHeight * 0.58 && rect.bottom > 145);
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
    overview.addEventListener("click", () => setActive(false));
    movements.addEventListener("click", () => setActive(true));
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
          await binRequest("PUT", {
            entries: state.entries,
            categories: state.categories,
            updatedAt: new Date().toISOString(),
          });
          remote = null;
        } else throw error;
      }
      if (remote) {
        const remoteData = remote.record || remote;
        if (!readLocal() && Array.isArray(remoteData.entries))
          applyData(remoteData);
        else
          await binRequest("PUT", {
            entries: state.entries,
            categories: state.categories,
            updatedAt: new Date().toISOString(),
          });
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
      toast("Não foi possível ler este CSV.");
    } finally {
      event.target.value = "";
    }
  }
  boot();
})();
