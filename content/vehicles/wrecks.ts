// The compact as a ruined city leaves it in its streets: statics drawn as the car's own posed meshes (assets/source/core/
// vehicles/compact_abandoned and compact_wreck), each a shape of boxes in the car's frame: origin on the ground under its
// middle, +Z its nose, +Y up. A map sets one down with y the ground and its yaw along the street (tools/mapworld/ruins.ts).
import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { COMPACT_SPECIES } from "./compact.ts";

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ShapeBox => ({
  at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2],
});

/**
 * Each look is a mesh of the pack and the boxes bodies meet. `painted` looks keep the car's paint, which the kind's colour
 * dyes as the species' does the car's: one kind a colour. A burnt look has no paint left, so it is one kind.
 */
export const WRECK_LOOKS = [
  // Abandoned where it stopped: dust, faded paint, a few knocks, settled on soft tyres.
  { mesh: "core:compact_abandoned", painted: true, boxes: [box(-.92, .92, 0, .8, .75, 2), box(-.92, .92, 0, 1, -2, .75), box(-.72, .72, 1, 1.46, -1.25, .45)] },
  // Its wheels, steering wheel and driver's door taken, down on its sills, the other door ajar.
  { mesh: "core:compact_abandoned_stripped", painted: true, boxes: [box(-.9, .9, 0, .8, .75, 2), box(-.9, .9, 0, .92, -2, .75), box(-.72, .72, .92, 1.41, -1.25, .45), box(-1.34, -.9, .15, 1.05, -1.05, .1)] },
  // On its roof, its cabin crushed, as a flood or a storm left it.
  { mesh: "core:compact_abandoned_roof", painted: true, boxes: [box(-.76, .72, 0, .32, -1.1, .5), box(-.95, .92, .32, 1.39, -2, 2)] },
  // Burnt out, sunk on its rims, the driver's door ajar.
  { mesh: "core:compact_wreck", painted: false, boxes: [box(-.92, .92, 0, .82, .75, 2), box(-.92, .92, 0, 1.02, -2, .75), box(-.72, .72, 1.02, 1.44, -1.25, .4), box(.9, 1.28, .2, 1.1, -.85, .45)] },
  // Burnt out and on its passenger side.
  { mesh: "core:compact_wreck_tipped", painted: false, boxes: [box(-1, 0, 0, 1.86, -2, 2), box(-1.5, -1, .15, 1.6, -1.1, .45)] },
] as const satisfies readonly { mesh: string; painted: boolean; boxes: readonly ShapeBox[] }[];
type Look = (typeof WRECK_LOOKS)[number];

const NAMES: Record<number, string> = { 232: "white", 90: "silver", 230: "black", 233: "red", 22: "maroon", 29: "navy", 41: "blue", 136: "green", 124: "beige", 28: "teal", 213: "mustard", 226: "copper" };
/** The car's own paints, as its species rolls them, with a name each for the kinds' ids. */
export const WRECK_PAINTS = COMPACT_SPECIES.regions![0]!.colors.map(([color]) => ({ color, name: NAMES[color] ?? `paint${color}` }));
// A burnt look's one colour: what the far city averages it under (client/core/render/far.ts), one of the paints.
const BURNT = 230;

/** Every kind of each look: one a paint for a painted look, the look's own id for a burnt one. */
export const WRECK_KINDS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(WRECK_LOOKS.map((l) => [l.mesh, l.painted ? WRECK_PAINTS.map((p) => `${l.mesh}_${p.name}`) : [l.mesh]]));

const LOOK_OF = new Map<string, Look>(WRECK_LOOKS.flatMap((l) => WRECK_KINDS[l.mesh]!.map((kind) => [kind, l] as const)));
/** The look a wreck kind is drawn as, or undefined for any other kind. */
export const wreckLook = (kind: string): Look | undefined => LOOK_OF.get(kind);

const shapeOf = (mesh: string): string => `${mesh.replace("core:", "core:shape_")}`;
const SHAPES: readonly ShapeDef[] = WRECK_LOOKS.map((l) => ({ type: "shape", id: shapeOf(l.mesh), role: "thing", boxes: l.boxes }));
const STATICS: readonly StructureDef[] = WRECK_LOOKS.flatMap((l) => WRECK_KINDS[l.mesh]!.map((id, i): StructureDef => ({
  type: "structure", class: "static", id, mesh: l.mesh, shape: shapeOf(l.mesh), half: shapeHalf(l.boxes),
  color: l.painted ? WRECK_PAINTS[i]!.color : BURNT, hp: 8000, material: "core:mat_metal",
})));
export const WRECKS: readonly Def[] = [...SHAPES, ...STATICS];
