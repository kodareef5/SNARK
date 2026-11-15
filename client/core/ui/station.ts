// The open crafting station's panel, beside its inventory: what it makes, its queue, and a button to make each. Every number
// is the server's (OWN_STATION), and a button sends CMD_CRAFT_AT, which makes the thing at the station the session has open.

import type { EngramDef, ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { CMD_CRAFT_AT } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { itemLabel } from "./inventory.ts";
import { K_BUTTON, K_PANEL, columns, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_STATION_PANEL = 2600;
export const KEY_STATION_TITLE = 2601;
/** One line per job in the queue, eight at most (the server's MAX_JOBS). */
export const KEY_STATION_JOB = 2602;
/** Per item the station makes, in content order: its line, then its button. */
export const KEY_STATION_RECIPE = 2620;
/** Recipes shown; their keys stop below 2700. */
const MAX_RECIPES = 40;
const MAX_JOB_LINES = 8;
const WIDTH = 360;
const ROW = 22;
const PAD = 12;
const BUTTON = 58;

/** The items made at a station of structure kind `kind`, in content order. */
export function stationRecipes(reg: Registry, kind: number): number[] {
  const out: number[] = [];
  for (let k = 1; k < reg.defs.length; k++) if (reg.craftAt[k] === kind) out.push(k);
  return out.slice(0, MAX_RECIPES);
}

export class StationPanel {
  /**
   * Draws the panel of the open station, if the open container is one, beside the column at `x0` that is `w` wide, from `top`
   * down. It goes to the right of the column where there is room, else to its left, else over the right edge of the screen.
   */
  build(f: UiFrame, session: ClientSession, reg: Registry, x0: number, top: number, w: number): void {
    const station = session.station;
    if (!station || !session.open) return;
    const pw = Math.min(WIDTH, f.width - 8);
    const x = x0 + w + 8 + pw <= f.width - 4 ? x0 + w + 8 : x0 - pw - 8 >= 4 ? x0 - pw - 8 : f.width - pw - 4;
    const titleH = lineHeight(S_TITLE);
    const lh = lineHeight(S_LABEL);
    const inner = pw - PAD * 2;
    const recipes = stationRecipes(reg, station.kind);
    const jobs = station.jobs.slice(0, MAX_JOB_LINES);
    const h = PAD * 2 + titleH + lh * Math.max(1, jobs.length) + 6 + ROW * recipes.length;
    f.add(KEY_STATION_PANEL, K_PANEL, x, top, pw, h, S_PANEL);
    f.text(KEY_STATION_TITLE, x + PAD, top + PAD, inner, S_TITLE, "Crafting".slice(0, columns(inner, S_TITLE)));
    let y = top + PAD + titleH;
    if (jobs.length === 0) {
      f.text(KEY_STATION_JOB, x + PAD, y, inner, S_LABEL, "nothing being made");
      y += lh;
    }
    jobs.forEach((job, n) => {
      // The first job's unit under way shows its seconds to go.
      const wait = n === 0 && job.doneAt > 0 ? `, ${Math.max(0, Math.ceil((job.doneAt - session.serverTick) / TICK_RATE))} s` : "";
      const line = `${n === 0 ? "making" : "then"} ${itemLabel(reg, job.item)} x${job.left}${wait}`;
      f.text(KEY_STATION_JOB + n, x + PAD, y, inner, S_LABEL, line.slice(0, columns(inner, S_LABEL)));
      y += lh;
    });
    y += 6;
    const known = new Set(session.progress.engrams.map((e) => (reg.defs[e] as EngramDef).item));
    const cols = columns(inner - BUTTON - 8, S_LABEL);
    recipes.forEach((k, n) => {
      const def = reg.defs[k] as ItemDef;
      const makes = def.craft!.count ?? 1;
      const needs = def.craft!.needs.map((need) => `${need.count} ${itemLabel(reg, reg.index.get(need.item)!)}`).join(", ");
      const text = `${itemLabel(reg, k)}${makes > 1 ? ` x${makes}` : ""}: ${needs}`;
      f.text(KEY_STATION_RECIPE + n * 2, x + PAD, y + 2, inner - BUTTON - 8, S_LABEL, text.slice(0, cols));
      if (known.has(def.id)) {
        const b = f.add(KEY_STATION_RECIPE + n * 2 + 1, K_BUTTON, x + pw - PAD - BUTTON, y + 1, BUTTON, ROW - 3, S_BUTTON);
        b.text = "make";
        b.interactive = true;
      }
      y += ROW;
    });
  }

  /** Returns true if the key was one of the panel's buttons. */
  click(key: number, session: ClientSession, reg: Registry): boolean {
    const station = session.station;
    if (!station || key < KEY_STATION_RECIPE || key >= KEY_STATION_RECIPE + MAX_RECIPES * 2 || (key - KEY_STATION_RECIPE) % 2 !== 1) return false;
    const item = stationRecipes(reg, station.kind)[(key - KEY_STATION_RECIPE - 1) / 2];
    if (item === undefined) return false;
    session.command(CMD_CRAFT_AT, (w) => (w.u16(item), w.u8(1)));
    return true;
  }
}
