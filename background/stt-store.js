import { STT_MODEL_CATALOG, sttModelByCode } from "../shared/stt-models.js";
import { zipModelToTarGz } from "./zip-to-targz.js";

const DB_NAME = "calltogether-stt";
const DB_VERSION = 1;
const STORE = "models";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "code" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbPut(record) {
  const db = await openDb();
  // Store as Blob for reliable cross-context reads (SW ↔ capture host).
  const payload = {
    ...record,
    buffer:
      record.buffer instanceof Blob
        ? record.buffer
        : new Blob([record.buffer], { type: "application/gzip" }),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).put(payload);
  });
}

async function idbGet(code) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(code);
    req.onsuccess = async () => {
      const row = req.result || null;
      if (!row?.buffer) {
        resolve(null);
        return;
      }
      try {
        if (row.buffer instanceof Blob) {
          resolve({ ...row, buffer: await row.buffer.arrayBuffer() });
        } else if (row.buffer instanceof ArrayBuffer) {
          resolve(row);
        } else if (row.buffer?.buffer) {
          resolve({
            ...row,
            buffer: row.buffer.buffer.slice(
              row.buffer.byteOffset,
              row.buffer.byteOffset + row.buffer.byteLength
            ),
          });
        } else {
          resolve(null);
        }
      } catch (error) {
        reject(error);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(code) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).delete(code);
  });
}

export function defaultInstalledCodes() {
  return STT_MODEL_CATALOG.filter((m) => m.bundledPath).map((m) => m.code);
}

export async function readSttPrefs() {
  const stored = await chrome.storage.local.get([
    "sttLanguage",
    "sttInstalled",
  ]);
  const installed = Array.isArray(stored.sttInstalled)
    ? stored.sttInstalled.filter(Boolean)
    : defaultInstalledCodes();
  const unique = [...new Set(["en", ...installed])];
  let language = stored.sttLanguage || "en";
  if (!unique.includes(language)) language = "en";
  return { sttLanguage: language, sttInstalled: unique };
}

export async function writeSttPrefs({ sttLanguage, sttInstalled }) {
  const payload = {};
  if (sttLanguage != null) payload.sttLanguage = sttLanguage;
  if (sttInstalled != null) payload.sttInstalled = sttInstalled;
  await chrome.storage.local.set(payload);
}

function assertGzipTar(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1000) {
    throw new Error("Converted speech model is empty.");
  }
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    throw new Error("Converted speech model is not a valid gzip archive.");
  }
}

export async function getModelTarGzBuffer(code) {
  const meta = sttModelByCode(code);
  if (!meta) throw new Error("Unknown speech language.");

  if (meta.bundledPath) {
    const url = chrome.runtime.getURL(meta.bundledPath);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read bundled model (${response.status}).`);
    return await response.arrayBuffer();
  }

  const cached = await idbGet(code);
  if (cached?.buffer instanceof ArrayBuffer) {
    return cached.buffer;
  }
  throw new Error("Language model is not installed yet. Click Add first.");
}

export async function installSttModel(code, { onProgress } = {}) {
  const meta = sttModelByCode(code);
  if (!meta) throw new Error("Unknown speech language.");

  if (meta.bundledPath) {
    const prefs = await readSttPrefs();
    if (!prefs.sttInstalled.includes(code)) {
      prefs.sttInstalled.push(code);
      await writeSttPrefs({ sttInstalled: prefs.sttInstalled });
    }
    return { ok: true, code, bundled: true };
  }

  if (!meta.downloadUrl) throw new Error("No download URL for this language.");

  onProgress?.({ phase: "download", pct: 0 });
  const response = await fetch(meta.downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }

  const total = Number(response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  if (!reader) {
    const zipBuf = await response.arrayBuffer();
    onProgress?.({ phase: "convert", pct: 90 });
    const tarGz = await zipModelToTarGz(zipBuf);
    assertGzipTar(tarGz);
    await idbPut({ code, buffer: tarGz, updatedAt: Date.now() });
    onProgress?.({ phase: "done", pct: 100 });
  } else {
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) {
        onProgress?.({
          phase: "download",
          pct: Math.min(85, Math.round((received / total) * 85)),
        });
      }
    }
    const zipBuf = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      zipBuf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    onProgress?.({ phase: "convert", pct: 90 });
    const tarGz = await zipModelToTarGz(zipBuf.buffer);
    assertGzipTar(tarGz);
    await idbPut({ code, buffer: tarGz, updatedAt: Date.now() });
    onProgress?.({ phase: "done", pct: 100 });
  }

  const prefs = await readSttPrefs();
  if (!prefs.sttInstalled.includes(code)) {
    prefs.sttInstalled = [...prefs.sttInstalled, code];
    await writeSttPrefs({ sttInstalled: prefs.sttInstalled });
  }
  return { ok: true, code };
}

export async function uninstallSttModel(code) {
  if (code === "en") throw new Error("English model cannot be removed.");
  await idbDelete(code);
  const prefs = await readSttPrefs();
  prefs.sttInstalled = prefs.sttInstalled.filter((c) => c !== code);
  if (prefs.sttLanguage === code) prefs.sttLanguage = "en";
  await writeSttPrefs(prefs);
  return prefs;
}

export function listSttCatalog(prefs) {
  const installed = new Set(prefs.sttInstalled || []);
  return STT_MODEL_CATALOG.map((item) => ({
    code: item.code,
    name: item.name,
    sizeLabel: item.sizeLabel,
    bundled: Boolean(item.bundledPath),
    installed: installed.has(item.code) || Boolean(item.bundledPath),
    active: prefs.sttLanguage === item.code,
  }));
}
