// A component's forms: what it is when whole, with one half breached, opened, hung or fallen to a heap. Drafts, made by the
// tool and looked at as pictures. None of them is a kind yet.

import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import { bars, cut, partBox, partChunk, solidLess, splitAt, type Chunk, type Frame, type Look, type Part } from "./cut.ts";
import type { Pt, Rect } from "./geometry.ts";
import { Rng } from "../../shared/rng.ts";
import { plan, profilePlan, type Plan } from "./plan.ts";

export type FormName = "whole" | "breach A" | "breach B" | "open" | "hung" | "heap";

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

export interface Component {
  readonly name: string;
  readonly family: string;
  readonly material: string;
  /** The finish it is drawn in on the sheet: its colour and the colour of faces that look down. */
  readonly finish: readonly [number, number];
  /** The whole piece's solid boxes, by which a bared face is told from skin. */
  readonly skin: readonly ShapeBox[];
  /** Degrees the sheet's eye is round from the front and up from level. */
  readonly eye?: readonly [number, number];
  /** Which way the sheet draws what leaves apart from what stands, in metres. Out toward the eye unless given. */
  readonly apart?: readonly [number, number, number];
  /** Its forms in one of the four variants. */
  readonly forms: (variant: number) => Form[];
}

/** Variants of a form a component is cut in. A piece's place in its wall and building picks one. */
export const VARIANTS = 4;

/** A seed for one form of one component in one variant. */
export function seedOf(name: string, form: string, variant: number): number {
  let h = 2166136261 ^ variant;
  for (const ch of name + "/" + form) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
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
  /** What is drawn, whole. */
  readonly parts: readonly Part[];
  /** What is solid, whole. */
  readonly solid: readonly Part[];
  /** Its halves along its long axis: one for a piece of one cell. */
  readonly cells: readonly Rect[];
  readonly breach: (cell: Rect) => Opening;
  /** One opening, or one to a half where the halves open apart. */
  readonly open: () => Opening | readonly Opening[];
  /** Reinforced concrete bares bent bars at a break: the thickness they lie in, or null. */
  readonly barsIn: readonly [number, number] | null;
  readonly bears: { readonly breached: boolean; readonly open: boolean };
  /** Parts drawn behind an opening once it is made, such as a hollow shell's slab edges. */
  readonly behind?: (form: FormName) => readonly Part[];
}

const wholeLook = (frame: Frame, parts: readonly Part[]): Look => ({ boxes: parts.filter((p) => !p.hull).map((p) => partBox(frame, p)), chunks: parts.filter((p) => p.hull).map((p) => partChunk(frame, p)) });

/** The whole form and the forms an opening makes, of a piece that is flat in its plane. */
export function plateForms(p: Plate, variant: number): Form[] {
  const mid = p.cells.length > 1 ? p.cells[0]![1] : null;
  const parts = mid === null ? p.parts : splitAt(p.parts, mid);
  const solid = p.solid.map((s) => partBox(p.frame, s));
  const made = (name: FormName, note: string, asked: Opening | readonly Opening[], bears: boolean): Form => {
    const openings: readonly Opening[] = Array.isArray(asked) ? asked : [asked as Opening];
    const plans = openings.map((o, i): Plan => {
      const seed = seedOf(p.name, `${name}/${i}`, variant);
      return o.profile ? profilePlan({ window: o.window, profile: o.profile(seed), seed, ...(o.piece !== undefined ? { piece: o.piece } : {}) }) : plan({ window: o.window, c: o.c, opening: o.opening, closed: o.closed, seed, ...(o.rings ? { rings: o.rings } : {}), ...(o.tooth !== undefined ? { tooth: o.tooth } : {}), ...(o.run !== undefined ? { run: o.run } : {}) });
    });
    const c = cut(p.frame, parts, plans);
    const extra = p.barsIn ? plans.flatMap((q, i) => bars(p.frame, q, p.barsIn![0], p.barsIn![1], 4, seedOf(p.name, `${name}/bars${i}`, variant))) : [];
    const behind = (p.behind?.(name) ?? []).map((part) => partBox(p.frame, part));
    return { name, note, look: { boxes: [...c.look.boxes, ...extra, ...behind], chunks: c.look.chunks }, walked: { boxes: solidLess(p.frame, p.solid, openings.flatMap((o) => o.passable)), hulls: [] }, fragments: c.fragments, panes: c.panes, bears };
  };
  const forms: Form[] = [{ name: "whole", note: "", look: wholeLook(p.frame, p.parts), walked: { boxes: solid, hulls: [] }, fragments: [], panes: [], bears: true }];
  p.cells.forEach((cell, i) => forms.push(made(i === 0 ? "breach A" : "breach B", p.cells.length > 1 ? "one half broken through" : "broken through", p.breach(cell), p.bears.breached)));
  forms.push(made("open", "opened", p.open(), p.bears.open));
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

/** A wall opened: jambs at its ends and a low ragged wall, a gap to the floor in the middle wide enough to drive through. */
export function wallOpen(bounds: Rect, jamb = 0.45, low = 0.65, step = 1.3, piece = 1.6): Opening {
  const [u0, u1, v0, v1] = bounds;
  const um = (u0 + u1) / 2, gap = Math.max(0.6, Math.min(1.5, (u1 - u0) / 2 - jamb - 0.6));
  // One side's line from its end toward the middle: the jamb's broken head, straight down its inner face to the low wall,
  // along the low wall's ragged top, and down to the floor at the gap.
  const side = (rng: Rng, from: number, to: number): Pt[] => {
    const s = Math.sign(to - from), inner = from + s * (jamb - rng.range(0.02, 0.15)), run = Math.abs(to - inner);
    const out: Pt[] = [[from, v1 - rng.range(0, 0.3)], [inner, v1 - rng.range(0.3, 0.9)], [inner, v0 + low - rng.range(0, 0.2)]];
    const steps = Math.max(1, Math.round(run / step));
    for (let k = 1; k < steps; k++) out.push([inner + s * ((run * (k + rng.range(-0.25, 0.25))) / steps), v0 + low - rng.range(0, 0.4)]);
    out.push([to, v0 + low - rng.range(0.1, 0.45)], [to, v0]);
    return out;
  };
  const floor = (rng: Rng): Pt[] => { const n = Math.max(1, Math.round((2 * gap) / (step + 0.1))); return Array.from({ length: n - 1 }, (_, k): Pt => [um - gap + (2 * gap * (k + 1 + rng.range(-0.2, 0.2))) / n, v0]); };
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

/** A slab opened: teeth along its edges and nothing to walk on between them. */
export function slabOpen(bounds: Rect, collar = 0.45): Opening {
  const [u0, u1, v0, v1] = bounds;
  const inner: Rect = [u0 + collar, u1 - collar, v0 + collar, v1 - collar];
  return { window: bounds, c: [(u0 + u1) / 2, (v0 + v1) / 2], closed: true, rings: 2, run: 3.6, opening: [[inner[1], inner[2]], [inner[1], inner[3]], [inner[0], inner[3]], [inner[0], inner[2]]], passable: [inner] };
}

/** A piece's halves along its first axis, or itself where it is 4 m or less. */
export const halves = (r: Rect): Rect[] => (r[1] - r[0] > 4.01 ? [[r[0], (r[0] + r[1]) / 2, r[2], r[3]], [(r[0] + r[1]) / 2, r[1], r[2], r[3]]] : [r]);

/** Points along a floor between two places, about `step` apart: where a line with nothing left standing is cut into shards. */
export function along(rng: Rng, from: number, to: number, v: number, step = 1.4): Pt[] {
  const n = Math.max(1, Math.round((to - from) / step));
  return Array.from({ length: n - 1 }, (_, k): Pt => [from + ((to - from) * (k + 1 + rng.range(-0.2, 0.2))) / n, v]);
}
