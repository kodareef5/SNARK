// Draws break sets for review: a row to a component, a tile to a form, the pieces that leave drawn apart from what stands.
// A small picture maker of its own: flat faces, one light, outlines. The drafts are not kinds yet, so the game cannot draw them.

import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { hullOf } from "../../shared/world/convex.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../snap/font.ts";
import type { Chunk, Look } from "./cut.ts";
import type { Corner } from "./geometry.ts";

/** One thing in a tile: a look in a finish, moved by `shift` after its bared faces are told from its skin by `skin`. */
export interface Drawn {
  readonly look: Look;
  /** The finish's palette colour and the colour of its faces that look down. */
  readonly finish: readonly [number, number];
  /** The whole piece's boxes. A face of a bared chunk on their surface is skin; the rest is core. */
  readonly skin: readonly ShapeBox[];
  readonly shift?: Corner;
}

export interface Tile {
  readonly title: string;
  readonly note?: string;
  readonly things: readonly Drawn[];
}

export interface Row {
  readonly title: string;
  readonly tiles: readonly Tile[];
  /** Degrees the eye is round from the front and up from level. */
  readonly eye?: readonly [number, number];
}

const TILE_W = 380, TILE_H = 300, HEAD = 34, SCALE = 2;
/** A break's bared core, as content/ruins.ts has it. */
const CORE = 102;
const PALETTE = defaultPalette();
const BACK = [236, 233, 226] as const, INK = [38, 36, 34] as const;

type Face = { ring: Corner[]; color: number; normal: Corner; dim?: number };

const sub = (a: Corner, b: Corner): Corner => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossed = (a: Corner, b: Corner): Corner => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Corner): Corner => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function boxFaces(b: ShapeBox, color: number, under: number): Face[] {
  const c = (sx: number, sy: number, sz: number): Corner => [b.at[0] + sx * b.half[0], b.at[1] + sy * b.half[1], b.at[2] + sz * b.half[2]];
  const quads: [Corner, Corner[]][] = [
    [[1, 0, 0], [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)]], [[-1, 0, 0], [c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), c(-1, -1, -1)]],
    [[0, 1, 0], [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)]], [[0, -1, 0], [c(-1, -1, 1), c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1)]],
    [[0, 0, 1], [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)]], [[0, 0, -1], [c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)]],
  ];
  return quads.map(([normal, ring]) => ({ ring, normal, color: b.color ?? (normal[1] < 0 ? under : color) }));
}

/** Whether a point is on the surface of one of the whole piece's boxes. */
function onSkin(p: Corner, skin: readonly ShapeBox[]): boolean {
  const NEAR = 0.003;
  return skin.some((b) => {
    const d = [0, 1, 2].map((a) => Math.abs(p[a]! - b.at[a]!) - b.half[a]!);
    return d.every((v) => v <= NEAR) && d.some((v) => Math.abs(v) <= NEAR);
  });
}

function chunkFaces(chunk: Chunk, color: number, under: number, skin: readonly ShapeBox[]): Face[] {
  const hull = hullOf({ corners: chunk.corners });
  if (typeof hull === "string") throw new Error(`a chunk is no solid: ${hull}`);
  return hull.rings.map((ring): Face => {
    const points = ring.map((i) => chunk.corners[i]!);
    const normal = unit(crossed(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!)));
    const mid: Corner = [0, 1, 2].map((a) => points.reduce((s, p) => s + p[a]!, 0) / points.length) as unknown as Corner;
    const own = chunk.color ?? (normal[1] < -0.7 ? under : color);
    return { ring: points, normal, color: chunk.bare && !onSkin(mid, skin) ? CORE : own, dim: chunk.bare && !onSkin(mid, skin) ? 0.8 : 1 };
  });
}

function facesOf(d: Drawn): Face[] {
  const [color, under] = d.finish;
  const faces = [...d.look.boxes.flatMap((b) => boxFaces(b, color, under)), ...d.look.chunks.flatMap((c) => chunkFaces(c, color, under, d.skin))];
  const s = d.shift;
  return s ? faces.map((f) => ({ ...f, ring: f.ring.map((p): Corner => [p[0] + s[0], p[1] + s[1], p[2] + s[2]]) })) : faces;
}

class Picture {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  private readonly depth: Float32Array;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.rgba = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height).fill(-Infinity);
    for (let i = 0; i < width * height; i++) this.rgba.set([BACK[0], BACK[1], BACK[2], 255], i * 4);
  }
  dot(x: number, y: number, z: number, r: number, g: number, b: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    if (z < this.depth[i]!) return;
    this.depth[i] = z;
    this.rgba[i * 4] = r; this.rgba[i * 4 + 1] = g; this.rgba[i * 4 + 2] = b;
  }
  triangle(a: Corner, b: Corner, c: Corner, r: number, g: number, bl: number): void {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(this.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(this.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const whole = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(whole) < 1e-9) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const wa = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / whole;
      const wb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / whole;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      this.dot(x, y, wa * a[2] + wb * b[2] + wc * c[2], r, g, bl);
    }
  }
  line(a: Corner, b: Corner, r: number, g: number, bl: number): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.dot(Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), a[2] + (b[2] - a[2]) * t + 0.02, r, g, bl);
    }
  }
  text(words: string, x: number, y: number, size: number, ink: readonly [number, number, number] = INK): void {
    for (let k = 0; k < words.length; k++) for (let col = 0; col < GLYPH_WIDTH; col++) for (let row = 0; row < GLYPH_HEIGHT; row++) {
      if (!glyphPixel(words.charCodeAt(k), col, row)) continue;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.dot(x + (k * (GLYPH_WIDTH + 1) + col) * size + dx, y + row * size + dy, Infinity, ink[0], ink[1], ink[2]);
    }
  }
}

/** Draws the rows one under another, each row's tiles at one scale. Returns the picture at its final size. */
export function drawSheet(rows: readonly Row[]): { width: number; height: number; rgba: Uint8ClampedArray } {
  const columns = Math.max(...rows.map((r) => r.tiles.length));
  const W = columns * TILE_W * SCALE, H = rows.length * (TILE_H + HEAD) * SCALE;
  const pic = new Picture(W, H);
  const light = unit([0.35, 0.8, 0.5]);
  rows.forEach((row, at) => {
    const [round, up] = row.eye ?? [28, 24];
    const a = (round * Math.PI) / 180, e = (up * Math.PI) / 180;
    const seen = (p: Corner): Corner => {
      const x = p[0] * Math.cos(a) - p[2] * Math.sin(a), z = p[0] * Math.sin(a) + p[2] * Math.cos(a);
      return [x, p[1] * Math.cos(e) - z * Math.sin(e), p[1] * Math.sin(e) + z * Math.cos(e)];
    };
    const tiles = row.tiles.map((t) => t.things.flatMap(facesOf));
    // One scale for the row, from its largest tile.
    let span = 1e-6;
    const boxes = tiles.map((faces) => {
      const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (const f of faces) for (const p of f.ring) { const s = seen(p); lo[0] = Math.min(lo[0]!, s[0]); hi[0] = Math.max(hi[0]!, s[0]); lo[1] = Math.min(lo[1]!, s[1]); hi[1] = Math.max(hi[1]!, s[1]); }
      if (faces.length > 0) span = Math.max(span, (hi[0]! - lo[0]!) / (TILE_W - 40), (hi[1]! - lo[1]!) / (TILE_H - 50));
      return { lo, hi };
    });
    const top = at * (TILE_H + HEAD) * SCALE;
    pic.text(row.title, 12 * SCALE, top + 8 * SCALE, 2 * SCALE);
    row.tiles.forEach((tile, k) => {
      const left = k * TILE_W * SCALE, under = top + HEAD * SCALE;
      const { lo, hi } = boxes[k]!;
      const mx = (lo[0]! + hi[0]!) / 2, my = (lo[1]! + hi[1]!) / 2;
      const put = (p: Corner): Corner => { const s = seen(p); return [left + (TILE_W / 2 + (s[0] - mx) / span) * SCALE, under + (TILE_H / 2 + 10 - (s[1] - my) / span) * SCALE, s[2]]; };
      for (const f of tiles[k]!) {
        const shade = (f.dim ?? 1) * (0.5 + 0.5 * Math.max(0, f.normal[0] * light[0] + f.normal[1] * light[1] + f.normal[2] * light[2]));
        const r = PALETTE[f.color * 4]! * shade, g = PALETTE[f.color * 4 + 1]! * shade, b = PALETTE[f.color * 4 + 2]! * shade;
        const ring = f.ring.map(put);
        for (let i = 1; i + 1 < ring.length; i++) pic.triangle(ring[0]!, ring[i]!, ring[i + 1]!, r, g, b);
        for (let i = 0; i < ring.length; i++) pic.line(ring[i]!, ring[(i + 1) % ring.length]!, r * 0.45, g * 0.45, b * 0.45);
      }
      pic.text(tile.title, left + 10 * SCALE, under + 4 * SCALE, SCALE);
      if (tile.note) pic.text(tile.note, left + 10 * SCALE, under + 16 * SCALE, SCALE, [110, 104, 96]);
    });
  });
  // Halved, each pixel the mean of four.
  const w = W / SCALE, h = H / SCALE, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let sum = 0;
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) sum += pic.rgba[((y * SCALE + dy) * W + x * SCALE + dx) * 4 + c]!;
    out[(y * w + x) * 4 + c] = sum / (SCALE * SCALE);
  }
  return { width: w, height: h, rgba: out };
}
