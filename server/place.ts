// Where a body may be put, and where one found inside something is set. Nodes join the collision world only round players, so a
// place is also tested against the nodes the map puts in chunks nobody has loaded, as they stand.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../shared/coords.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import { MODE_GHOST, stanceHeight } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { PAD, SKIN, capsuleBox, capsuleFree, capsuleKind, groundUnder, push } from "../shared/world/collide.ts";
import type { NodeField, NodeSpot } from "../shared/world/nodes.ts";
import { Found, type StructureStore } from "../shared/world/structures.ts";
import type { ServerWorld } from "./world.ts";

/** Chunks whose nodes, as the map places them, are kept for the places tested there. */
const NODE_CHUNKS = 256;

/** The nodes of chunks nobody has loaded, which the collision world does not hold. */
export class UnloadedNodes {
  /** Whether the node in a slot is used up. Harvest sets it; without it every node stands. */
  usedUp: ((chunk: number, index: number) => boolean) | null = null;
  private readonly field: NodeField;
  private readonly dims: MapDims;
  /**
   * The nodes of the last NODE_CHUNKS chunks tested, as the map places them: x, y, z, form, yaw and slot of each, a chunk to a
   * row. `mappedAt` is each chunk's row or -1. The row written longest ago is written next. Made at the first test.
   */
  private mapped: Float32Array | null = null;
  private mappedAt: Int32Array | null = null;
  private readonly mappedCount = new Uint16Array(NODE_CHUNKS);
  private readonly mappedChunk = new Int32Array(NODE_CHUNKS).fill(-1);
  private mappedNext = 0;
  private readonly spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  /** Metres a node's boxes reach sideways from its origin, at most. */
  private readonly reach: number;

  constructor(dims: MapDims, field: NodeField) {
    this.dims = dims;
    this.field = field;
    let reach = 0;
    for (const s of field.store.spread) if (s > reach) reach = s;
    this.reach = reach;
  }

  /** Whether a capsule with its feet at (x, y, z), radius r and height h meets a node in a chunk nobody has loaded. */
  meets(x: number, y: number, z: number, r: number, h: number): boolean {
    const field = this.field;
    const dims = this.dims;
    const reach = r + this.reach + PAD;
    const forms = field.forms;
    const spread = field.store.spread;
    const per = field.source.perChunk * 6;
    for (let cz = Math.max(0, Math.floor((z - reach) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z + reach) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((x - reach) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((x + reach) / CHUNK_SIZE)); cx++) {
        const chunk = cz * dims.chunksX + cx;
        if (field.isLoaded(chunk)) continue;
        const row = this.rowOf(chunk);
        const at = this.mapped!;
        for (let k = row * per, end = k + this.mappedCount[row]! * 6; k < end; k += 6) {
          const dx = x - at[k]!;
          const dz = z - at[k + 2]!;
          if (dx * dx + dz * dz >= reach * reach) continue;
          let form = at[k + 3]!;
          if (this.usedUp?.(chunk, at[k + 5]!)) form = forms.left[form]!;
          if (form === 0 || forms.soft[form] === 1) continue;
          // Most nodes reach far less than the widest banyan.
          const near = r + spread[form]! + PAD;
          if (dx * dx + dz * dz >= near * near) continue;
          if (capsuleKind(forms.parts, form, at[k]!, at[k + 1]!, at[k + 2]!, at[k + 4]!, x, y, z, r, h, SKIN)) return true;
        }
      }
    }
    return false;
  }

  /** The row of `mapped` that holds a chunk's nodes, written now if none does. */
  private rowOf(chunk: number): number {
    const field = this.field;
    const per = field.source.perChunk;
    this.mapped ??= new Float32Array(NODE_CHUNKS * per * 6);
    this.mappedAt ??= new Int32Array(chunkCount(this.dims)).fill(-1);
    let row = this.mappedAt[chunk]!;
    if (row >= 0) return row;
    row = this.mappedNext;
    this.mappedNext = (row + 1) % NODE_CHUNKS;
    const was = this.mappedChunk[row]!;
    if (was >= 0) this.mappedAt[was] = -1;
    this.mappedChunk[row] = chunk;
    this.mappedAt[chunk] = row;
    const spot = this.spot;
    const out = this.mapped;
    let n = 0;
    for (let i = 0, k = row * per * 6; i < per; i++) {
      field.source.at(chunk, i, spot);
      if (spot.kind === 0) continue;
      out[k++] = spot.x;
      out[k++] = spot.y;
      out[k++] = spot.z;
      out[k++] = spot.form;
      out[k++] = spot.yaw;
      out[k++] = i;
      n++;
    }
    this.mappedCount[row] = n;
    return row;
  }
}

/** Where a body may be put: capsuleFree, and clear of the nodes nobody has loaded. */
export function placeFree(world: ServerWorld, x: number, y: number, z: number, r: number, h: number): boolean {
  return capsuleFree(world, x, y, z, r, h) && !(world.unloaded?.meets(x, y, z, r, h) ?? false);
}

/** Metres from a body that freePlace tries places at, finely at first. */
const RINGS = [0, 0.05, 0.1, 0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12, 14, 16];
/** Places tried on each ring. */
const ON_RING = 16;
/** A body whose feet are within this of the ground under it is on the ground. */
const ON_GROUND = 0.05;

/** What freePlace found. */
export const freeAt = { x: 0, y: 0, z: 0 };
const found = new Found();

/**
 * The nearest free place (placeFree) to a body at (x, y, z) that it reaches by a straight line on which it is never more than
 * `climb` under the ground nor in a piece built by any team but `team`, so a body inside a piece of another team, or behind
 * one, is not set through it. Places are tried on rings out to 16 m, on the ground for a body on the ground and else at
 * its own height or on the ground above it, first on the side the deepest box it is in would push it out, and the nearest
 * by straight distance is taken. Fills `freeAt` and returns true, or false if there is none.
 */
export function freePlace(world: ServerWorld, x: number, y: number, z: number, r: number, h: number, team: number, climb: number): boolean {
  const hf = world.hf;
  const onGround = y <= groundUnder(hf, x, z, r) + ON_GROUND;
  const from = outward(world, x, y, z, r, h);
  let best = Infinity;
  for (const ring of RINGS) {
    if (ring >= best) break;
    const tries = ring === 0 ? 1 : ON_RING;
    for (let j = 0; j < tries; j++) {
      // Round from the way out, either side in turn.
      const step = j % 2 === 1 ? (j + 1) / 2 : -j / 2;
      const a = from + (step * TAU) / ON_RING;
      const px = x + detSin(a) * ring;
      const pz = z + detCos(a) * ring;
      const ground = groundUnder(hf, px, pz, r);
      const py = onGround || ground > y ? ground : y;
      const d = Math.hypot(ring, py - y);
      if (d >= best || !placeFree(world, px, py, pz, r, h) || !clearWay(world, x, y, z, px, py, pz, r, h, team, climb)) continue;
      best = d;
      freeAt.x = px;
      freeAt.y = py;
      freeAt.z = pz;
    }
  }
  return best < Infinity;
}

/** The heading, as detSin and detCos take it, of the shortest way out of the deepest box a body is in, or 0. */
function outward(world: ServerWorld, x: number, y: number, z: number, r: number, h: number): number {
  let deepest = 0;
  let ox = 0;
  let oz = 0;
  const top = y + (h > 2 * r ? h : 2 * r) + PAD;
  for (const store of [world.structs, world.nodes]) {
    if (!store) continue;
    const n = store.query(x - r, z - r, x + r, z + r, found, y - PAD, top);
    for (let i = 0; i < n; i++) {
      if (!capsuleBox(store, found.refs[i]!, x, y, z, r, h, SKIN) || push.depth <= deepest) continue;
      deepest = push.depth;
      ox = push.x;
      oz = push.z;
    }
  }
  return ox * ox + oz * oz > 1e-12 ? Math.atan2(ox, oz) : 0;
}

/** Whether a body goes from one place to the other in a straight line, never more than `climb` under the ground nor in a piece built by any team but `team`. */
function clearWay(world: ServerWorld, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, h: number, team: number, climb: number): boolean {
  const structs: StructureStore = world.structs;
  // Half a radius at a time, so no piece lies between two of the places tested.
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / (r * 0.5)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const z = z0 + (z1 - z0) * t;
    if (y < groundUnder(world.hf, x, z, r) - climb) return false;
    const m = structs.query(x - r, z - r, x + r, z + r, found, y - PAD, y + (h > 2 * r ? h : 2 * r) + PAD);
    for (let k = 0; k < m; k++) {
      const ref = found.refs[k]!;
      if (team !== 0 && structs.chunks[Math.floor(ref / 65536)]!.owner[ref & 0xffff] === team) continue;
      if (capsuleBox(structs, ref, x, y, z, r, h, SKIN)) return false;
    }
  }
  return true;
}

const scan = new Set<number>();
const inside: number[] = [];

/**
 * Sets each body in these chunks, or in those beside them, that is inside something at the place freePlace finds for it, its
 * fall begun there. A rider goes with its mount, and a ghost is left alone. A body with no such place stays where it is.
 * `moved` is told of each body moved. Returns how many were.
 */
export function settle(world: ServerWorld, chunks: readonly number[], moved?: (e: number) => void): number {
  const dims = world.dims;
  scan.clear();
  for (const chunk of chunks) {
    const cx = chunkCx(dims, chunk);
    const cz = chunkCz(dims, chunk);
    for (let z = Math.max(0, cz - 1); z <= Math.min(dims.chunksZ - 1, cz + 1); z++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(dims.chunksX - 1, cx + 1); x++) scan.add(z * dims.chunksX + x);
    }
  }
  // Found first and moved after, because a move may take a body from one chunk's list to another's.
  inside.length = 0;
  for (const chunk of [...scan].sort((a, b) => a - b)) gather(world, chunk, 0, 0, Infinity);
  return free(world, moved);
}

/** As `settle`, for the bodies within `reach` of (x, z), as when a node whose boxes reach that far grows back there. */
export function settleNear(world: ServerWorld, x: number, z: number, reach: number, moved?: (e: number) => void): number {
  const dims = world.dims;
  // A body is listed in the chunk its middle is in, and none is wider than this.
  const most = reach + 8;
  inside.length = 0;
  for (let cz = Math.max(0, Math.floor((z - most) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z + most) / CHUNK_SIZE)); cz++) {
    for (let cx = Math.max(0, Math.floor((x - most) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((x + most) / CHUNK_SIZE)); cx++) gather(world, cz * dims.chunksX + cx, x, z, reach);
  }
  return free(world, moved);
}

/** Adds to `inside` each body of a chunk, within `reach` of (x, z) by its edge, that is inside something. */
function gather(world: ServerWorld, chunk: number, x: number, z: number, reach: number): void {
  const { ents, reg } = world;
  for (let e = ents.chunkHead[chunk]!; e >= 0; e = ents.next[e]!) {
    if ((ents.flags[e]! & (F_ALIVE | F_PROP)) !== F_ALIVE || ents.seat[e] !== 0 || ents.mode[e] === MODE_GHOST) continue;
    const p = reg.move[ents.kind[e]!];
    if (!p || Math.hypot(ents.x[e]! - x, ents.z[e]! - z) >= reach + p.radius) continue;
    if (!placeFree(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, stanceHeight(p, ents.stance[e]!))) inside.push(e);
  }
}

function free(world: ServerWorld, moved?: (e: number) => void): number {
  const { ents, reg } = world;
  let n = 0;
  for (const e of inside) {
    const p = reg.move[ents.kind[e]!]!;
    if (!freePlace(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, stanceHeight(p, ents.stance[e]!), ents.team[e]!, p.stepUp)) continue;
    ents.setPosition(e, freeAt.x, freeAt.y, freeAt.z);
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    moved?.(e);
    n++;
  }
  return n;
}
