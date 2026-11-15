// Servers of one cluster, two or three in one process with one folder: survivors travel between them with what they carry,
// and nothing is lost or made twice whichever server stops, is restored from a backup, or is raced (planning/architecture/transfers.md).

import { afterAll, expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { arrivalOf } from "../../client/core/travel.ts";
import { KEY_TRAVEL_BUTTON } from "../../client/core/ui/travel.ts";
import { TICKET_SECONDS } from "../../server/cluster/cluster.ts";
import { clusterList } from "../../server/main.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { REJECT_TRAVEL } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { rollWild } from "../../shared/sim/genome.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { TestCluster, beat, commit, crash, from, keyAt, places, rec, shift, travel } from "../fixtures/cluster.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const t = new TestCluster();
afterAll(() => t.cleanup());
const reg = t.reg;
const id = (name: string): number => t.id(name);
const server = t.server.bind(t);
const audit = t.audit.bind(t);
const survivor = t.survivor.bind(t);

test("a survivor goes from one map to another and back with its level, engrams, look, tribe and all it carries, while its base and tames stay", () => {
  const clock = { ms: Date.now() };
  const a = server("Island", "trip", clock);
  const b = server("Miami", "trip", clock);
  expect([a.world, b.world]).toEqual([1, 2]);
  const ada = a.h.join("ada", {}, { key: keyAt("ada", 1) });
  a.h.run(300);
  const me = rec(a, "ada")!;
  const { items, tribes, records } = a.h.host;
  expect(tribes.create(me, "Raptors")).toBe("");
  const team = me.team;
  // A team means the same on every server of the cluster: the world that made it is in its number.
  expect(Math.floor(team / (1 << 20))).toBe(1);
  me.xp = 12345;
  me.engrams.push(id("engram-waterskin"));
  const look = me.look!.slice();
  items.mint(me, id("stone"), 40);
  items.mint(me, id("hatchet"), 1, 3);
  const inv = items.inv(me);
  const hatchet = inv.item.indexOf(id("hatchet"));
  items.wear(me, hatchet, 7);
  items.mint(me, id("hatchet"), 1, 2, 0, -1, "", FLAG_BLUEPRINT);
  items.mint(me, id("berry"), 10);
  const berry = inv.item.indexOf(id("berry"));
  const spoilLeft = inv.spoilAt[berry]! - a.h.world.tick;
  // A fertilised egg taken up: its item stands for its record, which goes with it.
  const egg = records.create(id("egg_dodo"), "dodo egg");
  egg.genome = rollWild(new Rng(5), 5, reg.colorSet[id("dodo")]!);
  egg.x = a.h.world.ents.x[a.h.ent(ada)]! + 1;
  egg.z = a.h.world.ents.z[a.h.ent(ada)]!;
  egg.y = a.h.world.hf.heightAt(egg.x, egg.z);
  egg.egg = { species: id("dodo"), span: 9000, hatchAt: a.h.world.tick + 9000, carrier: 0 };
  a.h.host.death.place(egg);
  expect(a.h.host.eggs.takeUp(me, egg)).toBe(0);
  const eggLeft = egg.egg.hatchAt;
  // A base and a tame stay behind, the tribe's.
  const wall = a.h.world.structs.add(id("wall"), 250, 1.5, 230, 0, team, 500);
  const pet = a.h.host.records.byPid.get(a.h.world.ents.pid[a.h.host.spawnCreature("core:dodo", 240, 240, 4)]!)!;
  pet.team = team;
  a.h.run(300);
  const carried = new Map(items.held(me));
  const pid = me.pid;
  // It leaves from a dozen metres off the spawn point.
  const stood = shift(a, ada, 10, 7);
  expect(Math.hypot(stood[0] - a.h.world.spawn.x, stood[1] - a.h.world.spawn.z)).toBeGreaterThan(10);
  const hunger = -me.vitals!.rate[V_FOOD]!;
  const fed = me.vitals!.at(V_FOOD, a.h.world.tick);
  expect(hunger).toBeGreaterThan(0);
  expect(audit(a, b)).toEqual([]);

  const ticket = travel(a, ada, b.world);
  expect(ticket).toBeInstanceOf(Uint8Array);
  expect([records.byPid.has(pid), records.byPid.has(egg.pid), ada.state]).toEqual([false, false, "closed"]);
  expect(items.audit()).toEqual([]);
  // Away from the island, the tribe there lists nobody and is gone; its base and tame keep their team.
  expect([tribes.byId.has(team), a.h.world.structs.chunks[Math.floor(wall / 65536)]!.owner[wall & 0xffff], pet.team]).toEqual([false, team, team]);
  expect(audit(a, b)).toEqual([]);

  clock.ms += 30_000;
  beat(a, b);
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket: ticket as Uint8Array });
  b.h.run(400);
  expect(there.state).toBe("active");
  const at = rec(b, "ada")!;
  expect([at.pid, at.xp, at.engrams.includes(id("engram-waterskin")), [...at.look!], at.team]).toEqual([pid, 12345, true, [...look], team]);
  expect(b.h.host.tribes.of(at)).toMatchObject({ id: team, name: "Raptors", owner: pid });
  const binv = b.h.host.items.inv(at);
  expect(new Map(b.h.host.items.held(at))).toEqual(carried);
  const h2 = binv.item.indexOf(id("hatchet"));
  expect([binv.quality[h2], binv.dur[h2]]).toEqual([3, inv.dur[hatchet]!]);
  expect(binv.flags.includes(FLAG_BLUEPRINT)).toBe(true);
  // The berries spoil on: what was left less the half minute in transit.
  const b2 = binv.item.indexOf(id("berry"));
  expect(Math.abs(binv.spoilAt[b2]! - b.h.world.tick - (spoilLeft - 30 * TICK_RATE))).toBeLessThanOrEqual(TICK_RATE);
  const held = b.h.host.records.byPid.get(egg.pid)!;
  expect([held.egg!.carrier, held.egg!.hatchAt, binv.ref![binv.item.indexOf(id("dodo_egg_fertile"))]]).toEqual([egg.pid, eggLeft, egg.pid]);
  // Where it arrives is the map's spawn point.
  expect(Math.hypot(b.h.world.ents.x[b.h.ent(there)]! - b.h.world.spawn.x, b.h.world.ents.z[b.h.ent(there)]! - b.h.world.spawn.z)).toBeLessThan(8);
  // Its own clock stopped while it was away, as a survivor's does out of the world: the half minute cost it no food.
  expect(fed - at.vitals!.at(V_FOOD, b.h.world.tick)).toBeLessThan(hunger * 2 * TICK_RATE);
  expect(b.h.host.items.audit()).toEqual([]);
  expect(audit(a, b)).toEqual([]);

  // And back, with the egg and all, to the island's spawn point as any arrival: not to where it stood when it left.
  b.h.run(1000);
  beat(a, b);
  const back = travel(b, there, a.world);
  expect(back).toBeInstanceOf(Uint8Array);
  commit(a, b);
  const home = a.h.join("ada", {}, { key: keyAt("ada", 1), ticket: back as Uint8Array });
  a.h.run(400);
  expect(home.state).toBe("active");
  const again = rec(a, "ada")!;
  expect([again.pid, again.xp, again.team, again.rank]).toEqual([pid, 12345, team, 2]);
  expect(new Map(items.held(again))).toEqual(carried);
  expect([from(a, home, [a.h.world.spawn.x, a.h.world.spawn.z]) < 8, from(a, home, stood) > 10]).toEqual([true, true]);
  expect(tribes.of(again)).toMatchObject({ id: team, name: "Raptors", owner: pid });
  expect(a.h.host.tribes.may(again, a.h.world.structs.chunks[Math.floor(wall / 65536)]!.owner[wall & 0xffff]!)).toBe(true);
  expect(a.h.host.tribes.may(again, pet.team)).toBe(true);
  // On Miami the tribe is gone with its one member.
  expect(b.h.host.tribes.byId.has(team)).toBe(false);
  expect(audit(a, b)).toEqual([]);
  // Both saves record both transfers, each a burn on leaving and a mint on arriving.
  expect(a.h.host.persistence!.transferRows.map((t) => t.dir)).toEqual([0, 1]);
  expect(b.h.host.persistence!.transferRows.map((t) => t.dir)).toEqual([1, 0]);
  expect([items.sent[id("stone")], items.received[id("stone")], b.h.host.items.sent[id("stone")], b.h.host.items.received[id("stone")]]).toEqual([40, 40, 40, 40]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("the page lists the other servers on L, leaves for one on a click, and goes to its address with the ticket, where the survivor arrives", async () => {
  const clock = { ms: Date.now() };
  const a = server("Island", "page", clock);
  const b = server("Miami", "page", clock);
  b.h.host.cluster!.listening(8812, "");
  beat(a, b);
  const app = new App(a.h.join("ada", { latencyMs: 20 }, { manual: true, key: keyAt("ada", 1) }), a.h.reg, parsePack(corePackBytes()));
  const went: string[] = [];
  app.page = { origin: "http://localhost:8811", protocol: "http:", hostname: "localhost", go: (url) => void went.push(url), arrived: () => {}, cluster: async () => clusterList(a.h.host) };
  const run = (ms: number): void => a.h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  a.h.host.items.mint(rec(a, "ada")!, id("stone"), 40);
  app.key("KeyL", true);
  app.key("KeyL", false);
  run(100);
  await Promise.resolve();
  run(100);
  const row = app.ui.frame.find(KEY_TRAVEL_BUTTON)!;
  expect([row.text, row.interactive]).toEqual(["Miami (proving:1), 0 of 70", true]);
  app.pointer(0, KEY_TRAVEL_BUTTON, 0, 0, 0);
  run(600);
  await Promise.resolve();
  run(100);
  expect(went.length).toBe(1);
  expect(went[0]!.startsWith("http://localhost:8812/#travel=")).toBe(true);
  // The page there reads its ticket and its name from the address.
  const arrival = arrivalOf(went[0]!.slice(went[0]!.indexOf("#")))!;
  expect(arrival.name).toBe("ada");
  const there = b.h.join(arrival.name, {}, { key: keyAt("ada", 2), ticket: arrival.ticket });
  b.h.run(400);
  expect(there.state).toBe("active");
  expect(b.h.host.items.held(rec(b, "ada")!).get(id("stone"))).toBe(40);
  expect(audit(a, b)).toEqual([]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("the source killed after it sealed a survivor and before it saved gives it up again as it starts, and its owner or time takes it back", () => {
  const clock = { ms: Date.now() };
  const a = server("Island", "kill-source", clock);
  const b = server("Miami", "kill-source", clock);
  const folder = b.h.host.cluster!.folder;
  const { session, me } = survivor(a, "ada");
  const pid = me.pid;
  const carried = new Map(a.h.host.items.held(me));
  const stood = shift(a, session, -9, 6);
  expect(audit(a, b)).toEqual([]);
  beat(a, b);
  // Sealed and out of the world, and the server dies before the commit after which the page would have had its ticket.
  expect(a.h.host.cluster!.leave(a.h.client(session)!, b.world)).toBe("");
  crash(a);
  expect(places(pid, folder, b)).toEqual(["sealed"]);
  const a2 = server("Island", "kill-source", clock);
  expect(a2.log.some((l) => l.startsWith("ada left for Miami by transfer") && l.includes("which this save did not know: given up again"))).toBe(true);
  expect(places(pid, folder, a2, b)).toEqual(["sealed"]);
  expect(audit(a2, b)).toEqual([]);
  // The page never had its ticket. Its owner joins the island again and has it back whole.
  const again = a2.h.join("ada", {}, { key: keyAt("ada", 1) });
  a2.h.run(400);
  expect(again.state).toBe("active");
  expect(new Map(a2.h.host.items.held(rec(a2, "ada")!))).toEqual(carried);
  // It never went anywhere, so it stands where it stood, as after a logout.
  expect(from(a2, again, stood)).toBeLessThan(1);
  expect(places(pid, folder, a2, b)).toEqual(["world 1"]);
  expect(audit(a2, b)).toEqual([]);
  // Once more, and nobody comes: past its ticket's time the island takes it back by itself.
  beat(a2, b);
  expect(a2.h.host.cluster!.leave(a2.h.client(again)!, b.world)).toBe("");
  crash(a2);
  const a3 = server("Island", "kill-source", clock);
  expect(places(pid, folder, a3, b)).toEqual(["sealed"]);
  clock.ms += TICKET_SECONDS * 1000;
  beat(a3, b);
  expect(places(pid, folder, a3, b)).toEqual(["world 1"]);
  expect(a3.log.some((l) => l === "ada's ticket to Miami ran out unused, so ada is back here")).toBe(true);
  expect(audit(a3, b)).toEqual([]);
  a3.h.host.shutdown();
  b.h.host.shutdown();
});

test("the source killed once its survivor's leaving is saved changes nothing: the ticket is out, and the survivor arrives", () => {
  const clock = { ms: Date.now() };
  const a = server("Island", "kill-saved", clock);
  const b = server("Miami", "kill-saved", clock);
  const folder = b.h.host.cluster!.folder;
  const { session, me } = survivor(a, "ada");
  const pid = me.pid;
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  crash(a);
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  expect(there.state).toBe("active");
  const a2 = server("Island", "kill-saved", clock);
  expect(a2.log.filter((l) => l.includes("did not know"))).toEqual([]);
  expect(places(pid, folder, a2, b)).toEqual(["world 2"]);
  expect(audit(a2, b)).toEqual([]);
  a2.h.host.shutdown();
  b.h.host.shutdown();
});

test("the destination killed after it took a survivor and before it saved takes it in again as it starts, and the page joins with its ticket", () => {
  const clock = { ms: Date.now() };
  const a = server("Island", "kill-dest", clock);
  const b = server("Miami", "kill-dest", clock);
  const folder = b.h.host.cluster!.folder;
  const { session, me } = survivor(a, "ada");
  const pid = me.pid;
  const carried = new Map(a.h.host.items.held(me));
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  expect(b.h.host.cluster!.arrive("ada", keyAt("ada", 2), ticket)).toBe("");
  crash(b);
  const b2 = server("Miami", "kill-dest", clock);
  expect(b2.log.some((l) => l.startsWith("ada came from Island by transfer") && l.endsWith("which this save did not know: taken in again"))).toBe(true);
  expect(places(pid, folder, a, b2)).toEqual(["world 2"]);
  expect(audit(a, b2)).toEqual([]);
  // The page tries again with the ticket it has: it is let in, and nothing moves.
  const there = b2.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b2.h.run(400);
  expect(there.state).toBe("active");
  expect(new Map(b2.h.host.items.held(rec(b2, "ada")!))).toEqual(carried);
  // Killed after it saved, it has the survivor at its start, and the page joins with no ticket at all.
  b2.h.run(400);
  crash(b2);
  const b3 = server("Miami", "kill-dest", clock);
  expect(b3.log.filter((l) => l.includes("did not know"))).toEqual([]);
  const later = b3.h.join("ada", {}, { key: keyAt("ada", 2) });
  b3.h.run(400);
  expect(later.state).toBe("active");
  expect(places(pid, folder, a, b3)).toEqual(["world 2"]);
  expect(audit(a, b3)).toEqual([]);
  a.h.host.shutdown();
  b3.h.host.shutdown();
});

test("the source killed while it takes a survivor back takes it in again as it starts, and the ticket it had sent is refused", () => {
  const clock = { ms: Date.now() };
  const a = server("Island", "kill-back", clock);
  const b = server("Miami", "kill-back", clock);
  const folder = b.h.host.cluster!.folder;
  const { session, me } = survivor(a, "ada");
  const pid = me.pid;
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  // The owner joins the island again instead: it takes the survivor back, and dies before it saves.
  expect(a.h.host.cluster!.awayCheck("ada", keyAt("ada", 1))).toBe("");
  crash(a);
  const a2 = server("Island", "kill-back", clock);
  expect(a2.log.some((l) => l.endsWith("which this save did not know: taken in again"))).toBe(true);
  expect(places(pid, folder, a2, b)).toEqual(["world 1"]);
  const late = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  expect([late.state, late.closeReason, late.closeText]).toEqual(["closed", REJECT_TRAVEL, "ada went back to Island"]);
  expect(places(pid, folder, a2, b)).toEqual(["world 1"]);
  const home = a2.h.join("ada", {}, { key: keyAt("ada", 1) });
  a2.h.run(400);
  expect(home.state).toBe("active");
  expect(audit(a2, b)).toEqual([]);
  a2.h.host.shutdown();
  b.h.host.shutdown();
});
