// Seeded scenes for the stuck ladder (server/decide/nav.ts): a host with no clock and every chunk awake (tools/decide/world.ts),
// walls set by hand, and movers sent somewhere. Each scene runs the same whoever decides, so runs can be compared.

import { GOAL_WALK } from "../../server/behavior.ts";
import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapData } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { lab, stateHash, wood, type Lab } from "../../tools/decide/world.ts";
import { flatMap } from "./map.ts";

export const QUARTER = 16384;

export interface Scene {
  w: Lab;
  /** The movers the scene is about. */
  movers: number[];
  ticks: number;
  /** Where the first mover is sent, where it has a goal. */
  goal?: { x: number; z: number };
  /** The first mover's prey, in a hunt. */
  prey?: number;
}

/** How a run is decided: no decider at all, every point off, every point watched, or as `policy` says. */
export type Way = "detached" | "off" | "watch" | string;

/** Sets who decides in `w` before it runs. */
export function decideBy(w: Lab, way: Way): void {
  const mind = w.host.creatures.mind as { decide: unknown };
  if (way === "detached") {
    if ("decide" in mind) mind.decide = null;
    return;
  }
  w.host.decide.set(way === "off" ? "" : way === "watch" ? "*=watch" : way);
}

/**
 * A row of wall pieces from (x0, z) to (x1, z) along X, or from (x, z0) to (x, z1) along Z, `storeys` high: stone walls
 * unless `kind` names another piece, which stands `high` metres tall.
 */
export function wallX(w: Lab, x0: number, x1: number, z: number, storeys = 2, kind = "core:wall_stone", high = 3): void {
  const k = w.world.reg.index.get(kind)!;
  for (let x = x0 + 1.5; x < x1; x += 3) for (let s = 0; s < storeys; s++) w.world.structs.add(k, x, high / 2 + high * s, z, 0, 0, 10000);
}
export function wallZ(w: Lab, x: number, z0: number, z1: number, storeys = 2, kind = "core:wall_stone", high = 3): void {
  const k = w.world.reg.index.get(kind)!;
  for (let z = z0 + 1.5; z < z1; z += 3) for (let s = 0; s < storeys; s++) w.world.structs.add(k, x, high / 2 + high * s, z, QUARTER, 0, 10000);
}

/** A closed square of walls of `kind`, `high` metres tall, from (x0, z0) to (x1, z1). */
export function box(w: Lab, x0: number, z0: number, x1: number, z1: number, kind: string, high: number): void {
  wallX(w, x0, x1, z0, 1, kind, high);
  wallX(w, x0, x1, z1, 1, kind, high);
  wallZ(w, x0, z0, z1, 1, kind, high);
  wallZ(w, x1, z0, z1, 1, kind, high);
}

/** Flat ground `chunks` on a side with a shallow pond `depth` deep over the rectangle given, in metres. */
export function pondMap(chunks: number, x0: number, z0: number, x1: number, z1: number, depth: number): MapData {
  const base = flatMap(chunks);
  const side = (chunks * CHUNK_SIZE) / TERRAIN_CELL;
  const grid = new Uint16Array(side * side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const x = (i + 0.5) * TERRAIN_CELL, z = (j + 0.5) * TERRAIN_CELL;
    if (x >= x0 && x < x1 && z >= z0 && z < z1) grid[j * side + i] = 1;
  }
  const level = Math.round((depth - base.minY) / base.stepY);
  return { ...base, water: MapWater.fromGrid(base.dims, base.minY, base.stepY, TERRAIN_CELL, [{ name: "Shallows", level }], grid) };
}

/** A walled pen 24 m a side with seven wanderers of five kinds in it. */
export function pen(seed = 1): Scene {
  const w = lab(flatMap(4), seed);
  wallX(w, 76, 100, 76);
  wallX(w, 76, 100, 100);
  wallZ(w, 76, 76, 100);
  wallZ(w, 100, 76, 100);
  const movers = ["raptor", "raptor", "parasaur", "dodo", "dodo", "trike", "rex"].map((name, k) => w.host.spawnCreature(`core:${name}`, 82 + (k % 4) * 4, 82 + Math.floor(k / 4) * 8, 1));
  return { w, movers, ticks: 40 * TICK_RATE };
}

/** A raptor sent to a point behind a wall under its eye, whose end is 12 m to the east. */
export function pastWall(seed = 1): Scene {
  const w = lab(flatMap(4), seed);
  wallX(w, 70, 112, 106, 1);
  const e = w.host.spawnCreature("core:raptor", 100, 100, 1);
  const mind = w.host.creatures.mind;
  mind.stay(e, w.world.tick + 60 * TICK_RATE);
  w.world.ents.yaw[e] = mind.look[e] = 0;
  mind.goTo(e, 100, 118, GOAL_WALK);
  return { w, movers: [e], ticks: 30 * TICK_RATE, goal: { x: 100, z: 118 } };
}

/**
 * A raptor at the closed end of a U of walls `deep` metres deep and `wide` across, open to the south, sent to a point just
 * north of the closed end. The search's budget fills the U before it gets round, so the way it finds ends short.
 */
export function deadEnd(seed = 1, deep = 66, wide = 54): Scene {
  const w = lab(flatMap(8), seed);
  const [cx, north] = [256, 300];
  wallX(w, cx - wide / 2, cx + wide / 2, north);
  wallZ(w, cx - wide / 2, north - deep, north);
  wallZ(w, cx + wide / 2, north - deep, north);
  const e = w.host.spawnCreature("core:raptor", cx, north - 4, 1);
  const mind = w.host.creatures.mind;
  mind.stay(e, w.world.tick + 300 * TICK_RATE);
  w.world.ents.yaw[e] = mind.look[e] = 0;
  const goal = { x: cx, z: north + 8 };
  mind.goTo(e, goal.x, goal.z, GOAL_WALK);
  return { w, movers: [e], ticks: 90 * TICK_RATE, goal };
}

/** Eight movers in a thick wood, each sent across it. */
export function woodGoals(seed = 1): Scene {
  const w = lab(wood(), seed);
  const rng = new Rng(seed * 31 + 7);
  const mind = w.host.creatures.mind;
  const movers: number[] = [];
  const goals: { x: number; z: number }[] = [];
  for (let n = 0; movers.length < 8 && n < 400; n++) {
    const [x, z] = [rng.range(40, 216), rng.range(40, 216)];
    const e = w.host.spawnCreature(movers.length % 2 === 0 ? "core:raptor" : "core:dodo", x, z, 1);
    if (e < 0) continue;
    const a = rng.float() * Math.PI * 2;
    const goal = { x: Math.min(236, Math.max(20, x + Math.sin(a) * 60)), z: Math.min(236, Math.max(20, z + Math.cos(a) * 60)) };
    mind.stay(e, w.world.tick + 300 * TICK_RATE);
    mind.goTo(e, goal.x, goal.z, GOAL_WALK);
    movers.push(e);
    goals.push(goal);
  }
  return { w, movers, ticks: 40 * TICK_RATE, goal: goals[0] };
}

/** Wanderers of two kinds loose in a thick wood. */
export function woodWander(seed = 1, count = 12): Scene {
  const w = lab(wood(), seed);
  const rng = new Rng(seed * 17 + 3);
  const movers: number[] = [];
  const mind = w.host.creatures.mind;
  for (let n = 0; movers.length < count && n < 400; n++) {
    const e = w.host.spawnCreature(movers.length % 2 === 0 ? "core:raptor" : "core:parasaur", rng.range(40, 216), rng.range(40, 216), 1);
    if (e < 0) continue;
    // Not hunting meanwhile: a raptor looks for prey only when rested, and there is none here.
    mind.temperOf[e] = 0;
    movers.push(e);
  }
  return { w, movers, ticks: 60 * TICK_RATE };
}

/** Wanderers of two kinds loose in a thick wood as `woodWander`, each a survivor's tame told to wander. */
export function ownedWander(seed = 1, count = 12): Scene {
  const s = woodWander(seed, count), ents = s.w.world.ents, mind = s.w.host.creatures.mind;
  for (const e of s.movers) {
    ents.team[e] = 1;
    s.w.host.creatures.claimed(e);
    mind.wander(e);
  }
  return s;
}

/**
 * A raptor ordered on a dodo standing inside a pen of walls whose only gap is too narrow for the raptor: no way it finds
 * reaches the dodo, and the nearest it can get is round the pen's side.
 */
export function hunt(seed = 1): Scene {
  const w = lab(flatMap(4), seed);
  // A pen 12 m a side with a one-metre slot in its south wall.
  wallX(w, 122, 128, 140);
  wallX(w, 129, 134, 140);
  wallX(w, 122, 134, 152);
  wallZ(w, 122, 140, 152);
  wallZ(w, 134, 140, 152);
  const prey = w.host.spawnCreature("core:dodo", 128, 146, 1);
  const e = w.host.spawnCreature("core:raptor", 128, 120, 1);
  const mind = w.host.creatures.mind;
  mind.stay(prey, w.world.tick + 300 * TICK_RATE);
  w.world.ents.yaw[e] = mind.look[e] = 0;
  mind.attack(e, prey);
  return { w, movers: [e], ticks: 30 * TICK_RATE, prey };
}

/**
 * A raptor inside a closed square of quarter walls of stone, 12 m a side, sent to a point outside it. No way leads out, but
 * the walls stand lower than a raptor jumps.
 */
export function lowPen(seed = 1): Scene {
  const w = lab(flatMap(4), seed);
  box(w, 122, 122, 134, 134, "core:quarter_wall_stone", 0.75);
  const e = w.host.spawnCreature("core:raptor", 128, 128, 1);
  const mind = w.host.creatures.mind;
  mind.stay(e, w.world.tick + 300 * TICK_RATE);
  w.world.ents.yaw[e] = mind.look[e] = 0;
  const goal = { x: 128, z: 146 };
  mind.goTo(e, goal.x, goal.z, GOAL_WALK);
  return { w, movers: [e], ticks: 40 * TICK_RATE, goal };
}

/**
 * A raptor ordered on a dodo standing in a closed hut of walls of `kind` (thatch by default), 9 m a side: the dodo stands
 * out of its reach from any wall, so only a way through one would bring it near.
 */
export function walledPrey(seed = 1, kind = "core:wall_thatch"): Scene {
  const w = lab(flatMap(4), seed);
  box(w, 124, 140, 133, 149, kind, 3);
  const prey = w.host.spawnCreature("core:dodo", 128.5, 144.5, 1);
  const e = w.host.spawnCreature("core:raptor", 128.5, 128, 1);
  const mind = w.host.creatures.mind;
  mind.stay(prey, w.world.tick + 300 * TICK_RATE);
  w.world.ents.yaw[e] = mind.look[e] = 0;
  mind.attack(e, prey);
  return { w, movers: [e], ticks: 40 * TICK_RATE, prey };
}

/** As `walledPrey`, the hut of stone, which a bite cannot harm. */
export function stonedPrey(seed = 1): Scene {
  return walledPrey(seed, "core:wall_stone");
}

/** A dodo hurt from the south while a wall stands across the way it flees. */
export function flight(seed = 1): Scene {
  const w = lab(flatMap(4), seed);
  wallX(w, 110, 146, 136);
  const e = w.host.spawnCreature("core:dodo", 128, 130, 1);
  w.world.ents.yaw[e] = w.host.creatures.mind.look[e] = 0;
  w.host.creatures.provoke(e, 128, 120, -1);
  return { w, movers: [e], ticks: 20 * TICK_RATE };
}

/**
 * A raptor in a pen walled on three sides and open to the south, where water too deep for its search (but swum) fills the
 * mouth and runs past the walls' ends. Its goal is behind the north wall: the only way out is through the water.
 */
export function wet(seed = 1): Scene {
  const w = lab(pondMap(4, 96, 106, 160, 121, 1.2), seed);
  wallX(w, 120, 136, 136);
  wallZ(w, 120, 112, 136);
  wallZ(w, 136, 112, 136);
  const e = w.host.spawnCreature("core:raptor", 128, 128, 1);
  const mind = w.host.creatures.mind;
  mind.stay(e, w.world.tick + 300 * TICK_RATE);
  w.world.ents.yaw[e] = mind.look[e] = 0;
  const goal = { x: 128, z: 146 };
  mind.goTo(e, goal.x, goal.z, GOAL_WALK);
  return { w, movers: [e], ticks: 90 * TICK_RATE, goal };
}

/** A raptor sent north with a trike standing in its way, which walks off east after three seconds. */
export function blocker(seed = 1): Scene {
  const w = lab(flatMap(4), seed);
  const mind = w.host.creatures.mind, ents = w.world.ents;
  const e = w.host.spawnCreature("core:raptor", 128, 110, 1);
  const trike = w.host.spawnCreature("core:trike", 128, 116, 1);
  mind.stay(e, w.world.tick + 300 * TICK_RATE);
  mind.stay(trike, w.world.tick + 300 * TICK_RATE);
  ents.yaw[e] = mind.look[e] = 0;
  ents.yaw[trike] = mind.look[trike] = QUARTER;
  const goal = { x: 128, z: 132 };
  mind.goTo(e, goal.x, goal.z, GOAL_WALK);
  return { w, movers: [e, trike], ticks: 30 * TICK_RATE, goal, prey: trike };
}

/** Sends the trike of `blocker` off east: call it three seconds in. */
export function blockerLeaves(s: Scene): void {
  s.w.host.creatures.mind.goTo(s.prey!, 150, 116, GOAL_WALK);
}

/** A raptor just south of a wall's east end, its goal north-west behind the wall: it must round the corner. */
export function corner(seed = 1): Scene {
  const w = lab(flatMap(4), seed);
  wallX(w, 100, 130, 120);
  const e = w.host.spawnCreature("core:raptor", 127, 117, 1);
  const mind = w.host.creatures.mind;
  mind.stay(e, w.world.tick + 300 * TICK_RATE);
  w.world.ents.yaw[e] = mind.look[e] = QUARTER;
  const goal = { x: 118, z: 128 };
  mind.goTo(e, goal.x, goal.z, GOAL_WALK);
  return { w, movers: [e], ticks: 20 * TICK_RATE, goal };
}

export const SCENES: Record<string, (seed?: number) => Scene> = { pen, pastWall, deadEnd, woodGoals, woodWander, ownedWander, hunt, lowPen, walledPrey, stonedPrey, flight, wet, blocker, corner };

/** Runs `s` for its ticks, calling `each` after every tick; returns the hash of the world every 30 ticks, the last at its end. */
export function hashes(s: Scene, each?: (tick: number) => void): number[] {
  const out: number[] = [];
  for (let t = 1; t <= s.ticks; t++) {
    s.w.tick();
    each?.(t);
    if (t % 30 === 0 || t === s.ticks) out.push(stateHash(s.w.world));
  }
  return out;
}
