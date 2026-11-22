// The frond glider through a server and its clients (planning/workstreams/glider.md): made, carried, flown with the
// prediction agreeing, seen by another, worn as it folds, and broken.

import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { CMD_CRAFT, CMD_LEARN, RESULT_DENIED, RESULT_OK, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_PRIMARY, GLIDE_SINK, GLIDE_SPEED, JET_CUIRASS, STAMINA_UNITS } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import { Harness } from "../fixtures/net.ts";
import { camp, id, proving } from "../kit/kit.ts";

function setup() {
  const { h, ada: s, me: rec } = camp({ place: proving(), link: { latencyMs: 50 } });
  const e = h.ent(s);
  const inv = () => h.host.items.inv(rec);
  const have = (item: string) => inv().total(id(item));
  /** The durability of the first glider it carries. */
  const left = () => inv().dur[inv().item.indexOf(id("core:frond_glider"))]!;
  return { h, s, e, rec, id, inv, have, left, input: h.pilots[0]!, ents: h.world.ents, items: h.host.items };
}

/** One key down for a tenth of a second, and let go. */
function tap(h: Harness, input: { buttons: number }, key: number): void {
  input.buttons |= key;
  h.run(100);
  input.buttons &= ~key;
  h.run(100);
}

/** Text on the notice channel since log version `from`. */
const notices = (s: ClientSession, from: number): string[] => s.log.slice(Math.max(0, s.log.length - (s.logVersion - from))).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);

/** Let go at `up` metres over dry ground south of the proving ground's plaza, falling, with the prediction settled on it. */
function dropped(h: Harness, s: ClientSession, up: number, z = 150): void {
  h.say(s, `tp 256 ${up} ${z}`);
  h.run(300);
}

test("a survivor of level 2 learns it for nothing and lashes it from thatch, fibre and wood", () => {
  const { h, s, id, have, left, items } = setup();
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  const send = (f: () => void): number => {
    codes.length = 0;
    f();
    h.run(200);
    return codes[0]!;
  };
  const engram = id("core:engram-frond_glider");
  const learn = () => s.command(CMD_LEARN, (w) => w.u16(engram));
  const craft = () => s.command(CMD_CRAFT, (w) => (w.u16(id("core:frond_glider")), w.u8(1)));
  // Not at level 1, where only the pick is free.
  expect(send(learn)).not.toBe(RESULT_OK);
  h.say(s, "addxp 5");
  expect(s.progress.level).toBe(2);
  const points = s.progress.engramPoints;
  expect(send(craft)).toBe(RESULT_DENIED);
  expect(send(learn)).toBe(RESULT_OK);
  expect(s.progress.engramPoints).toBe(points);
  h.say(s, "give thatch 30");
  h.say(s, "give fiber 15");
  h.say(s, "give wood 4");
  expect(s.own.glideGear).toBe(0);
  expect(send(craft)).toBe(RESULT_OK);
  expect([have("core:thatch"), have("core:fiber"), have("core:wood"), have("core:frond_glider")]).toEqual([0, 0, 0, 0]);
  h.run(5200);
  expect(have("core:frond_glider")).toBe(1);
  expect(left()).toBe(100);
  // Its body is told it carries one as soon as it does.
  expect(s.own.glideGear).toBe(1);
  expect(items.audit()).toEqual([]);
});

test("it glides from 60 m with the prediction agreeing, another sees it, and it lands unhurt and worn", () => {
  const { h, s, e, left, input, ents } = setup();
  const watcher = h.join("grace");
  h.run(400);
  h.say(s, "give frond_glider 1");
  dropped(h, s, 60);
  expect([s.own.grounded, s.own.glide, s.own.glideGear]).toEqual([false, 0, 1]);
  const hp = s.vitals.at(V_HEALTH, s.serverTick);
  const corrections = s.stats.corrections;
  tap(h, input, BTN_CROUCH);
  expect([s.own.glide, ents.glide[e]]).toEqual([1, 1]);
  const opened = h.world.tick;
  const from = { y: s.own.y, z: s.own.z };
  input.moveZ = 1;
  h.run(3000);
  // At its trim, on both sides.
  expect(s.own.vz).toBeCloseTo(GLIDE_SPEED, 2);
  expect(s.own.vy).toBeCloseTo(-GLIDE_SINK, 3);
  expect(ents.vz[e]).toBeCloseTo(GLIDE_SPEED, 2);
  expect(s.own.stamina).toBeLessThan(100 * STAMINA_UNITS);
  const remote = new RemoteSample(), st = new AnimState();
  watcher.sampleRemote(remote);
  const k = remote.id.subarray(0, remote.count).indexOf(e);
  expect(k).toBeGreaterThanOrEqual(0);
  st.unpack(remote.anim[k]!, remote.cue[k]!);
  expect([st.glide, st.jet, st.grounded]).toEqual([true, false, false]);
  let ticks = 0;
  while (!s.own.grounded && ticks++ < 60 * TICK_RATE) h.run(1000 / TICK_RATE);
  h.run(300);
  expect([s.own.grounded, s.own.glide, ents.glide[e]]).toEqual([true, 0, 0]);
  expect(s.stats.corrections).toBe(corrections);
  expect(s.vitals.at(V_HEALTH, s.serverTick)).toBe(hp);
  // Most of 4.5 forward for each metre it came down.
  expect(s.own.z - from.z).toBeGreaterThan((from.y - s.own.y) * (GLIDE_SPEED / GLIDE_SINK) * 0.9);
  // One use for each three seconds it was open, charged as it folded and not before.
  const aloft = h.world.tick - opened;
  expect(100 - left()).toBeGreaterThanOrEqual(Math.floor(aloft / (3 * TICK_RATE)) - 1);
  expect(100 - left()).toBeLessThanOrEqual(Math.ceil(aloft / (3 * TICK_RATE)));
  watcher.sampleRemote(remote);
  st.unpack(remote.anim[remote.id.subarray(0, remote.count).indexOf(e)]!, remote.cue[remote.id.subarray(0, remote.count).indexOf(e)]!);
  expect(st.glide).toBe(false);
});

test("it is not worn in the air, and a short flight costs one use", () => {
  const { h, s, left, input } = setup();
  h.say(s, "give frond_glider 1");
  dropped(h, s, 200);
  tap(h, input, BTN_CROUCH);
  h.run(7000);
  expect([s.own.glide, left()]).toEqual([1, 100]);
  // Folded by its key after seven seconds: three uses.
  tap(h, input, BTN_CROUCH);
  expect(s.own.glide).toBe(0);
  expect(left()).toBe(97);
  // Open for a moment: one more.
  tap(h, input, BTN_CROUCH);
  tap(h, input, BTN_CROUCH);
  expect(left()).toBe(96);
});

test("its last flight is flown to the end; broken, it will not open, and the fall hurts", () => {
  const { h, s, rec, inv, id, left, input, items } = setup();
  h.say(s, "give frond_glider 1");
  const slot = inv().item.indexOf(id("core:frond_glider"));
  items.wear(rec, slot, 99);
  h.run(100);
  expect([left(), s.own.glideGear]).toEqual([1, 1]);
  dropped(h, s, 40);
  tap(h, input, BTN_CROUCH);
  h.run(6000);
  // Six seconds would cost two, and it has one: it flies on.
  expect([s.own.glide, left()]).toEqual([1, 1]);
  const before = s.logVersion;
  let ticks = 0;
  while (!s.own.grounded && ticks++ < 60 * TICK_RATE) h.run(1000 / TICK_RATE);
  h.run(300);
  expect([left(), s.own.glideGear]).toEqual([0, 0]);
  expect(notices(s, before)).toEqual(["Your frond glider has come apart."]);
  expect(inv().item[slot]).toBe(id("core:frond_glider"));
  const hp = s.vitals.at(V_HEALTH, s.serverTick);
  dropped(h, s, 12);
  tap(h, input, BTN_CROUCH);
  expect(s.own.glide).toBe(0);
  h.run(2000);
  expect(s.own.grounded).toBe(true);
  expect(s.vitals.at(V_HEALTH, s.serverTick)).toBeLessThan(hp);
  expect(items.audit()).toEqual([]);
});

test("under it both hands are full: no swing begins, and one begun is dropped", () => {
  const { h, s, e, input, ents } = setup();
  h.say(s, "give frond_glider 1");
  dropped(h, s, 200);
  const corrections = s.stats.corrections;
  // Falling, it may swing its fists.
  input.buttons = BTN_PRIMARY;
  h.run(200);
  expect(s.own.act).not.toBe(ACT_NONE);
  tap(h, input, BTN_CROUCH);
  input.buttons = BTN_PRIMARY;
  h.run(1500);
  expect([s.own.glide, s.own.act, ents.act[e]]).toEqual([1, ACT_NONE, ACT_NONE]);
  expect(s.stats.corrections).toBe(corrections);
});

test("in the Meridian cuirass Jump is the jet and Crouch the glider, predicted alike", () => {
  const { h, s, input } = setup();
  h.say(s, "armor meridian");
  h.say(s, "give frond_glider 1");
  dropped(h, s, 120);
  expect(s.own.jetGear & JET_CUIRASS).toBe(JET_CUIRASS);
  const corrections = s.stats.corrections;
  input.buttons = BTN_JUMP;
  h.run(1000);
  expect([s.own.glide, s.own.jetThrust !== 0]).toEqual([0, true]);
  input.buttons = 0;
  h.run(300);
  tap(h, input, BTN_CROUCH);
  expect([s.own.glide, s.own.jetThrust]).toEqual([1, 0]);
  input.moveZ = 1;
  h.run(2000);
  expect(s.own.vy).toBeCloseTo(-GLIDE_SINK, 3);
  // Jump folds it, and the jet answers the same press.
  input.buttons = BTN_JUMP;
  h.run(400);
  expect([s.own.glide, s.own.jetThrust !== 0]).toEqual([0, true]);
  expect(s.stats.corrections).toBe(corrections);
});
