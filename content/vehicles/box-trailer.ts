import {
  shapeHalf,
  type Def,
  type ShapeBox,
} from "../../shared/content/defs.ts";

const boxes: ShapeBox[] = [
  { at: [0, 2.6, 0], half: [1.31, 1.4, 6.14] },
  { at: [0, 0.63, -4.4], half: [1.19, 0.63, 1.25] },
  ...[-0.78, 0.78].map((x) => ({
    at: [x, 0.6, 3.3] as [number, number, number],
    half: [0.16, 0.6, 0.18] as [number, number, number],
  })),
];
export const BOX_TRAILER: Def[] = [
  { type: "shape", id: "core:shape_box_trailer", role: "thing", boxes },
  {
    type: "structure",
    class: "static",
    id: "core:box_trailer",
    mesh: "core:box_trailer",
    shape: "core:shape_box_trailer",
    half: shapeHalf(boxes),
    hp: 8000,
    material: "core:mat_metal",
    color: 5,
  },
];
