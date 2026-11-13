// Meshes of things held in the hand, written as code: a few boxes each, in the
// game's palette. Enough to read at a glance what someone is holding and where
// it points.
//
// A held thing follows one bone, the prop bone of the hand that holds it, and
// is modelled in that bone's space with the grip at the origin. In the
// skeleton's T-pose the right arm runs along -X with the palm down, so:
//
//   right hand   the thing's length runs along +Z (a tool's head, a barrel's
//                muzzle), and +Y is its top. With the arm hanging, it points
//                forward; raised to the shoulder, it points where the body looks.
//   left hand    a bow: its limbs run along Y and it shoots along +X, which is
//                where the left arm points, so it is upright and aimed when
//                that arm is held out.
//
// Arrows and darts in flight are rigid meshes of their own, pointing along +Z.

import { B_PROP_L, B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "./write.ts";

const WOOD = 228;
const WOOD_LIGHT = 227;
const METAL = 2;
const DARK = 11;
const SLATE = 4;
const STRING = 10;
const STONE = 15;

/** Boxes gathered into one level of detail. Each: centre, half extents, colour. */
type Box = readonly [cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: number];

function build(boxes: readonly Box[], bone: number | null): SourceLod {
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
  const lod: SourceLod = { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
  if (bone !== null) lod.bones = new Uint8Array(positions.length / 3).fill(bone);
  return lod;
}

/** A thing held: follows a prop bone of the humanoid skeleton. */
function held(id: string, bone: number, boxes: readonly Box[]): SourceMesh {
  return { id, lods: [build(boxes, bone)], skeleton: HUMAN.id };
}

/** A bow's limbs as short straight pieces along Y, their ends drawn back toward the archer at -X; then its string. */
function bow(): Box[] {
  const boxes: Box[] = [[0, 0, 0, 0.022, 0.09, 0.02, WOOD]];
  const pieces = 5;
  const reach = 0.68;
  const back = (y: number): number => -0.2 * (y / reach) * (y / reach);
  for (const side of [1, -1]) {
    for (let i = 0; i < pieces; i++) {
      const y0 = 0.09 + ((reach - 0.09) * i) / pieces;
      const y1 = 0.09 + ((reach - 0.09) * (i + 1)) / pieces;
      const ym = (y0 + y1) / 2;
      boxes.push([back(ym), ym * side, 0, 0.014 + Math.abs(back(y1) - back(y0)) / 2, (y1 - y0) / 2 + 0.004, 0.016 - i * 0.002, WOOD_LIGHT]);
    }
  }
  boxes.push([back(reach), 0, 0, 0.003, reach, 0.003, STRING]);
  return boxes;
}

/** Every held thing and every thing that flies, by the mesh id content names. */
export function weaponMeshes(): SourceMesh[] {
  return [
    held("core:hatchet", B_PROP_R, [[0, 0, 0.12, 0.014, 0.014, 0.23, WOOD], [0, 0.03, 0.3, 0.01, 0.065, 0.045, STONE]]),
    held("core:pick", B_PROP_R, [[0, 0, 0.12, 0.014, 0.014, 0.23, WOOD], [0, 0, 0.32, 0.012, 0.16, 0.025, STONE]]),
    held("core:spear", B_PROP_R, [[0, 0, 0.35, 0.012, 0.012, 0.95, WOOD], [0, 0, 1.37, 0.022, 0.006, 0.09, STONE]]),
    held("core:bow", B_PROP_L, bow()),
    held("core:crossbow", B_PROP_R, [[0, -0.01, 0.12, 0.02, 0.028, 0.34, WOOD], [0, 0.02, 0.42, 0.3, 0.01, 0.016, WOOD_LIGHT], [0, 0.03, 0.2, 0.004, 0.004, 0.22, STRING], [0, -0.07, -0.02, 0.014, 0.05, 0.02, WOOD]]),
    held("core:rifle", B_PROP_R, [
      [0, -0.035, -0.22, 0.02, 0.05, 0.16, WOOD],
      [0, 0, 0.1, 0.022, 0.032, 0.2, WOOD],
      [0, 0.022, 0.62, 0.011, 0.011, 0.36, METAL],
      [0, 0.03, 0.02, 0.016, 0.014, 0.1, SLATE],
      [0.03, 0.03, -0.03, 0.02, 0.008, 0.008, DARK],
    ]),
    held("core:pistol", B_PROP_R, [[0, -0.035, 0, 0.014, 0.055, 0.02, WOOD], [0, 0.035, 0.07, 0.014, 0.022, 0.11, SLATE], [0, 0.04, 0.2, 0.008, 0.008, 0.03, DARK]]),
    held("core:grenade", B_PROP_R, [[0, 0, 0.03, 0.04, 0.05, 0.04, 7], [0, 0.06, 0.03, 0.014, 0.014, 0.014, METAL]]),
    // In flight: the head leads along +Z, the origin at the head so that a stuck one stands out of what it hit.
    { id: "core:arrow", lods: [build([[0, 0, -0.36, 0.006, 0.006, 0.36, WOOD_LIGHT], [0, 0, 0.02, 0.014, 0.004, 0.03, STONE], [0, 0, -0.66, 0.003, 0.03, 0.05, STRING], [0, 0, -0.66, 0.03, 0.003, 0.05, STRING]], null)] },
    { id: "core:dart", lods: [build([[0, 0, -0.07, 0.005, 0.005, 0.08, METAL], [0, 0, -0.16, 0.014, 0.014, 0.03, 9]], null)] },
  ];
}
