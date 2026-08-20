// Helfi Plastics — Дневен диспечер
// Машина -> продукт за текущата/избраната смяна, изчислено с ефективния
// (замразен/ръчен/умен) цикъл на артикула от Продукти.
//
// Това е САМО "какво ако" симулатор: избираш смяна, машини и артикул,
// виждаш веднага какво би се произвело — но нищо от избора НЕ се запазва
// никъде (нито локално, нито централно). Затвориш ли/презаредиш ли
// страницата, стартираш начисто. Само артикулите (каталогът) идват от
// централните, публикувани от администратора данни.
(function () {
  const core = window.HelfiCore;
  let articles = {};
  let articleCodes = [];
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

  // ако избраната смяна е ТОЧНО текущата (реално сега тече) -> смятаме само
  // оставащите секунди до края ѝ, а не целия ѝ 12-часов период.
  // За минала/бъдеща смяна (друга дата) или ръчно зададени часове -> пълната
  // продължителност, защото "оставащо време" няма смисъл там.
  function secondsToUse() {
    if (shiftTypeEl.value === "custom") return shiftHours() * 3600;
    const now = new Date();
    const liveInfo = core.getShiftInfo(now);
    if (liveInfo.shiftKey === shiftKey()) return liveInfo.secondsRemaining;
    return shiftHours() * 3600;
  }

  function shiftLabel() {
    const d = shiftDateEl.value;
    let base;
    if (shiftTypeEl.value === "day") base = `Дневна смяна · ${d} 07:00–19:00`;
    else if (shiftTypeEl.value === "night") {
      const start = new Date(d + "T19:00:00");
      const end = new Date(start.getTime() + 12 * 3600 * 1000);
      base = `Нощна смяна · ${d} 19:00 → ${pad(end.getDate())}.${pad(end.getMonth() + 1)} 07:00`;
    } else base = `Ръчно зададена смяна · ${d} · ${fmtNum(shiftHours(), 1)} ч`;

    if (shiftTypeEl.value !== "custom") {
      const now = new Date();
      const liveInfo = core.getShiftInfo(now);
      if (liveInfo.shiftKey === shiftKey()) {
        base += ` · остават ${core.fmtHM(liveInfo.secondsRemaining)} до края (${liveInfo.endLabel})`;
      }
    }
    return base;
  }

  // смяната (дата/тип) влияе само на продължителността в часове, използвана
  // за сметките — списъкът с машини нарочно НЕ се презарежда/пази по смяна,
  // просто продължава като временна симулация в тази сесия
  function loadForShift() {
    currentShiftKey = shiftKey();
    if (machines.length === 0) machines = [{ id: newId(), name: "Машина 1", articleCode: "" }];
    renderMachines();
    computeAll();
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
      });
    });
    machineListEl.querySelectorAll("[data-field='name']").forEach((inp) => {
      inp.addEventListener("input", () => {
        const m = machines.find((x) => x.id === inp.dataset.id);
        m.name = inp.value;
        computeAll();
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
        },
      });
    });
  }

  function computeAll() {
    shiftInfoEl.textContent = shiftLabel();
    const seconds = secondsToUse();
    if (!seconds) {
      resultsEl.innerHTML = `<p class="hint">Няма оставащо време за тази смяна.</p>`;
      return;
    }

    // общо палета = сбор от ЦЕЛИТЕ палета на всяка машина; оставащите (непълни
    // палети) тави не се сумират в палета между различни артикули, защото
    // всеки може да има различен капацитет тави/пале — те си остават видими
    // в "Общо тави" по-долу и на реда на всяка машина ("+ X тави")
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

      const trayWord = core.unitLabelFor(a, true);
      const parts = [];
      if (prod.hits !== null) parts.push(`${fmtNum(prod.hits)} удара`);
      parts.push(`${fmtNum(prod.bottles)} бутилки`);
      if (prod.trays !== null) parts.push(`${fmtNum(prod.trays)} ${trayWord}`);
      if (prod.pallets !== null) parts.push(core.fmtPalletsTrays(prod.pallets, prod.extraTrays, trayWord));

      const sourceTxt = { manual: "ръчен цикъл", frozen: "замразен цикъл", baseline: "зададен цикъл", smart: "изчислен темп" }[prod.source] || "";
      rows.push(
        `<div class="stat-row"><span>${label} · ${a.name}</span><b>${parts.join(" · ")}</b></div>
         <p class="hint" style="margin:-4px 0 6px">${sourceTxt}</p>`
      );
    });

    rows.push(`<div class="stat-row highlight"><span>Общо произведени бутилки</span><b>${fmtNum(totals.bottles)}</b></div>`);
    if (anyHits) rows.push(`<div class="stat-row highlight"><span>Общо удари</span><b>${fmtNum(totals.hits)}</b></div>`);
    if (anyTrays) rows.push(`<div class="stat-row highlight"><span>Общо тави</span><b>${fmtNum(totals.trays)}</b></div>`);
    if (anyPallets) rows.push(`<div class="stat-row highlight"><span>Общо цели палета</span><b>${fmtNum(totals.pallets)}</b></div>`);

    resultsEl.innerHTML = rows.join("");
  }

  addMachineBtn.addEventListener("click", () => {
    machines.push({ id: newId(), name: `Машина ${machines.length + 1}`, articleCode: "" });
    renderMachines();
    computeAll();
  });

  shiftDateEl.addEventListener("change", loadForShift);
  shiftTypeEl.addEventListener("change", () => {
    customHoursWrap.hidden = shiftTypeEl.value !== "custom";
    loadForShift();
  });
  customHoursEl.addEventListener("input", computeAll);

  function refreshArticles() {
    articles = core.loadArticles();
    articleCodes = Object.keys(articles).sort((a, b) => a.localeCompare(b));
    renderMachines();
    computeAll();
  }
  window.addEventListener("focus", refreshArticles);

  // ---------------- init ----------------
  initDefaults();
  customHoursWrap.hidden = shiftTypeEl.value !== "custom";
  loadForShift();

  // докато е отворена текущата (реално течаща) смяна, опресняваме всяка
  // минута, за да "оставащото време" и сметките вървят напред, а не да
  // замръзват към момента на зареждане на страницата
  setInterval(() => {
    if (shiftTypeEl.value !== "custom" && core.getShiftInfo(new Date()).shiftKey === shiftKey()) {
      computeAll();
    }
  }, 60 * 1000);

  // артикулите (каталогът) идват асинхронно от централните публикувани
  // данни — щом пристигнат, опресняваме падащите менюта
  if (window.HelfiData) {
    window.HelfiData.fetchCentral().then(refreshArticles);
  }
})();
