# CallTogether

Free Chrome extension: capture **system/tab call audio**, show a **live floating transcript**, paste into AI chat with a hotkey.

**No OpenAI. No paid APIs.**

## How it works

| Step | Tech |
|------|------|
| Capture sound output | Chrome `desktopCapture` from the **in-page** float (no extra window) |
| Live speech → text | [`vosk-browser`](https://github.com/ccoreilly/vosk-browser) (WASM, offline, free) |
| Show script | Floating draggable panel on the AI page |
| Paste + Enter | Configurable hotkey into focused input/textarea/contenteditable |

Chrome’s built-in **Web Speech API** only listens to the **microphone**, not a shared system/tab stream. For real call-output capture, local Vosk is the free path.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `CallTogether` folder
4. Reload the AI site tab after installing

## Use

1. Open the AI platform tab (prompt/CV upload stays manual)
2. You’ll see a **CallTogether** float on that page (collapsed at first)
3. Expand it → **Share audio** → pick the call tab/window with audio
4. Stay on the AI tab — transcript updates in the float
5. Focus the AI input → hotkey (default `Alt+Shift+V`) → paste + Enter

The extension popup’s **Show panel** only reveals the in-page float; it does **not** open a separate capture window.

## Settings

Extension options: configure the paste hotkey only.

## Project layout

```
manifest.json
background/          state + messaging
popup/               show in-page panel / stop
panel/               floating UI + getDisplayMedia + Vosk
content/             injects draggable iframe shell + hotkey paste
vendor/vosk/         vosk-browser bundle
models/              English Vosk model (offline)
options/             hotkey settings
```
