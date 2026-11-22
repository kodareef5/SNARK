// The module contract: what a module hears, what it may refuse, and what happens when it misbehaves.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../server/settings/config.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { BOX_OPEN, BOX_SELF, CMD_CRAFT, CMD_DROP, CMD_LEARN, CMD_MOVE, CMD_NAME, CMD_ORDER, CMD_RESPAWN, CMD_SPEND, CMD_STRUCT, CMD_USE, ORDER_MATE, ORDER_STAY, REJECT_DENIED, REJECT_NAME, RESULT_DENIED, RESULT_OK, SESSION_ALIVE, SESSION_DEAD, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_USE } from "../../shared/sim/character.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Builder } from "../../client/core/build.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { NO_PIN, STRUCT_PICKUP, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { builder } from "../fixtures/build.ts";
import { nodesOf, standFacing } from "../fixtures/gather.ts";
import { takeInHand } from "../fixtures/gather.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { EVENTS, eventFaults, eventIndex } from "../../server/events/catalog.ts";
import { EVENTS_PAGE, eventsPage } from "../../tools/events.ts";
import { listener } from "../fixtures/module.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";

const SAY = eventIndex("chat.say");
const SAID = eventIndex("chat.said");
const quiet = { log: () => {} };

artTest("the event table is sound, its page is current, and an event said to be raised is raised where it says", () => {
  expect(eventFaults()).toEqual([]);
  expect(readFileSync(EVENTS_PAGE, "utf8")).toBe(eventsPage());
  for (const r of EVENTS.filter((e) => e.status === "wired")) {
    expect([r.name, readFileSync(join(import.meta.dir, "../..", r.at), "utf8").includes(`"${r.name}"`)]).toEqual([r.name, true]);
  }
});

test("a module loads, hears what is raised, and is told of its own loading on the first tick", () => {
  const a = listener("first", ["module.loaded", "chat.said"]);
  const h = new Harness({}, 1, 60, { modules: [a.def], ...quiet });
  expect(h.host.modules.names).toEqual(["first"]);
  expect(a.heard.lines).toEqual([]);
  h.run(100);
  expect(a.heard.lines).toEqual(['module.loaded: {"name":"first"}']);
  // An "after" event waits for the end of the tick. One nobody hears is not kept at all.
  h.host.bus.after(SAID, { pid: 7, channel: 0, text: "hello", heard: 3 });
  h.host.bus.after(eventIndex("level.up"), { pid: 7, from: 1, to: 2 });
  expect(a.heard.lines.length).toBe(1);
  h.run(100);
  expect(a.heard.lines[1]).toBe('chat.said: {"pid":7,"channel":0,"text":"hello","heard":3}');
  expect([h.host.bus.n[SAID], h.host.bus.n[SAY], h.host.bus.n[eventIndex("level.up")]]).toEqual([1, 0, 0]);
});

test("a before event runs by priority, may be changed, and ends at the first refusal", () => {
  const low = listener("low", [["chat.say", { priority: -5 }]]);
  const high = listener("high", [["chat.say", { priority: 10 }]]);
  const mid = listener("mid", ["chat.say"]);
  const h = new Harness({}, 1, 60, { modules: [low.def, high.def, mid.def], ...quiet });
  const order: string[] = [];
  high.heard.each = (e) => {
    order.push("high");
    e.data.text = String(e.data.text).toUpperCase();
  };
  mid.heard.each = () => void order.push("mid");
  low.heard.each = () => void order.push("low");
  const data = { pid: 1, channel: 0, text: "hello" };
  expect(h.host.bus.before(SAY, data)).toBe("");
  expect([order, data.text]).toEqual([["high", "mid", "low"], "HELLO"]);
  // The second refuses. The third is never asked.
  order.length = 0;
  mid.heard.each = (e) => {
    order.push("mid");
    e.refuse("not here");
    e.refuse("nor there");
  };
  expect(h.host.bus.before(SAY, { pid: 1, channel: 0, text: "again" })).toBe("not here");
  expect([order, h.host.bus.refusedBy]).toEqual([["high", "mid"], "mid"]);
});

test("a handler that throws is contained: no opinion, or a refusal if it asked for that, and off after eight in a row", () => {
  const said: string[] = [];
  const shaky = listener("shaky", ["chat.say"]);
  const strict = listener("strict", [["name.set", { onError: "refuse" }]]);
  const watch = listener("watch", ["module.failed"]);
  const h = new Harness({}, 1, 60, { modules: [shaky.def, strict.def, watch.def], log: (line) => void said.push(line) });
  const bus = h.host.bus;
  let fail = true;
  shaky.heard.each = () => {
    if (fail) throw new Error("oops");
  };
  strict.heard.each = () => {
    throw new Error("cannot say");
  };
  expect(bus.before(SAY, { pid: 1, channel: 0, text: "x" })).toBe("");
  expect(bus.before(eventIndex("name.set"), { what: "tribe", text: "x" })).toBe("strict could not decide");
  expect(said[0]).toBe("module shaky threw in chat.say: oops");
  // A good call between failures starts the count again.
  for (let n = 0; n < 6; n++) bus.before(SAY, { pid: 1, channel: 0, text: "x" });
  fail = false;
  bus.before(SAY, { pid: 1, channel: 0, text: "x" });
  fail = true;
  for (let n = 0; n < 7; n++) bus.before(SAY, { pid: 1, channel: 0, text: "x" });
  expect(bus.stats().find((s) => s.module === "shaky")!.off).toBe(false);
  bus.before(SAY, { pid: 1, channel: 0, text: "x" });
  expect(bus.stats().find((s) => s.module === "shaky")).toMatchObject({ event: "chat.say", calls: 16, off: true });
  const calls = shaky.heard.lines.length;
  expect(bus.before(SAY, { pid: 1, channel: 0, text: "x" })).toBe("");
  expect(shaky.heard.lines.length).toBe(calls);
  h.run(100);
  expect(watch.heard.lines).toEqual(['module.failed: {"name":"shaky","event":"chat.say"}']);
  expect(h.host.exec("modules")).toContain("shaky chat.say: 16 calls");
});

test("a module adds commands and timers, acts through what it is given, and cannot reach past setup", () => {
  const ran: string[] = [];
  const m = listener("tools", [], (c) => {
    c.command({ name: "Greet", usage: "<name>", help: "Say hello.", admin: false, run: (by, args) => `hello ${args[0]} from ${by.name}${by.operator ? " (operator)" : ` #${by.pid > 0}`}` });
    c.command({ name: "shout", usage: "<words>", help: "Tell everyone.", admin: true, run: (_by, args) => (c.act.broadcast(args.join(" ")), "shouted") });
    c.after(3, () => void ran.push(`once at ${c.world.tick}`));
    const beat = c.every(10, () => void ran.push(`beat at ${c.world.tick}`));
    c.after(25, () => c.cancel(beat));
    c.every(7, () => {
      throw new Error("a timer of mine");
    });
  });
  const said: string[] = [];
  const h = new Harness({}, 1, 60, { modules: [m.def], dev: true, log: (line) => void said.push(line) });
  const ada = h.join("ada");
  h.run(1200);
  expect(ran.filter((r) => r.startsWith("once")).length).toBe(1);
  expect(ran.filter((r) => r.startsWith("beat")).length).toBe(2);
  expect(said.filter((l) => l.includes("threw in a timer: a timer of mine")).length).toBeGreaterThan(2);
  expect(h.host.exec("greet bob")).toBe("hello bob from (operator) (operator)");
  expect(h.say(ada, "greet bob")).toEqual(["hello bob from ada #true"]);
  expect(h.say(ada, "shout fire")[0]).toContain("denied");
  h.say(ada, "enablecheats");
  expect(h.say(ada, "shout fire in the hold")).toEqual(["fire in the hold", "shouted"]);
  expect(m.heard.context!.world.online()).toEqual([{ pid: h.client(ada)!.pid, name: "ada" }]);
  m.heard.context!.act.tell(h.client(ada)!.pid, "only you");
  h.run(100);
  expect(ada.log[ada.log.length - 1]!.text).toBe("only you");
  // Setup is over.
  expect(() => m.heard.context!.on("chat.say", () => {})).toThrow("handlers are added in setup");
  expect(() => m.heard.context!.command({ name: "late", usage: "", help: "", admin: false, run: () => "" })).toThrow("commands are added in setup");
});

test("a module that cannot be loaded stops the server from starting, and says why", () => {
  const start = (...modules: ModuleDef[]) => () => new Harness({}, 1, 60, { modules, ...quiet });
  const ok = listener("ok", []).def;
  expect(start(listener("nosuch", ["tribe.exploded"]).def)).toThrow('nosuch: there is no event "tribe.exploded"');
  expect(start(listener("clash", [], (c) => c.command({ name: "save", usage: "", help: "", admin: false, run: () => "" })).def)).toThrow('module clash: there is already a command "save"');
  expect(start(ok, ok)).toThrow("module ok is loaded twice");
  expect(start({ ...ok, name: "Bad Name" })).toThrow("lower-case letters");
  expect(start({ ...ok, api: 2 as 1 })).toThrow("written for version 2");
  expect(start({ ...ok, name: "needy", needs: ["ok"] })).toThrow("needs ok, which is not loaded before it");
  expect(start(ok, { ...ok, name: "needy", needs: ["ok"] })).not.toThrow();
});

const dir = mkdtempSync(join(tmpdir(), "snark-modules-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
/** The events of these groups that the table says are raised. */
const wiredOf = (...groups: string[]): string[] => EVENTS.filter((e) => e.status === "wired" && groups.includes(e.name.split(".")[0]!)).map((e) => e.name);
const names = (lines: readonly string[]): string[] => [...new Set(lines.map((l) => l.slice(0, l.indexOf(":"))))].sort();

test("a played script raises every wired event of the server, its sessions, chat, commands and tribes, with what happened in each", () => {
  const wired = wiredOf("server", "command", "session", "chat", "name", "tribe");
  expect(wired.length).toBe(28);
  const all = listener("all", wired);
  const made = loadConfig({ gus: "[ServerSettings]\nAutoSavePeriodMinutes=0.1", game: "" });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  const h = new Harness({}, 1, 60, { modules: [all.def], dev: true, dbPath: join(dir, "script.db"), backups: true, config: made.rules, ...quiet });
  const said = (name: string): string[] => all.heard.lines.filter((l) => l.startsWith(`${name}: `)).map((l) => l.slice(name.length + 2));
  const last = (name: string): Record<string, unknown> => JSON.parse(said(name).pop()!);

  const ada = h.join("ada");
  h.run(600);
  const adaPid = h.client(ada)!.pid;
  expect(JSON.parse(said("server.start")[0]!)).toMatchObject({ fresh: true });
  expect(said("name.set")).toEqual(['{"what":"survivor","text":"ada"}']);
  expect(last("session.login")).toMatchObject({ name: "ada", isNew: true });
  expect(said("session.join")).toEqual([`{"pid":${adaPid},"name":"ada","isNew":true}`]);
  expect(said("session.spawn")).toEqual([`{"pid":${adaPid},"first":true,"why":"made"}`]);
  expect(said("server.tick").length).toBeGreaterThan(10);

  // A password is not told to a module, and neither is what follows a secret command's name.
  expect(h.say(ada, "enablecheats hunter2")).toEqual(["cheats enabled"]);
  expect(last("command")).toEqual({ byPid: adaPid, name: "enablecheats", line: "enablecheats", source: "session" });
  expect(said("session.admin")).toEqual([`{"pid":${adaPid}}`]);
  ada.chat(TEXT_GLOBAL, "hello there");
  h.run(200);
  expect(last("chat.say")).toEqual({ pid: adaPid, channel: TEXT_GLOBAL, text: "hello there" });
  expect(last("chat.said")).toEqual({ pid: adaPid, channel: TEXT_GLOBAL, text: "hello there", heard: 1 });

  expect(h.say(ada, "tribe create Night Shift")[0]).toContain("You founded Night Shift");
  const team = h.host.records.byPid.get(adaPid)!.team;
  expect(last("tribe.created")).toEqual({ pid: adaPid, team, name: "Night Shift" });
  const bob = h.join("bob");
  h.run(600);
  const bobPid = h.client(bob)!.pid;
  h.say(bob, "enablecheats");
  const e = h.world.ents;
  h.say(bob, `tp ${(e.x[h.ent(ada)]! + 1).toFixed(2)} ${e.z[h.ent(ada)]!.toFixed(2)}`);
  h.say(ada, "tribe invite bob");
  expect(last("tribe.invite")).toEqual({ byPid: adaPid, pid: bobPid });
  h.say(bob, "tribe accept");
  expect([last("tribe.join"), last("tribe.joined")]).toEqual([{ pid: bobPid, team }, { pid: bobPid, team }]);
  h.say(ada, "tribe name Day Shift");
  expect(last("tribe.renamed")).toEqual({ team, name: "Day Shift" });
  h.say(ada, "tribe kick bob");
  expect(last("tribe.leave")).toEqual({ team, pid: bobPid, why: "put out", heir: 0, disbanded: false });
  // The owner leaves a tribe of one, and it is gone.
  h.say(ada, "tribe leave");
  expect(last("tribe.leave")).toEqual({ team, pid: adaPid, why: "left", heir: 0, disbanded: true });

  // Bob dies and comes back at the first spawn point.
  h.say(bob, "suicide");
  h.run(500);
  expect(bob.sessionState).toBe(SESSION_DEAD);
  bob.command(CMD_RESPAWN, (w) => (w.u8(0), w.u8(bob.placesList)));
  h.run(800);
  expect(bob.sessionState).toBe(SESSION_ALIVE);
  expect(last("session.respawn")).toEqual({ pid: bobPid, bed: -1, wait: 0 });
  expect(last("session.spawn")).toEqual({ pid: bobPid, first: false, why: "respawned" });

  // His connection drops and his body lingers. Then he is put out.
  bob.close();
  h.run(500);
  expect(last("session.presence")).toEqual({ pid: bobPid, connected: false });
  expect(h.host.exec("kick ada")).toContain("ada");
  // A body lingers five seconds after its connection closes, and the session ends when it goes.
  h.run(6000);
  expect(last("session.leave")).toEqual({ pid: adaPid, why: "kicked" });
  expect(said("session.leave").length).toBe(2);

  // A third arrives with no look and makes one. Until then it has no body, and no module has heard of a survivor.
  const cy = h.join("cy", {}, { look: null });
  h.run(500);
  expect(said("session.join").length).toBe(2);
  cy.create(defaultLook());
  h.run(600);
  expect(said("session.create")).toEqual(['{"name":"cy"}']);
  expect(last("session.join")).toMatchObject({ name: "cy", isNew: true });

  // A setting changes, the disk fills and empties, a backup is asked for, and the server stops.
  expect(h.host.exec("setting XPMultiplier 3")).toContain("XPMultiplier");
  h.run(200);
  expect(said("server.settings").length).toBe(1);
  const store = h.host.persistence!.store;
  const real = store.transaction.bind(store);
  h.host.persistence!.onMoved = null;
  store.transaction = () => {
    throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
  };
  h.run(1000);
  expect(last("server.saveFailed")).toMatchObject({ code: "SQLITE_FULL" });
  store.transaction = real;
  h.run(6000);
  expect(said("server.saved").length).toBe(1);
  expect(JSON.parse(said("server.save")[0]!).folder).toBe(`${join(dir, "script.db")}.backups`);
  h.host.shutdown();
  expect(said("server.stop")).toEqual(['{"why":"stopped"}']);

  // Every wired event of these groups was heard, and each is one of them.
  expect(names(all.heard.lines)).toEqual([...wired].sort());
});

test("what a module refuses does not happen, and what it changes is what happens", () => {
  const gate = listener("gate", ["session.login", "name.set", "session.create", "session.respawn", "chat.say", "chat.said", "command", "tribe.create", "tribe.invite", "tribe.join"]);
  const h = new Harness({}, 1, 60, { modules: [gate.def], dev: true, ...quiet });
  let rule: (e: Parameters<NonNullable<typeof gate.heard.each>>[0]) => void = () => {};
  gate.heard.each = (e) => rule(e);

  // A login turned away has no body and no record, and a name turned away is told so.
  rule = (e) => {
    if (e.name === "session.login" && e.data.name === "mallory") e.refuse("not you");
    if (e.name === "name.set" && e.data.text === "admin") e.refuse("not that name");
  };
  const mallory = h.join("mallory");
  const admin = h.join("admin");
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  expect([mallory.state, mallory.closeReason, admin.closeReason, ada.state]).toEqual(["closed", REJECT_DENIED, REJECT_NAME, "active"]);
  expect([...h.host.records.byPid.values()].map((r) => r.name).sort()).toEqual(["ada", "bob"]);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");

  // A line is reworded for everyone, or not said at all.
  rule = (e) => {
    if (e.name === "chat.say") e.data.text = String(e.data.text).replace("darn", "****");
    if (e.name === "chat.say" && String(e.data.text).includes("spam")) e.refuse("No advertising here.");
  };
  ada.chat(TEXT_GLOBAL, "darn it");
  h.run(200);
  expect(bob.log[bob.log.length - 1]!.text).toBe("ada: **** it");
  const heard = bob.log.length;
  ada.chat(TEXT_GLOBAL, "buy spam");
  h.run(200);
  expect([bob.log.length, ada.log[ada.log.length - 1]!.text]).toEqual([heard, "No advertising here."]);
  expect(gate.heard.lines.filter((l) => l.startsWith("chat.said")).length).toBe(1);

  // A command refused does not run, and says why.
  rule = (e) => {
    if (e.name === "command" && e.data.name === "give") e.refuse("no gifts today");
  };
  expect(h.say(ada, "give stone 5")).toEqual(["denied: no gifts today"]);
  expect(h.host.records.byPid.get(h.client(ada)!.pid)!.inv!.total(h.reg.index.get("core:stone")!)).toBe(0);

  // A tribe gets the name a module gives it. An invitation and a joining may each be refused.
  rule = (e) => {
    if (e.name === "tribe.create") e.data.name = `[EU] ${String(e.data.name)}`;
    if (e.name === "tribe.invite") e.refuse("no recruiting during a raid");
  };
  h.say(ada, "tribe create Owls");
  expect([...h.host.tribes.byId.values()].map((t) => t.name)).toEqual(["[EU] Owls"]);
  const e = h.world.ents;
  h.say(bob, `tp ${(e.x[h.ent(ada)]! + 1).toFixed(2)} ${e.z[h.ent(ada)]!.toFixed(2)}`);
  expect(h.say(ada, "tribe invite bob")[0]).toContain("no recruiting during a raid");
  rule = (e) => {
    if (e.name === "tribe.join") e.refuse("the tribe is frozen");
  };
  h.say(ada, "tribe invite bob");
  expect(h.say(bob, "tribe accept")[0]).toContain("the tribe is frozen");
  expect([...h.host.tribes.byId.values()][0]!.members.length).toBe(1);

  // A respawn refused leaves the survivor dead.
  rule = (e) => {
    if (e.name === "session.respawn") e.refuse("the arena is closed");
  };
  h.say(bob, "suicide");
  h.run(500);
  const codes: number[] = [];
  bob.onResult = (_seq, code) => void codes.push(code);
  bob.command(CMD_RESPAWN, (w) => (w.u8(0), w.u8(bob.placesList)));
  h.run(500);
  expect([codes, bob.sessionState]).toEqual([[RESULT_DENIED], SESSION_DEAD]);
  rule = () => {};
  bob.command(CMD_RESPAWN, (w) => (w.u8(0), w.u8(bob.placesList)));
  h.run(800);
  expect(bob.sessionState).toBe(SESSION_ALIVE);
});

/** Two survivors with cheats, a metre apart on level ground, facing each other. */
function duel(modules: ModuleDef[]) {
  const h = new Harness({}, 1, 60, { modules, dev: true, ...quiet });
  const [ada, bob] = [h.join("ada"), h.join("bob")];
  h.run(600);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 24, 40);
  h.say(ada, `tp ${(g.x + 12).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  h.say(bob, `tp ${(g.x + 12).toFixed(3)} ${(g.z + 3.1).toFixed(3)}`);
  h.pilots[0]!.yaw = 0;
  h.pilots[1]!.yaw = Math.PI;
  h.run(300);
  const rec = (s: typeof ada) => h.host.records.byPid.get(h.client(s)!.pid)!;
  const health = (s: typeof ada): number => h.host.survival.value(rec(s), V_HEALTH);
  /** Ada throws punches at Bob for `ms`. */
  const punch = (ms: number): void => {
    h.pilots[0]!.buttons |= BTN_PRIMARY;
    h.run(ms);
    h.pilots[0]!.buttons &= ~BTN_PRIMARY;
    h.run(400);
  };
  return { h, ada, bob, rec, health, punch };
}

test("a module hears each blow, each death and what a body earns, and may scale a blow, stop it, and change what is earned", () => {
  const wired = wiredOf("damage", "damaged", "death", "body", "projectile", "xp", "level", "stat", "engram");
  expect(wired).toEqual(["damage", "damaged", "death", "death.cache", "body.out", "projectile.hit", "xp.gain", "level.up", "stat.spend", "engram.learn"]);
  const all = listener("all", wired);
  const { h, ada, bob, rec, health, punch } = duel([all.def]);
  let rule: (e: Parameters<NonNullable<typeof all.heard.each>>[0]) => void = () => {};
  all.heard.each = (e) => rule(e);
  const said = (name: string): Record<string, unknown>[] => all.heard.lines.filter((l) => l.startsWith(`${name}: `)).map((l) => JSON.parse(l.slice(name.length + 2)));
  const [adaPid, bobPid] = [rec(ada).pid, rec(bob).pid];

  // A punch lands whole.
  punch(600);
  const blows = said("damaged");
  expect(blows.length).toBeGreaterThan(0);
  expect(blows[0]).toMatchObject({ target: "body", victim: bobPid, kind: "core:survivor", byPid: adaPid, item: "", type: "melee", killed: false });
  expect(said("damage")[0]).toMatchObject({ target: "body", victim: bobPid, byPid: adaPid, type: "melee", scale: 1 });
  const whole = blows[0]!.taken as number;
  expect(whole).toBeGreaterThan(1);
  expect(Math.abs((blows[blows.length - 1]!.left as number) - health(bob))).toBeLessThan(1);
  expect(blows[0]!.left).toBe(100 - whole);

  // A module halves every blow, and then stops them all.
  rule = (e) => {
    if (e.name === "damage") e.data.scale = 0.5;
  };
  const n = said("damaged").length;
  punch(600);
  expect(said("damaged")[n]!.taken as number).toBeCloseTo(whole / 2, 1);
  rule = (e) => {
    if (e.name === "damage") e.refuse("this is a safe zone");
  };
  const before = health(bob);
  const told = said("damaged").length;
  punch(900);
  expect(health(bob)).toBeGreaterThanOrEqual(before);
  expect(said("damaged").slice(told).every((d) => d.taken === 0)).toBe(true);

  // A fall is a blow with nobody behind it.
  rule = () => {};
  h.host.survival.landed(rec(ada), 16);
  expect(said("damage").pop()).toMatchObject({ victim: adaPid, byPid: 0, type: "fall" });
  expect([health(ada) < 100, rec(ada).dead]).toEqual([true, false]);

  // Experience may be changed as it is earned, a level gained is told, and a point or an engram may be refused.
  rule = (e) => {
    if (e.name === "xp.gain" && e.data.source === "given") e.data.amount = Number(e.data.amount) * 2;
  };
  h.say(ada, "addxp 60");
  // The module was asked about 60, and doubled it.
  expect(said("xp.gain").pop()).toEqual({ pid: adaPid, source: "given", amount: 60 });
  expect(rec(ada).xp).toBe(120);
  const up = said("level.up").pop()!;
  expect([up.pid, up.from, (up.to as number) > (up.from as number)]).toEqual([adaPid, 1, true]);
  const codes: number[] = [];
  ada.onResult = (_seq, code) => void codes.push(code);
  rule = (e) => {
    if (e.name === "stat.spend" || e.name === "engram.learn") e.refuse("not during the event");
  };
  const spear = h.reg.index.get("core:engram-spear")!;
  ada.command(CMD_SPEND, (w) => w.u8(STAT_NAMES.indexOf("health")));
  ada.command(CMD_LEARN, (w) => w.u16(spear));
  h.run(400);
  expect([codes, rec(ada).engrams.includes(spear)]).toEqual([[RESULT_DENIED, RESULT_DENIED], false]);
  expect([said("stat.spend").pop(), said("engram.learn").pop()]).toEqual([{ pid: adaPid, stat: "health" }, { pid: adaPid, engram: "core:engram-spear" }]);
  rule = () => {};
  codes.length = 0;
  ada.command(CMD_SPEND, (w) => w.u8(STAT_NAMES.indexOf("health")));
  ada.command(CMD_LEARN, (w) => w.u16(spear));
  h.run(400);
  expect([codes, rec(ada).engrams.includes(spear)]).toEqual([[RESULT_OK, RESULT_OK], true]);

  // Bob carries stone and has little health left. Ada's punch kills him. A module has him keep what he carried.
  h.say(bob, "give stone 9");
  h.say(bob, `hurt ${(health(bob) - 2).toFixed(1)}`);
  rule = (e) => {
    if (e.name === "death.cache") e.data.keep = true;
  };
  const xpBefore = rec(ada).xp;
  punch(900);
  expect(rec(bob).dead).toBe(true);
  expect(said("death").pop()).toMatchObject({ victim: bobPid, kind: "core:survivor", cause: "killed", killer: adaPid, rider: 0, credit: adaPid, item: "" });
  expect(said("damaged").pop()).toMatchObject({ victim: bobPid, killed: true, left: 0 });
  expect(said("death.cache").pop()).toEqual({ pid: bobPid, keep: false });
  expect(rec(bob).inv!.total(h.reg.index.get("core:stone")!)).toBe(9);
  expect(said("xp.gain").pop()).toMatchObject({ pid: adaPid, source: "kill" });
  expect(rec(ada).xp).toBeGreaterThan(xpBefore);

  // Ada is knocked out.
  h.say(ada, "hurt 0 100000");
  h.run(300);
  expect(said("body.out").pop()).toEqual({ pid: adaPid, out: true });
  // Every event of these groups but an arrow's was heard. The arrow is in the next test.
  expect(names(all.heard.lines)).toEqual(wired.filter((w) => w !== "projectile.hit").sort());
});

test("an arrow that strikes is told of, with who loosed it, what it was and whom it struck", () => {
  const all = listener("all", ["projectile.hit", "damaged"]);
  const { h, ada, bob, rec } = duel([all.def]);
  // Three metres apart, so the arrow flies before it lands.
  const e = h.world.ents;
  h.say(bob, `tp ${e.x[h.ent(ada)]!.toFixed(3)} ${(e.z[h.ent(ada)]! + 3).toFixed(3)}`);
  h.say(ada, "kit bow");
  takeInHand(h, ada, h.reg.index.get("core:bow")!);
  h.pilots[0]!.buttons |= BTN_PRIMARY;
  h.run(1500);
  h.pilots[0]!.buttons &= ~BTN_PRIMARY;
  h.run(600);
  const struck = all.heard.lines.filter((l) => l.startsWith("projectile.hit"));
  expect(struck).toEqual([`projectile.hit: {"byPid":${rec(ada).pid},"ammo":"core:arrow_stone","target":${rec(bob).pid}}`]);
  const blow = JSON.parse(all.heard.lines.find((l) => l.startsWith("damaged"))!.slice(9));
  expect(blow).toMatchObject({ victim: rec(bob).pid, byPid: rec(ada).pid, item: "core:bow", type: "pierce" });
});

test("a module hears what is built, opened, made, moved and gathered, and may refuse each or change how much", () => {
  const wired = wiredOf("build", "structure", "item", "container", "craft", "harvest");
  expect(wired.length).toBe(13);
  const all = listener("all", wired);
  const { h, sessions, hold, act, has, structs } = builder(["ada", "bob"], 40, 40, { modules: [all.def], ...quiet });
  const [ada, bob] = sessions as [(typeof sessions)[0], (typeof sessions)[0]];
  let rule: (e: Parameters<NonNullable<typeof all.heard.each>>[0]) => void = () => {};
  all.heard.each = (e) => rule(e);
  const said = (name: string): Record<string, unknown>[] => all.heard.lines.filter((l) => l.startsWith(`${name}: `)).map((l) => JSON.parse(l.slice(name.length + 2)));
  const rec = (c: typeof ada) => h.host.records.byPid.get(h.client(c)!.pid)!;
  const [adaPid, bobPid] = [rec(ada).pid, rec(bob).pid];
  const item = (name: string): number => h.reg.index.get(`core:${name}`)!;
  const codes: number[] = [];
  ada.onResult = (_seq, code) => void codes.push(code);
  const result = (): number => {
    h.run(200);
    return codes.pop() ?? -1;
  };
  /** Sets down the foundation in `c`'s hand five metres ahead, as the client does. Returns the result code. */
  const found = (c: typeof ada, pilot: number): number => {
    hold(c, "foundation");
    h.pilots[pilot]!.yaw = pilot === 0 ? 0 : Math.PI;
    h.pilots[pilot]!.pitch = Math.atan2(-1.62, 5);
    h.run(100);
    const b = new Builder();
    const dir = [0, 0, 0];
    lookDirection(Math.round((h.pilots[pilot]!.yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((h.pilots[pilot]!.pitch / (Math.PI / 2)) * 16384), dir);
    b.update(c, c.world!, h.reg, c.own.x, c.own.y + stanceEye(h.reg.move[c.ownKind]!, c.own.stance), c.own.z, dir[0]!, dir[1]!, dir[2]!, h.pilots[pilot]!.yaw, 0);
    let code = -1;
    c.onResult = (_seq, got) => void (code = got);
    b.place(c, h.reg);
    h.run(200);
    c.onResult = c === ada ? (_seq, got) => void codes.push(got) : null;
    return code;
  };

  // A module refuses the first piece, and the piece stays in the hand.
  rule = (e) => {
    if (e.name === "build.place") e.refuse("no building in the plaza");
  };
  const built = structs.count;
  expect([found(ada, 0), structs.count, ada.log[ada.log.length - 1]!.text]).toEqual([RESULT_DENIED, built, "no building in the plaza"]);
  rule = () => {};
  expect(found(ada, 0)).toBe(RESULT_OK);
  const ref = h.host.build.last;
  expect(said("build.place").pop()).toMatchObject({ byPid: adaPid, team: rec(ada).team, kind: "core:foundation_wood", target: 0xffffffff });
  expect(said("build.placed").pop()).toEqual({ byPid: adaPid, ref, kind: "core:foundation_wood" });

  // Picking it up may be refused. When it is not, the piece is gone and is back in the hand, which is a stack made.
  rule = (e) => {
    if (e.name === "structure.act") e.refuse("this base is under protection");
  };
  expect([act(ada, ref, STRUCT_PICKUP), structs.count]).toEqual([RESULT_DENIED, built + 1]);
  rule = () => {};
  expect(act(ada, ref, STRUCT_PICKUP)).toBe(RESULT_OK);
  expect(said("structure.act").pop()).toEqual({ byPid: adaPid, ref, action: "pickup" });
  expect(said("structure.gone").pop()).toEqual({ ref, kind: "core:foundation_wood", team: rec(ada).team, cause: "taken", byPid: adaPid });
  expect(said("item.gain").pop()).toEqual({ pid: adaPid, item: "core:piece_foundation_wood", why: "", n: 1 });
  // A piece that is destroyed has nobody's name on its going.
  expect(found(ada, 0)).toBe(RESULT_OK);
  structs.damage(h.host.build.last, 1e9, h.world.tick);
  h.run(100);
  expect(said("structure.gone").pop()).toMatchObject({ cause: "destroyed", byPid: 0 });

  // A stack given by an admin may be made larger, or not made.
  rule = (e) => {
    if (e.name === "item.gain" && e.data.item === "core:stone") e.data.n = Number(e.data.n) * 2;
    if (e.name === "item.gain" && e.data.item === "core:flint") e.refuse("none of that here");
  };
  h.say(ada, "give stone 5");
  h.say(ada, "give flint 5");
  expect(said("item.gain").filter((g) => g.item === "core:stone").pop()).toEqual({ pid: adaPid, item: "core:stone", why: "given", n: 5 });
  expect([has(ada, "stone"), has(ada, "flint")]).toEqual([10, 0]);
  rule = () => {};

  // A box is opened, unless a module says not, and a stack is put in it, unless a module says not.
  h.say(ada, "place storage_box");
  const boxRef = [...Array(structs.chunks.length).keys()].flatMap((chunk) => {
    const t = structs.chunks[chunk];
    return t ? [...Array(t.high).keys()].filter((k) => t.kind[k] === item("storage_box")).map((k) => chunk * 65536 + k) : [];
  })[0]!;
  rule = (e) => {
    if (e.name === "container.open") e.refuse("it is sealed");
  };
  const open = (): number => {
    ada.command(CMD_STRUCT, (w) => (w.u32(boxRef), w.u8(STRUCT_USE), w.u16(NO_PIN)));
    return result();
  };
  expect([open(), h.client(ada)!.open]).toEqual([RESULT_DENIED, 0]);
  rule = () => {};
  expect(open()).toBe(RESULT_OK);
  const boxPid = h.client(ada)!.open;
  expect(said("container.open").pop()).toEqual({ byPid: adaPid, pid: boxPid });
  const stoneAt = (): number => ada.inventory!.item.indexOf(item("stone"));
  const move = (): void => void ada.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(stoneAt()), w.bits(BOX_OPEN, 1), w.varint(0), w.u16(4), w.u16(item("stone"))));
  rule = (e) => {
    if (e.name === "item.move") e.refuse("nothing goes in today");
  };
  move();
  expect([result(), has(ada, "stone")]).toEqual([RESULT_DENIED, 10]);
  rule = () => {};
  move();
  expect([result(), has(ada, "stone")]).toEqual([RESULT_OK, 6]);
  expect(said("item.move").pop()).toEqual({ byPid: adaPid, from: adaPid, to: boxPid, item: "core:stone", n: 4 });

  // Dropping and eating are each asked about.
  h.say(ada, "give berry 3");
  rule = (e) => {
    if (e.name === "item.drop" || e.name === "item.use") e.refuse("not now");
  };
  ada.command(CMD_DROP, (w) => (w.varint(stoneAt()), w.u16(2), w.u16(item("stone"))));
  expect(result()).toBe(RESULT_DENIED);
  const berryAt = (): number => ada.inventory!.item.indexOf(item("berry"));
  ada.command(CMD_USE, (w) => (w.varint(berryAt()), w.u16(item("berry"))));
  expect([result(), has(ada, "stone"), has(ada, "berry")]).toEqual([RESULT_DENIED, 6, 3]);
  rule = () => {};
  ada.command(CMD_DROP, (w) => (w.varint(stoneAt()), w.u16(2), w.u16(item("stone"))));
  expect(result()).toBe(RESULT_OK);
  ada.command(CMD_USE, (w) => (w.varint(berryAt()), w.u16(item("berry"))));
  expect([result(), has(ada, "stone"), has(ada, "berry")]).toEqual([RESULT_OK, 4, 2]);
  expect([said("item.drop").pop(), said("item.use").pop()]).toEqual([{ byPid: adaPid, item: "core:stone", n: 2 }, { byPid: adaPid, item: "core:berry" }]);

  // A pick is made: the job may be refused, and the count changed.
  h.say(ada, "give wood 4");
  h.say(ada, "give thatch 40");
  ada.command(CMD_LEARN, (w) => w.u16(item("engram-pick")));
  h.run(200);
  codes.length = 0;
  rule = (e) => {
    if (e.name === "craft.start") e.refuse("the forge is cold");
  };
  ada.command(CMD_CRAFT, (w) => (w.u16(item("pick")), w.u8(1)));
  expect(result()).toBe(RESULT_DENIED);
  rule = (e) => {
    if (e.name === "craft.start") e.data.count = 2;
  };
  ada.command(CMD_CRAFT, (w) => (w.u16(item("pick")), w.u8(1)));
  expect(result()).toBe(RESULT_OK);
  h.run(6000);
  expect(said("craft.start").pop()).toEqual({ pid: adaPid, item: "core:pick", count: 1 });
  expect(said("craft.done")).toEqual([{ pid: adaPid, item: "core:pick", n: 1 }, { pid: adaPid, item: "core:pick", n: 1 }]);
  expect(has(ada, "pick")).toBe(2);
  expect(said("item.gain").filter((g) => g.why === "craft").length).toBe(2);
  rule = () => {};

  // Bob sets a foundation down, and it comes with him into Ada's tribe.
  expect(found(bob, 1)).toBe(RESULT_OK);
  const [was, team] = [rec(bob).team, rec(ada).team];
  h.say(ada, "tribe create Masons");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  expect(said("structure.owner")).toEqual([{ from: was, to: team, n: 1 }]);

  // Ada picks a bush.
  expect(nodesOf(h, "core:bush", 256, 256).some((b) => standFacing(h, ada, h.pilots[0]!, b, 1.4))).toBe(true);
  h.pilots[0]!.buttons = BTN_USE;
  h.run(100);
  h.pilots[0]!.buttons = 0;
  h.run(300);
  const picked = said("harvest");
  expect(picked.length).toBeGreaterThan(0);
  expect(picked[0]).toMatchObject({ pid: adaPid, node: "core:bush" });
  expect(said("item.gain").filter((g) => g.why === "harvest").length).toBe(picked.length);
  expect(h.host.items.audit()).toEqual([]);
  expect(names(all.heard.lines)).toEqual([...wired].sort());
  void bobPid;
});

test("a module hears a creature spawned, tamed, ordered, ridden and bred, and may refuse each", () => {
  const wired = wiredOf("creature", "tame", "ride", "breed");
  expect(wired.length).toBe(10);
  const all = listener("all", [...wired, "name.set"]);
  const { h, ada, rec } = duel([all.def]);
  let rule: (e: Parameters<NonNullable<typeof all.heard.each>>[0]) => void = () => {};
  all.heard.each = (e) => rule(e);
  const said = (name: string): Record<string, unknown>[] => all.heard.lines.filter((l) => l.startsWith(`${name}: `)).map((l) => JSON.parse(l.slice(name.length + 2)));
  const me = rec(ada);
  const ents = h.world.ents;
  const [x, z] = [ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!];
  const codes: number[] = [];
  ada.onResult = (seq, code) => void (seq !== 0 && codes.push(code));
  const result = (): number => {
    h.run(200);
    return codes.pop() ?? -1;
  };

  // A module keeps grazers out, and makes every other creature level 7 with two regions of one colour.
  rule = (e) => {
    if (e.name !== "creature.spawn") return;
    if (e.data.kind === "core:grazer") e.refuse("no grazers on this map");
    e.data.level = 7;
    e.data.colours = "9,9";
  };
  expect(h.say(ada, "spawn grazer 3")).toEqual(["no room for it there"]);
  expect(h.host.spawnCreature("core:grazer", x + 8, z + 8, 3)).toBe(-1);
  const made = (female: boolean, dx: number) => {
    const e = h.host.spawnCreature("core:parasaur", x + dx, z + 4, 3, "admin");
    const r = h.host.records.byPid.get(ents.pid[e]!)!;
    r.genome!.female = female;
    return { e, rec: r };
  };
  const [f, m] = [made(true, -2), made(false, 2)];
  expect(said("creature.spawn").pop()).toEqual({ kind: "core:parasaur", why: "admin", x: x + 2, z: z + 4, level: 3, colours: "" });
  expect([f.rec.genome!.level, [...f.rec.genome!.colors.slice(0, 2)]]).toEqual([7, [9, 9]]);

  // A tame may be refused, and the one who earned it is told why.
  rule = (e) => {
    if (e.name === "tame.allow") e.refuse("this tribe has all the tames it may");
  };
  expect([h.host.taming.give(f.rec, me, 1), f.rec.team]).toEqual([false, 0]);
  h.run(100);
  expect(ada.log[ada.log.length - 1]!.text).toBe("this tribe has all the tames it may");
  rule = () => {};
  expect([h.host.taming.give(f.rec, me, 1), h.host.taming.give(m.rec, me, 0.5, "forced"), f.rec.team]).toEqual([true, true, me.team]);
  h.run(100);
  expect(said("tame.allow")[1]).toEqual({ pid: f.rec.pid, kind: "core:parasaur", level: 7, byPid: me.pid, team: me.team, how: "fed" });
  expect(said("tame.done")).toEqual([
    { pid: f.rec.pid, kind: "core:parasaur", level: 7, byPid: me.pid, team: me.team, how: "fed", te: 1 },
    { pid: m.rec.pid, kind: "core:parasaur", level: 7, byPid: me.pid, team: me.team, how: "forced", te: 0.5 },
  ]);

  // An order and a name may each be refused, and a name reworded.
  rule = (e) => {
    if (e.name === "creature.order") e.refuse("tames are frozen during the event");
  };
  ada.command(CMD_ORDER, (w) => (w.u32(f.e >>> 0), w.u8(ORDER_STAY)));
  expect(result()).toBe(RESULT_DENIED);
  expect(said("creature.order").pop()).toEqual({ pid: f.rec.pid, byPid: me.pid, order: "stay" });
  rule = (e) => {
    if (e.name === "name.set") e.data.text = String(e.data.text).replace("Darn", "Dear");
  };
  ada.command(CMD_NAME, (w) => (w.u32(ents.handleOf(f.e)), w.string("Darn Daisy")));
  expect([result(), f.rec.name]).toEqual([RESULT_OK, "Dear Daisy"]);

  // Mounting may be refused. Getting off is told.
  f.rec.saddle = h.reg.index.get("core:saddle_parasaur")!;
  h.say(ada, `tp ${(x - 2).toFixed(2)} ${(z + 1.5).toFixed(2)}`);
  const c = h.client(ada)!;
  rule = (e) => {
    if (e.name === "ride.mount") e.refuse("no riding in the plaza");
  };
  expect(h.host.riding.mount(c, f.e)).toBe(RESULT_DENIED);
  rule = () => {};
  expect(h.host.riding.mount(c, f.e)).toBe(RESULT_OK);
  h.run(200);
  h.host.riding.dismount(c);
  h.run(200);
  expect([said("ride.mount").pop(), said("ride.dismount")]).toEqual([{ pid: me.pid, mount: f.rec.pid }, [{ pid: me.pid, mount: f.rec.pid }]]);

  // The pair may be kept apart. Let be, they have an egg, it hatches, and the young one grows up.
  rule = (e) => {
    if (e.name === "breed.mate") e.refuse("not in this season");
  };
  for (const one of [f, m]) {
    ada.command(CMD_ORDER, (w) => (w.u32(one.e >>> 0), w.u8(ORDER_MATE)));
    expect(result()).toBe(RESULT_OK);
  }
  h.run(4000);
  expect([h.host.breeding.pairCount, said("breed.mate").length > 0]).toEqual([0, true]);
  expect(said("breed.mate")[0]).toEqual({ mother: f.rec.pid, father: m.rec.pid });
  rule = () => {};
  h.run(34000);
  const laid = said("breed.egg");
  expect(laid.length).toBeGreaterThan(0);
  expect(laid[0]).toMatchObject({ mother: f.rec.pid, father: m.rec.pid });
  expect(h.host.exec("hatch all")).toContain("hatched");
  h.run(200);
  const born = said("breed.hatch");
  expect(born.length).toBe(laid.length);
  expect(born[0]).toMatchObject({ kind: "core:parasaur" });
  const young = h.host.records.byPid.get(born[0]!.pid as number)!;
  expect(h.host.breeding.growNow(young)).toBe(true);
  h.run(500);
  expect(said("breed.grown")).toEqual([{ pid: young.pid }]);
  expect(names(all.heard.lines).filter((n) => n !== "name.set")).toEqual([...wired].sort());
});
