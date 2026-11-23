import { shapeHalf, type Def, type ShapeBox } from "../../shared/content/defs.ts";
import { AIR_FRAME as A } from "../../shared/world/air-support-art.ts";
import type { HullDef } from "../../shared/world/convex.ts";

function hinged(x: number, y: number, width: number, height: number, angle: number): HullDef {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    corners: [number, number, number][] = [];
  for (const z of [-3.79, 3.79])
    for (const dx of [0, width])
      for (const dy of [0, height]) {
        corners.push([x + dx * c - dy * s, y + dx * s + dy * c, z]);
      }
  return { corners };
}

function pod(chassis: boolean, open: boolean): Def[] {
  const id = (chassis ? "core:air_pod_chassis" : "core:air_pod_ground") + (open ? "_open" : "");
  const floor = chassis ? A.deck : 0;
  const boxes: ShapeBox[] = [],
    hulls: HullDef[] = [];
  if (open) {
    boxes.push({ at: [0, floor + 0.4, 0], half: [A.halfWidth, 0.4, A.halfLength] });
    boxes.push({ at: [-1.14, floor + 1, 0], half: [0.06, 0.9, 3.79] });
    for (const z of [-3.82, 3.82]) boxes.push({ at: [0, floor + 1, z], half: [1.16, 0.9, 0.08] });
    hulls.push(hinged(A.roofX, floor + A.roofY, 2.28, 0.1, A.roofAngle));
    hulls.push(hinged(A.sideX, floor + A.sideY, 0.1, 1.56, A.sideAngle));
  } else boxes.push({ at: [0, floor + A.height / 2, 0], half: [A.halfWidth, A.height / 2, A.halfLength] });
  if (chassis) {
    boxes.push({ at: [0, 1.19, -1.975], half: [1.26, 0.11, 2.675] });
    boxes.push({ at: [0, 1.3, 2.675], half: [1.26, 0.01, 1.975] });
    for (const z of A.axle) boxes.push({ at: [0, A.wheel, z], half: [1.21, A.wheel, A.wheel] });
  }
  return [
    { type: "shape", id: id + "_shape", role: "thing", boxes, hulls },
    {
      type: "structure",
      class: "static",
      id,
      mesh: "none",
      shape: id + "_shape",
      half: shapeHalf(boxes, hulls),
      hp: 8000,
      color: 4,
      material: "core:mat_metal",
    },
  ];
}
export const AIR_PODS: Def[] = [...pod(false, false), ...pod(true, false), ...pod(false, true), ...pod(true, true)];
