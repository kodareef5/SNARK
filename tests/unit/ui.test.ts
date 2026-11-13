import { expect, test } from "bun:test";
import { Controls, LOOK_SPEED } from "../../client/core/controls.ts";
import { HudModel } from "../../client/core/hud.ts";
import { ConsoleState, KEY_CONSOLE_INPUT, KEY_CONSOLE_PANEL, KEY_CONSOLE_ROW, MAX_LINE } from "../../client/core/ui/console.ts";
import { KEY_BANNER, KEY_CROSS, KEY_MARKER, KEY_MINIMAP, KEY_READOUT, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { K_BAR, K_INPUT, K_TEXT, textWidth, wrap, type UiFrame } from "../../client/core/ui/nodes.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { BTN_JUMP, BTN_PRIMARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";

const ASPECTS: [string, number][] = [["4:3", 4 / 3], ["16:9", 16 / 9], ["21:9", 21 / 9], ["phone upright", 9 / 16]];

/** A HUD with the widest numbers it can show. */
function fullHud(): HudModel {
  const m = new HudModel();
  m.lat = 100;
  m.lon = 100;
  m.heading = 359;
  m.compass = "NW";
  m.x = 8191.9;
  m.y = -1023.9;
  m.z = 8191.9;
  m.speed = 60;
  m.fps = 144;
  m.pingMs = 1000;
  m.corrections = 99999;
  m.nearby = 512;
  m.formatReadout();
  m.clock = "23:59";
  m.status = "disconnected (reason -2)";
  m.banner = "SPECTATING";
  m.vitals.push({ id: "oxygen", label: "Oxygen", fraction: 0.5 });
  for (let i = 0; i < 80; i++) m.markers.push({ kind: i % 2 ? "player" : "creature", u: (i % 9) / 8, v: (i % 7) / 6 });
  m.markers.push({ kind: "self", u: 1, v: 1 });
  return m;
}

function overlaps(f: UiFrame, a: number, b: number): boolean {
  const p = f.nodes[a]!;
  const q = f.nodes[b]!;
  return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
}

test("every screen fits every window shape: nothing off the canvas, no clipped text, no stacked controls", () => {
  for (const [name, aspect] of ASPECTS) {
    for (const consoleOpen of [false, true]) {
      const ui = new Ui();
      ui.console.open = consoleOpen;
      for (let i = 0; i < 60; i++) ui.console.print(`line ${i} ` + "word ".repeat(i));
      ui.console.edit("x".repeat(200));
      ui.build(aspect, fullHud(), null);
      const f = ui.frame;
      expect(f.height).toBe(720);
      expect(f.width).toBe(Math.round(720 * aspect));
      const keys = new Set<number>();
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        const where = `${name} console=${consoleOpen} key=${n.key}`;
        expect(keys.has(n.key), where).toBe(false);
        keys.add(n.key);
        // Minimap markers may hang two units over the map's edge; everything else is inside the canvas.
        expect(n.x, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.y, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.x + n.w, where).toBeLessThanOrEqual(f.width + 0.01);
        expect(n.y + n.h, where).toBeLessThanOrEqual(f.height + 0.01);
        expect(n.w, where).toBeGreaterThan(0);
        expect(n.h, where).toBeGreaterThan(0);
        if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), where).toBeLessThanOrEqual(n.w + 0.01);
        if (n.kind === K_BAR) expect(n.value >= 0 && n.value <= 1, where).toBe(true);
      }
      // Controls never share space, and text never runs over other text.
      for (let a = 0; a < f.count; a++) {
        for (let b = a + 1; b < f.count; b++) {
          const p = f.nodes[a]!;
          const q = f.nodes[b]!;
          if (p.interactive && q.interactive) expect(overlaps(f, a, b), `${name}: controls ${p.key} and ${q.key}`).toBe(false);
          const consoleRow = (k: number) => k >= KEY_CONSOLE_PANEL;
          // The console covers the HUD on purpose; within one layer, text must not collide.
          if (p.kind === K_TEXT && q.kind === K_TEXT && consoleRow(p.key) === consoleRow(q.key)) {
            expect(overlaps(f, a, b), `${name}: text ${p.key} "${p.text}" and ${q.key} "${q.text}"`).toBe(false);
          }
        }
      }
      expect(f.find(KEY_READOUT)!.text).toBe("100.0 lat  100.0 lon  NW 359");
      expect(f.find(KEY_MINIMAP)).not.toBeNull();
      expect(f.find(KEY_VITAL + 9)!.value).toBe(0.5);
      expect(f.find(KEY_BANNER)!.text).toBe("SPECTATING");
      expect(f.find(KEY_CONSOLE_INPUT) !== null).toBe(consoleOpen);
      // At most 64 markers are drawn, and the local player is the last, so it is on top.
      let markers = 0;
      for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_MARKER && f.nodes[i]!.key < KEY_MARKER + 100) markers++;
      expect(markers).toBe(64);
    }
  }
});

test("the HUD hides the crosshair and shows a banner only when the model says so", () => {
  const ui = new Ui();
  const m = new HudModel();
  ui.build(16 / 9, m, null);
  expect(ui.frame.find(KEY_CROSS)).not.toBeNull();
  expect(ui.frame.find(KEY_BANNER)).toBeNull();
  m.crosshair = false;
  m.banner = "DEAD";
  ui.build(16 / 9, m, null);
  expect(ui.frame.find(KEY_CROSS)).toBeNull();
  expect(ui.frame.find(KEY_BANNER)!.text).toBe("DEAD");
});

test("the console edits a line, sends it once, and browses history without losing what was being typed", () => {
  const c = new ConsoleState();
  const sent: string[] = [];
  const send = (line: string) => sent.push(line);
  c.edit("  help  ");
  c.submit(send);
  c.submit(send); // an empty line sends nothing
  c.edit("who");
  c.submit(send);
  c.edit("who");
  c.submit(send); // the same line twice is one history entry
  expect(sent).toEqual(["help", "who", "who"]);
  expect(c.history).toEqual(["help", "who"]);
  expect(c.lines).toEqual(["> help", "> who", "> who"]);
  expect(c.input).toBe("");

  c.edit("half typed");
  c.recall(1); // nothing newer than the line being typed
  expect(c.input).toBe("half typed");
  c.recall(-1);
  expect(c.input).toBe("who");
  c.recall(-1);
  c.recall(-1); // stops at the oldest
  expect(c.input).toBe("help");
  c.recall(1);
  c.recall(1); // past the newest: back to the draft
  expect(c.input).toBe("half typed");
  c.edit("z".repeat(500));
  expect(c.input.length).toBe(MAX_LINE);
  for (let i = 0; i < 80; i++) {
    c.edit("line " + i);
    c.submit(send);
  }
  expect(c.history.length).toBe(50);
  expect(c.history[49]).toBe("line 79");
});

test("console keys: one press toggles once, the open console owns the keyboard, and paging stays in range", () => {
  const ui = new Ui();
  ui.build(16 / 9, new HudModel(), null);
  expect(ui.wantsPointerLock).toBe(true);
  expect(ui.key("KeyW", true, false, null)).toBe(false);
  expect(ui.key("Backquote", true, false, null)).toBe(true);
  expect(ui.key("Backquote", true, true, null)).toBe(true); // held: still ours, but no second toggle
  expect(ui.console.open).toBe(true);
  expect(ui.captureKeyboard).toBe(true);
  expect(ui.wantsPointerLock).toBe(false);
  expect(ui.key("KeyW", true, false, null)).toBe(false); // typed into the field by the browser
  expect(ui.key("Tab", true, false, null)).toBe(true); // not allowed to move focus away
  expect(ui.console.open).toBe(true);

  for (let i = 0; i < 100; i++) ui.console.print("row " + i);
  ui.build(16 / 9, new HudModel(), null);
  const rows = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < ui.frame.count; i++) if (ui.frame.nodes[i]!.key >= KEY_CONSOLE_ROW) out.push(ui.frame.nodes[i]!.text);
    return out;
  };
  const shown = rows().length;
  expect(shown).toBeGreaterThan(8);
  expect(rows().at(-1)).toBe("row 99");
  ui.key("PageUp", true, false, null);
  ui.build(16 / 9, new HudModel(), null);
  expect(rows().at(-1)).toBe(`row ${99 - (shown - 1)}`);
  for (let i = 0; i < 50; i++) ui.key("PageUp", true, false, null);
  ui.build(16 / 9, new HudModel(), null);
  expect(rows()[0]).toBe("row 0"); // clamped at the top
  for (let i = 0; i < 50; i++) ui.key("PageDown", true, false, null);
  ui.build(16 / 9, new HudModel(), null);
  expect(rows().at(-1)).toBe("row 99");

  const field = ui.frame.find(KEY_CONSOLE_INPUT)!;
  expect(field.kind).toBe(K_INPUT);
  expect(field.focus).toBe(true);
  ui.input(KEY_CONSOLE_INPUT, "pos");
  ui.build(16 / 9, new HudModel(), null);
  expect(ui.frame.find(KEY_CONSOLE_INPUT)!.text).toBe("pos");
  expect(ui.key("Escape", true, false, null)).toBe(true);
  expect(ui.console.open).toBe(false);
  expect(ui.key("Tab", true, false, null)).toBe(true); // Tab opens it too
  expect(ui.console.open).toBe(true);
});

test("long lines wrap at spaces, and hard-break when a word is wider than the console", () => {
  const out: string[] = [];
  wrap("the quick brown fox jumps", 10, out);
  expect(out).toEqual(["the quick", "brown fox", "jumps"]);
  out.length = 0;
  wrap("abcdefghijklmnop qr", 5, out);
  expect(out).toEqual(["abcde", "fghij", "klmno", "p qr"]);
  out.length = 0;
  wrap("", 5, out);
  expect(out).toEqual([""]);
});

test("controls: keys and mouse become one input sample", () => {
  const c = new Controls();
  expect(c.key("KeyW", true)).toBe(true);
  expect(c.key("KeyD", true)).toBe(true);
  expect([c.moveX, c.moveZ]).toEqual([1, 1]);
  c.key("KeyA", true); // opposite keys cancel
  expect(c.moveX).toBe(0);
  c.key("Space", true);
  c.key("ShiftLeft", true);
  c.key("KeyE", true);
  c.mouseButton(0, true);
  c.mouseButton(2, true); // only the primary button is bound
  expect(c.buttons).toBe(BTN_JUMP | BTN_SPRINT | BTN_USE | BTN_PRIMARY);
  c.key("Space", false);
  c.mouseButton(0, false);
  expect(c.buttons).toBe(BTN_SPRINT | BTN_USE);
  expect(c.key("KeyQ", true)).toBe(false);
  c.release();
  expect([c.moveX, c.moveZ, c.buttons]).toEqual([0, 0, 0]);

  c.look(100, 0); // right turn lowers yaw
  expect(c.yaw).toBeCloseTo(-100 * LOOK_SPEED, 10);
  c.look(0, -100000); // looking up stops short of straight up
  expect(c.pitch).toBe(1.5);
  c.look(0, 100000);
  expect(c.pitch).toBe(-1.5);
});
