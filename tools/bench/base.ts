// Bases of the player's own pieces as the bench lays them out: ARK box bases of rooms, in wood, stone and thatch.

import type { Scene } from "../../client/core/render/scene.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { Rng } from "../../shared/rng.ts";

/** A piece: its kind, place and turn. */
export type Piece = [number, number, number, number, number];

export const BASE_TIERS = ["wood", "stone", "thatch"] as const;

/**
 * The first `most` pieces of a box base on a 3 m lattice from (x0, z0), its foundations' feet at y0: n by n foundations,
 * then storey by storey the walls round it with a doorframe and its door on the first, a wall every `every` cells both
 * ways inside, and a ceiling over every cell.
 */
export function boxBase(reg: Registry, tier: string, x0: number, y0: number, z0: number, n: number, every: number, most: number): Piece[] {
  const [F, W, C, DF, D] = ["foundation", "wall", "ceiling", "doorframe", "door"].map((name) => reg.index.get(`core:${name}_${tier}`)!) as [number, number, number, number, number];
  const out: Piece[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([F, x0 + i * 3 + 1.5, y0 + reg.halfY[F]!, z0 + j * 3 + 1.5, 0]);
  for (let s = 0; out.length < most; s++) {
    const floor = y0 + 2 * reg.halfY[F]! + s * 3;
    for (let line = 0; line <= n; line++) {
      if (line !== 0 && line !== n && line % every !== 0) continue;
      for (let c = 0; c < n; c++) {
        const door = s === 0 && line === 0 && c === n >> 1;
        out.push([door ? DF : W, x0 + c * 3 + 1.5, floor + reg.halfY[W]!, z0 + line * 3, 0]);
        if (door) out.push([D, x0 + c * 3 + 1.5, floor + reg.halfY[D]!, z0, 0]);
        out.push([W, x0 + line * 3, floor + reg.halfY[W]!, z0 + c * 3 + 1.5, 16384]);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([C, x0 + i * 3 + 1.5, floor + 3 - reg.halfY[C]!, z0 + j * 3 + 1.5, 0]);
  }
  return out.slice(0, most);
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
