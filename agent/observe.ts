// What an agent sees in place of a picture: the ground about it as a square of letters, north up, and the nearest things by id.
// The ground is judged as the path finder judges it, so a dot is somewhere walk_to can stand.

import { ownIndex, type ClientSession, type RemoteSample } from "../client/core/session.ts";
import type { NodeDef, PropDef } from "../shared/content/defs.ts";
import { CUE_DEAD, CUE_HELD, CUE_HURT_SHIFT, CUE_OUT } from "../shared/anim/pose.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../shared/coords.ts";
import { SKIN, capsuleBox, capsuleFree } from "../shared/world/collide.ts";
import { GROUND_FREE, GROUND_OFF, GROUND_STEEP, GROUND_WATER, groundAt } from "../shared/world/path.ts";
import { Found, type StructureStore } from "../shared/world/structures.ts";

/** What stands at (x, z) where this client has been sent nothing: 0 for nothing known. Task T's `cellAt` is one. */
export type FarLayer = (x: number, z: number) => number;

/** Letters in rising order of what a square shows when it holds several things. */
const LETTERS = "?.^~bRT#BcP@";
const UNKNOWN = 0;
const GROUND = 1;
const STEEP = 2;
const WATER = 3;
const BUSH = 4;
const ROCK = 5;
const TREE = 6;
const BUILT = 7;
const BOX = 8;
const CREATURE = 9;
const PLAYER = 10;
const SELF = 11;

const LEGEND = ". ground  # built  ^ too steep  ~ deep water  T tree  R rock  b bush  c creature  P player  B box  @ you  ? unknown";
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** The server sends what is built, and this client fills in nodes, this many chunks each way from its own. */
const SEEN_CHUNKS = 3;
/** The most squares across, so the answer stays small: a 1 m square shows 32 m each way, a 4 m one all 96. */
const MOST_EACH_WAY = 32;
const LISTED = 40;
/** Metres between the points of ground tried. */
const TRY = 0.5;
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
 * server sends this client.
 */
export function observe(session: ClientSession, remote: RemoteSample, radius = 32, cell = 2, far?: FarLayer): Record<string, unknown> {
  const world = session.world!;
  const reg = session.registry;
  const move = reg.move[session.bodyKind]!;
  const b = session.own;
  const each = Math.min(MOST_EACH_WAY, Math.floor(radius / cell));
  const reach = each * cell;
  const side = 2 * each + 1;
  const bare = { hf: world.hf, structs: world.structs };
  const ownCx = chunkCx(world.dims, chunkAt(world.dims, b.x, b.z));
  const ownCz = chunkCz(world.dims, chunkAt(world.dims, b.x, b.z));
  const forms = session.nodeField?.forms;

  /** The letter of the node a body at (x, y, z) would stand in. */
  const nodeAt = (nodes: StructureStore, x: number, y: number, z: number): number => {
    const n = nodes.query(x - move.radius, z - move.radius, x + move.radius, z + move.radius, found, y, y + move.height);
    for (let i = 0; i < n; i++) {
      // What is left of a used-up node is marked as the node was.
      if (capsuleBox(nodes, found.refs[i]!, x, y, z, move.radius, move.height, SKIN)) return letterOf(reg.defs[forms!.kind[nodes.chunks[Math.floor(found.refs[i]! / 65536)]!.kind[found.refs[i]! & 0xffff]!]!] as NodeDef);
    }
    return ROCK;
  };
  /** What is at one point of the ground. */
  const at = (x: number, z: number): number => {
    const ground = groundAt(world, move, x, z);
    if (ground === GROUND_OFF) return UNKNOWN;
    if (Math.abs(Math.floor(x / CHUNK_SIZE) - ownCx) > SEEN_CHUNKS || Math.abs(Math.floor(z / CHUNK_SIZE) - ownCz) > SEEN_CHUNKS) return far && far(x, z) !== 0 ? BUILT : UNKNOWN;
    if (ground === GROUND_FREE) return GROUND;
    if (ground === GROUND_WATER) return WATER;
    if (ground === GROUND_STEEP) return STEEP;
    const y = world.hf.heightAt(x, z) + move.stepUp;
    return !capsuleFree(bare, x, y, z, move.radius, move.height) || !world.nodes ? BUILT : nodeAt(world.nodes, x, y, z);
  };

  // A letter covers a square whose corner is a multiple of its size, so the picture does not shimmer as the body moves.
  // The ground is tried every half metre, which is close enough that no wall, however thin, passes between two tries.
  const midX = Math.floor(b.x / cell);
  const midZ = Math.floor(b.z / cell);
  const grid = new Uint8Array(side * side);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const x0 = (midX + each - col) * cell;
      const z0 = (midZ + each - row) * cell;
      let most = UNKNOWN;
      for (let dz = 0; dz < cell; dz += TRY) for (let dx = 0; dx < cell; dx += TRY) most = Math.max(most, at(x0 + dx, z0 + dz));
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
  const doors: Thing[] = [];
  const creatures: Thing[] = [];
  const bodies: Thing[] = [];
  const eggs: Thing[] = [];
  const players: Thing[] = [];
  // Every chunk the picture touches, for what stands in it.
  const dims = world.dims;
  for (let cz = Math.max(0, Math.floor((b.z - reach) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((b.z + reach) / CHUNK_SIZE)); cz++) {
    for (let cx = Math.max(0, Math.floor((b.x - reach) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((b.x + reach) / CHUNK_SIZE)); cx++) {
      const chunk = cz * dims.chunksX + cx;
      const grown = world.nodes?.chunks[chunk];
      for (let slot = 0; grown && slot < grown.high; slot++) {
        const def = reg.defs[session.nodeField!.standing(chunk, slot)];
        if (def?.type !== "node" || !mark(grown.x[slot]!, grown.z[slot]!, letterOf(def))) continue;
        const name = shortName(def.id);
        if (!nodes.has(name)) nodes.set(name, []);
        nodes.get(name)!.push(thing(`n${chunk}.${slot}`, "", grown.x[slot]!, grown.z[slot]!));
      }
      const built = world.structs.chunks[chunk];
      for (let slot = 0; built && slot < built.high; slot++) {
        const kind = built.kind[slot]!;
        const holds = reg.structSlots[kind]! > 0;
        if (kind === 0 || (!holds && reg.opens[kind] === 0)) continue;
        if (!mark(built.x[slot]!, built.z[slot]!, holds ? BOX : UNKNOWN)) continue;
        (holds ? boxes : doors).push(thing(`s${chunk * 65536 + slot}`, shortName(reg.ids[kind]), built.x[slot]!, built.z[slot]!));
      }
    }
  }
  const own = ownIndex(session);
  const team = session.tribe.team;
  for (let i = 0; i < remote.count; i++) {
    const id = remote.id[i]!;
    const kind = remote.kind[i]!;
    const flags = remote.flags[i]!;
    if (id === own || id === session.driving) continue;
    const x = remote.x[i]!;
    const z = remote.z[i]!;
    const cue = remote.cue[i]!;
    if ((flags & VIEW_PROP) !== 0) {
      // Of the things that lie about, only those that hold something are worth a letter. A dead creature and an egg are listed.
      const lying = (reg.defs[kind] as PropDef | null)?.class;
      if ((cue & CUE_DEAD) !== 0) bodies.push(thing(`e${id}`, `dead ${shortName(reg.ids[kind])}`, x, z));
      else if (lying === "egg") eggs.push(thing(`e${id}`, shortName(reg.ids[kind]), x, z));
      else if (lying === "container" && mark(x, z, BOX)) boxes.push(thing(`e${id}`, remote.name[i] || shortName(reg.ids[kind]), x, z));
    } else if ((flags & VIEW_PLAYER) !== 0) {
      if (mark(x, z, PLAYER)) players.push(thing(`e${id}`, remote.name[i]!, x, z));
    } else if (mark(x, z, CREATURE)) {
      const whose = remote.team[i] === 0 ? (reg.temper[kind] === 2 ? "hunts" : "wild") : remote.team[i] === team ? "yours" : "tamed";
      const hurt = (cue >>> CUE_HURT_SHIFT) & 3;
      const how = (cue & CUE_OUT) !== 0 ? ["knocked out"] : (cue & CUE_HELD) !== 0 ? ["carried"] : hurt > 0 ? [["", "hurt", "badly hurt", "near death"][hurt]] : [];
      creatures.push(thing(`e${id}`, shortName(reg.ids[kind]), x, z, `level ${remote.level[i]}`, whose, ...how));
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
  const list = (things: Thing[]): unknown[] =>
    things
      .sort((p, q) => p.far - q.far || (p.id < q.id ? -1 : 1))
      .slice(0, LISTED)
      .map((t) => [t.id, ...(t.name === "" ? [] : [t.name]), Math.round(t.x), Math.round(t.z), Math.round(t.far), compass(Math.atan2(t.x - b.x, t.z - b.z)), ...t.more]);
  const out: Record<string, unknown> = {
    state: "done",
    self: { x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, y: Math.round(b.y * 10) / 10, facing: compass(session.ownYaw) },
    legend: LEGEND,
    map: `North (+z) is up and east (-x) is right. Each letter is a square of ${cell} m. The top left one is centred on x ${(midX + each) * cell + cell / 2}, z ${(midZ + each) * cell + cell / 2}.`,
    grid: rows,
    lists: "Nearest first, at most 40 of a kind: id, its name if it has one, x, z, metres away, direction.",
  };
  for (const [name, things] of [...nodes].sort((p, q) => (p[0] < q[0] ? -1 : 1))) out[name] = list(things);
  for (const [name, things] of [["box", boxes], ["door", doors], ["creature", creatures], ["body", bodies], ["egg", eggs], ["player", players]] as const) if (things.length > 0) out[name] = list(things);
  return out;
}

function letterOf(def: NodeDef): number {
  return def.material === undefined ? BUSH : def.material === "wood" ? TREE : ROCK;
}
