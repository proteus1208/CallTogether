const allowBtn = document.getElementById("allowBtn");
const statusEl = document.getElementById("status");

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", kind === "error");
  statusEl.classList.toggle("ok", kind === "ok");
}

async function requestMicrophone() {
  allowBtn.disabled = true;
  setStatus("Waiting for Chrome permission popup…");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    stream.getTracks().forEach((track) => track.stop());

    await chrome.storage.local.set({ micGranted: true });
    setStatus("Microphone allowed. Starting listener…", "ok");
    await chrome.runtime.sendMessage({ type: "MIC_GRANTED" });

    setTimeout(() => window.close(), 700);
  } catch (error) {
    allowBtn.disabled = false;
    const denied =
      error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    const message = denied
      ? "Permission blocked. Click the lock icon in the address bar → Microphone → Allow, then try again."
      : error?.message || "Could not access the microphone.";
    setStatus(message, "error");
    await chrome.runtime.sendMessage({
      type: "MIC_DENIED",
      error: message,
    });
  }
}

allowBtn.addEventListener("click", () => {
  requestMicrophone();
});

setStatus("Click the button to show Chrome’s permission alert.");
