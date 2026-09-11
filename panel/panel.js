const STT_MODEL_CATALOG = [
  { code: "en", name: "English", sizeLabel: "40 MB", bundledPath: "models/en-us-small.tar.gz" },
  { code: "es", name: "Spanish", sizeLabel: "39 MB" },
  { code: "pt", name: "Portuguese", sizeLabel: "31 MB" },
  { code: "fr", name: "French", sizeLabel: "41 MB" },
  { code: "de", name: "German", sizeLabel: "45 MB" },
];

const statusEl = document.getElementById("status");
const panelRoot = document.getElementById("panelRoot");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const translateBtn = document.getElementById("translateBtn");
const submitBtn = document.getElementById("submitBtn");
const transcriptEl = document.getElementById("transcript");
const transcriptSessionsEl = document.getElementById("transcriptSessions");
const partialTextEl = document.getElementById("partialText");
const translatePane = document.getElementById("translatePane");
const translateTextEl = document.getElementById("translateText");
const translateSessionsEl = document.getElementById("translateSessions");
const translatePartialEl = document.getElementById("translatePartial");
const hotkeyBadge = document.getElementById("hotkeyBadge");
const sttProgressEl = document.getElementById("sttProgress");
const sttProgressFillEl = document.getElementById("sttProgressFill");
const langBtn = document.getElementById("langBtn");
const langBtnLabel = document.getElementById("langBtnLabel");
const langMenu = document.getElementById("langMenu");
const langSearch = document.getElementById("langSearch");
const langList = document.getElementById("langList");
const sttBtn = document.getElementById("sttBtn");
const sttBtnLabel = document.getElementById("sttBtnLabel");
const sttMenu = document.getElementById("sttMenu");
const sttSearch = document.getElementById("sttSearch");
const sttList = document.getElementById("sttList");
const dotEl = document.querySelector("[data-dot]");

const DEFAULT_HOTKEY = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: "w",
};

const LANGUAGES = [
  { code: "af", name: "Afrikaans" },
  { code: "sq", name: "Albanian" },
  { code: "am", name: "Amharic" },
  { code: "ar", name: "Arabic" },
  { code: "hy", name: "Armenian" },
  { code: "az", name: "Azerbaijani" },
  { code: "eu", name: "Basque" },
  { code: "be", name: "Belarusian" },
  { code: "bn", name: "Bengali" },
  { code: "bs", name: "Bosnian" },
  { code: "bg", name: "Bulgarian" },
  { code: "ca", name: "Catalan" },
  { code: "ceb", name: "Cebuano" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "co", name: "Corsican" },
  { code: "hr", name: "Croatian" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "eo", name: "Esperanto" },
  { code: "et", name: "Estonian" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "fy", name: "Frisian" },
  { code: "gl", name: "Galician" },
  { code: "ka", name: "Georgian" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "gu", name: "Gujarati" },
  { code: "ht", name: "Haitian Creole" },
  { code: "ha", name: "Hausa" },
  { code: "haw", name: "Hawaiian" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hmn", name: "Hmong" },
  { code: "hu", name: "Hungarian" },
  { code: "is", name: "Icelandic" },
  { code: "ig", name: "Igbo" },
  { code: "id", name: "Indonesian" },
  { code: "ga", name: "Irish" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "jv", name: "Javanese" },
  { code: "kn", name: "Kannada" },
  { code: "kk", name: "Kazakh" },
  { code: "km", name: "Khmer" },
  { code: "rw", name: "Kinyarwanda" },
  { code: "ko", name: "Korean" },
  { code: "ku", name: "Kurdish" },
  { code: "ky", name: "Kyrgyz" },
  { code: "lo", name: "Lao" },
  { code: "la", name: "Latin" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "lb", name: "Luxembourgish" },
  { code: "mk", name: "Macedonian" },
  { code: "mg", name: "Malagasy" },
  { code: "ms", name: "Malay" },
  { code: "ml", name: "Malayalam" },
  { code: "mt", name: "Maltese" },
  { code: "mi", name: "Maori" },
  { code: "mr", name: "Marathi" },
  { code: "mn", name: "Mongolian" },
  { code: "my", name: "Myanmar (Burmese)" },
  { code: "ne", name: "Nepali" },
  { code: "no", name: "Norwegian" },
  { code: "ny", name: "Nyanja" },
  { code: "or", name: "Odia (Oriya)" },
  { code: "ps", name: "Pashto" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pa", name: "Punjabi" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sm", name: "Samoan" },
  { code: "gd", name: "Scots Gaelic" },
  { code: "sr", name: "Serbian" },
  { code: "st", name: "Sesotho" },
  { code: "sn", name: "Shona" },
  { code: "sd", name: "Sindhi" },
  { code: "si", name: "Sinhala" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "so", name: "Somali" },
  { code: "es", name: "Spanish" },
  { code: "su", name: "Sundanese" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "tl", name: "Tagalog" },
  { code: "tg", name: "Tajik" },
  { code: "ta", name: "Tamil" },
  { code: "tt", name: "Tatar" },
  { code: "te", name: "Telugu" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "tk", name: "Turkmen" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "ug", name: "Uyghur" },
  { code: "uz", name: "Uzbek" },
  { code: "vi", name: "Vietnamese" },
  { code: "cy", name: "Welsh" },
  { code: "xh", name: "Xhosa" },
  { code: "yi", name: "Yiddish" },
  { code: "yo", name: "Yoruba" },
  { code: "zu", name: "Zulu" },
];

let localFinal = "";
let localPartial = "";
let localSessions = [];
let localTranslatedSessions = [];
let localTranslatedPartial = "";
let localPasteCheckpoint = 0;
let submitBusy = false;
let translateOpen = false;
let translateTarget = "zh-CN";
let langMenuOpen = false;
let sttLanguage = "en";
let sttCatalog = [];
let sttInstallBusy = null;
let sttInstallProgress = 0;
let sttMenuOpen = false;
let sttPendingAdd = null;

function buildFallbackSttCatalog(language = sttLanguage, installed = ["en"]) {
  const installedSet = new Set(installed.length ? installed : ["en"]);
  if (!installedSet.has("en")) installedSet.add("en");
  return STT_MODEL_CATALOG.map((item) => ({
    code: item.code,
    name: item.name,
    sizeLabel: item.sizeLabel,
    bundled: Boolean(item.bundledPath),
    installed: installedSet.has(item.code) || Boolean(item.bundledPath),
    active: language === item.code,
  }));
}

function ensureSttCatalog() {
  if (!Array.isArray(sttCatalog) || sttCatalog.length === 0) {
    sttCatalog = buildFallbackSttCatalog(sttLanguage, ["en"]);
  }
}

function formatHotkey(config) {
  const parts = [];
  if (config.ctrlKey) parts.push("Ctrl");
  if (config.altKey) parts.push("Alt");
  if (config.shiftKey) parts.push("Shift");
  if (config.metaKey) parts.push("Meta");
  parts.push((config.key || "").toUpperCase());
  return parts.join("+");
}

function setHotkeyBadge(config) {
  if (!hotkeyBadge) return;
  hotkeyBadge.textContent = formatHotkey(config || DEFAULT_HOTKEY);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  statusEl.classList.toggle("stt-busy", Boolean(sttInstallBusy) && !isError);
}

function isPinnedToBottom(el, threshold = 28) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function languageByCode(code) {
  return LANGUAGES.find((item) => item.code === code) || null;
}

function setLanguageLabel(code) {
  translateTarget = code || "zh-CN";
  const lang = languageByCode(translateTarget);
  langBtnLabel.textContent = lang?.name || translateTarget;
}

function renderLangList(filter = "") {
  const q = filter.trim().toLowerCase();
  const items = LANGUAGES.filter((item) => {
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
    );
  });

  langList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matches";
    langList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.name;
    btn.dataset.code = item.code;
    if (item.code === translateTarget) btn.classList.add("is-active");
    btn.addEventListener("click", () => selectLanguage(item.code));
    li.appendChild(btn);
    langList.appendChild(li);
  }
}

function setLangMenuOpen(open) {
  langMenuOpen = !!open;
  langMenu.hidden = !langMenuOpen;
  langBtn.setAttribute("aria-expanded", langMenuOpen ? "true" : "false");
  if (langMenuOpen) {
    setSttMenuOpen(false);
    renderLangList(langSearch.value);
    requestAnimationFrame(() => langSearch.focus());
  }
}

async function selectLanguage(code) {
  setLanguageLabel(code);
  setLangMenuOpen(false);
  setStatus("Translating…");
  try {
    await chrome.runtime.sendMessage({
      type: "SET_TRANSLATE_TARGET",
      target: code,
    });
  } catch (error) {
    setStatus(error?.message || "Language update failed", true);
  }
}

function setSttLabel(code, catalog = sttCatalog) {
  sttLanguage = code || "en";
  ensureSttCatalog();
  const list = catalog?.length ? catalog : sttCatalog;
  const item =
    list.find((row) => row.code === sttLanguage) ||
    STT_MODEL_CATALOG.find((row) => row.code === sttLanguage) ||
    { code: sttLanguage, name: "English" };
  if (sttBtnLabel) sttBtnLabel.textContent = item.name || "English";
}

function setSttUiBusy(busy) {
  const on = !!busy;
  panelRoot?.classList.toggle("stt-loading", on);
  if (on) {
    shareBtn.disabled = true;
    stopBtn.disabled = true;
    translateBtn.disabled = true;
    submitBtn.disabled = true;
    sttBtn.disabled = true;
    langBtn.disabled = true;
    if (sttSearch) sttSearch.disabled = true;
  } else {
    sttBtn.disabled = false;
    langBtn.disabled = false;
    if (sttSearch) sttSearch.disabled = false;
    translateBtn.disabled = false;
    setCapturingUi(dotEl?.classList.contains("live"));
    setSubmitBusy(submitBusy);
  }
}

function setSttProgress(pct, { visible = null } = {}) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  sttInstallProgress = value;
  const show = visible == null ? Boolean(sttInstallBusy) : !!visible;
  if (sttProgressEl) {
    sttProgressEl.hidden = !show;
    sttProgressEl.setAttribute("aria-valuenow", String(Math.round(value)));
  }
  if (sttProgressFillEl) {
    sttProgressFillEl.style.width = `${value}%`;
  }
  if (sttMenuOpen) {
    const loadingRow = sttList?.querySelector("li.is-loading");
    if (loadingRow) {
      loadingRow.style.setProperty("--stt-load-pct", `${value}%`);
    }
  }
}

function applySttState(state = {}) {
  if (Array.isArray(state.sttCatalog) && state.sttCatalog.length) {
    sttCatalog = state.sttCatalog;
  } else {
    ensureSttCatalog();
  }
  if (typeof state.sttLanguage === "string") sttLanguage = state.sttLanguage;
  if (state.sttInstallBusy === null || typeof state.sttInstallBusy === "string") {
    sttInstallBusy = state.sttInstallBusy ?? null;
  }
  if (typeof state.sttInstallProgress === "number") {
    sttInstallProgress = state.sttInstallProgress;
  }
  // Keep active flags in sync for local fallback lists.
  sttCatalog = sttCatalog.map((item) => ({
    ...item,
    active: item.code === sttLanguage,
    installed: item.installed || item.bundled || item.code === "en",
  }));
  setSttLabel(sttLanguage, sttCatalog);
  setSttUiBusy(Boolean(sttInstallBusy));
  setSttProgress(sttInstallBusy ? sttInstallProgress : 0, {
    visible: Boolean(sttInstallBusy),
  });
  if (sttMenuOpen) renderSttList(sttSearch?.value || "");
}

function renderSttList(filter = "") {
  if (!sttList) return;
  ensureSttCatalog();
  const q = filter.trim().toLowerCase();
  const filtered = (sttCatalog || []).filter((item) => {
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
    );
  });

  // Available (installed) languages first, then the rest.
  const items = [...filtered].sort((a, b) => {
    const ai = a.installed ? 0 : 1;
    const bi = b.installed ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return String(a.name).localeCompare(String(b.name));
  });

  sttList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matches";
    sttList.appendChild(empty);
    return;
  }

  const loading = Boolean(sttInstallBusy);

  for (const item of items) {
    const li = document.createElement("li");
    if (item.installed) li.classList.add("is-installed");
    if (item.code === sttLanguage) li.classList.add("is-current");
    if (sttInstallBusy === item.code) {
      li.classList.add("is-loading");
      li.style.setProperty("--stt-load-pct", `${sttInstallProgress || 0}%`);
    }

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "stt-select";
    selectBtn.dataset.code = item.code;
    if (item.code === sttLanguage) selectBtn.classList.add("is-active");
    selectBtn.disabled = loading;

    const check = item.installed
      ? `<span class="stt-check" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9.2 16.6 5.4 12.8l1.4-1.4 2.4 2.4 6.6-6.6 1.4 1.4z"/></svg>
        </span>`
      : `<span class="stt-check stt-check-empty" aria-hidden="true"></span>`;

    selectBtn.innerHTML = `${check}<span class="stt-select-text">${item.name}<span class="stt-meta">${
      item.sizeLabel || ""
    }</span></span>`;

    selectBtn.addEventListener("click", () => {
      if (loading) return;
      if (item.installed) {
        selectSttLanguage(item.code);
        return;
      }
      // Highlight unavailable language; user then clicks +.
      sttList.querySelectorAll(".stt-select.is-picked").forEach((el) => {
        el.classList.remove("is-picked");
      });
      selectBtn.classList.add("is-picked");
      sttPendingAdd = item.code;
    });
    li.appendChild(selectBtn);

    if (!item.installed) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "stt-add ghost";
      addBtn.title = "Download language model";
      addBtn.setAttribute("aria-label", `Add ${item.name}`);
      addBtn.textContent = sttInstallBusy === item.code ? "…" : "+";
      addBtn.disabled = loading;
      addBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (loading) return;
        sttPendingAdd = item.code;
        addSttModel(item.code);
      });
      li.appendChild(addBtn);
    }

    sttList.appendChild(li);
  }
}

async function refreshSttCatalog() {
  try {
    const catalog = await chrome.runtime.sendMessage({ type: "GET_STT_CATALOG" });
    if (catalog?.ok) {
      applySttState(catalog);
      return;
    }
  } catch {
    // fall through to local list
  }
  ensureSttCatalog();
  setSttLabel(sttLanguage, sttCatalog);
  if (sttMenuOpen) renderSttList(sttSearch?.value || "");
}

function setSttMenuOpen(open) {
  if (sttInstallBusy && open) return;
  sttMenuOpen = !!open;
  if (sttMenu) sttMenu.hidden = !sttMenuOpen;
  sttBtn?.setAttribute("aria-expanded", sttMenuOpen ? "true" : "false");
  if (sttMenuOpen) {
    setLangMenuOpen(false);
    ensureSttCatalog();
    renderSttList(sttSearch?.value || "");
    refreshSttCatalog();
    requestAnimationFrame(() => sttSearch?.focus());
  }
}

async function selectSttLanguage(code) {
  if (sttInstallBusy) return;
  setSttLabel(code);
  setSttMenuOpen(false);
  setStatus("Switching speech language…");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "SET_STT_LANGUAGE",
      code,
    });
    if (!result?.ok) {
      setStatus(result?.error || "Could not switch speech language", true);
      return;
    }
    setStatus(`Speech: ${sttBtnLabel?.textContent || code}`);
  } catch (error) {
    setStatus(error?.message || "Speech language update failed", true);
  }
}

async function addSttModel(code) {
  if (sttInstallBusy) return;
  const target = code || sttPendingAdd;
  if (!target) {
    setStatus("Select a language first", true);
    return;
  }
  sttInstallBusy = target;
  sttInstallProgress = 0;
  setSttUiBusy(true);
  setSttProgress(0, { visible: true });
  renderSttList(sttSearch?.value || "");
  setStatus("Downloading speech model…");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "ADD_STT_MODEL",
      code: target,
    });
    if (!result?.ok) {
      setStatus(result?.error || "Could not add language model", true);
      return;
    }
    const catalog = await chrome.runtime.sendMessage({ type: "GET_STT_CATALOG" });
    if (catalog?.ok) applySttState(catalog);
    // After install, switch to that language.
    sttInstallBusy = null;
    setSttProgress(100, { visible: false });
    setSttUiBusy(false);
    await selectSttLanguage(target);
    setStatus("Speech language ready");
  } catch (error) {
    setStatus(error?.message || "Model download failed", true);
  } finally {
    sttInstallBusy = null;
    sttPendingAdd = null;
    setSttProgress(0, { visible: false });
    setSttUiBusy(false);
    renderSttList(sttSearch?.value || "");
  }
}

function renderSessionList(
  container,
  sessions,
  { checkpoint = null, hasPartial = false } = {}
) {
  if (!container) return;
  container.innerHTML = "";
  const list = Array.isArray(sessions) ? sessions : [];
  // Show after last pasted finished session when there is still content below
  // (more finished sessions, or a live unfinished partial).
  const showMark =
    checkpoint != null &&
    checkpoint > 0 &&
    checkpoint <= list.length &&
    (checkpoint < list.length || hasPartial);

  for (let i = 0; i < list.length; i += 1) {
    const item = document.createElement("div");
    item.className = "session-item";
    item.textContent = list[i];
    container.appendChild(item);
    if (showMark && i === checkpoint - 1) {
      const mark = document.createElement("div");
      mark.className = "paste-checkpoint";
      mark.title = "Last paste point";
      container.appendChild(mark);
    }
  }

  container.classList.toggle(
    "checkpoint-at-end",
    Boolean(showMark && checkpoint === list.length && hasPartial)
  );
}

function renderTranscript() {
  const stick = isPinnedToBottom(transcriptEl);
  const sessions =
    localSessions.length > 0
      ? localSessions
      : localFinal.trim()
        ? [localFinal.trim()]
        : [];
  renderSessionList(transcriptSessionsEl, sessions, {
    checkpoint: localPasteCheckpoint,
    hasPartial: Boolean(localPartial.trim()),
  });
  partialTextEl.textContent = localPartial.trim();
  partialTextEl.classList.toggle(
    "has-split",
    Boolean(sessions.length && localPartial.trim())
  );
  const hasText = Boolean(sessions.length || localPartial.trim());
  transcriptEl.classList.toggle("show-placeholder", !hasText);
  if (stick) {
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
}

function renderTranslation() {
  const stick = isPinnedToBottom(translateTextEl);
  renderSessionList(translateSessionsEl, localTranslatedSessions, {
    checkpoint: localPasteCheckpoint,
    hasPartial: Boolean(localTranslatedPartial.trim()),
  });
  if (translatePartialEl) {
    translatePartialEl.textContent = localTranslatedPartial.trim();
    translatePartialEl.classList.toggle(
      "has-split",
      Boolean(localTranslatedSessions.length && localTranslatedPartial.trim())
    );
  }
  const hasText = Boolean(
    localTranslatedSessions.length || localTranslatedPartial.trim()
  );
  translateTextEl.classList.toggle("show-placeholder", !hasText);
  if (stick) {
    translateTextEl.scrollTop = translateTextEl.scrollHeight;
  }
}

function setTranslateOpen(open) {
  const next = !!open;
  translateOpen = next;
  panelRoot.classList.toggle("translate-open", next);
  translatePane.classList.toggle("is-open", next);
  translatePane.setAttribute("aria-hidden", next ? "false" : "true");
  if (!next) setLangMenuOpen(false);

  translateBtn.classList.toggle("is-active", next);
  translateBtn.setAttribute("aria-pressed", next ? "true" : "false");
  translateBtn.title = next ? "Hide translation" : "Translate";
}

function setSubmitBusy(busy) {
  submitBusy = !!busy;
  submitBtn.classList.toggle("is-busy", submitBusy);
  submitBtn.disabled = submitBusy || Boolean(sttInstallBusy);
  submitBtn.setAttribute("aria-busy", submitBusy ? "true" : "false");
  submitBtn.title = submitBusy ? "Waiting…" : "Paste and send";
}

function setCapturingUi(capturing) {
  dotEl.classList.toggle("live", capturing);
  if (sttInstallBusy) {
    shareBtn.disabled = true;
    stopBtn.disabled = true;
    submitBtn.disabled = true;
    return;
  }
  shareBtn.disabled = capturing;
  stopBtn.disabled = !capturing;
  if (!submitBusy) submitBtn.disabled = false;
}

shareBtn.addEventListener("click", async () => {
  setStatus("Opening…");
  shareBtn.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_CAPTURE_HOST" });
    if (!result?.ok) {
      setStatus(result?.error || "Failed", true);
      setCapturingUi(false);
      return;
    }
    setStatus("Pick audio in the share window");
    shareBtn.disabled = false;
  } catch (error) {
    setStatus(error?.message || "Failed", true);
    setCapturingUi(false);
  }
});

stopBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  setCapturingUi(false);
  setStatus("Stopped");
});

translateBtn.addEventListener("click", async () => {
  const next = !translateOpen;
  setTranslateOpen(next);
  setStatus(next ? "Translating…" : "Ready");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "TOGGLE_TRANSLATE",
      open: next,
    });
    if (typeof result?.translateOpen === "boolean") {
      setTranslateOpen(result.translateOpen);
    }
  } catch (error) {
    setTranslateOpen(false);
    setStatus(error?.message || "Translate failed", true);
  }
});

langBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setLangMenuOpen(!langMenuOpen);
});

sttBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  setSttMenuOpen(!sttMenuOpen);
});

langSearch.addEventListener("input", () => {
  renderLangList(langSearch.value);
});

sttSearch?.addEventListener("input", () => {
  renderSttList(sttSearch.value);
});

langSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setLangMenuOpen(false);
    langBtn.focus();
  }
});

sttSearch?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSttMenuOpen(false);
    sttBtn?.focus();
  }
});

document.addEventListener("click", (event) => {
  if (langMenuOpen && !event.target.closest("#langPicker")) {
    setLangMenuOpen(false);
  }
  if (sttMenuOpen && !event.target.closest("#sttPicker")) {
    setSttMenuOpen(false);
  }
});

submitBtn.addEventListener("click", async () => {
  if (submitBusy) return;
  setStatus("Waiting for speech…");
  setSubmitBusy(true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "SUBMIT_TRANSCRIPT" });
    if (!result?.ok) {
      setStatus(result?.error || "Focus an input first", true);
      return;
    }
    localFinal = "";
    localPartial = "";
    renderTranscript();
    setStatus(result.empty ? "Nothing to send" : result.sent ? "Sent" : "Pasted");
  } catch (error) {
    setStatus(error?.message || "Send failed", true);
  } finally {
    setSubmitBusy(false);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "STATE_UPDATE") return;

  if (typeof message.transcript === "string") localFinal = message.transcript;
  if (typeof message.partial === "string") localPartial = message.partial;
  if (Array.isArray(message.scriptSessions)) {
    localSessions = message.scriptSessions.filter(Boolean);
  }
  if (typeof message.pasteCheckpoint === "number") {
    localPasteCheckpoint = Math.max(0, message.pasteCheckpoint);
  }
  if (Array.isArray(message.translatedSessions)) {
    localTranslatedSessions = message.translatedSessions.filter(Boolean);
  } else if (typeof message.translatedText === "string" && message.translatedText) {
    // fallback for older payloads
    localTranslatedSessions = [message.translatedText];
  }
  if (typeof message.translatedPartial === "string") {
    localTranslatedPartial = message.translatedPartial;
  }
  if (typeof message.translateTarget === "string") {
    setLanguageLabel(message.translateTarget);
  }
  if (typeof message.translateOpen === "boolean") {
    setTranslateOpen(message.translateOpen);
  }
  applySttState(message);
  renderTranscript();
  renderTranslation();
  setCapturingUi(!!message.capturing);

  if (typeof message.busy === "boolean") {
    setSubmitBusy(message.busy);
  }

  if (message.error) setStatus(message.error, true);
  else if (message.status) setStatus(message.status);
  else if (message.capturing) setStatus("Listening");
});

chrome.runtime
  .sendMessage({ type: "GET_STATE" })
  .then((state) => {
    if (!state) return;
    localFinal = state.transcript || "";
    localPartial = state.partial || "";
    localSessions = Array.isArray(state.scriptSessions)
      ? state.scriptSessions.filter(Boolean)
      : [];
    localPasteCheckpoint =
      typeof state.pasteCheckpoint === "number"
        ? Math.max(0, state.pasteCheckpoint)
        : 0;
    localTranslatedSessions = Array.isArray(state.translatedSessions)
      ? state.translatedSessions.filter(Boolean)
      : [];
    localTranslatedPartial = state.translatedPartial || "";
    if (state.translateTarget) setLanguageLabel(state.translateTarget);
    renderTranscript();
    renderTranslation();
    setCapturingUi(!!state.capturing);
    if (typeof state.busy === "boolean") setSubmitBusy(state.busy);
    if (typeof state.translateOpen === "boolean") {
      setTranslateOpen(state.translateOpen);
    }
    applySttState(state);
  })
  .catch(() => {});

chrome.runtime
  .sendMessage({ type: "GET_STT_CATALOG" })
  .then((catalog) => {
    if (catalog?.ok) applySttState(catalog);
    else {
      ensureSttCatalog();
      setSttLabel(sttLanguage);
    }
  })
  .catch(() => {
    ensureSttCatalog();
    setSttLabel(sttLanguage);
  });

// Show English immediately even before background responds.
ensureSttCatalog();
setSttLabel(sttLanguage);

chrome.storage.local.get(["translateTarget"], (stored) => {
  if (stored?.translateTarget) setLanguageLabel(stored.translateTarget);
});

chrome.storage.sync.get(["hotkey"], (stored) => {
  setHotkeyBadge(stored?.hotkey || DEFAULT_HOTKEY);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hotkey) {
    setHotkeyBadge(changes.hotkey.newValue || DEFAULT_HOTKEY);
  }
  if (area === "local" && changes.translateTarget?.newValue) {
    setLanguageLabel(changes.translateTarget.newValue);
  }
});

renderTranscript();
renderTranslation();
setStatus("Ready");
setCapturingUi(false);
setHotkeyBadge(DEFAULT_HOTKEY);
setLanguageLabel(translateTarget);
setTranslateOpen(false);
renderLangList();
