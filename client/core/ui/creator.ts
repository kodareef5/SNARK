// Edits a look (shared/anim/look.ts). The app draws it on a body at the spawn point from `look` and `turn`.
// Nothing is sent until "Create", which sends the look to the server once. Offered a remake (OWN_REMAKE), it opens on the
// survivor's own look, its hair as grown, and sends the remake or keeps the survivor as it is.

import {
  BEARD_STYLES, FACE_COUNT, HAIR_STYLES, LOOK_BEARD, LOOK_EYE_COLOR, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_SEX, LOOK_SKIN, REGIONS, REGION_COUNT, SEX_LABELS,
  defaultLook, faceOf, randomLook, regionOf, setFace, setRegion,
} from "../../../shared/anim/look.ts";
import { hashString } from "../../../shared/hash.ts";
import { EYE_BASE, EYE_COLORS, HAIR_BASE, HAIR_COLORS, SKIN_BASE, SKIN_TONES } from "../../../shared/pack/palette.ts";
import { Rng } from "../../../shared/rng.ts";
import { RESULT_OK, SESSION_ALIVE, SESSION_CREATING } from "../../../shared/net/protocol.ts";
import { FACE_GROUPS, FACE_LABELS, FACE_PRESETS, randomFace, resetFace, setFaces } from "../../../shared/people/face-controls.ts";
import { bakeHair } from "../../../shared/people/hair.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { S_BUTTON, S_LABEL, S_MARK_SELF, S_PANEL, S_SWATCH, S_TITLE } from "./style.ts";
import { slider } from "./slider.ts";

export const KEY_CREATOR_PANEL = 3000;
export const KEY_CREATOR_TITLE = 3001;
/** Three keys, one per tab: look, body, face. */
export const KEY_CREATOR_TAB = 3002;
export const KEY_CREATOR_SEX = 3010;
/** Two keys: turn the body left, turn it right. */
export const KEY_CREATOR_TURN = 3012;
export const KEY_CREATOR_RANDOM = 3014;
export const KEY_CREATOR_RESET = 3015;
export const KEY_CREATOR_CREATE = 3016;
export const KEY_CREATOR_NOTE = 3017;
/** Ends a remake with the survivor as it was. */
export const KEY_CREATOR_KEEP = 3018;
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
/** Per face modifier, 3300 to 3427: its label, a button down, its bar, a button up. */
export const KEY_CREATOR_FACE = 3300;
/** One key per face preset, 3430 to 3439. */
export const KEY_CREATOR_FACE_PRESET = 3430;
/** One key per face group, 3440 to 3449. */
export const KEY_CREATOR_FACE_GROUP = 3440;
/** A random face and a neutral face, leaving the rest of the look. */
export const KEY_CREATOR_FACE_RANDOM = 3450;
export const KEY_CREATOR_FACE_RESET = 3451;
const KEY_CREATOR_END = KEY_CREATOR_FACE_RESET + 1;

const PAD = 12;
const ROW = 24;
/** One press of a region's button moves it this far, on a scale of -1 to 1. */
const STEP = 0.1;
/** A twelfth of a turn per press. */
const TURN_STEP = Math.PI / 6;
const CHOSEN = 0x3f6ea8;

const TAB_LOOK = 0;
const TAB_BODY = 1;
const TAB_FACE = 2;

/** In the creator: making a new survivor, or remaking its own while alive. */
export function inCreator(s: ClientSession | null): boolean {
  return s !== null && (s.sessionState === SESSION_CREATING || (s.remaking === true && s.sessionState === SESSION_ALIVE));
}

export class CreatorScreen implements Screen {
  readonly name = "creator";
  readonly layer = "modal";
  /** A press on it makes no click: it is the whole interface, turned and dragged. */
  readonly quiet = true;
  readonly bands = [{ from: KEY_CREATOR_PANEL, count: KEY_CREATOR_END - KEY_CREATOR_PANEL }];
  readonly look = defaultLook();
  tab = TAB_LOOK;
  /** The face group the face tab shows. */
  faceGroup = 0;
  /** Radians. The body starts facing the viewer, a little to one side. */
  turn = 0.35;
  /** The server refused the last "Create". `sent` is that command's sequence number. */
  refused = false;
  private sent = 0;
  private rng: Rng | null = null;
  /** The session it last read: the screen is up while that session is in the creator. */
  private session: ClientSession | null = null;
  /** Open on a remake, whose look it was filled with. */
  private remaking = false;

  isOpen(): boolean {
    return inCreator(this.session);
  }

  absorb(c: ScreenCtx): void {
    this.session = c.session;
    const remaking = inCreator(c.session) && c.session!.remaking;
    if (remaking && !this.remaking && c.session!.ownLook) {
      this.look.set(c.session!.ownLook);
      bakeHair(this.look, c.session!.ownHairFrom, c.session!.serverTick, c.session!.hairRate);
      this.refused = false;
    }
    this.remaking = remaking;
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
    f.text(KEY_CREATOR_TITLE, x + PAD, y0 + PAD, inner, S_TITLE, `${this.remaking ? "Remake" : "New survivor"}: ${name}`.slice(0, Math.floor(inner / (18 * 0.6))));
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
    across(KEY_CREATOR_TAB, ["Look", "Body", "Face"], this.tab);
    let label = 0;
    const section = (text: string): void => {
      f.text(KEY_CREATOR_LABEL + label++, x + PAD, y, inner, S_LABEL, text);
      y += lh + 2;
    };
    /** Buttons in rows of `per`. */
    const grid = (key: number, labels: readonly string[], per: number, chosen: number): void => {
      for (let i = 0; i < labels.length; i += per) {
        const row = labels.slice(i, i + per);
        const gap = 4;
        const bw = (inner - gap * (per - 1)) / per;
        row.forEach((text, k) => button(key + i + k, x + PAD + k * (bw + gap), bw, text, i + k === chosen));
        y += ROW + 6;
      }
    };
    /** A row of label, down, bar and up per value, keys `key + i * 4` on. */
    const sliders = (key: number, labels: readonly string[], values: readonly number[], labelW: number, rowH: number): void => {
      const small = 22;
      const barX = x + PAD + labelW + small + 4;
      const barW = inner - labelW - small * 2 - 8;
      labels.forEach((text, i) => {
        const k = key + i * 4, v = values[i]!;
        f.text(k, x + PAD, y + (rowH - lh) / 2, labelW, S_LABEL, text);
        const down = f.add(k + 1, K_BUTTON, x + PAD + labelW, y + 1, small, rowH - 3, S_BUTTON);
        down.text = "-";
        down.interactive = true;
        slider(f, k + 2, barX, y + 1, barW, rowH - 3, (v + 1) / 2, 0.05, text, `${Math.round(v * 100)}%`);
        const up = f.add(k + 3, K_BUTTON, barX + barW + 4, y + 1, small, rowH - 3, S_BUTTON);
        up.text = "+";
        up.interactive = true;
        y += rowH;
      });
    };

    if (this.tab === TAB_LOOK) {
      let mark = 0;
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
    } else if (this.tab === TAB_BODY) {
      const rowH = Math.min(ROW, Math.floor((y0 + h - y - 96) / REGION_COUNT));
      sliders(KEY_CREATOR_REGION, REGIONS.map((r) => r.label), REGIONS.map((_, r) => regionOf(look, r)), 92, rowH);
    } else {
      // Thirty-two rows do not fit at a readable size, so the face is paged by group.
      section("Presets");
      grid(KEY_CREATOR_FACE_PRESET, FACE_PRESETS.map((p) => p.label), 4, -1);
      section("Features");
      grid(KEY_CREATOR_FACE_GROUP, FACE_GROUPS.map((g) => g.short), 4, this.faceGroup);
      const group = FACE_GROUPS[this.faceGroup]!;
      section(group.label);
      const first = group.faces[0]!;
      sliders(KEY_CREATOR_FACE + first * 4, group.faces.map((i) => FACE_LABELS[i]!), group.faces.map((i) => faceOf(look, i)), 112, ROW);
      y += 6;
      const half = (inner - 4) / 2;
      button(KEY_CREATOR_FACE_RANDOM, x + PAD, half, "Random face");
      button(KEY_CREATOR_FACE_RESET, x + PAD + half + 4, half, "Reset face");
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
    const keep = this.remaking ? Math.floor(inner / 3) : 0;
    const create = f.add(KEY_CREATOR_CREATE, K_BUTTON, x + PAD, y, inner - (keep > 0 ? keep + 4 : 0), 34, S_BUTTON);
    create.text = this.remaking ? "Remake survivor" : "Create survivor";
    create.interactive = true;
    create.tint = 0x2f7a46;
    if (keep > 0) {
      const as = f.add(KEY_CREATOR_KEEP, K_BUTTON, x + PAD + inner - keep, y, keep, 34, S_BUTTON);
      as.text = "Keep as is";
      as.interactive = true;
    }
  }

  /** Sets `refused` from the answer to the "Create" command. Other results are ignored. */
  result(seq: number, code: number): void {
    if (seq === this.sent && seq !== 0) this.refused = code !== RESULT_OK;
  }

  value(key: number, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    const v = Math.max(0, Math.min(1, value)) * 2 - 1;
    const region = key - KEY_CREATOR_REGION, face = key - KEY_CREATOR_FACE;
    if (region >= 0 && region < REGION_COUNT * 4 && region % 4 === 2) setRegion(this.look, region >> 2, v);
    else if (face >= 0 && face < FACE_COUNT * 4 && face % 4 === 2) setFace(this.look, face >> 2, v);
    else return false;
    return true;
  }

  /** `kind` is 0 for down, 1 for up, 2 for move. Returns true if `key` is one of this screen's nodes. */
  pointer(kind: number, key: number, _x: number, _y: number, _button: number, c: ScreenCtx): boolean {
    const session = c.session;
    if (!session || key < KEY_CREATOR_PANEL || key >= KEY_CREATOR_END) return false;
    const look = this.look;
    if (kind !== 0) return true;
    if (key >= KEY_CREATOR_REGION && key < KEY_CREATOR_REGION + REGION_COUNT * 4) {
      const region = (key - KEY_CREATOR_REGION) >> 2, part = (key - KEY_CREATOR_REGION) % 4;
      if (part === 1) setRegion(look, region, regionOf(look, region) - STEP);
      else if (part === 3) setRegion(look, region, regionOf(look, region) + STEP);
      return true;
    }
    if (key >= KEY_CREATOR_FACE && key < KEY_CREATOR_FACE + FACE_COUNT * 4) {
      const face = (key - KEY_CREATOR_FACE) >> 2, part = (key - KEY_CREATOR_FACE) % 4;
      if (part === 1) setFace(look, face, faceOf(look, face) - STEP);
      else if (part === 3) setFace(look, face, faceOf(look, face) + STEP);
      return true;
    }
    // Seeded by the name, so a run can be repeated. Each press takes the next throw.
    const rng = (): Rng => (this.rng ??= new Rng(hashString(session.name)));
    const pick = (base: number, count: number, field: number): boolean => {
      if (key < base || key >= base + count) return false;
      look[field] = key - base;
      return true;
    };
    if (key >= KEY_CREATOR_TAB && key <= KEY_CREATOR_TAB + TAB_FACE) this.tab = key - KEY_CREATOR_TAB;
    else if (key >= KEY_CREATOR_FACE_PRESET && key < KEY_CREATOR_FACE_PRESET + FACE_PRESETS.length) setFaces(look, FACE_PRESETS[key - KEY_CREATOR_FACE_PRESET]!.values);
    else if (key >= KEY_CREATOR_FACE_GROUP && key < KEY_CREATOR_FACE_GROUP + FACE_GROUPS.length) this.faceGroup = key - KEY_CREATOR_FACE_GROUP;
    else if (key === KEY_CREATOR_FACE_RANDOM) randomFace(rng(), look);
    else if (key === KEY_CREATOR_FACE_RESET) resetFace(look);
    else if (key === KEY_CREATOR_TURN) this.turn -= TURN_STEP;
    else if (key === KEY_CREATOR_TURN + 1) this.turn += TURN_STEP;
    else if (key === KEY_CREATOR_RANDOM) {
      const r = rng();
      randomFace(r, randomLook(r, look));
    } else if (key === KEY_CREATOR_RESET) defaultLook(look);
    else if (key === KEY_CREATOR_CREATE) {
      this.refused = false;
      this.sent = this.remaking ? session.remake(look) : session.create(look);
    } else if (key === KEY_CREATOR_KEEP && this.remaking) this.sent = session.remake(null);
    else if (
      !pick(KEY_CREATOR_SEX, SEX_LABELS.length, LOOK_SEX) &&
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
