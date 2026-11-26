// What the events page asks of a world (planning/workstreams/map-events.md, "The events page"). It reads with GET and
// changes with POST, and both are behind the admin pages' gate (gate.ts), which the caller has passed.
//
// A change is JSON from a page of this server, refused with a status that says why, as the drop book's are
// (supply-routes.ts): 403 from elsewhere, 400 for a body that is not what the route takes, 409 for a book saved over
// another editor's, 422 for a book with faults, each with its path, 500 for a book whose file could not be written.
// Nothing here knows a kind's rules: the store checks the book against the kinds the modules defined, and an event is
// called, hurried, brought down and ended by the console's own `event` command, so the page and an operator at the
// console do one thing and both are in the admin journal.

import { TICK_RATE } from "../../shared/coords.ts";
import { EVENT_MOST, KIND_ID, MAPEVENT_MOST, type EventBook } from "../../shared/mapevent/book.ts";
import { MAPEVENT_STATES, wireCraft } from "../../shared/mapevent/wire.ts";
import { buildTrack, type PathPoint } from "../../shared/sim/craft.ts";
import type { BookFault } from "../../shared/supply/book.ts";
import type { PartView } from "../api/event.ts";
import type { Actor } from "../acts.ts";
import type { Host } from "../host.ts";
import type { MapEvent } from "../mapevent/events.ts";
import { worldHour } from "../world.ts";
import { actorOf, stillHolds } from "./gate.ts";
import { body, refusedWrite } from "./supply-routes.ts";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const json = (answer: unknown, status = 200): Response => new Response(JSON.stringify(answer), { status, headers: JSON_HEADERS });
/** The largest body a change may be: a book at its largest, and its revision and note. */
export const EVENTS_BODY_MOST = EVENT_MOST.bytes + 8192;
/** The acts the page has lately done here, newest last, for its log. */
const ACTS_KEPT = 200;
/** Places a preview may be put near at the most. */
const NEAR_MOST = 64;
const STALE = "The book was saved by another editor since this page read it.";

export interface EventAct {
  /** Seconds since 1970. */
  at: number;
  tick: number;
  what: string;
}

/** A part as live.json tells it: as the engine sees it now, and a craft's path to draw it by. */
export type LivePart = PartView & { points?: PathPoint[]; seconds?: number; flown?: number; rest?: { x: number; y: number; z: number } | null };

/** An event as live.json tells it. Seconds are whole. */
export interface EventLiveRow {
  id: number;
  kind: string;
  state: string;
  schedule: string;
  source: string;
  seed: number;
  /** Seconds until it comes, or until the server ends it whatever it is doing. */
  left: number;
  parts: LivePart[];
}

const whole = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
/** A seed as the console takes one: a whole number a 32-bit draw can be made from. */
const seedOf = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : null);
const secs = (ticks: number): number => Math.max(0, Math.round(ticks / TICK_RATE));

/** `x,z;x,z` as places, "" or "none" as none; null for anything else. */
export function nearOf(text: string): { x: number; z: number }[] | null {
  if (text === "" || text === "none") return [];
  const out: { x: number; z: number }[] = [];
  for (const part of text.split(";")) {
    const [x, z, more] = part.split(",").map((s) => Number(s.trim()));
    if (more !== undefined || x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    out.push({ x, z });
  }
  return out.length <= NEAR_MOST ? out : null;
}

export class EventRoutes {
  private readonly host: Host;
  private readonly now: () => number;
  readonly acts: EventAct[] = [];

  constructor(host: Host, now: () => number = Date.now) {
    this.host = host;
    this.now = now;
  }

  /** The answer to a request under /admin/events/, or null for any other path. `at` is the path as the gate reads it. */
  answer(req: Request, at: string, url: URL): Response | Promise<Response> | null {
    if (!at.startsWith("/admin/events/")) return null;
    const what = at.slice("/admin/events/".length);
    if (what.endsWith(".json")) {
      if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      return this.read(what.slice(0, -5), url);
    }
    const no = refusedWrite(req);
    if (no) return no;
    const by = actorOf(req);
    return body(req, EVENTS_BODY_MOST).then((b) => {
      if (b === null) return json({ error: "Expected a JSON object no larger than a book." }, 400);
      return stillHolds(req, this.host) ?? this.write(what, b, by);
    });
  }

  private read(what: string, url: URL): Response {
    const { eventBook: store, mapEvents, world } = this.host;
    if (what === "book") {
      const book = store.book;
      const named = new Set([...Object.keys(book.kinds), ...Object.keys(book.tuning), ...book.schedules.map((s) => s.kind), ...mapEvents.events.map((e) => e.kind)]);
      return json({
        revision: book.revision,
        starter: store.starter,
        kept: store.kept,
        map: world.mapId,
        book,
        // The starter book, for the page to compare a draft with: what "the starter again" brings back.
        first: mapEvents.starterBook(),
        kinds: [...mapEvents.kinds.values()].map((k) => ({ ...k.sheet, off: k.off, calls: k.calls, ms: Math.round(k.ms * 100) / 100, worst: Math.round(k.worst * 100) / 100, notice: Math.round(mapEvents.noticeSeconds(k.def.id)) })),
        missing: [...named].filter((id) => !mapEvents.kinds.has(id)).sort(),
        most: MAPEVENT_MOST,
      });
    }
    if (what === "live") {
      const tick = world.tick;
      const book = store.book;
      return json({
        tick,
        rate: TICK_RATE,
        revision: book.revision,
        size: [world.hf.sizeX, world.hf.sizeZ],
        hour: Math.round(worldHour(world) * 100) / 100,
        events: mapEvents.events.map((e) => this.row(e, tick)),
        survivors: this.survivors(),
        schedules: book.schedules.map((s) => {
          const st = mapEvents.schedules.get(s.key);
          return { key: s.key, kind: s.kind, on: s.on && st !== undefined, looks: st ? secs(st.due - tick) : 0, why: st?.why ?? "", looked: st?.n ?? 0, now: mapEvents.why(s, null) };
        }),
        live: mapEvents.live(),
        calls: mapEvents.calls,
        downs: mapEvents.downs,
        mended: mapEvents.mended,
        acts: this.acts,
        log: mapEvents.log,
      });
    }
    if (what === "preview") {
      // What an event of a kind called now with this seed would make, near the survivors where they stand or the places given.
      const kind = url.searchParams.get("kind") ?? "";
      const given = url.searchParams.get("seed") ?? "";
      const seed = /^\d{1,10}$/.test(given) ? seedOf(Number(given)) : null;
      const raw = url.searchParams.get("near");
      const near = raw === null ? undefined : nearOf(raw);
      if (!KIND_ID.test(kind) || seed === null || near === null) return json({ error: "A preview names a kind and a seed, a whole number, and may name places near as x,z;x,z." }, 400);
      const made = mapEvents.preview(kind, seed, near);
      if (typeof made === "string") return json({ error: made }, 422);
      return json({
        kind,
        seed,
        notice: Math.round(mapEvents.noticeSeconds(kind)),
        crafts: made.crafts.map((c) => {
          const points = wireCraft(c.spec).points;
          return { id: c.id, name: c.spec.name, points, seconds: buildTrack(points).seconds };
        }),
        sites: made.sites.map((s) => ({ id: s.id, x: s.spec.x, z: s.spec.z })),
        crates: made.crates.map((c) => ({ id: c.id, x: c.spec.x, z: c.spec.z, name: c.spec.name })),
        notices: made.notices,
        near: near ?? this.survivors(),
      });
    }
    if (what === "revisions") return json(store.revisions().map((r) => ({ revision: r.revision, at: r.at, by: r.by, note: r.note })));
    if (what === "revision") {
      const n = Number(url.searchParams.get("n"));
      const r = store.revisions().find((x) => x.revision === n);
      return r ? json({ revision: r.revision, at: r.at, by: r.by, note: r.note, book: r.book }) : json({ error: `Revision ${url.searchParams.get("n") ?? ""} is not kept.` }, 404);
    }
    return json({ error: "No such page." }, 404);
  }

  /** An event as the page shows it at `tick`. */
  private row(e: MapEvent, tick: number): EventLiveRow {
    const parts: LivePart[] = this.host.mapEvents.views(e).map((p) => {
      if (p.type !== "craft") return p;
      const c = e.crafts.find((x) => x.id === p.id)!;
      const enter = e.start + c.after;
      return { ...p, points: [...c.points], seconds: c.track.seconds, flown: Math.max(0, ((c.down > 0 ? c.down : tick) - enter) / TICK_RATE), rest: c.down > 0 && tick >= c.impact ? { x: c.rx, y: c.ry, z: c.rz } : null };
    });
    return { id: e.id, kind: e.kind, state: MAPEVENT_STATES[e.state]!, schedule: e.schedule, source: e.source, seed: e.seed, left: secs((e.state === 0 ? e.start : e.until) - tick), parts };
  }

  /** Where each survivor in the world stands. */
  private survivors(): { x: number; z: number }[] {
    return this.host.mapEvents.places().map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) }));
  }

  private write(what: string, b: Record<string, unknown>, by: Actor): Response {
    const { eventBook: store, mapEvents } = this.host;
    const saved = (r: ReturnType<typeof store.save>, did: string): Response => {
      if (r.ok) {
        this.did(by, `${did}: revision ${r.revision}${r.unkept ? ` (${r.unkept})` : ""}`);
        return json({ revision: r.revision, ...(r.unkept ? { unkept: r.unkept } : {}) });
      }
      if ("conflict" in r) return json({ error: STALE, revision: r.conflict }, 409);
      // The file could not be written: nothing changed, here or on the disk, and the page keeps its draft.
      if ("failed" in r) return json({ error: `${r.failed[0]!.toUpperCase()}${r.failed.slice(1)}.` }, 500);
      return json({ error: "The book has faults.", faults: r.faults satisfies BookFault[] }, 422);
    };
    if (what === "book" || what === "reset" || what === "restore") {
      const expected = whole(b.revision);
      if (expected === null) return json({ error: "A save names the revision it was made from." }, 400);
      const note = typeof b.note === "string" ? b.note.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) : "";
      if (what === "book") {
        if (typeof b.book !== "object" || b.book === null) return json({ error: "A save carries the book." }, 400);
        return saved(store.save(b.book as EventBook, expected, by.name, note), `event book saved${note === "" ? "" : ` (${note})`}`);
      }
      // The starter and an old revision come back as a new revision, so they too are a save another editor can lose to.
      if (expected !== store.book.revision) return json({ error: STALE, revision: store.book.revision }, 409);
      if (what === "reset") return saved(store.reset(by.name), "event book reset to the starter");
      const to = whole(b.to);
      const old = to === null ? undefined : store.revisions().find((r) => r.revision === to);
      if (!old) return json({ error: "That revision is not kept." }, 404);
      return saved(store.save(old.book, expected, by.name, `revision ${old.revision} again`), `event book restored from revision ${old.revision}`);
    }
    if (what === "call") {
      // `event call <kind> [seconds] [seed]`: a seed needs the seconds before it, which are the kind's notice where none are given.
      const seconds = b.seconds === undefined ? null : whole(b.seconds);
      const seed = b.seed === undefined ? null : seedOf(b.seed);
      if (typeof b.kind !== "string" || !KIND_ID.test(b.kind) || (b.seconds !== undefined && seconds === null) || (b.seed !== undefined && seed === null)) return json({ error: "A call names a kind, and may name the seconds to its coming and a seed." }, 400);
      const notice = seconds ?? (seed !== null ? Math.round(mapEvents.noticeSeconds(b.kind)) : null);
      const had = new Set(mapEvents.events.map((e) => e.id));
      const said = this.console(by, `event call ${b.kind}${notice === null ? "" : ` ${notice}`}${seed === null ? "" : ` ${seed}`}`);
      const made = mapEvents.events.find((e) => !had.has(e.id));
      return made ? json({ id: made.id, seed: made.seed, said }) : json({ error: said }, 422);
    }
    if (what === "hurry" || what === "down" || what === "cancel") {
      const id = b.id === "all" ? "all" : whole(b.id);
      const seconds = b.seconds === undefined ? null : whole(b.seconds);
      if (id === null || (b.seconds !== undefined && (seconds === null || what !== "hurry"))) return json({ error: "Name an event by its number, or all." }, 400);
      return json({ said: this.console(by, `event ${what} ${id}${seconds === null ? "" : ` ${seconds}`}`) });
    }
    return json({ error: "No such act." }, 404);
  }

  /** Runs a console line with the request's actor and keeps it for the page's log. */
  private console(by: Actor, line: string): string {
    const said = this.host.console.exec({ host: this.host, client: null, actor: by }, line);
    this.keep(`${line}: ${said.split("\n")[0]}`);
    return said;
  }

  /** A save is not a console line: it is journaled here as one would be. */
  private did(by: Actor, what: string): void {
    this.host.acts.write(by, what);
    this.keep(what);
  }

  private keep(what: string): void {
    this.acts.push({ at: Math.floor(this.now() / 1000), tick: this.host.world.tick, what });
    if (this.acts.length > ACTS_KEPT) this.acts.splice(0, this.acts.length - ACTS_KEPT);
  }
}
