import { expect, test } from "bun:test";
import { stageWalls } from "../../tools/pieces/tek-preview.ts";
import { flatWorld } from "../fixtures/world.ts";

test("two Tek walls and a Metal wall stand on one rotated base", () => {
  const w = flatWorld(8);
  const walls = stageWalls(w);
  const frame = w.structs.frameAt(walls[0]!);
  expect(frame).toBeGreaterThan(0);
  expect(walls.map((ref) => w.structs.frameAt(ref))).toEqual([frame, frame, frame]);
  expect(walls.map((ref) => w.reg.defs[w.structs.chunks[ref >>> 16]!.kind[ref & 65535]!]!.id)).toEqual(["core:wall_tek", "core:wall_tek", "core:wall_metal"]);
});
