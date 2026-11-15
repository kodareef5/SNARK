// Signs spelled out in letters that stand on the ground, for any line OpenStreetMap maps with an inscription of capitals
// and a height (blocks/signs.json, from ways.py): Los Angeles' Hollywood Sign maps each of its nine letters as a short
// line along its foot. The letters are set along the line from its first point, centred on it and spaced evenly, each
// turned along it and standing on the lowest ground under its foot, so on a slope its uphill end is buried a little
// rather than its downhill end floating. Their pieces are the content's capitals (content/lettering.ts), drawn at one
// height; a sign mapped much taller or shorter than they stand is left out and reported.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LETTER_HEIGHT, letterKind, letterWidth } from "../../content/lettering.ts";
import { Mason, type Point } from "./ruin-geometry.ts";
import { worldFrame } from "./bridges.ts";
import type { Site } from "./statics.ts";

interface Sign { id: number; inscription: string; height_m: number; name: string | null; length_m: number; points: [number, number][]; }
export interface SignRecord { id: number; inscription: string; status: string; letters: { letter: string; x: number; y: number; z: number; yaw: number; foot: number }[]; }

/** Letters drawn at LETTER_HEIGHT stand in for a sign mapped within this share of it. */
const SCALE_SLACK = 0.3;
/** How far the letters' feet go into the ground below the lowest point under them. */
const SINK = 0.3;

export function readSigns(source: string): Sign[] {
  const file = join(source, "blocks/signs.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Sign[]) : [];
}

export function makeSigns(site: Site, accept: (m: Mason) => boolean): SignRecord[] {
  const size = (site.ground.n - 1) * 2;
  const out: SignRecord[] = [];
  for (const sign of readSigns(site.source)) {
    const record: SignRecord = { id: sign.id, inscription: sign.inscription, status: "", letters: [] };
    out.push(record);
    const letters = [...sign.inscription.replace(/ /g, "")];
    if (Math.abs(sign.height_m / LETTER_HEIGHT - 1) > SCALE_SLACK) { record.status = `mapped ${sign.height_m} m tall; the letters stand ${LETTER_HEIGHT} m`; continue; }
    const line = sign.points.map(([e, n]) => site.toEngine(e, n) as Point);
    let [a, b] = [line[0]!, line.at(-1)!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.5) { record.status = "a line too short to read along"; continue; }
    // A letter's face is its +z side, (sin yaw, cos yaw) on the map. On a slope it faces down it, toward whoever reads it,
    // whichever way the line was drawn; on the level it reads from the line's first point.
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
    const fall = (sx: number, sz: number): number => site.groundAt(mid[0] - sx * 8, mid[1] - sz * 8) - site.groundAt(mid[0] + sx * 8, mid[1] + sz * 8);
    const yaw0 = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    if (fall(Math.sin(yaw0), Math.cos(yaw0)) < -0.5) [a, b] = [b, a];
    const ax = (b[0] - a[0]) / length; const az = (b[1] - a[1]) / length;
    const yaw = (((Math.atan2(-az, ax) * 180) / Math.PI) % 360 + 360) % 360;
    // The word is centred on the line, its letters at their own widths and the spare length shared between them.
    const widths = letters.map(letterWidth);
    const total = widths.reduce((s, w) => s + w, 0);
    const gap = letters.length > 1 ? Math.max(0.6, (length - total) / (letters.length - 1)) : 0;
    let s = length / 2 - (total + gap * (letters.length - 1)) / 2;
    const m = new Mason(worldFrame(size), 0);
    for (const [k, letter] of letters.entries()) {
      const w = widths[k]!;
      const mid = s + w / 2;
      s += w + gap;
      if (!w) continue;
      const x = a[0] + ax * mid; const z = a[1] + az * mid;
      let foot = Infinity;
      for (let t = -w / 2; t <= w / 2 + 1e-6; t += w / 4) for (const across of [-0.5, 0.5]) foot = Math.min(foot, site.groundAt(x + ax * t - az * across, z + az * t + ax * across));
      const y = foot - SINK + LETTER_HEIGHT / 2;
      m.pieces.push({ kind: letterKind(letter), x, y, z, yaw });
      m.clear.push({ x, z, radius: w / 2 + 3 });
      record.letters.push({ letter, x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), z: Number(z.toFixed(2)), yaw: Number(yaw.toFixed(1)), foot: Number(foot.toFixed(2)) });
    }
    record.status = m.pieces.length && accept(m) ? "built" : "budget or bounds";
  }
  return out;
}

/** Whether engine x and z lie within `reach` metres of a sign's line, for the places a sign stands in for. */
export function nearSign(site: Site, reach: number): (x: number, z: number) => boolean {
  const lines = readSigns(site.source).map((s) => s.points.map(([e, n]) => site.toEngine(e, n) as Point));
  return (x, z) => lines.some((line) => line.some(([px, pz]) => Math.hypot(px - x, pz - z) < reach));
}
