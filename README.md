# Helfi Plastics — приложение

Скелет за уеб приложението на Helfi Plastics. Инсталируем е като PWA и има
готова верига за генериране на Android APK от самия сайт (TWA — Trusted Web
Activity), без потребителят да отваря браузър.

Ще расте постепенно — модул по модул (виж секцията "Модули" в `index.html`).

## Структура

```
index.html              главна страница
css/style.css            стилове
js/app.js                логика + регистрация на service worker
manifest.json             PWA манифест (име, икони, цветове)
service-worker.js         offline кеш
icons/                    икони за PWA/Android
.well-known/assetlinks.json  верификация за Android TWA (виж по-долу)
twa-manifest.json         конфигурация за Bubblewrap (Android build)
.github/workflows/
  deploy-pages.yml         автоматичен deploy към GitHub Pages при push
  build-apk.yml            генерира .apk файл (ръчно или при release)
```

## 1. Първоначален setup

1. Създай ново GitHub repo (напр. `helfi-app`) и качи тези файлове.
2. В repo → **Settings → Pages** → Source: избери **GitHub Actions**.
3. При push към `main` сайтът автоматично се качва на:
   `https://YOUR-USERNAME.github.io/helfi-app/`

## 2. Постепенно ъпгрейдване

Всеки нов push към `main` автоматично обновява живия сайт (workflow-ът
`deploy-pages.yml`). Можеш да добавяш модули един по един в `index.html` /
`css/style.css` / `js/app.js`, без да чупиш останалото.

## 3. Android приложение (APK)

Това изисква **една еднократна ръчна стъпка** — генериране на подписващ
ключ (keystore). Без нея всеки APK build ще излиза с различен подпис и
Android ще го третира като различно приложение всеки път.

### Еднократно, локално на твоя компютър:

```bash
npm install -g @bubblewrap/cli
keytool -genkey -v -keystore android.keystore -alias helfi-key \
  -keyalg RSA -keysize 2048 -validity 10000
```

Ще те пита за парола на keystore-а и за данни (име, организация) — просто
попълни каквото поискаш.

### После:

1. Отвори `twa-manifest.json` и замени `YOUR-USERNAME` с истинското ти
   GitHub потребителско име (2 места).
2. Вземи SHA256 подписа на ключа:
   ```bash
   keytool -list -v -keystore android.keystore -alias helfi-key
   ```
   Копирай стойността до `SHA256:` и я сложи в
   `.well-known/assetlinks.json` (замества `FILL_IN_AFTER_CREATING...`).
3. В GitHub repo → **Settings → Secrets and variables → Actions** добави:
   - `ANDROID_KEYSTORE_BASE64` — резултат от `base64 -i android.keystore`
   - `ANDROID_KEYSTORE_PASSWORD` — паролата, която зададе
   - `ANDROID_KEY_PASSWORD` — обикновено същата парола
4. Push-ни промените (assetlinks.json + twa-manifest.json).
5. Пусни workflow-а `Build Android APK (TWA)` ръчно (Actions → Run
   workflow), или той ще се пусне автоматично при публикуване на GitHub
   Release.
6. Готовият `.apk` се появява като артефакт на завършения workflow run —
   свали го и го инсталирай на телефон (или го публикувай в Google Play
   по-късно).

От този момент нататък: обновяваш сайта → при нужда пускаш build-apk
workflow-а → новият APK automатично отваря обновения сайт, но пак изглежда
и се държи като нормално Android приложение.

## Бележка

Икониите (`icons/icon-*.png`) са временен placeholder (бутилка) — смени ги
с истинско лого на Helfi Plastics, когато е готово.
