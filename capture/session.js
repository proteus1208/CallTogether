const MODEL_URL = chrome.runtime.getURL("models/en-us-small.tar.gz");
const sandbox = document.getElementById("sandbox");
const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");

let mediaStream = null;
let audioContext = null;
let processorNode = null;
let silentGain = null;
let sourceNode = null;
let sandboxReady = false;
let modelReady = false;
let modelBuffer = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  chrome.runtime.sendMessage({
    type: isError ? "CAPTURE_ERROR" : "CAPTURE_STATUS",
    text: isError ? undefined : text,
    error: isError ? text : undefined,
  }).catch(() => {});
}

function sendToSandbox(message, transfer = []) {
  sandbox.contentWindow?.postMessage(message, "*", transfer);
}

function waitForSandboxReady() {
  if (sandboxReady) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (sandboxReady) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

async function ensureModelBuffer() {
  if (modelBuffer) return modelBuffer;
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Could not read local speech model (${response.status}).`);
  }
  modelBuffer = await response.arrayBuffer();
  return modelBuffer;
}

async function prepareModel() {
  await waitForSandboxReady();
  let copy = null;
  try {
    await ensureModelBuffer();
    copy = modelBuffer.slice(0);
  } catch (error) {
    console.warn(error);
  }

  if (copy) sendToSandbox({ type: "LOAD_MODEL", modelBuffer: copy }, [copy]);
  else sendToSandbox({ type: "LOAD_MODEL" });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Speech model init timed out.")),
      120000
    );
    const onMessage = (event) => {
      if (event.source !== sandbox.contentWindow) return;
      const data = event.data;
      if (data?.type === "STATUS") {
        setStatus(data.text || "Loading model…");
        return;
      }
      if (data?.type === "MODEL_READY") {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        modelReady = true;
        resolve();
      }
      if (data?.type === "ERROR") {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        reject(new Error(data.error || "Model load failed."));
      }
    };
    window.addEventListener("message", onMessage);
  });
}

async function startScreenShare() {
  shareBtn.disabled = true;
  try {
    if (!modelReady) {
      setStatus("Loading local speech model…");
      await prepareModel();
    }

    setStatus("Pick Entire Screen and enable Share system audio…");
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "monitor",
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      preferCurrentTab: false,
    });
  } catch (error) {
    shareBtn.disabled = false;
    const message =
      error?.name === "NotAllowedError"
        ? "Share cancelled."
        : error?.message || "Could not start screen share.";
    setStatus(message, true);
    return;
  }

  const audioTracks = mediaStream.getAudioTracks();
  if (!audioTracks.length) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    shareBtn.disabled = false;
    setStatus(
      "No audio track. Choose Entire Screen and enable Share system audio (not Window).",
      true
    );
    return;
  }

  mediaStream.getVideoTracks().forEach((track) => track.stop());
  audioTracks[0].addEventListener("ended", () => stopCapture(true));

  audioContext = new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processorNode.onaudioprocess = (event) => {
    if (!modelReady) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm = new Float32Array(input);
    sendToSandbox(
      {
        type: "AUDIO",
        pcm,
        sampleRate: audioContext.sampleRate,
      },
      [pcm.buffer]
    );
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  stopBtn.disabled = false;
  setStatus("Capturing system/screen audio… keep this window open.");
  chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" }).catch(() => {});
}

async function stopCapture(ended = false) {
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
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  sendToSandbox({ type: "RESET" });
  shareBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus(ended ? "Share ended." : "Stopped.");
  chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" }).catch(() => {});
}

shareBtn.addEventListener("click", () => {
  startScreenShare();
});

stopBtn.addEventListener("click", () => {
  stopCapture(false);
});

window.addEventListener("message", (event) => {
  if (event.source !== sandbox.contentWindow) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "SANDBOX_READY") {
    sandboxReady = true;
    return;
  }
  if (data.type === "STATUS") {
    setStatus(data.text || "Working…");
    return;
  }
  if (data.type === "RESULT" && data.text) {
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text: data.text });
    return;
  }
  if (data.type === "PARTIAL") {
    chrome.runtime.sendMessage({
      type: "TRANSCRIPT_PARTIAL",
      text: data.text || "",
    });
    return;
  }
  if (data.type === "ERROR") {
    setStatus(data.error || "Transcription error", true);
    chrome.runtime.sendMessage({
      type: "CAPTURE_ERROR",
      error: data.error || "Transcription error",
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_PAGE_STOP" || message?.type === "STOP_CAPTURE") {
    stopCapture(false).then(() => sendResponse({ ok: true }));
    return true;
  }
});

setStatus("Click Choose screen… then Entire Screen + Share system audio");
