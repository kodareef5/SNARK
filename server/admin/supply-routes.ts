// What the drop book's admin page asks of a world (planning/workstreams/supply.md, "The admin page"). It reads with GET
// and changes with POST, and both are behind the admin pages' gate (gate.ts), which the caller has passed.
//
// A change is JSON, from a page of this server (its Origin is the host it asked for: no other site's page can make a
// signed-in browser send one), and is refused with a status that says why: 403 from elsewhere, 400 for a body that is
// not what the route takes, 409 for a book saved over another editor's (compare and swap on its revision), 422 for a
// book with faults, each with its path. Nothing here knows the book's rules: the store checks and keeps it
// (server/supply/store.ts), and a drop is called, landed and cancelled by the console's own `supply` command, so the
// page and an operator at the console do one thing and both are in the admin journal.

import { OP_ADMIN } from "../console.ts";
import type { Host } from "../host.ts";
import type { BookFault } from "../../shared/supply/book.ts";
import { MOST } from "../../shared/supply/book.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { sameOrigin } from "./gate.ts";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
/** A change's body at the most: a whole book and a little over. */
export const SUPPLY_BODY_MOST = MOST.bytes + 8192;
/** Who a change from the page is by, in the book's revisions and the admin journal. */
export const PAGE = "(admin page)";
/** The acts the page has lately done here, newest last, for its log. */
const ACTS_KEPT = 200;

export interface SupplyAct {
  /** Seconds since 1970. */
  at: number;
  tick: number;
  what: string;
}

/** What is wrong with a POST before its body is read, or null. */
function refusedWrite(req: Request): Response | null {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (!sameOrigin(req)) return json({ error: "A change comes from this server's own admin page." }, 403);
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return json({ error: "A change is JSON." }, 400);
  return null;
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > SUPPLY_BODY_MOST) return null;
    const text = await req.text();
    if (text.length > SUPPLY_BODY_MOST) return null;
    const made: unknown = JSON.parse(text);
    return typeof made === "object" && made !== null && !Array.isArray(made) ? (made as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const word = (v: unknown): string | null => (typeof v === "string" && /^[a-z0-9_.:-]{1,64}$/i.test(v) ? v : null);
const whole = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const metres = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

export class SupplyRoutes {
  private readonly host: Host;
  private readonly now: () => number;
  private catalog = "";
  readonly acts: SupplyAct[] = [];

  constructor(host: Host, now: () => number = Date.now) {
    this.host = host;
    this.now = now;
  }

  /** The answer to a request under /admin/supply/, or null for any other path. `at` is the path as the gate reads it. */
  answer(req: Request, at: string, url: URL): Response | Promise<Response> | null {
    if (!at.startsWith("/admin/supply/")) return null;
    const what = at.slice("/admin/supply/".length);
    if (what.endsWith(".json")) {
      if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      return this.read(what.slice(0, -5), url);
    }
    const no = refusedWrite(req);
    if (no) return no;
    return body(req).then((b) => (b === null ? json({ error: "Expected a JSON object no larger than a book." }, 400) : this.write(what, b)));
  }

  private read(what: string, url: URL): Response {
    const { supplyBook: store, supply, world } = this.host;
    if (what === "book") {
      // The book in force, whole, and what stands over it: a server's own ARK override, and the settings that rule drops.
      const rules = this.host.rules;
      return json({
        revision: store.book.revision,
        starter: store.starter,
        kept: store.kept,
        map: world.mapId,
        book: store.book,
        overrides: [...supply.overrides].map(([tier, t]) => ({ tier, plain: t.plain !== undefined, ringed: t.ringed !== undefined })),
        settings: { off: rules.on("bDisableLootCrates"), quality: rules.num("SupplyCrateLootQualityMultiplier"), random: rules.on("RandomSupplyCratePoints") },
      });
    }
    if (what === "catalog") {
      // What loot may be, as shared/supply/catalog.ts catalogFrom reads it: the content does not change while it runs.
      if (this.catalog === "") {
        const c = catalogOf(world.reg);
        const labels: Record<string, string> = {};
        for (const d of world.reg.defs) if (d?.type === "item") labels[d.id] = (d as { label?: string }).label ?? d.id.slice(d.id.indexOf(":") + 1).replace(/_/g, " ");
        this.catalog = JSON.stringify({ items: c.byIndex.filter((i) => i !== undefined), renamed: [...c.renamed], labels });
      }
      return new Response(this.catalog, { headers: JSON_HEADERS });
    }
    if (what === "live") {
      const tick = world.tick;
      return json({
        tick,
        rate: TICK_RATE,
        revision: store.book.revision,
        size: [world.hf.sizeX, world.hf.sizeZ],
        obelisks: world.obelisks.map((o) => ({ x: o.x, z: o.z, eye: o.eye })),
        drops: supply.drops.map((d) => ({
          id: d.id, tier: d.tierKey, cls: d.clsKey, ringed: d.ringed, state: supply.state(d), x: d.x, z: d.z, landed: d.landed, opened: d.opened,
          lands: d.landed ? 0 : Math.max(0, Math.round((d.land - tick) / TICK_RATE)), left: d.landed && d.left === 0 ? Math.max(0, Math.round((d.end - tick) / TICK_RATE)) : 0,
          circuit: d.circuit, site: d.site, source: d.source,
        })),
        circuits: store.book.circuits.map((k) => {
          const st = supply.circuits.get(k.key);
          return { key: k.key, on: k.on && st !== undefined, looks: st ? Math.max(0, Math.round((st.due - tick) / TICK_RATE)) : 0, why: st?.why ?? "", called: st?.n ?? 0 };
        }),
        calls: supply.calls,
        landings: supply.landings,
        mended: supply.mended,
        acts: this.acts,
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

  private write(what: string, b: Record<string, unknown>): Response {
    const { supplyBook: store, supply } = this.host;
    const saved = (r: ReturnType<typeof store.save>, did: string): Response => {
      if (r.ok) {
        this.did(`${did}: revision ${r.revision}`);
        return json({ revision: r.revision });
      }
      if ("conflict" in r) return json({ error: "The book was saved by another editor since this page read it.", revision: r.conflict }, 409);
      return json({ error: "The book has faults.", faults: r.faults satisfies BookFault[] }, 422);
    };
    if (what === "book" || what === "reset" || what === "restore") {
      const expected = whole(b.revision);
      if (expected === null) return json({ error: "A save names the revision it was made from." }, 400);
      const note = typeof b.note === "string" ? b.note.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) : "";
      if (what === "book") {
        if (typeof b.book !== "object" || b.book === null) return json({ error: "A save carries the book." }, 400);
        return saved(store.save(b.book, expected, PAGE, note), `supply book saved${note === "" ? "" : ` (${note})`}`);
      }
      // The starter and an old revision come back as a new revision, so they too are a save another editor can lose to.
      if (expected !== store.book.revision) return json({ error: "The book was saved by another editor since this page read it.", revision: store.book.revision }, 409);
      if (what === "reset") return saved(store.reset(PAGE), "supply book reset to the starter");
      const to = whole(b.to);
      const old = to === null ? undefined : store.revisions().find((r) => r.revision === to);
      if (!old) return json({ error: "That revision is not kept." }, 404);
      return saved(store.save(old.book, expected, PAGE, `revision ${old.revision} again`), `supply book restored from revision ${old.revision}`);
    }
    if (what === "call") {
      const [x, z, tier, cls] = [metres(b.x), metres(b.z), word(b.tier), word(b.cls)];
      const seconds = b.seconds === undefined ? null : whole(b.seconds);
      if (x === null || z === null || tier === null || cls === null || (b.seconds !== undefined && seconds === null)) return json({ error: "A test drop names a place, a tier and a class." }, 400);
      const had = new Set(supply.drops.map((d) => d.id));
      const said = this.console(`supply call ${x} ${z} ${tier} ${cls} ${b.ringed === true ? "ringed" : "plain"}${seconds === null ? "" : ` ${seconds}`}`);
      const made = supply.drops.find((d) => !had.has(d.id));
      return made ? json({ id: made.id, said }) : json({ error: said }, 422);
    }
    if (what === "land" || what === "cancel") {
      const id = b.id === "all" ? "all" : whole(b.id);
      const seconds = b.seconds === undefined ? null : whole(b.seconds);
      if (id === null || (b.seconds !== undefined && seconds === null)) return json({ error: "Name a drop by its number, or all." }, 400);
      return json({ said: this.console(`supply ${what} ${id}${what === "land" && seconds !== null ? ` ${seconds}` : ""}`) });
    }
    return json({ error: "No such act." }, 404);
  }

  /** Runs a console line as the operator would, which journals it, and keeps it for the page's log. */
  private console(line: string): string {
    const said = this.host.console.exec({ host: this.host, client: null }, line);
    this.acts.push({ at: Math.floor(this.now() / 1000), tick: this.host.world.tick, what: `${line}: ${said.split("\n")[0]}` });
    if (this.acts.length > ACTS_KEPT) this.acts.splice(0, this.acts.length - ACTS_KEPT);
    return said;
  }

  /** A save is not a console line: it is journaled here as one would be. */
  private did(what: string): void {
    this.host.persistence?.journal(OP_ADMIN, new TextEncoder().encode(`${PAGE}\t${what}`));
    this.acts.push({ at: Math.floor(this.now() / 1000), tick: this.host.world.tick, what });
    if (this.acts.length > ACTS_KEPT) this.acts.splice(0, this.acts.length - ACTS_KEPT);
  }
}
