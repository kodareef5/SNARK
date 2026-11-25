// The editor's code comes as its own file (client/core/editor-load.ts). This file does not read it first, as a page does
// not: the plan messages sent before it come are kept and read in order, the file is asked for only once a piece is in
// hand, and a click made while it came is given to it.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { askEditor, editorNow, plansWaiting, readHeldPlans } from "../../client/core/editor-load.ts";
import { messages } from "../../client/core/readers.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { PLAN_OK, makePlanReport, writePlanReport } from "../../shared/net/plan.ts";
import { BOX_SELF, CMD_MOVE, S_PLAN_GONE, S_PLAN_REPORT } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ACT_EQUIP, ACT_NONE } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

/** A server message as the session's reader takes it: its kind read, the rest left. */
function message(kind: number, write: (w: BitWriter) => void): BitReader {
  const w = new BitWriter(256);
  w.u8(kind);
  write(w);
  const r = new BitReader(w.bytes().slice());
  r.u8();
  return r;
}

test("plan messages sent before the plans' code has come are kept, and read in the order they came once it has", async () => {
  const s = {} as ClientSession;
  const report = { ...makePlanReport(), seq: 7, code: PLAN_OK, id: 3, pieces: 40, fine: 38 };
  messages.read(S_PLAN_REPORT, s, message(S_PLAN_REPORT, (w) => writePlanReport(w, report)));
  messages.read(S_PLAN_GONE, s, message(S_PLAN_GONE, (w) => w.varint(3)));
  expect(plansWaiting(s)).toBe(true);
  const { plansOf } = await import("../../client/core/plans.ts");
  expect(plansOf(s).reports).toBe(0);
  readHeldPlans(s);
  expect(plansWaiting(s)).toBe(false);
  expect([plansOf(s).reports, plansOf(s).report.seq, plansOf(s).report.pieces, plansOf(s).report.fine]).toEqual([1, 7, 40, 38]);
  // Once it has come, a message is read as it comes.
  messages.read(S_PLAN_REPORT, s, message(S_PLAN_REPORT, (w) => writePlanReport(w, { ...report, seq: 8 })));
  expect([plansWaiting(s), plansOf(s).reports, plansOf(s).report.seq]).toEqual([false, 2, 8]);
});

test("the editor is asked for once a piece is in hand, and the click made while it came sets the piece down", async () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, parsePack(corePackBytes()));
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 14, 14);
  s.text(`tp ${(g.x + 7).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  run(300);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!, piece = id("piece_foundation_wood");
  h.host.items.mint(rec, piece, 3);
  run(200);
  const inv = s.inventory!, from = inv.item.indexOf(piece);
  s.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(piece)));
  run(150);
  // Nothing in hand that builds: nothing is fetched.
  await Bun.sleep(20);
  expect([app.builder, app.hammer, editorNow()]).toEqual([null, null, null]);
  app.key("Digit1", true);
  app.controls.yaw = 0;
  app.controls.pitch = Math.atan2(-1.62, 5);
  run(50);
  // The piece is in hand and the code is on its way; the click is kept, and is no blow.
  const hits = h.host.combat.hits;
  app.mouseButton(0, true);
  app.mouseButton(0, false);
  expect(app.builder).toBeNull();
  await askEditor();
  run(300);
  expect(app.builder?.active).toBe(true);
  expect(h.host.build.placed).toBe(1);
  // The piece was still being taken in hand when the click came, and the click was no blow.
  expect([ACT_NONE, ACT_EQUIP]).toContain(s.own.act);
  expect([h.host.combat.hits, inv.total(piece)]).toEqual([hits, 2]);
});
