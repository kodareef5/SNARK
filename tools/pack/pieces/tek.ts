import { TEK_INLAY_COLOUR, TEK_JAW, TEK_LATCH, TEK_RAIL_COLOUR, TEK_WALL, jawContact, jawDepth, latchDepth } from "../../../content/building/tek-wall.ts";
import { defaultPalette, nearestColour, REGION_BASE } from "../../../shared/pack/palette.ts";
import type { FormDef } from "../../../shared/world/lattice/forms.ts";
import { FACE_PLAIN } from "../../../client/core/render/piece-fit.ts";
import { tekDeck } from "./tek-decks.ts";
import { tekOpening } from "./tek-openings.ts";
import { tekTrims } from "./tek-trims.ts";
import type { SourceMesh } from "../write.ts";
import { Shape, clip, place, flatLod, type FaceMap, type Flat, type Vec } from "./kit.ts";
import { errorOf, levelsOf, type TierRecipe } from "./lod.ts";

const TONES = {
  alloy: [40, 51, 65], field: [40, 51, 65], gasket: [24, 27, 33], socket: [47, 53, 61], bevel: [94, 103, 111],
  titanium: [140, 147, 153], chamfer: [158, 166, 174], cover: [106, 112, 121],
  membrane: [17, 95, 95], emitter: [109, 229, 233], lens: [48, 153, 174], copper: [197, 116, 79],
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

/** A casting with a bevel rising from its footprint to its smaller face on either side. */
function casting(shape: Shape, foot: readonly Flat[], face: readonly Flat[], low: number, height: (p: Flat) => number, top: Tone, bevel: Tone): void {
  const rings = [-1, 1].flatMap(side => {
    const base = foot.map(([x, z]): Vec => [x, side * low, z]);
    const cap = face.map((p): Vec => [p[0], side * height(p), p[1]]);
    return side < 0 ? [cap, base] : [base, cap];
  });
  shape.loft(rings, (_k, i) => [i === 1 ? "socket" : bevel, [0, 0]], () => [top, [0, 0]]);
}

function toe(shape: Shape, sx: number, sz: number, near: boolean): void {
  // The first coordinate runs down the diagonal from the corner toward the field.
  const at = (outline: readonly Flat[], hand = 1): Flat[] => outline.map(([run, across]) =>
    [sx * (TEK_JAW.origin - (run + hand * across) * Math.SQRT1_2), sz * (TEK_JAW.origin - (run - hand * across) * Math.SQRT1_2)]);
  const seat: Flat[] = [[.020, -.068], [.143, -.220], [.315, -.251], [.536, -.163], [.773, -.066],
    [.805, 0], [.773, .066], [.536, .163], [.315, .251], [.143, .220], [.020, .068]];
  if (!near) {
    const outer: Flat[] = [[.026, -.065], [.23, -.236], [.49, -.171], [.785, -.031], [.785, .031], [.49, .171], [.23, .236], [.026, .065]];
    insert(shape, at(outer), .098, "cover", "socket");
    return;
  }
  insert(shape, at(seat), .072, "socket", "gasket");
  const depth = ([x, z]: Flat): number => jawDepth((2 * TEK_JAW.origin - Math.abs(x) - Math.abs(z)) * Math.SQRT1_2);
  for (const hand of [-1, 1]) casting(shape, at(TEK_JAW.foot, hand), at(TEK_JAW.cap, hand), TEK_JAW.low, depth, "titanium", "chamfer");
  // The graphite throat flares between the jaws and ends in a small ceramic aperture.
  const throat: Flat[] = [[.20, -.028], [.60, -.047], [.747, -.036], [.798, -.018], [.798, .018], [.747, .036], [.60, .047], [.20, .028]];
  insert(shape, at(throat), .079, "gasket", "socket");
  for (const run of TEK_JAW.copperRuns) insert(shape, at(jawContact(run)), TEK_JAW.copperZ, "copper", "socket");
  const tip: Flat[] = [[.638, -.029], [.715, -.026], [.742, -.010], [.742, .010], [.715, .026], [.638, .029]];
  insert(shape, at(tip), .083, "emitter", "bevel");
}

function serviceLatch(shape: Shape): void {
  const seat: Flat[] = [[1.06, -.485], [1.203, -.486], [1.273, -.40], [1.272, -.244],
    [1.231, -.198], [1.134, -.204], [1.048, -.288], [1.048, -.455]];
  insert(shape, seat, .063, "gasket", "socket");
  casting(shape, TEK_LATCH.foot, TEK_LATCH.cap, TEK_LATCH.low, ([x]) => latchDepth(x), "cover", "chamfer");
  insert(shape, TEK_LATCH.tab, TEK_LATCH.tabZ, "copper", "gasket");
}

function hardware(shape: Shape, near: boolean): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    toe(shape, sx, sz, near);
    if (!near) continue;
    const cap: Flat[] = [[.018, 1.378], [.698, 1.378], [.933, 1.435], [.899, 1.468], [.062, 1.468], [.018, 1.450]];
    insert(shape, cap.map(([x, z]) => [sx * x, sz * z]), .1, "titanium", "socket");
  }
  if (near) serviceLatch(shape);
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

export const TEK: TierRecipe = {
  name: "tek", rank: 4, runPost: false, jointHalf: .11, tones: TONES, trims: tekTrims,
  split(name, form, level) {
    if (name === "wall") return wall(name, form, level);
    return tekDeck(name, form, level) ?? tekOpening(name, form, level);
  },
};

const palette = defaultPalette();
const colours = new Map(Object.entries(TONES).map(([name, rgb]) => [name, nearestColour(palette, rgb[0], rgb[1], rgb[2])]));
function colour(mat: string): number {
  if (mat === "field" || mat === "alloy") return REGION_BASE;
  if (mat === "membrane") return TEK_INLAY_COLOUR;
  if (mat === "emitter") return TEK_RAIL_COLOUR;
  const index = colours.get(mat);
  if (index === undefined) throw new Error(`Unknown Tek finish ${mat}`);
  return index;
}

function bake(name: string, shapes: Shape[]): SourceMesh {
  return {
    id: `core:${name}_tek`,
    lods: shapes.map((shape, level) => {
      const lod = flatLod(shape, colour, level < 3 && shape.triangles > 2, { stableDiagonals: true });
      if (name !== "wall" && !name.startsWith("wall_join_")) {
        const bones = lod.bones ??= new Uint8Array(lod.colors.length);
        for (let i = 0; i < bones.length; i++) bones[i]! |= FACE_PLAIN;
      }
      return { ...lod, ...(level ? { error: errorOf(shape, level) } : {}) };
    }),
  };
}

export function bakeTekWall(form: FormDef): SourceMesh {
  return bake("wall", levelsOf(TEK, "wall", form));
}

/** A shared edge takes a slice from the middle of a longer field, including its plate and closed cut ends. */
export function joinedTekWall(form: FormDef, mask: number, level: number): Shape | null {
  const shape = wall("wall", form, level);
  if (!shape || mask === 0 || level === 4) return shape;
  const edge = (v: number, negative: number, positive: number): number =>
    v < 0 && (mask & negative) ? v - 3 : v > 0 && (mask & positive) ? v + 3 : v;
  place(shape, ([x, y, z]) => [edge(x, 1, 2), y, edge(z, 4, 8)]);
  const ends: readonly Vec[] = [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
  for (let i = 0; i < ends.length; i++) if (mask & (1 << i)) clip(shape, [ends[i]!, 1.5], () => ["socket", [0, 0]]);
  return shape;
}

export function bakeTek(forms: Readonly<Record<string, FormDef>>): SourceMesh[] {
  const meshes = Object.entries(forms).map(([name, form]) => bake(name, levelsOf(TEK, name, form)));
  const wallForm = forms.wall;
  if (wallForm) for (let mask = 1; mask < 16; mask++) {
    const name = `wall_join_${mask}`;
    const levels = levelsOf({ ...TEK, split: (_, form, level) => joinedTekWall(form, mask, level) }, name, wallForm);
    meshes.push(bake(name, levels));
  }
  for (const [name, shapes] of Object.entries(tekTrims())) meshes.push(bake(name, shapes));
  return meshes;
}
