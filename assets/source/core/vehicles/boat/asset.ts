import { BOAT_ART as B } from "../../../../../content/vehicles/boat-art.ts";
import { shared, type CreatureAsset, type MaterialSpec } from "../../../../../tools/art/spec.ts";

const maps = (name: string, folder = "tex", extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  tiles: name === "body" ? 9.0844 : name === "trim" ? 6.2164 : 11.9946,
  base: `${folder}/${name}_base.png`, normal: `${folder}/${name}_normal.png`, packed: `${folder}/${name}_packed.png`,
  regions: { mask: `${folder}/${name}_mask.png` }, height: `${folder}/${name}_height.png`,
  hurt: `${folder}/${name}_hurt.png`, decay: `${folder}/${name}_decay.png`, ...extra,
});

/** One measured craft and UV layout; the three original liveries share their interior and mechanical materials. */
export function boatAsset(livery: "civilian" | "rescue" | "police" = "civilian"): CreatureAsset {
  return {
    kind: "creature", source: { scripts: livery === "civilian" ? ["rig.py", "model.py"] : ["model.py"] }, scale: 1,
    skeleton: { id: B.id, root: "chassis", bones: B.bones.length, order: B.bones },
    zones: [], sockets: Object.entries(B.anchors).map(([name, at]) => {
      const engine = name === "engine" || name === "exhaust" || name === "propeller";
      const offset = engine ? at.map((v, k) => +(v - B.outboard.center[k]!).toFixed(5)) as [number, number, number] : at;
      return { name, bone: engine ? "outboard" : "chassis", offset };
    }),
    regions: [{ name: "Paint", sample: livery === "police" ? 83 : livery === "rescue" ? 46 : 103 },
      { name: "Stripe", sample: livery === "civilian" ? 86 : 232 }, { name: "Upholstery", sample: 101 }],
    materials: {
      body: shared(import.meta.dir, `core:boat/body_${livery}`, maps("body", livery === "civilian" ? "tex" : `tex/${livery}`)),
      trim: shared(import.meta.dir, "core:boat/trim", maps("trim")),
      cabin: shared(import.meta.dir, "core:boat/cabin", maps("cabin", "tex", { cutout: true })),
    },
    clips: [], feet: [], gaits: {},
    budgets: { triangles: [38000, 18000, 7000, 2600, 1000, 480], texture: { top: 2048, megabytes: 80, layer: 512 } },
    flat: 2, preserveBones: ["outboard", "propeller", "steering"],
  };
}
export default boatAsset();
