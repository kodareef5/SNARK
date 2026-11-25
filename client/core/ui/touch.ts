// The touch layout draws each thumb pad at its contact and offers held controls in the field kit.
//
// Nothing imports this module's values but a page that is touched: the interface holds it as `Ui.layer`, which the
// shell fetches when a finger is first used, so a page played with a mouse or a pad never downloads the layout or the
// sheet's stand-in (D871). Import its types freely; import a value from here and every page pays for it.

import type { HudModel } from "../hud.ts";
import { KEY_TOUCH_BUTTON, KEY_ZONE_LOOK, KEY_ZONE_MOVE, T_AIM, T_ATTACK, T_CANCEL, T_CLOSE, T_DOWN, T_FOLLOW, T_FOLLOW_ONE, T_HOLD, T_JUMP, T_LOWER, T_MELEE, T_MIC, T_MORE, T_ORBIT, T_PACK, T_RAISE, T_RELOAD, T_ROLL, T_ROTATE, T_SHIFT, T_SIC, T_SNAP, T_STANCE, T_STAY, T_STAY_ONE, T_USE, T_VIEW, type TouchPlay } from "../touch.ts";
import { VITAL_PITCH } from "./hud.ts";
import { K_HOLD, K_IMAGE, fitText, textWidth, type UiFrame, type UiNode } from "./nodes.ts";
import { S_KEY, S_LABEL, S_PROMPT } from "./style.ts";
import { BODY, ICON, ICON_COLUMNS, ICON_Y, IMAGE_TOUCH, I_AIM, I_ANCHOR, I_ATTACK, I_BAG, I_BRAKE, I_CANCEL, I_CREATURE, I_CROUCH, I_DOWN, I_JUMP, I_LEFT, I_LIGHTS, I_MELEE, I_MIC, I_MORE, I_ORBIT, I_PLACE, I_PROPELLER, I_RELOAD, I_RIGHT, I_ROTATE, I_ROTOR, I_SNAP, I_SPRINT, I_UP, I_VARIANT, I_VIEW, I_WHISTLE, I_WINGS, PART, PILL_BODY, PILL_CAP, PILL_H, PILL_W, PILL_Y, P_KNOB, P_RING, P_ROUND, P_SQUARE, TOUCH_HEIGHT, TOUCH_URL, TOUCH_WIDTH, touchPixels } from "./touch-art.ts";

/** Keys of the layer's pictures, which are never pressed: four to a button, then the stick's. */
const KEY_TOUCH_ART = 3300000;
/** The share of the canvas's width the move zone takes, from the left. */
export const MOVE_SHARE = 0.5;
const MARGIN = 12;
/** Sizes, in units: the buttons across, a bar button and the step from one to the next, and a pill's height. */
const ATTACK = 76, BUTTON = 56, SMALL = 48, BAR = 44, PILL = 44;
const GAP = 8;
/**
 * The cluster is an arc about Attack, which stands in the corner: a thumb pivots there and its tip sweeps the rest.
 * Each is a distance from Attack's middle and an angle from straight right, turning up and over to the left. The
 * distances leave a finger's gap between neighbours, and between their boxes, which is what a press is tested against.
 */
const ARC = 88, OUTER = 156;
/** The places on the arcs, by angle: three on the near one, four on the far one. Which button has which is the situation's. */
const NEAR = [95, 140, 185] as const, FAR = [100, 125, 150, 175] as const;
/** From one place to the next along the foot of the cluster, where a canvas too short for the far arc's top puts its two highest. */
const ALONG = SMALL + GAP;
/** What the body is doing, which decides the cluster. */
export type Situation = "foot" | "flyer" | "building" | "placing";
/** How far left of the canvas's right margin the cluster reaches, and how far above its foot. */
const CLUSTER_W = ATTACK / 2 + OUTER + SMALL / 2, CLUSTER_H = ATTACK / 2 + OUTER + SMALL / 2;
const RADIANS = Math.PI / 180;

/** The vitals and microphone reserve the upper-left corner. */
export interface TouchPlan { vitalsX: number; vitalsY: number; stackY: number; under: number; map: number; mic: boolean; topEnd: number }
const plan: TouchPlan = { vitalsX: 0, vitalsY: 0, stackY: 0, under: 0, map: 160, mic: false, topEnd: 0 };

/** The plan for this canvas. The same object each time. */
export function touchPlan(f: UiFrame, muted: boolean, mic = false): TouchPlan {
  const left = f.left + MARGIN, top = f.top + MARGIN;
  plan.mic = mic;
  plan.map = f.height < 560 || f.width < 520 ? 64 : 80;
  plan.vitalsX = left + 6;
  plan.vitalsY = top;
  plan.under = top + BAR + 10 + (mic ? BAR + GAP : 0);
  plan.stackY = plan.under + (muted ? 52 : 0);
  plan.topEnd = plan.vitalsX + 6 * VITAL_PITCH;
  return plan;
}

function art(f: UiFrame, key: number, x: number, y: number, w: number, h: number, sx: number, sy: number, sw: number, sh: number): UiNode {
  f.images[IMAGE_TOUCH] ??= TOUCH_URL ? { width: TOUCH_WIDTH, height: TOUCH_HEIGHT, data: new Uint8ClampedArray(0), version: 0, url: TOUCH_URL, smooth: true } : touchPixels();
  const n = f.add(key, K_IMAGE, x, y, w, h, S_LABEL);
  n.image = IMAGE_TOUCH;
  n.sx = sx; n.sy = sy; n.sw = sw; n.sh = sh;
  return n;
}

/** A part of the sheet drawn so that its body is `d` across, about `cx`, `cy`. */
function part(f: UiFrame, key: number, which: number, cx: number, cy: number, d: number): UiNode {
  const cell = d / BODY;
  return art(f, key, cx - cell / 2, cy - cell / 2, cell, cell, which * PART, 0, PART, PART);
}

/** A button `d` across about `cx`, `cy`: its glass, lit while held, its glyph, and what a finger presses. Returns its bit. */
function button(f: UiFrame, t: TouchPlay, b: number, cx: number, cy: number, d: number, glass: number, icon: number, label: string, lit = false): number {
  part(f, KEY_TOUCH_ART + b * 4, glass + (lit || t.held(b) ? 1 : 0), cx, cy, d);
  if (TOUCH_URL) art(f, KEY_TOUCH_ART + b * 4 + 1, cx - d * 0.44, cy - d * 0.44, d * 0.88, d * 0.88, (icon % ICON_COLUMNS) * ICON, ICON_Y + Math.floor(icon / ICON_COLUMNS) * ICON, ICON, ICON);
  const n = f.add(KEY_TOUCH_BUTTON + b, K_HOLD, cx - d / 2, cy - d / 2, d, d, S_KEY);
  // Without the painted sheet a button says what it is.
  if (!TOUCH_URL) n.text = fitText(label, d, S_KEY);
  n.label = label; n.interactive = true;
  return 1 << b;
}

/**
 * The sheet's pill with its body at `x`, `y`, `w` by `h`, lit or at rest, as three pictures from `key`: the ends keep
 * their shape and the middle stretches. The slices meet on whole pixels, or a seam shows between them.
 */
export function pill(f: UiFrame, key: number, x: number, y: number, w: number, h: number, lit: boolean): void {
  const cell = h / BODY, k = cell / PILL_H, edge = ((PILL_W - PILL_BODY) / 2) * k, cap = PILL_CAP * k;
  const x0 = f.snap(x - edge), x1 = f.snap(x - edge + cap), x2 = f.snap(x + w + edge - cap), x3 = f.snap(x + w + edge), y0 = y + h / 2 - cell / 2;
  // Pressed, the lit pill glows through the one at rest, so the words on it can still be read.
  for (let pass = 0; pass <= (lit ? 1 : 0); pass++) {
    const sx0 = pass * PILL_W, k0 = key + pass * 3, alpha = pass ? 0.5 : 1;
    art(f, k0, x0, y0, x1 - x0, cell, sx0, PILL_Y, PILL_CAP, PILL_H).alpha = alpha;
    art(f, k0 + 1, x1, y0, Math.max(1, x2 - x1), cell, sx0 + PILL_CAP, PILL_Y, PILL_W - PILL_CAP * 2, PILL_H).alpha = alpha;
    art(f, k0 + 2, x2, y0, x3 - x2, cell, sx0 + PILL_W - PILL_CAP, PILL_Y, PILL_CAP, PILL_H).alpha = alpha;
  }
}

/** Chat opens below the vitals and above the phone keyboard. */
export function chatTop(f: UiFrame, touch: TouchPlan): { top: number; bottom: number } {
  // On its side a phone's keyboard leaves less than half the screen, and the box may cover the vitals to keep in it;
  // upright there is room under them.
  const top = f.width > f.height ? f.top + MARGIN + BAR + 10 : touch.under;
  return { top, bottom: top + 3 * 19 + 56 };
}

/** The two zones, under everything else the HUD draws: call before it. */
export function touchZones(f: UiFrame): void {
  const split = Math.round(f.width * MOVE_SHARE);
  const move = f.add(KEY_ZONE_MOVE, K_HOLD, 0, 0, split, f.height, S_KEY);
  move.label = "Move"; move.interactive = true;
  const look = f.add(KEY_ZONE_LOOK, K_HOLD, split, 0, f.width - split, f.height, S_KEY);
  look.label = "Tap to use the held item, drag to look"; look.interactive = true;
}

/** Voice keeps its own hold target below the vital signs. */
export function touchBar(f: UiFrame, t: TouchPlay, mic: boolean): number {
  if (!mic) return 0;
  const x = f.left + MARGIN, y = f.top + MARGIN + BAR + GAP;
  const size = 27;
  if (TOUCH_URL) {
    const icon = art(f, KEY_TOUCH_ART + T_MIC * 4, x, y + (BAR - size) / 2, size, size,
      I_MIC % ICON_COLUMNS * ICON, ICON_Y + Math.floor(I_MIC / ICON_COLUMNS) * ICON, ICON, ICON);
    icon.alpha = t.held(T_MIC) ? 1 : .76;
  }
  const hit = f.add(KEY_TOUCH_BUTTON + T_MIC, K_HOLD, x, y, BAR, BAR, S_KEY);
  hit.interactive = true; hit.label = "Talk";
  if (!TOUCH_URL) hit.text = "Mic";
  return 1 << T_MIC;
}

/** The drone flies forward on its own. The right thumb steers and the left toggles boost. */
export function touchDrone(f: UiFrame, t: TouchPlay): number {
  t.rim = false; t.worldAction = false;
  touchContacts(f, t);
  return button(f, t, T_SHIFT, f.left + MARGIN + BUTTON / 2, f.height - f.bottom - MARGIN - BUTTON / 2, BUTTON, P_ROUND, I_SPRINT, "Boost", t.shifted);
}

/** The way out of a screen a finger opened, in the top right, over it: what Escape is to a keyboard. Returns its bit. */
export function touchClose(f: UiFrame, t: TouchPlay): number {
  return button(f, t, T_CLOSE, f.width - f.right - MARGIN - BAR / 2, f.top + MARGIN + BAR / 2, BAR, P_SQUARE, I_CANCEL, "Close");
}

/** Each thumb appears at its own contact and sits below the field controls. */
function touchContacts(f: UiFrame, t: TouchPlay, item = ""): void {
  t.width = f.width; t.height = f.height;
  const k = KEY_TOUCH_ART + 900;
  if (t.stick) {
    const ring = 108 * t.contactScale(false) / f.unit, knob = ring * 0.39;
    if (!f.picture(k, t.stickX - ring / 2, t.stickY - ring / 2, ring, ring, S_LABEL, "ui:glass-touch-move"))
      part(f, k, P_RING, t.stickX, t.stickY, ring * .89).alpha = .8;
    const x = t.stickX + t.knobX * .48, y = t.stickY + t.knobY * .48;
    if (!f.picture(k + 1, x - knob / 2, y - knob / 2, knob, knob, S_LABEL, "ui:glass-touch-knob"))
      part(f, k + 1, P_KNOB, x, y, knob * .83);
  }
  if (t.action) {
    const ring = (t.looking ? 66 : 86) * t.contactScale(true) / f.unit, size = ring * .42;
    const circle = f.picture(k + 2, t.actionX - ring / 2, t.actionY - ring / 2, ring, ring, S_LABEL, "ui:glass-touch-look")
      ?? part(f, k + 2, P_RING, t.actionX, t.actionY, ring * .89);
    circle.alpha = t.looking ? .52 : .95;
    const x = t.actionX - size / 2, y = t.actionY - size / 2;
    const gem = (item && f.picture(k + 3, x, y, size, size, S_LABEL, item)) ||
      f.picture(k + 3, x, y, size, size, S_LABEL, "ui:glass-touch-emblem") ||
      part(f, k + 3, P_KNOB, t.actionX, t.actionY, size * .82);
    gem.alpha = t.looking ? .35 : 1;
  }
}

/**
 * The stick and the right-hand cluster, over the HUD: call after it. `hotbarRight` and `hotbarTop` say where the hotbar
 * is, which the cluster stands above where it would reach it, and `mapFoot` where the minimap ends, which the prompt's
 * pill stays below. Returns the bits of the buttons it showed.
 */
export function touchControls(f: UiFrame, t: TouchPlay, m: HudModel, situation: Situation, hotbarRight: number, hotbarTop: number, mapFoot: number, creature = false, controlsVisible = true): number {
  const driving = m.vehicle?.active === true, v = driving ? m.vehicle! : null;
  const auxiliary = t.tools || driving || situation !== "foot";
  const left = f.left + MARGIN, right = f.width - f.right - MARGIN - (auxiliary ? 35 : 0);
  let bottom = f.height - f.bottom - MARGIN;
  // Above the hotbar and the line over it that says what is loaded, where the cluster would reach them.
  if (hotbarRight + GAP > right - CLUSTER_W) bottom = hotbarTop - GAP - 22;
  t.rim = !driving;
  t.worldAction = !driving;
  touchContacts(f, t, m.hotbar[m.held]?.id);
  if (!controlsVisible) return 0;
  const ax = right - ATTACK / 2, ay = bottom - ATTACK / 2;
  let shown = 0;
  // Where the far arc's top would reach the minimap (a small phone on its side), its two highest places lie along
  // the cluster's foot instead, left of the lowest.
  const low = bottom - CLUSTER_H < mapFoot + GAP, last = FAR[FAR.length - 1]! * RADIANS;
  // A button on the near arc (`place` 0 to 2) or the far one (3 to 6), `d` across.
  const at = (b: number, place: number, d: number, icon: number, label: string, lit = false): void => {
    const far = place >= NEAR.length, angle = (far ? FAR[place - NEAR.length]! : NEAR[place]!) * RADIANS, out = far ? OUTER : ARC;
    if (low && (place === 3 || place === 4)) shown |= button(f, t, b, ax + OUTER * Math.cos(last) - ALONG * (place - 2), ay - OUTER * Math.sin(last), d, P_ROUND, icon, label, lit);
    else shown |= button(f, t, b, ax + out * Math.cos(angle), ay - out * Math.sin(angle), d, P_ROUND, icon, label, lit);
  };
  const corner = (b: number, icon: number, label: string): void => { shown |= button(f, t, b, ax, ay, ATTACK, P_ROUND, icon, label); };
  if (v?.board) {
    // The stick picks each trick's variant as it is pressed; in the air it spins the rider.
    corner(T_JUMP, I_JUMP, "Hold to crouch, let go to ollie");
    at(T_RELOAD, 0, BUTTON, I_ROTATE, "Flip");
    at(T_ROLL, 1, BUTTON, I_CROUCH, "Hold to grab, let go to land");
    at(T_SHIFT, 2, BUTTON, I_SNAP, "Catch an edge on descent", t.shifted);
    at(T_HOLD, 3, SMALL, I_ANCHOR, "Hold for a manual");
    at(T_SNAP, 4, SMALL, I_LEFT, "Revert");
    at(T_MELEE, 5, SMALL, I_RIGHT, "Special");
  } else if (v?.rotor) {
    // A helicopter: the collective under the thumb, yaw side by side above it, and the rest about them.
    corner(T_JUMP, I_UP, "Collective up");
    at(T_DOWN, 2, BUTTON, I_DOWN, "Collective down");
    at(T_SNAP, 4, SMALL, I_LEFT, "Yaw left");
    at(T_RELOAD, 3, SMALL, I_RIGHT, "Yaw right");
    at(T_ROLL, 0, BUTTON, I_ROTOR, "Flight mode");
    at(T_HOLD, 1, BUTTON, I_ANCHOR, "Hold to recover");
    at(T_SHIFT, 5, SMALL, I_SPRINT, "Agile", t.shifted);
    at(T_VIEW, 6, SMALL, I_VIEW, "View");
  } else if (v?.boat) {
    corner(T_JUMP, I_ANCHOR, "Neutral");
    at(T_SHIFT, 1, BUTTON, I_PROPELLER, "Precision throttle", t.shifted);
    at(T_VIEW, 0, BUTTON, I_VIEW, "View");
  } else if (v) {
    corner(T_JUMP, I_BRAKE, "Brake");
    at(T_VIEW, 0, BUTTON, I_VIEW, "View");
    if (v.lightMode >= 0) at(T_ORBIT, 1, BUTTON, I_LIGHTS, "Lights");
    if (v.thrusters) {
      // A thruster car: the boost latched on like a helicopter's agile mode, and a flip whose way is the stick's.
      at(T_SHIFT, 2, BUTTON, I_SPRINT, "Boost", t.shifted);
      at(T_SNAP, 3, SMALL, I_UP, "Flip");
    }
  } else if (situation === "placing") {
    corner(T_ATTACK, I_PLACE, "Place");
    at(T_ROTATE, 0, BUTTON, I_RIGHT, "Turn right");
    at(T_SNAP, 1, BUTTON, I_LEFT, "Turn left");
    at(T_CANCEL, 2, BUTTON, I_CANCEL, "Cancel");
  } else if (situation === "building") {
    // Each button presses the key its row names (editor-keys.ts BUILD_KEYS): R, T, Q, the arrows, and Escape as a finger's cancel.
    corner(T_ATTACK, I_PLACE, "Place");
    at(T_RELOAD, 0, BUTTON, I_ROTATE, "Rotate");
    at(T_FOLLOW_ONE, 1, BUTTON, I_VARIANT, "Next form; hold and drag for the wheel of forms");
    at(T_SNAP, 2, BUTTON, I_SNAP, "Next snap point; hold for free placement");
    at(T_RAISE, 3, SMALL, I_UP, "Raise");
    at(T_LOWER, 4, SMALL, I_DOWN, "Lower");
    at(T_CANCEL, 5, SMALL, I_CANCEL, "Put away");
  } else if (auxiliary) {
    corner(T_ATTACK, I_ATTACK, "Attack");
    at(T_MORE, 3, SMALL, I_MORE, t.more ? "Back" : "More", t.more);
    if (t.more) {
      // The second page: a blow by hand, the view and the orbit camera, and the whistles to every creature that hears.
      at(T_MELEE, 0, BUTTON, I_MELEE, "Melee");
      at(T_VIEW, 1, BUTTON, I_VIEW, "View");
      at(T_ORBIT, 2, BUTTON, I_ORBIT, "Orbit camera");
      // To the creature looked at, where one is; else to every one that hears.
      if (creature) { at(T_FOLLOW_ONE, 4, SMALL, I_WHISTLE, "Whistle: this one follow"); at(T_STAY_ONE, 5, SMALL, I_ANCHOR, "Whistle: this one stay"); }
      else { at(T_FOLLOW, 4, SMALL, I_WHISTLE, "Whistle: all follow"); at(T_STAY, 5, SMALL, I_ANCHOR, "Whistle: all stay"); }
      at(T_SIC, 6, SMALL, I_CREATURE, "Whistle: attack this target");
    } else {
      const flyer = situation === "flyer";
      at(T_JUMP, 0, BUTTON, flyer ? I_WINGS : I_JUMP, flyer ? "Take off or land" : "Jump");
      if (flyer) { at(T_ROLL, 1, BUTTON, I_ROTATE, "Roll"); at(T_HOLD, 2, BUTTON, I_BRAKE, "Brake"); }
      else {
        at(T_STANCE, 1, BUTTON, I_CROUCH, "Stance");
        // A held glass is raised as a weapon is aimed; with nothing to aim, the toggle holds a helmet's visor up (D1085).
        const armed = m.ammo !== "" || m.cone >= 0 || m.scope || m.holo || m.glassHeld;
        t.aimButton = !armed && m.visorReady ? 1 : 2;
        if (armed || m.visorReady || t.aiming) at(T_AIM, 2, BUTTON, I_AIM, t.aimButton === 1 ? "Visor" : "Aim", t.aiming);
        // A raised sight that zooms takes the builder's raise and lower as its zoom (the arrow keys).
        if (m.zooming) { at(T_RAISE, 3, SMALL, I_UP, "Zoom in"); at(T_LOWER, 4, SMALL, I_DOWN, "Zoom out"); }
        if (m.ammo !== "") at(T_RELOAD, 6, SMALL, I_RELOAD, "Reload");
      }
    }
  }

  // What the world offers, as a pill by the thumb: the prompt without its key.
  const offer = m.prompt ? usePrompt(m.prompt) : "";
  if (offer !== "") {
    // Above the cluster, or on a canvas too short for that, to its left.
    // Clear of the far arc's top, which is a little above the near one's.
    const above = bottom - CLUSTER_H - GAP - PILL, beside = right - CLUSTER_W - ALONG * 2 - GAP, high = above >= mapFoot + GAP;
    const pack = m.prompt.includes("   F  pick up"), packWidth = pack ? SMALL + GAP : 0;
    const w = Math.max(96, Math.min((high ? right : beside) - left, Math.ceil(textWidth(offer, S_PROMPT)) + 44)), x = (high ? right : beside) - w - packWidth, y = high ? above : bottom - PILL;
    const promptX = auxiliary ? x : (left + right - w - packWidth) / 2, promptY = auxiliary ? y : Math.min(bottom, hotbarTop) - GAP - PILL - 16;
    pill(f, KEY_TOUCH_ART + T_USE * 4, promptX, promptY, w, PILL, t.held(T_USE));
    const n = f.add(KEY_TOUCH_BUTTON + T_USE, K_HOLD, promptX, promptY, w, PILL, S_PROMPT);
    n.text = fitText(offer, w - 16, S_PROMPT); n.label = offer; n.interactive = true;
    shown |= 1 << T_USE;
    if (pack) shown |= button(f, t, T_PACK, promptX + w + GAP + SMALL/2, promptY + PILL/2, SMALL, P_ROUND, I_BAG, "Pick up skateboard");
  }
  return shown;
}

/** What the use key would do, from a prompt that names it ("E  ride raptor" gives "Ride raptor"); "" for any other line. */
export function usePrompt(prompt: string): string {
  // A built piece's line may stand under the builder's reason (prompts.ts): "E use  box" or "hold E  wall".
  for (const line of prompt.split("\n")) {
    if (line.startsWith("E use  ")) return `Use ${line.slice(7)}`;
    if (line.startsWith("hold E  ")) return `Hold: ${line.slice(8)}`;
  }
  if (!prompt.startsWith("E  ")) return "";
  return prompt.charAt(3).toUpperCase() + prompt.slice(4).split("   F  ")[0]!;
}
