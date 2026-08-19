// Helfi Plastics — регистрация на service worker (на ВСЯКА страница, не
// само index.html), за да не остава някоя страница на стара кеширана
// версия само защото е отворена директно (пряк път на телефона и т.н.).
//
// При активиране на нова версия на service worker-а презарежда
// страницата автоматично ЕДИН път, за да не се налага ръчно чистене на
// кеша от потребителя.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => console.error("Service worker registration failed:", err));
  });

  let reloadedOnce = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedOnce) return;
    reloadedOnce = true;
    window.location.reload();
  });
}
