// Fixtures are structures with state: containers, doors, locks and PINs.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { App } from "../../client/core/app.ts";
import { Builder, GHOST_OK } from "../../client/core/build.ts";
import { KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { KEY_PIN_PANEL, KEY_STRUCT_BUTTON } from "../../client/core/ui/structure.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { flatGround } from "../fixtures/arena.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { NO_TARGET } from "../../server/build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_SELECT, CMD_STRUCT, RESULT_DENIED, RESULT_INVALID, RESULT_LOCKED, RESULT_NOT_EMPTY, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_PIN, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { writeNew, writeRest } from "../../shared/net/place.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { floorFace, floorTop, poseAt, units, type Pose } from "../../shared/world/snap.ts";
import { GONE_FELL } from "../../shared/world/structures.ts";
import { NO_PIN, PIN_WAIT_TICKS, STRUCT_DEMOLISH, STRUCT_LOCK, STRUCT_PICKUP, STRUCT_PIN, STRUCT_UNLOCK, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { builder } from "../fixtures/build.ts";
import { ROOF_RISE, ROOF_THICK, hullRegistry } from "../fixtures/hulls.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
type Made = ReturnType<typeof builder>;

/** Gives a survivor `count` of an item in hotbar slot `slot` and takes it in hand. */
function equip(made: Made, s: ClientSession, item: string, slot: number, count = 5): void {
  const { h } = made;
  expect(h.say(s, `give ${item} ${count}`)[0]).toContain(`gave ${count}`);
  const inv = s.inventory!;
  const from = inv.item.indexOf(id(item));
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(item))));
  h.run(100);
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(slot));
  h.run(100);
}

/** Places the item in hand on open ground at (x, z), or on top of `target` there. ref is -1 if nothing was built. */
function setDown(made: Made, s: ClientSession, x: number, z: number, target = NO_TARGET): { code: number; ref: number } {
  const { h } = made;
  let code = -1;
  s.onResult = (_seq, c) => void (code = c);
  const before = h.host.build.placed;
  s.command(CMD_PLACE, (w: BitWriter) => {
    if (target === NO_TARGET) writeNew(w, 0, Math.round(x * U), Math.round(z * U), 0);
    else writeRest(w, 0, target, Math.round(x * U), Math.round(z * U), 0);
  });
  h.run(150);
  return { code, ref: h.host.build.placed > before ? h.host.build.last : -1 };
}

/** Stands a survivor at (x, z) looking at (tx, ty, tz) and presses use once. Returns the code of a result with no sequence number, or -1. */
function useAt(h: Harness, s: ClientSession, x: number, z: number, tx: number, ty: number, tz: number): number {
  const i = h.sessions.indexOf(s);
  h.say(s, `tp ${x.toFixed(3)} ${z.toFixed(3)}`);
  const eye = s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance);
  const pilot = h.pilots[i]!;
  pilot.yaw = Math.atan2(tx - x, tz - z);
  pilot.pitch = Math.atan2(ty - eye, Math.hypot(tx - x, tz - z));
  h.run(200);
  let told = -1;
  s.onResult = (seq, c) => void (seq === 0 && (told = c));
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
  return told;
}

const row = (h: Harness, ref: number) => {
  const t = h.world.structs.chunks[Math.floor(ref / 65536)]!;
  const k = ref & 0xffff;
  return { kind: t.kind[k]!, x: t.x[k]!, y: t.y[k]!, z: t.z[k]!, hp: t.hp[k]! };
};

test("a thing is set down on the ground or on a floor of its builder's tribe, joined to nothing, and stands on whatever is under it", () => {
  const made = builder(["ada", "bob"]);
  const { h, sessions, at, join, structs } = made;
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  // A foundation with a wall, and a floor out over the ground from the wall's top.
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  const f = setDown(made, ada, at.x, at.z + 5).ref;
  const wall = join(ada, "wall", f, 1).ref;
  const floor = join(ada, "ceiling", wall, 0).ref;
  expect([f, wall, floor].every((ref) => ref >= 0)).toBe(true);
  equip(made, ada, "piece_storage_box", 6);
  // On open ground it stands on the ground. 0.3125 is half a storage box's height.
  const onGround = setDown(made, ada, at.x - 2, at.z + 2);
  expect(onGround.code).toBe(RESULT_OK);
  expect(row(h, onGround.ref)).toMatchObject({ kind: id("storage_box"), x: at.x - 2, y: Math.ceil(at.y * U) / U + 0.3125, z: at.z + 2, hp: 500 });
  // On a foundation or a floor, its foot is on the piece's top.
  const onFloor = setDown(made, ada, at.x + 0.5, at.z + 4.25, f);
  expect(onFloor.code).toBe(RESULT_OK);
  expect(row(h, onFloor.ref).y).toBeCloseTo(row(h, f).y + FOUNDATION_THICK / 2 + 0.3125, 6);
  const up = setDown(made, ada, row(h, floor).x, row(h, floor).z, floor);
  expect(up.code).toBe(RESULT_OK);
  expect(row(h, up.ref).y).toBeCloseTo(row(h, floor).y + 0.125 + 0.3125, 6);
  expect([onGround.ref, onFloor.ref, up.ref].map((ref) => h.host.build.support.standsRef(ref))).toEqual([true, true, true]);
  // Refused: on a wall, at a point not over the target, where another box stands, and on another tribe's floor.
  expect(setDown(made, ada, row(h, wall).x, row(h, wall).z, wall).code).toBe(RESULT_NO_SNAP);
  expect(setDown(made, ada, at.x + 3, at.z + 5, f).code).toBe(RESULT_NO_SNAP);
  expect(setDown(made, ada, at.x + 0.5, at.z + 4.25, f).code).not.toBe(RESULT_OK);
  equip(made, bob, "piece_storage_box", 6);
  expect(setDown(made, bob, at.x - 0.75, at.z + 5.5, f).code).toBe(RESULT_NOT_YOURS);
  // Nothing joins a box, and a box in the air does not stand.
  expect(join(ada, "wall", onGround.ref, 0).code).toBe(RESULT_NO_SNAP);
  expect(h.host.build.support.stands(id("storage_box"), Math.round((at.x + 9) * U), Math.round((at.y + 4) * U), Math.round((at.z + 9) * U), 0)).toBe(false);
  expect(RESULT_NO_SUPPORT).toBe(18);

  // The preview puts a box where the look meets a floor, and the server builds it there.
  const b = new Builder();
  h.say(ada, `tp ${at.x.toFixed(3)} ${(at.z + 1).toFixed(3)}`);
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(6));
  h.run(100);
  const dir = [0, 0, 0];
  const eye = ada.own.y + stanceEye(h.reg.move[ada.ownKind]!, ada.own.stance);
  const look = (tx: number, tz: number): void => {
    const yaw = Math.atan2(tx - ada.own.x, tz - ada.own.z);
    const pitch = Math.atan2(row(h, f).y + FOUNDATION_THICK / 2 - eye, Math.hypot(tx - ada.own.x, tz - ada.own.z));
    lookDirection(Math.round((yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((pitch / (Math.PI / 2)) * 16384), dir);
    b.update(ada, ada.world!, h.reg, ada.own.x, eye, ada.own.z, dir[0]!, dir[1]!, dir[2]!, 0, 0);
  };
  look(at.x - 0.8, at.z + 5.6);
  expect([b.active, b.kind, b.problem]).toEqual([true, id("storage_box"), 0]);
  expect(b.pose.y).toBe(Math.round((row(h, f).y + FOUNDATION_THICK / 2 + 0.3125) * U));
  expect(Math.abs(b.pose.x / U - (at.x - 0.8))).toBeLessThan(0.05);
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  const before = h.host.build.placed;
  expect(b.place(ada, h.reg)).toBeGreaterThan(0);
  h.run(200);
  expect([code, h.host.build.placed - before]).toEqual([RESULT_OK, 1]);
  const shown = row(h, h.host.build.last);
  expect([Math.round(shown.x * U), Math.round(shown.y * U), Math.round(shown.z * U)]).toEqual([b.pose.x, b.pose.y, b.pose.z]);
  expect(GHOST_OK).toBe(16);

  // With the wall gone the floor falls, and the box on it. The boxes on the foundation and on the ground stay.
  const fell: number[] = [];
  const hook = structs.onRemove!;
  structs.onRemove = (ref, cause) => {
    if (cause === GONE_FELL) fell.push(ref);
    hook(ref, cause);
  };
  structs.damage(wall, 1e9, h.world.tick);
  h.run(600);
  expect(fell.sort((p, q) => p - q)).toEqual([floor, up.ref].sort((p, q) => p - q));
  expect([onGround.ref, onFloor.ref].map((ref) => row(h, ref).kind)).toEqual([id("storage_box"), id("storage_box")]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a box holds things: looked into with the use button, kept with the world, not taken back until it is empty, and left in a cache when it is destroyed", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-box-"));
  const dbPath = joinPath(dir, "world.db");
  const made = builder(["ada"], 40, 40, { dbPath });
  let { h } = made;
  const { at, act } = made;
  let ada = made.sessions[0]!;
  equip(made, ada, "piece_storage_box", 6);
  const box = setDown(made, ada, at.x, at.z + 2).ref;
  equip(made, ada, "piece_vault", 7, 1);
  const vault = setDown(made, ada, at.x + 3, at.z + 2).ref;
  expect([row(h, box).kind, row(h, vault).kind]).toEqual([id("storage_box"), id("vault")]);
  // A fixture has no state record until it needs one.
  expect(h.host.fixtures.count).toBe(0);
  h.say(ada, "give wood 80");
  h.say(ada, "give thatch 30");
  expect(useAt(h, ada, at.x, at.z + 0.6, at.x, at.y + 0.3, at.z + 2)).toBe(-1);
  expect([ada.open?.name, ada.open?.inventory.cap, h.host.fixtures.count]).toEqual(["storage box", 15, 1]);
  const inv = ada.inventory!;
  const move = (from: number, fromBox: number, to: number, toBox: number, item: number): void => {
    ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(fromBox, 1), w.varint(from), w.bits(toBox, 1), w.varint(to), w.u16(0), w.u16(item)));
    h.run(150);
  };
  move(inv.item.indexOf(id("wood")), BOX_SELF, 3, BOX_OPEN, id("wood"));
  expect([ada.open!.inventory.item[3], ada.open!.inventory.count[3], inv.total(id("wood"))]).toEqual([id("wood"), 80, 0]);
  expect(useAt(h, ada, at.x, at.z + 0.6, at.x, at.y + 0.3, at.z + 2)).toBe(-1);
  expect(ada.open).toBeNull();
  expect(act(ada, box, STRUCT_PICKUP)).toBe(RESULT_NOT_EMPTY);
  useAt(h, ada, at.x + 3, at.z + 0.2, at.x + 3, at.y + 1.2, at.z + 2);
  expect([ada.open?.name, ada.open?.inventory.cap]).toEqual(["vault", 350]);
  move(inv.item.indexOf(id("thatch")), BOX_SELF, 349, BOX_OPEN, id("thatch"));
  expect(ada.open!.inventory.count[349]).toBe(30);
  h.say(ada, `tp ${(at.x + 3).toFixed(3)} ${(at.z - 8).toFixed(3)}`);
  h.run(300);
  expect(ada.open).toBeNull();

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ada = h.join("ada");
  h.run(600);
  h.say(ada, "enablecheats");
  expect(h.host.fixtures.count).toBe(2);
  useAt(h, ada, at.x, at.z + 0.6, at.x, at.y + 0.3, at.z + 2);
  expect([ada.open?.name, ada.open?.inventory.count[3], ada.open?.inventory.item[3]]).toEqual(["storage box", 80, id("wood")]);
  useAt(h, ada, at.x + 3, at.z + 0.2, at.x + 3, at.y + 1.2, at.z + 2);
  expect([ada.open?.name, ada.open?.inventory.count[349]]).toEqual(["vault", 30]);

  useAt(h, ada, at.x, at.z + 0.6, at.x, at.y + 0.3, at.z + 2);
  expect(ada.open?.name).toBe("storage box");
  h.world.structs.damage(box, 1e9, h.world.tick);
  h.run(300);
  expect([ada.open, row(h, box).kind, h.host.fixtures.count, h.host.build.spilled]).toEqual([null, 0, 1, 1]);
  const cache = [...h.host.records.byPid.values()].filter((r) => r.name === "storage box");
  expect(cache.length).toBe(1);
  expect([cache[0]!.at, h.host.items.inv(cache[0]!).total(id("wood")), Math.hypot(cache[0]!.x - at.x, cache[0]!.z - (at.z + 2))]).toEqual([-1, 80, 0]);
  useAt(h, ada, at.x, at.z + 0.6, at.x, at.y + 0.2, at.z + 2);
  expect(ada.open?.inventory.total(id("wood"))).toBe(80);
  // A vault with something in it cannot be picked up. Demolished, it leaves its contents in a cache.
  expect(act).toBeDefined();
  const again = (ref: number, action: number): number => {
    let code = -1;
    ada.onResult = (_seq, c) => void (code = c);
    ada.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action)));
    h.run(150);
    return code;
  };
  h.say(ada, `tp ${(at.x + 3).toFixed(3)} ${(at.z + 0.2).toFixed(3)}`);
  expect(again(vault, STRUCT_PICKUP)).toBe(RESULT_NOT_EMPTY);
  expect(again(vault, STRUCT_DEMOLISH)).toBe(RESULT_OK);
  h.run(300);
  expect([row(h, vault).kind, h.host.fixtures.count, h.host.build.spilled]).toEqual([0, 0, 2]);
  expect([...h.host.records.byPid.values()].filter((r) => r.name === "vault").map((r) => h.host.items.inv(r).total(id("thatch")))).toEqual([30]);
  // Demolishing refunds half of a vault's cost: 250 ingots, 50 paste, 35 oil and 45 polymer (ARK's recipe since stations S6, Vault).
  expect(["ingot", "paste", "oil", "polymer"].map((n) => ada.inventory!.total(id(n)))).toEqual([250, 50, 35, 45]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("a door opens and shuts for its tribe; for anyone once unlocked; and for whoever gives its PIN, three wrong tries shutting them out for half a minute", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-door-"));
  const dbPath = joinPath(dir, "world.db");
  const made = builder(["ada", "bob"], 40, 40, { dbPath });
  let { h } = made;
  const { at, join, act, count } = made;
  let [ada, bob] = made.sessions as [ClientSession, ClientSession];
  // Lets a piece be picked up at any time, not only in the half minute after it is placed.
  h.say(ada, "setting AlwaysAllowStructurePickup True");
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  const f = setDown(made, ada, at.x, at.z + 5).ref;
  const frame = join(ada, "wall", f, 2, 0, 1).ref;
  const door = join(ada, "door", frame, 0).ref;
  expect([row(h, frame).kind, row(h, door).kind]).toEqual([id("doorframe_wood"), id("door_wood")]);
  const d = row(h, door);
  // A shut door is looked at where it hangs. An open one is looked at on its leaf, which has swung a quarter turn about its hinge.
  const turn = (h.world.structs.chunks[Math.floor(door / 65536)]!.yaw[door & 0xffff]! / 65536) * 2 * Math.PI;
  const leaf = { x: d.x - 0.66 * Math.cos(turn) + 0.7 * Math.sin(turn), z: d.z + 0.66 * Math.sin(turn) + 0.7 * Math.cos(turn) };
  const press = (s: ClientSession): number => {
    const open = row(h, door).kind === id("door_open_wood");
    // Ada and Bob stand side by side, so neither blocks the other's look.
    return useAt(h, s, d.x + (h.sessions.indexOf(s) % 2 === 0 ? 0.45 : -0.45), d.z - 2.3, open ? leaf.x : d.x, d.y, open ? leaf.z : d.z);
  };
  const send = (s: ClientSession, action: number, pin = NO_PIN): number => {
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(door), w.u8(action), (action === STRUCT_PIN || action === STRUCT_USE) && w.u16(pin)));
    h.run(150);
    return code;
  };
  // An open door is another kind in the same slot, with the same place and health.
  expect(press(ada)).toBe(-1);
  expect([row(h, door).kind, bob.world!.structs.chunks[Math.floor(door / 65536)]!.kind[door & 0xffff], h.host.build.support.standsRef(door)]).toEqual([id("door_open_wood"), id("door_open_wood"), true]);
  expect([row(h, door).x, row(h, door).y, row(h, door).hp]).toEqual([d.x, d.y, 6250]);
  press(ada);
  expect(row(h, door).kind).toBe(id("door_wood"));
  expect(h.host.fixtures.count).toBe(0);
  // A door does not open into a body standing where its leaf would swing.
  h.say(bob, `tp ${leaf.x.toFixed(3)} ${leaf.z.toFixed(3)}`);
  expect([press(ada), row(h, door).kind]).toEqual([RESULT_OBSTRUCTED, id("door_wood")]);
  // A door starts locked to its tribe.
  expect(press(bob)).toBe(RESULT_LOCKED);
  expect([send(bob, STRUCT_USE), send(bob, STRUCT_UNLOCK), send(bob, STRUCT_PIN, 1111), row(h, door).kind]).toEqual([RESULT_LOCKED, RESULT_NOT_YOURS, RESULT_NOT_YOURS, id("door_wood")]);
  expect(send(ada, STRUCT_UNLOCK)).toBe(RESULT_OK);
  expect([press(bob), row(h, door).kind]).toEqual([-1, id("door_open_wood")]);
  press(bob);
  // Setting a PIN locks it again. 12345 is past 9999.
  expect([send(ada, STRUCT_PIN, 12345), send(ada, STRUCT_PIN, 4071)]).toEqual([RESULT_INVALID, RESULT_OK]);
  expect([press(bob), row(h, door).kind]).toEqual([RESULT_PIN, id("door_wood")]);
  expect([send(bob, STRUCT_USE, 1111), send(bob, STRUCT_USE, 2222), row(h, door).kind]).toEqual([RESULT_DENIED, RESULT_DENIED, id("door_wood")]);
  // The right PIN opens it and resets the count of wrong tries.
  expect([send(bob, STRUCT_USE, 4071), row(h, door).kind]).toEqual([RESULT_OK, id("door_open_wood")]);
  expect(send(bob, STRUCT_USE, 4071)).toBe(RESULT_OK);
  expect([1, 2, 3].map((n) => send(bob, STRUCT_USE, n))).toEqual([RESULT_DENIED, RESULT_DENIED, RESULT_DENIED]);
  expect([send(bob, STRUCT_USE, 4071), press(bob), row(h, door).kind]).toEqual([RESULT_WAIT, RESULT_WAIT, id("door_wood")]);
  // None of it keeps Ada out.
  expect([press(ada), row(h, door).kind]).toEqual([-1, id("door_open_wood")]);
  expect(PIN_WAIT_TICKS).toBe(30 * TICK_RATE);

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ada = h.join("ada");
  bob = h.join("bob");
  h.run(600);
  for (const s of [ada, bob]) h.say(s, "enablecheats");
  expect([row(h, door).kind, h.host.fixtures.count, h.host.fixtures.locked(door), h.host.fixtures.find(door)?.pin]).toEqual([id("door_open_wood"), 1, true, 4071]);
  // A restart forgets who was made to wait.
  expect([send(bob, STRUCT_USE, 7), send(bob, STRUCT_USE, 4071), row(h, door).kind]).toEqual([RESULT_DENIED, RESULT_OK, id("door_wood")]);
  // With the PIN removed it is still locked.
  expect([send(ada, STRUCT_PIN, NO_PIN), press(bob), send(ada, STRUCT_UNLOCK), press(bob), row(h, door).kind]).toEqual([RESULT_OK, RESULT_LOCKED, RESULT_OK, -1, id("door_open_wood")]);
  expect(send(ada, STRUCT_LOCK)).toBe(RESULT_OK);
  expect(press(bob)).toBe(RESULT_LOCKED);
  // Taking the PIN off an unlocked door leaves it unlocked.
  expect([send(ada, STRUCT_PIN, 4071), send(ada, STRUCT_UNLOCK), send(ada, STRUCT_PIN, NO_PIN), h.host.fixtures.locked(door)]).toEqual([RESULT_OK, RESULT_OK, RESULT_OK, false]);
  expect([send(ada, STRUCT_LOCK), h.host.fixtures.locked(door), h.host.fixtures.find(door)?.pin]).toEqual([RESULT_OK, true, -1]);
  // A doorframe cannot be locked. A door picked up while open returns a door piece, and its state record goes.
  const wall = h.world.structs.chunks[Math.floor(frame / 65536)]!;
  expect(wall.kind[frame & 0xffff]).toBe(id("doorframe_wood"));
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  ada.command(CMD_STRUCT, (w: BitWriter) => (w.u32(frame), w.u8(STRUCT_LOCK)));
  h.run(150);
  expect(code).toBe(RESULT_INVALID);
  const doors = ada.inventory!.total(id("piece_door_wood"));
  expect([send(ada, STRUCT_PICKUP), row(h, door).kind, ada.inventory!.total(id("piece_door_wood")) - doors, h.host.fixtures.count]).toEqual([RESULT_OK, 0, 1, 0]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
  void act;
  void count;
});

test("a vault whose floor goes comes down whole, onto whatever is under it, with what it holds and its lock; a box in the same place breaks", () => {
  const made = builder(["ada"]);
  const { h, sessions, at, join, structs } = made;
  const ada = sessions[0]!;
  // Two foundations side by side. On the far one a wall, and from its top a floor back over the near one, three metres up.
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  const near = setDown(made, ada, at.x, at.z + 5).ref;
  const far = join(ada, "foundation", near, 0).ref;
  const wall = join(ada, "wall", far, 2).ref;
  const floor = join(ada, "ceiling", wall, 0).ref;
  expect([near, far, wall, floor].every((ref) => ref >= 0)).toBe(true);
  expect(Math.hypot(row(h, floor).x - row(h, near).x, row(h, floor).z - row(h, near).z)).toBe(0);
  equip(made, ada, "piece_vault", 6, 1);
  const vault = setDown(made, ada, row(h, floor).x - 0.5, row(h, floor).z, floor);
  equip(made, ada, "piece_storage_box", 7, 1);
  const box = setDown(made, ada, row(h, floor).x + 0.9, row(h, floor).z, floor);
  expect([vault.code, box.code]).toEqual([RESULT_OK, RESULT_OK]);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.items.mint(h.host.fixtures.ensure(vault.ref), id("stone"), 70);
  h.host.items.mint(h.host.fixtures.ensure(box.ref), id("flint"), 9);
  const state = h.host.fixtures.find(vault.ref)!;
  state.lock = 1;
  state.pin = 77;
  h.run(300);
  const was = row(h, vault.ref);
  // The floor falls and the box breaks (spilled). The vault lands on the foundation under it (landed).
  const seen = ada.rubble.length;
  structs.damage(wall, 1e9, h.world.tick);
  h.run(900);
  expect([row(h, floor).kind, h.host.build.landed, h.host.build.spilled, h.host.build.pending]).toEqual([0, 1, 1, 0]);
  const now = h.host.fixtures.find(state.at)!;
  expect(now).toBe(state);
  const landed = row(h, state.at);
  expect([landed.kind, landed.x, landed.z, landed.hp]).toEqual([id("vault"), was.x, was.z, 50000]);
  expect(landed.y).toBeCloseTo(row(h, near).y + FOUNDATION_THICK / 2 + 1.25, 6);
  expect([h.host.build.support.standsRef(state.at), state.pin, h.host.fixtures.locked(state.at), h.host.items.inv(state).total(id("stone")), state.team]).toEqual([true, 77, true, 70, rec.team]);
  // The watcher got three removals: the floor, the box and the vault. The vault is back where it landed.
  expect(ada.rubble.length - seen).toBe(3);
  expect(ada.world!.structs.chunks[Math.floor(state.at / 65536)]!.kind[state.at & 0xffff]).toBe(id("vault"));
  const cache = [...h.host.records.byPid.values()].filter((r) => r.name === "storage box");
  expect(cache.map((r) => [r.at, h.host.items.inv(r).total(id("flint"))])).toEqual([[-1, 9]]);
  // With the foundation gone too, the vault lands again, on the ground.
  structs.damage(near, 1e9, h.world.tick);
  h.run(900);
  expect(h.host.build.landed).toBe(2);
  expect(row(h, state.at).y).toBeCloseTo(Math.ceil(at.y * U) / U + 1.25, 6);
  expect([h.host.items.inv(state).total(id("stone")), h.host.fixtures.count]).toEqual([70, 1]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a vault that comes down onto a sloped roof lands on the slope under its middle, not at the height of the roof's top edge, and stands there", () => {
  const reg = hullRegistry();
  const kind = (name: string): number => reg.index.get(name)!;
  const h = new Harness({}, 1, 60, { dev: true }, reg);
  const g = flatGround(h, 12, 12);
  const structs = h.world.structs;
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const pillar = (x: number, z: number): number => structs.add(kind("core:pillar_wood"), x, g.y + 1.375, z, 0, 1, 10000);
  const on = (target: number, name: string): number => {
    expect(poseAt(structs, reg, target, kind(name), 0, 0, pose)).toBe(true);
    return structs.add(kind(name), pose.x / U, pose.y / U, pose.z / U, 0, 1, 10000);
  };
  // A roof slab on a pillar, rising half a metre a metre toward +Z. Beside it two pillars, one on the other, and a floor on them
  // reaching over the roof, with a vault on it whose middle is over the slab a metre up its slope.
  const [rx, rz] = [g.x + 4, g.z + 6];
  const roof = on(pillar(rx, rz), "test:roof");
  const base = pillar(rx + 2.7, rz);
  const floor = on(on(base, "core:pillar_wood"), "core:ceiling_wood");
  const [vx, vz] = [rx + 1.3, rz + 1];
  const vault = structs.add(kind("core:vault"), vx, (floorTop(structs, reg, floor, units(vx), units(vz)) + units(1.25)) / U, vz, 0, 1, 50000);
  expect([roof, floor, vault].map((ref) => h.host.build.support.standsRef(ref))).toEqual([true, true, true]);
  const was = row(h, vault);
  const slope = floorTop(structs, reg, roof, units(vx), units(vz)) / U;
  expect(floorFace.level).toBe(false);
  expect(Math.abs(slope - row(h, roof).y - (ROOF_RISE / 3 + ROOF_THICK / 2))).toBeLessThan(2 / U);
  structs.damage(base, 1e9, h.world.tick);
  h.run(900);
  expect([row(h, floor).kind, row(h, roof).kind !== 0, h.host.build.landed]).toEqual([0, true, 1]);
  let at = -1;
  for (const [c, t] of structs.chunks.entries()) for (let s = 0; t && s < t.high; s++) if (t.kind[s] === kind("core:vault")) at = c * 65536 + s;
  // Before, it landed at the height of the slab's top edge, 0.65 m higher, over the whole of the slab.
  expect([row(h, at).x, row(h, at).z, row(h, at).y]).toEqual([was.x, was.z, slope + 1.25]);
  expect(h.host.build.support.standsRef(at)).toBe(true);
});

test("in the whole client: a box is named with the key that opens it; another tribe's, locked with a PIN, asks for the PIN once and is given it after that", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = parsePack(corePackBytes());
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 14, 14);
  s.text(`tp ${(g.x + 7).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  run(300);
  // A storage box of another tribe (99999), 2 m in front of her.
  const box = h.world.structs.add(id("storage_box"), g.x + 7, Math.ceil(g.y * U) / U + 0.3125, g.z + 4, 0, 99999, 500);
  const state = h.host.fixtures.ensure(box);
  h.host.items.mint(state, id("flint"), 12);
  state.lock = 1;
  state.pin = 2580;
  app.controls.yaw = 0;
  app.controls.pitch = Math.atan2(0.3 - 1.62, 2);
  run(400);
  const f = app.ui.frame;
  expect([app.aimed, f.find(KEY_PROMPT)!.text]).toEqual([box, "E use  storage box  500/500"]);
  const tap = (): void => {
    app.key("KeyE", true);
    run(80);
    app.key("KeyE", false);
    run(300);
  };
  // The server answers that it wants a PIN, so the PIN panel opens and frees the mouse.
  tap();
  expect([s.open, app.ui.structure.open, app.ui.structure.pad, app.ui.wantsPointerLock, f.find(KEY_PIN_PANEL) !== null]).toEqual([null, true, STRUCT_USE, false, true]);
  // Four digits send the PIN. 1111 is wrong.
  for (const code of ["Digit1", "Digit1", "Digit1", "Digit1"]) app.key(code, true);
  run(300);
  expect([s.open, app.ui.structure.open, f.find(KEY_PROMPT)!.text]).toEqual([null, false, "That is not its PIN"]);
  tap();
  expect(app.ui.structure.pad).toBe(STRUCT_USE);
  for (const code of ["Digit2", "Digit5", "Digit8", "Digit0"]) app.key(code, true);
  run(300);
  expect([s.open?.name, s.open?.inventory.total(id("flint")), app.ui.inventory.open, app.ui.structure.open]).toEqual(["storage box", 12, true, false]);
  // The client remembers the PIN that worked and sends it with the next use.
  app.key("Escape", true);
  run(300);
  expect(s.open).toBeNull();
  tap();
  expect([s.open?.name, app.ui.structure.open]).toEqual(["storage box", false]);
  app.key("Escape", true);
  run(300);

  // On her own box, holding the use key opens the structure menu and does not open the box. A tap opens it.
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const own = h.world.structs.add(id("storage_box"), g.x + 10, Math.ceil(g.y * U) / U + 0.3125, g.z + 4, 0, rec.team, 500);
  s.text(`tp ${(g.x + 10).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  run(400);
  expect(app.aimed).toBe(own);
  const used = h.host.build.used;
  app.key("KeyE", true);
  run(500);
  app.key("KeyE", false);
  run(300);
  expect([app.ui.structure.open, app.ui.structure.ref, s.open, h.host.build.used - used]).toEqual([true, own, null, 0]);
  expect([3, 4, 5].map((n) => f.find(KEY_STRUCT_BUTTON + n)!.text)).toEqual(["4  Lock it", "5  Unlock it", "6  Give it a PIN"]);
  app.key("Escape", true);
  run(100);
  tap();
  expect([s.open?.name, s.open?.inventory.cap, h.host.build.used - used]).toEqual(["storage box", 15, 1]);
  expect(h.host.items.audit()).toEqual([]);
});
