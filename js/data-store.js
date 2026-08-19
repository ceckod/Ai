// Helfi Plastics — централен слой за данни
//
// ЕДИНСТВЕНИЯТ модул, който знае ОТКЪДЕ идват данните за артикулите.
// Всички други страници/скриптове (Продукти, Калкулатор, Диспечер, Агент)
// минават през HelfiData и никога не четат/пишат localStorage директно.
//
// Как работи СЕГА (без външна база данни):
//   - "Централните" данни са статичен файл: data/products-data.json.
//     Него го качва/редактира само администраторът (виж produkti.html →
//     скрит админ режим), после го публикува през _upload/ (виж README).
//   - Всеки посетител зарежда този файл при отваряне на сайта — READ ONLY.
//   - Ако администраторът отключи скрития админ режим на своето устройство,
//     редакциите отиват в локална "чернова" (localStorage) на ТОВА
//     устройство, докато не бъде публикувана (изтеглен нов JSON → качен в
//     GitHub → сайтът се обновява). Черновата НЕ се вижда от други хора.
//
// Как ще стане В БЪДЕЩЕ с Firebase:
//   - Само fetchCentral() / saveDraft() / publish-частта тук се преработват
//     да четат/пишат от Firestore вместо от JSON файл. Нищо друго в
//     приложението не трябва да се пипа, защото всички страници минават
//     единствено през HelfiData.
(function (global) {
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
        centralArticles = (data && data.articles) || {};
        centralUpdatedAt = (data && data.updatedAt) || null;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ articles: centralArticles, updatedAt: centralUpdatedAt }));
        } catch (e) {
          /* пълен localStorage — не е фатално */
        }
        return centralArticles;
      })
      .catch(() => {
        // офлайн / файлът не се зарежда -> последно кеширано копие в браузъра
        const cached = safeParse(localStorage.getItem(CACHE_KEY), null);
        centralArticles = (cached && cached.articles) || {};
        centralUpdatedAt = (cached && cached.updatedAt) || null;
        return centralArticles;
      });
    return fetchPromise;
  }

  function centralArticlesSync() {
    return centralArticles || {};
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
  };

  // започваме зареждането веднага при включване на скрипта, за да е готово
  // докато потребителят стигне до частта, която ползва данните
  fetchCentral();
})(window);
