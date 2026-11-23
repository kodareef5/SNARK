// The kit's balcony module (zbalc): two flats' balconies on one slab, a divider between them, a recessed wall behind. A
// flat's balcony breaks off at the wall's face and at the divider. The wall behind it is never touched.

import { FACADE_AT, RUIN_FACADES, RUIN_FINISHES } from "../../content/ruins.ts";
import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { Rng } from "../../shared/rng.ts";
import { FLOOR, boxOf, cut, type Chunk, type Cut, type Part } from "./cut.ts";
import { seedOf, type Component, type Form } from "./forms.ts";
import { grid, type Corner, type Pt, type Rect } from "./geometry.ts";
import { plan, type Plan } from "./plan.ts";

const NAME = "zbalc";
const RUST = 179;
/** The most a tooth of the slab stands out past the break. */
const TOOTH = 0.32;

const AT = FACADE_AT.zbalc;
/** A box of the kit's shape put back in the facade's metres: the storey's floor at y = 0, the wall line at z = 0. */
const placed = (b: ShapeBox): ShapeBox => ({ at: [grid(b.at[0] + AT[0]!), grid(b.at[1] + AT[1]!), grid(b.at[2] + AT[2]!)], half: [grid(b.half[0]), grid(b.half[1]), grid(b.half[2])], ...(b.color !== undefined ? { color: b.color } : {}) });
const lo = (b: ShapeBox, axis: number): number => b.at[axis]! - b.half[axis]!;
const hi = (b: ShapeBox, axis: number): number => b.at[axis]! + b.half[axis]!;

const SHAPE = RUIN_FACADES.zbalc;
const LOOK = (SHAPE.look?.boxes ?? []).map(placed), WALKED = SHAPE.boxes.map(placed);
/** The wall's outer face, which the slab breaks at. */
const FACE = Math.max(...WALKED.filter((b) => lo(b, 2) < 0).map((b) => hi(b, 2)));
/** A part of the balcony stands outside the wall's face. The rest is the wall. */
const outside = (b: ShapeBox): boolean => hi(b, 2) > FACE + 0.01;
/** Whose a part is: the flat's on x < 0 is -1, the other's 1, and 0 is both flats', as the divider is. */
const flat = (b: ShapeBox): number => (hi(b, 0) <= 1e-6 ? -1 : lo(b, 0) >= -1e-6 ? 1 : 0);
const DIVIDER = LOOK.filter((b) => outside(b) && flat(b) === 0 && b.half[0] < 0.5);
/** The divider's faces along x, which the slab breaks at too. */
const EDGE = Math.max(0, ...DIVIDER.map((b) => hi(b, 0)));

/** A part of both flats cut at the bay's middle, so one flat's half can go. The divider is left whole. */
function halved(b: ShapeBox): ShapeBox[] {
  if (!outside(b) || flat(b) !== 0 || DIVIDER.includes(b)) return [b];
  return [[lo(b, 0), 0], [0, hi(b, 0)]].map(([x0, x1]): ShapeBox => ({ ...b, at: [grid((x0! + x1!) / 2), b.at[1], b.at[2]], half: [grid((x1! - x0!) / 2), b.half[1], b.half[2]] }));
}
const PARTS = LOOK.flatMap(halved), SOLID = WALKED.flatMap(halved);

/** The slab as the kit draws it, its lower outer edge cut, and one flat's half of that. */
const SLAB: readonly Corner[] = (SHAPE.look?.hulls ?? [])[0]!.corners.map(([x, y, z]): Corner => [grid(x + AT[0]!), grid(y + AT[1]!), grid(z + AT[2]!)]);
const slabHalf = (side: number): Chunk => ({ corners: SLAB.map(([x, y, z]): Corner => [side < 0 ? Math.min(x, 0) : Math.max(x, 0), y, z]) });
/** The slab as it is walked, which is the box a break cuts. */
const DECK = WALKED.find((b) => outside(b) && hi(b, 1) < 0.01)!;
const deck = (x0: number, x1: number): Part => ({ r: [x0, x1, lo(DECK, 2), hi(DECK, 2)], w0: lo(DECK, 1), w1: hi(DECK, 1) });

const loose = (b: ShapeBox): Chunk[] => {
  const corners: Corner[] = [];
  for (const x of [lo(b, 0), hi(b, 0)]) for (const y of [lo(b, 1), hi(b, 1)]) for (const z of [lo(b, 2), hi(b, 2)]) corners.push([x, y, z]);
  return [{ corners, ...(b.color !== undefined ? { color: b.color } : {}) }];
};

/**
 * A length of the slab broken off from `x0` to `x1`, all the way out: teeth are left along the wall's face, and at an end
 * that is the divider's. Seeds are tried in turn until the shards are `few` to `many`.
 */
function broken(x0: number, x1: number, seed: number, few: number, many: number, run: number): { cut: Cut; plan: Plan } {
  const out = hi(DECK, 2), wall = FACE + TOOTH;
  const window: Rect = [x0 === 0 ? EDGE : x0, x1 === 0 ? -EDGE : x1, FACE, out];
  const a = x0 === 0 ? window[0] + TOOTH : x0, b = x1 === 0 ? window[1] - TOOTH : x1;
  for (let k = 0; ; k++) {
    const rng = new Rng(seed + k);
    // The mouth is seen from a point on the slab's outer edge, and its shards fan from there.
    const c: Pt = [grid((x0 + x1) / 2 + rng.range(-0.5, 0.5)), out];
    const p = plan({ window, c, opening: [[a, out], [a, wall], [b, wall], [b, out]], closed: false, seed: seed + k, tooth: TOOTH, run });
    const made = cut(FLOOR, [deck(x0, x1)], p);
    if ((made.fragments.length >= few && made.fragments.length <= many) || k > 64) return { cut: made, plan: p };
  }
}

/** Bars bared at the wall's face: each runs out from a point of the break and hangs down at its end. */
function bars(p: Plan, count: number, seed: number): ShapeBox[] {
  const rng = new Rng(seed ^ 0x5bd1e995), T = 0.035;
  const at = p.mouth.filter(([u, v]) => v < FACE + TOOTH + 0.05 && u > p.window[0] + 0.3 && u < p.window[1] - 0.3);
  const out: ShapeBox[] = [];
  for (let k = 0; k < count && at.length > 0; k++) {
    const [u, v] = at.splice(rng.int(at.length), 1)[0]!;
    const length = rng.range(0.25, 0.6), drop = rng.range(0.1, 0.4), w = k % 2 ? lo(DECK, 1) + 0.07 : hi(DECK, 1) - 0.07;
    out.push(boxOf(FLOOR, [u - T, u + T, v - 0.05, v + length], w - T, w + T, RUST), boxOf(FLOOR, [u - T, u + T, v + length - T, v + length + T], w - drop, w - T, RUST));
  }
  return out;
}

function breach(name: "breach A" | "breach B", side: -1 | 1, variant: number): Form {
  const seed = seedOf(NAME, name, variant);
  const { cut: made, plan: p } = broken(side < 0 ? lo(DECK, 0) : 0, side < 0 ? 0 : hi(DECK, 0), seed, 4, 6, 1.1);
  const gone = (b: ShapeBox): boolean => outside(b) && flat(b) === side;
  const boxes = [...PARTS.filter((b) => !gone(b)), ...made.look.boxes, ...bars(p, 2 + (seed & 1), seed)];
  const fragments = [...made.fragments, ...PARTS.filter(gone).map(loose)];
  return { name, note: "one flat's balcony gone", look: { boxes, chunks: [slabHalf(-side), ...made.look.chunks] }, walked: { boxes: SOLID.filter((b) => !gone(b)), hulls: [] }, fragments, panes: [], bears: false };
}

function open(variant: number): Form {
  const seed = seedOf(NAME, "open", variant);
  const { cut: made, plan: p } = broken(lo(DECK, 0), hi(DECK, 0), seed, 6, 9, 1.6);
  const boxes = [...PARTS.filter((b) => !outside(b)), ...made.look.boxes, ...bars(p, 3 + (seed & 1), seed)];
  const fragments = [...made.fragments, ...PARTS.filter(outside).map(loose)];
  return { name: "open", note: "both balconies gone, the wall bare", look: { boxes, chunks: made.look.chunks }, walked: { boxes: SOLID.filter((b) => !outside(b)), hulls: [] }, fragments, panes: [], bears: false };
}

export function balcony(): Component {
  const finish = RUIN_FINISHES.limestucco;
  const whole: Form = { name: "whole", note: "", look: { boxes: PARTS, chunks: [slabHalf(-1), slabHalf(1)] }, walked: { boxes: WALKED, hulls: [] }, fragments: [], panes: [], bears: false };
  return {
    name: NAME, family: "balcony", material: "concrete", finish: [finish.color, finish.under], skin: WALKED, eye: [24, 34],
    forms: (variant) => [whole, breach("breach A", -1, variant), breach("breach B", 1, variant), open(variant)],
  };
}
