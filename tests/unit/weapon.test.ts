import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { BTN_MELEE, BTN_PRIMARY, BTN_RELOAD, Body, MODE_NONE, MODE_SWIM } from "../../shared/sim/character.ts";
import { DMG_BULLET, DMG_MELEE, DMG_PIERCE, DRAW_MIN, PIECE_SCALE, WEAR_PER_USE, harm, hit, resetHit, resolveDamage } from "../../shared/sim/damage.ts";
import {
  ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING, EQUIP_TICKS, FISTS, HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_SPEAR, HOLD_THROW, HOLD_TOOL,
  SWING_TICKS, W_BOW, W_GUN, W_MELEE, W_THROWN, actionOut, stepAction, type WeaponParams,
} from "../../shared/sim/weapon.ts";
import { ZONE_FOOT_L, ZONE_HEAD, ZONE_LEG_R, ZONE_TORSO } from "../../shared/anim/human.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const params = (name: string): WeaponParams => reg.weapon[reg.index.get(`core:${name}`)!]!;

/** Step a body for `ticks` with the same buttons held, noting the ticks (from 1) on which each thing happened. */
function hold(b: Body, w: WeaponParams, buttons: number, ticks: number, first = 0): { strikes: number[]; fires: number[]; reloads: number[]; draws: number[] } {
  const out = { strikes: [] as number[], fires: [] as number[], reloads: [] as number[], draws: [] as number[] };
  let before = first;
  for (let t = 1; t <= ticks; t++) {
    stepAction(b, buttons, buttons & ~before, w);
    before = buttons;
    if (actionOut.strike) out.strikes.push(t);
    if (actionOut.fire) {
      out.fires.push(t);
      out.draws.push(actionOut.draw);
    }
    if (actionOut.reloaded) out.reloads.push(t);
  }
  return out;
}

test("content compiles into weapon timings: a swing, a draw, a reload and a clip per weapon", () => {
  expect(params("hatchet")).toEqual({ kind: W_MELEE, hold: HOLD_TOOL, swingTicks: SWING_TICKS, strikeTick: 5, drawTicks: 0, minDrawTicks: 0, reloadTicks: 0, clip: 0, wet: true });
  expect(params("spear").hold).toBe(HOLD_SPEAR);
  // A bow draws for 1.2 s, can be loosed from a quarter of that, and nocks in two thirds of a second.
  expect(params("bow")).toEqual({ kind: W_BOW, hold: HOLD_BOW, swingTicks: 6, strikeTick: 2, drawTicks: 36, minDrawTicks: 9, reloadTicks: 20, clip: 1, wet: false });
  expect(params("rifle")).toMatchObject({ kind: W_GUN, hold: HOLD_RIFLE, reloadTicks: 135, clip: 1, wet: false });
  expect(params("crossbow")).toMatchObject({ kind: W_GUN, wet: true, reloadTicks: 78 });
  expect(params("pistol")).toMatchObject({ kind: W_GUN, hold: HOLD_PISTOL, clip: 6, swingTicks: 11 });
  expect(params("grenade")).toMatchObject({ kind: W_THROWN, hold: HOLD_THROW });
  expect(FISTS.hold).toBe(HOLD_HANDS);
  // What is not a weapon has no timings; bare hands stand in.
  expect(reg.weapon[reg.index.get("core:berry")!]).toBeNull();
  // Damage, reach and armor sit in columns beside them.
  const k = (name: string): number => reg.index.get(`core:${name}`)!;
  expect([reg.damage[k("hatchet")], reg.damageType[k("hatchet")], reg.damage[k("spear")], reg.damageType[k("spear")]]).toEqual([20, DMG_MELEE, 30, DMG_PIERCE]);
  expect([reg.damage[k("round_rifle")], reg.damageType[k("round_rifle")], reg.damage[k("survivor")]]).toEqual([280, DMG_BULLET, 8]);
  expect(reg.reach[k("spear")]).toBe(3);
  expect(reg.reach[k("hatchet")]).toBeCloseTo(2.6, 5);
  expect(reg.reach[k("survivor")]).toBeCloseTo(2.2, 5);
  expect([reg.armor[k("flak_shirt")], reg.armor[k("cloth_hat")], reg.armor[k("hatchet")]]).toEqual([100, 10, 0]);
  // A survivor's head counts three times, the rest once; a creature takes less from a bullet.
  const zones = reg.zoneMul[k("survivor")]!;
  expect([zones[ZONE_HEAD], zones[ZONE_TORSO], zones[ZONE_LEG_R], zones[ZONE_FOOT_L]]).toEqual([3, 1, 1, 1]);
  expect(reg.takes[k("grazer")]![DMG_BULLET]).toBeCloseTo(0.7, 5);
  expect(reg.takes[k("survivor")]![DMG_BULLET]).toBe(1);
});

test("a held button swings again and again, each swing landing once, a third of the way through", () => {
  const b = new Body();
  const out = hold(b, FISTS, BTN_PRIMARY, SWING_TICKS * 3);
  // The swing begins on the first tick and lands five ticks into it; the next begins the tick the last one ends.
  expect(out.strikes).toEqual([6, 6 + SWING_TICKS, 6 + SWING_TICKS * 2]);
  expect(out.fires).toEqual([]);
  // Let go mid swing: it finishes, and no more follow.
  const b2 = new Body();
  hold(b2, FISTS, BTN_PRIMARY, 3);
  const rest = hold(b2, FISTS, 0, 40, BTN_PRIMARY);
  expect(rest.strikes).toEqual([3]);
  expect(b2.act).toBe(ACT_NONE);
  // The melee button swings whatever is held.
  const b3 = new Body();
  expect(hold(b3, params("hatchet"), BTN_MELEE, SWING_TICKS).strikes).toEqual([6]);
});

test("a bow is drawn while the button is held and looses when it is let go, harder the longer it was drawn", () => {
  const bow = params("bow");
  const b = new Body();
  b.rounds = 1;
  b.reloadTo = 1;
  // Let go too soon: the string is let down and the arrow stays.
  hold(b, bow, BTN_PRIMARY, 5);
  expect(b.act).toBe(ACT_DRAW);
  let out = hold(b, bow, 0, 2, BTN_PRIMARY);
  expect([out.fires.length, b.rounds, b.act]).toEqual([0, 1, ACT_NONE]);
  // Half drawn: half the way.
  hold(b, bow, BTN_PRIMARY, 19);
  out = hold(b, bow, 0, 1, BTN_PRIMARY);
  expect(out.fires).toEqual([1]);
  expect(out.draws[0]).toBeCloseTo(0.5, 5);
  expect([b.rounds, b.act]).toEqual([0, ACT_COOL]);
  // After the pause it nocks the next by itself, if there is one to nock.
  b.reloadTo = 1;
  out = hold(b, bow, 0, bow.swingTicks + bow.reloadTicks);
  expect(out.reloads).toEqual([bow.swingTicks + bow.reloadTicks]);
  expect([b.rounds, b.act]).toEqual([1, ACT_NONE]);
  // Held past full draw it waits, and looses at full strength.
  hold(b, bow, BTN_PRIMARY, 100);
  expect(b.act).toBe(ACT_HOLD);
  out = hold(b, bow, 0, 1, BTN_PRIMARY);
  expect(out.draws).toEqual([1]);
  // The melee button lets a drawn bow down without loosing.
  b.act = ACT_NONE;
  b.rounds = 1;
  hold(b, bow, BTN_PRIMARY, 20);
  out = hold(b, bow, BTN_PRIMARY | BTN_MELEE, 1, BTN_PRIMARY);
  expect([out.fires.length, b.rounds, b.act]).toEqual([0, 1, ACT_NONE]);
  // With no arrows left nothing can be drawn.
  b.rounds = 0;
  b.reloadTo = 0;
  hold(b, bow, BTN_PRIMARY, 30);
  expect(b.act).toBe(ACT_NONE);
});

test("a gun fires once a press, pauses between shots, and reloads when asked or when empty", () => {
  const pistol = params("pistol");
  const b = new Body();
  b.rounds = 6;
  b.reloadTo = 6;
  // Holding the trigger fires once.
  let out = hold(b, pistol, BTN_PRIMARY, 40);
  expect(out.fires).toEqual([1]);
  expect(b.rounds).toBe(5);
  // Pressing again during the pause does nothing; after it, it fires.
  b.act = ACT_NONE;
  stepAction(b, BTN_PRIMARY, BTN_PRIMARY, pistol);
  expect(actionOut.fire).toBe(true);
  stepAction(b, 0, 0, pistol);
  stepAction(b, BTN_PRIMARY, BTN_PRIMARY, pistol);
  expect([actionOut.fire, b.rounds, b.act]).toEqual([false, 4, ACT_COOL]);
  hold(b, pistol, 0, pistol.swingTicks);
  expect(b.act).toBe(ACT_NONE);
  // The reload key, with rounds missing and rounds to put in.
  stepAction(b, BTN_RELOAD, BTN_RELOAD, pistol);
  expect(b.act).toBe(ACT_RELOAD);
  out = hold(b, pistol, 0, pistol.reloadTicks);
  expect(out.reloads).toEqual([pistol.reloadTicks]);
  expect(b.rounds).toBe(6);
  // Full, the key does nothing.
  stepAction(b, BTN_RELOAD, BTN_RELOAD, pistol);
  expect(b.act).toBe(ACT_NONE);
  // The last round fired, it reloads by itself; with nothing to reload with it waits empty.
  const rifle = params("rifle");
  b.rounds = 1;
  b.reloadTo = 1;
  out = hold(b, rifle, BTN_PRIMARY, rifle.swingTicks + 1);
  expect([out.fires.length, b.rounds, b.act]).toEqual([1, 0, ACT_RELOAD]);
  b.act = ACT_NONE;
  b.reloadTo = 0;
  out = hold(b, rifle, 0, 5);
  stepAction(b, BTN_PRIMARY, BTN_PRIMARY, rifle);
  expect([actionOut.fire, b.act]).toEqual([false, ACT_NONE]);
});

test("a thrown thing leaves the hand partway through the swing; taking something in hand takes a moment; water stops what is not made for it", () => {
  const b = new Body();
  const out = hold(b, params("grenade"), BTN_PRIMARY, SWING_TICKS);
  expect(out.fires).toEqual([params("grenade").strikeTick + 1]);
  expect(out.strikes).toEqual([]);
  // Equipping: nothing happens until it is in hand, then a held button swings.
  const e = new Body();
  e.act = ACT_EQUIP;
  const eq = hold(e, FISTS, BTN_PRIMARY, EQUIP_TICKS + 6);
  expect(eq.strikes).toEqual([EQUIP_TICKS + 5]);
  // Under water a bow does not draw and a drawn one is let down; a crossbow fires; fists swing.
  const w = new Body();
  w.mode = MODE_SWIM;
  w.rounds = 1;
  w.reloadTo = 1;
  hold(w, params("bow"), BTN_PRIMARY, 10);
  expect(w.act).toBe(ACT_NONE);
  stepAction(w, BTN_PRIMARY, BTN_PRIMARY, params("crossbow"));
  expect(actionOut.fire).toBe(true);
  const f = new Body();
  f.mode = MODE_SWIM;
  expect(hold(f, FISTS, BTN_PRIMARY, 10).strikes).toEqual([6]);
  // A body that is not in the world does nothing.
  const d = new Body();
  d.mode = MODE_NONE;
  d.act = ACT_SWING;
  d.actTicks = 3;
  stepAction(d, BTN_PRIMARY, BTN_PRIMARY, FISTS);
  expect([d.act, d.actTicks, actionOut.strike]).toEqual([ACT_NONE, 0, false]);
});

test("what a body is doing with what it holds travels with the body", () => {
  const a = new Body();
  a.held = 321;
  a.act = ACT_RELOAD;
  a.actTicks = 135;
  a.rounds = 6;
  a.reloadTo = 255;
  const w = new BitWriter(64);
  writeBody(w, a);
  expect(w.pos).toBe(344);
  const b = new Body();
  readBody(new BitReader(w.bytes()), b);
  expect(b.equals(a)).toBe(true);
  expect([b.held, b.act, b.actTicks, b.rounds, b.reloadTo]).toEqual([321, ACT_RELOAD, 135, 6, 255]);
  const c = new Body();
  c.copy(a);
  expect(c.equals(a)).toBe(true);
  c.act = ACT_NONE;
  expect(c.equals(a)).toBe(false);
});

test("damage is one multiplication in a fixed order, and armor is worn by what it stops", () => {
  // A bare punch to the body.
  resetHit();
  hit.base = 8;
  resolveDamage();
  expect([harm.health, harm.blocked, harm.wear, harm.torpor]).toEqual([8, 0, 0, 0]);
  // To the head it counts three times.
  hit.zone = 3;
  resolveDamage();
  expect(harm.health).toBe(24);
  // A rifle round to a flak shirt: the piece counts five times, so a sixth gets through.
  resetHit();
  hit.base = 280;
  hit.type = DMG_BULLET;
  hit.armor = 100 * PIECE_SCALE;
  resolveDamage();
  expect(harm.health).toBeCloseTo(280 / 6, 6);
  expect(harm.blocked).toBeCloseTo(280 - 280 / 6, 6);
  expect(harm.wear).toBe(Math.ceil((280 - 280 / 6) / WEAR_PER_USE));
  // The same round to the head of a creature that takes seven tenths of a bullet, from a better rifle.
  resetHit();
  hit.base = 280;
  hit.quality = 1.2;
  hit.takes = 0.7;
  hit.zone = 3;
  resolveDamage();
  expect(harm.health).toBeCloseTo(280 * 1.2 * 0.7 * 3, 6);
  // A bow undrawn gives a quarter, half drawn five eighths, and never more than all.
  resetHit();
  hit.base = 55;
  for (const [draw, share] of [[0, DRAW_MIN], [0.5, 0.625], [1, 1], [3, 1]] as const) {
    hit.draw = draw;
    resolveDamage();
    expect(harm.health).toBeCloseTo(55 * share, 6);
  }
  // Torpor follows the damage that got through: at once, and to come.
  resetHit();
  hit.base = 20;
  hit.armor = 100;
  hit.torporInstant = 2;
  hit.torporOver = 2.5;
  resolveDamage();
  expect([harm.health, harm.torpor, harm.torporOver]).toEqual([10, 20, 25]);
  // The attacker's strength, the victim's own resistance and the server's rule are factors like any other.
  resetHit();
  hit.base = 10;
  hit.attack = 1.5;
  hit.resist = 0.5;
  hit.rule = 2;
  resolveDamage();
  expect(harm.health).toBe(15);
  // Nothing in, nothing out; armor below nothing is nothing.
  resetHit();
  hit.armor = -50;
  resolveDamage();
  expect([harm.health, harm.blocked, harm.wear]).toEqual([0, 0, 0]);
});
