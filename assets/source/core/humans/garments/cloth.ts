// A piece of cloth while it is being made: points of the skin it lies over, cut and split as a mesh is, before it is
// lifted off the skin. Each point keeps the skin point it came from, the skin's normal there and its weights on all
// thirty bones; a point made on an edge takes its share of both ends.

import { HUMAN_BONES } from "../../../../../shared/anim/human.ts";
import type { Skin } from "./skin.ts";

/** The share of an edge within which a split line takes the edge's end instead of cutting the edge. */
const SNAP = 0.2;

export class Cloth {
  /** The skin point under each point, its normal and its weights. */
  p: number[] = [];
  n: number[] = [];
  w: Float32Array[] = [];
  /** Three a triangle, wound as the skin is: counter-clockwise from outside. */
  idx: number[] = [];
  /** Per triangle, the skin zone it lies over. */
  zone: number[] = [];
  /** A shape's own sheet coordinates, two a point, where it lays itself out; then it is never split. */
  uv?: number[];

  static fromSkin(skin: Skin, keep: (zone: number) => boolean): Cloth {
    const c = new Cloth();
    const map = new Int32Array(skin.positions.length / 3).fill(-1);
    for (let t = 0; t < skin.zones.length; t++) {
      if (!keep(skin.zones[t]!)) continue;
      for (let k = 0; k < 3; k++) {
        const v = skin.indices[t * 3 + k]!;
        if (map[v]! < 0) map[v] = c.add([skin.positions[v * 3]!, skin.positions[v * 3 + 1]!, skin.positions[v * 3 + 2]!], [skin.normals[v * 3]!, skin.normals[v * 3 + 1]!, skin.normals[v * 3 + 2]!], skin.weights.slice(v * HUMAN_BONES, v * HUMAN_BONES + HUMAN_BONES));
        c.idx.push(map[v]!);
      }
      c.zone.push(skin.zones[t]!);
    }
    return c;
  }

  get points(): number {
    return this.p.length / 3;
  }
  get triangles(): number {
    return this.idx.length / 3;
  }

  add(p: readonly number[], n: readonly number[], w: Float32Array): number {
    this.p.push(p[0]!, p[1]!, p[2]!);
    this.n.push(n[0]!, n[1]!, n[2]!);
    this.w.push(w);
    return this.p.length / 3 - 1;
  }

  point(v: number): [number, number, number] {
    return [this.p[v * 3]!, this.p[v * 3 + 1]!, this.p[v * 3 + 2]!];
  }

  normal(v: number): [number, number, number] {
    return [this.n[v * 3]!, this.n[v * 3 + 1]!, this.n[v * 3 + 2]!];
  }

  /** A point a share `t` of the way from a to b. */
  between(a: number, b: number, t: number): number {
    const p = [0, 1, 2].map((k) => this.p[a * 3 + k]! * (1 - t) + this.p[b * 3 + k]! * t);
    const n = [0, 1, 2].map((k) => this.n[a * 3 + k]! * (1 - t) + this.n[b * 3 + k]! * t);
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    const w = new Float32Array(HUMAN_BONES);
    for (let k = 0; k < HUMAN_BONES; k++) w[k] = this.w[a]![k]! * (1 - t) + this.w[b]![k]! * t;
    return this.add(p, n.map((x) => x / l), w);
  }

  /**
   * Splits every triangle `only` takes where `g` (a value a point) changes sign, so the line g = 0 runs along edges; the
   * new points are on that line, and `onLine` marks them. Returns g for every point after.
   */
  split(g: (v: number) => number, only: (t: number) => boolean = () => true, onLine?: Set<number>): number[] {
    const value: number[] = [];
    for (let v = 0; v < this.points; v++) value.push(g(v));
    const EPS = 1e-9;
    // A point the line passes within a fifth of an edge of is taken onto it, so no sliver is cut beside it.
    for (let t = 0; t < this.triangles; t++) {
      if (!only(t)) continue;
      for (let k = 0; k < 3; k++) {
        const a = this.idx[t * 3 + k]!, b = this.idx[t * 3 + ((k + 1) % 3)]!;
        if (Math.abs(value[a]!) < EPS || Math.abs(value[b]!) < EPS || Math.sign(value[a]!) === Math.sign(value[b]!)) continue;
        const s = value[a]! / (value[a]! - value[b]!);
        if (s < SNAP) value[a] = 0;
        else if (s > 1 - SNAP) value[b] = 0;
      }
    }
    const made = new Map<string, number>();
    const cross = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = made.get(key);
      if (m === undefined) {
        const t = value[a]! / (value[a]! - value[b]!);
        m = this.between(a, b, t);
        value.push(0);
        onLine?.add(m);
        made.set(key, m);
      }
      return m;
    };
    const idx: number[] = [];
    const zone: number[] = [];
    for (let t = 0; t < this.triangles; t++) {
      const c = [this.idx[t * 3]!, this.idx[t * 3 + 1]!, this.idx[t * 3 + 2]!];
      const s = c.map((v) => (Math.abs(value[v]!) < EPS ? 0 : Math.sign(value[v]!)));
      if (!only(t) || !(s.includes(1) && s.includes(-1))) {
        idx.push(...c);
        zone.push(this.zone[t]!);
        continue;
      }
      // Each side's polygon, then a fan over it.
      for (const side of [1, -1]) {
        const poly: number[] = [];
        for (let k = 0; k < 3; k++) {
          const a = c[k]!, b = c[(k + 1) % 3]!, sa = s[k]!, sb = s[(k + 1) % 3]!;
          if (sa === side || sa === 0) poly.push(a);
          if (sa !== 0 && sb !== 0 && sa !== sb) poly.push(cross(a, b));
        }
        for (let k = 1; k + 1 < poly.length; k++) {
          idx.push(poly[0]!, poly[k]!, poly[k + 1]!);
          zone.push(this.zone[t]!);
        }
      }
    }
    for (const v of made.values()) onLine?.add(v);
    this.idx = idx;
    this.zone = zone;
    return value;
  }

  /** Keeps the triangles `keep` keeps and the points they use. Returns the old index of each kept point. */
  keep(keep: (t: number) => boolean): number[] {
    const map = new Int32Array(this.points).fill(-1);
    const old: number[] = [];
    const out = new Cloth();
    for (let t = 0; t < this.triangles; t++) {
      if (!keep(t)) continue;
      for (let k = 0; k < 3; k++) {
        const v = this.idx[t * 3 + k]!;
        if (map[v]! < 0) {
          map[v] = out.add(this.point(v), [this.n[v * 3]!, this.n[v * 3 + 1]!, this.n[v * 3 + 2]!], this.w[v]!);
          old.push(v);
        }
        out.idx.push(map[v]!);
      }
      out.zone.push(this.zone[t]!);
    }
    if (this.uv) this.uv = old.flatMap((v) => [this.uv![v * 2]!, this.uv![v * 2 + 1]!]);
    Object.assign(this, { p: out.p, n: out.n, w: out.w, idx: out.idx, zone: out.zone });
    return old;
  }

  /** Each triangle's centroid value of a per-point value. */
  centroid(value: readonly number[], t: number): number {
    return (value[this.idx[t * 3]!]! + value[this.idx[t * 3 + 1]!]! + value[this.idx[t * 3 + 2]!]!) / 3;
  }

  /** The triangles reached from those `seed` takes across shared edges. */
  connected(seed: (t: number) => boolean): Uint8Array {
    const edges = new Map<string, number[]>();
    for (let t = 0; t < this.triangles; t++) for (let k = 0; k < 3; k++) {
      const a = this.idx[t * 3 + k]!, b = this.idx[t * 3 + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      (edges.get(key) ?? edges.set(key, []).get(key)!).push(t);
    }
    const reached = new Uint8Array(this.triangles);
    const stack: number[] = [];
    for (let t = 0; t < this.triangles; t++) if (seed(t)) {
      reached[t] = 1;
      stack.push(t);
    }
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const a = this.idx[t * 3 + k]!, b = this.idx[t * 3 + ((k + 1) % 3)]!;
        for (const u of edges.get(a < b ? `${a},${b}` : `${b},${a}`)!) if (!reached[u]) {
          reached[u] = 1;
          stack.push(u);
        }
      }
    }
    return reached;
  }

  /** The edges used by one triangle, each as it runs in that triangle: the cloth lies on its left, seen from outside. */
  borderEdges(): [number, number][] {
    const count = new Map<string, number>();
    for (let t = 0; t < this.triangles; t++) for (let k = 0; k < 3; k++) {
      const a = this.idx[t * 3 + k]!, b = this.idx[t * 3 + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    const out: [number, number][] = [];
    for (let t = 0; t < this.triangles; t++) for (let k = 0; k < 3; k++) {
      const a = this.idx[t * 3 + k]!, b = this.idx[t * 3 + ((k + 1) % 3)]!;
      if (count.get(a < b ? `${a},${b}` : `${b},${a}`) === 1) out.push([a, b]);
    }
    return out;
  }

  /** Each point's neighbours across edges. */
  neighbours(): number[][] {
    const near: Set<number>[] = Array.from({ length: this.points }, () => new Set());
    for (let t = 0; t < this.triangles; t++) for (let k = 0; k < 3; k++) {
      const a = this.idx[t * 3 + k]!, b = this.idx[t * 3 + ((k + 1) % 3)]!;
      near[a]!.add(b);
      near[b]!.add(a);
    }
    return near.map((s) => [...s]);
  }
}
