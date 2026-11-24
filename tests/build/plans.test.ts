// Plans on the server (server/plans.ts): a paste judged whole and made whole or not at all, a plan on a new frame that
// lands where a base started by hand would, the fill through the place command, and the life of a plan.

import { expect, test } from "bun:test";
import { plansOf } from "../../client/core/plans.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { copyBase } from "../../client/core/templates.ts";
import { ENEMY_FOUNDATION } from "../../server/build.ts";
import type { HostOptions } from "../../server/host.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { writeFill, writeNew } from "../../shared/net/place.ts";
import { makePlaced, type Placed as PlacedAnswer } from "../../shared/net/placed.ts";
import { PLAN_ASKED, PLAN_CHUNK_FULL, PLAN_COOLDOWN, PLAN_ENEMY, PLAN_FAR, PLAN_LIMIT, PLAN_NOTHING, PLAN_NOT_YOURS, PLAN_NO_HAMMER, PLAN_OK, PLAN_OVERLAP, PLAN_TOO_BIG, PLAN_TOO_MANY, makePlanCommit, writePlanCommit, type PlanCommit, type PlanReport } from "../../shared/net/plan.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_PLAN_CANCEL, CMD_PLAN_COMMIT, CMD_SELECT, RESULT_ENEMY_NEAR, RESULT_NOT_YOURS, RESULT_NO_SUPPORT, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { captureBlueprint, encodeBlueprint, makeBlueprint, placeBlueprint, type Blueprint, type BlueprintPiece } from "../../shared/world/blueprint.ts";
import { poseOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { keyLvl } from "../../shared/world/lattice/module.ts";
import { GID_UNMADE, PIECE_OCCUPIED, PIECE_UNSUPPORTED, filledAt, pieceBook, placePieces, planFrame, planGround } from "../../shared/world/plan.ts";
import { Found } from "../../shared/world/structures.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { WOOD, at, giveHammer, grid, house, raise, uploadParts } from "../fixtures/plans.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const book = pieceBook(reg);
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;

/** Survivors with cheats on level ground, each holding the template hammer. */
function builders(names = ["ada"], wide = 70, settings: Record<string, string | number> = {}, host: HostOptions = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const sessions = names.map((n) => h.join(n));
  h.run(600);
  const g = flatGround(h, wide, wide);
  sessions.forEach((s, i) => {
    h.say(s, "enablecheats");
    if (i === 0) for (const [name, value] of Object.entries(settings)) h.say(s, `setting ${name} ${value}`);
    h.say(s, `tp ${(g.x + 6 + i * 2).toFixed(3)} ${(g.z + 3).toFixed(3)}`);
    h.say(s, "setstat weight 100000");
    giveHammer(h, s);
    s.command(CMD_SELECT, (w: BitWriter) => w.u8(7));
  });
  h.run(200);
  const recs = sessions.map((s) => h.host.records.byPid.get(h.client(s)!.pid)!);
  const tp = (s: ClientSession, x: number, z: number): void => void h.say(s, `tp ${x.toFixed(3)} ${z.toFixed(3)}`);
  /** Gives `rec` what every piece of a blueprint costs: one of its item a piece. */
  const stock = (s: ClientSession, bp: Blueprint, spare = 0): Map<number, number> => {
    const rec = recs[sessions.indexOf(s)]!;
    const need = new Map<number, number>();
    for (const p of bp.pieces) need.set(reg.pieceItem[book.kindOf(p.form, p.tier)]!, (need.get(reg.pieceItem[book.kindOf(p.form, p.tier)]!) ?? 0) + 1);
    for (const [item, n] of need) h.host.items.mint(rec, item, n + spare);
    h.run(200);
    return need;
  };
  /** Uploads a blueprint and commits it. Returns the server's report once it has come. */
  const paste = (s: ClientSession, bp: Blueprint, commit: Partial<PlanCommit>, ms = 400): PlanReport => {
    const bytes = encodeBlueprint(bp, book.forms);
    if (!bytes.ok) throw new Error(bytes.fault.reason);
    uploadParts(h, s, bytes.bytes);
    return send(s, commit, ms);
  };
  const send = (s: ClientSession, commit: Partial<PlanCommit>, ms = 400): PlanReport => {
    const views = plansOf(s);
    const before = views.reports;
    s.command(CMD_PLAN_COMMIT, (w: BitWriter) => writePlanCommit(w, { ...makePlanCommit(), ...commit }));
    h.run(ms);
    if (views.reports === before) throw new Error("no report came");
    return { ...views.report, index: [...views.report.index], state: [...views.report.state] };
  };
  /** Where a new frame turned `yaw` goes for a blueprint set down at (x, z). */
  const ground = (bp: Blueprint, x: number, z: number, yaw: number): Partial<PlanCommit> => {
    const placed = placePieces(book, bp, false, 0, [0, 0, 0, 0], 0);
    if (!placed.ok) throw new Error("the blueprint does not place");
    const out = { ox: 0, oy: 0, oz: 0 };
    if (!planGround((gx, gz) => h.world.hf.heightAt(gx, gz), reg, reg.forms, placed.placed, x, z, yaw, 0, out)) throw new Error("it has no footing");
    return { ...out, yaw };
  };
  /** Fills plan `plan` from place `from` of its order until the server stops it. Returns what was built and the last answer. */
  const fill = (s: ClientSession, plan: number, from = 0): { built: number; commands: number; last: PlacedAnswer } => {
    const last = makePlaced();
    let got = false;
    const was = s.onPlaced;
    s.onPlaced = (p) => {
      Object.assign(last, p, { refs: [...p.refs] });
      got = true;
    };
    let built = 0;
    let commands = 0;
    for (let guard = 0; guard < 400; guard++) {
      got = false;
      s.command(CMD_PLACE, (w: BitWriter) => writeFill(w, plan, -1, from, 32));
      commands++;
      h.run(100);
      if (!got) break;
      built += last.refs.length;
      from = last.next;
      if (last.code !== RESULT_OK || (last.refs.length === 0 && last.skipped === 0) || !h.host.plans.byId.has(plan)) break;
    }
    s.onPlaced = was;
    return { built, commands, last };
  };
  return { h, sessions, recs, g, tp, stock, paste, send, ground, fill };
}

const found = new Found();
const key = { fr: 0, k0: 0, k1: 0 };

/** The rows of a frame of the server's as blueprint pieces, and the place among them of the row with the lowest key in the blueprint's order. */
function rowsOf(h: Harness, fr: number): BlueprintPiece[] {
  const structs = h.world.structs;
  const n = structs.rowsOf(fr, found);
  const out: BlueprintPiece[] = [];
  for (let i = 0; i < n; i++) {
    const t = structs.chunks[Math.floor(found.refs[i]! / 65536)]!;
    const slot = found.refs[i]! & 0xffff;
    out.push({ form: book.name[t.kind[slot]!]!, tier: book.tier[t.kind[slot]!]!, k0: t.k0![slot]!, k1: t.k1![slot]! });
  }
  return out;
}

/** A frame's rows as a blueprint anchored at its piece that `pick` chooses. */
function copied(h: Harness, fr: number, pick: (p: BlueprintPiece) => boolean): Blueprint {
  const rows = rowsOf(h, fr);
  const got = captureBlueprint(rows, rows.findIndex(pick), book.forms);
  if (!got.ok) throw new Error("the base does not copy");
  return got.blueprint;
}

const same = (a: Blueprint, b: Blueprint): void => expect(a.pieces.map((p) => `${p.form}/${p.tier}/${p.k0}/${p.k1}`)).toEqual(b.pieces.map((p) => `${p.form}/${p.tier}/${p.k0}/${p.k1}`));

test("a base is copied from its rows, a paste on open ground is made whole, and filling it builds the same base and costs its pieces", () => {
  const { h, sessions, recs, g, tp, stock, paste, ground, fill } = builders();
  const [ada] = sessions;
  const rec = recs[0]!;
  const made = raise(h, house(reg, 3, 2, 2), rec.team, g.x + 8, g.z + 10, 0);
  h.run(300);
  // The client copies from the rows it was sent: its copy is the server's base, piece for piece.
  const got = copyBase(ada!.world!.structs, book, made.refs[0]!, rec.team, "House", "ada");
  if (!got.ok) throw new Error(got.reason);
  const bp = got.blueprint;
  expect(bp.pieces.length).toBe(39);
  same(bp, copied(h, made.fr, (p) => p.form === "foundation" && p.k0 === house(reg, 3, 2, 2)[0]!.k0));
  // Walked away and set down at an odd yaw: every piece is fine, and nothing is built or spent yet.
  tp(ada!, g.x + 40, g.z + 30);
  const need = stock(ada!, bp);
  const before = h.world.structs.count;
  const yaw = 0x2f31;
  const report = paste(ada!, bp, ground(bp, g.x + 44, g.z + 36, yaw));
  expect([report.code, report.pieces, report.fine, report.built, report.blocked, report.unsupported, report.index.length]).toEqual([PLAN_OK, 39, 39, 0, 0, 0, 0]);
  expect([h.world.structs.count, h.host.plans.byId.size, h.world.structs.frames.count]).toEqual([before, 1, 1]);
  const plan = h.host.plans.byId.get(report.id)!;
  expect([plan.fr, plan.team, plan.by, plan.left]).toEqual([0, rec.team, rec.pid, 39]);
  // The tribe is told the plan, as its record.
  expect([...plansOf(ada!).plans.keys()]).toEqual([plan.id]);
  // One action fills it: 39 pieces in two commands, foundations first.
  const done = fill(ada!, plan.id);
  expect([done.built, done.commands, done.last.code, h.host.plans.byId.size]).toEqual([39, 2, RESULT_OK, 0]);
  expect(h.world.structs.count).toBe(before + 39);
  const fr = h.world.structs.frames.next - 1;
  const frame = h.world.structs.frames.get(fr)!;
  expect([frame.yaw, frame.team, frame.live]).toEqual([yaw, rec.team, 39]);
  same(copied(h, fr, (p) => p.form === "foundation" && p.k0 === bp.pieces.find((q) => q.form === "foundation")!.k0 && keyLvl(p.k1) === 0), bp);
  // It stands, and cost exactly its pieces.
  h.run(500);
  expect([h.world.structs.count, h.host.build.fallen]).toEqual([before + 39, 0]);
  for (const [item] of need) expect([reg.ids[item], h.host.items.inv(rec).total(item)]).toEqual([reg.ids[item], 0]);
  expect(h.host.items.audit()).toEqual([]);
  h.run(300);
  expect(plansOf(ada!).plans.size).toBe(0);
});

test("a plan on a new frame lands where a base started by hand at the same place would, at any yaw", () => {
  const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  for (const yaw of [0, 1, 0x1555, 0x2f31, 0x7fff, 0xc0de, 0xffff]) {
    const { h, sessions, g, tp, stock, paste, ground, fill } = builders();
    const [ada] = sessions;
    const bp = makeBlueprint("L", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "foundation", WOOD, grid(1, 0), 0, 0), at(reg, "foundation", WOOD, grid(1, 1), 0, 0), at(reg, "wall", WOOD, grid(1, 2), 0, 0)]);
    stock(ada!, bp, 1);
    const x = g.x + 10.37;
    const z = g.z + 12.81;
    const commit = ground(bp, x, z, yaw);
    const report = paste(ada!, bp, commit);
    expect([yaw, report.code, report.fine]).toEqual([yaw, PLAN_OK, 4]);
    // Where the holograms show each piece: the plan's pose, before any frame is made.
    const plan = h.host.plans.byId.get(report.id)!;
    const shown = [...plan.placed.kind].map((kind, i) => (poseOf(planFrame(h.world.structs, plan), plan.placed.k0[i]!, plan.placed.k1[i]!, reg.forms, kind, pose), [kind, pose.x, pose.y, pose.z, pose.yaw]));
    expect(planFrame(h.world.structs, plan).gid).toBe(GID_UNMADE);
    expect(fill(ada!, plan.id).built).toBe(4);
    const structs = h.world.structs;
    const fr = structs.frames.next - 1;
    const rows: number[][] = [];
    for (let i = 0, n = structs.rowsOf(fr, found); i < n; i++) {
      const t = structs.chunks[Math.floor(found.refs[i]! / 65536)]!;
      const slot = found.refs[i]! & 0xffff;
      rows.push([t.kind[slot]!, Math.round(t.x[slot]! * U), Math.round(t.y[slot]! * U), Math.round(t.z[slot]! * U), t.yaw[slot]!]);
    }
    const order = (a: number[], b: number[]): number => a[0]! - b[0]! || a[1]! - b[1]! || a[3]! - b[3]!;
    expect(rows.sort(order)).toEqual(shown.sort(order));
    // A foundation set down by hand 20 m on, on the same level ground, starts a frame with the same origin 20 m on and the same turn.
    const piece = id("piece_foundation_wood");
    const inv = ada!.inventory!;
    ada!.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(piece)), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(piece)));
    h.run(150);
    ada!.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
    tp(ada!, x + 20, z - 4);
    ada!.command(CMD_PLACE, (w: BitWriter) => writeNew(w, 0, Math.round(x * U) + 20 * U, Math.round(z * U), yaw));
    h.run(200);
    const hand = structs.frames.get(structs.frames.next - 1)!;
    const mine = structs.frames.get(fr)!;
    expect(hand.gid).toBe(fr + 1);
    expect([hand.ox - 20 * U, hand.oy, hand.oz, hand.yaw]).toEqual([mine.ox, mine.oy, mine.oz, mine.yaw]);
  }
});
