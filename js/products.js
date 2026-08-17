// Helfi Plastics — Продукти / артикули
// Спецификации на опаковката (тава / стек-чувал / пале) +
// самонадграждащ се калкулатор на производствения цикъл.
//
// Как работи "самонадграждането":
// При всеки нов запис (машина, дата, часове работа, произведени тави)
// скриптът НЕ пази стар фиксиран резултат — той преизчислява цикъла
// наново от всички записи всеки път. Взима последните MIN_CONFIRM
// записа и ако произведеният им темп (бут./час) съвпада в рамките на
// TOLERANCE (%), приема стойността за "потвърдена". Иначе показва
// текуща най-добра оценка (медиана) и продължава да събира данни.

(function () {
  const STORAGE_KEY = "helfi_products_v1";
  const TOLERANCE = 0.05; // 5% допустимо разминаване между последните записи
  const MIN_CONFIRM = 3;  // колко последователни записа трябва да съвпаднат

  // ---- начален каталог (от helfi.net/products/) ----
  const SEED_ARTICLES = [
    ["H415-68", "415мл премиум"],
    ["H100-74", "100мл спирт"],
    ["H500-81", "500мл Веджи уош"],
    ["H750-67", "750мл премиум"],
    ["H120-75", "120мл флакон"],
    ["H150-70", "150мл флакон"],
    ["H200-71", "200мл флакон"],
    ["H300-72", "300мл флакон"],
    ["H400-69", "400мл течен сапун"],
    ["H050-73", "50мл спирт"],
    ["H500-76", "500мл 38мм"],
    ["H750-80", "750мл пръскалка"],
    ["H500-77", "Флакон вода за уста 500мл"],
    ["H830-62", "830мл балсам"],
    ["H125-61", "125мл фармация"],
    ["H230-60", "230мл флакон"],
    ["H330-44", "330мл фреш"],
    ["H030-59", "30мл хотел"],
    ["H300-56", "300мл кетчуп Оберон"],
    ["H1000-55", "1 литър кетчуп"],
    ["H500-54", "500мл кетчуп Оберон"],
    ["H250-53", "250мл сос Денито"],
    ["H1000-57", "1 литър олио HOSSO"],
    ["H900-58", "900мл кетчуп Оберон"],
    ["GAL19D", "19 литра галон с дръжка"],
    ["H2000-47", "2000мл бъклица"],
    ["H1000-46", "1000мл фреш"],
    ["H750-41", "750мл шампоан"],
    ["H700-48", "700мл кулинар"],
    ["H500-45", "500мл фреш"],
    ["H500-45B", "500мл фреш (бял)"],
    ["H500-49", "500мл пръскалка"],
    ["H500-40", "500мл веро"],
    ["H300-43", "300мл фреш"],
    ["H200-50", "200мл алкохол"],
    ["GAL19", "19 литрови бутилки (галони)"],
    ["H025-42", "25мл хотел"],
    ["H250-22", "250мл фармация"],
    ["H200-21", "200мл фармация"],
    ["H150-12", "150мл фармация"],
    ["H200-36", "200мл флакон"],
    ["H150-31", "150мл флакон"],
    ["H100-35", "100мл флакон"],
    ["H200-23", "200мл Black Ram"],
    ["H250-13", "250мл сос"],
    ["H200-11", "200мл алкохол"],
    ["H1000-26", "1000мл 42мм"],
    ["H1000-29", "1000мл пръскалка"],
    ["H750-25", "750мл пръскалка"],
    ["H1000-20", "1000мл супер гел"],
    ["H900-39", "900мл супер гел"],
    ["H1000-19", "1000мл балсам"],
    ["H900-38", "900мл балсам"],
    ["H1000-18", "1000мл подови настилки"],
    ["H500-37", "500мл веро"],
    ["H900-34", "900мл AVA"],
    ["H625-33", "625мл AVA"],
    ["H425-32", "425мл AVA"],
    ["H1000-28", "1000мл Планет"],
    ["H625-30", "625мл Планет"],
    ["H500-17", "500мл Планет"],
    ["H425-27", "425мл Планет"],
    ["H1000-16", "1000мл душ гел"],
    ["H500-14", "500мл душ гел"],
    ["H300-15", "300мл течен сапун"],
  ];

  // ---------------- state ----------------
  function emptyState() {
    return { articles: {} };
  }

  function loadState() {
    let state;
    try {
      state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyState();
    } catch (e) {
      state = emptyState();
    }
    if (!state.articles) state.articles = {};
    // добавяме липсващи артикули от каталога, без да пипаме вече въведени
    SEED_ARTICLES.forEach(([code, name]) => {
      if (!state.articles[code]) {
        state.articles[code] = {
          code,
          name,
          bottlesPerTray: null,
          traysPerStack: null,
          stacksPerPallet: null,
          logs: [],
        };
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

  // ---------------- Firestore (по избор — синхронизация между устройства) ----------------
  // Активира се сама, ако js/firebase-config.js съдържа истински ключове.
  // Ако не е конфигурирано, всичко работи както преди — само в localStorage.
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
            pushToFirestore(); // пръв път — качваме локалните данни в облака
            return;
          }
          const remote = snap.data();
          if (remote && remote.json) {
            state = JSON.parse(remote.json);
            localStorage.setItem(STORAGE_KEY, remote.json);
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

  function specComplete(a) {
    return !!(a.bottlesPerTray && a.traysPerStack && a.stacksPerPallet);
  }

  function computeEntryRate(entry, article) {
    if (!entry.durationHours || !entry.trays) return null;
    if (article.bottlesPerTray) {
      return {
        value: (entry.trays * article.bottlesPerTray) / entry.durationHours,
        unit: "бутилки/час",
      };
    }
    return { value: entry.trays / entry.durationHours, unit: "тави/час" };
  }

  function computeStats(article) {
    const usable = article.logs.filter((e) => e.durationHours > 0 && e.trays > 0);
    if (usable.length === 0) return { count: 0 };

    const rates = usable.map((e) => computeEntryRate(e, article).value);
    const unit = article.bottlesPerTray ? "бутилки/час" : "тави/час";

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

  // ---------------- rendering: article list ----------------
  const listEl = document.getElementById("articleList");
  const searchEl = document.getElementById("articleSearch");
  const summaryEl = document.getElementById("articleSummary");

  function renderSummary() {
    const codes = Object.keys(state.articles);
    const done = codes.filter((c) => specComplete(state.articles[c])).length;
    summaryEl.textContent = `${done} от ${codes.length} артикула имат въведена опаковка (тава/стек/пале)`;
  }

  function renderList() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const codes = Object.keys(state.articles).sort((a, b) => a.localeCompare(b));
    listEl.innerHTML = "";
    codes.forEach((code) => {
      const a = state.articles[code];
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
  const specBottles = document.getElementById("specBottles");
  const specTrays = document.getElementById("specTrays");
  const specStacks = document.getElementById("specStacks");
  const specDerived = document.getElementById("specDerived");
  const statsBadge = document.getElementById("statsBadge");
  const statsBody = document.getElementById("statsBody");
  const historyList = document.getElementById("historyList");
  const logMachine = document.getElementById("logMachine");
  const logDate = document.getElementById("logDate");
  const logDuration = document.getElementById("logDuration");
  const logTrays = document.getElementById("logTrays");

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
    specBottles.value = a.bottlesPerTray ?? "";
    specTrays.value = a.traysPerStack ?? "";
    specStacks.value = a.stacksPerPallet ?? "";

    if (specComplete(a)) {
      const traysPerPallet = a.traysPerStack * a.stacksPerPallet;
      const bottlesPerPallet = a.bottlesPerTray * traysPerPallet;
      specDerived.textContent =
        `= ${fmtNum(traysPerPallet, 0)} тави на пале · ${fmtNum(bottlesPerPallet, 0)} бутилки на пале`;
    } else {
      specDerived.textContent = "Въведи бутилки в тава, тави в стек и стекове на пале, за да видиш пълното пале.";
    }

    // stats
    const stats = computeStats(a);
    if (stats.count === 0) {
      statsBadge.textContent = "";
      statsBody.innerHTML = `<p class="hint">Все още няма записи от производство за този артикул.</p>`;
    } else {
      if (stats.confirmed) {
        statsBadge.innerHTML = `<span class="badge confirmed">потвърден · последните ${MIN_CONFIRM} съвпадат</span>`;
      } else {
        const need = MIN_CONFIRM - Math.min(stats.count, MIN_CONFIRM);
        const spreadTxt = stats.spread !== null ? ` (разлика ${fmtNum(stats.spread * 100, 0)}%)` : "";
        statsBadge.innerHTML = `<span class="badge calibrating">калибриране · ${stats.count} запис${stats.count === 1 ? "" : "а"}${spreadTxt}</span>`;
      }

      const rows = [];
      rows.push(`<div class="stat-row"><span>Темп на производство</span><b>${fmtNum(stats.value, 0)} ${stats.unit}</b></div>`);

      if (a.bottlesPerTray) {
        const cycleSec = 3600 / stats.value;
        rows.push(`<div class="stat-row"><span>Цикъл на бутилка</span><b>${fmtNum(cycleSec, 2)} сек</b></div>`);
        const timePerTrayH = a.bottlesPerTray / stats.value;
        rows.push(`<div class="stat-row"><span>Време за 1 тава</span><b>${fmtHM(timePerTrayH)}</b></div>`);
        if (a.traysPerStack) {
          rows.push(`<div class="stat-row"><span>Време за 1 стек/чувал</span><b>${fmtHM(timePerTrayH * a.traysPerStack)}</b></div>`);
        }
        if (a.traysPerStack && a.stacksPerPallet) {
          const timePerPalletH = (a.bottlesPerTray * a.traysPerStack * a.stacksPerPallet) / stats.value;
          rows.push(`<div class="stat-row highlight"><span>Време за 1 пале</span><b>${fmtHM(timePerPalletH)}</b></div>`);
        }
      } else {
        rows.push(`<div class="stat-row"><span>Време за 1 тава</span><b>${fmtHM(1 / stats.value)}</b></div>`);
        if (a.traysPerStack) {
          rows.push(`<div class="stat-row"><span>Време за 1 стек/чувал</span><b>${fmtHM(a.traysPerStack / stats.value)}</b></div>`);
        }
        if (a.traysPerStack && a.stacksPerPallet) {
          rows.push(`<div class="stat-row highlight"><span>Време за 1 пале</span><b>${fmtHM((a.traysPerStack * a.stacksPerPallet) / stats.value)}</b></div>`);
        }
        rows.push(`<p class="hint">Въведи "бутилки в тава", за да видиш и цикъла в секунди на бутилка.</p>`);
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
                <span class="hint">${fmtNum(e.durationHours, 1)} ч · ${fmtNum(e.trays, 0)} тави → ${rateTxt}</span>
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
    a.bottlesPerTray = specBottles.value ? Number(specBottles.value) : null;
    a.traysPerStack = specTrays.value ? Number(specTrays.value) : null;
    a.stacksPerPallet = specStacks.value ? Number(specStacks.value) : null;
    saveState();
    renderDetail();
    renderList();
  }

  [specBottles, specTrays, specStacks].forEach((el) => {
    el.addEventListener("change", saveSpec);
  });

  document.getElementById("addLogBtn").addEventListener("click", () => {
    const a = state.articles[selectedCode];
    if (!a) return;
    const duration = Number(logDuration.value);
    const trays = Number(logTrays.value);
    if (!duration || !trays) {
      logDuration.focus();
      return;
    }
    a.logs.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      machine: logMachine.value.trim(),
      date: logDate.value || new Date().toISOString().slice(0, 10),
      durationHours: duration,
      trays,
      ts: Date.now(),
    });
    saveState();
    if (logMachine.value.trim()) localStorage.setItem("helfi_last_machine", logMachine.value.trim());
    logDuration.value = "";
    logTrays.value = "";
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
    state.articles[code] = {
      code,
      name,
      bottlesPerTray: null,
      traysPerStack: null,
      stacksPerPallet: null,
      logs: [],
    };
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
