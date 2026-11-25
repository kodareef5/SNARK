// A jet's glass under the minimap: speed and mode, thrust, height and load, the cannon's rounds and the missiles, the
// lock, and the keys. A box is drawn about what is locked, faint while the lock forms and solid once it has; a warning
// stands in the middle of the screen while the jet itself is looked for, locked or chased. (hud/jet.ts is the jets a
// survivor wears.)

import { handleGen, handleIndex } from "../../../shared/ids.ts";
import { WARN_NONE } from "../arms.ts";
import { K_BAR, K_PANEL } from "../ui/nodes.ts";
import { glass } from "../ui/skin.ts";
import { S_CROSS, S_MENU_FOCUS, S_MENU_MAIN, S_MENU_NOTE, S_WARNING } from "../ui/style.ts";
import { HELI_W } from "./layout.ts";
import { KEY_VEHICLE } from "./vehicle.ts";
import type { HudWidget } from "./widget.ts";

/** The lock box's four sides, and the warning that the jet itself is locked or chased. */
export const KEY_LOCK = 6700;
export const KEY_LOCK_WARNING = 6706;
const LOCK_BOX = 44;

export interface FighterModel {
  /** Where what is locked is on the screen, 0 to 1 across and down, or -1 off it; and its name. */
  lockU: number;
  lockV: number;
  lockName: string;
  /** A seeker on what this survivor drives, rides or sits in, whatever it is: OWN_WARNED's level. */
  warned: number;
}

/** The warning words for OWN_WARNED's levels. */
export const WARNINGS = ["", "SEARCH RADAR", "LOCKED ON", "MISSILE INBOUND"] as const;

const at = [0, 0];

export const FIGHTER: HudWidget<FighterModel> = {
  name: "jet glass",
  make: () => ({ lockU: -1, lockV: -1, lockName: "", warned: WARN_NONE }),
  fill(m, c) {
    m.lockU = m.lockV = -1; m.lockName = "";
    m.warned = c.session.arms.warned;
    const f = c.frame, dash = f?.dash, arms = dash?.jet && dash.active ? dash.arms : null;
    if (!f || !arms || arms.lock === 0 || arms.target === 0) return;
    const r = c.remote;
    // Drawn where this client draws the target, else where the server said it is.
    let x = arms.x, y = arms.y, z = arms.z;
    m.lockName = arms.name;
    if (arms.target === 1) for (let i = 0; i < r.count; i++) {
      if (r.id[i] !== handleIndex(arms.handle) || r.gen[i] !== handleGen(arms.handle)) continue;
      x = r.x[i]!; y = r.y[i]! + f.reg.bodyHeight[r.kind[i]!]! / 2; z = r.z[i]!;
      m.lockName = f.reg.ids[r.kind[i]!]!.replace(/^.*:/, "").replace(/_/g, " ");
      break;
    }
    if (f.cam.project(x, y, z, at)) { m.lockU = at[0]!; m.lockV = at[1]!; }
  },
  build(f, m, layout) {
    const { dash, dashX, dashY, dashH, lean, W, H } = layout;
    const warning = WARNINGS[m.warned] ?? "";
    if (warning) f.text(KEY_LOCK_WARNING, Math.round(W / 2 - 110), Math.round(H * .3), 220, S_WARNING, warning);
    if (!dash?.jet) return;
    const v = dash, x = dashX, y = dashY, line = HELI_W - 24, arms = v.arms;
    glass(f, KEY_VEHICLE, x, y, HELI_W, dashH);
    f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(v.speed * 3.6).toString().padStart(3, "0"));
    f.text(KEY_VEHICLE + 10, x + 64, y + 15, 40, S_MENU_NOTE, "km/h");
    const mode = v.stalling ? "STALL" : v.afterburner ? "BURNER" : v.vtol ? "VTOL" : v.grounded ? "TAXI" : "FLIGHT";
    f.text(KEY_VEHICLE + 1, x + HELI_W - 104, y + 15, 92, v.stalling ? S_WARNING : S_MENU_NOTE, mode);
    f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, line, 3, v.afterburner ? S_WARNING : S_MENU_FOCUS).value = Math.min(1, v.thrust / 1.8);
    f.text(KEY_VEHICLE + 3, x + 12, y + 47, line, S_MENU_NOTE, `Throttle ${Math.round(v.throttle * 100)}% · Fuel ${Math.round(v.fuel * 100)}%${v.gear ? " · Gear" : ""}`);
    f.text(KEY_VEHICLE + 4, x + 12, y + 65, line, v.load > 7 ? S_WARNING : S_MENU_NOTE, `${Math.round(v.altitude)} m AGL · ${v.vertical >= 0 ? "+" : ""}${v.vertical.toFixed(1)} m/s · ${v.load.toFixed(1)} G`);
    f.text(KEY_VEHICLE + 5, x + 12, y + 83, line, arms && arms.rounds === 0 ? S_WARNING : S_MENU_NOTE, arms ? `Cannon ${arms.rounds} · Missiles ${arms.missiles}/${arms.missilesMax}` : v.engineOn ? "ENGINE ON" : "ENGINE OFF");
    const lock = !arms || arms.lock === 0 ? "" : arms.lock === 2 ? `LOCKED ${m.lockName.toUpperCase()} · let go to fire` : `LOCKING ${Math.round(arms.progress * 100)}%`;
    f.text(KEY_VEHICLE + 6, x + 12, y + 101, line, warning || arms?.lock === 2 ? S_WARNING : S_MENU_NOTE, warning || lock || (v.engineCondition < .7 ? `Engine ${Math.round(v.engineCondition * 100)}%` : v.grounded ? "On the ground" : "Land to get out"));
    if (lean) f.text(KEY_VEHICLE + 7, x + 12, y + 119, line, S_MENU_NOTE, v.engineOn ? "Aim with the view" : "Push the stick to start");
    else {
      f.text(KEY_VEHICLE + 7, x + 12, y + 119, line, S_MENU_NOTE, "W/S throttle · A/D roll · Mouse aim");
      f.text(KEY_VEHICLE + 8, x + 12, y + 137, line, S_MENU_NOTE, "Shift burner · Ctrl brake · N VTOL");
      f.text(KEY_VEHICLE + 9, x + 12, y + 155, line, S_MENU_NOTE, "Space/C VTOL climb and sink");
      f.text(KEY_VEHICLE + 11, x + 12, y + 173, line, S_MENU_NOTE, "LMB cannon · Hold RMB lock, let go fire");
      f.text(KEY_VEHICLE + 12, x + 12, y + 191, line, S_MENU_NOTE, v.grounded ? "E exit · F service" : "Land to get out");
    }
    if (m.lockU >= 0 && m.lockU <= 1 && m.lockV >= 0 && m.lockV <= 1) {
      const cx = m.lockU * W, cy = m.lockV * H, half = LOCK_BOX / 2, style = arms?.lock === 2 ? S_WARNING : S_CROSS;
      const alpha = arms?.lock === 2 ? 1 : .4 + .6 * (arms?.progress ?? 0);
      f.add(KEY_LOCK, K_PANEL, cx - half, cy - half, LOCK_BOX, 2, style).alpha = alpha;
      f.add(KEY_LOCK + 1, K_PANEL, cx - half, cy + half - 2, LOCK_BOX, 2, style).alpha = alpha;
      f.add(KEY_LOCK + 2, K_PANEL, cx - half, cy - half, 2, LOCK_BOX, style).alpha = alpha;
      f.add(KEY_LOCK + 3, K_PANEL, cx + half - 2, cy - half, 2, LOCK_BOX, style).alpha = alpha;
    }
  },
};
