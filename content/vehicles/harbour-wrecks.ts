// The marine fleet as a harbour holds it for scenery: statics a city's build sets in the water by its marinas and piers
// (tools/boat/wrecks.ts), each in its vessel's keel frame, its origin on the keel under its middle and +Z its bow. A
// vessel's damaged form, afloat, and its sunk form draw the meshes core:<vessel>_damaged and core:<vessel>_sunk; the
// build sets one down only where the art has its mesh, and core:hulk_<vessel>, the intact hull, in its place until then.
// None is named for its mesh, so a destroyed vessel draws its intact hull until the pack has its sunk form.
import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { MAX_SHAPE_BOXES, MAX_STRUCTURE_HALF } from "../../shared/content/registry.ts";
import { MARINE_MODELS } from "./marine-fleet.ts";

export const HARBOUR_WRECK_FORMS = ["damaged", "sunk"] as const;
export type HarbourWreckForm = (typeof HARBOUR_WRECK_FORMS)[number];
/** The mesh of a vessel's form, as its art names it. */
export const formMesh = (vessel: string, form: HarbourWreckForm): string => `${vessel}_${form}`;
/** The static a harbour sets down for a vessel: its form's, or with no form its intact hull. */
export const hulkOf = (vessel: string, form?: HarbourWreckForm): string => `${vessel.replace("core:", "core:hulk_")}${form ? `_${form}` : ""}`;

const span = (b: ShapeBox, axis: number): [number, number] => [b.at[axis]! - b.half[axis]!, b.at[axis]! + b.half[axis]!];
const boxOf = (lo: number[], hi: number[]): ShapeBox => ({ at: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2], half: [(hi[0]! - lo[0]!) / 2, (hi[1]! - lo[1]!) / 2, (hi[2]! - lo[2]!) / 2] });
const union = (a: ShapeBox, b: ShapeBox): ShapeBox => boxOf([0, 1, 2].map((k) => Math.min(span(a, k)[0], span(b, k)[0])), [0, 1, 2].map((k) => Math.max(span(a, k)[1], span(b, k)[1])));
const volume = (b: ShapeBox): number => b.half[0]! * b.half[1]! * b.half[2]! * 8;

/** A hull's boxes as a static's shape takes them: within its reach of the origin, and joined two at a time where they grow least till few enough. */
export function hulkBoxes(boxes: readonly ShapeBox[]): ShapeBox[] {
  const out = boxes.map((b) => boxOf([0, 1, 2].map((k) => Math.max(-MAX_STRUCTURE_HALF, span(b, k)[0])), [0, 1, 2].map((k) => Math.min(MAX_STRUCTURE_HALF, span(b, k)[1]))));
  while (out.length > MAX_SHAPE_BOXES) {
    let [a, b, gain] = [0, 1, Infinity];
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const g = volume(union(out[i]!, out[j]!)) - volume(out[i]!) - volume(out[j]!);
      if (g < gain) [a, b, gain] = [i, j, g];
    }
    out[a] = union(out[a]!, out[b]!); out.splice(b, 1);
  }
  return out;
}

const SHAPES: ShapeDef[] = [];
const STATICS: StructureDef[] = [];
for (const m of MARINE_MODELS) {
  const shape = hulkOf(m.id).replace("core:", "core:shape_"), boxes = hulkBoxes(m.boxes);
  SHAPES.push({ type: "shape", id: shape, role: "thing", boxes });
  for (const [id, mesh] of [[hulkOf(m.id), m.id], ...HARBOUR_WRECK_FORMS.map((f) => [hulkOf(m.id, f), formMesh(m.id, f)])] as const) {
    STATICS.push({ type: "structure", class: "static", id, mesh, shape, half: shapeHalf(boxes), color: m.paint, hp: 8000, material: "core:mat_metal" });
  }
}
export const HARBOUR_WRECKS: readonly Def[] = [...SHAPES, ...STATICS];
