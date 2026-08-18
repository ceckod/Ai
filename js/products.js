// Helfi Plastics — Продукти / артикули
//
// Опаковка: всяка бутилка е ФИКСИРАНО или на тава, или в стек/чувал (не
// и двете). "Бутилки в тавата/чувала" е бройката в самата опаковъчна
// единица. Палето винаги е фиксиран брой тави/чували (напр. течен сапун
// = 13, премиум 415 = 10) — без опция по височина.
//
// Цикъл на машината: "матрица" = броят кухини на формата, т.е. колко
// бутилки излизат на всеки удар (обичайно 1 до 8). Времето за 1 удар
// (сек) е времето между два удара. Пример: матрица 3 бутилки, удар на
// 16 сек → за 32 сек (2 удара) се произвеждат 6 бутилки.
//
// Освен ръчно въведената матрица + удар, скриптът сам се самонадгражда:
// от всеки нов запис (машина, дата, часове, произведени тави/чували)
// пресмята темпа на производство и — щом последните няколко записа
// съвпаднат в рамките на допустимо отклонение — го приема за "потвърден".
// Ако е зададен ръчен цикъл, той се ползва навсякъде за сметките, а
// умният код продължава да смята на заден фон, само за сравнение.

(function () {
  const STORAGE_KEY = "helfi_products_v1";
  const TOLERANCE = 0.05; // 5% допустимо разминаване между последните записи
  const MIN_CONFIRM = 3;  // колко последователни записа трябва да съвпаднат

  const CATEGORIES = {
    household: "Битова химия и козметика",
    water: "Бутилки за вода",
    pharma: "Фармация",
    food: "Хранителна промишленост",
    supplements: "Хранителни добавки",
    other: "Друго",
  };

  // ---- начален каталог (от helfi.net/products/) ----
  // [код, име, категория, пакетаж('tray'|'stack'), тави/чували на пале]
  // Категориите по-долу са ПЪРВОНАЧАЛНА преценка по името на продукта —
  // провери ги и ги коригирай през падащото меню "Категория", ако нещо
  // не съвпада с реалното разпределение на helfi.net/products/.
  const SEED_ARTICLES = [
    ["H415-68", "415мл премиум", "household", "tray", 10],
    ["H100-74", "100мл спирт", "pharma"],
    ["H500-81", "500мл Веджи уош", "food"],
    ["H750-67", "750мл премиум", "household"],
    ["H120-75", "120мл флакон", "pharma"],
    ["H150-70", "150мл флакон", "pharma"],
    ["H200-71", "200мл флакон", "pharma"],
    ["H300-72", "300мл флакон", "pharma"],
    ["H400-69", "400мл течен сапун", "household", "tray", 13],
    ["H050-73", "50мл спирт", "pharma"],
    ["H500-76", "500мл 38мм", "household"],
    ["H750-80", "750мл пръскалка", "household"],
    ["H500-77", "Флакон вода за уста 500мл", "pharma"],
    ["H830-62", "830мл балсам", "household"],
    ["H125-61", "125мл фармация", "pharma"],
    ["H230-60", "230мл флакон", "pharma"],
    ["H330-44", "330мл фреш", "food"],
    ["H030-59", "30мл хотел", "household"],
    ["H300-56", "300мл кетчуп Оберон", "food"],
    ["H1000-55", "1 литър кетчуп", "food"],
    ["H500-54", "500мл кетчуп Оберон", "food"],
    ["H250-53", "250мл сос Денито", "food"],
    ["H1000-57", "1 литър олио HOSSO", "food"],
    ["H900-58", "900мл кетчуп Оберон", "food"],
    ["GAL19D", "19 литра галон с дръжка", "water"],
    ["H2000-47", "2000мл бъклица", "food"],
    ["H1000-46", "1000мл фреш", "food"],
    ["H750-41", "750мл шампоан", "household"],
    ["H700-48", "700мл кулинар", "food"],
    ["H500-45", "500мл фреш", "food"],
    ["H500-45B", "500мл фреш (бял)", "food"],
    ["H500-49", "500мл пръскалка", "household"],
    ["H500-40", "500мл веро", "household"],
    ["H300-43", "300мл фреш", "food"],
    ["H200-50", "200мл алкохол", "pharma"],
    ["GAL19", "19 литрови бутилки (галони)", "water"],
    ["H025-42", "25мл хотел", "household"],
    ["H250-22", "250мл фармация", "pharma"],
    ["H200-21", "200мл фармация", "pharma"],
    ["H150-12", "150мл фармация", "pharma"],
    ["H200-36", "200мл флакон", "pharma"],
    ["H150-31", "150мл флакон", "pharma"],
    ["H100-35", "100мл флакон", "pharma"],
    ["H200-23", "200мл Black Ram", "household"],
    ["H250-13", "250мл сос", "food"],
    ["H200-11", "200мл алкохол", "pharma"],
    ["H1000-26", "1000мл 42мм", "household"],
    ["H1000-29", "1000мл пръскалка", "household"],
    ["H750-25", "750мл пръскалка", "household"],
    ["H1000-20", "1000мл супер гел", "household"],
    ["H900-39", "900мл супер гел", "household"],
    ["H1000-19", "1000мл балсам", "household"],
    ["H900-38", "900мл балсам", "household"],
    ["H1000-18", "1000мл подови настилки", "household"],
    ["H500-37", "500мл веро", "household"],
    ["H900-34", "900мл AVA", "household"],
    ["H625-33", "625мл AVA", "household"],
    ["H425-32", "425мл AVA", "household"],
    ["H1000-28", "1000мл Планет", "household"],
    ["H625-30", "625мл Планет", "household"],
    ["H500-17", "500мл Планет", "household"],
    ["H425-27", "425мл Планет", "household"],
    ["H1000-16", "1000мл душ гел", "household"],
    ["H500-14", "500мл душ гел", "household"],
    ["H300-15", "300мл течен сапун", "household"],
  ];

  // ---------------- state ----------------
  function blankArticle(code, name, category, packagingUnit, unitsPerPallet) {
    return {
      code,
      name,
      category: category || "other",
      packagingUnit: packagingUnit || "tray", // 'tray' | 'stack'
      bottlesPerUnit: unitsPerPallet ? null : null, // бр. бутилки в тавата/чувала
      unitsPerPallet: unitsPerPallet || null,        // фиксиран бр. тави/чували на пале
      useManualCycle: false,
      matrixCavities: null,   // бр. кухини на формата = бутилки на удар (1-8)
      strokeSeconds: null,    // време за 1 удар (сек)
      logs: [],               // {id, machine, date, durationHours, units, ts}
    };
  }

  function emptyState() {
    return { articles: {} };
  }

  function migrateArticle(old) {
    // мигрира по-стар формат (с packagingUnit, но без category/matrixCavides,
    // евентуално с palletMode='height') към текущия модел
    const a = blankArticle(old.code, old.name, old.category);
    if (old.packagingUnit) a.packagingUnit = old.packagingUnit;
    a.bottlesPerUnit = old.bottlesPerUnit ?? old.bottlesPerTray ?? null;

    if (old.unitsPerPallet) {
      a.unitsPerPallet = old.unitsPerPallet;
    } else if (old.palletMode === "height" && old.unitHeightMm && old.palletMaxHeightMm) {
      a.unitsPerPallet = Math.floor(old.palletMaxHeightMm / old.unitHeightMm);
    } else if (old.traysPerStack && old.stacksPerPallet) {
      a.unitsPerPallet = old.traysPerStack * old.stacksPerPallet;
    }

    a.useManualCycle = !!old.useManualCycle;
    if (old.matrixCavities && old.strokeSeconds) {
      a.matrixCavities = old.matrixCavities;
      a.strokeSeconds = old.strokeSeconds;
    } else if (old.manualCycleSec) {
      // старият модел пазеше само сек/бутилка — пренасяме го еквивалентно
      // с матрица 1, за да не се загуби зададената стойност
      a.matrixCavities = 1;
      a.strokeSeconds = old.manualCycleSec;
    }

    a.logs = (old.logs || []).map((e) => ({
      id: e.id,
      machine: e.machine,
      date: e.date,
      durationHours: e.durationHours,
      units: e.units ?? e.trays,
      ts: e.ts,
    }));
    return a;
  }

  function needsMigration(a) {
    return !("matrixCavities" in a) || !("category" in a) || "palletMode" in a;
  }

  function loadState() {
    let state;
    try {
      state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyState();
    } catch (e) {
      state = emptyState();
    }
    if (!state.articles) state.articles = {};
    Object.keys(state.articles).forEach((code) => {
      const a = state.articles[code];
      if (needsMigration(a)) {
        state.articles[code] = migrateArticle(a);
      }
    });
    // добавяме липсващи артикули от каталога, без да пипаме вече въведени
    SEED_ARTICLES.forEach(([code, name, category, packagingUnit, unitsPerPallet]) => {
      if (!state.articles[code]) {
        state.articles[code] = blankArticle(code, name, category, packagingUnit, unitsPerPallet);
      } else if (!state.articles[code].category || state.articles[code].category === "other") {
        // ако вече съществува, но няма категория — прилагаме тази от каталога
        state.articles[code].category = category || "other";
      }
    });
    return state;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    pushToFirestore();
  }

  let fsDocRef = null;
  let state = loadState();
  saveState();
  let selectedCode = null;
  let activeCategory = "all";

  // ---------------- Firestore (по избор — синхронизация между устройства) ----------------
  const syncStatusEl = document.getElementById("syncStatus");

  function setSyncStatus(mode) {
    if (!syncStatusEl) return;
    if (mode === "synced") {
      syncStatusEl.textContent = "☁ синхронизирано";
      syncStatusEl.style.color = "var(--accent)";
      syncStatusEl.style.borderColor = "var(--accent)";
    } else if (mode === "connecting") {
      syncStatusEl.textContent = "☁ свързване…";
      syncStatusEl.style.color = "var(--text-dim)";
    } else if (mode === "error") {
      syncStatusEl.textContent = "⚠ облакът не отговаря — работи се локално";
      syncStatusEl.style.color = "var(--amber)";
      syncStatusEl.style.borderColor = "var(--amber)";
    } else {
      syncStatusEl.textContent = "💾 локално";
      syncStatusEl.style.color = "var(--text-dim)";
      syncStatusEl.style.borderColor = "var(--line)";
    }
  }

  function initFirestore() {
    const cfg = window.HELFI_FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || typeof firebase === "undefined") return;
    try {
      setSyncStatus("connecting");
      firebase.initializeApp(cfg);
      const db = firebase.firestore();
      fsDocRef = db.collection("helfi_state").doc("products");
      fsDocRef.onSnapshot(
        (snap) => {
          setSyncStatus("synced");
          if (!snap.exists) {
            pushToFirestore();
            return;
          }
          const remote = snap.data();
          if (remote && remote.json) {
            state = JSON.parse(remote.json);
            Object.keys(state.articles).forEach((code) => {
              if (needsMigration(state.articles[code])) {
                state.articles[code] = migrateArticle(state.articles[code]);
              }
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            renderList();
            if (selectedCode && state.articles[selectedCode]) renderDetail();
          }
        },
        () => setSyncStatus("error")
      );
    } catch (e) {
      setSyncStatus("error");
    }
  }

  function pushToFirestore() {
    if (!fsDocRef) return;
    fsDocRef.set({ json: JSON.stringify(state), updatedAt: Date.now() }).catch(() => setSyncStatus("error"));
  }

  // ---------------- helpers ----------------
  function fmtNum(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return n.toLocaleString("bg-BG", { maximumFractionDigits: digits ?? 1 });
  }

  function fmtHM(hoursFloat) {
    if (hoursFloat === null || hoursFloat === undefined || isNaN(hoursFloat)) return "—";
    const totalMin = Math.round(hoursFloat * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m} мин`;
    return `${h} ч ${m} мин`;
  }

  function unitLabel(a, plural) {
    const isTray = a.packagingUnit !== "stack";
    if (isTray) return plural ? "тави" : "тава";
    return plural ? "стекове/чували" : "стек/чувал";
  }

  function specComplete(a) {
    return !!(a.bottlesPerUnit && a.unitsPerPallet);
  }

  function computeEntryRate(entry, article) {
    if (!entry.durationHours || !entry.units) return null;
    if (article.bottlesPerUnit) {
      return {
        value: (entry.units * article.bottlesPerUnit) / entry.durationHours,
        unit: "бутилки/час",
      };
    }
    return { value: entry.units / entry.durationHours, unit: `${unitLabel(article, true)}/час` };
  }

  function computeStats(article) {
    const usable = article.logs.filter((e) => e.durationHours > 0 && e.units > 0);
    if (usable.length === 0) return { count: 0 };

    const rates = usable.map((e) => computeEntryRate(e, article).value);
    const unit = article.bottlesPerUnit ? "бутилки/час" : `${unitLabel(article, true)}/час`;

    let confirmed = false;
    let value;
    let spread = null;

    if (rates.length >= MIN_CONFIRM) {
      const last = rates.slice(-MIN_CONFIRM);
      const mean = last.reduce((a, b) => a + b, 0) / last.length;
      const maxDev = Math.max(...last.map((r) => Math.abs(r - mean) / mean));
      spread = maxDev;
      if (maxDev <= TOLERANCE) {
        confirmed = true;
        value = mean;
      }
    }

    if (!confirmed) {
      const sorted = [...rates].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    return { count: rates.length, confirmed, value, unit, spread };
  }

  // ефективен темп = ръчна матрица+удар (ако е включено) ИЛИ умно изчисленото
  function effectiveRate(article, stats) {
    if (article.useManualCycle && article.matrixCavities > 0 && article.strokeSeconds > 0) {
      return {
        value: (article.matrixCavities * 3600) / article.strokeSeconds,
        unit: "бутилки/час",
        source: "manual",
      };
    }
    if (stats.count > 0) {
      return { value: stats.value, unit: stats.unit, source: "smart" };
    }
    return null;
  }

  // ---------------- rendering: category tabs ----------------
  const catTabsEl = document.getElementById("catTabs");

  function renderCatTabs() {
    const codes = Object.keys(state.articles);
    const counts = { all: codes.length };
    Object.keys(CATEGORIES).forEach((k) => (counts[k] = 0));
    codes.forEach((c) => {
      const cat = state.articles[c].category || "other";
      counts[cat] = (counts[cat] || 0) + 1;
    });

    const tabs = [["all", "Всички"]].concat(Object.entries(CATEGORIES));
    catTabsEl.innerHTML = tabs
      .map(([key, label]) => {
        const n = counts[key] || 0;
        if (key !== "all" && n === 0) return "";
        return `<button class="cat-tab${key === activeCategory ? " active" : ""}" data-cat="${key}">${label} (${n})</button>`;
      })
      .join("");
    catTabsEl.querySelectorAll(".cat-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.cat;
        renderList();
      });
    });
  }

  // ---------------- rendering: article list ----------------
  const listEl = document.getElementById("articleList");
  const searchEl = document.getElementById("articleSearch");
  const summaryEl = document.getElementById("articleSummary");

  function renderSummary() {
    const codes = Object.keys(state.articles);
    const done = codes.filter((c) => specComplete(state.articles[c])).length;
    summaryEl.textContent = `${done} от ${codes.length} артикула имат въведена опаковка (тава/стек → пале)`;
  }

  function renderList() {
    renderCatTabs();
    const q = (searchEl.value || "").trim().toLowerCase();
    const codes = Object.keys(state.articles).sort((a, b) => a.localeCompare(b));
    listEl.innerHTML = "";
    codes.forEach((code) => {
      const a = state.articles[code];
      if (activeCategory !== "all" && (a.category || "other") !== activeCategory) return;
      if (q && !(a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))) return;
      const row = document.createElement("div");
      row.className = "article-row" + (code === selectedCode ? " selected" : "");
      row.innerHTML = `
        <span class="ar-dot ${specComplete(a) ? "done" : ""}"></span>
        <span class="ar-code">${a.code}</span>
        <span class="ar-name">${a.name}</span>
      `;
      row.addEventListener("click", () => selectArticle(code));
      listEl.appendChild(row);
    });
    renderSummary();
  }

  searchEl.addEventListener("input", renderList);

  // ---------------- rendering: detail panel ----------------
  const panel = document.getElementById("detailPanel");
  const dCode = document.getElementById("dCode");
  const dName = document.getElementById("dName");

  const specCategory = document.getElementById("specCategory");
  const specUnit = document.getElementById("specUnit");
  const specBottles = document.getElementById("specBottles");
  const specUnitsPerPallet = document.getElementById("specUnitsPerPallet");
  const specDerived = document.getElementById("specDerived");

  const specUseManualCycle = document.getElementById("specUseManualCycle");
  const specMatrixCavities = document.getElementById("specMatrixCavities");
  const specStrokeSeconds = document.getElementById("specStrokeSeconds");
  const cycleDerived = document.getElementById("cycleDerived");

  const statsBadge = document.getElementById("statsBadge");
  const statsBody = document.getElementById("statsBody");
  const historyList = document.getElementById("historyList");
  const logMachine = document.getElementById("logMachine");
  const logDate = document.getElementById("logDate");
  const logDuration = document.getElementById("logDuration");
  const logUnits = document.getElementById("logUnits");

  function updateUnitLabels(a) {
    const sing = unitLabel(a, false);
    const plur = unitLabel(a, true);
    document.querySelectorAll(".unit-lbl-1").forEach((el) => (el.textContent = sing));
    document.querySelectorAll(".unit-lbl-1cap").forEach((el) => (el.textContent = sing.charAt(0).toUpperCase() + sing.slice(1)));
    document.querySelectorAll(".unit-lbl-2").forEach((el) => (el.textContent = plur));
    logUnits.placeholder = plur.charAt(0).toUpperCase() + plur.slice(1);
  }

  function selectArticle(code) {
    selectedCode = code;
    renderList();
    renderDetail();
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderDetail() {
    const a = state.articles[selectedCode];
    if (!a) return;

    dCode.textContent = a.code;
    dName.textContent = a.name;

    updateUnitLabels(a);

    specCategory.value = a.category || "other";
    specUnit.value = a.packagingUnit;
    specBottles.value = a.bottlesPerUnit ?? "";
    specUnitsPerPallet.value = a.unitsPerPallet ?? "";

    specUseManualCycle.checked = !!a.useManualCycle;
    specMatrixCavities.value = a.matrixCavities ?? "";
    specStrokeSeconds.value = a.strokeSeconds ?? "";
    specMatrixCavities.disabled = !a.useManualCycle;
    specStrokeSeconds.disabled = !a.useManualCycle;

    if (specComplete(a)) {
      const bottlesPerPallet = a.bottlesPerUnit * a.unitsPerPallet;
      specDerived.textContent = `= ${fmtNum(a.unitsPerPallet, 0)} ${unitLabel(a, true)} на пале · ${fmtNum(bottlesPerPallet, 0)} бутилки на пале`;
    } else {
      specDerived.textContent = `Въведи бутилки в ${unitLabel(a, false)} и ${unitLabel(a, true)} на пале, за да видиш пълното пале.`;
    }

    if (a.matrixCavities > 0 && a.strokeSeconds > 0) {
      const secPerBottle = a.strokeSeconds / a.matrixCavities;
      const bottlesPerHour = (a.matrixCavities * 3600) / a.strokeSeconds;
      cycleDerived.textContent = `= ${fmtNum(secPerBottle, 2)} сек/бутилка · ${fmtNum(bottlesPerHour, 0)} бутилки/час`;
    } else {
      cycleDerived.textContent = "";
    }

    // stats
    const stats = computeStats(a);
    const eff = effectiveRate(a, stats);

    if (!eff) {
      statsBadge.textContent = "";
      statsBody.innerHTML = `<p class="hint">Все още няма записи от производство за този артикул.</p>`;
    } else {
      if (eff.source === "manual") {
        statsBadge.innerHTML = `<span class="badge confirmed">ръчно зададен (матрица × удар)</span>`;
      } else if (stats.confirmed) {
        statsBadge.innerHTML = `<span class="badge confirmed">потвърден · последните ${MIN_CONFIRM} съвпадат</span>`;
      } else {
        const need = MIN_CONFIRM - Math.min(stats.count, MIN_CONFIRM);
        const spreadTxt = stats.spread !== null ? ` (разлика ${fmtNum(stats.spread * 100, 0)}%)` : "";
        statsBadge.innerHTML = `<span class="badge calibrating">калибриране · ${stats.count} запис${stats.count === 1 ? "" : "а"}${spreadTxt}</span>`;
      }

      const rows = [];
      rows.push(`<div class="stat-row"><span>Темп на производство</span><b>${fmtNum(eff.value, 0)} ${eff.unit}</b></div>`);

      if (a.bottlesPerUnit) {
        const cycleSec = 3600 / eff.value;
        rows.push(`<div class="stat-row"><span>Цикъл на бутилка</span><b>${fmtNum(cycleSec, 2)} сек</b></div>`);
        const timePerUnitH = a.bottlesPerUnit / eff.value;
        rows.push(`<div class="stat-row"><span>Време за 1 ${unitLabel(a, false)}</span><b>${fmtHM(timePerUnitH)}</b></div>`);
        if (a.unitsPerPallet) {
          const timePerPalletH = (a.bottlesPerUnit * a.unitsPerPallet) / eff.value;
          rows.push(`<div class="stat-row highlight"><span>Време за 1 пале</span><b>${fmtHM(timePerPalletH)}</b></div>`);
        }
      } else {
        rows.push(`<div class="stat-row"><span>Време за 1 ${unitLabel(a, false)}</span><b>${fmtHM(1 / eff.value)}</b></div>`);
        if (a.unitsPerPallet) {
          rows.push(`<div class="stat-row highlight"><span>Време за 1 пале</span><b>${fmtHM(a.unitsPerPallet / eff.value)}</b></div>`);
        }
        rows.push(`<p class="hint">Въведи бутилки в ${unitLabel(a, false)}, за да видиш и цикъла в секунди на бутилка.</p>`);
      }

      if (eff.source === "manual" && stats.count > 0) {
        rows.push(`<p class="hint">Умният код изчислява (за сравнение): ${fmtNum(stats.value, 0)} ${stats.unit}${stats.confirmed ? " · потвърдено" : " · калибрира се"}.</p>`);
      }

      statsBody.innerHTML = rows.join("");
    }

    // history
    if (a.logs.length === 0) {
      historyList.innerHTML = `<p class="hint">Няма въведени записи.</p>`;
    } else {
      const sorted = [...a.logs].sort((x, y) => (y.date || "").localeCompare(x.date || "") || y.ts - x.ts);
      historyList.innerHTML = sorted
        .map((e) => {
          const r = computeEntryRate(e, a);
          const rateTxt = r ? `${fmtNum(r.value, 0)} ${r.unit}` : "—";
          return `
            <div class="history-row" data-id="${e.id}">
              <div>
                <b>${e.date || "—"}</b> · машина ${e.machine || "—"}<br/>
                <span class="hint">${fmtNum(e.durationHours, 1)} ч · ${fmtNum(e.units, 0)} ${unitLabel(a, true)} → ${rateTxt}</span>
              </div>
              <button class="del-log-btn" data-id="${e.id}" title="Изтрий записа">✕</button>
            </div>`;
        })
        .join("");
      historyList.querySelectorAll(".del-log-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          a.logs = a.logs.filter((e) => e.id !== btn.dataset.id);
          saveState();
          renderDetail();
          renderList();
        });
      });
    }
  }

  function saveSpec() {
    const a = state.articles[selectedCode];
    if (!a) return;
    a.category = specCategory.value;
    a.packagingUnit = specUnit.value === "stack" ? "stack" : "tray";
    a.bottlesPerUnit = specBottles.value ? Number(specBottles.value) : null;
    a.unitsPerPallet = specUnitsPerPallet.value ? Number(specUnitsPerPallet.value) : null;
    a.useManualCycle = !!specUseManualCycle.checked;
    a.matrixCavities = specMatrixCavities.value ? Number(specMatrixCavities.value) : null;
    a.strokeSeconds = specStrokeSeconds.value ? Number(specStrokeSeconds.value) : null;
    saveState();
    renderDetail();
    renderList();
  }

  [specCategory, specUnit, specBottles, specUnitsPerPallet, specUseManualCycle, specMatrixCavities, specStrokeSeconds].forEach((el) => {
    el.addEventListener("change", saveSpec);
  });

  specUseManualCycle.addEventListener("change", () => {
    specMatrixCavities.disabled = !specUseManualCycle.checked;
    specStrokeSeconds.disabled = !specUseManualCycle.checked;
  });

  document.getElementById("addLogBtn").addEventListener("click", () => {
    const a = state.articles[selectedCode];
    if (!a) return;
    const duration = Number(logDuration.value);
    const units = Number(logUnits.value);
    if (!duration || !units) {
      logDuration.focus();
      return;
    }
    a.logs.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      machine: logMachine.value.trim(),
      date: logDate.value || new Date().toISOString().slice(0, 10),
      durationHours: duration,
      units,
      ts: Date.now(),
    });
    saveState();
    if (logMachine.value.trim()) localStorage.setItem("helfi_last_machine", logMachine.value.trim());
    logDuration.value = "";
    logUnits.value = "";
    renderDetail();
    renderList();
  });

  document.getElementById("deleteArticleBtn").addEventListener("click", () => {
    if (!selectedCode) return;
    if (!confirm(`Да изтрия артикул ${selectedCode}? Всички записи ще се загубят.`)) return;
    delete state.articles[selectedCode];
    saveState();
    selectedCode = null;
    panel.hidden = true;
    renderList();
  });

  // ---------------- add new article ----------------
  document.getElementById("addArticleBtn").addEventListener("click", () => {
    const codeEl = document.getElementById("newCode");
    const nameEl = document.getElementById("newName");
    const code = codeEl.value.trim();
    const name = nameEl.value.trim();
    if (!code || !name) return;
    if (state.articles[code]) {
      alert("Артикул с такъв код вече съществува.");
      return;
    }
    state.articles[code] = blankArticle(code, name);
    saveState();
    codeEl.value = "";
    nameEl.value = "";
    renderList();
    selectArticle(code);
  });

  // ---------------- export / import ----------------
  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `helfi-produkti-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importFile").addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported.articles) throw new Error("невалиден файл");
        if (!confirm("Това ще замени текущите данни в браузъра с тези от файла. Продължи?")) return;
        state = imported;
        Object.keys(state.articles).forEach((code) => {
          if (needsMigration(state.articles[code])) {
            state.articles[code] = migrateArticle(state.articles[code]);
          }
        });
        saveState();
        selectedCode = null;
        panel.hidden = true;
        renderList();
      } catch (e) {
        alert("Файлът не е валиден JSON износ от тази страница.");
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  });

  // ---------------- init ----------------
  logDate.value = new Date().toISOString().slice(0, 10);
  const lastMachine = localStorage.getItem("helfi_last_machine");
  if (lastMachine) logMachine.value = lastMachine;

  renderList();
  initFirestore();
})();
