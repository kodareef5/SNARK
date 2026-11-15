import { expect, test } from "bun:test";
import { boxMesh } from "../../tools/pack/write.ts";
import { rankSprays } from "../../tools/pack/sprays.ts";

/** A card a metre square at (x, y, z) facing +z, both sides, as four corners and four triangles from `first`. */
function card(x: number, y: number, z: number, first: number): { positions: number[]; indices: number[] } {
  const positions = [x - 0.5, y - 0.5, z, x + 0.5, y - 0.5, z, x + 0.5, y + 0.5, z, x - 0.5, y + 0.5, z];
  // Each side has corners of its own, as the leaf cards do.
  const back = positions.slice();
  const [a, b, c, d] = [first, first + 1, first + 2, first + 3];
  const [e, f, g, h] = [first + 4, first + 5, first + 6, first + 7];
  return { positions: [...positions, ...back], indices: [a, b, c, a, c, d, e, g, f, e, h, g] };
}

test("a crown's cut-out triangles are put best seen first: outside its opaque heads before inside them", () => {
  // An opaque head 2 m on a side, a card deep inside it, one out in the open beside it, one behind a wall of it.
  const head = boxMesh([1, 1, 1], 7);
  const positions = [...head.positions];
  const indices = [...head.indices];
  let at = positions.length / 3;
  const firsts: number[] = [];
  for (const [x, y, z] of [[0, 0, 0], [3, 0, 0], [0, 0, -1.6]] as const) {
    const c = card(x, y, z, at);
    firsts.push(indices.length);
    positions.push(...c.positions);
    indices.push(...c.indices);
    at += 8;
  }
  const idx = Uint32Array.from(indices);
  const opaque = head.indices.length;
  rankSprays(Float32Array.from(positions), idx, [0, 0, opaque, 1, opaque, indices.length - opaque], (m) => m === 1);
  // The card in the open comes first, whole; the one inside the head last.
  const order = [0, 1, 2].map((k) => Array.from(idx.subarray(opaque + k * 12, opaque + k * 12 + 12)));
  expect(order[0]).toEqual(indices.slice(firsts[1]!, firsts[1]! + 12));
  expect(order[2]).toEqual(indices.slice(firsts[0]!, firsts[0]! + 12));
  // The opaque run is as it was, and every triangle is still there once.
  expect(Array.from(idx.subarray(0, opaque))).toEqual(Array.from(head.indices));
  expect([...idx].sort((a, b) => a - b)).toEqual([...indices].sort((a, b) => a - b));
});
