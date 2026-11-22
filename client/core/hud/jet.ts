// The jet fuel, under the minimap while jets are worn and no vehicle's instruments stand there.

import { TICK_RATE } from "../../../shared/coords.ts";
import { SESSION_ALIVE } from "../../../shared/net/protocol.ts";
import { JET_CAPACITY, JET_CUIRASS, JET_DASH, JET_FIST, JET_FULL_SUIT, JET_HOVER, JET_UP } from "../../../shared/sim/character.ts";
import { K_BAR } from "../ui/nodes.ts";
import { glass } from "../ui/skin.ts";
import { S_HUD_COUNT, S_MENU_NOTE, S_OXYGEN, S_WARNING } from "../ui/style.ts";
import { JET_W, NARROW } from "./layout.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_JET_FUEL = 3520;

export interface JetModel {
  jetGear: number;
  jetSpent: number;
  jetThrust: number;
  jetGrounded: boolean;
}

export const JET: HudWidget<JetModel> = {
  name: "jet fuel",
  make: () => ({ jetGear: 0, jetSpent: 0, jetThrust: 0, jetGrounded: false }),
  fill(model, c) {
    const session = c.session, b = session.own;
    model.jetGear = session.sessionState === SESSION_ALIVE && session.driving < 0 && !b.seat && (b.jetGear & JET_CUIRASS) ? b.jetGear : 0;
    model.jetSpent = b.jetSpent;
    model.jetThrust = b.jetThrust;
    model.jetGrounded = b.grounded;
  },
  build(f, m, at) {
    const { options, touch, W, dash, dashX, dashY, dashH, mapTools, aside } = at;
    if (m.jetGear && !dash) {
      const width = JET_W, x = dashX, y = dashY + (mapTools && !options.minimap && !aside ? 36 : 0);
      const left = Math.max(0, JET_CAPACITY - m.jetSpent);
      const status = m.jetThrust === JET_UP ? "Vertical burst" : m.jetThrust === JET_DASH ? "Greave dash" : m.jetThrust === JET_FIST ? "Gauntlet lunge" : m.jetThrust === JET_HOVER ? "Level flight" : m.jetThrust ? "Climbing" :
        m.jetGrounded && m.jetSpent ? "Recharging" : !left ? "Empty · land to recharge" : touch ? "Hold Jump, stick at its rim to hover" : "Hold Space · add Shift to hover";
      const linked = m.jetGear === JET_FULL_SUIT && W >= NARROW;
      glass(f, KEY_JET_FUEL, x, y, width, dashH);
      f.text(KEY_JET_FUEL + 1, x + 10, y + 6, width - 20, S_HUD_COUNT, `Jet fuel   ${(left / TICK_RATE).toFixed(1)} s`);
      f.add(KEY_JET_FUEL + 2, K_BAR, x + 10, y + 29, width - 20, 6, left <= 2 * TICK_RATE ? S_WARNING : S_OXYGEN).value = left / JET_CAPACITY;
      f.text(KEY_JET_FUEL + 3, x + 10, y + 39, width - 20, S_MENU_NOTE, status);
      if (linked) f.text(KEY_JET_FUEL + 4, x + 10, y + 59, width - 20, S_MENU_NOTE, "Full suit · 2× recharge");
    }
  },
};
