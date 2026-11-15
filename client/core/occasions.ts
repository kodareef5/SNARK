// What creatures do that others see, read from what a client already has of them: the cue word and pose state their
// snapshots carry (shared/anim/pose.ts), the deaths it saw (ragdoll.ts), the shots it flew (shots.ts) and the gait each
// is drawn with. Nothing is sent for it and nothing here touches the simulation. Small details answer these
// (client/core/details/); sound may answer them too. A body is followed from when it is first seen, and what it was
// doing then is no occasion.

import { CreatureAnim, advanceCreature, idleOf } from "../../shared/anim/creature.ts";
import { Gait } from "../../shared/anim/gait.ts";
import { socketDips } from "../../shared/anim/moments.ts";
import { AnimState, CUE_DEAD, CUE_LAND, CUE_NONE, CUE_TORPOR, LAYER_FLINCH, SPEED_STEP, bodySeed } from "../../shared/anim/pose.ts";
import type { Occasion } from "../../shared/pack/details.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import type { Corpse } from "./ragdoll.ts";
import type { RemoteSample } from "./session.ts";

/** A body leaving a survivor's arms in the air at this speed or more is thrown, not put down. Metres a second. */
const THROWN_SPEED = 2.4;
/** A striker is this near a struck body, and began its blow at most this many ticks before the flinch. */
const STRIKE_REACH = 4;
const STRIKE_TICKS = 12;
/** A shot is the blow when it ended this near the body's middle, this many milliseconds before the flinch was seen. */
const SHOT_NEAR = 1.2;
const SHOT_MS = 700;
/** Steps and pecks are followed within these metres of the eye. */
const STEP_REACH = 15;
const PECK_REACH = 12;
/** A remote body flag: a prop, which does nothing. */
const PROP = 8;

export interface Happening {
  occasion: Occasion;
  id: number;
  kind: number;
  /** The tick it happened at, whole or not. */
  tick: number;
  /** Where the body was when it was seen to happen, in the world, its yaw in radians and its size. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  /** Its pose words as they were, and whether it stood on something. */
  anim: number;
  cue: number;
  grounded: boolean;
  /** Its six colour regions, 0 for the species' own. */
  colours: Uint8Array;
  /** For `struck`: where the blow came from, a point in the world, NaN where nobody was seen to strike it. */
  fromX: number;
  fromY: number;
  fromZ: number;
  /** For `step`, the bone of the foot that came down; -1 for any other. */
  foot: number;
  /** For `death`, the body as it falls. */
  corpse: Corpse | null;
}

/** A shot's end as shots.ts saw it: where its last piece began, which way it went, and when, in milliseconds. */
export interface ShotEnd {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  at: number;
}

/** The viewer, who may be the striker. */
export interface Viewer {
  x: number;
  y: number;
  z: number;
  readonly state: AnimState;
}

class Seen {
  frame = 0;
  anim = 0;
  cue = 0;
  /** The turn of its idle it stood in, -1 while it was not standing. */
  slot = -1;
  readonly gait = new Gait();
}

export class Occasions {
  /** What happened since the last update. Read it before the next. */
  readonly happened: Happening[] = [];
  private readonly bodies = new Map<number, Seen>();
  private readonly corpses = new Set<number>();
  private readonly st = new AnimState();
  private readonly was = new AnimState();
  private readonly other = new AnimState();
  private frame = 0;
  /** By kind, the occasions anything answers, a bit each in OCCASIONS's order; 0 leaves the kind alone. */
  private readonly listens: Uint16Array;
  private readonly anims: readonly (CreatureAnim | null)[];
  /** By kind and idle variant (CreatureAnim.idles), the seconds into it its beak meets the ground. */
  private readonly pecks: (readonly (readonly number[])[] | null)[];
  private readonly bit: (o: Occasion) => number;

  /** `bit` gives an occasion's bit in `listens`. */
  constructor(anims: readonly (CreatureAnim | null)[], listens: Uint16Array, bit: (o: Occasion) => number) {
    this.anims = anims;
    this.listens = listens;
    this.bit = bit;
    this.pecks = anims.map((a, kind) => (a && (listens[kind]! & bit("peck")) !== 0 ? a.idles.map((clip) => (/\/idle_peck$/.test(clip.id) ? socketDips(a.rig, clip, "beak_tip") : [])) : null));
  }

  /**
   * Reads what the bodies of `remote` did since the last update, and the deaths among `corpses`, seen from (ex, ey, ez).
   * `shots` are the ends of shots lately flown and `viewer` the viewer's own body, either of which may have struck one.
   */
  update(remote: RemoteSample, corpses: readonly Corpse[], shots: readonly ShotEnd[], viewer: Viewer | null, ex: number, ey: number, ez: number, nowMs: number): void {
    const out = this.happened;
    out.length = 0;
    const frame = ++this.frame;
    const st = this.st;
    const was = this.was;
    const tick = remote.tick;
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      const listens = this.listens[kind] ?? 0;
      if (listens === 0 || (remote.flags[i]! & PROP) !== 0 || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
      const id = remote.id[i]!;
      let b = this.bodies.get(id);
      const first = !b;
      if (!b) this.bodies.set(id, (b = new Seen()));
      b.frame = frame;
      st.unpack(remote.anim[i]!, remote.cue[i]!);
      st.seed = bodySeed(id);
      const happen = (occasion: Occasion, at: number): Happening | null => {
        if ((listens & this.bit(occasion)) === 0) return null;
        const h: Happening = {
          occasion, id, kind, tick: at, x: remote.x[i]!, y: remote.y[i]!, z: remote.z[i]!, yaw: remote.yaw[i]!, size: 1, anim: remote.anim[i]!, cue: remote.cue[i]!,
          grounded: st.grounded, colours: remote.colors.slice(i * 6, i * 6 + 6), fromX: NaN, fromY: NaN, fromZ: NaN, foot: -1, corpse: null,
        };
        out.push(h);
        return h;
      };
      if (!first) {
        was.unpack(b.anim, b.cue);
        const cueChanged = (remote.cue[i]! & 0xffe) !== (b.cue & 0xffe);
        if (cueChanged && st.cue === CUE_LAND) happen("land", started(tick, st.cueStart));
        else if (cueChanged && st.cue === CUE_TORPOR) happen(st.out ? "down" : "up", started(tick, st.cueStart));
        // One knocked out has no landing cue, so its landing is read from its state.
        if (st.out && st.grounded && !was.grounded && was.out) happen("land", tick);
        if (((remote.cue[i]! >>> 12) & 0x3ff) !== ((b.cue >>> 12) & 0x3ff) && st.layer === LAYER_FLINCH) {
          const h = happen("struck", started(tick, st.layerStart));
          if (h) this.striker(h, remote, i, shots, viewer, nowMs);
        }
        if (was.held && !st.held && !st.grounded && st.speed * SPEED_STEP >= THROWN_SPEED) happen("thrown", tick);
        if (was.mode !== MODE_SWIM && st.mode === MODE_SWIM && !was.grounded) happen("splash", tick);
      }
      b.anim = remote.anim[i]!;
      b.cue = remote.cue[i]!;
      const anim = this.anims[kind];
      if (!anim) continue;
      const d = Math.hypot(remote.x[i]! - ex, remote.y[i]! - ey, remote.z[i]! - ez);
      if ((listens & this.bit("peck")) !== 0) this.peck(kind, anim, b, st, tick, first || d > PECK_REACH, (at) => happen("peck", at));
      if ((listens & this.bit("step")) !== 0 && d < STEP_REACH) this.step(anim, b, st, tick, remote.x[i]!, remote.z[i]!, remote.yaw[i]!, (at, foot) => {
        const h = happen("step", at);
        if (h) h.foot = foot;
      });
    }
    for (const [id, b] of this.bodies) if (b.frame !== frame) this.bodies.delete(id);
    for (const c of corpses) {
      if (this.corpses.has(c.id)) continue;
      this.corpses.add(c.id);
      if (!c.watched || c.lying || (this.listens[c.kind]! & this.bit("death")) === 0) continue;
      out.push({ occasion: "death", id: c.id, kind: c.kind, tick: c.born, x: c.x, y: c.y, z: c.z, yaw: c.yaw, size: c.size, anim: 0, cue: 0, grounded: true, colours: c.colors.slice(), fromX: NaN, fromY: NaN, fromZ: NaN, foot: -1, corpse: c });
    }
    if (this.corpses.size > corpses.length * 2 + 64) {
      const now = new Set(corpses.map((c) => c.id));
      for (const id of this.corpses) if (!now.has(id)) this.corpses.delete(id);
    }
  }

  /** Who struck the body at `i`: the nearest body or the viewer whose blow began just before, else a shot that ended at it. */
  private striker(h: Happening, remote: RemoteSample, i: number, shots: readonly ShotEnd[], viewer: Viewer | null, nowMs: number): void {
    const o = this.other;
    const [x, y, z] = [remote.x[i]!, remote.y[i]!, remote.z[i]!];
    const flinch = Math.floor(h.tick) & 255;
    let best = STRIKE_REACH;
    const consider = (sx: number, sy: number, sz: number, act: number, start: number, slack: number): void => {
      if (act === ACT_NONE || ((flinch - start) & 255) > STRIKE_TICKS + slack) return;
      const d = Math.hypot(sx - x, sz - z);
      if (d >= best) return;
      best = d;
      [h.fromX, h.fromY, h.fromZ] = [sx, sy + 1, sz];
    };
    for (let k = 0; k < remote.count; k++) {
      if (k === i) continue;
      o.unpack(remote.anim[k]!, remote.cue[k]!);
      consider(remote.x[k]!, remote.y[k]!, remote.z[k]!, o.action & 7, o.actionStart, 0);
    }
    // The viewer's own blow is on its own clock, ahead of the bodies it sees.
    if (viewer) consider(viewer.x, viewer.y, viewer.z, viewer.state.action & 7, viewer.state.actionStart, 8);
    if (h.fromX === h.fromX) return;
    for (const s of shots) {
      if (nowMs - s.at > SHOT_MS) continue;
      // The nearest the shot came to the body's middle.
      const [cx, cy, cz] = [x - s.x, y + 0.4 - s.y, z - s.z];
      const along = Math.max(0, cx * s.dx + cy * s.dy + cz * s.dz);
      if (Math.hypot(cx - s.dx * along, cy - s.dy * along, cz - s.dz * along) > SHOT_NEAR) continue;
      [h.fromX, h.fromY, h.fromZ] = [s.x, s.y, s.z];
      return;
    }
  }

  /** At each turn of its idle that it stands through, the idle chosen may be a peck at the ground. */
  private peck(kind: number, a: CreatureAnim, b: Seen, st: AnimState, tick: number, quiet: boolean, happen: (at: number) => void): void {
    const standing = st.speed === 0 && st.grounded && !st.out && !st.held && st.mode !== MODE_SWIM && (st.action & 7) === ACT_NONE && st.cue === CUE_NONE;
    if (!standing || a.idles.length === 0) {
      b.slot = -1;
      return;
    }
    const t = Math.floor(tick) + st.seed;
    const slot = Math.floor(t / a.slot);
    if (slot !== b.slot && b.slot >= 0 && !quiet) {
      const which = idleOf(a, st.seed, t);
      const dips = which >= 0 ? (this.pecks[kind]?.[which] ?? []) : [];
      // The turn began at slot * a.slot in its own clock, which is the tick plus its seed.
      for (const s of dips) happen(slot * a.slot - st.seed + s * TICK_RATE);
    }
    b.slot = slot;
  }

  /** A foot coming down: where the gait, moved on by the ground covered, passes the plant of either foot, running. */
  private step(a: CreatureAnim, b: Seen, st: AnimState, tick: number, x: number, z: number, yaw: number, happen: (at: number, foot: number) => void): void {
    const g = b.gait;
    const before = g.phase;
    const gap = tick - g.tick;
    advanceCreature(a, g, st, tick, x, z, yaw, 1);
    if (!(gap > 0 && gap <= 4) || !st.grounded || st.mode === MODE_SWIM || st.speed * SPEED_STEP < a.runAt || a.rig.feet.length < 2) return;
    const moved = g.phase - before + (g.phase < before ? 1 : 0);
    if (moved <= 0 || moved >= 0.5) return;
    if (before < 0.5 && before + moved >= 0.5) happen(tick, a.rig.feet[1]!);
    else if (before + moved >= 1) happen(tick, a.rig.feet[0]!);
  }
}

/** The whole tick a cue began at, from the low byte `start` of it and the tick now. */
function started(tick: number, start: number): number {
  const whole = Math.floor(tick);
  const s = ((whole & 255) - start) & 255;
  return whole - (s > 250 ? 0 : s);
}
