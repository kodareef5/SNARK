// The red edge over the view of a survivor knocked down, and the red closing in and the black of one dying
// (view/fallen.ts). Drawn as the hurt edge is (ui/combat.ts): overlapping bands that deepen toward each side.

import { K_PANEL } from "../ui/nodes.ts";
import { S_BLOOD, S_DARK } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_FALLEN = 3600;
/** Bands along each side; deeper ones overlap the outer ones. */
const BANDS = 5;

export interface FallenModel {
  /** As view/fallen.ts FallenShown has them: the red's strength and reach, and the black. */
  fallenRed: number;
  fallenReach: number;
  fallenBlack: number;
}

export const FALLEN: HudWidget<FallenModel> = {
  name: "fallen",
  make: () => ({ fallenRed: 0, fallenReach: 0, fallenBlack: 0 }),
  fill(m, c) {
    const s = c.frame?.fallen;
    m.fallenRed = s?.red ?? 0;
    m.fallenReach = s?.reach ?? 0;
    m.fallenBlack = s?.black ?? 0;
  },
  build(f, m, at) {
    const { W, H } = at;
    let k = KEY_FALLEN;
    if (m.fallenRed > 0.01) {
      const deep = (m.fallenReach * Math.min(W, H)) / 2, a = Math.min(1, m.fallenRed * 1.6 / BANDS);
      for (let band = BANDS; band >= 1; band--) {
        const t = (deep * band) / BANDS;
        f.add(k++, K_PANEL, 0, 0, W, t, S_BLOOD).alpha = a;
        f.add(k++, K_PANEL, 0, H - t, W, t, S_BLOOD).alpha = a;
        f.add(k++, K_PANEL, 0, t, t, H - t * 2, S_BLOOD).alpha = a;
        f.add(k++, K_PANEL, W - t, t, t, H - t * 2, S_BLOOD).alpha = a;
      }
    }
    if (m.fallenBlack > 0.01) f.add(k, K_PANEL, 0, 0, W, H, S_DARK).alpha = Math.min(1, m.fallenBlack);
  },
};
