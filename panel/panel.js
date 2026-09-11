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

function chooseSoundSource() {
  return new Promise((resolve) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(
        ["screen", "window", "tab", "audio"],
        (streamId) => resolve(streamId || null)
      );
    } catch (error) {
      console.error(error);
      resolve(null);
    }
  });
}

shareBtn.addEventListener("click", async () => {
  setStatus("Choose what to share…");
  shareBtn.disabled = true;

  const streamId = await chooseSoundSource();
  if (!streamId) {
    setStatus("Cancelled. Pick a source and enable audio.", true);
    setCapturingUi(false);
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "START_TAB_CAPTURE",
    streamId,
  });
  if (!result?.ok) {
    setStatus(result?.error || "Could not capture audio.", true);
    setCapturingUi(false);
    return;
  }
  setCapturingUi(true);
  setStatus("Capturing audio…");
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
  else if (message.status) setStatus(message.status);
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

hintEl.textContent = "Enable audio in Chrome’s dialog · hotkey pastes into AI chat";
renderTranscript();
setStatus("Ready — choose a sound source");
setCapturingUi(false);
