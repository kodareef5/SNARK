// A fresh process gives each scenario the same unloaded modules as a newly opened game page.
import assert from "node:assert/strict";
import { App } from "../../client/core/app.ts";
import { askEditor, editorNow, plansWaiting, readHeldPlans } from "../../client/core/editor-load.ts";
import { messages } from "../../client/core/readers.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { PLAN_OK, makePlanReport, writePlanReport } from "../../shared/net/plan.ts";
import { BOX_SELF, CMD_MOVE, S_PLAN_GONE, S_PLAN_REPORT } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { HOTBAR_SLOTS } from "../../shared/sim/items.ts";
import { ACT_EQUIP, ACT_NONE } from "../../shared/sim/weapon.ts";
import { flatGround } from "./arena.ts";
import { Harness } from "./net.ts";
import { corePackBytes } from "./pack.ts";

/** A server message as the session's reader takes it: its kind read, the rest left. */
function message(kind: number, write: (w: BitWriter) => void): BitReader {
  const w = new BitWriter(256);
  w.u8(kind);
  write(w);
  const r = new BitReader(w.bytes().slice());
  r.u8();
  return r;
}

async function queuedPlans(): Promise<void> {
  const s = {} as ClientSession;
  const report = { ...makePlanReport(), seq: 7, code: PLAN_OK, id: 3, pieces: 40, fine: 38 };
  messages.read(S_PLAN_REPORT, s, message(S_PLAN_REPORT, (w) => writePlanReport(w, report)));
  messages.read(S_PLAN_GONE, s, message(S_PLAN_GONE, (w) => w.varint(3)));
  assert.ok(plansWaiting(s));
  const { plansOf } = await import("../../client/core/plans.ts");
  assert.equal(plansOf(s).reports, 0);
  readHeldPlans(s);
  assert.ok(!plansWaiting(s));
  assert.deepEqual([plansOf(s).reports, plansOf(s).report.seq, plansOf(s).report.pieces, plansOf(s).report.fine], [1, 7, 40, 38]);
  // Once it has come, a message is read as it comes.
  messages.read(S_PLAN_REPORT, s, message(S_PLAN_REPORT, (w) => writePlanReport(w, { ...report, seq: 8 })));
  assert.deepEqual([plansWaiting(s), plansOf(s).reports, plansOf(s).report.seq], [false, 2, 8]);
}

async function deferredPlacement(): Promise<void> {
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
  // Pieces in the bag and none in the hotbar: nothing is fetched.
  assert.ok(from >= 0 && (from < inv.hotbar || from >= inv.hotbar + HOTBAR_SLOTS));
  await Bun.sleep(20);
  assert.deepEqual([Boolean(app.builder), Boolean(app.hammer), Boolean(editorNow())], [false, false, false]);
  // Into the hotbar, the code is asked for; it comes while the page goes on.
  s.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(piece)));
  run(150);
  app.key("Digit1", true);
  app.controls.yaw = 0;
  app.controls.pitch = Math.atan2(-1.62, 5);
  run(50);
  // The piece is in hand and the code is on its way; the click is kept, and is no blow.
  const hits = h.host.combat.hits;
  app.mouseButton(0, true);
  app.mouseButton(0, false);
  assert.equal(Boolean(app.builder), false);
  await askEditor();
  run(300);
  assert.equal(app.builder?.active, true);
  assert.equal(h.host.build.placed, 1);
  // The piece was still being taken in hand when the click came, and the click was no blow.
  assert.ok([ACT_NONE, ACT_EQUIP].includes(s.own.act));
  assert.deepEqual([h.host.combat.hits, inv.total(piece)], [hits, 2]);
}

switch (process.argv[2]) {
  case "plans": await queuedPlans(); break;
  case "placement": await deferredPlacement(); break;
  default: throw new Error("Choose the plans or placement scenario");
}
