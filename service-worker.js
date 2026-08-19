// Helfi Plastics — service worker
// Network-first: винаги пробва прясна версия от мрежата първо, пази копие
// в кеша само като резерва за офлайн режим. Така ъпдейтите на js/html
// файловете се виждат веднага, вместо телефонът да "залепне" за стара
// кеширана версия (напр. стар бъгав js/agent.js).

const CACHE_NAME = "helfi-cache-v4";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/smeni.html",
  "/css/style.css",
  "/js/app.js",
  "/js/data-store.js",
  "/data/products-data.json",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("/index.html"))
      )
  );
});
