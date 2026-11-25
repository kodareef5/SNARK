// Bases built by slots, for tests: a first piece by its pose (`start`), then pieces joined to pieces already built
// (`join`), set down by their place on the base's squares (`set`), or by frame and key (`put`). Every piece goes down by
// `startBase` or `structs.place`, as the game sets one down, and `judge` asks `validate` what the server would say first.
//
// The short form names a slot as the tests always have: a piece, one of its places for the kind in hand by its number,
// and a turn. The places of a piece, in order:
//
//   on a foundation or a ceiling   a floor beside it, or a wall on its side: NORTH, EAST, SOUTH, WEST (its own +Z, +X, -Z, -X)
//                                  a pillar: ON its middle, or UNDER it; stairs: its one place
//   on a wall                      a wall: on top; a ceiling: OVER_FRONT (its own +Z) or OVER_BACK; a door in a doorway
//   on a pillar                    a pillar: ON it or UNDER it; a ceiling: centred on its top
//
// A wall on a side faces out, turn 1 faces it in. Stairs turn four ways.

import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { HALF_SIDE } from "../../shared/world/frame.ts";
import { LEVEL_UNITS } from "../../shared/world/lattice/basis.ts";
import { keyAt, ownDir, poseOf, type LatticeKey, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_VERTEX, SIDE, dirTurn, key1, keyAnchor, keyCls, keyDir, keyFlip, keyLayer, keyLvl, keyM3, keyRot, tupleStep } from "../../shared/world/lattice/module.ts";
import { makeVerdict, startBase, validate, type Site, type Verdict } from "../../shared/world/lattice/place.ts";
import { ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_PILLAR, ROLE_STAIRS, ROLE_WALL, type Pose } from "../../shared/world/snap.ts";
import { PUT_FREE, type StructureStore } from "../../shared/world/structures.ts";

const U = STRUCT_UNITS;

export const NORTH = 0, EAST = 1, SOUTH = 2, WEST = 3;
export const ON = 0, UNDER = 1;
export const OVER_FRONT = 0, OVER_BACK = 1;

/** What a test builds in: any world of the fixtures has both. */
export interface Built {
  readonly structs: StructureStore;
  readonly reg: Registry;
}

/** A place from the piece that offers it: half-sides along its own X and Z, levels up, and quarter turns to the new piece's facing. */
type Place = readonly [i: number, j: number, lvl: number, quarters: number];

const m = new Int32Array(8);
const list: Place[] = [];
const scratch: LatticeKey = { fr: 0, k0: 0, k1: 0 };
const at: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };

/** Whether the piece of kind `on` takes a leaf of `kind`. */
export function takes(reg: Registry, on: number, kind: number): boolean {
  const by = reg.forms.def[on]?.takes;
  return by !== undefined && (reg.forms.def[kind]?.hangs ?? []).includes(by);
}

/** The places the piece of kind `on` has for a piece of `kind`, to `list`. */
function placesOf(reg: Registry, on: number, kind: number): Place[] {
  const forms = reg.forms;
  const from = reg.role[on]!;
  const to = reg.role[kind]!;
  const floor = from === ROLE_FOUNDATION || from === ROLE_CEILING;
  const up = forms.span[on]!;
  const down = -forms.span[kind]!;
  list.length = 0;
  if (floor && (to === ROLE_CEILING || (to === ROLE_FOUNDATION && from === ROLE_FOUNDATION))) list.push([0, 2, 0, 0], [2, 0, 0, 0], [0, -2, 0, 0], [-2, 0, 0, 0]);
  else if (floor && to === ROLE_WALL) list.push([0, 1, 0, 0], [1, 0, 0, 1], [0, -1, 0, 2], [-1, 0, 0, 3]);
  else if (floor && to === ROLE_PILLAR) list.push([0, 0, 0, 0], [0, 0, down, 0]);
  else if (from === ROLE_PILLAR && to === ROLE_PILLAR) list.push([0, 0, up, 0], [0, 0, down, 0]);
  else if (floor && to === ROLE_STAIRS) list.push([0, 0, 0, 0]);
  else if (from === ROLE_WALL && to === ROLE_WALL) list.push([0, 0, up, 0]);
  else if (from === ROLE_WALL && to === ROLE_CEILING) list.push([0, 1, up, 0], [0, -1, up, 0]);
  // A doorway, or a wall that takes the leaf, as the server has it (lattice/place.ts).
  else if (from === ROLE_WALL && to === ROLE_DOOR && (reg.doorway[on] === 1 || takes(reg, on, kind))) list.push([0, 0, 0, 0]);
  else if (from === ROLE_PILLAR && to === ROLE_CEILING) list.push([0, 0, up, 0]);
  return list;
}

/**
 * The places a piece of kind `on` has for a piece of `kind`, in order: each as half-sides along its own X and Z from its
 * slot's middle to the new piece's, levels up, and quarter turns of yaw to the new piece's facing.
 */
export function places(reg: Registry, on: number, kind: number): readonly (readonly [i: number, j: number, lvl: number, quarters: number])[] {
  return reg.forms.cls[on]! < 0 || reg.forms.cls[kind]! < 0 ? [] : placesOf(reg, on, kind).slice();
}

/** How many places the piece `target` has for a piece of `kind`: 0 for a piece in no base. */
export function count(w: Built, target: number, kind: number): number {
  const t = w.structs.chunks[Math.floor(target / 65536)];
  const s = target & 0xffff;
  if (!t || s >= t.high || t.kind[s] === 0 || w.structs.frameAt(target) === 0 || w.reg.forms.cls[kind]! < 0) return 0;
  return placesOf(w.reg, t.kind[s]!, kind).length;
}

/**
 * The slot that place `k` of the piece `target` is for a piece of `kind` turned `turn`, to `out`. False where the piece
 * has no such place, is in no base, or the slot is off its base's lattice.
 */
export function slot(w: Built, target: number, kind: number, k: number, turn: number, out: LatticeKey): boolean {
  const { structs, reg } = w;
  const forms = reg.forms;
  if (k < 0 || k >= count(w, target, kind) || !structs.keyAt(target, out)) return false;
  const on = structs.chunks[Math.floor(target / 65536)]!.kind[target & 0xffff]!;
  const [i, j, lvl, quarters] = placesOf(reg, on, kind)[k]!;
  // The middle of the target's slot, and the direction of its own +X.
  const dir = keyDir(out.k1);
  const own = ownDir(forms, on, out.k1);
  const from = keyCls(out.k0);
  keyAnchor(out.k0, out.k1, m, 0);
  if (from === CLS_EDGE || from === CLS_SQUARE) tupleStep(m, 0, dir, SIDE / 2, m, 0);
  if (from === CLS_SQUARE) tupleStep(m, 0, dirTurn(dir, 3), SIDE / 2, m, 0);
  else if (from !== CLS_EDGE && from !== CLS_VERTEX) return false;
  tupleStep(m, 0, own, i, m, 0);
  tupleStep(m, 0, dirTurn(own, 3), j, m, 0);
  // A quarter turn of yaw is three directions back. A wall or a door turns by halves, stairs by quarters.
  const turns = forms.turns[kind]!;
  const facing = dirTurn(own, -3 * (quarters + (turn % turns) * (turns === 2 ? 2 : 1)));
  return keyAt(forms, kind, m, 0, keyLvl(out.k1) + lvl, facing, out);
}

/** The pose a piece of `kind` has in place `k` of `target`, in lattice units, to `out`. False as `slot` is. */
export function poseIn(w: Built, target: number, kind: number, k: number, turn: number, out: Pose): boolean {
  if (!slot(w, target, kind, k, turn, scratch)) return false;
  poseOf(w.structs.frames.get(scratch.fr)!, scratch.k0, scratch.k1, w.reg.forms, kind, at);
  out.x = at.x;
  out.y = at.y;
  out.z = at.z;
  out.yaw = at.yaw;
  return true;
}

/**
 * The slot of frame `fr` for a piece of `kind` by its place on the base's own squares, to `out`: its slot's middle (a
 * square's centre, an edge's middle, a post's foot) `i` half-sides along the base's +X and `j` along its +Z from the
 * base's origin, at level `lvl`, its own +X along direction `facing` of the twelve. False where its form has no such slot.
 */
export function spot(w: Built, fr: number, kind: number, i: number, j: number, lvl: number, facing: number, out: LatticeKey): boolean {
  m[0] = i;
  m[1] = m[2] = 0;
  m[3] = j;
  out.fr = fr;
  return keyAt(w.reg.forms, kind, m, 0, lvl, dirTurn(facing, 0), out);
}

/** Sets a piece of `kind` down in that slot, its frame's team's. Returns its ref, or -1 where there is no such slot or it is taken. */
export function set(w: Built, fr: number, kind: number, i: number, j: number, lvl = 0, facing = 0, hp = 1): number {
  const f = w.structs.frames.get(fr);
  if (!f || !spot(w, fr, kind, i, j, lvl, facing, scratch)) return -1;
  return w.structs.place(kind, fr, scratch.k0, scratch.k1, f.team, hp);
}

/** The key `key` names, `levels` higher. */
export function raised(key: LatticeKey, levels: number): LatticeKey {
  return { fr: key.fr, k0: key.k0, k1: key1(keyM3(key.k1), keyLvl(key.k1) + levels, keyDir(key.k1), keyLayer(key.k1), keyRot(key.k1), keyFlip(key.k1)) };
}

/**
 * The slot of frame `fr` that a pose in metres is, to `out`: for a house written out in metres on the 3 m squares of a
 * base that stands unturned. False where the base is turned or the pose is no slot of it.
 */
export function poseSlot(w: Built, fr: number, kind: number, x: number, y: number, z: number, yaw: number, out: LatticeKey): boolean {
  const f = w.structs.frames.get(fr);
  const forms = w.reg.forms;
  if (!f || f.yaw !== 0 || forms.cls[kind]! < 0 || (yaw & 16383) !== 0) return false;
  const i = (Math.round(x * U) - f.ox) / HALF_SIDE;
  const j = (Math.round(z * U) - f.oz) / HALF_SIDE;
  const lvl = (Math.round(y * U) - forms.atY[kind]! - f.oy) / LEVEL_UNITS;
  // A quarter turn of yaw is three directions back.
  return Number.isInteger(i) && Number.isInteger(j) && Number.isInteger(lvl) && spot(w, fr, kind, i, j, lvl, -3 * (yaw >> 14), out);
}

/**
 * For a house written out in metres: a function that sets each piece down by its pose, owned by `team`. The first built
 * piece begins a base, unturned, and each later one goes in the slot of it that its pose is; a thing is set down as it
 * is. It answers the ref, and throws for a pose that is no slot or a slot that is taken.
 */
export function metric(w: Built, team: number, hp = 1): (kind: number, x: number, y: number, z: number, yaw?: number) => number {
  let fr = 0;
  return (kind, x, y, z, yaw = 0) => {
    if (w.reg.forms.cls[kind]! < 0) return w.structs.add(kind, x, y, z, yaw, team, hp);
    const ref = fr === 0 ? start(w, kind, x, y, z, yaw, team, hp) : poseSlot(w, fr, kind, x, y, z, yaw, scratch) ? w.structs.place(kind, fr, scratch.k0, scratch.k1, team, hp) : -1;
    if (ref < 0) throw new Error(`no free slot of the base at ${x}, ${y}, ${z}`);
    if (fr === 0) fr = w.structs.frameAt(ref);
    return ref;
  };
}

/** The first piece of a new base, its collider's middle at (x, y, z) metres: a foundation, or a pillar. Returns its ref. */
export function start(w: Built, kind: number, x: number, y: number, z: number, yaw: number, team: number, hp = 1): number {
  return startBase(w.structs, kind, { x: Math.round(x * U), y: Math.round(y * U), z: Math.round(z * U), yaw: yaw & 0xffff }, team, hp);
}

/**
 * Sets a piece of `kind` down in place `k` of `target`, turned `turn`, whether or not anything holds it up. It is its
 * target's owner's unless `team` says. Returns its ref, or -1 where there is no such slot or it is taken.
 */
export function join(w: Built, target: number, kind: number, k: number, turn = 0, hp = 1, team = -1): number {
  if (!slot(w, target, kind, k, turn, scratch)) return -1;
  const owner = team >= 0 ? team : w.structs.chunks[Math.floor(target / 65536)]!.owner[target & 0xffff]!;
  return w.structs.place(kind, scratch.fr, scratch.k0, scratch.k1, owner, hp);
}

/** Sets a piece of `kind` down by its frame and key, as `structs.place` does. */
export function put(w: Built, kind: number, key: LatticeKey, team: number, hp = 1): number {
  return w.structs.place(kind, key.fr, key.k0, key.k1, team, hp);
}

const verdict = makeVerdict();

/**
 * What the server would say of a piece of `kind` in place `k` of `target`, turned `turn`, asked by a builder of the
 * target's team with no reach to keep: a RESULT_ code, and the verdict with its pose. -1 where there is no such slot.
 */
export function judge(site: Site, reg: Registry, target: number, kind: number, k: number, turn = 0, out: Verdict = verdict): number {
  const structs = site.structs;
  if (!slot({ structs, reg }, target, kind, k, turn, scratch)) return -1;
  return validate(site, kind, structs.chunks[Math.floor(target / 65536)]!.owner[target & 0xffff]!, scratch.fr, scratch.k0, scratch.k1, NaN, NaN, NaN, out);
}

/**
 * Sets every row of `from` in `to`, slot for slot, as a client that was sent them holds them: each base's frame under
 * its own number, a row in a base by its key and any other by its pose.
 */
export function mirror(from: StructureStore, to: StructureStore): void {
  for (const f of from.frames.all()) if (!to.frames.get(f.gid)) to.frames.make(f.ox, f.oy, f.oz, f.yaw, f.team, f.gid);
  from.chunks.forEach((t, chunk) => {
    if (!t) return;
    for (let s = 0; s < t.high; s++) {
      const fr = t.kind[s] !== 0 && t.fr ? t.fr[s]! : 0;
      to.put(chunk, s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, t.mod[s]!, fr > 0 ? fr : PUT_FREE, fr > 0 ? t.k0![s]! : 0, fr > 0 ? t.k1![s]! : 0);
    }
    to.setVersion(chunk, t.version);
  });
}
