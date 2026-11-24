// Edits a look (shared/anim/look.ts). The app draws it on a body at the spawn point from `look` and `turn`.
// Nothing is sent until "Create", which sends the look to the server once.

import {
  BEARD_STYLES, HAIR_STYLES, LOOK_BEARD, LOOK_EYE_COLOR, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_SEX, LOOK_SKIN, REGIONS, REGION_COUNT, SEX_LABELS,
  defaultLook, randomLook, regionOf, setRegion,
} from "../../../shared/anim/look.ts";
import { hashString } from "../../../shared/hash.ts";
import { EYE_BASE, EYE_COLORS, HAIR_BASE, HAIR_COLORS, SKIN_BASE, SKIN_TONES } from "../../../shared/pack/palette.ts";
import { Rng } from "../../../shared/rng.ts";
import { RESULT_OK, SESSION_CREATING } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { S_BUTTON, S_LABEL, S_MARK_SELF, S_PANEL, S_SWATCH, S_TITLE } from "./style.ts";
import { slider } from "./slider.ts";

export const KEY_CREATOR_PANEL = 3000;
export const KEY_CREATOR_TITLE = 3001;
/** Two keys, one per tab. */
export const KEY_CREATOR_TAB = 3002;
export const KEY_CREATOR_SEX = 3010;
/** Two keys: turn the body left, turn it right. */
export const KEY_CREATOR_TURN = 3012;
export const KEY_CREATOR_RANDOM = 3014;
export const KEY_CREATOR_RESET = 3015;
export const KEY_CREATOR_CREATE = 3016;
export const KEY_CREATOR_NOTE = 3017;
/** One key per swatch for skin, hair colour and eyes, then one per style for hair and beard. */
export const KEY_CREATOR_SKIN = 3100;
export const KEY_CREATOR_HAIR_COLOR = 3120;
export const KEY_CREATOR_EYE = 3140;
export const KEY_CREATOR_HAIR = 3160;
export const KEY_CREATOR_BEARD = 3170;
/** Section labels and the marks behind chosen swatches. */
export const KEY_CREATOR_LABEL = 3180;
export const KEY_CREATOR_MARK = 3190;
/** Per body region: its label, a button down, its bar, a button up. */
export const KEY_CREATOR_REGION = 3200;

const PAD = 12;
const ROW = 24;
/** One press of a region's button moves it this far, on a scale of -1 to 1. */
const STEP = 0.1;
/** A twelfth of a turn per press. */
const TURN_STEP = Math.PI / 6;
const CHOSEN = 0x3f6ea8;

const TAB_LOOK = 0;

export class CreatorScreen implements Screen {
  readonly name = "creator";
  readonly layer = "modal";
  /** A press on it makes no click: it is the whole interface, turned and dragged. */
  readonly quiet = true;
  readonly bands = [{ from: KEY_CREATOR_PANEL, count: KEY_CREATOR_REGION + REGION_COUNT * 4 - KEY_CREATOR_PANEL }];
  readonly look = defaultLook();
  tab = TAB_LOOK;
  /** Radians. The body starts facing the viewer, a little to one side. */
  turn = 0.35;
  /** The server refused the last "Create". `sent` is that command's sequence number. */
  refused = false;
  private sent = 0;
  private rng: Rng | null = null;
  /** The session it last read: the screen is up while that session is in the creator. */
  private session: ClientSession | null = null;

  isOpen(): boolean {
    return this.session?.sessionState === SESSION_CREATING;
  }

  absorb(c: ScreenCtx): void {
    this.session = c.session;
  }

  /** Only the session closes it, once the survivor is made. */
  close(): void {}

  build(f: UiFrame, c: ScreenCtx): void {
    if (c.session) this.draw(f, c.palette, c.session.name);
  }

  draw(f: UiFrame, palette: Uint8Array | null, name: string): void {
    const look = this.look;
    const w = Math.min(380, f.width - 16);
    const x = f.width - w - 8;
    const y0 = 8;
    const h = f.height - 16;
    const inner = w - PAD * 2;
    const lh = lineHeight(S_LABEL);
    f.add(KEY_CREATOR_PANEL, K_PANEL, x, y0, w, h, S_PANEL);
    f.text(KEY_CREATOR_TITLE, x + PAD, y0 + PAD, inner, S_TITLE, `New survivor: ${name}`.slice(0, Math.floor(inner / (18 * 0.6))));
    let y = y0 + PAD + lineHeight(S_TITLE) + 6;
    const button = (key: number, bx: number, bw: number, text: string, chosen = false, bh = ROW): void => {
      const b = f.add(key, K_BUTTON, bx, y, bw, bh, S_BUTTON);
      b.text = text;
      b.interactive = true;
      if (chosen) b.tint = CHOSEN;
    };
    const across = (key: number, labels: readonly string[], chosen: number): void => {
      const gap = 4;
      const bw = (inner - gap * (labels.length - 1)) / labels.length;
      labels.forEach((text, i) => button(key + i, x + PAD + i * (bw + gap), bw, text, i === chosen));
      y += ROW + 6;
    };
    across(KEY_CREATOR_TAB, ["Look", "Body"], this.tab);

    if (this.tab === TAB_LOOK) {
      let label = 0;
      let mark = 0;
      const section = (text: string): void => {
        f.text(KEY_CREATOR_LABEL + label++, x + PAD, y, inner, S_LABEL, text);
        y += lh + 2;
      };
      const swatches = (key: number, base: number, count: number, chosen: number): void => {
        const gap = 3;
        const sw = (inner - gap * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
          const sx = x + PAD + i * (sw + gap);
          if (i === chosen) f.add(KEY_CREATOR_MARK + mark, K_PANEL, sx - 2, y - 2, sw + 4, ROW + 4, S_MARK_SELF);
          const s = f.add(key + i, K_BUTTON, sx, y, sw, ROW, S_SWATCH);
          s.interactive = true;
          const at = (base + i) * 4;
          s.tint = palette ? (palette[at]! << 16) | (palette[at + 1]! << 8) | palette[at + 2]! : 0x808080;
        }
        mark++;
        y += ROW + 8;
      };
      section("Sex");
      across(KEY_CREATOR_SEX, SEX_LABELS, look[LOOK_SEX]!);
      section("Skin");
      swatches(KEY_CREATOR_SKIN, SKIN_BASE, SKIN_TONES, look[LOOK_SKIN]!);
      section("Hair colour");
      swatches(KEY_CREATOR_HAIR_COLOR, HAIR_BASE, HAIR_COLORS, look[LOOK_HAIR_COLOR]!);
      section("Eyes");
      swatches(KEY_CREATOR_EYE, EYE_BASE, EYE_COLORS, look[LOOK_EYE_COLOR]!);
      section("Hair");
      across(KEY_CREATOR_HAIR, HAIR_STYLES.map((s) => s.label), look[LOOK_HAIR]!);
      section("Beard");
      across(KEY_CREATOR_BEARD, BEARD_STYLES.map((s) => s.label), look[LOOK_BEARD]!);
    } else {
      const labelW = 92;
      const small = 22;
      const barX = x + PAD + labelW + small + 4;
      const barW = inner - labelW - small * 2 - 8;
      const rowH = Math.min(ROW, Math.floor((y0 + h - y - 96) / REGION_COUNT));
      for (let r = 0; r < REGION_COUNT; r++) {
        const key = KEY_CREATOR_REGION + r * 4;
        f.text(key, x + PAD, y + (rowH - lh) / 2, labelW, S_LABEL, REGIONS[r]!.label);
        const down = f.add(key + 1, K_BUTTON, x + PAD + labelW, y + 1, small, rowH - 3, S_BUTTON);
        down.text = "-";
        down.interactive = true;
        slider(f,key+2,barX,y+1,barW,rowH-3,(regionOf(look,r)+1)/2,.05,REGIONS[r]!.label,`${Math.round(regionOf(look,r)*100)}%`);
        const up = f.add(key + 3, K_BUTTON, barX + barW + 4, y + 1, small, rowH - 3, S_BUTTON);
        up.text = "+";
        up.interactive = true;
        y += rowH;
      }
    }

    y = y0 + h - PAD - 34 - 6 - ROW - (this.refused ? lh + 4 : 0);
    if (this.refused) {
      f.text(KEY_CREATOR_NOTE, x + PAD, y, inner, S_LABEL, "The server would not make it. Try again.");
      y += lh + 4;
    }
    const quarter = (inner - 12) / 4;
    button(KEY_CREATOR_TURN, x + PAD, quarter, "<");
    button(KEY_CREATOR_TURN + 1, x + PAD + quarter + 4, quarter, ">");
    button(KEY_CREATOR_RANDOM, x + PAD + (quarter + 4) * 2, quarter, "Random");
    button(KEY_CREATOR_RESET, x + PAD + (quarter + 4) * 3, quarter, "Reset");
    y += ROW + 6;
    const create = f.add(KEY_CREATOR_CREATE, K_BUTTON, x + PAD, y, inner, 34, S_BUTTON);
    create.text = "Create survivor";
    create.interactive = true;
    create.tint = 0x2f7a46;
  }

  /** Sets `refused` from the answer to the "Create" command. Other results are ignored. */
  result(seq: number, code: number): void {
    if (seq === this.sent && seq !== 0) this.refused = code !== RESULT_OK;
  }

  value(key: number, value: number): boolean {
    const index=key-KEY_CREATOR_REGION;
    if(index<0 || index>=REGION_COUNT*4 || index%4!==2 || !Number.isFinite(value))return false;
    setRegion(this.look,index>>2,Math.max(0,Math.min(1,value))*2-1); return true;
  }

  /** `kind` is 0 for down, 1 for up, 2 for move. Returns true if `key` is one of this screen's nodes. */
  pointer(kind: number, key: number, _x: number, _y: number, _button: number, c: ScreenCtx): boolean {
    const session = c.session;
    if (!session || key < KEY_CREATOR_PANEL || key >= KEY_CREATOR_REGION + REGION_COUNT * 4) return false;
    const look = this.look;
    if (kind !== 0) return true;
    const region = key >= KEY_CREATOR_REGION ? Math.floor((key - KEY_CREATOR_REGION) / 4) : -1;
    const part = key >= KEY_CREATOR_REGION ? (key - KEY_CREATOR_REGION) % 4 : -1;
    if (region >= 0) {
      if (part === 1) setRegion(look, region, regionOf(look, region) - STEP);
      else if (part === 3) setRegion(look, region, regionOf(look, region) + STEP);
      return true;
    }
    const pick = (base: number, count: number, field: number): boolean => {
      if (key < base || key >= base + count) return false;
      look[field] = key - base;
      return true;
    };
    if (key === KEY_CREATOR_TAB || key === KEY_CREATOR_TAB + 1) this.tab = key - KEY_CREATOR_TAB;
    else if (key === KEY_CREATOR_TURN) this.turn -= TURN_STEP;
    else if (key === KEY_CREATOR_TURN + 1) this.turn += TURN_STEP;
    else if (key === KEY_CREATOR_RANDOM) {
      // Seeded by the name, so a run can be repeated. Each press takes the next throw.
      this.rng ??= new Rng(hashString(session.name));
      randomLook(this.rng, look);
    } else if (key === KEY_CREATOR_RESET) defaultLook(look);
    else if (key === KEY_CREATOR_CREATE) {
      this.refused = false;
      this.sent = session.create(look);
    } else if (pick(KEY_CREATOR_SEX, SEX_LABELS.length, LOOK_SEX)) {
      // Choosing a sex other than the first clears the beard.
      if (look[LOOK_SEX] !== 0) look[LOOK_BEARD] = 0;
    } else if (
      !pick(KEY_CREATOR_SKIN, SKIN_TONES, LOOK_SKIN) &&
      !pick(KEY_CREATOR_HAIR_COLOR, HAIR_COLORS, LOOK_HAIR_COLOR) &&
      !pick(KEY_CREATOR_EYE, EYE_COLORS, LOOK_EYE_COLOR) &&
      !pick(KEY_CREATOR_HAIR, HAIR_STYLES.length, LOOK_HAIR)
    ) {
      pick(KEY_CREATOR_BEARD, BEARD_STYLES.length, LOOK_BEARD);
    }
    return true;
  }
}
