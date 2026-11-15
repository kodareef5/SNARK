// The crafting stations, built by model.py (see it for what each is): the mortar and pestle, the smithy, the refining
// forge, the fabricator and the preserving bin, and the lit forms of the last three. Each replaces the grey box of the
// structure with its id (assets/source/README.md); a piece whose structure content does not have yet waits harmlessly
// until it does, and is then drawn at once.
//
// Seven materials, three at most on a station, and a station's fire is one of the three. Five are other assets' own,
// named by the ids their packs give them and read from their folders, so the game holds one copy of each: the stone
// tools' stone and lashing, the weapons' hide, the wood tier's boards and the stone tier's iron. Two are new, each a
// layer set the image model made from the brief beside it: kiln (fire-blackened stone in clay over fired clay, a trim
// sheet) and plate (a riveted seam, bare steel and green-grey painted steel, a trim sheet). The fire itself, "ash" and
// "ember", and the fabricator's "glass" and "lamp", have no pictures and are drawn in their palette colours.

import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import tools from "../../items/stone-tools/asset.ts";
import { HIDE } from "../../items/weapons/materials.ts";
import stone from "../stone/asset.ts";
import wood from "../wood/asset.ts";

const TOOLS = join(import.meta.dir, "../../items/stone-tools");
const fromTools = (name: "lashing" | "stone"): MaterialSpec => shared(TOOLS, `core:stone-tools/${name}`, tools.materials[name]);

/**
 * A layer set of this asset under tex/<name>/, at its 1,024 set: over the kiln's 2 m and the plate's 1.5 m that is 512
 * and 683 pixels a metre, about the building tiers' density (2,048 over 3 m), which a station seen from a step or two
 * away shares. The 2,048 sets are rebuilt by their scripts and not kept.
 */
function own(name: string, tiles: number): MaterialSpec {
  const at = (layer: string): string => `tex/${name}/${name}_${layer}_1024.png`;
  return { base: at("base"), normal: at("normal"), packed: at("orm"), height: at("height"), tiles };
}

/**
 * The view a station's inventory picture is drawn from (tools/pack/icons.ts draws a structure's item from the mesh it
 * places): from its front, which faces the engine's -Z, a little to its right and above, standing upright. The usual
 * view would turn a station longer than it is tall onto the picture's diagonal, as it does a held tool.
 */
const ICON = { around: Math.PI - 0.6, above: 0.42, roll: 0 };

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:mortar", object: "mortar", icon: ICON },
    { id: "core:smithy", object: "smithy", icon: ICON },
    { id: "core:forge", object: "forge", icon: ICON },
    { id: "core:forge_lit", object: "forge_lit", icon: ICON },
    { id: "core:fabricator", object: "fabricator", icon: ICON },
    { id: "core:fabricator_lit", object: "fabricator_lit", icon: ICON },
    { id: "core:preserving_bin", object: "preserving_bin", icon: ICON },
    { id: "core:preserving_bin_lit", object: "preserving_bin_lit", icon: ICON },
  ],
  // Metres a picture spans, as kit.py's TILE lays them.
  materials: {
    stone: fromTools("stone"),
    lashing: fromTools("lashing"),
    hide: HIDE,
    boards: shared(join(import.meta.dir, "../wood"), "core:wood/boards", wood.materials.boards),
    iron: shared(join(import.meta.dir, "../stone"), "core:stone/iron", { ...stone.materials.iron, tiles: 3 }),
    kiln: own("kiln", 2.0),
    // Under the sky the plate's grey-green reads blue-grey, so it is warmed toward the green its brief asked for, and is
    // drawn flat in that colour.
    plate: { ...own("plate", 1.5), tint: [0.98, 1.08, 0.82], flat: [98, 110, 92] },
  },
  // Levels 0 and 1 keep their materials, 2 and on are flat. Proposed as a station's budget, the next entry of "asset
  // budgets per device" after the held item's (D416): triangles 3,000, 1,200, 300, 120 (a station stands alone or in a
  // few, seen from a step away when opened and among a base's walls from across it, so between a held tool's 1,200 and a
  // wall's 2,400 to 3,200); its far level within 10 cm of its finest, made by hand where the made one is not (model.py);
  // at most three materials, a fire one of them; the building tiers' density, about 500 to 700 pixels a metre, on its own
  // materials; and 80 MB of textures for the asset in the RGBA variant, other assets' shared materials counted in it
  // though the game holds them once. The pieces today are 450 to 1,000 triangles at their finest, chunky flat-faceted
  // solids, then 300, then 100 to 120.
  flat: 2,
  budgets: { triangles: [3000, 1200, 300, 120], texture: { top: 2048, megabytes: 80 } },
} satisfies PiecesAsset;
