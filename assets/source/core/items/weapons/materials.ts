// The materials of the weapon assets (bows/, firearms/, thrown/), said once. Four are the stone tools' own (D416: a
// family's shared materials count once), named by the ids the stone-tools pack gives them and read from its folder, so
// the game holds one copy of each whichever pack draws it. Two are new: steel (firearms/tex/steel) and hide
// (thrown/tex/hide), each a layer set the image model made from the brief beside it.
//
// Every material is held at about 5,100 pixels a metre, as the stone tools are: a held item 0.25 to 0.5 m from the eye
// on a 4K screen. The 0.2 m tiles of steel and hide at their 1,024 sets; their 2,048 sets are rebuilt by their scripts
// and not kept.

import { join } from "node:path";
import { shared, type MaterialSpec } from "../../../../../tools/art/spec.ts";
import tools from "../stone-tools/asset.ts";

const TOOLS = join(import.meta.dir, "../stone-tools");
const fromTools = (name: "wood" | "lashing" | "stone" | "flint"): MaterialSpec => shared(TOOLS, `core:stone-tools/${name}`, tools.materials[name]);

export const WOOD = fromTools("wood");
export const LASHING = fromTools("lashing");
export const STONE = fromTools("stone");
export const FLINT = fromTools("flint");

function layers(folder: string, name: string, flat?: readonly [number, number, number]): MaterialSpec {
  const at = (layer: string): string => `${name}_${layer}_1024.png`;
  return shared(join(import.meta.dir, folder), `core:weapons/${name}`, {
    base: at("base"),
    normal: at("normal"),
    packed: at("orm"),
    height: at("height"),
    tiles: 0.2,
    ...(flat ? { flat } : {}),
  });
}

/**
 * A trim sheet: from the top, brass, a worn bright edge, then the dark face (firearms/tex/steel/brief.md). Its brass and
 * bright bands lift the mean, so it says the colour of the face to be drawn flat in.
 */
export const STEEL = { ...layers("firearms/tex/steel", "steel", [64, 62, 60]), tint: [1.0, 0.94, 0.86] as const };
export const HIDE = layers("thrown/tex/hide", "hide");

/** The held item's budget (D416): levels 0 and 1 keep their materials, 2 and on are flat. */
export const HELD_TRIANGLES = [1200, 480, 160, 48] as const;
