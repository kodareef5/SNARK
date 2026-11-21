// The fleet's abandoned statics (README "Abandoned road vehicles"): rigid pieces a map sets in its streets, each folder
// <vehicle>_abandoned building them from the live vehicle's own model (parked.py) with pictures paint.py prepares from
// the live vehicle's. `bun run art -- core:<vehicle>_abandoned` builds one.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

export type Look = "abandoned" | "stripped" | "roof";

/** A material painted by paint.py into `tex/` (or `dir`'s), its normal and height maps the live vehicle's where it has them. */
export function prepared(name: string, extra: Partial<MaterialSpec> = {}): MaterialSpec {
  return { base: `tex/${name}_base.png`, packed: `tex/${name}_packed.png`, regions: { mask: `tex/${name}_mask.png` }, ...extra };
}

/**
 * The pieces of `vehicle`'s looks, drawn with `materials`. A street holds many: as the compact's, the finest level is made
 * from the model to the first budget, and only it has its materials (`flat: 1`); a static dyes region 0, its paint.
 */
export function abandonedAsset(vehicle: string, looks: readonly Look[], materials: Record<string, MaterialSpec>,
  triangles: readonly number[] = [6000, 2400, 960, 400], megabytes = 12): PiecesAsset {
  const name = `${vehicle}_abandoned`;
  return {
    kind: "pieces",
    source: { scripts: ["abandoned.py"] },
    pieces: looks.map((look) => {
      const object = look === "abandoned" ? name : `${name}_${look}`;
      return { id: `core:${object}`, object };
    }),
    materials,
    flat: 1,
    budgets: { triangles, texture: { top: 1024, megabytes } },
  };
}

/** The vans' three materials, one set for both as the live vans share theirs (van_common), painted into this folder. */
export function vanMaterials(): Record<string, MaterialSpec> {
  const tiles: Record<string, number> = { coach: 2.2, fittings: 1.12, cabin: 1.65 };
  return Object.fromEntries(Object.entries(tiles).map(([name, span]) => [name, {
    ...prepared(`road_van_${name}`), id: `core:road_van_abandoned/${name}`, dir: import.meta.dir, tiles: span,
    normal: `../van_common/tex/${name}-normal.png`, height: `../van_common/tex/${name}-height.png`, cutout: name === "fittings",
  }]));
}

/** A heavy road vehicle's livery (heavy_road), a palette atlas with no paint region: the live vehicle's own pictures. */
export const livery = (vehicle: string): Record<string, MaterialSpec> => ({ livery: { base: `../${vehicle}/livery.png`, packed: `../${vehicle}/orm.png` } });
