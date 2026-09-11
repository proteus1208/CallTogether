let voskModel = null;
let recognizer = null;
let sampleRate = 48000;

function post(message) {
  parent.postMessage(message, "*");
}

function formatError(detail) {
  if (!detail) return "Vosk model error.";
  if (typeof detail === "string") return detail;
  if (detail.error) return String(detail.error);
  if (detail.message) return String(detail.message);
  if (detail.result && detail.result !== true) return String(detail.result);
  try {
    return JSON.stringify(detail);
  } catch {
    return "Vosk model error.";
  }
}

function loadModelFromUrl(modelUrl) {
  return new Promise((resolve, reject) => {
    if (!globalThis.Vosk?.Model) {
      reject(new Error("Vosk library missing in sandbox."));
      return;
    }

    const model = new globalThis.Vosk.Model(modelUrl, 0);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Speech model init timed out (2 min)."));
      }
    }, 120000);

    const done = (ok, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        voskModel = model;
        resolve(model);
      } else {
        reject(new Error(err || "Speech model failed to load."));
      }
    };

    model.on("load", (message) => {
      if (message?.result) done(true);
      else done(false, formatError(message) || "Model load returned false.");
    });

    model.on("error", (message) => {
      done(false, formatError(message));
    });
  });
}

async function loadModel(modelBuffer) {
  if (voskModel) return voskModel;

  const attempts = [];

  // Same-folder packaged model (best for Chrome sandbox pages).
  attempts.push({
    label: "sandbox/model.tar.gz",
    run: () => loadModelFromUrl("model.tar.gz"),
  });

  // Named File blob fallback (vosk expects a .tar.gz name).
  if (modelBuffer) {
    attempts.push({
      label: "blob:model.tar.gz",
      run: () => {
        const file = new File([modelBuffer], "model.tar.gz", {
          type: "application/gzip",
        });
        return loadModelFromUrl(URL.createObjectURL(file));
      },
    });
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      post({ type: "STATUS", text: `Loading speech model (${attempt.label})…` });
      return await attempt.run();
    } catch (error) {
      lastError = error;
      post({
        type: "STATUS",
        text: `${attempt.label} failed: ${error?.message || error}`,
      });
    }
  }

  throw lastError || new Error("Vosk model error.");
}

function ensureRecognizer(rate) {
  if (!voskModel) {
    throw new Error("Speech model is not ready.");
  }
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
      const pcm =
        data.pcm instanceof Float32Array ? data.pcm : new Float32Array(data.pcm);
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
