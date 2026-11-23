// A skater's trick feed in the middle of the screen: the line as it grows, its points and multiplier, how each landing
// went, the banked line or the bail, the balance on an edge and the special meter. While H is held, every trick and its keys.

import { BAIL, FLIP, GRAB, GRIND, LINE_MOST, MANUAL, SLIDE, SPECIAL, SPECIAL_FULL } from "../../../shared/sim/skate-state.ts";
import {
  FAM_FLIP, FAM_GRAB, FAM_GRIND, FAM_MANUAL, FAM_SLIDE, FAM_SPECIAL, GRADE_PERFECT, GRADE_SLOPPY, SKATE_TRICKS,
  entryHalves, entryTrick, trickName, trickOf,
} from "../../../shared/sim/skate-tricks.ts";
import { K_BAR, type UiFrame } from "../ui/nodes.ts";
import { glass } from "../ui/skin.ts";
import { S_MENU_FOCUS, S_MENU_HEADING, S_MENU_NOTE, S_SKATE_BAD, S_SKATE_GOOD, S_SKATE_LINE, S_SKATE_METER, S_SKATE_SCORE, S_SKATE_TRICK, S_WARNING } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_SKATE = 3540;
export const KEY_TRICKS = 3800;
const FLASH_MS = 1400;
/** Entries of a line the feed shows, newest last. */
const SHOWN = 4;

export class SkateFeed {
  active = false;
  line = "";
  score = "";
  /** -1 to 1 on an edge or in a manual, else NaN. */
  balance = NaN;
  /** The special meter, 0 to 1. */
  special = 0;
  flash = "";
  flashStyle = S_SKATE_GOOD;
  flashAlpha = 0;
  gamepad = false;
  flashAt = -Infinity;
  /** What was seen last frame, to tell what changed. */
  banks = -1;
  move = -1;
  landed = 255;
  shape = -1;
  points = -1;
  chain = -1;

  show(text: string, style: number, now: number | undefined): void {
    if (now === undefined) return;
    this.flash = text; this.flashStyle = style; this.flashAt = now; this.flashAlpha = 1;
  }
}

export interface SkateModel {
  skateFeed: SkateFeed;
}

/** A number for what the feed's line shows, so it is written again only when that changes. */
function lineShape(s: { count: number; pending: number; move: number; trick: number; line: Uint16Array }): number {
  let h = s.count * 31 + s.pending * 7 + (s.move === FLIP || s.move === GRAB || s.move === SPECIAL ? s.trick * 131 : 0);
  for (let i = Math.max(0, s.count - SHOWN); i < s.count; i++) h = (h * 33 + s.line[i % LINE_MOST]!) | 0;
  return h;
}

export const SKATE: HudWidget<SkateModel> = {
  name: "skate feed",
  make: () => ({ skateFeed: new SkateFeed() }),
  fill(m, c) {
    const feed = m.skateFeed, dash = c.frame?.dash, s = dash?.board ? c.session.own.skate : null, now = c.nowMs;
    feed.flashAlpha = now === undefined ? 0 : Math.max(0, 1 - (now - feed.flashAt) / FLASH_MS);
    if (!s) { feed.active = false; feed.banks = -1; feed.move = -1; return; }
    feed.active = true;
    feed.gamepad = dash!.gamepad;
    if (s.move === BAIL && feed.move !== BAIL && feed.move >= 0) feed.show("Bail", S_SKATE_BAD, now);
    else if (feed.banks >= 0 && s.banks !== feed.banks && s.bank > 0) feed.show(`+${s.bank}`, S_SKATE_GOOD, now);
    else if (s.landed === 0 && feed.landed !== 0 && (s.grade === GRADE_PERFECT || s.grade === GRADE_SLOPPY)) {
      feed.show(s.grade === GRADE_PERFECT ? "Perfect" : "Sloppy", s.grade === GRADE_PERFECT ? S_SKATE_GOOD : S_WARNING, now);
    }
    feed.banks = s.banks; feed.move = s.move; feed.landed = s.landed;
    const shape = lineShape(s);
    if (shape !== feed.shape) {
      feed.shape = shape;
      const names: string[] = [];
      for (let i = Math.max(0, s.count - SHOWN); i < s.count; i++) {
        const e = s.line[i % LINE_MOST]!;
        names.push(trickName(entryTrick(e), entryHalves(e)));
      }
      if ((s.move === FLIP || s.move === GRAB || s.move === SPECIAL) && s.trick) names.push(trickOf(s.trick).name);
      feed.line = (s.count > SHOWN ? "... + " : "") + names.join(" + ");
    }
    if (s.points !== feed.points || s.chain !== feed.chain) {
      feed.points = s.points; feed.chain = s.chain;
      feed.score = s.chain ? `${s.points}  x  ${s.chain}` : "";
    }
    feed.balance = s.move === GRIND || s.move === SLIDE || s.move === MANUAL ? s.balance / 1000 : NaN;
    feed.special = Math.min(1, s.special / SPECIAL_FULL);
  },
  build(f, m, at) {
    // High in the middle, in the sky over the rider: the word for what just happened, the score, the line, the special meter.
    const feed = m.skateFeed, { W, H } = at, cx = W / 2, width = Math.min(620, W - 40);
    const top = Math.max(at.top + 70, Math.round(H * .16));
    const listing = feed.active && at.inspect;
    if (feed.active && !listing) {
      if (feed.score) f.text(KEY_SKATE + 1, cx - width / 2, top + 36, width, S_SKATE_SCORE, feed.score);
      if (feed.line) f.text(KEY_SKATE, cx - width / 2, top + 66, width, S_SKATE_LINE, feed.line);
      const meter = 160;
      f.add(KEY_SKATE + 2, K_BAR, cx - meter / 2, top + 92, meter, 3, S_SKATE_METER).value = feed.special;
      if (feed.special >= 1) f.text(KEY_SKATE + 3, cx - width / 2, top + 98, width, S_SKATE_TRICK, feed.gamepad ? "Special ready: LT in the air" : "Special ready: G in the air");
      if (!Number.isNaN(feed.balance)) {
        // The balance under the rider's feet: keep the mark in the middle with A and D.
        const bw = 150, bx = cx - bw / 2, by = Math.round(at.foot - 108), mark = bx + (feed.balance / 2 + .5) * (bw - 6);
        f.add(KEY_SKATE + 4, K_BAR, bx, by, bw, 3, S_MENU_NOTE).value = 1;
        f.add(KEY_SKATE + 5, K_BAR, cx, by - 4, 1, 11, S_MENU_NOTE).value = 1;
        f.add(KEY_SKATE + 6, K_BAR, mark, by - 3, 6, 9, Math.abs(feed.balance) > .65 ? S_WARNING : S_MENU_FOCUS).value = 1;
      }
    }
    if (feed.flashAlpha > 0 && !listing) f.text(KEY_SKATE + 7, cx - width / 2, top, width, feed.flashStyle, feed.flash).alpha = feed.flashAlpha;
    if (listing) trickList(f, cx, W, H, feed.gamepad);
  },
};

interface Keys {
  pop: string; flip: string; grab: string; catch: string; manual: string; revert: string; special: string; turn: string;
  /** The words for each direction, as skate-tricks.ts numbers them: none, up, down, left, right, then the diagonals. */
  dirs: readonly string[];
}
const KEYBOARD: Keys = { pop: "Space", flip: "R or left click", grab: "C or right click", catch: "Shift", manual: "X", revert: "Q", special: "G", turn: "A or D",
  dirs: ["", "W", "S", "A", "D", "W+A", "W+D", "S+A", "S+D"] };
const PAD: Keys = { pop: "A", flip: "RT", grab: "RB", catch: "L3", manual: "LB", revert: "X", special: "LT", turn: "the stick left or right",
  dirs: ["", "up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"] };

const rows = new Map<Keys, { heading: boolean; text: string }[]>();
/** The trick list's lines for a kind of control, made once. */
function listRows(k: Keys): { heading: boolean; text: string }[] {
  let out = rows.get(k);
  if (out) return out;
  out = [];
  const tricks = (family: number): string => SKATE_TRICKS.filter((t) => t.family === family)
    .map((t) => `${t.name}${k.dirs[t.dirs[0] ?? 0] ? ` (${k.dirs[t.dirs[0]!]})` : ""} ${t.points}`).join("     ");
  out.push({ heading: false, text: `Hold ${k.pop} to crouch and let go to pop: longer is higher. Tap ${k.pop} just before you land for a Perfect.` });
  out.push({ heading: false, text: `In the air ${k.turn} spins: a tap turns 180, holding turns more. Land straight for a Clean landing.` });
  out.push({ heading: true, text: `Flips: ${k.flip} in the air, with a direction` });
  out.push({ heading: false, text: tricks(FAM_FLIP) });
  out.push({ heading: true, text: `Grabs: hold ${k.grab} in the air with a direction, let go before landing` });
  out.push({ heading: false, text: tricks(FAM_GRAB) });
  out.push({ heading: true, text: `Grinds: hold ${k.catch} coming down along an edge` });
  out.push({ heading: false, text: tricks(FAM_GRIND) });
  out.push({ heading: true, text: `Slides: hold ${k.catch} coming down across an edge` });
  out.push({ heading: false, text: tricks(FAM_SLIDE) });
  out.push({ heading: true, text: `Manuals: hold ${k.manual} rolling, with ${k.dirs[1]} for the nose. Revert: ${k.revert} just after landing` });
  out.push({ heading: false, text: tricks(FAM_MANUAL) + "    Revert 100" });
  out.push({ heading: true, text: `Specials: ${k.special} in the air with the meter full` });
  out.push({ heading: false, text: tricks(FAM_SPECIAL) });
  out.push({ heading: false, text: "Each new trick raises the multiplier; one done again in the same line pays less. Roll on for a moment to bank the line." });
  rows.set(k, out);
  return out;
}

function trickList(f: UiFrame, cx: number, W: number, H: number, pad: boolean): void {
  const list = listRows(pad ? PAD : KEYBOARD), pw = Math.min(860, W - 32), lh = 19;
  let ph = 56;
  for (const r of list) ph += r.heading ? lh + 6 : lh;
  const x = cx - pw / 2, y = Math.max(16, Math.round(H / 2 - ph / 2 - 40));
  glass(f, KEY_TRICKS, x, y, pw, ph);
  f.text(KEY_TRICKS + 1, x + 16, y + 6, pw - 32, S_MENU_HEADING, "Tricks");
  let ty = y + 46;
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!;
    if (r.heading) ty += 6;
    f.text(KEY_TRICKS + 2 + i, x + 16, ty, pw - 32, r.heading ? S_SKATE_TRICK : S_MENU_NOTE, r.text);
    ty += lh;
  }
}
