import { expect, test } from "bun:test";
import { HudModel } from "../../client/core/hud.ts";
import { KEY_TOUCH_BUTTON, KEY_ZONE_LOOK, KEY_ZONE_MOVE, T_ATTACK, T_AIM, T_MORE, T_SHIFT, T_STANCE, T_SIC, TouchPlay, type TouchTarget } from "../../client/core/touch.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { touchControls, touchZones } from "../../client/core/ui/touch.ts";

function rig() {
  const edges: string[] = [];
  const target: TouchTarget = {
    move: (x, z) => edges.push(`move ${x} ${z}`),
    look: (x, y) => edges.push(`look ${x} ${y}`),
    key: (key, down) => edges.push(`${key} ${down}`),
    mouse: (button, down) => edges.push(`mouse ${button} ${down}`),
    cancelPrimary: () => edges.push("cancel"),
  };
  const touch = new TouchPlay();
  const pointer = (kind: number, key: number, x: number, y: number, finger: number, ms: number) => {
    touch.pointer(kind, key, x, y, finger, ms, target, 1);
  };
  return { touch, edges, pointer, target };
}

test("Both field contacts appear under the player’s fingers and vanish on lift", () => {
  const { touch, pointer } = rig(), frame = new UiFrame(), hud = new HudModel();
  const samples: string[] = [];
  frame.icons = { place: (_n, id) => { samples.push(id); return true; } };
  const draw = () => {
    samples.length = 0;
    frame.begin(16 / 9);
    touchZones(frame);
    touchControls(frame, touch, hud, "foot", 0, frame.height, 0);
    return [...samples];
  };
  expect(draw()).toEqual([]);
  expect(frame.find(KEY_ZONE_MOVE)!.w).toBe(frame.width / 2);
  expect(frame.find(KEY_ZONE_LOOK)!.x).toBe(frame.width / 2);
  expect(frame.find(KEY_TOUCH_BUTTON + T_ATTACK)).toBeNull();
  hud.hotbar = [{ id: "core:stone_pick", label: "Pick", number: "", tint: 0 }];
  hud.held = 0;
  pointer(0, KEY_ZONE_MOVE, 200, 240, 7, 0);
  pointer(0, KEY_ZONE_LOOK, 750, 320, 8, 0);
  expect(draw()).toEqual(["ui:glass-touch-move", "ui:glass-touch-knob", "ui:glass-touch-look", "core:stone_pick"]);
  pointer(3, KEY_ZONE_LOOK, 750, 320, 8, 70);
  expect(draw()).toEqual(["ui:glass-touch-move", "ui:glass-touch-knob"]);
  pointer(1, KEY_ZONE_MOVE, 200, 240, 7, 90);
  expect(draw()).toEqual([]);
});

test("A quick right tap uses the held tool through one input sample", () => {
  const { touch, pointer, target, edges } = rig();
  pointer(0, KEY_ZONE_LOOK, 730, 280, 1, 0);
  pointer(2, KEY_ZONE_LOOK, 734, 283, 1, 20);
  expect(edges).toEqual([]);
  pointer(1, KEY_ZONE_LOOK, 734, 283, 1, 30);
  expect(edges).toEqual(["mouse 0 true"]);
  touch.sampled(target);
  touch.sampled(target);
  pointer(1, KEY_ZONE_LOOK, 734, 283, 1, 50);
  expect(edges).toEqual(["mouse 0 true", "mouse 0 false"]);
});

test("A right drag, a long press and a canceled touch cannot use a tool", () => {
  const { touch, pointer, target, edges } = rig();
  touch.width = 844; touch.height = 390;
  pointer(0, KEY_ZONE_LOOK, 500, 280, 1, 0);
  pointer(2, KEY_ZONE_LOOK, 200, 280, 1, 10);
  pointer(2, KEY_ZONE_LOOK, 500, 280, 1, 20);
  pointer(1, KEY_ZONE_LOOK, 500, 280, 1, 30);
  expect(edges.filter(s => s.startsWith("look"))).toHaveLength(2);
  pointer(0, KEY_ZONE_LOOK, 500, 280, 1, 100);
  pointer(1, KEY_ZONE_LOOK, 500, 280, 1, 630);
  pointer(0, KEY_ZONE_LOOK, 500, 280, 1, 700);
  pointer(3, KEY_ZONE_LOOK, 500, 280, 1, 720);
  pointer(0, KEY_ZONE_LOOK, 843, 280, 1, 730);
  pointer(1, KEY_ZONE_LOOK, 845, 280, 1, 740);
  touch.sampled(target);
  expect(edges.filter(s => s.startsWith("mouse"))).toEqual([]);
});

test("Opening a modal releases walking and discards an armed field contact", () => {
  const { touch, pointer, target, edges } = rig();
  pointer(0, KEY_ZONE_MOVE, 50, 150, 1, 0);
  pointer(2, KEY_ZONE_MOVE, 50, 80, 1, 50);
  pointer(0, KEY_ZONE_LOOK, 500, 280, 2, 100);
  touch.frame(110, 0, target, false);
  pointer(1, KEY_ZONE_LOOK, 500, 280, 2, 140);
  expect([touch.stick, touch.action]).toEqual([false, false]);
  expect(edges).toEqual(["move 0 1", "ShiftLeft true", "move 0 0", "ShiftLeft false"]);
});

test("Canceling a held attack or stance releases it without committing", () => {
  const { touch, pointer, target, edges } = rig();
  pointer(0, KEY_TOUCH_BUTTON + T_ATTACK, 670, 380, 1, 0);
  pointer(3, KEY_TOUCH_BUTTON + T_ATTACK, 670, 380, 1, 100);
  pointer(0, KEY_TOUCH_BUTTON + T_STANCE, 640, 380, 2, 100);
  pointer(3, KEY_TOUCH_BUTTON + T_STANCE, 640, 380, 2, 180);
  for (const button of [T_AIM, T_MORE, T_SHIFT, T_SIC]) {
    pointer(0, KEY_TOUCH_BUTTON + button, 640, 380, 2, 200);
    pointer(3, KEY_TOUCH_BUTTON + button, 640, 380, 2, 240);
    pointer(0, KEY_TOUCH_BUTTON + button, 640, 380, 2, 250);
    pointer(2, KEY_TOUCH_BUTTON + button, 680, 380, 2, 260);
    pointer(1, KEY_TOUCH_BUTTON + button, 640, 380, 2, 280);
  }
  touch.sampled(target);
  expect(touch.aiming || touch.more || touch.shifted).toBe(false);
  expect(edges).toEqual(["mouse 0 true", "cancel"]);
});
