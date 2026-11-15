// The trees: every individual of every tree kind and the stump each leaves, built by model.py from the kinds' scripts.
// Content names them as the variants of its node kinds (core:palm and the rest).

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

// While working: TREES=oaks builds that kind alone into the pack, which must then be built again whole before it is
// committed; STANDIN=oak_leaves reads that material from tex/_placeholder/ while its pictures are being made.
const STANDIN = (process.env.STANDIN ?? "").split(",");
const ONLY = (process.env.TREES ?? "").split(",").filter((k) => k !== "").map((k) => ({ young: "tree", oaks: "oak", palms: "palm", figs: "fig", banyans: "banyan", mangroves: "mangrove" })[k] ?? k);

const USES: Record<string, string[]> = { tree: ["oak_bark", "oak_leaves", "oak_crown", "stump_cuts"], oak: ["oak_bark", "oak_leaves", "oak_crown", "stump_cuts"], palm: ["royal_bark", "coconut_bark", "palm_parts", "royal_frond", "coconut_frond"],
  fig: ["fig_bark", "fig_leaves", "fig_crown", "stump_cuts"], banyan: ["fig_bark", "fig_leaves", "fig_crown", "stump_cuts"], mangrove: ["mangrove_bark", "mangrove_crown", "mangrove_leaves", "stump_cuts"] };

/** A whole layer set under tex/<name>/. */
const picture = (name: string, more: Partial<MaterialSpec> = {}): MaterialSpec => {
  const dir = STANDIN.includes(name) ? `tex/_placeholder/${name}` : `tex/${name}`;
  return { base: `${dir}/${name}_base.png`, normal: `${dir}/${name}_normal.png`, packed: `${dir}/${name}_orm.png`, height: `${dir}/${name}_height.png`, ...more };
};

/**
 * A level's measured error says little of a crown, where a coarser level is other leaves in the same outline, so each
 * level's error is stated, from where it should first be drawn. On the medium tier a level is drawn from 3,505 times
 * its error off (1,080 rows, a 70 degree view, 0.22 px), and the other tiers scale that; the engine takes errors at the
 * kind's largest size, about 1.2 times the modelled. A tree's finest level is for the tree being chopped and its
 * neighbours, to 14 m. A palm's second level carries it to 55 m, and its flat levels take over where it stands 55 and
 * then 20 pixels tall. A broadleaf tree's crown is heads of leaves with cut-out sprays radiating from them (broadleaf.py)
 * on its first three levels; its second level stops at 40 m, and its third and fourth begin where it stands 140 and then
 * 24 pixels tall: the third is its heads gathered into a few dozen rounder ones, still with pictures and without sprays,
 * the fourth the same in three flat greens. On every tier the near store hands a tree to the far layer before it is
 * drawn at its fourth level (D352: 152 to 184 m on medium), so a broadleaf tree's far level meets its third, and is made
 * to its fourth. A stump's levels change at 8 m, 25 m and 60 m. The check prints where each tier draws each.
 *
 * A tree's last level (far.py) is the far layer's, a few solids it draws out to kilometres. Its error of 0.6 m keeps the
 * near store and the shadow casters off it inside 2 km.
 */
const MEDIUM = 3505;
const FAR = 0.6;
const at = (metres: number[]): number[] => metres.map((d) => Math.round((d / MEDIUM) * 1e4) / 1e4);
const tree = (object: string, height: number): number[] => [
  ...at(object.startsWith("palm") ? [14, 55, (height * 771) / 55, (height * 771) / 20] : [14, 40, Math.max(48, (height * 771) / 140), (height * 771) / 24]),
  FAR,
];
const STUMP = at([8, 25, 60]);
// The oak's leaves warmed: the sky fills a crown's shade with blue, and the concept's shade is a deep warm olive.
const LEAVES_TINT = [0.96, 1.0, 0.72] as const;

/** The trees, by object name, and how tall each stands in metres. Each leaves a stump, `<name>_depleted`. */
const PIECES: Record<string, number> = {
  palm_1: 19.6, palm_2: 15.5, palm_3: 10.3, palm_4: 13.8, palm_5: 12.6, palm_6: 15.7,
  tree_1: 10.2, tree_2: 12.4, tree_3: 13.1, tree_4: 10.4,
  oak_1: 14, oak_2: 16.8, oak_3: 14.8,
  fig_1: 16.5, fig_2: 18.3, fig_3: 14.8,
  banyan_1: 14.8, banyan_2: 15.1, banyan_3: 16.3,
  mangrove_1: 6.4, mangrove_2: 7, mangrove_3: 7.8, mangrove_4: 8.3,
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(PIECES).filter(([object]) => ONLY.length === 0 || ONLY.includes(object.split("_")[0]!)).flatMap(([object, height]) => [
    { id: `core:${object}`, object, errors: tree(object, height) },
    { id: `core:${object}_depleted`, object: `${object}_depleted`, errors: STUMP },
  ]),
  // Leaves are cards with both sides modelled, so they are cut out and not two-sided: each side is drawn once.
  materials: Object.fromEntries(Object.entries({
    royal_bark: picture("royal_bark", { tiles: 2 }),
    coconut_bark: picture("coconut_bark", { tiles: 1.6 }),
    palm_parts: picture("palm_parts"),
    royal_frond: picture("royal_frond", { cutout: true }),
    coconut_frond: picture("coconut_frond", { cutout: true }),
    oak_bark: picture("oak_bark", { tiles: 2 }),
    oak_leaves: picture("oak_leaves", { cutout: true, tint: LEAVES_TINT }),
    oak_crown: picture("oak_crown", { tint: LEAVES_TINT }),
    stump_cuts: picture("stump_cuts"),
    fig_bark: picture("fig_bark", { tiles: 2 }),
    fig_leaves: picture("fig_leaves", { cutout: true }),
    fig_crown: picture("fig_crown"),
    mangrove_bark: picture("mangrove_bark", { tiles: 2 }),
    mangrove_crown: picture("mangrove_crown"),
    mangrove_leaves: picture("mangrove_leaves", { cutout: true }),
  }).filter(([name]) => ONLY.length === 0 || ONLY.some((k) => USES[k]!.includes(name)))),
  budgets: { triangles: [120000, 56000, 8000, 2200, 450, 16], texture: { top: 2048, megabytes: 240 } },
} satisfies PiecesAsset;
