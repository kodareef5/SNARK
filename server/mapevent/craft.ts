// A craft of a map event on the server (planning/workstreams/map-events.md): a thing in the sky on the path its kind
// gave it, met by shots analytically (server/sky.ts), shielded as its spec says, brought down when its health is gone,
// and traced once as it falls to where it comes to rest. Every client works out the same flight from the feed.

import { TICK_RATE } from "../../shared/coords.ts";
import { DAMAGE_KINDS, type CraftLook, type CraftSpec } from "../../shared/mapevent/parts.ts";
import { lookKey, wireCraft } from "../../shared/mapevent/wire.ts";
import { FALL_MOST, buildTrack, fallPose, hullGap, lowAt, newCraftPose, rayHull, rayNearBox, trackPose, type CraftPose, type CraftTrack, type PathPoint } from "../../shared/sim/craft.ts";
import { DMG_COUNT } from "../../shared/sim/damage.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import type { Source } from "../combat.ts";
import type { SkyPoint, SkyTaken, SkyTarget } from "../sky.ts";
import type { ServerWorld } from "../world.ts";

/** Ticks between the places a fall is traced at: the cast between two finds where it meets the world. */
const FALL_STRIDE = 6;

/** What a craft is and what has befallen it. Ticks are the world's; its event's start is given where one is needed. */
export interface Craft {
  readonly id: number;
  /** Its spec with what the wire rounds already rounded: what is saved, and what a restart makes it again from. */
  readonly spec: CraftSpec;
  readonly look: CraftLook;
  /** Its look's key, for the feed's table of looks. */
  readonly lookKey: string;
  readonly points: readonly PathPoint[];
  readonly radius: number;
  readonly half: number;
  readonly gravity: number;
  readonly bleed: number;
  readonly track: CraftTrack;
  /** Ticks from its event's start to its entry, and ticks its path takes. */
  readonly after: number;
  readonly ticks: number;
  /** The share of each kind of damage it takes, by DMG_ index. */
  readonly takes: Float64Array;
  health: number;
  most: number;
  /** The tick its shield is broken until, and the tick it may be broken again from. */
  shieldUntil: number;
  rearm: number;
  /** The pid of the last to strike it, for the credit of bringing it down, or 0. */
  lastBy: number;
  /** The tick it was brought down at and came to rest at, or 0; where its underside came to rest; its way along the ground as it fell. */
  down: number;
  impact: number;
  rx: number;
  ry: number;
  rz: number;
  hx: number;
  hz: number;
  /** It has come to rest, and its kind has been told. */
  rested: boolean;
  /** It flew its path out, or was taken away: no more in the sky or the feed. */
  gone: boolean;
  /** How hurt it is as the feed tells it: 0 whole, 3 at a quarter of its health or less. */
  stage: number;
}

/** A craft made from its spec, which must have no faults (shared/mapevent/parts.ts craftFault). */
export function makeCraft(id: number, spec: CraftSpec): Craft {
  const w = wireCraft(spec);
  const rounded: CraftSpec = { ...spec, points: w.points, hull: { radius: w.radius, half: w.half }, fall: { gravity: w.gravity, bleed: w.bleed }, after: spec.after ?? 0 };
  const track = buildTrack(w.points);
  const takes = new Float64Array(DMG_COUNT).fill(1);
  for (const [name, share] of Object.entries(spec.takes ?? {})) takes[DAMAGE_KINDS[name as keyof typeof DAMAGE_KINDS]] = share ?? 1;
  return {
    id,
    spec: rounded,
    look: spec.look,
    lookKey: lookKey({ type: "craft", craft: spec.look }),
    points: w.points,
    radius: w.radius,
    half: w.half,
    gravity: w.gravity,
    bleed: w.bleed,
    track,
    after: spec.after ?? 0,
    ticks: Math.ceil(track.seconds * TICK_RATE),
    takes,
    health: spec.health,
    most: spec.health,
    shieldUntil: 0,
    rearm: 0,
    lastBy: 0,
    down: 0,
    impact: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    hx: 0,
    hz: 0,
    rested: false,
    gone: false,
    stage: 0,
  };
}

/** The stage the feed tells for a share of health left. */
export const stageOf = (health: number, most: number): number => {
  const left = most > 0 ? health / most : 0;
  return left > 0.75 ? 0 : left > 0.5 ? 1 : left > 0.25 ? 2 : 3;
};

export type CraftState = "coming" | "flying" | "falling" | "rest" | "gone";

/** Where a craft stands at tick `t` of an event that comes at `start`. */
export function craftState(c: Craft, start: number, t: number): CraftState {
  if (c.gone) return "gone";
  if (c.down > 0) return t < c.impact ? "falling" : "rest";
  const enter = start + c.after;
  if (t < enter) return "coming";
  return t <= enter + c.ticks ? "flying" : "gone";
}

/** Where a craft is at tick `t`, flying or falling, into `out`; at rest, where it lies. False before it comes and once gone. */
export function craftPose(c: Craft, start: number, t: number, out: CraftPose): boolean {
  const state = craftState(c, start, t);
  if (state === "coming" || state === "gone") return false;
  if (state === "rest") {
    out.x = c.rx;
    out.y = c.ry;
    out.z = c.rz;
    out.vx = out.vy = out.vz = out.low = 0;
    return true;
  }
  if (state === "falling") {
    trackPose(c.track, (c.down - start - c.after) / TICK_RATE, out);
    fallPose(out.x, out.y, out.z, out.vx, out.vy, out.vz, (t - c.down) / TICK_RATE, c.gravity, c.bleed, out);
    return true;
  }
  trackPose(c.track, (t - start - c.after) / TICK_RATE, out);
  return true;
}

/** What a hit did, and whether it brought the craft down: the engine's to act on. */
export interface Struck extends SkyTaken {
  /** The shield broke with this blow. */
  broke: boolean;
}

/**
 * A blow on a craft at `tick`: its shield stops its soak unless it flies low with its shield open there, or a heavy blow
 * has broken it. A heavy blow when it is shut and ready breaks it and goes through whole. `scale` is what modules made of
 * the blow (the bus's mapevent.damage), 1 where none did.
 */
export function strike(c: Craft, start: number, tick: number, src: Source, share: number, heavy: boolean, scale: number): Struck {
  const shield = c.spec.shield;
  let open = !shield || tick < c.shieldUntil;
  if (shield && !open && shield.openWhenLow && lowAt(c.track, (tick - start - c.after) / TICK_RATE) >= 0.5) open = true;
  let broke = false;
  if (shield && heavy && !open && tick >= c.rearm) {
    c.shieldUntil = tick + Math.round(shield.breakSeconds * TICK_RATE);
    c.rearm = c.shieldUntil + Math.round(shield.rearmSeconds * TICK_RATE);
    open = true;
    broke = true;
  }
  const amount = Math.max(0, src.base * src.quality * (src.far ?? 1) * src.draw * share * (c.takes[src.type] ?? 1) * scale);
  const soak = open || !shield ? 0 : shield.soak;
  const taken = amount * (1 - soak);
  c.health -= taken;
  if (src.by) c.lastBy = src.by.pid;
  return { taken, blocked: soak > 0 && amount > 0, killed: c.health <= 0, broke };
}

/**
 * Brings a craft down at `tick`: its fall is traced now, stride by stride, against the world and the water, to where its
 * underside first meets something; the feed then tells every client that tick and place once.
 */
export function fall(c: Craft, start: number, tick: number, world: ServerWorld): void {
  const enter = start + c.after;
  c.down = Math.max(tick, enter);
  const p = newCraftPose();
  trackPose(c.track, (c.down - enter) / TICK_RATE, p);
  const along = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  c.hx = along > 0.1 ? p.vx / along : 0;
  c.hz = along > 0.1 ? p.vz / along : 0;
  const hf = world.hf;
  const at = newCraftPose();
  let fx = p.x;
  let fy = p.y - c.half;
  let fz = p.z;
  const most = FALL_MOST * TICK_RATE;
  for (let k = FALL_STRIDE; ; k += FALL_STRIDE) {
    const ticks = k < most ? k : most;
    fallPose(p.x, p.y, p.z, p.vx, p.vy, p.vz, ticks / TICK_RATE, c.gravity, c.bleed, at);
    const tx = at.x;
    const ty = at.y - c.half;
    const tz = at.z;
    const dx = tx - fx;
    const dy = ty - fy;
    const dz = tz - fz;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const prev = ticks - FALL_STRIDE < 0 ? 0 : ticks - FALL_STRIDE;
    if (length > 0 && castWorld(world, fx, fy, fz, dx / length, dy / length, dz / length, length) !== HIT_NONE) {
      const f = rayHit.t / length;
      rest(c, fx + dx * f, fy + dy * f, fz + dz * f, prev + Math.round((ticks - prev) * f));
      return;
    }
    const outside = tx < 0 || tz < 0 || tx > hf.sizeX || tz > hf.sizeZ;
    const cx = tx < 0 ? 0 : tx > hf.sizeX ? hf.sizeX : tx;
    const cz = tz < 0 ? 0 : tz > hf.sizeZ ? hf.sizeZ : tz;
    const water = hf.waterAt(cx, cz);
    if (ty <= water) {
      // Into the water: it comes to rest floating where its underside met the surface.
      const f = fy - ty > 0 ? (fy - water) / (fy - ty) : 1;
      rest(c, fx + dx * f, water, fz + dz * f, prev + Math.round((ticks - prev) * f));
      return;
    }
    if (outside || ticks >= most) {
      // Off the map's edge, or still falling at the end of the longest fall: it comes down where it is.
      rest(c, cx, Math.max(hf.heightAt(cx, cz), water), cz, ticks);
      return;
    }
    fx = tx;
    fy = ty;
    fz = tz;
  }
}

function rest(c: Craft, x: number, y: number, z: number, ticks: number): void {
  c.impact = c.down + Math.max(1, ticks);
  c.rx = Math.round(x * 32) / 32;
  c.ry = Math.round(y * 32) / 32;
  c.rz = Math.round(z * 32) / 32;
  c.stage = 3;
}

/** What a craft is to the sky's hit tests while it flies: its path, at a tick. */
export class CraftSky implements SkyTarget {
  readonly name: string;
  readonly lockable: boolean;
  readonly radius: number;
  private readonly craft: Craft;
  private readonly startOf: () => number;
  private readonly onTake: (src: Source, share: number, heavy: boolean) => SkyTaken;
  private readonly pose = newCraftPose();

  constructor(craft: Craft, startOf: () => number, onTake: (src: Source, share: number, heavy: boolean) => SkyTaken) {
    this.craft = craft;
    this.name = craft.spec.name;
    this.lockable = craft.spec.lockable ?? false;
    this.radius = Math.max(craft.radius, craft.half) + 0.5;
    this.startOf = startOf;
    this.onTake = onTake;
  }

  at(t: number, out: SkyPoint): boolean {
    const c = this.craft;
    const enter = this.startOf() + c.after;
    if (c.gone || c.down > 0 || t < enter || t > enter + c.ticks) return false;
    trackPose(c.track, (t - enter) / TICK_RATE, this.pose);
    out.x = this.pose.x;
    out.y = this.pose.y;
    out.z = this.pose.z;
    out.vx = this.pose.vx;
    out.vy = this.pose.vy;
    out.vz = this.pose.vz;
    return true;
  }

  far(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
    return !rayNearBox(this.craft.track.box, this.radius, ox, oy, oz, dx, dy, dz, maxT);
  }

  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, t: number): number {
    const c = this.craft;
    const p = this.pose;
    if (!this.at(t, p)) return Infinity;
    return rayHull(p.x, p.y, p.z, c.radius, c.half, ox, oy, oz, dx, dy, dz, maxT);
  }

  gap(x: number, y: number, z: number, t: number): number {
    const p = this.pose;
    if (!this.at(t, p)) return Infinity;
    return hullGap(p.x, p.y, p.z, this.craft.radius, this.craft.half, x, y, z);
  }

  take(src: Source, share: number, heavy: boolean): SkyTaken {
    return this.onTake(src, share, heavy);
  }
}

/** What a saved craft keeps beyond its spec. */
export interface SavedCraft {
  id: number;
  spec: CraftSpec;
  health: number;
  most: number;
  shieldUntil: number;
  rearm: number;
  lastBy: number;
  down: number;
  impact: number;
  rest: [number, number, number, number, number];
  rested: boolean;
  gone: boolean;
}

export function saveCraft(c: Craft): SavedCraft {
  return { id: c.id, spec: c.spec, health: c.health, most: c.most, shieldUntil: c.shieldUntil, rearm: c.rearm, lastBy: c.lastBy, down: c.down, impact: c.impact, rest: [c.rx, c.ry, c.rz, c.hx, c.hz], rested: c.rested, gone: c.gone };
}

/** A craft made again from what was saved. Its spec was rounded when it was made, so rounding it again changes nothing. */
export function loadCraft(s: SavedCraft): Craft {
  const c = makeCraft(s.id, s.spec);
  c.health = s.health;
  c.most = s.most;
  c.shieldUntil = s.shieldUntil;
  c.rearm = s.rearm;
  c.lastBy = s.lastBy;
  c.down = s.down;
  c.impact = s.impact;
  [c.rx, c.ry, c.rz, c.hx, c.hz] = s.rest;
  c.rested = s.rested;
  c.gone = s.gone;
  c.stage = c.down > 0 ? 3 : stageOf(c.health, c.most);
  return c;
}
