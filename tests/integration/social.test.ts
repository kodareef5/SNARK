// Tribes and what survivors write to each other.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { LOCAL_RANGE } from "../../server/chat.ts";
import type { Source } from "../../server/combat.ts";
import { INVITE_TICKS, RANK_MEMBER, RANK_OWNER, REL_NONE, REL_OTHER, REL_SAME } from "../../server/tribes.ts";
import { CMD_CHAT, MAX_CHAT_CHARS, RESULT_BUSY, RESULT_DENIED, RESULT_INVALID, RESULT_OK, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-social-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const TICK_MS = 1000 / 30;
const APART = 1.5;

/** Survivors with cheats in a row on level ground, `APART` metres from one to the next, the first looking north at the second. */
function gather(names: string[], host = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const sessions = names.map((n) => h.join(n));
  h.run(600);
  for (const s of sessions) h.say(s, "enablecheats");
  const g = flatGround(h, 16, 24);
  const at = { x: g.x + 8, z: g.z + 4 };
  sessions.forEach((s, i) => h.say(s, `tp ${at.x.toFixed(3)} ${(at.z + i * APART).toFixed(3)}`));
  h.pilots[0]!.yaw = 0;
  h.run(300);
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  return { h, sessions, at, rec };
}

/** Swing once at whatever stands `APART` metres ahead, chest high. Returns the damage of the blow that landed, or -1 for none. */
function punch(h: Harness, pilot: Pilot): number {
  pilot.pitch = Math.atan2(1.25 - 1.62, APART);
  h.run(100);
  const before = h.host.combat.hits;
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 8);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(TICK_MS * (SWING_TICKS + 6));
  return h.host.combat.hits === before + 1 ? h.host.combat.last.damage : -1;
}

/** What a session has been told since `from`, on one channel. */
const heard = (s: ClientSession, channel: number, from = 0): string[] =>
  s.log
    .slice(Math.max(0, s.log.length - (s.logVersion - from)))
    .filter((l) => l.channel === channel)
    .map((l) => l.text);

test("a tribe: founded, joined face to face with everything the joiner owns, safe from its own, left with nothing, and passed on", () => {
  const { h, sessions, at, rec } = gather(["ada", "bob", "cy"]);
  const [ada, bob, cy] = sessions as [ClientSession, ClientSession, ClientSession];
  const tribes = h.host.tribes;
  const structs = h.world.structs;
  const [ra, rb, rc] = [rec(ada), rec(bob), rec(cy)];
  const [ta, tb, tc] = [ra.team, rb.team, rc.team];
  expect(new Set([0, ta, tb, tc]).size).toBe(4);
  expect([tribes.relation(ta, tb), tribes.relation(ta, ta), tribes.relation(0, ta), tribes.relation(0, 0)]).toEqual([REL_OTHER, REL_SAME, REL_NONE, REL_NONE]);
  expect([tribes.may(ra, ta), tribes.may(ra, tb), tribes.may(ra, 0), tribes.may(null, ta)]).toEqual([true, false, false, false]);
  expect(ada.tribe.team).toBe(ta);
  expect(ada.tribe.name).toBe("");

  // Alone, they can hurt each other.
  expect(punch(h, h.pilots[0]!)).toBeGreaterThan(0);
  // Bob builds something before he is in any tribe: it is his.
  h.pilots[1]!.yaw = Math.PI / 2;
  h.run(200);
  expect(h.say(bob, "place wall_thatch")[0]).toContain("placed core:wall_thatch");
  const owners = (): number[] => {
    const out: number[] = [];
    for (const t of structs.chunks) if (t) for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && t.owner[s] !== 0) out.push(t.owner[s]!);
    return out;
  };
  expect(owners()).toEqual([tb]);

  // Founding: the tribe is the founder's own team under a name.
  expect(h.say(ada, "tribe")[0]).toContain("You are in no tribe");
  expect(h.say(ada, "tribe create   ")[0]).toContain("1 to 24 characters");
  expect(h.say(ada, `tribe create ${"x".repeat(25)}`)[0]).toContain("1 to 24 characters");
  expect(h.say(ada, "tribe create Night  Shift")[0]).toBe("You founded Night Shift. Everything you own is the tribe's.");
  expect([ra.team, ra.rank]).toEqual([ta, RANK_OWNER]);
  expect(h.say(ada, "tribe create Another")[0]).toContain("in a tribe already");
  expect([ada.tribe.name, ada.tribe.rank]).toEqual(["Night Shift", RANK_OWNER]);
  expect(ada.tribe.members).toEqual([{ name: "ada", online: true, owner: true }]);

  // Inviting: by the owner, of someone here, face to face; and the one asked may say no.
  expect(h.say(bob, "tribe invite ada")[0]).toContain("you are not in a tribe");
  expect(h.say(ada, "tribe invite nobody")[0]).toContain('nobody called "nobody" is here');
  expect(h.say(ada, "tribe invite ada")[0]).toContain("in the tribe already");
  expect(h.say(bob, "tribe accept")[0]).toBe("nobody has invited you");
  h.say(cy, `tp ${(at.x + 5).toFixed(3)} ${(at.z + 30).toFixed(3)}`);
  expect(h.say(ada, "tribe invite cy")[0]).toContain("too far away");
  const before = bob.logVersion;
  expect(h.say(ada, "tribe invite BOB")[0]).toBe("You invited bob.");
  expect(heard(bob, TEXT_NOTICE, before)).toEqual(['ada invites you to join Night Shift. Type "tribe accept" or "tribe decline".']);
  expect([bob.tribe.invite, bob.tribe.inviteBy, bob.tribe.name]).toEqual(["Night Shift", "ada", ""]);
  expect(h.say(bob, "tribe")[1]).toContain("ada has invited you to join Night Shift");
  expect(h.say(bob, "tribe decline")[0]).toBe("You declined.");
  expect(bob.tribe.invite).toBe("");
  expect(h.say(bob, "tribe accept")[0]).toBe("nobody has invited you");
  // An invitation left unanswered runs out, and the one asked is shown that it has.
  h.say(ada, "tribe invite bob");
  expect(bob.tribe.invite).toBe("Night Shift");
  h.run((INVITE_TICKS / 30) * 1000 + 500);
  expect(bob.tribe.invite).toBe("");
  expect(h.say(bob, "tribe accept")[0]).toBe("nobody has invited you");

  // Joining: his team is the tribe's, and so is what he built.
  h.say(ada, "tribe invite bob");
  const told = ada.logVersion;
  expect(h.say(bob, "tribe accept")[0]).toBe("You joined Night Shift. Everything you owned is the tribe's.");
  expect([rb.team, rb.rank]).toEqual([ta, RANK_MEMBER]);
  expect(owners()).toEqual([ta]);
  expect(h.world.ents.team[h.ent(bob)]).toBe(ta);
  expect(heard(ada, TEXT_NOTICE, told)).toEqual(["bob joined Night Shift."]);
  for (const s of [ada, bob]) {
    expect(s.tribe.name).toBe("Night Shift");
    expect(s.tribe.team).toBe(ta);
    expect(s.tribe.members).toEqual([{ name: "ada", online: true, owner: true }, { name: "bob", online: true, owner: false }]);
  }
  expect(bob.tribe.rank).toBe(RANK_MEMBER);
  expect(h.say(ada, "tribe")).toEqual(["Night Shift: 2 members", "  ada  owner", "  bob"]);
  // Each sees the other as its own side.
  expect(tribes.may(rb, ta)).toBe(true);
  expect(h.say(bob, "tribe invite cy")[0]).toContain("only the tribe's owner");
  expect(h.say(bob, "tribe kick ada")[0]).toContain("only the tribe's owner");
  expect(h.say(bob, "tribe name Mine")[0]).toContain("only the tribe's owner");

  // Its own cannot hurt it: a blow lands and does nothing, to a member or to what the tribe built.
  const health = h.host.survival.value(rb, V_HEALTH);
  h.pilots[0]!.yaw = 0;
  expect(punch(h, h.pilots[0]!)).toBe(0);
  expect(h.host.survival.value(rb, V_HEALTH)).toBe(health);
  // Bob steps up to the wall he built, three metres east of where he stood, and swings at it.
  const wallHits = h.host.combat.structureHits;
  const swings = (): void => {
    h.pilots[1]!.yaw = Math.PI / 2;
    h.pilots[1]!.pitch = 0;
    h.pilots[1]!.buttons = BTN_PRIMARY;
    h.run(1500);
    h.pilots[1]!.buttons = 0;
    h.run(300);
  };
  h.say(bob, `tp ${(at.x + 1.7).toFixed(3)} ${(at.z + APART).toFixed(3)}`);
  swings();
  expect(h.host.combat.structureHits).toBe(wallHits);
  // A blast spares nobody: Ada's goes off between Bob and the wall and harms both, as it would harm her.
  const src: Source = { by: ra, x: at.x, z: at.z, item: 0, base: 30, type: DMG_EXPLOSIVE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  h.host.combat.blast(src, at.x + 2.2, h.world.ents.y[h.ent(bob)]! + 1, at.z + APART, 5);
  expect(h.host.survival.value(rb, V_HEALTH)).toBeLessThan(health);
  expect(rb.dead).toBe(false);
  expect(h.host.combat.structureHits).toBe(wallHits + 1);
  const blasted = h.host.combat.structureHits;
  h.host.survival.refill(rb);
  // Unless the server allows it.
  expect(h.say(ada, "rule friendlyFire 1")[0]).toContain("friendlyFire");
  swings();
  expect(h.host.combat.structureHits).toBeGreaterThan(blasted);
  h.say(bob, `tp ${at.x.toFixed(3)} ${(at.z + APART).toFixed(3)}`);
  expect(punch(h, h.pilots[0]!)).toBeGreaterThan(0);
  h.say(ada, "rule friendlyFire 0");

  // Someone leaving the game is shown as away; coming back, as here.
  bob.close();
  h.run(300);
  expect(ada.tribe.members[1]).toEqual({ name: "bob", online: false, owner: false });
  expect(h.say(ada, "tribe")[2]).toBe("  bob  away");
  const bob2 = h.join("bob");
  h.run(600);
  expect(ada.tribe.members[1]!.online).toBe(true);
  expect(bob2.tribe.name).toBe("Night Shift");

  // Renaming, and putting a member out: he is alone again with a team that owns nothing.
  expect(h.say(ada, "tribe name Day Shift")[0]).toBe("The tribe is now Day Shift.");
  expect(bob2.tribe.name).toBe("Day Shift");
  expect(h.say(ada, "tribe kick nobody")[0]).toContain("nobody called nobody is in Day Shift");
  expect(h.say(ada, "tribe kick ada")[0]).toBe("leave the tribe instead");
  expect(h.say(ada, "tribe kick Bob")[0]).toBe("Bob is out of the tribe.");
  expect(heard(bob2, TEXT_NOTICE).at(-1)).toBe("You were put out of Day Shift.");
  expect(new Set([0, ta, tb, tc, rb.team]).size).toBe(5);
  expect([bob2.tribe.name, bob2.tribe.team]).toEqual(["", rb.team]);
  expect(owners()).toEqual([ta]);
  expect(ada.tribe.members.length).toBe(1);

  // The owner leaving passes the tribe to whoever has been in it longest; the last one out ends it.
  h.say(bob2, `tp ${at.x.toFixed(3)} ${(at.z + APART).toFixed(3)}`);
  h.say(ada, "tribe invite bob");
  h.say(bob2, "tribe accept");
  expect(h.say(ada, "tribe leave")[0]).toBe("You left Day Shift. What you had there stays with the tribe.");
  expect(ra.team).not.toBe(ta);
  expect([tribes.byId.get(ta)!.owner, rb.rank, rb.team]).toEqual([rb.pid, RANK_OWNER, ta]);
  expect(bob2.tribe.members).toEqual([{ name: "bob", online: true, owner: true }]);
  expect(heard(bob2, TEXT_NOTICE).slice(-2)).toEqual(["Day Shift is yours now.", "ada left Day Shift."]);
  expect(ada.tribe.name).toBe("");
  expect(h.say(ada, "tribe leave")[0]).toBe("you are not in a tribe");
  expect(h.say(bob2, "tribe leave")[0]).toContain("You left Day Shift");
  expect(tribes.byId.size).toBe(0);
  // What it built keeps the tribe's number, which is nobody's now.
  expect(owners()).toEqual([ta]);
  expect([tribes.may(ra, ta), tribes.may(rb, ta)]).toEqual([false, false]);
  expect(h.host.items.audit()).toEqual([]);
});

test("tribes are part of the world: a restart keeps who is in which, whose it is, and its name", () => {
  const db = join(dir, "tribes.db");
  let { h, sessions, rec } = gather(["ada", "bob", "cy"], { dbPath: db });
  const [ada, bob, cy] = sessions as [ClientSession, ClientSession, ClientSession];
  h.say(ada, "tribe create The Long Table");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  h.say(ada, "tribe invite cy");
  h.say(cy, "tribe accept");
  // Ada leaves: it is Bob's, with Cy in it.
  h.say(ada, "tribe leave");
  const team = rec(bob).team;
  const alone = rec(ada).team;
  for (const s of sessions) s.close();
  h.run(200);
  h.host.shutdown();

  h = new Harness({}, 1, 60, { dev: true, dbPath: db });
  const tribe = h.host.tribes.byId.get(team)!;
  expect(tribe.name).toBe("The Long Table");
  const names = (pids: number[]) => pids.map((pid) => h.host.records.byPid.get(pid)!.name);
  expect(names(tribe.members)).toEqual(["bob", "cy"]);
  expect(names([tribe.owner])).toEqual(["bob"]);
  const cy2 = h.join("cy");
  const ada2 = h.join("ada");
  h.run(600);
  expect(cy2.tribe.name).toBe("The Long Table");
  expect(cy2.tribe.members).toEqual([{ name: "bob", online: false, owner: true }, { name: "cy", online: true, owner: false }]);
  expect([ada2.tribe.name, ada2.tribe.team]).toEqual(["", alone]);
  h.host.shutdown();
});

test("chat: everyone, those near, and the tribe each hear what is theirs to hear, and nothing they have muted", () => {
  const { h, sessions, at } = gather(["ada", "bob", "cy"]);
  const [ada, bob, cy] = sessions as [ClientSession, ClientSession, ClientSession];
  h.say(ada, "tribe create Night Shift");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  // Cy goes out of earshot; Bob stays beside Ada.
  h.say(cy, `tp ${at.x.toFixed(3)} ${(at.z + LOCAL_RANGE + 5).toFixed(3)}`);
  const marks = (): number[] => sessions.map((s) => s.logVersion);
  const since = (from: number[], channel: number): string[][] => sessions.map((s, i) => heard(s, channel, from[i]));
  // The answers to what was said, in order; answers to console lines are not counted.
  const codes: number[] = [];
  const asked = new Set<string>();
  sessions.forEach((s, i) => {
    s.onResult = (seq, code) => void (asked.has(`${i}:${seq}`) && codes.push(code));
    const chat = s.chat.bind(s);
    s.chat = (channel, words) => {
      const seq = chat(channel, words);
      asked.add(`${i}:${seq}`);
      return seq;
    };
  });

  let from = marks();
  ada.chat(TEXT_GLOBAL, "hello, island");
  h.run(300);
  expect(since(from, TEXT_GLOBAL)).toEqual([["ada: hello, island"], ["ada: hello, island"], ["ada: hello, island"]]);
  from = marks();
  ada.chat(TEXT_LOCAL, "anyone near?");
  h.run(300);
  expect(since(from, TEXT_LOCAL)).toEqual([["ada: anyone near?"], ["ada: anyone near?"], []]);
  // The range is from the speaker to each listener: a step nearer, Cy reaches Bob, who stands that much closer, and not Ada.
  h.say(cy, `tp ${at.x.toFixed(3)} ${(at.z + LOCAL_RANGE + 1).toFixed(3)}`);
  from = marks();
  cy.chat(TEXT_LOCAL, "I am");
  h.run(300);
  expect(since(from, TEXT_LOCAL)).toEqual([[], ["cy: I am"], ["cy: I am"]]);
  from = marks();
  bob.chat(TEXT_TRIBE, "the wall is up");
  h.run(300);
  expect(since(from, TEXT_TRIBE)).toEqual([["bob: the wall is up"], ["bob: the wall is up"], []]);
  // Nothing was said on a channel it was not said on.
  expect(since(from, TEXT_GLOBAL).flat().length + since(from, TEXT_LOCAL).flat().length).toBe(0);
  expect(codes).toEqual([RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK]);

  // A survivor in no tribe has nobody to say it to, and is told so.
  codes.length = 0;
  from = marks();
  cy.chat(TEXT_TRIBE, "hello?");
  h.run(300);
  expect(codes).toEqual([RESULT_DENIED]);
  expect(since(from, TEXT_NOTICE)[2]).toEqual(["You are not in a tribe."]);
  expect(since(from, TEXT_TRIBE).flat()).toEqual([]);

  // Muting: Bob stops hearing Ada on every channel; Ada still hears herself and Bob.
  expect(h.say(bob, "mute")[0]).toBe("You have muted nobody.");
  expect(h.say(bob, "mute bob")[0]).toBe("That is you.");
  expect(h.say(bob, "mute Ada")[0]).toBe("You will not hear Ada.");
  expect(h.say(bob, "mute ada")[0]).toBe("ada is muted already.");
  expect(h.say(bob, "mute")[0]).toBe("Muted: ada");
  from = marks();
  ada.chat(TEXT_GLOBAL, "one");
  ada.chat(TEXT_TRIBE, "two");
  bob.chat(TEXT_TRIBE, "three");
  h.run(300);
  expect(since(from, TEXT_GLOBAL)).toEqual([["ada: one"], [], ["ada: one"]]);
  expect(since(from, TEXT_TRIBE)).toEqual([["ada: two", "bob: three"], ["bob: three"], []]);
  expect(h.say(bob, "unmute ada")[0]).toBe("You will hear ada again.");
  expect(h.say(bob, "unmute ada")[0]).toBe("ada was not muted.");
  from = marks();
  ada.chat(TEXT_TRIBE, "four");
  h.run(300);
  expect(since(from, TEXT_TRIBE)[1]).toEqual(["ada: four"]);

  // A server may have no global channel: clients are told, and a line sent there is refused with the reason.
  expect([ada.globalChat, cy.globalChat]).toEqual([true, true]);
  h.say(ada, "rule globalChat 0");
  expect([ada.globalChat, cy.globalChat]).toEqual([false, false]);
  codes.length = 0;
  from = marks();
  cy.chat(TEXT_GLOBAL, "still there?");
  h.run(300);
  expect(codes).toEqual([RESULT_DENIED]);
  expect(since(from, TEXT_GLOBAL).flat()).toEqual([]);
  expect(since(from, TEXT_NOTICE)[2]![0]).toContain("no global channel");
  h.say(ada, "rule globalChat 1");
  // The dead may write; someone with no body, only watching, may write to everyone and to nobody else.
  h.run(5000);
  h.say(cy, "spectate");
  codes.length = 0;
  from = marks();
  cy.chat(TEXT_LOCAL, "boo");
  cy.chat(TEXT_GLOBAL, "watching");
  h.run(300);
  expect(codes).toEqual([RESULT_DENIED, RESULT_OK]);
  expect(since(from, TEXT_LOCAL).flat()).toEqual([]);
  expect(since(from, TEXT_GLOBAL)[0]).toEqual(["cy: watching"]);
});

test("chat is bounded: a few lines at once and then one every two seconds, lines cleaned and cut, and nothing a client sends does more", () => {
  const { h, sessions } = gather(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  let from = bob.logVersion;
  // Seven at once: five are said, two are refused, and the speaker is told why.
  const told = ada.logVersion;
  for (let i = 0; i < 7; i++) {
    ada.chat(TEXT_GLOBAL, `line ${i}`);
    h.run(TICK_MS * 2);
  }
  h.run(300);
  expect(codes).toEqual([RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK, RESULT_BUSY, RESULT_BUSY]);
  expect(heard(bob, TEXT_GLOBAL, from)).toEqual([0, 1, 2, 3, 4].map((i) => `ada: line ${i}`));
  expect(heard(ada, TEXT_NOTICE, told).length).toBe(2);
  // Two seconds earn one more; ten earn the whole burst back and no more than that.
  h.run(2100);
  codes.length = 0;
  ada.chat(TEXT_GLOBAL, "a");
  ada.chat(TEXT_GLOBAL, "b");
  h.run(300);
  expect(codes).toEqual([RESULT_OK, RESULT_BUSY]);
  h.run(60000);
  codes.length = 0;
  for (let i = 0; i < 6; i++) {
    ada.chat(TEXT_GLOBAL, `again ${i}`);
    h.run(TICK_MS * 2);
  }
  h.run(300);
  expect(codes).toEqual([RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK, RESULT_BUSY]);

  // What arrives is one clean line: no control characters, no runs of spaces, no more than the limit.
  h.run(12000);
  from = bob.logVersion;
  codes.length = 0;
  ada.command(CMD_CHAT, (w) => (w.bits(TEXT_GLOBAL, 3), w.string("  two\nlines\tand   a \u0007 bell  ")));
  ada.command(CMD_CHAT, (w) => (w.bits(TEXT_GLOBAL, 3), w.string("x".repeat(190))));
  // Nothing in it; a channel that is not one; the console's and the server's own channels; cut short.
  ada.command(CMD_CHAT, (w) => (w.bits(TEXT_GLOBAL, 3), w.string(" \n\t ")));
  ada.command(CMD_CHAT, (w) => (w.bits(7, 3), w.string("hello")));
  ada.command(CMD_CHAT, (w) => (w.bits(TEXT_NOTICE, 3), w.string("The server is closing.")));
  ada.command(CMD_CHAT, (w) => w.bits(TEXT_GLOBAL, 3));
  ada.command(CMD_CHAT);
  h.run(500);
  expect(codes).toEqual([RESULT_OK, RESULT_OK, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID]);
  expect(heard(bob, TEXT_GLOBAL, from)).toEqual(["ada: two lines and a bell", `ada: ${"x".repeat(MAX_CHAT_CHARS)}`]);
  expect(heard(bob, TEXT_NOTICE, from)).toEqual([]);
  // The client cuts what it sends to the same length.
  h.run(5000);
  from = bob.logVersion;
  ada.chat(TEXT_GLOBAL, "y".repeat(500));
  h.run(300);
  expect(heard(bob, TEXT_GLOBAL, from)).toEqual([`ada: ${"y".repeat(MAX_CHAT_CHARS)}`]);
  expect(ada.stats.undecodable + bob.stats.undecodable).toBe(0);
});
