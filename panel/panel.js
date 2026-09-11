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
const dotEl = document.querySelector("[data-dot]");

const DEFAULT_HOTKEY = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: "w",
};

let localFinal = "";
let localPartial = "";
let localTranslated = "";
let submitBusy = false;
let translateOpen = false;

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
  translateOpen = !!open;
  panelRoot.classList.toggle("translate-open", translateOpen);
  translatePane.hidden = !translateOpen;
  translateBtn.classList.toggle("is-active", translateOpen);
  translateBtn.setAttribute("aria-pressed", translateOpen ? "true" : "false");
  translateBtn.title = translateOpen ? "Hide translation" : "Translate";
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
    renderTranscript();
    renderTranslation();
    setCapturingUi(!!state.capturing);
    if (typeof state.busy === "boolean") setSubmitBusy(state.busy);
    if (typeof state.translateOpen === "boolean") {
      setTranslateOpen(state.translateOpen);
    }
  })
  .catch(() => {});

chrome.storage.sync.get(["hotkey"], (stored) => {
  setHotkeyBadge(stored?.hotkey || DEFAULT_HOTKEY);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hotkey) {
    setHotkeyBadge(changes.hotkey.newValue || DEFAULT_HOTKEY);
  }
});

renderTranscript();
renderTranslation();
setStatus("Ready");
setCapturingUi(false);
setHotkeyBadge(DEFAULT_HOTKEY);
setTranslateOpen(false);
