// The soul balls as code makes them, for a pack built without the art (planning/workstreams/soul-ball.md): a small pod of
// boxes in the right hand, its lamp dark on the empty one and lit on the full. The modelled balls
// (assets/source/core/items/soul-ball) take their place under the same ids (tools/pack/build.ts, withArt). A held mesh
// follows its hand's prop bone, the grip at the origin and its length along +Z (tools/pack/weapons.ts).
//
// And the flash of a tame going into a ball or coming out of one (client/core/shots.ts): a faceted gem a metre across in
// the lamp's blue, drawn at the size of the tame's body, closing to nothing or opening from it. It has no art to take
// its place.

import { B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "./write.ts";

const PALETTE = defaultPalette();
/** The Meridian finish's colours (assets/source/core/humans/human-bodies/meridian/finish.py), as the palette has them. */
const CERAMIC = nearestColour(PALETTE, 236, 236, 229);
const BRASS = nearestColour(PALETTE, 201, 129, 57);
const DARK = nearestColour(PALETTE, 25, 72, 119);
const LAMP = nearestColour(PALETTE, 119, 229, 255);

type Box = readonly [cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: number];

function pod(lamp: number): Box[] {
  return [
    [0, 0, 0.02, 0.05, 0.05, 0.075, CERAMIC],
    [0, 0, 0.02, 0.054, 0.054, 0.012, BRASS],
    [0, 0, 0.105, 0.03, 0.03, 0.014, BRASS],
    [0, 0, 0.125, 0.02, 0.02, 0.01, lamp],
    [0, 0, -0.06, 0.03, 0.03, 0.008, BRASS],
  ];
}

function build(boxes: readonly Box[]): SourceLod {
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
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices), bones: new Uint8Array(positions.length / 3).fill(B_PROP_R) };
}

/** A gem of twenty flat faces, its points half a metre from its middle, in one colour. */
function gem(color: number): SourceLod {
  const g = (1 + Math.sqrt(5)) / 2;
  const points = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]].map((p) => p.map((v) => (v * 0.5) / Math.hypot(1, g)));
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // Each face has corners of its own, so that it is lit flat.
  const positions = faces.flatMap((f) => f.flatMap((i) => points[i]!));
  return { positions: Float32Array.from(positions), colors: new Uint8Array(faces.length * 3).fill(color), indices: Uint32Array.from(positions.slice(0, faces.length * 3).map((_, i) => i)) };
}

/** Ids are the mesh ids the balls' weapon facets name (content/items/balls.ts), and the flash the client draws (BALL_FLASH). */
export function ballMeshes(): SourceMesh[] {
  return [
    { id: "core:soul_ball", lods: [build(pod(DARK))], skeleton: HUMAN.id },
    { id: "core:soul_ball_full", lods: [build(pod(LAMP))], skeleton: HUMAN.id },
    { id: "core:soul_flash", lods: [gem(LAMP)] },
  ];
}
