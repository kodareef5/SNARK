// The frond glider's wings as code makes them, for a pack built without the art (planning/workstreams/glider.md): a spar,
// a handle and a row of fronds as flat boxes, one wing on the prop bone of each hand. The modelled wings
// (assets/source/core/items/frond-glider) take their place under the same ids (tools/pack/build.ts, withArt). Both are made
// to shared/anim/glide-clips.ts: a wing's grip is its origin, its axes are the model's when it lies flat (+X the body's
// left, +Z ahead), and its root at the lashing is GLIDER_ROOT_IN toward the body's middle and GLIDER_ROOT_UP above.

import { GLIDER_ROOT_IN, GLIDER_ROOT_UP } from "../../shared/anim/glide-clips.ts";
import { B_PROP_L, B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "./write.ts";

const WOOD = 228;
const FIBER = 224;
const FROND = 17;
const FROND_DRY = 18;

/** Metres from the root to the tip along the spar, and how far the fronds reach behind it and ahead of it. */
export const WING_SPAN = 1.72;
const TRAIL = 1.15;
const LEAD = 0.16;
const FRONDS = 9;

type Box = readonly [cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: number];

/** One wing: `side` is 1 for the left hand's, whose tip is toward +X, and -1 for the right's. */
function wing(side: 1 | -1): Box[] {
  const boxes: Box[] = [
    // The handle, fore and aft through the grip, and the two short struts that carry the spar over it.
    [0, 0, 0, 0.016, 0.016, 0.09, WOOD],
    [0, GLIDER_ROOT_UP / 2, 0.07, 0.01, GLIDER_ROOT_UP / 2, 0.01, WOOD],
    [0, GLIDER_ROOT_UP / 2, -0.07, 0.01, GLIDER_ROOT_UP / 2, 0.01, WOOD],
    // The lashing where the two wings meet.
    [-side * GLIDER_ROOT_IN, GLIDER_ROOT_UP, 0, 0.03, 0.03, 0.05, FIBER],
  ];
  // The spar from the root to the tip, bowed up a little along its length, in short straight pieces.
  const pieces = 6;
  const bow = (t: number): number => 0.09 * 4 * t * (1 - t) - 0.05 * t * t;
  for (let i = 0; i < pieces; i++) {
    const t0 = i / pieces, t1 = (i + 1) / pieces, tm = (t0 + t1) / 2;
    const x = side * (-GLIDER_ROOT_IN + tm * WING_SPAN);
    boxes.push([x, GLIDER_ROOT_UP + bow(tm), -0.06 * tm, (WING_SPAN / pieces) / 2 + 0.004, 0.014 - tm * 0.004, 0.014 - tm * 0.004, WOOD]);
  }
  // The fronds, lashed along the spar and lying back from it like feathers, the outer ones shorter and drooping.
  for (let i = 0; i < FRONDS; i++) {
    const t = (i + 0.5) / FRONDS;
    const x = side * (-GLIDER_ROOT_IN + 0.06 + t * (WING_SPAN - 0.1));
    const back = TRAIL * (1 - 0.35 * t * t);
    const y = GLIDER_ROOT_UP + bow(t) - 0.012 - 0.05 * t;
    boxes.push([x, y, (LEAD - back) / 2 - 0.06 * t, WING_SPAN / FRONDS / 2 + 0.012, 0.006, (LEAD + back) / 2, i % 3 === 1 ? FROND_DRY : FROND]);
  }
  return boxes;
}

function build(boxes: readonly Box[], bone: number): SourceLod {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [cx, cy, cz, hx, hy, hz, color] of boxes) {
    const b = boxMesh([hx, hy, hz], color);
    const base = positions.length / 3;
    for (let v = 0; v < b.positions.length; v += 3) positions.push(b.positions[v]! + cx, b.positions[v + 1]! + cy, b.positions[v + 2]! + cz);
    for (const c of b.colors) colors.push(c);
    for (const i of b.indices) indices.push(base + i);
  }
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices), bones: new Uint8Array(positions.length / 3).fill(bone) };
}

/** Ids are the mesh ids the glider's class row names (shared/content/classes.ts, item/glider). */
export function gliderMeshes(): SourceMesh[] {
  return [
    { id: "core:frond_glider/wing_l", lods: [build(wing(1), B_PROP_L)], skeleton: HUMAN.id },
    { id: "core:frond_glider/wing_r", lods: [build(wing(-1), B_PROP_R)], skeleton: HUMAN.id },
  ];
}
