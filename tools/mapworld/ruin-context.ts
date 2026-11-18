import { hash3 } from "./raster.ts";
import { SIDES, worldPoint, type Frame } from "./ruin-geometry.ts";
import type { Rule, Vocabulary } from "./ruin-vocabulary.ts";

export interface Neighbour { frame: Frame; height: number; }

/**
 * Exposure and party edges follow geometry, independent of the order in which budgets admit buildings. `lattice` is what
 * turns engine metres into lattice metres (Grid in base.ts), on which the collapse's cells lie.
 */
export function contextualize(rule: Rule, frame: Frame, others: Neighbour[], water: number, built: number | null | undefined, v: Vocabulary, lattice: readonly [number, number]): Rule {
  const length = Math.hypot(...v.event.travel); const travel = v.event.travel.map((n) => n / length) as [number, number];
  let shelter = 0;
  const party: number[] = [];
  for (const other of others) {
    const dx = other.frame.x - frame.x; const dz = other.frame.z - frame.z;
    const upstream = -(dx * travel[0] + dz * travel[1]); const cross = Math.abs(dx * travel[1] - dz * travel[0]);
    if (upstream > 4 && upstream < 120 && cross < Math.min(other.frame.width, other.frame.depth) / 2 + 12 && other.height >= Math.min(16, rule.height)) shelter = Math.max(shelter, (1 - upstream / 150) * v.event.shelter);
    const angle = Math.abs(((other.frame.yaw - frame.yaw + 270) % 180) - 90);
    if (angle > v.frontage.angle || rule.height > 36 || other.height > 36) continue;
    const points = other.frame.rings[0]!.map(([u, z]) => worldPoint(other.frame, u, z)).map(([x, z]) => [(x - frame.x) * frame.c - (z - frame.z) * frame.s, (x - frame.x) * frame.s + (z - frame.z) * frame.c]);
    const loU = Math.min(...points.map((p) => p[0]!)); const hiU = Math.max(...points.map((p) => p[0]!));
    const loV = Math.min(...points.map((p) => p[1]!)); const hiV = Math.max(...points.map((p) => p[1]!));
    for (const [side, [u, z]] of SIDES.entries()) {
      const gap = u ? (u > 0 ? loU : -hiU) - frame.width / 2 : (z > 0 ? loV : -hiV) - frame.depth / 2;
      const overlap = u ? Math.min(frame.depth / 2, hiV) - Math.max(-frame.depth / 2, loV) : Math.min(frame.width / 2, hiU) - Math.max(-frame.width / 2, loU);
      if (gap >= -1 && gap <= v.frontage.gap && overlap >= 8 && !party.includes(side)) party.push(side);
    }
  }
  const age = built && built < 1940 ? .12 : built && built >= 2000 ? -.08 : 0;
  const exposure = Math.max(.05, Math.min(1, .18 + .82 * Math.exp(-water / v.event.reach) + age - shelter));
  const band = v.event.bands.find((b) => exposure < b.below) ?? v.event.bands.at(-1)!;
  const field = hash3(Math.floor((frame.x + lattice[0]) / v.event.cell), Math.floor((frame.z + lattice[1]) / v.event.cell), v.seed + 233);
  const collapse = rule.height > 60 ? (exposure > .48 ? "lost-top" : "hanging") : band.modes[field % band.modes.length]!;
  const damage = v.damage[collapse]!;
  return { ...rule, collapse, damage: { ...damage, radius: damage.radius * (.65 + exposure * .6) }, event: { travel, exposure, shelter }, party, roofGrowth: v.growth.roofChance, matched: [...rule.matched, `surge ${exposure.toFixed(2)}`, ...(shelter ? ["sheltered"] : []), ...(party.length ? ["party frontage"] : [])] };
}
