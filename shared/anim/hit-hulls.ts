// Bone-local convex pieces refine fine weapon contacts. Each plane stores its
// outward unit normal and its distance from the bone's joint, in metres.
import { len3 } from "../math/scalar.ts";
import type { PackHitSurface } from "../pack/pack.ts";

export interface HitPiece {
  readonly box: Float32Array;
  readonly planes: Float32Array;
}
export interface BoneHitHulls {
  readonly zone: number;
  readonly pieces: HitPiece[];
  readonly box: Float32Array;
}
export interface HitSurfaces {
  readonly replace: Uint8Array;
  readonly bone: readonly (BoneHitHulls | undefined)[];
}

function below(bone: number, root: number, parent: ArrayLike<number>): boolean {
  for (let i = bone; i >= 0; i = parent[i]!) {
    if (i === root) return true;
    if (!(parent[i]! < i)) break;
  }
  return false;
}

/** Ignore an incomplete replacement as a whole, keeping the rig's capsules. */
export function loadHitSurfaces(specs: readonly PackHitSurface[] | undefined, parent: ArrayLike<number>, zones: Uint8Array): HitSurfaces | undefined {
  if (!Array.isArray(specs) || !specs.length) return;
  const bone: (BoneHitHulls | undefined)[] = Array(parent.length);
  const replace = new Uint8Array(parent.length);
  for (const spec of specs) {
    if (!spec || !Number.isInteger(spec.root) || zones[spec.root] !== spec.zone || !spec.zone || !Array.isArray(spec.bones) || !spec.bones.length) return;
    const seen = new Set<number>();
    for (const row of spec.bones) {
      if (!row || !Number.isInteger(row.bone) || row.bone < 0 || row.bone >= parent.length || !below(row.bone, spec.root, parent) || seen.has(row.bone) || bone[row.bone] || !Array.isArray(row.pieces) || !row.pieces.length) return;
      seen.add(row.bone);
      const pieces: HitPiece[] = [];
      const box = Float32Array.of(Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity);
      for (const p of row.pieces) {
        if (!p || !Array.isArray(p.box) || p.box.length !== 6 || !p.box.every(Number.isFinite) || !Array.isArray(p.planes) || p.planes.length % 4) return;
        for (let k = 0; k < 6; k += 2) {
          if (p.box[k]! > p.box[k + 1]!) return;
          box[k] = Math.min(box[k]!, p.box[k]!);
          box[k + 1] = Math.max(box[k + 1]!, p.box[k + 1]!);
        }
        for (let k = 0; k < p.planes.length; k += 4) {
          const len = len3(p.planes[k]!, p.planes[k + 1]!, p.planes[k + 2]!);
          if (!(Math.abs(1 - len) < .002) || !Number.isFinite(p.planes[k + 3])) return;
        }
        pieces.push({ box: Float32Array.from(p.box), planes: Float32Array.from(p.planes) });
      }
      bone[row.bone] = { zone: spec.zone, box, pieces };
    }
    for (let b = 0; b < parent.length; b++) if (zones[b] === spec.zone && below(b, spec.root, parent)) replace[b] = 1;
  }
  return { replace, bone };
}

const interval = new Float64Array(2);
function boxRay(box: Float32Array, o: Float64Array, d: Float64Array, maxT: number, pad: number): boolean {
  let enter = 0, exit = maxT;
  for (let a = 0; a < 3; a++) {
    const lo = box[a * 2]! - pad - o[a]!, hi = box[a * 2 + 1]! + pad - o[a]!, v = d[a]!;
    if (Math.abs(v) < 1e-10) {
      if (lo > 0 || hi < 0) return false;
    } else {
      const t0 = lo / v, t1 = hi / v;
      enter = Math.max(enter, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
      if (exit < enter) return false;
    }
  }
  interval[0] = enter; interval[1] = exit;
  return true;
}

/** The first entry into the union. The tight boxes also bound each piece
 * along the model axes; padding expands every supporting plane. */
export function rayHulls(hulls: BoneHitHulls, o: Float64Array, d: Float64Array, maxT: number, padding: number): number {
  if (!boxRay(hulls.box, o, d, maxT, padding)) return -1;
  let nearest = -1;
  for (const piece of hulls.pieces) {
    if (!boxRay(piece.box, o, d, nearest >= 0 ? nearest : maxT, padding)) continue;
    let entry = interval[0]!, exit = interval[1]!;
    const planes = piece.planes;
    for (let k = 0; k < planes.length; k += 4) {
      const x = planes[k]!, y = planes[k + 1]!, z = planes[k + 2]!;
      const v = x * d[0]! + y * d[1]! + z * d[2]!, dist = planes[k + 3]! + padding - x * o[0]! - y * o[1]! - z * o[2]!;
      if (v < -1e-10) entry = Math.max(entry, dist / v);
      else if (v > 1e-10) exit = Math.min(exit, dist / v);
      else if (dist < 0) { exit = -1; break; }
      if (exit < entry) break;
    }
    if (entry <= exit) {
      nearest = entry;
      if (nearest === 0) break;
    }
  }
  return nearest;
}
