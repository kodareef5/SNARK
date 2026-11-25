// The vitals: health, stamina, food, water, and oxygen and torpor while they matter.

import { STAMINA_UNITS } from "../../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER } from "../../../shared/sim/vitals.ts";
import { K_BUTTON, K_PANEL } from "../ui/nodes.ts";
import { S_HUD_HIT, S_HUD_COUNT, S_HUD_KEY, S_ICE, S_KEY_SMALL, S_WARNING } from "../ui/style.ts";
import { filledVital } from "../ui/vitals.ts";

import type { HudWidget } from "./widget.ts";

/** Per vital: its optional label, then its filled icon. */
export const KEY_VITAL = 80;
/** From one vital to the next in their row by touch: an icon and the room a finger's press of it takes. */
export const VITAL_PITCH = 32;
const KEY_VITAL_ART = 9140;

export interface Vital {
  id: string;
  label: string;
  /** 0..1. */
  fraction: number;
  previous?: number;
  recoveringUntil?: number;
}

export interface VitalsModel {
  /** Stamina comes from the predicted body, the others from vitals evaluated at the server's tick. */
  vitals: Vital[];
  vitalTick: number;
}

export const VITALS: HudWidget<VitalsModel> = {
  name: "vitals",
  make: () => ({
    vitalTick: 0,
    vitals: [
      { id: "health", label: "Health", fraction: 1 },
      { id: "stamina", label: "Stamina", fraction: 1 },
      { id: "food", label: "Food", fraction: 1 },
      { id: "water", label: "Water", fraction: 1 },
      { id: "oxygen", label: "Oxygen", fraction: 1 },
      { id: "torpor", label: "Torpor", fraction: 0 },
    ],
  }),
  fill(model, c) {
    const session = c.session, b = session.own;
    model.vitals[1]!.fraction = b.staminaMax > 0 ? b.stamina / (b.staminaMax * STAMINA_UNITS) : 0;
    if (session.hasVitals) {
      const v = session.vitals;
      const tick = session.serverTick;
      const fraction = (i: number): number => (v.max[i]! > 0 ? v.at(i, tick) / v.max[i]! : 1);
      model.vitals[0]!.fraction = fraction(V_HEALTH);
      model.vitals[2]!.fraction = fraction(V_FOOD);
      model.vitals[3]!.fraction = fraction(V_WATER);
      model.vitals[4]!.fraction = fraction(V_OXYGEN);
      model.vitals[5]!.fraction = v.max[V_TORPOR]! > 0 ? v.at(V_TORPOR, tick) / v.max[V_TORPOR]! : 0;
    }
    for (const vital of model.vitals) {
      const previous = vital.previous;
      if (previous !== undefined && vital.fraction !== previous) {
        const better = vital.id === "torpor" ? vital.fraction < previous : vital.fraction > previous;
        vital.recoveringUntil = better && vital.fraction > 0 && vital.fraction < .9999 ? session.serverTick + 45 : 0;
      }
      vital.previous = vital.fraction;
    }
    model.vitalTick = session.serverTick;
  },
  build(f, m, at) {
    const { options, controls, inspect, touch, left, mapX } = at;
    const show = options.vitalLabels || inspect;
    const x0 = touch?.vitalsX ?? left, y = touch?.vitalsY ?? f.top + 12;
    const room = (options.minimap ? mapX : at.right) - x0 - 7;
    const compact = !!touch || room < 270;
    const small = Math.min(touch ? VITAL_PITCH : 30, Math.max(21, Math.floor(room / 6)));
    const primary = compact ? small : Math.min(106, Math.floor((room - 4 * small) / 2));
    let x = x0;
    for (let i = 0; i < m.vitals.length; i++) {
      const v = m.vitals[i]!;
      if ((v.id === "oxygen" && v.fraction >= 1) || (v.id === "torpor" && v.fraction <= 0)) continue;
      const slot = i < 2 ? primary : small;
      const size = Math.min(22, slot - 5);
      const fraction = Math.max(0, Math.min(1, v.fraction));
      const percent = Math.round(fraction * 100);
      const key = KEY_VITAL_ART + i * 8;
      const hitKey = KEY_VITAL + i * 2 + 1;
      const depleted = v.id === "torpor" ? fraction >= 1 : fraction <= 0;
      const low = v.id === "torpor" ? fraction >= .8 : fraction < .2;
      const recovering = (v.recoveringUntil ?? 0) > m.vitalTick;
      const ink = depleted ? 0xff91a2 : recovering ? 0x91edcc : low ? 0xffd28c : i === 0 ? 0xe2f3ff : 0x91d4ee;
      const wide = i < 2 && !compact;
      const pos = wide ? x + 1 : x + (slot - size) / 2;
      const label = `${v.label} ${percent}%`;
      const flag = depleted ? "×" : recovering ? "↗" : low ? "!" : "";
      if (f.picture(key, pos, y, size, size, S_HUD_KEY, "ui:glass-" + v.id)) {
        const hit = f.add(hitKey, K_BUTTON, x, y - 4, slot, size + 11, S_HUD_HIT);
        hit.label = label; hit.value = fraction; hit.interactive = controls;
      } else filledVital(f, hitKey, i, pos, y, size, fraction, v.label, controls, false);
      const barX = wide ? pos + size + 5 : x + 4;
      const barW = wide ? slot - size - 13 : slot - 8;
      const barY = y + size + (wide ? -2 : 3);
      f.add(key + 1, K_PANEL, barX, barY, barW, 2, S_ICE).alpha = .25;
      if (fraction > 0) f.add(key + 2, K_PANEL, barX, barY, barW * fraction, 2, S_ICE).tint = ink;
      if (wide) f.text(key + 3, barX, y + 1, barW, S_HUD_COUNT, String(percent));
      if (flag) f.text(key + 4, pos + size - 2, y - 5, 12, S_WARNING, flag);
      if (show) f.text(KEY_VITAL + i * 2, x, barY + 3, slot, S_KEY_SMALL, compact ? String(percent) : v.label);
      x += slot;
    }
  },
};
