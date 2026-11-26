import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  spyglass: { around: 0.79, above: 0.48 },
  template_hammer: { around: 2.83, above: 1.12, roll: -0.25 },
  compass: { around: 2.85, above: 1.13 },
  magnifying_glass: { around: 2.64, above: 1.15 },
  radio: { around: 2.79, above: 0.97 },
  gps: { around: 2.85, above: 1.11 },
};

function maps(name: string): MaterialSpec {
  return {
    base: `tex/${name}_base.png`,
    normal: `tex/${name}_normal.png`,
    packed: `tex/${name}_orm.png`,
    height: `tex/${name}_height.png`,
  };
}

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([name, icon]) => ({
    id: `core:${name}`,
    object: name,
    hold: "prop_r",
    dropped: `${name}_ground`,
    icon,
  })),
  materials: {
    workshop: maps("workshop"),
    hardware: maps("hardware"),
    optics: maps("optics"),
  },
  budgets: { triangles: [3000, 1240, 460, 196], texture: { top: 1024, megabytes: 40 } },
} satisfies PiecesAsset;
