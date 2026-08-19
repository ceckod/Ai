// Helfi Plastics — обща логика (споделена между Калкулатор, Диспечер и Агента)
// Няма нужда да се включва в produkti.html — той си пази собствената логика.
(function (global) {
  const STORAGE_KEY = "helfi_products_v1";
  const DISPATCH_KEY = "helfi_dispatch_v1";

  // фиксиран график на смените: дневна 07:00–19:00, нощна 19:00–07:00
  const SHIFT_START_HOUR = 7;
  const SHIFT_LEN_HOURS = 12;

  function loadArticles() {
    // единствен източник на истина: HelfiData (виж js/data-store.js).
    // За обикновен посетител това са публикуваните (централни) данни,
    // READ ONLY. За отключен админ — неговата локална чернова.
    if (global.HelfiData) return global.HelfiData.currentArticles();
    // резервен вариант, ако data-store.js не е зареден на страницата
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return (state && state.articles) || {};
    } catch (e) {
      return {};
    }
  }

  function unitLabelFor(article, plural) {
    if (!article) return plural ? "тави" : "тава";
    const isTray = article.packagingUnit !== "stack";
    if (isTray) return plural ? "тави" : "тава";
    return plural ? "стекове/чували" : "стек/чувал";
  }

  // ефективен цикъл на артикула, по приоритет:
  // 1) ръчно зададен (useManualCycle)  2) замразен (самообучение)
  // 3) базово въведени матрица+удар    4) "умен" темп от дневните записи
  function effectiveCycle(article) {
    if (!article) return null;

    if (article.useManualCycle && article.matrixCavities > 0 && article.strokeSeconds > 0) {
      return {
        matrixCavities: article.matrixCavities,
        strokeSeconds: article.strokeSeconds,
        bottlesPerHour: (article.matrixCavities * 3600) / article.strokeSeconds,
        source: "manual",
      };
    }

    if (article.frozen && article.frozenCycleSeconds > 0 && article.matrixCavities > 0) {
      return {
        matrixCavities: article.matrixCavities,
        strokeSeconds: article.frozenCycleSeconds,
        bottlesPerHour: (article.matrixCavities * 3600) / article.frozenCycleSeconds,
        source: "frozen",
      };
    }

    if (article.matrixCavities > 0 && article.strokeSeconds > 0) {
      return {
        matrixCavities: article.matrixCavities,
        strokeSeconds: article.strokeSeconds,
        bottlesPerHour: (article.matrixCavities * 3600) / article.strokeSeconds,
        source: "baseline",
      };
    }

    // "умен" темп от дневните производствени записи (units/час), без матрица
    const usable = (article.logs || []).filter((e) => e.durationHours > 0 && e.units > 0);
    if (usable.length > 0) {
      const rates = usable.map((e) => {
        const bottles = article.bottlesPerUnit ? e.units * article.bottlesPerUnit : e.units;
        return bottles / e.durationHours;
      });
      const sorted = [...rates].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { matrixCavities: null, strokeSeconds: null, bottlesPerHour: value, source: "smart" };
    }

    return null;
  }

  // произведено количество за даден брой секунди работа на 1 машина
  function produceForSeconds(article, seconds) {
    const cyc = effectiveCycle(article);
    if (!cyc || !seconds || seconds <= 0) return null;

    let hits = null;
    let bottles;
    if (cyc.matrixCavities && cyc.strokeSeconds) {
      hits = Math.floor(seconds / cyc.strokeSeconds);
      bottles = hits * cyc.matrixCavities;
    } else {
      bottles = (cyc.bottlesPerHour * seconds) / 3600;
    }

    const bottlesPerUnit = article.bottlesPerUnit || null;
    const unitsPerPallet = article.unitsPerPallet || null;
    const trays = bottlesPerUnit ? Math.ceil(bottles / bottlesPerUnit) : null;
    const pallets = trays && unitsPerPallet ? Math.ceil(trays / unitsPerPallet) : null;

    return {
      hits,
      bottles: Math.round(bottles),
      trays,
      pallets,
      source: cyc.source,
      bottlesPerHour: cyc.bottlesPerHour,
    };
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // текущата (или зададена) смяна според фиксирания график 07:00–19:00 / 19:00–07:00
  function getShiftInfo(now) {
    now = now || new Date();
    const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const isDay = h >= SHIFT_START_HOUR && h < SHIFT_START_HOUR + SHIFT_LEN_HOURS;

    // datePart = календарната дата, към която принадлежи СТАРТА на текущата смяна
    const shiftDate = new Date(now);
    let type;
    if (isDay) {
      type = "day";
      shiftDate.setHours(SHIFT_START_HOUR, 0, 0, 0);
    } else {
      type = "night";
      if (h < SHIFT_START_HOUR) {
        // сме след полунощ, преди 07:00 -> нощната смяна е започнала предния ден в 19:00
        shiftDate.setDate(shiftDate.getDate() - 1);
      }
      shiftDate.setHours(SHIFT_START_HOUR + SHIFT_LEN_HOURS, 0, 0, 0);
    }

    const start = new Date(shiftDate);
    const end = new Date(start.getTime() + SHIFT_LEN_HOURS * 3600 * 1000);
    const secondsRemaining = Math.max(0, Math.round((end.getTime() - now.getTime()) / 1000));
    const secondsElapsed = Math.max(0, Math.round((now.getTime() - start.getTime()) / 1000));

    const dateKey = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const shiftKey = `${dateKey}-${type}`;

    return {
      type, // 'day' | 'night'
      label: type === "day" ? "дневна" : "нощна",
      start,
      end,
      endLabel: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
      secondsRemaining,
      secondsElapsed,
      dateKey,
      shiftKey,
    };
  }

  // ---------------- дневен диспечер: съхранение ----------------
  function loadDispatch() {
    try {
      return JSON.parse(localStorage.getItem(DISPATCH_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveDispatch(all) {
    localStorage.setItem(DISPATCH_KEY, JSON.stringify(all));
  }

  function getDispatchForShift(shiftKey) {
    const all = loadDispatch();
    return all[shiftKey] || { hours: SHIFT_LEN_HOURS, machines: [] };
  }

  function saveDispatchForShift(shiftKey, data) {
    const all = loadDispatch();
    all[shiftKey] = data;
    saveDispatch(all);
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return n.toLocaleString("bg-BG", { maximumFractionDigits: digits ?? 0 });
  }

  function fmtHM(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${h} ч ${m} мин`;
  }

  // ---------------- търсещо поле за артикул (истински dropdown, не нативен datalist) ----------------
  // Нативният <input list=""> datalist на телефон понякога рендерира зле
  // (хоризонтален скрол при дълъг текст). Затова тук е собствен, изцяло
  // контролиран dropdown: изглежда като старото падащо меню, но филтрира
  // докато пишеш, и скролва вертикално.
  function articleLabel(article) {
    return `${article.code} — ${article.name}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  let comboStylesInjected = false;
  function injectComboStyles() {
    if (comboStylesInjected || document.getElementById("helfi-combo-style")) return;
    comboStylesInjected = true;
    const style = document.createElement("style");
    style.id = "helfi-combo-style";
    style.textContent = `
      .helfi-combo { position: relative; width: 100%; display: block; }
      .helfi-combo input {
        width: 100%; box-sizing: border-box;
      }
      .helfi-combo-list {
        position: absolute; left: 0; right: 0; top: 100%; margin-top: 4px;
        max-height: 240px; overflow-y: auto; overflow-x: hidden;
        background: #1b2740; border: 1px solid #263252; border-radius: 8px;
        z-index: 10000; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      }
      /* когато полето е близо до долния край на екрана (напр. плаващия
         помощник), списъкът се отваря НАГОРЕ вместо надолу, за да не
         излиза извън видимата част на екрана */
      .helfi-combo-list.helfi-combo-up {
        top: auto; bottom: 100%; margin-top: 0; margin-bottom: 4px;
      }
      .helfi-combo-list[hidden] { display: none !important; }
      .helfi-combo-item {
        padding: 9px 10px; font-size: 0.82rem; color: #e7ecef; cursor: pointer;
        white-space: normal; word-break: break-word; border-bottom: 1px solid #263252;
      }
      .helfi-combo-item:last-child { border-bottom: none; }
      .helfi-combo-item:hover, .helfi-combo-item.active { background: rgba(79,209,197,0.15); }
      .helfi-combo-empty { padding: 9px 10px; font-size: 0.8rem; color: #8e9bb3; }
    `;
    document.head.appendChild(style);
  }

  // вгражда търсещо поле в контейнера (елемент, обикновено <span>/<div>).
  // opts: { articles, value(код по избор), placeholder, onSelect(code|null) }
  function mountArticleCombo(container, opts) {
    injectComboStyles();
    const articles = opts.articles || {};
    const codes = Object.keys(articles).sort((a, b) => a.localeCompare(b));
    const currentLabel = opts.value && articles[opts.value] ? articleLabel(articles[opts.value]) : "";

    container.classList.add("helfi-combo");
    container.innerHTML = `
      <input type="text" class="helfi-combo-input" autocomplete="off"
             value="${escapeHtml(currentLabel)}"
             placeholder="${escapeHtml(opts.placeholder || "Пиши код или име…")}" />
      <div class="helfi-combo-list${opts.openUp ? " helfi-combo-up" : ""}" hidden></div>
    `;
    const input = container.querySelector(".helfi-combo-input");
    const list = container.querySelector(".helfi-combo-list");

    function renderMatches(filterText) {
      const f = (filterText || "").trim().toLowerCase();
      const matches = codes
        .filter((code) => {
          if (!f) return true;
          const a = articles[code];
          return a.code.toLowerCase().includes(f) || a.name.toLowerCase().includes(f);
        })
        .slice(0, 60);

      if (matches.length === 0) {
        list.innerHTML = `<div class="helfi-combo-empty">Няма съвпадения</div>`;
      } else {
        list.innerHTML = matches
          .map((code) => `<div class="helfi-combo-item" data-code="${code}">${escapeHtml(articleLabel(articles[code]))}</div>`)
          .join("");
      }
      list.hidden = false;
    }

    input.addEventListener("focus", () => renderMatches(""));
    input.addEventListener("input", () => renderMatches(input.value));

    input.addEventListener("blur", () => {
      // забавяне, за да мине кликът върху елемент от списъка преди да се скрие
      setTimeout(() => {
        list.hidden = true;
        if (input.value.trim() === "") opts.onSelect(null);
      }, 180);
    });

    // mousedown вместо click, за да изпревари blur-а на инпута
    list.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".helfi-combo-item");
      if (!item) return;
      e.preventDefault();
      const code = item.dataset.code;
      input.value = articleLabel(articles[code]);
      list.hidden = true;
      opts.onSelect(code);
    });
  }

  global.HelfiCore = {
    STORAGE_KEY,
    DISPATCH_KEY,
    SHIFT_START_HOUR,
    SHIFT_LEN_HOURS,
    loadArticles,
    unitLabelFor,
    effectiveCycle,
    produceForSeconds,
    getShiftInfo,
    loadDispatch,
    saveDispatch,
    getDispatchForShift,
    saveDispatchForShift,
    fmtNum,
    fmtHM,
    articleLabel,
    mountArticleCombo,
  };
})(window);
