// Kinds of map event defined by modules (server/api/event.ts, server/mapevent/events.ts): defined in setup or refused
// whole; called, come and ended by their handlers; saved and taken up again, with or without the module that defined
// them; previewed with nothing made; heard on the bus; and switched off when they keep throwing.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleDef } from "../../server/api/module.ts";
import type { MapEvent } from "../../server/mapevent/events.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { number, whole } from "../../shared/mapevent/fields.ts";
import { MAPEVENT_ENDED, MAPEVENT_LIVE, MAPEVENT_NOTICE } from "../../shared/mapevent/wire.ts";
import { TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { meteor, xpHour } from "../fixtures/event-kinds.ts";
import { flatMap } from "../fixtures/map.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-events-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let saves = 0;
const saveFile = (): string => join(dir, `${saves++}.db`);

/** Ada with cheats in the middle of a level kilometre, with `modules` loaded, and what the server said. */
function world(modules: ModuleDef[], dbPath?: string) {
  const lines: string[] = [];
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(16)), log: (l) => lines.push(l), modules, ...(dbPath ? { dbPath } : {}) });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, "tp 512 512");
  h.run(300);
  return { h, ada, lines, events: h.host.mapEvents };
}

const call = (h: Harness, kind: string, seconds?: number): MapEvent => {
  const ev = h.host.mapEvents.call(kind, { source: "test", notice: seconds });
  if (typeof ev === "string") throw new Error(ev);
  return ev;
};
const until = (h: Harness, tick: number): void => h.run(Math.max(0, tick - h.world.tick + 2) * (1000 / TICK_RATE));
/** Sets one kind's values in the event book in force. */
const tune = (h: Harness, kind: string, values: Record<string, unknown>): void => {
  const store = h.host.eventBook;
  const r = store.save({ ...store.book, tuning: { ...store.book.tuning, [kind]: values } }, store.book.revision, "test", "");
  if (!r.ok) throw new Error(JSON.stringify(r));
};
const xpOf = (h: Harness, name: string): number => [...h.host.records.byPid.values()].find((r) => r.name === name)!.xp;

test("a kind is defined in setup, once, and a faulty one stops the server from starting", () => {
  const bad = (more: Record<string, unknown>): ModuleDef => ({ name: "bad", api: 1, setup: (m) => m.mapEvent({ id: "bad", label: "Bad", about: "", tuning: {}, on: { start() {} }, ...more } as never) });
  const starts = (modules: ModuleDef[]): string => {
    try {
      world(modules);
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  };
  expect(starts([bad({ id: "Bad Id" })])).toContain("a kind's id");
  expect(starts([bad({ tuning: { a: number(5, { min: 0, max: 1, label: "a", help: "", group: "g" }) } })])).toContain("its default is not");
  expect(starts([bad({ on: {} })])).toContain("on.start is a function");
  expect(starts([bad({ notice: -1 })])).toContain("a notice is 0 to 3,600 seconds");
  expect(starts([xpHour(), { ...xpHour(), name: "again" }])).toContain("module xp_hour defined it already");
  // Not after setup.
  const { def, heard } = listener("late", []);
  const { events } = world([def, xpHour()]);
  expect(() => heard.context!.mapEvent({ id: "later", label: "Later", about: "", tuning: {}, on: { start() {} } })).toThrow("in setup");
  expect([...events.kinds.keys()]).toEqual(["xp_hour"]);
});

test("an event with no part is called, told, comes, and is ended by its own phase", () => {
  const { h, ada, events } = world([xpHour()]);
  tune(h, "xp_hour", { minutes: 1, factor: 3 });
  const ev = call(h, "xp_hour");
  expect([ev.state, (ev.start - ev.called) / TICK_RATE]).toEqual([MAPEVENT_NOTICE, 10]);
  h.run(300);
  expect(ada.log.some((l) => l.channel === TEXT_NOTICE && l.text.startsWith("Double experience for 1 minutes"))).toBe(true);
  // Before it comes, experience is as it was.
  let was = xpOf(h, "ada");
  h.say(ada, "addxp 10");
  expect(xpOf(h, "ada") - was).toBe(10);
  until(h, ev.start);
  expect(ev.state).toBe(MAPEVENT_LIVE);
  was = xpOf(h, "ada");
  h.say(ada, "addxp 10");
  expect(xpOf(h, "ada") - was).toBe(30);
  // Its phase ends it a minute after it came, and it is forgotten 15 s after that.
  until(h, ev.start + 60 * TICK_RATE);
  expect(ev.state).toBe(MAPEVENT_ENDED);
  was = xpOf(h, "ada");
  h.say(ada, "addxp 10");
  expect(xpOf(h, "ada") - was).toBe(10);
  until(h, ev.ended + 15 * TICK_RATE);
  expect(events.events).toEqual([]);
});

test("a live event is saved with its phase and bag, and its kind puts back what lives outside the bag", () => {
  const db = saveFile();
  let { h } = world([xpHour()], db);
  tune(h, "xp_hour", { minutes: 2, factor: 2 });
  const ev = call(h, "xp_hour", 1);
  until(h, ev.start);
  const id = ev.id;
  const ends = ev.start + 120 * TICK_RATE;
  h.run(2000);
  h.host.shutdown();
  ({ h } = world([xpHour()], db));
  const back = h.host.mapEvents.get(id)!;
  expect([back.state, back.phases.map((p) => p.at)]).toEqual([MAPEVENT_LIVE, [ends]]);
  const ada = h.sessions.find((s) => s.name === "ada")!;
  h.run(200);
  const was = xpOf(h, "ada");
  h.say(ada, "addxp 10");
  expect(xpOf(h, "ada") - was).toBe(20);
  until(h, ends);
  expect(back.state).toBe(MAPEVENT_ENDED);
  h.host.shutdown();
});

test("an event whose module is gone runs out on what it was saved with, and the book keeps its kind", () => {
  const db = saveFile();
  let { h } = world([meteor()], db);
  tune(h, "meteor", { rolls: 2 });
  const ev = call(h, "meteor", 1);
  // It comes, its rock is brought down by its kind, falls, and leaves a crate.
  for (let k = 0; k < 40 && ev.crates.length === 0; k++) h.run(500);
  expect(ev.crates.length).toBe(1);
  const pid = ev.crates[0]!.pid;
  h.run(2000);
  h.host.shutdown();
  let lines: string[];
  ({ h, lines } = world([], db));
  const orphan = h.host.mapEvents.get(ev.id)!;
  // Still there with its crate, which nobody's handler will be told of.
  expect([orphan.state, orphan.crates.map((c) => c.pid), h.host.records.byPid.has(pid)]).toEqual([MAPEVENT_LIVE, [pid], true]);
  expect(h.host.eventBook.book.tuning.meteor).toEqual({ rolls: 2 });
  expect(lines.some((l) => l.includes("event book"))).toBe(false);
  // Emptied, nothing of it is left to wait for: it ends.
  const inside = h.host.items.inv(h.host.records.byPid.get(pid)!);
  for (let slot = 0; slot < inside.cap; slot++) if (inside.item[slot] !== 0) inside.remove(slot, inside.count[slot]!);
  h.run(200);
  expect([orphan.state, h.host.records.byPid.has(pid)]).toEqual([MAPEVENT_ENDED, false]);
  h.host.shutdown();
});

test("a saved event's values are fitted again to its kind's fields as they are now", () => {
  const db = saveFile();
  let { h } = world([xpHour()], db);
  tune(h, "xp_hour", { minutes: 5, factor: 4 });
  const ev = call(h, "xp_hour", 1);
  until(h, ev.start);
  h.run(2000);
  h.host.shutdown();
  // The same kind, built again: `factor` now goes no higher than 3, and it has a new field.
  let resumed: Record<string, unknown> = {};
  const changed: ModuleDef = {
    name: "xp_hour",
    api: 1,
    setup: (m) =>
      m.mapEvent({
        id: "xp_hour",
        label: "Double experience",
        about: "",
        version: 2,
        tuning: { factor: number(2, { min: 1, max: 3, label: "x", help: "", group: "g" }), minutes: whole(60, { min: 1, max: 600, label: "m", help: "", group: "g" }), bonus: whole(7, { min: 0, max: 9, label: "b", help: "", group: "g" }) },
        on: { start() {}, resume: (run, saved) => void (resumed = { ...run.tuned, saved }) },
      }),
  };
  ({ h } = world([changed], db));
  h.run(100);
  expect(resumed).toEqual({ factor: 2, minutes: 5, bonus: 7, saved: 1 });
  h.run(2000);
  h.host.shutdown();
  // Taken up by version 2 once, it is kept as version 2's: a second restart does not migrate it again.
  ({ h } = world([changed], db));
  h.run(100);
  expect(resumed.saved).toBe(2);
  h.host.shutdown();
});

test("a preview draws what a call with its seed makes, and makes, tells and keeps nothing", () => {
  const { h, ada, events } = world([meteor(), xpHour()]);
  const preview = events.preview("meteor", 4242, [{ x: 500, z: 520 }]);
  if (typeof preview === "string") throw new Error(preview);
  expect([preview.crafts.length, preview.sites.length, events.events.length]).toEqual([1, 1, 0]);
  const made = h.host.mapEvents.call("meteor", { source: "test", seed: 4242, near: [{ x: 500, z: 520 }] });
  if (typeof made === "string") throw new Error(made);
  expect(made.crafts[0]!.points).toEqual(made.crafts[0]!.spec.points);
  expect(made.crafts[0]!.points.map((p) => [p.x, p.z])).toEqual(preview.crafts[0]!.spec.points.map((p) => [Math.round(p.x * 32) / 32, Math.round(p.z * 32) / 32]));
  // xp_hour's start only says: a preview of it says nothing to anybody, and doubles nothing.
  const told = ada.log.length;
  const quiet = events.preview("xp_hour", 1);
  if (typeof quiet === "string") throw new Error(quiet);
  expect(quiet.notices[0]).toStartWith("Double experience");
  h.run(300);
  expect(ada.log.length).toBe(told);
  const was = xpOf(h, "ada");
  h.say(ada, "addxp 10");
  expect(xpOf(h, "ada") - was).toBe(10);
  expect(events.preview("nothing", 1)).toBe(`there is no map event "nothing"`);
});

test("a module hears map events on the bus, may refuse a call, and calls and ends events of its own", () => {
  const { def, heard } = listener("watch", [["mapevent.call", { priority: 1 }], "mapevent.called", "mapevent.started", "mapevent.ended"]);
  let caller: ModuleDef["setup"] extends (m: infer M) => void ? M : never;
  const host: ModuleDef = { name: "host_mod", api: 1, setup: (m) => void (caller = m) };
  const { h, events } = world([def, xpHour(), host]);
  // Not while modules are set up: a call there is refused.
  expect(events.kinds.get("xp_hour")!.module).toBe("xp_hour");
  heard.each = (e) => {
    if (e.name === "mapevent.call" && e.data.source === "test") e.refuse("not today");
  };
  expect(h.host.mapEvents.call("xp_hour", { source: "test" })).toBe("not today");
  heard.each = null;
  const id = caller!.mapEvents.call("xp_hour", { notice: 1 });
  expect(typeof id).toBe("number");
  expect(caller!.mapEvents.list().map((e) => [e.id, e.kind, e.state, e.source])).toEqual([[id as number, "xp_hour", "notice", "host_mod"]]);
  h.run(1500);
  expect(caller!.mapEvents.cancel(id as number, "enough")).toBe("");
  expect(caller!.mapEvents.cancel(id as number)).toBe(`no live event ${id}`);
  h.run(200);
  // Switched off in the book, a module may not call it; the console still may.
  tune(h, "xp_hour", {});
  const store = h.host.eventBook;
  expect(store.save({ ...store.book, kinds: { xp_hour: { on: false } } }, store.book.revision, "test", "").ok).toBe(true);
  expect(caller!.mapEvents.call("xp_hour")).toBe("xp_hour is switched off in the event book");
  expect(h.say(h.sessions[0]!, "enablecheats")).toBeDefined();
  const called = h.say(h.sessions[0]!, "event call xp_hour 1");
  expect(called.some((l) => l.startsWith("called"))).toBe(true);
  const names = heard.lines.slice(0, 5).map((l) => l.split(":")[0]);
  expect(names).toEqual(["mapevent.call", "mapevent.call", "mapevent.called", "mapevent.started", "mapevent.ended"]);
  expect(heard.lines[4]).toContain(`"why":"enough"`);
});

test("a kind whose start throws makes nothing, and one that keeps throwing is switched off", () => {
  let throws = true;
  const broken: ModuleDef = {
    name: "broken",
    api: 1,
    setup: (m) =>
      m.mapEvent({
        id: "broken",
        label: "Broken",
        about: "",
        tuning: {},
        on: {
          start(run) {
            run.site({ x: 500, z: 500, column: { kind: "light", rgb: 0xffffff, height: 50, wide: 2, sound: "" } });
            if (throws) throw new Error("no");
          },
        },
      }),
  };
  const { h, events, lines } = world([broken]);
  for (let k = 0; k < 7; k++) expect(h.host.mapEvents.call("broken", { source: "test" })).toContain("its start threw");
  expect([events.events.length, lines.filter((l) => l.includes("threw in start: no")).length]).toEqual([0, 7]);
  expect(events.call("broken", { source: "test" })).toContain("its start threw");
  throws = false;
  expect(events.call("broken", { source: "test" })).toContain("is off");
  expect(h.say(h.sessions[0]!, "event kinds")[0]).toContain("off, its handlers threw");
});

test("a preview applies a start's own acts on its parts: one made and taken out is not shown", () => {
  const fleeting: ModuleDef = {
    name: "fleeting",
    api: 1,
    setup: (m) =>
      m.mapEvent({
        id: "fleeting",
        label: "Fleeting",
        about: "",
        tuning: {},
        on: {
          start(run) {
            const column = { kind: "light" as const, rgb: 0xffffff, height: 20, wide: 1, sound: "" };
            const gone = run.site({ x: 500, z: 500, column });
            run.site({ x: 520, z: 500, column });
            if (run.part(gone)?.type === "site") run.remove(gone);
          },
        },
      }),
  };
  const { h, events } = world([fleeting]);
  const preview = events.preview("fleeting", 9);
  if (typeof preview === "string") throw new Error(preview);
  const made = events.call("fleeting", { source: "test", seed: 9 });
  if (typeof made === "string") throw new Error(made);
  expect([preview.sites.map((s) => s.spec.x), made.sites.map((s) => s.x)]).toEqual([[520], [520]]);
  h.host.shutdown();
});
