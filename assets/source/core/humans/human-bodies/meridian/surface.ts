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
  visor: 16, // Same cobalt atlas island as the inlays, drawn as a transmitting lens.
  sprayLeft: 19, sprayRight: 20,
  plume: 18, // Procedural exhaust uses local coordinates from nozzle to tip.
  palm: 17, // Shares the brass island with hardware, with its own padded UV bounds.
} as const;
// Keep the broad ivory plates and slate joins distinct in the palette-only distance mesh.
const palette = [10, 85, 82, 86, 41, 64, 206, 91, 10, 93, 83, 82, 93, 87, 83, 10];
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
  /** Four bones and four weights a vertex: a plate's own bone alone, the liner's as the skin it copies. */
  private j: number[] = [];
  private w: number[] = [];
  private blended = false;
  private lining = false;
  private ix: number[] = [];
  private slots: number[] = [];
  readonly level: number;
  /** How far a point drawn on the body the plates were made on moves to sit as it did on the body worn. */
  private shift: ((p: V) => V) | null;
  /**
   * The liner's vertices by what each holds, so that two corners alike are one. The liner itself stays whole: taking
   * away what the plates hide was tried and measured (2026-11-18). With rays cast outward it took what shows from
   * below and through the helmet's seams; drawn from 200 directions with only a bone's own plates to hide its liner,
   * which is what stays true in every pose, 326 triangles of 4,375 are never seen, all in the helmet.
   */
  private readonly linerVertices = new Map<string, number>();
  constructor(level: number, shift: ((p: V) => V) | null = null) {
    this.level = level;
    this.shift = shift;
  }
  /** Moves what is drawn from here on by `shift` in place of the one it was made with. */
  moveBy(shift: ((p: V) => V) | null) {
    this.shift = shift;
  }
  private vertex(point: V, normal: V, u: number, v: number, tile: number, bone: number, joints: readonly number[] = [bone, bone, bone, bone], weights: readonly number[] = [1, 0, 0, 0]): number {
    const i = this.b.length,
      pad = 0.035;
    if (this.shift && !this.lining) {
      const d = this.shift(point);
      point = [point[0] + d[0], point[1] + d[1], point[2] + d[2]];
    }
    this.p.push(...point);
    this.n.push(...normal);
    this.b.push(bone);
    this.j.push(...joints);
    this.w.push(...weights);
    if (tile >= finish.plume) {
      this.c.push(v < 0.28 ? 13 : v < 0.7 ? 64 : 41);
      this.uv.push(u + (tile-finish.plume)*2, v);
      return i;
    }
    const color = tile === finish.palm ? finish.rubber : tile === finish.visor ? finish.glass : tile;
    this.c.push(palette[color]!);
    if (tile === finish.visor) tile = finish.glass;
    if (tile === finish.brass) u = 0.84 + 0.16*u;
    if (tile === finish.palm) {
      tile = finish.brass;
      u *= 0.76;
    }
    this.uv.push(((tile % 4) + pad + u * (1 - 2 * pad)) / 4, (Math.floor(tile / 4) + pad + v * (1 - 2 * pad)) / 4);
    return i;
  }
  /** Dark textile follows the source mesh exactly, with its bones and weights, including distal fingertip weights and body-slider seams. */
  liner(lod: SourceLod, hand: boolean) {
    const tile = hand ? finish.palm : finish.knit, scale = hand ? 8 : 3;
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
          u = (side && !top ? pt[2] : pt[0]) + 1,
          w = (top ? pt[2] : pt[1]) + 0.3;
        const tu = Math.abs(((u * scale) % 2) - 1),
          tv = Math.abs(((w * scale) % 2) - 1),
          bone = lod.bones![v]!;
        const joints = lod.joints && lod.weights ? [...lod.joints.subarray(v * 4, v * 4 + 4)] : undefined,
          weights = joints ? [...lod.weights!.subarray(v * 4, v * 4 + 4)] : undefined;
        // A corner is the body's vertex with the knit's coordinate there: where two triangles agree on both it is one
        // vertex, where each corner of each triangle was its own.
        const id = `${key(v)}|${bone}|${joints ?? ""}|${weights ?? ""}|${Math.round(tu * 1e5)}|${Math.round(tv * 1e5)}`;
        let at = this.linerVertices.get(id);
        if (at === undefined) {
          this.lining = true;
          this.linerVertices.set(id, (at = this.vertex(pt, unit(normals.get(key(v))!), tu, tv, tile, bone, joints, weights)));
          this.lining = false;
          if (joints && weights!.some((x, k) => x > 0 && joints[k] !== bone)) this.blended = true;
        }
        this.ix.push(at);
      }
    }
    this.mark(start, tile);
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
    for (let i = start; i < this.ix.length; i += 3) this.slots.push(tile === finish.lamp ? 1 : tile === finish.visor ? 2 : tile >= finish.plume ? 3 : 0);
  }
  /** A gridded panel with a rolled lip across its angular sides. Rows are ordered bottom to top. */
  panel(form: Form, rows: readonly Row[], tile: number, bone: number, segments = 12, bevel = 0.003, sole = false) {
    const extent = rows.at(-1)![0] - rows[0]![0];
    if (this.level === 2) {
      if (extent < 0.013 && tile !== finish.glass && tile !== finish.visor) return;
      if (rows.length > 4) rows = rows.filter((_, i) => i === 0 || i === rows.length - 1 || i % 2 === 1);
    }
    const firstIndex = this.ix.length;
    const n = Math.max(sole ? 8 : 2, Math.round(segments * [1, 0.5, 0.16][this.level]!)),
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
    if (sole) this.outsole(us.slice(0, -1).map(u => point(0, u)), bone);
    const forward = this.ix[firstIndex + 1] === start + 1;
    const backed = tile === finish.ceramic || tile === finish.chest || tile === finish.crown || tile === finish.limb
      || tile === finish.seam || tile === finish.jet || tile === finish.shoe || tile === finish.rubber || tile === finish.alloy;
    if (backed && bevel > 0) {
      // Keep every edge vertex so that the backing meets its return exactly. The dark inner surface
      // doesn't carry the rolled outer highlight, so one column per ~40 degrees suffices between rims.
      const begin = this.ix.length, last = rows.length-1;
      const arc = Math.max(...rows.map(row => Math.abs(row[2]-row[1])));
      const stride = Math.max(1, Math.floor(m / Math.ceil(arc / 40)));
      let previous: number[] = [], lower: number[] = [];
      for (let r = 0; r <= last; r++) {
        const current: number[] = [], upper: number[] = [];
        for (let j = 0; j <= m; j++) {
          if (r > 0 && r < last && j !== m && j % stride !== 0) continue;
          const at = 3 * (start + r * (m+1) + j);
          current.push(j);
          upper.push(this.vertex(point(r, us[j]!, this.level === 0 ? -0.01 : 0),
            [-this.n[at]!, -this.n[at+1]!, -this.n[at+2]!], us[j]!, r/last, finish.rubber, bone));
        }
        if (r > 0) {
          // Walk both row boundaries in angular order, also covering the transition to the dense end cap.
          let i = 0, j = 0;
          while (i+1 < lower.length || j+1 < upper.length) {
            const a = lower[i]!, c = upper[j]!;
            if ((previous[i+1] ?? Infinity) < (current[j+1] ?? Infinity)) {
              const b = lower[++i]!;
              if (forward) this.ix.push(a,c,b); else this.ix.push(a,b,c);
            } else {
              const d = upper[++j]!;
              if (forward) this.ix.push(a,c,d); else this.ix.push(a,d,c);
            }
          }
        }
        previous = current;
        lower = upper;
      }
      this.mark(begin, finish.rubber);
    }
    if (bevel <= 0 || this.level > 0) return;
    // Return each free edge to the liner. A narrow metallic bevel catches light seen almost edge-on.
    const wall = (r: number, u: number, k: number, w: number) => {
      const a = point(r, u),
        b = point(k, w),
        c = point(k, w, -0.01),
        d = point(r, u, -0.01);
      const normal = unit(forward ? cross(sub(b, a), sub(d, a)) : cross(sub(d, a), sub(b, a))),
        start = this.b.length;
      this.vertex(a, normal, u, 0.06, finish.alloy, bone);
      this.vertex(b, normal, w, 0.06, finish.alloy, bone);
      this.vertex(c, normal, w, 0.91, finish.alloy, bone);
      this.vertex(d, normal, u, 0.91, finish.alloy, bone);
      if (forward) this.ix.push(start, start + 1, start + 2, start, start + 2, start + 3);
      else this.ix.push(start, start + 2, start + 1, start, start + 3, start + 2);
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
  /** A continuous rubber outsole on the welt's exact perimeter. The near level has raised chevron lugs. */
  private outsole(ring: V[], bone: number) {
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[2]);
    const left = Math.min(...xs), right = Math.max(...xs), heel = Math.min(...zs), toe = Math.max(...zs);
    const y = ring[0]![1], mid = (left + right) / 2;
    const vertex = (p: V, normal: V, tile: number) =>
      this.vertex(p, normal, (p[0] - left) / (right - left), (p[2] - heel) / (toe - heel), tile, bone);
    const down: V = [0, -1, 0], begin = this.ix.length;
    const center = vertex([mid, y, (heel + toe) / 2], down, finish.palm);
    const rim = ring.map(p => vertex(p, down, finish.palm));
    for (let i = 0; i < rim.length; i++) this.ix.push(center, rim[(i + 1) % rim.length]!, rim[i]!);
    if (this.level === 0) {
      // A split heel and forefoot leave a flex channel under the arch.
      for (const t of [0.15, 0.26, 0.55, 0.66, 0.77, 0.86]) for (const side of [-1, 1]) {
        const z = mix(heel, toe, t), outer = (right - left) * Math.sqrt(1 - (2*t - 1)**2) * 0.40;
        const near = mid + side * 0.006, far = mid + side * outer;
        // The ball's lugs stand a millimetre proud of the heel's and the toe's, so the sole's lowest point is under
        // the ball of the foot, inside a saddle's tread, and not on the rear heel lug behind it.
        const low = y - (t === 0.55 || t === 0.66 ? 0.003 : 0.002);
        const face: V[] = [[near, low, z-0.012], [far, low, z+0.002],
          [far, low, z+0.014], [near, low, z+0.002]];
        if (side < 0) face.reverse();
        const at = face.map(p => vertex(p, down, finish.rubber));
        this.ix.push(at[0]!, at[1]!, at[2]!, at[0]!, at[2]!, at[3]!);
        for (let i = 0; i < 4; i++) {
          const a = face[i]!, b = face[(i + 1) % 4]!;
          const normal = unit(cross(sub(a,b), [0,1,0]));
          const q = vertex(b, normal, finish.rubber);
          vertex(a, normal, finish.rubber);
          vertex([a[0], y, a[2]], normal, finish.rubber);
          vertex([b[0], y, b[2]], normal, finish.rubber);
          this.ix.push(q, q+1, q+2, q, q+2, q+3);
        }
      }
    }
    this.mark(begin, finish.rubber);
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
      // A ring's sloping face has a radial normal component. A flat annulus keeps its axial normal.
      const slope = (next[1] - prev[1]) / Math.max(0.00001, prev[0] - next[0]);
      for (const [radius, z] of [prev, next])
        for (let j = 0; j <= seg; j++) {
          const a = (j * Math.PI * 2) / seg,
            c = Math.cos(a),
            s = Math.sin(a),
            p = center.map((val, i) => val + radius * (u[i]! * c + v[i]! * s) + z * n[i]!) as V;
          const normal = unit(n.map((val, i) => val + slope * (u[i]! * c + v[i]! * s)) as V);
          this.vertex(p, normal, 0.5 + (0.48 * c * radius) / rings[0]![0], 0.5 - (0.48 * s * radius) / rings[0]![0], next[2], bone);
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
      ...(this.level < 2 && this.blended ? { joints: Uint8Array.from(this.j), weights: Float32Array.from(this.w) } : {}),
    };
  }
}
