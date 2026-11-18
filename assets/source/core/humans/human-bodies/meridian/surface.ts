// Curved shell sections in native rest space. Angles start at the front of the body;
// each row can change width, sweep and stand-off independently.
import type { SourceLod } from "../../../../../../tools/pack/write.ts";

export type V = [number, number, number];
export type Profile = readonly (readonly [number, number, number, number, number])[];
export type Row = readonly [number, number, number, number?];
export type Form = (height: number, angle: number, offset: number) => V;
export const finish = {
  ceramic: 0,
  seam: 1,
  knit: 2,
  alloy: 3,
  glass: 4,
  lamp: 5,
  brass: 6,
  silver: 7,
  chest: 8,
  limb: 9,
  grille: 10,
  rubber: 11,
  jet: 12,
  shoe: 13,
  sink: 14,
  crown: 15,
} as const;
const palette = [93, 92, 82, 85, 41, 64, 206, 91, 93, 93, 84, 82, 93, 92, 84, 93];
const rad = Math.PI / 180;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v: V): V => {
  const len = Math.hypot(...v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** A vertical contour, or a sleeve along signed X. Each section gives axis, centre pair and two radii. */
export function contour(shape: Profile, arm = 0, power = 1): Form {
  return (h, angle, offset) => {
    let i = 1;
    while (i < shape.length - 1 && h > shape[i]![0]) i++;
    const a = shape[i - 1]!,
      b = shape[i]!,
      t = Math.max(0, Math.min(1, (h - a[0]) / (b[0] - a[0])));
    const s = Math.sin(angle * rad),
      c = Math.cos(angle * rad);
    const xx = mix(a[1], b[1], t) + (mix(a[3], b[3], t) + offset) * Math.sign(s) * Math.abs(s) ** power;
    const zz = mix(a[2], b[2], t) + (mix(a[4], b[4], t) + offset) * Math.sign(c) * Math.abs(c) ** power;
    return arm ? [arm * h, xx, zz] : [xx, h, zz];
  };
}

export class Surface {
  private p: number[] = [];
  private n: number[] = [];
  private uv: number[] = [];
  private c: number[] = [];
  private b: number[] = [];
  private ix: number[] = [];
  private slots: number[] = [];
  readonly level: number;
  /**
   * The liner's vertices by what each holds, so that two corners alike are one. The liner itself stays whole: taking
   * away what the plates hide was tried and measured (2026-11-18). With rays cast outward it took what shows from
   * below and through the helmet's seams; drawn from 200 directions with only a bone's own plates to hide its liner,
   * which is what stays true in every pose, 326 triangles of 4,375 are never seen, all in the helmet.
   */
  private readonly linerVertices = new Map<string, number>();
  constructor(level: number) {
    this.level = level;
  }
  private vertex(point: V, normal: V, u: number, v: number, tile: number, bone: number): number {
    const i = this.b.length,
      pad = 0.035;
    this.p.push(...point);
    this.n.push(...normal);
    this.b.push(bone);
    this.c.push(palette[tile]!);
    this.uv.push(((tile % 4) + pad + u * (1 - 2 * pad)) / 4, (Math.floor(tile / 4) + pad + v * (1 - 2 * pad)) / 4);
    return i;
  }
  /** Dark textile follows the source mesh exactly, including distal fingertip weights and body-slider seams. */
  liner(lod: SourceLod) {
    const p = lod.positions,
      ix = lod.indices,
      normals = new Map<string, V>();
    const pos = (v: number): V => [p[3 * v]!, p[3 * v + 1]!, p[3 * v + 2]!];
    const key = (v: number) =>
      pos(v)
        .map((n) => Math.round(n * 1e5))
        .join("/");
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i]!,
        b = ix[i + 1]!,
        c = ix[i + 2]!,
        normal = cross(sub(pos(b), pos(a)), sub(pos(c), pos(a)));
      for (const v of [a, b, c]) {
        const id = key(v),
          n = normals.get(id) ?? [0, 0, 0];
        for (let k = 0; k < 3; k++) n[k]! += normal[k]!;
        normals.set(id, n);
      }
    }
    const start = this.ix.length;
    for (let i = 0; i < ix.length; i += 3) {
      const tri = [ix[i]!, ix[i + 1]!, ix[i + 2]!],
        normal = unit(cross(sub(pos(tri[1]!), pos(tri[0]!)), sub(pos(tri[2]!), pos(tri[0]!))));
      const side = Math.abs(normal[0]) > Math.abs(normal[2]),
        top = Math.abs(normal[1]) > 0.78;
      for (const v of tri) {
        const pt = pos(v),
          u = (side ? pt[2] : pt[0]) + 1,
          w = (top ? pt[2] : pt[1]) + 0.3;
        const tu = Math.abs(((u * 3) % 2) - 1),
          tv = Math.abs(((w * 3) % 2) - 1),
          bone = lod.bones![v]!;
        // A corner is the body's vertex with the knit's coordinate there: where two triangles agree on both it is one
        // vertex, where each corner of each triangle was its own.
        const id = `${key(v)}|${bone}|${Math.round(tu * 1e5)}|${Math.round(tv * 1e5)}`;
        let at = this.linerVertices.get(id);
        if (at === undefined) this.linerVertices.set(id, (at = this.vertex(pt, unit(normals.get(key(v))!), tu, tv, finish.knit, bone)));
        this.ix.push(at);
      }
    }
    this.mark(start, finish.knit);
  }
  /**
   * Where a panel's columns stand across it, 0 to 1. A lipped panel keeps its lip one of its `n` segments wide at each
   * side, as it was drawn, and between the lips, as on a panel with none, as few columns as hold its surface within a
   * millimetre of the form at the finest level and 3 mm at the next. Every panel was cut in
   * `n` whatever its curve: a shin plate as finely as a pauldron, and each column a wall segment at both ends as well.
   */
  private columns(n: number, lipped: boolean, across: (u: number) => V[]): number[] {
    // The last level is drawn as it was: it is a few hundred triangles, and its plates are already as few as stand.
    if (this.level === 2) return Array.from({ length: n + 1 }, (_, j) => j / n);
    const tolerance = [0.001, 0.003][this.level]!;
    const lip = lipped && n >= 4 ? 1 / n : 0;
    const most = lip > 0 ? n - 2 : n;
    const fits = (k: number): boolean => {
      for (let i = 0; i < k; i++) {
        const a = lip + ((1 - 2 * lip) * i) / k, z = lip + ((1 - 2 * lip) * (i + 1)) / k;
        const pa = across(a), pz = across(z);
        for (const t of [0.25, 0.5, 0.75]) {
          const pm = across(a + (z - a) * t);
          for (let r = 0; r < pm.length; r++) {
            if (Math.hypot(pm[r]![0] - (pa[r]![0] + (pz[r]![0] - pa[r]![0]) * t), pm[r]![1] - (pa[r]![1] + (pz[r]![1] - pa[r]![1]) * t), pm[r]![2] - (pa[r]![2] + (pz[r]![2] - pa[r]![2]) * t)) > tolerance) return false;
          }
        }
      }
      return true;
    };
    let k = 1;
    while (k < most && !fits(k)) k++;
    const us: number[] = lip > 0 ? [0] : [];
    for (let i = 0; i <= k; i++) us.push(lip + ((1 - 2 * lip) * i) / k);
    if (lip > 0) us.push(1);
    return us;
  }
  private mark(start: number, tile: number) {
    for (let i = start; i < this.ix.length; i += 3) this.slots.push(tile === finish.lamp ? 1 : 0);
  }
  /** A gridded panel with a rolled lip across its angular sides. Rows are ordered bottom to top. */
  panel(form: Form, rows: readonly Row[], tile: number, bone: number, segments = 12, bevel = 0.003) {
    const extent = rows.at(-1)![0] - rows[0]![0];
    if (this.level === 2) {
      if (extent < 0.013 && tile !== finish.glass) return;
      if (rows.length > 4) rows = rows.filter((_, i) => i === 0 || i === rows.length - 1 || i % 2 === 1);
    }
    const firstIndex = this.ix.length;
    const n = Math.max(2, Math.round(segments * [1, 0.5, 0.16][this.level]!)),
      start = this.b.length;
    const point = (r: number, u: number, delta = 0): V => {
      const row = rows[r]!,
        edge = Math.min(1, Math.min(u, 1 - u) * n);
      const lip = bevel * (1 - Math.cos(edge * Math.PI)) * 0.5;
      return form(row[0], mix(row[1], row[2], u), (row[3] ?? 0) + lip + delta);
    };
    const us = this.columns(n, bevel > 0, (u) => rows.map((_, r) => point(r, u)));
    const m = us.length - 1;
    for (let r = 0; r < rows.length; r++)
      for (let j = 0; j <= m; j++) {
        const u = us[j]!,
          p = point(r, u);
        const du = sub(point(r, u + 0.0005), point(r, u - 0.0005)),
          dv = sub(point(Math.min(rows.length - 1, r + 1), u), point(Math.max(0, r - 1), u));
        let normal = unit(cross(du, dv));
        const outside = sub(point(r, u, 0.001), p);
        if (normal[0] * outside[0] + normal[1] * outside[1] + normal[2] * outside[2] < 0) normal = normal.map((x) => -x) as V;
        this.vertex(p, normal, u, 1 - (rows[r]![0] - rows[0]![0]) / (rows.at(-1)![0] - rows[0]![0]), tile, bone);
        if (j && r) {
          const d = start + r * (m + 1) + j,
            c = d - 1,
            b = d - (m + 1),
            a = b - 1;
          const face = cross(sub(point(r - 1, u), point(r - 1, us[j - 1]!)), sub(p, point(r - 1, us[j - 1]!)));
          if (face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2] >= 0) this.ix.push(a, b, d, a, d, c);
          else this.ix.push(a, d, b, a, c, d);
        }
      }
    this.mark(firstIndex, tile);
    if (bevel <= 0 || this.level > 0) return;
    // Return each free edge to the liner. A narrow metallic bevel catches light seen almost edge-on.
    const wall = (r: number, u: number, k: number, w: number) => {
      const a = point(r, u),
        b = point(k, w),
        c = point(k, w, -0.01),
        d = point(r, u, -0.01);
      const normal = unit(cross(sub(b, a), sub(d, a))),
        start = this.b.length;
      this.vertex(a, normal, u, 0.06, finish.alloy, bone);
      this.vertex(b, normal, w, 0.06, finish.alloy, bone);
      this.vertex(c, normal, w, 0.91, finish.alloy, bone);
      this.vertex(d, normal, u, 0.91, finish.alloy, bone);
      this.ix.push(start, start + 1, start + 2, start, start + 2, start + 3);
      this.slots.push(0, 0);
    };
    const last = rows.length - 1;
    for (let j = 0; j < m; j++) {
      wall(0, us[j + 1]!, 0, us[j]!);
      wall(last, us[j]!, last, us[j + 1]!);
    }
    for (let r = 0; r < last; r++) {
      wall(r, 0, r + 1, 0);
      wall(r + 1, 1, r, 1);
    }
  }
  /** Machined concentric ring, oriented by its outward normal. A minute centre radius closes a lens. */
  dial(center: V, axis: V, rings: readonly (readonly [number, number, number])[], bone: number, segments = 28) {
    if (this.level === 2) {
      if (rings[0]![0] < 0.03) return;
      rings = [rings[0]!, rings[2]!, rings.at(-1)!];
    }
    const n = unit(axis),
      u = unit(cross(Math.abs(n[1]) > 0.8 ? [0, 0, 1] : [0, 1, 0], n)),
      v = cross(n, u);
    // As many sides as keep its rim within 0.4 mm of round at the finest level and 1.2 mm at the next, never more than
    // it had, and at the last level what it had: a 2 cm lens was cut in 28 as a 10 cm one was.
    const most = Math.max(8, Math.round(segments * [1, 0.65, 0.39][this.level]!));
    const rim = Math.max(...rings.map((r) => r[0]));
    const sag = [0.0004, 0.0012, 0][this.level]!;
    const seg = sag === 0 ? most : Math.min(most, Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - sag / Math.max(rim, sag)))))));
    for (let k = 1; k < rings.length; k++) {
      const prev = rings[k - 1]!,
        next = rings[k]!,
        start = this.b.length,
        first = this.ix.length;
      for (const [radius, z] of [prev, next])
        for (let j = 0; j <= seg; j++) {
          const a = (j * Math.PI * 2) / seg,
            c = Math.cos(a),
            s = Math.sin(a),
            p = center.map((val, i) => val + radius * (u[i]! * c + v[i]! * s) + z * n[i]!) as V;
          this.vertex(p, n, 0.5 + (0.48 * c * radius) / rings[0]![0], 0.5 - (0.48 * s * radius) / rings[0]![0], next[2], bone);
        }
      for (let j = 0; j < seg; j++) {
        const a = start + j,
          b = a + seg + 1;
        this.ix.push(a, a + 1, b + 1, a, b + 1, b);
      }
      this.mark(first, next[2]);
    }
  }
  done(): SourceLod {
    return {
      positions: Float32Array.from(this.p),
      colors: Uint8Array.from(this.c),
      indices: Uint32Array.from(this.ix),
      bones: Uint8Array.from(this.b),
      ...(this.level < 2
        ? { sections: Uint8Array.from(this.slots), uvs: Float32Array.from(this.uv), normals: Float32Array.from(this.n) }
        : {}),
    };
  }
}
