// Helfi Plastics — Помощник (правилово базиран, без платен AI/LLM, изцяло локално)
//
// Разпознава бутилка/артикул от свободен текст ("колко тави са ми нужни за
// Ава 425") и смята производството до края на ТЕКУЩАТА работна смяна
// (07:00-19:00 дневна / 19:00-07:00 нощна), по ефективния цикъл на артикула
// (замразен / ръчен / умен) от модул "Продукти".
//
// Използва се на две места:
//   - вграден директно на началната страница (index.html) — виж mountEmbedded()
//   - плаващо бутонче/панел на всички останали страници — виж mountFloating()
// И двете споделят една и съща логика за отговори по-долу.
(function () {
  // ---------------- готови въпроси с фиксиран отговор (лесно се добавят) ----------------
  // Добави нов ред тук по всяко време — няма нужда да пипаш друго.
  const STATIC_FAQ = [
    {
      q: "Как да вляза в админ режим?",
      a: "На страница „Продукти“ кликни 5 пъти бързо върху заглавието „Продукти“ и въведи админ ПИН-а. Само администраторът трябва да го знае.",
    },
    {
      q: "Защо данните в Диспечера не се запазват?",
      a: "Нарочно — Диспечерът и Калкулаторът са само за бърза проверка/симулация. Единствените данни, които се пазят централно, са каталогът с артикули в „Продукти“, и той се въвежда само от администратора.",
    },
    {
      q: "Откъде идва изчисленият цикъл на бутилка?",
      a: "От модул „Продукти“ — или ръчно зададен (матрица гнезда + време на удар), или замразен след достатъчно съвпадащи засичания, или изчислен автоматично по последните записи от производство.",
    },
  ];

  function boot() {
    const core = window.HelfiCore;
    if (!core) return; // helfi-core.js трябва да е зареден преди помощника

    injectStyles();

    // ---------------- споделена логика за отговори ----------------
    function answerFor(article) {
      const shift = core.getShiftInfo(new Date());
      const prod = core.produceForSeconds(article, shift.secondsRemaining);
      const where = ` за ${article.code} — ${article.name}`;
      const timeTxt = `${core.fmtHM(shift.secondsRemaining)} до края на ${shift.label}та смяна (край ${shift.endLabel})`;

      if (!prod) {
        return `Все още няма зададен цикъл${where}. Добави поне едно засичане на цикъла (сек между удар 1 и 2) в модул „Продукти“, за да мога да смятам.`;
      }

      const lines = [];
      lines.push(`Остават ${timeTxt}.`);
      const parts = [];
      if (prod.hits !== null) parts.push(`${core.fmtNum(prod.hits)} удара`);
      parts.push(`${core.fmtNum(prod.bottles)} бутилки`);
      if (prod.trays !== null) parts.push(`${core.fmtNum(prod.trays)} тави`);
      if (prod.pallets !== null) parts.push(`${core.fmtNum(prod.pallets)} палета`);
      const sourceTxt = { manual: "ръчно зададен цикъл", frozen: "замразен (потвърден) цикъл", baseline: "зададен цикъл", smart: "изчислен по записите темп" }[prod.source] || "";

      lines.push(`До края на смяната${where} ще произведеш ≈ ${parts.join(" · ")} (${sourceTxt}).`);
      return lines.join("\n");
    }

    function findArticleInText(text, articles) {
      const t = text.toLowerCase();
      let best = null;
      Object.keys(articles).forEach((code) => {
        const a = articles[code];
        const candidates = [a.code.toLowerCase(), a.name.toLowerCase()];
        candidates.forEach((c) => {
          if (c && t.includes(c) && (!best || c.length > best.len)) best = { a, len: c.length };
        });
      });
      return best ? best.a : null;
    }

    function findFaqAnswer(text) {
      const t = text.toLowerCase().trim();
      const hit = STATIC_FAQ.find((f) => f.q.toLowerCase() === t);
      return hit ? hit.a : null;
    }

    function handleQuery(text, ui) {
      const faq = findFaqAnswer(text);
      if (faq) {
        ui.addMsg(faq, "bot");
        return;
      }
      const articles = core.loadArticles();
      const article = findArticleInText(text, articles);
      if (article) {
        ui.addMsg(answerFor(article), "bot");
        return;
      }
      ui.addMsg(
        `Не успях да разпозная бутилка/артикул от въпроса. Избери ръчно от менюто по-долу.`,
        "bot"
      );
    }

    // ---------------- изграждане на самия чат интерфейс (споделено) ----------------
    // container: DOM елемент, в който да се вгради разговорът
    // opts.suggestions: масив от готови въпроси (текст) като бутончета
    // opts.greeting: съобщение от помощника при първо отваряне
    function buildChatUI(container, opts) {
      container.classList.add("helfi-chat");
      container.innerHTML = `
        <div class="helfi-chat-log" id="log"></div>
        <div class="helfi-chat-chips" id="chips"></div>
        <div class="helfi-chat-inputrow">
          <input type="text" id="input" placeholder="напр. колко тави за Ава 425 до края на смяната?" />
          <button id="send">Прати</button>
        </div>
        <div class="helfi-chat-fallback">
          Не пиша ли добре името? Избери артикул ръчно:
          <span id="articleWrap"></span>
          <button id="askBtn">Попитай с избрания</button>
        </div>
      `;
      const logEl = container.querySelector("#log");
      const chipsEl = container.querySelector("#chips");
      const inputEl = container.querySelector("#input");
      const sendBtn = container.querySelector("#send");
      const articleWrap = container.querySelector("#articleWrap");
      const askBtn = container.querySelector("#askBtn");
      let fallbackArticleCode = "";

      function addMsg(text, who) {
        const div = document.createElement("div");
        div.className = "helfi-chat-msg " + (who === "user" ? "user" : "bot");
        div.textContent = text;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
      }

      const ui = { addMsg };

      function ask(text) {
        addMsg(text, "user");
        handleQuery(text, ui);
      }

      function renderChips() {
        const list = opts.suggestions ? opts.suggestions() : [];
        chipsEl.innerHTML = "";
        list.forEach((q) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "helfi-chat-chip";
          chip.textContent = q;
          chip.addEventListener("click", () => ask(q));
          chipsEl.appendChild(chip);
        });
      }

      function refreshFallback() {
        const articles = core.loadArticles();
        core.mountArticleCombo(articleWrap, {
          articles,
          value: fallbackArticleCode,
          placeholder: "Пиши код или име (напр. 415 или премиум)…",
          openUp: !!opts.openUp,
          onSelect: (code) => {
            fallbackArticleCode = code || "";
          },
        });
      }

      sendBtn.addEventListener("click", () => {
        const text = inputEl.value.trim();
        if (!text) return;
        inputEl.value = "";
        ask(text);
      });
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendBtn.click();
      });
      askBtn.addEventListener("click", () => {
        const articles = core.loadArticles();
        const article = fallbackArticleCode ? articles[fallbackArticleCode] : null;
        if (!article) {
          addMsg("Избери артикул от менюто по-горе.", "bot");
          return;
        }
        addMsg(`Питане за: ${article.code} — ${article.name}`, "user");
        addMsg(answerFor(article), "bot");
      });

      renderChips();
      refreshFallback();
      if (opts.greeting) addMsg(opts.greeting, "bot");

      // артикулите се зареждат асинхронно — щом пристигнат, опресняваме
      if (window.HelfiData) {
        window.HelfiData.fetchCentral().then(() => {
          renderChips();
          refreshFallback();
        });
      }

      return { addMsg, refresh: () => { renderChips(); refreshFallback(); } };
    }

    function defaultSuggestions() {
      const articles = core.loadArticles();
      const codes = Object.keys(articles).sort((a, b) => a.localeCompare(b)).slice(0, 3);
      const dynamic = codes.map((c) => `Колко ще произведем за ${articles[c].name} до края на смяната?`);
      const staticQs = STATIC_FAQ.map((f) => f.q);
      return [...dynamic, ...staticQs].slice(0, 5);
    }

    // ---------------- вграден вариант (index.html) ----------------
    function mountEmbedded(container) {
      buildChatUI(container, {
        suggestions: defaultSuggestions,
        greeting:
          "Здравей! Питай ме напр. \"колко тави са ми нужни за Ава 425\" или избери готов въпрос отдолу. Ще смятам до края на текущата работна смяна.",
      });
    }

    // ---------------- плаващ вариант (fab + панел) ----------------
    function mountFloating() {
      const fab = document.createElement("button");
      fab.className = "helfi-agent-fab";
      fab.title = "Питай Помощника";
      fab.textContent = "🤖";
      document.body.appendChild(fab);

      const panel = document.createElement("div");
      panel.className = "helfi-agent-panel";
      panel.hidden = true;
      panel.innerHTML = `
        <div class="helfi-agent-head">
          <span>Помощник по производство</span>
          <button id="helfiAgentClose" title="Затвори">✕</button>
        </div>
        <div class="helfi-chat-host"></div>
      `;
      document.body.appendChild(panel);

      const closeBtn = panel.querySelector("#helfiAgentClose");
      const host = panel.querySelector(".helfi-chat-host");
      let chat = null;

      function toggle(open) {
        panel.hidden = open === undefined ? !panel.hidden : !open;
        if (!panel.hidden) {
          if (!chat) {
            chat = buildChatUI(host, {
              suggestions: defaultSuggestions,
              openUp: true,
              greeting:
                "Здравей! Питай ме напр. \"колко тави са ми нужни за Ава 425\" или избери готов въпрос отдолу.",
            });
          } else {
            chat.refresh();
          }
        }
      }
      fab.addEventListener("click", () => toggle());
      closeBtn.addEventListener("click", () => toggle(false));
    }

    // ---------------- вграждане на страницата ----------------
    const embedHost = document.getElementById("helfiAssistantEmbed");
    if (embedHost) {
      mountEmbedded(embedHost);
    } else {
      mountFloating();
    }
  }

  function injectStyles() {
    if (document.getElementById("helfi-agent-style")) return;
    const style = document.createElement("style");
    style.id = "helfi-agent-style";
    style.textContent = `
      .helfi-agent-fab {
        position: fixed; right: 16px; bottom: 16px; z-index: 9998;
        width: 52px; height: 52px; border-radius: 50%;
        background: #4fd1c5; color: #06201d; border: none;
        font-size: 1.3rem; cursor: pointer;
        box-shadow: 0 6px 18px rgba(0,0,0,0.4);
      }
      .helfi-agent-panel {
        position: fixed; right: 16px; bottom: 78px; z-index: 9998;
        width: min(360px, calc(100vw - 32px)); max-height: 72vh;
        background: #131c2e; border: 1px solid #263252; border-radius: 14px;
        display: flex; flex-direction: column;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        font-family: "Inter", sans-serif; color: #e7ecef;
      }
      /* КРИТИЧНО: без това правило "display: flex" по-горе печели над
         вграденото [hidden]{display:none} на браузъра, затова панелът
         никога реално не изчезва след клик на Х. */
      .helfi-agent-panel[hidden] { display: none !important; }
      .helfi-agent-head {
        padding: 12px 14px; border-bottom: 1px solid #263252;
        display: flex; justify-content: space-between; align-items: center;
        font-family: "Space Grotesk", sans-serif; font-weight: 600; font-size: 0.9rem;
        flex-shrink: 0;
      }
      .helfi-agent-head button {
        background: transparent; border: none; color: #8e9bb3; cursor: pointer; font-size: 1rem;
      }
      .helfi-chat-host, .helfi-chat {
        display: flex; flex-direction: column; min-height: 0; flex: 1;
      }
      .helfi-chat {
        background: #131c2e; border: 1px solid #263252; border-radius: 14px;
        font-family: "Inter", sans-serif; color: #e7ecef; overflow: hidden;
      }
      .helfi-chat-log {
        padding: 12px 14px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px;
        font-size: 0.86rem; min-height: 140px; max-height: 46vh;
      }
      .helfi-chat-msg { padding: 9px 12px; border-radius: 10px; line-height: 1.45; white-space: pre-line; max-width: 90%; }
      .helfi-chat-msg.bot { background: #1b2740; align-self: flex-start; }
      .helfi-chat-msg.user { background: rgba(79,209,197,0.15); color: #4fd1c5; align-self: flex-end; }
      .helfi-chat-chips {
        display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px;
      }
      .helfi-chat-chip {
        background: #1b2740; border: 1px solid #263252; color: #c3cbdb;
        border-radius: 999px; padding: 6px 12px; font-size: 0.76rem; cursor: pointer;
        text-align: left;
      }
      .helfi-chat-chip:hover { border-color: #4fd1c5; color: #4fd1c5; }
      .helfi-chat-inputrow { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #263252; }
      .helfi-chat-inputrow input {
        flex: 1; background: #1b2740; border: 1px solid #263252; color: #e7ecef;
        border-radius: 8px; padding: 9px 10px; font-size: 0.86rem; min-width: 0;
      }
      .helfi-chat-inputrow button {
        background: #4fd1c5; color: #06201d; border: none; border-radius: 8px;
        padding: 9px 14px; font-weight: 600; font-size: 0.82rem; cursor: pointer; white-space: nowrap;
      }
      .helfi-chat-fallback { padding: 10px 14px 14px; border-top: 1px solid #263252; font-size: 0.78rem; color: #8e9bb3; }
      .helfi-chat-fallback button {
        background: transparent; border: 1px solid #263252; color: #8e9bb3;
        border-radius: 8px; padding: 8px 12px; font-size: 0.78rem; cursor: pointer; width: 100%; margin-top: 8px;
      }
      .helfi-chat-fallback button:hover { border-color: #4fd1c5; color: #4fd1c5; }
      @media (max-width: 480px) {
        .helfi-agent-panel { right: 8px; bottom: 70px; }
        .helfi-agent-fab { right: 10px; bottom: 10px; }
        .helfi-chat-log { max-height: 40vh; }
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
