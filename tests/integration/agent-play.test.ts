// An agent that plays: walking, gathering, opening and stopping for danger, in process on the proving ground.

import { expect, test } from "bun:test";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { play, type Play } from "../fixtures/agent.ts";
import { flatGround } from "../fixtures/arena.ts";

/** Runs the world until the running task ends. Returns the metres the body moved on the server and every place it was. */
function follow(p: Play, seconds = 60): { walked: number; trail: [number, number][] } {
  const e = p.h.ent(p.s);
  const ents = p.h.world.ents;
  const trail: [number, number][] = [[ents.x[e]!, ents.z[e]!]];
  let walked = 0;
  for (let t = 0; t < seconds * 20 && p.agent.controller.busy; t++) {
    p.run(50);
    const [x, z] = trail[trail.length - 1]!;
    walked += Math.hypot(ents.x[e]! - x, ents.z[e]! - z);
    trail.push([ents.x[e]!, ents.z[e]!]);
  }
  return { walked, trail };
}

test("walk_to rounds the 24 m wall by a way no more than 1.3 times the best, and one task runs at a time", async () => {
  const p = play();
  expect((await p.ask("tools/list"))!.result.tools.map((t: { name: string }) => t.name)).toEqual(["observe", "walk_to", "harvest", "open", "attack", "pick_up", "put_down", "order", "move_item", "craft", "eat", "say", "place", "bed", "rise", "status", "cancel", "console"]);
  expect((await play({}, {}).ask("tools/list"))!.result.tools.length).toBe(17);
  await p.typed("enablecheats");
  await p.typed("tp 288 258");
  // The wall runs from x 276 to 300 at z 262, so the best way is round either end: twice 12.6 m.
  expect(await p.call("walk_to", { x: 288, z: 266, wait_s: 0 })).toEqual({ state: "running", task: "walk_to", doing: "walking", left_m: 7.4 });
  expect(await p.call("walk_to", { x: 256, z: 240 })).toEqual({ state: "refused", reason: "walk_to is still running: cancel it, or wait for it with status" });
  expect((await p.call("harvest", { id: "n19.2" })).state).toBe("refused");
  const { walked, trail } = follow(p);
  expect(await p.call("status")).toMatchObject({ state: "done", task: "walk_to" });
  expect(walked).toBeGreaterThan(2 * Math.hypot(12, 4));
  expect(walked).toBeLessThan(1.3 * 2 * Math.hypot(12, 4));
  for (let k = 1; k < trail.length; k++) {
    const [x0, z0] = trail[k - 1]!;
    const [x1, z1] = trail[k]!;
    // It crossed the wall's line beyond the wall's end, and nowhere else.
    if (z0 < 262 !== z1 < 262) expect(x0 > 300.3 || x0 < 275.7).toBe(true);
    expect(Math.hypot(x1 - x0, z1 - z0)).toBeLessThan(0.5);
  }
  p.run(500);
  const e = p.h.ent(p.s);
  expect(Math.hypot(p.h.world.ents.x[e]! - 288, p.h.world.ents.z[e]! - 266)).toBeLessThan(0.6);
  expect([p.s.own.x, p.s.own.z]).toEqual([p.h.world.ents.x[e]!, p.h.world.ents.z[e]!]);
  expect([p.agent.controller.plans, p.agent.controller.replans]).toEqual([1, 0]);

  // Into the house by its doorway, and then to a thing by its id: up to the side of the crate south of the house.
  expect(await p.call("walk_to", { x: 240.5, z: 274.5 })).toMatchObject({ state: "done" });
  expect(Math.hypot(p.s.own.x - 240.5, p.s.own.z - 274.5)).toBeLessThan(0.6);
  expect(await p.call("cancel")).toEqual({ state: "done", cancelled: null });
  expect((await p.call("walk_to", { x: 256, z: 240, wait_s: 1 })).state).toBe("running");
  expect(await p.call("cancel")).toEqual({ state: "done", cancelled: "walk_to" });
  expect(await p.call("status")).toMatchObject({ state: "blocked", reason: "cancelled", task: "walk_to" });
  p.run(500);
  const stopped = [p.s.own.x, p.s.own.z];
  p.run(500);
  expect([p.s.own.x, p.s.own.z]).toEqual(stopped);
  for (const bad of [{}, { x: 5 }, { id: "tree" }, { id: "n99999.1" }, { id: "e500" }, { x: 256, z: 9000 }]) expect((await p.call("walk_to", bad)).state).toBe("refused");
});

test("a crate set down in the way forces a new way, and what cannot be reached is said to be blocked", async () => {
  const p = play();
  const c = p.agent.controller;
  const e = p.h.ent(p.s);
  const ents = p.h.world.ents;
  expect((await p.call("walk_to", { x: 256, z: 200, wait_s: 0 })).state).toBe("running");
  p.run(1500);
  expect([c.plans, c.replans]).toEqual([1, 0]);
  const crate = [256, ents.z[e]! - 9];
  p.h.world.structs.add(p.id("crate"), crate[0]!, 0.5, crate[1]!, 0, 0, 200);
  const { trail } = follow(p);
  expect(await p.call("status")).toMatchObject({ state: "done", task: "walk_to", at: [256, 200.5] });
  expect([c.plans, c.replans]).toEqual([2, 1]);
  // It kept clear of the crate, which is half a metre from its middle to its side.
  expect(Math.min(...trail.map(([x, z]) => Math.hypot(x - crate[0]!, z - crate[1]!)))).toBeGreaterThan(0.9);

  // The middle of the pool is nowhere to stand, and the slab at the top of the stairs is on another floor.
  expect(await p.call("walk_to", { x: 172, z: 256 })).toMatchObject({ state: "blocked", reason: "there is no way there on foot" });
  const slab = p.s.world!.structs.chunks.flatMap((t, chunk) => (t ? Array.from({ length: t.high }, (_, slot) => (t.kind[slot] === p.id("slab") ? chunk * 65536 + slot : -1)) : [])).find((ref) => ref >= 0);
  expect((await p.call("walk_to", { id: `s${slab}` })).reason).toContain("on a floor above the ground");
  // Dropped into the pool, it swims out and walks on.
  await p.typed("enablecheats");
  await p.typed("tp 172 256");
  expect(await p.call("walk_to", { x: 214, z: 256, wait_s: 50 })).toMatchObject({ state: "done" });
  expect(Math.hypot(p.s.own.x - 214, p.s.own.z - 256)).toBeLessThan(0.6);

  // A goal 130 m off, in among the trees and rocks, is further than one search reaches: it is walked in legs, each found anew.
  const far = await p.call("walk_to", { x: 250, z: 130, within: 3, wait_s: 50 });
  expect(far).toMatchObject({ state: "done" });
  expect(Math.hypot(p.s.own.x - 250, p.s.own.z - 130)).toBeLessThan(3);
  expect(c.plans).toBeGreaterThan(5);
  expect(p.s.stats.corrections).toBeLessThan(3);
});

test("stuck on what it was never told of, it hops, plans round the place, and the third time says it is blocked", async () => {
  const p = play();
  const c = p.agent.controller;
  // Nine metres of wall the server has and this client loses, as if the news of it had not come.
  const walls = [253, 256, 259].map((x) => p.h.world.structs.add(p.id("wall"), x, 1.5, 228, 0, 0, 10000));
  p.run(300);
  for (const ref of walls) p.s.world!.structs.put(Math.floor(ref / 65536), ref & 0xffff, 0, 0, 0, 0, 0, 0, 0, 1);
  expect((await p.call("walk_to", { x: 256, z: 215, wait_s: 0 })).state).toBe("running");
  follow(p);
  const ended = await p.call("status");
  expect(ended).toMatchObject({ state: "blocked", task: "walk_to", reason: "stuck: something that cannot be walked round is in the way" });
  expect(c.replans).toBeGreaterThanOrEqual(2);
  // It never got past the wall on the server, whatever its own prediction thought.
  expect(p.h.world.ents.z[p.h.ent(p.s)]!).toBeGreaterThan(228.4);
  expect(ended.short_m as number).toBeGreaterThan(12);
});

test("harvest walks to a tree and cuts five wood with a hatchet, and picks a bush clean by hand", async () => {
  const p = play();
  await p.typed("enablecheats");
  await p.typed("give hatchet");
  const seen = await p.call("observe", { radius: 96, cell: 4 });
  const tree = (seen.tree as [string, number, number][])[0]!;
  expect((await p.call("harvest", { id: tree[0], until: { item: "wood", count: 5 }, tool: "axe" })).state).toBe("refused");
  expect(await p.call("harvest", { id: tree[0], tool: "pick" })).toEqual({ state: "refused", reason: "you carry no pick" });
  const cut = await p.call("harvest", { id: tree[0], until: { item: "wood", count: 5 }, tool: "hatchet", wait_s: 50 });
  expect(cut).toMatchObject({ state: "done", node: "standing", task: "harvest" });
  const inv = p.h.host.items.inv(p.rec);
  expect((cut.gathered as Record<string, number>).wood).toBe(inv.total(p.id("wood")));
  expect(inv.total(p.id("wood"))).toBeGreaterThanOrEqual(5);
  expect(inv.total(p.id("wood"))).toBeLessThan(15);
  // The hatchet is in the hand, and is the worse for it.
  const status = await p.call("status");
  expect((status.self as { held: string }).held).toBe("hatchet");
  expect(inv.dur[inv.hotbar]).toBeLessThan(60);
  expect(Math.hypot(p.s.own.x - tree[1], p.s.own.z - tree[2])).toBeLessThan(3);

  // A bush is picked with the use button until it is used up.
  const bush = ((await p.call("observe", { radius: 64 })).bush as [string][])[0]![0];
  const picked = await p.call("harvest", { id: bush, wait_s: 50 });
  expect(picked).toMatchObject({ state: "done", node: "gone" });
  expect((picked.gathered as Record<string, number>).berry).toBeGreaterThanOrEqual(12);
  expect(p.h.host.harvest!.goneCount).toBe(1);
  expect(await p.call("harvest", { id: bush })).toEqual({ state: "refused", reason: `${bush} is used up, or was never there` });
  expect((await p.call("harvest", { id: "s65536" })).state).toBe("refused");
  expect(p.h.host.items.audit()).toEqual([]);
});

test("open walks to a box and opens it, move_item fills it, and a door, a bag and a PIN work as a player's do", async () => {
  const p = play();
  await p.typed("enablecheats");
  await p.typed("give wood 7");
  const structs = p.h.world.structs;
  const box = structs.add(p.id("storage_box"), 250, 0.3125, 244, 0, p.rec.team, 500);
  const door = structs.add(p.id("door_wood"), 262, 1, 244, 0, p.rec.team, 500);
  const theirs = structs.add(p.id("storage_box"), 256, 0.3125, 250, 0, 9999, 500);
  const state = p.h.host.fixtures.ensure(theirs);
  state.lock = 1;
  state.pin = 4321;
  p.run(300);
  expect(await p.call("open", { id: `s${box}` })).toMatchObject({ state: "done", task: "open", box: { name: "storage box", size: 15, slots: [] } });
  expect(await p.call("move_item", { from: "self", slot: 0, to: "box" })).toEqual({ state: "done", moved: "wood", to_slot: 0, left: 0 });
  expect(p.h.host.fixtures.find(box)!.inv!.total(p.id("wood"))).toBe(7);
  expect((await p.call("status")).box).toEqual({ name: "storage box", size: 15, slots: [[0, "wood", 7]] });
  expect(await p.call("move_item", { from: "box", slot: 0, to: "self", count: 3 })).toEqual({ state: "done", moved: "wood", to_slot: 0, left: 4 });
  // Opening the box that is open looks into it again, and does not shut it.
  expect(await p.call("open", { id: `s${box}` })).toMatchObject({ state: "done", box: { slots: [[0, "wood", 4]] } });

  expect(await p.call("open", { id: `s${door}` })).toMatchObject({ state: "done", now: "door_open_wood" });
  expect(structs.chunks[Math.floor(door / 65536)]!.kind[door & 0xffff]).toBe(p.id("door_open_wood"));
  // Walking off shut the box.
  expect((await p.call("status")).box).toBeUndefined();
  expect(await p.call("open", { id: `s${door}` })).toMatchObject({ state: "done", now: "door_wood" });

  expect(await p.call("open", { id: `s${theirs}` })).toMatchObject({ state: "blocked", reason: "it wants its PIN" });
  expect(await p.call("open", { id: `s${theirs}`, pin: 1111 })).toMatchObject({ state: "blocked", reason: "denied" });
  expect(await p.call("open", { id: `s${theirs}`, pin: 4321 })).toMatchObject({ state: "done", box: { name: "storage box" } });

  // Something dropped lies in a bag, which is a body and not a thing built.
  expect(p.h.host.death.drop(p.rec, 0, 2)).toBe(true);
  p.run(300);
  const bag = ((await p.call("observe", { radius: 8 })).box as [string, string][]).find((b) => b[1] === "bag")![0];
  expect(await p.call("open", { id: bag })).toMatchObject({ state: "done", box: { name: "bag", slots: [[0, "wood", 2]] } });
  expect(await p.call("move_item", { from: "box", slot: 0, to: "self" })).toMatchObject({ state: "done", moved: "wood", left: 0 });
  expect(p.h.host.items.inv(p.rec).total(p.id("wood"))).toBe(3);
  const wall = p.s.world!.structs.chunks.flatMap((t, chunk) => (t ? Array.from({ length: t.high }, (_, slot) => (t.kind[slot] === p.id("wall") ? chunk * 65536 + slot : -1)) : [])).find((ref) => ref >= 0);
  expect(await p.call("open", { id: `s${wall}` })).toEqual({ state: "refused", reason: "only a box, a bag or a door can be opened" });

  // A box inside the house, against its south wall. From the south it is a metre off and out of sight, so it is opened from indoors.
  const indoors = structs.add(p.id("storage_box"), 240.5, 0.6125, 270.5, 0, p.rec.team, 500);
  expect(await p.call("walk_to", { x: 240.5, z: 268 })).toMatchObject({ state: "done" });
  expect(await p.call("open", { id: `s${indoors}` })).toMatchObject({ state: "done", box: { name: "storage box" } });
  expect(p.s.own.z).toBeGreaterThan(270.5);
  expect(p.h.host.items.audit()).toEqual([]);
});

test("a hunter coming near stops the task once, and is told of for as long as it is near", async () => {
  const p = play();
  const c = p.agent.controller;
  const e = p.h.ent(p.s);
  const ents = p.h.world.ents;
  // Nothing harms it here, so only the raptor's nearness is tested.
  await p.typed("enablecheats");
  await p.typed("god");
  expect((await p.call("walk_to", { x: 256, z: 180, wait_s: 0 })).state).toBe("running");
  p.run(500);
  const raptor = p.h.host.spawnCreature("core:raptor", ents.x[e]! + 10, ents.z[e]!, 1);
  const stopped = await p.call("status", { wait_s: 10 });
  expect(stopped).toMatchObject({ state: "danger", task: "walk_to", reason: `a raptor (e${raptor}) is 10 m to the W` });
  expect(stopped.dangers).toEqual([`a raptor (e${raptor}) is 10 m to the W`]);
  expect(ents.z[e]).toBeGreaterThan(230);
  expect([c.moveZ, c.buttons]).toEqual([0, 0]);
  // The raptor it has been told of does not stop the next task, though it is still told of.
  const on = await p.call("walk_to", { x: 256, z: 180, wait_s: 50 });
  expect(on).toMatchObject({ state: "done", at: [256, 180.5] });
  expect((on.dangers as string[])[0]).toContain(`a raptor (e${raptor})`);
  expect((await p.call("observe")).dangers).toEqual(on.dangers);
  // A creature is not a box.
  expect((await p.call("open", { id: `e${raptor}` })).state).toBe("refused");
});

test("health falling and death each stop the task, and the survivor wakes again", async () => {
  const p = play();
  const c = p.agent.controller;
  // A twentieth of its health lost within two seconds is a danger, told once while it goes on.
  expect((await p.call("walk_to", { x: 256, z: 180, wait_s: 0 })).state).toBe("running");
  p.run(500);
  p.h.host.survival.add(p.rec, V_HEALTH, -4);
  p.run(500);
  expect(c.busy).toBe("walk_to");
  p.h.host.survival.add(p.rec, V_HEALTH, -4);
  expect(await p.call("status", { wait_s: 5 })).toMatchObject({ state: "danger", reason: "your health is falling: 92 of 100", dangers: ["your health is falling"] });
  expect((await p.call("walk_to", { x: 256, z: 180, wait_s: 0 })).state).toBe("running");
  p.h.host.survival.add(p.rec, V_HEALTH, -20);
  p.run(1000);
  expect(c.busy).toBe("walk_to");
  // Five seconds with no more lost, and it is over.
  p.run(5000);
  expect((await p.call("status")).dangers).toBeUndefined();

  // Death ends the task. The survivor chooses where to rise, as a player does, among the places status lists.
  expect(c.busy).toBe("walk_to");
  await p.typed("suicide");
  expect(await p.call("status", { wait_s: 5 })).toMatchObject({ state: "danger", reason: "you died", self: { alive: false }, choosing: { why: "died" } });
  p.run(2500);
  const { choosing } = (await p.call("status")) as unknown as { choosing: { places: unknown[][] } };
  expect(choosing.places[0]!.slice(0, 3)).toEqual([0, p.h.world.spawns[0]!.name, "spawn point"]);
  expect(await p.call("rise", { place: 0 })).toMatchObject({ state: "done", rose_at: p.h.world.spawns[0]!.name });
  expect(await p.call("status")).toMatchObject({ self: { alive: true, x: 256, z: 240, health: [100, 100] } });
  expect(c.deaths).toBe(1);
  expect(await p.call("walk_to", { x: 250, z: 246 })).toMatchObject({ state: "done" });
});

/** The rows observe lists under a name: id, name, x, z, metres away, direction, then what else is known. */
const rows = async (p: Play, name: string): Promise<unknown[][]> => ((await p.call("observe", { radius: 16 }))[name] as unknown[][] | undefined) ?? [];

test("attack knocks a dodo out with bare hands and then kills it, and the dead one is listed and harvested", async () => {
  const p = play();
  for (const line of ["enablecheats", "destroywilddinos", "spawn dodo 1"]) expect((await p.call("console", { line })).state).toBe("done");
  p.run(300);
  const dodo = (await rows(p, "creature")).find((c) => c[1] === "dodo")!;
  const id = dodo[0] as string;
  expect(dodo.slice(6)).toEqual(["level 1", "wild"]);
  expect((await p.call("attack", { id: "n19.2" })).state).toBe("refused");
  expect((await p.call("attack", { id, until: "soon" })).state).toBe("refused");
  expect((await p.call("harvest", { id })).state).toBe("refused");

  // Three punches put a level 1 dodo to sleep. It runs from the first, and is followed.
  expect(await p.call("attack", { id, until: "out", wait_s: 50 })).toMatchObject({ state: "done", task: "attack", target: "knocked out" });
  expect((await rows(p, "creature")).find((c) => c[0] === id)!.slice(6)).toEqual(["level 1", "wild", "knocked out"]);
  expect(p.h.world.ents.flags[Number(id.slice(1))]! & 1).toBe(1);

  // Until it is dead, which is the default: it leaves the creatures, and a dead dodo lies where it was.
  expect(await p.call("attack", { id, wait_s: 50 })).toMatchObject({ state: "done", task: "attack", target: "gone" });
  expect((await rows(p, "creature")).some((c) => c[1] === "dodo")).toBe(false);
  const body = (await rows(p, "body"))[0]!;
  expect(body[1]).toBe("dead dodo");
  const had = p.rec.inv!.used();
  const got = await p.call("harvest", { id: body[0], wait_s: 50 });
  expect(got).toMatchObject({ state: "done", task: "attack", target: "gone" });
  expect(Object.values(got.gathered as Record<string, number>).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  expect(p.rec.inv!.used()).toBeGreaterThan(had);
  expect(await rows(p, "body")).toEqual([]);
});

test("a dodo, wild or tame, is picked up and put down, a tame one is ordered, and an egg is taken up", async () => {
  const p = play();
  for (const line of ["enablecheats", "destroywilddinos", "spawn dodo 1"]) expect((await p.call("console", { line })).state).toBe("done");
  p.run(300);
  const id = (await rows(p, "creature"))[0]![0] as string;
  const e = Number(id.slice(1));
  const rec = p.h.host.records.byPid.get(p.h.world.ents.pid[e]!)!;
  // A wild one is picked up and set down as a tame one is. Tamed, as forcetame tames the one looked at, it is hers to order.
  expect(await p.call("pick_up", { id })).toMatchObject({ state: "done", holding: "dodo" });
  p.run(300);
  expect(await p.call("put_down")).toMatchObject({ state: "done", set_down: true });
  expect(p.h.host.taming.give(rec, p.rec, 0, "forced")).toBe(true);
  p.run(300);
  expect((await rows(p, "creature"))[0]!.slice(6)).toEqual(["level 1", "yours"]);
  expect(await p.call("pick_up", { id })).toMatchObject({ state: "done", holding: "dodo" });
  p.run(300);
  expect((await rows(p, "creature"))[0]!.slice(6)).toEqual(["level 1", "yours", "carried"]);
  expect(await p.call("put_down")).toMatchObject({ state: "done", set_down: true });
  expect((await p.call("put_down")).state).toBe("blocked");
  expect(await p.call("order", { id, order: "follow" })).toEqual({ state: "done", ordered: "follow", who: id });
  expect(await p.call("order", { order: "passive" })).toEqual({ state: "done", ordered: "passive", who: "every tribe creature in earshot" });
  for (const bad of [{ id, order: "dance" }, { id, order: "attack" }, { id: "n19.2", order: "stay" }, {}]) expect((await p.call("order", bad)).state).toBe("refused");

  // An egg laid beside it is taken into the bag.
  rec.genome!.female = true;
  (p.h.host.breeding as unknown as { lay(mother: typeof rec, father: typeof rec, e: number): void }).lay(rec, rec, e);
  p.run(300);
  // A clutch may be more than one egg: the one taken is gone from the ground and in the bag.
  const eggs = await rows(p, "egg");
  const had = p.rec.inv!.used();
  expect((await p.call("pick_up", { id: eggs[0]![0] })).state).toBe("done");
  expect(p.rec.inv!.used()).toBe(had + 1);
  p.run(300);
  expect((await rows(p, "egg")).map((r) => r[0])).toEqual(eggs.slice(1).map((r) => r[0]));
});

test("beds as a player has them: it builds two, names them, dies and rises at one, travels to the other leaving what it carried, and rises once at a sleeping bag", async () => {
  const p = play();
  const g = flatGround(p.h, 40, 40);
  await p.typed("enablecheats");
  await p.typed(`tp ${g.x + 10} ${g.z + 6}`);
  for (const [item, n] of [["piece_foundation_wood", 2], ["piece_bed", 2]] as const) await p.typed(`give ${item} ${n}`);
  // A simple bed is refused on the ground, and goes on a foundation.
  expect(await p.call("place", { item: "piece_bed", x: g.x + 10, z: g.z + 12 })).toMatchObject({ state: "blocked" });
  const a = (await p.call("place", { item: "piece_foundation_wood", x: g.x + 10, z: g.z + 12 })) as unknown as { id: string };
  const home = (await p.call("place", { item: "piece_bed", on: a.id })) as unknown as { state: string; id: string };
  expect(home).toMatchObject({ state: "done", placed: "bed" });
  const b = (await p.call("place", { item: "piece_foundation_wood", x: g.x + 30, z: g.z + 30 })) as unknown as { id: string };
  const outpost = (await p.call("place", { item: "piece_bed", on: b.id })) as unknown as { id: string };
  expect(await p.call("bed", { id: home.id, do: "name", name: "Home" })).toMatchObject({ state: "done" });
  expect(await p.call("bed", { id: outpost.id, do: "name", name: "Outpost" })).toMatchObject({ state: "done" });

  // It dies and rises at Home, by its name.
  await p.typed("suicide");
  const dead = (await p.call("status", { wait_s: 2 })) as unknown as { choosing: { why: string; places: unknown[][] } };
  expect([dead.choosing.why, dead.choosing.places.slice(-2).map((r) => r.slice(1, 3))]).toEqual(["died", [["Home", "bed"], ["Outpost", "bed"]]]);
  expect(await p.call("rise", { place: "Home" })).toMatchObject({ state: "done", rose_at: "Home" });
  // Home now waits five minutes.
  await p.typed("suicide");
  const waiting = (await p.call("status", { wait_s: 2 })) as unknown as { choosing: { places: unknown[][] } };
  expect(waiting.choosing.places.find((r) => r[1] === "Home")![5]).toBeGreaterThan(280);
  expect(await p.call("rise", { place: "Home" })).toMatchObject({ state: "blocked" });
  expect(await p.call("rise", { place: "Outpost" })).toMatchObject({ state: "done" });

  // From Outpost it travels to Home once Home is ready, with stone it carries: the stone stays at Outpost, in a bag.
  p.h.host.fixtures.find(Number(home.id.slice(1)))!.readyAt = 0;
  await p.typed("give stone 30");
  expect(await p.call("bed", { id: outpost.id, do: "travel" })).toMatchObject({ state: "done" });
  const travelling = (await p.call("status", { wait_s: 1 })) as unknown as { self: { alive: boolean }; choosing: { why: string; places: unknown[][] } };
  expect([travelling.self.alive, travelling.choosing.why, travelling.choosing.places.map((r) => r[1])]).toEqual([false, "travelling from a bed", ["Outpost", "Home"]]);
  expect(await p.call("rise", { place: "Home" })).toMatchObject({ state: "done", rose_at: "Home" });
  expect(await p.call("status")).toMatchObject({ inventory: [] });
  const bags = [...p.h.host.records.byPid.values()].filter((r) => r.kind === p.id("bag") && (r.inv?.total(p.id("stone")) ?? 0) === 30);
  expect([bags.length, Math.round(bags[0]!.x), Math.round(bags[0]!.z), p.h.host.items.audit()]).toEqual([1, Math.round(g.x + 30), Math.round(g.z + 30), []]);

  // A sleeping bag on the ground: risen at once, and gone.
  await p.typed("give piece_sleeping_bag 1");
  const bag = (await p.call("place", { item: "piece_sleeping_bag", x: g.x + 6, z: g.z + 14 })) as unknown as { id: string };
  await p.typed("suicide");
  await p.call("status", { wait_s: 2 });
  expect(await p.call("rise", { place: "hide sleeping bag" })).toMatchObject({ state: "done" });
  const ref = Number(bag.id.slice(1));
  expect(p.h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]).toBe(0);
});
