// Every button sends a command, and every number shown is the server's. A list longer than the panel is paged.

import type { EngramDef, ItemDef, SpeciesDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CMD_CRAFT, CMD_LEARN, CMD_SPEND } from "../../../shared/net/protocol.ts";
import { STAT_NAMES } from "../../../shared/sim/genome.ts";
import { levelFraction, levelTable, xpText } from "../hud/level.ts";
import type { ClientSession } from "../session.ts";
import { itemLabel } from "./inventory.ts";
import { K_BAR, K_BUTTON, K_PANEL, fitText, lineHeight, type UiFrame } from "./nodes.ts";
import { CHARACTER_PARTS } from "./character-parts.ts";
import { PART_KEYS, PartKeys, partOf, type Screen, type ScreenCtx, type ScreenPart } from "./screen.ts";
import { S_BUTTON, S_LABEL, S_OXYGEN, S_PANEL, S_TITLE } from "./style.ts";

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
/** The bar under the title: how far the level is toward the next. Past the stats' keys. */
export const KEY_CHAR_XP = 1140;
/** Keys for a line and a button for each content index there can be. The two lists stand clear of every other key. */
const LIST_KEYS = 2 * 65536;
/** Per engram, in engramOrder: its line, then its button. */
export const KEY_CHAR_ENGRAM = 200000;
/** Per item that can be made, in content order: its line, then its button. */
export const KEY_CHAR_RECIPE = KEY_CHAR_ENGRAM + LIST_KEYS;
/** Per item that can be made, in content order: its picture. Past both lists, and as clear of every other key. */
export const KEY_CHAR_RECIPE_PICTURE = KEY_CHAR_RECIPE + LIST_KEYS;
/** Per engram, in engramOrder: its picture, its item's where it has none of its own. Past the pictures of the recipes. */
export const KEY_CHAR_ENGRAM_PICTURE = KEY_CHAR_RECIPE_PICTURE + LIST_KEYS;
/** The keys its parts are given: PART_KEYS for each, from here (screen.ts PartKeys). */
export const KEY_CHAR_PARTS = 900000;
const MAX_PARTS = 64;
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

/** The items that can be made in the hands, in content order. What is made at a station is listed beside it (station.ts). */
function craftable(reg: Registry): number[] {
  const out: number[] = [];
  reg.defs.forEach((d, k) => d?.type === "item" && d.craft && reg.craftAt[k] === 0 && out.push(k));
  return out;
}

/** Lowest level first, ties in content order. A hidden engram is listed only when `known` has it. */
export function engramOrder(reg: Registry, known: readonly number[] = []): number[] {
  return ofType(reg, "engram")
    .filter((e) => (reg.defs[e] as EngramDef).hidden !== true || known.includes(e))
    .sort((a, b) => (reg.defs[a] as EngramDef).level - (reg.defs[b] as EngramDef).level || a - b);
}

export class CharacterScreen implements Screen {
  readonly name = "character";
  readonly layer = "modal";
  readonly group = "bag";
  readonly hotkey = "KeyP";
  readonly dock = [
    { id: "craft", label: "Craft", art: "craft", rank: 20, open: (c: ScreenCtx) => this.openAt(TAB_MAKE, c) },
    { id: "survivor", label: "Survivor", art: "survivor", rank: 30, open: (c: ScreenCtx) => this.openAt(TAB_STATS, c) },
  ];

  /** Opens by its hotkey, as the bag's keys do, on tab `tab`. */
  private openAt(tab: number, c: ScreenCtx): void {
    c.pressKey(this.hotkey);
    if (this.isOpen() && c.session && c.registry) this.click(KEY_CHAR_TAB + tab, c.session, c.registry);
  }
  readonly bands = [{ from: KEY_CHAR_PANEL, count: KEY_CHAR_XP + 1 - KEY_CHAR_PANEL }, { from: KEY_CHAR_ENGRAM, count: 4 * LIST_KEYS }, { from: KEY_CHAR_PARTS, count: MAX_PARTS * PART_KEYS }];
  /** Its tabs after its own, from other files (character-parts.ts). */
  readonly parts: ScreenPart[] = [...CHARACTER_PARTS];
  private readonly partKeys = new PartKeys();
  open = false;
  tab = TAB_STATS;
  page = 0;
  /** As of the last build. */
  pages = 1;

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  build(f: UiFrame, c: ScreenCtx): void {
    if (c.session && c.registry) this.draw(f, c.session, c.registry, c);
  }

  pointer(kind: number, key: number, x: number, y: number, button: number, c: ScreenCtx): boolean {
    const part = partOf(key, KEY_CHAR_PARTS, this.parts.length);
    if (part && part.local < 0) {
      if (kind === 0) this.choose(TABS.length + part.index);
      return true;
    }
    if (part) return this.shown(part.index)?.pointer?.(kind, part.local, x, y, button, c) ?? true;
    return kind === 0 && c.session !== null && c.registry !== null && this.click(key, c.session, c.registry);
  }

  text(key: number, value: string, c: ScreenCtx): boolean {
    const part = partOf(key, KEY_CHAR_PARTS, this.parts.length);
    return part !== null && part.local >= 0 && (this.shown(part.index)?.text?.(part.local, value, c) ?? true);
  }

  value(key: number, value: number, c: ScreenCtx): boolean {
    const part = partOf(key, KEY_CHAR_PARTS, this.parts.length);
    return part !== null && part.local >= 0 && (this.shown(part.index)?.value?.(part.local, value, c) ?? false);
  }

  /** Part `index`, if its tab is the one shown: a key of a part whose tab has been left, before the frame is drawn again, reaches nothing. */
  private shown(index: number): ScreenPart | null {
    return this.tab === TABS.length + index ? this.parts[index] ?? null : null;
  }

  private choose(tab: number): void {
    this.tab = tab;
    this.page = 0;
  }

  /** `c` is wanted only for a tab of a part. */
  draw(f: UiFrame, session: ClientSession, reg: Registry, c: ScreenCtx | null = null): void {
    const p = session.progress;
    const species = reg.defs[session.ownKind] as SpeciesDef | null;
    const w = Math.min(f.width - 16, 500);
    const h = Math.min(f.height - 16, 560);
    const titleH = lineHeight(S_TITLE);
    const lh = lineHeight(S_LABEL);
    const x = Math.round((f.width - w) / 2);
    const y0 = Math.round((f.height - h) / 2);
    const inner = w - PAD * 2;
    f.add(KEY_CHAR_PANEL, K_PANEL, x, y0, w, h, S_PANEL);
    // The next level's threshold may have a fraction: rounded up, so it never reads as reached before it is.
    const table = levelTable(reg), next = table?.[p.level];
    const title = next === undefined ? `Level ${p.level} · ${xpText(p.xp)} xp` : `Level ${p.level} · ${xpText(p.xp)} / ${xpText(Math.ceil(next))} xp`;
    f.text(KEY_CHAR_TITLE, x + PAD, y0 + PAD, inner, S_TITLE, fitText(title, inner, S_TITLE));
    let y = y0 + PAD + titleH;
    f.add(KEY_CHAR_XP, K_BAR, x + PAD, y + 1, inner, 4, S_OXYGEN).value = levelFraction(table, p.level, p.xp);
    y += 8;
    f.text(KEY_CHAR_POINTS, x + PAD, y, inner, S_LABEL, `${p.statPoints} stat points  ${p.engramPoints} engram points`);
    y += lh;
    const job = p.jobs[0];
    const making = job ? `making ${itemLabel(reg, job.item)} (${p.jobs.reduce((n, j) => n + j.left, 0)} to go)` : "nothing being made";
    f.text(KEY_CHAR_JOBS, x + PAD, y, inner, S_LABEL, fitText(making, inner, S_LABEL));
    y += lh + 6;
    const parts = Math.min(this.parts.length, MAX_PARTS), tabs = TABS.length + parts;
    const tabW = (inner - (tabs - 1) * 4) / tabs;
    for (let i = 0; i < tabs; i++) {
      const b = f.add(i < TABS.length ? KEY_CHAR_TAB + i : KEY_CHAR_PARTS + (i - TABS.length) * PART_KEYS, K_BUTTON, x + PAD + i * (tabW + 4), y, tabW, ROW + 2, S_BUTTON);
      b.text = fitText(i < TABS.length ? TABS[i]! : this.parts[i - TABS.length]!.label, tabW - 8, S_BUTTON);
      b.interactive = true;
      if (i === this.tab) b.tint = CHOSEN;
    }
    y += ROW + 10;
    if (this.tab >= TABS.length) {
      // A part has the room under the tabs, with no pages of the screen's own.
      const index = this.tab - TABS.length, part = this.parts[index];
      this.pages = 1;
      if (!part || !c || index >= MAX_PARTS) return;
      this.partKeys.base = KEY_CHAR_PARTS + index * PART_KEYS;
      part.build(f, { x: x + PAD, y, w: inner, h: y0 + h - PAD - y }, this.partKeys, c);
      return;
    }

    // `button` is "" for a row without one. A row of the Engrams and Make tabs has the picture of what it makes at its left,
    // where there is one.
    const rows: { key: number; text: string; button: string; picture?: { key: number; owner: string } }[] = [];
    if (this.tab === TAB_STATS) {
      STAT_NAMES.forEach((name, i) => {
        // Only stats a point can raise are listed. Torpidity is not one. A point adds its share of the stat as it began.
        const curve = species?.stats?.[name];
        if (curve && curve[2] > 0) rows.push({ key: KEY_CHAR_STAT + i * 2, text: `${name}  +${Math.round(curve[2] * 1000) / 10}% a point`, button: p.statPoints > 0 ? "+" : "" });
      });
    } else if (this.tab === TAB_ENGRAMS) {
      engramOrder(reg, p.engrams).forEach((e, n) => {
        const def = reg.defs[e] as EngramDef;
        const known = p.engrams.includes(e);
        const can = !known && p.level >= def.level && p.engramPoints >= def.cost;
        rows.push({ key: KEY_CHAR_ENGRAM + n * 2, text: known ? `${def.label}: known` : `${def.label}: level ${def.level}, ${def.cost} points`, button: can ? "learn" : "", picture: { key: KEY_CHAR_ENGRAM_PICTURE + n, owner: def.id } });
      });
    } else {
      const known = new Set(p.engrams.map((e) => (reg.defs[e] as EngramDef).item));
      craftable(reg).forEach((k, n) => {
        const def = reg.defs[k] as ItemDef;
        if (!known.has(def.id)) return;
        const needs = def.craft!.needs.map((need) => `${need.count} ${itemLabel(reg, reg.index.get(need.item)!)}`).join(", ");
        rows.push({ key: KEY_CHAR_RECIPE + n * 2, text: `${def.label ?? itemLabel(reg, k)}: ${needs}`, button: "make", picture: { key: KEY_CHAR_RECIPE_PICTURE + n, owner: def.id } });
      });
    }
    const perPage = Math.max(1, Math.floor((y0 + h - PAD - ROW - 6 - y) / ROW));
    this.pages = Math.max(1, Math.ceil(rows.length / perPage));
    if (this.page >= this.pages) this.page = this.pages - 1;
    for (const row of rows.slice(this.page * perPage, (this.page + 1) * perPage)) {
      // Rows keep one edge whether or not each has a picture, where any may.
      const indent = row.picture && f.icons ? ROW : 0;
      if (row.picture) f.picture(row.picture.key, x + PAD, y, ROW - 2, ROW - 2, S_LABEL, row.picture.owner);
      f.text(row.key, x + PAD + indent, y + 2, inner - BUTTON - 8 - indent, S_LABEL, fitText(row.text, inner - BUTTON - 8 - indent, S_LABEL));
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
      this.choose(key - KEY_CHAR_TAB);
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
