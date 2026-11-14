// The module contract: what a module hears, what it may refuse, and what happens when it misbehaves.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
