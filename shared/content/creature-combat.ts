// Validation of the ground creature contracts, before any controller or contact evaluator sees them.
import type { CreatureAttackDef, CreatureHarvestFacet, Def, SpeciesDef } from "./defs.ts";
import { DAMAGE_TYPES } from "../sim/damage.ts";

export function creatureCombatFaults(d: SpeciesDef, defs: readonly Def[]): string[] {
  const errors: string[] = [];
  const finite = (name: string, v: number | undefined, min: number, max: number, whole = false): void => {
    if (!Number.isFinite(v) || v! < min || v! > max || (whole && !Number.isInteger(v))) errors.push(`${d.id}: ${name} must be ${whole ? "an integer " : ""}from ${min} to ${max}`);
  };
  const item = (id: string): void => { if (!defs.some(x => x.id === id && x.type === "item")) errors.push(`${d.id}: combat item ${id} is missing`); };
  const harvest = (h: CreatureHarvestFacet | undefined): void => {
    if (!h) return;
    finite("harvest.power", h.power, 0, 1000);
    finite("harvest.damage", h.damage, 0.001, 1000);
    if (!Array.isArray(h.materials) || !h.materials.length || h.materials.some(x => typeof x !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(x))) errors.push(`${d.id}: harvest materials must be nonempty material names`);
    for (const y of h.yields ?? []) { item(y.item); finite("harvest yield multiplier", y.mult, 0, 1000); }
  };
  const slow = (s: { multiplier: number; seconds: number } | undefined): void => {
    if (!s) return;
    finite("slow.multiplier", s.multiplier, 0.05, 1); finite("slow.seconds", s.seconds, 0.1, 60);
  };
  const attack = (a: CreatureAttackDef | undefined): void => {
    if (!a) { errors.push(`${d.id}: an attack is missing`); return; }
    if (!a.name || !a.clip || !a.socket) errors.push(`${d.id}: an attack needs its name, clip and socket`);
    if (a.bones && (!Array.isArray(a.bones) || a.bones.length === 0 || a.bones.length > 64 || a.bones.some(x => typeof x !== "string" || !x) || new Set(a.bones).size !== a.bones.length)) errors.push(`${d.id}: attack bones must be distinct named joints`);
    if (a.alternateClip !== undefined && !a.alternateClip) errors.push(`${d.id}: alternate attack clip must be named`);
    finite("attack.radius", a.radius, 0.01, 8); finite("attack.reach", a.reach, a.radius, 32);
    finite("attack.damage", a.damage, 0, 1e6); finite("attack.stamina", a.stamina, 0, 1e6);
    finite("attack.ticks", a.ticks, 2, 250, true); finite("attack.lands", a.lands, 1, a.ticks - 1, true);
    finite("attack.through", a.through, a.lands, a.ticks - 1, true);
    if (!DAMAGE_TYPES.includes(a.type)) errors.push(`${d.id}: attack damage type is unknown`);
    if (a.cooldown !== undefined) finite("attack.cooldown", a.cooldown, 0, 1023, true);
    if (a.knockback !== undefined) finite("attack.knockback", a.knockback, 0, 20);
    if (a.pierce !== undefined) finite("attack.pierce", a.pierce, 0, 1);
    slow(a.slow); harvest(a.harvest);
    if (a.impale) {
      if (!a.impale.socket) errors.push(`${d.id}: impale needs an attachment socket`);
      finite("impale.maxDrag", a.impale.maxDrag, 1, 1e5);
      finite("impale.maxHealthFraction", a.impale.maxHealthFraction, 0.01, 1);
      finite("impale.seconds", a.impale.seconds, 0.1, 8);
      finite("impale.staminaPerSecond", a.impale.staminaPerSecond, 0.01, 1e5);
      finite("impale.damagePerSecond", a.impale.damagePerSecond, 0, 1e5);
    }
  };
  const c = d.combat;
  if (c) {
    if (d.class !== "creature" || d.fly || d.vehicle) errors.push(`${d.id}: combat is for a ground creature`);
    if (!c.primary) errors.push(`${d.id}: combat needs a primary attack`); else attack(c.primary);
    if (c.secondary) attack(c.secondary);
    if (c.secondary && c.charge) errors.push(`${d.id}: secondary is either an attack or a charge`);
    if (c.charge) {
      const q = c.charge;
      finite("charge.windup", q.windup, 2, 250, true); finite("charge.minWindup", q.minWindup, 1, q.windup, true);
      finite("charge.duration", q.duration, 1, 250, true); finite("charge.recovery", q.recovery, 1, 250, true);
      finite("charge.cooldown", q.cooldown, 1, 1023, true); finite("charge.speed", q.speed, 1, 30);
      finite("charge.turn", q.turn, 1, 180); finite("charge.stamina", q.stamina, 0, 1e5);
      finite("charge.staminaPerSecond", q.staminaPerSecond, 0, 1e5); attack(q.attack);
    }
    if (c.ai?.primary) {
      finite("ai.primary.bearing", c.ai.primary.bearing, 0, 180);
      finite("ai.primary.distance", c.ai.primary.distance, .1, c.primary?.reach ?? 32);
      finite("ai.primary.arc", c.ai.primary.arc, 1, 90);
    }
    if (c.ai?.charge) {
      if (!c.charge) errors.push(`${d.id}: charge AI needs a charge ability`);
      finite("ai.charge.minDistance", c.ai.charge.minDistance, 1, 64);
      finite("ai.charge.maxDistance", c.ai.charge.maxDistance, c.ai.charge.minDistance + .1, 64);
    }
    if (c.modes) {
      if (c.modes.length < 2 || c.modes.length > 3) errors.push(`${d.id}: combat needs two or three modes`);
      finite("combat.switchTicks", c.switchTicks, 2, 250, true);
      for (const m of c.modes) {
        if (!m.name || !m.clip) errors.push(`${d.id}: a mode needs its name and plate clip`);
        finite("mode.damageTaken", m.damageTaken, 0.05, 2);
        if (m.pierce !== undefined) finite("mode.pierce", m.pierce, 0, 1);
        harvest(m.harvest); slow(m.slow);
      }
    }
    for (const w of c.weight ?? []) { item(w.item); finite("weight multiplier", w.mult, 0, 1); }
    if (c.rivalry) {
      finite("rivalry.distance", c.rivalry.distance, 1, 100); finite("rivalry.minThreatDrag", c.rivalry.minThreatDrag, 1, 1e5);
      finite("rivalry.damage", c.rivalry.damage, 1, 2); finite("rivalry.resistance", c.rivalry.resistance, 0.1, 1); finite("rivalry.health", c.rivalry.health, 1, 2);
      if (c.rivalry.signalRegion !== undefined) finite("rivalry.signalRegion", c.rivalry.signalRegion, 0, 5, true);
    }
  }
  if (d.camera) {
    finite("camera.height", d.camera.height, 0.1, 16); finite("camera.distance", d.camera.distance, 1, 32);
    if (d.camera.forward !== undefined) finite("camera.forward", d.camera.forward, -16, 16);
    if (d.camera.avoidBody !== undefined && typeof d.camera.avoidBody !== "boolean") errors.push(`${d.id}: camera.avoidBody must be a boolean`);
  }
  return errors;
}
