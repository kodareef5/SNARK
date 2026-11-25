// The frame packet's writer. Every pass puts its draws through it: `draw` for instances of a mesh at a level, and the
// columns themselves for a pass that writes a draw of its own kind (a far tile, a lake). It keeps, a draw a row beside the
// packet's, what the frame needs of a draw and the renderer does not: its depth ranges, how near it is, the box round it.
// Once every pass has drawn, `order` puts the draws in the order of the steps they are drawn in.

import { sortF64 } from "../../../shared/sort.ts";
import type { Assets } from "../assets/assets.ts";
import type { FrameBudget } from "./budget.ts";
import { FAR_FROM } from "./camera.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_DETAILS, DRAW_NEAR, DRAW_ORB, DRAW_SKYLINE, DRAW_TEXTURED, MAX_DRAWS, PASS_FAR, PASS_NEAR, STEP_BODY, STEP_FAR, STEP_FAR_SEE, STEP_NEAR, STEP_NEAR_SEE, type FramePacket } from "./packet.ts";
import { PROGRAM, drawProgram } from "./programs.ts";
import { WEAR_KEY } from "./wear.ts";

/** The one run of a level drawn flat: no material, and all its indices. */
const FLAT: readonly number[] = [-1, 0, 0];
const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;

/**
 * A draw's place in the order in `range`, as stepOf will find it, two to an opaque step for its cut-outs (`cutAt`) and
 * the rest (`restAt`), and -1 where it is not drawn there.
 */
function placeOf(flags: number, range: number, cutAt: number, restAt: number): number {
  let s = (flags & DRAW_BLEND) !== 0 ? STEP_NEAR_SEE - range : range;
  if ((flags & DRAW_NEAR) !== 0) s = range === PASS_NEAR ? STEP_BODY : -1;
  const at = s <= STEP_FAR && (flags & DRAW_CUTOUT) !== 0 ? cutAt : restAt;
  return s < 0 || at < 0 ? -1 : s <= STEP_FAR ? s * 2 + at : s + 2;
}

/**
 * The edges, in metres from the camera to a draw's nearest point, of the buckets an opaque step's draws go in nearest
 * first: few, so that the draws of one program and material in a bucket still run together.
 */
export const NEAR_BUCKETS = [24, 64, 160, 400, 1000, 2500];

function bucketOf(near: number): number {
  let b = 0;
  while (b < NEAR_BUCKETS.length && near >= NEAR_BUCKETS[b]!) b++;
  return b;
}

/** Programs a key holds room for. */
const KEY_PROGRAMS = 32;

/**
 * A draw's key for `sortRuns`, whole in a double: its bucket by distance, its program, its material, the low 16 bits of
 * its level's slot, and its place as made.
 */
function stateKey(bucket: number, program: number, material: number, slot: number, made: number): number {
  return (((bucket * KEY_PROGRAMS + program) * 65536 + material) * 65536 + (slot & 0xffff)) * MAX_DRAWS + made;
}

/**
 * Sorts keys `from` to `to`, turns every other run of one program and material round, counting on from `turns`, and
 * puts each one's place as made in `out`. The runs counted so far.
 */
function sortRuns(keys: Float64Array, from: number, to: number, turns: number, out: Uint16Array): number {
  sortF64(keys, from, to);
  for (let k = from; k < to; turns++) {
    const run = Math.floor(keys[k]! / (65536 * MAX_DRAWS));
    let end = k + 1;
    while (end < to && Math.floor(keys[end]! / (65536 * MAX_DRAWS)) === run) end++;
    for (let a = k, b = end - 1; turns % 2 === 1 && a < b; a++, b--) {
      const t = keys[a]!;
      keys[a] = keys[b]!;
      keys[b] = t;
    }
    k = end;
  }
  for (let k = from; k < to; k++) out[k] = keys[k]! - Math.floor(keys[k]! / MAX_DRAWS) * MAX_DRAWS;
  return turns;
}

/** A column of rows as its bits, an element of one, two or four bytes. */
type Bits = Uint8Array | Uint16Array | Uint32Array;

function bitsOf(a: Uint8Array | Int8Array | Uint16Array | Uint32Array | Float32Array): Bits {
  const n = a.length;
  return a.BYTES_PER_ELEMENT === 1 ? new Uint8Array(a.buffer, a.byteOffset, n) : a.BYTES_PER_ELEMENT === 2 ? new Uint16Array(a.buffer, a.byteOffset, n) : new Uint32Array(a.buffer, a.byteOffset, n);
}

/**
 * Puts the first `count` rows of each column (a row as many elements as its length is `capacity`) in the order `order`
 * names them from the first `rows` as they were, by way of `copy`. A loop for each width of element, since
 * JavaScriptCore is many times slower at one loop over arrays of several kinds.
 */
function reorder(columns: readonly Bits[], capacity: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let c = 0; c < columns.length; c++) {
    const a = columns[c]!;
    const w = a.length / capacity;
    if (a instanceof Uint8Array) reorder8(a, w, rows, count, order, copy);
    else if (a instanceof Uint16Array) reorder16(a, w, rows, count, order, copy);
    else reorder32(a, w, rows, count, order, copy);
  }
}

function reorder8(a: Uint8Array, w: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let k = 0; k < rows * w; k++) copy[k] = a[k]!;
  for (let k = 0; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = copy[order[k]! * w + j]!;
}

function reorder16(a: Uint16Array, w: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let k = 0; k < rows * w; k++) copy[k] = a[k]!;
  for (let k = 0; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = copy[order[k]! * w + j]!;
}

function reorder32(a: Uint32Array, w: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let k = 0; k < rows * w; k++) copy[k] = a[k]!;
  for (let k = 0; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = copy[order[k]! * w + j]!;
}

/** Row k of `a`, of `w` elements a row, takes row rows[k], for k from `from` up to `count`: as `reorder`, a loop for each width. */
function keep8(a: Uint8Array, w: number, rows: Uint16Array, from: number, count: number): void {
  for (let k = from; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = a[rows[k]! * w + j]!;
}

function keep16(a: Uint16Array, w: number, rows: Uint16Array, from: number, count: number): void {
  for (let k = from; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = a[rows[k]! * w + j]!;
}

function keep32(a: Uint32Array, w: number, rows: Uint16Array, from: number, count: number): void {
  for (let k = from; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = a[rows[k]! * w + j]!;
}

/** Where an opaque step's cut-out draws go among its others (Draws.cutouts). */
export type Cutouts = "last" | "made" | "first" | "none";
export const CUTOUTS: readonly Cutouts[] = ["last", "made", "first", "none"];

/** What the writer reads of the pack's meshes and materials, each made once by the scene. */
export interface DrawLooks {
  /** Per mesh, DRAW_GROUND where a kind of paint on the ground is drawn with it, else 0. */
  readonly groundFlags: Uint16Array;
  /** Per mesh, DRAW_BENT where a bent kind is drawn with it, else 0. */
  readonly bentFlags: Uint32Array;
  /** Per mesh, the flags a draw of it in palette colours carries besides its own. */
  readonly flatFlags: Uint16Array;
  /** Per material, the flags of a draw with it, and 1 for bark. */
  readonly materialFlags: Uint8Array;
  readonly barkOf: Uint8Array;
  /** Per mesh, 1 for a standing tree's, whose crown gives to the budget. */
  readonly treeOf: Uint8Array;
  readonly trisOfMesh: readonly (readonly number[])[];
}

export class Draws {
  private readonly packet: FramePacket;
  private readonly assets: Assets;
  private readonly budget: FrameBudget;
  private readonly groundFlags: Uint16Array;
  private readonly bentFlags: Uint32Array;
  private readonly flatFlags: Uint16Array;
  private readonly materialFlags: Uint8Array;
  private readonly barkOf: Uint8Array;
  private readonly treeOf: Uint8Array;
  private readonly trisOfMesh: readonly (readonly number[])[];
  /**
   * Where an opaque step's cut-out draws go among its other draws: "last", after them all, so that a tiled GPU can
   * reject the cut-out pixels an opaque surface hides before it shades them; "made", as they were made; "first", before
   * them all, where it can reject none but those the ground hides; "none", left out. The device page sets them side by
   * side, and prices the cut-outs by the last two.
   */
  cutouts: Cutouts = "last";
  /** Whether an opaque step's draws go nearest first, the ground after them. A page turns it off for a before and after (passes.ts). */
  nearFirst = true;
  /** The depth ranges of each draw made so far, a bit each by PASS_, and how many draws are in both. */
  readonly passOf = new Uint8Array(MAX_DRAWS);
  doubled = 0;
  /**
   * For putting the draws in order: the packet's columns of draws as their bits, room for one of them as made, each
   * draw's place in each range (its step, an opaque step's cut-outs a place after its other draws), where each place
   * begins, the draw and range each place in the order takes, and the keys an opaque place is sorted by (`stateKey`).
   */
  readonly columns: Bits[];
  readonly copy = new Float64Array(MAX_DRAWS * 3);
  readonly steps = new Int8Array(MAX_DRAWS * 2);
  readonly starts = new Int32Array(STEP_BODY + 4);
  readonly source = new Uint16Array(MAX_DRAWS);
  readonly sourcePass = new Uint8Array(MAX_DRAWS);
  readonly keys = new Float64Array(MAX_DRAWS);
  /**
   * Per draw made this frame: how far off its nearest point is, in metres, by which its step draws it; and where `boxed` is
   * 1, the camera-relative box round all it draws, by which it is left out where hidden. `nearAt` is what `draw` gives.
   */
  readonly nearOf = new Float32Array(MAX_DRAWS);
  private readonly nearBits = new Uint32Array(this.nearOf.buffer);
  readonly boxed = new Uint8Array(MAX_DRAWS);
  readonly boxOf = new Float32Array(MAX_DRAWS * 6);
  nearAt = 0;
  /** The effect `draw` gives its draws (packet.ts drawEffect): all 0 but while a supply drop's lights are drawn. */
  readonly effect = new Float32Array(4);
  /** The tint and the fade `draw` gives its draws (packet.ts drawTint): 0 but while a piece about to be built is drawn. */
  tint = 0;
  fade = 0;
  /** The swap `draw` gives its draws (packet.ts drawSwap): 0 but while a cell of trees changing level is drawn (`swapOf`). */
  swap = 0;
  /** Scratch for the draws of a level, four numbers each: material, 1 if from the trunk's level, first index, indices. */
  readonly drawParts: number[] = [];
  /** Whether the level `drawable` last gave is drawn with its materials. */
  ready = false;

  constructor(packet: FramePacket, assets: Assets, budget: FrameBudget, looks: DrawLooks) {
    this.packet = packet;
    this.assets = assets;
    this.budget = budget;
    this.groundFlags = looks.groundFlags;
    this.bentFlags = looks.bentFlags;
    this.flatFlags = looks.flatFlags;
    this.materialFlags = looks.materialFlags;
    this.barkOf = looks.barkOf;
    this.treeOf = looks.treeOf;
    this.trisOfMesh = looks.trisOfMesh;
    const p = packet as unknown as Record<string, unknown>;
    this.columns = Object.keys(p).filter((k) => k.startsWith("draw") && k !== "drawPass" && ArrayBuffer.isView(p[k])).map((k) => bitsOf(p[k] as Uint8Array));
  }

  /** Before a frame's first draw. */
  begin(): void {
    this.doubled = 0;
    this.boxed.fill(0);
    this.nearAt = 0;
  }

  /**
   * Draws `count` instances of a mesh at the level the card has nearest to `wanted`: one draw for each of the level's
   * sections when the card has everything its materials take, and otherwise one flat draw of the whole of it. `passes`
   * are the depth ranges it is drawn in (Camera.passes), and a draw in both takes the room of two. A section whose
   * material has its layer on the card draws it at `layer`, which holds its wear story too (wear.ts WEAR_KEY). A tree's crown may be drawn at a level of its own, `crown`,
   * and its cut-out leaves at a share, the first of them (tools/pack/sprays.ts): its bark from the level wanted and the
   * rest from the crown's, while both are drawn with their materials, else all of it at the crown's.
   */
  draw(mesh: number, wanted: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, passes: number, hand = 0, layer = 0, crown = wanted, leaves = 1): void {
    const p = this.packet;
    const n = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (n + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    let lod = this.drawable(mesh, wanted, flags);
    if (lod < 0) {
      p.skipped++;
      return;
    }
    // A flat draw's program has no swap: a cell changing level while its materials are not on the card changes at once.
    if (this.swap < 0 && !this.ready) return;
    const sections = this.assets.table.sections[mesh]!;
    let runs = this.ready ? sections[lod]! : FLAT;
    // The crown's level and its runs; where that level is drawn flat, it draws the whole tree.
    let top = lod, over = runs;
    if ((crown !== wanted || leaves < 1) && this.ready) {
      const c = this.drawable(mesh, Math.max(crown, lod), flags);
      if (c >= 0) {
        top = c;
        over = this.ready ? sections[c]! : FLAT;
        if (!this.ready) {
          lod = c;
          runs = FLAT;
        }
      }
    }
    const parts = this.parts(over, runs, top !== lod, leaves);
    const draws = parts.length / 4;
    // A mesh the frame has no room for all of is left out whole.
    if (n + this.doubled + draws * copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    const slot = this.assets.residency.slot(mesh, lod);
    const topSlot = top === lod ? slot : this.assets.residency.slot(mesh, top);
    let tris = 0, crowns = 0;
    for (let k = 0; k < draws; k++) {
      const d = n + k;
      const material = parts[k * 4]!, trunk = parts[k * 4 + 1] === 1, from = parts[k * 4 + 2]!, indices = parts[k * 4 + 3]!;
      this.passOf[d] = passes;
      this.nearOf[d] = this.nearAt;
      p.drawMesh[d] = mesh;
      p.drawLod[d] = trunk ? lod : top;
      p.drawSlot[d] = trunk ? slot : topSlot;
      p.drawBuffer[d] = buffer;
      p.drawFirst[d] = first;
      p.drawInstances[d] = count;
      p.drawOffset[d * 3] = ox;
      p.drawOffset[d * 3 + 1] = oy;
      p.drawOffset[d * 3 + 2] = oz;
      p.drawFlags[d] = flags | this.groundFlags[mesh]! | this.bentFlags[mesh]! | (material < 0 ? this.flatFlags[mesh]! : this.materialFlags[material]!);
      p.drawHand[d] = hand;
      p.drawSwap[d] = material < 0 ? 0 : this.swap;
      p.drawEffect.set(this.effect, d * 4);
      p.drawTint[d * 2] = this.tint;
      p.drawTint[d * 2 + 1] = this.fade;
      p.drawLayer[d] = layer > 0 && material >= 0 && this.assets.layered(material) ? layer % WEAR_KEY : 0;
      p.drawWear[d] = p.drawLayer[d]! > 0 ? Math.floor(layer / WEAR_KEY) : 0;
      const made = material < 0 ? this.trisOfMesh[mesh]![top]! : indices / 3;
      tris += made;
      if (material < 0 || this.barkOf[material] === 0) crowns += made;
      if (material < 0) continue;
      p.drawMaterial[d] = material;
      p.drawFirstIndex[d] = from;
      p.drawIndexCount[d] = indices;
    }
    p.drawCount = n + draws;
    this.doubled += draws * (copies - 1);
    p.triangles += tris * count * copies;
    if (this.treeOf[mesh] === 1) this.budget.crowns += crowns * count * copies;
  }

  /**
   * The draws of a level's runs `over`: with `split`, a bark run from the trunk's `runs` in its place; cut-out runs to
   * the first `leaves` of their triangles, and none where that is none.
   */
  private parts(over: readonly number[], runs: readonly number[], split: boolean, leaves: number): readonly number[] {
    const out = this.drawParts;
    out.length = 0;
    for (let k = 0; k < over.length; k += 3) {
      const material = over[k]!;
      let trunk = 0, from = over[k + 1]!, indices = over[k + 2]!;
      if (split && material >= 0 && this.barkOf[material] === 1) {
        for (let j = 0; j < runs.length; j += 3) {
          if (runs[j] !== material) continue;
          trunk = 1;
          from = runs[j + 1]!;
          indices = runs[j + 2]!;
        }
      }
      if (leaves < 1 && material >= 0 && (this.materialFlags[material]! & DRAW_CUTOUT) !== 0) indices = Math.floor((indices / 3) * leaves) * 3;
      if (material < 0 || indices > 0) out.push(material, trunk, from, indices);
    }
    return out;
  }

  /**
   * The level of a mesh to draw for `wanted`, or -1: the nearest held, and while that cannot be drawn with its materials
   * a finer one that can, so that a thing does not turn flat on its way from one level to the next. What is see-through
   * is drawn flat, and so is an orb's screen. An instrument's light is drawn with its strip where it has one, which says where on the light a
   * point is (programs.ts drawProgram). Sets `ready`.
   */
  drawable(mesh: number, wanted: number, flags: number): number {
    const held = this.assets.level(mesh, wanted);
    const textured = (flags & (DRAW_BLEND | DRAW_SKYLINE | DRAW_ORB)) === 0 ? this.assets.texturedLevel(mesh, wanted, held) : -1;
    this.ready = textured >= 0;
    return this.ready ? textured : held;
  }

  /** Whether a mesh wanted at `level` is drawn with its materials, as `draw` would draw it now. */
  texturedAt(mesh: number, level: number, flags: number): boolean {
    this.drawable(mesh, level, flags);
    return this.ready;
  }

  /** `count` of the packet's details from `first`, one draw in the depth ranges `passes`. */
  drawDetails(first: number, count: number, flags: number, passes: number): void {
    const p = this.packet;
    const d = p.drawCount;
    if (count === 0) return;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.nearOf[d] = 0;
    p.drawMesh[d] = 0;
    p.drawLod[d] = 0;
    p.drawSlot[d] = 0;
    p.drawBuffer[d] = 0;
    p.drawFirst[d] = first;
    p.drawInstances[d] = count;
    p.drawFlags[d] = DRAW_DETAILS | flags;
    p.drawOffset.fill(0, d * 3, d * 3 + 3);
    this.passOf[d] = passes;
    this.doubled += copies - 1;
    p.drawCount = d + 1;
    p.triangles += count * 2 * copies;
  }

  /** Gives draws `from` up to `to` the camera-relative box from (x0, y0, z0) to (x1, y1, z1), and how far off its nearest point is. */
  boxRows(from: number, to: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const near = Math.hypot(Math.max(x0, -x1, 0), Math.max(y0, -y1, 0), Math.max(z0, -z1, 0));
    const b = this.boxOf;
    for (let d = from; d < to; d++) {
      this.boxed[d] = 1;
      b[d * 6] = x0;
      b[d * 6 + 1] = y0;
      b[d * 6 + 2] = z0;
      b[d * 6 + 3] = x1;
      b[d * 6 + 4] = y1;
      b[d * 6 + 5] = z1;
      this.nearOf[d] = near;
    }
  }

  /** Gives draws `from` up to `to` the box round cells `c0` up to `c1` of `boxes` (six numbers a cell), each moved by (ox, oy, oz). */
  boxCells(from: number, to: number, boxes: Float32Array, c0: number, c1: number, ox: number, oy: number, oz: number): void {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = c0 * 6; k < c1 * 6; k += 6) {
      if (boxes[k]! > boxes[k + 3]!) continue;
      x0 = Math.min(x0, boxes[k]!);
      y0 = Math.min(y0, boxes[k + 1]!);
      z0 = Math.min(z0, boxes[k + 2]!);
      x1 = Math.max(x1, boxes[k + 3]!);
      y1 = Math.max(y1, boxes[k + 4]!);
      z1 = Math.max(z1, boxes[k + 5]!);
    }
    if (x0 <= x1) this.boxRows(from, to, x0 + ox, y0 + oy, z0 + oz, x1 + ox, y1 + oy, z1 + oz);
  }

  /** Keeps of the frame's draws from row `from` on those `rows` names, in its order: row k takes row rows[k], which is k or later. */
  keepRows(rows: Uint16Array, from: number, count: number): void {
    for (const a of this.columns) {
      const w = a.length / MAX_DRAWS;
      if (a instanceof Uint8Array) keep8(a, w, rows, from, count);
      else if (a instanceof Uint16Array) keep16(a, w, rows, from, count);
      else keep32(a, w, rows, from, count);
    }
    keep8(this.passOf, 1, rows, from, count);
    keep32(this.nearBits, 1, rows, from, count);
  }

  /**
   * Puts the draws in the order of the steps they are drawn in (packet.ts), each in the ranges `passOf` gives it, so a
   * draw in both is listed twice, and an opaque step's cut-out draws where `cutouts` says, each part of it nearest first by
   * NEAR_BUCKETS and in a bucket by what its draws bind (`byState`), unless they are to stay as made; and says where each
   * opaque step's ground goes: after its draws but the cut-outs, which a tiled GPU may then reject more of. A see-through
   * draw made ahead of an opaque one still goes after it, the rest staying as made. With `nearFirst` off the parts go by
   * what they bind alone and the ground first, and with one range as well they stay as made unless a cut-out is to move.
   */
  order(): void {
    const p = this.packet;
    const n = p.drawCount;
    const one = p.split <= 0;
    const made = this.cutouts === "made";
    // A cut-out's place and the rest's within the step, -1 for left out.
    const cutAt = this.cutouts === "last" ? 1 : this.cutouts === "none" ? -1 : 0;
    const restAt = this.cutouts === "first" ? 1 : 0;
    let sort = !made;
    p.groundAt.fill(0);
    if (one) {
      p.drawPass.fill(PASS_NEAR, 0, n);
      p.skyAt = n;
    }
    if (one && !this.nearFirst) {
      let cut = false, late = false;
      for (let d = 0, last = 0; d < n && !cut; d++) {
        const flags = p.drawFlags[d]!, place = placeOf(flags, PASS_NEAR, cutAt, restAt);
        cut = cutAt !== restAt && (flags & (DRAW_CUTOUT | DRAW_BLEND | DRAW_NEAR)) === DRAW_CUTOUT;
        late ||= place < last;
        if (place > last) last = place;
      }
      if (!cut && !late) return;
      sort &&= cut;
    }
    // Each draw's place in each range, -1 where it is not drawn in that range.
    const steps = this.steps;
    const starts = this.starts.fill(0);
    for (let d = 0; d < n; d++) {
      const flags = p.drawFlags[d]!;
      for (let range = PASS_NEAR; range <= PASS_FAR; range++) {
        const drawn = one ? range === PASS_NEAR : (this.passOf[d]! & (1 << range)) !== 0;
        const place = drawn ? placeOf(flags, range, cutAt, restAt) : -1;
        steps[d * 2 + range] = place;
        if (place >= 0) starts[place + 1]!++;
      }
    }
    for (let s = 1; s < starts.length; s++) starts[s]! += starts[s - 1]!;
    const total = starts[STEP_BODY + 3]!;
    p.skyAt = one ? total : starts[STEP_FAR_SEE + 2]!;
    for (let s = STEP_NEAR; s <= STEP_FAR; s++) p.groundAt[s] = this.nearFirst ? starts[s * 2 + restAt + 1]! : starts[s * 2]!;
    const source = this.source;
    const pass = this.sourcePass;
    let moved = total !== n;
    for (let d = 0; d < n; d++) {
      for (let range = PASS_NEAR; range <= PASS_FAR; range++) {
        const s = steps[d * 2 + range]!;
        if (s < 0) continue;
        const at = starts[s]!++;
        source[at] = d;
        pass[at] = range;
        moved ||= at !== d;
      }
    }
    // The opaque steps' places, near then far, two a step.
    if (sort) for (let s = 0, turns = 0; s < STEP_FAR * 2 + 2; s++) turns = this.byState(s === 0 ? 0 : starts[s - 1]!, starts[s]!, s % 2 === 0 ? 0 : turns, s >> 1);
    if (moved || sort) reorder(this.columns, MAX_DRAWS, n, total, source, this.copy);
    for (let k = 0; k < total; k++) p.drawPass[k] = pass[k]!;
    p.drawCount = total;
  }

  /**
   * Sorts places `from` to `to` of the order, in range `range`, nearest first by NEAR_BUCKETS where `nearFirst` is on, and
   * in a bucket by what their draws bind, so that each changes as little as it can of what the one before it bound: by
   * program, material and level, and then as made, which keeps a level's instances in the same order in each of its runs.
   * Every other run of a bucket's program and material, counted on from `turns`, is turned round, so that a level ends a
   * run on the instances it begins the next with. The runs counted so far.
   */
  private byState(from: number, to: number, turns: number, range: number): number {
    const p = this.packet;
    const keys = this.keys, source = this.source;
    const materials = this.assets.table.materials;
    const least = range === PASS_FAR ? p.split * FAR_FROM : 0;
    for (let k = from; k < to; k++) {
      const d = source[k]!;
      const flags = p.drawFlags[d]!;
      const program = (flags & DRAW_DETAILS) !== 0 ? PROGRAM.details : drawProgram(p, d, materials[p.drawMaterial[d]!]);
      keys[k] = stateKey(this.nearFirst ? bucketOf(Math.max(least, this.nearOf[d]!)) : 0, program, (flags & DRAW_TEXTURED) !== 0 ? p.drawMaterial[d]! : 0, p.drawSlot[d]!, d);
    }
    return sortRuns(keys, from, to, turns, source);
  }
}
