const SpeechRecognition =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

let recognition = null;
let shouldRun = false;
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
  if (platform === "windows") {
    hintEl.textContent =
      "Uses Chrome Speech (mic). For call audio on Windows: enable Stereo Mix as mic, or play the call on speakers.";
  } else if (platform === "macos") {
    hintEl.textContent =
      "Uses Chrome Speech (mic). For call audio on macOS, use a virtual audio device (e.g. BlackHole) as the mic.";
  } else {
    hintEl.textContent =
      "Uses Chrome Speech (mic). Route call audio to the mic if you need system sound.";
  }
}

function createRecognition() {
  if (!SpeechRecognition) {
    throw new Error("Chrome Speech API is unavailable in this browser.");
  }

  const instance = new SpeechRecognition();
  instance.continuous = true;
  instance.interimResults = true;
  instance.lang = "en-US";
  instance.maxAlternatives = 1;

  instance.onstart = () => {
    setCapturingUi(true);
    setStatus(`Listening (${platform})…`);
    chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
  };

  instance.onerror = (event) => {
    const error = event?.error || "speech error";
    if (error === "aborted" || error === "no-speech") {
      return;
    }
    if (error === "not-allowed") {
      setStatus("Microphone permission denied.", true);
      shouldRun = false;
      setCapturingUi(false);
      chrome.runtime.sendMessage({
        type: "CAPTURE_ERROR",
        error: "Microphone permission denied.",
      });
      return;
    }
    setStatus(`Speech error: ${error}`, true);
  };

  instance.onend = () => {
    if (shouldRun) {
      // Chrome stops periodically; restart for continuous capture.
      try {
        instance.start();
      } catch {
        setCapturingUi(false);
        shouldRun = false;
        chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
      }
      return;
    }
    setCapturingUi(false);
    setStatus("Stopped.");
    chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
  };

  instance.onresult = (event) => {
    let interim = "";
    let newlyFinal = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = (result[0]?.transcript || "").trim();
      if (!text) continue;
      if (result.isFinal) newlyFinal += `${text} `;
      else interim += `${text} `;
    }

    newlyFinal = newlyFinal.trim();
    interim = interim.trim();

    if (newlyFinal) {
      localFinal = localFinal ? `${localFinal} ${newlyFinal}` : newlyFinal;
      localPartial = "";
      renderTranscript();
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text: newlyFinal });
      setStatus(`Heard: ${newlyFinal.slice(0, 80)}${newlyFinal.length > 80 ? "…" : ""}`);
    } else {
      localPartial = interim;
      renderTranscript();
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_PARTIAL", text: interim });
    }
  };

  return instance;
}

async function startCapture() {
  if (!SpeechRecognition) {
    const message =
      "Chrome Speech API missing. Use Google Chrome (MV3 blocks Vosk/eval models).";
    setStatus(message, true);
    await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
    return;
  }

  try {
    // Prime mic permission with a real user gesture.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    const message = "Microphone permission is required.";
    setStatus(message, true);
    await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
    return;
  }

  if (!recognition) {
    recognition = createRecognition();
  }

  shouldRun = true;
  shareBtn.disabled = true;
  try {
    recognition.start();
  } catch (error) {
    shouldRun = false;
    shareBtn.disabled = false;
    setStatus(error?.message || "Could not start listening.", true);
  }
}

async function stopCapture({ notifyEnded = false } = {}) {
  shouldRun = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      // ignore
    }
  }
  setCapturingUi(false);
  setStatus("Stopped.");
  if (notifyEnded) {
    await chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
  }
}

shareBtn.addEventListener("click", () => {
  startCapture();
});

stopBtn.addEventListener("click", async () => {
  await stopCapture({ notifyEnded: true });
});

clearBtn.addEventListener("click", async () => {
  localFinal = "";
  localPartial = "";
  renderTranscript();
  await chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" });
  setStatus("Cleared.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target && message.target !== "capture" && message.target !== "panel") {
    return;
  }

  if (message?.type === "CAPTURE_PAGE_STOP") {
    stopCapture({ notifyEnded: false }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "STATE_UPDATE") {
    if (typeof message.transcript === "string") {
      localFinal = message.transcript;
    }
    if (typeof message.partial === "string") {
      localPartial = message.partial;
    }
    renderTranscript();
    setCapturingUi(!!message.capturing);
    if (message.error) setStatus(message.error, true);
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
setStatus("Ready — no model download needed");
setCapturingUi(false);
