// Draws the inventory pictures with the software rasterizer, headless: every item whose `#dropped` slot, else its
// `#held` slot, names a mesh of the pack gets one, lit and textured as tools/snap.ts's ModelView draws a model, on a
// transparent ground. Each is drawn at SUPER times its size and shrunk, its coverage taken from the rasterizer's pick
// buffer. The pictures are laid out in PNG sheets (shared/pack/icons.ts) that a build lists in its manifest. A picture is
// kept under .cache/icons by everything it is drawn from, so a build draws only what changed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync, inflateRawSync } from "node:zlib";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ItemDef, SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { slotsOf } from "../../shared/content/slots.ts";
import { ICONS_A_SHEET, ICON_SIZE, SHEET_COLUMNS, iconAt, sheetShapes, type ManifestIcons } from "../../shared/pack/icons.ts";
import { storedStep, type Manifest } from "../../shared/pack/manifest.ts";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, lodVertices, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";
import { MAP_ROLES, pictureBytes, stepBytes, stepOf, topIn } from "../../shared/pack/texture.ts";
import { findAssets } from "../art/assets.ts";
import { ModelView } from "../snap.ts";
import type { RgbaTexture } from "../snap/files.ts";
import { PICK_SKY } from "../snap/raster.ts";
import type { SplitFile } from "./split.ts";

/** Each picture is drawn this many times wider and taller, and shrunk. */
export const SUPER = 4;
/** Where a build keeps the pictures it has drawn. */
export const ICON_CACHE = resolve(import.meta.dir, "../../.cache/icons");
/** The share of a picture's side left clear on each side of what it holds. */
const MARGIN = 0.06;
/** A mesh this many times longer along its longest axis than across is turned to lie along the picture's diagonal. */
const LONG = 1.35;
/** The field of view ModelView draws with. */
const FOV = 0.2;
/** The code a picture is drawn by. A change to any of it draws every picture again. */
const DRAWN_BY = ["icons.ts", "../snap/raster.ts", "../snap.ts"];

/**
 * The view a picture is drawn from: degrees round from the mesh's front (+Z) toward its left and above it, as
 * ModelView takes them, degrees the picture is turned anticlockwise, how many times nearer than the framing that
 * fits it, and where the middle of the picture moves to, right and up in the turned picture, as shares of the half side
 * of the framing that fits it: with a zoom, the part of a long thing to show. `PieceSpec.icon` (tools/art/spec.ts) gives
 * one in radians; `framingOf` turns it into this.
 */
export interface IconFraming {
  around: number;
  above: number;
  roll?: number;
  zoom?: number;
  shift?: readonly [number, number];
}

/** What a piece's asset says of its picture, in radians, as tools/art/spec.ts has it. */
export function framingOf(icon: { around: number; above: number; roll?: number; zoom?: number; shift?: readonly [number, number] }): IconFraming {
  const deg = 180 / Math.PI;
  return { around: icon.around * deg, above: icon.above * deg, ...(icon.roll !== undefined ? { roll: icon.roll * deg } : {}), ...(icon.zoom !== undefined ? { zoom: icon.zoom } : {}), ...(icon.shift !== undefined ? { shift: icon.shift } : {}) };
}

/** An item that has a picture: the id its `#icon` slot names, and the mesh it is drawn from. */
export interface IconSubject {
  icon: string;
  owner: string;
  mesh: string;
  /** Palette index of each colour region. */
  colors: number[];
}

/**
 * The items of `defs` that get a picture, in content order: each whose own `#dropped` mesh is in the pack, else whose
 * own `#held` mesh is. A slot's stand-in (the bag a dropped stack is drawn as) does not count. An item that is set down
 * as a structure and has neither is drawn as it will stand: from its own `#preview` mesh, else from the mesh of the
 * first structure it places (that slot's stand-in, `#mesh`), in that structure's colour (stations-plan.md, S5).
 */
export function iconSubjects(defs: readonly (Def | null)[], has: (mesh: string) => boolean): IconSubject[] {
  const items = defs.filter((d): d is ItemDef => d !== null && d.type === "item");
  const structures = new Map(defs.filter((d): d is Def => d !== null && d.type === "structure").map((d) => [d.id, d]));
  const vehicles = new Map(defs.filter((d): d is SpeciesDef => d !== null && d.type === "species" && d.class === "vehicle").map(d => [d.id, d]));
  const uses = slotsOf([...items, ...structures.values(), ...vehicles.values()]);
  const own = (owner: string, slot: string): string => uses.find((u) => u.owner === owner && u.slot === slot && u.id !== "" && has(u.id))?.id ?? "";
  const colour = (d: Def): number => (d as { color?: number }).color ?? 15;
  const out: IconSubject[] = [];
  for (const d of items) {
    const icon = uses.find((u) => u.owner === d.id && u.slot === "icon")?.id ?? "";
    let [mesh, colors] = [own(d.id, "dropped") || own(d.id, "held"), colour(d)];
    const placed = mesh === "" && d.class === "structure" ? structures.get(d.places?.[0] ?? "") : undefined;
    if (placed) [mesh, colors] = [own(d.id, "preview") || own(placed.id, "mesh"), colour(placed)];
    // An assembly shows the vehicle it will deploy, using the same authored preview/body slots as placement.
    const deployed = mesh === "" && d.class === "vehicle" ? vehicles.get(d.deploys ?? "") : undefined;
    if (deployed) mesh = own(d.id, "preview") || own(deployed.id, "body");
    if (icon === "" || mesh === "") continue;
    out.push({ icon, owner: d.id, mesh, colors: deployed ? Array.from({ length: 6 }, (_, i) => deployed.regions?.[i]?.colors[0]?.[0] ?? 0) : [colors, 0, 0, 0, 0, 0] });
  }
  return out;
}

/** Positions of a level of a mesh, decoded. */
function positionsOf(pack: Pack, mesh: number): Float32Array {
  const m = pack.header.meshes[mesh]!;
  const lod = m.lods[0]!;
  const verts = lodVertices(pack, lod);
  const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const out = new Float32Array(lod.vertexCount * 3);
  for (let v = 0; v < lod.vertexCount; v++) for (let a = 0; a < 3; a++) out[v * 3 + a] = m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!;
  return out;
}

/** The camera's right and up for a view from `around` and `above`, in degrees, as ModelView stands it. */
function basis(around: number, above: number): { right: number[]; up: number[]; forward: number[] } {
  const [a, e] = [(around * Math.PI) / 180, (above * Math.PI) / 180];
  return {
    right: [Math.cos(a), 0, -Math.sin(a)],
    up: [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)],
    forward: [-Math.sin(a) * Math.cos(e), -Math.sin(e), -Math.cos(a) * Math.cos(e)],
  };
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** A shot of one mesh: where the camera stands, what it looks at, how far round the picture is turned. */
export interface IconShot {
  around: number;
  above: number;
  /** Degrees anticlockwise. */
  roll: number;
  centre: [number, number, number];
  radius: number;
  /** How many times nearer the picture is than the framing that fits (ModelShot.zoom). */
  zoom: number;
}

/**
 * The usual three-quarter view of a mesh, fitted to its points: seen from across its longest axis and a little above,
 * and, when it is long, turned so that axis runs from the bottom left to the top right, its far end from the origin at
 * the top. A held item is modelled from its grip, so its head is up. `framing` takes the place of the view where given,
 * and its shift moves the point looked at across the picture, after the fit.
 */
export function iconShot(pack: Pack, mesh: number, framing: IconFraming | null = null): IconShot {
  const m = pack.header.meshes[mesh]!;
  const half = m.half;
  const order = [0, 1, 2].sort((p, q) => half[q]! - half[p]!);
  const long = order[0]!;
  const elongated = half[long]! >= LONG * half[order[1]!]!;
  // Across a long Z (the length of a held item), across a long X, or before a long Y.
  const [around, above] = framing ? [framing.around, framing.above] : long === 2 ? [62, 24] : long === 0 ? [28, 24] : [24, 18];
  const { right, up, forward } = basis(around, above);
  const axis = [0, 0, 0];
  axis[long] = m.center[long]! >= 0 ? 1 : -1;
  let roll = framing?.roll ?? 0;
  if (!framing || framing.roll === undefined) {
    const [ar, au] = [dot(axis, right), dot(axis, up)];
    if (elongated && ar * ar + au * au > 0.1) roll = 45 - (Math.atan2(au, ar) * 180) / Math.PI;
  }
  const points = positionsOf(pack, mesh);
  const [c, s] = [Math.cos((roll * Math.PI) / 180), Math.sin((roll * Math.PI) / 180)];
  const centre: [number, number, number] = [m.center[0], m.center[1], m.center[2]];
  let radius = Math.max(half[0], half[1], half[2], 1e-3);
  // Twice: the second time with the camera as far off as the first put it, which sizes the near side right.
  for (let pass = 0; pass < 2; pass++) {
    const far = radius / Math.sin(FOV / 2);
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let v = 0; v < points.length; v += 3) {
      const d = [points[v]! - centre[0], points[v + 1]! - centre[1], points[v + 2]! - centre[2]];
      const k = pass === 0 ? 1 : far / (far + dot(d, forward));
      const [r, u] = [dot(d, right) * k, dot(d, up) * k];
      const [x, y] = [r * c - u * s, r * s + u * c];
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
    }
    if (!(x1 >= x0)) break;
    // The middle of the turned box, back in the camera's right and up, becomes the point looked at.
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [mr, mu] = [mx * c + my * s, -mx * s + my * c];
    for (let a = 0; a < 3; a++) centre[a] = centre[a]! + right[a]! * mr + up[a]! * mu;
    // The picture's half side is the radius over cos(FOV / 2) where it is looked at.
    radius = (Math.max(x1 - x0, y1 - y0, 1e-3) / 2 / (1 - 2 * MARGIN)) * Math.cos(FOV / 2);
  }
  if (framing?.shift) {
    // The half side of the framing that fits, and the shift in the turned picture back in right and up.
    const half = radius / Math.cos(FOV / 2);
    const [mx, my] = [framing.shift[0] * half, framing.shift[1] * half];
    const [mr, mu] = [mx * c + my * s, -mx * s + my * c];
    for (let a = 0; a < 3; a++) centre[a] = centre[a]! + right[a]! * mr + up[a]! * mu;
  }
  return { around, above, roll, centre, radius, zoom: framing?.zoom ?? 1 };
}

/** A texture of the pack in the rgba variant, by its place in the pack's list, or null where there is none. */
export type TextureSource = (slot: number) => RgbaTexture | null;

/**
 * Draws pictures one after another in one view, `size` pixels a side: each is drawn at SUPER times that and shrunk.
 * Textures are sent to the view the first time a picture needs them.
 */
export class IconPainter {
  readonly size: number;
  private readonly view: ModelView;
  private readonly pack: Pack;
  private readonly textures: TextureSource;
  private readonly sent = new Set<number>();

  constructor(pack: Pack, textures: TextureSource = () => null, size: number = ICON_SIZE) {
    this.pack = pack;
    this.size = size;
    this.textures = textures;
    this.view = new ModelView(pack, size * SUPER, size * SUPER, [0, 0, 0]);
  }

  /** The textures a mesh's finest level is drawn with, or null where it is drawn flat. */
  private texturesOf(mesh: number): number[] | null {
    const m = this.pack.header.meshes[mesh]!;
    const runs = m.lods[0]!.sections;
    if (!runs || (m.flat ?? 0) === 0) return null;
    const materials = this.pack.header.materials ?? [];
    const out = new Set<number>();
    // The maps a picture is drawn with. A body's layer, for wounds and decay, is not shown.
    for (let k = 0; k < runs.length; k += 3) for (const role of MAP_ROLES) if (materials[runs[k]!]![role] >= 0) out.add(materials[runs[k]!]![role]);
    return [...out];
  }

  /** RGBA, `size` by `size`, not premultiplied: the colour of what covers a pixel and how much of it is covered. */
  draw(mesh: number, colors: readonly number[], framing: IconFraming | null = null): Uint8Array {
    const shot = iconShot(this.pack, mesh, framing);
    const wanted = this.texturesOf(mesh);
    let textured = wanted !== null;
    for (const t of wanted ?? []) {
      if (this.sent.has(t)) continue;
      const tex = this.textures(t);
      if (!tex) {
        textured = false;
        continue;
      }
      this.view.texture(t, tex.role, tex.pictures);
      this.sent.add(t);
    }
    this.view.draw({ mesh, level: 0, around: shot.around, above: shot.above, centre: shot.centre, radius: shot.radius, ...(shot.zoom !== 1 ? { zoom: shot.zoom } : {}), rig: null, colors, textured });
    return this.shrink(shot.roll);
  }

  /** The view's picture turned `roll` degrees and shrunk: SUPER by SUPER samples a pixel, each the nearest drawn. */
  private shrink(roll: number): Uint8Array {
    const { color, pickKind, width } = this.view.raster;
    const n = this.size;
    const out = new Uint8Array(n * n * 4);
    const [c, s] = [Math.cos((roll * Math.PI) / 180), Math.sin((roll * Math.PI) / 180)];
    const half = n / 2;
    const samples = SUPER * SUPER;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let [r, g, b, covered] = [0, 0, 0, 0];
        for (let k = 0; k < samples; k++) {
          // The sample in the picture, from its middle, x right and y up, then turned back into the view.
          const px = x + ((k % SUPER) + 0.5) / SUPER - half;
          const py = half - (y + (Math.floor(k / SUPER) + 0.5) / SUPER);
          const vx = Math.floor((px * c + py * s + half) * SUPER);
          const vy = Math.floor((half - (-px * s + py * c)) * SUPER);
          if (vx < 0 || vy < 0 || vx >= width || vy >= width) continue;
          const at = vy * width + vx;
          if (pickKind[at] === PICK_SKY) continue;
          r += color[at * 4]!;
          g += color[at * 4 + 1]!;
          b += color[at * 4 + 2]!;
          covered++;
        }
        if (covered === 0) continue;
        const o = (y * n + x) * 4;
        out[o] = Math.round(r / covered);
        out[o + 1] = Math.round(g / covered);
        out[o + 2] = Math.round(b / covered);
        out[o + 3] = Math.round((covered * 255) / samples);
      }
    }
    return out;
  }
}

/**
 * The textures of a manifest in the rgba variant, from its files as they are: a step stored deflated is inflated and
 * its filter undone (shared/pack/stored.ts), so the pictures are the bytes a client gets. `files` are by the manifest's
 * index.
 */
export function rgbaTextures(manifest: Manifest, files: readonly Uint8Array[]): TextureSource {
  const made = new Map<number, RgbaTexture | null>();
  return (slot) => {
    if (made.has(slot)) return made.get(slot)!;
    const t = manifest.textures?.[slot];
    const v = t?.in.rgba;
    let out: RgbaTexture | null = null;
    if (t && v && files[v.file]) {
      const top = topIn("rgba", t.top);
      const steps: Uint8Array[] = [];
      for (let k = 0, at = v.at; k <= stepOf(top); k++) {
        const length = storedStep(v, "rgba", t.role, k);
        const bytes = stepBytes("rgba", t.role, k);
        const stored = files[v.file]!.subarray(at, at + length);
        steps.push(length < bytes ? unfilterPart(new Uint8Array(inflateRawSync(stored)), bytes)! : stored);
        at += length;
      }
      const all = new Uint8Array(steps.reduce((sum, p) => sum + p.length, 0));
      steps.reduce((at, p) => (all.set(p, at), at + p.length), 0);
      const pictures: Uint8Array[] = [];
      for (let size = 1, at = 0; size <= top; size <<= 1) pictures.push(all.subarray(at, (at += pictureBytes("rgba", t.role, size))));
      out = { role: t.role, top, pictures };
    }
    made.set(slot, out);
    return out;
  };
}

/** A PNG of RGBA pixels, each row filtered by Paeth's predictor, which suits a picture on a clear ground. */
export function iconPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const to = y * (stride + 1);
    raw[to] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[y * stride + i - 4]! : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? rgba[(y - 1) * stride + i - 4]! : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      raw[to + 1 + i] = (rgba[y * stride + i]! - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) crc = crcTable[(crc ^ out[i]!) & 255]! ^ (crc >>> 8);
    view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
    return out;
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}

let drawnBy: string | null = null;

/** The key a picture is kept under: the code that draws it and everything of the pack it is drawn from. */
function iconKey(pack: Pack, mesh: number, colors: readonly number[], framing: IconFraming | null, textureKey: (slot: number) => string, size: number): string {
  const hash = createHash("sha256").update((drawnBy ??= DRAWN_BY.map((f) => readFileSync(join(import.meta.dir, f), "utf8")).join("\0")));
  const m = pack.header.meshes[mesh]!;
  const lod = m.lods[0]!;
  hash.update(JSON.stringify([size, SUPER, colors, framing, m.center, m.half, m.uv ?? null, m.flat ?? null, lod.sections ?? null]));
  hash.update(pack.palette);
  hash.update(pack.blob.subarray(lod.indexOffset, lod.indexOffset + lod.indexCount * lod.indexBytes));
  hash.update(lodVertices(pack, lod));
  if (lod.surfaceOffset !== undefined) hash.update(pack.blob.subarray(lod.surfaceOffset, lod.surfaceOffset + lod.vertexCount * SURFACE_BYTES));
  if (lod.skinOffset !== undefined) hash.update(pack.blob.subarray(lod.skinOffset, lod.skinOffset + lod.vertexCount * SKIN_BYTES));
  const materials = pack.header.materials ?? [];
  const runs = (m.flat ?? 0) > 0 ? (lod.sections ?? []) : [];
  for (let k = 0; k < runs.length; k += 3) {
    const mat = materials[runs[k]!]!;
    hash.update(JSON.stringify(mat));
    for (const role of MAP_ROLES) if (mat[role] >= 0) hash.update(textureKey(mat[role]));
  }
  return hash.digest("hex");
}

export interface IconOptions {
  /** Where pictures are kept between builds, or null to keep none. */
  cache?: string | null;
  /** The view of each mesh that is not drawn the usual way, by mesh id. */
  framing?: ReadonlyMap<string, IconFraming>;
  /** What keys a texture's pixels: by default its rgba hashes in the manifest. */
  textureKey?: (slot: number) => string;
  size?: number;
}

export interface IconReport {
  /** Items with a picture, the different pictures, and how many of those were drawn rather than taken from the cache. */
  items: number;
  pictures: number;
  drawn: number;
  /** Milliseconds spent drawing, and the bytes of each sheet. */
  ms: number;
  sheetBytes: number[];
}

/** The different pictures of `subjects`, in the order first wanted, each with the icon ids it is for. */
export interface DrawnIcons {
  size: number;
  pictures: Uint8Array[];
  /** By icon id, its picture's index. */
  index: Map<string, number>;
  report: IconReport;
}

/** Draws, or takes from the cache, the picture of each subject. */
export function drawIcons(pack: Pack, subjects: readonly IconSubject[], textures: TextureSource, opts: IconOptions = {}): DrawnIcons {
  const size = opts.size ?? ICON_SIZE;
  const cache = opts.cache === undefined ? ICON_CACHE : opts.cache;
  const textureKey = opts.textureKey ?? ((slot: number) => String(slot));
  let painter: IconPainter | null = null;
  const pictures: Uint8Array[] = [];
  const byKey = new Map<string, number>();
  const index = new Map<string, number>();
  const report: IconReport = { items: 0, pictures: 0, drawn: 0, ms: 0, sheetBytes: [] };
  for (const s of subjects) {
    const mesh = pack.meshIndex.get(s.mesh);
    if (mesh === undefined) continue;
    const framing = opts.framing?.get(s.mesh) ?? opts.framing?.get(s.mesh.replace(/\/dropped$/, "")) ?? null;
    const key = iconKey(pack, mesh, s.colors, framing, textureKey, size);
    let at = byKey.get(key);
    if (at === undefined) {
      const file = cache === null ? null : join(cache, key.slice(0, 2), key);
      let picture: Uint8Array | null = file !== null && existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
      if (picture === null || picture.length !== size * size * 4) {
        const t0 = performance.now();
        picture = (painter ??= new IconPainter(pack, textures, size)).draw(mesh, s.colors, framing);
        report.ms += performance.now() - t0;
        report.drawn++;
        if (file !== null) {
          mkdirSync(join(cache!, key.slice(0, 2)), { recursive: true });
          writeFileSync(`${file}.${process.pid}.tmp`, picture);
          renameSync(`${file}.${process.pid}.tmp`, file);
        }
      }
      byKey.set(key, (at = pictures.length));
      pictures.push(picture);
    }
    index.set(s.icon, at);
    report.items++;
  }
  report.pictures = pictures.length;
  return { size, pictures, index, report };
}

/** The pictures laid out in sheets, each as RGBA pixels, and the manifest's description of them, its files from `firstFile`. */
export function iconSheets(drawn: DrawnIcons, firstFile: number): { sheets: { width: number; height: number; rgba: Uint8Array }[]; icons: ManifestIcons } {
  const { size } = drawn;
  const shapes = sheetShapes(drawn.pictures.length);
  const sheets = shapes.map((s) => ({ width: s.columns * size, height: s.rows * size, rgba: new Uint8Array(s.columns * size * s.rows * size * 4) }));
  drawn.pictures.forEach((picture, cell) => {
    const { sheet, x, y } = iconAt(cell, size);
    const to = sheets[sheet]!;
    for (let row = 0; row < size; row++) to.rgba.set(picture.subarray(row * size * 4, (row + 1) * size * 4), ((y + row) * to.width + x) * 4);
  });
  const icons: ManifestIcons = { size, sheets: shapes.map((s, k) => ({ file: firstFile + k, ...s })), cells: Object.fromEntries(drawn.index) };
  return { sheets, icons };
}

/**
 * The sheets of a build's pictures as files to serve, and the manifest told of them: each sheet a file of role "icon",
 * after the files it lists already. `files` are the manifest's files' bytes by index, which the textures are read from.
 */
export function buildIcons(pack: Pack, defs: readonly (Def | null)[], manifest: Manifest, files: readonly Uint8Array[], opts: IconOptions = {}): { files: SplitFile[]; report: IconReport } {
  const subjects = iconSubjects(defs, (id) => pack.meshIndex.has(id));
  const textureKey = (slot: number): string => (manifest.textures?.[slot]?.in.rgba?.hash ?? []).join(",");
  // The manifest's materials name its textures, which a build may have shared out or left out.
  const drawn = drawIcons({ ...pack, header: { ...pack.header, materials: manifest.materials } }, subjects, rgbaTextures(manifest, files), { textureKey, ...opts });
  const { sheets, icons } = iconSheets(drawn, manifest.files.length);
  const out = sheets.map((s, k): SplitFile => ({ name: `core.icons.${k}.png`, role: "icon", bytes: iconPng(s.width, s.height, s.rgba) }));
  for (const f of out) manifest.files.push({ name: f.name, bytes: f.bytes.length, role: "icon" });
  manifest.icons = icons;
  drawn.report.sheetBytes = out.map((f) => f.bytes.length);
  return { files: out, report: drawn.report };
}

/** The views the pieces of the assets under assets/source ask for (`PieceSpec.icon`), by piece id. */
export async function assetFraming(): Promise<Map<string, IconFraming>> {
  const out = new Map<string, IconFraming>();
  for (const asset of await findAssets()) {
    if (asset.spec.kind !== "pieces") continue;
    for (const p of asset.spec.pieces) if (p.icon) out.set(p.id, framingOf(p.icon));
  }
  return out;
}

/**
 * What `bun run build` adds: the pictures of the core content's items, drawn from `core`, the whole core pack, with the
 * textures of `files`, the build's files as stored, by the manifest's index. The manifest is told of the sheets.
 */
export async function gameIcons(core: Uint8Array, manifest: Manifest, files: readonly SplitFile[]): Promise<SplitFile[]> {
  const defs = compileContent(CORE_CONTENT).registry!.defs;
  const built = buildIcons(parsePack(core), defs, manifest, files.map((f) => f.bytes), { framing: await assetFraming() });
  console.log(iconLine(built.report));
  return built.files;
}

/** One line for a build's log. */
export function iconLine(r: IconReport): string {
  return `icons        ${r.items} items in ${r.pictures} pictures on ${r.sheetBytes.length} sheets of ${SHEET_COLUMNS} by up to ${ICONS_A_SHEET / SHEET_COLUMNS}, ${r.sheetBytes.reduce((a, b) => a + b, 0)} bytes: ${r.drawn} drawn${r.drawn > 0 ? ` in ${r.ms.toFixed(0)} ms` : ""}`;
}
