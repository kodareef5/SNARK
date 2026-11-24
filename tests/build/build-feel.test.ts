// How building feels: the preview sees pieces the server has not answered for, shows its slot and how well the piece
// would stand, rows are dragged, and what would fall is shown before a piece is taken away.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { GHOST_OK } from "../../client/core/build.ts";
import { PROVISIONAL } from "../../client/core/build-view.ts";
import { REFUSED } from "../../client/core/predict-build.ts";
import { DRAW_BLEND, type FramePacket } from "../../client/core/render/packet.ts";
import { KEY_PROMPT } from "../../client/core/ui/hud.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

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
  return { h, app, s, rec, run, look, aim, built, click, tap, text, mine, team: rec.team, ghost: app.scene!.ghost, b: app.builder };
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
