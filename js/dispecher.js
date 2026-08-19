// Helfi Plastics — Дневен диспечер
// Машина -> продукт за текущата/избраната смяна, изчислено с ефективния
// (замразен/ръчен/умен) цикъл на артикула от Продукти.
(function () {
  const core = window.HelfiCore;
  let articles = core.loadArticles();
  let articleCodes = Object.keys(articles).sort((a, b) => a.localeCompare(b));
  const fmtNum = core.fmtNum;

  const shiftDateEl = document.getElementById("shiftDate");
  const shiftTypeEl = document.getElementById("shiftType");
  const customHoursWrap = document.getElementById("customHoursWrap");
  const customHoursEl = document.getElementById("customHours");
  const shiftInfoEl = document.getElementById("shiftInfo");
  const machineListEl = document.getElementById("machineList");
  const machineCountEl = document.getElementById("machineCount");
  const addMachineBtn = document.getElementById("addMachineBtn");
  const resultsEl = document.getElementById("results");

  let machines = []; // {id, name, articleCode}
  let currentShiftKey = null;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function initDefaults() {
    const info = core.getShiftInfo(new Date());
    shiftDateEl.value = info.dateKey;
    shiftTypeEl.value = info.type; // 'day' | 'night'
  }

  function shiftHours() {
    if (shiftTypeEl.value === "custom") return Number(customHoursEl.value) || 0;
    return core.SHIFT_LEN_HOURS;
  }

  function shiftKey() {
    return `${shiftDateEl.value}-${shiftTypeEl.value}`;
  }

  function shiftLabel() {
    const d = shiftDateEl.value;
    if (shiftTypeEl.value === "day") return `Дневна смяна · ${d} 07:00–19:00`;
    if (shiftTypeEl.value === "night") {
      const start = new Date(d + "T19:00:00");
      const end = new Date(start.getTime() + 12 * 3600 * 1000);
      return `Нощна смяна · ${d} 19:00 → ${pad(end.getDate())}.${pad(end.getMonth() + 1)} 07:00`;
    }
    return `Ръчно зададена смяна · ${d} · ${fmtNum(shiftHours(), 1)} ч`;
  }

  function loadForShift() {
    currentShiftKey = shiftKey();
    const saved = core.getDispatchForShift(currentShiftKey);
    machines = saved.machines && saved.machines.length ? saved.machines : [{ id: newId(), name: "Машина 1", articleCode: "" }];
    if (shiftTypeEl.value === "custom" && saved.hours) customHoursEl.value = saved.hours;
    renderMachines();
    computeAll();
  }

  function persist() {
    core.saveDispatchForShift(currentShiftKey, { hours: shiftHours(), machines });
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function renderMachines() {
    machineCountEl.textContent = `${machines.length} машина${machines.length === 1 ? "" : "и"}`;
    machineListEl.innerHTML = machines
      .map(
        (m, idx) => `
      <div class="machine-row" data-id="${m.id}">
        <div class="machine-row-head">
          <input type="text" data-field="name" data-id="${m.id}" value="${m.name || ""}" placeholder="Машина ${idx + 1}" />
          ${machines.length > 1 ? `<button class="machine-remove" data-remove="${m.id}" title="Премахни">✕</button>` : ""}
        </div>
        <span data-article-mount="${m.id}"></span>
      </div>`
      )
      .join("");

    machineListEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        machines = machines.filter((m) => m.id !== btn.dataset.remove);
        renderMachines();
        computeAll();
        persist();
      });
    });
    machineListEl.querySelectorAll("[data-field='name']").forEach((inp) => {
      inp.addEventListener("input", () => {
        const m = machines.find((x) => x.id === inp.dataset.id);
        m.name = inp.value;
        computeAll();
        persist();
      });
    });
    machineListEl.querySelectorAll("[data-article-mount]").forEach((mountEl) => {
      const machineId = mountEl.dataset.articleMount;
      const m = machines.find((x) => x.id === machineId);
      if (!m) return;
      core.mountArticleCombo(mountEl, {
        articles,
        value: m.articleCode,
        placeholder: "Пиши код или име (напр. 415 или премиум)…",
        onSelect: (code) => {
          m.articleCode = code || "";
          computeAll();
          persist();
        },
      });
    });
  }

  function computeAll() {
    shiftInfoEl.textContent = shiftLabel();
    const seconds = shiftHours() * 3600;
    if (!seconds) {
      resultsEl.innerHTML = `<p class="hint">Задай продължителност на смяната.</p>`;
      return;
    }

    let totals = { hits: 0, bottles: 0, trays: 0, pallets: 0 };
    let anyHits = false, anyTrays = false, anyPallets = false;
    const rows = [];

    machines.forEach((m, idx) => {
      const a = articles[m.articleCode];
      const label = m.name || `Машина ${idx + 1}`;
      if (!a) {
        rows.push(`<div class="stat-row"><span>${label}</span><b>— няма зададен продукт</b></div>`);
        return;
      }
      const prod = core.produceForSeconds(a, seconds);
      if (!prod) {
        rows.push(`<div class="stat-row"><span>${label} · ${a.name}</span><b>— няма зададен цикъл за артикула</b></div>`);
        return;
      }
      totals.bottles += prod.bottles;
      if (prod.hits !== null) { totals.hits += prod.hits; anyHits = true; }
      if (prod.trays !== null) { totals.trays += prod.trays; anyTrays = true; }
      if (prod.pallets !== null) { totals.pallets += prod.pallets; anyPallets = true; }

      const parts = [];
      if (prod.hits !== null) parts.push(`${fmtNum(prod.hits)} удара`);
      parts.push(`${fmtNum(prod.bottles)} бутилки`);
      if (prod.trays !== null) parts.push(`${fmtNum(prod.trays)} тави`);
      if (prod.pallets !== null) parts.push(`${fmtNum(prod.pallets)} палета`);

      const sourceTxt = { manual: "ръчен цикъл", frozen: "замразен цикъл", baseline: "зададен цикъл", smart: "изчислен темп" }[prod.source] || "";
      rows.push(
        `<div class="stat-row"><span>${label} · ${a.name}</span><b>${parts.join(" · ")}</b></div>
         <p class="hint" style="margin:-4px 0 6px">${sourceTxt}</p>`
      );
    });

    rows.push(`<div class="stat-row highlight"><span>Общо произведени бутилки</span><b>${fmtNum(totals.bottles)}</b></div>`);
    if (anyHits) rows.push(`<div class="stat-row highlight"><span>Общо удари</span><b>${fmtNum(totals.hits)}</b></div>`);
    if (anyTrays) rows.push(`<div class="stat-row highlight"><span>Общо тави</span><b>${fmtNum(totals.trays)}</b></div>`);
    if (anyPallets) rows.push(`<div class="stat-row highlight"><span>Общо палета</span><b>${fmtNum(totals.pallets)}</b></div>`);

    resultsEl.innerHTML = rows.join("");
  }

  addMachineBtn.addEventListener("click", () => {
    machines.push({ id: newId(), name: `Машина ${machines.length + 1}`, articleCode: "" });
    renderMachines();
    computeAll();
    persist();
  });

  shiftDateEl.addEventListener("change", loadForShift);
  shiftTypeEl.addEventListener("change", () => {
    customHoursWrap.hidden = shiftTypeEl.value !== "custom";
    loadForShift();
  });
  customHoursEl.addEventListener("input", () => {
    computeAll();
    persist();
  });

  window.addEventListener("storage", (e) => {
    if (e.key === core.STORAGE_KEY) {
      articles = core.loadArticles();
      articleCodes = Object.keys(articles).sort((a, b) => a.localeCompare(b));
      renderMachines();
      computeAll();
    }
  });
  window.addEventListener("focus", () => {
    articles = core.loadArticles();
    articleCodes = Object.keys(articles).sort((a, b) => a.localeCompare(b));
    renderMachines();
    computeAll();
  });

  // ---------------- init ----------------
  initDefaults();
  customHoursWrap.hidden = shiftTypeEl.value !== "custom";
  loadForShift();
})();
