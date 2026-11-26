// The face modifiers' picture sheets: each modifier at -1 and +1 beside the neutral head, where it moves, and random
// faces of a creator's spread and two populations', with the hit head's outline. Prints the cut, the sizes and the
// seating checks. `bun tools/makehuman/faces-page.ts [--out var/faces]`.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { B_NECK } from "../../shared/anim/human.ts";
import { FACE_COUNT, randomLook } from "../../shared/anim/look.ts";
import { FACE_SLACK, faceValues } from "../../shared/people/faces.ts";
import { personFrom } from "../../shared/people/person.ts";
import { Rng } from "../../shared/rng.ts";
import { CITY, WORKERS } from "../../content/people/defaults.ts";
import { encodePng } from "../snap/png.ts";
import { cookFaces, drawnAt, faceOn, FACE_MODIFIERS, seating, worstOver, type FaceCook } from "./faces.ts";
import { frozenRigs } from "./fit-audit.ts";
import { MATERIAL_BROWS, MATERIAL_EYES, MATERIAL_MOUTH, PART_NAMES } from "./fit.ts";

const TILE = 240;
/** Drawn at twice the tile and averaged down. */
const SUPER = 2;
const SPAN = 0.34;
const FRONT = [0, 0, -1];
const THREE_QUARTER = [-Math.sin(0.6), 0, -Math.cos(0.6)];
const SIDE = [-1, 0, 0];
const BEHIND = [-Math.sin(2.4), 0, -Math.cos(2.4)];

interface View {
  forward: number[];
  /** Colour by how far each vertex moves, up to HEAT_MOST, instead of by material. */
  heat?: Float32Array;
}
const HEAT_MOST = 0.008;

const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const unit = (a: number[]): number[] => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

/** The triangles a head tile draws: every bound part, and the skin above the neck's joint less 4 cm near the middle. */
function headTriangles(c: FaceCook): Uint32Array {
  const b = c.body;
  const low = b.rest[B_NECK * 3 + 1]! - 0.04;
  const keep: number[] = [];
  for (let t = 0; t < b.indices.length / 3; t++) {
    const i = b.indices[t * 3]!;
    if (b.part[t] !== 0 || (b.positions[i * 3 + 1]! > low && Math.abs(b.positions[i * 3]!) < 0.15)) keep.push(t);
  }
  return Uint32Array.from(keep);
}

/** One tile, RGBA, of the body at `at` (fitted positions) seen along the view, its head drawn where look.ts draws it. */
function tile(c: FaceCook, tris: Uint32Array, at: Float32Array, view: View): Uint8Array {
  const size = TILE * SUPER;
  const f = unit(view.forward);
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const centre = [c.bound.drawn[0]!, c.bound.drawn[1]! + 0.085, c.bound.drawn[2]! + 0.02];
  const scale = size / SPAN;
  const n = at.length / 3;
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n);
  const q = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    drawnAt(c.bound, [1, 1, 1], at[v * 3]!, at[v * 3 + 1]!, at[v * 3 + 2]!, q);
    const d = [q[0]! - centre[0]!, q[1]! - centre[1]!, q[2]! - centre[2]!];
    sx[v] = size / 2 + dot(d, r) * scale;
    sy[v] = size / 2 - dot(d, u) * scale;
    sz[v] = dot(d, f);
  }
  const depth = new Float64Array(size * size).fill(Infinity);
  const hit = new Int32Array(size * size).fill(-1);
  const bary = new Float32Array(size * size * 2);
  for (const t of tris) {
    const a = c.body.indices[t * 3]!, b = c.body.indices[t * 3 + 1]!, d = c.body.indices[t * 3 + 2]!;
    const area = (sx[b]! - sx[a]!) * (sy[d]! - sy[a]!) - (sx[d]! - sx[a]!) * (sy[b]! - sy[a]!);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sx[a]!, sx[b]!, sx[d]!))), x1 = Math.min(size - 1, Math.ceil(Math.max(sx[a]!, sx[b]!, sx[d]!)));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a]!, sy[b]!, sy[d]!))), y1 = Math.min(size - 1, Math.ceil(Math.max(sy[a]!, sy[b]!, sy[d]!)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((sx[b]! - px) * (sy[d]! - py) - (sx[d]! - px) * (sy[b]! - py)) / area;
        const w1 = ((sx[d]! - px) * (sy[a]! - py) - (sx[a]! - px) * (sy[d]! - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[a]! + w1 * sz[b]! + w2 * sz[d]!;
        const p = y * size + x;
        if (z < depth[p]!) {
          depth[p] = z;
          hit[p] = t;
          bary[p * 2] = w0;
          bary[p * 2 + 1] = w1;
        }
      }
    }
  }
  const light = unit([-f[0]! + 0.35 * r[0]!, 0.6, -f[2]! + 0.35 * r[2]!]);
  const big = new Float32Array(size * size * 3);
  for (let p = 0; p < size * size; p++) {
    const t = hit[p]!;
    let rgb = [245, 245, 248];
    if (t >= 0) {
      const ia = c.body.indices[t * 3]!, ib = c.body.indices[t * 3 + 1]!, id = c.body.indices[t * 3 + 2]!;
      const A = ia * 3, B = ib * 3, D = id * 3;
      let nrm = unit(cross([at[B]! - at[A]!, at[B + 1]! - at[A + 1]!, at[B + 2]! - at[A + 2]!], [at[D]! - at[A]!, at[D + 1]! - at[A + 1]!, at[D + 2]! - at[A + 2]!]));
      if (dot(nrm, f) > 0) nrm = nrm.map((x) => -x);
      const shade = 0.3 + 0.7 * Math.max(0, dot(nrm, light));
      const kind = c.body.material[t]!;
      let base = kind === MATERIAL_EYES ? [235, 235, 240] : kind === MATERIAL_BROWS ? [60, 45, 35] : kind === MATERIAL_MOUTH ? [235, 215, 205] : [214, 170, 140];
      if (kind === MATERIAL_EYES) {
        const w0 = bary[p * 2]!, w1 = bary[p * 2 + 1]!, w2 = 1 - w0 - w1;
        const uu = w0 * c.body.uvs[ia * 2]! + w1 * c.body.uvs[ib * 2]! + w2 * c.body.uvs[id * 2]!;
        const vv = w0 * c.body.uvs[ia * 2 + 1]! + w1 * c.body.uvs[ib * 2 + 1]! + w2 * c.body.uvs[id * 2 + 1]!;
        const rr = Math.hypot(uu - 0.5, vv - 0.5);
        if (rr < 0.06) base = [30, 25, 25];
        else if (rr < 0.14) base = [90, 120, 150];
      }
      if (view.heat && c.body.part[t] === 0) {
        const w0 = bary[p * 2]!, w1 = bary[p * 2 + 1]!, w2 = 1 - w0 - w1;
        const h = Math.min(1, (w0 * view.heat[ia]! + w1 * view.heat[ib]! + w2 * view.heat[id]!) / HEAT_MOST);
        base = [200 + 55 * h, 200 - 150 * h, 200 - 170 * h];
      }
      rgb = base.map((x) => x * shade);
    }
    big[p * 3] = rgb[0]!;
    big[p * 3 + 1] = rgb[1]!;
    big[p * 3 + 2] = rgb[2]!;
  }
  // The hit head's capsule as drawn at rest, and grown by FACE_SLACK, as stadiums of its projected axis.
  const pa = project(c.bound.a, centre, r, u, size, scale), pb = project(c.bound.b, centre, r, u, size, scale);
  for (const [radius, col] of [[c.bound.r, [40, 110, 200]], [c.bound.r - FACE_SLACK, [40, 160, 90]]] as const) {
    const rad = radius * scale;
    const ex = pb[0] - pa[0], ey = pb[1] - pa[1], l2 = ex * ex + ey * ey;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const tt = l2 > 0 ? Math.min(1, Math.max(0, ((x + 0.5 - pa[0]) * ex + (y + 0.5 - pa[1]) * ey) / l2)) : 0;
      const dd = Math.hypot(x + 0.5 - pa[0] - tt * ex, y + 0.5 - pa[1] - tt * ey);
      if (Math.abs(dd - rad) < 1.2) big.set(col, (y * size + x) * 3);
    }
  }
  const out = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    for (let k = 0; k < 3; k++) {
      let s = 0;
      for (let dy = 0; dy < SUPER; dy++) for (let dx = 0; dx < SUPER; dx++) s += big[((y * SUPER + dy) * size + x * SUPER + dx) * 3 + k]!;
      out[(y * TILE + x) * 4 + k] = Math.round(s / (SUPER * SUPER));
    }
    out[(y * TILE + x) * 4 + 3] = 255;
  }
  return out;
}

function project(p: readonly number[], centre: number[], r: number[], u: number[], size: number, scale: number): [number, number] {
  const d = [p[0]! - centre[0]!, p[1]! - centre[1]!, p[2]! - centre[2]!];
  return [size / 2 + dot(d, r) * scale, size / 2 - dot(d, u) * scale];
}

// ---- A number in the corner -----------------------------------------------------------------------------------------

/** Three by five pixel digits, a row a number, the top bit the left. */
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001010010010", "111101111101111", "111101111001111"];
const SIGNS: Record<string, string> = { "-": "000000111000000", "+": "000010111010000" };

function label(rgba: Uint8Array, width: number, x0: number, y0: number, text: string): void {
  const px = 3;
  [...text].forEach((ch, i) => {
    const bits = SIGNS[ch] ?? DIGITS[Number(ch)] ?? "";
    for (let b = 0; b < bits.length; b++) {
      if (bits[b] !== "1") continue;
      const cx = x0 + i * 4 * px + (b % 3) * px, cy = y0 + Math.floor(b / 3) * px;
      for (let y = cy; y < cy + px; y++) for (let x = cx; x < cx + px; x++) rgba.set([20, 20, 20, 255], (y * width + x) * 4);
    }
  });
}

// ---- Sheets -------------------------------------------------------------------------------------------------------

function sheet(rows: Uint8Array[][]): { width: number; height: number; rgba: Uint8Array } {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = cols * TILE, height = rows.length * TILE;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  rows.forEach((row, ry) => row.forEach((t, cx) => {
    for (let y = 0; y < TILE; y++) rgba.set(t.subarray(y * TILE * 4, (y + 1) * TILE * 4), ((ry * TILE + y) * width + cx * TILE) * 4);
  }));
  // A grey line between tiles.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x % TILE === 0 || y % TILE === 0) rgba.set([190, 190, 190, 255], (y * width + x) * 4);
  return { width, height, rgba };
}

const valuesWith = (m: number, v: number): Float32Array => {
  const out = new Float32Array(FACE_COUNT);
  out[m] = v;
  return out;
};

/** How far each vertex moves on a face, in metres. */
function movement(c: FaceCook, at: Float32Array): Float32Array {
  const p = c.body.positions;
  return Float32Array.from({ length: p.length / 3 }, (_, i) => Math.hypot(at[i * 3]! - p[i * 3]!, at[i * 3 + 1]! - p[i * 3 + 1]!, at[i * 3 + 2]! - p[i * 3 + 2]!));
}

/**
 * The random faces of the sheet: a creator's random look, then the city's and the workers' spreads, four of each; then
 * four with every modifier anywhere in -1..1, to show what the bytes can make.
 */
export function sampleFaces(): { from: string; values: Float32Array }[] {
  const out: { from: string; values: Float32Array }[] = [];
  const rng = new Rng(2026);
  for (let i = 0; i < 4; i++) out.push({ from: "random look", values: faceValues(randomLook(rng)) });
  for (const [name, pop] of [["city", CITY], ["workers", WORKERS]] as const) for (let i = 0; i < 4; i++) out.push({ from: name, values: faceValues(personFrom(1000 + i * 7919, pop).look) });
  for (let i = 0; i < 4; i++) out.push({ from: "whole range", values: Float32Array.from({ length: FACE_COUNT }, () => rng.range(-1, 1)) });
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outDir = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : "var/faces");
  mkdirSync(outDir, { recursive: true });
  const rigs = await frozenRigs();
  for (const sex of ["male", "female"] as const) {
    const c = cookFaces(sex, rigs[sex === "male" ? 0 : 1]!);
    const tris = headTriangles(c);
    const neutral = c.body.positions;
    const rows: Uint8Array[][] = [];
    for (let m = 0; m < FACE_COUNT; m++) {
      const lo = faceOn(c, valuesWith(m, -1)), hi = faceOn(c, valuesWith(m, 1));
      const heatLo = movement(c, lo), heatHi = movement(c, hi);
      const heat = heatLo.map((h, i) => Math.max(h, heatHi[i]!));
      const row = [
        tile(c, tris, lo, { forward: FRONT }), tile(c, tris, lo, { forward: THREE_QUARTER }), tile(c, tris, neutral, { forward: FRONT }),
        tile(c, tris, hi, { forward: FRONT }), tile(c, tris, hi, { forward: THREE_QUARTER }), tile(c, tris, neutral, { forward: THREE_QUARTER, heat }),
      ];
      label(row[0]!, TILE, 6, 6, `${m}-`);
      label(row[3]!, TILE, 6, 6, `${m}+`);
      rows.push(row);
    }
    for (let s = 0; s < 4; s++) {
      const { width, height, rgba } = sheet(rows.slice(s * 8, s * 8 + 8));
      writeFileSync(join(outDir, `${sex}-modifiers-${s + 1}.png`), encodePng(width, height, rgba));
    }
    const faces = [
      { from: "neutral", values: new Float32Array(FACE_COUNT) },
      { from: "all minus", values: new Float32Array(FACE_COUNT).fill(-1) },
      { from: "all plus", values: new Float32Array(FACE_COUNT).fill(1) },
      ...sampleFaces(),
    ];
    const tiles = faces.flatMap((f, i) => {
      const at = faceOn(c, f.values);
      const pair = [tile(c, tris, at, { forward: FRONT }), tile(c, tris, at, { forward: THREE_QUARTER })];
      label(pair[0]!, TILE, 6, 6, String(i));
      return pair;
    });
    const faceRows: Uint8Array[][] = [];
    for (let i = 0; i < tiles.length; i += 8) faceRows.push(tiles.slice(i, i + 8));
    const { width, height, rgba } = sheet(faceRows);
    writeFileSync(join(outDir, `${sex}-faces.png`), encodePng(width, height, rgba));
    // The neck from the side and from behind, each extreme with where it moves, for the seam.
    const neck = [1, 2].map((i) => {
      const at = faceOn(c, faces[i]!.values);
      const heat = movement(c, at);
      return [tile(c, tris, at, { forward: SIDE }), tile(c, tris, neutral, { forward: SIDE, heat }), tile(c, tris, at, { forward: BEHIND }), tile(c, tris, neutral, { forward: BEHIND, heat })];
    });
    const n = sheet(neck);
    writeFileSync(join(outDir, `${sex}-neck.png`), encodePng(n.width, n.height, n.rgba));

    console.log(`\n${sex}: ${c.bytes.length} bytes (${gzipSync(c.bytes).length} gzipped), ${c.table.modifiers.reduce((n, m) => n + m.minus.vertices.length + m.plus.vertices.length, 0)} entries on ${c.table.vertexCount} vertices`);
    console.log(`  bound: head capsule r ${(c.bound.r * 1000).toFixed(0)} mm with slack; ${c.checked} vertices held, ${c.outsideAtNeutral} already outside at neutral; worst face ${(worstOver(c) * 1000).toFixed(3)} mm over`);
    console.log("  byte  modifier          moves (mm) -/+   kept -/+       entries -/+");
    c.modifiers.forEach((m, i) => {
      const t = c.table.modifiers[i]!;
      console.log(`  ${String(40 + i).padStart(4)}  ${m.name.padEnd(17)} ${m.most.map((x) => x.toFixed(1).padStart(5)).join(" ")}   ${m.kept.map((x) => x.toFixed(2)).join(" ")}   ${String(t.minus.vertices.length).padStart(5)} ${String(t.plus.vertices.length).padStart(5)}`);
    });
    let eye = 0, through = 0, throughNeutral = 0;
    for (const f of [...faces, ...Array.from({ length: FACE_COUNT * 2 }, (_, j) => ({ from: "", values: valuesWith(j >> 1, j & 1 ? 1 : -1) }))]) {
      const s = seating(c, f.values);
      eye = Math.max(eye, s.eyeMm);
      through = Math.max(through, s.mouthOut);
      throughNeutral = s.mouthOutNeutral;
    }
    console.log(`  seating: eyes at most ${eye.toFixed(3)} mm off their joints; at most ${through} teeth or tongue vertices through the skin (${throughNeutral} at neutral)`);
    console.log(`  faces sheet: 0 neutral, 1 all minus, 2 all plus, ${faces.slice(3).map((f, i) => `${i + 3} ${f.from}`).join(", ")}`);
  }
  console.log(`\nsheets in ${outDir}; parts ${PART_NAMES.join(", ")}; modifiers ${FACE_MODIFIERS.length}`);
}

if (import.meta.main) await main();
