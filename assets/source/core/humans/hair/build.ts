// Turns a hair form into a mesh's levels. A form is patches, each a surface over (u, v) with u across and v along the
// hair's fall, and layers of cards laid over them. The finest level is the patches' solid core and the cards; the next
// the core alone, coarser; the last two flat. A coarse level's points are lifted by what its chords cut across the
// curve, so it stays outside the skin between them.

import { B_HEAD } from "../../../../../shared/anim/human.ts";
import { REGION_HAIR } from "../../../../../shared/anim/look.ts";
import type { SourceLod } from "../../../../../tools/pack/write.ts";
import type { Vec } from "./head.ts";
import { CORE_U, cardCell, type CardKind } from "./sheet.ts";

/** A level's material sections: the solid core, and the cut-out cards. */
export const SECTION_CORE = 0;
export const SECTION_CARDS = 1;

export interface Patch {
  name: string;
  /** Sets `out` to the point at (u, v), `lift` metres out from the hair's surface. v past 1 goes on past its end. */
  at(u: number, v: number, lift: number, out: Vec): void;
  /** Whether u closes on itself. */
  wrap: boolean;
  /** Whether all of v = 0, or of v = 1, is one point. */
  poles: readonly [boolean, boolean];
  /** About how many metres it is across and along. */
  size: readonly [number, number];
  /** The radius it curves round across, for how far a coarse level is lifted; 0 where it is flat. */
  bend: number;
  /** Drawn solid, or as cut-out cards of a kind all through (stubble). */
  drawn: "core" | CardKind;
  /** The bones a point follows and their weights, heaviest first. */
  bones(p: Vec): readonly (readonly [bone: number, weight: number])[];
}

export interface CardLayer {
  /** The patch's name the cards lie on. */
  on: string;
  kind: CardKind;
  /** Metres off the hair's surface. */
  lift: number;
  /** Where along the patch the cards root and end: past 1, their tips hang past it. */
  from: number;
  to: number;
  /** About how wide a card is, metres. */
  width: number;
  /** Staggered half a card from the layer under it. */
  stagger: boolean;
  /** For an under-hat form: where along the patch a card at `u` may root at the earliest. */
  start?: (u: number) => number;
}

export interface Form {
  patches: Patch[];
  cards: CardLayer[];
  /** Fewer triangles a level than the budgets give, for a form that needs fewer (stubble). */
  most?: readonly number[];
}

/** A grid's columns and rows of quads. */
type Grid = readonly [across: number, along: number];

/** A level as it is made: what each vertex follows, and per triangle its section. */
class Lod {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly joints: number[] = [];
  readonly weights: number[] = [];
  readonly bones: number[] = [];
  readonly indices: number[] = [];
  readonly sections: number[] = [];

  vertex(p: Vec, n: Vec, s: number, t: number, follows: readonly (readonly [number, number])[]): number {
    this.positions.push(...p);
    this.normals.push(...n);
    this.uvs.push(s, t);
    const total = follows.reduce((sum, [, w]) => sum + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.joints.push(follows[k]?.[0] ?? follows[0]![0]);
      this.weights.push((follows[k]?.[1] ?? 0) / total);
    }
    this.bones.push(follows[0]![0]);
    return this.bones.length - 1;
  }

  /** A triangle facing the way its corners' normals do; none where it has no area. */
  triangle(a: number, b: number, c: number, section: number): void {
    const p = this.positions, n = this.normals;
    const e1 = [0, 1, 2].map((k) => p[b * 3 + k]! - p[a * 3 + k]!), e2 = [0, 1, 2].map((k) => p[c * 3 + k]! - p[a * 3 + k]!);
    const f = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    if (Math.hypot(f[0]!, f[1]!, f[2]!) < 1e-10) return;
    const facing = [0, 1, 2].reduce((t, k) => t + f[k]! * (n[a * 3 + k]! + n[b * 3 + k]! + n[c * 3 + k]!), 0);
    if (facing >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
    this.sections.push(section);
  }

  get triangles(): number {
    return this.indices.length / 3;
  }

  /** As the pack writer takes it: with its surface, or flat. */
  source(surface: boolean): SourceLod {
    const vertices = this.bones.length;
    const lod: SourceLod = {
      positions: Float32Array.from(this.positions), colors: new Uint8Array(vertices).fill(REGION_HAIR), indices: Uint32Array.from(this.indices), bones: Uint8Array.from(this.bones),
    };
    if (surface) {
      lod.normals = Float32Array.from(this.normals);
      lod.uvs = Float32Array.from(this.uvs);
      lod.joints = Uint8Array.from(this.joints);
      lod.weights = Float32Array.from(this.weights);
      lod.sections = Uint8Array.from(this.sections);
    }
    return lod;
  }
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The surface's normal at (u, v): across its grid where that has area, else the way it lifts; always the way it lifts. */
function normalAt(patch: Patch, u: number, v: number, lift: number): Vec {
  const e = 2e-3;
  const at = (uu: number, vv: number, l: number): Vec => {
    const out: Vec = [0, 0, 0];
    patch.at(uu, vv, l, out);
    return out;
  };
  const here = at(u, v, lift);
  const out = unit(sub(at(u, v, lift + 1e-3), here));
  const du = sub(at(u + e, v, lift), at(u - e, v, lift));
  const dv = sub(at(u, Math.min(v + e, 1.3), lift), at(u, Math.max(v - e, 0), lift));
  const n = cross(du, dv);
  if (Math.hypot(n[0], n[1], n[2]) < 1e-9) return out;
  const g = unit(n);
  return dot(g, out) >= 0 ? g : [-g[0], -g[1], -g[2]];
}

/** How far a grid's chords cut inside a curve of `bend` radius, at `columns` round it and `rows` along `along` metres. */
function sag(patch: Patch, grid: Grid): number {
  const across = patch.bend > 0 ? patch.bend * (1 - Math.cos(Math.PI / Math.max(3, patch.wrap ? grid[0] : grid[0] * 2))) : 0;
  const curve = Math.max(patch.bend, 0.1);
  const step = patch.size[1] / Math.max(1, grid[1]);
  const along = curve * (1 - Math.cos(Math.min(Math.PI / 2, step / curve / 2)));
  return Math.max(across, along);
}

/** How much of its chords' sag a coarse level is lifted by. */
const SAG_SHARE = 0.15;

/** The core's u and v on the sheet: its streaks run along v. */
const coreUv = (u: number, v: number): [number, number] => [0.002 + Math.min(1, Math.max(0, u)) * (CORE_U - 0.004), 0.002 + Math.min(1, Math.max(0, v)) * 0.996];

/** Lays `patch` into `lod` as a grid, drawn with its own section. */
function lay(lod: Lod, patch: Patch, grid: Grid, inflate: boolean): void {
  const [nu, nv] = grid;
  // A part of the sag: the head's own coarse levels sag inside it too, and the hair is held to the hit head.
  const lift = inflate ? SAG_SHARE * sag(patch, grid) : 0;
  const p: Vec = [0, 0, 0];
  if (patch.drawn !== "core") {
    // Drawn as cards all through: each column is a card of its own, its cell's width across, so a bristle keeps its shape.
    const cell = cardCell(patch.drawn);
    for (let i = 0; i < nu; i++) {
      const pairs = Array.from({ length: nv + 1 }, (_, j) => [i, i + 1].map((c, k) => {
        patch.at(c / nu, j / nv, lift, p);
        return lod.vertex([...p], normalAt(patch, c / nu, j / nv, lift), cell[k]!, 0.002 + (j / nv) * 0.996, patch.bones(p));
      }));
      for (let j = 0; j < nv; j++) {
        lod.triangle(pairs[j]![0]!, pairs[j + 1]![0]!, pairs[j + 1]![1]!, SECTION_CARDS);
        lod.triangle(pairs[j]![0]!, pairs[j + 1]![1]!, pairs[j]![1]!, SECTION_CARDS);
      }
    }
    return;
  }
  const row: number[][] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const pole = (j === 0 && patch.poles[0]) || (j === nv && patch.poles[1]);
    const line: number[] = [];
    // A pole has a vertex a column, in its middle, so each fan triangle keeps its own texture coordinates.
    for (let i = 0; i <= (pole ? nu - 1 : nu); i++) {
      const u = pole ? (i + 0.5) / nu : i / nu;
      patch.at(u, v, lift, p);
      const [s, t] = coreUv(u, v);
      line.push(lod.vertex([...p], normalAt(patch, u, v, lift), s, t, patch.bones(p)));
    }
    row.push(line);
  }
  for (let j = 0; j < nv; j++) {
    const a = row[j]!, b = row[j + 1]!;
    const top = j === 0 && patch.poles[0], bottom = j + 1 === nv && patch.poles[1];
    for (let i = 0; i < nu; i++) {
      if (top) lod.triangle(a[i]!, b[i]!, b[i + 1]!, SECTION_CORE);
      else if (bottom) lod.triangle(a[i]!, b[i]!, a[i + 1]!, SECTION_CORE);
      else {
        lod.triangle(a[i]!, b[i]!, b[i + 1]!, SECTION_CORE);
        lod.triangle(a[i]!, b[i + 1]!, a[i + 1]!, SECTION_CORE);
      }
    }
  }
}

/** Triangles a grid makes. */
const trianglesOf = (patch: Patch, [nu, nv]: Grid): number => 2 * nu * nv - nu * ((patch.poles[0] ? 1 : 0) + (patch.poles[1] ? 1 : 0));

/** Grids for the patches that come to at most `budget` triangles, shared by area, quads about square. */
export function grids(patches: readonly Patch[], budget: number): Grid[] {
  const area = patches.reduce((t, p) => t + p.size[0] * p.size[1], 0);
  const out = patches.map((p): [number, number] => {
    const share = (budget * p.size[0] * p.size[1]) / area / 2;
    const nv = Math.max(1, Math.round(Math.sqrt((share * p.size[1]) / p.size[0])));
    return [Math.max(p.wrap ? 3 : 1, Math.round(share / nv)), nv];
  });
  const total = (): number => out.reduce((t, g, k) => t + trianglesOf(patches[k]!, g), 0);
  // Over the budget, the grid with the most triangles gives up a row, or a column where it has more rows than columns.
  while (total() > budget) {
    const k = out.reduce((best, g, i) => (trianglesOf(patches[i]!, g) > trianglesOf(patches[best]!, out[best]!) ? i : best), 0);
    const g = out[k]!, least = patches[k]!.wrap ? 3 : 1;
    if (g[1] > 1 && (g[1] >= g[0] || g[0] <= least)) g[1]--;
    else if (g[0] > least) g[0]--;
    else break;
  }
  return out;
}

/** Each card layer's cards across and segments along, so all of them come to at most `budget` triangles. */
function cardGrids(form: Form, budget: number): Grid[] {
  const out = form.cards.map((layer): [number, number] => {
    const patch = form.patches.find((p) => p.name === layer.on)!;
    const across = Math.max(patch.wrap ? 3 : 1, Math.round(patch.size[0] / layer.width));
    return [across, Math.max(2, Math.round((patch.size[1] * (layer.to - layer.from)) / 0.025))];
  });
  const total = (): number => out.reduce((t, [m, s]) => t + 2 * m * s, 0);
  while (total() > budget) {
    const k = out.reduce((best, g, i) => (g[0] * g[1] > out[best]![0] * out[best]![1] ? i : best), 0);
    const g = out[k]!;
    if (g[1] > 2) g[1]--;
    else if (g[0] > 3) g[0]--;
    else break;
  }
  return out;
}

/** Lays a layer of cards: strips across the patch, each a card's width, rooted at `from` and ending at `to`. */
function layCards(lod: Lod, patch: Patch, layer: CardLayer, [m, segments]: Grid): void {
  const cell = cardCell(layer.kind);
  const p: Vec = [0, 0, 0];
  const shift = layer.stagger ? 0.5 / m : 0;
  for (let k = 0; k < m; k++) {
    let u0 = k / m + shift, u1 = (k + 1) / m + shift;
    if (!patch.wrap) [u0, u1] = [Math.min(1, u0), Math.min(1, u1)];
    if (u1 - u0 < 0.25 / m) continue;
    const from = Math.max(layer.from, layer.start ? Math.max(layer.start(u0), layer.start((u0 + u1) / 2), layer.start(u1)) : 0);
    if (!(from < layer.to - 0.05)) continue;
    const rows: [number, number][] = [];
    for (let j = 0; j <= segments; j++) {
      const v = from + ((layer.to - from) * j) / segments;
      const t = 0.002 + (j / segments) * 0.996;
      const pair = [u0, u1].map((u, side) => {
        const uu = patch.wrap ? ((u % 1) + 1) % 1 : u;
        patch.at(uu, v, layer.lift, p);
        // A card is lit as the surface under it is.
        const n = normalAt(patch, uu, Math.min(v, 1.2), 0);
        return lod.vertex([...p], n, cell[side]!, t, patch.bones(p));
      });
      rows.push(pair as [number, number]);
    }
    for (let j = 0; j < segments; j++) {
      const [a, b] = rows[j]!, [c, d] = rows[j + 1]!;
      lod.triangle(a, c, d, SECTION_CARDS);
      lod.triangle(a, d, b, SECTION_CARDS);
    }
  }
}

/** One hidden triangle inside the skull: a level for a form too fine to draw that far (stubble). */
function hidden(lod: Lod, centre: Vec): void {
  const n: Vec = [0, 1, 0];
  const a = lod.vertex([centre[0], centre[1], centre[2]], n, 0.5, 0.5, [[B_HEAD, 1]]);
  const b = lod.vertex([centre[0] + 0.002, centre[1], centre[2]], n, 0.5, 0.5, [[B_HEAD, 1]]);
  const c = lod.vertex([centre[0], centre[1], centre[2] + 0.002], n, 0.5, 0.5, [[B_HEAD, 1]]);
  lod.triangle(a, b, c, SECTION_CORE);
}

export interface Budgets {
  /** Most triangles at each level, the finest first: the finest holds the core and the cards. */
  levels: readonly number[];
  /** The share of the finest level the core takes where the form has cards. */
  core: number;
  /** The first flat level. */
  flat: number;
}

/**
 * A form's levels: the core and cards, then the core alone, then flat. A form drawn only as cards (stubble) keeps them
 * on its textured levels and is one hidden triangle from its first flat level on.
 */
export function formLevels(form: Form, budgets: Budgets, centre: Vec): SourceLod[] {
  const out: SourceLod[] = [];
  const solid = form.patches.filter((p) => p.drawn === "core");
  budgets.levels.forEach((given, level) => {
    const budget = Math.min(given, form.most?.[level] ?? given);
    const lod = new Lod();
    const surface = level < budgets.flat;
    if (solid.length === 0 && !surface) hidden(lod, centre);
    else {
      const drawn = surface ? form.patches : solid;
      const cards = level === 0 && form.cards.length > 0;
      const core = cards ? Math.round(budget * budgets.core) : budget;
      const g = grids(drawn, core);
      drawn.forEach((p, k) => lay(lod, p, g[k]!, level > 0));
      if (cards) {
        const c = cardGrids(form, budget - lod.triangles);
        form.cards.forEach((layer, k) => layCards(lod, form.patches.find((p) => p.name === layer.on)!, layer, c[k]!));
      }
    }
    if (lod.triangles > budget) throw new Error(`a hair level has ${lod.triangles} triangles for a budget of ${budget}`);
    out.push(lod.source(surface));
  });
  return out;
}

/** Weights that hand a point from the head to `lower` as it falls from `top` to `bottom` metres high. */
export function fallingFrom(lower: number, top: number, bottom: number): (p: Vec) => readonly (readonly [number, number])[] {
  return (p) => {
    const t = Math.min(1, Math.max(0, (top - p[1]) / (top - bottom)));
    const w = t * t * (3 - 2 * t);
    if (w <= 0.001) return [[B_HEAD, 1]];
    if (w >= 0.999) return [[lower, 1]];
    return w > 0.5 ? [[lower, w], [B_HEAD, 1 - w]] : [[B_HEAD, 1 - w], [lower, w]];
  };
}

/** A point that follows the head alone. */
export const onHeadBone = (): readonly (readonly [number, number])[] => [[B_HEAD, 1]];

