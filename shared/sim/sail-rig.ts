// Authored visuals of a moored sail assembly. They neither collide nor provide propulsion.
import { detCos, detSin } from "../math/scalar.ts";

export type SailPoint = readonly [number, number, number];

export interface SailBand {
  readonly bone: string;
  readonly index: number;
  readonly lower: number;
  readonly upper: number;
}

export interface SailVisual {
  readonly id: string;
  readonly mesh: string;
  readonly skeleton: string;
  readonly anchor: SailPoint;
  /** Right-handed orthonormal columns taking sail-local coordinates into the yacht frame. */
  readonly basis: readonly [SailPoint, SailPoint, SailPoint];
  /** Root at index zero, then every band's native bone, then any independent gaff. */
  readonly bones: readonly string[];
  readonly bands: readonly SailBand[];
  /** Mains fold along Y about Z; headsails fold along Z about negative Y, preserving their luff. */
  readonly bandAxis: "y" | "z";
  readonly foldSign: 1 | -1;
  readonly stackStep: number;
  readonly gaff?: {
    readonly bone: string;
    readonly throat: SailPoint;
    readonly peak: SailPoint;
    readonly lowerThroatY: number;
    readonly lowerAngle: number;
  };
  /** Yacht-local sphere enclosing every pose and all six packed levels, including the gaff. */
  readonly bounds: { readonly center: SailPoint; readonly radius: number };
  /** Optional per-bone rest bounds: every vertex with a nonzero weight on that bone, across all levels. */
  readonly boneBounds?: readonly (readonly [number, number, number, number, number, number])[];
}

export interface SailVisualRig {
  readonly sails: readonly SailVisual[];
}

/** A bounded native visual contract; malformed or unbounded authoring never reaches the frame allocator. */
export function validateSailVisualRig(value: unknown): readonly string[] {
  const errors: string[] = [];
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const finite = (v: unknown, low: number, high: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= low && v <= high;
  const point = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => finite(n, -256, 256));
  const name = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
  if (!object(value) || !Array.isArray(value.sails) || value.sails.length < 1 || value.sails.length > 8) return ["sail rig needs one to eight sails"];
  const ids = new Set<string>(), meshes = new Set<string>(); let total = 0;
  value.sails.forEach((entry, i) => {
    const bad = (reason: string) => errors.push(`sail ${i}: ${reason}`);
    if (!object(entry)) { bad("expected an object"); return; }
    if (!name(entry.id) || ids.has(entry.id)) bad("id must be a unique nonempty name"); else ids.add(entry.id);
    if (!name(entry.mesh) || meshes.has(entry.mesh)) bad("mesh must be a unique nonempty id"); else meshes.add(entry.mesh);
    if (!name(entry.skeleton)) bad("skeleton must name the packed rig");
    if (!point(entry.anchor)) bad("anchor must be three finite yacht-local metres");
    const basis = entry.basis;
    if (!Array.isArray(basis) || basis.length !== 3 || !basis.every(point)) bad("basis must contain three finite axes");
    else {
      const [x, y, z] = basis as number[][];
      const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      const cross = [x![1]! * y![2]! - x![2]! * y![1]!, x![2]! * y![0]! - x![0]! * y![2]!, x![0]! * y![1]! - x![1]! * y![0]!];
      if ([x!, y!, z!].some(a => Math.abs(dot(a, a) - 1) > 1e-5) || Math.abs(dot(x!, y!)) > 1e-5 || Math.abs(dot(x!, z!)) > 1e-5 || Math.abs(dot(y!, z!)) > 1e-5 || Math.abs(dot(cross, z!) - 1) > 1e-5) bad("basis must be right-handed and orthonormal");
    }
    const bones = entry.bones;
    if (!Array.isArray(bones) || bones.length < 2 || bones.length > 127 || !bones.every(name) || new Set(bones).size !== bones.length || bones[0] !== "root") { bad("bones must uniquely name root and at most 126 following bones"); return; }
    total += bones.length;
    if (entry.bandAxis !== "y" && entry.bandAxis !== "z") bad("bandAxis must be y or z");
    if (entry.foldSign !== -1 && entry.foldSign !== 1) bad("foldSign must be -1 or 1");
    if (!finite(entry.stackStep, .0001, .1)) bad("stackStep must be 0.0001 to 0.1 metres");
    const bands = entry.bands, used = new Set<number>([0]); let end = 0;
    if (!Array.isArray(bands) || bands.length < 1 || bands.length > 126) bad("bands must contain one to 126 folds");
    else for (const band of bands) {
      if (!object(band) || !finite(band.index, 1, bones.length - 1) || !Number.isInteger(band.index) || used.has(band.index) || bones[band.index] !== band.bone || !finite(band.lower, 0, 256) || !finite(band.upper, 0, 256) || Math.abs(band.lower - end) > 1e-6 || band.upper <= band.lower || (typeof entry.stackStep === "number" && entry.stackStep >= band.upper - band.lower)) { bad("bands must be contiguous positive spans with distinct matching bone indices"); break; }
      used.add(band.index); end = band.upper;
    }
    const gaff = entry.gaff;
    if (gaff !== undefined) {
      if (!object(gaff) || entry.bandAxis !== "y" || !point(gaff.throat) || !point(gaff.peak) || !finite(gaff.lowerThroatY, 0, 2) || !finite(gaff.lowerAngle, 0, Math.PI / 2) || !name(gaff.bone) || !bones.includes(gaff.bone) || used.has(bones.indexOf(gaff.bone))) bad("gaff must name an independent bone and finite main-sail endpoints");
      else {
        used.add(bones.indexOf(gaff.bone));
        const dy = gaff.peak[1]! - gaff.throat[1]!, dz = gaff.peak[2]! - gaff.throat[2]!;
        if (dy <= 0 || dz <= 0 || Math.abs(gaff.peak[0]! - gaff.throat[0]!) > 1e-6 || Math.abs(detSin(gaff.lowerAngle) * dz - detCos(gaff.lowerAngle) * dy) > 1e-5 * Math.sqrt(dy * dy + dz * dz)) bad("gaff must rise aft within its local YZ plane");
      }
    }
    if (used.size !== bones.length) bad("every non-root bone must have a fold or gaff pose");
    const bounds = entry.bounds;
    if (!object(bounds) || !point(bounds.center) || !finite(bounds.radius, .01, 256)) bad("moving bounds must be a finite yacht-local sphere");
    const boxes = entry.boneBounds;
    if (boxes !== undefined && (!Array.isArray(boxes) || boxes.length !== bones.length || boxes.some(box => !Array.isArray(box) || box.length !== 6 || !box.every(n => finite(n, -256, 256)) || box.some((n, a) => a < 3 && n > box[a + 3])))) bad("per-bone rest bounds must contain one ordered finite box per bone");
  });
  if (total > 1024) errors.push("sail rig exceeds 1024 native bones");
  return errors;
}
