// The stress scene: the stress meshes, where the asset pack has them, stood about the spawn point. Three rocks hang in
// the sky ahead, each at a distance that asks for a different level. A level's triangles are all one colour, so the
// colour of a rock says which level is on the screen.

import type { Assets } from "./assets/assets.ts";
import type { Thing } from "./render/scene.ts";
import { Rng } from "../../shared/rng.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

export interface Mark {
  /** Index into the things, the level its distance asks for, and the middle of the rock. */
  thing: number;
  level: number;
  x: number;
  y: number;
  z: number;
}

/** The nearest distance at which a mesh seen afresh is drawn at `level` or coarser. */
function from(assets: Assets, mesh: number, level: number): number {
  let d = 1;
  while (d < 4000 && assets.choose(assets.table.error[mesh]!, d, -1) < level) d += 0.25;
  return d;
}

/**
 * Empty where the pack has no stress meshes. `at` is where the viewer stands, facing +Z, with eyes at height `eye`.
 * Everything on the ground stands well to one side or the other, clear of what the self-check looks at straight ahead.
 */
export function stressThings(assets: Assets, hf: Heightfield, at: { x: number; z: number }, eye: number): { things: Thing[]; marks: Mark[] } {
  const table = assets.table;
  const things: Thing[] = [];
  const marks: Mark[] = [];
  const spot = new Rng(5);
  /** A place on the ground `d` metres off, between 30 and 48 degrees to the left or the right. */
  const aside = (d: number, left: boolean): [number, number] => {
    const turn = ((left ? 1 : -1) * spot.range(30, 48) * Math.PI) / 180;
    return [at.x + Math.sin(turn) * d, at.z + Math.cos(turn) * d];
  };
  for (let i = 0; ; i++) {
    const mesh = table.find(`stress:rock_${String(i).padStart(2, "0")}`);
    if (mesh < 0) break;
    if (i < 3) {
      // The first three hang in the sky, each a third further off than where its level is first chosen: levels 1, 2 and 3.
      const d = from(assets, mesh, i + 1) * 1.3;
      const [turn, rise] = [((i - 1) * 14 * Math.PI) / 180, (16 * Math.PI) / 180];
      const [x, y, z] = [at.x - Math.sin(turn) * Math.cos(rise) * d, eye + Math.sin(rise) * d, at.z + Math.cos(turn) * Math.cos(rise) * d];
      marks.push({ thing: things.length, level: assets.choose(table.error[mesh]!, d, -1), x, y, z });
      // A rock's origin is under it. Its middle is a third of its bounding radius up.
      things.push({ mesh, x, y: y - table.radius[mesh]! / 3, z, level: -1 });
      continue;
    }
    const [x, z] = aside(spot.range(20, 300), i % 2 === 0);
    things.push({ mesh, x, y: hf.heightAt(x, z), z, level: -1 });
  }
  ["stress:bad_hash", "stress:bad_range", "stress:bad_short"].forEach((id, i) => {
    const mesh = table.find(id);
    if (mesh < 0) return;
    // Near enough that the finest level is wanted, which is the one listed wrongly.
    const [x, z] = aside(Math.max(2, from(assets, mesh, 1) * 0.6), i % 2 === 0);
    things.push({ mesh, x, y: hf.heightAt(x, z), z, level: -1 });
  });
  const plate = table.find("stress:plate");
  if (plate >= 0) things.push({ mesh: plate, x: at.x + 420, y: hf.heightAt(at.x + 420, at.z + 420) + 6, z: at.z + 420, level: -1 });
  return { things, marks };
}
