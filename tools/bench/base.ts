// Bases of the player's own pieces as the bench lays them out: ARK box bases of rooms, in wood, stone and thatch. A base
// is a list of pieces, each with its pose and its slot in the base, and is set down by slot (`layBase`).

import type { Scene } from "../../client/core/render/scene.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { Frame, keyAt, poseOf } from "../../shared/world/lattice/frames.ts";
import { startBase } from "../../shared/world/lattice/place.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { Rng } from "../../shared/rng.ts";

/** A piece: its kind, place and turn, then the two words of its key in its base, whose first piece is the list's first. */
export type Piece = [kind: number, x: number, y: number, z: number, yaw: number, k0: number, k1: number];

const at = new Int32Array(4);
const key = { fr: 0, k0: 0, k1: 0 };

export const BASE_TIERS = ["wood", "stone", "thatch"] as const;

/**
 * The first `most` pieces of a box base on a 3 m lattice from (x0, z0), its foundations' feet at y0: n by n foundations,
 * then storey by storey the walls round it with a doorframe and its door on the first, a wall every `every` cells both
 * ways inside, and a ceiling over every cell.
 */
export function boxBase(reg: Registry, tier: string, x0: number, y0: number, z0: number, n: number, every: number, most: number): Piece[] {
  const [F, W, C, DF, D] = ["foundation", "wall", "ceiling", "doorframe", "door"].map((name) => reg.index.get(`core:${name}_${tier}`)!) as [number, number, number, number, number];
  const out: Piece[] = [];
  /** A piece whose slot's middle is (i, j) half-sides from the base's corner at `lvl`, its own +X along direction `own`. */
  const put = (kind: number, i: number, j: number, lvl: number, own: number, y: number): void => {
    at[0] = i;
    at[1] = at[2] = 0;
    at[3] = j;
    if (!keyAt(reg.forms, kind, at, 0, lvl, own, key)) throw new Error(`no slot for kind ${kind} at ${i}, ${j}`);
    // A piece along +Z is a quarter turn of yaw from the base.
    out.push([kind, x0 + i * 1.5, y, z0 + j * 1.5, own === 0 ? 0 : 16384, key.k0, key.k1]);
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) put(F, 2 * i + 1, 2 * j + 1, 0, 0, y0 + reg.halfY[F]!);
  for (let s = 0; out.length < most; s++) {
    const floor = y0 + 2 * reg.halfY[F]! + s * 3;
    for (let line = 0; line <= n; line++) {
      if (line !== 0 && line !== n && line % every !== 0) continue;
      for (let c = 0; c < n; c++) {
        const door = s === 0 && line === 0 && c === n >> 1;
        put(door ? DF : W, 2 * c + 1, 2 * line, 4 * s, 0, floor + reg.halfY[W]!);
        if (door) put(D, 2 * c + 1, 0, 0, 0, floor + reg.halfY[D]!);
        put(W, 2 * line, 2 * c + 1, 4 * s, 9, floor + reg.halfY[W]!);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) put(C, 2 * i + 1, 2 * j + 1, 4 * s + 4, 0, floor + 3 - reg.halfY[C]!);
  }
  return out.slice(0, most);
}

/**
 * Sets a base down by slot, owned by `owner`: its first piece begins the base where its pose is, and each of the rest
 * goes in its key. Returns the refs, in the list's order.
 */
export function layBase(structs: StructureStore, pieces: readonly Piece[], owner: number, hp: number | ((kind: number) => number)): number[] {
  const refs: number[] = [];
  let fr = 0;
  for (const [kind, x, y, z, yaw, k0, k1] of pieces) {
    const health = typeof hp === "number" ? hp : hp(kind);
    const ref = fr === 0 ? startBase(structs, kind, { x: Math.round(x * STRUCT_UNITS), y: Math.round(y * STRUCT_UNITS), z: Math.round(z * STRUCT_UNITS), yaw }, owner, health) : structs.place(kind, fr, k0, k1, owner, health);
    if (ref < 0) throw new Error(`piece ${refs.length} of the base does not go down`);
    if (fr === 0) fr = structs.frameAt(ref);
    refs.push(ref);
  }
  return refs;
}

const unmoved = new Frame(0, 0, 0, 0, 0, 0);
const offset = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };

/**
 * Sets pieces of bases down by slot where a list is not one whole base from its first piece: a chunk's share of several.
 * Each piece's base is told by where its key puts the base's corner, and `bases` holds the frames made, by that corner:
 * one that has gone with its last piece is made again. The bases stand unturned, as boxBase lays them. Returns the
 * refs, -1 for a piece whose slot is taken.
 */
export function layPieces(structs: StructureStore, reg: Registry, pieces: readonly Piece[], owner: number, hp: number, bases: Map<string, number> = new Map()): number[] {
  const refs: number[] = [];
  for (const [kind, x, y, z, , k0, k1] of pieces) {
    poseOf(unmoved, k0, k1, reg.forms, kind, offset);
    const [ox, oy, oz] = [Math.round(x * STRUCT_UNITS) - offset.x, Math.round(y * STRUCT_UNITS) - offset.y, Math.round(z * STRUCT_UNITS) - offset.z];
    const corner = `${ox} ${oy} ${oz}`;
    let fr = bases.get(corner);
    if (fr === undefined || !structs.frames.get(fr)) bases.set(corner, (fr = structs.frames.make(ox, oy, oz, 0, owner).gid));
    refs.push(structs.place(kind, fr, k0, k1, owner, hp));
  }
  return refs;
}

/** The bench map's 250 bases of 2,000 pieces, 42 m square with rooms of 3 by 3 cells, wood, stone and thatch by turns. */
export function benchBases(reg: Registry, hf: Heightfield): { centers: [number, number][]; pieces: Piece[][] } {
  const rng = new Rng(2026);
  const centers: [number, number][] = [];
  const pieces: Piece[][] = [];
  for (let b = 0; b < 250; b++) {
    const [cx, cz] = [Math.round(rng.range(400, 7790) / 3) * 3, Math.round(rng.range(400, 7790) / 3) * 3];
    centers.push([cx, cz]);
    pieces.push(boxBase(reg, BASE_TIERS[b % 3]!, cx - 21, hf.heightAt(cx, cz), cz - 21, 14, 3, 2000));
  }
  return { centers, pieces };
}

/** Every level that has materials drawn with them, as a client holding its textures draws it. */
export function asTextured(scene: Scene): void {
  const sections = scene.assets.table.sections;
  (scene.assets as unknown as { textured: (mesh: number, level: number) => boolean }).textured = (mesh, level) => (sections[mesh]![level]?.length ?? 0) > 0;
}
