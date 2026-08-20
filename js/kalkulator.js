// Helfi Plastics — Калкулатор (тави ⇄ време)
//
// Реплика на логиката от стария Python калкулатор:
//  Режим А (тави за зададено време):
//    удари = floor(общо_време_сек / време_на_удар)
//    бутилки = удари × бутилки_на_удар
//    тави    = ceil(бутилки / бутилки_в_тава)     (сумирано за всички машини)
//  Режим Б (време за зададен брой тави):
//    нужни_бутилки = желани_тави × бутилки_в_тава
//    удари_нужни   = ceil(нужни_бутилки / бутилки_на_удар)
//    общо_време    = удари_нужни × време_на_удар

(function () {
  const core = window.HelfiCore;

  let articles = core.loadArticles();
  let articleCodes = Object.keys(articles).sort((a, b) => a.localeCompare(b));

  const fmtNum = core.fmtNum;

  function unitLabelFor(article) {
    if (!article) return "тава";
    return article.packagingUnit === "stack" ? "стек/чувал" : "тава";
  }

  // живо опресняване, ако данните в Продукти се сменят (друг таб / връщане на фокус)
  function reloadArticles() {
    articles = core.loadArticles();
    articleCodes = Object.keys(articles).sort((a, b) => a.localeCompare(b));
    renderMachineRows();
    computeTrays();
    renderTimeArticleCombo();
    computeTime();
  }
  window.addEventListener("storage", (e) => {
    if (e.key === core.STORAGE_KEY) reloadArticles();
  });
  window.addEventListener("focus", reloadArticles);

  // ---------------- режим табове ----------------
  const tabTrays = document.getElementById("tabTrays");
  const tabTime = document.getElementById("tabTime");
  const modeTrays = document.getElementById("modeTrays");
  const modeTime = document.getElementById("modeTime");

  tabTrays.addEventListener("click", () => {
    tabTrays.classList.add("active");
    tabTime.classList.remove("active");
    modeTrays.hidden = false;
    modeTime.hidden = true;
  });
  tabTime.addEventListener("click", () => {
    tabTime.classList.add("active");
    tabTrays.classList.remove("active");
    modeTime.hidden = false;
    modeTrays.hidden = true;
  });

  // ================= РЕЖИМ А: тави за зададено време =================
  const totalHoursEl = document.getElementById("totalHours");
  const totalMinutesEl = document.getElementById("totalMinutes");
  const machineListEl = document.getElementById("machineList");
  const addMachineBtn = document.getElementById("addMachineBtn");
  const traysResultsEl = document.getElementById("traysResults");

  let machineRows = []; // {id, articleCode}

  function addMachineRow() {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    machineRows.push({ id, articleCode: "" });
    renderMachineRows();
  }

  function renderMachineRows() {
    machineListEl.innerHTML = machineRows
      .map(
        (row, idx) => `
      <div class="machine-row" data-id="${row.id}">
        <div class="machine-row-head">
          <b>Машина ${idx + 1}</b>
          ${machineRows.length > 1 ? `<button class="machine-remove" data-remove="${row.id}" title="Премахни">✕</button>` : ""}
        </div>
        <label style="font-size:0.76rem;color:var(--text-dim);display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
          Артикул (по избор — попълва данните автоматично)
          <span data-article-mount="${row.id}"></span>
        </label>
        <div class="spec-grid">
          <label>Бутилки в тава/чувал
            <input type="number" min="1" data-field="bottlesPerTray" data-id="${row.id}" value="${row.bottlesPerTray ?? ""}" placeholder="напр. 400" />
          </label>
          <label>Бутилки на удар (матрица)
            <input type="number" min="1" max="6" step="1" data-field="bottlesPerHit" data-id="${row.id}" value="${row.bottlesPerHit ?? ""}" placeholder="напр. 3" />
          </label>
          <label>Време за 1 удар (сек)
            <input type="number" min="0" step="0.01" data-field="secPerHit" data-id="${row.id}" value="${row.secPerHit ?? ""}" placeholder="напр. 16" />
          </label>
        </div>
      </div>`
      )
      .join("");

    machineListEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        machineRows = machineRows.filter((r) => r.id !== btn.dataset.remove);
        renderMachineRows();
        computeTrays();
      });
    });

    machineListEl.querySelectorAll("[data-article-mount]").forEach((mountEl) => {
      const rowId = mountEl.dataset.articleMount;
      const row = machineRows.find((r) => r.id === rowId);
      if (!row) return;
      core.mountArticleCombo(mountEl, {
        articles,
        value: row.articleCode,
        placeholder: "Пиши код или име (напр. 415 или премиум)…",
        onSelect: (code) => {
          row.articleCode = code || "";
          const a = code ? articles[code] : null;
          if (a) {
            const cyc = core.effectiveCycle(a);
            row.bottlesPerTray = a.bottlesPerUnit || row.bottlesPerTray;
            row.unitsPerPallet = a.unitsPerPallet || null;
            if (cyc && cyc.matrixCavities && cyc.strokeSeconds) {
              row.bottlesPerHit = cyc.matrixCavities;
              row.secPerHit = cyc.strokeSeconds;
            }
          }
          renderMachineRows();
          computeTrays();
        },
      });
    });

    machineListEl.querySelectorAll("input[data-field]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const row = machineRows.find((r) => r.id === inp.dataset.id);
        row[inp.dataset.field] = inp.value ? Number(inp.value) : null;
        computeTrays();
      });
    });
  }

  function parseHM(hoursEl, minutesEl) {
    const h = Number(hoursEl.value) || 0;
    const m = Number(minutesEl.value) || 0;
    return h * 3600 + m * 60;
  }

  function computeTrays() {
    const totalSeconds = parseHM(totalHoursEl, totalMinutesEl);
    if (!totalSeconds) {
      traysResultsEl.innerHTML = `<p class="hint">Въведи общото време на работа.</p>`;
      return;
    }

    let totalTrays = 0;
    let totalPallets = 0;
    let anyValid = false;
    const rows = [];

    machineRows.forEach((row, idx) => {
      const a = articles[row.articleCode];
      const label = a ? `${a.code} — ${a.name}` : `Машина ${idx + 1}`;
      const unit = unitLabelFor(a);
      if (!row.bottlesPerTray || !row.bottlesPerHit || !row.secPerHit) {
        rows.push(`<div class="stat-row"><span>${label}</span><b>—</b></div>`);
        return;
      }
      anyValid = true;
      const hits = Math.floor(totalSeconds / row.secPerHit);
      const bottles = hits * row.bottlesPerHit;
      const trays = Math.ceil(bottles / row.bottlesPerTray);
      totalTrays += trays;
      let palletsTxt = "";
      if (row.unitsPerPallet) {
        // цели палета + оставащи тави (не закръгляй частичното пале нагоре)
        const pallets = Math.floor(trays / row.unitsPerPallet);
        const extraTrays = trays % row.unitsPerPallet;
        totalPallets += pallets;
        const trayWord = unit === "стек/чувал" ? "стека" : "тави";
        palletsTxt = ` · ${core.fmtPalletsTrays(pallets, extraTrays, trayWord)}`;
      }
      rows.push(
        `<div class="stat-row"><span>${label}</span><b>${fmtNum(trays)} ${unit === "стек/чувал" ? "стека" : "тави"} · ${fmtNum(bottles)} бутилки · ${fmtNum(hits)} удара${palletsTxt}</b></div>`
      );
    });

    if (!anyValid) {
      traysResultsEl.innerHTML = `<p class="hint">Попълни данните за поне една машина (бутилки в тава, бутилки на удар, време за удар).</p>`;
      return;
    }

    rows.push(`<div class="stat-row highlight"><span>Общо тави/стекове (всички машини)</span><b>${fmtNum(totalTrays)}</b></div>`);
    if (totalPallets > 0) {
      rows.push(`<div class="stat-row highlight"><span>Общо цели палета (машини с известно тави/пале)</span><b>${fmtNum(totalPallets)}</b></div>`);
    }
    traysResultsEl.innerHTML = rows.join("");
  }

  [totalHoursEl, totalMinutesEl].forEach((el) => el.addEventListener("input", computeTrays));
  addMachineBtn.addEventListener("click", addMachineRow);

  // ================= РЕЖИМ Б: време за зададен брой тави =================
  const timeArticleWrap = document.getElementById("timeArticleWrap");
  const timeBottlesPerTray = document.getElementById("timeBottlesPerTray");
  const timeBottlesPerHit = document.getElementById("timeBottlesPerHit");
  const timeSecPerHit = document.getElementById("timeSecPerHit");
  const timeDesiredTrays = document.getElementById("timeDesiredTrays");
  const timeResultsEl = document.getElementById("timeResults");
  let timeArticleCode = "";

  function renderTimeArticleCombo() {
    core.mountArticleCombo(timeArticleWrap, {
      articles,
      value: timeArticleCode,
      placeholder: "Пиши код или име (напр. 415 или премиум)…",
      onSelect: (code) => {
        timeArticleCode = code || "";
        const a = code ? articles[code] : null;
        if (a) {
          if (a.bottlesPerUnit) timeBottlesPerTray.value = a.bottlesPerUnit;
          const cyc = core.effectiveCycle(a);
          if (cyc && cyc.matrixCavities && cyc.strokeSeconds) {
            timeBottlesPerHit.value = cyc.matrixCavities;
            timeSecPerHit.value = cyc.strokeSeconds;
          }
        }
        computeTime();
      },
    });
  }
  renderTimeArticleCombo();

  function computeTime() {
    const bottlesPerTray = Number(timeBottlesPerTray.value);
    const bottlesPerHit = Number(timeBottlesPerHit.value);
    const secPerHit = Number(timeSecPerHit.value);
    const desiredTrays = Number(timeDesiredTrays.value);

    if (!bottlesPerTray || !bottlesPerHit || !secPerHit || !desiredTrays) {
      timeResultsEl.innerHTML = `<p class="hint">Попълни бутилки в тава, бутилки на удар, време за удар и желан брой тави.</p>`;
      return;
    }

    const a = articles[timeArticleCode];
    const unit = unitLabelFor(a) === "стек/чувал" ? "стека/чувала" : "тави";

    const totalBottlesNeeded = desiredTrays * bottlesPerTray;
    const hitsNeeded = Math.ceil(totalBottlesNeeded / bottlesPerHit);
    const totalSeconds = hitsNeeded * secPerHit;

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.round(totalSeconds % 60);

    const completion = new Date(Date.now() + totalSeconds * 1000);
    const completionStr = completion.toLocaleString("bg-BG", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    let palletsRow = "";
    if (a && a.unitsPerPallet) {
      // цели палета + оставащи тави (не закръгляй частичното пале нагоре)
      const pallets = Math.floor(desiredTrays / a.unitsPerPallet);
      const extraTrays = desiredTrays % a.unitsPerPallet;
      palletsRow = `<div class="stat-row"><span>= палета</span><b>${core.fmtPalletsTrays(pallets, extraTrays, unit)}</b></div>`;
    }

    timeResultsEl.innerHTML = `
      <div class="stat-row"><span>Нужни бутилки</span><b>${fmtNum(totalBottlesNeeded)}</b></div>
      <div class="stat-row"><span>Нужни удари</span><b>${fmtNum(hitsNeeded)}</b></div>
      <div class="stat-row highlight"><span>Общо време</span><b>${h} ч ${m} мин ${s} сек</b></div>
      <div class="stat-row"><span>За ${fmtNum(desiredTrays)} ${unit}, ако се стартира сега</span><b>готово ≈ ${completionStr}</b></div>
      ${palletsRow}
    `;
  }

  [timeBottlesPerTray, timeBottlesPerHit, timeSecPerHit, timeDesiredTrays].forEach((el) => el.addEventListener("input", computeTime));

  // ---------------- init ----------------
  addMachineRow();

  // артикулите се зареждат асинхронно от централните (публикувани) данни —
  // щом пристигнат, опресняваме падащите менюта с реалния каталог
  if (window.HelfiData) {
    window.HelfiData.fetchCentral().then(reloadArticles);
  }
})();
