import type { MaterialSpec, PiecesAsset, PieceSpec } from "../../../../../tools/art/spec.ts";

const tiles = 0.115;
const surfaces = [
  "currant", "nightshade", "snowberry", "leaf", "purple_stem", "green_glass", "wax_paper", "seal",
  "hide", "twine", "crystal", "cement", "polymer", "steel", "rubber", "green_stem",
] as const;

const materials = Object.fromEntries(surfaces.map((name) => [
  name, {
    base: `tex/${name}_base.png`,
    normal: `tex/${name}_normal.png`,
    packed: `tex/${name}_orm.png`,
    height: `tex/${name}_height.png`,
    tiles,
  } satisfies MaterialSpec,
]));

const views = {
  berry: { around: 0.44, above: 1.02, roll: 0.06 },
  narcoberry: { around: -0.38, above: 1.02 },
  stimberry: { around: 0.68, above: 1.18, roll: -0.15 },
  narcotic: { around: 0.52, above: 0.50 },
  stimulant: { around: 0.41, above: 0.94, roll: -0.14 },
  waterskin: { around: 0.70, above: 0.88, roll: 0.11 },
  water_jar: { around: 0.49, above: 0.41, roll: -0.04 },
  canteen: { around: -0.80, above: 0.87, roll: 0.10 },
} satisfies Record<string, NonNullable<PieceSpec["icon"]>>;

const carriers = new Set(["waterskin", "water_jar", "canteen"]);

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([id, icon]): PieceSpec => carriers.has(id)
    ? { id: `core:${id}`, object: `${id}_held`, hold: "prop_r", dropped: id, icon }
    : { id: `core:${id}/dropped`, object: id, icon }),
  materials,
  budgets: { triangles: [880, 455, 180], texture: { top: 128, megabytes: 3 } },
} satisfies PiecesAsset;
