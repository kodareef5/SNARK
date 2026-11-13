// The character screen: level and experience, stat points to place, engrams to
// learn, and what can be made. Every button is a command; the numbers are the
// server's.

import type { EngramDef, ItemDef, RecipeDef, SpeciesDef } from "../../../shared/content/defs.ts";
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
/** Per stat: its line, then its "+" button. */
export const KEY_CHAR_STAT = 1110;
/** Per engram (by its place among engrams in content order): its line, then its button. */
export const KEY_CHAR_ENGRAM = 1200;
/** Per recipe, likewise. */
export const KEY_CHAR_RECIPE = 1400;
const ROW = 22;
const PAD = 12;
const BUTTON = 58;

/** Content indices of every definition of a type, in content order. */
function ofType(reg: Registry, type: string): number[] {
  const out: number[] = [];
  reg.defs.forEach((d, k) => d?.type === type && out.push(k));
  return out;
}

export function buildCharacter(f: UiFrame, session: ClientSession, reg: Registry): void {
  const p = session.progress;
  const species = reg.defs[session.ownKind] as SpeciesDef | null;
  const stats = STAT_NAMES.map((name, i) => ({ name, i })).filter((s) => species?.stats?.[s.name]);
  const engrams = ofType(reg, "engram");
  const recipes = ofType(reg, "recipe").filter((r) => engrams.some((e) => p.engrams.includes(e) && (reg.defs[e] as EngramDef).unlocks.includes(reg.ids[r]!)));
  const w = Math.min(f.width - 16, 500);
  const titleH = lineHeight(S_TITLE);
  const lh = lineHeight(S_LABEL);
  const h = PAD * 2 + titleH + lh * 2 + 8 + (stats.length + engrams.length + recipes.length) * ROW + 12;
  const x = Math.round((f.width - w) / 2);
  const y0 = Math.max(4, Math.round((f.height - h) / 2));
  const cols = columns(w - PAD * 2 - BUTTON - 8, S_LABEL);
  f.add(KEY_CHAR_PANEL, K_PANEL, x, y0, w, h, S_PANEL);
  f.text(KEY_CHAR_TITLE, x + PAD, y0 + PAD, w - PAD * 2, S_TITLE, `Level ${p.level}  ${p.xp} xp`);
  let y = y0 + PAD + titleH;
  f.text(KEY_CHAR_POINTS, x + PAD, y, w - PAD * 2, S_LABEL, `${p.statPoints} stat points  ${p.engramPoints} engram points`);
  y += lh;
  const job = p.jobs[0];
  const making = job ? `making ${itemLabel(reg, reg.index.get((reg.defs[job.recipe] as RecipeDef).makes)!)} (${p.jobs.reduce((n, j) => n + j.left, 0)} to go)` : "nothing being made";
  f.text(KEY_CHAR_JOBS, x + PAD, y, w - PAD * 2, S_LABEL, making.slice(0, columns(w - PAD * 2, S_LABEL)));
  y += lh + 8;

  const row = (key: number, text: string, button: string): void => {
    f.text(key, x + PAD, y + 2, w - PAD * 2 - BUTTON - 8, S_LABEL, text.slice(0, cols));
    if (button !== "") {
      const b = f.add(key + 1, K_BUTTON, x + w - PAD - BUTTON, y + 1, BUTTON, ROW - 3, S_BUTTON);
      b.text = button;
      b.interactive = true;
    }
    y += ROW;
  };
  for (const s of stats) row(KEY_CHAR_STAT + s.i * 2, s.name, p.statPoints > 0 ? "+" : "");
  engrams.forEach((e, n) => {
    const def = reg.defs[e] as EngramDef;
    const known = p.engrams.includes(e);
    const can = !known && p.level >= def.level && p.engramPoints >= def.cost;
    row(KEY_CHAR_ENGRAM + n * 2, known ? `${def.label}: known` : `${def.label}: level ${def.level}, ${def.cost} points`, can ? "learn" : "");
  });
  recipes.forEach((r) => {
    const def = reg.defs[r] as RecipeDef;
    const needs = def.needs.map((n) => `${n.count} ${itemLabel(reg, reg.index.get(n.item)!)}`).join(", ");
    const label = (reg.defs[reg.index.get(def.makes)!] as ItemDef).label ?? itemLabel(reg, reg.index.get(def.makes)!);
    row(KEY_CHAR_RECIPE + ofType(reg, "recipe").indexOf(r) * 2, `${label}: ${needs}`, "make");
  });
}

/** A press on one of the screen's buttons. Returns true if it was one. */
export function characterClick(key: number, session: ClientSession, reg: Registry): boolean {
  if (key >= KEY_CHAR_STAT && key < KEY_CHAR_ENGRAM && (key - KEY_CHAR_STAT) % 2 === 1) {
    const stat = (key - KEY_CHAR_STAT - 1) / 2;
    session.command(CMD_SPEND, (w) => w.u8(stat));
    return true;
  }
  if (key >= KEY_CHAR_ENGRAM && key < KEY_CHAR_RECIPE && (key - KEY_CHAR_ENGRAM) % 2 === 1) {
    const e = ofType(reg, "engram")[(key - KEY_CHAR_ENGRAM - 1) / 2];
    if (e === undefined) return false;
    session.command(CMD_LEARN, (w) => w.u16(e));
    return true;
  }
  if (key >= KEY_CHAR_RECIPE && key < KEY_CHAR_RECIPE + 400 && (key - KEY_CHAR_RECIPE) % 2 === 1) {
    const r = ofType(reg, "recipe")[(key - KEY_CHAR_RECIPE - 1) / 2];
    if (r === undefined) return false;
    session.command(CMD_CRAFT, (w) => (w.u16(r), w.u8(1)));
    return true;
  }
  return false;
}
