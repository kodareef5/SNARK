// Cuts the field sheets (client/core/ui/field-icons.ts) from the generated plates in assets/source/ui/field.
//
// The item, menu and action plates have transparent backgrounds; the parts, glyphs and pads were asked for on pure black,
// and black becomes transparency as for the touch controls (touch-art.ts lift). Each object is cut from its own cell of
// its plate: every connected piece belongs to the grid cell its middle falls in, so an antenna may cross a grid line.
// Each object is measured by what is solid in it and set in the middle of its sheet cell at a share of the cell's side,
// and the tool fails where a placed object is off its size or centre.
//
//   bun tools/ui/field-art.ts      writes assets/source/ui/field-*.webp, each sheet whose plates are here

import { existsSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FIELD_EQUIPMENT, FIELD_ICONS, FIELD_PARTS, FIELD_TOUCH, sheetHeight, sheetWidth, type FieldSheet } from "../../client/core/ui/field-icons.ts";
import { readPng } from "../pack/png-read.ts";
import { encodePng } from "../snap/png.ts";
import { body, corner, extent, lift, resize, underlay, type Box, type Layer, type Picture, type Shape } from "./touch-art.ts";

export const FIELD_SOURCE = resolve(import.meta.dir, "../../assets/source/ui/field");
const UI = resolve(import.meta.dir, "../../assets/source/ui");
/** Alpha below this is a cut's fringe, and is dropped. */
const FRINGE = 0.04;
/** How much a picture on black is brought up, as for the touch glyphs. */
const GAIN = 1.2;
/** How far a placed object may be off the size asked, as a share of it, and off its cell's middle, in pixels. */
const SIZE_SLACK = 0.02, CENTRE_SLACK = 1.5;

/**
 * Where a cell's object comes from: a plate in FIELD_SOURCE (or the HUD's vitals), its grid, and which cell. A glyph is
 * sized by eye. A glass part is sized by its rim, as the touch controls are, with `glass` of dark glass under its shape.
 */
interface Cut { file: string; columns: number; rows: number; index: number; black?: boolean; span?: number; eye?: boolean; shape?: Shape; glass?: number }

const grid = (file: string, columns: number, rows: number, more: Partial<Cut> = {}) =>
  (index: number, also: Partial<Cut> = {}): Cut => ({ file, columns, rows, index, ...more, ...also });
const items = grid("items.png", 4, 3), materials = grid("materials.png", 2, 2), menu = grid("menu.png", 3, 2), actions = grid("actions.png", 4, 3);
const glyphs = grid("glyphs.png", 4, 3, { black: true, span: 0.62, eye: true }), vitals = grid("../vitals-source.png", 4, 4, { black: true, span: 0.66, eye: true });
const parts = grid("parts.png", 2, 2, { black: true, span: 0.8 }), pads = grid("pads.png", 2, 2, { black: true, span: 0.82 });

/** Each name of each sheet, and where its object is cut from. */
export const CUTS: Readonly<Record<string, Cut>> = {
  "core:pick": items(0), "core:hatchet": items(1), "core:spear": items(2), "core:bow": items(3),
  "core:waterskin": items(4), "core:torch": items(5), "core:spyglass": items(6), "core:bola": items(7),
  "core:berry": items(8), "core:flint": items(9), "core:fiber": items(10), "core:wood": items(11),
  "core:stone": materials(0), "core:thatch": materials(1), "core:hide": materials(2), "core:ingot": materials(3),
  "ui:glass-emblem": { file: "emblem.png", columns: 1, rows: 1, index: 0, span: 0.8 },
  "ui:glass-bag": menu(0), "ui:glass-map": menu(1), "ui:glass-survivor": menu(2), "ui:glass-craft": menu(3), "ui:glass-radio": menu(4), "ui:glass-settings": menu(5),
  "ui:glass-whistles": actions(0), "ui:glass-kit": actions(1), "ui:glass-gestures": actions(2), "ui:glass-follow": actions(3),
  "ui:glass-stay": actions(4), "ui:glass-attack-target": actions(5), "ui:glass-drink": actions(6), "ui:glass-eat": actions(7),
  "ui:glass-spyglass": actions(8), "ui:glass-wave": actions(9), "ui:glass-point": actions(10), "ui:glass-salute": actions(11),
  "ui:glass-health": vitals(0), "ui:glass-stamina": vitals(1), "ui:glass-food": vitals(2), "ui:glass-water": vitals(3),
  "ui:glass-oxygen": vitals(4), "ui:glass-torpor": vitals(5), "ui:glass-weight": vitals(6),
  "ui:glyph-close": glyphs(0), "ui:glyph-more": glyphs(1), "ui:glyph-back": glyphs(2), "ui:glyph-zoom-out": glyphs(3),
  "ui:glyph-zoom-in": glyphs(4), "ui:glyph-pin": glyphs(5), "ui:glyph-atlas": glyphs(6), "ui:glyph-save": glyphs(7),
  "ui:glyph-telemetry": glyphs(8), "ui:glyph-unpin": glyphs(9), "ui:glyph-inspect": glyphs(10), "ui:glyph-assign": glyphs(11),
  "ui:part-tile": parts(0, { shape: "square", glass: 0.55 }), "ui:part-tile-lit": parts(1, { shape: "square", glass: 0.35 }),
  "ui:part-mount": parts(2, { shape: "disc", glass: 0.6 }), "ui:part-dial": parts(3, { shape: "ring", glass: 0 }),
  "ui:glass-touch-move": pads(0, { shape: "disc", glass: 0.3 }), "ui:glass-touch-look": pads(1, { shape: "ring", glass: 0 }),
  "ui:glass-touch-look-lit": pads(2, { shape: "ring", glass: 0 }), "ui:glass-touch-knob": pads(3, { shape: "disc", glass: 0.8, span: 0.7 }),
};

/** A share of the cell an object fills, by its larger side. */
const SPAN = 0.86;

/** A picture with alpha as premultiplied light, its fringe dropped. */
export function cutOut(p: Picture): Layer {
  const w = p.width, h = p.height, data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const at = i * p.channels, a = p.channels === 4 ? p.data[at + 3]! / 255 : 1;
    if (a < FRINGE) continue;
    data[i * 4] = p.data[at]! / 255 * a; data[i * 4 + 1] = p.data[at + 1]! / 255 * a; data[i * 4 + 2] = p.data[at + 2]! / 255 * a; data[i * 4 + 3] = a;
  }
  return { w, h, data };
}

/** Alpha at which a pixel is part of a piece; fainter ones are its soft edge. A piece under SPECK of its cell's largest is dropped. */
const SOLID = 0.05, SPECK = 0.005;

/** A plate's objects: each connected piece belongs to the grid cell its middle falls in, and each cell's pieces are one object. */
export interface Objects { layer: Layer; label: Int32Array; cellOf: Int32Array; boxes: (Box | null)[] }

export function objects(layer: Layer, columns: number, rows: number): Objects {
  const { w, h, data } = layer, label = new Int32Array(w * h).fill(-1), stack: number[] = [];
  const sizes: number[] = [], sx: number[] = [], sy: number[] = [], box: Box[] = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start * 4 + 3]! < SOLID) continue;
    const id = sizes.length, b: Box = { l: w, t: h, r: 0, b: 0 };
    let size = 0, x0 = 0, y0 = 0;
    label[start] = id; stack.push(start);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w;
      size++; x0 += x; y0 += y;
      b.l = Math.min(b.l, x); b.t = Math.min(b.t, y); b.r = Math.max(b.r, x + 1); b.b = Math.max(b.b, y + 1);
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (n >= 0 && label[n] === -1 && data[n * 4 + 3]! >= SOLID) { label[n] = id; stack.push(n); }
      }
    }
    sizes.push(size); sx.push(x0 / size); sy.push(y0 / size); box.push(b);
  }
  const cellOf = new Int32Array(sizes.length), largest = new Array<number>(columns * rows).fill(0);
  for (let i = 0; i < sizes.length; i++) {
    const c = Math.min(columns - 1, Math.floor(sx[i]! / (w / columns))) + Math.min(rows - 1, Math.floor(sy[i]! / (h / rows))) * columns;
    cellOf[i] = c;
    largest[c] = Math.max(largest[c]!, sizes[i]!);
  }
  const boxes: (Box | null)[] = new Array(columns * rows).fill(null);
  for (let i = 0; i < sizes.length; i++) {
    const c = cellOf[i]!;
    if (sizes[i]! < largest[c]! * SPECK) { cellOf[i] = -1; continue; }
    const b = boxes[c], p = box[i]!;
    boxes[c] = b ? { l: Math.min(b.l, p.l), t: Math.min(b.t, p.t), r: Math.max(b.r, p.r), b: Math.max(b.b, p.b) } : { ...p };
  }
  return { layer, label, cellOf, boxes };
}

/** Cell `cell`'s object alone, cut to its box and a margin for its soft edge. */
export function objectLayer(o: Objects, cell: number, name: string): Layer {
  const b = o.boxes[cell];
  if (!b) throw new Error(`${name}: its plate cell is empty`);
  const { w, h, data } = o.layer, pad = 3;
  const l = Math.max(0, b.l - pad), t = Math.max(0, b.t - pad), r = Math.min(w, b.r + pad), bt = Math.min(h, b.b + pad);
  const ow = r - l, oh = bt - t, out = new Float32Array(ow * oh * 4);
  const mine = (x: number, y: number): boolean => { const k = o.label[y * w + x]!; return k >= 0 && o.cellOf[k] === cell; };
  for (let y = t; y < bt; y++) for (let x = l; x < r; x++) {
    const i = y * w + x, k = o.label[i]!;
    let keep = k >= 0 ? o.cellOf[k] === cell : false;
    // A faint pixel goes with a piece of this object within two pixels of it.
    for (let dy = -2; !keep && k < 0 && dy <= 2; dy++) for (let dx = -2; !keep && dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mine(nx, ny)) keep = true;
    }
    if (keep) out.set(data.subarray(i * 4, i * 4 + 4), ((y - t) * ow + x - l) * 4);
  }
  return { w: ow, h: oh, data: out };
}

/** A Lanczos filter rings: light is never more than its alpha. */
function clean(l: Layer): Layer {
  for (let i = 0; i < l.data.length; i += 4) for (let c = 0; c < 3; c++) l.data[i + c] = Math.min(l.data[i + c]!, l.data[i + 3]!);
  return l;
}

function misplaced(name: string, got: Box, side: number, w: number, h: number): void {
  const gw = got.r - got.l, gh = got.b - got.t, dx = (got.l + got.r - side) / 2, dy = (got.t + got.b - side) / 2;
  if (Math.abs(gw - w) > w * SIZE_SLACK + 2 || Math.abs(gh - h) > h * SIZE_SLACK + 2 || Math.abs(dx) > CENTRE_SLACK + 1 || Math.abs(dy) > CENTRE_SLACK + 1) {
    throw new Error(`${name} placed ${gw.toFixed(1)} by ${gh.toFixed(1)} off centre ${dx.toFixed(1)}, ${dy.toFixed(1)}; wanted ${w.toFixed(1)} by ${h.toFixed(1)} at the middle`);
  }
}

/** The object `side` square, its larger side `span` of it (by eye, a glyph's area as much as its length), centred. */
export function placeObject(object: Layer, side: number, span: number, name: string, eye = false): Layer {
  const box = extent(object, SOLID), w = box.r - box.l, h = box.b - box.t, most = side * span;
  const scale = eye ? Math.min(most / Math.max(w, h), (most * 0.8) / Math.sqrt(w * h)) : most / Math.max(w, h);
  const out = clean(resize(object, scale, scale, side, side, (box.l + box.r) / 2, (box.t + box.b) / 2));
  misplaced(name, extent(out, SOLID), side, w * scale, h * scale);
  return out;
}

/** A glass part, sized each way so that its rim is `span` of the side, with dark glass under its shape. */
export function placePart(seen: Layer, side: number, span: number, shape: Shape, glass: number, name: string): Layer {
  const l: Layer = { w: seen.w, h: seen.h, data: seen.data.slice() }, b = body(seen), want = side * span;
  underlay(l, shape, b, shape === "square" ? corner(seen, b) : 0, glass);
  const sized = (layer: Layer): Layer => clean(resize(layer, want / (b.r - b.l), want / (b.b - b.t), side, side, (b.l + b.r) / 2, (b.t + b.b) / 2));
  misplaced(name, body(sized(seen)), side, want, want);
  return sized(l);
}

const plates = new Map<string, Objects>();
function plateObjects(cut: Cut): Objects | null {
  if (!plates.has(cut.file)) {
    const path = resolve(FIELD_SOURCE, cut.file);
    if (!existsSync(path)) return null;
    const p = readPng(path);
    plates.set(cut.file, objects(cut.black ? lift(p, [0, 0, p.width, p.height], GAIN) : cutOut(p), cut.columns, cut.rows));
  }
  return plates.get(cut.file)!;
}

/** The sheet as straight-alpha RGBA, or null where a plate it needs is not here. */
export function fieldSheet(s: FieldSheet): Uint8ClampedArray | null {
  const width = sheetWidth(s), height = sheetHeight(s), out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < s.names.length; i++) {
    const name = s.names[i]!, cut = CUTS[name];
    if (!cut) throw new Error(`no plate is named for ${name}`);
    const o = plateObjects(cut);
    if (!o) return null;
    const object = objectLayer(o, cut.index, name), span = cut.span ?? SPAN;
    const placed = cut.shape ? placePart(object, s.cell, span, cut.shape, cut.glass ?? 0, name) : placeObject(object, s.cell, span, name, cut.eye);
    const x0 = (i % s.columns) * s.cell, y0 = Math.floor(i / s.columns) * s.cell;
    for (let y = 0; y < s.cell; y++) for (let x = 0; x < s.cell; x++) {
      const k = (y * s.cell + x) * 4, a = placed.data[k + 3]!, at = ((y0 + y) * width + x0 + x) * 4;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) out[at + c] = Math.round((placed.data[k + c]! / a) * 255);
      out[at + 3] = Math.round(a * 255);
    }
  }
  return out;
}

export const FIELD_FILES: readonly [FieldSheet, string][] = [[FIELD_ICONS, "field-icons"], [FIELD_EQUIPMENT, "field-equipment"], [FIELD_PARTS, "field-parts"], [FIELD_TOUCH, "field-touch"]];

if (import.meta.main) {
  const scratch = mkdtempSync(join(tmpdir(), "field-art-"));
  try {
    for (const [sheet, name] of FIELD_FILES) {
      const pixels = fieldSheet(sheet);
      if (!pixels) { console.log(`${name}: its plates are not all in ${FIELD_SOURCE}`); continue; }
      const png = join(scratch, name + ".png"), webp = resolve(UI, name + ".webp");
      writeFileSync(png, encodePng(sheetWidth(sheet), sheetHeight(sheet), pixels));
      // Alpha is kept exactly: a glow's evenness lives there.
      // Written beside and renamed over: an installed sheet is a read-only link to the shared art (media.py).
      const made = Bun.spawnSync(["cwebp", "-quiet", "-q", "90", "-alpha_q", "100", "-m", "6", "-sharp_yuv", png, "-o", webp + ".part"]);
      if (made.exitCode !== 0) throw new Error(`cwebp could not write ${webp}`);
      renameSync(webp + ".part", webp);
      console.log(`${name}: ${sheetWidth(sheet)} by ${sheetHeight(sheet)}, ${statSync(webp).size} bytes`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
