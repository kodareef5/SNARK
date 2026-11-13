import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CACHE_TICKS, OP_DEATH } from "../../server/death.ts";
import type { EntityRecord } from "../../server/records.ts";
import { CAUSE_DROWNED } from "../../server/survival.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitReader, type BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_RESPAWN, CMD_USE, MARKER_DEATH, RESULT_DENIED, RESULT_INVALID, RESULT_OK, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { BTN_USE, MODE_WALK } from "../../shared/sim/character.ts";
import { F_PROP } from "../../shared/sim/entities.ts";
import type { Inventory } from "../../shared/sim/items.ts";
import { V_FOOD, V_HEALTH } from "../../shared/sim/vitals.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-death-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(host = {}, name = "ada") {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const s = h.join(name);
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const id = (item: string) => h.reg.index.get(item)!;
  return { h, s, rec, id, pilot: h.pilots[0]!, ents: h.world.ents, items: h.host.items, sv: h.host.survival };
}

const contents = (inv: Inventory): string[] => {
  const out: string[] = [];
  for (let i = 0; i < inv.cap; i++) if (inv.item[i] !== 0) out.push(`${i}:${inv.item[i]}x${inv.count[i]}@${inv.spoilAt[i]}`);
  return out;
};
const caches = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.expiresAt > 0);
const move = (s: ClientSession, fromBox: number, from: number, toBox: number, to: number, item: number): number =>
  s.command(CMD_MOVE, (w: BitWriter) => {
    w.bits(fromBox, 1);
    w.u8(from);
    w.bits(toBox, 1);
    w.u8(to);
    w.u16(0);
    w.u16(item);
  });
/** Tap the use key. */
function tapUse(h: Harness, pilot: { buttons: number }): void {
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(300);
}

test("a death moves everything to a cache in one step; the survivor returns, finds it by its marker, and takes it back", () => {
  const { h, s, rec, id, pilot, ents, items, sv } = setup();
  const bo = h.join("bo");
  h.say(s, "give stone 150");
  h.say(s, "give berry 12");
  h.say(s, "give waterskin");
  h.run(300);
  const e = h.ent(s);
  const where = { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]! };
  const inv = items.inv(rec);
  const had = contents(inv);
  expect(had.length).toBe(4);

  expect(h.say(s, "suicide")).toEqual(["You were killed."]);
  // The survivor: dead, bodiless, holding nothing, with a marker where it fell.
  expect(s.sessionState).toBe(SESSION_DEAD);
  expect(s.ownHandle).toBe(0);
  expect(h.client(s)!.ent).toBe(-1);
  expect(rec.dead).toBe(true);
  expect(rec.inv).not.toBe(inv); // what it has now is a new, empty inventory
  expect(items.inv(rec).used()).toBe(0);
  expect(s.inventory!.used()).toBe(0);
  expect(rec.markers).toEqual([{ kind: MARKER_DEATH, x: where.x, y: where.y, z: where.z, tick: rec.markers[0]!.tick }]);
  expect(s.markers).toEqual(rec.markers);
  expect(s.respawnPoints.map((p) => p.name)).toEqual(["Plaza", "Slopes", "Poolside"]);
  // The cache: the very same inventory, nothing copied, standing where the body was.
  const [cache] = caches(h);
  expect(cache!.inv).toBe(inv);
  expect(contents(cache!.inv!)).toEqual(had);
  expect(cache!.name).toBe("ada's cache");
  const ce = h.host.records.entOf.get(cache!.pid)!;
  expect(ents.flags[ce]! & F_PROP).toBe(F_PROP);
  expect([ents.x[ce], ents.z[ce]]).toEqual([where.x, where.z]);
  expect(items.audit()).toEqual([]);
  expect(h.host.death.count).toBe(1);
  // Others see a cache there, by name, and no longer see her.
  const seen = new RemoteSample();
  bo.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(seen.name[0]).toBe("ada's cache");

  // Dead: nothing it presses moves it, feeds it, or runs its clock.
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  const food = sv.value(rec, V_FOOD);
  pilot.moveZ = 1;
  s.command(CMD_USE, (w) => (w.u8(0), w.u16(id("core:berry"))));
  s.command(CMD_RESPAWN, (w) => w.u8(9)); // no such place
  h.run(3000);
  pilot.moveZ = 0;
  expect(codes).toEqual([RESULT_DENIED, RESULT_INVALID]);
  expect(h.client(s)!.body.z).toBe(where.z);
  expect(s.own.z).toBe(where.z);
  expect(sv.value(rec, V_FOOD)).toBe(food);
  expect(sv.value(rec, V_HEALTH)).toBe(0);

  // Back to life at the second place offered: whole, empty-handed.
  codes.length = 0;
  s.command(CMD_RESPAWN, (w) => w.u8(1));
  h.run(500);
  expect(codes).toEqual([RESULT_OK]);
  expect(s.sessionState).toBe(SESSION_ALIVE);
  const e2 = h.ent(s);
  expect(Math.hypot(ents.x[e2]! - 228, ents.z[e2]! - 282)).toBeLessThan(2);
  expect(ents.mode[e2]).toBe(MODE_WALK);
  expect(sv.value(rec, V_HEALTH)).toBe(100);
  expect(rec.dead).toBe(false);
  expect(items.inv(rec).used()).toBe(0);
  s.command(CMD_RESPAWN, (w) => w.u8(0)); // alive: there is nothing to return from
  h.run(200);
  expect(codes).toEqual([RESULT_OK, RESULT_INVALID]);

  // Walk up to the cache (here: teleport beside it), look down at it, and use it.
  h.say(s, `tp ${where.x} ${where.z - 1.5}`);
  pilot.yaw = 0;
  pilot.pitch = Math.atan2(0.25 - 1.62, 1.5);
  h.run(300);
  tapUse(h, pilot);
  expect(s.open).not.toBeNull();
  expect(s.open!.name).toBe("ada's cache");
  expect(contents(s.open!.inventory)).toEqual(had);
  // Take every stack. The emptied cache goes away by itself and the screen's other half with it.
  for (let i = 0; i < s.open!.inventory.cap; i++) {
    if (s.open!.inventory.item[i] !== 0) move(s, BOX_OPEN, i, BOX_SELF, i, s.open!.inventory.item[i]!);
  }
  h.run(500);
  expect(contents(items.inv(rec))).toEqual(had);
  expect(contents(s.inventory!)).toEqual(had);
  expect(caches(h).length).toBe(0);
  expect(h.host.records.byPid.has(cache!.pid)).toBe(false);
  expect(ents.count).toBe(2);
  expect(s.open).toBeNull();
  expect(items.audit()).toEqual([]);
  bo.sampleRemote(seen);
  expect(seen.name[0]).toBe("ada");
});

test("use opens only what the body can see and reach, and walking away closes it", () => {
  const { h, s, pilot, ents, items } = setup();
  const stone = h.reg.index.get("core:stone")!;
  const box = h.host.records.create(h.reg.index.get("core:cache")!, "crate of stone");
  items.mint(box, stone, 60);
  box.x = 256;
  box.z = 232;
  box.y = 0;
  box.expiresAt = h.world.tick + 1_000_000;
  h.host.death.place(box);
  const e = h.ent(s);
  const aim = (z: number): void => {
    h.say(s, `tp 256 ${z}`);
    pilot.yaw = Math.PI; // south, toward the box
    pilot.pitch = Math.atan2(0.25 - 1.62, Math.abs(z - 232));
    h.run(300);
  };
  // Six metres off, looking straight at it: too far.
  aim(238);
  tapUse(h, pilot);
  expect(s.open).toBeNull();
  // Two metres off: it opens, and what is inside arrives.
  aim(234);
  tapUse(h, pilot);
  expect(s.open?.name).toBe("crate of stone");
  expect(s.open!.inventory.total(stone)).toBe(60);
  // Take ten, then use again: it closes.
  s.command(CMD_MOVE, (w) => {
    w.bits(BOX_OPEN, 1);
    w.u8(0);
    w.bits(BOX_SELF, 1);
    w.u8(3);
    w.u16(10);
    w.u16(stone);
  });
  h.run(300);
  expect(s.inventory!.total(stone)).toBe(10);
  expect(s.open!.inventory.total(stone)).toBe(50);
  tapUse(h, pilot);
  expect(s.open).toBeNull();
  // Open again and walk off: out of reach, it closes by itself, and the box can no longer be touched.
  tapUse(h, pilot);
  expect(s.open).not.toBeNull();
  pilot.yaw = 0;
  pilot.pitch = 0;
  pilot.moveZ = 1;
  h.run(2500);
  pilot.moveZ = 0;
  expect(ents.z[e]!).toBeGreaterThan(240);
  expect(s.open).toBeNull();
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  move(s, BOX_OPEN, 0, BOX_SELF, 5, stone);
  h.run(300);
  expect(codes).toEqual([RESULT_DENIED]);
  expect(items.inv(box).total(stone)).toBe(50);
  // In reach but behind a wall: the wall is what the body is looking at.
  h.world.structs.add(h.reg.index.get("core:wall")!, 256, 1.5, 233, 0, 0, 1);
  h.run(300);
  aim(234.6);
  tapUse(h, pilot);
  expect(s.open).toBeNull();
  // Looking away from it, in reach, with nothing between: nothing to open.
  aim(230.5);
  pilot.yaw = 0;
  h.run(200);
  tapUse(h, pilot);
  expect(s.open?.name).toBe("crate of stone"); // from the other side there is no wall in the way
  pilot.yaw = Math.PI / 2;
  h.run(200);
  tapUse(h, pilot);
  expect(s.open).toBeNull();
  expect(items.audit()).toEqual([]);
});

test("drowning kills, the death is journalled, and a restart keeps the dead dead and the cache waiting", () => {
  const db = join(dir, "drowned.db");
  const { h, s, rec, id, items } = setup({ dbPath: db });
  h.say(s, "give stone 77");
  h.say(s, `tp ${PROVING_POOL.x} ${PROVING_POOL.z}`);
  let seconds = 0;
  while (s.sessionState !== SESSION_DEAD && seconds++ < 80) h.run(1000);
  // A hundred points of air at three a second, then a hundred of health at eight.
  expect(seconds).toBeGreaterThan(40);
  expect(seconds).toBeLessThan(52);
  expect(s.log.at(-1)!.text).toBe("You drowned.");
  const [cache] = caches(h);
  const expires = cache!.expiresAt;
  const marker = { ...rec.markers[0]! };
  h.run(500);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db, dev: true });
  const journal = h2.host.persistence!.store.journal().filter((j) => j.op === OP_DEATH);
  expect(journal.length).toBe(1);
  const r = new BitReader(journal[0]!.data);
  expect([r.uint53(), r.u8(), r.uint53()]).toEqual([rec.pid, CAUSE_DROWNED, cache!.pid]);
  expect(h2.host.items.audit()).toEqual([]);
  const rec2 = h2.host.records.byPid.get(rec.pid)!;
  const cache2 = h2.host.records.byPid.get(cache!.pid)!;
  expect(rec2.dead).toBe(true);
  expect(rec2.markers).toEqual([marker]);
  expect(cache2.inv!.total(id("core:stone"))).toBe(77);
  expect(cache2.expiresAt).toBe(expires);
  expect(h2.world.ents.count).toBe(1); // the cache has its body back
  // She returns dead, is told where she may respawn, and does.
  const again = h2.join("ada");
  h2.run(500);
  expect(again.sessionState).toBe(SESSION_DEAD);
  expect(again.markers).toEqual([marker]);
  expect(again.respawnPoints.length).toBe(3);
  expect(h2.world.ents.count).toBe(1);
  again.command(CMD_RESPAWN, (w) => w.u8(0));
  h2.run(500);
  expect(again.sessionState).toBe(SESSION_ALIVE);
  expect(h2.host.survival.value(rec2, V_HEALTH)).toBe(100);

  // Nobody collects the cache: at its time it goes, and what was in it is burned on the books.
  const stone = id("core:stone");
  const burned = h2.host.items.burned[stone]!;
  while (h2.world.tick < expires - 1) h2.server.tick();
  expect(h2.host.records.byPid.has(cache!.pid)).toBe(true);
  h2.server.tick();
  expect(h2.host.records.byPid.has(cache!.pid)).toBe(false);
  expect(h2.host.items.burned[stone]! - burned).toBe(77);
  expect(h2.host.items.audit()).toEqual([]);
  expect(expires - rec2.markers[0]!.tick).toBe(CACHE_TICKS);
  h2.host.shutdown();
  void items;
});

test("a starving creature dies on its tick with nobody in the world, and kill and god do what they say", () => {
  const frail = compileContent(CORE_CONTENT.map((d) => (d.id === "core:grazer" && d.type === "species" ? { ...d, food: { max: 1, perHour: 60 }, stats: { ...d.stats, food: [1, 0, 0] as const, health: [2, 0, 0] as const } } : d))).registry!;
  const quiet = new Harness({}, 1, 30, {}, frail);
  const born = quiet.world.tick;
  const e = quiet.host.spawnCreature("core:grazer", 100, 100, 1);
  const pid = quiet.world.ents.pid[e]!;
  // One point of food at sixty an hour is 70 ticks; then two of health at half a point a second, 120 more.
  while (quiet.world.tick < born + 189) quiet.server.tick();
  expect(quiet.host.records.byPid.has(pid)).toBe(true);
  expect(quiet.host.survival.starving.has(pid)).toBe(true);
  quiet.server.tick();
  expect(quiet.host.records.byPid.has(pid)).toBe(false);
  expect(quiet.world.ents.count).toBe(0);
  expect(quiet.host.death.count).toBe(1);
  expect(quiet.host.survival.starving.has(pid)).toBe(false);

  const { h, s, rec, pilot, ents, sv } = setup();
  // Looking at a creature four metres ahead: kill removes it. Looking at nothing: nothing dies.
  pilot.yaw = 0;
  pilot.pitch = -0.2;
  h.run(200);
  expect(h.say(s, "spawn grazer 5")[0]).toContain("spawned");
  expect(ents.count).toBe(2);
  expect(h.say(s, "kill")).toEqual(["killed core:grazer"]);
  expect(ents.count).toBe(1);
  expect(h.say(s, "kill")).toEqual(["nothing alive there"]);
  // A god takes no harm from a long fall; without it the same fall kills.
  expect(h.say(s, "god")).toEqual(["god on"]);
  h.say(s, "tp 256 60 240");
  h.run(5000);
  expect(sv.value(rec, V_HEALTH)).toBe(100);
  expect(s.sessionState).toBe(SESSION_ALIVE);
  expect(h.say(s, "god")).toEqual(["god off"]);
  h.say(s, "tp 256 60 240");
  h.run(5000);
  expect(s.sessionState).toBe(SESSION_DEAD);
  expect(s.log.at(-1)!.text).toBe("You fell to your death.");
  expect(caches(h).length).toBe(0); // it carried nothing, so it left nothing
  expect(rec.markers.length).toBe(1);
});

test("the prompt under the crosshair names what the use key would open, and only then", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, parsePack(buildCorePack()));
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  const box = h.host.records.create(h.reg.index.get("core:cache")!, "old cache");
  h.host.items.mint(box, h.reg.index.get("core:stone")!, 5);
  box.x = 256;
  box.z = 242;
  box.expiresAt = h.world.tick + 1_000_000;
  h.host.death.place(box);
  run(300);
  // Looking level, over it: no prompt. Looking down at it: the prompt, and E opens it.
  expect(app.ui.frame.find(KEY_PROMPT)).toBeNull();
  app.look(0, -Math.atan2(0.25 - 1.62, 2) / 0.0025);
  run(100);
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe("E  open old cache");
  app.key("KeyE", true);
  run(100);
  app.key("KeyE", false);
  run(300);
  expect(app.session.open?.name).toBe("old cache");
  expect(app.ui.inventory.open).toBe(true); // the screen came up with it
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe("E  close old cache");
  // Closing the screen closes the container on the server too.
  app.key("Escape", true);
  run(300);
  expect(h.client(app.session)!.open).toBe(0);
  expect(app.session.open).toBeNull();
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe("E  open old cache");
});
