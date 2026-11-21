// Beds as a player meets them: set down, named, risen at after a death, travelled between, a sleeping bag used once, waits that
// outlast a restart, and a bed lost to its tribe, destroyed or walled in while its survivor chooses.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { BED_WAIT_TICKS } from "../../server/beds.ts";
import { NO_TARGET } from "../../server/build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CHOOSE_DIED, CHOOSE_TRAVEL, CMD_MOVE, CMD_PLACE, CMD_RESPAWN, CMD_SELECT, CMD_STRUCT, RESULT_DENIED, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_OBSTRUCTED, RESULT_OK, RESULT_STALE, RESULT_WAIT, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { ON_TOP } from "../../shared/world/snap.ts";
import { STRUCT_NAME, STRUCT_PICKUP, STRUCT_TRAVEL } from "../../shared/world/upkeep.ts";
import { builder } from "../fixtures/build.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
type Made = ReturnType<typeof builder>;

/** Sets down a foundation, given by cheat, on open ground at (x, z). Returns its ref. */
function foundation(made: Made, s: ClientSession, x: number, z: number): number {
  const { h } = made;
  const item = "piece_foundation_wood";
  h.say(s, `give ${item} 1`);
  const inv = s.inventory!;
  if (inv.item[inv.hotbar + 6] !== id(item)) s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.lastIndexOf(id(item))), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + 6), w.u16(0), w.u16(id(item))));
  h.run(100);
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(6));
  h.run(100);
  const before = h.host.build.placed;
  s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(x * U), 32), w.sbits(Math.round(z * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(150);
  expect(h.host.build.placed).toBe(before + 1);
  return h.host.build.last;
}

/** Sets down one `item`, given by cheat, at (x, z): on the ground, or on top of `on`. Returns the code and the new ref. */
function setDown(made: Made, s: ClientSession, item: string, x: number, z: number, on = NO_TARGET): { code: number; ref: number } {
  const { h } = made;
  h.say(s, `give ${item} 1`);
  const inv = s.inventory!;
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id(item))), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + 7), w.u16(0), w.u16(id(item))));
  h.run(100);
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(7));
  h.run(100);
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  const before = h.host.build.placed;
  s.command(CMD_PLACE, (w: BitWriter) => {
    w.u8(0);
    w.u32(on);
    if (on !== NO_TARGET) w.u8(ON_TOP);
    w.sbits(Math.round(x * U), 32);
    w.sbits(Math.round(z * U), 32);
    w.u16(0);
    if (on === NO_TARGET) w.sbits(0, 8);
    w.u8(0);
  });
  h.run(150);
  return { code, ref: h.host.build.placed > before ? h.host.build.last : -1 };
}

/** A bed set down on a new foundation at (x, z). Returns the bed's ref. */
function bedAt(made: Made, s: ClientSession, item: string, x: number, z: number): number {
  const placed = setDown(made, s, item, x, z, foundation(made, s, x, z));
  expect(placed.code).toBe(RESULT_OK);
  return placed.ref;
}

/** Walks up to the thing at `ref`, by cheat, and acts on it. Returns the code. */
function act(h: Harness, s: ClientSession, ref: number, action: number, name = ""): number {
  const t = h.world.structs.chunks[Math.floor(ref / 65536)]!;
  if (s.sessionState === SESSION_ALIVE) h.say(s, `tp ${(t.x[ref & 0xffff]! + 2).toFixed(3)} ${t.z[ref & 0xffff]!.toFixed(3)}`, 200);
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action), action === STRUCT_NAME && w.string(name)));
  h.run(150);
  return code;
}

/** Asks to rise at the place `s` was last told of under `name`, in the list it was told. Returns the code. */
function rise(h: Harness, s: ClientSession, name: string, list = s.placesList): number {
  const i = s.respawnPoints.findIndex((p) => p.name === name);
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_RESPAWN, (w: BitWriter) => (w.u8(i < 0 ? 254 : i), w.u8(list)));
  h.run(300);
  return code;
}

const names = (s: ClientSession): string[] => s.respawnPoints.map((p) => p.name);
const kindAt = (h: Harness, ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
const recOf = (h: Harness, s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
const bedRec = (h: Harness, ref: number) => h.host.fixtures.find(ref)!;

test("she sets a simple bed on her foundation and not on the ground, names it, dies and rises on it; it then waits five minutes and a bunk bed half that, and neither is picked up while it waits", () => {
  const made = builder(["ada", "bob"]);
  const { h, at } = made;
  const [ada, bob] = made.sessions as [ClientSession, ClientSession];
  h.say(ada, "setting AlwaysAllowStructurePickup True");
  // A simple bed goes on a foundation or a ceiling, as in ARK. On the ground it is refused.
  expect(setDown(made, ada, "piece_bed", at.x - 4, at.z + 4).code).toBe(RESULT_NO_SNAP);
  const home = setDown(made, ada, "piece_bed", at.x - 4, at.z + 6, foundation(made, ada, at.x - 4, at.z + 6)).ref;
  expect(kindAt(h, home)).toBe(id("bed"));
  // Its tribe names it. Nobody else may.
  expect([act(h, ada, home, STRUCT_NAME, "Home"), act(h, bob, home, STRUCT_NAME, "Mine")]).toEqual([RESULT_OK, RESULT_NOT_YOURS]);

  // Dead, she is offered the map's spawn points and then Home. Bob, of no tribe of hers, is offered only the spawn points.
  h.say(ada, "suicide");
  h.say(bob, "suicide");
  const spawns = h.world.spawns.map((p) => p.name);
  expect([ada.choosing, names(ada), names(bob)]).toEqual([CHOOSE_DIED, [...spawns, "Home"], spawns]);
  expect(ada.respawnPoints.at(-1)!.kind).toBe(id("bed"));
  expect([rise(h, ada, "Home"), ada.sessionState]).toEqual([RESULT_OK, SESSION_ALIVE]);
  const t = h.world.structs.chunks[Math.floor(home / 65536)]!;
  expect([Math.hypot(ada.own.x - t.x[home & 0xffff]!, ada.own.z - t.z[home & 0xffff]!) < 0.05, Math.abs(ada.own.y - (t.y[home & 0xffff]! + reg.halfY[id("bed")]!)) < 0.05]).toEqual([true, true]);
  // Five minutes for anyone, and it cannot be picked up and set down again ready meanwhile (Ascended).
  expect(bedRec(h, home).readyAt - h.world.tick).toBeGreaterThan(BED_WAIT_TICKS - 20);
  expect(act(h, ada, home, STRUCT_PICKUP)).toBe(RESULT_WAIT);
  h.say(ada, "suicide");
  expect([ada.respawnPoints.at(-1)!.readyAt > h.world.tick, rise(h, ada, "Home"), ada.sessionState]).toEqual([true, RESULT_WAIT, SESSION_DEAD]);
  expect(rise(h, ada, spawns[0]!)).toBe(RESULT_OK);

  // A bunk bed, given since nothing makes one yet, waits half as long, and she gets up beside it on the floor it stands on.
  h.say(ada, `tp ${at.x + 4} ${at.z + 2}`);
  const bunk = bedAt(made, ada, "piece_bunk_bed", at.x + 4, at.z + 8);
  h.say(ada, "suicide");
  expect(rise(h, ada, "bunk bed")).toBe(RESULT_OK);
  const b = h.world.structs.chunks[Math.floor(bunk / 65536)]!;
  const [bx, by, bz] = [b.x[bunk & 0xffff]!, b.y[bunk & 0xffff]!, b.z[bunk & 0xffff]!];
  expect([Math.abs(ada.own.x - (bx + 1.5)) < 0.05, Math.abs(ada.own.z - bz) < 0.05, Math.abs(ada.own.y - (by - 1.25)) < 0.05]).toEqual([true, true, true]);
  expect(bedRec(h, bunk).readyAt - h.world.tick).toBeGreaterThan(150 * TICK_RATE - 20);
  expect(bedRec(h, bunk).readyAt - h.world.tick).toBeLessThanOrEqual(150 * TICK_RATE);
  // Once its wait is over it may be picked up.
  bedRec(h, home).readyAt = h.world.tick + 3;
  h.run(300);
  expect([act(h, ada, home, STRUCT_PICKUP), ada.inventory!.total(id("piece_bed"))]).toEqual([RESULT_OK, 1]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a sleeping bag is hers alone and for once: a tribe mate is not offered it, it is gone once she rises at it, and on a PvP server her bag near it then waits while one far off does not", () => {
  const made = builder(["ada", "bob"]);
  const { h, at } = made;
  const [ada, bob] = made.sessions as [ClientSession, ClientSession];
  h.say(ada, "tribe create Nomads");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  // A sleeping bag goes where a campfire does: on the ground.
  const first = setDown(made, ada, "piece_sleeping_bag", at.x - 3, at.z + 4).ref;
  const near = setDown(made, ada, "piece_sleeping_bag", at.x + 3, at.z + 4).ref;
  h.say(ada, `tp ${at.x} ${at.z + 140}`);
  h.run(500);
  const far = setDown(made, ada, "piece_sleeping_bag", ada.own.x + 2, ada.own.z).ref;
  expect([first, near, far].map((r) => kindAt(h, r))).toEqual([id("sleeping_bag"), id("sleeping_bag"), id("sleeping_bag")]);
  h.say(ada, "suicide");
  h.say(bob, "suicide");
  const spawns = h.world.spawns.length;
  expect([ada.respawnPoints.length, bob.respawnPoints.length]).toEqual([spawns + 3, spawns]);
  const bagAt = (ref: number): number => ada.respawnPoints.findIndex((p) => p.kind === id("sleeping_bag") && Math.abs(p.x - h.world.structs.chunks[Math.floor(ref / 65536)]!.x[ref & 0xffff]!) < 0.01);
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  ada.command(CMD_RESPAWN, (w: BitWriter) => (w.u8(bagAt(first)), w.u8(ada.placesList)));
  h.run(300);
  expect([code, ada.sessionState, kindAt(h, first)]).toEqual([RESULT_OK, SESSION_ALIVE, 0]);
  // Her other bag 6 m off now waits five minutes; the one 140 m off does not.
  expect([bedRec(h, near).readyAt - h.world.tick > BED_WAIT_TICKS - 20, bedRec(h, far).readyAt]).toEqual([true, 0]);
  h.say(ada, "suicide");
  expect(ada.respawnPoints.length).toBe(spawns + 2);
  // On a PvE server the bag near the one used does not wait.
  h.say(ada, "setting serverPVE True");
  bedRec(h, near).readyAt = 0;
  ada.command(CMD_RESPAWN, (w: BitWriter) => (w.u8(bagAt(far)), w.u8(ada.placesList)));
  h.run(300);
  expect([ada.sessionState, kindAt(h, far), bedRec(h, near).readyAt]).toEqual([SESSION_ALIVE, 0, 0]);
});

test("she travels from the bed at home to the one at her outpost: all she carried lies once in a bag at home, she arrives with nothing and her health as it was, the outpost's bed waits and home's does not", () => {
  const made = builder(["ada", "bob"], 40, 40);
  const { h, at } = made;
  const [ada, bob] = made.sessions as [ClientSession, ClientSession];
  const home = bedAt(made, ada, "piece_bed", at.x - 4, at.z + 6);
  act(h, ada, home, STRUCT_NAME, "Home");
  // With one bed there is nowhere to go.
  expect([act(h, ada, home, STRUCT_TRAVEL), ada.sessionState]).toEqual([RESULT_INVALID, SESSION_ALIVE]);
  h.say(ada, `tp ${at.x + 6} ${at.z + 30}`);
  const outpost = bedAt(made, ada, "piece_bed", at.x + 6, at.z + 34);
  act(h, ada, outpost, STRUCT_NAME, "Outpost");
  h.say(ada, `tp ${at.x - 4} ${at.z + 3}`);
  h.say(ada, "give stone 40");
  h.say(ada, "armor flak");
  const rec = recOf(h, ada);
  h.host.survival.add(rec, V_HEALTH, -30);
  const carried = h.host.items.inv(rec).used();
  // Another tribe's bed is not hers to travel from.
  expect(act(h, bob, home, STRUCT_TRAVEL)).toBe(RESULT_NOT_YOURS);
  expect(act(h, ada, home, STRUCT_TRAVEL)).toBe(RESULT_OK);
  h.run(200);
  // Out of the world her vitals stand still: she arrives as she left, not refilled as the dead are.
  const health = h.host.survival.value(rec, V_HEALTH);
  expect(health).toBeLessThan(75);
  // She has no body and chooses among her beds, the one she left first; the map's spawn points are not offered.
  expect([ada.sessionState, ada.choosing, names(ada)]).toEqual([SESSION_DEAD, CHOOSE_TRAVEL, ["Home", "Outpost"]]);
  const bags = [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag") && r.inv && r.inv.used() > 0);
  const t = h.world.structs.chunks[Math.floor(home / 65536)]!;
  expect(bags.length).toBe(1);
  expect([bags[0]!.inv!.used(), Math.hypot(bags[0]!.x - t.x[home & 0xffff]!, bags[0]!.z - t.z[home & 0xffff]!) < 0.05, bags[0]!.inv!.total(id("stone"))]).toEqual([carried, true, 40]);
  // Her own screen shows her carrying nothing.
  expect([h.host.items.inv(rec).used(), ada.inventory!.used(), h.host.items.audit()]).toEqual([0, 0, []]);
  expect(rise(h, ada, "Outpost")).toBe(RESULT_OK);
  h.run(200);
  const o = h.world.structs.chunks[Math.floor(outpost / 65536)]!;
  expect([ada.sessionState, Math.hypot(ada.own.x - o.x[outpost & 0xffff]!, ada.own.z - o.z[outpost & 0xffff]!) < 0.05]).toEqual([SESSION_ALIVE, true]);
  // A moment of mending since she stood up, and no more.
  expect(h.host.survival.value(rec, V_HEALTH) - health).toBeLessThan(0.5);
  expect([h.host.items.inv(rec).used(), rec.dead]).toEqual([0, false]);
  expect([bedRec(h, outpost).readyAt > h.world.tick, bedRec(h, home).readyAt]).toEqual([true, 0]);

  // To go back to the bed she left is to stay, whatever it waits.
  expect(act(h, ada, outpost, STRUCT_TRAVEL)).toBe(RESULT_OK);
  h.run(200);
  expect([names(ada), ada.respawnPoints[0]!.readyAt, rise(h, ada, "Outpost")]).toEqual([["Outpost", "Home"], 0, RESULT_OK]);
  expect([bedRec(h, home).readyAt, h.host.items.audit()]).toEqual([0, []]);
  // Not knocked out.
  rec.out = true;
  expect(act(h, ada, outpost, STRUCT_TRAVEL)).toBe(RESULT_DENIED);
  rec.out = false;
});

test("she travels between beds in the Meridian set she was issued: the bag at the bed she left holds none of it, and she rises in a whole new one", () => {
  const made = builder(["ada"], 40, 40, { config: asShipped() });
  const { h, at } = made;
  const ada = made.sessions[0]!;
  const home = bedAt(made, ada, "piece_bed", at.x - 4, at.z + 6);
  h.say(ada, `tp ${at.x + 6} ${at.z + 30}`);
  const outpost = bedAt(made, ada, "piece_bed", at.x + 6, at.z + 34);
  act(h, ada, outpost, STRUCT_NAME, "Outpost");
  const items = h.host.items;
  const rec = recOf(h, ada);
  const suit = ["hat", "shirt", "gloves", "pants", "boots"].map((piece) => id(`meridian_${piece}`));
  const inv = items.inv(rec);
  expect([...inv.item.slice(inv.armor, inv.armor + 5)]).toEqual(suit);
  const mount = h.host.mounts.of(rec)!.pid;
  // The helmet taken off, and the boots worn down.
  expect(items.move(rec, inv.armor, rec, inv.free(), 0)).toBe(1);
  items.wear(rec, inv.armor + 4, 100);
  h.say(ada, "give stone 40");
  expect(act(h, ada, home, STRUCT_TRAVEL)).toBe(RESULT_OK);
  h.run(200);
  const bags = [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag") && r.inv && r.inv.used() > 0);
  expect(bags.length).toBe(1);
  expect([bags[0]!.inv!.total(id("stone")), suit.some((piece) => bags[0]!.inv!.item.includes(piece))]).toEqual([40, false]);
  expect(rise(h, ada, "Outpost")).toBe(RESULT_OK);
  const now = items.inv(rec);
  expect([...now.item.slice(now.armor, now.armor + 5)]).toEqual(suit);
  expect([...now.dur.slice(now.armor, now.armor + 5)]).toEqual(suit.map((piece) => items.maxDur(piece, 0)));
  // Beside it, the soul ball of her starter mount, which went with her and holds the same pteranodon (server/mount.ts).
  expect([now.used(), now.item[now.hotbar], now.refOf(now.hotbar), suit.map((piece) => items.total(piece)), items.audit()]).toEqual([6, id("soul_ball_full"), mount, [1, 1, 1, 1, 1], []]);
});

test("a bed destroyed, walled in by another tribe, or no longer hers because she was put out of the tribe while she chose is not risen at, and the list she is sent loses it", () => {
  const made = builder(["ada", "bob", "cy"]);
  const { h, at } = made;
  const [ada, bob, cy] = made.sessions as [ClientSession, ClientSession, ClientSession];
  h.say(bob, "tribe create Hill");
  h.say(bob, "tribe invite ada");
  h.say(ada, "tribe accept");
  const left = bedAt(made, ada, "piece_bed", at.x - 6, at.z + 6);
  const right = bedAt(made, ada, "piece_bed", at.x + 6, at.z + 6);
  act(h, ada, left, STRUCT_NAME, "Left");
  act(h, ada, right, STRUCT_NAME, "Right");
  const bag = setDown(made, ada, "piece_sleeping_bag", at.x, at.z + 14).ref;
  act(h, ada, bag, STRUCT_NAME, "Bag");

  // Destroyed while she chooses: asked for before the news reaches her, it is refused; then it is no longer listed.
  h.say(ada, "suicide");
  expect(names(ada).slice(-3)).toEqual(["Left", "Right", "Bag"]);
  const list = ada.placesList;
  h.world.structs.damage(left, 1e9, h.world.tick);
  expect(rise(h, ada, "Left", list)).toBe(RESULT_INVALID);
  expect([names(ada).includes("Left"), rise(h, ada, "Right", list)]).toEqual([false, RESULT_STALE]);

  // Walled in by another tribe's pieces, the bag is refused. With a way out, it is not.
  const g = h.world.structs.chunks[Math.floor(bag / 65536)]!;
  const [gx, gy, gz] = [g.x[bag & 0xffff]!, g.y[bag & 0xffff]!, g.z[bag & 0xffff]!];
  const theirs = recOf(h, cy).team;
  const wall = id("wall_wood");
  const walls = [[0, 1.4], [0, -1.4], [1.4, 0], [-1.4, 0]].map(([dx, dz]) => h.world.structs.add(wall, gx + dx!, gy + 1.5, gz + dz!, dx === 0 ? 0 : 16384, theirs, 1000));
  h.run(200);
  expect(rise(h, ada, "Bag")).toBe(RESULT_OBSTRUCTED);
  h.world.structs.remove(walls[0]!);
  h.run(200);
  expect(rise(h, ada, "Bag")).toBe(RESULT_OK);
  expect(kindAt(h, bag)).toBe(0);

  // Put out of the tribe while she chooses, its beds are no longer hers.
  h.say(ada, "suicide");
  expect(names(ada).at(-1)).toBe("Right");
  const before = ada.placesList;
  expect(h.host.tribes.kick(recOf(h, bob), "ada")).toBe("");
  expect(rise(h, ada, "Right", before)).toBe(RESULT_INVALID);
  expect([names(ada).includes("Right"), recOf(h, ada).team !== recOf(h, bob).team]).toEqual([false, true]);
  expect(rise(h, ada, h.world.spawns[0]!.name)).toBe(RESULT_OK);
});

test("a bed's wait outlasts leaving and joining and a restart; so does a journey half made, which goes on with what she had and her things where she left them; and on a PvP server deaths at another tribe's hands make her wait at every place, across a restart too", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-beds-"));
  const dbPath = joinPath(dir, "world.db");
  try {
    const made = builder(["ada", "bob"], 40, 40, { dbPath });
    let { h } = made;
    const { at } = made;
    const [ada] = made.sessions as [ClientSession, ClientSession];
    const home = bedAt(made, ada, "piece_bed", at.x - 4, at.z + 6);
    act(h, ada, home, STRUCT_NAME, "Home");
    const camp = bedAt(made, ada, "piece_bed", at.x + 6, at.z + 6);
    act(h, ada, camp, STRUCT_NAME, "Camp");
    h.say(ada, "suicide");
    expect(rise(h, ada, "Home")).toBe(RESULT_OK);
    const readyAt = bedRec(h, home).readyAt;
    // She leaves and comes back: Home still waits, to the same tick.
    h.ends[0]!.close();
    h.run(300);
    let again = h.join("ada");
    h.run(600);
    h.say(again, "enablecheats");
    h.say(again, "suicide");
    expect(again.respawnPoints.find((p) => p.name === "Home")!.readyAt).toBe(readyAt);
    expect(rise(h, again, "Camp")).toBe(RESULT_OK);

    // She sets out from Camp with stone and a wound. The server stops while she chooses, and comes back with her choosing
    // still, her stone in one bag at Camp, and Home waiting to the same tick.
    bedRec(h, camp).readyAt = 0;
    h.say(again, "give stone 25");
    const rec = recOf(h, again);
    h.host.survival.add(rec, V_HEALTH, -20);
    expect(act(h, again, camp, STRUCT_TRAVEL)).toBe(RESULT_OK);
    h.run(300);
    const health = h.host.survival.value(rec, V_HEALTH);
    h.host.shutdown();
    h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
    again = h.join("ada");
    h.run(600);
    expect([again.sessionState, again.choosing, names(again)]).toEqual([SESSION_DEAD, CHOOSE_TRAVEL, ["Camp", "Home"]]);
    const bags = [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag") && (r.inv?.total(id("stone")) ?? 0) > 0);
    expect([bags.length, bags[0]?.inv?.total(id("stone")), h.host.items.audit(), again.respawnPoints[1]!.readyAt]).toEqual([1, 25, [], readyAt]);
    expect(rise(h, again, "Home")).toBe(RESULT_WAIT);
    h.host.fixtures.find(home)!.readyAt = 0;
    expect(rise(h, again, "Home")).toBe(RESULT_OK);
    const back = recOf(h, again);
    expect(h.host.survival.value(back, V_HEALTH) - health).toBeLessThan(0.5);
    expect([h.host.items.inv(back).total(id("stone")), back.dead]).toEqual([0, false]);

    // Killed by bob, of another tribe, twice within five minutes: the second time every place waits a minute.
    const bob = h.join("bob");
    h.run(600);
    const killer = h.client(bob)!.pid;
    h.host.survival.hurt(back, 1000, killer);
    h.run(300);
    expect(again.respawnPoints[0]!.readyAt).toBe(0);
    expect(rise(h, again, h.world.spawns[0]!.name)).toBe(RESULT_OK);
    h.host.survival.hurt(back, 1000, killer);
    h.run(300);
    const spawn = again.respawnPoints[0]!;
    expect(Math.round((spawn.readyAt - h.world.tick) / TICK_RATE)).toBe(60);
    expect(rise(h, again, spawn.name)).toBe(RESULT_WAIT);
    h.host.shutdown();
    h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
    again = h.join("ada");
    h.run(600);
    expect([again.sessionState, again.respawnPoints[0]!.readyAt]).toEqual([SESSION_DEAD, spawn.readyAt]);
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("on a PvP server the wait to rise after deaths at other tribes' hands follows its four settings, and a death by one's own tribe, or on a PvE server, adds none", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(600);
  h.say(ada, "enablecheats");
  const rec = recOf(h, ada);
  const beds = h.host.beds;
  const other = rec.team + 1000;
  /** Seconds every place waits after one more death by `team`, as she would be told. */
  const wait = (team = other): number => {
    beds.died(rec, team);
    const p = beds.places(rec, CHOOSE_DIED)[0]!;
    return p.readyAt === 0 ? 0 : Math.round((p.readyAt - h.world.tick) / TICK_RATE);
  };
  // bIncreasePvPRespawnInterval, IncreasePvPRespawnIntervalBaseAmount, IncreasePvPRespawnIntervalMultiplier at their defaults.
  // A death by her own tribe neither counts nor ends the wait there is.
  expect([wait(), wait(), wait(), wait(rec.team), wait()]).toEqual([0, 60, 120, 120, 240]);
  h.say(ada, "setting IncreasePvPRespawnIntervalBaseAmount 30");
  h.say(ada, "setting IncreasePvPRespawnIntervalMultiplier 3");
  expect(wait()).toBe(30 * 3 ** 3);
  // Past IncreasePvPRespawnIntervalCheckPeriod since the last, the count starts again.
  h.say(ada, "setting IncreasePvPRespawnIntervalCheckPeriod 2");
  h.run(3000);
  expect([wait(), wait()]).toEqual([0, 30]);
  h.say(ada, "setting bIncreasePvPRespawnInterval False");
  expect(wait()).toBe(0);
  h.say(ada, "setting bIncreasePvPRespawnInterval True");
  h.say(ada, "setting serverPVE True");
  expect(wait()).toBe(0);
});

test("nobody travels from a bed while sitting in a car: she gets out first, as off a mount", () => {
  const made = builder(["ada"], 40, 40);
  const { h, at } = made;
  const [ada] = made.sessions as [ClientSession];
  const home = bedAt(made, ada, "piece_bed", at.x - 4, at.z + 6);
  h.say(ada, `tp ${at.x + 6} ${at.z + 30}`);
  bedAt(made, ada, "piece_bed", at.x + 6, at.z + 34);
  h.say(ada, `tp ${at.x + 0.05} ${at.z + 6.1}`, 300);
  const me = h.client(ada)!;
  const car = h.host.spawnVehicle("core:compact", at.x - 1.45, at.z + 6, recOf(h, ada).team, 0);
  expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
  h.run(800);
  expect(me.drive).toBe(car);
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  ada.command(CMD_STRUCT, (w: BitWriter) => (w.u32(home), w.u8(STRUCT_TRAVEL)));
  h.run(150);
  expect([code, ada.sessionState, me.drive]).toEqual([RESULT_DENIED, SESSION_ALIVE, car]);
});
