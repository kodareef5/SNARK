// Reads only the horizontal metrics and BMP cmap needed to measure the bundled TrueType UI face.
import { readFileSync } from "node:fs";

/** The face's tables, and the glyph its BMP cmap gives a character (0 for none). */
function readFace(file: string): { view: DataView; table: (name: string) => number; glyph: (code: number) => number } {
  const bytes = readFileSync(file), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    tables.set(bytes.toString("ascii", at, at + 4), view.getUint32(at + 8));
  }
  const table = (name: string): number => { const at = tables.get(name); if (at === undefined) throw new Error(`font: missing ${name}`); return at; };
  const cmap = table("cmap");
  let map = 0;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const at = cmap + 4 + i * 8, sub = cmap + view.getUint32(at + 4);
    if (view.getUint16(sub) === 4) map = sub;
  }
  if (!map) throw new Error("font: no BMP cmap");
  const segments = view.getUint16(map + 6) / 2, ends = map + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
  const glyph = (code: number): number => {
    for (let i = 0; i < segments; i++) {
      if (code > view.getUint16(ends + i * 2) || code < view.getUint16(starts + i * 2)) continue;
      const delta = view.getInt16(deltas + i * 2), offset = view.getUint16(offsets + i * 2);
      let g = offset === 0 ? (code + delta) & 65535 : view.getUint16(offsets + i * 2 + offset + (code - view.getUint16(starts + i * 2)) * 2);
      if (offset !== 0 && g !== 0) g = (g + delta) & 65535;
      return g;
    }
    return 0;
  };
  return { view, table, glyph };
}

export function fontAdvances(file: string, count = 256): { units: number; advances: number[] } {
  const { view, table, glyph } = readFace(file);
  const units = view.getUint16(table("head") + 18), metrics = view.getUint16(table("hhea") + 34), hmtx = table("hmtx");
  const advances: number[] = [];
  for (let code = 0; code < count; code++) advances.push(view.getUint16(hmtx + Math.min(glyph(code), metrics - 1) * 4));
  return { units, advances };
}

/** Every character of the Basic Multilingual Plane the face draws, in order. */
export function fontCharacters(file: string): number[] {
  const { glyph } = readFace(file), out: number[] = [];
  for (let code = 0; code < 0x10000; code++) if (glyph(code) !== 0) out.push(code);
  return out;
}
