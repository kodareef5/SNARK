// The agent tames, saddles and rides a raptor, flies a pteranodon and drives a car, through its tools alone, in process.

import { expect, test } from "bun:test";
import { MODE_FLYER, MODE_WALK } from "../../shared/sim/character.ts";
import { play, type Play } from "../fixtures/agent.ts";
import { flatGround } from "../fixtures/arena.ts";

/** The rows observe lists under a name: id, name, x, z, metres away, direction, then what else is known. */
const rows = async (p: Play, name: string, radius = 32): Promise<unknown[][]> => ((await p.call("observe", { radius }))[name] as unknown[][] | undefined) ?? [];

/** Runs the world until `done` holds, at most `seconds`. */
function until(p: Play, done: () => boolean, seconds: number): boolean {
  for (let t = 0; t < seconds * 10 && !done(); t++) p.run(100);
  return done();
}

test("a raptor knocked out with a club, fed raw meat, named, saddled and ridden, all through the tools", async () => {
  const p = play();
  const g = flatGround(p.h, 40, 40);
  for (const line of ["enablecheats", `tp ${g.x + 20} ${g.z + 8}`, "god", "give club 1", "give meat 3", "give saddle_raptor 1", "setting TamingSpeedMultiplier 60"]) await p.typed(line);
  const e = p.h.host.spawnCreature("core:raptor", g.x + 20, g.z + 20, 1);
  p.run(500);
  const id = `e${e}`;
  expect((await rows(p, "creature")).find((r) => r[0] === id)!.slice(6, 8)).toEqual(["level 1", "hunts"]);
  // Refusals first: it is awake, and nothing is put into an awake wild creature.
  expect(await p.call("use_item", { item: "meat", on: id })).toMatchObject({ state: "refused" });
  expect(await p.call("mount", { id })).toMatchObject({ state: "refused" });

  expect(await p.call("attack", { id, with: "club", until: "out", wait_s: 50 })).toMatchObject({ state: "done", target: "knocked out" });
  const fed = await p.call("use_item", { item: "meat", on: id, count: 2 });
  expect(fed).toMatchObject({ state: "done", gave: 2, creature: { taming: "0%" } });
  expect((fed.box as { slots: unknown[][] }).slots).toEqual([[0, "meat", 2]]);
  // It eats when it is a piece's worth short of full, and at sixty times one piece tames it.
  expect(until(p, () => p.h.world.ents.team[e] === p.rec.team, 90)).toBe(true);
  const told = await p.call("status");
  expect((told.news as string[]).some((l) => l.includes(`tamed: a level`) && l.includes(id))).toBe(true);
  expect((await rows(p, "creature")).find((r) => r[0] === id)!.slice(6, 8)).toEqual(["level 1", "yours"]);

  expect(await p.call("order", { id, order: "name", name: "Blue" })).toMatchObject({ state: "done", named: "Blue" });
  expect(await p.call("use_item", { item: "saddle_raptor", on: id })).toMatchObject({ state: "done", used: "saddle_raptor", creature: { saddled: true, yours: true } });
  p.run(300);
  expect((await rows(p, "creature")).find((r) => r[0] === id)!.slice(8)).toEqual(["saddled", "named Blue"]);

  expect(await p.call("mount", { id })).toMatchObject({ state: "done", riding: `Blue (${id})`, steering: true });
  expect(p.s.driving).toBe(e);
  // Riding, go_to rides: twenty metres north, the mount carrying the survivor.
  const to = { x: g.x + 20, z: g.z + 38 };
  expect(await p.call("go_to", { ...to, wait_s: 50 })).toMatchObject({ state: "done", task: "go_to" });
  expect(Math.hypot(p.h.world.ents.x[e]! - to.x, p.h.world.ents.z[e]! - to.z)).toBeLessThan(1.2);
  expect((await p.call("status")).self).toMatchObject({ riding: `Blue (${id})` });
  expect(await p.call("mount", { id })).toMatchObject({ state: "refused", reason: "you already ride something: mount with off first" });
  expect(await p.call("mount", { off: true })).toMatchObject({ state: "done", off: true });
  expect(p.s.driving).toBe(-1);
  expect(await p.call("mount", { off: true })).toMatchObject({ state: "refused", reason: "you ride nothing" });
});

/** A saddled tame of the survivor's tribe beside it, made as the server would once it was tamed and saddled. */
function tame(p: Play, species: string, x: number, z: number): number {
  const e = p.h.host.spawnCreature(`core:${species}`, x, z, 1);
  const rec = p.h.host.records.byPid.get(p.h.world.ents.pid[e]!)!;
  expect(p.h.host.taming.give(rec, p.rec, 1, "forced")).toBe(true);
  rec.saddle = p.id(`saddle_${species}`);
  p.h.host.refreshBody(rec);
  p.h.host.creatures.mind.stay(e, 0xffffffff);
  return e;
}

test("a pteranodon is mounted, flown sixty metres over the ground and set down there, and got off", async () => {
  const p = play();
  const g = flatGround(p.h, 40, 80);
  await p.typed("enablecheats");
  await p.typed(`tp ${g.x + 20} ${g.z + 6}`);
  const e = tame(p, "pteranodon", g.x + 20, g.z + 9);
  p.run(500);
  expect(await p.call("mount", { id: `e${e}` })).toMatchObject({ state: "done", steering: true });
  // Its stamina comes back once it has stood a while.
  p.run(2000);
  const to = { x: g.x + 20, z: g.z + 70 };
  const flown = await p.call("go_to", { ...to, wait_s: 50 });
  expect(flown).toMatchObject({ state: "done", landed: true });
  expect(p.s.own.mode).toBe(MODE_WALK);
  expect(Math.hypot(p.h.world.ents.x[e]! - to.x, p.h.world.ents.z[e]! - to.z)).toBeLessThan(5);
  // Up again, it stays in the air when asked, and hovers.
  expect(await p.call("go_to", { x: g.x + 20, z: g.z + 50, land: false, wait_s: 50 })).toMatchObject({ state: "done", hovering: true });
  p.run(2000);
  expect(p.s.own.mode).toBe(MODE_FLYER);
  expect(await p.call("go_to", { x: g.x + 20, z: g.z + 40, wait_s: 50 })).toMatchObject({ state: "done", landed: true });
  expect(await p.call("mount", { off: true })).toMatchObject({ state: "done" });
});

test("a flight whose straight line meets the plaza's obelisk climbs over its 90 m and sets down beyond it", async () => {
  const p = play();
  await p.typed("enablecheats");
  await p.typed("god");
  await p.typed("tp 340 172");
  const e = tame(p, "pteranodon", 340, 175);
  p.run(500);
  expect(await p.call("mount", { id: `e${e}` })).toMatchObject({ state: "done" });
  p.run(2000);
  let top = 0;
  const flying = p.call("go_to", { x: 340, z: 250, wait_s: 50 });
  for (let t = 0; t < 600 && p.agent.controller.busy; t++) {
    p.run(100);
    top = Math.max(top, p.h.world.ents.y[e]!);
  }
  expect(await flying).toMatchObject({ state: "done", landed: true });
  expect(top).toBeGreaterThan(90);
  expect(Math.hypot(p.h.world.ents.x[e]! - 340, p.h.world.ents.z[e]! - 250)).toBeLessThan(6);
});

test("a car is found by observe, got into, driven forty metres and got out of", async () => {
  const p = play();
  const g = flatGround(p.h, 40, 70);
  await p.typed("enablecheats");
  await p.typed(`tp ${g.x + 20} ${g.z + 4}`);
  const car = p.h.host.spawnVehicle("core:compact", g.x + 20, g.z + 10, 0, 0);
  p.run(500);
  const listed = await rows(p, "car");
  expect(listed[0]!.slice(0, 2)).toEqual([`e${car}`, "compact"]);
  expect(listed[0]!.slice(6)).toEqual(["empty", "anyone's"]);
  expect(await p.call("mount", { id: `e${car}` })).toMatchObject({ state: "done", steering: true });
  expect(p.s.own.vehicle).toBe(true);
  const to = { x: g.x + 20, z: g.z + 55 };
  expect(await p.call("go_to", { ...to, wait_s: 50 })).toMatchObject({ state: "done" });
  expect(Math.hypot(p.h.world.ents.x[car]! - to.x, p.h.world.ents.z[car]! - to.z)).toBeLessThan(4.5);
  // Back where it came from, behind it: it backs round, then drives.
  const back = { x: g.x + 20, z: g.z + 20 };
  expect(await p.call("go_to", { ...back, wait_s: 50 })).toMatchObject({ state: "done" });
  expect(Math.hypot(p.h.world.ents.x[car]! - back.x, p.h.world.ents.z[car]! - back.z)).toBeLessThan(4.5);
  expect(await p.call("mount", { off: true })).toMatchObject({ state: "done" });
  expect(p.s.driving).toBe(-1);
  // Out of it, the way to the car's far side goes round its hull, which the way finders do not see.
  const e = p.h.ent(p.s);
  const [cx, cz] = [p.h.world.ents.x[car]!, p.h.world.ents.z[car]!];
  const beyond = { x: cx + (cx - p.h.world.ents.x[e]!) * 2.5, z: cz + (cz - p.h.world.ents.z[e]!) * 2.5 };
  expect(await p.call("go_to", { ...beyond, wait_s: 50 })).toMatchObject({ state: "done" });
});
