const MODEL_URL = chrome.runtime.getURL("models/en-us-small.tar.gz");

let mediaStream = null;
let audioContext = null;
let processorNode = null;
let silentGain = null;
let sourceNode = null;
let voskModel = null;
let recognizer = null;
let modelReady = false;

const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

async function ensureModel() {
  if (voskModel) {
    modelReady = true;
    return;
  }

  if (!globalThis.Vosk?.createModel) {
    throw new Error("Vosk library failed to load.");
  }

  setStatus("Loading free speech model (one-time)…");
  voskModel = await globalThis.Vosk.createModel(MODEL_URL);
  modelReady = true;
  setStatus("Model ready — click Share audio.");
  shareBtn.disabled = false;
}

async function startCapture() {
  if (!modelReady) {
    setStatus("Speech model is still loading…", true);
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
    });
  } catch (error) {
    const message =
      error?.name === "NotAllowedError"
        ? "Share cancelled. Try again and enable audio sharing."
        : error?.message || "Could not start screen/audio share.";
    setStatus(message, true);
    await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
    return;
  }

  const audioTracks = mediaStream.getAudioTracks();
  if (!audioTracks.length) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    const message =
      "No audio track. Enable “Share tab audio” or “Share system audio” in the picker.";
    setStatus(message, true);
    await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
    return;
  }

  mediaStream.getVideoTracks().forEach((track) => track.stop());

  audioTracks[0].addEventListener("ended", async () => {
    setStatus("Audio share ended.");
    await stopCapture({ notifyEnded: true });
  });

  audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  recognizer = new voskModel.KaldiRecognizer(audioContext.sampleRate);
  recognizer.setWords(true);

  recognizer.on("result", (message) => {
    const text = (message?.result?.text || "").trim();
    if (!text) return;
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text });
    setStatus(`Heard: ${text.slice(0, 90)}${text.length > 90 ? "…" : ""}`);
  });

  recognizer.on("partialresult", (message) => {
    const text = (message?.result?.partial || "").trim();
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_PARTIAL", text });
  });

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processorNode.onaudioprocess = (event) => {
    try {
      recognizer.acceptWaveform(event.inputBuffer);
    } catch (error) {
      console.error("acceptWaveform failed", error);
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  shareBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus("Live capture running… keep this window open.");
  await chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
}

async function stopCapture({ notifyEnded = false } = {}) {
  if (processorNode) {
    processorNode.onaudioprocess = null;
    try {
      processorNode.disconnect();
    } catch {
      // ignore
    }
    processorNode = null;
  }

  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch {
      // ignore
    }
    sourceNode = null;
  }

  if (silentGain) {
    try {
      silentGain.disconnect();
    } catch {
      // ignore
    }
    silentGain = null;
  }

  if (audioContext) {
    try {
      await audioContext.close();
    } catch {
      // ignore
    }
    audioContext = null;
  }

  if (recognizer) {
    try {
      recognizer.remove();
    } catch {
      // ignore
    }
    recognizer = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  shareBtn.disabled = !modelReady;
  stopBtn.disabled = true;
  setStatus(modelReady ? "Stopped." : "Speech model not ready.");

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target && message.target !== "capture") {
    return;
  }

  if (message?.type === "CAPTURE_PAGE_STOP") {
    stopCapture({ notifyEnded: false }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

ensureModel().catch(async (error) => {
  const message = error?.message || String(error);
  setStatus(message, true);
  shareBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
});
