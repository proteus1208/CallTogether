# CallTogether

Chrome extension that captures **system/tab call audio**, shows a live transcript in a **floating draggable panel**, and pastes it into the focused AI chat input with a **hotkey** (then sends Enter).

## How to use

1. **Install the extension**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select this folder (`CallTogether`)

2. **Open Settings** (extension details → Extension options, or popup → Settings)
   - Paste your **OpenAI API key** (used for Whisper transcription)
   - Set the **paste hotkey** (default: `Alt+Shift+V`)

3. **Open your AI platform** (ChatGPT, Claude, etc.)
   - Enter your initial prompt and upload a CV yourself — the extension does not touch that step

4. **Click Start** in the extension popup
   - A small **Capture** window opens
   - Click **Share audio**
   - Choose the call tab/window (or screen)
   - Enable **Share tab audio** / **Share system audio**
   - Keep the capture window open while you work

5. **Watch the floating panel** on the AI site
   - Transcript accumulates as speech is recognized
   - Drag the panel anywhere; use **Clear** to reset

6. **Paste with the hotkey**
   - Focus the AI chat input / textarea / composer
   - Press your hotkey
   - CallTogether pastes the stored transcript, clears it, and dispatches **Enter**

## Flow

```
Call audio (shared tab/system)
        │
        ▼
 Capture window (MediaRecorder)
        │
        ▼
 OpenAI Whisper (chunked)
        │
        ▼
 Floating transcript panel
        │  hotkey on focused input
        ▼
 Paste text + Enter → AI reply
```

## Notes

- **macOS** usually shares **tab audio** best when you pick a Chrome tab. Entire-screen system audio support is stronger on Windows/ChromeOS.
- Keep the capture popup open; closing it stops capture.
- Chat composers that are `contenteditable` (not only `<textarea>`) are supported.
- API key stays in `chrome.storage.sync` on your profile; it is sent only to OpenAI’s transcription API.

## Project layout

```
manifest.json
background/service-worker.js
popup/          Start / Stop
options/        Hotkey + API key
capture/        getDisplayMedia + Whisper
content/        Floating UI + hotkey paste
icons/
```
