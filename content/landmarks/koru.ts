// The authored JSON is shared with the mesh exporter; these are native structures, not a vehicle-sized collision box.
import layout from "./koru-layout.json";
import { shapeHalf, type Def, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { frameAxes, HALF_SIDE } from "../../shared/world/frame.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";

export const KORU_LAYOUT = layout;
const point = (p: readonly number[]): readonly [number, number, number] => [p[0]!, p[1]!, p[2]!];

/** Public, indestructible map architecture; open cabin leaves are definitions but are not initially placed. */
export const KORU_CONTENT: readonly Def[] = layout.modules.flatMap(module => {
  const shape: ShapeDef = { type: "shape", id: `${module.id}_shape`, role: module.category === "door" ? "door" : "thing",
    boxes: module.boxes.map(box => ({ at: point(box.at), half: point(box.half) })),
    hulls: module.hulls.map(hull => ({ corners: hull.points.map(point) })) };
  const structure: StructureDef = { type: "structure", class: "static", id: module.id, mesh: module.mesh, shape: shape.id,
    half: shapeHalf(shape.boxes, shape.hulls), color: module.color, hp: 10000,
    ...("opens" in module && module.opens ? { opens: module.opens } : {}) };
  return [shape, structure];
});

/** Transform ship-local metres through the same lattice frame used by structure collision and placement. */
export function koruPoint(x: number, y: number, z: number, yaw: number, local: readonly number[]): readonly [number, number, number] {
  const axes = new Int32Array(4); frameAxes(yaw, axes);
  return [x + (local[0]! * axes[0]! + local[2]! * axes[2]!) / HALF_SIDE,
    y + local[1]!, z + (local[0]! * axes[1]! + local[2]! * axes[3]!) / HALF_SIDE];
}

/** `y` is the sea datum. Yaw uses the native 65536-unit turn; source module yaw is in degrees. */
export function koruStatics(x: number, y: number, z: number, yaw = 0): MapStatic[] {
  const quantize = (v: number) => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;
  return layout.modules.filter(module => module.placed).map(module => {
    const p = koruPoint(x, y, z, yaw, module.origin);
    return { kind: module.id, x: quantize(p[0]), y: quantize(p[1]), z: quantize(p[2]),
      yaw: (yaw + Math.round(module.yaw * YAW_UNITS / 360)) & (YAW_UNITS - 1) };
  });
}
