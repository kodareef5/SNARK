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
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ItemDef, WeaponFacet } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { launchSpeed } from "../../shared/sim/projectiles.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const params = (name: string): WeaponParams => reg.weapon[reg.index.get(`core:${name}`)!]!;

/** Steps a body for `ticks` with the same buttons held and records the ticks, counted from 1, on which each event happened. */
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
  // A bow draws for 1.2 s, can be loosed from a quarter of that (Base Damage: 0.3 s), and nocks in two thirds of a second.
  // Its blow, as every ranged weapon's, is a swing of half a second that lands a third of the way through.
  expect(params("bow")).toEqual({ kind: W_BOW, hold: HOLD_BOW, swingTicks: 6, strikeTick: 2, drawTicks: 36, minDrawTicks: 9, reloadTicks: 20, clip: 1, wet: false, meleeTicks: 15, meleeStrikeTick: 5 });
  expect(params("rifle")).toMatchObject({ kind: W_GUN, hold: HOLD_RIFLE, reloadTicks: 135, clip: 1, wet: false });
  expect(params("crossbow")).toMatchObject({ kind: W_GUN, wet: true, reloadTicks: 78 });
  expect(params("pistol")).toMatchObject({ kind: W_GUN, hold: HOLD_PISTOL, clip: 6, swingTicks: 14, reloadTicks: 100 });
  expect(params("grenade")).toMatchObject({ kind: W_THROWN, hold: HOLD_THROW });
  expect(FISTS.hold).toBe(HOLD_HANDS);
  // An item that is not a weapon has no timings, and bare hands stand in.
  expect(reg.weapon[reg.index.get("core:berry")!]).toBeNull();
  const k = (name: string): number => reg.index.get(`core:${name}`)!;
  expect([reg.damage[k("hatchet")], reg.damageType[k("hatchet")], reg.damage[k("spear")], reg.damageType[k("spear")]]).toEqual([20, DMG_MELEE, 30, DMG_PIERCE]);
  expect([reg.damage[k("round_rifle")], reg.damageType[k("round_rifle")], reg.damage[k("survivor")]]).toEqual([280, DMG_BULLET, 8]);
  expect(reg.reach[k("spear")]).toBe(3);
  expect(reg.reach[k("hatchet")]).toBeCloseTo(2.6, 5);
  expect(reg.reach[k("survivor")]).toBeCloseTo(2.2, 5);
  expect([reg.armor[k("flak_shirt")], reg.armor[k("cloth_hat")], reg.armor[k("hatchet")]]).toEqual([100, 10, 0]);
  const zones = reg.zoneMul[k("survivor")]!;
  expect([zones[ZONE_HEAD], zones[ZONE_TORSO], zones[ZONE_LEG_R], zones[ZONE_FOOT_L]]).toEqual([3, 1, 1, 1]);
  expect(reg.takes[k("grazer")]![DMG_BULLET]).toBeCloseTo(0.7, 5);
  expect(reg.takes[k("survivor")]![DMG_BULLET]).toBe(1);
});

test("a held button swings again and again, each swing landing once, a third of the way through", () => {
  const b = new Body();
  const out = hold(b, FISTS, BTN_PRIMARY, SWING_TICKS * 3);
  // A swing begins on the first tick and lands five ticks into it. The next begins on the tick the last one ends.
  expect(out.strikes).toEqual([6, 6 + SWING_TICKS, 6 + SWING_TICKS * 2]);
  expect(out.fires).toEqual([]);
  // Released mid swing, it finishes and no more follow.
  const b2 = new Body();
  hold(b2, FISTS, BTN_PRIMARY, 3);
  const rest = hold(b2, FISTS, 0, 40, BTN_PRIMARY);
  expect(rest.strikes).toEqual([3]);
  expect(b2.act).toBe(ACT_NONE);
  // The melee button swings any held item.
  const b3 = new Body();
  expect(hold(b3, params("hatchet"), BTN_MELEE, SWING_TICKS).strikes).toEqual([6]);
});

test("a bow is drawn while the button is held and looses when it is let go, harder the longer it was drawn", () => {
  const bow = params("bow");
  const b = new Body();
  b.rounds = 1;
  b.reloadTo = 1;
  // Released too soon, the string is let down and the arrow stays.
  hold(b, bow, BTN_PRIMARY, 5);
  expect(b.act).toBe(ACT_DRAW);
  let out = hold(b, bow, 0, 2, BTN_PRIMARY);
  expect([out.fires.length, b.rounds, b.act]).toEqual([0, 1, ACT_NONE]);
  hold(b, bow, BTN_PRIMARY, 19);
  out = hold(b, bow, 0, 1, BTN_PRIMARY);
  expect(out.fires).toEqual([1]);
  expect(out.draws[0]).toBeCloseTo(0.5, 5);
  expect([b.rounds, b.act]).toEqual([0, ACT_COOL]);
  // After the pause it nocks the next arrow unasked, if there is one.
  b.reloadTo = 1;
  out = hold(b, bow, 0, bow.swingTicks + bow.reloadTicks);
  expect(out.reloads).toEqual([bow.swingTicks + bow.reloadTicks]);
  expect([b.rounds, b.act]).toEqual([1, ACT_NONE]);
  // Held past full draw it waits, and looses at full strength.
  hold(b, bow, BTN_PRIMARY, 100);
  expect(b.act).toBe(ACT_HOLD);
  out = hold(b, bow, 0, 1, BTN_PRIMARY);
  expect(out.draws).toEqual([1]);
  // The melee button lets a drawn bow down without loosing, and strikes with it ("It is possible to cancel a shot by
  // performing a weapon melee attack", Bow). A weapon with no blow only lets the string down.
  b.act = ACT_NONE;
  b.rounds = 1;
  hold(b, bow, BTN_PRIMARY, 20);
  out = hold(b, bow, BTN_PRIMARY | BTN_MELEE, 1, BTN_PRIMARY);
  expect([out.fires.length, b.rounds, b.act]).toEqual([0, 1, ACT_SWING]);
  out = hold(b, bow, 0, SWING_TICKS, BTN_PRIMARY | BTN_MELEE);
  expect([out.strikes, out.fires.length, b.rounds, b.act]).toEqual([[5], 0, 1, ACT_NONE]);
  const plain: WeaponParams = { ...bow, meleeTicks: undefined, meleeStrikeTick: undefined };
  hold(b, plain, BTN_PRIMARY, 20);
  out = hold(b, plain, BTN_PRIMARY | BTN_MELEE, 1, BTN_PRIMARY);
  expect([out.fires.length, b.rounds, b.act]).toEqual([0, 1, ACT_NONE]);
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
  let out = hold(b, pistol, BTN_PRIMARY, 40);
  expect(out.fires).toEqual([1]);
  expect(b.rounds).toBe(5);
  // A press during the pause after a shot does nothing.
  b.act = ACT_NONE;
  stepAction(b, BTN_PRIMARY, BTN_PRIMARY, pistol);
  expect(actionOut.fire).toBe(true);
  stepAction(b, 0, 0, pistol);
  stepAction(b, BTN_PRIMARY, BTN_PRIMARY, pistol);
  expect([actionOut.fire, b.rounds, b.act]).toEqual([false, 4, ACT_COOL]);
  hold(b, pistol, 0, pistol.swingTicks);
  expect(b.act).toBe(ACT_NONE);
  // The reload key works when rounds are missing and there are rounds to put in.
  stepAction(b, BTN_RELOAD, BTN_RELOAD, pistol);
  expect(b.act).toBe(ACT_RELOAD);
  out = hold(b, pistol, 0, pistol.reloadTicks);
  expect(out.reloads).toEqual([pistol.reloadTicks]);
  expect(b.rounds).toBe(6);
  stepAction(b, BTN_RELOAD, BTN_RELOAD, pistol);
  expect(b.act).toBe(ACT_NONE);
  // After the last round it reloads unasked. With nothing to reload with it waits empty.
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

/** The core content with one weapon's facet changed, compiled; or its errors. */
function withWeapon(name: string, change: Partial<WeaponFacet>): { w: WeaponParams | null; errors: string[] } {
  const defs = CORE_CONTENT.map((d): Def => (d.id === `core:${name}` && d.type === "item" ? { ...(d as ItemDef), weapon: { ...(d as ItemDef).weapon!, ...change } } : d));
  const made = compileContent(defs);
  return { w: made.registry ? made.registry.weapon[made.registry.index.get(`core:${name}`)!]! : null, errors: made.errors };
}

test("an automatic gun fires every pause while its button is held and no more; a tap fires once", () => {
  const made = withWeapon("pistol", { auto: true });
  expect(made.errors).toEqual([]);
  const auto = made.w!;
  expect([auto.auto, auto.swingTicks, auto.reloadTicks]).toEqual([true, params("pistol").swingTicks, params("pistol").reloadTicks]);
  const pause = auto.swingTicks;
  const b = new Body();
  b.rounds = 6;
  b.reloadTo = 6;
  // Six rounds a pause apart; the empty gun reloads by itself after the last pause, and fires the tick the reload ends.
  let out = hold(b, auto, BTN_PRIMARY, 2 + pause * 6 + auto.reloadTicks);
  expect(out.fires).toEqual([1, 1 + pause, 1 + pause * 2, 1 + pause * 3, 1 + pause * 4, 1 + pause * 5, 2 + pause * 6 + auto.reloadTicks]);
  expect(out.reloads).toEqual([1 + pause * 6 + auto.reloadTicks]);
  expect(b.rounds).toBe(5);
  // Let go, it stops at once. A tap of one tick (D185 keeps a short one) fires one round.
  out = hold(b, auto, 0, 60, BTN_PRIMARY);
  expect(out.fires).toEqual([]);
  out = hold(b, auto, BTN_PRIMARY, 1);
  expect(out.fires).toEqual([1]);
  out = hold(b, auto, 0, 60, BTN_PRIMARY);
  expect([out.fires, b.rounds]).toEqual([[], 4]);
  // A gun that is not automatic fires once however long it is held.
  expect(hold(b, params("pistol"), BTN_PRIMARY, 60).fires).toEqual([1]);
});

test("a reload of a round at a time loads one a reload, up to the clip or what there is, and a press makes the round under way its last", () => {
  const made = withWeapon("pistol", { reloadEach: true, reload: 0.66 });
  expect(made.errors).toEqual([]);
  const shells = made.w!;
  const each = shells.reloadTicks;
  expect([shells.reloadEach, each]).toEqual([true, 20]);
  const b = new Body();
  b.rounds = 2;
  b.reloadTo = 6;
  stepAction(b, BTN_RELOAD, BTN_RELOAD, shells);
  expect(b.act).toBe(ACT_RELOAD);
  let out = hold(b, shells, 0, each * 4 + 10);
  expect([out.reloads, b.rounds, b.act]).toEqual([[each, each * 2, each * 3, each * 4], 6, ACT_NONE]);
  // Empty, it starts by itself and stops at what the body carries.
  b.rounds = 0;
  b.reloadTo = 3;
  out = hold(b, shells, 0, each * 3 + 10);
  expect([out.reloads, b.rounds, b.act]).toEqual([[each + 1, each * 2 + 1, each * 3 + 1], 3, ACT_NONE]);
  // A tap mid-round fires nothing, and the reload ends when that round is in.
  b.reloadTo = 6;
  stepAction(b, BTN_RELOAD, BTN_RELOAD, shells);
  hold(b, shells, 0, 5);
  out = hold(b, shells, BTN_PRIMARY, 1);
  expect([out.fires, b.act, b.rounds]).toEqual([[], ACT_RELOAD, 3]);
  out = hold(b, shells, 0, each * 3, BTN_PRIMARY);
  expect([out.reloads, out.fires, b.rounds, b.act]).toEqual([[each - 6], [], 4, ACT_NONE]);
  // Held, it fires on the tick the round goes in.
  stepAction(b, BTN_RELOAD, BTN_RELOAD, shells);
  hold(b, shells, 0, 5);
  out = hold(b, shells, BTN_PRIMARY, each);
  expect([out.reloads, out.fires, b.rounds, b.act]).toEqual([[each - 5], [each - 5], 4, ACT_COOL]);
  // The count a round's reload keeps within a byte bounds it: a round may take at most 4.1 s.
  expect(withWeapon("pistol", { reloadEach: true, reload: 4.3 }).errors).toEqual(["core:pistol: weapon.reload of a round at a time must be at most 4.1 seconds"]);
  // A whole-clip reload is not cut short.
  const pistol = params("pistol");
  b.rounds = 1;
  b.act = ACT_NONE;
  stepAction(b, BTN_RELOAD, BTN_RELOAD, pistol);
  hold(b, pistol, BTN_PRIMARY, 5);
  expect([b.act, b.rounds]).toEqual([ACT_RELOAD, 1]);
});

test("a gun strikes with its butt on the melee button, once a press; one without a blow does nothing with it", () => {
  const pistol = params("pistol");
  expect([pistol.meleeTicks, pistol.meleeStrikeTick]).toEqual([SWING_TICKS, 5]);
  const k = reg.index.get("core:pistol")!;
  // Base Damage: "Melee attack of any Ranged Weapon", 10 damage and 14 torpor.
  expect(reg.blowDamage[k]).toBe(10);
  expect(reg.blowTorpor[k]! * reg.blowDamage[k]!).toBeCloseTo(14, 5);
  const b = new Body();
  b.rounds = 6;
  b.reloadTo = 6;
  let out = hold(b, pistol, BTN_MELEE, SWING_TICKS * 3);
  expect([out.strikes, out.fires, b.rounds, b.act]).toEqual([[6], [], 6, ACT_NONE]);
  // Empty with nothing to load, it still strikes; during the pause after a shot it does not.
  b.rounds = 0;
  b.reloadTo = 0;
  expect(hold(b, pistol, BTN_MELEE, SWING_TICKS).strikes).toEqual([6]);
  b.rounds = 2;
  b.act = ACT_NONE;
  stepAction(b, BTN_PRIMARY, BTN_PRIMARY, pistol);
  out = hold(b, pistol, BTN_MELEE, 3, 0);
  expect([out.strikes, b.act]).toEqual([[], ACT_COOL]);
  // A rifle under water is put away, blow and all; a gun with no blow ignores the button.
  const w = new Body();
  w.mode = MODE_SWIM;
  expect(hold(w, params("rifle"), BTN_MELEE, SWING_TICKS).strikes).toEqual([]);
  const plain: WeaponParams = { ...pistol, meleeTicks: undefined, meleeStrikeTick: undefined };
  const p = new Body();
  expect([hold(p, plain, BTN_MELEE, SWING_TICKS).strikes, p.act]).toEqual([[], ACT_NONE]);
});

test("a thrown thing with a draw is held as a bow is drawn and leaves on release, faster the longer it was held", () => {
  const made = withWeapon("grenade", { draw: 1.6 });
  expect(made.errors).toEqual([]);
  const charged = made.w!;
  expect([charged.kind, charged.drawTicks, charged.minDrawTicks]).toEqual([W_THROWN, 48, 12]);
  const b = new Body();
  // A click is not enough (Bola: "A single LMB click is not enough", "roughly 0.4 seconds").
  hold(b, charged, BTN_PRIMARY, 5);
  expect(b.act).toBe(ACT_DRAW);
  let out = hold(b, charged, 0, 2, BTN_PRIMARY);
  expect([out.fires, b.act]).toEqual([[], ACT_NONE]);
  hold(b, charged, BTN_PRIMARY, 20);
  out = hold(b, charged, 0, 1, BTN_PRIMARY);
  expect(out.fires).toEqual([1]);
  const short = out.draws[0]!;
  expect(short).toBeCloseTo(19 / 48, 6);
  hold(b, charged, 0, charged.swingTicks);
  hold(b, charged, BTN_PRIMARY, 100);
  expect(b.act).toBe(ACT_HOLD);
  out = hold(b, charged, 0, 1, BTN_PRIMARY);
  expect(out.draws).toEqual([1]);
  // The draw goes to the throw as a bow's does to its arrow ("Charging up the Bola will increase its velocity", Bola).
  expect(launchSpeed(18, short)).toBeLessThan(launchSpeed(18, 1));
  // The melee button lets it down unthrown. Only a bow or a thrown weapon is drawn.
  hold(b, charged, 0, charged.swingTicks);
  hold(b, charged, BTN_PRIMARY, 20);
  out = hold(b, charged, BTN_PRIMARY | BTN_MELEE, 1, BTN_PRIMARY);
  expect([out.fires, b.act]).toEqual([[], ACT_NONE]);
  expect(withWeapon("pistol", { draw: 1 }).errors).toEqual(["core:pistol: weapon.draw is a bow's, or a thrown weapon's that is charged"]);
});

test("a thrown thing leaves the hand partway through the swing; taking something in hand takes a moment; water stops what is not made for it", () => {
  const b = new Body();
  const out = hold(b, params("grenade"), BTN_PRIMARY, SWING_TICKS);
  expect(out.fires).toEqual([params("grenade").strikeTick + 1]);
  expect(out.strikes).toEqual([]);
  // While equipping nothing happens. Once the item is in hand a held button swings.
  const e = new Body();
  e.act = ACT_EQUIP;
  const eq = hold(e, FISTS, BTN_PRIMARY, EQUIP_TICKS + 6);
  expect(eq.strikes).toEqual([EQUIP_TICKS + 5]);
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
  expect(w.pos).toBe(360);
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
  // A rifle round to a flak shirt. One piece counts five times, so a sixth gets through.
  resetHit();
  hit.base = 280;
  hit.type = DMG_BULLET;
  hit.armor = 100 * PIECE_SCALE;
  resolveDamage();
  expect(harm.health).toBeCloseTo(280 / 6, 6);
  expect(harm.blocked).toBeCloseTo(280 - 280 / 6, 6);
  expect(harm.wear).toBe(Math.ceil((280 - 280 / 6) / WEAR_PER_USE));
  // The same round from a better rifle, to the head of a creature that takes seven tenths of a bullet.
  resetHit();
  hit.base = 280;
  hit.quality = 1.2;
  hit.takes = 0.7;
  hit.zone = 3;
  resolveDamage();
  expect(harm.health).toBeCloseTo(280 * 1.2 * 0.7 * 3, 6);
  // A bow undrawn gives half (Bow, patch 190.0: "Raised minimum wooden bow damage for shortest-pulled arrows to 50%, up
  // from 25%"), its shortest pull five eighths, half drawn three quarters, and never more than all.
  resetHit();
  hit.base = 55;
  expect(DRAW_MIN).toBe(0.5);
  for (const [draw, share] of [[0, 0.5], [0.25, 0.625], [0.5, 0.75], [1, 1], [3, 1]] as const) {
    hit.draw = draw;
    resolveDamage();
    expect(harm.health).toBeCloseTo(55 * share, 6);
  }
  // Torpor follows the damage that got through, both the instant part and the part over time.
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
  // No damage in gives none out, and negative armor counts as none.
  resetHit();
  hit.armor = -50;
  resolveDamage();
  expect([harm.health, harm.blocked, harm.wear]).toEqual([0, 0, 0]);
});
