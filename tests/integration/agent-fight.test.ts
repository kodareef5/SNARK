// The agent fights from range, wears armour, swims, drinks and climbs, through its tools alone, in process.

import { expect, test } from "bun:test";
import { V_WATER } from "../../shared/sim/vitals.ts";
import { play } from "../fixtures/agent.ts";
import { flatGround } from "../fixtures/arena.ts";

test("a bow kills a dodo from range, a crossbow's tranquilizer arrows knock out a raptor, and armour is worn", async () => {
  const p = play();
  const g = flatGround(p.h, 50, 50);
  for (const line of ["enablecheats", `tp ${g.x + 25} ${g.z + 5}`, "god", "kit bow", "kit crossbow", "give arrow_tranq 20", "kit hide"]) await p.typed(line);
  const dodo = p.h.host.spawnCreature("core:dodo", g.x + 25, g.z + 30, 1);
  p.run(500);
  // Nothing it fires, a weapon it does not have, and ammunition it does not take are refused.
  expect(await p.call("attack", { id: `e${dodo}`, with: "rifle" })).toMatchObject({ state: "refused", reason: "you carry no rifle" });
  expect(await p.call("attack", { id: `e${dodo}`, with: "bow", ammo: "dart_tranq" })).toMatchObject({ state: "refused" });
  const shot = await p.call("attack", { id: `e${dodo}`, with: "bow", wait_s: 50 });
  expect(shot).toMatchObject({ state: "done", target: expect.stringMatching(/dead|gone/) });
  expect(shot.hits as number).toBeGreaterThan(0);
  expect(shot.shots as number).toBeGreaterThanOrEqual(shot.hits as number);
  // It shot from range and never closed to strike.
  expect(Math.hypot(p.s.own.x - (g.x + 25), p.s.own.z - (g.z + 30))).toBeGreaterThan(8);
  expect(((await p.call("status")).news as string[]).some((l) => l.startsWith("you killed dodo"))).toBe(true);

  const raptor = p.h.host.spawnCreature("core:raptor", g.x + 25, g.z + 40, 1);
  p.run(300);
  const out = await p.call("attack", { id: `e${raptor}`, with: "crossbow", ammo: "arrow_tranq", until: "out", wait_s: 50 });
  expect(out).toMatchObject({ state: "done", target: "knocked out" });
  const inv = p.h.host.items.inv(p.rec);
  const bow = inv.item.indexOf(p.id("crossbow"));
  expect(inv.ammo[bow]).toBe(p.id("arrow_tranq"));

  // Armour from the bag is worn, and status says where.
  for (const piece of ["hide_shirt", "hide_pants"]) expect(await p.call("use_item", { item: piece })).toMatchObject({ state: "done", used: piece });
  expect((await p.call("status")).worn).toMatchObject({ torso: "hide_shirt", legs: "hide_pants" });
});

test("a pteranodon, which shows no knock-out to those who do not look at it, is brought down from range, fed and tamed", async () => {
  const p = play();
  const g = flatGround(p.h, 50, 50);
  for (const line of ["enablecheats", `tp ${g.x + 25} ${g.z + 5}`, "god", "kit bow", "give meat 2", "setting TamingSpeedMultiplier 60"]) await p.typed(line);
  const e = p.h.host.spawnCreature("core:pteranodon", g.x + 25, g.z + 22, 1);
  p.run(500);
  expect(await p.call("attack", { id: `e${e}`, with: "bow", ammo: "arrow_tranq", until: "out", wait_s: 50 })).toMatchObject({ state: "done", target: "knocked out" });
  // It falls where it was hit, and is fed where it lies.
  p.run(4000);
  expect(await p.call("use_item", { item: "meat", on: `e${e}`, count: 2, wait_s: 50 })).toMatchObject({ state: "done", gave: 2 });
  for (let t = 0; t < 2400 && p.h.world.ents.team[e] !== p.rec.team; t++) p.run(100);
  expect(p.h.world.ents.team[e]).toBe(p.rec.team);
});

test("the agent drinks standing in the pool's shallows, swims across it, and climbs a stair flight to its landing", async () => {
  const p = play();
  await p.typed("enablecheats");
  await p.typed("tp 197 256");
  p.h.host.survival.add(p.rec, V_WATER, -40);
  p.run(500);
  const was = Math.round(p.s.vitals.at(V_WATER, p.s.serverTick) / 1e6);
  expect(await p.call("use_item", { item: "water" })).toMatchObject({ state: "done", used: "water" });
  expect(Math.round(p.s.vitals.at(V_WATER, p.s.serverTick) / 1e6)).toBe(was + 10);
  // Across the pool, swimming its middle.
  const across = await p.call("go_to", { x: 148, z: 256, wait_s: 50 });
  expect(across).toMatchObject({ state: "done" });
  expect(Math.hypot(p.s.own.x - 148, p.s.own.z - 256)).toBeLessThan(0.7);
  await p.typed("tp 256 240");
  p.run(300);
  expect(await p.call("use_item", { item: "water" })).toMatchObject({ state: "refused" });

  // A city's stair flight, 4 m up a 5.5 m run, and the landing it meets at its top, set beside the plaza as the ruins lay them.
  const flight = p.h.reg.index.get("core:zruin_flight_concrete")!;
  const landing = p.h.reg.index.get("core:zruin_landing_concrete")!;
  p.h.world.structs.add(flight, 270.5, 2, 230, 0, 0, 1000);
  p.h.world.structs.add(landing, 270.5, 3.8, 233.5, 0, 0, 1000);
  p.run(600);
  const up = await p.call("go_to", { x: 270.5, z: 233.5, y: 4, wait_s: 50 });
  expect(up).toMatchObject({ state: "done" });
  expect(p.s.own.y).toBeGreaterThan(3.5);
  const seen = await p.call("observe", { radius: 16, cell: 1 });
  expect(seen.self).toMatchObject({ above_ground: expect.any(Number) });
  expect((seen.stairs as unknown[][])[0]!.slice(1, 2)).toEqual(["zruin_flight_concrete"]);
  // And back down to the plaza.
  expect(await p.call("go_to", { x: 262, z: 230, wait_s: 50 })).toMatchObject({ state: "done" });
  expect(p.s.own.y).toBeLessThan(0.5);
});
