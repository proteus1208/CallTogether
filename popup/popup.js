const floatToggle = document.getElementById("floatToggle");

async function refresh() {
  const local = await chrome.storage.local.get({ floatingVisible: false });
  floatToggle.checked = local.floatingVisible === true;
}

floatToggle.addEventListener("change", async () => {
  const visible = floatToggle.checked;
  await chrome.storage.local.set({ floatingVisible: visible });
  await chrome.runtime.sendMessage({
    type: visible ? "SHOW_PANEL" : "HIDE_PANEL",
  });
});

refresh();
