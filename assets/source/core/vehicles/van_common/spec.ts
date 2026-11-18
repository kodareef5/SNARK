import type { CreatureAsset, MaterialSpec, Vec3 } from "../../../../../tools/art/spec.ts";

// The body's hurt and decay layer is stored as fine as its base colour, the fittings' at half and the cabin's at a
// quarter, which pays for the body's within the texture budget.
const LAYER: Record<string, number> = { coach: 512, fittings: 256, cabin: 128 };
const material = (name: string, cutout = false): MaterialSpec => ({
  id: `core:road_van/${name}`, dir: import.meta.dir, tiles: name === "coach" ? 2.2 : name === "cabin" ? 1.65 : 1.12,
  base: `tex/${name}-base.png`, normal: `tex/${name}-normal.png`, packed: `tex/${name}-packed.png`,
  regions: { mask: `tex/${name}-mask.png` }, height: `tex/${name}-height.png`,
  hurt: `tex/${name}-hurt.png`, decay: `tex/${name}-decay.png`, cutout, tops: { layer: LAYER[name]! },
});

export function vanAsset(art: { id: string; bones: readonly string[]; anchors: Record<string, Vec3> }, paint: number, farTriangles = 480): CreatureAsset {
  return {
    kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
    skeleton: { id: art.id, root: "chassis", bones: art.bones.length, order: art.bones },
    zones: [], sockets: Object.entries(art.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
    regions: [{ name: "Paint", sample: paint }, { name: "Upholstery", sample: 104 }, { name: "Wheels", sample: 91 }],
    materials: { coach: material("coach"), fittings: material("fittings", true), cabin: material("cabin") },
    clips: [], feet: [], gaits: {}, flat: 2,
    budgets: { triangles: [31000, 14000, 6000, 2400, 960, farTriangles], texture: { top: 512, megabytes: 10, layer: 512 } },
  };
}
