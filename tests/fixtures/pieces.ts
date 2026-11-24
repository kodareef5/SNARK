// A base built as a builder builds it, without a client: each piece asked of `validate` with the server's own answers
// for what holds it up, and set down only where that says yes. Slots are named by lattice points, so a test reads as a
// plan: half-sides along the base's four directions, a level, and the way the piece's own +X runs.

import type { ClientSession } from "../../client/core/session.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { writeJoin } from "../../shared/net/place.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_SELECT, RESULT_OK } from "../../shared/net/protocol.ts";
import { partSolid, Solid } from "../../shared/world/convex.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { worldOf } from "../../shared/world/lattice/basis.ts";
import { keyAt, type Frame, type LatticeKey } from "../../shared/world/lattice/frames.ts";
import { DIRS, SIDE, dirTurn, keyAnchor, keyCls, keyDir, CLS_EDGE, elementCorners } from "../../shared/world/lattice/module.ts";
import { candidates, makeCandidates, makeVerdict, startBase, validate, type Candidates, type Site, type Verdict } from "../../shared/world/lattice/place.ts";
import { Support } from "../../shared/world/support.ts";
import type { Harness } from "./net.ts";
import type { TestWorld } from "./world.ts";

const U = STRUCT_UNITS;
export type Tuple = readonly number[];
export const O: Tuple = [0, 0, 0, 0];

/** `a` moved `n` half-sides along direction `d`. */
export function step(a: Tuple, d: number, n: number): number[] {
  const e = dirTurn(d, 0) * 4;
  return [0, 1, 2, 3].map((i) => a[i]! + n * DIRS[e + i]!);
}

/** The point `i` half-sides along the base's +X and `j` along its +Z. */
export const at = (i: number, j: number): number[] => [i, 0, 0, j];

/** What the server's checks ask of a world that has no server: support as it judges it, and nothing of bodies or tribes. */
export function siteOf(w: TestWorld, heightAt: (x: number, z: number) => number = (x, z) => w.hf.heightAt(x, z)): Site & { support: Support } {
  const support = new Support(w.structs, w.reg, heightAt);
  return {
    structs: w.structs,
    tables: w.reg,
    heightAt,
    support,
    stands: (kind, x, y, z) => support.stands(kind, x, y, z),
    standsAt: (kind, fr, k0, k1) => {
      const form = w.reg.forms.def[kind]!;
      const stability = support.stabilityAt(kind, fr, k0, k1);
      return stability >= 0 && stability >= (form.need ?? 0);
    },
  };
}

const m = new Int32Array(16);
const point = new Int32Array(2);

/**
 * The key of a piece of kind `id` whose slot's reference point is the lattice point `p` (a vertex itself, an edge's
 * middle, a square's centre, a triangle's first corner), at level `lvl`, its own +X along direction `own`.
 */
export function keyOf(w: TestWorld, fr: number, id: string, p: Tuple, lvl: number, own: number): LatticeKey {
  const out: LatticeKey = { fr, k0: 0, k1: 0 };
  m.set(p);
  if (!keyAt(w.reg.forms, w.kind(id), m, 0, lvl, dirTurn(own, 0), out)) throw new Error(`${id} has no slot at ${p.join()} along ${own}`);
  return out;
}

const verdict = makeVerdict();

/** A builder with no reach to keep, who sets a piece down only where the server would. */
export class Plot {
  readonly w: TestWorld;
  readonly site: Site & { support: Support };
  readonly team: number;
  fr = 0;
  readonly verdict: Verdict = verdict;

  constructor(w: TestWorld, team = 7, site = siteOf(w)) {
    this.w = w;
    this.team = team;
    this.site = site;
  }

  /** Begins the base with a foundation of kind `id` whose middle is at (x, z) metres on ground at height 0, turned `yaw`. */
  start(x: number, z: number, yaw: number, id = "core:foundation_wood"): number {
    const kind = this.w.kind(id);
    const ref = startBase(this.w.structs, kind, { x: Math.round(x * U), y: Math.round(this.w.reg.halfY[kind]! * U), z: Math.round(z * U), yaw: yaw & 0xffff }, this.team, 1);
    this.fr = this.w.structs.frameAt(ref);
    return ref;
  }

  get f(): Frame {
    return this.w.structs.frames.get(this.fr)!;
  }

  /** What the server says of the piece in that slot: a RESULT_ code. */
  judge(id: string, p: Tuple, lvl: number, own: number): number {
    const key = keyOf(this.w, this.fr, id, p, lvl, own);
    return validate(this.site, this.w.kind(id), this.team, key.fr, key.k0, key.k1, NaN, NaN, NaN, verdict);
  }

  /** Sets the piece down if the server would, and answers its ref. Throws with the code where it would not. */
  put(id: string, p: Tuple, lvl: number, own: number): number {
    const key = keyOf(this.w, this.fr, id, p, lvl, own);
    const code = validate(this.site, this.w.kind(id), this.team, key.fr, key.k0, key.k1, NaN, NaN, NaN, verdict);
    if (code !== RESULT_OK) throw new Error(`${id} at ${p.join()} level ${lvl} along ${own} is refused with ${code}`);
    const ref = this.w.structs.place(this.w.kind(id), key.fr, key.k0, key.k1, this.team, 1);
    if (ref < 0) throw new Error(`${id} at ${p.join()} has no room`);
    return ref;
  }

  /** The stability of a built piece. */
  stability(ref: number): number {
    return this.site.support.stability(ref);
  }

  /** Where the lattice point `p` is, in metres. */
  metres(p: Tuple): [number, number] {
    m.set(p);
    worldOf(this.f.basis, this.f.ox, this.f.oz, m, 0, point, 0);
    return [point[0]! / U, point[1]! / U];
  }

  /** The height of level `lvl`, in metres. */
  height(lvl: number): number {
    return this.f.oy / U + lvl * 0.75;
  }

  /** The slots a look straight down at the lattice point `p`, from 3 m over level `lvl`, offers a piece of kind `id`. */
  look(id: string, p: Tuple, lvl: number, out: Candidates = offered): Candidates {
    const [x, z] = this.metres(p);
    candidates(this.site, this.w.kind(id), this.team, x, this.height(lvl) + 3, z, 0, -1, 0, 3, out);
    return out;
  }

  /** Whether a look down at `p` offers the slot `keyOf` names. */
  offers(id: string, p: Tuple, lvl: number, own: number, from: Tuple = p, fromLvl = lvl): boolean {
    const key = keyOf(this.w, this.fr, id, p, lvl, own);
    const c = this.look(id, from, fromLvl);
    const cell = (key.k1 & ~((3 << 26) | (1 << 28))) >>> 0;
    for (let i = 0; i < c.n; i++) if (c.fr[i] === key.fr && c.k0[i] === key.k0 && c.k1[i] === cell) return true;
    return false;
  }
}

const offered = makeCandidates();
const solid = new Solid();

/** Where a piece's collider has its corners, as the game places them: each (x, y, z) in lattice units, not rounded. */
export function colliderCorners(w: TestWorld, ref: number): [number, number, number][] {
  const t = w.structs.chunks[Math.floor(ref / 65536)]!;
  const s = ref & 0xffff;
  const kind = t.kind[s]!;
  const parts = w.reg.parts;
  const out: [number, number, number][] = [];
  frameOf(t.yaw[s]!, t.twAt(s));
  const { cos, sin, stretch } = frame;
  for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) {
    for (let k = 0; k < 8; k++) {
      const lx = parts.box[p]! + (k & 1 ? 1 : -1) * parts.box[p + 3]!;
      const ly = parts.box[p + 1]! + (k & 4 ? 1 : -1) * parts.box[p + 4]!;
      const lz = parts.box[p + 2]! + (k & 2 ? 1 : -1) * parts.box[p + 5]!;
      out.push([(t.x[s]! + (cos * lx + sin * lz) * stretch) * U, (t.y[s]! + ly) * U, (t.z[s]! + (-sin * lx + cos * lz) * stretch) * U]);
    }
  }
  const hulls = parts.hulls!;
  for (let p = hulls.start[kind]!; p < hulls.start[kind + 1]!; p++) {
    partSolid(hulls, p, t.yaw[s]!, t.twAt(s), t.x[s]!, t.y[s]!, t.z[s]!, solid);
    for (let c = 0; c < solid.corners; c++) out.push([solid.at[c * 3]! * U, solid.at[c * 3 + 1]! * U, solid.at[c * 3 + 2]! * U]);
  }
  return out;
}

const corners = new Int32Array(16);

/** The lattice corners of the element a built piece's key names, in lattice units: a piece over several edges from its first end to its last. */
export function latticeCorners(w: TestWorld, ref: number): [number, number][] {
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  if (!w.structs.keyAt(ref, key)) return [];
  const f = w.structs.frames.get(key.fr)!;
  const cls = keyCls(key.k0);
  const kind = w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  keyAnchor(key.k0, key.k1, m, 0);
  let n = elementCorners(cls, m, 0, keyDir(key.k1), corners, 0);
  if (cls === CLS_EDGE) {
    const wide = w.reg.forms.wide[kind]!;
    for (let k = 0; k < 4; k++) corners[4 + k] = m[k]! + wide * SIDE * DIRS[keyDir(key.k1) * 4 + k]!;
    n = 2;
  }
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    worldOf(f.basis, f.ox, f.oz, corners, 4 * i, point, 0);
    out.push([point[0]!, point[1]!]);
  }
  return out;
}

/**
 * The first fault in how a built piece's collider sits on its slot, or "": every lattice corner of the slot is a corner
 * of the collider in plan (for an edge's piece, of its middle line), to a thousandth of a lattice unit.
 */
export function cornerFault(w: TestWorld, ref: number): string {
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  w.structs.keyAt(ref, key);
  const got = colliderCorners(w, ref);
  const want = latticeCorners(w, ref);
  const edge = keyCls(key.k0) === CLS_EDGE;
  for (const [x, z] of want) {
    let found = false;
    // A post stands about its vertex.
    if (want.length === 1) found = Math.abs(got.reduce((sum, c) => sum + c[0], 0) / got.length - x) < 1e-3 && Math.abs(got.reduce((sum, c) => sum + c[2], 0) / got.length - z) < 1e-3;
    else if (!edge) found = got.some((c) => Math.abs(c[0] - x) < 1e-3 && Math.abs(c[2] - z) < 1e-3);
    // A wall's faces are either side of its edge's line: two of its corners have the edge's end between them.
    else for (const a of got) for (const b of got) found ||= a !== b && Math.abs((a[0] + b[0]) / 2 - x) < 1e-3 && Math.abs((a[2] + b[2]) / 2 - z) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
    if (!found) return `no collider corner at the lattice's ${x},${z}`;
  }
  return "";
}

/**
 * Gives a survivor with cheats `n` of the item `core:<item>` and puts it in hand, in the hotbar's last slot. The item
 * that was there goes back to the bag.
 */
export function hand(h: Harness, s: ClientSession, item: string, n = 30): void {
  const id = h.reg.index.get(`core:${item}`)!;
  const inv = s.inventory!;
  const last = inv.hotbar + 9;
  if (inv.item[last] !== id) {
    h.say(s, `give ${item} ${n}`);
    h.run(60);
    let from = -1;
    for (let i = 0; i < inv.item.length && from < 0; i++) if (inv.item[i] === id && i !== last) from = i;
    if (from < 0) throw new Error(`no ${item} was given`);
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(last), w.u16(0), w.u16(id)));
    h.run(100);
    if (inv.item[last] !== id) throw new Error(`${item} did not come to hand`);
  }
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(9));
  h.run(100);
}

/** Sends CMD_PLACE for the piece in hand in a slot, in the form `variant`. Answers the server's code and the ref it built, or -1. */
export function send(h: Harness, s: ClientSession, variant: number, key: LatticeKey): { code: number; ref: number } {
  let code = -1;
  s.onResult = (_seq, c) => void (code = c);
  const before = h.host.build.placed;
  s.command(CMD_PLACE, (w: BitWriter) => writeJoin(w, variant, key.fr, key.k0, key.k1));
  h.run(150);
  return { code, ref: h.host.build.placed > before ? h.host.build.last : -1 };
}
