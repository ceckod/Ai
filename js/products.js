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
  const DEFAULT_FREEZE_THRESHOLD = 30; // подразб. брой засичания на цикъла за автоматично замразяване

  const CATEGORIES = {
    household: "Битова химия и козметика",
    water: "Бутилки за вода",
    pharma: "Фармация",
    food: "Хранителна промишленост",
    supplements: "Хранителни добавки",
    other: "Друго",
  };


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

      // ---- самообучение и замразяване на цикъла (реални засичания в сек.) ----
      cycleSamples: [],           // [{id, seconds, ts}]
      freezeThreshold: DEFAULT_FREEZE_THRESHOLD,
      frozen: false,
      frozenCycleSeconds: null,
      frozenAt: null,
      unlockBaseline: 0,          // бр. засичания в момента на последното отключване
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

    a.cycleSamples = Array.isArray(old.cycleSamples) ? old.cycleSamples : [];
    a.freezeThreshold = old.freezeThreshold || DEFAULT_FREEZE_THRESHOLD;
    a.frozen = !!old.frozen;
    a.frozenCycleSeconds = old.frozenCycleSeconds ?? null;
    a.frozenAt = old.frozenAt ?? null;
    a.unlockBaseline = old.unlockBaseline || 0;
    return a;
  }

  function needsMigration(a) {
    return !("matrixCavities" in a) || !("category" in a) || "palletMode" in a || !("cycleSamples" in a);
  }

  // ---------------- самообучение / замразяване на цикъла ----------------
  function freezeFromSamples(a) {
    const n = Math.max(1, a.freezeThreshold || DEFAULT_FREEZE_THRESHOLD);
    const last = a.cycleSamples.slice(-n);
    if (last.length === 0) return false;
    const avg = last.reduce((sum, s) => sum + s.seconds, 0) / last.length;
    a.frozenCycleSeconds = avg;
    a.frozen = true;
    a.frozenAt = Date.now();
    return true;
  }

  function maybeAutoFreeze(a) {
    if (a.frozen) return;
    const threshold = a.freezeThreshold || DEFAULT_FREEZE_THRESHOLD;
    if (a.cycleSamples.length - (a.unlockBaseline || 0) >= threshold) {
      freezeFromSamples(a);
    }
  }

  // ---------------- данни: централни (публикувани) vs. чернова на админа ----------------
  // Тази страница вече НЕ пази данните директно в localStorage под свой
  // ключ. Единственият източник е js/data-store.js (HelfiData):
  //   - обикновен посетител: чете публикуваните данни, READ ONLY, нищо
  //     от тази страница не се записва никъде;
  //   - отключен админ (виж скрития жест върху заглавието): работи върху
  //     локална чернова на своето устройство и я публикува ръчно (изтегля
  //     нов data/products-data.json и го качва в проекта — виж README).
  const dbg = window.__dbg || function () {};
  dbg("products.js стартира изпълнение");
  const data = window.HelfiData;
  dbg("window.HelfiData е " + (data ? "НАЛИЧЕН" : "❌ ЛИПСВА"));
  let isAdmin = !!(data && data.isAdmin());
  dbg("isAdmin при зареждане = " + isAdmin);

  function normalizeArticles(articles) {
    const out = {};
    Object.keys(articles || {}).forEach((code) => {
      out[code] = needsMigration(articles[code]) ? migrateArticle(articles[code]) : articles[code];
    });
    return out;
  }

  function buildState() {
    const source = data ? data.currentArticles() : {};
    return { articles: normalizeArticles(source) };
  }

  function saveState() {
    dbg("saveState() извикана. isAdmin=" + isAdmin + " data=" + !!data);
    if (!isAdmin || !data) {
      dbg("❌ saveState() прекратена рано (не е админ или липсва data) — НИЩО не се записва");
      return;
    }
    data.saveDraft(state.articles);
    dbg("локалната чернова е записана, викам pushToFirestore()");
    pushToFirestore();
  }

  let state = buildState();
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
    dbg("initFirestore() (REST режим) стартирана");
    const cfg = window.HELFI_FIREBASE_CONFIG;
    dbg("HELFI_FIREBASE_CONFIG = " + (cfg ? "наличен, projectId=" + cfg.projectId : "❌ ЛИПСВА"));
    if (!cfg || !cfg.apiKey) {
      dbg("❌ initFirestore() прекратена рано — config липсва.");
      return;
    }
    setSyncStatus("connecting");
    // четенето/поллинга се извършва централно в data-store.js (REST, на всеки
    // 5 сек) — тук просто се абонираме за известия и опресняваме изгледа
    if (data && data.onCentralUpdate) {
      data.onCentralUpdate(() => {
        dbg("📡 onCentralUpdate (REST poll) — опресняване на списъка");
        setSyncStatus("synced");
        const fresh = data.currentArticles();
        state = { articles: normalizeArticles(fresh) };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderList();
        if (selectedCode && state.articles[selectedCode]) renderDetail();
      });
    }
    // ако документът още не съществува в облака, "засяваме" го веднъж
    if (isAdmin && data && data.saveCentralRest) {
      dbg("(admin съм) — проверявам/засявам облачния документ при нужда чрез pushToFirestore()");
      pushToFirestore();
    }
    setSyncStatus("synced");
  }

  function pushToFirestore() {
    dbg("pushToFirestore() (REST) извикана");
    if (!data || !data.saveCentralRest) {
      dbg("❌ data.saveCentralRest липсва");
      if (saveConfirmEl) saveConfirmEl.textContent = "⚠ ДИАГНОСТИКА: REST функцията липсва";
      return;
    }
    dbg("извиквам data.saveCentralRest(...) — изпращам " + JSON.stringify(state.articles).length + " символа");
    data
      .saveCentralRest(state.articles)
      .then((res) => {
        dbg("✅ REST PATCH УСПЕШЕН, updatedAt=" + res.updatedAt);
        if (saveConfirmEl) {
          saveConfirmEl.textContent = "✅ ПОТВЪРДЕНО от Firestore (REST) в " + new Date().toLocaleTimeString("bg-BG");
        }
        if (window.__helfiShowBanner) window.__helfiShowBanner("ПОТВЪРДЕНО (REST): записът пристигна в Firestore в " + new Date().toLocaleTimeString("bg-BG"), true);
        setSyncStatus("synced");
      })
      .catch((err) => {
        dbg("❌ REST PATCH ОТХВЪРЛЕН: " + (err && err.message));
        setSyncStatus("error");
        const msg = "ГРЕШКА: " + (err && err.message ? err.message : String(err));
        if (saveConfirmEl) saveConfirmEl.textContent = "❌ " + msg;
        if (window.__helfiShowBanner) window.__helfiShowBanner(msg, false);
      });
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

  // ефективен темп: ръчна матрица+удар → замразен (потвърден) цикъл → умно изчисленото от записите
  // (приоритетът съвпада с core.effectiveCycle() в helfi-core.js)
  function effectiveRate(article, stats) {
    if (article.useManualCycle && article.matrixCavities > 0 && article.strokeSeconds > 0) {
      return {
        value: (article.matrixCavities * 3600) / article.strokeSeconds,
        unit: "бутилки/час",
        source: "manual",
        matrixCavities: article.matrixCavities,
        strokeSeconds: article.strokeSeconds,
      };
    }
    if (article.frozen && article.frozenCycleSeconds > 0 && article.matrixCavities > 0) {
      return {
        value: (article.matrixCavities * 3600) / article.frozenCycleSeconds,
        unit: "бутилки/час",
        source: "frozen",
        matrixCavities: article.matrixCavities,
        strokeSeconds: article.frozenCycleSeconds,
      };
    }
    if (stats.count > 0) {
      if (article.matrixCavities > 0) {
        // знаем матрицата (гнезда на удар) -> превръщаме "умния" темп в реален
        // цикъл на удар, вместо да го показваме подвеждащо като "на бутилка"
        const strokeSeconds = (article.matrixCavities * 3600) / stats.value;
        return {
          value: stats.value,
          unit: stats.unit,
          source: "smart",
          matrixCavities: article.matrixCavities,
          strokeSeconds,
        };
      }
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

  const cycleSampleInput = document.getElementById("cycleSampleInput");
  const freezeThresholdInput = document.getElementById("freezeThresholdInput");
  const addCycleSampleBtn = document.getElementById("addCycleSampleBtn");
  const lockCycleBtn = document.getElementById("lockCycleBtn");
  const unlockCycleBtn = document.getElementById("unlockCycleBtn");
  const freezeBadge = document.getElementById("freezeBadge");
  const freezeInfo = document.getElementById("freezeInfo");
  const cycleSamplesList = document.getElementById("cycleSamplesList");

  const statsBadge = document.getElementById("statsBadge");
  const statsBody = document.getElementById("statsBody");
  const historyList = document.getElementById("historyList");
  const logMachine = document.getElementById("logMachine");
  const logDate = document.getElementById("logDate");
  const logDuration = document.getElementById("logDuration");
  const logUnits = document.getElementById("logUnits");
  const quickTraysInput = document.getElementById("quickTraysInput");

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
    specMatrixCavities.disabled = !isAdmin; // независимо от ръчен режим — матрицата е физическо свойство на формата
    specStrokeSeconds.disabled = !isAdmin || !a.useManualCycle;

    // read-only посетител: вижда спецификациите, но не може да ги пипа
    [specCategory, specUnit, specBottles, specUnitsPerPallet, specMatrixCavities, specUseManualCycle].forEach((el) => {
      el.disabled = el.disabled || !isAdmin;
    });

    if (specComplete(a)) {
      const bottlesPerPallet = a.bottlesPerUnit * a.unitsPerPallet;
      specDerived.textContent = `= ${fmtNum(a.unitsPerPallet, 0)} ${unitLabel(a, true)} на пале · ${fmtNum(bottlesPerPallet, 0)} бутилки на пале`;
    } else {
      specDerived.textContent = `Въведи бутилки в ${unitLabel(a, false)} и ${unitLabel(a, true)} на пале, за да видиш пълното пале.`;
    }

    if (a.matrixCavities > 0 && a.strokeSeconds > 0) {
      const bottlesPerHour = (a.matrixCavities * 3600) / a.strokeSeconds;
      cycleDerived.textContent = `= 1 удар на ${fmtNum(a.strokeSeconds, 2)} сек → ${fmtNum(a.matrixCavities, 0)} бутилки наведнъж (среден темп ${fmtNum(bottlesPerHour, 0)} бутилки/час)`;
    } else {
      cycleDerived.textContent = "";
    }

    renderCycleLearning(a);

    // stats
    const stats = computeStats(a);
    const eff = effectiveRate(a, stats);

    if (!eff) {
      statsBadge.textContent = "";
      statsBody.innerHTML = `<p class="hint">Все още няма записи от производство за този артикул.</p>`;
    } else {
      if (eff.source === "frozen") {
        statsBadge.innerHTML = `<span class="badge confirmed">🔒 замразен цикъл (потвърден)</span>`;
      } else if (eff.source === "manual") {
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

      if (eff.matrixCavities && eff.strokeSeconds) {
        // знаем точно матрицата и времето за удар -> смятаме на цели удари
        // (напр. матрица 3: винаги по 3 бутилки наведнъж, никога "по 1")
        rows.push(`<div class="stat-row"><span>1 удар</span><b>${fmtNum(eff.strokeSeconds, 2)} сек → ${fmtNum(eff.matrixCavities, 0)} бутилки</b></div>`);

        if (a.bottlesPerUnit) {
          const hitsPerUnit = Math.ceil(a.bottlesPerUnit / eff.matrixCavities);
          const timePerUnitH = (hitsPerUnit * eff.strokeSeconds) / 3600;
          rows.push(`<div class="stat-row"><span>Удари за 1 ${unitLabel(a, false)}</span><b>${fmtNum(hitsPerUnit, 0)} удара · ${fmtHM(timePerUnitH)}</b></div>`);
          if (a.unitsPerPallet) {
            const hitsPerPallet = Math.ceil((a.bottlesPerUnit * a.unitsPerPallet) / eff.matrixCavities);
            const timePerPalletH = (hitsPerPallet * eff.strokeSeconds) / 3600;
            rows.push(`<div class="stat-row highlight"><span>Време за 1 пале</span><b>${fmtHM(timePerPalletH)}</b></div>`);
          }
        } else {
          rows.push(`<p class="hint">Въведи бутилки в ${unitLabel(a, false)}, за да видиш удари/време за 1 ${unitLabel(a, false)} и за пале.</p>`);
        }
      } else if (a.bottlesPerUnit) {
        // няма позната матрица/удар (само "умен" темп от записите) -> оценка по среден темп
        const cycleSec = 3600 / eff.value;
        rows.push(`<div class="stat-row"><span>Среден цикъл на бутилка</span><b>${fmtNum(cycleSec, 2)} сек</b></div>`);
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

      if ((eff.source === "manual" || eff.source === "frozen") && stats.count > 0) {
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
          if (!isAdmin) return;
          a.logs = a.logs.filter((e) => e.id !== btn.dataset.id);
          saveState();
          renderDetail();
          renderList();
        });
      });
    }
  }

  function renderCycleLearning(a) {
    freezeThresholdInput.value = a.freezeThreshold || DEFAULT_FREEZE_THRESHOLD;
    const count = a.cycleSamples.length;
    const sinceUnlock = count - (a.unlockBaseline || 0);
    const threshold = a.freezeThreshold || DEFAULT_FREEZE_THRESHOLD;

    if (a.frozen) {
      freezeBadge.innerHTML = `<span class="badge confirmed">Замразен / Потвърден цикъл</span>`;
      const when = a.frozenAt ? new Date(a.frozenAt).toLocaleString("bg-BG") : "";
      freezeInfo.textContent = `Референтен цикъл: ${fmtNum(a.frozenCycleSeconds, 2)} сек/удар (замразен ${when}, от ${count} засичания общо).`;
    } else {
      freezeBadge.innerHTML = `<span class="badge calibrating">калибриране · ${sinceUnlock}/${threshold}</span>`;
      freezeInfo.textContent = count
        ? `${count} засичания общо · остават ${Math.max(0, threshold - sinceUnlock)} до автоматично замразяване.`
        : `Все още няма засичания на цикъла за този артикул.`;
    }

    lockCycleBtn.disabled = a.frozen || count === 0;
    unlockCycleBtn.disabled = !a.frozen;

    if (a.cycleSamples.length === 0) {
      cycleSamplesList.innerHTML = `<p class="hint">Няма добавени засичания.</p>`;
    } else {
      const sorted = [...a.cycleSamples].sort((x, y) => y.ts - x.ts);
      cycleSamplesList.innerHTML = sorted
        .map(
          (s) => `
          <div class="history-row" data-id="${s.id}">
            <div><b>${fmtNum(s.seconds, 2)} сек</b> <span class="hint">· ${new Date(s.ts).toLocaleString("bg-BG")}</span></div>
            <button class="del-log-btn" data-id="${s.id}" title="Изтрий засичането">✕</button>
          </div>`
        )
        .join("");
      cycleSamplesList.querySelectorAll(".del-log-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!isAdmin) return;
          a.cycleSamples = a.cycleSamples.filter((s) => s.id !== btn.dataset.id);
          saveState();
          renderDetail();
        });
      });
    }
  }

  addCycleSampleBtn.addEventListener("click", () => {
    dbg("бутон 'добави цикъл' натиснат. isAdmin=" + isAdmin + " selectedCode=" + selectedCode);
    if (!isAdmin) return;
    const a = state.articles[selectedCode];
    if (!a) return;
    const seconds = Number(cycleSampleInput.value);
    if (!seconds || seconds <= 0) {
      cycleSampleInput.focus();
      return;
    }
    a.cycleSamples.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      seconds,
      ts: Date.now(),
    });
    maybeAutoFreeze(a);
    saveState();
    cycleSampleInput.value = "";
    renderDetail();
  });

  freezeThresholdInput.addEventListener("change", () => {
    if (!isAdmin) return;
    const a = state.articles[selectedCode];
    if (!a) return;
    a.freezeThreshold = Number(freezeThresholdInput.value) || DEFAULT_FREEZE_THRESHOLD;
    maybeAutoFreeze(a);
    saveState();
    renderDetail();
  });

  lockCycleBtn.addEventListener("click", () => {
    if (!isAdmin) return;
    const a = state.articles[selectedCode];
    if (!a || a.cycleSamples.length === 0) return;
    freezeFromSamples(a);
    saveState();
    renderDetail();
  });

  unlockCycleBtn.addEventListener("click", () => {
    if (!isAdmin) return;
    const a = state.articles[selectedCode];
    if (!a) return;
    a.frozen = false;
    a.unlockBaseline = a.cycleSamples.length;
    saveState();
    renderDetail();
  });

  function saveSpec() {
    if (!isAdmin) return;
    const a = state.articles[selectedCode];
    if (!a) return;
    a.category = specCategory.value;
    a.packagingUnit = specUnit.value === "stack" ? "stack" : "tray";
    a.bottlesPerUnit = specBottles.value ? Number(specBottles.value) : null;
    a.unitsPerPallet = specUnitsPerPallet.value ? Number(specUnitsPerPallet.value) : null;
    a.useManualCycle = !!specUseManualCycle.checked;
    a.matrixCavities = specMatrixCavities.value ? Math.round(Number(specMatrixCavities.value)) : null;
    a.strokeSeconds = specStrokeSeconds.value ? Number(specStrokeSeconds.value) : null;
    saveState();
    renderDetail();
    renderList();
  }

  [specCategory, specUnit, specBottles, specUnitsPerPallet, specUseManualCycle, specMatrixCavities, specStrokeSeconds].forEach((el) => {
    el.addEventListener("change", saveSpec);
  });

  // изричен бутон "Запази" — покрива случаите, когато потребителят не е
  // "излязъл" от последното поле (change не е гръмнал), и дава ясно, видимо
  // потвърждение, че записът наистина е тръгнал към облака
  const saveArticleBtn = document.getElementById("saveArticleBtn");
  const saveConfirmEl = document.getElementById("saveConfirm");
  saveArticleBtn.addEventListener("click", () => {
    if (!isAdmin || !selectedCode) return;
    saveSpec();
    saveConfirmEl.textContent = "⏳ Запазено локално, изпращам в облака…";
    // текстът вече НЕ изчезва автоматично — pushToFirestore() ще го презапише
    // с реалния резултат (успех/грешка), за да е ясно видим за диагностика
  });

  specUseManualCycle.addEventListener("change", () => {
    specMatrixCavities.disabled = !specUseManualCycle.checked;
    specStrokeSeconds.disabled = !specUseManualCycle.checked;
  });

  function addProductionLog(a, { machine, date, duration, units }) {
    if (!duration || !units) return false;
    a.logs.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      machine: (machine || "").trim(),
      date: date || new Date().toISOString().slice(0, 10),
      durationHours: duration,
      units,
      ts: Date.now(),
    });
    saveState();
    if (machine && machine.trim()) localStorage.setItem("helfi_last_machine", machine.trim());
    renderDetail();
    renderList();
    return true;
  }

  document.getElementById("addLogBtn").addEventListener("click", () => {
    if (!isAdmin) return;
    const a = state.articles[selectedCode];
    if (!a) return;
    const duration = Number(logDuration.value);
    const units = Number(logUnits.value);
    if (!duration || !units) {
      logDuration.focus();
      return;
    }
    addProductionLog(a, { machine: logMachine.value, date: logDate.value, duration, units });
    logDuration.value = "12";
    logUnits.value = "";
  });

  document.getElementById("quickTraysBtn").addEventListener("click", () => {
    dbg("бутон 'тави за смяна' натиснат. isAdmin=" + isAdmin + " selectedCode=" + selectedCode + " value=" + quickTraysInput.value);
    if (!isAdmin) return;
    const a = state.articles[selectedCode];
    if (!a) return;
    const units = Number(quickTraysInput.value);
    if (!units) {
      dbg("❌ спряно — стойността в полето не е валидно число: '" + quickTraysInput.value + "'");
      quickTraysInput.focus();
      return;
    }
    const ok = addProductionLog(a, { duration: 12, units });
    dbg("addProductionLog върна: " + ok);
    if (ok) quickTraysInput.value = "";
  });

  document.getElementById("deleteArticleBtn").addEventListener("click", () => {
    if (!isAdmin) return;
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
    if (!isAdmin) return;
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
    if (!isAdmin) return;
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported.articles) throw new Error("невалиден файл");
        if (!confirm("Това ще замени текущата чернова с данните от файла. Продължи?")) return;
        state.articles = normalizeArticles(imported.articles);
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

  // ---------------- скрит админ режим: отключване / публикуване ----------------
  const modeLabelEl = document.getElementById("modeLabel");
  const adminActionsEl = document.getElementById("adminActions");
  const pageTitleEl = document.getElementById("pageTitle");
  const adminOnlyEls = () => document.querySelectorAll(".admin-only");

  function applyAdminVisibility() {
    adminOnlyEls().forEach((el) => (el.hidden = !isAdmin));
    adminActionsEl.hidden = !isAdmin;
    if (isAdmin) {
      modeLabelEl.textContent = data && data.hasDraft()
        ? "🔓 Админ режим · имаш незапазена чернова (публикувай я, за да влезе в централните данни)"
        : "🔓 Админ режим · редакциите се пазят като чернова на това устройство";
    } else {
      modeLabelEl.textContent = "👁 Само за четене · данните се въвеждат от администратора";
    }
  }

  function enterAdmin() {
    isAdmin = true;
    applyAdminVisibility();
    state = buildState();
    selectedCode = null;
    panel.hidden = true;
    renderList();
  }

  function tryUnlock() {
    const pin = prompt("Админ ПИН:");
    if (pin === null) return;
    if (data && data.tryUnlockAdmin(pin)) {
      enterAdmin();
    } else {
      alert("Грешен ПИН.");
    }
  }

  // скрит жест: 5 бързи клика върху заглавието "Продукти"
  let titleClicks = 0;
  let titleClickTimer = null;
  pageTitleEl.addEventListener("click", () => {
    if (isAdmin) return; // вече отключено — жестът вече не е нужен
    titleClicks++;
    clearTimeout(titleClickTimer);
    titleClickTimer = setTimeout(() => (titleClicks = 0), 1500);
    if (titleClicks >= 5) {
      titleClicks = 0;
      tryUnlock();
    }
  });

  // удобство за самия админ: отваряне на produkti.html#admin показва промпта директно
  if (!isAdmin && location.hash === "#admin") tryUnlock();

  document.getElementById("publishBtn").addEventListener("click", () => {
    if (!isAdmin || !data) return;
    data.exportPublishedFile(state.articles);
    alert(
      "Изтеглен е нов products-data.json.\n\n" +
        "За да влезе в сила за всички посетители: качи този файл в проекта " +
        "(замени data/products-data.json) — например през _upload/ zip " +
        "потока, описан в README — и изчакай сайтът да се обнови."
    );
  });

  document.getElementById("discardDraftBtn").addEventListener("click", () => {
    if (!isAdmin || !data) return;
    if (!confirm("Да изтрия локалната чернова и да презаредя публикуваните данни?")) return;
    data.resetDraft();
    state = buildState();
    selectedCode = null;
    panel.hidden = true;
    renderList();
    applyAdminVisibility();
  });

  document.getElementById("lockAdminBtn").addEventListener("click", () => {
    if (!data) return;
    if (data.hasDraft() && !confirm("Имаш незапазена чернова — сигурен ли си, че искаш да излезеш от админ режима? Черновата ще остане на това устройство и ще я видиш пак, ако се логнеш отново.")) return;
    data.lockAdmin();
    isAdmin = false;
    state = buildState();
    selectedCode = null;
    panel.hidden = true;
    renderList();
    applyAdminVisibility();
  });

  // ---------------- init ----------------
  logDate.value = new Date().toISOString().slice(0, 10);
  logDuration.value = "12"; // стандартна смяна = 12ч, лесно се променя
  const lastMachine = localStorage.getItem("helfi_last_machine");
  if (lastMachine) logMachine.value = lastMachine;

  function init() {
    dbg("init() стартирана");
    state = buildState();
    applyAdminVisibility();
    renderList();
    // Firestore слушателят е нужен на ВСИЧКИ (не само на админа), за да
    // виждат обикновените посетители промените на живо, без да презареждат
    // страницата. Писането към облака (pushToFirestore) си остава само за
    // отключен админ — виж saveState() по-горе.
    initFirestore();
    dbg("init() приключи");
  }

  dbg("край на products.js (синхронна част). data.fetchCentral() наличен=" + !!(data && data.fetchCentral));
  if (data) {
    data.fetchCentral().then(init).catch((e) => dbg("❌ fetchCentral() reject: " + e));
  } else {
    modeLabelEl.textContent = "⚠ данните не можаха да се заредят";
    init();
  }
})();
