// What is done to a piece after it is built: taken back, mended, taken down,
// and left to decay.

import { expect, test } from "bun:test";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { App } from "../../client/core/app.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { KEY_STRUCT_BUTTON, KEY_STRUCT_DETAIL, KEY_STRUCT_HEALTH, KEY_STRUCT_PANEL, KEY_STRUCT_TITLE, STRUCT_REASONS, structName } from "../../client/core/ui/structure.ts";
import { DECAY_EVERY } from "../../server/decay.ts";
import { NO_TARGET } from "../../server/build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_PLACE, CMD_SELECT, RESULT_DAMAGED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ACT_REACH, REPAIR_WAIT_TICKS, STRUCT_DEMOLISH, STRUCT_PICKUP, STRUCT_REPAIR, cost, refundOf, repairCostOf } from "../../shared/world/upkeep.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import { flatGround } from "../fixtures/arena.ts";
import { PIECES, STOCK, builder } from "../fixtures/build.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;

/** Set a foundation on open ground `dx`, `dz` metres from where the builders stand, and return its ref. */
function found(made: ReturnType<typeof builder>, s: ClientSession, dx: number, dz: number, piece = "foundation"): number {
  const { h, at } = made;
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(PIECES.indexOf(piece)));
  h.run(100);
  const before = h.host.build.placed;
  s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round((at.x + dx) * U), 32), w.sbits(Math.round((at.z + dz) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  expect(h.host.build.placed).toBe(before + 1);
  return h.host.build.last;
}

test("the arithmetic of it: half back for taking down, the missing part for mending, each thing rounded its own way", () => {
  // A wooden wall is 40 wood, 10 thatch and 7 fiber.
  const wall = id("wall_wood");
  const named = (): [string, number][] => Array.from({ length: cost.n }, (_, k) => [reg.ids[cost.item[k]!]!, cost.count[k]!]);
  expect(refundOf(reg, wall)).toBe(true);
  expect(named()).toEqual([["core:wood", 20], ["core:thatch", 5], ["core:fiber", 3]]);
  // A quarter gone: a quarter of each, and never less than the part of one.
  expect(repairCostOf(reg, wall, 7500)).toBe(true);
  expect(named()).toEqual([["core:wood", 10], ["core:thatch", 3], ["core:fiber", 2]]);
  expect(repairCostOf(reg, wall, 9999)).toBe(true);
  expect(named()).toEqual([["core:wood", 1], ["core:thatch", 1], ["core:fiber", 1]]);
  // Whole, there is nothing to mend; a doorframe is made of what a wall is, being set down from one.
  expect(repairCostOf(reg, wall, 10000)).toBe(false);
  expect(refundOf(reg, id("doorframe_wood"))).toBe(true);
  expect(named()[0]).toEqual(["core:wood", 20]);
  // Something nobody makes gives nothing back.
  expect(refundOf(reg, id("block"))).toBe(false);
  expect([structName(reg, wall), structName(reg, id("doorframe_wood")), structName(reg, id("foundation_stone")), structName(reg, id("block"))]).toEqual(["wooden wall", "wooden doorframe", "stone foundation", "block"]);
  expect([REPAIR_WAIT_TICKS, ACT_REACH]).toEqual([180 * TICK_RATE, 4]);
});

test("a piece is taken back while it is whole, mended for the part that is missing once it has been left alone, and taken down for half of what it is made of", () => {
  const made = builder(["ada", "bob"]);
  const { h, sessions, at, join, count, structs, act, has } = made;
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const there = (ref: number): boolean => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
  const hp = (ref: number): number => structs.chunks[Math.floor(ref / 65536)]!.hp[ref & 0xffff]!;
  const f = found(made, ada, 0, 5);
  const wall = join(ada, "wall", f, 2).ref;
  expect([count(ada, "foundation"), count(ada, "wall")]).toEqual([STOCK - 1, STOCK - 1]);

  // Taken back: it is in her hands again and gone from the world, hers and everyone's.
  expect(act(ada, wall, STRUCT_PICKUP)).toBe(RESULT_OK);
  expect([there(wall), count(ada, "wall"), h.host.build.pickedUp]).toEqual([false, STOCK, 1]);
  expect(bob.world!.structs.chunks[Math.floor(wall / 65536)]!.kind[wall & 0xffff]).toBe(0);
  // Not by someone of another tribe, whatever he asks; nor is what is not there anyone's to act on, nor an action that is none.
  for (const action of [STRUCT_PICKUP, STRUCT_DEMOLISH, STRUCT_REPAIR]) expect(act(bob, f, action)).toBe(RESULT_NOT_YOURS);
  expect([act(ada, wall, STRUCT_PICKUP), act(ada, f, 9), act(ada, 0x7fff0000, STRUCT_DEMOLISH)]).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_INVALID]);
  // Not from far off.
  h.say(ada, `tp ${at.x.toFixed(3)} ${(at.z + 16).toFixed(3)}`);
  expect(act(ada, f, STRUCT_PICKUP)).toBe(RESULT_FAR);
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);

  // Harmed, it cannot be taken back; and it cannot be mended while the harm is fresh, nor without the means.
  const second = join(ada, "wall", f, 2).ref;
  structs.damage(second, 2500, h.world.tick);
  h.host.build.hurt(second);
  h.run(100);
  expect([act(ada, second, STRUCT_PICKUP), act(ada, second, STRUCT_REPAIR)]).toEqual([RESULT_DAMAGED, RESULT_WAIT]);
  // Three minutes on (all but a second of them gone by already):
  h.host.build.hurt(second, h.world.tick - REPAIR_WAIT_TICKS + TICK_RATE);
  expect(act(ada, second, STRUCT_REPAIR)).toBe(RESULT_WAIT);
  h.run(1000);
  expect(act(ada, second, STRUCT_REPAIR)).toBe(RESULT_SHORT);
  for (const what of ["wood", "thatch", "fiber"]) h.say(ada, `give ${what} 50`);
  expect(act(ada, second, STRUCT_REPAIR)).toBe(RESULT_OK);
  // A quarter of it was missing: a quarter of 40, 10 and 7, each rounded up.
  expect([hp(second), has(ada, "wood"), has(ada, "thatch"), has(ada, "fiber")]).toEqual([10000, 40, 47, 48]);
  expect(bob.world!.structs.chunks[Math.floor(second / 65536)]!.hp[second & 0xffff]).toBe(10000);
  expect([act(ada, second, STRUCT_REPAIR), act(ada, second, STRUCT_PICKUP)]).toEqual([RESULT_INVALID, RESULT_OK]);

  // Taken down: gone, and half of what a wall is made of comes back.
  const third = join(ada, "wall", f, 2).ref;
  expect(act(ada, third, STRUCT_DEMOLISH)).toBe(RESULT_OK);
  expect([there(third), count(ada, "wall"), has(ada, "wood"), has(ada, "thatch"), has(ada, "fiber")]).toEqual([false, STOCK - 1, 60, 52, 51]);
  expect([h.host.build.pickedUp, h.host.build.demolished, h.host.build.repaired, h.host.build.fallen]).toEqual([2, 1, 1, 0]);

  // With the rule that a piece may be taken back only for a while: after that it may not, though it may still be taken down.
  h.say(ada, "rule pickupSeconds 2");
  const late = join(ada, "wall", f, 2).ref;
  const soon = join(ada, "wall", f, 1).ref;
  expect(act(ada, soon, STRUCT_PICKUP)).toBe(RESULT_OK);
  h.run(2500);
  expect([act(ada, late, STRUCT_PICKUP), act(ada, late, STRUCT_DEMOLISH)]).toEqual([RESULT_WAIT, RESULT_OK]);
  expect(h.host.items.audit()).toEqual([]);
  expect([STRUCT_REASONS[RESULT_DAMAGED], STRUCT_REASONS[RESULT_SHORT]]).toEqual(["It is damaged: mend it first", "Not enough for that"]);
});

test("what stood on a piece that is taken back or taken down comes back the same way and does not break; what does not fit in the hands lies in a cache", () => {
  const made = builder(["ada", "bob"]);
  const { h, sessions, join, count, structs, act, has } = made;
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const team = h.host.records.byPid.get(h.client(ada)!.pid)!.team;
  const mine = (): number => {
    let n = 0;
    for (const t of structs.chunks) if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === team) n++;
    return n;
  };
  /** A foundation with a wall on each side, a wall on one of those, and a floor over it: seven pieces. */
  const hut = (dx: number): number => {
    const f = found(made, ada, dx, 5);
    const walls = [0, 1, 2, 3].map((k) => join(ada, "wall", f, k).ref);
    expect(join(ada, "wall", walls[0]!, 0).code).toBe(RESULT_OK);
    expect(join(ada, "ceiling", walls[1]!, 1).code).toBe(RESULT_OK);
    return f;
  };
  const first = hut(0);
  expect([mine(), count(ada, "foundation"), count(ada, "wall"), count(ada, "ceiling")]).toEqual([7, STOCK - 1, STOCK - 5, STOCK - 1]);
  // The foundation is taken back. Everything that stood on it comes down with nothing to hold it, and comes back as pieces.
  const seen = bob.rubble.length;
  expect(act(ada, first, STRUCT_PICKUP)).toBe(RESULT_OK);
  h.run(1500);
  expect([mine(), count(ada, "foundation"), count(ada, "wall"), count(ada, "ceiling")]).toEqual([0, STOCK, STOCK, STOCK]);
  expect([h.host.build.pickedUp, h.host.build.returned, h.host.build.fallen, h.host.build.collapse.claimed, h.host.build.pending]).toEqual([1, 6, 0, 6, 0]);
  // Nobody watching saw anything fall: the pieces were simply taken away.
  expect(bob.rubble.length).toBe(seen);
  expect(bob.world!.structs.chunks.every((t) => !t || t.kind.subarray(0, t.high).every((k, s) => k === 0 || t.owner[s] !== team))).toBe(true);

  // Taken down instead, each piece gives half of what it is made of: a foundation 80/20/15, five walls 40/10/7, a floor 60/15/10.
  const next = hut(0);
  expect(act(ada, next, STRUCT_DEMOLISH)).toBe(RESULT_OK);
  h.run(1500);
  expect(mine()).toBe(0);
  expect([has(ada, "wood"), has(ada, "thatch"), has(ada, "fiber")]).toEqual([40 + 5 * 20 + 30, 10 + 5 * 5 + 7, 7 + 5 * 3 + 5]);
  expect([h.host.build.demolished, h.host.build.returned, h.host.build.fallen]).toEqual([1, 12, 0]);

  // Her hands full of things that do not stack: a piece she has none of cannot be taken back.
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const third = hut(6);
  const pillar = found(made, ada, 2, 3, "pillar");
  h.say(ada, `tp ${(made.at.x + 4).toFixed(3)} ${(made.at.z + 2).toFixed(3)}`);
  h.host.items.burnItem(rec, id("piece_pillar_wood"), count(ada, "pillar"));
  while (h.host.items.mint(rec, id("hatchet"), 1) === 1);
  h.run(300);
  expect(act(ada, pillar, STRUCT_PICKUP)).toBe(RESULT_FULL);
  expect(mine()).toBe(8);
  // Taken down, the hut gives back what will not fit: it lies in a cache where the hut stood, all of it.
  const wood = has(ada, "wood");
  const caches = (): { name: string; inv: ReturnType<typeof h.host.items.inv> }[] => [...h.host.records.byPid.values()].filter((r) => r.name === "building materials").map((r) => ({ name: r.name, inv: h.host.items.inv(r) }));
  expect(caches().length).toBe(0);
  expect(act(ada, third, STRUCT_DEMOLISH)).toBe(RESULT_OK);
  h.run(1500);
  expect(mine()).toBe(1);
  const spilled = caches();
  expect(spilled.length).toBe(1);
  // Wood she holds a stack of with room in it took some; the rest is in the cache.
  const back = { wood: 40 + 5 * 20 + 30 };
  expect(has(ada, "wood") - wood + spilled[0]!.inv.total(id("wood"))).toBe(back.wood);
  expect(spilled[0]!.inv.total(id("wood"))).toBeGreaterThan(0);
  expect(h.host.items.audit()).toEqual([]);
  expect(ada.stats.undecodable + bob.stats.undecodable).toBe(0);
});

test("what its tribe has not come near decays: anyone may take it down then, a piece by itself soonest; coming near winds the clock; and the clocks are kept with the world", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-decay-"));
  const dbPath = joinPath(dir, "world.db");
  let made = builder(["ada", "bob"], 40, 40, { dbPath });
  let { h, sessions, join, structs, act, has } = made;
  let [ada, bob] = sessions as [ClientSession, ClientSession];
  const decay = () => h.host.build.decay;
  // A wall on a foundation, and a foundation by itself.
  const f = found(made, ada, 0, 5);
  const wall = join(ada, "wall", f, 2).ref;
  const alone = found(made, ada, 6, 5);
  h.say(bob, `tp ${(made.at.x + 5).toFixed(3)} ${(made.at.z + 2).toFixed(3)}`);
  // As ARK has it, nothing decays on a server that is not PvE unless it is switched on; and a foundation joined to nothing
  // decays no sooner than anything else unless that is switched on, and then in a time of its own.
  expect([decay().active(), decay().period(id("foundation_wood"), true) === decay().period(id("foundation_wood"), false)]).toEqual([false, true]);
  expect(h.say(ada, "setting PvPStructureDecay True")[0]).toContain("PvPStructureDecay=True");
  expect(decay().active()).toBe(true);
  h.say(ada, "setting FastDecayUnsnappedCoreStructures True");
  expect(decay().period(id("foundation_wood"), true)).toBe(43200 * TICK_RATE);
  // Wood lasts eight days unvisited. Here, a ten-thousandth of that, 69 s; and a foundation by itself, four seconds.
  h.say(ada, "rule decayTime 0.0001");
  h.say(ada, "setting FastDecayInterval 4");
  expect([decay().period(id("wall_wood"), false), decay().period(id("foundation_wood"), true), decay().period(id("wall_thatch"), false), decay().period(id("wall_stone"), false), decay().period(id("wall_metal"), true)]).toEqual([2074, 120, 1037, 3110, 120]);
  // While she is there, nothing of hers decays, however long.
  h.run(8000);
  expect([decay().expired(alone, h.world.tick), act(bob, alone, STRUCT_DEMOLISH)]).toEqual([false, RESULT_NOT_YOURS]);
  // She goes. Five seconds on (and the five between looks) the foundation by itself has decayed; the other, and its wall, have not.
  h.ends[0]!.close();
  h.run(4400 + (DECAY_EVERY / TICK_RATE) * 1000);
  expect([alone, f, wall].map((ref) => decay().expired(ref, h.world.tick))).toEqual([true, false, false]);
  // It still stands. The clocks are part of the world: after a restart it is as decayed as it was, not new.
  expect(structs.chunks[Math.floor(alone / 65536)]!.kind[alone & 0xffff]).toBe(id("foundation_wood"));
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  bob = h.join("bob");
  h.run(600);
  structs = h.world.structs;
  expect(structs.chunks[Math.floor(alone / 65536)]!.kind[alone & 0xffff]).toBe(id("foundation_wood"));
  expect([alone, f, wall].map((ref) => decay().expired(ref, h.world.tick))).toEqual([true, false, false]);
  // Anyone may take down what has decayed, and has what it gives; what has not is still not his.
  act = (s, ref, action) => {
    let code = -1;
    s.onResult = (_seq, c) => void (code = c);
    s.command(19, (w: BitWriter) => (w.u32(ref), w.u8(action)));
    h.run(150);
    return code;
  };
  has = (s, name) => s.inventory!.total(id(name));
  expect([act(bob, alone, STRUCT_PICKUP), act(bob, wall, STRUCT_DEMOLISH)]).toEqual([RESULT_NOT_YOURS, RESULT_NOT_YOURS]);
  const wood = has(bob, "wood");
  expect(act(bob, alone, STRUCT_DEMOLISH)).toBe(RESULT_OK);
  expect(has(bob, "wood") - wood).toBe(40);
  // She comes back before the rest has gone: being near winds its clock, and it is as fresh as new.
  h.run(30000);
  ada = h.join("ada");
  h.run(6000);
  h.ends[h.ends.length - 1]!.close();
  h.run(45000);
  expect([f, wall].map((ref) => decay().expired(ref, h.world.tick))).toEqual([false, false]);
  // Left for its whole time, it decays; and with the rule that says so, the server takes it down itself, giving nothing to anyone.
  h.run(30000);
  expect([f, wall].map((ref) => decay().expired(ref, h.world.tick))).toEqual([true, true]);
  h.say(bob, "enablecheats");
  h.say(bob, "rule decayDestroy 1");
  h.run(6000);
  expect([f, wall].map((ref) => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff])).toEqual([0, 0]);
  expect([decay().destroyed, h.host.build.fallen]).toEqual([2, 0]);
  // With decay turned off nothing is ever decayed.
  h.say(bob, "rule decayTime 0");
  expect([decay().active(), h.host.rules.on("DisableStructureDecayPvE")]).toEqual([false, true]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
  void made;
  void sessions;
  void flatGround;
});

test("in the whole client: a piece looked at is named with how whole it is; the use key held on it lists what can be done, and a digit does it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = parsePack(buildCorePack());
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 14, 14);
  s.text(`tp ${(g.x + 7).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  run(300);
  // A wall of her own three metres in front of her, set there by the server's hand, and one of nobody she knows beside it.
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  // (Each on the south edge of a foundation, so that it stands.)
  h.world.structs.add(id("foundation_wood"), g.x + 7, g.y + 0.1875, g.z + 6.5, 0, rec.team, 15000);
  h.world.structs.add(id("foundation_wood"), g.x + 11, g.y + 0.1875, g.z + 6.5, 0, 99999, 15000);
  const wall = h.world.structs.add(id("wall_wood"), g.x + 7, g.y + 1.875, g.z + 5, 0, rec.team, 10000);
  const theirs = h.world.structs.add(id("wall_wood"), g.x + 11, g.y + 1.875, g.z + 5, 0, 99999, 10000);
  expect([wall, theirs].map((ref) => h.host.build.support.standsRef(ref))).toEqual([true, true]);
  app.controls.yaw = 0;
  app.controls.pitch = 0;
  run(400);
  const f = app.ui.frame;
  expect([app.aimed, f.find(KEY_PROMPT)!.text]).toEqual([wall, "hold E  wooden wall  10000/10000"]);
  expect(f.find(KEY_STRUCT_PANEL)).toBeNull();
  // A tap of the use key is not a question; held, it is. The mouse is then free, and the body does not go on using.
  app.key("KeyE", true);
  run(100);
  app.key("KeyE", false);
  run(400);
  expect(app.ui.structure.open).toBe(false);
  app.key("KeyE", true);
  run(500);
  expect([app.ui.structure.open, app.ui.structure.ref, app.ui.wantsPointerLock]).toEqual([true, wall, false]);
  expect([f.find(KEY_STRUCT_TITLE)!.text, f.find(KEY_STRUCT_HEALTH)!.text]).toEqual(["wooden wall", "10000 of 10000"]);
  expect([0, 1, 2].map((n) => f.find(KEY_STRUCT_BUTTON + n)!.text)).toEqual(["1  Take it back", "2  Mend it", "3  Take it down"]);
  expect([0, 1, 2].map((n) => f.find(KEY_STRUCT_DETAIL + n)!.text)).toEqual(["into your hands, as it was", "it is whole", "gives 20 wood, 5 thatch, 3 fiber"]);
  app.key("KeyE", false);
  // Escape puts it away and changes nothing.
  expect(app.key("Escape", true)).toBe(true);
  run(100);
  expect([app.ui.structure.open, f.find(KEY_STRUCT_PANEL), h.host.build.demolished]).toEqual([false, null, 0]);
  // Harmed, the list says what mending costs; taking it back is refused, and the screen says why.
  h.world.structs.damage(wall, 5000, h.world.tick);
  run(300);
  expect(f.find(KEY_PROMPT)!.text).toBe("hold E  wooden wall  5000/10000");
  app.key("KeyE", true);
  run(500);
  app.key("KeyE", false);
  expect([0, 1].map((n) => f.find(KEY_STRUCT_DETAIL + n)!.text)).toEqual(["not while it is damaged", "costs 20 wood, 5 thatch, 4 fiber"]);
  expect(app.key("Digit1", true)).toBe(true);
  run(300);
  expect([app.ui.structure.open, f.find(KEY_PROMPT)!.text, h.host.build.pickedUp]).toEqual([false, "It is damaged: mend it first", 0]);
  run(3000);
  expect(f.find(KEY_PROMPT)!.text).toBe("hold E  wooden wall  5000/10000");
  // A press on the third line takes it down: it is gone, and half of it is in her hands.
  app.key("KeyE", true);
  run(500);
  app.key("KeyE", false);
  app.pointer(0, KEY_STRUCT_BUTTON + 2, 0, 0, 0);
  run(300);
  expect([h.host.build.demolished, s.inventory!.total(id("wood")), h.world.structs.chunks[Math.floor(wall / 65536)]!.kind[wall & 0xffff]]).toEqual([1, 20, 0]);
  expect(f.find(KEY_PROMPT)).toBeNull();
  // Another's wall is named, without the hint; the list can be asked for, and the server says whose it is.
  s.text(`tp ${(g.x + 11).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  run(400);
  expect([app.aimed, f.find(KEY_PROMPT)!.text]).toEqual([theirs, "wooden wall  10000/10000"]);
  app.key("KeyE", true);
  run(500);
  app.key("KeyE", false);
  app.key("Digit3", true);
  run(300);
  expect(f.find(KEY_PROMPT)!.text).toBe("That is not your tribe's");
  expect(h.host.items.audit()).toEqual([]);
});
