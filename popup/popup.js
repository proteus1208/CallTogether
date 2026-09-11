const statusLabel = document.getElementById("statusLabel");
const startTabBtn = document.getElementById("startTabBtn");
const startScreenBtn = document.getElementById("startScreenBtn");
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
  startTabBtn.disabled = !!capturing;
  startScreenBtn.disabled = !!capturing;
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

function chooseTabAudio() {
  return new Promise((resolve) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(
        ["tab", "audio"],
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

startTabBtn.addEventListener("click", async () => {
  showError("");
  startTabBtn.disabled = true;
  statusLabel.textContent = "Pick a Chrome tab + audio…";

  const streamId = await chooseTabAudio();
  if (!streamId) {
    showError("Cancelled. Pick a Chrome tab and enable audio.");
    await refresh();
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "START_TAB_CAPTURE",
    streamId,
  });
  if (!result?.ok) {
    showError(result?.error || "Could not capture tab audio.");
    await refresh();
    return;
  }
  window.close();
});

startScreenBtn.addEventListener("click", async () => {
  showError("");
  // Full Chrome picker with Entire Screen (desktopCapture tab-only UI is too limited).
  const result = await chrome.runtime.sendMessage({
    type: "OPEN_SCREEN_CAPTURE_SESSION",
  });
  if (!result?.ok) {
    showError(result?.error || "Could not open screen capture.");
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
