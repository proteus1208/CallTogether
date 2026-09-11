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

const platform = detectPlatform();

function detectPlatform() {
  const uaPlatform = navigator.userAgentData?.platform || navigator.platform || "";
  const ua = `${uaPlatform} ${navigator.userAgent}`.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux") || ua.includes("cros")) return "linux";
  return "unknown";
}

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

function updatePlatformHint() {
  hintEl.textContent =
    platform === "windows"
      ? "Start listening opens a Chrome mic permission alert. For call audio, use Stereo Mix or speakers."
      : "Start listening opens a Chrome mic permission alert if needed.";
}

async function startCapture() {
  shareBtn.disabled = true;
  setStatus("Checking microphone permission…");
  const result = await chrome.runtime.sendMessage({ type: "START_LISTENING" });

  if (result?.needsPermission) {
    setStatus("Click “Allow microphone” in the popup — Chrome will ask you.");
    shareBtn.disabled = false;
    return;
  }

  if (!result?.ok) {
    setStatus(result?.error || "Could not start listening.", true);
    shareBtn.disabled = false;
  }
}

async function stopCapture() {
  setStatus("Stopping…");
  await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  setCapturingUi(false);
  setStatus("Stopped.");
}

shareBtn.addEventListener("click", () => {
  startCapture();
});

stopBtn.addEventListener("click", async () => {
  await stopCapture();
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

  if (typeof message.transcript === "string") {
    localFinal = message.transcript;
  }
  if (typeof message.partial === "string") {
    localPartial = message.partial;
  }
  renderTranscript();
  setCapturingUi(!!message.capturing);

  if (message.error) {
    setStatus(message.error, true);
  } else if (message.capturing) {
    setStatus(`Listening (${platform})…`);
  }
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

updatePlatformHint();
renderTranscript();
setStatus("Ready — Start listening will ask for mic permission");
setCapturingUi(false);
