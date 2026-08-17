// Helfi Plastics — общ часовник (час, дата, година, ден от седмицата)
// Включва се с едно <script src="js/clock.js"></script> на всяка страница
// (стара или нова) и сам се вгражда в менюто/хедъра на страницата.
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
      .helfi-clock {
        display: inline-flex;
        align-items: baseline;
        gap: 10px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.78rem;
        color: #8e9bb3;
        border: 1px solid #263252;
        border-radius: 999px;
        padding: 6px 14px;
        background: #131c2e;
        white-space: nowrap;
        line-height: 1.3;
      }
      .helfi-clock .hc-time {
        color: #4fd1c5;
        font-weight: 600;
        font-size: 0.88rem;
        letter-spacing: 0.02em;
      }
      .helfi-clock .hc-date {
        color: #e7ecef;
      }
      .helfi-clock-fixed {
        position: fixed;
        top: 12px;
        right: 14px;
        z-index: 9999;
        box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      }
      @media (max-width: 640px) {
        .helfi-clock {
          font-size: 0.66rem;
          padding: 5px 10px;
          gap: 6px;
        }
        .helfi-clock .hc-time { font-size: 0.74rem; }
        .helfi-clock-fixed { top: 8px; right: 8px; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildClockEl() {
    const el = document.createElement("div");
    el.className = "helfi-clock";
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

  function findHost() {
    // Работи с всяко съществуващо меню/хедър в сайта (старо или ново),
    // без да е нужна конкретна класова структура.
    return (
      document.querySelector(".site-header") ||
      document.querySelector("header.page") ||
      document.querySelector("header nav") ||
      document.querySelector("header") ||
      document.querySelector(".tabs")
    );
  }

  function mount() {
    if (document.getElementById("helfi-clock")) return; // вече вграден
    injectStyles();
    const el = buildClockEl();
    const host = findHost();

    if (host) {
      host.appendChild(el);
    } else {
      el.classList.add("helfi-clock-fixed");
      document.body.appendChild(el);
    }

    update(el);
    setInterval(() => update(el), 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
