const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const submitBtn = document.getElementById("submitBtn");
const finalTextEl = document.getElementById("finalText");
const partialTextEl = document.getElementById("partialText");
const transcriptEl = document.getElementById("transcript");
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

function setCapturingUi(capturing) {
  dotEl.classList.toggle("live", capturing);
  shareBtn.disabled = capturing;
  stopBtn.disabled = !capturing;
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

submitBtn.addEventListener("click", async () => {
  // Clear local UI immediately; background also clears stored history.
  localFinal = "";
  localPartial = "";
  renderTranscript();
  const result = await chrome.runtime.sendMessage({ type: "SUBMIT_TRANSCRIPT" });
  if (!result?.ok) {
    setStatus(result?.error || "Focus an input first", true);
    return;
  }
  localFinal = "";
  localPartial = "";
  renderTranscript();
  setStatus(result.empty ? "Nothing to send" : result.sent ? "Sent" : "Pasted");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "STATE_UPDATE") return;

  if (typeof message.transcript === "string") localFinal = message.transcript;
  if (typeof message.partial === "string") localPartial = message.partial;
  renderTranscript();
  setCapturingUi(!!message.capturing);

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
    renderTranscript();
    setCapturingUi(!!state.capturing);
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
setStatus("Ready");
setCapturingUi(false);
setHotkeyBadge(DEFAULT_HOTKEY);
