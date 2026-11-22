import { expect, test } from "bun:test";
import { provingView } from "../../tools/snap.ts";

test("damage to a piece neither rebuilds nor uploads the chunk it is drawn with, and a row that repeats a piece leaves the grid alone", () => {
  const view = provingView(320, 180);
  const crate = view.reg.index.get("core:crate")!;
  const ref = view.structs.add(crate, 256, 0.5, 250, 0, 0, 100);
  const chunk = Math.floor(ref / 65536);
  const slot = ref & 0xffff;
  const t = view.structs.chunks[chunk]!;
  view.render();
  expect(view.render().uploads.length).toBe(0);

  // As the server does it.
  const shape = t.shape;
  view.structs.damage(ref, 10);
  expect([t.hp[slot], t.shape]).toEqual([90, shape]);
  expect(view.render().uploads.length).toBe(0);

  // As a client is told of it: the whole row again, then the chunk's new version.
  view.structs.put(chunk, slot, crate, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, 7, 55, t.version + 1);
  view.structs.setVersion(chunk, t.version + 1);
  expect([t.hp[slot], t.owner[slot], t.mod[slot], t.shape]).toEqual([55, 7, t.version, shape]);
  expect(view.render().uploads.length).toBe(0);

  // A row that moves the piece is a change of shape.
  view.structs.put(chunk, slot, crate, t.x[slot]! + 1, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, 7, 55, t.version + 1);
  view.structs.setVersion(chunk, t.version + 1);
  expect(t.shape).toBeGreaterThan(shape);
  expect(view.render().uploads.map((u) => u.buffer)).toEqual([chunk]);

  // The free list is rebuilt when the authority next adds: the slot of a removed piece is used again.
  const other = view.structs.add(crate, 258, 0.5, 250, 0, 0, 100);
  view.structs.put(chunk, other & 0xffff, 0, 0, 0, 0, 0, 0, 0, t.version + 1);
  view.structs.setVersion(chunk, t.version + 1);
  expect(view.structs.add(crate, 259, 0.5, 250, 0, 0, 100)).toBe(other);
});
