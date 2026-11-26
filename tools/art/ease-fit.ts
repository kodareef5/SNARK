// Ease for a worn piece in motion. A piece weighted as the skin under it still meets that skin where its triangles are
// longer than the skin's and where a joint creases: posed through the game's motion set (cloth-fit.ts motionSet), each
// point of skin drawn beside the piece that it covers at rest and comes through it is a need on the piece's triangle it
// came through. The piece is let out at rest by those needs, spread over its surface, and posed again, a few rounds.

import { writeBones } from "../../client/core/render/characters.ts";
import { BONE_FLOATS } from "../../client/core/render/packet.ts";
import { HUMAN_BONES, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { smoothNormals, TriangleGrid, welded } from "../pack/refit.ts";
import type { SourceLod, SourceMesh } from "../pack/write.ts";
import type { MotionPose } from "./cloth-fit.ts";

/** How far out a point of skin looks for the piece over it, and in for one it came through, and how near they lay at rest. */
const OVER = 0.05;
const UNDER = 0.03;
const LOCAL = 0.08;
/** What a need is let out by beyond the depth the skin came through, in metres. */
const MARGIN = 0.002;
/** How far a need spreads over the piece, fading, and the most one round lets out, in metres. */
const SPREAD = 0.025;
const MOST = 0.01;
/** The most a vertex is let out over all rounds, and the farthest off skin a piece lies at rest for that skin to need it. */
const TOTAL = 0.012;
const NEAR = 0.015;

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

/** The nearest hit within `reach` of the ray from p along unit d on the triangles `keep` keeps: its distance and triangle. */
function ray(grid: TriangleGrid, p: readonly number[], d: readonly number[], reach: number, keep: (t: number) => boolean, hit: { t: number; tri: number }): void {
  hit.t = Infinity;
  hit.tri = -1;
  const q = grid.positions, idx = grid.indices;
  grid.along(p[0]!, p[1]!, p[2]!, d, reach, (tri) => {
    const a = idx[tri * 3]! * 3, b = idx[tri * 3 + 1]! * 3, c = idx[tri * 3 + 2]! * 3;
    const e1x = q[b]! - q[a]!, e1y = q[b + 1]! - q[a + 1]!, e1z = q[b + 2]! - q[a + 2]!;
    const e2x = q[c]! - q[a]!, e2y = q[c + 1]! - q[a + 1]!, e2z = q[c + 2]! - q[a + 2]!;
    const hx = d[1]! * e2z - d[2]! * e2y, hy = d[2]! * e2x - d[0]! * e2z, hz = d[0]! * e2y - d[1]! * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-14) return;
    const sx = p[0]! - q[a]!, sy = p[1]! - q[a + 1]!, sz = p[2]! - q[a + 2]!;
    const u = (sx * hx + sy * hy + sz * hz) / det;
    if (u < 0 || u > 1) return;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) / det;
    if (v < 0 || u + v > 1) return;
    const t = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (t >= 0 && t <= reach && t < hit.t && keep(tri)) [hit.t, hit.tri] = [t, tri];
  });
}

export interface EaseReport {
  /** Per round, the deepest skin came through the piece at its finest level before that round let it out, in metres. */
  deepest: number[];
  /** The most a vertex was let out, in metres. */
  most: number;
}

/**
 * Lets `piece`, not yet lined, out at rest where skin drawn beside it comes through it in `poses`: the body's other slots,
 * and its own where `lined` says the lining will draw it, and how far under the skin (tools/pack/liner.ts). `still` keeps a vertex where it is: a hand or a foot a grip or a
 * sole is calibrated on. Every level is let out as its finest is, by the nearest of its vertices there.
 */
export function easeInMotion(piece: SourceMesh, body: readonly SourceMesh[], rest: Float32Array, poses: readonly MotionPose[], lined: (x: number, y: number, z: number) => number, still: (lod: SourceLod, v: number) => boolean, rounds = 3): EaseReport {
  const slot = SLOT_NAMES.indexOf(piece.id.split("/").at(-1)!);
  // The skin: the body's slot meshes at their finest level, welded, with each point drawn beside the piece or not.
  const positions: number[] = [], joints: number[] = [], weights: number[] = [], indices: number[] = [], ofSlot: number[] = [];
  for (const mesh of body) {
    const s = SLOT_NAMES.indexOf(mesh.id.split("/").at(-1)!);
    const lod = mesh.lods[0]!;
    const base = positions.length / 3;
    positions.push(...lod.positions);
    for (let v = 0; v < lod.positions.length / 3; v++) {
      for (let k = 0; k < 4; k++) {
        joints.push(lod.joints?.[v * 4 + k] ?? lod.bones![v]!);
        weights.push(lod.weights ? lod.weights[v * 4 + k]! : k === 0 ? 1 : 0);
      }
      ofSlot.push(s);
    }
    for (let t = 0; t < lod.indices.length / 3; t++) if (/skin/.test(mesh.materials?.[lod.sections?.[t] ?? 0]?.id ?? "skin")) indices.push(base + lod.indices[t * 3]!, base + lod.indices[t * 3 + 1]!, base + lod.indices[t * 3 + 2]!);
  }
  const skin: SourceLod = { positions: Float32Array.from(positions), colors: new Uint8Array(0), indices: Uint32Array.from(indices), joints: Uint8Array.from(joints), weights: Float32Array.from(weights) };
  const bw = welded({ positions, indices });
  const nb = bw.positions.length / 3;
  const first = new Int32Array(nb).fill(-1);
  for (let v = positions.length / 3 - 1; v >= 0; v--) first[bw.of[v]!] = v;
  const fine = piece.lods[0]!;
  const cloth = Array.from(fine.indices);
  // Per point of skin: drawn beside the piece, and how far under it the lining lies, if that is what draws it.
  const sink = new Float64Array(nb);
  const drawn = Uint8Array.from({ length: nb }, (_, i) => {
    if (ofSlot[first[i]!] !== slot || slot === SLOT_HEAD) return 1;
    sink[i] = lined(bw.positions[i * 3]!, bw.positions[i * 3 + 1]!, bw.positions[i * 3 + 2]!);
    return sink[i]! >= 0 ? 1 : 0;
  });
  const clothIdx = Uint32Array.from(cloth);
  const m = new Float32Array(HUMAN_BONES * BONE_FLOATS);
  const posedSkin = new Float64Array(skin.positions.length), bp = new Float64Array(nb * 3), bn = new Float64Array(nb * 3);
  const posedPiece = new Float64Array(fine.positions.length);
  const hit = { t: 0, tri: -1 };
  const restCentres = (): Float64Array => Float64Array.from({ length: clothIdx.length }, (_, k) => {
    const t = Math.floor(k / 3), a = k % 3;
    return (fine.positions[clothIdx[t * 3]! * 3 + a]! + fine.positions[clothIdx[t * 3 + 1]! * 3 + a]! + fine.positions[clothIdx[t * 3 + 2]! * 3 + a]!) / 3;
  });
  const report: EaseReport = { deepest: [], most: 0 };
  const start = Float32Array.from(fine.positions);
  let bestOver = Infinity, kept: Float32Array[] = [];
  // How far each finest vertex has been let out, so no round takes it past TOTAL.
  const outSoFar = new Float64Array(fine.positions.length / 3);
  for (let round = 0; round < rounds; round++) {
    const centres = restCentres();
    const local = (tri: number, i: number): boolean =>
      (centres[tri * 3]! - bw.positions[i * 3]!) ** 2 + (centres[tri * 3 + 1]! - bw.positions[i * 3 + 1]!) ** 2 + (centres[tri * 3 + 2]! - bw.positions[i * 3 + 2]!) ** 2 < LOCAL * LOCAL;
    const need = new Float64Array(fine.positions.length / 3);
    let covered: number[] = [];
    let deepest = 0, over = 0;
    for (const [k, pose] of poses.entries()) {
      writeBones(m, 0, pose.solved, rest, null, 0, 0, 0, 0);
      skinned(skin, m, posedSkin);
      for (let i = 0; i < nb; i++) for (let a = 0; a < 3; a++) bp[i * 3 + a] = posedSkin[first[i]! * 3 + a]!;
      smoothNormals(bp, bw.indices, bn);
      skinned(fine, m, posedPiece);
      const grid = new TriangleGrid(posedPiece, clothIdx, 0.02);
      if (k === 0) {
        covered = [];
        for (let i = 0; i < nb; i++) {
          if (!drawn[i]) continue;
          ray(grid, [bp[i * 3]!, bp[i * 3 + 1]!, bp[i * 3 + 2]!], [bn[i * 3]!, bn[i * 3 + 1]!, bn[i * 3 + 2]!], OVER, (t) => local(t, i), hit);
          if (hit.tri >= 0 && hit.t <= NEAR) covered.push(i);
        }
      }
      for (const i of covered) {
        const p = [bp[i * 3]!, bp[i * 3 + 1]!, bp[i * 3 + 2]!], n = [bn[i * 3]!, bn[i * 3 + 1]!, bn[i * 3 + 2]!];
        ray(grid, p, n, OVER, (t) => local(t, i), hit);
        if (hit.tri >= 0) continue;
        ray(grid, p, n.map((x) => -x), UNDER, (tri) => {
          if (!local(tri, i)) return false;
          const a = clothIdx[tri * 3]! * 3, b = clothIdx[tri * 3 + 1]! * 3, c = clothIdx[tri * 3 + 2]! * 3;
          const u = [posedPiece[b]! - posedPiece[a]!, posedPiece[b + 1]! - posedPiece[a + 1]!, posedPiece[b + 2]! - posedPiece[a + 2]!];
          const w = [posedPiece[c]! - posedPiece[a]!, posedPiece[c + 1]! - posedPiece[a + 1]!, posedPiece[c + 2]! - posedPiece[a + 2]!];
          return (u[1]! * w[2]! - u[2]! * w[1]!) * n[0]! + (u[2]! * w[0]! - u[0]! * w[2]!) * n[1]! + (u[0]! * w[1]! - u[1]! * w[0]!) * n[2]! > 0;
        }, hit);
        const depth = hit.t - sink[i]!;
        if (hit.tri < 0 || depth <= 0) continue;
        deepest = Math.max(deepest, depth);
        if (depth > 0.002) over++;
        for (let c = 0; c < 3; c++) {
          const v = clothIdx[hit.tri * 3 + c]!;
          need[v] = Math.max(need[v]!, Math.min(MOST, depth + MARGIN));
        }
      }
    }
    report.deepest.push(deepest);
    // A round that made it worse is undone, and the one before kept.
    if (over > bestOver && round > 0) {
      piece.lods.forEach((lod, level) => lod.positions.set(kept[level]!));
      report.deepest.push(-1);
      break;
    }
    bestOver = over;
    kept = piece.lods.map((lod) => Float32Array.from(lod.positions));
    if (deepest === 0 || round === rounds - 1) break;
    // Out along the piece's own normals at rest, each need spread to the vertices round it, fading.
    const w = welded({ positions: fine.positions, indices: clothIdx });
    const wn = w.normals;
    const needW = new Float64Array(w.positions.length / 3);
    for (let v = 0; v < need.length; v++) needW[w.of[v]!] = Math.max(needW[w.of[v]!]!, need[v]!);
    const cells = new Map<string, number[]>();
    const cell = (q: number): number => Math.floor(q / SPREAD);
    for (let i = 0; i < needW.length; i++) if (needW[i]! > 0) {
      const key = `${cell(w.positions[i * 3]!)},${cell(w.positions[i * 3 + 1]!)},${cell(w.positions[i * 3 + 2]!)}`;
      (cells.get(key) ?? cells.set(key, []).get(key)!).push(i);
    }
    const move = new Float64Array(needW.length);
    for (let i = 0; i < needW.length; i++) {
      const [x, y, z] = [w.positions[i * 3]!, w.positions[i * 3 + 1]!, w.positions[i * 3 + 2]!];
      for (let a = cell(x) - 1; a <= cell(x) + 1; a++) for (let b = cell(y) - 1; b <= cell(y) + 1; b++) for (let c = cell(z) - 1; c <= cell(z) + 1; c++) {
        for (const j of cells.get(`${a},${b},${c}`) ?? []) {
          const d2 = ((w.positions[j * 3]! - x) ** 2 + (w.positions[j * 3 + 1]! - y) ** 2 + (w.positions[j * 3 + 2]! - z) ** 2) / (SPREAD * SPREAD);
          if (d2 < 1) move[i] = Math.max(move[i]!, needW[j]! * (1 - d2) * (1 - d2));
        }
      }
    }
    for (let v = 0; v < outSoFar.length; v++) move[w.of[v]!] = Math.min(move[w.of[v]!]!, Math.max(0, TOTAL - outSoFar[v]!));
    // Each level as its finest: a vertex by its nearest cloth vertex there.
    const grid = new Map<string, number[]>();
    const g = (q: number): number => Math.floor(q / 0.03);
    for (let i = 0; i < move.length; i++) {
      const key = `${g(w.positions[i * 3]!)},${g(w.positions[i * 3 + 1]!)},${g(w.positions[i * 3 + 2]!)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    }
    const nearestOf = (x: number, y: number, z: number): number => {
      let best = -1, bd = Infinity;
      for (let a = g(x) - 1; a <= g(x) + 1; a++) for (let b = g(y) - 1; b <= g(y) + 1; b++) for (let c = g(z) - 1; c <= g(z) + 1; c++) {
        for (const j of grid.get(`${a},${b},${c}`) ?? []) {
          const d = (w.positions[j * 3]! - x) ** 2 + (w.positions[j * 3 + 1]! - y) ** 2 + (w.positions[j * 3 + 2]! - z) ** 2;
          if (d < bd) [bd, best] = [d, j];
        }
      }
      return best;
    };
    piece.lods.forEach((lod, level) => {
      for (let v = 0; v < lod.positions.length / 3; v++) {
        if (still(lod, v)) continue;
        const j = level === 0 ? w.of[v]! : nearestOf(lod.positions[v * 3]!, lod.positions[v * 3 + 1]!, lod.positions[v * 3 + 2]!);
        if (j < 0 || move[j] === 0) continue;
        for (let a = 0; a < 3; a++) lod.positions[v * 3 + a]! += wn[j * 3 + a]! * move[j]!;
      }
    });
    for (let v = 0; v < outSoFar.length; v++) outSoFar[v]! += move[w.of[v]!]!;
  }
  for (let v = 0; v < start.length / 3; v++) report.most = Math.max(report.most, Math.hypot(fine.positions[v * 3]! - start[v * 3]!, fine.positions[v * 3 + 1]! - start[v * 3 + 1]!, fine.positions[v * 3 + 2]! - start[v * 3 + 2]!));
  return report;
}

