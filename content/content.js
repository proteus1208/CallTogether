const SHELL_ID = "calltogether-float-root";
const PANEL_PATH = "panel/panel.html";

const DEFAULT_HOTKEY = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: "w",
};

let transcript = "";
let partial = "";
let capturing = false;
let hotkey = { ...DEFAULT_HOTKEY };
let shellEl = null;
let iframeEl = null;
let dragHandleEl = null;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastEditable = null;

function clampToViewport(left, top, width, height) {
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - height - 8);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop),
  };
}

function ensureShell() {
  if (shellEl && document.contains(shellEl)) return shellEl;

  // Remove stale node if the page re-rendered around it.
  document.getElementById(SHELL_ID)?.remove();

  shellEl = document.createElement("div");
  shellEl.id = SHELL_ID;
  shellEl.setAttribute("data-calltogether", "1");
  shellEl.innerHTML = `
    <div class="ct-header" data-drag-handle title="Drag to move">
      <div class="ct-title">
        <strong>CallTogether</strong>
      </div>
      <div class="ct-drag-grip" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </div>
    <iframe
      class="ct-frame"
      data-frame
      title="CallTogether panel"
      allow="microphone *"
    ></iframe>
  `;

  iframeEl = shellEl.querySelector("[data-frame]");
  iframeEl.src = `${chrome.runtime.getURL(PANEL_PATH)}?v=1.5.7`;

  (document.body || document.documentElement).appendChild(shellEl);

  const handle = shellEl.querySelector("[data-drag-handle]");
  dragHandleEl = handle;
  handle.addEventListener("pointerdown", onDragStart);
  window.addEventListener("pointermove", onDragMove, { passive: true });
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);

  restorePosition();
  return shellEl;
}

function setShellPosition(left, top, right = "auto") {
  if (!shellEl) return;
  // Use !important so host-page CSS cannot pin one axis.
  shellEl.style.setProperty("left", typeof left === "number" ? `${left}px` : left, "important");
  shellEl.style.setProperty("top", typeof top === "number" ? `${top}px` : top, "important");
  shellEl.style.setProperty(
    "right",
    typeof right === "number" ? `${right}px` : right,
    "important"
  );
  shellEl.style.setProperty("bottom", "auto", "important");
}

function restorePosition() {
  chrome.storage.local.get(["panelLeft", "panelTop"], (result) => {
    if (!shellEl) return;

    const width = shellEl.offsetWidth || 400;
    const height = shellEl.offsetHeight || 390;

    if (typeof result.panelLeft === "number" && typeof result.panelTop === "number") {
      const pos = clampToViewport(result.panelLeft, result.panelTop, width, height);
      setShellPosition(pos.left, pos.top, "auto");
    } else {
      const defaultLeft = Math.max(8, window.innerWidth - width - 18);
      setShellPosition(defaultLeft, 72, "auto");
    }
  });
}

function onDragStart(event) {
  if (!shellEl || event.button !== 0) return;
  if (event.target.closest("button")) return;
  dragging = true;
  const rect = shellEl.getBoundingClientRect();
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;
  // Convert right-anchored layout to left/top so both axes move.
  setShellPosition(rect.left, rect.top, "auto");
  shellEl.classList.add("ct-dragging");
  dragHandleEl?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onDragMove(event) {
  if (!dragging || !shellEl) return;
  const width = shellEl.offsetWidth || 400;
  const height = shellEl.offsetHeight || 52;
  const pos = clampToViewport(
    event.clientX - dragOffsetX,
    event.clientY - dragOffsetY,
    width,
    height
  );
  setShellPosition(pos.left, pos.top, "auto");
}

function onDragEnd(event) {
  if (!dragging || !shellEl) return;
  dragging = false;
  shellEl.classList.remove("ct-dragging");
  try {
    dragHandleEl?.releasePointerCapture?.(event?.pointerId);
  } catch {
    // ignore
  }
  const rect = shellEl.getBoundingClientRect();
  chrome.storage.local.set({
    panelLeft: Math.round(rect.left),
    panelTop: Math.round(rect.top),
  });
}

function showPanel() {
  ensureShell();
  shellEl.style.setProperty("display", "flex", "important");
  shellEl.style.setProperty("visibility", "visible", "important");
  shellEl.style.setProperty("opacity", "1", "important");
  shellEl.hidden = false;
  updateShellChrome();
}

function hidePanel() {
  if (!shellEl) return;
  shellEl.style.setProperty("display", "none", "important");
}

function updateShellChrome() {
  if (!shellEl) return;
  shellEl.classList.toggle("ct-capturing", capturing);
}

function matchesHotkey(event, config) {
  if (!config?.key || typeof config.key !== "string") return false;
  if (event.repeat) return false;
  if (typeof event.key !== "string") return false;

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
    return ["text", "search", "email", "url", "tel", "password", "number"].includes(
      type
    );
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

    if (descriptor?.set) descriptor.set.call(el, next);
    else el.value = next;

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

async function pasteTranscript({ send = false } = {}) {
  const editable =
    resolveEditable(document.activeElement) ||
    (lastEditable && document.contains(lastEditable) ? lastEditable : null);
  if (!editable) {
    showPanel({ expand: true });
    return { ok: false, error: "Focus a chat input first." };
  }

  const response = await chrome.runtime.sendMessage({ type: "CONSUME_TRANSCRIPT" });
  const text = (response?.text || "").trim();
  if (!text) return { ok: true, sent: false, empty: true };

  insertText(editable, text);
  if (send) dispatchEnter(editable);
  return { ok: true, sent: send };
}

async function isFloatingEnabled() {
  const local = await chrome.storage.local.get({ floatingVisible: false });
  return local.floatingVisible === true;
}

async function init() {
  try {
    const stored = await chrome.storage.sync.get(["hotkey"]);
    if (stored.hotkey) hotkey = stored.hotkey;

    const state = await chrome.runtime
      .sendMessage({ type: "GET_STATE" })
      .catch(() => null);
    if (state) {
      capturing = !!state.capturing;
      transcript = state.transcript || "";
      partial = state.partial || "";
    }

    // Extension enabled on this page → show float unless user toggled it off.
    if (await isFloatingEnabled()) {
      showPanel({ expand: true });
    } else {
      hidePanel();
    }
  } catch (error) {
    console.warn("[CallTogether] init failed, forcing panel visible", error);
    showPanel({ expand: true });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SHOW_PANEL") {
    showPanel({ expand: true });
    sendResponse?.({ ok: true });
    return true;
  }

  if (message?.type === "HIDE_PANEL") {
    hidePanel();
    sendResponse?.({ ok: true });
    return true;
  }

  if (message?.type === "SUBMIT_TRANSCRIPT") {
    pasteTranscript({ send: true }).then((result) => sendResponse?.(result));
    return true;
  }

  if (message?.type === "PASTE_TRANSCRIPT") {
    pasteTranscript({ send: false }).then((result) => sendResponse?.(result));
    return true;
  }

  if (message?.type === "STATE_UPDATE") {
    capturing = !!message.capturing;
    transcript = message.transcript || "";
    partial = message.partial || "";
    isFloatingEnabled().then((enabled) => {
      if (!enabled) {
        hidePanel();
        return;
      }
      showPanel({ expand: true });
      updateShellChrome();
    });
  }
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
  "focusin",
  (event) => {
    if (shellEl?.contains(event.target)) return;
    const editable = resolveEditable(event.target);
    if (editable) lastEditable = editable;
  },
  true
);

window.addEventListener(
  "keydown",
  (event) => {
    if (!matchesHotkey(event, hotkey)) return;
    event.preventDefault();
    event.stopPropagation();
    // Hotkey: clear saved transcript and paste only (no Enter).
    pasteTranscript({ send: false });
  },
  true
);

// SPA sites mount late — retry once body exists / after a tick.
if (document.body) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init, { once: true });
}
setTimeout(() => {
  isFloatingEnabled().then((enabled) => {
    if (enabled && !document.getElementById(SHELL_ID)) {
      showPanel({ expand: true });
    }
  });
}, 1200);
