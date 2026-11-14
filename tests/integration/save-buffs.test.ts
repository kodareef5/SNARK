// Buffs across a restart: each goes on to its own end, and what it did to a body's vitals ends with it.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost, type Host } from "../../server/host.ts";
import { WorldStore } from "../../server/persist/store.ts";
import type { EntityRecord } from "../../server/records.ts";
import { MF_ROOTED } from "../../shared/sim/character.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-savebuffs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const open = (db: string): Host => createHost(reg, { dbPath: db, startingCreatures: 0 });
const run = (host: Host, seconds: number): void => {
  for (let n = Math.round(seconds * 30); n > 0; n--) host.game.tick();
};
const grazer = (host: Host, z: number): EntityRecord => host.records.byPid.get(host.world.ents.pid[host.spawnCreature("core:grazer", 256, z, 5)]!)!;

test("a creature set alight before a restart burns for what was left of its fire and no longer, and one drugged sleeps it off", () => {
  const db = join(dir, "alight.db");
  let host = open(db);
  const [a, b] = [grazer(host, 250), grazer(host, 262)];
  const full = host.survival.value(a, V_HEALTH);
  // Eight health a second for eight seconds, less the 0.2 a second it mends.
  host.buffs.give(a, id("burning"), 0);
  // Knocked out, then a dose that adds torpor for eight seconds.
  host.survival.add(b, V_TORPOR, 10000);
  host.buffs.give(b, id("drugged"), 0, 8, 5);
  const until = [a.buffs[0]!.until, b.buffs[0]!.until];
  run(host, 2);
  host.shutdown();

  host = open(db);
  const [burnt, dosed] = [host.records.byPid.get(a.pid)!, host.records.byPid.get(b.pid)!];
  expect(burnt.buffs).toEqual([{ buff: id("burning"), until: until[0]!, by: 0, torpor: 0 }]);
  expect(dosed.buffs).toEqual([{ buff: id("drugged"), until: until[1]!, by: 0, torpor: 5 }]);
  expect(host.survival.value(burnt, V_HEALTH)).toBeCloseTo(full - 2 * 7.8, 1);
  run(host, 7);
  // Six more seconds of fire and one of mending.
  expect(burnt.buffs.length).toBe(0);
  expect(host.survival.value(burnt, V_HEALTH)).toBeCloseTo(full - 8 * 7.8 + 0.2, 1);
  // The dose is spent too. Its torpor then drains, and the creature gets up.
  expect([dosed.buffs.length, dosed.out]).toEqual([0, true]);
  const most = dosed.vitals!.max[V_TORPOR]! / 1e6;
  expect(host.survival.value(dosed, V_TORPOR)).toBeLessThan(most);
  run(host, 60);
  expect(host.survival.value(burnt, V_HEALTH)).toBeCloseTo(full - 8 * 7.8 + 61 * 0.2, 1);
  run(host, most / 0.6);
  expect([dosed.out, host.survival.value(dosed, V_TORPOR)]).toEqual([false, 0]);
  expect(host.records.byPid.has(a.pid)).toBe(true);
  host.shutdown();
});

test("a save from before buffs were saved: what a buff was doing to a body ends at the load, since nothing says when else", () => {
  const db = join(dir, "before.db");
  let host = open(db);
  const [a, b] = [grazer(host, 250), grazer(host, 262)];
  host.buffs.give(a, id("burning"), 0);
  host.buffs.give(b, id("tranquilized"), 0, 5, 10);
  run(host, 2);
  // As such a build left them: the buff's rate in the vitals, and no buff in the record.
  for (const rec of [a, b]) {
    rec.buffs.length = 0;
    host.records.dirty.add(rec.pid);
  }
  host.shutdown();
  const store = new WorldStore(db, reg);
  for (const rec of [a, b]) {
    const data = (store.db.query("SELECT data FROM entities WHERE pid = ?").get(rec.pid) as { data: Uint8Array }).data;
    data[0] = 1;
    store.db.query("UPDATE entities SET data = ? WHERE pid = ?").run(data, rec.pid);
  }
  store.close();

  host = open(db);
  const [burnt, dosed] = [host.records.byPid.get(a.pid)!, host.records.byPid.get(b.pid)!];
  const health = host.survival.value(burnt, V_HEALTH);
  const torpor = host.survival.value(dosed, V_TORPOR);
  expect(torpor).toBeCloseTo(20, 1);
  run(host, 60);
  expect(host.records.byPid.has(a.pid)).toBe(true);
  expect(host.survival.value(burnt, V_HEALTH)).toBeCloseTo(health + 60 * 0.2, 1);
  expect(host.survival.value(dosed, V_TORPOR)).toBe(0);
  host.shutdown();
  // They were saved again in this build's form, so the next load takes their rates as they are.
  host = open(db);
  expect(host.persistence!.store.unrated.size).toBe(0);
  host.shutdown();
});

test("a survivor stunned before a restart comes back stunned, is shown it, and is free when its time is up", () => {
  const db = join(dir, "stunned.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const s = h.join("ada");
  h.run(500);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  h.host.buffs.give(rec, id("stunned"), 0, 20);
  const until = rec.buffs[0]!.until;
  h.run(200);
  s.close();
  h.run(200);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  const again = h2.join("ada");
  h2.run(500);
  expect(again.buffs.map((b) => [b.buff, b.until])).toEqual([[id("stunned"), until]]);
  expect(h2.world.ents.mflags[h2.ent(again)]! & MF_ROOTED).toBe(MF_ROOTED);
  h2.run(20000);
  expect(again.buffs.length).toBe(0);
  expect(h2.world.ents.mflags[h2.ent(again)]! & MF_ROOTED).toBe(0);
  h2.host.shutdown();
});
