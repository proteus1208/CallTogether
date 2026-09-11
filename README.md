# CallTogether

Capture a **specific tab’s audio output** (not the microphone), show a live
floating transcript on the AI page, paste with a hotkey.

## Why “Requested device not found”?

That error was from **microphone** capture. CallTogether no longer uses the mic.
It uses Chrome’s **Share tab / screen audio** picker instead.

## Use

1. Reload the extension + refresh the AI tab  
2. Toolbar icon → **Share tab audio**  
3. In Chrome’s picker: choose the **call tab** and enable **audio**  
4. Transcript appears on the floating panel  
5. Hotkey (default `Alt+Shift+V`) pastes into the AI input + Enter  

## Tech

- Capture: `chrome.desktopCapture` (tab/system audio stream)  
- Speech: local Vosk inside a MV3 **sandbox** page (allowed `unsafe-eval`)  
- No paid API, no microphone required  
