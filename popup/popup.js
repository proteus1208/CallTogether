const statusLabel = document.getElementById("statusLabel");
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

function renderState({ capturing, error }) {
  statusLabel.textContent = capturing ? "Listening" : "Idle";
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

floatToggle.addEventListener("change", async () => {
  showError("");
  const visible = floatToggle.checked;
  // Persist preference first so content scripts on AI tabs react immediately.
  await chrome.storage.local.set({ floatingVisible: visible });

  const result = await chrome.runtime.sendMessage({
    type: visible ? "SHOW_PANEL" : "HIDE_PANEL",
  });

  // Do not flip the preference off just because the active tab isn't an AI page.
  if (!result?.ok && visible) {
    showError(
      result?.error ||
        "Preference saved. Open/refresh your AI tab to see the floating panel."
    );
  }
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
