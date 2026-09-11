// Top-level extension page so Chrome shows its native microphone prompt
// ("Allow CallTogether to use your microphone?").
(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    stream.getTracks().forEach((track) => track.stop());
    await chrome.storage.local.set({ micGranted: true });
    await chrome.runtime.sendMessage({ type: "MIC_GRANTED" });
  } catch (error) {
    await chrome.storage.local.set({ micGranted: false });
    await chrome.runtime.sendMessage({
      type: "MIC_DENIED",
      error:
        error?.name === "NotAllowedError"
          ? "Microphone permission was blocked in Chrome’s prompt."
          : error?.message || "Microphone permission failed.",
    });
  } finally {
    // Close this helper tab/window; the native prompt is what matters.
    window.close();
  }
})();
