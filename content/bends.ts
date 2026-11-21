// Bent street sections (shared/world/bends.ts, planning/workstreams/bent-sections.md): a few modelled lengths of kerb,
// gutter and walk, each drawn bent along the street by its instance's bend, and the plain pieces a map lays under them to
// be walked and driven on. A bent kind is drawn as its mesh in the street pieces asset
// (assets/source/core/props/street/curb.py `bent`, which keeps these numbers) and walked as nothing (StructureDef.bent);
// its shape is the box of its modelled 4 m, which nothing draws or walks. A collision piece is drawn as nothing near and
// as its boxes past the near rows, where the far city takes it for the kerb: a box from the kerb's face to the walk's
// back at the kerb's height, or a flush kerb's ramp. Every id sorts after every other core id, so no index moves.

import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import type { HullDef } from "../shared/world/convex.ts";
import { PAVING } from "../shared/world/vehicle-surface.ts";
import { BENT_KERBS, FLUSH_APRON, FLUSH_FACE, HIT_LENGTHS, HIT_WIDTHS, KERB_BACK, KERB_HEIGHT, MODEL_HALF, MODEL_WALK, across, bentJoin, bentKind, hitKind } from "../shared/world/bends.ts";

/** The walk kit's concrete and its kerb's pale top (content/ruins.ts street()), for the far city's boxes. */
const CONCRETE = 100, CURB = 101, WALK = 100;

/** The pieces that join two kerbs along their length, from the first to the second. */
export const BENT_JOINS = [["raised", "flush"], ["flush", "raised"], ["worn", "flush"], ["flush", "worn"], ["raised", "worn"], ["worn", "raised"]] as const;

/** Every bent kind: each kerb straight and curved, and the joins. */
export const BENT_KINDS: readonly string[] = [...BENT_KERBS.flatMap((k) => [bentKind(k, false), bentKind(k, true)]), ...BENT_JOINS.map(([a, b]) => bentJoin(a, b))];

const bentShape = (id: string): ShapeDef => {
  const back = id.includes("median") ? KERB_BACK : MODEL_WALK;
  return { type: "shape", id: `${id}_shape`, role: "thing", boxes: [{ at: [0, KERB_HEIGHT / 2, back / 2], half: [MODEL_HALF, KERB_HEIGHT / 2, back / 2] }] };
};

const BENT_SHAPES = BENT_KINDS.map(bentShape);
const BENT: readonly StructureDef[] = BENT_KINDS.map((id, i) => ({
  type: "structure", class: "static", id, mesh: id, shape: BENT_SHAPES[i]!.id, half: shapeHalf(BENT_SHAPES[i]!.boxes), bent: true,
  color: CONCRETE, hp: 16000, near: true,
}));

/** A collision piece's walked parts and its look: a box at the kerb's height, or a ramp up from the road at the face. */
function hit(ramp: boolean, width: number, length: number): { shape: ShapeDef; def: StructureDef } {
  const x = length / 2, h = KERB_HEIGHT / 2, z = width / 2;
  // Its middle is its box's: the kerb's face at -z, the road at -h.
  const box: ShapeBox[] = [{ at: [0, 0, 0], half: [x, h, z] }];
  // A flush kerb's ramp, as its piece is drawn: its modelled apron stretched as its walk is (bends.ts `across`).
  const apron = Math.min(across(FLUSH_APRON, width), width);
  const profile: [number, number][] = [[-z, -h], [-z, FLUSH_FACE - h], [apron - z, h], ...(apron < width ? [[z, h] as [number, number]] : []), [z, -h]];
  const hulls: HullDef[] = [{ corners: [-x, x].flatMap((lx) => profile.map(([lz, ly]) => [lx, ly, lz] as const)) }];
  const look = width <= KERB_BACK + 0.01 || ramp ? undefined : { boxes: [{ at: [0, 0, KERB_BACK / 2 - z], half: [x, h, KERB_BACK / 2], color: CURB }, { at: [0, 0, KERB_BACK / 2], half: [x, h, z - KERB_BACK / 2], color: WALK }] as ShapeBox[] };
  const id = hitKind(ramp, width, length);
  const shape: ShapeDef = ramp ? { type: "shape", id: `${id}_shape`, role: "thing", boxes: [], hulls } : { type: "shape", id: `${id}_shape`, role: "thing", boxes: box, ...(look ? { look } : {}) };
  return { shape, def: { type: "structure", class: "static", id, mesh: "none", shape: shape.id, half: shapeHalf(shape.boxes, shape.hulls, shape.look), color: CONCRETE, hp: 16000, near: true, vehicleSurface: PAVING } };
}

const HITS = [false, true].flatMap((ramp) => HIT_WIDTHS.flatMap((w) => HIT_LENGTHS.map((l) => hit(ramp, w, l))));

export const BENT_SECTIONS: readonly Def[] = [...BENT_SHAPES, ...BENT, ...HITS.flatMap((h) => [h.shape, h.def])];
