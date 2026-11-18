import { expect, test } from "bun:test";
import type { CreatureCombatFacet } from "../../shared/content/defs.ts";
import { creatureCombatFaults } from "../../shared/content/creature-combat.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { BTN_PRIMARY, BTN_RELOAD, BTN_SECONDARY, Body, MF_OUT, MODE_SWIM } from "../../shared/sim/character.ts";
import { creatureHold, stepCreature } from "../../shared/sim/creature-actions.ts";
import { ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { Rng } from "../../shared/rng.ts";
import { flatWorld } from "../fixtures/world.ts";

const primary = { name: "sweep", clip: "attack", alternateClip: "attack_right", socket: "head", radius: .4, reach: 5, damage: 30, type: "melee" as const, ticks: 24, lands: 9, through: 14, stamina: 5 };
const charge = { minWindup: 12, windup: 30, duration: 90, recovery: 18, cooldown: 120, speed: 12, turn: 40, stamina: 10, staminaPerSecond: 15, attack: primary };
const charging: CreatureCombatFacet = { primary, charge };
const modes: CreatureCombatFacet = { primary, switchTicks: 24, modes: [
  { name: "Hardened", clip: "plate_hardened", damageTaken: .5 }, { name: "Heavy", clip: "plate_heavy", damageTaken: 1 }, { name: "Sharpened", clip: "plate_sharpened", damageTaken: 1 },
] };
function setup(c: CreatureCombatFacet = charging) {
  const w = flatWorld(), b = new Body(), p = w.reg.tamedMove[w.kind("core:parasaur")]!;
  b.x = 64; b.z = 20; b.grounded = true; b.stamina = 100000;
  let previous = 0;
  const tick = (buttons = 0, quiet = false) => { stepCreature(w, b, 0, 127, 0, 0, buttons, buttons & ~previous, p, c, TICK_DT, true, quiet); previous = buttons; };
  return { w, b, p, tick };
}
test("charge winds up without moving or regenerating, scales speed, pays once and recovers on cancel", () => {
  const { b, tick } = setup();
  tick(BTN_SECONDARY); expect(b.act).toBe(ACT_DRAW); expect(b.stamina).toBe(90000);
  for (let i = 0; i < 20; i++) tick(BTN_SECONDARY);
  expect(b.z).toBe(20); expect(b.stamina).toBe(90000);
  tick(); expect(b.act).toBe(ACT_HOLD); expect(b.creaturePower).toBe(179);
  for (let i = 0; i < 30; i++) tick();
  expect(b.z).toBeGreaterThan(25); expect(b.z).toBeLessThan(31); expect(b.stamina).toBe(75000);
  tick(BTN_PRIMARY); expect(b.act).toBe(ACT_COOL); expect(b.creatureCooldown).toBe(120);
});
test("a premature release, dry stamina and vanished input cannot launch a charge", () => {
  const a = setup(); a.tick(BTN_SECONDARY); a.tick(); expect(a.b.act).toBe(ACT_NONE); expect(a.b.creatureCooldown).toBeGreaterThan(0);
  const b = setup(); b.b.stamina = 9999; b.tick(BTN_SECONDARY); expect(b.b.act).toBe(ACT_NONE);
  const c = setup(); for (let i = 0; i < 35; i++) c.tick(BTN_SECONDARY); expect(c.b.act).toBe(ACT_HOLD);
  c.tick(0, true); expect(c.b.act).toBe(ACT_NONE); expect(c.b.creaturePower).toBe(0);
});
test("a charge stops on the ordinary collision wall and never moves through it", () => {
  const { w, b, tick } = setup(); w.structs.add(w.kind("core:wall"), 64, 1.5, 29, 0, 0, 1);
  for (let i = 0; i < 100; i++) tick(i < 31 ? BTN_SECONDARY : 0);
  expect(b.z).toBeLessThan(28); expect(b.z).toBeGreaterThan(26);
  expect(b.act).not.toBe(ACT_HOLD); expect(b.creatureCooldown).toBeGreaterThan(0);
});
test("knockout and water cancel committed actions without another hit phase", () => {
  for (const reason of ["out", "water"] as const) {
    const { b, tick } = setup(); for (let i = 0; i < 32; i++) tick(BTN_SECONDARY);
    if (reason === "out") b.mflags = MF_OUT; else b.mode = MODE_SWIM;
    tick(BTN_PRIMARY | BTN_SECONDARY); expect(b.act).toBe(ACT_NONE); expect(b.creaturePower).toBe(0);
  }
});
test("plate mode switches midway, cannot alter a swing, and survives the ordinary remote pose word", () => {
  const { b, tick } = setup(modes); tick(BTN_PRIMARY); expect(b.act).toBe(ACT_SWING);
  tick(BTN_RELOAD); expect(b.act).toBe(ACT_SWING); expect(b.creatureMode).toBe(0);
  for (let i = 0; i < 24; i++) tick();
  tick(BTN_RELOAD); expect(b.act).toBe(ACT_EQUIP);
  for (let i = 0; i < 11; i++) tick(); expect(b.creatureMode).toBe(0);
  tick(); expect(b.creatureMode).toBe(1);
  const st = new AnimState(), restored = new AnimState(); st.setAction(b.act, creatureHold(b), 300 - b.actTicks);
  restored.unpack(st.pack(), 0); expect((restored.action >> 4) & 3).toBe(1); expect(restored.actionStart).toBe(288 & 255);
});
test("seeded action replay remains bit-identical through owner packets and body copies", () => {
  const { w, b, p } = setup(), replay = new Body(), rng = new Rng(721), writer = new BitWriter(256), reader = new BitReader();
  replay.copy(b); let previous = 0;
  for (let i = 0; i < 900; i++) {
    const buttons = rng.int(4) === 0 ? BTN_PRIMARY : rng.int(3) === 0 ? BTN_SECONDARY : 0;
    const yaw = rng.int(65536), mx = rng.int(255) - 127, mz = rng.int(255) - 127;
    stepCreature(w, b, mx, mz, yaw, 0, buttons, buttons & ~previous, p, charging, TICK_DT);
    stepCreature(w, replay, mx, mz, yaw, 0, buttons, buttons & ~previous, p, charging, TICK_DT);
    expect(replay).toEqual(b);
    if (i % 13 === 0) { writer.reset(); writeBody(writer, b); reader.reset(writer.bytes()); readBody(reader, replay); expect(reader.overflow).toBe(false); expect(replay).toEqual(b); }
    previous = buttons;
  }
});
test("invalid combat content cannot reach the controller", () => {
  const { w } = setup(); const d = w.reg.defs[w.kind("core:parasaur")]!;
  if (d.type !== "species") throw new Error("fixture species");
  expect(creatureCombatFaults({ ...d, combat: charging }, w.reg.defs.filter(x => !!x))).toEqual([]);
  expect(creatureCombatFaults({ ...d, combat: { ...charging, charge: { ...charge, duration: 300 } } }, [])).not.toEqual([]);
  expect(creatureCombatFaults({ ...d, combat: { ...modes, modes: [] } }, [])).not.toEqual([]);
  expect(creatureCombatFaults({ ...d, camera: { height: 4, distance: 7, avoidBody: true } }, [])).toEqual([]);
  expect(creatureCombatFaults({ ...d, camera: { height: 4, distance: 7, avoidBody: 1 as unknown as boolean } }, [])).not.toEqual([]);
});


test("a held primary respects its own cooldown without blocking the secondary ability", () => {
  const { b, tick } = setup({ ...charging, primary: { ...primary, cooldown: 60 } });
  tick(BTN_PRIMARY); expect(b.act).toBe(ACT_SWING);
  for (let i = 0; i < 30; i++) tick(BTN_PRIMARY);
  expect(b.act).toBe(ACT_NONE); expect(b.creaturePrimaryCooldown).toBe(30);
  tick(BTN_SECONDARY); expect(b.act).toBe(ACT_DRAW);
  const other = new Body(); other.copy(b); expect(other.equals(b)).toBe(true);
  other.creatureMode = 1; expect(other.equals(b)).toBe(false);
});
