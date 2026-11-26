// Two builds of one place compared for a building's last way from a street (tools/mapworld/access-kept.ts).

import { expect, test } from "bun:test";
import { approachesLost } from "../../tools/mapworld/access-kept.ts";

const built = (id: number, approaches: number) => ({ id, name: null, approaches: Array.from({ length: approaches }, () => ({})) });

test("a building that had an approach and has none is lost; one with fewer, or never any, is not", () => {
  const before = [built(1, 2), built(2, 1), built(3, 0), built(4, 1)];
  const { lost, missing } = approachesLost(before, [built(1, 1), built(2, 0), built(3, 0)]);
  expect(lost.map((r) => r.id)).toEqual([2]);
  expect(missing.map((r) => r.id)).toEqual([4]);
});
