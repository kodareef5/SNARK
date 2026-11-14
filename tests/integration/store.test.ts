// The entity store grows as the world fills, up to what its operator allows. Nothing in it is lost or refused in silence.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { Past } from "../../server/history.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { ENTITY_START } from "../../server/world.ts";
import { CMD_RESPAWN, REJECT_FULL, RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { ENTITY_LIMIT, EntityStore, F_ALIVE } from "../../shared/sim/entities.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Puts `n` creatures that stand still in a corner four chunks from the spawn point. Returns how many got a body. */
function herd(h: Harness, n: number): number {
  let made = 0;
  for (let k = 0; k < n; k++) if (h.host.spawnCreature("core:dummy", 8 + (k % 50), 8 + (Math.floor(k / 50) % 50), 1) >= 0) made++;
  return made;
}

/** Records of those creatures, and how many of them have a body. */
function creatures(h: Harness): [number, number] {
  const dummy = h.reg.index.get("core:dummy")!;
  let records = 0;
  let bodies = 0;
  for (const rec of h.host.records.byPid.values()) {
    if (rec.kind !== dummy) continue;
    records++;
    if (h.host.records.entOf.has(rec.pid)) bodies++;
  }
  return [records, bodies];
}

test("a server holds more bodies than its store starts with: a survivor still joins, and a restart loses no creature", () => {
  const db = join(dir, "past.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  expect([h.world.ents.cap, h.world.ents.max]).toEqual([ENTITY_START, 524288]);
  expect(herd(h, 5000)).toBe(5000);
  expect(creatures(h)).toEqual([5000, 5000]);
  const ada = h.join("ada");
  h.run(300);
  expect(ada.state).toBe("active");
  expect([h.world.ents.count, h.world.ents.cap, h.world.ents.refused]).toEqual([5001, 8192, 0]);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  expect(creatures(h2)).toEqual([5000, 5000]);
  expect(h2.world.ents.count).toBe(5000);
  const again = h2.join("ada");
  h2.run(300);
  expect(again.state).toBe("active");
  h2.host.shutdown();
});

test("an operator names the most bodies the world may hold, from 4,096 to what a handle can name", () => {
  const made = loadConfig({ gus: "[SnarkSettings]\nMaxEntities=8192\n", game: "" });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  const h = new Harness({}, 1, 60, { config: made.rules });
  expect([h.world.ents.cap, h.world.ents.max, h.world.ents.reserve]).toEqual([4096, 8192, 70]);
  for (const [words, max] of [["4096", 4096], ["1048576", ENTITY_LIMIT]] as const) expect(loadConfig({ gus: `[SnarkSettings]\nMaxEntities=${words}\n`, game: "" }).rules.num("MaxEntities")).toBe(max);
  for (const words of ["4095", "1048577"]) expect(loadConfig({ gus: `[SnarkSettings]\nMaxEntities=${words}\n`, game: "" }).report.refused.map((r) => r.key)).toEqual(["MaxEntities"]);
  // A store with no limit of its own never grows, and one cannot be made larger than a handle can name.
  const fixed = new EntityStore(h.world.dims, 2);
  expect([fixed.create(1, 0, 0, 0, 0), fixed.create(1, 0, 0, 0, 0), fixed.create(1, 0, 0, 0, 0), fixed.cap, fixed.refused]).toEqual([0, 1, -1, 2, 1]);
  expect(() => new EntityStore(h.world.dims, 16, ENTITY_LIMIT + 1)).toThrow("handle index range");
});

function seen(s: ClientSession): RemoteSample {
  const out = new RemoteSample();
  s.sampleRemote(out);
  return out;
}

/** Every live entity as the server holds it, with its mind and its past, then the awake list and what each client was sent. */
function digest(h: Harness): string[] {
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const past = new Past();
  // Every typed column the store has, so one added later is compared too. The free ring and the chunk heads are not per entity.
  const columns = Object.entries(ents).filter(([name, col]) => ArrayBuffer.isView(col) && name !== "freeRing" && name !== "chunkHead") as [string, Uint8Array][];
  const out: string[] = [];
  for (let e = 0; e < ents.cap; e++) {
    if ((ents.flags[e]! & F_ALIVE) === 0) continue;
    const row: unknown[] = [e, ents.name[e], ents.look[e]?.join(","), ents.gear[e]?.join(",")];
    for (const [name, col] of columns) {
      const per = col.length / ents.cap;
      row.push(`${name} ${col.subarray(e * per, e * per + per).join(",")}`);
    }
    row.push("mind", mind.mind[e], mind.move[e], mind.look[e], mind.pitch[e], mind.buttons[e], mind.pressed[e], mind.stance[e], mind.leader[e], mind.targetOf(e));
    if (h.world.history.at(h.world.tick - 5, e, past)) row.push("past", past.x, past.y, past.z, past.yaw, past.anim);
    out.push(row.join(" "));
  }
  out.push(`awake ${h.host.creatures.awake.subarray(0, h.host.creatures.awakeCount).join(",")}`);
  for (const s of h.sessions) {
    const view = seen(s);
    out.push(`${s.state} sees ${view.id.subarray(0, view.count).join(",")} at ${view.x.subarray(0, view.count).join(",")} in ${s.stats.bytesIn} bytes, ${s.stats.snapshots} snapshots, ${s.stats.undecodable} undecodable, ${s.stats.corrections} corrections`);
  }
  return out;
}

/**
 * Half a minute of play that makes bodies and removes none: survivors join, creatures are made among them a few at a
 * time, one is hurt, one is tamed and ridden, a bag is dropped and a third survivor joins late.
 */
function play(entityStart: number) {
  const h = new Harness({}, 3, 30, { dev: true, entityStart, startingCreatures: 6, startingSpecies: "core:parasaur" });
  const ents = h.world.ents;
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  const caps = [ents.cap];
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(1000);
  caps.push(ents.cap);
  const rng = new Rng(9);
  const made: number[] = [];
  for (let k = 0; k < 30; k++) {
    const x = ents.x[h.ent(ada)]! + rng.range(-20, 20);
    const z = ents.z[h.ent(ada)]! + rng.range(-20, 20);
    const e = h.host.spawnCreature(k % 3 === 0 ? "core:dummy" : "core:parasaur", x, z, 1 + rng.int(30));
    if (e >= 0) made.push(e);
    if (k % 6 === 5) h.run(400);
  }
  caps.push(ents.cap);
  const wild = made.filter((e) => ents.kind[e] === id("parasaur"));
  h.host.creatures.provoke(wild[0]!, ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!, h.ent(ada));
  // Bob is given the last one made, saddled, and rides it.
  const mount = wild[wild.length - 1]!;
  const tame = h.host.records.byPid.get(ents.pid[mount]!)!;
  h.host.taming.give(tame, rec(bob), 1, "forced");
  tame.saddle = id("saddle_parasaur");
  ents.setPosition(h.ent(bob), ents.x[mount]! + 1, ents.y[mount]!, ents.z[mount]!);
  h.run(300);
  const rode = h.host.riding.mount(h.client(bob)!, mount);
  h.pilots[0]!.moveZ = 127;
  h.pilots[1]!.moveZ = 127;
  h.run(1500);
  h.host.items.mint(rec(ada), id("stone"), 5);
  const dropped = h.host.death.drop(rec(ada), rec(ada).inv!.item.indexOf(id("stone")), 0);
  const cy = h.join("cy");
  h.run(2000);
  h.pilots[1]!.yaw = 2;
  h.run(1500);
  // Everyone leaves for a far corner, so the creatures east and south of the spawn point fall asleep. Ada comes back and wakes them.
  const awake = [h.host.creatures.awakeCount];
  const [x, z] = [ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!];
  for (const e of [h.ent(ada), mount, h.ent(cy)]) ents.setPosition(e, 30, h.world.hf.heightAt(30, 30), 30);
  h.run(500);
  awake.push(h.host.creatures.awakeCount);
  ents.setPosition(h.ent(ada), x, h.world.hf.heightAt(x, z), z);
  h.run(1000);
  awake.push(h.host.creatures.awakeCount);
  caps.push(ents.cap);
  return { caps, awake, made: made.length, rode, dropped, mount, drive: h.client(bob)!.drive, late: h.ent(cy), digest: digest(h) };
}

test("a store that grows in the middle of a game, with clients connected, leaves the world and what each client is sent exactly as a store that never grew", () => {
  const grown = play(2);
  const plain = play(ENTITY_START);
  // It grew before anyone joined, while two watched creatures being made, and again for the bag and the late survivor.
  expect(grown.caps).toEqual([8, 8, 64, 64]);
  expect(plain.caps).toEqual([4096, 4096, 4096, 4096]);
  // The mount and the late survivor's body are in slots the store did not have when the first two joined.
  expect([grown.made, grown.rode, grown.dropped, grown.drive === grown.mount, grown.mount >= 8, grown.late >= 32]).toEqual([30, RESULT_OK, true, true, true, true]);
  // Twenty-eight of the creatures in those slots fell asleep and woke again.
  expect(grown.awake).toEqual([36, 8, 36]);
  expect(grown.digest.length).toBeGreaterThan(40);
  expect(grown.digest).toEqual(plain.digest);
});

test("at its limit the world refuses a creature and says so, leaves no record of it, and still has a place for every survivor", () => {
  const said: string[] = [];
  const h = new Harness({ maxClients: 3 }, 1, 60, { dev: true, entityMax: 48, entityStart: 16, log: (line) => void said.push(line) });
  const ents = h.world.ents;
  expect(herd(h, 60)).toBe(45);
  expect([creatures(h), ents.count, ents.room, ents.refused, ents.cap]).toEqual([[45, 45], 45, 0, 15, 48]);
  h.run(100);
  expect(said).toEqual(["the world has no place for more bodies (15 refused): it holds 45 of the 48 that MaxEntities allows, with 3 kept for survivors"]);
  // More refusals within the minute are counted and not said again, and are said when the minute is up.
  expect(herd(h, 2)).toBe(0);
  h.run(30000);
  expect([said.length, ents.refused]).toEqual([1, 17]);
  h.run(31000);
  expect(said[1]).toStartWith("the world has no place for more bodies (2 refused): it holds 45 of the 48");

  const [ada, bob, cy] = ["ada", "bob", "cy"].map((name) => h.join(name)) as [ClientSession, ClientSession, ClientSession];
  h.run(300);
  expect([ada.state, bob.state, cy.state, ents.count]).toEqual(["active", "active", "active", 48]);
  // A fourth is turned away for want of a seat, not of a body.
  const dee = h.join("dee");
  h.run(300);
  expect([dee.state, dee.closeReason]).toEqual(["closed", REJECT_FULL]);
  // One who dies there leaves no cache with a body, and returns to life.
  h.host.items.mint(h.host.records.byPid.get(h.client(bob)!.pid)!, h.reg.index.get("core:stone")!, 5);
  h.say(bob, "enablecheats");
  h.say(bob, "suicide");
  h.run(300);
  const cache = [...h.host.records.byPid.values()].find((r) => r.name === "bob's cache")!;
  expect([h.client(bob)!.ent, h.host.records.entOf.has(cache.pid), ents.count]).toEqual([-1, false, 47]);
  bob.command(CMD_RESPAWN, (w) => w.u8(0));
  h.run(300);
  expect([h.client(bob)!.ent >= 0, ents.count]).toEqual([true, 48]);
});

test("a save with more creatures than the world now allows is loaded whole: those without a place are logged, kept in the save, and get bodies when the limit is raised", () => {
  const db = join(dir, "over.db");
  const said: string[] = [];
  const open = (entityMax: number): Harness => new Harness({ maxClients: 4 }, 1, 60, { dbPath: db, entityMax, entityStart: 16, log: (line) => void said.push(line) });
  const h = open(64);
  expect(herd(h, 60)).toBe(60);
  h.host.shutdown();
  const less = open(32);
  expect(creatures(less)).toEqual([60, 28]);
  expect(said).toEqual(["no body for 32 of the creatures and things in the save, which stay in it without one: the world holds 28 of the 32 that MaxEntities allows, with 4 kept for survivors"]);
  // The load's refusals are not said a second time.
  less.run(200);
  expect(said.length).toBe(1);
  less.host.shutdown();
  const more = open(64);
  expect([creatures(more), said.length]).toEqual([[60, 60], 1]);
  more.host.shutdown();
});
