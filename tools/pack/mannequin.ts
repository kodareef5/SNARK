// The mannequin is a body made of the skeleton's own hit capsules, cut into the five body slots. It stands in where
// the pack has no modelled body, and it shows what the server hits.

import { B_HEAD, HUMAN, SLOT_COUNT, SLOT_FEET, SLOT_HANDS, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

export const MANNEQUIN = "core:mannequin";

/** Palette colours of the parts that do not take the body's own colour. */
const SKIN = 10;
const SHOE = 4;
const VISOR = 3;
/** Sides around a capsule, and rings in each of its round ends. */
const SIDES = 8;
const RINGS = 2;

interface Part {
  positions: number[];
  colors: number[];
  bones: number[];
  indices: number[];
}

/** The faces touch the true surface at their corners and lie slightly inside it at their middles, so nothing drawn is outside what can be hit. */
function addCapsule(part: Part, bone: number, a: readonly number[], b: readonly number[], r: number, color: number): void {
  // An axis along the capsule and two across it.
  let ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const length = Math.hypot(ux, uy, uz);
  if (length < 1e-6) {
    ux = 0;
    uy = 1;
    uz = 0;
  } else {
    ux /= length;
    uy /= length;
    uz /= length;
  }
  const hx = Math.abs(ux) < 0.9 ? 1 : 0, hy = Math.abs(ux) < 0.9 ? 0 : 1;
  let vx = uy * 0 - uz * hy, vy = uz * hx - ux * 0, vz = ux * hy - uy * hx;
  const vl = Math.hypot(vx, vy, vz);
  vx /= vl;
  vy /= vl;
  vz /= vl;
  const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
  const base = part.positions.length / 3;
  const push = (cx: number, cy: number, cz: number, along: number, out: number, turn: number): void => {
    const c = Math.cos(turn) * out, s = Math.sin(turn) * out;
    part.positions.push(cx + ux * along + vx * c + wx * s, cy + uy * along + vy * c + wy * s, cz + uz * along + vz * c + wz * s);
    part.colors.push(color);
    part.bones.push(bone);
  };
  // Rings run from the tip at a to the tip at b.
  const rows = 2 * (RINGS + 1);
  for (let row = 0; row < rows; row++) {
    const atA = row <= RINGS;
    const lat = atA ? (-Math.PI / 2) * (1 - row / RINGS) : (Math.PI / 2) * ((row - RINGS - 1) / RINGS);
    const centre = atA ? a : b;
    for (let side = 0; side < SIDES; side++) push(centre[0]!, centre[1]!, centre[2]!, Math.sin(lat) * r, Math.cos(lat) * r, (side / SIDES) * Math.PI * 2);
  }
  for (let row = 0; row + 1 < rows; row++) {
    for (let side = 0; side < SIDES; side++) {
      const i0 = base + row * SIDES + side, i1 = base + row * SIDES + ((side + 1) % SIDES);
      const j0 = i0 + SIDES, j1 = i1 + SIDES;
      // Row 0 and the last row are single points repeated, so their degenerate triangles are skipped.
      if (row > 0) part.indices.push(i0, j1, i1);
      if (row + 2 < rows) part.indices.push(i0, j0, j1);
    }
  }
}

/** One mesh per body slot, ids "core:mannequin/head" and so on. */
export function mannequinMeshes(): SourceMesh[] {
  const parts: Part[] = Array.from({ length: SLOT_COUNT }, () => ({ positions: [], colors: [], bones: [], indices: [] }));
  const s = HUMAN;
  const end = (ends: Float32Array, b: number): number[] => [0, 1, 2].map((k) => s.rest[b * 3 + k]! + ends[b * 3 + k]!);
  for (let b = 0; b < s.zoneBones; b++) {
    if (s.zone[b] === 0) continue;
    const slot = s.slot[b]!;
    const color = slot === SLOT_HEAD || slot === SLOT_HANDS ? SKIN : slot === SLOT_FEET ? SHOE : REGION_BASE;
    addCapsule(parts[slot]!, b, end(s.capA, b), end(s.capB, b), s.capR[b]!, color);
  }
  // A visor across the front of the head shows which way the mannequin faces.
  const head = end(s.capB, B_HEAD);
  const r = s.capR[B_HEAD]!;
  addCapsule(parts[SLOT_HEAD]!, B_HEAD, [head[0]! - r * 0.45, head[1]!, head[2]! + r * 0.78], [head[0]! + r * 0.45, head[1]!, head[2]! + r * 0.78], r * 0.2, VISOR);
  return parts.map((p, slot) => {
    const lod: SourceLod = { positions: Float32Array.from(p.positions), colors: Uint8Array.from(p.colors), indices: Uint32Array.from(p.indices), bones: Uint8Array.from(p.bones) };
    return { id: `${MANNEQUIN}/${SLOT_NAMES[slot]}`, lods: [lod], skeleton: HUMAN.id };
  });
}
