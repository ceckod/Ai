// Helfi Plastics — общ часовник (час, дата, ден от седмицата)
// Включва се с едно <script src="js/clock.js"></script> на всяка страница
// и сам се вгражда като голяма, видима лента най-отгоре на страницата
// (преди всичко останало в <body>). Responsive: смалява се на телефон,
// но остава добре видим и там.
(function () {
  const MONTHS = [
    "януари", "февруари", "март", "април", "май", "юни",
    "юли", "август", "септември", "октомври", "ноември", "декември"
  ];
  const DAYS_FULL = [
    "неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"
  ];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function injectStyles() {
    if (document.getElementById("helfi-clock-style")) return;
    const style = document.createElement("style");
    style.id = "helfi-clock-style";
    style.textContent = `
      .helfi-clock-bar {
        width: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: clamp(8px, 2vw, 14px) 12px;
        background: linear-gradient(180deg, #131c2e, #0e1626);
        border-bottom: 1px solid #263252;
        font-family: "IBM Plex Mono", monospace;
        text-align: center;
      }
      .helfi-clock-bar .hc-time {
        color: #4fd1c5;
        font-weight: 700;
        font-size: clamp(1.6rem, 6vw, 2.6rem);
        letter-spacing: 0.03em;
        line-height: 1.1;
      }
      .helfi-clock-bar .hc-date {
        color: #c3cbdb;
        font-size: clamp(0.72rem, 2.4vw, 0.95rem);
        letter-spacing: 0.01em;
      }
    `;
    document.head.appendChild(style);
  }

  function buildClockEl() {
    const el = document.createElement("div");
    el.className = "helfi-clock-bar";
    el.id = "helfi-clock";
    el.innerHTML = `<span class="hc-time"></span><span class="hc-date"></span>`;
    return el;
  }

  function update(el) {
    const now = new Date();
    const timeEl = el.querySelector(".hc-time");
    const dateEl = el.querySelector(".hc-date");
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    dateEl.textContent =
      `${capitalize(DAYS_FULL[now.getDay()])}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}г.`;
  }

  function mount() {
    if (document.getElementById("helfi-clock")) return; // вече вграден
    injectStyles();
    const el = buildClockEl();
    document.body.insertBefore(el, document.body.firstChild);
    update(el);
    setInterval(() => update(el), 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
