// Textures the card makes from recipes (texgen): jobs that each fill layers of one RGBA8 array, drawn a frame's share
// at a time by the shell's primitive (client/shell/texgen.ts) as `Orders` say. Every layer is drawn first at an eighth
// of the side and read from at once, then whole, and the finer levels are eased in. A job is GLSL that gives a value at
// a point and its TypeScript twin, which the tests, the rasterizer and the card's check hold to the card. A layer has a
// version, which its reader asks for each frame: one whose version changes is made again while the rest are read.

import type { Tier } from "../assets/tiers.ts";
import type { QueryGl } from "../passes.ts";
import { NOISE_GLSL } from "./noise.ts";

export interface Job {
  /** Layers of the array it fills, after those of the jobs before it. */
  readonly layers: number;
  /** Bands a layer is drawn in, top to bottom, each with rows of its own. `pad` of a band at either end holds the band's edge. */
  readonly bands: number;
  readonly pad: number;
  /** Taps a pixel of the whole side takes, across and down; the first pass takes twice as many each way. */
  readonly taps: readonly [number, number];
  /** A tap's cost on the card, in units: a tap of the weathering's bays is 1. */
  readonly cost: number;
  /** vec4 rows of uniforms a band is drawn with, from uJob[2]. */
  readonly rows: number;
  /** Its layers are read only whole, so the first pass, which the rest come up from, leaves them. */
  readonly whole?: boolean;
  /** GLSL defining `vec4 made(vec2 at)`: the value at `at`, 0 to 1 across the band and down it. */
  readonly glsl: string;
  /** Band `band` of its layer `layer`'s rows at version `version` (Texgen.frame), into `out` from `at`. */
  fill(layer: number, band: number, out: Float32Array, at: number, version: number): void;
  /** `made`'s twin, into `out`. */
  made(layer: number, band: number, u: number, v: number, out: Float64Array, version: number): void;
}

/** Levels under the widest that the first pass is drawn at, and frames over which it comes up and the finer levels after it. */
export const TEXGEN_COARSE = 3;
export const TEXGEN_RISE = 20;
/** Units a frame draws where the card has no timer, by its tier's finishes, and the least and most it draws where it has. */
export const SLICE_LOW = 1 << 15, SLICE = 1 << 16;
const LEAST = 1 << 12, MOST = 1 << 22;
/** A frame's share of the card's time, ms, by the same. */
export const TARGET_LOW = 0.5, TARGET = 1;
export const MOST_DRAWS = 16;
/** Ints a draw takes in `Orders.draws`: its job, layer, level, first row, rows, and its uniforms' first float and floats. */
export const DRAW_INTS = 7;
const TIME_ELAPSED = 0x88bf, GPU_DISJOINT = 0x8fbb, QUERY_RESULT = 0x8866, QUERY_RESULT_AVAILABLE = 0x8867;

export const TEXGEN_VERTEX = `#version 300 es
void main() {
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}
`;

/** A job's program: its taps box-filter the pixel; `uJob[0]` is the level's side, the band's first row and rows and its pad, `uJob[1]` the taps. */
export const jobFragment = (job: Job): string => `#version 300 es
precision highp float;
precision highp int;
uniform vec4 uJob[${2 + job.rows}];
out vec4 o;
${NOISE_GLSL}${job.glsl}
void main() {
  vec4 e = uJob[0], t = uJob[1], sum = vec4(0.0);
  vec2 p = floor(gl_FragCoord.xy);
  for (int j = 0; j < 8; j++) {
    if (float(j) >= t.y) break;
    float v = ((p.y - e.y + (float(j) + 0.5) / t.y) / e.z - e.w) / (1.0 - 2.0 * e.w);
    for (int i = 0; i < 8; i++) {
      if (float(i) >= t.x) break;
      sum += made(vec2((p.x + (float(i) + 0.5) / t.x) / e.x, clamp(v, 0.0, 1.0)));
    }
  }
  o = clamp(sum / (t.x * t.y), 0.0, 1.0);
}
`;

/** Layer `layer` of `job` at `wide` a side as RGBA8, row 0 first, as the card draws it with `taps`: `jobFragment`'s twin. */
export function jobPixels(job: Job, layer: number, wide: number, taps: readonly [number, number] = job.taps, version = 1): Uint8Array {
  const out = new Uint8Array(wide * wide * 4), v = new Float64Array(4), sum = new Float64Array(4), rows = wide / job.bands;
  for (let py = 0; py < wide; py++) {
    const band = Math.floor(py / rows);
    for (let px = 0; px < wide; px++) {
      sum.fill(0);
      for (let j = 0; j < taps[1]; j++) {
        const w = ((py - band * rows + (j + 0.5) / taps[1]) / rows - job.pad) / (1 - 2 * job.pad);
        for (let i = 0; i < taps[0]; i++) {
          job.made(layer, band, (px + (i + 0.5) / taps[0]) / wide, Math.min(Math.max(w, 0), 1), v, version);
          for (let c = 0; c < 4; c++) sum[c]! += v[c]!;
        }
      }
      for (let c = 0; c < 4; c++) out[(py * wide + px) * 4 + c] = Math.round(Math.min(Math.max(sum[c]! / (taps[0] * taps[1]), 0), 1) * 255);
    }
  }
  return out;
}

/** One frame's making timed at a time, where the card has timer queries. */
class Timer {
  private q: object | null = null;
  private open = false;
  private units = 0;
  private readonly on: boolean;
  private readonly gl: QueryGl | null;
  constructor(gl: QueryGl | null) {
    this.gl = gl;
    this.on = gl?.getExtension("EXT_disjoint_timer_query_webgl2") != null;
  }
  get idle(): boolean {
    return this.on && this.q === null;
  }
  begin(): void {
    if (!this.idle) return;
    this.gl!.beginQuery(TIME_ELAPSED, (this.q = this.gl!.createQuery()));
    this.open = true;
  }
  end(units: number): void {
    if (!this.open) return;
    this.gl!.endQuery(TIME_ELAPSED);
    this.open = false;
    this.units = units;
  }
  /** The card's ns a unit of the frame timed, once it has come; -1 before, and where the card was disjoint or the context lost. */
  take(): number {
    const gl = this.gl!, q = this.q;
    if (q === null || this.open) return -1;
    if (gl.isContextLost()) return (this.q = null), -1;
    if (!gl.getQueryParameter(q, QUERY_RESULT_AVAILABLE)) return -1;
    const ns = gl.getParameter(GPU_DISJOINT) ? 0 : Number(gl.getQueryParameter(q, QUERY_RESULT));
    gl.deleteQuery(q);
    this.q = null;
    return ns > 0 && this.units > 0 ? ns / this.units : -1;
  }
}

/** What the shell is to draw this frame, and what it says back: the draws it carried out, a new array, a link that failed. */
export class Orders {
  /** The array's side and layers; a side of 0 for none. */
  side = 0;
  layers = 0;
  /** Each job's program, by the job's number in the draws. */
  readonly programs: readonly { vertex: string; fragment: string; defines: string; samplers: Record<string, number> }[];
  count = 0;
  /** DRAW_INTS for each draw. */
  readonly stride = DRAW_INTS;
  readonly draws = new Int32Array(MOST_DRAWS * DRAW_INTS);
  readonly uniforms: Float32Array;
  /** Once every draw is carried out: the base level, or -1 for as it is, and whether the levels under it are made from it. */
  base = -1;
  mipmap = false;
  minLod = 0;
  /** Units drawn by the end of each draw, and whether the frame is timed. */
  readonly units = new Float64Array(MOST_DRAWS);
  time = false;
  /** Set by the shell. */
  drawn = 0;
  fresh = false;
  broken = false;
  private readonly timer: Timer;
  constructor(jobs: readonly Job[], timer: Timer) {
    this.timer = timer;
    this.programs = jobs.map((job) => ({ vertex: TEXGEN_VERTEX, fragment: jobFragment(job), defines: "", samplers: {} }));
    this.uniforms = new Float32Array(MOST_DRAWS * 4 * (2 + Math.max(...jobs.map((j) => j.rows))));
  }
  begin(): void {
    if (this.time) this.timer.begin();
  }
  /** `drawn` of the draws were carried out. */
  end(drawn: number): void {
    this.drawn = drawn;
    this.timer.end(drawn > 0 ? this.units[drawn - 1]! : 0);
  }
}

/** The jobs' layers on the card, made as a frame's share of its time allows. */
/**
 * Who says the version wanted of each layer from frame to frame, where a job's layers change what they hold (slots.ts):
 * `near` is what it chooses by, `holds` what the card holds (Texgen `holds`), and it writes what a frame says of its choice into `out` from `at`.
 */
export interface Wants { readonly want: Int32Array; frame(near: ArrayLike<number>, holds: ArrayLike<number> | null, out: Float32Array, at: number): void }

export class Texgen {
  readonly orders: Orders;
  /** Each job's first layer. */
  readonly first: readonly number[];
  /** For each layer, the version it holds whole with every level, which a reader may take; 0 for none. */
  readonly holds: Int32Array;
  private readonly items: { job: number; layer: number; band: number }[] = [];
  private readonly timer: Timer;
  private side = 0;
  private off = false;
  /** The level being drawn, -1 for none; the items the pass draws, the next of them and its row; the first pass's level. */
  private level = -1;
  private readonly todo: Int32Array;
  private todoCount = -1;
  private item = 0;
  private row = 0;
  private coarse = 0;
  /** The version each layer is being drawn at. */
  private readonly drawing: Int32Array;
  /** The pass shown (0 none, 1 the first, 2 the whole), and frames since each. */
  private shown = 0;
  private risen = 0;
  private sharpened = 0;
  private idle = false;
  /** The card's ns a unit, smoothed; 0 until timed. */
  private rate = 0;
  /** Item and row after each of this frame's draws, and whether they end the pass. */
  private readonly after = new Int32Array(MOST_DRAWS * 2);
  private ends = false;

  private readonly jobs: readonly Job[];
  /** Who says the versions wanted of the layers that change what they hold, where a job has such. */
  readonly wants: Wants | null;
  constructor(jobs: readonly Job[], gl: QueryGl | null = null, wants: Wants | null = null) {
    this.jobs = jobs;
    this.wants = wants;
    let at = 0;
    this.first = jobs.map((job, j) => {
      for (let layer = 0; layer < job.layers; layer++) for (let band = 0; band < job.bands; band++) this.items.push({ job: j, layer, band });
      return (at += job.layers) - job.layers;
    });
    this.timer = new Timer(gl);
    this.orders = new Orders(jobs, this.timer);
    this.orders.layers = at;
    this.holds = new Int32Array(at);
    this.drawing = new Int32Array(at);
    this.todo = new Int32Array(this.items.length);
  }

  /** From 0 until the first pass is made to 1 once it has come up. */
  get ready(): number {
    return this.risen / TEXGEN_RISE;
  }
  /** Every layer asked for made and eased in. */
  get done(): boolean {
    return this.shown === 2 && this.sharpened === TEXGEN_RISE && this.idle;
  }

  /**
   * Orders that draw a pixel with each job's program into an array a pixel wide, which the shell carries out while the
   * world loads, so that the card makes each program's pipeline then and no frame of play waits for it.
   */
  warm(): Orders {
    const o = this.orders;
    this.side = -1;
    o.side = 1;
    o.count = this.jobs.length;
    o.base = -1;
    o.mipmap = o.time = false;
    o.uniforms.fill(0, 0, 8);
    o.uniforms[0] = o.uniforms[2] = o.uniforms[4] = o.uniforms[5] = 1;
    for (let j = 0; j < this.jobs.length; j++) o.draws.set([j, this.first[j]!, 0, 0, 1, 0, 8], j * DRAW_INTS);
    return o;
  }

  /**
   * This frame's orders for the array `side` wide, 0 for none, on `tier`, timed where `timed` and the card can.
   * `versions` is the version wanted of each layer, 1 where none is given and 0 for a layer to leave: a layer whose
   * version is not the one it holds is made again, whole, once the first two passes are through.
   */
  frame(want: number, tier: Tier, timed: boolean, versions: ArrayLike<number> | null = null): Orders {
    const o = this.orders;
    if (o.broken) this.off = true;
    const side = this.off ? 0 : want;
    if (o.fresh || side !== this.side) this.restart(side);
    else if (o.drawn > 0) {
      this.item = this.after[(o.drawn - 1) * 2]!;
      this.row = this.after[(o.drawn - 1) * 2 + 1]!;
      if (o.drawn === o.count && this.ends) this.passed();
    }
    o.fresh = this.ends = o.mipmap = false;
    o.drawn = o.count = 0;
    o.base = -1;
    if (this.shown > 0) this.risen = Math.min(TEXGEN_RISE, this.risen + 1);
    if (this.shown === 2) this.sharpened = Math.min(TEXGEN_RISE, this.sharpened + 1);
    o.minLod = this.shown === 2 ? this.coarse * (1 - this.sharpened / TEXGEN_RISE) : 0;
    const ns = this.timer.take();
    if (ns > 0) this.rate = this.rate > 0 ? this.rate + (ns - this.rate) * 0.3 : ns;
    o.time = timed && this.timer.idle;
    if (side > 0 && this.todoCount < 0) this.list(versions);
    this.idle = this.level < 0;
    if (this.level < 0) return o;
    const low = tier.finishes < 1024, wide = side >> this.level, stride = o.uniforms.length / MOST_DRAWS;
    let left = this.rate > 0 ? Math.min(MOST, Math.max(LEAST, ((low ? TARGET_LOW : TARGET) * 1e6) / this.rate)) : low ? SLICE_LOW : SLICE;
    let item = this.item, row = this.row, spent = 0;
    while (item < this.todoCount && o.count < MOST_DRAWS) {
      const it = this.items[this.todo[item]!]!, job = this.jobs[it.job]!, rows = wide / job.bands, k = this.level ? 2 : 1;
      const tx = job.taps[0] * k, ty = job.taps[1] * k, perRow = wide * tx * ty * job.cost;
      const n = Math.min(rows - row, Math.floor(left / perRow) || (o.count ? 0 : 1));
      if (n <= 0) break;
      const d = o.count * DRAW_INTS, u = o.count * stride, layer = this.first[it.job]! + it.layer;
      o.draws[d] = it.job;
      o.draws[d + 1] = layer;
      o.draws[d + 2] = this.level;
      o.draws[d + 3] = it.band * rows + row;
      o.draws[d + 4] = n;
      o.draws[d + 5] = u;
      o.draws[d + 6] = (2 + job.rows) * 4;
      o.uniforms[u] = wide;
      o.uniforms[u + 1] = it.band * rows;
      o.uniforms[u + 2] = rows;
      o.uniforms[u + 3] = job.pad;
      o.uniforms[u + 4] = tx;
      o.uniforms[u + 5] = ty;
      o.uniforms[u + 6] = o.uniforms[u + 7] = 0;
      job.fill(it.layer, it.band, o.uniforms, u + 8, this.drawing[layer]!);
      left -= n * perRow;
      o.units[o.count] = spent += n * perRow;
      row += n;
      if (row === rows) {
        row = 0;
        item++;
      }
      this.after[o.count * 2] = item;
      this.after[o.count * 2 + 1] = row;
      o.count++;
    }
    if (item === this.todoCount) {
      this.ends = true;
      o.base = this.level;
      o.mipmap = true;
      if (this.level === 0 && this.shown < 2) o.minLod = this.coarse;
    }
    return o;
  }

  /** Lists what the next pass draws: every layer whose version wanted is not the one it holds, at that version. None begins a pass only before the first. */
  private list(versions: ArrayLike<number> | null): void {
    let n = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!, layer = this.first[it.job]! + it.layer, v = versions && layer < versions.length ? versions[layer]! : 1;
      if (v === 0 || v === this.holds[layer] || (this.level > 0 && this.jobs[it.job]!.whole)) continue;
      this.drawing[layer] = v;
      // A layer made again is not read while it is drawn.
      if (this.level < 0) this.holds[layer] = 0;
      this.todo[n++] = i;
    }
    if (n === 0 && this.level < 0) return;
    this.todoCount = n;
    if (this.level < 0) this.level = 0;
    this.item = this.row = 0;
  }

  private passed(): void {
    if (this.level === 0) for (let t = 0; t < this.todoCount; t++) {
      const it = this.items[this.todo[t]!]!, layer = this.first[it.job]! + it.layer;
      this.holds[layer] = this.drawing[layer]!;
    }
    this.shown = this.level > 0 ? 1 : 2;
    this.level = this.level > 0 ? 0 : -1;
    this.todoCount = -1;
    this.item = this.row = 0;
  }

  private restart(side: number): void {
    this.side = this.orders.side = side;
    this.coarse = side ? Math.max(0, Math.min(TEXGEN_COARSE, 31 - Math.clz32(side) - 6)) : 0;
    this.level = side ? this.coarse : -1;
    this.todoCount = -1;
    this.holds.fill(0);
    this.item = this.row = this.shown = this.risen = this.sharpened = 0;
  }
}
