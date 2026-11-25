// What the drop book's admin page asks of a world (planning/workstreams/supply.md, "The admin page"). It reads with GET
// and changes with POST, and both are behind the admin pages' gate (gate.ts), which the caller has passed.
//
// A change is JSON, from a page of this server (its Origin is the host it asked for: no other site's page can make a
// signed-in browser send one), and is refused with a status that says why: 403 from elsewhere, 400 for a body that is
// not what the route takes, 409 for a book saved over another editor's (compare and swap on its revision), 422 for a
// book with faults, each with its path. Nothing here knows the book's rules: the store checks and keeps it
// (server/supply/store.ts), and a drop is called, landed and cancelled by the console's own `supply` command, so the
// page and an operator at the console do one thing and both are in the admin journal.

import { PAGE_ACTOR, type Actor } from "../acts.ts";
import type { Host } from "../host.ts";
import { bookFaults, type BookFault, type SupplyBook } from "../../shared/supply/book.ts";
import { MOST } from "../../shared/supply/book.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { hashString } from "../../shared/hash.ts";
import { bandsOf, findSites } from "../../shared/supply/sites.ts";
import { BANDS, bandDocs } from "../../content/supply/sites.ts";
import { parseIni } from "../settings/ini.ts";
import { Lists } from "../settings/lists.ts";
import { SETTING, arkCrates, arkDocs } from "../supply/ark.ts";
import { actorOf, onlyRead, sameOrigin, stillHolds } from "./gate.ts";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
/** Characters of a pasted override at the most: a whole Game.ini's worth of crates. */
export const ARK_TEXT_MOST = 600000;
/**
 * The largest body a change may be: a book at its largest, and with it (a paste is read against the page's draft) a
 * pasted override at its largest, whose quotes and line ends JSON writes as two characters each.
 */
export const SUPPLY_BODY_MOST = MOST.bytes + 2 * ARK_TEXT_MOST + 8192;
/** Who a change from a page whose viewer is not known is by, in the book's revisions and the admin journal. */
export const PAGE = PAGE_ACTOR.name;
/** The acts the page has lately done here, newest last, for its log. */
const ACTS_KEPT = 200;

export interface SupplyAct {
  /** Seconds since 1970. */
  at: number;
  tick: number;
  what: string;
}

/** What is wrong with a POST before its body is read, or null. */
export function refusedWrite(req: Request): Response | null {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (!sameOrigin(req)) return json({ error: "A change comes from this server's own admin page." }, 403);
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return json({ error: "A change is JSON." }, 400);
  return null;
}

/** A change's body, a JSON object of `most` characters at the most, or null. */
export async function body(req: Request, most = SUPPLY_BODY_MOST): Promise<Record<string, unknown> | null> {
  try {
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > most) return null;
    const text = await req.text();
    if (text.length > most) return null;
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
    const by = actorOf(req);
    // A pasted override is only read into the page's draft.
    if (what === "ark") onlyRead(req);
    return body(req).then((b) => {
      if (b === null) return json({ error: "Expected a JSON object no larger than a book." }, 400);
      return (what === "ark" ? null : stillHolds(req, this.host)) ?? this.write(what, b, by);
    });
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
        // What the drops themselves did: landed, first opened and by whom, gone and why.
        log: supply.log,
      });
    }
    if (what === "found") {
      // Starter sites for this map as it stands, by the rule the cities' lists were made by (shared/supply/sites.ts): a
      // place to each square wherever a drop may land now, in three bands by how far each is from where survivors rise.
      // It is a proposal: the page puts it in its draft, and nothing is saved until the draft is.
      const { sites, faults } = findSites({ sizeX: world.hf.sizeX, sizeZ: world.hf.sizeZ, spawns: world.spawns, fault: (x, z) => supply.siteFault(x, z) }, hashString(world.mapId));
      const bands = bandsOf(sites, BANDS.map((b) => b.share));
      const docs = BANDS.map((band, k) => bandDocs(band, bands[k]!.flatMap((s) => [s.x, s.z])));
      return json({ sites: docs.flatMap((d) => d.sites), circuits: docs.filter((d) => d.sites.length > 0).map((d) => d.circuit), faults });
    }
    if (what === "revisions") return json(store.revisions().map((r) => ({ revision: r.revision, at: r.at, by: r.by, note: r.note })));
    if (what === "revision") {
      const n = Number(url.searchParams.get("n"));
      const r = store.revisions().find((x) => x.revision === n);
      return r ? json({ revision: r.revision, at: r.at, by: r.by, note: r.note, book: r.book }) : json({ error: `Revision ${url.searchParams.get("n") ?? ""} is not kept.` }, 404);
    }
    return json({ error: "No such page." }, 404);
  }

  private write(what: string, b: Record<string, unknown>, by: Actor): Response {
    const { supplyBook: store, supply } = this.host;
    const saved = (r: ReturnType<typeof store.save>, did: string): Response => {
      if (r.ok) {
        this.did(by, `${did}: revision ${r.revision}${r.unkept ? ` (${r.unkept})` : ""}`);
        return json({ revision: r.revision, ...(r.unkept ? { unkept: r.unkept } : {}) });
      }
      if ("conflict" in r) return json({ error: "The book was saved by another editor since this page read it.", revision: r.conflict }, 409);
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
        return saved(store.save(b.book, expected, by.name, note), `supply book saved${note === "" ? "" : ` (${note})`}`);
      }
      // The starter and an old revision come back as a new revision, so they too are a save another editor can lose to.
      if (expected !== store.book.revision) return json({ error: "The book was saved by another editor since this page read it.", revision: store.book.revision }, 409);
      if (what === "reset") return saved(store.reset(by.name), "supply book reset to the starter");
      const to = whole(b.to);
      const old = to === null ? undefined : store.revisions().find((r) => r.revision === to);
      if (!old) return json({ error: "That revision is not kept." }, 404);
      return saved(store.save(old.book, expected, by.name, `revision ${old.revision} again`), `supply book restored from revision ${old.revision}`);
    }
    if (what === "call") {
      const [x, z, tier, cls] = [metres(b.x), metres(b.z), word(b.tier), word(b.cls)];
      const seconds = b.seconds === undefined ? null : whole(b.seconds);
      if (x === null || z === null || tier === null || cls === null || (b.seconds !== undefined && seconds === null)) return json({ error: "A test drop names a place, a tier and a class." }, 400);
      const had = new Set(supply.drops.map((d) => d.id));
      const said = this.console(by, `supply call ${x} ${z} ${tier} ${cls} ${b.ringed === true ? "ringed" : "plain"}${seconds === null ? "" : ` ${seconds}`}`);
      const made = supply.drops.find((d) => !had.has(d.id));
      return made ? json({ id: made.id, said }) : json({ error: said }, 422);
    }
    if (what === "land" || what === "cancel") {
      const id = b.id === "all" ? "all" : whole(b.id);
      const seconds = b.seconds === undefined ? null : whole(b.seconds);
      if (id === null || (b.seconds !== undefined && seconds === null)) return json({ error: "Name a drop by its number, or all." }, 400);
      return json({ said: this.console(by, `supply ${what} ${id}${what === "land" && seconds !== null ? ` ${seconds}` : ""}`) });
    }
    if (what === "ark") {
      // ARK's own override, as pasted from a Game.ini: what it would make of a book, and what it names that this build
      // lacks. Nothing is changed: the page puts the sets and tables in its draft. The book is the page's draft where
      // it sends one, since what an override is silent on is kept from the book it is put in, and else the one in force.
      if (typeof b.text !== "string" || b.text.length > ARK_TEXT_MOST) return json({ error: "Paste ConfigOverrideSupplyCrateItems lines." }, 400);
      if (b.book === undefined) return json(this.ark(b.text, store.book));
      const faults = bookFaults(b.book).filter((f) => !f.warn);
      if (faults.length > 0) return json({ error: "The draft has faults: mend them, then read the paste again.", faults }, 422);
      return json(this.ark(b.text, b.book as SupplyBook));
    }
    return json({ error: "No such act." }, 404);
  }

  /** Runs a console line with the operator's rights, which journals it as `by`'s, and keeps it for the page's log. */
  private console(by: Actor, line: string): string {
    const said = this.host.console.exec({ host: this.host, client: null, actor: by }, line);
    this.acts.push({ at: Math.floor(this.now() / 1000), tick: this.host.world.tick, what: `${line}: ${said.split("\n")[0]}` });
    if (this.acts.length > ACTS_KEPT) this.acts.splice(0, this.acts.length - ACTS_KEPT);
    return said;
  }

  /** A save is not a console line: it is journaled here as one would be. */
  private did(by: Actor, what: string): void {
    this.host.acts.write(by, what);
    this.acts.push({ at: Math.floor(this.now() / 1000), tick: this.host.world.tick, what });
    if (this.acts.length > ACTS_KEPT) this.acts.splice(0, this.acts.length - ACTS_KEPT);
  }

  /** A pasted override read as the server reads its own (server/supply/ark.ts), into the book's documents. */
  private ark(text: string, book: SupplyBook): unknown {
    const { world, rules } = this.host;
    // A line with no key is ARK's value alone: it is read as the setting's.
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "").map((l) => (l.startsWith("(") ? `${SETTING}=${l}` : l));
    const ini = parseIni(lines.join("\n"));
    const entries = ini.entries.filter((e) => e.key.toLowerCase() === SETTING.toLowerCase()).map((e) => e.value);
    const lists = new Lists(rules, world.reg);
    const loot = catalogOf(world.reg);
    const made = arkCrates(entries, book.tiers, (name) => lists.ids(SETTING, name, "item"), (id) => loot.byId.get(id)?.never !== true);
    const docs = arkDocs(made.tables, book.classes, book.tables);
    return {
      crates: entries.length,
      ...docs,
      said: [...ini.faults.map((f) => `line ${f.line}: ${f.why}`), ...made.passed],
      missing: [...new Set(lists.missing.map((m) => m.name))],
      unclear: lists.unclear.map((u) => ({ name: u.name, could: [...u.could] })),
    };
  }
}
