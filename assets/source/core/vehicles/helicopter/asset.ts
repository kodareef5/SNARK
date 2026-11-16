import { HELICOPTER_ART as H } from "../../../../../content/vehicles/helicopter-art.ts";
import { shared, type CreatureAsset, type MaterialSpec } from "../../../../../tools/art/spec.ts";

const maps = (name: string, folder = "tex", extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  tiles: name === "body" ? 11.0469 : name === "trim" ? 8.2517 : 12.7851,
  base: `${folder}/${name}_base.png`, normal: `${folder}/${name}_normal.png`, packed: `${folder}/${name}_packed.png`,
  regions: { mask: `${folder}/${name}_mask.png` }, height: `${folder}/${name}_height.png`,
  hurt: `${folder}/${name}_hurt.png`, decay: `${folder}/${name}_decay.png`, ...extra,
});

/** Liveries use one measured model, skeleton, UV layout, trim and cabin. Only their painted panels differ. */
export function helicopterAsset(livery: "civilian" | "rescue" | "police" = "civilian"): CreatureAsset {
  const body = livery === "civilian" ? "tex" : `tex/${livery}`;
  return {
    kind: "creature", source: { scripts: livery === "civilian" ? ["rig.py", "model.py"] : ["model.py"] }, scale: 1,
    skeleton: { id: H.id, root: "chassis", bones: H.bones.length, order: H.bones },
    zones: [], sockets: Object.entries(H.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
    regions: [{ name: "Paint", sample: livery === "police" ? 83 : livery === "rescue" ? 232 : 103 }, { name: "Stripe", sample: livery === "rescue" ? 46 : livery === "police" ? 232 : 86 }, { name: "Upholstery", sample: 101 }],
    materials: {
      body: shared(import.meta.dir, `core:helicopter/body_${livery}`, maps("body", body)),
      trim: shared(import.meta.dir, "core:helicopter/trim", maps("trim")),
      cabin: shared(import.meta.dir, "core:helicopter/cabin", maps("cabin", "tex", { cutout: true })),
    },
    clips: [], feet: [], gaits: {},
    budgets: { triangles: [38000, 18000, 7000, 2600, 1000, 480], texture: { top: 2048, megabytes: 80, layer: 512 } },
    flat: 2, preserveBones: ["rotor_main", "rotor_tail"],
  };
}

export default helicopterAsset();
