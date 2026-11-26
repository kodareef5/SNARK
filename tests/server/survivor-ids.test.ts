// Every player's survivor has a 17-digit ID shaped like a SteamID64, minted by its world and kept through restarts and travel.

import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idText } from "../../server/survivor-ids.ts";
import { ID_COUNT_RANGE, MAX_ID_WORLD, idOf, idParts } from "../../shared/ids.ts";
import { TestCluster, keyAt, rec, rise, travel } from "../fixtures/cluster.ts";
import { Harness } from "../fixtures/net.ts";
import { camp, field, record, restart, survivor } from "../kit/kit.ts";

const cluster = new TestCluster();
const dir = mkdtempSync(join(tmpdir(), "snark-ids-"));
afterAll(() => {
  cluster.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const idOfSaid = (said: string[]): string => said[0]!.split("  ")[1]!;

test("a new survivor gets a 17-digit ID that starts as a Steam ID does", () => {
  const { h, ada, me } = camp();
  const id = idOfSaid(h.say(ada, "id"));
  expect(id).toMatch(/^7656119\d{10}$/);
  expect(idParts(id)?.world).toBe(h.host.records.worldId);
  expect([idText(me), h.host.survivorById(id)]).toEqual([id, me]);
  const bo = survivor(h, "bo", { cheats: false });
  expect(idOfSaid(h.say(bo, "id"))).not.toBe(id);
});

test("admins and the operator see every survivor's ID, and a player sees only its own", () => {
  const { h, ada, me } = camp();
  const bo = survivor(h, "bo", { cheats: false });
  const [a, b] = [idText(me), idText(record(h, bo))];
  expect([h.say(ada, "id bo"), h.host.exec("id ada")]).toEqual([[`bo  ${b}`], `ada  ${a}`]);
  expect(h.say(bo, "id ada")).toEqual(["denied: only admins see another survivor's ID"]);
  expect([h.say(bo, "id"), h.say(ada, "id nobody")]).toEqual([[`bo  ${b}`], ['no survivor "nobody"']]);
  expect(h.say(ada, "who").sort()).toEqual([`ada  ${a}  alive  admin`, `bo  ${b}  alive`]);
  expect(h.say(bo, "who").sort()).toEqual(["ada  alive", "bo  alive"]);
});

test("an ID is the same after a restart", () => {
  const { h, ada } = camp({ save: true });
  const id = idOfSaid(h.say(ada, "id"));
  const again = restart(h);
  const back = survivor(again, "ada");
  expect(idOfSaid(again.say(back, "id"))).toBe(id);
  expect(again.host.survivorById(id)?.name).toBe("ada");
});

test("an ID is the same after travel to another world of the cluster", () => {
  const clock = { ms: Date.now() };
  const a = cluster.server("Island", "ids-trip", clock);
  const b = cluster.server("Miami", "ids-trip", clock);
  const { session, me } = cluster.survivor(a, "ada");
  const id = idText(me);
  expect(a.h.host.survivorById(id)).toBe(me);
  const ticket = travel(a, session, b.world);
  expect(ticket).toBeInstanceOf(Uint8Array);
  expect(a.h.host.survivorById(id)).toBeNull();
  clock.ms += 30_000;
  const there = b.h.join("ada", {}, { key: keyAt("ada", b.world), ticket: ticket as Uint8Array });
  b.h.run(400);
  rise(b, there);
  const arrived = rec(b, "ada")!;
  expect([idText(arrived), b.h.host.survivorById(id)]).toEqual([id, arrived]);
});

test("two worlds of a cluster never give the same ID", () => {
  const clock = { ms: Date.now() };
  const a = cluster.server("Island", "ids-two", clock);
  const b = cluster.server("Miami", "ids-two", clock);
  const ids = [cluster.survivor(a, "ada"), cluster.survivor(b, "bo"), cluster.survivor(a, "cy"), cluster.survivor(b, "dee")].map((s) => idText(s.me));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.map((id) => idParts(id)!.world)).toEqual([a.world, b.world, a.world, b.world]);
});

test("a survivor of an older save gets an ID once and keeps it", () => {
  const place = field();
  const db = join(dir, "older.db");
  const { h, me } = camp({ place, save: db });
  const bo = survivor(h, "bo", { cheats: false });
  const them = [me, record(h, bo)];
  expect(me.pid).toBeLessThan(them[1]!.pid);
  // A save from before IDs: no survivor has one and the save keeps no count of them.
  for (const r of them) {
    r.sid = 0;
    h.host.records.dirty.add(r.pid);
  }
  h.host.shutdown();
  const file = new Database(db);
  file.query("DELETE FROM meta WHERE key = 'next_survivor'").run();
  file.close();

  const open = (): Harness => new Harness({}, 1, 60, { dev: true, map: place.map!, dbPath: db });
  const first = open();
  const given = ["ada", "bo"].map((name) => idText(first.host.survivorRecord(name)!));
  expect(given.every((id) => idParts(id) !== null)).toBe(true);
  // In pid order, so the same save numbers them alike every time.
  expect(idParts(given[0]!)!.n).toBeLessThan(idParts(given[1]!)!.n);
  const cy = survivor(first, "cy", { cheats: false });
  const cyId = idText(record(first, cy));
  first.host.shutdown();

  const second = open();
  expect(["ada", "bo", "cy"].map((name) => idText(second.host.survivorRecord(name)!))).toEqual([...given, cyId]);
  expect(new Set([...given, cyId]).size).toBe(3);
  second.host.shutdown();
});

test("the parser refuses what is not an ID", () => {
  const base = 76561197960265728n;
  const at = (v: bigint): string => (base + v).toString();
  expect(idParts(idOf(1, 1))).toEqual({ world: 1, n: 1 });
  expect(idParts(idOf(MAX_ID_WORLD, ID_COUNT_RANGE - 1))).toEqual({ world: MAX_ID_WORLD, n: ID_COUNT_RANGE - 1 });
  const refused = ["", "ada", at(0n), at(1n), at(BigInt(ID_COUNT_RANGE)), at(1n << 32n), (base - 1n).toString(), ` ${idOf(1, 1)}`, `${idOf(1, 1)}0`, idOf(1, 1).slice(1), "7656119796026572a", "-7656119796026572", "7.656119796026572"];
  expect(refused.filter((s) => idParts(s) !== null)).toEqual([]);
  expect(() => idOf(0, 1)).toThrow();
  expect(() => idOf(1, 0)).toThrow();
  expect(() => idOf(MAX_ID_WORLD + 1, 1)).toThrow();
  expect(() => idOf(1, ID_COUNT_RANGE)).toThrow();
});
