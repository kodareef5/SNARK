// Every button sends a command, and every number shown is the server's. A list longer than the panel is paged.

import type { EngramDef, ItemDef, SpeciesDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CMD_CRAFT, CMD_LEARN, CMD_SPEND } from "../../../shared/net/protocol.ts";
import { STAT_NAMES } from "../../../shared/sim/genome.ts";
import type { ClientSession } from "../session.ts";
import { itemLabel } from "./inventory.ts";
import { K_BUTTON, K_PANEL, columns, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_CHAR_PANEL = 1100;
export const KEY_CHAR_TITLE = 1101;
export const KEY_CHAR_POINTS = 1102;
export const KEY_CHAR_JOBS = 1103;
/** Three keys, one per tab. */
export const KEY_CHAR_TAB = 1104;
/** Previous page, next page, and "page 2 of 5". */
export const KEY_CHAR_PAGE = 1107;
/** Per stat: its line, then its "+" button. */
export const KEY_CHAR_STAT = 1110;
/** Keys for a line and a button for each content index there can be. The two lists stand clear of every other key. */
const LIST_KEYS = 2 * 65536;
/** Per engram, in engramOrder: its line, then its button. */
export const KEY_CHAR_ENGRAM = 200000;
/** Per item that can be made, in content order: its line, then its button. */
export const KEY_CHAR_RECIPE = KEY_CHAR_ENGRAM + LIST_KEYS;
export const TAB_STATS = 0;
export const TAB_ENGRAMS = 1;
export const TAB_MAKE = 2;
const TABS: readonly string[] = ["Stats", "Engrams", "Make"];
const ROW = 22;
const PAD = 12;
const BUTTON = 58;
const CHOSEN = 0x3f6ea8;

/** Content indices, in content order. */
function ofType(reg: Registry, type: string): number[] {
  const out: number[] = [];
  reg.defs.forEach((d, k) => d?.type === type && out.push(k));
  return out;
}

/** The items that can be made, in content order. */
function craftable(reg: Registry): number[] {
  const out: number[] = [];
  reg.defs.forEach((d, k) => d?.type === "item" && d.craft && out.push(k));
  return out;
}

/** Lowest level first, ties in content order. A hidden engram is listed only when `known` has it. */
export function engramOrder(reg: Registry, known: readonly number[] = []): number[] {
  return ofType(reg, "engram")
    .filter((e) => (reg.defs[e] as EngramDef).hidden !== true || known.includes(e))
    .sort((a, b) => (reg.defs[a] as EngramDef).level - (reg.defs[b] as EngramDef).level || a - b);
}

export class CharacterScreen {
  tab = TAB_STATS;
  page = 0;
  /** As of the last build. */
  pages = 1;

  build(f: UiFrame, session: ClientSession, reg: Registry): void {
    const p = session.progress;
    const species = reg.defs[session.ownKind] as SpeciesDef | null;
    const w = Math.min(f.width - 16, 500);
    const h = Math.min(f.height - 16, 560);
    const titleH = lineHeight(S_TITLE);
    const lh = lineHeight(S_LABEL);
    const x = Math.round((f.width - w) / 2);
    const y0 = Math.round((f.height - h) / 2);
    const inner = w - PAD * 2;
    const cols = columns(inner - BUTTON - 8, S_LABEL);
    f.add(KEY_CHAR_PANEL, K_PANEL, x, y0, w, h, S_PANEL);
    f.text(KEY_CHAR_TITLE, x + PAD, y0 + PAD, inner, S_TITLE, `Level ${p.level}  ${p.xp} xp`);
    let y = y0 + PAD + titleH;
    f.text(KEY_CHAR_POINTS, x + PAD, y, inner, S_LABEL, `${p.statPoints} stat points  ${p.engramPoints} engram points`);
    y += lh;
    const job = p.jobs[0];
    const making = job ? `making ${itemLabel(reg, job.item)} (${p.jobs.reduce((n, j) => n + j.left, 0)} to go)` : "nothing being made";
    f.text(KEY_CHAR_JOBS, x + PAD, y, inner, S_LABEL, making.slice(0, columns(inner, S_LABEL)));
    y += lh + 6;
    const tabW = (inner - 8) / TABS.length;
    TABS.forEach((label, i) => {
      const b = f.add(KEY_CHAR_TAB + i, K_BUTTON, x + PAD + i * (tabW + 4), y, tabW, ROW + 2, S_BUTTON);
      b.text = label;
      b.interactive = true;
      if (i === this.tab) b.tint = CHOSEN;
    });
    y += ROW + 10;

    // `button` is "" for a row without one.
    const rows: { key: number; text: string; button: string }[] = [];
    if (this.tab === TAB_STATS) {
      STAT_NAMES.forEach((name, i) => {
        // Only stats a point can raise are listed. Torpidity is not one.
        const curve = species?.stats?.[name];
        if (curve && curve[2] > 0) rows.push({ key: KEY_CHAR_STAT + i * 2, text: name, button: p.statPoints > 0 ? "+" : "" });
      });
    } else if (this.tab === TAB_ENGRAMS) {
      engramOrder(reg, p.engrams).forEach((e, n) => {
        const def = reg.defs[e] as EngramDef;
        const known = p.engrams.includes(e);
        const can = !known && p.level >= def.level && p.engramPoints >= def.cost;
        rows.push({ key: KEY_CHAR_ENGRAM + n * 2, text: known ? `${def.label}: known` : `${def.label}: level ${def.level}, ${def.cost} points`, button: can ? "learn" : "" });
      });
    } else {
      const known = new Set(p.engrams.map((e) => (reg.defs[e] as EngramDef).item));
      craftable(reg).forEach((k, n) => {
        const def = reg.defs[k] as ItemDef;
        if (!known.has(def.id)) return;
        const needs = def.craft!.needs.map((need) => `${need.count} ${itemLabel(reg, reg.index.get(need.item)!)}`).join(", ");
        rows.push({ key: KEY_CHAR_RECIPE + n * 2, text: `${def.label ?? itemLabel(reg, k)}: ${needs}`, button: "make" });
      });
    }
    const perPage = Math.max(1, Math.floor((y0 + h - PAD - ROW - 6 - y) / ROW));
    this.pages = Math.max(1, Math.ceil(rows.length / perPage));
    if (this.page >= this.pages) this.page = this.pages - 1;
    for (const row of rows.slice(this.page * perPage, (this.page + 1) * perPage)) {
      f.text(row.key, x + PAD, y + 2, inner - BUTTON - 8, S_LABEL, row.text.slice(0, cols));
      if (row.button !== "") {
        const b = f.add(row.key + 1, K_BUTTON, x + w - PAD - BUTTON, y + 1, BUTTON, ROW - 3, S_BUTTON);
        b.text = row.button;
        b.interactive = true;
      }
      y += ROW;
    }
    if (this.pages > 1) {
      const py = y0 + h - PAD - ROW;
      const prev = f.add(KEY_CHAR_PAGE, K_BUTTON, x + PAD, py, BUTTON, ROW, S_BUTTON);
      prev.text = "<";
      prev.interactive = true;
      const next = f.add(KEY_CHAR_PAGE + 1, K_BUTTON, x + w - PAD - BUTTON, py, BUTTON, ROW, S_BUTTON);
      next.text = ">";
      next.interactive = true;
      f.text(KEY_CHAR_PAGE + 2, x + PAD + BUTTON + 8, py + 3, inner - BUTTON * 2 - 16, S_LABEL, `page ${this.page + 1} of ${this.pages}`);
    }
  }

  /** Returns true if the key was one of this screen's buttons. */
  click(key: number, session: ClientSession, reg: Registry): boolean {
    if (key >= KEY_CHAR_TAB && key < KEY_CHAR_TAB + TABS.length) {
      this.tab = key - KEY_CHAR_TAB;
      this.page = 0;
      return true;
    }
    if (key === KEY_CHAR_PAGE || key === KEY_CHAR_PAGE + 1) {
      this.page = Math.max(0, Math.min(this.pages - 1, this.page + (key === KEY_CHAR_PAGE ? -1 : 1)));
      return true;
    }
    if (key >= KEY_CHAR_STAT && key < KEY_CHAR_STAT + STAT_NAMES.length * 2 && (key - KEY_CHAR_STAT) % 2 === 1) {
      const stat = (key - KEY_CHAR_STAT - 1) / 2;
      session.command(CMD_SPEND, (w) => w.u8(stat));
      return true;
    }
    if (key >= KEY_CHAR_ENGRAM && key < KEY_CHAR_RECIPE && (key - KEY_CHAR_ENGRAM) % 2 === 1) {
      const e = engramOrder(reg, session.progress.engrams)[(key - KEY_CHAR_ENGRAM - 1) / 2];
      if (e === undefined) return false;
      session.command(CMD_LEARN, (w) => w.u16(e));
      return true;
    }
    if (key >= KEY_CHAR_RECIPE && key < KEY_CHAR_RECIPE + LIST_KEYS && (key - KEY_CHAR_RECIPE) % 2 === 1) {
      const r = craftable(reg)[(key - KEY_CHAR_RECIPE - 1) / 2];
      if (r === undefined) return false;
      session.command(CMD_CRAFT, (w) => (w.u16(r), w.u8(1)));
      return true;
    }
    return false;
  }
}
