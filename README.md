# CallTogether

Free Chrome extension: capture **system/tab call audio**, show a **live floating transcript**, paste into AI chat with a hotkey.

**No OpenAI. No paid APIs.**

## How it works

| Step | Tech |
|------|------|
| Capture sound output | Chrome `getDisplayMedia` (share tab/screen **with audio**) |
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

1. Open the AI platform (prompt/CV upload stays manual)
2. Extension popup → **Start**
3. Wait for the free speech model to load (first open)
4. **Share audio** → pick the call tab/window → enable tab/system audio
5. Watch the **floating transcript** on the AI page
6. Focus the AI input → press hotkey (default `Alt+Shift+V`) → paste + Enter

## Settings

Extension options: configure the paste hotkey only.

## Project layout

```
manifest.json
background/          state + messaging
popup/               Start / Stop
capture/             getDisplayMedia + Vosk live STT
content/             floating transcript + hotkey paste
vendor/vosk/         vosk-browser bundle
models/              English Vosk model (offline)
options/             hotkey settings
```
