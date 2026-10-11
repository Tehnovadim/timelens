"use strict";
const I18n = window.TimeLensI18n;
const t = I18n.t;
const $ = selector => document.querySelector(selector);
const today = new Date().getFullYear();
const state = {
  settings: {
    years: [1900, 1950, 1990],
    grid: true,
    motion: true
  },
  config: {
    configured: false,
    googleClientId: ""
  },
  original: null,
  location: null,
  locationBusy: false,
  locationRequest: 0,
  record: null,
  stream: null,
  cameraBusy: false,
  busy: false,
  jobId: null,
  index: 3,
  comparing: false,
  playing: null,
  user: null,
  guestRecords: [],
  toastTimer: null
};
try {
  Object.assign(state.settings, JSON.parse(localStorage.getItem("timelens-settings") || "{}"));
} catch {}
if (!Array.isArray(state.settings.years) || state.settings.years.length !== 3 || !state.settings.years.every(y => Number.isInteger(y) && y >= 1000 && y < today) || new Set(state.settings.years).size !== 3) state.settings.years = [1900, 1950, 1990];
state.settings.years.sort((a, b) => a - b);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
function notify(message, duration = 5500) {
  clearTimeout(state.toastTimer);
  $("#toast").textContent = I18n.resolve(message);
  $("#toast").hidden = false;
  state.toastTimer = setTimeout(() => $("#toast").hidden = true, duration);
}
function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = I18n.resolve(text);
  if (className) node.className = className;
  return node;
}
function romanYear(year) {
  let value = Number(year), result = "";
  for (const [number, label] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (value >= number) {
    result += label;
    value -= number;
  }
  return result;
}
function syncPresentation() {
  document.body.classList.toggle("has-photo", !!state.original || !!state.stream);
  document.body.classList.toggle("has-result", !!state.record);
  $("#result-album").hidden = !state.record;
  $("#scene-place").textContent = state.record ? recordText(state.record, "place") : state.original ? t("Ваш исходный снимок") : state.stream ? t("Камера открыта") : t("Ваше окно в прошлое");
}
function recordText(item, key) { return I18n.resolve(item?.translations?.[I18n.language]?.[key] || item?.[key] || ""); }
function originalLabel(record) { return record.originalYear ? t("Оригинал ({0})", record.originalYear) : t("Сейчас"); }
function renderResultCards(record) {
  const container = $("#result-cards");
  container.replaceChildren();
  [...record.frames, {
    year: record.originalYear || today,
    image: record.original,
    original: true
  }].forEach((frame, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-card" + (!frame.image ? " unavailable" : "");
    button.setAttribute("aria-label", t("Карточка: {0}", frame.original ? originalLabel(record) : frame.year));
    const img = new Image();
    img.loading = "lazy";
    img.decoding = "async";
    img.src = frame.image || record.original;
    img.alt = frame.original ? t("Исходный снимок") : !frame.image ? t("Реконструкция отсутствует, показан оригинал") : record.demo ? t("Иллюстрация эпохи {0}", frame.year) : t("Реконструкция ИИ, {0}", frame.year);
    button.append(img, textNode("strong", frame.original ? originalLabel(record) : String(frame.year)), textNode("small", frame.original ? t("Исходный снимок") : frame.status === "pending" ? t("Создаётся…") : !frame.image ? t("Нет реконструкции") : record.demo ? t("Иллюстрация · демо") : t("Реконструкция ИИ")));
    button.onclick = () => {
      stopPlayback();
      showFrame(index);
      $("#viewfinder").closest(".camera-shell").scrollIntoView({
        block: "start",
        behavior: state.settings.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches ? "smooth" : "instant"
      });
    };
    container.append(button);
  });
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-TimeLens-Language": I18n.language,
      ...options.headers
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || t("Не удалось выполнить запрос."));
  return data;
}
function applySettings() {
  $("#camera-grid").hidden = !state.settings.grid || !!state.record;
  document.body.classList.toggle("no-motion", !state.settings.motion);
  renderEpochs();
}
function renderEpochs() {
  $("#epoch-cards").replaceChildren();
  const years = state.record ? state.record.years : state.settings.years;
  years.forEach((year, index) => {
    const button = document.createElement("button");
    button.className = "epoch-card" + (state.record && state.index === index ? " active" : "");
    button.type = "button";
    button.disabled = state.busy && !state.record;
    button.append(textNode("span", [t("Первая эпоха"), t("Вторая эпоха"), t("Третья эпоха")][index], "epoch-label"), textNode("strong", String(year)));
    button.setAttribute("aria-label", t("Эпоха {0}", year));
    button.onclick = () => state.record ? showFrame(index) : openSettings();
    $("#epoch-cards").append(button);
  });
}
function svgScene(year = today) {
  const old = year < 1940, middle = year >= 1940 && year < 1980;
  const windows = (x, y, w, h, cols, rows, color = "#596768") => Array.from({
    length: cols * rows
  }, (_, i) => {
    const xx = x + i % cols * w, yy = y + Math.floor(i / cols) * h;
    return `<rect x="${xx}" y="${yy}" width="${w * .48}" height="${h * .55}" rx="2" fill="${color}"/><path d="M${xx + w * .24} ${yy}v${h * .55}M${xx} ${yy + h * .28}h${w * .48}" stroke="#cabba0" stroke-width="3"/><rect x="${xx - 3}" y="${yy + h * .55}" width="${w * .48 + 6}" height="4" fill="#b8aa8f"/>`;
  }).join("");
  const vehicle = old ? `<g transform="translate(590,510)"><ellipse cx="70" cy="36" rx="86" ry="10" fill="#464a3b" opacity=".25"/><path d="m0 18 10-30h75l13 30Z" fill="#4c5549"/><path d="M-3 18h109v17H-3z" fill="#6d6350"/><circle cx="16" cy="34" r="13" fill="#363c36"/><circle cx="84" cy="34" r="13" fill="#363c36"/><circle cx="16" cy="34" r="9" fill="#9d8c69"/><circle cx="84" cy="34" r="9" fill="#9d8c69"/>${windows(19, -7, 22, 28, 3, 1, "#b4b5a0")}</g>` : `<g transform="translate(581,515)"><ellipse cx="78" cy="30" rx="88" ry="12" fill="#464a3b" opacity=".3"/><path d="m0 8 20-22h65l25 22 25 4v24H0Z" fill="${middle ? "#9a9f89" : "#d5d3c6"}"/><path d="m26-10-12 18h42v-18Z" fill="#617274"/><path d="M61-10v18h42L82-10Z" fill="#617274"/><circle cx="25" cy="31" r="12" fill="#343e3c"/><circle cx="111" cy="31" r="12" fill="#343e3c"/><circle cx="25" cy="31" r="6" fill="#b5b8a6"/><circle cx="111" cy="31" r="6" fill="#b5b8a6"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 780"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#a4bab6"/><stop offset="1" stop-color="#d6d7bf"/></linearGradient><linearGradient id="road" x2="0" y2="1"><stop stop-color="#b1afa0"/><stop offset="1" stop-color="#8c978c"/></linearGradient><linearGradient id="wall"><stop stop-color="#b5aa90"/><stop offset="1" stop-color="#d8cdb0"/></linearGradient><linearGradient id="wall2"><stop stop-color="#dac6a2"/><stop offset="1" stop-color="#b9b69e"/></linearGradient><pattern id="stones" width="54" height="24" patternUnits="userSpaceOnUse"><path d="M0 0h54M0 24h54M27 0v24" stroke="#3b4b4319" fill="none"/></pattern><pattern id="brick" width="38" height="18" patternUnits="userSpaceOnUse"><path d="M0 0h38M19 0v18" stroke="#706b5320" fill="none"/></pattern><filter id="texture"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".09"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>
  <rect width="1200" height="780" fill="url(#sky)"/><path d="M0 95Q160 30 280 103T560 116Q810 52 960 104T1250 120V175H0Z" fill="#e0e0c8" opacity=".31"/><g fill="#b0b49e"><path d="M350 280h60v240h-60ZM395 226h48v292h-48ZM425 299h55v220h-55ZM732 257h72v258h-72ZM805 297h90v215h-90Z"/><path d="m390 226 29-20 30 20ZM742 257l32-25 32 25Z"/></g>
  <path d="m490 480 181-10L1100 780H40Z" fill="url(#road)"/><path d="m490 480 181-10L1100 780H40Z" fill="url(#stones)"/><path d="M0 780 492 477l-52-2L0 676Zm1200 0L671 470l43 5 486 238Z" fill="#c4c0aa"/><path d="M0 692 483 477M1200 729 682 472" stroke="#828d7c" stroke-width="4"/>
  <g filter="url(#texture)"><path d="M0 76 294 156l145 195v141L0 673Z" fill="url(#wall)"/><path d="M0 67 297 146l143 197-14 5-138-185L0 88Z" fill="#6d766b"/><path d="M0 96 288 169v385L0 674Z" fill="url(#brick)"/><path d="M294 164 439 349v143L294 554Z" fill="#9c9e88"/><path d="M0 199 294 241M0 312 294 327M0 421l294-9M0 540l294-30" stroke="#d7cbaa" stroke-width="12"/>
  ${windows(31, 114, 63, 106, 4, 4)}<path d="M30 640v-86h50v67M148 602v-74h53v52" fill="#51615b"/><g stroke="#988d71" stroke-width="4"><path d="M38 553v77M58 550v70M163 530v67M183 530v53"/></g><path d="M-10 478 290 466v27L0 529Z" fill="${old ? "#68775b" : "#a08063"}"/><path d="M0 492 290 476" stroke="#d9caae" stroke-width="4"/>
  <path d="M1200 120 911 210 774 347v143l426 265Z" fill="url(#wall2)"/><path d="m1200 110-291 90-141 144 12 7 138-137 282-88Z" fill="#687065"/><path d="M911 214 774 350v143l137 87Z" fill="#a59f84"/><path d="M1200 258 916 316M1200 401l-286 3M1200 551 913 496" stroke="#d9ccb0" stroke-width="11"/>${windows(957, 250, 73, 127, 3, 3, "#657476")}<path d="M953 612v-70h59v108M1090 693V578h68v143" fill="#52695f"/><path d="m918 511 282 83v33l-282-97Z" fill="${old ? "#798574" : "#c39577"}"/><path d="m924 525 276 83" stroke="#e7d6b7" stroke-width="3"/>
  <path d="M473 287h239v210H473Z" fill="#d0c7aa"/><rect x="473" y="287" width="239" height="210" fill="url(#brick)"/><path d="M460 287 591 211l135 76Z" fill="#7b8473"/><path d="m460 285 131-69 135 69" fill="none" stroke="#c5c6a9" stroke-width="7"/><path d="M530 211h123l-10-23H540Z" fill="#aead91"/><path d="M545 187v-72h93v72Z" fill="#ccc5a9"/><path d="m537 115 54-62 55 62Z" fill="#768173"/><rect x="582" y="35" width="18" height="23" fill="#818978"/><circle cx="592" cy="147" r="23" fill="#e0dac2" stroke="#a39f86" stroke-width="3"/><path d="M592 130v17l10 6" stroke="#64736a" stroke-width="2" fill="none"/>${windows(494, 314, 49, 70, 4, 2, "#68766b")}<path d="M568 497v-59a24 24 0 0 1 48 0v59Z" fill="#4c635b"/><path d="M462 496h264v10H462Z" fill="#b3b49d"/>
  <path d="M104 704 561 507l-20 5L0 780h372L623 519Z" fill="#5c6d5a" opacity=".12"/>${vehicle}
  <g fill="#536c55"><path d="M1080 782v-330h14v330Z" fill="#627a60"/><path d="M1080 475q-73-92-177-11 117-14 177 11ZM1082 463q-41-144-139-112 96 40 139 112ZM1086 457q15-125 98-159-35 89-98 159ZM1092 463q107-93 162-17-81-9-162 17ZM1090 453q-9-122 28-150 25 95-28 150Z"/><path d="M55 780V402h12v378Z" fill="#617456"/><path d="M59 430q-42-115-140-103 77 55 140 103ZM63 421q11-137 67-171 2 113-67 171ZM66 430q65-128 140-72-95 39-140 72ZM56 423Q-20 272 32 262q30 65 24 161Z"/></g>
  ${old ? `<path d="M354 625 572 508M750 508l237 181M260 686l312-178M750 508l338 235" stroke="#727b66" stroke-width="3" opacity=".5"/>` : `<path d="m561 577-48 24m-66 33-68 34m-85 42-75 36" stroke="#d7d6bf" stroke-width="5" opacity=".5"/>`}
  <rect width="1200" height="780" fill="#8b9d78" opacity=".05"/>
  </g></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function stopCamera() {
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
  $("#camera-video").srcObject = null;
  $("#camera-video").hidden = true;
  $("#scene-image").hidden = false;
  $("#shutter-button").classList.remove("capture");
  $("#shutter-button").setAttribute("aria-label", t("Открыть камеру"));
  syncPresentation();
}
async function openCamera() {
  if (state.busy || state.cameraBusy) return;
  if (state.stream) {
    capturePhoto();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    notify(t("Камера доступна на localhost или по HTTPS. Можно загрузить фотографию из галереи."));
    return;
  }
  state.cameraBusy = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: "environment"
        },
        width: {
          ideal: 1920
        },
        height: {
          ideal: 1080
        }
      },
      audio: false
    });
    stopCamera();
    state.stream = stream;
    const video = $("#camera-video");
    video.srcObject = stream;
    await video.play();
    video.hidden = false;
    $("#scene-image").hidden = true;
    $("#empty-caption").hidden = true;
    $("#year-overlay").hidden = true;
    $("#timeline-section").hidden = true;
    $("#frame-corners").hidden = false;
    $("#shutter-button").classList.add("capture");
    $("#shutter-button").setAttribute("aria-label", t("Сделать фотографию"));
    $("#mode-badge").textContent = t("КАМЕРА ВКЛЮЧЕНА");
    notify(t("Наведите камеру и нажмите круглую кнопку ещё раз."));
  } catch (error) {
    stopCamera();
    notify(error.name === "NotAllowedError" ? t("Доступ к камере не разрешён. Загрузите фото или разрешите камеру в настройках браузера.") : t("Не удалось включить камеру. Попробуйте загрузить фотографию."));
  } finally {
    state.cameraBusy = false;
  }
}
function canvasPhoto(image, width, height) {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .9);
}
function capturePhoto() {
  const video = $("#camera-video");
  if (!video.videoWidth) {
    notify(t("Камера ещё готовится."));
    return;
  }
  const photo = canvasPhoto(video, video.videoWidth, video.videoHeight);
  stopCamera();
  loadPhoto(photo);
  requestLocation();
}
function renderLocation() {
  const box = $("#location-status");
  box.classList.toggle("located", !!state.location);
  $("#location-button").disabled = state.locationBusy || state.busy;
  box.textContent = state.locationBusy ? t("Определяем местоположение…") : state.location ? `${state.location.source === 'photo' ? t("GPS из фотографии") : t("Геолокация устройства")} · ${state.location.latitude.toFixed(5)}, ${state.location.longitude.toFixed(5)}` : state.original ? t("В этом фото нет GPS-координат") : t("Определится из фото или геолокации");
  $("#location-button").textContent = state.location ? t("Обновить геолокацию") : state.original ? t("Я на месте съёмки · разрешить GPS") : t("Разрешить геолокацию");
  $("#location-help").textContent = state.location ? `${state.location.source === 'photo' ? t("Используем место, записанное камерой в файле.") : t("Используем ваше текущее местоположение.")}${state.location.accuracy ? t(" Точность — около {0} м.", Math.round(state.location.accuracy)) : ''}` : state.original ? t("Для фото без GPS разрешите геолокацию, если вы сейчас на месте съёмки.") : t("GPS из фотографии имеет приоритет. Название места вводить не нужно.");
  if (!state.record) $("#generate-button").disabled = state.busy || !state.original || !state.location;
  $("#data-notice").hidden = !state.original || !!state.record;
}
async function requestLocation() {
  if (state.busy || state.locationBusy) return;
  if (!navigator.geolocation) {
    notify(t("Геолокация недоступна. Загрузите фото с GPS-меткой."));
    return;
  }
  const token = ++state.locationRequest;
  state.locationBusy = true;
  renderLocation();
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }));
    if (token !== state.locationRequest) return;
    state.location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      source: 'device'
    };
  } catch (error) {
    if (token === state.locationRequest) notify(error.code === 1 ? t("Геолокация не разрешена. Можно загрузить фотографию с GPS-меткой или разрешить доступ в браузере.") : t("Не удалось получить координаты. Попробуйте ещё раз на улице или загрузите фото с GPS-меткой."), 8000);
  } finally {
    if (token === state.locationRequest) {
      state.locationBusy = false;
      renderLocation();
      updateHint();
    }
  }
}
function loadPhoto(photo, location = null, sourceLicense = null) {
  stopCamera();
  stopPlayback();
  state.locationRequest++;
  state.locationBusy = false;
  state.location = location;
  state.original = photo;
  state.sourceLicense = sourceLicense;
  state.record = null;
  state.regenerationId = undefined;
  state.comparing = false;
  $("#viewfinder").classList.remove("demo");
  $("#scene-image").src = photo;
  $("#scene-image").alt = t("Ваш исходный снимок");
  $("#compare-image").hidden = true;
  $("#compare-slider").hidden = true;
  $("#compare-handle").hidden = true;
  $("#timeline-section").hidden = true;
  $("#empty-caption").hidden = true;
  $("#year-overlay").hidden = true;
  $("#frame-corners").hidden = true;
  $("#result-details").hidden = true;
  $("#rebuild-button").hidden = true;
  $("#mode-badge").textContent = t("ИСХОДНЫЙ СНИМОК");
  $("#panel-title").textContent = t("Готовы заглянуть в прошлое?");
  $("#panel-description").textContent = t("Место определится по GPS и фотографии. Проверьте три эпохи и начните путешествие.");
  $("#new-photo-button").hidden = true;
  $("#capture-controls").hidden = false;
  $("#location-button").hidden = false;
  $("#generate-button span").textContent = t("Открыть прошлое");
  renderLocation();
  updateHint();
  applySettings();
  syncPresentation();
}
function updateHint() {
  $("#generation-hint").textContent = !state.location ? t("Для поиска нужно местоположение из фото или телефона") : state.config.configured ? state.user?.isAdmin ? t("Администратор · без дневного лимита генераций") : t("3 изображения · среднее качество · без автоматических повторов") : t("Для настоящей генерации нужно подключить ИИ на сервере");
  if (state.location && state.config.guestMode && !state.user) $("#generation-hint").textContent = t("Гость · 1 путешествие в день на сеть · 3 кадра · без повторов");
}
async function uploadPhoto(file, sourceLicense = null) {
  if (!file || state.busy) return;
  if (file.size > 20 * 1024 * 1024) {
    notify(t("Фотография слишком большая. Максимум — 20 МБ."));
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    const gps = TimeLensExif.readGps(await file.arrayBuffer());
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    loadPhoto(canvasPhoto(image, image.naturalWidth, image.naturalHeight), gps, sourceLicense);
    if (gps) notify(t("Место съёмки найдено в GPS-метке фотографии."));
  } catch {
    notify(t("Браузер не смог прочитать изображение. Используйте JPG, PNG или WebP."));
  } finally {
    URL.revokeObjectURL(url);
    $("#file-input").value = "";
  }
}
const memoryArchive = new Map();
const dbPromise = new Promise(resolve => {
  let settled = false;
  const finish = value => { if (settled) { value?.close(); return; } settled = true; clearTimeout(timer); resolve(value); };
  const timer = setTimeout(() => finish(null), 1500);
  if (!window.indexedDB) { finish(null); return; }
  const request = indexedDB.open("timelens-archive", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("records", {
    keyPath: "id"
  });
  request.onsuccess = () => finish(request.result);
  request.onerror = request.onblocked = () => finish(null);
}).catch(() => null);
async function archive(action, value) {
  if (action === "put") memoryArchive.set(value.id, value);
  const db = await dbPromise;
  if (!db) return action === "getAll" ? [...memoryArchive.values()] : null;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error(t("Хранилище устройства не отвечает."))); }, 2500);
    const tx = db.transaction("records", action === "getAll" ? "readonly" : "readwrite");
    const store = tx.objectStore("records");
    let request = action === "getAll" ? store.getAll() : store.put(value);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
    tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error); };
  }).catch(() => action === "getAll" ? [...memoryArchive.values()] : null);
}
async function saveGuest(record) {
  try {
    await archive("put", record);
    state.guestRecords = (await archive("getAll") || []).sort((a, b) => b.createdAt - a.createdAt);
    $("#history-count").textContent = state.guestRecords.length;
  } catch {
    notify(t("Кадры готовы, но для сохранения истории на устройстве не хватило места."));
  }
}
function demoRecord() {
  const years = [...state.settings.years];
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    place: t("Улица вне времени · пример интерфейса"),
    years,
    original: svgScene(today),
    demo: true,
    frames: years.map(year => ({
      year,
      image: svgScene(year),
      status: "demo",
      text: t("Это авторская иллюстрация для демонстрации временной шкалы. Она не показывает реальное место или его исторический облик. В рабочем режиме здесь будет реконструкция по найденным интернет-источникам."),
      sources: []
    }))
  };
}
async function openDemo() {
  if (state.busy) return;
  stopCamera();
  let record;
  try {
    const response = await fetch("sample-result.json");
    if (!response.ok) throw Error("sample");
    record = await response.json();
    if (!record.sample || record.frames?.length !== 3 || !record.frames.every(frame => frame.image)) throw Error("sample");
  } catch { record = demoRecord(); }
  showRecord(record);
  notify(record.sample ? t("Готовый пример ИИ: три эпохи Парижа. Просмотр бесплатный и без входа.") : t("Демонстрация интерфейса: иллюстрации, без вызовов ИИ и расходов."));
}
function showRecord(record, { index = 0 } = {}) {
  stopCamera();
  stopPlayback();
  state.locationRequest++;
  state.locationBusy = false;
  state.location = record.location || null;
  state.record = record;
  state.original = record.original;
  state.sourceLicense = record.sourceLicense || null;
  state.comparing = false;
  $("#viewfinder").classList.toggle("demo", !!record.demo);
  $("#capture-controls").hidden = true;
  $("#timeline-section").hidden = false;
  $("#empty-caption").hidden = true;
  $("#frame-corners").hidden = true;
  $("#camera-grid").hidden = true;
  $("#result-details").hidden = false;
  $("#rebuild-button").hidden = !!record.demo || !!record.sample;
  $("#new-photo-button").hidden = false;
  $("#generate-button").disabled = true;
  $("#generate-button span").textContent = state.busy ? t("Путешествие создаётся…") : t("Путешествие готово");
  $("#generation-hint").textContent = record.sample ? t("Подготовленный пример ИИ · просмотр бесплатный") : record.demo ? t("Демонстрация · иллюстрации · расходы $0") : t("{0} из 3 реконструкций · просмотр бесплатный", record.frames.filter(f => f.image).length);
  $("#panel-title").textContent = t("Одно место. Разные времена.");
  $("#panel-description").textContent = record.sample ? t("Три заранее подготовленные реконструкции Парижа по открытым источникам. Детали и совмещение приблизительны.") : record.demo ? t("Попробуйте временную шкалу. Этот пример показывает интерфейс без исторических утверждений.") : t("Перемещайте точку, чтобы увидеть три выбранные эпохи и исходный кадр.");
  renderLocation();
  $("#location-status").textContent = record.demo ? t("Вымышленное место · демонстрация") : recordText(record, "place");
  $("#location-button").hidden = true;
  $("#result-place").textContent = recordText(record, "place");
  const credit = $("#result-credit");
  credit.hidden = !record.attribution;
  if (record.attribution) {
    credit.replaceChildren(textNode("span", t("Исходный снимок: NonOmnisMoriar, 2011. Реконструкции ИИ: TimeLens. ")));
    const source = textNode("a", "Wikimedia Commons"); source.href = record.attribution.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer";
    const license = textNode("a", "CC BY-SA 3.0"); license.href = record.attribution.licenseUrl; license.target = "_blank"; license.rel = "noopener noreferrer";
    credit.append(source, document.createTextNode(" · "), license, textNode("span", record.sample ? t(". Изображения изменены. Это подготовленный пример, а не результат платного запроса приложения.") : t(". Изображения изменены; реконструкции распространяются по той же лицензии.")));
  }
  if (record.sample) $("#location-help").textContent = t("Готовый пример открыт без GPS и без входа.");
  $("#timeline-labels").replaceChildren();
  [...record.years, record.originalYear || today].forEach((year, index) => {
    const button = textNode("button", index === 3 ? originalLabel(record) : String(year));
    button.type = "button";
    button.setAttribute("aria-label", index === 3 ? originalLabel(record) : String(year));
    button.append(textNode("i", romanYear(year)));
    button.onclick = () => showFrame(index);
    $("#timeline-labels").append(button);
  });
  renderResultCards(record);
  syncPresentation();
  showPage("camera");
  showFrame(index);
  $("#busy-overlay").classList.toggle("partial-results", state.busy);
}
function showFrame(index) {
  if (!state.record) return;
  state.index = Math.max(0, Math.min(3, index));
  const current = state.index === 3;
  const frame = current ? null : state.record.frames[state.index];
  const unavailable = !current && !frame?.image;
  const pending = unavailable && frame?.status === "pending";
  $("#scene-image").src = current || unavailable ? state.record.original : frame.image;
  state.frameAnimation?.cancel();
  if (state.settings.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches && $("#scene-image").animate) state.frameAnimation = $("#scene-image").animate([{
    opacity: .65
  }, {
    opacity: 1
  }], {
    duration: 200,
    easing: "ease-out"
  });
  $("#scene-image").alt = current ? t("Исходная фотография") : unavailable ? t("Исходный снимок — реконструкция этой эпохи недоступна") : `${state.record.demo ? t("Демонстрационная иллюстрация") : t("Историческая реконструкция ИИ")}, ${frame.year}`;
  $("#year-overlay").hidden = false;
  $("#overlay-year").textContent = current ? originalLabel(state.record) : String(frame.year);
  $("#overlay-tag").textContent = state.record.demo ? t("ИЛЛЮСТРАЦИЯ · ДЕМО") : current ? t("ИСХОДНЫЙ СНИМОК") : pending ? t("СОЗДАЁТСЯ · ПОКАЗАН ОРИГИНАЛ") : unavailable ? t("НЕТ РЕКОНСТРУКЦИИ · ПОКАЗАН ОРИГИНАЛ") : t("РЕКОНСТРУКЦИЯ ИИ");
  $("#mode-badge").textContent = state.record.demo ? t("ДЕМОНСТРАЦИЯ") : current ? t("НАСТОЯЩЕЕ") : t("ПРОШЛОЕ");
  $("#timeline").value = state.index;
  $("#timeline").style.setProperty("--time-progress", `${state.index / 3 * 100}%`);
  $("#overlay-roman").textContent = romanYear(current ? state.record.originalYear || today : frame.year);
  [...$("#result-cards").children].forEach((button, i) => {
    button.classList.toggle("active", i === state.index);
    button.setAttribute("aria-pressed", String(i === state.index));
  });
  $("#timeline").setAttribute("aria-valuetext", current ? t("Исходная фотография") : `${frame.year}${unavailable ? t(": реконструкция недоступна") : ""}`);
  [...$("#timeline-labels").children].forEach((button, i) => {
    button.classList.toggle("active", i === state.index);
    button.setAttribute("aria-pressed", String(i === state.index));
  });
  $("#timeline-caption").textContent = current ? t("Исходный снимок — отправная точка") : pending ? t("Источники найдены. Этот кадр ещё создаётся.") : unavailable ? t("Не хватает данных или генерация не завершилась") : t("Один из трёх готовых кадров");
  $("#compare-button").disabled = current || unavailable;
  $("#download-button").disabled = unavailable;
  const evidenceLabels = {
    photograph: t("архивным фотографиям"),
    artwork: t("рисункам и гравюрам"),
    archaeology: t("археологическим сведениям"),
    text: t("историческим описаниям"),
    mixed: t("изображениям и историческим сведениям")
  };
  $("#evidence-tag").textContent = state.record.demo ? t("Пример интерфейса") : current ? t("Исходный снимок") : pending ? t("Источники найдены · кадр создаётся") : frame.status === "documented" ? t("Реконструкция по найденным свидетельствам") : unavailable ? t("Реконструкция недоступна") : frame.evidenceType ? t("Приблизительная реконструкция по {0}", evidenceLabels[frame.evidenceType] || t("найденным сведениям")) : t("Источники дают неполные сведения");
  $("#evidence-text").textContent = state.record.demo ? I18n.resolve(frame?.text || t("Современная иллюстрация того же вымышленного места.")) : current ? t("Это исходный снимок. Для исторических эпох ИИ использует его как основу ракурса, освещения и погоды. Результаты являются реконструкциями и могут содержать ошибки.") : [recordText(frame, "text") || t("Для этого года нет достаточных свидетельств."), frame.evidenceYears ? t("Датировка свидетельств: {0}.", frame.evidenceYears) : "", frame.uncertainties ? t("Что приблизительно: {0}", recordText(frame, "uncertainties")) : ""].filter(Boolean).join("\n\n");
  renderSources(frame?.sources || []);
  renderSearchAttribution(current ? "" : state.record.searchSuggestions || "");
  if (current || unavailable) state.comparing = false;
  applyCompare();
  renderEpochs();
}
function renderSources(sources) {
  const container = $("#sources-list");
  container.replaceChildren();
  if (!sources.length) {
    container.append(textNode("p", state.record?.demo ? t("В демо нет исторических источников.") : t("Для этого кадра нет ссылок на исторические источники."), "source-empty"));
    return;
  }
  sources.forEach((source, index) => {
    let url;
    try {
      url = new URL(source.url);
      if (!(/^https?:$/).test(url.protocol)) return;
    } catch {
      return;
    }
    const a = document.createElement("a");
    a.className = "source-link";
    a.href = url.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.append(textNode("span", String(index + 1).padStart(2, "0")), textNode("span", [source.title || url.hostname, source.dateRange].filter(Boolean).join(" · ")), textNode("span", "↗"));
    container.append(a);
  });
}
function renderSearchAttribution(html) {
  $("#search-attribution").replaceChildren();
  if (!html) return;
  const iframe = document.createElement("iframe");
  iframe.title = t("Источники и поисковые запросы");
  iframe.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  iframe.srcdoc = html;
  $("#search-attribution").append(iframe);
}
function applyCompare() {
  $("#compare-image").src = state.record?.original || "";
  $("#compare-image").hidden = !state.comparing;
  $("#compare-slider").hidden = !state.comparing;
  $("#compare-handle").hidden = !state.comparing;
  $("#compare-button").textContent = state.comparing ? t("Завершить сравнение") : t("Сравнить с оригиналом");
  updateCompare();
}
function updateCompare() {
  const value = Number($("#compare-slider").value);
  $("#compare-image").style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  $("#compare-handle").style.left = `${value}%`;
}
function stopPlayback() {
  clearInterval(state.playing);
  state.playing = null;
  $("#play-timeline").innerHTML = icon("play");
  $("#play-timeline").setAttribute("aria-label", t("Воспроизвести эпохи"));
}
function startPlayback() {
  if (state.playing) {
    stopPlayback();
    return;
  }
  if (!state.record) return;
  showFrame(0);
  $("#play-timeline").textContent = "Ⅱ";
  $("#play-timeline").setAttribute("aria-label", t("Остановить воспроизведение"));
  state.playing = setInterval(() => {
    if (state.index >= 3) stopPlayback(); else showFrame(state.index + 1);
  }, 1500);
}
function setBusy(busy) {
  state.busy = busy;
  $(".camera-shell").setAttribute("aria-busy", String(busy));
  $("#cancel-job").disabled = busy && !state.jobId;
  $("#busy-overlay").hidden = !busy;
  $("#busy-overlay").classList.toggle("partial-results", busy && !!state.record);
  $("#new-photo-button").disabled = busy;
  $("#generate-button").disabled = busy || !state.original || !state.location || !!state.record;
  $("#upload-button").disabled = busy;
  $("#demo-button").disabled = busy;
  $("#shutter-button").disabled = busy;
  $("#settings-open").disabled = busy;
  $("#edit-years").disabled = busy;
  $("#location-button").disabled = busy || state.locationBusy;
  $("#profile-open").disabled = busy;
  $("#rebuild-button").disabled = busy;
  renderEpochs();
}
async function generate() {
  if (!state.original || !state.location || state.busy || state.record) return;
  try {
    state.config = {
      ...state.config,
      ...await api("/api/config")
    };
  } catch {
    notify(t("Не удалось связаться с сервером. Проверьте интернет и попробуйте снова."));
    return;
  }
  if (!state.config.configured) {
    notify(t("ИИ ещё не подключён. Настройка ключа выполняется на сервере; в HTML секретов нет."), 8000);
    return;
  }
  state.user = state.config.user;
  updateProfile();
  if (state.config.requiresLogin && !state.user) {
    notify(t("Войдите через Google перед генерацией."), 8000);
    $('#profile-open').click();
    return;
  }
  setBusy(true);
  $("#busy-title").textContent = t("Ищем следы прошлого");
  $("#busy-detail").textContent = t("Определяем место и проверяем интернет-источники");
  $("#progress-bar").style.width = "5%";
  try {
    const {jobId} = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        image: state.original,
        location: state.location,
        years: state.settings.years,
        regenerationId: state.regenerationId,
        sourceLicense: state.sourceLicense,
        language: I18n.language
      })
    });
    state.jobId = jobId;
    $("#cancel-job").disabled = false;
    while (state.jobId === jobId) {
      const job = await api(`/api/jobs/${jobId}`);
      if (state.jobId !== jobId) break;
      state.lastJob = job;
      $("#busy-detail").textContent = I18n.resolve(job.message);
      $("#busy-title").textContent = job.phase === "queued" ? t("Снимок в очереди") : job.phase === "research" ? t("Ищем следы прошлого") : t("Возвращаем время назад");
      $("#progress-bar").style.width = `${job.progress || 5}%`;
      if (job.status === "done") {
        setBusy(false);
        if (!state.user) await saveGuest(job.record);
        showRecord(job.record);
        await refreshHistoryCount();
        state.jobId = null;
        notify(t("Путешествие готово. Под каждой эпохой — найденные источники."));
        break;
      }
      if (job.status === "error" || job.status === "cancelled") throw new Error(job.error || t("Генерация отменена."));
      if (job.record) {
        let index = state.record ? state.index : 0;
        if (index < 3 && !job.record.frames[index]?.image) {
          const ready = job.record.frames.findIndex(frame => frame.image);
          if (ready >= 0) index = ready;
        }
        showRecord(job.record, { index });
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (error) {
    notify(error.message, 10000);
    state.jobId = null;
  } finally {
    setBusy(false);
    if (state.record) {
      state.record.frames.forEach(frame => { if (frame.status === "pending") frame.status = "failed"; });
      showRecord(state.record, { index: state.index });
    }
  }
}
async function cancelJob() {
  const id = state.jobId;
  if (!id) return;
  try {
    await api(`/api/jobs/${id}/cancel`, {
      method: "POST",
      body: "{}"
    });
    state.jobId = null;
    setBusy(false);
    if (state.record) { state.record.frames.forEach(frame => { if (frame.status === "pending") frame.status = "failed"; }); showRecord(state.record, { index: state.index }); }
    notify(t("Следующие кадры отменены. Уже отправленный запрос может быть оплачен провайдером."), 8000);
  } catch (error) {
    notify(error.message);
  }
}
function reset() {
  if (state.busy) return;
  stopCamera();
  stopPlayback();
  state.locationRequest++;
  state.locationBusy = false;
  state.location = null;
  state.original = null;
  state.record = null;
  state.regenerationId = undefined;
  state.comparing = false;
  $("#scene-image").src = svgScene();
  $("#scene-image").alt = t("Иллюстрация улицы для демонстрации интерфейса");
  $("#viewfinder").classList.add("demo");
  $("#empty-caption").hidden = false;
  $("#frame-corners").hidden = false;
  $("#year-overlay").hidden = true;
  $("#timeline-section").hidden = true;
  $("#result-details").hidden = true;
  $("#rebuild-button").hidden = true;
  $("#compare-image").hidden = true;
  $("#compare-slider").hidden = true;
  $("#compare-handle").hidden = true;
  $("#capture-controls").hidden = false;
  $("#new-photo-button").hidden = true;
  $("#location-button").hidden = false;
  $("#generate-button").disabled = true;
  $("#generate-button span").textContent = t("Открыть прошлое");
  $("#panel-title").innerHTML = t("Начните<br>с одного кадра.").replaceAll('<br>','<br> ');
  $("#panel-description").textContent = t("Сфотографируйте место. Мы найдём его историю и соберём три вида прошлого.");
  $("#mode-badge").innerHTML = t("<span class=\"live-dot\"></span>ПРЕДПРОСМОТР");
  $("#generation-hint").textContent = t("Сначала сделайте или загрузите фотографию");
  renderLocation();
  applySettings();
  syncPresentation();
}
function showPage(name) {
  if (name === "history") {
    stopCamera();
    stopPlayback();
  }
  $("#camera-page").hidden = name !== "camera";
  $("#history-page").hidden = name !== "history";
  $("#camera-tab").classList.toggle("active", name === "camera");
  $("#history-tab").classList.toggle("active", name === "history");
  if (name === "history") renderHistory();
}
async function getHistory() {
  if (state.user) {
    const result = await api("/api/history");
    return result.records.map(record => ({ ...record, serverRecord: true }));
  }
  state.guestRecords = (await archive("getAll") || []).sort((a, b) => b.createdAt - a.createdAt);
  if (state.config.guestMode) {
    try {
      const { records } = await api("/api/history");
      const merged = new Map(state.guestRecords.map(record => [record.id, record]));
      for (const record of records) if (!merged.has(record.id)) merged.set(record.id, { ...record, serverRecord: true });
      return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
    } catch { /* The device archive remains available offline. */ }
  }
  return state.guestRecords;
}
async function refreshHistoryCount() {
  try {
    $("#history-count").textContent = (await getHistory()).length;
  } catch {}
}
async function renderHistory() {
  const grid = $("#history-grid");
  grid.replaceChildren(textNode("p", t("Загрузка истории…"), "muted"));
  $("#history-description").textContent = state.user ? t("Личный архив: {0}. Только ваши запросы.", state.user.name) : t("История на этом устройстве. Войдите через Google для истории в профиле.");
  try {
    const records = await getHistory();
    grid.replaceChildren();
    $("#history-count").textContent = records.length;
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "empty-history";
      empty.innerHTML = icon("clock");
      empty.append(textNode("h2", t("Здесь начинается ваш архив.")), textNode("p", t("Первое путешествие появится после обработки снимка.")));
      const button = textNode("button", t("Вернуться к камере"), "secondary-button");
      button.onclick = () => showPage("camera");
      empty.append(button);
      grid.append(empty);
      return;
    }
    for (const record of records) {
      const button = document.createElement("button");
      button.className = "history-card";
      const img = new Image();
      img.src = record.thumbnail || record.original;
      img.alt = record.place;
      img.loading = "lazy";
      img.decoding = "async";
      const body = document.createElement("div");
      body.className = "history-body";
      body.append(textNode("strong", record.place), textNode("p", t("{0} → сейчас", record.years.join(" · "))), textNode("p", `${new Date(record.createdAt).toLocaleDateString(I18n.locale)} · ${record.demo ? t("демонстрация") : t("реконструкция ИИ")}`));
      button.append(img, body);
      button.onclick = async () => {
        try {
          const full = record.serverRecord || state.user ? await api(`/api/history/${record.id}`) : record;
          showRecord(full);
          window.scrollTo({
            top: 0,
            behavior: state.settings.motion ? "smooth" : "instant"
          });
        } catch (error) {
          notify(error.message);
        }
      };
      grid.append(button);
    }
  } catch (error) {
    grid.replaceChildren(textNode("p", error.message, "muted"));
  }
}
function openSettings() {
  state.settings.years.forEach((year, index) => {
    $(`#year-${index + 1}`).value = year;
    $(`#year-${index + 1}`).max = today - 1;
  });
  $("#grid-setting").checked = state.settings.grid;
  $("#motion-setting").checked = state.settings.motion;
  updatePreferenceControls();
  $("#settings-dialog").showModal();
}
$("#settings-form").addEventListener("submit", event => {
  event.preventDefault();
  const years = [1, 2, 3].map(index => Number($(`#year-${index}`).value)).sort((a, b) => a - b);
  if (new Set(years).size !== 3 || years.some(year => !Number.isInteger(year) || year < 1000 || year >= today)) {
    notify(t("Выберите три разных года от 1000 до прошлого года."));
    return;
  }
  state.settings = {
    years,
    grid: $("#grid-setting").checked,
    motion: $("#motion-setting").checked
  };
  try {
    localStorage.setItem("timelens-settings", JSON.stringify(state.settings));
  } catch {}
  I18n.setPreferences({language:$("#language-setting").value,theme:$("#theme-setting").value});
  applySettings();
  $("#settings-dialog").close();
  notify(state.record ? t("Настройки сохранены для следующего снимка. Готовое путешествие сохраняет прежние годы.") : t("Три эпохи сохранены."));
});
document.querySelectorAll("[data-preset]").forEach(button => button.onclick = () => button.dataset.preset.split(",").forEach((year, index) => $(`#year-${index + 1}`).value = Math.min(today - 1, Number(year))));
document.querySelectorAll(".dialog-close").forEach(button => button.onclick = () => button.closest("dialog").close());
document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));
$("#settings-open").onclick = openSettings;
$("#edit-years").onclick = openSettings;
$("#camera-tab").onclick = () => showPage("camera");
$("#history-tab").onclick = () => showPage("history");
$("#shutter-button").onclick = openCamera;
$("#upload-button").onclick = () => $("#file-input").click();
$("#file-input").onchange = () => uploadPhoto($("#file-input").files[0]);
$("#demo-button").onclick = openDemo;
$("#generate-button").onclick = generate;
$("#cancel-job").onclick = cancelJob;
$("#new-photo-button").onclick = reset;
$("#about-open").onclick = () => $("#about-dialog").showModal();
$("#timeline").oninput = event => {
  stopPlayback();
  showFrame(Number(event.target.value));
};
$("#play-timeline").onclick = startPlayback;
$("#compare-button").onclick = () => {
  state.comparing = !state.comparing;
  applyCompare();
};
$("#compare-slider").oninput = updateCompare;
$("#fullscreen-button").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen(); else await $("#viewfinder").requestFullscreen();
  } catch {
    notify(t("Полноэкранный режим недоступен в этом браузере."));
  }
};
$("#rebuild-button").onclick = () => {
  if (!state.record || state.busy) return;
  const record = state.record;
  state.settings.years = [...record.years];
  localStorage.setItem("timelens-settings", JSON.stringify(state.settings));
  loadPhoto(record.original, record.location, record.sourceLicense);
  state.regenerationId = crypto.randomUUID();
  notify(t("Фото и эпохи подготовлены. Нажмите «Открыть прошлое», чтобы выполнить новый поиск и генерацию."), 8000);
};
$("#download-button").onclick = () => {
  if (!state.record) return;
  const current = state.index === 3;
  const frame = state.record.frames[state.index];
  const a = document.createElement("a");
  a.href = current ? state.record.original : frame.image;
  a.download = `timelens-${current ? "original" : frame.year}${state.record.demo ? "-demo.svg" : state.record.sample ? ".webp" : ".jpg"}`;
  a.click();
};
$("#viewfinder").addEventListener("dragover", event => {
  event.preventDefault();
});
$("#viewfinder").addEventListener("drop", event => {
  event.preventDefault();
  uploadPhoto(event.dataTransfer.files[0]);
});
$("#location-button").onclick = requestLocation;
$("#sample-photo-button").onclick = async () => {
  try {
    const response = await fetch('sample.jpg');
    if (!response.ok) throw Error('sample');
    $("#about-dialog").close();
    reset();
    await uploadPhoto(new File([await response.blob()], 'sample.jpg', {
      type: 'image/jpeg'
    }), 'eiffel-trocadero-2011');
  } catch {
    notify(t("Пример фотографии доступен при запуске сайта через сервер."));
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopCamera();
    stopPlayback();
  }
});
window.addEventListener("pagehide", stopCamera);
function updateProfile() {
  $("#profile-open").setAttribute("aria-label", state.user ? t("Открыть профиль: {0}{1}", state.user.name, state.user.isAdmin ? t(", администратор") : "") : t("Войти через Google"));
  $("#profile-label").textContent = state.user ? `${state.user.name.split(" ")[0]}${state.user.isAdmin ? t(" · Админ") : ""}` : t("Войти");
  $("#profile-title").textContent = state.user ? t("Привет, {0}.", state.user.name.split(" ")[0]) : t("Сохраните путешествия.");
  $("#profile-description").textContent = state.user ? state.user.isAdmin ? t("Вы администратор. Генерации доступны без дневного лимита; они оплачиваются с подключённого баланса OpenAI. Путешествия сохраняются в вашем профиле.") : t("Ваши новые путешествия сохраняются в личном облачном альбоме.") : t("Войдите через Google, чтобы возвращаться к вашим фотографиям, эпохам и источникам.");
  $("#logout-button").hidden = !state.user;
  $("#google-signin").hidden = !!state.user;
  $("#google-status").hidden = !!state.user;
  if (state.original && !state.record && !state.busy) updateHint();
}
async function setupGoogle() {
  if (!state.config.googleClientId) {
    $("#google-status").textContent = t("Вход через Google ещё не подключён владельцем сайта. Пока история сохраняется только в этом браузере. Для подключения нужен Google OAuth Client ID.");
    return;
  }
  try {
    if (!window.google?.accounts?.id) {
      if (!state.googleLoadPromise) state.googleLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
      await state.googleLoadPromise;
    }
    const {nonce} = await api("/api/auth/nonce");
    google.accounts.id.initialize({
      client_id: state.config.googleClientId,
      nonce,
      auto_select: false,
      callback: async ({credential}) => {
        try {
          const result = await api("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({
              credential
            })
          });
          state.user = result.user;
          await adoptProfilePreferences(result.preferences);
          state.record = null;
          reset();
          updateProfile();
          await refreshHistoryCount();
          $("#profile-dialog").close();
          notify(t("Вы вошли. Новые путешествия сохранятся в вашем профиле."));
        } catch (error) {
          notify(error.message);
        }
      }
    });
    $("#google-signin").replaceChildren();
    google.accounts.id.renderButton($("#google-signin"), {
      theme: I18n.theme === "dark" ? "filled_black" : "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      locale: I18n.language,
      width: 280
    });
    $("#google-status").textContent = state.config.guestMode ? t("Можно генерировать без входа. Google-профили пока доступны тестовым пользователям; готовый пример открыт всем.") : t("Вход подтверждает владение Google-аккаунтом. Путешествия хранятся на сервере TimeLens.");
  } catch {
    $("#google-status").textContent = t("Не удалось загрузить вход Google. Проверьте интернет и настройки OAuth.");
  }
}
$("#profile-open").onclick = async () => {
  updateProfile();
  $("#profile-dialog").showModal();
  $("#google-status").textContent=t("Загрузка…");
  await initialization;
  updateProfile();
  if (!state.user) await setupGoogle();
};
$("#logout-button").onclick = async () => {
  try {
    await api("/api/auth/logout", {
      method: "POST",
      body: "{}"
    });
    state.user = null;
    window.google?.accounts?.id?.disableAutoSelect();
    reset();
    updateProfile();
    await refreshHistoryCount();
    $("#profile-dialog").close();
    notify(t("Вы вышли из профиля."));
  } catch (error) {
    notify(error.message);
  }
};
// Decorative motion follows the reference; pause it when it is off screen.
const heroArt = $(".hero-art");
let heroInView = true;
const syncHeroMotion = () => heroArt.classList.toggle("motion-paused", document.hidden || !heroInView);
if (typeof IntersectionObserver === "function") {
  const heroObserver = new IntersectionObserver(([entry]) => {
    heroInView = entry.isIntersecting;
    syncHeroMotion();
  });
  heroObserver.observe(heroArt);
}
document.addEventListener("visibilitychange", syncHeroMotion);
syncHeroMotion();
$("#hero-camera").onclick = () => {
  $("#viewfinder").closest(".camera-shell").scrollIntoView({
    block: "start",
    behavior: state.settings.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant"
  });
  openCamera();
};
$("#hero-demo").onclick = async () => {
  await openDemo();
  $("#viewfinder").closest(".camera-shell").scrollIntoView({
    block: "start",
    behavior: state.settings.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant"
  });
};
async function init() {
  I18n.applyStatic();
  updatePreferenceControls();
  reset();
  const revision=I18n.revision;
  try {
    const data = await api("/api/config");
    state.config = data;
    state.user = data.user;
    if(state.user)await adoptProfilePreferences(data.preferences,revision);
  } catch {}
  await refreshHistoryCount();
  updateProfile();
  updatePreferenceControls();
}
let preferenceQueue=Promise.resolve();
const pendingPreferenceKey=()=>state.user?.email?'timelens-pending-preferences:'+state.user.email.toLowerCase():null;
function pendingPreferences(){try{const value=JSON.parse(localStorage.getItem(pendingPreferenceKey())||'null');return value&&['en','ru'].includes(value.language)&&['light','dark'].includes(value.theme)?value:null;}catch{return null;}}
function updatePreferenceControls(){
 const preference=I18n.preferences;
 $("#language-toggle").textContent=preference.language.toUpperCase();
 const languageLabel=t(preference.language==='en'?'Switch to Russian':'Switch to English');
 $("#language-toggle").setAttribute('aria-label',languageLabel);$("#language-toggle").title=languageLabel;
 const themeLabel=t(preference.theme==='light'?'Switch to dark theme':'Switch to light theme');
 $("#theme-toggle").setAttribute('aria-label',themeLabel);$("#theme-toggle").title=themeLabel;$("#theme-toggle").setAttribute('aria-pressed',String(preference.theme==='dark'));
 $("#theme-toggle").innerHTML=icon(preference.theme==='light'?'moon':'sun');
 $("#language-setting").value=preference.language;$("#theme-setting").value=preference.theme;
 $("#preferences-note").textContent=t(state.user?'Language and appearance are saved in your profile.':'Saved on this device. Sign in to sync across devices.');
}
function queuePreferenceSave(){
 if(!state.user)return;
 const email=state.user.email,preferences=I18n.preferences,key=pendingPreferenceKey();
 try{localStorage.setItem(key,JSON.stringify(preferences));}catch{}
 preferenceQueue=preferenceQueue.catch(()=>{}).then(async()=>{
  if(state.user?.email!==email)return;
  try{
   await api('/api/preferences',{method:'POST',keepalive:true,body:JSON.stringify({preferences})});
   try{if(localStorage.getItem(key)===JSON.stringify(preferences))localStorage.removeItem(key);}catch{}
  }catch{notify(t('Saved in this browser. Could not sync your profile; try changing the setting again when online.'),8000);}
 });
}
async function adoptProfilePreferences(preferences,revision=I18n.revision){
 const pending=pendingPreferences();
 if(pending&&revision===I18n.revision){I18n.setPreferences(pending,{emit:false});refreshLanguage();queuePreferenceSave();}
 else if(preferences&&['en','ru'].includes(preferences.language)&&['light','dark'].includes(preferences.theme)&&revision===I18n.revision){I18n.setPreferences(preferences,{emit:false});refreshLanguage();}
 else if(state.user)queuePreferenceSave();
 updatePreferenceControls();
}
function refreshLanguage(){
 const historyVisible=!$("#history-page").hidden;
 const originalIndex=state.index,comparing=state.comparing;
 I18n.applyStatic();
 if(state.record){showRecord(state.record);state.comparing=comparing;showFrame(originalIndex);if(historyVisible)showPage('history');}
 else{
  $("#scene-image").alt=t(state.original?'Ваш исходный снимок':'Иллюстрация улицы для демонстрации интерфейса');
  $("#panel-title").innerHTML=t(state.original?'Готовы заглянуть в прошлое?':'Начните<br>с одного кадра.').replaceAll('<br>','<br> ');
  $("#panel-description").textContent=t(state.original?'Место определится по GPS и фотографии. Проверьте три эпохи и начните путешествие.':'Сфотографируйте место. Мы найдём его историю и соберём три вида прошлого.');
  $("#mode-badge").innerHTML=state.stream?t('КАМЕРА ВКЛЮЧЕНА'):state.original?t('ИСХОДНЫЙ СНИМОК'):t('<span class="live-dot"></span>ПРЕДПРОСМОТР');
  $("#shutter-button").setAttribute('aria-label',t(state.stream?'Сделать фотографию':'Открыть камеру'));
  renderLocation();renderEpochs();syncPresentation();
  $("#generate-button span").textContent=t("Открыть прошлое");
  if(state.original)updateHint();else $("#generation-hint").textContent=t("Сначала сделайте или загрузите фотографию");
  if(historyVisible)renderHistory();
 }
 if(state.busy){$("#busy-title").textContent=t(state.lastJob?.phase==='images'?'Возвращаем время назад':'Ищем следы прошлого');$("#busy-detail").textContent=I18n.resolve(state.lastJob?.message||t('Определяем место и проверяем интернет-источники'));setBusy(true);}
 updateProfile();updatePreferenceControls();
 if($("#profile-dialog").open&&!state.user)setupGoogle();
}
I18n.subscribe(({before,preferences,saved})=>{if(before.language!==preferences.language)refreshLanguage();else{updatePreferenceControls();if($("#profile-dialog").open&&!state.user)setupGoogle();}if(!saved)notify(t('Device storage is unavailable. This choice can be saved in your profile after sign-in.'));queuePreferenceSave();});
$("#language-toggle").onclick=()=>I18n.setPreferences({language:I18n.language==='en'?'ru':'en'});
$("#theme-toggle").onclick=()=>I18n.setPreferences({theme:I18n.theme==='light'?'dark':'light'});
$("#language-setting").onchange=event=>I18n.setPreferences({language:event.target.value});
$("#theme-setting").onchange=event=>I18n.setPreferences({theme:event.target.value});
window.addEventListener('online',()=>{if(pendingPreferences())queuePreferenceSave();});
const initialization=init();
