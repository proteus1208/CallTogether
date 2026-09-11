# CallTogether

Turn **call audio** into answers in ChatGPT, Claude, Gemini, and other AI chats.

CallTogether captures what you **hear** (tab or system audio — not the
microphone), shows a **live floating transcript** on the AI page, and pastes it
into the focused chat input with a hotkey.

## Product flow

1. Open your AI tab — the floating panel appears (drag it anywhere)
2. Toolbar → **Desktop / app audio** or **Chrome tab audio**
3. Enable sound in Chrome’s share picker
4. Watch the live transcript
5. Focus the AI input → hotkey (default `Alt+Shift+V`) pastes + Enter

## Capture tips

| Source | Use |
|--------|-----|
| Zoom / desktop apps / Media Player | **Desktop / app audio** → Entire Screen + Share system audio |
| Call in another Chrome tab | **Chrome tab audio** → pick tab + Also share tab audio |

Chrome cannot attach audio to a single app **Window** share.

## Why not the microphone?

Mic capture fails on many AI sites (`Requested device not found` /
Permissions-Policy). CallTogether listens to the **shared audio stream** instead
and runs **local Vosk** speech recognition — no API key.

## Tech

- Capture: `getDisplayMedia` / `chrome.desktopCapture`
- Speech: Vosk WASM inside an MV3 sandbox page
- UI: draggable floating panel + toolbar popup + paste hotkey
