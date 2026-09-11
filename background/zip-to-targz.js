/**
 * Convert a Vosk model .zip (ArrayBuffer) into a browser-ready .tar.gz ArrayBuffer.
 * Strips a single top-level folder if present so entries start at am/, conf/, …
 */

function u16(view, offset) {
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  return view.getUint32(offset, true);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot unpack speech models.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("deflate-raw")
  );
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readZipEntries(zipBuffer) {
  const bytes = new Uint8Array(zipBuffer);
  const view = new DataView(zipBuffer);
  let end = bytes.length - 22;
  while (end >= 0 && u32(view, end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Invalid model zip.");

  const count = u16(view, end + 10);
  let offset = u32(view, end + 16);
  const files = [];

  for (let i = 0; i < count; i += 1) {
    if (u32(view, offset) !== 0x02014b50) break;
    const method = u16(view, offset + 10);
    const compSize = u32(view, offset + 20);
    const nameLen = u16(view, offset + 28);
    const extraLen = u16(view, offset + 30);
    const commentLen = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;

    const localMethod = u16(view, localOffset + 8);
    const localNameLen = u16(view, localOffset + 26);
    const localExtraLen = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    const useMethod = method || localMethod;

    let data;
    if (useMethod === 0) data = compressed.slice();
    else if (useMethod === 8) data = await inflateRaw(compressed);
    else throw new Error(`Unsupported zip method (${useMethod}) in model.`);

    files.push({ name, data });
  }
  return files;
}

function stripCommonRoot(files) {
  let result = files.slice();
  for (;;) {
    if (!result.length) return result;
    const first = result[0].name;
    const slash = first.indexOf("/");
    if (slash <= 0) return result;
    const root = first.slice(0, slash + 1);
    if (
      root === "am/" ||
      root === "conf/" ||
      root === "graph/" ||
      root === "ivector/"
    ) {
      return result;
    }
    if (!result.every((f) => f.name.startsWith(root))) return result;
    const stripped = result.map((f) => ({
      name: f.name.slice(root.length),
      data: f.data,
    }));
    if (
      !stripped.some(
        (f) =>
          f.name.startsWith("am/") ||
          f.name.startsWith("conf/") ||
          f.name.startsWith("graph/")
      )
    ) {
      return result;
    }
    result = stripped;
  }
}

function pad512(n) {
  return (512 - (n % 512)) % 512;
}

function writeTarHeader(name, size, typeFlag) {
  const encoder = new TextEncoder();
  const header = new Uint8Array(512);
  const nameBytes = encoder.encode(name).slice(0, 100);
  header.set(nameBytes, 0);
  const mode = typeFlag === "5" ? "0000755\0" : "0000644\0";
  header.set(encoder.encode(mode), 100);
  header.set(encoder.encode("0000000\0"), 108);
  header.set(encoder.encode("0000000\0"), 116);
  const sizeOct = `${Number(size).toString(8).padStart(11, "0")}\0`;
  header.set(encoder.encode(sizeOct), 124);
  header.set(encoder.encode("00000000000\0"), 136);
  header[156] = typeFlag.charCodeAt(0);
  header.set(encoder.encode("ustar\0"), 257);
  header.set(encoder.encode("00"), 263);

  let checksum = 0;
  for (let i = 0; i < 512; i += 1) checksum += i >= 148 && i < 156 ? 32 : header[i];
  const sum = `${checksum.toString(8).padStart(6, "0")}\0 `;
  header.set(encoder.encode(sum), 148);
  return header;
}

/**
 * Build a tar that matches vosk-browser's English model layout:
 * one top-level folder (e.g. model/am/final.mdl). Browser Vosk always
 * stripFirstComponent=true on extract — without that wrapper, am/ is
 * stripped and recognition silently produces no text.
 */
function writeTar(files) {
  const parts = [];
  const dirs = new Set(["model/"]);

  for (const file of files) {
    if (!file.name || file.name.endsWith("/")) continue;
    const rel = file.name.replace(/^\/+/, "").replace(/^\.\//, "");
    if (!rel) continue;
    const full = `model/${rel}`;
    const segments = full.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      dirs.add(`${segments.slice(0, i).join("/")}/`);
    }
  }

  for (const dir of [...dirs].sort()) {
    parts.push(writeTarHeader(dir, 0, "5"));
  }

  for (const file of files) {
    if (!file.name || file.name.endsWith("/")) continue;
    const rel = file.name.replace(/^\/+/, "").replace(/^\.\//, "");
    if (!rel) continue;
    const name = `model/${rel}`;
    const data = file.data;
    parts.push(writeTarHeader(name, data.byteLength, "0"), data);
    const pad = pad512(data.byteLength);
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(1024)); // two zero blocks
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

async function gzipBytes(bytes) {
  if (typeof CompressionStream !== "function") {
    throw new Error("This browser cannot pack speech models.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

export async function zipModelToTarGz(zipBuffer) {
  const entries = stripCommonRoot(await readZipEntries(zipBuffer));
  const names = new Set(entries.map((e) => e.name));
  const required = ["am/final.mdl", "conf/mfcc.conf"];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) {
    throw new Error(
      `Downloaded model is incomplete (missing ${missing.join(", ")}).`
    );
  }
  // Prefer models that include a decoder graph (browser Vosk needs it).
  if (
    ![...names].some(
      (name) =>
        name === "graph/Gr.fst" ||
        name === "graph/HCLr.fst" ||
        name === "graph/HCLG.fst" ||
        name.endsWith("/Gr.fst") ||
        name.endsWith("/HCLG.fst")
    )
  ) {
    throw new Error(
      "Downloaded model has no decoder graph (not compatible with browser Vosk)."
    );
  }
  const tar = writeTar(entries);
  return gzipBytes(tar);
}
