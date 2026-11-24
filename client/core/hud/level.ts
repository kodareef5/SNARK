// The level and the experience toward the next, in the margin under the hotbar: what was just earned at its right end,
// and at its left the call to spend stat points while there are any.

import type { Registry } from "../../../shared/content/registry.ts";
import { SESSION_ALIVE } from "../../../shared/net/protocol.ts";
import { HOTBAR_SLOTS } from "../../../shared/sim/items.ts";
import { K_BAR, textWidth } from "../ui/nodes.ts";
import { S_HUD_KEY, S_OXYGEN, S_SLOT_TEXT, S_STAMINA } from "../ui/style.ts";
import { hotbarBottom, hotbarCell, hotbarLeft } from "./layout.ts";
import type { HudWidget } from "./widget.ts";

/** The words, the bar, the bar lit for a level just reached, and the gain. */
export const KEY_LEVEL = 3560;
/** How long a gain shows after the last one, the end of it that fades, and how long a new level lights the bar. */
export const GAIN_MS = 2000;
const FADE_MS = 400;
const FLASH_MS = 2000;
/** The least gain the line counts: the drip that comes with time is smaller, and would show six times a minute. */
export const GAIN_LEAST = 0.5;
/** Room for the gain at the right end, and between the bar and the words either side. */
const GAIN_W = 72;
const GAP = 6;

const TABLES = new WeakMap<Registry, readonly number[] | null>();

/**
 * The experience each level that can be reached takes in all, as the server's content has it: its table, cut short where
 * its cap on experience (OverrideMaxExperiencePointsPlayer) stops before a level. Null where content has no table.
 */
export function levelTable(reg: Registry): readonly number[] | null {
  let table = TABLES.get(reg);
  if (table !== undefined) return table;
  table = null;
  for (let i = 0; i < reg.defs.length && table === null; i++) {
    const d = reg.defs[i];
    if (d?.type === "levels") table = d.most === undefined ? d.xp : d.xp.filter((v) => v <= d.most!);
  }
  TABLES.set(reg, table);
  return table;
}

/** How far `xp` is from `level`'s threshold to the next one's, 0 to 1. Full at the last level that can be reached, and with no table. */
export function levelFraction(table: readonly number[] | null, level: number, xp: number): number {
  const to = table?.[level];
  if (to === undefined) return 1;
  const from = table![level - 1] ?? 0;
  return Math.max(0, Math.min(1, (xp - from) / (to - from)));
}

/** Whole experience with commas between its thousands. */
export function xpText(xp: number): string {
  return Math.floor(xp).toLocaleString("en-US");
}

/** A gain as it is shown: a whole number plain, a fraction to one decimal. "" for one too small to show. */
export function gainText(gain: number): string {
  const tenths = Math.round(gain * 10);
  if (tenths <= 0) return "";
  return `+${(tenths / 10).toLocaleString("en-US", { minimumFractionDigits: tenths % 10 ? 1 : 0, maximumFractionDigits: 1 })} xp`;
}

export class LevelBar {
  /** A living body's level has come from the server. */
  shown = false;
  level = 1;
  points = 0;
  xp = 0;
  /** 0 to 1, from this level's threshold to the next. */
  fraction = 0;
  label = "";
  /** The call to spend, for a keyboard and for a finger. "" with no points. */
  spend = "";
  spendTouch = "";
  /** What the gain line adds up to, its words, and how strongly they show. */
  gain = 0;
  gainText = "";
  gainAlpha = 0;
  /** How strongly the bar is lit for a level just reached. */
  flash = 0;
  gainAt = -Infinity;
  flashAt = -Infinity;
  /** What the words were made from: progress.version, and the registry the table was read from. */
  version = -1;
  reg: Registry | null = null;
  table: readonly number[] | null = null;

  /** No body: what comes next is a first value, not a gain. */
  hide(): void {
    this.shown = false;
    this.version = -1;
    this.gain = 0;
    this.gainText = "";
    this.gainAlpha = 0;
    this.flash = 0;
    this.gainAt = this.flashAt = -Infinity;
  }
}

export interface LevelModel {
  levelBar: LevelBar;
}

export const LEVEL: HudWidget<LevelModel> = {
  name: "level",
  make: () => ({ levelBar: new LevelBar() }),
  fill(m, c) {
    const s = c.session, p = s.progress, v = m.levelBar, now = c.nowMs;
    // The version is 0 until the server has said the level.
    if (s.sessionState !== SESSION_ALIVE || p.version === 0) { v.hide(); return; }
    if (now !== undefined && v.gain !== 0 && now - v.gainAt >= GAIN_MS) { v.gain = 0; v.gainText = ""; }
    const first = !v.shown;
    v.shown = true;
    if (s.registry !== v.reg) { v.reg = s.registry; v.table = levelTable(s.registry); v.version = -1; }
    if (p.version !== v.version) {
      v.version = p.version;
      const earned = first ? 0 : p.xp - v.xp, risen = !first && p.level > v.level;
      if (first || p.level !== v.level) v.label = `Lv ${p.level}`;
      if (first || p.level !== v.level || p.statPoints !== v.points) {
        v.spend = p.statPoints > 0 ? `Level ${p.level} · P to spend` : "";
        v.spendTouch = p.statPoints > 0 ? `Level ${p.level} · Character to spend` : "";
      }
      v.level = p.level;
      v.points = p.statPoints;
      v.xp = p.xp;
      v.fraction = levelFraction(v.table, p.level, p.xp);
      // A model updated outside time shows no gain: there is no clock to end it by.
      if (now !== undefined && earned >= GAIN_LEAST) { v.gain += earned; v.gainAt = now; v.gainText = gainText(v.gain); }
      if (now !== undefined && risen) v.flashAt = now;
    }
    v.gainAlpha = now === undefined || v.gain === 0 ? 0 : Math.min(1, (GAIN_MS - (now - v.gainAt)) / FADE_MS);
    v.flash = now === undefined ? 0 : Math.max(0, 1 - (now - v.flashAt) / FLASH_MS);
  },
  build(f, m, at) {
    const v = m.levelBar;
    if (!v.shown) return;
    const slots = m.hotbar.length || HOTBAR_SLOTS;
    const x = hotbarLeft(f, slots), y = hotbarBottom(f);
    const width = slots * (hotbarCell(f, slots) + 3) - 3;
    const words = v.points > 0 ? (at.touch ? v.spendTouch : v.spend) : v.label;
    const wordsW = Math.ceil(textWidth(words, S_HUD_KEY)), barX = x + wordsW + GAP, barW = width - wordsW - GAIN_W - GAP * 2;
    f.text(KEY_LEVEL, x, y, wordsW, S_HUD_KEY, words);
    f.add(KEY_LEVEL + 1, K_BAR, barX, y + 6, barW, 3, S_OXYGEN).value = v.fraction;
    if (v.flash > 0) {
      const lit = f.add(KEY_LEVEL + 2, K_BAR, barX, y + 6, barW, 3, S_STAMINA);
      lit.value = v.fraction;
      lit.alpha = v.flash;
    }
    if (v.gainAlpha > 0 && v.gainText !== "") {
      const gain = f.text(KEY_LEVEL + 3, x + width - GAIN_W, y, GAIN_W, S_SLOT_TEXT, v.gainText);
      gain.alpha = v.gainAlpha;
    }
  },
};
