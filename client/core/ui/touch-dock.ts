// The touch rims: the menu wheel at the left edge, the action fan at the right, and the equipment shelf at the foot.
// They move as the interface study's did: a thumb turns a wheel under it, and each opens and settles on a spring.
// Lengths here are CSS pixels inside the device's safe area; `put` turns them into the frame's units.

import { HOTBAR_SLOTS } from "../../../shared/sim/items.ts";
import { KEY_HOTBAR, KEY_HOTBAR_LIT, KEY_HOTBAR_RAIL, type HotbarModel } from "../hud/hotbar.ts";
import { K_BUTTON, K_HOLD, K_IMAGE, K_PANEL, fitText, textWidth, type UiFrame, type UiNode } from "./nodes.ts";
import { S_HUD_HIT, S_HUD_KEY, S_ICE, S_LABEL, addStyles } from "./style.ts";
import { ICON, ICON_COLUMNS, ICON_Y, IMAGE_TOUCH, I_PLUS, TOUCH_HEIGHT, TOUCH_URL, TOUCH_WIDTH, touchPixels } from "./touch-art.ts";
import { FAN_SPREAD, clamp, fanShape, glass, paintFan, paintPlate, paintShelf, paintWheel, repaint, turn, wrap, type FanView, type Glass } from "./touch-glass.ts";

const TAU = Math.PI * 2;
const IMAGE_WHEEL = 42, IMAGE_FAN = 43, IMAGE_SHELF = 44, IMAGE_PLATE = 45;
/** A name over a rim, and the family's name in small above a leaf's. */
const S_RIM_NAME = addStyles([
  { fill: 0, ink: 0xeef7ff, font: 13, align: 1, shadow: true, sans: true },
  { fill: 0, ink: 0xb6d4e7, font: 9, align: 1, shadow: true, sans: true },
]);
const S_RIM_PARENT = S_RIM_NAME + 1;

/** What the shelf draws from, which the rims set each frame (HotbarModel.dockBelt). */
export interface BeltView {
  /** The slot at the shelf's middle, and how far the shelf has slid with the thumb. */
  phase: number;
  shift: number;
  /** 0 at rest, 1 raised under a thumb. */
  lift: number;
  /** Where the thumb is along the shelf, or null. */
  focus: number | null;
  preview: number;
  /** Another rim is in use. */
  dim: boolean;
}

const shelf = glass(), plate = glass();

/** A picture `g` painted over the box, in CSS pixels. */
function painted(f: UiFrame, key: number, slot: number, g: Glass, x: number, y: number, w: number, h: number, alpha: number): void {
  f.images[slot] = g.image;
  const n = f.add(key, K_IMAGE, x / f.unit, y / f.unit, w / f.unit, h / f.unit, S_LABEL);
  n.image = slot; n.alpha = alpha;
}

/** A name on its plate, centred on `cx` with its top at `y`, in CSS pixels. `over` is a smaller line above it. */
function nameplate(f: UiFrame, key: number, cx: number, y: number, text: string, alpha: number, over = ""): void {
  if (alpha <= 0.01 || !text) return;
  const u = f.unit, high = over ? 31 : 24;
  const w = Math.max(textWidth(text, S_RIM_NAME), textWidth(over, S_RIM_PARENT)) * u + 34;
  const x = clamp(cx - w / 2, 2, Math.max(2, f.width * u - w - 2));
  repaint(plate, 64, 8, "plate", (c) => paintPlate(c, 64, 8, .2, .1));
  painted(f, key, IMAGE_PLATE, plate, x, y, w, high, alpha);
  if (over) f.text(key + 2, x / u, (y + 3) / u, w / u, S_RIM_PARENT, over).alpha = alpha;
  f.text(key + 1, x / u, (y + (over ? 12 : 3)) / u, w / u, S_RIM_NAME, text).alpha = alpha;
}

function beltShape(f: UiFrame) {
  const u = f.unit, W = f.width * u, H = f.height * u;
  const w = W < H ? Math.min(W * .82, 528) : H <= 540 ? Math.min(W * .63, 560) : Math.min(W * .71, 800);
  const pitch = clamp(w * .066, 44, 50);
  return { w, pitch, travel: clamp(w / 9.3, 49, 80), left: W / 2 - w / 2, foot: H - f.bottom * u, reach: (w < 390 ? 2.55 : 3.55) * pitch };
}

/** The shelf and what stands on it. Each picture's box (KEY_HOTBAR + 3i) is what a thumb presses. */
export function drawBelt(f: UiFrame, m: HotbarModel): void {
  const u = f.unit, { w, pitch, left, foot, reach } = beltShape(f), n = m.hotbar.length;
  const view = m.dockBelt, lift = view?.lift ?? 0, dim = view?.dim ? .38 : 1;
  const half = Math.min(w / 2 - 2, reach + 12 * lift);
  const phase = (view?.phase ?? Math.max(0, m.held)) - (view?.shift ?? 0) / pitch;
  const focus = view?.focus ?? w / 2 + turn(phase, view?.preview ?? Math.max(0, m.held), n) * pitch;
  const high = 8 + 10 * lift;
  repaint(shelf, 2 * half, high, `${half.toFixed(1)}/${high.toFixed(1)}`, (c) => paintShelf(c, 2 * half, high));
  painted(f, KEY_HOTBAR_RAIL, IMAGE_SHELF, shelf, left + w / 2 - half, foot - 3 - high, 2 * half, high, (.67 + .33 * lift) * dim);
  let nameX = focus, nameFoot = 0;
  for (let i = 0; i < n; i++) {
    const slot = m.hotbar[i]!, chosen = i === m.held;
    const baseX = w / 2 + turn(phase, i, n) * pitch, delta = (baseX - focus) / pitch;
    const near = Math.max(0, 1 - Math.abs(delta) / 1.9), lens = lift * near * near * (3 - 2 * near);
    const x = baseX + clamp(delta, -1, 1) * Math.max(0, 1 - Math.abs(delta) / 4) * 10 * lift;
    const edge = half - Math.abs(x - w / 2);
    if (edge <= 3) continue;
    const size = (chosen ? 23 : 17) + 4 * lift + 29 * lens, footing = 7 + (chosen ? 1 : 0) + 3 * lift + 10 * lens;
    const alpha = clamp(edge / 20, 0, 1) * (chosen ? .99 : .8 + .2 * lens) * dim;
    const key = KEY_HOTBAR + i * 3, boxW = Math.min(Math.max(44, size + 2), pitch), boxH = Math.max(44, footing + size + 2);
    // A slot fading out at the shelf's end is not pressed.
    if (edge >= 21) f.add(key, K_PANEL, (left + x - boxW / 2) / u, (foot - boxH) / u, boxW / u, boxH / u, S_HUD_HIT);
    if (chosen) dash(f, KEY_HOTBAR_LIT + i, left + x - 4.5, foot - 7, 9, 3, 0x90e8ff, alpha);
    const px = (left + x - size / 2) / u, py = (foot - footing - size) / u;
    // An empty slot shows where a thing would stand.
    if (slot.tint < 0) glyph(f, key + 1, I_PLUS, left + x, foot - footing - size * .5, size * .8).alpha = .4 * alpha;
    else {
      const pic = f.picture(key + 1, px, py, size / u, size / u, S_LABEL, slot.id ?? "");
      if (pic) pic.alpha = alpha;
      else f.text(key + 1, (left + x - 22) / u, py, 44 / u, S_HUD_KEY, fitText(slot.label, 44 / u, S_HUD_KEY)).alpha = alpha;
    }
    if (i === view?.preview) { nameX = x; nameFoot = footing + size + 4; }
  }
  if (view && view.focus !== null && view.preview >= 0) {
    const slot = m.hotbar[view.preview];
    nameplate(f, KEY_HOTBAR_RAIL + 5, left + clamp(nameX, 43, w - 43), foot - nameFoot - 24, slot?.name || slot?.label || "Empty slot", clamp((lift - .55) / .45, 0, 1));
  }
}

function dash(f: UiFrame, key: number, x: number, y: number, w: number, h: number, tint: number, alpha: number): void {
  const n = f.add(key, K_PANEL, x / f.unit, y / f.unit, w / f.unit, h / f.unit, S_ICE);
  n.tint = tint; n.alpha = alpha;
}

/** `art` is "ui:glass-" and a name, or "glyph-" and a glyph of the touch sheet. `hold` is the key it stands for under a finger. */
export interface RimLeaf {
  readonly id: string; readonly label: string; readonly art: string; readonly hold?: string;
  /** A setting, not an action: choosing it leaves the rim as it was. */
  readonly setting?: boolean;
}

/** A leaf's picture, `size` across about `x`, `y`, in CSS pixels. Null where the build has none. */
function leafArt(f: UiFrame, key: number, leaf: RimLeaf, x: number, y: number, size: number): UiNode | null {
  const u = f.unit;
  if (!leaf.art.startsWith("glyph-")) return f.picture(key, (x - size / 2) / u, (y - size / 2) / u, size / u, size / u, S_LABEL, "ui:glass-" + leaf.art);
  return glyph(f, key, Number(leaf.art.slice(6)), x, y, size);
}

/** Glyph `which` of the touch sheet. A glyph fills less of its cell than a painted thing does, so it is drawn a little over. */
function glyph(f: UiFrame, key: number, which: number, x: number, y: number, size: number): UiNode {
  f.images[IMAGE_TOUCH] ??= TOUCH_URL ? { width: TOUCH_WIDTH, height: TOUCH_HEIGHT, data: new Uint8ClampedArray(0), version: 0, url: TOUCH_URL, smooth: true } : touchPixels();
  const u = f.unit, side = size * 1.1;
  const n = f.add(key, K_IMAGE, (x - side / 2) / u, (y - side / 2) / u, side / u, side / u, S_LABEL);
  n.image = IMAGE_TOUCH;
  n.sx = (which % ICON_COLUMNS) * ICON; n.sy = ICON_Y + Math.floor(which / ICON_COLUMNS) * ICON; n.sw = n.sh = ICON;
  return n;
}

/** What the rims ask of the dock that owns them: its keys, its lists, and what a choice does. */
export interface RimHost {
  /** The two hubs (left at +0, right at +3), a rim's stations, the rims' own nodes (20 of them), and the shelf's slots. */
  readonly hubs: number;
  readonly leaves: number;
  readonly rims: number;
  readonly slots: number;
  menu(): readonly RimLeaf[];
  families(): readonly RimLeaf[];
  leavesOf(family: number): readonly RimLeaf[];
  available(leaf: RimLeaf): boolean;
  run(leaf: RimLeaf): void;
  /** Holds a leaf's key down, or lets it go. */
  hold(code: string, down: boolean): void;
  /** Slot `slot` was chosen on the shelf, by a slide or by a tap. */
  equip(slot: number, slid: boolean): void;
}

type Side = "left" | "action" | "bottom";
interface Contact {
  finger: number; host: Side; key: number;
  x: number; y: number;
  /** When it came down. */
  since: number;
  moved: boolean;
  // The wheel.
  wasOpen: boolean; phase: number; station: number; hub: boolean; first: number; last: number | null; travel: number;
  scrub: boolean; out: boolean; centre: boolean; dy: number;
  // The fan and the shelf.
  axis: "" | "x" | "y"; depth: number; group: number; leaf: number; family: number; child: number; isHub: boolean;
  origin: number; local: number; offset: number;
}

/** How long a thumb rests on the rim before its key goes down, in milliseconds. A quicker tap is a press and release. */
const HOLD_AFTER = 80;
const KEY_EDGE = 6, KEY_DISC = 7, KEY_FACE = 8, KEY_FAMILY = 10;

export class TouchRims {
  /** The rim in use, if any. */
  mode: Side | null = null;
  /** The slot under a thumb on the shelf, or -1. */
  preview = -1;
  private contact: Contact | null = null;
  private clock = -1;
  private now = 0;
  // The wheel: how far out it is, the station at three o'clock, and each one's speed and target.
  private reveal = 0; private revealV = 0; private target = 0;
  private phase = 0; private phaseV = 0; private phaseTo = 0;
  private releaseAt = 0; private rest = 0;
  private cx = 0; private cy = 0; private r = 1;
  // The fan.
  private depth = -1; private group = 0; private leaf = 0;
  private rootPhase = 0; private rootTo = 0; private leafPhase = 0; private leafTo = 0;
  /** The leaf the shut rim stands for: a tap there does it, and choosing another on the fan puts that one in its place. */
  private armedGroup = 0; private armedLeaf = 0;
  /** Lets go of the key a thumb on the rim holds, if one does; and how lit the rim's cell is under it. */
  private release: (() => void) | null = null;
  private pressed = 0;
  private openness = 0; private level = 0; private fanDrop = 0; private placed = false; private ease = 1;
  // The shelf.
  private belt = 0; private beltTo = 0; private lift = 0; private shift = 0; private kept = 0; private heldSeen = -2;
  private readonly view: BeltView = { phase: 0, shift: 0, lift: 0, focus: null, preview: -1, dim: false };
  private readonly wheelGlass = glass();
  private readonly fanGlass = glass();

  /** The dock's page for what is open: the menu, the families, or a family by its place. */
  page(h: RimHost): string | null {
    if (this.mode === "left") return "emblem";
    if (this.mode !== "action") return null;
    return this.depth === 1 ? h.families()[this.group]?.id ?? "actions" : "actions";
  }

  /** Puts every rim away at once. */
  reset(): void {
    this.shut();
    this.pressed = 0;
    this.reveal = this.revealV = this.openness = this.level = this.lift = this.shift = 0;
    this.phase = this.phaseTo; this.phaseV = 0;
    this.rootPhase = this.rootTo; this.leafPhase = this.leafTo;
    this.clock = -1; this.placed = false;
  }

  /** Lets go and shuts what is open; the rims settle back on their springs. */
  shut(h?: RimHost): void {
    this.contact = null; this.mode = null; this.preview = -1;
    this.letKey();
    this.target = 0; this.releaseAt = 0;
    const stations = h?.menu().length ?? 0;
    if (stations) this.phaseTo = this.phase + turn(this.phase, this.rest, stations);
    this.depth = -1;
    // Shut, the fan rests on the family and the leaf its rim stands for.
    this.group = this.armedGroup; this.leaf = this.armedLeaf;
    const families = h?.families().length ?? 0, leaves = h?.leavesOf(this.group).length ?? 0;
    if (families) this.rootTo = this.rootPhase + turn(this.rootPhase, this.group, families);
    this.leafTo = leaves ? this.leafPhase + turn(this.leafPhase, this.leaf, leaves) : Math.round(this.leafTo);
  }

  private letKey(): void {
    this.release?.();
    this.release = null;
  }

  private armed(h: RimHost): RimLeaf | undefined {
    return h.leavesOf(this.armedGroup)[this.armedLeaf];
  }

  private step(now: number, held: number, slots: number, h: RimHost): void {
    const ms = this.clock < 0 ? 16 : clamp(now - this.clock, 1, 36);
    this.clock = this.now = now;
    const dt = clamp(ms / 1000, .003, .029), d = this.contact;
    // A thumb resting on the rim holds its key down. Not at once: a pull or a turn starts as a touch too, and is no press.
    if (d?.host === "action" && d.depth < 0 && this.depth < 0 && !d.axis && !this.release && now - d.since >= HOLD_AFTER) {
      const armed = this.armed(h), code = armed?.hold;
      if (code && h.available(armed!)) {
        h.hold(code, true);
        this.release = () => h.hold(code, false);
      }
    }
    if (this.releaseAt && now >= this.releaseAt) { this.releaseAt = 0; this.target = 0; }
    const turning = d?.host === "left" && d.moved;
    [this.reveal, this.revealV] = spring(this.reveal, this.revealV, this.target, dt, turning ? 750 : 580, turning ? 39 : 32);
    [this.phase, this.phaseV] = spring(this.phase, this.phaseV, this.phaseTo, dt, turning ? 950 : 660, turning ? 43 : 34);
    const k = this.ease = 1 - Math.exp(-ms / (d ? 41 : 70));
    const near = (v: number, to: number): number => Math.abs(to - v) < .002 ? to : v + (to - v) * k;
    if (slots && this.mode !== "bottom") {
      // The shelf rests on what is in hand, and where the hand is empty, on what it last held.
      if (held !== this.heldSeen) { this.heldSeen = held; if (held >= 0) this.kept = held; }
      this.beltTo = this.belt + turn(this.belt, this.kept, slots);
    }
    this.belt = near(this.belt, this.beltTo);
    this.rootPhase = near(this.rootPhase, this.rootTo);
    this.leafPhase = near(this.leafPhase, this.leafTo);
    this.openness = near(this.openness, this.depth >= 0 ? 1 : 0);
    this.level = near(this.level, this.depth === 1 ? 1 : 0);
    this.lift = near(this.lift, this.mode === "bottom" ? 1 : 0);
    this.pressed = near(this.pressed, d?.host === "action" && d.depth < 0 && this.depth < 0 ? 1 : 0);
    this.shift = near(this.shift, d?.host === "bottom" ? d.local - d.origin : 0);
  }

  private side(key: number, h: RimHost): Side | null {
    if (key === h.hubs || key === h.rims + KEY_DISC || key === h.rims + KEY_EDGE) return "left";
    if (key === h.hubs + 3 || key === h.rims + KEY_FACE || (key >= h.rims + KEY_FAMILY && key < h.rims + 20)) return "action";
    if (key >= h.slots && key < h.slots + HOTBAR_SLOTS) return "bottom";
    if (key >= h.leaves && key < h.leaves + 40) return this.mode === "left" ? "left" : this.mode === "action" ? "action" : null;
    return null;
  }

  /** A press on a rim: `kind` 0 down, 1 up, 2 moved, 3 cancelled, at `x`, `y` in units. False for a key that is no rim's. */
  pointer(kind: number, key: number, x: number, y: number, finger: number, f: UiFrame, h: RimHost): boolean {
    const d = this.contact, px = x * f.unit, py = y * f.unit;
    if (kind !== 0) {
      if (!d) return this.side(key, h) !== null;
      if (d.finger !== finger) return true;
      if (kind === 2 || kind === 1) this.moved(d, px, py, f, h);
      if (kind !== 2) this.lifted(d, px, py, kind === 3, f, h);
      return true;
    }
    const side = this.side(key, h);
    if (!side) return false;
    if (d) return true;
    if (this.mode && this.mode !== side) this.shut(h);
    const c: Contact = {
      finger, host: side, key, x: px, y: py, since: this.now, moved: false,
      wasOpen: this.mode === "left", phase: this.phase, station: -1, hub: false, first: Math.atan2(py - this.cy, px - this.cx), last: null, travel: 0,
      scrub: false, out: false, centre: false, dy: 0,
      axis: "", depth: this.depth, group: this.group, leaf: this.leaf, family: -1, child: -1, isHub: key === h.hubs + 3,
      origin: 0, local: 0, offset: 0,
    };
    const station = key - h.leaves, inRing = station >= 0 && station < 40;
    if (side === "left") {
      if (inRing) c.station = station;
      c.hub = c.wasOpen && Math.hypot(px - this.cx, py - this.cy) < this.r * .36;
    } else if (side === "action") {
      if (key >= h.rims + KEY_FAMILY) c.family = key - h.rims - KEY_FAMILY;
      else if (inRing && this.depth === 1) c.child = station;
      else if (inRing) c.family = station;
    } else {
      const b = beltShape(f), slots = HOTBAR_SLOTS, slot = key - h.slots;
      c.local = c.origin = px - b.left;
      c.phase = this.beltTo;
      c.offset = turn(this.beltTo, slot, slots);
      this.mode = "bottom";
      this.preview = slot;
    }
    this.contact = c;
    // A keyboard's click on a node comes with no place and no release.
    if (finger === 0 && x === 0 && y === 0) this.lifted(c, c.x, c.y, false, f, h);
    return true;
  }

  private moved(d: Contact, px: number, py: number, f: UiFrame, h: RimHost): void {
    const dx = px - d.x, dy = py - d.y;
    if (d.host === "left") {
      if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
      if (!d.moved) return;
      const r = this.r, stations = h.menu().length;
      if (!d.wasOpen) {
        this.mode = "left";
        d.scrub ||= Math.abs(dy) > 13;
        this.target = d.scrub ? 1 : clamp(dx / (r * .74), 0, 1);
        if (d.scrub) { this.phaseTo = d.phase - dy / (r * .41); d.dy = dy; }
        d.out = dx < -9;
        return;
      }
      d.out = dx < -r * .69 && px < f.left * f.unit + 28;
      d.centre = !d.hub && Math.hypot(px - this.cx, py - this.cy) < r * .36;
      if (d.centre) d.last = null;
      else if (!d.hub) {
        const at = Math.atan2(py - this.cy, px - this.cx), by = at - (d.last ?? d.first);
        d.travel += Math.atan2(Math.sin(by), Math.cos(by)); d.last = at;
        d.scrub ||= Math.abs(d.travel) > .095;
        if (d.scrub) this.phaseTo = d.phase - d.travel * stations / TAU;
      }
      this.target = d.out ? .52 : 1;
      return;
    }
    if (!d.axis && Math.hypot(dx, dy) > 8) d.axis = Math.abs(dx) > Math.abs(dy) * .92 ? "x" : "y";
    if (!d.axis) return;
    d.moved = true;
    if (d.host === "bottom") {
      if (d.axis !== "x") return;
      const b = beltShape(f), reach = Math.min(b.w / 2, b.reach) - 26;
      d.local = clamp(d.origin + dx, b.w / 2 - reach, b.w / 2 + reach);
      this.beltTo = d.phase - dx / b.travel;
      this.preview = wrap(Math.round(this.beltTo + d.offset), HOTBAR_SLOTS);
      return;
    }
    const families = h.families().length;
    if (d.depth < 0) {
      // A pull or a turn from the rim is no press of it: the fan comes out on the rim's own family.
      if (this.depth < 0 && (dx < -13 || Math.abs(dy) > 22)) { this.letKey(); this.openFan(); }
      if (d.axis === "y" && this.depth === 1) {
        this.leafTo = d.leaf - dy / 51; this.leaf = wrap(Math.round(this.leafTo), h.leavesOf(this.group).length);
      }
      return;
    }
    if (d.axis !== "y") return;
    if (d.depth === 1) {
      const leaves = h.leavesOf(this.group).length;
      this.leafTo = d.leaf - dy / 51; this.leaf = wrap(Math.round(this.leafTo), leaves);
    } else { this.rootTo = d.group - dy / 51; this.group = wrap(Math.round(this.rootTo), families); }
  }

  private lifted(d: Contact, px: number, py: number, cancelled: boolean, f: UiFrame, h: RimHost): void {
    this.contact = null;
    const dx = px - d.x, dy = py - d.y;
    if (cancelled) return this.shut(h);
    if (d.host === "left") {
      const r = this.r, stations = h.menu().length, far = Math.hypot(px - this.cx, py - this.cy);
      const overHub = this.reveal > .72 && far < r * .36;
      if (d.out || d.centre || (d.wasOpen && d.hub) || (d.scrub && overHub)) return this.shut(h);
      const turned = wrap(Math.round(this.phaseTo), stations);
      if (!d.wasOpen) {
        if (d.scrub && Math.abs(d.dy) > 15) return this.pick(turned, h);
        if (d.moved && this.target < .21) return this.shut(h);
        this.target = 1; this.releaseAt = 0; this.mode = "left";
        return;
      }
      if (d.scrub) return this.pick(turned, h);
      if (d.station >= 0) return this.pick(d.station, h);
      const station = wrap(Math.round(this.phase + Math.atan2(py - this.cy, px - this.cx) * stations / TAU), stations);
      if (far > r * .51) this.pick(station, h); else this.shut(h);
      return;
    }
    if (d.host === "bottom") {
      const slots = HOTBAR_SLOTS, chosen = wrap(Math.round(this.beltTo + d.offset), slots);
      // A thumb that leaves the shelf's row puts nothing in hand.
      if (d.axis === "y" || Math.abs(dy) > 38) return this.shut(h);
      this.kept = chosen;
      this.shut(h);
      h.equip(chosen, d.moved);
      return;
    }
    if (d.depth < 0) {
      if (this.depth < 0) {
        // A tap on the rim does what it stands for: a held key was down all the while, and anything else happens now.
        const armed = this.armed(h);
        if (this.release) this.letKey();
        else if (d.axis === "" && armed && h.available(armed)) h.run(armed);
        return;
      }
      // Turned up or down, the leaf it stopped on is the rim's from now on. Pulled in, the fan stays out.
      if (d.axis === "y") {
        if (!h.leavesOf(this.group)[this.leaf]?.setting) this.armedLeaf = this.leaf;
        this.shut(h);
      } else this.toLeaf(this.leaf, h);
      return;
    }
    if (d.axis === "x") {
      if (dx > 28) this.back(h);
      else if (dx < -28 && d.depth === 0) this.family(d.family >= 0 ? d.family : this.group, true, h);
      else if (dx < -46 && d.depth === 1 && d.child >= 0) this.choose(d.child, h);
      return;
    }
    if (d.axis === "y") { if (d.depth === 1) this.toLeaf(this.leaf, h); else this.family(this.group, false, h); return; }
    if (d.isHub) this.back(h);
    else if (d.family >= 0) this.family(d.family, true, h);
    else if (d.child >= 0 && this.depth === 1) this.choose(d.child, h);
  }

  /** Station `i` of the wheel: it turns to three o'clock, and what it stands for opens as the wheel goes. */
  private pick(i: number, h: RimHost): void {
    const menu = h.menu(), leaf = menu[i];
    if (!leaf) return this.shut(h);
    this.phaseTo = this.phase + turn(this.phase, i, menu.length);
    if (!h.available(leaf)) return;
    this.rest = i;
    this.releaseAt = this.now + 75; this.target = 1;
    this.mode = null;
    h.run(leaf);
  }

  private openFan(): void {
    if (this.depth < 0) {
      this.depth = 1;
      this.group = this.armedGroup; this.rootPhase = this.rootTo = this.group;
      this.leaf = this.armedLeaf; this.leafPhase = this.leafTo = this.leaf;
    }
    this.mode = "action";
  }
  private family(i: number, child: boolean, h: RimHost): void {
    const families = h.families().length;
    this.group = wrap(i, families);
    this.rootTo = this.rootPhase + turn(this.rootPhase, this.group, families);
    this.leaf = 0; this.leafPhase = this.leafTo = 0;
    if (child) this.depth = 1;
  }
  private toLeaf(i: number, h: RimHost): void {
    const leaves = h.leavesOf(this.group).length;
    this.leaf = wrap(i, leaves);
    this.leafTo = this.leafPhase + turn(this.leafPhase, this.leaf, leaves);
  }
  private back(h: RimHost): void {
    if (this.depth === 1) this.depth = 0; else this.shut(h);
  }
  private choose(i: number, h: RimHost): void {
    const leaves = h.leavesOf(this.group), leaf = leaves[wrap(i, leaves.length)];
    if (!leaf || !h.available(leaf)) return this.toLeaf(i, h);
    if (!leaf.setting) { this.armedGroup = this.group; this.armedLeaf = wrap(i, leaves.length); }
    this.shut(h);
    h.run(leaf);
  }

  /** Each frame: the rims move on, the shelf is told what to draw, and the wheel and the fan are drawn with what presses them. */
  play(f: UiFrame, now: number, h: RimHost, m: HotbarModel): void {
    this.step(now, m.held, m.hotbar.length, h);
    const d = this.contact, v = this.view;
    v.phase = this.belt; v.shift = this.shift; v.lift = this.lift;
    v.focus = d?.host === "bottom" ? d.local : null;
    v.preview = this.mode === "bottom" ? this.preview : -1;
    v.dim = this.mode !== null && this.mode !== "bottom";
    m.dockBelt = v;
    m.dockPreview = v.preview;
    this.hits(f, h, m);
    // The rim in use is drawn over the other.
    if (this.mode === "left") { this.fan(f, h); this.wheel(f, h); }
    else { this.wheel(f, h); this.fan(f, h); }
    // A held node must stay while its finger is down, or the page takes the finger away.
    if (d && !f.find(d.key)) hold(f, d.key, d.x, d.y, 1, 1, "", false);
  }

  /** A box a thumb holds over each slot the hotbar drew. */
  private hits(f: UiFrame, h: RimHost, m: HotbarModel): void {
    const drawn = f.count;
    for (let j = 0; j < drawn; j++) {
      const box = f.nodes[j]!, i = (box.key - KEY_HOTBAR) / 3;
      if (box.kind !== K_PANEL || box.key < KEY_HOTBAR || i >= HOTBAR_SLOTS || i !== Math.floor(i)) continue;
      const n = f.add(h.slots + i, K_HOLD, box.x, box.y, box.w, box.h, S_HUD_HIT), slot = m.hotbar[i];
      n.interactive = true; n.label = `Slot ${(i + 1) % 10}: ${slot?.name || slot?.id || slot?.label || "empty"}`;
    }
  }

  private wheel(f: UiFrame, h: RimHost): void {
    const u = f.unit, W = f.width * u, H = f.height * u, menu = h.menu(), count = menu.length;
    if (!count) return;
    const safeL = f.left * u, safeR = f.right * u, safeT = f.top * u, safeB = f.bottom * u;
    const r = this.r = Math.max(60, Math.min(185, (H - safeT - safeB) * .38, W * (W > H ? .21 : .369), (W - safeL - safeR) * .43));
    const cy = this.cy = clamp(H * .556, safeT + r + 8, H - safeB - r - 8);
    const resting = Math.max(-r * .50, safeL + 22 - r * .745), raised = r + Math.max(14, W * .017, safeL + 6);
    const cx = this.cx = resting + (raised - resting) * clamp(this.reveal, -.035, 1.034);
    const open = this.mode === "left", shown = clamp(this.reveal, 0, 1), dim = this.mode && !open ? .30 : 1;
    const selected = wrap(Math.round(this.phase), count), keys = h.rims;
    const phase = this.phase, reveal = this.reveal;
    repaint(this.wheelGlass, 2 * r, 2 * r, `${r.toFixed(1)}/${count}/${phase.toFixed(3)}/${reveal.toFixed(2)}`, (c) => paintWheel(c, r, count, phase, reveal));
    painted(f, keys, IMAGE_WHEEL, this.wheelGlass, cx - r, cy - r, 2 * r, 2 * r, dim);
    if (open) hold(f, keys + KEY_DISC, cx - r, cy - r, 2 * r, 2 * r, "Turn the menu wheel", true);
    else {
      // Shut, the part of the disc inside the edge is the way in: two strips as tall as the glass is at each one's middle.
      const edge = Math.max(safeL, cx - r), deep = cx + r - edge;
      const chord = (x: number): number => Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx)));
      const near = chord(edge + deep * .25), far = chord(edge + deep * .75);
      const [top, foot] = clearOf(f, edge, cy - near, deep, 2 * near, cy);
      if (foot - top >= 24) {
        hold(f, keys + KEY_EDGE, edge, top, deep / 2, foot - top, "Turn the menu wheel", false);
        hold(f, h.hubs, edge + deep / 2, Math.max(top, cy - far), deep / 2, Math.min(foot, cy + far) - Math.max(top, cy - far), "Field menus", false);
      }
    }
    const stationR = r * .753, across = Math.max(44, Math.min(r * .45, 2 * stationR * Math.sin(Math.PI / count) * .96));
    for (let i = 0; i < count; i++) {
      const angle = (i - this.phase) * TAU / count, lit = i === selected, leaf = menu[i]!;
      const x = cx + Math.cos(angle) * stationR, y = cy + Math.sin(angle) * stationR, size = across * (lit ? .88 : .76);
      const pic = leafArt(f, h.leaves + i + 300, leaf, x, y, size);
      if (pic) pic.alpha = ((lit ? .88 : .54) + (lit ? .12 : .37) * shown) * dim * (h.available(leaf) ? 1 : .39);
      if (open) hold(f, h.leaves + i, x - across / 2, y - across / 2, across, across, leaf.label + (h.available(leaf) ? "" : " (unavailable)"), true);
    }
    const hub = Math.max(44, r * .46), mark = hub * .71;
    const emblem = f.picture(h.hubs + 300, (cx - mark / 2) / u, (cy - mark / 2) / u, mark / u, mark / u, S_LABEL, "ui:glass-emblem");
    if (emblem) emblem.alpha = (.45 + .55 * shown) * dim;
    if (open) hold(f, h.hubs, cx - hub / 2, cy - hub / 2, hub, hub, "Field menus", true);
    const under = cy + r + 8;
    nameplate(f, keys + 100, clamp(cx, 85, W - 85), Math.max(3, under + 26 <= H ? under : cy - r - 25), menu[selected]!.label, open ? clamp((this.reveal - .66) / .31, 0, 1) : 0);
  }

  private fan(f: UiFrame, h: RimHost): void {
    const u = f.unit, W = f.width * u, H = f.height * u, families = h.families(), leaves = h.leavesOf(this.group);
    if (!families.length) return;
    const rootR = clamp(Math.min(H * .22, W * .273), 70, 116), reach = rootR * 1.44;
    const view: FanView = {
      width: Math.ceil(reach + 74), height: Math.ceil(reach * 2.13 + 53), rootR, openness: this.openness, level: this.level,
      families: families.length, rootPhase: this.rootPhase, leaves: Math.max(1, leaves.length), leafPhase: this.leafPhase, depth: this.depth, group: this.group,
      armed: .5 + .5 * this.pressed,
    };
    const s = fanShape(view), keys = h.rims, open = this.mode === "action", dim = this.mode && !open ? .38 : 1;
    const x0 = W - f.right * u - view.width, rest = H * (W < H ? .52 : .51) - view.height / 2;
    // Shut, the fan stands where its way in is clear of the thumb's controls, and it opens where it stood.
    // The thumb's cluster keeps a column this wide clear at the edge (touch.ts touchControls), in the frame's units.
    const column = Math.min(46, 46 * u);
    if (this.depth < 0) {
      const drop = freeRow(f, x0 + view.width - column, column, rest + s.cy, 64) - rest - s.cy;
      this.fanDrop = this.placed ? this.fanDrop + (drop - this.fanDrop) * this.ease : drop;
      this.placed = true;
    }
    const y0 = rest + this.fanDrop;
    const cx = x0 + s.cx, cy = y0 + s.cy;
    const at = (radius: number, angle: number): [number, number] => [cx - Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    repaint(this.fanGlass, view.width, view.height, [rootR, this.openness, this.level, this.rootPhase, this.leafPhase, this.pressed].map((n) => n.toFixed(3)).join("/") + `/${this.depth}/${this.group}/${leaves.length}`, (c) => paintFan(c, view));
    painted(f, keys + 1, IMAGE_FAN, this.fanGlass, x0, y0, view.width, view.height, dim);
    const icon = (key: number, leaf: RimLeaf, x: number, y: number, size: number, alpha: number): void => {
      const pic = leafArt(f, key, leaf, x, y, size);
      if (pic) pic.alpha = alpha * dim * (h.available(leaf) ? 1 : .39);
    };
    if (this.depth >= 0) {
      const face = rootR * (this.depth === 1 ? 1.78 : 1.33);
      hold(f, keys + KEY_FACE, cx - face, cy - face, 2 * face, 2 * face, "Turn the action fan", true);
    }
    const track = (list: readonly RimLeaf[], radius: number, width: number, station: number, child: boolean): void => {
      if (child ? this.depth !== 1 : this.depth < 0) return;
      const scale = child ? 1 : 1 - .18 * s.level, box = Math.max(44, Math.round(width * 2.05 * scale));
      for (let i = 0; i < list.length; i++) {
        const rel = turn(station, i, list.length), [x, y] = at(radius, rel * FAN_SPREAD);
        const lit = Math.abs(rel) < .49, fade = clamp((1.50 - Math.abs(rel)) / .35, 0, 1), pressed = child ? this.leaf === i : this.group === i;
        if (fade <= 0) continue;
        const alpha = (child || this.depth === 0 ? (lit ? 1 : .74) : pressed ? .92 : .54) * fade * s.ease * (child ? s.level : 1);
        const key = child || this.depth === 0 ? h.leaves + i : keys + KEY_FAMILY + i;
        icon(key + 300, list[i]!, x, y, box * (pressed ? (child ? .98 : .94) : .74), alpha);
        hold(f, key, x - box / 2, y - box / 2, box, box, list[i]!.label + (h.available(list[i]!) ? "" : " (unavailable)"), true);
      }
    };
    if (this.depth < 0) {
      const armed = this.armed(h) ?? families[this.group]!;
      icon(keys + KEY_FAMILY + 300, armed, ...at(s.root, 0), s.half * 1.32, .8 + .2 * this.pressed);
      const [top, foot] = clearOf(f, x0 + view.width - column, cy - 48, column, 96, cy);
      if (foot - top >= 24) hold(f, h.hubs + 3, x0 + view.width - column, top, column, foot - top, armed.label, false);
    }
    track(families, s.root, s.rootWidth, this.rootPhase, false);
    track(leaves, s.leafRadius, s.childHalf, this.leafPhase, true);
    if (this.depth >= 0) {
      const hub = Math.max(44, clamp(rootR * .47, 40, 51)), mark = hub * .70;
      const emblem = f.picture(h.hubs + 3 + 300, (cx - mark / 2) / u, (cy - mark / 2) / u, mark / u, mark / u, S_LABEL, "ui:glass-emblem");
      if (emblem) emblem.alpha = s.ease * dim;
      hold(f, h.hubs + 3, cx - hub / 2, cy - hub / 2, hub, hub, "Actions", true);
      const nested = this.depth === 1, name = nested ? leaves[this.leaf]?.label ?? "" : families[this.group]!.label;
      const middle = cy - (nested ? s.outer + s.childHalf * .60 : s.root + s.half * .73) - 6, high = nested ? 31 : 24;
      nameplate(f, keys + 110, x0 + clamp(s.cx - (nested ? s.outer : s.root) * .69, 62, view.width - 62), middle - high / 2, name, open ? s.ease : 0, nested ? families[this.group]!.label : "");
    }
  }
}

function spring(value: number, speed: number, target: number, dt: number, k: number, damping: number): [number, number] {
  speed += (target - value) * k * dt;
  speed *= Math.exp(-damping * dt);
  value += speed * dt;
  return Math.abs(target - value) < .0009 && Math.abs(speed) < .008 ? [target, 0] : [value, speed];
}

/** The height nearest `cy` at which a box `high` tall in the column from `x`, `w` wide, lies on no control drawn before it. */
function freeRow(f: UiFrame, x: number, w: number, cy: number, high: number): number {
  const u = f.unit, spans: [number, number][] = [];
  for (let j = 0; j < f.count; j++) {
    const n = f.nodes[j]!;
    if (!n.interactive || (n.y === 0 && n.h >= f.height) || n.x * u >= x + w || (n.x + n.w) * u <= x) continue;
    spans.push([n.y * u, (n.y + n.h) * u]);
  }
  const low = f.top * u + high / 2, top = (f.height - f.bottom) * u - high / 2;
  const free = (y: number): boolean => y >= low && y <= top && spans.every(([a, b]) => y + high / 2 <= a || y - high / 2 >= b);
  let best = cy, far = Infinity;
  for (const y of [cy, ...spans.flatMap(([a, b]) => [a - high / 2 - 2, b + high / 2 + 2])]) {
    if (free(y) && Math.abs(y - cy) < far) { best = y; far = Math.abs(y - cy); }
  }
  return best;
}

/**
 * The top and foot of the box, in CSS pixels, cut back so it lies on no control drawn before it: what is above `cy`
 * takes from its top, and what is below from its foot.
 */
function clearOf(f: UiFrame, x: number, y: number, w: number, h: number, cy: number): [number, number] {
  const u = f.unit;
  let top = y, foot = y + h;
  for (let j = 0; j < f.count; j++) {
    const n = f.nodes[j]!;
    if (!n.interactive || (n.y === 0 && n.h >= f.height) || n.x * u >= x + w || (n.x + n.w) * u <= x) continue;
    const a = n.y * u, b = (n.y + n.h) * u;
    if (b <= top || a >= foot) continue;
    // What lies across the middle leaves no room at all.
    if (a < cy && b > cy) return [cy, cy];
    if (b <= cy) top = b; else foot = a;
  }
  return [top, foot];
}

/** A box a finger holds, in CSS pixels. */
function hold(f: UiFrame, key: number, x: number, y: number, w: number, h: number, label: string, round: boolean): UiNode {
  const n = f.add(key, K_HOLD, x / f.unit, y / f.unit, w / f.unit, h / f.unit, S_HUD_HIT);
  n.interactive = true; n.label = label; n.round = round;
  return n;
}

/** The study's small question mark has a full thumb target beside the shelf. */
export function helpButton(f: UiFrame, key: number): void {
  const u = 1 / f.unit, b = beltShape(f);
  const size = 44 * u, d = 19 * u;
  const right = f.width - f.right;
  const x = Math.min(right - size, Math.max((b.left + b.w / 2 + b.reach) * u + 2 * u, f.width - 20 * u - size));
  const y = f.height - Math.max(f.bottom, 12 * u) - size;
  const hit = f.add(key, K_BUTTON, x, y, size, size, S_HUD_HIT);
  hit.interactive = true;
  hit.label = "Touch controls";
  const pic = f.picture(key + 1, x + (size - d) / 2, y + (size - d) / 2, d, d, S_LABEL, "ui:mobile-help");
  if (pic) pic.alpha = .78;
  else f.text(key + 1, x, y + (size - 16 * u) / 2, size, S_HUD_KEY, "?");
}
