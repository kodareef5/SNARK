// The debug bar's count of the socket (client/core/debug/net.ts), and the view delta's reader telling each op's bits.

import { expect, test } from "bun:test";
import { BODY_CLASSES, CATEGORIES, CATEGORY_ROWS, NET_OUT, NetLog, OPS, SECONDS, SnapshotParts, bodyClass, categoryOf, type NetRow } from "../../client/core/debug/net.ts";
import { SNAP_BODIES, SNAP_CONTACTS, SNAP_HEAD, SNAP_OWN, SNAP_REST } from "../../client/core/net-tap.ts";
import { codeNames } from "../../shared/debug.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import * as P from "../../shared/net/protocol.ts";
import { EntityView, SentView, readViewDelta, writeViewDelta, type Looks } from "../../shared/net/view.ts";
import { stripComments } from "../../tools/policy.ts";
import { coreRegistry } from "../fixtures/world.ts";

const cat = (name: string): number => CATEGORIES.indexOf(name as (typeof CATEGORIES)[number]);

/** A clock a test moves by hand, in ms. */
function clock(t = 0): { t: number; now(): number } {
  return { t, now() { return this.t; } };
}

/** Each row's names and category, as text. */
function named(log: NetLog): string[][] {
  const rows: NetRow[] = [];
  return rows.slice(0, log.rows(rows)).map((r) => [r.kindName, r.subName, CATEGORIES[r.category]!]);
}

/**
 * Where a function's code would make something each time it runs: an array or record written out, `new`, a closure, a
 * template, a spread, or a call that hands back a new array or string. Indexing (`a[k]`) and blocks are not.
 */
function makes(fn: (...args: never[]) => unknown): string[] {
  const src = stripComments(fn.toString(), true).replace(/^[^{]*\{/, "");
  const found: string[] = [];
  for (const [what, re] of [
    ["an array", /(^|[=(,:?&|!]|\breturn)\s*\[/m],
    ["a record", /(^|[=(,:?]|\breturn)\s*\{/m],
    ["new", /\bnew\s/],
    ["a closure", /=>|\bfunction\b/],
    ["a template", /`/],
    ["a spread", /\.\.\./],
    ["a new array or string", /\.(map|filter|slice|concat|subarray|join|split|toFixed|flat|flatMap)\(|\bArray\.(from|of)\(|\bString\(|\bJSON\./],
  ] as const) if (re.test(src)) found.push(what);
  return found;
}

test("a delta read with a tally is the delta read without, and its ops' bits are all its bits", () => {
  const n = 64;
  const looks: Looks & { died: Uint16Array } = { level: new Uint16Array(n), colors: new Uint8Array(n * 6), names: new Map([[5, "Ada"]]), looks: new Map(), gears: new Map(), team: new Uint32Array(n), seat: new Uint32Array(n), span: new Uint32Array(n), grown: new Uint32Array(n), died: new Uint16Array(n) };
  const colors = new Uint8Array(6);
  /** Bodies as [id, generation, kind, x]. */
  const view = (bodies: number[][]): EntityView => {
    const v = new EntityView();
    for (const [id, gen, kind, qx] of bodies) {
      v.push(id!, gen!, kind!, qx!, 200, 300, 5, 1, 0);
      v.appear(0, 1, colors, 0, looks.names.get(id!) ?? "", null, null);
    }
    return v;
  };
  const w = new BitWriter(1 << 14);
  const r = new BitReader();
  /** What a client holding `held` reads of the delta in `w`, after the three bits before it, with a tally and without. */
  const read = (held: EntityView | null, tally: ((op: number, kind: number, bits: number) => void) | null) => {
    const got = new EntityView();
    const drawn = new EntityView();
    const died: number[] = [];
    r.reset(w.bytes());
    r.bits(3);
    const ok = readViewDelta(r, held, got, held, drawn, died, tally);
    const rows = (v: EntityView): number[][] => Array.from({ length: v.count }, (_, i) => [v.id[i]!, v.gen[i]!, v.kind[i]!, v.qx[i]!, v.qy[i]!, v.anim[i]!, v.level[i]!]);
    return { ok, got: rows(got), drawn: rows(drawn), names: got.name.slice(0, got.count), died, bits: r.pos - 3, view: got };
  };
  /** Sends `cur` against `sent`, which the client holds as `held`; returns the ops the tally was told and what the client then holds. */
  const send = (cur: EntityView, sent: SentView | null, held: EntityView | null): { ops: number[][]; next: SentView; held: EntityView } => {
    const next = new SentView();
    w.reset();
    w.bits(5, 3);
    writeViewDelta(w, sent, cur, next, 1 << 20, 0, looks);
    const ops: number[][] = [];
    let bits = 0;
    const plain = read(held, null);
    const tallied = read(held, (op, kind, b) => {
      ops.push([op, kind]);
      bits += b;
    });
    expect(plain.ok).toBe(true);
    expect({ ...tallied, view: null }).toEqual({ ...plain, view: null });
    expect(bits).toBe(plain.bits);
    return { ops, next, held: tallied.view };
  };

  // At first every body is a create, after the count.
  const first = send(view([[3, 1, 7, 100], [8, 1, 9, 110], [20, 2, 11, 120]]), null, null);
  expect(first.ops).toEqual([[-1, -1], [1, 7], [1, 9], [1, 11]]);
  // Then one moves, one is new, one goes, one died, and one more is new: an update, a remove and a died name the kind the
  // client held.
  looks.died[20] = 2;
  const second = send(view([[3, 1, 7, 101], [5, 1, 12, 130], [30, 1, 13, 140]]), first.next, first.held);
  expect(second.ops.map(([op, kind]) => [op === -1 ? "count" : OPS[op!], kind])).toEqual([["count", -1], ["update", 7], ["create", 12], ["remove", 9], ["died", 11], ["create", 13]]);
});

test("the log keeps each second's counts for three minutes, and a quiet second is empty", () => {
  const t = clock(0);
  const log = new NetLog(t, () => 0);
  for (let s = 0; s < 200; s++) {
    t.t = s * 1000 + 500;
    log.received(9, -1, s + 1);
  }
  t.t = 200_100;
  const n = SECONDS + 10;
  const bytes = new Float64Array(CATEGORIES.length * n);
  const msgs = new Float64Array(CATEGORIES.length * n);
  log.series(n, bytes, msgs);
  const other = cat("other") * n;
  // The second under way is not shown; of the 190 before it, the 180 kept are, each with its bytes and its one message.
  expect([...bytes.subarray(other, other + n)]).toEqual([...Array<number>(10).fill(0), ...Array.from({ length: SECONDS }, (_, i) => i + 21)]);
  expect([...msgs.subarray(other, other + n)]).toEqual([...Array<number>(10).fill(0), ...Array<number>(SECONDS).fill(1)]);
  expect(bytes.reduce((a, b) => a + b) - bytes.subarray(other, other + n).reduce((a, b) => a + b)).toBe(0);
  const rows: NetRow[] = [];
  expect(log.rows(rows)).toBe(1);
  expect([rows[0]!.bytes, rows[0]!.messages, rows[0]!.bytes10, rows[0]!.messages10]).toEqual([200, 1, ((191 + 200) * 5) / 10, 1]);

  // Five quiet seconds read as nothing; the table still has the totals.
  t.t = 205_500;
  log.series(10, bytes, msgs);
  expect([...bytes.subarray(cat("other") * 10, cat("other") * 10 + 10)]).toEqual([196, 197, 198, 199, 200, 0, 0, 0, 0, 0]);
  log.rows(rows);
  expect([rows[0]!.bytes, rows[0]!.messages, rows[0]!.bytes10, rows[0]!.bytesAll, rows[0]!.messagesAll]).toEqual([0, 0, (196 + 197 + 198 + 199 + 200) / 10, 20100, 200]);

  // After an hour without a message nothing is left of them, and the next second counts as ever.
  t.t = 3_800_000;
  log.series(SECONDS, bytes, msgs);
  expect(bytes.subarray(0, CATEGORIES.length * SECONDS).every((b) => b === 0)).toBe(true);
  log.received(9, -1, 7);
  t.t = 3_801_000;
  const rates = new Float64Array(4);
  log.rates(rates);
  expect([...rates]).toEqual([7, 0, 1, 0]);
  expect([log.bytesIn, log.messagesIn, log.bytesOut]).toEqual([20107, 201, 0]);
});

test("the log's first seconds count what they hold, and its means only the seconds it has", () => {
  const t = clock(10_250);
  const log = new NetLog(t, () => 0);
  log.sent(P.C_INPUT, -1, 40);
  log.sent(P.C_INPUT, -1, 40);
  const rows: NetRow[] = [];
  log.rows(rows);
  // No second is whole yet.
  expect([rows[0]!.bytes, rows[0]!.bytes10, rows[0]!.bytesAll]).toEqual([0, 0, 80]);
  t.t = 12_100;
  log.rows(rows);
  expect([rows[0]!.bytes, rows[0]!.messages, rows[0]!.bytes10, rows[0]!.messages10]).toEqual([0, 0, 40, 1]);
  const rates = new Float64Array(4);
  log.rates(rates, 10);
  expect([...rates]).toEqual([0, 40, 0, 1]);
});

test("a key is named by its number until the names come, then by its code and category", () => {
  const t = clock(500);
  const log = new NetLog(t, () => 0);
  log.received(P.S_EVENT, P.EVENT_HIT, 20);
  log.sent(P.C_COMMAND, P.CMD_TEXT, 12);
  expect(named(log)).toEqual([[`S ${P.S_EVENT}`, `${P.EVENT_HIT}`, "other"], [`C ${P.C_COMMAND}`, `${P.CMD_TEXT}`, "other"]]);
  log.setNames(codeNames(P));
  log.received(P.S_OWN, P.OWN_VITALS, 30);
  log.received(P.S_CHUNK, -1, 300);
  log.received(250, -1, 3);
  expect(named(log)).toEqual([["S_EVENT", "EVENT_HIT", "combat"], ["C_COMMAND", "CMD_TEXT", "commands"], ["S_OWN", "OWN_VITALS", "player"], ["S_CHUNK", "", "world"], ["S 250", "", "other"]]);
});

test("the table names only codes the protocol has, and its rows hold", () => {
  const names = codeNames(P);
  const of = (family: Record<number, string>): string[] => Object.values(family);
  // A code renamed or taken out leaves no row behind; a new one shows under "other" until a line files it.
  const known = new Set([...of(names.S), ...of(names.EVENT), ...of(names.C)]);
  expect(Object.values(CATEGORY_ROWS).flat().filter((name) => !known.has(name))).toEqual([]);
  expect(new Set(of(names.OWN).map((o) => CATEGORIES[categoryOf("S_OWN", o)]))).toEqual(new Set(["player"]));
  expect(new Set(of(names.TEXT).map((t) => CATEGORIES[categoryOf("S_TEXT", t)]))).toEqual(new Set(["text"]));
  expect(new Set(of(names.CMD).map((c) => CATEGORIES[categoryOf("C_COMMAND", c)]))).toEqual(new Set(["commands"]));
  const table: [string, string, string][] = [["S_EVENT", "EVENT_HIT", "combat"], ["S_EVENT", "EVENT_SHOT", "combat"], ["S_EVENT", "EVENT_IMPACT", "cosmetic"], ["S_EVENT", "EVENT_TAMED", "world"], ["S_EVENT", "EVENT_BALL", "world"], ["S_EVENT", "", "other"], ["S_CORPSE", "", "cosmetic"], ["S_FAR", "", "world"], ["S_TUNING", "", "session"], ["S_SNAPSHOT", "", "bodies"], ["C_HELLO", "", "session"], ["C_INPUT", "", "input"], ["S_NOTHING", "", "other"]];
  expect(table.map(([kind, sub]) => [kind, sub, CATEGORIES[categoryOf(kind, sub)]])).toEqual(table);
});

test("a snapshot's bytes go by its sections, its message by its bodies, and its ops by class of body", () => {
  const t = clock(500);
  const log = new NetLog(t, (kind) => (kind === 7 ? 0 : kind === 9 ? 1 : 3));
  log.setNames(codeNames(P));
  log.received(P.S_SNAPSHOT, -1, 100);
  for (const [section, op, kind, bits] of [[SNAP_HEAD, -1, -1, 120], [SNAP_OWN, -1, -1, 300], [SNAP_CONTACTS, -1, -1, 20], [SNAP_BODIES, -1, -1, 8], [SNAP_BODIES, 0, 7, 100], [SNAP_BODIES, 1, 9, 200], [SNAP_BODIES, 2, 9, 48], [SNAP_REST, -1, -1, 4]]) log.snapshot(section!, op!, kind!, bits!);
  t.t = 650;
  log.received(P.S_OWN, P.OWN_VITALS, 30);
  t.t = 800;
  log.received(P.S_SNAPSHOT, -1, 10);
  log.snapshot(SNAP_HEAD, -1, -1, 80);
  // A session quiet for a while sends its inputs again as it reads a snapshot, before the snapshot's last section.
  log.sent(P.C_INPUT, -1, 20);
  log.snapshot(SNAP_REST, -1, -1, 0);
  t.t = 1200;

  const bytes = new Float64Array(CATEGORIES.length);
  const msgs = new Float64Array(CATEGORIES.length);
  log.series(1, bytes, msgs);
  expect([bytes[cat("player")], bytes[cat("bodies")], bytes[cat("input")], msgs[cat("player")], msgs[cat("bodies")], msgs[cat("input")]]).toEqual([(120 + 300 + 80) / 8 + 30, (20 + 8 + 100 + 200 + 48 + 4) / 8, 20, 1, 2, 1]);
  log.series(1, bytes, msgs, NET_OUT);
  expect([...bytes].map((b, c) => (b === 0 ? "" : `${CATEGORIES[c]} ${b}`)).join("")).toBe("input 20");

  // The snapshots are a row a section, their messages on the bodies'.
  const rows: NetRow[] = [];
  const n = log.rows(rows);
  expect(rows.slice(0, n).map((r) => [r.kindName, r.subName, CATEGORIES[r.category], r.bytes, r.messages, r.section])).toEqual([
    ["S_SNAPSHOT", "head", "player", 25, 0, true],
    ["S_SNAPSHOT", "own body", "player", 37.5, 0, true],
    ["S_SNAPSHOT", "contacts", "bodies", 2.5, 0, true],
    ["S_SNAPSHOT", "bodies", "bodies", 44.5, 2, true],
    ["S_SNAPSHOT", "rest", "bodies", 0.5, 0, true],
    ["S_OWN", "OWN_VITALS", "player", 30, 1, false],
    ["C_INPUT", "", "input", 20, 1, false],
  ]);
  expect(rows.slice(0, 5).map((r) => r.sub)).toEqual([SNAP_HEAD, SNAP_OWN, SNAP_CONTACTS, SNAP_BODIES, SNAP_REST]);
  expect(rows.slice(0, 5).reduce((a, r) => a + r.bytesAll, 0)).toBe(110);

  const parts = new SnapshotParts();
  log.snapshots(parts);
  const cell = (op: number, body: string): number => op * BODY_CLASSES.length + BODY_CLASSES.indexOf(body as (typeof BODY_CLASSES)[number]);
  expect([parts.count, parts.gap, parts.since, parts.countBits, [...parts.sections], [...parts.classes]]).toEqual([2, 300, 400, 8, [200, 300, 20, 356, 4], [100, 248, 0, 0]]);
  expect([parts.opBits[cell(0, "survivor")], parts.opBits[cell(1, "creature")], parts.opBits[cell(2, "creature")], parts.ops[cell(1, "creature")], parts.ops.reduce((a, b) => a + b)]).toEqual([100, 200, 48, 1, 3]);
});

test("a body's class is its kind's: survivor, creature, vehicle or other", () => {
  const reg = coreRegistry();
  const classOf = bodyClass(reg);
  const ids = ["core:survivor", "core:rex", "core:civilian", "core:boat", "core:corpse"];
  expect(ids.map((id) => BODY_CLASSES[classOf(reg.index.get(id)!)])).toEqual(["survivor", "creature", "creature", "vehicle", "other"]);
  expect([classOf(-1), classOf(0), classOf(1 << 20)].map((c) => BODY_CLASSES[c])).toEqual(["other", "other", "other"]);
});

test("counting a message makes nothing, and takes under two microseconds", () => {
  const proto = NetLog.prototype as unknown as Record<string, (...args: never[]) => unknown>;
  for (const name of ["received", "sent", "snapshot", "note", "began", "roll", "empty"]) expect([name, makes(proto[name]!)]).toEqual([name, []]);
  // The check sees what it looks for.
  expect(makes(function (this: { a: number[] }) { this.a = [1, 2]; })).toEqual(["an array"]);
  const t = clock(0);
  const log = new NetLog(t, () => 1);
  const n = 300_000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    t.t = i * 0.5;
    log.received(i & 7, (i & 3) - 1, 100);
    log.snapshot(SNAP_BODIES, i & 3, 9, 50);
  }
  const each = ((performance.now() - t0) * 1000) / n;
  expect(each).toBeLessThan(2);
  expect(log.messagesIn).toBe(n);
});

test("a capture's socket says the seconds it saw, and its rates are over those", () => {
  const t = clock(10_000), log = new NetLog(t, () => 3);
  log.setNames(codeNames(P));
  // 34 seconds of 4,500 bytes of snapshots a second, then the capture asks for three minutes.
  for (let s = 0; s < 34; s++) {
    for (let k = 0; k < 30; k++) {
      t.t = 10_000 + s * 1000 + k * 33;
      log.received(P.S_CHUNK, -1, 150);
    }
  }
  t.t = 10_000 + 34 * 1000 + 10;
  const r = log.record(t.t - 180_000, 10_000) as { seconds: number; window: { from: number; to: number }; categories: { name: string; bytes: number[] }[]; keys: { name: string; bytes: number }[] };
  expect([r.seconds, r.window.from, r.window.to]).toEqual([34, 0, 34_000]);
  const world = r.categories.find((c) => c.name === "world")!;
  expect(world.bytes.length).toBe(34);
  expect(world.bytes.reduce((a, b) => a + b, 0) / r.seconds).toBe(4500);
  expect(r.keys.find((k) => k.name === "S_CHUNK")!.bytes / r.seconds).toBe(4500);
});

test("a capture's socket leaves out the second the log began part way through", () => {
  const t = clock(10_400), log = new NetLog(t, () => 3);
  log.setNames(codeNames(P));
  log.received(P.S_CHUNK, -1, 1000);
  t.t = 11_200;
  log.received(P.S_CHUNK, -1, 500);
  t.t = 13_050;
  const r = log.record(0) as { seconds: number; window: { from: number; to: number }; keys: { name: string; bytes: number }[] };
  expect([r.seconds, r.window.from, r.window.to]).toEqual([2, 11_000, 13_000]);
  expect(r.keys.find((k) => k.name === "S_CHUNK")!.bytes).toBe(500);
});

test("a capture keeps a category that has bytes and no messages of its own, as the player's share of snapshots", () => {
  const t = clock(10_000), log = new NetLog(t, () => 3);
  log.setNames(codeNames(P));
  for (let s = 0; s < 3; s++) {
    t.t = 10_000 + s * 1000 + 100;
    log.received(P.S_SNAPSHOT, -1, 60);
    log.snapshot(SNAP_HEAD, -1, -1, 80);
    log.snapshot(SNAP_BODIES, -1, -1, 400);
  }
  t.t = 13_200;
  const r = log.record(0) as { categories: { name: string; bytes: number[]; messages: number[] }[] };
  expect(r.categories.map((c) => [c.name, c.bytes, c.messages])).toEqual([
    ["player", [10, 10, 10], [0, 0, 0]],
    ["bodies", [50, 50, 50], [1, 1, 1]],
  ]);
});
