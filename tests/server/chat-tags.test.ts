// Chat made from permission groups on whole servers: a group's format, the tags, the muted group, and global chat across a cluster.
import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { chatRows } from "../../client/core/admin/chat.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR } from "../../server/acts.ts";
import { POLL_MS } from "../../server/cluster/chat-relay.ts";
import { idText } from "../../server/survivor-ids.ts";
import type { TextRun } from "../../shared/net/chat.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import type { PermissionOp } from "../../shared/permissions/model.ts";
import { TestCluster, type Server } from "../fixtures/cluster.ts";
import type { Harness } from "../fixtures/net.ts";
import { camp, record, survivor } from "../kit/kit.ts";

const quiet = { log: () => {} };
const RED = 0xff0000;
const GREEN = 0x00ff00;

/** An operator's change, which must be made. */
function op(h: Harness, change: PermissionOp): void {
  const why = h.host.changePermissions(OPERATOR, change);
  if (why !== "") throw new Error(`${change.op}: ${why}`);
}

const idOf = (h: Harness, s: ClientSession): string => idText(record(h, s));
const add = (h: Harness, s: ClientSession, group: string): void => op(h, { op: "addMember", kind: "survivor", key: idOf(h, s), group });
const group = (h: Harness, name: string, chat: unknown): void => {
  op(h, { op: "addGroup", group: name });
  op(h, { op: "setChat", group: name, chat: JSON.stringify(chat) });
};

/** Puts `s` in Admins and signs it in, as its own password would. */
function signIn(h: Harness, s: ClientSession): void {
  add(h, s, "Admins");
  const c = h.client(s)!;
  c.signed = true;
  h.host.creative.stand(c);
}

/** The runs of the last line `to` was shown on `channel` after `s` said `words` there. */
function said(h: Harness, s: ClientSession, to: ClientSession, words: string, channel = TEXT_GLOBAL): readonly TextRun[] | undefined {
  const from = to.logVersion;
  s.chat(channel, words);
  h.run(300);
  return to.log.slice(to.log.length - (to.logVersion - from)).filter((l) => l.channel === channel).at(-1)?.runs;
}

/** The last notice `s` was sent. */
const notice = (s: ClientSession): string | undefined => s.log.filter((l) => l.channel === TEXT_NOTICE).at(-1)?.text;

const ADMIN_TAG = [{ text: "[Admin]", ink: RED }, { text: " " }];

test("with nothing set a line is the name and the words, as before", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  expect(said(h, bob, ada, "hello")).toEqual([{ text: "bob" }, { text: ": hello" }]);
  expect(said(h, ada, bob, "near", TEXT_LOCAL)).toEqual([{ text: "ada" }, { text: ": near" }]);
  expect(h.host.chat.recentLines().at(-1)).not.toHaveProperty("tags");
});

test("an admin who signed in speaks with a red [Admin] tag before their name", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  signIn(h, ada);
  expect(said(h, ada, bob, "hello")).toEqual([...ADMIN_TAG, { text: "ada" }, { text: ": hello" }]);
  const line = h.host.chat.recentLines().at(-1)!;
  expect(line.tags).toEqual(["Admins"]);
  expect(chatRows([{ ...line, tags: ["<b>Admins"] }])).toContain("[&#60;b&#62;Admins] <strong>ada</strong>");
});

test("an admin who has not signed in shows no tag", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  add(h, bob, "Admins");
  expect(said(h, bob, ada, "hello")).toEqual([{ text: "bob" }, { text: ": hello" }]);
  expect(h.say(bob, "disabletag Admins")).toEqual(["You have no tag called Admins."]);
});

test("an admin signed in with the map's password is tagged too", () => {
  const { h, ada } = camp({ cheats: false, host: { ...quiet, adminPassword: "hunter2" } });
  const bob = survivor(h, "bob", { cheats: false });
  expect(h.say(bob, "enablecheats hunter2")).toEqual(["cheats enabled"]);
  expect(said(h, bob, ada, "hello")).toEqual([...ADMIN_TAG, { text: "bob" }, { text: ": hello" }]);
});

test("a group's format colours its member's name and shows their tribe", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  group(h, "Vip", { ChatFormat: "{sender} {tribe}: {message}", FormattingParts: { sender: '<RichColor Color="0, 1, 0, 1">{name}</>', tribe: "[{name}]" } });
  add(h, bob, "Vip");
  expect(said(h, bob, ada, "no tribe yet")).toEqual([{ text: "bob", ink: GREEN }, { text: ": no tribe yet" }]);
  h.say(bob, "tribe create Owls");
  expect(said(h, bob, ada, "hello")).toEqual([{ text: "bob", ink: GREEN }, { text: " [Owls]: hello" }]);
});

test("the group with the highest priority gives the format", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  group(h, "Low", { ChatFormat: "<{sender}> {message}", Priority: 1 });
  group(h, "High", { ChatFormat: "{sender} says {message}", Priority: 5 });
  add(h, bob, "Low");
  expect(said(h, bob, ada, "one")).toEqual([{ text: "<" }, { text: "bob" }, { text: "> one" }]);
  add(h, bob, "High");
  expect(said(h, bob, ada, "two")).toEqual([{ text: "bob" }, { text: " says two" }]);
});

test("a survivor switches a tag off and on, and one that cannot be disabled stays", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  signIn(h, ada);
  expect(h.say(ada, "disabletag")).toEqual(["Your tags: Admins (shown)"]);
  expect(h.say(ada, "disabletag admins")).toEqual(["Your lines no longer show the tag Admins."]);
  expect(said(h, ada, bob, "quiet")).toEqual([{ text: "ada" }, { text: ": quiet" }]);
  expect(h.say(ada, "enabletag")).toEqual(["Your tags: Admins (hidden)"]);
  expect(h.say(ada, "enabletag Admins")).toEqual(["Your lines show the tag Admins."]);
  expect(said(h, ada, bob, "loud")).toEqual([...ADMIN_TAG, { text: "ada" }, { text: ": loud" }]);

  const vip = '<RichColor Color="0, 1, 0, 1">[VIP]</>';
  op(h, { op: "setDocument", name: "chat", text: JSON.stringify({ ChatTags: { Vip: { Text: vip, CanBeDisabled: false } } }) });
  op(h, { op: "addGroup", group: "Vip" });
  add(h, bob, "Vip");
  expect(h.say(bob, "disabletag Vip")).toEqual(["Your tag Vip cannot be switched off."]);
  expect(said(h, bob, ada, "still")).toEqual([{ text: "[VIP]", ink: GREEN }, { text: " " }, { text: "bob" }, { text: ": still" }]);
  expect(h.say(bob, "enabletag Admins")).toEqual(["You have no tag called Admins."]);
});

test("a member of the muted group cannot use global chat and can still use local", () => {
  const { h, ada, at } = camp({ host: quiet });
  const bob = survivor(h, "bob", { at: { x: at.x + 2, z: at.z } });
  op(h, { op: "addGroup", group: "Muted" });
  add(h, bob, "Muted");
  for (let i = 0; i < 6; i++) expect(said(h, bob, ada, `shout ${i}`)).toBeUndefined();
  expect(notice(bob)).toContain("You are muted");
  // The refused lines were not counted, so local chat has its whole allowance.
  for (let i = 0; i < 5; i++) expect(said(h, bob, ada, `near ${i}`, TEXT_LOCAL)).toEqual([{ text: "bob" }, { text: `: near ${i}` }]);
});

test("a timed mute ends by itself", () => {
  const clock = { ms: 1_800_000_000_000 };
  const { h, ada } = camp({ host: { ...quiet, survivorLog: { wall: () => clock.ms } } });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, { op: "addGroup", group: "Muted" });
  expect(h.host.exec(`Permissions.AddTimed ${idOf(h, bob)} Muted 1 0`)).toContain("Muted for 1 h");
  expect(said(h, bob, ada, "let me speak")).toBeUndefined();
  clock.ms += 61 * 60_000;
  h.run(200);
  expect(said(h, bob, ada, "free")).toEqual([{ text: "bob" }, { text: ": free" }]);
});

test("a change to a group's format shows on the next line said", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  group(h, "Vip", { ChatFormat: "{sender}: {message}" });
  add(h, bob, "Vip");
  expect(said(h, bob, ada, "before")).toEqual([{ text: "bob" }, { text: ": before" }]);
  op(h, { op: "setChat", group: "Vip", chat: JSON.stringify({ ChatFormat: "{sender} > {message}" }) });
  expect(said(h, bob, ada, "after")).toEqual([{ text: "bob" }, { text: " > after" }]);
  op(h, { op: "setChat", group: "Vip", chat: "{ not json" });
  expect(said(h, bob, ada, "broken")).toEqual([{ text: "bob" }, { text: ": broken" }]);
});

test("markup typed in a message stays as typed", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  group(h, "Vip", { ChatFormat: "{sender}: {message}", FormattingParts: { message: '<RichColor Color="0, 1, 0, 1">{message}</>' } });
  add(h, bob, "Vip");
  const typed = '<RichColor Color="1, 0, 0, 1">[Admin]</> {sender} {map}';
  expect(said(h, bob, ada, typed)).toEqual([{ text: "bob" }, { text: ": " }, { text: typed, ink: GREEN }]);
});

/** Two maps of a cluster on one folder, ada on the first and bob on the second, and a global line said on one and read on the other. */
function two(t: TestCluster) {
  const clock = { ms: 1_800_000_000_000 };
  const a = t.server("a", "f", clock, { host: quiet });
  const b = t.server("b", "f", clock, { host: quiet });
  const ada = t.survivor(a, "ada").session;
  const bob = t.survivor(b, "bob").session;
  const step = (): void => {
    clock.ms += POLL_MS;
    a.h.run(200);
    b.h.run(200);
  };
  /** The global lines `to` was shown after `s` on `from` said `words`. */
  const relayed = (from: Server, s: ClientSession, to: ClientSession, words: string): (readonly TextRun[])[] => {
    const mark = to.logVersion;
    s.chat(TEXT_GLOBAL, words);
    from.h.run(200);
    step();
    step();
    return to.log.slice(to.log.length - (to.logVersion - mark)).filter((l) => l.channel === TEXT_GLOBAL).map((l) => l.runs ?? []);
  };
  return { a, b, ada, bob, relayed };
}

test("a line sent to another map carries the map's name in the map's colour", () => {
  const t = new TestCluster();
  try {
    const { a, b, ada, bob, relayed } = two(t);
    for (const s of [a, b]) s.h.host.exec("setting ClusterChat True");
    const map = a.h.host.chat.mapName;
    expect(relayed(a, ada, bob, "hello")).toEqual([[{ text: `[${map}] ` }, { text: "ada" }, { text: ": hello" }]]);
    const colors = { [a.h.world.mapId.toUpperCase()]: [0, 0, 255] };
    op(a.h, { op: "setDocument", name: "chat", text: JSON.stringify({ MapColors: colors }) });
    a.h.run(200);
    expect(relayed(a, ada, bob, "blue")).toEqual([[{ text: `[${map}]`, ink: 0x0000ff }, { text: " " }, { text: "ada" }, { text: ": blue" }]]);
  } finally {
    t.cleanup();
  }
});

test("with ClusterChat off nothing is sent and nothing from another map is shown", () => {
  const t = new TestCluster();
  try {
    const { a, b, ada, bob, relayed } = two(t);
    const file = join(a.h.host.cluster!.folder.root, "chat", `${a.world}.jsonl`);
    expect(relayed(a, ada, bob, "into the void")).toEqual([]);
    expect(existsSync(file)).toBe(false);
    a.h.host.exec("setting ClusterChat True");
    expect(relayed(a, ada, bob, "unseen")).toEqual([]);
    expect(existsSync(file)).toBe(true);
    // The second map read on while it was off, so switching it on shows only what is said after.
    b.h.host.exec("setting ClusterChat True");
    expect(relayed(a, ada, bob, "seen").map((runs) => runs.map((r) => r.text).join(""))).toEqual([`[${a.h.host.chat.mapName}] ada: seen`]);
    const size = statSync(file).size;
    a.h.host.exec("setting ClusterChat False");
    expect(relayed(a, ada, bob, "kept home")).toEqual([]);
    expect(statSync(file).size).toBe(size);
    expect(relayed(b, bob, ada, "from b")).toEqual([]);
  } finally {
    t.cleanup();
  }
});
