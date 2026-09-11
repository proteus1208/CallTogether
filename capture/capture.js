let mediaStream = null;
let mediaRecorder = null;
let chunkTimer = null;
let audioChunks = [];
let openaiApiKey = "";
let whisperModel = "whisper-1";
let chunkSeconds = 4;
let transcribing = false;

const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    "openaiApiKey",
    "whisperModel",
    "chunkSeconds",
  ]);
  openaiApiKey = settings.openaiApiKey || "";
  whisperModel = settings.whisperModel || "whisper-1";
  chunkSeconds = Math.max(2, Number(settings.chunkSeconds) || 4);
}

async function startCapture() {
  await loadSettings();

  if (!openaiApiKey) {
    setStatus("Missing OpenAI API key. Open Settings first.", true);
    await chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
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

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
  audioChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.start(1000);
  chunkTimer = setInterval(() => {
    flushAndTranscribe().catch((error) => {
      console.error(error);
      setStatus(error.message || "Transcription error", true);
    });
  }, chunkSeconds * 1000);

  shareBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus("Capturing audio… keep this window open.");
  await chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
}

async function flushAndTranscribe() {
  if (!mediaRecorder || mediaRecorder.state === "inactive" || transcribing) {
    return;
  }

  transcribing = true;
  try {
    const parts = await new Promise((resolve) => {
      const handle = (event) => {
        mediaRecorder.removeEventListener("dataavailable", handle);
        const pending = [...audioChunks];
        audioChunks = [];
        if (event.data?.size) pending.push(event.data);
        resolve(pending);
      };
      mediaRecorder.addEventListener("dataavailable", handle);
      mediaRecorder.requestData();
    });

    if (!parts.length) return;

    const blob = new Blob(parts, {
      type: mediaRecorder.mimeType || "audio/webm",
    });
    if (blob.size < 2500) return;

    const text = await transcribeBlob(blob);
    if (text) {
      await chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text });
      setStatus(`Last chunk: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);
    }
  } finally {
    transcribing = false;
  }
}

async function transcribeBlob(blob) {
  const form = new FormData();
  form.append("file", blob, "chunk.webm");
  form.append("model", whisperModel);
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whisper error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  return (data.text || "").trim();
}

async function stopCapture({ notifyEnded = false } = {}) {
  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try {
      await flushAndTranscribe();
    } catch {
      // ignore
    }
    try {
      mediaRecorder.stop();
    } catch {
      // ignore
    }
  }

  mediaRecorder = null;
  audioChunks = [];

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  shareBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus(notifyEnded ? "Stopped." : "Stopped.");

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

loadSettings().then(() => {
  setStatus("Ready — click Share audio.");
});
