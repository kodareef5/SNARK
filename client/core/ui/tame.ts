// Asks for the name of a creature the server says is now this survivor's. Enter sends the name, or nothing if none was typed.
// Escape leaves the creature as it is. Several creatures are asked about one after another.
// Also lays out the marks over creatures (OverheadModel in client/core/hud.ts).

import type { Registry } from "../../../shared/content/registry.ts";
import { MATING_STEPS } from "../../../shared/anim/pose.ts";
import { CMD_NAME, MAX_NAME_BYTES } from "../../../shared/net/protocol.ts";
import { BAR_FOOD, BAR_HEALTH, BAR_TAMING, BAR_TORPOR, MAX_HEARTS, OVER_RANGE, OWNER_OTHER, OWNER_TRIBE, OWNER_WILD, type OverheadModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { K_BAR, K_IMAGE, K_INPUT, K_PANEL, columns, lineHeight, textWidth, type UiFrame, type UiImage } from "./nodes.ts";
import { S_FOOD, S_HEALTH, S_INPUT, S_LABEL, S_OVER_OTHER, S_OVER_PANEL, S_OVER_TAMING, S_OVER_TEXT, S_OVER_TRIBE, S_OVER_WILD, S_PANEL, S_TITLE, S_TORPOR } from "./style.ts";

export const KEY_NAME_PANEL = 2460;
export const KEY_NAME_TITLE = 2461;
export const KEY_NAME_HINT = 2462;
export const KEY_NAME_INPUT = 2463;
/** The mark over the creature looked at: its name, its line, its tribe, a label and a bar for each of its bars, and a note. */
export const KEY_OVER_TITLE = 2500;
export const KEY_OVER_LINE = 2501;
export const KEY_OVER_TRIBE = 2502;
export const KEY_OVER_PANEL = 2503;
export const KEY_OVER_BAR = 2504;
export const KEY_OVER_NOTE = 2514;
/** One heart per mating creature, MAX_HEARTS at most. */
export const KEY_HEART = 2520;
/** In the frame's image table: a heart that shows no progress, then one filled for each mating step. */
export const IMAGE_HEART = 3;

const BAR_STYLE: Record<number, number> = { [BAR_HEALTH]: S_HEALTH, [BAR_FOOD]: S_FOOD, [BAR_TORPOR]: S_TORPOR, [BAR_TAMING]: S_OVER_TAMING };
const BAR_WORDS: Record<number, string> = { [BAR_HEALTH]: "health", [BAR_FOOD]: "food", [BAR_TORPOR]: "torpor", [BAR_TAMING]: "taming" };
const OWNER_STYLE: Record<number, number> = { [OWNER_WILD]: S_OVER_WILD, [OWNER_TRIBE]: S_OVER_TRIBE, [OWNER_OTHER]: S_OVER_OTHER };
/** Canvas units. A heart is drawn larger near: HEART_NEAR at NEAR metres or closer, down to HEART_FAR at OVER_RANGE. */
const HEART_NEAR = 20;
const HEART_FAR = 11;
const NEAR = 5;
const MARK_W = 200;
const BAR_W = 150;
const LABEL_W = 48;
const EDGE = 8;
const PAD = 5;

/** The side of a heart `far` metres off. */
export function heartSize(far: number): number {
  const t = Math.max(0, Math.min(1, (far - NEAR) / (OVER_RANGE - NEAR)));
  return Math.round(HEART_NEAR + (HEART_FAR - HEART_NEAR) * t);
}

/**
 * A heart, 32 pixels square, in our own drawing: a dark rim, and a body filled from the bottom to `fill` (0 to 1) in red,
 * the rest a dim red. Its version is its own, so a node that changes heart draws the new one.
 */
export function heartImage(fill: number, version: number): UiImage {
  const S = 32;
  const data = new Uint8ClampedArray(S * S * 4);
  // The heart curve (x^2 + y^2 - 1)^3 <= x^2 y^3, y up, from y = -1 at its point to about 1.2 at its lobes.
  const inside = (x: number, y: number): boolean => {
    const a = x * x + y * y - 1;
    return a * a * a <= x * x * y * y * y;
  };
  const level = -0.75 + fill * 1.85;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      let rim = 0;
      let body = 0;
      let lit = 0;
      // Four by four samples a pixel, for soft edges.
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = ((px + (sx + 0.5) / 4) / S - 0.5) * 2.5;
          const y = 1.25 - ((py + (sy + 0.5) / 4) / S) * 2.4;
          if (!inside(x, y)) continue;
          rim++;
          if (!inside(x / 0.8, (y - 0.08) / 0.8)) continue;
          body++;
          if (y <= level) lit++;
        }
      }
      if (rim === 0) continue;
      const o = (py * S + px) * 4;
      const full = lit / 16;
      const dim = (body - lit) / 16;
      const edge = (rim - body) / 16;
      // Over a dark rim: the filled part red, the rest dim.
      const a = edge * 0.9 + full + dim * 0.75;
      const r = (edge * 0.9 * 0x24 + full * 0xe8 + dim * 0.75 * 0x6a) / a;
      const g = (edge * 0.9 * 0x0a + full * 0x34 + dim * 0.75 * 0x26) / a;
      const b = (edge * 0.9 * 0x10 + full * 0x4c + dim * 0.75 * 0x30) / a;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = Math.min(1, a) * 255;
    }
  }
  return { width: S, height: S, data, version };
}

/** Text centred on `cx`, no wider than `most`. */
function centred(f: UiFrame, key: number, cx: number, y: number, most: number, style: number, text: string): void {
  const shown = text.slice(0, columns(most, style));
  const w = Math.max(1, textWidth(shown, style));
  f.text(key, cx - w / 2, y, w, style, shown);
}

/**
 * The marks over creatures. The hearts go first, the farthest at the bottom. The mark of the creature looked at stands over
 * its heart, if it has one, on a dim backdrop, and never comes down to the crosshair or the line under it.
 */
export function buildOverhead(f: UiFrame, m: OverheadModel): void {
  const W = f.width;
  const H = f.height;
  // A pair's first step shows an empty heart and its last a full one. A heart that shows no progress is full.
  if (!f.images[IMAGE_HEART]) for (let s = 0; s <= MATING_STEPS; s++) f.images[IMAGE_HEART + s] = heartImage(s === 0 ? 1 : (s - 1) / (MATING_STEPS - 1), 7000 + s);
  const count = Math.min(m.heartCount, MAX_HEARTS);
  for (let k = count - 1; k >= 0; k--) {
    const h = m.hearts[k]!;
    const s = heartSize(h.far);
    const x = Math.max(0, Math.min(W - s, h.u * W - s / 2));
    const y = Math.max(0, Math.min(H - s, h.v * H - s - 2));
    f.add(KEY_HEART + k, K_IMAGE, x, y, s, s, S_LABEL).image = IMAGE_HEART + h.step;
  }
  if (!m.look) return;
  const markW = Math.min(MARK_W, W - EDGE * 2);
  const barW = Math.min(BAR_W, markW);
  const titleStyle = OWNER_STYLE[m.owner]!;
  const tribeStyle = m.owner === OWNER_OTHER ? S_OVER_OTHER : S_OVER_TEXT;
  const titleH = lineHeight(titleStyle);
  const lineH = lineHeight(S_OVER_TEXT);
  const tribeH = m.tribe !== "" ? lineHeight(tribeStyle) : 0;
  const rowH = lineH;
  const height = titleH + lineH + tribeH + m.barCount * rowH + (m.note !== "" ? lineH : 0);
  const fits = (text: string, style: number): number => (text === "" ? 0 : textWidth(text.slice(0, columns(markW, style)), style));
  const wide = Math.max(fits(m.title, titleStyle), fits(m.line, S_OVER_TEXT), fits(m.tribe, tribeStyle), m.barCount > 0 ? barW : 0, fits(m.note, S_OVER_TEXT)) + PAD * 2;
  const lift = m.heart >= 0 && m.heart < count ? heartSize(m.hearts[m.heart]!.far) + 4 : 4;
  const bottom = Math.min(m.v * H - lift, H / 2 - 12) - PAD;
  let y = Math.max(EDGE + PAD, bottom - height);
  const cx = Math.max(EDGE + wide / 2, Math.min(W - EDGE - wide / 2, m.u * W));
  f.add(KEY_OVER_PANEL, K_PANEL, cx - wide / 2, y - PAD, wide, height + PAD * 2, S_OVER_PANEL);
  centred(f, KEY_OVER_TITLE, cx, y, markW, titleStyle, m.title);
  y += titleH;
  centred(f, KEY_OVER_LINE, cx, y, markW, S_OVER_TEXT, m.line);
  y += lineH;
  if (m.tribe !== "") {
    centred(f, KEY_OVER_TRIBE, cx, y, markW, tribeStyle, m.tribe);
    y += tribeH;
  }
  const x0 = cx - barW / 2;
  for (let k = 0; k < m.barCount; k++) {
    const b = m.bars[k]!;
    f.text(KEY_OVER_BAR + k * 2, x0, y, LABEL_W, S_OVER_TEXT, BAR_WORDS[b.kind]!);
    f.add(KEY_OVER_BAR + k * 2 + 1, K_BAR, x0 + LABEL_W, y + rowH / 2 - 3, barW - LABEL_W, 6, BAR_STYLE[b.kind]!).value = b.fraction;
    y += rowH;
  }
  if (m.note !== "") centred(f, KEY_OVER_NOTE, cx, y, markW, S_OVER_TEXT, m.note);
}

/** The `te` the server sends for a creature claimed as young and not tamed. Matches CLAIMED in server/breeding.ts. */
const CLAIMED = 255;

/** The start of `text` that is no more than `most` bytes of UTF-8, with no character cut in two. */
function fitBytes(text: string, most: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes > most) break;
    end += ch.length;
  }
  return text.slice(0, end);
}

export class NamePrompt {
  /** While open, the panel asks about session.tamed[0]. */
  open = false;
  text = "";

  absorb(session: ClientSession): void {
    if (!this.open && session.tamed.length > 0) {
      this.open = true;
      this.text = "";
    }
  }

  edit(value: string): void {
    this.text = fitBytes(value, MAX_NAME_BYTES);
  }

  /** Returns true for Enter and Escape while the panel is up. Every other key is typing. */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    if (!this.open) return false;
    if (code !== "Enter" && code !== "NumpadEnter" && code !== "Escape") return false;
    if (!down || repeat || !session) return true;
    const which = session.tamed.shift();
    const name = this.text.trim();
    if (which && code !== "Escape" && name !== "") session.command(CMD_NAME, (w) => (w.u32(which.handle), w.string(name)));
    this.open = false;
    this.text = "";
    return true;
  }

  build(f: UiFrame, session: ClientSession, reg: Registry): void {
    const which = session.tamed[0];
    if (!this.open || !which) {
      this.open = false;
      return;
    }
    const id = reg.ids[which.kind] ?? "";
    const what = id.slice(id.indexOf(":") + 1);
    const w = Math.min(f.width - 16, 380);
    const titleH = lineHeight(S_TITLE);
    const labelH = lineHeight(S_LABEL);
    const pad = 12;
    const fieldH = 28;
    const h = pad * 2 + titleH + labelH + 8 + fieldH;
    const x = Math.round((f.width - w) / 2);
    const y = Math.round(f.height * 0.3);
    f.add(KEY_NAME_PANEL, K_PANEL, x, y, w, h, S_PANEL);
    // A creature claimed as young was not tamed, so there is no "% well" to show.
    const young = which.te === CLAIMED;
    f.text(KEY_NAME_TITLE, x + pad, y + pad, w - pad * 2, S_TITLE, young ? `Yours: a young ${what}, level ${which.level}` : `Tamed: a ${what}, level ${which.level}`);
    f.text(KEY_NAME_HINT, x + pad, y + pad + titleH, w - pad * 2, S_LABEL, young ? "It is hungry. Name it and press Enter." : `${which.te}% well. Name it and press Enter.`);
    const field = f.add(KEY_NAME_INPUT, K_INPUT, x + pad, y + pad + titleH + labelH + 8, w - pad * 2, fieldH, S_INPUT);
    field.text = this.text;
    field.interactive = true;
    field.focus = true;
  }
}
