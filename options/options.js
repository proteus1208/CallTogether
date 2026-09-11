const DEFAULTS = {
  hotkey: {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    key: "v",
  },
};

const form = document.getElementById("settingsForm");
const hotkeyInput = document.getElementById("hotkeyInput");
const ctrlKey = document.getElementById("ctrlKey");
const altKey = document.getElementById("altKey");
const shiftKey = document.getElementById("shiftKey");
const metaKey = document.getElementById("metaKey");
const saveStatus = document.getElementById("saveStatus");

let draftHotkey = { ...DEFAULTS.hotkey };

function formatHotkey(config) {
  const parts = [];
  if (config.ctrlKey) parts.push("Ctrl");
  if (config.altKey) parts.push("Alt");
  if (config.shiftKey) parts.push("Shift");
  if (config.metaKey) parts.push("Meta");
  parts.push((config.key || "").toUpperCase());
  return parts.join("+");
}

function syncHotkeyUI() {
  ctrlKey.checked = !!draftHotkey.ctrlKey;
  altKey.checked = !!draftHotkey.altKey;
  shiftKey.checked = !!draftHotkey.shiftKey;
  metaKey.checked = !!draftHotkey.metaKey;
  hotkeyInput.value = formatHotkey(draftHotkey);
}

function applySettings(settings) {
  draftHotkey = { ...DEFAULTS.hotkey, ...(settings.hotkey || {}) };
  syncHotkeyUI();
}

[ctrlKey, altKey, shiftKey, metaKey].forEach((el) => {
  el.addEventListener("change", () => {
    draftHotkey = {
      ...draftHotkey,
      ctrlKey: ctrlKey.checked,
      altKey: altKey.checked,
      shiftKey: shiftKey.checked,
      metaKey: metaKey.checked,
    };
    syncHotkeyUI();
  });
});

hotkeyInput.addEventListener("keydown", (event) => {
  event.preventDefault();
  const ignored = new Set([
    "Shift",
    "Control",
    "Alt",
    "Meta",
    "Tab",
    "Escape",
    "CapsLock",
  ]);
  if (ignored.has(event.key)) return;

  draftHotkey = {
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
  };
  syncHotkeyUI();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.sync.set({ hotkey: draftHotkey });
  saveStatus.textContent = "Saved";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 1600);
});

chrome.storage.sync.get(null).then((stored) => {
  applySettings({ ...DEFAULTS, ...stored });
});
