// The bar under the crosshair that fills as a bow is drawn or a reload runs, and what the hotbar's line says is loaded.

import { TICK_RATE } from "../../../shared/coords.ts";
import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_RELOAD } from "../../../shared/sim/weapon.ts";
import type { ClientSession } from "../session.ts";
import { K_BAR } from "../ui/nodes.ts";
import { S_OXYGEN, S_STAMINA } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_ACTION = 34;

/** Values of ActionModel.actionKind. */
export const ACTION_NONE = 0;
export const ACTION_DRAW = 1;
export const ACTION_RELOAD = 2;

export interface ActionModel {
  /** An ACTION_ kind, and how far along it is, 0 to 1. */
  actionKind: number;
  actionFraction: number;
}

export function fillAction(m: ActionModel & { ammo: string }, session: ClientSession | null, reg: Registry): void {
  m.actionKind = ACTION_NONE;
  m.actionFraction = 0;
  m.ammo = "";
  if (!session || !session.weaponsAllowed) return;
  const b = session.own;
  const creature = session.driving >= 0 ? reg.combat[b.kind] : null;
  if (creature) {
    const charge = creature.charge, impale = creature.secondary?.impale;
    if (b.act === ACT_DRAW && charge) {
      m.actionKind = ACTION_DRAW; m.actionFraction = Math.min(1, b.actTicks / charge.windup);
      m.ammo = "Charging · release RMB to run";
    } else if (b.act === ACT_HOLD && charge) {
      m.actionKind = ACTION_DRAW; m.actionFraction = Math.max(0, 1 - b.actTicks / charge.duration);
      m.ammo = "Charging · LMB to stop";
    } else if (b.act === ACT_HOLD && impale) {
      m.actionKind = ACTION_DRAW; m.actionFraction = Math.max(0, 1 - b.actTicks / (impale.seconds * TICK_RATE));
      m.ammo = "Impaling · RMB to release";
    } else if (b.act === ACT_EQUIP) {
      m.actionKind = ACTION_RELOAD; m.actionFraction = b.actTicks / (creature.switchTicks ?? 1);
      m.ammo = "Changing plates";
    } else if (b.act === ACT_COOL || b.creatureCooldown > 0) m.ammo = b.creatureCooldown > 0 ? `Recovering · ${Math.ceil(b.creatureCooldown / TICK_RATE)} s` : "Recovering";
    else if (creature.modes) m.ammo = `${creature.modes[b.creatureMode]?.name ?? creature.modes[0]!.name} · R change plates`;
    return;
  }
  const w = reg.weapon[b.held];
  if (!w || w.clip === 0) return;
  if (b.act === ACT_DRAW || b.act === ACT_HOLD) {
    m.actionKind = ACTION_DRAW;
    m.actionFraction = b.act === ACT_HOLD || w.drawTicks === 0 ? 1 : b.actTicks / w.drawTicks;
  } else if (b.act === ACT_RELOAD) {
    m.actionKind = ACTION_RELOAD;
    m.actionFraction = w.reloadTicks === 0 ? 1 : b.actTicks / w.reloadTicks;
  }
  const inv = session.inventory;
  const slot = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
  const kind = slot >= 0 ? inv!.ammo[slot]! : 0;
  const def = kind !== 0 ? (reg.defs[kind] as ItemDef | null) : null;
  m.ammo = def ? `${def.label ?? def.id.slice(def.id.indexOf(":") + 1)}  ${b.rounds} / ${inv!.total(kind)}` : "not loaded";
}

export const ACTION: HudWidget<ActionModel> = {
  name: "action",
  make: () => ({ actionKind: ACTION_NONE, actionFraction: 0 }),
  fill(m, c) {
    const a = c.frame;
    if (!a) return;
    fillAction(m, a.alive ? c.session : null, a.reg);
    if (a.alive && a.inCar) m.ammo = "";
    // With a piece in hand the line says the builder's keys.
    if (a.building) m.ammo = "E turn   Q next place   R form";
  },
  build(f, m, at) {
    const { W, H } = at;
    if (m.crosshair && m.actionKind !== ACTION_NONE) f.add(KEY_ACTION, K_BAR, W / 2 - 40, H / 2 + 38, 80, 5, m.actionKind === ACTION_DRAW ? S_STAMINA : S_OXYGEN).value = m.actionFraction;
  },
};
