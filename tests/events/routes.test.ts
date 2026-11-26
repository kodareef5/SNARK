// The events page's requests against a running world (server/admin/event-routes.ts): behind the admin pages' gate; a
// change refused with the status that says why; the book saved by compare and swap, put back and brought back; what an
// event of a kind would make previewed for a seed and then called with it; and the console's own acts on events.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ufo from "../../modules/ufo.ts";
import { EventRoutes, nearOf } from "../../server/admin/event-routes.ts";
import type { AdminGate } from "../../server/admin/gate.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { PAGE } from "../../server/admin/supply-routes.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { frontPasses } from "../../server/front.ts";
import { Guesses } from "../../server/guesses.ts";
import type { EventBook, KindSheet } from "../../shared/mapevent/book.ts";
import type { PathPoint } from "../../shared/sim/craft.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { meteor, xpHour } from "../fixtures/event-kinds.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const AT = "http://localhost";

/** Ada in the middle of a level kilometre, with `modules`, and the events page's routes; `dbPath` keeps the book in a file. */
function world(modules: ModuleDef[] = [ufo, xpHour()], dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(16)), log: () => {}, modules, ...(dbPath ? { dbPath } : {}) });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, "tp 512 512");
  h.run(300);
  const routes = new EventRoutes(h.host, () => 1_800_000_000_000);
  const ask = (what: string, init: RequestInit = {}): Promise<Response> => Promise.resolve(routes.answer(new Request(`${AT}/admin/events/${what}`, init), `/admin/events/${what.split("?")[0]}`, new URL(`${AT}/admin/events/${what}`))!);
  const get = async <T>(what: string): Promise<T> => (await (await ask(what)).json()) as T;
  const post = async (what: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json", origin: AT, host: "localhost" }): Promise<{ status: number; answer: Record<string, unknown> }> => {
    const r = await ask(what, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
    return { status: r.status, answer: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  return { h, ada, routes, ask, get, post };
}

interface BookWire {
  revision: number;
  starter: boolean;
  kept: boolean;
  book: EventBook;
  first: EventBook;
  kinds: (KindSheet & { off: boolean; notice: number })[];
  missing: string[];
}
interface Live {
  events: { id: number; kind: string; state: string; seed: number; source: string; left: number; parts: { type: string; state?: string; points?: PathPoint[]; shield?: string }[] }[];
  schedules: { key: string; on: boolean; looks: number; why: string; now: string }[];
  survivors: { x: number; z: number }[];
  acts: { what: string }[];
  log: { what: string }[];
}

test("the events page is behind the admin pages' gate, and the front passes its acts and nothing else", async () => {
  const h = new Harness({}, 1, 60, { modules: [ufo] });
  const dir = mkdtempSync(join(tmpdir(), "snark-events-admin-"));
  try {
    writeFileSync(join(dir, "events.html"), "<!doctype html><title>events</title>");
    const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: Date.now() } });
    const gate: AdminGate = { dev: false, password: "kiwi", guesses: new Guesses(), tick: () => 0 };
    const ask = async (path: string, password?: string, init: RequestInit = {}): Promise<Response> => {
      const headers = { ...(init.headers as Record<string, string> | undefined), ...(password === undefined ? {} : { authorization: `Basic ${btoa(`admin:${password}`)}` }) };
      return (await pages.answer(new Request(`${AT}${path}`, { ...init, headers }), "1.2.3.4", gate, path))!;
    };
    const change = { method: "POST", headers: { "content-type": "application/json", origin: AT, host: "localhost" }, body: JSON.stringify({ id: "all" }) };
    expect([(await ask("/admin/events/book.json")).status, (await ask("/admin/events/cancel", undefined, change)).status, (await ask("/admin/events.html")).status]).toEqual([401, 401, 401]);
    expect(await (await ask("/admin/events.html", "kiwi")).text()).toBe("<!doctype html><title>events</title>");
    const book = (await (await ask("/admin/events/book.json", "kiwi")).json()) as BookWire;
    expect([book.revision, book.starter, book.kept, book.kinds.map((k) => [k.id, k.module, k.off, k.notice]), book.missing]).toEqual([0, true, false, [["ufo", "ufo", false, 45]], []]);
    expect((await ask("/admin/events/cancel", "kiwi", change)).status).toBe(200);
    expect((await ask("/admin/events/nothing.json", "kiwi")).status).toBe(404);
    // Through the front, the acts are passed and the reads are reads; nothing else under a world's admin pages is.
    expect(["call", "hurry", "down", "cancel", "book", "reset", "restore"].map((what) => frontPasses("POST", `/admin/events/${what}`))).toEqual([true, true, true, true, true, true, true]);
    expect([frontPasses("POST", "/admin/events/book.json"), frontPasses("POST", "/admin/events/a/b"), frontPasses("GET", "/admin/events/live.json")]).toEqual([false, false, true]);
  } finally {
    h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a change is refused with the status that says why, and a save is compare and swap on the book's revision", async () => {
  const { h, ask, get, post } = world();
  const read = await get<BookWire>("book.json");
  expect(read.kinds.map((k) => [k.id, Object.keys(k.fields).length > 0, k.schedules.length])).toEqual([["ufo", true, 2], ["xp_hour", true, 1]]);
  const draft = structuredClone(read.book);
  draft.tuning.ufo = { health: 40000 };
  expect((await post("book", { revision: 0, book: draft }, { "content-type": "application/json", origin: "https://elsewhere.example", host: "localhost" })).status).toBe(403);
  expect((await post("book", { revision: 0, book: draft }, { "content-type": "text/plain", origin: AT, host: "localhost" })).status).toBe(400);
  expect([(await post("book", "{not json")).status, (await post("book", "[1]")).status, (await post("book", { book: draft })).status, (await post("book", { revision: 0 })).status]).toEqual([400, 400, 400, 400]);
  expect([(await ask("book.json", { method: "POST" })).status, (await ask("call")).status, (await post("nothing", {})).status]).toEqual([405, 405, 404]);
  // A book with faults: 422, each at its path, a kind's own check among them, and nothing saved.
  const broken = structuredClone(draft);
  broken.tuning.ufo = { health: 0, points: [4, 6], scans: [3, 3] };
  broken.schedules[1]!.key = broken.schedules[0]!.key;
  const refused = await post("book", { revision: 0, book: broken, note: "" });
  expect([refused.status, (refused.answer.faults as { path: string }[]).map((f) => f.path), h.host.eventBook.book.revision]).toEqual([422, ["tuning.ufo.health", "schedules[1].key", "tuning.ufo.scans"], 0]);
  // Saved: the next revision, by the page, with its note, and in force at once.
  draft.kinds = { xp_hour: { on: false } };
  expect((await post("book", { revision: 0, book: draft, note: "a softer craft\nfor now" })).answer).toEqual({ revision: 1 });
  expect([h.host.eventBook.book.tuning.ufo, h.host.eventBook.book.kinds, h.host.eventBook.revisions().map((r) => [r.revision, r.by, r.note])]).toEqual([{ health: 40000 }, { xp_hour: { on: false } }, [[1, PAGE, "a softer craft for now"]]]);
  const stale = await post("book", { revision: 0, book: read.book });
  expect([stale.status, stale.answer.revision]).toEqual([409, 1]);
  expect([(await post("reset", { revision: 0 })).status, (await post("reset", { revision: 1 })).answer, h.host.eventBook.book.tuning]).toEqual([409, { revision: 2 }, {}]);
  expect([(await post("restore", { revision: 2, to: 1 })).answer, h.host.eventBook.book.tuning.ufo, (await post("restore", { revision: 3, to: 9 })).status]).toEqual([{ revision: 3 }, { health: 40000 }, 404]);
  expect([(await get<{ book: EventBook }>("revision.json?n=1")).book.tuning.ufo, (await get<{ error: string }>("revision.json?n=7")).error]).toEqual([{ health: 40000 }, "Revision 7 is not kept."]);
  expect((await get<Live>("live.json")).acts.map((a) => a.what)).toEqual(["event book saved (a softer craft for now): revision 1", "event book reset to the starter: revision 2", "event book restored from revision 1: revision 3"]);
  h.host.shutdown();
});

test("a save that cannot be written is refused with 500 and changes nothing; one whose history cannot be is saved and says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-events-admin-"));
  const db = join(dir, "world.db");
  const { h, get, post } = world([ufo], db);
  const file = `${db}.events.json`;
  const draft = structuredClone((await get<BookWire>("book.json")).book);
  draft.tuning.ufo = { shieldSoak: 0.9 };
  mkdirSync(`${file}.history`);
  const saved = await post("book", { revision: 0, book: draft, note: "" });
  expect([saved.status, saved.answer.revision, String(saved.answer.unkept).startsWith("its history could not be written")]).toEqual([200, 1, true]);
  rmSync(`${file}.history`, { recursive: true });
  mkdirSync(`${file}.tmp`);
  draft.tuning.ufo = { shieldSoak: 0.5 };
  const failed = await post("book", { revision: 1, book: draft, note: "" });
  expect([failed.status, String(failed.answer.error).startsWith("The book's file could not be written"), h.host.eventBook.book.tuning.ufo]).toEqual([500, true, { shieldSoak: 0.9 }]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("a preview for a kind and a seed is what a call with that seed makes, and the console's acts are in the log", async () => {
  const { h, get, post } = world();
  expect((await get<{ error: string }>("preview.json?kind=ufo&seed=x")).error).toContain("names a kind and a seed");
  expect((await get<{ error: string }>("preview.json?kind=nothing&seed=4")).error).toBe(`there is no map event "nothing"`);
  const p = await get<{ crafts: { points: PathPoint[]; seconds: number }[]; notices: string[]; near: unknown[]; notice: number }>("preview.json?kind=ufo&seed=4242");
  expect([p.crafts.length, p.notices, p.near, p.notice]).toEqual([1, ["Radar contact: an unidentified craft is inbound."], [{ x: 512, z: 512 }], 45]);
  const called = await post("call", { kind: "ufo", seed: 4242 });
  expect(called.status).toBe(200);
  const live = await get<Live>("live.json");
  expect(live.events.map((e) => [e.id, e.kind, e.state, e.seed, e.source])).toEqual([[called.answer.id as number, "ufo", "notice", 4242, "operator"]]);
  expect(live.events[0]!.parts[0]!.points).toEqual(p.crafts[0]!.points);
  expect((await post("call", { kind: "nothing" })).status).toBe(422);
  expect((await post("hurry", { id: "all" })).answer.said).toBe(`event ${called.answer.id as number} comes in 0 s`);
  h.run(500);
  expect((await post("down", { id: called.answer.id })).answer.said).toContain("1 craft going down");
  expect((await post("cancel", { id: "all" })).answer.said).toBe(`ended ${called.answer.id as number}`);
  expect([(await post("hurry", { id: "x" })).status, (await post("down", { id: 1, seconds: 3 })).status]).toEqual([400, 400]);
  expect((await get<Live>("live.json")).acts.map((a) => a.what.split(":")[0])).toEqual(["event call ufo 45 4242", "event call nothing", "event hurry all", `event down ${called.answer.id as number}`, "event cancel all"]);
  expect(nearOf("1,2;3,4")).toEqual([{ x: 1, z: 2 }, { x: 3, z: 4 }]);
  expect([nearOf("none"), nearOf("1"), nearOf("a,b")]).toEqual([[], null, null]);
  h.host.shutdown();
});

test("the page is told which kinds the book or the world names that no module defines now", async () => {
  const db = join(mkdtempSync(join(tmpdir(), "snark-events-admin-")), "world.db");
  let { h, post } = world([ufo, meteor()], db);
  const read = structuredClone(h.host.eventBook.book);
  read.tuning.meteor = { rolls: 2 };
  expect((await post("book", { revision: 0, book: read })).status).toBe(200);
  h.host.shutdown();
  let get: <T>(what: string) => Promise<T>;
  ({ h, get } = world([ufo], db));
  const wire = await get<BookWire>("book.json");
  expect([wire.kinds.map((k) => k.id), wire.missing, wire.book.tuning.meteor]).toEqual([["ufo"], ["meteor"], { rolls: 2 }]);
  h.host.shutdown();
});
