const statusLabel = document.getElementById("statusLabel");
const chooseSourceBtn = document.getElementById("chooseSourceBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const errorEl = document.getElementById("error");
const openOptions = document.getElementById("openOptions");
const floatToggle = document.getElementById("floatToggle");

function showError(message) {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function renderState({ capturing, error, status }) {
  statusLabel.textContent = capturing ? "Capturing audio" : status || "Idle";
  chooseSourceBtn.disabled = !!capturing;
  stopBtn.disabled = !capturing;
  if (error) showError(error);
}

async function refresh() {
  const [state, local] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATE" }),
    chrome.storage.local.get({ floatingVisible: true }),
  ]);
  floatToggle.checked = local.floatingVisible !== false;
  renderState(state || { capturing: false });
}

function chooseSoundSource() {
  return new Promise((resolve) => {
    try {
      // Native Chrome picker — no extra extension window.
      chrome.desktopCapture.chooseDesktopMedia(
        ["screen", "window", "tab", "audio"],
        (streamId) => resolve(streamId || null)
      );
    } catch (error) {
      console.error(error);
      resolve(null);
    }
  });
}

floatToggle.addEventListener("change", async () => {
  showError("");
  const visible = floatToggle.checked;
  await chrome.storage.local.set({ floatingVisible: visible });
  const result = await chrome.runtime.sendMessage({
    type: visible ? "SHOW_PANEL" : "HIDE_PANEL",
  });
  if (!result?.ok && visible) {
    showError(
      result?.error ||
        "Preference saved. Open/refresh your AI tab to see the floating panel."
    );
  }
});

chooseSourceBtn.addEventListener("click", async () => {
  showError("");
  chooseSourceBtn.disabled = true;
  statusLabel.textContent = "Choose what to share…";

  const streamId = await chooseSoundSource();
  if (!streamId) {
    showError("Cancelled. Pick a source and enable audio.");
    await refresh();
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "START_TAB_CAPTURE",
    streamId,
  });
  if (!result?.ok) {
    showError(result?.error || "Could not capture audio.");
    await refresh();
    return;
  }
  window.close();
});

stopBtn.addEventListener("click", async () => {
  showError("");
  await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  await refresh();
});

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" });
  await refresh();
});

openOptions.addEventListener("click", async (event) => {
  event.preventDefault();
  await chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "STATE_UPDATE") {
    renderState(message);
  }
});

refresh();
