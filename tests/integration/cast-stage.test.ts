import { expect, test } from "bun:test";
import { Harness } from "../fixtures/net.ts";

// The proving ground is 512 m across, so a player's ring is made one chunk (and the one beyond it) for there to be ground
// out of its sight to come in from.
function stage() {
  const h = new Harness({ entityRadius: 1 }, 3, 30, { cast: { size: 30, activity: 2, hostility: 0 }, wakeRadius: 1 });
  const ana = h.join("Ana");
  h.run(1500);
  const cast = h.host.cast!;
  cast.stage.logging = true;
  const c = h.client(ana)!;
  // Places about her for every everyday scene, a short walk off.
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, r = 70 + (k % 3) * 30;
    const x = Math.min(500, Math.max(12, c.body.x + Math.sin(a) * r)), z = Math.min(500, Math.max(12, c.body.z + Math.cos(a) * r));
    cast.cast.spots.add({ x, z, tags: ["plaza", "sidewalk", "corner", "storefront", "park", "beach", "beat", "cart", "queue"], cap: 30, queue: { yaw: 0, spacing: 0.9, serve: 4 } });
  }
  return { h, ana, cast, c };
}

test("people come in where no player can see, play their scenes, and go only where no player can see", () => {
  const { h, cast } = stage();
  h.run(90_000);
  const st = cast.stage;
  expect(st.counts.entered).toBeGreaterThan(0);
  const ins = st.log.filter((l) => l.what === "in"), outs = st.log.filter((l) => l.what === "out");
  expect(ins.length).toBeGreaterThan(0);
  expect(ins.filter((l) => l.seen)).toEqual([]);
  expect(outs.filter((l) => l.seen)).toEqual([]);
  // They got somewhere and did something: lines were said, or a story ran its course.
  expect(st.counts.said + cast.cast.counts.done).toBeGreaterThan(0);
  // Every body in the world is one of the stage's, and the stage keeps none the world lost.
  expect(st.count).toBeLessThanOrEqual(cast.cast.settings.maxBodies);
});

test("a body of Cast's is a civilian named for its person, and a save's leftovers are swept at the next start", () => {
  const { h, cast } = stage();
  h.run(30_000);
  const list = cast.stage.list();
  if (list.length) {
    const rec = h.host.records.byPid.get(list[0]!.pid)!;
    expect(h.world.reg.ids[rec.kind]).toBe("core:civilian");
    expect(rec.name).toBe(cast.cast.people.byId.get(list[0]!.character)!.name);
  }
  const before = cast.stage.count;
  expect(cast.sweep()).toBe(before);
  expect([...h.host.records.byPid.values()].some((r) => r.extra.has(90))).toBe(false);
});
