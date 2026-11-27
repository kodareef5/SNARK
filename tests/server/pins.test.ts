// Pins on the map (server/pins.ts): kept per team, saved, merged with a tribe, refused where a rule says so.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinAt, unpin } from "../../client/core/pins.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { PIN_BURST, PIN_EVERY, PIN_KINDS, PINS_MOST, Pins, cleanLabel } from "../../server/pins.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { CMD_PIN, PIN_ADD, RESULT_DENIED, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_RATE } from "../../shared/net/protocol.ts";
import { DeadlineHeap } from "../../shared/sim/schedule.ts";
import { WAYPOINT_KINDS } from "../../shared/world/course.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-pins-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function world(names: string[], dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, ...(dbPath ? { dbPath } : {}) });
  const sessions = names.map((n) => h.join(n));
  h.run(800);
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  return { h, sessions, rec, pins: h.host.pins };
}

/** The server's answers to what `send` sends, in the order sent. */
function answers(h: Harness, s: ClientSession, send: () => void, ms = 300): number[] {
  const got = new Map<number, number>();
  const was = s.onResult;
  s.onResult = (seq, code) => void got.set(seq, code);
  const first = (s as unknown as { commandSeq: number }).commandSeq;
  send();
  h.run(ms);
  s.onResult = was;
  return [...got.entries()].filter(([seq]) => seq > first).sort((a, b) => a[0] - b[0]).map(([, code]) => code);
}

function tribe(h: Harness, owner: ClientSession, member: ClientSession): void {
  h.say(owner, "tribe create Wolves");
  h.say(owner, "tribe invite " + member.name);
  h.say(member, "tribe accept");
  h.run(300);
}

test("a pin on the map is kept for the team at the place asked, held to the map", () => {
  const { h, sessions: [ada], rec, pins } = world(["ada"]);
  const team = rec(ada!).team;
  expect(answers(h, ada!, () => void pinAt(ada!, 120.5, 80.25, 3, true, "  ore\u0007 here  "))).toEqual([RESULT_OK]);
  const [pin] = pins.of(team);
  expect(pin).toMatchObject({ x: 120.5, z: 80.25, kind: 3, shared: true, label: "ore here", author: rec(ada!).pid, radius: PIN_KINDS[3]!.radius, pull: PIN_KINDS[3]!.pull, expires: 0 });
  expect(pins.find(team, pin!.id)).toBe(pin!);
  expect(pins.find(team, pin!.id + 1)).toBeNull();
  expect(answers(h, ada!, () => void pinAt(ada!, -50, 1e9, 0, true, ""))).toEqual([RESULT_OK]);
  expect([pins.of(team)[1]!.x, pins.of(team)[1]!.z]).toEqual([0, h.world.dims.chunksZ * CHUNK_SIZE]);
  expect(cleanLabel("x".repeat(40))).toBe("x".repeat(24));
  expect(cleanLabel("ééééééééééééé")).toBe("éééééééééééé");
});

test("a team keeps 32 pins and lets the oldest go first, never giving an id twice", () => {
  const { sessions: [ada], rec, pins } = world(["ada"]);
  const r = rec(ada!);
  const v0 = pins.version(r.team);
  for (let i = 0; i < PINS_MOST + 3; i++) pins.place(r.team, r.pid, i, i, 0, true, `p${i}`);
  const list = pins.of(r.team);
  expect(list.length).toBe(PINS_MOST);
  expect([list[0]!.label, list.at(-1)!.label]).toEqual(["p3", `p${PINS_MOST + 2}`]);
  expect(new Set(list.map((p) => p.id)).size).toBe(PINS_MOST);
  expect(pins.version(r.team)).not.toBe(v0);
  pins.remove(r.team, list.at(-1)!.id);
  const next = pins.place(r.team, r.pid, 1, 1, 0, true, "");
  expect(next.id).toBe(PINS_MOST + 4);
});

test("an author removes its own pin; a member may not take another's, the owner may", () => {
  const { h, sessions: [bob, ada], rec, pins } = world(["bob", "ada"]);
  tribe(h, bob!, ada!);
  const team = rec(bob!).team;
  expect(rec(ada!).team).toBe(team);
  expect(answers(h, bob!, () => void pinAt(bob!, 10, 10, 0, true, "bob's"))).toEqual([RESULT_OK]);
  expect(answers(h, ada!, () => (pinAt(ada!, 20, 20, 1, true, "ada's"), void pinAt(ada!, 30, 30, 4, true, "mine")))).toEqual([RESULT_OK, RESULT_OK]);
  const [bobs, adas, mine] = pins.of(team);
  expect(answers(h, ada!, () => void unpin(ada!, bobs!.id))).toEqual([RESULT_NOT_YOURS]);
  expect(answers(h, ada!, () => void unpin(ada!, mine!.id))).toEqual([RESULT_OK]);
  expect(answers(h, bob!, () => void unpin(bob!, adas!.id))).toEqual([RESULT_OK]);
  expect(answers(h, bob!, () => void unpin(bob!, adas!.id))).toEqual([RESULT_INVALID]);
  expect(pins.of(team).map((p) => p.label)).toEqual(["bob's"]);
});

test("a kind out of range, a dead survivor and a pin too many at once are refused", () => {
  const { h, sessions: [ada], rec, pins } = world(["ada"]);
  const team = rec(ada!).team;
  const bad = (kind: number) => ada!.command(CMD_PIN, (w: BitWriter) => (w.bits(PIN_ADD, 2), w.f32(1), w.f32(1), w.bits(kind, 3), w.bool(true), w.string("")));
  expect(answers(h, ada!, () => (bad(WAYPOINT_KINDS.length), void bad(7)))).toEqual([RESULT_INVALID, RESULT_INVALID]);
  // PIN_BURST at once, then one more is too fast; one PIN_EVERY later, one more may come.
  const burst = answers(h, ada!, () => {
    for (let i = 0; i <= PIN_BURST; i++) pinAt(ada!, i, i, 0, true, "");
  });
  expect(burst).toEqual([...Array(PIN_BURST).fill(RESULT_OK), RESULT_RATE]);
  expect(pins.of(team).length).toBe(PIN_BURST);
  h.run((PIN_EVERY / 30) * 1000);
  expect(answers(h, ada!, () => void pinAt(ada!, 9, 9, 0, true, ""))).toEqual([RESULT_OK]);
  h.say(ada!, "enablecheats");
  h.say(ada!, "suicide");
  expect(rec(ada!).dead).toBe(true);
  expect(answers(h, ada!, () => void pinAt(ada!, 5, 5, 0, true, ""))).toEqual([RESULT_DENIED]);
  expect(pins.of(team).length).toBe(PIN_BURST + 1);
});

test("a pin of a kind that lapses goes at its tick, with no step and no scan of the teams", () => {
  const deadlines = new DeadlineHeap();
  const w = { tick: 100, dims: { chunksX: 4, chunksZ: 4 } };
  const ctx = {
    world: w, deadlines, records: { byPid: new Map() }, tribes: { of: () => null }, reach: () => 0,
    game: { handle: () => {}, own: { add: () => {} } },
  } as unknown as ConstructorParameters<typeof Pins>[0];
  const pins = new Pins(ctx);
  const enemy = WAYPOINT_KINDS.indexOf("enemy"), go = WAYPOINT_KINDS.indexOf("go");
  const lapses = pins.place(7, 1, 5, 5, enemy, true, "");
  const stays = pins.place(7, 1, 6, 6, go, true, "");
  expect(lapses.expires).toBe(100 + PIN_KINDS[enemy]!.lasts * 30);
  expect([stays.expires, deadlines.size]).toEqual([0, 1]);
  w.tick = lapses.expires - 1;
  deadlines.run(w.tick);
  expect(pins.of(7).length).toBe(2);
  w.tick = lapses.expires;
  deadlines.run(w.tick);
  expect(pins.of(7)).toEqual([stays]);
  // A pin moved to another team takes its deadline along, and the old one finds nothing.
  const again = pins.place(7, 1, 5, 5, enemy, true, "");
  pins.merge(7, 9);
  expect(deadlines.size).toBe(2);
  w.tick = again.expires;
  deadlines.run(w.tick);
  expect([pins.of(7).length, pins.of(9).map((p) => p.kind)]).toEqual([0, [go]]);
});

test("pins outlast a restart with their ids, sharing and labels, and an id is not given again", () => {
  const dbPath = join(dir, "restart.db");
  let team = 0, saved: unknown[] = [];
  {
    const { h, sessions: [ada], rec, pins } = world(["ada"], dbPath);
    team = rec(ada!).team;
    expect(answers(h, ada!, () => (pinAt(ada!, 40, 41, 2, true, "camp"), void pinAt(ada!, 50, 51, 4, false, "me")))).toEqual([RESULT_OK, RESULT_OK]);
    saved = pins.of(team).map((p) => ({ ...p }));
    h.host.shutdown();
  }
  {
    const { h, sessions: [ada], rec, pins } = world(["ada"], dbPath);
    expect(rec(ada!).team).toBe(team);
    expect(pins.of(team)).toEqual(saved as never);
    expect(ada!.pins.map((p) => [p.label, p.shared, p.mine])).toEqual([["camp", true, true], ["me", false, true]]);
    const next = pins.place(team, rec(ada!).pid, 1, 1, 0, true, "");
    expect(next.id).toBeGreaterThan(Math.max(...pins.of(team).slice(0, -1).map((p) => p.id)));
    h.host.shutdown();
  }
});

test("the pins are saved by the commit after they change, ten seconds apart at most", () => {
  const { h, sessions: [ada], rec, pins } = world(["ada"], join(dir, "every.db"));
  const r = rec(ada!);
  h.run(11000);
  pins.place(r.team, r.pid, 1, 1, 0, true, "");
  expect(pins.dirty).toBe(true);
  h.run(1000);
  expect(pins.dirty).toBe(false);
  pins.place(r.team, r.pid, 2, 2, 0, true, "");
  h.run(4000);
  expect(pins.dirty).toBe(true);
  h.host.shutdown();
  expect(pins.dirty).toBe(false);
});

test("a survivor's pins join the tribe it joins, renumbered, and the newest 32 stay", () => {
  const { h, sessions: [bob, ada], rec, pins } = world(["bob", "ada"]);
  const lone = rec(ada!).team;
  h.say(bob!, "tribe create Wolves");
  const team = rec(bob!).team;
  for (let i = 0; i < 20; i++) pins.place(lone, rec(ada!).pid, i, i, 0, i !== 19, `a${i}`);
  h.run(100);
  for (let i = 0; i < 20; i++) pins.place(team, rec(bob!).pid, i, i, 0, true, `b${i}`);
  h.say(bob!, "tribe invite ada");
  h.say(ada!, "tribe accept");
  h.run(300);
  const list = pins.of(team);
  expect(pins.of(lone)).toEqual([]);
  expect(list.length).toBe(PINS_MOST);
  expect(list.filter((p) => p.label.startsWith("a")).map((p) => p.label)).toEqual(["a8", "a9", "a10", "a11", "a12", "a13", "a14", "a15", "a16", "a17", "a18", "a19"]);
  expect(new Set(list.map((p) => p.id)).size).toBe(PINS_MOST);
  // Ada's pin that was not shared is still hers alone.
  expect(ada!.pins.length).toBe(PINS_MOST);
  expect(bob!.pins.length).toBe(PINS_MOST - 1);
  expect(bob!.pins.some((p) => p.label === "a19")).toBe(false);
});

test("when the last member leaves, the tribe's pins go with it", () => {
  const { h, sessions: [bob], rec, pins } = world(["bob"]);
  h.say(bob!, "tribe create Wolves");
  const team = rec(bob!).team;
  expect(answers(h, bob!, () => void pinAt(bob!, 10, 10, 0, true, "here"))).toEqual([RESULT_OK]);
  expect(bob!.pins.length).toBe(1);
  h.say(bob!, "tribe leave");
  h.run(300);
  expect(rec(bob!).team).not.toBe(team);
  expect([pins.of(team).length, pins.version(team), bob!.pins.length]).toEqual([0, 0, 0]);
});

test("a lone survivor's pins are its own, and another survivor alone is told none", () => {
  const { h, sessions: [ada, cat], rec, pins } = world(["ada", "cat"]);
  expect(answers(h, ada!, () => void pinAt(ada!, 10, 10, 0, true, "mine"))).toEqual([RESULT_OK]);
  expect([ada!.pins.map((p) => p.label), cat!.pins.length]).toEqual([["mine"], 0]);
  expect(pins.of(rec(cat!).team)).toEqual([]);
  expect(answers(h, cat!, () => void unpin(cat!, ada!.pins[0]!.id))).toEqual([RESULT_INVALID]);
});

test("a pin not shared is told to its author alone, and nobody else may remove it", () => {
  const { h, sessions: [bob, ada], rec, pins } = world(["bob", "ada"]);
  tribe(h, bob!, ada!);
  expect(answers(h, ada!, () => (pinAt(ada!, 10, 10, 0, false, "secret"), void pinAt(ada!, 11, 11, 0, true, "open")))).toEqual([RESULT_OK, RESULT_OK]);
  expect(ada!.pins.map((p) => p.label)).toEqual(["secret", "open"]);
  expect(bob!.pins.map((p) => p.label)).toEqual(["open"]);
  const secret = pins.of(rec(ada!).team)[0]!;
  expect(answers(h, bob!, () => void unpin(bob!, secret.id))).toEqual([RESULT_INVALID]);
  expect(pins.find(rec(ada!).team, secret.id)).not.toBeNull();
});
