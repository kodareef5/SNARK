import { expect, test } from "bun:test";
import { Controls, LOOK_SPEED } from "../../client/core/controls.ts";
import { HudModel } from "../../client/core/hud.ts";
import { ConsoleState, KEY_CONSOLE_INPUT, KEY_CONSOLE_PANEL, KEY_CONSOLE_ROW, MAX_LINE } from "../../client/core/ui/console.ts";
import { KEY_BANNER, KEY_CROSS, KEY_MARKER, KEY_MINIMAP, KEY_READOUT, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { K_BAR, K_INPUT, K_TEXT, textWidth, wrap, type UiFrame } from "../../client/core/ui/nodes.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_INV_INFO, KEY_INV_PANEL, KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { KEY_MAP_IMAGE, KEY_MAP_LINE, KEY_MAP_PIN, KEY_RESPAWN_BUTTON, KEY_RESPAWN_PANEL } from "../../client/core/ui/screens.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CMD_MOVE, CMD_RESPAWN, CMD_USE, MARKER_DEATH, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { flatWorld } from "../fixtures/world.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { coreRegistry } from "../fixtures/world.ts";
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
  m.vitals[4]!.fraction = 0.5;
  for (let i = 0; i < 80; i++) m.markers.push({ kind: i % 2 ? "player" : "creature", u: (i % 9) / 8, v: (i % 7) / 6 });
  m.markers.push({ kind: "self", u: 1, v: 1 });
  return m;
}

const reg = coreRegistry();
const stone = reg.index.get("core:stone")!;
const berry = reg.index.get("core:berry")!;

/** Just enough of a session for the interface: an inventory, a clock, and a record of what was sent. */
function fakeSession(inv: Inventory) {
  const sent: { op: number; bytes: Uint8Array }[] = [];
  const session = {
    inventory: inv,
    serverTick: 1000,
    logVersion: 0,
    log: [],
    command(op: number, args?: (w: BitWriter) => void): number {
      const w = new BitWriter(32);
      args?.(w);
      sent.push({ op, bytes: w.bytes().slice() });
      return sent.length;
    },
  } as unknown as ClientSession;
  return { session, sent };
}

function fullInventory(): Inventory {
  const inv = new Inventory(40);
  for (let s = 0; s < 40; s++) inv.set(s, s % 3 === 0 ? berry : stone, 100, 0, 0, s % 3 === 0 ? 99999 : 0);
  return inv;
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
      ui.registry = reg;
      ui.console.open = consoleOpen;
      ui.inventory.open = true;
      ui.inventory.hover = 3;
      for (let i = 0; i < 60; i++) ui.console.print(`line ${i} ` + "word ".repeat(i));
      ui.console.edit("x".repeat(200));
      ui.build(aspect, fullHud(), fakeSession(fullInventory()).session);
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
          // Layers: the HUD, the console, a screen. One may cover another on purpose;
          // within a layer, text must not collide.
          const layer = (k: number) => (k >= KEY_INV_PANEL ? 2 : k >= KEY_CONSOLE_PANEL ? 1 : 0);
          if (p.kind === K_TEXT && q.kind === K_TEXT && layer(p.key) === layer(q.key)) {
            expect(overlaps(f, a, b), `${name}: text ${p.key} "${p.text}" and ${q.key} "${q.text}"`).toBe(false);
          }
        }
      }
      expect(f.find(KEY_READOUT)!.text).toBe("100.0 lat  100.0 lon  NW 359");
      expect(f.find(KEY_MINIMAP)).not.toBeNull();
      expect(f.find(KEY_VITAL + 9)!.value).toBe(0.5);
      expect(f.find(KEY_BANNER)!.text).toBe("SPECTATING");
      expect(f.find(KEY_CONSOLE_INPUT) !== null).toBe(consoleOpen);
      // All forty slots are on the canvas, each with its count; under the console the screen is not drawn at all.
      expect(f.find(KEY_INV_PANEL) !== null).toBe(!consoleOpen);
      if (!consoleOpen) {
        expect(f.find(KEY_INV_SLOT + 39 * 3)!.interactive).toBe(true);
        expect(f.find(KEY_INV_SLOT + 39 * 3 + 2)!.text).toBe("100");
        expect(f.find(KEY_INV_INFO)!.text).toContain("berry x100");
      }
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

test("the inventory screen turns clicks into commands and never changes anything by itself", () => {
  const inv = new Inventory(40);
  inv.set(0, stone, 80, 0, 0, 0);
  inv.set(5, berry, 9, 0, 0, 5000);
  const { session, sent } = fakeSession(inv);
  const ui = new Ui();
  ui.registry = reg;
  const key = (slot: number) => KEY_INV_SLOT + slot * 3;
  const decode = (bytes: Uint8Array): number[] => {
    const r = new BitReader(bytes);
    return [r.bits(1), r.u8(), r.bits(1), r.u8(), r.u16(), r.u16()];
  };

  // Closed: clicks do nothing. I opens it; the mouse is then free, and the keyboard still walks.
  ui.pointer(0, key(0), 0, 0, 0, session);
  expect(ui.key("KeyI", true, false, session)).toBe(true);
  expect(ui.inventory.open).toBe(true);
  expect(ui.wantsPointerLock).toBe(false);
  expect(ui.captureKeyboard).toBe(false);
  expect(ui.key("KeyW", true, false, session)).toBe(false);

  // Click a stack, click an empty slot: one move of the whole stack, naming what the client thinks it is moving.
  ui.pointer(0, key(0), 0, 0, 0, session);
  expect(ui.inventory.held).toBe(0);
  expect(sent.length).toBe(0);
  ui.pointer(0, key(7), 0, 0, 0, session);
  expect(sent.map((c) => c.op)).toEqual([CMD_MOVE]);
  expect(decode(sent[0]!.bytes)).toEqual([0, 0, 0, 7, 0, stone]);
  expect(ui.inventory.held).toBe(-1);
  expect(inv.count[0]).toBe(80); // the mirror waits for the server

  // Middle click picks up half; putting a stack back on its own slot cancels; an empty slot cannot be picked up.
  ui.pointer(0, key(5), 0, 0, 1, session);
  ui.pointer(0, key(6), 0, 0, 0, session);
  expect(decode(sent[1]!.bytes)).toEqual([0, 5, 0, 6, 4, berry]);
  ui.pointer(0, key(0), 0, 0, 0, session);
  ui.pointer(0, key(0), 0, 0, 0, session);
  ui.pointer(0, key(20), 0, 0, 0, session);
  expect(sent.length).toBe(2);
  expect(ui.inventory.held).toBe(-1);

  // Right click uses; on an empty slot it does nothing.
  ui.pointer(0, key(5), 0, 0, 2, session);
  ui.pointer(0, key(21), 0, 0, 2, session);
  expect(sent.map((c) => c.op)).toEqual([CMD_MOVE, CMD_MOVE, CMD_USE]);
  const r = new BitReader(sent[2]!.bytes);
  expect([r.u8(), r.u16()]).toEqual([5, berry]);

  // A held stack that the server takes away is let go of; hovering describes a stack.
  ui.pointer(0, key(5), 0, 0, 0, session);
  inv.set(5, 0, 0, 0, 0, 0);
  ui.build(16 / 9, new HudModel(), session);
  expect(ui.inventory.held).toBe(-1);
  ui.pointer(2, key(0), 0, 0, 0, session);
  ui.build(16 / 9, new HudModel(), session);
  expect(ui.frame.find(KEY_INV_INFO)!.text).toBe("stone x80  40.0 kg");
  expect(ui.frame.find(key(0) + 1)!.text).toBe("ston");
  expect(ui.key("Escape", true, false, session)).toBe(true);
  expect(ui.inventory.open).toBe(false);
  expect(ui.wantsPointerLock).toBe(true);
});

test("the respawn and map screens fit every window shape, and a click on a place asks to return there", () => {
  const world = flatWorld(8);
  for (const [name, aspect] of ASPECTS) {
    for (const dead of [true, false]) {
      const { session, sent } = fakeSession(new Inventory(40));
      Object.assign(session, {
        sessionState: dead ? SESSION_DEAD : SESSION_ALIVE,
        respawnPoints: [{ name: "Plaza", x: 1, z: 1 }, { name: "a place with a long name", x: 2, z: 2 }, { name: "Poolside", x: 3, z: 3 }],
        markers: [1, 2, 3, 4, 5].map((i) => ({ kind: MARKER_DEATH, x: i * 100, y: 0, z: 511 - i * 90, tick: 100 * i })),
        world,
        own: { x: 256, y: 0, z: 256 },
        serverTick: 99999,
      });
      const ui = new Ui();
      ui.registry = reg;
      if (!dead) expect(ui.key("KeyM", true, false, session)).toBe(true);
      ui.build(aspect, fullHud(), session);
      const f = ui.frame;
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        const where = `${name} dead=${dead} key=${n.key}`;
        expect(n.x, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.y, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.x + n.w, where).toBeLessThanOrEqual(f.width + 0.01);
        expect(n.y + n.h, where).toBeLessThanOrEqual(f.height + 0.01);
        if (n.kind === K_TEXT && n.key >= KEY_RESPAWN_PANEL) expect(textWidth(n.text, n.style), where).toBeLessThanOrEqual(n.w + 0.01);
        for (let j = i + 1; j < f.count; j++) if (n.interactive && f.nodes[j]!.interactive) expect(overlaps(f, i, j), where).toBe(false);
      }
      expect(ui.wantsPointerLock).toBe(false);
      if (dead) {
        // Three places, three buttons; the map does not open over the choice.
        expect(f.find(KEY_RESPAWN_BUTTON + 2)!.text).toBe("Poolside");
        expect(f.find(KEY_MAP_IMAGE)).toBeNull();
        ui.pointer(0, KEY_RESPAWN_BUTTON + 1, 0, 0, 0, session);
        ui.pointer(0, KEY_RESPAWN_BUTTON + 7, 0, 0, 0, session); // not a button
        expect(sent.map((c) => [c.op, c.bytes[0]])).toEqual([[CMD_RESPAWN, 1]]);
      } else {
        // The map: the picture, a pin per death and one for the survivor, and a line per death.
        expect(f.find(KEY_RESPAWN_PANEL)).toBeNull();
        expect(f.find(KEY_MAP_IMAGE)!.w).toBe(f.find(KEY_MAP_IMAGE)!.h);
        expect(f.find(KEY_MAP_PIN + 4)).not.toBeNull();
        expect(f.find(KEY_MAP_PIN + 16)).not.toBeNull();
        expect(f.find(KEY_MAP_LINE + 4)!.text).toMatch(/^died  \d+\.\d lat  \d+\.\d lon  \d+ min ago$/);
        ui.pointer(0, KEY_RESPAWN_BUTTON, 0, 0, 0, session);
        expect(sent.length).toBe(0);
        expect(ui.key("Escape", true, false, session)).toBe(true);
        expect(ui.map).toBe(false);
      }
    }
  }
});
