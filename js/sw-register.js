// Helfi Plastics — регистрация на service worker (на ВСЯКА страница, не
// само index.html), за да не остава някоя страница на стара кеширана
// версия само защото е отворена директно (пряк път на телефона и т.н.).
//
// При активиране на нова версия на service worker-а презарежда
// страницата автоматично ЕДИН път, за да не се налага ръчно чистене на
// кеша от потребителя.

if ("serviceWorker" in navigator) {
  let reg = null;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => {
        reg = registration;
      })
      .catch((err) => console.error("Service worker registration failed:", err));
  });

  let reloadedOnce = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedOnce) return;
    reloadedOnce = true;
    window.location.reload();
  });

  // Браузърът по подразбиране проверява за нова версия само при отваряне
  // (навигация) на страницата — ако приложението стои отворено/на фон
  // (напр. TWA на телефон), новата версия не се засича, докато не се
  // затвори и отвори ръчно. Затова проверяваме сами: периодично, и всеки
  // път щом приложението се върне на преден план — така ъпдейтите се
  // засичат и прилагат (виж controllerchange по-горе) БЕЗ ръчно
  // затваряне/отваряне.
  function checkForUpdate() {
    if (reg) reg.update().catch(() => {});
  }
  setInterval(checkForUpdate, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  window.addEventListener("focus", checkForUpdate);
}
