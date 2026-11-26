// How each garment cut fits the body it is made on, posed as the game poses it (tools/art/cloth-fit.ts motionSet), as
// tools/art/cloth-fit.ts measures armour: the skin zones its garment item covers are not drawn under it.
//   - skin through cloth: a point of drawn skin the cut is over at rest that in a pose has the cut under it instead, by
//     how far; closed where the cut is over or under that point in every pose, open where it is neither in some pose;
//   - each zone: the most of its points with the cut neither over nor under them in one pose. A zone may be hidden only
//     where that is none, since hiding it would otherwise show a hole; a zone the item covers that is not is a fault.
//     Skin in a fold of the body, other skin pressed close over it, counts as covered: nothing can see it.
//
//   bun tools/art/garment-fit.ts [--cut tee,jeans] [--with jeans,trainers] [--level N] [--quick] [--pack FILE] [--sex m,f]

import { readFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { BONE_FLOATS } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { HUMAN_BONES, SLOT_NAMES } from "../../shared/anim/human.ts";
import { SKIN_ZONE_COUNT, SKIN_ZONE_NAMES } from "../../shared/anim/skin-zones.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { CUTS, cutMesh } from "../../shared/people/cuts.ts";
import { smoothNormals, TriangleGrid, welded } from "../pack/refit.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import { humanAnim, motionSet } from "./cloth-fit.ts";

const BODIES = new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url);
/** How far out a skin point looks for the cut over it, and in for one it came through, and how near at rest they lay. */
const OVER = 0.06;
const UNDER = 0.03;
const LOCAL = 0.08;
/** A fold: other skin within this of a point along its normal, skin that lay this far from it at rest. */
const FOLD = 0.025;
const FOLD_APART = 0.015;

function skinned(lod: SourceLod, m: Float32Array, out: Float64Array): void {
  for (let v = 0; v < lod.positions.length / 3; v++) {
    const x = lod.positions[v * 3]!, y = lod.positions[v * 3 + 1]!, z = lod.positions[v * 3 + 2]!;
    let ox = 0, oy = 0, oz = 0;
    const four = lod.joints && lod.weights ? 4 : 1;
    for (let k = 0; k < four; k++) {
      const w = four === 4 ? lod.weights![v * 4 + k]! : 1;
      if (w === 0) continue;
      const b = (four === 4 ? lod.joints![v * 4 + k]! : lod.bones![v]!) * BONE_FLOATS;
      ox += w * (m[b]! * x + m[b + 1]! * y + m[b + 2]! * z + m[b + 3]!);
      oy += w * (m[b + 4]! * x + m[b + 5]! * y + m[b + 6]! * z + m[b + 7]!);
      oz += w * (m[b + 8]! * x + m[b + 9]! * y + m[b + 10]! * z + m[b + 11]!);
    }
    [out[v * 3], out[v * 3 + 1], out[v * 3 + 2]] = [ox, oy, oz];
  }
}

/** The first hit within `reach` of the ray from p along d on the triangles `keep` keeps, or -1. */
function ray(grid: TriangleGrid, p: readonly number[], d: readonly number[], reach: number, keep: (t: number) => boolean): number {
  const q = grid.positions, idx = grid.indices;
  let best = Infinity;
  grid.along(p[0]!, p[1]!, p[2]!, d, reach, (tri) => {
    const a = idx[tri * 3]! * 3, b = idx[tri * 3 + 1]! * 3, c = idx[tri * 3 + 2]! * 3;
    const e1 = [q[b]! - q[a]!, q[b + 1]! - q[a + 1]!, q[b + 2]! - q[a + 2]!], e2 = [q[c]! - q[a]!, q[c + 1]! - q[a + 1]!, q[c + 2]! - q[a + 2]!];
    const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-14) return;
    const s = [p[0]! - q[a]!, p[1]! - q[a + 1]!, p[2]! - q[a + 2]!];
    const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) return;
    const r = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * r[0]! + d[1]! * r[1]! + d[2]! * r[2]!) / det;
    if (v < 0 || u + v > 1) return;
    const t = (e2[0]! * r[0]! + e2[1]! * r[1]! + e2[2]! * r[2]!) / det;
    if (t >= 0 && t <= reach && t < best && keep(tri)) best = t;
  });
  return best === Infinity ? -1 : best;
}

export interface Worst { depth: number; pose: string; zone: string; at: number[] }
export interface ZoneFit { zone: number; points: number; out: number; pose: string }
export interface CutFit {
  cut: string;
  sex: string;
  level: number;
  /** The zones not drawn while it is worn, with what it is worn with, and those its own item covers. */
  hides: number;
  own: number;
  /** Drawn skin through it: where it is over or under that skin in every pose, and where not. */
  closed: Worst;
  open: Worst;
  over2mm: number;
  zones: ZoneFit[];
}

const none = (): Worst => ({ depth: 0, pose: "", zone: "", at: [] });

export interface GarmentFitOptions {
  cuts?: readonly string[];
  sexes?: readonly string[];
  level?: number;
  quick?: boolean;
  pack?: Uint8Array;
  /** Cuts worn with each measured one: what they hide is not drawn either. */
  with?: readonly string[];
}

export function auditGarmentFit(o: GarmentFitOptions = {}): CutFit[] {
  const level = o.level ?? 0;
  const pack = parsePack(o.pack ?? new Uint8Array(readFileSync(BODIES)));
  const meshes = unpackMeshes(pack);
  const reg = compileContent(CORE_CONTENT).registry!;
  const hidesOf = new Map<string, number>();
  for (let i = 0; i < reg.defs.length; i++) {
    const cut = (reg.defs[i] as { garment?: { cut?: string } } | null)?.garment?.cut;
    if (cut) hidesOf.set(cut, reg.garmentZones[i]!);
  }
  const anim = humanAnim();
  const m = new Float32Array(HUMAN_BONES * BONE_FLOATS);
  const out: CutFit[] = [];
  for (const sex of o.sexes ?? ["m", "f"]) {
    const id = `core:human_${sex}`;
    const rest = Float32Array.from(pack.header.rigs.find((r) => r.id === `human_${sex}`)!.rest);
    const poses = motionSet(anim, rest, o.quick);
    // The skin: its slot meshes' skin triangles, welded, each point's zones a bit each.
    const parts = SLOT_NAMES.map((name) => meshes.find((x) => x.id === `${id}/${name}`)).filter((x): x is SourceMesh => !!x);
    const positions: number[] = [], joints: number[] = [], weights: number[] = [], indices: number[] = [], vzones: number[] = [];
    for (const mesh of parts) {
      const lod = mesh.lods[Math.min(level, mesh.lods.length - 1)]!;
      const base = positions.length / 3;
      positions.push(...lod.positions);
      for (let v = 0; v < lod.positions.length / 3; v++) for (let k = 0; k < 4; k++) {
        joints.push(lod.joints?.[v * 4 + k] ?? lod.bones![v]!);
        weights.push(lod.weights ? lod.weights[v * 4 + k]! : k === 0 ? 1 : 0);
      }
      const vm = new Uint32Array(lod.positions.length / 3);
      for (let t = 0; t < lod.indices.length / 3; t++) {
        if (lod.sections && !/skin/.test(mesh.materials?.[lod.sections[t]!]?.id ?? "skin")) continue;
        indices.push(base + lod.indices[t * 3]!, base + lod.indices[t * 3 + 1]!, base + lod.indices[t * 3 + 2]!);
        for (let k = 0; k < 3; k++) vm[lod.indices[t * 3 + k]!]! |= 1 << lod.zones![t]!;
      }
      vzones.push(...vm);
    }
    const body: SourceLod = { positions: Float32Array.from(positions), colors: new Uint8Array(0), indices: Uint32Array.from(indices), joints: Uint8Array.from(joints), weights: Float32Array.from(weights) };
    const bw = welded({ positions, indices });
    const nb = bw.positions.length / 3;
    const bz = new Uint32Array(nb), first = new Int32Array(nb).fill(-1);
    for (let v = positions.length / 3 - 1; v >= 0; v--) {
      first[bw.of[v]!] = v;
      bz[bw.of[v]!]! |= vzones[v]!;
    }
    const posedBody = new Float64Array(positions.length), bp = new Float64Array(nb * 3), bn = new Float64Array(nb * 3);
    const poseBody = (): void => {
      skinned(body, m, posedBody);
      for (let i = 0; i < nb; i++) for (let a = 0; a < 3; a++) bp[i * 3 + a] = posedBody[first[i]! * 3 + a]!;
      smoothNormals(bp, bw.indices, bn);
    };
    const cuts = (o.cuts ?? Object.keys(CUTS)).map((c) => ({ cut: c, mesh: meshes.find((x) => x.id === cutMesh(id, c)) })).filter((c) => c.mesh);
    // At rest: each cut's triangles' middles, and which skin it lies over.
    const fits = cuts.map(({ cut, mesh }) => {
      const lod = mesh!.lods[Math.min(level, mesh!.lods.length - 1)]!;
      const mid = Float64Array.from({ length: lod.indices.length }, (_, k) => {
        const t = Math.floor(k / 3), a = k % 3;
        return (lod.positions[lod.indices[t * 3]! * 3 + a]! + lod.positions[lod.indices[t * 3 + 1]! * 3 + a]! + lod.positions[lod.indices[t * 3 + 2]! * 3 + a]!) / 3;
      });
      const hides = (o.with ?? []).reduce((m, w) => m | (hidesOf.get(w) ?? 0), hidesOf.get(cut) ?? 0);
      return { cut, lod, mid, hides, own: hidesOf.get(cut) ?? 0, posed: new Float64Array(lod.positions.length), fit: { cut, sex, level, hides, own: hidesOf.get(cut) ?? 0, closed: none(), open: none(), over2mm: 0, zones: [] as ZoneFit[] } as CutFit, over: new Uint8Array(nb), depth: new Float64Array(nb), depthPose: new Int32Array(nb), open: new Uint8Array(nb) };
    });
    const near = (f: (typeof fits)[number], i: number) => (t: number): boolean =>
      (f.mid[t * 3]! - bw.positions[i * 3]!) ** 2 + (f.mid[t * 3 + 1]! - bw.positions[i * 3 + 1]!) ** 2 + (f.mid[t * 3 + 2]! - bw.positions[i * 3 + 2]!) ** 2 < LOCAL * LOCAL;
    const facing = (p: Float64Array, idx: ArrayLike<number>, t: number, n: readonly number[]): boolean => {
      const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!], w = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      return (u[1]! * w[2]! - u[2]! * w[1]!) * n[0]! + (u[2]! * w[0]! - u[0]! * w[2]!) * n[1]! + (u[0]! * w[1]! - u[1]! * w[0]!) * n[2]! > 0;
    };
    // The skin's triangles' middles at rest, to know a fold: skin pressed on skin that lay apart.
    const bodyMid = Float64Array.from({ length: bw.indices.length }, (_, k) => {
      const t = Math.floor(k / 3), a = k % 3;
      return (bw.positions[bw.indices[t * 3]! * 3 + a]! + bw.positions[bw.indices[t * 3 + 1]! * 3 + a]! + bw.positions[bw.indices[t * 3 + 2]! * 3 + a]!) / 3;
    });
    let bodyGrid: TriangleGrid | null = null;
    /** 0 where the cut is over the point or the point is in a fold of the skin, its depth where under, NaN where neither. */
    const through = (f: (typeof fits)[number], grid: TriangleGrid, i: number): number => {
      const p = [bp[i * 3]!, bp[i * 3 + 1]!, bp[i * 3 + 2]!], n = [bn[i * 3]!, bn[i * 3 + 1]!, bn[i * 3 + 2]!];
      const keep = near(f, i);
      if (ray(grid, p, n, OVER, keep) >= 0) return 0;
      const t = ray(grid, p, n.map((x) => -x), UNDER, (tri) => keep(tri) && facing(f.posed, f.lod.indices, tri, n));
      if (t >= 0) return t;
      // Skin in a fold, other skin close over it, cannot be seen.
      const apart = (tri: number): boolean => (bodyMid[tri * 3]! - bw.positions[i * 3]!) ** 2 + (bodyMid[tri * 3 + 1]! - bw.positions[i * 3 + 1]!) ** 2 + (bodyMid[tri * 3 + 2]! - bw.positions[i * 3 + 2]!) ** 2 > FOLD_APART * FOLD_APART;
      if (bodyGrid && ray(bodyGrid, p.map((x, a) => x + n[a]! * 0.001), n, FOLD, apart) >= 0) return 0;
      return Number.NaN;
    };
    // The zones' points, and the zones each cut lies over at rest.
    const zonePoints: number[][] = Array.from({ length: SKIN_ZONE_COUNT }, () => []);
    for (let i = 0; i < nb; i++) for (let z = 0; z < SKIN_ZONE_COUNT; z++) if ((bz[i]! >> z) & 1) zonePoints[z]!.push(i);
    for (const [k, pose] of poses.entries()) {
      writeBones(m, 0, pose.solved, rest, null, 0, 0, 0, 0);
      poseBody();
      bodyGrid = new TriangleGrid(bp, bw.indices, 0.02);
      for (const f of fits) {
        skinned(f.lod, m, f.posed);
        const grid = new TriangleGrid(f.posed, f.lod.indices, 0.02);
        if (k === 0) {
          let lies = 0;
          for (let i = 0; i < nb; i++) if (through(f, grid, i) === 0) {
            f.over[i] = 1;
            lies |= bz[i]!;
          }
          for (let z = 0; z < SKIN_ZONE_COUNT; z++) if ((lies >> z) & 1) f.fit.zones.push({ zone: z, points: zonePoints[z]!.length, out: 0, pose: "" });
        }
        for (const zc of f.fit.zones) {
          let n = 0;
          for (const i of zonePoints[zc.zone]!) if (Number.isNaN(through(f, grid, i))) {
            n++;
            if (process.env.DUMP === `${f.cut} ${SKIN_ZONE_NAMES[zc.zone]} ${pose.name}`) console.log("open", [...bw.positions.subarray(i * 3, i * 3 + 3)].map((x) => x.toFixed(3)).join(","), "normal", [...bn.subarray(i * 3, i * 3 + 3)].map((x) => x.toFixed(2)).join(","));
          }
          if (n > zc.out || zc.pose === "") [zc.out, zc.pose] = [n, pose.name];
        }
        for (let i = 0; i < nb; i++) {
          if (!f.over[i] || (bz[i]! & ~f.hides) === 0) continue;
          const d = through(f, grid, i);
          if (Number.isNaN(d)) f.open[i] = 1;
          else if (d > f.depth[i]!) [f.depth[i], f.depthPose[i]] = [d, k];
        }
      }
    }
    for (const f of fits) {
      for (let i = 0; i < nb; i++) {
        if (f.depth[i]! > 0.002) f.fit.over2mm++;
        const w = f.open[i] ? f.fit.open : f.fit.closed;
        if (f.depth[i]! <= w.depth) continue;
        const zone = [...Array(SKIN_ZONE_COUNT).keys()].find((z) => (bz[i]! >> z) & 1) ?? 0;
        [w.depth, w.pose, w.zone] = [f.depth[i]!, poses[f.depthPose[i]!]!.name, SKIN_ZONE_NAMES[zone]!];
        w.at = [0, 1, 2].map((a) => Math.round(bw.positions[i * 3 + a]! * 1000) / 1000);
      }
      out.push(f.fit);
    }
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const t0 = performance.now();
  const fits = auditGarmentFit({ cuts: arg("cut")?.split(","), sexes: arg("sex")?.split(","), level: Number(arg("level") ?? 0), quick: args.includes("--quick"), with: arg("with")?.split(","), pack: arg("pack") ? new Uint8Array(readFileSync(arg("pack")!)) : undefined });
  const mm = (w: Worst): string => (w.depth > 0 ? `${(w.depth * 1000).toFixed(1)} mm (${w.zone}, ${w.pose}, at ${w.at.join(",")})` : "0");
  for (const f of fits) {
    const may = f.zones.filter((z) => z.out === 0).map((z) => SKIN_ZONE_NAMES[z.zone]).join(", ");
    const faults = f.zones.filter((z) => (f.own >>> z.zone) & 1 && z.out > 0).map((z) => `${SKIN_ZONE_NAMES[z.zone]} (${z.out} of ${z.points} points open in ${z.pose})`);
    const hidden = [...Array(SKIN_ZONE_COUNT).keys()].filter((z) => (f.hides >>> z) & 1).map((z) => SKIN_ZONE_NAMES[z]).join(", ");
    console.log(`${f.cut} ${f.sex} level ${f.level}: hides ${hidden || "nothing"}; ${f.over2mm} points of drawn skin ever through by more than 2 mm`);
    console.log(`  drawn skin through it, closed ${mm(f.closed)}; open ${mm(f.open)}`);
    console.log(`  zones it may hide: ${may || "none"}`);
    if (faults.length) console.log(`  FAULT: hides ${faults.join("; ")}`);
  }
  console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
