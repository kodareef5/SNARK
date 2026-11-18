import { expect, test } from "bun:test";
import { CUE_JET } from "../../shared/anim/pose.ts";
import { BTN_JUMP, BTN_SPRINT, JET_CAPACITY, JET_FULL_SUIT, JET_HOVER, JET_LIFT } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { Harness } from "../fixtures/net.ts";
import { HudModel, updateHud } from "../../client/core/hud.ts";
import { buildHud, KEY_JET_FUEL } from "../../client/core/ui/hud.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";

function fitted() {
  const h = new Harness({}, 1, 60, { dev: true });
  const wearer = h.join("pilot", { latencyMs: 50 });
  h.run(500);
  h.say(wearer, "enablecheats");
  h.say(wearer, "armor meridian");
  h.say(wearer, "tp 245 255");
  h.run(400);
  const e = h.ent(wearer);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  return { h, wearer, e, rec, input: h.pilots[0]!, ents: h.world.ents };
}

test("ten seconds of predicted lift and level flight burn a shared reserve, replicate the plume, then recharge on landing", () => {
  const { h, wearer, e, input, ents } = fitted();
  const watcher = h.join("spotter");
  h.run(400);
  const remote = new RemoteSample();
  const plume = () => {
    watcher.sampleRemote(remote);
    const i = remote.id.subarray(0, remote.count).indexOf(e);
    return i >= 0 && (remote.cue[i]! & CUE_JET) !== 0;
  };
  const hp = wearer.vitals.at(V_HEALTH, wearer.serverTick);
  const floor = wearer.own.y;
  const corrections = wearer.stats.corrections;
  expect(wearer.own.jetGear).toBe(JET_FULL_SUIT);
  input.buttons = BTN_JUMP;
  h.run(3500);
  expect(wearer.own.jetThrust).toBe(JET_LIFT);
  expect(wearer.own.y).toBeGreaterThan(floor + 10);
  expect(plume()).toBe(true);
  input.buttons |= BTN_SPRINT;
  input.moveZ = 1;
  h.run(800);
  const altitude = wearer.own.y;
  h.run(800);
  expect(wearer.own.jetThrust).toBe(JET_HOVER);
  expect(wearer.own.y).toBeCloseTo(altitude, 4);
  expect(wearer.own.vz).toBeCloseTo(10, 3);
  input.moveZ = 0;
  h.run(5100);
  expect(wearer.own.jetSpent).toBe(JET_CAPACITY);
  expect(ents.jetSpent[e]).toBe(JET_CAPACITY);
  expect(wearer.own.vy).toBeLessThan(0);
  expect(wearer.stats.corrections).toBe(corrections);
  input.buttons = 0;
  h.run(400);
  expect(plume()).toBe(false);
  h.run(2000);
  expect(wearer.own.grounded).toBe(true);
  expect(wearer.own.jetSpent).toBeGreaterThan(0);
  expect(wearer.vitals.at(V_HEALTH, wearer.serverTick)).toBe(hp);
  h.run(5000);
  expect(wearer.own.jetSpent).toBe(0);
});

test("a broken or removed cuirass cuts thrust, and changing armor in midair cannot refill the tank", () => {
  const { h, wearer, input, rec } = fitted();
  const inv = h.host.items.inv(rec);
  h.host.items.wear(rec, inv.armor + 3, 999);
  input.buttons = BTN_JUMP;
  h.run(2800);
  input.buttons |= BTN_SPRINT;
  input.moveZ = 1;
  h.run(650);
  expect(wearer.own.vz).toBeCloseTo(6, 3);
  h.host.items.wear(rec, inv.armor + 1, 999);
  h.run(350);
  input.buttons = 0;
  h.run(200);
  const spent = wearer.own.jetSpent;
  expect(wearer.own.jetThrust).toBe(0);
  expect(wearer.own.vy).toBeLessThan(0);
  h.say(wearer, "armor meridian");
  expect(wearer.own.jetSpent).toBe(spent);
  input.buttons = BTN_JUMP;
  h.run(250);
  expect(wearer.own.jetSpent).toBeGreaterThan(spent);
});

test("the flight gauge follows the equipped survivor and shows remaining seconds and grounded recharge", () => {
  const { h, wearer, input } = fitted();
  const hud = new HudModel(), frame = new UiFrame(), remote = new RemoteSample();
  const draw = () => {
    updateHud(hud, wearer, remote, 60);
    frame.begin(16 / 9);
    buildHud(frame, hud);
  };
  draw();
  expect(frame.find(KEY_JET_FUEL + 1)?.text).toContain("10.0 s");
  expect(frame.find(KEY_JET_FUEL + 4)?.text).toContain("2×");
  input.buttons = BTN_JUMP;
  h.run(1200);
  draw();
  expect(frame.find(KEY_JET_FUEL + 3)?.text).toBe("Climbing");
  expect(frame.find(KEY_JET_FUEL + 2)!.value).toBeLessThan(1);
  input.buttons = 0;
  h.run(1100);
  draw();
  expect(frame.find(KEY_JET_FUEL + 3)?.text).toBe("Recharging");
  h.say(wearer, "armor off");
  draw();
  expect(frame.find(KEY_JET_FUEL + 1)).toBeNull();
});

test("the boots alone absorb a hard landing only while serviceable", () => {
  const { h, wearer, rec, input } = fitted();
  const inv = h.host.items.inv(rec);
  for (let slot = 0; slot < 4; slot++) h.host.items.wear(rec, inv.armor + slot, 999);
  const health = () => wearer.vitals.at(V_HEALTH, wearer.serverTick);
  const start = health();
  const drop = () => {
    h.say(wearer, "tp 245 10 255");
    input.buttons = 0;
    h.run(2000);
    expect(wearer.own.grounded).toBe(true);
  };
  drop();
  expect(health()).toBe(start);
  h.host.items.wear(rec, inv.armor + 4, 999);
  drop();
  expect(health()).toBeLessThan(start);
});
