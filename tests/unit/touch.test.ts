import { expect, test } from "bun:test";
import { KEY_TOUCH_BUTTON, KEY_ZONE_LOOK, KEY_ZONE_MOVE, LONG_MS, LOOK_GAIN, STICK_DEAD, STICK_REACH, T_AIM, T_ATTACK, T_BAG, T_COUNT, T_JUMP, T_STANCE, T_USE, TouchPlay, type TouchTarget } from "../../client/core/touch.ts";
import { CANVAS_HEIGHT, MIN_HEIGHT, MIN_WIDTH, SCALE_FLOOR, UiFrame, canvasHeight } from "../../client/core/ui/nodes.ts";
import { usePrompt } from "../../client/core/ui/touch.ts";
import { BODY, ICON, ICON_COLUMNS, ICON_Y, I_PRONE, PART, PILL_BODY, PILL_CAP, PILL_H, PILL_W, PILL_Y, P_RING, P_ROUND, P_SQUARE_LIT, TOUCH_HEIGHT, TOUCH_WIDTH, touchPixels } from "../../client/core/ui/touch-art.ts";

/** What the layer asked for, in order. */
function target(): TouchTarget & { log: string[]; x: number; z: number; dx: number; dy: number } {
  const t = { log: [] as string[], x: 0, z: 0, dx: 0, dy: 0,
    key: (code: string, down: boolean) => void t.log.push(`${code}${down ? "+" : "-"}`),
    mouse: (button: number, down: boolean) => void t.log.push(`m${button}${down ? "+" : "-"}`),
    move: (x: number, z: number) => { t.x = x; t.z = z; },
    look: (dx: number, dy: number) => { t.dx += dx; t.dy += dy; } };
  return t;
}
const ALL = (1 << T_COUNT) - 1;

test("the canvas follows the window: 720 units high, shorter for a short window, taller for a narrow one, and never wider than its screen", () => {
  const f = new UiFrame();
  // [window in CSS pixels] gives [canvas in units]: one scale both ways, so the canvas is the window's own shape.
  const cases: [number, number, number, number][] = [
    [1280, 720, 1280, 720], [1920, 1080, 1280, 720], [1024, 768, 960, 720], [768, 1024, 540, 720],
    // A phone on its side: the floor keeps a unit at 0.8 px, where it was drawn at 0.54.
    [844, 390, 1056, 488], [667, 375, 834, 469], [568, 320, 710, 400],
    // A phone upright is narrower than 9 to 16: 405 units across, and as tall as that makes it.
    [390, 844, 405, 876], [360, 800, 405, 900], [375, 667, 405, 720], [320, 568, 405, 719],
  ];
  for (const [w, h, cw, ch] of cases) {
    const units = canvasHeight(w, h);
    f.begin(w / h, units);
    expect([f.width, f.height], `${w} by ${h}`).toEqual([cw, ch]);
    // Drawn at one scale, the canvas is no wider than the window, to a pixel.
    expect(f.width * (h / f.height), `${w} by ${h}`).toBeLessThanOrEqual(w + 1);
    expect(h / f.height, `${w} by ${h}`).toBeGreaterThanOrEqual(Math.min(SCALE_FLOOR, w / MIN_WIDTH) - 0.01);
  }
  expect([canvasHeight(400, 200), canvasHeight(0, 0)]).toEqual([MIN_HEIGHT, MIN_HEIGHT]);
  // A frame begun as before is as before.
  f.begin(16 / 9);
  expect([f.width, f.height]).toEqual([1280, CANVAS_HEIGHT]);
  f.begin(0.3);
  expect(f.width).toBe(MIN_WIDTH);
  // Slices are cut on whole pixels.
  f.unit = 0.8;
  expect(f.snap(10.3) * 0.8).toBeCloseTo(8, 9);
});

test("the stick is where the thumb lands: still in its middle, analog to the rim, sprinting there, and at rest when let go", () => {
  const t = target(), p = new TouchPlay();
  expect(p.pointer(0, KEY_ZONE_MOVE, 200, 400, 7, 0, t, 1)).toBe(true);
  expect([p.stick, p.stickX, p.stickY, t.x, t.z]).toEqual([true, 200, 400, 0, 0]);
  p.pointer(2, KEY_ZONE_MOVE, 200 + STICK_DEAD - 1, 400, 7, 0, t, 1);
  expect([t.x, t.z]).toEqual([0, 0]);
  // Up the screen is forward. Half way out is half speed, less the still middle.
  p.pointer(2, KEY_ZONE_MOVE, 200, 400 - 34, 7, 0, t, 1);
  expect(t.x).toBeCloseTo(0, 9);
  expect(t.z).toBeCloseTo((34 - STICK_DEAD) / (STICK_REACH - STICK_DEAD), 9);
  expect(t.log).toEqual([]);
  p.pointer(2, KEY_ZONE_MOVE, 200 + STICK_REACH, 400, 7, 0, t, 1);
  expect([t.x, t.z, p.knobX]).toEqual([1, 0, STICK_REACH]);
  expect(t.log).toEqual(["ShiftLeft+"]);
  // Past the rim the middle follows the thumb, so turning back answers at once.
  p.pointer(2, KEY_ZONE_MOVE, 200 + STICK_REACH + 50, 400, 7, 0, t, 1);
  expect([p.stickX, p.knobX, t.x]).toEqual([250, STICK_REACH, 1]);
  p.pointer(2, KEY_ZONE_MOVE, 250, 400, 7, 0, t, 1);
  expect([t.x, t.log.at(-1)]).toEqual([0, "ShiftLeft-"]);
  // Another finger in the zone is not the stick's, and its lift does not let go.
  p.pointer(0, KEY_ZONE_MOVE, 20, 20, 9, 0, t, 1);
  p.pointer(2, KEY_ZONE_MOVE, 20, 300, 9, 0, t, 1);
  p.pointer(1, KEY_ZONE_MOVE, 20, 300, 9, 0, t, 1);
  expect([p.stick, p.stickX]).toEqual([true, 250]);
  p.pointer(2, KEY_ZONE_MOVE, 250, 370, 7, 0, t, 1);
  p.pointer(1, KEY_ZONE_MOVE, 250, 370, 7, 0, t, 1);
  expect([p.stick, t.x, t.z, p.knobY]).toEqual([false, 0, 0, 0]);
});

test("a drag on the right turns the view as a mouse does, in pixels; a finger on Attack fires and turns it too", () => {
  const t = target(), p = new TouchPlay();
  p.pointer(0, KEY_ZONE_LOOK, 600, 200, 3, 0, t, 0.8);
  expect([t.dx, t.dy]).toEqual([0, 0]);
  p.pointer(2, KEY_ZONE_LOOK, 650, 190, 3, 0, t, 0.8);
  expect(t.dx).toBeCloseTo(50 * 0.8 * LOOK_GAIN, 9);
  expect(t.dy).toBeCloseTo(-10 * 0.8 * LOOK_GAIN, 9);
  // Both thumbs at once: the stick's finger and the view's do not disturb each other.
  p.pointer(0, KEY_ZONE_MOVE, 100, 300, 4, 0, t, 0.8);
  p.pointer(2, KEY_ZONE_MOVE, 100, 250, 4, 0, t, 0.8);
  p.pointer(2, KEY_ZONE_LOOK, 660, 190, 3, 0, t, 0.8);
  expect(t.z).toBeGreaterThan(0.5);
  expect(t.dx).toBeCloseTo(60 * 0.8 * LOOK_GAIN, 9);
  p.pointer(1, KEY_ZONE_LOOK, 660, 190, 3, 0, t, 0.8);
  p.pointer(2, KEY_ZONE_LOOK, 900, 190, 3, 0, t, 0.8);
  expect(t.dx).toBeCloseTo(60 * 0.8 * LOOK_GAIN, 9);
  // Attack holds the primary button, and the same thumb drags the aim.
  t.dx = t.dy = 0;
  p.pointer(0, KEY_TOUCH_BUTTON + T_ATTACK, 900, 400, 5, 0, t, 1);
  p.pointer(2, KEY_TOUCH_BUTTON + T_ATTACK, 890, 420, 5, 0, t, 1);
  expect([t.log, t.dx, t.dy]).toEqual([["m0+"], -10 * LOOK_GAIN, 20 * LOOK_GAIN]);
  p.pointer(1, KEY_TOUCH_BUTTON + T_ATTACK, 890, 420, 5, 0, t, 1);
  expect([t.log, p.held(T_ATTACK)]).toEqual([["m0+", "m0-"], false]);
});

test("buttons: held keys, taps, aim on and off, a short press crouches and a long one lies prone", () => {
  const t = target(), p = new TouchPlay();
  p.pointer(0, KEY_TOUCH_BUTTON + T_JUMP, 0, 0, 1, 0, t, 1);
  p.pointer(0, KEY_TOUCH_BUTTON + T_JUMP, 0, 0, 2, 0, t, 1);
  p.pointer(1, KEY_TOUCH_BUTTON + T_JUMP, 0, 0, 2, 0, t, 1);
  expect([t.log, p.held(T_JUMP)]).toEqual([["Space+"], true]);
  p.pointer(1, KEY_TOUCH_BUTTON + T_JUMP, 0, 0, 1, 0, t, 1);
  // The use key is held as long as the finger is, which is what opens a structure's actions.
  p.pointer(0, KEY_TOUCH_BUTTON + T_USE, 0, 0, 1, 0, t, 1);
  p.pointer(1, KEY_TOUCH_BUTTON + T_USE, 0, 0, 1, 900, t, 1);
  p.pointer(0, KEY_TOUCH_BUTTON + T_BAG, 0, 0, 1, 0, t, 1);
  p.pointer(1, KEY_TOUCH_BUTTON + T_BAG, 0, 0, 1, 0, t, 1);
  expect(t.log).toEqual(["Space+", "Space-", "KeyE+", "KeyE-", "KeyI+", "KeyI-"]);
  t.log.length = 0;
  for (let k = 0; k < 2; k++) { p.pointer(0, KEY_TOUCH_BUTTON + T_AIM, 0, 0, 1, 0, t, 1); p.pointer(1, KEY_TOUCH_BUTTON + T_AIM, 0, 0, 1, 0, t, 1); }
  expect([t.log, p.aiming]).toEqual([["m2+", "m2-"], false]);
  t.log.length = 0;
  p.pointer(0, KEY_TOUCH_BUTTON + T_STANCE, 0, 0, 1, 1000, t, 1);
  p.frame(1000 + LONG_MS - 1, ALL, t);
  p.pointer(1, KEY_TOUCH_BUTTON + T_STANCE, 0, 0, 1, 1100, t, 1);
  expect(t.log).toEqual(["KeyC+", "KeyC-"]);
  p.pointer(0, KEY_TOUCH_BUTTON + T_STANCE, 0, 0, 1, 2000, t, 1);
  p.frame(2000 + LONG_MS, ALL, t);
  p.frame(2000 + LONG_MS + 16, ALL, t);
  p.pointer(1, KEY_TOUCH_BUTTON + T_STANCE, 0, 0, 1, 2600, t, 1);
  expect(t.log).toEqual(["KeyC+", "KeyC-", "KeyX+", "KeyX-"]);
  // Any other node's key is not the layer's.
  expect(p.pointer(0, 40, 0, 0, 1, 0, t, 1)).toBe(false);
});

test("a button that is no longer shown lets go, aim goes off with its button, and a blur forgets every finger", () => {
  const t = target(), p = new TouchPlay();
  p.pointer(0, KEY_TOUCH_BUTTON + T_ATTACK, 0, 0, 1, 0, t, 1);
  p.pointer(0, KEY_TOUCH_BUTTON + T_AIM, 0, 0, 2, 0, t, 1);
  p.pointer(1, KEY_TOUCH_BUTTON + T_AIM, 0, 0, 2, 0, t, 1);
  p.pointer(0, KEY_TOUCH_BUTTON + T_STANCE, 0, 0, 3, 0, t, 1);
  p.frame(16, ALL & ~(1 << T_ATTACK) & ~(1 << T_AIM) & ~(1 << T_STANCE), t);
  // The stance's short press does not fire for a button taken away.
  expect([t.log, p.held(T_ATTACK), p.aiming]).toEqual([["m0+", "m2+", "m0-", "m2-"], false, false]);
  p.pointer(0, KEY_ZONE_MOVE, 10, 10, 1, 0, t, 1);
  p.pointer(0, KEY_TOUCH_BUTTON + T_JUMP, 0, 0, 2, 0, t, 1);
  p.reset();
  expect([p.stick, p.held(T_JUMP), p.knobX]).toEqual([false, false, 0]);
  // The zone is free for the next finger.
  p.pointer(0, KEY_ZONE_MOVE, 50, 60, 4, 0, t, 1);
  expect([p.stick, p.stickX]).toEqual([true, 50]);
});

test("a prompt that names the use key is offered as a button without it", () => {
  expect([usePrompt("E  ride raptor"), usePrompt("E  exit vehicle"), usePrompt(""), usePrompt("Hold still"), usePrompt("F  open cargo")]).toEqual(["Ride raptor", "Exit vehicle", "", "", ""]);
});

test("the stand-in sheet has every part in its cell, a hollow ring, and room for every glyph", () => {
  const s = touchPixels(), alpha = (x: number, y: number): number => s.data[(y * TOUCH_WIDTH + x) * 4 + 3]!;
  expect([s.width, s.height, s.data.length]).toEqual([TOUCH_WIDTH, TOUCH_HEIGHT, TOUCH_WIDTH * TOUCH_HEIGHT * 4]);
  for (let part = 0; part <= P_SQUARE_LIT; part++) {
    const x = part * PART + PART / 2;
    // Its body is solid at its middle, but for the ring's; its rim is at BODY of the cell; its corner is clear.
    expect(alpha(x, PART / 2) > 0, `part ${part}`).toBe(part !== P_RING);
    expect(alpha(x + Math.floor((PART * BODY) / 2) - 1, PART / 2), `part ${part}`).toBeGreaterThan(100);
    expect(alpha(part * PART + 1, 1), `part ${part}`).toBe(0);
  }
  expect(alpha(P_ROUND * PART + PART / 2, PART / 2)).toBeLessThan(alpha(PART + PART / 2, PART / 2));
  for (const lit of [0, 1]) {
    expect(alpha(lit * PILL_W + PILL_W / 2, PILL_Y + PILL_H / 2)).toBeGreaterThan(0);
    expect(alpha(lit * PILL_W + (PILL_W - PILL_BODY) / 2 - 3, PILL_Y + PILL_H / 2)).toBe(0);
    // The straight middle begins inside each end's slice.
    expect(PILL_CAP).toBeGreaterThanOrEqual((PILL_W - PILL_BODY) / 2 + (PILL_H * BODY) / 2);
  }
  expect(ICON_Y + (Math.floor(I_PRONE / ICON_COLUMNS) + 1) * ICON).toBeLessThanOrEqual(TOUCH_HEIGHT);
  expect(ICON_COLUMNS * ICON).toBeLessThanOrEqual(TOUCH_WIDTH);
});
