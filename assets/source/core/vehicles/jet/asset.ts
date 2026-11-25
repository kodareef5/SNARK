// The XF-51 Wraith (content/vehicles/jet.ts), from mgg8's CC0 fighter model (ref/SOURCES.md), reshaped, repainted and renamed.
//
//   blender -b --factory-startup --disable-autoexec --python-exit-code 1 \
//       --python assets/source/core/vehicles/jet/convert.py -- assets/raw/mgg8/f-35b/f-35b_lightning_ii__raf_617_squadron.glb
//   python3 assets/source/core/vehicles/jet/paint.py
//   bun run art -- core:jet
//
// convert.py writes jet.glb, the rig's measures (content/vehicles/jet-rig.json) and where paint.py paints
// (tex/layout.json); model.py rigs jet.glb on those bones. Its paint is colour region 0 and its darker greys region 1,
// as content/vehicles/jet.ts names them; its lines of light and its afterburner glow on their own material.
import rig from "../../../../../content/vehicles/jet-rig.json" with { type: "json" };
import type { CreatureAsset, MaterialSpec } from "../../../../../tools/art/spec.ts";

const order = Object.keys(rig.pivots);
const PAINT: MaterialSpec = { base: "tex/paint_base.png", normal: "tex/paint_normal.png", packed: "tex/paint_packed.png", regions: { mask: "tex/paint_mask.png" }, height: "tex/paint_height.png" };

export function jetAsset(scripts: readonly string[] = ["model.py"]): CreatureAsset {
  return {
    kind: "creature", source: { scripts }, scale: 1,
    modelCredit: "mgg8 · CC0",
    skeleton: { id: "core:jet", root: "chassis", bones: order.length, order },
    zones: [], clips: [], feet: [], gaits: {},
    sockets: Object.entries(rig.anchors).map(([name, p]) => ({ name, bone: "chassis", offset: [p[0]!, p[1]!, p[2]!] })),
    regions: [{ name: "Paint", sample: 86 }, { name: "Panel lines", sample: 83 }],
    materials: {
      paint: PAINT,
      // Smoked glass, its inside never drawn: from the seat the canopy's faces look away and are not there.
      glass: { base: "tex/glass_base.png", packed: "tex/glass_packed.png", flat: [40, 46, 54] },
      // Cyan-white lines of light, and the burner's core; as bright as a lamp by day, held to their colour by night.
      glow: { base: "tex/glow_base.png", packed: "tex/glow_packed.png", emissive: 2.4, flat: [190, 245, 255] },
    },
    preserveBones: ["stabilator_left", "stabilator_right"], holdParts: true,
    flat: 2,
    budgets: { triangles: [18000, 9000, 2600, 1000, 480], texture: { top: 1024, megabytes: 12 } },
  };
}

export default jetAsset();
