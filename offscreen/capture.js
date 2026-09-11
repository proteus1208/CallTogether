const MODEL_URL = chrome.runtime.getURL("models/en-us-small.tar.gz");
const sandbox = document.getElementById("sandbox");

let mediaStream = null;
let audioContext = null;
let processorNode = null;
let silentGain = null;
let sourceNode = null;
let sandboxReady = false;
let modelReady = false;
let modelBuffer = null;
let pendingStart = null;

function sendToSandbox(message, transfer = []) {
  sandbox.contentWindow?.postMessage(message, "*", transfer);
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

async function prepareModel() {
  await waitForSandboxReady();

  // Prefer letting the sandbox load its local model.tar.gz.
  // Still send a buffer fallback if relative load fails inside sandbox.
  let copy = null;
  try {
    await ensureModelBuffer();
    copy = modelBuffer.slice(0);
  } catch (error) {
    console.warn("Could not prefetch model buffer", error);
  }

  if (copy) {
    sendToSandbox({ type: "LOAD_MODEL", modelBuffer: copy }, [copy]);
  } else {
    sendToSandbox({ type: "LOAD_MODEL" });
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Speech model init timed out.")),
      120000
    );
    const onMessage = (event) => {
      if (event.source !== sandbox.contentWindow) return;
      const data = event.data;
      if (data?.type === "STATUS") {
        chrome.runtime.sendMessage({
          type: "CAPTURE_STATUS",
          text: data.text || "Loading model…",
        });
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

async function getDesktopAudioStream(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
        maxWidth: 16,
        maxHeight: 16,
      },
    },
  });
  stream.getVideoTracks().forEach((track) => track.stop());
  return stream;
}

async function startCapture(streamId) {
  if (!streamId) {
    return { ok: false, error: "No tab/window was selected." };
  }

  try {
    if (!modelReady) {
      await chrome.runtime.sendMessage({
        type: "CAPTURE_STATUS",
        text: "Loading local speech model…",
      });
      await prepareModel();
    }

    mediaStream = await getDesktopAudioStream(streamId);
  } catch (error) {
    return {
      ok: false,
      error:
        error?.message ||
        "Could not capture tab audio. Pick a Chrome tab and enable audio.",
    };
  }

  const audioTracks = mediaStream.getAudioTracks();
  if (!audioTracks.length) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    return {
      ok: false,
      error:
        "No audio in that share. Choose a tab/window and enable “Share tab audio” / system audio.",
    };
  }

  audioTracks[0].addEventListener("ended", async () => {
    await stopCapture();
    chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
  });

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

  await chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
  return { ok: true };
}

async function stopCapture() {
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
  return { ok: true };
}

window.addEventListener("message", (event) => {
  // Only accept sandbox messages.
  if (event.source !== sandbox.contentWindow) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "SANDBOX_READY") {
    sandboxReady = true;
    return;
  }
  if (data.type === "RESULT" && data.text) {
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text: data.text });
    return;
  }
  if (data.type === "PARTIAL") {
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_PARTIAL", text: data.text || "" });
    return;
  }
  if (data.type === "ERROR") {
    chrome.runtime.sendMessage({
      type: "CAPTURE_ERROR",
      error: data.error || "Transcription error",
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target && message.target !== "offscreen") return;

  if (message?.type === "OFFSCREEN_START_CAPTURE") {
    startCapture(message.streamId)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }

  if (message?.type === "OFFSCREEN_STOP_CAPTURE") {
    stopCapture().then(sendResponse);
    return true;
  }
});
