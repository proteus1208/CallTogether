const SpeechRecognition =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

let recognition = null;
let shouldRun = false;

function createRecognition() {
  if (!SpeechRecognition) {
    throw new Error("Chrome Speech API is unavailable.");
  }

  const instance = new SpeechRecognition();
  instance.continuous = true;
  instance.interimResults = true;
  instance.lang = "en-US";
  instance.maxAlternatives = 1;

  instance.onstart = () => {
    chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
  };

  instance.onerror = (event) => {
    const error = event?.error || "speech error";
    if (error === "aborted" || error === "no-speech") return;
    if (error === "not-allowed") {
      shouldRun = false;
      chrome.runtime.sendMessage({
        type: "CAPTURE_ERROR",
        error: "Microphone permission denied for speech recognition.",
      });
      return;
    }
    chrome.runtime.sendMessage({
      type: "CAPTURE_ERROR",
      error: `Speech error: ${error}`,
    });
  };

  instance.onend = () => {
    if (shouldRun) {
      try {
        instance.start();
      } catch {
        shouldRun = false;
        chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
      }
      return;
    }
    chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
  };

  instance.onresult = (event) => {
    let interim = "";
    let newlyFinal = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = (result[0]?.transcript || "").trim();
      if (!text) continue;
      if (result.isFinal) newlyFinal += `${text} `;
      else interim += `${text} `;
    }

    newlyFinal = newlyFinal.trim();
    interim = interim.trim();

    if (newlyFinal) {
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text: newlyFinal });
    } else if (interim) {
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_PARTIAL", text: interim });
    }
  };

  return instance;
}

async function startSpeech() {
  // Ensure mic is usable in this extension document (shows no UI if already granted).
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    await chrome.runtime.sendMessage({
      type: "CAPTURE_ERROR",
      error:
        error?.name === "NotAllowedError"
          ? "Microphone permission is required."
          : error?.message || "Microphone unavailable.",
    });
    return { ok: false };
  }

  if (!recognition) {
    recognition = createRecognition();
  }

  shouldRun = true;
  try {
    recognition.start();
    return { ok: true };
  } catch (error) {
    shouldRun = false;
    return { ok: false, error: error?.message || "Could not start speech." };
  }
}

async function stopSpeech() {
  shouldRun = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      // ignore
    }
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target && message.target !== "offscreen") return;

  if (message?.type === "OFFSCREEN_START_SPEECH") {
    startSpeech().then(sendResponse);
    return true;
  }

  if (message?.type === "OFFSCREEN_STOP_SPEECH") {
    stopSpeech().then(sendResponse);
    return true;
  }
});
