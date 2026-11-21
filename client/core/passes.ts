// Where a frame's GPU time goes. Where the browser has timer queries (EXT_disjoint_timer_query_webgl2) the clock times
// the whole frame, which `?bench=1` reports, or each pass the shell marks (client/shell/gl.ts), which `?bench=1&passes=1`
// reports; `?off=` turns effects off for a before and after in a real scene. On an Apple GPU through ANGLE a query
// between passes ends Metal's render pass, which a frame does not otherwise do, so what an effect costs is read off the
// whole frame. There a query also counts the time of whatever runs on the card beside the frame's own work: a frame of
// many passes, or one the card starts while the last is still drawing, reads long (a frame with the light target, by
// half again to twice). `?sync=1` times the frame on the page's clock instead, each frame waiting for the card to finish
// it, and `?ab=` draws every other frame with other effects off, so a before and after is read frame by frame in one run.

import type { Tier } from "./assets/tiers.ts";
import { HAND_NEAR } from "./render/hand.ts";
import { DRAW_WATER, FRAME, ROOF_AT, type FramePacket } from "./render/packet.ts";

/** A frame's passes in the order the shell draws them. The dome is drawn at the start of the far see-through step; the finish (render/post.ts) last, where a frame has one. */
export const PASSES = ["uploads", "casters", "near", "far", "dome", "far see-through", "near see-through", "body", "finish"] as const;
export const [PASS_UPLOADS, PASS_CASTERS, PASS_NEAR, PASS_FAR, PASS_DOME, PASS_FAR_SEE, PASS_NEAR_SEE, PASS_BODY, PASS_FINISH] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
/** The pass each of the frame's steps (packet.ts STEP_) begins. */
export const PASS_OF_STEP: readonly number[] = [PASS_NEAR, PASS_FAR, PASS_FAR_SEE, PASS_NEAR_SEE, PASS_BODY];

const TIME_ELAPSED = 0x88bf;
const GPU_DISJOINT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;
const READ_FRAMEBUFFER = 0x8ca8;
const READ_FRAMEBUFFER_BINDING = 0x8caa;
/** Frames whose results may be awaited at once. Older ones are given up. */
const WAITING_MOST = 8;

type Query = object | null;
export interface QueryGl {
  getExtension(name: string): unknown;
  getParameter(name: number): unknown;
  isContextLost(): boolean;
  createQuery(): Query;
  deleteQuery(q: Query): void;
  beginQuery(target: number, q: Query): void;
  endQuery(target: number): void;
  getQueryParameter(q: Query, name: number): unknown;
  bindFramebuffer(target: number, framebuffer: unknown): void;
  readPixels(x: number, y: number, width: number, height: number, format: number, type: number, out: Uint8Array): void;
}

export class PassClock {
  /** Whether this browser times the GPU. */
  readonly on: boolean;
  private readonly gl: QueryGl;
  /** Each pass timed by itself, or the frame as one. */
  private readonly each: boolean;
  /**
   * The page's clock in ms where the frame is timed whole on it, from its first mark until a pixel of the canvas comes
   * back: the read waits for everything the canvas's last pass depends on, which is the frame's every pass where it ends
   * on the canvas, as a frame does. Passes are not timed so: one drawn into a target of the shell's would not be waited for.
   */
  private readonly sync: (() => number) | null;
  private open = false;
  private began = 0;
  private frame: { pass: number; q: Query }[] = [];
  private readonly waiting: { pass: number; q: Query }[][] = [];
  private readonly clocked: number[][] = [];
  private readonly pixel = new Uint8Array(4);

  constructor(gl: QueryGl, each: boolean, sync: (() => number) | null = null) {
    this.gl = gl;
    this.each = each && !sync;
    this.sync = sync;
    this.on = sync !== null || gl.getExtension("EXT_disjoint_timer_query_webgl2") !== null;
  }

  /** Pass `pass` begins. Without `each` only the frame's first mark opens a query. */
  mark(pass: number): void {
    const gl = this.gl;
    if (!this.on || gl.isContextLost() || (this.open && !this.each)) return;
    if (this.sync) return void ([this.open, this.began] = [true, this.sync()]);
    if (this.open) gl.endQuery(TIME_ELAPSED);
    const q = gl.createQuery();
    gl.beginQuery(TIME_ELAPSED, q);
    this.frame.push({ pass, q });
    this.open = true;
  }

  /** The frame's draws are done. */
  end(): void {
    if (!this.open) return;
    this.open = false;
    if (this.gl.isContextLost()) return void (this.frame = []);
    if (this.sync) {
      const gl = this.gl, read = gl.getParameter(READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(READ_FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, 0x1908, 0x1401, this.pixel);
      gl.bindFramebuffer(READ_FRAMEBUFFER, read);
      return void this.clocked.push([this.sync() - this.began]);
    }
    this.gl.endQuery(TIME_ELAPSED);
    this.waiting.push(this.frame);
    this.frame = [];
    while (this.waiting.length > WAITING_MOST) this.forget(this.waiting.shift()!);
  }

  /** The frames whose times have come back, oldest first: ms by pass, or one number for the frame. A disjoint frame is left out. */
  take(): number[][] {
    const gl = this.gl;
    const out: number[][] = [];
    if (this.sync) return this.clocked.splice(0);
    if (!this.on) return out;
    // A lost context took the queries with it.
    if (gl.isContextLost()) return (this.reset(), out);
    const disjoint = Boolean(gl.getParameter(GPU_DISJOINT));
    while (this.waiting.length > 0 && gl.getQueryParameter(this.waiting[0]!.at(-1)!.q, QUERY_RESULT_AVAILABLE)) {
      const frame = this.waiting.shift()!;
      const ms: number[] = this.each ? PASSES.map(() => 0) : [0];
      for (const { pass, q } of frame) ms[this.each ? pass : 0] = ms[this.each ? pass : 0]! + Number(gl.getQueryParameter(q, QUERY_RESULT)) / 1e6;
      this.forget(frame);
      if (!disjoint) out.push(ms);
    }
    return out;
  }

  private reset(): void {
    this.open = false;
    this.frame = [];
    this.waiting.length = 0;
  }

  private forget(frame: { q: Query }[]): void {
    if (!this.gl.isContextLost()) for (const { q } of frame) this.gl.deleteQuery(q);
  }
}

/** Frames a `?bench=1` run measures, once the scene has had nothing on its way for STILL frames, or after SETTLE_MS whatever. */
export const BENCH_FRAMES = 900;
/** The bench's view turns once round in the time 900 frames take at 60 a second (App.autopilot). */
export const BENCH_TURN_MS = 15000;

/**
 * Effects `?off=` names, comma separated, for a before and after. "band" draws the near nodes in the hand-over without
 * its discard, "layers" draws hurt and dead bodies with the plain surface program, in the draws they have, "light"
 * draws a tier with a light target without it, each shader toning and grading onto the canvas, "bloom" finishes it with
 * no bloom (render/post.ts), "contact" holds no body's contact (render/contact.ts), and "facades" draws no facade's part
 * or mark, as before their atlases come (facade.ts). "hide"
 * draws what the frame finds wholly hidden (render/hide.ts), and "order" draws an opaque step's draws by what they bind
 * alone and its ground first, as they went before they went nearest first (render/scene.ts order). "edges" draws walls
 * with no worn edges, "road" the ground with no wear on asphalt and sand, and "walks" none on a walk (world-surfaces.ts). "nearmesh" draws the
 * near city's pieces as instances, none as a chunk's mesh (render/nearcity.ts). "roofs" takes no light down under what
 * stands overhead (render/roof.ts) and leaves the light from the ground as the sky's table has it; "bounce" leaves that
 * light alone. "moon" draws no cascades by night, as before the moon cast through them (render/sky.ts `castLight`).
 */
export const EFFECTS = ["shadows", "haze", "clouds", "water", "farblocks", "farnodes", "farcity", "band", "layers", "light", "bloom", "contact", "facades", "hide", "order", "edges", "lamps", "wires", "road", "walks", "nearmesh", "reflections", "roofs", "bounce", "moon"] as const;
export type Effect = (typeof EFFECTS)[number];

export function effectsOff(text: string | null): ReadonlySet<Effect> {
  return new Set(EFFECTS.filter((e) => (text ?? "").split(",").includes(e)));
}

const copies = new Map<Tier, Map<string, Tier>>();

/** The tier with the effects that live in it off, one copy a tier and set, since the renderer keeps programs by the tier. */
export function tierWithout(tier: Tier, off: ReadonlySet<Effect>): Tier {
  if (off.size === 0) return tier;
  const key = [...off].join();
  const mine = copies.get(tier) ?? copies.set(tier, new Map()).get(tier)!;
  let copy = mine.get(key);
  if (!copy) {
    copy = { ...tier };
    if (off.has("reflections")) copy = { ...copy, reflectionHz: 0 };
    if (off.has("shadows")) copy = { ...copy, shadows: { ...copy.shadows, cascades: 0 } };
    if (off.has("clouds")) copy = { ...copy, clouds: 0 };
    if (off.has("farblocks")) copy = { ...copy, reach: { ...copy.reach, bases: 0 } };
    if (off.has("farnodes")) copy = { ...copy, reach: { ...copy.reach, trees: 0, rocks: 0, bushes: 0 } };
    if (off.has("farcity")) copy = { ...copy, reach: { ...copy.reach, city: 0 } };
    if (off.has("light")) copy = { ...copy, post: null };
    if (off.has("bloom") && copy.post) copy = { ...copy, post: { ...copy.post, bloom: 0 } };
    mine.set(key, copy);
  }
  return copy;
}

/** The effects that live in how the scene builds a frame: what is hidden left out, the opaque draws nearest first, and the near city's meshes. */
export function sceneWithout(scene: { hide: boolean; nearFirst: boolean; nearMesh: boolean }, off: ReadonlySet<Effect>): void {
  scene.hide = !off.has("hide");
  scene.nearFirst = !off.has("order");
  scene.nearMesh = !off.has("nearmesh");
}

/** The effects that live in a built frame: the haze, bodies' contact, what stands overhead, the facades, the edges and the road's wear in its block, the sea's detail, the hand-over's discard and bodies' layers in its draws. */
export function packetWithout(p: FramePacket, off: ReadonlySet<Effect>): void {
  if (off.has("haze")) p.frame[FRAME.haze] = 0;
  if (off.has("contact")) p.frame.fill(0, FRAME.contact, FRAME.eyes);
  if (off.has("roofs")) p.frame[ROOF_AT + 3] = 0;
  if (off.has("bounce")) p.frame[ROOF_AT + 3] = Math.min(1, p.frame[ROOF_AT + 3]!);
  if (off.has("facades")) p.frame[FRAME.facade + 1] = 0;
  if (off.has("edges")) p.frame[FRAME.edgesOff] = 1;
  p.frame[FRAME.roadOff] = (off.has("road") ? 1 : 0) + (off.has("walks") ? 2 : 0);
  for (let d = 0; d < p.drawCount; d++) {
    if (off.has("water")) p.drawFlags[d] = p.drawFlags[d]! & ~DRAW_WATER;
    if (off.has("band") && p.drawHand[d] === HAND_NEAR) p.drawHand[d] = 0;
    if (off.has("layers")) p.drawLayer[d] = 0;
  }
}
