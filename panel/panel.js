let localFinal = "";
let localPartial = "";

const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const finalTextEl = document.getElementById("finalText");
const partialTextEl = document.getElementById("partialText");
const transcriptEl = document.getElementById("transcript");
const hintEl = document.getElementById("hint");
const dotEl = document.querySelector("[data-dot]");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function renderTranscript() {
  const hasText = Boolean(localFinal.trim() || localPartial.trim());
  transcriptEl.classList.toggle("show-placeholder", !hasText);
  finalTextEl.textContent = localFinal.trim() ? `${localFinal.trim()} ` : "";
  partialTextEl.textContent = localPartial.trim();
}

function setCapturingUi(capturing) {
  dotEl.classList.toggle("live", capturing);
  shareBtn.disabled = capturing;
  stopBtn.disabled = !capturing;
}

async function startCapture() {
  shareBtn.disabled = true;
  setStatus("Starting…");

  const { micGranted } = await chrome.storage.local.get({ micGranted: false });
  if (!micGranted) {
    // AI pages block mic prompts inside the float iframe.
    // Open the toolbar popup so Chrome can show the real Allow/Block dialog.
    try {
      await chrome.action.openPopup();
      setStatus("In the popup, click Start listening — Chrome will ask Allow/Block.");
    } catch {
      setStatus(
        "Click the CallTogether icon in the toolbar → Start listening (Chrome mic dialog).",
        true
      );
    }
    shareBtn.disabled = false;
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: "START_LISTENING" });
  if (result?.needsPermission || !result?.ok) {
    setStatus(
      result?.error ||
        "Click the CallTogether toolbar icon → Start listening for Chrome’s mic dialog.",
      true
    );
    shareBtn.disabled = false;
    return;
  }
}

shareBtn.addEventListener("click", () => {
  startCapture();
});

stopBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  setCapturingUi(false);
  setStatus("Stopped.");
});

clearBtn.addEventListener("click", async () => {
  localFinal = "";
  localPartial = "";
  renderTranscript();
  await chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" });
  setStatus("Cleared.");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "STATE_UPDATE") return;

  if (typeof message.transcript === "string") localFinal = message.transcript;
  if (typeof message.partial === "string") localPartial = message.partial;
  renderTranscript();
  setCapturingUi(!!message.capturing);

  if (message.error) setStatus(message.error, true);
  else if (message.capturing) setStatus("Listening…");
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

hintEl.textContent =
  "First time: toolbar icon → Start listening → Chrome Allow/Block. No model files needed.";
renderTranscript();
setStatus("Ready");
setCapturingUi(false);
