// Spawn regions kept stocked: a new world fills, what dies or is tamed is replaced at the pace of ARK's checks and never near a
// survivor, a tribe's creature or its base, a save keeps its creatures and is not filled on top of them, and the settings.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { createHost, type Host, type HostOptions } from "../../server/host.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { CHECK_SECONDS, CORE_MOST, CORE_RANGE, PLAYER_RANGE, TAME_RANGE, TICK_MADE, isWild } from "../../server/spawner.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { PROVING_POOL, PROVING_SEA_LEVEL } from "../../shared/world/proving.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const dir = mkdtempSync(join(tmpdir(), "snark-spawner-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const rulesOf = (server: string[] = [], mode: string[] = [], argv: string[] = []) => {
  const made = loadConfig({ gus: ["[ServerSettings]", ...server].join("\n"), game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") }, argv);
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return made.rules;
};
const ticks = (host: Host, n: number): void => {
  for (let i = 0; i < n; i++) host.game.tick();
};
const wild = (host: Host) => [...host.records.byPid.values()].filter((r) => isWild(host.world.reg, r));
const of = (host: Host, id: string) => wild(host).filter((r) => host.world.reg.ids[r.kind] === id);
const near = (r: { x: number; z: number }, x: number, z: number): number => Math.hypot(r.x - x, r.z - z);
const kill = (host: Host, pid: number): void => host.survival.add(host.records.byPid.get(pid)!, V_HEALTH, -1e9);

test("a new proving ground fills at once: the herd north of the plaza, raptors beyond it, and dodos round the pool on dry ground", () => {
  const host = createHost(reg, { wild: true });
  ticks(host, 60);
  const sp = host.spawner!;
  const [herd, beach, hunters] = sp.regions;
  expect([herd!.desired, beach!.desired, hunters!.desired]).toEqual([24, 12, 4]);
  expect(herd!.count).toBeGreaterThanOrEqual(24);
  expect(hunters!.count).toBeGreaterThanOrEqual(4);
  // The beach holds dodos up to 60% of its twelve and parasaurs up to 20%: eight and three, as ARK's limits allow.
  expect([of(host, "core:dodo").length, beach!.count]).toEqual([8, 11]);
  for (const d of of(host, "core:dodo")) {
    expect(near(d, PROVING_POOL.x, PROVING_POOL.z)).toBeLessThanOrEqual(50 + 6.8);
    expect(d.y).toBeGreaterThanOrEqual(PROVING_SEA_LEVEL);
  }
  expect([sp.count, wild(host).length, host.world.ents.count]).toEqual([wild(host).length, herd!.count + beach!.count + hunters!.count, wild(host).length]);
  // Nobody is near, so all of them sleep, and every level is one of ARK's thirty steps at difficulty 5.
  expect(host.creatures.awakeCount).toBe(0);
  expect(wild(host).every((r) => r.genome!.level % 5 === 0 && r.genome!.level >= 5 && r.genome!.level <= 150)).toBe(true);
  // The same seed makes the same world; another makes another.
  const look = (h: Host) => wild(h).map((r) => [h.world.reg.ids[r.kind], Math.round(r.x * 100), Math.round(r.z * 100), r.genome!.level]);
  const again = createHost(reg, { wild: true });
  ticks(again, 60);
  expect(look(again)).toEqual(look(host));
  const other = createHost(reg, { wild: true, seed: 2 });
  ticks(other, 60);
  expect(look(other)).not.toEqual(look(host));
});

test("what dies or is tamed is replaced at a later check, never within 60 m of a survivor", () => {
  // How far from Ada each wild creature is put down, as it is put down.
  const away: number[] = [];
  let her = -1;
  const watch: ModuleDef = {
    name: "watch",
    api: 1,
    setup: (m) => m.on("creature.spawn", (e) => void (her >= 0 && away.push(Math.hypot(Number(e.data.x) - h.world.ents.x[her]!, Number(e.data.z) - h.world.ents.z[her]!)))),
  };
  const h = new Harness({}, 1, 30, { wild: true, dev: true, modules: [watch] });
  h.run(2000);
  const ada = h.join("ada");
  h.run(1000);
  h.say(ada, "enablecheats");
  const host = h.host;
  const sp = host.spawner!;
  const beach = sp.regions[1]!;
  const dodos = of(host, "core:dodo");
  expect([dodos.length, sp.regions.every((r) => r.count >= r.desired || r === beach)]).toEqual([8, true]);
  // Ada stands at the north shore of the pool, and every dodo is killed or tamed.
  expect(PLAYER_RANGE).toBe(60);
  h.say(ada, `tp ${PROVING_POOL.x + 10} ${PROVING_POOL.z + 40}`);
  const me = host.records.byPid.get(h.client(ada)!.pid)!;
  // Nothing harms her, so she is there throughout. Dead, she would keep nothing away.
  host.survival.gods.add(me.pid);
  her = h.ent(ada);
  expect(host.taming.give(dodos[0]!, me, 1)).toBe(true);
  for (const d of dodos.slice(1)) kill(host, d.pid);
  expect([beach.count, of(host, "core:dodo").length]).toEqual([3, 0]);
  // A check adds one group at most, at its leader's place 60 m from her or more.
  const old = new Set(wild(host).map((r) => r.pid));
  let most = 0;
  for (let n = 0; n < 4; n++) {
    const was = beach.count;
    h.run(CHECK_SECONDS * 1000);
    most = Math.max(most, beach.count - was);
  }
  const fresh = wild(host).filter((r) => !old.has(r.pid));
  expect(fresh.length).toBeGreaterThan(0);
  expect(most).toBeLessThanOrEqual(5);
  expect(away.length).toBe(fresh.length);
  expect(Math.min(...away)).toBeGreaterThanOrEqual(PLAYER_RANGE - 6.8);
  // She goes east, and in a few more checks the beach is as it was.
  h.say(ada, "tp 460 256");
  h.run(8 * CHECK_SECONDS * 1000);
  expect([of(host, "core:dodo").length, beach.count]).toEqual([8, 11]);
});

test("nothing is put down within 40 m of a tribe's creature, nor within 60 m of 15 of a tribe's foundations and ceilings", () => {
  expect([TAME_RANGE, CORE_MOST, CORE_RANGE]).toEqual([40, 15, 60]);
  const base = (pieces: number, kind: string, owner: number): Host => {
    const host = createHost(reg, { wild: true });
    const k = host.world.reg.index.get(kind)!;
    for (let i = 0; i < pieces; i++) host.world.structs.add(k, PROVING_POOL.x + (i % 5) * 3, 0.15, PROVING_POOL.z + Math.floor(i / 5) * 3, 0, owner, 1000);
    ticks(host, 120);
    return host;
  };
  // Fifteen foundations at the pool keep the whole beach clear; fourteen, fifteen pillars, or fifteen of nobody's do not.
  expect(base(15, "core:foundation_wood", 99).spawner!.regions[1]!.count).toBe(0);
  expect(base(14, "core:foundation_wood", 99).spawner!.regions[1]!.count).toBe(11);
  expect(base(15, "core:pillar_wood", 99).spawner!.regions[1]!.count).toBe(11);
  expect(base(15, "core:foundation_wood", 0).spawner!.regions[1]!.count).toBe(11);
  // A tribe's raptor at the pool: what comes stands 40 m from it, less a group's spread.
  const host = createHost(reg, { wild: true });
  const e = host.spawnCreature("core:raptor", PROVING_POOL.x, PROVING_POOL.z + 30, 1, "admin");
  const rec = host.records.byPid.get(host.world.ents.pid[e]!)!;
  rec.team = 99;
  host.world.ents.setTeam(e, 99);
  ticks(host, 120);
  const beach = wild(host).filter((r) => near(r, PROVING_POOL.x, PROVING_POOL.z) < 60);
  expect(beach.length).toBeGreaterThan(0);
  for (const r of beach) expect(near(r, rec.x, rec.z)).toBeGreaterThanOrEqual(TAME_RANGE - 6.8);
});

test("nothing is put down inside a node nobody has loaded, nor in what is left of one used up, but where one used up left nothing", () => {
  // Rocks, trees and banyans thick on the ground, and nobody near, so no chunk's nodes are loaded.
  const thick = writeMap(flatMap(4, { nodes: [{ seed: 5, perChunk: 96, kinds: [["core:rock", 1], ["core:tree", 1], ["core:banyan", 1]], allowCell: 0, allow: null }], regions: [{ kind: "spawn", spawns: "core:spawns_proving_herd", count: 30, at: [128, 128], radius: 100 }] }));
  const host = createHost(reg, { wild: true, map: thick });
  ticks(host, 120);
  const field = host.world.nodeField!;
  expect(field.isLoaded(0)).toBe(false);
  expect(wild(host).length).toBeGreaterThan(10);
  // Loaded, every one of them stands clear.
  host.harvest!.retain(10, 2, 1);
  const stuck = wild(host).filter((r) => {
    const p = host.world.reg.move[r.kind]!;
    return !capsuleFree(host.world, r.x, r.y, r.z, p.radius, p.height);
  });
  expect(stuck.length).toBe(0);

  // One rock at (100, 100), in chunk 5, and a region half a metre round it.
  const one = writeMap(flatMap(4, { nodes: [{ kinds: ["core:rock"], first: Uint32Array.from({ length: 17 }, (_, c) => (c > 5 ? 1 : 0)), kind: Uint8Array.of(0), x: Uint16Array.of(36 * 1024), z: Uint16Array.of(36 * 1024), yaw: Uint16Array.of(0) }], regions: [{ kind: "spawn", spawns: "core:spawns_proving_herd", count: 3, at: [100, 100], radius: 0.5 }] }));
  const usedUp = (h: Host): void => {
    const w = new BitWriter(16);
    w.varint(1);
    w.u8(0);
    w.varint(0);
    w.uint53(h.world.tick + 1e6);
    h.harvest!.decode(5, w.bytes().slice());
  };
  const made = (r: typeof reg, gone: boolean): number => {
    const h = createHost(r, { wild: true, map: one });
    if (gone) usedUp(h);
    ticks(h, 60);
    return h.spawner!.regions[0]!.count;
  };
  // A used-up rock leaves its broken base, and here, as a kind may, nothing.
  const bare = compileContent(CORE_CONTENT.map((d): Def => (d.id === "core:rock" && d.type === "node" ? { ...d, variants: d.variants!.map(({ mesh, weight, boxes }) => ({ mesh, weight, boxes })) } : d))).registry!;
  expect([made(reg, false), made(reg, true), made(bare, true) >= 3]).toEqual([0, 0, true]);
});

test("a saved world comes back with its creatures where they were, counted, and is not filled on top of them", () => {
  const db = join(dir, "kept.db");
  const first = createHost(reg, { wild: true, dbPath: db });
  ticks(first, 60);
  const before = wild(first).map((r) => [r.pid, r.x, r.z]).sort();
  first.shutdown();
  const second = createHost(reg, { wild: true, dbPath: db });
  expect(second.spawner!.count).toBe(before.length);
  expect(second.spawner!.regions.map((r) => r.count)).toEqual(first.spawner!.regions.map((r) => r.count));
  ticks(second, 2 * CHECK_SECONDS * TICK_RATE);
  expect(wild(second).map((r) => [r.pid, r.x, r.z]).sort()).toEqual(before);
  expect(second.spawner!.made).toBe(0);
  second.shutdown();
});

test("a save made before the spawner keeps its herd, counted for the region it stands in, and the empty regions top up at the pace of their checks", () => {
  const db = join(dir, "old.db");
  const old = createHost(reg, { dbPath: db, startingCreatures: 30, startingSpecies: "core:parasaur" });
  old.shutdown();
  const host = createHost(reg, { wild: true, dbPath: db });
  const [herd, beach, hunters] = host.spawner!.regions;
  expect([herd!.count, beach!.count, hunters!.count]).toEqual([30, 0, 0]);
  ticks(host, 30);
  expect(host.spawner!.made).toBe(0);
  // Two checks each, as one may find every place its group would stand taken.
  ticks(host, 2 * CHECK_SECONDS * TICK_RATE);
  expect([herd!.count, beach!.count > 0, hunters!.count > 0]).toEqual([30, true, true]);
  host.shutdown();
  // And one made before content was realigned loads with the spawner on.
  const fixture = join(dir, "before.db");
  copyFileSync(join(import.meta.dir, "../fixtures/saves/before-realignment.db"), fixture);
  const older = createHost(reg, { wild: true, dbPath: fixture });
  ticks(older, CHECK_SECONDS * TICK_RATE + 1);
  expect(older.spawner!.made).toBeGreaterThan(0);
  older.shutdown();
});

test("-ForceRespawnDinos, or ServerAutoForceRespawnWildDinosInterval come round, replaces every wild creature at a start, and only the wild", () => {
  const db = join(dir, "forced.db");
  const open = (argv: string[] = [], server: string[] = []): Host => createHost(reg, { wild: true, dbPath: db, config: rulesOf(server, [], argv) });
  let host = open();
  ticks(host, 60);
  // A tribe's dodo, far from every region.
  const tame = host.records.byPid.get(host.world.ents.pid[host.spawnCreature("core:dodo", 460, 460, 5, "admin")]!)!;
  tame.team = 7;
  host.records.dirty.add(tame.pid);
  const was = new Set(wild(host).map((r) => r.pid));
  host.shutdown();
  host = open(["-ForceRespawnDinos"]);
  expect(wild(host).some((r) => was.has(r.pid))).toBe(false);
  expect(host.records.byPid.get(tame.pid)?.team).toBe(7);
  ticks(host, 60);
  expect(wild(host).length).toBe(was.size);
  const now = new Set(wild(host).map((r) => r.pid));
  host.shutdown();
  // Every hour: the start that follows at once keeps them; one an hour and more after the last replaces them.
  host = open([], ["ServerAutoForceRespawnWildDinosInterval=3600"]);
  expect(wild(host).every((r) => now.has(r.pid))).toBe(true);
  host.shutdown();
  const save = new Database(db);
  const last = JSON.parse(String((save.query("SELECT value FROM meta WHERE key = 'spawner'").get() as { value: string }).value)) as { forced: number };
  expect(Math.abs(last.forced - Date.now() / 1000)).toBeLessThan(60);
  save.query("UPDATE meta SET value = ? WHERE key = 'spawner'").run(JSON.stringify({ forced: last.forced - 3601 }));
  save.close();
  host = open([], ["ServerAutoForceRespawnWildDinosInterval=3600"]);
  expect(wild(host).some((r) => now.has(r.pid))).toBe(false);
  host.shutdown();
});

test("the settings: DinoCountMultiplier scales what each region holds, a species replaced by none is not made, and -NoDinos keeps the wild out", () => {
  const counted = (server: string[], mode: string[] = [], argv: string[] = []) => {
    const host = createHost(reg, { wild: true, config: rulesOf(server, mode, argv) });
    ticks(host, 120);
    return host;
  };
  const double = counted(["DinoCountMultiplier=2"]);
  expect(double.spawner!.regions.map((r) => r.desired)).toEqual([48, 24, 8]);
  expect(of(double, "core:dodo").length).toBe(15);
  const none = counted([], ['NPCReplacements=(FromClassName="core:dodo",ToClassName="")']);
  expect([of(none, "core:dodo").length, none.spawner!.regions[1]!.count]).toEqual([0, 3]);
  for (const flag of ["-NoDinos", "-NoDinosExceptForcedSpawn", "-NoDinosExceptStreamingSpawn", "-NoDinosExceptManualSpawn", "-NoDinosExceptWaterSpawn"]) {
    const quiet = counted([], [], [flag]);
    expect([quiet.spawner, quiet.world.ents.count]).toEqual([null, 0]);
    // An admin's spawn still works.
    expect(quiet.spawnCreature("core:dodo", PROVING_POOL.x - 40, PROVING_POOL.z, 5, "admin")).toBeGreaterThanOrEqual(0);
  }
});

test("a module may refuse a wild spawn or change it, and an admin may destroy the wild, which come back a group at each check", () => {
  const seen: Record<string, unknown>[] = [];
  const mod: ModuleDef = {
    name: "keeper",
    api: 1,
    setup: (m) =>
      m.on("creature.spawn", (e) => {
        seen.push({ ...e.data });
        if (e.data.kind === "core:raptor") e.refuse("no raptors here");
        else e.data.level = 1;
      }),
  };
  const h = new Harness({}, 1, 30, { wild: true, dev: true, modules: [mod] });
  h.run(3000);
  const host = h.host;
  expect([of(host, "core:raptor").length, host.spawner!.regions[2]!.count]).toEqual([0, 0]);
  expect(wild(host).every((r) => r.genome!.level === 1)).toBe(true);
  expect(seen[0]).toMatchObject({ why: "wild" });
  expect(typeof seen[0]!.x).toBe("number");
  const ada = h.join("ada");
  h.run(1000);
  h.say(ada, "enablecheats");
  const all = wild(host).length;
  expect(h.say(ada, "destroywilddinos")).toEqual([`destroyed ${all} wild creatures`]);
  expect(wild(host).length).toBe(0);
  h.run(CHECK_SECONDS * 1000 + 2000);
  const back = wild(host).length;
  expect(back).toBeGreaterThan(0);
  expect(back).toBeLessThan(15);
});

test("a world filling makes at most 64 creatures a tick, over all its regions", () => {
  const regions = Array.from({ length: 100 }, (_, i) => ({ kind: "spawn" as const, spawns: "core:spawns_proving_herd", count: 20, at: [24 + (i % 10) * 46, 24 + Math.floor(i / 10) * 46] as const, radius: 20 }));
  const host = createHost(reg, { wild: true, map: writeMap(flatMap(8, { regions })) });
  expect(TICK_MADE).toBe(64);
  let most = 0;
  for (let i = 0; i < 200; i++) {
    const was = host.spawner!.made;
    host.game.tick();
    most = Math.max(most, host.spawner!.made - was);
  }
  // A group that starts within the budget is made whole, so a tick may pass it by a group.
  expect(most).toBeGreaterThan(40);
  expect(most).toBeLessThanOrEqual(TICK_MADE + 2);
  expect(host.spawner!.regions.every((r) => r.count >= 20)).toBe(true);
});

test("a map file's spawn regions are added to its definition's", () => {
  const made = compilePacks([CORE_PACK, { name: "test", defs: [{ id: "test:flat", type: "map", chunks: [4, 4], zones: [{ kind: "spawn", at: [60, 190], radius: 12, spawns: "core:spawns_proving_hunters", count: 3 }] }] }]);
  expect(made.errors).toEqual([]);
  const opts: HostOptions = { wild: true, map: writeMap(flatMap(4, { regions: [{ kind: "spawn", spawns: "core:spawns_beach", count: 6, at: [180, 60], half: [20, 30] }] })) };
  const host = createHost(made.registry!, opts);
  ticks(host, 30);
  expect(host.spawner!.regions.map((r) => [r.x, r.z, r.desired])).toEqual([[60, 190], [180, 60]].map(([x, z], i) => [x, z, [3, 6][i]]));
  for (const r of wild(host)) {
    const inBox = Math.abs(r.x - 180) <= 20 + 6.8 && Math.abs(r.z - 60) <= 30 + 6.8;
    expect(inBox || near(r, 60, 190) <= 12 + 2.5).toBe(true);
  }
});
