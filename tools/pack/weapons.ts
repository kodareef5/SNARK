// A held mesh follows the prop bone of the hand that holds it, with the grip at the origin. In the right hand its length
// runs along +Z and +Y is its top. A bow in the left hand has its limbs along Y and shoots along +X. Projectiles point along +Z.

import { B_PROP_L, B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "./write.ts";

const WOOD = 228;
const WOOD_LIGHT = 227;
const METAL = 2;
const DARK = 11;
const SLATE = 4;
const STRING = 10;
const STONE = 15;
const HIDE = 226;
const FIBER = 224;

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

function held(id: string, bone: number, boxes: readonly Box[]): SourceMesh {
  return { id, lods: [build(boxes, bone)], skeleton: HUMAN.id };
}

/** The limbs are short straight pieces along Y, with their ends drawn back toward the archer at -X. */
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

/** A knotted branch, thickest at the head, with fibre bound round the grip. */
function club(): Box[] {
  return [
    [0, 0, 0.11, 0.017, 0.017, 0.2, WOOD],
    [0, 0, 0.01, 0.021, 0.021, 0.07, FIBER],
    [0, 0, 0.35, 0.026, 0.026, 0.06, WOOD_LIGHT],
    [0, 0, 0.5, 0.042, 0.04, 0.11, WOOD_LIGHT],
    [0, 0, 0.62, 0.032, 0.03, 0.02, WOOD_LIGHT],
    [0.032, 0.02, 0.47, 0.02, 0.018, 0.026, WOOD],
    [-0.028, -0.026, 0.55, 0.018, 0.016, 0.022, WOOD],
    [0.01, 0.036, 0.4, 0.014, 0.014, 0.018, WOOD],
  ];
}

/** A forked stick held upright, the band drawn back from its prongs toward the shooter at -X to a hide pouch. */
function slingshot(): Box[] {
  return [
    [0, -0.03, 0, 0.017, 0.075, 0.017, WOOD],
    [0, 0.055, 0, 0.016, 0.014, 0.05, WOOD],
    [0, 0.115, 0.042, 0.013, 0.05, 0.013, WOOD_LIGHT],
    [0, 0.115, -0.042, 0.013, 0.05, 0.013, WOOD_LIGHT],
    [-0.05, 0.15, 0.03, 0.05, 0.004, 0.004, HIDE],
    [-0.05, 0.15, -0.03, 0.05, 0.004, 0.004, HIDE],
    [-0.105, 0.15, 0, 0.012, 0.014, 0.034, HIDE],
  ];
}

/** Ids are the mesh ids that content names. */
export function weaponMeshes(): SourceMesh[] {
  return [
    held("core:hatchet", B_PROP_R, [[0, 0, 0.12, 0.014, 0.014, 0.23, WOOD], [0, 0.03, 0.3, 0.01, 0.065, 0.045, STONE]]),
    held("core:pick", B_PROP_R, [[0, 0, 0.12, 0.014, 0.014, 0.23, WOOD], [0, 0, 0.32, 0.012, 0.16, 0.025, STONE]]),
    held("core:spear", B_PROP_R, [[0, 0, 0.35, 0.012, 0.012, 0.95, WOOD], [0, 0, 1.37, 0.022, 0.006, 0.09, STONE]]),
    held("core:club", B_PROP_R, club()),
    held("core:bow", B_PROP_L, bow()),
    held("core:slingshot", B_PROP_L, slingshot()),
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
    // The origin is at the head, so a stuck arrow stands out of what it hit.
    { id: "core:arrow", lods: [build([[0, 0, -0.36, 0.006, 0.006, 0.36, WOOD_LIGHT], [0, 0, 0.02, 0.014, 0.004, 0.03, STONE], [0, 0, -0.66, 0.003, 0.03, 0.05, STRING], [0, 0, -0.66, 0.03, 0.003, 0.05, STRING]], null)] },
    { id: "core:dart", lods: [build([[0, 0, -0.07, 0.005, 0.005, 0.08, METAL], [0, 0, -0.16, 0.014, 0.014, 0.03, 9]], null)] },
    { id: "core:stone_shot", lods: [build([[0, 0, 0, 0.02, 0.017, 0.022, STONE], [0.006, 0.008, -0.004, 0.015, 0.014, 0.016, SLATE]], null)] },
    // The blast is a cube a metre across, scaled to the size of the explosion when drawn.
    { id: "core:grenade_thrown", lods: [build([[0, 0.05, 0, 0.04, 0.05, 0.04, 7], [0, 0.11, 0, 0.014, 0.014, 0.014, METAL]], null)] },
    { id: "core:blast", lods: [build([[0, 0, 0, 0.5, 0.5, 0.5, 6]], null)] },
    // The tracer is a metre long along +Z from the origin, scaled to the length of the shot when drawn.
    { id: "core:tracer", lods: [build([[0, 0, 0.5, 0.006, 0.006, 0.5, 6]], null)] },
  ];
}
