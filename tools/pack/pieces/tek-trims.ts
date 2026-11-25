// Tek castings share the fitted ends and corner clearances of the Metal kit.
import { HALF_SIDE_M, STOREY_LEVELS, LEVEL_M } from "../../../shared/world/lattice/forms.ts";
import { Shape, type FaceMap, type Flat, type Vec } from "./kit.ts";
import { METAL } from "./metal.ts";

const full = STOREY_LEVELS * LEVEL_M;
const face = (mat: string): FaceMap => () => [mat, () => [0, 0]];

function post(level: number): Shape {
  const shape = new Shape();
  const shaft: Flat[] = [[-.11, -.077], [-.077, -.11], [.077, -.11], [.11, -.077],
    [.11, .077], [.077, .11], [-.077, .11], [-.11, .077]];
  const cuts: [number, number, string][] = [[-.004, 1.10, "titanium"]];
  if (level === 0) {
    for (const top of [LEVEL_M, 2 * LEVEL_M, 3 * LEVEL_M, full]) {
      cuts.push([top - .05, 1.13, "copper"], [top + .01, 1.0, "titanium"]);
    }
  } else cuts.push([full - .08, 1.05, "chamfer"], [full + .01, 1.0, "titanium"]);
  const rings = cuts.map(([z, radius]) => shaft.map(([x, y]): Vec => [x * radius, y * radius, z]));
  return shape.loft(rings, (side, band) => [side % 2 === 0 && cuts[band]![2] === "titanium" ? "cover" : cuts[band]![2], [0, 0]], () => ["bevel", [0, 0]]);
}

/** A folded extrusion meets the adjacent casting on the mitre at each end. */
function fold(shape: Shape, section: Flat[], bands: string[], half: number, mitre = false, centre = 0): void {
  const first = shape.faces.length;
  shape.extrude(section, "x", -half, half, face("socket"));
  for (let k = first; k < shape.faces.length; k++) {
    const f = shape.faces[k]!;
    f.mat = bands[k - first] ?? "socket";
    f.points = f.points.map(([x, y, z]) => [x + centre - (mitre ? Math.sign(x) * y : 0), y, z]);
  }
}

function eave(level: number): Shape {
  const p = new Shape(), h = HALF_SIDE_M;
  if (level === 3) {
    p.faces.push({ points: [[-h, -.07, -.22], [h, -.07, -.22], [h, -.07, -.035], [-h, -.07, -.035]], uvs: [[0, 0], [0, 0], [0, 0], [0, 0]], mat: "cover" });
    return p;
  }
  if (level === 2) return p.extrude([[.01, -.03], [-.08, -.04], [-.055, -.22]], "x", -h, h, face("cover"));
  fold(p, [[0, -.015], [-.105, -.035], [-.11, -.067], [-.055, -.090], [-.055, -.153], [-.087, -.17], [-.063, -.215], [0, -.208]],
    ["cover", "chamfer", "titanium", "gasket", "socket", "bevel", "cover", "socket"], h, true);
  if (level === 0) for (const s of [-1, 1]) {
    const outline: Flat[] = [[.29, -.104], [.34, -.092], [1.033, -.092], [.987, -.127], [.32, -.127]];
    p.extrude(outline.map(([x, z]) => [z, s * x]), "y", -.069, -.054, label => [label === "-y" ? "membrane" : "copper", () => [0, 0]]);
    const clip: Flat[] = [[1.05, -.062], [1.22, -.062], [1.15, -.177], [1.0, -.177]];
    p.extrude(clip.map(([x, z]) => [z, s * x]), "y", -.105, -.048, label => [label === "-y" ? "cover" : "chamfer", () => [0, 0]]);
  }
  return p;
}

function skirt(level: number): Shape {
  const p = new Shape();
  fold(p, [[0, -.006], [-.12, -.026], [-.116, -.093], [-.057, -.158], [-.054, -2.35], [-.096, -2.40], [0, -2.40]],
    ["titanium", "cover", "bevel", "socket", "bevel", "cover", "gasket"], HALF_SIDE_M, true);
  if (level === 1) return p;
  for (const s of [-1, 1]) {
    const leg: Flat[] = [[.54, -.117], [1.37, -.117], [1.35, -.38], [1.045, -1.14], [1.045, -2.33], [.79, -2.33], [.79, -.62]];
    p.extrude(leg.map(([x, z]) => [z, s * x]), "y", -.112, -.048, label => [label === "-y" ? "alloy" : "bevel", () => [0, 0]]);
    const bus: Flat[] = [[.07, -.187], [.54, -.187], [.655, -.277], [.135, -.277]];
    p.extrude(bus.map(([x, z]) => [z, s * x]), "y", -.071, -.052, label => [label === "-y" ? "membrane" : "copper", () => [0, 0]]);
  }
  return p;
}

function ridge(): Shape {
  const p = new Shape(), h = HALF_SIDE_M + .02;
  fold(p, [[0, .076], [.104, .052], [.235, -.017], [.235, -.042], [.111, .012], [0, .031], [-.111, .012], [-.235, -.042], [-.235, -.017], [-.104, .052]],
    ["socket", "cover", "chamfer", "gasket", "socket", "socket", "gasket", "chamfer", "cover", "socket"], h);
  fold(p, [[-.030, .073], [-.019, .09], [.019, .09], [.030, .073]], ["copper", "membrane", "copper", "socket"], h);
  for (const x of [-.79, .79]) {
    fold(p, [[0, .108], [.129, .062], [.129, .042], [0, .087], [-.129, .042], [-.129, .062]],
      ["titanium", "chamfer", "socket", "socket", "chamfer", "titanium"], .049, false, x);
  }
  return p;
}

export function tekTrims(): Record<string, Shape[]> {
  const trims = METAL.trims!();
  const finish: Record<string, string> = { frame: "socket", plate: "alloy", trim: "titanium", bolt: "copper", dark: "gasket", nosing: "emitter" };
  for (const levels of Object.values(trims)) for (const shape of levels) {
    for (const f of shape.faces) f.mat = finish[f.mat]!;
  }
  trims.joint_sq![0] = post(0);
  trims.joint_sq![1] = post(1);
  trims.skirt![0] = skirt(0);
  trims.skirt![1] = skirt(1);
  trims.ridge![0] = ridge();
  trims.eave = [0, 1, 2, 3].map(eave);
  return trims;
}
