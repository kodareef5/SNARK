// The components the sheet shows: one of each family, built from the kit's own shapes (content/ruins.ts).

import { FACADE_AT, RUIN_FACADES, RUIN_FINISHES, RUIN_SHAPES, type FacadeModule } from "../ruins.ts";
import { Rng } from "../../shared/rng.ts";
import { FLOOR, WALL, partBox, type Part } from "./cut.ts";
import { along, halves, placed, plateForms, slabBreach, slabOpen, wallBreach, wallOpen, type Component, type Form, type FormName, type Opening, type Plate } from "./forms.ts";
import type { Corner, Pt, Rect } from "./geometry.ts";
import { heapForm, hungPanel, hungSlab } from "./heap.ts";
import { MORE_A } from "./more-a.ts";
import { MORE_B } from "./more-b.ts";

const finish = (name: keyof typeof RUIN_FINISHES): readonly [number, number] => [RUIN_FINISHES[name].color, RUIN_FINISHES[name].under];
// The kit's fixed colours (content/ruins.ts): a dark opening and a pane are glass; a steel member, a sign and a sill are fittings.
const DARK = 83, PANE = 92, METAL = 89, SIGN = 135, GLOOM = 84, TIMBER = 96;
/** A part thinner than this in its plane is a fitting, which a cut takes whole. */
const THIN = 0.13;

/** A plain box of the kit standing on its floor: along it, up from 0, through its thickness. */
function standing(shape: keyof typeof RUIN_SHAPES): { bounds: Rect; part: Part } {
  const [w, h, d] = RUIN_SHAPES[shape];
  const bounds: Rect = [-w / 2, w / 2, 0, h];
  return { bounds, part: { r: bounds, w0: -d / 2, w1: d / 2 } };
}

/** A plain slab of the kit, its plane level. */
function lying(shape: keyof typeof RUIN_SHAPES): { bounds: Rect; part: Part } {
  const [w, h, d] = RUIN_SHAPES[shape];
  const bounds: Rect = [-w / 2, w / 2, -d / 2, d / 2];
  return { bounds, part: { r: bounds, w0: -h / 2, w1: h / 2 } };
}

/** A facade module's drawn parts and solid parts in the facade's metres: along the bay, up from the storey's floor, out from the wall line. */
function moduleParts(name: FacadeModule): { parts: Part[]; solid: Part[] } {
  const shape = RUIN_FACADES[name], at = FACADE_AT[name];
  const boxed = (b: { at: readonly number[]; half: readonly number[]; color?: number }): Part => {
    const r: Rect = [b.at[0]! - b.half[0]! + at[0]!, b.at[0]! + b.half[0]! + at[0]!, b.at[1]! - b.half[1]! + at[1]!, b.at[1]! + b.half[1]! + at[1]!];
    const thin = Math.min(r[1] - r[0], r[3] - r[2]) < THIN;
    return {
      r, w0: b.at[2]! - b.half[2]! + at[2]!, w1: b.at[2]! + b.half[2]! + at[2]!,
      ...(b.color !== undefined ? { color: b.color } : {}),
      ...(b.color === DARK || b.color === PANE ? { glass: true } : thin || b.color === SIGN || b.color === METAL ? { loose: true } : {}),
    };
  };
  const hulled = (corners: readonly Corner[]): Part => {
    const moved = corners.map(([x, y, z]): Corner => [x + at[0]!, y + at[1]!, z + at[2]!]);
    const of = (a: number): number[] => moved.map((c) => c[a]!);
    return { r: [Math.min(...of(0)), Math.max(...of(0)), Math.min(...of(1)), Math.max(...of(1))], w0: Math.min(...of(2)), w1: Math.max(...of(2)), hull: moved };
  };
  return { parts: [...(shape.look?.boxes ?? []).map(boxed), ...(shape.look?.hulls ?? []).map((h) => hulled(h.corners))], solid: shape.boxes.map(boxed).map((p): Part => ({ r: p.r, w0: p.w0, w1: p.w1 })) };
}

/** What a plate has besides the forms an opening makes: its hung form, its heap. */
type More = (variant: number) => Form[];

function plate(name: string, family: string, material: string, colours: readonly [number, number], p: Plate, eye?: readonly [number, number], apart?: readonly [number, number, number], more?: More): Component {
  return { name, family, material, finish: colours, skin: p.solid.map((s) => partBox(p.frame, s)), ...(eye ? { eye } : {}), ...(apart ? { apart } : p.frame === FLOOR ? { apart: [0, 2.2, 0] as const } : {}), forms: (variant) => [...plateForms(p, variant), ...(more?.(variant) ?? [])] };
}

/** A wall's heap along its own line, of its own bulk. */
const wallHeap = (name: string, bounds: Rect, part: Part, variant: number): Form =>
  heapForm({ name, variant, kind: "wall", footprint: [bounds[0], bounds[1], part.w0, part.w1], floor: bounds[2], volume: (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]) * (part.w1 - part.w0) });

/** A component whose every form is solid as its first variant is, whatever a form's maker did, with its numbers on the grid. */
const oneSolid = (c: Component): Component => ({ ...c, forms: (variant) => { const first = variant === 0 ? null : c.forms(0); return c.forms(variant).map((f, i) => placed(first ? { ...f, walked: first[i]!.walked } : f)); } });

/** An opening with nothing left standing in its window: broken down to the floor, its shards the bands above. */
const cleared = (window: Rect, passable: readonly Rect[] = [window], piece?: number): Opening => ({
  window, c: [(window[0] + window[1]) / 2, window[3]], closed: false, opening: [], passable, ...(piece !== undefined ? { piece } : {}),
  profile: (seed) => [[window[0], window[2]], ...along(new Rng(seed), window[0], window[1], window[2]), [window[1], window[2]]],
});

function slab(): Component {
  const { bounds, part } = lying("floor8");
  return plate("floor8", "slab", "concrete", finish("concrete"), {
    name: "floor8", frame: FLOOR, parts: [part], solid: [part], cells: halves(bounds),
    breach: slabBreach, open: () => slabOpen(bounds), barsIn: [part.w0, part.w1], bears: { breached: true, open: false },
  }, [32, 40], undefined, (variant) => [
    hungSlab({ name: "floor8", variant, bounds, y0: part.w0, y1: part.w1, held: "x0" }),
    heapForm({ name: "floor8", variant, kind: "slab", footprint: bounds, floor: part.w0, volume: (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]) * (part.w1 - part.w0) }),
  ]);
}

function bearingWall(): Component {
  const { bounds, part } = standing("wall8");
  return plate("wall8", "bearing wall", "block", finish("mintblock"), {
    name: "wall8", frame: WALL, parts: [part], solid: [part], cells: halves(bounds),
    breach: wallBreach, open: () => wallOpen(bounds), barsIn: null, bears: { breached: true, open: false },
  }, undefined, undefined, (variant) => [wallHeap("wall8", bounds, part, variant)]);
}

/** A precast panel: reinforced, so its breaks bare bars. It bears nothing. */
function panel(): Component {
  const { bounds, part } = standing("zpanel8");
  return plate("zpanel8", "precast panel", "concrete", finish("concrete"), {
    name: "zpanel8", frame: WALL, parts: [part], solid: [part], cells: halves(bounds),
    breach: wallBreach, open: () => wallOpen(bounds), barsIn: [part.w0, part.w1], bears: { breached: false, open: false },
  }, undefined, undefined, (variant) => [hungPanel({ name: "zpanel8", variant, bounds, z0: part.w0, z1: part.w1 }), wallHeap("zpanel8", bounds, part, variant)]);
}

function windowBay(): Component {
  const { parts, solid } = moduleParts("zwin");
  const bounds: Rect = [-4, 4, 0, 4];
  return plate("zwin", "window bay", "block and glass", finish("limestucco"), {
    name: "zwin", frame: WALL, parts, solid, cells: halves(bounds),
    // Its bands and piers are parts of their own, so it is opened in fewer, larger shards than a plain wall.
    breach: wallBreach, open: () => wallOpen(bounds, 0.45, 0.65, 2.4, 2.4), barsIn: null, bears: { breached: false, open: false },
  });
}

/** A shop's front. Its halves are not alike: A is the display on its riser, B the door's pier. Its half piers and head bear. */
function storefront(): Component {
  const { parts, solid } = moduleParts("zstore");
  // Both stop under the drip at the sign's foot, which a cut would take whole.
  const display: Rect = [-3.6, 1.4, 0, 2.76], pier: Rect = [1.4, 1.6, 0, 2.76];
  const plateOf: Plate = {
    name: "zstore", frame: WALL, parts, solid, cells: [display, pier],
    breach: (cell) => cell === display
      ? cleared(display, [[-3.6, 1.4, 0, 2.76]], 2)
      : { window: pier, c: [1.5, 2.76], closed: false, opening: [], passable: [[1.4, 1.6, 0.5, 2.76]], profile: (seed): Pt[] => { const rng = new Rng(seed); return [[1.4, rng.range(0.3, 0.5)], [1.6, rng.range(0.15, 0.5)]]; } },
    open: () => cleared([-3.6, 3.6, 0, 3.8], [[-3.6, 3.6, 0, 3.8]], 2),
    barsIn: null, bears: { breached: true, open: true },
  };
  // The display and the pier are not two halves of one width, so its parts are not split between them.
  return { name: "zstore", family: "storefront", material: "concrete, glass, sheet", finish: finish("limestucco"), skin: solid.map((s) => partBox(WALL, s)), forms: (variant) => plateForms({ ...plateOf, cells: [display, pier] }, variant).map((f, i) => (i === 1 ? { ...f, note: "display, riser and frame gone" } : i === 2 ? { ...f, note: "door pier broken" } : f)) };
}

function curtain(): Component {
  const { parts, solid } = moduleParts("zcurt");
  // The spandrel's foot covers the slab's edge and stays, which is the solid left when the panel is open.
  const half = (u0: number, u1: number): Opening => cleared([u0 + 0.05, u1 - 0.05, 0, 3.6], [[u0, u1, 0, 3.6]], 2);
  return plate("zcurt", "curtain panel", "steel, glass, concrete spandrel", finish("limestone"), {
    name: "zcurt", frame: WALL, parts, solid, cells: [[-4, 0, -0.4, 3.6], [0, 4, -0.4, 3.6]],
    breach: (cell) => half(cell[0], cell[1]), open: () => [half(-4, 0), half(0, 4)], barsIn: null, bears: { breached: false, open: false },
  });
}

function parapet(): Component {
  const { bounds, part } = standing("zparapet8");
  const [u0, u1, v0, v1] = bounds;
  return plate("zparapet8", "parapet", "block", finish("limestucco"), {
    name: "zparapet8", frame: WALL, parts: [part], solid: [part], cells: halves(bounds),
    breach: (cell) => { const cu = (cell[0] + cell[1]) / 2; return { window: [cu - 1.8, cu + 1.8, v0, v1], c: [cu, v0], closed: false, opening: [[cu + 1.4, v0], [cu + 1.4, v1], [cu - 1.4, v1], [cu - 1.4, v0]], passable: [[cu - 1.4, cu + 1.4, v0, v1]] }; },
    // Gone to the slab but for a ragged kerb.
    open: () => ({ window: bounds, c: [0, v1], closed: false, opening: [], passable: [[u0, u1, v0 + 0.2, v1]], piece: 2, profile: (seed): Pt[] => { const rng = new Rng(seed); return [[u0, v0 + rng.range(0.05, 0.2)], ...along(rng, u0, u1, v0, 1.2).map(([u]): Pt => [u, v0 + rng.range(0, 0.2)]), [u1, v0 + rng.range(0.05, 0.2)]]; } }),
    barsIn: null, bears: { breached: false, open: false },
  });
}

/**
 * A tower's hollow upper shell, four storeys in one piece. It stays solid when opened: what shows behind its skin is drawn
 * only, four slab edges and posts with the dark of the storeys set back.
 */
function shell(): Component {
  const { bounds, part } = standing("zshaft16");
  const [u0, u1, v0, v1] = bounds, mid = (u0 + u1) / 2;
  const half = (a: number, b: number): Opening => ({ window: [a + 0.1, b - 0.1, v0 + 0.1, v1 - 0.1], c: [(a + b) / 2, (v0 + v1) / 2], closed: true, run: 8, opening: [[b - 0.5, v0 + 0.5], [b - 0.5, v1 - 0.5], [a + 0.5, v1 - 0.5], [a + 0.5, v0 + 0.5]], passable: [] });
  const inside = (a: number, b: number): Part[] => [
    { r: [a + 0.2, b - 0.2, v0 + 0.2, v1 - 0.2], w0: part.w0, w1: part.w0 + 0.1, color: GLOOM },
    ...[4, 8, 12].map((y): Part => ({ r: [a + 0.2, b - 0.2, y - 0.2, y + 0.2], w0: part.w0 + 0.1, w1: part.w1 - 0.25 })),
    ...[a + 0.5, (a + b) / 2, b - 0.5].map((x): Part => ({ r: [x - 0.3, x + 0.3, v0 + 0.2, v1 - 0.2], w0: part.w0 + 0.1, w1: part.w1 - 0.35 })),
  ];
  return plate("zshaft16", "hollow shell", "concrete", finish("concrete"), {
    name: "zshaft16", frame: WALL, parts: [part], solid: [part], cells: halves(bounds),
    breach: (cell) => half(cell[0], cell[1]), open: () => [half(u0, mid), half(mid, u1)], barsIn: null, bears: { breached: true, open: true },
    behind: (form: FormName) => (form === "breach A" ? inside(u0, mid) : form === "breach B" ? inside(mid, u1) : inside(u0, mid).concat(inside(mid, u1))),
  }, [24, 14], [0, -2, 12]);
}

/** A partition: plaster on studs. It has no half-way: opened, its studs and plates stand and a body walks between them. */
function partition(): Component {
  const { bounds, part } = standing("zpartition");
  const [u0, u1, v0, v1] = bounds;
  const studs: Part[] = [
    { r: [u0, u1, v0, v0 + 0.08], w0: -0.05, w1: 0.05, color: TIMBER }, { r: [u0, u1, v1 - 0.08, v1], w0: -0.05, w1: 0.05, color: TIMBER },
    ...Array.from({ length: 11 }, (_, k): Part => { const x = u0 + 0.025 + (k * (u1 - u0 - 0.05)) / 10; return { r: [x - 0.025, x + 0.025, v0 + 0.08, v1 - 0.08], w0: -0.05, w1: 0.05, color: TIMBER }; }),
  ];
  return plate("zpartition", "partition", "plaster on timber", finish("limestone"), {
    name: "zpartition", frame: WALL, parts: [part], solid: [part], cells: [],
    breach: wallBreach, open: () => cleared(bounds, [[u0, u1, v0 + 0.08, v1]]), barsIn: null, bears: { breached: false, open: false },
    behind: () => studs,
  });
}

export const SAMPLES: readonly Component[] = [slab(), ...MORE_A, bearingWall(), panel(), windowBay(), storefront(), curtain(), ...MORE_B, parapet(), shell(), partition()].map(oneSolid);
