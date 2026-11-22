// Where a shot goes (planning/reference/weapons-plan.md, M1 and M2). The server and the client that predicts its body run
// this from the same state and buttons, so the shooter's own tracer is the server's ray to the last bit.
//
// A bow or gun has a cone a shot leaves within: a half angle in degrees from the hip or aimed, opened by speed (in full at a
// sprint, and in the air or swimming), by each shot (bloom, which narrows back by a rate a second), and closed by crouching
// and lying down. Its kick is pitch added to the look a shot leaves at, which each shot raises and which comes back by a
// rate a second. Bloom and kick are predicted state on the body (Body.bloom, Body.kick), stepped by stepAim once a tick
// right after stepAction; the rest of the cone is read from the body at the moment of the shot. Through a scope, a long gun
// also sways: a slow wander of the aim from the tick, damped by stance (Longneck Rifle, Scope Attachment).
//
// A ray's place in the cone is a pure function of a seed of the shooter's entity handle and the tick (aimSeed), so the
// server decides it and the client draws the same; nobody chooses a pattern but by choosing the tick, which the cone bounds.

import type { ItemDef } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { YAW_UNITS } from "../coords.ts";
import { PI, TAU, detCos, detSin, len3 } from "../math/scalar.ts";
import { lookDirection } from "../world/ray.ts";
import { BTN_SECONDARY, BTN_SPRINT, MODE_WALK, type Body, type MoveParams } from "./character.ts";
import type { Inventory } from "./items.ts";
import { actionOut, type WeaponParams } from "./weapon.ts";

/** Units of Body.bloom one shot adds. Bloom holds at most 255: four shots' worth. */
export const BLOOM_SHOT = 64;
/** Pitch units (16384 straight up) in one unit of Body.kick. 255 units are 22.4 degrees. */
export const KICK_UNIT = 16;
/** Pitch and yaw units in a degree: both are 65536 to a turn. */
export const UNITS_PER_DEGREE = YAW_UNITS / 360;
const PITCH_LIMIT = 16384;
/** The widest a cone is drawn, whatever adds up. */
export const MAX_CONE = 45;
/** What a stance multiplies the cone by: standing, crouched, prone. Our numbers (DEV128). */
export const STANCE_CONE: readonly number[] = [1, 0.8, 0.6];
/** Aimed, speed opens the cone by this share of what it does from the hip (DEV128). */
export const AIM_MOVE = 0.5;
/**
 * Sway through a scope (DEV130). What a stance multiplies it by: "less crouched, much less prone, never none" (Longneck
 * Rifle). Its two periods, in ticks (3.8 and 2.4 s), share no factor, so its figure comes round only every 4.5 minutes.
 */
export const STANCE_SWAY: readonly number[] = [1, 0.55, 0.2];
const SWAY_YAW_TICKS = 113;
const SWAY_PITCH_TICKS = 71;
/** The pitch wander is this share of the yaw's. */
const SWAY_PITCH_SHARE = 0.7;
const SWAY_SALT = 0x5a1e;
const DEG = PI / 180;
const INV_2_32 = 1 / 4294967296;

/** A 32-bit hash of two integers: a finalizer of each in turn (lowbias32). The same on every engine. */
export function hash32(a: number, b: number): number {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h ^ (b >>> 0), 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h ^ 0x27d4eb2d, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** The seed of a shot: the shooter's entity handle and the tick it leaves on. */
export function aimSeed(handle: number, tick: number): number {
  return hash32(handle, tick);
}

/** Bloom units one shot of `w` adds: none for a weapon whose shots do not open its cone. */
export function bloomShot(w: WeaponParams): number {
  return (w.coneBloom ?? 0) > 0 ? BLOOM_SHOT : 0;
}

/** Kick units one shot of `w` adds. */
export function kickShot(w: WeaponParams): number {
  const k = Math.round(((w.recoilKick ?? 0) * UNITS_PER_DEGREE) / KICK_UNIT);
  return k > 255 ? 255 : k;
}

/**
 * `v` less `perTick` on average, never below 0. The whole units taken on `tick` are those the running total of perTick
 * crosses, so n ticks take exactly floor(n * perTick) between them and both sides take the same.
 */
function fall(v: number, perTick: number, tick: number): number {
  if (!(perTick > 0)) return v;
  const n = Math.floor((tick + 1) * perTick) - Math.floor(tick * perTick);
  return v > n ? v - n : 0;
}

/**
 * Once a tick, right after stepAction (it reads actionOut.fire), with the weapon held. Bloom and kick come back first, then
 * the shot of this tick adds its own. A weapon with neither leaves none of either.
 */
export function stepAim(b: Body, w: WeaponParams, tick: number): void {
  const bs = bloomShot(w);
  const ks = kickShot(w);
  if (bs === 0) b.bloom = 0;
  else if (b.bloom > 0) b.bloom = fall(b.bloom, ((w.coneRecover ?? 0) / w.coneBloom!) * BLOOM_SHOT, tick);
  if (ks === 0) b.kick = 0;
  else if (b.kick > 0) b.kick = fall(b.kick, ((w.recoilRecover ?? 0) * UNITS_PER_DEGREE) / KICK_UNIT, tick);
  if (!actionOut.fire) return;
  b.bloom = b.bloom + bs > 255 ? 255 : b.bloom + bs;
  b.kick = b.kick + ks > 255 ? 255 : b.kick + ks;
}

/**
 * How far speed opens the cone, 0 to 1: the share of the body's own sprint speed it moves at across the ground, and all of it
 * in the air or in water, where it has no footing.
 */
export function moveShare(b: Body, p: MoveParams): number {
  if (b.mode !== MODE_WALK || !b.grounded) return 1;
  const top = p.walkSpeed * (b.speedQ / 1000) * p.sprintMul;
  if (!(top > 0)) return 1;
  const v = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
  return v >= top ? 1 : v / top;
}

/**
 * The cone's half angle in degrees for a shot of `w` from `b` with `buttons` held. `fired`: the shot left on the tick
 * `b` was last stepped, so its own bloom is not counted against it. 0 for a weapon with no cone.
 */
export function shotCone(b: Body, buttons: number, w: WeaponParams, p: MoveParams, fired: boolean): number {
  if (w.coneHip === undefined) return 0;
  const aimed = (buttons & BTN_SECONDARY) !== 0;
  let bloom = b.bloom;
  if (fired) bloom = bloom > bloomShot(w) ? bloom - bloomShot(w) : 0;
  const opened = ((w.coneBloom ?? 0) * bloom) / BLOOM_SHOT;
  const moving = (w.coneMove ?? 0) * moveShare(b, p) * (aimed ? AIM_MOVE : 1);
  const c = ((aimed ? w.coneAim! : w.coneHip) + moving + opened) * (STANCE_CONE[b.stance] ?? 1);
  return c > MAX_CONE ? MAX_CONE : c;
}

/** Pitch units the kick adds to a shot from `b`; `fired` as for shotCone. */
export function shotKick(b: Body, w: WeaponParams, fired: boolean): number {
  const ks = kickShot(w);
  const k = fired ? (b.kick > ks ? b.kick - ks : 0) : b.kick;
  return k * KICK_UNIT;
}

/** The share of its sway a sight keeps while its shooter holds its breath (D1083). */
export const BREATH_STEADY = 0.2;
/** Squared metres a second a body may move and still hold its breath. */
const BREATH_STILL = 0.04;

/** Whether `b`, aimed (the secondary held), holds its breath: the sprint key held, standing still (D1083). */
export function holdsBreath(b: Body, buttons: number): boolean {
  return (buttons & (BTN_SPRINT | BTN_SECONDARY)) === (BTN_SPRINT | BTN_SECONDARY) && b.vx * b.vx + b.vz * b.vz < BREATH_STILL;
}

/**
 * Pitch units a shot leaves above its look so that a round of `speed` metres a second falling at `gravity` crosses the look
 * again `zero` metres off (D1083): half of gravity times the distance over the speed squared, as an angle. 0 for no zero.
 */
export function zeroUnits(zero: number, speed: number, gravity: number): number {
  if (!(zero > 0 && speed > 0 && gravity > 0)) return 0;
  return ((gravity * zero) / (2 * speed * speed)) * (YAW_UNITS / TAU);
}

/** The sway's offset in yaw and pitch units, from the last call of `sway`. */
export const swayOut = { yaw: 0, pitch: 0 };

/**
 * A scoped, aimed long gun's wander at tick `t` (fractional for the camera), into swayOut: none for a weapon that does not
 * sway. Its phase is the shooter's own, from its handle, so two snipers do not sway together.
 */
export function sway(w: WeaponParams, stance: number, handle: number, t: number, steady = false): void {
  const a = (w.coneSway ?? 0) * (STANCE_SWAY[stance] ?? 1) * UNITS_PER_DEGREE * (steady ? BREATH_STEADY : 1);
  if (!(a > 0)) {
    swayOut.yaw = swayOut.pitch = 0;
    return;
  }
  const p = t + (hash32(handle, SWAY_SALT) & 1023);
  swayOut.yaw = a * detSin((p * TAU) / SWAY_YAW_TICKS);
  swayOut.pitch = a * SWAY_PITCH_SHARE * detSin((p * TAU) / SWAY_PITCH_TICKS + 1);
}

/**
 * Whether the weapon in `slot` of `inv` looks through a scope or a holo-scope: one is fitted. A sight needs no switching on
 * (only a flashlight and a laser are switched, FLAG_ON), so this is all W7 adds to W1's sway. The holo-scope "will always
 * have weapon sway" (Holo-Scope Attachment); here it sways as much as its weapon does (`spread.sway`). The server reads its
 * own books and the client its copy of them, which the server sends.
 */
export function scopeFitted(reg: Registry, inv: Inventory | null, slot: number): boolean {
  if (!inv || slot < 0) return false;
  // A weapon with a scope of its own (the fabricated sniper rifle, D1083).
  if ((reg.defs[inv.item[slot]!] as ItemDef | null)?.optic) return true;
  const fitted = inv.attach[slot]!;
  const kind = fitted !== 0 ? (reg.defs[fitted] as ItemDef | null)?.attachment : undefined;
  return kind === "scope" || kind === "holo";
}

/** Where a shot is pointed and how wide its cone is, from the last call of `aimShot`. Yaw and pitch in wire units. */
export const shotAim = { yaw: 0, pitch: 0, cone: 0 };

/**
 * The aim of a shot of `w` that left on `tick` from `b` (stepped on that tick), looking along `yaw` and `pitch` (wire
 * units), with `buttons` held: the look plus the kick, plus the sway when `scoped` and aimed, and the cone. Into shotAim.
 */
export function aimShot(b: Body, buttons: number, w: WeaponParams, p: MoveParams, yaw: number, pitch: number, scoped: boolean, handle: number, tick: number, zero = 0): void {
  const out = shotAim;
  out.cone = shotCone(b, buttons, w, p, true);
  let y = yaw;
  // A zero lifts the shot, not the look: the reticle stays on the look (D1083).
  let e = pitch + shotKick(b, w, true) + zero;
  if (scoped && (buttons & BTN_SECONDARY) !== 0) {
    sway(w, b.stance, handle, tick, holdsBreath(b, buttons));
    y += swayOut.yaw;
    e += swayOut.pitch;
  }
  out.yaw = y;
  out.pitch = e < -PITCH_LIMIT ? -PITCH_LIMIT : e > PITCH_LIMIT ? PITCH_LIMIT : e;
}

/**
 * Ray `k` of a shot of `seed`, about the look `yaw` and `pitch` (wire units, fractions allowed) within a cone of half angle
 * `cone` degrees, as a unit vector into `out`. Two numbers from the seed lay it evenly on the disc the cone cuts one metre
 * out; a cone of 0 is the look itself.
 */
export function shotDir(seed: number, k: number, yaw: number, pitch: number, cone: number, out: Float64Array | number[]): void {
  lookDirection(yaw, pitch, out);
  if (!(cone > 0)) return;
  const c = (cone > MAX_CONE ? MAX_CONE : cone) * DEG;
  const reach = detSin(c) / detCos(c);
  const r = reach * Math.sqrt(hash32(seed, k * 2) * INV_2_32);
  const turn = hash32(seed, k * 2 + 1) * INV_2_32 * TAU;
  const u = r * detCos(turn);
  const v = r * detSin(turn);
  const a = (yaw * TAU) / YAW_UNITS;
  const el = (pitch * TAU) / YAW_UNITS;
  const sa = detSin(a);
  const ca = detCos(a);
  const se = detSin(el);
  const ce = detCos(el);
  // Right is (-cos yaw, 0, sin yaw); up is the look turned a quarter up.
  const x = out[0]! - u * ca - v * sa * se;
  const y = out[1]! + v * ce;
  const z = out[2]! + u * sa - v * ca * se;
  const n = len3(x, y, z);
  out[0] = x / n;
  out[1] = y / n;
  out[2] = z / n;
}
