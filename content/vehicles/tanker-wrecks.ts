import { shapeHalf, type Def, type ShapeBox } from "../../shared/content/defs.ts";
import bounds from "./tanker-wreck-bounds.json" with { type: "json" };
export const TANKER_WRECKS: Def[] = Object.entries(bounds).flatMap(([state, sections]): Def[] => {
  const id = `core:tanker_${state}`,
    shape = `core:shape_tanker_${state}`;
  const triple = (v: number[]): [number, number, number] => [v[0]!, v[1]!, v[2]!];
  const boxes: ShapeBox[] = sections.map((b) => ({ at: triple(b.at), half: triple(b.half) }));
  return [
    { type: "shape", id: shape, role: "thing", boxes },
    {
      type: "structure",
      class: "static",
      id,
      mesh: id,
      shape,
      half: shapeHalf(boxes),
      hp: 8000,
      material: "core:mat_metal",
      color: state === "burnout" ? 230 : 28,
    },
  ];
});
