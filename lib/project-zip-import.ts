// Copyright © 2026 Alen Pepa
import { projectCrc32 } from "./project-zip.ts";
import { checkImportAbort, importRelativePath, projectImportLimits, readProjectBytes, type SourceEntry } from "./project-import.ts";
const utf8 = new TextDecoder("utf-8", { fatal: true });
// Read ZIP central-directory metadata first. Inflate only selected source files,
// with bounded output; encrypted, split and ZIP64 archives are unsupported.
export function projectZipEntries(bytes: Uint8Array): SourceEntry[] {
  if (bytes.byteLength > projectImportLimits.archiveBytes) throw Error("project_import_size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), size = bytes.length;
  if (size < 22) throw Error("project_zip_invalid");
  let end = -1;
  for (let offset = size - 22; offset >= Math.max(0, size - 22 - 65535); offset--) if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === size) { end = offset; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== view.getUint16(end + 10, true)) throw Error("project_zip_invalid");
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true), centralOffset = view.getUint32(end + 16, true);
  if (count === 65535 || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw Error("project_zip_unsupported");
  if (count > projectImportLimits.entries) throw Error("project_import_entries");
  if (centralOffset + centralSize !== end) throw Error("project_zip_invalid");
  const entries: SourceEntry[] = []; let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw Error("project_zip_invalid");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), disk = view.getUint16(cursor + 34, true), attributes = view.getUint32(cursor + 38, true), local = view.getUint32(cursor + 42, true);
    if (flags & 1 || disk || compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff) throw Error("project_zip_unsupported");
    if (!nameLength || cursor + 46 + nameLength + extraLength + commentLength > end || local + 30 > centralOffset || view.getUint32(local, true) !== 0x04034b50) throw Error("project_zip_invalid");
    let name: string; try { name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); } catch { throw Error("project_zip_encoding"); }
    const normalizedName = name.replace(/\\/g, "/");
    const directory = normalizedName.endsWith("/") || Boolean(attributes & 0x10) || (attributes >>> 16 & 0xf000) === 0x4000;
    const rootMarker = directory && (normalizedName === "." || /^(?:\.\/)+$/.test(normalizedName));
    if (!rootMarker) importRelativePath(normalizedName.endsWith("/") ? normalizedName.slice(0, -1) : normalizedName);
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true), dataStart = local + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > centralOffset || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags || nameLength !== localNameLength || !bytes.subarray(local + 30, local + 30 + localNameLength).every((byte, i) => byte === bytes[cursor + 46 + i])) throw Error("project_zip_invalid");
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== expanded)) throw Error("project_zip_corrupt");
    if (method === 0 && compressed !== expanded) throw Error("project_zip_corrupt");
    if (!directory) entries.push({ path: importRelativePath(normalizedName), size: expanded, link: (attributes >>> 16 & 0xf000) === 0xa000, async read(signal) {
      checkImportAbort(signal); if (expanded > projectImportLimits.fileBytes) throw Error("project_import_size");
      let result: Uint8Array;
      if (method === 0) result = bytes.slice(dataStart, dataStart + compressed);
      else if (method === 8) {
        let inflate: DecompressionStream; try { inflate = new DecompressionStream("deflate-raw"); } catch { throw Error("project_zip_browser"); }
        try { result = await readProjectBytes(new Blob([bytes.slice(dataStart, dataStart + compressed)]).stream().pipeThrough(inflate), Math.min(expanded, projectImportLimits.fileBytes), signal); }
        catch (error) { checkImportAbort(signal); if (error instanceof Error && error.message === "project_import_size") throw error; throw Error("project_zip_corrupt"); }
      } else throw Error("project_zip_unsupported");
      checkImportAbort(signal);
      if (result.length !== expanded || projectCrc32(result) !== crc) throw Error("project_zip_corrupt");
      return result;
    } });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw Error("project_zip_invalid");
  return entries;
}
