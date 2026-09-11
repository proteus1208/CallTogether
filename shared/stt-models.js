/** Available speech-to-text language models (Vosk small). */
export const STT_MODEL_CATALOG = [
  {
    code: "en",
    name: "English",
    sizeLabel: "40 MB",
    bundledPath: "models/en-us-small.tar.gz",
  },
  {
    code: "es",
    name: "Spanish",
    sizeLabel: "39 MB",
    downloadUrl: "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip",
  },
  {
    code: "pt",
    name: "Portuguese",
    sizeLabel: "31 MB",
    downloadUrl: "https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip",
  },
  {
    code: "fr",
    name: "French",
    sizeLabel: "41 MB",
    downloadUrl: "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip",
  },
  {
    code: "de",
    name: "German",
    sizeLabel: "45 MB",
    downloadUrl: "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip",
  },
];

export function sttModelByCode(code) {
  return STT_MODEL_CATALOG.find((item) => item.code === code) || null;
}
