import { expect, test } from "bun:test";
import { Controls, LOOK_SPEED } from "../../client/core/controls.ts";
import { HudModel } from "../../client/core/hud.ts";
import { KEY_CHAT_INPUT, KEY_CHAT_PANEL, KEY_CHAT_ROW, KEY_CHAT_TAG } from "../../client/core/ui/chat.ts";
import { ConsoleState, KEY_CONSOLE_INPUT, KEY_CONSOLE_PANEL, KEY_CONSOLE_ROW, MAX_LINE } from "../../client/core/ui/console.ts";
import { KEY_BANNER, KEY_CROSS, KEY_MARKER, KEY_MINIMAP, KEY_READOUT, KEY_VITAL, KEY_VOICE } from "../../client/core/ui/hud.ts";
import { K_BAR, K_INPUT, K_TEXT, textWidth, wrap, type UiFrame } from "../../client/core/ui/nodes.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_INV_INFO, KEY_INV_PANEL, KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { KEY_MAP_IMAGE, KEY_MAP_LINE, KEY_MAP_PIN, KEY_RESPAWN_BUTTON, KEY_RESPAWN_PANEL } from "../../client/core/ui/screens.ts";
import { KEY_CHAR_ENGRAM, KEY_CHAR_JOBS, KEY_CHAR_PAGE, KEY_CHAR_PANEL, KEY_CHAR_POINTS, KEY_CHAR_RECIPE, KEY_CHAR_STAT, KEY_CHAR_TAB, KEY_CHAR_TITLE, engramOrder } from "../../client/core/ui/character.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_RESPAWN, CMD_SPEND, CMD_USE, MARKER_DEATH, MAX_CHAT_CHARS, SESSION_ALIVE, SESSION_DEAD, TEXT_CONSOLE, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { flatWorld } from "../fixtures/world.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";

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
  m.voice = "voice: no microphone (refused, or none to be had)";
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
  const said: { channel: number; words: string }[] = [];
  const session = {
    inventory: inv,
    serverTick: 1000,
    logVersion: 0,
    log: [] as { channel: number; text: string }[],
    state: "active",
    globalChat: true,
    tribe: { team: 7, name: "", rank: 0, members: [], invite: "", inviteBy: "", version: 0 },
    chat(channel: number, words: string): number {
      said.push({ channel, words });
      return said.length;
    },
    command(op: number, args?: (w: BitWriter) => void): number {
      const w = new BitWriter(32);
      args?.(w);
      sent.push({ op, bytes: w.bytes().slice() });
      return sent.length;
    },
  } as unknown as ClientSession;
  return { session, sent, said };
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
    for (const [consoleOpen, chatOpen] of [[false, false], [true, false], [false, true]] as const) {
      const ui = new Ui();
      ui.registry = reg;
      ui.console.open = consoleOpen;
      ui.inventory.open = true;
      ui.inventory.hover = 3;
      for (let i = 0; i < 60; i++) ui.console.print(`line ${i} ` + "word ".repeat(i));
      ui.console.edit("x".repeat(200));
      // Things said just now on every channel, long and short, and the box shut or open with a full line typed.
      for (let i = 0; i < 30; i++) ui.chat.print(TEXT_NOTICE + (i % 4), `ada: ${"W".repeat(i * 5)} and so on`, 1000);
      if (chatOpen) ui.chat.begin(TEXT_TRIBE, null);
      ui.chat.edit("y".repeat(300));
      const hud = fullHud();
      hud.prompt = "E  open ada's cache";
      hud.ammo = "stone arrow  1 / 1   (24 more)";
      hud.hotbar.push(...Array.from({ length: 10 }, (_, i) => ({ tint: 0x808080, label: "bow", number: String((i + 1) % 10) })));
      hud.combat.notice = "You killed a grazer, level 150";
      hud.combat.noticeAlpha = 1;
      ui.build(aspect, hud, fakeSession(fullInventory()).session);
      const f = ui.frame;
      expect(f.height).toBe(720);
      expect(f.width).toBe(Math.round(720 * aspect));
      const keys = new Set<number>();
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        const where = `${name} console=${consoleOpen} chat=${chatOpen} key=${n.key}`;
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
          // The marks of a fight (2000 and up) are drawn over the world wherever it happened; they are the HUD's.
          const layer = (k: number) => (k >= 2000 ? 0 : k >= KEY_INV_PANEL ? 2 : k >= KEY_CONSOLE_PANEL ? 1 : 0);
          if (p.kind === K_TEXT && q.kind === K_TEXT && layer(p.key) === layer(q.key)) {
            expect(overlaps(f, a, b), `${name}: text ${p.key} "${p.text}" and ${q.key} "${q.text}"`).toBe(false);
          }
        }
      }
      expect(f.find(KEY_READOUT)!.text).toBe("100.0 lat  100.0 lon  NW 359");
      expect(f.find(KEY_MINIMAP)).not.toBeNull();
      expect(f.find(KEY_VITAL + 9)!.value).toBe(0.5);
      expect(f.find(KEY_BANNER)!.text).toBe("SPECTATING");
      // What voice has to say fits its box, under the readout.
      const said = f.find(KEY_VOICE)!;
      expect(textWidth(said.text, said.style), name).toBeLessThanOrEqual(said.w);
      expect(said.y, name).toBeGreaterThanOrEqual(f.find(KEY_READOUT + 2)!.y + f.find(KEY_READOUT + 2)!.h);
      expect(f.find(KEY_CONSOLE_INPUT) !== null).toBe(consoleOpen);
      // What was said is on the canvas: the latest of it while the box is shut, more with the field while it is open.
      let rows = 0;
      for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_CHAT_ROW && f.nodes[i]!.key < KEY_CHAT_ROW + 14) rows++;
      expect(rows, name).toBeGreaterThanOrEqual(1);
      expect(rows, name).toBeLessThanOrEqual(chatOpen ? 8 : 6);
      expect(f.find(KEY_CHAT_INPUT) !== null).toBe(chatOpen);
      expect(f.find(KEY_CHAT_PANEL) !== null).toBe(chatOpen);
      if (chatOpen) {
        expect(f.find(KEY_CHAT_INPUT)!.text).toBe("y".repeat(MAX_CHAT_CHARS));
        expect(f.find(KEY_CHAT_TAG)!.text).toBe("Tribe");
      }
      // All forty slots are on the canvas, each with its count; under the console or the chat box the screen is not drawn at all.
      expect(f.find(KEY_INV_PANEL) !== null).toBe(!consoleOpen && !chatOpen);
      if (!consoleOpen && !chatOpen) {
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
  c.mouseButton(1, true); // the middle button is not bound
  expect(c.buttons).toBe(BTN_JUMP | BTN_SPRINT | BTN_USE | BTN_PRIMARY);
  c.mouseButton(2, true); // the right button is the secondary action, held with the left
  c.key("KeyR", true);
  c.key("KeyF", true);
  c.key("KeyN", true);
  expect(c.buttons).toBe(BTN_JUMP | BTN_SPRINT | BTN_USE | BTN_PRIMARY | BTN_SECONDARY | BTN_RELOAD | BTN_MELEE | BTN_MOD);
  for (const code of ["KeyR", "KeyF", "KeyN"]) c.key(code, false);
  c.key("Space", false);
  c.mouseButton(0, false);
  expect(c.buttons).toBe(BTN_SPRINT | BTN_USE | BTN_SECONDARY);
  c.mouseButton(2, false);
  expect(c.key("KeyQ", true)).toBe(false);
  c.release();
  expect([c.moveX, c.moveZ, c.buttons]).toEqual([0, 0, 0]);

  // Stance keys toggle: one press goes down, the next stands up, and the other key switches.
  expect(c.key("KeyC", true)).toBe(true);
  c.key("KeyC", true); // the key repeating while held changes nothing
  c.key("KeyC", false);
  expect(c.buttons).toBe(BTN_CROUCH);
  c.key("KeyX", true);
  c.key("KeyX", false);
  expect(c.buttons).toBe(BTN_PRONE);
  c.key("KeyX", true);
  c.key("KeyX", false);
  expect(c.buttons).toBe(0);
  // Sprinting stands a crouched body up and sprints; jumping stands it up and does not also jump.
  c.key("KeyC", true);
  c.key("KeyC", false);
  c.key("ShiftLeft", true);
  expect(c.buttons).toBe(BTN_SPRINT);
  c.key("ShiftLeft", false);
  c.key("KeyX", true);
  c.key("KeyX", false);
  c.key("ShiftLeft", true); // a body lying down does not get up to sprint
  expect(c.buttons).toBe(BTN_PRONE | BTN_SPRINT);
  c.key("ShiftLeft", false);
  c.key("Space", true);
  expect(c.buttons).toBe(0);
  c.key("Space", false);
  c.key("Space", true);
  expect(c.buttons).toBe(BTN_JUMP);
  c.key("Space", false);
  // Losing focus lets go of keys but not of a stance.
  c.key("KeyC", true);
  c.release();
  expect(c.buttons).toBe(BTN_CROUCH);
  c.key("KeyC", true);
  expect(c.buttons).toBe(0);

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

test("the character screen fits every window shape on every tab and page, and its buttons send what they say", () => {
  const engram = (name: string) => reg.index.get(name)!;
  const engrams = engramOrder(reg);
  const recipes = reg.defs.flatMap((d, k) => (d?.type === "recipe" ? [k] : []));
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(new Inventory(40));
    Object.assign(session, {
      sessionState: SESSION_ALIVE,
      ownKind: reg.index.get("core:survivor")!,
      // Level 20 with every engram learned but two: the lists are as long as they get.
      progress: { xp: 99999, level: 20, statPoints: 19, engramPoints: 250, engrams: engrams.filter((e) => e !== engram("core:engram-waterskin") && e !== engram("core:engram-rifle")), jobs: [{ recipe: reg.index.get("core:make-hatchet")!, left: 3, doneAt: 5 }], version: 1 },
    });
    const ui = new Ui();
    ui.registry = reg;
    expect(ui.key("KeyP", true, false, session)).toBe(true);
    expect(ui.wantsPointerLock).toBe(false);
    const f = ui.frame;
    const fits = (where: string): void => {
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        const at = `${where} key=${n.key}`;
        expect(n.x, at).toBeGreaterThanOrEqual(-0.01);
        expect(n.y, at).toBeGreaterThanOrEqual(-0.01);
        expect(n.x + n.w, at).toBeLessThanOrEqual(f.width + 0.01);
        expect(n.y + n.h, at).toBeLessThanOrEqual(f.height + 0.01);
        if (n.key >= KEY_CHAR_PANEL && n.kind === K_TEXT) expect(textWidth(n.text, n.style), at).toBeLessThanOrEqual(n.w + 0.01);
        for (let j = i + 1; j < f.count; j++) {
          const q = f.nodes[j]!;
          if (n.interactive && q.interactive) expect(overlaps(f, i, j), at).toBe(false);
          if (n.key >= KEY_CHAR_PANEL && q.key >= KEY_CHAR_PANEL && n.kind === K_TEXT && q.kind === K_TEXT) expect(overlaps(f, i, j), `${at} and ${q.key}`).toBe(false);
        }
      }
    };
    /** Find a row by going through the pages of the tab shown; returns whether it was found, leaving its page up. */
    const seek = (key: number): boolean => {
      for (ui.sheet.page = 0; ; ui.sheet.page++) {
        ui.build(aspect, fullHud(), session);
        if (f.find(key)) return true;
        if (ui.sheet.page >= ui.sheet.pages - 1) return false;
      }
    };
    // Every tab, every page.
    const seen = new Set<number>();
    for (let tab = 0; tab < 3; tab++) {
      ui.pointer(0, KEY_CHAR_TAB + tab, 0, 0, 0, session);
      expect(ui.sheet.page).toBe(0);
      ui.build(aspect, fullHud(), session);
      for (let page = 0; page < ui.sheet.pages; page++) {
        ui.build(aspect, fullHud(), session);
        fits(`${name} tab ${tab} page ${page}`);
        for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_CHAR_STAT) seen.add(f.nodes[i]!.key);
        if (page + 1 < ui.sheet.pages) ui.pointer(0, KEY_CHAR_PAGE + 1, 0, 0, 0, session);
      }
      // The pager stops at the last page and at the first.
      ui.pointer(0, KEY_CHAR_PAGE + 1, 0, 0, 0, session);
      expect(ui.sheet.page).toBe(ui.sheet.pages - 1);
      for (let i = 0; i < 40; i++) ui.pointer(0, KEY_CHAR_PAGE, 0, 0, 0, session);
      expect(ui.sheet.page).toBe(0);
    }
    // Between them the pages showed every engram's row, and nothing twice on one page (the fit check).
    for (let n = 0; n < engrams.length; n++) expect(seen.has(KEY_CHAR_ENGRAM + n * 2)).toBe(true);
    expect(ui.sheet.pages).toBeGreaterThanOrEqual(1);

    ui.pointer(0, KEY_CHAR_TAB, 0, 0, 0, session);
    ui.build(aspect, fullHud(), session);
    expect(f.find(KEY_CHAR_TITLE)!.text).toBe("Level 20  99999 xp");
    expect(f.find(KEY_CHAR_POINTS)!.text).toBe("19 stat points  250 engram points");
    expect(f.find(KEY_CHAR_JOBS)!.text).toBe("making hatchet (3 to go)");
    // A stat it has a curve for has a line and, with points to spend, a button; one it has no curve for has neither.
    const speed = STAT_NAMES.indexOf("speed");
    expect(f.find(KEY_CHAR_STAT + speed * 2)!.text).toBe("speed");
    expect(f.find(KEY_CHAR_STAT + speed * 2 + 1)!.text).toBe("+");
    expect(f.find(KEY_CHAR_STAT + STAT_NAMES.indexOf("torpidity") * 2)).toBeNull();
    // The stats tab shows no engrams.
    expect(f.find(KEY_CHAR_ENGRAM)).toBeNull();
    ui.pointer(0, KEY_CHAR_STAT + speed * 2 + 1, 0, 0, 0, session);
    ui.pointer(0, KEY_CHAR_STAT + speed * 2, 0, 0, 0, session); // the line, not the button

    // Engrams, lowest level first: known ones say so and offer nothing; one within reach can be learned; one too high cannot.
    ui.pointer(0, KEY_CHAR_TAB + 1, 0, 0, 0, session);
    expect((reg.defs[engrams[0]!] as { level: number }).level).toBe(1);
    const pickEngram = engrams.indexOf(engram("core:engram-pick"));
    expect(seek(KEY_CHAR_ENGRAM + pickEngram * 2)).toBe(true);
    expect(f.find(KEY_CHAR_ENGRAM + pickEngram * 2)!.text).toBe("Stone pick: known");
    expect(f.find(KEY_CHAR_ENGRAM + pickEngram * 2 + 1)).toBeNull();
    const skin = engrams.indexOf(engram("core:engram-waterskin"));
    expect(seek(KEY_CHAR_ENGRAM + skin * 2)).toBe(true);
    expect(f.find(KEY_CHAR_ENGRAM + skin * 2 + 1)!.text).toBe("learn");
    ui.pointer(0, KEY_CHAR_ENGRAM + skin * 2 + 1, 0, 0, 0, session);
    const rifle = engrams.indexOf(engram("core:engram-rifle"));
    expect(seek(KEY_CHAR_ENGRAM + rifle * 2)).toBe(true);
    expect(f.find(KEY_CHAR_ENGRAM + rifle * 2)!.text).toBe("Long rifle: level 35, 18 points");
    expect(f.find(KEY_CHAR_ENGRAM + rifle * 2 + 1)).toBeNull();

    // Making: only what a known engram unlocks.
    ui.pointer(0, KEY_CHAR_TAB + 2, 0, 0, 0, session);
    const pickRow = recipes.indexOf(reg.index.get("core:make-pick")!);
    expect(seek(KEY_CHAR_RECIPE + pickRow * 2)).toBe(true);
    expect(f.find(KEY_CHAR_RECIPE + pickRow * 2)!.text.startsWith("pick: 1 stone, 1 wood")).toBe(true);
    ui.pointer(0, KEY_CHAR_RECIPE + pickRow * 2 + 1, 0, 0, 0, session);
    expect(seek(KEY_CHAR_RECIPE + recipes.indexOf(reg.index.get("core:make-waterskin")!) * 2)).toBe(false);
    expect(seek(KEY_CHAR_RECIPE + recipes.indexOf(reg.index.get("core:make-flak_shirt")!) * 2)).toBe(true);

    expect(sent.map((c) => c.op)).toEqual([CMD_SPEND, CMD_LEARN, CMD_CRAFT]);
    expect(sent[0]!.bytes[0]).toBe(speed);
    expect(new BitReader(sent[1]!.bytes).u16()).toBe(engram("core:engram-waterskin"));
    const r = new BitReader(sent[2]!.bytes);
    expect([r.u16(), r.u8()]).toEqual([reg.index.get("core:make-pick")!, 1]);
    // One screen at a time: the map key puts this one away.
    ui.key("KeyM", true, false, session);
    expect([ui.character, ui.map]).toEqual([false, true]);
  }
});

test("the chat box: a key for each channel, Tab to change it, Enter to say the line, and the keyboard while it is open", () => {
  const ui = new Ui();
  const { session, said } = fakeSession(new Inventory(40));
  const hud = new HudModel();
  ui.build(16 / 9, hud, session);
  expect(ui.frame.find(KEY_CHAT_INPUT)).toBeNull();
  // Enter opens it to everyone. The key that opened it does not also say an empty line, however long it is held.
  expect(ui.key("Enter", true, false, session)).toBe(true);
  expect(ui.key("Enter", true, true, session)).toBe(true);
  expect(ui.key("Enter", false, false, session)).toBe(true);
  expect([ui.chat.open, ui.chat.channel]).toEqual([true, TEXT_GLOBAL]);
  expect(ui.captureKeyboard).toBe(true);
  expect(ui.wantsPointerLock).toBe(false);
  ui.build(16 / 9, hud, session);
  const field = ui.frame.find(KEY_CHAT_INPUT)!;
  expect([field.kind, field.focus, field.interactive]).toEqual([K_INPUT, true, true]);
  expect(ui.frame.find(KEY_CHAT_TAG)!.text).toBe("Global");
  // Every other key is typing, the console's key among them; the body gets none of it.
  for (const code of ["KeyW", "Backquote", "Slash", "Insert", "KeyI", "Digit1", "Space"]) expect(ui.key(code, true, false, session)).toBe(false);
  expect(ui.console.open).toBe(false);
  expect(ui.inventory.open).toBe(false);
  ui.input(KEY_CHAT_INPUT, "  hello there  ");
  ui.build(16 / 9, hud, session);
  expect(ui.frame.find(KEY_CHAT_INPUT)!.text).toBe("  hello there  ");
  expect(ui.key("Enter", true, false, session)).toBe(true);
  expect(said).toEqual([{ channel: TEXT_GLOBAL, words: "hello there" }]);
  expect([ui.chat.open, ui.chat.input]).toEqual([false, ""]);
  expect(ui.wantsPointerLock).toBe(true);

  // Insert speaks to those near, the slash key to the tribe; Tab goes round the channels this survivor can use.
  ui.key("Insert", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  expect(ui.key("Tab", true, false, session)).toBe(true);
  expect(ui.chat.channel).toBe(TEXT_GLOBAL); // in no tribe: that channel is passed over
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  (session.tribe as { name: string }).name = "Night Shift";
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_TRIBE);
  ui.key("Tab", true, true, session); // held: once
  expect(ui.chat.channel).toBe(TEXT_TRIBE);
  // A click on the channel's name does what Tab does.
  ui.build(16 / 9, hud, session);
  ui.pointer(0, KEY_CHAT_TAG, 0, 0, 0, session);
  expect(ui.chat.channel).toBe(TEXT_GLOBAL);
  // Escape shuts it and says nothing; an empty line says nothing either.
  ui.input(KEY_CHAT_INPUT, "never mind");
  expect(ui.key("Escape", true, false, session)).toBe(true);
  expect([ui.chat.open, ui.chat.input]).toEqual([false, ""]);
  ui.key("Slash", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_TRIBE);
  ui.input(KEY_CHAT_INPUT, "   ");
  ui.key("Enter", true, false, session);
  expect(ui.chat.open).toBe(false);
  expect(said.length).toBe(1);
  ui.key("NumpadEnter", true, false, session);
  ui.input(KEY_CHAT_INPUT, "x".repeat(500));
  expect(ui.chat.input.length).toBe(MAX_CHAT_CHARS);
  ui.key("NumpadEnter", true, false, session);
  expect(said[1]).toEqual({ channel: TEXT_GLOBAL, words: "x".repeat(MAX_CHAT_CHARS) });

  // On a server with no global channel, Enter speaks to those near and Tab never lands on Global.
  (session as { globalChat: boolean }).globalChat = false;
  ui.key("Enter", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_TRIBE);
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  ui.key("Escape", true, false, session);
  // The console still opens over everything, and while it is open the chat keys are its own typing.
  ui.key("Backquote", true, false, session);
  expect(ui.key("Slash", true, false, session)).toBe(false);
  expect(ui.chat.open).toBe(false);
  expect(ui.key("Enter", true, false, session)).toBe(true);
  expect(ui.chat.open).toBe(false);
});

test("what is said goes to the chat box and what the console printed stays in the console; lines show for a while, then fade", () => {
  const ui = new Ui();
  const { session } = fakeSession(new Inventory(40));
  const s = session as unknown as { log: { channel: number; text: string }[]; logVersion: number; serverTick: number };
  const tell = (channel: number, text: string): void => {
    s.log.push({ channel, text });
    s.logVersion++;
  };
  const hud = new HudModel();
  const rows = (): { text: string; alpha: number; style: number }[] => {
    const out = [];
    for (let i = 0; i < ui.frame.count; i++) {
      const n = ui.frame.nodes[i]!;
      if (n.key >= KEY_CHAT_ROW && n.key < KEY_CHAT_ROW + 14) out.push({ text: n.text, alpha: n.alpha, style: n.style });
    }
    return out;
  };
  tell(TEXT_CONSOLE, "x 1.00  y 2.00  z 3.00  alive");
  tell(TEXT_NOTICE, "bob invites you to join Night Shift.");
  tell(TEXT_GLOBAL, "ada: hello");
  tell(TEXT_LOCAL, "bob: over here");
  tell(TEXT_TRIBE, "cy: the wall is up");
  ui.build(16 / 9, hud, session);
  expect(rows().map((r) => r.text)).toEqual(["bob invites you to join Night Shift.", "ada: hello", "[Local] bob: over here", "[Tribe] cy: the wall is up"]);
  expect(new Set(rows().map((r) => r.style)).size).toBe(4);
  expect(rows().every((r) => r.alpha === 1)).toBe(true);
  // The console has its own output and the server's notice, and none of the talk.
  expect(ui.console.lines).toEqual(["x 1.00  y 2.00  z 3.00  alive", "bob invites you to join Night Shift."]);
  // Built again with nothing new, nothing is taken in twice.
  ui.build(16 / 9, hud, session);
  expect(rows().length).toBe(4);

  // Eleven seconds on they are fading; after twelve they are gone, until the box is opened.
  s.serverTick = 1000 + 11 * 30;
  ui.build(16 / 9, hud, session);
  expect(rows().length).toBe(4);
  expect(rows()[0]!.alpha).toBeCloseTo(0.5, 5);
  tell(TEXT_GLOBAL, "ada: anyone?");
  ui.build(16 / 9, hud, session);
  expect(rows().map((r) => r.alpha)).toEqual([0.5, 0.5, 0.5, 0.5, 1]);
  s.serverTick = 1000 + 13 * 30;
  ui.build(16 / 9, hud, session);
  expect(rows().map((r) => r.text)).toEqual(["ada: anyone?"]);
  ui.key("Enter", true, false, session);
  ui.build(16 / 9, hud, session);
  expect(rows().length).toBe(5);
  expect(rows().every((r) => r.alpha === 1)).toBe(true);
  // A long line wraps inside the box, and only the newest rows are kept in view.
  for (let i = 0; i < 20; i++) tell(TEXT_GLOBAL, `ada: ${i} ` + "word ".repeat(30));
  ui.build(16 / 9, hud, session);
  expect(rows().length).toBe(8);
  for (const r of rows()) expect(textWidth(r.text, r.style)).toBeLessThanOrEqual(380);
  expect(rows().at(-1)!.text.trim().endsWith("word")).toBe(true);
  // More than it keeps: the oldest are forgotten.
  for (let i = 0; i < 300; i++) tell(TEXT_GLOBAL, `ada: ${i}`);
  ui.build(16 / 9, hud, session);
  expect(ui.chat.lines.length).toBe(100);
  expect(rows().at(-1)!.text).toBe("ada: 299");
});
