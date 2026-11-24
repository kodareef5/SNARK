// Every shape of the ruin kit that breaks, as a component: its forms cut from the kit's own parts (content/ruins.ts).

import { FACADE_AT, RUIN_FACADES, RUIN_FINISHES, RUIN_SHAPES, type FacadeModule, type RuinShape } from "../ruins.ts";
import { Rng } from "../../shared/rng.ts";
import { balcony } from "./balcony.ts";
import { FLOOR, WALL, partBox, splitAt, type Frame, type Part } from "./cut.ts";
import { BREAKING_SHAPES, FAMILY_RULES, familyOf, type Family } from "./families.ts";
import { cleared, halves, kerb, kitted, plateForms, slabBreach, slabOpen, stubbed, stump, upstandBreach, wallBreach, wallOpen, type Component, type Form, type FormName, type Kit, type Opening, type Plate } from "./forms.ts";
import { rectMeet, type Corner, type Pt, type Rect } from "./geometry.ts";
import { heapForm, hungPanel, hungSlab } from "./heap.ts";
import { pier } from "./pier.ts";
import { pitchedRoof } from "./roof.ts";

type Finish = keyof typeof RUIN_FINISHES;
// The kit's fixed colours (content/ruins.ts): a dark opening and a pane are glass; a steel member, a sign and a sill are fittings.
const DARK = 83, PANE = 92, METAL = 89, SIGN = 135, GLOOM = 84, TIMBER = 96;
/** A part thinner than this in its plane is a fitting, which a cut takes whole. */
const THIN = 0.13;

/** What the sheet draws a family in, and calls what it is built of. */
const DRAWN: Readonly<Record<Family, readonly [Finish, string]>> = {
  slab: ["concrete", "concrete"], pier: ["concrete", "concrete"], beam: ["concrete", "concrete"], bar: ["limestucco", "block"], wall: ["mintblock", "block"],
  panel: ["concrete", "concrete"], parapet: ["limestucco", "block"], window: ["limestucco", "block and glass"], store: ["limestucco", "concrete, glass, sheet"],
  curtain: ["limestone", "steel, glass, concrete spandrel"], clad: ["concrete", "concrete"], balcony: ["limestucco", "concrete"], deck: ["concrete", "concrete"],
  roof: ["clay", "tile on timber"], shell: ["concrete", "concrete"], interior: ["limestone", "plaster on timber"], none: ["concrete", "concrete"],
};

interface Stood { readonly bounds: Rect; readonly part: Part; readonly origin: Corner }

/** A plain box of the kit standing on its floor: along it, up from 0, through its thickness. */
function standing(shape: RuinShape): Stood {
  const [w, h, d] = RUIN_SHAPES[shape];
  const bounds: Rect = [-w / 2, w / 2, 0, h];
  return { bounds, part: { r: bounds, w0: -d / 2, w1: d / 2 }, origin: [0, h / 2, 0] };
}

/** A plain slab of the kit, its plane level. */
function lying(shape: RuinShape): Stood {
  const [w, h, d] = RUIN_SHAPES[shape];
  const bounds: Rect = [-w / 2, w / 2, -d / 2, d / 2];
  return { bounds, part: { r: bounds, w0: -h / 2, w1: h / 2 }, origin: [0, 0, 0] };
}

/**
 * A facade module's drawn parts and solid parts in the facade's metres: along the bay, up from the storey's floor, out from
 * the wall line. In a wall's frame a part's plane is along and up; in a floor's, along and out.
 */
function moduleParts(name: FacadeModule, frame: Frame = WALL): { parts: Part[]; solid: Part[]; origin: Corner } {
  const shape = RUIN_FACADES[name], at = FACADE_AT[name];
  const [second, through] = frame === WALL ? [1, 2] : [2, 1];
  const boxed = (b: { at: readonly number[]; half: readonly number[]; color?: number }): Part => {
    const span = (a: number): [number, number] => [b.at[a]! - b.half[a]! + at[a]!, b.at[a]! + b.half[a]! + at[a]!];
    const r: Rect = [...span(0), ...span(second)], [w0, w1] = span(through);
    const thin = Math.min(r[1] - r[0], r[3] - r[2]) < THIN;
    return { r, w0, w1, ...(b.color !== undefined ? { color: b.color } : {}), ...(b.color === DARK || b.color === PANE ? { glass: true } : thin || b.color === SIGN || b.color === METAL ? { loose: true } : {}) };
  };
  const hulled = (corners: readonly Corner[]): Part => {
    const moved = corners.map(([x, y, z]): Corner => [x + at[0]!, y + at[1]!, z + at[2]!]);
    const of = (a: number): number[] => moved.map((c) => c[a]!);
    return { r: [Math.min(...of(0)), Math.max(...of(0)), Math.min(...of(second)), Math.max(...of(second))], w0: Math.min(...of(through)), w1: Math.max(...of(through)), hull: moved };
  };
  return {
    parts: [...(shape.look?.boxes ?? []).map(boxed), ...(shape.look?.hulls ?? []).map((h) => hulled(h.corners))],
    solid: shape.boxes.map(boxed).map((p): Part => ({ r: p.r, w0: p.w0, w1: p.w1 })), origin: [at[0]!, at[1]!, at[2]!],
  };
}

/** A heap along a piece's line or over its plan, of its own bulk. It lies at `floor`, or at the piece's foot. */
function heapOf(name: string, kind: "wall" | "slab", frame: Frame, solid: readonly Part[], variant: number, floor?: number): Form {
  const boxes = solid.map((s) => partBox(frame, s));
  const lo = (a: number): number => Math.min(...boxes.map((b) => b.at[a]! - b.half[a]!)), hi = (a: number): number => Math.max(...boxes.map((b) => b.at[a]! + b.half[a]!));
  return heapForm({ name, variant, kind, footprint: [lo(0), hi(0), lo(2), hi(2)], floor: floor ?? lo(1), volume: boxes.reduce((s, b) => s + 8 * b.half[0] * b.half[1] * b.half[2], 0) });
}

interface Shown {
  readonly origin: Corner;
  readonly eye?: readonly [number, number];
  readonly apart?: readonly [number, number, number];
  /** Where its heap lies, if not at its foot: a module's is on its storey's floor. */
  readonly floor?: number;
  /** Its forms besides those an opening makes and its heap: a hung form. */
  readonly more?: (variant: number) => Form[];
  /** What is said of each form an opening makes, in their order, for the sheet. */
  readonly notes?: readonly string[];
}

/** A component of a piece that is flat in its plane: the forms its openings make, any more it has, and its heap. */
function plated(name: RuinShape, p: Omit<Plate, "name" | "bears">, shown: Shown): Component {
  const family = familyOf(name), [finish, material] = DRAWN[family];
  const plate: Plate = { ...p, name, bears: FAMILY_RULES[family].bears };
  return {
    name, family, material, finish: [RUIN_FINISHES[finish].color, RUIN_FINISHES[finish].under], skin: p.solid.map((s) => partBox(p.frame, s)), origin: shown.origin,
    ...(shown.eye ? { eye: shown.eye } : {}), ...(shown.apart ? { apart: shown.apart } : p.frame === FLOOR ? { apart: [0, 2.2, 0] as const } : {}),
    forms: (variant, standing) => [
      ...plateForms(plate, variant, standing).map((f, i) => (i > 0 && shown.notes?.[i - 1] ? { ...f, note: shown.notes[i - 1]! } : f)),
      ...(shown.more?.(variant) ?? []),
      heapOf(name, p.frame === FLOOR ? "slab" : "wall", p.frame, p.solid, variant, shown.floor),
    ],
  };
}

function slab(name: RuinShape, held: "x0" | "z0" = "x0"): Component {
  const { bounds, part, origin } = lying(name);
  return plated(name, { frame: FLOOR, parts: [part], solid: [part], cells: halves(bounds), breach: slabBreach, open: () => slabOpen(bounds), barsIn: [part.w0, part.w1] }, {
    origin, eye: [32, 40], more: (variant) => [hungSlab({ name, variant, bounds, y0: part.w0, y1: part.w1, held })],
  });
}

/** A beam or a trim: gone but for a stub at each end. A longer one breaks into as many shards, each longer. */
function beam(name: RuinShape, reinforced: boolean): Component {
  const { bounds, part, origin } = standing(name), long = bounds[1] - bounds[0];
  return plated(name, { frame: WALL, parts: [part], solid: [part], cells: [], breach: wallBreach, open: () => stubbed(bounds, 0.6, 1.4 * Math.max(1, long / 8)), barsIn: reinforced ? [part.w0, part.w1] : null, barsAtFoot: false }, { origin, notes: ["a stub at each end"] });
}

/** A sill under a window: gone to a ragged kerb. */
function sill(name: RuinShape): Component {
  const { bounds, part, origin } = standing(name);
  return plated(name, { frame: WALL, parts: [part], solid: [part], cells: [], breach: wallBreach, open: () => kerb(bounds), barsIn: null }, { origin, notes: ["gone to a kerb"] });
}

/** An upright fin: gone to a stump. */
function fin(name: RuinShape): Component {
  const { bounds, part, origin } = standing(name);
  return plated(name, { frame: WALL, parts: [part], solid: [part], cells: [], breach: wallBreach, open: () => stump(bounds, Math.min(0.9, (bounds[3] - bounds[2]) * 0.2)), barsIn: null }, { origin, notes: ["gone to a stump"] });
}

/** A plain wall. A precast panel is one that is reinforced, so its breaks bare bars, and may hang by one fixing. */
function wall(name: RuinShape, precast: boolean): Component {
  const { bounds, part, origin } = standing(name), wide = bounds[1] - bounds[0];
  // A 16 m panel is opened in as many pieces as an 8 m one, each larger.
  const open = (): Opening => (wide > 8.01 ? wallOpen(bounds, 0.45, 0.65, 2.6, 2.4) : wallOpen(bounds, 0.45, 0.65, 1.3, Math.max(1.6, (bounds[3] - bounds[2]) / 2.5)));
  return plated(name, { frame: WALL, parts: [part], solid: [part], cells: halves(bounds), breach: wallBreach, open, barsIn: precast ? [part.w0, part.w1] : null }, {
    origin, ...(precast ? { more: (variant: number) => [hungPanel({ name, variant, bounds, z0: part.w0, z1: part.w1 })] } : {}),
  });
}

/** The extent of a module's solid in its wall's plane. */
const extent = (solid: readonly Part[]): Rect => [Math.min(...solid.map((s) => s.r[0])), Math.max(...solid.map((s) => s.r[1])), Math.min(...solid.map((s) => s.r[2])), Math.max(...solid.map((s) => s.r[3]))];

/** A parapet, a screen or an attic: a stretch lost from a half, then gone to a kerb. */
function parapet(name: RuinShape): Component {
  if (!(name in RUIN_FACADES)) {
    const { bounds, part, origin } = standing(name);
    return plated(name, { frame: WALL, parts: [part], solid: [part], cells: halves(bounds), breach: upstandBreach, open: () => kerb(bounds), barsIn: null }, { origin });
  }
  const { parts, solid, origin } = moduleParts(name as FacadeModule), bounds = extent(solid);
  return plated(name, { frame: WALL, parts, solid, cells: halves(bounds), breach: upstandBreach, open: () => kerb(bounds), barsIn: null }, { origin, floor: 0 });
}

/**
 * A storey of wall with openings of its own: a window bay, a clad panel, a ground floor of flats. A half is breached within
 * the storey, and it is opened to its top, a parapet with it. One with louvres is opened in `coarse` pieces, wider than
 * another's: cut as finely, its blades and bands were more triangles than a break set holds.
 */
function bay(name: FacadeModule, reinforced = false, coarse = false): Component {
  const { parts, solid, origin } = moduleParts(name), top = extent(solid)[3], main = solid[0]!;
  // Its bands and piers are parts of their own, so it is opened in fewer, larger shards than a plain wall.
  return plated(name, { frame: WALL, parts, solid, cells: halves([-4, 4, 0, 4]), breach: wallBreach, open: () => wallOpen([-4, 4, 0, top], 0.45, 0.65, coarse ? 4 : 2.4, coarse ? top : 0.6 * top), barsIn: reinforced ? [main.w0, main.w1] : null }, { origin, floor: 0 });
}

/** A shop's front. Its halves are not alike: A is the display on its riser, B the door's pier. Its half piers and head bear. */
function store(name: "zstore" | "zstorecut" | "zstorecutl"): Component {
  const { parts, solid, origin } = moduleParts(name);
  // The front cut back toward -x is the other's mirror.
  const rect = (a: number, b: number, v0: number, v1: number): Rect => (name === "zstorecutl" ? [-b, -a, v0, v1] : [a, b, v0, v1]);
  // Both stop under the drip at the sign's foot, which a cut would take whole.
  const display = rect(-3.6, 1.4, 0, 2.76), post = rect(1.4, 1.6, 0, 2.76);
  const breach = (cell: Rect): Opening => cell === display
    ? cleared(display, [display], 2)
    : { window: post, c: [(post[0] + post[1]) / 2, 2.76], closed: false, opening: [], passable: [[post[0], post[1], 0.5, 2.76]], profile: (seed): Pt[] => { const rng = new Rng(seed); return [[post[0], rng.range(0.3, 0.5)], [post[1], rng.range(0.15, 0.5)]]; } };
  return plated(name, { frame: WALL, parts, solid, cells: [display, post], split: null, breach, open: () => cleared([-3.6, 3.6, 0, 3.8], [[-3.6, 3.6, 0, 3.8]], 2), barsIn: null }, {
    origin, floor: 0, notes: ["display, riser and frame gone", "door pier broken"],
  });
}

/** A shop's front with its shutter down: a half of the shutter torn out, then all of it and the sign. */
function shutter(name: FacadeModule): Component {
  const { parts, solid, origin } = moduleParts(name);
  return plated(name, { frame: WALL, parts, solid, cells: [[-3.6, 0, 0, 2.76], [0, 3.6, 0, 2.76]], breach: (cell) => cleared(cell, [cell], 2), open: () => cleared([-3.6, 3.6, 0, 3.8], [[-3.6, 3.6, 0, 3.8]], 2), barsIn: null }, {
    origin, floor: 0, notes: ["half the shutter torn out", "half the shutter torn out"],
  });
}

/** A garage's way in: its head and clearance bar gone, its columns left. */
function gate(name: FacadeModule): Component {
  const { parts, solid, origin } = moduleParts(name);
  const head: Rect = [-3.65, 3.65, 2.75, 3.6];
  return plated(name, { frame: WALL, parts, solid, cells: [], breach: wallBreach, open: () => cleared(head), barsIn: null }, { origin, floor: 0, notes: ["the head gone"] });
}

/** A lobby's way in: its canopy broken off at the head, which stays. */
function entry(name: FacadeModule): Component {
  const { parts, solid, origin } = moduleParts(name, FLOOR);
  // The canopy seen from above, from the head's face out to its edge.
  const canopy: Rect = [-3.2, 3.2, 0.09, 2.1], tooth = 0.32;
  const open = (): Opening => ({
    window: canopy, c: [0, canopy[3]], closed: false, tooth, run: 1.6,
    opening: [[canopy[0], canopy[3]], [canopy[0], canopy[2] + tooth], [canopy[1], canopy[2] + tooth], [canopy[1], canopy[3]]], passable: [[-4, 4, canopy[2], canopy[3]]],
  });
  return plated(name, { frame: FLOOR, parts, solid, cells: [], breach: slabBreach, open, barsIn: null }, { origin, floor: 0, eye: [24, 34], notes: ["the canopy gone"] });
}

/** A curtain panel: a half's mullions and glass gone, then both, and a crown with them. The spandrel's foot stays over the slab's edge. */
function curtain(name: FacadeModule): Component {
  const { parts, solid, origin } = moduleParts(name), top = extent(solid)[3];
  const half = (u0: number, u1: number, to: number): Opening => cleared([u0 + 0.05, u1 - 0.05, 0, to], [[u0, u1, 0, to]], 2);
  return plated(name, { frame: WALL, parts, solid, cells: [[-4, 0, -0.4, 3.6], [0, 4, -0.4, 3.6]], breach: (cell) => half(cell[0], cell[1], 3.6), open: () => [half(-4, 0, top), half(0, 4, top)], barsIn: null }, { origin, floor: 0 });
}

/** A garage's open deck: a stretch of its spandrel lost in a half, then all of it to a kerb. Its columns stand. */
function deck(name: FacadeModule): Component {
  const { parts, solid, origin } = moduleParts(name);
  const spandrel: Rect = [-3.65, 3.65, 0, 1.05];
  return plated(name, { frame: WALL, parts, solid, cells: halves(spandrel), breach: upstandBreach, open: () => kerb(spandrel), barsIn: [0, 0.25] }, { origin, floor: 0 });
}

/** A half of a shell opened: nearly all of it, in a few great pieces. Nothing is passable. */
const shellHalf = ([a, b, v0, v1]: Rect): Opening => ({
  window: [a + 0.1, b - 0.1, v0 + 0.1, v1 - 0.1], c: [(a + b) / 2, (v0 + v1) / 2], closed: true, run: 8,
  opening: [[b - 0.5, v0 + 0.5], [b - 0.5, v1 - 0.5], [a + 0.5, v1 - 0.5], [a + 0.5, v0 + 0.5]], passable: [],
});

/** What shows behind an opened half: the dark of its storeys set back, a slab's edge at each floor, and posts. */
function shellInside([a, b, v0, v1]: Rect, w0: number, w1: number): Part[] {
  const deep = w1 - w0;
  return [
    { r: [a + 0.2, b - 0.2, v0 + 0.2, v1 - 0.2], w0, w1: w0 + 0.1, color: GLOOM },
    ...[4, 8, 12].filter((y) => y > v0 + 0.5 && y < v1 - 0.5).map((y): Part => ({ r: [a + 0.2, b - 0.2, y - 0.2, y + 0.2], w0: w0 + 0.1, w1: w1 - Math.min(0.25, deep / 3) })),
    ...[a + 0.5, (a + b) / 2, b - 0.5].map((x): Part => ({ r: [x - 0.3, x + 0.3, v0 + 0.2, v1 - 0.2], w0: w0 + 0.1, w1: w1 - Math.min(0.35, deep / 2) })),
  ];
}

/**
 * A tower's hollow upper shell, four storeys in one piece. It stays solid when opened: what shows behind its skin is drawn
 * only. One with a facade is cut as its plain skin, and the facade's parts in an opened half go with it: cut each by
 * each, four storeys of bands and piers are more chunks than a look or a break set holds.
 */
function shell(name: RuinShape): Component {
  const shown = { eye: [24, 14], apart: [0, -2, 12] } as const;
  if (!(name in RUIN_FACADES)) {
    const { bounds, part, origin } = standing(name), cells = halves(bounds);
    const behind = (form: FormName): Part[] => cells.filter((_, i) => form === "open" || (form === "breach A") === (i === 0)).flatMap((cell) => shellInside(cell, part.w0, part.w1));
    return plated(name, { frame: WALL, parts: [part], solid: [part], cells, breach: shellHalf, open: () => cells.map(shellHalf), barsIn: null, behind }, { origin, ...shown });
  }
  const { parts, solid, origin } = moduleParts(name as FacadeModule), stack = solid[0]!, cells = halves(stack.r);
  // The skin is as thick as the facade's plainest large part draws its wall.
  const area = (p: Part): number => (p.r[1] - p.r[0]) * (p.r[3] - p.r[2]);
  const plain = parts.filter((p) => p.color === undefined && !p.hull && !p.loose).sort((p, q) => area(q) - area(p))[0] ?? stack;
  const skin: Part = { r: stack.r, w0: plain.w0, w1: plain.w1 };
  // A part in the wall's plane goes with an opened half. A balcony out in front of it stays.
  const inPlane = (p: Part): boolean => p.w1 <= skin.w1 + 0.2;
  const split = [...splitAt(parts.filter(inPlane), cells[0]![1]), ...parts.filter((p) => !inPlane(p))];
  const opened = (form: FormName): Rect[] => cells.filter((_, i) => form === "open" || (form === "breach A") === (i === 0));
  const goes = (p: Part, form: FormName): boolean => inPlane(p) && opened(form).some((cell) => rectMeet(p.r, cell) !== null);
  return plated(name, {
    frame: WALL, parts, cutting: (form) => opened(form).map((cell): Part => ({ ...skin, r: cell })), solid, cells, breach: shellHalf, open: () => cells.map(shellHalf), barsIn: null,
    behind: (form) => [...split.filter((p) => !goes(p, form)), ...opened(form).flatMap((cell) => shellInside(cell, stack.w0, stack.w1))],
    panes: (form) => split.filter((p) => p.glass && goes(p, form)),
  }, { origin, floor: 0, ...shown });
}

/** A partition: plaster on studs. It has no half-way: opened, its studs and plates stand and a body walks between them. */
function partition(name: RuinShape): Component {
  const { bounds, part, origin } = standing(name);
  const [u0, u1, v0, v1] = bounds, bays = Math.round((u1 - u0) / 0.6);
  const studs: Part[] = [
    { r: [u0, u1, v0, v0 + 0.08], w0: -0.05, w1: 0.05, color: TIMBER }, { r: [u0, u1, v1 - 0.08, v1], w0: -0.05, w1: 0.05, color: TIMBER },
    ...Array.from({ length: bays + 1 }, (_, k): Part => { const x = u0 + 0.025 + (k * (u1 - u0 - 0.05)) / bays; return { r: [x - 0.025, x + 0.025, v0 + 0.08, v1 - 0.08], w0: -0.05, w1: 0.05, color: TIMBER }; }),
  ];
  return plated(name, { frame: WALL, parts: [part], solid: [part], cells: [], breach: wallBreach, open: () => cleared(bounds, [[u0, u1, v0 + 0.08, v1]]), barsIn: null, behind: () => studs }, { origin, notes: ["bared to its studs"] });
}

/** A fixture: a cover, a counter, a bed. Opened it is a wreck with a way through its middle. */
function fixture(name: RuinShape): Component {
  const { bounds, part, origin } = standing(name), high = bounds[3] - bounds[2];
  return plated(name, { frame: WALL, parts: [part], solid: [part], cells: [], breach: wallBreach, open: () => wallOpen(bounds, 0.25, high * 0.4, 1.3, Math.max(0.6, high)), barsIn: null }, { origin, notes: ["a wreck"] });
}

const BUILD: { readonly [K in RuinShape]?: () => Component } = {
  floor4: () => slab("floor4"), floor8: () => slab("floor8"), floor16: () => slab("floor16"), zroof8: () => slab("zroof8"), zroof16: () => slab("zroof16"),
  // A balcony's slab hangs from its long edge, at the wall.
  zbalcony: () => slab("zbalcony", "z0"),
  pier4: () => pier("pier4"), pier8: () => pier("pier8"), pier16: () => pier("pier16"),
  beam4: () => beam("beam4", true), beam8: () => beam("beam8", true), beam16: () => beam("beam16", true), zheader: () => beam("zheader", true),
  sill4: () => sill("sill4"), sill8: () => sill("sill8"), fin4: () => fin("fin4"), fin8: () => fin("fin8"), fin16: () => fin("fin16"), trim4: () => beam("trim4", false), trim8: () => beam("trim8", false),
  wall4: () => wall("wall4", false), wall8: () => wall("wall8", false), zlobby: () => bay("zlobby"),
  zpanel8: () => wall("zpanel8", true), zpanel16: () => wall("zpanel16", true), zpaneltop: () => wall("zpaneltop", true),
  zparapet8: () => parapet("zparapet8"), zattic: () => parapet("zattic"), zstepup: () => parapet("zstepup"), zscreen: () => parapet("zscreen"),
  zwin: () => bay("zwin"), zwintop: () => bay("zwintop"), zbalcbare: () => bay("zbalcbare"),
  zstore: () => store("zstore"), zstorecut: () => store("zstorecut"), zstorecutl: () => store("zstorecutl"), zshutter: () => shutter("zshutter"), zgate: () => gate("zgate"), zentry: () => entry("zentry"),
  zcurt: () => curtain("zcurt"), zcurttop: () => curtain("zcurttop"),
  zclad: () => bay("zclad", true), zcladl: () => bay("zcladl", true, true), zcladc: () => bay("zcladc", true), zplant: () => bay("zplant", false, true), zplanttop: () => bay("zplanttop", false, true),
  zbalc: () => balcony("zbalc"), zbalctop: () => balcony("zbalctop"), zbalcrail: () => balcony("zbalcrail"),
  zdeck: () => deck("zdeck"), zdecktop: () => deck("zdecktop"),
  zpitch4: () => pitchedRoof("zpitch4"), zpitch8: () => pitchedRoof("zpitch8"), zpitch16: () => pitchedRoof("zpitch16"),
  zshaft8: () => shell("zshaft8"), zshaft16: () => shell("zshaft16"), zshafttop: () => shell("zshafttop"), zwin4: () => shell("zwin4"), zwin4top: () => shell("zwin4top"),
  zcurt4: () => shell("zcurt4"), zcurt4top: () => shell("zcurt4top"), zclad4: () => shell("zclad4"), zclad4l: () => shell("zclad4l"), zclad4c: () => shell("zclad4c"),
  zclad4top: () => shell("zclad4top"), zbalc4: () => shell("zbalc4"), zbalc4top: () => shell("zbalc4top"),
  zpartition: () => partition("zpartition"), zdoorpost: () => partition("zdoorpost"), zcover: () => fixture("zcover"), zcounter: () => fixture("zcounter"), zbed: () => fixture("zbed"),
};

/** Every breaking shape's component, in the family table's order. */
export const KIT: readonly Kit[] = BREAKING_SHAPES.map((name) => {
  const build = BUILD[name];
  if (!build) throw new Error(`${name} has a family and no forms`);
  return kitted(build());
});

const BY_NAME = new Map(KIT.map((k) => [k.name, k]));
/** A breaking shape's component, or undefined for a shape that does not break. */
export const kitOf = (shape: string): Kit | undefined => BY_NAME.get(shape);
