// Grids of samples: distances, regions, blurs, polygons and a hash for noise. A grid is `w` wide and `h` high, index
// row * w + column.

/** Squared distance of each sample to the nearest one where `site` is set, and with `nearest` that sample's index. */
export function distanceField(site: (i: number) => boolean, w: number, h: number, nearest?: Int32Array): Float32Array {
  const INF = 1e20;
  const d = new Float32Array(w * h);
  const from = nearest ?? null;
  // Felzenszwalb and Huttenlocher's transform, a column at a time and then a row at a time, carrying the nearest site.
  const f = new Float64Array(Math.max(w, h));
  const fi = new Int32Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const out = new Float64Array(Math.max(w, h));
  const outI = new Int32Array(Math.max(w, h));
  const pass = (n: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      out[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
      outI[q] = fi[v[k]!]!;
    }
  };
  const tmpI = from ? new Int32Array(w * h) : null;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      const on = site(i);
      f[y] = on ? 0 : INF;
      fi[y] = on ? i : -1;
    }
    pass(h);
    for (let y = 0; y < h; y++) {
      d[y * w + x] = out[y]! >= INF ? INF : out[y]!;
      if (tmpI) tmpI[y * w + x] = outI[y]!;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      f[x] = d[y * w + x]!;
      fi[x] = tmpI ? tmpI[y * w + x]! : -1;
    }
    pass(w);
    for (let x = 0; x < w; x++) {
      d[y * w + x] = out[x]!;
      if (from) from[y * w + x] = outI[x]!;
    }
  }
  return d;
}

/** Each sample's region of 8-connected samples where `inside` holds, numbered from 1, 0 outside; and how many regions. */
export function regions(inside: (i: number) => boolean, w: number, h: number): { label: Int32Array; count: number } {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (label[s] !== 0 || !inside(s)) continue;
    count++;
    let top = 0;
    stack[top++] = s;
    label[s] = count;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (label[j] === 0 && inside(j)) {
            label[j] = count;
            stack[top++] = j;
          }
        }
      }
    }
  }
  return { label, count };
}

/** A box blur of radius `r` samples, run `passes` times, which is near a Gaussian for three. */
export function blur(src: Float32Array, w: number, h: number, r: number, passes = 3): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  const line = new Float64Array(Math.max(w, h) + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      line[0] = 0;
      for (let x = 0; x < w; x++) line[x + 1] = line[x]! + a[y * w + x]!;
      for (let x = 0; x < w; x++) {
        const lo = Math.max(0, x - r);
        const hi = Math.min(w - 1, x + r);
        b[y * w + x] = (line[hi + 1]! - line[lo]!) / (hi - lo + 1);
      }
    }
    for (let x = 0; x < w; x++) {
      line[0] = 0;
      for (let y = 0; y < h; y++) line[y + 1] = line[y]! + b[y * w + x]!;
      for (let y = 0; y < h; y++) {
        const lo = Math.max(0, y - r);
        const hi = Math.min(h - 1, y + r);
        a[y * w + x] = (line[hi + 1]! - line[lo]!) / (hi - lo + 1);
      }
    }
  }
  b = a;
  return b;
}

/** The share of samples within `r` where `on` holds, as a blur of it. */
export function share(on: (i: number) => boolean, w: number, h: number, r: number): Float32Array {
  const src = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) src[i] = on(i) ? 1 : 0;
  return blur(src, w, h, r, 2);
}

/**
 * Calls `fill` for each sample of a grid whose point lies inside the polygon, by the even-odd rule over all its rings, so
 * holes stay out. `toCol` and `toRow` turn a ring's coordinates into fractional columns and rows.
 */
export function fillPolygon(rings: readonly (readonly (readonly number[])[])[], toCol: (x: number) => number, toRow: (y: number) => number, w: number, h: number, fill: (col: number, row: number) => void): void {
  let top = Infinity;
  let bottom = -Infinity;
  const edges: number[] = [];
  for (const ring of rings) {
    for (let k = 0; k + 1 < ring.length; k++) {
      const c0 = toCol(ring[k]![0]!);
      const r0 = toRow(ring[k]![1]!);
      const c1 = toCol(ring[k + 1]![0]!);
      const r1 = toRow(ring[k + 1]![1]!);
      edges.push(c0, r0, c1, r1);
      top = Math.min(top, r0, r1);
      bottom = Math.max(bottom, r0, r1);
    }
  }
  const xs: number[] = [];
  for (let row = Math.max(0, Math.ceil(top)); row <= Math.min(h - 1, Math.floor(bottom)); row++) {
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const r0 = edges[e + 1]!;
      const r1 = edges[e + 3]!;
      // Half open, so a vertex on the row counts once.
      if ((r0 <= row && r1 > row) || (r1 <= row && r0 > row)) xs.push(edges[e]! + ((row - r0) / (r1 - r0)) * (edges[e + 2]! - edges[e]!));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let col = Math.max(0, Math.ceil(xs[k]!)); col <= Math.min(w - 1, Math.floor(xs[k + 1]!)); col++) fill(col, row);
    }
  }
}

/** A bin's key from its column and row on a grid of bins, each within 32,768 bins either side of the lattice's middle. */
export const binKey = (column: number, row: number): number => (column + 32768) * 65536 + row + 32768;

/** 32 well-mixed bits from three numbers. */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** 32 well-mixed bits from a text, such as a street's id in the data. */
export function textSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193);
  return hash3(h, text.length, 0x51ed);
}

/** A number from 0 to 1 for three numbers. */
export function rand3(a: number, b: number, c: number): number {
  return hash3(a, b, c) / 4294967296;
}

/** Smooth value noise from 0 to 1 at a point, with lattice cells of `cell`, seeded. */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = fx - i;
  const v = fy - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = rand3(i, j, seed);
  const b = rand3(i + 1, j, seed);
  const c = rand3(i, j + 1, seed);
  const d = rand3(i + 1, j + 1, seed);
  return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
}

/** Value noise summed over octaves, each half the cell and half the weight, from 0 to 1. */
export function fbm(x: number, y: number, cell: number, seed: number, octaves = 3): number {
  let sum = 0;
  let weight = 0;
  let w = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, cell, seed + o * 101) * w;
    weight += w;
    w *= 0.5;
    cell *= 0.5;
  }
  return sum / weight;
}
