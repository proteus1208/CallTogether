let voskModel = null;
let recognizer = null;
let sampleRate = 48000;

function post(message) {
  parent.postMessage(message, "*");
}

async function loadModel(modelBuffer) {
  if (!globalThis.Vosk?.Model) {
    throw new Error("Vosk failed to load in sandbox.");
  }
  if (voskModel) return;

  const blob = new Blob([modelBuffer], { type: "application/gzip" });
  const url = URL.createObjectURL(blob);

  await new Promise((resolve, reject) => {
    const model = new globalThis.Vosk.Model(url, 0);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Speech model init timed out."));
      }
    }, 120000);

    model.on("load", (message) => {
      if (settled) return;
      if (message?.result) {
        settled = true;
        clearTimeout(timer);
        voskModel = model;
        resolve();
      } else {
        settled = true;
        clearTimeout(timer);
        reject(new Error("Speech model failed to load."));
      }
    });

    model.on("error", (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message?.error || "Vosk model error."));
    });
  });
}

function ensureRecognizer(rate) {
  if (recognizer && sampleRate === rate) return;
  if (recognizer) {
    try {
      recognizer.remove();
    } catch {
      // ignore
    }
  }
  sampleRate = rate || 48000;
  recognizer = new voskModel.KaldiRecognizer(sampleRate);
  recognizer.setWords(true);

  recognizer.on("result", (message) => {
    const text = (message?.result?.text || "").trim();
    if (text) post({ type: "RESULT", text });
  });

  recognizer.on("partialresult", (message) => {
    const text = (message?.result?.partial || "").trim();
    post({ type: "PARTIAL", text });
  });
}

function acceptPcm(float32Array, rate) {
  if (!voskModel) return;
  ensureRecognizer(rate);

  try {
    const offline = new OfflineAudioContext(1, float32Array.length, rate);
    const buffer = offline.createBuffer(1, float32Array.length, rate);
    buffer.copyToChannel(float32Array, 0);
    recognizer.acceptWaveform(buffer);
  } catch (error) {
    post({ type: "ERROR", error: error?.message || String(error) });
  }
}

window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  try {
    if (data.type === "LOAD_MODEL") {
      post({ type: "STATUS", text: "Loading speech model…" });
      await loadModel(data.modelBuffer);
      post({ type: "MODEL_READY" });
      return;
    }

    if (data.type === "AUDIO") {
      const pcm = data.pcm instanceof Float32Array ? data.pcm : new Float32Array(data.pcm);
      acceptPcm(pcm, data.sampleRate || sampleRate);
      return;
    }

    if (data.type === "RESET") {
      if (recognizer) {
        try {
          recognizer.remove();
        } catch {
          // ignore
        }
        recognizer = null;
      }
    }
  } catch (error) {
    post({ type: "ERROR", error: error?.message || String(error) });
  }
});

post({ type: "SANDBOX_READY" });
