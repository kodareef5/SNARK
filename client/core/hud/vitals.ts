// The vitals: health, stamina, food, water, and oxygen and torpor while they matter.

import { STAMINA_UNITS } from "../../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER } from "../../../shared/sim/vitals.ts";
import { glass } from "../ui/skin.ts";
import { S_HUD_COUNT, S_KEY_SMALL } from "../ui/style.ts";
import { filledVital } from "../ui/vitals.ts";
import { HOTBAR_CELL } from "./layout.ts";
import type { HudWidget } from "./widget.ts";

/** Per vital: its optional label, then its filled icon. */
export const KEY_VITAL = 80;
/** From one vital to the next in their row by touch: an icon and the room a finger's press of it takes. */
export const VITAL_PITCH = 42;

export interface Vital {
  id: string;
  label: string;
  /** 0..1. */
  fraction: number;
}

export interface VitalsModel {
  /** Stamina comes from the predicted body, the others from vitals evaluated at the server's tick. */
  vitals: Vital[];
}

export const VITALS: HudWidget<VitalsModel> = {
  name: "vitals",
  make: () => ({
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
  },
  build(f, m, at) {
    const { options, controls, inspect, touch, W, right, foot } = at;
    const vitalY = foot - 38 - (W < 640 ? HOTBAR_CELL + 8 : 0);
    // At the top they stand against the sky, and need glass behind them to be read: as far as the last one shown.
    if (touch) {
      let last = -1;
      for (let i = 0; i < m.vitals.length; i++) { const v = m.vitals[i]!; if (!((v.id === "oxygen" && v.fraction >= 1) || (v.id === "torpor" && v.fraction <= 0))) last = i; }
      if (last >= 0) glass(f, KEY_VITAL - 1, touch.vitalsX - 6, touch.vitalsY - 5, last * VITAL_PITCH + 44, 42, 0.85);
    }
    for (let i = 0; i < m.vitals.length; i++) {
      const v = m.vitals[i]!;
      if ((v.id === "oxygen" && v.fraction >= 1) || (v.id === "torpor" && v.fraction <= 0)) continue;
      // By touch the thumbs have the lower corners, and the vitals stand in a row at the top, each over its number.
      const x = touch ? touch.vitalsX + i * VITAL_PITCH : right - 38;
      const y = touch ? touch.vitalsY : vitalY - i * 43;
      filledVital(f, KEY_VITAL + i * 2 + 1, i, x, y, 32, v.fraction, v.label, controls);
      if (!(options.vitalLabels || inspect)) continue;
      if (touch) f.text(KEY_VITAL + i * 2, x - 4, y + 33, 40, S_KEY_SMALL, `${Math.round(v.fraction * 100)}`);
      else f.text(KEY_VITAL + i * 2, x - 126, y + 8, 116, S_HUD_COUNT, `${v.label}  ${Math.round(v.fraction * 100)}%`);
    }
  },
};
