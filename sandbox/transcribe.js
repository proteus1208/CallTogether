let voskModel = null;
let recognizer = null;
let sampleRate = 48000;

function post(message) {
  parent.postMessage(message, "*");
}

function formatError(detail, fallback = "Vosk model error.") {
  if (detail == null) return fallback;
  if (typeof detail === "string") return detail;
  if (detail instanceof Error) {
    return detail.stack || detail.message || fallback;
  }

  const parts = [];
  if (detail.error != null && detail.error !== "") {
    parts.push(
      typeof detail.error === "string"
        ? detail.error
        : JSON.stringify(detail.error)
    );
  }
  if (detail.message != null && detail.message !== "") {
    parts.push(String(detail.message));
  }
  if (detail.result != null && detail.result !== true) {
    parts.push(`result=${String(detail.result)}`);
  }
  if (detail.event && parts.length === 0) {
    parts.push(`event=${detail.event}`);
  }

  try {
    const extra = { ...detail };
    delete extra.event;
    const keys = Object.keys(extra).filter((k) => extra[k] != null && extra[k] !== "");
    if (keys.length) {
      const slim = {};
      for (const k of keys) slim[k] = extra[k];
      parts.push(JSON.stringify(slim));
    } else if (!parts.length) {
      parts.push(JSON.stringify(detail));
    }
  } catch {
    if (!parts.length) parts.push(fallback);
  }

  return parts.filter(Boolean).join(" | ") || fallback;
}

function terminateModel(model) {
  try {
    model?.terminate?.();
  } catch {
    // ignore
  }
  try {
    model?.worker?.terminate?.();
  } catch {
    // ignore
  }
}

function loadModelFromUrl(modelUrl, label) {
  return new Promise((resolve, reject) => {
    if (!globalThis.Vosk?.Model) {
      reject(
        new Error(
          `Vosk library missing in sandbox. typeof Vosk=${typeof globalThis.Vosk}. Reload extension and confirm sandbox/vosk.js is present.`
        )
      );
      return;
    }

    post({
      type: "STATUS",
      text: `Starting Vosk Model (${label})…`,
    });

    const model = new globalThis.Vosk.Model(modelUrl, 3);
    let settled = false;

    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        voskModel = model;
        resolve(model);
      } else {
        terminateModel(model);
        reject(new Error(err || "Speech model failed to load."));
      }
    };

    const timer = setTimeout(() => {
      finish(false, `Speech model init timed out for ${label}`);
    }, 120000);

    try {
      model.worker?.addEventListener("error", (event) => {
        const msg = [
          "Vosk worker error",
          event?.message,
          event?.filename && `file=${event.filename}`,
          event?.lineno != null && `line=${event.lineno}`,
          event?.error?.message,
          event?.error?.stack,
        ]
          .filter(Boolean)
          .join(" | ");
        post({ type: "STATUS", text: msg });
        finish(false, msg || "Vosk worker error (no message)");
      });
      model.worker?.addEventListener("messageerror", () => {
        finish(false, "Vosk worker messageerror (structured clone failed)");
      });
    } catch (error) {
      post({
        type: "STATUS",
        text: `Could not attach worker listeners: ${error?.message || error}`,
      });
    }

    model.on("load", (message) => {
      post({
        type: "STATUS",
        text: `Vosk load event: ${formatError(message, JSON.stringify(message))}`,
      });
      if (message?.result) finish(true);
      else finish(false, formatError(message, "Model load returned false."));
    });

    model.on("error", (message) => {
      const msg = formatError(
        message,
        'Vosk error event without details ({"event":"error"})'
      );
      post({ type: "STATUS", text: `Vosk error event detail: ${msg}` });
      console.error("[CallTogether sandbox] Vosk error detail:", message);
      finish(false, msg);
    });
  });
}

async function bufferToModelBlobUrl(modelBuffer) {
  const bytes =
    modelBuffer instanceof ArrayBuffer
      ? modelBuffer
      : modelBuffer?.buffer
        ? modelBuffer.buffer.slice(
            modelBuffer.byteOffset,
            modelBuffer.byteOffset + modelBuffer.byteLength
          )
        : null;
  if (!bytes || bytes.byteLength < 1000) {
    throw new Error(`Model buffer too small (${bytes?.byteLength || 0} bytes).`);
  }

  // Sanity-check gzip magic (1f 8b)
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    throw new Error(
      `Model buffer is not gzip (magic=${head[0]},${head[1]}). Re-copy models/en-us-small.tar.gz.`
    );
  }

  const file = new File([bytes], "model.tar.gz", {
    type: "application/gzip",
  });
  return URL.createObjectURL(file);
}

async function loadLocalModelAsBlobUrl() {
  const url = new URL("model.tar.gz", location.href).href;
  post({ type: "STATUS", text: `Fetching ${url}…` });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch model.tar.gz (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  post({
    type: "STATUS",
    text: `Fetched model.tar.gz (${buffer.byteLength} bytes)`,
  });
  return bufferToModelBlobUrl(buffer);
}

async function loadModel(modelBuffer) {
  if (voskModel) {
    terminateModel(voskModel);
    voskModel = null;
  }
  if (recognizer) {
    try {
      recognizer.remove();
    } catch {
      // ignore
    }
    recognizer = null;
  }

  const bufferBytes =
    modelBuffer?.byteLength ||
    (modelBuffer?.buffer && modelBuffer.buffer.byteLength) ||
    0;

  post({
    type: "STATUS",
    text: `Vosk=${typeof globalThis.Vosk}, buffer=${bufferBytes} bytes, href=${location.href}`,
  });

  const attempts = [];

  // Prefer blob: URLs — absolute, same opaque origin as the sandbox worker.
  if (bufferBytes > 0) {
    attempts.push({
      label: "parent-buffer-blob",
      run: async () => {
        const url = await bufferToModelBlobUrl(modelBuffer);
        post({
          type: "STATUS",
          text: `Blob URL ready (${bufferBytes} bytes)`,
        });
        return loadModelFromUrl(url, "parent-buffer-blob");
      },
    });
  }

  attempts.push({
    label: "local-fetch-blob",
    run: async () => {
      const url = await loadLocalModelAsBlobUrl();
      return loadModelFromUrl(url, "local-fetch-blob");
    },
  });

  // Last resort: absolute extension URL (may be blocked from null-origin workers).
  attempts.push({
    label: "absolute-extension-url",
    run: () => {
      const url = new URL("model.tar.gz", location.href).href;
      return loadModelFromUrl(url, "absolute-extension-url");
    },
  });

  const errors = [];
  for (const attempt of attempts) {
    try {
      post({ type: "STATUS", text: `Trying ${attempt.label}…` });
      return await attempt.run();
    } catch (error) {
      const msg = error?.message || String(error);
      errors.push(`${attempt.label}: ${msg}`);
      post({ type: "STATUS", text: `Failed ${attempt.label}: ${msg}` });
      console.error(
        "[CallTogether sandbox] load attempt failed",
        attempt.label,
        error
      );
    }
  }

  throw new Error(errors.join(" || ") || "Vosk model error.");
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
        data.pcm instanceof Float32Array
          ? data.pcm
          : new Float32Array(data.pcm);
      acceptPcm(pcm, data.sampleRate || sampleRate);
      return;
    }

    if (data.type === "FLUSH") {
      if (recognizer) {
        try {
          recognizer.retrieveFinalResult();
        } catch (error) {
          post({ type: "ERROR", error: error?.message || String(error) });
        }
      } else {
        // Nothing in progress — clear any stale partial UI.
        post({ type: "PARTIAL", text: "" });
      }
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
      if (voskModel) {
        terminateModel(voskModel);
        voskModel = null;
      }
      return;
    }
  } catch (error) {
    console.error("[CallTogether sandbox] LOAD_MODEL failed", error);
    post({ type: "ERROR", error: error?.message || String(error) });
  }
});

post({ type: "SANDBOX_READY" });
