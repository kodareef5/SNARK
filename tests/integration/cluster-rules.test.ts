// The rules a cluster's transfers keep (planning/architecture/transfers.md): a save restored from a backup makes no second copy,
// two claims of one file have one winner, a ticket works once for one name and not past its time, a destination that will not
// take a survivor says so before it leaves or gives it back whole, an operator can ask whether the cluster balances, and the
// machinery carries any record.

import { afterAll, expect, test } from "bun:test";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { auditCluster } from "../../server/cluster/audit.ts";
import { TICKET_SECONDS } from "../../server/cluster/cluster.ts";
import { ClusterFolder } from "../../server/cluster/folder.ts";
import { PARCEL_FORMAT, hex, openParcel, parcelRecords, sealParcel, type ParcelHead } from "../../server/cluster/parcel.ts";
import { createHost } from "../../server/host.ts";
import { hashKey } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { RecordCodec, idMap } from "../../server/persist/codec.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { REJECT_FULL, REJECT_TRAVEL } from "../../shared/net/protocol.ts";
import { TestCluster, beat, commit, keyAt, places, rec, travel } from "../fixtures/cluster.ts";
import { testKey } from "../fixtures/net.ts";

const t = new TestCluster();
afterAll(() => t.cleanup());
const reg = t.reg;
const id = (name: string): number => t.id(name);

test("a save restored from before a transfer gives up again what left and takes in again what came, so no second copy appears", () => {
  const clock = { ms: Date.now() };
  let a = t.server("Island", "restore", clock);
  let b = t.server("Miami", "restore", clock);
  const folder = a.h.host.cluster!.folder;
  const { session, me } = t.survivor(a, "ada");
  const pid = me.pid;
  commit(a, b);
  const aBefore = t.backup(a, "restore-a-before.db");
  const bBefore = t.backup(b, "restore-b-before.db");
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  // On Miami it picks up five more stone, which the island never sees.
  b.h.host.items.mint(rec(b, "ada")!, id("stone"), 5);
  b.h.run(100);
  commit(a, b);
  const bBetween = t.backup(b, "restore-b-between.db");

  // The island restored from before it left gives the survivor up again, and Miami keeps it.
  a = t.restore(a, aBefore, clock);
  expect(a.log.filter((l) => l.includes("which this save did not know"))).toEqual([expect.stringContaining("ada left for Miami by transfer")]);
  expect(places(pid, folder, a, b)).toEqual(["world 2"]);
  expect(t.audit(a, b)).toEqual([]);

  // Back to the island with 45 stone.
  beat(a, b);
  const back = travel(b, there, a.world) as Uint8Array;
  const home = a.h.join("ada", {}, { key: keyAt("ada", 1), ticket: back });
  a.h.run(400);
  expect(home.state).toBe("active");
  const carried = new Map(a.h.host.items.held(rec(a, "ada")!));
  expect(carried.get(id("stone"))).toBe(45);
  expect(t.audit(a, b)).toEqual([]);

  // Miami restored from before it came takes the survivor in as it came, then gives it up as it left: none is there.
  b = t.restore(b, bBefore, clock);
  expect(b.log.filter((l) => l.includes("which this save did not know")).length).toBe(2);
  expect(places(pid, folder, a, b)).toEqual(["world 1"]);
  expect(t.audit(a, b)).toEqual([]);
  // Miami restored to while it was there gives it up again.
  b = t.restore(b, bBetween, clock);
  expect(places(pid, folder, a, b)).toEqual(["world 1"]);
  expect(t.audit(a, b)).toEqual([]);
  // The island restored from before it ever left gives it up for its first trip and takes it in again from its second.
  a = t.restore(a, aBefore, clock);
  expect(places(pid, folder, a, b)).toEqual(["world 1"]);
  expect(new Map(a.h.host.items.held(rec(a, "ada")!))).toEqual(carried);
  expect(t.audit(a, b)).toEqual([]);

  // A file that cannot be read is said exactly, at the start and in the audit, and nothing is made of it.
  const came = folder.places().find((p) => p.by === a.world)!;
  const bytes = readFileSync(join(folder.root, "parcels", came.file));
  writeFileSync(join(folder.root, "parcels", came.file), bytes.subarray(0, bytes.length - 9));
  a = t.restore(a, aBefore, clock);
  expect(a.log).toContain(`transfer ${came.id} is damaged and was left as it is: what it carries is not here`);
  expect(places(pid, folder, a, b)).toEqual([]);
  expect(t.audit(a, b)).toContain(`transfer ${came.id}: its file cannot be read: its seal does not match what it holds`);
  // Put right by an operator, the next start takes it in.
  writeFileSync(join(folder.root, "parcels", came.file), bytes);
  a = t.restore(a, t.backup(a, "restore-a-damaged.db"), clock);
  expect(places(pid, folder, a, b)).toEqual(["world 1"]);
  expect(t.audit(a, b)).toEqual([]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("of two claims on one file one wins and the other is refused cleanly", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "claims", clock);
  const b = t.server("Miami", "claims", clock);
  const folder = a.h.host.cluster!.folder;
  const { session, me } = t.survivor(a, "ada");
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  // Two servers rename the one file at once: one of them has it.
  const sealed = folder.places().find((p) => p.by === 0)!;
  const key = hex(hashKey(keyAt("ada", 2)));
  const [one, two] = [new ClusterFolder(folder.root), new ClusterFolder(folder.root)];
  expect([one.take(sealed.id, sealed.from, 2, key), two.take(sealed.id, sealed.from, 3, key)]).toEqual([true, false]);
  expect(one.untake(folder.place(sealed.id)!)).toBe(true);
  // The destination takes it first: its owner on the island is told where it is, and nothing moves.
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  expect(there.state).toBe("active");
  const home = a.h.join("ada", {}, { key: keyAt("ada", 1) });
  a.h.run(400);
  expect([home.state, home.closeReason, home.closeText]).toEqual(["closed", REJECT_TRAVEL, "ada is on Miami: travel back from there"]);
  expect(places(me.pid, folder, a, b)).toEqual(["world 2"]);
  expect(t.audit(a, b)).toEqual([]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("a ticket works once, for its own name, before it expires, and not for a survivor that went back", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "tickets", clock);
  const b = t.server("Miami", "tickets", clock);
  const folder = a.h.host.cluster!.folder;
  const { session, me } = t.survivor(a, "ada");
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  const turned = (s: ClientSession): [string, number, string] => [s.state, s.closeReason, s.closeText];
  const join = (name: string, key: Uint8Array, with_: Uint8Array): ClientSession => {
    const s = b.h.join(name, {}, { key, ticket: with_ });
    b.h.run(300);
    return s;
  };
  expect(turned(join("bea", keyAt("bea", 2), ticket))).toEqual(["closed", REJECT_TRAVEL, "that ticket is for ada, not for bea"]);
  const forged = ticket.slice();
  forged[31] = forged[31]! ^ 1;
  expect(turned(join("ada", keyAt("ada", 2), forged))).toEqual(["closed", REJECT_TRAVEL, "no survivor of this cluster is travelling with that ticket"]);
  expect(places(me.pid, folder, a, b)).toEqual(["sealed"]);
  const there = join("ada", keyAt("ada", 2), ticket);
  expect(there.state).toBe("active");
  // Another browser with the same ticket is refused. The one it was used for may join with it again, and nothing moves.
  expect(turned(join("ada", testKey("a thief"), ticket))).toEqual(["closed", REJECT_TRAVEL, "that ticket has been used"]);
  expect(places(me.pid, folder, a, b)).toEqual(["world 2"]);

  // Going back, the page waits past its ticket's time: the island refuses it, and Miami takes the survivor back.
  beat(a, b);
  const back = travel(b, there, a.world) as Uint8Array;
  clock.ms += TICKET_SECONDS * 1000;
  beat(a);
  const late = a.h.join("ada", {}, { key: keyAt("ada", 1), ticket: back });
  a.h.run(300);
  expect(turned(late)).toEqual(["closed", REJECT_TRAVEL, "that ticket has expired, and ada goes back to Miami"]);
  beat(b);
  expect(places(me.pid, folder, a, b)).toEqual(["world 2"]);
  const again = a.h.join("ada", {}, { key: keyAt("ada", 1), ticket: back });
  a.h.run(300);
  expect(turned(again)).toEqual(["closed", REJECT_TRAVEL, "ada went back to Miami"]);
  expect(t.audit(a, b)).toEqual([]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("a destination that will not take a survivor refuses before it leaves where that can be known, and otherwise it comes back whole", () => {
  const clock = { ms: Date.now() };
  // The servers run content with a thing that may not leave its server, as ARK's Element may not, but for one.
  const element = { type: "item", class: "resource", id: "core:element", stack: 100, weight: 0.01, color: 1, label: "Element", travels: false } as const;
  const own = compileContent([...CORE_CONTENT, element]).registry!;
  const a = t.server("Island", "refuse", clock, { reg: own });
  const b = t.server("Miami", "refuse", clock, { reg: own, maxClients: 2 });
  const c = t.server("Tampa", "refuse", clock, { reg: own, argv: ["?PreventDownloadSurvivors=True"] });
  const d = t.server("Keys", "refuse", clock);
  const folder = a.h.host.cluster!.folder;
  const { session, me } = t.survivor(a, "ada");
  const zed = t.survivor(a, "zed");
  a.h.host.items.mint(me, own.index.get("core:element")!, 3);
  // The name ada on Miami is someone else's.
  b.h.join("ada", {}, { key: testKey("another ada") });
  b.h.run(300);
  beat(a, b, c, d);
  const leave = (to: number): string => a.h.host.cluster!.leave(a.h.client(session)!, to);
  expect(leave(b.world)).toBe("you are carrying Element, which cannot be transferred: drop such items and try again");
  const inv = a.h.host.items.inv(me);
  a.h.host.items.burn(me, inv.item.indexOf(own.index.get("core:element")!), 3);
  expect(leave(b.world)).toBe("the name ada belongs to another survivor on Miami");
  expect(leave(c.world)).toBe("Tampa takes no survivors from other servers");
  expect(leave(d.world)).toBe("Keys runs other content, which what a survivor carries may not exist in");
  // Zed may go to Miami, and then Miami fills up before it arrives.
  const ticket = travel(a, zed.session, b.world) as Uint8Array;
  b.h.join("cy", {}, { key: keyAt("cy", 2) });
  b.h.run(300);
  beat(a, b);
  expect(leave(b.world)).toBe("Miami is full");
  expect(places(me.pid, folder, a, b, c, d)).toEqual(["world 1"]);
  const turned = b.h.join("zed", {}, { key: keyAt("zed", 2), ticket });
  b.h.run(300);
  expect([turned.state, turned.closeReason]).toEqual(["closed", REJECT_FULL]);
  // Its page goes back to the island, which gives it back whole.
  const home = a.h.join("zed", {}, { key: keyAt("zed", 1) });
  a.h.run(400);
  expect(home.state).toBe("active");
  expect(a.h.host.items.held(rec(a, "zed")!).get(own.index.get("core:stone")!)).toBe(40);
  expect(places(zed.me.pid, folder, a, b, c, d)).toEqual(["world 1"]);
  commit(a, b, c, d);
  expect(auditCluster(folder, own).lines).toEqual(["the cluster balances: 4 worlds, 2 transfers recorded, 0 on the way"]);
  for (const s of [a, b, c, d]) s.h.host.shutdown();
});

test("an operator asks a running server whether the cluster balances, and is told what does not", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "audit", clock);
  const b = t.server("Miami", "audit", clock);
  const folder = a.h.host.cluster!.folder;
  const { session } = t.survivor(a, "ada");
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  commit(a, b);
  expect(a.h.host.exec("cluster audit")).toBe("the cluster balances: 2 worlds, 1 transfers recorded, 1 on the way");
  b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  commit(a, b);
  expect(b.h.host.exec("cluster audit")).toBe("the cluster balances: 2 worlds, 2 transfers recorded, 0 on the way");
  beat(a, b);
  const came = folder.places()[0]!;
  expect(a.h.host.exec("cluster").split("\n").slice(1)).toEqual(["  world 2: Miami (proving:1), 1 of 70", `  ada left for Miami by transfer ${came.id}`]);
  // A file taken out of the folder by hand is missed.
  renameSync(join(folder.root, "parcels", came.file), join(t.dir, "taken out"));
  expect(a.h.host.exec("cluster audit").split("\n")).toEqual([
    `world 1 records that transfer ${came.id} left, and the folder has no file of it from there`,
    `world 2 records that transfer ${came.id} came, and the folder has no file of it taken there`,
  ]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("a save that was in a cluster starts only in it, with its own folder, and two saves never share a world", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "guards", clock);
  t.survivor(a, "ada");
  a.h.host.shutdown();
  const start = (argv: string[], db = a.db): string => {
    try {
      createHost(reg, { dbPath: db, config: loadConfig({}, argv).rules, log: () => {} }).shutdown();
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  };
  expect(start([])).toBe("this save is in the cluster test: start it with -clusterid=test and the folder it used, so that what left it can come back");
  expect(start(["-clusterid=other", `-ClusterDirOverride=${join(t.dir, "guards")}`])).toBe("this save is in the cluster test, not other: start it with -clusterid=test");
  expect(start(["-clusterid=test", `-ClusterDirOverride=${join(t.dir, "elsewhere")}`])).toStartWith(`this save is world 1 of the cluster test, and the folder ${join(t.dir, "elsewhere", "test")} does not know it`);
  // A save made alone numbers its records as world 1 too, which is taken here.
  const alone = join(t.dir, "alone.db");
  createHost(reg, { dbPath: alone, log: () => {} }).shutdown();
  expect(start(["-clusterid=test", `-ClusterDirOverride=${join(t.dir, "guards")}`], alone)).toStartWith(`world 1 of the cluster in ${join(t.dir, "guards", "test")} is the save ${a.db}`);
  // A new save takes the next world.
  const b = t.server("Miami", "guards", clock);
  expect(b.world).toBe(2);
  b.h.host.shutdown();
});

test("a transfer's file carries any record, as a save keeps it: a creature with its saddle and inventory, a loose stack", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "records", clock);
  const { records, items } = a.h.host;
  const rex = records.byPid.get(a.h.world.ents.pid[a.h.host.spawnCreature("core:parasaur", 240, 240, 12)]!)!;
  rex.saddle = id("saddle_parasaur");
  rex.team = 1 << 20;
  items.mint(rex, id("saddle_parasaur"), 1, 4);
  items.mint(rex, id("berry"), 20);
  const bag = records.create(id("bag"), "");
  items.mint(bag, id("stone"), 7);
  const head: ParcelHead = { format: PARCEL_FORMAT, id: "0".repeat(32), what: "creature", from: 1, to: 2, name: rex.name, pid: rex.pid, hop: 1, tick: a.h.world.tick, made: clock.ms, expires: 0, ticket: "", key: "", content: reg.baseHash, tribe: null, items: {}, pids: [rex.pid, bag.pid], seq: records.nextSeq, teams: records.nextTeam };
  const bytes = sealParcel(reg, head, [rex, bag]);
  const parcel = openParcel(bytes);
  expect(parcel.head).toEqual(head);
  const back = parcelRecords(reg, parcel);
  const plain = new RecordCodec(reg, Uint16Array.from(reg.ids, (_, i) => i), idMap(reg, reg.ids.map((s, i): [string, number] => [s, i]), reg.ids.length), false);
  const form = (r: typeof rex): string => Buffer.from(plain.encode(r)).toString("hex");
  expect(back.map((r) => [r.pid, r.kind, r.x, r.z, form(r)])).toEqual([rex, bag].map((r) => [r.pid, r.kind, r.x, r.z, form(r)]));
  expect([back[0]!.saddle, items.held(back[0]!).get(id("berry")), items.held(back[1]!).get(id("stone"))]).toEqual([id("saddle_parasaur"), 20, 7]);
  // A byte changed anywhere breaks the seal.
  const broken = bytes.slice();
  broken[broken.length - 3] = broken[broken.length - 3]! ^ 4;
  expect(() => openParcel(broken)).toThrow("its seal does not match what it holds");
  a.h.host.shutdown();
});

test("a tribe follows its members: one whose owner leaves passes to the member who stays, and the owner takes it back on return", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "tribe", clock);
  const b = t.server("Miami", "tribe", clock);
  const ada = t.survivor(a, "ada");
  const bea = t.survivor(a, "bea");
  const { tribes } = a.h.host;
  expect(tribes.create(ada.me, "Raptors")).toBe("");
  tribes.invite(ada.me, bea.me, true);
  expect(tribes.accept(bea.me)).toBe("");
  const team = ada.me.team;
  beat(a, b);
  const ticket = travel(a, ada.session, b.world) as Uint8Array;
  expect(tribes.of(bea.me)).toMatchObject({ id: team, owner: bea.me.pid, members: [bea.me.pid] });
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  expect(b.h.host.tribes.of(rec(b, "ada")!)).toMatchObject({ id: team, name: "Raptors", owner: ada.me.pid });
  beat(a, b);
  const back = travel(b, there, a.world) as Uint8Array;
  a.h.join("ada", {}, { key: keyAt("ada", 1), ticket: back });
  a.h.run(400);
  expect(tribes.of(rec(a, "ada")!)).toMatchObject({ id: team, owner: ada.me.pid, members: [bea.me.pid, ada.me.pid] });
  expect([rec(a, "ada")!.rank, bea.me.rank]).toEqual([2, 0]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});
