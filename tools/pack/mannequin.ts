// The mannequin: a body made of the skeleton's own hit boxes.
//
// One box per bone that can be hit, each following its bone, cut into the five
// body slots like any other body. It stands in for a modelled body until one is
// converted, and it is the picture of what the server hits: a shot that lands
// on a box of this mesh lands in that zone.

import { B_HEAD, HUMAN, SLOT_COUNT, SLOT_FEET, SLOT_HANDS, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "./write.ts";

export const MANNEQUIN = "core:mannequin";

/** Palette colours of the parts that do not take the body's own colour. */
const SKIN = 10;
const SHOE = 4;
const NOSE = 3;

interface Part {
  positions: number[];
  colors: number[];
  bones: number[];
  indices: number[];
}

function addBox(part: Part, bone: number, cx: number, cy: number, cz: number, half: readonly [number, number, number], color: number): void {
  const box = boxMesh(half, color);
  const base = part.positions.length / 3;
  for (let v = 0; v < box.positions.length / 3; v++) {
    part.positions.push(box.positions[v * 3]! + cx, box.positions[v * 3 + 1]! + cy, box.positions[v * 3 + 2]! + cz);
    part.colors.push(color);
    part.bones.push(bone);
  }
  for (const i of box.indices) part.indices.push(base + i);
}

/** One mesh per body slot, ids "core:mannequin/head" and so on. */
export function mannequinMeshes(): SourceMesh[] {
  const parts: Part[] = Array.from({ length: SLOT_COUNT }, () => ({ positions: [], colors: [], bones: [], indices: [] }));
  const s = HUMAN;
  for (let b = 0; b < s.zoneBones; b++) {
    if (s.zone[b] === 0) continue;
    const slot = s.slot[b]!;
    const color = slot === SLOT_HEAD || slot === SLOT_HANDS ? SKIN : slot === SLOT_FEET ? SHOE : REGION_BASE;
    const half: [number, number, number] = [s.boxHalf[b * 3]!, s.boxHalf[b * 3 + 1]!, s.boxHalf[b * 3 + 2]!];
    addBox(parts[slot]!, b, s.rest[b * 3]! + s.boxCenter[b * 3]!, s.rest[b * 3 + 1]! + s.boxCenter[b * 3 + 1]!, s.rest[b * 3 + 2]! + s.boxCenter[b * 3 + 2]!, half, color);
  }
  // A nose, so that which way it faces can be seen.
  const hx = s.rest[B_HEAD * 3]! + s.boxCenter[B_HEAD * 3]!;
  const hy = s.rest[B_HEAD * 3 + 1]! + s.boxCenter[B_HEAD * 3 + 1]!;
  const hz = s.rest[B_HEAD * 3 + 2]! + s.boxCenter[B_HEAD * 3 + 2]! + s.boxHalf[B_HEAD * 3 + 2]!;
  addBox(parts[SLOT_HEAD]!, B_HEAD, hx, hy - 0.02, hz + 0.02, [0.02, 0.03, 0.02], NOSE);
  return parts.map((p, slot) => {
    const lod: SourceLod = { positions: Float32Array.from(p.positions), colors: Uint8Array.from(p.colors), indices: Uint32Array.from(p.indices), bones: Uint8Array.from(p.bones) };
    return { id: `${MANNEQUIN}/${SLOT_NAMES[slot]}`, lods: [lod], skeleton: HUMAN.id };
  });
}
