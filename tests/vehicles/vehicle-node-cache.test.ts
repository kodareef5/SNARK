import { expect, test } from "bun:test";
import { VehicleNodeCache } from "../../server/vehicle-node-cache.ts";
import type { NodeSource, NodeSpot } from "../../shared/world/nodes.ts";
const spot = (): NodeSpot => ({ kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 });
test("vehicle map memo keeps exact spots, expires on tick or terrain revision, and reuses at most sixteen chunks", () => {
  let reads = 0;
  const source: NodeSource = { perChunk: 256, at(chunk, index, out) {
    reads++; out.kind = index % 2; out.form = index; out.x = chunk * 64 + Math.PI; out.y = Math.SQRT2; out.z = index / 17; out.yaw = 12345;
  } };
  const memo = new VehicleNodeCache(source), out = spot(), expected = spot(); source.at(1, 5, expected); reads = 0;
  memo.begin(10, 0); memo.at(1, 5, out); expect(out).toEqual(expected);
  for (let i = 0; i < 64; i++) memo.at(1, 5, out);
  expect(reads).toBe(1); expect(out).toEqual(expected);
  memo.at(1, 6, out); expect(out.kind).toBe(0); memo.at(1, 6, out); expect(reads).toBe(2);
  memo.begin(11, 0); memo.at(1, 5, out); expect(reads).toBe(3);
  memo.begin(11, 4); memo.at(1, 5, out); expect(reads).toBe(4); expect(out).toEqual(expected);
  for (let chunk = 2; chunk <= 17; chunk++) memo.at(chunk, 5, out);
  expect(reads).toBe(20); memo.at(17, 5, out); expect(reads).toBe(20);
  memo.at(1, 5, out); expect(reads).toBe(21); expect(out).toEqual(expected);
});
