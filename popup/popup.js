const statusLabel = document.getElementById("statusLabel");
const transcriptPreview = document.getElementById("transcriptPreview");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const errorEl = document.getElementById("error");
const openOptions = document.getElementById("openOptions");

function showError(message) {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function renderState({ capturing, transcript, error }) {
  statusLabel.textContent = capturing ? "Capturing" : "Idle";
  transcriptPreview.textContent = (transcript || "").trim() || "No transcript yet";
  startBtn.disabled = !!capturing;
  stopBtn.disabled = !capturing;
  if (error) showError(error);
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  renderState(state || { capturing: false, transcript: "" });
}

startBtn.addEventListener("click", async () => {
  showError("");
  const result = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
  if (!result?.ok) {
    showError(result?.error || "Could not start capture.");
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
