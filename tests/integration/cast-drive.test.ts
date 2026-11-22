import { expect, test } from "bun:test";
import type { Story } from "../../shared/cast/state.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a car comes in out of sight, its driver picks a friend up at the curb, and both go away unseen", () => {
  // Flat open ground of 512 m, a one-chunk ring: room out of sight to come and go by car.
  const h = new Harness({ entityRadius: 1 }, 5, 30, { cast: { enabled: false, hostility: 0 }, wakeRadius: 1, map: writeMap(flatMap(8)) });
  const ana = h.join("Ana");
  h.run(1500);
  const cast = h.host.cast!;
  cast.stage.logging = true;
  const c = h.client(ana)!;
  const x = c.body.x + 40, z = c.body.z + 30;
  const spot = cast.cast.spots.add({ x, z, tags: ["parking", "road"], cap: 4 });
  const s: Story = { id: "pickup", scene: "cast:drive_to_meet", spot, x, z, region: cast.cast.spots.regionAt(x, z), phase: "planned", parts: [], choices: {}, slots: {}, for: [], engaged: [], importance: 0, made: 0, since: 0, planned: 0, history: [] };
  cast.cast.stories.set(s.id, s);
  cast.cast.wake(s, h.world.tick, [{ name: "Ana", x: c.body.x, z: c.body.z }]);
  expect(s.phase).toBe("entering");
  const lines: string[] = [];
  const say = h.host.chat.npcSay.bind(h.host.chat);
  h.host.chat.npcSay = (n, px, py, pz, t, r) => (lines.push(`${n}: ${t}`), say(n, px, py, pz, t, r));
  h.run(120_000, () => cast.stage.step([{ name: "Ana", x: c.body.x, z: c.body.z }]));
  expect(cast.stage.counts.cars).toBe(1);
  expect(cast.stage.counts.arrived).toBe(1);
  expect(lines.length).toBeGreaterThan(0);
  // Everyone came and went where Ana could not see.
  expect(cast.stage.log.filter((l) => l.what === "in").length).toBe(2);
  expect(cast.stage.log.filter((l) => l.seen)).toEqual([]);
  h.run(120_000, () => cast.stage.step([{ name: "Ana", x: c.body.x, z: c.body.z }]));
  expect(cast.stage.log.filter((l) => l.what === "out").length).toBe(2);
  expect([...h.host.records.byPid.values()].some((r) => r.extra.has(90))).toBe(false);
});
