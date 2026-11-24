import type { MaterialSpec } from "../../../../../tools/art/spec.ts";

/** The air freight machines' two materials: the swatch atlas, and the lenses that glow. Paths are from an asset's folder. */
export function airMaterials(top: number): Record<string, MaterialSpec> {
  const tex = "../air_freight/tex";
  return {
    hull: { base: `${tex}/hull_base.png`, normal: `${tex}/hull_normal.png`, packed: `${tex}/hull_packed.png`, tops: { base: top, normal: top, mro: top / 2 } },
    lamp: { base: `${tex}/lamp_base.png`, packed: `${tex}/lamp_packed.png`, tops: { mro: 64 }, emissive: 1.2, flat: [255, 150, 38] },
  };
}
