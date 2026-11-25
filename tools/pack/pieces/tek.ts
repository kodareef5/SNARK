import { TEK_RAIL_COLOUR, TEK_WALL } from "../../../content/building/tek-wall.ts";
import { defaultPalette, nearestColour, REGION_BASE } from "../../../shared/pack/palette.ts";
import type { FormDef } from "../../../shared/world/lattice/forms.ts";
import type { SourceMesh } from "../write.ts";
import { Shape, flatLod, type FaceMap, type Flat, type Vec } from "./kit.ts";
import { errorOf, levelsOf, type TierRecipe } from "./lod.ts";

const TONES = {
  field: [40, 51, 65], gasket: [24, 27, 33], socket: [47, 53, 61], bevel: [94, 103, 111],
  titanium: [140, 147, 153], chamfer: [158, 166, 174], cover: [106, 112, 121],
  emitter: [109, 229, 233], lens: [48, 153, 174], bolt: [77, 82, 88],
} as const;
type Tone = keyof typeof TONES;

const uv = (): Flat => [0, 0];
const coating = (face: Tone, side: Tone = face): FaceMap => (label) => [label.endsWith("y") ? face : side, uv];

function contour(x: number, z: number, cut: number): Flat[] {
  return [[-x, -z + cut], [-x + cut, -z], [x - cut, -z], [x, -z + cut],
    [x, z - cut], [x - cut, z], [-x + cut, z], [-x, z - cut]];
}

interface Profile {
  outline: Flat[];
  depth: number;
  outward: Tone;
  rail?: boolean;
}

function shell(shape: Shape, profile: Profile[], edge: Tone): void {
  const rings = [...profile, ...[...profile].reverse()];
  const positions = rings.map(({ outline, depth }, i) => outline.map(([x, z]): Vec => [x, (i < profile.length ? -1 : 1) * depth, z]));
  const bands = profile.slice(0, -1);
  const materials: Pick<Profile, "outward" | "rail">[] = [...bands, { outward: edge }, ...[...bands].reverse(), { outward: edge }];
  shape.loft(positions, (side, i) => {
    const band = materials[i]!;
    return [band.rail && (side === 3 || side === 7) ? "emitter" : band.outward, [0, 0]];
  }, () => ["field", [0, 0]]);
}

function insert(shape: Shape, outline: readonly Flat[], depth: number, face: Tone, edge: Tone, holes: readonly Flat[][] = []): void {
  const section = (points: readonly Flat[]): Flat[] => points.map(([x, z]) => [z, x]);
  shape.extrude(section(outline), "y", -depth, depth, coating(face, edge), holes.map(section));
}

function lamps(shape: Shape, near: boolean): void {
  const w = TEK_WALL;
  const ends: readonly (readonly [number, number])[] = near ? [[-w.railY, -.358], [-.342, .342], [.358, w.railY]] : [[-w.railY, w.railY]];
  for (const side of [-1, 1]) {
    const x = side * w.railX, r = w.railHalfWidth;
    for (const [low, high] of ends) {
      insert(shape, [[x - r, low + .014], [x + r, low], [x + r, high - .014], [x - r, high]], w.railZ, "emitter", "lens");
    }
  }
}

function hardware(shape: Shape, near: boolean): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const reflected = (points: readonly Flat[]): Flat[] => points.map(([x, z]) => [sx * x, sz * z]);
    const shoe: Flat[] = [[1.132, 1.339], [1.328, 1.119], [1.403, 1.192], [1.463, 1.353], [1.457, 1.452], [1.288, 1.448]];
    const bore = Array.from({ length: 6 }, (_, i): Flat => {
      const angle = i * Math.PI / 3;
      return [1.382 + .023 * Math.cos(angle), 1.376 + .023 * Math.sin(angle)];
    });
    insert(shape, reflected(shoe), .1, "cover", "socket", near ? [reflected(bore)] : []);
    if (!near) continue;
    const cap: Flat[] = [[.016, 1.378], [.835, 1.378], [1.008, 1.438], [.971, 1.469], [.062, 1.469], [.016, 1.450]];
    insert(shape, reflected(cap), .1, "titanium", "socket");
    insert(shape, reflected(bore), .0977, "socket", "bolt");
  }
}

function wall(name: string, form: FormDef, level: number): Shape | null {
  if (name !== "wall") throw new Error(`Tek has no ${name}`);
  if (level > 4) return null;
  const shape = new Shape(), w = TEK_WALL;
  const x = w.width / 2, z = w.height / 2, depth = form.thick / 2;
  if (level === 4) return shape.box([-x, -depth, -z], [x, depth, z], coating("field", "bevel"));
  if (level === 3) return shape.framed([-x, -.078, -z], [x, .078, z], [-w.panelX, -w.panelY, w.panelX, w.panelY], coating("bevel"), coating("field"));

  // The collinear points on the outer rim keep the lattice corner square.
  const rim: Flat[] = [[-x, -z], [-x + .13, -z], [x - .13, -z], [x, -z], [x, z], [x - .13, z], [-x + .13, z], [-x, z]];
  const face = { outline: contour(w.panelX, w.panelY, w.corner), depth: w.panelZ, outward: "gasket" } as const;
  const edge = { outline: rim, depth: .074, outward: "bevel" } as const;
  if (level === 2) {
    shell(shape, [face, { outline: contour(1.29, 1.354, .208), depth: .080, outward: "socket", rail: true },
      { outline: contour(1.31, 1.374, .227), depth: .080, outward: "bevel" }, edge], "socket");
    return shape;
  }
  shell(shape, [face,
    { outline: contour(1.252, 1.307, .170), depth: .058, outward: "chamfer" },
    { outline: contour(1.268, 1.323, .180), depth: .078, outward: "socket" },
    { outline: contour(1.336, 1.380, .202), depth: .078, outward: "bevel" },
    { outline: contour(1.378, 1.430, .152), depth: .097, outward: "titanium" },
    { outline: contour(1.430, 1.465, .080), depth: .097, outward: "bevel" }, edge], "socket");
  lamps(shape, level === 0);
  hardware(shape, level === 0);
  return shape;
}

export const TEK: TierRecipe = { name: "tek", rank: 3, runPost: false, jointHalf: .11, tones: TONES, split: wall };

export function bakeTekWall(form: FormDef): SourceMesh {
  const palette = defaultPalette();
  const colours = new Map(Object.entries(TONES).map(([name, rgb]) => [name, nearestColour(palette, rgb[0], rgb[1], rgb[2])]));
  return {
    id: "core:wall_tek",
    lods: levelsOf(TEK, "wall", form).map((shape, level) => ({
      ...flatLod(shape, mat => mat === "field" ? REGION_BASE : mat === "emitter" ? TEK_RAIL_COLOUR : colours.get(mat)!, level < 3),
      ...(level ? { error: errorOf(shape, level) } : {}),
    })),
  };
}
