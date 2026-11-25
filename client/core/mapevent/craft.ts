// A craft as the client draws it (planning/workstreams/map-events.md): where it is at a tick from the row it was told,
// flying its path, falling once brought down, or at rest in its wreck, and the draws that show it. Its pieces turn at
// their own rates and lean into its way; its glow is its look's, flickering white while its shield is broken and
// guttering to its ember as it falls; it is never drawn smaller than a few pixels. Its beam reaches the ground on its
// low passes, and smoke stands over its wreck, thinning once its event has ended.

import { TICK_RATE } from "../../../shared/coords.ts";
import { fallPose, newCraftPose, trackPose, type CraftPose } from "../../../shared/sim/craft.ts";
import { DRAW_BLEND } from "../render/packet.ts";
import type { EventKit } from "../render/passes/map-events.ts";
import { MESH_FALLBACK, MESH_WRECK, type ShownCraft } from "./shown.ts";

/** Not yet in the world; in the sky on its path; brought down and falling; at rest in its wreck; flown out, or over. */
export const CRAFT_COMING = 0;
export const CRAFT_FLYING = 1;
export const CRAFT_FALLING = 2;
export const CRAFT_REST = 3;
export const CRAFT_GONE = 4;

/** The share of its distance a craft is never drawn smaller than across: about six pixels of a screen 1,080 high. */
export const SIZE_FLOOR = 0.006;
/** The share of their distance a beam's and a smoke's radius never fall under: two or three pixels across. */
const BEAM_FLOOR = 0.0012;
const SMOKE_FLOOR = 0.002;
/** Seconds the smoke over a wreck takes to thin to nothing once its event has ended. */
export const SMOKE_FADE = 12;
/** Seconds a falling craft takes to tip over. */
const TIP_SECONDS = 2;
/** A turn about its up that sets each craft's pieces apart from another's: the golden angle, by its ids. */
const GOLDEN = 2.399963;
const scratch = newCraftPose();

/** Where a craft is at `tick` into `out`, and which of CRAFT_ it is doing. */
export function craftAt(c: ShownCraft, tick: number, out: CraftPose): number {
  const row = c.row, enter = c.event.start + row.after;
  if (row.down > 0 && tick >= row.down) {
    if (tick >= row.impact) {
      out.x = row.rx;
      out.y = row.ry;
      out.z = row.rz;
      out.vx = out.vy = out.vz = out.low = 0;
      return CRAFT_REST;
    }
    trackPose(c.track, (row.down - enter) / TICK_RATE, out);
    fallPose(out.x, out.y, out.z, out.vx, out.vy, out.vz, (tick - row.down) / TICK_RATE, row.gravity, row.bleed, out);
    return CRAFT_FALLING;
  }
  if (tick < enter) {
    trackPose(c.track, 0, out);
    return CRAFT_COMING;
  }
  if (c.event.ended > 0 && tick >= c.event.ended) return CRAFT_GONE;
  return trackPose(c.track, (tick - enter) / TICK_RATE, out) ? CRAFT_FLYING : CRAFT_GONE;
}

/** craftAt into the craft's own pose, worked out once for a tick: the pass and the sounds share it. */
export function poseOf(c: ShownCraft, tick: number): number {
  if (c.atTick !== tick) {
    c.atTick = tick;
    c.state = craftAt(c, tick, c.at);
  }
  return c.state;
}

/** The way a downed craft was going as it was brought down, an angle from +Z: its wreck lies that way. */
export function wayOf(c: ShownCraft): number {
  if (Number.isNaN(c.way)) {
    trackPose(c.track, (c.row.down - c.event.start - c.row.after) / TICK_RATE, scratch);
    c.way = scratch.vx * scratch.vx + scratch.vz * scratch.vz > 0.01 ? Math.atan2(scratch.vx, scratch.vz) : 0;
  }
  return c.way;
}

/** How far a wreck's smoke still stands once its event has ended, 1 to 0. */
export const smokeLeft = (c: ShownCraft, tick: number): number => (c.event.ended > 0 ? 1 - (tick - c.event.ended) / (SMOKE_FADE * TICK_RATE) : 1);

/** Finds the meshes a craft's look names in the pack, each time a message comes. */
export function findCraft(k: EventKit, c: ShownCraft): void {
  const t = k.assets.table, look = c.look, m = c.meshes;
  for (let i = 0; i < 4; i++) m[i] = i < look.pieces.length ? t.find(look.pieces[i]!.mesh) : -1;
  m[MESH_FALLBACK] = look.fallback === "" ? -1 : t.find(look.fallback);
  m[MESH_WRECK] = look.wreck === "" ? -1 : t.find(look.wreck);
}

/** The mesh drawn as a craft's first piece: its own, else its look's fallback, else the stand-in; the first held of those, else the first there is. */
function firstMesh(k: EventKit, c: ShownCraft): number {
  const own = c.meshes[0]!, fallback = c.meshes[MESH_FALLBACK]!;
  if (k.held(own)) return own;
  if (k.held(fallback)) return fallback;
  if (k.held(k.disc)) return k.disc;
  return own >= 0 ? own : fallback >= 0 ? fallback : k.disc;
}

/** From the moment it is told of, the coarsest of everything it may draw is wanted, so it is there when it comes. */
export function wantCraft(k: EventKit, c: ShownCraft, tick: number): void {
  const state = poseOf(c, tick);
  if (state === CRAFT_GONE || state === CRAFT_REST) return;
  const cam = k.f.cam, p = c.at;
  const far = Math.sqrt((p.x - cam.x) * (p.x - cam.x) + (p.y - cam.y) * (p.y - cam.y) + (p.z - cam.z) * (p.z - cam.z));
  for (let i = 0; i < c.meshes.length; i++) k.wantCoarsest(c.meshes[i]!, far);
  k.wantCoarsest(k.disc, far);
  if (c.look.beam || c.look.smoke) k.wantCoarsest(k.cone, far);
}

/** Its glow's colour at `tick`: broken, it flickers white; badly hurt, it gutters now and then; falling, often; at rest it is ember. */
function glowOf(c: ShownCraft, state: number, tick: number): number {
  const look = c.look, row = c.row, t = Math.floor(tick);
  if (state === CRAFT_REST) return look.ember;
  if (state === CRAFT_FALLING) return (t & 4) === 0 ? look.ember : look.glow;
  if (tick < row.shieldUntil && (t & 2) === 0) return look.broken;
  if (row.stage >= 2 && t % (row.stage === 3 ? 17 : 41) < 2) return look.ember;
  return look.glow;
}

export function drawCraft(k: EventKit, c: ShownCraft, tick: number): void {
  const state = poseOf(c, tick);
  if (state === CRAFT_COMING || state === CRAFT_GONE) return;
  const cam = k.f.cam, pose = c.at, row = c.row, look = c.look;
  const x = pose.x - cam.x, y = pose.y - cam.y, z = pose.z - cam.z;
  const far = Math.sqrt(x * x + y * y + z * z);
  if (state === CRAFT_REST) {
    const left = smokeLeft(c, tick);
    if (left <= 0.02) return;
    if (look.smoke) {
      // Its smoke stands over the map from where it lies, and thins once its event has ended.
      const tall = look.smoke.height * (0.55 + 0.45 * left);
      const wide = Math.max(look.smoke.wide * 0.5, far * SMOKE_FLOOR) * (0.6 + 0.4 * left);
      k.turn(0, 1, 0, 0);
      if (k.put(k.cone, x, y, z, wide, tall, Math.max(wide, tall * 0.5), 0.5, k.tint(look.smoke.rgb), DRAW_BLEND, 0.2 + 0.8 * (1 - left))) k.smokes++;
    }
  }
  const size = Math.max(1, (far * SIZE_FLOOR) / (2 * row.radius));
  const dye = k.tint(glowOf(c, state, tick));
  const way = state === CRAFT_FLYING ? 0 : wayOf(c);
  const hx = Math.sin(way), hz = Math.cos(way);
  const wreck = c.meshes[MESH_WRECK]!;
  if (state === CRAFT_REST && wreck >= 0 && (k.held(wreck) || !k.held(firstMesh(k, c)))) {
    // Its wreck as it lies, modelled tilted on the ground, ahead along its way down.
    k.turn(0, 1, 0, way);
    if (k.put(wreck, x, y, z, size, size, (Math.max(k.assets.table.radius[wreck]!, row.radius) + 0.5) * size, 0, dye, 0)) {
      k.place(pose.x, pose.y, pose.z);
      k.craft++;
    }
    return;
  }
  // It leans into its way; falling, it tips over onto its right; at rest it lies on its rim, nose down.
  let ux = pose.vx * look.lean, uy = 1, uz = pose.vz * look.lean;
  if (state === CRAFT_FALLING) {
    const tip = Math.min(1, (tick - row.down) / (TIP_SECONDS * TICK_RATE));
    ux += (0.55 * hz + 0.25 * hx) * tip;
    uz += (-0.55 * hx + 0.25 * hz) * tip;
  } else if (state === CRAFT_REST) {
    ux = 0.45 * hz + 0.2 * hx;
    uz = -0.45 * hx + 0.2 * hz;
    uy = 1;
  }
  const base = ((c.event.id * 7 + row.id) * GOLDEN) % (2 * Math.PI);
  const first = firstMesh(k, c);
  let drawn = false;
  if (first === k.disc) {
    // The stand-in is a disc a metre round and through, drawn to the hull's size.
    k.turn(ux, uy, uz, base);
    drawn = k.put(first, x, y, z, row.radius * size, row.half * size, (Math.max(row.radius, row.half) + 0.5) * size * 1.3, 0, dye, 0);
  } else if (first !== c.meshes[0]) {
    k.turn(ux, uy, uz, base);
    drawn = k.put(first, x, y, z, size, size, (Math.max(k.assets.table.radius[first]!, row.radius) + 0.5) * size, 0, dye, 0);
  } else {
    const seconds = state === CRAFT_REST ? 0 : tick / TICK_RATE;
    const pieces = state === CRAFT_REST ? 1 : look.pieces.length;
    for (let i = 0; i < pieces; i++) {
      const mesh = c.meshes[i]!;
      if (mesh < 0) continue;
      k.turn(ux, uy, uz, base + seconds * look.pieces[i]!.spin);
      if (k.put(mesh, x, y, z, size, size, (Math.max(k.assets.table.radius[mesh]!, row.radius) + 0.5) * size, 0, dye, 0)) drawn = true;
    }
  }
  if (drawn) {
    k.place(pose.x, pose.y, pose.z);
    k.craft++;
  }
  const beam = look.beam;
  if (state !== CRAFT_FLYING || !beam || pose.low <= 0.02) return;
  // Its beam, from under its middle down to the ground under it, as wide as its low pass has it on.
  const top = y - beam.drop * size;
  const length = top - (k.f.world.hf.heightAt(pose.x, pose.z) - cam.y);
  if (length <= 1) return;
  const wide = Math.max(beam.wide * 0.5 * pose.low, far * BEAM_FLOOR);
  k.turn(0, -1, 0, 0);
  if (k.put(k.cone, x, top, z, wide, length, Math.max(wide, length * 0.5), 0.5, k.tint(beam.rgb), DRAW_BLEND, 0.15 + 0.6 * (1 - pose.low))) k.beams++;
}
