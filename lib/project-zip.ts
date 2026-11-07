// Copyright © 2026 Alen Pepa
import { validateCodeProjects, type CodeProject } from "./code-projects.ts";
const table = Uint32Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export function projectCrc32(bytes: Uint8Array): number { let value = 0xffffffff; for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
export function codeProjectZip(input: CodeProject, now = new Date()): Uint8Array {
  const project = validateCodeProjects([input])[0], encode = new TextEncoder(), local: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  const date = Number.isFinite(now.getTime()) ? now : new Date(0), year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(), dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  for (const file of project.files) {
    const name = encode.encode(`${project.slug}/${file.path}`), bytes = encode.encode(file.content), crc = projectCrc32(bytes), header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(10, dosTime, true); view.setUint16(12, dosDate, true); view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
    const directory = new Uint8Array(46 + name.length), entry = new DataView(directory.buffer);
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x800, true); entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true); entry.setUint32(16, crc, true); entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true); entry.setUint16(28, name.length, true); entry.setUint32(38, 0x20, true); entry.setUint32(42, offset, true); directory.set(name, 46);
    local.push(header, bytes); central.push(directory); offset += header.length + bytes.length;
  }
  const centralLength = central.reduce((sum, item) => sum + item.length, 0), end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, project.files.length, true); view.setUint16(10, project.files.length, true); view.setUint32(12, centralLength, true); view.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralLength + end.length); let position = 0;
  for (const part of [...local, ...central, end]) { result.set(part, position); position += part.length; }
  return result;
}
