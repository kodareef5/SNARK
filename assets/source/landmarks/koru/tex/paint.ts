// Koru's one atlas, painted from numbers: teak decking, joinery, cloth, water, a chart, the flat finishes, and brass
// plaques lettered in the repo's Barlow face. Nothing of a photograph. From the repo's root:
//   bun assets/source/landmarks/koru/tex/paint.ts
// It writes surfaces_{base,height,normal,packed}.png beside itself, and ../signs.json: where each plaque's lettering is.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodePng } from "../../../../../tools/pack/image.ts";

interface Finish { rect: [number, number, number, number]; tile?: [number, number] | null; rgb: [number, number, number]; roughness: number; metal: number }
const HERE = import.meta.dir;
const ROOT = resolve(HERE, "../../../../..");
const LOOK = JSON.parse(readFileSync(join(HERE, "../materials.json"), "utf8")) as { size: number; inset: number; signs: [number, number, number, number]; finishes: Record<string, Finish> };
const LAYOUT = JSON.parse(readFileSync(join(ROOT, "content/landmarks/koru-layout.json"), "utf8")) as { signs: { label: string }[] };
const N = LOOK.size;

const base = new Float32Array(N * N * 3).fill(140);
const height = new Float32Array(N * N).fill(0.5);
const rough = new Float32Array(N * N);
const metal = new Float32Array(N * N);
const TAU = Math.PI * 2;
const frac = (x: number): number => x - Math.floor(x);

function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise of about -1 to 1, repeating every `period` cells, so a tile meets itself. */
function noise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (i: number, j: number): number => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx, bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
  return (top + (bottom - top) * sy) * 2 - 1;
}

/** Tone in levels and relief in height at u, v across a finish's rectangle (0 to 1, v down), and px, py within it. */
type Pattern = (u: number, v: number, px: number, py: number) => [number, number];
const weave = (px: number, py: number, period: number): number => (px % period === 0 ? 1 : 0) + (py % period === 0 ? 1 : 0) - 0.6;
const PATTERNS: Record<string, Pattern> = {
  // Sixteen 12.5 cm planks a 2 m tile, caulked seams, a butt joint a plank, grain along the plank.
  teak: (u, v) => {
    const plank = Math.floor(u * 16), across = frac(u * 16), joint = frac(v + hash(plank, 0, 7));
    const grain = Math.sin(TAU * (u * 160 + 0.35 * Math.sin(TAU * (v * 3 + hash(plank, 1, 7))))) * 0.6 + Math.sin(TAU * (u * 368 + 0.2 * Math.sin(TAU * v * 7))) * 0.4;
    let tone = grain * 4 + (hash(plank, 2, 7) - 0.5) * 16 + noise(u * 64, v * 64, 64, 3) * 3;
    let relief = grain * 0.006;
    if (Math.min(across, 1 - across) < 0.035) { tone -= 58; relief -= 0.08; }
    else if (Math.min(joint, 1 - joint) < 0.002) { tone -= 30; relief -= 0.045; }
    return [tone, relief];
  },
  // Varnished joinery: boards 25 cm deep, grain along them.
  mahogany: (u, v) => {
    const board = Math.floor(v * 4), across = frac(v * 4);
    const grain = Math.sin(TAU * (v * 96 + 0.5 * Math.sin(TAU * (u * 2 + hash(board, 0, 11))))) * 0.6 + Math.sin(TAU * v * 230) * 0.4;
    let tone = grain * 3 + (hash(board, 1, 11) - 0.5) * 8 + noise(u * 48, v * 24, 48, 5) * 2;
    let relief = grain * 0.004;
    if (Math.min(across, 1 - across) < 0.012) { tone -= 22; relief -= 0.05; }
    return [tone, relief];
  },
  fabric: (_u, _v, px, py) => [weave(px, py, 3) * 2.4 + noise(px / 8, py / 8, 64, 13) * 0.8, weave(px, py, 3) * 0.012],
  rug: (u, v, px, py) => {
    const diamond = Math.abs(frac(u * 8) - 0.5) + Math.abs(frac(v * 8) - 0.5) < 0.25 ? 15 : 0;
    return [((Math.floor(u * 16) + Math.floor(v * 16)) % 2) * 8 + diamond + weave(px, py, 3) * 2, weave(px, py, 3) * 0.01];
  },
  pool: (u, v) => {
    const c = Math.sin(TAU * (u * 5 + 0.3 * Math.sin(TAU * v * 3))) * Math.sin(TAU * (v * 5 + 0.3 * Math.sin(TAU * u * 2)));
    return [c * 8, c * 0.006];
  },
  // A fictional coastal chart: a grid and a shore.
  screen: (u, v, px, py) => {
    let tone = (px % 43 < 1 || py % 43 < 1 ? 9 : 0) + noise(px / 6, py / 6, 128, 17) * 0.4;
    if (v - (0.5 + 0.18 * Math.sin(u * 5) + 0.04 * Math.sin(u * 24)) > 0) tone += 12;
    return [tone, 0];
  },
  steel: (_u, v, px, py) => [Math.sin(v * 2400) * 2 + noise(px / 4, py / 64, 128, 19) * 0.6, Math.sin(v * 2400) * 0.0015],
  canvas: (_u, _v, px, py) => [weave(px, py, 5) * 2 + noise(px / 16, py / 16, 32, 23), weave(px, py, 5) * 0.008],
};

for (const [name, f] of Object.entries(LOOK.finishes)) {
  const [x0, y0, w, h] = f.rect;
  const pattern = PATTERNS[name];
  // A face takes its picture from within the inset, so a tiling picture repeats over that window and runs on into the inset.
  const inner = f.tile ? LOOK.inset : 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const [tone, relief] = pattern ? pattern(frac((px - inner + 0.5) / (w - 2 * inner)), frac((py - inner + 0.5) / (h - 2 * inner)), px, py) : [0, 0];
      const at = (y0 + py) * N + x0 + px;
      for (let c = 0; c < 3; c++) base[at * 3 + c] = f.rgb[c]! + tone + (name === "screen" && c === 1 ? 9 : 0);
      height[at] = 0.5 + relief;
      rough[at] = f.roughness;
      metal[at] = f.metal;
    }
  }
}

// The plaques: brass, a raised rim and raised capitals, a line or two.
interface Font { units: number; ascent: number; advance(code: number): number; outline(code: number): [number, number][][] }
function readFont(file: string): Font {
  const b = readFileSync(file), view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) tables.set(b.toString("ascii", 12 + i * 16, 16 + i * 16), view.getUint32(20 + i * 16));
  const t = (name: string): number => tables.get(name)!;
  const units = view.getUint16(t("head") + 18), longLoca = view.getInt16(t("head") + 50) === 1, metrics = view.getUint16(t("hhea") + 34);
  let map = 0;
  for (let i = 0; i < view.getUint16(t("cmap") + 2); i++) {
    const sub = t("cmap") + view.getUint32(t("cmap") + 8 + i * 8);
    if (view.getUint16(sub) === 4) map = sub;
  }
  const segments = view.getUint16(map + 6) / 2, ends = map + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
  const glyph = (code: number): number => {
    for (let i = 0; i < segments; i++) {
      if (code > view.getUint16(ends + i * 2) || code < view.getUint16(starts + i * 2)) continue;
      const delta = view.getInt16(deltas + i * 2), offset = view.getUint16(offsets + i * 2);
      if (offset === 0) return (code + delta) & 65535;
      const g = view.getUint16(offsets + i * 2 + offset + (code - view.getUint16(starts + i * 2)) * 2);
      return g === 0 ? 0 : (g + delta) & 65535;
    }
    return 0;
  };
  const loca = (g: number): number => t("glyf") + (longLoca ? view.getUint32(t("loca") + g * 4) : view.getUint16(t("loca") + g * 2) * 2);
  return {
    units,
    ascent: view.getInt16(t("hhea") + 4),
    advance: (code) => view.getUint16(t("hmtx") + Math.min(glyph(code), metrics - 1) * 4),
    outline: (code) => {
      const g = glyph(code), at = loca(g);
      if (at === loca(g + 1)) return [];
      const contours = view.getInt16(at);
      if (contours < 0) throw new Error(`paint: "${String.fromCharCode(code)}" is a composite glyph`);
      const last: number[] = [];
      for (let i = 0; i < contours; i++) last.push(view.getUint16(at + 10 + i * 2));
      const count = last[contours - 1]! + 1;
      let p = at + 10 + contours * 2;
      p += 2 + view.getUint16(p);
      const flags: number[] = [];
      while (flags.length < count) {
        const f = b[p++]!;
        flags.push(f);
        if (f & 8) for (let r = b[p++]!; r > 0; r--) flags.push(f);
      }
      const coords = (short: number, same: number): number[] => {
        const out: number[] = [];
        let v = 0;
        for (const f of flags) {
          if (f & short) v += f & same ? b[p++]! : -b[p++]!;
          else if (!(f & same)) { v += view.getInt16(p); p += 2; }
          out.push(v);
        }
        return out;
      };
      const xs = coords(2, 16), ys = coords(4, 32);
      const out: [number, number][][] = [];
      let first = 0;
      for (const end of last) {
        const pts = Array.from({ length: end - first + 1 }, (_, k) => ({ x: xs[first + k]!, y: ys[first + k]!, on: (flags[first + k]! & 1) === 1 }));
        first = end + 1;
        // Quadratic B-splines: between two off-curve points lies an implied on-curve one.
        const start = pts.findIndex((q) => q.on);
        const ring = start < 0 ? pts : [...pts.slice(start), ...pts.slice(0, start)];
        const line: [number, number][] = [];
        let from = start < 0 ? { x: (ring[0]!.x + ring[ring.length - 1]!.x) / 2, y: (ring[0]!.y + ring[ring.length - 1]!.y) / 2 } : ring[0]!;
        line.push([from.x, from.y]);
        let control: { x: number; y: number } | null = null;
        for (let k = 1; k <= ring.length; k++) {
          const q = ring[k % ring.length]!;
          if (!q.on && control) {
            const mid = { x: (control.x + q.x) / 2, y: (control.y + q.y) / 2 };
            for (let s = 1; s <= 6; s++) { const tt = s / 6; line.push([(1 - tt) ** 2 * from.x + 2 * tt * (1 - tt) * control.x + tt * tt * mid.x, (1 - tt) ** 2 * from.y + 2 * tt * (1 - tt) * control.y + tt * tt * mid.y]); }
            from = mid;
            control = q;
          } else if (!q.on) control = q;
          else if (control) {
            for (let s = 1; s <= 6; s++) { const tt = s / 6; line.push([(1 - tt) ** 2 * from.x + 2 * tt * (1 - tt) * control.x + tt * tt * q.x, (1 - tt) ** 2 * from.y + 2 * tt * (1 - tt) * control.y + tt * tt * q.y]); }
            from = q;
            control = null;
          } else { line.push([q.x, q.y]); from = q; }
        }
        out.push(line);
      }
      return out;
    },
  };
}

/** Coverage, 0 to 1, of closed polylines in pixels over a w by h block, by the non-zero rule, five sub-rows a row. */
function cover(rings: [number, number][][], w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const S = 5;
  for (let row = 0; row < h; row++) {
    for (let s = 0; s < S; s++) {
      const y = row + (s + 0.5) / S;
      const cross: [number, number][] = [];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
          if ((ay <= y) === (by <= y)) continue;
          cross.push([ax + ((y - ay) * (bx - ax)) / (by - ay), by > ay ? 1 : -1]);
        }
      }
      cross.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let i = 0; i < cross.length - 1; i++) {
        winding += cross[i]![1];
        if (winding === 0) continue;
        const a = Math.max(0, cross[i]![0]), b = Math.min(w, cross[i + 1]![0]);
        for (let x = Math.floor(a); x < Math.ceil(b); x++) out[row * w + x]! += (Math.min(b, x + 1) - Math.max(a, x)) / S;
      }
    }
  }
  return out;
}

const font = readFont(join(ROOT, "assets/raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf"));
const labels = [...new Set(LAYOUT.signs.map((s) => s.label))].sort();
const wide = ["KORU"];
const plaques = [...wide, "LOWER DECK", "MAIN DECK", "UPPER DECK", "SUN DECK", "SAILS", ...labels];
const [sx, sy, , sh] = LOOK.signs;
const SLOT_W = 256, SLOT_H = sh / 5;
const signs: Record<string, [number, number, number, number]> = {};
let slot = 0;
for (const label of plaques) {
  const span = wide.includes(label) ? 2 : 1;
  if (slot % 4 + span > 4) slot += 4 - (slot % 4);
  const x0 = sx + (slot % 4) * SLOT_W, y0 = sy + Math.round(Math.floor(slot / 4) * SLOT_H), y1 = sy + Math.round((Math.floor(slot / 4) + 1) * SLOT_H);
  if (y1 > sy + sh) throw new Error("paint: the plaques do not fit");
  const w = SLOT_W * span, h = y1 - y0;
  signs[label] = [x0, y0, w, h];
  slot += span;
  const rim = (x: number, y: number): number => {
    const r = 9, dx = Math.max(0, Math.abs(x + 0.5 - w / 2) - (w / 2 - 5 - r)), dy = Math.max(0, Math.abs(y + 0.5 - h / 2) - (h / 2 - 5 - r));
    const d = Math.hypot(dx, dy);
    return d > r ? 0 : d > r - 3 ? 2 : 1;
  };
  // One line, or two split at the space nearest the middle, whichever letters larger.
  const words = label.toUpperCase();
  const widthOf = (s: string): number => [...s].reduce((n, c) => n + font.advance(c.charCodeAt(0)), 0);
  const splits = [[words]];
  const at = words.split("").map((c, i) => (c === " " ? i : -1)).filter((i) => i > 0).sort((a, b) => Math.abs(a - words.length / 2) - Math.abs(b - words.length / 2))[0];
  if (at !== undefined) splits.push([words.slice(0, at), words.slice(at + 1)]);
  const size = (lines: string[]): number => Math.min((w - 34) / Math.max(...lines.map(widthOf)), (h - 26) / (lines.length * 0.82 + (lines.length - 1) * 0.22) / font.units) * font.units;
  const lines = splits.reduce((a, b) => (size(b) > size(a) * 1.08 ? b : a));
  const scale = Math.min(size(lines), 0.62 * h) / font.units, cap = 0.7 * font.units * scale, gap = 0.3 * cap;
  const rings: [number, number][][] = [];
  lines.forEach((line, k) => {
    const y = (h - lines.length * cap - (lines.length - 1) * gap) / 2 + cap + k * (cap + gap);
    let pen = (w - widthOf(line) * scale) / 2;
    for (const c of line) {
      for (const ring of font.outline(c.charCodeAt(0))) rings.push(ring.map(([gx, gy]) => [pen + gx * scale, y - gy * scale]));
      pen += font.advance(c.charCodeAt(0)) * scale;
    }
  });
  const letters = cover(rings, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * N + x0 + x, edge = rim(x, y), ink = Math.min(1, letters[y * w + x]!);
      const plate = [158, 123, 67].map((c) => c + noise(x / 3, y / 40, 512, 29) * 2);
      const colour = edge === 2 ? [213, 186, 124] : edge === 0 ? [118, 92, 50] : plate.map((c, k) => c + ([240, 224, 183][k]! - c) * ink);
      for (let c = 0; c < 3; c++) base[i * 3 + c] = colour[c]!;
      height[i] = edge === 0 ? 0.47 : 0.5 + (edge === 2 ? 0.03 : 0) + ink * 0.04;
      rough[i] = 0.3;
      metal[i] = 0.85;
    }
  }
}

const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const picture = (side: number, channels: number, fill: (i: number, c: number) => number): Uint8Array => {
  const data = new Uint8Array(side * side * channels);
  for (let i = 0; i < side * side; i++) for (let c = 0; c < channels; c++) data[i * channels + c] = byte(fill(i, c));
  return encodePng({ width: side, height: side, channels, depth: 8, data });
};
writeFileSync(join(HERE, "surfaces_base.png"), picture(N, 3, (i, c) => base[i * 3 + c]!));
writeFileSync(join(HERE, "surfaces_height.png"), picture(N, 1, (i) => height[i]! * 255));
// The normal is the saved height's own slope, as the check measures it: x to the right, y up the picture.
const h8 = (x: number, y: number): number => byte(height[((y + N) % N) * N + ((x + N) % N)]! * 255) / 255;
writeFileSync(join(HERE, "surfaces_normal.png"), picture(N, 3, (i, c) => {
  const x = i % N, y = Math.floor(i / N);
  const nx = -(h8(x + 1, y) - h8(x - 1, y)) * 2, ny = (h8(x, y + 1) - h8(x, y - 1)) * 2, len = Math.hypot(nx, ny, 1);
  return ([nx, ny, 1][c]! / len * 0.5 + 0.5) * 255;
}));
// Occlusion, roughness and metalness at half the side, a mean of each two by two.
const half = N / 2;
writeFileSync(join(HERE, "surfaces_packed.png"), picture(half, 3, (i, c) => {
  const x = (i % half) * 2, y = Math.floor(i / half) * 2;
  let sum = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const j = (y + dy) * N + x + dx;
    sum += c === 0 ? 0.97 - Math.max(0, 0.5 - height[j]!) * 2.5 : c === 1 ? rough[j]! : metal[j]!;
  }
  return (sum / 4) * 255;
}));
writeFileSync(join(HERE, "../signs.json"), `{\n${Object.entries(signs).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`);
console.log(`painted a ${N} atlas and ${Object.keys(signs).length} plaques`);
