import { expect, test } from "bun:test";
import { AnimState, CUE_JET } from "../../shared/anim/pose.ts";
import { BTN_JUMP, BTN_MELEE, BTN_SPRINT, JET_UP, JET_FIST, JET_DASH, JET_CAPACITY, JET_CUIRASS, JET_FULL_SUIT, JET_HOVER, JET_LIFT, JET_STRIDE } from "../../shared/sim/character.ts";
import { JET_SPENT_BITS } from "../../shared/net/protocol.ts";
import { V_HEALTH, V_OXYGEN } from "../../shared/sim/vitals.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
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

test("the spent reserve fits the bits it travels in", () => {
  // Raising JET_CAPACITY past them would wrap the owner's reserve on the wire and nothing else would say so.
  expect(JET_CAPACITY).toBeLessThan(1 << JET_SPENT_BITS);
});

test("the greaves lengthen a sprint on the ground by JET_STRIDE, only while serviceable", () => {
  const { h, wearer, rec, input } = fitted();
  const inv = h.host.items.inv(rec);
  const sprintSpeed = () => {
    input.buttons = BTN_SPRINT;
    input.moveZ = 1;
    h.run(1500);
    const v = Math.hypot(wearer.own.vx, wearer.own.vz);
    expect(wearer.own.grounded).toBe(true);
    input.buttons = 0;
    input.moveZ = 0;
    h.run(1500);
    return v;
  };
  const powered = sprintSpeed();
  h.host.items.wear(rec, inv.armor + 3, 999);
  h.run(200);
  const plain = sprintSpeed();
  expect(plain).toBeGreaterThan(1);
  expect(powered / plain).toBeCloseTo(JET_STRIDE, 2);
});

test("a sealed helmet keeps its wearer's air under water, and a broken one does not", () => {
  const { h, rec } = fitted();
  const inv = h.host.items.inv(rec);
  h.host.survival.setSubmerged(rec, true);
  expect(rec.vitals!.rate[V_OXYGEN]).toBeGreaterThanOrEqual(0);
  h.host.survival.setSubmerged(rec, false);
  h.host.items.wear(rec, inv.armor, 999);
  h.run(200);
  h.host.survival.setSubmerged(rec, true);
  expect(rec.vitals!.rate[V_OXYGEN]).toBeLessThan(0);
});

test("a double jump press fires one predicted up-burst and reaches an observer during the impulse", () => {
  const { h, wearer, e, input, ents } = fitted();
  const watcher = h.join("spotter");
  h.run(400);
  const corrections = wearer.stats.corrections;
  input.buttons = BTN_JUMP;
  h.run(83);
  input.buttons = 0;
  h.run(67);
  input.buttons = BTN_JUMP;
  h.run(100);
  expect(wearer.own.jetThrust).toBe(JET_UP);
  expect(wearer.own.vy).toBeGreaterThan(10);
  expect(ents.jetThrust[e]).toBe(JET_UP);
  expect(wearer.own.jetSpent).toBeGreaterThanOrEqual(24);
  const paid = wearer.own.jetSpent, remote = new RemoteSample(), st = new AnimState();
  let seen = false;
  for (let i = 0; i < 10; i++) {
    watcher.sampleRemote(remote);
    const k = remote.id.subarray(0,remote.count).indexOf(e);
    if (k >= 0) {
      st.unpack(remote.anim[k]!, remote.cue[k]!);
      seen ||= st.jet && st.jetMode === JET_UP && st.bootJets;
    }
    input.buttons = i % 2 ? BTN_JUMP : 0;
    h.run(33);
  }
  expect(seen).toBe(true);
  expect(wearer.own.jetRecovery).toBeGreaterThan(0);
  expect(wearer.own.jetSpent-paid).toBeLessThan(8);
  expect(wearer.stats.corrections).toBe(corrections);
});

test("a greave burst holds its strafe vector through a camera turn and requires intact leggings", () => {
  const { h, wearer, rec, input } = fitted();
  const inv = h.host.items.inv(rec);
  input.buttons = BTN_JUMP;
  h.run(650);
  input.moveX = 1;
  const tapShift = () => {
    input.buttons = BTN_JUMP | BTN_SPRINT; h.run(66);
    input.buttons = BTN_JUMP; h.run(68);
    input.buttons = BTN_JUMP | BTN_SPRINT; h.run(66);
  };
  tapShift();
  expect(wearer.own.jetThrust).toBe(JET_DASH);
  expect(wearer.own.vx).toBeCloseTo(-18, 3);
  input.yaw = Math.PI / 2;
  input.moveX = 0;
  input.moveZ = 1;
  h.run(100);
  expect(wearer.own.vx).toBeCloseTo(-18, 3);
  expect(wearer.own.vz).toBeCloseTo(0, 3);
  input.buttons = BTN_JUMP; h.run(1200);
  h.host.items.wear(rec, inv.armor + 3, 999);
  h.run(200);
  tapShift();
  expect(wearer.own.jetThrust).toBe(JET_HOVER);
});

test("the glove impulse follows aim, starts a melee swing and cuts out on loss of a gauntlet", () => {
  const { h, wearer, e, rec, input, ents } = fitted();
  input.buttons = BTN_JUMP; h.run(650);
  input.pitch = 0.45;
  input.buttons = BTN_JUMP | BTN_MELEE; h.run(167);
  expect(wearer.own.jetThrust).toBe(JET_FIST);
  expect(ents.jetThrust[e]).toBe(JET_FIST);
  expect(wearer.own.act).toBeGreaterThan(0);
  expect(wearer.own.vz).toBeGreaterThan(12);
  expect(wearer.own.vy).toBeGreaterThan(5);
  h.host.items.wear(rec, h.host.items.inv(rec).armor + 2, 999);
  h.run(100);
  expect(ents.jetThrust[e]).not.toBe(JET_FIST);
  input.buttons = BTN_JUMP; h.run(1100);
  input.buttons |= BTN_MELEE; h.run(66);
  expect(wearer.own.jetThrust).toBe(JET_LIFT);
});

test("the flying punch can connect with a second airborne survivor through the authoritative melee resolver", () => {
  const { h, wearer, rec, input } = fitted();
  const target = h.join("sparring");
  h.run(500);
  h.say(target, "enablecheats");
  h.say(target, "armor meridian");
  h.say(target, "tp 245 259");
  const other = h.pilots[1]!;
  input.buttons = other.buttons = BTN_JUMP;
  h.run(800);
  input.buttons |= BTN_SPRINT; other.buttons |= BTN_SPRINT;
  h.run(300);
  input.pitch = -0.12;
  const hits = h.host.combat.hits;
  input.buttons |= BTN_MELEE;
  h.run(430);
  expect(h.host.combat.hits).toBe(hits + 1);
  expect(h.host.combat.last.by).toBe(rec.pid);
  expect(h.host.combat.last.victim).toBe(h.world.ents.pid[h.ent(target)]!);
  expect(h.host.combat.last.damage).toBeGreaterThan(0);
  expect(wearer.own.jetRecovery).toBeGreaterThan(0);
});

test("flight is each piece's own jet property, not its set's name", () => {
  // A cuirass of the hide set that flies, beside the game's own pieces.
  const made = compileContent([...CORE_CONTENT, { type: "item", class: "armor", id: "test:lift_vest", stack: 1, weight: 6, color: 2, wear: { slot: "torso", set: "hide", armor: 100, uses: 120, colors: [2, 11, 6], jet: true } }]);
  expect(made.errors).toEqual([]);
  const reg = made.registry!;
  const flies = reg.ids.filter((_, k) => reg.wearJet[k] === 1).sort();
  expect(flies).toEqual(["core:meridian_boots", "core:meridian_gloves", "core:meridian_hat", "core:meridian_pants", "core:meridian_shirt", "test:lift_vest"]);
  const h = new Harness({}, 1, 60, { dev: true }, reg);
  const wearer = h.join("pilot");
  h.run(500);
  h.say(wearer, "enablecheats");
  h.say(wearer, "tp 245 255");
  // The whole flak set flies nothing.
  h.say(wearer, "armor flak");
  h.run(400);
  const input = h.pilots[0]!;
  const floor = wearer.own.y;
  expect(wearer.own.jetGear).toBe(0);
  input.buttons = BTN_JUMP;
  h.run(2000);
  expect([wearer.own.jetThrust, wearer.own.y < floor + 2]).toEqual([0, true]);
  input.buttons = 0;
  h.run(1000);
  // The vest in the flak cuirass's place lifts her, whatever its set is called.
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(wearer)]!)!;
  const items = h.host.items, inv = items.inv(rec);
  items.burn(rec, inv.armor + 1, 1);
  const vest = reg.index.get("test:lift_vest")!;
  expect(items.mint(rec, vest, 1)).toBe(1);
  expect(items.move(rec, inv.item.indexOf(vest), rec, inv.armor + 1, 0)).toBe(1);
  h.run(400);
  expect(wearer.own.jetGear).toBe(JET_CUIRASS);
  input.buttons = BTN_JUMP;
  h.run(2000);
  expect(wearer.own.jetThrust).toBe(JET_LIFT);
  expect(wearer.own.y).toBeGreaterThan(floor + 4);
});
