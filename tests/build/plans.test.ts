// Plans on the server (server/plans.ts): a paste judged whole and made whole or not at all, a plan on a new frame that
// lands where a base started by hand would, the fill through the place command, and the life of a plan.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plansOf } from "../../client/core/plans.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { copyBase } from "../../client/core/templates.ts";
import { ENEMY_FOUNDATION, PLACE_RATE } from "../../server/build.ts";
import { PLAN_TICK_PIECES } from "../../server/plans.ts";
import type { HostOptions } from "../../server/host.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { writeFill, writeNew } from "../../shared/net/place.ts";
import { makePlaced, type Placed as PlacedAnswer } from "../../shared/net/placed.ts";
import { PLAN_ASKED, PLAN_CHUNK_FULL, PLAN_COOLDOWN, PLAN_ENEMY, PLAN_FAR, PLAN_LIMIT, PLAN_MALFORMED, PLAN_NOTHING, PLAN_NOT_YOURS, PLAN_NOWHERE, PLAN_NO_HAMMER, PLAN_NO_UPLOAD, PLAN_OK, PLAN_OVERLAP, PLAN_TOO_BIG, PLAN_TOO_MANY, PLAN_UNKNOWN_FORM, makePlanCommit, writePlanCommit, type PlanCommit, type PlanReport } from "../../shared/net/plan.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_PLAN_CANCEL, CMD_PLAN_COMMIT, CMD_PLAN_PART, CMD_SELECT, RESULT_ENEMY_NEAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SUPPORT, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { captureBlueprint, encodeBlueprint, makeBlueprint, placeBlueprint, type Blueprint, type BlueprintPiece } from "../../shared/world/blueprint.ts";
import { poseOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { keyLvl } from "../../shared/world/lattice/module.ts";
import { GID_UNMADE, PIECE_OCCUPIED, PIECE_UNSUPPORTED, PLAN_BYTES_MOST, PLAN_PART_BYTES, filledAt, pieceBook, placePieces, planFrame, planGround } from "../../shared/world/plan.ts";
import { Rng } from "../../shared/rng.ts";
import { Found } from "../../shared/world/structures.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { WOOD, at, giveHammer, grid, house, keep, raise, uploadParts } from "../fixtures/plans.ts";
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
  const fill = (s: ClientSession, plan: number, from = 0): { built: number; skipped: number; commands: number; last: PlacedAnswer } => {
    const last = makePlaced();
    let got = false;
    const was = s.onPlaced;
    s.onPlaced = (p) => {
      Object.assign(last, p, { refs: [...p.refs] });
      got = true;
    };
    let built = 0;
    let skipped = 0;
    let commands = 0;
    for (let guard = 0; guard < 400; guard++) {
      got = false;
      s.command(CMD_PLACE, (w: BitWriter) => writeFill(w, plan, -1, from, 32));
      commands++;
      h.run(100);
      if (!got) break;
      built += last.refs.length;
      skipped += last.skipped;
      from = last.next;
      if (last.code !== RESULT_OK || (last.refs.length === 0 && last.skipped === 0) || !h.host.plans.byId.has(plan)) break;
    }
    s.onPlaced = was;
    return { built, skipped, commands, last };
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

/** The key offset that puts a blueprint, mirrored and turned, with its least square at the square (i, j) of a base's grid. */
function beside(bp: Blueprint, mirror: boolean, turn: number, i: number, j: number): number[] {
  const moved = placeBlueprint(bp, book.forms, mirror, turn, [0, 0, 0, 0], 0);
  if (!moved.ok) throw new Error("it does not turn");
  let least = [Infinity, Infinity];
  for (const p of moved.blueprint.pieces) if (p.form === "foundation") least = [Math.min(least[0]!, (p.k0 & 1023) - 512), Math.min(least[1]!, (p.k1 & 1023) - 512)];
  return [2 * i - least[0]!, 0, 0, 2 * j - least[1]!];
}

test("pasted onto the side of a base, turned a quarter and mirrored, each piece lands on its own key and what stands already costs nothing", () => {
  const { h, sessions, recs, g, tp, stock, paste, fill } = builders(["ada"], 70, { PlanPasteCooldown: 0 });
  const [ada] = sessions;
  const rec = recs[0]!;
  const pieces = house(reg, 3, 2, 2);
  const made = raise(h, pieces, rec.team, g.x + 20, g.z + 20, 0x4000);
  const bp = makeBlueprint("House", "ada", "", pieces);
  tp(ada!, g.x + 24, g.z + 14);
  stock(ada!, bp);
  // The copy's least square is the square just past the base's east wall, so its west wall is the base's east wall.
  const by = beside(bp, true, 3, 3, 0);
  const report = paste(ada!, bp, { fr: made.fr, m0: by[0]!, m3: by[3]!, turn: 3, mirror: true });
  expect(report.code).toBe(PLAN_OK);
  expect(report.fine + report.built + report.blocked + report.unsupported).toBe(39);
  expect([report.unsupported, report.built + report.blocked > 0, report.fine > 25]).toEqual([0, true, true]);
  const plan = h.host.plans.byId.get(report.id)!;
  const want = placeBlueprint(bp, book.forms, true, 3, by, 0);
  if (!want.ok) throw new Error("it does not place");
  // The plan's pieces are the blueprint mirrored, turned and moved, key for key.
  expect([...plan.placed.k0].map((k0, i) => `${k0}/${plan.placed.k1[i]}`)).toEqual(want.blueprint.pieces.map((p) => `${p.k0}/${p.k1}`));
  const open: number[] = [];
  for (let i = 0; i < 39; i++) if (!filledAt(plan.filled, i)) open.push(i);
  expect(open.length).toBe(39 - report.built);
  const structs = h.world.structs;
  const before = structs.count;
  const done = fill(ada!, plan.id);
  expect([done.built, done.skipped]).toEqual([report.fine, report.blocked]);
  expect(structs.count).toBe(before + report.fine);
  // Each piece that was fine is now a row of its own kind on its own key, turn and flip with it.
  let stood = 0;
  for (const i of open) {
    const ref = structs.refAt(made.fr, plan.placed.k0[i]!, plan.placed.k1[i]!);
    if (ref < 0 || !structs.keyAt(ref, key) || key.k1 !== plan.placed.k1[i]) continue;
    expect(structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]).toBe(plan.placed.kind[i]);
    stood++;
  }
  expect(stood).toBe(report.fine);
  // It cost one piece for each built, and nothing for what stood already.
  let left = 0;
  const inv = h.host.items.inv(rec);
  for (const p of bp.pieces) left += 0 * p.tier;
  for (const item of new Set(bp.pieces.map((p) => reg.pieceItem[book.kindOf(p.form, p.tier)]!))) left += inv.total(item);
  expect(left).toBe(39 - report.fine);
  h.run(500);
  expect([h.host.build.fallen, h.host.items.audit()]).toEqual([0, []]);
});

test("a paste over a base that stands whole makes no plan, and over one with pieces gone costs only those", () => {
  const { h, sessions, recs, g, tp, stock, paste, fill } = builders(["ada"], 70, { PlanPasteCooldown: 0 });
  const [ada] = sessions;
  const rec = recs[0]!;
  const pieces = house(reg, 3, 2, 2);
  const made = raise(h, pieces, rec.team, g.x + 20, g.z + 20, 0);
  const bp = makeBlueprint("House", "ada", "", pieces);
  tp(ada!, g.x + 20, g.z + 16);
  stock(ada!, bp);
  const items = (): number => [...new Set(bp.pieces.map((p) => reg.pieceItem[book.kindOf(p.form, p.tier)]!))].reduce((n, item) => n + h.host.items.inv(rec).total(item), 0);
  // The blueprint's anchor is its first foundation, which is the base's own first slot.
  const whole = paste(ada!, bp, { fr: made.fr });
  expect([whole.code, whole.built, whole.fine, h.host.plans.byId.size, items()]).toEqual([PLAN_NOTHING, 39, 0, 0, 39]);
  // Three top ceilings go. The plan is for them alone.
  const structs = h.world.structs;
  const gone = made.refs.filter((ref) => structs.keyAt(ref, key) && keyLvl(key.k1) === 8).slice(0, 3);
  for (const ref of gone) structs.remove(ref);
  h.run(300);
  const report = paste(ada!, bp, { fr: made.fr });
  expect([report.code, report.built, report.fine, report.blocked, report.unsupported]).toEqual([PLAN_OK, 36, 3, 0, 0]);
  expect(fill(ada!, report.id).built).toBe(3);
  expect([items(), structs.frames.get(made.fr)!.live, h.host.plans.byId.size, h.host.items.audit()]).toEqual([36, 39, 0, []]);
});

test("a plan holds no materials: one taken away gives nothing, and a fill builds only what is carried", () => {
  const { h, sessions, recs, g, paste, ground, fill } = builders();
  const [ada] = sessions;
  const rec = recs[0]!;
  const bp = makeBlueprint("House", "ada", "", house(reg, 3, 2, 1));
  const inv = h.host.items.inv(rec);
  const used = inv.used();
  const report = paste(ada!, bp, ground(bp, g.x + 12, g.z + 12, 0x1234));
  expect([report.code, report.fine]).toEqual([PLAN_OK, 23]);
  // Nothing was taken to make it, and with nothing carried nothing is built.
  expect(inv.used()).toBe(used);
  const none = fill(ada!, report.id);
  expect([none.built, none.last.code, h.world.structs.frames.count]).toEqual([0, RESULT_SHORT, 0]);
  // Four foundations and two walls are carried: those go down, in support order, and the rest waits.
  h.host.items.mint(rec, id("piece_foundation_wood"), 4);
  h.host.items.mint(rec, id("piece_wall_wood"), 2);
  h.run(200);
  const some = fill(ada!, report.id);
  expect([some.built, some.last.code]).toEqual([6, RESULT_SHORT]);
  expect([inv.total(id("piece_foundation_wood")), inv.total(id("piece_wall_wood")), h.host.plans.byId.get(report.id)!.left]).toEqual([0, 0, 17]);
  // Taken away, it gives back nothing: what was built stays, and nothing is minted.
  let code = -1;
  ada!.onResult = (_seq, c) => void (code = c);
  ada!.command(CMD_PLAN_CANCEL, (w: BitWriter) => w.varint(report.id));
  h.run(300);
  expect([code, h.host.plans.byId.size, plansOf(ada!).plans.size, inv.used(), h.world.structs.frames.get(h.world.structs.frames.next - 1)!.live]).toEqual([RESULT_OK, 0, 0, used, 6]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a piece nothing would hold is reported, the plan is still made, and the fill stops at it", () => {
  const { h, sessions, g, stock, paste, ground, fill } = builders();
  const [ada] = sessions;
  // A foundation, a wall on it, and a row of ceilings out from the wall: the first hangs by 1, the next by 3, the third would by 5.
  const bp = makeBlueprint("Reach", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "wall", WOOD, grid(1, 0), 0, 3), at(reg, "ceiling", WOOD, grid(1, 0), 4, 0), at(reg, "ceiling", WOOD, grid(2, 0), 4, 0), at(reg, "ceiling", WOOD, grid(3, 0), 4, 0), at(reg, "ceiling", WOOD, grid(4, 0), 4, 0)]);
  stock(ada!, bp);
  const report = paste(ada!, bp, ground(bp, g.x + 12, g.z + 12, 0));
  expect([report.code, report.fine, report.unsupported, report.blocked]).toEqual([PLAN_OK, 4, 2, 0]);
  expect(report.state).toEqual([PIECE_UNSUPPORTED, PIECE_UNSUPPORTED]);
  const plan = h.host.plans.byId.get(report.id)!;
  expect(report.index.map((i) => (plan.placed.k0[i]! & 1023) - 512).sort()).toEqual([6, 8]);
  const done = fill(ada!, plan.id);
  expect([done.built, done.last.code, done.last.next, plan.left]).toEqual([4, RESULT_NO_SUPPORT, 4, 2]);
  // Asked past it, the next cannot stand either, and nothing was spent on them.
  expect(fill(ada!, plan.id, 5).last.code).toBe(RESULT_NO_SUPPORT);
  expect([h.host.items.inv(h.host.records.byPid.get(h.client(ada!)!.pid)!).total(id("piece_ceiling_wood")), h.host.build.fallen]).toEqual([2, 0]);
});

test("a piece whose place is taken is reported with what takes it, and the rest of the plan is built round it", () => {
  const { h, sessions, recs, g, tp, stock, paste, fill } = builders(["ada"], 70, { PlanPasteCooldown: 0 });
  const [ada] = sessions;
  const rec = recs[0]!;
  // A base with a doorframe where the blueprint has a wall.
  const made = raise(h, [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "doorframe", WOOD, grid(0, 0), 0, 0)], rec.team, g.x + 12, g.z + 12, 0);
  const bp = makeBlueprint("Hut", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "wall", WOOD, grid(0, 0), 0, 0), at(reg, "wall", WOOD, grid(0, 1), 0, 0), at(reg, "ceiling", WOOD, grid(0, 0), 4, 0)]);
  tp(ada!, g.x + 12, g.z + 8);
  stock(ada!, bp);
  const report = paste(ada!, bp, { fr: made.fr });
  expect([report.code, report.fine, report.built, report.blocked, report.state]).toEqual([PLAN_OK, 2, 1, 1, [PIECE_OCCUPIED]]);
  const done = fill(ada!, report.id);
  expect([done.built, done.last.code, h.host.plans.byId.get(report.id)!.left]).toEqual([2, RESULT_OK, 1]);
});

/** A session's last result code for the command it sends in `send`. */
function resultOf(h: Harness, s: ClientSession, send: () => void, ms = 200): number {
  let code = -1;
  const was = s.onResult;
  s.onResult = (_seq, c) => void (code = c);
  send();
  h.run(ms);
  s.onResult = was;
  return code;
}

test("a plan blocks nobody and is told to nobody else: another tribe builds through it, and its pieces in their range are then refused", () => {
  const { h, sessions, recs, g, tp, stock, paste, send, ground, fill } = builders(["ada", "bob"], 70, { PlanPasteCooldown: 0 });
  const [ada, bob] = sessions;
  const bp = makeBlueprint("House", "ada", "", house(reg, 3, 2, 1));
  stock(ada!, bp);
  tp(ada!, g.x + 30, g.z + 26);
  tp(bob!, g.x + 34, g.z + 26);
  const commit = ground(bp, g.x + 30, g.z + 30, 0);
  const report = paste(ada!, bp, commit);
  expect([report.code, report.fine]).toEqual([PLAN_OK, 23]);
  h.run(500);
  // Ada's tribe has it. Bob was sent nothing of it, standing beside it.
  expect([plansOf(ada!).plans.size, plansOf(bob!).plans.size, plansOf(bob!).bytes]).toEqual([1, 0, 0]);
  // It is no foundation: Bob may build in the middle of it, as on open ground.
  const piece = id("piece_foundation_wood");
  h.host.items.mint(recs[1]!, piece, 1);
  h.run(200);
  const inv = bob!.inventory!;
  bob!.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(piece)), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(piece)));
  h.run(150);
  bob!.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  expect(resultOf(h, bob!, () => bob!.command(CMD_PLACE, (w: BitWriter) => writeNew(w, 0, Math.round((g.x + 33) * U), Math.round((g.z + 31.5) * U), 0)))).toBe(RESULT_OK);
  expect(h.world.claims.total(recs[1]!.team)).toBe(1);
  // Now every piece of the plan is in Bob's range. A fill passes them all over, and a piece asked for by hand says why.
  const done = fill(ada!, report.id);
  expect([done.built, done.last.code, done.skipped, h.host.plans.byId.get(report.id)!.left]).toEqual([0, RESULT_OK, 23, 23]);
  const placed = makePlaced();
  ada!.onPlaced = (p) => void Object.assign(placed, p);
  expect(resultOf(h, ada!, () => ada!.command(CMD_PLACE, (w: BitWriter) => writeFill(w, report.id, h.host.plans.byId.get(report.id)!.order[0]!)))).toBe(RESULT_ENEMY_NEAR);
  expect([placed.code, placed.b]).toEqual([RESULT_ENEMY_NEAR, ENEMY_FOUNDATION]);
  // Nothing of Ada's was spent, and a new plan there is refused whole, with the pieces that are too near.
  expect(h.host.items.inv(recs[0]!).total(piece)).toBe(6);
  uploadParts(h, ada!, (encodeBlueprint(bp, book.forms) as { bytes: Uint8Array }).bytes);
  const again = send(ada!, ground(bp, g.x + 30, g.z + 40, 0));
  expect([again.code, again.index.length > 0, h.host.plans.byId.size]).toEqual([PLAN_ENEMY, true, 1]);
  // Bob may not fill it or take it away.
  expect(resultOf(h, bob!, () => bob!.command(CMD_PLACE, (w: BitWriter) => writeFill(w, report.id, -1, 0, 32)))).toBe(RESULT_NOT_YOURS);
  expect(resultOf(h, bob!, () => bob!.command(CMD_PLAN_CANCEL, (w: BitWriter) => w.varint(report.id)))).toBe(RESULT_NOT_YOURS);
  expect(h.host.plans.byId.size).toBe(1);
});

test("plans are capped: a tribe's, a chunk's, a plan's pieces, the wait between two, and the hours one stands", () => {
  const { h, sessions, g, tp, stock, paste, ground } = builders(["ada"], 70, { MaxPlansPerTribe: 2, PlanPasteCooldown: 2, PlanExpiryHours: 0.004 });
  const [ada] = sessions;
  const one = makeBlueprint("One", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "foundation", WOOD, grid(1, 0), 0, 0)]);
  stock(ada!, one, 4);
  tp(ada!, g.x + 30, g.z + 30);
  const t0 = h.now;
  const until = (ms: number): void => h.run(t0 + ms - h.now);
  const first = paste(ada!, one, ground(one, g.x + 30, g.z + 34, 0));
  expect([first.code, first.plans, first.plansCap]).toEqual([PLAN_OK, 1, 2]);
  // Too soon after it.
  const soon = paste(ada!, one, ground(one, g.x + 40, g.z + 34, 0));
  expect([soon.code, soon.wait > 0, h.host.plans.byId.size]).toEqual([PLAN_COOLDOWN, true, 1]);
  until(3000);
  const second = paste(ada!, one, ground(one, g.x + 40, g.z + 34, 0));
  expect(second.code).toBe(PLAN_OK);
  until(6000);
  // A third is one too many for the tribe.
  expect(paste(ada!, one, ground(one, g.x + 30, g.z + 44, 0)).code).toBe(PLAN_TOO_MANY);
  expect(h.host.plans.byId.size).toBe(2);
  // A plan stands 14.4 s here from its last piece. One piece of the first is built at 10 s: the second goes first, then it.
  until(10000);
  expect(resultOf(h, ada!, () => ada!.command(CMD_PLACE, (w: BitWriter) => writeFill(w, first.id, 0)))).toBe(RESULT_OK);
  until(16000);
  expect([[...h.host.plans.byId.keys()], [...plansOf(ada!).plans.keys()]]).toEqual([[first.id, second.id], [first.id, second.id]]);
  until(19500);
  expect([[...h.host.plans.byId.keys()], [...plansOf(ada!).plans.keys()]]).toEqual([[first.id], [first.id]]);
  until(26000);
  expect([h.host.plans.byId.size, plansOf(ada!).plans.size]).toEqual([0, 0]);
  // A chunk holds as many as its row says, and a plan as many pieces.
  h.say(ada!, "setting MaxPlansPerChunk 1");
  h.say(ada!, "setting MaxPlansPerTribe 4");
  h.say(ada!, "setting PlanPasteCooldown 0");
  expect(paste(ada!, one, ground(one, g.x + 30, g.z + 34, 0)).code).toBe(PLAN_OK);
  expect(paste(ada!, one, ground(one, g.x + 30, g.z + 40, 0)).code).toBe(PLAN_CHUNK_FULL);
  h.say(ada!, "setting MaxPlansPerChunk 8");
  h.say(ada!, "setting MaxPlanPieces 1");
  const big = paste(ada!, one, ground(one, g.x + 30, g.z + 40, 0));
  expect([big.code, big.piecesCap, h.host.plans.byId.size]).toEqual([PLAN_TOO_BIG, 1, 1]);
  // At the structure cap nothing more is planned.
  h.say(ada!, "setting MaxPlanPieces 2000");
  h.say(ada!, "setting TheMaxStructuresInRange 1");
  const capped = paste(ada!, one, ground(one, g.x + 30, g.z + 40, 0));
  expect([capped.code, capped.have, capped.cap]).toEqual([PLAN_LIMIT, 1, 1]);
});

test("a paste needs the hammer in hand, a place near its builder, and a base of the builder's tribe", () => {
  const { h, sessions, recs, g, tp, paste, send, ground } = builders(["ada", "bob"], 70, { PlanPasteCooldown: 0 });
  const [ada, bob] = sessions;
  const bp = makeBlueprint("One", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0)]);
  tp(ada!, g.x + 30, g.z + 30);
  // Only the limits are asked: nothing is uploaded, and nothing is made.
  const asked = send(ada!, { ...ground(bp, g.x + 30, g.z + 34, 0), ask: true });
  expect([asked.code, asked.plans, asked.plansCap, asked.piecesCap, asked.cap, asked.wait]).toEqual([PLAN_ASKED, 0, 4, 2000, 10500, 0]);
  expect(paste(ada!, bp, ground(bp, g.x + 30, g.z + 66, 0)).code).toBe(PLAN_FAR);
  // Bob's base is not Ada's to join.
  const theirs = raise(h, [at(reg, "foundation", WOOD, grid(0, 0), 0, 0)], recs[1]!.team, g.x + 62, g.z + 62, 0);
  expect(paste(ada!, bp, { fr: theirs.fr, m0: 2 }).code).toBe(PLAN_NOT_YOURS);
  expect(paste(ada!, bp, { fr: 9999 }).code).toBe(PLAN_NOT_YOURS);
  // Another thing in hand is no hammer.
  ada!.command(CMD_SELECT, (w: BitWriter) => w.u8(2));
  h.run(100);
  expect(paste(ada!, bp, ground(bp, g.x + 30, g.z + 34, 0)).code).toBe(PLAN_NO_HAMMER);
  expect([h.host.plans.byId.size, h.host.plans.made, bob!.state]).toEqual([0, 0, "active"]);
});

test("two plans of one tribe may not overlap, on open ground or in one base", () => {
  const { h, sessions, recs, g, tp, paste, ground } = builders(["ada"], 70, { PlanPasteCooldown: 0 });
  const [ada] = sessions;
  const bp = makeBlueprint("House", "ada", "", house(reg, 3, 2, 1));
  tp(ada!, g.x + 30, g.z + 26);
  expect(paste(ada!, bp, ground(bp, g.x + 30, g.z + 30, 0)).code).toBe(PLAN_OK);
  // The same place again, and a place two squares along: both land on the first plan's pieces.
  const over = paste(ada!, bp, ground(bp, g.x + 30, g.z + 30, 0));
  expect([over.code, over.index.length]).toEqual([PLAN_OVERLAP, 16]);
  expect(paste(ada!, bp, ground(bp, g.x + 36, g.z + 30, 0)).code).toBe(PLAN_OVERLAP);
  // Clear of it, a second plan stands.
  expect(paste(ada!, bp, ground(bp, g.x + 30, g.z + 40, 0)).code).toBe(PLAN_OK);
  // In one base, two plans on one key overlap though nothing is built there.
  const made = raise(h, [at(reg, "foundation", WOOD, grid(0, 0), 0, 0)], recs[0]!.team, g.x + 20, g.z + 20, 0);
  const wing = makeBlueprint("Wing", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), at(reg, "foundation", WOOD, grid(1, 0), 0, 0)]);
  tp(ada!, g.x + 20, g.z + 16);
  expect(paste(ada!, wing, { fr: made.fr, m0: 2 }).code).toBe(PLAN_OK);
  expect(paste(ada!, wing, { fr: made.fr, m0: 4 }).code).toBe(PLAN_OVERLAP);
  expect(h.host.plans.byId.size).toBe(3);
});

test("a hostile upload makes no plan: random and damaged parts, parts out of order, a commit with none or with another's, parts after a commit", () => {
  const { h, sessions, g, tp, send, ground } = builders(["ada", "bob"], 70, { PlanPasteCooldown: 0 });
  const [ada, bob] = sessions;
  const bp = makeBlueprint("Keep", "ada", "", house(reg, 6, 6, 3));
  const bytes = (encodeBlueprint(bp, book.forms) as { bytes: Uint8Array }).bytes.slice();
  const parts = Math.ceil(bytes.length / PLAN_PART_BYTES);
  expect(parts > 1).toBe(true);
  tp(ada!, g.x + 30, g.z + 26);
  tp(bob!, g.x + 32, g.z + 26);
  const at0 = ground(bp, g.x + 30, g.z + 30, 0);
  const part = (s: ClientSession, total: number, offset: number, data: Uint8Array): number => resultOf(h, s, () => s.command(CMD_PLAN_PART, (w: BitWriter) => (w.varint(total), w.varint(offset), w.blob(data))), 70);
  const whole = (s: ClientSession, from: Uint8Array, order: number[]): void => {
    for (const k of order) expect(part(s, from.length, k * PLAN_PART_BYTES, from.subarray(k * PLAN_PART_BYTES, Math.min(from.length, (k + 1) * PLAN_PART_BYTES)))).toBe(RESULT_OK);
  };
  const forward = Array.from({ length: parts }, (_, k) => k);
  // A commit with nothing uploaded.
  expect(send(ada!, at0).code).toBe(PLAN_NO_UPLOAD);
  // Parts no upload could have: too many bytes in all, an offset off the parts' grid or past the end, a short part that is not the last, none at all.
  const some = bytes.subarray(0, PLAN_PART_BYTES);
  expect(part(ada!, PLAN_BYTES_MOST + 1, 0, some)).toBe(RESULT_INVALID);
  expect(part(ada!, bytes.length, 7, some)).toBe(RESULT_INVALID);
  expect(part(ada!, bytes.length, parts * PLAN_PART_BYTES, some)).toBe(RESULT_INVALID);
  expect(part(ada!, bytes.length, 0, some.subarray(0, 100))).toBe(RESULT_INVALID);
  expect(part(ada!, 0, 0, new Uint8Array(0))).toBe(RESULT_INVALID);
  expect(send(ada!, at0).code).toBe(PLAN_NO_UPLOAD);
  // Every part but one, then a commit: it is not whole.
  whole(ada!, bytes, forward.slice(1));
  expect(send(ada!, at0).code).toBe(PLAN_NO_UPLOAD);
  // Another's upload is not Bob's to commit, and Ada's is still whole after he tried.
  whole(ada!, bytes, forward);
  expect(send(bob!, at0).code).toBe(PLAN_NO_UPLOAD);
  // Damaged on the way: one byte changed in each part in turn is caught by the checksum, the walk or the forms.
  const rng = new Rng(7);
  for (let k = 0; k < parts; k++) {
    const bad = bytes.slice();
    const at = Math.min(bad.length - 1, k * PLAN_PART_BYTES + rng.int(PLAN_PART_BYTES));
    bad[at] = bad[at]! ^ (1 << rng.int(8));
    whole(ada!, bad, forward);
    expect([PLAN_MALFORMED, PLAN_UNKNOWN_FORM, PLAN_TOO_BIG, PLAN_NOWHERE]).toContain(send(ada!, at0).code);
  }
  // Random bytes of every size a part may have, and whole uploads of them.
  for (let n = 0; n < 40; n++) {
    const size = 1 + rng.int(3 * PLAN_PART_BYTES);
    const junk = Uint8Array.from({ length: size }, () => rng.int(256));
    whole(ada!, junk, Array.from({ length: Math.ceil(size / PLAN_PART_BYTES) }, (_, k) => k));
    expect(send(ada!, at0).code).toBe(PLAN_MALFORMED);
  }
  // A form this server does not build, and a form of a material it has no piece of.
  const forged = makeBlueprint("Forged", "ada", "", [at(reg, "foundation", WOOD, grid(0, 0), 0, 0), { ...at(reg, "wall", WOOD, grid(0, 0), 0, 0), form: "portcullis" }]);
  const with1 = encodeBlueprint(forged, { ...book.forms, portcullis: book.forms.wall! }) as { bytes: Uint8Array };
  whole(ada!, with1.bytes, [0]);
  expect(send(ada!, at0).code).toBe(PLAN_UNKNOWN_FORM);
  const thatch = makeBlueprint("Thatch", "ada", "", [at(reg, "foundation", 0, grid(0, 0), 0, 0), at(reg, "pillar", 0, grid(0, 0), 0, 0)]);
  whole(ada!, (encodeBlueprint(thatch, book.forms) as { bytes: Uint8Array }).bytes, [0]);
  expect(send(ada!, at0).code).toBe(PLAN_UNKNOWN_FORM);
  expect([h.host.plans.byId.size, h.host.plans.made, h.server.stats.faults]).toEqual([0, 0, 0]);
  // Out of order, each part sent twice, it is the same upload: the plan is made.
  whole(ada!, bytes, [...forward].reverse());
  whole(ada!, bytes, forward);
  const ok = send(ada!, at0);
  expect([ok.code, ok.pieces, h.host.plans.byId.size]).toEqual([PLAN_OK, bp.pieces.length, 1]);
  // The commit used the upload up: a part sent after it starts another, which is not whole.
  expect(part(ada!, bytes.length, 0, some)).toBe(RESULT_OK);
  expect(send(ada!, ground(bp, g.x + 30, g.z + 60, 0)).code).toBe(PLAN_NO_UPLOAD);
  expect([h.host.plans.byId.size, h.server.stats.faults, ada!.state, bob!.state]).toEqual([1, 0, "active", "active"]);
});

test("a plan follows its team: into a tribe with its builder, staying when the builder leaves, and gone with the tribe", () => {
  const { h, sessions, recs, g, tp, paste, ground } = builders(["ada", "bob"], 70, { PlanPasteCooldown: 0 });
  const [ada, bob] = sessions;
  const bp = makeBlueprint("House", "ada", "", house(reg, 2, 2, 1));
  tp(ada!, g.x + 30, g.z + 26);
  tp(bob!, g.x + 31, g.z + 26);
  const report = paste(ada!, bp, ground(bp, g.x + 30, g.z + 30, 0));
  expect(report.code).toBe(PLAN_OK);
  const own = recs[0]!.team;
  h.run(300);
  expect([plansOf(ada!).plans.size, plansOf(bob!).plans.size]).toEqual([1, 0]);
  // Ada joins Bob's tribe: what was her own team's is the tribe's, and Bob is told the plan.
  h.say(bob!, "tribe create Wolves");
  h.say(bob!, "tribe invite ada");
  h.say(ada!, "tribe accept");
  h.run(300);
  const plan = h.host.plans.byId.get(report.id)!;
  expect([recs[0]!.team, plan.team, h.host.plans.count(own)]).toEqual([recs[1]!.team, recs[1]!.team, 0]);
  expect([plansOf(ada!).plans.size, plansOf(bob!).plans.size, plansOf(bob!).plans.get(plan.id)!.record.team]).toEqual([1, 1, recs[1]!.team]);
  // She leaves with nothing: the plan is the tribe's, and she is told it is gone.
  h.say(ada!, "tribe leave");
  h.run(300);
  expect([plan.team, plansOf(ada!).plans.size, plansOf(bob!).plans.size]).toEqual([recs[1]!.team, 0, 1]);
  expect(resultOf(h, ada!, () => ada!.command(CMD_PLAN_CANCEL, (w: BitWriter) => w.varint(plan.id)))).toBe(RESULT_NOT_YOURS);
  // The last member leaves: the tribe is gone, and its plans with it.
  h.say(bob!, "tribe leave");
  h.run(300);
  expect([h.host.plans.byId.size, plansOf(bob!).plans.size]).toEqual([0, 0]);
});

test("a plan half filled is there after a restart, with the same pieces filled, and is finished", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-plans-"));
  const dbPath = join(dir, "world.db");
  const bp = makeBlueprint("House", "ada", "", house(reg, 3, 2, 2));
  let saved = { id: 0, filled: [] as number[], fr: 0, left: 0, team: 0, expires: 0, order: [] as number[], pose: [] as number[] };
  let spot = { x: 0, z: 0 };
  {
    const { h, sessions, recs, g, tp, paste, ground, fill } = builders(["ada"], 70, {}, { dbPath });
    const [ada] = sessions;
    tp(ada!, g.x + 30, g.z + 24);
    spot = { x: g.x + 30, z: g.z + 24 };
    const report = paste(ada!, bp, ground(bp, g.x + 30, g.z + 40, 0x3abc));
    expect(report.code).toBe(PLAN_OK);
    // The foundations and half the walls are carried.
    h.host.items.mint(recs[0]!, id("piece_foundation_wood"), 6);
    h.host.items.mint(recs[0]!, id("piece_wall_wood"), 9);
    h.run(200);
    expect(fill(ada!, report.id).built).toBe(15);
    const plan = h.host.plans.byId.get(report.id)!;
    saved = { id: plan.id, filled: [...plan.filled], fr: plan.fr, left: plan.left, team: plan.team, expires: plan.expires, order: [...plan.order], pose: [plan.ox, plan.oy, plan.oz, plan.yaw] };
    expect([saved.left, saved.fr !== 0]).toEqual([24, true]);
    h.run(500);
    h.host.shutdown();
  }
  {
    const h = new Harness({}, 1, 60, { dev: true, dbPath });
    const plan = h.host.plans.byId.get(saved.id)!;
    expect(h.host.plans.byId.size).toBe(1);
    expect({ id: plan.id, filled: [...plan.filled], fr: plan.fr, left: plan.left, team: plan.team, expires: plan.expires, order: [...plan.order], pose: [plan.ox, plan.oy, plan.oz, plan.yaw] }).toEqual(saved);
    expect(h.world.structs.frames.get(plan.fr)!.live).toBe(15);
    // The same survivor comes back, is told the plan as it stands, and finishes it.
    const ada = h.join("ada");
    h.run(600);
    h.say(ada, "enablecheats");
    h.say(ada, "setstat weight 100000");
    h.say(ada, `tp ${spot.x.toFixed(3)} ${spot.z.toFixed(3)}`);
    h.run(300);
    const view = plansOf(ada).plans.get(saved.id)!;
    expect([view.record.fr, [...view.record.filled]]).toEqual([saved.fr, saved.filled]);
    const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
    for (const p of bp.pieces) h.host.items.mint(rec, reg.pieceItem[book.kindOf(p.form, p.tier)]!, 1);
    h.run(200);
    let built = 0;
    ada.onPlaced = (p) => void (built += p.refs.length);
    for (let from = 0; h.host.plans.byId.size > 0 && from < 3; from++) {
      ada.command(CMD_PLACE, (w: BitWriter) => writeFill(w, saved.id, -1, 0, 32));
      h.run(150);
    }
    expect([built, h.host.plans.byId.size, h.world.structs.frames.get(saved.fr)!.live]).toEqual([24, 0, 39]);
    same(copied(h, saved.fr, (p) => p.form === "foundation" && p.k0 === bp.pieces.find((q) => q.form === "foundation")!.k0), bp);
    h.run(300);
    h.host.shutdown();
    // Built out, it is gone from the save too.
    const again = new Harness({}, 1, 60, { dev: true, dbPath });
    expect([again.host.plans.byId.size, again.world.structs.frames.get(saved.fr)!.live]).toEqual([0, 39]);
    again.host.shutdown();
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a plan's bytes are counted in its session's chunk window", () => {
  const { h, sessions, g, tp, ground } = builders();
  const [ada] = sessions;
  const bp = makeBlueprint("Keep", "ada", "", house(reg, 6, 6, 3));
  tp(ada!, g.x + 30, g.z + 26);
  h.run(1000);
  const c = h.client(ada!)!;
  const spent = (): number => c.chunkSent.reduce((n, v) => n + v, 0);
  // Nothing is being sent: the window is empty until the plan goes, and then holds the plan's bytes.
  expect(spent()).toBe(0);
  const before = h.host.plans.sentBytes;
  let most = 0;
  const bytes = (encodeBlueprint(bp, book.forms) as { bytes: Uint8Array }).bytes;
  uploadParts(h, ada!, bytes);
  ada!.command(CMD_PLAN_COMMIT, (w: BitWriter) => writePlanCommit(w, { ...makePlanCommit(), ...ground(bp, g.x + 30, g.z + 30, 0) }));
  for (let k = 0; k < 20; k++) {
    h.run(1000 / TICK_RATE);
    most = Math.max(most, spent());
  }
  const sent = h.host.plans.sentBytes - before;
  expect(sent > bytes.length && sent < bytes.length + 120).toBe(true);
  expect([most, plansOf(ada!).bytes]).toEqual([sent, sent]);
});

test("a plan of 2,000 pieces: a few parts up, judged a part a tick, a few kilobytes to each member, and filled at the placing rate", () => {
  const { h, sessions, recs, g, tp, stock, ground } = builders();
  const [ada] = sessions;
  const bp = makeBlueprint("Keep", "ada", "Two thousand pieces.", keep(reg, 2000));
  const bytes = (encodeBlueprint(bp, book.forms) as { bytes: Uint8Array }).bytes;
  // Beside the middle of its south side, clear of its first row.
  tp(ada!, g.x + 35, g.z + 7);
  const parts = uploadParts(h, ada!, bytes);
  expect([parts, parts <= Math.ceil(PLAN_BYTES_MOST / PLAN_PART_BYTES), bytes.length < 4200]).toEqual([Math.ceil(bytes.length / PLAN_PART_BYTES), true, true]);
  const views = plansOf(ada!);
  const tick = h.world.tick;
  ada!.command(CMD_PLAN_COMMIT, (w: BitWriter) => writePlanCommit(w, { ...makePlanCommit(), ...ground(bp, g.x + 21.5, g.z + 11.5, 0) }));
  let ticks = 0;
  while (views.reports === 0 && ticks++ < 200) h.run(1000 / TICK_RATE);
  h.run(100);
  const r = views.report;
  expect([r.code, r.pieces, r.fine, r.built, r.blocked, r.unsupported]).toEqual([PLAN_OK, 2000, 2000, 0, 0, 0]);
  // Two looks a piece, 200 a tick: the report comes within a second, and no tick judged more than its share.
  const took = h.world.tick - tick;
  expect([took > 2000 / PLAN_TICK_PIECES, took < TICK_RATE, h.host.plans.judgedMost <= PLAN_TICK_PIECES]).toEqual([true, true, true]);
  h.run(500);
  expect([views.plans.size, views.bytes < bytes.length + 400]).toEqual([1, true]);
  // The fill: 32 a command, as fast as a session may place, and the base is the blueprint piece for piece.
  stock(ada!, bp);
  const before = h.world.tick;
  let built = 0;
  let commands = 0;
  let from = 0;
  let code = RESULT_OK;
  let answered = false;
  ada!.onPlaced = (p) => {
    built += p.refs.length;
    from = p.next;
    code = p.code;
    answered = true;
  };
  while (h.host.plans.byId.size > 0 && from < 2000 && commands < 100) {
    const had = built;
    answered = false;
    ada!.command(CMD_PLACE, (w: BitWriter) => writeFill(w, r.id, -1, from, 32));
    commands++;
    for (let k = 0; !answered && k < 30; k++) h.run(1000 / TICK_RATE);
    if (code !== RESULT_OK) break;
    h.run(((built - had) / PLACE_RATE) * 1000);
  }
  expect([built, commands, code, h.host.plans.byId.size]).toEqual([2000, 63, RESULT_OK, 0]);
  expect(h.world.tick - before < 40 * TICK_RATE).toBe(true);
  const fr = h.world.structs.frames.next - 1;
  same(copied(h, fr, (p) => p.form === "foundation" && p.k0 === bp.pieces[0]!.k0 && keyLvl(p.k1) === 0), bp);
  h.run(1000);
  expect([h.world.structs.frames.get(fr)!.live, h.host.build.fallen, h.host.items.audit()]).toEqual([2000, 0, []]);
  for (const item of new Set(bp.pieces.map((p) => reg.pieceItem[book.kindOf(p.form, p.tier)]!))) expect(h.host.items.inv(recs[0]!).total(item)).toBe(0);
});
