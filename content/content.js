const PANEL_ID = "calltogether-float-root";

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
let panelEl = null;
let bodyEl = null;
let statusEl = null;
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

function ensurePanel() {
  if (panelEl) return panelEl;

  panelEl = document.createElement("div");
  panelEl.id = PANEL_ID;
  panelEl.innerHTML = `
    <div class="ct-header" data-drag-handle>
      <div class="ct-title">
        <span class="ct-dot" data-dot></span>
        <strong>CallTogether</strong>
      </div>
      <div class="ct-actions">
        <button type="button" data-clear title="Clear transcript">Clear</button>
        <button type="button" data-collapse title="Collapse">–</button>
      </div>
    </div>
    <div class="ct-status" data-status>Idle</div>
    <div class="ct-body" data-body>
      <span data-final></span><span class="ct-partial" data-partial></span>
    </div>
    <div class="ct-footer">
      Hotkey <kbd data-hotkey>${formatHotkey(hotkey)}</kbd> pastes into the focused input and sends Enter
    </div>
  `;

  document.documentElement.appendChild(panelEl);

  bodyEl = panelEl.querySelector("[data-body]");
  statusEl = panelEl.querySelector("[data-status]");

  const handle = panelEl.querySelector("[data-drag-handle]");
  handle.addEventListener("pointerdown", onDragStart);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);

  panelEl.querySelector("[data-clear]").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" });
  });

  panelEl.querySelector("[data-collapse]").addEventListener("click", () => {
    panelEl.classList.toggle("ct-collapsed");
  });

  restorePosition();
  return panelEl;
}

function restorePosition() {
  chrome.storage.local.get(["panelLeft", "panelTop"], (result) => {
    if (!panelEl) return;
    if (typeof result.panelLeft === "number") {
      panelEl.style.left = `${result.panelLeft}px`;
      panelEl.style.right = "auto";
    }
    if (typeof result.panelTop === "number") {
      panelEl.style.top = `${result.panelTop}px`;
    }
  });
}

function onDragStart(event) {
  if (!panelEl || event.button !== 0) return;
  if (event.target.closest("button")) return;
  dragging = true;
  const rect = panelEl.getBoundingClientRect();
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;
  panelEl.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onDragMove(event) {
  if (!dragging || !panelEl) return;
  const left = Math.max(8, event.clientX - dragOffsetX);
  const top = Math.max(8, event.clientY - dragOffsetY);
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.right = "auto";
}

function onDragEnd() {
  if (!dragging || !panelEl) return;
  dragging = false;
  const rect = panelEl.getBoundingClientRect();
  chrome.storage.local.set({
    panelLeft: Math.round(rect.left),
    panelTop: Math.round(rect.top),
  });
}

function render() {
  const visible =
    capturing || Boolean(transcript.trim()) || Boolean(partial.trim());
  if (!visible) {
    if (panelEl) panelEl.style.display = "none";
    return;
  }

  ensurePanel();
  panelEl.style.display = "flex";
  const dot = panelEl.querySelector("[data-dot]");
  const hotkeyEl = panelEl.querySelector("[data-hotkey]");
  const finalEl = panelEl.querySelector("[data-final]");
  const partialEl = panelEl.querySelector("[data-partial]");

  panelEl.classList.toggle("ct-capturing", capturing);
  dot.classList.toggle("ct-live", capturing);
  statusEl.textContent = capturing
    ? "Live transcript (system/tab audio)"
    : "Idle";

  const finalText = transcript.trim();
  const partialText = partial.trim();
  if (!finalText && !partialText) {
    finalEl.textContent = "Waiting for captured speech…";
    partialEl.textContent = "";
  } else {
    finalEl.textContent = finalText ? `${finalText} ` : "";
    partialEl.textContent = partialText;
  }

  hotkeyEl.textContent = formatHotkey(hotkey);
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
      // some input types disallow selection
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  // contenteditable / AI chat composers (ChatGPT, Claude, etc.)
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

  const form = el.closest("form");
  if (form && typeof form.requestSubmit === "function") {
    // Prefer keyboard events for SPA chat UIs; only submit native forms if needed.
  }
}

async function pasteTranscriptAndSend() {
  const editable = resolveEditable(document.activeElement);
  if (!editable) {
    statusEl.textContent = "Focus an input / textarea first";
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "CONSUME_TRANSCRIPT" });
  const text = (response?.text || "").trim();
  if (!text) {
    statusEl.textContent = "Nothing to paste yet";
    return;
  }

  insertText(editable, text);
  dispatchEnter(editable);
  statusEl.textContent = "Pasted + Enter sent";
}

async function init() {
  const stored = await chrome.storage.sync.get(["hotkey"]);
  if (stored.hotkey) hotkey = stored.hotkey;

  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" }).catch(() => null);
  if (state) {
    capturing = !!state.capturing;
    transcript = state.transcript || "";
    partial = state.partial || "";
  }

  render();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "STATE_UPDATE") return;
  capturing = !!message.capturing;
  transcript = message.transcript || "";
  partial = message.partial || "";
  render();
  if (message.error && statusEl) {
    statusEl.textContent = message.error;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hotkey) {
    hotkey = changes.hotkey.newValue || DEFAULT_HOTKEY;
    render();
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
