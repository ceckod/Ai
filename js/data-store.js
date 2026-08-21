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
  //
  // ЗАБЕЛЕЖКА: тук нарочно НЕ ползваме Firebase JS SDK (firebase.firestore()).
  // На някои мобилни мрежи SDK-то мълчаливо не успява да достигне сървъра —
  // записите остават заклещени в локалния кеш ("fromCache: true") завинаги,
  // без грешка. Вместо това ползваме директно Firestore REST API (обикновени
  // HTTPS GET/PATCH заявки), които минават през нормални HTTP заявки и не
  // разчитат на дълготраен streaming канал.
  function restBaseUrl() {
    const cfg = global.HELFI_FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || !cfg.projectId) return null;
    return (
      "https://firestore.googleapis.com/v1/projects/" +
      cfg.projectId +
      "/databases/(default)/documents/helfi_state/products?key=" +
      encodeURIComponent(cfg.apiKey)
    );
  }

  function restGetDoc() {
    const url = restBaseUrl();
    if (!url) return Promise.resolve(null);
    return fetch(url, { cache: "no-store" })
      .then((res) => {
        if (res.status === 404) return null; // документът още не съществува
        if (!res.ok) return Promise.reject(new Error("HTTP " + res.status));
        return res.json();
      })
      .then((doc) => {
        if (!doc || !doc.fields) return null;
        const jsonStr = doc.fields.json && doc.fields.json.stringValue;
        const updatedAt = doc.fields.updatedAt && Number(doc.fields.updatedAt.integerValue || doc.fields.updatedAt.doubleValue);
        if (!jsonStr) return null;
        return { json: jsonStr, updatedAt: updatedAt || null };
      });
  }

  function restSetDoc(articles) {
    const cfg = global.HELFI_FIREBASE_CONFIG;
    const url = restBaseUrl();
    if (!url) return Promise.reject(new Error("Firebase config липсва"));
    const updatedAt = Date.now();
    const body = {
      fields: {
        json: { stringValue: JSON.stringify({ articles }) },
        updatedAt: { integerValue: String(updatedAt) },
      },
    };
    return fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((res) => {
      if (!res.ok) {
        return res
          .json()
          .catch(() => ({}))
          .then((errBody) => {
            const msg = (errBody && errBody.error && errBody.error.message) || "HTTP " + res.status;
            throw new Error(msg);
          });
      }
      return { updatedAt };
    });
  }

  let livePollTimer = null;
  let lastKnownUpdatedAt = null;

  function pollOnce() {
    return restGetDoc()
      .then((remote) => {
        if (!remote) return;
        const parsed = safeParse(remote.json, null);
        if (!parsed || !parsed.articles) return;
        if (remote.updatedAt && remote.updatedAt === lastKnownUpdatedAt) return; // без промяна
        lastKnownUpdatedAt = remote.updatedAt;
        liveSyncReceived = true;
        centralArticles = parsed.articles;
        centralUpdatedAt = remote.updatedAt || null;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ articles: centralArticles, updatedAt: centralUpdatedAt }));
        } catch (e) {
          /* пълен localStorage — не е фатално */
        }
        notifyUpdate();
        if (global.__dbg) global.__dbg("data-store.js: REST poll → нови данни, updatedAt=" + remote.updatedAt);
      })
      .catch((e) => {
        if (global.__dbg) global.__dbg("data-store.js: ⚠ REST poll грешка: " + e.message);
      });
  }

  function initLiveSync() {
    if (global.__dbg) global.__dbg("data-store.js: initLiveSync() (REST режим) стартира");
    const cfg = global.HELFI_FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || !cfg.projectId) {
      if (global.__dbg) global.__dbg("data-store.js: ❌ Firebase config липсва — REST sync изключен");
      return;
    }
    pollOnce(); // веднага при старт
    if (livePollTimer) clearInterval(livePollTimer);
    livePollTimer = setInterval(pollOnce, 5000); // после на всеки 5 сек
  }

  // saveCentralRest се вика от products.js вместо старото pushToFirestore(),
  // за да не разчита на SDK-то, което е ненадеждно на някои мрежи.
  function saveCentralRest(articles) {
    if (global.__dbg) global.__dbg("data-store.js: saveCentralRest() — изпращам PATCH заявка");
    return restSetDoc(articles).then((res) => {
      lastKnownUpdatedAt = res.updatedAt;
      centralArticles = articles;
      centralUpdatedAt = res.updatedAt;
      liveSyncReceived = true;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ articles, updatedAt: res.updatedAt }));
      } catch (e) {
        /* пълен localStorage — не е фатално */
      }
      return res;
    });
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
    saveCentralRest,
  };

  // започваме зареждането веднага при включване на скрипта, за да е готово
  // докато потребителят стигне до частта, която ползва данните
  fetchCentral();
  initLiveSync(); // ако Firebase е конфигуриран — данните на живо изпреварват статичния файл
})(window);
