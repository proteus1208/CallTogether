const statusEl = document.getElementById("status");
const panelRoot = document.getElementById("panelRoot");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const translateBtn = document.getElementById("translateBtn");
const submitBtn = document.getElementById("submitBtn");
const finalTextEl = document.getElementById("finalText");
const partialTextEl = document.getElementById("partialText");
const transcriptEl = document.getElementById("transcript");
const translatePane = document.getElementById("translatePane");
const translateTextEl = document.getElementById("translateText");
const hotkeyBadge = document.getElementById("hotkeyBadge");
const langBtn = document.getElementById("langBtn");
const langBtnLabel = document.getElementById("langBtnLabel");
const langMenu = document.getElementById("langMenu");
const langSearch = document.getElementById("langSearch");
const langList = document.getElementById("langList");
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
let localTranslated = "";
let submitBusy = false;
let translateOpen = false;
let translateTarget = "zh-CN";
let langMenuOpen = false;

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

function renderTranscript() {
  const stick = isPinnedToBottom(transcriptEl);
  const hasText = Boolean(localFinal.trim() || localPartial.trim());
  transcriptEl.classList.toggle("show-placeholder", !hasText);
  finalTextEl.textContent = localFinal.trim() ? `${localFinal.trim()} ` : "";
  partialTextEl.textContent = localPartial.trim();
  if (stick) {
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
}

function renderTranslation() {
  const stick = isPinnedToBottom(translateTextEl);
  const hasText = Boolean(localTranslated.trim());
  translateTextEl.classList.toggle("show-placeholder", !hasText);
  translateTextEl.textContent = localTranslated.trim();
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
  submitBtn.disabled = submitBusy;
  submitBtn.setAttribute("aria-busy", submitBusy ? "true" : "false");
  submitBtn.title = submitBusy ? "Waiting…" : "Paste and send";
}

function setCapturingUi(capturing) {
  dotEl.classList.toggle("live", capturing);
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

clearBtn.addEventListener("click", async () => {
  localFinal = "";
  localPartial = "";
  renderTranscript();
  await chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" });
  setStatus("Cleared");
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

langSearch.addEventListener("input", () => {
  renderLangList(langSearch.value);
});

langSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setLangMenuOpen(false);
    langBtn.focus();
  }
});

document.addEventListener("click", (event) => {
  if (!langMenuOpen) return;
  if (event.target.closest("#langPicker")) return;
  setLangMenuOpen(false);
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
  if (typeof message.translatedText === "string") {
    localTranslated = message.translatedText;
  }
  if (typeof message.translateTarget === "string") {
    setLanguageLabel(message.translateTarget);
  }
  if (typeof message.translateOpen === "boolean") {
    setTranslateOpen(message.translateOpen);
  }
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
    localTranslated = state.translatedText || "";
    if (state.translateTarget) setLanguageLabel(state.translateTarget);
    renderTranscript();
    renderTranslation();
    setCapturingUi(!!state.capturing);
    if (typeof state.busy === "boolean") setSubmitBusy(state.busy);
    if (typeof state.translateOpen === "boolean") {
      setTranslateOpen(state.translateOpen);
    }
  })
  .catch(() => {});

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
