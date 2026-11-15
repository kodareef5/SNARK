import { expect, test } from "bun:test";
import { Controls, LOOK_SPEED } from "../../client/core/controls.ts";
import { HudModel } from "../../client/core/hud.ts";
import { KEY_CHAT_INPUT, KEY_CHAT_PANEL, KEY_CHAT_ROW, KEY_CHAT_TAG } from "../../client/core/ui/chat.ts";
import { ConsoleState, KEY_CONSOLE_INPUT, KEY_CONSOLE_PANEL, KEY_CONSOLE_ROW, MAX_LINE } from "../../client/core/ui/console.ts";
import { KEY_BANNER, KEY_CROSS, KEY_MARKER, KEY_MINIMAP, KEY_READOUT, KEY_VITAL, KEY_VOICE } from "../../client/core/ui/hud.ts";
import { K_BAR, K_INPUT, K_TEXT, textWidth, wrap, type UiFrame } from "../../client/core/ui/nodes.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_INV_INFO, KEY_INV_PANEL, KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { KEY_MAP_IMAGE, KEY_MAP_LINE, KEY_MAP_PIN } from "../../client/core/ui/screens.ts";
import { KEY_CHOOSE_FILTER, KEY_CHOOSE_MAP, KEY_CHOOSE_PAGE, KEY_CHOOSE_PANEL, KEY_CHOOSE_PIN, KEY_CHOOSE_RISE, KEY_CHOOSE_ROW, KEY_CHOOSE_TITLE } from "../../client/core/ui/choosing.ts";
import { KEY_CHAR_ENGRAM, KEY_CHAR_JOBS, KEY_CHAR_PAGE, KEY_CHAR_PANEL, KEY_CHAR_POINTS, KEY_CHAR_RECIPE, KEY_CHAR_STAT, KEY_CHAR_TAB, KEY_CHAR_TITLE, engramOrder } from "../../client/core/ui/character.ts";
import { KEY_PIN_BUTTON, KEY_PIN_CLEAR, KEY_PIN_DIGITS, KEY_PIN_PANEL, KEY_STRUCT_BUTTON, KEY_STRUCT_NAME_INPUT, KEY_STRUCT_PANEL } from "../../client/core/ui/structure.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { NO_PIN, STRUCT_DEMOLISH, STRUCT_LOCK, STRUCT_NAME, STRUCT_PICKUP, STRUCT_PIN, STRUCT_TRAVEL, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { KEY_OPEN_LEVEL, KEY_OPEN_MATE, KEY_OPEN_ORDER, KEY_OPEN_PAGE, KEY_OPEN_SLOT, KEY_OPEN_SUBJECT, KEY_OPEN_UNSADDLE, waitWords } from "../../client/core/ui/inventory.ts";
import { KEY_NAME_INPUT, KEY_NAME_PANEL, KEY_NAME_TITLE } from "../../client/core/ui/tame.ts";
import { CMD_FEED, CMD_NAME, CMD_ORDER, ORDER_FOLLOW, ORDER_LEVEL, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, RESULT_DENIED, RESULT_OK, RESULT_PIN } from "../../shared/net/protocol.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CHOOSE_DIED, CHOOSE_TRAVEL, CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_RESPAWN, CMD_SPEND, CMD_STRUCT, CMD_USE, MARKER_DEATH, MAX_CHAT_CHARS, MAX_NAME_BYTES, SESSION_ALIVE, SESSION_DEAD, TEXT_CONSOLE, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { flatWorld } from "../fixtures/world.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BTN_BRAKE, BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_ROLL, BTN_SECONDARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";

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
  for (let i = 0; i < 8; i++) m.talkers.push("W".repeat(24));
  m.banner = "SPECTATING";
  m.vitals[4]!.fraction = 0.5;
  m.markers.push({ kind: "self", u: 1, v: 1 });
  for (let i = 0; i < 300; i++) m.markers.push({ kind: i % 2 ? "player" : "creature", u: (i % 9) / 8, v: (i % 7) / 6 });
  return m;
}

const reg = coreRegistry();
const stone = reg.index.get("core:stone")!;
const berry = reg.index.get("core:berry")!;

/** Just enough of a session for the interface. It records what was sent and said. */
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
    tamed: [] as { handle: number; kind: number; level: number; te: number }[],
    subject: null,
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
      for (let i = 0; i < 30; i++) ui.chat.print(TEXT_NOTICE + (i % 4), `ada: ${"W".repeat(i * 5)} and so on`, 1000);
      if (chatOpen) ui.chat.begin(TEXT_TRIBE, null);
      ui.chat.edit("y".repeat(300));
      ui.settings.diagnostics = true;
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
        expect(n.x, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.y, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.x + n.w, where).toBeLessThanOrEqual(f.width + 0.01);
        expect(n.y + n.h, where).toBeLessThanOrEqual(f.height + 0.01);
        expect(n.w, where).toBeGreaterThan(0);
        expect(n.h, where).toBeGreaterThan(0);
        if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), where).toBeLessThanOrEqual(n.w + 0.01);
        if (n.kind === K_BAR) expect(n.value >= 0 && n.value <= 1, where).toBe(true);
      }
      for (let a = 0; a < f.count; a++) {
        for (let b = a + 1; b < f.count; b++) {
          const p = f.nodes[a]!;
          const q = f.nodes[b]!;
          if (p.interactive && q.interactive) expect(overlaps(f, a, b), `${name}: controls ${p.key} and ${q.key}`).toBe(false);
          // The layers are the HUD, the console and a screen. One may cover another on purpose, but within a layer text must not collide.
          // Combat marks (keys 2000 and up) are drawn over the world and belong to the HUD.
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
      const said = f.find(KEY_VOICE)!;
      expect(textWidth(said.text, said.style), name).toBeLessThanOrEqual(said.w);
      expect(said.y, name).toBeGreaterThanOrEqual(f.find(KEY_READOUT + 2)!.y + f.find(KEY_READOUT + 2)!.h);
      expect(f.find(KEY_CONSOLE_INPUT) !== null).toBe(consoleOpen);
      // The latest chat rows show while the box is shut, and more while it is open.
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
      // All forty slots are drawn, each with its count. Under the console or the chat box the inventory screen is not drawn at all.
      expect(f.find(KEY_INV_PANEL) !== null).toBe(!consoleOpen && !chatOpen);
      if (!consoleOpen && !chatOpen) {
        expect(f.find(KEY_INV_SLOT + 39 * 3)!.interactive).toBe(true);
        expect(f.find(KEY_INV_SLOT + 39 * 3 + 2)!.text).toBe("100");
        expect(f.find(KEY_INV_INFO)!.text).toContain("berry x100");
      }
      // At most 256 markers are drawn, the first the model lists. The reader's own is drawn last, so it is on top.
      const markers: number[] = [];
      for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_MARKER && f.nodes[i]!.key < KEY_MARKER + 1000) markers.push(i);
      expect(markers.length).toBe(256);
      const own = f.nodes[markers[255]!]!;
      const map = f.find(KEY_MINIMAP)!;
      // The complete marker remains inside the map at its far boundary.
      expect([own.x + own.w, own.y + own.h]).toEqual([map.x + map.w, map.y + map.h]);
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
  c.recall(1); // Past the newest is the draft again.
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
  expect(ui.key("Backquote", true, true, null)).toBe(true); // A held key is still ours, but does not toggle again.
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
    for (let i = 0; i < ui.frame.count; i++) if (ui.frame.nodes[i]!.key >= KEY_CONSOLE_ROW && ui.frame.nodes[i]!.key < KEY_CONSOLE_ROW + 60) out.push(ui.frame.nodes[i]!.text);
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
  c.key("KeyG", true);
  c.key("KeyN", true);
  expect(c.buttons).toBe(BTN_JUMP | BTN_SPRINT | BTN_USE | BTN_PRIMARY | BTN_SECONDARY | BTN_RELOAD | BTN_MELEE | BTN_MOD);
  for (const code of ["KeyR", "KeyG", "KeyN"]) c.key(code, false);
  c.key("Space", false);
  c.mouseButton(0, false);
  expect(c.buttons).toBe(BTN_SPRINT | BTN_USE | BTN_SECONDARY);
  c.mouseButton(2, false);
  expect(c.key("KeyQ", true)).toBe(false);
  c.release();
  expect([c.moveX, c.moveZ, c.buttons]).toEqual([0, 0, 0]);

  // Stance keys toggle. One press goes down, the next stands up, and the other key switches stance.
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
  // Sprinting stands a crouched body up and sprints. Jumping stands a body up and does not also jump.
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

test("controls driving a flyer: Space toggles its jump, held every tick, C rolls and X brakes while held, and on foot again they are stances", () => {
  const c = new Controls();
  // A stance chosen on foot is dropped, and a flyer found on the ground stays there.
  c.key("KeyC", true);
  c.key("KeyC", false);
  c.fly(true, false);
  expect([c.buttons, c.wing]).toEqual([0, false]);
  c.key("Space", true);
  c.key("Space", true); // repeating while held changes nothing
  expect([c.buttons, c.wing]).toEqual([BTN_JUMP, true]);
  c.key("Space", false);
  c.key("KeyC", true);
  c.key("KeyX", true);
  expect(c.buttons).toBe(BTN_JUMP | BTN_ROLL | BTN_BRAKE);
  c.key("KeyC", false);
  c.key("KeyX", false);
  expect(c.buttons).toBe(BTN_JUMP);
  // Losing focus keeps it up. Space again, or the flyer coming down, lets go of its jump.
  c.release();
  expect(c.buttons).toBe(BTN_JUMP);
  c.key("Space", true);
  c.key("Space", false);
  expect([c.buttons, c.wing]).toEqual([0, false]);
  c.key("Space", true);
  c.key("Space", false);
  c.land();
  expect([c.buttons, c.wing]).toEqual([0, false]);
  // Taken over in the air, it is kept up. Off it, C is a stance again and Space a jump.
  c.fly(true, true);
  expect(c.buttons).toBe(BTN_JUMP);
  c.fly(false, false);
  c.key("KeyC", true);
  c.key("KeyC", false);
  expect(c.buttons).toBe(BTN_CROUCH);
  c.key("KeyC", true);
  c.key("KeyC", false);
  c.key("Space", true);
  expect(c.buttons).toBe(BTN_JUMP);
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

  // While it is closed clicks do nothing. I opens it, which frees the mouse, and the keyboard still walks.
  ui.pointer(0, key(0), 0, 0, 0, session);
  expect(ui.key("KeyI", true, false, session)).toBe(true);
  expect(ui.inventory.open).toBe(true);
  expect(ui.wantsPointerLock).toBe(false);
  expect(ui.captureKeyboard).toBe(false);
  expect(ui.key("KeyW", true, false, session)).toBe(false);

  // A click on a stack then on an empty slot sends one move of the whole stack, naming the item the client thinks it is moving.
  ui.pointer(0, key(0), 0, 0, 0, session);
  expect(ui.inventory.held).toBe(0);
  expect(sent.length).toBe(0);
  ui.pointer(0, key(7), 0, 0, 0, session);
  expect(sent.map((c) => c.op)).toEqual([CMD_MOVE]);
  expect(decode(sent[0]!.bytes)).toEqual([0, 0, 0, 7, 0, stone]);
  expect(ui.inventory.held).toBe(-1);
  expect(inv.count[0]).toBe(80); // the mirror waits for the server

  // Middle click picks up half. Putting a stack back on its own slot cancels. An empty slot cannot be picked up.
  ui.pointer(0, key(5), 0, 0, 1, session);
  ui.pointer(0, key(6), 0, 0, 0, session);
  expect(decode(sent[1]!.bytes)).toEqual([0, 5, 0, 6, 4, berry]);
  ui.pointer(0, key(0), 0, 0, 0, session);
  ui.pointer(0, key(0), 0, 0, 0, session);
  ui.pointer(0, key(20), 0, 0, 0, session);
  expect(sent.length).toBe(2);
  expect(ui.inventory.held).toBe(-1);

  // Right click uses the item, and does nothing on an empty slot.
  ui.pointer(0, key(5), 0, 0, 2, session);
  ui.pointer(0, key(21), 0, 0, 2, session);
  expect(sent.map((c) => c.op)).toEqual([CMD_MOVE, CMD_MOVE, CMD_USE]);
  const r = new BitReader(sent[2]!.bytes);
  expect([r.u8(), r.u16()]).toEqual([5, berry]);

  // A held stack the server takes away is let go. Hovering describes a stack.
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

test("the choosing and map screens fit every window shape, and a place picked in the list or on the map is the one asked for", () => {
  const world = flatWorld(8);
  for (const [name, aspect] of ASPECTS) {
    for (const dead of [true, false]) {
      const { session, sent } = fakeSession(new Inventory(40));
      Object.assign(session, {
        sessionState: dead ? SESSION_DEAD : SESSION_ALIVE,
        choosing: CHOOSE_TRAVEL,
        placesList: 7,
        respawnPoints: [
          { kind: 0, name: "Plaza", x: 100, z: 100, readyAt: 0 },
          { kind: 1, name: "a place with a long name", x: 300, z: 200, readyAt: 2000 },
          { kind: 1, name: "Poolside", x: 400, z: 400, readyAt: 0 },
        ],
        markers: [1, 2, 3, 4, 5].map((i) => ({ kind: MARKER_DEATH, x: i * 100, y: 0, z: 511 - i * 90, tick: 100 * i })),
        world,
        own: { x: 256, y: 0, z: 256 },
        serverTick: 1000,
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
        if (n.kind === K_TEXT && n.key >= KEY_CHOOSE_PANEL) expect(textWidth(n.text, n.style), where).toBeLessThanOrEqual(n.w + 0.01);
        for (let j = i + 1; j < f.count; j++) if (n.interactive && f.nodes[j]!.interactive) expect(overlaps(f, i, j), where).toBe(false);
      }
      expect(ui.wantsPointerLock).toBe(false);
      if (dead) {
        // The map does not open over the choice. Each place is listed with what it still waits, and pinned on the map.
        expect([f.find(KEY_CHOOSE_TITLE)!.text, f.find(KEY_CHOOSE_ROW + 1)!.text, f.find(KEY_CHOOSE_ROW + 2)!.text]).toEqual(["Travel to", "a place with a long name  (0:34)", "Poolside"]);
        expect([f.find(KEY_MAP_IMAGE), f.find(KEY_CHOOSE_PIN + 2) !== null]).toEqual([null, true]);
        // A row picks a place, and the button asks for it, in the list it was picked from. A place that waits is not asked for.
        ui.pointer(0, KEY_CHOOSE_ROW + 1, 0, 0, 0, session);
        ui.pointer(0, KEY_CHOOSE_ROW + 7, 0, 0, 0, session); // not a place
        ui.build(aspect, fullHud(), session);
        expect(f.find(KEY_CHOOSE_RISE)!.interactive).toBe(false);
        ui.pointer(0, KEY_CHOOSE_RISE, 0, 0, 0, session);
        expect(sent).toEqual([]);
        // A click on the map picks the place pinned nearest it.
        ui.build(aspect, fullHud(), session);
        const pin = f.find(KEY_CHOOSE_PIN + 2)!;
        ui.pointer(0, KEY_CHOOSE_MAP, pin.x + pin.w / 2 + 2, pin.y + pin.h / 2 - 1, 0, session);
        ui.build(aspect, fullHud(), session);
        expect(f.find(KEY_CHOOSE_ROW + 2)!.text).toBe("> Poolside");
        ui.pointer(0, KEY_CHOOSE_RISE, 0, 0, 0, session);
        expect(sent.map((c) => [c.op, c.bytes[0], c.bytes[1]])).toEqual([[CMD_RESPAWN, 2, 7]]);
        // The filter keeps to the places whose names hold what is typed, and has the keyboard until Enter.
        ui.pointer(0, KEY_CHOOSE_FILTER, 0, 0, 0, session);
        expect([ui.captureKeyboard, ui.key("KeyP", true, false, session)]).toEqual([true, false]);
        ui.input(KEY_CHOOSE_FILTER, "POOL");
        ui.build(aspect, fullHud(), session);
        expect([f.find(KEY_CHOOSE_ROW)!.text, f.find(KEY_CHOOSE_ROW + 1)]).toEqual(["> Poolside", null]);
        expect([ui.key("Enter", true, false, session), ui.captureKeyboard, ui.choosing.filter]).toEqual([true, false, "POOL"]);
        ui.pointer(0, KEY_CHOOSE_ROW, 0, 0, 0, session);
        expect(ui.choosing.picked).toBe(2);
      } else {
        // The map has the picture, a pin for each death and one for the survivor, and a line for each death.
        expect(f.find(KEY_CHOOSE_PANEL)).toBeNull();
        expect(f.find(KEY_MAP_IMAGE)!.w).toBe(f.find(KEY_MAP_IMAGE)!.h);
        expect(f.find(KEY_MAP_PIN + 4)).not.toBeNull();
        expect(f.find(KEY_MAP_PIN + 16)).not.toBeNull();
        expect(f.find(KEY_MAP_LINE + 4)!.text).toMatch(/^died  \d+\.\d lat  \d+\.\d lon  \d+ min ago$/);
        ui.pointer(0, KEY_CHOOSE_ROW, 0, 0, 0, session);
        expect(sent.length).toBe(0);
        expect(ui.key("Escape", true, false, session)).toBe(true);
        expect(ui.map).toBe(false);
      }
    }
  }
});

test("with more places to rise at than fit the window, the list is paged, and every place can be picked and asked for", () => {
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(new Inventory(40));
    const places = Array.from({ length: 43 }, (_, i) => ({ kind: i < 3 ? 0 : 1, name: i < 3 ? `spawn ${i}` : `bed ${i}`, x: i, z: i, readyAt: i === 20 ? 6000 : 0 }));
    Object.assign(session, { sessionState: SESSION_DEAD, choosing: CHOOSE_DIED, placesList: 3, respawnPoints: places, markers: [], world: flatWorld(2), own: { x: 1, y: 0, z: 1 } });
    const ui = new Ui();
    ui.registry = reg;
    const f = ui.frame;
    const chosen: number[] = [];
    for (let page = 0; page < 20; page++) {
      ui.build(aspect, fullHud(), session);
      expect(f.find(KEY_CHOOSE_TITLE)!.text).toBe("Return to life at");
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        const where = `${name} page ${page} key=${n.key}`;
        if (n.key < KEY_CHOOSE_PANEL || n.key >= KEY_MAP_IMAGE - 1) continue;
        expect(n.y, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.y + n.h, where).toBeLessThanOrEqual(f.height + 0.01);
        expect(n.x + n.w, where).toBeLessThanOrEqual(f.width + 0.01);
        if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), where).toBeLessThanOrEqual(n.w + 0.01);
      }
      // Each place's row is pressed as it is shown, and the button asks for it.
      for (let row = 0; row < 10; row++) {
        const b = f.find(KEY_CHOOSE_ROW + row);
        if (!b?.interactive) continue;
        const place = places.findIndex((p) => b.text === p.name || b.text.startsWith(`${p.name}  (`));
        ui.pointer(0, b.key, 0, 0, 0, session);
        ui.pointer(0, KEY_CHOOSE_RISE, 0, 0, 0, session);
        chosen.push(place);
      }
      if (f.find(KEY_CHOOSE_PAGE + 1) === null) break;
      const before = f.find(KEY_CHOOSE_PAGE + 2)!.text;
      ui.pointer(0, KEY_CHOOSE_PAGE + 1, 0, 0, 0, session);
      ui.build(aspect, fullHud(), session);
      // The last page's next button goes nowhere.
      if (f.find(KEY_CHOOSE_PAGE + 2)!.text === before) break;
    }
    expect(chosen).toEqual(places.map((_, i) => i));
    // All but the one that waits.
    expect(sent.map((c) => [c.op, c.bytes[0], c.bytes[1]])).toEqual(places.flatMap((_, i) => (i === 20 ? [] : [[CMD_RESPAWN, i, 3]])));
    // Back to the first page, where the first row is the first place again.
    for (let i = 0; i < 20; i++) ui.pointer(0, KEY_CHOOSE_PAGE, 0, 0, 0, session);
    ui.build(aspect, fullHud(), session);
    expect([f.find(KEY_CHOOSE_ROW)!.text, f.find(KEY_CHOOSE_PAGE + 2)!.text.startsWith("page 1 of ")]).toEqual(["spawn 0", true]);
  }
});

test("the character screen fits every window shape on every tab and page, and its buttons send what they say", () => {
  const engram = (name: string) => reg.index.get(name)!;
  const engrams = engramOrder(reg);
  const recipes = reg.defs.flatMap((d, k) => (d?.type === "item" && d.craft ? [k] : []));
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(new Inventory(40));
    Object.assign(session, {
      sessionState: SESSION_ALIVE,
      ownKind: reg.index.get("core:survivor")!,
      // Level 20 with every engram learned but two, so the lists are as long as they get.
      progress: { xp: 99999, level: 20, statPoints: 19, engramPoints: 250, engrams: engrams.filter((e) => e !== engram("core:engram-waterskin") && e !== engram("core:engram-rifle")), jobs: [{ item: reg.index.get("core:hatchet")!, left: 3, doneAt: 5 }], version: 1 },
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
    /** Pages through the tab shown until the row appears. Returns whether it was found, and leaves its page up. */
    const seek = (key: number): boolean => {
      for (ui.sheet.page = 0; ; ui.sheet.page++) {
        ui.build(aspect, fullHud(), session);
        if (f.find(key)) return true;
        if (ui.sheet.page >= ui.sheet.pages - 1) return false;
      }
    };
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
    for (let n = 0; n < engrams.length; n++) expect(seen.has(KEY_CHAR_ENGRAM + n * 2)).toBe(true);
    expect(ui.sheet.pages).toBeGreaterThanOrEqual(1);

    ui.pointer(0, KEY_CHAR_TAB, 0, 0, 0, session);
    ui.build(aspect, fullHud(), session);
    expect(f.find(KEY_CHAR_TITLE)!.text).toBe("Level 20  99999 xp");
    expect(f.find(KEY_CHAR_POINTS)!.text).toBe("19 stat points  250 engram points");
    expect(f.find(KEY_CHAR_JOBS)!.text).toBe("making hatchet (3 to go)");
    // A stat the species has a curve for has a line and, with points to spend, a button. A stat with no curve has neither.
    const speed = STAT_NAMES.indexOf("speed");
    expect(f.find(KEY_CHAR_STAT + speed * 2)!.text).toBe("speed");
    expect(f.find(KEY_CHAR_STAT + speed * 2 + 1)!.text).toBe("+");
    expect(f.find(KEY_CHAR_STAT + STAT_NAMES.indexOf("torpidity") * 2)).toBeNull();
    // The stats tab shows no engrams.
    expect(f.find(KEY_CHAR_ENGRAM)).toBeNull();
    ui.pointer(0, KEY_CHAR_STAT + speed * 2 + 1, 0, 0, 0, session);
    ui.pointer(0, KEY_CHAR_STAT + speed * 2, 0, 0, 0, session); // the line, not the button

    // Engrams come lowest level first. A known one says so and offers nothing, one within reach can be learned, and one too high cannot.
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

    // The making tab lists only what a known engram unlocks.
    ui.pointer(0, KEY_CHAR_TAB + 2, 0, 0, 0, session);
    const pickRow = recipes.indexOf(reg.index.get("core:pick")!);
    expect(seek(KEY_CHAR_RECIPE + pickRow * 2)).toBe(true);
    expect(f.find(KEY_CHAR_RECIPE + pickRow * 2)!.text.startsWith("pick: 1 stone, 1 wood")).toBe(true);
    ui.pointer(0, KEY_CHAR_RECIPE + pickRow * 2 + 1, 0, 0, 0, session);
    expect(seek(KEY_CHAR_RECIPE + recipes.indexOf(reg.index.get("core:waterskin")!) * 2)).toBe(false);
    expect(seek(KEY_CHAR_RECIPE + recipes.indexOf(reg.index.get("core:flak_shirt")!) * 2)).toBe(true);

    expect(sent.map((c) => c.op)).toEqual([CMD_SPEND, CMD_LEARN, CMD_CRAFT]);
    expect(sent[0]!.bytes[0]).toBe(speed);
    expect(new BitReader(sent[1]!.bytes).u16()).toBe(engram("core:engram-waterskin"));
    const r = new BitReader(sent[2]!.bytes);
    expect([r.u16(), r.u8()]).toEqual([reg.index.get("core:pick")!, 1]);
    // Only one screen shows at a time, so the map key puts this one away.
    ui.key("KeyM", true, false, session);
    expect([ui.character, ui.map]).toEqual([false, true]);
  }
});

test("with hundreds of engrams and things to make, each button of the character screen still does what its row says", () => {
  // 230 more things to make, each with its engram: past the hundredth engram and the two hundredth thing.
  const more: Def[] = [];
  for (let i = 0; i < 230; i++) {
    more.push({ type: "item", class: "resource", id: `core:thing${i}`, label: `thing ${i}`, stack: 10, craft: { needs: [{ item: "core:stone", count: 1 }], seconds: 1, xp: 1 } });
    more.push({ type: "engram", id: `core:engram-thing${i}`, label: `Thing ${i}`, level: 1, cost: 0, item: `core:thing${i}` });
  }
  const made = compileContent([...CORE_CONTENT, ...more]);
  expect(made.errors).toEqual([]);
  const big = made.registry!;
  const engrams = engramOrder(big);
  expect(engrams.length).toBeGreaterThan(230);
  const { session, sent } = fakeSession(new Inventory(40));
  const progress = { xp: 0, level: 1, statPoints: 0, engramPoints: 0, engrams: [] as number[], jobs: [], version: 1 };
  Object.assign(session, { sessionState: SESSION_ALIVE, ownKind: big.index.get("core:survivor")!, progress });
  const ui = new Ui();
  ui.registry = big;
  ui.key("KeyP", true, false, session);
  const f = ui.frame;
  /** Presses the button of the row whose line starts with `words`, paging to it. */
  const press = (tab: number, words: string): void => {
    ui.pointer(0, KEY_CHAR_TAB + tab, 0, 0, 0, session);
    for (ui.sheet.page = 0; ; ui.sheet.page++) {
      ui.build(16 / 9, fullHud(), session);
      const keys = new Set<number>();
      for (let i = 0; i < f.count; i++) {
        expect(keys.has(f.nodes[i]!.key), `key ${f.nodes[i]!.key} twice`).toBe(false);
        keys.add(f.nodes[i]!.key);
      }
      for (let i = 0; i < f.count; i++) {
        if (!f.nodes[i]!.text.startsWith(words)) continue;
        // A row is its line, then its button.
        return ui.pointer(0, f.nodes[i]!.key + 1, 0, 0, 0, session);
      }
      if (ui.sheet.page >= ui.sheet.pages - 1) throw new Error(`no row says ${words}`);
    }
  };
  for (const i of [3, 150, 229]) press(1, `Thing ${i}:`);
  progress.engrams = engrams;
  for (const i of [3, 150, 229]) press(2, `thing ${i}:`);
  const asked = sent.map((c) => [c.op, big.ids[new BitReader(c.bytes).u16()]]);
  expect(asked).toEqual([
    [CMD_LEARN, "core:engram-thing3"],
    [CMD_LEARN, "core:engram-thing150"],
    [CMD_LEARN, "core:engram-thing229"],
    [CMD_CRAFT, "core:thing3"],
    [CMD_CRAFT, "core:thing150"],
    [CMD_CRAFT, "core:thing229"],
  ]);
});

test("the chat box: a key for each channel, Tab to change it, Enter to say the line, and the keyboard while it is open", () => {
  const ui = new Ui();
  const { session, said } = fakeSession(new Inventory(40));
  const hud = new HudModel();
  ui.build(16 / 9, hud, session);
  expect(ui.frame.find(KEY_CHAT_INPUT)).toBeNull();
  // Enter opens it on the global channel. The key that opened it does not also send an empty line, however long it is held.
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
  // Every other key is typing, the console's key included, and none of it reaches the body.
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

  // Insert opens the local channel and the slash key the tribe's. Tab cycles the channels this survivor can use.
  ui.key("Insert", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  expect(ui.key("Tab", true, false, session)).toBe(true);
  expect(ui.chat.channel).toBe(TEXT_GLOBAL); // In no tribe, so that channel is skipped.
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  (session.tribe as { name: string }).name = "Night Shift";
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_TRIBE);
  ui.key("Tab", true, true, session); // A held key counts once.
  expect(ui.chat.channel).toBe(TEXT_TRIBE);
  // A click on the channel's name does what Tab does.
  ui.build(16 / 9, hud, session);
  ui.pointer(0, KEY_CHAT_TAG, 0, 0, 0, session);
  expect(ui.chat.channel).toBe(TEXT_GLOBAL);
  // Escape shuts it and sends nothing. An empty line sends nothing either.
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

  // On a server with no global channel, Enter opens the local channel and Tab never lands on Global.
  (session as { globalChat: boolean }).globalChat = false;
  ui.key("Enter", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_TRIBE);
  ui.key("Tab", true, false, session);
  expect(ui.chat.channel).toBe(TEXT_LOCAL);
  ui.key("Escape", true, false, session);
  // The console still opens over everything, and while it is open the chat keys are typing in it.
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
  expect(ui.console.lines).toEqual(["x 1.00  y 2.00  z 3.00  alive", "bob invites you to join Night Shift."]);
  // A second build with nothing new takes nothing in twice.
  ui.build(16 / 9, hud, session);
  expect(rows().length).toBe(4);

  // After eleven seconds the lines are fading, and after twelve they are gone until the box is opened.
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
  // It keeps 100 lines and forgets the oldest.
  for (let i = 0; i < 300; i++) tell(TEXT_GLOBAL, `ada: ${i}`);
  ui.build(16 / 9, hud, session);
  expect(ui.chat.lines.length).toBe(100);
  expect(rows().at(-1)!.text).toBe("ada: 299");
});

test("the list of what can be done to a piece fits every window shape, whatever the piece is made of, and its digits and presses send what they say", () => {
  const world = flatWorld(2);
  const refs = ["foundation_stone", "wall_metal", "windowframe_wood", "ceiling_thatch", "door_metal", "storage_large", "vault", "bed", "bunk_bed"].map((name, i) => world.structs.add(reg.index.get(`core:${name}`)!, 20 + i * 6, 1, 20, 0, 7, 1 + i * 400));
  for (const [name, aspect] of ASPECTS) {
    for (const ref of refs) {
      const { session, sent } = fakeSession(new Inventory(40));
      Object.assign(session, { sessionState: SESSION_ALIVE, world });
      const ui = new Ui();
      ui.registry = reg;
      ui.structure.begin(ref);
      ui.build(aspect, fullHud(), session);
      const f = ui.frame;
      expect(ui.wantsPointerLock).toBe(false);
      expect(f.find(KEY_STRUCT_PANEL)).not.toBeNull();
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        if (n.key < KEY_STRUCT_PANEL || n.key > KEY_PIN_CLEAR) continue;
        const where = `${name} ref=${ref} key=${n.key} "${n.text}"`;
        expect(n.x, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.x + n.w, where).toBeLessThanOrEqual(f.width + 0.01);
        expect(n.y + n.h, where).toBeLessThanOrEqual(f.height + 0.01);
        // A line of text fits its row. A button's words fit the button with a little to spare each side.
        if (n.text !== "") expect(textWidth(n.text, n.style), where).toBeLessThanOrEqual(n.w - (n.kind === K_TEXT ? 0 : 8) + 0.01);
        for (let j = i + 1; j < f.count; j++) if (n.interactive && f.nodes[j]!.interactive) expect(overlaps(f, i, j), where).toBe(false);
      }
      // The third digit demolishes the piece and closes the list. With the list closed a digit is not the list's.
      expect(ui.key("Digit3", true, false, session)).toBe(true);
      expect(sent.map((c) => [c.op, new BitReader(c.bytes).u32(), c.bytes[4]])).toEqual([[CMD_STRUCT, ref, STRUCT_DEMOLISH]]);
      expect([ui.structure.open, ui.key("Digit3", true, false, session)]).toEqual([false, false]);
      // A press on the first line asks to pick the piece up.
      ui.structure.begin(ref);
      ui.pointer(0, KEY_STRUCT_BUTTON, 0, 0, 0, session);
      expect(sent[1]!.bytes[4]).toBe(STRUCT_PICKUP);
      // Another screen closes it. If the piece has gone, there is nothing to list.
      ui.structure.begin(ref);
      ui.key("KeyM", true, false, session);
      expect(ui.structure.open).toBe(false);
    }
  }
  const { session } = fakeSession(new Inventory(40));
  Object.assign(session, { sessionState: SESSION_ALIVE, world });
  const ui = new Ui();
  ui.registry = reg;
  ui.structure.begin(refs[0]!);
  world.structs.remove(refs[0]!);
  ui.build(16 / 9, fullHud(), session);
  expect([ui.structure.open, ui.frame.find(KEY_STRUCT_PANEL)]).toEqual([false, null]);
});

test("what can be used can be locked and given a PIN from the list; the PIN panel takes four digits, fits every window, and remembers a PIN that worked", () => {
  const world = flatWorld(2);
  const door = world.structs.add(reg.index.get("core:door_wood")!, 20, 1.5, 20, 0, 7, 6250);
  const wall = world.structs.add(reg.index.get("core:wall_wood")!, 26, 1.5, 20, 0, 7, 10000);
  const sentOf = (c: { op: number; bytes: Uint8Array }): number[] => {
    const r = new BitReader(c.bytes);
    return c.bytes.length > 5 ? [c.op, r.u32(), r.u8(), r.u16()] : [c.op, r.u32(), r.u8()];
  };
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(new Inventory(40));
    Object.assign(session, { sessionState: SESSION_ALIVE, world });
    const ui = new Ui();
    ui.registry = reg;
    const menu = ui.structure;
    const fits = (): void => {
      ui.build(aspect, fullHud(), session);
      const f = ui.frame;
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        if (n.key < KEY_STRUCT_PANEL || n.key > KEY_PIN_CLEAR) continue;
        const where = `${name} key=${n.key} "${n.text}"`;
        expect(n.x, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.y, where).toBeGreaterThanOrEqual(-0.01);
        expect(n.x + n.w, where).toBeLessThanOrEqual(f.width + 0.01);
        expect(n.y + n.h, where).toBeLessThanOrEqual(f.height + 0.01);
        if (n.text !== "") expect(textWidth(n.text, n.style), where).toBeLessThanOrEqual(n.w - (n.kind === K_TEXT ? 0 : 8) + 0.01);
        for (let j = i + 1; j < f.count; j++) if (n.interactive && f.nodes[j]!.interactive) expect(overlaps(f, i, j), where).toBe(false);
      }
    };
    // A wall has three actions and a door six. The fourth digit does nothing to a wall.
    menu.begin(wall);
    fits();
    expect([ui.frame.find(KEY_STRUCT_BUTTON + 2)?.text, ui.frame.find(KEY_STRUCT_BUTTON + 3)]).toEqual(["3  Take it down", null]);
    ui.key("Digit4", true, false, session);
    expect([sent.length, menu.open]).toEqual([0, true]);
    menu.begin(door);
    fits();
    expect([3, 4, 5].map((n) => ui.frame.find(KEY_STRUCT_BUTTON + n)!.text)).toEqual(["4  Lock it", "5  Unlock it", "6  Give it a PIN"]);
    ui.key("Digit4", true, false, session);
    expect([sentOf(sent[0]!), menu.open]).toEqual([[CMD_STRUCT, door, STRUCT_LOCK], false]);
    // The sixth asks for the digits first. They show as stars, Backspace takes one back, and the fourth sends them.
    menu.begin(door);
    ui.key("Digit6", true, false, session);
    expect([menu.open, menu.pad, sent.length, ui.wantsPointerLock]).toEqual([true, STRUCT_PIN, 1, false]);
    fits();
    expect(ui.frame.find(KEY_PIN_DIGITS)!.text).toBe("wooden door:  ____");
    for (const code of ["Digit4", "Numpad0", "Digit9", "Backspace", "Digit7"]) expect(ui.key(code, true, false, session)).toBe(true);
    ui.build(aspect, fullHud(), session);
    expect(ui.frame.find(KEY_PIN_DIGITS)!.text).toBe("wooden door:  ***_");
    ui.pointer(0, KEY_PIN_BUTTON + 1, 0, 0, 0, session);
    expect([sentOf(sent[1]!), menu.open, menu.pad]).toEqual([[CMD_STRUCT, door, STRUCT_PIN, 4071], false, 0]);
    // "No PIN" takes the PIN away.
    menu.begin(door);
    ui.key("Digit6", true, false, session);
    ui.build(aspect, fullHud(), session);
    ui.pointer(0, KEY_PIN_CLEAR, 0, 0, 0, session);
    expect(sentOf(sent[2]!)).toEqual([CMD_STRUCT, door, STRUCT_PIN, NO_PIN]);

    // When someone outside its tribe uses it, the server answers that it wants its PIN, and the panel asks.
    menu.result(0, RESULT_PIN, 1000, session, door);
    expect([menu.open, menu.pad]).toEqual([true, STRUCT_USE]);
    fits();
    expect([ui.frame.find(KEY_PIN_PANEL) !== null, ui.frame.find(KEY_PIN_CLEAR)]).toEqual([true, null]);
    for (const code of ["Digit1", "Digit2", "Digit3", "Digit4"]) ui.key(code, true, false, session);
    expect(sentOf(sent[3]!)).toEqual([CMD_STRUCT, door, STRUCT_USE, 1234]);
    // A wrong PIN is reported and not remembered. The next press asks again.
    menu.result(sent.length, RESULT_DENIED, 2000);
    expect(menu.notice).toBe("That is not its PIN");
    menu.result(0, RESULT_PIN, 3000, session, door);
    expect(menu.pad).toBe(STRUCT_USE);
    for (const code of ["Digit4", "Digit0", "Digit7", "Digit1"]) ui.key(code, true, false, session);
    menu.result(sent.length, RESULT_OK, 4000);
    // After a right PIN, that door is sent its PIN without asking.
    menu.result(0, RESULT_PIN, 5000, session, door);
    expect([menu.open, sentOf(sent[sent.length - 1]!)]).toEqual([false, [CMD_STRUCT, door, STRUCT_USE, 4071]]);
    menu.ask(wall);
    const n = sent.length;
    expect(ui.key("Escape", true, false, session)).toBe(true);
    expect([menu.open, sent.length]).toEqual([false, n]);
  }
});

test("a container with more slots than there is room for is turned through a page at a time, and a press on a slot means the slot on that page", () => {
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(fullInventory());
    const vault = new Inventory(350);
    vault.set(0, stone, 5, 0, 0, 0);
    vault.set(349, berry, 7, 0, 0, 0);
    Object.assign(session, { open: { name: "vault", inventory: vault }, sessionState: SESSION_ALIVE });
    const ui = new Ui();
    ui.registry = reg;
    ui.build(aspect, fullHud(), session);
    const f = ui.frame;
    expect(ui.inventory.open, name).toBe(true);
    const check = (): void => {
      for (let i = 0; i < f.count; i++) {
        const n = f.nodes[i]!;
        if (n.key < KEY_OPEN_PAGE || n.key >= 900) continue;
        expect(n.x + n.w, `${name} key=${n.key}`).toBeLessThanOrEqual(f.width + 0.01);
        expect(n.y + n.h, `${name} key=${n.key}`).toBeLessThanOrEqual(f.height + 0.01);
        expect(n.y, `${name} key=${n.key}`).toBeGreaterThanOrEqual(-0.01);
        for (let j = i + 1; j < f.count; j++) if (n.interactive && f.nodes[j]!.interactive) expect(overlaps(f, i, j), `${name} ${n.key} ${f.nodes[j]!.key}`).toBe(false);
      }
    };
    check();
    const [, here, of] = /^(\d+) \/ (\d+)$/.exec(f.find(KEY_OPEN_PAGE + 1)!.text)!.map(Number) as [number, number, number];
    const per = Math.ceil(350 / of);
    expect([here, of > 1, f.find(KEY_OPEN_SLOT + 1) !== null]).toEqual([1, true, true]);
    // Back from the first page stays there, and forward stops at the last.
    ui.pointer(0, KEY_OPEN_PAGE, 0, 0, 0, session);
    expect(ui.inventory.page).toBe(0);
    for (let k = 0; k < of + 2; k++) ui.pointer(0, KEY_OPEN_PAGE + 2, 0, 0, 0, session);
    expect(ui.inventory.page).toBe(of - 1);
    ui.build(aspect, fullHud(), session);
    check();
    expect(f.find(KEY_OPEN_PAGE + 1)!.text).toBe(`${of} / ${of}`);
    const size = (ui.inventory as unknown as { pageSize: number }).pageSize;
    expect(per).toBeLessThanOrEqual(size);
    const place = 349 - (of - 1) * size;
    // Slot 349's seven berries show at its place on this page. Moved from there to the survivor's first slot, the command names slot 349.
    expect(f.find(KEY_OPEN_SLOT + place * 3 + 2)!.text).toBe("7");
    ui.pointer(0, KEY_OPEN_SLOT + place * 3, 0, 0, 0, session);
    ui.pointer(0, KEY_INV_SLOT, 0, 0, 0, session);
    const r = new BitReader(sent[0]!.bytes);
    expect([sent[0]!.op, r.bits(1), r.varint(), r.bits(1), r.varint()]).toEqual([CMD_MOVE, 1, 349, 0, 0]);
    // A box that fits has no pages.
    Object.assign(session, { open: { name: "storage box", inventory: new Inventory(15) } });
    ui.inventory.page = 3;
    ui.build(aspect, fullHud(), session);
    expect([f.find(KEY_OPEN_PAGE), ui.inventory.page]).toEqual([null, 0]);
  }
});

/** The breeding fields of a creature whose species does not breed. */
const GROWN_ONE = { saddled: false, breeds: false, mating: false, female: false, stage: 3, maturity: 1, mate: 0, wait: 0 };

test("a creature looked into says how its taming goes; one just tamed is asked a name for, and Enter sends it", () => {
  const narcotic = reg.index.get("core:narcotic")!;
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(fullInventory());
    const inside = new Inventory(20);
    inside.set(2, narcotic, 3, 0, 0, 0);
    inside.set(3, stone, 1, 0, 0, 0);
    Object.assign(session, { sessionState: SESSION_ALIVE, open: { name: "", inventory: inside }, subject: { taming: true, owned: false, level: 30, progress: 0.4, te: 0.946, torpor: 0.61, food: 0.9 } });
    const ui = new Ui();
    ui.registry = reg;
    ui.build(aspect, fullHud(), session);
    const f = ui.frame;
    const line = f.find(KEY_OPEN_SUBJECT)!;
    expect(line.text, name).toBe("taming 40%  well 95%  torpor 61%  food 90%".slice(0, line.text.length));
    expect(line.x + line.w).toBeLessThanOrEqual(f.width + 0.01);
    // A right click on a narcotic in it feeds it. On anything else in it, nothing happens.
    ui.pointer(0, KEY_OPEN_SLOT + 2 * 3, 0, 0, 2, session);
    ui.pointer(0, KEY_OPEN_SLOT + 3 * 3, 0, 0, 2, session);
    const r = new BitReader(sent[0]!.bytes);
    expect([sent.length, sent[0]!.op, r.varint(), r.u16()]).toEqual([1, CMD_FEED, 2, narcotic]);
    Object.assign(session, { subject: { taming: false, owned: true, level: 42, progress: 0, te: 0.81, torpor: 0, food: 0.5, ...GROWN_ONE } });
    ui.build(aspect, fullHud(), session);
    expect(f.find(KEY_OPEN_SUBJECT)!.text).toBe("level 42  torpor 0%  food 50%");

    // The naming panel opens over everything and takes the keyboard.
    ui.key("Escape", true, false, session);
    Object.assign(session, { open: null, subject: null });
    session.tamed.push({ handle: 0x1234, kind: reg.index.get("core:raptor")!, level: 42, te: 81 }, { handle: 0x99, kind: reg.index.get("core:parasaur")!, level: 3, te: 100 });
    ui.build(aspect, fullHud(), session);
    expect([ui.naming.open, ui.captureKeyboard, ui.wantsPointerLock]).toEqual([true, true, false]);
    expect([f.find(KEY_NAME_TITLE)!.text, f.find(KEY_NAME_INPUT)!.focus]).toEqual(["Tamed: a raptor, level 42", true]);
    for (const key of [KEY_NAME_PANEL, KEY_NAME_TITLE, KEY_NAME_INPUT]) {
      const n = f.find(key)!;
      expect(n.x, name).toBeGreaterThanOrEqual(-0.01);
      expect(n.x + n.w, name).toBeLessThanOrEqual(f.width + 0.01);
      if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), name).toBeLessThanOrEqual(n.w + 0.01);
    }
    // A letter key is typing. It does not reach the body or another screen.
    expect(ui.key("KeyI", true, false, session)).toBe(false);
    expect(ui.inventory.open).toBe(false);
    ui.input(KEY_NAME_INPUT, "Blue");
    expect(ui.key("Enter", true, false, session)).toBe(true);
    // Closing the inventory told the server the creature was shut, which was the second command sent.
    const named = new BitReader(sent[2]!.bytes);
    expect([sent[2]!.op, named.u32(), named.string(24)]).toEqual([CMD_NAME, 0x1234, "Blue"]);
    // The next tame is asked about in turn. Escape leaves it unnamed, and then there is nothing left to ask.
    ui.build(aspect, fullHud(), session);
    expect([ui.naming.open, f.find(KEY_NAME_TITLE)!.text]).toEqual([true, "Tamed: a parasaur, level 3"]);
    ui.key("Escape", true, false, session);
    ui.build(aspect, fullHud(), session);
    expect([ui.naming.open, sent.length, session.tamed.length, f.find(KEY_NAME_PANEL)]).toEqual([false, 3, 0, null]);
  }
});

test("a tame's name is cut to the 24 bytes the server takes, whatever the script, with no letter cut in two", () => {
  const { session, sent } = fakeSession(new Inventory(40));
  const ui = new Ui();
  ui.registry = reg;
  const cases = [
    ["a name of thirty letters, no less", "a name of thirty letters"],
    // Thirteen letters of two bytes each: twelve fit.
    ["Абвгдежзийклм", "Абвгдежзийкл"],
    // Twenty-three bytes, then one that takes four.
    ["Rex the twenty-third..\u{1F996}", "Rex the twenty-third.."],
    ["恐竜恐竜恐竜恐竜恐竜", "恐竜恐竜恐竜恐竜"],
  ] as const;
  for (const [typed, kept] of cases) {
    session.tamed.push({ handle: 7, kind: reg.index.get("core:raptor")!, level: 1, te: 50 });
    ui.build(16 / 9, fullHud(), session);
    ui.input(KEY_NAME_INPUT, typed);
    expect(ui.naming.text).toBe(kept);
    ui.key("Enter", true, false, session);
    // The server reads the name with this limit, and refuses the command if it is longer.
    const r = new BitReader(sent[sent.length - 1]!.bytes);
    expect([sent[sent.length - 1]!.op, r.u32(), r.string(MAX_NAME_BYTES), r.overflow]).toEqual([CMD_NAME, 7, kept, false]);
  }
});

test("a creature of one's own, looked into, is told to follow or stay, to change its stance, and where to put its levels, by buttons that fit every window", () => {
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(fullInventory());
    const subject = { taming: false, owned: true, level: 12, progress: 0, te: 0.8, torpor: 0, food: 0.7, id: 77, points: 2, stance: 1, following: false, ...GROWN_ONE };
    Object.assign(session, { sessionState: SESSION_ALIVE, open: { name: "Blue", inventory: new Inventory(20) }, subject });
    const ui = new Ui();
    ui.registry = reg;
    ui.build(aspect, fullHud(), session);
    const f = ui.frame;
    expect([f.find(KEY_OPEN_ORDER)!.text, f.find(KEY_OPEN_ORDER + 1)!.text, f.find(KEY_OPEN_LEVEL + 6) !== null], name).toEqual(["Follow me", "neutral", true]);
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      if (n.key < KEY_OPEN_ORDER || n.key >= KEY_OPEN_LEVEL + 7) continue;
      expect(n.x, `${name} ${n.key}`).toBeGreaterThanOrEqual(-0.01);
      expect(n.x + n.w, `${name} ${n.key}`).toBeLessThanOrEqual(f.width + 0.01);
      expect(textWidth(n.text, n.style), `${name} ${n.key} "${n.text}"`).toBeLessThanOrEqual(n.w + 0.01);
      for (let j = i + 1; j < f.count; j++) if (n.interactive && f.nodes[j]!.interactive) expect(overlaps(f, i, j), `${name} ${n.key} ${f.nodes[j]!.key}`).toBe(false);
    }
    // Follow, the next stance, and a level into melee, the sixth stat a level can go in.
    ui.pointer(0, KEY_OPEN_ORDER, 0, 0, 0, session);
    ui.pointer(0, KEY_OPEN_ORDER + 1, 0, 0, 0, session);
    ui.pointer(0, KEY_OPEN_LEVEL + 5, 0, 0, 0, session);
    expect(sent.map((c) => [c.op, new BitReader(c.bytes).u32(), c.bytes[4]])).toEqual([[CMD_ORDER, 77, ORDER_FOLLOW], [CMD_ORDER, 77, ORDER_STANCE + 2], [CMD_ORDER, 77, ORDER_LEVEL + 6]]);
    // While it follows, the button offers the other order. With no levels to spend there are no level buttons.
    Object.assign(subject, { following: true, points: 0, stance: 2 });
    ui.build(aspect, fullHud(), session);
    expect([f.find(KEY_OPEN_ORDER)!.text, f.find(KEY_OPEN_ORDER + 1)!.text, f.find(KEY_OPEN_LEVEL)]).toEqual(["Stay here", "aggressive", null]);
    ui.pointer(0, KEY_OPEN_ORDER, 0, 0, 0, session);
    expect(sent[3]!.bytes[4]).toBe(ORDER_STAY);
    // A wild creature being tamed has none of these.
    Object.assign(subject, { owned: false, taming: true });
    ui.build(aspect, fullHud(), session);
    expect(f.find(KEY_OPEN_ORDER)).toBeNull();
  }
});

test("one that breeds says its sex and how its mating goes, and has a button for whether it may; a young one says how grown it is and has none; one taken as young is asked a name for", () => {
  expect([waitWords(45), waitWords(12 * 60 + 5), waitWords(5 * 3600 + 12 * 60 + 59)]).toEqual(["45s", "12m", "5h 12m"]);
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(fullInventory());
    const subject = { taming: false, owned: true, level: 12, progress: 0, te: 0.8, torpor: 0, food: 0.7, id: 77, points: 0, stance: 1, following: false, saddled: true, breeds: true, mating: false, female: true, stage: 3, maturity: 1, mate: 0, wait: 0 };
    Object.assign(session, { sessionState: SESSION_ALIVE, open: { name: "Blue", inventory: new Inventory(20) }, subject });
    const ui = new Ui();
    ui.registry = reg;
    ui.build(aspect, fullHud(), session);
    const f = ui.frame;
    const said = (): string => f.find(KEY_OPEN_SUBJECT)!.text;
    expect(said(), name).toBe("level 12  female  torpor 0%  food 70%".slice(0, said().length));
    // Saddled and able to mate, it has five buttons in its row.
    expect([f.find(KEY_OPEN_MATE)!.text, f.find(KEY_OPEN_UNSADDLE) !== null], name).toEqual(["Mating off".slice(0, f.find(KEY_OPEN_MATE)!.text.length), true]);
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      if (!n.interactive) continue;
      expect(n.x + n.w, `${name} ${n.key}`).toBeLessThanOrEqual(f.width + 0.01);
      if (n.key === KEY_OPEN_MATE || n.key === KEY_OPEN_UNSADDLE || n.key === KEY_OPEN_ORDER || n.key === KEY_OPEN_ORDER + 1) expect(textWidth(n.text, n.style), `${name} ${n.key} "${n.text}"`).toBeLessThanOrEqual(n.w + 0.01);
      for (let j = i + 1; j < f.count; j++) if (f.nodes[j]!.interactive) expect(overlaps(f, i, j), `${name} ${n.key} ${f.nodes[j]!.key}`).toBe(false);
    }
    // A press sends ORDER_MATE. Once the subject says it is mating the button says so, and a second press sends ORDER_UNMATE.
    ui.pointer(0, KEY_OPEN_MATE, 0, 0, 0, session);
    Object.assign(subject, { mating: true, mate: 0.43 });
    ui.build(aspect, fullHud(), session);
    expect([f.find(KEY_OPEN_MATE)!.text, said()], name).toEqual(["Mating on".slice(0, f.find(KEY_OPEN_MATE)!.text.length), "level 12  female  torpor 0%  food 70%  mating 43%".slice(0, said().length)]);
    ui.pointer(0, KEY_OPEN_MATE, 0, 0, 0, session);
    expect(sent.map((c) => [c.op, new BitReader(c.bytes).u32(), c.bytes[4]])).toEqual([[CMD_ORDER, 77, ORDER_MATE], [CMD_ORDER, 77, ORDER_UNMATE]]);
    // After an egg she rests, and the line says for how long.
    Object.assign(subject, { mate: 0, wait: 5 * 3600 + 12 * 60 });
    ui.build(aspect, fullHud(), session);
    expect(said(), name).toBe("level 12  female  torpor 0%  food 70%  rests 5h 12m".slice(0, said().length));
    Object.assign(subject, { saddled: false, mating: false, female: false, stage: 1, maturity: 0.34, wait: 0 });
    ui.build(aspect, fullHud(), session);
    expect([said(), f.find(KEY_OPEN_MATE), f.find(KEY_OPEN_ORDER)!.text], name).toEqual(["level 12  male  juvenile 34%  torpor 0%  food 70%".slice(0, said().length), null, "Follow me"]);

    ui.key("Escape", true, false, session);
    Object.assign(session, { open: null, subject: null });
    session.tamed.push({ handle: 0x77, kind: reg.index.get("core:parasaur")!, level: 9, te: 255 });
    ui.build(aspect, fullHud(), session);
    const title = f.find(KEY_NAME_TITLE)!;
    expect([ui.naming.open, title.text], name).toEqual([true, "Yours: a young parasaur, level 9"]);
    expect(textWidth(title.text, title.style), name).toBeLessThanOrEqual(title.w + 0.01);
  }
});

test("a bed's list names it and travels from it: the name is typed in a field that has the keyboard, and Enter sends it", () => {
  const world = flatWorld(2);
  const bed = world.structs.add(reg.index.get("core:bed")!, 20, 0.6, 20, 0, 7, 1000);
  for (const [name, aspect] of ASPECTS) {
    const { session, sent } = fakeSession(new Inventory(40));
    Object.assign(session, { sessionState: SESSION_ALIVE, world });
    const ui = new Ui();
    ui.registry = reg;
    ui.structure.begin(bed);
    ui.build(aspect, fullHud(), session);
    expect([3, 4].map((n) => ui.frame.find(KEY_STRUCT_BUTTON + n)!.text), name).toEqual(["4  Name it", "5  Travel from it"]);
    ui.key("Digit4", true, false, session);
    expect([ui.structure.naming, ui.captureKeyboard, ui.key("KeyW", true, false, session)]).toEqual([true, true, false]);
    ui.build(aspect, fullHud(), session);
    const field = ui.frame.find(KEY_STRUCT_NAME_INPUT)!;
    expect([field.focus, field.x + field.w <= ui.frame.width + 0.01]).toEqual([true, true]);
    ui.input(KEY_STRUCT_NAME_INPUT, "Home by the sea, with a long name");
    expect(ui.key("Enter", true, false, session)).toBe(true);
    const r = new BitReader(sent[0]!.bytes);
    expect([sent[0]!.op, r.u32(), r.u8(), r.string(MAX_NAME_BYTES)]).toEqual([CMD_STRUCT, bed, STRUCT_NAME, "Home by the sea, with a"]);
    expect([ui.structure.open, ui.captureKeyboard]).toEqual([false, false]);
    ui.structure.begin(bed);
    ui.key("Digit5", true, false, session);
    expect([sent[1]!.op, new BitReader(sent[1]!.bytes).u32(), sent[1]!.bytes[4]]).toEqual([CMD_STRUCT, bed, STRUCT_TRAVEL]);
  }
});
