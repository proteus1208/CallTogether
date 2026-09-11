# CallTogether

Live call transcript on a floating AI-page panel + hotkey paste. Free (Chrome Speech API).

## Why model load failed before

The Vosk file was **already local** (`models/en-us-small.tar.gz`). You did **not** need to preload anything else.

Chrome **Manifest V3 blocks `unsafe-eval`**. Vosk’s worker evaluates JS strings, so CSP kills it:

`Evaluating a string as JavaScript violates ... 'unsafe-eval' is not an allowed source`

`'wasm-unsafe-eval'` is allowed; plain `eval` is not. So Vosk cannot run in this extension.

## Current engine

Chrome **Web Speech API** (built-in, free, no model file).

- Listens via **microphone**
- On **Windows**, for call/system audio: set **Stereo Mix** as the mic, or play the call on speakers
- Transcript shows only on the **floating panel** (not in the popup)

## Use

1. Reload the extension + refresh the AI tab  
2. Popup → toggle **Floating panel** on  
3. On the float → **Start listening**  
4. Hotkey (default `Alt+Shift+V`) pastes into the AI input + Enter  
