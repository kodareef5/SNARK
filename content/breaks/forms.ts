// A component's forms: what it is when whole, with one half breached, opened, hung or fallen to a heap.

import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import { bars, cut, partBox, partChunk, solidLess, splitAt, type Chunk, type Frame, type Look, type Part } from "./cut.ts";
import { VARIANTS, type Family, type FormName } from "./families.ts";
import { grid, type Corner, type Pt, type Rect } from "./geometry.ts";
import { Rng } from "../../shared/rng.ts";
import { plan, profilePlan, type Plan } from "./plan.ts";

export { VARIANTS, type FormName } from "./families.ts";

export interface Form {
  readonly name: FormName;
  /** What changed, in a few words, for the sheet. */
  readonly note: string;
  /** What is drawn standing. */
  readonly look: Look;
  /** What is solid. The same for every variant of a form, so the server keeps one table for it. */
  readonly walked: { readonly boxes: readonly ShapeBox[]; readonly hulls: readonly HullDef[] };
  /** What leaves on the way into this form from whole, each a rigid thing. */
  readonly fragments: readonly (readonly Chunk[])[];
  /** Panes that go on the way into this form. */
  readonly panes: readonly ShapeBox[];
  /** Whether it still holds up what rests on it. */
  readonly bears: boolean;
}

/** A shape's forms as a builder writes them, in metres of its own: a wall's from its floor, a module's from its storey's. */
export interface Component {
  /** The kit shape it is the forms of. */
  readonly name: string;
  readonly family: Family;
  /** What it is built of, in words, for the sheet. */
  readonly material: string;
  /** The finish it is drawn in on the sheet: its colour and the colour of faces that look down. */
  readonly finish: readonly [number, number];
  /** The whole piece's solid boxes, by which a bared face is told from skin. */
  readonly skin: readonly ShapeBox[];
  /** Where the whole piece's own origin is in the builder's metres. At their zero unless given. */
  readonly origin?: Corner;
  /** Degrees the sheet's eye is round from the front and up from level. */
  readonly eye?: readonly [number, number];
  /** Which way the sheet draws what leaves apart from what stands, in metres. Out toward the eye unless given. */
  readonly apart?: readonly [number, number, number];
  /** Its forms in one of the four variants. With `standing`, what leaves need not be made: a kind is written from what stands. */
  readonly forms: (variant: number, standing?: boolean) => Form[];
}

/** A component as content holds it: in the whole piece's own frame, on the grid, each form solid alike in every variant. */
export interface Kit extends Component {
  readonly origin: Corner;
  /** Every variant's forms. */
  readonly all: (standing?: boolean) => Form[][];
}

/** A seed for one form of one component in one variant. */
export function seedOf(name: string, form: string, variant: number): number {
  let h = 2166136261 ^ variant;
  for (const ch of name + "/" + form) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A form with `origin` as its zero and every number on the grid, so each engine writes the same content. */
export function placed(f: Form, origin: Corner = [0, 0, 0]): Form {
  const at = (c: readonly [number, number, number]): Corner => [grid(c[0] - origin[0]), grid(c[1] - origin[1]), grid(c[2] - origin[2])];
  const box = (b: ShapeBox): ShapeBox => ({ at: at(b.at), half: [grid(b.half[0]), grid(b.half[1]), grid(b.half[2])], ...(b.color !== undefined ? { color: b.color } : {}) });
  const boxes = (list: readonly ShapeBox[]): ShapeBox[] => list.map(box).filter((b) => b.half.every((h) => h > 0));
  const chunk = (c: Chunk): Chunk => ({ ...c, corners: c.corners.map(at) });
  return {
    ...f, look: { boxes: boxes(f.look.boxes), chunks: f.look.chunks.map(chunk) },
    walked: { boxes: boxes(f.walked.boxes), hulls: f.walked.hulls.map((h): HullDef => ({ corners: h.corners.map(at) })) },
    fragments: f.fragments.map((group) => group.map(chunk)), panes: boxes(f.panes),
  };
}

/**
 * A component in its whole piece's frame. Its origin is put on the grid first, so a form's numbers are moved exactly and
 * what was flat stays flat; the piece then stands within a quarter of a millimetre of where the whole did.
 */
export function kitted(c: Component): Kit {
  const o = c.origin ?? [0, 0, 0], origin: Corner = [grid(o[0]), grid(o[1]), grid(o[2])];
  const all = (standing = false): Form[][] => {
    const first = c.forms(0, standing).map((f) => placed(f, origin));
    return Array.from({ length: VARIANTS }, (_, v) => (v === 0 ? first : c.forms(v, standing).map((f, i) => ({ ...placed(f, origin), walked: first[i]!.walked }))));
  };
  const skin = c.skin.map((b): ShapeBox => ({ ...b, at: [b.at[0] - origin[0], b.at[1] - origin[1], b.at[2] - origin[2]] }));
  return { ...c, origin, skin, all, forms: (variant) => (variant === 0 ? c.forms(0).map((f) => placed(f, origin)) : all()[variant]!) };
}

/** One opening of a piece that is flat in its plane: where it is, what is passable through it. */
export interface Opening {
  readonly window: Rect;
  readonly c: Pt;
  readonly opening: readonly Pt[];
  readonly closed: boolean;
  readonly passable: readonly Rect[];
  readonly rings?: 1 | 2;
  readonly tooth?: number;
  readonly run?: number;
  /** Broken down from the top to a ragged line, in place of out from `c`: what `profilePlan` takes, made from a seed. */
  readonly profile?: (seed: number) => readonly Pt[];
  /** With a profile: about how tall a shard is. */
  readonly piece?: number;
}

export interface Plate {
  readonly name: string;
  readonly frame: Frame;
  /** What is drawn whole, and what a break cuts unless `cutting` says otherwise. */
  readonly parts: readonly Part[];
  /** What a form's break cuts, where that is plainer than the parts: a tall shell's skin stands in for its four storeys of them. */
  readonly cutting?: (form: FormName) => readonly Part[];
  /** What is solid, whole. */
  readonly solid: readonly Part[];
  /** Its halves along its long axis: one for a piece of one cell, none for a piece that only opens. */
  readonly cells: readonly Rect[];
  readonly breach: (cell: Rect) => Opening;
  /** One opening, or one to a half where the halves open apart. */
  readonly open: () => Opening | readonly Opening[];
  /** Where its parts are cut in two so a half breaks alone: at the first half's end unless given, nowhere if null. */
  readonly split?: number | null;
  /** Reinforced concrete bares bent bars at a break: the thickness they lie in, or null. */
  readonly barsIn: readonly [number, number] | null;
  /** False where no bar stands at the foot of an opening, as under a beam there is nothing for one to stand in. */
  readonly barsAtFoot?: false;
  readonly bears: readonly [whole: boolean, breached: boolean, open: boolean];
  /** Parts drawn as they are once a form is made, besides what the cut leaves: a hollow shell's slab edges, a wall's studs. */
  readonly behind?: (form: FormName) => readonly Part[];
  /** Panes that go on the way into a form besides those the cut finds. */
  readonly panes?: (form: FormName) => readonly Part[];
}

const lookOf = (frame: Frame, parts: readonly Part[]): Look => ({ boxes: parts.filter((p) => !p.hull).map((p) => partBox(frame, p)), chunks: parts.filter((p) => p.hull).map((p) => partChunk(frame, p)) });

/** The whole form and the forms an opening makes, of a piece that is flat in its plane. */
export function plateForms(p: Plate, variant: number, standing = false): Form[] {
  const mid = p.split !== undefined ? p.split : p.cells.length > 1 ? p.cells[0]![1] : null;
  const halved = mid === null ? p.parts : splitAt(p.parts, mid);
  const solid = p.solid.map((s) => partBox(p.frame, s));
  const made = (name: FormName, note: string, asked: Opening | readonly Opening[], bears: boolean): Form => {
    const openings: readonly Opening[] = Array.isArray(asked) ? asked : [asked as Opening];
    const plans = openings.map((o, i): Plan => {
      const seed = seedOf(p.name, `${name}/${i}`, variant);
      return o.profile ? profilePlan({ window: o.window, profile: o.profile(seed), seed, ...(o.piece !== undefined ? { piece: o.piece } : {}) }) : plan({ window: o.window, c: o.c, opening: o.opening, closed: o.closed, seed, ...(o.rings ? { rings: o.rings } : {}), ...(o.tooth !== undefined ? { tooth: o.tooth } : {}), ...(o.run !== undefined ? { run: o.run } : {}) });
    });
    // One opening across both halves cuts the parts as they are, so a rail or a band leaves in fewer pieces.
    const c = cut(p.frame, p.cutting ? p.cutting(name) : name === "open" && openings.length === 1 ? p.parts : halved, plans, !standing);
    const extra = p.barsIn ? plans.flatMap((q, i) => bars(p.frame, q, p.barsIn![0], p.barsIn![1], 4, seedOf(p.name, `${name}/bars${i}`, variant), p.barsAtFoot !== false)) : [];
    const behind = lookOf(p.frame, p.behind?.(name) ?? []);
    const panes = standing ? [] : (p.panes?.(name) ?? []).map((pane) => partBox(p.frame, pane));
    return {
      name, note, look: { boxes: [...c.look.boxes, ...extra, ...behind.boxes], chunks: [...c.look.chunks, ...behind.chunks] },
      walked: { boxes: solidLess(p.frame, p.solid, openings.flatMap((o) => o.passable)), hulls: [] }, fragments: c.fragments, panes: [...c.panes, ...panes], bears,
    };
  };
  const forms: Form[] = [{ name: "whole", note: "", look: lookOf(p.frame, p.parts), walked: { boxes: solid, hulls: [] }, fragments: [], panes: [], bears: p.bears[0] }];
  p.cells.forEach((cell, i) => forms.push(made(i === 0 ? "breach A" : "breach B", p.cells.length > 1 ? "one half broken through" : "broken through", p.breach(cell), p.bears[1])));
  forms.push(made("open", "opened", p.open(), p.bears[2]));
  return forms;
}

/** A wall's opening in one cell: a mouth to the floor, 2.4 m wide and 2.2 m high where the cell has room. */
export function wallBreach(cell: Rect): Opening {
  const [u0, u1, v0, v1] = cell;
  const cu = (u0 + u1) / 2, half = Math.min(1.2, (u1 - u0 - 0.9) / 2), top = Math.min(v0 + 2.2, v1 - 0.35);
  const window: Rect = [Math.max(u0 + 0.05, cu - half - 0.42), Math.min(u1 - 0.05, cu + half + 0.42), v0, Math.min(v1 - 0.05, top + 0.42)];
  // Seen from its middle, so its shards go out every way and none is a sliver along the floor.
  return { window, c: [cu, (v0 + top) / 2], closed: true, opening: [[cu + half, v0], [cu + half, top], [cu - half, top], [cu - half, v0]], passable: [[cu - half, cu + half, v0, top]] };
}

/**
 * A wall opened: jambs at its ends and a low ragged wall, a gap to the floor in the middle wide enough to drive through.
 * A piece lower than a wall is ragged in its own measure.
 */
export function wallOpen(bounds: Rect, jamb = 0.45, low = 0.65, step = 1.3, piece = 1.6): Opening {
  const [u0, u1, v0, v1] = bounds;
  const um = (u0 + u1) / 2, gap = Math.max(0.6, Math.min(1.5, (u1 - u0) / 2 - jamb - 0.6)), k = Math.min(1, (v1 - v0) / 2.8);
  // One side's line from its end toward the middle: the jamb's broken head, straight down its inner face to the low wall,
  // along the low wall's ragged top, and down to the floor at the gap.
  const side = (rng: Rng, from: number, to: number): Pt[] => {
    const s = Math.sign(to - from), inner = from + s * (jamb - rng.range(0.02, 0.15)), run = Math.abs(to - inner);
    const out: Pt[] = [[from, v1 - k * rng.range(0, 0.3)], [inner, v1 - k * rng.range(0.3, 0.9)], [inner, v0 + low - k * rng.range(0, 0.2)]];
    const steps = Math.max(1, Math.round(run / step));
    for (let n = 1; n < steps; n++) out.push([inner + s * ((run * (n + rng.range(-0.25, 0.25))) / steps), v0 + low - k * rng.range(0, 0.4)]);
    out.push([to, v0 + low - k * rng.range(0.1, 0.45)], [to, v0]);
    return out;
  };
  const floor = (rng: Rng): Pt[] => { const n = Math.max(1, Math.round((2 * gap) / (step + 0.1))); return Array.from({ length: n - 1 }, (_, i): Pt => [um - gap + (2 * gap * (i + 1 + rng.range(-0.2, 0.2))) / n, v0]); };
  return {
    window: bounds, c: [um, v1], closed: false, opening: [], piece,
    profile: (seed) => { const rng = new Rng(seed); return [...side(rng, u0, um - gap), ...floor(rng), ...side(rng, u1, um + gap).reverse()]; },
    passable: [[u0 + jamb, u1 - jamb, v0 + low, v1], [um - gap, um + gap, v0, v0 + low]],
  };
}

/** A slab's hole in one cell: 2.4 m across, which a body drops through and a car does not. */
export function slabBreach(cell: Rect): Opening {
  const cu = (cell[0] + cell[1]) / 2, cv = (cell[2] + cell[3]) / 2, h = Math.min(1.2, (cell[1] - cell[0]) / 2 - 0.5, (cell[3] - cell[2]) / 2 - 0.5);
  const grow = (lo: number, hi: number, at: number): [number, number] => [Math.max(lo + 0.2, at - h - 0.45), Math.min(hi - 0.2, at + h + 0.45)];
  const [a, b] = grow(cell[0], cell[1], cu), [c, d] = grow(cell[2], cell[3], cv);
  return { window: [a, b, c, d], c: [cu, cv], closed: true, run: 1.7, opening: [[cu + h, cv - h], [cu + h, cv + h], [cu - h, cv + h], [cu - h, cv - h]], passable: [[cu - h, cu + h, cv - h, cv + h]] };
}

/** A slab opened: teeth along its edges and nothing to walk on between them. A larger slab has as many teeth, each longer. */
export function slabOpen(bounds: Rect, collar = 0.45): Opening {
  const [u0, u1, v0, v1] = bounds;
  // Its longest edge gets one point of the mouth between its corners.
  const inner: Rect = [u0 + collar, u1 - collar, v0 + collar, v1 - collar], run = Math.max(inner[1] - inner[0], inner[3] - inner[2]) / 1.95;
  return { window: bounds, c: [(u0 + u1) / 2, (v0 + v1) / 2], closed: true, rings: 2, run, opening: [[inner[1], inner[2]], [inner[1], inner[3]], [inner[0], inner[3]], [inner[0], inner[2]]], passable: [inner] };
}

/** A piece's halves along its first axis, or itself where it is 4 m or less. */
export const halves = (r: Rect): Rect[] => (r[1] - r[0] > 4.01 ? [[r[0], (r[0] + r[1]) / 2, r[2], r[3]], [(r[0] + r[1]) / 2, r[1], r[2], r[3]]] : [r]);

/** Points along a floor between two places, about `step` apart: where a line with nothing left standing is cut into shards. */
export function along(rng: Rng, from: number, to: number, v: number, step = 1.4): Pt[] {
  const n = Math.max(1, Math.round((to - from) / step));
  return Array.from({ length: n - 1 }, (_, k): Pt => [from + ((to - from) * (k + 1 + rng.range(-0.2, 0.2))) / n, v]);
}

/** An opening with nothing left standing in its window: broken down to the floor, its shards the bands above. */
export const cleared = (window: Rect, passable: readonly Rect[] = [window], piece?: number): Opening => ({
  window, c: [(window[0] + window[1]) / 2, window[3]], closed: false, opening: [], passable, ...(piece !== undefined ? { piece } : {}),
  profile: (seed) => [[window[0], window[2]], ...along(new Rng(seed), window[0], window[1], window[2]), [window[1], window[2]]],
});

/** A stretch lost from the top of an upstand in one cell, down to its foot: a parapet's, a garage deck's spandrel's. */
export function upstandBreach(cell: Rect): Opening {
  const [u0, u1, v0, v1] = cell;
  const cu = (u0 + u1) / 2, half = Math.min(1.4, (u1 - u0) / 2 - 0.4), reach = Math.min((u1 - u0) / 2 - 0.02, half + 0.4);
  return { window: [cu - reach, cu + reach, v0, v1], c: [cu, v0], closed: false, opening: [[cu + half, v0], [cu + half, v1], [cu - half, v1], [cu - half, v0]], passable: [[cu - half, cu + half, v0, v1]] };
}

/** An upstand gone to its foot but for a ragged kerb `high` at most. */
export function kerb(bounds: Rect, high = 0.2, step = 1.2): Opening {
  const [u0, u1, v0, v1] = bounds;
  return {
    window: bounds, c: [(u0 + u1) / 2, v1], closed: false, opening: [], passable: [[u0, u1, v0 + high, v1]], piece: 2,
    profile: (seed): Pt[] => { const rng = new Rng(seed); return [[u0, v0 + rng.range(high / 4, high)], ...along(rng, u0, u1, v0, step).map(([u]): Pt => [u, v0 + rng.range(0, high)]), [u1, v0 + rng.range(high / 4, high)]]; },
  };
}

/** A beam gone but for a stub at each end, `stub` long at most, each broken off on a slant. */
export function stubbed(bounds: Rect, stub = 0.6, step = 1.4): Opening {
  const [u0, u1, v0, v1] = bounds;
  return {
    window: bounds, c: [(u0 + u1) / 2, v1], closed: false, opening: [], passable: [[u0 + stub, u1 - stub, v0, v1]], piece: v1 - v0,
    profile: (seed): Pt[] => {
      const rng = new Rng(seed);
      // From an end: its top as far as the break, a point on the break's face, and the break's foot.
      const end = (from: number, s: number): Pt[] => {
        const a = from + s * stub * rng.range(0.35, 0.6), b = a + s * stub * rng.range(0.15, 0.4), m = a + (b - a) * rng.range(0.2, 0.8);
        return [[from, v1], [a, v1], [m, v0 + (v1 - v0) * rng.range(0.35, 0.65)], [b, v0]];
      };
      const left = end(u0, 1), right = end(u1, -1).reverse();
      return [...left, ...along(rng, left[3]![0], right[0]![0], v0, step), ...right];
    },
  };
}

/** An upright bar gone but for a stump `tall` at most, its head ragged. */
export function stump(bounds: Rect, tall: number): Opening {
  const [u0, u1, v0, v1] = bounds;
  return {
    window: bounds, c: [(u0 + u1) / 2, v1], closed: false, opening: [], passable: [[u0, u1, v0 + tall, v1]], piece: (v1 - v0) / 3,
    profile: (seed): Pt[] => { const rng = new Rng(seed); return [[u0, v0 + tall * rng.range(0.55, 1)], [u0 + (u1 - u0) * rng.range(0.3, 0.7), v0 + tall * rng.range(0.45, 1)], [u1, v0 + tall * rng.range(0.55, 1)]]; },
  };
}
