// The template hammer in the whole client: a base copied, kept, set down as a plan with its report read first, and
// filled; a hologram filled by hand; and the hammer's panel by keyboard, finger and pad.

import { expect, test } from "bun:test";
// The editor's code at once, as a page has it once it has come (client/core/editor-load.ts).
import "../../client/core/editor.ts";
import { App } from "../../client/core/app.ts";
import { GHOST_OK } from "../../client/core/build.ts";
import { HAMMER_KEYS } from "../../client/core/editor-keys.ts";
import { plansOf } from "../../client/core/plans.ts";
import { DRAW_BLEND, MAX_HOLOGRAMS, type FramePacket } from "../../client/core/render/packet.ts";
import { Templates, copyBox } from "../../client/core/templates.ts";
import { HAMMER_ACT, HAMMER_FILL, HAMMER_LIST, HAMMER_MIRROR, HAMMER_TURN, KEY_HAMMER_BUTTON, KEY_HAMMER_COST, KEY_HAMMER_DELETE, KEY_HAMMER_EXPORT, KEY_HAMMER_IMPORT, KEY_HAMMER_IMPORT_INPUT, KEY_HAMMER_LINE, KEY_HAMMER_NAME_INPUT, KEY_HAMMER_NOTICE, KEY_HAMMER_PANEL, KEY_HAMMER_PLACE, KEY_HAMMER_ROW, KEY_HAMMER_TEXT, KEY_HAMMER_TITLE } from "../../client/core/ui/hammer.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { PLACE_PLAN } from "../../shared/net/place.ts";
import { PLAN_OK } from "../../shared/net/plan.ts";
import { BOX_SELF, CMD_MOVE, RESULT_NO_SUPPORT } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { BLUEPRINT_PREFIX, captureBlueprint, encodeBlueprintText, makeBlueprint, placeBlueprint, type Blueprint, type BlueprintPiece } from "../../shared/world/blueprint.ts";
import { keyFlip, keyLvl } from "../../shared/world/lattice/module.ts";
import { PIECE_FINE, filledAt, pieceBook } from "../../shared/world/plan.ts";
import { Found } from "../../shared/world/structures.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { WOOD, at, grid, house, raise } from "../fixtures/plans.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const book = pieceBook(reg);
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;

/** A whole client on level ground with the template hammer in its eighth hotbar slot and `pieces` in its first. */
function client(pieces: readonly string[] = [], latencyMs = 0) {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", { latencyMs }, { manual: true }), h.reg, parsePack(corePackBytes()));
  let packet: FramePacket | null = null;
  const run = (ms: number): FramePacket => {
    h.run(ms, (now) => (packet = app.frame(now, 1280, 720)));
    return packet!;
  };
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 70, 70);
  const tp = (x: number, z: number): void => {
    s.text(`tp ${x.toFixed(3)} ${z.toFixed(3)}`);
    run(400);
  };
  s.text("setstat weight 100000");
  run(300);
  s.text("setting PlanPasteCooldown 0");
  run(300);
  tp(g.x + 20, g.z + 20);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const give = (name: string, slot: number, n: number): void => {
    h.host.items.mint(rec, id(name), n);
    run(200 + latencyMs * 2);
    const inv = s.inventory!;
    const from = inv.item.indexOf(id(name));
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(name))));
    run(150 + latencyMs * 2);
  };
  give("template_hammer", 7, 1);
  pieces.forEach((piece, slot) => give(piece, slot, 4));
  /** Looks at the ground `far` metres ahead, facing `yaw`. */
  const look = (far: number, yaw = 0): void => {
    app.controls.yaw = yaw;
    app.controls.pitch = Math.atan2(-1.62, far);
  };
  const click = (): void => {
    app.mouseButton(0, true);
    app.mouseButton(0, false);
  };
  const tap = (code: string, source = 0): boolean => {
    const took = app.key(code, true, false, source);
    app.key(code, false, false, source);
    return took;
  };
  /** Presses the node `key` of the interface, by the mouse or by finger `finger`. */
  const press = (key: number, finger = 0): void => {
    const n = app.ui.frame.find(key);
    if (!n) throw new Error(`the interface has no node ${key}`);
    app.pointer(0, key, n.x + 2, n.y + 2, 0, finger);
    app.pointer(1, key, n.x + 2, n.y + 2, 0, finger);
  };
  const text = (key: number): string => app.ui.frame.find(key)?.text ?? "";
  const lines = (): string[] => Array.from({ length: 16 }, (_, i) => text(KEY_HAMMER_LINE + i)).filter((l) => l !== "");
  /** How many see-through pieces of `kind` the frame draws, and how many see-through draws of any piece of `kinds`. */
  const holograms = (p: FramePacket, kinds: readonly number[]): number => {
    const meshes = new Set(kinds.map((k) => app.scene!.meshOfKind[k]));
    let n = 0;
    for (let d = 0; d < p.drawCount; d++) if (meshes.has(p.drawMesh[d]!) && (p.drawFlags[d]! & DRAW_BLEND) !== 0) n += p.drawInstances[d]!;
    return n;
  };
  /** Gives one of its item for each piece of a blueprint. */
  const stock = (bp: Blueprint): void => {
    for (const p of bp.pieces) h.host.items.mint(rec, reg.pieceItem[book.kindOf(p.form, p.tier)]!, 1);
    run(300);
  };
  const carried = (bp: Blueprint): number => [...new Set(bp.pieces.map((p) => reg.pieceItem[book.kindOf(p.form, p.tier)]!))].reduce((n, item) => n + h.host.items.inv(rec).total(item), 0);
  return { h, app, s, rec, g, run, tp, look, click, tap, press, text, lines, holograms, stock, carried, give };
}

const found = new Found();

/** A frame of the server's as a blueprint anchored at its row with this key. */
function copied(h: Harness, fr: number, k0: number, k1: number): Blueprint {
  const structs = h.world.structs;
  const rows: BlueprintPiece[] = [];
  for (let i = 0, n = structs.rowsOf(fr, found); i < n; i++) {
    const t = structs.chunks[Math.floor(found.refs[i]! / 65536)]!;
    const slot = found.refs[i]! & 0xffff;
    rows.push({ form: book.name[t.kind[slot]!]!, tier: book.tier[t.kind[slot]!]!, k0: t.k0![slot]!, k1: t.k1![slot]! });
  }
  const got = captureBlueprint(rows, rows.findIndex((p) => p.k0 === k0 && p.k1 === k1), book.forms);
  if (!got.ok) throw new Error("the base does not copy");
  return got.blueprint;
}

const keys = (bp: Blueprint): string[] => bp.pieces.map((p) => `${p.form}/${p.tier}/${p.k0}/${p.k1}`);
const ALL = [...new Set(house(reg, 3, 2, 2).map((p) => book.kindOf(p.form, p.tier)))];

test("a house is copied, set down at an odd yaw with its report read first, filled in one action, and is the same house", () => {
  const { h, app, s, rec, g, run, tp, look, click, tap, press, text, lines, holograms, stock, carried } = client();
  const hammer = app.hammer!;
  const made = raise(h, house(reg, 3, 2, 2), rec.team, g.x + 20, g.z + 25, 0);
  run(400);
  // The hammer in hand, looking at the house's front: the strip offers to copy it.
  tap("Digit8");
  look(5);
  run(400);
  expect([hammer.active, hammer.looked >= 0, text(KEY_HAMMER_TITLE), text(KEY_HAMMER_BUTTON + HAMMER_ACT)]).toEqual([true, true, "Template hammer", "Click  Copy this base"]);
  const aimed = hammer.looked;
  click();
  run(100);
  expect(hammer.templates.list.map((t) => [t.name, t.author, t.pieces])).toEqual([["Base 1", "ada", 39]]);
  expect(text(KEY_HAMMER_NOTICE)).toBe('Copied 39 pieces as "Base 1"');
  const template = hammer.templates.blueprint(hammer.templates.list[0]!, book)!;
  // It is the server's base, anchored at the piece looked at.
  const key = { fr: 0, k0: 0, k1: 0 };
  h.world.structs.keyAt(aimed, key);
  expect(keys(template)).toEqual(keys(copied(h, made.fr, key.k0, key.k1)));
  const anchor = template.pieces.find((p) => (p.k0 & 0x3fffffff) === ((512 | (512 << 10) | (512 << 20)) >>> 0) && (p.k1 & 1023) === 512 && keyLvl(p.k1) === 0)!;

  // Walked away. T opens the list, and its row sets the template down: it follows the look as holograms.
  tp(g.x + 50, g.z + 20);
  expect(tap("KeyT")).toBe(true);
  run(100);
  expect([hammer.panel, app.ui.wantsPointerLock, text(KEY_HAMMER_ROW), text(KEY_HAMMER_COST)]).toEqual([true, false, "> Base 1  (39 pieces, by ada)", "needs 20 wooden wall, 12 wooden ceiling, 6 wooden foundation and 1 more kinds"]);
  press(KEY_HAMMER_PLACE);
  run(100);
  expect([hammer.panel, hammer.chosen, app.ui.wantsPointerLock]).toEqual([false, 0, true]);
  look(7, 0.6435);
  tap("KeyR");
  tap("KeyR");
  let p = run(900);
  // The report, before anything is sent: every piece fine, what it costs against what is carried, and the server's limits.
  expect(text(KEY_HAMMER_TITLE)).toBe("Base 1: 39 pieces");
  expect(lines()[0]).toBe("39 of 39 to build");
  expect(lines().join(" ")).toBe("39 of 39 to build Needs 20 wooden wall (20 short), 12 wooden ceiling (12 short), 6 wooden foundation (6 short), 1 wooden door (1 short) 78 of 10,500 structures here once built; plans 0 of 4");
  expect([hammer.judge.done, hammer.judge.counts[PIECE_FINE], hammer.joined, h.host.plans.made, h.host.plans.byId.size]).toEqual([true, 39, false, 0, 0]);
  expect([holograms(p, ALL), holograms(p, [id("foundation_wood")]), app.scene!.ghost.kind]).toEqual([39, 6, 0]);
  stock(template);
  run(200);
  expect(lines().join(" ")).toContain("Needs 20 wooden wall (have 20), 12 wooden ceiling (have 12), 6 wooden foundation (have 6), 1 wooden door (have 1)");

  // Set down: the template goes up in parts, the server judges it and answers, and the plan stands as holograms.
  const yaw = (Math.round((0.6435 / (2 * Math.PI)) * 65536) + Math.round((2 * 65536) / 12)) & 0xffff;
  const pose = { ...hammer.preview!.commit };
  click();
  run(700);
  expect([hammer.answered, hammer.answer.code, hammer.answer.fine, hammer.chosen, hammer.sent.messages]).toEqual([1, PLAN_OK, 39, -1, 2]);
  expect(text(KEY_HAMMER_NOTICE)).toBe("Plan set: 39 to build");
  const plan = [...h.host.plans.byId.values()][0]!;
  expect([plan.yaw, plan.ox, plan.oy, plan.oz, plan.fr, h.world.structs.frames.count]).toEqual([yaw, pose.ox, pose.oy, pose.oz, 0, 1]);
  p = run(300);
  expect([plansOf(s).plans.size, holograms(p, ALL), text(KEY_HAMMER_BUTTON + HAMMER_FILL), lines()]).toEqual([1, 39, "F  Fill what I carry", ["Plan: 39 of 39 pieces to build"]]);

  // One action fills it.
  const before = h.world.structs.count;
  expect(tap("KeyF")).toBe(true);
  p = run(2500);
  expect([h.host.plans.byId.size, h.world.structs.count, hammer.filling, hammer.sent.commands, hammer.sent.pieces]).toEqual([0, before + 39, null, 2, 39]);
  expect(text(KEY_HAMMER_NOTICE)).toBe("Built 39 pieces");
  expect([plansOf(s).plans.size, holograms(p, ALL)]).toEqual([0, 0]);
  // The new house is the old one, piece for piece, in a frame turned as the holograms were.
  const fr = h.world.structs.frames.next - 1;
  expect([h.world.structs.frames.get(fr)!.yaw, h.world.structs.frames.get(fr)!.live]).toEqual([yaw, 39]);
  expect(keys(copied(h, fr, anchor.k0, anchor.k1))).toEqual(keys(template));
  // It stands, it cost its pieces and no more, and the client's rows are the server's.
  run(600);
  expect([h.host.build.fallen, carried(template), h.host.items.audit(), s.world!.structs.frames.get(fr)!.live]).toEqual([0, 0, [], 39]);
});

test("the same template joined to the side of a base, turned a quarter and mirrored, is built key for key", () => {
  const { h, app, s, rec, g, run, tp, look, click, tap, press, text, lines, stock, carried } = client();
  const hammer = app.hammer!;
  const pieces = house(reg, 3, 2, 2);
  const made = raise(h, pieces, rec.team, g.x + 30, g.z + 30, 0);
  const bp = makeBlueprint("House", "ada", "", pieces);
  hammer.templates.add(bp, book);
  stock(bp);
  // South of the base, looking at the ground just east of its south-east foundation: the base offers a slot there.
  tp(g.x + 38, g.z + 25);
  tap("Digit8");
  run(300);
  tap("KeyT");
  run(100);
  press(KEY_HAMMER_PLACE);
  look(5.2, -0.1);
  tap("KeyR");
  tap("KeyQ");
  run(900);
  expect([hammer.joined, hammer.turn, hammer.mirror, text(KEY_HAMMER_TITLE)]).toEqual([true, 1, true, "House: 39 pieces, on the base"]);
  const commit = { ...hammer.preview!.commit };
  expect([commit.fr, commit.turn, commit.mirror]).toEqual([made.fr, 3, true]);
  const j = hammer.judge;
  expect(j.done).toBe(true);
  const fine = j.counts[PIECE_FINE]!;
  expect([fine > 20, lines()[0]!.startsWith(`${fine} of 39 to build`)]).toEqual([true, true]);
  click();
  run(700);
  // The server's own judging of each piece is the client's.
  expect([hammer.answer.code, hammer.answer.fine, hammer.answer.built, hammer.answer.blocked, hammer.answer.unsupported]).toEqual([PLAN_OK, fine, j.counts[1]!, j.blocked, j.counts[7]!]);
  const plan = [...h.host.plans.byId.values()][0]!;
  const want = placeBlueprint(bp, book.forms, true, 3, [commit.m0, commit.m1, commit.m2, commit.m3], commit.lvl);
  if (!want.ok) throw new Error("it does not place");
  expect([...plan.placed.k0].map((k0, i) => `${k0}/${plan.placed.k1[i]}`)).toEqual(want.blueprint.pieces.map((q) => `${q.k0}/${q.k1}`));
  const open: number[] = [];
  for (let i = 0; i < 39; i++) if (!filledAt(plan.filled, i)) open.push(i);
  const before = h.world.structs.count;
  tap("KeyF");
  run(2500);
  expect([h.world.structs.count, hammer.sent.pieces]).toEqual([before + fine, fine]);
  // Every piece built is a row of its kind on its own key, mirrored: its flip is set.
  const structs = h.world.structs;
  const key = { fr: 0, k0: 0, k1: 0 };
  let stood = 0;
  for (const i of open) {
    const ref = structs.refAt(made.fr, plan.placed.k0[i]!, plan.placed.k1[i]!);
    if (ref < 0 || !structs.keyAt(ref, key) || key.k1 !== plan.placed.k1[i]) continue;
    expect([structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff], keyFlip(key.k1)]).toEqual([plan.placed.kind[i]!, 1]);
    stood++;
  }
  expect(stood).toBe(fine);
  run(600);
  expect([h.host.build.fallen, carried(bp), h.host.items.audit(), s.stats.undecodable]).toEqual([0, 39 - fine, [], 0]);
});

test("a piece in hand fills the hologram looked at, where it would stand: a wall's hologram waits for its foundation", () => {
  const { h, app, s, rec, run, look, click, tap, press } = client(["piece_foundation_wood", "piece_wall_wood"]);
  const hammer = app.hammer!;
  const bp = makeBlueprint("Hut", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "wall", WOOD, grid(0, 1), 0, 0)]);
  hammer.templates.add(bp, book);
  tap("Digit8");
  run(300);
  tap("KeyT");
  run(100);
  press(KEY_HAMMER_PLACE);
  look(6, 0.3);
  run(600);
  click();
  run(600);
  expect([hammer.answer.code, plansOf(s).plans.size]).toEqual([PLAN_OK, 1]);
  const plan = [...h.host.plans.byId.values()][0]!;
  const view = [...plansOf(s).plans.values()][0]!;
  const wall = [...plan.placed.kind].indexOf(id("wall_wood"));
  const aim = (i: number): void => {
    const dx = view.x[i]! - s.own.x, dy = view.y[i]! - (s.own.y + 1.62), dz = view.z[i]! - s.own.z;
    app.controls.yaw = Math.atan2(dx, dz);
    app.controls.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  // With a wall in hand and the look on the wall's hologram, it is offered though nothing is built, and refused: nothing would hold it.
  tap("Digit2");
  aim(wall);
  run(300);
  const b = app.builder!;
  expect([b.active, b.mode, b.kind, b.problem, b.notice]).toEqual([true, PLACE_PLAN, id("wall_wood"), RESULT_NO_SUPPORT, "Nothing would hold it up"]);
  // The foundation's hologram takes the foundation in hand: it goes down on the plan's own key, in a frame made at the plan's pose.
  tap("Digit1");
  aim(1 - wall);
  run(300);
  expect([b.mode, b.kind, b.problem, app.scene!.ghost.color]).toEqual([PLACE_PLAN, id("foundation_wood"), 0, GHOST_OK]);
  click();
  run(500);
  const fr = h.world.structs.frames.next - 1;
  const frame = h.world.structs.frames.get(fr)!;
  expect([frame.live, frame.ox, frame.oy, frame.oz, frame.yaw, plan.fr, plan.left]).toEqual([1, plan.ox, plan.oy, plan.oz, plan.yaw, fr, 1]);
  expect(h.world.structs.refAt(fr, plan.placed.k0[1 - wall]!, plan.placed.k1[1 - wall]!)).toBe(h.host.build.last);
  // Now the wall would stand, and the last piece ends the plan.
  tap("Digit2");
  aim(wall);
  run(300);
  expect([b.mode, b.problem]).toEqual([PLACE_PLAN, 0]);
  click();
  run(500);
  expect([frame.live, h.host.plans.byId.size, plansOf(s).plans.size, h.host.items.inv(rec).total(id("piece_wall_wood")), h.host.items.inv(rec).total(id("piece_foundation_wood")), h.host.items.audit()]).toEqual([2, 0, 0, 3, 3, []]);
});

test("templates are shared as text, kept between visits, renamed and deleted from the panel, and a bad text says why", () => {
  const { app, run, tap, press, text } = client();
  const hammer = app.hammer!;
  let clip = "";
  hammer.copyText = (t) => void (clip = t);
  const bp = makeBlueprint("Hut", "bea", "A foundation and a wall.", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "wall", WOOD, grid(0, 1), 0, 0)]);
  const shared = (encodeBlueprintText(bp, book.forms) as { text: string }).text;
  tap("Digit8");
  run(200);
  // The strip's own button opens the list, as T does.
  press(KEY_HAMMER_BUTTON + HAMMER_LIST);
  run(50);
  expect([hammer.panel, text(KEY_HAMMER_TITLE), app.ui.frame.find(KEY_HAMMER_PANEL) !== null]).toEqual([true, "Templates: 0", true]);
  // A pasted text is taken in. One damaged on the way is refused with the reason, and so is one that is no template.
  app.textInput(KEY_HAMMER_IMPORT_INPUT, shared.slice(0, -3) + "AAA");
  press(KEY_HAMMER_IMPORT);
  run(50);
  expect([hammer.templates.list.length, text(KEY_HAMMER_NOTICE)]).toEqual([0, "The template's text was changed or damaged on the way"]);
  app.textInput(KEY_HAMMER_IMPORT_INPUT, "hello");
  tap("Enter");
  run(50);
  expect(text(KEY_HAMMER_NOTICE)).toBe("That is not a template's text: it starts with snbp: and has only letters, digits, - and _");
  app.textInput(KEY_HAMMER_IMPORT_INPUT, `  ${shared}\n`);
  press(KEY_HAMMER_IMPORT);
  run(50);
  expect([hammer.templates.list.map((t) => [t.name, t.author, t.description, t.pieces]), text(KEY_HAMMER_NOTICE), hammer.importText]).toEqual([[["Hut", "bea", "A foundation and a wall.", 2]], 'Imported "Hut", 2 pieces', ""]);
  expect(text(KEY_HAMMER_COST)).toBe("needs 1 wooden foundation, 1 wooden wall. A foundation and a wall.");
  // Renamed with Enter, it is another text; shared, it goes to the clipboard and into the panel's field.
  app.textInput(KEY_HAMMER_NAME_INPUT, "Guard hut");
  tap("Enter");
  run(50);
  expect(hammer.templates.list[0]!.name).toBe("Guard hut");
  press(KEY_HAMMER_EXPORT);
  run(50);
  expect([clip.startsWith(BLUEPRINT_PREFIX), clip === hammer.templates.list[0]!.text, clip !== shared, text(KEY_HAMMER_TEXT)]).toEqual([true, true, true, clip]);
  // What the shell saves comes back as the same list.
  const saved = hammer.templates.serialize();
  const again = new Templates();
  again.restore(saved, book);
  expect(again.list).toEqual(hammer.templates.list);
  again.restore("{not json", book);
  expect(again.list.length).toBe(1);
  // Deleted, and Escape shuts the list.
  press(KEY_HAMMER_DELETE);
  run(50);
  expect([hammer.templates.list.length, hammer.panel]).toEqual([0, true]);
  tap("Escape");
  run(50);
  expect([hammer.panel, app.ui.wantsPointerLock]).toEqual([false, true]);
});

test("each of the hammer's actions has a key, a pad button and a button a finger presses", () => {
  const { h, app, rec, g, run, look, tap, press, text } = client();
  const hammer = app.hammer!;
  raise(h, house(reg, 2, 2, 1), rec.team, g.x + 20, g.z + 25, 0);
  hammer.templates.add(makeBlueprint("Hut", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0)]), book);
  run(300);
  // Without the hammer its keys are other things' keys.
  const row = HAMMER_KEYS[0]!;
  expect([row.when!(app, "KeyT", true, false), hammer.active]).toEqual([false, false]);
  tap("Digit8");
  look(5);
  run(300);
  expect(row.when!(app, "KeyT", true, false)).toBe(true);
  // Every key the row takes has a pad button, but the two a pad reaches through the list.
  expect(row.keys).toEqual(["KeyQ", "KeyR", "KeyT", "KeyX", "KeyF", "KeyG", "Delete", "ArrowUp", "ArrowDown"]);
  expect(Object.keys(row.pad!).sort()).toEqual(["ArrowDown", "ArrowUp", "KeyQ", "KeyT", "KeyX"]);
  // A finger: the strip's buttons carry no key's name, and each does its action.
  app.pointer(0, 0, 5, 5, 0, 1);
  app.pointer(1, 0, 5, 5, 0, 1);
  run(50);
  expect([app.ui.inputDevice, text(KEY_HAMMER_BUTTON + HAMMER_ACT), text(KEY_HAMMER_BUTTON + HAMMER_LIST)]).toEqual([2, "Copy this base", "Templates"]);
  press(KEY_HAMMER_BUTTON + HAMMER_ACT, 1);
  run(50);
  expect(hammer.templates.list.map((t) => t.pieces)).toEqual([17, 1]);
  hammer.choose(1);
  look(6, 0.4);
  run(300);
  expect([text(KEY_HAMMER_BUTTON + HAMMER_ACT), text(KEY_HAMMER_BUTTON + HAMMER_TURN), text(KEY_HAMMER_BUTTON + HAMMER_MIRROR)]).toEqual(["Set the plan down", "Turn", "Mirror"]);
  press(KEY_HAMMER_BUTTON + HAMMER_TURN, 1);
  press(KEY_HAMMER_BUTTON + HAMMER_MIRROR, 1);
  expect([hammer.turn, hammer.mirror]).toEqual([1, true]);
  // A pad: its buttons press the row's keys, and the strip names them.
  tap("KeyQ", 1);
  tap("ArrowUp", 1);
  run(50);
  expect([hammer.mirror, hammer.raise, app.ui.inputDevice, text(KEY_HAMMER_BUTTON + HAMMER_TURN)]).toEqual([false, 1, 1, "RB  Turn"]);
  // The d-pad's right is the middle button, which fills: here there is no plan to fill.
  app.mouseButton(1, true, 1);
  app.mouseButton(1, false, 1);
  expect([hammer.notice, app.visor.held]).toEqual(["No plan of your tribe's is near", false]);
  // The wheel turns the template, and X puts it away.
  expect(app.wheel(100)).toBe(true);
  expect(hammer.turn).toBe(2);
  tap("KeyX");
  expect(hammer.chosen).toBe(-1);
  // G marks a box's corner, and again copies what lies between: here the one piece looked at twice, from its level up.
  look(5);
  run(200);
  tap("KeyG");
  expect(hammer.corner).toBe(hammer.looked);
  tap("KeyG");
  expect([hammer.corner, hammer.templates.list[0]!.name, hammer.templates.list.length]).toEqual([-1, "Part 3", 3]);
});

test("a box copies what of a base lies between two of its pieces, from the lower one up", () => {
  const { h, s, rec, g, run } = client();
  const made = raise(h, house(reg, 3, 2, 2), rec.team, g.x + 20, g.z + 25, 0);
  run(500);
  const structs = s.world!.structs;
  // The two west foundations of the three-wide house, one storey up: two foundations, the walls on the lines between and round them, and their ceiling.
  const got = copyBox(structs, book, made.refs[0]!, made.refs[1]!, 4, rec.team, "West", "ada");
  if (!got.ok) throw new Error(got.reason);
  const forms = got.blueprint.pieces.map((p) => p.form).sort();
  expect(forms.filter((f) => f === "foundation").length).toBe(2);
  expect(got.blueprint.pieces.every((p) => keyLvl(p.k1) >= 0 && keyLvl(p.k1) <= 4)).toBe(true);
  expect(got.blueprint.pieces.length < 39 / 2).toBe(true);
  // Pieces of another tribe's base are not copied.
  expect(copyBox(structs, book, made.refs[0]!, made.refs[1]!, 4, rec.team + 1, "West", "ada")).toEqual({ ok: false, reason: "That is not your tribe's" });
  expect(MAX_HOLOGRAMS).toBeGreaterThan(39);
  void U;
});
