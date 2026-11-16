// What an agent sees in place of a picture: the floor about it as a square of letters, north up, and the nearest things by id.
// On the ground the letters are judged as the ground's way finder judges it; on a floor, at the storey the body stands on.

import { ownIndex, type ClientSession, type RemoteSample } from "../client/core/session.ts";
import type { NodeDef, PropDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { CUE_DEAD, CUE_HELD, CUE_HURT_SHIFT, CUE_OUT } from "../shared/anim/pose.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../shared/coords.ts";
import { GEAR_COUNT, GEAR_WORN } from "../shared/sim/entities.ts";
import { latOf, lonOf } from "../shared/world/coords.ts";
import { SKIN, capsuleBox, capsuleFree, groundUnder, settleOnto } from "../shared/world/collide.ts";
import { GROUND_FREE, GROUND_OFF, GROUND_STEEP, GROUND_WATER, groundAt } from "../shared/world/path.ts";
import { ROLE_STAIRS } from "../shared/world/snap.ts";
import { Found, type StructureStore } from "../shared/world/structures.ts";
import { TRAVEL_TERMINAL } from "../shared/world/obelisks.ts";

/** What stands at (x, z) where this client has been sent nothing: 0 for nothing known. Task T's `cellAt` is one. */
export type FarLayer = (x: number, z: number) => number;

/** Letters in rising order of what a square shows when it holds several things. */
const LETTERS = "? .-+^~bRT#BcP@";
const UNKNOWN = 0;
const DROP = 1;
const GROUND = 2;
const LOWER = 3;
const HIGHER = 4;
const STEEP = 5;
const WATER = 6;
const BUSH = 7;
const ROCK = 8;
const TREE = 9;
const BUILT = 10;
const BOX = 11;
const CREATURE = 12;
const PLAYER = 13;
const SELF = 14;

const LEGEND = ". ground  # built  ^ too steep  ~ deep water  T tree  R rock  b bush  c creature or car  P player  B box or station  @ you  ? unknown";
const STOREY_LEGEND = ". floor at your height  + higher: stairs up or a step  - lower: stairs down  (space) a drop  # wall  ~ deep water  c creature or car  P player  B box or station  @ you  ? unknown";
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** The server sends what is built, and this client fills in nodes, this many chunks each way from its own. */
const SEEN_CHUNKS = 3;
/** The most squares across, so the answer stays small: a 1 m square shows 32 m each way, a 4 m one all 96. */
const MOST_EACH_WAY = 32;
/** Metres between the points of ground tried. */
const TRY = 0.5;
/** Feet this far above the ground under them stand on a floor, and the picture is of that storey. */
const RAISED = 1;
/** Bits of a replicated entity's flags. */
export const VIEW_PLAYER = 4;
export const VIEW_PROP = 8;
const found = new Found();

/** The compass point a facing in radians is nearest. Yaw 0 faces north, and turning right, toward the east, lowers it. */
export function compass(yaw: number): string {
  return COMPASS[((Math.round((-yaw / (2 * Math.PI)) * 8) % 8) + 8) % 8]!;
}

/** "core:hatchet" as "hatchet". */
export function shortName(id: string | undefined): string {
  return id === undefined ? "?" : id.slice(id.indexOf(":") + 1);
}

/** Per registry, which structure kinds are stairs, flights or ramps a body climbs, and which are stations. */
const kinds = new WeakMap<Registry, { climb: Uint8Array; station: Uint8Array }>();
function kindsOf(reg: Registry): { climb: Uint8Array; station: Uint8Array } {
  let k = kinds.get(reg);
  if (k) return k;
  const climb = new Uint8Array(reg.ids.length);
  const station = new Uint8Array(reg.ids.length);
  for (let i = 1; i < reg.ids.length; i++) {
    if (reg.defs[i]?.type !== "structure") continue;
    if (reg.role[i] === ROLE_STAIRS || /(^|[:_])(flight|ramp\d*|stairs?)(_|$)/.test(reg.ids[i]!)) climb[i] = 1;
  }
  for (let i = 1; i < reg.ids.length; i++) if (reg.craftAt[i] !== 0) station[reg.craftAt[i]!] = 1;
  for (let i = 1; i < reg.ids.length; i++) if (reg.stationBase[i] !== 0 && station[reg.stationBase[i]!] === 1) station[i] = 1;
  for (let i = 1; i < reg.ids.length; i++) if (reg.lights[i] !== 0 && reg.structSlots[i]! > 0) station[i] = 1;
  k = { climb, station };
  kinds.set(reg, k);
  return k;
}

interface Thing {
  id: string;
  /** What kind of thing, or its name. "" where the list it is in says it. */
  name: string;
  x: number;
  z: number;
  far: number;
  more: unknown[];
}

/**
 * `radius` is in metres, 8 to 96, and `cell` is the metres a letter covers: 1, 2 or 4. `far` fills in beyond the chunks the
 * server sends this client. `listed` is the most things of each kind listed.
 */
export function observe(session: ClientSession, remote: RemoteSample, radius = 32, cell = 2, far?: FarLayer, listed = 10): Record<string, unknown> {
  const world = session.world!;
  const reg = session.registry;
  const { climb, station } = kindsOf(reg);
  const move = (session.driving >= 0 ? reg.tamedMove[session.bodyKind] : null) ?? reg.move[session.bodyKind]!;
  const b = session.own;
  const each = Math.min(MOST_EACH_WAY, Math.floor(radius / cell));
  const reach = each * cell;
  const side = 2 * each + 1;
  const bare = { hf: world.hf, structs: world.structs };
  const ownCx = chunkCx(world.dims, chunkAt(world.dims, b.x, b.z));
  const ownCz = chunkCz(world.dims, chunkAt(world.dims, b.x, b.z));
  const forms = session.nodeField?.forms;
  const up = b.y - groundUnder(world.hf, b.x, b.z, move.radius);
  const storey = up > RAISED && b.mode !== 2;

  /** The letter of the node a body at (x, y, z) would stand in. */
  const nodeAt = (nodes: StructureStore, x: number, y: number, z: number): number => {
    const n = nodes.query(x - move.radius, z - move.radius, x + move.radius, z + move.radius, found, y, y + move.height);
    for (let i = 0; i < n; i++) {
      // What is left of a used-up node is marked as the node was.
      if (capsuleBox(nodes, found.refs[i]!, x, y, z, move.radius, move.height, SKIN)) return letterOf(reg.defs[forms!.kind[nodes.chunks[Math.floor(found.refs[i]! / 65536)]!.kind[found.refs[i]! & 0xffff]!]!] as NodeDef);
    }
    return ROCK;
  };
  const unseen = (x: number, z: number): boolean => Math.abs(Math.floor(x / CHUNK_SIZE) - ownCx) > SEEN_CHUNKS || Math.abs(Math.floor(z / CHUNK_SIZE) - ownCz) > SEEN_CHUNKS;
  /** What is at one point of the ground. */
  const atGround = (x: number, z: number): number => {
    const ground = groundAt(world, move, x, z);
    if (ground === GROUND_OFF) return UNKNOWN;
    if (unseen(x, z)) return far && far(x, z) !== 0 ? BUILT : UNKNOWN;
    if (ground === GROUND_FREE) return GROUND;
    if (ground === GROUND_WATER) return WATER;
    if (ground === GROUND_STEEP) return STEEP;
    const y = world.hf.heightAt(x, z) + move.stepUp;
    return !capsuleFree(bare, x, y, z, move.radius, move.height) || !world.nodes ? BUILT : nodeAt(world.nodes, x, y, z);
  };
  /** What is at one point of the storey the body stands on: a floor at its height, higher or lower, a drop, or a wall. */
  const atStorey = (x: number, z: number): number => {
    if (x < move.radius || z < move.radius || x > world.hf.sizeX - move.radius || z > world.hf.sizeZ - move.radius || unseen(x, z)) return UNKNOWN;
    const y = b.y;
    const r = move.radius;
    const h = move.height;
    if (!capsuleFree(world, x, y + 0.1, z, r, h)) return capsuleFree(world, x, y + 1.2, z, r, h) ? HIGHER : BUILT;
    const ground = groundUnder(world.hf, x, z, r);
    // Lowered from just above the body's feet, where it would come to rest within a storey's step below.
    const on = settleOnto(world, x, z, y - 1.6, y - 1.6, y + 0.1, r, h, move.slopeCos);
    const floor = Math.max(Number.isNaN(on) ? -Infinity : on, ground > y - 1.6 ? ground : -Infinity);
    if (world.hf.waterAt(x, z) > Math.max(floor, ground) + 0.7 * h) return WATER;
    if (floor === -Infinity) return DROP;
    return floor < y - 0.5 ? LOWER : GROUND;
  };
  const at = storey ? atStorey : atGround;

  // A letter covers a square whose corner is a multiple of its size, so the picture does not shimmer as the body moves.
  // The ground is tried every half metre, which is close enough that no wall, however thin, passes between two tries. A
  // storey is tried at the middle of a square of 1 m, and at four points of a larger one.
  const midX = Math.floor(b.x / cell);
  const midZ = Math.floor(b.z / cell);
  const grid = new Uint8Array(side * side);
  const tries = storey ? (cell === 1 ? [0.5] : [cell / 4, (3 * cell) / 4]) : null;
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const x0 = (midX + each - col) * cell;
      const z0 = (midZ + each - row) * cell;
      let most = UNKNOWN;
      if (tries) {
        // On a storey the square shows what most of it is: a floor with a little wall in it is a floor.
        let wall = 0;
        let best = UNKNOWN;
        for (const dz of tries) {
          for (const dx of tries) {
            const v = at(x0 + dx, z0 + dz);
            if (v === BUILT) wall++;
            else if (v > best) best = v;
          }
        }
        most = wall * 2 > tries.length * tries.length || best === UNKNOWN ? (wall > 0 ? BUILT : UNKNOWN) : best;
      } else for (let dz = 0; dz < cell; dz += TRY) for (let dx = 0; dx < cell; dx += TRY) most = Math.max(most, at(x0 + dx, z0 + dz));
      grid[row * side + col] = most;
    }
  }
  /** Shows `letter` in the square that holds (x, z), unless something that matters more is there. False if it lies outside the picture. */
  const mark = (x: number, z: number, letter: number): boolean => {
    const col = midX + each - Math.floor(x / cell);
    const row = midZ + each - Math.floor(z / cell);
    if (col < 0 || row < 0 || col >= side || row >= side) return false;
    if (grid[row * side + col]! < letter) grid[row * side + col] = letter;
    return true;
  };

  const thing = (id: string, name: string, x: number, z: number, ...more: unknown[]): Thing => ({ id, name, x, z, far: Math.hypot(x - b.x, z - b.z), more });
  const nodes = new Map<string, Thing[]>();
  const boxes: Thing[] = [];
  const stations: Thing[] = [];
  const doors: Thing[] = [];
  const beds: Thing[] = [];
  const stairs: Thing[] = [];
  /** Obelisks' terminals, where a survivor travels to another server (the travel tool). */
  const terminals: Thing[] = [];
  const terminal = reg.index.get(TRAVEL_TERMINAL) ?? 0;
  const creatures: Thing[] = [];
  const cars: Thing[] = [];
  const bodies: Thing[] = [];
  const eggs: Thing[] = [];
  const players: Thing[] = [];
  const team = session.tribe.team;
  // Every chunk the picture touches, for what stands in it.
  const dims = world.dims;
  for (let cz = Math.max(0, Math.floor((b.z - reach) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((b.z + reach) / CHUNK_SIZE)); cz++) {
    for (let cx = Math.max(0, Math.floor((b.x - reach) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((b.x + reach) / CHUNK_SIZE)); cx++) {
      const chunk = cz * dims.chunksX + cx;
      const grown = world.nodes?.chunks[chunk];
      for (let slot = 0; grown && slot < grown.high; slot++) {
        const def = reg.defs[session.nodeField!.standing(chunk, slot)];
        if (def?.type !== "node" || !mark(grown.x[slot]!, grown.z[slot]!, storey ? UNKNOWN : letterOf(def))) continue;
        const name = shortName(def.id);
        if (!nodes.has(name)) nodes.set(name, []);
        nodes.get(name)!.push(thing(`n${chunk}.${slot}`, "", grown.x[slot]!, grown.z[slot]!));
      }
      const built = world.structs.chunks[chunk];
      for (let slot = 0; built && slot < built.high; slot++) {
        const kind = built.kind[slot]!;
        if (kind === 0) continue;
        const id = `s${chunk * 65536 + slot}`;
        const x = built.x[slot]!;
        const z = built.z[slot]!;
        if (kind === terminal) {
          if (mark(x, z, UNKNOWN)) terminals.push(thing(id, "obelisk terminal", x, z));
          continue;
        }
        if (climb[kind] === 1) {
          // A flight or ramp is listed with the heights it joins, so a storey can be asked for by its height.
          const y = built.y[slot]!;
          const half = reg.halfY[kind]!;
          if (mark(x, z, UNKNOWN) && Math.abs(y - b.y) < 40) stairs.push(thing(id, shortName(reg.ids[kind]), x, z, `from y ${Math.round((y - half) * 10) / 10} to ${Math.round((y + half) * 10) / 10}`));
          continue;
        }
        if (reg.isBed[kind] === 1) {
          if (mark(x, z, UNKNOWN)) beds.push(thing(id, shortName(reg.ids[kind]), x, z, built.owner[slot] === team && team !== 0 ? "yours" : "not yours"));
          continue;
        }
        const holds = reg.structSlots[kind]! > 0;
        if (!holds && reg.opens[kind] === 0) continue;
        if (!mark(x, z, holds ? BOX : UNKNOWN)) continue;
        if (station[kind] === 1) stations.push(thing(id, shortName(reg.ids[kind]), x, z, ...(reg.lights[kind] !== 0 ? [reg.burning[kind] === 1 ? "lit" : "out"] : [])));
        else (holds ? boxes : doors).push(thing(id, shortName(reg.ids[kind]), x, z));
      }
    }
  }
  const own = ownIndex(session);
  for (let i = 0; i < remote.count; i++) {
    const id = remote.id[i]!;
    const kind = remote.kind[i]!;
    const flags = remote.flags[i]!;
    if (id === own || id === session.driving) continue;
    const x = remote.x[i]!;
    const z = remote.z[i]!;
    const cue = remote.cue[i]!;
    if ((flags & VIEW_PROP) !== 0) {
      // Of the things that lie about, only those that hold something are worth a letter. A dead body and an egg are listed.
      const lying = (reg.defs[kind] as PropDef | null)?.class;
      if ((cue & CUE_DEAD) !== 0) bodies.push(thing(`e${id}`, `dead ${shortName(reg.ids[kind])}`, x, z));
      else if (lying === "egg") eggs.push(thing(`e${id}`, shortName(reg.ids[kind]), x, z));
      else if (lying === "container" && mark(x, z, BOX)) boxes.push(thing(`e${id}`, remote.name[i] || shortName(reg.ids[kind]), x, z));
    } else if ((flags & VIEW_PLAYER) !== 0) {
      // A survivor sitting in a car or on a creature is told of with what it sits on.
      if (remote.seat[i] === 0 && mark(x, z, PLAYER)) players.push(thing(`e${id}`, remote.name[i]!, x, z));
      else if (remote.seat[i] !== 0) players.push(thing(`e${id}`, remote.name[i]!, x, z, `riding e${remote.seat[i]! - 1}`));
    } else if (reg.vehicle[kind]) {
      if (!mark(x, z, CREATURE)) continue;
      let driver = "empty";
      for (let j = 0; j < remote.count; j++) if (remote.seat[j] === id + 1 && remote.seatSlot[j] === 1) driver = remote.id[j] === own ? "you drive it" : `driven by ${remote.name[j] || "someone"}`;
      if (session.driving === id) driver = "you drive it";
      cars.push(thing(`e${id}`, remote.name[i] || shortName(reg.ids[kind]), x, z, driver, remote.team[i] === 0 ? "anyone's" : remote.team[i] === team ? "yours" : "another tribe's"));
    } else if (mark(x, z, CREATURE)) {
      const whose = remote.team[i] === 0 ? (reg.temper[kind] === 2 ? "hunts" : "wild") : remote.team[i] === team ? "yours" : "tamed";
      const hurt = (cue >>> CUE_HURT_SHIFT) & 3;
      const how = (cue & CUE_OUT) !== 0 ? ["knocked out"] : (cue & CUE_HELD) !== 0 ? ["carried"] : hurt > 0 ? [["", "hurt", "badly hurt", "near death"][hurt]] : [];
      const saddled = remote.gear[i * GEAR_COUNT + GEAR_WORN] !== 0 ? ["saddled"] : [];
      const named = remote.name[i] ? [`named ${remote.name[i]}`] : [];
      creatures.push(thing(`e${id}`, shortName(reg.ids[kind]), x, z, `level ${remote.level[i]}`, whose, ...how, ...saddled, ...named));
    }
  }
  mark(b.x, b.z, SELF);

  const rows: string[] = [];
  for (let row = 0; row < side; row++) {
    let line = "";
    for (let col = 0; col < side; col++) line += LETTERS[grid[row * side + col]!];
    rows.push(line);
  }
  /** Nearest first, as [id, name, x, z, metres away, direction, and whatever else is known]. */
  const list = (things: Thing[], most = listed): unknown[] =>
    things
      .sort((p, q) => p.far - q.far || (p.id < q.id ? -1 : 1))
      .slice(0, most)
      .map((t) => [t.id, ...(t.name === "" ? [] : [t.name]), Math.round(t.x), Math.round(t.z), Math.round(t.far), compass(Math.atan2(t.x - b.x, t.z - b.z)), ...t.more]);
  const hf = world.hf;
  const out: Record<string, unknown> = {
    state: "done",
    self: { x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, y: Math.round(b.y * 10) / 10, lat: Math.round(latOf(hf, b.z) * 10) / 10, lon: Math.round(lonOf(hf, b.x) * 10) / 10, ...(storey ? { above_ground: Math.round(up * 10) / 10 } : {}), facing: compass(session.ownYaw) },
    legend: storey ? STOREY_LEGEND : LEGEND,
    map: `North (+z) is up and east (-x) is right. Each letter is a square of ${cell} m. The top left one is centred on x ${(midX + each) * cell + cell / 2}, z ${(midZ + each) * cell + cell / 2}.${storey ? ` It shows the storey you stand on, ${Math.round(up)} m above the ground.` : ""}`,
    grid: rows,
    lists: `Nearest first, at most ${listed} of a kind and ${Math.ceil(listed / 2)} of each tree, rock or plant: id, its name if it has one, x, z, metres away, direction, and what else is known.`,
  };
  // A city grows many kinds of plant and rubble, so each is listed half as far.
  for (const [name, things] of [...nodes].sort((p, q) => (p[0] < q[0] ? -1 : 1))) out[name] = list(things, Math.ceil(listed / 2));
  for (const [name, things] of [["terminal", terminals], ["station", stations], ["box", boxes], ["bed", beds], ["door", doors], ["stairs", stairs], ["creature", creatures], ["car", cars], ["body", bodies], ["egg", eggs], ["player", players]] as const) if (things.length > 0) out[name] = list(things);
  return out;
}

function letterOf(def: NodeDef): number {
  return def.material === undefined ? BUSH : def.material === "wood" ? TREE : ROCK;
}
