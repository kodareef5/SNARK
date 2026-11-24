// Rows for a plan of 2,000 pieces (server/plans.ts): what its paste costs the server a tick while it is judged, the
// bytes each way, and how long the fill takes. `bun tools/bench/plans.ts` runs these alone and prints them.

import { plansOf } from "../../client/core/plans.ts";
import { PLAN_TICK_PIECES } from "../../server/plans.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { writeFill } from "../../shared/net/place.ts";
import { makePlanCommit, writePlanCommit } from "../../shared/net/plan.ts";
import { CMD_PLACE, CMD_PLAN_CANCEL, CMD_PLAN_COMMIT, CMD_SELECT, RESULT_OK, RESULT_RATE } from "../../shared/net/protocol.ts";
import { encodeBlueprint, makeBlueprint } from "../../shared/world/blueprint.ts";
import { pieceBook, placePieces, placePlan, planGround } from "../../shared/world/plan.ts";
import { flatGround } from "../../tests/fixtures/arena.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { giveHammer, keep, uploadParts } from "../../tests/fixtures/plans.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";

const reg = coreRegistry();
const book = pieceBook(reg);
const row = (name: string, value: number | string, unit = ""): void => console.log(`${name.padEnd(64)} ${typeof value === "number" ? value.toFixed(value < 10 ? 3 : 0) : value} ${unit}`);

const h = new Harness({}, 1, 60, { dev: true });
const ada = h.join("ada");
h.run(600);
const g = flatGround(h, 70, 70);
h.say(ada, "enablecheats");
h.say(ada, `tp ${(g.x + 35).toFixed(3)} ${(g.z + 7).toFixed(3)}`);
h.say(ada, "setstat weight 1000000");
giveHammer(h, ada);
ada.command(CMD_SELECT, (w: BitWriter) => w.u8(7));
h.run(200);
const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
const bp = makeBlueprint("Keep", "ada", "Two thousand pieces.", keep(reg, 2000));
const bytes = (encodeBlueprint(bp, book.forms) as { bytes: Uint8Array }).bytes;
row("Blueprint", bytes.length, "bytes");

// Reading and placing the blueprint, which the commit does at once.
let t0 = performance.now();
for (let k = 0; k < 20; k++) placePlan(book, bytes, false, 0, [0, 0, 0, 0], 0);
row("Decode and place 2,000 pieces", (performance.now() - t0) / 20, "ms");

const placed = placePieces(book, bp, false, 0, [0, 0, 0, 0], 0);
if (!placed.ok) throw new Error("the keep does not place");
const origin = { ox: 0, oy: 0, oz: 0 };
planGround((x, z) => h.world.hf.heightAt(x, z), reg, reg.forms, placed.placed, g.x + 21.5, g.z + 11.5, 0, 0, origin);

// The paste, with each tick's judging timed.
const plans = h.host.plans;
const step = plans.step.bind(plans);
const commit = plans.commit.bind(plans);
let worst = 0;
let total = 0;
let ticks = 0;
const each: number[] = [];
plans.step = () => {
  const at = performance.now();
  const before = plans.judgedMost;
  step();
  const ms = performance.now() - at;
  if (ms > 0.05) {
    worst = Math.max(worst, ms);
    total += ms;
    ticks++;
    each.push(ms);
  }
  void before;
};
let commitMs = 0;
plans.commit = (c, r, seq) => {
  const at = performance.now();
  const code = commit(c, r, seq);
  commitMs = performance.now() - at;
  return code;
};
const views = plansOf(ada);
// Once to warm the machine, taken away again; then the one measured.
h.say(ada, "setting PlanPasteCooldown 0");
uploadParts(h, ada, bytes);
ada.command(CMD_PLAN_COMMIT, (w: BitWriter) => writePlanCommit(w, { ...makePlanCommit(), ...origin, yaw: 0 }));
while (views.reports === 0) h.run(1000 / 30);
ada.command(CMD_PLAN_CANCEL, (w: BitWriter) => w.varint(views.report.id));
h.run(500);
[worst, total, ticks, each.length] = [0, 0, 0, 0];
const parts = uploadParts(h, ada, bytes);
const tick0 = h.world.tick;
const reports = views.reports;
ada.command(CMD_PLAN_COMMIT, (w: BitWriter) => writePlanCommit(w, { ...makePlanCommit(), ...origin, yaw: 0 }));
while (views.reports === reports) h.run(1000 / 30);
row("Upload", `${parts} parts and a commit`, "");
row("The commit's own tick: decode and place", commitMs, "ms");
row(`Judging, ${PLAN_TICK_PIECES} looks a tick: ticks`, ticks, "");
row("Judging: median tick", each.sort((a, b) => a - b)[each.length >> 1]!, "ms");
row("Judging: worst tick", worst, "ms");
row("Judging: all ticks together", total, "ms");
row("From commit to report", h.world.tick - tick0, "ticks");
row("Report", `code ${views.report.code}, ${views.report.fine} fine, ${views.report.blocked} blocked, ${views.report.unsupported} unsupported`, "");
h.run(500);
row("S_PLAN to a member", views.bytes, "bytes");

// The fill.
for (const p of bp.pieces) h.host.items.mint(rec, reg.pieceItem[book.kindOf(p.form, p.tier)]!, 1);
h.run(300);
let built = 0;
let commands = 0;
let from = 0;
let code = RESULT_OK;
let got = false;
ada.onPlaced = (p) => {
  built += p.refs.length;
  from = p.next;
  code = p.code;
  got = true;
};
const fill0 = h.world.tick;
t0 = performance.now();
let fillWorst = 0;
let fillAll = 0;
const place = h.host.build.place.bind(h.host.build);
h.host.build.place = (c, r, seq) => {
  const at = performance.now();
  const out = place(c, r, seq);
  fillWorst = Math.max(fillWorst, performance.now() - at);
  fillAll += performance.now() - at;
  return out;
};
// As the hammer paces it: after each run, as long as the run's pieces take to come back to the session's allowance.
while (plans.byId.size > 0 && from < 2000 && commands < 400) {
  got = false;
  const before = built;
  ada.command(CMD_PLACE, (w: BitWriter) => writeFill(w, views.report.id, -1, from, 32));
  commands++;
  while (!got) h.run(1000 / 30);
  if (code !== RESULT_OK && code !== RESULT_RATE) break;
  h.run(code === RESULT_RATE ? 600 : ((built - before) / 64) * 1000);
}
row("Fill: pieces built", built, "");
row("Fill: commands", commands, "");
row("Fill: ticks", h.world.tick - fill0, "");
row("Fill: a command of 32 pieces, mean", fillAll / commands, "ms");
row("Fill: a command of 32 pieces, worst", fillWorst, "ms");
row("Fill: last code", code, "");
h.host.shutdown();
