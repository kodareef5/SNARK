// The module contract: what a module hears, what it may refuse, and what happens when it misbehaves.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../server/settings/config.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { CMD_LEARN, CMD_RESPAWN, CMD_SPEND, REJECT_DENIED, REJECT_NAME, RESULT_DENIED, RESULT_OK, SESSION_ALIVE, SESSION_DEAD, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { EVENTS, eventFaults, eventIndex } from "../../server/events/catalog.ts";
import { EVENTS_PAGE, eventsPage } from "../../tools/events.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";

const SAY = eventIndex("chat.say");
const SAID = eventIndex("chat.said");
const quiet = { log: () => {} };

test("the event table is sound, its page is current, and an event said to be raised is raised where it says", () => {
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
  bob.command(CMD_RESPAWN, (w) => w.u8(0));
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
  bob.command(CMD_RESPAWN, (w) => w.u8(0));
  h.run(500);
  expect([codes, bob.sessionState]).toEqual([[RESULT_DENIED], SESSION_DEAD]);
  rule = () => {};
  bob.command(CMD_RESPAWN, (w) => w.u8(0));
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
