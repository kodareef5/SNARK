// How building feels: the preview sees pieces the server has not answered for, shows its slot and how well the piece
// would stand, rows are dragged, and what would fall is shown before a piece is taken away.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { GHOST_BAD, GHOST_OK, GHOST_SLOT, GHOST_WARN, OTHERS_FADE, OTHERS_MOST } from "../../client/core/build.ts";
import { PROVISIONAL } from "../../client/core/build-view.ts";
import { REFUSED } from "../../client/core/predict-build.ts";
import { KEY_BUILD_SAYS } from "../../client/core/hud/hotbar.ts";
import { DRAW_BLEND, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { SLOT_EDGE_MESH, SLOT_SQUARE_MESH } from "../../client/core/render/passes/ghost.ts";
import { KEY_PROMPT } from "../../client/core/ui/hud.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { previewRows } from "../../tools/bench/preview.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** A whole client on level ground with `pieces` in its first hotbar slots, `give` of each, over a link `latencyMs` each way. */
function client(pieces: readonly string[], latencyMs = 0, give = 12) {
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
  run(300 + latencyMs * 2);
  const g = flatGround(h, 40, 40);
  s.text(`tp ${(g.x + 20).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
  run(300 + latencyMs * 2);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  for (const [slot, piece] of pieces.entries()) {
    h.host.items.mint(rec, id(piece), give);
    run(200 + latencyMs * 2);
    const inv = s.inventory!;
    const from = inv.item.indexOf(id(piece));
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(piece))));
    run(150 + latencyMs * 2);
  }
  /** Looks at the point `far` metres ahead and `up` metres over the ground, turned `yaw`. */
  const look = (far: number, yaw = 0, up = 0): void => {
    app.controls.yaw = yaw;
    app.controls.pitch = Math.atan2(up - 1.62, far);
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
  /** Looks at the point (x, y, z) of the world. */
  const aim = (x: number, y: number, z: number): void => {
    const own = s.own;
    app.controls.yaw = Math.atan2(x - own.x, z - own.z);
    app.controls.pitch = Math.atan2(y - own.y - 1.62, Math.hypot(x - own.x, z - own.z));
  };
  const text = (key: number): string => app.ui.frame.find(key)?.text ?? "";
  /** The see-through marks the frame draws of the pack mesh `mesh`: each one's colour, how faint it is, and its place in metres. */
  const marks = (p: FramePacket, mesh: string): { color: number; fade: number; x: number; y: number; z: number }[] => {
    const at = new Float32Array(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength >> 2), out = [];
    for (let d = 0; d < p.drawCount; d++) {
      if (p.drawMesh[d] !== app.scene!.assets.table.find(mesh) || p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_BLEND) === 0) continue;
      const near = (v: number): number => Math.round(v * 1024) / 1024;
      for (let k = p.drawFirst[d]!; k < p.drawFirst[d]! + p.drawInstances[d]!; k++) out.push({ color: p.drawTint[d * 2]! - 1, fade: p.drawTint[d * 2 + 1]!, x: near(at[k * 5]! + app.cam.x), y: near(at[k * 5 + 1]! + app.cam.y), z: near(at[k * 5 + 2]! + app.cam.z) });
    }
    return out;
  };
  /** Stands the survivor at (x, z), on the ground or at height `y`. */
  const stand = (x: number, z: number, y?: number): void => {
    s.text(y === undefined ? `tp ${x.toFixed(3)} ${z.toFixed(3)}` : `tp ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`);
    run(300 + latencyMs * 2);
  };
  /** The refs of the team's pieces on the server. */
  const mine = (): number[] => {
    const refs: number[] = [];
    const structs = h.world.structs;
    for (let c = 0; c < structs.chunks.length; c++) {
      const t = structs.chunks[c];
      if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === rec.team) refs.push(c * 65536 + k);
    }
    return refs;
  };
  return { h, app, s, rec, run, look, aim, built, click, tap, text, marks, stand, mine, team: rec.team, ghost: app.scene!.ghost, b: app.builder };
}

test("a piece is set on one the server has not answered for, a third waits, and all stand after the answers", () => {
  const { h, app, s, run, look, aim, built, click, text, mine, ghost, b } = client(["piece_foundation_wood"], 150);
  const kind = id("foundation_wood");
  app.key("Digit1", true);
  look(5);
  let p = run(700);
  expect([ghost.kind, ghost.color]).toEqual([kind, GHOST_OK]);
  const first = [ghost.x, ghost.y, ghost.z], rows = s.world!.structs.count;
  click();
  // The next frame the preview is on the place beside it, which only the piece just asked for offers.
  p = run(1);
  expect([b.problem, Math.hypot(ghost.x - first[0]!, ghost.z - first[2]!)]).toEqual([0, 3]);
  const second = [ghost.x, ghost.z];
  click();
  p = run(1);
  // Its command waits for the base's frame; it is drawn, and its item is off the count, all the same.
  const [root, joined] = app.predict.entries;
  expect([app.predict.entries.length, root!.seq !== 0, joined!.seq, joined!.on, joined!.over.fr >= PROVISIONAL]).toEqual([2, true, 0, [root!.id], true]);
  expect([built(p, kind), app.hud.hotbar[0]!.number, h.host.build.placed, s.world!.structs.count]).toEqual([2, "10", 0, rows]);
  // A place only the second offers is two answers away: it says so, and a click there asks for nothing.
  aim(second[0]! + (second[0] === first[0] ? 3 : 0), first[1]!, second[1]! + (second[0] === first[0] ? 0 : 3));
  p = run(1);
  p = run(1);
  expect([b.problem, text(KEY_PROMPT), ghost.kind]).toEqual([RESULT_WAIT, "Waiting for the piece it joins", kind]);
  click();
  expect(app.predict.entries.length).toBe(2);
  // In every frame until long after the answers both are drawn, once each, and the count never goes back up.
  let sent = 0;
  for (let f = 0; f < 120; f++) {
    p = run(1000 / 60);
    expect([f, built(p, kind)]).toEqual([f, 2]);
    expect(app.hud.hotbar[0]!.number).toBe("10");
    if (sent === 0 && h.host.build.placed === 2) sent = f;
  }
  // The second went once the first's row had come, and stood a trip and a half after its click.
  expect(sent).toBeGreaterThan(20);
  expect(sent).toBeLessThan(36);
  expect([h.host.build.placed, h.host.build.refused, app.predict.entries.length, s.world!.structs.count, mine().length]).toEqual([2, 0, 0, rows + 2, 2]);
  // With both answered for, the place that waited is offered like any other.
  expect([b.problem, ghost.kind, ghost.color]).toEqual([0, kind, GHOST_OK]);
  expect(h.host.items.audit()).toEqual([]);
});

test("refused, a piece takes with it the piece set on it: neither is drawn, both are back in the count, the second is never sent", () => {
  const { h, app, s, run, look, built, click, text, ghost, b } = client(["piece_foundation_wood"], 75);
  const kind = id("foundation_wood");
  app.key("Digit1", true);
  look(5);
  let p = run(600);
  expect(b.problem).toBe(0);
  // Another tribe lays a foundation 32 m off in the tick of the click: the client has not been sent it.
  h.world.structs.add(kind, ghost.x + 32.4, ghost.y, ghost.z, 0, 77, 15000);
  click();
  p = run(1);
  click();
  p = run(1);
  expect([app.predict.entries.length, built(p, kind), app.hud.hotbar[0]!.number]).toEqual([2, 2, "10"]);
  let said = "";
  for (let f = 0; f < 60 && said === ""; f++) {
    p = run(1000 / 60);
    if (app.predict.entries.some((e) => e.state === REFUSED)) said = text(KEY_PROMPT);
  }
  // Both go in the frame of the one refusal, which names its cause.
  expect(said).toBe("32 m from another tribe's foundation; 50 needed");
  expect(app.predict.entries.map((e) => e.state)).toEqual([REFUSED, REFUSED]);
  expect([built(p, kind), app.hud.hotbar[0]!.number]).toEqual([0, "12"]);
  p = run(1000);
  expect([built(p, kind), app.predict.entries.length, h.host.build.placed, h.host.build.refused, s.inventory!.total(id("piece_foundation_wood"))]).toEqual([0, 0, 0, 1, 12]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a builder who clicks wherever the preview is fine, 100 ms from the server, loses no piece drawn", () => {
  const { h, app, s, run, look, click, mine, b } = client(["piece_foundation_wood", "piece_wall_wood"], 100, 40);
  app.key("Digit1", true);
  look(5);
  run(700);
  const rows = s.world!.structs.count;
  click();
  let drawn = 1;
  const lost = new Set<number>();
  // Sweeping the look out and back over two seconds, a click in every frame the preview is fine.
  const sweep = (frames: number): void => {
    for (let f = 0; f < frames; f++) {
      look(3 + 9 * Math.abs(Math.sin(f / 19)), 0.5 * Math.sin(f / 31));
      run(1000 / 60);
      for (const e of app.predict.entries) if (e.state === REFUSED) lost.add(e.id);
      if (b.active && b.problem === 0) {
        const before = app.predict.entries.length;
        click();
        drawn += app.predict.entries.length - before;
      }
    }
  };
  sweep(120);
  app.key("Digit2", true);
  sweep(120);
  run(1500);
  for (const e of app.predict.entries) if (e.state === REFUSED) lost.add(e.id);
  // Eight pieces or more in four seconds, a third of them asked for before the piece under them was answered for.
  expect(drawn).toBeGreaterThan(8);
  expect([lost.size, h.host.build.refused, h.host.build.placed, app.predict.entries.length]).toEqual([0, 0, drawn, 0]);
  expect([s.world!.structs.count - rows, mine().length]).toEqual([drawn, drawn]);
  expect(h.host.items.audit()).toEqual([]);
});

test("the preview marks its slot and the others the look offers, and says and shows how well the piece would stand", () => {
  const { h, app, s, run, aim, click, text, marks, stand, ghost, b } = client(["piece_foundation_wood", "piece_wall_wood", "piece_ceiling_wood"]);
  const ox = s.own.x, oy = s.own.y, oz = s.own.z, top = oy + 0.125;
  // A base's first piece joins nothing: it stands by itself, and has no slot to mark.
  app.key("Digit1", true);
  aim(ox, oy, oz + 5);
  let p = run(300);
  expect([ghost.color, text(KEY_BUILD_SAYS), marks(p, SLOT_SQUARE_MESH).length]).toEqual([GHOST_OK, "Stability 4 of 4", 0]);
  click();
  run(300);
  // A wall at its far side: the side is outlined, and the three other sides faintly.
  app.key("Digit2", true);
  aim(ox, top, oz + 6.4);
  run(300);
  p = run(50);
  expect([ghost.kind, ghost.color, text(KEY_BUILD_SAYS)]).toEqual([id("wall_wood"), GHOST_OK, "Stability 4 of 4"]);
  const sides = marks(p, SLOT_EDGE_MESH);
  expect(sides.filter((m) => m.fade === 0).map((m) => [m.color, m.x - ox, m.y - top, m.z - oz])).toEqual([[GHOST_SLOT, 0, 0, 6.5]]);
  expect(sides.filter((m) => m.fade !== 0).map((m) => [m.color, m.fade, m.x - ox, m.z - oz]).sort()).toEqual([[GHOST_SLOT, Math.fround(OTHERS_FADE), -1.5, 5], [GHOST_SLOT, Math.fround(OTHERS_FADE), 0, 3.5], [GHOST_SLOT, Math.fround(OTHERS_FADE), 1.5, 5]].sort());
  click();
  run(300);
  // A floor on the wall's top, over the foundation, is a step from the ground: fine, in the clear colour, its square outlined.
  app.key("Digit3", true);
  aim(ox, top + 2.9, oz + 6.3);
  run(300);
  p = run(50);
  expect([ghost.kind, ghost.color, text(KEY_BUILD_SAYS), b.stability]).toEqual([id("ceiling_wood"), GHOST_OK, "Stability 3 of 4", 3]);
  expect(marks(p, SLOT_SQUARE_MESH).filter((m) => m.fade === 0).map((m) => [m.x - ox, m.y - top, m.z - oz])).toEqual([[0, 3, 5]]);
  click();
  run(300);
  // From the side: the floor out past the wall hangs from it as well, and the one past that is at the last step that stands.
  stand(ox + 5, oz + 9);
  aim(ox, top + 2.95, oz + 6.3);
  run(300);
  expect([ghost.x - ox, ghost.z - oz, ghost.color, text(KEY_BUILD_SAYS)]).toEqual([0, 8, GHOST_OK, "Stability 3 of 4"]);
  click();
  run(300);
  aim(ox, top + 2.95, oz + 9.3);
  run(300);
  expect([ghost.x - ox, ghost.z - oz, ghost.color, text(KEY_BUILD_SAYS)]).toEqual([0, 11, GHOST_WARN, "Stability 1 of 4"]);
  click();
  run(300);
  expect([h.host.build.placed, h.host.build.refused]).toEqual([5, 0]);
  // One more would not stand: refused in its colour, with the reason and no number.
  stand(ox + 3, oz + 14);
  aim(ox, top + 2.95, oz + 12.3);
  run(300);
  expect([ghost.x - ox, ghost.z - oz, ghost.color, b.problem, text(KEY_PROMPT), text(KEY_BUILD_SAYS)]).toEqual([0, 14, GHOST_BAD, RESULT_NO_SUPPORT, "Nothing would hold it up", ""]);
  // And no faint mark is on a place where nothing would stand.
  aim(ox, top + 2.95, oz + 9.6);
  run(300);
  p = run(50);
  const faint = marks(p, SLOT_SQUARE_MESH).filter((m) => m.fade !== 0).map((m) => `${m.x - ox},${m.y - top},${m.z - oz}`);
  expect(faint.length).toBeGreaterThan(0);
  expect(faint).not.toContain("0,3,14");
  expect(faint).not.toContain("3,3,11");
});

test("a look swept slowly from one side of a foundation to the next changes the slot once, later than half way, each way", () => {
  const { app, s, run, aim, click, b } = client(["piece_foundation_wood", "piece_wall_wood"]);
  const ox = s.own.x, oy = s.own.y, oz = s.own.z, top = oy + 0.125;
  app.key("Digit1", true);
  aim(ox, oy, oz + 5);
  run(300);
  click();
  run(300);
  app.key("Digit2", true);
  run(300);
  // From near the far side's middle to near the right side's middle, along a straight line over the foundation's top.
  const from = [0, 6.1], to = [1.1, 5];
  const sweep = (a: number[], c: number[]): number[] => {
    const turned: number[] = [];
    let last = "";
    for (let i = 0; i <= 300; i++) {
      const t = i / 300;
      aim(ox + a[0]! + (c[0]! - a[0]!) * t, top, oz + a[1]! + (c[1]! - a[1]!) * t);
      run(1000 / 60);
      const now = `${b.slotMark.x - ox},${b.slotMark.z - oz}`;
      if (last !== "" && now !== last) turned.push(t);
      last = now;
    }
    return turned;
  };
  const there = sweep(from, to), back = sweep(to, from);
  expect([there.length, back.length]).toEqual([1, 1]);
  // The slot shown is kept until the other is nearer by the margin: each way it turns past the middle of the way.
  expect(there[0]!).toBeGreaterThan(0.52);
  expect(back[0]!).toBeGreaterThan(0.52);
  // A look that trembles about the middle of the way turns nothing.
  let turns = 0, last = "";
  for (let i = 0; i < 120; i++) {
    const t = 0.5 + 0.03 * Math.sin(i * 2.1);
    aim(ox + from[0]! + (to[0]! - from[0]!) * t, top, oz + from[1]! + (to[1]! - from[1]!) * t);
    run(1000 / 60);
    const now = `${b.slotMark.x - ox},${b.slotMark.z - oz}`;
    if (last !== "" && now !== last) turns++;
    last = now;
  }
  expect(turns).toBe(0);
});

test("no slot is marked where the builder stands or a thing is in the way, and aimed at, such a slot names what blocks it", () => {
  const { h, app, s, run, aim, click, text, stand, ghost, b, team } = client(["piece_foundation_wood", "piece_wall_wood"]);
  const ox = s.own.x, oy = s.own.y, oz = s.own.z, top = oy + 0.125;
  app.key("Digit1", true);
  aim(ox, oy, oz + 5);
  run(300);
  click();
  run(300);
  // A box stands on the foundation's right side.
  h.world.structs.add(id("storage_box"), ox + 1.5, top + 0.3125, oz + 5, 0, team, 500);
  app.key("Digit2", true);
  aim(ox, top, oz + 6.4);
  run(400);
  const others = (): string[] => Array.from({ length: b.others }, (_, i) => `${b.otherMarks[i]!.x - ox},${b.otherMarks[i]!.z - oz}`).sort();
  expect(others()).toEqual(["-1.5,5", "0,3.5"]);
  aim(ox + 1.3, top, oz + 5);
  run(100);
  expect([ghost.x - ox, ghost.color, b.problem, text(KEY_PROMPT)]).toEqual([1.5, GHOST_BAD, RESULT_OBSTRUCTED, "Blocked by storage box"]);
  // Standing on the near side, that side is not marked either, though the far side is still chosen.
  stand(ox, oz + 3.5, top + 0.01);
  expect([s.own.x - ox, s.own.z - oz]).toEqual([0, 3.5]);
  aim(ox, top, oz + 6.4);
  run(300);
  expect([ghost.z - oz, ghost.color]).toEqual([6.5, GHOST_OK]);
  expect(others()).toEqual(["-1.5,5"]);
  expect(b.others).toBeLessThanOrEqual(OTHERS_MOST);
});

test("a frame of the preview costs little beside a base of 2,000 pieces and of 20,000, still or sweeping", () => {
  const rows = new Map<string, number>();
  let base = "";
  previewRows((title) => (base = title.includes("20,000") ? "20,000" : "2,000"), (name, value) => rows.set(`${base}: ${name}`, value));
  for (const pieces of ["2,000", "20,000"]) {
    for (const piece of ["a wall", "a ceiling", "a foundation"]) {
      // Measured at 0.001 to 0.002 ms still and 0.05 to 0.13 ms sweeping. The bounds leave room for a loaded machine.
      expect(rows.get(`${pieces}: ${piece}: a frame with the look still, median`)!).toBeLessThan(0.05);
      expect(rows.get(`${pieces}: ${piece}: a frame with the look sweeping, median`)!).toBeLessThan(1);
      expect(rows.get(`${pieces}: ${piece}: the other slots' marks in that, median`)!).toBeLessThan(0.1);
    }
  }
});
