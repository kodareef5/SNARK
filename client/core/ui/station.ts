// The open crafting station's panel, beside its inventory (planning/reference/stations-plan.md, M9 and S4): a fire's on/off
// button and how long it burns, what the fire makes by itself (its lanes), the queue with a unit paused for want of fuel,
// and what the station makes, in pages, each with make 1, 5, 10 and all, or greyed with why it cannot be made. The
// blueprints lying in the station come first, each made from as CMD_CRAFT_BLUEPRINT makes it.
//
// Every number is the server's (OWN_STATION) or the open inventory's: the panel works out how many units the slots make,
// and predicts nothing. A button sends a command and the server decides: CMD_STRUCT's light action with the station's ref,
// CMD_CRAFT_AT, or CMD_CRAFT_BLUEPRINT with the blueprint's slot in the open box.

import type { EngramDef, ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { BOX_OPEN, CMD_CRAFT_AT, CMD_CRAFT_BLUEPRINT, CMD_STRUCT } from "../../../shared/net/protocol.ts";
import { FLAG_BLUEPRINT, QUALITY_NAMES, blueprintCost, type Inventory } from "../../../shared/sim/items.ts";
import { STRUCT_LIGHT } from "../../../shared/world/upkeep.ts";
import type { ClientSession } from "../session.ts";
import { itemLabel } from "./item-words.ts";
import { K_BUTTON, K_PANEL, fitText, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_STATION_PANEL = 2600;
export const KEY_STATION_TITLE = 2601;
/** One line per job in the queue, eight at most (the server's MAX_JOBS). */
export const KEY_STATION_JOB = 2602;
/**
 * Per row of the recipe page shown, RECIPE_KEYS keys from KEY_STATION_RECIPE + row * RECIPE_KEYS: its line, the line that
 * says whether and how many it can make, its picture, then its make buttons (MAKE_COUNTS, then all). Twelve rows end at 2693.
 */
export const KEY_STATION_RECIPE = 2610;
export const RECIPE_KEYS = 7;
export const RECIPE_STATUS = 1;
export const RECIPE_PICTURE = 2;
export const RECIPE_MAKE = 3;
// The stations wave's keys (2700 to 2799): the fire's line and button, a line per lane, the pager, a line when nothing is made.
export const KEY_STATION_FIRE = 2700;
export const KEY_STATION_LIGHT = 2701;
/** One line per lane, eight at most. */
export const KEY_STATION_LANE = 2702;
/** Three keys: page back, the "1 / 3" line, page on. */
export const KEY_STATION_PAGE = 2710;
export const KEY_STATION_NONE = 2713;
/**
 * Where the canvas is too narrow for the panel beside the inventory (a phone held upright), the open container's title row
 * has a button that shows the panel alone, and the panel a button that goes back to the slots.
 */
export const KEY_STATION_VIEW = 2714;
export const KEY_STATION_SLOTS = 2715;

/** The counts a recipe's buttons ask for; the last button, "all", asks for as many as the slots make. */
export const MAKE_COUNTS: readonly number[] = [1, 5, 10];
/** A job's count is a u8 the server takes up to 100 of (Progression.craftAt). */
export const MAX_MAKE = 100;
/** Recipes a page shows, fewer where the canvas is too short for them. */
export const PAGE_ROWS = 12;
const MAX_JOB_LINES = 8;
const MAX_LANE_LINES = 8;
/** The server's MAX_JOBS: a station with this many jobs takes no more. */
const MAX_JOBS = 8;
const WIDTH = 360;
const PAD = 12;
const BUTTON_H = 22;
const MAKE_W = 28;
const GAP = 3;
const PAGER_W = 28;
/** A greyed line, picture or button. */
const GREY = 0.45;

/** The items made at a station of structure kind `kind`, in content order. A lit station makes what it makes out. */
export function stationRecipes(reg: Registry, kind: number): number[] {
  const base = reg.stationBase[kind] ?? 0;
  const out: number[] = [];
  for (let k = 1; base !== 0 && k < reg.defs.length; k++) if (reg.craftAt[k] === base) out.push(k);
  return out;
}

/** Seconds as "45 s", "3:20" or "1:02:05". */
export function clockWords(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s} s`;
  const two = (n: number): string => String(n).padStart(2, "0");
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}:${two(s % 60)}` : `${Math.floor(m / 60)}:${two(m % 60)}:${two(s % 60)}`;
}

/** Units of `item` the slots of `inv` hold the ingredients of, at a blueprint's quality `q` (-1 for the engram's). */
export function unitsIn(reg: Registry, inv: Inventory, item: number, q = -1): number {
  const needs = reg.recipeOf[item];
  if (!needs) return 0;
  let n = Infinity;
  for (let k = 0; k + 1 < needs.length; k += 2) n = Math.min(n, Math.floor(inv.total(needs[k]!) / (q >= 0 ? blueprintCost(needs[k + 1]!, q) : needs[k + 1]!)));
  return n === Infinity ? 0 : n;
}

/** What one unit of `item` lacks in `inv`, as "3 stone, 1 flint", or "" when nothing. */
function lacking(reg: Registry, inv: Inventory, item: number, q = -1): string {
  const needs = reg.recipeOf[item];
  const out: string[] = [];
  for (let k = 0; needs && k + 1 < needs.length; k += 2) {
    const short = (q >= 0 ? blueprintCost(needs[k + 1]!, q) : needs[k + 1]!) - inv.total(needs[k]!);
    if (short > 0) out.push(`${short} ${itemLabel(reg, needs[k]!)}`);
  }
  return out.join(", ");
}

/** Whether `item` is something the station of `kind` burns: its own fuel (`burns`), or any item's own `fuel`. */
function burnsIn(reg: Registry, kind: number, item: number): boolean {
  const own = reg.stationFuel[kind];
  return (own ? own[item]! : reg.fuelTicks[item]!) > 0;
}

/** One row of the recipe list: made from the engram (`slot` -1) or from the blueprint in `slot` of the open box. */
interface Row {
  item: number;
  slot: number;
  /** Units the station's slots make, at most MAX_MAKE; the buttons that ask for more are greyed. */
  can: number;
  /** Why it cannot be made now, or "" when it can. */
  why: string;
  /** Made by the fire by itself (CraftFacet.fired), with no buttons. */
  fired: boolean;
}

export class StationPanel {
  /** The page of recipes shown, and how many there were at the last build. */
  page = 0;
  pages = 1;
  /** The rows of the page shown at the last build, which a click reads. */
  private shown: Row[] = [];
  private ref = -1;
  /** The light button was not greyed at the last build. */
  private canLight = false;
  /** Shown alone, in place of the inventory, on a canvas too narrow for both. */
  alone = false;

  /** The panel's width on the canvas `f`. */
  width(f: UiFrame): number {
    return Math.min(WIDTH, f.width - 8);
  }

  /** Whether a station is open, so the inventory makes room for the panel. */
  showing(session: ClientSession): boolean {
    return !!session.station && !!session.open;
  }

  /**
   * Called by the inventory each build, before it draws, with whether the canvas is too narrow for the panel beside it. A
   * wide one never shows it alone, and another station opened starts on its first page, beside its slots.
   */
  begin(session: ClientSession, narrow: boolean): void {
    this.shown = [];
    this.canLight = false;
    const ref = session.station && session.open ? session.station.ref : -1;
    if (ref !== this.ref) {
      this.ref = ref;
      this.page = 0;
      this.alone = false;
    }
    if (!narrow) this.alone = false;
  }

  /** The rows the station lists: the blueprints that lie in it of what it makes, then each recipe in content order. */
  private rows(session: ClientSession, reg: Registry): Row[] {
    const station = session.station!;
    const inv = session.open!.inventory;
    const kind = station.kind;
    const base = reg.stationBase[kind] ?? 0;
    const lit = reg.burning[kind] === 1;
    const full = station.jobs.length >= MAX_JOBS;
    const off = reg.powered[kind] === 1 && !lit;
    const known = new Set(session.progress.engrams.map((e) => (reg.defs[e] as EngramDef | null)?.item));
    const out: Row[] = [];
    const add = (item: number, slot: number, q: number): void => {
      const def = reg.defs[item] as ItemDef;
      const fired = reg.firedAt[item] !== 0;
      const can = Math.min(MAX_MAKE, unitsIn(reg, inv, item, q));
      const short = can === 0 ? lacking(reg, inv, item, q) : "";
      const level = def.craft!.level ?? 0;
      let why = "";
      if (fired) why = !lit ? "made by the fire while it burns" : short !== "" ? `lacks ${short}` : "";
      else if (slot < 0 && !known.has(def.id)) why = "engram not known";
      else if (slot < 0 && session.progress.level < level) why = `needs level ${level}`;
      else if (off) why = "must be on, with fuel";
      else if (full) why = "the queue is full";
      else if (short !== "") why = `lacks ${short}`;
      out.push({ item, slot, can, why, fired });
    };
    for (let s = 0; s < inv.cap; s++) if ((inv.flags[s]! & FLAG_BLUEPRINT) !== 0 && inv.item[s] !== 0 && base !== 0 && reg.craftAt[inv.item[s]!] === base) add(inv.item[s]!, s, inv.quality[s]!);
    for (const item of stationRecipes(reg, kind)) add(item, -1, -1);
    return out;
  }

  /**
   * Draws the panel of the open station, if the open container is one, at `x` from `top` down, raised where the canvas is too
   * short for it (the inventory places it: beside its column, or alone in its place). Alone, it has a button back to the slots.
   */
  build(f: UiFrame, session: ClientSession, reg: Registry, x: number, top: number): void {
    const station = session.station;
    if (!station || !session.open) return;
    if (station.ref !== this.ref) this.begin(session, true);
    this.canLight = false;
    const kind = station.kind;
    const inv = session.open.inventory;
    const tick = session.serverTick;
    const lights = reg.lights[kind] !== 0;
    const lit = reg.burning[kind] === 1;
    const powered = reg.powered[kind] === 1;
    const pw = this.width(f);
    const titleH = lineHeight(S_TITLE);
    const lh = lineHeight(S_LABEL);
    const inner = pw - PAD * 2;
    // A row is its name and cost over a line that says what it can make, with the make buttons at its right.
    const rowH = lh + BUTTON_H + 4;
    const jobs = station.jobs.slice(0, MAX_JOB_LINES);
    const lanes = station.lanes.slice(0, MAX_LANE_LINES);
    const all = this.rows(session, reg);
    // What lies above the recipes, and the pager under them. A page holds as many rows as the canvas has room for, at most twelve.
    const headH = PAD + titleH + (lights ? BUTTON_H + 4 : 0) + lh * lanes.length + lh * Math.max(1, jobs.length) + 6;
    const pagerH = BUTTON_H + 6;
    const fit = Math.max(1, Math.floor((f.height - 8 - headH - pagerH - PAD) / rowH));
    const perPage = Math.min(PAGE_ROWS, fit);
    this.pages = Math.max(1, Math.ceil(all.length / perPage));
    if (this.page >= this.pages) this.page = this.pages - 1;
    const rows = all.slice(this.page * perPage, (this.page + 1) * perPage);
    const h = headH + (all.length === 0 ? lh : rowH * rows.length) + (this.pages > 1 ? pagerH : 0) + PAD;
    const y0 = Math.max(4, Math.min(top, f.height - 4 - h));
    // A line too long for its place ends in an ellipsis, so a list cut short reads as cut.
    const cut = (text: string, width: number): string => fitText(text, width, S_LABEL);
    f.add(KEY_STATION_PANEL, K_PANEL, x, y0, pw, h, S_PANEL);
    const backW = this.alone ? 72 : 0;
    f.text(KEY_STATION_TITLE, x + PAD, y0 + PAD, inner - backW, S_TITLE, fitText("Crafting", inner - backW, S_TITLE));
    if (this.alone) {
      const back = f.add(KEY_STATION_SLOTS, K_BUTTON, x + pw - PAD - backW, y0 + PAD, backW, BUTTON_H, S_BUTTON);
      back.text = "Slots";
      back.interactive = true;
    }
    let y = y0 + PAD + titleH;

    if (lights) {
      // A fire: whether it burns and for how long, and the button that lights it or puts it out. Out, with nothing in it that
      // it burns, the button is greyed. A powered station is turned on and off.
      const own = reg.stationFuel[kind];
      const fuels = own ? own.reduce<string[]>((names, t, item) => (t > 0 && names.length < 2 ? [...names, itemLabel(reg, item)] : names), []) : [];
      let fuelled = false;
      for (let s = 0; s < inv.cap && !fuelled; s++) fuelled = inv.item[s] !== 0 && (inv.flags[s]! & FLAG_BLUEPRINT) === 0 && burnsIn(reg, kind, inv.item[s]!);
      const state = lit ? (station.out > 0 ? `burns for ${clockWords((station.out - tick) / TICK_RATE)}` : "burning") : fuelled ? (powered ? "off" : "out") : `${powered ? "off" : "out"}: no ${fuels.length > 0 ? fuels.join(" or ") : "fuel"} in it`;
      const bw = 84;
      f.text(KEY_STATION_FIRE, x + PAD, y + (BUTTON_H - lh) / 2, inner - bw - 8, S_LABEL, cut(state, inner - bw - 8));
      const b = f.add(KEY_STATION_LIGHT, K_BUTTON, x + pw - PAD - bw, y, bw, BUTTON_H, S_BUTTON);
      b.text = lit ? (powered ? "Turn off" : "Put out") : powered ? "Turn on" : "Light";
      b.interactive = this.canLight = lit || fuelled;
      if (!b.interactive) b.alpha = GREY;
      y += BUTTON_H + 4;
    }

    // What the fire makes by itself: done in so long, or waiting, and for what.
    lanes.forEach((lane, n) => {
      const label = itemLabel(reg, lane.item);
      const short = lacking(reg, inv, lane.item);
      const line = lane.doneAt > 0 ? `${label} in ${clockWords((lane.doneAt - tick) / TICK_RATE)}` : !lit ? `${label} waits for the fire` : short !== "" ? `${label} waits for ${short}` : `${label} waits for room`;
      f.text(KEY_STATION_LANE + n, x + PAD, y, inner, S_LABEL, cut(line, inner));
      y += lh;
    });

    if (jobs.length === 0) f.text(KEY_STATION_JOB, x + PAD, y, inner, S_LABEL, "nothing being made");
    jobs.forEach((job, n) => {
      // The first job's unit under way shows its seconds to go; one paused for want of fuel, what it has left.
      const label = `${n === 0 ? "making" : "then"} ${itemLabel(reg, job.item)} x${job.left}`;
      const wait = n !== 0 ? "" : job.doneAt === 0 && job.rest > 0 ? `: needs fuel, ${clockWords(job.rest / TICK_RATE)} left` : job.doneAt > 0 ? `, ${clockWords((job.doneAt - tick) / TICK_RATE)}` : "";
      f.text(KEY_STATION_JOB + n, x + PAD, y + n * lh, inner, S_LABEL, cut(label + wait, inner));
    });
    y += lh * Math.max(1, jobs.length) + 6;

    if (all.length === 0) {
      const none = reg.stationCooks[kind] === 1 && lights ? "nothing is made here; it cooks what lies in it" : "nothing is made here";
      f.text(KEY_STATION_NONE, x + PAD, y, inner, S_LABEL, cut(none, inner));
    }
    // Rows keep one edge whether or not each has a picture, where any may.
    const indent = f.icons ? lh * 2 + 4 : 0;
    const buttonsW = (MAKE_COUNTS.length + 1) * (MAKE_W + GAP) - GAP;
    rows.forEach((row, n) => {
      const key = KEY_STATION_RECIPE + n * RECIPE_KEYS;
      const def = reg.defs[row.item] as ItemDef;
      const grey = row.why !== "";
      const q = row.slot >= 0 ? inv.quality[row.slot]! : -1;
      const picture = f.picture(key + RECIPE_PICTURE, x + PAD, y, rowH - 4, rowH - 4, S_LABEL, def.id);
      if (picture && grey) picture.alpha = GREY;
      const makes = def.craft!.count ?? 1;
      const needs = reg.recipeOf[row.item]!;
      const cost: string[] = [];
      for (let k = 0; k + 1 < needs.length; k += 2) cost.push(`${q >= 0 ? blueprintCost(needs[k + 1]!, q) : needs[k + 1]} ${itemLabel(reg, needs[k]!)}`);
      const name = row.slot >= 0 ? `${QUALITY_NAMES[q] ?? ""} ${itemLabel(reg, row.item)} blueprint` : itemLabel(reg, row.item);
      const lineW = inner - indent;
      f.text(key, x + PAD + indent, y, lineW, S_LABEL, cut(`${name}${makes > 1 ? ` x${makes}` : ""}: ${cost.join(", ")}`, lineW)).alpha = grey ? GREY : 1;
      const statusW = lineW - (row.fired ? 0 : buttonsW + 6);
      const status = grey ? row.why : row.fired ? "the fire makes it by itself" : `can make ${row.can}${row.can >= MAX_MAKE ? " a job" : ""}`;
      f.text(key + RECIPE_STATUS, x + PAD + indent, y + lh + (BUTTON_H - lh) / 2, statusW, S_LABEL, cut(status, statusW)).alpha = grey ? GREY : 1;
      if (!row.fired) {
        [...MAKE_COUNTS, 0].forEach((count, i) => {
          const b = f.add(key + RECIPE_MAKE + i, K_BUTTON, x + pw - PAD - buttonsW + i * (MAKE_W + GAP), y + lh + 1, MAKE_W, BUTTON_H, S_BUTTON);
          b.text = count === 0 ? "all" : String(count);
          b.interactive = !grey && row.can >= Math.max(1, count);
          if (!b.interactive) b.alpha = GREY;
        });
      }
      y += rowH;
    });
    this.shown = rows;

    if (this.pages > 1) {
      const py = y0 + h - PAD - BUTTON_H;
      for (const [n, label] of [[0, "<"], [2, ">"]] as const) {
        const b = f.add(KEY_STATION_PAGE + n, K_BUTTON, n === 0 ? x + PAD : x + pw - PAD - PAGER_W, py, PAGER_W, BUTTON_H, S_BUTTON);
        b.text = label;
        b.interactive = true;
      }
      const words = `page ${this.page + 1} of ${this.pages}`;
      f.text(KEY_STATION_PAGE + 1, x + PAD + PAGER_W + 8, py + (BUTTON_H - lh) / 2, inner - PAGER_W * 2 - 16, S_LABEL, cut(words, inner - PAGER_W * 2 - 16));
    }
  }

  /** Returns true if the key was one of the panel's buttons. A greyed button does nothing. */
  click(key: number, session: ClientSession, reg: Registry): boolean {
    const station = session.station;
    if (!station || !session.open) return false;
    if (key === KEY_STATION_VIEW || key === KEY_STATION_SLOTS) {
      this.alone = key === KEY_STATION_VIEW;
      return true;
    }
    if (key === KEY_STATION_LIGHT) {
      if (reg.lights[station.kind] === 0 || !this.canLight) return true;
      session.command(CMD_STRUCT, (w) => (w.u32(station.ref), w.u8(STRUCT_LIGHT)));
      return true;
    }
    if (key === KEY_STATION_PAGE || key === KEY_STATION_PAGE + 2) {
      this.page = Math.max(0, Math.min(this.pages - 1, this.page + (key === KEY_STATION_PAGE ? -1 : 1)));
      return true;
    }
    const n = Math.floor((key - KEY_STATION_RECIPE) / RECIPE_KEYS);
    const button = key - KEY_STATION_RECIPE - n * RECIPE_KEYS - RECIPE_MAKE;
    const row = this.shown[n];
    if (key < KEY_STATION_RECIPE || !row || button < 0 || button > MAKE_COUNTS.length) return false;
    const count = button === MAKE_COUNTS.length ? row.can : MAKE_COUNTS[button]!;
    if (row.fired || row.why !== "" || count < 1 || row.can < count) return true;
    if (row.slot >= 0) session.command(CMD_CRAFT_BLUEPRINT, (w) => (w.bits(BOX_OPEN, 1), w.varint(row.slot), w.u8(count)));
    else session.command(CMD_CRAFT_AT, (w) => (w.u16(row.item), w.u8(count)));
    return true;
  }
}
