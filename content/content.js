const SHELL_ID = "calltogether-float-root";
const PANEL_PATH = "panel/panel.html";

const DEFAULT_HOTKEY = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: true,
  key: "v",
};

let transcript = "";
let partial = "";
let capturing = false;
let hotkey = { ...DEFAULT_HOTKEY };
let shellEl = null;
let iframeEl = null;
let hotkeyEl = null;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function formatHotkey(config) {
  const parts = [];
  if (config.ctrlKey) parts.push("Ctrl");
  if (config.altKey) parts.push("Alt");
  if (config.shiftKey) parts.push("Shift");
  if (config.metaKey) parts.push("Meta");
  parts.push((config.key || "").toUpperCase());
  return parts.join("+");
}

function ensureShell() {
  if (shellEl) return shellEl;

  shellEl = document.createElement("div");
  shellEl.id = SHELL_ID;
  shellEl.innerHTML = `
    <div class="ct-header" data-drag-handle>
      <div class="ct-title">
        <span class="ct-dot" data-dot></span>
        <strong>CallTogether</strong>
      </div>
      <div class="ct-actions">
        <button type="button" data-collapse title="Collapse">–</button>
      </div>
    </div>
    <iframe
      class="ct-frame"
      data-frame
      title="CallTogether panel"
      allow="microphone *"
    ></iframe>
    <div class="ct-footer">
      Hotkey <kbd data-hotkey>${formatHotkey(hotkey)}</kbd> pastes into the AI input + Enter
    </div>
  `;

  iframeEl = shellEl.querySelector("[data-frame]");
  iframeEl.src = chrome.runtime.getURL(PANEL_PATH);
  hotkeyEl = shellEl.querySelector("[data-hotkey]");

  document.documentElement.appendChild(shellEl);

  const handle = shellEl.querySelector("[data-drag-handle]");
  handle.addEventListener("pointerdown", onDragStart);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);

  shellEl.querySelector("[data-collapse]").addEventListener("click", () => {
    shellEl.classList.toggle("ct-collapsed");
    chrome.storage.local.set({
      panelCollapsed: shellEl.classList.contains("ct-collapsed"),
    });
  });

  restorePosition();
  return shellEl;
}

function restorePosition() {
  chrome.storage.local.get(
    ["panelLeft", "panelTop", "panelCollapsed"],
    (result) => {
      if (!shellEl) return;
      if (typeof result.panelLeft === "number") {
        shellEl.style.left = `${result.panelLeft}px`;
        shellEl.style.right = "auto";
      }
      if (typeof result.panelTop === "number") {
        shellEl.style.top = `${result.panelTop}px`;
      }
      shellEl.classList.toggle("ct-collapsed", !!result.panelCollapsed);
    }
  );
}

function onDragStart(event) {
  if (!shellEl || event.button !== 0) return;
  if (event.target.closest("button")) return;
  dragging = true;
  const rect = shellEl.getBoundingClientRect();
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;
  shellEl.classList.add("ct-dragging");
  event.preventDefault();
}

function onDragMove(event) {
  if (!dragging || !shellEl) return;
  const left = Math.max(8, event.clientX - dragOffsetX);
  const top = Math.max(8, event.clientY - dragOffsetY);
  shellEl.style.left = `${left}px`;
  shellEl.style.top = `${top}px`;
  shellEl.style.right = "auto";
}

function onDragEnd() {
  if (!dragging || !shellEl) return;
  dragging = false;
  shellEl.classList.remove("ct-dragging");
  const rect = shellEl.getBoundingClientRect();
  chrome.storage.local.set({
    panelLeft: Math.round(rect.left),
    panelTop: Math.round(rect.top),
  });
}

function showPanel({ expand = true } = {}) {
  ensureShell();
  shellEl.style.display = "flex";
  if (expand) {
    shellEl.classList.remove("ct-collapsed");
  }
  updateShellChrome();
}

function hidePanel() {
  if (!shellEl) return;
  shellEl.style.display = "none";
}

function updateShellChrome() {
  if (!shellEl) return;
  const dot = shellEl.querySelector("[data-dot]");
  shellEl.classList.toggle("ct-capturing", capturing);
  dot.classList.toggle("ct-live", capturing);
  if (hotkeyEl) hotkeyEl.textContent = formatHotkey(hotkey);
}

function matchesHotkey(event, config) {
  if (!config?.key) return false;
  if (event.repeat) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const expected = config.key.length === 1 ? config.key.toLowerCase() : config.key;
  return (
    key === expected &&
    !!event.altKey === !!config.altKey &&
    !!event.ctrlKey === !!config.ctrlKey &&
    !!event.metaKey === !!config.metaKey &&
    !!event.shiftKey === !!config.shiftKey
  );
}

function isEditableTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return [
      "text",
      "search",
      "email",
      "url",
      "tel",
      "password",
      "number",
    ].includes(type);
  }
  return Boolean(el.closest?.('[contenteditable="true"]'));
}

function resolveEditable(el) {
  if (!el) return null;
  if (isEditableTarget(el)) {
    if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return el;
    }
    return el.closest?.('[contenteditable="true"]') || el;
  }
  return null;
}

function insertText(el, text) {
  el.focus();

  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);

    if (descriptor?.set) {
      descriptor.set.call(el, next);
    } else {
      el.value = next;
    }

    const caret = start + text.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      // ignore
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      el.textContent = text;
    }
  }

  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" })
  );
}

function dispatchEnter(el) {
  const opts = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keypress", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
}

async function pasteTranscriptAndSend() {
  const editable = resolveEditable(document.activeElement);
  if (!editable) {
    const { floatingVisible } = await chrome.storage.local.get({
      floatingVisible: true,
    });
    if (floatingVisible !== false) showPanel();
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "CONSUME_TRANSCRIPT" });
  const text = (response?.text || "").trim();
  if (!text) return;

  insertText(editable, text);
  dispatchEnter(editable);
}

async function init() {
  const stored = await chrome.storage.sync.get(["hotkey"]);
  if (stored.hotkey) hotkey = stored.hotkey;

  const [state, local] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATE" }).catch(() => null),
    chrome.storage.local.get({ floatingVisible: true }),
  ]);

  if (state) {
    capturing = !!state.capturing;
    transcript = state.transcript || "";
    partial = state.partial || "";
  }

  if (local.floatingVisible === false) {
    hidePanel();
    return;
  }

  showPanel({
    expand: capturing || Boolean(transcript.trim() || partial.trim()),
  });
  if (!capturing && !transcript.trim() && !partial.trim()) {
    shellEl.classList.add("ct-collapsed");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SHOW_PANEL") {
    showPanel({ expand: true });
    sendResponse?.({ ok: true });
    return;
  }

  if (message?.type === "HIDE_PANEL") {
    hidePanel();
    sendResponse?.({ ok: true });
    return;
  }

  if (message?.type !== "STATE_UPDATE") return;
  capturing = !!message.capturing;
  transcript = message.transcript || "";
  partial = message.partial || "";
  chrome.storage.local.get({ floatingVisible: true }, (local) => {
    if (local.floatingVisible === false) {
      hidePanel();
      return;
    }
    showPanel({
      expand: capturing || Boolean(transcript.trim() || partial.trim()),
    });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hotkey) {
    hotkey = changes.hotkey.newValue || DEFAULT_HOTKEY;
    updateShellChrome();
  }
  if (area === "local" && changes.floatingVisible) {
    if (changes.floatingVisible.newValue === false) hidePanel();
    else showPanel({ expand: true });
  }
});

window.addEventListener(
  "keydown",
  (event) => {
    if (!matchesHotkey(event, hotkey)) return;
    event.preventDefault();
    event.stopPropagation();
    pasteTranscriptAndSend();
  },
  true
);

init();
