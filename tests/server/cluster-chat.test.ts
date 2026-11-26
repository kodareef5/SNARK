// Global chat that reaches every map of a cluster, through files in the folder they share.

import { afterAll, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { ChatRelay, POLL_MS, STALE_MS, type RelayLine } from "../../server/cluster/chat-relay.ts";
import type { TextRun } from "../../shared/net/chat.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const folder = (): string => {
  const d = mkdtempSync(join(tmpdir(), "snark-cluster-chat-"));
  dirs.push(d);
  return d;
};

/** A wall clock the test moves. */
const clock = { t: 1_800_000_000_000 };
const now = (): number => clock.t;

/** A relay that keeps what it is handed. */
function relay(root: string, world: number, restartBytes?: number) {
  const got: RelayLine[] = [];
  const r = new ChatRelay({ root, world, now, onLine: (l) => got.push(l), ...(restartBytes ? { restartBytes } : {}) });
  return { r, got, words: () => got.map((l) => l.runs.map((x) => x.text).join("")) };
}

const poll = (...rs: ChatRelay[]): void => {
  clock.t += POLL_MS;
  for (const r of rs) r.poll(clock.t);
};

/** A map of the cluster: a server with survivors, its chat sent to and read from the folder. */
function map(root: string, world: number, name: string, people: string[]) {
  const h = new Harness({}, world, 60, { dev: true });
  const sessions = people.map((n) => h.join(n));
  h.run(600);
  for (const s of sessions) h.say(s, "enablecheats");
  const r = new ChatRelay({ root, world, now, onLine: (l) => h.host.chat.fromOtherMap(l.speaker, l.runs) });
  h.host.chat.mapName = name;
  h.host.chat.relay = (speaker, runs) => void r.send(speaker, runs);
  return { h, sessions, r };
}

/** Lines on the global channel since log version `from`, as text. */
const global = (s: ClientSession, from: number): string[] =>
  s.log
    .slice(Math.max(0, s.log.length - (s.logVersion - from)))
    .filter((l) => l.channel === TEXT_GLOBAL)
    .map((l) => l.text);

/** Two maps over one folder: ada and bob on the island, cy and di on the scorched earth. */
function two() {
  const root = folder();
  const island = map(root, 1, "The Island", ["ada", "bob"]);
  const scorched = map(root, 2, "Scorched Earth", ["cy", "di"]);
  const step = (ms = 300): void => {
    island.h.run(ms);
    scorched.h.run(ms);
    poll(island.r, scorched.r);
    island.h.run(ms);
    scorched.h.run(ms);
  };
  return { root, island, scorched, step };
}

test("a line said in global chat on one map shows on another with the map's name in front", () => {
  const { island, scorched, step } = two();
  const [ada, bob] = island.sessions as [ClientSession, ClientSession];
  const [cy, di] = scorched.sessions as [ClientSession, ClientSession];
  const marks = [ada.logVersion, bob.logVersion, cy.logVersion, di.logVersion];
  ada.chat(TEXT_GLOBAL, "hello, cluster");
  step();
  expect([global(ada, marks[0]!), global(bob, marks[1]!), global(cy, marks[2]!), global(di, marks[3]!)]).toEqual([
    ["ada: hello, cluster"],
    ["ada: hello, cluster"],
    ["[The Island] ada: hello, cluster"],
    ["[The Island] ada: hello, cluster"],
  ]);
  expect(cy.log.at(-1)!.runs).toEqual([{ text: "[The Island] " }, { text: "ada" }, { text: ": hello, cluster" }]);
});

test("a local or tribe line and an NPC's line stay on their map", () => {
  const { root, island, scorched, step } = two();
  const [ada, bob] = island.sessions as [ClientSession, ClientSession];
  const [cy] = scorched.sessions as [ClientSession];
  island.h.say(ada, "tribe create Night Shift");
  island.h.say(ada, "tribe invite bob");
  island.h.say(bob, "tribe accept");
  const me = island.h.client(ada)!.body;
  island.h.say(bob, `tp ${me.x.toFixed(3)} ${(me.z + 2).toFixed(3)}`);
  const from = cy.logVersion;
  const near = bob.logVersion;
  ada.chat(TEXT_LOCAL, "anyone near?");
  ada.chat(TEXT_TRIBE, "the wall is up");
  const at = island.h.client(ada)!.body;
  expect(island.h.host.chat.npcSay("Scout", at.x, at.y, at.z, "anyone about?")).toBeGreaterThan(0);
  step();
  expect(bob.log.slice(-(bob.logVersion - near)).map((l) => l.text).sort()).toEqual(["Scout: anyone about?", "ada: anyone near?", "ada: the wall is up"]);
  expect(cy.logVersion).toBe(from);
  expect(() => readFileSync(join(root, "chat", "1.jsonl"))).toThrow();
});

test("a survivor who muted the speaker does not see their line from another map", () => {
  const { island, scorched, step } = two();
  const [ada] = island.sessions as [ClientSession];
  const [cy, di] = scorched.sessions as [ClientSession, ClientSession];
  expect(scorched.h.say(cy, "mute ada")[0]).toBe("You will not hear ada.");
  const marks = [cy.logVersion, di.logVersion];
  ada.chat(TEXT_GLOBAL, "can you hear me?");
  step();
  expect([global(cy, marks[0]!), global(di, marks[1]!)]).toEqual([[], ["[The Island] ada: can you hear me?"]]);
});

test("a map with no global channel shows no line from another map", () => {
  const { island, scorched, step } = two();
  const [ada] = island.sessions as [ClientSession];
  const [cy] = scorched.sessions as [ClientSession];
  scorched.h.say(cy, "setting ProximityChat True");
  const from = cy.logVersion;
  ada.chat(TEXT_GLOBAL, "anyone out there?");
  step();
  expect(global(cy, from)).toEqual([]);
  expect(scorched.h.host.chat.fromOtherMap("ada", [{ text: "ada: again" }])).toBe(0);
});

test("a line from another map is in no map's recent lines but its own", () => {
  const { island, scorched, step } = two();
  const [ada] = island.sessions as [ClientSession];
  const [cy] = scorched.sessions as [ClientSession];
  const from = cy.logVersion;
  ada.chat(TEXT_GLOBAL, "for the record");
  step();
  expect(global(cy, from)).toEqual(["[The Island] ada: for the record"]);
  expect(island.h.host.chat.recentLines().map((l) => [l.speaker, l.text])).toEqual([["ada", "for the record"]]);
  expect(scorched.h.host.chat.recentLines()).toEqual([]);
});

test("a line is shown once, also after the sender's file starts again", () => {
  const root = folder();
  const say = (r: ChatRelay, words: string): boolean => r.send("ada", [{ text: `ada: ${words}` }]);
  const a = relay(root, 1, 300);
  const b = relay(root, 2);
  say(a.r, "one");
  poll(b.r);
  poll(b.r);
  // Two lines pass the size, so the file starts again between them, both unread.
  say(a.r, "two");
  say(a.r, "three");
  say(a.r, "four");
  poll(b.r);
  poll(b.r);
  expect(b.words()).toEqual(["ada: one", "ada: two", "ada: three", "ada: four"]);
  // The writer starts again over the same file: its lines count from 0 again and are still new.
  const again = relay(root, 1, 300);
  say(again.r, "five");
  poll(b.r);
  poll(b.r);
  expect(b.words()).toEqual(["ada: one", "ada: two", "ada: three", "ada: four", "ada: five"]);
  // A line copied in a second time is the same line.
  const file = join(root, "chat", "1.jsonl");
  const last = readFileSync(file, "utf8").trimEnd().split("\n").at(-1)!;
  appendFileSync(file, `${last}\n`);
  poll(b.r);
  expect(b.got.length).toBe(5);
});

test("a relay that starts does not replay what was said before it", () => {
  const root = folder();
  const a = relay(root, 1);
  a.r.send("ada", [{ text: "ada: before" }]);
  const b = relay(root, 2);
  poll(b.r);
  a.r.send("ada", [{ text: "ada: after" }]);
  poll(b.r);
  expect(b.words()).toEqual(["ada: after"]);
  // A world that was down comes back to lines too old to show.
  a.r.send("ada", [{ text: "ada: long ago" }]);
  clock.t += STALE_MS;
  poll(b.r);
  expect(b.words()).toEqual(["ada: after"]);
});

test("a half-written line waits and a bad line is skipped", () => {
  const root = folder();
  const b = relay(root, 2);
  const file = join(root, "chat", "3.jsonl");
  const line = (seq: number, runs: TextRun[]): string => JSON.stringify({ seq, start: "s", at: clock.t, world: 3, speaker: "eve", runs });
  // The folder had no file of world 3: one that comes later is read from its beginning.
  const whole = line(1, [{ text: "eve: second" }]);
  appendFileSync(file, `${line(0, [{ text: "eve: first" }])}\n${whole.slice(0, 20)}`);
  poll(b.r);
  expect(b.words()).toEqual(["eve: first"]);
  poll(b.r);
  expect(b.words()).toEqual(["eve: first"]);
  appendFileSync(file, `${whole.slice(20)}\nnot json\n${line(2, [{ text: "x", ink: -1 }])}\n${line(3, [])}\n{"seq":4}\n${line(5, [{ text: "eve: third" }])}\n`);
  poll(b.r);
  expect(b.words()).toEqual(["eve: first", "eve: second", "eve: third"]);
});

test("a relay with no folder or file says no error and hands on nothing", () => {
  const root = join(folder(), "not", "yet");
  const said: string[] = [];
  const b = new ChatRelay({ root, world: 2, now, onLine: () => said.push("line"), say: (t) => said.push(t) });
  rmSync(join(root, "chat"), { recursive: true, force: true });
  poll(b);
  clock.t += 10_000;
  poll(b);
  expect(said).toEqual([]);
  expect(b.send("ada", [{ text: "ada: hello" }])).toBe(true);
});
