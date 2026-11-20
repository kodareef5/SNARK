// The compass at the top of the screen and the reader's arrow on the maps (client/core/ui/compass.ts, arrow.ts): the tape
// shows the heading in the middle and slides the short way round, its spring settles a quick turn with a little swing,
// pips stand at the bearings of friends and a body, the arrow points the way the reader faces, and both keep out of the
// way of a scope, the map screen, a finger's bar and the minimap.

import { expect, test } from "bun:test";
import { HudModel } from "../../client/core/hud.ts";
import type { Chart } from "../../client/core/tactical.ts";
import { ARROW_STEPS, CELL, IMAGE_ARROW, arrowCell, arrowSheet } from "../../client/core/ui/arrow.ts";
import { Compass, KEY_COMPASS, bearingOf, turnTo } from "../../client/core/ui/compass.ts";
import { KEY_MARKER, KEY_SELF_ARROW, MINIMAP_SIZE, buildHud } from "../../client/core/ui/hud.ts";
import { unmuteButton } from "../../client/core/ui/menu.ts";
import { IMAGE_DIAL } from "../../client/core/ui/sundial.ts";
import { IMAGE_HEART } from "../../client/core/ui/tame.ts";
import { IMAGE_SKIN } from "../../client/core/ui/skin.ts";
import { IMAGE_TOUCH } from "../../client/core/ui/touch-art.ts";
import { IMAGE_ICONS } from "../../client/core/assets/icons.ts";
import { IMAGE_MAP, IMAGE_MINIMAP } from "../../client/core/ui/hud.ts";
import { MATING_STEPS } from "../../shared/anim/pose.ts";
import { K_IMAGE, UiFrame, type UiNode } from "../../client/core/ui/nodes.ts";
import { touchPlan } from "../../client/core/ui/touch.ts";

const OPTIONS = { minimap: true, diagnostics: false, vitalLabels: false, compass: true };

/** A model facing `heading`, standing in the middle of a 1 km map whose minimap shows all of it, with `marks` about it. */
function model(heading: number, marks: { kind: "mate" | "death" | "creature"; east: number; north: number }[] = []): HudModel {
  const m = new HudModel();
  m.heading = heading;
  m.dial.set(heading);
  m.mapSizeX = m.mapSizeZ = 1000;
  m.chart = { mini: { view: { u0: 0, v0: 0, du: 1, dv: 1, zoom: 0 } } } as unknown as Chart;
  m.markers.push({ kind: "self", u: 0.5, v: 0.5 });
  for (const k of marks) m.markers.push({ kind: k.kind, u: 0.5 + k.east / 1000, v: 0.5 - k.north / 1000 });
  return m;
}

function build(m: HudModel, aspect = 16 / 9, options = OPTIONS, inspect = false, touch = false): UiFrame {
  const f = new UiFrame();
  f.begin(aspect);
  buildHud(f, m, options, true, inspect, touch ? touchPlan(f, false) : null);
  return f;
}

const nodes = (f: UiFrame): UiNode[] => f.nodes.slice(0, f.count);
const tape = (f: UiFrame): UiNode[] => nodes(f).filter((n) => n.key >= KEY_COMPASS && n.key < KEY_COMPASS + 100);
const letter = (f: UiFrame, text: string): UiNode | undefined => tape(f).find((n) => n.text === text);
const middle = (n: UiNode): number => n.x + n.w / 2;
const pips = (f: UiFrame): UiNode[] => tape(f).filter((n) => n.key >= KEY_COMPASS + 80 && n.key < KEY_COMPASS + 98);

test("turns go the short way round, and bearings follow the map's north and east", () => {
  expect(turnTo(359, 1)).toBe(2);
  expect(turnTo(1, 359)).toBe(-2);
  expect(turnTo(0, 180)).toBe(180);
  expect(bearingOf(0.5, 0.5, 0.6, 0.5, 1000, 1000)).toBeCloseTo(90);
  expect(bearingOf(0.5, 0.5, 0.5, 0.4, 1000, 1000)).toBeCloseTo(0);
  expect(bearingOf(0.5, 0.5, 0.4, 0.6, 1000, 1000)).toBeCloseTo(225);
});

test("the tape puts the heading in the middle, and slides left as the view turns right", () => {
  const f = build(model(0));
  expect(middle(letter(f, "N")!)).toBeCloseTo(f.width / 2, 0);
  expect(letter(f, "S")).toBeUndefined();
  const east = build(model(90));
  expect(middle(letter(east, "E")!)).toBeCloseTo(east.width / 2, 0);
  const n1 = middle(letter(build(model(350)), "N")!), n2 = middle(letter(build(model(10)), "N")!);
  expect(n1).toBeGreaterThan(f.width / 2);
  expect(n2).toBeLessThan(f.width / 2);
  // Ends fade: a letter near the edge is fainter than one in the middle.
  expect(letter(build(model(40)), "N")!.alpha).toBeLessThan(letter(f, "N")!.alpha);
  // The degrees show only while H is held.
  expect(tape(f).some((n) => n.text === "000")).toBe(false);
  expect(tape(build(model(312), 16 / 9, OPTIONS, true)).some((n) => n.text === "312")).toBe(true);
});

test("the spring swings a quick turn a little past and settles; a great turn is jumped", () => {
  const c = new Compass();
  c.set(0, 0);
  let most = 0, t = 0;
  for (; t <= 600; t += 16) {
    c.step(90, t);
    most = Math.max(most, c.heading);
  }
  expect(Math.abs(c.heading - 90)).toBeLessThan(0.5);
  expect(most).toBeGreaterThan(90.2);
  expect(most).toBeLessThan(94);
  // Through north the short way, and the crossing is marked.
  c.set(350, t);
  c.step(20, t + 16);
  for (let s = 2; s < 40; s++) c.step(20, t + s * 16);
  expect(c.heading).toBeCloseTo(20, 0);
  expect(c.northAt).toBeGreaterThan(t);
  c.step(200, t + 1000);
  expect(c.heading).toBeCloseTo(200, 6);
});

test("friends and a body are pips at their bearings, pinned to the near end when behind; creatures are not", () => {
  const marks = [{ kind: "mate" as const, east: 100, north: 0 }, { kind: "creature" as const, east: 0, north: 50 }];
  const north = build(model(0, marks));
  expect(pips(north).length).toBe(1);
  const pinned = pips(north)[0]!;
  expect(pinned.alpha).toBeLessThan(0.6);
  expect(middle(pinned)).toBeGreaterThan(north.width / 2 + 100);
  const facing = build(model(90, marks));
  expect(middle(pips(facing)[0]!)).toBeCloseTo(facing.width / 2, 0);
  expect(pips(facing)[0]!.alpha).toBeGreaterThan(0.9);
  // Where a rule hides the reader's place there is no self marker, so no pips and no arrow.
  const hidden = model(0, marks);
  hidden.markers.shift();
  const f = build(hidden);
  expect(pips(f).length).toBe(0);
  expect(f.find(KEY_SELF_ARROW)).toBeNull();
  expect(letter(f, "N")).toBeDefined();
});

test("the reader is an arrow on the minimap, the way it faces, not a square", () => {
  const f = build(model(90, [{ kind: "mate", east: 50, north: 50 }]));
  const arrow = f.find(KEY_SELF_ARROW)!;
  expect(arrow.kind).toBe(K_IMAGE);
  expect(arrow.image).toBe(IMAGE_ARROW);
  expect(arrow.sw).toBe(CELL);
  const map = nodes(f).find((n) => n.kind === K_IMAGE && n.w === MINIMAP_SIZE)!;
  expect(middle(arrow)).toBeCloseTo(map.x + MINIMAP_SIZE / 2, 0);
  // One marker square, the mate's.
  expect(nodes(f).filter((n) => n.key >= KEY_MARKER && n.key < KEY_MARKER + 256).length).toBe(1);
  // Every picture has slots of the frame's image table to itself: the hearts take a run of them, the icons all from theirs on.
  const runs: [string, number, number][] = [["minimap", IMAGE_MINIMAP, IMAGE_MINIMAP], ["map", IMAGE_MAP, IMAGE_MAP], ["hearts", IMAGE_HEART, IMAGE_HEART + MATING_STEPS], ["dial", IMAGE_DIAL, IMAGE_DIAL], ["skin", IMAGE_SKIN, IMAGE_SKIN], ["touch", IMAGE_TOUCH, IMAGE_TOUCH], ["arrow", IMAGE_ARROW, IMAGE_ARROW], ["icons", IMAGE_ICONS, Infinity]];
  for (const [a, a0, a1] of runs) for (const [b, b0, b1] of runs) if (a !== b) expect(a1 < b0 || b1 < a0, `${a} and ${b} share a slot`).toBe(true);
  expect(arrowCell(359.9)).toBe(0);
  expect(arrowCell(90)).toBe(ARROW_STEPS / 4);
});

test("each picture on the sheet points its heading's way, over clear pixels", () => {
  const sheet = arrowSheet();
  const grid = sheet.width / CELL;
  /** The alpha at `ahead` shares of the cell's half-side from its middle, toward `toward` degrees, in the picture of `heading`. */
  const alphaAt = (heading: number, toward: number, ahead: number): number => {
    const cell = arrowCell(heading), ox = (cell % grid) * CELL, oy = Math.floor(cell / grid) * CELL;
    const r = (toward * Math.PI) / 180, x = Math.floor(CELL / 2 + Math.sin(r) * ahead * CELL / 2), y = Math.floor(CELL / 2 - Math.cos(r) * ahead * CELL / 2);
    return sheet.data[((oy + y) * sheet.width + ox + x) * 4 + 3]!;
  };
  for (const heading of [0, 45, 90, 180, 270]) {
    // Solid at its tip, clear behind its tail, and the faint wedge ahead past the tip.
    expect(alphaAt(heading, heading, 0.4)).toBeGreaterThan(200);
    expect(alphaAt(heading, heading + 180, 0.45)).toBe(0);
    expect(alphaAt(heading, heading, 0.8)).toBeGreaterThan(0);
    expect(alphaAt(heading, heading, 0.8)).toBeLessThan(100);
  }
  expect(sheet.data[(1 * sheet.width + 1) * 4 + 3]).toBe(0);
});

test("the tape keeps out of the way: a scope, the map screen, the setting, the minimap and a finger's bar", () => {
  for (const hide of [(m: HudModel) => void (m.scope = true), (m: HudModel) => void (m.out = true), (m: HudModel) => void (m.bare = true), (m: HudModel) => void (m.orbit = true)]) {
    const m = model(0);
    hide(m);
    expect(tape(build(m)).length).toBe(0);
  }
  expect(tape(build(model(0), 16 / 9, { ...OPTIONS, compass: false })).length).toBe(0);
  // On the narrowest canvas it stands left of the minimap, clear of it.
  const narrow = build(model(0), 9 / 16);
  const map = nodes(narrow).find((n) => n.kind === K_IMAGE && n.w === MINIMAP_SIZE)!;
  expect(tape(narrow).length).toBeGreaterThan(0);
  for (const n of tape(narrow)) expect(n.x + n.w).toBeLessThanOrEqual(map.x);
  // By touch, clear of the bar and the vitals, or left out where there is no room between them and the minimap.
  for (const aspect of [9 / 16, 16 / 9, 2.2]) {
    const f = new UiFrame();
    f.begin(aspect);
    const plan = touchPlan(f, false);
    buildHud(f, model(0), OPTIONS, true, false, plan);
    for (const n of tape(f)) {
      expect(n.x).toBeGreaterThanOrEqual(plan.topEnd);
      expect(n.x + n.w).toBeLessThanOrEqual(f.width - f.right - 12 - plan.map);
    }
    if (aspect > 1) expect(tape(f).length).toBeGreaterThan(0);
  }
  // The offer to unmute stands under it.
  const m = model(0), f = build(m);
  expect(m.compassBottom).toBeGreaterThan(0);
  unmuteButton(f, null, null, m.compassBottom);
  const offer = nodes(f).filter((n) => n.interactive && n.label === "Sound is off: unmute")[0]!;
  expect(offer.y).toBeGreaterThanOrEqual(m.compassBottom);
  for (const n of tape(f)) expect(n.y + n.h).toBeLessThanOrEqual(offer.y);
});
