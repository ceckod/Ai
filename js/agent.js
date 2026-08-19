// Helfi Plastics — Агент (правилово базиран, без платен AI/LLM, изцяло локално)
//
// Разпознава машина + бутилка от свободен текст ("колко тави са ми нужни за
// машина А с бутилка Ава 425"), а ако не разпознае нещо - показва падащи
// менюта (машина от днешния диспечер + бутилка) като резервен вариант.
// Смята производството до края на ТЕКУЩАТА работна смяна (07:00-19:00
// дневна / 19:00-07:00 нощна), по ефективния цикъл на артикула (замразен /
// ръчен / умен) от модул "Продукти".
(function () {
  function boot() {
    const core = window.HelfiCore;
    if (!core) return; // helfi-core.js трябва да е зареден преди агента

    // ---------------- стилове ----------------
    if (!document.getElementById("helfi-agent-style")) {
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
          width: min(340px, calc(100vw - 32px)); max-height: 70vh;
          background: #131c2e; border: 1px solid #263252; border-radius: 14px;
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          font-family: "Inter", sans-serif; color: #e7ecef;
        }
        .helfi-agent-head {
          padding: 12px 14px; border-bottom: 1px solid #263252;
          display: flex; justify-content: space-between; align-items: center;
          font-family: "Space Grotesk", sans-serif; font-weight: 600; font-size: 0.9rem;
        }
        .helfi-agent-head button {
          background: transparent; border: none; color: #8e9bb3; cursor: pointer; font-size: 1rem;
        }
        .helfi-agent-log {
          padding: 10px 12px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px;
          font-size: 0.82rem; min-height: 120px;
        }
        .helfi-agent-msg { padding: 8px 10px; border-radius: 10px; line-height: 1.4; white-space: pre-line; }
        .helfi-agent-msg.bot { background: #1b2740; align-self: flex-start; }
        .helfi-agent-msg.user { background: rgba(79,209,197,0.15); color: #4fd1c5; align-self: flex-end; }
        .helfi-agent-inputrow { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid #263252; }
        .helfi-agent-inputrow input {
          flex: 1; background: #1b2740; border: 1px solid #263252; color: #e7ecef;
          border-radius: 8px; padding: 8px 10px; font-size: 0.82rem;
        }
        .helfi-agent-inputrow button {
          background: #4fd1c5; color: #06201d; border: none; border-radius: 8px;
          padding: 8px 12px; font-weight: 600; font-size: 0.8rem; cursor: pointer;
        }
        .helfi-agent-fallback { padding: 10px 12px; border-top: 1px solid #263252; font-size: 0.78rem; }
        .helfi-agent-fallback select, .helfi-agent-fallback input[type="text"] {
          width: 100%; background: #1b2740; border: 1px solid #263252; color: #e7ecef;
          border-radius: 8px; padding: 7px 8px; font-size: 0.78rem; margin-top: 4px; margin-bottom: 6px;
          box-sizing: border-box; font-family: "Inter", sans-serif;
        }
        .helfi-agent-fallback button {
          background: transparent; border: 1px solid #263252; color: #8e9bb3;
          border-radius: 8px; padding: 7px 12px; font-size: 0.78rem; cursor: pointer; width: 100%;
        }
        .helfi-agent-fallback button:hover { border-color: #4fd1c5; color: #4fd1c5; }
        @media (max-width: 480px) {
          .helfi-agent-panel { right: 8px; bottom: 70px; }
          .helfi-agent-fab { right: 10px; bottom: 10px; }
        }
      `;
      document.head.appendChild(style);
    }

    // ---------------- DOM ----------------
    const fab = document.createElement("button");
    fab.className = "helfi-agent-fab";
    fab.title = "Питай за производството";
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
      <div class="helfi-agent-log" id="helfiAgentLog"></div>
      <div class="helfi-agent-inputrow">
        <input type="text" id="helfiAgentInput" placeholder="напр. колко тави за машина А, Ава 425?" />
        <button id="helfiAgentSend">Прати</button>
      </div>
      <div class="helfi-agent-fallback">
        Не разпозна ли нещо? Избери ръчно:
        <select id="helfiAgentMachineSel"></select>
        <span id="helfiAgentArticleWrap"></span>
        <button id="helfiAgentAskBtn">Попитай с избраните</button>
      </div>
    `;
    document.body.appendChild(panel);

    const logEl = panel.querySelector("#helfiAgentLog");
    const inputEl = panel.querySelector("#helfiAgentInput");
    const sendBtn = panel.querySelector("#helfiAgentSend");
    const machineSel = panel.querySelector("#helfiAgentMachineSel");
    const articleWrap = panel.querySelector("#helfiAgentArticleWrap");
    const askBtn = panel.querySelector("#helfiAgentAskBtn");
    const closeBtn = panel.querySelector("#helfiAgentClose");
    let fallbackArticleCode = "";

    function addMsg(text, who) {
      const div = document.createElement("div");
      div.className = "helfi-agent-msg " + (who === "user" ? "user" : "bot");
      div.textContent = text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function toggle(open) {
      panel.hidden = open === undefined ? !panel.hidden : !open;
      if (!panel.hidden) {
        refreshFallbackOptions();
        if (!logEl.dataset.greeted) {
          addMsg(
            "Здравей! Питай ме напр. \"колко тави са ми нужни за машина А\" или \"колко бутилки за Ава 425 до края на смяната\". Ще смятам до края на текущата работна смяна.",
            "bot"
          );
          logEl.dataset.greeted = "1";
        }
        inputEl.focus();
      }
    }
    fab.addEventListener("click", () => toggle());
    closeBtn.addEventListener("click", () => toggle(false));

    // ---------------- данни ----------------
    function todaysDispatchMachines() {
      const shift = core.getShiftInfo(new Date());
      const d = core.getDispatchForShift(shift.shiftKey);
      return (d.machines || []).filter((m) => m.name);
    }

    function refreshFallbackOptions() {
      const machines = todaysDispatchMachines();
      machineSel.innerHTML =
        `<option value="">— без машина —</option>` +
        machines.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");

      const articles = core.loadArticles();
      core.mountArticleCombo(articleWrap, {
        articles,
        value: fallbackArticleCode,
        placeholder: "Пиши код или име (напр. 415 или премиум)…",
        onSelect: (code) => {
          fallbackArticleCode = code || "";
        },
      });
    }

    // ---------------- разпознаване на текст ----------------
    function findMachineInText(text, machines) {
      const t = text.toLowerCase();
      let best = null;
      machines.forEach((m) => {
        const name = (m.name || "").toLowerCase().trim();
        if (!name) return;
        if (t.includes(name) && (!best || name.length > best.name.length)) best = { m, name };
      });
      return best ? best.m : null;
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

    function wantsBottles(text) {
      return /бутил/i.test(text) && !/тав/i.test(text);
    }
    function wantsTrays(text) {
      return /тав/i.test(text) && !/бутил/i.test(text);
    }

    // ---------------- отговор ----------------
    function answerFor(article, machineLabel) {
      const shift = core.getShiftInfo(new Date());
      const prod = core.produceForSeconds(article, shift.secondsRemaining);
      const where = machineLabel ? ` за ${machineLabel} (${article.code} — ${article.name})` : ` за ${article.code} — ${article.name}`;
      const timeTxt = `${core.fmtHM(shift.secondsRemaining)} до края на ${shift.label}та смяна (край ${shift.endLabel})`;

      if (!prod) {
        return `Все още няма зададен цикъл${where}. Добави поне едно засичане на цикъла (сек между удар 1 и 2) в модул „Продукти", за да мога да смятам.`;
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
      lines.push(`Ключовото число: ${core.fmtNum(prod.bottles)} произведени бутилки до края на смяната.`);
      return lines.join("\n");
    }

    function handleQuery(text) {
      const machines = todaysDispatchMachines();
      const articles = core.loadArticles();

      const machine = findMachineInText(text, machines);
      let article = findArticleInText(text, articles);

      if (!article && machine && machine.articleCode) {
        article = articles[machine.articleCode];
      }

      if (article) {
        addMsg(answerFor(article, machine ? machine.name : null), "bot");
        return;
      }

      if (machine && !machine.articleCode) {
        addMsg(
          `За ${machine.name} няма зададена бутилка в днешния диспечер. Избери бутилка от менюто по-долу или задай обвързването в „Диспечер".`,
          "bot"
        );
        return;
      }

      addMsg(
        `Не успях да разпозная машина и/или бутилка от въпроса. Избери ръчно от менютата по-долу и натисни „Попитай с избраните".`,
        "bot"
      );
    }

    sendBtn.addEventListener("click", () => {
      const text = inputEl.value.trim();
      if (!text) return;
      addMsg(text, "user");
      inputEl.value = "";
      handleQuery(text);
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendBtn.click();
    });

    askBtn.addEventListener("click", () => {
      const machines = todaysDispatchMachines();
      const articles = core.loadArticles();
      const machine = machines.find((m) => m.id === machineSel.value) || null;
      let article = fallbackArticleCode ? articles[fallbackArticleCode] : null;
      if (!article && machine && machine.articleCode) article = articles[machine.articleCode];

      const label = [machine ? machine.name : null, article ? `${article.code} — ${article.name}` : null].filter(Boolean).join(" · ");
      addMsg(label ? `Питане за: ${label}` : "Питане с избраните опции", "user");

      if (!article) {
        addMsg("Избери поне бутилка (или машина с вече зададена бутилка в диспечера).", "bot");
        return;
      }
      addMsg(answerFor(article, machine ? machine.name : null), "bot");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
