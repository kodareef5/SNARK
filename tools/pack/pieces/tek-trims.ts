// Roof flashings follow Metal's fitted profiles. The exposed column and fascia carry the Tek castings.
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

function eave(level: number): Shape {
  const p = new Shape(), h = HALF_SIDE_M;
  if (level === 3) {
    p.faces.push({points: [[-h, -.07, -.22], [h, -.07, -.22], [h, -.07, -.035], [-h, -.07, -.035]], uvs: [[0,0],[0,0],[0,0],[0,0]], mat: "cover"});
    return p;
  }
  const section: Flat[] = level === 2 ? [[.01, -.03], [-.08, -.04], [-.055, -.22]]
    : [[.01, -.03], [-.045, -.02], [-.08, -.053], [-.08, -.16], [-.055, -.22], [.01, -.22]];
  p.extrude(section, "x", -h, h, face("cover"));
  if (level === 0) for (const x of [-.65, .65]) {
    p.box([x-.20, -.087, -.125], [x+.20, -.081, -.071], face("gasket"));
    p.box([x-.15, -.091, -.105], [x+.15, -.087, -.085], face("emitter"));
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
  trims.eave = [0, 1, 2, 3].map(eave);
  return trims;
}
