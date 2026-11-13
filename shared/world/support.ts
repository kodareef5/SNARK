// What holds a piece up.
//
// Nothing about support is stored. Whether a piece stands is worked out from
// the rows when it is asked: when a piece is about to be built, and when
// something near one has just gone.
//
// A foundation stands, and so does a pillar with its foot in the ground. What
// stands straight on those stands with them, however high: a wall on a
// foundation's edge, a wall on that wall, a pillar on a pillar. Everything
// else (a ceiling, and whatever stands on a ceiling away from the walls under
// it) is held sideways: it stands if, through pieces joined to it, it reaches
// something that stands straight up within a few metres on the flat. A door
// stands in its frame. A thing set down (a box, a vault) stands on the ground
// under it or on the floor it was set on, and holds nothing.
//
// A question is answered over a picture of the pieces around: who is joined
// to whom, and what each stands on. The picture of a piece is made once and
// kept until `forget` is called, so that many questions about one frozen
// world (a collapse being worked out) share it. A single question about a
// world that may have changed forgets first.
//
// Used by the server to judge and by the client to show the same judgement
// before asking.

import { STRUCT_UNITS } from "../coords.ts";
import { ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_PILLAR, ROLE_THING, ROLE_WALL, frameAxes, makeSockets, overPiece, socketsFor, units, type PieceTables } from "./snap.ts";
import type { StructureStore } from "./structures.ts";

/** How far on the flat a ceiling may be from what holds it, and how far anything standing on a ceiling may be: metres. */
export const CEILING_REACH = 6.5;
export const LOAD_REACH = 5;
/** A pillar whose foot is no more than this above the ground under it stands on the ground: lattice units. */
const FOOT = STRUCT_UNITS / 4;
/** How far from a piece another joined to it can be: two half-sides, and a little. */
const NEAR = 3.1;
/** What making the picture of one piece costs, in the units a collapse counts its work in; a step of a search costs one. */
export const COST_NODE = 24;

const sockets = makeSockets();
const axes = new Int32Array(4);

/** The picture of one piece: where it is, what it is joined to, and what it stands on. */
export interface SupportNode {
  /** Its ref, or -1 for a piece not yet built. */
  readonly ref: number;
  readonly kind: number;
  readonly role: number;
  /** Lattice units. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** It stands by itself: a foundation, or a pillar with its foot in the ground. */
  readonly root: boolean;
  /** The pieces joined to it: each in one of its places, or it in one of theirs. */
  readonly links: number[];
  /** Those of them it stands directly on; for a door, its frame. */
  readonly under: number[];
  /** Those of them that stand directly on it, by the same rule. */
  readonly over: number[];
  /** Whether it stands straight up, as far as is known: 0 not asked, 1 yes, 2 no. Good for the round it was asked in. */
  straight: number;
  round: number;
  /** The search that last passed through it. */
  seen: number;
  /** For whoever is working a collapse out over these pictures: its own note on this one. */
  mark: number;
}

export class Support {
  /** What the questions asked since this was last set to nought have cost: see COST_NODE. */
  work = 0;
  /** Pieces looked at by the last question asked. */
  visited = 0;
  /**
   * Work beyond which `standsNode` gives a question up rather than picture
   * another piece. A question given up (`cut`) has no answer; asked again it
   * gets further, because the pictures it made are kept and it always makes
   * at least one more. Without a limit no question is given up.
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

  /** Forget every picture: the world may have changed. */
  forget(): void {
    this.nodes.clear();
  }

  /** What stood straight up may not any more: something has gone. The pictures themselves are kept. */
  again(): void {
    this.round++;
  }

  /** Whether the piece a picture was made of is still there as it was. */
  alive(n: SupportNode): boolean {
    const t = this.structs.chunks[Math.floor(n.ref / 65536)];
    const slot = n.ref & 0xffff;
    return !!t && slot < t.high && t.kind[slot] === n.kind && units(t.x[slot]!) === n.x && units(t.y[slot]!) === n.y && units(t.z[slot]!) === n.z;
  }

  /** The picture of the piece at `ref`, made if it has not been; null if nothing is built there or it is not a building piece. */
  node(ref: number): SupportNode | null {
    const known = this.nodes.get(ref);
    if (known) return this.alive(known) ? known : null;
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0 || this.tables.role[t.kind[slot]!]! < 0) return null;
    // Out of allowance in the middle of a question: it is given up here, before the cost of another picture.
    if (this.asking && this.made > 0 && this.work > this.limit) {
      this.cut = true;
      return null;
    }
    this.made++;
    const n = this.describe(t.kind[slot]!, units(t.x[slot]!), units(t.y[slot]!), units(t.z[slot]!), t.yaw[slot]!, ref);
    this.nodes.set(ref, n);
    return n;
  }

  /** The picture of a piece of `kind` at (x, y, z) lattice units facing `yaw`: one built (`self` its ref) or one about to be (-1). */
  describe(kind: number, x: number, y: number, z: number, yaw: number, self: number): SupportNode {
    const { structs, tables } = this;
    const role = tables.role[kind]!;
    const half = units(tables.halfY[kind]!);
    const door = tables.doorway[kind] === 1;
    const links: number[] = [];
    const under: number[] = [];
    const over: number[] = [];
    // A pillar's foot may be a little above the ground and still be in it; a thing stands on the ground or it does not.
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
      // A thing joins nothing. It stands on the floor its foot is on, if its middle is over that floor.
      if (orole === ROLE_THING) continue;
      if (role === ROLE_THING) {
        if ((orole === ROLE_FOUNDATION || orole === ROLE_CEILING) && oy + ohalf === y - half && overPiece(ox, oz, t.yaw[slot]!, x, z)) {
          links.push(ref);
          under.push(ref);
        }
        continue;
      }
      // This piece in one of its places, or it in one of this piece's.
      const onIt = inPlace(orole, ohalf, tables.doorway[ok] === 1, ox, oy, oz, t.yaw[slot]!, role, half, x, y, z);
      let inMine = false;
      if (!onIt) {
        inMine = inPlace(role, half, door, x, y, z, yaw, orole, ohalf, ox, oy, oz);
        if (!inMine) continue;
      }
      links.push(ref);
      // What it stands on: a door, its frame; anything else, what its foot is on, but for a ceiling, which holds nothing straight up.
      if (role === ROLE_DOOR ? onIt && orole === ROLE_WALL : onIt && orole !== ROLE_CEILING && oy + ohalf === y - half) under.push(ref);
      // And what stands on it: the same, seen from below.
      if (orole === ROLE_DOOR ? role === ROLE_WALL : role !== ROLE_CEILING && y + half === oy - ohalf) {
        if (inMine || (onIt && inPlace(role, half, door, x, y, z, yaw, orole, ohalf, ox, oy, oz))) over.push(ref);
      }
    }
    return { ref: self, kind, role, x, y, z, root, links, under, over, straight: 0, round: 0, seen: 0, mark: 0 };
  }

  /** Whether the piece at `ref` stands, asked afresh. Something built that is not a building piece stands; nothing does not. */
  standsRef(ref: number): boolean {
    this.forget();
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    const n = this.node(ref);
    return n === null || this.standsNode(n);
  }

  /**
   * Whether a piece of `kind` at this place stands, asked afresh: one already
   * built (give its ref as `self`) or one about to be. Anything that is not a
   * building piece stands.
   */
  stands(kind: number, x: number, y: number, z: number, yaw: number, self = -1): boolean {
    this.visited = 0;
    if (this.tables.role[kind]! < 0) return true;
    this.forget();
    return this.standsNode(this.describe(kind, x, y, z, yaw, self));
  }

  /** Whether the piece of a picture stands, in the world as the pictures have it. If `cut` is set afterwards, the question was given up: see `limit`. */
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
    // Held sideways: through what it is joined to, as far as its reach.
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
        // A door holds nothing up, its own frame least of all, and joins nothing else.
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
   * Whether a piece stands straight up from the ground: it stands by itself,
   * or directly on something that does. A door: whether its frame is there. A
   * thing: whether what it was set on is there.
   */
  private straight(n: SupportNode, depth: number): boolean {
    if (n.root) return true;
    if (n.round === this.round && n.straight !== 0) return n.straight === 1;
    // Until it is known, it is taken not to: a ring of pieces cannot hold itself up. Deeper than anything can be built, likewise.
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
      // Given up part way: nothing is known of this piece after all.
      if (this.cut) {
        n.straight = 0;
        return false;
      }
    }
    return false;
  }

  /**
   * Every building piece that a piece at (x, z) lattice units could have been
   * helping to hold up: all within a ceiling's reach of it on the flat, at any
   * height. Their refs go to `out`; returns how many. When a piece goes, these
   * are the ones to look at again.
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

/** Whether a piece of role `b` at (bx, by, bz) is in one of the places a piece of role `a` at (ax, ay, az) facing `ayaw` offers it. */
function inPlace(a: number, ah: number, adoor: boolean, ax: number, ay: number, az: number, ayaw: number, b: number, bh: number, bx: number, by: number, bz: number): boolean {
  // No place is further up or down than the two pieces' half heights together.
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
