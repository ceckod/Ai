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
//
// Достъп:
// - Всеки, който отвори страницата, вижда data/products-state.json
//   (публикуваните данни) READ-ONLY — не може да пипа нищо.
// - Само влезлият с валиден GitHub token с права за запис в repo-то
//   вижда формите за редакция. Всяка промяна прави commit директно
//   към data/products-state.json през GitHub-ото REST API — без
//   ръчно копиране на файлове.

(function () {
  const GH_API = "https://api.github.com";
  const DATA_PATH = "data/products-state.json";
  const CRED_KEY = "helfi_gh_creds_v1"; // { token, owner, repo, branch }

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

  function seedArticlesObj() {
    const obj = {};
    SEED_ARTICLES.forEach(([code, name]) => {
      obj[code] = { code, name, bottlesPerTray: null, traysPerStack: null, stacksPerPallet: null, logs: [] };
    });
    return obj;
  }

  function withSeedFallback(articles) {
    const seed = seedArticlesObj();
    Object.keys(seed).forEach((code) => {
      if (!articles[code]) articles[code] = seed[code];
    });
    return articles;
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // ---------------- GitHub вход/креденшъли ----------------
  function ghCreds() {
    try {
      return JSON.parse(localStorage.getItem(CRED_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  function isLoggedIn() {
    const c = ghCreds();
    return !!(c && c.token && c.owner && c.repo);
  }

  function ghHeaders() {
    const c = ghCreds();
    return {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/vnd.github+json",
    };
  }

  async function validateLogin(token, owner, repo) {
    const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) throw new Error("Repo-то не е намерено (провери owner/repo) или токенът няма достъп.");
    if (!res.ok) throw new Error(`GitHub грешка (${res.status})`);
    const data = await res.json();
    if (!data.permissions || !data.permissions.push) {
      throw new Error("Токенът няма право за запис (push) в това repo.");
    }
    return data.default_branch || "main";
  }

  async function ghGetSha() {
    const c = ghCreds();
    const url = `${GH_API}/repos/${c.owner}/${c.repo}/contents/${DATA_PATH}?ref=${encodeURIComponent(c.branch)}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub грешка при четене (${res.status})`);
    const data = await res.json();
    return data.sha;
  }

  async function commitToGitHub(message) {
    if (!isLoggedIn()) return;
    setCommitStatus("saving");
    try {
      const c = ghCreds();
      let sha = await ghGetSha();
      const body = {
        message: message || "Обновяване на продукти",
        content: utf8ToBase64(JSON.stringify(state, null, 2)),
        branch: c.branch,
      };
      if (sha) body.sha = sha;

      let res = await fetch(`${GH_API}/repos/${c.owner}/${c.repo}/contents/${DATA_PATH}`, {
        method: "PUT",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        // конфликт (файлът е сменен междувременно) — опресняваме sha и опитваме пак
        sha = await ghGetSha();
        body.sha = sha;
        res = await fetch(`${GH_API}/repos/${c.owner}/${c.repo}/contents/${DATA_PATH}`, {
          method: "PUT",
          headers: { ...ghHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }
      setCommitStatus("saved");
    } catch (e) {
      setCommitStatus("error", e.message);
    }
  }

  // ---------------- state ----------------
  let state = { articles: seedArticlesObj() };
  let selectedCode = null;

  async function loadPublished() {
    try {
      const res = await fetch("data/products-state.json", { cache: "no-store" });
      if (!res.ok) throw new Error("no file");
      const data = await res.json();
      if (!data.articles) throw new Error("bad shape");
      state = { articles: withSeedFallback(data.articles) };
    } catch (e) {
      state = { articles: seedArticlesObj() };
    }
    renderList();
    if (selectedCode) renderDetail();
  }

  function saveState(commitMsg) {
    if (!isLoggedIn()) return;
    commitToGitHub(commitMsg);
  }

  // ---------------- UI: вход / изход ----------------
  const loginCard = document.getElementById("loginCard");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const commitStatusEl = document.getElementById("commitStatus");
  const whoamiEl = document.getElementById("whoami");

  function setCommitStatus(mode, detail) {
    if (!commitStatusEl) return;
    if (mode === "saving") {
      commitStatusEl.textContent = "⏳ запазва се в GitHub…";
      commitStatusEl.style.color = "var(--text-dim)";
    } else if (mode === "saved") {
      commitStatusEl.textContent = "✓ запазено в GitHub";
      commitStatusEl.style.color = "var(--accent)";
    } else if (mode === "error") {
      commitStatusEl.textContent = "⚠ грешка при запис" + (detail ? `: ${detail}` : "");
      commitStatusEl.style.color = "var(--amber)";
    } else {
      commitStatusEl.textContent = "";
    }
  }

  function applyLoginUI() {
    const logged = isLoggedIn();
    document.body.classList.toggle("edit-mode", logged);
    if (loginCard) loginCard.hidden = logged;
    if (logoutBtn) logoutBtn.hidden = !logged;
    if (whoamiEl) {
      const c = ghCreds();
      whoamiEl.textContent = logged ? `${c.owner}/${c.repo}` : "";
    }
    [specBottles, specTrays, specStacks].forEach((el) => el && (el.disabled = !logged));
    setCommitStatus(null);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      loginError.textContent = "";
      loginBtn.disabled = true;
      loginBtn.textContent = "Проверка…";
      const token = document.getElementById("ghToken").value.trim();
      const owner = document.getElementById("ghOwner").value.trim();
      const repo = document.getElementById("ghRepo").value.trim();
      let branch = document.getElementById("ghBranch").value.trim();
      try {
        const defaultBranch = await validateLogin(token, owner, repo);
        if (!branch) branch = defaultBranch;
        localStorage.setItem(CRED_KEY, JSON.stringify({ token, owner, repo, branch }));
        applyLoginUI();
        renderList();
        if (selectedCode) renderDetail();
      } catch (e) {
        loginError.textContent = e.message;
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "Вход";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem(CRED_KEY);
      applyLoginUI();
      renderList();
      if (selectedCode) renderDetail();
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
    [specBottles, specTrays, specStacks].forEach((el) => (el.disabled = !isLoggedIn()));

    if (specComplete(a)) {
      const traysPerPallet = a.traysPerStack * a.stacksPerPallet;
      const bottlesPerPallet = a.bottlesPerTray * traysPerPallet;
      specDerived.textContent =
        `= ${fmtNum(traysPerPallet, 0)} тави на пале · ${fmtNum(bottlesPerPallet, 0)} бутилки на пале`;
    } else {
      specDerived.textContent = isLoggedIn()
        ? "Въведи бутилки в тава, тави в стек и стекове на пале, за да видиш пълното пале."
        : "Опаковката за този артикул все още не е въведена.";
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
          const delBtn = isLoggedIn()
            ? `<button class="del-log-btn" data-id="${e.id}" title="Изтрий записа">✕</button>`
            : "";
          return `
            <div class="history-row" data-id="${e.id}">
              <div>
                <b>${e.date || "—"}</b> · машина ${e.machine || "—"}<br/>
                <span class="hint">${fmtNum(e.durationHours, 1)} ч · ${fmtNum(e.trays, 0)} тави → ${rateTxt}</span>
              </div>
              ${delBtn}
            </div>`;
        })
        .join("");
      historyList.querySelectorAll(".del-log-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!isLoggedIn()) return;
          a.logs = a.logs.filter((e) => e.id !== btn.dataset.id);
          renderDetail();
          renderList();
          saveState(`Изтрит запис за ${a.code}`);
        });
      });
    }
  }

  function saveSpec() {
    if (!isLoggedIn()) return;
    const a = state.articles[selectedCode];
    if (!a) return;
    a.bottlesPerTray = specBottles.value ? Number(specBottles.value) : null;
    a.traysPerStack = specTrays.value ? Number(specTrays.value) : null;
    a.stacksPerPallet = specStacks.value ? Number(specStacks.value) : null;
    renderDetail();
    renderList();
    saveState(`Опаковка: ${a.code}`);
  }

  [specBottles, specTrays, specStacks].forEach((el) => {
    el.addEventListener("change", saveSpec);
  });

  document.getElementById("addLogBtn").addEventListener("click", () => {
    if (!isLoggedIn()) return;
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
    if (logMachine.value.trim()) localStorage.setItem("helfi_last_machine", logMachine.value.trim());
    logDuration.value = "";
    logTrays.value = "";
    renderDetail();
    renderList();
    saveState(`Нов запис: ${a.code}`);
  });

  document.getElementById("deleteArticleBtn").addEventListener("click", () => {
    if (!isLoggedIn() || !selectedCode) return;
    if (!confirm(`Да изтрия артикул ${selectedCode}? Ще стане веднага в GitHub.`)) return;
    const code = selectedCode;
    delete state.articles[code];
    selectedCode = null;
    panel.hidden = true;
    renderList();
    saveState(`Изтрит артикул: ${code}`);
  });

  // ---------------- add new article ----------------
  document.getElementById("addArticleBtn").addEventListener("click", () => {
    if (!isLoggedIn()) return;
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
    codeEl.value = "";
    nameEl.value = "";
    renderList();
    selectArticle(code);
    saveState(`Нов артикул: ${code}`);
  });

  // ---------------- износ (резервно копие) ----------------
  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products-state.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---------------- init ----------------
  logDate.value = new Date().toISOString().slice(0, 10);
  const lastMachine = localStorage.getItem("helfi_last_machine");
  if (lastMachine) logMachine.value = lastMachine;

  applyLoginUI();
  renderList();
  loadPublished();
})();
