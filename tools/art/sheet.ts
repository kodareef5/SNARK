// Draws an asset's review sheet with the software rasterizer: the model from eight sides at every level of detail,
// its wireframe, the bone each part follows, its hit capsules and sockets, and every clip at six frames. The sheet is
// one picture and also the pages it is made of, each small enough to be read at full size.

import { ZONE_NAMES } from "../../shared/anim/human.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import { ModelView, type ModelShot } from "../snap.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../snap/font.ts";
import type { Asset } from "./assets.ts";
import { Poser, type Report } from "./check.ts";

type Rgb = readonly [number, number, number];

/** A page is this wide. A reader that shrinks large pictures still shows it whole. */
const WIDTH = 1560;
const PAD = 12;
const GAP = 6;
/** Each picture is drawn this many times larger and shrunk, which smooths its edges. */
const SMOOTH = 2;
/** Clips on one page. */
const CLIPS_A_PAGE = 7;
const PAPER: Rgb = [242, 243, 245];
const INK: Rgb = [28, 32, 38];
const FAINT: Rgb = [110, 116, 126];
const GOOD: Rgb = [24, 120, 60];
const BAD: Rgb = [196, 36, 36];
const BACK: Rgb = [206, 212, 222];
const GRID: Rgb = [176, 184, 198];
const WIRE: Rgb = [30, 50, 90];
const WHITE = 10;
/** A line drawn over a surface shows if it is no further behind it than this, in the rasterizer's depth. */
const BIAS = 0.012;
/** One colour a zone, by zone id. */
const ZONE_COLOURS: readonly Rgb[] = [INK, [214, 40, 40], [226, 150, 20], [40, 110, 220], [20, 170, 200], [120, 80, 220], [170, 110, 230], [30, 150, 70], [120, 180, 40], [150, 100, 50], [190, 140, 90]];

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.fill(0, 0, width, height, PAPER);
  }

  fill(x: number, y: number, w: number, h: number, rgb: Rgb): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) this.pixels.set([rgb[0], rgb[1], rgb[2], 255], (py * this.width + px) * 4);
    }
  }

  /** Returns the x just past the text. */
  text(s: string, x: number, y: number, rgb: Rgb = INK, scale = 2): number {
    for (const ch of s) {
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        for (let row = 0; row < GLYPH_HEIGHT; row++) if (glyphPixel(ch.charCodeAt(0), col, row)) this.fill(x + col * scale, y + row * scale, scale, scale, rgb);
      }
      x += (GLYPH_WIDTH + 1) * scale;
    }
    return x;
  }

  /** Puts a picture `times` larger than it is to be at (x, y), each pixel the mean of the block it stands for. */
  shrink(src: Uint8ClampedArray, sw: number, sh: number, times: number, x: number, y: number): void {
    for (let py = 0; py < sh / times; py++) {
      for (let px = 0; px < sw / times; px++) {
        const o = ((y + py) * this.width + x + px) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = 0; dy < times; dy++) for (let dx = 0; dx < times; dx++) sum += src[((py * times + dy) * sw + px * times + dx) * 4 + c]!;
          this.pixels[o + c] = sum / (times * times);
        }
      }
    }
  }

  /** Puts a picture `times` smaller than it is to be at (x, y), each pixel a square. */
  enlarge(src: Uint8ClampedArray, sw: number, sh: number, times: number, x: number, y: number): void {
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) this.fill(x + px * times, y + py * times, times, times, [src[(py * sw + px) * 4]!, src[(py * sw + px) * 4 + 1]!, src[(py * sw + px) * 4 + 2]!]);
    }
  }

  put(src: Canvas, x: number, y: number): void {
    for (let row = 0; row < src.height; row++) this.pixels.set(src.pixels.subarray(row * src.width * 4, (row + 1) * src.width * 4), ((y + row) * this.width + x) * 4);
  }
}

/** A picture on a page, and what it shows. */
export interface SheetCell {
  page: string;
  what: "shaded" | "as seen" | "wireframe" | "bones" | "capsules" | "clip";
  mesh: string;
  x: number;
  y: number;
  width: number;
  height: number;
  level?: number;
  /** Degrees around from its front toward its left, and above. */
  around?: number;
  above?: number;
  clip?: string;
  frame?: number;
}

export interface Sheet {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** The same sheet cut where its parts begin. `y` is where the page starts on the whole sheet. */
  pages: { name: string; y: number; width: number; height: number; pixels: Uint8ClampedArray }[];
  /** Positions are on the page. */
  cells: SheetCell[];
}

/** A page being laid out: rows are added downward. */
class Page {
  readonly name: string;
  readonly rows: { height: number; draw: (canvas: Canvas, y: number) => void }[] = [];

  constructor(name: string) {
    this.name = name;
  }

  row(height: number, draw: (canvas: Canvas, y: number) => void): void {
    this.rows.push({ height, draw });
  }

  /** Text across the page, broken at spaces where it is too long for one line. */
  line(text: string, rgb: Rgb = INK, scale = 2): void {
    const fits = Math.floor((WIDTH - PAD * 2) / ((GLYPH_WIDTH + 1) * scale));
    let rest = text;
    while (rest.length > 0) {
      const cut = rest.length <= fits ? rest.length : Math.max(1, rest.lastIndexOf(" ", fits));
      const part = rest.slice(0, cut);
      this.row(GLYPH_HEIGHT * scale + 6, (c, y) => void c.text(part, PAD, y + 2, rgb, scale));
      rest = rest.slice(cut).trimStart();
    }
  }

  render(): Canvas {
    const canvas = new Canvas(WIDTH, this.rows.reduce((h, r) => h + r.height, PAD * 2));
    let y = PAD;
    for (const r of this.rows) {
      r.draw(canvas, y);
      y += r.height;
    }
    return canvas;
  }
}

/** Draws over the picture a view has just made. Positions are the model's, in metres. */
class Overlay {
  private readonly view: ModelView;
  private readonly a = [0, 0, 0];
  private readonly b = [0, 0, 0];

  constructor(view: ModelView) {
    this.view = view;
  }

  private dot(x: number, y: number, z: number, rgb: Rgb, through: boolean, size: number): void {
    const r = this.view.raster;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const px = Math.round(x) + dx - (size >> 1);
        const py = Math.round(y) + dy - (size >> 1);
        if (px < 0 || py < 0 || px >= r.width || py >= r.height) continue;
        const at = py * r.width + px;
        if (!through && z > r.depth[at]! + BIAS) continue;
        r.color.set(rgb, at * 4);
      }
    }
  }

  /** Between two places in the picture, each x, y and depth. */
  private stroke(a: readonly number[], b: readonly number[], rgb: Rgb, through: boolean, size: number): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0]! - a[0]!), Math.abs(b[1]! - a[1]!))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.dot(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t, rgb, through, size);
    }
  }

  /** A line between two points. `through` draws it even where the model is in front. */
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, rgb: Rgb, through = false, size = SMOOTH): void {
    if (this.view.project(ax, ay, az, this.a) && this.view.project(bx, by, bz, this.b)) this.stroke(this.a, this.b, rgb, through, size);
  }

  /** Where a point is in the picture, in pixels of the shrunk picture. Null behind the camera. */
  at(x: number, y: number, z: number): [number, number] | null {
    return this.view.project(x, y, z, this.a) ? [this.a[0]! / SMOOTH, this.a[1]! / SMOOTH] : null;
  }

  /** A cross at a point, over everything. */
  cross(x: number, y: number, z: number, rgb: Rgb): void {
    if (!this.view.project(x, y, z, this.a)) return;
    const [px, py] = this.a as [number, number];
    const arm = 5 * SMOOTH;
    this.stroke([px - arm, py - arm, 0], [px + arm, py + arm, 0], rgb, true, SMOOTH + 1);
    this.stroke([px - arm, py + arm, 0], [px + arm, py - arm, 0], rgb, true, SMOOTH + 1);
  }

  /** The outline of a capsule as the camera sees it, over everything. */
  capsule(a: readonly number[], b: readonly number[], radius: number, rgb: Rgb): void {
    const cam = this.view.cam;
    // A metre straight up in the camera's own frame, to find how many pixels a metre is at the capsule.
    const up = [-Math.sin(cam.yaw) * Math.sin(cam.pitch), Math.cos(cam.pitch), -Math.cos(cam.yaw) * Math.sin(cam.pitch)];
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    const r = [0, 0, 0];
    if (!this.view.project(a[0]!, a[1]!, a[2]!, p) || !this.view.project(b[0]!, b[1]!, b[2]!, q) || !this.view.project(a[0]! + up[0]!, a[1]! + up[1]!, a[2]! + up[2]!, r)) return;
    const wide = Math.hypot(r[0]! - p[0]!, r[1]! - p[1]!) * radius;
    const turn = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) < 0.5 ? 0 : Math.atan2(q[1]! - p[1]!, q[0]! - p[0]!);
    const ring: number[][] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) ring.push([q[0]! + Math.cos(turn - Math.PI / 2 + (Math.PI * i) / steps) * wide, q[1]! + Math.sin(turn - Math.PI / 2 + (Math.PI * i) / steps) * wide, 0]);
    for (let i = 0; i <= steps; i++) ring.push([p[0]! + Math.cos(turn + Math.PI / 2 + (Math.PI * i) / steps) * wide, p[1]! + Math.sin(turn + Math.PI / 2 + (Math.PI * i) / steps) * wide, 0]);
    for (let i = 0; i < ring.length; i++) this.stroke(ring[i]!, ring[(i + 1) % ring.length]!, rgb, true, SMOOTH + 1);
  }

  /** Lines on the ground at height `y` under the ball the picture holds, `step` metres apart. */
  ground(centre: readonly number[], radius: number, step: number, y: number): void {
    const [x0, x1] = [Math.floor((centre[0]! - radius) / step) * step, Math.ceil((centre[0]! + radius) / step) * step];
    const [z0, z1] = [Math.floor((centre[2]! - radius) / step) * step, Math.ceil((centre[2]! + radius) / step) * step];
    for (let x = x0; x <= x1 + 1e-6; x += step) this.line(x, y, z0, x, y, z1, GRID);
    for (let z = z0; z <= z1 + 1e-6; z += step) this.line(x0, y, z, x1, y, z, GRID);
  }
}

/** A distance between ground lines that puts a few of them under a ball of this radius. */
function gridStep(radius: number): number {
  for (const step of [0.1, 0.25, 0.5, 1, 2, 5, 10]) if (radius / step <= 4) return step;
  return 20;
}

/** The edges of a level, each once, as pairs of vertex indices. */
function edgesOf(lod: SourceLod): number[] {
  const p = lod.positions;
  const ids = new Map<string, number>();
  const first: number[] = [];
  const point = Array.from({ length: p.length / 3 }, (_, v) => {
    const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      first.push(v);
    }
    return id;
  });
  const seen = new Set<number>();
  const out: number[] = [];
  for (let t = 0; t + 2 < lod.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const [u, v] = [point[lod.indices[t + k]!]!, point[lod.indices[t + ((k + 1) % 3)]!]!];
      const key = u < v ? u * ids.size + v : v * ids.size + u;
      if (u === v || seen.has(key)) continue;
      seen.add(key);
      out.push(first[u]!, first[v]!);
    }
  }
  return out;
}

/** A colour for each bone, far from its neighbours' in the list. */
function boneColours(bones: number): Rgb[] {
  return Array.from({ length: bones }, (_, b) => {
    const hue = (b * 0.61803) % 1;
    const light = [0.5, 0.68, 0.36][b % 3]!;
    const sat = [0.85, 0.7, 0.9][(b >> 1) % 3]!;
    const a = sat * Math.min(light, 1 - light);
    const f = (n: number): number => {
      const k = (n + hue * 12) % 12;
      return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  });
}

/** Everything the pictures of one mesh are drawn from. */
interface Subject {
  pack: Pack;
  id: string;
  mesh: SourceMesh;
  index: number;
  rig: Rig | null;
  poser: Poser | null;
  colours: readonly number[];
  /** The middle of the mesh's bounds, half their size, and the ball that holds it from any of the eight sides. */
  centre: [number, number, number];
  half: [number, number, number];
  radius: number;
  /** The height the ground is drawn at: 0 under a creature, which stands on its origin, and the underside of a piece, which is centred on its own. */
  floor: number;
  views: Map<string, ModelView>;
  cells: SheetCell[];
}

function viewOf(s: Subject, width: number, height: number, smooth = SMOOTH): ModelView {
  const key = `${width}x${height}x${smooth}`;
  let view = s.views.get(key);
  if (!view) s.views.set(key, (view = new ModelView(s.pack, width * smooth, height * smooth, [BACK[0] / 255, BACK[1] / 255, BACK[2] / 255])));
  return view;
}

type Shot = Pick<ModelShot, "level" | "around" | "above"> & Partial<Pick<ModelShot, "colors" | "centre" | "radius">>;

/** A picture's width over its height. Every row of pictures is cut to it, near enough. */
const SHAPE = 4 / 3;
/** Room left around what a picture holds: the near side of a body is drawn a little larger than its middle. */
const ROOM = 1.18;

/** The radius that fits a box of half extents `half` into a picture taken from `around` and `above`, in degrees. */
function fit(half: readonly number[], around: number, above: number): number {
  const [a, e] = [(around * Math.PI) / 180, (above * Math.PI) / 180];
  // How far the box reaches along the camera's right and up.
  const right = Math.abs(Math.cos(a)) * half[0]! + Math.abs(Math.sin(a)) * half[2]!;
  const up = Math.abs(Math.sin(a) * Math.sin(e)) * half[0]! + Math.abs(Math.cos(e)) * half[1]! + Math.abs(Math.cos(a) * Math.sin(e)) * half[2]!;
  return Math.max(up, right / SHAPE) * ROOM;
}

/** Draws the subject into a view and returns the view, with what is to be drawn over it. */
function shoot(s: Subject, view: ModelView, shot: Shot): Overlay {
  view.draw({ mesh: s.index, rig: s.rig, colors: s.colours, centre: s.centre, radius: s.radius, ...shot });
  return new Overlay(view);
}

/** A row of pictures across a page, each `height` tall, drawn by `each`. One that `each` returns false for is a legend and no picture. */
function strip(page: Page, s: Subject, count: number, height: number, each: (i: number, view: ModelView, cell: SheetCell, canvas: Canvas, x: number, y: number) => void | false, base: Omit<SheetCell, "x" | "y" | "width" | "height" | "page">): void {
  const width = Math.floor((WIDTH - PAD * 2 - GAP * (count - 1)) / count);
  page.row(height + GAP, (canvas, y) => {
    for (let i = 0; i < count; i++) {
      const x = PAD + i * (width + GAP);
      const cell: SheetCell = { ...base, page: page.name, x, y, width, height };
      if (each(i, viewOf(s, width, height), cell, canvas, x, y) !== false) s.cells.push(cell);
    }
  });
}

const AROUND = [0, 45, 90, 135, 180, 225, 270, 315];
/** Degrees above the model's middle that the eight are taken from. */
const ABOVE = 12;
const SIDES = ["front", "front left", "left", "back left", "back", "back right", "right", "front right"];

/** The model from eight sides at one level. `across` is how many pictures to a row. */
function around(page: Page, s: Subject, level: number, across: number, height: number, ground: boolean): void {
  for (let from = 0; from < AROUND.length; from += across) {
    strip(page, s, across, height, (i, view, cell, canvas, x, y) => {
      const over = shoot(s, view, { level, around: AROUND[from + i]!, above: ABOVE });
      if (ground) over.ground(s.centre, s.radius, gridStep(s.radius), s.floor);
      canvas.shrink(view.raster.color, view.raster.width, view.raster.height, SMOOTH, x, y);
      if (height >= 200) canvas.text(SIDES[from + i]!, x + 6, y + 6, FAINT);
      Object.assign(cell, { level, around: AROUND[from + i]!, above: ABOVE });
    }, { what: "shaded", mesh: s.id });
  }
}

function wireframe(page: Page, s: Subject, height: number): void {
  const lod = s.mesh.lods[0]!;
  const edges = edgesOf(lod);
  const shots: [string, number, number][] = [["right side", 270, 0], ["front left", 45, 15], ["top", 270, 89], ["back right", 225, 15]];
  strip(page, s, shots.length, height, (i, view, cell, canvas, x, y) => {
    const [name, a, e] = shots[i]!;
    const over = shoot(s, view, { level: 0, around: a, above: e, radius: fit(s.half, a, e), colors: [WHITE, WHITE, WHITE, WHITE, WHITE, WHITE] });
    const p = lod.positions;
    for (let k = 0; k < edges.length; k += 2) {
      const [u, v] = [edges[k]! * 3, edges[k + 1]! * 3];
      over.line(p[u]!, p[u + 1]!, p[u + 2]!, p[v]!, p[v + 1]!, p[v + 2]!, WIRE);
    }
    canvas.shrink(view.raster.color, view.raster.width, view.raster.height, SMOOTH, x, y);
    canvas.text(name, x + 6, y + 6, FAINT);
    Object.assign(cell, { level: 0, around: a, above: e });
  }, { what: "wireframe", mesh: s.id });
}

/** A list in columns inside a picture's place: a swatch and a name each. */
function legend(canvas: Canvas, x: number, y: number, width: number, height: number, title: string, entries: readonly (readonly [Rgb | null, string])[]): void {
  canvas.fill(x, y, width, height, [250, 250, 251]);
  canvas.text(title, x + 8, y + 8, INK);
  // Small letters where large ones would need more than two columns.
  const scale = entries.length > 2 * Math.floor((height - 34) / (GLYPH_HEIGHT * 2 + 2)) ? 1 : 2;
  const line = GLYPH_HEIGHT * scale + 2;
  const rows = Math.floor((height - 34) / line);
  const columns = Math.max(1, Math.ceil(entries.length / rows));
  const wide = Math.floor((width - 16) / columns);
  const mark = 5 * scale + 2;
  const fits = Math.floor((wide - mark - 8) / ((GLYPH_WIDTH + 1) * scale));
  entries.forEach(([rgb, name], i) => {
    const [cx, cy] = [x + 8 + Math.floor(i / rows) * wide, y + 30 + (i % rows) * line];
    if (rgb) canvas.fill(cx, cy, mark, GLYPH_HEIGHT * scale, rgb);
    canvas.text(name.length > fits ? name.slice(0, Math.max(1, fits - 1)) + "~" : name, cx + (rgb ? mark + 4 : 0), cy, INK, scale);
  });
}

function bones(page: Page, s: Subject, height: number): void {
  const rig = s.rig!;
  const colours = boneColours(rig.bones);
  const shots: [string, number, number][] = [["right side", 270, 0], ["front left", 45, 15], ["top", 270, 89]];
  strip(page, s, 4, height, (i, view, cell, canvas, x, y) => {
    if (i === 3) {
      legend(canvas, x, y, cell.width, height, "the bone each part follows", rig.names.map((name, b) => [colours[b]!, name] as const));
      return false;
    }
    const [name, a, e] = shots[i]!;
    const over = shoot(s, view, { level: 0, around: a, above: e, radius: fit(s.half, a, e), colors: [WHITE, WHITE, WHITE, WHITE, WHITE, WHITE] });
    const r = view.raster;
    const white = s.pack.palette[WHITE * 4]!;
    for (let at = 0; at < r.width * r.height; at++) {
      const b = r.pickBone[at]!;
      if (b === 0) continue;
      const lit = r.color[at * 4]! / white;
      const c = colours[b - 1] ?? INK;
      r.color.set([c[0] * lit, c[1] * lit, c[2] * lit], at * 4);
    }
    // The skeleton, over the body.
    const rest = rig.rest;
    for (let b = 1; b < rig.bones; b++) {
      const q = rig.parent[b]!;
      over.line(rest[b * 3]!, rest[b * 3 + 1]!, rest[b * 3 + 2]!, rest[q * 3]!, rest[q * 3 + 1]!, rest[q * 3 + 2]!, INK, true);
    }
    canvas.shrink(r.color, r.width, r.height, SMOOTH, x, y);
    for (let b = 0; b < rig.bones; b++) {
      const at = over.at(rest[b * 3]!, rest[b * 3 + 1]!, rest[b * 3 + 2]!);
      if (at) canvas.fill(Math.round(x + at[0]) - 2, Math.round(y + at[1]) - 2, 4, 4, [255, 255, 255]);
    }
    canvas.text(name, x + 6, y + 6, FAINT);
    Object.assign(cell, { level: 0, around: a, above: e });
  }, { what: "bones", mesh: s.id });
}

function capsules(page: Page, s: Subject, height: number): void {
  const rig = s.rig!;
  const grey = [15, 15, 15, 15, 15, 15];
  const shots: [string, number, number][] = [["right side", 270, 0], ["front", 0, 0], ["top", 270, 89]];
  const zones = [...new Set(Array.from(rig.zone).filter((z) => z !== 0))].sort((a, b) => a - b);
  strip(page, s, 4, height, (i, view, cell, canvas, x, y) => {
    if (i === 3) {
      const entries: (readonly [Rgb | null, string])[] = zones.map((z) => [ZONE_COLOURS[z] ?? INK, `${ZONE_NAMES[z]} (${Array.from(rig.zone).filter((v) => v === z).length})`] as const);
      for (const [name, socket] of rig.sockets) entries.push([null, `x ${name} on ${rig.names[socket.bone]}`]);
      legend(canvas, x, y, cell.width, height, "hit capsules and sockets", entries);
      return false;
    }
    const [name, a, e] = shots[i]!;
    // Capsules reach past the mesh they are fitted to.
    const over = shoot(s, view, { level: 0, around: a, above: e, radius: fit(s.half, a, e) * 1.2, colors: grey });
    const rest = rig.rest;
    for (let b = 0; b < rig.bones; b++) {
      if (rig.zone[b] === 0) continue;
      const end = (cap: Float32Array): number[] => [0, 1, 2].map((k) => rest[b * 3 + k]! + cap[b * 3 + k]!);
      over.capsule(end(rig.capA), end(rig.capB), rig.capR[b]!, ZONE_COLOURS[rig.zone[b]!] ?? INK);
    }
    const labels: [number, number, string][] = [];
    for (const [socket, at] of rig.sockets) {
      const p = [rest[at.bone * 3]! + at.x, rest[at.bone * 3 + 1]! + at.y, rest[at.bone * 3 + 2]! + at.z] as const;
      over.cross(p[0], p[1], p[2], INK);
      const where = over.at(p[0], p[1], p[2]);
      if (where) labels.push([where[0], where[1], socket]);
    }
    canvas.shrink(view.raster.color, view.raster.width, view.raster.height, SMOOTH, x, y);
    for (const [lx, ly, text] of labels) {
      const wide = text.length * (GLYPH_WIDTH + 1) * 2;
      canvas.text(text, Math.min(Math.round(x + lx) + 8, x + cell.width - wide - 4), Math.max(y + 22, Math.round(y + ly) - 18), INK);
    }
    canvas.text(name, x + 6, y + 6, FAINT);
    Object.assign(cell, { level: 0, around: a, above: e });
  }, { what: "capsules", mesh: s.id });
}

/** Clips are seen from the right and a little ahead, so the body faces right and both legs show. */
const CLIP_AROUND = 290;
const CLIP_ABOVE = 10;

/** Each coarser level at the size it is first drawn, and the same enlarged. */
function asSeen(page: Page, s: Subject, report: Report): void {
  const facts = report.meshes.find((m) => m.id === s.id)!;
  const coarse = facts.levels.map((l, i) => ({ l, i })).filter(({ l, i }) => i > 0 && l.tall >= 1);
  if (coarse.length === 0) return;
  const times = 3;
  const box = 90;
  const across = 4;
  const wide = Math.floor((WIDTH - PAD * 2) / across);
  page.line(`each coarser level at the size it is first drawn on medium, and the same ${times} times larger`);
  for (let from = 0; from < coarse.length; from += across) {
    page.row(box * times + GAP + 22, (canvas, y) => {
      coarse.slice(from, from + across).forEach(({ l, i }, n) => {
        const x = PAD + n * wide;
        const view = viewOf(s, box, box);
        // The ball that makes the mesh stand `tall` pixels in a picture `box` pixels high.
        shoot(s, view, { level: i, around: CLIP_AROUND, above: CLIP_ABOVE, radius: ((box / 2) * Math.cos(view.cam.fovY / 2) * facts.size[1]) / l.tall });
        const small = new Canvas(box, box);
        small.shrink(view.raster.color, view.raster.width, view.raster.height, SMOOTH, 0, 0);
        canvas.put(small, x, y + 22);
        canvas.enlarge(small.pixels, box, box, times, x + box + GAP, y + 22);
        canvas.text(`level ${i}: ${l.tall.toFixed(0)} px tall, from ${l.from.toFixed(0)} m`, x, y + 2, INK);
        s.cells.push({ page: page.name, what: "as seen", mesh: s.id, x, y: y + 22, width: box, height: box, level: i, around: CLIP_AROUND, above: CLIP_ABOVE });
      });
    });
  }
}

function clipRows(page: Page, s: Subject, report: Report, names: readonly string[]): void {
  const poser = s.poser!;
  const lod = s.mesh.lods[0]!;
  const frames = 6;
  for (const name of names) {
    const clip = s.pack.clips.clips[s.pack.clips.index.get(`${s.id}/${name}`) ?? -1];
    const facts = report.clips.find((c) => c.name === name);
    if (!clip || !facts) continue;
    const at = Array.from({ length: frames }, (_, i) => (clip.loop ? Math.round((i * clip.frames) / frames) % clip.frames : Math.round((i * (clip.frames - 1)) / (frames - 1))));
    // One camera for all six, so that what moves is seen to move: the ball holds the body in every one of them.
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const p = [0, 0, 0];
    for (const f of at) {
      poser.set(clip, f);
      for (let v = 0; v < lod.positions.length / 3; v += 3) {
        poser.skin(lod.bones![v]!, lod.positions[v * 3]!, lod.positions[v * 3 + 1]!, lod.positions[v * 3 + 2]!, p);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, p[k]!);
          max[k] = Math.max(max[k]!, p[k]!);
        }
      }
    }
    const centre = min.map((lo, k) => (lo + max[k]!) / 2) as [number, number, number];
    const radius = fit(min.map((lo, k) => (max[k]! - lo) / 2), CLIP_AROUND, CLIP_ABOVE);
    const step = gridStep(radius);
    const gait = report.gaits.find((g) => g.clip === name);
    const says = [`${name}: ${clip.frames} frames, ${facts.seconds.toFixed(2)} s`, clip.loop ? `loop, wraps in ${(facts.wrap! * 100).toFixed(1)} cm against a largest step of ${(facts.step * 100).toFixed(1)} cm` : "plays once"];
    if (gait) says.push(`stride ${gait.stride} m, feet slide ${gait.feet.map((f) => (f.slide * 100).toFixed(1)).join(" and ")} cm`);
    if (facts.still > 1) says.push(`${facts.still} frames stand still`);
    page.line(`${says.join("; ")}; ground lines ${step} m apart`);
    strip(page, s, frames, 188, (i, view, cell, canvas, x, y) => {
      poser.set(clip, at[i]!);
      const over = shoot(s, view, { level: 0, around: CLIP_AROUND, above: CLIP_ABOVE, centre, radius });
      over.ground(centre, radius, step, s.floor);
      canvas.shrink(view.raster.color, view.raster.width, view.raster.height, SMOOTH, x, y);
      canvas.text(`frame ${at[i]}`, x + 6, y + 6, FAINT);
      Object.assign(cell, { level: 0, around: CLIP_AROUND, above: CLIP_ABOVE, clip: name, frame: at[i]! });
    }, { what: "clip", mesh: s.id });
  }
  // The pictures are drawn after the pages are laid out, and those before the clips want the rig at rest.
  poser.set(null, 0);
}

function subjectOf(pack: Pack, meshes: SourceMesh[], id: string, colours: readonly number[], cells: SheetCell[]): Subject | null {
  const mesh = meshes.find((m) => m.id === id);
  const index = pack.meshIndex.get(id);
  if (!mesh || index === undefined) return null;
  const header = pack.header.meshes[index]!;
  const packRig = header.rig === undefined ? undefined : pack.header.rigs[header.rig];
  const rig = packRig ? buildRig(packRig, pack.clips) : null;
  const poser = rig ? new Poser(rig) : null;
  poser?.set(null, 0);
  const radius = Math.max(...AROUND.map((a) => fit(header.half, a, ABOVE)));
  return { pack, id, mesh, index, rig, poser, colours, centre: [...header.center], half: [...header.half], radius, floor: rig ? 0 : header.center[1] - header.half[1], views: new Map(), cells };
}

/** The heading of the first page: what the asset is, its numbers, and what is wrong with it. */
function heading(page: Page, asset: Asset, report: Report): void {
  page.line(`${asset.id}   ${asset.spec.kind}`, INK, 3);
  for (const m of report.meshes) {
    page.line(`${m.id}: ${m.size.map((v) => v.toFixed(2)).join(" x ")} m (across, up, along); triangles a level ${m.levels.map((l) => l.triangles).join(", ")}; budget ${m.levels.map((l) => l.budget ?? "-").join(", ")}`);
    page.line(`holes ${m.levels.map((l) => l.holes).join(", ")}; edges between faces that look opposite ways ${m.levels.map((l) => l.flipped).join(", ")}; parts inside out ${m.levels.map((l) => l.insideOut).join(", ")}; error cm ${m.levels.map((l) => (l.error * 100).toFixed(1)).join(", ")}`, FAINT);
  }
  if (report.rig) page.line(`rig: skeleton "${report.rig.skeleton}", ${report.rig.bones} bones, ${report.rig.capsules} hit capsules, sockets ${report.rig.sockets.join(", ") || "none"}; ${report.clips.length} clips`, FAINT);
  for (const n of report.notes) page.line(`note: ${n}`, FAINT);
  for (const f of report.faults) page.line(`FAULT: ${f}`, BAD);
  page.line(report.faults.length === 0 ? "check: ok" : `check: ${report.faults.length} ${report.faults.length === 1 ? "fault" : "faults"}`, report.faults.length === 0 ? GOOD : BAD);
}

/** Null for a kind of asset that has no sheet. */
export function drawSheet(asset: Asset, pack: Pack, report: Report): Sheet | null {
  const spec = asset.spec;
  if (spec.kind !== "creature" && spec.kind !== "pieces") return null;
  const meshes = unpackMeshes(pack);
  const cells: SheetCell[] = [];
  const pages: Page[] = [];
  const ids = spec.kind === "creature" ? [asset.id] : spec.pieces.map((p) => p.id);
  const tagOf = (id: string): string => (ids.length > 1 ? `${id.split(":")[1]}-` : "");
  const first = new Page(`${tagOf(ids[0]!)}views`);
  heading(first, asset, report);
  pages.push(first);
  ids.forEach((id, n) => {
    const s = subjectOf(pack, meshes, id, spec.kind === "creature" ? spec.regions.map((r) => r.sample) : [15], cells);
    if (!s) return;
    const tag = tagOf(id);
    const views = n === 0 ? first : new Page(`${tag}views`);
    if (n > 0) pages.push(views);
    views.line(`${id} at level 0, from eight sides. Ground lines ${gridStep(s.radius)} m apart.`);
    around(views, s, 0, 4, 284, true);
    // The views are flat. The same eight drawn with the level's materials belong here: ModelView would queue a draw
    // for each section and send the textures, as tests/fixtures/stage.ts does by hand, with mips from mipsOf.

    if (s.mesh.lods.length > 1) {
      const levels = new Page(`${tag}levels`);
      pages.push(levels);
      const facts = report.meshes.find((m) => m.id === id)!.levels;
      for (let l = 1; l < s.mesh.lods.length; l++) {
        levels.line(`level ${l}: ${facts[l]!.triangles} triangles, ${(facts[l]!.error * 100).toFixed(1)} cm from the finest, drawn from ${facts[l]!.from.toFixed(0)} m off`);
        around(levels, s, l, 8, 140, false);
      }
      asSeen(levels, s, report);
    }

    const rig = new Page(`${tag}${s.rig ? "rig" : "wireframe"}`);
    pages.push(rig);
    rig.line(`${id}: wireframe of level 0`);
    wireframe(rig, s, 284);
    if (s.rig && spec.kind === "creature") {
      rig.line("the bone each part follows, with the skeleton over it");
      bones(rig, s, 284);
      rig.line("hit capsules and sockets, at rest");
      capsules(rig, s, 284);
      for (let from = 0; from < spec.clips.length; from += CLIPS_A_PAGE) {
        const page = new Page(`clips-${1 + from / CLIPS_A_PAGE}`);
        pages.push(page);
        clipRows(page, s, report, spec.clips.slice(from, from + CLIPS_A_PAGE).map((c) => c.name));
      }
    }
  });

  const drawn = pages.map((p) => ({ name: p.name, canvas: p.render() }));
  const whole = new Canvas(WIDTH, drawn.reduce((h, p) => h + p.canvas.height, 0));
  let y = 0;
  const out: Sheet["pages"] = [];
  for (const p of drawn) {
    whole.put(p.canvas, 0, y);
    out.push({ name: p.name, y, width: WIDTH, height: p.canvas.height, pixels: p.canvas.pixels });
    y += p.canvas.height;
  }
  return { width: whole.width, height: whole.height, pixels: whole.pixels, pages: out, cells };
}
