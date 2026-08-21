// Helfi Plastics — централен слой за данни
//
// ЕДИНСТВЕНИЯТ модул, който знае ОТКЪДЕ идват данните за артикулите.
// Всички други страници/скриптове (Продукти, Калкулатор, Диспечер, Агент)
// минават през HelfiData и никога не четат/пишат localStorage директно.
//
// Как работи СЕГА:
//   - Ако е конфигуриран Firebase (виж js/firebase-config.js), данните се
//     четат и обновяват НА ЖИВО от Firestore — за всички, не само за
//     отключения админ. Статичният data/products-data.json се ползва само
//     като бърз първоначален "скелет" и офлайн резерв, докато Firestore се
//     свърже.
//   - Ако Firebase НЕ е конфигуриран, всичко работи както преди:
//     "централните" данни са само статичният файл data/products-data.json,
//     който администраторът публикува през _upload/ (виж README), а
//     редакциите на отключен админ се пазят като локална чернова
//     (localStorage) само на неговото устройство, докато не бъде публикувана.
(function (global) {
  if (global.__dbg) global.__dbg("data-store.js: файлът стартира изпълнение (най-горе)");
  const CENTRAL_URL = "data/products-data.json";
  const CACHE_KEY = "helfi_central_cache_v1"; // офлайн резервно копие на публикуваните данни
  const DRAFT_KEY = "helfi_admin_draft_v1"; // чернова на админа (само в неговия браузър)
  const ADMIN_FLAG_KEY = "helfi_admin_v1";

  // Скрит ПИН за админ режим. Само ти трябва да го знаеш.
  // За да го смениш: редактирай реда по-долу и публикувай новия js/data-store.js.
  const ADMIN_PIN = "4271";

  let centralArticles = null;
  let centralUpdatedAt = null;
  let fetchPromise = null;
  let liveSyncReceived = false; // вече дойдоха данни на живо от Firestore -> вече не презаписваме от статичния JSON
  const updateListeners = [];

  function notifyUpdate() {
    updateListeners.slice().forEach((cb) => {
      try {
        cb();
      } catch (e) {
        /* грешка в един слушател не бива да чупи останалите */
      }
    });
  }

  // Страници (Диспечер/Калкулатор/Продукти) могат да се абонират тук, за да
  // се преизчисляват автоматично щом дойдат нови данни от облака — без да е
  // нужно потребителят сам да презарежда страницата.
  function onCentralUpdate(cb) {
    if (typeof cb === "function") updateListeners.push(cb);
  }

  function safeParse(json, fallback) {
    try {
      const v = JSON.parse(json);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // ---------------- зареждане на публикуваните (централни) данни ----------------
  function fetchCentral() {
    if (fetchPromise) return fetchPromise;
    fetchPromise = fetch(CENTRAL_URL, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
      .then((data) => {
        // ако вече имаме по-нови данни на живо от Firestore, не ги връщай назад
        // с по-старото съдържание на статичния файл
        if (!liveSyncReceived) {
          centralArticles = (data && data.articles) || {};
          centralUpdatedAt = (data && data.updatedAt) || null;
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ articles: centralArticles, updatedAt: centralUpdatedAt }));
          } catch (e) {
            /* пълен localStorage — не е фатално */
          }
        }
        return centralArticlesSync();
      })
      .catch(() => {
        // офлайн / файлът не се зарежда -> последно кеширано копие в браузъра
        if (!liveSyncReceived) {
          const cached = safeParse(localStorage.getItem(CACHE_KEY), null);
          centralArticles = (cached && cached.articles) || {};
          centralUpdatedAt = (cached && cached.updatedAt) || null;
        }
        return centralArticlesSync();
      });
    return fetchPromise;
  }

  function centralArticlesSync() {
    return centralArticles || {};
  }

  // ---------------- Firestore на живо (за ВСИЧКИ — не само за админ) ----------------
  // Целта: обикновен посетител (READ ONLY) вижда същите данни на живо, каквито
  // въвежда админът — не само последната ПУБЛИКУВАНА статична версия.
  function ensureFirebaseApp() {
    const cfg = global.HELFI_FIREBASE_CONFIG;
    if (global.__dbg) global.__dbg("data-store.js: ensureFirebaseApp() стартира");
    if (!cfg || !cfg.apiKey || typeof firebase === "undefined") {
      if (global.__dbg) global.__dbg("data-store.js: ❌ прекратено рано — cfg=" + !!cfg + " typeof firebase=" + typeof firebase);
      return null;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        if (global.__dbg) global.__dbg("data-store.js: извиквам firebase.initializeApp(...)");
        firebase.initializeApp(cfg);
        if (global.__dbg) global.__dbg("data-store.js: initializeApp() ОК, извиквам firebase.firestore()");
        const db = firebase.firestore();
        if (global.__dbg) global.__dbg("data-store.js: firebase.firestore() ОК, извиквам db.settings(...)");
        // Някои мобилни мрежи/прокси чупят стандартната WebChannel/streaming
        // връзка на Firestore (записите увисват в локалния кеш и никога не
        // стигат до сървъра). Това трябва да се извика ПРЕДИ каквато и да е
        // друга Firestore операция в цялото приложение — затова е тук, на
        // мястото, където Firestore се докосва за пръв път.
        try {
          db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
          if (global.__dbg) global.__dbg("data-store.js: ✅ db.settings(experimentalAutoDetectLongPolling) приложени успешно");
        } catch (settingsErr) {
          if (global.__dbg) global.__dbg("data-store.js: ⚠ db.settings() хвърли: " + settingsErr.message);
        }
        return db;
      }
      if (global.__dbg) global.__dbg("data-store.js: firebase вече инициализиран другаде, apps.length=" + firebase.apps.length);
      return firebase.firestore();
    } catch (e) {
      if (global.__dbg) global.__dbg("data-store.js: ❌ ensureFirebaseApp() хвърли изключение: " + e.message);
      return null;
    }
  }

  function initLiveSync() {
    if (global.__dbg) global.__dbg("data-store.js: initLiveSync() стартира");
    const db = ensureFirebaseApp();
    if (!db) return;
    try {
      const ref = db.collection("helfi_state").doc("products");
      ref.onSnapshot(
        (snap) => {
          if (!snap.exists) return;
          const remote = snap.data();
          if (!remote || !remote.json) return;
          const parsed = safeParse(remote.json, null);
          if (!parsed || !parsed.articles) return;
          liveSyncReceived = true;
          centralArticles = parsed.articles;
          centralUpdatedAt = remote.updatedAt || null;
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ articles: centralArticles, updatedAt: centralUpdatedAt }));
          } catch (e) {
            /* пълен localStorage — не е фатално */
          }
          notifyUpdate();
        },
        () => {
          /* облакът не отговаря -> просто оставаме на статичния файл/кеша */
        }
      );
    } catch (e) {
      /* Firestore недостъпен -> оставаме на статичния файл/кеша */
    }
  }

  // ---------------- скрит админ режим ----------------
  function isAdmin() {
    return localStorage.getItem(ADMIN_FLAG_KEY) === "1";
  }

  function tryUnlockAdmin(pin) {
    if (String(pin) === ADMIN_PIN) {
      localStorage.setItem(ADMIN_FLAG_KEY, "1");
      return true;
    }
    return false;
  }

  function lockAdmin() {
    localStorage.removeItem(ADMIN_FLAG_KEY);
  }

  // ---------------- чернова на админа ----------------
  function loadDraft() {
    const d = safeParse(localStorage.getItem(DRAFT_KEY), null);
    return d && d.articles ? d.articles : null;
  }

  function hasDraft() {
    return !!localStorage.getItem(DRAFT_KEY);
  }

  function saveDraft(articles) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ articles, savedAt: Date.now() }));
  }

  function resetDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  // ---------------- текущо валидни данни за приложението ----------------
  // Обикновен посетител -> винаги публикуваните (централни) данни, READ ONLY.
  // Админ (отключен на това устройство) -> черновата му, ако има такава,
  // иначе копие на публикуваните данни (стартова точка за редакция).
  function currentArticles() {
    if (isAdmin()) {
      const draft = loadDraft();
      if (draft) return draft;
      return JSON.parse(JSON.stringify(centralArticlesSync()));
    }
    return centralArticlesSync();
  }

  function exportPublishedFile(articles) {
    const payload = { updatedAt: new Date().toISOString(), articles };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  global.HelfiData = {
    CENTRAL_URL,
    fetchCentral,
    centralArticlesSync,
    isAdmin,
    tryUnlockAdmin,
    lockAdmin,
    loadDraft,
    hasDraft,
    saveDraft,
    resetDraft,
    currentArticles,
    exportPublishedFile,
    onCentralUpdate,
  };

  // започваме зареждането веднага при включване на скрипта, за да е готово
  // докато потребителят стигне до частта, която ползва данните
  fetchCentral();
  initLiveSync(); // ако Firebase е конфигуриран — данните на живо изпреварват статичния файл
})(window);
