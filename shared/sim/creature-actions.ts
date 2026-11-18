// Ground creature input and action timing. Both prediction and authority use the capsule movement step below;
// only server/combat resolves contacts. The existing action/hold pose word also tells remote observers which clip to play.
import type { CreatureCombatFacet } from "../content/defs.ts";
import { TICK_RATE } from "../coords.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { copyMoveSize, type SizedMove } from "./move-size.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY, BTN_SPRINT, MF_NO_SPRINT, MF_OUT, MF_ROOTED, MF_WINDED, MODE_WALK, STAMINA_UNITS, stepBody, type Body, type MoveParams } from "./character.ts";
import { ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING } from "./weapon.ts";

/** Modes occupy the upper two hold bits, attack side the low one; 7 remains reserved for carrying. */
export function creatureHold(b: Body): number { return (b.creatureMode << 1) | (b.creatureSide & 1); }
export function creatureMode(hold: number): number { return (hold >> 1) % 3; }

const movement = new WeakMap<MoveParams, WeakMap<CreatureCombatFacet, readonly [MoveParams, MoveParams, MoveParams]>>();
function moves(p: MoveParams, c: CreatureCombatFacet): readonly [MoveParams, MoveParams, MoveParams] {
  let byCombat = movement.get(p);
  if (!byCombat) { byCombat = new WeakMap(); movement.set(p, byCombat); }
  let found = byCombat.get(c);
  if (!found) {
    const action = { ...p, staminaRegen: 0, staminaSprint: 0, staminaWalk: 0, sprintMul: 1, jumpSpeed: 0 };
    found = [action, { ...action, walkSpeed: 0, accelGround: 30 }, { ...action, walkSpeed: c.charge?.speed ?? p.walkSpeed, turnRate: Math.round((c.charge?.turn ?? 45) / 360 * 65536 / TICK_RATE), accelGround: 14 }];
    byCombat.set(c, found);
  }
  // A growing body's owned movement copy keeps its identity. Its action variants must grow with it too.
  if (found[0].height !== p.height || found[0].radius !== p.radius || found[0].swimDepth !== p.swimDepth) {
    for (let i = 0; i < found.length; i++) copyMoveSize(found[i]! as SizedMove, p);
  }
  return found;
}
function begin(b: Body, act: number): void { b.act = act; b.actTicks = 0; }
function spend(b: Body, amount: number, paid: boolean): boolean {
  const units = Math.round(amount * STAMINA_UNITS);
  if (!paid) return true;
  if (b.stamina < units) return false;
  b.stamina -= units;
  return true;
}
export function cancelCreatureAction(b: Body, c: CreatureCombatFacet): void {
  if (b.act === ACT_DRAW || b.act === ACT_HOLD) b.creatureCooldown = Math.max(b.creatureCooldown, c.charge?.cooldown ?? c.secondary?.cooldown ?? 0);
  b.act = ACT_NONE; b.actTicks = 0; b.creaturePower = 0;
}

/** A fixed tick. `paid` is true for a ridden creature; `quiet` cancels input-driven abilities on disconnect or input loss. */
export function stepCreature(w: CollisionWorld, b: Body, mx: number, mz: number, yaw: number, pitch: number, buttons: number, pressed: number, p: MoveParams, c: CreatureCombatFacet, dt: number, paid = true, quiet = false): void {
  if (b.creatureCooldown > 0) b.creatureCooldown--;
  if (b.creaturePrimaryCooldown > 0) b.creaturePrimaryCooldown--;
  if (b.creatureMode >= (c.modes?.length ?? 1)) b.creatureMode = 0;
  const blocked = quiet || b.mode !== MODE_WALK || !b.grounded || (b.mflags & (MF_OUT | MF_ROOTED)) !== 0;
  if (blocked) {
    cancelCreatureAction(b, c);
    stepBody(w, b, quiet ? 0 : mx, quiet ? 0 : mz, yaw, pitch, quiet ? 0 : buttons & ~(BTN_CROUCH | BTN_PRONE), p, dt);
    return;
  }
  const charge = c.charge;
  let ended = false;
  if (b.act !== ACT_NONE) {
    b.actTicks++;
    if (b.act === ACT_SWING || b.act === ACT_RELOAD) {
      const attack = b.act === ACT_SWING ? c.primary : c.secondary;
      if (!attack || b.actTicks >= attack.ticks) { begin(b, ACT_NONE); ended = true; }
    } else if (b.act === ACT_EQUIP) {
      const ticks = c.switchTicks ?? 30;
      if (b.actTicks === Math.floor(ticks / 2)) b.creatureMode = (b.creatureMode + 1) % (c.modes?.length ?? 1);
      if (b.actTicks >= ticks) { begin(b, ACT_NONE); ended = true; }
    } else if (b.act === ACT_DRAW) {
      if (!charge || (pressed & BTN_MELEE) !== 0) { cancelCreatureAction(b, c); ended = true; }
      else if ((buttons & BTN_SECONDARY) === 0 || b.actTicks >= charge.windup) {
        if (b.actTicks < charge.minWindup) { cancelCreatureAction(b, c); ended = true; }
        else { b.creaturePower = Math.round(255 * b.actTicks / charge.windup); begin(b, ACT_HOLD); }
      }
    } else if (b.act === ACT_HOLD && charge) {
      if (b.actTicks >= charge.duration || (pressed & (BTN_PRIMARY | BTN_MELEE)) !== 0 || (b.mflags & (MF_NO_SPRINT | MF_WINDED)) !== 0 || !spend(b, charge.staminaPerSecond / TICK_RATE, paid)) {
        begin(b, ACT_COOL); b.creatureCooldown = charge.cooldown;
      }
    } else if (b.act === ACT_HOLD && c.secondary?.impale) {
      if (b.actTicks >= Math.ceil(c.secondary.impale.seconds * TICK_RATE) || (pressed & BTN_SECONDARY) !== 0 || !spend(b, c.secondary.impale.staminaPerSecond / TICK_RATE, paid)) {
        begin(b, ACT_COOL); b.creatureCooldown = c.secondary.cooldown ?? 0;
      }
    } else if (b.act === ACT_COOL) {
      if (b.actTicks >= (charge?.recovery ?? 18)) { begin(b, ACT_NONE); b.creaturePower = 0; ended = true; }
    } else { begin(b, ACT_NONE); ended = true; }
  }
  if (b.act === ACT_NONE && !ended) {
    if ((pressed & BTN_RELOAD) !== 0 && c.modes && c.modes.length > 1) begin(b, ACT_EQUIP);
    else if ((pressed & BTN_SECONDARY) !== 0 && b.creatureCooldown === 0) {
      if (charge && (b.mflags & (MF_NO_SPRINT | MF_WINDED)) === 0 && spend(b, charge.stamina, paid)) begin(b, ACT_DRAW);
      else if (c.secondary && spend(b, c.secondary.stamina, paid)) { begin(b, ACT_RELOAD); b.creatureCooldown = c.secondary.cooldown ?? 0; }
    } else if ((buttons & BTN_PRIMARY) !== 0 && b.creaturePrimaryCooldown === 0 && spend(b, c.primary.stamina, paid)) {
      const aim = ((yaw - b.yaw + 32768) & 65535) - 32768;
      b.creatureSide = c.primary.alternateClip ? (Math.abs(aim) > 256 ? (aim < 0 ? 1 : 0) : 1 - b.creatureSide) : 0;
      begin(b, ACT_SWING);
      b.creaturePrimaryCooldown = c.primary.cooldown ?? 0;
    }
  }
  const active = b.act !== ACT_NONE;
  const [action, stopped, rushing] = moves(p, c);
  const charging = b.act === ACT_HOLD && charge !== undefined;
  const rooted = b.act === ACT_DRAW || b.act === ACT_EQUIP || b.act === ACT_COOL || (b.act === ACT_HOLD && !charge);
  const beforeX = b.x, beforeZ = b.z, beforeSpeed = b.speedQ;
  if (charging) b.speedQ = Math.round(beforeSpeed * (.6 + .4 * b.creaturePower / 255));
  stepBody(w, b, charging || rooted ? 0 : mx, charging ? 127 : rooted ? 0 : mz, yaw, pitch,
    buttons & ~(BTN_CROUCH | BTN_PRONE | (active ? BTN_JUMP | BTN_SPRINT : 0)), charging ? rushing : rooted ? stopped : active ? action : p, dt);
  b.speedQ = beforeSpeed;
  // A stopped hull ends its charge: holding the button against a wall cannot keep hitting through it.
  if (charging && (b.mode !== MODE_WALK || !b.grounded || (b.actTicks > 3 && Math.sqrt((b.x - beforeX) * (b.x - beforeX) + (b.z - beforeZ) * (b.z - beforeZ)) < charge.speed * dt * .1))) {
    begin(b, ACT_COOL); b.creatureCooldown = charge.cooldown;
  }
}
