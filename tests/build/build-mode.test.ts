// Build mode: its keys on every device, the placement's own answer, the piece drawn before the server says so, and undo.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { BUILD_REASONS, Builder, ENEMY_FOUNDATION as CLIENT_FOUNDATION, ENEMY_PILLAR as CLIENT_PILLAR, GHOST_BAD, GHOST_OK, PLACE_REACH, buildReason } from "../../client/core/build.ts";
import { BUILD_HINT } from "../../client/core/hud/action.ts";
import { PredictBuild, REFUSED } from "../../client/core/predict-build.ts";
import { DRAW_BLEND, type FramePacket } from "../../client/core/render/packet.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_TOUCH_BUTTON, KEY_ZONE_LOOK, LONG_MS, T_CANCEL } from "../../client/core/touch.ts";
import { KEY_AMMO, KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { KEY_PROMPT_UNDER } from "../../client/core/hud/prompt.ts";
import { KEY_STRUCT_BUTTON } from "../../client/core/ui/structure.ts";
import { ENEMY_FOUNDATION, ENEMY_PILLAR } from "../../server/build.ts";
import { Rules } from "../../server/settings/rules.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { makePlaced, readPlaced, writePlaced } from "../../shared/net/placed.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, PLACED_COUNTS, PLACED_ENTITY, PLACED_METRES, PLACED_NONE, PLACED_STRUCTURE, RESULT_BODY, RESULT_ENEMY_NEAR, RESULT_LIMIT, RESULT_NO_SNAP, RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { BUILD_REACH } from "../../shared/world/snap.ts";
import { flatGround } from "../fixtures/arena.ts";
import { PIECES } from "../fixtures/build.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { PANEL, sceneWorld } from "../fixtures/sceneworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** What a server waits before a harmed piece may be mended, as its settings have it unless changed. */
const REPAIR_WAIT = Math.round(new Rules().num("StructureDamageRepairCooldown") * TICK_RATE);

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;

/** A whole client on level ground with `pieces` in its first hotbar slots, three of each, over a link `latencyMs` each way. */
function client(pieces: readonly string[], latencyMs = 0, give = 3) {
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
  const g = flatGround(h, 14, 14);
  s.text(`tp ${(g.x + 7).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  run(300);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  for (const [slot, piece] of pieces.entries()) {
    h.host.items.mint(rec, id(piece), give);
    run(200 + latencyMs * 2);
    const inv = s.inventory!;
    const from = inv.item.indexOf(id(piece));
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(piece))));
    run(150 + latencyMs * 2);
  }
  /** Looks at the ground `far` metres ahead. */
  const look = (far: number, yaw = 0): void => {
    app.controls.yaw = yaw;
    app.controls.pitch = Math.atan2(-1.62, far);
  };
  /** How many pieces of `kind` the frame draws as built: instances of its mesh in draws that are not see-through. */
  const built = (p: FramePacket, kind: number): number => {
    const seen = new Set<string>();
    for (let d = 0; d < p.drawCount; d++) {
      if (p.drawMesh[d] !== app.scene!.meshOfKind[kind] || (p.drawFlags[d]! & DRAW_BLEND) !== 0) continue;
      for (let k = 0; k < p.drawInstances[d]!; k++) seen.add(`${p.drawBuffer[d]}:${p.drawFirst[d]! + k}`);
    }
    return seen.size;
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
  return { h, app, s, rec, run, look, built, click, tap, team: rec.team };
}

test("the placement's answer is read as it was written, with each kind of cause", () => {
  const w = new BitWriter(64), r = new BitReader(), out = makePlaced();
  const cases = [
    { seq: 7, refs: [3 * 65536 + 9], code: RESULT_OK, detail: PLACED_NONE, a: 0, b: 0 },
    { seq: 65535, refs: [65536 + 1, 65536 + 2, 5 * 65536], code: RESULT_OBSTRUCTED, detail: PLACED_STRUCTURE, a: 0xfffe0003, b: 0 },
    { seq: 1, refs: [], code: RESULT_BODY, detail: PLACED_ENTITY, a: 4321, b: 0 },
    { seq: 2, refs: [], code: RESULT_ENEMY_NEAR, detail: PLACED_METRES, a: 32, b: 50 },
    { seq: 3, refs: [], code: RESULT_LIMIT, detail: PLACED_COUNTS, a: 10500, b: 10500 },
    { seq: 4, refs: [], code: RESULT_NO_SNAP, detail: PLACED_NONE, a: 0, b: 0 },
  ];
  for (const c of cases) {
    w.reset();
    writePlaced(w, { ...c, next: -1, skipped: 0 });
    r.reset(w.bytes());
    expect(readPlaced(r, out)).toBe(true);
    expect(out).toEqual({ ...c, next: -1, skipped: 0 });
  }
  // Cut short, it says so and nothing is taken from it.
  r.reset(new Uint8Array(2));
  expect(readPlaced(r, out)).toBe(false);
});

test("the client's reach and enemy ranges are the server's", () => {
  expect([CLIENT_FOUNDATION, CLIENT_PILLAR, PLACE_REACH]).toEqual([ENEMY_FOUNDATION, ENEMY_PILLAR, BUILD_REACH + 3]);
});

test("under 150 ms each way a piece is drawn on the click frame and one piece stands after the answer", () => {
  const { h, app, s, run, look, built, click } = client(["piece_foundation_wood"], 150);
  const kind = id("foundation_wood"), item = id("piece_foundation_wood");
  app.key("Digit1", true);
  look(5);
  let p = run(600);
  expect([app.scene!.ghost.kind, app.scene!.ghost.color, built(p, kind)]).toEqual([kind, GHOST_OK, 0]);
  expect(app.hud.hotbar[0]!.number).toBe("3");
  const rows = s.world!.structs.count;
  click();
  // The very next frame draws it as built, and the hotbar's count has given it up, before the server has heard.
  const at = [app.scene!.ghost.x, app.scene!.ghost.z];
  p = run(1);
  expect([built(p, kind), h.host.build.placed]).toEqual([1, 0]);
  expect([app.hud.hotbar[0]!.number, s.inventory!.total(item)]).toEqual(["2", 3]);
  // The preview has gone on to the place beside it, which the piece offers before the server has answered for it.
  expect(app.scene!.ghost.kind).toBe(kind);
  expect(Math.hypot(app.scene!.ghost.x - at[0]!, app.scene!.ghost.z - at[1]!)).toBeCloseTo(3, 3);
  // It is no row: nothing collides with it and no chunk has changed.
  expect(s.world!.structs.count).toBe(rows);
  // Held to the place the piece stands on, a second click asks for nothing more.
  app.builder.free = true;
  p = run(1);
  expect(app.scene!.ghost.kind).toBe(0);
  click();
  expect(app.predict.entries.length).toBe(1);
  // In every frame until long after the answer exactly one stands, and the count never goes back up.
  for (let f = 0; f < 90; f++) {
    p = run(1000 / 60);
    expect([f, built(p, kind)]).toEqual([f, 1]);
    expect(app.hud.hotbar[0]!.number).toBe("2");
  }
  expect([h.host.build.placed, h.host.build.refused, app.predict.entries.length, s.inventory!.total(item)]).toEqual([1, 0, 0, 2]);
  const ref = h.host.build.last, t = s.world!.structs.chunks[Math.floor(ref / 65536)]!;
  expect([t.kind[ref & 0xffff], s.world!.structs.count]).toEqual([kind, rows + 1]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a refusal only the server can know takes the drawn piece away, gives the count back and names the blocker", () => {
  const { h, app, s, run, look, built, click } = client(["piece_foundation_wood"], 75);
  const kind = id("foundation_wood"), item = id("piece_foundation_wood");
  app.key("Digit1", true);
  look(5);
  let p = run(600);
  expect(app.builder.problem).toBe(0);
  // Another tribe lays a foundation 32 m off in the tick of the click: the client has not been sent it.
  const at = app.builder.pose;
  h.world.structs.add(kind, at.x / U + 32.4, at.y / U, at.z / U, 0, 77, 15000);
  click();
  p = run(1);
  expect([built(p, kind), app.hud.hotbar[0]!.number]).toEqual([1, "2"]);
  let said = "";
  for (let f = 0; f < 60 && said === ""; f++) {
    p = run(1000 / 60);
    if (app.predict.entries.some((e) => e.state !== 0)) said = app.ui.frame.find(KEY_PROMPT)?.text ?? "";
  }
  // Refused: it is no longer drawn as built, the count is whole again, and the words name the cause.
  expect(said).toBe("32 m from another tribe's foundation; 50 needed");
  expect([built(p, kind), app.hud.hotbar[0]!.number]).toEqual([0, "3"]);
  p = run(1000);
  expect([built(p, kind), app.predict.entries.length, h.host.build.placed, h.host.build.refused, s.inventory!.total(item)]).toEqual([0, 0, 0, 1, 3]);
  // By now the row has come, and the preview says the same before any click.
  expect([app.builder.problem, app.builder.notice, app.scene!.ghost.color]).toEqual([RESULT_ENEMY_NEAR, "32 m from another tribe's foundation; 50 needed", GHOST_BAD]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a piece destroyed in the tick it was placed leaves nothing behind", () => {
  const { h, app, s, run, look, built, click } = client(["piece_foundation_wood"], 75);
  const kind = id("foundation_wood");
  app.key("Digit1", true);
  look(5);
  let p = run(600);
  const was = h.host.build.onPlaced;
  h.host.build.onPlaced = (by, ref) => {
    was?.(by, ref);
    h.world.structs.damage(ref, 1e9);
  };
  const before = [h.world.structs.count, s.world!.structs.count];
  click();
  p = run(1);
  expect(built(p, kind)).toBe(1);
  p = run(1500);
  expect([h.host.build.placed, h.world.structs.count, s.world!.structs.count]).toEqual([1, ...before]);
  expect([built(p, kind), app.predict.entries.length]).toEqual([0, 0]);
  // The piece was spent, as the server has it.
  expect(app.hud.hotbar[0]!.number).toBe("2");
  expect(h.host.items.audit()).toEqual([]);
});

/** The client's build preview as the app runs it, from the body's eye along the pilot's look. */
function preview(h: Harness, s: ClientSession, pilot: Pilot, b: Builder, nowMs: number): void {
  const dir = [0, 0, 0];
  lookDirection(Math.round((pilot.yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((pilot.pitch / (Math.PI / 2)) * 16384), dir);
  b.update(s, s.world!, h.reg, s.own.x, s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance), s.own.z, dir[0]!, dir[1]!, dir[2]!, pilot.yaw, nowMs);
}

test("2,000 seeded placements under loss: the client's rows end as the server's, with nothing predicted left", () => {
  const h = new Harness({}, 9, 60, { dev: true });
  const s = h.join("ada", { latencyMs: 60, jitterMs: 25, loss: 0.05 });
  h.run(1500);
  const g = flatGround(h, 60, 60);
  h.say(s, "enablecheats", 600);
  h.say(s, `tp ${(g.x + 30).toFixed(3)} ${(g.z + 30).toFixed(3)}`, 600);
  h.say(s, "setstat weight 255", 600);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  PIECES.forEach((piece, slot) => {
    h.host.items.mint(rec, id(`piece_${piece}_wood`), 20);
    h.run(500);
    const inv = s.inventory!, from = inv.item.indexOf(id(`piece_${piece}_wood`));
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(`piece_${piece}_wood`))));
    h.run(500);
  });
  const pilot = h.pilots[0]!, b = new Builder(), predict = new PredictBuild(), rng = new Rng(4242);
  // Wired as the app wires them.
  b.predict = predict;
  s.onPlaced = (p) => {
    predict.placed(p, s, h.now);
    const quiet = predict.quiet(p.seq) && p.code !== RESULT_OK;
    b.answered(p.seq, quiet ? RESULT_OK : p.code, p.code === RESULT_OK || quiet ? "" : buildReason(h.reg, s, p.code, p), h.now);
  };
  s.onRow = (ref) => predict.row(ref);
  s.onResult = (seq, code) => {
    predict.result(seq, code, h.now);
    b.result(seq, code, h.now);
  };
  const structs = h.world.structs;
  const mine = (): number[] => {
    const refs: number[] = [];
    for (let c = 0; c < structs.chunks.length; c++) {
      const t = structs.chunks[c];
      if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === rec.team) refs.push(c * 65536 + k);
    }
    return refs;
  };
  const counts = { asked: 0, drawn: 0, most: 0, undone: 0, held: 0, deep: 0 };
  // Pieces drawn at the click that the server then refused, or that went with one it refused.
  const refused = new Set<number>();
  const step = (): void => {
    for (const e of predict.entries) if (e.state === REFUSED && !e.undo) refused.add(e.id);
    predict.step(s, h.now);
  };
  for (let i = 0; counts.asked < 2000 && i < 12000; i++) {
    if (i % 150 === 149) {
      for (const ref of mine()) structs.remove(ref);
      h.run(300);
    }
    // Now and then a piece is broken behind the builder's back, sometimes the one just asked for.
    if (rng.int(9) === 0) {
      const refs = mine();
      if (refs.length > 0) structs.damage(rng.int(3) === 0 ? refs[refs.length - 1]! : refs[rng.int(refs.length)]!, 1e9);
    }
    if (i % 40 === 0) {
      pilot.moveZ = 1;
      pilot.yaw = rng.range(-Math.PI, Math.PI);
      h.run(rng.int(600));
      pilot.moveZ = 0;
      h.run(200);
    }
    const piece = rng.int(3) === 0 ? 0 : rng.int(PIECES.length), item = id(`piece_${PIECES[piece]}_wood`);
    // The slot in hand is kept stocked on the server, whatever an undo put in the bag.
    const stock = h.host.items.inv(rec), slot = stock.hotbar + piece;
    if (stock.count[slot]! < 5) {
      h.host.items.mint(rec, item, 20);
      for (let k = 0; k < stock.hotbar; k++) if (stock.item[k] === item) h.host.items.move(rec, k, rec, slot, 0);
    }
    if (s.held !== piece) {
      s.command(CMD_SELECT, (w: BitWriter) => w.u8(piece));
      // Three times in four the builder waits for the piece to be in hand, as one who looks at what they hold does.
      for (let k = 0; rng.int(4) !== 0 && k < 40 && s.handChanging; k++) h.run(20);
    }
    pilot.yaw = rng.range(-Math.PI, Math.PI);
    pilot.pitch = rng.range(-1.3, -0.15);
    // Often too short a wait for the last answer to be back.
    h.run(20 + rng.int(120));
    for (let k = rng.int(3); k > 0; k--) b.key("KeyR", true, false, h.now, h.reg);
    for (let k = rng.int(3); k > 0; k--) {
      b.key("KeyT", true, false, h.now, h.reg);
      b.key("KeyT", false, false, h.now, h.reg);
    }
    if (rng.int(10) === 0) b.free = !b.free;
    step();
    preview(h, s, pilot, b, h.now);
    // While the hand is changing nothing is shown, so nothing is set down as the piece being put away.
    if (s.handChanging) expect(b.active).toBe(false);
    if (!b.active) continue;
    const before = predict.entries.length, seq = b.setDown(s, h.reg, h.now);
    counts.asked += seq !== 0 ? 1 : 0;
    counts.held += seq < 0 ? 1 : 0;
    if (predict.entries.length > before) {
      counts.drawn++;
      if (predict.entries[before]!.on.length > 0 || seq < 0) counts.deep++;
    }
    counts.most = Math.max(counts.most, predict.entries.length);
    // A predicted piece is never a row.
    expect(s.world!.structs.count).toBeLessThanOrEqual(structs.count + 64);
    if (rng.int(25) === 0 && predict.undo(s) !== 0) counts.undone++;
  }
  for (let k = 0; k < 40; k++) {
    h.run(100);
    step();
  }
  expect(counts.asked).toBe(2000);
  expect(counts.drawn).toBeGreaterThan(600);
  expect(counts.most).toBeGreaterThan(1);
  expect(counts.undone).toBeGreaterThan(10);
  // Some were set on a piece the server had not answered for, a few of them on a base whose frame it had yet to say.
  expect(counts.deep).toBeGreaterThan(10);
  expect(counts.held).toBeGreaterThan(5);
  // Under one in twenty of the pieces drawn at the click went again. Those left joined a piece broken behind the builder's
  // back in the 50 ms before the click, which no client can know.
  expect(refused.size / counts.drawn).toBeLessThan(0.05);
  // A key names its piece's slot, so one sent while the hand was still changing on the server is refused, not built as another piece.
  expect(h.host.build.placed).toBeGreaterThan(400);
  expect(h.host.build.refused).toBeGreaterThan(100);
  expect(predict.entries).toEqual([]);
  for (const piece of PIECES) expect(predict.pending(id(`piece_${piece}_wood`))).toBe(0);
  // Every chunk the client holds is the server's, row for row.
  let rows = 0;
  const seen = s.world!.structs;
  for (let c = 0; c < seen.chunks.length; c++) {
    const a = seen.chunks[c], t = structs.chunks[c];
    if (!a) continue;
    for (let k = 0; k < Math.max(a.high, t?.high ?? 0); k++) {
      const there = t && k < t.high ? [t.kind[k], t.x[k], t.y[k], t.z[k], t.yaw[k], t.owner[k]] : [0, 0, 0, 0, 0, 0];
      const here = k < a.high ? [a.kind[k], a.x[k], a.y[k], a.z[k], a.yaw[k], a.owner[k]] : [0, 0, 0, 0, 0, 0];
      if (here[0] === 0 && there[0] === 0) continue;
      expect([c, k, ...here]).toEqual([c, k, ...there]);
      rows++;
    }
  }
  expect(rows).toBeGreaterThan(0);
  expect(s.inventory!.total(id("piece_wall_wood"))).toBe(h.host.items.inv(rec).total(id("piece_wall_wood")));
  expect([s.stats.undecodable, h.host.items.audit()]).toEqual([0, []]);
});

test("in the whole client each build key does its action, E uses, cancel puts the piece away, and a piece in hand does not stop a repair", () => {
  const { h, app, s, rec, run, look, built, click, tap, team } = client(["piece_foundation_wood", "piece_wall_wood", "piece_pillar_wood"], 0, 6);
  const ghost = app.scene!.ghost, b = app.builder;
  const text = (key: number): string => app.ui.frame.find(key)?.text ?? "";

  // Without a piece in hand the wheel and the middle button are the sight's and the visor's.
  expect(app.wheel(100)).toBe(false);
  app.mouseButton(1, true);
  expect(app.visor.held).toBe(true);
  app.mouseButton(1, false);
  expect([tap("KeyT"), tap("KeyQ")]).toEqual([true, false]);
  expect(b.variant).toBe(0);

  // A foundation on open ground: the wheel and R turn it by quarters, the arrows lift it, Q held lets go of other pieces.
  app.key("Digit1", true);
  look(5);
  run(300);
  expect([ghost.kind, ghost.color, text(KEY_AMMO)]).toEqual([id("foundation_wood"), GHOST_OK, BUILD_HINT]);
  // Nothing has been set down yet, and Z says so.
  tap("KeyZ");
  run(50);
  expect(text(KEY_PROMPT)).toBe("Nothing to undo");
  const yaw = ghost.yaw, y = ghost.y;
  expect(app.wheel(100)).toBe(true);
  run(50);
  expect(ghost.yaw).toBe((yaw + 16384) & 0xffff);
  app.wheel(-100);
  app.wheel(-100);
  run(50);
  expect(ghost.yaw).toBe((yaw - 16384) & 0xffff);
  expect(tap("KeyR")).toBe(true);
  run(50);
  expect(ghost.yaw).toBe(yaw);
  expect([tap("ArrowUp"), tap("ArrowUp"), tap("ArrowDown")]).toEqual([true, true, true]);
  run(50);
  expect(ghost.y).toBeCloseTo(y + 1 / 8, 5);
  tap("ArrowDown");
  app.mouseButton(1, true);
  app.mouseButton(1, false);
  expect(app.visor.held).toBe(false);
  app.key("KeyQ", true);
  run(400);
  app.key("KeyQ", false);
  expect(b.free).toBe(true);
  app.key("KeyQ", true);
  run(400);
  app.key("KeyQ", false);
  expect(b.free).toBe(false);
  click();
  run(300);
  expect(h.host.build.placed).toBe(1);
  const base = h.host.build.last;

  // A wall on it: T goes through its forms, Q tapped takes the next place, the click sets it down.
  app.key("Digit2", true);
  run(300);
  expect([ghost.kind, ghost.color]).toEqual([id("wall_wood"), GHOST_OK]);
  expect(tap("KeyT")).toBe(true);
  run(50);
  expect(ghost.kind).toBe(id("doorframe_wood"));
  tap("KeyT");
  run(50);
  expect(ghost.kind).toBe(id("windowframe_wood"));
  tap("KeyT");
  tap("KeyT");
  run(50);
  expect(ghost.kind).toBe(id("doorframe_wood"));
  const first = [ghost.x, ghost.z];
  expect(tap("KeyQ")).toBe(true);
  run(50);
  expect([ghost.x, ghost.z]).not.toEqual(first);
  b.step(-1);
  run(50);
  click();
  run(300);
  expect(h.host.build.placed).toBe(2);
  const frame = h.host.build.last;
  expect(h.world.structs.chunks[Math.floor(frame / 65536)]!.kind[frame & 0xffff]).toBe(id("doorframe_wood"));

  // Z takes the last piece back, and is not the emotes' key while a piece is in hand.
  expect(tap("KeyZ")).toBe(true);
  run(300);
  expect([h.host.build.pickedUp, s.inventory!.total(id("piece_wall_wood")), app.ui.emotes.open]).toEqual([1, 6, false]);
  click();
  run(300);
  expect(h.host.build.placed).toBe(3);
  const door = h.host.build.last;

  // With the wall still in hand a built piece 3.6 m off is aimed at. Harmed, E held opens its list, and it is mended with the piece in hand.
  app.controls.pitch = Math.atan2(-1.5, 3.6);
  run(300);
  const harmed = app.aimed;
  expect([b.active, harmed === base || harmed === door]).toEqual([true, true]);
  h.world.structs.damage(harmed, 4000);
  // Harm with no record of when counts from the server's start, so it is dated past the repair wait.
  h.host.build.hurt(harmed, h.world.tick - REPAIR_WAIT);
  for (const [item, n] of [["wood", 200], ["thatch", 200], ["fiber", 200]] as const) h.host.items.mint(rec, id(item), n);
  run(300);
  expect(text(KEY_PROMPT) + text(KEY_PROMPT_UNDER)).toContain("hold E");
  app.key("KeyE", true);
  run(500);
  app.key("KeyE", false);
  expect(app.ui.structure.open).toBe(true);
  // The list's last line undoes the last piece, for a pad or a finger.
  expect(app.ui.frame.find(KEY_STRUCT_BUTTON + 3)!.text).toBe("4  Undo your last piece");
  app.key("Digit2", true);
  app.key("Digit2", false);
  run(300);
  const t = h.world.structs.chunks[Math.floor(harmed / 65536)]!;
  expect([h.host.build.repaired, t.hp[harmed & 0xffff], b.active, s.held]).toEqual([1, reg.maxHp[t.kind[harmed & 0xffff]!]!, true, 1]);

  // E tapped uses: a box of the tribe's opens, with the piece still in hand.
  const box = h.world.structs.add(id("storage_box"), s.own.x, s.own.y + 0.3125, s.own.z + 1.6, 0, team, 500);
  app.controls.pitch = Math.atan2(-1.3, 1.6);
  run(300);
  expect(app.aimed).toBe(box);
  tap("KeyE");
  run(400);
  expect([s.open !== null, b.active]).toEqual([true, true]);
  tap("KeyE");
  run(400);
  expect(s.open).toBeNull();
  h.world.structs.remove(box);
  if (!app.ui.wantsPointerLock) tap("Escape");
  run(200);
  expect(app.ui.wantsPointerLock).toBe(true);

  // The middle button on a built piece takes its item in hand, in its form: the doorframe from the pillar.
  app.key("Digit3", true);
  look(5);
  run(300);
  expect(ghost.kind).toBe(id("pillar_wood"));
  expect(b.looked).toBeGreaterThanOrEqual(0);
  b.looked = door;
  app.mouseButton(1, true);
  app.mouseButton(1, false);
  run(300);
  expect([s.held, b.kind]).toEqual([1, id("doorframe_wood")]);

  // X puts the piece away, and so does the right button; neither lies the body down or raises a sight.
  expect(tap("KeyX")).toBe(true);
  expect(b.active).toBe(false);
  run(300);
  expect([s.held, ghost.kind, s.own.stance]).toEqual([-1, 0, 0]);
  expect(tap("KeyQ")).toBe(false);
  app.key("Digit2", true);
  run(300);
  expect(b.active).toBe(true);
  app.mouseButton(2, true);
  app.mouseButton(2, false);
  run(300);
  expect([s.held, b.active]).toEqual([-1, false]);

  // A pad: RB and LB turn, Y is the next form, the d-pad lifts, B puts away.
  app.key("Digit1", true);
  look(4, Math.PI / 2);
  run(300);
  expect([ghost.kind, b.active]).toEqual([id("foundation_wood"), true]);
  const pad = { connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  let at = h.now;
  const press = (button: number): void => {
    pad.buttons[button]!.pressed = true;
    app.gamepads([pad], (at += 16));
    pad.buttons[button]!.pressed = false;
    app.gamepads([pad], (at += 16));
  };
  app.gamepads([pad], (at += 16));
  const [turn, lift] = [b.turn, b.lift];
  press(5);
  expect(b.turn).toBe((turn + 1) % 4);
  press(4);
  expect(b.turn).toBe(turn);
  press(12);
  expect(b.lift).toBe(lift + 1);
  press(13);
  expect(b.lift).toBe(lift);
  app.key("Digit2", true);
  run(300);
  const form = b.variant;
  at = h.now;
  press(3);
  expect(b.variant).toBe(form + 1);
  press(1);
  run(300);
  expect([s.held, app.ui.inventory.open]).toEqual([-1, false]);

  // A finger held still on a built piece picks it, and its Cancel puts the piece away.
  app.key("Digit3", true);
  look(5);
  run(300);
  expect(b.kind).toBe(id("pillar_wood"));
  const dt = h.world.structs.chunks[Math.floor(door / 65536)]!, on = [0, 0, 0];
  expect(app.cam.project(dt.x[door & 0xffff]!, dt.y[door & 0xffff]! + 1.3, dt.z[door & 0xffff]!, on)).toBe(true);
  const fx = on[0]! * app.ui.frame.width, fy = on[1]! * app.ui.frame.height;
  app.pointer(0, KEY_ZONE_LOOK, fx, fy, 0, 1);
  run(LONG_MS + 100);
  app.pointer(1, KEY_ZONE_LOOK, fx, fy, 0, 1);
  run(300);
  expect([s.held, b.kind]).toEqual([1, id("doorframe_wood")]);
  app.pointer(0, KEY_TOUCH_BUTTON + T_CANCEL, 10, 10, 0, 1);
  app.pointer(1, KEY_TOUCH_BUTTON + T_CANCEL, 10, 10, 0, 1);
  run(300);
  expect([s.held, app.ui.menu]).toEqual([-1, false]);
  expect(BUILD_REASONS[RESULT_SHORT]).toBe("You have none left");
  expect(built(run(50), id("foundation_wood"))).toBe(1);
  expect(h.host.items.audit()).toEqual([]);
});

test("the piece about to be built shows fine or refused in one colour, whatever colours its mesh has", () => {
  const w = sceneWorld();
  // The panel's vertices carry a colour of their own and no region (fixtures/stage.ts squareMesh), as a modelled wall's do.
  const shot = (color: number): Float32Array | Uint8Array | Uint8ClampedArray => {
    Object.assign(w.scene.ghost, { kind: w.kind(PANEL), x: 32, y: 0, z: 24, yaw: 0, color });
    let p = w.frame();
    for (let f = 0; f < 8; f++) p = w.frame();
    const d = w.draws(p, PANEL).find((k) => (p.drawFlags[k]! & DRAW_BLEND) !== 0)!;
    expect(p.drawTint[d * 2]).toBe(color + 1);
    return w.raster.color.slice();
  };
  const fine = shot(GHOST_OK), refused = shot(GHOST_BAD);
  w.scene.ghost.kind = 0;
  w.frame();
  const bare = w.raster.color.slice();
  // Where the piece is drawn the two pictures differ from the bare one and from each other, each toward its own colour.
  const pal = w.pack.palette, lean = [0, 0, 0];
  let covered = 0;
  for (let o = 0; o < bare.length; o += 4) {
    if (fine[o] === bare[o] && fine[o + 1] === bare[o + 1] && fine[o + 2] === bare[o + 2]) continue;
    covered++;
    for (let k = 0; k < 3; k++) lean[k] = lean[k]! + (fine[o + k]! - refused[o + k]!) * Math.sign(pal[GHOST_OK * 4 + k]! - pal[GHOST_BAD * 4 + k]!);
  }
  expect(covered).toBeGreaterThan(50);
  expect(lean[0]! + lean[1]! + lean[2]!).toBeGreaterThan(covered * 20);
});
