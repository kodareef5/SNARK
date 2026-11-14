// Support is never stored. Whether a piece stands is worked out from the rows, by the server to judge and by the client to show
// the same judgement before asking. Nodes are cached until forget(), so the questions of one collapse share them.

import { STRUCT_UNITS } from "../coords.ts";
import { ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_PILLAR, ROLE_THING, ROLE_WALL, frameAxes, makeSockets, overPiece, socketsFor, units, type PieceTables } from "./snap.ts";
import type { StructureStore } from "./structures.ts";

/** Horizontal metres a ceiling may be from a piece that stands straight up. LOAD_REACH is the same for any other piece held sideways. */
export const CEILING_REACH = 6.5;
export const LOAD_REACH = 5;
/** Lattice units. A pillar whose foot is at most this far above the ground stands on the ground. */
const FOOT = STRUCT_UNITS / 4;
/** Metres. A joined piece is at most two half-sides away, plus a little. */
const NEAR = 3.1;
/** Work units to build one node. A search step costs 1. */
export const COST_NODE = 24;

const sockets = makeSockets();
const axes = new Int32Array(4);

/** A cached description of one piece: its place, its links, and what it stands on. */
export interface SupportNode {
  /** -1 for a piece not yet built. */
  readonly ref: number;
  readonly kind: number;
  readonly role: number;
  /** Lattice units. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Stands by itself: a foundation, a pillar with its foot in the ground, or a thing on the ground. */
  readonly root: boolean;
  /** Refs of the pieces joined to it. Either sits in a socket of the other. */
  readonly links: number[];
  /** The links it stands directly on. For a door, its frame. */
  readonly under: number[];
  /** The links that stand directly on it. */
  readonly over: number[];
  /** Whether it stands straight up: 0 not asked, 1 yes, 2 no. Valid only for the round in `round`. */
  straight: number;
  round: number;
  /** Id of the search that last visited it. */
  seen: number;
  /** Scratch for the Collapse that uses these nodes. */
  mark: number;
}

export class Support {
  /** Work done since the caller last zeroed it. See COST_NODE. */
  work = 0;
  /** Pieces the last question visited. */
  visited = 0;
  /**
   * Past this much work standsNode gives a question up instead of building another node, and sets `cut`. A cut question has no
   * answer. Asked again it gets further, because the nodes are kept and each ask builds at least one more.
   */
  limit = Infinity;
  cut = false;
  private asking = false;
  private made = 0;
  private readonly structs: StructureStore;
  private readonly tables: PieceTables;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly nodes = new Map<number, SupportNode>();
  private readonly near = new Uint32Array(256);
  private readonly queue: SupportNode[] = [];
  private round = 1;
  private search = 0;

  constructor(structs: StructureStore, tables: PieceTables, heightAt: (x: number, z: number) => number) {
    this.structs = structs;
    this.tables = tables;
    this.heightAt = heightAt;
  }

  /** Drops every cached node. Call when the world may have changed. */
  forget(): void {
    this.nodes.clear();
  }

  /** Invalidates the straight-up answers after a piece is removed. The nodes are kept. */
  again(): void {
    this.round++;
  }

  /** Whether the piece a node was made of is still there with the same kind and position. */
  alive(n: SupportNode): boolean {
    const t = this.structs.chunks[Math.floor(n.ref / 65536)];
    const slot = n.ref & 0xffff;
    return !!t && slot < t.high && t.kind[slot] === n.kind && units(t.x[slot]!) === n.x && units(t.y[slot]!) === n.y && units(t.z[slot]!) === n.z;
  }

  /** The node of the piece at `ref`, built on first use. Null if nothing is built there, it is not a building piece, or the question was cut. */
  node(ref: number): SupportNode | null {
    const known = this.nodes.get(ref);
    if (known) return this.alive(known) ? known : null;
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0 || this.tables.role[t.kind[slot]!]! < 0) return null;
    // The budget ran out mid-question. Give up before paying for another node.
    if (this.asking && this.made > 0 && this.work > this.limit) {
      this.cut = true;
      return null;
    }
    this.made++;
    const n = this.describe(t.kind[slot]!, units(t.x[slot]!), units(t.y[slot]!), units(t.z[slot]!), t.yaw[slot]!, ref);
    this.nodes.set(ref, n);
    return n;
  }

  /** Builds the node of a piece of `kind` at (x, y, z) lattice units facing `yaw`. `self` is its ref, or -1 for a piece not yet built. */
  describe(kind: number, x: number, y: number, z: number, yaw: number, self: number): SupportNode {
    const { structs, tables } = this;
    const role = tables.role[kind]!;
    const half = units(tables.halfY[kind]!);
    const door = tables.doorway[kind] === 1;
    const links: number[] = [];
    const under: number[] = [];
    const over: number[] = [];
    // A pillar's foot may be up to FOOT above the ground. A thing gets no such margin.
    const ground = role === ROLE_PILLAR || role === ROLE_THING ? Math.ceil(this.heightAt(x / STRUCT_UNITS, z / STRUCT_UNITS) * STRUCT_UNITS) : 0;
    const root = role === ROLE_FOUNDATION || (role === ROLE_PILLAR && y - half <= ground + FOOT) || (role === ROLE_THING && y - half <= ground);
    const mx = x / STRUCT_UNITS;
    const mz = z / STRUCT_UNITS;
    const near = this.near;
    const n = structs.query(mx - NEAR, mz - NEAR, mx + NEAR, mz + NEAR, near);
    this.work += COST_NODE + n;
    for (let i = 0; i < n; i++) {
      const ref = near[i]!;
      if (ref === self) continue;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const ok = t.kind[slot]!;
      const orole = tables.role[ok]!;
      if (orole < 0) continue;
      const ox = units(t.x[slot]!);
      const oy = units(t.y[slot]!);
      const oz = units(t.z[slot]!);
      const ohalf = units(tables.halfY[ok]!);
      // A thing joins nothing. It stands on the floor under its foot, if its middle is over that floor.
      if (orole === ROLE_THING) continue;
      if (role === ROLE_THING) {
        if ((orole === ROLE_FOUNDATION || orole === ROLE_CEILING) && oy + ohalf === y - half && overPiece(ox, oz, t.yaw[slot]!, x, z)) {
          links.push(ref);
          under.push(ref);
        }
        continue;
      }
      // Either this piece sits in a socket of the other, or the other sits in a socket of this piece.
      const onIt = inPlace(orole, ohalf, tables.doorway[ok] === 1, ox, oy, oz, t.yaw[slot]!, role, half, x, y, z);
      let inMine = false;
      if (!onIt) {
        inMine = inPlace(role, half, door, x, y, z, yaw, orole, ohalf, ox, oy, oz);
        if (!inMine) continue;
      }
      links.push(ref);
      // A door stands on its frame. Any other piece stands on what its foot is on, except that a ceiling holds nothing straight up.
      if (role === ROLE_DOOR ? onIt && orole === ROLE_WALL : onIt && orole !== ROLE_CEILING && oy + ohalf === y - half) under.push(ref);
      // The same rule from below gives what stands on it.
      if (orole === ROLE_DOOR ? role === ROLE_WALL : role !== ROLE_CEILING && y + half === oy - ohalf) {
        if (inMine || (onIt && inPlace(role, half, door, x, y, z, yaw, orole, ohalf, ox, oy, oz))) over.push(ref);
      }
    }
    return { ref: self, kind, role, x, y, z, root, links, under, over, straight: 0, round: 0, seen: 0, mark: 0 };
  }

  /** Asked afresh. A built structure that is not a building piece stands, and an empty ref does not. */
  standsRef(ref: number): boolean {
    this.forget();
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    const n = this.node(ref);
    return n === null || this.standsNode(n);
  }

  /** Asked afresh, for a piece already built (pass its ref as `self`) or one about to be. A kind that is not a building piece stands. */
  stands(kind: number, x: number, y: number, z: number, yaw: number, self = -1): boolean {
    this.visited = 0;
    if (this.tables.role[kind]! < 0) return true;
    this.forget();
    return this.standsNode(this.describe(kind, x, y, z, yaw, self));
  }

  /** Uses the cached nodes as they are. If `cut` is set afterwards, the question was given up (see `limit`). */
  standsNode(n: SupportNode): boolean {
    this.visited = 0;
    this.cut = false;
    this.made = 0;
    this.asking = true;
    const stands = this.ask(n);
    this.asking = false;
    return stands;
  }

  private ask(n: SupportNode): boolean {
    if (this.straight(n, 0)) return true;
    if (this.cut || n.role === ROLE_DOOR || n.role === ROLE_THING) return false;
    // Held sideways. Search its links for a piece that stands straight up within reach.
    const reach = (n.role === ROLE_CEILING ? CEILING_REACH : LOAD_REACH) * STRUCT_UNITS;
    const reach2 = reach * reach;
    const queue = this.queue;
    const search = ++this.search;
    queue.length = 0;
    n.seen = search;
    queue.push(n);
    for (let at = 0; at < queue.length; at++) {
      const from = queue[at]!;
      for (const ref of from.links) {
        const o = this.node(ref);
        if (this.cut) return false;
        // A door holds nothing up, and the search does not pass through one.
        if (!o || o.seen === search || o.role === ROLE_DOOR) continue;
        o.seen = search;
        const dx = o.x - n.x;
        const dz = o.z - n.z;
        if (dx * dx + dz * dz > reach2) continue;
        this.visited++;
        this.work++;
        if (this.straight(o, 0)) return true;
        if (this.cut) return false;
        queue.push(o);
      }
    }
    return false;
  }

  /**
   * Whether a piece stands by itself or directly on a piece that does. For a door, whether its frame is there. For a thing, whether
   * the piece it was set on is there.
   */
  private straight(n: SupportNode, depth: number): boolean {
    if (n.root) return true;
    if (n.round === this.round && n.straight !== 0) return n.straight === 1;
    // Marked as not standing until known, so a ring of pieces cannot hold itself up. The depth cap is deeper than anything can be built.
    n.round = this.round;
    n.straight = 2;
    if (depth > 400) return false;
    for (const ref of n.under) {
      const o = this.node(ref);
      this.work++;
      if (o && (n.role === ROLE_DOOR || n.role === ROLE_THING || this.straight(o, depth + 1))) {
        n.straight = 1;
        return true;
      }
      // The question was cut, so nothing is known about this piece.
      if (this.cut) {
        n.straight = 0;
        return false;
      }
    }
    return false;
  }

  /**
   * Every building piece that a piece at (x, z) lattice units could have been helping to hold up: all within a ceiling's reach
   * horizontally, at any height. Writes their refs to `out` and returns how many.
   */
  dependents(x: number, z: number, self: number, out: Uint32Array): number {
    const { structs, tables } = this;
    const mx = x / STRUCT_UNITS;
    const mz = z / STRUCT_UNITS;
    const far = CEILING_REACH + 0.1;
    const n = structs.query(mx - far, mz - far, mx + far, mz + far, out);
    this.work += COST_NODE + n;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const ref = out[i]!;
      if (ref === self) continue;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      if (tables.role[t.kind[slot]!]! < 0) continue;
      const dx = t.x[slot]! - mx;
      const dz = t.z[slot]! - mz;
      if (dx * dx + dz * dz <= far * far) out[count++] = ref;
    }
    return count;
  }
}

/** Whether a piece of role `b` at (bx, by, bz) sits in one of the sockets a piece of role `a` at (ax, ay, az) facing `ayaw` offers it. */
function inPlace(a: number, ah: number, adoor: boolean, ax: number, ay: number, az: number, ayaw: number, b: number, bh: number, bx: number, by: number, bz: number): boolean {
  // No socket is further up or down than the two half heights together.
  const dy = by - ay;
  if (dy > ah + bh || dy < -(ah + bh)) return false;
  socketsFor(a, b, ah, bh, adoor, sockets);
  if (sockets.n === 0) return false;
  frameAxes(ayaw, axes);
  const dx = bx - ax;
  const dz = bz - az;
  for (let k = 0; k < sockets.n; k++) {
    if (sockets.dy[k] !== dy) continue;
    const i = sockets.i[k]!;
    const j = sockets.j[k]!;
    if (i * axes[0]! + j * axes[2]! === dx && i * axes[1]! + j * axes[3]! === dz) return true;
  }
  return false;
}
